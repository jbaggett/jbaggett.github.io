// @ts-check
/**
 * One-proportion bootstrap mechanism — make the resampling visible (feedback B2).
 *
 * The original sample is a fixed "bag" of n observations (successes + failures).
 * A bootstrap resample draws n of them WITH REPLACEMENT: success squares fly in
 * and fill from the LEFT, failures from the RIGHT, meeting at the boundary — so
 * p̂* is where they converge. Some bag observations are picked more than once,
 * some not at all.
 *
 * Two matching styles (source and target share the same representation):
 *   - 'waffle' : both are marble waffles (matches the Sampling Distribution Lab)
 *   - 'bars'   : both are proportion bars built from n cells
 *
 * CVD-safe Okabe-Ito colours: success = amber #C08700 (hatched), failure = blue #0072B2.
 */

import { prefersReducedMotion } from './chart-utils.js';

const MAX_MARBLES = 120;   // above this, the waffle style falls back to bars
const MAX_FLY = 60;        // cap flying clones per draw (large n fills the rest instantly)

/** Count successes (1s) in a binary array. */
function counts(data) {
  const s = data.reduce((a, v) => a + (v === 1 ? 1 : 0), 0);
  return { s, f: data.length - s, n: data.length };
}

/** Pick a marble size that keeps the whole waffle visible for sample size n. */
function marbleSize(n) {
  if (n <= 40) return 16;
  if (n <= 70) return 13;
  if (n <= 100) return 11;
  return 9;
}

/** Resolve the effective style (waffle falls back to bars when n is too large). */
function effStyle(style, n) {
  const s = style === 'bars' ? 'bars' : 'waffle';
  return s === 'waffle' && n > MAX_MARBLES ? 'bars' : s;
}

// ── Slot builders (empty unless `data` given) ───────────────────────

/**
 * Build a marble waffle of n slots. Successes (amber) grouped first when filled.
 * @param {number} n
 * @param {{label?: string, data?: number[]}} [opts]
 * @returns {{el: HTMLElement, slots: HTMLElement[]}}
 */
function makeWaffle(n, opts = {}) {
  const el = document.createElement('div');
  el.className = 'pbm-grid';
  el.setAttribute('role', 'img');
  if (opts.label) el.setAttribute('aria-label', opts.label);
  el.style.setProperty('--pbm-marble', `${marbleSize(n)}px`);
  const cols = Math.max(1, Math.round(Math.sqrt(n) * 1.3)); // roughly square waffle
  el.style.gridTemplateColumns = `repeat(${cols}, var(--pbm-marble))`;
  return { el, slots: fillSlots(el, n, 'pbm-marble', opts.data) };
}

/**
 * Build a proportion bar of n cells. Successes (amber) on the left when filled.
 * @param {number} n
 * @param {{label?: string, data?: number[]}} [opts]
 * @returns {{el: HTMLElement, slots: HTMLElement[]}}
 */
function makeBar(n, opts = {}) {
  const el = document.createElement('div');
  el.className = 'pbm-fillbar' + (n > 60 ? ' pbm-fillbar-dense' : '');
  el.setAttribute('role', 'img');
  if (opts.label) el.setAttribute('aria-label', opts.label);
  return { el, slots: fillSlots(el, n, 'pbm-cell', opts.data) };
}

/** Append n slot spans to `el`; colour them if `data` is provided (else empty). */
function fillSlots(el, n, slotClass, data) {
  const s = data ? counts(data).s : -1;
  /** @type {HTMLElement[]} */
  const slots = [];
  for (let i = 0; i < n; i++) {
    const c = document.createElement('span');
    if (s < 0) c.className = `${slotClass} pbm-empty`;
    else c.className = `${slotClass} ` + (i < s ? 'pbm-success' : 'pbm-failure');
    el.appendChild(c);
    slots.push(c);
  }
  return slots;
}

