// @ts-check
/**
 * Interactive critical-value figure — a distribution curve with a centered
 * (1−α) shaded band between symmetric critical values ±c.
 *
 * This is the "where does the critical value come from?" picture used by the
 * confidence-interval estimation pages. It shares its marker look-and-feel with
 * the probability-distribution calculators by drawing from the same primitives
 * (js/dist-markers.js): dashed draggable boundary lines, click-to-edit
 * probability pills (middle = confidence, tails = α/2), editable critical-value
 * boxes on the axis, and snap triangles at common confidence levels.
 *
 * Semantics here are a symmetric equal-tailed band (correct for t and z — means
 * and proportions). The caller supplies the distribution functions already
 * bound to their parameters (df, etc.) and gets an onChange(level, crit).
 *
 * @typedef {object} CritFigureOptions
 * @property {(x: number) => number} pdfFn
 * @property {(x: number) => number} cdfFn
 * @property {(p: number) => number} invFn
 * @property {[number, number]} domain
 * @property {number} [center=0]
 * @property {number} [level=0.95] - Initial central probability (confidence level).
 * @property {number} [minLevel=0.5]
 * @property {number} [maxLevel=0.999]
 * @property {string} [xLabel='t']
 * @property {string} [title]
 * @property {string} [desc]
 * @property {string} [id]
 * @property {string} [filename]
 * @property {string} [critSymbol='t*']
 * @property {number[]} [snapLevels] - Confidence levels to mark with snap triangles.
 * @property {HTMLInputElement|null} [confInput] - Percent box to keep in sync (and listen to).
 * @property {HTMLElement|null} [confPills] - Preset-level pill group to keep in sync (and listen to).
 * @property {(level: number, crit: number) => void} [onChange]
 */

import { drawCurve } from './curve.js';
import { drawSnapTriangles, addBoundaryLine, addProbPill, addAxisValueBox } from './dist-markers.js';
import * as d3Selection from 'd3-selection';

const SNAP_PX = 6;

/**
 * Handlers already bound to a control, so a remount (new data → new df → new figure)
 * replaces its listener instead of stacking a second one that drives a dead figure.
 * @type {WeakMap<EventTarget, {type: string, fn: EventListener}>}
 */
const boundHandlers = new WeakMap();

/**
 * @param {EventTarget} el
 * @param {string} type
 * @param {EventListener} fn
 */
function bind(el, type, fn) {
  const prev = boundHandlers.get(el);
  if (prev) el.removeEventListener(prev.type, prev.fn);
  el.addEventListener(type, fn);
  boundHandlers.set(el, { type, fn });
}

/**
 * @param {HTMLElement} container
 * @param {CritFigureOptions} opts
 * @returns {{ setLevel: (level: number, fireChange?: boolean) => void, getLevel: () => number, getCrit: () => number }}
 */
