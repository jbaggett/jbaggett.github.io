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
 *   - 'grid' : both are marble grids (matches the Sampling Distribution Lab)
 *   - 'bars'   : both are proportion bars built from n cells
 *
 * CVD-safe Okabe-Ito colours: success = amber #C08700 (hatched), failure = blue #0072B2.
 */

import { prefersReducedMotion } from './chart-utils.js';
import { animateResampleDraw } from './mechanisms/draw-animation.js';

const MAX_MARBLES = 120;   // above this, no per-observation display survives

/**
 * Whether a sample of n can be drawn one mark per observation at all.
 *
 * The caller needs this to decide whether an Individual | Aggregate choice
 * exists: above the cap there is only the aggregate, so a toggle would be a
 * control with one working position. (Jeff, 2026-10-02.)
 *
 * @param {number} n
 * @returns {boolean}
 */
export function hasIndividualView(n) {
  return n > 0 && n <= MAX_MARBLES;
}
const MAX_FLY = 60;        // cap flying clones per draw (large n fills the rest instantly)

/** Count successes (1s) in a binary array. */
function counts(data) {
  const s = data.reduce((a, v) => a + (v === 1 ? 1 : 0), 0);
  return { s, f: data.length - s, n: data.length };
}

/**
 * Which of the two displays to draw.
 *
 * There are two, one per role: the dot BLOCK (individual — one mark per
 * observation, which can say which were drawn and how often) and the AGGREGATE
 * bar (two regions and a boundary, which does not get worse as n grows).
 *
 * There used to be four. The marble grid did the block's job in a second visual
 * language, and the cell bar drew the aggregate the expensive way — one span
 * per observation for a picture with two regions in it. Neither was reachable
 * from the UI any more, and keeping them meant every change to the mechanism
 * had to be made, and tested, in two dialects. They are retired here, and
 * `?mechstyle=grid` and `?mechstyle=bars` resolve to the survivor that does
 * their job, so older links and activities keep working. (Jeff, 2026-10-02:
 * "grid (which we should probably deprecate)".)
 */
function effStyle(style, n) {
  if (style === 'aggregate' || style === 'bars') return 'aggregate';
  const s = 'dots';
  // Past the cap NO per-observation display survives, the cell bar included.
  // It used to: `?mechstyle=bars` drew one span per observation at any n, so a
  // sample of 5,000 built 5,000 DOM nodes to draw a picture with two regions in
  // it. And at n = 224 the marks are 1.3px wide — a hatch, not a tally.
  //
  // Above the cap the display becomes the AGGREGATE: two regions and a
  // boundary, which is scale-free. What is lost is the individual, and the
  // individual stopped being legible well before this point. (2026-10-01.)
  return n > MAX_MARBLES ? 'aggregate' : s;
}

// ── One block of dots (prototype, ?mechstyle=dots) ───────────────────
//
// Jeff's idea: use DOTS for proportions, as the mean pages do, so the burst
// vocabulary carries over — a dot darkens with the number of times it was
// drawn, and what was never drawn stays pale.
//
// ONE block, not two. The first version drew successes and failures as two
// separated stacks, which Jeff rejected for a good reason: a gap between them
// reads as two groups being sampled separately, and a one-proportion bootstrap
// draws from a single bag of n. So the successes and failures are contiguous
// regions of one grid, in the shape the Sampling Distribution Lab uses for a
// population — a block split amber/blue.
//
// That still keeps POSITION carrying the outcome, which is what frees darkness
// to carry the count: measured on the Okabe-Ito pair, amber-drawn-4× against
// blue-drawn-3× is a contrast of 1.03, the same luminance. Okabe-Ito is the
// CVD-safe pair precisely because it separates on luminance as well as hue, so
// darkening spends the channel the safety rests on. A contiguous colour region
// with a straight boundary says "which outcome" without relying on that.
// (2026-10-01.)

/**
 * The bag's dots in OBSERVATION order, which is not the order they are in.
 *
 * `makeStacks` lays successes out first so the two colours form contiguous
 * regions, and keeps a separate index-ordered array for exactly that reason.
 * `showStackDraw` has only the rendered bag, read it with `querySelectorAll`,
 * and got DOM order — so `indices[i]`, which names an OBSERVATION, picked the
 * i-th dot on screen instead. Every mark landed on the wrong dot.
 *
 * It looked plausible: the multipliers still summed to n and the colours were
 * still right, so the bag looked like a bag. What gave it away was adding them
 * up — on medical_consultant the three amber dots carried x1, x4 and x2, seven
 * successes drawn, above a resample reading 0 S, 62 F. (Jeff, 2026-10-02.)
 *
 * @param {HTMLElement|null} bagEl
 * @returns {HTMLElement[]}
 */
