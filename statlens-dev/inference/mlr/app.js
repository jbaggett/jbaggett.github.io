// @ts-check
/**
 * Multiple Linear Regression tool (REQ-038).
 *
 * Fit Y = β0 + β1x1 + … + βkxk on a bundled or uploaded dataset; read the
 * coefficient table, the model ANOVA F-test, R²/adjR²/residual SE, diagnostics
 * (residual-vs-fitted, residual histogram, high-influence flag via Cook's D),
 * and — base track — a pairwise scatterplot matrix of the predictors. Expert
 * mode (?expert=true) adds a VIF column.
 */
import { initHelp, initSettings, initTabs, announce } from '../../js/page-utils.js';
import { setJStat } from '../../js/distributions.js';
import { fitMLR } from '../../js/mlr.js';
import { formatStat } from '../../js/stats.js';
import { drawScatterplot } from '../../js/scatterplot.js';
import { drawHistogram } from '../../js/histogram.js';
import { tex, escapeTex } from '../../js/tex.js';

const jstatMod = await import('jstat');
setJStat(jstatMod.default || jstatMod);

initHelp();
initSettings();

const params = new URLSearchParams(location.search);

// Bundled datasets with ≥ 3 numeric variables (verified). Labels filled from
// data/datasets.json at load. Users can also upload their own CSV.
const CURATED = ['possum', 'county', 'county_2019', 'loan50', 'mammals', 'floridalakes', 'sleepstudy', 'usstates', 'baumann', 'hollywoodmovies2023'];

const datasetSelect = /** @type {HTMLSelectElement} */ (document.getElementById('dataset-select'));
const fileInput = /** @type {HTMLInputElement} */ (document.getElementById('file-input'));
const variableSelector = /** @type {HTMLElement} */ (document.getElementById('variable-selector'));
const responseSelect = /** @type {HTMLSelectElement} */ (document.getElementById('response-select'));
const predictorList = /** @type {HTMLElement} */ (document.getElementById('predictor-list'));
const expertToggle = /** @type {HTMLInputElement} */ (document.getElementById('expert-toggle'));
const resultsSection = /** @type {HTMLElement} */ (document.getElementById('results-section'));
const resultsPanel = /** @type {HTMLElement} */ (document.getElementById('results-panel'));

initTabs({});

if (params.get('expert') === 'true') expertToggle.checked = true;

/** @type {{ name:string, type:string }[]} */
let currentVars = [];
/** @type {Record<string, any>[]} */
let currentRows = [];

// ─── Dataset list ───────────────────────────────────────────────────────────
const indexResp = await fetch('../../data/datasets.json').then(r => r.json()).catch(() => []);
const byId = new Map(indexResp.map(d => [d.id, d]));
for (const id of CURATED) {
  const meta = byId.get(id);
  const opt = document.createElement('option');
  opt.value = id;
  opt.textContent = meta ? meta.name : id;
  datasetSelect.appendChild(opt);
}

/** Load a bundled dataset by id. */
async function loadDataset(id) {
  const ds = await fetch(`../../data/${id}.json`).then(r => r.json());
  currentVars = ds.variables;
  currentRows = ds.rows;
  onDataLoaded(ds.name || id);
}

/** Numeric variable names in the current dataset. */
function numericVars() {
  return currentVars.filter(v => v.type === 'numeric').map(v => v.name);
}

/** Populate the response dropdown + predictor checkboxes from the numeric columns. */
function onDataLoaded(name) {
  const nums = numericVars();
  if (nums.length < 3) {
    variableSelector.hidden = true;
    resultsSection.hidden = false;
    resultsPanel.innerHTML = `<p class="placeholder">"${name}" has only ${nums.length} numeric variable(s). Multiple regression needs at least 3 (one response + two predictors).</p>`;
    return;
  }
  variableSelector.hidden = false;

  const wantResponse = params.get('response');
  const wantPredictors = (params.get('predictors') || '').split(',').map(s => s.trim()).filter(Boolean);

  responseSelect.innerHTML = nums.map(n => `<option value="${n}">${n}</option>`).join('');
  responseSelect.value = wantResponse && nums.includes(wantResponse) ? wantResponse : nums[0];

  rebuildPredictorList(wantPredictors);
  fitAndRender();
}

/** Predictor checkboxes = numeric vars except the chosen response. */
function rebuildPredictorList(preselect) {
  const resp = responseSelect.value;
  const preset = preselect && preselect.length
    ? preselect
    : numericVars().filter(n => n !== resp).slice(0, 2); // default: first two predictors
  predictorList.innerHTML = numericVars()
    .filter(n => n !== resp)
    .map(n => `<label><input type="checkbox" value="${n}"${preset.includes(n) ? ' checked' : ''}> ${n}</label>`)
    .join('');
  predictorList.querySelectorAll('input').forEach(cb =>
    cb.addEventListener('change', () => fitAndRender()));
}

function selectedPredictors() {
  return Array.from(predictorList.querySelectorAll('input:checked')).map(cb => /** @type {HTMLInputElement} */ (cb).value);
}

