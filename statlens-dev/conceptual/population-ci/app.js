// @ts-check
/**
 * Confidence Intervals by Repeated Sampling — coverage, drawn on the sampling
 * distribution.
 *
 * Rebuilt 2026-10-07 on the Sampling Distribution Lab's parts, after Jeff:
 * "it looks like the panels were grown from scratch rather than reusing
 * previous elements. the +1, +10, buttons etc are not in the usual place." Both
 * true. The three-tier layout, the panels, the generate bar and the stats rows
 * are now the lab's own (lifted into `css/style.css`), so the two pages are the
 * same shape because they are built from the same thing rather than because
 * someone kept them matching.
 *
 * ── What it shows ────────────────────────────────────────────────────────
 *
 * Every sample gets the interval a student would actually compute,
 * x̄ ± t*·s/√n, so the widths VARY from dot to dot and the coverage lands near
 * the advertised level rather than exactly on it. Each dot is coloured by
 * whether its own interval caught μ; hovering one shows that sample and its
 * interval. The misses are mostly — not exactly — the dots far from μ, and
 * "mostly" is the honest word, because s is estimated too.
 *
 * ── The hard part, and the answer ────────────────────────────────────────
 *
 * Jeff: "I'm not sure how to get across the idea that IRL they get one sample
 * mean." The control that does it already existed in the lab: **hide μ**.
 * With μ hidden the dots CANNOT be coloured and the count CANNOT be computed —
 * not as a teaching choice but as a fact, because nothing on the page knows
 * which intervals worked. That is exactly the student's situation: one
 * interval, no μ, no way to check. Pressing Reveal makes the colours snap on,
 * and the sentence that lands is "yours was one of these all along; you just
 * could not see which."
 */

import * as d3Selection from 'd3-selection';

import { createRng, rngFromState } from '../../js/prng.js';
import { createResampleStore } from '../../js/resample-store.js';
import { attachResamplePeek, createPeekElement } from '../../js/resample-peek.js';
import { generateQuantPopulation, POPULATION_SHAPES } from '../../js/populations.js';
import { mean, sd } from '../../js/stats.js';
import { setJStat, tInv } from '../../js/distributions.js';
import { drawHistogram } from '../../js/histogram.js';
import { drawDotplot } from '../../js/dotplot.js';
import { announce, initHelp, initSettings } from '../../js/page-utils.js';

// ─── Constants ───

const POP_SIZE = 10000;
const MU_COLOR = '#D55E00';     // Okabe–Ito vermillion — the parameter
const CAPTURE = '#0072B2';      // this interval caught μ
const MISS = '#D55E00';         // it did not
const UNKNOWN = '#9AA5AB';      // μ is hidden, so nobody can say

/**
 * Every dot stays hoverable and individually coloured, which is the whole
 * point — so the page stops where dots stop being legible rather than falling
 * back to columns nobody can point at. Coverage has settled well before then.
 */
const MAX_SAMPLES = 400;

// ─── State ───

const params = new URLSearchParams(location.search);
const seed = params.get('seed') || 'pci';
let shape = POPULATION_SHAPES.some((s) => s.id === params.get('shape'))
  ? /** @type {string} */ (params.get('shape')) : 'right-skewed';
let n = clampN(Number(params.get('n')) || 25);
let level = [90, 95, 99].includes(Number(params.get('level'))) ? Number(params.get('level')) : 95;
let truthHidden = params.get('parameter') === 'hidden';

/** @type {number[]} */ let population = [];
let mu = 0, sigma = 0;
/** @type {() => number} */ let rng = createRng(seed);

/** One entry per sample: its mean and its own s, which is all an interval needs. */
/** @type {number[]} */ let means = [];
/** @type {number[]} */ let sds = [];
/** @type {number[]} */ let lastSample = [];

const samples = createResampleStore();
/** @type {any} */ let peekGeom = null;
/** @type {HTMLElement|null} */ let peekEl = null;
let peekedIndex = -1;
/** Which sample the panel is unpacking: the hovered one, else the newest. */
let shownIndex = -1;

let jstatReady = false;

/** @param {number} v */
function clampN(v) { return Math.max(2, Math.min(200, Math.round(v))); }