function bagDotsByObservation(bagEl) {
  const els = /** @type {HTMLElement[]} */ (
    Array.from(bagEl?.querySelectorAll?.('.pbm-dot') ?? []));
  const out = new Array(els.length);
  for (const el of els) {
    const i = Number(el.dataset.obs);
    // Anything without the attribute: hand back what is there rather than
    // silently dropping dots on the floor.
    if (!Number.isInteger(i) || i < 0 || i >= els.length) return els;
    out[i] = el;
  }
  return out.every(Boolean) ? out : els;
}

/** Below this diameter a digit inside the dot is a smudge, not a number. */
const DIGIT_MIN_W = 13;

const DOT_GAP = 2;
/** Dot diameters tried, largest first. Quantised so the bag and the resample
 *  land on the same size even when their panels differ by a few pixels. */
const DOT_STEPS = [24, 22, 20, 18, 16, 14, 13, 12, 11, 10, 9, 8];
/** How tall the block is allowed to get. The panel is a strip, not a page. */
const BLOCK_H = 168;

/**
 * How to lay a block of n out in a panel `availW` px wide.
 *
 * The first version fixed the dot size by a table of n and made the block
 * roughly square (`cols = sqrt(n) * 1.3`). Both halves of that were wrong in
 * the same direction: at n = 62 it drew a 10-wide block of 17px dots, 188px
 * across in a panel more than twice that — small dots with most of the panel
 * empty beside them. (Jeff, 2026-10-01: "we could make the dots bigger by
 * making wider rows, we've got plenty of room here".)
 *
 * So the width decides instead. Take the largest dot size whose columns fit
 * across and whose rows fit down, then balance the rows so the last one is not
 * a stub. A wide rectangle is also the shape the Sampling Distribution Lab
 * uses for a population, which is the thing this block is meant to echo.
 *
 * Exported for tests: the arithmetic is the whole of the behaviour, and the
 * cases worth pinning (a panel 120px wide, n = 120) are ones no page produces.
 *
 * @param {number} n
 * @param {number} availW usable width in px; 0 when the panel is not on screen
 * @returns {{cols: number, size: number}}
 */
export function blockLayout(n, availW) {
  // Not measurable yet (hidden strip, detached node): a desktop panel's width,
  // which is also what the two-group pages give each half.
  const W = Math.max(availW || 0, 150) - 4;
  let size = DOT_STEPS[DOT_STEPS.length - 1];
  let cols = Math.max(1, Math.min(n, Math.floor((W + DOT_GAP) / (size + DOT_GAP))));
  // …but not a single line, however much room there is. A block 4 dots wide
  // for every 1 tall still reads as a rectangle; 10 in a row reads as a queue.
  const widest = Math.max(1, Math.ceil(Math.sqrt(n * 4)));
  for (const s of DOT_STEPS) {
    const maxCols = Math.max(1, Math.min(widest, Math.floor((W + DOT_GAP) / (s + DOT_GAP))));
    const maxRows = Math.max(1, Math.floor((BLOCK_H + DOT_GAP) / (s + DOT_GAP)));
    if (maxCols * maxRows < n) continue;
    size = s;
    // Balance: 62 in rows of 16 is 16/16/16/14, not 16/16/16/16/2.
    cols = Math.min(n, Math.ceil(n / Math.ceil(n / maxCols)));
    break;
  }
  return { cols, size };
}

/** How long the whole sample sits empty before the first draw leaves it. */
const GHOST_HOLD_MS = 550;

/**
 * One block of dots: successes first, then failures, contiguous.
 *
 * @param {number[]} data binary (1 = success, 0 = failure)
 * @param {{label?: string, width?: number, layout?: {cols:number,size:number}}} [opts]
 * @returns {{el: HTMLElement, slots: HTMLElement[]}}
 */
