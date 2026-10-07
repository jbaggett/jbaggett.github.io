// @ts-check
/**
 * Law of Large Numbers — the running value settles, the running total does not.
 *
 * Requested 2026-10-07 (Jeff, relaying a colleague): "proportion of heads as the
 * number of tosses increases and the average of single die rolls. simple
 * controls." Long on the Phase 3 list as "flip coins, watch proportion
 * converge. Simple but effective."
 *
 * Two decisions worth stating, because both are about what the picture is
 * allowed to imply:
 *
 * **The running total is on the page.** The law says the PROPORTION converges.
 * It does not say the counts even out, and the everyday misreading — the
 * "law of averages", a coin being "due" — is exactly that. Heads minus tails
 * typically grows without bound while the proportion settles, so showing both
 * traces from the same trials is the cheapest honest refutation available: same
 * coin, same tosses, one line calming down and one wandering off. It is a
 * checkbox rather than the default because the default page should answer the
 * question that was asked.
 *
 * **The log option.** On a linear axis to 1000 the first twenty trials — where
 * the line thrashes and the law is doing its visible work — occupy two percent
 * of the width and cannot be seen at all. A log axis gives each decade equal
 * room. But a log axis is also a thing an intro student has to be taught, so it
 * is off by default and labelled in words ("Spread out the early trials")
 * rather than as "log scale".
 *
 * Seeded throughout (js/prng.js), so `?seed=` makes a lecture or a quiz item
 * reproduce exactly.
 */

import * as d3Scale from 'd3-scale';
import * as d3Axis from 'd3-axis';
import * as d3Shape from 'd3-shape';
import * as d3Selection from 'd3-selection';

import { createRng } from '../../js/prng.js';
import { createChart, addAxes, addMinorTicks } from '../../js/chart-utils.js';
import { announce, initHelp } from '../../js/page-utils.js';
import { prefersReducedMotion } from '../../js/settings.js';

// ─── Constants ───

const TRACE = '#0072B2';     // Okabe–Ito blue — the running value
const EXPECTED = '#D55E00';  // Okabe–Ito vermillion — what the model predicts
const TOTAL = '#7B2D8E';     // the observed-statistic purple, for the running total

/**
 * The experiments. Each says what one trial produces, what the model expects,
 * and how to say the running value in words.
 */
const EXPERIMENTS = {
  coin: {
    label: 'Coin tosses',
    trialWord: 'toss', trialsWord: 'tosses',
    /** @param {() => number} rng */
    draw: (rng) => (rng() < 0.5 ? 1 : 0),
    expected: 0.5,
    domain: /** @type {[number, number]} */ ([0, 1]),
    valueName: 'Proportion of heads',
    axisLabel: 'Proportion of heads',
    precision: 3,
    // The running total, in the units the student would count in.
    totalName: 'Heads − tails',
    /** @param {number} sum @param {number} n */
    total: (sum, n) => 2 * sum - n,
    countName: 'Heads so far',
    /** @param {number} sum @param {number} n */
    countText: (sum, n) => `${sum} of ${n}`,
  },
  die: {
    label: 'Die rolls',
    trialWord: 'roll', trialsWord: 'rolls',
    /** @param {() => number} rng */
    draw: (rng) => 1 + Math.floor(rng() * 6),
    expected: 3.5,
    domain: /** @type {[number, number]} */ ([1, 6]),
    valueName: 'Average roll',
    axisLabel: 'Average roll',
    precision: 3,
    totalName: 'Total − 3.5 per roll',
    /** @param {number} sum @param {number} n */
    total: (sum, n) => sum - 3.5 * n,
    countName: 'Total of the rolls',
    /** @param {number} sum @param {number} n */
    countText: (sum, n) => `${sum} in ${n} ${n === 1 ? 'roll' : 'rolls'}`,
  },
};

/** At most this many points are drawn; beyond it the trace is thinned. */
const MAX_POINTS = 1400;

/** Trials beyond this are refused — the page is a demonstration, not a stress test. */
const MAX_TRIALS = 200000;

// ─── State ───

const params = new URLSearchParams(location.search);
/** @type {'coin'|'die'} */
let experiment = params.get('exp') === 'die' ? 'die' : 'coin';
const seed = params.get('seed') || 'lln';