// ─── Elements ───

const el = (/** @type {string} */ id) => document.getElementById(id);
const popBox = el('pop-container'), sampleBox = el('sample-container'), distBox = el('dist-container');
const popStats = el('pop-stats'), sampleStats = el('sample-stats'), distStats = el('dist-stats');
const coverageEl = el('coverage'), verdictEl = el('ci-verdict');
const shapeToggle = el('shape-toggle'), levelToggle = el('level-toggle');
const truthBtn = el('truth-btn');
const nInput = /** @type {HTMLInputElement|null} */ (el('n-input'));
const revealBtn = el('reveal-btn'), revealAnswer = el('reveal-answer');

// ─── The population and the draws ───

function buildPopulation() {
  population = generateQuantPopulation(shape, createRng(`${seed}:pop:${shape}`), POP_SIZE);
  mu = mean(population);
  sigma = sd(population);
}

/** @param {() => number} r @returns {number[]} */
function drawValues(r) {
  const s = new Array(n);
  for (let i = 0; i < n; i++) s[i] = population[Math.floor(r() * population.length)];
  return s;
}

/** The interval a student would compute from sample `i`, or null before jStat. */
function intervalOf(/** @type {number} */ i) {
  if (!jstatReady || i < 0 || i >= means.length) return null;
  const tStar = tInv(1 - (1 - level / 100) / 2, n - 1);
  const m = tStar * sds[i] / Math.sqrt(n);
  return { lo: means[i] - m, hi: means[i] + m, margin: m };
}

/** Whether sample `i`'s interval caught μ. */
function capturesOf(/** @type {number} */ i) {
  const ci = intervalOf(i);
  return ci ? ci.lo <= mu && mu <= ci.hi : false;
}

function coverageCount() {
  let hits = 0;
  for (let i = 0; i < means.length; i++) if (capturesOf(i)) hits++;
  return hits;
}

// ─── Drawing ───

/** Chart options for the μ marker — omitted entirely while it is hidden. */
const truthMarker = () => (truthHidden
  ? {}
  : { observedStat: mu, observedLabel: 'μ' });

function drawPopulation() {
  if (!popBox) return;
  popBox.innerHTML = '';
  drawHistogram(popBox, population, {
    id: 'pci-pop',
    xLabel: 'Value',
    titleText: 'The population',
    descText: `A ${shape.replace('-', ' ')} population of ${POP_SIZE.toLocaleString()} values.`,
    ...truthMarker(),
    animate: false,
    numBins: 36,
    precision: 2,
    viewHeight: 190,
  });
  if (popStats) {
    popStats.innerHTML =
        `<span class="stat-item"><span class="stat-label">N:</span> <span class="stat-value">${POP_SIZE.toLocaleString()}</span></span>`
      + (truthHidden
        ? '<span class="stat-item pci-unknown">μ and σ hidden</span>'
        : `<span class="stat-item"><span class="stat-label">μ:</span> <span class="stat-value">${mu.toFixed(2)}</span></span>`
          + `<span class="stat-item"><span class="stat-label">σ:</span> <span class="stat-value">${sigma.toFixed(2)}</span></span>`);
  }
}

/**
 * The "One sample" tier: the sample itself, its interval drawn beneath, and the
 * verdict. This is where a hovered dot is unpacked — so a reader moving along
 * the distribution watches one interval after another succeed or fail.
 */
