// @ts-check
/**
 * Scatterplot Editor — drag data points, add/remove them, and watch the OLS
 * line + r + R² respond. Built to *feel* leverage vs. influence (drag a point
 * far in x → the line chases it; far in y near mid-x → an outlier that barely
 * moves the line). The 2-D analog of the Dotplot Editor.
 */

import * as d3 from 'd3-selection';
import * as d3Scale from 'd3-scale';
import * as d3Axis from 'd3-axis';
import { drag as d3drag } from 'd3-drag';
import { linreg, formatStat } from '../../js/stats.js';
import { loadDatasetIndex, dataPath, announce, initHelp } from '../../js/page-utils.js';
import { createRng, randNormal } from '../../js/prng.js';

initHelp();

const chartArea = document.getElementById('chart-area');
const presetSelect = /** @type {HTMLSelectElement} */ (document.getElementById('preset-select'));
const datasetSelect = /** @type {HTMLSelectElement} */ (document.getElementById('dataset-select'));
const showResidualsCheck = /** @type {HTMLInputElement} */ (document.getElementById('show-residuals'));
const flagInfluenceCheck = /** @type {HTMLInputElement} */ (document.getElementById('flag-influence'));
const eqnEl = document.getElementById('sp-eqn');
const influenceNote = document.getElementById('sp-influence-note');

const params = new URLSearchParams(location.search);
const urlSeed = params.get('seed') || 'scatter';

/** @type {{x:number,y:number}[]} */ let points = [];
/** @type {{x:number,y:number}[]} */ let original = [];
let xLabel = 'x', yLabel = 'y';
/** @type {[number,number]} */ let xDomain = [0, 10];
/** @type {[number,number]} */ let yDomain = [0, 10];

const M = { top: 16, right: 16, bottom: 44, left: 48 };
let W = 640, H = 420;

// ── Data sources ───────────────────────────────────────────────────
/** Generate a preset scatter (seeded, so it is reproducible). */
function genPreset(kind) {
  const rng = createRng(urlSeed + ':' + kind);
  const pts = [];
  for (let i = 0; i < 14; i++) {
    const x = 1 + (i / 13) * 8 + randNormal(0, 0.15, rng);
    let y;
    if (kind === 'none') y = randNormal(6, 1.6, rng);
    else if (kind === 'weak') y = 2 + 0.5 * x + randNormal(0, 1.9, rng);
    else y = 2 + 0.8 * x + randNormal(0, 0.7, rng); // linear / leverage base
    pts.push({ x: +x.toFixed(2), y: +y.toFixed(2) });
  }
  if (kind === 'leverage') pts.push({ x: 15.5, y: 5.2 }); // a far-out point to grab
  return pts;
}

function setData(pts, xl = 'x', yl = 'y') {
  points = pts.map(p => ({ ...p }));
  original = pts.map(p => ({ ...p }));
  xLabel = xl; yLabel = yl;
  computeDomains();
  buildChart();
}

/** Fixed, generously padded domains so points have room to be dragged out. */
function computeDomains() {
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  const ymin = Math.min(...ys), ymax = Math.max(...ys);
  const xpad = (xmax - xmin || 1) * 0.55, ypad = (ymax - ymin || 1) * 0.55;
  xDomain = [xmin - xpad, xmax + xpad];
  yDomain = [ymin - ypad, ymax + ypad];
}

// ── Rendering ──────────────────────────────────────────────────────
// The chart is built ONCE per dataset (buildChart) and then updated in place
// (update) on edits. Crucially, dragging calls update() — NOT buildChart() — so
// the SVG (and thus d3-drag's coordinate container) is never torn down mid-drag,
// which is what made grabbed points jump.
/** @type {any} */ let x = null, y = null, gRoot = null, ptsG = null, residG = null, lineEl = null;

