// @ts-check
/**
 * Chi-Square Goodness-of-Fit Simulation page.
 * Draws repeated multinomial samples of size n from a hypothesized distribution
 * p₀, computes the χ² goodness-of-fit statistic for each, and builds the null
 * distribution. The observed χ² is marked; the p-value is the right-tail fraction.
 */

import { createRng, sampleMultinomial } from '../../js/prng.js';
import { gofChisqStat, formatStat } from '../../js/stats.js';
import { computeBins } from '../../js/histogram.js';
import { loadDatasetIndex, dataPath, announce, initTabs, initKeyboardShortcuts, initPlayPause, initMechanismCollapse, computeHighlights, animateDropToChart, flyDataStream, createExpertToggle, getActiveTabId, getTabHintText, setPageTitle } from '../../js/page-utils.js';
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
const mechObserved = document.getElementById('mech-observed');
const mechSimulated = document.getElementById('mech-simulated');
const mechObservedChisq = document.getElementById('mech-observed-chisq');
const mechSimulatedChisq = document.getElementById('mech-simulated-chisq');
const mechanismDescEl = document.getElementById('mechanism-description');
const simTitleEl = document.getElementById('sim-title');
const controlsSection = document.getElementById('controls');
const genBtns = /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('.gen-btn'));

const generateBar = /** @type {HTMLElement|null} */ (controlsSection?.querySelector('.generate-bar'));
if (generateBar) createExpertToggle(generateBar);

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
    const resp = await fetch(dataPath(`${id}.json`));
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    loadDataset(await resp.json());
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
  if (dataSummary) {
    const namePrefix = currentSourceName ? `${currentSourceName}: ` : '';
    dataSummary.textContent = `${namePrefix}${categories.length} categories, n = ${totalN}, observed χ² = ${formatStat(observedChisq, 2)}`;
  }
  for (const btn of genBtns) btn.disabled = false;
  if (resultDiv) resultDiv.innerHTML = '<p class="hint">Data loaded. Draw simulated samples to build the null distribution.</p>';
  if (mechObserved) mechObserved.innerHTML = miniBarsHTML(observed);
  if (mechObservedChisq) mechObservedChisq.textContent = formatStat(observedChisq, 2);
  setPageTitle(baseTitle, currentSourceName, { n: totalN });

  if (plotOnly && !plotOnlyRan) {
    plotOnlyRan = true;
    const bigBtn = genBtns[genBtns.length - 1];
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
function miniBarsHTML(counts) {
  const maxVal = Math.max(...counts, ...expected, 1);
  let html = '<div class="gof-bars">';
  for (let i = 0; i < categories.length; i++) {
    const w = (counts[i] / maxVal) * 100;
    const ew = (expected[i] / maxVal) * 100;
    html += `<div class="gof-bar-row">
      <span class="gof-bar-cat" title="${esc(categories[i])}">${esc(categories[i])}</span>
      <span class="gof-bar-track"><span class="gof-bar-fill" style="width:${w.toFixed(1)}%"></span><span class="gof-bar-exp" style="left:${ew.toFixed(1)}%" title="expected ${expected[i].toFixed(1)}"></span></span>
      <span class="gof-bar-val">${counts[i]}</span>
    </div>`;
  }
  return html + '</div>';
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
  if (!rng) rng = createRng(seed);
  if (!mechanismInitialized && mechanismStrip) {
    mechanismInitialized = true;
    mechanismStrip.hidden = false;
    initMechanismCollapse(mechanismStrip);
  }
  const prevLength = allStats.length;
  if (simTitleEl) simTitleEl.innerHTML = (count === 1 ? 'This' : 'Last') + ' Sample under H<sub>0</sub>';

  /** @type {number[]} */ let lastSample = [];
  let lastChisq = 0;
  for (let i = 0; i < count; i++) {
    const sample = sampleMultinomial(totalN, p0, rng);
    const chi2 = gofChisqStat(sample, p0);
    allStats.push(chi2);
    lastSample = sample;
    lastChisq = chi2;
  }

  if (count === 1 && mechObserved && mechSimulated) flyDataStream(mechObserved, mechSimulated);
  const updateMech = () => {
    if (mechSimulated) mechSimulated.innerHTML = miniBarsHTML(lastSample);
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
      const dropSource = document.getElementById('mech-simulated-chisq');
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
    titleText: 'Null Distribution',
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
  allStats = [];
  rng = null;
  mechanismInitialized = false;
  seed = urlSeed || Math.random().toString(36).slice(2, 10);
  if (chartContainer) chartContainer.innerHTML = '';
  if (resultDiv) resultDiv.innerHTML = `<p class="placeholder">${getTabHintText(getActiveTabId(), 'draw samples to see results')}</p>`;
  if (resetBtn) resetBtn.hidden = true;
  if (mechanismStrip) mechanismStrip.hidden = true;
}
