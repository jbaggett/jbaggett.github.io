// @ts-check
/**
 * Two-Proportion z-Test and Confidence Interval — StatLens
 * Supports dataset loading, paste/file input, and manual summary entry.
 */

import * as jstat from 'jstat';
import { setJStat, pdfNormal } from '../../js/distributions.js';
import { twoPropZ } from '../../js/inference.js';
import { drawCurve, computeDomain, addInferenceAnnotations } from '../../js/curve.js';
import { formatStat } from '../../js/stats.js';
import { generateConclusions, findContext } from '../../js/conclusions.js';
import { announce, initTabs, initDataPanel, initKeyboardShortcuts, initHypToggle, getActiveTabId, getTabHintText, buildSimLink, setPageTitle, renderConditionsCheckpoint } from '../../js/page-utils.js';
import { linkFormula } from '../../js/formula-link.js';

import { tex } from '../../js/tex.js';

// jStat's ESM build exposes the object as the default export; the bare namespace
// has no `.normal`/`.cdf`, which silently broke compute(). Use the interop form.
setJStat(jstat.default || jstat);

const baseTitle = document.title.replace(/\s*\|\s*StatLens$/, '');

// ── DOM references ──────────────────────────────────────────────────
const inputLabel1 = /** @type {HTMLInputElement} */ (document.getElementById('input-label1'));
const inputX1 = /** @type {HTMLInputElement} */ (document.getElementById('input-x1'));
const inputN1 = /** @type {HTMLInputElement} */ (document.getElementById('input-n1'));
const inputLabel2 = /** @type {HTMLInputElement} */ (document.getElementById('input-label2'));
const inputX2 = /** @type {HTMLInputElement} */ (document.getElementById('input-x2'));
const inputN2 = /** @type {HTMLInputElement} */ (document.getElementById('input-n2'));
const inputAlt = initHypToggle('input-alternative', () => {
  if (resultsPanel.querySelector('.results-table')) compute();
});
const computeBtn = /** @type {HTMLButtonElement} */ (document.getElementById('compute-btn'));
const conditionsCheckpoint = /** @type {HTMLElement} */ (document.getElementById('conditions-checkpoint'));
const resultsPanel = /** @type {HTMLElement} */ (document.getElementById('results-panel'));
const chartContainer = /** @type {HTMLElement} */ (document.getElementById('chart-container'));
const dataPreview = document.getElementById('data-preview');
const dataSummary = document.getElementById('data-summary');
const groupVarSelect = /** @type {HTMLSelectElement|null} */ (document.getElementById('group-var-select'));
const outcomeVarSelect = /** @type {HTMLSelectElement|null} */ (document.getElementById('outcome-var-select'));
const variableSelectors = document.getElementById('variable-selectors');
const successSelector = document.getElementById('success-selector');
const successOutcome = /** @type {HTMLSelectElement|null} */ (document.getElementById('success-outcome'));
const groupOrderEl = document.getElementById('group-order');
const swapGroupsBtn = document.getElementById('swap-groups');
const loadSummaryBtn = document.getElementById('load-summary');
const inputP0 = /** @type {HTMLInputElement} */ (document.getElementById('input-p0'));
const nullDisplay = document.getElementById('null-display');

function syncNullDisplay() {
  if (nullDisplay) nullDisplay.textContent = inputP0.value || '0';
}
inputP0.addEventListener('input', syncNullDisplay);
syncNullDisplay();
inputP0.addEventListener('input', () => {
  if (resultsPanel.querySelector('.results-table')) compute();
});

initTabs({ hintTarget: resultsPanel, hintAction: 'see results' });
initKeyboardShortcuts();

// ── State ───────────────────────────────────────────────────────────
/** @type {Array<Record<string, string>>} Raw rows from loaded data */
let rawRows = [];
/** @type {string[]} Categorical variable names */
let catVarNames = [];
/** Current group variable name */
let groupVar = '';
/** Current outcome variable name */
let outcomeVar = '';
/** Current success outcome value */
let successValue = '';
/** Group 1 label */
let label1 = 'Group 1';
/** Group 2 label */
let label2 = 'Group 2';
/** Group 1 successes */
let currentX1 = 0;
/** Group 1 sample size */
let currentN1 = 0;
/** Group 2 successes */
let currentX2 = 0;
/** Group 2 sample size */
let currentN2 = 0;
/** Whether data was loaded from a dataset/paste/file (vs. summary) */
let fromRawData = false;
/** Whether the two groups have been swapped (Group 1 ↔ Group 2) — persists across recomputes. */
let groupsSwapped = false;

