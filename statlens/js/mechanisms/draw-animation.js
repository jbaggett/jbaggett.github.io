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

/**
 * The combined statistic, parked after the resample's dots merge into it and
 * held for `animateDropToChart` to fly into the distribution.
 *
 * Module-level rather than handed along, because the two halves of one journey
 * are started by different modules a few hundred milliseconds apart: the merge
 * finishes inside the mechanism, and the flight cannot begin until the page has
 * rendered the chart and knows where the new dot landed. There is at most one.
 *
 * @type {HTMLElement|null}
 */
let airborne = null;
/** @type {ReturnType<typeof setTimeout>|undefined} */
let airborneTimer;

/**
 * How long a parked statistic waits to be claimed before it gives up and fades.
 *
 * The claim normally arrives within the settle, ~240ms. This is the safety net
 * for the cases where no flight follows at all — the chart found nothing to
 * land on, the user hit reset, a second draw started — so that a dot is never
 * left sitting on the screen with nowhere to go.
 */
const AIRBORNE_TTL = 3000;

/** Park the merged statistic and start its safety timer. */
function hold(/** @type {HTMLElement} */ el) {
  dismissAirborneStat();
  el.classList.add('dpr-airborne');
  airborne = el;
  airborneTimer = setTimeout(() => dismissAirborneStat(), AIRBORNE_TTL);
}

/**
 * Claim the parked statistic, if one is waiting. The caller then owns the
 * element — including removing it.
 *
 * @returns {HTMLElement|null}
 */
export function takeAirborneStat() {
  const el = airborne;
  airborne = null;
  clearTimeout(airborneTimer);
  return el?.isConnected ? el : null;
}

/**
 * Fade out a statistic that will not be flown after all — either one that was
 * claimed and could not be used, or whatever is currently parked.
 *
 * @param {HTMLElement|null} [el]
 */
export function dismissAirborneStat(el) {
  const target = el ?? airborne;
  if (el == null) { airborne = null; clearTimeout(airborneTimer); }
  if (!target) return;
  target.style.transition = 'opacity 200ms ease-out';
  target.style.opacity = '0';
  setTimeout(() => target.remove(), 220);
}

/** @typedef {'classic'|'sequence'|'burst'|'sweep'|'shade'|'rings'} DrawStyle */

/**
 * Styles that start with the source EMPTY and fill it in as it is drawn from.
 *
 * The others mark the never-taken observations up front, which announces the
 * answer before the question: a third of the dots are dimmed before a single
 * draw has happened. Here every observation starts as an outline, each pick
 * fills one in, and whatever is still an outline at the end was never taken —
 * the same fact, arrived at rather than asserted. (Jeff, 2026-09-28.)
 */
const GHOSTED = new Set(['shade', 'rings']);

/**
 * How many times an observation has been taken, as depth of colour.
 *
 * Deepens on the second and third pick, so a dot taken twice is seen getting
 * darker rather than being labelled afterwards — no ×N anywhere, so what you
 * are judging is the shade itself.
 *
 * ⚠ That makes it colour-only, which does not meet the accessibility bar on its
 * own: anyone who cannot separate these four blues cannot read the count. It is
 * fine for a style being compared against `rings`; if `shade` is the one that
 * gets promoted it needs a non-colour partner first — the badges it had, or
 * size, or the rings themselves.
 */
const SHADE = ['#569BBD', '#3E7A99', '#2A5A75', '#114B5F'];

/** Ring spacing for the `rings` style, in px of radius. */
const RING_GAP = 3.5;

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
  return (raw === 'sequence' || raw === 'burst' || raw === 'sweep'
    || raw === 'shade' || raw === 'rings') ? raw : 'classic';
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
  if (style === 'shade' || style === 'rings') {
    // One at a time, like `sequence` — the encoding only reads if you can see
    // which dot is being filled in when.
    const gap = total <= 20 ? 150 : total <= 40 ? 105 : 72;
    return { delay: order * gap, fly: 330 };
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
  // A draw already in the air belongs to the previous click. Clear it, or a
  // rapid +1 +1 leaves last time's statistic parked over this one's.
  dismissAirborneStat();

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

  /** @type {Array<{el: HTMLElement, sx:number, sy:number, ex:number, ey:number, dot: Element, src: Element|null, index:number, delay:number, fly:number}>} */
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
    flyers.push({ el, sx, sy, ex, ey, dot, src, index: indices[i], delay: t.delay, fly: t.fly });
  });

  if (GHOSTED.has(style)) {
    // Empty the source. Each pick fills one in (see `reveal`), so what is still
    // an outline when the draw finishes is what was never taken — nothing has
    // to be dimmed to say it.
    for (const c of sourceCircles) ghost(c);
  } else {
    // Never taken: say so. On a real sample this is roughly a third of the dots,
    // and it is half of what "with replacement" means.
    sourceCircles.forEach((c, j) => {
      if (takenCount[j] === 0) /** @type {SVGElement} */ (c).classList.add('dpr-untaken');
    });
  }

  // Taken more than once: say that too. Burst has no time to show a dot being
  // picked twice, so it labels instead. `shade` deliberately does NOT — it is
  // the pure colour-depth encoding, kept clean so it can be judged on its own
  // against `rings` (Jeff, 2026-09-28). If it wins, it needs a non-colour
  // partner before it becomes the default.
  if (style === 'burst') {
    takenCount.forEach((n, j) => { if (n > 1) badge(sourceCircles[j], n); });
  }

  /** How many times each observation has been drawn SO FAR, for the encodings. */
  const seen = new Array(sourceCircles.length).fill(0);

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
        // …and in the ghosted styles the pick is also what fills the dot in.
        if (f.src && GHOSTED.has(style) && f.index >= 0) {
          reveal(f.src, ++seen[f.index], style);
        }
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
      // This dot IS the statistic — the student has just watched it being
      // computed. It used to fade out here, and a *second* dot was spawned
      // beneath the panel to make the trip to the distribution, so the thing
      // that was computed vanished and something unrelated travelled. Park it
      // instead, and let the drop animation fly this one. (Jeff, 2026-09-27.)
      hold(merged);
    }
    /** @type {SVGElement} */ (overlays).style.transition = 'opacity 220ms ease-in';
    /** @type {SVGElement} */ (overlays).style.removeProperty('opacity');
    setTimeout(() => { onDone?.(); }, settle);
  }
  requestAnimationFrame(step);
}