/** Build a filled (static) representation in the given style. */
function makeFilled(data, style, label) {
  const n = data.length;
  return (effStyle(style, n) === 'bars'
    ? makeBar(n, { data, label })
    : makeWaffle(n, { data, label })).el;
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Render the original "bag".
 * @param {HTMLElement} container
 * @param {number[]} data binary (1 = success, 0 = failure)
 * @param {{style?: 'waffle'|'bars', label?: string}} [opts]
 */
export function renderPropBag(container, data, opts = {}) {
  if (!container) return;
  container.innerHTML = '';
  const el = makeFilled(data, opts.style, opts.label || 'Original sample');
  el.classList.add('pbm-bag');
  container.appendChild(el);
}

/** Render a resample statically (no animation). */
export function renderPropResample(container, resample, opts = {}) {
  if (!container) return;
  container.innerHTML = '';
  const el = makeFilled(resample, opts.style, 'Resample');
  el.classList.add('pbm-resample');
  container.appendChild(el);
}

/**
 * Show a resample. On +1 (animate), it fills from the two ends — successes from
 * the left, failures from the right — as squares fly in from the bag.
 * @param {HTMLElement} resampleEl
 * @param {HTMLElement} bagEl
 * @param {number[]} resample
 * @param {number[]} data - original sample
 * @param {{style?: 'waffle'|'bars', animate?: boolean}} [opts]
 * @returns {number} animation duration in ms
 */
export function showPropResample(resampleEl, bagEl, resample, data, opts = {}) {
  if (!resampleEl) return 0;
  const style = opts.style === 'bars' ? 'bars' : 'waffle';
  const animate = !!opts.animate && !prefersReducedMotion() && !!bagEl;
  if (!animate) { renderPropResample(resampleEl, resample, { style }); return 0; }
  return animateEndsFill(resampleEl, bagEl, resample, data, style);
}

/**
 * Build an empty resample (waffle or bar), then fill inward from the two ends as
 * squares fly in from matching slots in the bag (drawn with replacement).
 * @returns {number} duration ms
 */
function animateEndsFill(resampleEl, bagEl, resample, data, style) {
  const n = resample.length;
  const built = effStyle(style, n) === 'bars'
    ? makeBar(n, { label: 'Resample' })
    : makeWaffle(n, { label: 'Resample' });
  built.el.classList.add('pbm-resample');
  resampleEl.innerHTML = '';
  resampleEl.appendChild(built.el);
  const slots = built.slots;

  const bagCells = /** @type {HTMLElement[]} */ (Array.from(bagEl.querySelectorAll('.pbm-marble, .pbm-cell')));
  const sBag = counts(data).s;
  const successSrc = bagCells.slice(0, sBag);
  const failureSrc = bagCells.slice(sBag);

  // Assign each draw to a slot, filling inward from the two ends.
  let left = 0, right = n - 1;
  const steps = resample.map((v) => {
    const slotIdx = v === 1 ? left++ : right--;
    const pool = v === 1 ? successSrc : failureSrc;
    const src = pool.length ? pool[(slotIdx * 7 + 3) % pool.length] : null;
    return { v, slotIdx, src };
  });
  // Interleave the two ends so both advance together (sort by distance from an end).
  steps.sort((a, b) => Math.min(a.slotIdx, n - 1 - a.slotIdx) - Math.min(b.slotIdx, n - 1 - b.slotIdx));

  const host = bagEl.closest('.mechanism-strip') || document.body;
  const hostRect = host.getBoundingClientRect();
  const STAGGER = n <= 24 ? 32 : n <= 60 ? 16 : 8;
  const FLY = 320;
  let flyBudget = MAX_FLY;

  steps.forEach((step, i) => {
    const slot = slots[step.slotIdx];
    const cls = step.v === 1 ? 'pbm-success' : 'pbm-failure';
    const fly = step.src && flyBudget-- > 0;
    setTimeout(() => {
      if (!fly) { slot.classList.remove('pbm-empty'); slot.classList.add(cls); return; }
      step.src.classList.add('pbm-pulse');
      setTimeout(() => step.src.classList.remove('pbm-pulse'), 260);
      const sr = step.src.getBoundingClientRect();
      const dr = slot.getBoundingClientRect();
      const clone = document.createElement('span');
      clone.className = 'pbm-flyer ' + cls;
      clone.style.left = `${sr.left - hostRect.left + sr.width / 2}px`;
      clone.style.top = `${sr.top - hostRect.top + sr.height / 2}px`;
      host.appendChild(clone);
      const dx = (dr.left + dr.width / 2) - (sr.left + sr.width / 2);
      const dy = (dr.top + dr.height / 2) - (sr.top + sr.height / 2);
      requestAnimationFrame(() => {
        clone.style.transition = `transform ${FLY}ms cubic-bezier(.4,.7,.3,1)`;
        clone.style.transform = `translate(${dx}px, ${dy}px)`;
      });
      setTimeout(() => {
        clone.remove();
        slot.classList.remove('pbm-empty');
        slot.classList.add(cls);
      }, FLY);
    }, i * STAGGER);
  });

  return (n - 1) * STAGGER + FLY + 80;
}
