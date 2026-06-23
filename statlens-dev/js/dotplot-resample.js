// @ts-check
/**
 * Shared "draw values into a dotplot" mechanism for MEANS — one visual family for
 * sampling, bootstrap, and randomization (replaces the per-scenario dotplots).
 *
 * Built on the existing `drawDotplot` (so there is ONE dotplot renderer) plus a
 * generalized version of the Sampling Lab's pluck-and-fly animation: items appear
 * at a source position, fly onto the target dotplot's dots, and the dots are
 * revealed as they land. Footprints mark the source; an optional combine phase
 * converges the flyers to the mean.
 *
 * Parameters carry the per-scenario differences:
 *   - the source (a population, the original sample, or the null-shifted sample),
 *     supplied as a `sourceAt(value, i)` → screen point function;
 *   - with vs without replacement is just how the caller maps draws to sources.
 */

import { drawDotplot, computeDots } from './dotplot.js';
import { prefersReducedMotion } from './chart-utils.js';
import * as d3Selection from 'd3-selection';

const COMPACT = { showExport: false, animate: false, labels: 'none' };
const FLY_COLOR = '#E07020';   // orange flyer (matches the Sampling Lab)

/**
 * Draw a compact mechanism dotplot (bag, sample, or resample) via drawDotplot.
 * Pass a shared `binWidth`/`binOrigin` and `dotRadius` so related plots align.
 * @param {HTMLElement} container
 * @param {number[]} values
 * @param {{ id?: string, domain?: [number,number], binWidth?: number, binOrigin?: number,
 *   dotRadius?: number, sizingMaxStack?: number, mean?: number, meanLabel?: string,
 *   xLabel?: string, viewHeight?: number, fillColor?: string }} [opts]
 */
export function drawMechDotplot(container, values, opts = {}) {
  if (container) container.innerHTML = ''; // drawDotplot/createChart appends — clear first
  return drawDotplot(container, values, {
    ...COMPACT,
    forceDotMode: true,
    id: opts.id,
    domain: opts.domain,
    binWidth: opts.binWidth,
    binOrigin: opts.binOrigin,
    dotRadius: opts.dotRadius,
    sizingMaxStack: opts.sizingMaxStack,
    fillColor: opts.fillColor,
    observedStat: opts.mean,
    observedLabel: opts.meanLabel ?? 'x̄',
    xLabel: opts.xLabel ?? '',
    // A narrow, taller viewBox so the dotplot fills the ~300px mechanism panel at
    // close to 1:1 (a 600-wide viewBox displayed in a 300px panel halves the dots).
    viewWidth: opts.viewWidth ?? 320,
    viewHeight: opts.viewHeight ?? 150,
  });
}

/** Convert an SVG-inner-group local coordinate to a viewport (fixed) point. */
function localToScreen(innerGroup, x, y) {
  const svg = innerGroup.ownerSVGElement;
  const ctm = innerGroup.getScreenCTM();
  if (!svg || !ctm) return { x: 0, y: 0 };
  const pt = svg.createSVGPoint();
  pt.x = x; pt.y = y;
  const s = pt.matrixTransform(ctm);
  return { x: s.x, y: s.y };
}

/**
 * Build a `sourceAt` function for a dotplot "bag": each drawn value flies from a
 * dot in the bag with the same value (round-robin across equal-valued dots so
 * repeated draws spread their footprints). Returns null sources gracefully.
 * @param {ReturnType<typeof drawDotplot>} bag
 * @returns {(value:number)=>{x:number,y:number}|null}
 */