function makeStacks(data, opts = {}) {
  const { s, f, n } = counts(data);
  const layout = opts.layout ?? blockLayout(n, opts.width ?? 0);
  const el = document.createElement('div');
  el.className = 'pbm-block';
  el.style.setProperty('--mark-w', `${layout.size}px`);
  // Published so the resample can match the bag exactly rather than measuring
  // its own panel and landing a pixel off.
  el.dataset.cols = String(layout.cols);
  el.dataset.size = String(layout.size);

  const head = document.createElement('div');
  head.className = 'pbm-block-counts';
  // Two labelled tallies, not "3 of 62 59" — which reads as one broken phrase
  // with a stray number on the end, and leaves the 59 having to be guessed at.
  // Same wording as the proportion bar's in-region counts, so the two displays
  // say it the same way. n stays on the line under the block. (Jeff, 2026-10-01.)
  head.innerHTML = `<span class="is-success">${s} S</span>`
    + `<span class="pbm-of">, </span>`
    + `<span class="is-failure">${f} F</span>`;

  const body = document.createElement('div');
  body.className = 'pbm-block-body';
  // An explicit column count rather than `auto-fill`: one long wrapping row
  // does not read as a population, and the amber/blue boundary has to land
  // somewhere predictable.
  body.style.gridTemplateColumns = `repeat(${layout.cols}, var(--mark-w, 14px))`;
  body.setAttribute('role', 'img');
  if (opts.label) body.setAttribute('aria-label', `${opts.label}: ${s} successes, ${f} failures`);

  /** @type {HTMLElement[]} */
  const slots = [];
  // Index order is preserved: slot i is observation i, so a draw's index names
  // exactly one dot. Successes are laid out first so the two colours form
  // contiguous regions rather than a speckle.
  const order = [];
  for (let i = 0; i < n; i++) if (data[i] === 1) order.push(i);
  for (let i = 0; i < n; i++) if (data[i] !== 1) order.push(i);
  const byIndex = new Array(n);
  for (const i of order) {
    const dot = document.createElement('span');
    dot.className = `obs-mark pbm-dot ${data[i] === 1 ? 'pbm-success' : 'pbm-failure'}`;
    // Which observation this dot IS. The array below has it, but a caller
    // holding only the rendered bag has to read it back off the DOM — and the
    // DOM is in success-then-failure order, not observation order.
    dot.dataset.obs = String(i);
    body.appendChild(dot);
    byIndex[i] = dot;
  }
  for (let i = 0; i < n; i++) slots.push(byIndex[i]);

  el.appendChild(head);
  el.appendChild(body);
  return { el, slots };
}


/**
 * The aggregate display: two regions and a boundary, no per-observation marks.
 *
 * This is what a proportion IS, and it is the only display that does not get
 * worse as n grows. Above `MAX_MARBLES` it replaces the grid, the block and the
 * cell bar alike.
 *
 * On a resample it also carries a REFERENCE: the observed sample's boundary,
 * pinned as a dashed line that does not move, with the change written under it.
 * Without it a draw at n = 224 is a boundary shifting by 1.3% of the bar's
 * width against nothing — "it's hard to track anything happening in the
 * resamples since they don't change much" (Jeff, 2026-10-01). Measured against
 * a line that stays put, the same 1.3% is a visible gap. The reference is the
 * OBSERVED sample rather than the previous resample because that is what the
 * bootstrap distribution is centred on and what the interval is built around.
 *
 * @param {number[]} data binary
 * @param {string} [label]
 * @param {number|null} [reference] observed proportion to pin, 0..1
 * @returns {HTMLElement}
 */
function makeAggregate(data, label, reference = null) {
  const { s, f, n } = counts(data);
  const el = document.createElement('div');
  el.className = 'pbm-aggregate';
  el.innerHTML = propBarHTML(s, f, { className: 'pbm-aggbar' });
  const bar = el.querySelector('.mech-prop-bar');
  if (bar) placeAggCounts(bar, s, f);
  if (label && bar) bar.setAttribute('aria-label', `${label}: ${s} successes, ${f} failures`);
  if (reference != null && bar && n > 0) {
    const pct = Math.max(0, Math.min(1, reference)) * 100;
    const ref = document.createElement('div');
    ref.className = 'pbm-ref';
    ref.style.left = `${pct}%`;
    bar.appendChild(ref);
    el.appendChild(deltaEl(s, n, reference));
  }
  return el;
}