function buildChart() {
  if (!chartArea) return;
  W = Math.max(320, Math.min(720, chartArea.clientWidth || 640));
  const iw = W - M.left - M.right, ih = H - M.top - M.bottom;
  x = d3Scale.scaleLinear().domain(xDomain).range([0, iw]);
  y = d3Scale.scaleLinear().domain(yDomain).range([ih, 0]);

  d3.select(chartArea).selectAll('*').remove();
  const svg = d3.select(chartArea).append('svg')
    .attr('viewBox', `0 0 ${W} ${H}`).attr('width', '100%')
    .attr('role', 'img').attr('aria-label', 'Editable scatterplot');
  gRoot = svg.append('g').attr('transform', `translate(${M.left},${M.top})`);

  // Background — click to add a point.
  gRoot.append('rect').attr('width', iw).attr('height', ih)
    .attr('fill', 'transparent').style('cursor', 'crosshair')
    .on('click', function (ev) {
      const [px, py] = d3.pointer(ev, this);
      points.push({ x: +x.invert(px).toFixed(2), y: +y.invert(py).toFixed(2) });
      announce(`Added a point. ${points.length} points.`);
      update();
    });

  // Axes (static — the domain only changes on load/reset, i.e. on buildChart).
  gRoot.append('g').attr('transform', `translate(0,${ih})`).call(d3Axis.axisBottom(x).ticks(6));
  gRoot.append('g').call(d3Axis.axisLeft(y).ticks(6));
  svg.append('text').attr('x', M.left + iw / 2).attr('y', H - 6)
    .attr('text-anchor', 'middle').attr('font-size', 13).text(xLabel);
  svg.append('text').attr('transform', 'rotate(-90)').attr('x', -(M.top + ih / 2)).attr('y', 14)
    .attr('text-anchor', 'middle').attr('font-size', 13).text(yLabel);

  residG = gRoot.append('g').attr('class', 'sp-residuals');
  lineEl = gRoot.append('line').attr('class', 'sp-fit-line').attr('stroke', '#114B5F').attr('stroke-width', 2.5);
  ptsG = gRoot.append('g').attr('class', 'sp-points');

  update();
}

function update() {
  if (!ptsG) return;
  const fit = points.length >= 2 ? linreg(points.map(p => p.x), points.map(p => p.y)) : null;

  // Residuals.
  const rsel = residG.selectAll('line').data(fit && showResidualsCheck?.checked ? points : []);
  rsel.exit().remove();
  rsel.enter().append('line')
    .attr('stroke', '#D89A9E').attr('stroke-width', 1.5).attr('stroke-dasharray', '3,2')
    .merge(rsel)
    .attr('x1', d => x(d.x)).attr('x2', d => x(d.x))
    .attr('y1', d => y(d.y)).attr('y2', d => y(fit.intercept + fit.slope * d.x));

  // OLS line across the visible x-domain.
  if (fit && isFinite(fit.slope)) {
    const [x0, x1] = xDomain;
    lineEl.attr('display', null)
      .attr('x1', x(x0)).attr('y1', y(fit.intercept + fit.slope * x0))
      .attr('x2', x(x1)).attr('y2', y(fit.intercept + fit.slope * x1));
  } else lineEl.attr('display', 'none');

  // High-influence flag: the point whose removal moves the slope most.
  let influentialIdx = -1;
  if (fit && flagInfluenceCheck?.checked && points.length >= 3) {
    let maxDelta = -1;
    for (let i = 0; i < points.length; i++) {
      const rest = points.filter((_, j) => j !== i);
      const f2 = linreg(rest.map(p => p.x), rest.map(p => p.y));
      const d = Math.abs(f2.slope - fit.slope);
      if (isFinite(d) && d > maxDelta) { maxDelta = d; influentialIdx = i; }
    }
  }

  // Points — join; drag is attached once per element (on enter).
  const sel = ptsG.selectAll('circle.sp-point').data(points);
  sel.exit().remove();
  sel.enter().append('circle').attr('class', 'sp-point')
    .attr('r', 6).attr('fill', '#569BBD').attr('fill-opacity', 0.85).attr('stroke', '#fff')
    .call(d3drag()
      .subject(function (ev, d) { return { x: x(d.x), y: y(d.y) }; })
      .on('start', function () { this.__moved = false; })
      .on('drag', function (ev, d) {
        this.__moved = this.__moved || Math.hypot(ev.dx, ev.dy) > 0.5;
        d.x = +Math.max(xDomain[0], Math.min(xDomain[1], x.invert(ev.x))).toFixed(2);
        d.y = +Math.max(yDomain[0], Math.min(yDomain[1], y.invert(ev.y))).toFixed(2);
        update();
      })
      .on('end', function (ev, d) {
        if (!this.__moved) { // a click, not a drag → remove
          const i = points.indexOf(d);
          if (i >= 0 && points.length > 1) { points.splice(i, 1); announce(`Removed a point. ${points.length} points.`); update(); }
        }
      }))
    .merge(sel)
    .classed('sp-influential', (d, i) => i === influentialIdx)
    .attr('cx', d => x(d.x)).attr('cy', d => y(d.y));

  updateReadout(fit, influentialIdx);
}

