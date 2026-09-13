// @ts-check
/**
 * Editable r×c contingency-table editor.
 *
 * Extracted from `inference/chisq/app.js`, which held the only working copy, so
 * that `explore/categorical` can stop shipping one-variable editors on a
 * two-variable page (REQ-065 — reported by a reviewer who sat down and tried to
 * type in a 2×2).
 *
 * Two things the original lacked are added here because a *copied* table needs
 * them: live row/column/grand totals, which catch the transcription slips that
 * are the main failure mode when copying a table out of a book, and
 * paste-a-block, which turns copying a 2×2 out of Excel or Word into one
 * keystroke.
 *
 * The DOM contract from the chisq version is preserved — `cell-<i>-<j>`,
 * `row-label-<i>`, `col-label-<j>` — so that page's behaviour, and anything
 * driving it from outside, keeps working.
 */

/**
 * @typedef {object} TableData
 * @property {number[][]} observed - counts, `observed[i][j]`
 * @property {string[]} rowLabels - level names of the row variable
 * @property {string[]} colLabels - level names of the column variable
 * @property {string} rowVar - name of the row variable ('' when not shown)
 * @property {string} colVar - name of the column variable ('' when not shown)
 */

/** Is this text a count rather than a label? Blank counts as a count (empty cell). */
const isCountish = (/** @type {string} */ s) => s.trim() === '' || /^-?\d+(\.\d+)?$/.test(s.trim());

/**
 * Is this strip of cells a header rather than data?
 *
 * It takes text to be a header, but a single number vetoes it: a strip mixing
 * words and numbers is more likely a garbled paste than a set of labels, and
 * guessing "header" there silently eats a real count. Blanks abstain, so the
 * usual Excel shape (an empty corner cell) still reads as a header.
 *
 * @param {string[]} cells
 */
const looksLikeHeader = (cells) => {
  const hasNumber = cells.some(c => c.trim() !== '' && isCountish(c));
  const hasText = cells.some(c => c.trim() !== '' && !isCountish(c));
  return hasText && !hasNumber;
};

/**
 * Parse a pasted block of tab- or comma-separated text into a table.
 *
 * Header detection is by content, not by position: a first row whose cells
 * aren't numbers is taken as column labels, and likewise for the first column.
 * That way a 2×2 pasted with its labels, without them, or with only one of the
 * two, all land correctly.
 *
 * Pure — exported for tests.
 *
 * @param {string} text
 * @returns {{observed: number[][], rowLabels: string[]|null, colLabels: string[]|null, corner: string} | null}
 */
export function parseTableBlock(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim() !== '');
  if (lines.length === 0) return null;

  const delim = lines[0].includes('\t') ? '\t' : ',';
  /** @type {string[][]} */
  const grid = lines.map(l => l.split(delim).map(c => c.trim()));
  const width = Math.max(...grid.map(r => r.length));
  for (const row of grid) while (row.length < width) row.push('');

  // A single cell is a value, not a table — let the browser paste it normally.
  if (grid.length === 1 && width === 1) return null;

  let colLabels = /** @type {string[]|null} */ (null);
  let rowLabels = /** @type {string[]|null} */ (null);
  let corner = '';

  // First row is a header if any cell past the corner is non-numeric.
  if (grid.length > 1 && looksLikeHeader(grid[0].slice(1))) {
    colLabels = grid[0].slice();
    grid.shift();
  }
  // First column is a header if any cell in it is non-numeric.
  if (grid.length > 0 && looksLikeHeader(grid.map(r => r[0]))) {
    rowLabels = grid.map(r => r[0]);
    for (const r of grid) r.shift();
    // The corner cell belonged to the row-label column, not to the counts.
    // When a table is copied out of a book the corner often holds the row
    // variable's name, and that's the only place it appears — keep it.
    if (colLabels) {
      corner = colLabels[0] ?? '';
      colLabels = colLabels.slice(1);
    }
  }

  if (grid.length === 0 || grid[0].length === 0) return null;

  const observed = grid.map(r => r.map(c => {
    const n = parseInt(c, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }));

  return { observed, rowLabels, colLabels, corner };
}

/**
 * Expand a table of counts into case-level rows, which is what the explore
 * pages' rendering pipeline consumes.
 *
 * Pure — exported for tests.
 *
 * @param {TableData} table
 * @param {number} [maxRows] - refuse absurd expansions (a mistyped count)
 * @returns {Array<Record<string,string>>}
 */
