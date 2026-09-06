// @ts-check
/**
 * Confidence Interval for a Mean Difference (paired data) — page controller.
 *
 * Sister page to the paired t-test: this page is about ESTIMATION only.
 * Everything happens on the differences d = var1 − var2, so the picture is the
 * same one-sample t-curve as the mean CI, with df = n − 1 pairs.
 *
 * No hypotheses, no p-value — that lives on the companion paired t-test page.
 */

import { setJStat, pdfT, tInv, tCDF } from '../../../js/distributions.js';
import { computeDomain } from '../../../js/curve.js';
import { mountCriticalValueFigure } from '../../../js/critical-value-figure.js';
import { renderConditionsDiagnostic } from '../../../js/conditions.js';
import { initTabs, initDataPanel, announce, initHelp, getActiveTabId, getTabHintText, buildSimLink, setPageTitle } from '../../../js/page-utils.js';
import { formatStat, detectPrecision, mean, sd } from '../../../js/stats.js';
import { findContext } from '../../../js/conclusions.js';
import { linkFormula } from '../../../js/formula-link.js';

initHelp();

import { tex } from '../../../js/tex.js';

const baseTitle = document.title.replace(/\s*\|\s*StatLens$/, '');

const jstatMod = await import('jstat');
setJStat(jstatMod.default || jstatMod);

// ── DOM references ─────────────────────────────────────────────────
const controlsSection = /** @type {HTMLElement} */ (document.getElementById('controls'));
const chartAndResults = /** @type {HTMLElement} */ (document.getElementById('chart-and-results'));
const chartContainer = /** @type {HTMLElement} */ (document.getElementById('chart-container'));
const resultsPanel = /** @type {HTMLElement} */ (document.getElementById('results-panel'));
const conditionsCheckpoint = /** @type {HTMLElement} */ (document.getElementById('conditions-checkpoint'));

const inputConf = /** @type {HTMLInputElement} */ (document.getElementById('input-conf'));
const confPills = /** @type {HTMLElement} */ (document.querySelector('.conf-pills'));

const varSelectors = /** @type {HTMLElement} */ (document.getElementById('variable-selectors'));
const var1Select = /** @type {HTMLSelectElement} */ (document.getElementById('var1-select'));
const var2Select = /** @type {HTMLSelectElement} */ (document.getElementById('var2-select'));
const dataSummary = document.getElementById('data-summary');

// ── State ──────────────────────────────────────────────────────────
/** @type {number[] | null} */
let currentDiffs = null;
/** @type {Array<Record<string, any>> | null} */
let currentRows = null;
/** @type {string[]} */
let numericCols = [];
let var1Name = '';
let var2Name = '';

let fromSummary = false;
let summaryDbar = 0;
let summarySd = 0;
let summaryN = 0;

/** @type {import('../../../js/conclusions.js').ConclusionContext|null} */
let currentContext = null;

let confLevel = 0.95;
/** @type {ReturnType<typeof mountCriticalValueFigure> | null} */
let figure = null;
let stat = { dbar: 0, sd: 0, n: 0, se: 0, df: 1, d: 2 };

const MIN_CONF = 0.50;
const MAX_CONF = 0.999;

initTabs({ hintTarget: resultsPanel, hintAction: 'enter data' });

// ── Data Panel ─────────────────────────────────────────────────────

/** @param {string[]} cols */
function populateVarSelectors(cols) {
  numericCols = cols;
  if (cols.length < 2) {
    varSelectors.hidden = true;
    announce('Need at least 2 numeric columns for paired data.');
    return;
  }
  varSelectors.hidden = false;
  var1Select.innerHTML = '';
  var2Select.innerHTML = '';
  for (const col of cols) {
    const o1 = document.createElement('option');
    o1.value = col; o1.textContent = col;
    var1Select.appendChild(o1);
    const o2 = document.createElement('option');
    o2.value = col; o2.textContent = col;
    var2Select.appendChild(o2);
  }
  var1Select.value = cols[0];
  var2Select.value = cols[1];
}

function loadFromSelections() {
  if (!currentRows || numericCols.length < 2) return;
  const col1 = var1Select.value;
  const col2 = var2Select.value;
  if (col1 === col2) { announce('Please select two different variables.'); return; }

  var1Name = col1;
  var2Name = col2;
  const diffs = [];
  for (const row of currentRows) {
    const v1 = Number(row[col1]);
    const v2 = Number(row[col2]);
    if (isFinite(v1) && isFinite(v2)) diffs.push(v1 - v2);
  }
  if (diffs.length < 2) {
    announce(`Fewer than 2 valid pairs found for "${col1}" and "${col2}".`);
    return;
  }

  currentDiffs = diffs;
  fromSummary = false;
  if (dataSummary) {
    const name = dataPanel.currentSourceName;
    const prefix = name ? `${name}: ` : '';
    const d = detectPrecision(diffs);
    dataSummary.textContent = `${prefix}${diffs.length} pairs (${col1} − ${col2}), d̄ = ${formatStat(mean(diffs), d)}, s_d = ${formatStat(sd(diffs), d)}`;
  }
  build();
  announce(`Loaded ${diffs.length} paired differences (${col1} − ${col2}).`);
}

