// @ts-check
/**
 * Bootstrap CI: Regression Slope page.
 * Resamples (x, y) pairs with replacement, refits regression,
 * records the slope. Showcase: bootstrap lines overlaid on scatterplot.
 */

import { createRng } from '../../js/prng.js';
import { linreg, mean, sd, detectPrecision, formatStat } from '../../js/stats.js';
import { bootstrapCI } from '../../js/sim-engine.js';
import { drawScatterplot } from '../../js/scatterplot.js';
import { computeBins } from '../../js/histogram.js';
import { parseCSV } from '../../js/csv-parser.js';
import { announce, initTabs, initKeyboardShortcuts, initPlayPause, initMechanismCollapse, initDataPanel, computeHighlights, animateDropToChart, flyDataStream, createExpertToggle, updateTabHint, getActiveTabId, getTabHintText, setPageTitle } from '../../js/page-utils.js';
import { renderSimChart, resolveChartType, createChartToggle, computeDomain } from '../../js/chart-defaults.js';
import { normalPdf, overlayTheoryCurve } from '../../js/theory-overlay.js';
import {
  ciMethodFromUrl, createCiMethodControl, normalApproxCI, zLabelFor,
  drawCiPills, drawCompareBounds, appendCiLegend,
  PERCENTILE_CI_COLOR, NORMAL_CI_COLOR,
} from '../../js/ci-method.js';

// ─── DOM ───

const scatterContainer = document.getElementById('scatter-container');
const histContainer = document.getElementById('hist-container');
const resultDiv = document.getElementById('result-summary');
const resetBtn = /** @type {HTMLButtonElement} */ (document.getElementById('reset-btn'));
const ciSelect = /** @type {HTMLInputElement} */ (document.getElementById('ci-level'));
const ciPills = /** @type {HTMLElement|null} */ (ciSelect?.closest('.ci-primary')?.querySelector('.conf-pills') ?? null);
const dataSummary = document.getElementById('data-summary');
const dataPreview = document.getElementById('data-preview');

// Mechanism strip elements
const mechanismStrip = document.getElementById('mechanism-strip');
const mechObservedPlot = document.getElementById('mech-observed-plot');
const mechResamplePlot = document.getElementById('mech-resample-plot');
const mechObservedSlope = document.getElementById('mech-observed-slope');
const mechResampleSlope = document.getElementById('mech-resample-slope');
const mechanismDescEl = document.getElementById('mechanism-description');
const simTitleEl = document.getElementById('sim-title');

const genBtns = /** @type {NodeListOf<HTMLButtonElement>} */ (
  document.querySelectorAll('.gen-btn'));

// Controls section (for expert toggle)
const controlsSection = document.getElementById('controls');

// The confidence level is the CORE control of a CI tool — it stays visible, as on
// the other bootstrap pages. (It used to be hidden behind "More options" here.)

// Add expert toggle link next to generate bar
const generateBar = /** @type {HTMLElement|null} */ (controlsSection?.querySelector('.generate-bar'));
if (generateBar) createExpertToggle(generateBar);

initTabs({ hintTarget: resultDiv, hintAction: 'run a simulation to see results' });
initKeyboardShortcuts(genBtns, resetBtn);
initPlayPause(genBtns, resetBtn);

// ─── State ───

/** @type {number[]} */
let xData = [];
/** @type {number[]} */
let yData = [];
let xLabel = 'x';
let yLabel = 'y';
/** @type {{population?:string, parameter?:string, unit?:string}} */
let datasetContext = {};
let currentSourceName = '';
const baseTitle = document.title.replace(/\s*\|\s*StatLens$/, '');

/** @type {number[]} */
let allSlopes = [];
/** @type {Array<{slope: number, intercept: number}>} */
let bootLines = [];
/** @type {(() => number)|null} */
let rng = null;
let seed = Math.random().toString(36).slice(2, 10);
let mechanismInitialized = false;

