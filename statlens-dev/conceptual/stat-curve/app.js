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
import { prefersReducedMotion } from '../../js/settings.js';

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

const popWrap = el('sc-pop');
const sampleWrap = el('sc-sample');
const scoreWrap = el('sc-score');
const chartZ = el('chart-z');
const chartT = el('chart-t');
const tallyZ = el('tally-z');
const tallyT = el('tally-t');
const readout = el('readout');
const genBtns = /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll('.gen-btn')]);

const params = new URLSearchParams(location.search);
const seed = params.get('seed') || 'curve';

let n = 10;
/**
 * Below this many samples the plots are drawn as individual dots, which is what
 * makes a sample pointable — the linked highlight needs something to point at.
 * Past it there are too many to tell apart and the shape is the subject, so
 * they become histograms and the pairing readout steps aside.
 */
const DOT_MAX = 200;
/** Which sample is being pointed at, if any. */
/** @type {number|null} */ let linked = null;
/** @type {{ z: number, t: number }[]} Both scorings of every sample drawn. */
let stats = [];
/** @type {{ values: number[], xbar: number, s: number, z: number, t: number }|null} */
let lastSample = null;
/** @type {() => number} */
let rng = createRng(`${seed}-${n}`);


const fmt = (/** @type {number} */ v, /** @type {number} */ d = 2) => v.toFixed(d);

// ─── Drawing ───

/**
 * One sample, scored both ways.
 *
 * ⚠ Both scorings come from ONE draw. The two plots are two readings of the
 * same list, never two simulations: the claim is that the numerator is
 * identical and only the denominator moved.
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
  render(stats.length - 1);
  // One sample, two destinations — the clearest statement the page can make
  // that these are two readings of one draw rather than two simulations.
  if (k === 1) flyBothWays();
  announce(`${k} sample${k === 1 ? '' : 's'} drawn. ${stats.length} in each distribution.`);
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
    <div class="sc-row" data-row="${key}">
      <span class="sc-name">${name}</span>
      <span class="sc-expr">(${fmt(xbar, 1)} − ${MU}) ÷ <span class="sc-den">${den} = ${fmt(denVal, 2)}</span></span>
      <span class="sc-val">${fmt(val)}</span>
    </div>`;
  scoreWrap.innerHTML =
    row('z', 'z', `σ/√n`, seKnown, z)
    + row('t', 't', `s/√n`, seEst, t)
    + `<p class="sc-hint">Same gap of ${fmt(gap, 1)} on top. Only the bottom moved.</p>`;
}

// ─── Step 3: both scorings, one axis ───

/**
 * Two plots, stacked, sharing a domain and a bin grid.
 *
 * Jeff, 2026-10-31: "would it be more effective if the two sampling
 * distributions, z and t, were stacked vertically in the same panel and if we
 * hovered over a dot in one the dot in both would be highlighted."
 *
 * It is, and the hover is why. A toggle made the reader hold one shape in
 * memory while looking at the other; stacked on one axis, the comparison is
 * there to be pointed at. And pointing is what turns "the same samples, scored
 * two ways" from a claim into something visible: one dot lights up in each
 * plot, at two different places, and the readout says what the sample's s was.
 *
 * @param {number} [newest] - index to mark as the latest arrival
 */
