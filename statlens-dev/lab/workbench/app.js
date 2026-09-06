// @ts-check
/**
 * Data Workbench (prototype) — a single-surface EDA hub.
 * Load a dataset → view/sort/select columns → see summaries + a chart →
 * route into the matching guided StatLens tool. Standalone; reuses stats.js,
 * csv-parser.js, and dataset-actions.js. Charts are lightweight inline SVG.
 */

import { parseCSV, rowsToCSV, downloadCSV } from '../../js/csv-parser.js';
import { mean, sd, median, fivenum, iqr, cor, linreg, formatStat } from '../../js/stats.js';
import { icon, fetchFullDataset } from '../../js/dataset-actions.js';

const MISSING = new Set(['', 'NA', 'na', 'N/A', 'n/a', 'null', 'NULL', '.', 'NaN', 'nan', 'missing']);
const GRID_CAP = 200;

/** @typedef {{ id: string|null, name: string, headers: string[], labels: string[], types: string[], rows: Array<Record<string,any>> }} WBState */
/** @type {WBState|null} */
let state = null;
/** @type {string[]} */
let selected = [];
let sortState = /** @type {{col: string|null, dir: number}} */ ({ col: null, dir: 1 });

// ─── Elements ───
const $ = (id) => document.getElementById(id);
const datasetSelect = /** @type {HTMLSelectElement} */ ($('wb-dataset'));
const gridWrap = $('wb-grid-wrap');
const gridCap = $('wb-grid-cap');
const results = $('wb-results');
const rightCard = $('wb-right');
const metaEl = $('wb-meta');
const downloadBtn = $('wb-download');

// ─── Site-root prefix (mirrors dataPath) ───
function prefix() {
  const l = document.querySelector('link[rel="stylesheet"][href*="style.css"]');
  return (l?.getAttribute('href') || '').replace(/css\/style\.css.*$/, '');
}

