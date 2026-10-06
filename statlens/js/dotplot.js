// @ts-check
/**
 * Dotplot (stacked dot plot) chart module for StatLens.
 * Used by simulation pages and explore/descriptive for small-to-medium datasets.
 *
 * @import { ChartFrame } from './types.js'
 */

import * as d3Array from 'd3-array';
import { gridCentredOn } from './grid.js';
import * as d3Scale from 'd3-scale';
import * as d3Selection from 'd3-selection';
import * as d3Axis from 'd3-axis';
import { createChart, addAxes, drawHorizontalGridlines, formatTick, valueFormat, setLabelText, deoverlapLabels, autoReduceTicks, prefersReducedMotion, hasD3Transition, TRANSITION_MS, attachTooltip, countTickFormat, addMinorTicks} from './chart-utils.js';
import { sturgesBins } from './histogram.js';

/** Default dot fill — IMS blue. */
const DOT_FILL = '#569BBD';

/**
 * The colour a distribution of a statistic is drawn in, everywhere in StatLens.
 *
 * Exported because it was being re-typed as a literal (or diverged from) in
 * pages that draw their own: the Sampling Distribution Lab drew its sampling
 * distribution in amber whenever the statistic was a proportion, so the same
 * entity changed colour depending on what was being measured. Which statistic
 * it is belongs on the axis, not in the hue.
 */
export const STATISTIC_FILL = DOT_FILL;

/** Extreme dot fill (in tail) — same bold IMS blue. */
const EXTREME_FILL = '#569BBD';

/** Non-extreme dot fill when isExtreme is active — subdued gray. */
const BODY_FILL = '#a0a0a0';

/** Observed statistic line color (deep purple — distinct from orange highlight). */
const OBSERVED_COLOR = '#7B2D8E';   // = STAT_OBSERVED in js/chart-utils.js

/** Minimum dot radius. */
const MIN_RADIUS = 3;

/** Floor for a scaled-down radius, so shrinking for emphasis can't make dots vanish. */
const SCALED_MIN_RADIUS = 2;

/** Maximum dot radius (explore dotplots may go up to this). */
const MAX_RADIUS = 12;

/** Maximum column stroke-width when in filled-column mode. */
const COLUMN_MAX_WIDTH = 10;

/**
 * Compute default bin count for dotplots — finer than Sturges so dots form
 * a cohesive shape (matching R/ggplot2 visual density).
 * Uses Freedman-Diaconis when IQR is available, otherwise range/30.
 * @param {number[]} values - Numeric data (unsorted is fine)
 * @returns {number}
 */
export function dotplotBins(values) {
  const n = values.length;
  if (n <= 1) return 3;
  const sorted = [...values].sort((a, b) => a - b);
  const xMin = sorted[0];
  const xMax = sorted[n - 1];
  const range = xMax - xMin;
  if (range === 0) return 3;
  // Freedman-Diaconis bin width
  const q1 = sorted[Math.floor(n * 0.25)];
  const q3 = sorted[Math.floor(n * 0.75)];
  const iqrVal = q3 - q1;
  let bins;
  if (iqrVal > 0) {
    const fdWidth = 2 * iqrVal * Math.pow(n, -1 / 3);
    bins = Math.ceil(range / fdWidth);
  } else {
    // Fallback: range/30 (ggplot2 default for dotplots)
    bins = 30;
  }
  // Dotplots need finer resolution than histograms — at least 15 bins
  return Math.min(40, Math.max(15, bins));
}

/**
 * Compute stacked dot positions from numeric data.
 *
 * @param {number[]} values - Numeric data
 * @param {object} [options]
 * @param {number} [options.numBins] - Number of bins for stacking (default: dotplotBins heuristic)
 * @param {[number, number]} [options.domain] - [min, max] domain override
 * @param {number} [options.binWidth] - Locked bin width (overrides domain/numBins computation)
 * @param {number} [options.binOrigin] - Locked bin origin for grid alignment (default: domain[0])
 * @returns {{ dots: Array<{value: number, binCenter: number, stackIndex: number}>, binWidth: number, maxStack: number, domain: [number, number] }}
 */
export function computeDots(values, options = {}) {
  const n = values.length;
  if (n === 0) {
    const fallback = options.domain ?? /** @type {[number, number]} */ ([0, 1]);
    return { dots: [], binWidth: 1, maxStack: 0, domain: fallback };
  }

  const xMin = d3Array.min(values);
  const xMax = d3Array.max(values);

  // Single-value edge case.
  //
  // `binWidth: 1` used to be returned here, which is not a width in the data's
  // units — it is the number one. On a chart with its own domain (every
  // simulation page passes one) that poisons the dot SIZE downstream:
  // drawDotplot derives its bin count as span/binWidth, so a bootstrap
  // distribution spanning 170 units reported 170 bins for its single dot and
  // drew it at the minimum radius. The first dot of every simulation came out
  // a quarter the size of the second one. (Jeff, 2026-09-27.)
  //
  // The width is whatever the caller locked, else the domain split the same way
  // the normal path splits it. Dots stay AT their value rather than snapping to
  // that grid: with one observation there is nothing to stack, and snapping
  // would move it before the real grid arrives on the next render.
  if (xMin === xMax) {
    const domain = options.domain ?? /** @type {[number, number]} */ ([xMin - 0.5, xMax + 0.5]);
    const dots = values.map((v, i) => ({ value: v, binCenter: v, stackIndex: i }));
    const binWidth = options.binWidth
      ?? (domain[1] - domain[0]) / (options.numBins ?? dotplotBins(values));
    return { dots, binWidth, maxStack: n, domain };
  }

  const domain = options.domain ?? /** @type {[number, number]} */ ([xMin, xMax]);
  const numBins = options.numBins ?? dotplotBins(values);
  // Allow locked binWidth (for stable dotplot grids across re-renders)
  const binWidth = options.binWidth ?? (domain[1] - domain[0]) / numBins;
  // Use the bin origin from the locked grid if provided, else from domain
  const binOrigin = options.binOrigin ?? domain[0];

  // Stack: group values by bin center, assign stack indices.
  // The grid authority owns the snap (js/grid.js) — the caller has already
  // chosen the width and the origin, and the origin belongs to the data, not to
  // this container.
  const grid = gridCentredOn(binWidth, binOrigin);
  /** @type {Map<number, number>} */
  const stackCounts = new Map();
  const dots = values.map(v => {
    const binCenter = grid.centerOf(v);
    const stackIndex = stackCounts.get(binCenter) ?? 0;
    stackCounts.set(binCenter, stackIndex + 1);
    return { value: v, binCenter, stackIndex };
  });

  const maxStack = d3Array.max(Array.from(stackCounts.values())) ?? 0;

  return { dots, binWidth, maxStack, domain };
}