/** @type {import('../../js/conclusions.js').ConclusionContext|null} */
let currentContext = null;

// ── Data loading ────────────────────────────────────────────────────

const dataPanel = initDataPanel({
  autoCollapse: true, stickyControls: true, showPreview: true,
  // Two-proportion z requires a 2x2 design (randomization_prop). chisq-typed
  // datasets are multi-level contingency tables and would silently run on only
  // the first two levels — exclude them; they belong to the chi-square tool (REQ-024).
  datasetFilter: (/** @type {any} */ ds) => ds.type === 'randomization_prop',
  onDataset: (ds) => {
    const ctx = findContext(ds, 'two-props');
    currentContext = ctx;
    if (ctx && ctx.nullValue != null) {
      inputP0.value = String(ctx.nullValue);
      syncNullDisplay();
    }
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

    setupVariableSelectors(catVarNames, ds.name);
  },
  onText: (parsed, sourceName) => {
    currentContext = null;
    const catIndices = parsed.types
      .map((t, i) => t === 'categorical' ? i : -1)
      .filter(i => i >= 0);
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

    setupVariableSelectors(catVarNames, sourceName);
  },
  onClear: () => {
    rawRows = [];
    catVarNames = [];
    currentX1 = 0; currentN1 = 0;
    currentX2 = 0; currentN2 = 0;
    fromRawData = false;
    currentContext = null;
    if (dataPreview) dataPreview.hidden = true;
    if (variableSelectors) variableSelectors.hidden = true;
    if (successSelector) successSelector.hidden = true;
    if (groupLegendEl) { groupLegendEl.hidden = true; groupLegendEl.innerHTML = ''; }
    groupsSwapped = false;
    if (groupOrderEl) groupOrderEl.hidden = true;
    chartContainer.innerHTML = '';
    resultsPanel.innerHTML = `<p class="placeholder">${getTabHintText(getActiveTabId(), 'see results')}</p>`;
    announce('Data cleared.');
  },
});

/**
 * Populate group and outcome variable selectors.
 * @param {string[]} varNames
 * @param {string} sourceName
 */
function setupVariableSelectors(varNames, sourceName) {
  if (!groupVarSelect || !outcomeVarSelect || !variableSelectors) return;
  groupsSwapped = false;  // fresh data starts in natural order

  groupVarSelect.innerHTML = '';
  outcomeVarSelect.innerHTML = '';
  for (const name of varNames) {
    const opt1 = document.createElement('option');
    opt1.value = name; opt1.textContent = name;
    groupVarSelect.appendChild(opt1);

    const opt2 = document.createElement('option');
    opt2.value = name; opt2.textContent = name;
    outcomeVarSelect.appendChild(opt2);
  }

  // Default: first as group, second as outcome
  groupVar = varNames[0];
  outcomeVar = varNames.length > 1 ? varNames[1] : varNames[0];
  groupVarSelect.value = groupVar;
  outcomeVarSelect.value = outcomeVar;
  variableSelectors.hidden = false;

  groupVarSelect.onchange = () => { groupVar = groupVarSelect.value; groupsSwapped = false; showSuccessSelector(sourceName); };
  outcomeVarSelect.onchange = () => { outcomeVar = outcomeVarSelect.value; showSuccessSelector(sourceName); };

  showSuccessSelector(sourceName);
}

/**
 * Show the success outcome selector for the outcome variable.
 * @param {string} sourceName
 */
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
  // Prefer the dataset's defined success label; fall back to the first outcome.
  successValue = (currentContext?.successLabel && outcomes.includes(currentContext.successLabel))
    ? currentContext.successLabel : outcomes[0];
  successOutcome.value = successValue;

  if (countFromData(sourceName)) compute(); // auto-compute — dataset defines success
  successOutcome.onchange = () => {
    successValue = successOutcome.value;
    if (countFromData(sourceName)) compute();
  };
}

