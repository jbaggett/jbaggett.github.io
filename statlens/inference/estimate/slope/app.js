// @ts-check
/**
 * Confidence Interval for a Regression Slope — page controller.
 *
 * Sister page to the slope t-test: this page is about ESTIMATION only.
 * The interval is b₁ ± t*·SE(b₁) with df = n − 2, and the figure shows where t*
 * comes from on that t-curve.
 *
 * No hypotheses, no p-value — that lives on the companion slope t-test page.
 */

import { setJStat, pdfT, tInv, tCDF } from '../../../js/distributions.js';
import { slopeT, slopeTSummary } from '../../../js/inference.js';
import { computeDomain } from '../../../js/curve.js';
import { mountCriticalValueFigure } from '../../../js/critical-value-figure.js';
import { renderConditionsDiagnostic } from '../../../js/conditions.js';
import { initTabs, initDataPanel, announce, initHelp, getActiveTabId, getTabHintText, buildSimLink, setPageTitle } from '../../../js/page-utils.js';
import { formatStat, detectPrecision, linreg } from '../../../js/stats.js';
import { findContext } from '../../../js/conclusions.js';
import { linkFormula } from '../../../js/formula-link.js';

initHelp();

/** Render LaTeX to HTML string via KaTeX (trust enables \htmlClass for formula linking). */
const tex = (/** @type {string} */ latex, display = false) =>
  katex.renderToString(latex, { throwOnError: false, displayMode: display, trust: true, strict: false });

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

const varSelector = /** @type {HTMLElement} */ (document.getElementById('variable-selector'));
const xVarSelect = /** @type {HTMLSelectElement} */ (document.getElementById('x-var'));
const yVarSelect = /** @type {HTMLSelectElement} */ (document.getElementById('y-var'));
const dataSummary = document.getElementById('data-summary');

// ── State ──────────────────────────────────────────────────────────
/** @type {Array<Record<string, any>>} */
let currentRows = [];
/** @type {string[]} */
let numericColumns = [];

let fromSummary = false;
let summarySlope = 0;
let summarySE = 0;
let summaryN = 0;

/** @type {import('../../../js/conclusions.js').ConclusionContext|null} */
let currentContext = null;

let confLevel = 0.95;
/** @type {ReturnType<typeof mountCriticalValueFigure> | null} */
let figure = null;
/** @type {ReturnType<typeof slopeT> | null} */
let result = null;
let dataPrecision = 2;

const MIN_CONF = 0.50;
const MAX_CONF = 0.999;

initTabs({ hintTarget: resultsPanel, hintAction: 'enter data' });

// ── Variable selectors ─────────────────────────────────────────────

function populateVarSelectors() {
  xVarSelect.innerHTML = '';
  yVarSelect.innerHTML = '';
  for (const col of numericColumns) {
    const ox = document.createElement('option');
    ox.value = col; ox.textContent = col;
    xVarSelect.appendChild(ox);
    const oy = document.createElement('option');
    oy.value = col; oy.textContent = col;
    yVarSelect.appendChild(oy);
  }
  if (numericColumns.length >= 2) {
    xVarSelect.value = numericColumns[0];
    yVarSelect.value = numericColumns[1];
  }
  varSelector.hidden = false;
}

/**
 * Extract paired numeric arrays from the current rows.
 * @returns {{ x: number[], y: number[] } | null}
 */
function extractXY() {
  const xCol = xVarSelect.value;
  const yCol = yVarSelect.value;
  if (!xCol || !yCol || xCol === yCol) return null;

  const x = [], y = [];
  for (const row of currentRows) {
    const xv = Number(row[xCol]);
    const yv = Number(row[yCol]);
    if (isFinite(xv) && isFinite(yv)) { x.push(xv); y.push(yv); }
  }
  if (x.length < 3) return null;
  return { x, y };
}

function updateDataSummary() {
  if (!dataSummary) return;
  const xy = extractXY();
  if (!xy) return;
  const name = dataPanel.currentSourceName;
  const prefix = name ? `${name}: ` : '';
  const reg = linreg(xy.x, xy.y);
  const d = Math.max(detectPrecision(xy.x), detectPrecision(xy.y));
  dataSummary.textContent = `${prefix}n = ${xy.x.length}, slope = ${formatStat(reg.slope, d)}, r² = ${formatStat(reg.r2, d, 'correlation')}`;
}

// ── Data Panel ─────────────────────────────────────────────────────

/** @param {any} ds */
function handleDataset(ds) {
  if (!ds.variables || !ds.rows) { announce('Dataset has no usable data.'); return; }
  currentContext = findContext(ds, 'slope');

  const numCols = ds.variables
    .filter(/** @param {any} v */ v => v.type === 'numeric')
    .map(/** @param {any} v */ v => v.name);
  if (numCols.length < 2) { announce('Need at least two numeric variables for regression.'); return; }

  currentRows = ds.rows;
  numericColumns = numCols;
  fromSummary = false;
  populateVarSelectors();
  updateDataSummary();
  build();
  announce(`Loaded ${ds.rows.length} observations.`);
}

