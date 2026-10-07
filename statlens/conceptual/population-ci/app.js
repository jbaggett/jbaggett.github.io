// @ts-check
/**
 * Confidence Intervals by Repeated Sampling.
 *
 * Requested 2026-10-07 (Jeff, relaying a colleague): "demonstrate CI's by
 * sampling from a population instead of resampling from sample. this would be
 * for means and should look like the app for resampling for a mean CI. We
 * should select the population (like sampling lab distribution) and set the
 * sample size."
 *
 * So: `simulate/bootstrap-mean/`'s shape — population, one sample, the
 * distribution of the statistic, the interval — with the resampling step
 * replaced by a fresh draw from a population the reader chooses.
 *
 * ── The statistical care this page needs ──────────────────────────────────
 *
 * The middle 95% of a SAMPLING distribution is not a confidence interval. It is
 * the central range of x̄ values and it is centred on μ, which nobody knows. Say
 * "95% confidence interval" over that shaded band and you have taught the
 * single most common CI misconception — that the interval is a range the
 * statistic falls in, rather than a range built around the statistic.
 *
 * The page therefore keeps them as two separate steps and names them
 * differently. Step 3 reports "middle 95% of sample means" and a MARGIN OF
 * ERROR (its half-width). Step 4 carries that margin over to ONE sample and
 * draws x̄ ± m, which is the interval. The equivalence is then visible rather
 * than asserted: the interval reaches μ exactly when x̄ landed inside the shaded
 * band, because both statements say |x̄ − μ| ≤ m.
 *
 * That is also what separates this page from its neighbours:
 *   conceptual/bootstrap-shift/  — bootstrap distribution vs sampling distribution
 *   conceptual/ci-coverage/      — many intervals, counting the hits
 *   conceptual/two-se/           — the same equivalence with no numbers at all
 * This one is about where the WIDTH comes from, with numbers, for a population
 * the reader picked.
 *
 * The "first sample you drew" is deliberately the one used in step 4 rather
 * than the most recent. It is frozen at the moment the simulation starts, so
 * pressing +1000 refines the margin WITHOUT moving the interval it is applied
 * to — the reader watches one fixed interval's width settle. If step 4 followed
 * the latest sample, both ends would move at once and nothing could be read.
 */

import * as d3Array from 'd3-array';
import * as d3Scale from 'd3-scale';
import * as d3Axis from 'd3-axis';
import * as d3Selection from 'd3-selection';

import { createRng, rngFromState } from '../../js/prng.js';
import { createResampleStore } from '../../js/resample-store.js';
import { attachResamplePeek, createPeekElement } from '../../js/resample-peek.js';
import { generateQuantPopulation, POPULATION_SHAPES } from '../../js/populations.js';
import { mean, sd, quantile } from '../../js/stats.js';
import { drawHistogram } from '../../js/histogram.js';
import { drawDotplot } from '../../js/dotplot.js';
import { createChart, addAxes, holdHeight } from '../../js/chart-utils.js';
import { announce, initHelp } from '../../js/page-utils.js';

// ─── Constants ───

const POP_SIZE = 10000;
const MU_COLOR = '#D55E00';       // Okabe–Ito vermillion — the parameter
const STAT_COLOR = '#7B2D8E';     // the observed-statistic purple used everywhere
const CAPTURE = '#0072B2';        // the interval reaches μ
const MISS = '#D55E00';           // it does not
const MAX_SAMPLES = 100000;

// ─── State ───

const params = new URLSearchParams(location.search);
const seed = params.get('seed') || 'pci';
let shape = POPULATION_SHAPES.some((s) => s.id === params.get('shape'))
  ? /** @type {string} */ (params.get('shape')) : 'right-skewed';
let n = clampN(Number(params.get('n')) || 25);
let level = [90, 95, 99].includes(Number(params.get('level'))) ? Number(params.get('level')) : 95;

/** @type {number[]} */ let population = [];
let mu = 0, sigma = 0;
/** @type {() => number} */ let rng = createRng(seed);
/** @type {number[]} */ let means = [];
/** @type {number[]} */ let lastSample = [];
/** The sample step 4 keeps — frozen so its interval does not move as the margin settles. */
/** @type {number[]|null} */ let firstSample = null;
let firstMean = NaN;

