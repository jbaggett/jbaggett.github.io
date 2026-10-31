// @ts-check
/**
 * Where the curve comes from — the sampling distribution of a test statistic.
 *
 * Jeff, 2026-10-31: "todd's app was built just to illustrate the sampling
 * distribution for chi-square … I'm sure we can figure out how to do something
 * to illustrate other important stats like F and t."
 *
 * This is the t case, built first because it carries the one idea the other two
 * cannot: the statistic's shape depends on its DENOMINATOR, and you can see
 * that by rescoring the very same samples.
 *
 * The move is a toggle, not a second simulation. Each sample contributes both
 *
 *     z = (x̄ − μ) / (σ/√n)        the true standard error, same every time
 *     t = (x̄ − μ) / (s/√n)        this sample's own s, different every time
 *
 * and the toggle chooses which of the two is piled up. Nothing about x̄ changes
 * between the views — the numerator is identical, sample for sample — so the
 * heavier tails cannot be blamed on the means. They come from a denominator
 * that wobbles. Running two independent simulations would prove nothing of the
 * sort: the shapes would differ and a reader could reasonably think the SAMPLES
 * differed.
 *
 * ⚠ The x-domain is FIXED at ±5. A statistic's distribution is being compared
 * with a curve and with its own other scoring, and an axis that rescaled on
 * each render would hide the whole effect — fatter tails drawn to the same
 * width look identical. Same reason the bin grid is locked.
 *
 * Why this is not part of the Sampling Distribution Lab: the Lab's frame is
 * parameter → estimate, and its central claim is that the parameter marker and
 * the simulated centre coincide at every n (see sampling-lab-centre.spec.js,
 * and the Watkins trap it guards). A test statistic has no parameter to mark,
 * and is generated under a stated model rather than drawn from a population
 * that exists — `statedPopulation` rather than `sampling` in the mechanism
 * vocabulary. Putting them in one page would cost the Lab the one thing it is
 * built to say.
 *
 * Sibling of `conceptual/why-t-star/`, which takes the next step: what these
 * tails cost in interval coverage. That page states the mechanism in prose —
 * "a random denominator gives (x̄−μ)/(s/√n) heavier tails than a normal" — and
 * never draws it. This page draws it.
 */

import { createRng, randNormal } from '../../js/prng.js';
import { mean, sd } from '../../js/stats.js';
import { setJStat, tCDF } from '../../js/distributions.js';
import { renderSimChart } from '../../js/chart-defaults.js';
import { normalPdf, overlayTheoryCurve } from '../../js/theory-overlay.js';
import { announce, initHelp, initSettings } from '../../js/page-utils.js';

// ─── The population ───
//
// A concrete scale rather than N(0,1): standardizing a standard normal makes
// Step 1 and Step 2 abstract exactly where a reader is trying to see what is
// being divided by what. These are the usual IQ-ish numbers, so σ/√n and s/√n
// are visibly different quantities on a visibly real axis.
const MU = 100;
const SIGMA = 15;

/** The axis both scorings are drawn on. Fixed — see the note at the top. */
/** @type {[number, number]} */
const DOMAIN = [-5, 5];
const BIN_WIDTH = 0.25;
/**
 * The bin edges, stated explicitly.
 *
 * `binWidth` only locks a DOTPLOT's grid; a histogram takes `thresholds`. With
 * neither, the chart chose its own bin count — ten bars across ±5, which is a
 * bin a whole unit wide and far too coarse to show a tail thickening. The two
 * scorings also have to share one grid, or the comparison is between two
 * different binnings as much as between two statistics.
 */
const THRESHOLDS = Array.from(
  { length: Math.round((DOMAIN[1] - DOMAIN[0]) / BIN_WIDTH) + 1 },
  (_, i) => DOMAIN[0] + i * BIN_WIDTH);

/** The cutoff the tally counts against: the one students reach for by habit. */
const Z_CUT = 1.96;

const el = (/** @type {string} */ id) => document.getElementById(id);

