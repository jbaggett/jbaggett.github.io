// @ts-check
/**
 * Regression explore tool — standalone page logic.
 * Loads two-variable datasets, computes regression stats, renders scatterplot.
 */

import { drawScatterplot, drawResidualPlot } from '../../js/scatterplot.js';
import { linreg, loess, detectPrecision, formatStat } from '../../js/stats.js';
import jstatMod from 'jstat';
import { setJStat } from '../../js/distributions.js';
import { regressionIntervals } from '../../js/inference.js';

setJStat(jstatMod.default || jstatMod);
import { announce, initTabs, initDataPanel, initHelp, setPageTitle, initToolHandoff } from '../../js/page-utils.js';


initHelp();
const baseTitle = document.title.replace(/\s*\|\s*StatLens$/, '');

// ── State ──────────────────────────────────────────────────────────────────

/** @type {Array<Object<string,any>>} */
let currentRows = [];

/** @type {string[]} */
let numericColumns = [];

/** @type {string} */
let xVar = '';

/** @type {string} */
let yVar = '';

/** Bundled dataset id currently loaded (null for pasted/file data). Used for the
 *  cross-tool "Test this relationship →" handoff. */
let currentDatasetId = null;

/** Decimal places in source data (for formatStat). */
let dataPrecision = 0;

// ── DOM refs ───────────────────────────────────────────────────────────────

const varPanel = /** @type {HTMLDivElement} */ (document.getElementById('var-panel'));
const xVarSelect = /** @type {HTMLSelectElement} */ (document.getElementById('x-var'));
const yVarSelect = /** @type {HTMLSelectElement} */ (document.getElementById('y-var'));
const dataPreview = /** @type {HTMLDivElement} */ (document.getElementById('data-preview'));
const dataSummary = /** @type {HTMLOutputElement} */ (document.getElementById('data-summary'));
const chartContainer = /** @type {HTMLDivElement} */ (document.getElementById('chart-container'));
const residualContainer = /** @type {HTMLDivElement} */ (document.getElementById('residual-container'));
const residualChartContainer = /** @type {HTMLDivElement} */ (document.getElementById('residual-chart-container'));
const showLineCheckbox = /** @type {HTMLInputElement} */ (document.getElementById('show-line'));
const showLoessCheckbox = /** @type {HTMLInputElement} */ (document.getElementById('show-loess'));
const showBandsCheckbox = /** @type {HTMLInputElement} */ (document.getElementById('show-bands'));
const showPredictCheckbox = /** @type {HTMLInputElement} */ (document.getElementById('show-predict'));
const showResidualsCheckbox = /** @type {HTMLInputElement} */ (document.getElementById('show-residuals'));
const bandsLegend = document.getElementById('bands-legend');
const predictPanel = document.getElementById('predict-panel');
const regX0Input = /** @type {HTMLInputElement} */ (document.getElementById('reg-x0-input'));
const regX0Readout = document.getElementById('reg-x0-readout');
/** Current x₀ for the prediction marker (data units); null → default to x̄. */
let regX0 = (() => { const v = Number(new URLSearchParams(location.search).get('x0')); return isFinite(v) ? v : null; })();
/** Apply ?x=/?y= only on the first dataset load. */
let urlVarsApplied = false;
/** Last chart handle + fit (slope/intercept/data-range) for the marker; ri only when
 *  bands are on. Prediction uses lastReg (works without bands); intervals use lastRi. */
let lastRi = null, lastChart = null, lastReg = null;
/** Allow a slight extrapolation margin (fraction of the x-range) beyond the data for
 *  predictions — enough to see the bands fan out, with an extrapolation warning. */
const EXTRAP = 0.1;
/** Draggable x₀ bounds (data range + extrapolation margin). */
let regBound = null;
const equationDisplay = /** @type {HTMLDivElement} */ (document.getElementById('equation-display'));
const statsDisplay = /** @type {HTMLDivElement} */ (document.getElementById('stats-display'));

// Cross-tool handoff: carry the loaded dataset + chosen x/y to the slope test (E1).
const handoff = initToolHandoff(statsDisplay.parentElement, () => {
    if (!currentDatasetId || !xVar || !yVar || xVar === yVar) return null;
    return {
        label: 'Test this relationship', target: 'inference/slope/',
        dataset: currentDatasetId, params: { x: xVar, y: yVar },
    };
});

/**
 * Load parsed CSV data (shared by paste + file handlers).
 * @param {{headers:string[], types:string[], data:Array<Record<string,any>>}} parsed
 * @param {string} sourceName
 */
