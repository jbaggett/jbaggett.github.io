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
import { animateResampleDraw, drawStyleFromUrl, clearDrawMarks } from './mechanisms/draw-animation.js';
import { prefersReducedMotion } from './chart-utils.js';
import * as d3Selection from 'd3-selection';

const COMPACT = { showExport: false, animate: false, labels: 'none' };
const FLY_COLOR = '#E07020';   // orange flyer (matches the Sampling Lab)
// Common display width for every mechanism dotplot, so dots are the SAME size on
// every page regardless of how wide the host panel is (the CI and randomization
// strips have different panel widths). Centered within the panel.
const MECH_DISPLAY_W = 300;
/**
 * How wide a mechanism dotplot may grow when its panel has the room.
 *
 * The 300px floor above was chosen for the side-by-side strip, where two panels
 * share the width. It then applied everywhere, so a plot sat at 300px inside a
 * 491px panel (strip) or a 436px one (tiers) — a third of the space empty, on
 * the one plot whose job is to let you pick out individual dots. Measured and
 * clamped now; the ceiling keeps a very wide screen from stretching a 54-dot
 * sample across half a metre. (Jeff, 2026-09-28.)
 */
const MECH_DISPLAY_MAX = 520;

/**
 * The width a mechanism dotplot should draw at inside `panel`.
 *
 * Returns the floor when the panel cannot be measured — which is the normal
 * case for a panel that is still `hidden`, so callers that have a better number
 * (the shared scale) should pass it rather than measure a hidden box.
 *
 * @param {Element|null|undefined} panel
 * @returns {number}
 */
export function mechDisplayWidth(panel) {
  const w = panel?.getBoundingClientRect?.().width ?? 0;
  if (!(w > MECH_DISPLAY_W)) return MECH_DISPLAY_W;
  return Math.round(Math.min(w, MECH_DISPLAY_MAX));
}

/**
 * Draw a compact mechanism dotplot (bag, sample, or resample) via drawDotplot.
 * Pass a shared `binWidth`/`binOrigin` and `dotRadius` so related plots align.
 * @param {HTMLElement} container
 * @param {number[]} values
 * @param {{ id?: string, domain?: [number,number], binWidth?: number, binOrigin?: number,
 *   dotRadius?: number, sizingMaxStack?: number, mean?: number, meanLabel?: string,
 *   xLabel?: string, viewHeight?: number, viewWidth?: number, displayWidth?: number,
 *   fillColor?: string }} [opts]
 */
