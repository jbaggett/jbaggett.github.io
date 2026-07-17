// @ts-check
/**
 * Confidence Interval for a Mean — page controller.
 *
 * Sister page to the one-sample t-test: this page is about ESTIMATION only.
 * The student picks a confidence level (box, preset pills, or by dragging the
 * critical values on a standardized t-distribution), the figure shows where the
 * critical value t* comes from (middle (1−α) shaded, α/2 in each tail), and the
 * results box shows the confidence interval x̄ ± t*·(s/√n).
 *
 * No hypotheses, no p-value — that lives on the companion t-test page.
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

// ── Initialize jStat before anything else ──────────────────────────
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

const varSelector = /** @type {HTMLElement} */ (document.getElementById('variable-selector'));
const varSelect = /** @type {HTMLSelectElement} */ (document.getElementById('var-select'));
const dataSummary = document.getElementById('data-summary');

// ── State ──────────────────────────────────────────────────────────
/** @type {number[] | null} */
let currentData = null;

// Summary-input state
let fromSummary = false;
let summaryXbar = 0;
let summaryS = 0;
let summaryN = 0;

/** @type {import('../../../js/conclusions.js').ConclusionContext|null} */
let currentContext = null;

/** Current confidence level (proportion, e.g. 0.95). */
let confLevel = 0.95;

/** The mounted critical-value figure (draggable ±t* band), so controls can drive it. */
/** @type {ReturnType<typeof mountCriticalValueFigure> | null} */
let figure = null;
let stat = { xbar: 0, s: 0, n: 0, se: 0, df: 1, d: 2 };

const MIN_CONF = 0.50;
const MAX_CONF = 0.999;

// ── Tabs ───────────────────────────────────────────────────────────
initTabs({ hintTarget: resultsPanel, hintAction: 'enter data' });

// ── Data Panel ─────────────────────────────────────────────────────

/**
 * Process a loaded dataset object (from JSON).
 * @param {any} ds
 * @param {any} _meta
 */
function handleDataset(ds, _meta) {
  if (!ds.variables || !ds.rows) {
    announce('Dataset has no usable data.');
    return;
  }

  const numericCols = ds.variables
    .filter(/** @param {any} v */ v => v.type === 'numeric')
    .map(/** @param {any} v */ v => v.name);

  if (numericCols.length === 0) {
    announce('No numeric variables found in this dataset.');
    return;
  }

  currentContext = findContext(ds, 'one-mean');

  if (numericCols.length > 1) {
    varSelector.hidden = false;
    varSelect.innerHTML = '';
    for (const col of numericCols) {
      const opt = document.createElement('option');
      opt.value = col;
      opt.textContent = col;
      varSelect.appendChild(opt);
    }
  } else {
    varSelector.hidden = true;
  }

  const rows = ds.rows;
  const loadColumn = (/** @type {string} */ col) => {
    const values = rows
      .map(/** @param {any} r */ r => r[col])
      .filter(/** @param {any} v */ v => v != null && isFinite(Number(v)))
      .map(Number);

    if (values.length < 2) {
      announce(`Variable "${col}" has fewer than 2 valid numeric values.`);
      return;
    }

    currentData = values;
    fromSummary = false;
    updateDataSummary(col, values);
    build();
    announce(`Loaded ${values.length} values from "${col}".`);
  };

  loadColumn(numericCols[0]);
  varSelect.onchange = () => loadColumn(varSelect.value);
}

/**
 * Update the data summary strip with dataset info.
 * @param {string} varName
 * @param {number[]} values
 */
function updateDataSummary(varName, values) {
  if (!dataSummary) return;
  const name = dataPanel.currentSourceName;
  const prefix = name ? `${name}: ` : '';
  const d = detectPrecision(values);
  dataSummary.textContent = `${prefix}${varName}: n = ${values.length}, x̄ = ${formatStat(mean(values), d)}, s = ${formatStat(sd(values), d)}`;
}

/**
 * Process parsed CSV text data.
 * @param {{headers: string[], types: string[], data: Array<Record<string,any>>}} parsed
 * @param {string} sourceName
 */
function handleText(parsed, sourceName) {
  currentContext = null;
  const numericCols = parsed.headers.filter((h, i) => parsed.types[i] === 'numeric');

  if (numericCols.length === 0) {
    announce('No numeric columns found in pasted data.');
    return;
  }

  if (numericCols.length > 1) {
    varSelector.hidden = false;
    varSelect.innerHTML = '';
    for (const col of numericCols) {
      const opt = document.createElement('option');
      opt.value = col;
      opt.textContent = col;
      varSelect.appendChild(opt);
    }
  } else {
    varSelector.hidden = true;
  }

  const loadColumn = (/** @type {string} */ col) => {
    const values = parsed.data
      .map(r => r[col])
      .filter(v => v != null && isFinite(Number(v)))
      .map(Number);

    if (values.length < 2) {
      announce(`Column "${col}" has fewer than 2 valid numeric values.`);
      return;
    }

    currentData = values;
    fromSummary = false;
    updateDataSummary(col, values);
    build();
    announce(`Loaded ${values.length} values from "${sourceName}".`);
  };

  loadColumn(numericCols[0]);
  varSelect.onchange = () => loadColumn(varSelect.value);
}