/**
 * Each count at the OUTER end of its own region, and out of the bar only if its
 * own region cannot hold it.
 *
 * `propBarHTML`'s rule is a percentage — a region narrower than 18% drops BOTH
 * counts below the bar — which is right for the panels it was written for and
 * wrong here. "Room" is pixels of text against pixels of region, and the
 * aggregate bar is wide: at n = 224 a 14.7% success region is still ~70px,
 * plenty for "33 S", yet the percentage rule exiled both counts to a grey line
 * underneath. (Jeff, 2026-10-01: "there's plenty of room to show the counts
 * inside the bars".)
 *
 * So the decision is made per region and in pixels, after layout. A count that
 * does not fit moves below the bar at its own end — in its own colour rather
 * than grey, which is the other half of what was asked for — and the other one
 * stays inside regardless. Centring is dropped too: pushed to the outer ends,
 * the two counts sit at the extremes of the thing they are counting and the
 * boundary between them is left clear.
 *
 * Scoped to the aggregate; the bars on the randomization pages keep the
 * placement settled on 2026-09-29.
 *
 * @param {Element} bar the `.mech-prop-bar`
 * @param {number} s
 * @param {number} f
 */
function placeAggCounts(bar, s, f) {
  const n = s + f;
  const pct = n > 0 ? (s / n) * 100 : 0;
  bar.parentElement?.querySelector('.mech-prop-aside')?.remove();
  bar.querySelectorAll('.mech-prop-count').forEach(el => el.remove());
  // The text sits in its own span. The count itself is a clipped flex box, so
  // its `scrollWidth` is just its own width — it reports the region, never the
  // text — and a fit test built on it evicts everything. The inner span is a
  // flex item that keeps its natural width, which is the number to compare.
  bar.insertAdjacentHTML('beforeend',
    `<span class="mech-prop-count pbm-count is-success" style="width:${pct}%">`
    + `<span class="pbm-count-t">${s} S</span></span>`
    + `<span class="mech-prop-count pbm-count is-failure" style="left:${pct}%;width:${100 - pct}%">`
    + `<span class="pbm-count-t">${f} F</span></span>`);
}

/**
 * Measure, then evict what does not fit. Separate from `placeAggCounts` because
 * it can only run once the bar is in the document and has a width.
 * @param {Element|null} bar
 */
function fitAggCounts(bar) {
  const el = /** @type {HTMLElement|null} */ (bar);
  if (!el || !el.isConnected) return;
  const barW = el.getBoundingClientRect().width;
  if (!barW) return;
  for (const c of el.querySelectorAll('.pbm-count')) {
    const span = /** @type {HTMLElement} */ (c);
    span.classList.remove('is-outside');
    const region = barW * (parseFloat(span.style.width) || 0) / 100;
    const text = span.querySelector('.pbm-count-t');
    const w = text ? text.getBoundingClientRect().width : span.scrollWidth;
    if (w + 12 > region) span.classList.add('is-outside');
  }
}

/** "−3 successes · p̂ 0.147 → 0.134" — what moved, in counts and in the statistic. */
function deltaEl(/** @type {number} */ s, /** @type {number} */ n, /** @type {number} */ reference) {
  const was = Math.round(reference * n);
  const d = s - was;
  const el = document.createElement('div');
  el.className = 'pbm-delta';
  const sign = d > 0 ? '+' : d < 0 ? '\u2212' : '\u00B10';
  const mag = d === 0 ? '' : String(Math.abs(d));
  const word = Math.abs(d) === 1 ? 'success' : 'successes';
  el.innerHTML = `<span class="pbm-delta-n">${sign}${mag} ${word}</span>`
    + `<span class="pbm-delta-sep"> \u00B7 </span>`
    + `<span class="pbm-delta-p">p\u0302 ${fmtProp(reference)} \u2192 ${fmtProp(s / n)}</span>`;
  return el;
}

/** Three decimals, the precision these pages print a proportion at. */
function fmtProp(/** @type {number} */ p) {
  return p.toFixed(3);
}

/** Build a filled (static) representation in the given style. */
function makeFilled(data, style, label, width = 0, layout = null, reference = null) {
  const n = data.length;
  return effStyle(style, n) === 'aggregate'
    ? makeAggregate(data, label, reference)
    : makeStacks(data, { label, width, layout: layout ?? undefined }).el;
}

/** Usable width of a panel, 0 while it is hidden or not yet laid out. */
function usableWidth(container) {
  return container ? Math.round(container.getBoundingClientRect().width) : 0;
}