/**
 * What each bar in step 3 came from, as the generator state each draw started
 * from — four numbers a sample rather than n values, so every one of 100,000
 * samples stays answerable. (The same retrieval the simulation pages use.)
 */
const samples = createResampleStore();
/** @type {any} */ let peekGeom = null;
/** @type {HTMLElement|null} */ let peekEl = null;
/** Which sample the hover is showing, so leaving can put the real one back. */
let peekedIndex = -1;

/** @param {number} v */
function clampN(v) { return Math.max(2, Math.min(200, Math.round(v))); }

// ─── Elements ───

const el = (/** @type {string} */ id) => document.getElementById(id);
const popChart = el('pop-chart'), sampleChart = el('sample-chart');
const distChart = el('dist-chart');
const popStats = el('pop-stats'), sampleStats = el('sample-stats');
const distStats = el('dist-stats'), ciVerdict = el('ci-verdict');
const shapeToggle = el('shape-toggle'), levelToggle = el('level-toggle');
const nInput = /** @type {HTMLInputElement|null} */ (el('n-input'));
const revealBtn = el('reveal-btn'), revealAnswer = el('reveal-answer');

// ─── Population ───

function buildPopulation() {
  // Seeded from the shape as well as the page seed, so switching shape and
  // switching back gives the same population rather than a new one.
  population = generateQuantPopulation(shape, createRng(`${seed}:pop:${shape}`), POP_SIZE);
  mu = mean(population);
  sigma = sd(population);
}

/** @returns {{values: number[], mean: number}} */
function drawSample() {
  /** @type {number[]} */
  const s = new Array(n);
  for (let i = 0; i < n; i++) s[i] = population[Math.floor(rng() * population.length)];
  return { values: s, mean: mean(s) };
}

// ─── The numbers step 3 and step 4 share ───

/**
 * The central band of the sample means, and its half-width.
 * @returns {{lo: number, hi: number, margin: number}|null}
 */
function band() {
  if (means.length < 20) return null;
  const a = (100 - level) / 200;
  const lo = quantile(means, a);
  const hi = quantile(means, 1 - a);
  return { lo, hi, margin: (hi - lo) / 2 };
}

// ─── Drawing ───

function drawPopulation() {
  if (!popChart) return;
  popChart.innerHTML = '';
  drawHistogram(popChart, population, {
    id: 'pci-pop',
    xLabel: 'Value',
    titleText: 'The population',
    descText: `A ${shape.replace('-', ' ')} population of ${POP_SIZE.toLocaleString()} values, `
      + `with mean ${mu.toFixed(2)}.`,
    observedStat: mu,
    observedLabel: 'μ',
    animate: false,
    numBins: 40,
    precision: 2,
    viewHeight: 230,
  });
  if (popStats) {
    popStats.innerHTML =
        `<span><span class="pci-k">N</span> <span class="pci-v">${POP_SIZE.toLocaleString()}</span></span>`
      + `<span><span class="pci-k">μ</span> <span class="pci-v">${mu.toFixed(2)}</span></span>`
      + `<span><span class="pci-k">σ</span> <span class="pci-v">${sigma.toFixed(2)}</span></span>`;
  }
}

function drawSamplePanel() {
  if (!sampleChart) return;
  sampleChart.innerHTML = '';
  if (!lastSample.length) {
    sampleChart.innerHTML = '<p class="pci-placeholder">Press <strong>+1</strong> to draw a sample.</p>';
    if (sampleStats) sampleStats.innerHTML = '';
    return;
  }
  const m = mean(lastSample);
  const opts = {
    id: 'pci-sample',
    xLabel: 'Value',
    titleText: 'The most recent sample',
    descText: `${n} values with mean ${m.toFixed(2)}.`,
    observedStat: m,
    observedLabel: 'x̄',
    animate: false,
    precision: 2,
    viewHeight: 200,
    // Same axis as the population, so "a sample is a piece of that" is visible
    // rather than something the reader has to reconstruct from two scales.
    domain: /** @type {[number, number]} */ ([
      /** @type {number} */ (d3Array.min(population)),
      /** @type {number} */ (d3Array.max(population)),
    ]),
  };
  if (n <= 60) drawDotplot(sampleChart, lastSample, opts);
  else drawHistogram(sampleChart, lastSample, { ...opts, numBins: 20 });

  if (sampleStats) {
    sampleStats.innerHTML =
        `<span><span class="pci-k">n</span> <span class="pci-v">${n}</span></span>`
      + `<span><span class="pci-k">x̄</span> <span class="pci-v">${m.toFixed(2)}</span></span>`
      + `<span><span class="pci-k">s</span> <span class="pci-v">${sd(lastSample).toFixed(2)}</span></span>`;
  }
}