const dataPanel = initDataPanel({
  autoCollapse: true, stickyControls: true, showPreview: true,
  datasetFilter: ds => ds.hasNumeric === true && ds.hasCategorical === false,
  onDataset: handleDataset,
  onText: handleText,
  onClear: () => {
    currentData = null;
    fromSummary = false;
    currentContext = null;
    figure = null;
    varSelector.hidden = true;
    controlsSection.hidden = true;
    chartAndResults.hidden = true;
    conditionsCheckpoint.hidden = true;
    chartContainer.innerHTML = '';
    resultsPanel.innerHTML = `<p class="placeholder">${getTabHintText(getActiveTabId(), 'enter data')}</p>`;
  },
});

// ── Summary input handler ────────────────────────────────────────
function summaryActive() {
  return document.getElementById('tab-summary')?.getAttribute('aria-selected') === 'true';
}

/**
 * Read + validate the summary-stat fields. No separate "Load" step.
 * @param {boolean} [quiet]
 * @returns {boolean}
 */
function applySummaryInputs(quiet) {
  const xbar = parseFloat(/** @type {HTMLInputElement} */ (document.getElementById('input-xbar'))?.value);
  const s = parseFloat(/** @type {HTMLInputElement} */ (document.getElementById('input-s'))?.value);
  const n = parseInt(/** @type {HTMLInputElement} */ (document.getElementById('input-n'))?.value, 10);

  const fail = (/** @type {string} */ msg) => { if (!quiet) announce(msg); return false; };
  if (!isFinite(xbar)) return fail('Enter a valid sample mean.');
  if (!isFinite(s) || s <= 0) return fail('Enter a valid positive standard deviation.');
  if (!isFinite(n) || n < 2) return fail('Sample size must be at least 2.');

  fromSummary = true;
  summaryXbar = xbar;
  summaryS = s;
  summaryN = n;
  currentData = null;
  currentContext = null;
  varSelector.hidden = true;
  return true;
}

for (const id of ['input-xbar', 'input-s', 'input-n']) {
  document.getElementById(id)?.addEventListener('input', () => {
    if (summaryActive() && applySummaryInputs(true)) build();
  });
}

// The confidence box and preset pills are wired by the figure itself (it owns the
// level), so typing / clicking a pill / dragging a critical value all arrive here
// through the same onChange path.

function hasData() { return !!currentData || fromSummary; }

// ── Core ───────────────────────────────────────────────────────────

/** Compute the unified sample summary from data or summary inputs. */
function computeStat() {
  const xbar = fromSummary ? summaryXbar : mean(/** @type {number[]} */ (currentData));
  const s = fromSummary ? summaryS : sd(/** @type {number[]} */ (currentData));
  const n = fromSummary ? summaryN : /** @type {number[]} */ (currentData).length;
  const se = s / Math.sqrt(n);
  const df = n - 1;
  const d = fromSummary
    ? Math.max(detectPrecision([summaryXbar]), detectPrecision([summaryS]))
    : detectPrecision(/** @type {number[]} */ (currentData));
  stat = { xbar, s, n, se, df, d };
}

