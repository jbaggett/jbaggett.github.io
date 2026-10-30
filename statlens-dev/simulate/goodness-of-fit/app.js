// @ts-check
/**
 * Chi-Square Goodness-of-Fit Simulation page.
 * Draws repeated multinomial samples of size n from a hypothesized distribution
 * p₀, computes the χ² goodness-of-fit statistic for each, and builds the null
 * distribution. The observed χ² is marked; the p-value is the right-tail fraction.
 */

import { createRng } from '../../js/prng.js';
import { renderNullBoard, BAND_FILLS, flyBandsToTally } from '../../js/mechanisms/null-board.js';
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
import { renderSimChart, resolveChartType } from '../../js/chart-defaults.js';

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
let totalN = 0;
let currentSourceName = '';
// The dataset behind the loaded counts, kept so the panel can collapse onto it
// the way every other page's does. Null after manual entry: there is no study
// to describe and nothing to download. (2026-10-02.)
/** @type {any} */ let currentDataset = null;
/** @type {{nullClaim?: string}} */
let datasetContext = {};

/** @type {number[]} */ let allStats = [];
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
  if (h0El) h0El.innerHTML = categories.map((c, i) => `p<sub>${esc(c)}</sub> = ${formatStat(p0[i], 4)}`).join(', ');
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
 * The count column is headed "Simulated (o)", not "Observed": the data-entry
 * table at the top of this same page has an "Observed" column holding the REAL
 * counts, and two columns on one screen under one word, holding different
 * numbers, is the collision `js/mechanisms/vocabulary.js` exists to catch. The
 * letters also make the third column self-explaining. The data's own counts are
 * not in this strip at all; they are the marker on the distribution, and the
 * results sidebar carries their decomposition.
 *
 * @param {number[]} counts
 * @param {object} [opts]
 * @param {boolean} [opts.flyable] - tag the observed cells so darts can land on them
 */
function tallyTableHTML(counts, opts = {}) {
  const chi = chiSqOf(counts);
  let html = '<table class="gof-tally"><thead><tr>'
    + '<th scope="col">Category</th>'
    + '<th scope="col" class="num">Simulated (o)</th>'
    + '<th scope="col" class="num">Expected (e)</th>'
    + '<th scope="col" class="num">(o\u2212e)\u00b2/e</th>'
    + '</tr></thead><tbody>';
  for (let i = 0; i < categories.length; i++) {
    const e = expected[i];
    const contrib = e > 0 ? ((counts[i] - e) ** 2) / e : 0;
    // Tinted by share of the total, so the category carrying χ² is findable
    // without reading every number — tint, not colour, because the number is
    // already there and colour must never be the only cue.
    const share = chi > 0 ? contrib / chi : 0;
    html += `<tr>
      <th scope="row"><span class="gof-swatch" style="background:${BAND_FILLS[i % BAND_FILLS.length]}"></span>${esc(categories[i])}</th>
      <td class="num obs"${opts.flyable ? ` data-tally-cell="${i}"` : ''}>${counts[i]}</td>
      <td class="num exp">${e.toFixed(1)}</td>
      <td class="num con" style="--share:${share.toFixed(3)}">${contrib.toFixed(2)}</td>
    </tr>`;
  }
  html += `</tbody><tfoot><tr>
    <th scope="row">Total</th>
    <td class="num">${counts.reduce((a, b) => a + b, 0)}</td>
    <td class="num">${expected.reduce((a, b) => a + b, 0).toFixed(0)}</td>
    <td class="num con-total" data-chi-cell>\u03c7\u00b2 = ${chi.toFixed(3)}</td>
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
  }
  const prevLength = allStats.length;
  // From the vocabulary module, not hardcoded: this panel shipped as
  // "This Simulation" and was then rewritten to "This Sample under H₀" on the
  // first draw — one panel, two names, which is the drift
  // `js/mechanisms/vocabulary.js` catalogues. One-prop reads the same two words
  // for the same act, and since 2026-10-30 this page declares the same kind.
  if (simTitleEl) simTitleEl.textContent = count === 1 ? words.draw : words.drawLatest;

  /** @type {number[]} */ let lastSample = [];
  let lastChisq = 0;
  for (let i = 0; i < count; i++) {
    const sample = drawMultinomial(totalN, p0, rng);
    const chi2 = gofChisqStat(sample, p0);
    allStats.push(chi2);
    lastSample = sample;
    lastChisq = chi2;
  }

  const updateMech = () => {
    // Where that sample came from: the null as a field of areas, with the
    // sample scattered across it. Its own RNG, seeded from the page seed — the
    // dart positions are decoration and must not consume the stream the
    // STATISTICS come from, or the numbers would move. Same reason
    // `renderEmptyChart` uses a separate `presim-` generator in sim-app.
    if (mechNullBoard) {
      const boardRng = createRng(`darts-${seed}-${allStats.length}`);
      renderNullBoard(mechNullBoard, {
        categories, props: p0, counts: lastSample, rand: boardRng,
        width: 300, height: Math.max(110, 26 * categories.length),
      });
    }
    if (mechSimulated) mechSimulated.innerHTML = tallyTableHTML(lastSample, { flyable: true });
    // …then carry each band's tally across to its row, on a single draw. On a
    // batch there is nothing to watch, and 1,000 flights would be noise.
    if (count === 1) {
      flyBandsToTally({
        board: mechNullBoard?.querySelector('.null-board') ?? null,
        table: mechSimulated,
      });
    }
    if (mechSimulatedChisq) {
      mechSimulatedChisq.textContent = formatStat(lastChisq, 2);
      mechSimulatedChisq.classList.toggle('highlight-last', count === 1);
    }
  };
  if (count === 1) setTimeout(updateMech, 200); else updateMech();
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

  if (count === 1) {
    setTimeout(() => {
      renderChart(allStats, observedChisq, hlIndex, hlIndices, prevBinCounts, hlDomain, lockedThresholds);
      // The χ² flies from the TABLE's total, where it was just computed, rather
      // than from a separate line repeating it — the statistic leaves the place
      // the reader watched it add up. (Jeff, 2026-10-30.)
      const dropSource = document.querySelector('[data-chi-cell]')
        || document.getElementById('mech-simulated-chisq');
      if (dropSource && chartContainer) animateDropToChart(dropSource, chartContainer);
    }, 150);
  } else {
    renderChart(allStats, observedChisq, hlIndex, hlIndices, prevBinCounts, hlDomain, lockedThresholds);
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
  rng = null;
  mechanismInitialized = false;
  seed = urlSeed || Math.random().toString(36).slice(2, 10);
  if (chartContainer) chartContainer.innerHTML = '';
  if (resultDiv) resultDiv.innerHTML = `<p class="placeholder">${getTabHintText(getActiveTabId(), 'draw samples to see results')}</p>`;
  if (resetBtn) resetBtn.hidden = true;
  if (mechanismStrip) mechanismStrip.hidden = true;
}