/**
 * Step 3 — the sampling distribution, with the interval drawn on its own axis.
 *
 * The interval used to be a separate panel with its own scale, which made the
 * reader compare two pictures to see the one fact that matters. On one axis the
 * fact is simply visible: the bar beneath the axis is the SAME WIDTH as the
 * shaded band, slid off μ and onto the mean of the sample actually drawn.
 * (Jeff, 2026-10-07: "show the central 95% width and use that as the CI width
 * centred on the observed x̄ … or we could put it below the axis".)
 *
 * Which is also why μ and the observed x̄ are both marked here: the distance
 * between them is the thing the verdict is about, and it should be readable off
 * the picture rather than from two numbers in a readout.
 */
function drawDistribution() {
  if (!distChart) return;
  distChart.innerHTML = '';
  if (!means.length) {
    distChart.innerHTML = '<p class="pci-placeholder">No samples yet \u2014 press <strong>+1</strong>.</p>';
    if (distStats) distStats.innerHTML = '';
    if (ciVerdict) ciVerdict.innerHTML = '';
    return;
  }
  const b = band();
  const haveCI = !!(b && firstSample);
  const lo = haveCI ? firstMean - b.margin : NaN;
  const hi = haveCI ? firstMean + b.margin : NaN;

  // The axis has to hold the means, μ, and both ends of the interval — the
  // interval can reach past the sample means when x̄ was an unusual one, and
  // clipping it would hide exactly the case worth looking at.
  const loEnd = Math.min(d3Array.min(means) ?? mu, mu, haveCI ? lo : Infinity);
  const hiEnd = Math.max(d3Array.max(means) ?? mu, mu, haveCI ? hi : -Infinity);
  const pad = (hiEnd - loEnd) * 0.04 || 1;

  const result = drawHistogram(distChart, means, {
    id: 'pci-dist',
    xLabel: 'Sample mean (x\u0304)',
    titleText: 'Sampling distribution of the sample mean',
    descText: b
      ? `${means.length} sample means. The middle ${level}% run from ${b.lo.toFixed(2)} to `
        + `${b.hi.toFixed(2)}.` + (haveCI
          ? ` Your interval, the same width centred on x\u0304 = ${firstMean.toFixed(2)}, runs `
            + `${lo.toFixed(2)} to ${hi.toFixed(2)} and ${lo <= mu && mu <= hi ? 'contains' : 'misses'} `
            + `\u03BC = ${mu.toFixed(2)}.` : '')
      : `${means.length} sample means.`,
    observedStat: mu,
    observedLabel: '\u03BC',
    ciLines: b ? /** @type {[number, number]} */ ([b.lo, b.hi]) : undefined,
    // The MIDDLE is the marked region, as on every bootstrap CI page.
    isTail: b ? ((/** @type {number} */ v) => v >= b.lo && v <= b.hi) : undefined,
    animate: false,
    precision: 2,
    domain: /** @type {[number, number]} */ ([loEnd - pad, hiEnd + pad]),
    // Short and wide on purpose. The SVG scales to its container, so a tall
    // viewBox becomes a tall chart on a wide column — and the whole page is
    // meant to fit one screen. 320 leaves ~200 user units of plot above a
    // bottom margin that has to hold ticks, the axis title AND the interval.
    viewHeight: 320,
    margin: { top: 24, right: 22, bottom: 96, left: 56 },
  });

  wirePeek(result);
  if (haveCI) drawIntervalOnAxis(result, lo, hi);

  if (distStats) {
    const se = sd(means);
    const theory = sigma / Math.sqrt(n);
    distStats.innerHTML =
        `<span><span class="pci-k">Samples</span> <span class="pci-v">${means.length.toLocaleString()}</span></span>`
      + `<span><span class="pci-k">SD of the x\u0304's</span> <span class="pci-v">${se.toFixed(3)}</span></span>`
      + `<span><span class="pci-k">\u03C3/\u221An</span> <span class="pci-v">${theory.toFixed(3)}</span></span>`
      + (b
        ? `<span><span class="pci-k">Middle ${level}% of x\u0304's</span> `
          + `<span class="pci-v">${b.lo.toFixed(2)} to ${b.hi.toFixed(2)}</span></span>`
          + `<span><span class="pci-k">Margin of error</span> `
          + `<span class="pci-v">\u00b1 ${b.margin.toFixed(2)}</span></span>`
        : `<span class="pci-placeholder">Twenty samples needed before a middle ${level}% means anything.</span>`);
  }
  drawVerdict(b, lo, hi, haveCI);
}

