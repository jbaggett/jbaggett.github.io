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
import { normCDF } from '../../js/ci-method.js';
import { initHelp, initSettings, initKeyboardShortcuts, announce } from '../../js/page-utils.js';
import { prefersReducedMotion } from '../../js/settings.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POP_N = 200;          // target population size (exact count is rounding-dependent)
const POOL = 4000;          // pre-drawn samples — the "true" sampling distribution
const BOOT = 4000;          // pre-drawn bootstrap resamples
const CI_LEVEL = 0.95;
const BAND_MIN = 200;       // resamples/samples before a CI or band is trustworthy enough to draw

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

const distContainer = document.getElementById('dist-container');
const distSub = document.getElementById('dist-subtitle');
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
        'stroke-width': m ? Math.min(1 + 0.9 * m, 3.5) : (inBag ? 1.8 : 0.8),
      });
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
 * The frozen sample, blown up — Todd's inset. Every dot of the ORIGINAL sample
 * appears exactly once; the shading is how many times the CURRENT resample drew
 * it. That is the picture the whole page turns on: the bootstrap's bag is these
 * n values, and a resample is this bag with some dots taken repeatedly and
 * others left white.
 * @param {number[]|null} resample - the current bootstrap resample, or null
 */
function renderInset(resample) {
  if (!insetContainer || !insetTally) return;
  const idx = pool[origIndex];
  const counts = resample ? tally(resample) : new Map();

  // One column per distinct value in the sample, in value order, evenly spaced.
  /** @type {Map<number, number[]>} value -> dot ids of the sample at that value */
  const byValue = new Map();
  for (const i of idx) {
    if (!byValue.has(population[i])) byValue.set(population[i], []);
    byValue.get(population[i]).push(i);
  }
  const cols = [...byValue.keys()].sort((a, b) => a - b);
  const maxStack = Math.max(...cols.map(v => byValue.get(v).length));

  const IW = 320, IL = 10, IR = 10, inner = IW - IL - IR;
  const r = Math.min(inner / (2 * cols.length), 64 / (2 * maxStack), 19);
  const axisH = 22, topPad = 15;   // headroom for the ×n badges above the top row
  const height = topPad + maxStack * 2 * r + axisH;
  const baseY = topPad + maxStack * 2 * r;
  // Centre the columns in the available width when there are few of them.
  const span = cols.length * 2 * r;
  const x0 = IL + (inner - span) / 2;
  const cxOf = (/** @type {number} */ k) => x0 + k * 2 * r + r;

  const svg = el('svg', {
    viewBox: `0 0 ${IW} ${height}`, preserveAspectRatio: 'xMidYMid meet',
    'aria-label': `The frozen sample, the values the bootstrap resamples from: `
      + `${tallyText(idx)}. Sample mean ${fmt(meanOf(idx))}.`
      + (resample ? ` This resample drew ${tallyText(resample)}, mean ${fmt(meanOf(resample))}.` : ''),
  });
  svg.style.width = '100%';
  svg.style.height = 'auto';

  cols.forEach((value, k) => {
    const ids = byValue.get(value);
    ids.forEach((id, j) => {
      const m = counts.get(id) || 0;
      const cx = cxOf(k), cy = baseY - (j * 2 * r) - r;
      svg.appendChild(el('circle', {
        cx: fmt(cx, 1), cy: fmt(cy, 1), r: fmt(r - 1.4, 2),
        fill: RED_FILL, 'fill-opacity': m ? fmt(opacityFor(m), 3) : 0.09,
        stroke: RED, 'stroke-width': m ? Math.min(1 + 0.9 * m, 3.5) : 1.2,
      }));
      svg.appendChild(el('text', {
        x: fmt(cx, 1), y: fmt(cy + r * 0.33, 1), 'text-anchor': 'middle',
        'font-size': fmt(r * 0.88, 1), 'font-weight': m ? 700 : 400,
        fill: m && opacityFor(m) > 0.6 ? '#fff' : '#444',
      }, String(value)));
      // Multiplicity in words as well as in shade — the shading alone is a
      // colour-only cue, and how many times a value was drawn is the point.
      if (j === ids.length - 1) {
        const total = ids.reduce((t, i2) => t + (counts.get(i2) || 0), 0);
        if (total > 1) {
          svg.appendChild(el('text', {
            x: fmt(cx, 1), y: fmt(cy - r - 1.5, 1), 'text-anchor': 'middle',
            'font-size': fmt(Math.max(9, r * 0.62), 1), 'font-weight': 700, fill: RED,
          }, `×${total}`));
        }
      }
    });
  });

  svg.appendChild(el('line', {
    x1: fmt(x0, 1), y1: baseY, x2: fmt(x0 + span, 1), y2: baseY, stroke: '#777', 'stroke-width': 1,
  }));
  svg.appendChild(xbarText({
    x: fmt(x0 + span / 2, 1), y: baseY + 16, 'text-anchor': 'middle',
    'font-size': 12, 'font-weight': 700, fill: RED,
  }, ` = ${fmt(meanOf(idx))}`));

  insetContainer.innerHTML = '';
  insetContainer.appendChild(svg);
  insetTally.innerHTML = resample
    ? `This resample: ${tallyText(resample)} \u2192 <i class="xb">x</i>* = ${fmt(meanOf(resample))}`
    : `The bag — the bootstrap draws only from these ${idx.length} values.`;
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
  const topPad = 30, plotH = 162, axisH = fs(62);
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

  // --- the percentile CI, as a bracket under the axis ----------------------
  const ci = stage === 2 ? percentileCI() : null;
  if (ci) {
    const y = baseY + fs(40);
    svg.appendChild(el('line', {
      x1: sx(ci[0]), y1: y, x2: sx(ci[1]), y2: y, stroke: RED, 'stroke-width': 3,
    }));
    for (const b of ci) {
      svg.appendChild(el('line', { x1: sx(b), y1: y - 6, x2: sx(b), y2: y + 6, stroke: RED, 'stroke-width': 3 }));
    }
    svg.appendChild(el('text', {
      x: fmt((sx(ci[0]) + sx(ci[1])) / 2, 1), y: y + fs(18), 'text-anchor': 'middle',
      'font-size': fs(11.5), 'font-weight': 700, fill: RED,
    }, `95% percentile CI  (${fmt(ci[0])}, ${fmt(ci[1])})`));
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
  if (agree && captures) {
    note = `<p class="verdict-note"><strong>The two agree.</strong> That is the argument for `
      + `the percentile method: the bootstrap distribution is the sampling distribution slid `
      + `over to sit at ${XB}, so reading the middle 95% off it captures μ exactly when `
      + `${XB} was a typical draw — which is 95% of the time. Sweep the slider and watch both `
      + `lines flip together at the edges of the blue band.</p>`;
  } else if (agree) {
    note = `<p class="verdict-note"><strong>The two agree — and this is the 5%.</strong> `
      + `The interval missed μ, but not because the method failed: it missed because this `
      + `${XB} was an unusually extreme draw, outside the blue band. A 95% method is supposed `
      + `to miss exactly this often, and only for samples like this one. Slide ${XB} back `
      + `toward the band and both lines flip together.</p>`;
  } else {
    note = `<p class="verdict-note"><strong>Here they disagree — and that is worth seeing.</strong> `
      + `The argument above assumes the bootstrap distribution is the sampling distribution simply `
      + `<em>shifted</em>. It is not, quite: its width came from this one sample. True SE = `
      + `${fmt(trueSe)}, bootstrap SE = ${fmt(bootSE())}. With n = ${n()} the width is estimated `
      + `from ${n()} values, so the interval comes out too narrow or too wide and the two verdicts `
      + `come apart. Raise n and disagreements get rare.</p>`;
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
    const merged = document.createElement('div');
    const SZ = 13;
    merged.style.cssText = `position:fixed;left:${mergeX - SZ / 2}px;top:${mergeY - SZ / 2}px;`
      + `width:${SZ}px;height:${SZ}px;border-radius:50%;background:${color};`
      + `box-shadow:0 0 0 1.5px #fff, 0 1px 4px rgba(0,0,0,.45);z-index:1000;pointer-events:none;`;
    document.body.appendChild(merged);
    const t1 = performance.now();
    function fall(now2) {
      const td = Math.min((now2 - t1) / DROP, 1);
      // Accelerate downward — it is falling, not gliding.
      const ed = td * td;
      merged.style.left = `${mergeX + (landX - mergeX) * td - SZ / 2}px`;
      merged.style.top = `${mergeY + (landY - mergeY) * ed - SZ / 2}px`;
      if (td < 1) requestAnimationFrame(fall);
      else { merged.remove(); reveal(); }
    }
    requestAnimationFrame(fall);
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
    renderInset(cur);
  }
  if (insetWrap) insetWrap.hidden = stage !== 2;
  if (xbarRow) xbarRow.hidden = stage !== 2;
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
      animateSampleFly(boots[bootShown - 1], bootMeans[bootShown - 1], RED_FILL);
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

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

for (const btn of genBtns) {
  btn.addEventListener('click', () => draw(Number(btn.dataset.count)));
}
resetBtn?.addEventListener('click', () => {
  if (stage === 1) shown = 0; else bootShown = 0;
  render();
  announce('Reset.');
});
for (const btn of stageBtns) {
  btn.addEventListener('click', () => setStage(Number(btn.dataset.stage)));
}
let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => { if (syncViewport()) render(); }, 150);
});

shapeSelect.addEventListener('change', rebuild);
nInput.addEventListener('change', rebuild);

xbarSlider.addEventListener('input', () => {
  setTarget(Number(xbarSlider.value));
  buildBoots();
  // Changing the frozen sample shows its finished bootstrap distribution — the
  // point of the slider is to sweep capture/miss, not to re-run the animation.
  bootShown = BOOT;
  updateXbarReadout();
  render();
});

anotherBtn?.addEventListener('click', () => {
  if (candidates.length < 2) return;
  candIdx = (candIdx + 1) % candidates.length;
  origIndex = candidates[candIdx];
  buildBoots();
  bootShown = BOOT;
  updateXbarReadout();
  render();
  const ci = percentileCI();
  announce(`Frozen a different sample with mean ${fmt(poolMeans[origIndex])}.`
    + (ci ? ` 95% percentile CI ${fmt(ci[0])} to ${fmt(ci[1])}.` : ''));
});

initSettings();
initHelp();
initKeyboardShortcuts(genBtns, resetBtn);

// --- URL params -------------------------------------------------------------
if (params.get('shape') === 'skewed') shapeSelect.value = 'skewed';
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