let rng = createRng(`${seed}:${experiment}`);
/** Running sum of the trial outcomes, and how many there have been. */
let sum = 0;
let n = 0;
/** The running value after each trial, so the trace can be redrawn at will. */
let running = /** @type {number[]} */ ([]);
/** The running total after each trial (the half that does not converge). */
let totals = /** @type {number[]} */ ([]);

let logScale = false;
let showTotal = false;

// ─── Elements ───

const figureEl = document.getElementById('lln-figure');
const totalFigureEl = document.getElementById('lln-total-figure');
const totalWrap = document.getElementById('lln-total-wrap');
const totalNote = document.getElementById('total-note');
const readoutEl = document.getElementById('readout');
const expToggle = document.getElementById('exp-toggle');
const logToggle = /** @type {HTMLInputElement|null} */ (document.getElementById('log-toggle'));
const totalToggle = /** @type {HTMLInputElement|null} */ (document.getElementById('total-toggle'));
const resetBtn = document.getElementById('reset-btn');
const revealBtn = document.getElementById('reveal-btn');
const revealAnswer = document.getElementById('reveal-answer');

const exp = () => EXPERIMENTS[experiment];

// ─── Drawing ───

/**
 * Thin a trace to at most MAX_POINTS, keeping the first and last.
 *
 * A path with 200,000 vertices is slower to lay out than the simulation is to
 * run, and at one point per pixel-column nothing is lost by dropping the rest.
 * The early trials are kept whole because that is the part being looked at.
 * @param {number[]} values
 * @returns {Array<[number, number]>} [trialNumber, value]
 */
function thin(values) {
  const total = values.length;
  if (total <= MAX_POINTS) return values.map((v, i) => [i + 1, v]);
  // The first 200 trials verbatim, the rest evenly sampled.
  const head = 200;
  /** @type {Array<[number, number]>} */
  const out = [];
  for (let i = 0; i < head; i++) out.push([i + 1, values[i]]);
  const step = (total - head) / (MAX_POINTS - head);
  for (let k = 0; k < MAX_POINTS - head; k++) {
    const i = Math.min(total - 1, head + Math.floor(k * step));
    out.push([i + 1, values[i]]);
  }
  if (out[out.length - 1][0] !== total) out.push([total, values[total - 1]]);
  return out;
}

/** The x scale, shared by both figures so they read as one experiment. */
function makeXScale(width) {
  // A log axis cannot start at 0, and trial 1 is the first thing there is.
  if (logScale) return d3Scale.scaleLog().domain([1, Math.max(10, n)]).range([0, width]);
  return d3Scale.scaleLinear().domain([0, Math.max(10, n)]).range([0, width]);
}

function drawMain() {
  if (!figureEl) return;
  figureEl.innerHTML = '';
  const e = exp();
  const frame = createChart(figureEl, {
    titleText: `${e.valueName} after each ${e.trialWord}`,
    descText: n === 0
      ? `No ${e.trialsWord} yet. The dashed line marks ${e.expected}.`
      : `After ${n} ${e.trialsWord} the ${e.valueName.toLowerCase()} is `
        + `${running[n - 1].toFixed(e.precision)}; the model expects ${e.expected}.`,
    id: 'lln-main',
  });

  const x = makeXScale(frame.width);
  const y = d3Scale.scaleLinear().domain(e.domain).range([frame.height, 0]);
  const xAxis = d3Axis.axisBottom(x);
  if (logScale) xAxis.ticks(6, '~s');
  addAxes(frame, xAxis, d3Axis.axisLeft(y), `Number of ${e.trialsWord}`, e.axisLabel);
  if (!logScale) {
    const axisG = d3Selection.select(frame.inner).select('.x-axis');
    if (!axisG.empty()) addMinorTicks(axisG, x);
  }

  const data = d3Selection.select(frame.inner).select('.data');

  // What the model expects — drawn first, so the trace reads as approaching it.
  data.append('line')
    .attr('class', 'lln-expected')
    .attr('x1', 0).attr('x2', frame.width)
    .attr('y1', y(e.expected)).attr('y2', y(e.expected))
    .attr('stroke', EXPECTED).attr('stroke-width', 2)
    .attr('stroke-dasharray', '7,4');
  data.append('text')
    .attr('x', frame.width - 4).attr('y', y(e.expected) - 7)
    .attr('text-anchor', 'end').attr('font-size', 12).attr('font-weight', 700)
    .attr('fill', EXPECTED)
    .text(`expected ${e.expected}`);

  if (n === 0) return frame;

  const line = d3Shape.line()
    .x((d) => x(d[0]))
    .y((d) => y(d[1]));
  const path = data.append('path')
    .attr('class', 'lln-trace')
    .attr('fill', 'none')
    .attr('stroke', TRACE)
    .attr('stroke-width', 2)
    .attr('stroke-linejoin', 'round')
    .attr('d', line(thin(running)) ?? '');

  // The newest value, marked — the one number the readout is quoting.
  data.append('circle')
    .attr('class', 'lln-head')
    .attr('cx', x(n)).attr('cy', y(running[n - 1])).attr('r', 4)
    .attr('fill', TRACE);

  return { frame, path };
}

