// @ts-check
/**
 * Why ± 2 SE Works — the capture argument, drawn symbolically.
 *
 * Todd Will has taught this in Mathematica for years and asked for it here
 * (via Jeff, 2026-10-04): a sampling distribution with **no numbers on it at
 * all**, the axis marked `p−3SE … p+3SE`, a draggable statistic, and the
 * interval drawn under the axis so a student can see it reach the parameter —
 * or fail to. His note on the method was three words: "Empirical rule is
 * enough."
 *
 * The symbolic axis is the whole idea, not decoration. The equivalence being
 * taught is
 *
 *     |statistic − parameter| ≤ 2·SE   ⟺   parameter ∈ [statistic ± 2·SE]
 *
 * which is one fact about a distance read from two ends. Numbers on the axis
 * make it look like arithmetic you have to trust; in SE units the two arrows
 * are visibly the same length and the equivalence is something you can see. It
 * also means the band edges land exactly on tick marks at every level the
 * empirical rule names — ±1, ±2, ±3 — which is why this page offers 68 / 95 /
 * 99.7 and no other level.
 *
 * Deliberately NOT a simulation: no population, no data, no resampling. The
 * numeric versions of this argument already exist next door —
 * `conceptual/bootstrap-shift/` makes it for percentile intervals and
 * `conceptual/ci-coverage/` measures the coverage that results. This page is
 * the picture those two are evidence for.
 */

import { createRng, randNormal } from '../../js/prng.js';
import { announce, initHelp } from '../../js/page-utils.js';
import { prefersReducedMotion } from '../../js/settings.js';

// ─── Constants ───

/** Levels the empirical rule names, and their z. The band edge lands on a tick. */
const LEVELS = { '68': 1, '95': 2, '99.7': 3 };

/** Symbols per parameter kind: [parameter, statistic, statistic's decoration]. */
const SYMBOLS = {
  prop: { param: 'p', stat: 'p', hat: 'hat', statHtml: 'p̂', paramWord: 'proportion' },
  mean: { param: 'μ', stat: 'x', hat: 'bar', statHtml: '<span class="x-bar">x</span>', paramWord: 'mean' },
};

const CAPTURE = '#0072B2';   // Okabe–Ito blue — the interval reaches the parameter
const MISS = '#D55E00';      // Okabe–Ito vermillion — it does not
const BAND = '#569BBD';      // the IMS blue used for a region of interest everywhere else
const STAT_COLOR = '#7B2D8E'; // STAT_OBSERVED, as on every simulation chart
const AXIS = '#444';

const X_MIN = -3.7, X_MAX = 3.7;

/**
 * The viewBox is narrower on a phone, and that is what keeps the figure
 * readable.
 *
 * Type inside an SVG scales with the viewBox: 780 units squeezed into a 360px
 * screen shrinks every label to less than half size, and the first build was
 * illegible on a Pixel 5 even though it fitted. Holding the font sizes fixed
 * and shrinking the viewBox instead renders them near 1:1, so a phone gets a
 * taller, narrower picture with the same lettering — the curve loses width it
 * can spare, rather than the labels losing size they cannot.
 */
function geom(compact) {
  const W = compact ? 400 : 780;
  const H = compact ? 320 : 330;
  const M = compact
    ? { top: 50, right: 12, bottom: 96, left: 12 }
    : { top: 62, right: 20, bottom: 104, left: 20 };
  return { W, H, M, PLOT_W: W - M.left - M.right, PLOT_H: H - M.top - M.bottom };
}
/** Current geometry; set at the top of every render. */
let g = geom(false);

// ─── State ───

let paramKind = /** @type {'prop'|'mean'} */ ('prop');
let level = /** @type {keyof typeof LEVELS} */ ('95');
let zStat = 1.3;
let rng = createRng('two-se');
let drawn = 0, captured = 0;

// ─── DOM ───

const figure = /** @type {HTMLElement} */ (document.getElementById('tse-figure'));
const slider = /** @type {HTMLInputElement} */ (document.getElementById('stat-pos'));
const readout = /** @type {HTMLElement} */ (document.getElementById('stat-readout'));
const verdictsEl = /** @type {HTMLElement} */ (document.getElementById('verdicts'));
const samenessEl = /** @type {HTMLElement} */ (document.getElementById('sameness'));
const tallyEl = /** @type {HTMLElement} */ (document.getElementById('tally'));
const drawBtn = /** @type {HTMLButtonElement} */ (document.getElementById('draw-btn'));
const resetBtn = /** @type {HTMLButtonElement} */ (document.getElementById('reset-btn'));
const revealBtn = /** @type {HTMLButtonElement} */ (document.getElementById('reveal-btn'));
const answerEl = /** @type {HTMLElement} */ (document.getElementById('prompt-answer'));

