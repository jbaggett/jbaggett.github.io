// @ts-check
/**
 * Confidence Interval for a Proportion — page controller.
 *
 * Sister page to the one-proportion z-test: this page is about ESTIMATION only.
 * The student picks a confidence level (box, preset pills, or by dragging the
 * critical values on a standard normal curve), the figure shows where z* comes
 * from (middle (1−α) shaded, α/2 in each tail), and the results box shows the
 * Wald interval p̂ ± z*·√(p̂(1−p̂)/n).
 *
 * No hypotheses, no p-value — that lives on the companion z-test page.
 */

import * as jstat from 'jstat';
import { setJStat, pdfNormal, normalCDF, normalInv } from '../../../js/distributions.js';
import { computeDomain } from '../../../js/curve.js';
import { mountCriticalValueFigure } from '../../../js/critical-value-figure.js';
import { initTabs, initDataPanel, announce, initHelp, getActiveTabId, getTabHintText, buildSimLink, setPageTitle } from '../../../js/page-utils.js';
import { formatStat } from '../../../js/stats.js';
import { findContext } from '../../../js/conclusions.js';
import { linkFormula } from '../../../js/formula-link.js';

initHelp();

import { tex } from '../../../js/tex.js';

setJStat(jstat.default || jstat);

const baseTitle = document.title.replace(/\s*\|\s*StatLens$/, '');

// ── DOM references ─────────────────────────────────────────────────
const controlsSection = /** @type {HTMLElement} */ (document.getElementById('controls'));
const chartAndResults = /** @type {HTMLElement} */ (document.getElementById('chart-and-results'));
const chartContainer = /** @type {HTMLElement} */ (document.getElementById('chart-container'));
const resultsPanel = /** @type {HTMLElement} */ (document.getElementById('results-panel'));
const conditionsCheckpoint = /** @type {HTMLElement} */ (document.getElementById('conditions-checkpoint'));

const inputConf = /** @type {HTMLInputElement} */ (document.getElementById('input-conf'));
const confPills = /** @type {HTMLElement} */ (document.querySelector('.conf-pills'));

const inputSuccesses = /** @type {HTMLInputElement} */ (document.getElementById('input-successes'));
const inputN = /** @type {HTMLInputElement} */ (document.getElementById('input-n'));
const inputSuccessLabel = /** @type {HTMLInputElement} */ (document.getElementById('input-success-label'));

const variableSelector = document.getElementById('variable-selector');
const varSelect = /** @type {HTMLSelectElement|null} */ (document.getElementById('var-select'));
const successSelector = document.getElementById('success-selector');
const successOutcome = /** @type {HTMLSelectElement|null} */ (document.getElementById('success-outcome'));
const dataPreview = document.getElementById('data-preview');
const dataSummary = document.getElementById('data-summary');

// ── State ──────────────────────────────────────────────────────────
let currentSuccesses = 0;
let currentN = 0;
let currentSuccessLabel = '';

/** @type {import('../../../js/conclusions.js').ConclusionContext|null} */
let currentContext = null;

/** Current confidence level (proportion, e.g. 0.95). */
let confLevel = 0.95;

/** @type {ReturnType<typeof mountCriticalValueFigure> | null} */
let figure = null;

const MIN_CONF = 0.50;
const MAX_CONF = 0.999;

initTabs({ hintTarget: resultsPanel, hintAction: 'enter data' });

// ── Data Panel ─────────────────────────────────────────────────────

const dataPanel = initDataPanel({
  autoCollapse: true, stickyControls: true, showPreview: true,
  datasetFilter: (/** @type {any} */ ds) => ds.type === 'bootstrap_prop' || ds.type === 'one_cat',
  onDataset: (ds) => {
    currentContext = findContext(ds, 'one-prop');

    const catVars = ds.variables.filter(/** @param {any} v */ v => v.type === 'categorical');
    if (catVars.length === 0) {
      announce('This dataset has no categorical variables.');
      return;
    }

    if (catVars.length > 1 && varSelect && variableSelector) {
      varSelect.innerHTML = '';
      for (const v of catVars) {
        const opt = document.createElement('option');
        opt.value = v.name;
        opt.textContent = v.label || v.name;
        varSelect.appendChild(opt);
      }
      variableSelector.hidden = false;
      varSelect.onchange = () => {
        showSuccessSelector(ds.rows.map(/** @param {any} r */ r => String(r[varSelect.value])), ds.name);
      };
    } else if (variableSelector) {
      variableSelector.hidden = true;
    }

    const varName = catVars[0].name;
    showSuccessSelector(ds.rows.map(/** @param {any} r */ r => String(r[varName])), ds.name);
  },
  onText: (parsed, sourceName) => {
    currentContext = null;
    const catIdx = parsed.types.findIndex(t => t === 'categorical');
    if (catIdx < 0) {
      announce('No categorical column found in the data.');
      return;
    }
    const colName = parsed.headers[catIdx];
    if (variableSelector) variableSelector.hidden = true;
    showSuccessSelector(parsed.data.map(row => String(row[colName])), sourceName);
  },
  onClear: () => {
    currentSuccesses = 0;
    currentN = 0;
    currentContext = null;
    figure = null;
    if (dataPreview) dataPreview.hidden = true;
    if (successSelector) successSelector.hidden = true;
    if (variableSelector) variableSelector.hidden = true;
    controlsSection.hidden = true;
    chartAndResults.hidden = true;
    conditionsCheckpoint.hidden = true;
    chartContainer.innerHTML = '';
    resultsPanel.innerHTML = `<p class="placeholder">${getTabHintText(getActiveTabId(), 'enter data')}</p>`;
    announce('Data cleared.');
  },
});

