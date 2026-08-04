// @ts-check
/**
 * Chi-Square Goodness-of-Fit Test (analytic).
 * Compares one categorical variable's observed counts to a hypothesized
 * distribution p₀ using the chi-square distribution: χ² = Σ(O−E)²/E,
 * df = k−1, p = right tail. Conditions checkpoint links to the simulation.
 */

import { setJStat, pdfChisq, chisqCDF, chisqInv } from '../../js/distributions.js';
import { gofChisqStat, formatStat } from '../../js/stats.js';
import { drawCurve, computeDomain } from '../../js/curve.js';
import { loadDatasetIndex, dataPath, announce, initTabs, initHelp, buildSimLink, setPageTitle, renderConditionsCheckpoint } from '../../js/page-utils.js';
import { tex } from '../../js/tex.js';

const jstatMod = await import('jstat');
setJStat(jstatMod.default || jstatMod);

// ─── DOM ───
const datasetSelect = /** @type {HTMLSelectElement} */ (document.getElementById('dataset-select'));
const datasetDesc = document.getElementById('dataset-desc');
const dataPreview = document.getElementById('data-preview');
const dataSummary = document.getElementById('data-summary');
const controlsSection = document.getElementById('controls');
const conditionsCheckpoint = document.getElementById('conditions-checkpoint');
const chartSection = document.getElementById('chart');
const chartContainer = document.getElementById('chart-container');
const resultsSection = document.getElementById('results');
const resChisq = document.getElementById('res-chisq');
const resDf = document.getElementById('res-df');
const resP = document.getElementById('res-p');
const gofTableContainer = document.getElementById('gof-table-container');
const formulaContainer = document.getElementById('formula-container');
const interpretationDiv = document.getElementById('interpretation');
const inputRowsEl = document.getElementById('gof-input-rows');
const p0SumEl = document.getElementById('p0-sum');

initTabs({});
initHelp();

// ─── State ───
/** @type {string[]} */ let categories = [];
/** @type {number[]} */ let observed = [];
/** @type {number[]} */ let p0 = [];
let currentSourceName = '';
let currentDatasetId = '';
/** @type {{parameter?: string, claim?: string, nullClaim?: string}} */
let datasetContext = {};
const baseTitle = document.title.replace(/\s*\|\s*StatLens$/, '');

/** @param {string} s */
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Dataset loading ───
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
    loadDataset(await resp.json(), id);
  } catch {
    announce('Could not load that dataset.');
  }
});

/** @param {any} ds @param {string} id */
function loadDataset(ds, id) {
  const cats = ds.categories
    || (ds.variables?.[0] ? [...new Set((ds.rows || []).map((/** @type {any} */ r) => r[ds.variables[0].name]))] : []);
  if (!cats || cats.length < 2) { announce('This dataset needs at least two categories.'); return; }
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
  currentDatasetId = id;
  datasetContext = { parameter: ds.parameter, claim: ds.claim, nullClaim: ds.nullClaim };
  applyState(cats.map(String), obs, props);
}

// ─── Manual entry ───
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
  currentSourceName = '';
  currentDatasetId = '';
  datasetContext = {};
  applyState(cats, obs, props.map(p => p / sum));
});
for (let i = 0; i < 3; i++) addInputRow();
updateP0Sum();

// ─── Compute + render ───
/** @param {string[]} cats @param {number[]} obs @param {number[]} props */
function applyState(cats, obs, props) {
  categories = cats;
  observed = obs;
  p0 = props;
  showResults();
}

