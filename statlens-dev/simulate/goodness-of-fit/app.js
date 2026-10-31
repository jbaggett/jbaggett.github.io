// @ts-check
/**
 * Chi-Square Goodness-of-Fit Simulation page.
 * Draws repeated multinomial samples of size n from a hypothesized distribution
 * p₀, computes the χ² goodness-of-fit statistic for each, and builds the null
 * distribution. The observed χ² is marked; the p-value is the right-tail fraction.
 */

import { createRng } from '../../js/prng.js';
import { prefersReducedMotion } from '../../js/settings.js';
import { renderNullBoard, BAND_FILLS, flyBandsToTally, rainDarts } from '../../js/mechanisms/null-board.js';
import { wordsFor } from '../../js/mechanisms/vocabulary.js';
import { applyRequestedLayout } from '../../js/mechanisms/layout.js';

/** These pages break an association by permuting one side of it. */
// `statedPopulation`, not `permuteAssociation`: nothing is permuted here. H₀
// names the proportions outright and the darts are drawn from them, which is
// the one-proportion test's mechanism with k categories instead of 2. Both
// spell `distribution` 'Null Distribution', so no displayed string moves.
const words = wordsFor('statedPopulation');
// Opt-in mechanism layouts (?mech=tiers|split). No-op without the parameter.
applyRequestedLayout('permuteAssociation');
import { drawMultinomial } from '../../js/mechanisms/draws.js';
import { gofChisqStat, formatStat } from '../../js/stats.js';
import { computeBins } from '../../js/histogram.js';
import { fetchDataset, loadDatasetIndex, collapseDataPanel, announce, initTabs, initKeyboardShortcuts, initPlayPause, initMechanismCollapse, computeHighlights, animateDropToChart, getActiveTabId, getTabHintText, setPageTitle, gateBigBatches, capBatch, applySimulationCap, autoRunButton} from '../../js/page-utils.js';
import { renderSimChart, resolveChartType, DOTPLOT_AUTO_THRESHOLD } from '../../js/chart-defaults.js';

// ─── DOM ───
const chartContainer = document.getElementById('chart-container');
const resultDiv = document.getElementById('result-summary');
const resetBtn = /** @type {HTMLButtonElement} */ (document.getElementById('reset-btn'));
const dataSummary = document.getElementById('data-summary');
const dataPreview = document.getElementById('data-preview');
const datasetSelect = /** @type {HTMLSelectElement} */ (document.getElementById('dataset-select'));
const datasetDesc = document.getElementById('dataset-desc');
const mechanismStrip = document.getElementById('mechanism-strip');
const mechSimulated = document.getElementById('mech-simulated');
const mechNullBoard = document.getElementById('mech-null-board');
const mechObservedChisq = document.getElementById('mech-observed-chisq');
const mechSimulatedChisq = document.getElementById('mech-simulated-chisq');
const mechanismDescEl = document.getElementById('mechanism-description');
const simTitleEl = document.getElementById('sim-title');
const controlsSection = document.getElementById('controls');
const genBtns = /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('.gen-btn'));

const generateBar = /** @type {HTMLElement|null} */ (controlsSection?.querySelector('.generate-bar'));
// The inline "More options" button used to go here. It now lives in the page
// header as Simple | Detailed (js/page-utils.js initDisplayToggle), where it
// cannot be mistaken for an option belonging to the control beside it.

initTabs({ hintTarget: resultDiv, hintAction: 'draw samples to see results' });
initKeyboardShortcuts(genBtns, resetBtn);
initPlayPause(genBtns, resetBtn);

// ─── State ───
/** @type {string[]} */ let categories = [];
/** @type {number[]} */ let observed = [];
/** @type {number[]} */ let p0 = [];
/** @type {number[]} */ let expected = [];
let observedChisq = 0;
/** 'sim' shows a draw from H₀ in the strip; 'observed' shows the data's own counts. */
let stripMode = 'sim';
/** @type {number[]} The most recent simulated sample, to come back to. */
let lastSimSample = [];
let lastSimChisq = 0;
/** @type {NodeListOf<HTMLButtonElement>|null} */
let stripToggleBtns = null;
let totalN = 0;
let currentSourceName = '';
// The dataset behind the loaded counts, kept so the panel can collapse onto it
// the way every other page's does. Null after manual entry: there is no study
// to describe and nothing to download. (2026-10-02.)
/** @type {any} */ let currentDataset = null;
/** @type {{nullClaim?: string}} */
let datasetContext = {};

/** @type {number[]} */ let allStats = [];
/**
 * The SAMPLE behind each statistic, so a dot in the distribution can show what
 * produced it. Parallel to `allStats` and kept only while the chart still draws
 * individual dots — past DOTPLOT_AUTO_THRESHOLD it becomes a histogram, where a
 * bar is a bin rather than a draw and there is nothing to point at. That also
 * keeps this from growing to 100,000 × k numbers at the simulation cap.
 * @type {number[][]}
 */