/** @param {any} ds */
function handleDataset(ds) {
  if (!ds.variables || !ds.rows) { announce('Dataset has no usable data.'); return; }
  const cols = ds.variables
    .filter(/** @param {any} v */ v => v.type === 'numeric')
    .map(/** @param {any} v */ v => v.name);
  if (cols.length < 2) { announce('This dataset needs at least 2 numeric variables for paired data.'); return; }

  currentContext = findContext(ds, 'paired');
  currentRows = ds.rows;
  populateVarSelectors(cols);
  loadFromSelections();
}

/**
 * @param {{headers: string[], types: string[], data: Array<Record<string,any>>}} parsed
 */
function handleText(parsed) {
  currentContext = null;
  const cols = parsed.headers.filter((h, i) => parsed.types[i] === 'numeric');
  if (cols.length < 2) { announce('Need at least 2 numeric columns for paired data.'); return; }
  currentRows = parsed.data;
  populateVarSelectors(cols);
  loadFromSelections();
}

const dataPanel = initDataPanel({
  autoCollapse: true, stickyControls: true, showPreview: true,
  datasetFilter: ds => ds.type === 'paired',
  onDataset: handleDataset,
  onText: handleText,
  onClear: () => {
    currentDiffs = null;
    currentRows = null;
    numericCols = [];
    fromSummary = false;
    currentContext = null;
    figure = null;
    varSelectors.hidden = true;
    controlsSection.hidden = true;
    chartAndResults.hidden = true;
    conditionsCheckpoint.hidden = true;
    chartContainer.innerHTML = '';
    resultsPanel.innerHTML = `<p class="placeholder">${getTabHintText(getActiveTabId(), 'enter data')}</p>`;
  },
});

var1Select.addEventListener('change', () => { if (currentRows) loadFromSelections(); });
var2Select.addEventListener('change', () => { if (currentRows) loadFromSelections(); });

// ── Summary input ──────────────────────────────────────────────────
function summaryActive() {
  return document.getElementById('tab-summary')?.getAttribute('aria-selected') === 'true';
}

/**
 * @param {boolean} [quiet]
 * @returns {boolean}
 */
function applySummaryInputs(quiet) {
  const dbar = parseFloat(/** @type {HTMLInputElement} */ (document.getElementById('input-dbar'))?.value);
  const sdVal = parseFloat(/** @type {HTMLInputElement} */ (document.getElementById('input-sd'))?.value);
  const n = parseInt(/** @type {HTMLInputElement} */ (document.getElementById('input-n'))?.value, 10);

  const fail = (/** @type {string} */ msg) => { if (!quiet) announce(msg); return false; };
  if (!isFinite(dbar)) return fail('Enter a valid mean difference.');
  if (!isFinite(sdVal) || sdVal <= 0) return fail('Enter a valid positive standard deviation.');
  if (!isFinite(n) || n < 2) return fail('Number of pairs must be at least 2.');

  fromSummary = true;
  summaryDbar = dbar;
  summarySd = sdVal;
  summaryN = n;
  currentDiffs = null;
  currentRows = null;
  currentContext = null;
  varSelectors.hidden = true;
  return true;
}

for (const id of ['input-dbar', 'input-sd', 'input-n']) {
  document.getElementById(id)?.addEventListener('input', () => {
    if (summaryActive() && applySummaryInputs(true)) build();
  });
}

function hasData() { return !!currentDiffs || fromSummary; }

// ── Core ───────────────────────────────────────────────────────────

function computeStat() {
  const dbar = fromSummary ? summaryDbar : mean(/** @type {number[]} */ (currentDiffs));
  const sdVal = fromSummary ? summarySd : sd(/** @type {number[]} */ (currentDiffs));
  const n = fromSummary ? summaryN : /** @type {number[]} */ (currentDiffs).length;
  const se = sdVal / Math.sqrt(n);
  const df = n - 1;
  const d = fromSummary
    ? Math.max(detectPrecision([summaryDbar]), detectPrecision([summarySd]))
    : detectPrecision(/** @type {number[]} */ (currentDiffs));
  stat = { dbar, sd: sdVal, n, se, df, d };
}

