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
const distChart = el('dist-chart'), ciChart = el('ci-chart');
const popStats = el('pop-stats'), sampleStats = el('sample-stats');
const distStats = el('dist-stats'), ciStats = el('ci-stats'), ciVerdict = el('ci-verdict');
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

function drawDistribution() {
  if (!distChart) return;
  distChart.innerHTML = '';
  if (!means.length) {
    distChart.innerHTML = '<p class="pci-placeholder">No samples yet.</p>';
    if (distStats) distStats.innerHTML = '';
    return;
  }
  const b = band();
  const result = drawHistogram(distChart, means, {
    id: 'pci-dist',
    xLabel: 'Sample mean (x̄)',
    titleText: 'Sampling distribution of the sample mean',
    descText: b
      ? `${means.length} sample means. The middle ${level}% run from ${b.lo.toFixed(2)} to ${b.hi.toFixed(2)}.`
      : `${means.length} sample means.`,
    observedStat: mu,
    observedLabel: 'μ',
    ciLines: b ? /** @type {[number, number]} */ ([b.lo, b.hi]) : undefined,
    // The MIDDLE is the marked region, as on every bootstrap CI page
    // (`regionPredicate = v => v >= ci[0] && v <= ci[1]`). Marking the outside
    // instead — which reads naturally from the name `isTail` — put the colour
    // on the two slivers nobody is being asked to look at.
    isTail: b ? ((/** @type {number} */ v) => v >= b.lo && v <= b.hi) : undefined,
    animate: false,
    precision: 2,
    viewHeight: 260,
  });

  wirePeek(result);

  if (distStats) {
    const se = sd(means);
    const theory = sigma / Math.sqrt(n);
    distStats.innerHTML =
        `<span><span class="pci-k">Samples</span> <span class="pci-v">${means.length.toLocaleString()}</span></span>`
      + `<span><span class="pci-k">SD of the x̄'s</span> <span class="pci-v">${se.toFixed(3)}</span></span>`
      + `<span><span class="pci-k">σ/√n</span> <span class="pci-v">${theory.toFixed(3)}</span></span>`
      + (b
        ? `<span><span class="pci-k">Middle ${level}% of x̄'s</span> `
          + `<span class="pci-v">${b.lo.toFixed(2)} to ${b.hi.toFixed(2)}</span></span>`
          + `<span><span class="pci-k">Margin of error</span> `
          + `<span class="pci-v">± ${b.margin.toFixed(2)}</span></span>`
        : `<span class="pci-placeholder">Twenty samples needed before a middle ${level}% means anything.</span>`);
  }
}

/**
 * Step 4 — one sample, one interval, drawn on the sampling distribution's axis.
 *
 * Hand-built rather than a chart helper: what is being drawn is an interval as
 * a BAR under an axis, next to μ. No histogram renderer makes that picture, and
 * borrowing one would have meant hiding most of it.
 */