let observedSlope = 0;
let observedIntercept = 0;

/** Chart grid from the last run, so a level/method change can redraw without one. */
/** @type {[number,number]|undefined} */
let lastHlDomain;
/** @type {number[]|undefined} */
let lastHlThresholds;

/** Decimal places in source data (for formatStat). */
let dataPrecision = 0;

// ─── Data loading ───

/** @param {string} text */
function loadTextData(text) {
  if (!text.trim()) return;
  datasetContext = {};
  try {
    const parsed = parseCSV(text);
    const numIndices = parsed.types
      .map((t, i) => t === 'numeric' ? i : -1)
      .filter(i => i >= 0);
    if (numIndices.length >= 2) {
      xLabel = parsed.headers[numIndices[0]];
      yLabel = parsed.headers[numIndices[1]];
      xData = parsed.data.map(r => parseFloat(r[xLabel])).filter(v => isFinite(v));
      yData = parsed.data.map(r => parseFloat(r[yLabel])).filter(v => isFinite(v));
      const minLen = Math.min(xData.length, yData.length);
      xData = xData.slice(0, minLen);
      yData = yData.slice(0, minLen);
      resetSimulation();
      showDataLoaded();
    }
  } catch {
    announce('Could not parse data.');
  }
}

initDataPanel({
  autoCollapse: true,
  stickyControls: true,
  showPreview: true,
  datasetFilter: ds => ds.type === 'regression',
  onDataset: (ds) => {
    resetSimulation();
    datasetContext = ds.context || {};
    currentSourceName = ds.name || '';
    const numVars = ds.variables.filter(v => v.type === 'numeric');
    if (numVars.length < 2) return;
    xLabel = numVars[0].name;
    yLabel = numVars[1].name;
    xData = ds.rows.map(r => r[xLabel]).filter(v => isFinite(v));
    yData = ds.rows.map(r => r[yLabel]).filter(v => isFinite(v));
    const minLen = Math.min(xData.length, yData.length);
    xData = xData.slice(0, minLen);
    yData = yData.slice(0, minLen);
    showDataLoaded();
    announce(`${ds.name}: ${minLen} observations.`);
  },
  onRawText: (text) => { currentSourceName = ''; loadTextData(text); },
  onClear: () => {
    xData = [];
    yData = [];
    currentSourceName = '';
    resetSimulation();
    if (dataPreview) dataPreview.hidden = true;
    if (dataSummary) dataSummary.textContent = '\u2014';
    for (const btn of genBtns) btn.disabled = true;
    announce('Data cleared.');
  },
});