let allSamples = [];
/** Which simulation the reader is hovering, if any. */
/** @type {number|null} */ let previewIndex = null;
/** @type {(() => number)|null} */ let rng = null;
let mechanismInitialized = false;

const urlSeed = new URLSearchParams(location.search).get('seed');
let seed = urlSeed || Math.random().toString(36).slice(2, 10);
const plotOnly = new URLSearchParams(location.search).get('plot') === 'only';
let plotOnlyRan = false;
const showReadout = !plotOnly
  && !/^(false|0|no)$/i.test(new URLSearchParams(location.search).get('readout') || '');
if (urlSeed) {
  const sn = document.getElementById('seed-notice');
  if (sn) { sn.hidden = false; sn.textContent = `Seed: ${urlSeed}`; }
}
const baseTitle = document.title.replace(/\s*\|\s*StatLens$/, '');

/** @param {string} s */
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Dataset loading (dropdown + ?dataset=) ───
(async () => {
  const index = await loadDatasetIndex(datasetSelect, ds => ds.type === 'gof', datasetDesc);
  const wanted = new URLSearchParams(location.search).get('dataset');
  if (wanted && index.some(d => d.id === wanted)) {
    datasetSelect.value = wanted;
    datasetSelect.dispatchEvent(new Event('change'));
  }
})();

datasetSelect?.addEventListener('change', async () => {
  const id = datasetSelect.value;
  if (!id) return;
  try {
    loadDataset(await fetchDataset(id));
  } catch {
    announce('Could not load that dataset.');
  }
});

/** @param {any} ds */
function loadDataset(ds) {
  const cats = ds.categories
    || (ds.variables?.[0] ? [...new Set((ds.rows || []).map((/** @type {any} */ r) => r[ds.variables[0].name]))] : []);
  if (!cats || cats.length < 2) { announce('This dataset needs at least two categories.'); return; }
  // observed counts: explicit `observed`, else tally raw rows by the categorical var
  let obs;
  if (Array.isArray(ds.observed)) obs = ds.observed.slice();
  else {
    const col = ds.variables[0].name;
    obs = cats.map((/** @type {any} */ c) => (ds.rows || []).filter((/** @type {any} */ r) => r[col] === c).length);
  }
  const nulls = ds.gofNull || {};
  const props = cats.map((/** @type {any} */ c) => Number(nulls[c]));
  if (props.some((/** @type {number} */ v) => !isFinite(v) || v <= 0)) {
    announce('This dataset is missing hypothesized proportions.');
    return;
  }
  currentSourceName = ds.name || '';
  currentDataset = ds;
  datasetContext = { nullClaim: ds.nullClaim };
  applyState(cats.map(String), obs, props);
}

// ─── Manual entry (Enter Counts) ───
const inputRowsEl = document.getElementById('gof-input-rows');
const p0SumEl = document.getElementById('p0-sum');