function updateReadout(fit, influentialIdx) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('stat-n', String(points.length));
  if (fit && isFinite(fit.slope)) {
    const b0 = formatStat(fit.intercept, 2), b1 = formatStat(fit.slope, 3);
    if (eqnEl) eqnEl.innerHTML = `ŷ = ${b0} ${fit.slope >= 0 ? '+' : '−'} ${formatStat(Math.abs(fit.slope), 3)}x`;
    set('stat-slope', b1);
    set('stat-intercept', b0);
    set('stat-r', formatStat(fit.r, 3));
    set('stat-r2', formatStat(fit.r2, 3));
  } else {
    if (eqnEl) eqnEl.innerHTML = '&nbsp;';
    ['stat-slope', 'stat-intercept', 'stat-r', 'stat-r2'].forEach(id => set(id, '—'));
  }
  if (influenceNote) {
    if (influentialIdx >= 0) {
      influenceNote.hidden = false;
      influenceNote.textContent = 'The flagged point moves the slope the most — remove it (click) and watch r, R², and the line change.';
    } else influenceNote.hidden = true;
  }
}

// ── Controls ───────────────────────────────────────────────────────
presetSelect?.addEventListener('change', () => {
  datasetSelect.value = '';
  setData(genPreset(presetSelect.value), 'x', 'y');
});
document.getElementById('reset-btn')?.addEventListener('click', () => {
  points = original.map(p => ({ ...p }));
  computeDomains(); buildChart();
  announce('Reset to the starting scatter.');
});
showResidualsCheck?.addEventListener('change', update);
flagInfluenceCheck?.addEventListener('change', update);
window.addEventListener('resize', buildChart);

// Dataset dropdown (regression-type: two numeric variables).
(async () => {
  const index = await loadDatasetIndex(datasetSelect,
    ds => ds.type === 'regression' || (ds.variables && ds.hasNumeric && (ds.numericCount ?? 2) >= 2));
  datasetSelect?.addEventListener('change', async () => {
    const id = datasetSelect.value;
    if (!id) return;
    presetSelect.value = '';
    try {
      const resp = await fetch(dataPath(`${id}.json`));
      const ds = await resp.json();
      const nums = ds.variables.filter(/** @param {any} v */ v => v.type === 'numeric');
      if (nums.length < 2) { announce('This dataset needs two numeric variables.'); return; }
      const xv = nums[0].name, yv = nums[1].name;
      const pts = ds.rows.map(/** @param {any} r */ r => ({ x: +r[xv], y: +r[yv] }))
        .filter(/** @param {any} p */ p => isFinite(p.x) && isFinite(p.y));
      setData(pts, nums[0].label || xv, nums[1].label || yv);
      announce(`${ds.name} loaded.`);
    } catch { announce('Could not load that dataset.'); }
  });
  // URL ?dataset=
  const wanted = params.get('dataset');
  if (wanted && index.some(d => d.id === wanted)) {
    datasetSelect.value = wanted;
    datasetSelect.dispatchEvent(new Event('change'));
    return;
  }
  // Default: a preset scatter.
  setData(genPreset(params.get('preset') || 'linear'), 'x', 'y');
})();