function showDataLoaded() {
  if (xData.length < 3) {
    announce('Need at least 3 data points.');
    return;
  }
  const reg = linreg(xData, yData);
  observedSlope = reg.slope;
  observedIntercept = reg.intercept;
  dataPrecision = Math.min(2, Math.max(detectPrecision(xData), detectPrecision(yData)));

  if (dataSummary) {
    const d = dataPrecision;
    const namePrefix = currentSourceName ? `${currentSourceName}: ` : '';
    dataSummary.textContent =
      `${namePrefix}n = ${xData.length}, slope = ${formatStat(reg.slope, d)}, r² = ${formatStat(reg.r2, d, 'correlation')}`;
  }
  for (const btn of genBtns) btn.disabled = false;
  if (resultDiv) resultDiv.innerHTML = '<p class="hint">Data loaded. Click a generate button to begin.</p>';

  // Populate mechanism strip observed scatterplot (stays hidden until first generate)
  const mechMargin = { top: 8, right: 8, bottom: 28, left: 22 };
  if (mechObservedPlot) {
    mechObservedPlot.innerHTML = '';
    drawScatterplot(mechObservedPlot, xData, yData, {
      xLabel, yLabel,
      titleText: 'Original Data',
      id: 'mech-obs',
      regression: { slope: observedSlope, intercept: observedIntercept },
      margin: mechMargin,
      minimal: true,
    });
  }
  if (mechObservedSlope) mechObservedSlope.textContent = formatStat(observedSlope, dataPrecision);

  renderScatter();

  setPageTitle(baseTitle, currentSourceName, { n: xData.length });
  announce(`Data loaded: n = ${xData.length}`);

  // Scroll controls into view after DOM settles
  setTimeout(() => {
    const target = document.getElementById('controls') || genBtns[0]?.closest('.generate-bar');
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

// ─── Confidence level + CI method ───
// This page has its own engine (it draws bootstrap lines on a scatterplot), but the
// confidence control and the percentile / ±z·SE choice must behave exactly as they
// do on the sim-app bootstrap pages — hence the shared js/ci-method.js.

/** Current confidence level as a percent in [50, 99.9]. */
const getCiLevel = () => Math.min(99.9, Math.max(50, parseFloat(ciSelect?.value ?? '95') || 95));

let ciMethod = ciMethodFromUrl();
/** @type {{syncPressed: (m: string) => void, syncLabel: (l: number) => void}|null} */
let methodControl = null;

function syncCiPills() {
  if (!ciPills) return;
  const lvl = +getCiLevel().toFixed(1);
  for (const b of ciPills.querySelectorAll('button[data-level]')) {
    b.setAttribute('aria-pressed', String(Number(b.getAttribute('data-level')) === lvl));
  }
}

/** Recompute + redraw at the current level and method (needs a run to show). */
function refreshCi() {
  syncCiPills();
  methodControl?.syncLabel(getCiLevel());
  if (allSlopes.length < 20) return;
  const ciLevel = getCiLevel();
  const result = bootstrapCI([...allSlopes], ciLevel);
  displayResults(allSlopes, result.ci, result.se, ciLevel);
  renderHist(allSlopes, -1, undefined, undefined, result.ci, lastHlDomain, lastHlThresholds);
}

if (ciSelect) {
  ciSelect.addEventListener('input', refreshCi);
  ciSelect.addEventListener('change', refreshCi);
  const ciPrimary = /** @type {HTMLElement|null} */ (ciSelect.closest('.ci-primary'));
  if (ciPrimary) {
    methodControl = createCiMethodControl(ciPrimary, {
      method: ciMethod,
      onChange: (m) => {
        ciMethod = m;
        methodControl?.syncPressed(m);
        refreshCi();
        announce(m === 'percentile' ? 'Percentile method.'
          : m === 'se' ? 'Normal-approximation method: slope ± z · SE.'
          : 'Showing both the percentile and the normal-approximation interval.');
      },
    });
    methodControl.syncLabel(getCiLevel());
  }
}
if (ciPills) {
  ciPills.addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement} */ (e.target).closest('button[data-level]');
    if (!btn || !ciSelect) return;
    ciSelect.value = btn.getAttribute('data-level') || '95';
    refreshCi();
  });
  syncCiPills();
}

// ─── Generate ───

for (const btn of genBtns) {
  btn.addEventListener('click', () => {
    const count = parseInt(btn.dataset.count, 10);
    if (xData.length === 0) {
      announce('Please load data first.');
      return;
    }
    generateResamples(count);
  });
}