/** @param {string} [cat] @param {string} [obs] @param {string} [prop] */
function addInputRow(cat = '', obs = '', prop = '') {
  if (!inputRowsEl) return;
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" class="gof-cat" value="${esc(cat)}" placeholder="e.g. Red" aria-label="Category name"></td>
    <td><input type="number" class="gof-obs" value="${esc(obs)}" min="0" step="1" placeholder="0" aria-label="Observed count"></td>
    <td><input type="number" class="gof-p0" value="${esc(prop)}" min="0" max="1" step="any" placeholder="0.25" aria-label="Hypothesized proportion"></td>
    <td><button type="button" class="gof-remove btn-icon" aria-label="Remove category" title="Remove">&times;</button></td>`;
  inputRowsEl.appendChild(tr);
  tr.querySelector('.gof-remove')?.addEventListener('click', () => { tr.remove(); updateP0Sum(); });
  tr.querySelectorAll('.gof-p0').forEach(el => el.addEventListener('input', updateP0Sum));
}
function updateP0Sum() {
  if (!p0SumEl) return;
  const sum = [...document.querySelectorAll('.gof-p0')]
    .reduce((a, el) => a + (parseFloat(/** @type {HTMLInputElement} */ (el).value) || 0), 0);
  p0SumEl.textContent = sum.toFixed(4).replace(/\.?0+$/, '') || '0';
  p0SumEl.style.color = Math.abs(sum - 1) < 0.02 ? 'var(--ims-green, #2a7d4f)' : 'var(--ims-red, #c0392b)';
}
document.getElementById('gof-add-row')?.addEventListener('click', () => addInputRow());
document.getElementById('gof-clear')?.addEventListener('click', () => {
  if (inputRowsEl) inputRowsEl.innerHTML = '';
  for (let i = 0; i < 3; i++) addInputRow();
  updateP0Sum();
});
document.getElementById('gof-load')?.addEventListener('click', () => {
  const cats = [], obs = [], props = [];
  const rows = inputRowsEl ? [...inputRowsEl.querySelectorAll('tr')] : [];
  for (const tr of rows) {
    const cat = /** @type {HTMLInputElement} */ (tr.querySelector('.gof-cat'))?.value.trim();
    const o = parseInt(/** @type {HTMLInputElement} */ (tr.querySelector('.gof-obs'))?.value, 10);
    const p = parseFloat(/** @type {HTMLInputElement} */ (tr.querySelector('.gof-p0'))?.value);
    if (!cat) continue;
    if (!Number.isFinite(o) || o < 0) { announce(`Enter a valid observed count for "${cat}".`); return; }
    if (!isFinite(p) || p <= 0) { announce(`Enter a valid proportion (> 0) for "${cat}".`); return; }
    cats.push(cat); obs.push(o); props.push(p);
  }
  if (cats.length < 2) { announce('Enter at least two categories.'); return; }
  if (obs.reduce((a, b) => a + b, 0) <= 0) { announce('Total observed count must be greater than 0.'); return; }
  const sum = props.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 0.02) { announce(`Hypothesized proportions sum to ${sum.toFixed(3)} — they must sum to 1.`); return; }
  const norm = props.map(p => p / sum); // gentle normalization for tiny rounding
  currentSourceName = '';
  currentDataset = null;
  datasetContext = {};
  applyState(cats, obs, norm);
});
// seed 3 blank rows on first load
for (let i = 0; i < 3; i++) addInputRow();
updateP0Sum();

// ─── Apply loaded state ───
/** @param {string[]} cats @param {number[]} obs @param {number[]} props */
function applyState(cats, obs, props) {
  categories = cats;
  observed = obs;
  p0 = props;
  totalN = obs.reduce((a, b) => a + b, 0);
  expected = p0.map(p => totalN * p);
  observedChisq = gofChisqStat(observed, p0);
  resetSimulation();
  showDataLoaded();
}

function showDataLoaded() {
  if (dataPreview) dataPreview.hidden = false;
  // Collapse the panel onto a summary bar with a Change Data button, the
  // Explore/Preview/Download actions and "About this data" — what every page
  // running `initDataPanel` does on load. This page loads datasets by hand
  // (`loadDatasetIndex` + `fetchDataset`), so it got the data and none of the
  // furniture: you picked a dataset and the frame simply did not change.
  // Reported by Jeff, 2026-10-02. Logged as debt — the real fix is to stop
  // hand-rolling the panel on this page and its inference twin.
  collapseDataPanel(document.getElementById('data-panel'), currentDataset ?? undefined);
  const ctrl = document.getElementById('controls');
  if (ctrl) ctrl.classList.add('sticky');
  if (dataSummary) {
    const namePrefix = currentSourceName ? `${currentSourceName}: ` : '';
    dataSummary.textContent = `${namePrefix}${categories.length} categories, n = ${totalN}, observed χ² = ${formatStat(observedChisq, 2)}`;
  }
  for (const btn of genBtns) btn.disabled = false;
  gateBigBatches(genBtns, totalN);
  // Hypotheses with the specific hypothesized proportions per category.
  const hypBox = document.getElementById('gof-hyp');
  const h0El = document.getElementById('gof-h0');
  // Each proportion wears its category's colour, the same wash the table rows
  // and the board bands use — so H₀ as WRITTEN and H₀ as DRAWN are visibly the
  // same four things. (Jeff, 2026-10-31: "could we color the null proportions
  // in the null hypothesis using background color for each category similar to
  // the rows in the table".) Never the only cue: the name is in the subscript.
  if (h0El) {
    h0El.innerHTML = categories.map((c, i) =>
      `<span class="gof-h0-term" style="--band:${BAND_FILLS[i % BAND_FILLS.length]}"`
      + `>p<sub>${esc(c)}</sub> = ${formatStat(p0[i], 4)}</span>`).join(', ');
  }
  if (hypBox) hypBox.hidden = false;
  if (resultDiv) resultDiv.innerHTML = '<p class="hint">Data loaded. Draw simulated samples to build the null distribution.</p>';
  // The observed counts are no longer in the strip (see index.html).
  if (mechObservedChisq) mechObservedChisq.textContent = formatStat(observedChisq, 2);

  // The strip opens as soon as there is data, with the observed panel already
  // drawn — not on the first +1. A student who loads data should see what is
  // about to be drawn from before they draw from it. (Todd's idea, via Jeff,
  // 2026-10-03.) The copy in the generate path stays as the fallback; it is a
  // no-op once this has run.
  if (!mechanismInitialized && mechanismStrip) {
    mechanismInitialized = true;
    mechanismStrip.hidden = false;
    initMechanismCollapse(mechanismStrip);
    initStripToggle();
  }
  setPageTitle(baseTitle, currentSourceName, { n: totalN });

  if (plotOnly && !plotOnlyRan) {
    plotOnlyRan = true;
    const bigBtn = autoRunButton(genBtns);
    requestAnimationFrame(() => bigBtn && bigBtn.click());
  }
  setTimeout(() => {
    const target = document.getElementById('controls');
    if (target && !plotOnly) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
  announce(`Data loaded: ${categories.length} categories, n = ${totalN}, observed χ² = ${formatStat(observedChisq, 2)}.`);
}

/**
 * Step 1 and Step 2, painted for whichever sample is being shown.
 *
 * Both views use the SAME board and the SAME table — only the counts differ.
 * That is the point of the toggle Jeff asked for (2026-10-30: "a toggle in
 * Step 1 that can show the orginal observed sample and the connected table and
 * a purple dot that flies to the observed value"): the reader watches one
 * apparatus run twice, once on a sample from H₀ and once on their own data,
 * and the comparison the p-value makes becomes a thing they have seen rather
 * than a number they are told.
 *
 * The bands never change. They are H₀, and H₀ is the same whichever sample is
 * scattered on it — which is exactly why the observed sample looks wrong on
 * them when it does.
 *
 * @param {boolean} [latest] - mark this as the newest draw
 * @param {boolean} [animate] - a rain and a tally flight are about to run, so
 *   the numbers they deliver are rendered held back
 * @returns {{ dartEls: SVGCircleElement[] }|null} the board, for the dart rain
 */
function paintStrip(latest = false, animate = false) {
  const preview = previewIndex != null ? allSamples[previewIndex] : null;
  const showObserved = stripMode === 'observed' && !preview;
  const counts = preview || (showObserved ? observed : lastSimSample);
  if (!counts?.length) return null;

  /** @type {{ dartEls: SVGCircleElement[] }|null} */ let board = null;
  if (mechNullBoard) {
    // Its own RNG, seeded from the page seed — the dart positions are
    // decoration and must not consume the stream the STATISTICS come from, or
    // the numbers would move. Same reason `renderEmptyChart` uses a separate
    // `presim-` generator in sim-app. The observed view gets its own stream
    // name so its scatter is stable no matter how many simulations have run.
    // A preview re-seeds from its own position in the run, which is the stream
    // name that draw used when it was live (`allStats.length` was index + 1
    // then). So hovering a dot brings back exactly the board that was on screen
    // when that sample was taken, rather than a fresh scatter of the same counts.
    const boardRng = createRng(
      preview ? `darts-${seed}-${previewIndex + 1}`
        : showObserved ? `obs-${seed}`
          : `darts-${seed}-${allStats.length}`);
    board = renderNullBoard(mechNullBoard, {
      categories, props: p0, counts, rand: boardRng,
      width: 300, height: Math.max(110, 26 * categories.length),
    });
  }
  // Held back only when something really is coming to deliver them.
  const pending = animate && !prefersReducedMotion();
  if (mechSimulated) {
    mechSimulated.innerHTML = tallyTableHTML(counts, {
      flyable: true, observed: showObserved, pending });
  }
  // A different NAME for a different entity, which is not the drift
  // `vocabulary.js` catalogues — that was one panel renaming itself while
  // holding the same thing. This panel really is holding your data now.
  setDrawHeading(preview ? `Simulation ${previewIndex + 1}`
    : showObserved ? 'Your Observed Sample'
      : (latest ? words.draw : words.drawLatest));
  if (mechanismDescEl) {
    mechanismDescEl.textContent = preview
      ? 'The sample behind the dot you are pointing at'
      : showObserved
        ? 'Your own counts, scored against the same p₀'
        : 'Draw n observations from the hypothesized distribution p₀';
    mechanismDescEl.hidden = false;
  }
  return board;
}

/**
 * Rename Step 2, in whichever heading is on screen.
 *
 * In a tier layout the panel's own `.mechanism-title` is hidden and the tier's
 * STEP heading says it instead — but that heading is written ONCE, when the
 * layout is built, so renaming the inner one left "This Simulation" standing
 * over a table of the reader's own counts. The caption underneath HAD changed,
 * which made the disagreement worse rather than better.
 *
 * @param {string} text
 */
function setDrawHeading(text) {
  if (simTitleEl) simTitleEl.textContent = text;
  const head = document.querySelector('.mech-tier--draw .mech-tier-head');
  if (!head) return;
  // Replace the heading's own words, keeping the STEP tag element (and any
  // control sitting in the row) exactly where they are.
  for (const n of head.childNodes) {
    if (n.nodeType === Node.TEXT_NODE && n.textContent.trim()) { n.textContent = text; return; }
  }
  head.appendChild(document.createTextNode(text));
}

/**
 * The observed χ², flying to its marker on the null distribution.
 *
 * `animateDropToChart` cannot do this one: it aims at the newest SIMULATED
 * value, which it finds by looking for the chart's orange highlight. The
 * observed statistic is a fixed purple line, and the whole point of the flight
 * is that your data lands somewhere specific in a distribution that was built
 * without it.
 */
function flyObservedToMarker() {
  if (prefersReducedMotion() || !chartContainer) return;
  const svg = chartContainer.querySelector('svg');
  const source = document.querySelector('[data-chi-cell]');
  // The purple overlay line IS the observed marker; see js/histogram.js, which
  // draws it with chart-utils' STAT_OBSERVED.
  const marker = svg?.querySelector('.overlays line[stroke="#7B2D8E"]');
  if (!svg || !source || !marker) return;

  const from = source.getBoundingClientRect();
  const to = marker.getBoundingClientRect();
  if (!from.width || !to.height) return;

  const dot = document.createElement('span');
  dot.className = 'gof-observed-flyer';
  dot.style.left = `${from.left + from.width / 2}px`;
  dot.style.top = `${from.top + from.height / 2}px`;
  document.body.appendChild(dot);

  const dx = (to.left + to.width / 2) - (from.left + from.width / 2);
  const dy = (to.top + to.height * 0.75) - (from.top + from.height / 2);
  dot.animate([
    { transform: 'translate(0,0) scale(0.6)', opacity: 0 },
    { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 26}px) scale(1)`, opacity: 1, offset: 0.5 },
    { transform: `translate(${dx}px, ${dy}px) scale(1)`, opacity: 1 },
  ], { duration: 620, easing: 'cubic-bezier(.4,0,.3,1)' }).onfinish = () => {
    dot.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220 }).onfinish = () => dot.remove();
  };
}

