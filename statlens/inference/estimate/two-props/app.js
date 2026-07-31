// @ts-check
/**
 * Confidence Interval for a Difference in Proportions — page controller.
 *
 * Sister page to the two-proportion z-test: this page is about ESTIMATION only.
 * The interval uses the unpooled (Wald) standard error — pooling is a null-hypothesis
 * device, so it has no place here:
 *   (p̂₁ − p̂₂) ± z*·√( p̂₁(1−p̂₁)/n₁ + p̂₂(1−p̂₂)/n₂ )
 *
 * No hypotheses, no p-value — that lives on the companion z-test page.
 */

import * as jstat from 'jstat';
import { setJStat, pdfNormal, normalCDF, normalInv } from '../../../js/distributions.js';
import { computeDomain } from '../../../js/curve.js';
import { mountCriticalValueFigure } from '../../../js/critical-value-figure.js';
import { initTabs, initDataPanel, announce, initHelp, getActiveTabId, getTabHintText, buildSimLink, setPageTitle, renderConditionsCheckpoint } from '../../../js/page-utils.js';
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

const inputX1 = /** @type {HTMLInputElement} */ (document.getElementById('input-x1'));
const inputN1 = /** @type {HTMLInputElement} */ (document.getElementById('input-n1'));
const inputX2 = /** @type {HTMLInputElement} */ (document.getElementById('input-x2'));
const inputN2 = /** @type {HTMLInputElement} */ (document.getElementById('input-n2'));
const inputLabel1 = /** @type {HTMLInputElement} */ (document.getElementById('input-label1'));
const inputLabel2 = /** @type {HTMLInputElement} */ (document.getElementById('input-label2'));

const dataPreview = document.getElementById('data-preview');
const dataSummary = document.getElementById('data-summary');
const variableSelectors = document.getElementById('variable-selectors');
const groupVarSelect = /** @type {HTMLSelectElement|null} */ (document.getElementById('group-var-select'));
const outcomeVarSelect = /** @type {HTMLSelectElement|null} */ (document.getElementById('outcome-var-select'));
const successSelector = document.getElementById('success-selector');
const successOutcome = /** @type {HTMLSelectElement|null} */ (document.getElementById('success-outcome'));

// ── State ──────────────────────────────────────────────────────────
/** @type {Array<Record<string, string>>} */
let rawRows = [];
/** @type {string[]} */
let catVarNames = [];
let groupVar = '';
let outcomeVar = '';
let successValue = '';
let label1 = 'Group 1';
let label2 = 'Group 2';

let currentX1 = 0, currentN1 = 0, currentX2 = 0, currentN2 = 0;
let hasCounts = false;

/** @type {import('../../../js/conclusions.js').ConclusionContext|null} */
let currentContext = null;

let confLevel = 0.95;
/** @type {ReturnType<typeof mountCriticalValueFigure> | null} */
let figure = null;

const MIN_CONF = 0.50;
const MAX_CONF = 0.999;

initTabs({ hintTarget: resultsPanel, hintAction: 'enter data' });

// ── Data Panel ─────────────────────────────────────────────────────

const dataPanel = initDataPanel({
  autoCollapse: true, stickyControls: true, showPreview: true,
  // Same filter as the two-proportion z-test: 2×2 designs only.
  datasetFilter: (/** @type {any} */ ds) => ds.type === 'randomization_prop',
  onDataset: (ds) => {
    currentContext = findContext(ds, 'two-props');
    const catVars = ds.variables.filter(/** @param {any} v */ v => v.type === 'categorical');
    if (catVars.length < 2) {
      announce('This dataset needs at least two categorical variables (group + outcome).');
      return;
    }
    catVarNames = catVars.map(/** @param {any} v */ v => v.name);
    rawRows = ds.rows.map(/** @param {any} r */ r => {
      /** @type {Record<string, string>} */
      const obj = {};
      for (const col of catVarNames) obj[col] = String(r[col]);
      return obj;
    });
    setupVariableSelectors(ds.name);
  },
  onText: (parsed, sourceName) => {
    currentContext = null;
    const catIndices = parsed.types.map((t, i) => t === 'categorical' ? i : -1).filter(i => i >= 0);
    if (catIndices.length < 2) {
      announce('Need at least two categorical columns (group + outcome).');
      return;
    }
    catVarNames = catIndices.map(i => parsed.headers[i]);
    rawRows = parsed.data.map(row => {
      /** @type {Record<string, string>} */
      const obj = {};
      for (const col of catVarNames) obj[col] = String(row[col]);
      return obj;
    });
    setupVariableSelectors(sourceName);
  },
  onClear: () => {
    rawRows = [];
    catVarNames = [];
    currentX1 = currentN1 = currentX2 = currentN2 = 0;
    hasCounts = false;
    currentContext = null;
    figure = null;
    if (dataPreview) dataPreview.hidden = true;
    if (variableSelectors) variableSelectors.hidden = true;
    if (successSelector) successSelector.hidden = true;
    controlsSection.hidden = true;
    chartAndResults.hidden = true;
    conditionsCheckpoint.hidden = true;
    chartContainer.innerHTML = '';
    resultsPanel.innerHTML = `<p class="placeholder">${getTabHintText(getActiveTabId(), 'enter data')}</p>`;
    announce('Data cleared.');
  },
});