function renderDistributions(newest = -1) {
  if (!chartZ || !chartT) return;
  const zs = stats.map((p) => p.z);
  const ts = stats.map((p) => p.t);
  // Dots while a sample is still an individual thing; past that the shape is
  // the subject and dots would be a smear.
  const chartType = stats.length <= DOT_MAX ? 'dotplot' : 'histogram';

  const one = (/** @type {HTMLElement} */ host, /** @type {number[]} */ values,
    /** @type {string} */ id, /** @type {string} */ xLabel) => {
    // ⚠ Values outside the fixed axis are removed BEFORE the chart sees them.
    //
    // A d3 scale does not clamp, so a statistic past the domain is mapped past
    // the plot and drawn outside the SVG — on a dotplot it really was painted
    // ~90px beyond the chart's own right edge, unhittable and unexplained,
    // which is how this was found. The tally already says these exist and how
    // many; the picture must not half-show them.
    const shown = values.map((v, i) => /** @type {[number, number]} */ ([v, i]))
      .filter(([v]) => Math.abs(v) <= DOMAIN[1]);
    const result = renderSimChart(host, shown.map(([v]) => v), {
      chartType, id, xLabel,
      titleText: '',
      domain: DOMAIN,
      thresholds: THRESHOLDS,
      binWidth: BIN_WIDTH,
      binOrigin: DOMAIN[0],
      // Positional within `shown`, not the sample's index — they differ once
      // anything has been filtered out.
      highlightIndex: newest < 0 ? -1 : shown.findIndex(([, i]) => i === newest),
      precision: 2,
    });
    // `computeDots` maps without sorting, so circle k is shown[k] — relabel
    // each with the SAMPLE's index, which is what the two plots are linked by.
    // Without this, filtering would silently renumber them and the pairing
    // would point at the wrong sample.
    for (const c of host.querySelectorAll('circle[data-stat-index]')) {
      const k = Number(c.getAttribute('data-stat-index'));
      if (shown[k]) c.setAttribute('data-stat-index', String(shown[k][1]));
    }
    if (!values.length || !result) return;
    // The SAME reference curve over both. It is what the z pile should match
    // and what the t pile should overflow; drawing t(df) over the lower one
    // would make both piles fit their own curve and the comparison would
    // vanish — which is the only thing this page is for.
    const yScale = chartType === 'histogram' ? result.yScale : result.countToY;
    if (result.xScale && yScale) {
      overlayTheoryCurve({
        container: host,
        pdf: (v) => normalPdf(v, 0, 1),
        xDomain: DOMAIN,
        totalN: values.length,
        // Ours, not the chart's: we set the thresholds, so we know the width
        // the curve has to be scaled by.
        binWidth: result.binWidth ?? BIN_WIDTH,
        xScale: result.xScale,
        yScale,
        label: 'N(0, 1)',
      });
    }
  };

  one(chartZ, zs, 'sc-chart-z', '(x̄ − μ) ÷ (σ/√n)');
  one(chartT, ts, 'sc-chart-t', '(x̄ − μ) ÷ (s/√n)');
  if (chartType === 'dotplot') wireLinkedHover();
  showLinked(linked);
}

/**
 * The sample leaves Step 2 twice, for two different places.
 *
 * Jeff, 2026-10-31: "maybe an animation for the sampling?" This is the one
 * worth animating. Each flyer starts on its own row in Step 2 — the z row, the
 * t row — and lands on that sample's dot in the matching plot. They set off
 * together from the same sample and arrive at different x, which is the whole
 * argument in one gesture.
 *
 * Skipped under reduced motion, where the dots are simply there already.
 */
