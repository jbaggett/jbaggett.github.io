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

const MAX_MARBLES = 120;   // above this, the grid style falls back to bars
const MAX_FLY = 60;        // cap flying clones per draw (large n fills the rest instantly)

/** Count successes (1s) in a binary array. */
function counts(data) {
  const s = data.reduce((a, v) => a + (v === 1 ? 1 : 0), 0);
  return { s, f: data.length - s, n: data.length };
}

/** Pick a marble size that keeps the whole grid visible for sample size n. */
function marbleSize(n) {
  if (n <= 40) return 16;
  if (n <= 70) return 13;
  if (n <= 100) return 11;
  return 9;
}

/** Resolve the effective style (grid/dots fall back to bars when n is too large). */
function effStyle(style, n) {
  const s = (style === 'bars' || style === 'dots') ? style : 'grid';
  return (s !== 'bars') && n > MAX_MARBLES ? 'bars' : s;
}

// ── Two stacks of dots (prototype, ?mechstyle=dots) ──────────────────
//
// Jeff's idea: use DOTS for proportions, as the mean pages do, so the burst
// vocabulary carries straight over — a dot darkens with the number of times it
// was drawn, and what is never drawn stays pale.
//
// Why two stacks rather than the grid's one block. Darkening cannot carry the
// count if colour is also carrying the outcome: measured on the Okabe-Ito pair,
// amber-drawn-4× against blue-drawn-3× is a contrast of 1.03 — the same
// luminance. Okabe-Ito is the CVD-safe pair precisely because it separates on
// luminance as well as hue, so darkening spends the channel the safety rests
// on. Splitting successes and failures into two blocks makes POSITION carry the
// outcome; hue becomes redundant reinforcement, and darkness is free for the
// count. It also shows p̂ as a height ratio and makes the successes countable.
// (2026-10-01.)

/** Dot diameter for a stack of n — a little larger than the marble grid's. */
function dotSize(n) {
  if (n <= 40) return 15;
  if (n <= 70) return 12;
  if (n <= 100) return 10;
  return 8;
}

/**
 * Two blocks of dots: successes, then failures.
 *
 * @param {number[]} data binary (1 = success, 0 = failure)
 * @param {{label?: string}} [opts]
 * @returns {{el: HTMLElement, slots: HTMLElement[]}}
 */
function makeStacks(data, opts = {}) {
  const { s, f, n } = counts(data);
  const el = document.createElement('div');
  el.className = 'pbm-stacks';
  el.setAttribute('role', 'img');
  if (opts.label) el.setAttribute('aria-label', `${opts.label}: ${s} successes, ${f} failures`);
  el.style.setProperty('--mark-w', `${dotSize(n)}px`);
  /** @type {HTMLElement[]} */
  const slots = [];
  // Index order is preserved ACROSS the two blocks — slot i is observation i —
  // so a draw's index still names exactly one dot.
  const blocks = { 1: stackEl('success', s), 0: stackEl('failure', f) };
  for (let i = 0; i < n; i++) {
    const v = data[i] === 1 ? 1 : 0;
    const dot = document.createElement('span');
    dot.className = `obs-mark pbm-dot ${v ? 'pbm-success' : 'pbm-failure'}`;
    blocks[v].body.appendChild(dot);
    slots.push(dot);
  }
  el.appendChild(blocks[1].wrap);
  el.appendChild(blocks[0].wrap);
  return { el, slots };
}

/** One labelled block of a stack. */
function stackEl(kind, count) {
  const wrap = document.createElement('div');
  wrap.className = `pbm-stack is-${kind}`;
  const head = document.createElement('div');
  head.className = 'pbm-stack-count';
  head.textContent = String(count);
  const body = document.createElement('div');
  body.className = 'pbm-stack-body';
  wrap.appendChild(head);
  wrap.appendChild(body);
  return { wrap, body };
}

// ── Slot builders (empty unless `data` given) ───────────────────────

/**
 * Build a marble grid of n slots. Successes (amber) grouped first when filled.
 * @param {number} n
 * @param {{label?: string, data?: number[]}} [opts]
 * @returns {{el: HTMLElement, slots: HTMLElement[]}}
 */
function makeGrid(n, opts = {}) {
  const el = document.createElement('div');
  el.className = 'pbm-grid';
  el.setAttribute('role', 'img');
  if (opts.label) el.setAttribute('aria-label', opts.label);
  el.style.setProperty('--pbm-marble', `${marbleSize(n)}px`);
  const cols = Math.max(1, Math.round(Math.sqrt(n) * 1.3)); // roughly square grid
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
  el.className = 'pbm-fillbar';
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
    // `obs-mark` is the shared one-mark-per-observation component (geometry and
    // colour, css/style.css). The `pbm-*` classes stay as the arc-fly
    // animation's handles — only the marble grid takes the shared geometry; a
    // bar cell is a slice of a bar, not a mark.
    const base = slotClass === 'pbm-marble' ? `obs-mark ${slotClass}` : slotClass;
    if (s < 0) c.className = `${base} pbm-empty`;
    else c.className = `${base} ` + (i < s ? 'pbm-success' : 'pbm-failure');
    el.appendChild(c);
    slots.push(c);
  }
  return slots;
}