function showResults() {
  const n = observed.reduce((a, b) => a + b, 0);
  const expected = p0.map(p => n * p);
  const chiSq = gofChisqStat(observed, p0);
  const df = categories.length - 1;
  const pValue = 1 - chisqCDF(chiSq, df);

  if (dataPreview) dataPreview.hidden = false;
  if (dataSummary) {
    const namePrefix = currentSourceName ? `${currentSourceName}: ` : '';
    dataSummary.textContent = `${namePrefix}${categories.length} categories, n = ${n}`;
  }
  if (controlsSection) controlsSection.hidden = false;
  if (resultsSection) resultsSection.hidden = false;
  setPageTitle(baseTitle, currentSourceName, { n });

  if (resChisq) resChisq.textContent = formatStat(chiSq, 3);
  if (resDf) resDf.textContent = String(df);
  if (resP) resP.textContent = formatStat(pValue, 0, 'pvalue');

  // Observed / Expected / contribution table (flag low expected cells).
  let low = false;
  let rows = '';
  for (let i = 0; i < categories.length; i++) {
    const e = expected[i];
    const contrib = e > 0 ? (observed[i] - e) ** 2 / e : 0;
    const lowCell = e < 5;
    if (lowCell) low = true;
    rows += `<tr><th scope="row">${esc(categories[i])}</th>`
      + `<td>${observed[i]}</td>`
      + `<td class="${lowCell ? 'low-expected' : ''}">${formatStat(e, 2)}</td>`
      + `<td>${formatStat(contrib, 3)}</td></tr>`;
  }
  if (gofTableContainer) {
    gofTableContainer.innerHTML =
      `<table class="results-table" aria-label="Observed vs expected counts">
        <thead><tr><th scope="col">Category</th><th scope="col">Observed</th><th scope="col">Expected</th><th scope="col">(O−E)²/E</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><th scope="row">Total</th><td>${n}</td><td>${formatStat(n, 2)}</td><td>${formatStat(chiSq, 3)}</td></tr></tfoot>
      </table>`;
  }

  // Conditions checkpoint → the goodness-of-fit simulation (assumption-free).
  if (conditionsCheckpoint) {
    const simLink = currentDatasetId
      ? buildSimLink('simulate/goodness-of-fit/', { dataset: currentDatasetId })
      : buildSimLink('simulate/goodness-of-fit/');
    const condNote = low
      ? ' <strong>Note: one or more expected counts are below 5</strong>, so the chi-square approximation may be unreliable — prefer the simulation.'
      : '';
    renderConditionsCheckpoint(conditionsCheckpoint, {
      altLabel: 'Goodness-of-Fit Simulation', altHref: simLink,
      detailsHTML: `<p>For the chi-square goodness-of-fit test, every expected count \\(E_i = n\\,p_{0i}\\) should be at least 5.${condNote}</p>`,
    });
  }

  // Formula.
  if (formulaContainer) {
    formulaContainer.innerHTML = `<div class="formula-display">
      <h3>Test Statistic</h3>
      ${tex(`\\chi^2 = \\sum \\frac{(O_i - E_i)^2}{E_i} = ${chiSq.toFixed(3)}`)}
      <p class="formula-detail">${tex(`\\text{df} = k - 1 = ${categories.length} - 1 = ${df}`)}</p>
      <p class="formula-detail">${tex(`\\text{p-value} = P(\\chi^2_{${df}} \\ge ${chiSq.toFixed(3)}) = ${formatStat(pValue, 0, 'pvalue')}`)}</p>
    </div>`;
    formulaContainer.hidden = false;
  }

  drawChart(chiSq, df);
  writeInterpretation(chiSq, df, pValue, low);
  announce(`χ² = ${formatStat(chiSq, 3)}, df = ${df}, p-value = ${formatStat(pValue, 0, 'pvalue')}.`);
}

/** @param {number} chiSq @param {number} df */
function drawChart(chiSq, df) {
  if (!chartContainer || !chartSection) return;
  chartSection.hidden = false;
  chartContainer.innerHTML = '';
  const pdfFn = (/** @type {number} */ x) => pdfChisq(x, df);
  const invCdf = (/** @type {number} */ p) => chisqInv(p, df);
  let domain = computeDomain('chisq', { df, invCdf });
  if (chiSq > domain[1]) domain = [0, chiSq * 1.15];
  drawCurve(chartContainer, pdfFn, domain, {
    xLabel: 'χ²',
    yLabel: 'Density',
    titleText: `Chi-square distribution (df = ${df})`,
    descText: `Chi-square curve with df = ${df}, right tail shaded at the test statistic ${chiSq.toFixed(3)}`,
    id: 'gof-chart',
    tail: 'right',
    critValue: chiSq,
  });
}

/** @param {number} chiSq @param {number} df @param {number} pValue @param {boolean} low */
function writeInterpretation(chiSq, df, pValue, low) {
  if (!interpretationDiv) return;
  const reject = pValue < 0.05;
  const claim = datasetContext.nullClaim || datasetContext.claim
    || 'the categorical variable follows the hypothesized distribution';
  const pStr = formatStat(pValue, 0, 'pvalue');
  interpretationDiv.innerHTML = `
    <p><strong>Hypotheses:</strong> ${tex('H_0')}: the proportions match the hypothesized distribution. ${tex('H_a')}: at least one proportion differs.</p>
    <p>${tex(`\\chi^2 = ${chiSq.toFixed(3)}`)} on ${df} degrees of freedom gives a p-value of <strong>${pStr}</strong>.</p>
    <p><strong>Conclusion:</strong> ${reject
      ? `At α = 0.05 we <strong>reject H₀</strong> — there is evidence that ${esc(claim)} does <em>not</em> hold. The categories with the largest (O−E)²/E contributions drive the departure.`
      : `At α = 0.05 we <strong>fail to reject H₀</strong> — the data are consistent with ${esc(claim)}.`}</p>
    ${low ? `<p class="hint">One or more expected counts are below 5; the <a href="../../simulate/goodness-of-fit/${currentDatasetId ? `?dataset=${currentDatasetId}` : ''}">simulation-based test</a> is more trustworthy here.</p>` : ''}`;
  interpretationDiv.hidden = false;
}