/**
 * Count successes per group from the raw data.
 * @param {string} sourceName
 */
function countFromData(sourceName) {
  const groups = [...new Set(rawRows.map(r => r[groupVar]))];
  if (groups.length < 2) {
    announce('The grouping variable needs at least 2 groups.');
    return false;
  }

  // Group order (which level is Group 1 = p̂₁) respects the swap toggle so it
  // persists across recomputes. The student can flip it to control the sign of
  // the difference (some prefer to label so p̂₁ − p̂₂ comes out positive).
  label1 = groupsSwapped ? groups[1] : groups[0];
  label2 = groupsSwapped ? groups[0] : groups[1];
  const g1Rows = rawRows.filter(r => r[groupVar] === label1);
  const g2Rows = rawRows.filter(r => r[groupVar] === label2);
  currentN1 = g1Rows.length;
  currentN2 = g2Rows.length;
  currentX1 = g1Rows.filter(r => r[outcomeVar] === successValue).length;
  currentX2 = g2Rows.filter(r => r[outcomeVar] === successValue).length;
  fromRawData = true;

  if (dataSummary) {
    const p1 = currentN1 > 0 ? formatStat(currentX1 / currentN1, 0, 'proportion') : '—';
    const p2 = currentN2 > 0 ? formatStat(currentX2 / currentN2, 0, 'proportion') : '—';
    dataSummary.textContent =
      `${sourceName}: ${label1} ${currentX1}/${currentN1} (p\u0302=${p1}), ${label2} ${currentX2}/${currentN2} (p\u0302=${p2}). Success = "${successValue}"`;
  }
  announce(`${label1}: ${currentX1}/${currentN1}, ${label2}: ${currentX2}/${currentN2}.`);
  renderGroupLegend();
  if (groupOrderEl) groupOrderEl.hidden = false;
  return true;
}

// Swap Group 1 ↔ Group 2 so the sign of the difference flips. The whole display
// re-renders from the swapped state, so every "Group 1 − Group 2" reference, the
// CI, and the interpretation update accordingly.
if (swapGroupsBtn) {
  swapGroupsBtn.addEventListener('click', () => {
    if (fromRawData) {
      groupsSwapped = !groupsSwapped;
      if (countFromData(dataPanel.currentSourceName || 'data')) compute();
    } else {
      // Summary mode: swap the entered values; the input listeners recompute.
      [inputX1.value, inputX2.value] = [inputX2.value, inputX1.value];
      [inputN1.value, inputN2.value] = [inputN2.value, inputN1.value];
      [inputLabel1.value, inputLabel2.value] = [inputLabel2.value, inputLabel1.value];
      if (applySummaryInputs()) compute();
    }
    announce(`Swapped groups: now ${label1} − ${label2}.`);
  });
}

const groupLegendEl = document.getElementById('group-legend');

/**
 * Render the "which group is p̂₁ vs p̂₂" legend into the top container (next to the
 * hypotheses), so students can decide the alternative direction without scrolling
 * to the results. Shown only when the groups have real names (raw data); in
 * summary mode the input fields are already labelled Group 1 / Group 2.
 */
function renderGroupLegend() {
  if (!groupLegendEl) return;
  const named = label1 !== 'Group 1' || label2 !== 'Group 2';
  if (!named || currentN1 <= 0 || currentN2 <= 0) {
    groupLegendEl.hidden = true;
    groupLegendEl.innerHTML = '';
    return;
  }
  const p1 = formatStat(currentX1 / currentN1, 0, 'proportion');
  const p2 = formatStat(currentX2 / currentN2, 0, 'proportion');
  groupLegendEl.innerHTML = `
    <span><strong>Group 1</strong> = ${escapeHTML(label1)} &nbsp;(p̂₁ = ${currentX1}/${currentN1} = ${p1})</span>
    <span><strong>Group 2</strong> = ${escapeHTML(label2)} &nbsp;(p̂₂ = ${currentX2}/${currentN2} = ${p2})</span>
    <span class="legend-diff">Hypotheses &amp; CI are about <strong>p₁ − p₂</strong></span>`;
  groupLegendEl.hidden = false;
}

