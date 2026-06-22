// @ts-check
/**
 * One-sample mean bootstrap mechanism — make the resampling visible (feedback B1).
 *
 * The original sample is a fixed dotplot of n values on a shared axis. A bootstrap
 * resample draws n of them WITH REPLACEMENT: each drawn dot flies from its position
 * in the original up into the resample dotplot at the SAME x and stacks — so some
 * values are picked more than once (taller stacks) and some not at all (gaps). The
 * resample mean (dashed line) wanders from resample to resample.
 *
 * This is the means counterpart of the proportion "marbles" mechanism (B2). It is
 * used for small samples; large samples keep the histogram view.
 */

import { prefersReducedMotion } from './chart-utils.js';

const PAD = 8;          // horizontal padding inside the plot
const DOT = 11;         // dot diameter (px)
const MAX_FLY = 40;     // cap flying clones per resample

/** Mean of a numeric array. */
function mean(a) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0; }

/**
 * Lay out a dotplot: sort values, bin into pixel columns of width DOT, stack.
 * @param {number[]} values
 * @param {[number, number]} domain
 * @param {number} width
 * @returns {{items: {v:number,x:number,level:number}[], maxLevel:number, xOf:(v:number)=>number}}
 */
function layout(values, domain, width) {
  const [lo, hi] = domain;
  const range = (hi - lo) || 1;
  const xOf = (/** @type {number} */ v) => PAD + ((v - lo) / range) * (width - 2 * PAD);
  const clamp = (/** @type {number} */ x) => Math.max(PAD, Math.min(width - PAD, x));
  /** @type {Map<number, number>} */
  const colCount = new Map();
  const items = [...values].sort((a, b) => a - b).map((v) => {
    // Bin to a DOT-wide column and stack at the COLUMN CENTRE so dots form clean
    // vertical stacks (not jittered by each value's exact position within the bin).
    const col = Math.round(xOf(v) / DOT);
    const level = colCount.get(col) ?? 0;
    colCount.set(col, level + 1);
    return { v, x: clamp(col * DOT), level };
  });
  const maxLevel = Math.max(0, ...items.map(i => i.level));
  return { items, maxLevel, xOf };
}

/**
 * Render a dotplot (the bag or a resample) into `container`. Returns the plot
 * geometry plus per-dot elements (so the resample can fly from matching bag dots).
 * @param {HTMLElement} container
 * @param {number[]} values
 * @param {{domain: [number,number], width?: number, label?: string, showMean?: boolean, empty?: boolean}} opts
 */
function renderDotplot(container, values, opts) {
  const width = opts.width || container.clientWidth || 240;
  const { items, maxLevel, xOf } = layout(values, opts.domain, width);
  // Fixed shared height (capacity) keeps the baseline put as stacks vary, so the
  // original and resample plots stay aligned. Taller resample stacks overflow
  // upward (the baseline doesn't move).
  const cap = Math.max(opts.capacity ?? maxLevel, maxLevel);
  const plotH = (cap + 1) * DOT + 4;

  const plot = document.createElement('div');
  plot.className = 'mbm-plot';
  plot.style.height = `${plotH + 14}px`;
  plot.setAttribute('role', 'img');
  if (opts.label) plot.setAttribute('aria-label', opts.label);

  /** @type {HTMLElement[]} */
  const dots = [];
  if (!opts.empty) {
    for (const it of items) {
      const d = document.createElement('span');
      d.className = 'mbm-dot';
      d.style.left = `${it.x - DOT / 2}px`;
      d.style.bottom = `${14 + it.level * DOT}px`;
      plot.appendChild(d);
      dots.push(d);
    }
    if (opts.showMean !== false) addMeanMarker(plot, xOf(mean(values)), plotH);
  }
  container.innerHTML = '';
  container.appendChild(plot);
  return { plot, dots, xOf, plotH, width, maxLevel };
}

/** Dashed vertical mean marker + small triangle on the axis. */
function addMeanMarker(plot, x, plotH) {
  const line = document.createElement('span');
  line.className = 'mbm-mean';
  line.style.left = `${x}px`;
  line.style.height = `${plotH}px`;
  plot.appendChild(line);
}

/**
 * Render the original "bag" as a dotplot.
 * @param {HTMLElement} container
 * @param {number[]} data
 * @param {{domain: [number,number], label?: string}} opts
 * @returns {ReturnType<typeof renderDotplot>}
 */
