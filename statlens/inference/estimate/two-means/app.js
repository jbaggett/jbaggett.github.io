// @ts-check
/**
 * Confidence Interval for a Difference in Means — page controller.
 *
 * Sister page to the two-sample t-test: this page is about ESTIMATION only.
 * The interval is Welch's: (x̄₁ − x̄₂) ± t*·SE, with the Welch degrees of freedom
 * (so the t-curve on the plot is the one the critical value actually comes from).
 *
 * No hypotheses, no p-value — that lives on the companion t-test page.
 */

import * as jstatModule from 'jstat';
import { setJStat, pdfT, tInv, tCDF } from '../../../js/distributions.js';
import { twoMeanT, twoMeanTSummary } from '../../../js/inference.js';
import { computeDomain } from '../../../js/curve.js';
import { mountCriticalValueFigure } from '../../../js/critical-value-figure.js';
import { renderConditionsDiagnostic } from '../../../js/conditions.js';
import { initTabs, initDataPanel, announce, initHelp, getActiveTabId, getTabHintText, buildSimLink, setPageTitle } from '../../../js/page-utils.js';
import { mean, detectPrecision, formatStat, sd } from '../../../js/stats.js';
import { findContext } from '../../../js/conclusions.js';
import { linkFormula } from '../../../js/formula-link.js';

initHelp();

import { tex } from '../../../js/tex.js';

const baseTitle = document.title.replace(/\s*\|\s*StatLens$/, '');

setJStat(jstatModule.default || jstatModule);

// ── DOM references ─────────────────────────────────────────────────
const controlsSection = /** @type {HTMLElement} */ (document.getElementById('controls'));
const chartAndResults = /** @type {HTMLElement} */ (document.getElementById('chart-and-results'));
const chartContainer = /** @type {HTMLElement} */ (document.getElementById('chart-container'));
const resultsPanel = /** @type {HTMLElement} */ (document.getElementById('results-panel'));
const conditionsCheckpoint = /** @type {HTMLElement} */ (document.getElementById('conditions-checkpoint'));

const inputConf = /** @type {HTMLInputElement} */ (document.getElementById('input-conf'));
const confPills = /** @type {HTMLElement} */ (document.querySelector('.conf-pills'));

const dataPreview = document.getElementById('data-preview');
const dataSummary = document.getElementById('data-summary');
const varSelectorsDiv = document.getElementById('var-selectors');
const groupVarSelect = /** @type {HTMLSelectElement} */ (document.getElementById('group-var-select'));
const responseVarSelect = /** @type {HTMLSelectElement} */ (document.getElementById('response-var-select'));

// ── State ──────────────────────────────────────────────────────────
/** @type {number[]} */
let group1 = [];
/** @type {number[]} */
let group2 = [];
let group1Name = 'Group 1';
let group2Name = 'Group 2';
let dataPrecision = 1;

/** @type {{ headers: string[], types: string[], data: Array<Record<string,any>> } | null} */
let parsedCache = null;

let fromSummary = false;
/** @type {{xbar1:number,s1:number,n1:number,xbar2:number,s2:number,n2:number} | null} */
let summaryStats = null;

/** @type {import('../../../js/conclusions.js').ConclusionContext|null} */
let currentContext = null;
let currentSourceName = '';

let confLevel = 0.95;
/** @type {ReturnType<typeof mountCriticalValueFigure> | null} */
let figure = null;
/** @type {import('../../../js/inference.js').TwoMeanResult | null} */
let result = null;

const MIN_CONF = 0.50;
const MAX_CONF = 0.999;

initTabs({ hintTarget: resultsPanel, hintAction: 'enter data' });

// ── Data Panel ─────────────────────────────────────────────────────

const dataPanel = initDataPanel({
  autoCollapse: true, stickyControls: true, showPreview: true,
  // Same filter as the two-sample t-test: exactly 2 group levels, ≥3 per group.
  datasetFilter: ds => ds.hasNumeric && ds.hasCategorical && ds.groupLevels === 2 && ds.minGroupN >= 3,
  onDataset: loadFromDataset,
  onText: loadFromParsed,
  onClear: clearData,
});

