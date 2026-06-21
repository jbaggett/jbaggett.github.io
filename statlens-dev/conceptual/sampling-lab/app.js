// @ts-check
/**
 * Sampling Distribution Demonstrator.
 * Students pick a population shape, set n, draw samples, and watch
 * the sampling distribution of x̄ build up — CLT in action.
 */

import { createRng, randNormal } from '../../js/prng.js';
import { mean, sd } from '../../js/stats.js';
import { drawHistogram, computeBins, snappedPropThresholds } from '../../js/histogram.js';
import { drawDotplot, computeDots } from '../../js/dotplot.js';
import { drawSpike } from '../../js/spike.js';
import { announce, initKeyboardShortcuts, initPlayPause, computeHighlights, animateDropToChart } from '../../js/page-utils.js';
import { resolveChartType } from '../../js/chart-defaults.js';
import * as d3Shape from 'd3-shape';
import * as d3Scale from 'd3-scale';
import * as d3Selection from 'd3-selection';

// ─── DOM ───

const popShapeSelect = /** @type {HTMLSelectElement} */ (document.getElementById('pop-shape'));
const sampleSizeInput = /** @type {HTMLInputElement} */ (document.getElementById('sample-size'));
const popContainer = document.getElementById('pop-container');
const sampleContainer = document.getElementById('sample-container');
const sampleStatLine = document.getElementById('sample-stat-line');
const samplingContainer = document.getElementById('sampling-container');
const samplingStats = document.getElementById('sampling-stats');
const resultDiv = document.getElementById('result-summary');
const resetBtn = /** @type {HTMLButtonElement} */ (document.getElementById('reset-btn'));

const popMeanEl = document.getElementById('pop-mean');
const popSdEl = document.getElementById('pop-sd');
const nSamplesEl = document.getElementById('n-samples');
// NOTE: "Mean of x̄'s" is deliberately NOT shown — emphasizing it drifting toward
// μ as n grows is a simulation artifact students misread (Watkins trap, REQ-030).
// The tool centers on spread/shape vs n, where the simulation is honest.
const sdXbarEl = document.getElementById('sd-xbar');
const seTheoryEl = document.getElementById('se-theory');

const showNormalCheckbox = /** @type {HTMLInputElement} */ (document.getElementById('show-normal'));

// Freeze/compare (P2): pin the current sampling distribution, then change n and
// draw again to see a different, narrower/wider distribution on the same axis.
const freezeBtn = /** @type {HTMLButtonElement} */ (document.getElementById('freeze-btn'));
const frozenWrap = document.getElementById('frozen-wrap');
const frozenContainer = document.getElementById('frozen-container');
const frozenLabel = document.getElementById('frozen-label');
const liveLabel = document.getElementById('live-label');

// Population type toggle (P3): quantitative (mean of x̄) vs categorical (p̂).
const popTypeBtns = /** @type {NodeListOf<HTMLButtonElement>} */ (
  document.querySelectorAll('#pop-type button[data-type]'));
const shapeControl = document.getElementById('shape-control');
const pControl = document.getElementById('p-control');
const popPSlider = /** @type {HTMLInputElement} */ (document.getElementById('pop-p'));
const popPVal = document.getElementById('pop-p-val');
const popMeanLabel = document.getElementById('pop-mean-label');
const popSdLabel = document.getElementById('pop-sd-label');
const sdLabel = document.getElementById('sd-label');
const theoryLabel = document.getElementById('theory-label');
const centerNote = document.getElementById('center-note');

const genBtns = /** @type {NodeListOf<HTMLButtonElement>} */ (
  document.querySelectorAll('.gen-btn'));

/** Population type: 'quant' (sampling dist of x̄) or 'cat' (sampling dist of p̂). */
let popType = 'quant';
const isCat = () => popType === 'cat';

/** Per-mode display labels (plain text — for chart options, not KaTeX). */
function lab() {
  return isCat()
    ? { stat: 'p̂', param: 'p', valueAxis: '0 = failure      1 = success',
        statAxis: 'Sample Proportion', samplingTitle: 'Sampling Distribution of p̂' }
    : { stat: 'x̄', param: 'μ', valueAxis: 'Value',
        statAxis: 'Sample Mean', samplingTitle: 'Sampling Distribution of x̄' };
}

// ─── Population definitions ───

const POP_SIZE = 10000;
/** Max proportion-sample size shown as animated marbles (larger → summary bar). */
const CAT_DOT_MAX = 100;
/** Tallest p̂ dot stack before the sampling dotplot switches to a spike plot. */
const CAT_SPIKE_STACK = 40;
// Proportion colours (Okabe-Ito, CVD-safe) live in CSS as .cat-success (amber
// #C08700, hatched) and .cat-failure (blue #0072B2) — shared by the population
// square, the scooped sample marbles, and the flying dots.
/** Success amber — also colours the p̂ sampling distribution, since p̂ is the
 *  proportion of successes (ties the whole proportion view to "successes" and
 *  avoids clashing with the neutral blue used for the means distribution). */
const SUCCESS_AMBER = '#C08700';

/**
 * @param {string} shape
 * @param {() => number} rng
 * @returns {number[]}
 */
function generatePopulation(shape, rng) {
  const vals = [];
  // Categorical population: a 0/1 array at proportion p. Because the mean of a
  // 0/1 sample IS p̂ and sd IS √(p(1−p)), the whole means pipeline (stats, the
  // σ/√n theory line, the sampling distribution) carries over to proportions.
  if (isCat()) {
    const p = popPSlider ? parseFloat(popPSlider.value) : 0.6;
    const ones = Math.round(POP_SIZE * p);
    for (let i = 0; i < POP_SIZE; i++) vals.push(i < ones ? 1 : 0);
    return vals;
  }
  // Draw from `make` until the value lands in [lo, hi]. The skewed shapes are
  // otherwise unbounded exponentials, so a rare draw can land far past the
  // plotted domain and overflow into the page. Redrawing (rather than clamping)
  // keeps the distribution's natural shape — it just tapers to a clean edge with
  // no pile-up spike. μ/σ come from this bounded population, so the sampling
  // distribution still centres honestly on the μ line. (A teaching demo; the
  // rejected tail is <1% and invisible for the already-bounded shapes.)
  const draw = (/** @type {() => number} */ make, /** @type {number} */ lo, /** @type {number} */ hi) => {
    let x;
    do { x = make(); } while (x < lo || x > hi);
    return x;
  };
  switch (shape) {
    case 'normal':
      for (let i = 0; i < POP_SIZE; i++) vals.push(draw(() => randNormal(50, 10, rng), 15, 85));
      break;
    case 'right-skewed':
      for (let i = 0; i < POP_SIZE; i++) vals.push(draw(() => -Math.log(1 - rng()) / 0.1, 0, 50));
      break;
    case 'left-skewed':
      for (let i = 0; i < POP_SIZE; i++) vals.push(draw(() => 50 - (-Math.log(1 - rng()) / 0.1), 0, 50));
      break;
    case 'uniform':
      for (let i = 0; i < POP_SIZE; i++) vals.push(rng() * 100);
      break;
    case 'bimodal':
      for (let i = 0; i < POP_SIZE; i++) {
        vals.push(draw(() => (rng() < 0.5 ? randNormal(30, 5, rng) : randNormal(70, 5, rng)), 10, 90));
      }
      break;
    default:
      for (let i = 0; i < POP_SIZE; i++) vals.push(draw(() => randNormal(50, 10, rng), 15, 85));
  }
  return vals;
}

// ─── State ───

/** @type {number[]} */
let population = [];
let popMu = 0;
let popSigma = 0;

/** @type {number[]} */
let sampleMeans = [];