function drawSamplePanel() {
  if (!sampleBox) return;
  sampleBox.innerHTML = '';
  if (!lastSample.length) {
    sampleBox.innerHTML = '<p class="pci-placeholder">Press <strong>+1</strong> to draw a sample.</p>';
    if (sampleStats) sampleStats.innerHTML = '';
    if (verdictEl) verdictEl.innerHTML = '';
    return;
  }
  const m = mean(lastSample);
  const ci = intervalOf(shownIndex);

  // One axis for the sample and its interval, and it has to hold μ as well —
  // an interval that misses is the case worth seeing, and it only reads as a
  // miss if the thing it missed is on the picture.
  const lo = Math.min(...lastSample, ci ? ci.lo : Infinity, truthHidden ? Infinity : mu);
  const hi = Math.max(...lastSample, ci ? ci.hi : -Infinity, truthHidden ? -Infinity : mu);
  const pad = (hi - lo) * 0.06 || 1;

  const result = drawDotplot(sampleBox, lastSample, {
    id: 'pci-sample',
    xLabel: 'Value',
    titleText: 'The most recent sample',
    descText: `${n} values with mean ${m.toFixed(2)}.`,
    ...truthMarker(),
    animate: false,
    precision: 2,
    viewHeight: 170,
    domain: /** @type {[number, number]} */ ([lo - pad, hi + pad]),
    margin: { top: 18, right: 20, bottom: 74, left: 44 },
  });
  if (ci) drawIntervalUnderAxis(result, ci);

  if (sampleStats) {
    sampleStats.innerHTML =
        `<span class="stat-item"><span class="stat-label">n:</span> <span class="stat-value">${n}</span></span>`
      + `<span class="stat-item"><span class="stat-label">x̄:</span> <span class="stat-value">${m.toFixed(2)}</span></span>`
      + `<span class="stat-item"><span class="stat-label">s:</span> <span class="stat-value">${sd(lastSample).toFixed(2)}</span></span>`
      + (ci ? `<span class="stat-item"><span class="stat-label">${level}% CI:</span> `
        + `<span class="stat-value">(${ci.lo.toFixed(2)}, ${ci.hi.toFixed(2)})</span></span>` : '');
  }
  drawVerdict(ci);
}

/**
 * The interval as a bar under the sample's axis.
 * @param {{frame: any, xScale: any}} result
 * @param {{lo: number, hi: number}} ci
 */
function drawIntervalUnderAxis(result, ci) {
  const { frame, xScale } = result;
  // addAxes puts the axis title at height + margin.bottom - 8, so the bar goes
  // above it rather than at a guessed offset.
  const barY = frame.height + 34;
  if (barY >= frame.height + frame.margin.bottom - 14) return;
  const colour = truthHidden ? UNKNOWN : (ci.lo <= mu && mu <= ci.hi ? CAPTURE : MISS);
  const g = d3Selection.select(frame.inner).select('.annotations');
  g.append('line')
    .attr('class', 'pci-ci-bar')
    .attr('x1', xScale(ci.lo)).attr('x2', xScale(ci.hi)).attr('y1', barY).attr('y2', barY)
    .attr('stroke', colour).attr('stroke-width', 6).attr('stroke-linecap', 'round');
  for (const v of [ci.lo, ci.hi]) {
    g.append('line')
      .attr('x1', xScale(v)).attr('x2', xScale(v)).attr('y1', barY - 7).attr('y2', barY + 7)
      .attr('stroke', colour).attr('stroke-width', 2.5);
  }
}

/** @param {{lo:number,hi:number}|null} ci */
function drawVerdict(ci) {
  if (!verdictEl) return;
  if (!ci) { verdictEl.innerHTML = ''; return; }
  if (truthHidden) {
    verdictEl.innerHTML = '<div class="pci-verdict is-unknown">'
      + '<span class="pci-glyph" aria-hidden="true">?</span>'
      + `<span>This interval runs <strong>${ci.lo.toFixed(2)} to ${ci.hi.toFixed(2)}</strong>. `
      + 'Did it catch μ? <strong>Nothing on this page can tell you</strong> — and neither '
      + 'could you, with real data.</span></div>';
    return;
  }
  const ok = ci.lo <= mu && mu <= ci.hi;
  verdictEl.innerHTML = `<div class="pci-verdict ${ok ? 'is-yes' : 'is-no'}">`
    + `<span class="pci-glyph" aria-hidden="true">${ok ? '✓' : '✗'}</span>`
    + `<span><strong>${ci.lo.toFixed(2)} to ${ci.hi.toFixed(2)}</strong> `
    + `${ok ? 'contains' : '<strong>misses</strong>'} μ = ${mu.toFixed(2)}.</span></div>`;
}