/**
 * The observed sample's mean, and its interval, under the distribution's axis.
 * @param {{frame: any, xScale: any}} result
 * @param {number} lo @param {number} hi
 */
function drawIntervalOnAxis(result, lo, hi) {
  const { frame, xScale } = result;
  const g = d3Selection.select(frame.inner).select('.annotations');
  const captures = lo <= mu && mu <= hi;
  const colour = captures ? CAPTURE : MISS;

  // The axis title is placed by addAxes at `height + margin.bottom - 8`, so the
  // bar and its labels are laid out against that rather than guessed at — the
  // first attempt drew the x̄ label straight through "Sample mean (x̄)".
  const titleY = frame.height + frame.margin.bottom - 8;
  const barY = frame.height + 54;
  const statLabelY = frame.height + 39;
  const endsY = frame.height + 71;
  if (barY >= titleY) return;   // not enough margin; better nothing than a pile-up

  // The observed statistic, carried from the distribution down to the bar — the
  // line IS the argument: where the sample landed, and where its interval went.
  const px = xScale(firstMean);
  g.append('line')
    .attr('class', 'pci-xbar')
    .attr('x1', px).attr('x2', px).attr('y1', 0).attr('y2', barY)
    .attr('stroke', STAT_COLOR).attr('stroke-width', 2.5);
  // Beside the line, not on it — centred, the line ran straight through the
  // text. It flips to the other side near the right edge so it cannot overflow.
  const nearRight = px > frame.width - 90;
  g.append('text')
    .attr('x', px + (nearRight ? -7 : 7)).attr('y', statLabelY)
    .attr('text-anchor', nearRight ? 'end' : 'start')
    .attr('font-size', 12).attr('font-weight', 700).attr('fill', STAT_COLOR)
    .text(`x\u0304 = ${firstMean.toFixed(2)}`);

  g.append('line')
    .attr('class', 'pci-ci-bar')
    .attr('x1', xScale(lo)).attr('x2', xScale(hi)).attr('y1', barY).attr('y2', barY)
    .attr('stroke', colour).attr('stroke-width', 7).attr('stroke-linecap', 'round');
  for (const v of [lo, hi]) {
    g.append('line')
      .attr('x1', xScale(v)).attr('x2', xScale(v)).attr('y1', barY - 9).attr('y2', barY + 9)
      .attr('stroke', colour).attr('stroke-width', 3);
    g.append('text')
      .attr('x', xScale(v)).attr('y', endsY).attr('text-anchor', 'middle')
      .attr('font-size', 11).attr('font-weight', 700).attr('fill', colour)
      .text(v.toFixed(2));
  }
}