/** @param {number} count */
function generateResamples(count) {
  if (!rng) rng = createRng(seed);
  const n = xData.length;
  const prevLength = allSlopes.length;

  // Show mechanism strip on first generate
  if (!mechanismInitialized && mechanismStrip) {
    mechanismInitialized = true;
    mechanismStrip.hidden = false;
    initMechanismCollapse(mechanismStrip);
  }

  if (simTitleEl) {
    simTitleEl.textContent = count === 1 ? 'This Resample' : 'Last Resample';
  }

  /** @type {number[]} */
  let lastXBoot = [];
  /** @type {number[]} */
  let lastYBoot = [];
  let lastReg = { slope: 0, intercept: 0 };

  for (let i = 0; i < count; i++) {
    /** @type {number[]} */
    const indices = [];
    for (let j = 0; j < n; j++) {
      indices.push(Math.floor(rng() * n));
    }
    const xBoot = indices.map(k => xData[k]);
    const yBoot = indices.map(k => yData[k]);
    const reg = linreg(xBoot, yBoot);
    allSlopes.push(reg.slope);
    bootLines.push({ slope: reg.slope, intercept: reg.intercept });
    lastXBoot = xBoot;
    lastYBoot = yBoot;
    lastReg = reg;
  }

  // Fire flying dots from observed → resample on +1
  if (count === 1 && mechObservedPlot && mechResamplePlot) {
    flyDataStream(mechObservedPlot, mechResamplePlot);
  }

  // Update mechanism strip with last resample (delayed on +1 to let dots land)
  const mechMargin = { top: 8, right: 8, bottom: 28, left: 22 };
  const updateMechanism = () => {
    if (mechResamplePlot) {
      mechResamplePlot.innerHTML = '';
      drawScatterplot(mechResamplePlot, lastXBoot, lastYBoot, {
        xLabel, yLabel,
        titleText: count === 1 ? 'This Resample' : 'Last Resample',
        id: 'mech-resample',
        regression: lastReg,
        margin: mechMargin,
        minimal: true,
      });
    }
    if (mechResampleSlope) {
      mechResampleSlope.textContent = formatStat(lastReg.slope, dataPrecision);
      mechResampleSlope.classList.toggle('highlight-last', count === 1);
    }
  };
  if (count === 1) {
    setTimeout(updateMechanism, 200);
  } else {
    updateMechanism();
  }
  if (mechanismDescEl) {
    mechanismDescEl.textContent = `Resample ${n} (x, y) pairs with replacement, refit regression`;
    mechanismDescEl.hidden = false;
  }

  const ciLevel = getCiLevel();
  /** @type {[number,number]|null} */
  let currentCI = null;
  const CI_MIN = 20;
  if (allSlopes.length >= CI_MIN) {
    const result = bootstrapCI([...allSlopes], ciLevel);
    currentCI = result.ci;
    displayResults(allSlopes, result.ci, result.se, ciLevel);
  } else {
    if (resultDiv) {
      resultDiv.innerHTML = `<p><strong>Bootstrap Distribution</strong> (${allSlopes.length} resamples)</p>
        <p>Need at least ${CI_MIN} resamples for CI estimate.</p>`;
    }
  }

  const bsLo = Math.min(...allSlopes);
  const bsHi = Math.max(...allSlopes);
  const bsPad = (bsHi - bsLo) * 0.05 || 0.5;
  /** @type {[number,number]} */
  const hlDomain = [bsLo - bsPad, bsHi + bsPad];

  // Pre-compute bins to lock in bin edges for both computeHighlights and drawHistogram
  const { bins: fullBins } = computeBins(allSlopes, { domain: hlDomain });
  const lockedThresholds = fullBins.slice(1).map(b => b.x0);

  const { hlIndex, hlIndices, prevBinCounts } = computeHighlights(
    allSlopes, prevLength, count, computeBins,
    { domain: hlDomain, thresholds: lockedThresholds });

  // Remember the grid so a level/method change can redraw without a new run.
  lastHlDomain = hlDomain;
  lastHlThresholds = lockedThresholds;

  renderScatter();

  if (count === 1) {
    setTimeout(() => {
      renderHist(allSlopes, hlIndex, hlIndices, prevBinCounts, currentCI, hlDomain, lockedThresholds);
      if (mechResampleSlope && histContainer) {
        animateDropToChart(mechResampleSlope, histContainer);
      }
    }, 150);
  } else {
    renderHist(allSlopes, hlIndex, hlIndices, prevBinCounts, currentCI, hlDomain, lockedThresholds);
  }

  if (resetBtn) resetBtn.hidden = false;
  announce(`Generated ${count} resample${count > 1 ? 's' : ''}. Total: ${allSlopes.length}`);
}