/**
 * Show the success-outcome selector and count the chosen category.
 * @param {string[]} values
 * @param {string} sourceName
 */
function showSuccessSelector(values, sourceName) {
  const categories = [...new Set(values)];
  if (!successOutcome || !successSelector) return;

  successOutcome.innerHTML = '';
  for (const cat of categories) {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    successOutcome.appendChild(opt);
  }
  successSelector.hidden = false;

  const selected = (currentContext?.successLabel && categories.includes(currentContext.successLabel))
    ? currentContext.successLabel : categories[0];
  successOutcome.value = selected;
  countAndBuild(values, selected, sourceName);

  // .onchange (not addEventListener) so re-loading a dataset doesn't stack listeners.
  successOutcome.onchange = () => countAndBuild(values, successOutcome.value, sourceName);
}

/**
 * @param {string[]} values
 * @param {string} successValue
 * @param {string} sourceName
 */
function countAndBuild(values, successValue, sourceName) {
  currentN = values.length;
  currentSuccesses = values.filter(v => v === successValue).length;
  currentSuccessLabel = successValue;

  const pHat = formatStat(currentSuccesses / currentN, 0, 'proportion');
  if (dataSummary) {
    dataSummary.textContent = `${sourceName}: n = ${currentN}, ${successValue} = ${currentSuccesses} (p̂ = ${pHat})`;
  }
  build();
  announce(`Loaded ${currentN} observations. ${currentSuccesses} "${successValue}" (p̂ = ${pHat}).`);
}

// ── Summary input ──────────────────────────────────────────────────
function summaryActive() {
  return document.getElementById('tab-summary')?.getAttribute('aria-selected') === 'true';
}

/**
 * Read + validate the summary fields. No separate "Load" step.
 * @param {boolean} [quiet]
 * @returns {boolean}
 */
function applySummaryInputs(quiet) {
  const successes = Math.round(Number(inputSuccesses.value));
  const n = Math.round(Number(inputN.value));
  const fail = (/** @type {string} */ msg) => { if (!quiet) announce(msg); return false; };
  if (!Number.isFinite(n) || n < 1) return fail('Sample size must be at least 1.');
  if (!Number.isFinite(successes) || successes < 0 || successes > n) return fail('Successes must be between 0 and n.');

  currentSuccesses = successes;
  currentN = n;
  currentSuccessLabel = inputSuccessLabel.value.trim() || 'successes';
  currentContext = null;
  if (successSelector) successSelector.hidden = true;
  if (variableSelector) variableSelector.hidden = true;
  if (dataSummary) {
    dataSummary.textContent = `Summary: n = ${currentN}, ${currentSuccessLabel} = ${currentSuccesses} (p̂ = ${formatStat(currentSuccesses / currentN, 0, 'proportion')})`;
  }
  return true;
}

for (const el of [inputSuccesses, inputN, inputSuccessLabel]) {
  el.addEventListener('input', () => { if (summaryActive() && applySummaryInputs(true)) build(); });
}

// ── Core ───────────────────────────────────────────────────────────

/** Full (re)build — mount the figure and render the interval. */
function build() {
  if (currentN < 1) return;

  controlsSection.hidden = false;
  chartAndResults.hidden = false;

  // The sampling distribution of p̂ is approximately normal, so the critical value
  // comes off the standard normal curve — the same picture for every proportion.
  figure = mountCriticalValueFigure(chartContainer, {
    pdfFn: (x) => pdfNormal(x, 0, 1),
    cdfFn: (x) => normalCDF(x, 0, 1),
    invFn: (p) => normalInv(p, 0, 1),
    domain: computeDomain('normal', { mu: 0, sigma: 1 }),
    center: 0,
    level: confLevel,
    minLevel: MIN_CONF,
    maxLevel: MAX_CONF,
    xLabel: 'z',
    title: 'Standard Normal Distribution',
    desc: 'Standard normal curve. The middle region between the critical values ±z* is shaded; its area equals the confidence level. Drag a critical value to change the level.',
    id: 'ci-z-chart',
    filename: 'confidence-interval-proportion.png',
    critSymbol: 'z*',
    confInput: inputConf,
    confPills,
    onChange: onFigureChange,
  });

  renderResults(figure.getCrit());
  showConditionsCheckpoint();
  setPageTitle(baseTitle, dataPanel.currentSourceName, { n: currentN });
}

