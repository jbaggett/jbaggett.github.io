/**
 * Tilt and Bend — what f ″ does to the graph of f.
 *
 * The Derivative Builder answers "f ″ is the slope of f ′". This answers the
 * other question, the one a student can compute f ″ all semester without ever
 * being asked: what does it DO to the picture?
 *
 * Two readings, in order of how hard they hit:
 *
 *   1. The tangent is the best straight-line copy of the curve, and it has no
 *      bend. Add the squared term and you get the best parabola, which keeps
 *      the tilt AND the bend. The coefficient of that term is exactly ½f ″(a).
 *   2. Subtract the tangent from the curve and only the bending is left. That
 *      is the sharpest picture of f ″ there is — it touches zero at the point
 *      and peels away, up when f ″ > 0, down when f ″ < 0.
 *
 * The second panel is off by default because the first follows §3.10, which is
 * where the course already is, and the leftover lands harder once you have
 * watched the parabola fit and then asked what it missed.
 *
 * Deliberately never says "Taylor" or "osculating". Second-order Taylor is
 * Stewart ch 11; the picture needs none of that machinery, and naming it writes
 * a cheque Calculus 1 does not cash.
 */

import {
  createChart, makeScales, drawAxes, onBreakpointChange, onLayoutChange, alignRangeToPlot,
} from 'kit/chart.js';
import { drawCurve, autoYDomain } from 'kit/curve.js';
import { initPage, announce, applyControls } from 'kit/page.js';
import { getParams, updateUrl } from 'kit/url.js';
import { tex, setTex } from 'kit/tex.js';
import { initExpressionInput } from 'kit/input.js';
import { fmt } from 'kit/format.js';
import { initShare } from 'kit/share.js';
import { MARK } from '../../js/mark.js';
import { tryParse, derivative, compile, toLatex } from '../../js/expr.js';

const $ = (/** @type {string} */ s) => /** @type {any} */ (document.querySelector(s));
const THUMB_PX = 16;

const state = {
  node: null, f: null, df: null, d2f: null,
  xMin: -3, xMax: 3, a: 1,
  parabola: true, residual: false,
};

let chartF = null, chartR = null;

/* ──────────────────────────────── drawing ──────────────────────────────── */

/** The best straight line at a: it matches height and tilt, and cannot bend. */
const tangentAt = (a) => (x) => state.f(a) + state.df(a) * (x - a);

/** One term more: it matches height, tilt and bend. */
const parabolaAt = (a) => (x) =>
  state.f(a) + state.df(a) * (x - a) + 0.5 * state.d2f(a) * (x - a) ** 2;

function render() {
  const { a, xMin, xMax } = state;
  const dom = [xMin, xMax];

  /* ---- the curve, its tangent, and the best parabola ---- */
  chartF = createChart('#chart-f', { height: 300, label: describeTop() });
  // The window is fitted to f alone. A parabola with a large f ″ runs away fast,
  // and letting it vote on the y-range would shrink f to a flat line at exactly
  // the moment the bend is worth looking at.
  const yDom = autoYDomain(state.f, xMin, xMax, { minSpan: 2 });
  const { xs, ys } = makeScales(chartF, dom, yDom);
  drawAxes(chartF, { xs, ys, xLabel: 'x', yLabel: 'y' });
  drawCurve(chartF.plot, state.f, { xs, ys });

  const t1 = tangentAt(a);
  drawCurve(chartF.plot, t1, { xs, ys, className: 'tb-tangent' });
  if (state.parabola && Number.isFinite(state.d2f(a))) {
    drawCurve(chartF.plot, parabolaAt(a), { xs, ys, className: 'tb-parab' });
  }

  chartF.gOver.selectAll('*').remove();
  marker(chartF, xs(a));
  if (Number.isFinite(state.f(a))) {
    chartF.gOver.append('circle').attr('class', 'll-point')
      .attr('cx', xs(a)).attr('cy', ys(state.f(a))).attr('r', 6);
  }
  dragTarget(chartF, xs);

  /* ---- what the tangent missed ---- */
  if (state.residual) drawResidual(dom);

  updateText();
  alignRangeToPlot(chartF, $('#x-slider'), $('#x-wrap'), THUMB_PX);
}