/** @param {any} ds */
function loadFromDataset(ds) {
  if (!ds.rows || !ds.variables) return;

  currentSourceName = ds.name || '';
  currentContext = findContext(ds, 'two-means');

  const catVars = ds.variables.filter(/** @param {any} v */ v => v.type === 'categorical');
  const numVars = ds.variables.filter(/** @param {any} v */ v => v.type === 'numeric');
  if (catVars.length === 0 || numVars.length === 0) {
    announce('This dataset needs at least one categorical and one numeric variable.');
    return;
  }

  parsedCache = {
    headers: ds.variables.map(/** @param {any} v */ v => v.name),
    types: ds.variables.map(/** @param {any} v */ v => v.type),
    data: ds.rows,
  };
  showVarSelectors(catVars.map(/** @param {any} v */ v => v.name), numVars.map(/** @param {any} v */ v => v.name));
  extractGroups();
}

/**
 * @param {{ headers: string[], types: string[], data: Array<Record<string,any>> }} parsed
 */
function loadFromParsed(parsed) {
  currentSourceName = '';
  currentContext = null;
  const catCols = parsed.headers.filter((_, i) => parsed.types[i] === 'categorical');
  const numCols = parsed.headers.filter((_, i) => parsed.types[i] === 'numeric');
  if (catCols.length === 0 || numCols.length === 0) {
    announce('Data needs at least one categorical column (groups) and one numeric column (values).');
    return;
  }
  parsedCache = parsed;
  showVarSelectors(catCols, numCols);
  extractGroups();
}

/**
 * @param {string[]} catCols
 * @param {string[]} numCols
 */
function showVarSelectors(catCols, numCols) {
  if (!varSelectorsDiv || !groupVarSelect || !responseVarSelect) return;
  const needSelector = catCols.length > 1 || numCols.length > 1;

  groupVarSelect.innerHTML = '';
  for (const col of catCols) {
    const opt = document.createElement('option');
    opt.value = col; opt.textContent = col;
    groupVarSelect.appendChild(opt);
  }
  responseVarSelect.innerHTML = '';
  for (const col of numCols) {
    const opt = document.createElement('option');
    opt.value = col; opt.textContent = col;
    responseVarSelect.appendChild(opt);
  }
  varSelectorsDiv.hidden = !needSelector;
}

groupVarSelect?.addEventListener('change', extractGroups);
responseVarSelect?.addEventListener('change', extractGroups);

/** Split the cached rows into the two groups named by the current selections. */
function extractGroups() {
  if (!parsedCache || !groupVarSelect || !responseVarSelect) return;
  const groupCol = groupVarSelect.value;
  const valCol = responseVarSelect.value;
  if (!groupCol || !valCol) return;

  const levels = [...new Set(parsedCache.data.map(r => r[groupCol]))];
  if (levels.length < 2) {
    announce('The grouping variable must have at least two levels.');
    return;
  }

  group1Name = String(levels[0]);
  group2Name = String(levels[1]);
  group1 = parsedCache.data.filter(r => r[groupCol] === levels[0]).map(r => parseFloat(r[valCol])).filter(v => isFinite(v));
  group2 = parsedCache.data.filter(r => r[groupCol] === levels[1]).map(r => parseFloat(r[valCol])).filter(v => isFinite(v));

  if (group1.length < 2 || group2.length < 2) {
    announce('Each group needs at least 2 valid numeric values.');
    return;
  }

  fromSummary = false;
  dataPrecision = Math.max(detectPrecision(group1), detectPrecision(group2));
  if (dataSummary) {
    const namePrefix = currentSourceName ? `${currentSourceName}: ` : '';
    const varSuffix = responseVarSelect.value ? ` (${responseVarSelect.value})` : '';
    dataSummary.textContent =
      `${namePrefix}${group1Name}: n = ${group1.length}, x̄ = ${formatStat(mean(group1), dataPrecision)} | ` +
      `${group2Name}: n = ${group2.length}, x̄ = ${formatStat(mean(group2), dataPrecision)}${varSuffix}`;
  }
  build();
}

