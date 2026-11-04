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
import { renderNullBoard } from '../../js/mechanisms/null-board.js';
import { drawMultinomial } from '../../js/mechanisms/draws.js';
import { announce, initHelp, initKeyboardShortcuts, initPlayPause } from '../../js/page-utils.js';
import { applySettings } from '../../js/settings.js';
import { formatStat } from '../../js/stats.js';

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
const rowsEl = /** @type {HTMLElement} */ (document.getElementById('trial-rows'));
const totalObsEl = document.getElementById('total-obs');
const totalContribEl = document.getElementById('total-contrib');
const statEl = document.getElementById('trial-stat');
const whichEl = document.getElementById('trial-which');
const countEl = document.getElementById('trial-count');
const scrubEl = /** @type {HTMLInputElement} */ (document.getElementById('scrub'));
const scrubValueEl = document.getElementById('scrub-value');
const honestyEl = document.getElementById('honesty');
const observedNoteEl = document.getElementById('observed-note');
const pileEl = /** @type {HTMLElement} */ (document.getElementById('pile'));

/** X² for a set of counts against this demo's fixed expected counts. */
function chiSq(counts) {
  let total = 0;
  for (let i = 0; i < counts.length; i++) {
    const e = EXPECTED[i];
    total += (counts[i] - e) ** 2 / e;
  }
  return total;
}

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

/** Repaint the board and the table for the trial now showing. */
function renderSource(trial, index) {
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

  let rows = '';
  for (let i = 0; i < CATEGORIES.length; i++) {
    const contrib = (counts[i] - EXPECTED[i]) ** 2 / EXPECTED[i];
    rows += `<tr>`
      + `<td>${CATEGORIES[i]}</td>`
      + `<td class="num">${counts[i]}</td>`
      + `<td class="num">${EXPECTED[i]}</td>`
      + `<td class="num">${contrib.toFixed(2)}</td>`
      + `</tr>`;
  }
  rowsEl.innerHTML = rows;
  if (totalObsEl) totalObsEl.textContent = String(counts.reduce((a, b) => a + b, 0));
  if (totalContribEl) totalContribEl.textContent = trial.stat.toFixed(2);
  if (statEl) statEl.textContent = trial.stat.toFixed(2);
  if (whichEl) whichEl.textContent = `(sample ${index})`;
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
  precision: 1,
  curvePdf: (x) => pdfChisq(x, DF),
  curveLabel: `χ²(${DF})`,
  maxTrials: 1000,
  onUpdate: ({ trials, showing }) => {
    if (countEl) countEl.textContent = String(trials);
    if (scrubEl) {
      scrubEl.disabled = trials === 0;
      scrubEl.max = String(Math.max(1, trials));
      scrubEl.value = String(Math.max(1, showing));
    }
    if (scrubValueEl) scrubValueEl.textContent = trials ? `${showing} of ${trials}` : '—';
    if (honestyEl) honestyEl.hidden = trials < PILE_CURVE_MIN;
  },
});

// ── Controls ─────────────────────────────────────────────────────────
const playBtn = document.getElementById('btn-play');
playBtn?.addEventListener('click', () => {
  if (stage.isPlaying()) {
    stage.stop();
    playBtn.innerHTML = '&#9654; Play';
  } else {
    stage.play();
    playBtn.innerHTML = '&#10073;&#10073; Pause';
    announce('Playing.');
  }
});
for (const btn of document.querySelectorAll('[data-add]')) {
  btn.addEventListener('click', () => {
    const n = Number(/** @type {HTMLElement} */ (btn).dataset.add);
    const added = stage.add(n);
    announce(added === 1
      ? `Sample ${stage.trials}: X² = ${stage.stats[stage.trials - 1].toFixed(2)}.`
      : `${added} more samples. ${stage.trials} in all.`);
    markObserved();
  });
}
document.getElementById('btn-reset')?.addEventListener('click', () => {
  stage.reset();
  if (playBtn) playBtn.innerHTML = '&#9654; Play';
  rowsEl.innerHTML = '';
  if (statEl) statEl.textContent = '—';
  if (whichEl) whichEl.textContent = '';
  if (totalObsEl) totalObsEl.textContent = '—';
  if (totalContribEl) totalContribEl.textContent = '—';
  boardEl.innerHTML = '';
  if (observedNoteEl) observedNoteEl.hidden = true;
  announce('Reset.');
});
document.getElementById('speed')?.addEventListener('change', (e) => {
  stage.setSpeed(Number(/** @type {HTMLSelectElement} */ (e.target).value));
});
scrubEl?.addEventListener('input', () => {
  stage.scrubTo(Number(scrubEl.value));
  if (scrubValueEl) scrubValueEl.textContent = `${stage.showing} of ${stage.trials}`;
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
  if (!showObserved || !observedNoteEl) return;
  const n = stage.trials;
  if (n === 0) { observedNoteEl.hidden = true; return; }
  const atLeast = stage.stats.filter(s => s >= OBSERVED_STAT).length;
  const share = atLeast / n;
  observedNoteEl.hidden = false;
  observedNoteEl.innerHTML = `A real sample of 50 gave 14 blue, 14 amber, 16 green and 6 mauve —`
    + ` <strong>X² = ${OBSERVED_STAT.toFixed(2)}</strong>.`
    + ` ${atLeast} of these ${n} samples are at least that far out`
    + ` (${formatStat(share, 0, 'proportion')}).`
    + ` The χ²(${DF}) curve puts ${formatStat(1 - chisqCDF(OBSERVED_STAT, DF), 0, 'proportion')} out there.`;
}

initKeyboardShortcuts(
  /** @type {any} */ ([...document.querySelectorAll('[data-add]')].map(b => ({
    el: b, count: Number(/** @type {HTMLElement} */ (b).dataset.add),
  }))),
  document.getElementById('btn-reset'));
initPlayPause(/** @type {any} */ ([]), document.getElementById('btn-reset'));

// Open on one sample, so the page is never a blank stage.
stage.add(1);
markObserved();