// ─── Helpers ───
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c);
const trunc = (s, n) => { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
function fmtNum(v) {
  if (!isFinite(v)) return '—';
  if (Math.abs(v) >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return String(Number(v.toPrecision(4)));
}
function typeOf(col) { return state.types[state.headers.indexOf(col)]; }
function labelOf(col) { return state.labels[state.headers.indexOf(col)] || col; }
function numericValues(col) {
  const out = [];
  for (const r of state.rows) {
    const raw = r[col];
    if (raw == null || MISSING.has(String(raw).trim())) continue;
    const v = parseFloat(raw);
    if (isFinite(v)) out.push(v);
  }
  return out;
}
function categoryValues(col) {
  const out = [];
  for (const r of state.rows) {
    const raw = r[col];
    if (raw == null || MISSING.has(String(raw).trim())) continue;
    out.push(String(raw).trim());
  }
  return out;
}
function counts(col) {
  const m = new Map();
  for (const v of categoryValues(col)) m.set(v, (m.get(v) || 0) + 1);
  return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}
function announce(msg) {
  const el = $('sr-announce'); if (!el) return;
  el.textContent = ''; requestAnimationFrame(() => { el.textContent = msg; });
}

// ─── Load: dataset index ───
async function loadIndex() {
  try {
    const resp = await fetch(`${prefix()}data/datasets.json`);
    const idx = await resp.json();
    idx.sort((a, b) => a.name.localeCompare(b.name));
    for (const d of idx) {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = `${d.name}  (n=${d.n ?? '?'})`;
      datasetSelect.appendChild(opt);
    }
  } catch { announce('Could not load the dataset list.'); }
}

function stateFromDataset(ds) {
  const vars = (ds.variables || []).map(v => typeof v === 'object' ? v : { name: v, label: v, type: 'numeric' });
  return {
    id: ds.id || null,
    name: ds.name || ds.id || 'Dataset',
    headers: vars.map(v => v.name),
    labels: vars.map(v => v.label || v.name),
    types: vars.map(v => v.type || 'numeric'),
    rows: ds.rows || [],
  };
}

function loadState(s) {
  state = s;
  selected = [];
  sortState = { col: null, dir: 1 };
  metaEl.textContent = `${state.rows.length.toLocaleString()} rows × ${state.headers.length} columns`;
  downloadBtn.hidden = false;
  renderGrid();
  renderResults();
}

// ─── Grid ───
function sortedRows() {
  if (!sortState.col) return state.rows;
  const col = sortState.col, dir = sortState.dir;
  const isNum = typeOf(col) === 'numeric';
  return state.rows.slice().sort((a, b) => {
    const av = a[col], bv = b[col];
    const am = av == null || MISSING.has(String(av).trim());
    const bm = bv == null || MISSING.has(String(bv).trim());
    if (am && bm) return 0;
    if (am) return 1;   // missing sinks to bottom regardless of dir
    if (bm) return -1;
    if (isNum) return (parseFloat(av) - parseFloat(bv)) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
}

function renderGrid() {
  const rows = sortedRows();
  const shown = Math.min(rows.length, GRID_CAP);
  const th = state.headers.map(col => {
    const sel = selected.includes(col) ? ' selected' : '';
    const arrow = sortState.col === col ? (sortState.dir === 1 ? '↑' : '↓') : '↕';
    return `<th data-col="${esc(col)}" class="${sel.trim()}">
      <div class="wb-th-inner">
        <span><span class="wb-th-name">${esc(labelOf(col))}</span> <span class="wb-th-type">${typeOf(col) === 'numeric' ? 'num' : 'cat'}</span></span>
        <button class="wb-sort" data-sort="${esc(col)}" title="Sort" aria-label="Sort by ${esc(labelOf(col))}">${arrow}</button>
      </div></th>`;
  }).join('');

  let body = '';
  for (let i = 0; i < shown; i++) {
    const r = rows[i];
    const tds = state.headers.map(col => {
      const sel = selected.includes(col) ? ' selected' : '';
      const num = typeOf(col) === 'numeric' ? ' is-num' : '';
      const v = r[col];
      return `<td class="${(sel + num).trim()}">${v == null || v === '' ? '—' : esc(v)}</td>`;
    }).join('');
    body += `<tr><td class="wb-rownum">${i + 1}</td>${tds}</tr>`;
  }

  gridWrap.innerHTML = `<table class="wb-grid"><thead><tr><th class="wb-rownum">#</th>${th}</tr></thead><tbody>${body}</tbody></table>`;
  gridCap.textContent = rows.length > shown
    ? `Showing first ${shown} of ${rows.length.toLocaleString()} rows. Click a column header to select it; use ↕ to sort.`
    : `Click a column header to select it; use ↕ to sort.`;

  // Wire header selection + sort
  gridWrap.querySelectorAll('th[data-col]').forEach(el => {
    el.addEventListener('click', () => toggleSelect(el.getAttribute('data-col')));
  });
  gridWrap.querySelectorAll('.wb-sort').forEach(el => {
    el.addEventListener('click', (e) => { e.stopPropagation(); sortBy(el.getAttribute('data-sort')); });
  });
}

function toggleSelect(col) {
  const i = selected.indexOf(col);
  if (i >= 0) selected.splice(i, 1);
  else { selected.push(col); if (selected.length > 2) selected.shift(); }
  renderGrid();
  renderResults();
}

function sortBy(col) {
  if (sortState.col === col) sortState.dir *= -1;
  else sortState = { col, dir: 1 };
  renderGrid();
}

// ─── Results ───
function statRows(pairs) {
  return pairs.map(([k, v]) => `<div class="wb-stat-row"><span>${esc(k)}</span><span>${v}</span></div>`).join('');
}

function renderResults() {
  results.hidden = false;
  const summary = $('wb-summary');
  const selTitle = $('wb-sel-title');
  const chartEl = $('wb-chart');
  const chartTitle = $('wb-chart-title');
  const suggestEl = $('wb-suggest');

  if (selected.length === 0) {
    selTitle.textContent = 'Selection';
    summary.innerHTML = `<p class="wb-selhint">Click a column header to select it. Pick one column to describe it, or two to compare them.</p>`;
    rightCard.hidden = true;
    return;
  }
  rightCard.hidden = false;
  suggestEl.innerHTML = '';
  const types = selected.map(typeOf);

  if (selected.length === 1) {
    const col = selected[0];
    selTitle.textContent = labelOf(col);
    if (types[0] === 'numeric') {
      const v = numericValues(col);
      const [mn, q1, med, q3, mx] = fivenum(v);
      summary.innerHTML = statRows([
        ['n (non-missing)', v.length],
        ['Mean', fmtNum(mean(v))], ['SD', fmtNum(sd(v))],
        ['Median', fmtNum(med)], ['IQR', fmtNum(iqr(v))],
        ['Min', fmtNum(mn)], ['Max', fmtNum(mx)],
      ]);
      chartTitle.textContent = 'Histogram';
      chartEl.innerHTML = histogram(v, labelOf(col));
      addSuggest(suggestEl, [
        ['explore/descriptive/', 'Describe & visualize', 'histogram, boxplot, all summary stats'],
        ['inference/one-mean/', 'Estimate / test the mean', 'confidence interval or one-sample t-test'],
      ]);
    } else {
      const c = counts(col);
      const total = c.reduce((s, x) => s + x.count, 0);
      summary.innerHTML = statRows([['Categories', c.length], ['n', total]])
        + `<div style="margin-top:0.4rem">${c.slice(0, 6).map(x => `<div class="wb-stat-row"><span>${esc(trunc(x.label, 22))}</span><span>${x.count} (${(100 * x.count / total).toFixed(0)}%)</span></div>`).join('')}</div>`;
      chartTitle.textContent = 'Bar chart';
      chartEl.innerHTML = barChart(c, labelOf(col));
      addSuggest(suggestEl, [
        ['explore/one-cat/', 'Explore one categorical variable', 'bar chart & proportions'],
        ['inference/one-prop/', 'Estimate / test a proportion', 'CI or one-proportion test'],
      ]);
    }
    return;
  }

  // Two columns
  selTitle.textContent = `${labelOf(selected[0])}  ×  ${labelOf(selected[1])}`;
  const numCols = selected.filter(c => typeOf(c) === 'numeric');
  const catCols = selected.filter(c => typeOf(c) === 'categorical');

  if (numCols.length === 2) {
    const x = [], y = [];
    for (const r of state.rows) {
      const xv = parseFloat(r[numCols[0]]), yv = parseFloat(r[numCols[1]]);
      if (isFinite(xv) && isFinite(yv)) { x.push(xv); y.push(yv); }
    }
    const r = cor(x, y);
    const fit = linreg(x, y);
    summary.innerHTML = statRows([
      ['n (paired)', x.length],
      ['Correlation r', formatStat(r, 3, 'correlation')],
      ['R²', formatStat(r * r, 3, 'correlation')],
      ['Slope', fmtNum(fit.slope)], ['Intercept', fmtNum(fit.intercept)],
    ]);
    chartTitle.textContent = 'Scatterplot';
    chartEl.innerHTML = scatter(x, y, labelOf(numCols[0]), labelOf(numCols[1]), fit);
    addSuggest(suggestEl, [
      ['explore/regression/', 'Explore the relationship', 'scatter, line, r and R²'],
      ['inference/slope/', 'Inference for the slope', 'is the relationship discernible?'],
    ]);
  } else if (catCols.length === 2) {
    chartTitle.textContent = 'Two-way table';
    const { html, table } = contingency(catCols[0], catCols[1]);
    summary.innerHTML = `<p class="wb-selhint">Counts of ${esc(labelOf(catCols[0]))} by ${esc(labelOf(catCols[1]))}.</p>`;
    chartEl.innerHTML = table;
    void html;
    addSuggest(suggestEl, [
      ['explore/categorical/', 'Explore two categorical variables', 'two-way table & stacked bars'],
      ['inference/chisq/', 'Chi-square test of independence', 'are the two variables associated?'],
    ]);
  } else {
    // one categorical + one numeric
    const cat = catCols[0], num = numCols[0];
    const groups = new Map();
    for (const r of state.rows) {
      const g = r[cat]; const v = parseFloat(r[num]);
      if (g == null || MISSING.has(String(g).trim()) || !isFinite(v)) continue;
      const key = String(g).trim();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(v);
    }
    const gArr = [...groups.entries()].map(([label, values]) => ({ label, values }));
    summary.innerHTML = `<p class="wb-selhint">${labelOf(num)} by ${labelOf(cat)} (${gArr.length} groups):</p>`
      + gArr.slice(0, 8).map(g => `<div class="wb-stat-row"><span>${esc(trunc(g.label, 16))} (n=${g.values.length})</span><span>mean ${fmtNum(mean(g.values))}</span></div>`).join('');
    chartTitle.textContent = 'Groups';
    chartEl.innerHTML = groupedStrip(gArr, labelOf(num));
    const s = [['explore/grouped/', 'Compare groups', 'side-by-side boxplots & summaries']];
    if (gArr.length >= 3) s.push(['inference/anova/', 'ANOVA (3+ groups)', 'do the group means differ?']);
    else if (gArr.length === 2) s.push(['inference/two-means/', 'Compare two means', 'difference in means (t-test / CI)']);
    addSuggest(suggestEl, s);
  }
}

function addSuggest(container, entries) {
  for (const [tool, label, sub] of entries) {
    const inner = `${icon('explore')}<span>${esc(label)}<span class="sub">${esc(sub)}</span></span>`;
    if (state.id) {
      const a = document.createElement('a');
      a.href = `${prefix()}${tool}?dataset=${encodeURIComponent(state.id)}`;
      a.innerHTML = inner;
      container.appendChild(a);
    } else {
      const b = document.createElement('button');
      b.type = 'button';
      b.disabled = true;
      b.title = 'Load a bundled dataset to open it in a tool';
      b.style.opacity = '0.55';
      b.innerHTML = inner;
      container.appendChild(b);
    }
  }
  if (!state.id) {
    const note = document.createElement('p');
    note.className = 'wb-selhint';
    note.style.margin = '0.2rem 0 0';
    note.textContent = 'Routing to tools is available for bundled datasets. (Passing your pasted data through is a next step.)';
    container.appendChild(note);
  }
}

// ─── Charts (lightweight inline SVG) ───
function svgWrap(inner, aria, w = 400, h = 250) {
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(aria)}">${inner}</svg>`;
}
const AX = '#999', INK = '#333', SUB = '#555', BLUE = '#569BBD';

function histogram(values, label) {
  const n = values.length;
  if (!n) return '<p class="wb-selhint">No numeric values to plot.</p>';
  const mn = Math.min(...values), mx = Math.max(...values);
  const k = Math.min(20, Math.max(5, Math.round(Math.sqrt(n))));
  const span = (mx - mn) || 1, bw = span / k;
  const bins = new Array(k).fill(0);
  for (const v of values) { let i = Math.floor((v - mn) / bw); if (i < 0) i = 0; if (i >= k) i = k - 1; bins[i]++; }
  const maxc = Math.max(...bins, 1);
  const W = 400, H = 250, ml = 46, mr = 12, mt = 12, mb = 42, iw = W - ml - mr, ih = H - mt - mb;
  const xpx = v => ml + ((v - mn) / span) * iw;
  let bars = '';
  for (let i = 0; i < k; i++) {
    const x0 = ml + (i / k) * iw, wpx = iw / k, hpx = (bins[i] / maxc) * ih;
    bars += `<rect x="${x0.toFixed(1)}" y="${(mt + ih - hpx).toFixed(1)}" width="${Math.max(0, wpx - 1).toFixed(1)}" height="${hpx.toFixed(1)}" fill="${BLUE}"/>`;
  }
  const axis = `<line x1="${ml}" y1="${mt + ih}" x2="${ml + iw}" y2="${mt + ih}" stroke="${AX}"/><line x1="${ml}" y1="${mt}" x2="${ml}" y2="${mt + ih}" stroke="${AX}"/>`;
  const xt = [mn, (mn + mx) / 2, mx].map(v => `<text x="${xpx(v).toFixed(1)}" y="${mt + ih + 16}" font-size="11" text-anchor="middle" fill="${SUB}">${fmtNum(v)}</text>`).join('');
  const yt = [0, maxc].map(c => `<text x="${ml - 6}" y="${(mt + ih - (c / maxc) * ih + 4).toFixed(1)}" font-size="11" text-anchor="end" fill="${SUB}">${c}</text>`).join('');
  const xlab = `<text x="${ml + iw / 2}" y="${H - 5}" font-size="12" text-anchor="middle" fill="${INK}">${esc(label)}</text>`;
  const ylab = `<text font-size="12" text-anchor="middle" fill="${INK}" transform="translate(13 ${mt + ih / 2}) rotate(-90)">Count</text>`;
  return svgWrap(bars + axis + xt + yt + xlab + ylab, `Histogram of ${label}`, W, H);
}

function barChart(c, label) {
  const k = c.length; if (!k) return '';
  const maxc = Math.max(...c.map(x => x.count), 1);
  const W = 400, H = 250, ml = 40, mr = 12, mt = 12, mb = 68, iw = W - ml - mr, ih = H - mt - mb;
  const bwpx = iw / k;
  let bars = '', labs = '';
  c.forEach((x, i) => {
    const hpx = (x.count / maxc) * ih, x0 = ml + i * bwpx + bwpx * 0.12, w = bwpx * 0.76, cx = x0 + w / 2;
    bars += `<rect x="${x0.toFixed(1)}" y="${(mt + ih - hpx).toFixed(1)}" width="${w.toFixed(1)}" height="${hpx.toFixed(1)}" fill="${BLUE}"/>`;
    labs += `<text x="${cx.toFixed(1)}" y="${mt + ih + 13}" font-size="10" text-anchor="end" fill="${SUB}" transform="rotate(-35 ${cx.toFixed(1)} ${mt + ih + 13})">${esc(trunc(x.label, 14))}</text>`;
  });
  const axis = `<line x1="${ml}" y1="${mt + ih}" x2="${ml + iw}" y2="${mt + ih}" stroke="${AX}"/><line x1="${ml}" y1="${mt}" x2="${ml}" y2="${mt + ih}" stroke="${AX}"/>`;
  const yt = [0, maxc].map(v => `<text x="${ml - 6}" y="${(mt + ih - (v / maxc) * ih + 4).toFixed(1)}" font-size="11" text-anchor="end" fill="${SUB}">${v}</text>`).join('');
  const ylab = `<text font-size="12" text-anchor="middle" fill="${INK}" transform="translate(11 ${mt + ih / 2}) rotate(-90)">Count</text>`;
  return svgWrap(bars + labs + axis + yt + ylab, `Bar chart of ${label}`, W, H);
}

function scatter(x, y, xlab, ylab, fit) {
  const n = x.length; if (!n) return '<p class="wb-selhint">No paired values to plot.</p>';
  const xmn = Math.min(...x), xmx = Math.max(...x), ymn = Math.min(...y), ymx = Math.max(...y);
  const xs = (xmx - xmn) || 1, ys = (ymx - ymn) || 1;
  const W = 400, H = 260, ml = 50, mr = 14, mt = 12, mb = 42, iw = W - ml - mr, ih = H - mt - mb;
  const px = v => ml + ((v - xmn) / xs) * iw;
  const py = v => mt + ih - ((v - ymn) / ys) * ih;
  let pts = '';
  for (let i = 0; i < n; i++) pts += `<circle cx="${px(x[i]).toFixed(1)}" cy="${py(y[i]).toFixed(1)}" r="2.6" fill="${BLUE}" fill-opacity="0.6"/>`;
  let line = '';
  if (fit && isFinite(fit.slope)) {
    const y0 = fit.intercept + fit.slope * xmn, y1 = fit.intercept + fit.slope * xmx;
    line = `<line x1="${px(xmn).toFixed(1)}" y1="${py(y0).toFixed(1)}" x2="${px(xmx).toFixed(1)}" y2="${py(y1).toFixed(1)}" stroke="#F05133" stroke-width="2"/>`;
  }
  const axis = `<line x1="${ml}" y1="${mt + ih}" x2="${ml + iw}" y2="${mt + ih}" stroke="${AX}"/><line x1="${ml}" y1="${mt}" x2="${ml}" y2="${mt + ih}" stroke="${AX}"/>`;
  const xt = [xmn, xmx].map(v => `<text x="${px(v).toFixed(1)}" y="${mt + ih + 16}" font-size="11" text-anchor="middle" fill="${SUB}">${fmtNum(v)}</text>`).join('');
  const yt = [ymn, ymx].map(v => `<text x="${ml - 6}" y="${(py(v) + 4).toFixed(1)}" font-size="11" text-anchor="end" fill="${SUB}">${fmtNum(v)}</text>`).join('');
  const xlbl = `<text x="${ml + iw / 2}" y="${H - 5}" font-size="12" text-anchor="middle" fill="${INK}">${esc(xlab)}</text>`;
  const ylbl = `<text font-size="12" text-anchor="middle" fill="${INK}" transform="translate(13 ${mt + ih / 2}) rotate(-90)">${esc(ylab)}</text>`;
  return svgWrap(pts + line + axis + xt + yt + xlbl + ylbl, `Scatterplot of ${ylab} vs ${xlab}`, W, H);
}

function groupedStrip(groups, numLabel) {
  const k = groups.length; if (!k) return '';
  const all = groups.flatMap(g => g.values);
  const ymn = Math.min(...all), ymx = Math.max(...all), ys = (ymx - ymn) || 1;
  const W = 400, H = 260, ml = 50, mr = 14, mt = 12, mb = 62, iw = W - ml - mr, ih = H - mt - mb;
  const py = v => mt + ih - ((v - ymn) / ys) * ih;
  const bw = iw / k;
  let dots = '', means = '', labs = '';
  groups.forEach((g, i) => {
    const cx = ml + i * bw + bw / 2;
    for (const v of g.values) {
      const jit = (Math.random() - 0.5) * Math.min(bw * 0.5, 26);
      dots += `<circle cx="${(cx + jit).toFixed(1)}" cy="${py(v).toFixed(1)}" r="2.2" fill="${BLUE}" fill-opacity="0.5"/>`;
    }
    const m = mean(g.values);
    means += `<line x1="${(cx - bw * 0.32).toFixed(1)}" y1="${py(m).toFixed(1)}" x2="${(cx + bw * 0.32).toFixed(1)}" y2="${py(m).toFixed(1)}" stroke="#114B5F" stroke-width="2.5"/>`;
    labs += `<text x="${cx.toFixed(1)}" y="${mt + ih + 14}" font-size="10" text-anchor="end" fill="${SUB}" transform="rotate(-30 ${cx.toFixed(1)} ${mt + ih + 14})">${esc(trunc(g.label, 12))}</text>`;
  });
  const axis = `<line x1="${ml}" y1="${mt + ih}" x2="${ml + iw}" y2="${mt + ih}" stroke="${AX}"/><line x1="${ml}" y1="${mt}" x2="${ml}" y2="${mt + ih}" stroke="${AX}"/>`;
  const yt = [ymn, (ymn + ymx) / 2, ymx].map(v => `<text x="${ml - 6}" y="${(py(v) + 4).toFixed(1)}" font-size="11" text-anchor="end" fill="${SUB}">${fmtNum(v)}</text>`).join('');
  const ylbl = `<text font-size="12" text-anchor="middle" fill="${INK}" transform="translate(13 ${mt + ih / 2}) rotate(-90)">${esc(numLabel)}</text>`;
  const legend = `<text x="${ml + iw}" y="${mt + 4}" font-size="10" text-anchor="end" fill="#114B5F">— group mean</text>`;
  return svgWrap(dots + means + axis + yt + labs + ylbl + legend, `Grouped strip plot of ${numLabel}`, W, H);
}

function contingency(catA, catB) {
  const rowsL = [...new Set(categoryValues(catA))].slice(0, 12);
  const colsL = [...new Set(categoryValues(catB))].slice(0, 12);
  const cell = new Map();
  for (const r of state.rows) {
    const a = r[catA], b = r[catB];
    if (a == null || b == null) continue;
    const key = String(a).trim() + ' ' + String(b).trim();
    cell.set(key, (cell.get(key) || 0) + 1);
  }
  let head = `<tr><th>${esc(trunc(labelOf(catA), 14))} \\ ${esc(trunc(labelOf(catB), 14))}</th>${colsL.map(c => `<th>${esc(trunc(c, 12))}</th>`).join('')}</tr>`;
  let body = rowsL.map(rl => `<tr><th>${esc(trunc(rl, 14))}</th>${colsL.map(cl => `<td>${cell.get(rl + ' ' + cl) || 0}</td>`).join('')}</tr>`).join('');
  return { html: '', table: `<table class="wb-ctab">${head}${body}</table>` };
}

// ─── Wiring ───
datasetSelect.addEventListener('change', async () => {
  const id = datasetSelect.value;
  if (!id) return;
  try {
    const ds = await fetchFullDataset(id);
    loadState(stateFromDataset(ds));
  } catch { announce('Could not load that dataset.'); }
});

$('wb-paste-load').addEventListener('click', () => {
  const text = /** @type {HTMLTextAreaElement} */ ($('wb-paste-area')).value;
  try {
    const parsed = parseCSV(text);
    datasetSelect.value = '';
    loadState({ id: null, name: 'Pasted data', headers: parsed.headers, labels: parsed.headers, types: parsed.types, rows: parsed.data });
    announce('Pasted data loaded.');
  } catch (e) { announce('Could not parse that data — check for a header row.'); }
});

downloadBtn.addEventListener('click', () => {
  if (!state) return;
  downloadCSV(rowsToCSV(state.rows, state.headers), `${(state.id || 'data')}.csv`);
});

$('wb-help-btn').addEventListener('click', () => /** @type {HTMLDialogElement} */ ($('wb-help')).showModal());
$('wb-help-close').addEventListener('click', () => /** @type {HTMLDialogElement} */ ($('wb-help')).close());

loadIndex();

// Deep-link: ?dataset=<id> preloads
const wanted = new URLSearchParams(location.search).get('dataset');
if (wanted) {
  fetchFullDataset(wanted).then(ds => { datasetSelect.value = wanted; loadState(stateFromDataset(ds)); }).catch(() => {});
}