/** @param {string} sourceName */
function setupVariableSelectors(sourceName) {
  if (!groupVarSelect || !outcomeVarSelect || !variableSelectors) return;

  groupVarSelect.innerHTML = '';
  outcomeVarSelect.innerHTML = '';
  for (const name of catVarNames) {
    const o1 = document.createElement('option');
    o1.value = name; o1.textContent = name;
    groupVarSelect.appendChild(o1);
    const o2 = document.createElement('option');
    o2.value = name; o2.textContent = name;
    outcomeVarSelect.appendChild(o2);
  }

  groupVar = catVarNames[0];
  outcomeVar = catVarNames.length > 1 ? catVarNames[1] : catVarNames[0];
  groupVarSelect.value = groupVar;
  outcomeVarSelect.value = outcomeVar;
  variableSelectors.hidden = false;

  groupVarSelect.onchange = () => { groupVar = groupVarSelect.value; showSuccessSelector(sourceName); };
  outcomeVarSelect.onchange = () => { outcomeVar = outcomeVarSelect.value; showSuccessSelector(sourceName); };

  showSuccessSelector(sourceName);
}

/** @param {string} sourceName */
function showSuccessSelector(sourceName) {
  if (!successOutcome || !successSelector) return;

  const outcomes = [...new Set(rawRows.map(r => r[outcomeVar]))];
  successOutcome.innerHTML = '';
  for (const val of outcomes) {
    const opt = document.createElement('option');
    opt.value = val; opt.textContent = val;
    successOutcome.appendChild(opt);
  }
  successSelector.hidden = false;
  successValue = (currentContext?.successLabel && outcomes.includes(currentContext.successLabel))
    ? currentContext.successLabel : outcomes[0];
  successOutcome.value = successValue;

  if (countFromData(sourceName)) build();
  successOutcome.onchange = () => {
    successValue = successOutcome.value;
    if (countFromData(sourceName)) build();
  };
}

/**
 * Count successes per group from the raw rows.
 * @param {string} sourceName
 * @returns {boolean}
 */
function countFromData(sourceName) {
  const groups = [...new Set(rawRows.map(r => r[groupVar]))];
  if (groups.length < 2) {
    announce('The grouping variable needs at least 2 groups.');
    return false;
  }

  label1 = groups[0];
  label2 = groups[1];
  const g1 = rawRows.filter(r => r[groupVar] === label1);
  const g2 = rawRows.filter(r => r[groupVar] === label2);
  currentN1 = g1.length;
  currentN2 = g2.length;
  currentX1 = g1.filter(r => r[outcomeVar] === successValue).length;
  currentX2 = g2.filter(r => r[outcomeVar] === successValue).length;
  hasCounts = currentN1 > 0 && currentN2 > 0;

  if (dataSummary) {
    const p1 = currentN1 > 0 ? formatStat(currentX1 / currentN1, 0, 'proportion') : '—';
    const p2 = currentN2 > 0 ? formatStat(currentX2 / currentN2, 0, 'proportion') : '—';
    dataSummary.textContent =
      `${sourceName}: ${label1} ${currentX1}/${currentN1} (p̂=${p1}), ${label2} ${currentX2}/${currentN2} (p̂=${p2}). Success = "${successValue}"`;
  }
  return hasCounts;
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
  const x1 = Math.round(Number(inputX1.value));
  const n1 = Math.round(Number(inputN1.value));
  const x2 = Math.round(Number(inputX2.value));
  const n2 = Math.round(Number(inputN2.value));

  const fail = (/** @type {string} */ msg) => { if (!quiet) announce(msg); return false; };
  if (!Number.isFinite(n1) || n1 < 1) return fail('n₁ must be at least 1.');
  if (!Number.isFinite(n2) || n2 < 1) return fail('n₂ must be at least 1.');
  if (!Number.isFinite(x1) || x1 < 0 || x1 > n1) return fail('Successes for Group 1 must be between 0 and n₁.');
  if (!Number.isFinite(x2) || x2 < 0 || x2 > n2) return fail('Successes for Group 2 must be between 0 and n₂.');

  currentX1 = x1; currentN1 = n1;
  currentX2 = x2; currentN2 = n2;
  label1 = inputLabel1?.value?.trim() || 'Group 1';
  label2 = inputLabel2?.value?.trim() || 'Group 2';
  hasCounts = true;
  currentContext = null;
  rawRows = [];
  if (variableSelectors) variableSelectors.hidden = true;
  if (successSelector) successSelector.hidden = true;
  if (dataSummary) {
    dataSummary.textContent =
      `Summary: ${label1} ${x1}/${n1} (p̂=${formatStat(x1 / n1, 0, 'proportion')}), ${label2} ${x2}/${n2} (p̂=${formatStat(x2 / n2, 0, 'proportion')})`;
  }
  return true;
}

