// @ts-check
/**
 * Watching a resample happen.
 *
 * The Sampling Distribution Lab's draw animation works because you see *which*
 * values were taken: flyers leave the population at the positions of the values
 * drawn, land on the sample's real dots, and leave footprints behind. The
 * bootstrap mechanism tried the same trick and could not do it honestly,
 * because it matched flyers to source dots **by value, round-robin**
 * (`bagSource` in js/dotplot-resample.js). Given three dots holding the same
 * number it would pick a different one each time — so the two facts that make a
 * bootstrap a bootstrap were invisible:
 *
 * - an observation drawn **twice** appeared as two different dots being taken
 *   once each, which is sampling *without* replacement
 * - observations **never drawn** were not marked at all, though on 200 paired
 *   differences that is about 73 of them
 *
 * Stage 1 of the mechanism plan fixed the underlying problem: `resampleOne` now
 * returns `indices`, so which observation was taken is a fact rather than a
 * guess. This spends that fact on the picture. Same provenance that corrected
 * the tally from "31 not selected" to 73.
 *
 * Three styles, for comparison on the dev site (`?draw=`). They differ only in
 * *when* each flyer leaves, which turns out to be the whole question:
 *
 * - **sequence** — one draw at a time. You watch a dot get picked, and picked
 *   *again*. The clearest account of "with replacement", and the slowest.
 * - **burst** — everything at once, with multiplicity shown as a ×N badge and
 *   absence as dimming. Fast; states the facts rather than performing them.
 * - **sweep** — ordered by where each value lands, so the resample builds up
 *   across the axis. Emphasises the shape forming over the individual picks.
 */

import { prefersReducedMotion } from '../settings.js';

/** Matches the existing resample flyer, so the styles differ in motion only. */
const FLY_COLOR = '#E07020';

/** @typedef {'classic'|'sequence'|'burst'|'sweep'} DrawStyle */

/**
 * Which style the URL asked for. `classic` is the animation that shipped, kept
 * as the baseline to compare against.
 *
 * @param {string} [search]
 * @returns {DrawStyle}
 */
export function drawStyleFromUrl(search) {
  const raw = new URLSearchParams(
    search ?? (typeof location === 'undefined' ? '' : location.search)).get('draw');
  return (raw === 'sequence' || raw === 'burst' || raw === 'sweep') ? raw : 'classic';
}

/**
 * How long each flyer waits before leaving, by style.
 *
 * @param {DrawStyle} style
 * @param {number} order - this flyer's place in the launch order
 * @param {number} total
 * @returns {{ delay: number, fly: number }}
 */
function timing(style, order, total) {
  if (style === 'sequence') {
    // Slow enough to follow one pick at a time, but n = 80 must not take a
    // minute, so the gap shrinks as the sample grows.
    const gap = total <= 20 ? 140 : total <= 40 ? 100 : 70;
    return { delay: order * gap, fly: 340 };
  }
  if (style === 'sweep') return { delay: order * 26, fly: 520 };
  return { delay: order * 10, fly: 600 };   // burst
}

/**
 * Animate a resample drawn from a rendered source dotplot.
 *
 * @param {object} opts
 * @param {Element[]} opts.sourceCircles - the source dots, in observation order
 * @param {Element[]} opts.targetDots - the resample's dots, in draw order
 * @param {number[]} opts.indices - which observation each draw took
 * @param {DrawStyle} opts.style
 * @param {SVGElement|null} [opts.targetSvg] - for the combine phase's mean marker
 * @param {() => void} [opts.onDone]
 * @returns {number} total duration in ms, 0 if it declined to run
 */