function drawInterval() {
  if (!ciChart) return;
  ciChart.innerHTML = '';
  const b = band();
  if (!firstSample || !b) {
    ciChart.innerHTML = `<p class="pci-placeholder">${firstSample
      ? 'Draw at least 20 samples to get a margin of error.'
      : 'Press <strong>+1</strong> to draw your sample.'}</p>`;
    if (ciVerdict) ciVerdict.innerHTML = '';
    if (ciStats) ciStats.innerHTML = '';
    return;
  }
  const lo = firstMean - b.margin, hi = firstMean + b.margin;
  const captures = lo <= mu && mu <= hi;

  const frame = createChart(ciChart, {
    viewHeight: 150,
    titleText: 'Your interval',
    descText: `From the first sample: ${lo.toFixed(2)} to ${hi.toFixed(2)}. `
      + `It ${captures ? 'contains' : 'does not contain'} μ = ${mu.toFixed(2)}.`,
    id: 'pci-ci',
  });

  const pad = Math.max(b.margin * 1.6, Math.abs(firstMean - mu) * 1.5) || 1;
  const x = d3Scale.scaleLinear()
    .domain([Math.min(lo, mu) - pad, Math.max(hi, mu) + pad])
    .range([0, frame.width]);
  const yAxis = d3Scale.scaleLinear().domain([0, 1]).range([frame.height, 0]);
  const axis = d3Axis.axisBottom(x);
  addAxes(frame, axis, d3Axis.axisLeft(yAxis).ticks(0), 'Sample mean (x̄)', '');
  // No y scale here — the vertical direction carries nothing.
  d3Selection.select(frame.inner).select('.y-axis').remove();

  const g = d3Selection.select(frame.inner).select('.data');
  const barY = frame.height * 0.55;

  // μ first, so the bar reads as reaching for it.
  g.append('line')
    .attr('x1', x(mu)).attr('x2', x(mu)).attr('y1', 6).attr('y2', frame.height)
    .attr('stroke', MU_COLOR).attr('stroke-width', 2.5).attr('stroke-dasharray', '6,4');
  g.append('text')
    .attr('x', x(mu)).attr('y', 0).attr('dy', 12).attr('text-anchor', 'middle')
    .attr('font-size', 13).attr('font-weight', 700).attr('fill', MU_COLOR)
    .text(`μ = ${mu.toFixed(2)}`);

  const colour = captures ? CAPTURE : MISS;
  g.append('line')
    .attr('x1', x(lo)).attr('x2', x(hi)).attr('y1', barY).attr('y2', barY)
    .attr('stroke', colour).attr('stroke-width', 6).attr('stroke-linecap', 'round');
  for (const v of [lo, hi]) {
    g.append('line')
      .attr('x1', x(v)).attr('x2', x(v)).attr('y1', barY - 9).attr('y2', barY + 9)
      .attr('stroke', colour).attr('stroke-width', 3);
  }
  g.append('circle')
    .attr('cx', x(firstMean)).attr('cy', barY).attr('r', 5)
    .attr('fill', STAT_COLOR);
  g.append('text')
    .attr('x', x(firstMean)).attr('y', barY + 26).attr('text-anchor', 'middle')
    .attr('font-size', 12).attr('font-weight', 700).attr('fill', STAT_COLOR)
    .text(`x̄ = ${firstMean.toFixed(2)}`);

  if (ciVerdict) {
    ciVerdict.innerHTML =
      `<div class="pci-verdict ${captures ? 'is-yes' : 'is-no'}">`
      + `<span class="pci-glyph" aria-hidden="true">${captures ? '✓' : '✗'}</span>`
      + `<span>Your interval runs <strong>${lo.toFixed(2)} to ${hi.toFixed(2)}</strong> and `
      + `<strong>${captures ? 'contains' : 'does not contain'}</strong> μ = ${mu.toFixed(2)}. `
      + `Your x̄ of ${firstMean.toFixed(2)} is <strong>${
        firstMean >= b.lo && firstMean <= b.hi ? 'inside' : 'outside'}</strong> the shaded middle `
      + `in step 3 &mdash; and those two facts always agree, because both say the distance from `
      + `x̄ to μ is ${captures ? 'no more' : 'more'} than ${b.margin.toFixed(2)}.</span></div>`;
  }
  if (ciStats) {
    ciStats.innerHTML =
        `<span><span class="pci-k">x̄</span> <span class="pci-v">${firstMean.toFixed(2)}</span></span>`
      + `<span><span class="pci-k">Margin</span> <span class="pci-v">± ${b.margin.toFixed(2)}</span></span>`
      + `<span><span class="pci-k">Interval</span> `
      + `<span class="pci-v">(${lo.toFixed(2)}, ${hi.toFixed(2)})</span></span>`
      + `<span><span class="pci-k">|x̄ − μ|</span> `
      + `<span class="pci-v">${Math.abs(firstMean - mu).toFixed(2)}</span></span>`;
  }
}

/**
 * Hovering a bar in step 3 puts THAT sample into step 2.
 *
 * "I want the sampling labs and differences of props and means to have
 * hoverable dots that show the original samples, this should extend to the new
 * app." (Jeff, 2026-10-07.) Here a dot is a whole SAMPLE rather than a
 * resample, which makes the question more direct still: every bar is a batch of
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
  drawInterval();
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
for (const id of ['pop-chart', 'sample-chart', 'dist-chart', 'ci-chart']) {
  holdHeight(/** @type {HTMLElement|null} */ (el(id)));
}

const preset = Number(params.get('samples'));
if (Number.isFinite(preset) && preset > 0) addSamples(Math.min(preset, MAX_SAMPLES));