// ─── Charts ───

function renderScatter() {
  if (!scatterContainer) return;
  scatterContainer.innerHTML = '';
  drawScatterplot(scatterContainer, xData, yData, {
    id: 'scatter',
    xLabel,
    yLabel,
    titleText: 'Data with Bootstrap Lines',
    regression: { slope: observedSlope, intercept: observedIntercept },
    bootstrapLines: bootLines,
  });
}

/**
 * @param {number[]} slopes
 * @param {number} [highlightIndex]
 * @param {Set<number>} [highlightIndices]
 * @param {number[]} [prevBinCounts]
 * @param {[number,number]|null} [ci]
 * @param {[number,number]} [hlDomain]
 * @param {number[]} [hlThresholds]
 */
function renderHist(slopes, highlightIndex = -1, highlightIndices, prevBinCounts, ci, hlDomain, hlThresholds) {
  if (!histContainer) return;
  const n = slopes.length;
  if (n === 0) { histContainer.innerHTML = ''; return; }

  // The CI method drives the picture, not just the results box (see js/ci-method.js).
  const normalCI = (ci && n > 1) ? normalApproxCI(slopes, getCiLevel()) : null;
  const shownCI = (normalCI && ciMethod === 'se') ? normalCI : ci;
  const compareCI = (normalCI && ciMethod === 'both') ? normalCI : null;

  const regionPred = shownCI ? (/** @type {number} */ v) => v >= shownCI[0] && v <= shownCI[1] : undefined;
  const activeChart = resolveChartType(n, 'auto');

  // A ±z·SE bound can sit outside the range of the resamples — keep it on screen.
  /** @type {[number,number]|undefined} */
  let domain = hlDomain;
  if (domain && (shownCI || compareCI)) {
    const extra = [...(shownCI ?? []), ...(compareCI ?? [])];
    domain = [Math.min(domain[0], ...extra), Math.max(domain[1], ...extra)];
  }

  const result = renderSimChart(histContainer, slopes, {
    chartType: activeChart,
    id: 'slope-dist',
    xLabel: 'Bootstrap Slope',
    titleText: 'Bootstrap Distribution of Slope',
    regionPredicate: regionPred,
    observedStat: observedSlope,
    ciLines: shownCI ?? undefined,
    ciColor: ciMethod === 'se' ? NORMAL_CI_COLOR : PERCENTILE_CI_COLOR,
    domain,
    highlightIndex,
    highlightIndices,
    prevBinCounts,
    thresholds: hlThresholds,
    precision: dataPrecision + 1,
    baseFill: shownCI ? '#a0a0a0' : undefined,
    extremeFill: shownCI ? '#569BBD' : undefined,
  });

  // Three symmetric pills (tails + the fraction actually inside), matching the
  // other bootstrap pages — renderSimChart's own pillMode draws only a single one.
  if (shownCI && result?.frame && result.xScale) {
    drawCiPills(result.frame, result.xScale, slopes, shownCI);
    if (compareCI) {
      drawCompareBounds(result.frame, result.xScale, compareCI, dataPrecision + 1);
      appendCiLegend(histContainer, getCiLevel());
    }
  }

  // The ±z·SE interval is read off a normal curve — so show the curve it's read off.
  if (ciMethod !== 'percentile' && slopes.length > 1 && result?.xScale && domain) {
    const centre = mean(slopes);
    const spread = sd(slopes);
    const binWidth = activeChart === 'histogram'
      ? (result.bins?.length ? result.bins[0].x1 - result.bins[0].x0 : null)
      : result.binWidth;
    const yScale = activeChart === 'histogram' ? result.yScale : result.countToY;
    if (spread > 0 && binWidth && yScale) {
      overlayTheoryCurve({
        container: histContainer,
        pdf: (x) => normalPdf(x, centre, spread),
        xDomain: domain,
        totalN: slopes.length,
        binWidth,
        xScale: result.xScale,
        yScale,
        label: 'N(b₁, SE)',
      });
    }
  }
}