/** @param {{lo:number,hi:number,margin:number}|null} b */
function drawVerdict(b, lo, hi, haveCI) {
  if (!ciVerdict) return;
  if (!haveCI || !b) {
    ciVerdict.innerHTML = `<p class="pci-placeholder">${means.length
      ? `Draw at least 20 samples to get a margin of error.`
      : ''}</p>`;
    return;
  }
  const captures = lo <= mu && mu <= hi;
  const inside = firstMean >= b.lo && firstMean <= b.hi;
  ciVerdict.innerHTML =
    `<div class="pci-verdict ${captures ? 'is-yes' : 'is-no'}">`
    + `<span class="pci-glyph" aria-hidden="true">${captures ? '\u2713' : '\u2717'}</span>`
    + `<span>The interval <strong>${captures ? 'contains' : 'misses'}</strong> \u03BC, and x\u0304 is `
    + `<strong>${inside ? 'inside' : 'outside'}</strong> the shaded middle. `
    + `These always agree: the bar is the band's width, moved onto x\u0304.</span></div>`;
}

/**
 * Hovering a bar in step 3 puts THAT sample into step 2.
 *
 * Here a dot is a whole SAMPLE rather than a resample: every bar is a batch of
 * samples that happened to have similar means, and hovering says which one.
 *
 * @param {{frame: any, xScale: any, yScale: any, bins?: any[]}} result
 */
function wirePeek(result) {
  if (!distChart) return;
  if (!peekEl) peekEl = createPeekElement(distChart);
  peekGeom = { xScale: result.xScale, yScale: result.yScale, frame: result.frame,
               bins: result.bins ?? null };
  attachResamplePeek({
    container: distChart,
    peek: /** @type {HTMLElement} */ (peekEl),
    geom: peekGeom,
    stats: () => means,
    onLeave: () => {
      if (peekedIndex === -1) return;
      peekedIndex = -1;
      if (lastSample.length) drawSamplePanel();
    },
    describe: (i, approx) => {
      const rec = samples.get(i);
      if (!rec?.st) return null;
      if (i !== peekedIndex) {
        peekedIndex = i;
        showPeekedSample(replaySample(rec.st));
      }
      return {
        title: `Sample ${i + 1}${approx ? ' (one of the samples in this bar)' : ''}`,
        detail: `shown in step 2 \u2014 x\u0304 = ${means[i].toFixed(2)}`,
      };
    },
  });
}

/**
 * The sample a stored generator state produced — n lookups into the population,
 * replayed rather than kept.
 * @param {ReadonlyArray<number>} state
 * @returns {number[]}
 */
function replaySample(state) {
  const r = rngFromState(state);
  const values = new Array(n);
  for (let k = 0; k < n; k++) values[k] = population[Math.floor(r() * population.length)];
  return values;
}

/**
 * Draw a hovered sample into step 2 without losing the one actually drawn last,
 * so leaving the chart can put it back.
 * @param {number[]} values
 */
function showPeekedSample(values) {
  const keep = lastSample;
  lastSample = values;
  drawSamplePanel();
  lastSample = keep;
}

function redraw() {
  drawPopulation();
  drawSamplePanel();
  drawDistribution();
}

// ─── Running ───

/** @param {number} count */
function addSamples(count) {
  if (means.length >= MAX_SAMPLES) { announce('Enough samples.'); return; }
  const take = Math.min(count, MAX_SAMPLES - means.length);
  for (let i = 0; i < take; i++) {
    const st = /** @type {any} */ (rng).getState();
    const s = drawSample();
    samples.rememberState(means.length, st);
    lastSample = s.values;
    means.push(s.mean);
    if (!firstSample) { firstSample = s.values; firstMean = s.mean; }
  }
  redraw();
  const b = band();
  announce(`${take} more sample${take === 1 ? '' : 's'}; ${means.length} in all.`
    + (b ? ` Middle ${level}% of the sample means: ${b.lo.toFixed(2)} to ${b.hi.toFixed(2)}, `
         + `margin ${b.margin.toFixed(2)}.` : ''));
}

function reset(message = 'Started over.') {
  means = []; lastSample = []; firstSample = null; firstMean = NaN;
  samples.clear(); peekedIndex = -1;
  rng = createRng(`${seed}:${shape}:${n}`);
  redraw();
  announce(message);
}

// ─── Wiring ───

