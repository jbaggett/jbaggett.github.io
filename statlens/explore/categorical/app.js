// @ts-check
/**
 * Categorical Data explore tool.
 * Contingency table with proportion toggles and bar chart modes.
 */

import { drawBarChart, computeGroupedFrequencies } from '../../js/barchart.js';
import { formatStat } from '../../js/stats.js';
import { announce, initTabs, initDataPanel, initHelp, setPageTitle } from '../../js/page-utils.js';
import { wrapTable } from '../../js/export.js';
import { parseCSV } from '../../js/csv-parser.js';
import { createTableEditor, tableToRows } from '../../js/table-editor.js';

initHelp();
const baseTitle = document.title.replace(/\s*\|\s*StatLens$/, '');

// ── DOM ──────────────────────────────────────────────────────────────

const dataSummary = document.getElementById('data-summary');
const dataPreview = document.getElementById('data-preview');
const variableControls = document.getElementById('variable-controls');
const rowVarSelect = /** @type {HTMLSelectElement} */ (document.getElementById('row-var-select'));
const colVarSelect = /** @type {HTMLSelectElement} */ (document.getElementById('col-var-select'));
const swapBtn = document.getElementById('swap-vars');
const resultsSection = document.getElementById('results-section');
const tableContainer = document.getElementById('table-container');
const chartContainer = document.getElementById('chart-container');
const tableModeSelect = /** @type {HTMLSelectElement} */ (document.getElementById('table-mode'));
const chartModeGroup = document.getElementById('chart-mode');
const proportionNote = document.getElementById('proportion-note');

/** Get the currently selected chart mode from the segmented control. */
function getChartMode() {
  const pressed = /** @type {HTMLButtonElement|null} */ (chartModeGroup?.querySelector('button[aria-pressed="true"]'));
  return pressed?.dataset.value ?? 'stacked';
}

/** Set the chart mode on the segmented control.
 * @param {string} value */
function setChartMode(value) {
  if (!chartModeGroup) return;
  for (const btn of chartModeGroup.querySelectorAll('button')) {
    btn.setAttribute('aria-pressed', String(/** @type {HTMLButtonElement} */ (btn).dataset.value === value));
  }
}
const numRowsInput = /** @type {HTMLInputElement} */ (document.getElementById('num-rows'));
const numColsInput = /** @type {HTMLInputElement} */ (document.getElementById('num-cols'));
const tableInputContainer = /** @type {HTMLElement} */ (document.getElementById('table-input-container'));

initTabs();

// ── Contingency-table editor ─────────────────────────────────────────
//
// This page is about two categorical variables, but until REQ-065 both of its
// visible editors could only express one: a column of values and a list of
// category counts, both copied from `explore/one-cat/`. The only two-variable
// path was a CSV box behind a disclosure triangle. A reviewer sat down to type
// in a 2×2 and found nowhere to put it.
//
// The grid is now the primary editor, because an r×c table of counts is the
// shape a textbook prints and the shape an instructor has on the board. The
// single-variable editors are gone from this page — `explore/one-cat/` is where
// they belong, and it already has them.

/** Which editor the student touched last, so Apply reads the one they meant. */
let lastEdited = /** @type {'grid'|'csv'} */ ('grid');

const tableEditor = createTableEditor({
  container: tableInputContainer,
  rowsInput: numRowsInput,
  colsInput: numColsInput,
  announce,
  totals: true,
  varNames: true,
  defaultRowVar: 'Row',
  defaultColVar: 'Column',
  onEnter: () => handleApply(),
});
tableInputContainer?.addEventListener('input', () => { lastEdited = 'grid'; });
tableInputContainer?.addEventListener('paste', () => { lastEdited = 'grid'; });
document.getElementById('paste-area')?.addEventListener('input', () => { lastEdited = 'csv'; });

// ── State ────────────────────────────────────────────────────────────

/** @type {Array<Record<string, string>>} */
let rawRows = [];
/** @type {string[]} */
let catVarNames = [];
let rowVar = '';
let colVar = '';

/**
 * When true, the chart's x-axis and fill are swapped relative to the table's
 * row/column layout. The table structure stays the same; only the chart
 * perspective and table color-tinting change.
 */