/**
 * Point at a dot; see the sample it came from.
 *
 * Jeff, 2026-10-30: "when we hover over a dot in the sampling distribution, it
 * should show the associated sample." The distribution is a thousand samples
 * compressed into a thousand positions, and this is the one move that takes a
 * position back apart — the dot in the right tail stops being "a big value"
 * and becomes a specific sample with a specific category over-represented.
 *
 * The dotplot already gives every circle a `data-stat-index`, which is its
 * place in the values array and therefore in `allStats` — `computeDots` maps
 * without sorting, so the two stay aligned. `attachTooltip` has also already
 * made each circle focusable, so wiring `focusin` alongside `mouseenter`
 * reaches the same feature from the keyboard at no extra cost.
 *
 * Only dots. Past DOTPLOT_AUTO_THRESHOLD the chart is a histogram, where a bar
 * is a bin of many draws and there is no single sample to show.
 */
function wireSamplePreview() {
  const svg = chartContainer?.querySelector('svg');
  if (!svg) return;
  for (const c of svg.querySelectorAll('circle[data-stat-index]')) {
    const i = Number(c.getAttribute('data-stat-index'));
    const sample = allSamples[i];
    if (!sample) continue;

    // Say it in the label too. A reader on a screen reader cannot hover, and
    // the strip changing underneath is a visual side effect they would never
    // learn about; the counts belong on the dot itself.
    const parts = categories.map((cat, k) => `${cat} ${sample[k]}`).join(', ');
    c.setAttribute('aria-label',
      `${c.getAttribute('aria-label') || ''} — sample ${i + 1}: ${parts}`.trim());

    c.addEventListener('mouseenter', () => showPreview(i));
    c.addEventListener('focusin', () => showPreview(i));
    c.addEventListener('mouseleave', endPreview);
    c.addEventListener('focusout', endPreview);
  }
}

