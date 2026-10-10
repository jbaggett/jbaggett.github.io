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
    prompt: 'suppose the proportion of heads is 0.40 after 10 tosses. Over the next 1000 '
      + 'tosses, does the coin produce <em>extra</em> heads to make up for it?',
    answer: '<strong>No.</strong> The coin has no memory, so the next 1000 tosses give about 500 '
      + 'heads whatever happened in the first 10. That leaves about 504 heads in 1010 tosses '
      + '\u2014 a proportion of about 0.499. The four missing heads were never repaid; they were '
      + 'outvoted. Tick <em>Also show the running total</em> to watch the shortfall persist while '
      + 'the proportion settles anyway.',
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
    prompt: 'suppose the average roll is 3.1 after 10 rolls. Over the next 1000 rolls, does the '
      + 'die produce <em>extra</em> high numbers to make up for it?',
    answer: '<strong>No.</strong> The die has no memory, so the next 1000 rolls average about 3.5 '
      + 'whatever happened in the first 10. That leaves an average of about 3.496 over 1010 rolls. '
      + 'The four pips it was short were never repaid; they were outvoted. Tick <em>Also show the '
      + 'running total</em> to watch the shortfall persist while the average settles anyway.',
  },
};

/** At most this many points are drawn; beyond it the trace is thinned. */
const MAX_POINTS = 1400;

/**
 * How many raw outcomes the tape keeps.
 *
 * The chart shows a running average, which is an abstraction over the thing
 * being done. The instructor this page was built for wanted the thing being
 * done — "LLN guy wants to see the rolls or die tosses" (Jeff, 2026-10-10) —
 * and ten is about what fits on a phone at a readable chip size.
 */
const TAPE_LEN = 10;

/** Pip layouts, on a 0–1 square. A die face is read, not spelled. */
const PIPS = {
  1: [[0.5, 0.5]],
  2: [[0.28, 0.28], [0.72, 0.72]],
  3: [[0.28, 0.28], [0.5, 0.5], [0.72, 0.72]],
  4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
  5: [[0.28, 0.28], [0.72, 0.28], [0.5, 0.5], [0.28, 0.72], [0.72, 0.72]],
  6: [[0.28, 0.26], [0.72, 0.26], [0.28, 0.5], [0.72, 0.5], [0.28, 0.74], [0.72, 0.74]],
};

/**
 * Continuous play, paced by the CLOCK rather than by frames.
 *
 * Jeff, 2026-10-07: "choose a comfortable speed that will remain constant(ish)
 * across browsers and machines." Adding a fixed number of trials per animation
 * frame would run at whatever the display refreshes at — the same page would
 * sample twice as fast on a 120Hz laptop as on a 60Hz one, and slower again
 * under load. So each frame asks how much TIME has passed and adds the trials
 * that belong to it. A slow machine draws fewer frames and adds more per frame;
 * the trials-per-second comes out the same.
 *
 * The rate rises with n, which is the pedagogy rather than impatience: early
 * trials each move the line visibly and are worth watching arrive, and by trial
 * 500 they are individually invisible. Roughly: ~6/s at the start, reaching
 * 1,000 in about nine seconds and 10,000 in about half a minute.
 */
const PLAY_BASE = 6;        // trials per second at the very start
const PLAY_GROWTH = 0.5;    // extra trials per second, per trial already drawn
/**
 * The ceiling. High, on purpose: with the rate proportional to n, each DECADE
 * of trials takes about the same wall time (ln 10 / 0.5 ≈ 4.6s), which is
 * exactly the pacing the log-scale view wants. A low cap turns that back into
 * a crawl just as the reader reaches the stretch where the law is supposed to
 * look boring — "it may have to accelerate with n to show anything meaningful
 * after a while" (Jeff, 2026-10-07). At 2,000/s a frame adds ~33 trials, which
 * costs nothing; the chart is thinned to MAX_POINTS before it is drawn.
 */
const PLAY_MAX = 2000;
/** Redraw at most this often. The sampler is not throttled, only the picture. */
const REDRAW_MS = 40;

/** Trials beyond this are refused — the page is a demonstration, not a stress test. */
const MAX_TRIALS = 200000;

// ─── State ───

const params = new URLSearchParams(location.search);
/** @type {'coin'|'die'} */
let experiment = params.get('exp') === 'die' ? 'die' : 'coin';

/**
 * The seed in play. `?seed=` fixes the run the page OPENS with, so a lecture or
 * a handout reproduces exactly; the reset button then draws a fresh one, because
 * "start over" means a new run and not the same one again. (Jeff, 2026-10-07:
 * "can we randomize the seed when we reset with the circular arrow button?")
 * Reload to get the link's run back.
 *
 * Switching experiment or `n` keeps the seed — those are not "start over", and
 * a seeded link should survive a reader looking at the dice and coming back.
 */
let seed = params.get('seed') || 'lln';
const newSeed = () => Math.random().toString(36).slice(2, 10);

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