// ── Summary input ───────────────────────────────────────────────────

/** Is the "Enter Summary" tab the active data source? */
function summaryActive() {
  return document.getElementById('tab-summary')?.getAttribute('aria-selected') === 'true';
}

/**
 * Read + validate the summary-stat fields into the current-sample state.
 * No separate "Load" step needed \u2014 Compute and live edits call this directly.
 * @param {boolean} [quiet] - When true (live typing), don't announce validation errors.
 * @returns {boolean} true if the inputs form a valid two-proportion summary
 */
function applySummaryInputs(quiet) {
  const x1 = Math.round(Number(inputX1.value));
  const n1 = Math.round(Number(inputN1.value));
  const x2 = Math.round(Number(inputX2.value));
  const n2 = Math.round(Number(inputN2.value));

  const fail = (/** @type {string} */ msg) => { if (!quiet) announce(msg); return false; };
  if (!Number.isFinite(n1) || n1 < 1) return fail('n\u2081 must be at least 1.');
  if (!Number.isFinite(n2) || n2 < 1) return fail('n\u2082 must be at least 1.');
  if (!Number.isFinite(x1) || x1 < 0 || x1 > n1) return fail('Successes for Group 1 must be between 0 and n\u2081.');
  if (!Number.isFinite(x2) || x2 < 0 || x2 > n2) return fail('Successes for Group 2 must be between 0 and n\u2082.');

  currentX1 = x1; currentN1 = n1;
  currentX2 = x2; currentN2 = n2;
  label1 = inputLabel1.value.trim() || 'Group 1';
  label2 = inputLabel2.value.trim() || 'Group 2';
  fromRawData = false;

  if (dataSummary) {
    dataSummary.textContent =
      `Summary: ${label1} ${currentX1}/${currentN1}, ${label2} ${currentX2}/${currentN2}`;
  }
  renderGroupLegend();
  if (groupOrderEl) groupOrderEl.hidden = false;
  return true;
}

// Optional explicit "Load" button (kept for discoverability) \u2014 same path as typing.
if (loadSummaryBtn) {
  loadSummaryBtn.addEventListener('click', () => {
    if (applySummaryInputs()) {
      dataPanel.triggerPostLoad();
      compute();
      announce(`Loaded summary: ${label1} ${currentX1}/${currentN1}, ${label2} ${currentX2}/${currentN2}.`);
    }
  });
}

// Live update: typing valid summary stats recomputes immediately \u2014 no Load click.
for (const el of [inputX1, inputN1, inputX2, inputN2, inputLabel1, inputLabel2]) {
  el.addEventListener('input', () => {
    if (!summaryActive()) return;
    if (applySummaryInputs(true)) compute();
  });
}

// ── Event listeners ─────────────────────────────────────────────────
// No Compute button — every input recomputes live. Confidence level recomputes on
// change (blur / Enter / spinner); the null value, alternative, success outcome, and
// summary fields already recompute on change/typing.
computeBtn?.addEventListener('click', compute);

// Confidence level is chosen from a dropdown inlined into the CI heading (rebuilt
// on each compute). Keep it in state and listen via delegation on the persistent
// results container so the handler survives the rebuild; restore keyboard focus.
let confLevelState = 0.95;
let confFocusPending = false;
resultsPanel.addEventListener('change', (e) => {
  const t = /** @type {HTMLElement} */ (e.target);
  if (t && t.id === 'conf-level') {
    confLevelState = Number(/** @type {HTMLSelectElement} */ (t).value);
    if (resultsPanel.querySelector('.results-table')) { confFocusPending = true; compute(); }
  }
});

/** Build the inline confidence-level dropdown that lives in the CI heading. */
function confSelectHTML(confLevel) {
  const levels = [0.90, 0.95, 0.99];
  if (!levels.some(l => Math.abs(l - confLevel) < 1e-9)) levels.push(confLevel);
  levels.sort((a, b) => a - b);
  const opts = levels.map(l => {
    const pct = +(l * 100).toFixed(1);
    return `<option value="${l}"${Math.abs(l - confLevel) < 1e-9 ? ' selected' : ''}>${pct}%</option>`;
  }).join('');
  return `<select id="conf-level" class="ci-conf-select" aria-label="Confidence level">${opts}</select>`;
}