/**
 * @param {number[]} slopes
 * @param {[number,number]} ci
 * @param {number} se
 * @param {number} ciLevel
 */
function displayResults(slopes, ci, se, ciLevel) {
  if (!resultDiv) return;
  const d = dataPrecision;
  const fmt = (v) => formatStat(v, d);
  const ciLo = `<span class="ci-value">${fmt(ci[0])}</span>`;
  const ciHi = `<span class="ci-value">${fmt(ci[1])}</span>`;

  const m = mean(slopes);
  const zLabel = zLabelFor(ciLevel);
  const seBounds = normalApproxCI(slopes, ciLevel);
  const seLo = `<span class="ci-value">${fmt(seBounds[0])}</span>`;
  const seHi = `<span class="ci-value">${fmt(seBounds[1])}</span>`;
  const ciPct = Number.isInteger(ciLevel) ? String(ciLevel) : ciLevel.toFixed(1);

  const pctLine = `<p><strong>${ciPct}% CI (percentile):</strong> (${ciLo}, ${ciHi})</p>`;
  const seLine = `<p><strong>${ciPct}% CI (±${zLabel}·SE):</strong> <span class="ci-formula">b&#8321; &plusmn; ${zLabel}&middot;SE = ${fmt(m)} &plusmn; ${zLabel} &times; ${fmt(se)} = (${seLo}, ${seHi})</span></p>`;
  const ciBlock = ciMethod === 'se' ? seLine : ciMethod === 'both' ? pctLine + seLine : pctLine;
  const bothNote = ciMethod === 'both'
    ? '<p class="hint">The two methods agree closely when the bootstrap distribution is symmetric; they diverge when it’s skewed (where the percentile CI is the more honest one).</p>'
    : '';
  // The interval the student reads is the one the chart draws.
  const interpLo = ciMethod === 'se' ? seLo : ciLo;
  const interpHi = ciMethod === 'se' ? seHi : ciHi;

  resultDiv.innerHTML = `
    <p><strong>Bootstrap Distribution</strong> (${slopes.length} resamples)</p>
    <p>Observed slope: ${fmt(observedSlope)}</p>
    <p>Bootstrap mean slope: ${fmt(m)}</p>
    <p>SE: ${fmt(se)}</p>
    ${ciBlock}
    ${bothNote}
    <p class="interpretation">We are ${ciPct}% confident that the ${datasetContext.parameter || 'true population slope'}${datasetContext.population ? ' for ' + datasetContext.population : ''} is between ${interpLo} and ${interpHi}. The ${bootLines.length} semi-transparent lines on the scatterplot show the variability in the fitted regression across bootstrap resamples.</p>
    ${slopes.length < 50 ? '<p class="hint">CI is approximate with few resamples. Generate more for stability.</p>' : ''}
  `;
}

// ─── Reset ───

if (resetBtn) {
  resetBtn.addEventListener('click', () => {
    resetSimulation();
    renderScatter();
    announce('Simulation reset.');
  });
}

function resetSimulation() {
  allSlopes = [];
  bootLines = [];
  rng = null;
  mechanismInitialized = false;
  seed = Math.random().toString(36).slice(2, 10);
  if (histContainer) histContainer.innerHTML = '';
  if (resultDiv) resultDiv.innerHTML = `<p class="placeholder">${getTabHintText(getActiveTabId(), 'run a simulation to see results')}</p>`;
  if (resetBtn) resetBtn.hidden = true;
  if (mechanismStrip) mechanismStrip.hidden = true;
}