function loadParsedData(parsed, sourceName) {
    const numericHeaders = parsed.headers.filter((h, i) => parsed.types[i] === 'numeric');

    if (numericHeaders.length < 2) {
        announce('Need at least two numeric columns. Check your data format.');
        return;
    }

    currentRows = parsed.data.map(row => {
        /** @type {Object<string,any>} */
        const out = {};
        for (const h of parsed.headers) {
            const val = row[h];
            if (numericHeaders.includes(h)) {
                out[h] = val === '' || val === 'NA' ? NaN : Number(val);
            } else {
                out[h] = val;
            }
        }
        return out;
    });

    numericColumns = numericHeaders;
    populateVarSelectors();

    dataSummary.textContent = `${currentRows.length} observations, ${numericColumns.length} numeric variables`;

    setPageTitle(baseTitle, sourceName, { n: currentRows.length });
    announce(`${sourceName}: ${currentRows.length} observations.`);
    updateChart();
}

// ── Variable selectors ─────────────────────────────────────────────────────

function populateVarSelectors() {
    xVarSelect.innerHTML = '';
    yVarSelect.innerHTML = '';

    for (const col of numericColumns) {
        const optX = document.createElement('option');
        optX.value = col;
        optX.textContent = col;
        xVarSelect.appendChild(optX);

        const optY = document.createElement('option');
        optY.value = col;
        optY.textContent = col;
        yVarSelect.appendChild(optY);
    }

    // Default: first column = X, second = Y
    if (numericColumns.length >= 2) {
        xVarSelect.value = numericColumns[0];
        yVarSelect.value = numericColumns[1];
    }

    // Honor ?x=/?y= once (e.g. arriving from a test's "open in the explorer" link).
    if (!urlVarsApplied) {
        urlVarsApplied = true;
        const q = new URLSearchParams(location.search);
        const px = q.get('x'), py = q.get('y');
        if (px && numericColumns.includes(px)) xVarSelect.value = px;
        if (py && numericColumns.includes(py)) yVarSelect.value = py;
    }

    xVar = xVarSelect.value;
    yVar = yVarSelect.value;

    varPanel.hidden = false;
}

// ── Chart rendering ────────────────────────────────────────────────────────

