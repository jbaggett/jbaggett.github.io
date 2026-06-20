// @ts-check
/**
 * Shared distribution calculator page logic with interactive chart.
 *
 * Each distribution page (normal, t, chi-sq, F) imports and calls
 * initDistCalculator() with its specific configuration.
 *
 * Interactive features:
 * - Draggable boundary lines (grab the dashed line and drag horizontally)
 * - Click-to-edit value labels on the chart (click the critical value to type a new one)
 * - Probability labels rendered inside shaded regions
 * - Bidirectional sync: chart interactions update form inputs and vice versa
 */

import { parseParams } from './url-params.js';
import { drawCurve, computeDomain } from './curve.js';
import { debounce, pillDimensions } from './chart-utils.js';
import { enableHorizontalDrag, showInlineEdit, formatEditValue } from './chart-interactions.js';
import { initHelp, setPageTitle } from './page-utils.js';
import * as d3Selection from 'd3-selection';

/**
 * @typedef {object} DistConfig
 * @property {string} name - Display name (e.g., "Normal")
 * @property {'normal'|'t'|'chisq'|'F'} type - Distribution type
 * @property {Array<{id: string, label: string, paramKey: string, defaultValue: number, min?: number, step?: string}>} params
 * @property {(params: Record<string, number>) => (x: number) => number} pdfFactory
 * @property {(params: Record<string, number>) => (x: number) => number} cdfFactory
 * @property {(params: Record<string, number>) => (p: number) => number} invFactory
 * @property {(params: Record<string, number>) => object} domainParams
 * @property {string} xSymbol - Symbol for x-axis (e.g., "x", "z", "t", "chi-sq", "F")
 * @property {((params: Record<string, number>) => string)} [xSymbolFactory] - Dynamic symbol based on params
 */

/**
 * Initialize a distribution calculator page with interactive chart.
 * @param {DistConfig} config
 */