/** The layout a already-rendered block chose, so another can match it. */
function layoutOf(container) {
  const el = container?.querySelector?.('.pbm-block');
  const cols = Number(el?.dataset.cols), size = Number(el?.dataset.size);
  return (cols > 0 && size > 0) ? { cols, size } : null;
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Render the original "bag".
 * @param {HTMLElement} container
 * @param {number[]} data binary (1 = success, 0 = failure)
 * @param {{style?: 'grid'|'bars'|'dots', label?: string}} [opts]
 */
export function renderPropBag(container, data, opts = {}) {
  if (!container) return;
  container.innerHTML = '';
  const el = makeFilled(data, opts.style, opts.label || 'Original sample', usableWidth(container));
  el.classList.add('pbm-bag');
  container.appendChild(el);
  fitAggCounts(el.querySelector('.mech-prop-bar'));
}

/** Render a resample statically (no animation). */
export function renderPropResample(container, resample, opts = {}) {
  if (!container) return;
  container.innerHTML = '';
  const el = makeFilled(resample, opts.style, 'Resample', usableWidth(container),
    opts.layout ?? null, opts.reference ?? null);
  el.classList.add('pbm-resample');
  container.appendChild(el);
  fitAggCounts(el.querySelector('.mech-prop-bar'));
}

/**
 * Show a resample. On +1 (animate), it fills from the two ends — successes from
 * the left, failures from the right — as squares fly in from the bag.
 * @param {HTMLElement} resampleEl
 * @param {HTMLElement} bagEl
 * @param {number[]} resample
 * @param {number[]} data - original sample
 * @param {{style?: 'grid'|'bars'|'dots', animate?: boolean, indices?: number[]}} [opts]
 * @returns {number} animation duration in ms
 */
export function showPropResample(resampleEl, bagEl, resample, data, opts = {}) {
  if (!resampleEl) return 0;
  // Through `effStyle`, as the bag is: it is what retires a per-mark display
  // when n outgrows it. Branching on the raw style skipped that, so at n = 224
  // the original sample drew a bar and the resample beside it drew 224 dots —
  // the two panels of one comparison in two different languages.
  // (Jeff, 2026-10-01.)
  const style = effStyle(opts.style, resample.length);
  const animate = !!opts.animate && !prefersReducedMotion() && !!bagEl;
  // The observed proportion, which the aggregate view pins as its reference.
  const reference = data.length ? counts(data).s / data.length : null;
  if (style === 'aggregate') {
    return showAggregateDraw(resampleEl, bagEl, resample, reference, animate);
  }
  return showStackDraw(resampleEl, bagEl, resample, data, opts.indices ?? null, animate);
}

/**
 * The aggregate draw: the boundary leaves the pinned observed line and settles
 * at the resample's proportion.
 *
 * It STARTS at the reference rather than at zero or at wherever the last
 * resample left it. That is the whole of the animation's argument: this draw
 * came from that sample, and here is how far it got. A width that simply
 * appears says nothing about where it came from, and a width that grows from
 * zero says something false — the resample was not built up from nothing.
 *
 * @param {HTMLElement} resampleEl
 * @param {number[]} resample
 * @param {number|null} reference observed proportion, 0..1
 * @param {boolean} animate
 * @returns {number} duration ms
 */
function showAggregateDraw(resampleEl, bagEl, resample, reference, animate) {
  const { s, f, n } = counts(resample);
  resampleEl.innerHTML = '';
  const el = makeAggregate(resample, 'Resample', reference);
  el.classList.add('pbm-resample');
  resampleEl.appendChild(el);
  fitAggCounts(el.querySelector('.mech-prop-bar'));
  if (!animate || n === 0) return 0;

  const bar = /** @type {HTMLElement|null} */ (el.querySelector('.mech-prop-bar'));
  const fill = /** @type {HTMLElement|null} */ (bar?.querySelector('.mech-prop-fill'));
  if (!bar || !fill) return 0;

  const sPct = (s / n) * 100, fPct = (f / n) * 100;

  // ── Beat 1: the draw ──────────────────────────────────────────────
  // Both regions grow in from the ends and meet where the boundary belongs,
  // with an "undrawn" gap closing between them. The bar sorts its outcomes, so
  // growing from the ends is what accumulation looks like here — it is the
  // language `animateEndsFill` already gave the cell bar, carried to a display
  // that has no cells to fill.
  const gap = document.createElement('div');
  gap.className = 'pbm-undrawn';
  gap.style.left = '0%';
  gap.style.width = '100%';
  bar.appendChild(gap);
  fill.style.transition = 'none';
  fill.style.width = '0%';

  // …and flecks leave the bag while it happens, so the draw has a source. Not
  // one per observation: at n = 224 that is noise, and the resample's own marks
  // were retired for the same reason. A couple of dozen says "from there, with
  // replacement" without pretending to show 224 flights. Their COLOURS are the
  // resample's own split, and each leaves a random point inside the matching
  // region of the bag — which is what a draw actually is.
  const flecks = Math.max(6, Math.min(22, Math.round(n / 10)));
  const amber = Math.round(flecks * (s / n));
  const src = bagBarGeometry(bagEl);
  const dst = bar.getBoundingClientRect();
  if (src) {
    for (let i = 0; i < flecks; i++) {
      const isS = i < amber;
      const sx = src.x0
        + (isS ? Math.random() * src.split
               : src.split + Math.random() * (src.x1 - src.x0 - src.split));
      const ex = dst.left + dst.width
        * (isS ? Math.random() * (sPct / 100)
               : (sPct / 100) + Math.random() * (fPct / 100));
      const delay = Math.round((i / flecks) * (DRAW_MS * 0.6));
      // Built at launch, not up front: creating all of them at t = 0 left two
      // dozen dots sitting on the bag waiting their turn, which read as part of
      // the bag rather than as something leaving it.
      setTimeout(() => {
        const t = document.createElement('div');
        t.className = 'pbm-fleck';
        // A little vertical scatter: launched dead level they arrive as a
        // dotted rule between the panels rather than as separate draws.
        const jy = (Math.random() - 0.5) * (dst.height * 0.7);
        t.style.cssText = `left:${sx}px;top:${src.y + jy}px;`
          + `background:${isS ? 'var(--obs-success-bg,#C08700)' : 'var(--obs-failure-bg,#0072B2)'};`
          + `animation:pbm-fleck ${FLECK_MS}ms ease forwards;`;
        document.body.appendChild(t);
        // The fade lives in the keyframes so it holds full strength for most of
        // the flight; a transition on opacity made every fleck faint by the
        // time it had got anywhere.
        requestAnimationFrame(() => {
          t.style.transition = `transform ${FLECK_MS}ms cubic-bezier(.4,0,.55,1)`;
          t.style.transform =
            `translate(${ex - sx}px, ${dst.top + dst.height / 2 - src.y - jy}px)`;
        });
        setTimeout(() => t.remove(), FLECK_MS + 60);
      }, delay);
    }
  }

  // ── Beat 2: how far it moved ──────────────────────────────────────
  // The reference and the change arrive AFTER the draw. During the draw there
  // is nothing yet to compare; once the boundary has settled, the line drops in
  // and the gap between them is the whole point.
  const ref = /** @type {HTMLElement|null} */ (el.querySelector('.pbm-ref'));
  const delta = /** @type {HTMLElement|null} */ (el.querySelector('.pbm-delta'));
  // Hidden with NO transition declared yet. Setting both at once meant the
  // jump to 0 was itself a (delayed) transition, which the jump back to 1
  // cancelled before it ever started — so the line and the delta were simply
  // visible the whole time and the second beat never happened.
  for (const node of [ref, delta]) { if (node) node.style.opacity = '0'; }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      // Gentle at both ends. The first try used `cubic-bezier(.33,1,.68,1)`,
      // which put most of the travel in the first 200ms — the gap did not close,
      // it snapped, and an accumulation that snaps is not an accumulation.
      const ease = `cubic-bezier(.45,.05,.35,1)`;
      fill.style.transition = `width ${DRAW_MS}ms ${ease}`;
      fill.style.width = `${sPct}%`;
      gap.style.transition = `left ${DRAW_MS}ms ${ease}, width ${DRAW_MS}ms ${ease}`;
      gap.style.left = `${sPct}%`;
      gap.style.width = '0%';
      for (const node of [ref, delta]) {
        if (!node) continue;
        node.style.transition = `opacity ${REVEAL_MS}ms ease ${DRAW_MS - 60}ms`;
        node.style.opacity = '1';
      }
    });
  });
  setTimeout(() => gap.remove(), DRAW_MS + 80);
  return DRAW_MS + REVEAL_MS + 80;
}