/**
 * f − (its own tangent), with ½f ″(a)(x − a)² laid over it.
 *
 * Its own y-scale, and that is the whole reason it works: near the point the
 * leftover is of order (x − a)², which is invisible at the scale of the graph
 * above. The note under the panel says so, because a reader who misses the
 * change of scale will think the bend is enormous.
 */
function drawResidual(dom) {
  const { a } = state;
  chartR = createChart('#chart-r', { height: 220, label: describeResidual() });
  const t1 = tangentAt(a);
  const resid = (x) => state.f(x) - t1(x);
  const model = (x) => 0.5 * state.d2f(a) * (x - a) ** 2;

  const yDom = autoYDomain(resid, dom[0], dom[1], { minSpan: 1e-6 });
  const { xs, ys } = makeScales(chartR, dom, yDom);
  drawAxes(chartR, { xs, ys, xLabel: 'x', yLabel: 'f − tangent' });
  drawCurve(chartR.plot, resid, { xs, ys, className: 'tb-resid' });
  if (Number.isFinite(state.d2f(a))) {
    drawCurve(chartR.plot, model, { xs, ys, className: 'tb-model' });
  }
  chartR.gOver.selectAll('*').remove();
  marker(chartR, xs(a));
  chartR.gOver.append('circle').attr('class', 'll-point')
    .attr('cx', xs(a)).attr('cy', ys(0)).attr('r', 5);
  dragTarget(chartR, xs);
}

function marker(chart, px) {
  chart.gOver.append('line').attr('class', 'tb-mark')
    .attr('x1', px).attr('x2', px)
    .attr('y1', chart.margin.top).attr('y2', chart.height - chart.margin.bottom);
}

function dragTarget(chart, xs) {
  const rect = chart.svg.append('rect')
    .attr('x', chart.margin.left).attr('y', chart.margin.top)
    .attr('width', chart.innerWidth).attr('height', chart.innerHeight)
    .attr('fill', 'transparent').style('cursor', 'ew-resize').style('touch-action', 'none');
  const move = (/** @type {PointerEvent} */ ev) => {
    const box = chart.svg.node().getBoundingClientRect();
    setA(xs.invert(((ev.clientX - box.left) / box.width) * chart.width));
  };
  rect.on('pointerdown', function (ev) {
    ev.preventDefault(); this.setPointerCapture(ev.pointerId); move(ev);
  });
  rect.on('pointermove', function (ev) {
    if (this.hasPointerCapture?.(ev.pointerId)) move(ev);
  });
}

/* ───────────────────────────────── words ───────────────────────────────── */

function updateText() {
  const { a } = state;
  const fa = state.f(a), d1 = state.df(a), d2 = state.d2f(a);
  $('#x-out').textContent = fmt(a, 2);
  $('#readout').innerHTML =
    `<span><b>x</b> ${fmt(a, 2)}</span>`
    + `<span><b>f(x)</b> ${fmt(fa, 3)}</span>`
    + `<span style="color:var(--tangent)"><b>tilt &nbsp;f ′</b> ${fmt(d1, 3)}</span>`
    + `<span style="color:var(--tangent-2)"><b>bend &nbsp;f ″</b> ${fmt(d2, 3)}</span>`;

  if (!Number.isFinite(d2)) {
    $('#story').innerHTML = `At <i>x</i> = ${fmt(a, 2)} there is no second derivative, `
      + `so there is no best parabola here.`;
    $('#formula').innerHTML = '';
    return;
  }
  const up = d2 > 0.005, down = d2 < -0.005;
  $('#story').innerHTML =
    `At <i>x</i> = ${fmt(a, 2)} the curve is tilted by <b>${fmt(d1, 3)}</b>, and it bends `
    + (up ? `<b>upward</b> — so just here the graph lies <b>above</b> its tangent line on both sides.`
      : down ? `<b>downward</b> — so just here the graph lies <b>below</b> its tangent line on both sides.`
        : `<b>hardly at all</b> — the tangent line and the curve part company only very slowly, `
          + `and the parabola is nearly straight.`);
  $('#formula').innerHTML = `Near this point, `
    + tex(`f(x) \\approx ${fmt(fa, 3)} ${d1 < 0 ? '-' : '+'} ${fmt(Math.abs(d1), 3)}(x - ${fmt(a, 2)})`
      + ` ${d2 < 0 ? '-' : '+'} ${fmt(Math.abs(d2 / 2), 3)}(x - ${fmt(a, 2)})^2`)
    + ` — and that last coefficient is ${tex('\\tfrac{1}{2}f\'\'(a)')}.`;
}