/** The last few raw outcomes, newest last. */
let recent = /** @type {number[]} */ ([]);
/** Set when exactly one trial just arrived, so only that chip animates. */
let animateNewest = false;
/** @type {number} */ let tumbleTimer = 0;

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
const tapeEl = document.getElementById('tape');
const tapeLabelEl = document.getElementById('tape-label');
const promptEl = document.getElementById('reveal-prompt');
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

/**
 * The reflection prompt, which is about whichever experiment is running.
 *
 * It used to be hard-coded in the markup and asked about heads and coins under
 * both — so switching to Die rolls left a question about coins sitting under a
 * chart of die averages, and the revealed answer was cached on first open and
 * never changed at all.
 */
function drawPrompt() {
  const e = exp();
  if (promptEl) promptEl.innerHTML = '<strong>Before you add a thousand:</strong> ' + e.prompt;
  if (revealAnswer && !revealAnswer.hidden) revealAnswer.innerHTML = `<p>${e.answer}</p>`;
}

/** Keep the ring at TAPE_LEN, newest last. */
function pushRecent(/** @type {number} */ v) {
  recent.push(v);
  if (recent.length > TAPE_LEN) recent.splice(0, recent.length - TAPE_LEN);
}

/** One die face, drawn as pips on a 0–1 square. */
function pipSvg(/** @type {number} */ face) {
  const dots = (PIPS[/** @type {keyof typeof PIPS} */ (face)] || [])
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="0.1" fill="#114B5F"/>`).join('');
  return `<svg viewBox="0 0 1 1" aria-hidden="true">${dots}</svg>`;
}

/** How a single outcome reads in words, for the tape's label. */
function outcomeWord(/** @type {number} */ v) {
  return experiment === 'coin' ? (v === 1 ? 'heads' : 'tails') : String(v);
}

/**
 * The tape of recent outcomes.
 *
 * Rebuilt whole on every redraw, which is cheap at ten chips and means it can
 * never drift out of step with the trial counter. During play that is once per
 * REDRAW_MS, not once per trial.
 */
function drawTape() {
  if (!tapeEl || !tapeLabelEl) return;
  const e = exp();
  if (tumbleTimer) { clearInterval(tumbleTimer); tumbleTimer = 0; }

  tapeLabelEl.textContent = n === 0
    ? `The ${e.trialsWord} will appear here`
    : `The last ${Math.min(TAPE_LEN, n)} ${Math.min(TAPE_LEN, n) === 1 ? e.trialWord : e.trialsWord}`
      + (n > TAPE_LEN ? ` (of ${n.toLocaleString()})` : '');

  if (!recent.length) {
    tapeEl.innerHTML = `<span class="lln-tape-empty">Add a ${e.trialWord} to begin.</span>`;
    tapeEl.setAttribute('aria-label', `No ${e.trialsWord} yet.`);
    return;
  }

  tapeEl.innerHTML = recent.map((v, i) => {
    const newest = i === recent.length - 1 ? ' is-newest' : '';
    if (experiment === 'coin') {
      return `<span class="lln-chip${v === 1 ? ' is-heads' : ''}${newest}">${v === 1 ? 'H' : 'T'}</span>`;
    }
    return `<span class="lln-chip is-die${newest}">${pipSvg(v)}</span>`;
  }).join('');

  // Said in words, because pips and single letters are not. Not a live region:
  // the readout beside it already announces, and a chattier one during play
  // would be unusable.
  tapeEl.setAttribute('aria-label',
    `The last ${recent.length} ${recent.length === 1 ? e.trialWord : e.trialsWord}, oldest first: `
    + recent.map(outcomeWord).join(', ') + '.');

  if (animateNewest && !prefersReducedMotion()) runNewestAnimation();
}

/** Spin the coin, or tumble the die, on the chip that just arrived. */
function runNewestAnimation() {
  const chip = /** @type {HTMLElement|null} */ (tapeEl?.lastElementChild);
  if (!chip || !chip.classList.contains('lln-chip')) return;

  if (experiment === 'coin') { chip.classList.add('is-flipping'); return; }

  chip.classList.add('is-tumbling');
  // The faces flashed on the way down are DECORATION, and they are computed
  // from n rather than drawn from `rng` — a cosmetic draw would advance the
  // seeded stream and change every outcome after it, so `?seed=` would stop
  // meaning anything the moment someone turned animation on.
  const landed = recent[recent.length - 1];
  let i = 0;
  tumbleTimer = window.setInterval(() => {
    i += 1;
    if (i > 4) {
      clearInterval(tumbleTimer);
      tumbleTimer = 0;
      chip.innerHTML = pipSvg(landed);
      return;
    }
    chip.innerHTML = pipSvg(1 + ((n * 7 + i * 3) % 6));
  }, 65);
}

function redraw() {
  drawTape();
  drawPrompt();
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
    const v = e.draw(rng);
    sum += v;
    n += 1;
    running.push(sum / n);
    totals.push(e.total(sum, n));
    pushRecent(v);
  }
  // One trial at a time is the only case worth animating: at +1000, or at the
  // 2,000 a second play reaches, a per-outcome animation is a strobe.
  animateNewest = take === 1;
  redraw();
  animateNewest = false;
  const value = running[n - 1];
  announce(`${take} more ${take === 1 ? e.trialWord : e.trialsWord}. `
    + `${e.valueName} after ${n}: ${value.toFixed(e.precision)}, `
    + `${Math.abs(value - e.expected).toFixed(e.precision)} from ${e.expected}.`);
}

/** @param {boolean} [fresh] - draw a new seed, so the run differs from the last */
// ─── Continuous play ───

let playing = false;
/** @type {number|null} */ let rafId = null;
let lastTick = 0;
let carry = 0;         // fractional trials owed from the previous frame
let lastDraw = 0;

/** @param {number} count */
function trialsPerSecond(count) {
  return Math.min(PLAY_MAX, PLAY_BASE + PLAY_GROWTH * count);
}

/** Add trials without redrawing — the loop decides when the picture updates. */
function sampleOnly(/** @type {number} */ count) {
  const e = exp();
  const room = MAX_TRIALS - n;
  const take = Math.min(count, room);
  for (let i = 0; i < take; i++) {
    const v = e.draw(rng);
    sum += v;
    n += 1;
    running.push(sum / n);
    totals.push(e.total(sum, n));
    pushRecent(v);
  }
  return take;
}

function tick(/** @type {number} */ now) {
  if (!playing) return;
  const dt = Math.min(0.25, (now - lastTick) / 1000);   // a tab that was hidden
  lastTick = now;                                        // must not dump a burst
  carry += dt * trialsPerSecond(n);
  const whole = Math.floor(carry);
  if (whole > 0) {
    carry -= whole;
    if (sampleOnly(whole) < whole) { stopPlay('Reached the limit.'); redraw(); return; }
  }
  if (now - lastDraw >= REDRAW_MS) { lastDraw = now; redraw(); }
  rafId = requestAnimationFrame(tick);
}

function startPlay() {
  if (playing || n >= MAX_TRIALS) return;
  playing = true;
  carry = 0;
  lastTick = performance.now();
  lastDraw = 0;
  setPlayButton();
  announce('Playing \u2014 trials are being added continuously.');
  rafId = requestAnimationFrame(tick);
}

function stopPlay(/** @type {string} */ why = '') {
  if (!playing) return;
  playing = false;
  if (rafId !== null) cancelAnimationFrame(rafId);
  rafId = null;
  setPlayButton();
  redraw();
  const e = exp();
  announce(`${why} Stopped at ${n.toLocaleString()} ${e.trialsWord}. `
    + `${e.valueName} ${running[n - 1]?.toFixed(e.precision) ?? '\u2014'}.`);
}

const togglePlay = () => (playing ? stopPlay() : startPlay());

/** @type {HTMLButtonElement|null} */
let playBtn = null;
function setPlayButton() {
  if (!playBtn) return;
  playBtn.textContent = playing ? '\u25A0' : '\u25B6';
  playBtn.title = playing ? 'Stop' : 'Play \u2014 keep adding trials';
  playBtn.setAttribute('aria-label', playing ? 'Stop adding trials' : 'Play: keep adding trials');
  playBtn.setAttribute('aria-pressed', String(playing));
}

function reset(fresh = false) {
  stopPlay();
  if (fresh) seed = newSeed();
  sum = 0; n = 0;
  running = []; totals = [];
  recent = [];
  rng = createRng(`${seed}:${experiment}`);
  redraw();
  announce(fresh ? 'Started over with a new sequence of trials.' : 'Started over.');
}

// ─── Wiring ───

for (const btn of document.querySelectorAll('.gen-btn')) {
  btn.addEventListener('click', () => {
    stopPlay();   // an explicit +N means "this many", not "this many and carry on"
    addTrials(Number(/** @type {HTMLElement} */ (btn).dataset.count) || 1);
  });
}

// The play button lives with the other generate controls, styled like the one
// js/page-utils.js builds for the simulation pages — same glyphs, same
// semantics — but driven by the clock rather than a per-trial timer.
{
  const bar = document.getElementById('controls');
  const resetButton = document.getElementById('reset-btn');
  if (bar) {
    playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'play-btn';
    setPlayButton();
    playBtn.addEventListener('click', togglePlay);
    bar.insertBefore(playBtn, resetButton);
  }
}

resetBtn?.addEventListener('click', () => reset(true));

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
  if (open) revealAnswer.innerHTML = `<p>${exp().answer}</p>`;
});

document.addEventListener('keydown', (ev) => {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(/** @type {HTMLElement} */ (ev.target).tagName)) return;
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const counts = { '1': 1, '2': 10, '3': 100, '4': 1000 };
  if (ev.key in counts) { ev.preventDefault(); stopPlay(); addTrials(counts[/** @type {'1'} */ (ev.key)]); }
  else if (ev.key === 'p' || ev.key === 'P') { ev.preventDefault(); togglePlay(); }
  else if (ev.key === 'r' || ev.key === 'R') { ev.preventDefault(); reset(true); }
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