const nSlider = /** @type {HTMLInputElement} */ (el('n-slider'));
const nValue = el('n-value');
const scoreToggle = el('score-toggle');
const popWrap = el('sc-pop');
const sampleWrap = el('sc-sample');
const scoreWrap = el('sc-score');
const chartWrap = el('chart');
const readout = el('readout');
const distTitle = el('dist-title');
const genBtns = /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll('.gen-btn')]);

const params = new URLSearchParams(location.search);
const seed = params.get('seed') || 'curve';

let n = 10;
/** 'z' divides by the true SE; 't' by the sample's own. */
let scoring = 'z';
/** @type {{ z: number, t: number }[]} Both scorings of every sample drawn. */
let stats = [];
/** @type {{ values: number[], xbar: number, s: number, z: number, t: number }|null} */
let lastSample = null;
/** @type {() => number} */
let rng = createRng(`${seed}-${n}`);

/** The statistic currently piled up. */
const current = () => stats.map((p) => (scoring === 'z' ? p.z : p.t));

const fmt = (/** @type {number} */ v, /** @type {number} */ d = 2) => v.toFixed(d);

// ─── Drawing ───

/**
 * One sample, scored both ways.
 *
 * ⚠ Both scorings come from ONE draw. The toggle must never re-sample: the
 * claim is that the numerator is identical and only the denominator moved.
 */
function drawOne() {
  const values = [];
  for (let i = 0; i < n; i++) values.push(randNormal(MU, SIGMA, rng));
  const xbar = mean(values);
  const s = sd(values);
  const gap = xbar - MU;
  return {
    values,
    xbar,
    s,
    z: gap / (SIGMA / Math.sqrt(n)),
    // s = 0 needs n identical values from a continuous distribution; guard
    // anyway rather than push an Infinity into the histogram's domain.
    t: s > 0 ? gap / (s / Math.sqrt(n)) : 0,
  };
}

/** @param {number} k */
function draw(k) {
  for (let i = 0; i < k; i++) {
    const one = drawOne();
    stats.push({ z: one.z, t: one.t });
    lastSample = one;
  }
  render();
  announce(`${k} sample${k === 1 ? '' : 's'} drawn. ${stats.length} in the distribution.`);
}

function reset() {
  stats = [];
  lastSample = null;
  // Re-seeded per n, so a given ?seed= and n always replay the same run.
  rng = createRng(`${seed}-${n}`);
  render();
}

// ─── Step 1: the population ───

