// @ts-check
/**
 * Bootstrap Shift — why the percentile CI works.
 *
 * Two stages on ONE shared x-axis (Todd Will's design, 2026-09-05):
 *
 *   Stage 1  Repeated samples of n from a visible ~200-dot population. Each
 *            sample highlights its dots (darker where a dot is drawn more than
 *            once) and drops its x-bar into the BLUE distribution below — the
 *            true sampling distribution.
 *
 *   Stage 2  One sample is frozen (chosen by its mean via a slider) and
 *            highlighted in RED inside the population, blown up in an inset.
 *            Bootstrap resamples from THAT sample build the RED distribution,
 *            overlaid on the blue one, so the shift is visible.
 *
 * The thesis the page is built to test: if the bootstrap distribution were
 * exactly the sampling distribution translated from mu to x-bar, then the
 * percentile CI captures mu precisely when x-bar lands in the central 95% of
 * the sampling distribution. Both verdicts are shown every frame so a student
 * can sweep the slider and watch them agree — and see WHERE they stop agreeing,
 * which is the honest lesson: at small n the bootstrap SE is estimated from one
 * sample, so the translate is only approximate.
 *
 * Rendering is hand-built inline SVG rather than drawDotplot: the population is
 * an integer-stack dotplot of individually addressable, labelled circles (dot
 * identity matters — the same dot resampled twice must darken), and the lower
 * panel overlays two densities on a shared y-scale. Neither is what the shared
 * dotplot renderer does.
 */

import { createRng } from '../../js/prng.js';
import { quantile, sd } from '../../js/stats.js';
import { normCDF, invNorm } from '../../js/ci-method.js';
import { initHelp, initSettings, initKeyboardShortcuts, announce } from '../../js/page-utils.js';
import { prefersReducedMotion } from '../../js/settings.js';
import { flyOntoTargets } from '../../js/dotplot-resample.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POP_N = 200;          // target population size (exact count is rounding-dependent)
const POOL = 4000;          // pre-drawn samples — the "true" sampling distribution
const BOOT = 4000;          // pre-drawn bootstrap resamples
const CI_LEVEL = 0.95;
const BAND_MIN = 200;       // resamples/samples before a CI or band is trustworthy enough to draw
/** Charcoal — the ±z·SE comparison bracket. Neutral on purpose: it is a
 *  reference line, not a third distribution, and must not fight blue vs red. */
const SE_COLOR = '#3B3B3B';

/** True sampling distribution — blue. Solid outline. */
const BLUE = '#0072B2';
const BLUE_FILL = 'rgba(0, 114, 178, 0.22)';
/** Bootstrap distribution — red. Dashed outline + diagonal hatch (never colour alone). */
const RED = '#C0341C';
const RED_FILL = '#F05133';

/* Shared viewBox geometry for BOTH panels — identical VW/ML/MR is what keeps the
   two x-axes aligned, so a mean in the population drops straight onto its dot in
   the distribution below. On a phone the panels are ~340px wide; at VW = 760 that
   is a 0.45 scale factor and the lower plot collapses to an unreadable strip, so
   the viewBox itself narrows and the content scales up instead. */
let VW = 760;
let ML = 46, MR = 22;
let INNER_W = VW - ML - MR;
/** Font-size multiplier — viewBox units get smaller on screen when VW shrinks. */
let FSCALE = 1;
const fs = (/** @type {number} */ px) => +(px * FSCALE).toFixed(1);

/** @returns {boolean} true if the geometry changed and a re-render is needed */
function syncViewport() {
  const narrow = window.innerWidth < 700;
  const vw = narrow ? 430 : 760;
  if (vw === VW) return false;
  VW = vw;
  ML = narrow ? 30 : 46;
  MR = narrow ? 14 : 22;
  INNER_W = VW - ML - MR;
  FSCALE = narrow ? 1.5 : 1;
  return true;
}

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

const shapeSelect = /** @type {HTMLSelectElement} */ (document.getElementById('pop-shape'));
const nInput = /** @type {HTMLInputElement} */ (document.getElementById('sample-size'));
const stageBtns = /** @type {NodeListOf<HTMLButtonElement>} */ (
  document.querySelectorAll('#stage-control button'));
const genBtns = /** @type {NodeListOf<HTMLButtonElement>} */ (
  document.querySelectorAll('.gen-btn'));
const resetBtn = /** @type {HTMLButtonElement} */ (document.getElementById('reset-btn'));
const genLabel = document.getElementById('gen-label');

const popContainer = document.getElementById('pop-container');
const popPanel = document.getElementById('pop-panel');
const popSub = document.getElementById('pop-subtitle');
const sampleTally = document.getElementById('sample-tally');
const insetWrap = document.getElementById('inset-wrap');
const insetContainer = document.getElementById('inset-container');
const insetTally = document.getElementById('inset-tally');
const insetTitle = document.getElementById('inset-title');

const distContainer = document.getElementById('dist-container');
const distSub = document.getElementById('dist-subtitle');
const seOption = document.getElementById('se-option');
const showSeCheckbox = /** @type {HTMLInputElement|null} */ (document.getElementById('show-se'));
const xbarRow = document.getElementById('xbar-row');
const xbarSlider = /** @type {HTMLInputElement} */ (document.getElementById('xbar-slider'));
const xbarVal = document.getElementById('xbar-val');
const anotherBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('another-btn'));
const xbarHint = document.getElementById('xbar-hint');

const verdictBox = document.getElementById('verdict');
const statsRow = document.getElementById('stats-row');
const popMuEl = document.getElementById('pop-mu');
const popSigmaEl = document.getElementById('pop-sigma');
const trueSeEl = document.getElementById('true-se');
const bootSeEl = document.getElementById('boot-se');
const bootSeItem = document.getElementById('boot-se-item');
const sampleSdEl = document.getElementById('sample-sd');
const sampleSdItem = document.getElementById('sample-sd-item');
const countEl = document.getElementById('draw-count');
const countLabel = document.getElementById('draw-count-label');

// ---------------------------------------------------------------------------
// URL params + state
// ---------------------------------------------------------------------------

const params = new URLSearchParams(location.search);
const seed = params.get('seed') || Math.random().toString(36).slice(2, 10);

/** @type {number[]} value of every population dot, in draw order */
let population = [];
/** @type {{value:number, stack:number}[]} grid position of every population dot */
let dotAt = [];
let popMu = 0, popSigma = 0;

/** @type {number[][]} pool[t] = dot indices making up sample t */
let pool = [];
/** @type {number[]} */
let poolMeans = [];
/** Central 95% of the TRUE sampling distribution (from the whole pool). */
let trueBand = /** @type {[number, number]} */ ([0, 0]);
let trueSe = 0;

/** @type {number[][]} boots[b] = dot indices of bootstrap resample b */
let boots = [];
/** @type {number[]} */
let bootMeans = [];

let stage = params.get('stage') === '2' ? 2 : 1;
let shown = 0;              // how many of the pool are revealed (stage 1)
let bootShown = 0;          // how many resamples are revealed (stage 2)
let origIndex = -1;         // index into pool of the frozen "original sample"
/** Pool indices whose mean is closest to the slider target, nearest first. */
let candidates = /** @type {number[]} */ ([]);
let candIdx = 0;            // which of those is currently frozen

/** Shared x-domain for both panels. @type {[number, number]} */
let domain = [0, 1];

const reduceMotion = prefersReducedMotion();

/** Last inset render — its circles are the flight's targets. @type {{circles: SVGCircleElement[], statX: number, statY: number}|null} */
let lastInset = null;
/** Pending auto-run step, so a new selection cancels the previous sequence. */
let autoRunTimer = 0;

// ---------------------------------------------------------------------------
// Population construction
// ---------------------------------------------------------------------------

/**
 * Build an integer-valued population whose column heights follow a density —
 * count(x) = round(N * P(x - 0.5 < X < x + 0.5)). Gives an exact, fixed dotplot
 * rather than a random draw, so the picture is stable across reloads.
 * @param {string} shape - 'normal' | 'skewed'
 * @returns {{value:number, count:number}[]}
 */