/**
 * Empty a source dot: an outline where a filled dot was.
 *
 * Outline rather than "faded", so the dot is still a perceivable shape. A
 * washed-out fill alone drops below the 3:1 contrast that graphical elements
 * need, and "never taken" is information the reader has to be able to see —
 * it is half of what makes a bootstrap a bootstrap.
 *
 * @param {Element} circle
 */
function ghost(circle) {
  const el = /** @type {SVGElement} */ (circle);
  if (!el.dataset.dprFill) el.dataset.dprFill = el.getAttribute('fill') || '';
  el.classList.add('dpr-ghost');
}

/**
 * Fill a source dot in, encoded by how many times it has now been taken.
 *
 * @param {Element} circle
 * @param {number} count - times taken so far, 1 on the first pick
 * @param {DrawStyle} style
 */
function reveal(circle, count, style) {
  const el = /** @type {SVGElement} */ (circle);
  el.classList.remove('dpr-ghost');
  if (style === 'shade') {
    el.style.fill = SHADE[Math.min(count, SHADE.length) - 1];
    return;
  }
  // rings: the dot itself goes back to its own colour, and every pick after the
  // first leaves a ring around it. Three rings means four draws — a count you
  // can read without relying on telling two blues apart.
  el.style.removeProperty('fill');
  if (count > 1) addRing(el, count - 1);
}

/**
 * One more ring around a dot that has been drawn again.
 *
 * @param {SVGElement} circle
 * @param {number} nth - 1 for the first extra ring
 */
function addRing(circle, nth) {
  // Into the OVERLAYS group, not in among the data. Four places count
  // `.data circle` to line source dots up with draw indices, and a tally mark
  // sitting in that list would shift every index after it — the exact class of
  // bug this animation exists to have fixed. Overlays share the data's
  // coordinate space, so cx/cy carry over unchanged.
  const svg = /** @type {SVGGraphicsElement} */ (circle).ownerSVGElement;
  const host = svg?.querySelector('.overlays') ?? circle.parentNode;
  if (!host) return;
  const r = Number(circle.getAttribute('r')) || 5;
  const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  ring.setAttribute('class', 'dpr-ring');
  ring.setAttribute('cx', circle.getAttribute('cx') || '0');
  ring.setAttribute('cy', circle.getAttribute('cy') || '0');
  ring.setAttribute('r', String(r + nth * RING_GAP));
  host.appendChild(ring);
}

/** A brief flash at a source dot as it is drawn from. */
function pulse(circle) {
  // The keyframes swell to `calc(var(--dpr-r) * 1.9)` and back. Nothing ever
  // set --dpr-r, so every dot snapped to the 5px fallback for the length of the
  // pulse whatever its real radius was. It is right here on the element.
  const r = Number(circle.getAttribute('r'));
  if (r > 0) /** @type {SVGElement} */ (circle).style.setProperty('--dpr-r', String(r));
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
  // The ghosted styles leave marks of their own: the outline class, the shade
  // written onto the element, and one ring per repeat draw. A source that keeps
  // last draw's rings is a source that lies about this one.
  root.querySelectorAll('.dpr-ghost').forEach(el => el.classList.remove('dpr-ghost'));
  root.querySelectorAll('.dpr-ring').forEach(el => el.remove());
  root.querySelectorAll('[data-dpr-fill]').forEach((el) => {
    /** @type {SVGElement} */ (el).style.removeProperty('fill');
    delete /** @type {SVGElement} */ (el).dataset.dprFill;
  });
}