/** Build a filled (static) representation in the given style. */
function makeFilled(data, style, label) {
  const n = data.length;
  const st = effStyle(style, n);
  if (st === 'bars') return makeBar(n, { data, label }).el;
  if (st === 'dots') return makeStacks(data, { label }).el;
  return makeGrid(n, { data, label }).el;
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Render the original "bag".
 * @param {HTMLElement} container
 * @param {number[]} data binary (1 = success, 0 = failure)
 * @param {{style?: 'grid'|'bars', label?: string}} [opts]
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
 * @param {{style?: 'grid'|'bars'|'dots', animate?: boolean, indices?: number[]}} [opts]
 * @returns {number} animation duration in ms
 */
export function showPropResample(resampleEl, bagEl, resample, data, opts = {}) {
  if (!resampleEl) return 0;
  const style = (opts.style === 'bars' || opts.style === 'dots') ? opts.style : 'grid';
  const animate = !!opts.animate && !prefersReducedMotion() && !!bagEl;
  if (style === 'dots') {
    return showStackDraw(resampleEl, bagEl, resample, data, opts.indices ?? null, animate);
  }
  if (!animate) { renderPropResample(resampleEl, resample, { style }); return 0; }
  return animateEndsFill(resampleEl, bagEl, resample, data, style);
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
  const built = makeStacks(resample, { label: 'Resample' });
  built.el.classList.add('pbm-resample');
  resampleEl.appendChild(built.el);

  const bagDots = /** @type {HTMLElement[]} */ (Array.from(bagEl.querySelectorAll('.pbm-dot')));
  for (const d of bagDots) {
    d.classList.remove('pbm-untaken');
    d.style.removeProperty('--mark-depth');
  }
  if (!bagDots.length) return 0;

  // How many times each observation was taken. Without indices there is nothing
  // honest to say, so the bag is left alone rather than marked by a guess.
  if (!indices || !indices.length) return 0;
  const taken = new Array(bagDots.length).fill(0);
  for (const j of indices) if (j >= 0 && j < taken.length) taken[j]++;

  const MARK_MS = animate ? 520 : 0;
  taken.forEach((k, j) => {
    const dot = bagDots[j];
    if (!dot) return;
    const apply = () => {
      if (k === 0) dot.classList.add('pbm-untaken');
      // 1 → no darkening; each further draw goes one step down the ramp.
      else dot.style.setProperty('--mark-depth', String(Math.min(k, 4)));
    };
    if (!animate) apply();
    else setTimeout(apply, (j / bagDots.length) * MARK_MS);
  });
  return MARK_MS + 160;
}

/**
 * Build an empty resample (grid or bar), then fill inward from the two ends as
 * squares fly in from matching slots in the bag (drawn with replacement).
 * @returns {number} duration ms
 */
function animateEndsFill(resampleEl, bagEl, resample, data, style) {
  const n = resample.length;
  const built = effStyle(style, n) === 'bars'
    ? makeBar(n, { label: 'Resample' })
    : makeGrid(n, { label: 'Resample' });
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
  const FLY = 320;
  // Bound the total fill time regardless of n: small samples stagger ~34ms/cell;
  // large samples compress so the whole fill still finishes within FILL_WINDOW.
  const FILL_WINDOW = Math.min(1000, Math.max(1, n - 1) * 34);
  const per = n > 1 ? FILL_WINDOW / (n - 1) : 0;
  // Spread ~MAX_FLY flying clones across the sequence (don't fly all n for large n).
  const cloneEvery = Math.max(1, Math.ceil(n / MAX_FLY));

  steps.forEach((step, i) => {
    const slot = slots[step.slotIdx];
    const cls = step.v === 1 ? 'pbm-success' : 'pbm-failure';
    const fly = step.src && (i % cloneEvery === 0);
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
      // Arc the flyer up over the gap between bag and resample so it's easy to
      // track (a parabolic hop rather than a straight slide).
      const arc = Math.min(60, 24 + Math.abs(dx) * 0.06);
      clone.animate([
        { transform: 'translate(0, 0)' },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - arc}px)`, offset: 0.5 },
        { transform: `translate(${dx}px, ${dy}px)` },
      ], { duration: FLY, easing: 'cubic-bezier(.45,.05,.4,1)', fill: 'forwards' });
      setTimeout(() => {
        clone.remove();
        slot.classList.remove('pbm-empty');
        slot.classList.add(cls);
      }, FLY);
    }, i * per);
  });

  return FILL_WINDOW + FLY + 80;
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