/** @param {number} i */
function showPreview(i) {
  if (previewIndex === i) return;
  previewIndex = i;
  paintStrip();
  mechanismStrip?.classList.add('mech-previewing');
}

function endPreview() {
  if (previewIndex == null) return;
  previewIndex = null;
  paintStrip();
  mechanismStrip?.classList.remove('mech-previewing');
}

/** Show the observed sample, or the latest simulated one, in the strip. */
function setStripMode(mode) {
  if (mode === stripMode) return;
  stripMode = mode;
  syncStripToggle();
  const board = paintStrip(false, mode === 'observed');
  if (mode !== 'observed') return;
  announce('Showing your observed sample, scored against the hypothesized distribution.');
  const rain = createRng(`obsrain-${seed}`);
  rainDarts(board?.dartEls ?? [], {
    rand: rain,
    onDone: () => flyBandsToTally({
      board: mechNullBoard?.querySelector('.null-board') ?? null,
      table: mechSimulated,
      onDone: flyObservedToMarker,
    }),
  });
}

/** Reflect `stripMode` on the two toggle buttons. */
function syncStripToggle() {
  if (!stripToggleBtns) return;
  for (const b of stripToggleBtns) {
    b.setAttribute('aria-pressed', String(b.dataset.view === stripMode));
  }
}

/**
 * The toggle itself, in the Step 1 heading — the same seg-control the one-mean
 * page puts there, at the far end of the title rather than on a row below it.
 */