function renderPopulation() {
  if (!popWrap) return;
  const W = 420, H = 96, PAD = 10;
  const lo = MU - 3.6 * SIGMA, hi = MU + 3.6 * SIGMA;
  const x = (/** @type {number} */ v) => PAD + ((v - lo) / (hi - lo)) * (W - 2 * PAD);
  const peak = normalPdf(MU, MU, SIGMA);
  const y = (/** @type {number} */ d) => H - 22 - (d / peak) * (H - 40);

  let path = '';
  for (let i = 0; i <= 120; i++) {
    const v = lo + (i / 120) * (hi - lo);
    path += `${i ? 'L' : 'M'}${x(v).toFixed(1)},${y(normalPdf(v, MU, SIGMA)).toFixed(1)}`;
  }

  // ±1σ marked as a span, not two loose ticks: σ is a width, and the sample's
  // s in Step 2 is the same kind of thing measured on the sample.
  popWrap.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img"
         aria-label="A normal population with mean ${MU} and standard deviation ${SIGMA}.">
      <path d="${path}" fill="none" stroke="#569BBD" stroke-width="2"/>
      <line x1="${PAD}" y1="${H - 22}" x2="${W - PAD}" y2="${H - 22}" stroke="#333" stroke-width="1"/>
      <line x1="${x(MU)}" y1="${y(peak)}" x2="${x(MU)}" y2="${H - 22}" stroke="#114B5F" stroke-width="1.5"/>
      <text x="${x(MU)}" y="${H - 8}" text-anchor="middle" class="sc-axis-label"
            style="font-size:10px;fill:#114B5F;font-weight:700">μ = ${MU}</text>
      <line x1="${x(MU - SIGMA)}" y1="${H - 30}" x2="${x(MU + SIGMA)}" y2="${H - 30}"
            stroke="#595959" stroke-width="1"/>
      <text x="${x(MU + SIGMA) + 5}" y="${H - 27}" style="font-size:9.5px;fill:#595959">σ = ${SIGMA}</text>
    </svg>`;
}

// ─── Step 2: this sample, scored twice ───

function renderSample() {
  if (!sampleWrap || !scoreWrap) return;
  if (!lastSample) {
    sampleWrap.innerHTML = '';
    scoreWrap.innerHTML = '<p class="sc-hint">Draw a sample to see it scored</p>';
    return;
  }
  const { values, xbar, s, z, t } = lastSample;
  const W = 420, H = 62, PAD = 10;
  const lo = MU - 3.6 * SIGMA, hi = MU + 3.6 * SIGMA;
  const x = (/** @type {number} */ v) => PAD + ((v - lo) / (hi - lo)) * (W - 2 * PAD);

  // Same x-scale as Step 1 on purpose: the sample has to be visibly a handful
  // of draws from that population, not its own picture on its own axis.
  const dots = values.map((v) => `<circle cx="${x(v).toFixed(1)}" cy="30" r="2.6"
      fill="#111" stroke="#fff" stroke-width="0.8"/>`).join('');

  sampleWrap.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img"
         aria-label="A sample of ${n} values. Mean ${fmt(xbar, 1)}, standard deviation ${fmt(s, 1)}.">
      <line x1="${PAD}" y1="46" x2="${W - PAD}" y2="46" stroke="#333" stroke-width="1"/>
      <line x1="${x(MU)}" y1="12" x2="${x(MU)}" y2="46" stroke="#595959" stroke-width="1" stroke-dasharray="3 2"/>
      ${dots}
      <line x1="${x(xbar)}" y1="10" x2="${x(xbar)}" y2="46" stroke="#C2410C" stroke-width="2"/>
      <text x="${x(xbar)}" y="8" text-anchor="middle" style="font-size:9.5px;fill:#C2410C;font-weight:700">x̄ = ${fmt(xbar, 1)}</text>
    </svg>`;

  const gap = xbar - MU;
  const seKnown = SIGMA / Math.sqrt(n);
  const seEst = s / Math.sqrt(n);
  // The numerator is written identically in both rows, and only the
  // denominator is marked, because "only this changed" is the entire argument.
  const row = (/** @type {string} */ key, /** @type {string} */ name,
    /** @type {string} */ den, /** @type {number} */ denVal, /** @type {number} */ val) => `
    <div class="sc-row ${scoring === key ? 'is-on' : ''}" data-row="${key}">
      <span class="sc-name">${name}</span>
      <span class="sc-expr">(${fmt(xbar, 1)} − ${MU}) ÷ <span class="sc-den">${den} = ${fmt(denVal, 2)}</span></span>
      <span class="sc-val">${fmt(val)}</span>
    </div>`;
  scoreWrap.innerHTML =
    row('z', 'z', `σ/√n`, seKnown, z)
    + row('t', 't', `s/√n`, seEst, t)
    + `<p class="sc-hint">Same gap of ${fmt(gap, 1)} on top. Only the bottom moved.</p>`;
}

// ─── Step 3: the distribution ───

function renderDistribution() {
  if (!chartWrap) return;
  const values = current();
  if (distTitle) {
    distTitle.textContent = scoring === 'z'
      ? 'Standardized by the true SE' : 'Standardized by s';
  }
  const result = renderSimChart(chartWrap, values, {
    chartType: 'histogram',
    id: 'sc-chart',
    xLabel: scoring === 'z' ? '(x̄ − μ) ÷ (σ/√n)' : '(x̄ − μ) ÷ (s/√n)',
    titleText: '',
    domain: DOMAIN,
    thresholds: THRESHOLDS,
    precision: 2,
  });
  if (!values.length) return;

  // The SAME reference curve under both scorings. It is what the z pile should
  // match and what the t pile should overflow; drawing t(df) here instead would
  // make both piles fit their own curve and the comparison would vanish.
  const xScale = result?.xScale;
  const yScale = result?.yScale;
  if (xScale && yScale) {
    overlayTheoryCurve({
      container: chartWrap,
      pdf: (v) => normalPdf(v, 0, 1),
      xDomain: DOMAIN,
      totalN: values.length,
      // Ours, not the chart's: we set the thresholds, so we know the width the
      // curve has to be scaled by.
      binWidth: BIN_WIDTH,
      xScale,
      yScale,
      label: 'N(0, 1)',
    });
  }
}