if (shapeToggle) {
  shapeToggle.innerHTML = POPULATION_SHAPES.map((s) =>
    `<button type="button" data-shape="${s.id}" aria-pressed="${s.id === shape}" `
    + `title="${s.blurb}">${s.label}</button>`).join('');
  shapeToggle.addEventListener('click', (ev) => {
    const btn = /** @type {HTMLElement} */ (ev.target).closest('button[data-shape]');
    if (!btn) return;
    const next = /** @type {string} */ (/** @type {HTMLElement} */ (btn).dataset.shape);
    if (next === shape) return;
    shape = next;
    for (const b of shapeToggle.querySelectorAll('button[data-shape]')) {
      b.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (b).dataset.shape === shape));
    }
    buildPopulation();
    reset(`${shape.replace('-', ' ')} population: μ = ${mu.toFixed(2)}, σ = ${sigma.toFixed(2)}.`);
  });
}

levelToggle?.addEventListener('click', (ev) => {
  const btn = /** @type {HTMLElement} */ (ev.target).closest('button[data-level]');
  if (!btn) return;
  level = Number(/** @type {HTMLElement} */ (btn).dataset.level);
  for (const b of levelToggle.querySelectorAll('button[data-level]')) {
    b.setAttribute('aria-pressed', String(Number(/** @type {HTMLElement} */ (b).dataset.level) === level));
  }
  // The samples stand — only which middle is shaded changes. That is the point
  // of the control: a wider level is a wider margin from the SAME simulation.
  redraw();
  announce(`${level} percent level.`);
});

nInput?.addEventListener('change', () => {
  const v = clampN(Number(nInput.value));
  nInput.value = String(v);
  if (v === n) return;
  n = v;
  reset(`Sample size ${n}. Everything cleared, because the sampling distribution depends on n.`);
});

for (const btn of document.querySelectorAll('.gen-btn')) {
  btn.addEventListener('click', () =>
    addSamples(Number(/** @type {HTMLElement} */ (btn).dataset.count) || 1));
}
el('reset-btn')?.addEventListener('click', () => reset());

revealBtn?.addEventListener('click', () => {
  if (!revealAnswer) return;
  const open = revealAnswer.hidden;
  revealAnswer.hidden = !open;
  revealBtn.setAttribute('aria-expanded', String(open));
  revealBtn.textContent = open ? 'Hide the answer' : 'Show the answer';
  if (open && !revealAnswer.innerHTML) {
    revealAnswer.innerHTML =
      '<p>Exactly when <span class="x-bar">x</span> landed inside the shaded middle. Both statements '
      + 'say the same thing &mdash; that the distance between <span class="x-bar">x</span> and &mu; is '
      + 'no more than the margin &mdash; read from opposite ends. So the intervals that work are the '
      + 'ones built from shaded samples, and that is the stated percentage of them. Nothing about '
      + 'your particular interval is 95% likely; the 95% is the success rate of the recipe.</p>';
  }
});

document.addEventListener('keydown', (ev) => {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(/** @type {HTMLElement} */ (ev.target).tagName)) return;
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const counts = { '1': 1, '2': 10, '3': 100, '4': 1000 };
  if (ev.key in counts) { ev.preventDefault(); addSamples(counts[/** @type {'1'} */ (ev.key)]); }
  else if (ev.key === 'r' || ev.key === 'R') { ev.preventDefault(); reset(); }
});

initHelp();

if (nInput) nInput.value = String(n);
for (const b of levelToggle?.querySelectorAll('button[data-level]') ?? []) {
  b.setAttribute('aria-pressed', String(Number(/** @type {HTMLElement} */ (b).dataset.level) === level));
}
buildPopulation();
rng = createRng(`${seed}:${shape}:${n}`);
redraw();

// Each panel keeps the tallest height it has had. Without it the first draw
// swaps a one-line placeholder for a chart, everything below jumps, and the
// generate button the reader just pressed slides out from under the pointer —
// which then lands on a dot and pops its tooltip. Same failure as the mechanism
// strip on the one-proportion pages (2026-10-06).
for (const id of ['pop-chart', 'sample-chart', 'dist-chart']) {
  holdHeight(/** @type {HTMLElement|null} */ (el(id)));
}

const preset = Number(params.get('samples'));
if (Number.isFinite(preset) && preset > 0) addSamples(Math.min(preset, MAX_SAMPLES));