function clearData() {
  group1 = [];
  group2 = [];
  parsedCache = null;
  fromSummary = false;
  summaryStats = null;
  currentContext = null;
  currentSourceName = '';
  figure = null;
  if (dataPreview) dataPreview.hidden = true;
  if (varSelectorsDiv) varSelectorsDiv.hidden = true;
  controlsSection.hidden = true;
  chartAndResults.hidden = true;
  conditionsCheckpoint.hidden = true;
  chartContainer.innerHTML = '';
  resultsPanel.innerHTML = `<p class="placeholder">${getTabHintText(getActiveTabId(), 'enter data')}</p>`;
}

// ── Summary input ──────────────────────────────────────────────────
function summaryActive() {
  return document.getElementById('tab-summary')?.getAttribute('aria-selected') === 'true';
}

/**
 * @param {boolean} [quiet]
 * @returns {boolean}
 */
function applySummaryInputs(quiet) {
  const num = (/** @type {string} */ id) => parseFloat(/** @type {HTMLInputElement} */ (document.getElementById(id))?.value);
  const int = (/** @type {string} */ id) => parseInt(/** @type {HTMLInputElement} */ (document.getElementById(id))?.value, 10);
  const xbar1 = num('input-xbar1'), s1 = num('input-s1'), n1 = int('input-n1');
  const xbar2 = num('input-xbar2'), s2 = num('input-s2'), n2 = int('input-n2');

  const fail = (/** @type {string} */ msg) => { if (!quiet) announce(msg); return false; };
  if (!isFinite(xbar1)) return fail('Enter a valid mean for Group 1.');
  if (!isFinite(s1) || s1 <= 0) return fail('Enter a valid positive SD for Group 1.');
  if (!isFinite(n1) || n1 < 2) return fail('Group 1 sample size must be at least 2.');
  if (!isFinite(xbar2)) return fail('Enter a valid mean for Group 2.');
  if (!isFinite(s2) || s2 <= 0) return fail('Enter a valid positive SD for Group 2.');
  if (!isFinite(n2) || n2 < 2) return fail('Group 2 sample size must be at least 2.');

  const label1 = /** @type {HTMLInputElement} */ (document.getElementById('input-label1'));
  const label2 = /** @type {HTMLInputElement} */ (document.getElementById('input-label2'));
  group1Name = label1?.value?.trim() || 'Group 1';
  group2Name = label2?.value?.trim() || 'Group 2';

  fromSummary = true;
  group1 = [];
  group2 = [];
  parsedCache = null;
  currentContext = null;
  if (varSelectorsDiv) varSelectorsDiv.hidden = true;
  if (dataPreview) dataPreview.hidden = true;

  dataPrecision = Math.max(...[xbar1, s1, xbar2, s2].map(v => detectPrecision([v])));
  summaryStats = { xbar1, s1, n1, xbar2, s2, n2 };
  return true;
}

for (const id of ['input-xbar1', 'input-s1', 'input-n1', 'input-xbar2', 'input-s2', 'input-n2', 'input-label1', 'input-label2']) {
  document.getElementById(id)?.addEventListener('input', () => {
    if (summaryActive() && applySummaryInputs(true)) build();
  });
}

function hasData() { return (group1.length >= 2 && group2.length >= 2) || (fromSummary && !!summaryStats); }

// ── Core ───────────────────────────────────────────────────────────