/** How long the two ends take to meet, and the comparison to arrive after. */
const DRAW_MS = 1150;
const REVEAL_MS = 320;
const FLECK_MS = 460;

/**
 * Where the bag's bar is on screen, and where its amber ends — so a fleck can
 * leave a random point inside the region that matches what it represents.
 * @param {HTMLElement|null} bagEl
 * @returns {{x0:number, x1:number, y:number, split:number}|null}
 */
function bagBarGeometry(bagEl) {
  const bar = bagEl?.querySelector?.('.mech-prop-bar');
  if (!bar) return null;
  const r = bar.getBoundingClientRect();
  const fill = bar.querySelector('.mech-prop-fill');
  const w = fill ? fill.getBoundingClientRect().width : 0;
  return { x0: r.left, x1: r.right, y: r.top + r.height / 2, split: w };
}

/**
 * The dots prototype: mark the BAG with what the draw actually did, and build
 * the resample beside it.
 *
 * The grid animation picks its source cell by arithmetic on the destination
 * slot — `(slotIdx * 7 + 3) % pool.length` — which walks every marble once
 * before repeating anything, so it draws a picture of sampling WITHOUT
 * replacement. With the real indices a dot can say how many times it was taken,
 * by getting darker, and a dot never taken stays pale. That is the mean pages'
 * vocabulary, unchanged. (2026-10-01.)
 *
 * @param {HTMLElement} resampleEl
 * @param {HTMLElement} bagEl
 * @param {number[]} resample
 * @param {number[]} data
 * @param {number[]|null} indices - which observation each draw took
 * @param {boolean} animate
 * @returns {number} duration ms
 */