function drawDistribution() {
  if (!distBox) return;
  distBox.innerHTML = '';
  if (!means.length) {
    distBox.innerHTML = '<p class="pci-placeholder">No samples yet.</p>';
    if (distStats) distStats.innerHTML = '';
    if (coverageEl) coverageEl.innerHTML = '';
    return;
  }
  const result = drawDotplot(distBox, means, {
    id: 'pci-dist',
    xLabel: 'Sample mean (x̄)',
    titleText: 'Sampling distribution of the sample mean',
    descText: truthHidden
      ? `${means.length} sample means. μ is hidden, so no interval can be checked.`
      : `${means.length} sample means; ${coverageCount()} of their intervals contain μ.`,
    ...truthMarker(),
    animate: false,
    precision: 2,
    viewHeight: 300,
  });
  colourByCapture();
  wirePeek(result);

  if (distStats) {
    distStats.innerHTML =
        `<span class="stat-item"><span class="stat-label">Samples:</span> <span class="stat-value">${means.length}</span></span>`
      + `<span class="stat-item"><span class="stat-label">SD of the x̄'s:</span> <span class="stat-value">${means.length > 1 ? sd(means).toFixed(3) : '—'}</span></span>`
      + (truthHidden ? ''
        : `<span class="stat-item"><span class="stat-label">σ/√n:</span> <span class="stat-value">${(sigma / Math.sqrt(n)).toFixed(3)}</span></span>`);
  }
  drawCoverage();
}

/**
 * Colour each dot by whether its own interval caught μ.
 *
 * Done after the draw, through the `data-stat-index` mark each dot carries,
 * because capture is NOT a function of the dot's value: two samples with the
 * same mean and different s get different intervals, and one can catch μ while
 * the other misses. The renderer's own colouring takes a value predicate, which
 * cannot express that.
 */
function colourByCapture() {
  const dots = distBox?.querySelectorAll('[data-stat-index]');
  if (!dots?.length) return;
  for (const dot of dots) {
    const i = Number(dot.getAttribute('data-stat-index'));
    const colour = truthHidden ? UNKNOWN : (capturesOf(i) ? CAPTURE : MISS);
    dot.setAttribute('fill', colour);
    dot.setAttribute('stroke', colour);
  }
}

function drawCoverage() {
  if (!coverageEl) return;
  if (!means.length) { coverageEl.innerHTML = ''; return; }
  if (truthHidden) {
    coverageEl.innerHTML = '<span class="pci-unknown">μ is hidden, so no dot can be coloured '
      + 'and nothing can be counted — which is the position you are in with real data.</span>';
    return;
  }
  const hits = coverageCount();
  const pct = (100 * hits / means.length).toFixed(1);
  coverageEl.innerHTML = `<span class="pci-big">${hits}</span> of `
    + `<span class="pci-big">${means.length}</span> intervals contain μ `
    + `(<span class="pci-big">${pct}%</span>), against the <strong>${level}%</strong> asked for.`;
}

function redraw() {
  drawPopulation();
  drawSamplePanel();
  drawDistribution();
}

// ─── Hover ───

/** @param {{frame: any, xScale: any, yScale?: any, countToY?: any, bins?: any[]}} result */
function wirePeek(result) {
  if (!distBox) return;
  if (!peekEl) peekEl = createPeekElement(distBox);
  peekGeom = { xScale: result.xScale, yScale: result.yScale ?? result.countToY,
               frame: result.frame, bins: result.bins ?? null };
  attachResamplePeek({
    container: distBox,
    peek: /** @type {HTMLElement} */ (peekEl),
    geom: peekGeom,
    stats: () => means,
    onLeave: () => {
      if (peekedIndex === -1) return;
      peekedIndex = -1;
      shownIndex = means.length - 1;
      const rec = samples.get(shownIndex);
      if (rec?.st) lastSample = replaySample(rec.st);
      drawSamplePanel();
    },
    describe: (i, approx) => {
      const rec = samples.get(i);
      if (!rec?.st) return null;
      if (i !== peekedIndex) {
        peekedIndex = i;
        shownIndex = i;
        lastSample = replaySample(rec.st);
        drawSamplePanel();
      }
      const ci = intervalOf(i);
      return {
        title: `Sample ${i + 1}${approx ? ' (one of several here)' : ''}`,
        detail: ci
          ? `x̄ = ${means[i].toFixed(2)}, interval ${ci.lo.toFixed(2)} to ${ci.hi.toFixed(2)}`
            + (truthHidden ? '' : ` — ${capturesOf(i) ? 'contains' : 'misses'} μ`)
          : `x̄ = ${means[i].toFixed(2)}`,
      };
    },
  });
}