export function tableToRows(table, maxRows = 100_000) {
  const { observed, rowLabels, colLabels } = table;
  const rowVar = table.rowVar || 'Row';
  const colVar = table.colVar || 'Column';
  /** @type {Array<Record<string,string>>} */
  const rows = [];
  for (let i = 0; i < observed.length; i++) {
    for (let j = 0; j < observed[i].length; j++) {
      const n = observed[i][j];
      for (let k = 0; k < n; k++) {
        if (rows.length >= maxRows) return rows;
        rows.push({ [rowVar]: rowLabels[i], [colVar]: colLabels[j] });
      }
    }
  }
  return rows;
}

/**
 * Build an editable contingency table inside `container`.
 *
 * @param {object} config
 * @param {HTMLElement} config.container - element the grid is rendered into
 * @param {HTMLInputElement} config.rowsInput - number input for row count
 * @param {HTMLInputElement} config.colsInput - number input for column count
 * @param {(msg: string) => void} config.announce - screen-reader announcer
 * @param {number} [config.minDim]
 * @param {number} [config.maxDim]
 * @param {boolean} [config.totals] - render live row/column/grand totals
 * @param {boolean} [config.varNames] - render row/column *variable* name inputs
 * @param {string} [config.defaultRowVar]
 * @param {string} [config.defaultColVar]
 * @param {() => void} [config.onEnter] - called when Enter is pressed in a cell
 */