/** Values of the most recently drawn sample (shown in the "One sample" tier). */
/** @type {number[]} */
let lastSample = [];

/** @type {(() => number)|null} */
let rng = null;
// Deterministic when ?seed= is supplied (required for graded/activity use);
// otherwise a fresh random seed each session.
const urlSeed = new URLSearchParams(location.search).get('seed');
let seed = urlSeed || Math.random().toString(36).slice(2, 10);

// Cached chart params for checkbox toggle re-render
/** @type {[number,number]|undefined} */
let lastDomain;
/** @type {number[]|undefined} */
let lastThresholds;
/** Population display x-domain, shared with the "One sample" tier. */
/** @type {[number,number]|null} */
let popDisplayDomain = null;
/** Population histogram's bin grid, reused so the sample dotplot's dots stack
 *  on the SAME bins as the population bars (so the sample reads as drawn from it). */
/** @type {number|null} */
let popBinWidth = null;
/** @type {number|null} */
let popBinOrigin = null;
/** The current-sample dotplot's inner group + x-scale, for the "combine into the
 *  mean" animation (converging the dots to the x̄ position). */
/** @type {SVGGElement|null} */
let sampleInner = null;
/** @type {((v:number)=>number)|null} */
let sampleXScale = null;
/** The bin origin used by the current-sample dotplot, reused by the pluck so the
 *  flying dots land exactly on the dotplot's dots. */
let sampleDotOrigin = 0;

/** Frozen sampling distribution for the compare feature (P2). */
/** @type {{ n: number, means: number[], domain: [number,number] }|null} */
let frozen = null;

// Pre-computed sampling distribution domain + dotplot grid (stable axes & stacks)
/** @type {[number,number]|null} */
let samplingDomain = null;
/** @type {number|null} */
let samplingBinWidth = null;
/** @type {number|null} */
let samplingBinOrigin = null;

// Cached population histogram result for overlay animation
/** @type {{ frame: import('../../js/types.js').ChartFrame, xScale: d3Scale.ScaleLinear<number,number> }|null} */
let popHistResult = null;

// Animation lock — prevent rapid clicks during +1 animation
let animating = false;

// ─── Reduced motion preference ───
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ─── Initialize ───

/** A key that identifies the current population (shape, or "cat-<p>"). */
function popKey() {
  return isCat() ? `cat-${popPSlider ? popPSlider.value : '0.6'}` : popShapeSelect.value;
}

function initPopulation() {
  const popRng = createRng('pop-' + popKey());
  population = generatePopulation(popShapeSelect.value, popRng);
  popMu = mean(population);
  popSigma = sd(population);

  if (popMeanEl) popMeanEl.textContent = popMu.toFixed(isCat() ? 3 : 2);
  if (popSdEl) popSdEl.textContent = popSigma.toFixed(isCat() ? 3 : 2);

  renderPopulation();
  precomputeSamplingDomain();
  resetSimulation();
}

/**
 * Pre-compute the sampling distribution domain by running 2000 pilot samples.
 * Uses a separate RNG so the user's simulation is unaffected.
 */
function precomputeSamplingDomain() {
  const n = parseInt(sampleSizeInput.value, 10) || 30;
  const pilotRng = createRng('pilot-' + popKey() + '-' + n);
  const pilotMeans = [];
  for (let i = 0; i < 10000; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) {
      sum += population[Math.floor(pilotRng() * population.length)];
    }
    pilotMeans.push(sum / n);
  }
  pilotMeans.sort((a, b) => a - b);
  // Use 0.1th and 99.9th percentiles so rare outlier means don't cause rescaling
  const lo = pilotMeans[Math.floor(pilotMeans.length * 0.001)];
  const hi = pilotMeans[Math.floor(pilotMeans.length * 0.999)];
  const range = hi - lo || 1;
  // 15% padding on each side ensures virtually no sample mean falls outside
  samplingDomain = [lo - range * 0.15, hi + range * 0.15];
  // Lock the dotplot bin grid so stacks don't shift as dots are added
  const domainSpan = samplingDomain[1] - samplingDomain[0];
  const numDotBins = 40; // matches dotplot.js default max
  samplingBinWidth = domainSpan / numDotBins;
  samplingBinOrigin = samplingDomain[0];
}

function renderPopulation() {
  if (!popContainer) return;
  popContainer.innerHTML = '';
  const popLegend = document.getElementById('pop-legend');

  if (isCat()) {
    // Proportion population as a SHADED SQUARE split left/right — amber (success)
    // on the left covering fraction p of the width, blue (failure) on the right.
    // Sampling = uniform points on the square (a point's side = its outcome), so
    // it reads as drawing from an effectively infinite population, not reshuffling
    // a fixed set of cells.
    popBinWidth = null;
    popBinOrigin = null;
    const sq = document.createElement('div');
    sq.className = 'prop-square';
    const amber = document.createElement('div');
    amber.className = 'prop-region cat-success';
    amber.style.width = `${(popMu * 100).toFixed(2)}%`;
    const blue = document.createElement('div');
    blue.className = 'prop-region cat-failure';
    blue.style.width = `${((1 - popMu) * 100).toFixed(2)}%`;
    sq.appendChild(amber);
    sq.appendChild(blue);
    popContainer.appendChild(sq);
    popHistResult = null;
    if (popLegend) {
      popLegend.innerHTML =
        `<span class="leg-swatch cat-success"></span>success = ${popMu.toFixed(2)}`
        + `<span class="leg-swatch cat-failure"></span>failure = ${(1 - popMu).toFixed(2)}`;
      popLegend.classList.remove('is-hidden');
    }
    return;
  }

  if (popLegend) { popLegend.classList.add('is-hidden'); popLegend.innerHTML = ''; }

  // Means: histogram of the population, on an explicit uniform bin grid so the
  // sample dotplot can stack its dots on the exact same bins.
  // The population is bounded (see generatePopulation), so its min/max define a
  // tight, complete domain — every value, and therefore every sampled value,
  // fits with no off-scale overflow.
  const sorted = population.slice().sort((a, b) => a - b);
  const pLo = sorted[0];
  const pHi = sorted[sorted.length - 1];
  const pad = (pHi - pLo) * 0.04;
  const popDomain = /** @type {[number, number]} */ ([pLo - pad, pHi + pad]);
  popDisplayDomain = popDomain; // share this x-scale with the "One sample" tier

  const nbins = 40;
  popBinWidth = (popDomain[1] - popDomain[0]) / nbins;
  popBinOrigin = popDomain[0];
  const thresholds = [];
  for (let i = 1; i < nbins; i++) thresholds.push(popDomain[0] + i * popBinWidth);

  const result = drawHistogram(popContainer, population, {
    id: 'pop-hist',
    xLabel: lab().valueAxis,
    yLabel: '',
    titleText: 'Population Distribution',
    observedStat: popMu,
    observedLabel: lab().param,
    animate: false,
    domain: popDomain,
    viewHeight: 150,        // compact so all three tiers fit one view
    showExport: false,
    thresholds,
  });
  popHistResult = { frame: result.frame, xScale: result.xScale };
  // Remove y-axis entirely — population chart shows shape only
  d3Selection.select(result.frame.inner).select('.y-axis').remove();
}

/**
 * Render the most recently drawn sample in the middle "One sample" tier, on the
 * same x-scale as the population. The mean marker (x̄ line + the stat line below)
 * is deferred during the animated +1 — it appears only once the sample's dots
 * have visibly combined into the mean — so pass showMean=false for that.
 * @param {boolean} [showMean=true]
 */