let chartFlipped = false;

// ── Data loading ─────────────────────────────────────────────────────

/**
 * Load parsed CSV data (shared by paste + file).
 * @param {{headers:string[], types:string[], data:Array<Record<string,any>>}} parsed
 * @param {string} sourceName
 */
function loadParsedData(parsed, sourceName) {
  const catIndices = parsed.types
    .map((t, i) => t === 'categorical' ? i : -1)
    .filter(i => i >= 0);
  if (catIndices.length < 1) {
    announce('Need at least one categorical column.');
    return;
  }
  catVarNames = catIndices.map(i => parsed.headers[i]);
  rawRows = parsed.data.map(row => {
    /** @type {Record<string, string>} */
    const obj = {};
    for (const col of catVarNames) obj[col] = String(row[col]);
    return obj;
  });
  setupVariableSelectors(catVarNames);
  showDataLoaded(sourceName);
}

/** Filter: show only datasets with 2+ categorical variables and no numeric. @param {any} ds */
function twoCatFilter(ds) {
  if (ds.hasNumeric) return false;
  if (!ds.hasCategorical) return false;
  const vars = ds.variables || [];
  const catCount = vars.filter(/** @param {any} v */ v =>
    typeof v === 'object' ? v.type === 'categorical' : true
  ).length;
  return catCount >= 2;
}

initDataPanel({
  autoCollapse: true,
  showPreview: true,
  datasetFilter: twoCatFilter,
  onDataset: (ds) => {
    const catVars = ds.variables.filter(/** @param {any} v */ v => v.type === 'categorical');
    if (catVars.length === 0) {
      announce('This dataset has no categorical variables.');
      return;
    }
    catVarNames = catVars.map(/** @param {any} v */ v => v.name);
    rawRows = ds.rows;
    setupVariableSelectors(catVarNames);
    showDataLoaded(ds.name);
  },
  onText: loadParsedData,
  onClear: () => {
    rawRows = [];
    catVarNames = [];
    if (dataPreview) dataPreview.hidden = true;
    if (variableControls) variableControls.hidden = true;
    if (resultsSection) resultsSection.hidden = true;
    if (tableContainer) tableContainer.innerHTML = '';
    if (chartContainer) chartContainer.innerHTML = '';
    numRowsInput.value = '2';
    numColsInput.value = '2';
    tableEditor.clear();
    announce('Data cleared.');
  },
});

/**
 * Load an entered contingency table by expanding its counts into case-level
 * rows, which is what everything downstream (chart, table, percentages)
 * already consumes.
 * @param {import('../../js/table-editor.js').TableData} table
 */
function loadTable(table) {
  catVarNames = [table.rowVar, table.colVar];
  rawRows = tableToRows(table);
  rowVar = table.rowVar;
  colVar = table.colVar;
  setupVariableSelectors(catVarNames);
  rowVarSelect.value = rowVar;
  colVarSelect.value = colVar;
  showDataLoaded('Contingency table');
}

/**
 * Handle the Apply button — check summary table, then spreadsheet, then CSV textarea.
 */
function handleApply() {
  const pasteArea = /** @type {HTMLTextAreaElement|null} */ (document.getElementById('paste-area'));
  const text = pasteArea?.value?.trim();

  // Whichever editor the student touched last is the one they mean. Precedence
  // by position would get this wrong in a common case: loading a dataset fills
  // the CSV box automatically, so a student who then edits the grid and clicks
  // Apply would silently get the old dataset back.
  const csvFirst = lastEdited === 'csv' && !!text;

  if (!csvFirst) {
    const table = tableEditor.read();
    if (table) { loadTable(table); return; }
    if (!text) return; // read() already said what was wrong
  }

  if (text) {
    try {
      loadParsedData(parseCSV(text), 'Edited data');
    } catch (e) {
      announce(`Error parsing data: ${e instanceof Error ? e.message : String(e)}`);
    }
    return;
  }
  announce('Enter counts in the table, or paste case-level CSV.');
}

// Override the default Apply button to use our custom handler
const loadPastedBtn = document.getElementById('load-pasted');
if (loadPastedBtn) {
  const newBtn = /** @type {HTMLElement} */ (loadPastedBtn.cloneNode(true));
  loadPastedBtn.parentNode?.replaceChild(newBtn, loadPastedBtn);
  newBtn.addEventListener('click', handleApply);
}

