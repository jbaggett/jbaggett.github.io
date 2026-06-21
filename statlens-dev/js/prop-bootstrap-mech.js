// @ts-check
/**
 * One-proportion bootstrap mechanism — make the resampling visible (feedback B2).
 *
 * The original sample is a fixed "bag" of n observations (successes + failures).
 * A bootstrap resample draws n of them WITH REPLACEMENT, so some are picked more
 * than once and some not at all, and p̂* varies from resample to resample.
 *
 * Two render styles are provided so we can compare them:
 *   - 'marbles' : a waffle grid of marbles (matches the Sampling Distribution Lab)
 *   - 'dots'    : small dots sitting on the amber/blue proportion bar
 *
 * CVD-safe Okabe-Ito colours: success = amber #C08700 (hatched), failure = blue #0072B2.
 */

import { prefersReducedMotion } from './chart-utils.js';

const MAX_MARBLES = 120;   // above this, marbles are unreadable → fall back to the bar
const MAX_FLY = 16;        // cap visibly-animated draws so the fly stays legible

/** Count successes (1s) in a binary array. */
function counts(data) {
  const s = data.reduce((a, v) => a + (v === 1 ? 1 : 0), 0);
  return { s, f: data.length - s, n: data.length };
}

/** Pick a marble size that keeps the whole bag visible for sample size n. */
function marbleSize(n) {
  if (n <= 40) return 16;
  if (n <= 70) return 13;
  if (n <= 100) return 11;
  return 9;
}

/**
 * Render the bag / a resample as a waffle of marbles: successes (amber) grouped
 * first, then failures (blue). Returns the grid element.
 * @param {number[]} data
 * @param {{label?: string}} [opts]
 */
function marbleGrid(data, opts = {}) {
  const { s, n } = counts(data);
  const grid = document.createElement('div');
  grid.className = 'pbm-grid';
  grid.setAttribute('role', 'img');
  grid.setAttribute('aria-label', opts.label || `${s} of ${n} successes`);
  const px = marbleSize(n);
  grid.style.setProperty('--pbm-marble', `${px}px`);
  // Aim for a roughly square waffle.
  const cols = Math.max(1, Math.round(Math.sqrt(n) * 1.3));
  grid.style.gridTemplateColumns = `repeat(${cols}, var(--pbm-marble))`;
  for (let i = 0; i < n; i++) {
    const m = document.createElement('span');
    m.className = 'pbm-marble ' + (i < s ? 'pbm-success' : 'pbm-failure');
    grid.appendChild(m);
  }
  return grid;
}

/**
 * Render the bag / a resample as dots sitting on a proportion bar. The bar is
 * split amber (success, width p̂) | blue (failure); n dots sit on top in a row
 * that wraps, successes over the amber region, failures over the blue region.
 * @param {number[]} data
 * @param {{label?: string}} [opts]
 */
function dotsBar(data, opts = {}) {
  const { s, f, n } = counts(data);
  const pct = n > 0 ? (s / n) * 100 : 0;
  const wrap = document.createElement('div');
  wrap.className = 'pbm-bar-wrap';
  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', opts.label || `${s} of ${n} successes`);
  wrap.innerHTML = `
    <div class="pbm-bar">
      <div class="pbm-bar-success" style="width:${pct}%"></div>
      <div class="pbm-bar-dots"></div>
      <span class="pbm-bar-tag pbm-bar-tag-l">${s} S</span>
      <span class="pbm-bar-tag pbm-bar-tag-r">${f} F</span>
    </div>`;
  const dotsLayer = wrap.querySelector('.pbm-bar-dots');
  for (let i = 0; i < n; i++) {
    const d = document.createElement('span');
    d.className = 'pbm-dot ' + (i < s ? 'pbm-success' : 'pbm-failure');
    dotsLayer.appendChild(d);
  }
  return wrap;
}

/**
 * Render the original "bag".
 * @param {HTMLElement} container
 * @param {number[]} data binary (1 = success, 0 = failure)
 * @param {{style?: 'marbles'|'dots', label?: string}} [opts]
 */