export function mountCriticalValueFigure(container, opts) {
  const {
    pdfFn, cdfFn, invFn, domain,
    center = 0, minLevel = 0.5, maxLevel = 0.999,
    xLabel = 't', title = 'Distribution', desc = '', id, filename,
    onChange, confInput = null, confPills = null,
    snapLevels = [0.80, 0.90, 0.95, 0.98, 0.99],
  } = opts;

  const clampLevel = (/** @type {number} */ l) => Math.min(maxLevel, Math.max(minLevel, l));
  let level = clampLevel(opts.level ?? 0.95);

  container.innerHTML = '';
  const chart = drawCurve(container, pdfFn, domain, {
    xLabel, yLabel: 'Density', titleText: title, descText: desc, id,
    tail: 'middle', critLow: center - 1, critHigh: center + 1,
    showExport: true, filename,
  });
  const { frame, xScale, yScale } = chart;
  const ann = d3Selection.select(frame.inner).select('.annotations');

  // Critical values (equal-tailed) for a confidence level.
  const critFor = (/** @type {number} */ lvl) => {
    const a = 1 - lvl;
    return { lo: invFn(a / 2), hi: invFn(1 - a / 2) };
  };
  // Level implied by a symmetric half-width from center.
  const levelForHalf = (/** @type {number} */ half) =>
    clampLevel(cdfFn(center + half) - cdfFn(center - half));

  // Snap x-values: ±t* for the common confidence levels.
  const snapXs = [];
  for (const c of snapLevels) {
    const { lo, hi } = critFor(c);
    if (isFinite(lo)) snapXs.push(lo);
    if (isFinite(hi)) snapXs.push(hi);
  }
  const snap = (/** @type {number} */ rawX) => {
    const px = xScale(rawX);
    let best = rawX, bestD = SNAP_PX + 1;
    for (const sx of snapXs) {
      const d = Math.abs(px - xScale(sx));
      if (d < bestD) { bestD = d; best = sx; }
    }
    return best;
  };

  // Leader-line endpoint (matches the distribution pages' curve-aware leader).
  const leaderEndY = (/** @type {number} */ dataX, /** @type {number} */ pillBottomY) => {
    const baseline = frame.height;
    const curveY = yScale(pdfFn(dataX));
    return Math.max((curveY + baseline) / 2, (pillBottomY + baseline) / 2);
  };

  // Structural markers drawn once: the two boundary lines + snap triangles.
  // (Their positions are updated in place; only the labels are rebuilt.)
  drawSnapTriangles(ann, frame, xScale, snapXs);

  const { lo: lo0, hi: hi0 } = critFor(level);
  /** @type {{line:any, handle:any}} */
  let loBound = addBoundaryLine(ann, frame, xScale, lo0, {
    boundKey: 'lo', snap,
    onDrag: (newX) => onBoundDrag('lo', newX),
  });
  /** @type {{line:any, handle:any}} */
  let hiBound = addBoundaryLine(ann, frame, xScale, hi0, {
    boundKey: 'hi', snap,
    onDrag: (newX) => onBoundDrag('hi', newX),
  });

  /** Drag of one bound: mirror the partner, recompute the level, refresh. */
  function onBoundDrag(/** @type {'lo'|'hi'} */ which, /** @type {number} */ newX) {
    const half = Math.max(1e-4, Math.abs(newX - center));
    level = levelForHalf(half);
    // The dragged line was moved by the primitive; move the partner to mirror.
    const partner = which === 'lo' ? hiBound : loBound;
    const partnerPx = xScale(which === 'lo' ? center + half : center - half);
    partner.line.attr('x1', partnerPx).attr('x2', partnerPx);
    partner.handle.attr('x', partnerPx - 22);
    updateShadeAndLabels();
    if (onChange) onChange(level, invFn(1 - (1 - level) / 2) - center);
  }

  /** Remove the level-dependent labels (pills + axis boxes) and redraw them. */
  function updateShadeAndLabels() {
    const { lo, hi } = critFor(level);
    const alpha = 1 - level;
    chart.update({ tail: 'middle', critLow: lo, critHigh: hi });

    ann.selectAll('.prob-label, .prob-label-bg, .prob-leader, .crit-label, .crit-label-bg').remove();

    const [dMin, dMax] = xScale.domain();
    // Three probability pills: tails = α/2 (complement), middle = confidence.
    addProbPill(ann, frame, xScale, dMin, lo, alpha / 2, {
      isComplement: true, leaderEndY, editContainer: container,
      onEdit: (p) => setLevel(1 - 2 * p, true),
    });
    addProbPill(ann, frame, xScale, lo, hi, level, {
      isComplement: false, leaderEndY, editContainer: container,
      tip: 'Click to edit the confidence level',
      onEdit: (p) => setLevel(p, true),
    });
    addProbPill(ann, frame, xScale, hi, dMax, alpha / 2, {
      isComplement: true, leaderEndY, editContainer: container,
      onEdit: (p) => setLevel(1 - 2 * p, true),
    });

    // Editable critical-value boxes on the axis.
    for (const v of [lo, hi]) {
      addAxisValueBox(ann, frame, xScale, v, {
        editContainer: container,
        onEdit: (nv) => setLevel(levelForHalf(Math.abs(nv - center)), true),
      });
    }
  }

  /** Move the two boundary lines to the current level's critical values. */
  function positionBounds() {
    const { lo, hi } = critFor(level);
    loBound.line.attr('x1', xScale(lo)).attr('x2', xScale(lo));
    loBound.handle.attr('x', xScale(lo) - 22);
    hiBound.line.attr('x1', xScale(hi)).attr('x2', xScale(hi));
    hiBound.handle.attr('x', xScale(hi) - 22);
  }

  /**
   * Set the confidence level from an external control (box / pills) or an edit.
   * @param {number} newLevel
   * @param {boolean} [fireChange=true]
   * @param {boolean} [skipInput=false] - Leave the percent box alone (it is being typed in).
   */
  function setLevel(newLevel, fireChange = true, skipInput = false) {
    level = clampLevel(newLevel);
    positionBounds();
    updateShadeAndLabels();
    syncControls(skipInput);
    if (fireChange && onChange) onChange(level, invFn(1 - (1 - level) / 2) - center);
  }

  /**
   * Mirror the current level into the optional percent box and preset pills.
   * @param {boolean} [skipInput] - True while the user is typing in the box.
   */
  function syncControls(skipInput) {
    const pct = +(level * 100).toFixed(1);
    if (confInput && !skipInput) confInput.value = String(pct);
    if (confPills) {
      for (const b of confPills.querySelectorAll('button[data-level]')) {
        b.setAttribute('aria-pressed', String(Number(b.getAttribute('data-level')) === pct));
      }
    }
  }

  // The box is the source of truth while it is being typed in, so don't write back
  // to it (a half-typed "9" would be clamped to the minimum under the user's cursor).
  if (confInput) {
    bind(confInput, 'input', () => {
      const pct = Number(confInput.value);
      if (isFinite(pct)) setLevel(pct / 100, true, true);
    });
  }
  if (confPills) {
    bind(confPills, 'click', (e) => {
      const btn = /** @type {HTMLElement} */ (e.target).closest('button[data-level]');
      const pct = Number(btn?.getAttribute('data-level'));
      if (isFinite(pct)) setLevel(pct / 100, true);
    });
  }

  setLevel(level, false);

  return {
    setLevel,
    getLevel: () => level,
    getCrit: () => invFn(1 - (1 - level) / 2) - center,
  };
}