function renderCurrentSample(showMean = true) {
  if (!sampleContainer) return;
  sampleContainer.innerHTML = '';
  if (lastSample.length === 0) {
    if (sampleStatLine) sampleStatLine.textContent = '';
    return;
  }
  // Proportions: the scooped sample is shown as marbles (matching the waffle).
  if (isCat()) {
    renderSampleMarbles(showMean);
    return;
  }
  const m = mean(lastSample);
  const opts = {
    id: 'current-sample',
    xLabel: lab().valueAxis,
    titleText: 'Current sample',
    ...(showMean && { observedStat: m, observedLabel: lab().stat }),
    animate: false,
    domain: popDisplayDomain || undefined,
    viewHeight: 150,        // compact so all three tiers fit one view
    showExport: false,
  };
  // Means render the sample as a dotplot when n is small (so the pluck/combine
  // animation works), else a histogram.
  if (resolveChartType(lastSample.length, 'auto') === 'dotplot') {
    // Shift the dot grid by half a bin so dot stacks sit under the bar centers.
    sampleDotOrigin = popBinOrigin + popBinWidth / 2;
    const r = drawDotplot(sampleContainer, lastSample, {
      ...opts,
      binWidth: popBinWidth,
      binOrigin: sampleDotOrigin,
    });
    d3Selection.select(r.frame.inner).select('.y-axis').remove();
    sampleInner = /** @type {SVGGElement} */ (r.frame.inner);
    sampleXScale = r.xScale;
  } else {
    const r = drawHistogram(sampleContainer, lastSample, { ...opts, numBins: 30 });
    d3Selection.select(r.frame.inner).select('.y-axis').remove();
    sampleInner = null;
    sampleXScale = null;
  }
  if (sampleStatLine) {
    sampleStatLine.innerHTML = showMean
      ? `<span id="sample-stat-value">x̄ = ${m.toFixed(2)}</span> &nbsp;(n = ${lastSample.length})`
      : '';
  }
}

/**
 * Render the scooped proportion sample as marbles (matching the population
 * waffle): n cells, successes (amber) grouped first, then failures (blue), so
 * the amber fraction IS p̂. Sets sampleInner = null (the marble animation is
 * handled separately, not via the dotplot pluck).
 * @param {boolean} showStat
 */
function renderSampleMarbles(showStat) {
  sampleInner = null;
  sampleXScale = null;
  if (!sampleContainer) return;
  const n = lastSample.length;
  const succ = lastSample.filter(v => v === 1).length;
  const grid = document.createElement('div');
  grid.className = 'marble-grid';
  for (let i = 0; i < n; i++) {
    const cell = document.createElement('span');
    cell.className = 'marble ' + (i < succ ? 'cat-success' : 'cat-failure');
    grid.appendChild(cell);
  }
  sampleContainer.appendChild(grid);
  if (sampleStatLine) {
    sampleStatLine.innerHTML = showStat
      ? `<span id="sample-stat-value">p̂ = ${succ}/${n} = ${(succ / n).toFixed(3)}</span>`
      : '';
  }
}

// ─── Sampling ───

/**
 * Draw one sample and return the sampled values.
 * @param {number} n - sample size
 * @returns {{ sample: number[], sampleMean: number }}
 */
function drawOneSample(n) {
  if (!rng) rng = createRng(seed);
  const sample = [];
  for (let j = 0; j < n; j++) {
    const idx = Math.floor(rng() * population.length);
    sample.push(population[idx]);
  }
  return { sample, sampleMean: mean(sample) };
}

/**
 * @param {number} count
 */
function drawSamples(count) {
  // Animate single draws (means and proportions). Comparison mode re-renders
  // instead; the animation itself no-ops gracefully when the sample isn't a
  // dotplot (large n) or reduced motion is set.
  if (count === 1 && !prefersReducedMotion && !frozen) {
    drawOneSampleAnimated();
    return;
  }

  if (!rng) rng = createRng(seed);
  const n = parseInt(sampleSizeInput.value, 10) || 30;
  const prevLength = sampleMeans.length;

  for (let i = 0; i < count; i++) {
    const { sample, sampleMean } = drawOneSample(n);
    sampleMeans.push(sampleMean);
    if (i === count - 1) lastSample = sample; // show the last sample of the batch
  }

  renderCurrentSample();
  updateStatsAndRender(prevLength, count);
}

/**
 * Convert a point in a chart inner-group's coordinates to viewport-fixed coords.
 * @param {SVGGElement} innerGroup
 * @param {number} x
 * @param {number} y
 * @returns {{x:number, y:number}}
 */
function localToScreen(innerGroup, x, y) {
  const svg = innerGroup.ownerSVGElement;
  const ctm = innerGroup.getScreenCTM();
  if (!svg || !ctm) return { x: 0, y: 0 };
  const pt = svg.createSVGPoint();
  pt.x = x; pt.y = y;
  const s = pt.matrixTransform(ctm);
  return { x: s.x, y: s.y };
}

/** Orange "sampled point" dots — created in the pluck phase, then reused in the
 *  combine phase (they consolidate into the mean). The blue sample dots are a
 *  separate, persistent layer. */
/** @type {HTMLElement[]} */
let pluckFlyers = [];

/**
 * Pluck phase: each sampled value appears as a small orange dot in the
 * population, then flies down to its landing spot in the One-sample dotplot. The
 * blue dotplot dots are revealed there and STAY; the orange flyers remain on top
 * for the combine phase. Quantitative mode only; reduced motion / non-dotplot
 * falls back to a direct reveal.
 * @param {number[]} sample
 * @param {() => void} onDone
 */
function animateSampleDraw(sample, onDone) {
  pluckFlyers = [];
  // Clear the previous draw's footprints — only the current sample is marked.
  if (popContainer) popContainer.querySelectorAll('.scoop-ghost').forEach(g => g.remove());
  const sampSvg = sampleContainer && sampleContainer.querySelector('svg');
  const popInner = popHistResult && popHistResult.frame.inner;
  // Runs whenever the sample is a dotplot (sampleInner set) — means or proportions.
  if (prefersReducedMotion || !sampSvg || !popInner || !sampleInner || popBinWidth == null) {
    onDone();
    return;
  }
  const circles = Array.from(sampSvg.querySelectorAll('.data circle'));
  if (circles.length !== sample.length) { onDone(); return; }

  const popXScale = popHistResult.xScale;
  const popH = popHistResult.frame.height;
  // Use the SAME dot grid as the rendered sample dotplot so flyers land on dots.
  const info = computeDots(sample, { binWidth: popBinWidth, binOrigin: sampleDotOrigin });

  // Hide the real dotplot dots until the flyers arrive (same tick — no flash).
  circles.forEach(c => { /** @type {SVGElement} */ (c).style.opacity = '0'; });

  /** @type {Array<{dot: HTMLElement, sx:number, sy:number, ex:number, ey:number, sz:number}>} */
  const flyers = [];
  for (let i = 0; i < sample.length; i++) {
    const d = info.dots[i];
    // Emerge from within the population bar (clamp the column so it stays in view).
    const startY = popH - Math.min(d.stackIndex, 12) * 6 - 5;
    const start = localToScreen(/** @type {SVGGElement} */ (popInner), popXScale(d.binCenter), startY);
    const tr = circles[i].getBoundingClientRect();
    const sz = Math.max(tr.width, 7);
    // In proportion mode, colour successes orange and failures grey so the split
    // is visible; in means mode everything is orange.
    const color = (isCat() && d.value === 0) ? '#bdbdbd' : '#E07020';
    const dot = document.createElement('div');
    dot.className = 'sl-flyer';
    dot.style.cssText = `position:fixed;left:${start.x - sz / 2}px;top:${start.y - sz / 2}px;`
      + `width:${sz}px;height:${sz}px;border-radius:50%;background:${color};z-index:1000;`
      + `pointer-events:none;opacity:0;transition:opacity .15s ease-in;`;
    document.body.appendChild(dot);
    flyers.push({ dot, sx: start.x, sy: start.y, ex: tr.left + tr.width / 2, ey: tr.top + tr.height / 2, sz });
  }
  // Fade the flyers in on the population, hold a beat, then fly them down.
  requestAnimationFrame(() => flyers.forEach(f => { f.dot.style.opacity = '1'; }));

  const FLY = 750, HOLD = 400;
  setTimeout(() => {
    // Stamp a faded square where each plucked point sat, so the population
    // histogram keeps showing where this sample came from (cleared next draw).
    if (popContainer) {
      const popRect = popContainer.getBoundingClientRect();
      for (const f of flyers) {
        const g = document.createElement('div');
        g.className = 'scoop-ghost';
        g.style.background = '#E07020';
        const gSz = Math.max(9, f.sz);
        g.style.left = `${f.sx - popRect.left}px`;
        g.style.top = `${f.sy - popRect.top}px`;
        g.style.width = `${gSz}px`;
        g.style.height = `${gSz}px`;
        popContainer.appendChild(g);
      }
    }
    const t0 = performance.now();
    function step(now) {
      const t = Math.min((now - t0) / FLY, 1);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      for (const f of flyers) {
        f.dot.style.left = `${f.sx + (f.ex - f.sx) * e - f.sz / 2}px`;
        f.dot.style.top = `${f.sy + (f.ey - f.sy) * e - f.sz / 2}px`;
      }
      if (t < 1) requestAnimationFrame(step);
      else {
        // Reveal the blue sample dots — they persist (the sample stays put).
        // Keep the orange flyers on top for the combine phase.
        circles.forEach(c => /** @type {SVGElement} */ (c).style.removeProperty('opacity'));
        pluckFlyers = flyers.map(f => f.dot);
        onDone();
      }
    }
    requestAnimationFrame(step);
  }, HOLD);
}

