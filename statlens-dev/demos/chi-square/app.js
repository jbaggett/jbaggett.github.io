// @ts-check
/**
 * Demo 1 — "Where does X² come from?" (REQ-085)
 *
 * The first configuration of the shared demo stage (`js/demo-stage.js`). This
 * file owns the statistics and the source panel; the stage owns the trial loop,
 * the pile and the scrubber, so a fix to any of those reaches demos 2–6 too.
 *
 * ⚠ **Darts, not a bag of balls.** Each trial throws 50 INDEPENDENT marks at
 * blocks whose areas are the claimed shares, rather than drawing 50 from a
 * finite bag. The Demos plan measured why, on samples of 50 at 32/32/20/16:
 *
 *   χ²(3) curve          mean X² 3.00   tail beyond the 5% cutoff 5.0%
 *   darts                mean X² 3.00   4.9%  (200,000 samples)
 *   1,000 balls, no repl mean X² 2.84   4.0%  (40,000 samples)
 *
 * A finite bag makes the curve overstate the tail by about a fifth, which then
 * needs explaining in the one demo whose whole point is that the curve fits.
 * Sampling with replacement does not rescue the picture either — 71% of samples
 * of 50 from 1,000 would hit some ball twice. Darts also keep Todd's picture,
 * where area IS probability, which is what the bridge chapter needs later.
 *
 * ⚠ **X², not χ².** The statistic is X² = Σ(O−E)²/E; χ² is the distribution it
 * piles up into, and on this page you can watch one become the other — which is
 * exactly why the two must not share a symbol here of all places.
 *
 * After a demo by Todd Will: <https://chi-square-sampling-todd.toddgwill.chatgpt.site/>
 * Built fresh; none of his code is used.
 */

import * as jstat from 'jstat';
import { setJStat, pdfChisq, chisqCDF } from '../../js/distributions.js';
import { createDemoStage, PILE_CURVE_MIN } from '../../js/demo-stage.js';
import { renderNullBoard, rainDarts, flyBandsToTally, revealPending, tallyTableHTML } from '../../js/mechanisms/null-board.js';
import { drawMultinomial } from '../../js/mechanisms/draws.js';
import { announce, initHelp, initKeyboardShortcuts, initPlayPause } from '../../js/page-utils.js';
import { applySettings } from '../../js/settings.js';
import { formatStat, gofChisqStat } from '../../js/stats.js';

setJStat(jstat.default || jstat);
applySettings();
initHelp();

// ── The claim, fixed. No dataset menu: this demo asks one question. ──
const CATEGORIES = ['Blue', 'Amber', 'Green', 'Mauve'];
const PROPS = [0.32, 0.32, 0.20, 0.16];
const N = 50;
/** Whole numbers, which is the entire reason this teaching set exists. */
const EXPECTED = PROPS.map(p => p * N);
const DF = CATEGORIES.length - 1;

/** The real sample from `color`: 14 / 14 / 16 / 6, X² = 4.60. */
const OBSERVED_COUNTS = [14, 14, 16, 6];

const params = new URLSearchParams(location.search);
const seed = params.get('seed') || 'demo1';
const showObserved = params.get('observed') === 'on';

const boardEl = /** @type {HTMLElement} */ (document.getElementById('board'));
const tableEl = /** @type {HTMLElement} */ (document.getElementById('trial-table'));
const statEl = document.getElementById('trial-stat');
const whichEl = document.getElementById('trial-which');
const countEl = document.getElementById('trial-count');
const scrubEl = /** @type {HTMLInputElement} */ (document.getElementById('scrub'));
const scrubValueEl = document.getElementById('scrub-value');
const honestyEl = document.getElementById('honesty');
const observedNoteEl = document.getElementById('observed-note');
const pileEl = /** @type {HTMLElement} */ (document.getElementById('pile'));

/**
 * X² for a set of counts.
 *
 * ⚠ `gofChisqStat` from js/stats.js, not a local copy. The first draft of this
 * file reimplemented it in six lines, which is the one kind of duplication worth
 * being strict about: two copies of a STATISTIC can drift, and nothing would
 * fail when they did — the demo would simply teach a different number from the
 * tool it is meant to introduce. (Jeff, 2026-11-03: "we should try to minimize
 * the amount of code we have to maintain.")
 */
const chiSq = (/** @type {number[]} */ counts) => gofChisqStat(counts, PROPS);

const OBSERVED_STAT = chiSq(OBSERVED_COUNTS);

/**
 * One trial: 50 darts, four counts, one X².
 *
 * ⚠ Pure in `rng` — the stage re-runs this to scrub back to an old sample, so
 * reading anything else (the clock, a previous trial's leftovers) would make
 * sample 11 come back different the second time you looked at it.
 */
function drawTrial(rng) {
  const counts = drawMultinomial(N, PROPS, rng);
  return { stat: chiSq(counts), source: counts };
}

