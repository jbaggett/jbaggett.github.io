// @ts-check
/**
 * Demo 2 — "What does a shuffle show?" (REQ-085)
 *
 * The second configuration of the shared demo stage. Demo 1 draws from a
 * STATED null — darts at blocks whose areas are the claimed proportions. This
 * one has **no population at all**: the twelve outcomes are fixed, and the only
 * thing a trial changes is which six people are called "treatment".
 *
 * That contrast is the reason both demos exist. A student who meets only one of
 * them concludes that a null distribution is a thing you sample *from*; the
 * shuffle shows it is also something you can build out of the data you already
 * have, by breaking the one link you are asking about.
 *
 * ⚠ **Spikes, not bars.** With six in each group and seven improvements, the
 * difference in proportions can take exactly six values — ±5/6, ±1/2, ±1/6 —
 * with exact probabilities 7/924, 105/924 and 350/924 either side of zero. A
 * histogram over six lattice points either combs or merges values that are
 * genuinely distinct, so the pile asks the stage for a spike chart.
 *
 * ⚠ **No curve.** The Demos plan holds theory until the bridge chapter: demos
 * 2, 3 and 4 show none, and a curve appears only in 1, 5 and 6. There is also
 * nothing honest to draw — the exact distribution is six spikes, and a smooth
 * curve over them would be a worse description, not a better one.
 */

import { createDemoStage } from '../../js/demo-stage.js';
import { shufflePairing } from '../../js/mechanisms/draws.js';
import { announce, initHelp, initKeyboardShortcuts, initPlayPause } from '../../js/page-utils.js';
import { applySettings } from '../../js/settings.js';
import { formatStat } from '../../js/stats.js';

applySettings();
initHelp();

// ── The twelve, fixed. No dataset menu: this demo asks one question. ──
const GROUPS = ['Treatment', 'Placebo'];
const SUCCESS = 'Improved';
/** Six treatment, six placebo; five and two improved. @type {{group: string, outcome: string}[]} */
const PEOPLE = [
  ...Array.from({ length: 5 }, () => ({ group: 'Treatment', outcome: 'Improved' })),
  { group: 'Treatment', outcome: 'No change' },
  ...Array.from({ length: 2 }, () => ({ group: 'Placebo', outcome: 'Improved' })),
  ...Array.from({ length: 4 }, () => ({ group: 'Placebo', outcome: 'No change' })),
];
const N_PER_GROUP = 6;
/** The outcomes, in a fixed order. A shuffle re-deals these, never changes them. */
const OUTCOMES = PEOPLE.map(p => p.outcome);
const OBSERVED_STAT = 5 / N_PER_GROUP - 2 / N_PER_GROUP;

const params = new URLSearchParams(location.search);
const seed = params.get('seed') || 'demo2';
const showObserved = params.get('observed') === 'on';

const dealEl = /** @type {HTMLElement} */ (document.getElementById('deal'));
const tallyEl = document.getElementById('deal-tally');
const statEl = document.getElementById('trial-stat');
const whichEl = document.getElementById('trial-which');
const countEl = document.getElementById('trial-count');
const scrubEl = /** @type {HTMLInputElement} */ (document.getElementById('scrub'));
const scrubValueEl = document.getElementById('scrub-value');
const observedNoteEl = document.getElementById('observed-note');
const pileEl = /** @type {HTMLElement} */ (document.getElementById('pile'));

/** The gap between the two groups, as a difference in proportions. */
function gapOf(/** @type {string[]} */ dealt) {
  let a = 0, b = 0;
  for (let i = 0; i < dealt.length; i++) {
    if (dealt[i] !== SUCCESS) continue;
    if (i < N_PER_GROUP) a++; else b++;
  }
  return a / N_PER_GROUP - b / N_PER_GROUP;
}

/**
 * One shuffle: deal the same twelve outcomes into two new groups of six.
 *
 * ⚠ Pure in `rng` — the stage re-runs this to scrub back, so reading anything
 * else would make shuffle 11 come back different the second time you looked.
 */
function drawTrial(rng) {
  const dealt = shufflePairing(OUTCOMES, rng).values;
  return { stat: gapOf(dealt), source: dealt };
}