/**
 * Animated +1: pluck the sampled points from the population into the One-sample
 * dotplot, then drop the sample's statistic into the sampling distribution.
 */
/**
 * Combine phase: the orange flyers (sitting on the blue sample dots) converge to
 * the x̄ position and pile into a single orange dot — the sample mean. The blue
 * sample dots are left untouched (the sample persists). onDone receives the
 * merged dot's viewport-fixed position (or null under reduced motion / fallback).
 * @param {number} meanValue
 * @param {(pos: {x:number, y:number}|null) => void} onDone
 */
function animateCombineOrange(meanValue, onDone) {
  if (!pluckFlyers.length || prefersReducedMotion || !sampleInner || !sampleXScale) {
    pluckFlyers.forEach(d => d.remove());
    pluckFlyers = [];
    onDone(null);
    return;
  }
  const targetX = localToScreen(/** @type {SVGGElement} */ (sampleInner), sampleXScale(meanValue), 0).x;
  const starts = pluckFlyers.map(d => ({
    x: parseFloat(d.style.left) + d.offsetWidth / 2,
    y: parseFloat(d.style.top) + d.offsetHeight / 2,
  }));
  const targetY = starts.reduce((s, p) => s + p.y, 0) / starts.length;

  const DUR = 550;
  const t0 = performance.now();
  function step(now) {
    const t = Math.min((now - t0) / DUR, 1);
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    pluckFlyers.forEach((d, i) => {
      const sz = d.offsetWidth;
      d.style.left = `${starts[i].x + (targetX - starts[i].x) * e - sz / 2}px`;
      d.style.top = `${starts[i].y + (targetY - starts[i].y) * e - sz / 2}px`;
    });
    if (t < 1) requestAnimationFrame(step);
    else onDone({ x: targetX, y: targetY });
  }
  requestAnimationFrame(step);
}

/**
 * Proportion scoop — three visible phases so the *sampling* itself is the star:
 *   1. THROW: darts rain down onto the population square and stick (with a small
 *      overshoot bounce) at uniform random spots. A dart that lands on the amber
 *      (left) side is a success, on the blue (right) side a failure — it takes
 *      the colour of wherever it hit.
 *   2. HOLD: the stuck darts sit on the square for a beat — "this is the random
 *      sample of n points we just grabbed from the population."
 *   3. FLY: the darts lift off and fly down, growing into marbles, into their
 *      spots in the sorted One-sample grid.
 * Reduced motion / oversized scoops → straight reveal.
 * @param {number[]} sample
 * @param {() => void} onDone
 */
function animateScoop(sample, onDone) {
  const grid = sampleContainer && sampleContainer.querySelector('.marble-grid');
  const square = popContainer && popContainer.querySelector('.prop-square');
  // Clear the previous draw's footprints — only the current sample is marked.
  if (square) square.querySelectorAll('.scoop-ghost').forEach(g => g.remove());
  // Skip the per-marble fly for very large scoops (too many flyers).
  if (prefersReducedMotion || sample.length > CAT_DOT_MAX || !grid || !square) { onDone(); return; }
  const marbles = /** @type {HTMLElement[]} */ (Array.from(grid.querySelectorAll('.marble')));
  if (marbles.length !== sample.length) { onDone(); return; }

  const sq = square.getBoundingClientRect();
  const splitX = sq.left + popMu * sq.width; // boundary: amber (left) | blue (right)
  const successCount = sample.filter(v => v === 1).length;
  marbles.forEach(mb => { mb.style.visibility = 'hidden'; });

  // Overshoot ease so each dart snaps onto the board and settles — a "stick".
  const easeOutBack = (/** @type {number} */ t) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  };

  const n = marbles.length;
  const STAGGER = Math.min(420 / n, 22); // launch cadence — rat-a-tat of darts
  const THROW = 320;                     // each dart's flight onto the board
  const HOLD = 520;                      // pause to register the sample
  const FLY = 760;                       // lift-off to the One-sample grid
  const flyStart = (n - 1) * STAGGER + THROW + HOLD;
  const total = flyStart + FLY;

  const flyers = marbles.map((mb, i) => {
    const isSuccess = i < successCount; // grid is sorted: successes first
    // Landing spot: uniform point within the matching region of the square.
    const lx = isSuccess
      ? sq.left + Math.random() * (popMu * sq.width)
      : splitX + Math.random() * ((1 - popMu) * sq.width);
    const ly = sq.top + Math.random() * sq.height;
    const tr = mb.getBoundingClientRect();
    const endSz = tr.width || 16;
    const landSz = Math.max(7, endSz * 0.55); // a small dart tip; grows when it flies
    // Launch from above the square with a little drift so it reads as "thrown".
    const launchX = lx + (Math.random() - 0.5) * 50;
    const launchY = sq.top - 70 - Math.random() * 40;
    const dot = document.createElement('div');
    dot.className = 'sl-flyer marble ' + (isSuccess ? 'cat-success' : 'cat-failure');
    // White ring + drop shadow so the dart stays visible even when it lands on a
    // region of its own colour (amber-on-amber / blue-on-blue), and reads as
    // sitting ON the population board.
    dot.style.cssText = `position:fixed;left:0;top:0;width:${landSz}px;height:${landSz}px;`
      + `z-index:1000;pointer-events:none;opacity:0;`
      + `box-shadow:0 0 0 1.5px #fff, 0 2px 4px rgba(0,0,0,.45);`;
    document.body.appendChild(dot);
    return {
      dot, launchTime: i * STAGGER, launchX, launchY, lx, ly, isSuccess,
      // Landing spot as a fraction of the square, for the persistent footprint.
      pctX: ((lx - sq.left) / sq.width) * 100,
      pctY: ((ly - sq.top) / sq.height) * 100,
      ex: tr.left + tr.width / 2, ey: tr.top + tr.height / 2, landSz, endSz,
    };
  });

  const place = (/** @type {HTMLElement} */ el, /** @type {number} */ cx, /** @type {number} */ cy, /** @type {number} */ sz) => {
    el.style.left = `${cx - sz / 2}px`;
    el.style.top = `${cy - sz / 2}px`;
    el.style.width = `${sz}px`;
    el.style.height = `${sz}px`;
  };

  let ghostsPlaced = false;
  const t0 = performance.now();
  function step(now) {
    const elapsed = now - t0;
    // The instant the darts lift off, stamp a faint footprint where each landed
    // so the population square keeps showing where this sample came from.
    if (elapsed >= flyStart && !ghostsPlaced) {
      ghostsPlaced = true;
      for (const f of flyers) {
        const g = document.createElement('div');
        g.className = 'scoop-ghost marble ' + (f.isSuccess ? 'cat-success' : 'cat-failure');
        const gSz = Math.max(9, f.landSz); // sized so the fill shows under the 2px border
        g.style.left = `${f.pctX}%`;
        g.style.top = `${f.pctY}%`;
        g.style.width = `${gSz}px`;
        g.style.height = `${gSz}px`;
        square.appendChild(g);
      }
    }
    for (const f of flyers) {
      if (elapsed < flyStart) {
        // THROW + HOLD: dart drops onto the board, sticks, then waits.
        const tLand = elapsed - f.launchTime;
        if (tLand <= 0) { f.dot.style.opacity = '0'; place(f.dot, f.launchX, f.launchY, f.landSz); continue; }
        f.dot.style.opacity = String(Math.min(tLand / 70, 1));
        const tt = Math.min(tLand / THROW, 1);
        const e = easeOutBack(tt); // overshoots past the landing point, then settles
        place(f.dot, f.launchX + (f.lx - f.launchX) * e, f.launchY + (f.ly - f.launchY) * e, f.landSz);
      } else {
        // FLY: lift off the board and grow into a marble in the grid.
        const ft = Math.min((elapsed - flyStart) / FLY, 1);
        const e = ft < 0.5 ? 4 * ft * ft * ft : 1 - Math.pow(-2 * ft + 2, 3) / 2;
        const sz = f.landSz + (f.endSz - f.landSz) * e;
        place(f.dot, f.lx + (f.ex - f.lx) * e, f.ly + (f.ey - f.ly) * e, sz);
      }
    }
    if (elapsed < total) requestAnimationFrame(step);
    else {
      marbles.forEach(mb => { mb.style.visibility = ''; });
      flyers.forEach(f => f.dot.remove());
      onDone();
    }
  }
  requestAnimationFrame(step);
}