/**
 * Repaint the board and the table for the trial now showing.
 *
 * With `animate`, the sample is DRAWN rather than announced: 50 darts rain onto
 * the blocks, each block's tally then flies into its row, and only when a count
 * lands does it appear. The table is rendered with its numbers withheld
 * (`data-reveal`) until the flight finishes, so the animation carries the
 * information instead of decorating a result that was already on screen.
 *
 * ⚠ Only on a single manual step. A batch repaints once for the last trial (see
 * the stage), and during Play the interval is 120–900ms while the rain plus the
 * flight runs about a second — so animating every step would queue up behind
 * itself and read as a stutter. Press +1 to watch the mechanism; press Play to
 * build the pile. Both `rainDarts` and `flyBandsToTally` check the project's own
 * reduced-motion setting and hand back control immediately when it is on.
 *
 * @param {{stat: number, source: number[]}} trial
 * @param {number} index
 * @param {boolean} [animate]
 */
function renderSource(trial, index, animate = false) {
  const counts = trial.source;
  renderNullBoard(boardEl, {
    categories: CATEGORIES,
    props: PROPS,
    counts,
    // Its own stream, derived from the trial index, so the marks for sample 11
    // land in the same places every time you scrub back to it — and so that
    // moving a dart never consumes a draw the statistic depends on.
    rand: seededScatter(index),
    width: 460,
    height: 180,
  });

  tableEl.innerHTML = tallyTableHTML({
    categories: CATEGORIES,
    counts,
    expected: EXPECTED,
    chiText: `X\u00b2 = ${trial.stat.toFixed(2)}`,
    flyable: animate,
    pending: animate,
    // Whole by construction here — 16, 16, 10, 8 — so a trailing ".0" is noise.
    expectedDecimals: 0,
  });
  if (statEl) {
    if (animate) { statEl.setAttribute('data-reveal', trial.stat.toFixed(2)); statEl.textContent = ''; }
    else { statEl.removeAttribute('data-reveal'); statEl.textContent = trial.stat.toFixed(2); }
  }
  if (whichEl) whichEl.textContent = `(sample ${index})`;

  if (!animate) return;
  const board = boardEl.querySelector('.null-board');
  const darts = [...boardEl.querySelectorAll('.null-board-dart')];
  rainDarts(darts, {
    rand: seededScatter(index + 9973),
    onDone: () => flyBandsToTally({
      board,
      table: tableEl,
      onDone: () => {
        revealPending(tableEl);
        revealPending(statEl);
      },
    }),
  });
}

/**
 * A scatter stream of its own, per trial.
 *
 * The dart POSITIONS are decoration; the counts are the statistic. Drawing
 * them from the same stream would make a change to the picture move every
 * seeded answer on the page — the rule the mechanism work set down in
 * September, and the one that is easiest to break without noticing.
 */
