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
/**
 * Every animation currently in flight, and how to stop it.
 *
 * These animations run on requestAnimationFrame and clean up in their own last
 * frame — which is correct right up until someone presses +1 again before that
 * frame arrives. Then two runs share the screen: 64 flyers for a 48-dot
 * mechanism, the first run's dots still hidden waiting for its own finish, and
 * the second run's arriving on top of them. (Jeff, 2026-10-03: "the resample
 * dots in Step 2 don't all disappear when we sample again. the animation needs
 * a clean slate each time we press +1.")
 *
 * So each run registers how to abort itself, and starting a draw cancels
 * whatever was still going. An aborted run must leave the DOM as if it had
 * finished — flyers removed, hidden targets shown again — because the next
 * render is about to draw over it either way.
 *
 * @type {Set<() => void>}
 */
const inFlight = new Set();

/**
 * Stop every animation still running and undo what it was mid-way through.
 *
 * Safe to call when nothing is running. Call it before starting a new draw.
 */
export function cancelDrawAnimations() {
  for (const abort of [...inFlight]) {
    try { abort(); } catch { /* a half-torn-down run is still better aborted */ }
  }
  inFlight.clear();
}

/**
 * Register a run. Returns a `stopped()` predicate for its frame loop to check
 * and a `finish()` to call when it ends normally.
 *
 * @param {() => void} undo - put the DOM back as a finished run would leave it
 */
function trackRun(undo) {
  let dead = false;
  const abort = () => { if (!dead) { dead = true; undo(); } };
  inFlight.add(abort);
  return {
    stopped: () => dead,
    finish: () => { dead = true; inFlight.delete(abort); },
  };
}

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
 * Smallest dot radius that can hold a legible numeral.
 *
 * The digit is drawn at 1.7 × the radius, so this is the point where it drops
 * below about 8px — under that it is a smudge inside a dot rather than a
 * number, and the count is better carried by colour depth.
 */
const COUNT_LEGIBLE_R = 5;

/**
 * Which style to draw with.
 *
 * **`burst` is the default** as of 2026-09-28 (Jeff's call, after comparing the
 * five on bootstrap-mean). It is the one that states both facts at once — a
 * count inside every repeated dot, dimming on every observation never taken —
 * and it is the only one fast enough that a reader clicking +1 repeatedly is
 * not waiting on it. Where the dots are too small to hold a numeral the count
 * becomes depth of colour instead, so it degrades rather than failing.
 *
 * `classic` is the animation that shipped before, still reachable for
 * comparison; the other three remain for the same reason.
 *
 * @param {string} [search]
 * @returns {DrawStyle}
 */