function drawTotal() {
  if (!totalFigureEl || !showTotal) return;
  totalFigureEl.innerHTML = '';
  const e = exp();
  const lo = Math.min(0, ...(totals.length ? totals : [0]));
  const hi = Math.max(0, ...(totals.length ? totals : [0]));
  const pad = Math.max(2, (hi - lo) * 0.12);

  const frame = createChart(totalFigureEl, {
    viewHeight: 260,
    titleText: `${e.totalName} after each ${e.trialWord}`,
    descText: n === 0 ? 'No trials yet.'
      : `After ${n} ${e.trialsWord} it is ${Math.round(totals[n - 1])}, and it is not settling.`,
    id: 'lln-total',
  });
  const x = makeXScale(frame.width);
  const y = d3Scale.scaleLinear().domain([lo - pad, hi + pad]).range([frame.height, 0]);
  const xAxis = d3Axis.axisBottom(x);
  if (logScale) xAxis.ticks(6, '~s');
  addAxes(frame, xAxis, d3Axis.axisLeft(y), `Number of ${e.trialsWord}`, e.totalName);

  const data = d3Selection.select(frame.inner).select('.data');
  data.append('line')
    .attr('x1', 0).attr('x2', frame.width)
    .attr('y1', y(0)).attr('y2', y(0))
    .attr('stroke', EXPECTED).attr('stroke-width', 2).attr('stroke-dasharray', '7,4');

  if (!n) return;
  const line = d3Shape.line().x((d) => x(d[0])).y((d) => y(d[1]));
  data.append('path')
    .attr('fill', 'none').attr('stroke', TOTAL).attr('stroke-width', 2)
    .attr('stroke-linejoin', 'round')
    .attr('d', line(thin(totals)) ?? '');
  data.append('circle')
    .attr('cx', x(n)).attr('cy', y(totals[n - 1])).attr('r', 4).attr('fill', TOTAL);

  if (totalNote) {
    totalNote.innerHTML = n < 2 ? 'Add some trials.'
      : `<strong>Both lines come from the same ${e.trialsWord}.</strong> The one above is `
        + `settling toward ${exp().expected}. This one is not settling toward anything &mdash; `
        + `it is at <strong>${Math.round(totals[n - 1])}</strong> and typically drifts further `
        + `from zero as trials are added. Nothing is owed and nothing is repaid; the proportion `
        + `calms down because the denominator grows, not because the counts even out.`;
  }
}

function drawReadout() {
  if (!readoutEl) return;
  const e = exp();
  if (!n) {
    readoutEl.innerHTML = `<div><span class="lln-key">${e.trialsWord[0].toUpperCase() + e.trialsWord.slice(1)}</span>`
      + `<span class="lln-value">0</span></div>`;
    return;
  }
  const value = running[n - 1];
  const dev = Math.abs(value - e.expected);
  readoutEl.innerHTML =
      `<div><span class="lln-key">${e.trialsWord[0].toUpperCase() + e.trialsWord.slice(1)}</span>`
    + `<span class="lln-value">${n.toLocaleString()}</span></div>`
    + `<div><span class="lln-key">${e.countName}</span>`
    + `<span class="lln-value">${e.countText(sum, n)}</span></div>`
    + `<div><span class="lln-key">${e.valueName}</span>`
    + `<span class="lln-value">${value.toFixed(e.precision)}</span></div>`
    + `<div><span class="lln-key">Distance from ${e.expected}</span>`
    + `<span class="lln-value">${dev.toFixed(e.precision)}</span></div>`;
}