/** Full (re)build — called when the data (and thus the Welch df) changes. */
function build() {
  if (!hasData()) return;

  // Reuse the test function purely for its estimate / SE / Welch df — the
  // p-value it also returns is ignored here (this page has no hypotheses).
  result = (fromSummary && summaryStats)
    ? twoMeanTSummary(summaryStats.xbar1, summaryStats.s1, summaryStats.n1,
                      summaryStats.xbar2, summaryStats.s2, summaryStats.n2, { confLevel })
    : twoMeanT(group1, group2, { confLevel });

  controlsSection.hidden = false;
  chartAndResults.hidden = false;

  const df = result.df;
  figure = mountCriticalValueFigure(chartContainer, {
    pdfFn: (x) => pdfT(x, df),
    cdfFn: (x) => tCDF(x, df),
    invFn: (p) => tInv(p, df),
    domain: computeDomain('t', { df }),
    center: 0,
    level: confLevel,
    minLevel: MIN_CONF,
    maxLevel: MAX_CONF,
    xLabel: 't',
    title: `Standardized t-distribution (df = ${df.toFixed(1)})`,
    desc: `t-distribution with Welch df = ${df.toFixed(1)}. The middle region between the critical values ±t* is shaded; its area equals the confidence level. Drag a critical value to change the level.`,
    id: 'ci-t-chart',
    filename: 'confidence-interval-diff-means.png',
    critSymbol: 't*',
    confInput: inputConf,
    confPills,
    onChange: onFigureChange,
  });

  renderResults(figure.getCrit());
  showConditionsCheckpoint();
  setPageTitle(baseTitle, dataPanel.currentSourceName, { n: group1.length + group2.length });
}

/** The figure reports a new level (box, pill, drag, or an edited label). */
function onFigureChange(/** @type {number} */ level, /** @type {number} */ tStar) {
  confLevel = level;
  renderResults(tStar);
}

/**
 * Render the confidence-interval results panel.
 * @param {number} tStar
 */
function renderResults(tStar) {
  if (!result) return;
  const r = result;
  const d = dataPrecision;
  const margin = tStar * r.se;
  const lower = r.diff - margin;
  const upper = r.diff + margin;
  const confPct = (confLevel * 100 % 1) ? (confLevel * 100).toFixed(1) : (confLevel * 100).toFixed(0);
  const straddlesZero = lower < 0 && upper > 0;

  const V = '\\textcolor{#569BBD}';
  const P = '\\textcolor{#2e7d32}';
  const fx = (/** @type {string} */ key, /** @type {string|number} */ val) =>
    `\\htmlClass{fx-val fx-${key}}{${V}{${val}}}`;
  const fxs = (/** @type {string} */ key, /** @type {string} */ latex) =>
    `\\htmlClass{fx-val fx-${key}}{${latex}}`;

  const ciFormula = tex(`\\begin{aligned}
    &(${fxs('xbar1', '\\bar{x}_1')} - ${fxs('xbar2', '\\bar{x}_2')}) \\pm t^{\\!*} \\cdot \\sqrt{\\frac{${fxs('s1', 's_1')}^2}{${fxs('n1', 'n_1')}} + \\frac{${fxs('s2', 's_2')}^2}{${fxs('n2', 'n_2')}}} \\\\[8pt]
    &(${fx('xbar1', formatStat(r.xbar1, d))} - ${fx('xbar2', formatStat(r.xbar2, d))}) \\pm ${V}{${tStar.toFixed(3)}} \\cdot ${V}{${formatStat(r.se, d)}} \\\\[8pt]
    &= ${V}{${formatStat(r.diff, d)}} \\pm ${V}{${formatStat(margin, d)}} \\\\[8pt]
    &= ${P}{(${formatStat(lower, d)},\\; ${formatStat(upper, d)})}
  \\end{aligned}`, true);

  // Dataset contexts already read as "the difference in population mean … between …".
  const paramLabel = currentContext?.parameter || 'the difference in population means';

  resultsPanel.innerHTML = `
    <h3>Group Summary</h3>
    <table class="results-table" aria-label="Group summary statistics">
      <thead>
        <tr><th scope="col">Group</th><th scope="col">${tex('n')}</th><th scope="col">${tex('\\bar{x}')}</th><th scope="col">${tex('s')}</th></tr>
      </thead>
      <tbody>
        <tr><td>${escapeHTML(group1Name)}</td><td data-fx="n1">${r.n1}</td><td data-fx="xbar1">${formatStat(r.xbar1, d)}</td><td data-fx="s1">${formatStat(r.s1, d)}</td></tr>
        <tr><td>${escapeHTML(group2Name)}</td><td data-fx="n2">${r.n2}</td><td data-fx="xbar2">${formatStat(r.xbar2, d)}</td><td data-fx="s2">${formatStat(r.s2, d)}</td></tr>
      </tbody>
    </table>

    <div class="formula-display formula-ci">
      <h3>${confPct}% Confidence Interval</h3>
      <p class="formula-detail">for ${tex('\\mu_1 - \\mu_2')}, the difference in population means</p>
      ${ciFormula}
      <p class="formula-detail">${tex(`\\text{Welch df} = ${P}{${r.df.toFixed(1)}}`)}</p>
      <p class="formula-detail">${tex(`t^{\\!*} = ${P}{${tStar.toFixed(3)}}`)} &nbsp;·&nbsp; ${tex(`SE = ${P}{${formatStat(r.se, d)}}`)}</p>
    </div>


    <div class="interpretation" aria-live="polite">
      <p>We are <strong>${confPct}%</strong> confident that ${paramLabel}
        (${escapeHTML(group1Name)} − ${escapeHTML(group2Name)}) is
        between <strong>${formatStat(lower, d)}</strong> and <strong>${formatStat(upper, d)}</strong>.</p>
      <p>${straddlesZero
        ? 'The interval <strong>contains 0</strong>, so "no difference" is among the plausible values.'
        : `The interval <strong>does not contain 0</strong> — every plausible value points the same way, toward ${lower > 0 ? escapeHTML(group1Name) : escapeHTML(group2Name)} having the larger mean.`}</p>
    </div>
  `;

  linkFormula(document.querySelector('main') || resultsPanel);
}