/**
 * Animated +1: scoop/pluck the sample from the population, combine it into the
 * statistic, then drop that statistic into the sampling distribution.
 */
function drawOneSampleAnimated() {
  if (animating) return;
  animating = true;

  const n = parseInt(sampleSizeInput.value, 10) || 30;
  const prevLength = sampleMeans.length;
  const { sample } = drawOneSample(n);
  const m = mean(sample);
  sampleMeans.push(m);

  lastSample = sample;
  renderCurrentSample(false);

  // Proportions: scoop marbles from the waffle, then fly p̂ into the distribution.
  if (isCat()) {
    animateScoop(sample, () => {
      renderCurrentSample(true);
      updateStatsAndRender(prevLength, 1);
      const src = /** @type {HTMLElement} */ (document.getElementById('sample-stat-value') || sampleContainer);
      animateDropToChart(src, samplingContainer, { duration: 700 });
      setTimeout(() => { animating = false; }, 780);
    });
    return;
  }

  // Means: pluck the points into the dotplot, then combine into the mean.
  animateSampleDraw(sample, () => {
    // 2) Hold, then consolidate the orange points into the mean (blue stays).
    setTimeout(() => {
      animateCombineOrange(m, (meanPos) => {
        // 3) The mean has coalesced — NOW reveal the x̄ marker, build the
        //    sampling distribution, and fly the merged orange dot into it.
        renderCurrentSample(true);
        updateStatsAndRender(prevLength, 1);
        const source = (meanPos && pluckFlyers[0])
          ? pluckFlyers[0]
          : /** @type {HTMLElement} */ (document.getElementById('sample-stat-value') || sampleContainer);
        animateDropToChart(source, samplingContainer, { duration: 700 });
        // The flyers' job is done — the drop spawns its own dot from here.
        pluckFlyers.forEach(d => d.remove());
        pluckFlyers = [];
        setTimeout(() => { animating = false; }, 780);
      });
    }, 300);
  });
}

/**
 * Update stats display and render the sampling distribution chart.
 * @param {number} prevLength
 * @param {number} count
 */
function updateStatsAndRender(prevLength, count) {
  const n = parseInt(sampleSizeInput.value, 10) || 30;

  // Update stats
  if (samplingStats) {
    const wasHidden = samplingStats.hidden;
    samplingStats.hidden = false;
    if (wasHidden && typeof renderMathInElement === 'function') {
      renderMathInElement(samplingStats, {
        delimiters: [{ left: '\\(', right: '\\)', display: false }],
      });
    }
  }
  if (nSamplesEl) nSamplesEl.textContent = String(sampleMeans.length);
  if (sampleMeans.length >= 2) {
    if (sdXbarEl) sdXbarEl.textContent = sd(sampleMeans).toFixed(4);
  }
  if (seTheoryEl) seTheoryEl.textContent = (popSigma / Math.sqrt(n)).toFixed(4);

  // Once a distribution exists, allow freezing it for comparison.
  if (freezeBtn && !frozen) freezeBtn.disabled = sampleMeans.length < 2;

  if (frozen) {
    // Comparison mode: render both distributions as relative-frequency
    // histograms on a shared axis so the spread difference (the n effect) is
    // unmistakable. (Skips the +1 highlight/dotplot machinery.)
    renderComparisonLive();
  } else {
    // Use pre-computed domain so axes never shift
    const sharedDomain = samplingDomain || /** @type {[number,number]} */ ([
      Math.min(...sampleMeans) - 0.5,
      Math.max(...sampleMeans) + 0.5,
    ]);

    let thresholds;
    if (isCat()) {
      // p̂ is discrete (only k/n is achievable). Snap bin edges to that grid so
      // the histogram isn't aliased — the same helper the sim pages use for
      // proportion null/bootstrap distributions.
      thresholds = snappedPropThresholds(n, sharedDomain, sampleMeans.length);
    } else {
      const { bins: fullBins } = computeBins(sampleMeans, { domain: sharedDomain });
      thresholds = fullBins.slice(1).map(b => b.x0);
    }

    lastDomain = sharedDomain;
    lastThresholds = thresholds;

    const { hlIndex, hlIndices, prevBinCounts } = computeHighlights(
      sampleMeans, prevLength, count, computeBins,
      { domain: sharedDomain, thresholds });

    renderSamplingDist(hlIndex, hlIndices, prevBinCounts, sharedDomain, thresholds);
  }
  displayInterpretation();

  if (resetBtn) resetBtn.hidden = false;
  announce(`Drew ${count} sample${count > 1 ? 's' : ''}. Total: ${sampleMeans.length}`);
  emitState('draw');
}

/** Union of the frozen domain and the current domain, so both fit one axis. */
function unionSamplingDomain() {
  const cur = samplingDomain;
  if (!frozen) return cur;
  if (!cur) return frozen.domain;
  return /** @type {[number,number]} */ ([
    Math.min(frozen.domain[0], cur[0]),
    Math.max(frozen.domain[1], cur[1]),
  ]);
}