function redraw() {
  drawMain();
  drawTotal();
  drawReadout();
}

// ─── Running trials ───

/** @param {number} count */
function addTrials(count) {
  const e = exp();
  const room = MAX_TRIALS - n;
  if (room <= 0) {
    announce(`Stopped at ${MAX_TRIALS.toLocaleString()} ${e.trialsWord}.`);
    return;
  }
  const take = Math.min(count, room);
  for (let i = 0; i < take; i++) {
    sum += e.draw(rng);
    n += 1;
    running.push(sum / n);
    totals.push(e.total(sum, n));
  }
  redraw();
  const value = running[n - 1];
  announce(`${take} more ${take === 1 ? e.trialWord : e.trialsWord}. `
    + `${e.valueName} after ${n}: ${value.toFixed(e.precision)}, `
    + `${Math.abs(value - e.expected).toFixed(e.precision)} from ${e.expected}.`);
}

function reset() {
  sum = 0; n = 0;
  running = []; totals = [];
  rng = createRng(`${seed}:${experiment}`);
  redraw();
  announce('Started over.');
}

// ─── Wiring ───

for (const btn of document.querySelectorAll('.gen-btn')) {
  btn.addEventListener('click', () => {
    addTrials(Number(/** @type {HTMLElement} */ (btn).dataset.count) || 1);
  });
}

resetBtn?.addEventListener('click', reset);

expToggle?.addEventListener('click', (ev) => {
  const btn = /** @type {HTMLElement} */ (ev.target).closest('button[data-exp]');
  if (!btn) return;
  const next = /** @type {'coin'|'die'} */ (/** @type {HTMLElement} */ (btn).dataset.exp);
  if (next === experiment) return;
  experiment = next;
  for (const b of expToggle.querySelectorAll('button[data-exp]')) {
    b.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (b).dataset.exp === experiment));
  }
  reset();
  announce(`${exp().label}. The model expects ${exp().expected}.`);
});

logToggle?.addEventListener('change', () => {
  logScale = !!logToggle.checked;
  redraw();
  announce(logScale
    ? 'Trial count on a log scale: the early trials now take up as much width as the later ones.'
    : 'Trial count back on an ordinary scale.');
});

totalToggle?.addEventListener('change', () => {
  showTotal = !!totalToggle.checked;
  if (totalWrap) totalWrap.hidden = !showTotal;
  if (showTotal) drawTotal();
  announce(showTotal ? 'Running total shown below.' : 'Running total hidden.');
});

revealBtn?.addEventListener('click', () => {
  if (!revealAnswer) return;
  const open = revealAnswer.hidden;
  revealAnswer.hidden = !open;
  revealBtn.setAttribute('aria-expanded', String(open));
  revealBtn.textContent = open ? 'Hide the answer' : 'Show the answer';
  if (open && !revealAnswer.innerHTML) {
    revealAnswer.innerHTML =
      '<p><strong>No.</strong> The coin has no memory, so the next 1000 tosses give about 500 heads '
      + 'whatever happened in the first 10. That leaves about 504 heads in 1010 tosses &mdash; a '
      + 'proportion of about 0.499. The four missing heads were never repaid; they were outvoted. '
      + 'Tick <em>Also show the running total</em> to watch the shortfall persist while the '
      + 'proportion settles anyway.</p>';
  }
});

document.addEventListener('keydown', (ev) => {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(/** @type {HTMLElement} */ (ev.target).tagName)) return;
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const counts = { '1': 1, '2': 10, '3': 100, '4': 1000 };
  if (ev.key in counts) { ev.preventDefault(); addTrials(counts[/** @type {'1'} */ (ev.key)]); }
  else if (ev.key === 'r' || ev.key === 'R') { ev.preventDefault(); reset(); }
});

initHelp();

// Open on the experiment the link asked for.
if (experiment === 'die') {
  for (const b of expToggle?.querySelectorAll('button[data-exp]') ?? []) {
    b.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (b).dataset.exp === 'die'));
  }
}

// `?n=` pre-runs trials, for a link that should open with the picture already made.
const preset = Number(params.get('n'));
if (Number.isFinite(preset) && preset > 0) addTrials(Math.min(preset, MAX_TRIALS));
else redraw();

// Reduced motion costs nothing here — the trace is drawn, not animated — but the
// setting is read so the page participates in the same contract as the others.
void prefersReducedMotion;
