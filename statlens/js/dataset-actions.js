// @ts-check
/**
 * Dataset action buttons (Explore / Preview / Download) for the collapsed data bar.
 *
 * Rendered by collapseDataPanel() whenever a bundled dataset is open in any tool.
 * - Explore  → opens the dataset preloaded in the appropriate explorer (hidden when
 *              the current page already IS that explorer).
 * - Preview  → opens an accessible modal showing the actual data rows + metadata.
 * - Download → generates a CSV from the dataset's rows on demand.
 *
 * @module dataset-actions
 */

import { rowsToCSV, downloadCSV } from './csv-parser.js';

/**
 * Site-root-relative prefix inferred from the stylesheet href (mirrors dataPath()).
 * Lets cross-tool links work from any page depth without hardcoding `../`.
 * @returns {string}
 */
function sitePrefix() {
  const link = document.querySelector('link[rel="stylesheet"][href*="style.css"]');
  const href = link?.getAttribute('href') || '';
  return href.replace(/css\/style\.css.*$/, '');
}

/**
 * Normalize a dataset's `variables` into `{name, label, type}` objects and count types.
 * @param {any} ds
 * @returns {{ vars: Array<{name:string,label:string,type:string}>, numeric:number, categorical:number }}
 */
function varInfo(ds) {
  const vars = (ds.variables || []).map(/** @param {any} v */ v =>
    typeof v === 'object'
      ? { name: v.name, label: v.label || v.name, type: v.type || 'numeric' }
      : { name: v, label: v, type: 'numeric' }
  );
  return {
    vars,
    numeric: vars.filter(/** @param {any} v */ v => v.type === 'numeric').length,
    categorical: vars.filter(/** @param {any} v */ v => v.type === 'categorical').length,
  };
}

/**
 * Determine the appropriate explorer for a dataset. Mirrors the category logic in
 * data/index.html so the "Explore" button routes consistently with the browser.
 * @param {any} ds - Full dataset JSON
 * @returns {{ path: string, href: string, kind: string } | null}
 */
export function explorerFor(ds) {
  if (!ds || !ds.id) return null;
  const { numeric, categorical } = varInfo(ds);
  const hasNum = numeric > 0;
  const hasCat = categorical > 0;
  const type = ds.type;
  const paired = type === 'paired';

  /** @param {string} path @param {string} kind */
  const route = (path, kind) => ({
    path,
    href: `${sitePrefix()}${path}?dataset=${encodeURIComponent(ds.id)}`,
    kind,
  });

  if (!hasNum && hasCat && categorical === 1) return route('explore/one-cat/', 'one categorical variable');
  if (!hasNum && hasCat && categorical >= 2) return route('explore/categorical/', 'two categorical variables');
  if (hasNum && !hasCat && paired) return route('explore/descriptive/', 'paired data');
  if (hasNum && !hasCat && numeric === 1) return route('explore/descriptive/', 'one numeric variable');
  if (hasNum && hasCat && type !== 'regression' && !paired) return route('explore/grouped/', 'groups');
  if (hasNum && numeric >= 2 && !paired && (!hasCat || type === 'regression')) return route('explore/regression/', 'two numeric variables');

  // Fallbacks: still give students somewhere useful to go.
  if (hasNum) return route('explore/descriptive/', 'the data');
  if (hasCat) return route('explore/one-cat/', 'categorical data');
  return null;
}

/**
 * Whether the current page is already the given explorer path (so Explore is redundant).
 * @param {string} path - e.g. 'explore/descriptive/'
 * @returns {boolean}
 */
function isCurrentPage(path) {
  try {
    const target = new URL(`${sitePrefix()}${path}`, location.href).pathname.replace(/index\.html$/, '');
    const here = location.pathname.replace(/index\.html$/, '');
    return here === target || here === target.replace(/\/$/, '');
  } catch {
    return false;
  }
}

/**
 * Build a filename-safe slug from a dataset id or name.
 * @param {any} ds
 * @returns {string}
 */