/** Render the frozen distribution (muted, relative frequency) on the shared axis. */
function renderFrozen() {
  if (!frozenContainer || !frozen) return;
  frozenContainer.innerHTML = '';
  drawHistogram(frozenContainer, frozen.means, {
    id: 'frozen-dist',
    xLabel: lab().statAxis,
    titleText: '',
    observedStat: popMu,
    observedLabel: lab().param,
    animate: false,
    domain: unionSamplingDomain(),
    relativeFrequency: true,
    fillColor: '#8a8a8a',
    viewHeight: 230,        // compact so frozen + live both fit when comparing
    showExport: false,
    ...(isCat() && { thresholds: snappedPropThresholds(frozen.n, unionSamplingDomain(), frozen.means.length) }),
  });
  if (frozenLabel) frozenLabel.textContent = `n = ${frozen.n}, SD of ${lab().stat} = ${sd(frozen.means).toFixed(3)}`;
}

/** Render the live distribution (relative frequency) on the shared axis. */
function renderComparisonLive() {
  if (!samplingContainer) return;
  samplingContainer.innerHTML = '';
  if (sampleMeans.length === 0) return;
  const n = parseInt(sampleSizeInput.value, 10) || 30;
  drawHistogram(samplingContainer, sampleMeans, {
    id: 'sampling-dist',
    xLabel: lab().statAxis,
    titleText: '',
    observedStat: popMu,
    observedLabel: lab().param,
    animate: false,
    domain: unionSamplingDomain(),
    relativeFrequency: true,
    viewHeight: 230,        // match the frozen chart height for a fair compare
    showExport: false,
    ...(isCat() && {
      thresholds: snappedPropThresholds(n, unionSamplingDomain(), sampleMeans.length),
      fillColor: SUCCESS_AMBER, // p̂ is the proportion of successes
    }),
  });
  if (liveLabel) {
    liveLabel.textContent = sampleMeans.length >= 2
      ? `n = ${n}, SD of ${lab().stat} = ${sd(sampleMeans).toFixed(3)}`
      : `n = ${n} — draw samples`;
  }
}

/** Toggle the frozen comparison on/off. */
function toggleFreeze() {
  if (!frozen) {
    if (sampleMeans.length < 2) return;
    frozen = {
      n: parseInt(sampleSizeInput.value, 10) || 30,
      means: sampleMeans.slice(),
      domain: /** @type {[number,number]} */ ((samplingDomain || [0, 1]).slice()),
    };
    if (frozenWrap) frozenWrap.hidden = false;
    if (freezeBtn) { freezeBtn.textContent = 'Clear comparison'; freezeBtn.disabled = false; }
    renderFrozen();
    renderComparisonLive();
    announce(`Froze the n = ${frozen.n} sampling distribution. Now change n and draw again to compare.`);
    emitState('freeze');
  } else {
    frozen = null;
    if (frozenWrap) frozenWrap.hidden = true;
    if (freezeBtn) freezeBtn.textContent = 'Freeze this distribution to compare';
    // Re-render the live distribution in its normal (count) style.
    if (sampleMeans.length > 0) updateStatsAndRender(sampleMeans.length, 0);
    announce('Cleared comparison.');
    emitState('unfreeze');
  }
}

/**
 * Normal PDF
 * @param {number} x
 * @param {number} mu
 * @param {number} sigma
 * @returns {number}
 */
function normalPdf(x, mu, sigma) {
  const z = (x - mu) / sigma;
  return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
}

/**
 * Overlay a N(mu, se) curve on a histogram chart.
 * @param {SVGGElement} inner
 * @param {number} mu
 * @param {number} se
 * @param {Function} xScale
 * @param {Function} yScale
 * @param {number} totalCount
 * @param {number} binWidth - average bin width
 */
function overlayNormalCurve(inner, mu, se, xScale, yScale, totalCount, binWidth) {
  const overlays = d3Selection.select(inner).select('.overlays');
  overlays.selectAll('.normal-curve').remove();

  if (se <= 0 || totalCount < 10) return;

  const [xMin, xMax] = xScale.domain();
  const steps = 150;
  const dx = (xMax - xMin) / steps;

  const scaleFactor = totalCount * binWidth;

  /** @type {[number, number][]} */
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const x = xMin + i * dx;
    const y = normalPdf(x, mu, se) * scaleFactor;
    points.push([x, y]);
  }

  const line = d3Shape.line()
    .x(d => xScale(d[0]))
    .y(d => yScale(d[1]));

  overlays.append('path')
    .attr('class', 'normal-curve')
    .attr('d', line(points))
    .attr('fill', 'none')
    .attr('stroke', '#7B2D8E')
    .attr('stroke-width', 2.5)
    .attr('stroke-dasharray', '8,4');
}

/**
 * Overlay a N(mu, se) curve on a dotplot chart. Uses the chart's OWN rendered
 * bin width and count→pixel mapping (returned by drawDotplot) so the curve lines
 * up — both in dot mode and in filled-column (overflow) mode.
 * @param {ReturnType<typeof drawDotplot>} result
 * @param {number[]} values
 */
function overlayNormalOnDotplot(result, values) {
  const { frame, xScale, binWidth, countToY } = result;
  const n = values.length;
  const mu = mean(values);
  const se = sd(values);
  if (se <= 0 || n < 10 || !countToY) return;
  // Expected stack count at x ≈ n · pdf(x) · binWidth; countToY maps it to pixels.
  overlayNormalCurve(frame.inner, mu, se, xScale, countToY, n, binWidth);
}

/**
 * Overlay a N(mu, se) curve on the p̂ spike chart. Each spike's height is a count,
 * and achievable p̂ values are spaced binWidth = 1/sampleSize apart, so the
 * expected count at a value is n · pdf · binWidth — same scaling as a histogram.
 * @param {ReturnType<typeof drawSpike>} result
 * @param {number[]} values
 * @param {number} binWidth - spacing between achievable p̂ values (1 / sampleSize)
 */
function overlayNormalOnSpike(result, values, binWidth) {
  const { frame, xScale, yScale } = result;
  const n = values.length;
  const mu = mean(values);
  const se = sd(values);
  if (se <= 0 || n < 10 || !yScale) return;
  overlayNormalCurve(frame.inner, mu, se, xScale, yScale, n, binWidth);
}

/**
 * @param {number} [highlightIndex]
 * @param {Set<number>} [highlightIndices]
 * @param {number[]} [prevBinCounts]
 * @param {[number,number]} [domain]
 * @param {number[]} [thresholds]
 */