/**
 * Compute dot radius that fits the data in the chart area.
 *
 * @param {number} innerWidth
 * @param {number} innerHeight
 * @param {number} maxStack - Tallest stack count
 * @param {number} numBins - Number of bins
 * @returns {number}
 */
export function computeDotRadius(innerWidth, innerHeight, maxStack, numBins) {
  if (maxStack === 0 || numBins === 0) return MAX_RADIUS;
  return Math.max(
    MIN_RADIUS,
    Math.min(
      innerHeight / (maxStack * 2.05),
      innerWidth / (numBins * 2.05),
      MAX_RADIUS,
    ),
  );
}

/**
 * Draw a dotplot into a container element.
 *
 * @param {string|Element} container - CSS selector or DOM element
 * @param {number[]} values - Numeric data
 * @param {object} [options]
 * @param {number} [options.numBins] - Number of bins for stacking
 * @param {string} [options.xLabel] - X-axis label
 * @param {string} [options.titleText] - Chart title for accessibility
 * @param {string} [options.descText] - Chart description for accessibility
 * @param {string} [options.id] - Unique ID prefix
 * @param {(value: number) => boolean} [options.isExtreme] - Predicate for extreme dot coloring
 * @param {{below: number, above: number}} [options.splitRanks] - Classify dots by
 *   RANK instead of by value: the `below` smallest and `above` largest are
 *   outside the region, the rest inside. This is what lets a boundary column
 *   split — the dots in it share a value, so only a rank can say "these two of
 *   the twenty-eight are the ones the 2.5% reaches".
 * @param {number} [options.observedStat] - Value for observed statistic vertical line
 * @param {string} [options.observedLabel] - Label for observed line (default: 'observed')
 * @param {[number,number]} [options.ciLines] - CI bound values to draw as vertical lines
 * @param {string} [options.ciColor] - Colour of the CI bound lines (default: dusty red)
 * @param {boolean} [options.animate] - Whether to animate (default: true)
 * @param {{top:number,right:number,bottom:number,left:number}} [options.margin]
 * @param {[number,number]} [options.domain] - Override x-axis domain
 * @param {number} [options.binWidth] - Locked bin width for stable grid across re-renders
 * @param {number} [options.binOrigin] - Locked bin origin for stable grid alignment
 * @param {number} [options.highlightIndex] - Index of single newest dot to highlight (yellow pulse)
 * @param {Set<number>} [options.highlightIndices] - Indices of batch-added dots to highlight (accent pulse)
 * @param {number} [options.precision] - Decimal places for values shown to the reader:
 *   overlay labels (default 2), and, when supplied, dot/column values in tooltips
 *   and screen-reader labels (otherwise the exact value / compact axis format)
 * @param {boolean} [options.forceColumns] - Force filled-column mode even if dots would fit (for consistent grouped rendering)
 * @param {string} [options.fillColor] - Override default dot fill color (hex, sets both base and extreme)
 * @param {string} [options.baseFill] - Override non-extreme dot fill (when isExtreme returns false)
 * @param {string} [options.extremeFill] - Override extreme dot fill (when isExtreme returns true)
 * @param {string} [options.highlightStroke] - Persistent border colour for the newest (+1) dot, so it stays distinguishable from a same-hue pile by shape, not just colour
 * @param {number} [options.viewHeight] - Override default viewBox height (for compact stacked charts)
 * @param {boolean} [options.showExport] - Show export buttons (default: true)
 * @param {string} [options.filename] - PNG download filename
 * @param {'full'|'names'|'none'} [options.labels] - Label visibility: 'full' (default), 'names'/'none' (no value tooltips)
 * @param {number} [options.dotRadius] - Force an exact dot radius (overrides auto-fit); for matched bag/resample dotplots
 * @param {number} [options.dotRadiusScale] - Shrink the auto-fit radius by this factor (default 1). A discrete statistic uses it to open gaps between its columns, so the eye reads a set of separate outcomes rather than a continuum.
 * @param {number} [options.sizingMaxStack] - Compute the auto-fit radius from this stack count instead of the data's own max (stable dot size across re-renders)
 * @returns {{ frame: ChartFrame, dots: Array<{value: number, binCenter: number, stackIndex: number}>, xScale: d3Scale.ScaleLinear<number,number>, maxStack: number, binWidth: number, dotRadius: number, update: (values: number[], opts?: object) => void }}
 */