function showStackDraw(resampleEl, bagEl, resample, data, indices, animate) {
  resampleEl.innerHTML = '';
  // Match the bag's layout rather than measuring again: the two blocks sit side
  // by side and a dot that flies between them should land the same size.
  const built = makeStacks(resample, {
    label: 'Resample',
    width: usableWidth(resampleEl),
    layout: layoutOf(bagEl) ?? undefined,
  });
  built.el.classList.add('pbm-resample');
  resampleEl.appendChild(built.el);

  const bagDots = bagDotsByObservation(bagEl);
  for (const d of bagDots) {
    d.classList.remove('pbm-untaken');
    d.textContent = '';
    d.style.removeProperty('--mark-depth');
  }
  // Without indices there is nothing honest to say about which observation went
  // where, so the bag is left alone rather than marked by a guess.
  if (!bagDots.length || !indices || !indices.length) return 0;

  // Whatever size the bag actually came out at decides whether a numeral fits.
  const bagSize = Number(layoutOf(bagEl)?.size) || 0;
  const digits = bagSize >= DIGIT_MIN_W;

  /** Empty a bag dot: an outline, so "not taken" stays a perceivable shape. */
  const ghost = (/** @type {Element} */ el) => {
    el.classList.add('pbm-untaken');
    el.textContent = '';
    /** @type {HTMLElement} */ (el).style.removeProperty('--mark-depth');
  };
  /** Fill one in, darker each time it is taken again. */
  const reveal = (/** @type {Element} */ el, /** @type {number} */ n) => {
    el.classList.remove('pbm-untaken');
    // 1 → the mark's own colour; each further draw steps down its ramp. Which
    // ramp is decided by the stack the dot is in, which is why this lives here.
    if (n > 1) /** @type {HTMLElement} */ (el).style.setProperty('--mark-depth', String(Math.min(n, 4)));
    // …and when the dot is big enough, the count is also written in it, the
    // way burst does on the mean pages. Both, not either: the digit is white,
    // and white needs the darkened fill to clear 4.5:1 — on the undarkened
    // amber it is 3.13:1. The darkening is what makes the number readable as
    // well as a redundant signal that there is one. A bare numeral, no ×,
    // matching `badge()`.
    if (digits && n > 1) el.textContent = String(Math.min(n, 9));
  };

  if (!animate) {
    const taken = new Array(bagDots.length).fill(0);
    for (const j of indices) if (j >= 0 && j < taken.length) taken[j]++;
    taken.forEach((k, j) => { if (k === 0) ghost(bagDots[j]); else reveal(bagDots[j], k); });
    return 0;
  }

  // The DRAW itself, by the same animation the mean pages use — each dot flies
  // from the observation it was actually taken from, and that observation fills
  // in as it goes. Reusing it rather than writing a second one is the point:
  // one animation, two kinds of data. (Jeff, 2026-10-01.)
  // `built.slots` is in OBSERVATION order — slot i is draw i — which is exactly
  // what the animation wants, since `indices[i]` is where draw i came from.
  const slots = built.slots.filter(Boolean);

  const ms = animateResampleDraw({
    sourceCircles: bagDots, targetDots: slots, indices, style: 'burst',
    onGhost: ghost, onReveal: reveal, leadIn: GHOST_HOLD_MS,
  });
  return ms || 0;
}

// ─── The counts on a proportion bar ─────────────────────────────────────