function buildPopulation(shape) {
  /** @type {{value:number, count:number}[]} */
  const cols = [];
  if (shape === 'skewed') {
    // 40 + LogNormal with mean 10, sd 5 (CV 0.5 -> skew 1.63). Only needs
    // exp/log, so no gamma function.
    const SHIFT = 40, cv = 0.5;
    const sl = Math.sqrt(Math.log(1 + cv * cv));
    const ml = Math.log(10) - sl * sl / 2;
    const F = (/** @type {number} */ t) => (t <= 0 ? 0 : normCDF((Math.log(t) - ml) / sl));
    for (let x = SHIFT + 1; x <= SHIFT + 45; x++) {
      const c = Math.round(POP_N * (F(x + 0.5 - SHIFT) - F(x - 0.5 - SHIFT)));
      if (c > 0) cols.push({ value: x, count: c });
    }
  } else {
    const mu = 50, sigma = 5;
    for (let x = mu - 3 * sigma; x <= mu + 3 * sigma; x++) {
      const c = Math.round(POP_N * (normCDF((x + 0.5 - mu) / sigma) - normCDF((x - 0.5 - mu) / sigma)));
      if (c > 0) cols.push({ value: x, count: c });
    }
  }
  return cols;
}

/** @type {{value:number, count:number}[]} */
let popCols = [];