// Note: alternative change handler is wired via initHypToggle callback above

// ── Main computation ────────────────────────────────────────────────

function compute() {
  // In summary mode, read the fields directly so Compute works without a
  // separate "Load" click (and bail quietly if they aren't valid yet).
  if (summaryActive() && !applySummaryInputs()) return;
  if (currentN1 < 1 || currentN2 < 1) {
    announce('Load data or enter summary statistics first.');
    return;
  }

  const alternative = /** @type {'less'|'greater'|'two-sided'} */ (inputAlt.getValue());
  const confLevel = confLevelState;

  if (!Number.isFinite(confLevel) || confLevel <= 0 || confLevel >= 1) {
    announce('Confidence level must be between 0 and 1 (exclusive).');
    return;
  }

  // ── Conditions checkpoint ──
  const pHat1 = currentX1 / currentN1;
  const pHat2 = currentX2 / currentN2;
  if (conditionsCheckpoint) {
    const dsId = dataPanel.currentDatasetId;
    const randLink = dsId
      ? buildSimLink('simulate/randomization-diff-props/', { dataset: dsId })
      : buildSimLink('simulate/randomization-diff-props/');
    const counts = [
      `n\u2081p\u0302\u2081 = ${formatStat(currentN1 * pHat1, 0, 'stat')}`,
      `n\u2081(1\u2212p\u0302\u2081) = ${formatStat(currentN1 * (1 - pHat1), 0, 'stat')}`,
      `n\u2082p\u0302\u2082 = ${formatStat(currentN2 * pHat2, 0, 'stat')}`,
      `n\u2082(1\u2212p\u0302\u2082) = ${formatStat(currentN2 * (1 - pHat2), 0, 'stat')}`,
    ].join(', ');
    renderConditionsCheckpoint(conditionsCheckpoint, {
      altLabel: 'Randomization Test', altHref: randLink,
      detailsHTML: `<p>For the two-proportion z-test, each group needs at least 5 successes and 5 failures: ${counts}.</p>`,
    });
  }

  // ── Run test ──
  const nullDiff = Number(inputP0.value) || 0;
  const result = twoPropZ(currentX1, currentN1, currentX2, currentN2, { alternative, confLevel, nullDiff });

  // ── Display results ──
  displayResults(result, label1, label2);

  // ── Draw chart ──
  drawChart(result);

  // ── Screen reader announcement ──
  const pStr = formatStat(result.pValue, 0, 'pvalue');
  announce(`z = ${formatStat(result.zStat, 0, 'correlation')}, ${pStr}. ${(confLevel * 100).toFixed(0)}% CI for p\u2081 \u2212 p\u2082: (${formatStat(result.ciLower, 0, 'proportion')}, ${formatStat(result.ciUpper, 0, 'proportion')}).`);
}

// ── Display results ─────────────────────────────────────────────────

/**
 * Render results in the sidebar panel.
 * @param {import('../../js/inference.js').TwoPropResult} r
 * @param {string} lbl1
 * @param {string} lbl2
 */