export function renderMeanBag(container, data, opts) {
  const width = opts.width || container.clientWidth || 240;
  // Size the plot once from the original, with headroom so resamples (which can
  // stack a value higher than the original) keep a stable baseline.
  const baseMax = layout(data, opts.domain, width).maxLevel;
  const capacity = Math.ceil(baseMax * 1.8) + 2;
  const res = renderDotplot(container, data, {
    domain: opts.domain, label: opts.label || 'Original sample', width, capacity,
  });
  return { ...res, bagValues: [...data], capacity, width };
}

/**
 * Show a resample dotplot. On +1 (animate), dots fly from matching bag dots into
 * the resample, stacking; otherwise render statically.
 * @param {HTMLElement} resampleEl
 * @param {object} bag - the object returned by renderMeanBag
 * @param {number[]} resample
 * @param {{domain: [number,number], animate?: boolean}} opts
 * @returns {number} duration ms
 */
export function showMeanResample(resampleEl, bag, resample, opts) {
  // Share the bag's width + capacity so the two plots stay aligned (same scale,
  // same baseline) regardless of how the resample's stacks vary.
  const width = (bag && bag.width) || resampleEl.clientWidth || 240;
  const capacity = (bag && bag.capacity) ?? 0;
  const animate = !!opts.animate && !prefersReducedMotion() && bag && bag.dots && bag.dots.length;
  if (!animate) {
    renderDotplot(resampleEl, resample, { domain: opts.domain, label: 'Resample', width, capacity });
    return 0;
  }

  // Build the target layout, then place each dot empty and fly into it.
  const { items, maxLevel, xOf } = layout(resample, opts.domain, width);
  const cap = Math.max(capacity, maxLevel);
  const plotH = (cap + 1) * DOT + 4;
  const plot = document.createElement('div');
  plot.className = 'mbm-plot';
  plot.style.height = `${plotH + 14}px`;
  plot.setAttribute('role', 'img');
  plot.setAttribute('aria-label', 'Resample');
  resampleEl.innerHTML = '';
  resampleEl.appendChild(plot);

  // Map each original value → a bag dot (for the fly source).
  /** @type {Map<number, HTMLElement>} */
  const bagDotByValue = new Map();
  // bag.dots are in sorted order of the bag values; rebuild value→dot.
  const bagSorted = [...(bag.bagValues || [])].sort((a, b) => a - b);
  bag.dots.forEach((d, i) => { if (!bagDotByValue.has(bagSorted[i])) bagDotByValue.set(bagSorted[i], d); });

  const host = resampleEl.closest('.mechanism-strip') || document.body;
  const hostRect = host.getBoundingClientRect();
  const plotRect = plot.getBoundingClientRect();
  const FLY = 340;
  const FILL_WINDOW = Math.min(1100, Math.max(1, items.length - 1) * 60);
  const per = items.length > 1 ? FILL_WINDOW / (items.length - 1) : 0;
  const cloneEvery = Math.max(1, Math.ceil(items.length / MAX_FLY));

  items.forEach((it, i) => {
    const targetX = it.x - DOT / 2;
    const targetBottom = 14 + it.level * DOT;
    const place = () => {
      const d = document.createElement('span');
      d.className = 'mbm-dot';
      d.style.left = `${targetX}px`;
      d.style.bottom = `${targetBottom}px`;
      plot.appendChild(d);
      if (i === items.length - 1) addMeanMarker(plot, xOf(mean(resample)), plotH);
    };
    const src = bagDotByValue.get(it.v);
    const fly = src && i % cloneEvery === 0;
    setTimeout(() => {
      if (!fly) { place(); return; }
      src.classList.add('mbm-pulse');
      setTimeout(() => src.classList.remove('mbm-pulse'), 260);
      const sr = src.getBoundingClientRect();
      const destLeft = plotRect.left + targetX + DOT / 2;
      const destTop = plotRect.bottom - targetBottom - DOT / 2;
      const clone = document.createElement('span');
      clone.className = 'mbm-flyer';
      clone.style.left = `${sr.left - hostRect.left + sr.width / 2}px`;
      clone.style.top = `${sr.top - hostRect.top + sr.height / 2}px`;
      host.appendChild(clone);
      const dx = destLeft - (sr.left + sr.width / 2);
      const dy = destTop - (sr.top + sr.height / 2);
      const arc = Math.min(50, 20 + Math.abs(dy) * 0.2);
      clone.animate([
        { transform: 'translate(0,0)' },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - arc}px)`, offset: 0.5 },
        { transform: `translate(${dx}px, ${dy}px)` },
      ], { duration: FLY, easing: 'cubic-bezier(.45,.05,.4,1)', fill: 'forwards' });
      setTimeout(() => { clone.remove(); place(); }, FLY);
    }, i * per);
  });

  return FILL_WINDOW + FLY + 80;
}
