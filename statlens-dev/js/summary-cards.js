// @ts-check
/**
 * Shared "summary cards" resampling view for MEANS (and paired differences).
 *
 * The resample is shown as the ORIGINAL value chips, each annotated with how many
 * times it was drawn (×N) or greyed as "not selected" — the clearest way to see
 * draw-with-replacement. On +1 the drawn chips fly from the bag's chips.
 *
 * Used by the one-sample bootstrap CI (sim-app) and the one-mean randomization
 * test (one-sample-sim); for the randomization test the values passed in are the
 * NULL-SHIFTED sample, so the same component serves both.
 */

import { prefersReducedMotion } from './chart-utils.js';

/** Summary cards stay legible up to this many observations. */
export const CHIP_MAX = 30;

/** Default chip text: integers as-is, else a fixed-precision value. */
function defaultFormat(v) {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

/**
 * Render the "bag" as plain value chips (sorted). Returns the chip elements in
 * sorted order (so a resample fly can map originalValues[i] → chip i).
 * @param {HTMLElement} container
 * @param {number[]} values
 * @param {{ formatValue?: (v:number)=>string, label?: string }} [opts]
 * @returns {HTMLElement[]}
 */
export function renderBagChips(container, values, opts = {}) {
  if (!container) return [];
  container.innerHTML = '';
  const fmt = opts.formatValue || defaultFormat;
  const wrap = document.createElement('div');
  wrap.className = 'sample-dots';
  wrap.setAttribute('role', 'img');
  if (opts.label) wrap.setAttribute('aria-label', opts.label);
  const chips = [...values].sort((a, b) => a - b).map((v) => {
    const d = document.createElement('span');
    d.className = 'sample-dot';
    d.textContent = fmt(v);
    d.title = String(v);
    wrap.appendChild(d);
    return d;
  });
  container.appendChild(wrap);
  return chips;
}

/**
 * Render the resample as annotated original-value chips (×N / not-selected). When
 * `animate`, the drawn chips fly in one-by-one from `sourceChips` (the bag chips).
 * @param {HTMLElement} container
 * @param {number[]} originalValues - the bag values (same set the resample drew from)
 * @param {number[]} resample
 * @param {{ formatValue?: (v:number)=>string, sourceChips?: HTMLElement[], animate?: boolean }} [opts]
 * @returns {number} animation duration ms
 */
export function renderResampleChips(container, originalValues, resample, opts = {}) {
  if (!container) return 0;
  container.innerHTML = '';
  const fmt = opts.formatValue || defaultFormat;
  const wrap = document.createElement('div');
  wrap.className = 'sample-dots';
  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', 'Resample (chips annotated with how many times each value was drawn)');

  /** @type {Map<number, number>} */
  const counts = new Map();
  for (const v of resample) counts.set(v, (counts.get(v) ?? 0) + 1);
  const sorted = [...originalValues].sort((a, b) => a - b);
  const remaining = new Map(counts);
  /** @type {Map<number, number>} */
  const positionsLeft = new Map();
  for (const v of sorted) positionsLeft.set(v, (positionsLeft.get(v) ?? 0) + 1);

  const fly = !!opts.animate && !prefersReducedMotion();
  /** @type {{dot: HTMLElement, idx: number}[]} */
  const drawn = [];

  sorted.forEach((v, idx) => {
    const rem = remaining.get(v) ?? 0;
    const pLeft = positionsLeft.get(v) ?? 1;
    const allocated = Math.ceil(rem / pLeft); // spread a value's draws across its equal chips
    const d = document.createElement('span');
    d.className = 'sample-dot' + (allocated === 0 ? ' not-drawn' : allocated > 1 ? ' multi-drawn' : '');
    d.textContent = fmt(v);
    d.title = allocated === 0 ? 'Not selected' : allocated === 1 ? 'Selected once' : `Selected ${allocated} times`;
    if (allocated > 1) {
      const badge = document.createElement('sup');
      badge.className = 'draw-count';
      badge.textContent = `×${allocated}`;
      d.appendChild(badge);
    }
    if (fly) { d.classList.add('chip-hidden'); if (allocated > 0) drawn.push({ dot: d, idx }); }
    wrap.appendChild(d);
    remaining.set(v, rem - allocated);
    positionsLeft.set(v, pLeft - 1);
  });
  container.appendChild(wrap);
  if (!fly) return 0;

  // Not-selected chips appear immediately (greyed); drawn chips fly from the bag.
  wrap.querySelectorAll('.not-drawn.chip-hidden').forEach((d) => {
    d.classList.remove('chip-hidden'); d.classList.add('chip-appear');
  });

  const STAGGER = 60, FLIGHT = 250;
  drawn.forEach(({ dot, idx }, i) => {
    const src = opts.sourceChips && opts.sourceChips[idx];
    setTimeout(() => {
      if (!src) { dot.classList.remove('chip-hidden'); dot.classList.add('chip-appear'); return; }
      src.classList.add('chip-source-flash');
      setTimeout(() => src.classList.remove('chip-source-flash'), 400);
      const o = src.getBoundingClientRect();
      const dr = dot.getBoundingClientRect();
      const flyer = document.createElement('span');
      flyer.className = 'chip-flyer';
      flyer.textContent = (dot.textContent || '').replace(/×\d+$/, '');
      flyer.style.left = `${o.left}px`;
      flyer.style.top = `${o.top}px`;
      flyer.style.width = `${o.width}px`;
      flyer.style.height = `${o.height}px`;
      document.body.appendChild(flyer);
      void flyer.offsetHeight;
      flyer.style.transition = `left ${FLIGHT}ms cubic-bezier(.4,0,.2,1), top ${FLIGHT}ms cubic-bezier(.4,0,.2,1), opacity ${FLIGHT * 0.3}ms ease ${FLIGHT * 0.7}ms`;
      flyer.style.left = `${dr.left}px`;
      flyer.style.top = `${dr.top}px`;
      flyer.style.opacity = '0';
      setTimeout(() => { dot.classList.remove('chip-hidden'); dot.classList.add('chip-appear'); flyer.remove(); }, FLIGHT);
    }, i * STAGGER);
  });
  return drawn.length * STAGGER + FLIGHT + 60;
}