/**
 * @param {{headers: string[], types: string[], data: Array<Record<string,any>>}} parsed
 * @param {string} sourceName
 */
function handleText(parsed, sourceName) {
  currentContext = null;
  const numCols = parsed.headers.filter((h, i) => parsed.types[i] === 'numeric');
  if (numCols.length < 2) { announce('Need at least two numeric columns for regression.'); return; }

  currentRows = parsed.data.map(row => {
    /** @type {Record<string, any>} */
    const out = {};
    for (const h of parsed.headers) {
      out[h] = numCols.includes(h)
        ? (row[h] === '' || row[h] === 'NA' ? NaN : Number(row[h]))
        : row[h];
    }
    return out;
  });
  numericColumns = numCols;
  fromSummary = false;
  populateVarSelectors();
  updateDataSummary();
  build();
  announce(`Loaded ${currentRows.length} observations from "${sourceName}".`);
}

const dataPanel = initDataPanel({
  autoCollapse: true, stickyControls: true, showPreview: true,
  datasetFilter: ds => ds.type === 'regression',
  onDataset: handleDataset,
  onText: handleText,
  onClear: () => {
    currentRows = [];
    numericColumns = [];
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

xVarSelect.addEventListener('change', () => { if (currentRows.length) { updateDataSummary(); build(); } });
yVarSelect.addEventListener('change', () => { if (currentRows.length) { updateDataSummary(); build(); } });

// ── Summary input ──────────────────────────────────────────────────
function summaryActive() {
  return document.getElementById('tab-summary')?.getAttribute('aria-selected') === 'true';
}

/**
 * @param {boolean} [quiet]
 * @returns {boolean}
 */
function applySummaryInputs(quiet) {
  const slope = parseFloat(/** @type {HTMLInputElement} */ (document.getElementById('input-slope'))?.value);
  const se = parseFloat(/** @type {HTMLInputElement} */ (document.getElementById('input-se'))?.value);
  const n = parseInt(/** @type {HTMLInputElement} */ (document.getElementById('input-n'))?.value, 10);

  const fail = (/** @type {string} */ msg) => { if (!quiet) announce(msg); return false; };
  if (!isFinite(slope)) return fail('Enter a valid slope.');
  if (!isFinite(se) || se <= 0) return fail('Enter a valid positive standard error.');
  if (!isFinite(n) || n < 3) return fail('Sample size must be at least 3.');

  fromSummary = true;
  summarySlope = slope;
  summarySE = se;
  summaryN = n;
  currentRows = [];
  numericColumns = [];
  currentContext = null;
  varSelector.hidden = true;
  return true;
}

for (const id of ['input-slope', 'input-se', 'input-n']) {
  document.getElementById(id)?.addEventListener('input', () => {
    if (summaryActive() && applySummaryInputs(true)) build();
  });
}

// ── Core ───────────────────────────────────────────────────────────

/** Full (re)build — called when the data (and thus df) changes. */
function build() {
  const xy = fromSummary ? null : extractXY();
  if (!fromSummary && !xy) return;

  // Reuse the test function purely for its estimate / SE / df — the p-value it
  // also returns is ignored here (this page has no hypotheses).
  result = fromSummary
    ? slopeTSummary(summarySlope, summarySE, summaryN, { confLevel })
    : slopeT(/** @type {{x:number[],y:number[]}} */ (xy).x, /** @type {{x:number[],y:number[]}} */ (xy).y, { confLevel });

  dataPrecision = xy
    ? Math.max(detectPrecision(xy.x), detectPrecision(xy.y))
    : Math.max(detectPrecision([summarySlope]), detectPrecision([summarySE]));

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
    title: `Standardized t-distribution (df = ${df})`,
    desc: `t-distribution with df = n − 2 = ${df}. The middle region between the critical values ±t* is shaded; its area equals the confidence level. Drag a critical value to change the level.`,
    id: 'ci-t-chart',
    filename: 'confidence-interval-slope.png',
    critSymbol: 't*',
    confInput: inputConf,
    confPills,
    onChange: onFigureChange,
  });

  renderResults(figure.getCrit());
  showConditionsCheckpoint();
  setPageTitle(baseTitle, dataPanel.currentSourceName, { n: result.n });
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
  const lower = r.slope - margin;
  const upper = r.slope + margin;
  const confPct = (confLevel * 100 % 1) ? (confLevel * 100).toFixed(1) : (confLevel * 100).toFixed(0);
  const straddlesZero = lower < 0 && upper > 0;

  const xName = fromSummary ? 'x' : (xVarSelect.value || 'x');
  const yName = fromSummary ? 'y' : (yVarSelect.value || 'y');

  const V = '\\textcolor{#569BBD}';
  const P = '\\textcolor{#2e7d32}';
  const fx = (/** @type {string} */ key, /** @type {string|number} */ val) =>
    `\\htmlClass{fx-val fx-${key}}{${V}{${val}}}`;
  const fxs = (/** @type {string} */ key, /** @type {string} */ latex) =>
    `\\htmlClass{fx-val fx-${key}}{${latex}}`;

  const ciFormula = tex(`\\begin{aligned}
    &${fxs('slope', 'b_1')} \\pm t^{\\!*} \\cdot ${fxs('se', 'SE(b_1)')} \\\\[8pt]
    &${fx('slope', formatStat(r.slope, d))} \\pm ${V}{${tStar.toFixed(3)}} \\cdot ${fx('se', formatStat(r.se, d))} \\\\[8pt]
    &= ${fx('slope', formatStat(r.slope, d))} \\pm ${V}{${formatStat(margin, d)}} \\\\[8pt]
    &= ${P}{(${formatStat(lower, d)},\\; ${formatStat(upper, d)})}
  \\end{aligned}`, true);

  // Dataset contexts already read as "the slope of the relationship between …".
  const paramLabel = currentContext?.parameter || 'the slope of the population regression line';

  const fitRow = fromSummary ? '' : `
        <tr><th scope="row">${tex('r^2')}</th><td>${formatStat(r.rSquared, 3, 'correlation')}</td></tr>`;

  resultsPanel.innerHTML = `
    <h3>Regression Summary <span class="hint">(${escapeHTML(yName)} on ${escapeHTML(xName)})</span></h3>
    <table class="results-table" aria-label="Regression summary">
      <tbody>
        <tr><th scope="row">${tex('n')}</th><td>${r.n}</td></tr>
        <tr><th scope="row">${tex('b_1')}</th><td data-fx="slope">${formatStat(r.slope, d)}</td></tr>
        <tr><th scope="row">${tex('SE(b_1)')}</th><td data-fx="se">${formatStat(r.se, d)}</td></tr>${fitRow}
      </tbody>
    </table>

    <div class="formula-display formula-ci">
      <h3>${confPct}% Confidence Interval</h3>
      <p class="formula-detail">for ${tex('\\beta_1')}, the slope of the population regression line</p>
      ${ciFormula}
      <p class="formula-detail">${tex(`\\text{df} = n - 2 = ${r.n} - 2 = ${P}{${r.df}}`)}</p>
      <p class="formula-detail">${tex(`t^{\\!*} = ${P}{${tStar.toFixed(3)}}`)} &nbsp;·&nbsp; ${tex(`\\text{margin of error} = ${P}{${formatStat(margin, d)}}`)}</p>
    </div>

    <div class="ci-result-headline" aria-live="polite">
      <span class="ci-bounds">(${formatStat(lower, d)}, ${formatStat(upper, d)})</span>
    </div>

    <div class="interpretation" aria-live="polite">
      <p>We are <strong>${confPct}%</strong> confident that ${paramLabel} is
        between <strong>${formatStat(lower, d)}</strong> and <strong>${formatStat(upper, d)}</strong> —
        that is, each 1-unit increase in ${escapeHTML(xName)} is associated with a change in
        ${escapeHTML(yName)} somewhere in that range.</p>
      <p>${straddlesZero
        ? 'The interval <strong>contains 0</strong>, so a slope of zero (no linear relationship) is among the plausible values.'
        : 'The interval <strong>does not contain 0</strong>, so zero is not among the plausible values for the slope.'}</p>
    </div>
  `;

  linkFormula(document.querySelector('main') || resultsPanel);
}

// ── Conditions checkpoint ──────────────────────────────────────────
function showConditionsCheckpoint() {
  if (!conditionsCheckpoint) return;

  const dsId = dataPanel.currentDatasetId;
  const bootLink = dsId
    ? buildSimLink('simulate/bootstrap-slope/', { dataset: dsId })
    : buildSimLink('simulate/bootstrap-slope/');

  const xy = fromSummary ? null : extractXY();
  const hasRawData = !!xy;

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
  if (toggle && panel && chartEl && xy) {
    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!expanded));
      panel.hidden = expanded;
      if (!expanded && chartEl.children.length === 0) {
        // Conditions for a slope are about the RESIDUALS, not the raw y-values.
        const reg = linreg(xy.x, xy.y);
        const residuals = xy.y.map((yi, i) => yi - (reg.intercept + reg.slope * xy.x[i]));
        renderConditionsDiagnostic(/** @type {HTMLElement} */ (chartEl), residuals, {
          varName: 'Residuals',
          context: 'residuals',
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