/** Full (re)build — called when the data (and thus df) changes. */
function build() {
  if (!hasData()) return;

  computeStat();
  controlsSection.hidden = false;
  chartAndResults.hidden = false;

  const { df } = stat;
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
    title: `Standardized t-distribution (df = ${df})`,
    desc: `t-distribution with df = ${df}. The middle region between the critical values ±t* is shaded; its area equals the confidence level. Drag a critical value to change the level.`,
    id: 'ci-t-chart',
    filename: 'confidence-interval-paired.png',
    critSymbol: 't*',
    confInput: inputConf,
    confPills,
    onChange: onFigureChange,
  });

  renderResults(figure.getCrit());
  showConditionsCheckpoint();
  setPageTitle(baseTitle, dataPanel.currentSourceName, { n: currentDiffs?.length });
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
  const { dbar, sd: sdVal, n, se, df, d } = stat;
  const margin = tStar * se;
  const lower = dbar - margin;
  const upper = dbar + margin;
  const confPct = (confLevel * 100 % 1) ? (confLevel * 100).toFixed(1) : (confLevel * 100).toFixed(0);

  const V = '\\textcolor{#569BBD}';
  const P = '\\textcolor{#2e7d32}';
  const fx = (/** @type {string} */ key, /** @type {string|number} */ val) =>
    `\\htmlClass{fx-val fx-${key}}{${V}{${val}}}`;
  const fxs = (/** @type {string} */ key, /** @type {string} */ latex) =>
    `\\htmlClass{fx-val fx-${key}}{${latex}}`;

  const ciFormula = tex(`\\begin{aligned}
    &${fxs('dbar', '\\bar{d}')} \\pm t^{\\!*} \\cdot \\frac{${fxs('sd', 's_d')}}{\\sqrt{${fxs('n', 'n')}}} \\\\[8pt]
    &${fx('dbar', formatStat(dbar, d))} \\pm ${V}{${tStar.toFixed(3)}} \\cdot \\frac{${fx('sd', formatStat(sdVal, d))}}{\\sqrt{${fx('n', n)}}} \\\\[8pt]
    &= ${fx('dbar', formatStat(dbar, d))} \\pm ${V}{${formatStat(margin, d)}} \\\\[8pt]
    &= ${P}{(${formatStat(lower, d)},\\; ${formatStat(upper, d)})}
  \\end{aligned}`, true);

  // Dataset contexts already read as "the population mean difference in …".
  const paramLabel = currentContext?.parameter || 'the population mean difference';
  const pairLabel = (var1Name && var2Name) ? `${var1Name} − ${var2Name}` : 'the differences';
  const straddlesZero = lower < 0 && upper > 0;

  resultsPanel.innerHTML = `
    <h3>Sample Summary <span class="hint">(${escapeHTML(pairLabel)})</span></h3>
    <table class="results-table" aria-label="Sample summary">
      <tbody>
        <tr><th scope="row">${tex('n \\text{ pairs}')}</th><td data-fx="n">${n}</td></tr>
        <tr><th scope="row">${tex('\\bar{d}')}</th><td data-fx="dbar">${formatStat(dbar, d)}</td></tr>
        <tr><th scope="row">${tex('s_d')}</th><td data-fx="sd">${formatStat(sdVal, d)}</td></tr>
        <tr><th scope="row">${tex('SE')}</th><td>${formatStat(se, d)}</td></tr>
      </tbody>
    </table>

    <div class="formula-display formula-ci">
      <h3>${confPct}% Confidence Interval</h3>
      ${ciFormula}
      <p class="formula-detail">${tex(`\\text{df} = n - 1 = ${n} - 1 = ${P}{${df}}`)}</p>
      <p class="formula-detail">${tex(`t^{\\!*} = ${P}{${tStar.toFixed(3)}}`)} &nbsp;·&nbsp; ${tex(`\\text{margin of error} = ${P}{${formatStat(margin, d)}}`)}</p>
    </div>


    <div class="interpretation" aria-live="polite">
      <p>We are <strong>${confPct}%</strong> confident that ${paramLabel} is
        between <strong>${formatStat(lower, d)}</strong> and <strong>${formatStat(upper, d)}</strong>.</p>
      <p>${straddlesZero
        ? 'The interval <strong>contains 0</strong>, so a difference of zero is among the plausible values.'
        : 'The interval <strong>does not contain 0</strong>, so zero is not among the plausible values for the mean difference.'}</p>
    </div>
  `;

  linkFormula(document.querySelector('main') || resultsPanel);
}

// ── Conditions checkpoint ──────────────────────────────────────────
function showConditionsCheckpoint() {
  if (!conditionsCheckpoint) return;

  const dsId = dataPanel.currentDatasetId;
  const bootLink = dsId
    ? buildSimLink('simulate/bootstrap-paired/', { dataset: dsId })
    : buildSimLink('simulate/bootstrap-paired/');

  const hasRawData = !fromSummary && currentDiffs && currentDiffs.length > 0;

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
        renderConditionsDiagnostic(/** @type {HTMLElement} */ (chartEl), /** @type {number[]} */ (currentDiffs), {
          varName: `${var1Name} − ${var2Name}`,
          context: 'paired',
        });
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