export function drawStyleFromUrl(search) {
  const raw = new URLSearchParams(
    search ?? (typeof location === 'undefined' ? '' : location.search)).get('draw');
  if (raw === 'classic' || raw === 'sequence' || raw === 'sweep'
    || raw === 'shade' || raw === 'rings' || raw === 'burst') return raw;
  return 'burst';
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
 * @param {(el: Element) => void} [opts.onGhost] - empty one source mark
 * @param {(el: Element, count: number) => void} [opts.onReveal] - fill one in,
 *   given how many times it has now been taken. Supplying it makes the draw
 *   ghosted and hands the whole "what a mark looks like" question to the caller.
 * @param {number} [opts.leadIn] - hold the whole source EMPTY for this many ms
 *   before the first flyer launches. Only meaningful for a ghosted draw: the
 *   emptying is instantaneous, so without a pause the first dots are already
 *   filling back in before a reader has seen the sample go blank, and "every
 *   dot starts untaken" never registers. (Jeff, 2026-10-01.)
 * @returns {number} total duration in ms, 0 if it declined to run
 */
export function animateResampleDraw({ sourceCircles, targetDots, indices, style, targetSvg, onDone,
  onGhost, onReveal, leadIn = 0 }) {
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

  // The hold is worth nothing unless the source is actually being emptied, and
  // a long one is just a stall, so it is bounded on both sides.
  const lead = (GHOSTED.has(style) || !!onReveal) ? Math.min(Math.max(leadIn, 0), 1200) : 0;

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
    // A flyer carries its source's own colour when the source has one. On the
    // mean pages every dot is the same colour and this resolves to nothing, so
    // they keep the orange. On the proportion stacks the mark's colour IS its
    // outcome, and an orange dot landing in the blue stack would be saying
    // something false about what was drawn. (2026-10-01.)
    const fill = srcColour(src) || FLY_COLOR;
    el.style.cssText = `position:fixed;left:${sx - sz / 2}px;top:${sy - sz / 2}px;`
      + `width:${sz}px;height:${sz}px;border-radius:50%;background:${fill};`
      + `z-index:1000;pointer-events:none;opacity:0;`;
    document.body.appendChild(el);
    /** @type {SVGElement} */ (dot).style.opacity = '0';
    const t = timing(style, rank, targetDots.length);
    flyers.push({ el, sx, sy, ex, ey, dot, src, index: indices[i], delay: t.delay + lead, fly: t.fly });
  });

  // A caller with its own vocabulary for "empty" and "filled in" supplies it.
  // The proportion stacks do: their marks carry an outcome as well as a count,
  // so the ramp they darken along depends on which stack the mark is in, which
  // is not something this module should know. (2026-10-01.)
  const ghosted = GHOSTED.has(style) || !!onReveal;
  if (ghosted) {
    // Empty the source. Each pick fills one in (see `reveal`), so what is still
    // an outline when the draw finishes is what was never taken — nothing has
    // to be dimmed to say it.
    for (const c of sourceCircles) (onGhost ?? ghost)(c);
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
  if (style === 'burst' && !onReveal) {
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
        if (f.src && ghosted && f.index >= 0) {
          const n = ++seen[f.index];
          if (onReveal) onReveal(f.src, n);
          else reveal(f.src, n, style);
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
  // ON the mean marker, both ways. The x came from the line and the y was the
  // AVERAGE HEIGHT OF THE FLYERS — which is not a position that means anything:
  // it is wherever the draw happened to leave its dots. The statistic has a
  // place in this plot, the marker is drawn at it, and that is where the dot
  // the student is about to watch fly should be sitting. (Jeff, 2026-10-02:
  // "the dot [originates] in the wrong place".)
  const targetY = box.top + box.height / 2;
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

/**
 * How many times this observation was taken, written INSIDE its dot.
 *
 * It used to hang "×N" up and to the right of the dot in orange. On a dense
 * sample that is a second cloud of marks floating between the stacks, and it
 * reads as an annotation *about* the plot rather than as a property *of* the
 * dot. (Jeff, 2026-09-28.)
 *
 * The count goes in the middle of the dot, and the dot darkens to carry it: a
 * digit on the normal blue is about 2.6:1 against white, which is not a
 * contrast you can ask anyone to read a number off. Dark fill and white text is
 * ~8:1, and the darkening is a second, redundant signal that this dot was taken
 * more than once. The × is dropped — it doubles the width for no information
 * once the number is sitting in the thing it counts.
 *
 * @param {Element} circle
 * @param {number} n
 */
function badge(circle, n) {
  if (!circle) return;
  const svg = /** @type {SVGGraphicsElement} */ (circle).ownerSVGElement;
  const parent = circle.parentNode;
  if (!svg || !parent) return;
  const el = /** @type {SVGElement} */ (circle);
  const r = Number(circle.getAttribute('r')) || 5;

  if (r < COUNT_LEGIBLE_R) {
    // Too small to hold a digit. A skewed sample stacks deep, which is what
    // shrinks the dots — on email50 the radius comes out at 3.8px and a 7px
    // numeral inside it is a smudge, not a number. (Jeff, 2026-09-28.)
    //
    // So the count is carried by DEPTH instead: same ramp `shade` uses, so a
    // dot taken twice is darker and one taken four times darker still. Less
    // precise than a digit and completely readable, which is the better trade
    // when the digit would not have been readable at all.
    el.style.fill = SHADE[Math.min(n, SHADE.length) - 1];
    return;
  }

  el.classList.add('dpr-counted');
  const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  t.setAttribute('class', 'dpr-badge');
  t.setAttribute('x', circle.getAttribute('cx') || '0');
  t.setAttribute('y', circle.getAttribute('cy') || '0');
  // Scale with the dot, so it fits whether the panel is 300px or 520px wide.
  t.setAttribute('font-size', String(Math.round(r * 1.7)));
  t.textContent = String(n);
  // After the dot, so it is painted over it rather than under.
  parent.appendChild(t);
}

/** Clear the marks a previous draw left on the source. */
export function clearDrawMarks(root) {
  if (!root) return;
  root.querySelectorAll('.dpr-untaken').forEach(el => el.classList.remove('dpr-untaken'));
  root.querySelectorAll('.dpr-picked').forEach(el => el.classList.remove('dpr-picked'));
  root.querySelectorAll('.dpr-badge').forEach(el => el.remove());
  root.querySelectorAll('.dpr-counted').forEach(el => el.classList.remove('dpr-counted'));
  // The small-dot fallback writes the depth straight onto the element.
  root.querySelectorAll('.data circle').forEach((el) => {
    const st = /** @type {SVGElement} */ (el).style;
    if (st.fill) st.removeProperty('fill');
  });
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

/**
 * Watching a resample happen when the sample is too big to draw as dots.
 *
 * Past 80 observations the mechanism is a pair of histograms. The first attempt
 * at animating that flew each SOURCE bar to the matching resample bar — which
 * Jeff called cute and not resampling, and he was right about why. One bar to
 * one bar reads as the histogram *deforming*, and it implies a correspondence
 * that does not exist: resample bin 3 was not made *from* source bin 3 as a
 * block. It was filled by individual draws that each happened to land there. A
 * transformation of the whole, where the truth is an accumulation of parts.
 *
 * Resampling has four facts and bars-flying-to-bars carried none of them:
 * draws happen ONE AT A TIME, each takes ONE observation, the bag NEVER
 * EMPTIES, and the new sample is BUILT UP to the same n. So:
 *
 * - the resample panel starts as bare axes — no bars at all
 * - draws stream out of the source one at a time, each leaving from a random
 *   point inside the bar it came from
 * - each landing grows its bar by one increment, so the second histogram is
 *   built rather than delivered
 * - the source bar pulses as the draw leaves and **stays exactly as tall**,
 *   which is the most direct picture of "with replacement" available here: you
 *   draw from it over and over and it never runs down
 * - a counter runs up to n, because the resample being the same size as the
 *   sample is the part that gets missed
 *
 * Draws are allocated to bars from the resample's OWN bin counts rather than
 * sampled here, so the stream ends on exactly the histogram that was computed,
 * and a bin that drew more than its share is seen firing more often than its
 * height would suggest — which is the bootstrap's variability, visible.
 *
 * At n = 648 you cannot fly 648 particles, so the stream is a fixed budget and
 * each particle carries several draws. The counter names the real n throughout.
 *
 * @param {object} opts
 * @param {Element|null} opts.sourceSvg - the bag's histogram
 * @param {Element|null} opts.targetSvg - the resample's, already drawn
 * @param {number} [opts.n] - draws in the resample, for the counter
 * @param {() => void} [opts.onDone]
 * @returns {number} total duration in ms, 0 if it declined to run
 */
export function animateHistogramDraw({ sourceSvg, targetSvg, n, onDone }) {
  if (prefersReducedMotion() || !sourceSvg || !targetSvg) return 0;
  // Two renderers draw these panels: the compact `.mc-bar` mini histogram and
  // the full drawHistogram, whose bars are rects inside `.data`.
  const BAR_SEL = '.mc-bar, .data rect';
  const srcBars = [...sourceSvg.querySelectorAll(BAR_SEL)];
  const tgtBars = [...targetSvg.querySelectorAll(BAR_SEL)];
  if (!srcBars.length || !tgtBars.length) return 0;
  dismissAirborneStat();

  const srcBox = sourceSvg.getBoundingClientRect();
  const tgtBox = targetSvg.getBoundingClientRect();
  const shift = tgtBox.left - srcBox.left;
  const centre = (/** @type {Element} */ bar) => {
    const b = bar.getBoundingClientRect();
    return b.left + b.width / 2;
  };

  /** Each resample bar, with the source bar it draws from and its final size. */
  const slots = tgtBars.map((bar) => {
    const box = bar.getBoundingClientRect();
    const want = centre(bar);
    let src = null, bestD = Infinity;
    for (const sb of srcBars) {
      const d = Math.abs(centre(sb) + shift - want);
      if (d < bestD) { bestD = d; src = sb; }
    }
    const tol = Math.max(6, box.width * 0.75);
    return {
      // `src` is the bar to FLASH — only when the match is close enough that
      // flashing it is honest. `origin` is where this bin's dots are taken
      // from, which must be a source bar whatever happens: falling back to the
      // target bar started five of eighty-three dots on the resample side,
      // which says they came from where they were going. (2026-10-03.)
      bar, src: bestD <= tol ? src : null, origin: src ?? null, box,
      finalY: Number(bar.getAttribute('y')) || 0,
      finalH: Number(bar.getAttribute('height')) || 0,
      landed: 0, share: 0,
    };
  });
  const totalH = slots.reduce((t, s) => t + s.box.height, 0);
  if (!(totalH > 0)) return 0;

  // A fixed budget of particles, allocated across bars by largest remainder so
  // the counts are exact and every drawn-from bin fires at least once.
  // Fewer particles, and a shorter stream to send them down — the animation
  // was 3.55s end to end and read as waiting rather than watching. The cadence
  // is deliberately unchanged: 110 over 2100ms was one every 19ms, 70 over
  // 1250ms is one every 18ms, so it is the same rain for a shorter time rather
  // than the same rain hurried. (Jeff, 2026-10-03: "takes a little too long so
  // we probably want to speed it up or maybe draw fewer dots.")
  const BUDGET = Math.max(24, Math.min(70, Math.round(n || 70)));
  const exact = slots.map(s => (s.box.height / totalH) * BUDGET);
  slots.forEach((s, i) => { s.share = Math.floor(exact[i]); });
  let left = BUDGET - slots.reduce((t, s) => t + s.share, 0);
  const order = slots.map((s, i) => i).sort((a, c) => (exact[c] - slots[c].share) - (exact[a] - slots[a].share));
  for (const i of order) { if (left <= 0) break; slots[i].share++; left--; }
  for (const s of slots) if (s.box.height > 0 && s.share === 0) s.share = 1;

  // Hide the resample: bare axes, nothing drawn.
  for (const s of slots) {
    /** @type {SVGElement} */ (s.bar).style.opacity = '0';
    s.bar.setAttribute('height', '0');
    s.bar.setAttribute('y', String(s.finalY + s.finalH));
  }

  /** The launch order: interleaved, so the stream reads as random draws. */
  /** @type {typeof slots} */
  const queue = [];
  for (const s of slots) for (let k = 0; k < s.share; k++) queue.push(s);
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }

  // Fill the source bars with dots, hold, carry them across, let them become
  // the resample's bars.
  //
  // The draw used to be a continuous rain: particles left the source one at a
  // time and the target grew as each landed. It read as weather rather than as
  // an act — nothing was ever *held*, so there was no moment at which the
  // resample existed as a thing taken from somewhere. (Jeff, 2026-10-03: "I'm
  // not a big fan of the sampling from a histogram animation, could we maybe
  // stack orange dots in the original sample histogram and fly them to the
  // resample histogram where they coalesce into the bars.")
  //
  // So it is the same three beats as the dart scoop and the card shuffle, which
  // is the point — one grammar for every draw on the site:
  //   1. TAKE   — each source bar fills bottom-up with its share of dots, so
  //               the dots tile the bin they were drawn from and the stack IS
  //               that bin's count.
  //   2. HOLD   — they sit there. THIS is the resample, and it came from here.
  //   3. CARRY  — they cross together, each to its own bin's place in the new
  //               histogram, and the bars grow under them as they arrive.
  //   4. MERGE  — the dots fade into the bars they have just built.
  const TAKE = 760, HOLD = 380, CARRY = 700, MERGE = 300, GATHER = 420, SETTLE = 240;

  /** Where each dot sits inside a bar: tiled bottom-up, so `share` fills it. */
  const seat = (/** @type {DOMRect} */ box, /** @type {number} */ k,
                /** @type {number} */ of, /** @type {number} */ jitter) => ({
    x: box.left + box.width / 2 + (jitter - 0.5) * Math.max(0, box.width - 6),
    y: box.bottom - (k + 0.5) * (Math.max(box.height, 4) / Math.max(of, 1)),
  });

  /** @type {{el: HTMLElement, slot: typeof slots[0], from: {x:number,y:number}, to: {x:number,y:number}, at: number, lift: number, shown: boolean, landed: boolean, size: number}[]} */
  const dots = [];
  let seq = 0;
  const totalDots = slots.reduce((t, sl) => t + sl.share, 0);
  for (const slot of slots) {
    const src = (slot.origin ?? slot.src ?? slot.bar).getBoundingClientRect();
    const size = Math.max(3, Math.min(6, Math.min(src.width, slot.box.width) * 0.55));
    for (let k = 0; k < slot.share; k++) {
      const j = Math.random();
      dots.push({
        el: document.createElement('div'), slot, size,
        from: seat(src, k, slot.share, j),
        to: seat(/** @type {DOMRect} */ ({
          left: slot.box.left, width: slot.box.width,
          bottom: slot.box.bottom, height: slot.finalH,
        }), k, slot.share, j),
        at: 0, lift: 0, shown: false, landed: false,
      });
    }
  }
  // Taken in a random order across the bars, so the fill reads as draws from the
  // whole sample rather than one bin being emptied at a time.
  for (let i = dots.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [dots[i], dots[j]] = [dots[j], dots[i]];
  }
  dots.forEach(d => { d.at = (seq++ / Math.max(totalDots, 1)) * TAKE; });

  // Hide the resample: bare axes, nothing drawn.
  for (const sl of slots) {
    /** @type {SVGElement} */ (sl.bar).style.opacity = '0';
    sl.bar.setAttribute('height', '0');
    sl.bar.setAttribute('y', String(sl.finalY + sl.finalH));
  }

  const counter = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  counter.setAttribute('class', 'dpr-draw-counter');
  counter.setAttribute('x', String(tgtBox.width - 6));
  counter.setAttribute('y', '10');
  counter.setAttribute('text-anchor', 'end');
  counter.textContent = `0 / ${n ?? ''}`.trim();
  if (n) targetSvg.appendChild(counter);
  const drawsPer = (n || dots.length) / (dots.length || 1);

  // A little spread on the lift-off, so the bars FILL as the dots arrive rather
  // than all appearing in one frame. Small enough that the crossing still reads
  // as one movement — this is a carry, not a second rain.
  const CARRY_SPREAD = 220;
  dots.forEach((d, i) => { d.lift = (i / Math.max(dots.length - 1, 1)) * CARRY_SPREAD; });

  const carryStart = TAKE + HOLD;
  const total = carryStart + CARRY_SPREAD + CARRY + MERGE + GATHER + SETTLE;
  const run = trackRun(() => {
    for (const d of dots) d.el.remove();
    counter.remove();
    for (const sl of slots) {
      sl.bar.setAttribute('y', String(sl.finalY));
      sl.bar.setAttribute('height', String(sl.finalH));
      /** @type {SVGElement} */ (sl.bar).style.removeProperty('opacity');
    }
  });

  const place = (/** @type {typeof dots[0]} */ d, /** @type {number} */ x, /** @type {number} */ y) => {
    d.el.style.left = `${x - d.size / 2}px`;
    d.el.style.top = `${y - d.size / 2}px`;
  };
  const ease = (/** @type {number} */ t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  const t0 = performance.now();
  let landedCount = 0;

  function step(/** @type {number} */ now) {
    if (run.stopped()) return;
    const elapsed = now - t0;
    for (const d of dots) {
      // TAKE: appear in the bin it came from, and flash that bin.
      if (!d.shown) {
        if (elapsed < d.at) continue;
        d.shown = true;
        d.el.className = 'dpr-draw';
        d.el.style.cssText = `position:fixed;width:${d.size}px;height:${d.size}px;`
          + `border-radius:50%;background:${FLY_COLOR};z-index:1000;pointer-events:none;`
          + 'box-shadow:0 0 0 1px rgba(255,255,255,.75);';
        place(d, d.from.x, d.from.y);
        document.body.appendChild(d.el);
        if (d.slot.src) pulseBar(d.slot.src);
      }
      if (elapsed < carryStart + d.lift) continue;
      // CARRY: together, each to its own place in the new bar.
      const t = Math.min((elapsed - carryStart - d.lift) / CARRY, 1);
      const e = ease(t);
      place(d, d.from.x + (d.to.x - d.from.x) * e, d.from.y + (d.to.y - d.from.y) * e);
      if (t >= 1 && !d.landed) {
        d.landed = true;
        landedCount++;
        grow(d.slot);
        if (n) counter.textContent = `${Math.min(n, Math.round(landedCount * drawsPer))} / ${n}`;
      }
      // MERGE: fade into the bar now underneath.
      if (t >= 1) {
        const m = Math.min((elapsed - carryStart - d.lift - CARRY) / MERGE, 1);
        d.el.style.opacity = String(1 - m);
      }
    }
    if (elapsed < carryStart + CARRY_SPREAD + CARRY + MERGE) { requestAnimationFrame(step); return; }

    run.finish();
    for (const d of dots) d.el.remove();
    // Settle on the exact computed histogram, whatever rounding the carry did.
    for (const sl of slots) {
      sl.bar.setAttribute('y', String(sl.finalY));
      sl.bar.setAttribute('height', String(sl.finalH));
      /** @type {SVGElement} */ (sl.bar).style.removeProperty('opacity');
    }
    if (n) counter.textContent = `${n} / ${n}`;
    setTimeout(() => {
      counter.remove();
      gatherBars(targetSvg, tgtBars, GATHER, SETTLE, onDone);
    }, 120);
  }

  /** Grow a bar by one dot's worth. */
  function grow(/** @type {typeof slots[0]} */ slot) {
    slot.landed++;
    const frac = Math.min(1, slot.landed / Math.max(1, slot.share));
    const h = slot.finalH * frac;
    slot.bar.setAttribute('height', String(h));
    slot.bar.setAttribute('y', String(slot.finalY + slot.finalH - h));
    /** @type {SVGElement} */ (slot.bar).style.removeProperty('opacity');
  }

  requestAnimationFrame(step);
  return total;
}

/**
 * The colour a flyer should be, taken from the mark it leaves.
 *
 * Only an HTML mark with a real background answers; an SVG circle carries its
 * colour in `fill`, and on those pages every dot is the same colour anyway, so
 * returning null there keeps the flyer orange as before.
 *
 * @param {Element|null} src
 * @returns {string|null}
 */
function srcColour(src) {
  if (!src || src.namespaceURI !== 'http://www.w3.org/1999/xhtml') return null;
  try {
    const bg = getComputedStyle(/** @type {HTMLElement} */ (src)).backgroundColor;
    if (!bg || bg === 'transparent' || /rgba\(0, 0, 0, 0\)/.test(bg)) return null;
    return bg;
  } catch { return null; }
}

/** A source bar flashes as a draw leaves it — and keeps its height. */
function pulseBar(bar) {
  bar.classList.remove('dpr-bar-drawn');
  void /** @type {HTMLElement} */ (bar).getBoundingClientRect();
  bar.classList.add('dpr-bar-drawn');
  setTimeout(() => bar.classList.remove('dpr-bar-drawn'), 260);
}

/**
 * Gather the resample's bars into its mean.
 *
 * One token per bar, from the top of the bar, converging on the mean marker and
 * merging into a single dot — the same move the dotplot's combine makes, so the
 * two sizes of sample tell the same story. The merged token is then parked for
 * `animateDropToChart` to fly into the distribution, exactly as a dot would be.
 *
 * @param {Element} svg
 * @param {Element[]} bars
 * @param {number} dur
 * @param {number} settle
 * @param {(() => void)} [onDone]
 */
function gatherBars(svg, bars, dur, settle, onDone) {
  const meanLine = svg.querySelector('.mc-mean, .resample-mean-group line');
  const box = svg.getBoundingClientRect();
  const mb = meanLine?.getBoundingClientRect();
  const targetX = mb ? mb.left + mb.width / 2 : box.left + box.width / 2;
  const alive = bars.filter(b => b.isConnected);
  if (!alive.length) { onDone?.(); return; }

  const tokens = alive.map((bar) => {
    const b = bar.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'dpr-flyer';
    const sz = 7;
    el.style.cssText = `position:fixed;left:${b.left + b.width / 2 - sz / 2}px;top:${b.top - sz / 2}px;`
      + `width:${sz}px;height:${sz}px;border-radius:50%;background:${FLY_COLOR};`
      + `z-index:1000;pointer-events:none;opacity:0.9;`;
    document.body.appendChild(el);
    return { el, sx: b.left + b.width / 2, sy: b.top };
  });
  const targetY = tokens.reduce((s, t) => s + t.sy, 0) / tokens.length;
  const t0 = performance.now();

  function step(now) {
    const t = Math.min((now - t0) / dur, 1);
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    tokens.forEach((tk, i) => {
      const sz = tk.el.offsetWidth || 7;
      tk.el.style.left = `${tk.sx + (targetX - tk.sx) * e - sz / 2}px`;
      tk.el.style.top = `${tk.sy + (targetY - tk.sy) * e - sz / 2}px`;
      if (i > 0) tk.el.style.opacity = String(0.9 * (1 - e));
    });
    if (t < 1) { requestAnimationFrame(step); return; }
    for (let i = 1; i < tokens.length; i++) tokens[i].el.remove();
    const merged = tokens[0]?.el;
    if (merged) {
      merged.style.transition = `transform ${settle}ms ease-out`;
      merged.style.transform = 'scale(1.6)';
      // Parked for the drop animation, the same as the dotplot's merged dot.
      hold(merged);
    }
    setTimeout(() => onDone?.(), settle);
  }
  requestAnimationFrame(step);
}

/** The two groups' shades during a shuffle — keyed to where a dot STARTED. */
const POOL_SHADE = ['#569BBD', '#114B5F'];
/** Pool, hold, deal, settle. */
const POOL_MS = 720, POOL_HOLD = 380, DEAL_MS = 720, DEAL_SETTLE = 200;

/**
 * A shuffle, as the book draws it: gather both piles into one, deal back out.
 *
 * This is not a draw, and burst cannot be reused for it. Burst's whole
 * vocabulary is repeats and misses — "this one was taken twice, that one never"
 * — and a permutation has neither: every observation appears exactly once, in
 * one group or the other, and the group sizes never change. What a shuffle has
 * to say instead is that the VALUES did not change, only the labels did.
 *
 * So the dots pool on one scale and deal back out, and the deal moves them
 * VERTICALLY only — a dot's x is its value, and a value that never moves
 * sideways is a value that did not change. That is the whole argument of a
 * randomization test, made a property of the picture rather than a sentence
 * under it. (It is also why the two groups had to be stacked on one axis
 * first; side by side, pooling moves everything sideways and the picture says
 * the opposite.)
 *
 * Each flyer carries the shade of the group it STARTED in, so the pool visibly
 * mixes and the dealt rows come out interleaved — otherwise pool-and-deal is
 * dots going down and coming back up, with nothing to show that anything
 * changed. The settled dots are uniform again; the shades belong to the act,
 * not to the data.
 *
 * @param {object} opts
 * @param {Element[][]} opts.sourceGroups - [group1, group2] circles, as drawn
 * @param {Element[][]} opts.targetGroups - the same for the dealt panel
 * @param {() => void} [opts.onDone]
 * @returns {number} total duration in ms, 0 if it declined to run
 */
export function animatePoolAndDeal({ sourceGroups, targetGroups, onDone }) {
  if (prefersReducedMotion()) return 0;
  const src = [...(sourceGroups[0] ?? []), ...(sourceGroups[1] ?? [])];
  const tgt = [...(targetGroups[0] ?? []), ...(targetGroups[1] ?? [])];
  if (!src.length || src.length !== tgt.length) return 0;
  dismissAirborneStat();

  const centre = (/** @type {Element} */ c) => {
    const r = c.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, size: Math.max(r.width, 7) };
  };
  // Pair each dealt dot with a source dot of the SAME VALUE. The permutation
  // says which observation went where, but two observations with the same value
  // are indistinguishable in this picture — matching on the value is both
  // simpler and exactly as true, and it does not depend on the order the
  // dotplot happens to put its circles in the DOM.
  //
  // On SCREEN position within its own plot, not on `cx`. The two rows' SVGs
  // come out with slightly different viewBoxes, so one value is cx 62.80 in the
  // top plot and 64.38 in the bottom — the same place on screen, a different
  // number. Keying on `cx` paired only the dots whose groups happened to agree:
  // 10 of 18. (2026-10-02.)
  const relX = (/** @type {Element} */ c) => {
    const own = /** @type {SVGGraphicsElement} */ (c).ownerSVGElement;
    const r = c.getBoundingClientRect();
    const o = own?.getBoundingClientRect();
    return Math.round(r.left + r.width / 2 - (o?.left ?? 0));
  };
  const byValue = new Map();
  src.forEach((c, i) => {
    const k = relX(c);
    if (!byValue.has(k)) byValue.set(k, []);
    byValue.get(k).push({ c, group: i < (sourceGroups[0]?.length ?? 0) ? 0 : 1 });
  });
  /** Nearest key with anything left in it — rounding can leave a 1px gap. */
  const claim = (/** @type {number} */ k) => {
    for (const d of [0, 1, -1, 2, -2]) {
      const bucket = byValue.get(k + d);
      if (bucket?.length) return bucket.shift();
    }
    return null;
  };

  const n1 = targetGroups[0]?.length ?? 0;
  /** @type {Array<{el: HTMLElement, from: {x:number,y:number}, pool: {x:number,y:number}, to: {x:number,y:number}}>} */
  const flyers = [];
  // The pool sits BETWEEN the two plots, measured from the plots themselves.
  // It used to be the midpoint of the two groups' first circles, which is a
  // point that depends on how tall each stack happens to be — so the pile sat
  // wherever the data put it, usually low. (Jeff, 2026-10-02: "the pooled
  // distribution should land directly between the two histograms in Step 2,
  // but it's lower".)
  const plotBox = (/** @type {Element[]} */ g) => {
    const svg = /** @type {SVGGraphicsElement} */ (g?.[0])?.ownerSVGElement;
    return svg ? svg.getBoundingClientRect() : null;
  };
  const b1 = plotBox(targetGroups[0]), b2 = plotBox(targetGroups[1]);
  const poolY = (b1 && b2)
    ? (b1.bottom + b2.top) / 2
    : ([targetGroups[0], targetGroups[1]].map(g => g?.length ? centre(g[0]).y : 0)
        .reduce((a, b) => a + b, 0) / 2);

  tgt.forEach((dot, i) => {
    const match = claim(relX(dot));
    if (!match) return;
    const from = centre(match.c);
    const to = centre(dot);
    const el = document.createElement('div');
    el.className = 'dpr-flyer dpr-shuffle';
    el.style.cssText = `position:fixed;left:${from.x - to.size / 2}px;top:${from.y - to.size / 2}px;`
      + `width:${to.size}px;height:${to.size}px;border-radius:50%;`
      + `background:${POOL_SHADE[match.group]};z-index:1000;pointer-events:none;`;
    document.body.appendChild(el);
    /** @type {SVGElement} */ (dot).style.opacity = '0';
    flyers.push({ el, from, pool: { x: to.x, y: poolY }, to, dot, rank: i, group: i < n1 ? 0 : 1 });
  });
  if (!flyers.length) return 0;

  const run = trackRun(() => {
    for (const f of flyers) {
      f.el.remove();
      /** @type {SVGElement} */ (f.dot).style.removeProperty('opacity');
    }
  });

  const ease = (/** @type {number} */ t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const total = POOL_MS + POOL_HOLD + DEAL_MS + DEAL_SETTLE;
  const t0 = performance.now();

  function step(now) {
    if (run.stopped()) return;
    const e = now - t0;
    for (const f of flyers) {
      let x, y;
      if (e < POOL_MS) {
        const t = ease(e / POOL_MS);
        x = f.from.x + (f.pool.x - f.from.x) * t;
        y = f.from.y + (f.pool.y - f.from.y) * t;
      } else if (e < POOL_MS + POOL_HOLD) {
        x = f.pool.x; y = f.pool.y;
      } else {
        // Vertical only: x is already the value's place in the dealt panel.
        const t = ease(Math.min((e - POOL_MS - POOL_HOLD) / DEAL_MS, 1));
        x = f.to.x;
        y = f.pool.y + (f.to.y - f.pool.y) * t;
      }
      f.el.style.left = `${x - f.el.offsetWidth / 2}px`;
      f.el.style.top = `${y - f.el.offsetHeight / 2}px`;
    }
    if (e < POOL_MS + POOL_HOLD + DEAL_MS) { requestAnimationFrame(step); return; }
    run.finish();
    for (const f of flyers) {
      /** @type {SVGElement} */ (f.dot).style.removeProperty('opacity');
      f.el.style.transition = `opacity ${DEAL_SETTLE}ms ease-out`;
      f.el.style.opacity = '0';
      setTimeout(() => f.el.remove(), DEAL_SETTLE + 60);
    }
    setTimeout(() => onDone?.(), DEAL_SETTLE);
  }
  requestAnimationFrame(step);
  return total;
}

// ─── Scooping from a population: darts on a board ───────────────────────

/** Throw cadence, flight, the beat on the board, and the lift-off. */
const DART_THROW = 320, DART_HOLD = 520, DART_FLY = 760;

/**
 * Sample from a population by throwing darts at it.
 *
 * Three visible phases, because the *sampling* is the thing being taught:
 *
 *   1. THROW — darts rain onto the board and stick, with a small overshoot
 *      bounce, at uniform random spots. A dart landing left of the split is a
 *      success, right of it a failure: it takes the colour of wherever it hit,
 *      so the outcome is something the board decides, not something the dart
 *      brought with it.
 *   2. HOLD — the stuck darts sit there for a beat. *This* is the random
 *      sample of n points we just grabbed.
 *   3. FLY — they lift off and fly to their places in the sample, growing into
 *      dots, and leave a faint footprint behind so the board keeps showing
 *      where this sample came from.
 *
 * Written for the Sampling Distribution Lab and lifted here when the
 * one-proportion randomization test needed the same picture: both draw n
 * independent observations from a population whose success fraction is known —
 * p in the Lab, p₀ under the null — which is one mechanism, and was one
 * animation written once. The two differ only in the shape of the board (a
 * square there, a deepened bar inside a strip panel here).
 *
 * ⚠ `rand` is DECORATION — where on the board each dart happens to land. It
 * must never be the page's statistical rng: drawing from that stream here
 * would change the sample itself, and the same `?seed=` would stop producing
 * the same numbers. The outcomes are decided before this function is called;
 * all it chooses is splatter.
 *
 * @param {object} opts
 * @param {HTMLElement} opts.board - the area being sampled, split left|right
 * @param {number} opts.split - 0..1, the success fraction (the boundary's x)
 * @param {HTMLElement[]} opts.targets - the sample's marks, successes first
 * @param {number} opts.successCount - how many of `targets` are successes
 * @param {(isSuccess: boolean) => string} opts.flyerClass - class for a dart
 * @param {((isSuccess: boolean) => string)|null} [opts.ghostClass] - class for the
 *   footprint left behind; null leaves no footprints
 * @param {number} [opts.max] - decline above this many darts (too many flyers)
 * @param {() => number} [opts.rand] - decorative randomness only; see above
 * @param {() => void} [opts.onDone]
 * @returns {number} total duration in ms, 0 if it declined to run
 */
export function animateDartScoop({ board, split, targets, successCount,
    flyerClass, ghostClass = null, max = 100, rand = Math.random, onDone }) {
  const done = () => { if (onDone) onDone(); };
  if (prefersReducedMotion() || !board || !targets?.length || targets.length > max) {
    done();
    return 0;
  }
  // Only the CURRENT sample is marked, so last draw's footprints go first.
  board.querySelectorAll('[data-scoop-ghost]').forEach(g => g.remove());

  const bd = board.getBoundingClientRect();
  if (!bd.width || !bd.height) { done(); return 0; }
  const splitX = bd.left + Math.max(0, Math.min(1, split)) * bd.width;
  const n = targets.length;
  targets.forEach(t => { t.style.visibility = 'hidden'; });

  // Overshoot ease, so each dart snaps onto the board and settles — a "stick".
  const easeOutBack = (/** @type {number} */ t) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  };

  const STAGGER = Math.min(420 / n, 22);   // launch cadence — a rat-a-tat
  const flyStart = (n - 1) * STAGGER + DART_THROW + DART_HOLD;
  const total = flyStart + DART_FLY;

  // Throw them in a RANDOM order.
  //
  // A dart's destination is its dot, and the dots are sorted successes-first so
  // the amber fraction is p̂ — which meant dart i launched in that order too, and
  // every amber dart was thrown before any blue one. The picture said: first we
  // draw the successes, then we draw the failures. The whole claim of the
  // mechanism is that each observation is an independent draw, and watching the
  // board fill left-to-right-by-outcome contradicts it.
  //
  // So the LAUNCH ORDER is shuffled while each dart keeps its own landing spot
  // and its own dot. Nothing about the sample changes — only when each dart
  // leaves. (Jeff, 2026-10-03.)
  const order = targets.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = order[i]; order[i] = order[j]; order[j] = t;
  }
  /** slot[i] = when dart i is thrown, as a position in the cadence. */
  const slot = new Array(n);
  order.forEach((idx, pos) => { slot[idx] = pos; });

  const flyers = targets.map((mark, i) => {
    const isSuccess = i < successCount;    // targets are sorted: successes first
    // Landing spot: a uniform point inside the matching region of the board.
    const lx = isSuccess
      ? bd.left + rand() * (splitX - bd.left)
      : splitX + rand() * (bd.right - splitX);
    const ly = bd.top + rand() * bd.height;
    const tr = mark.getBoundingClientRect();
    const endSz = tr.width || 16;
    const landSz = Math.max(7, endSz * 0.55);  // a dart tip; it grows as it flies
    const dot = document.createElement('div');
    dot.className = flyerClass(isSuccess);
    // White ring + shadow so a dart stays visible when it lands on a region of
    // its own colour (amber on amber, blue on blue) and reads as sitting ON
    // the board rather than being part of it.
    dot.style.cssText = `position:fixed;left:0;top:0;width:${landSz}px;height:${landSz}px;`
      + 'z-index:1000;pointer-events:none;opacity:0;'
      + 'box-shadow:0 0 0 1.5px #fff, 0 2px 4px rgba(0,0,0,.45);';
    document.body.appendChild(dot);
    return {
      dot, isSuccess, launchTime: slot[i] * STAGGER, lx, ly, landSz, endSz,
      // Launched from above the board with a little drift, so it reads as thrown.
      launchX: lx + (rand() - 0.5) * 50,
      launchY: bd.top - 70 - rand() * 40,
      // The landing spot as a fraction of the board, for the footprint — the
      // board can be resized or re-rendered between draws.
      pctX: ((lx - bd.left) / bd.width) * 100,
      pctY: ((ly - bd.top) / bd.height) * 100,
      ex: tr.left + tr.width / 2, ey: tr.top + tr.height / 2,
    };
  });

  const place = (/** @type {HTMLElement} */ el, /** @type {number} */ cx,
                 /** @type {number} */ cy, /** @type {number} */ sz) => {
    el.style.left = `${cx - sz / 2}px`;
    el.style.top = `${cy - sz / 2}px`;
    el.style.width = `${sz}px`;
    el.style.height = `${sz}px`;
  };

  const run = trackRun(() => {
    for (const f of flyers) f.dot.remove();
    targets.forEach(t => { t.style.removeProperty('visibility'); });
  });

  let ghostsPlaced = false;
  const t0 = performance.now();
  function step(/** @type {number} */ now) {
    if (run.stopped()) return;
    const elapsed = now - t0;
    // The instant the darts lift off, stamp the footprints they leave.
    if (elapsed >= flyStart && !ghostsPlaced) {
      ghostsPlaced = true;
      if (ghostClass) {
        for (const f of flyers) {
          const g = document.createElement('div');
          g.className = ghostClass(f.isSuccess);
          g.dataset.scoopGhost = '1';
          const gSz = Math.max(9, f.landSz);  // sized so the fill shows under the ring
          g.style.left = `${f.pctX}%`;
          g.style.top = `${f.pctY}%`;
          g.style.width = `${gSz}px`;
          g.style.height = `${gSz}px`;
          board.appendChild(g);
        }
      }
    }
    for (const f of flyers) {
      if (elapsed < flyStart) {
        // THROW + HOLD: the dart drops onto the board, sticks, then waits.
        const tLand = elapsed - f.launchTime;
        if (tLand <= 0) { f.dot.style.opacity = '0'; place(f.dot, f.launchX, f.launchY, f.landSz); continue; }
        f.dot.style.opacity = String(Math.min(tLand / 70, 1));
        const e = easeOutBack(Math.min(tLand / DART_THROW, 1));
        place(f.dot, f.launchX + (f.lx - f.launchX) * e, f.launchY + (f.ly - f.launchY) * e, f.landSz);
      } else {
        // FLY: lift off the board and grow into the sample's dot.
        const ft = Math.min((elapsed - flyStart) / DART_FLY, 1);
        const e = ft < 0.5 ? 4 * ft * ft * ft : 1 - Math.pow(-2 * ft + 2, 3) / 2;
        const sz = f.landSz + (f.endSz - f.landSz) * e;
        place(f.dot, f.lx + (f.ex - f.lx) * e, f.ly + (f.ey - f.ly) * e, sz);
      }
    }
    if (elapsed < total) requestAnimationFrame(step);
    else {
      run.finish();
      targets.forEach(t => { t.style.removeProperty('visibility'); });
      flyers.forEach(f => f.dot.remove());
      done();
    }
  }
  requestAnimationFrame(step);
  return total;
}

// ─── Two statistics becoming one ────────────────────────────────────────

/** Converge, then let the result settle before it travels on. */
const COMBINE_STAT_MS = 620, COMBINE_STAT_SETTLE = 180;

/**
 * Fly two group statistics together into the one they make.
 *
 * On a two-group page the difference used to appear in the readout and then
 * set off for the distribution, which skips the step that matters: the number
 * being plotted is not a thing either group has, it is what you get by taking
 * one from the other. So the two means leave their own markers, meet on the
 * difference, and only then does the difference fly to the chart.
 * (Jeff, 2026-10-03: "say the sample means for each group first fly together to
 * suggest taking the difference then having it fly to the resampling
 * distribution.")
 *
 * Each flyer carries the colour of the marker it left, so the two arriving dots
 * are visibly the two lines you were just looking at.
 *
 * @param {object} opts
 * @param {Element[]} opts.sources - the markers the statistics leave from
 * @param {Element} opts.target - where they meet (the difference readout)
 * @param {() => void} [opts.onDone]
 * @returns {number} ms before the result is ready to travel on, 0 if it declined
 */
export function animateCombineStats({ sources, target, onDone }) {
  const done = () => { if (onDone) onDone(); };
  const srcs = (sources ?? []).filter(Boolean);
  if (prefersReducedMotion() || srcs.length < 2 || !target) { done(); return 0; }
  // Whatever a per-group draw parked is not what flies to the distribution.
  //
  // Each group's own resample animation parks its merged statistic on that
  // group's mean marker, for `animateDropToChart` to pick up — right on a
  // one-sample page, where that IS the statistic being plotted. Here it is one
  // of the two values about to be combined, so leaving it parked made the
  // DIFFERENCE set off from inside one of the resamples, undoing the journey
  // this function has just finished explaining. (Jeff, 2026-10-03: "the
  // difference mean should fly from that corner … right now it originates from
  // between the two resamples.")
  dismissAirborneStat();

  const tb = target.getBoundingClientRect();
  if (!tb.width && !tb.height) { done(); return 0; }
  const tx = tb.left + tb.width / 2;
  const ty = tb.top + tb.height / 2;

  const flyers = srcs.map((el) => {
    const r = el.getBoundingClientRect();
    // A marker line has zero width; its centre is still where it is.
    const sx = r.left + r.width / 2;
    const sy = r.top + r.height / 2;
    const colour = el.getAttribute?.('stroke') || '#7B2D8E';
    const dot = document.createElement('div');
    dot.className = 'stat-combine-flyer';
    dot.style.cssText = 'position:fixed;width:12px;height:12px;border-radius:50%;'
      + `background:${colour};z-index:1000;pointer-events:none;`
      + 'box-shadow:0 0 0 2px #fff, 0 1px 3px rgba(0,0,0,.4);'
      + `left:${sx - 6}px;top:${sy - 6}px;`;
    document.body.appendChild(dot);
    return { dot, sx, sy };
  });

  const run = trackRun(() => { for (const f of flyers) f.dot.remove(); });

  const t0 = performance.now();
  function step(/** @type {number} */ now) {
    if (run.stopped()) return;
    const t = Math.min((now - t0) / COMBINE_STAT_MS, 1);
    // Ease out: they set off quickly and arrive together, which is what makes
    // the meeting read as one event rather than two arrivals.
    const e = 1 - Math.pow(1 - t, 3);
    for (const f of flyers) {
      f.dot.style.left = `${f.sx + (tx - f.sx) * e - 6}px`;
      f.dot.style.top = `${f.sy + (ty - f.sy) * e - 6}px`;
      // Fade only at the very end, so they are solid for the whole journey and
      // vanish INTO the number rather than before reaching it.
      if (t > 0.86) f.dot.style.opacity = String((1 - t) / 0.14);
    }
    if (t < 1) requestAnimationFrame(step);
    else { run.finish(); flyers.forEach(f => f.dot.remove()); done(); }
  }
  requestAnimationFrame(step);
  return COMBINE_STAT_MS + COMBINE_STAT_SETTLE;
}