export function drawMechDotplot(container, values, opts = {}) {
  if (container) container.innerHTML = ''; // drawDotplot/createChart appends — clear first
  // The viewBox tracks the display width, so the plot is genuinely BIGGER
  // rather than a small plot scaled up: same 1:1 mapping, more room for the dot
  // grid, and drawDotplot's radius cap (innerWidth / bins) loosens with it.
  const displayWidth = opts.displayWidth ?? MECH_DISPLAY_W;
  const viewWidth = opts.viewWidth ?? displayWidth + 20;
  // Anchor the bin grid to the DATA's own min (not the fixed domain), so a uniform
  // shift of the values (observed → null) preserves the exact stacking — it just
  // translates. A fixed-domain grid would re-bin and change the apparent shape.
  const binOrigin = opts.binOrigin ?? (values.length ? Math.min(...values) : undefined);
  const frame = drawDotplot(container, values, {
    ...COMPACT,
    forceDotMode: true,
    id: opts.id,
    domain: opts.domain,
    binWidth: opts.binWidth,
    binOrigin,
    dotRadius: opts.dotRadius,
    sizingMaxStack: opts.sizingMaxStack,
    fillColor: opts.fillColor,
    observedStat: opts.mean,
    observedLabel: opts.meanLabel ?? 'x̄',
    xLabel: opts.xLabel ?? '',
    // A narrow, taller viewBox so the dotplot fills the ~300px mechanism panel at
    // close to 1:1 (a 600-wide viewBox displayed in a 300px panel halves the dots).
    viewWidth,
    viewHeight: opts.viewHeight ?? 210,
  });
  // Cap the display width to the viewBox width so the dotplot renders ~1:1 and dots
  // are the SAME size regardless of how wide the host panel is (the CI and the
  // randomization-test strips have different panel widths). Centered.
  const svg = frame?.frame?.inner?.ownerSVGElement;
  if (svg) {
    // An explicit width, not just a cap. The tier layouts put this panel in a
    // `flex-direction: column; align-items: flex-start` box, so its container
    // shrinks to fit its content while the SVG sizes itself from its container
    // — the two agree on the 300px default and the max-width never binds. Say
    // the number. `max-width: 100%` keeps it shrinking on a narrow phone.
    svg.style.width = `${displayWidth}px`;
    svg.style.maxWidth = '100%';
    svg.style.margin = '0 auto';
    svg.style.display = 'block';
  }
  return frame;
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
  // Key on a ROUNDED value: a "bag" of NULL-SHIFTED data carries floating-point
  // noise (e.g. -3.2000000000000006), and exact-float matching against the
  // resampled values would silently miss — so the flyers wouldn't originate from
  // the bag (no footprints). Rounding makes the match robust.
  const key = (/** @type {number} */ v) => Math.round(v * 1e6) / 1e6;
  /** @type {Map<number, Element[]>} */
  const byVal = new Map();
  bag?.dots?.forEach((d, i) => {
    if (!circles[i]) return;
    const k = key(d.value);
    const arr = byVal.get(k) || [];
    arr.push(circles[i]);
    byVal.set(k, arr);
  });
  /** @type {Map<number, number>} */
  const cursor = new Map();
  return (value) => {
    const k = key(value);
    const arr = byVal.get(k);
    if (!arr || !arr.length) return null;
    const idx = (cursor.get(k) ?? 0) % arr.length;
    cursor.set(k, idx + 1);
    const r = arr[idx].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
}

/**
 * The shared flight: hide each target, fly an orange clone from its source point
 * onto it, reveal it on landing, and stamp a footprint where it came from.
 *
 * Extracted from `animateDrawInto` so callers that do NOT render through
 * `drawDotplot` can reuse the same motion — `conceptual/bootstrap-shift/` flies
 * from labelled population circles into a hand-built inset. Targets are plain
 * elements; the caller supplies the pairing.
 *
 * @param {Array<{source: {x:number,y:number}|null, target: Element}>} pairs
 * @param {{ footprints?: boolean, color?: string, hold?: number, fly?: number,
 *   size?: number, onDone?: () => void }} [opts]
 * @returns {number} total duration in ms, or 0 if it declined to run
 */
export function flyOntoTargets(pairs, opts = {}) {
  const { color = FLY_COLOR, hold = 320, fly = 620, footprints = true, onDone } = opts;
  if (prefersReducedMotion() || !pairs.length) return 0;

  /** @type {Array<{el: HTMLElement, sx:number, sy:number, ex:number, ey:number, circle: Element, foot:boolean}>} */
  const flyers = [];
  for (const { source, target } of pairs) {
    const tr = target.getBoundingClientRect();
    const ex = tr.left + tr.width / 2, ey = tr.top + tr.height / 2;
    const sz = opts.size ?? Math.max(tr.width || 8, 7);
    const sx = source ? source.x : ex, sy = source ? source.y : ey - 60;
    const el = document.createElement('div');
    el.className = 'dpr-flyer';
    el.style.cssText = `position:fixed;left:${sx - sz / 2}px;top:${sy - sz / 2}px;`
      + `width:${sz}px;height:${sz}px;border-radius:50%;background:${color};`
      + `z-index:1000;pointer-events:none;opacity:0;transition:opacity .15s ease-in;`;
    document.body.appendChild(el);
    /** @type {SVGElement} */ (target).style.opacity = '0';
    flyers.push({ el, sx, sy, ex, ey, circle: target, foot: !!source });
  }

  requestAnimationFrame(() => flyers.forEach(f => { f.el.style.opacity = '1'; }));

  setTimeout(() => {
    if (footprints) stampFootprints(flyers);
    const t0 = performance.now();
    const ease = (/** @type {number} */ t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    function step(now) {
      const t = Math.min((now - t0) / fly, 1);
      const e = ease(t);
      for (const f of flyers) {
        f.el.style.left = `${f.sx + (f.ex - f.sx) * e - (f.el.offsetWidth / 2)}px`;
        f.el.style.top = `${f.sy + (f.ey - f.sy) * e - (f.el.offsetHeight / 2)}px`;
      }
      if (t < 1) { requestAnimationFrame(step); return; }
      // Reveal the real dots; remove the flyers.
      for (const f of flyers) { /** @type {SVGElement} */ (f.circle).style.removeProperty('opacity'); f.el.remove(); }
      onDone?.();
    }
    requestAnimationFrame(step);
  }, hold);

  return hold + fly + 80;
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
  const info = computeDots(values, { binWidth: target.binWidth });
  // sourceAt is called in circle order — bagSource round-robins on call order.
  const pairs = circles.map((c, i) => ({
    source: sourceAt(info.dots[i]?.value ?? values[i], i),
    target: c,
  }));
  return flyOntoTargets(pairs, { footprints: opts.footprints !== false });
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
 *   sizingMaxStack?:number, displayWidth?:number, indices?:number[] }} opts
 */
export function showResampleDotplot(container, bag, resample, opts) {
  const target = drawMechDotplot(container, resample, {
    domain: opts.domain,
    binWidth: bag.binWidth,
    binOrigin: bag.binOrigin, // share the bag's grid so bag + resample align
    dotRadius: bag.dotRadius,
    sizingMaxStack: opts.sizingMaxStack,
    mean: opts.mean,
    meanLabel: opts.meanLabel,
    // The source measured this; drawing the two panels at different widths
    // would put the same value at two different x positions.
    displayWidth: opts.displayWidth,
  });
  if (!opts.animate || prefersReducedMotion()) return 0;

  // `?draw=` picks one of the styles under comparison. They use the draw's
  // INDICES, so a dot taken twice is seen being taken twice and a dot never
  // taken is marked as such — neither of which the value-matching below can
  // know. Default stays the shipped animation. (js/mechanisms/draw-animation.js)
  const style = drawStyleFromUrl();
  const sourceSvg = bag?.frame?.inner?.ownerSVGElement;
  clearDrawMarks(sourceSvg);
  if (style !== 'classic' && opts.indices && sourceSvg) {
    const sourceCircles = Array.from(sourceSvg.querySelectorAll('.data circle'));
    const targetSvg = target?.frame?.inner?.ownerSVGElement;
    const targetDots = targetSvg ? Array.from(targetSvg.querySelectorAll('.data circle')) : [];
    const ms = animateResampleDraw({
      sourceCircles, targetDots, indices: opts.indices, style, targetSvg,
    });
    if (ms) return ms;
  }
  return animateDrawInto(target, resample, bagSource(bag));
}