// ── Variable selectors ───────────────────────────────────────────────

/**
 * @param {string[]} varNames
 */
function setupVariableSelectors(varNames) {
  rowVarSelect.innerHTML = '';
  colVarSelect.innerHTML = '';

  for (const name of varNames) {
    const opt1 = document.createElement('option');
    opt1.value = name;
    opt1.textContent = name;
    rowVarSelect.appendChild(opt1);

    const opt2 = document.createElement('option');
    opt2.value = name;
    opt2.textContent = name;
    colVarSelect.appendChild(opt2);
  }

  // Default: first variable as row, second as column (if available)
  rowVar = varNames[0];
  colVar = varNames.length > 1 ? varNames[1] : varNames[0];
  rowVarSelect.value = rowVar;
  colVarSelect.value = colVar;

  if (variableControls) variableControls.hidden = varNames.length < 2;
}

rowVarSelect.addEventListener('change', () => {
  rowVar = rowVarSelect.value;
  chartFlipped = false;
  updateDisplay();
});

colVarSelect.addEventListener('change', () => {
  colVar = colVarSelect.value;
  chartFlipped = false;
  updateDisplay();
});

if (swapBtn) {
  swapBtn.addEventListener('click', () => {
    chartFlipped = !chartFlipped;
    updateDisplay();
    announce(chartFlipped
      ? `Chart: ${colVar} on x-axis, colored by ${rowVar}.`
      : `Chart: ${rowVar} on x-axis, colored by ${colVar}.`);
  });
}

// ── Display controls ─────────────────────────────────────────────────

tableModeSelect.addEventListener('change', () => updateDisplay());
if (chartModeGroup) {
  for (const btn of chartModeGroup.querySelectorAll('button')) {
    btn.addEventListener('click', () => {
      setChartMode(/** @type {HTMLButtonElement} */ (btn).dataset.value ?? 'stacked');
      updateDisplay();
    });
  }
}

// ── Show data ────────────────────────────────────────────────────────

/**
 * @param {string} sourceName
 */
function showDataLoaded(sourceName) {
  // Reset controls to defaults on new data
  if (tableModeSelect) tableModeSelect.value = 'counts';
  setChartMode('stacked');
  if (dataSummary) dataSummary.textContent = `${sourceName} (n = ${rawRows.length})`;
  updateDisplay();
  setPageTitle(baseTitle, sourceName, { n: rawRows.length });
  announce(`${rawRows.length} observations.`);
}

function updateDisplay() {
  if (rawRows.length === 0) return;

  if (rowVar === colVar) {
    announce('Select two different variables.');
    return;
  }

  {
    const rowValues = rawRows.map(r => r[rowVar]);
    const colValues = rawRows.map(r => r[colVar]);

    // Table always uses rowVar → rows, colVar → columns
    renderTwoVarTable(rowValues, colValues);

    // Chart may flip which variable is x-axis vs fill
    const chartPrimary = chartFlipped ? colValues : rowValues;
    const chartPrimaryLabel = chartFlipped ? colVar : rowVar;
    const chartSecondary = chartFlipped ? rowValues : colValues;
    const chartSecondaryLabel = chartFlipped ? rowVar : colVar;
    renderChart(chartPrimary, chartPrimaryLabel, chartSecondary, chartSecondaryLabel);

    // Color the table dimension that matches the chart's fill variable
    applyTableColors(chartFlipped ? 'row' : 'col');

    // Mirror the cross-tab into the editor, so loading a dataset *shows* you
    // its contingency table — which is what the old one-variable spreadsheet
    // occupied this space failing to do.
    fillGridFromData(rowValues, colValues);

  }

  if (resultsSection) resultsSection.hidden = false;
}

/**
 * Push the current cross-tabulation into the editable grid. Skipped when the
 * table is larger than the grid holds — the display table below handles any
 * size, and silently truncating an instructor's data would be worse than
 * leaving the editor alone.
 * @param {string[]} rowValues
 * @param {string[]} colValues
 */