function updateChart() {
    xVar = xVarSelect.value;
    yVar = yVarSelect.value;

    if (!xVar || !yVar || xVar === yVar) {
        chartContainer.innerHTML = '';
        equationDisplay.hidden = true;
        statsDisplay.hidden = true;
        residualContainer.hidden = true;
        if (xVar === yVar && xVar) {
            announce('X and Y variables must be different.');
        }
        handoff.refresh();
        return;
    }

    // Extract numeric values, filtering NaN pairs
    const xAll = currentRows.map(r => Number(r[xVar]));
    const yAll = currentRows.map(r => Number(r[yVar]));

    /** @type {number[]} */
    const xClean = [];
    /** @type {number[]} */
    const yClean = [];
    for (let i = 0; i < xAll.length; i++) {
        if (isFinite(xAll[i]) && isFinite(yAll[i])) {
            xClean.push(xAll[i]);
            yClean.push(yAll[i]);
        }
    }

    if (xClean.length < 2) {
        chartContainer.innerHTML = '<p class="placeholder">Need at least 2 valid data points.</p>';
        equationDisplay.hidden = true;
        statsDisplay.hidden = true;
        residualContainer.hidden = true;
        handoff.refresh();
        return;
    }

    // Compute regression
    const reg = linreg(xClean, yClean);
    const showLine = showLineCheckbox.checked;
    dataPrecision = Math.max(detectPrecision(xClean), detectPrecision(yClean));
    const d = dataPrecision;

    // LOESS curve
    const showLoess = showLoessCheckbox.checked;
    const loessCurveData = showLoess ? loess(xClean, yClean) : undefined;

    // Prediction (drag/enter x → predicted ŷ) and the CI/prediction bands are now
    // INDEPENDENT toggles. Prediction needs only the fitted line (n ≥ 2); the bands
    // and interval whiskers need ri (n ≥ 3). A course can show predictions without
    // ever showing intervals.
    const showPredict = showPredictCheckbox.checked && xClean.length >= 2;
    const showBands = showBandsCheckbox.checked && xClean.length >= 3;

    const xMin = Math.min(...xClean), xMax = Math.max(...xClean);
    const xbar = xClean.reduce((a, b) => a + b, 0) / xClean.length;
    let xDomain;
    if (showPredict) {
        const margin = (xMax - xMin) * EXTRAP; // allow a slight extrapolation
        regBound = { min: xMin - margin, max: xMax + margin };
        const pad = (xMax - xMin) * 0.03;
        xDomain = [regBound.min - pad, regBound.max + pad];
    } else {
        regBound = null;
    }

    let confidenceBand, predictionBand, ri = null;
    if (showBands) {
        // Extend the bands into the extrapolation margin only when the marker is shown.
        ri = regressionIntervals(xClean, yClean, { confLevel: 0.95, bandExtendFrac: showPredict ? EXTRAP : 0 });
        confidenceBand = ri.meanBand;
        predictionBand = ri.predictionBand;
    }

    // Draw scatterplot
    chartContainer.innerHTML = '';
    const chart = drawScatterplot(chartContainer, xClean, yClean, {
        xLabel: xVar,
        yLabel: yVar,
        titleText: `Scatterplot of ${yVar} vs ${xVar}`,
        descText: `Scatterplot with ${xClean.length} points showing ${yVar} on the y-axis and ${xVar} on the x-axis.`,
        id: 'scatter-main',
        regression: showLine ? { slope: reg.slope, intercept: reg.intercept } : undefined,
        loessCurve: loessCurveData,
        confidenceBand,
        predictionBand,
        xDomain,
    });

    lastChart = chart;
    lastRi = ri; // null unless bands are on
    lastReg = { slope: reg.slope, intercept: reg.intercept, xMin, xMax };

    // Bands legend only with bands; prediction marker/panel only with predict.
    if (showBands && ri) renderBandsLegend();
    else if (bandsLegend) bandsLegend.hidden = true;

    if (showPredict) {
        if (regX0 == null || regX0 < regBound.min || regX0 > regBound.max) regX0 = round2(xbar);
        if (regX0Input) { regX0Input.value = String(regX0); regX0Input.min = String(round2(regBound.min)); regX0Input.max = String(round2(regBound.max)); }
        if (predictPanel) predictPanel.hidden = false;
        drawX0Marker();
        attachX0Drag();
    } else if (predictPanel) {
        predictPanel.hidden = true;
    }

    // Equation display
    const b0 = formatStat(reg.intercept, d);
    const b1 = formatStat(reg.slope, d);
    const sign = reg.slope >= 0 ? '+' : '';
    equationDisplay.innerHTML = `&#375; = ${b0} ${sign} ${b1} &middot; x`;
    equationDisplay.hidden = false;

    // Stats display
    const n = xClean.length;
    const residSE = n > 2
        ? Math.sqrt(reg.residuals.reduce((s, e) => s + e * e, 0) / (n - 2))
        : NaN;

    statsDisplay.innerHTML = `
        <div class="stat-card">
            <div class="stat-label">Correlation (r)</div>
            <div class="stat-value">${formatStat(reg.r, d, 'correlation')}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">R-squared</div>
            <div class="stat-value">${formatStat(reg.r2, d, 'correlation')}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Slope (b&#8321;)</div>
            <div class="stat-value">${formatStat(reg.slope, d)}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Intercept (b&#8320;)</div>
            <div class="stat-value">${formatStat(reg.intercept, d)}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Residual SE</div>
            <div class="stat-value">${formatStat(residSE, d)}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">n</div>
            <div class="stat-value">${n}</div>
        </div>
    `;
    statsDisplay.hidden = false;

    // Residual plot
    if (showResidualsCheckbox.checked) {
        residualContainer.hidden = false;
        residualChartContainer.innerHTML = '';
        drawResidualPlot(residualChartContainer, reg.fitted, reg.residuals, {
            id: 'resid-plot',
            titleText: 'Residual plot',
            descText: `Residuals vs fitted values for the regression of ${yVar} on ${xVar}.`,
        });
    } else {
        residualContainer.hidden = true;
    }

    handoff.refresh();

    announce(`Regression: r = ${formatStat(reg.r, d, 'correlation')}, R² = ${formatStat(reg.r2, d, 'correlation')}, slope = ${formatStat(reg.slope, d)}`);
}

// ── Interactive x₀ prediction marker ───────────────────────────────────────
const SVGNS = 'http://www.w3.org/2000/svg';
function round2(v) { return Math.round(v * 100) / 100; }

function renderBandsLegend() {
  if (!bandsLegend) return;
  bandsLegend.innerHTML =
    '<span class="legend-item"><span class="legend-swatch legend-ci"></span> 95% CI — mean response (narrower)</span>' +
    '<span class="legend-item"><span class="legend-swatch legend-pi"></span> 95% prediction interval — one new observation (wider)</span>';
  bandsLegend.hidden = false;
}