// ─── Scales ───

const zc = () => LEVELS[level];
const sym = () => SYMBOLS[paramKind];
const pdf = (/** @type {number} */ x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
const PEAK = pdf(0);
const px = (/** @type {number} */ x) => g.M.left + ((x - X_MIN) / (X_MAX - X_MIN)) * g.PLOT_W;
const py = (/** @type {number} */ d) => g.M.top + g.PLOT_H - (d / PEAK) * g.PLOT_H;
const bottomOf = () => g.M.top + g.PLOT_H;

/** Does the interval reach the parameter? The question the page is about. */
const captures = () => Math.abs(zStat) <= zc();

// ─── Figure ───

const esc = (/** @type {string} */ s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/**
 * A tick label in SE units, written the way an instructor writes it on the
 * board: `p`, `p+SE`, `p−2SE`. Never `0`, `1`, `2` — a number on this axis is
 * the one thing the page is trying not to say.
 * @param {number} k
 */
function tickLabel(k) {
  const p = sym().param;
  if (k === 0) return p;
  const mag = Math.abs(k) === 1 ? 'SE' : `${Math.abs(k)}SE`;
  return `${p}${k < 0 ? '−' : '+'}${mag}`;
}

/**
 * The statistic's symbol, with its decoration drawn rather than typed.
 *
 * `p̂` is a letter plus a combining circumflex and `x̄` a letter plus a combining
 * macron, and in SVG both drift off the glyph depending on the font that
 * actually loaded. Drawing the hat and the bar as geometry puts them where they
 * belong at any size. (Same reason the HTML uses a bordered `.x-bar` span.)
 * @param {number} cx @param {number} cy @param {string} color
 */
function statSymbolSvg(cx, cy, color) {
  const s = sym();
  const letter = `<text x="${cx}" y="${cy}" text-anchor="middle" font-size="19" font-weight="700" fill="${color}">${s.stat}</text>`;
  if (s.hat === 'bar') {
    return letter + `<line x1="${cx - 6.5}" y1="${cy - 15.5}" x2="${cx + 6.5}" y2="${cy - 15.5}" stroke="${color}" stroke-width="1.8" stroke-linecap="round"/>`;
  }
  return letter + `<path d="M ${cx - 5.5} ${cy - 14} L ${cx} ${cy - 19.5} L ${cx + 5.5} ${cy - 14}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>`;
}

/** A double-headed arrow with a label above it. */
function labelArrow(x1, x2, y, color, label, labelDy = -6) {
  const head = (/** @type {number} */ x, /** @type {number} */ dir) =>
    `<path d="M ${x} ${y} l ${dir * 8} -4.5 l 0 9 Z" fill="${color}"/>`;
  return `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${color}" stroke-width="2.2"/>`
    + head(x2, x2 >= x1 ? -1 : 1)
    + `<text x="${(x1 + x2) / 2}" y="${y + labelDy}" text-anchor="middle" font-size="12.5"`
    + ` font-weight="700" fill="${color}">${label}</text>`;
}

/**
 * What the figure's *scaffold* depends on. Only these force a rebuild.
 * Dragging the statistic changes none of them.
 */
const layoutKey = () => `${paramKind}|${level}|${(figure.clientWidth || 780) < 560}`;
/** @type {string} */
let builtFor = '';
/** Where the statistic's symbol was drawn, so the nudge is relative to it. */
let builtStatX = 0;

/**
 * Move the statistic and its interval without rebuilding the figure.
 *
 * The first version re-wrote `figure.innerHTML` on every change, which threw
 * away the SVG the pointer had been captured on: `pointerdown` set the position
 * once, the element holding the listeners was destroyed, and every later
 * `pointermove` arrived at a brand-new element whose `dragging` flag was false.
 * Measured — a press at 30% of the width followed by moves to 40, 50, 60 and
 * 70% left the readout stuck on the press position through all four. (Jeff,
 * 2026-10-04: "somehow the slider resists motion or dragging.")
 *
 * So the scaffold is built once per layout and only these seven nodes move. It
 * is also what the figure should have done anyway: on a phone, rebuilding this
 * much markup per frame is the difference between a drag and a slideshow.
 */
function reposition() {
  const svgEl = figure.querySelector('svg');
  if (!svgEl) return;
  const z = zc();
  const s = sym();
  const hit = captures();
  const color = hit ? CAPTURE : MISS;
  const baseline = bottomOf();
  const barY = baseline + 48;
  // The bar is 2 SE either side of the statistic, ALWAYS, and must be drawn at
  // that length even when an end leaves the plot.
  //
  // It used to clamp to the domain, so the interval shrank exactly when the
  // statistic went extreme — 220px instead of 400px at z = 3.5, 45% short, in
  // the case the page exists to teach. A reader dragging outward watched the
  // interval get shorter, which is the opposite of the argument: the distance
  // is the same measured from either end. The SVG clips what runs past the
  // edge, which is the honest picture — the interval really does reach further
  // than the frame. (Todd Will via REQ-072, 2026-10-05.)
  const statX = px(zStat);
  const loX = px(zStat - z);
  const hiX = px(zStat + z);
  const set = (/** @type {string} */ id, /** @type {Record<string,string|number>} */ attrs) => {
    const el = svgEl.querySelector('#' + id);
    if (!el) return;
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  };

  set('tse-stat-line', { x1: statX, x2: statX });
  // The symbol is drawn at build time where the statistic then was, so it is
  // nudged by the difference rather than redrawn.
  const symG = svgEl.querySelector('#tse-stat-sym');
  if (symG) symG.setAttribute('transform', `translate(${(statX - builtStatX).toFixed(2)},0)`);

  set('tse-bar', { x1: loX, x2: hiX, stroke: color });
  set('tse-bar-lo', { x1: loX, x2: loX, stroke: color });
  set('tse-bar-hi', { x1: hiX, x2: hiX, stroke: color });
  set('tse-bar-dot', { cx: statX, fill: color });
  const label = svgEl.querySelector('#tse-bar-text');
  if (label) {
    // The caption rides the statistic (the bar's true midpoint) but stays in
    // the frame, so it is still readable when an end has run off.
    label.setAttribute('x', String(Math.max(90, Math.min(g.W - 90, statX))));
    label.setAttribute('fill', color);
    label.textContent = `statistic \u00B1 ${z}\u00A0SE${hit ? '' : ' \u2014 misses ' + s.param}`;
  }
  svgEl.setAttribute('aria-label', describe());
}

function rebuild() {
  const z = zc();
  const s = sym();
  const hit = captures();
  const barColor = hit ? CAPTURE : MISS;
  const compact = (figure.clientWidth || 780) < 560;
  g = geom(compact);
  const { W, H, M } = g;
  const baseline = bottomOf();

  // The curve, and the band under it.
  const pts = [];
  for (let i = 0; i <= 240; i++) {
    const x = X_MIN + (i / 240) * (X_MAX - X_MIN);
    pts.push(`${px(x).toFixed(2)},${py(pdf(x)).toFixed(2)}`);
  }
  const band = [];
  for (let i = 0; i <= 160; i++) {
    const x = -z + (i / 160) * (2 * z);
    band.push(`${px(x).toFixed(2)},${py(pdf(x)).toFixed(2)}`);
  }

  // Ticks: every SE mark. On a phone the labels collide, so only the ones that
  // carry the argument keep their text — the parameter and the two band edges.
  const ticks = [-3, -2, -1, 0, 1, 2, 3].map((k) => {
    const x = px(k);
    const show = !compact || k === 0 || Math.abs(k) === z;
    return `<line x1="${x}" y1="${baseline}" x2="${x}" y2="${baseline + 6}" stroke="${AXIS}" stroke-width="1.5"/>`
      + (show ? `<text x="${x}" y="${baseline + 22}" text-anchor="middle" font-size="${compact ? 13 : 13.5}"`
        + ` fill="${k === 0 ? '#111' : AXIS}" font-weight="${k === 0 ? 700 : 400}">${tickLabel(k)}</text>` : '');
  }).join('');

  const statX = px(zStat);
  const loX = px(zStat - z);
  const hiX = px(zStat + z);
  const barY = baseline + 48;
  const arrowY = py(PEAK * 0.3);

  // The parameter's own line, carried down through the interval bar: whether it
  // crosses the bar IS the verdict, so it has to be visible at the bar.
  //
  // Drawn in two segments with the tick label's row left clear. In one piece it
  // ran straight into the parameter's glyph and the two merged — a dashed stem
  // descending into "μ" reads as a **p**, which on a page whose other symbol is
  // literally p is the worst possible collision. (Todd Will via REQ-072.)
  const dash = (/** @type {number} */ y1, /** @type {number} */ y2) =>
    `<line x1="${px(0)}" y1="${y1}" x2="${px(0)}" y2="${y2}"`
    + ` stroke="#111" stroke-width="1.4" stroke-dasharray="3,3" opacity="0.65"/>`;
  const labelBand = compact ? 30 : 32;
  const paramLine = dash(M.top + 4, baseline) + dash(baseline + labelBand, barY + 14);

  const svg = `
<svg viewBox="0 0 ${W} ${H}" role="img" preserveAspectRatio="xMidYMid meet"
     aria-label="${esc(describe())}">
  <title>Sampling distribution of the ${s.paramWord}'s statistic, marked in standard errors</title>
  <text x="${W / 2}" y="20" text-anchor="middle" font-size="${compact ? 12.5 : 14.5}" fill="#555">
    Sampling distribution of the statistic &#8212; N(${esc(s.param)}, SE)
  </text>

  <polygon points="${px(-z).toFixed(2)},${baseline} ${band.join(' ')} ${px(z).toFixed(2)},${baseline}"
           fill="${BAND}" opacity="0.26"/>
  <polyline points="${pts.join(' ')}" fill="none" stroke="#2b6b8a" stroke-width="2.2"/>

  <text x="${px(0)}" y="${py(PEAK * 0.52)}" text-anchor="middle" font-size="17" font-weight="700"
        fill="#1b5e7e">${level}%</text>

  ${labelArrow(px(0), px(z), arrowY, BAND === '#569BBD' ? '#1b5e7e' : BAND, `${z}&#215;SE`)}
  ${labelArrow(px(0), px(-z), arrowY, '#1b5e7e', `${z}&#215;SE`)}

  <line x1="${M.left}" y1="${baseline}" x2="${W - M.right}" y2="${baseline}" stroke="${AXIS}" stroke-width="1.5"/>
  ${ticks}
  ${paramLine}

  <line id="tse-stat-line" x1="${statX}" y1="${M.top + 2}" x2="${statX}" y2="${barY}" stroke="${STAT_COLOR}" stroke-width="2.4"/>
  <g id="tse-stat-sym">${statSymbolSvg(statX, M.top - 8, STAT_COLOR)}</g>

  <line id="tse-bar" x1="${loX}" y1="${barY}" x2="${hiX}" y2="${barY}" stroke="${barColor}" stroke-width="3.4" stroke-linecap="butt"/>
  <line id="tse-bar-lo" x1="${loX}" y1="${barY - 8}" x2="${loX}" y2="${barY + 8}" stroke="${barColor}" stroke-width="3.4"/>
  <line id="tse-bar-hi" x1="${hiX}" y1="${barY - 8}" x2="${hiX}" y2="${barY + 8}" stroke="${barColor}" stroke-width="3.4"/>
  <circle id="tse-bar-dot" cx="${statX}" cy="${barY}" r="4.5" fill="${barColor}"/>
  <text id="tse-bar-text" x="${Math.max(90, Math.min(W - 90, statX))}" y="${barY + 26}" text-anchor="middle" font-size="13" font-weight="700"
        fill="${barColor}">statistic &#177; ${z}&#160;SE${hit ? '' : ' &#8212; misses ' + esc(s.param)}</text>
</svg>`;
  figure.innerHTML = svg;
  builtFor = layoutKey();
  builtStatX = statX;
  attachDrag();
}

/** One sentence describing the figure, for a screen reader and the aria-label. */
function describe() {
  const z = zc();
  const s = sym();
  const d = Math.abs(zStat).toFixed(2).replace(/\.?0+$/, '');
  return `The statistic sits ${d} standard errors ${zStat < 0 ? 'below' : 'above'} ${s.param}. `
    + `Its interval reaches ${z} SE either side, so it ${captures() ? 'contains' : 'misses'} ${s.param}. `
    + `${level}% of samples land within ${z} SE of ${s.param}.`;
}

// ─── Dragging ───

/**
 * Pointer drag on the figure, with the slider as the non-drag alternative the
 * accessibility checklist requires (it is also what keyboard users get).
 */
function attachDrag() {
  const svgEl = figure.querySelector('svg');
  if (!svgEl) return;
  let dragging = false;
  const toZ = (/** @type {PointerEvent} */ e) => {
    const r = svgEl.getBoundingClientRect();
    const xInView = ((e.clientX - r.left) / r.width) * g.W;
    const frac = (xInView - g.M.left) / g.PLOT_W;
    return Math.max(-3.5, Math.min(3.5, X_MIN + frac * (X_MAX - X_MIN)));
  };
  const move = (/** @type {PointerEvent} */ e) => {
    if (!dragging) return;
    e.preventDefault();
    setStat(toZ(e));
  };
  svgEl.addEventListener('pointerdown', (e) => {
    dragging = true;
    svgEl.setPointerCapture(e.pointerId);
    setStat(toZ(e));
  });
  svgEl.addEventListener('pointermove', move);
  svgEl.addEventListener('pointerup', () => { dragging = false; });
  svgEl.addEventListener('pointercancel', () => { dragging = false; });
  svgEl.style.touchAction = 'pan-y';
  svgEl.style.cursor = 'ew-resize';
}

// ─── Readouts ───

let lastHit = /** @type {boolean|null} */ (null);
/**
 * What the sentences below the figure currently say, so they are not rewritten
 * on every frame of a drag. Keyed on the verdict AND the level AND the symbols,
 * because the text names all three — gating on the verdict alone left "within
 * 2 SE" on screen after a switch to the 68% level.
 */
let paintedText = '';

/**
 * @param {number} z
 * @param {{announceChange?: boolean, fromSlider?: boolean}} [opts]
 */
function setStat(z, { announceChange = true, fromSlider = false } = {}) {
  zStat = Math.max(-3.5, Math.min(3.5, z));
  // Writing the value back into the control that is mid-drag makes it fight the
  // browser's own thumb tracking; the figure's drag is the only caller that
  // needs the slider moved for it.
  if (!fromSlider) slider.value = String(zStat);
  update({ announceChange });
}

function update({ announceChange = true } = {}) {
  const z = zc();
  const s = sym();
  const hit = captures();
  const dist = Math.abs(zStat);
  const near = dist.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');

  // Rebuild only when the scaffold itself changed — a level, a symbol set, or a
  // breakpoint. Dragging just moves seven nodes.
  if (layoutKey() !== builtFor) rebuild();
  reposition();

  readout.textContent = `${near} SE ${zStat < 0 ? 'below' : 'above'} ${s.param}`;
  slider.setAttribute('aria-valuetext', describe());

  // The two statements, side by side, always agreeing. Colour is never the only
  // channel: each line carries a glyph and says the verdict in words.
  const row = (/** @type {boolean} */ yes, /** @type {string} */ text) =>
    `<div class="tse-verdict ${yes ? 'is-yes' : 'is-no'}">`
    + `<span class="tse-glyph" aria-hidden="true">${yes ? '✓' : '✕'}</span>`
    + `<span>${text}</span></div>`;

  const textKey = `${hit}|${level}|${paramKind}`;
  if (textKey !== paintedText) verdictsEl.innerHTML =
    row(hit, `The statistic is <strong>${hit ? 'within' : 'more than'} ${z} SE</strong> of ${s.param}`
      + ` &mdash; it is ${hit ? 'inside' : 'outside'} the shaded ${level}% band.`)
    + row(hit, `Its interval <strong>${hit ? 'contains' : 'misses'}</strong> ${s.param}.`);

  if (textKey !== paintedText) samenessEl.innerHTML = hit
    ? `Both true &mdash; and they are the same statement.`
      + `<span class="tse-hint">The gap between ${s.statHtml} and ${s.param} is one distance. Reading it from`
      + ` ${s.param} says the sample was typical; reading it from ${s.statHtml} says the interval reaches back.</span>`
    : `Both false &mdash; and they are the same statement.`
      + `<span class="tse-hint">This is one of the ${(100 - Number(level)).toFixed(1).replace(/\.0$/, '')}% of samples that`
      + ` lands outside the band, and those are exactly the samples whose interval misses.</span>`;

  if (announceChange && lastHit !== null && lastHit !== hit) {
    announce(hit ? `Now inside the band — the interval contains ${s.param}.`
      : `Now outside the band — the interval misses ${s.param}.`);
  }
  lastHit = hit;
  paintedText = textKey;
  renderTally();
}

function renderTally() {
  if (drawn === 0) {
    tallyEl.innerHTML = `Press <strong>Draw a sample</strong> to let the computer pick a statistic from this curve.`;
    return;
  }
  const pct = (captured / drawn) * 100;
  tallyEl.innerHTML = `Samples drawn: <strong>${drawn}</strong> &middot; intervals containing `
    + `${sym().param}: <strong>${captured}</strong> (<strong>${pct.toFixed(drawn >= 100 ? 1 : 0)}%</strong>)`
    + ` &middot; advertised: <strong>${level}%</strong>`;
}

// ─── Actions ───

function drawSample() {
  const z = randNormal(0, 1, rng);
  drawn++;
  if (Math.abs(z) <= zc()) captured++;
  setStat(z);
  const s = sym();
  announce(`Drew a statistic ${Math.abs(z).toFixed(2)} SE ${z < 0 ? 'below' : 'above'} ${s.param}. `
    + `Its interval ${Math.abs(z) <= zc() ? 'contains' : 'misses'} ${s.param}. `
    + `${captured} of ${drawn} so far.`);
}

function resetTally() {
  drawn = 0; captured = 0;
  rng = createRng(seedFromUrl());
  renderTally();
  announce('Tally reset.');
}

// ─── URL ───

const params = new URLSearchParams(location.search);
const seedFromUrl = () => params.get('seed') || 'two-se';

function applyUrlParams() {
  const p = (params.get('param') || '').toLowerCase();
  if (p === 'mean' || p === 'prop') paramKind = p;
  const lv = params.get('ci') || params.get('level');
  if (lv && Object.prototype.hasOwnProperty.call(LEVELS, lv)) level = /** @type {any} */ (lv);
  const z = parseFloat(params.get('z') || '');
  if (Number.isFinite(z)) zStat = Math.max(-3.5, Math.min(3.5, z));
  rng = createRng(seedFromUrl());
  syncToggles();
  slider.value = String(zStat);
}

function syncToggles() {
  for (const b of document.querySelectorAll('#param-toggle button')) {
    b.setAttribute('aria-pressed', String(b.getAttribute('data-param') === paramKind));
  }
  for (const b of document.querySelectorAll('#level-toggle button')) {
    b.setAttribute('aria-pressed', String(b.getAttribute('data-level') === level));
  }
}

// ─── Wiring ───

document.getElementById('param-toggle')?.addEventListener('click', (e) => {
  const btn = /** @type {HTMLElement} */ (e.target).closest('button[data-param]');
  if (!btn) return;
  paramKind = /** @type {any} */ (btn.getAttribute('data-param'));
  syncToggles();
  update({ announceChange: false });
  announce(`Showing a population ${sym().paramWord}.`);
});

document.getElementById('level-toggle')?.addEventListener('click', (e) => {
  const btn = /** @type {HTMLElement} */ (e.target).closest('button[data-level]');
  if (!btn) return;
  level = /** @type {any} */ (btn.getAttribute('data-level'));
  // The tally counts captures at one level; changing the level makes the old
  // counts a mix of two rules, so they go rather than quietly mean nothing.
  drawn = 0; captured = 0;
  syncToggles();
  update({ announceChange: false });
  announce(`${level} percent level: the interval reaches ${zc()} SE either side.`);
});

slider.addEventListener('input', () => setStat(parseFloat(slider.value), { fromSlider: true }));
drawBtn.addEventListener('click', drawSample);
resetBtn.addEventListener('click', resetTally);

revealBtn?.addEventListener('click', () => {
  const open = answerEl.hidden;
  answerEl.hidden = !open;
  revealBtn.setAttribute('aria-expanded', String(open));
  revealBtn.textContent = open ? 'Hide the answer' : 'Show the answer';
  if (open) {
    const z = zc();
    answerEl.innerHTML = `<p>Whenever the statistic lands <strong>more than ${z} SE</strong> from `
      + `${sym().param} &mdash; that is, outside the shaded band. Those samples are about `
      + `<strong>${(100 - Number(level)).toFixed(1).replace(/\.0$/, '')}%</strong> of all samples, which is `
      + `exactly the ${(100 - Number(level)).toFixed(1).replace(/\.0$/, '')}% the confidence level leaves over.</p>`;
  }
});

document.addEventListener('keydown', (e) => {
  if (e.target !== document.body || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'd' || e.key === 'D') { e.preventDefault(); drawSample(); }
  if (e.key === 'r' || e.key === 'R') { e.preventDefault(); resetTally(); }
});

// Redraw on resize: the tick labels thin out on a narrow screen.
let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => { if (layoutKey() !== builtFor) { rebuild(); reposition(); } },
    prefersReducedMotion() ? 0 : 120);
});

initHelp();

(async () => {
  if (typeof window !== 'undefined' && /** @type {any} */ (window).__activityParamsReady) {
    try { await /** @type {any} */ (window).__activityParamsReady; } catch { /* ignore */ }
  }
  applyUrlParams();
  update({ announceChange: false });
})();