responseSelect.addEventListener('change', () => { rebuildPredictorList(null); fitAndRender(); });
expertToggle.addEventListener('change', () => fitAndRender());

// ─── Fit + render ───────────────────────────────────────────────────────────
function column(name) {
  return currentRows.map(r => Number(r[name])).filter(v => Number.isFinite(v));
}

function fitAndRender() {
  const resp = responseSelect.value;
  const predictors = selectedPredictors();
  resultsSection.hidden = false;

  if (predictors.length < 1) {
    resultsPanel.innerHTML = '<p class="placeholder">Select at least one predictor.</p>';
    return;
  }

  // Align rows: keep only rows where response + all predictors are finite.
  const cols = [resp, ...predictors];
  const rows = currentRows.filter(r => cols.every(c => Number.isFinite(Number(r[c]))));
  const y = rows.map(r => Number(r[resp]));
  const X = predictors.map(p => rows.map(r => Number(r[p])));

  let fit;
  try {
    fit = fitMLR(X, y, { predictorNames: predictors, responseName: resp });
  } catch (err) {
    resultsPanel.innerHTML = `<p class="error">Could not fit the model: ${/** @type {Error} */ (err).message}</p>`;
    return;
  }
  renderResults(fit, X, predictors, resp);
  announce(`Fitted ${resp} on ${predictors.join(', ')}. R-squared ${(fit.r2 * 100).toFixed(1)} percent, F = ${fit.fStat.toFixed(2)}, p = ${formatStat(fit.fp, 4, 'pvalue')}.`);
}

function renderResults(fit, X, predictors, resp) {
  const d = 4;
  const expert = expertToggle.checked;
  const num = v => formatStat(v, d);
  const pfmt = v => formatStat(v, d, 'pvalue');

  const coefRows = fit.coefficients.map(c => `
    <tr>
      <th scope="row">${c.name}</th>
      <td>${num(c.estimate)}</td>
      <td>${num(c.se)}</td>
      <td>${c.t.toFixed(3)}</td>
      <td>${pfmt(c.p)}</td>
      <td>(${num(c.ciLo)}, ${num(c.ciHi)})</td>
      ${expert ? `<td class="vif-col">${c.vif == null ? '—' : c.vif.toFixed(2)}</td>` : ''}
    </tr>`).join('');

  // Escape variable names — they routinely contain underscores (skull_w), which
  // would break inside \text{} (D-15 / escapeTex).
  const eqn = tex(`\\widehat{\\text{${escapeTex(resp)}}} = ${num(fit.coefficients[0].estimate)} ${fit.coefficients.slice(1).map(c => `${c.estimate >= 0 ? '+' : '-'} ${num(Math.abs(c.estimate))}\\,(\\text{${escapeTex(c.name)}})`).join(' ')}`);

  // High-influence points (Cook's D > 4/n)
  const flagged = fit.cooksD.map((dv, i) => ({ i, dv })).filter(o => o.dv > fit.cooksThreshold);
  const influence = flagged.length
    ? `<div class="influence-flag"><strong>${flagged.length}</strong> high-influence point${flagged.length === 1 ? '' : 's'} flagged (Cook's D &gt; 4/n = ${fit.cooksThreshold.toFixed(3)}). Inspect the residual plot; a few influential rows can dominate the fit.</div>`
    : `<p class="hint">No points exceed the Cook's distance flag (4/n = ${fit.cooksThreshold.toFixed(3)}).</p>`;

  const vifNote = expert && fit.k >= 2
    ? `<p class="hint">VIF &gt; 5 (some say 10) suggests a predictor is strongly explained by the others — multicollinearity. VIF = 1 means no correlation with the other predictors.</p>`
    : '';

  resultsPanel.innerHTML = `
    <h2>Fitted model</h2>
    <p class="mlr-eqn">${eqn}</p>

    <table class="results-table mlr-coef-table" aria-label="Coefficient table">
      <thead>
        <tr><th scope="col">Term</th><th scope="col">Estimate</th><th scope="col">Std. Error</th><th scope="col">t</th><th scope="col">p-value</th><th scope="col">95% CI</th>${expert ? '<th scope="col">VIF</th>' : ''}</tr>
      </thead>
      <tbody>${coefRows}</tbody>
    </table>
    ${vifNote}

    <div class="mlr-fit-stats">
      <div>Multiple R²: <strong>${(fit.r2 * 100).toFixed(1)}%</strong></div>
      <div>Adjusted R²: <strong>${(fit.adjR2 * 100).toFixed(1)}%</strong></div>
      <div>Residual SE: <strong>${num(fit.residualSE)}</strong> (df ${fit.fdf2})</div>
    </div>
    <div class="formula-display">
      <h3>Model F-test</h3>
      <p>${tex(`F = ${fit.fStat.toFixed(3)}`)} on ${fit.fdf1} and ${fit.fdf2} df, p-value = ${pfmt(fit.fp)}.</p>
      <p class="hint">Tests H₀: all slopes are 0 (the predictors together explain nothing) vs. at least one slope ≠ 0.</p>
    </div>

    <details class="mlr-section formula-display"${params.get('diagnostics') === 'true' ? ' open' : ''}>
      <summary><h3>Diagnostics</h3></summary>
      ${influence}
      <div class="mlr-diag-charts">
        <figure><div id="resid-fitted"></div><figcaption>Residuals vs fitted — look for random scatter (no funnel or curve).</figcaption></figure>
        <figure><div id="resid-hist"></div><figcaption>Residual distribution — should be roughly symmetric / normal.</figcaption></figure>
      </div>
    </details>

    ${predictors.length >= 2 ? `<details class="mlr-section formula-display" open>
      <summary><h3>Predictor relationships${expert ? '' : ' (multicollinearity)'}</h3></summary>
      <p class="hint">Pairwise scatterplots of the predictors. Strong linear patterns between predictors signal multicollinearity${expert ? ' (see the VIF column above)' : ' — turn on Expert mode for the VIF metric'}.</p>
      <div id="scatter-matrix" class="scatter-matrix"></div>
    </details>` : ''}
  `;

  // Diagnostic charts must be drawn when their container is visible — inside a
  // collapsed <details> the container has zero width and the chart mis-sizes.
  // Render on first open (and now, if it starts open).
  const diagDetails = /** @type {HTMLDetailsElement|null} */ (resultsPanel.querySelector('.mlr-section'));
  let diagDrawn = false;
  const drawDiagnostics = () => {
    if (diagDrawn) return;
    const rf = document.getElementById('resid-fitted');
    const rh = document.getElementById('resid-hist');
    if (!rf || !rh || rf.clientWidth === 0) return; // still hidden
    drawScatterplot(rf, fit.fitted, fit.residuals, {
      xLabel: 'Fitted value', yLabel: 'Residual', titleText: 'Residuals vs fitted', minimal: true,
    });
    drawHistogram(rh, fit.residuals, { xLabel: 'Residual', titleText: 'Residual distribution', animate: false });
    diagDrawn = true;
  };
  if (diagDetails) {
    diagDetails.addEventListener('toggle', () => { if (diagDetails.open) drawDiagnostics(); });
    if (diagDetails.open) drawDiagnostics();
  }

  // The scatter matrix lives in an open <details>, so it can draw immediately.
  if (predictors.length >= 2) renderScatterMatrix(X, predictors);
}