export function drawDotplot(container, values, options = {}) {
  const {
    xLabel,
    titleText = 'Dot plot',
    descText = '',
    id,
    isExtreme,
    splitRanks,
    observedStat,
    observedLabel = 'observed',
    ciLines,
    ciColor = CI_COLOR,
    animate = true,
    margin,
    numBins,
    domain,
    binWidth: lockedBinWidth,
    binOrigin: lockedBinOrigin,
    highlightIndex = -1,
    highlightIndices,
    // No default: supplying it means "print values the way this page prints
    // this statistic", which now reaches tooltips and screen-reader labels.
    // Overlay labels keep their own fallback of 2.
    precision,
    forceColumns = false,
    fillColor,
    baseFill: optBaseFill,
    extremeFill: optExtremeFill,
    highlightStroke,
    viewHeight,
    showExport,
    filename,
    labels = 'full',
    dotRadius: fixedDotRadius,
    dotRadiusScale = 1,
    sizingMaxStack,
    forceDotMode = false,
    viewWidth,
    showObservedMarker,
  } = options;

  // Reasoning-mode `?observed=off` hides the observed-statistic marker so a
  // student must place the cutoff line at the value given in the problem text.
  // An explicit `showObservedMarker` option overrides the URL.
  const showObsMarker = showObservedMarker ?? (
    typeof location === 'undefined' ||
    new URLSearchParams(location.search).get('observed') !== 'off'
  );

  const result = computeDots(values, { numBins, domain, binWidth: lockedBinWidth, binOrigin: lockedBinOrigin });
  const { dots, maxStack, domain: finalDomain, binWidth: actualBinWidth } = result;
  // Compute effective bin count from the actual domain span and bin width,
  // not from numBins which may be the theoretical max (e.g. sampleSize for
  // proportions) rather than how many bins are visible in the current domain.
  const effectiveBins = (actualBinWidth && finalDomain)
    ? Math.ceil((finalDomain[1] - finalDomain[0]) / actualBinWidth)
    : numBins ?? dotplotBins(values);

  const frame = createChart(container, { titleText, descText, id, margin, showExport, filename, ...(viewHeight != null && { viewHeight }), ...(viewWidth != null && { viewWidth }) });

  const xScale = d3Scale.scaleLinear()
    .domain(finalDomain)
    .range([0, frame.width]);

  // `dotRadius` (or `sizingMaxStack`) lets a caller force a fixed dot size so two
  // related dotplots (e.g. a bag and its resample) render dots the same size and
  // keep a stable baseline as stacks vary.
  const dotRadius = fixedDotRadius != null
    ? fixedDotRadius
    : Math.max(SCALED_MIN_RADIUS,
        computeDotRadius(frame.width, frame.height, sizingMaxStack ?? maxStack, effectiveBins)
          * dotRadiusScale);

  // Detect if stacks overflow even at minimum radius — switch to filled columns.
  // `forceDotMode` keeps dots (mechanism strips want consistent dots across a
  // bag/resample pair; tall stacks just extend upward).
  const wouldOverflow = !forceDotMode
    && (forceColumns || (maxStack > 0 && maxStack * MIN_RADIUS * 2 > frame.height));

  // Y axis is implicit (stacking height) for dots; column mode gets a y-axis
  const xAxis = d3Axis.axisBottom(xScale).tickFormat(formatTick).tickSizeOuter(0);
  const axes = d3Selection.select(frame.inner).select('.axes');

  /** @type {d3Scale.ScaleLinear<number,number>|null} */
  let yScale = null;
  if (wouldOverflow) {
    yScale = d3Scale.scaleLinear()
      .domain([0, maxStack])
      .nice()
      .range([frame.height, 0]);
    const yAxis = d3Axis.axisLeft(yScale).tickFormat(countTickFormat(labels, formatTick));
    addAxes(frame, xAxis, yAxis, xLabel, 'Frequency');
    drawHorizontalGridlines(frame);
  } else {
    const xAxisG = axes.append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0, ${frame.height})`)
      .call(xAxis);
    autoReduceTicks(xAxisG, xAxis);
    addMinorTicks(xAxisG, xScale);

    // Faint vertical grid lines aligned to the rendered axis ticks
    const gridGroup = d3Selection.select(frame.inner).select('.data');
    xAxisG.selectAll('.tick').each(function () {
      // Each tick <g> has transform="translate(x, 0)" — extract x
      const transform = d3Selection.select(this).attr('transform');
      const m = transform && transform.match(/translate\(\s*([\d.e+-]+)/);
      if (m) {
        const tx = parseFloat(m[1]);
        gridGroup.append('line')
          .attr('class', 'grid-line')
          .attr('x1', tx)
          .attr('x2', tx)
          .attr('y1', 0)
          .attr('y2', frame.height)
          .attr('stroke', '#d0d0d0')
          .attr('stroke-width', 0.5)
          .attr('stroke-dasharray', '2,2');
      }
    });

    if (xLabel) {
      axes.append('text')
        .attr('class', 'x-label')
        .attr('text-anchor', 'middle')
        .attr('x', frame.width / 2)
        .attr('y', frame.height + frame.margin.bottom - 8)
        .text(xLabel);
    }
  }

  const dataGroup = d3Selection.select(frame.inner).select('.data');
  const tooltipNode = labels === 'none' ? undefined : frame.inner;
  if (wouldOverflow) {
    renderColumns(dataGroup, dots, xScale, /** @type {d3Scale.ScaleLinear<number,number>} */ (yScale), frame.height, isExtreme, highlightIndex, highlightIndices, tooltipNode, fillColor, optBaseFill, optExtremeFill, precision, splitRanks);
  } else {
    renderDots(dataGroup, dots, xScale, frame.height, dotRadius, isExtreme, animate, highlightIndex, highlightIndices, tooltipNode, fillColor, optBaseFill, optExtremeFill, highlightStroke, precision, splitRanks);
  }

  // Observed statistic line. It and the two bounds share one line of text above
  // the plot, so any that collide get lifted a row (js/chart-utils.js).
  /** @type {SVGTextElement[]} */
  const overlayLabels = [];
  const overlaysGroup = d3Selection.select(frame.inner).select('.overlays');
  if (observedStat != null && showObsMarker) {
    // Which columns reach high enough to be in the label's way. A stack of k
    // dots tops out at height − k·2r; the label band is the top ~15 units.
    const LABEL_BAND = 15;
    /** @type {Map<number, number>} */
    const stackAt = new Map();
    for (const d of dots) {
      stackAt.set(d.binCenter, Math.max(stackAt.get(d.binCenter) ?? 0, d.stackIndex + 1));
    }
    const obstacles = wouldOverflow ? [] : [...stackAt].flatMap(([centre, k]) =>
      (frame.height - k * 2 * dotRadius) < LABEL_BAND
        ? [{ x0: xScale(centre) - dotRadius, x1: xScale(centre) + dotRadius }]
        : []);
    overlayLabels.push(renderObservedLine(overlaysGroup, observedStat, xScale, frame.height,
      precision, observedLabel, obstacles, options.observedColor, options.observedTextColor));
  }
  if (ciLines) {
    overlayLabels.push(renderCILine(overlaysGroup, ciLines[0], xScale, frame.height, precision, ciColor));
    overlayLabels.push(renderCILine(overlaysGroup, ciLines[1], xScale, frame.height, precision, ciColor));
  }
  deoverlapLabels(overlayLabels);

  return {
    frame,
    dots,
    xScale,
    maxStack: result.maxStack,
    binWidth: result.binWidth,
    binOrigin: lockedBinOrigin ?? finalDomain[0],
    dotRadius,
    wouldOverflow,
    // Map a stack count to its pixel y — the actual mapping this render used, so
    // overlays (e.g. a normal curve) line up in both dot and filled-column modes.
    countToY: (wouldOverflow && yScale)
      ? (/** @type {number} */ count) => yScale(count)
      : (/** @type {number} */ count) => frame.height - count * 2 * dotRadius,
    update: (newValues, opts = {}) => {
      const newNumBins = opts.numBins ?? numBins;
      const newIsExtreme = opts.isExtreme ?? isExtreme;
      const newObserved = showObsMarker ? (opts.observedStat ?? observedStat) : null;
      const newCiLines = opts.ciLines ?? ciLines;
      const newHighlight = opts.highlightIndex ?? -1;
      const newHighlightSet = opts.highlightIndices;
      const newResult = computeDots(newValues, { numBins: newNumBins });
      const newEffectiveBins = newNumBins ?? dotplotBins(newValues);
      const newOverflow = newResult.maxStack > 0 && newResult.maxStack * MIN_RADIUS * 2 > frame.height;

      xScale.domain(newResult.domain);

      // Clear existing data
      dataGroup.selectAll('circle').remove();
      dataGroup.selectAll('.col-line').remove();
      dataGroup.selectAll('.col-highlight').remove();

      if (newOverflow) {
        // Switch to column mode — need y-axis
        if (!yScale) {
          yScale = d3Scale.scaleLinear().range([frame.height, 0]);
          axes.selectAll('*').remove();
        }
        yScale.domain([0, newResult.maxStack]).nice();
        const yAxisFn = d3Axis.axisLeft(yScale).tickFormat(countTickFormat(labels, formatTick));
        axes.selectAll('*').remove();
        addAxes(frame, xAxis, yAxisFn, xLabel, 'Frequency');

        renderColumns(dataGroup, newResult.dots, xScale, yScale, frame.height, newIsExtreme, newHighlight, newHighlightSet, tooltipNode, undefined, optBaseFill, optExtremeFill, precision);
      } else {
        // Dot mode — remove y-axis if it was added
        if (yScale) {
          yScale = null;
          axes.selectAll('*').remove();
          const xAxisG = axes.append('g')
            .attr('class', 'x-axis')
            .attr('transform', `translate(0, ${frame.height})`)
            .call(xAxis);
          autoReduceTicks(xAxisG, xAxis);
          if (xLabel) {
            axes.append('text')
              .attr('class', 'x-label')
              .attr('text-anchor', 'middle')
              .attr('x', frame.width / 2)
              .attr('y', frame.height + frame.margin.bottom - 8)
              .text(xLabel);
          }
        } else {
          const xAxisSel = d3Selection.select(frame.inner).select('.x-axis').call(xAxis);
          autoReduceTicks(xAxisSel, xAxis);
        }

        const newRadius = Math.max(SCALED_MIN_RADIUS, computeDotRadius(
          frame.width, frame.height, newResult.maxStack, newEffectiveBins) * dotRadiusScale);
        renderDots(dataGroup, newResult.dots, xScale, frame.height, newRadius, newIsExtreme, animate, newHighlight, newHighlightSet, tooltipNode, undefined, optBaseFill, optExtremeFill, highlightStroke, precision);
      }

      const overlays = d3Selection.select(frame.inner).select('.overlays');
      overlays.selectAll('*').remove();
      /** @type {SVGTextElement[]} */
      const newLabels = [];
      if (newObserved != null) {
        newLabels.push(renderObservedLine(overlays, newObserved, xScale, frame.height, precision, opts.observedLabel ?? observedLabel));
      }
      if (newCiLines) {
        newLabels.push(renderCILine(overlays, newCiLines[0], xScale, frame.height, precision));
        newLabels.push(renderCILine(overlays, newCiLines[1], xScale, frame.height, precision));
      }
      deoverlapLabels(newLabels);
    },
  };
}

/** Highlight color for new dots (accessible warm orange, 3.4:1 on white). */
const HIGHLIGHT_FILL = '#E07020';

/** Pending highlight timeouts — cancelled on re-render to prevent stale animations. */
/**
 * Pending highlight reverts, each with the undo it was going to perform.
 *
 * A newly drawn dot is enlarged to `radius * 1.2` for 800ms so the eye catches
 * it, and a timer shrinks it back. Cancelling that timer on the next render —
 * which is what used to happen — DROPPED the shrink instead of performing it,
 * so any re-render inside the 800ms window stranded every new dot at 1.2× its
 * size. After a +100 batch that is every dot on the plot: measured on
 * bootstrap-mean, dots of diameter 19.06px stacked 15.88px apart, overlapping
 * by 3.2px in every column, and they never recovered. (Jeff, 2026-10-06: "the
 * dots in that plot are too big and overlapping.")
 *
 * So a cancel now RUNS the revert it is cancelling.
 * @type {Array<{id: ReturnType<typeof setTimeout>, undo: () => void}>}
 */
let pendingHighlightTimers = [];

/** Cancel every pending highlight revert — and perform it, rather than lose it. */
function flushHighlightTimers() {
  for (const t of pendingHighlightTimers) {
    clearTimeout(t.id);
    try { t.undo(); } catch { /* the dots it referred to are already gone */ }
  }
  pendingHighlightTimers = [];
}

/**
 * Render dots into a D3 selection.
 * @param {d3Selection.Selection} group
 * @param {Array<{value: number, binCenter: number, stackIndex: number}>} dots
 * @param {d3Scale.ScaleLinear<number, number>} xScale
 * @param {number} innerHeight
 * @param {number} radius
 * @param {((value: number) => boolean)} [isExtreme]
 * @param {boolean} animate
 * @param {number} [highlightIndex] - Single newest dot (+1): yellow pulse
 * @param {Set<number>} [highlightIndices] - Batch new dots (+10): accent pulse
 * @param {SVGGElement} [innerNode] - chart-inner node for custom tooltips
 */
function renderDots(group, dots, xScale, innerHeight, radius, isExtreme, animate, highlightIndex = -1, highlightIndices, innerNode, fillColor, optBaseFill, optExtremeFill, highlightStroke, precision, splitRanks) {
  // A dot on an explore page IS an observation, so its exact value is the right
  // thing to show and stays the fallback. A dot on a (re)sampling distribution
  // is a computed statistic, where the exact value is a float tail nobody wants
  // to read (130.43333333333334) and the page has already said how it prints
  // this quantity — so honour that when it is supplied.
  const fmtValue = Number.isFinite(precision) ? valueFormat(precision) : (/** @type {number} */ v) => String(v);
  // Cancel any pending highlight reverts from the previous render — and run
  // them, so nothing is left at its enlarged size.
  flushHighlightTimers();
  const shouldAnimate = animate && !prefersReducedMotion() && hasD3Transition();
  const extremeFill = optExtremeFill || fillColor || EXTREME_FILL;
  const baseFill = optBaseFill || fillColor || (isExtreme || splitRanks ? BODY_FILL : DOT_FILL);
  /** @type {Set<object>} the dots the level reaches, when it is counted by rank */
  const rankInside = new Set();
  if (splitRanks) {
    const sorted = dots.map((d, i) => ({ d, i }))
      .sort((a, b) => a.d.value - b.d.value || a.i - b.i);
    for (let r = splitRanks.below; r < dots.length - splitRanks.above; r++) {
      if (sorted[r]) rankInside.add(sorted[r].d);
    }
  }

  /** Normal fill for a dot at index i. */
  function normalFill(d) {
    // By RANK when the caller gave one, so exactly the level's worth of dots is
    // shaded even where several share a value — the individual-dot counterpart
    // of splitting a column. (Jeff, 2026-10-04.)
    if (splitRanks) return rankInside.has(d) ? extremeFill : baseFill;
    if (!isExtreme) return baseFill;
    return isExtreme(d.value) ? extremeFill : baseFill;
  }

  const circles = group.selectAll('circle')
    .data(dots)
    .join('circle')
    .attr('cx', d => xScale(d.binCenter))
    .attr('cy', d => innerHeight - (d.stackIndex + 0.5) * radius * 2)
    .attr('data-stat-index', (d, i) => i)
    .attr('r', radius)
    .attr('fill', normalFill)
    .attr('stroke', normalFill)
    .attr('stroke-width', 1)
    .attr('role', 'listitem')
    .attr('aria-label', d => fmtValue(d.value));

  // Hover/focus tooltip: show original value
  if (innerNode) {
    attachTooltip(circles, innerNode, (d) => ({
      lines: [fmtValue(d.value)],
      x: xScale(d.binCenter),
      y: innerHeight - (d.stackIndex + 0.5) * radius * 2 - radius,
    }));
  }

  if (shouldAnimate) {
    circles
      .attr('cy', innerHeight)
      .transition()
      .duration(TRANSITION_MS)
      .attr('cy', d => innerHeight - (d.stackIndex + 0.5) * radius * 2);
  }

  // Highlight new dots, then revert.
  // Color highlights always apply (color change is not motion).
  // Smooth fade-back uses rAF animation; reduced-motion gets instant revert after delay.
  const reducedMotion = prefersReducedMotion();
  if (highlightIndex >= 0) {
    const selected = circles.filter((d, i) => i === highlightIndex);
    selected
      .attr('fill', HIGHLIGHT_FILL)
      .attr('stroke', '#000')
      .attr('stroke-width', 2)
      .attr('r', radius * 1.5);
    // Shrink back to normal size but keep orange fill — persists until next render
    // connects visually to the orange resample mean in the mechanism strip
    {
      const undo = () => {
      selected.each(function() {
        if (reducedMotion) {
          // Keep a persistent dark border when requested, so the newest dot is
          // distinguishable from a same-hue pile by more than colour.
          this.setAttribute('stroke', highlightStroke || HIGHLIGHT_FILL);
          this.setAttribute('stroke-width', highlightStroke ? '2' : '1');
          this.setAttribute('r', String(radius));
        } else {
          animateDotRevert(this, HIGHLIGHT_FILL, radius, 400, highlightStroke || undefined, highlightStroke ? 2 : 1);
        }
      });
      };
      pendingHighlightTimers.push({ id: setTimeout(undo, 800), undo });
    }
  } else if (highlightIndices && highlightIndices.size > 0) {
    const selected = circles.filter((d, i) => highlightIndices.has(i));
    selected
      .attr('fill', HIGHLIGHT_FILL)
      .attr('stroke', '#000')
      .attr('stroke-width', 1.5)
      .attr('r', radius * 1.2);
    {
      const undo = () => {
      selected.each(function(d) {
        if (reducedMotion) {
          this.setAttribute('fill', normalFill(d));
          this.setAttribute('stroke', normalFill(d));
          this.setAttribute('stroke-width', '1');
          this.setAttribute('r', String(radius));
        } else {
          animateDotRevert(this, normalFill(d), radius, 400);
        }
      });
      };
      pendingHighlightTimers.push({ id: setTimeout(undo, 800), undo });
    }
  }
}

/**
 * Render filled-column display when dotplot stacks overflow at minimum dot radius.
 * Each bin becomes a narrow rounded-top column (line with stroke-linecap: round).
 * Supports highlightIndex/highlightIndices for orange highlight animation.
 *
 * @param {d3Selection.Selection} group
 * @param {Array<{value: number, binCenter: number, stackIndex: number}>} dots
 * @param {d3Scale.ScaleLinear<number, number>} xScale
 * @param {d3Scale.ScaleLinear<number, number>} yScale
 * @param {number} innerHeight
 * @param {((value: number) => boolean)} [isExtreme]
 * @param {number} [highlightIndex] - Index of single newest dot
 * @param {Set<number>} [highlightIndices] - Indices of batch-added dots
 * @param {SVGGElement} [innerNode]
 */
function renderColumns(group, dots, xScale, yScale, innerHeight, isExtreme, highlightIndex = -1, highlightIndices, innerNode, fillColor, optBaseFill, optExtremeFill, precision, splitRanks) {
  // A column's centre is a value; print it the way the page prints this
  // statistic, else the compact axis format it used before.
  const fmtValue = valueFormat(precision);
  // Cancel any pending highlight reverts from the previous render — and run
  // them, so nothing is left at its enlarged size.
  flushHighlightTimers();
  // Aggregate dots by binCenter → count, and by how many of them are in the
  // region of interest.
  //
  // The region is decided from the dots' own VALUES, not from the bin centre.
  // A bin centre is computed from the grid (min + (i + ½)·width) and a CI bound
  // from a quantile, so two numbers that are the same quantity arrive by
  // different arithmetic and can differ in the last bit. Measured on
  // transplant_survival: the upper bound and the atom 29/34 were both 0.853,
  // the bound landing 1.2e-13 of a pixel below the column — so `centre <= hi`
  // was false and 28 resamples sitting exactly ON the bound were drawn outside
  // it, while the pills (which count values) called them inside. The lower
  // bound, shifted the same direction, stayed comfortably inside. One tiny
  // systematic offset, opposite consequences at the two ends, and a picture
  // that shaded one boundary column blue and the other grey. (Jeff, 2026-10-04:
  // "it's strange that one of the boundary columns is shaded blue while the
  // other is shaded gray".)
  //
  // Majority, so a bin that straddles a bound takes the colour most of its dots
  // would have. On a discrete statistic every dot in a column shares a value,
  // so there is nothing to decide.
  //
  // `splitRanks` classifies by RANK instead, which is the only way to say "two
  // of these twenty-eight are the ones the bottom 2.5% reaches" when all
  // twenty-eight share a value. Then a boundary column is drawn in two pieces.
  /** @type {Map<number, {count: number, below: number, inside: number, above: number}>} */
  const bins = new Map();
  /** @type {(d: {value: number}, rank: number) => -1|0|1} below / inside / above */
  let classify;
  if (splitRanks) {
    const lo = splitRanks.below, hi = dots.length - splitRanks.above;
    classify = (_d, rank) => (rank < lo ? -1 : rank >= hi ? 1 : 0);
  } else if (isExtreme) {
    // Value-based: in or out, with no side. Out dots are reported as `above`
    // so they stack at the top, which is where a single-region column's colour
    // comes from anyway — a column is whole in this mode unless its BIN
    // straddles, and then the split is real.
    classify = (d) => (isExtreme(d.value) ? 0 : 1);
  } else {
    classify = () => 0;
  }
  // Rank order, so ties are broken the same way every render.
  const order = dots.map((d, i) => i).sort((a, b) =>
    dots[a].value - dots[b].value || a - b);
  const rankOf = new Array(dots.length);
  order.forEach((idx, rank) => { rankOf[idx] = rank; });

  dots.forEach((d, i) => {
    let entry = bins.get(d.binCenter);
    if (!entry) { entry = { count: 0, below: 0, inside: 0, above: 0 }; bins.set(d.binCenter, entry); }
    entry.count++;
    const c = classify(d, rankOf[i]);
    if (c < 0) entry.below++; else if (c > 0) entry.above++; else entry.inside++;
  });

  const columnData = [...bins.entries()]
    .map(([center, b]) => ({ center, count: b.count, below: b.below, inside: b.inside, above: b.above }))
    .sort((a, b) => a.center - b.center);

  // Compute column width: fraction of bin pixel spacing, clamped
  const binPixelWidth = columnData.length > 1
    ? Math.abs(xScale(columnData[1].center) - xScale(columnData[0].center))
    : 10;
  const colWidth = Math.max(MIN_RADIUS * 2, Math.min(COLUMN_MAX_WIDTH, binPixelWidth * 0.75));

  const REGION_FILL = optExtremeFill || fillColor || EXTREME_FILL;
  const OUTSIDE_FILL = optBaseFill || fillColor || (isExtreme || splitRanks ? BODY_FILL : DOT_FILL);

  // Drawn bottom-up: the outside-below piece, the inside piece, the
  // outside-above piece. A column wholly in one region is one line with the
  // rounded cap it has always had; a boundary column is two, flat where they
  // meet, which is the StatKey picture — grey under blue at the left bound,
  // blue under grey at the right. (Jeff, 2026-10-04.)
  /** @type {Array<{center:number, count:number, from:number, to:number, fill:string, whole:boolean, label:string}>} */
  const segments = [];
  for (const col of columnData) {
    const parts = [
      { n: col.below, fill: OUTSIDE_FILL },
      { n: col.inside, fill: REGION_FILL },
      { n: col.above, fill: OUTSIDE_FILL },
    ].filter(part => part.n > 0);
    const whole = parts.length === 1;
    let base = 0;
    for (const part of parts) {
      segments.push({ center: col.center, count: col.count, from: base, to: base + part.n,
        fill: part.fill, whole, label: `${fmtValue(col.center)}: ${col.count}` });
      base += part.n;
    }
  }

  const lines = group.selectAll('.col-line')
    .data(segments)
    .join('line')
    .attr('class', 'col-line')
    .attr('x1', d => xScale(d.center))
    .attr('x2', d => xScale(d.center))
    .attr('y1', d => (d.from === 0 ? innerHeight : yScale(d.from)))
    .attr('y2', d => yScale(d.to))
    .attr('stroke', d => d.fill)
    .attr('stroke-width', colWidth)
    // Flat where two pieces meet, so the boundary between them is a line and
    // not a pair of overlapping rounded caps.
    .attr('stroke-linecap', d => (d.whole ? 'round' : 'butt'))
    .attr('role', 'listitem')
    .attr('aria-label', d => d.label);

  // …and a cut column still gets its rounded top.
  //
  // Butt caps make the join flat, which is what the join wants, but they also
  // flatten the top of the column — so a split column stood out as square-topped
  // beside the rounded ones. A disc at the apex, in the top piece's colour,
  // restores the cap without rounding the join. (Jeff, 2026-10-04: "the columns
  // in the dotplot should all have the rounded tops, even the split ones".)
  const caps = segments.filter(seg => !seg.whole && seg.to === seg.count);
  group.selectAll('.col-cap')
    .data(caps)
    .join('circle')
    .attr('class', 'col-cap')
    .attr('cx', d => xScale(d.center))
    .attr('cy', d => yScale(d.to))
    .attr('r', colWidth / 2)
    .attr('fill', d => d.fill)
    .attr('aria-hidden', 'true');

  // Highlight only the NEW portion of columns that received new dots
  if (highlightIndex >= 0 || (highlightIndices && highlightIndices.size > 0)) {
    // Count how many new dots landed in each bin
    /** @type {Map<number, number>} */
    const newCountByCenter = new Map();
    for (let i = 0; i < dots.length; i++) {
      if (i === highlightIndex || (highlightIndices && highlightIndices.has(i))) {
        const c = dots[i].binCenter;
        newCountByCenter.set(c, (newCountByCenter.get(c) ?? 0) + 1);
      }
    }

    // Draw overlay segments for just the new portion of each affected column
    const isOneShot = highlightIndex >= 0 && (!highlightIndices || highlightIndices.size === 0);
    const hlWidth = isOneShot ? colWidth + 2 : colWidth + 1;

    /** @type {Array<{center: number, totalCount: number, newCount: number}>} */
    const hlData = [];
    for (const [center, newCount] of newCountByCenter) {
      const total = bins.get(center)?.count ?? newCount;
      hlData.push({ center, totalCount: total, newCount });
    }

    const hlLines = group.selectAll('.col-highlight')
      .data(hlData)
      .join('line')
      .attr('class', 'col-highlight')
      .attr('x1', d => xScale(d.center))
      .attr('x2', d => xScale(d.center))
      .attr('y1', d => yScale(d.totalCount - d.newCount))  // bottom of new portion
      .attr('y2', d => yScale(d.totalCount))                // top of column
      .attr('stroke', HIGHLIGHT_FILL)
      .attr('stroke-width', hlWidth)
      .attr('stroke-linecap', 'round');

    // Revert: for +1, keep last highlight persistent; for batches, fade out
    const reducedMotion = prefersReducedMotion();
    if (!isOneShot) {
      {
        const undo = () => {
        if (reducedMotion) {
          hlLines.remove();
        } else {
          hlLines.each(function() {
            const el = /** @type {SVGLineElement} */ (this);
            animateColumnRevert(el, 'transparent', 0, 400, () => el.remove());
          });
        }
        };
        pendingHighlightTimers.push({ id: setTimeout(undo, 800), undo });
      }
    } else {
      // +1: shrink to normal width but keep orange — persists until next render
      {
        const undo = () => {
        hlLines.attr('stroke-width', colWidth);
        };
        pendingHighlightTimers.push({ id: setTimeout(undo, 800), undo });
      }
    }
  }

  // Tooltips
  if (innerNode) {
    attachTooltip(lines, innerNode, (d) => ({
      lines: [`${fmtValue(d.center)}`, `Frequency: ${d.count}`],
      x: xScale(d.center),
      y: yScale(d.count),
    }));
  }
}

/**
 * Animate a highlighted column back to its normal stroke color and width,
 * or fade it out (when onComplete is provided for overlay removal).
 * @param {SVGLineElement} el
 * @param {string} targetColor - Normal stroke color (hex), or 'transparent' to fade out
 * @param {number} targetWidth - Normal stroke-width
 * @param {number} duration - Animation duration in ms
 * @param {(() => void)} [onComplete] - Called when animation finishes
 */
function animateColumnRevert(el, targetColor, targetWidth, duration, onComplete) {
  const fadeOut = targetColor === 'transparent';
  const startColor = hexToRGB(el.getAttribute('stroke') ?? HIGHLIGHT_FILL);
  const endColor = fadeOut ? startColor : hexToRGB(targetColor);
  const startW = parseFloat(el.getAttribute('stroke-width') ?? String(targetWidth));
  const startOpacity = 1;
  const start = performance.now();

  function tick(now) {
    const t = Math.min((now - start) / duration, 1);
    const e = 1 - (1 - t) * (1 - t); // ease-out quad
    if (fadeOut) {
      el.setAttribute('opacity', String(1 - e));
    } else {
      el.setAttribute('stroke', lerpColor(startColor, endColor, e));
      el.setAttribute('stroke-width', String(startW + (targetWidth - startW) * e));
    }
    if (t < 1) {
      requestAnimationFrame(tick);
    } else if (onComplete) {
      onComplete();
    }
  }
  requestAnimationFrame(tick);
}

/**
 * Parse a hex color (#RRGGBB) to [r, g, b].
 * @param {string} hex
 * @returns {[number, number, number]}
 */
function hexToRGB(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Interpolate [r,g,b] and format as hex.
 * @param {[number,number,number]} a
 * @param {[number,number,number]} b
 * @param {number} t - 0..1
 * @returns {string}
 */
function lerpColor(a, b, t) {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

/**
 * Animate a highlighted dot back to its normal fill/stroke/radius.
 * Uses requestAnimationFrame for reliable cross-browser SVG animation.
 * @param {SVGCircleElement} el - The circle DOM element
 * @param {string} targetFill - Normal fill color (hex)
 * @param {number} targetRadius - Normal radius
 * @param {number} duration - Animation duration in ms
 */
function animateDotRevert(el, targetFill, targetRadius, duration, targetStroke, targetStrokeWidth = 1) {
  const startFill = hexToRGB(el.getAttribute('fill') ?? HIGHLIGHT_FILL);
  const startStroke = hexToRGB(el.getAttribute('stroke') ?? '#000000');
  const endFill = hexToRGB(targetFill);
  const endStroke = hexToRGB(targetStroke ?? targetFill);
  const startR = parseFloat(el.getAttribute('r') ?? String(targetRadius));
  const startSW = parseFloat(el.getAttribute('stroke-width') ?? '1');
  const start = performance.now();

  function tick(now) {
    const t = Math.min((now - start) / duration, 1);
    // Ease-out quad
    const e = 1 - (1 - t) * (1 - t);
    el.setAttribute('fill', lerpColor(startFill, endFill, e));
    el.setAttribute('stroke', lerpColor(startStroke, endStroke, e));
    el.setAttribute('r', String(startR + (targetRadius - startR) * e));
    el.setAttribute('stroke-width', String(startSW + (targetStrokeWidth - startSW) * e));
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/**
 * Render the observed statistic vertical line.
 * @param {d3Selection.Selection} overlays
 * @param {number} value
 * @param {d3Scale.ScaleLinear<number, number>} xScale
 * @param {number} innerHeight
 */
function renderObservedLine(overlays, value, xScale, innerHeight, precision = 2, label = 'observed',
    obstacles = [], color = OBSERVED_COLOR, textColor = color) {
  const x = xScale(value);
  const w = xScale.range()[1];
  overlays.append('line')
    .attr('x1', x)
    .attr('x2', x)
    .attr('y1', 14)
    .attr('y2', innerHeight)
    .attr('stroke', color)
    .attr('stroke-width', 2.5)
    .attr('aria-label', `${label}: ${value.toFixed(precision)}`);
  // Clamp label so it doesn't clip at chart edges
  const labelText = `${label} = ${value.toFixed(precision)}`;
  const clampedX = Math.max(4, Math.min(w - 4, x));
  const labelEl = overlays.append('text')
    .attr('class', 'overlay-value observed-label')
    .attr('x', clampedX).attr('y', 10)
    .attr('fill', textColor)
    .attr('font-weight', 700);
  // Via setLabelText, so an x̄ gets a rule over the x instead of a combining
  // macron that SVG puts up and to the right of it.
  const node = /** @type {SVGTextElement} */ (labelEl.node());
  setLabelText(node, labelText);

  // Put the label where the dots are NOT.
  //
  // It used to sit centred on its own line, at the top of the plot — which is
  // exactly where a tall stack near the mean reaches, so on the data that makes
  // the mean interesting the label was printed over the dots. The edge rule
  // below (start/end near the margins) was the only placement logic there was.
  //
  // `obstacles` are the x-spans of the columns tall enough to reach the label's
  // band. Try centred, then left of the line, then right of it, and take the
  // first that is clear; if the stacks block all three — a dense plot — keep
  // centred, which is at least predictable. (Jeff, 2026-10-03: "let's make the
  // placement of the purple observed values smart so they stay clear of the
  // dots for legibility.")
  let width = 0;
  try { width = node.getComputedTextLength(); } catch { width = labelText.length * 6; }
  const GAP = 3;
  /** @param {number} x0 @param {number} x1 */
  const clear = (x0, x1) => !obstacles.some(o => o.x1 > x0 && o.x0 < x1);
  /** @type {Array<['middle'|'end'|'start', number, number]>} */
  const options = [
    ['middle', clampedX - width / 2, clampedX + width / 2],
    ['end', clampedX - GAP - width, clampedX - GAP],
    ['start', clampedX + GAP, clampedX + GAP + width],
  ];
  // The old edge rule still wins where it applies: a label hanging off the left
  // or right of the plot is worse than one over a dot.
  const forced = x < w * 0.15 ? 'start' : x > w * 0.85 ? 'end' : null;
  const pick = forced
    ? options.find(o => o[0] === forced)
    : (options.find(o => o[1] >= 0 && o[2] <= w && clear(o[1], o[2])) ?? options[0]);
  labelEl.attr('text-anchor', pick[0]);
  return node;
}

/** CI line color (dark pink — distinct from purple observed stat). */
const CI_COLOR = '#B5747A';

/**
 * Render a CI bound vertical line with label.
 * @param {d3Selection.Selection} overlays
 * @param {number} value
 * @param {d3Scale.ScaleLinear<number, number>} xScale
 * @param {number} innerHeight
 * @param {number} [precision=2] - Decimal places for value label
 */
function renderCILine(overlays, value, xScale, innerHeight, precision = 2, color = CI_COLOR) {
  const x = xScale(value);
  overlays.append('line')
    .attr('x1', x).attr('x2', x)
    .attr('y1', 0).attr('y2', innerHeight)
    .attr('stroke', color)
    .attr('stroke-width', 2)
    .attr('stroke-dasharray', '6,3')
    .attr('aria-label', `CI bound: ${value.toFixed(precision)}`);
  const t = overlays.append('text')
    .attr('class', 'overlay-value')
    .attr('x', x).attr('y', -4)
    .attr('text-anchor', 'middle')
    .attr('fill', color)
    .text(value.toFixed(precision));
  return /** @type {SVGTextElement} */ (t.node());
}