export function createTableEditor(config) {
  const { container, rowsInput, colsInput, announce,
    minDim = 2, maxDim = 10, totals = false, varNames = false,
    defaultRowVar = '', defaultColVar = '', onEnter } = config;

  let nRows = 2;
  let nCols = 2;

  const clamp = (/** @type {number} */ v) => Math.max(minDim, Math.min(maxDim, v || minDim));
  const cell = (/** @type {number} */ i, /** @type {number} */ j) =>
    /** @type {HTMLInputElement|null} */ (document.getElementById(`cell-${i}-${j}`));
  const rowLabelEl = (/** @type {number} */ i) =>
    /** @type {HTMLInputElement|null} */ (document.getElementById(`row-label-${i}`));
  const colLabelEl = (/** @type {number} */ j) =>
    /** @type {HTMLInputElement|null} */ (document.getElementById(`col-label-${j}`));
  const rowVarEl = () => /** @type {HTMLInputElement|null} */ (document.getElementById('row-var-name'));
  const colVarEl = () => /** @type {HTMLInputElement|null} */ (document.getElementById('col-var-name'));

  /** Recompute the totals row/column in place. */
  function refreshTotals() {
    if (!totals) return;
    let grand = 0;
    /** @type {number[]} */
    const colSums = Array.from({ length: nCols }, () => 0);
    for (let i = 0; i < nRows; i++) {
      let rowSum = 0;
      for (let j = 0; j < nCols; j++) {
        const v = parseInt(cell(i, j)?.value ?? '', 10);
        const n = Number.isFinite(v) && v >= 0 ? v : 0;
        rowSum += n;
        colSums[j] += n;
      }
      grand += rowSum;
      const el = document.getElementById(`row-total-${i}`);
      if (el) el.textContent = String(rowSum);
    }
    for (let j = 0; j < nCols; j++) {
      const el = document.getElementById(`col-total-${j}`);
      if (el) el.textContent = String(colSums[j]);
    }
    const g = document.getElementById('grand-total');
    if (g) g.textContent = String(grand);
  }

  /**
   * (Re)build the grid, carrying over whatever the student had already typed so
   * that changing the dimensions never silently discards their work.
   */
  function build(opts) {
    // A rebuild normally carries the student's work across a resize; `fresh`
    // is what "Clear" means, and it has to be explicit or clearing would
    // silently restore what it just cleared.
    const prev = opts && opts.fresh === true
      ? { rowLabels: [], colLabels: [], observed: [], rowVar: '', colVar: '' }
      : snapshot();
    nRows = clamp(parseInt(rowsInput.value, 10));
    nCols = clamp(parseInt(colsInput.value, 10));
    rowsInput.value = String(nRows);
    colsInput.value = String(nCols);

    let html = '';
    if (varNames) {
      html += '<div class="table-var-names">'
        + '<label for="row-var-name">Row variable<input type="text" id="row-var-name" '
        + 'spellcheck="false" placeholder="e.g. Treatment"></label>'
        + '<label for="col-var-name">Column variable<input type="text" id="col-var-name" '
        + 'spellcheck="false" placeholder="e.g. Outcome"></label>'
        + '</div>';
    }
    html += '<table class="input-table" aria-label="Editable contingency table"><thead><tr>';
    html += '<td class="corner-cell"></td>';
    for (let j = 0; j < nCols; j++) {
      html += `<th scope="col"><input type="text" id="col-label-${j}" `
        + `aria-label="Column ${j + 1} label"></th>`;
    }
    if (totals) html += '<th scope="col" class="total-head">Total</th>';
    html += '</tr></thead><tbody>';
    for (let i = 0; i < nRows; i++) {
      html += `<tr><th scope="row"><input type="text" id="row-label-${i}" `
        + `aria-label="Row ${i + 1} label"></th>`;
      for (let j = 0; j < nCols; j++) {
        html += `<td><input type="number" id="cell-${i}-${j}" value="0" min="0" step="1" `
          + `aria-label="Count, row ${i + 1}, column ${j + 1}"></td>`;
      }
      if (totals) html += `<td class="total-cell" id="row-total-${i}">0</td>`;
      html += '</tr>';
    }
    html += '</tbody>';
    if (totals) {
      html += '<tfoot><tr><th scope="row" class="total-head">Total</th>';
      for (let j = 0; j < nCols; j++) html += `<td class="total-cell" id="col-total-${j}">0</td>`;
      html += '<td class="total-cell grand" id="grand-total">0</td></tr></tfoot>';
    }
    html += '</table>';
    container.innerHTML = html;

    // Values are assigned, never interpolated, so a level name containing a
    // quote or an angle bracket can't break the markup.
    for (let j = 0; j < nCols; j++) {
      const el = colLabelEl(j);
      if (el) el.value = prev.colLabels[j] ?? `Col ${j + 1}`;
    }
    for (let i = 0; i < nRows; i++) {
      const el = rowLabelEl(i);
      if (el) el.value = prev.rowLabels[i] ?? `Row ${i + 1}`;
      for (let j = 0; j < nCols; j++) {
        const c = cell(i, j);
        if (c) c.value = String(prev.observed[i]?.[j] ?? 0);
      }
    }
    if (varNames) {
      // Carried across a rebuild, but never pre-filled: a default sitting in
      // the box reads as an answer, hides the placeholder that shows what kind
      // of answer is wanted, and lands on the chart axis if left alone.
      const rv = rowVarEl();
      const cv = colVarEl();
      if (rv) rv.value = prev.rowVar;
      if (cv) cv.value = prev.colVar;
    }

    container.addEventListener('input', refreshTotals);
    container.addEventListener('paste', handlePaste);
    if (onEnter) {
      container.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); onEnter(); }
      });
    }
    refreshTotals();
  }

  /** Current contents, unvalidated — used to preserve work across a rebuild. */
  function snapshot() {
    /** @type {string[]} */ const rowLabels = [];
    /** @type {string[]} */ const colLabels = [];
    /** @type {number[][]} */ const observed = [];
    for (let i = 0; i < nRows; i++) {
      if (!rowLabelEl(i)) break;
      rowLabels.push(rowLabelEl(i)?.value ?? '');
      const row = [];
      for (let j = 0; j < nCols; j++) {
        const v = parseInt(cell(i, j)?.value ?? '', 10);
        row.push(Number.isFinite(v) ? v : 0);
      }
      observed.push(row);
    }
    for (let j = 0; j < nCols; j++) {
      if (!colLabelEl(j)) break;
      colLabels.push(colLabelEl(j)?.value ?? '');
    }
    return {
      rowLabels, colLabels, observed,
      rowVar: rowVarEl()?.value ?? '',
      colVar: colVarEl()?.value ?? '',
    };
  }

  /** Paste a block of cells in one keystroke, growing the grid to fit. */
  function handlePaste(/** @type {ClipboardEvent} */ e) {
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (!text.trim()) return;
    const parsed = parseTableBlock(text);
    if (!parsed) return; // single value — let the browser handle it
    e.preventDefault();

    rowsInput.value = String(clamp(parsed.observed.length));
    colsInput.value = String(clamp(parsed.observed[0].length));
    build();

    for (let i = 0; i < nRows; i++) {
      for (let j = 0; j < nCols; j++) {
        const c = cell(i, j);
        if (c) c.value = String(parsed.observed[i]?.[j] ?? 0);
      }
      const rl = rowLabelEl(i);
      if (rl && parsed.rowLabels?.[i]) rl.value = parsed.rowLabels[i];
    }
    for (let j = 0; j < nCols; j++) {
      const cl = colLabelEl(j);
      if (cl && parsed.colLabels?.[j]) cl.value = parsed.colLabels[j];
    }
    refreshTotals();
    const dropped = parsed.observed.length > nRows || parsed.observed[0].length > nCols;
    announce(dropped
      ? `Pasted ${nRows} by ${nCols}; the table holds at most ${maxDim} by ${maxDim}.`
      : `Pasted a ${nRows} by ${nCols} table.`);
  }

  /**
   * Validate and return the table, or null after announcing what's wrong and
   * focusing the offending cell.
   * @returns {TableData|null}
   */
  function read() {
    /** @type {string[]} */ const rowLabels = [];
    /** @type {string[]} */ const colLabels = [];
    /** @type {number[][]} */ const observed = [];

    for (let i = 0; i < nRows; i++) rowLabels.push(rowLabelEl(i)?.value.trim() || `Row ${i + 1}`);
    for (let j = 0; j < nCols; j++) colLabels.push(colLabelEl(j)?.value.trim() || `Col ${j + 1}`);

    const dupe = (/** @type {string[]} */ list) =>
      new Set(list.map(s => s.toLowerCase())).size !== list.length;
    if (dupe(rowLabels) || dupe(colLabels)) {
      announce('Two levels have the same name. Give each row and each column a distinct label.');
      return null;
    }

    for (let i = 0; i < nRows; i++) {
      const row = [];
      for (let j = 0; j < nCols; j++) {
        const el = cell(i, j);
        const val = parseInt(el?.value ?? '', 10);
        if (!Number.isFinite(val) || val < 0) {
          announce(`Invalid count in ${rowLabels[i]}, ${colLabels[j]}. `
            + 'Counts must be whole numbers, zero or more.');
          el?.focus();
          return null;
        }
        row.push(val);
      }
      observed.push(row);
    }

    if (observed.flat().reduce((a, b) => a + b, 0) === 0) {
      announce('All counts are zero. Enter at least some non-zero counts.');
      return null;
    }

    return {
      observed, rowLabels, colLabels,
      rowVar: rowVarEl()?.value.trim() || defaultRowVar,
      colVar: colVarEl()?.value.trim() || defaultColVar,
    };
  }

  /**
   * Fill the grid from a table computed elsewhere — used to show the
   * cross-tabulation of a dataset the student just loaded.
   * @param {TableData} table
   */
  function setTable(table) {
    rowsInput.value = String(clamp(table.observed.length));
    colsInput.value = String(clamp(table.observed[0]?.length ?? minDim));
    build();
    for (let i = 0; i < nRows; i++) {
      const rl = rowLabelEl(i);
      if (rl && table.rowLabels[i] != null) rl.value = table.rowLabels[i];
      for (let j = 0; j < nCols; j++) {
        const c = cell(i, j);
        if (c) c.value = String(table.observed[i]?.[j] ?? 0);
      }
    }
    for (let j = 0; j < nCols; j++) {
      const cl = colLabelEl(j);
      if (cl && table.colLabels[j] != null) cl.value = table.colLabels[j];
    }
    if (varNames) {
      const rv = rowVarEl();
      const cv = colVarEl();
      if (rv && table.rowVar) rv.value = table.rowVar;
      if (cv && table.colVar) cv.value = table.colVar;
    }
    refreshTotals();
  }

  /** Reset every cell to zero and every label to its default, at the current size. */
  function clear() { build({ fresh: true }); }

  // Arrow wrappers: a bare listener would pass the Event as `opts`.
  rowsInput.addEventListener('change', () => build());
  colsInput.addEventListener('change', () => build());
  build();

  return { build, clear, read, setTable, refreshTotals, get dims() { return { nRows, nCols }; } };
}