function seededScatter(index) {
  let h = 2166136261 ^ index;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

// ⚠ `observedMark` closes over `stage`, which is being defined here. That is
// fine because the callback is only ever invoked from a redraw, which cannot
// happen before this assignment completes — but it is the kind of thing that
// looks like a mistake, so: deliberate.
const stage = createDemoStage({
  seed,
  tool: 'demo-chi-square',
  drawTrial,
  renderSource,
  pileContainer: pileEl,
  // Fixed from 0 to 16 so nothing rescales while a class is watching. χ²(3)
  // puts about 0.1% beyond 16, so the axis is wide enough to be honest and
  // tight enough that the hump is big.
  domain: [0, 16],
  binWidth: 0.5,
  xLabel: 'X² from one sample of 50',
  titleText: 'A thousand samples of 50',
  precision: 2,
  curvePdf: (x) => pdfChisq(x, DF),
  curveLabel: `χ²(${DF})`,
  // ⚠ The real sample is marked on the PICTURE — a line at 4.60 with the tail
  // beyond it shaded — not described in a sentence beside it. That was the
  // first version, and a paragraph about a value you cannot see on the chart is
  // why the whole feature read as bolted on. (Jeff, 2026-11-04: "the 'show the
  // real sample' is out of place in the demo.")
  //
  // Withheld until the pile is built. "How unusual is 4.60?" is not a question
  // you can ask of twelve dots, and a marker sitting on an empty axis from the
  // first press answers the demo's second question before its first has been
  // asked. 500 is the same threshold the curve arrives at, so the distribution
  // and the thing you measure against it turn up together.
  observedMark: () => (showObserved && stage && stage.trials >= PILE_CURVE_MIN
    ? { value: OBSERVED_STAT, direction: /** @type {'right'} */ ('right') }
    : null),
  scrubEl,
  scrubValueEl,
  /**
   * What hovering a dot or a bar segment says — and shows.
   *
   * The stage repaints the board and the table for that trial as the pointer
   * moves, which is the real answer: you see the 50 marks and the four counts
   * that produced the X² you are pointing at. This string is what a screen
   * reader gets, since it cannot see the panel change.
   */
  describeTrial: (trial, index, approximate) => ({
    title: approximate ? `A sample near X² = ${trial.stat.toFixed(2)}` : `Sample ${index}`,
    detail: CATEGORIES.map((c, i) => `${c} ${trial.source[i]}`).join(', ')
      + ` — X² = ${trial.stat.toFixed(2)}`,
  }),
  // Jeff, 2026-11-04: "can you make the maximum number of samples, say
  // 10,000… the scrubbing might have to be limited to the first 1000 or so."
  // Ten thousand is cheap — 15ms of drawing, measured — and the chart keeps
  // its fixed axis, so the shape just gets smoother.
  maxTrials: 10000,
  scrubMax: 1000,
  onUpdate: ({ trials, atMax }) => {
    if (countEl) countEl.textContent = trials.toLocaleString();
    // ⚠ Disable at the cap rather than letting a press do nothing. A dead
    // button in a lecture reads as a broken page, and `add()` simply returns 0.
    for (const b of document.querySelectorAll('.generate-bar .gen-btn')) {
      /** @type {HTMLButtonElement} */ (b).disabled = atMax;
    }
    if (honestyEl) honestyEl.hidden = trials < PILE_CURVE_MIN;
  },
});

// ── Controls ─────────────────────────────────────────────────────────
//
// ⚠ The site's shared controls, not this page's own. `initPlayPause` builds the
// play button, places it, keeps it in step with the +1 button's disabled state,
// stops on reset and binds Space; `initKeyboardShortcuts` binds 1/2/3 and 0.
// The first version of this file hand-rolled all of it and passed
// `initKeyboardShortcuts` a made-up shape — it expects ELEMENTS and calls
// `.click()`, so the number keys silently did nothing on this page. That is the
// cost of a parallel set of controls, and it was invisible until someone asked
// why the demo looked different. (Jeff, 2026-11-04.)
const genBtns = /** @type {NodeListOf<HTMLButtonElement>} */ (
  document.querySelectorAll('.generate-bar .gen-btn'));
const resetBtn = document.getElementById('reset-btn');

for (const btn of genBtns) {
  btn.addEventListener('click', () => {
    const added = stage.add(Number(btn.dataset.count));
    announce(added === 1
      ? `Sample ${stage.trials}: X² = ${stage.stats[stage.trials - 1].toFixed(2)}.`
      : `${added} more samples. ${stage.trials} in all.`);
    markObserved();
  });
}

resetBtn?.addEventListener('click', () => {
  stage.reset();
  tableEl.innerHTML = '';
  if (statEl) statEl.textContent = '—';
  if (whichEl) whichEl.textContent = '';
  boardEl.innerHTML = '';
  if (observedNoteEl) observedNoteEl.hidden = true;
  announce('Reset.');
});

const play = initPlayPause(genBtns, resetBtn, { delay: 450 });
initKeyboardShortcuts(genBtns, resetBtn);

document.getElementById('speed')?.addEventListener('change', (e) => {
  // Through the shared component, so Play behaves the same here as anywhere.
  play?.setDelay(Number(/** @type {HTMLSelectElement} */ (e.target).value));
});

// Presenter remotes send arrow and Page keys; both step one sample.
window.addEventListener('keydown', (e) => {
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(/** @type {HTMLElement} */ (e.target)?.tagName ?? '')) return;
  if (document.querySelector('dialog[open]')) return;
  if (e.key === 'ArrowRight' || e.key === 'PageDown') {
    e.preventDefault();
    if (stage.showing < stage.trials) stage.scrubTo(stage.showing + 1);
    else { stage.add(1); markObserved(); }
  } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
    e.preventDefault();
    if (stage.showing > 1) stage.scrubTo(stage.showing - 1);
  }
});

/**
 * The step Todd's page stops short of: where the real sample falls.
 *
 * Off by default, because the demo's first question is about the SHAPE, and a
 * marked observed value answers the second question before the first has been
 * asked. An activity step or `?observed=on` turns it on.
 */
function markObserved() {
  if (!observedNoteEl) return;
  const n = stage.trials;
  if (!showObserved || n < PILE_CURVE_MIN) { observedNoteEl.hidden = true; return; }
  const atLeast = stage.stats.filter(s => s >= OBSERVED_STAT).length;
  const share = atLeast / n;
  observedNoteEl.hidden = false;
  observedNoteEl.innerHTML = `A real sample of 50 gave 14 blue, 14 amber, 16 green and 6 mauve —`
    + ` <strong>X² = ${OBSERVED_STAT.toFixed(2)}</strong>.`
    + ` ${atLeast} of these ${n} samples are at least that far out`
    + ` (${formatStat(share, 0, 'proportion')}).`
    + ` The χ²(${DF}) curve puts ${formatStat(1 - chisqCDF(OBSERVED_STAT, DF), 0, 'proportion')} out there.`;
}


// ⚠ Hide the "Guided version" link when the guided version is what you are
// looking at — an activity panel beside a link offering the activity reads as a
// broken page, and in a lecture it is one more thing to explain away.
if (params.get('activity')) {
  const credit = document.getElementById('guided-link')?.parentElement;
  const link = document.getElementById('guided-link');
  if (link && credit) {
    link.remove();
    credit.firstChild?.remove?.();
  }
}

// Open on one sample, so the page is never a blank stage.
stage.add(1);
markObserved();