export function initDistCalculator(config) {
  initHelp();
  const urlParams = parseParams(window.location.search);
  const baseTitle = document.title.replace(/\s*\|\s*StatLens$/, '');

  // --- DOM references ---
  const paramInputs = {};
  for (const p of config.params) {
    const el = /** @type {HTMLInputElement} */ (document.getElementById(p.id));
    if (!el) continue;
    const urlVal = urlParams[p.paramKey];
    if (urlVal != null) el.value = String(urlVal);
    paramInputs[p.paramKey] = el;
  }

  const tailRadios = /** @type {NodeListOf<HTMLInputElement>} */ (
    document.querySelectorAll('input[name="tail"]'));
  const inputX = /** @type {HTMLInputElement} */ (document.getElementById('input-x'));
  const inputX2 = /** @type {HTMLInputElement|null} */ (document.getElementById('input-x2'));
  const inputP = /** @type {HTMLInputElement} */ (document.getElementById('input-p'));
  const resultDiv = document.getElementById('result-summary');
  const announceDiv = document.getElementById('sr-announce');
  const chartContainer = document.getElementById('chart-container');

  if (urlParams.tail) {
    // Legacy alias: ?tail=both → symmetric (the two-outer-tails mode). Falls back
    // to the requested value if a `both` radio still exists on the page.
    const wanted = urlParams.tail === 'both'
      && !document.querySelector('input[name="tail"][value="both"]')
      ? 'symmetric' : urlParams.tail;
    for (const r of tailRadios) {
      r.checked = r.value === wanted;
    }
  }

  // Boundary values from the URL: `lo` sets the primary bound (left/right cut,
  // symmetric magnitude, or the lower bound of a between band); `hi` sets the
  // upper bound for `between`.
  const urlLo = /** @type {any} */ (urlParams).lo;
  const urlHi = /** @type {any} */ (urlParams).hi;
  if (urlLo != null && isFinite(urlLo)) inputX.value = String(urlLo);
  if (urlHi != null && isFinite(urlHi) && inputX2) inputX2.value = String(urlHi);

  // --- Preset probability buttons ---
  const PRESET_PROBS = [0.005, 0.01, 0.025, 0.05, 0.10];
  const presetBar = document.createElement('div');
  presetBar.className = 'preset-bar';
  presetBar.setAttribute('role', 'group');
  presetBar.setAttribute('aria-label', 'Common tail probabilities');
  // Render common-tail-area presets. The buttons set the BLUE area to the chosen
  // value: left/right set that tail; symmetric splits it across both outer tails;
  // between makes the middle band capture the complement (a centered band).
  function buildPresetButtons() {
    const tail = getTail();
    presetBar.innerHTML = '';
    const label = document.createElement('span');
    label.className = 'preset-label';
    label.textContent = tail === 'between' ? 'Outside area:' : 'Tail area:';
    presetBar.appendChild(label);
    for (const p of PRESET_PROBS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'preset-btn';
      btn.textContent = p < 0.01 ? p.toFixed(3) : p < 0.1 ? p.toFixed(3) : p.toFixed(2);
      btn.addEventListener('click', () => {
        if (!currentInv) return;
        if (tail === 'left') {
          inputX.value = formatForInput(currentInv(p));
          onValueChange(currentInv(p), tail);
        } else if (tail === 'right') {
          inputX.value = formatForInput(currentInv(1 - p));
          onValueChange(currentInv(1 - p), tail);
        } else if (isSym(tail)) {
          // Total outer-tail area = p, each tail = p/2 (bounds mirror the center).
          const lo = currentInv(p / 2);
          inputX.value = formatForInput(lo);
          if (inputX2) inputX2.value = formatForInput(2 * getCenter() - lo);
          onValueChange(undefined, tail);
        } else {
          // between: outer area = p → centered middle band of area 1 − p.
          const lo = currentInv(p / 2);
          const hi = currentInv(1 - p / 2);
          inputX.value = formatForInput(lo);
          if (inputX2) inputX2.value = formatForInput(hi);
          onValueChange(undefined, tail);
        }
      });
      presetBar.appendChild(btn);
    }
  }
  // Insert after the chart figure
  const chartFigure = chartContainer?.closest('figure');
  if (chartFigure) {
    chartFigure.after(presetBar);
  }

  // --- State ---
  /** @type {ReturnType<typeof drawCurve>|null} */
  let curveState = null;
  /** Current PDF function */
  let currentPdf = null;
  /** Current CDF function */
  let currentCdf = null;
  /** Current inverse CDF function */
  let currentInv = null;

  // --- Helpers ---
  function getDistParams() {
    const params = {};
    for (const p of config.params) {
      params[p.paramKey] = parseFloat(paramInputs[p.paramKey]?.value ?? p.defaultValue);
    }
    return params;
  }

  function getTail() {
    for (const r of tailRadios) {
      if (r.checked) return /** @type {'left'|'right'|'both'|'between'|'symmetric'} */ (r.value);
    }
    return 'left';
  }

  /** True for the two-boundary modes. Legacy `both` (still used by the t page) is
   *  treated as `symmetric` until those pages migrate to the new toggle. */
  function isPair(mode) { return mode === 'between' || mode === 'symmetric' || mode === 'both'; }
  /** True for the outer-tails, center-mirrored modes (symmetric, legacy both). */
  function isSym(mode) { return mode === 'symmetric' || mode === 'both'; }

  /** Distribution center (median) — used to mirror bounds in symmetric mode. */
  function getCenter() { return currentInv ? currentInv(0.5) : 0; }

  /**
   * Rendering config for a paired mode.
   * - between → shade the MIDDLE (blue), free bounds, middle pill is primary
   * - symmetric → shade the OUTER TAILS (blue), bounds mirror the center, tail pills primary
   */
  function pairCfg(mode) {
    if (isSym(mode)) return { shade: 'both', mirror: true, primaryMiddle: false };
    return { shade: 'middle', mirror: false, primaryMiddle: true };
  }

  /** Resolve sorted lower/upper bounds for a paired mode from the inputs. */
  function pairBounds(mode) {
    const a = parseFloat(inputX.value);
    const b = isSym(mode)
      ? 2 * getCenter() - a
      : parseFloat(inputX2?.value ?? '');
    if (!isFinite(a) || !isFinite(b)) return { lo: a, hi: a };
    return { lo: Math.min(a, b), hi: Math.max(a, b) };
  }

  /**
   * Write a value to the input backing one bound of a paired mode.
   * symmetric has a single degree of freedom (the partner mirrors about center),
   * so it always writes inputX. between writes inputX (lo input) or inputX2 (hi input).
   * @param {'between'|'symmetric'} mode
   * @param {'lo'|'hi'} key
   * @param {number} value
   */
  function setBound(mode, key, value) {
    if (isSym(mode) || key === 'lo' || !inputX2) {
      inputX.value = formatForInput(value);
    } else {
      inputX2.value = formatForInput(value);
    }
  }

  /** Move whichever bound input is nearer to `value`. */
  function setNearestBound(mode, value) {
    if (isSym(mode)) { inputX.value = formatForInput(value); return; }
    const a = parseFloat(inputX.value);
    const b = parseFloat(inputX2?.value ?? '');
    const key = !isFinite(b) || Math.abs(value - a) <= Math.abs(value - b) ? 'lo' : 'hi';
    setBound(mode, key, value);
  }

  /** Get the current x-axis symbol, respecting dynamic xSymbolFactory if present. */
  function getXSymbol() {
    if (config.xSymbolFactory) return config.xSymbolFactory(getDistParams());
    return config.xSymbol;
  }

  const inputXLabel = inputX?.closest('label');

  /**
   * Compute the Y endpoint for a leader line so it lands inside the shaded region.
   * Returns the lower of: halfway between curve and baseline, or halfway between
   * pillBottom and baseline.
   * @param {number} dataX - X position in data space to sample the curve height
   * @param {number} pillBottomY - Bottom edge of the pill in pixel space
   * @returns {number} Y coordinate for leader endpoint
   */
  function leaderEndY(dataX, pillBottomY) {
    if (!curveState) return pillBottomY + 30;
    const { yScale } = curveState;
    const baseline = curveState.frame.height;
    const curveY = currentPdf ? yScale(currentPdf(dataX)) : baseline * 0.5;
    return Math.max(
      (curveY + baseline) / 2,      // halfway between curve and baseline
      (pillBottomY + baseline) / 2   // halfway between pill bottom and baseline
    );
  }

  // --- Snap-to-common-values during drag ---

  /** Common tail probabilities students encounter. */
  const SNAP_PROBS = [0.005, 0.01, 0.025, 0.05, 0.10];
  /** Pixel threshold for snapping. */
  const SNAP_PX = 6;
  /** @type {number[]} Current snap x-values (recomputed on parameter change). */
  let snapPoints = [];

  /** Recompute snap points from the current inverse CDF. */
  function updateSnapPoints() {
    if (!currentInv) { snapPoints = []; return; }
    snapPoints = [];
    for (const p of SNAP_PROBS) {
      const xLeft = currentInv(p);
      const xRight = currentInv(1 - p);
      if (isFinite(xLeft)) snapPoints.push(xLeft);
      if (isFinite(xRight) && Math.abs(xRight - xLeft) > 1e-10) snapPoints.push(xRight);
    }
  }

  /**
   * Snap a data-space x value to the nearest snap point if within pixel threshold.
   * @param {number} x - Data-space value
   * @param {import('d3-scale').ScaleLinear<number,number>} xScale
   * @returns {number} Snapped value or original
   */
  function snapValue(x, xScale) {
    const px = xScale(x);
    let bestDist = SNAP_PX + 1;
    let bestVal = x;
    for (const sp of snapPoints) {
      const spPx = xScale(sp);
      const dist = Math.abs(px - spPx);
      if (dist < bestDist) {
        bestDist = dist;
        bestVal = sp;
      }
    }
    return bestVal;
  }

  // --- Rendering ---

  /**
   * Full redraw: called when distribution parameters change (curve shape changes).
   * Draws the curve, adds interactive overlays, computes result.
   */
  function fullRender() {
    const params = getDistParams();

    // Validate parameters
    for (const p of config.params) {
      if (p.min != null && params[p.paramKey] < p.min) {
        showError(paramInputs[p.paramKey], `Must be ≥ ${p.min}`);
        return;
      }
      clearError(paramInputs[p.paramKey]);
    }

    currentPdf = config.pdfFactory(params);
    currentCdf = config.cdfFactory(params);
    currentInv = config.invFactory(params);
    updateSnapPoints();
    const pdfFn = currentPdf;
    const domainParams = config.domainParams(params);
    const domain = computeDomain(config.type, domainParams);

    // Update document.title with distribution parameters
    const paramStr = config.params.map(p => `${p.label}=${params[p.paramKey]}`).join(', ');
    setPageTitle(baseTitle, undefined, { extra: paramStr });

    // Clear and redraw chart
    chartContainer.innerHTML = '';

    const tail = getTail();
    const shadeOpts = computeShadeOpts(tail);

    const xSym = getXSymbol();
    curveState = drawCurve(chartContainer, pdfFn, domain, {
      id: `${config.type}-curve`,
      xLabel: xSym,
      titleText: `${config.name} Distribution`,
      ...shadeOpts,
    });

    // Update bound-input labels/visibility to match the current symbol + mode.
    syncBoundInputsUI();

    addInteractiveLayer(tail);
    computeAndDisplay(tail);

  }

  /**
   * Partial update: called when x value or tail direction changes.
   * Keeps the curve, updates shading + annotations + result.
   */
  function updateShading() {
    if (!curveState) return;

    const tail = getTail();
    const shadeOpts = computeShadeOpts(tail);

    curveState.update(shadeOpts);

    clearAnnotations();
    addInteractiveLayer(tail);
    computeAndDisplay(tail);
  }

  /**
   * Compute shade options from the current bound input(s) and mode.
   * - left/right shade one tail (single bound).
   * - between shades the MIDDLE band (blue) between two bounds.
   * - symmetric shades the two OUTER tails (blue), bounds mirrored about center.
   * @param {'left'|'right'|'both'|'between'|'symmetric'} tail
   */
  function computeShadeOpts(tail) {
    if (isPair(tail)) {
      const { lo, hi } = pairBounds(tail);
      if (!isFinite(lo) || !isFinite(hi)) return {};
      return { tail: pairCfg(tail).shade, critLow: lo, critHigh: hi };
    }
    const x = parseFloat(inputX.value);
    if (!isFinite(x)) return {};
    return { tail, critValue: x };
  }

  // --- Interactive Layer ---

  /** Remove all interactive annotations from the chart. */
  function clearAnnotations() {
    if (!curveState) return;
    const inner = d3Selection.select(curveState.frame.inner);
    inner.select('.annotations').selectAll('*').remove();
    // Restore any axis tick labels hidden by value label overlap detection
    inner.select('.x-axis').selectAll('.tick text').attr('visibility', null);
  }

  /**
   * Add interactive overlays: drag lines, editable labels, probability text.
   * @param {'left'|'right'|'both'} tail
   */
  function addInteractiveLayer(tail) {
    if (!curveState || !currentCdf) return;

    const { frame, xScale, yScale, curveData } = curveState;
    const annotations = d3Selection.select(frame.inner).select('.annotations');
    const x = parseFloat(inputX.value);
    if (!isFinite(x)) return;

    // Tap-to-place: click anywhere on the chart to move the boundary
    annotations.append('rect')
      .attr('class', 'tap-target')
      .attr('x', 0).attr('y', 0)
      .attr('width', frame.width).attr('height', frame.height)
      .attr('fill', 'transparent')
      .attr('cursor', 'crosshair')
      .on('click', function (event) {
        // Convert click position to data-space x
        const svgEl = /** @type {SVGSVGElement} */ (frame.svg);
        const pt = svgEl.createSVGPoint();
        pt.x = event.clientX;
        pt.y = event.clientY;
        const svgPt = pt.matrixTransform(svgEl.getScreenCTM().inverse());
        const rawX = xScale.invert(svgPt.x - frame.margin.left);
        const [lo, hi] = xScale.domain();
        const clampedX = Math.max(lo, Math.min(hi, rawX));
        const newX = snapValue(clampedX, xScale);

        if (isPair(tail)) {
          // Move whichever bound is nearer the click (symmetric mirrors).
          setNearestBound(tail, newX);
          onValueChange(undefined, tail);
        } else {
          inputX.value = formatForInput(newX);
          onValueChange(newX, tail);
        }
      });

    if (isPair(tail)) {
      const { lo, hi } = pairBounds(tail);
      if (!isFinite(lo) || !isFinite(hi)) return;
      const middleIsPrimary = pairCfg(tail).primaryMiddle;

      // Two boundary lines (drag either; symmetric mirrors about center).
      addBoundaryLine(annotations, frame, xScale, lo, tail, 'lo');
      addBoundaryLine(annotations, frame, xScale, hi, tail, 'hi');

      // Three region pills: left tail, middle band, right tail.
      // Primary (blue) = the shaded region(s): middle for between, tails for symmetric.
      const leftProb = currentCdf(lo);
      const rightProb = 1 - currentCdf(hi);
      const midProb = Math.max(0, currentCdf(hi) - currentCdf(lo));
      addProbLabel(annotations, frame, xScale,
        xScale.domain()[0], lo, leftProb, middleIsPrimary, 'pair-left');
      addProbLabel(annotations, frame, xScale,
        lo, hi, midProb, !middleIsPrimary, 'pair-mid');
      addProbLabel(annotations, frame, xScale,
        hi, xScale.domain()[1], rightProb, middleIsPrimary, 'pair-right');
    } else {
      const critX = x;

      // Draggable boundary line
      addBoundaryLine(annotations, frame, xScale, critX, tail);

      // Probability labels
      const leftProb = currentCdf(critX);
      if (tail === 'left') {
        addProbLabel(annotations, frame, xScale,
          xScale.domain()[0], critX, leftProb, false, 'left');
        addProbLabel(annotations, frame, xScale,
          critX, xScale.domain()[1], 1 - leftProb, true, 'right');
      } else {
        addProbLabel(annotations, frame, xScale,
          xScale.domain()[0], critX, leftProb, true, 'left');
        addProbLabel(annotations, frame, xScale,
          critX, xScale.domain()[1], 1 - leftProb, false, 'right');
      }
    }

    // Snap point indicators — small triangles on the x-axis at common critical values
    addSnapIndicators(annotations, frame, xScale, tail);

    // Editable value label(s) on the x-axis — two for paired modes, one otherwise.
    if (isPair(tail)) {
      const { lo, hi } = pairBounds(tail);
      addEditableValueLabel(annotations, frame, xScale, lo, tail);
      addEditableValueLabel(annotations, frame, xScale, hi, tail);
    } else {
      addEditableValueLabel(annotations, frame, xScale, x, tail);
    }
  }

  /**
   * Render small triangle markers on the x-axis at snap points relevant to the current tail.
   * @param {*} group
   * @param {import('./types.js').ChartFrame} frame
   * @param {*} xScale
   * @param {'left'|'right'|'both'} tail
   */
  function addSnapIndicators(group, frame, xScale, tail) {
    if (!currentInv) return;
    const [lo, hi] = xScale.domain();
    const y = frame.height;
    const size = 4;

    // Build tail-specific snap points
    /** @type {number[]} */
    const points = [];
    for (const p of SNAP_PROBS) {
      if (tail === 'left') {
        const xLeft = currentInv(p);
        if (isFinite(xLeft)) points.push(xLeft);
      } else if (tail === 'right') {
        const xRight = currentInv(1 - p);
        if (isFinite(xRight)) points.push(xRight);
      } else {
        // Both tails: show snap points on both sides
        const xLeft = currentInv(p / 2);
        const xRight = currentInv(1 - p / 2);
        if (isFinite(xLeft)) points.push(xLeft);
        if (isFinite(xRight) && Math.abs(xRight - xLeft) > 1e-10) points.push(xRight);
      }
    }

    const visible = points.filter(sp => sp > lo && sp < hi);
    for (const sp of visible) {
      const px = xScale(sp);
      group.append('polygon')
        .attr('class', 'snap-indicator')
        .attr('points', `${px},${y} ${px - size},${y + size + 1} ${px + size},${y + size + 1}`)
        .attr('fill', '#569BBD')
        .attr('opacity', 0.5);
    }
  }

  /**
   * Add a draggable vertical boundary line.
   * @param {*} group - D3 selection for annotations group
   * @param {import('./types.js').ChartFrame} frame
   * @param {*} xScale
   * @param {number} value - Data-space x position
   * @param {'left'|'right'|'both'|'between'|'symmetric'} tail - Current mode
   * @param {'single'|'lo'|'hi'} [boundKey] - Which bound this line controls (pair modes)
   */
  function addBoundaryLine(group, frame, xScale, value, tail, boundKey = 'single') {
    const px = xScale(value);
    const handleWidth = 44;

    // Visible dashed line
    const line = group.append('line')
      .attr('class', 'crit-line')
      .attr('data-bound', boundKey)
      .attr('x1', px).attr('y1', 0)
      .attr('x2', px).attr('y2', frame.height)
      .attr('stroke', '#333')
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '6,3');

    // Invisible wider handle for dragging
    const handle = group.append('rect')
      .attr('class', 'drag-handle')
      .attr('data-bound', boundKey)
      .attr('x', px - handleWidth / 2)
      .attr('y', 0)
      .attr('width', handleWidth)
      .attr('height', frame.height)
      .attr('fill', 'transparent')
      .attr('cursor', 'ew-resize');

    enableHorizontalDrag(
      handle.node(),
      /** @type {SVGSVGElement} */ (frame.svg),
      frame,
      xScale,
      (rawX) => {
        // Snap to common critical values
        const newX = snapValue(rawX, xScale);
        // Move this line + handle (lightweight, no DOM rebuild)
        const newPx = xScale(newX);
        line.attr('x1', newPx).attr('x2', newPx);
        handle.attr('x', newPx - handleWidth / 2);

        if (isPair(tail)) {
          setBound(/** @type {'between'|'symmetric'} */ (tail), boundKey === 'hi' ? 'hi' : 'lo', newX);
          // symmetric: the partner line mirrors about the center.
          if (tail === 'symmetric') {
            const partnerPx = xScale(2 * getCenter() - newX);
            group.selectAll('.crit-line').filter(function () {
              return d3Selection.select(this).attr('data-bound') !== boundKey;
            }).attr('x1', partnerPx).attr('x2', partnerPx);
            group.selectAll('.drag-handle').filter(function () {
              return d3Selection.select(this).attr('data-bound') !== boundKey;
            }).attr('x', partnerPx - handleWidth / 2);
          }
          refreshPairValueLabels(tail, frame, xScale);
          onDragMove(undefined, tail);
        } else {
          // Single tail: update the lone value label inline.
          const critLabels = group.selectAll('.crit-label');
          const critBgs = group.selectAll('.crit-label-bg');
          critLabels.attr('x', newPx).text(formatEditValue(newX));
          const tw = formatEditValue(newX).length * 8 + 12;
          critBgs.attr('x', newPx - tw / 2).attr('width', tw);
          inputX.value = formatForInput(newX);
          onDragMove(newX, tail);
        }
      }
    );
  }

  /**
   * Clear and redraw the two editable value labels for a paired mode (used during
   * drag, where the labels' click handlers can be safely rebuilt — the drag is
   * bound to the .drag-handle, which is left untouched).
   */
  function refreshPairValueLabels(mode, frame, xScale) {
    const group = d3Selection.select(frame.inner).select('.annotations');
    group.selectAll('.crit-label, .crit-label-bg').remove();
    const { lo, hi } = pairBounds(mode);
    if (!isFinite(lo) || !isFinite(hi)) return;
    addEditableValueLabel(group, frame, xScale, lo, mode);
    addEditableValueLabel(group, frame, xScale, hi, mode);
  }

  /**
   * Add a probability label (in a pill/box) inside a region of the chart.
   * Uses a fixed vertical position for consistent placement across distributions.
   * @param {*} group
   * @param {import('./types.js').ChartFrame} frame
   * @param {*} xScale
   * @param {number} xLo - Left edge of region (data space)
   * @param {number} xHi - Right edge of region (data space)
   * @param {number} prob - Probability value to display
   * @param {boolean} [isComplement=false] - If true, render as lighter complement text
   * @param {'left'|'right'|'left-of-both'|'right-of-both'|'center'} [region]
   */
  function addProbLabel(group, frame, xScale, xLo, xHi, prob, isComplement = false, region) {
    // Fixed vertical position: 60% down the chart (consistent across all distributions)
    const labelY = frame.height * 0.6;

    // Horizontal: midpoint of region, clamped to stay in chart
    const midX = (xLo + xHi) / 2;
    const midPx = xScale(midX);
    const clampedX = Math.max(45, Math.min(frame.width - 45, midPx));

    // Background pill
    const labelText = prob.toFixed(4);
    const { charW: _pCharW, pad: _pPad, pillH } = pillDimensions('prob');
    const textWidth = labelText.length * _pCharW + _pPad;

    const bgRect = group.append('rect')
      .attr('class', isComplement ? 'prob-label-bg prob-complement-bg' : 'prob-label-bg')
      .attr('x', clampedX - textWidth / 2)
      .attr('y', labelY - pillH / 2)
      .attr('width', textWidth)
      .attr('height', pillH)
      .attr('rx', 4)
      .attr('fill', isComplement ? '#ffffff' : '#e8f4f8')
      .attr('stroke', isComplement ? '#888' : '#569BBD')
      .attr('stroke-width', 1)
      .attr('cursor', 'pointer');

    // Tooltip describing what editing this pill does (varies by mode/region).
    const tipText = region && region.startsWith('pair') && getTail() === 'between'
      ? 'Click to edit — the other two regions adjust proportionally'
      : 'Click to edit this probability';
    bgRect.append('title').text(tipText);

    const textEl = group.append('text')
      .attr('class', isComplement ? 'prob-label prob-complement' : 'prob-label')
      .attr('x', clampedX)
      .attr('y', labelY)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('fill', isComplement ? '#6B6B6B' : '#7B2D8E')
      .attr('cursor', 'pointer')
      .text(labelText);

    // Dashed leader line from pill into the shaded region
    const leaderTargetX = Math.max(4, Math.min(frame.width - 4, midPx));
    const pillBottomY = labelY + pillH / 2 + 2;
    const endY = leaderEndY(midX, pillBottomY);
    group.append('line')
      .attr('class', 'prob-leader')
      .attr('x1', clampedX).attr('y1', labelY + pillH / 2 + 2)
      .attr('x2', leaderTargetX).attr('y2', endY)
      .attr('stroke', isComplement ? '#888' : '#569BBD')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '3,2')
      .style('pointer-events', 'none');

    // Click handler — scoped to THIS pill (text + its own background rect) so the
    // three pair-mode pills each edit their own region.
    const clickHandler = async () => {
      if (!currentInv || !currentCdf) return;
      const mode = getTail();
      const newProb = await showInlineEdit(
        chartContainer,
        textEl.node(),
        prob,
        prob.toFixed(4)
      );
      if (newProb == null || newProb <= 0 || newProb >= 1) return;

      if (!isPair(mode)) {
        // Single tail: left → area to the left; right → area to the right.
        const newX = region === 'left' ? currentInv(newProb)
          : region === 'right' ? currentInv(1 - newProb) : NaN;
        if (!isFinite(newX)) return;
        inputX.value = formatForInput(newX);
        onValueChange(newX, mode);
        return;
      }

      if (isSym(mode)) {
        // Symmetric: bounds mirror the center. Tail pills set each tail area;
        // the middle pill sets the central probability.
        const lo = (region === 'pair-mid')
          ? currentInv((1 - newProb) / 2)
          : currentInv(newProb);
        if (!isFinite(lo)) return;
        inputX.value = formatForInput(lo);
        onValueChange(undefined, mode);
        return;
      }

      // Between: set the edited region to newProb and split the remaining
      // (1 − newProb) across the other TWO regions in proportion to their current
      // sizes (so the band keeps its character), then recompute both bounds.
      // Falls back to an equal split when the other two are ~0.
      const { lo, hi } = pairBounds(mode);
      const pL = currentCdf(lo);
      const pR = 1 - currentCdf(hi);
      const pM = Math.max(0, 1 - pL - pR);
      const remaining = 1 - newProb;
      const EPS = 1e-9;
      let nL, nM; // new left-tail and middle probabilities (right = 1 − nL − nM)
      if (region === 'pair-left') {
        const others = pM + pR;
        nL = newProb;
        nM = others > EPS ? pM * (remaining / others) : remaining / 2;
      } else if (region === 'pair-right') {
        const others = pL + pM;
        const f = others > EPS ? remaining / others : null;
        nL = f != null ? pL * f : remaining / 2;
        nM = f != null ? pM * f : remaining / 2;
      } else { // pair-mid
        const others = pL + pR;
        const f = others > EPS ? remaining / others : null;
        nM = newProb;
        nL = f != null ? pL * f : remaining / 2;
      }
      const nLo = currentInv(nL);
      const nHi = currentInv(nL + nM);
      if (isFinite(nLo) && isFinite(nHi)) {
        setBound(mode, 'lo', nLo);
        setBound(mode, 'hi', nHi);
      }
      onValueChange(undefined, mode);
    };

    textEl.on('click', clickHandler);
    bgRect.on('click', clickHandler);
  }

  /**
   * Add an editable value label on the x-axis at the critical value position.
   * Click to edit inline; Enter/blur commits the new value.
   * @param {*} group
   * @param {import('./types.js').ChartFrame} frame
   * @param {*} xScale
   * @param {number} value
   * @param {'left'|'right'|'both'} tail
   */
  function addEditableValueLabel(group, frame, xScale, value, tail) {
    const displayValue = value;
    const px = xScale(displayValue);

    // Background pill for the label
    const labelText = formatEditValue(displayValue);
    const { charW: _cCharW, pad: _cPad, pillH: _cPillH } = pillDimensions('crit');
    const textWidth = labelText.length * _cCharW + _cPad;

    group.append('rect')
      .attr('class', 'crit-label-bg')
      .attr('x', px - textWidth / 2)
      .attr('y', frame.height + 6)
      .attr('width', textWidth)
      .attr('height', _cPillH)
      .attr('rx', 3)
      .attr('fill', '#fff')
      .attr('stroke', '#569BBD')
      .attr('stroke-width', 1)
      .attr('cursor', 'pointer');

    const textEl = group.append('text')
      .attr('class', 'crit-label')
      .attr('x', px)
      .attr('y', frame.height + 6 + _cPillH / 2)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('fill', '#333')
      .attr('cursor', 'pointer')
      .text(labelText);

    // Hide axis tick labels that overlap with value label pills
    const pillRanges = [[px - textWidth / 2, px + textWidth / 2]];
    const inner = d3Selection.select(frame.inner);
    inner.select('.x-axis').selectAll('.tick').each(function () {
      const tick = d3Selection.select(this);
      const tickX = parseFloat(tick.attr('transform')?.replace(/translate\(([^,]+).*/, '$1') || '0');
      for (const [lo, hi] of pillRanges) {
        if (tickX >= lo - 4 && tickX <= hi + 4) {
          tick.select('text').attr('visibility', 'hidden');
          break;
        }
      }
    });

    // Click-to-edit on the label (and its background). Each pill edits its own
    // bound; in pair modes the bound nearest the edited value is updated.
    const clickHandler = async () => {
      const newVal = await showInlineEdit(
        chartContainer,
        textEl.node(),
        displayValue
      );
      if (newVal == null) return;
      if (isPair(tail)) {
        // The label nearest `displayValue` is the one being edited.
        const { lo } = pairBounds(tail);
        setBound(/** @type {'between'|'symmetric'} */ (tail),
          Math.abs(displayValue - lo) < 1e-9 ? 'lo' : 'hi', newVal);
        onValueChange(undefined, tail);
      } else {
        inputX.value = formatForInput(newVal);
        onValueChange(newVal, tail);
      }
    };

    textEl.on('click', clickHandler);
    // Also make the background pill clickable — scope to THIS label's pill so the
    // two pair-mode labels don't both fire.
    textEl.node()?.previousSibling &&
      d3Selection.select(textEl.node().previousSibling).on('click', clickHandler);
  }

  // --- Value change handler (from drag or edit) ---

  /**
   * Full rebuild of annotations — used for edits, taps, or when a value changes.
   * @param {number|undefined} newX - The new single-bound value (ignored for pair modes,
   *   which read their bounds from the inputs)
   * @param {'left'|'right'|'both'|'between'|'symmetric'} tail
   */
  function onValueChange(newX, tail) {
    if (!curveState || !currentCdf) return;

    const shadeOpts = isPair(tail)
      ? (() => { const { lo, hi } = pairBounds(tail); return { tail: pairCfg(tail).shade, critLow: lo, critHigh: hi }; })()
      : { tail, critValue: newX };

    curveState.update(shadeOpts);
    clearAnnotations();
    addInteractiveLayer(tail);
    syncProbFromX(tail);
    computeAndDisplay(tail);
  }

  /**
   * Lightweight update during drag — only update shading + probability labels.
   * Does NOT rebuild drag handles or editable labels (avoids DOM churn).
   * @param {number} newX
   * @param {'left'|'right'|'both'} tail
   */
  function onDragMove(newX, tail) {
    if (!curveState || !currentCdf) return;

    // Update shading
    const shadeOpts = isPair(tail)
      ? (() => { const { lo, hi } = pairBounds(tail); return { tail: pairCfg(tail).shade, critLow: lo, critHigh: hi }; })()
      : { tail, critValue: newX };
    curveState.update(shadeOpts);

    // Update probability labels: text, position, and pill width
    const { frame, xScale } = curveState;
    const annotations = d3Selection.select(frame.inner).select('.annotations');
    const probLabels = annotations.selectAll('.prob-label');
    const probBgs = annotations.selectAll('.prob-label-bg');
    const domLo = xScale.domain()[0];
    const domHi = xScale.domain()[1];

    /** Clamp pill center to chart area. */
    const clampX = (px) => Math.max(45, Math.min(frame.width - 45, px));

    if (isPair(tail)) {
      const { lo, hi } = pairBounds(tail);
      const middleIsPrimary = pairCfg(tail).primaryMiddle;
      const leftProb = currentCdf(lo);
      const rightProb = 1 - currentCdf(hi);
      const midProb = Math.max(0, currentCdf(hi) - currentCdf(lo));
      const { charW: _bCharW, pad: _bPad, pillH: _bPillH } = pillDimensions('prob');

      // Region midpoints in append order: left tail, middle, right tail
      const dataMids = [(domLo + lo) / 2, (lo + hi) / 2, (hi + domHi) / 2];
      const rawCenters = dataMids.map(xScale);
      const centers = rawCenters.map(clampX);
      const probs = [leftProb, midProb, rightProb];
      const isComp = [middleIsPrimary, !middleIsPrimary, middleIsPrimary];
      const pillY = frame.height * 0.6;

      probLabels.each(function(_, i) {
        const el = d3Selection.select(this);
        el.text(probs[i].toFixed(4)).attr('x', centers[i]);
      });
      probBgs.each(function(_, i) {
        const el = d3Selection.select(this);
        const tw = probs[i].toFixed(4).length * _bCharW + _bPad;
        el.attr('x', centers[i] - tw / 2).attr('width', tw);
      });

      // Update leader lines
      annotations.selectAll('.prob-leader').remove();
      const pillBottom = pillY + _bPillH / 2 + 2;
      for (let i = 0; i < 3; i++) {
        const targetX = Math.max(4, Math.min(frame.width - 4, rawCenters[i]));
        annotations.append('line')
          .attr('class', 'prob-leader')
          .attr('x1', centers[i]).attr('y1', pillBottom)
          .attr('x2', targetX).attr('y2', leaderEndY(dataMids[i], pillBottom))
          .attr('stroke', isComp[i] ? '#888' : '#569BBD')
          .attr('stroke-width', 1)
          .attr('stroke-dasharray', '3,2')
          .style('pointer-events', 'none');
      }
    } else {
      const leftProb = currentCdf(newX);
      const critPx = xScale(newX);
      const { charW: _dCharW, pad: _dPad, pillH: _dPillH } = pillDimensions('prob');

      // Region midpoints: left of crit, right of crit
      const rawCenters = [
        (xScale(domLo) + critPx) / 2,
        (critPx + xScale(domHi)) / 2,
      ];
      const centers = rawCenters.map(clampX);
      const probs = [leftProb, 1 - leftProb];

      const isComp = [tail === 'right', tail === 'left'];
      const pillY = frame.height * 0.6;

      probLabels.each(function(_, i) {
        const el = d3Selection.select(this);
        el.text(probs[i].toFixed(4)).attr('x', centers[i]);
      });
      probBgs.each(function(_, i) {
        const el = d3Selection.select(this);
        const tw = probs[i].toFixed(4).length * _dCharW + _dPad;
        el.attr('x', centers[i] - tw / 2).attr('width', tw);
      });

      // Update leader lines
      annotations.selectAll('.prob-leader').remove();
      const dataMids = [(domLo + newX) / 2, (newX + domHi) / 2];
      const pillBottom = pillY + _dPillH / 2 + 2;
      for (let i = 0; i < 2; i++) {
        const targetX = Math.max(4, Math.min(frame.width - 4, rawCenters[i]));
        annotations.append('line')
          .attr('class', 'prob-leader')
          .attr('x1', centers[i]).attr('y1', pillBottom)
          .attr('x2', targetX).attr('y2', leaderEndY(dataMids[i], pillBottom))
          .attr('stroke', isComp[i] ? '#888' : '#569BBD')
          .attr('stroke-width', 1)
          .attr('stroke-dasharray', '3,2')
          .style('pointer-events', 'none');
      }
    }

    // Sync the probability input (x inputs were already set by the drag/bound setter)
    syncProbFromX(tail);
    computeAndDisplay(tail);
  }

  // --- Sync helpers ---

  /** Compute the headline probability from current bound(s) and mode, write to inputP. */
  function syncProbFromX(tail) {
    if (!currentCdf) return;
    if (isPair(tail)) {
      const { lo, hi } = pairBounds(tail);
      if (!isFinite(lo) || !isFinite(hi)) return;
      const middle = currentCdf(hi) - currentCdf(lo);
      // inputP shows the BLUE (shaded) probability: middle for between, tails for symmetric.
      inputP.value = (isSym(tail) ? 1 - middle : middle).toFixed(4);
      return;
    }
    const x = parseFloat(inputX.value);
    if (!isFinite(x)) return;
    if (tail === 'left') {
      inputP.value = currentCdf(x).toFixed(4);
    } else {
      inputP.value = (1 - currentCdf(x)).toFixed(4);
    }
  }

  /** Compute bound(s) from the probability input and mode, write to the x input(s). */
  function syncXFromProb(tail) {
    if (!currentInv) return;
    const p = parseFloat(inputP.value);
    if (!isFinite(p) || p <= 0 || p >= 1) return;
    if (tail === 'left') {
      inputX.value = formatForInput(currentInv(p));
    } else if (tail === 'right') {
      inputX.value = formatForInput(currentInv(1 - p));
    } else if (isSym(tail)) {
      // p is the BLUE outer-tail area total; each tail = p/2, bounds mirror center.
      const lo = currentInv(p / 2);
      inputX.value = formatForInput(lo);
      if (inputX2) inputX2.value = formatForInput(2 * getCenter() - lo);
    } else {
      // between: p is the BLUE middle area, centered on the median → symmetric band.
      const lo = currentInv((1 - p) / 2);
      const hi = currentInv(1 - (1 - p) / 2);
      inputX.value = formatForInput(lo);
      if (inputX2) inputX2.value = formatForInput(hi);
    }
  }

  // --- Result computation and display ---
  /** @param {'left'|'right'|'both'|'between'|'symmetric'} tail */
  function computeAndDisplay(tail) {
    if (!currentCdf) return;

    const sym = getXSymbol();
    let resultText = '';
    if (isPair(tail)) {
      const { lo, hi } = pairBounds(tail);
      if (!isFinite(lo) || !isFinite(hi)) return;
      const middle = currentCdf(hi) - currentCdf(lo);
      const loT = formatEditValue(lo), hiT = formatEditValue(hi);
      resultText = isSym(tail)
        ? `P(${sym} ≤ ${loT} or ${sym} ≥ ${hiT}) = ${(1 - middle).toFixed(4)}`
        : `P(${loT} ≤ ${sym} ≤ ${hiT}) = ${middle.toFixed(4)}`;
    } else {
      const x = parseFloat(inputX.value);
      if (!isFinite(x)) return;
      if (tail === 'left') {
        resultText = `P(${sym} ≤ ${formatEditValue(x)}) = ${currentCdf(x).toFixed(4)}`;
      } else {
        resultText = `P(${sym} ≥ ${formatEditValue(x)}) = ${(1 - currentCdf(x)).toFixed(4)}`;
      }
    }

    resultDiv.textContent = resultText;
    announceDiv.textContent = resultText;
  }

  // --- Format helpers ---
  function formatForInput(v) {
    return v.toFixed(4);
  }

  // --- Event wiring ---

  const labelX = document.getElementById('label-x');
  const labelX2 = document.getElementById('label-x2');

  /**
   * Reflect the current mode in the bound inputs: show the second bound only for
   * `between`; relabel the first bound (Lower z) for paired modes; seed a sensible
   * second bound the first time a paired mode is entered.
   */
  function syncBoundInputsUI() {
    const tail = getTail();
    const xSym = getXSymbol();
    const sym = xSym === 'z' ? 'z' : xSym;
    // Second bound input: only meaningful (and editable) for `between`.
    // Toggle the hidden attribute AND inline display (a CSS `display` rule on the
    // label would otherwise override the hidden attribute and keep it visible).
    if (labelX2) {
      const show = tail === 'between';
      labelX2.hidden = !show;
      labelX2.style.display = show ? '' : 'none';
    }
    // Relabel the primary bound. Falls back to the page's input label when there's
    // no dedicated #label-x (t/chisq/F), so dynamic symbols still relabel.
    const primaryLabel = labelX || inputXLabel;
    if (primaryLabel) {
      // "Lower/Upper" only for `between` (two free bounds). symmetric keeps a single
      // magnitude input, so it reads as the plain value.
      const txt = tail === 'between' ? `Lower ${sym}` : (xSym === 'z' ? 'z score' : `${sym} value`);
      if (primaryLabel.childNodes[0]) primaryLabel.childNodes[0].textContent = txt + ' ';
    }
    if (labelX2 && labelX2.childNodes[0]) labelX2.childNodes[0].textContent = `Upper ${sym} `;
    // Seed a second bound if missing/equal so `between` opens with a visible band.
    if (tail === 'between' && inputX2) {
      const a = parseFloat(inputX.value);
      const b = parseFloat(inputX2.value);
      if (!isFinite(b) || Math.abs(b - a) < 1e-9) {
        inputX2.value = formatForInput(isFinite(a) ? a + (currentInv ? (currentInv(0.84) - currentInv(0.5)) : 1) : 1);
      }
    }
  }

  // Mode change → relabel/show inputs, rebuild presets, recompute.
  for (const r of tailRadios) {
    r.addEventListener('change', () => {
      syncBoundInputsUI();
      buildPresetButtons();
      syncProbFromX(getTail());
      updateShading();
    });
  }

  // Debounced handlers for form inputs
  const debouncedFullRender = debounce(fullRender, 200);

  // Bound inputs → update probability + chart
  const debouncedXUpdate = debounce(() => {
    syncProbFromX(getTail());
    updateShading();
  }, 150);
  inputX.addEventListener('input', debouncedXUpdate);
  if (inputX2) inputX2.addEventListener('input', debouncedXUpdate);

  // P value input → update x + chart (inverse direction)
  const debouncedPUpdate = debounce(() => {
    syncXFromProb(getTail());
    updateShading();
  }, 150);
  inputP.addEventListener('input', debouncedPUpdate);

  // Distribution parameter inputs → full redraw (curve shape changes)
  // Also wire up slider ↔ number input sync
  for (const p of config.params) {
    const numInput = paramInputs[p.paramKey];
    if (!numInput) continue;

    // Update param summary display if it exists
    const paramDisplay = document.getElementById(`${p.id}-display`);
    const updateParamDisplay = () => {
      if (paramDisplay) paramDisplay.textContent = numInput.value;
    };
    numInput.addEventListener('input', () => { updateParamDisplay(); });
    numInput.addEventListener('input', debouncedFullRender);

    // Look for a paired range slider (id = "slider-{paramKey}")
    const slider = /** @type {HTMLInputElement} */ (
      document.getElementById(`slider-${p.paramKey}`)
    );
    if (slider) {
      // Sync slider → number input → full render
      slider.addEventListener('input', () => {
        numInput.value = slider.value;
        if (paramDisplay) paramDisplay.textContent = slider.value;
        fullRender();
      });
      // Sync number input → slider
      numInput.addEventListener('input', () => {
        const v = parseFloat(numInput.value);
        if (isFinite(v)) {
          slider.value = String(Math.min(parseFloat(slider.max), Math.max(parseFloat(slider.min), v)));
        }
      });
    }

    // Stepper buttons for integer parameters (df)
    // Add stepper buttons for integer-step parameters (df), not continuous (mu, sigma)
    const rawStep = numInput.step;
    const stepVal = parseFloat(rawStep);
    if (rawStep !== 'any' && isFinite(stepVal) && stepVal >= 1) {
      const minVal = parseFloat(numInput.min);
      const maxVal = parseFloat(numInput.max);
      const wrapper = document.createElement('span');
      wrapper.className = 'stepper-group';
      const minusBtn = document.createElement('button');
      minusBtn.type = 'button';
      minusBtn.className = 'stepper-btn';
      minusBtn.textContent = '−';
      minusBtn.setAttribute('aria-label', `Decrease ${p.label}`);
      const plusBtn = document.createElement('button');
      plusBtn.type = 'button';
      plusBtn.className = 'stepper-btn';
      plusBtn.textContent = '+';
      plusBtn.setAttribute('aria-label', `Increase ${p.label}`);

      /** @param {number} delta */
      const step = (delta) => {
        const cur = parseFloat(numInput.value) || 0;
        let next = cur + delta;
        if (isFinite(minVal)) next = Math.max(minVal, next);
        if (isFinite(maxVal)) next = Math.min(maxVal, next);
        numInput.value = String(next);
        if (slider) slider.value = String(Math.min(parseFloat(slider.max), Math.max(parseFloat(slider.min), next)));
        if (paramDisplay) paramDisplay.textContent = String(next);
        fullRender();
      };

      minusBtn.addEventListener('click', () => step(-stepVal));
      plusBtn.addEventListener('click', () => step(stepVal));

      // Insert: [−] [input] [+]
      numInput.parentNode.insertBefore(wrapper, numInput);
      wrapper.appendChild(minusBtn);
      wrapper.appendChild(numInput);
      wrapper.appendChild(plusBtn);
    }
  }

  // Keyboard shortcuts
  const helpDialog = /** @type {HTMLDialogElement} */ (document.getElementById('keyboard-help'));
  if (helpDialog) {
    document.addEventListener('keydown', (e) => {
      if (e.target !== document.body) return;
      if (e.ctrlKey || e.metaKey) return;

      if (e.key === '?') helpDialog.showModal();
    });

    if (helpDialog.querySelector) {
      const closeBtn = helpDialog.querySelector('button');
      if (closeBtn) closeBtn.addEventListener('click', () => helpDialog.close());
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && helpDialog.open) helpDialog.close();
    });
  }

  // --- Initial render ---
  buildPresetButtons();
  fullRender(); // also calls syncBoundInputsUI() once currentInv is ready
  syncProbFromX(getTail());
}

/** @param {HTMLInputElement} el @param {string} msg */
function showError(el, msg) {
  el.setAttribute('aria-invalid', 'true');
  const errId = el.id + '-error';
  let errEl = document.getElementById(errId);
  if (!errEl) {
    errEl = document.createElement('p');
    errEl.id = errId;
    errEl.className = 'error-msg';
    errEl.setAttribute('role', 'alert');
    el.after(errEl);
  }
  errEl.textContent = msg;
  el.setAttribute('aria-describedby', errId);
}

/** @param {HTMLInputElement} el */
function clearError(el) {
  el.removeAttribute('aria-invalid');
  const errEl = document.getElementById(el.id + '-error');
  if (errEl) errEl.remove();
  el.removeAttribute('aria-describedby');
}