// ── Conditions checkpoint ──────────────────────────────────────────
function showConditionsCheckpoint() {
  if (!conditionsCheckpoint) return;

  const dsId = dataPanel.currentDatasetId;
  const bootLink = dsId
    ? buildSimLink('simulate/bootstrap-two-means/', { dataset: dsId })
    : buildSimLink('simulate/bootstrap-two-means/');

  const hasRawData = !fromSummary && group1.length > 0 && group2.length > 0;

  conditionsCheckpoint.innerHTML = `
    <p>${hasRawData
      ? '<button type="button" class="conditions-toggle" aria-expanded="false" aria-controls="conditions-panel">Check Conditions</button>'
      : '<strong>Check Conditions</strong> (no raw data available for diagnostic plots)'}
    &nbsp; | &nbsp; Simulation alternative: <a href="${bootLink}">Bootstrap CI</a> (no normality condition required).</p>
    ${hasRawData ? '<div id="conditions-panel" class="conditions-panel" hidden><div id="conditions-chart"></div></div>' : ''}`;
  conditionsCheckpoint.hidden = false;

  const toggle = conditionsCheckpoint.querySelector('.conditions-toggle');
  const panel = /** @type {HTMLElement|null} */ (conditionsCheckpoint.querySelector('#conditions-panel'));
  const chartEl = conditionsCheckpoint.querySelector('#conditions-chart');
  if (toggle && panel && chartEl) {
    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!expanded));
      panel.hidden = expanded;
      if (!expanded && chartEl.children.length === 0) {
        renderConditionsDiagnostic(/** @type {HTMLElement} */ (chartEl),
          { [group1Name]: group1, [group2Name]: group2 },
          { varName: responseVarSelect?.value || '', context: 'two-sample' });
      }
    });
  }
}

// ── Helpers ────────────────────────────────────────────────────────

/**
 * @param {string} str
 * @returns {string}
 */
function escapeHTML(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