function initStripToggle() {
  if (stripToggleBtns) return;
  // WHERE the heading is depends on the layout, and getting this wrong makes
  // the control invisible rather than misplaced.
  //
  // `?layout=tiers|split` (js/mechanisms/layout.js) lifts each panel into a
  // tier with its own STEP heading and sets the panel's inner
  // `.mechanism-title` to `hidden`, because the tier head now says it. This
  // function runs later — on data load — so appending to that inner title put
  // the toggle inside a hidden element: present in the DOM, 0×0 on screen, and
  // invisible in every layout but the default one. (Jeff, 2026-10-31, with a
  // screenshot of the split layout: "I can't find the toggle anywhere.")
  const tierHead = document.querySelector('.mech-tier--source .mech-tier-head');
  const titleEl = tierHead
    || document.querySelector('#mechanism-strip .mechanism-panel[data-entity="source"] .mechanism-title');
  if (!titleEl) return;
  const wrap = document.createElement('div');
  // `--inline`: beside the heading text, not at the panel's far right. The
  // shared rule floats this control to the panel's top-right corner, which
  // works where the panel's content fills it — here the board is 300px inside
  // a 490px panel, so the toggle sat alone in the gap between Step 1 and Step 2
  // and did not read as belonging to either. (Jeff, 2026-10-30: "I'm not
  // seeing a step 1 heading.")
  wrap.className = 'seg-control mech-null-toggle mech-null-toggle--inline';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'Scatter a simulated sample or your own data on the null');
  wrap.innerHTML =
    '<button type="button" data-view="sim" aria-pressed="true">Simulated</button>'
    + '<button type="button" data-view="observed" aria-pressed="false">Your data</button>';
  titleEl.appendChild(wrap);
  stripToggleBtns = wrap.querySelectorAll('button');
  for (const b of stripToggleBtns) {
    b.addEventListener('click', () => setStripMode(b.dataset.view === 'observed' ? 'observed' : 'sim'));
  }
}

/**
 * Mini horizontal bars per category (shared scale across observed + expected),
 * with a dashed marker at the expected count so deviation from H₀ is visible.
 * @param {number[]} counts
 */
/**
 * Step 2: the tally this draw produced, and what it costs.
 *
 * Todd Will's four columns — category, observed, expected, (o−e)²/e — with the
 * total that IS χ². Replacing the bar chart was the point: χ² used to arrive as
 * a number with nothing connecting it to the counts above it, so a reader could
 * not see that one category was carrying the whole statistic while another
 * contributed nothing. On `jury`, 5.89 is White 0.25 against Black 2.37,
 * Hispanic 1.94 and Other 1.34 — the dataset's actual story.
 *
 * The count column is headed "Simulated (o)" in the simulation view, not
 * "Observed": the data-entry table at the top of this same page has an
 * "Observed" column holding the REAL counts, and two columns on one screen
 * under one word, holding different numbers, is the collision
 * `js/mechanisms/vocabulary.js` exists to catch. The letters also make the
 * third column self-explaining.
 *
 * In the OBSERVED view the same table is run on the data's own counts, where
 * "Observed (o)" is then the honest heading because it is the only count on
 * screen. The two views share this function deliberately: the reader is being
 * shown that one arithmetic is applied to both, and a separate renderer would
 * eventually drift into looking like a different calculation.
 *
 * @param {number[]} counts
 * @param {object} [opts]
 * @param {boolean} [opts.flyable] - tag the observed cells so darts can land on them
 * @param {boolean} [opts.observed] - this is the data's own sample, not a draw
 * @param {boolean} [opts.pending] - a flight is about to bring these numbers, so
 *   render them held back (see `revealPending`). Only ever true when the flight
 *   will really run: on a batch, or under reduced motion, nothing would arrive
 *   to reveal them and the table would simply stay blank.
 */
function tallyTableHTML(counts, opts = {}) {
  const chi = chiSqOf(counts);
  let html = `<table class="gof-tally${opts.observed ? ' gof-tally--observed' : ''}"><thead><tr>`
    + '<th scope="col">Category</th>'
    + `<th scope="col" class="num">${opts.observed ? 'Observed' : 'Simulated'} (o)</th>`
    + '<th scope="col" class="num">Expected (e)</th>'
    + '<th scope="col" class="num">(o\u2212e)\u00b2/e</th>'
    + '</tr></thead><tbody>';
  for (let i = 0; i < categories.length; i++) {
    const e = expected[i];
    const contrib = e > 0 ? ((counts[i] - e) ** 2) / e : 0;
    html += `<tr style="--band:${BAND_FILLS[i % BAND_FILLS.length]}">
      <th scope="row">${esc(categories[i])}</th>
      <td class="num obs"${opts.flyable ? ` data-tally-cell="${i}"` : ''}${
        opts.pending ? ` data-reveal="${counts[i]}"` : ''}>${opts.pending ? '' : counts[i]}</td>
      <td class="num exp">${e.toFixed(1)}</td>
      <td class="num con"${opts.pending ? ` data-reveal="${contrib.toFixed(2)}"` : ''}>${
        opts.pending ? '' : contrib.toFixed(2)}</td>
    </tr>`;
  }
  const totalObs = counts.reduce((a, b) => a + b, 0);
  const chiText = `\u03c7\u00b2 = ${chi.toFixed(3)}`;
  html += `</tbody><tfoot><tr>
    <th scope="row">Total</th>
    <td class="num"${opts.pending ? ` data-reveal="${totalObs}"` : ''}>${opts.pending ? '' : totalObs}</td>
    <td class="num">${expected.reduce((a, b) => a + b, 0).toFixed(0)}</td>
    <td class="num con-total" data-chi-cell${
      opts.pending ? ` data-reveal="${chiText}"` : ''}>${opts.pending ? '' : chiText}</td>
  </tr></tfoot></table>`;
  return html;
}