function fillGridFromData(rowValues, colValues) {
  const { primaryCats, secondaryCats, table } = computeGroupedFrequencies(rowValues, colValues);
  if (primaryCats.length > 10 || secondaryCats.length > 10) return;
  const observed = primaryCats.map(p => secondaryCats.map(sc => table.get(p)?.get(sc) ?? 0));
  tableEditor.setTable({
    observed,
    rowLabels: primaryCats.map(String),
    colLabels: secondaryCats.map(String),
    rowVar, colVar,
  });
}

// ── Contingency table ─────────────────────────────────────────────────

/**
 * @param {string[]} rowValues
 * @param {string[]} colValues
 */
function renderTwoVarTable(rowValues, colValues) {
  if (!tableContainer) return;
  const mode = tableModeSelect.value;

  const { primaryCats, secondaryCats, table, primaryTotals } =
    computeGroupedFrequencies(rowValues, colValues);

  // Column totals
  /** @type {Map<string, number>} */
  const colTotals = new Map();
  for (const s of secondaryCats) {
    let sum = 0;
    for (const p of primaryCats) sum += table.get(p)?.get(s) ?? 0;
    colTotals.set(s, sum);
  }
  const grandTotal = rowValues.length;

  let html = `<table class="contingency-table" aria-label="Contingency table: ${rowVar} × ${colVar}">`;
  html += `<thead><tr><th scope="col">${rowVar} \\ ${colVar}</th>`;
  for (const s of secondaryCats) {
    html += `<th scope="col">${s}</th>`;
  }
  html += '<th scope="col" class="total-col">Total</th></tr></thead><tbody>';

  for (const p of primaryCats) {
    html += `<tr><th scope="row">${p}</th>`;
    const rowTotal = primaryTotals.get(p) ?? 0;
    for (const s of secondaryCats) {
      const count = table.get(p)?.get(s) ?? 0;
      html += `<td>${formatCell(count, rowTotal, colTotals.get(s) ?? 0, grandTotal, mode)}</td>`;
    }
    html += `<td class="total-col">${formatTotal(rowTotal, grandTotal, mode, 'row')}</td>`;
    html += '</tr>';
  }

  // Total row
  html += '<tr class="total-row"><th scope="row">Total</th>';
  for (const s of secondaryCats) {
    const ct = colTotals.get(s) ?? 0;
    html += `<td>${formatTotal(ct, grandTotal, mode, 'col')}</td>`;
  }
  html += `<td class="total-col">${mode === 'counts' ? grandTotal : formatStat(1, 0, 'proportion')}</td>`;
  html += '</tr></tbody></table>';

  tableContainer.innerHTML = html;

  const tableEl = /** @type {HTMLTableElement|null} */ (tableContainer.querySelector('table'));
  if (tableEl) wrapTable(tableEl, { copyTitle: 'Copy contingency table to clipboard' });

  // Proportion note
  if (proportionNote) {
    if (mode === 'row') {
      proportionNote.textContent = 'Each row sums to 1. Read across to compare within each row category.';
      proportionNote.hidden = false;
    } else if (mode === 'col') {
      proportionNote.textContent = 'Each column sums to 1. Read down to compare within each column category.';
      proportionNote.hidden = false;
    } else if (mode === 'cell') {
      proportionNote.textContent = 'All cells sum to 1. Each value is the proportion of the total.';
      proportionNote.hidden = false;
    } else {
      proportionNote.hidden = true;
    }
  }
}

/**
 * @param {number} count
 * @param {number} rowTotal
 * @param {number} colTotal
 * @param {number} grandTotal
 * @param {string} mode
 * @returns {string}
 */
function formatCell(count, rowTotal, colTotal, grandTotal, mode) {
  switch (mode) {
    case 'row': return formatStat(count / rowTotal, 0, 'proportion');
    case 'col': return formatStat(count / colTotal, 0, 'proportion');
    case 'cell': return formatStat(count / grandTotal, 0, 'proportion');
    default: return String(count);
  }
}

/**
 * @param {number} subtotal
 * @param {number} grandTotal
 * @param {string} mode
 * @param {'row'|'col'} direction
 * @returns {string}
 */