/** The figure reports a new level (box, pill, drag, or an edited label). */
function onFigureChange(/** @type {number} */ level, /** @type {number} */ zStar) {
  confLevel = level;
  renderResults(zStar);
}

/**
 * Render the confidence-interval results panel.
 * @param {number} zStar
 */
function renderResults(zStar) {
  const n = currentN;
  const pHat = currentSuccesses / n;
  const se = Math.sqrt(pHat * (1 - pHat) / n);
  const margin = zStar * se;
  const lower = Math.max(0, pHat - margin);
  const upper = Math.min(1, pHat + margin);
  const confPct = (confLevel * 100 % 1) ? (confLevel * 100).toFixed(1) : (confLevel * 100).toFixed(0);
  const p = (/** @type {number} */ v) => formatStat(v, 0, 'proportion');

  const V = '\\textcolor{#569BBD}';
  const P = '\\textcolor{#2e7d32}';
  const fx = (/** @type {string} */ key, /** @type {string|number} */ val) =>
    `\\htmlClass{fx-val fx-${key}}{${V}{${val}}}`;
  const fxs = (/** @type {string} */ key, /** @type {string} */ latex) =>
    `\\htmlClass{fx-val fx-${key}}{${latex}}`;

  const ciFormula = tex(`\\begin{aligned}
    &${fxs('phat', '\\hat{p}')} \\pm z^{\\!*} \\cdot \\sqrt{\\frac{${fxs('phat', '\\hat{p}')}(1 - ${fxs('phat', '\\hat{p}')})}{${fxs('n', 'n')}}} \\\\[8pt]
    &${fx('phat', p(pHat))} \\pm ${V}{${zStar.toFixed(3)}} \\cdot \\sqrt{\\frac{${fx('phat', p(pHat))}(1 - ${fx('phat', p(pHat))})}{${fx('n', n)}}} \\\\[8pt]
    &= ${fx('phat', p(pHat))} \\pm ${V}{${p(margin)}} \\\\[8pt]
    &= ${P}{(${p(lower)},\\; ${p(upper)})}
  \\end{aligned}`, true);

  // Dataset contexts already read as "the true survival rate for …", so no extra article.
  const paramLabel = currentContext?.parameter || 'the population proportion';

  resultsPanel.innerHTML = `
    <h3>Sample Summary</h3>
    <table class="results-table" aria-label="Sample summary">
      <tbody>
        <tr><th scope="row">${tex('n')}</th><td data-fx="n">${n}</td></tr>
        <tr><th scope="row">${escapeHTML(currentSuccessLabel)}</th><td>${currentSuccesses}</td></tr>
        <tr><th scope="row">${tex('\\hat{p}')}</th><td data-fx="phat">${p(pHat)}</td></tr>
        <tr><th scope="row">${tex('SE')}</th><td>${p(se)}</td></tr>
      </tbody>
    </table>

    <div class="formula-display formula-ci">
      <h3>${confPct}% Confidence Interval</h3>
      ${ciFormula}
      <p class="formula-detail">${tex(`z^{\\!*} = ${P}{${zStar.toFixed(3)}}`)} &nbsp;·&nbsp; ${tex(`\\text{margin of error} = ${P}{${p(margin)}}`)}</p>
    </div>

    <div class="ci-result-headline" aria-live="polite">
      <span class="ci-bounds">(${p(lower)}, ${p(upper)})</span>
    </div>

    <div class="interpretation" aria-live="polite">
      <p>We are <strong>${confPct}%</strong> confident that ${paramLabel} is
        between <strong>${p(lower)}</strong> and <strong>${p(upper)}</strong>.</p>
      <p class="hint">Raise the confidence level and the interval grows; lower it and the interval shrinks —
        the critical value <em>z*</em> on the plot is what sets the width.</p>
    </div>
  `;

  linkFormula(document.querySelector('main') || resultsPanel);
}

// ── Conditions checkpoint ──────────────────────────────────────────
function showConditionsCheckpoint() {
  if (!conditionsCheckpoint) return;

  const successes = currentSuccesses;
  const failures = currentN - currentSuccesses;
  const ok = successes >= 10 && failures >= 10;

  const dsId = dataPanel.currentDatasetId;
  const bootLink = dsId
    ? buildSimLink('simulate/bootstrap-prop/', { dataset: dsId })
    : buildSimLink('simulate/bootstrap-prop/');

  conditionsCheckpoint.innerHTML = `
    <p><strong>Before interpreting:</strong> the normal approximation needs at least 10 successes and
    10 failures. Here there are <strong>${successes}</strong> successes and <strong>${failures}</strong>
    failures — ${ok ? 'both are at least 10.' : '<strong>not both are at least 10</strong>, so this interval may be unreliable.'}</p>
    <p>Simulation alternative: <a href="${bootLink}">Bootstrap CI</a> (no normal approximation required).</p>`;
  conditionsCheckpoint.hidden = false;
}

// ── Helpers ────────────────────────────────────────────────────────

/**
 * @param {string} str
 * @returns {string}
 */
function escapeHTML(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