/** χ² for a set of counts against the page's expected counts. */
function chiSqOf(counts) {
  let t = 0;
  for (let i = 0; i < counts.length; i++) {
    const e = expected[i];
    if (e > 0) t += ((counts[i] - e) ** 2) / e;
  }
  return t;
}

// ─── Generate ───
for (const btn of genBtns) {
  btn.addEventListener('click', () => {
    if (totalN === 0) { announce('Please load data first.'); return; }
    generateSimulations(parseInt(btn.dataset.count, 10));
  });
}

/** @param {number} count */
function generateSimulations(count) {
  // No more than MAX_SIMULATIONS in total: past it the Monte-Carlo margin is
  // smaller than any digit a conclusion turns on, and a held Play button would
  // otherwise run to a million.
  {
    const cap = capBatch(allStats.length, count);
    if (cap.allowed <= 0) { applySimulationCap(genBtns, allStats.length, 'simulations'); return; }
    count = cap.allowed;
    // …and the controls go dead as the last batch lands.
    if (cap.atCap) queueMicrotask(() => applySimulationCap(genBtns, allStats.length, 'simulations'));
  }
  if (!rng) rng = createRng(seed);
  if (!mechanismInitialized && mechanismStrip) {
    mechanismInitialized = true;
    mechanismStrip.hidden = false;
    initMechanismCollapse(mechanismStrip);
    initStripToggle();
  }
  const prevLength = allStats.length;

  /** @type {number[]} */ let lastSample = [];
  let lastChisq = 0;
  for (let i = 0; i < count; i++) {
    const sample = drawMultinomial(totalN, p0, rng);
    const chi2 = gofChisqStat(sample, p0);
    allStats.push(chi2);
    if (allSamples.length < DOTPLOT_AUTO_THRESHOLD) allSamples.push(sample);
    lastSample = sample;
    lastChisq = chi2;
  }

  /**
   * Draws the chart. Assigned below, once its arguments exist; the single-draw
   * animation chain finishes by calling it, so the statistic arrives in the
   * distribution at the end of the sentence rather than before it was counted.
   */
  let runChart = () => {};

  const updateMech = () => {
    // Where that sample came from: the null as a field of areas, with the
    // sample scattered across it. Its own RNG, seeded from the page seed — the
    // dart positions are decoration and must not consume the stream the
    // STATISTICS come from, or the numbers would move. Same reason
    // `renderEmptyChart` uses a separate `presim-` generator in sim-app.
    lastSimSample = lastSample;
    lastSimChisq = lastChisq;
    // Pressing +1 while looking at your own data means you want the simulation
    // back; it would be strange to draw a sample and not be shown it. The
    // BUTTONS have to follow: setting the mode without syncing them left "Your
    // data" lit above a table of simulated counts — a control lying about what
    // is on screen.
    stripMode = 'sim';
    syncStripToggle();
    const board = paintStrip(count === 1, count === 1);
    if (mechSimulatedChisq) {
      mechSimulatedChisq.textContent = formatStat(lastChisq, 2);
      mechSimulatedChisq.classList.toggle('highlight-last', count === 1);
    }

    // On a batch there is nothing to watch, and 1,000 flights would be noise.
    if (count !== 1) { runChart(); return; }

    // One draw, told in order: the darts rain onto the null, each band's tally
    // crosses to its row, and only then does the χ² leave for the distribution.
    //
    // It used to run the other way round — the chart rendered on a 150ms timer
    // while the table was still being replaced on a 200ms one, so the statistic
    // set off from the previous draw's total before this draw's had been
    // counted. Nothing asserted the order, because every test reads the settled
    // state. Chaining the phases is what makes the strip a sentence rather than
    // three things that happen to start at once.
    const dartRng = createRng(`rain-${seed}-${allStats.length}`);
    rainDarts(board?.dartEls ?? [], {
      rand: dartRng,
      onDone: () => flyBandsToTally({
        board: mechNullBoard?.querySelector('.null-board') ?? null,
        table: mechSimulated,
        onDone: () => {
          runChart();
          // The χ² flies from the TABLE's total, where it was just computed,
          // rather than from a separate line repeating it — the statistic
          // leaves the place the reader watched it add up. (Jeff, 2026-10-30.)
          const dropSource = document.querySelector('[data-chi-cell]')
            || document.getElementById('mech-simulated-chisq');
          if (dropSource && chartContainer) animateDropToChart(dropSource, chartContainer);
        },
      }),
    });
  };
  if (mechanismDescEl) {
    mechanismDescEl.textContent = 'Draw n observations from the hypothesized distribution p₀';
    mechanismDescEl.hidden = false;
  }

  const csHi = Math.max(...allStats, observedChisq) * 1.05 || 1;
  /** @type {[number,number]} */ const hlDomain = [0, csHi];
  const { bins: fullBins } = computeBins(allStats, { domain: hlDomain });
  const lockedThresholds = fullBins.slice(1).map(b => b.x0);
  const { hlIndex, hlIndices, prevBinCounts } = computeHighlights(
    allStats, prevLength, count, computeBins, { domain: hlDomain, thresholds: lockedThresholds });
  const { pValue, extremeCount } = computePValue(allStats, observedChisq);
  displayResults(allStats, observedChisq, pValue, extremeCount);

  runChart = () => renderChart(
    allStats, observedChisq, hlIndex, hlIndices, prevBinCounts, hlDomain, lockedThresholds);
  if (count === 1) {
    setTimeout(updateMech, 200);
  } else {
    updateMech();
  }
  if (resetBtn) resetBtn.hidden = false;
  announce(`Generated ${count} sample${count > 1 ? 's' : ''}. Total: ${allStats.length}`);
}