function initPopulation() {
  popCols = buildPopulation(shapeSelect.value);
  population = [];
  dotAt = [];
  for (const { value, count } of popCols) {
    for (let k = 0; k < count; k++) {
      population.push(value);
      dotAt.push({ value, stack: k });
    }
  }
  popMu = population.reduce((s, v) => s + v, 0) / population.length;
  // Population sigma (divide by N) — this is a whole population, not a sample.
  popSigma = Math.sqrt(population.reduce((s, v) => s + (v - popMu) ** 2, 0) / population.length);

  const lo = popCols[0].value, hi = popCols[popCols.length - 1].value;
  domain = [lo - 0.75, hi + 0.75];
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

const n = () => Math.max(2, Math.min(60, Number(nInput.value) || 10));

/** Mean of a sample given as dot indices. @param {number[]} idx */
function meanOf(idx) {
  let s = 0;
  for (const i of idx) s += population[i];
  return s / idx.length;
}

/**
 * Pre-draw the whole pool of samples. Deterministic in (seed, shape, n) so the
 * picture reproduces — the same reason the rest of StatLens is seeded.
 */
function buildPool() {
  const rng = createRng(`${seed}:pool:${shapeSelect.value}:${n()}`);
  const size = n();
  pool = [];
  poolMeans = [];
  for (let t = 0; t < POOL; t++) {
    const idx = new Array(size);
    for (let i = 0; i < size; i++) idx[i] = Math.floor(rng() * population.length);
    pool.push(idx);
    poolMeans.push(meanOf(idx));
  }
  trueBand = [quantile(poolMeans, (1 - CI_LEVEL) / 2), quantile(poolMeans, 1 - (1 - CI_LEVEL) / 2)];
  const m = poolMeans.reduce((s, v) => s + v, 0) / POOL;
  trueSe = Math.sqrt(poolMeans.reduce((s, v) => s + (v - m) ** 2, 0) / (POOL - 1));
}

/**
 * The pool samples whose mean sits closest to `target`, nearest first.
 *
 * A list rather than a single winner because "same x̄, different sample" is the
 * page's sharpest lesson: those samples share a centre but not a spread, so they
 * produce different interval WIDTHS, and some capture μ while others miss. That
 * is the estimated-width caveat made concrete instead of described.
 * @param {number} target
 * @param {number} [k]
 */
function nearestSamples(target, k = 60) {
  return poolMeans
    .map((m, t) => ({ t, d: Math.abs(m - target) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, k)
    .map(o => o.t);
}

/** Recompute the candidate list for the slider's target and freeze the nearest. */
function setTarget(/** @type {number} */ target) {
  candidates = nearestSamples(target);
  candIdx = 0;
  origIndex = candidates[0];
}

/** Pre-draw the bootstrap resamples from the frozen sample. */
function buildBoots() {
  const orig = pool[origIndex];
  const rng = createRng(`${seed}:boot:${shapeSelect.value}:${n()}:${origIndex}`);
  boots = [];
  bootMeans = [];
  for (let b = 0; b < BOOT; b++) {
    const idx = new Array(orig.length);
    for (let i = 0; i < orig.length; i++) idx[i] = orig[Math.floor(rng() * orig.length)];
    boots.push(idx);
    bootMeans.push(meanOf(idx));
  }
}

/**
 * x̄ ± z·SE_boot — the interval Todd would build, for comparison.
 *
 * Centred on x̄ (the textbook form), not on the bootstrap distribution's own
 * mean the way js/ci-method.js `normalApproxCI` does; the difference is the
 * bootstrap bias and is negligible for a mean, but x̄ is what "x-bar plus or
 * minus two SEs" actually means.
 *
 * Uses the EXACT z (1.96), deliberately not the house `zFor(95)` = 2 used on
 * the bootstrap pages. This page's whole question is whether the two intervals
 * coincide; the "±2 SE" rule of thumb is ~2% wider than a true 95% interval,
 * which would show up here as a permanent small gap that is an artifact of the
 * convention rather than a real difference between the methods.
 */
function seInterval() {
  if (bootShown < BAND_MIN) return null;
  const z = invNorm(1 - (1 - CI_LEVEL) / 2);
  const xb = poolMeans[origIndex];
  const half = z * bootSE();
  return /** @type {[number, number]} */ ([xb - half, xb + half]);
}

/** The percentile CI from the resamples revealed so far, or null. */
function percentileCI() {
  if (bootShown < BAND_MIN) return null;
  const m = bootMeans.slice(0, bootShown);
  return /** @type {[number, number]} */ (
    [quantile(m, (1 - CI_LEVEL) / 2), quantile(m, 1 - (1 - CI_LEVEL) / 2)]);
}

// ---------------------------------------------------------------------------
// Shared scale + small SVG helpers
// ---------------------------------------------------------------------------

const sx = (/** @type {number} */ v) => ML + ((v - domain[0]) / (domain[1] - domain[0])) * INNER_W;

/**
 * @param {string} tag
 * @param {Record<string, string|number>} attrs
 * @param {string} [text]
 */
function el(tag, attrs, text) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  if (text != null) e.textContent = text;
  return e;
}

/**
 * @param {number} viewHeight
 * @param {string} label - becomes the svg's aria-label (no role="img": matches
 *   createChart, which deliberately leaves charts unflattened for AT)
 */
function makeSvg(viewHeight, label) {
  const svg = el('svg', {
    viewBox: `0 0 ${VW} ${viewHeight}`,
    preserveAspectRatio: 'xMidYMid meet',
    'aria-label': label,
  });
  svg.style.width = '100%';
  svg.style.height = 'auto';
  return svg;
}

/** Multiplicity -> fill opacity. Compounding, so repeats read as visibly darker. */
const opacityFor = (/** @type {number} */ m) => 1 - Math.pow(0.55, m);

/**
 * Count how many times each dot index appears.
 * @param {number[]} idx
 * @returns {Map<number, number>}
 */
function tally(idx) {
  const m = new Map();
  for (const i of idx) m.set(i, (m.get(i) || 0) + 1);
  return m;
}

/**
 * Text form of a sample: "49x4, 50, 51x3, 52x2". This is the accessible (and
 * unambiguous) version of the shading — Todd's mail asks the reader to "infer
 * the bootstrap sample by shading", so we also just say it.
 * @param {number[]} idx
 */
function tallyText(idx) {
  const byValue = new Map();
  for (const i of idx) {
    const v = population[i];
    byValue.set(v, (byValue.get(v) || 0) + 1);
  }
  return [...byValue.keys()].sort((a, b) => a - b)
    .map(v => (byValue.get(v) > 1 ? `${v}×${byValue.get(v)}` : `${v}`))
    .join(', ');
}

const fmt = (/** @type {number} */ v, /** @type {number} */ d = 2) => v.toFixed(d);

/**
 * SVG text reading "x̄<tail>" (or "x̄*<tail>"). Drawn as an overline-decorated
 * tspan rather than a combining macron, which SVG parks too high above the x.
 * @param {Record<string, string|number>} attrs
 * @param {string} tail - text after the x-bar, e.g. " = 52.00"
 * @param {boolean} [star]
 */
function xbarText(attrs, tail, star = false) {
  const t = el('text', { ...attrs, 'font-style': 'italic' });
  t.appendChild(el('tspan', { 'text-decoration': 'overline' }, 'x'));
  t.appendChild(el('tspan', { 'font-style': 'normal' }, (star ? '*' : '') + tail));
  return t;
}

// ---------------------------------------------------------------------------
// Population panel
// ---------------------------------------------------------------------------

/** Geometry of the population dotplot, kept for the drop animation. */
let popGeom = { r: 8, baseY: 0, axisY: 0, height: 0 };

/**
 * Two highlight layers, because Stage 2 has two things to show at once: which
 * dots make up the frozen sample (a light red ring — the "bag") and which of
 * THOSE the current resample drew, and how often (compounding fill). Seeing the
 * dark dots strictly inside the ringed ones is what makes it visible that the
 * bootstrap draws from the sample, never from the population.
 * @param {number[]|null} base - the frozen sample (Stage 2), lightly marked
 * @param {number[]|null} top - the current sample/resample, shaded by multiplicity
 * @param {string} color
 */
function renderPopulation(base, top, color) {
  const highlight = top || base;
  if (!popContainer) return;
  const nCols = popCols.length;
  const maxStack = popCols.reduce((m, c) => Math.max(m, c.count), 0);
  // Fit by width, by height, and by an absolute cap so the panel never gets
  // taller than a laptop viewport.
  const r = Math.min(INNER_W / (2 * nCols), 300 / (2 * maxStack), 9);
  const axisH = fs(34), topPad = 8;
  const height = topPad + maxStack * 2 * r + axisH;
  const baseY = topPad + maxStack * 2 * r;   // y of the bottom row's centre line
  popGeom = { r, baseY, axisY: baseY, height };

  const svg = makeSvg(height,
    `Population dotplot: ${population.length} values, mean ${fmt(popMu)}, `
    + `standard deviation ${fmt(popSigma)}.`
    + (highlight ? ` ${highlight.length} of them are highlighted as the current sample.` : ''));

  const counts = top ? tally(top) : new Map();
  const baseSet = base ? new Set(base) : null;

  // --- dots -------------------------------------------------------------
  const g = el('g', {});
  let i = 0;
  for (const col of popCols) {
    const cx = sx(col.value);
    for (let k = 0; k < col.count; k++, i++) {
      const cy = baseY - (k * 2 * r) - r;
      const m = counts.get(i) || 0;
      const inBag = baseSet ? baseSet.has(i) : false;
      const c = el('circle', {
        'data-dot': i,
        cx: fmt(cx, 1), cy: fmt(cy, 1), r: fmt(r - 0.6, 2),
        fill: m ? color : (inBag ? color : '#fff'),
        'fill-opacity': m ? fmt(opacityFor(m), 3) : (inBag ? 0.14 : 1),
        stroke: m || inBag ? color : '#8a8a8a',
        // Stroke thickens with multiplicity — a second, non-colour cue.
        'stroke-width': m ? Math.min(1 + 0.9 * m, 3.5) : (inBag ? 2.2 : 0.8),
      });
      // The bag stays the primary mark even while a resample is filled in on
      // top of it: an outer halo keeps "these ten are the sample" readable.
      if (inBag) {
        g.appendChild(el('circle', {
          cx: fmt(cx, 1), cy: fmt(cy, 1), r: fmt(r + 1.4, 2),
          fill: 'none', stroke: color, 'stroke-width': 1, 'stroke-opacity': 0.35,
        }));
      }
      g.appendChild(c);
    }
  }
  svg.appendChild(g);

  // --- value labels (hidden by CSS on narrow screens, where they'd be noise)
  if (r >= 6) {
    const lg = el('g', { class: 'pop-labels', 'font-size': fmt(r * 1.05, 1), 'text-anchor': 'middle', fill: '#333' });
    let j = 0;
    for (const col of popCols) {
      const cx = sx(col.value);
      for (let k = 0; k < col.count; k++, j++) {
        const cy = baseY - (k * 2 * r) - r;
        const m = counts.get(j) || 0;
        lg.appendChild(el('text', {
          x: fmt(cx, 1), y: fmt(cy + r * 0.36, 1),
          fill: m && opacityFor(m) > 0.6 ? '#fff' : '#333',
          'font-weight': m || (baseSet && baseSet.has(j)) ? 700 : 400,
        }, String(col.value)));
      }
    }
    svg.appendChild(lg);
  }

  svg.appendChild(axisGroup(baseY, height, { muLine: true, muTop: topPad }));
  popContainer.innerHTML = '';
  popContainer.appendChild(svg);
}

/**
 * Shared x-axis: same domain, same margins as the distribution panel, so the
 * two panels line up vertically. That alignment is the whole point of the
 * layout — a mean in the top panel drops straight down to its dot below.
 * @param {number} y
 * @param {number} height
 * @param {{muLine?: boolean, muTop?: number}} [opts]
 */
function axisGroup(y, height, opts = {}) {
  const g = el('g', {});
  g.appendChild(el('line', { x1: ML, y1: y, x2: VW - MR, y2: y, stroke: '#555', 'stroke-width': 1 }));

  // Ticks every 5 units, snapped into the domain.
  const step = (domain[1] - domain[0]) > 40 ? 10 : 5;
  const first = Math.ceil(domain[0] / step) * step;
  for (let v = first; v <= domain[1]; v += step) {
    g.appendChild(el('line', { x1: sx(v), y1: y, x2: sx(v), y2: y + 5, stroke: '#555', 'stroke-width': 1 }));
    g.appendChild(el('text', {
      x: sx(v), y: y + fs(18), 'text-anchor': 'middle', 'font-size': fs(12), fill: '#444',
    }, String(v)));
  }

  if (opts.muLine) {
    g.appendChild(el('line', {
      x1: sx(popMu), y1: opts.muTop ?? 0, x2: sx(popMu), y2: y,
      stroke: BLUE, 'stroke-width': 2, 'stroke-dasharray': '6 4', 'stroke-opacity': 0.75,
    }));
    g.appendChild(el('text', {
      x: sx(popMu), y: y + fs(31), 'text-anchor': 'middle', 'font-size': fs(12.5),
      'font-weight': 700, fill: BLUE,
    }, `μ = ${fmt(popMu)}`));
  }
  return g;
}

// ---------------------------------------------------------------------------
// Inset: the frozen original sample, blown up
// ---------------------------------------------------------------------------

/**
 * The inset box. Before a resample it holds the ORIGINAL sample — the bag the
 * bootstrap draws from. Once a resample exists it holds the BOOTSTRAP SAMPLE:
 * one dot per draw, so a value taken four times shows four dots rather than one
 * dark one. Todd Will's staging — the dots fly up into this box from the
 * population, the box relabels, and its x̄* then falls to the plot below — which
 * splits "resample, compute, record" into three legible beats instead of one
 * mid-air blur.
 *
 * Returns the circles indexed by DRAW ORDER (aligned to `resample`), so the
 * flight can pair each one with the population dot it came from. Two draws of
 * the same dot correctly share one source and get two targets.
 *
 * @param {number[]|null} resample - dot indices of the current resample, or null
 * @returns {{ circles: SVGCircleElement[], statX: number, statY: number }|null}
 */
function renderInset(resample) {
  if (!insetContainer || !insetTally) return null;
  const shown = resample ?? pool[origIndex];
  const isBoot = !!resample;

  // Sort by value so the box reads left-to-right like a dotplot; keep the draw
  // index so the caller can pair circle -> source.
  const draws = shown.map((dotIdx, i) => ({ dotIdx, value: population[dotIdx], i }))
    .sort((a, b) => a.value - b.value || a.i - b.i);
  const cols = [...new Set(draws.map(d => d.value))];
  const stackCount = new Map();
  const maxStack = Math.max(...cols.map(v => draws.filter(d => d.value === v).length));

  // A CONTINUOUS value axis, not one column per distinct value. Ordinal spacing
  // packed 52 and 57 side by side with no gap between them, which misreads the
  // sample's spread and put the x̄* marker at a meaningless position.
  const IW = 320, IL = 12, IR = 12, inner = IW - IL - IR;
  const lo = cols[0] - 0.5, hi = cols[cols.length - 1] + 0.5;
  const slots = Math.max(1, Math.round(hi - lo));
  const r = Math.min(inner / (2 * slots), 96 / (2 * maxStack), 11);
  const axisH = 30, topPad = 8;
  const height = topPad + maxStack * 2 * r + axisH;
  const baseY = topPad + maxStack * 2 * r;
  const stat = meanOf(shown);
  const ix = (/** @type {number} */ v) => IL + ((v - lo) / (hi - lo)) * inner;

  const svg = el('svg', {
    viewBox: `0 0 ${IW} ${height}`, preserveAspectRatio: 'xMidYMid meet',
    'aria-label': isBoot
      ? `Bootstrap sample: ${tallyText(shown)}. Its mean is ${fmt(stat)}.`
      : `The original sample, the values the bootstrap resamples from: `
        + `${tallyText(shown)}. Sample mean ${fmt(stat)}.`,
  });
  svg.style.width = '100%';
  svg.style.height = 'auto';

  /** @type {SVGCircleElement[]} circles indexed by draw order */
  const circles = new Array(shown.length);
  for (const d of draws) {
    const j = stackCount.get(d.value) || 0;
    stackCount.set(d.value, j + 1);
    const cx = ix(d.value), cy = baseY - (j * 2 * r) - r;
    const c = el('circle', {
      cx: fmt(cx, 1), cy: fmt(cy, 1), r: fmt(Math.max(2, r - 1.4), 2),
      fill: RED_FILL, 'fill-opacity': isBoot ? 0.62 : 0.12,
      stroke: RED, 'stroke-width': isBoot ? 1.6 : 1.2,
    });
    svg.appendChild(c);
    circles[d.i] = /** @type {SVGCircleElement} */ (c);
    // Labels only while they can actually be read.
    if (r >= 7) {
      svg.appendChild(el('text', {
        x: fmt(cx, 1), y: fmt(cy + r * 0.33, 1), 'text-anchor': 'middle',
        'font-size': fmt(r * 0.86, 1), 'font-weight': isBoot ? 700 : 400,
        fill: isBoot ? '#fff' : '#444', 'pointer-events': 'none',
      }, String(d.value)));
    }
  }

  svg.appendChild(el('line', {
    x1: fmt(IL, 1), y1: baseY, x2: fmt(IW - IR, 1), y2: baseY, stroke: '#777', 'stroke-width': 1,
  }));
  // Ticks at every value present, so the gaps read as gaps.
  for (const v of cols) {
    svg.appendChild(el('line', { x1: fmt(ix(v), 1), y1: baseY, x2: fmt(ix(v), 1), y2: baseY + 4, stroke: '#999' }));
  }
  // The statistic sits at its true position on the box's own axis — this is the
  // point the x̄* dot falls from.
  const statX = ix(stat);
  svg.appendChild(el('line', {
    x1: fmt(statX, 1), y1: topPad, x2: fmt(statX, 1), y2: baseY + 7,
    stroke: RED, 'stroke-width': 2, 'stroke-dasharray': '5 3',
  }));
  svg.appendChild(xbarText({
    x: fmt(statX, 1), y: baseY + 22, 'text-anchor': 'middle',
    'font-size': 12, 'font-weight': 700, fill: RED,
  }, ` = ${fmt(stat)}`, isBoot));

  insetContainer.innerHTML = '';
  insetContainer.appendChild(svg);
  if (insetTitle) insetTitle.textContent = isBoot ? 'Bootstrap sample' : 'Original sample';
  insetTally.innerHTML = isBoot
    ? `${tallyText(shown)} \u2192 <i class="xb">x</i>* = ${fmt(stat)}`
    : `The bag \u2014 the bootstrap draws only from these ${shown.length} values.`;

  return { circles, statX, statY: baseY };
}

// ---------------------------------------------------------------------------
// Distribution panel
// ---------------------------------------------------------------------------

/** Above this many values a stack of dots stops being countable and bins instead. */
const DOT_MAX = 120;

/**
 * Bin grid for the means. The width is snapped to a multiple of 1/n because a
 * mean of n integers can only land on a multiple of 1/n — an arbitrary width
 * puts two possible values in one bin and one in the next, which combs the
 * histogram. Snapping makes every bin hold the same number of possible means.
 */
function binGrid() {
  const unit = 1 / n();
  const raw = (domain[1] - domain[0]) / 45;
  const w = Math.max(unit, Math.round(raw / unit) * unit);
  return { w, origin: domain[0] };
}

/**
 * @param {number[]} values
 * @returns {{ counts: number[], w: number, origin: number, nb: number }}
 */
function binned(values) {
  const { w, origin } = binGrid();
  const nb = Math.ceil((domain[1] - domain[0]) / w);
  const counts = new Array(nb).fill(0);
  for (const v of values) {
    let k = Math.floor((v - origin) / w);
    if (k < 0) k = 0;
    if (k >= nb) k = nb - 1;
    counts[k]++;
  }
  return { counts, w, origin, nb };
}

/**
 * Histogram silhouette as a step path — deliberately NOT a smoothed curve. The
 * shape of these two distributions is the whole argument, so it should read as
 * "counts of things that happened", the same as every other StatLens plot.
 * @param {number[]} counts
 * @param {number} total
 * @param {number} w
 * @param {number} origin
 * @param {number} yMax - in density units
 * @param {number} baseY
 * @param {number} plotH
 */
function stepPath(counts, total, w, origin, yMax, baseY, plotH) {
  const y = (/** @type {number} */ d) => baseY - (d / yMax) * plotH;
  let p = `M ${fmt(sx(origin), 1)} ${fmt(baseY, 1)}`;
  for (let i = 0; i < counts.length; i++) {
    const d = counts[i] / (total * w);
    p += ` L ${fmt(sx(origin + i * w), 1)} ${fmt(y(d), 1)}`
      + ` L ${fmt(sx(origin + (i + 1) * w), 1)} ${fmt(y(d), 1)}`;
  }
  return p + ` L ${fmt(sx(origin + counts.length * w), 1)} ${fmt(baseY, 1)} Z`;
}

/** Geometry of the distribution panel, kept for the drop animation. */
let distGeom = { baseY: 0, height: 0 };

function renderDistribution() {
  if (!distContainer) return;
  const showSe = stage === 2 && !!showSeCheckbox?.checked;
  const topPad = 30, plotH = 162, axisH = fs(showSe ? 92 : 62);
  const baseY = topPad + plotH;
  const height = baseY + axisH;
  distGeom = { baseY, height };

  const blueVals = stage === 1 ? poolMeans.slice(0, shown) : poolMeans;
  const redVals = stage === 2 && bootShown > 0 ? bootMeans.slice(0, bootShown) : [];
  // Whichever distribution is currently BUILDING decides the representation:
  // individual dots while you can still count them, bins once you cannot.
  const building = stage === 1 ? blueVals : redVals;
  const dotMode = building.length > 0 && building.length <= DOT_MAX;

  const svg = makeSvg(height, stage === 1
    ? `Sampling distribution of the sample mean from ${blueVals.length} samples.`
    : `Sampling distribution (blue) and bootstrap distribution (red) on a shared axis.`);

  const defs = el('defs', {});
  const pat = el('pattern', {
    id: 'boot-hatch', width: 7, height: 7, patternUnits: 'userSpaceOnUse',
    patternTransform: 'rotate(45)',
  });
  pat.appendChild(el('rect', { width: 7, height: 7, fill: RED_FILL, 'fill-opacity': 0.16 }));
  pat.appendChild(el('line', { x1: 0, y1: 0, x2: 0, y2: 7, stroke: RED_FILL, 'stroke-width': 2.4, 'stroke-opacity': 0.75 }));
  defs.appendChild(pat);
  svg.appendChild(defs);

  // --- central 95% band of the TRUE sampling distribution ------------------
  const showBand = stage === 2 || shown >= BAND_MIN;
  if (showBand) {
    svg.appendChild(el('rect', {
      x: fmt(sx(trueBand[0]), 1), y: topPad,
      width: fmt(sx(trueBand[1]) - sx(trueBand[0]), 1), height: plotH,
      fill: BLUE, 'fill-opacity': 0.09,
    }));
    for (const b of trueBand) {
      svg.appendChild(el('line', {
        x1: sx(b), y1: topPad, x2: sx(b), y2: baseY,
        stroke: BLUE, 'stroke-width': 1, 'stroke-opacity': 0.5, 'stroke-dasharray': '3 3',
      }));
    }
    svg.appendChild(el('text', {
      x: fmt((sx(trueBand[0]) + sx(trueBand[1])) / 2, 1), y: topPad - 8,
      'text-anchor': 'middle', 'font-size': fs(11.5), fill: BLUE, 'font-weight': 700,
    }, 'central 95% of sample means'));
  }

  if (dotMode) {
    // While the red resamples are still countable, the blue sampling
    // distribution is a reference SHAPE behind them (scaled to its own peak),
    // not a co-plotted density — heights are not comparable yet and pretending
    // otherwise would be the dishonest half of an overlay.
    if (stage === 2 && poolMeans.length) {
      const bb = binned(poolMeans);
      const peak = Math.max(...bb.counts) / (poolMeans.length * bb.w) || 1;
      svg.appendChild(el('path', {
        d: stepPath(bb.counts, poolMeans.length, bb.w, bb.origin, peak, baseY, plotH),
        fill: BLUE_FILL, stroke: BLUE, 'stroke-width': 1.6, 'stroke-opacity': 0.55,
      }));
    }
    drawMeanDots(svg, building, stage === 1 ? BLUE : RED_FILL,
      stage === 1 ? BLUE : RED, baseY, plotH);
  } else if (building.length > 0 || stage === 2) {
    const yMaxOf = (/** @type {number[]} */ vals) => {
      if (vals.length < 2) return 0;
      const b = binned(vals);
      return Math.max(...b.counts) / (vals.length * b.w);
    };
    const yMax = Math.max(yMaxOf(blueVals), yMaxOf(redVals)) * 1.08 || 1;
    const paths = [];
    if (blueVals.length >= 2) {
      const b = binned(blueVals);
      paths.push({ d: stepPath(b.counts, blueVals.length, b.w, b.origin, yMax, baseY, plotH),
        fill: BLUE_FILL, stroke: BLUE, dash: null });
    }
    if (redVals.length >= 2) {
      const b = binned(redVals);
      paths.push({ d: stepPath(b.counts, redVals.length, b.w, b.origin, yMax, baseY, plotH),
        fill: 'url(#boot-hatch)', stroke: RED, dash: '7 4' });
    }
    for (const q of paths) svg.appendChild(el('path', { d: q.d, fill: q.fill, stroke: 'none' }));
    for (const q of paths) {
      svg.appendChild(el('path', {
        d: q.d, fill: 'none', stroke: q.stroke, 'stroke-width': 2.2,
        'stroke-linejoin': 'round', ...(q.dash ? { 'stroke-dasharray': q.dash } : {}),
      }));
    }
  }

  // --- reference lines -----------------------------------------------------
  svg.appendChild(el('line', {
    x1: sx(popMu), y1: topPad, x2: sx(popMu), y2: baseY,
    stroke: BLUE, 'stroke-width': 2, 'stroke-dasharray': '6 4',
  }));
  if (stage === 2 && origIndex >= 0) {
    const xb = poolMeans[origIndex];
    svg.appendChild(el('line', {
      x1: sx(xb), y1: topPad, x2: sx(xb), y2: baseY,
      stroke: RED, 'stroke-width': 2, 'stroke-dasharray': '6 4',
    }));
    svg.appendChild(el('path', {
      d: `M ${fmt(sx(xb), 1)} ${baseY - 1} l -6 -9 l 12 0 Z`, fill: RED,
    }));
  }

  svg.appendChild(axisGroup(baseY, height));
  svg.appendChild(xbarText({
    x: VW - MR, y: baseY + fs(33), 'text-anchor': 'end', 'font-size': fs(14),
    'font-weight': 700, fill: '#333',
  }, ''));

  // --- the intervals, as brackets under the axis ---------------------------
  // Percentile is primary (thick, red). The ±z·SE comparison, when switched on,
  // sits directly beneath in thinner charcoal — same axis, so "they line up" or
  // "they don't" is readable as two bar widths, with no arithmetic.
  const ci = stage === 2 ? percentileCI() : null;
  if (ci) {
    const y = baseY + fs(40);
    const bracket = (/** @type {[number,number]} */ iv, /** @type {number} */ yy,
                     /** @type {string} */ col, /** @type {number} */ w,
                     /** @type {string} */ label) => {
      svg.appendChild(el('line', { x1: sx(iv[0]), y1: yy, x2: sx(iv[1]), y2: yy, stroke: col, 'stroke-width': w }));
      for (const bb of iv) {
        svg.appendChild(el('line', { x1: sx(bb), y1: yy - 6, x2: sx(bb), y2: yy + 6, stroke: col, 'stroke-width': w }));
      }
      svg.appendChild(el('text', {
        x: fmt((sx(iv[0]) + sx(iv[1])) / 2, 1), y: yy + fs(15), 'text-anchor': 'middle',
        'font-size': fs(11), 'font-weight': 700, fill: col,
      }, label));
    };
    bracket(ci, y, RED, 3, `95% percentile CI  (${fmt(ci[0])}, ${fmt(ci[1])})`);
    const seCi = showSe ? seInterval() : null;
    if (seCi) bracket(seCi, y + fs(30), SE_COLOR, 2, `x\u0304 \u00B1 1.96\u00B7SE  (${fmt(seCi[0])}, ${fmt(seCi[1])})`);
  }

  distContainer.innerHTML = '';
  distContainer.appendChild(svg);
}

/**
 * One dot per sample mean, stacked on the bin grid. The newest dot carries
 * `data-newest` so the +1 flight can hide it until the flyer lands on it.
 * @param {SVGElement} svg
 * @param {number[]} values
 * @param {string} fill
 * @param {string} stroke
 * @param {number} baseY
 * @param {number} plotH
 */
function drawMeanDots(svg, values, fill, stroke, baseY, plotH) {
  const { w, origin } = binGrid();
  /** @type {Map<number, number>} bin index -> how many are already stacked */
  const stacks = new Map();
  const placed = values.map(v => {
    const k = Math.floor((v - origin) / w);
    const j = stacks.get(k) || 0;
    stacks.set(k, j + 1);
    return { k, j };
  });
  const maxStack = Math.max(1, ...stacks.values());
  const r = Math.min((sx(origin + w) - sx(origin)) / 2, plotH / (2 * maxStack), 7);
  const g = el('g', {});
  placed.forEach((d, i) => {
    const cx = sx(origin + (d.k + 0.5) * w);
    const cy = baseY - d.j * 2 * r - r;
    g.appendChild(el('circle', {
      cx: fmt(cx, 1), cy: fmt(cy, 1), r: fmt(Math.max(1.6, r - 0.7), 2),
      fill, 'fill-opacity': 0.72, stroke, 'stroke-width': 0.9,
      ...(i === values.length - 1 ? { 'data-newest': '1' } : {}),
    }));
  });
  svg.appendChild(g);
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

function renderVerdict() {
  if (!verdictBox) return;
  const XB = '<i class="xb">x</i>';
  if (stage === 1) {
    verdictBox.className = 'verdict verdict-idle';
    verdictBox.innerHTML = shown < BAND_MIN
      ? '<p>Draw samples to build the true sampling distribution. Once it has taken shape, switch to Stage 2 to bootstrap from a single sample.</p>'
      : `<p><strong>The central 95% of the true sampling distribution runs from `
        + `${fmt(trueBand[0])} to ${fmt(trueBand[1])}.</strong> That is the range a single `
        + `${XB} usually lands in — it is the thing the percentile method has to reproduce `
        + `without ever seeing this picture. Now go to Stage 2: freeze one sample and `
        + `bootstrap from it.</p>`;
    return;
  }

  const ci = percentileCI();
  if (!ci) {
    verdictBox.className = 'verdict verdict-idle';
    verdictBox.innerHTML = `<p>Resample from the frozen sample (${XB} = `
      + `${fmt(poolMeans[origIndex])}) to build the bootstrap distribution. At least `
      + `${BAND_MIN} resamples are needed before a percentile interval is worth reading.</p>`;
    return;
  }

  const xb = poolMeans[origIndex];
  const captures = ci[0] <= popMu && popMu <= ci[1];
  const inside = trueBand[0] <= xb && xb <= trueBand[1];
  const agree = captures === inside;
  const tick = (/** @type {boolean} */ ok) => (ok ? '✓' : '✗');

  let note;
  // Todd Will's observation, measured: corr(x̄, s) = 0.59 on the skewed
  // population vs 0.00 on the normal one (where x̄ and s are independent). It
  // explains the direction of the under-coverage, so it belongs on screen.
  const xbarSNote = shapeSelect.value === 'skewed'
    ? ` <span class="skew-note">On a skewed population, <em>where</em> ${XB} lands and `
      + `<em>how spread out</em> the sample is turn out to be linked: a high ${XB} usually `
      + `caught the long tail, so <em>s</em> is large and the interval comes out wide, while a `
      + `low ${XB} gets a narrow one — which is why the misses pile up on the low side.</span>`
    : '';

  if (agree && captures) {
    note = `<p class="verdict-note"><strong>The two agree.</strong> That is the argument for `
      + `the percentile method: the bootstrap distribution carries roughly the shape and spread `
      + `of the sampling distribution but sits at ${XB} instead of μ, so reading the middle 95% `
      + `off it captures μ close to whenever ${XB} was a typical draw — which is 95% of the `
      + `time. Sweep the slider and watch both lines flip together at the edges of the blue `
      + `band.${xbarSNote}</p>`;
  } else if (agree) {
    note = `<p class="verdict-note"><strong>The two agree — and this is the 5%.</strong> `
      + `The interval missed μ, but not because the method failed: it missed because this `
      + `${XB} was an unusually extreme draw, outside the blue band. A 95% method is supposed `
      + `to miss exactly this often, and only for samples like this one. Slide ${XB} back `
      + `toward the band and both lines flip together.${xbarSNote}</p>`;
  } else {
    note = `<p class="verdict-note"><strong>Here they disagree — and that is worth seeing.</strong> `
      + `The argument above leans on the bootstrap distribution having the same spread as the `
      + `sampling distribution, just shifted. It does not, quite: its width came from this one `
      + `sample. True SE = `
      + `${fmt(trueSe)}, bootstrap SE = ${fmt(bootSE())}. With n = ${n()} the width is estimated `
      + `from ${n()} values, so the interval comes out too narrow or too wide and the two verdicts `
      + `come apart. Raise n and disagreements get rare.${xbarSNote}</p>`;
  }

  verdictBox.className = 'verdict ' + (agree ? (captures ? 'verdict-yes' : 'verdict-no') : 'verdict-mixed');
  verdictBox.innerHTML =
    `<ul class="verdict-list">`
    + `<li><span class="v-mark">${tick(inside)}</span><span>${XB} = ${fmt(xb)} is `
    + `<strong>${inside ? 'inside' : 'outside'}</strong> the central 95% of the true sampling `
    + `distribution (${fmt(trueBand[0])} to ${fmt(trueBand[1])}).</span></li>`
    + `<li><span class="v-mark">${tick(captures)}</span><span>The 95% percentile CI `
    + `(${fmt(ci[0])}, ${fmt(ci[1])}) <strong>${captures ? 'captures' : 'misses'}</strong> `
    + `μ = ${fmt(popMu)}.</span></li>`
    + `</ul>` + note;
}

function bootSE() {
  if (bootShown < 2) return 0;
  const m = bootMeans.slice(0, bootShown);
  const mm = m.reduce((s, v) => s + v, 0) / m.length;
  return Math.sqrt(m.reduce((s, v) => s + (v - mm) ** 2, 0) / (m.length - 1));
}

// ---------------------------------------------------------------------------
// Drop animation — a mean "falls" from the population panel into the plot below
// ---------------------------------------------------------------------------

/**
 * A single dot falling from `from` to `to`, accelerating. The last beat of both
 * stages: a computed statistic dropping into the distribution that records it.
 * @param {{x:number,y:number}} from
 * @param {{x:number,y:number}} to
 * @param {string} color
 * @param {() => void} onDone
 */
function dropDot(from, to, color, onDone) {
  const SZ = 13;
  const d = document.createElement('div');
  d.style.cssText = `position:fixed;left:${from.x - SZ / 2}px;top:${from.y - SZ / 2}px;`
    + `width:${SZ}px;height:${SZ}px;border-radius:50%;background:${color};`
    + `box-shadow:0 0 0 1.5px #fff, 0 1px 4px rgba(0,0,0,.45);z-index:1000;pointer-events:none;`;
  document.body.appendChild(d);
  const t0 = performance.now(), DUR = 480;
  function fall(now) {
    const t = Math.min((now - t0) / DUR, 1);
    const e = t * t;                       // falling, not gliding
    d.style.left = `${from.x + (to.x - from.x) * t - SZ / 2}px`;
    d.style.top = `${from.y + (to.y - from.y) * e - SZ / 2}px`;
    if (t < 1) requestAnimationFrame(fall);
    else { d.remove(); onDone(); }
  }
  requestAnimationFrame(fall);
}

/** Centre of the newest dot in the plot below, or the axis point for `value`. */
function landingPoint(/** @type {Element|null} */ newest, /** @type {number} */ value) {
  const distSvg = distContainer?.querySelector('svg');
  if (!distSvg) return null;
  if (newest) {
    const b = newest.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }
  const dr = distSvg.getBoundingClientRect();
  const k = dr.width / VW;
  return { x: dr.left + sx(value) * k, y: dr.top + distGeom.baseY * k };
}

/**
 * Stage 2's +1, staged the way Todd Will asked for it:
 *
 *   FLY   each draw lifts off the population circle it came from — the ringed
 *         original sample, never the wider population — and lands in the inset
 *         box, which assembles a visible bootstrap sample and relabels itself.
 *         A dot taken twice sends two flyers from the same circle, which is what
 *         "with replacement" looks like.
 *   DROP  the box's x̄* then falls from the box into the bootstrap distribution.
 *
 * Splitting it in two is the point: resample, compute, record are three separate
 * things, and the old mid-air merge blurred them into one.
 *
 * @param {number[]} resample - population dot indices
 * @param {number} statValue
 */
function animateBootstrapDraw(resample, statValue) {
  const newest = distContainer?.querySelector('[data-newest]');
  const reveal = () => {
    if (newest) /** @type {SVGElement} */ (newest).style.removeProperty('opacity');
  };
  const popSvg = popContainer?.querySelector('svg');
  const insetSvg = insetContainer?.querySelector('svg');
  if (reduceMotion || !popSvg || !insetSvg || !lastInset) return;

  const dropFromBox = () => {
    const ir = insetSvg.getBoundingClientRect();
    const k = ir.width / 320;              // the inset's own viewBox width
    const from = { x: ir.left + lastInset.statX * k, y: ir.top + lastInset.statY * k };
    const to = landingPoint(newest, statValue);
    if (!to) { reveal(); return; }
    dropDot(from, to, RED_FILL, reveal);
  };

  // Above ~30 draws the flight is a swarm rather than a mechanism, so skip it —
  // but keep the second beat. "The box's statistic falls into the distribution"
  // is the half that carries the idea, and it reads fine at any n.
  if (resample.length > 30) {
    if (newest) /** @type {SVGElement} */ (newest).style.opacity = '0';
    setTimeout(dropFromBox, 220);
    return;
  }

  const pairs = [];
  for (let i = 0; i < resample.length; i++) {
    const src = popSvg.querySelector(`[data-dot="${resample[i]}"]`);
    const tgt = lastInset.circles[i];
    if (!src || !tgt) continue;
    const b = src.getBoundingClientRect();
    pairs.push({ source: { x: b.left + b.width / 2, y: b.top + b.height / 2 }, target: tgt });
  }
  if (!pairs.length) return;

  if (newest) /** @type {SVGElement} */ (newest).style.opacity = '0';
  // No footprints: the population already marks every drawn dot by filling it,
  // so a second mark on the same circle would just be noise.
  const ran = flyOntoTargets(pairs, {
    color: RED_FILL, footprints: false,
    onDone: () => setTimeout(dropFromBox, 260),
  });
  if (!ran) reveal();
}

/**
 * The +1 flight, in three phases — the mechanism the whole page is about, so it
 * is shown rather than asserted:
 *
 *   PLUCK     a flyer lifts off each population circle the sample drew (a circle
 *             drawn twice launches two flyers, which is what "with replacement"
 *             looks like);
 *   COALESCE  the flyers converge on the sample's x̄ and merge into one dot —
 *             n values become one statistic;
 *   DROP      that dot falls into the distribution below and becomes the newest
 *             dot in the stack.
 *
 * Skipped entirely under prefers-reduced-motion, and for the batch buttons,
 * where n flyers × 1000 samples would be absurd.
 *
 * @param {number[]} dotIndices - population dot ids making up the sample
 * @param {number} meanValue
 * @param {string} color
 */
function animateSampleFly(dotIndices, meanValue, color) {
  const newest = distContainer?.querySelector('[data-newest]');
  const reveal = () => { if (newest) /** @type {SVGElement} */ (newest).style.removeProperty('opacity'); };
  if (reduceMotion || !popContainer || !distContainer) return;
  const popSvg = popContainer.querySelector('svg');
  const distSvg = distContainer.querySelector('svg');
  if (!popSvg || !distSvg) return;

  const sources = dotIndices
    .map(i => popSvg.querySelector(`[data-dot="${i}"]`))
    .filter(Boolean)
    .map(c => {
      const b = /** @type {SVGCircleElement} */ (c).getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2, size: Math.max(7, b.width * 0.8) };
    });
  if (!sources.length) return;

  // Where the flyers merge: the sample's x̄ on the population panel's axis.
  const pr = popSvg.getBoundingClientRect();
  const scaleP = pr.width / VW;
  const mergeX = pr.left + sx(meanValue) * scaleP;
  const mergeY = sources.reduce((t, p) => t + p.y, 0) / sources.length;

  // Where it lands: the newest dot in the plot below, or the axis if binned.
  const dr = distSvg.getBoundingClientRect();
  const scaleD = dr.width / VW;
  let landX = dr.left + sx(meanValue) * scaleD;
  let landY = dr.top + distGeom.baseY * scaleD;
  if (newest) {
    const nb = newest.getBoundingClientRect();
    landX = nb.left + nb.width / 2;
    landY = nb.top + nb.height / 2;
    /** @type {SVGElement} */ (newest).style.opacity = '0';
  }

  const flyers = sources.map((p) => {
    const d = document.createElement('div');
    d.style.cssText = `position:fixed;left:${p.x - p.size / 2}px;top:${p.y - p.size / 2}px;`
      + `width:${p.size}px;height:${p.size}px;border-radius:50%;background:${color};`
      + `box-shadow:0 0 0 1.5px #fff, 0 1px 3px rgba(0,0,0,.4);z-index:1000;`
      + `pointer-events:none;opacity:0;transition:opacity .12s ease-in;`;
    document.body.appendChild(d);
    return { d, ...p };
  });
  requestAnimationFrame(() => flyers.forEach(f => { f.d.style.opacity = '1'; }));

  const PLUCK = 260, COALESCE = 560, DROP = 480;
  const easeInOut = (/** @type {number} */ t) =>
    (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  const t0 = performance.now();
  function frame(now) {
    const el0 = now - t0;
    if (el0 < PLUCK) { requestAnimationFrame(frame); return; }

    const tc = Math.min((el0 - PLUCK) / COALESCE, 1);
    const e = easeInOut(tc);
    for (const f of flyers) {
      f.d.style.left = `${f.x + (mergeX - f.x) * e - f.size / 2}px`;
      f.d.style.top = `${f.y + (mergeY - f.y) * e - f.size / 2}px`;
      if (tc > 0.75) f.d.style.opacity = String(Math.max(0, 1 - (tc - 0.75) / 0.25));
    }
    if (tc < 1) { requestAnimationFrame(frame); return; }

    // Merged: one dot carrying the statistic, dropping into the plot below.
    for (const f of flyers) f.d.remove();
    dropDot({ x: mergeX, y: mergeY }, { x: landX, y: landY }, color, reveal);
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Render + actions
// ---------------------------------------------------------------------------

function renderStats() {
  if (popMuEl) popMuEl.textContent = fmt(popMu);
  if (popSigmaEl) popSigmaEl.textContent = fmt(popSigma);
  if (trueSeEl) trueSeEl.textContent = shown >= BAND_MIN || stage === 2 ? fmt(trueSe) : '—';
  if (sampleSdItem) sampleSdItem.hidden = stage !== 2;
  if (sampleSdEl && stage === 2 && origIndex >= 0) {
    sampleSdEl.textContent = fmt(sd(pool[origIndex].map(i => population[i])));
  }
  if (bootSeItem) bootSeItem.hidden = stage !== 2 || bootShown < 2;
  if (bootSeEl) bootSeEl.textContent = bootShown >= 2 ? fmt(bootSE()) : '—';
  if (countEl) countEl.textContent = String(stage === 1 ? shown : bootShown);
  if (countLabel) countLabel.textContent = stage === 1 ? 'Samples drawn:' : 'Resamples drawn:';
  if (statsRow) statsRow.hidden = stage === 1 && shown === 0;
}

function render() {
  syncViewport();
  if (stage === 1) {
    const cur = shown > 0 ? pool[shown - 1] : null;
    renderPopulation(null, cur, BLUE);
    if (popSub) popSub.textContent = 'each sample highlights the dots it drew';
    if (sampleTally) {
      sampleTally.innerHTML = cur
        ? `Latest sample (n = ${n()}): ${tallyText(cur)}  \u2192  `
          + `<i class="xb">x</i> = ${fmt(poolMeans[shown - 1])}`
        : '';
    }
  } else {
    const cur = bootShown > 0 ? boots[bootShown - 1] : null;
    renderPopulation(pool[origIndex], cur, RED_FILL);
    if (popSub) {
      popSub.textContent = cur
        ? 'ringed = the frozen sample · filled = what this resample drew'
        : 'one sample is frozen and ringed in red — the bootstrap draws only from these';
    }
    if (sampleTally) {
      sampleTally.innerHTML = cur
        ? `Resample ${bootShown} (n = ${n()}): ${tallyText(cur)}  \u2192  `
          + `<i class="xb">x</i>* = ${fmt(bootMeans[bootShown - 1])}`
        : `Frozen sample (n = ${n()}): ${tallyText(pool[origIndex])}  \u2192  `
          + `<i class="xb">x</i> = ${fmt(poolMeans[origIndex])}`;
    }
    lastInset = renderInset(cur);
  }
  if (insetWrap) insetWrap.hidden = stage !== 2;
  if (xbarRow) xbarRow.hidden = stage !== 2;
  if (seOption) seOption.hidden = stage !== 2 || !params.has('se');
  if (distSub) {
    distSub.textContent = stage === 1
      ? 'one dot per sample mean — the true sampling distribution'
      : 'blue: true sampling distribution · red hatched: bootstrap from the frozen sample';
  }
  if (genLabel) genLabel.textContent = stage === 1 ? 'Samples' : 'Resamples';
  if (resetBtn) resetBtn.hidden = (stage === 1 ? shown : bootShown) === 0;

  renderDistribution();
  renderStats();
  renderVerdict();
}

/** @param {number} count */
function draw(count) {
  // Landing on ?stage=2, or moving the slider, fills the distribution to its
  // maximum — after which +1 clamped and silently did nothing. If it is already
  // complete, a generate click means "let me watch it build", so start over.
  if (stage === 1 && shown >= POOL) shown = 0;
  if (stage === 2 && bootShown >= BOOT) bootShown = 0;

  if (stage === 1) {
    const before = shown;
    shown = Math.min(POOL, shown + count);
    render();
    if (count === 1 && shown > before) {
      animateSampleFly(pool[shown - 1], poolMeans[shown - 1], BLUE);
    }
    announce(`${shown} samples drawn. Sampling distribution SE ${fmt(trueSe)}.`);
  } else {
    const before = bootShown;
    bootShown = Math.min(BOOT, bootShown + count);
    render();
    if (count === 1 && bootShown > before) {
      animateBootstrapDraw(boots[bootShown - 1], bootMeans[bootShown - 1]);
    }
    const ci = percentileCI();
    announce(`${bootShown} resamples drawn.`
      + (ci ? ` 95% percentile CI ${fmt(ci[0])} to ${fmt(ci[1])}.` : ''));
  }
}

function setStage(/** @type {number} */ s) {
  stage = s;
  for (const b of stageBtns) b.setAttribute('aria-pressed', String(Number(b.dataset.stage) === s));
  if (s === 2) {
    if (origIndex < 0) setTarget(Number(xbarSlider.value));
    buildBoots();
    bootShown = 0;
  }
  render();
}

/** Rebuild everything below the population (pool, boots) — after shape/n change. */
function rebuild() {
  initPopulation();
  buildPool();
  shown = 0;
  bootShown = 0;
  // Slider spans roughly +/- 3.5 SE around mu, which is where the interesting
  // capture/miss boundary lives.
  const se = popSigma / Math.sqrt(n());
  xbarSlider.min = fmt(popMu - 3.5 * se, 1);
  xbarSlider.max = fmt(popMu + 3.5 * se, 1);
  xbarSlider.step = '0.1';
  if (Number(xbarSlider.value) < Number(xbarSlider.min)
      || Number(xbarSlider.value) > Number(xbarSlider.max)) {
    // Open at 0.5 SE off centre, not out near the edge of the band: the clean
    // "both agree, the interval captures" case has to land FIRST, or the page
    // teaches the exception before the rule. The student slides outward to
    // find the misses.
    xbarSlider.value = fmt(popMu + 0.5 * se, 1);
  }
  setTarget(Number(xbarSlider.value));
  updateXbarReadout();
  if (stage === 2) { buildBoots(); }
  render();
}

/** Slider value display + "which of the same-mean samples is frozen" note. */
function updateXbarReadout() {
  if (xbarVal) xbarVal.textContent = fmt(poolMeans[origIndex]);
  if (anotherBtn) anotherBtn.disabled = candidates.length < 2;
  if (!xbarHint) return;
  xbarHint.innerHTML = candIdx === 0
    ? 'Sweep the slider to move <i class="xb">x</i> across the sampling distribution. '
      + '<strong>Another sample</strong> keeps <i class="xb">x</i> where it is and freezes a '
      + '<em>different</em> sample with the same mean — same centre, different spread, so a '
      + 'different interval width.'
    : `Sample <strong>${candIdx + 1}</strong> of ${candidates.length} with `
      + `<i class="xb">x</i> \u2248 ${fmt(poolMeans[origIndex])} — same centre as the last one, `
      + `different spread. Watch the interval width and the verdict change.`;
}

/** Cancel any queued auto-run step (a new selection supersedes the old one). */
function cancelAutoRun() {
  if (autoRunTimer) { clearTimeout(autoRunTimer); autoRunTimer = 0; }
}

/**
 * Todd's "+1, +1, +1, then the rest": after a NEW original sample is chosen the
 * bootstrap distribution restarts from empty and rebuilds itself, so it is
 * visible that each original sample produces its own bootstrap rather than the
 * red curve simply sliding around.
 *
 * Only fires on a deliberate pick (the "Another sample" button). Dragging the
 * slider keeps the instant morph — running a 5-second sequence on every tick
 * would make sweeping for the verdict flip unusable, which is the page's other
 * main gesture.
 */
function autoRunBootstrap() {
  cancelAutoRun();
  bootShown = 0;
  render();
  const step = (/** @type {number} */ k) => {
    if (k >= 3) {
      autoRunTimer = window.setTimeout(() => { bootShown = BOOT; render(); autoRunTimer = 0; }, 520);
      return;
    }
    bootShown += 1;
    render();
    animateBootstrapDraw(boots[bootShown - 1], bootMeans[bootShown - 1]);
    autoRunTimer = window.setTimeout(() => step(k + 1), reduceMotion ? 260 : 1750);
  };
  autoRunTimer = window.setTimeout(() => step(0), 320);
}

/** A quick "this is a new bootstrap" blink — used when the slider is released. */
function blinkRebuild() {
  cancelAutoRun();
  bootShown = 0;
  render();
  autoRunTimer = window.setTimeout(() => { bootShown = BOOT; render(); autoRunTimer = 0; }, 220);
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

for (const btn of genBtns) {
  btn.addEventListener('click', () => { cancelAutoRun(); draw(Number(btn.dataset.count)); });
}
resetBtn?.addEventListener('click', () => {
  cancelAutoRun();
  if (stage === 1) shown = 0; else bootShown = 0;
  render();
  announce('Reset.');
});
for (const btn of stageBtns) {
  btn.addEventListener('click', () => { cancelAutoRun(); setStage(Number(btn.dataset.stage)); });
}
let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => { if (syncViewport()) render(); }, 150);
});

showSeCheckbox?.addEventListener('change', () => render());

shapeSelect.addEventListener('change', () => { cancelAutoRun(); rebuild(); });
nInput.addEventListener('change', () => { cancelAutoRun(); rebuild(); });

xbarSlider.addEventListener('input', () => {
  cancelAutoRun();
  setTarget(Number(xbarSlider.value));
  buildBoots();
  // Dragging shows the finished bootstrap distribution — the point of the slider
  // is to sweep capture/miss, not to re-run the animation each tick.
  bootShown = BOOT;
  updateXbarReadout();
  render();
});

// On release, blink the distribution back through empty: a short reminder that
// this is a different original sample with its own bootstrap.
xbarSlider.addEventListener('change', () => { if (stage === 2) blinkRebuild(); });

anotherBtn?.addEventListener('click', () => {
  if (candidates.length < 2) return;
  candIdx = (candIdx + 1) % candidates.length;
  origIndex = candidates[candIdx];
  buildBoots();
  updateXbarReadout();
  autoRunBootstrap();
  announce(`Frozen a different sample with mean ${fmt(poolMeans[origIndex])}. `
    + 'Rebuilding its bootstrap distribution.');
});

initSettings();
initHelp();
initKeyboardShortcuts(genBtns, resetBtn);

// --- URL params -------------------------------------------------------------
if (params.get('shape') === 'skewed') shapeSelect.value = 'skewed';
if (showSeCheckbox && ['1', 'true', 'yes'].includes((params.get('se') || '').toLowerCase())) {
  showSeCheckbox.checked = true;
}
const nParam = Number(params.get('n'));
if (Number.isFinite(nParam) && nParam >= 2 && nParam <= 60) nInput.value = String(nParam);

rebuild();

const xbarParam = Number(params.get('xbar'));
if (Number.isFinite(xbarParam) && params.get('xbar')) {
  xbarSlider.value = String(Math.min(Number(xbarSlider.max), Math.max(Number(xbarSlider.min), xbarParam)));
  setTarget(Number(xbarSlider.value));
  updateXbarReadout();
}
if (stage === 2) {
  shown = POOL;
  setStage(2);
  bootShown = BOOT;
  render();
}