/** @param {ReadonlyArray<number>} state */
function replaySample(state) { return drawValues(rngFromState(state)); }

// ─── Running ───

/** @param {number} count */
function addSamples(count) {
  if (means.length >= MAX_SAMPLES) {
    announce(`Stopped at ${MAX_SAMPLES} samples — every dot stays hoverable.`);
    return;
  }
  const take = Math.min(count, MAX_SAMPLES - means.length);
  for (let i = 0; i < take; i++) {
    const st = /** @type {any} */ (rng).getState();
    samples.rememberState(means.length, st);
    const values = drawValues(rng);
    lastSample = values;
    means.push(mean(values));
    sds.push(sd(values));
  }
  peekedIndex = -1;
  shownIndex = means.length - 1;
  redraw();
  announce(`${take} more sample${take === 1 ? '' : 's'}; ${means.length} in all.`
    + (truthHidden ? '' : ` ${coverageCount()} of their intervals contain μ.`));
}

function reset(message = 'Started over.') {
  means = []; sds = []; lastSample = [];
  samples.clear(); peekedIndex = -1; shownIndex = -1;
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
    reset(`${shape.replace('-', ' ')} population.`);
  });
}

levelToggle?.addEventListener('click', (ev) => {
  const btn = /** @type {HTMLElement} */ (ev.target).closest('button[data-level]');
  if (!btn) return;
  level = Number(/** @type {HTMLElement} */ (btn).dataset.level);
  for (const b of levelToggle.querySelectorAll('button[data-level]')) {
    b.setAttribute('aria-pressed', String(Number(/** @type {HTMLElement} */ (b).dataset.level) === level));
  }
  // The samples stand: only the intervals change. That is the control's whole
  // point — more confidence is wider intervals and more hits, from one run.
  redraw();
  announce(truthHidden ? `${level} percent level.`
    : `${level} percent level. ${coverageCount()} of ${means.length} now contain μ.`);
});

truthBtn?.addEventListener('click', () => {
  truthHidden = !truthHidden;
  truthBtn.textContent = truthHidden ? 'Reveal μ' : 'Hide μ';
  truthBtn.setAttribute('aria-pressed', String(truthHidden));
  redraw();
  announce(truthHidden
    ? 'μ hidden. The dots lose their colours, because nothing can tell which intervals worked.'
    : `μ revealed. ${coverageCount()} of ${means.length} intervals contain it.`);
});

nInput?.addEventListener('change', () => {
  const v = clampN(Number(nInput.value));
  nInput.value = String(v);
  if (v === n) return;
  n = v;
  reset(`Sample size ${n}. Cleared, because the sampling distribution depends on n.`);
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
  if (open && !revealAnswer.innerHTML) {
    revealAnswer.innerHTML =
      '<p>It is the success rate of the <em>recipe</em>, not a probability about your interval. '
      + 'Reveal μ and about 95 of every 100 dots turn blue — yours was one colour or the '
      + 'other all along, and hiding μ did not change which. What you lose without μ is '
      + 'only the ability to <em>see</em> it, which is why the claim has to be about the method.</p>';
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
initSettings();

if (nInput) nInput.value = String(n);
for (const b of levelToggle?.querySelectorAll('button[data-level]') ?? []) {
  b.setAttribute('aria-pressed', String(Number(/** @type {HTMLElement} */ (b).dataset.level) === level));
}
if (truthBtn && truthHidden) {
  truthBtn.textContent = 'Reveal μ';
  truthBtn.setAttribute('aria-pressed', 'true');
}
buildPopulation();
rng = createRng(`${seed}:${shape}:${n}`);
redraw();

// The intervals need a t critical value, so the opening draw waits for jStat.
import('jstat').then((jstat) => {
  setJStat(/** @type {any} */ (jstat).default || jstat);
  jstatReady = true;
  const preset = Number(params.get('samples'));
  if (Number.isFinite(preset) && preset > 0) addSamples(Math.min(preset, MAX_SAMPLES));
  else redraw();
});