// ─── The tally ───

function renderReadout() {
  if (!readout) return;
  const values = current();
  if (!values.length) {
    readout.innerHTML = '<p class="sc-note">Draw some samples to build the distribution.</p>';
    return;
  }
  const beyond = values.filter((v) => Math.abs(v) >= Z_CUT).length;
  const pct = (100 * beyond) / values.length;
  // Values past the end of a fixed axis are DROPPED by the histogram, and
  // silently dropping the most extreme draws from a figure about tails is the
  // wrong kind of tidy. At n = 10 it is a handful in 5,000; at n = 3 the t
  // statistic puts about 4% outside ±5. Counting them keeps the picture honest
  // and makes its own point — the z pile never has any.
  const offAxis = values.filter((v) => Math.abs(v) > DOMAIN[1]).length;
  // What the right curve says it SHOULD be, so the reader is comparing their
  // tally with a target rather than staring at a bare percentage.
  const expected = scoring === 'z' ? 5 : 100 * 2 * (1 - tCDF(Z_CUT, n - 1));
  readout.innerHTML = `
    <p>Beyond ±${Z_CUT}: <span class="sc-big">${beyond}</span> of ${values.length}
       = <span class="sc-big">${fmt(pct, 1)}%</span>
       <span class="sc-note">(this curve says ${fmt(expected, 1)}%)</span></p>
    ${offAxis ? `<p class="sc-note">${offAxis} of them landed past the edge of the
       axis and are not drawn — they are counted above.</p>` : ''}
    <p class="sc-note">${scoring === 'z'
      ? 'Dividing by the true SE, ±1.96 really does cut off 5%.'
      : `With s in the denominator and ${n - 1} degrees of freedom, ±1.96 cuts off more than 5% — which is why t* for n = ${n} is bigger than 1.96.`}</p>`;
}

function render() {
  renderSample();
  renderDistribution();
  renderReadout();
  for (const b of document.querySelectorAll('#score-toggle button')) {
    b.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (b).dataset.score === scoring));
  }
}

// ─── Wiring ───

for (const b of genBtns) {
  b.addEventListener('click', () => draw(Number(b.dataset.count) || 1));
}
el('reset-btn')?.addEventListener('click', () => {
  reset();
  announce('Starting over.');
});

nSlider?.addEventListener('input', () => {
  n = Number(nSlider.value);
  if (nValue) nValue.textContent = String(n);
  // Each n has its own curve — df changes, and so does how much s wobbles — so
  // a tally collected at another n is not part of this one.
  reset();
});

scoreToggle?.addEventListener('click', (e) => {
  const btn = /** @type {HTMLElement} */ (e.target).closest('button');
  const next = btn?.dataset.score;
  if (!next || next === scoring) return;
  scoring = next;
  // No re-sampling. The samples are the samples; only the scoring changed.
  render();
  announce(scoring === 'z'
    ? 'Scoring by the true standard error.'
    : 'Scoring by the standard error estimated from each sample.');
});

initHelp();
initSettings();
renderPopulation();

import('jstat').then((jstat) => {
  setJStat(/** @type {any} */ (jstat).default || jstat);
  const urlN = Number(params.get('n'));
  if (Number.isFinite(urlN) && urlN >= 3 && urlN <= 50) {
    n = Math.round(urlN);
    if (nSlider) nSlider.value = String(n);
    if (nValue) nValue.textContent = String(n);
  }
  const urlScore = params.get('score');
  if (urlScore === 'z' || urlScore === 't') scoring = urlScore;
  reset();
});