function formatTotal(subtotal, grandTotal, mode, direction) {
  if (mode === 'counts') return String(subtotal);
  if (mode === direction) return formatStat(1, 0, 'proportion');
  return formatStat(subtotal / grandTotal, 0, 'proportion');
}

// ── Bar chart ────────────────────────────────────────────────────────

/** Last color map from grouped chart (for table tinting). @type {null | { categories: string[], colors: string[] }} */
let lastColorMap = null;

/**
 * @param {string[]} primaryValues
 * @param {string} primaryLabel
 * @param {string[]} [secondaryValues]
 * @param {string} [secondaryLabel]
 */
function renderChart(primaryValues, primaryLabel, secondaryValues, secondaryLabel) {
  if (!chartContainer) return;
  chartContainer.innerHTML = '';
  lastColorMap = null;

  const chartMode = getChartMode();

  if (chartMode === 'relative' || !secondaryValues) {
    // Single-variable bar chart
    drawBarChart(chartContainer, primaryValues, {
      mode: chartMode === 'relative' ? 'relative' : 'frequency',
      xLabel: primaryLabel,
      titleText: `${primaryLabel}`,
      id: 'cat-chart',
      animate: false,
    });
  } else {
    // Grouped bar chart — use dodged for frequency, stacked/filled as selected
    const barMode = /** @type {import('../../js/barchart.js').BarMode} */ (
      chartMode === 'frequency' ? 'dodged' : chartMode);
    const result = drawBarChart(chartContainer, primaryValues, {
      mode: barMode,
      groupValues: secondaryValues,
      groupLabel: secondaryLabel,
      xLabel: primaryLabel,
      titleText: `${primaryLabel} by ${secondaryLabel}`,
      id: 'cat-chart',
      animate: false,
    });
    lastColorMap = result.colorMap ?? null;
  }
}

// ── Table ↔ Chart color link ─────────────────────────────────────────

/**
 * Apply light color tints to the contingency table dimension that matches
 * the chart's fill/group variable.
 *
 * @param {'row'|'col'} dimension - Which table dimension to color.
 *   'col' = the chart fill variable is the table's column variable (default).
 *   'row' = the chart fill variable is the table's row variable (flipped).
 */
function applyTableColors(dimension) {
  if (!lastColorMap || !tableContainer) return;
  const { categories, colors } = lastColorMap;

  const table = tableContainer.querySelector('table');
  if (!table) return;

  // Build a map: category text → color
  /** @type {Map<string, string>} */
  const colorByCategory = new Map();
  for (let i = 0; i < categories.length; i++) {
    colorByCategory.set(categories[i], colors[i % colors.length]);
  }

  if (dimension === 'col') {
    // Color table columns (column variable = chart fill variable)
    const headerRow = table.querySelector('thead tr');
    if (!headerRow) return;
    const ths = headerRow.querySelectorAll('th');

    /** @type {Map<number, string>} */
    const colIndexToColor = new Map();
    ths.forEach((th, i) => {
      if (i === 0) return; // row variable label
      const text = th.textContent?.trim() ?? '';
      const color = colorByCategory.get(text);
      if (color) {
        colIndexToColor.set(i, color);
        th.style.borderBottom = `3px solid ${color}`;
      }
    });

    const bodyRows = table.querySelectorAll('tbody tr, tfoot tr');
    bodyRows.forEach(row => {
      const cells = row.querySelectorAll('th, td');
      cells.forEach((cell, i) => {
        const color = colIndexToColor.get(i);
        if (color) {
          /** @type {HTMLElement} */ (cell).style.backgroundColor = color + '18';
        }
      });
    });
  } else {
    // Color table rows (row variable = chart fill variable)
    const bodyRows = table.querySelectorAll('tbody tr');
    bodyRows.forEach(row => {
      const th = row.querySelector('th[scope="row"]');
      if (!th) return;
      const text = th.textContent?.trim() ?? '';
      const color = colorByCategory.get(text);
      if (!color) return;

      // Color the row header with a solid border and tint all cells in this row
      /** @type {HTMLElement} */ (th).style.borderLeft = `3px solid ${color}`;
      row.querySelectorAll('td').forEach(cell => {
        /** @type {HTMLElement} */ (cell).style.backgroundColor = color + '18';
      });
    });
  }
}