/**
 * How narrow a region can get before its count stops fitting inside it.
 *
 * The bars run ~300–490px and a count is two or three characters, so ~18% is
 * where "84" starts touching the edges. Below that the pair moves out of the
 * bar rather than being squeezed or clipped.
 */
const MIN_REGION_PCT = 18;

/**
 * The bar, with its success and failure counts.
 *
 * Both counts used to be written as one centred string — `84 S / 116 F` —
 * straddling the boundary between the two regions. The slash then reads as a
 * fraction bar: 84 over 116, which is not a number that exists here. They are
 * two counts that sum to n. (Jeff, 2026-09-29.)
 *
 * So each count goes inside the region it counts, centred: white on the fill
 * (4.56:1 against #3A7CA5, so it stands on its own without the text-shadow it
 * used to lean on) and near-black on the grey remainder (12.3:1). Being on
 * opposite sides of the division is what says they are two separate tallies.
 *
 * When one region is too narrow to hold its count, both move below the bar and
 * are joined with a middle dot rather than a slash — still two counts, still
 * not a fraction.
 *
 * @param {number} successes
 * @param {number} failures
 * @param {{ className?: string, style?: string }} [opts]
 * @returns {string}
 */
export function propBarHTML(successes, failures, opts = {}) {
  const n = successes + failures;
  const pct = n > 0 ? (successes / n) * 100 : 0;
  const cls = opts.className ? ` ${opts.className}` : '';
  const style = opts.style ? ` style="${opts.style}"` : '';
  const aria = `${successes} successes, ${failures} failures`;
  const bar = `<div class="mech-prop-bar${cls}" aria-label="${aria}"${style}>`
    + `<div class="mech-prop-fill" style="width:${pct}%"></div>`
    + countsHTML(successes, failures, pct)
    + '</div>';
  return roomInside(pct) ? bar : bar + asideHTML(successes, failures);
}

/** Whether both regions can hold their own count. */
function roomInside(/** @type {number} */ pct) {
  return pct >= MIN_REGION_PCT && pct <= 100 - MIN_REGION_PCT;
}

function countsHTML(/** @type {number} */ s, /** @type {number} */ f, /** @type {number} */ pct) {
  if (!roomInside(pct)) return '';
  return `<span class="mech-prop-count is-success" style="width:${pct}%">${s} S</span>`
    + `<span class="mech-prop-count is-failure" style="left:${pct}%">${f} F</span>`;
}

function asideHTML(/** @type {number} */ s, /** @type {number} */ f) {
  return `<div class="mech-prop-aside">${s} S &middot; ${f} F</div>`;
}

/**
 * Update a bar in place — the resample animates its width rather than being
 * rebuilt, so the counts have to follow without the markup being replaced.
 *
 * @param {Element|null} barEl - the `.mech-prop-bar`
 * @param {number} successes
 * @param {number} failures
 * @param {{ animate?: boolean }} [opts]
 */
export function updatePropBar(barEl, successes, failures, opts = {}) {
  if (!barEl) return;
  const n = successes + failures;
  const pct = n > 0 ? (successes / n) * 100 : 0;
  barEl.setAttribute('aria-label', `${successes} successes, ${failures} failures`);
  const fill = /** @type {HTMLElement|null} */ (barEl.querySelector('.mech-prop-fill'));
  if (fill) {
    if (opts.animate) fill.style.transition = 'width 400ms ease, opacity 300ms ease';
    fill.style.width = `${pct}%`;
    fill.style.opacity = '1';
  }
  barEl.querySelectorAll('.mech-prop-count').forEach(el => el.remove());
  barEl.insertAdjacentHTML('beforeend', countsHTML(successes, failures, pct));
  // The out-of-bar fallback is a SIBLING, so it is managed here too — a bar
  // that crosses the threshold in either direction has to gain or lose it.
  const aside = barEl.nextElementSibling?.classList.contains('mech-prop-aside')
    ? barEl.nextElementSibling : null;
  if (roomInside(pct)) aside?.remove();
  else if (aside) aside.innerHTML = `${successes} S &middot; ${failures} F`;
  else barEl.insertAdjacentHTML('afterend', asideHTML(successes, failures));
  if (opts.animate) {
    barEl.querySelectorAll('.mech-prop-count').forEach((el) => {
      /** @type {HTMLElement} */ (el).style.transition = 'opacity 250ms ease';
      /** @type {HTMLElement} */ (el).style.opacity = '1';
    });
  }
}