function displayResults(r, lbl1, lbl2) {
  setPageTitle(baseTitle, dataPanel.currentSourceName, { n: currentN1 + currentN2 });
  const altSymbol = r.alternative === 'two-sided' ? '\u2260'
    : r.alternative === 'less' ? '<' : '>';
  const altWord = r.alternative === 'two-sided' ? 'different from'
    : r.alternative === 'less' ? 'less than' : 'greater than';

  let pInterpretation;
  if (r.pValue < 0.001) {
    pInterpretation = 'very strong evidence against H\u2080';
  } else if (r.pValue < 0.01) {
    pInterpretation = 'strong evidence against H\u2080';
  } else if (r.pValue < 0.05) {
    pInterpretation = 'moderate evidence against H\u2080';
  } else if (r.pValue < 0.10) {
    pInterpretation = 'weak evidence against H\u2080';
  } else {
    pInterpretation = 'little to no evidence against H\u2080';
  }

  const confPct = (r.confLevel * 100).toFixed(0);
  const seCount = Math.abs(r.zStat);
  const seDirection = r.zStat > 0 ? 'above' : r.zStat < 0 ? 'below' : 'at';

  // z* for CI
  const zStar = r.se > 0 ? ((r.ciUpper - r.ciLower) / 2 / r.se).toFixed(3) : '—';

  const V = '\\textcolor{#569BBD}';
  const S = '\\textcolor{#7B2D8E}';
  const P = '\\textcolor{#2e7d32}';
  // C3: wrap a plugged-in value so it links to its source on hover/focus.
  const fx = (/** @type {string} */ key, /** @type {string|number} */ val) =>
    `\\htmlClass{fx-val fx-${key}}{${V}{${val}}}`;
  // C3: wrap a symbol (symbolic line) so it links to the same source as its plugged-in value.
  const fxs = (/** @type {string} */ key, /** @type {string} */ latex) =>
    `\\htmlClass{fx-val fx-${key}}{${latex}}`;

  const testFormula = tex(`\\begin{aligned}
    z &= \\frac{${fxs('phat1', '\\hat{p}_1')} - ${fxs('phat2', '\\hat{p}_2')}}{\\sqrt{${fxs('phatpool', '\\hat{p}')}(1-${fxs('phatpool', '\\hat{p}')})\\left(\\frac{1}{${fxs('n1', 'n_1')}} + \\frac{1}{${fxs('n2', 'n_2')}}\\right)}} \\\\[10pt]
    &= \\frac{${fx('phat1', formatStat(r.pHat1, 0, 'proportion'))} - ${fx('phat2', formatStat(r.pHat2, 0, 'proportion'))}}{\\sqrt{${fx('phatpool', formatStat(r.pooledP, 0, 'proportion'))}(1-${fx('phatpool', formatStat(r.pooledP, 0, 'proportion'))})\\left(\\frac{1}{${fx('n1', r.n1)}} + \\frac{1}{${fx('n2', r.n2)}}\\right)}} \\\\[10pt]
    &= ${S}{${formatStat(r.zStat, 0, 'correlation')}}
  \\end{aligned}`, true);

  const ciFormula = tex(`\\begin{aligned}
    &(${fxs('phat1', '\\hat{p}_1')} - ${fxs('phat2', '\\hat{p}_2')}) \\pm z^* \\cdot SE \\\\[8pt]
    &(${fx('phat1', formatStat(r.pHat1, 0, 'proportion'))} - ${fx('phat2', formatStat(r.pHat2, 0, 'proportion'))}) \\pm ${V}{${zStar}} \\cdot ${V}{${formatStat(r.se, 0, 'proportion')}} \\\\[8pt]
    &= ${P}{(${formatStat(r.ciLower, 0, 'proportion')},\\; ${formatStat(r.ciUpper, 0, 'proportion')})}
  \\end{aligned}`, true);

  resultsPanel.innerHTML = `
    <h3>Sample Summary</h3>
    <table class="results-table" aria-label="Sample summary">
      <thead>
        <tr><th></th><th scope="col">1 &middot; ${escapeHTML(lbl1)}</th><th scope="col">2 &middot; ${escapeHTML(lbl2)}</th></tr>
      </thead>
      <tbody>
        <tr><th scope="row">Successes</th><td>${Math.round(r.pHat1 * r.n1)}</td><td>${Math.round(r.pHat2 * r.n2)}</td></tr>
        <tr><th scope="row">${tex('n')}</th><td data-fx="n1">${r.n1}</td><td data-fx="n2">${r.n2}</td></tr>
        <tr><th scope="row">${tex('\\hat{p}')}</th><td data-fx="phat1">${formatStat(r.pHat1, 0, 'proportion')}</td><td data-fx="phat2">${formatStat(r.pHat2, 0, 'proportion')}</td></tr>
      </tbody>
    </table>

    <div class="formula-display">
      <h3>Test Statistic</h3>
      ${testFormula}
      <p class="formula-detail"><span class="fx-src" data-fx="phatpool">${tex(`\\text{Pooled } \\hat{p} = ${V}{${formatStat(r.pooledP, 0, 'proportion')}}`)}</span></p>
      <p class="formula-detail">${tex(`\\text{p-value} = ${P}{${formatStat(r.pValue, 0, 'pvalue')}}`)}</p>
    </div>

    <div class="formula-display formula-ci">
      <h3>${confSelectHTML(r.confLevel)} CI for ${tex('p_1 - p_2')}</h3>
      ${ciFormula}
    </div>

    <div class="interpretation">
      <p>${tex('\\hat{p}_1 - \\hat{p}_2')} = ${formatStat(r.diff, 0, 'proportion')} is ${formatStat(seCount, 0, 'correlation')} SEs ${seDirection} ${formatStat(Number(inputP0.value) || 0, 0, 'proportion')}.</p>
      ${(() => {
        const alpha = 1 - r.confLevel;
        const c = generateConclusions({
          pValue: r.pValue, alpha, alternative: r.alternative,
          testType: 'two-props', statName: 'z',
          statValue: formatStat(r.zStat, 0, 'correlation'),
          context: { parameter: currentContext?.parameter, nullValue: Number(inputP0.value) || 0, claim: currentContext?.claim },
        });
        let html = `<p><strong>Formal conclusion:</strong> ${c.formal}</p>`;
        if (c.practical) html += `<p><strong>Practical conclusion:</strong> ${c.practical}</p>`;
        return html;
      })()}
      <p>${confPct}% CI: (${formatStat(r.ciLower, 0, 'proportion')}, ${formatStat(r.ciUpper, 0, 'proportion')}).</p>
    </div>
    ${(() => {
      const dsId = dataPanel.currentDatasetId;
      return dsId
        ? `<p class="hint">Explore this data: <a href="${buildSimLink('explore/categorical/', { dataset: dsId })}" target="_blank" rel="noopener">open in the explorer ↗</a></p>`
        : '';
    })()}
  `;

  // C3: link formula values (p̂₁, p̂₂, n₁, n₂, pooled p̂) to their sources in the summary.
  linkFormula(document.querySelector('main') || resultsPanel);

  // Keyboard users stay on the inline confidence dropdown after it rebuilds.
  if (confFocusPending) {
    /** @type {HTMLElement|null} */ (resultsPanel.querySelector('#conf-level'))?.focus();
    confFocusPending = false;
  }
}