export function animateResampleDraw({ sourceCircles, targetDots, indices, style, targetSvg, onDone }) {
  if (prefersReducedMotion() || !indices?.length || !targetDots.length) return 0;
  if (indices.length !== targetDots.length) return 0;

  // How many times each observation was taken. This is the thing the old
  // value-matching could not know.
  const takenCount = new Array(sourceCircles.length).fill(0);
  for (const j of indices) if (j >= 0 && j < takenCount.length) takenCount[j]++;

  // Launch order. Sweep goes by where a flyer LANDS, so the resample fills in
  // across the axis; the others go in draw order.
  const order = targetDots.map((_, i) => i);
  if (style === 'sweep') {
    const x = (/** @type {number} */ i) => targetDots[i].getBoundingClientRect().left;
    order.sort((a, b) => x(a) - x(b));
  }

  /** @type {Array<{el: HTMLElement, sx:number, sy:number, ex:number, ey:number, dot: Element, src: Element|null, delay:number, fly:number}>} */
  const flyers = [];
  order.forEach((i, rank) => {
    const dot = targetDots[i];
    const src = sourceCircles[indices[i]] ?? null;
    const tr = dot.getBoundingClientRect();
    const ex = tr.left + tr.width / 2, ey = tr.top + tr.height / 2;
    const sz = Math.max(tr.width || 8, 7);
    let sx = ex, sy = ey - 60;
    if (src) {
      const sr = src.getBoundingClientRect();
      sx = sr.left + sr.width / 2;
      sy = sr.top + sr.height / 2;
    }
    const el = document.createElement('div');
    el.className = 'dpr-flyer';
    el.style.cssText = `position:fixed;left:${sx - sz / 2}px;top:${sy - sz / 2}px;`
      + `width:${sz}px;height:${sz}px;border-radius:50%;background:${FLY_COLOR};`
      + `z-index:1000;pointer-events:none;opacity:0;`;
    document.body.appendChild(el);
    /** @type {SVGElement} */ (dot).style.opacity = '0';
    const t = timing(style, rank, targetDots.length);
    flyers.push({ el, sx, sy, ex, ey, dot, src, delay: t.delay, fly: t.fly });
  });

  // Never taken: say so. On a real sample this is roughly a third of the dots,
  // and it is half of what "with replacement" means.
  sourceCircles.forEach((c, j) => {
    if (takenCount[j] === 0) /** @type {SVGElement} */ (c).classList.add('dpr-untaken');
  });

  // Taken more than once: say that too. Burst has no time to show a dot being
  // picked twice, so it labels instead.
  if (style === 'burst') {
    takenCount.forEach((n, j) => { if (n > 1) badge(sourceCircles[j], n); });
  }

  // The resample's mean is the POINT of the resample, so it should arrive as a
  // result rather than be sitting there before the dots have landed. Hidden
  // with opacity rather than display, so its position stays measurable.
  const overlays = targetSvg?.querySelector('.overlays');
  if (overlays) /** @type {SVGElement} */ (overlays).style.opacity = '0';

  const COMBINE_HOLD = 160, COMBINE = 520, SETTLE = 240;
  const flightMs = Math.max(...flyers.map(f => f.delay + f.fly)) + 120;
  const total = flightMs + (overlays ? COMBINE_HOLD + COMBINE + SETTLE : 0);
  const t0 = performance.now();
  const ease = (/** @type {number} */ t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  function step(now) {
    const elapsed = now - t0;
    let running = false;
    for (const f of flyers) {
      const t = (elapsed - f.delay) / f.fly;
      if (t < 0) { running = true; continue; }
      if (t >= 1) {
        // Reveal the dot it landed on, but KEEP the flyer: the combine phase
        // gathers these same flyers into the mean. Removing them here left it
        // nothing to gather.
        /** @type {SVGElement} */ (f.dot).style.removeProperty('opacity');
        if (!overlays && f.el.isConnected) f.el.remove();
        continue;
      }
      running = true;
      if (f.el.style.opacity !== '1') {
        f.el.style.opacity = '1';
        // A pick is worth seeing at its source, not only at its destination.
        if (f.src && style !== 'burst') pulse(f.src);
      }
      const e = ease(t);
      f.el.style.left = `${f.sx + (f.ex - f.sx) * e - f.el.offsetWidth / 2}px`;
      f.el.style.top = `${f.sy + (f.ey - f.sy) * e - f.el.offsetHeight / 2}px`;
    }
    if (running) { requestAnimationFrame(step); return; }
    for (const f of flyers) /** @type {SVGElement} */ (f.dot).style.removeProperty('opacity');
    // Landed flyers sit exactly on the revealed dots; dim them so the resample
    // reads as blue dots until they lift off again to be combined.
    if (overlays) for (const f of flyers) f.el.style.opacity = '0.55';
    if (overlays) {
      setTimeout(() => combineInto(flyers.map(f => f.el), overlays, COMBINE, SETTLE, onDone),
        COMBINE_HOLD);
    } else {
      for (const f of flyers) f.el.remove();
      onDone?.();
    }
  }
  requestAnimationFrame(step);
  return total;
}

/**
 * Gather the landed flyers into the resample's mean, then reveal it.
 *
 * The same move the Sampling Distribution Lab makes after a draw: the dots slide
 * to the statistic's position and pile into one, so the statistic is seen being
 * *computed from* the sample rather than appearing beside it. Costs about a
 * second, which is the point — it is the step a student is being asked to
 * understand.
 *
 * @param {HTMLElement[]} els - the landed flyers
 * @param {Element} overlays - the target's overlay group, holding the mean marker
 * @param {number} dur
 * @param {number} settle
 * @param {(() => void)} [onDone]
 */
function combineInto(els, overlays, dur, settle, onDone) {
  const line = overlays.querySelector('line');
  const box = (line ?? overlays).getBoundingClientRect();
  const targetX = box.left + box.width / 2;
  const starts = els.map(el => ({
    x: parseFloat(el.style.left) + el.offsetWidth / 2,
    y: parseFloat(el.style.top) + el.offsetHeight / 2,
  }));
  const targetY = starts.reduce((s, p) => s + p.y, 0) / starts.length;
  const t0 = performance.now();

  function step(now) {
    const t = Math.min((now - t0) / dur, 1);
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    els.forEach((el, i) => {
      const sz = el.offsetWidth;
      el.style.left = `${starts[i].x + (targetX - starts[i].x) * e - sz / 2}px`;
      el.style.top = `${starts[i].y + (targetY - starts[i].y) * e - sz / 2}px`;
      // Everything but the first fades as it merges, so one dot is left.
      if (i > 0) el.style.opacity = String(1 - e);
    });
    if (t < 1) { requestAnimationFrame(step); return; }
    for (let i = 1; i < els.length; i++) els[i].remove();
    const merged = els[0];
    if (merged) {
      merged.style.transition = `transform ${settle}ms ease-out, opacity ${settle}ms ease-out`;
      merged.style.transform = 'scale(1.6)';
    }
    /** @type {SVGElement} */ (overlays).style.transition = 'opacity 220ms ease-in';
    /** @type {SVGElement} */ (overlays).style.removeProperty('opacity');
    setTimeout(() => {
      if (merged) { merged.style.opacity = '0'; setTimeout(() => merged.remove(), settle); }
      onDone?.();
    }, settle);
  }
  requestAnimationFrame(step);
}

/** A brief flash at a source dot as it is drawn from. */
function pulse(circle) {
  circle.classList.remove('dpr-picked');
  // Reflow, so a second pick on the same dot restarts the animation rather than
  // being swallowed — which is exactly the case worth seeing.
  void /** @type {HTMLElement} */ (circle).getBoundingClientRect();
  circle.classList.add('dpr-picked');
}

/** "×3" beside a dot taken more than once. */
function badge(circle, n) {
  if (!circle) return;
  const svg = /** @type {SVGGraphicsElement} */ (circle).ownerSVGElement;
  const parent = circle.parentNode;
  if (!svg || !parent) return;
  const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  t.setAttribute('class', 'dpr-badge');
  t.setAttribute('x', String(Number(circle.getAttribute('cx')) + 5));
  t.setAttribute('y', String(Number(circle.getAttribute('cy')) - 4));
  t.textContent = `×${n}`;
  parent.appendChild(t);
}

/** Clear the marks a previous draw left on the source. */
export function clearDrawMarks(root) {
  if (!root) return;
  root.querySelectorAll('.dpr-untaken').forEach(el => el.classList.remove('dpr-untaken'));
  root.querySelectorAll('.dpr-picked').forEach(el => el.classList.remove('dpr-picked'));
  root.querySelectorAll('.dpr-badge').forEach(el => el.remove());
}