const describeTop = () =>
  `The graph of f with its tangent line${state.parabola ? ' and the best parabola' : ''} at x = ${fmt(state.a, 2)}.`;
const describeResidual = () =>
  'The curve with its tangent subtracted away, leaving only the bending.';

/* ──────────────────────────────── driving ──────────────────────────────── */

function setA(v) {
  state.a = Math.min(state.xMax, Math.max(state.xMin, v));
  $('#x-slider').value = String(state.a);
  render();
}

function setWindow(spec) {
  const [lo, hi] = String(spec).split(',').map(Number);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return;
  state.xMin = lo; state.xMax = hi;
  const s = $('#x-slider');
  s.min = String(lo); s.max = String(hi);
  state.a = Math.min(hi, Math.max(lo, state.a));
  s.value = String(state.a);
}

function adopt(node, src) {
  state.node = node;
  const d1 = derivative(node);
  state.f = compile(node);
  state.df = compile(d1);
  state.d2f = compile(derivative(d1));
  updateUrl({ f: src });
  render();
}

/* ────────────────────────────────── boot ───────────────────────────────── */

initPage({
  onReady() {
    initShare({ mark: MARK });
    const q = getParams().raw;
    if (q.get('f')) $('#fn-input').value = q.get('f');
    if (q.get('window')) { $('#window-select').value = q.get('window'); setWindow(q.get('window')); }
    // `q.has` first: Number(null) is 0 and Number.isFinite(0) is true, so an
    // absent ?a= would silently move the point to the origin.
    if (q.has('a') && Number.isFinite(Number(q.get('a')))) state.a = Number(q.get('a'));
    $('#x-slider').value = String(state.a);

    setTex($('#help-tex1'),
      "f(x) \\approx f(a) + f'(a)(x-a) + \\tfrac{1}{2}f''(a)(x-a)^2", { display: true });
    setTex($('#help-tex2'), '\\tfrac{1}{2}f\'\'(a)');
    setTex($('#help-tex3'),
      "f(x) - \\big[f(a) + f'(a)(x-a)\\big] \\approx \\tfrac{1}{2}f''(a)(x-a)^2", { display: true });
    setTex($('#note-tex'), "f(x) - \\big[f(a) + f'(a)(x-a)\\big]");

    const field = initExpressionInput({
      input: $('#fn-input'), error: $('#fn-error'), preview: $('#fn-preview'),
      palette: $('#fn-palette'), parse: tryParse, format: toLatex,
      onChange: adopt,
    });
    for (const b of document.querySelectorAll('.preset')) {
      b.addEventListener('click', () => field.set(b.dataset.f));
    }

    $('#x-slider').addEventListener('input', e => setA(Number(e.target.value)));
    $('#window-select').addEventListener('change', e => { setWindow(e.target.value); render(); });

    $('#parab-btn').addEventListener('click', () => {
      state.parabola = !state.parabola;
      $('#parab-btn').textContent = state.parabola ? 'Hide the parabola' : 'Show the parabola';
      $('#parab-btn').setAttribute('aria-pressed', String(state.parabola));
      $('#key-parab').hidden = !state.parabola;
      render();
    });
    $('#resid-btn').addEventListener('click', () => {
      state.residual = !state.residual;
      $('#resid-wrap').hidden = !state.residual;
      $('#resid-note').hidden = !state.residual;
      $('#resid-btn').textContent = state.residual ? "Hide what's left over" : "Show what's left over";
      $('#resid-btn').setAttribute('aria-pressed', String(state.residual));
      if (!state.residual && chartR) { chartR.plot.selectAll('*').remove(); chartR.gOver.selectAll('*').remove(); }
      render();
      announce(state.residual
        ? 'Showing the curve with its tangent subtracted away. Mind the vertical scale.'
        : 'Leftover panel hidden.');
    });
    if (q.get('residual') === 'true') $('#resid-btn').click();
    if (q.get('parabola') === 'false') $('#parab-btn').click();

    applyControls(q.get('controls'), q.get('hide'));
    onBreakpointChange(() => render());
    onLayoutChange(() => render());
  },
});