function flyBothWays() {
  if (prefersReducedMotion()) return;
  const i = stats.length - 1;
  const pairs = [
    [document.querySelector('[data-row="z"]'), chartZ],
    [document.querySelector('[data-row="t"]'), chartT],
  ];
  for (const [from, host] of pairs) {
    const target = host?.querySelector(`circle[data-stat-index="${i}"]`);
    if (!from || !target) continue;
    const a = from.getBoundingClientRect();
    const b = target.getBoundingClientRect();
    if (!a.width || !b.width) continue;

    const dot = document.createElement('span');
    dot.className = 'sc-flyer';
    dot.style.left = `${a.right - 18}px`;
    dot.style.top = `${a.top + a.height / 2}px`;
    document.body.appendChild(dot);

    const dx = (b.left + b.width / 2) - (a.right - 18);
    const dy = (b.top + b.height / 2) - (a.top + a.height / 2);
    dot.animate([
      { transform: 'translate(0,0) scale(0.5)', opacity: 0 },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 22}px) scale(1)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) scale(1)`, opacity: 1 },
    ], { duration: 560, easing: 'cubic-bezier(.4,0,.3,1)' }).onfinish = () => {
      dot.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200 }).onfinish = () => dot.remove();
    };
  }
}

// ─── The same sample, in both plots ───

/** Every circle that stands for sample `i`, in either plot. */
const dotsFor = (/** @type {number} */ i) =>
  /** @type {SVGCircleElement[]} */ ([...document.querySelectorAll(
    `#chart-z circle[data-stat-index="${i}"], #chart-t circle[data-stat-index="${i}"]`)]);

function wireLinkedHover() {
  for (const host of [chartZ, chartT]) {
    for (const c of host?.querySelectorAll('circle[data-stat-index]') ?? []) {
      const i = Number(c.getAttribute('data-stat-index'));
      if (!stats[i]) continue;
      // `focusin` as well as `mouseenter`: the dotplot already gives every
      // circle a tabindex for its own tooltip, so the keyboard costs nothing.
      c.addEventListener('mouseenter', () => showLinked(i));
      c.addEventListener('focusin', () => showLinked(i));
      // Both scorings in the label, so the pairing survives without a pointer.
      c.setAttribute('aria-label',
        `sample ${i + 1}: z = ${fmt(stats[i].z)}, t = ${fmt(stats[i].t)}`);
    }
  }
  chartZ?.addEventListener('mouseleave', () => showLinked(null));
  chartT?.addEventListener('mouseleave', () => showLinked(null));
}

/** @param {number|null} i */
function showLinked(i) {
  for (const c of document.querySelectorAll('.sc-linked')) c.classList.remove('sc-linked');
  linked = i;
  const box = el('paired');
  if (!box) return;
  if (i == null || !stats[i]) {
    box.className = 'sc-paired is-empty';
    box.textContent = stats.length && stats.length <= DOT_MAX
      ? 'Point at a dot to see the same sample in both plots'
      : '';
    return;
  }
  const dots = dotsFor(i);
  for (const c of dots) c.classList.add('sc-linked');
  const { z, t } = stats[i];
  // s back out of the two scorings: t/z = σ/s, so s = σ·z/t. Derived rather
  // than stored because the pair IS the statement — a reader can check it.
  const sEst = t !== 0 ? Math.abs(SIGMA * z / t) : NaN;
  box.className = 'sc-paired';
  box.innerHTML = `Sample ${i + 1}: <strong>z = ${fmt(z)}</strong>, <strong>t = ${fmt(t)}</strong>`
    + ` — its s was ${fmt(sEst, 1)} against σ = ${SIGMA},`
    + ` so dividing by it moved the value ${Math.abs(t) > Math.abs(z) ? 'further out' : 'closer in'}.`;
}

// ─── The tallies ───

/**
 * @param {HTMLElement|null} host
 * @param {number[]} values
 * @param {number} expected - what the right curve says the tail should be
 */
function renderTally(host, values, expected) {
  if (!host) return;
  if (!values.length) { host.textContent = ''; return; }
  const beyond = values.filter((v) => Math.abs(v) >= Z_CUT).length;
  // Values past the end of a fixed axis are DROPPED by the plot, and silently
  // dropping the most extreme draws from a figure about tails is the wrong kind
  // of tidy. At n = 3 the t statistic puts about 4% outside ±5.
  const offAxis = values.filter((v) => Math.abs(v) > DOMAIN[1]).length;
  host.innerHTML = `beyond ±${Z_CUT}: <span class="sc-big">${beyond}</span> of ${values.length}`
    + ` = <span class="sc-big">${fmt((100 * beyond) / values.length, 1)}%</span>`
    + ` (this curve says ${fmt(expected, 1)}%)`
    + (offAxis ? ` — ${offAxis} past the edge, counted but not drawn` : '');
}

function renderReadout() {
  renderTally(tallyZ, stats.map((p) => p.z), 5);
  renderTally(tallyT, stats.map((p) => p.t), 100 * 2 * (1 - tCDF(Z_CUT, n - 1)));
  if (!readout) return;
  readout.innerHTML = stats.length
    ? `<p class="sc-note">With s in the denominator and ${n - 1} degrees of freedom,
       ±${Z_CUT} cuts off more than 5% — which is why t* for n = ${n} is bigger than 1.96.</p>`
    : '<p class="sc-note">Draw some samples to build the distributions.</p>';
}

/** @param {number} [newest] */
function render(newest = -1) {
  renderSample();
  renderDistributions(newest);
  renderReadout();
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
  reset();
});