/** k×k pairwise scatterplot matrix of the predictors. */
function renderScatterMatrix(X, names) {
  const el = document.getElementById('scatter-matrix');
  if (!el) return;
  const k = names.length;
  const size = k <= 3 ? 120 : k <= 4 ? 96 : 76;
  el.style.gridTemplateColumns = `repeat(${k}, ${size}px)`;
  el.innerHTML = '';
  for (let row = 0; row < k; row++) {
    for (let col = 0; col < k; col++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      if (row === col) {
        cell.className += ' diag-label';
        cell.style.width = cell.style.height = `${size}px`;
        cell.textContent = names[row];
      } else {
        cell.appendChild(miniScatter(X[col], X[row], size));
      }
      el.appendChild(cell);
    }
  }
}

/** Minimal dependency-free mini-scatter SVG (too small for axes). */
function miniScatter(xs, ys, size) {
  const pad = 6;
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  const ymin = Math.min(...ys), ymax = Math.max(...ys);
  const sx = v => pad + (xmax === xmin ? 0.5 : (v - xmin) / (xmax - xmin)) * (size - 2 * pad);
  const sy = v => size - pad - (ymax === ymin ? 0.5 : (v - ymin) / (ymax - ymin)) * (size - 2 * pad);
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('role', 'img');
  const rect = document.createElementNS(svgNS, 'rect');
  rect.setAttribute('width', String(size)); rect.setAttribute('height', String(size));
  rect.setAttribute('fill', 'none'); rect.setAttribute('stroke', '#D9D9D9');
  svg.appendChild(rect);
  for (let i = 0; i < xs.length; i++) {
    const c = document.createElementNS(svgNS, 'circle');
    c.setAttribute('cx', sx(xs[i]).toFixed(1));
    c.setAttribute('cy', sy(ys[i]).toFixed(1));
    c.setAttribute('r', '1.8');
    c.setAttribute('fill', '#569BBD');
    c.setAttribute('fill-opacity', '0.6');
    svg.appendChild(c);
  }
  return svg;
}

// ─── Wire data sources ──────────────────────────────────────────────────────
datasetSelect.addEventListener('change', () => loadDataset(datasetSelect.value));

fileInput?.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  const text = await file.text();
  const { parseCSV } = await import('../../js/csv-parser.js');
  const parsed = parseCSV(text);
  currentVars = parsed.headers.map((h, i) => ({
    name: h,
    type: parsed.types[i] === 'numeric' ? 'numeric' : 'categorical',
  }));
  currentRows = parsed.data;
  onDataLoaded(file.name);
});

// ─── Init ───────────────────────────────────────────────────────────────────
const startId = params.get('dataset') && CURATED.includes(params.get('dataset'))
  ? /** @type {string} */ (params.get('dataset'))
  : 'possum';
datasetSelect.value = startId;
await loadDataset(startId);