// ─── Chart ───
/**
 * @param {number[]} stats @param {number} observedStat @param {number} [highlightIndex]
 * @param {Set<number>} [highlightIndices] @param {number[]} [prevBinCounts]
 * @param {[number,number]} [hlDomain] @param {number[]} [hlThresholds]
 */
function renderChart(stats, observedStat, highlightIndex = -1, highlightIndices, prevBinCounts, hlDomain, hlThresholds) {
  if (!chartContainer) return;
  const hi = Math.max(...stats, observedStat) * 1.05 || 1;
  /** @type {[number,number]} */ const domain = hlDomain || [0, hi];
  const { pValue } = stats.length > 0 ? computePValue(stats, observedStat) : { pValue: 0 };
  renderSimChart(chartContainer, stats, {
    chartType: resolveChartType(stats.length, 'auto'),
    id: 'sim-chart',
    xLabel: 'Chi-Square Statistic (χ²)',
    // Match the page's own readout: formatStat(observedChisq, 2) = 3 decimals.
    precision: 3,
    titleText: words.distribution,
    observedStat,
    direction: 'right',
    domain,
    highlightIndex,
    highlightIndices,
    prevBinCounts,
    thresholds: hlThresholds,
    regionPredicate: showReadout ? undefined : () => false,
    pillMode: (showReadout && stats.length > 0) ? 'randomization' : undefined,
    pValue,
  });
  // renderSimChart rebuilds the SVG, so every circle is a new element and the
  // previous listeners went with the nodes they were on. Re-wire, don't leak.
  wireSamplePreview();
}

/** @param {number[]} stats @param {number} observedStat */
function computePValue(stats, observedStat) {
  let extremeCount = 0;
  for (const s of stats) if (s >= observedStat) extremeCount++;
  return { pValue: stats.length ? extremeCount / stats.length : 0, extremeCount };
}

/** @param {number[]} stats @param {number} observedStat @param {number} pValue @param {number} extremeCount */
function displayResults(stats, observedStat, pValue, extremeCount) {
  let strength;
  if (pValue < 0.01) strength = 'very strong';
  else if (pValue < 0.05) strength = 'strong';
  else if (pValue < 0.10) strength = 'moderate';
  else strength = 'little';
  const claim = datasetContext.nullClaim || 'the data follow the hypothesized distribution';
  if (resultDiv) {
    resultDiv.innerHTML = `
      <p><strong>Null Distribution</strong> (${stats.length} simulations)</p>
      <p>Observed χ² = ${formatStat(observedStat, 2)}</p>
      ${showReadout ? `
      <p>Extreme count: ${extremeCount} of ${stats.length} (right-tail)</p>
      <p><strong>p-value:</strong> ${formatStat(pValue, 0, 'pvalue')}</p>
      <p class="interpretation">${extremeCount} of ${stats.length} samples drawn under H₀ had χ² ≥ ${formatStat(observedStat, 2)}. This provides ${strength} evidence against H₀: ${esc(claim)}.</p>` : `
      <p class="reasoning-prompt"><strong>Estimate the p-value yourself.</strong> The observed χ² is marked on the distribution — hover the bars to count how many of the ${stats.length} simulated samples have χ² at least as large.</p>`}
    `;
  }
}

// ─── Reset ───
if (resetBtn) resetBtn.addEventListener('click', () => { resetSimulation(); announce('Simulation reset.'); });
function resetSimulation() {
  // Starting again lifts the cap.
  applySimulationCap(genBtns, 0, 'simulations');
  allStats = [];
  allSamples = [];
  previewIndex = null;
  rng = null;
  mechanismInitialized = false;
  seed = urlSeed || Math.random().toString(36).slice(2, 10);
  if (chartContainer) chartContainer.innerHTML = '';
  if (resultDiv) resultDiv.innerHTML = `<p class="placeholder">${getTabHintText(getActiveTabId(), 'draw samples to see results')}</p>`;
  if (resetBtn) resetBtn.hidden = true;
  if (mechanismStrip) mechanismStrip.hidden = true;
}