function renderSamplingDist(highlightIndex = -1, highlightIndices, prevBinCounts, domain, thresholds) {
  if (!samplingContainer) return;
  samplingContainer.innerHTML = '';
  const n = sampleMeans.length;
  if (n === 0) return;

  // Proportions are discrete: every p̂ lands on the k/n grid. Show one dot per
  // sample at its exact value (reads like the unit-1 dotplots students know)
  // while the pile stays short; once a stack would get too tall to read,
  // switch to a spike plot (one lollipop per achievable p̂).
  if (isCat()) {
    const sampleSize = parseInt(sampleSizeInput.value, 10) || 30;
    const binWidth = 1 / sampleSize;
    const { maxStack } = computeDots(sampleMeans, { binWidth, binOrigin: 0, domain });
    if (maxStack > CAT_SPIKE_STACK) {
      const spikeResult = drawSpike(samplingContainer, sampleMeans, {
        id: 'sampling-dist',
        xLabel: lab().statAxis,
        titleText: lab().samplingTitle,
        observedStat: popMu,
        observedLabel: lab().param,
        animate: false,
        domain,
        color: SUCCESS_AMBER, // p̂ is the proportion of successes
      });
      if (showNormalCheckbox?.checked && n >= 10) {
        overlayNormalOnSpike(spikeResult, sampleMeans, binWidth);
      }
    } else {
      const result = drawDotplot(samplingContainer, sampleMeans, {
        id: 'sampling-dist',
        xLabel: lab().statAxis,
        titleText: lab().samplingTitle,
        observedStat: popMu,
        observedLabel: lab().param,
        animate: false,
        highlightIndex,
        highlightIndices,
        domain,
        binWidth,
        binOrigin: 0,
        fillColor: SUCCESS_AMBER, // p̂ is the proportion of successes
        // The newest dot is orange; against the amber pile that's too close for
        // CVD, so give it a persistent dark border as a non-colour cue.
        highlightStroke: '#1A1A1A',
      });
      if (showNormalCheckbox?.checked && n >= 10) {
        overlayNormalOnDotplot(result, sampleMeans);
      }
    }
    return;
  }

  const activeChart = resolveChartType(n, 'auto');
  if (activeChart === 'dotplot') {
    const result = drawDotplot(samplingContainer, sampleMeans, {
      id: 'sampling-dist',
      xLabel: lab().statAxis,
      titleText: lab().samplingTitle,
      observedStat: popMu,
      observedLabel: lab().param,
      animate: false,
      highlightIndex,
      highlightIndices,
      domain,
      binWidth: samplingBinWidth,
      binOrigin: samplingBinOrigin,
    });
    if (showNormalCheckbox?.checked && n >= 10) {
      overlayNormalOnDotplot(result, sampleMeans);
    }
  } else {
    const result = drawHistogram(samplingContainer, sampleMeans, {
      id: 'sampling-dist',
      xLabel: lab().statAxis,
      titleText: lab().samplingTitle,
      observedStat: popMu,
      observedLabel: lab().param,
      animate: false,
      prevBinCounts,
      domain,
      thresholds,
    });
    if (showNormalCheckbox?.checked && result?.bins?.length > 0) {
      const firstX0 = result.bins[0].x0;
      const lastX1 = result.bins[result.bins.length - 1].x1;
      const avgBinWidth = (lastX1 - firstX0) / result.bins.length;
      const empiricalMu = mean(sampleMeans);
      const empiricalSE = sd(sampleMeans);
      overlayNormalCurve(result.frame.inner, empiricalMu, empiricalSE,
        result.xScale, result.yScale, n, avgBinWidth);
    }
  }
}

function displayInterpretation() {
  if (!resultDiv) return;
  const k = sampleMeans.length;
  const n = parseInt(sampleSizeInput.value, 10) || 30;

  if (k < 2) {
    resultDiv.innerHTML = `<p><strong>Sampling Distribution</strong> (${k} sample${k > 1 ? 's' : ''})</p>
      <p>Draw more samples to see the distribution take shape.</p>`;
    return;
  }

  const statSd = sd(sampleMeans);
  const theorySE = popSigma / Math.sqrt(n);

  let html;
  if (isCat()) {
    const p = popMu;
    html = `<p><strong>Sampling Distribution of \\(\\hat{p}\\)</strong> — ${k} samples of size \\(n = ${n}\\)</p>`;
    html += `<p>Population proportion: \\(p = ${p.toFixed(3)}\\)</p>`;
    html += `<p>SD of \\(\\hat{p}\\)'s \\(= ${statSd.toFixed(4)}\\) &ensp;(theory: \\(\\sqrt{p(1-p)/n} = ${theorySE.toFixed(4)}\\))</p>`;
    if (k >= 100) {
      const np = n * p, nq = n * (1 - p);
      const ok = np >= 10 && nq >= 10;
      html += `<p class="interpretation">The sampling distribution of \\(\\hat{p}\\) is centered at \\(p\\) with standard deviation \\(\\sqrt{p(1-p)/n}\\), and is approximately normal when both \\(np\\) and \\(n(1-p)\\) are at least about 10. Here \\(np = ${np.toFixed(1)}\\) and \\(n(1-p) = ${nq.toFixed(1)}\\) — ${ok ? 'both large enough, so the shape is roughly normal' : 'one is small, so the shape is skewed; increase \\(n\\) or move \\(p\\) toward 0.5'}. `;
      html += `<strong>Try changing \\(n\\):</strong> the center stays at \\(p\\), but the spread shrinks toward \\(\\sqrt{p(1-p)/n}\\). Drawing <em>more samples</em> only fills in the same distribution.</p>`;
    } else {
      html += `<p class="hint">Draw more samples (at least 100) to see the pattern clearly. Then change \\(n\\) to see a <em>different</em> distribution.</p>`;
    }
  } else {
    html = `<p><strong>Sampling Distribution</strong> — ${k} samples of size \\(n = ${n}\\)</p>`;
    html += `<p>Population: \\(\\mu = ${popMu.toFixed(2)}\\), &ensp;\\(\\sigma = ${popSigma.toFixed(2)}\\)</p>`;
    // Honest framing (REQ-030): lead with spread vs theory, not the mean-of-means.
    html += `<p>SD of \\(\\bar{x}\\)'s \\(= ${statSd.toFixed(4)}\\) &ensp;(theory: \\(\\sigma/\\sqrt{n} = ${theorySE.toFixed(4)}\\))</p>`;
    if (k >= 100) {
      html += `<p class="interpretation">The Central Limit Theorem says the sampling distribution of \\(\\bar{x}\\) is approximately normal with mean \\(\\mu\\) and standard deviation \\(\\sigma/\\sqrt{n}\\), regardless of the population shape — as long as \\(n\\) is large enough. `;
      if (n >= 30) {
        html += `With \\(n = ${n}\\), notice how the distribution of sample means is roughly bell-shaped, even though the population may not be. `;
      } else {
        html += `With \\(n = ${n}\\), the shape depends more on the population. Try increasing \\(n\\) to see the distribution become more normal. `;
      }
      html += `<strong>Try changing \\(n\\):</strong> the center stays at \\(\\mu\\), but the spread shrinks toward \\(\\sigma/\\sqrt{n}\\). Drawing <em>more samples</em> only fills in this same distribution more smoothly — it does not change its spread.</p>`;
    } else {
      html += `<p class="hint">Draw more samples (at least 100) to see the pattern clearly. Then change \\(n\\) to see a <em>different</em> distribution.</p>`;
    }
  }

  resultDiv.innerHTML = html;
  if (typeof renderMathInElement === 'function') {
    renderMathInElement(resultDiv, {
      delimiters: [{ left: '\\(', right: '\\)', display: false }],
    });
  }
}

// ─── Event listeners ───

for (const btn of genBtns) {
  btn.addEventListener('click', () => {
    const count = parseInt(btn.dataset.count, 10);
    drawSamples(count);
  });
}

popShapeSelect.addEventListener('change', () => {
  frozen = null; // a different population invalidates any frozen comparison
  initPopulation();
});

// Population-type toggle (quantitative ↔ categorical)
for (const b of popTypeBtns) {
  b.addEventListener('click', () => {
    const t = b.getAttribute('data-type');
    if (!t || t === popType) return;
    popType = t;
    frozen = null;
    for (const bb of popTypeBtns) {
      bb.setAttribute('aria-pressed', String(bb.getAttribute('data-type') === popType));
    }
    applyModeLabels();
    initPopulation();
  });
}

// Population proportion slider (categorical mode)
if (popPSlider) {
  popPSlider.addEventListener('input', () => {
    if (popPVal) popPVal.textContent = parseFloat(popPSlider.value).toFixed(2);
  });
  popPSlider.addEventListener('change', () => {
    frozen = null; // a different p is a different population
    initPopulation();
  });
}

if (freezeBtn) {
  freezeBtn.addEventListener('click', () => toggleFreeze());
}

/** Set a label's HTML and render any \(…\) math with KaTeX (so radicals get a
 *  proper overline instead of a bare √). */