/** Repaint the two hands for the shuffle now showing. */
function renderSource(trial, index) {
  const dealt = trial.source;
  let html = '';
  for (let g = 0; g < 2; g++) {
    const slice = dealt.slice(g * N_PER_GROUP, (g + 1) * N_PER_GROUP);
    const wins = slice.filter((/** @type {string} */ o) => o === SUCCESS).length;
    html += `<div class="deal-group"><h3>${GROUPS[g]}</h3><div class="deal-cards">`;
    for (const o of slice) {
      // ⚠ The letter, not just the fill. Outcome must never be carried by
      // colour alone — and on a projector the fill is the first thing lost.
      html += `<span class="pcard" data-outcome="${o}" role="img"`
        + ` aria-label="${o}">${o === SUCCESS ? 'I' : '–'}</span>`;
    }
    html += `</div><p class="deal-tally">${wins} of ${N_PER_GROUP} improved</p></div>`;
  }
  dealEl.innerHTML = html;
  if (tallyEl) tallyEl.textContent = '';
  if (statEl) statEl.textContent = formatStat(trial.stat, 1);
  if (whichEl) whichEl.textContent = `(shuffle ${index})`;
}

const stage = createDemoStage({
  seed,
  tool: 'demo-shuffle',
  drawTrial,
  renderSource,
  pileContainer: pileEl,
  // The six achievable gaps, with a little air either side so the end spikes
  // are not drawn on the axis.
  domain: [-1, 1],
  binWidth: 1 / 3,
  xLabel: 'Difference in proportion improved (Treatment − Placebo)',
  titleText: 'Gaps produced by shuffling alone',
  precision: 2,
  // ⚠ Spikes once there is a pile. The statistic lives on six lattice points;
  // bars would invent a width it does not have.
  chartTypeFor: (trials) => (trials <= 20 ? 'dotplot' : 'spike'),
  observedMark: () => (showObserved && stage && stage.trials >= 50
    ? { value: OBSERVED_STAT, direction: /** @type {'right'} */ ('right') }
    : null),
  describeTrial: (trial, index) => ({
    title: `Shuffle ${index}`,
    detail: `${GROUPS[0]} ${trial.source.slice(0, N_PER_GROUP).filter((/** @type {string} */ o) => o === SUCCESS).length}`
      + ` of ${N_PER_GROUP}, ${GROUPS[1]} ${trial.source.slice(N_PER_GROUP).filter((/** @type {string} */ o) => o === SUCCESS).length}`
      + ` of ${N_PER_GROUP} — difference ${formatStat(trial.stat, 1)}`,
  }),
  scrubEl,
  scrubValueEl,
  maxTrials: 1000,
  onUpdate: ({ trials }) => {
    if (countEl) countEl.textContent = String(trials);
  },
});

// ── Controls: the site's, not this page's. See demos/chi-square/app.js. ──
const genBtns = /** @type {NodeListOf<HTMLButtonElement>} */ (
  document.querySelectorAll('.generate-bar .gen-btn'));
const resetBtn = document.getElementById('reset-btn');

for (const btn of genBtns) {
  btn.addEventListener('click', () => {
    const added = stage.add(Number(btn.dataset.count));
    announce(added === 1
      ? `Shuffle ${stage.trials}: difference ${formatStat(stage.stats[stage.trials - 1], 1)}.`
      : `${added} more shuffles. ${stage.trials} in all.`);
    markObserved();
  });
}

resetBtn?.addEventListener('click', () => {
  stage.reset();
  dealEl.innerHTML = '';
  if (statEl) statEl.textContent = '—';
  if (whichEl) whichEl.textContent = '';
  if (observedNoteEl) observedNoteEl.hidden = true;
  announce('Reset.');
});

const play = initPlayPause(genBtns, resetBtn, { delay: 450 });
initKeyboardShortcuts(genBtns, resetBtn);
document.getElementById('speed')?.addEventListener('change', (e) => {
  play?.setDelay(Number(/** @type {HTMLSelectElement} */ (e.target).value));
});

// Presenter remotes send arrow and Page keys; both step one shuffle.
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
 * Where the observed gap falls, once there is a pile to judge it against.
 *
 * Withheld until 50 shuffles: with six achievable values the shape arrives
 * quickly, but "how often does chance do this?" is not a question you can ask
 * of a handful of spikes.
 */
function markObserved() {
  if (!observedNoteEl) return;
  const n = stage.trials;
  if (!showObserved || n < 50) { observedNoteEl.hidden = true; return; }
  const atLeast = stage.stats.filter(s => s >= OBSERVED_STAT).length;
  observedNoteEl.hidden = false;
  observedNoteEl.innerHTML = `The observed gap was <strong>${formatStat(OBSERVED_STAT, 1)}</strong>.`
    + ` ${atLeast} of these ${n} shuffles are at least that big`
    + ` (${formatStat(atLeast / n, 0, 'proportion')}).`
    + ` Dealing all 924 possible ways gives 112 of them — ${formatStat(112 / 924, 0, 'proportion')}.`;
}

if (params.get('activity')) {
  const link = document.getElementById('guided-link');
  const credit = link?.parentElement;
  if (link && credit) { link.remove(); credit.firstChild?.remove?.(); }
}

// Open on one shuffle, so the page is never a blank stage.
stage.add(1);
markObserved();