for (const el of [inputX1, inputN1, inputX2, inputN2, inputLabel1, inputLabel2]) {
  el?.addEventListener('input', () => { if (summaryActive() && applySummaryInputs(true)) build(); });
}

// ── Core ───────────────────────────────────────────────────────────

/** Full (re)build — mount the figure and render the interval. */
function build() {
  if (!hasCounts) return;

  controlsSection.hidden = false;
  chartAndResults.hidden = false;

  // The sampling distribution of p̂₁ − p̂₂ is approximately normal, so the critical
  // value comes off the standard normal curve.
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
    filename: 'confidence-interval-diff-props.png',
    critSymbol: 'z*',
    confInput: inputConf,
    confPills,
    onChange: onFigureChange,
  });

  renderResults(figure.getCrit());
  showConditionsCheckpoint();
  setPageTitle(baseTitle, dataPanel.currentSourceName, { n: currentN1 + currentN2 });
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
  const p1 = currentX1 / currentN1;
  const p2 = currentX2 / currentN2;
  const diff = p1 - p2;
  // Unpooled (Wald) SE — pooling belongs to the null hypothesis, not to an interval.
  const se = Math.sqrt(p1 * (1 - p1) / currentN1 + p2 * (1 - p2) / currentN2);
  const margin = zStar * se;
  const lower = diff - margin;
  const upper = diff + margin;
  const confPct = (confLevel * 100 % 1) ? (confLevel * 100).toFixed(1) : (confLevel * 100).toFixed(0);
  const straddlesZero = lower < 0 && upper > 0;
  const pf = (/** @type {number} */ v) => formatStat(v, 0, 'proportion');

  const V = '\\textcolor{#569BBD}';
  const P = '\\textcolor{#2e7d32}';
  const fx = (/** @type {string} */ key, /** @type {string|number} */ val) =>
    `\\htmlClass{fx-val fx-${key}}{${V}{${val}}}`;
  const fxs = (/** @type {string} */ key, /** @type {string} */ latex) =>
    `\\htmlClass{fx-val fx-${key}}{${latex}}`;

  const ciFormula = tex(`\\begin{aligned}
    &(${fxs('phat1', '\\hat{p}_1')} - ${fxs('phat2', '\\hat{p}_2')}) \\pm z^{\\!*} \\cdot \\sqrt{\\frac{${fxs('phat1', '\\hat{p}_1')}(1-${fxs('phat1', '\\hat{p}_1')})}{${fxs('n1', 'n_1')}} + \\frac{${fxs('phat2', '\\hat{p}_2')}(1-${fxs('phat2', '\\hat{p}_2')})}{${fxs('n2', 'n_2')}}} \\\\[8pt]
    &(${fx('phat1', pf(p1))} - ${fx('phat2', pf(p2))}) \\pm ${V}{${zStar.toFixed(3)}} \\cdot ${V}{${pf(se)}} \\\\[8pt]
    &= ${V}{${pf(diff)}} \\pm ${V}{${pf(margin)}} \\\\[8pt]
    &= ${P}{(${pf(lower)},\\; ${pf(upper)})}
  \\end{aligned}`, true);

  // Dataset contexts already read as "the difference in callback rates between …".
  const paramLabel = currentContext?.parameter || 'the difference in population proportions';

  // Explicit p̂₁/p̂₂ ↔ group mapping + success level, so the sign of the interval
  // is unambiguous (student shouldn't have to infer which group is p̂₁).
  const named = label1 !== 'Group 1' || label2 !== 'Group 2';
  const groupLegend = `
    <div class="group-legend">
      <span><strong>Group 1</strong>${named ? ` = ${escapeHTML(label1)}` : ''} &nbsp;(p̂₁ = ${currentX1}/${currentN1} = ${pf(p1)})</span>
      <span><strong>Group 2</strong>${named ? ` = ${escapeHTML(label2)}` : ''} &nbsp;(p̂₂ = ${currentX2}/${currentN2} = ${pf(p2)})</span>
      ${successValue ? `<span><strong>Success</strong> = &ldquo;${escapeHTML(successValue)}&rdquo;</span>` : ''}
      <span class="legend-diff">Interval reported for <strong>p₁ − p₂</strong></span>
    </div>`;

  resultsPanel.innerHTML = `
    <h3>Group Summary</h3>
    <table class="results-table" aria-label="Group summary statistics">
      <thead>
        <tr><th scope="col">Group</th><th scope="col">Successes</th><th scope="col">${tex('n')}</th><th scope="col">${tex('\\hat{p}')}</th></tr>
      </thead>
      <tbody>
        <tr><td>1 &middot; ${escapeHTML(label1)}</td><td>${currentX1}</td><td data-fx="n1">${currentN1}</td><td data-fx="phat1">${pf(p1)}</td></tr>
        <tr><td>2 &middot; ${escapeHTML(label2)}</td><td>${currentX2}</td><td data-fx="n2">${currentN2}</td><td data-fx="phat2">${pf(p2)}</td></tr>
      </tbody>
    </table>
    ${groupLegend}

    <div class="formula-display formula-ci">
      <h3>${confPct}% Confidence Interval</h3>
      <p class="formula-detail">for ${tex('p_1 - p_2')}, the difference in population proportions</p>
      ${ciFormula}
      <p class="formula-detail">${tex(`z^{\\!*} = ${P}{${zStar.toFixed(3)}}`)} &nbsp;·&nbsp; ${tex(`SE = ${P}{${pf(se)}}`)}</p>
    </div>

    <div class="ci-result-headline" aria-live="polite">
      <span class="ci-bounds">(${pf(lower)}, ${pf(upper)})</span>
    </div>

    <div class="interpretation" aria-live="polite">
      <p>We are <strong>${confPct}%</strong> confident that ${paramLabel}
        (${escapeHTML(label1)} − ${escapeHTML(label2)}) is
        between <strong>${pf(lower)}</strong> and <strong>${pf(upper)}</strong>.</p>
      <p>${straddlesZero
        ? 'The interval <strong>contains 0</strong>, so "no difference" is among the plausible values.'
        : `The interval <strong>does not contain 0</strong> — every plausible value points the same way, toward ${lower > 0 ? escapeHTML(label1) : escapeHTML(label2)} having the larger proportion.`}</p>
    </div>
  `;

  linkFormula(document.querySelector('main') || resultsPanel);
}

// ── Conditions checkpoint ──────────────────────────────────────────
function showConditionsCheckpoint() {
  if (!conditionsCheckpoint) return;

  const counts = [currentX1, currentN1 - currentX1, currentX2, currentN2 - currentX2];
  const ok = counts.every(c => c >= 10);

  const dsId = dataPanel.currentDatasetId;
  const bootLink = dsId
    ? buildSimLink('simulate/bootstrap-two-props/', { dataset: dsId })
    : buildSimLink('simulate/bootstrap-two-props/');

  renderConditionsCheckpoint(conditionsCheckpoint, {
    altLabel: 'Bootstrap CI', altHref: bootLink,
    detailsHTML: `<p>The normal approximation needs at least 10 successes and 10 failures <em>in each group</em>. Here: ${escapeHTML(label1)} has ${currentX1} and ${currentN1 - currentX1}; ${escapeHTML(label2)} has ${currentX2} and ${currentN2 - currentX2} — ${ok ? 'all four are at least 10.' : '<strong>not all four are at least 10</strong>, so this interval may be unreliable.'}</p>`,
  });
}

// ── Helpers ────────────────────────────────────────────────────────

/**
 * @param {string} str
 * @returns {string}
 */
function escapeHTML(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