function setMathLabel(el, html) {
  if (!el) return;
  el.innerHTML = html;
  if (typeof renderMathInElement === 'function') {
    renderMathInElement(el, { delimiters: [{ left: '\\(', right: '\\)', display: false }] });
  }
}

/** Update static labels (population stats, sampling stats, center note) per mode. */
function applyModeLabels() {
  const cat = isCat();
  setMathLabel(popMeanLabel, cat ? 'Population \\(p\\):' : 'Population \\(\\mu\\):');
  setMathLabel(popSdLabel, cat ? 'Population \\(\\sigma = \\sqrt{p(1-p)}\\):' : 'Population \\(\\sigma\\):');
  setMathLabel(sdLabel, cat ? "SD of \\(\\hat{p}\\)'s:" : "SD of \\(\\bar{x}\\)'s:");
  setMathLabel(theoryLabel, cat ? '\\(\\sqrt{p(1-p)/n}\\) (theory):' : '\\(\\sigma/\\sqrt{n}\\) (theory):');
  if (centerNote) {
    centerNote.textContent = cat
      ? 'The center of the sampling distribution sits at p for every n — increasing n does not move the center, it only shrinks the spread.'
      : 'The center of the sampling distribution sits at μ for every n — increasing n does not move the center, it only shrinks the spread.';
  }
  const samplingSubtitle = document.querySelector('#sampling-title span:last-child');
  if (samplingSubtitle) samplingSubtitle.textContent = cat ? "one dot per sample's p̂" : "one dot per sample's x̄";
  if (shapeControl) shapeControl.hidden = cat;
  if (pControl) pControl.hidden = !cat;
}

if (showNormalCheckbox) {
  showNormalCheckbox.addEventListener('change', () => {
    if (frozen) { renderComparisonLive(); return; } // normal overlay n/a in compare mode
    if (sampleMeans.length > 0) {
      renderSamplingDist(-1, undefined, undefined, lastDomain, lastThresholds);
    }
  });
}

sampleSizeInput.addEventListener('change', () => {
  const val = parseInt(sampleSizeInput.value, 10);
  if (val < 1) sampleSizeInput.value = '1';
  if (val > 500) sampleSizeInput.value = '500';
  updateSampleSubtitle();
  precomputeSamplingDomain();
  resetSimulation();
  announce(`Sample size set to ${sampleSizeInput.value}. Simulation reset.`);
});

/** Keep the "One sample" subtitle showing the actual n (e.g. "n = 30 values"). */
function updateSampleSubtitle() {
  const el = document.getElementById('sample-subtitle');
  if (el) el.innerHTML = `the latest draw of <i>n</i> = ${parseInt(sampleSizeInput.value, 10) || 30} values`;
}

// ─── Reset ───

if (resetBtn) {
  resetBtn.addEventListener('click', () => {
    resetSimulation();
    announce('Simulation reset.');
  });
}

/**
 * Broadcast the lab's current state so activity gates can react to it (REQ-034).
 * The `state` bag's keys are the metric names authors reference in `requires`
 * and {{...}} — documented in docs/activity-authoring-guide.md.
 * @param {string} event - what just happened: 'draw' | 'reset' | 'freeze' | 'unfreeze'
 */
function emitState(event) {
  const n = parseInt(sampleSizeInput.value, 10) || 30;
  const k = sampleMeans.length;
  const theorySE = isCat() ? Math.sqrt(popMu * (1 - popMu) / n) : popSigma / Math.sqrt(n);
  const state = {
    mode: isCat() ? 'prop' : 'quant',
    samples: k,                                  // number of statistics drawn
    n,                                           // current sample size
    frozen: !!frozen,                            // is a comparison pinned?
    frozenN: frozen ? frozen.n : null,
    param: popMu,                                // the truth: μ (quant) or p (prop)
    statMean: k >= 1 ? mean(sampleMeans) : null, // center of the sampling distribution
    statSD: k >= 2 ? sd(sampleMeans) : null,     // spread (SD of the statistic)
    theorySE,                                    // σ/√n  or  √(p(1−p)/n)
    lastStat: k >= 1 ? sampleMeans[k - 1] : null,
  };
  try {
    window.dispatchEvent(new CustomEvent('statlens:state', { detail: { tool: 'sampling-lab', event, state } }));
  } catch { /* CustomEvent unsupported — activities degrade to seed-based gates */ }
}

function resetSimulation() {
  sampleMeans = [];
  lastSample = [];
  rng = null;
  // Keep a fixed ?seed= reproducible across resets; otherwise reshuffle.
  seed = urlSeed || Math.random().toString(36).slice(2, 10);
  lastDomain = undefined;
  lastThresholds = undefined;
  animating = false;
  // Clean up any lingering animation elements
  if (popHistResult?.frame?.inner) {
    d3Selection.select(popHistResult.frame.inner).selectAll('.sample-overlay').remove();
  }
  document.querySelectorAll('.flying-dot').forEach(el => el.remove());
  if (sampleContainer) sampleContainer.innerHTML = '';
  if (sampleStatLine) sampleStatLine.textContent = '';
  if (samplingContainer) samplingContainer.innerHTML = '';
  if (samplingStats) samplingStats.hidden = true;
  if (resultDiv) resultDiv.innerHTML = '<p class="placeholder">Choose a population shape and click a button to draw samples.</p>';
  if (resetBtn) resetBtn.hidden = true;

  // A frozen distribution survives an n-change (the whole point of compare):
  // keep it pinned, re-rendered on the new shared axis; the live one awaits draws.
  if (frozen) {
    if (frozenWrap) frozenWrap.hidden = false;
    renderFrozen();
    if (liveLabel) liveLabel.textContent = `n = ${parseInt(sampleSizeInput.value, 10) || 30} — draw samples`;
    if (freezeBtn) { freezeBtn.textContent = 'Clear comparison'; freezeBtn.disabled = false; }
  } else {
    if (frozenWrap) frozenWrap.hidden = true;
    if (freezeBtn) { freezeBtn.textContent = 'Freeze this distribution to compare'; freezeBtn.disabled = true; }
  }
  emitState('reset');
}

// Answer an activity panel's request for current state (REQ-034 handshake).
window.addEventListener('statlens:request-state', () => emitState('sync'));

initKeyboardShortcuts(genBtns, resetBtn);
initPlayPause(genBtns, resetBtn);

// ─── Init ───

/** Apply deep-link URL params (for textbook links + activities). */
function initFromUrl() {
  const params = new URLSearchParams(location.search);
  const type = params.get('type');
  if (type === 'prop' || type === 'cat') {
    popType = 'cat';
    for (const bb of popTypeBtns) {
      bb.setAttribute('aria-pressed', String(bb.getAttribute('data-type') === 'cat'));
    }
  }
  const p = parseFloat(params.get('p') || '');
  if (popPSlider && isFinite(p) && p >= 0.05 && p <= 0.95) {
    popPSlider.value = String(p);
    if (popPVal) popPVal.textContent = p.toFixed(2);
  }
  const shape = params.get('shape');
  if (shape && [...popShapeSelect.options].some(o => o.value === shape)) {
    popShapeSelect.value = shape;
  }
  const n = parseInt(params.get('n') || '', 10);
  if (isFinite(n) && n >= 1 && n <= 500) sampleSizeInput.value = String(n);
}

// Wait for ?activity= JSON to inject its params before reading the URL, so
// activity-configured mode/p/n/seed take effect (REQ-020 race fix pattern).
(async () => {
  if (typeof window !== 'undefined' && window.__activityParamsReady) {
    try { await window.__activityParamsReady; } catch { /* ignore */ }
  }
  initFromUrl();
  applyModeLabels();
  updateSampleSubtitle();
  initPopulation();
})();