/** @param {string} tag @param {Record<string,string|number>} attrs */
function svgEl(tag, attrs) {
  const el = document.createElementNS(SVGNS, tag);
  for (const k in attrs) el.setAttribute(k, String(attrs[k]));
  return el;
}

/** Draw (or redraw) the x₀ marker: predicted point + (only with bands) CI/PI whiskers. */
function drawX0Marker() {
  if (!lastReg || !lastChart || regX0 == null) return;
  const { frame, xScale, yScale } = lastChart;
  const g = frame.inner;
  g.querySelector('.x0-marker')?.remove();
  const marker = svgEl('g', { class: 'x0-marker', 'aria-hidden': 'true' });
  const x0 = Math.max(regBound?.min ?? lastReg.xMin, Math.min(regBound?.max ?? lastReg.xMax, regX0));
  const fit = lastReg.intercept + lastReg.slope * x0;
  const cx = xScale(x0);
  // Visible dashed vertical guide + a wide transparent grab handle so ANY point along
  // its full height can be grabbed and dragged (cursor signals it).
  marker.appendChild(svgEl('line', { x1: cx, x2: cx, y1: 0, y2: frame.height, stroke: '#7B2D8E', 'stroke-width': 1.5, 'stroke-dasharray': '4,3', 'stroke-opacity': 0.6, style: 'cursor:ew-resize' }));
  marker.appendChild(svgEl('line', { class: 'x0-grab', x1: cx, x2: cx, y1: 0, y2: frame.height, stroke: 'transparent', 'stroke-width': 20, style: 'cursor:ew-resize' }));
  // Horizontal guide from the y-axis to the point — read the predicted ŷ off the axis.
  marker.appendChild(svgEl('line', { x1: 0, x2: cx, y1: yScale(fit), y2: yScale(fit), stroke: '#7B2D8E', 'stroke-width': 1, 'stroke-dasharray': '4,3', 'stroke-opacity': 0.4 }));

  // CI / prediction-interval whiskers — ONLY when the bands are shown.
  let meanCI = null, predPI = null;
  if (lastRi) {
    meanCI = lastRi.predictAt(x0, 'mean');
    predPI = lastRi.predictAt(x0, 'prediction');
    marker.appendChild(svgEl('line', { x1: cx, x2: cx, y1: yScale(predPI.lower), y2: yScale(predPI.upper), stroke: '#E07020', 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-opacity': 0.95 }));
    for (const yv of [predPI.lower, predPI.upper]) marker.appendChild(svgEl('line', { x1: cx - 6, x2: cx + 6, y1: yScale(yv), y2: yScale(yv), stroke: '#E07020', 'stroke-width': 2 }));
    marker.appendChild(svgEl('line', { x1: cx, x2: cx, y1: yScale(meanCI.lower), y2: yScale(meanCI.upper), stroke: '#114B5F', 'stroke-width': 4, 'stroke-linecap': 'round' }));
    for (const yv of [meanCI.lower, meanCI.upper]) marker.appendChild(svgEl('line', { x1: cx - 4, x2: cx + 4, y1: yScale(yv), y2: yScale(yv), stroke: '#114B5F', 'stroke-width': 2 }));
  }
  // Predicted point + draggable handle
  marker.appendChild(svgEl('circle', { cx, cy: yScale(fit), r: 4.5, fill: '#7B2D8E', stroke: '#fff', 'stroke-width': 1.5, style: 'cursor:ew-resize' }));
  g.appendChild(marker);
  updateX0Readout(x0, fit, meanCI, predPI);
}

/** @param {number} x0 @param {number} fit @param {any} meanCI @param {any} predPI */
function updateX0Readout(x0, fit, meanCI, predPI) {
  if (!regX0Readout) return;
  const d = dataPrecision;
  const extrap = x0 < lastReg.xMin - 1e-9 || x0 > lastReg.xMax + 1e-9;
  let html = `<p>At <strong>${xVar} = ${formatStat(x0, d)}</strong> → predicted ${yVar} = <strong>${formatStat(fit, d)}</strong>`
    + (extrap ? ' <span class="extrap-warn">⚠ extrapolating beyond the observed data — this prediction is unreliable</span>' : '') + '</p>';
  if (meanCI) html += `<p><span class="legend-swatch legend-ci"></span> 95% CI for the mean: (${formatStat(meanCI.lower, d)}, ${formatStat(meanCI.upper, d)})</p>`;
  if (predPI) html += `<p><span class="legend-swatch legend-pi"></span> 95% prediction interval: (${formatStat(predPI.lower, d)}, ${formatStat(predPI.upper, d)})</p>`;
  regX0Readout.innerHTML = html;
}

/** Drag anywhere on the plot to set x₀ (maps pointer → data-x via the inner group CTM). */
function attachX0Drag() {
  if (!lastChart) return;
  const { frame, xScale } = lastChart;
  const g = frame.inner;
  const svg = g.ownerSVGElement;
  if (!svg || svg.dataset.x0Drag) return;
  svg.dataset.x0Drag = '1'; // the SVG is recreated each updateChart, so this binds once per draw
  svg.style.touchAction = 'none';
  const toDataX = (evt) => {
    const pt = svg.createSVGPoint(); pt.x = evt.clientX; pt.y = evt.clientY;
    const local = pt.matrixTransform(g.getScreenCTM().inverse());
    return xScale.invert(local.x);
  };
  let dragging = false;
  const move = (evt) => {
    if (!dragging || !lastReg) return;
    regX0 = Math.max(regBound?.min ?? lastReg.xMin, Math.min(regBound?.max ?? lastReg.xMax, round2(toDataX(evt))));
    if (regX0Input) regX0Input.value = String(regX0);
    drawX0Marker();
  };
  svg.addEventListener('pointerdown', (e) => { dragging = true; try { svg.setPointerCapture(e.pointerId); } catch { /* ignore */ } move(e); });
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerup', () => { dragging = false; });
  svg.addEventListener('pointercancel', () => { dragging = false; });
}

// ── Init ──────────────────────────────────────────────────────────────────

initTabs();

initDataPanel({
    autoCollapse: true,
    showPreview: true,
    datasetFilter: ds => ds.type === 'regression',
    onDataset: (ds) => {
        currentDatasetId = ds.id;
        currentRows = ds.rows;
        const varInfo = ds.variables || [];
        numericColumns = varInfo
            .filter(/** @param {any} v */ v => v.type === 'numeric')
            .map(/** @param {any} v */ v => v.name);

        if (numericColumns.length < 2 && currentRows.length > 0) {
            numericColumns = Object.keys(currentRows[0]).filter(k =>
                typeof currentRows[0][k] === 'number');
        }

        // Reset controls to defaults on new data
        showLineCheckbox.checked = true;
        showLoessCheckbox.checked = false;
        showResidualsCheckbox.checked = false;

        populateVarSelectors();
        dataSummary.textContent = `${currentRows.length} observations, ${numericColumns.length} numeric variables`;
        announce(`${ds.name}: ${currentRows.length} observations.`);
        updateChart();
    },
    onText: (parsed, name) => { currentDatasetId = null; loadParsedData(parsed, name); },
    onClear: () => {
        currentDatasetId = null;
        currentRows = [];
        numericColumns = [];
        chartContainer.innerHTML = '';
        equationDisplay.hidden = true;
        statsDisplay.hidden = true;
        residualContainer.hidden = true;
        varPanel.hidden = true;
        dataPreview.hidden = true;
    },
});

xVarSelect.addEventListener('change', updateChart);
yVarSelect.addEventListener('change', updateChart);
showLineCheckbox.addEventListener('change', updateChart);
showLoessCheckbox.addEventListener('change', updateChart);
showBandsCheckbox.addEventListener('change', updateChart);
showPredictCheckbox.addEventListener('change', updateChart);
regX0Input?.addEventListener('input', () => {
  const v = Number(regX0Input.value);
  if (isFinite(v) && lastReg) { regX0 = Math.max(regBound?.min ?? lastReg.xMin, Math.min(regBound?.max ?? lastReg.xMax, v)); drawX0Marker(); }
});
showResidualsCheckbox.addEventListener('change', updateChart);

// URL params (independent): ?predict=true opens the draggable prediction marker;
// ?bands=true (alias ?interval=) opens the CI/PI bands. For backward compatibility,
// ?bands=true also turns prediction on (bands used to imply the marker).
const _p = new URLSearchParams(location.search);
const bandsOn = ['true', '1', 'mean', 'prediction', 'both'].includes((_p.get('bands') || _p.get('interval') || '').toLowerCase());
const predictParam = (_p.get('predict') || '').toLowerCase();
if (bandsOn) showBandsCheckbox.checked = true;
// Prediction is on by default; ?predict=false turns it off, ?predict=true/bands=true keep it on.
if (predictParam === 'false' || predictParam === '0') showPredictCheckbox.checked = false;
else if (predictParam === 'true' || predictParam === '1' || bandsOn) showPredictCheckbox.checked = true;