export function bagSource(bag) {
  const svg = bag?.frame?.inner?.ownerSVGElement;
  const circles = svg ? Array.from(svg.querySelectorAll('.data circle')) : [];
  // bag.dots[i] ↔ circles[i] (same computeDots order). Group circles by value.
  /** @type {Map<number, Element[]>} */
  const byVal = new Map();
  bag?.dots?.forEach((d, i) => {
    if (!circles[i]) return;
    const arr = byVal.get(d.value) || [];
    arr.push(circles[i]);
    byVal.set(d.value, arr);
  });
  /** @type {Map<number, number>} */
  const cursor = new Map();
  return (value) => {
    const arr = byVal.get(value);
    if (!arr || !arr.length) return null;
    const k = (cursor.get(value) ?? 0) % arr.length;
    cursor.set(value, k + 1);
    const r = arr[k].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
}

/**
 * Animate drawing `values` into a freshly-drawn target dotplot: hide its dots,
 * fly an orange clone from each value's source onto its target dot, reveal the
 * dot on landing, and stamp a footprint at the source.
 * @param {ReturnType<typeof drawDotplot>} target - the resample dotplot (already drawn)
 * @param {number[]} values - the resample values (same array used to draw `target`)
 * @param {(value:number, i:number)=>({x:number,y:number}|null)} sourceAt
 * @param {{ footprints?: boolean }} [opts]
 * @returns {number} duration ms
 */
export function animateDrawInto(target, values, sourceAt, opts = {}) {
  const svg = target?.frame?.inner?.ownerSVGElement;
  const circles = svg ? Array.from(svg.querySelectorAll('.data circle')) : [];
  if (prefersReducedMotion() || !circles.length || circles.length !== values.length) return 0;

  // computeDots order == circle order; align each circle to its value.
  const info = computeDots(values, { domain: target.frame ? undefined : undefined, binWidth: target.binWidth });
  circles.forEach(c => { /** @type {SVGElement} */ (c).style.opacity = '0'; });

  /** @type {Array<{el: HTMLElement, sx:number, sy:number, ex:number, ey:number, circle: Element, foot:boolean}>} */
  const flyers = [];
  for (let i = 0; i < circles.length; i++) {
    const value = info.dots[i]?.value ?? values[i];
    const src = sourceAt(value, i);
    const tr = circles[i].getBoundingClientRect();
    const ex = tr.left + tr.width / 2, ey = tr.top + tr.height / 2;
    const sz = Math.max(tr.width || 8, 7);
    const el = document.createElement('div');
    el.className = 'dpr-flyer';
    const sx = src ? src.x : ex, sy = src ? src.y : ey - 60;
    el.style.cssText = `position:fixed;left:${sx - sz / 2}px;top:${sy - sz / 2}px;`
      + `width:${sz}px;height:${sz}px;border-radius:50%;background:${FLY_COLOR};`
      + `z-index:1000;pointer-events:none;opacity:0;transition:opacity .15s ease-in;`;
    document.body.appendChild(el);
    flyers.push({ el, sx, sy, ex, ey, circle: circles[i], foot: !!src });
  }

  requestAnimationFrame(() => flyers.forEach(f => { f.el.style.opacity = '1'; }));
  const FLY = 620, HOLD = 320;

  setTimeout(() => {
    if (opts.footprints !== false) stampFootprints(flyers);
    const t0 = performance.now();
    const ease = (/** @type {number} */ t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    function step(now) {
      const t = Math.min((now - t0) / FLY, 1);
      const e = ease(t);
      for (const f of flyers) {
        f.el.style.left = `${f.sx + (f.ex - f.sx) * e - (f.el.offsetWidth / 2)}px`;
        f.el.style.top = `${f.sy + (f.ey - f.sy) * e - (f.el.offsetHeight / 2)}px`;
      }
      if (t < 1) { requestAnimationFrame(step); return; }
      // Reveal the real dots; remove the flyers.
      for (const f of flyers) { /** @type {SVGElement} */ (f.circle).style.removeProperty('opacity'); f.el.remove(); }
    }
    requestAnimationFrame(step);
  }, HOLD);

  return HOLD + FLY + 80;
}

/** Stamp faded squares at each flyer's source (cleared by the next draw). */
function stampFootprints(flyers) {
  document.querySelectorAll('.dpr-footprint').forEach(g => g.remove());
  for (const f of flyers) {
    if (!f.foot) continue;
    const g = document.createElement('div');
    g.className = 'dpr-footprint';
    g.style.cssText = `position:fixed;left:${f.sx - 5}px;top:${f.sy - 5}px;width:10px;height:10px;`
      + `border-radius:2px;background:${FLY_COLOR};opacity:0.28;z-index:999;pointer-events:none;`;
    document.body.appendChild(g);
  }
  // Footprints are viewport-fixed; fade them out shortly after.
  setTimeout(() => {
    document.querySelectorAll('.dpr-footprint').forEach(g => {
      const el = /** @type {HTMLElement} */ (g);
      el.style.transition = 'opacity .4s ease';
      el.style.opacity = '0';
      setTimeout(() => g.remove(), 400);
    });
  }, 1400);
}

/**
 * Convenience for the common case: draw the resample dotplot (sharing the bag's
 * bin grid + dot size) and animate the draw from the bag. Returns ms.
 * @param {HTMLElement} container
 * @param {ReturnType<typeof drawDotplot>} bag
 * @param {number[]} resample
 * @param {{ domain:[number,number], mean?:number, meanLabel?:string, animate?:boolean,
 *   sizingMaxStack?:number }} opts
 */
export function showResampleDotplot(container, bag, resample, opts) {
  const target = drawMechDotplot(container, resample, {
    domain: opts.domain,
    binWidth: bag.binWidth,
    dotRadius: bag.dotRadius,
    sizingMaxStack: opts.sizingMaxStack,
    mean: opts.mean,
    meanLabel: opts.meanLabel,
  });
  if (!opts.animate || prefersReducedMotion()) return 0;
  return animateDrawInto(target, resample, bagSource(bag));
}