function datasetSlug(ds) {
  const base = String(ds.id || ds.name || 'data').toLowerCase();
  return base.replace(/[^a-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'data';
}

/**
 * Trigger a CSV download of the dataset's rows.
 * @param {any} ds
 */
export function downloadDataset(ds) {
  const { vars } = varInfo(ds);
  const cols = vars.map(v => v.name);
  if (!ds.rows || !ds.rows.length || !cols.length) return;
  downloadCSV(rowsToCSV(ds.rows, cols), `${datasetSlug(ds)}.csv`);
}

const PREVIEW_ROW_CAP = 500;

/**
 * Open an accessible modal previewing the dataset's rows and metadata.
 * @param {any} ds - Full dataset JSON
 * @param {HTMLElement|null} [opener] - Element to return focus to on close
 */
export function openDatasetPreview(ds, opener = null) {
  if (!ds || !ds.rows || !ds.variables) return;
  const { vars } = varInfo(ds);
  const cols = vars.map(v => v.name);
  const total = ds.rows.length;
  const shown = Math.min(total, PREVIEW_ROW_CAP);

  const dialog = /** @type {HTMLDialogElement} */ (document.createElement('dialog'));
  dialog.className = 'dataset-preview-dialog';
  const titleId = 'dataset-preview-title';
  dialog.setAttribute('aria-labelledby', titleId);

  // Header
  const header = document.createElement('div');
  header.className = 'dataset-preview-header';
  const h2 = document.createElement('h2');
  h2.id = titleId;
  h2.textContent = ds.name || ds.id || 'Dataset';
  const closeX = document.createElement('button');
  closeX.type = 'button';
  closeX.className = 'dataset-preview-close';
  closeX.setAttribute('aria-label', 'Close preview');
  closeX.innerHTML = '&times;';
  closeX.addEventListener('click', () => dialog.close());
  header.append(h2, closeX);

  // Meta line
  const meta = document.createElement('p');
  meta.className = 'dataset-preview-meta';
  const varList = vars.map(v => v.label).join(', ');
  meta.textContent = `${total.toLocaleString()} row${total === 1 ? '' : 's'} × ${vars.length} variable${vars.length === 1 ? '' : 's'}: ${varList}`;

  // Scrollable table
  const scroll = document.createElement('div');
  scroll.className = 'dataset-preview-scroll';
  const table = document.createElement('table');
  table.className = 'dataset-preview-table';

  const caption = document.createElement('caption');
  caption.className = 'sr-only';
  caption.textContent = `Data preview for ${ds.name || ds.id}`;
  table.appendChild(caption);

  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  const rowNumTh = document.createElement('th');
  rowNumTh.className = 'dataset-preview-rownum';
  rowNumTh.scope = 'col';
  rowNumTh.textContent = '#';
  htr.appendChild(rowNumTh);
  for (const v of vars) {
    const th = document.createElement('th');
    th.scope = 'col';
    const isNum = v.type === 'numeric';
    if (isNum) th.classList.add('is-numeric');
    th.innerHTML = `${escapeHTML(v.label)} <span class="dataset-preview-vtype">${isNum ? 'num' : 'cat'}</span>`;
    htr.appendChild(th);
  }
  thead.appendChild(htr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (let i = 0; i < shown; i++) {
    const row = ds.rows[i];
    const tr = document.createElement('tr');
    const numTd = document.createElement('td');
    numTd.className = 'dataset-preview-rownum';
    numTd.textContent = String(i + 1);
    tr.appendChild(numTd);
    for (const v of vars) {
      const td = document.createElement('td');
      const val = row[v.name];
      if (v.type === 'numeric') td.classList.add('is-numeric');
      td.textContent = val == null || val === '' ? '—' : String(val);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  scroll.appendChild(table);

  // Footer
  const footer = document.createElement('div');
  footer.className = 'dataset-preview-footer';
  const note = document.createElement('span');
  note.className = 'dataset-preview-note';
  note.textContent = total > shown
    ? `Showing first ${shown.toLocaleString()} of ${total.toLocaleString()} rows — download the CSV for all.`
    : '';
  const actions = document.createElement('div');
  actions.className = 'dataset-preview-footer-actions';
  const dlBtn = document.createElement('button');
  dlBtn.type = 'button';
  dlBtn.className = 'dataset-action-btn primary';
  dlBtn.textContent = 'Download CSV';
  dlBtn.addEventListener('click', () => downloadDataset(ds));
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'dataset-action-btn';
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', () => dialog.close());
  actions.append(dlBtn, closeBtn);
  footer.append(note, actions);

  dialog.append(header, meta, scroll, footer);
  document.body.appendChild(dialog);

  // Close on backdrop click (click landed on the dialog element itself, not its content).
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (opener && typeof opener.focus === 'function') opener.focus();
  });

  dialog.showModal();
}

/**
 * Escape a string for safe innerHTML insertion.
 * @param {string} s
 * @returns {string}
 */
function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c);
}

/**
 * Render the Explore / Preview / Download button group into the collapsed data bar.
 * Idempotent — replaces any existing group. Renders nothing without row data.
 * @param {HTMLElement} panel - The #data-panel element (collapsed)
 * @param {any} [ds] - Full dataset JSON (must have rows + variables)
 */
export function renderDatasetActions(panel, ds) {
  const existing = panel.querySelector('.dataset-actions');
  if (existing) existing.remove();
  if (!ds || !ds.rows || !ds.rows.length || !ds.variables) return;

  const group = document.createElement('div');
  group.className = 'dataset-actions';

  // Explore — only when we're not already in the right explorer.
  const explorer = explorerFor(ds);
  if (explorer && !isCurrentPage(explorer.path)) {
    const a = document.createElement('a');
    a.className = 'dataset-action-btn';
    a.href = explorer.href;
    a.textContent = 'Explore';
    a.title = `Open this dataset in the ${explorer.kind} explorer`;
    group.appendChild(a);
  }

  // Preview
  const previewBtn = document.createElement('button');
  previewBtn.type = 'button';
  previewBtn.className = 'dataset-action-btn';
  previewBtn.textContent = 'Preview';
  previewBtn.title = 'View the data values';
  previewBtn.addEventListener('click', () => openDatasetPreview(ds, previewBtn));
  group.appendChild(previewBtn);

  // Download
  const dlBtn = document.createElement('button');
  dlBtn.type = 'button';
  dlBtn.className = 'dataset-action-btn';
  dlBtn.textContent = 'Download';
  dlBtn.title = 'Download this dataset as a CSV file';
  dlBtn.addEventListener('click', () => downloadDataset(ds));
  group.appendChild(dlBtn);

  // Insert right after the "Change Data" button when present, else at the end.
  const changeBtn = panel.querySelector('.data-panel-expand-btn');
  if (changeBtn && changeBtn.nextSibling) {
    panel.insertBefore(group, changeBtn.nextSibling);
  } else {
    panel.appendChild(group);
  }
}