/** Full (re)build — called when the data (and thus df) changes. */
function build() {
  if (!hasData()) return;
  if (currentData && currentData.length < 2) return;

  computeStat();
  controlsSection.hidden = false;
  chartAndResults.hidden = false;

  const { df } = stat;
  // Mount the shared draggable critical-value figure on a standardized t-curve.
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
    desc: `t-distribution with df = ${df}. The middle region between the critical values ±t* is shaded; its area equals the confidence level. Drag a critical value or use arrow keys to change the level.`,
    id: 'ci-t-chart',
    filename: 'confidence-interval-mean.png',
    critSymbol: 't*',
    confInput: inputConf,
    confPills,
    onChange: onFigureChange,
  });
  // Render initial results for the current level.
  renderResults(figure.getCrit());
  showConditionsCheckpoint();

  setPageTitle(baseTitle, dataPanel.currentSourceName, { variable: varSelect?.value, n: currentData?.length });
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
  const { xbar, s, n, se, df, d } = stat;
  const margin = tStar * se;
  const lower = xbar - margin;
  const upper = xbar + margin;
  const confPct = (confLevel * 100 % 1) ? (confLevel * 100).toFixed(1) : (confLevel * 100).toFixed(0);

  const V = '\\textcolor{#569BBD}';
  const P = '\\textcolor{#2e7d32}';
  const fx = (/** @type {string} */ key, /** @type {string|number} */ val) =>
    `\\htmlClass{fx-val fx-${key}}{${V}{${val}}}`;
  const fxs = (/** @type {string} */ key, /** @type {string} */ latex) =>
    `\\htmlClass{fx-val fx-${key}}{${latex}}`;

  const ciFormula = tex(`\\begin{aligned}
    &${fxs('xbar', '\\bar{x}')} \\pm t^{\\!*} \\cdot \\frac{${fxs('s', 's')}}{\\sqrt{${fxs('n', 'n')}}} \\\\[8pt]
    &${fx('xbar', formatStat(xbar, d))} \\pm ${V}{${tStar.toFixed(3)}} \\cdot \\frac{${fx('s', formatStat(s, d))}}{\\sqrt{${fx('n', n)}}} \\\\[8pt]
    &= ${fx('xbar', formatStat(xbar, d))} \\pm ${V}{${formatStat(margin, d)}} \\\\[8pt]
    &= ${P}{(${formatStat(lower, d)},\\; ${formatStat(upper, d)})}
  \\end{aligned}`, true);

  // Dataset contexts already read as "the population mean Exam 1 score", so no extra article.
  const paramLabel = currentContext?.parameter || 'the population mean';
  const unit = currentContext?.unit ? ` ${currentContext.unit}` : '';

  resultsPanel.innerHTML = `
    <h3>Sample Summary</h3>
    <table class="results-table" aria-label="Sample summary">
      <tbody>
        <tr><th scope="row">${tex('n')}</th><td data-fx="n">${n}</td></tr>
        <tr><th scope="row">${tex('\\bar{x}')}</th><td data-fx="xbar">${formatStat(xbar, d)}</td></tr>
        <tr><th scope="row">${tex('s')}</th><td data-fx="s">${formatStat(s, d)}</td></tr>
        <tr><th scope="row">${tex('SE')}</th><td>${formatStat(se, d)}</td></tr>
      </tbody>
    </table>

    <div class="formula-display formula-ci">
      <h3>${confPct}% Confidence Interval</h3>
      ${ciFormula}
      <p class="formula-detail">${tex(`\\text{df} = n - 1 = ${n} - 1 = ${P}{${df}}`)}</p>
      <p class="formula-detail">${tex(`t^{\\!*} = ${P}{${tStar.toFixed(3)}}`)} &nbsp;·&nbsp; ${tex(`\\text{margin of error} = ${P}{${formatStat(margin, d)}}`)}</p>
    </div>

    <div class="ci-result-headline" aria-live="polite">
      <span class="ci-bounds">(${formatStat(lower, d)}, ${formatStat(upper, d)})</span>
    </div>

    <div class="interpretation" aria-live="polite">
      <p>We are <strong>${confPct}%</strong> confident that ${paramLabel} is
        between <strong>${formatStat(lower, d)}</strong> and <strong>${formatStat(upper, d)}</strong>${unit}.</p>
      <p class="hint">Raise the confidence level and the interval grows; lower it and the interval shrinks —
        the critical value <em>t*</em> on the plot is what sets the width.</p>
    </div>
  `;

  linkFormula(document.querySelector('main') || resultsPanel);
}

// ── Conditions checkpoint ────────────────────────────────────────────
function showConditionsCheckpoint() {
  if (!conditionsCheckpoint) return;

  const dsId = dataPanel.currentDatasetId;
  const bootLink = dsId
    ? buildSimLink('simulate/bootstrap-mean/', { dataset: dsId })
    : buildSimLink('simulate/bootstrap-mean/');

  const hasRawData = !fromSummary && currentData && currentData.length > 0;

  conditionsCheckpoint.innerHTML = `
    <p>${hasRawData
      ? '<button type="button" class="conditions-toggle" aria-expanded="false" aria-controls="conditions-panel">Check Conditions</button>'
      : '<strong>Check Conditions</strong> (no raw data available for diagnostic plots)'}
    &nbsp; | &nbsp; Simulation alternative: <a href="${bootLink}">Bootstrap CI</a> (no normality condition required).</p>
    ${hasRawData ? '<div id="conditions-panel" class="conditions-panel" hidden><div id="conditions-chart"></div>' +
      (dsId ? `<p class="hint" style="margin-top:0.5rem">For further investigation, <a href="${buildSimLink('explore/descriptive/', { dataset: dsId })}" target="_blank" rel="noopener">explore this dataset</a> in a new tab.</p>` : '') +
      '</div>' : ''}`;
  conditionsCheckpoint.hidden = false;

  const toggle = conditionsCheckpoint.querySelector('.conditions-toggle');
  const panel = conditionsCheckpoint.querySelector('#conditions-panel');
  const chartEl = conditionsCheckpoint.querySelector('#conditions-chart');
  if (toggle && panel && chartEl) {
    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!expanded));
      panel.hidden = expanded;
      if (!expanded && chartEl.children.length === 0) {
        const varName = varSelect?.value || '';
        renderConditionsDiagnostic(/** @type {HTMLElement} */ (chartEl), /** @type {number[]} */ (currentData), {
          varName,
          context: 'one-sample',
        });
      }
    });
  }
}