export function renderPropBag(container, data, opts = {}) {
  if (!container) return;
  container.innerHTML = '';
  const style = opts.style === 'dots' ? 'dots' : 'marbles';
  const useMarbles = style === 'marbles' && data.length <= MAX_MARBLES;
  const el = useMarbles
    ? marbleGrid(data, { label: opts.label || 'Original sample' })
    : dotsBar(data, { label: opts.label || 'Original sample' });
  el.classList.add('pbm-bag');
  container.appendChild(el);
}

/**
 * Render a resample in the same style as the bag.
 * @param {HTMLElement} container
 * @param {number[]} resample
 * @param {{style?: 'marbles'|'dots'}} [opts]
 */
export function renderPropResample(container, resample, opts = {}) {
  if (!container) return;
  container.innerHTML = '';
  const style = opts.style === 'dots' ? 'dots' : 'marbles';
  const useMarbles = style === 'marbles' && resample.length <= MAX_MARBLES;
  const el = useMarbles
    ? marbleGrid(resample, { label: 'Resample' })
    : dotsBar(resample, { label: 'Resample' });
  el.classList.add('pbm-resample');
  container.appendChild(el);
}

/**
 * Animate one bootstrap draw: pulse a sample of source marbles/dots in the bag
 * and fly clones into the resample, conveying "drawn with replacement". Then the
 * caller renders the final resample. Returns the animation duration (ms).
 * @param {HTMLElement} bagEl - container holding the bag
 * @param {HTMLElement} resampleEl - container that will hold the resample
 * @param {number[]} resample - the drawn values (for choosing matching sources)
 * @param {number[]} data - original sample (to locate success/failure sources)
 * @param {{style?: 'marbles'|'dots'}} [opts]
 * @returns {number} duration in ms
 */
export function animatePropDraw(bagEl, resampleEl, resample, data, opts = {}) {
  if (!bagEl || !resampleEl || prefersReducedMotion()) return 0;
  const cells = /** @type {HTMLElement[]} */ (Array.from(bagEl.querySelectorAll('.pbm-marble, .pbm-dot')));
  if (cells.length === 0) return 0;

  const { s } = counts(data);
  // Indices of success cells [0, s) and failure cells [s, n) in the grouped bag.
  const successCells = cells.slice(0, s);
  const failureCells = cells.slice(s);

  // Choose up to MAX_FLY draws to animate, matching each drawn value to a random
  // source cell of the same outcome (with replacement → repeats are fine).
  const k = Math.min(MAX_FLY, resample.length);
  const picks = [];
  for (let i = 0; i < k; i++) {
    const want = resample[Math.floor((i / k) * resample.length)];
    const pool = want === 1 ? successCells : failureCells;
    if (pool.length === 0) continue;
    // Vary the source by index so repeated turns don't look identical.
    picks.push(pool[(i * 7 + 3) % pool.length]);
  }

  const host = bagEl.closest('.mechanism-strip') || document.body;
  const hostRect = host.getBoundingClientRect();
  const destRect = resampleEl.getBoundingClientRect();
  const STAGGER = 26, FLY = 360;

  picks.forEach((src, i) => {
    const srcRect = src.getBoundingClientRect();
    // Pulse the source marble.
    setTimeout(() => { src.classList.add('pbm-pulse'); setTimeout(() => src.classList.remove('pbm-pulse'), 300); }, i * STAGGER);

    const clone = document.createElement('span');
    clone.className = 'pbm-flyer ' + (src.classList.contains('pbm-success') ? 'pbm-success' : 'pbm-failure');
    clone.style.left = `${srcRect.left - hostRect.left + srcRect.width / 2}px`;
    clone.style.top = `${srcRect.top - hostRect.top + srcRect.height / 2}px`;
    host.appendChild(clone);

    const dx = (destRect.left + destRect.width / 2) - (srcRect.left + srcRect.width / 2);
    const dy = (destRect.top + destRect.height / 2) - (srcRect.top + srcRect.height / 2);
    requestAnimationFrame(() => {
      setTimeout(() => {
        clone.style.transition = `transform ${FLY}ms cubic-bezier(.4,.7,.3,1), opacity ${FLY}ms ease`;
        clone.style.transform = `translate(${dx}px, ${dy}px) scale(0.7)`;
        clone.style.opacity = '0';
      }, i * STAGGER);
    });
    setTimeout(() => clone.remove(), i * STAGGER + FLY + 60);
  });

  return picks.length * STAGGER + FLY + 80;
}