// ── Chart ───────────────────────────────────────────────────────────

/**
 * Draw the standard normal curve with z-statistic marked and p-value shaded.
 * @param {import('../../js/inference.js').TwoPropResult} r
 */
function drawChart(r) {
  chartContainer.innerHTML = '';

  const domain = computeDomain('normal', { mu: 0, sigma: 1 });
  const pdfFn = (/** @type {number} */ x) => pdfNormal(x, 0, 1);

  /** @type {'left'|'right'|'both'|undefined} */
  let tail;
  /** @type {number|undefined} */
  let critValue;
  /** @type {number|undefined} */
  let critLow;
  /** @type {number|undefined} */
  let critHigh;

  if (r.alternative === 'less') {
    tail = 'left';
    critValue = r.zStat;
  } else if (r.alternative === 'greater') {
    tail = 'right';
    critValue = r.zStat;
  } else {
    tail = 'both';
    critLow = -Math.abs(r.zStat);
    critHigh = Math.abs(r.zStat);
  }

  const chart = drawCurve(chartContainer, pdfFn, domain, {
    xLabel: 'z',
    yLabel: 'Density',
    titleText: 'Standard Normal Distribution (z-test)',
    descText: `Standard normal curve with z = ${r.zStat.toFixed(3)} marked and p-value region shaded.`,
    id: 'z-curve',
    tail,
    critValue,
    critLow,
    critHigh,
  });

  if (chart && isFinite(r.zStat)) {
    addInferenceAnnotations(chart, {
      statValue: tail === 'both' ? Math.abs(r.zStat) : r.zStat, // signed for one-sided so the line aligns with the shaded tail
      statLabel: 'z',
      pValue: r.pValue,
      pdfFn,
      tail,
      statValueNeg: tail === 'both' ? -Math.abs(r.zStat) : undefined,
    });
  }

}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * @param {string} str
 * @returns {string}
 */
function escapeHTML(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
