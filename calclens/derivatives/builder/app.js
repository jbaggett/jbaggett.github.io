/**
 * Derivative Builder — f′ assembled one slope at a time.
 *
 * The misconception this targets is that f′ is a *different kind of thing* from
 * f. So the tool never shows f′ as a formula first: the student drags a point,
 * a slope is measured, and that slope is dropped onto the second axis as a
 * height. The derivative curve appears as the accumulated residue of that one
 * move, repeated. The symbolic f′ is revealed only on request, as confirmation
 * of something already drawn.
 *
 * The secant slider carries the definition. At h = 1 the dashed secant is
 * visibly not the tangent and the difference quotient is visibly not f′(x);
 * dragging h to 0 collapses both gaps at once.
 *
 * Slopes are taken symbolically (expr.derivative), not by finite differences,
 * so |x| at 0 reports a genuine break rather than a plausible-looking 0.
 */

import { createChart, makeScales, drawAxes } from 'kit/chart.js';
import { drawCurve, autoYDomain } from 'kit/curve.js';
import { initPage, announce, prefersReducedMotion } from 'kit/page.js';
import { getParams, updateUrl } from 'kit/url.js';
import { tex, setTex } from 'kit/tex.js';
import { initExpressionInput } from 'kit/input.js';
import { fmt } from 'kit/format.js';
import { tryParse, compile, derivative, toLatex } from '../../js/expr.js';

const $ = (/** @type {string} */ s) => /** @type {any} */ (document.querySelector(s));

/** Trace points are keyed to a grid so sweeping back and forth cannot pile up. */
const TRACE_STEP = 0.02;

const state = {
  node: null,
  dNode: null,
  /** @type {(x:number)=>number} */ f: () => NaN,
  /** @type {(x:number)=>number} */ df: () => NaN,
  x: -3,
  h: 1,
  xMin: -3,
  xMax: 3,
  reveal: false,
  /** @type {Map<number, number>} slope traced at each grid position */
  trace: new Map(),
};

const chartF = createChart('#chart-f', { height: 290, label: 'Graph of f with a tangent line at the moving point' });
const chartD = createChart('#chart-d', { height: 290, label: 'Slopes traced so far, forming the graph of f prime' });

function render() {
  const { f, df, xMin, xMax } = state;
  const x = clampX(state.x);
  const fx = f(x);
  const slope = df(x);

  /* ---- top: f, secant, tangent ---- */
  const yDom = autoYDomain(f, xMin, xMax, { minSpan: 2 });
  const { xs, ys } = makeScales(chartF, [xMin, xMax], yDom);
  drawAxes(chartF, { xs, ys, xLabel: 'x', yLabel: 'f(x)' });
  chartF.plot.selectAll('path.ll-secant, path.ll-tangent, line.ll-secant, line.ll-tangent').remove();
  drawCurve(chartF.plot, f, { xs, ys });

  chartF.gOver.selectAll('*').remove();
  const h = state.h;
  const fxh = f(x + h);
  const secantSlope = h > 1e-9 ? (fxh - fx) / h : slope;

  if (Number.isFinite(fx)) {
    // Tangent first, so the secant draws on top of it and the gap is visible.
    if (Number.isFinite(slope)) {
      const half = (xMax - xMin) * 0.22;
      chartF.gOver.append('line').attr('class', 'll-tangent')
        .attr('x1', xs(x - half)).attr('y1', ys(fx - slope * half))
        .attr('x2', xs(x + half)).attr('y2', ys(fx + slope * half));
    }
    if (h > 1e-9 && Number.isFinite(fxh)) {
      chartF.gOver.append('line').attr('class', 'll-secant')
        .attr('x1', xs(x)).attr('y1', ys(fx))
        .attr('x2', xs(x + h)).attr('y2', ys(fxh));
      chartF.gOver.append('circle').attr('class', 'll-point')
        .attr('cx', xs(x + h)).attr('cy', ys(fxh)).attr('r', 4).attr('opacity', 0.55);
      // The rise-over-run triangle: the difference quotient, drawn.
      chartF.gOver.append('path')
        .attr('d', `M${xs(x)},${ys(fx)} L${xs(x + h)},${ys(fx)} L${xs(x + h)},${ys(fxh)}`)
        .attr('fill', 'none').attr('stroke', 'var(--tangent)')
        .attr('stroke-width', 1).attr('stroke-dasharray', '2 2').attr('opacity', 0.7);
    }
    chartF.gOver.append('circle').attr('class', 'll-point')
      .attr('cx', xs(x)).attr('cy', ys(fx)).attr('r', 6);
  }
  addDragTarget(chartF, xs);

  /* ---- bottom: the traced slopes ---- */
  const dDom = traceDomain();
  const scalesD = makeScales(chartD, [xMin, xMax], dDom);
  drawAxes(chartD, { xs: scalesD.xs, ys: scalesD.ys, xLabel: 'x', yLabel: "f '(x)" });

  chartD.plot.selectAll('path.ll-curve-df').remove();
  if (state.reveal) drawCurve(chartD.plot, df, { xs: scalesD.xs, ys: scalesD.ys, className: 'll-curve-df' });

  const dots = [...state.trace.entries()].map(([k, v]) => ({ x: k * TRACE_STEP, y: v }));
  const sel = chartD.plot.selectAll('circle.ll-trace').data(dots, d => d.x);
  sel.exit().remove();
  sel.enter().append('circle').attr('class', 'll-trace')
    .attr('r', 2.6).attr('fill', 'var(--curve-df)')
    .merge(sel)
    .attr('cx', d => scalesD.xs(d.x))
    .attr('cy', d => scalesD.ys(d.y));

  chartD.gOver.selectAll('*').remove();
  if (Number.isFinite(slope)) {
    chartD.gOver.append('line').attr('class', 'll-marker-line')
      .attr('x1', scalesD.xs(x)).attr('x2', scalesD.xs(x))
      .attr('y1', chartD.margin.top).attr('y2', chartD.height - chartD.margin.bottom);
    chartD.gOver.append('circle').attr('class', 'll-point')
      .attr('cx', scalesD.xs(x)).attr('cy', scalesD.ys(slope)).attr('r', 6);
  }
  addDragTarget(chartD, scalesD.xs);

  updateText(x, fx, slope, secantSlope);
}

/** Keep the f′ axis steady while tracing, so dots do not jump as the range grows. */
function traceDomain() {
  const vals = [...state.trace.values()].filter(Number.isFinite);
  const probe = [];
  for (let i = 0; i <= 60; i++) {
    const v = state.df(state.xMin + ((state.xMax - state.xMin) * i) / 60);
    if (Number.isFinite(v)) probe.push(v);
  }
  const all = (state.reveal || vals.length === 0) ? probe.concat(vals) : vals.concat(probe);
  if (!all.length) return [-5, 5];
  all.sort((a, b) => a - b);
  const q = (/** @type {number} */ p) => all[Math.min(all.length - 1, Math.floor(p * (all.length - 1)))];
  let lo = Math.min(0, q(0.03)), hi = Math.max(0, q(0.97));
  if (hi - lo < 2) { const m = (hi + lo) / 2; lo = m - 1; hi = m + 1; }
  const pad = (hi - lo) * 0.15;
  return [lo - pad, hi + pad];
}

function addDragTarget(chart, xs) {
  chart.svg.selectAll('rect.ll-drag').remove();
  const rect = chart.svg.append('rect').attr('class', 'll-drag')
    .attr('x', chart.margin.left).attr('y', chart.margin.top)
    .attr('width', chart.innerWidth).attr('height', chart.innerHeight)
    .attr('fill', 'transparent').style('cursor', 'ew-resize').style('touch-action', 'none');
  const move = (/** @type {PointerEvent} */ ev) => {
    const box = chart.svg.node().getBoundingClientRect();
    setX(xs.invert(((ev.clientX - box.left) / box.width) * chart.width));
  };
  rect.on('pointerdown', function (ev) {
    ev.preventDefault(); stopSweep(); this.setPointerCapture(ev.pointerId); move(ev);
  });
  rect.on('pointermove', function (ev) {
    if (this.hasPointerCapture?.(ev.pointerId)) move(ev);
  });
}

const clampX = (/** @type {number} */ v) => Math.min(state.xMax, Math.max(state.xMin, v));

function setX(v, opts = {}) {
  state.x = clampX(v);
  const slope = state.df(state.x);
  // A non-finite slope leaves a genuine hole in the trace — |x| at 0 must not
  // quietly acquire a tangent it does not have.
  if (Number.isFinite(slope)) state.trace.set(Math.round(state.x / TRACE_STEP), slope);
  $('#x-slider').value = String(state.x);
  $('#x-out').textContent = fmt(state.x, 2);
  render();
  if (!opts.quiet) {
    announce(Number.isFinite(slope)
      ? `x is ${fmt(state.x, 2)}, slope ${fmt(slope, 2)}.`
      : `x is ${fmt(state.x, 2)}. No tangent line exists here.`);
  }
}

function updateText(x, fx, slope, secantSlope) {
  $('#readout').innerHTML = `
    <span><b>x</b> ${fmt(x, 2)}</span>
    <span><b>f(x)</b> ${fmt(fx, 3)}</span>
    <span><b>secant slope</b> ${fmt(secantSlope, 3)}</span>
    <span><b>f ′(x)</b> ${fmt(slope, 3)}</span>`;

  const gap = Math.abs(secantSlope - slope);
  const direction = slope > 0.005 ? 'rising' : slope < -0.005 ? 'falling' : 'level';
  const where = slope > 0.005 ? 'above' : slope < -0.005 ? 'below' : 'on';

  if (!Number.isFinite(slope)) {
    $('#story').innerHTML = `At <i>x</i> = ${fmt(x, 2)} there is <b>no single tangent line</b>, `
      + `so <i>f</i>′ is undefined here and the trace leaves a gap. `
      + `A function can be perfectly continuous and still fail to be differentiable.`;
  } else {
    $('#story').innerHTML =
      `At <i>x</i> = ${fmt(x, 2)}, <i>f</i> is <b>${direction}</b> with slope `
      + `<b>${fmt(slope, 3)}</b>, so the dot lands <b>${where}</b> the axis on the `
      + `lower graph. `
      + (state.h > 1e-9
        ? `The secant across a gap of <i>h</i> = ${fmt(state.h, 2)} gives `
          + `<b>${fmt(secantSlope, 3)}</b> — off by ${fmt(gap, 3)}. `
          + `Shrink <i>h</i> and that error shrinks with it.`
        : `With <i>h</i> = 0 the secant <em>is</em> the tangent: the difference `
          + `quotient has reached its limit.`);
  }

  $('#symbolic').innerHTML = state.dNode
    ? `Worked out symbolically: ${tex(`\\frac{d}{dx}\\left[${toLatex(state.node)}\\right] = ${toLatex(state.dNode)}`)}`
      + ` — tick <b>Reveal the true f ′</b> to lay that curve over your dots.`
    : '';
}

/* ─────────────────────────────── sweeping ──────────────────────────────── */

let sweepHandle = null;

function stopSweep() {
  if (sweepHandle === null) return;
  cancelAnimationFrame(sweepHandle);
  clearInterval(sweepHandle);
  sweepHandle = null;
  $('#play-btn').textContent = '▶ Sweep and trace';
  $('#play-btn').setAttribute('aria-pressed', 'false');
}

function startSweep() {
  stopSweep();
  $('#play-btn').textContent = '❚❚ Stop';
  $('#play-btn').setAttribute('aria-pressed', 'true');
  state.x = state.xMin;

  if (prefersReducedMotion()) {
    let i = 0;
    sweepHandle = setInterval(() => {
      i++;
      // Fill in the trace between stops so the dots are still continuous.
      const from = state.xMin + ((state.xMax - state.xMin) * (i - 1)) / 12;
      const to = state.xMin + ((state.xMax - state.xMin) * i) / 12;
      for (let t = from; t < to; t += TRACE_STEP) {
        const s = state.df(t);
        if (Number.isFinite(s)) state.trace.set(Math.round(t / TRACE_STEP), s);
      }
      setX(to, { quiet: true });
      if (i >= 12) stopSweep();
    }, 400);
    return;
  }
  const t0 = performance.now();
  const step = (/** @type {number} */ now) => {
    const t = Math.min(1, (now - t0) / 5000);
    setX(state.xMin + (state.xMax - state.xMin) * t, { quiet: true });
    if (t < 1) sweepHandle = requestAnimationFrame(step);
    else { stopSweep(); announce('Sweep complete. The traced dots now form the graph of f prime.', 100); }
  };
  sweepHandle = requestAnimationFrame(step);
}

/* ────────────────────────────────── boot ───────────────────────────────── */

function setWindow(/** @type {string} */ value) {
  const [lo, hi] = value.split(',').map(Number);
  state.xMin = lo; state.xMax = hi;
  const slider = $('#x-slider');
  slider.min = String(lo); slider.max = String(hi);
  state.trace.clear();
  state.x = clampX(state.x);
}

initPage({
  onReady() {
    const params = getParams();
    if (params.f) $('#fn-input').value = params.f;

    setTex($('#help-tex1'), '(x,\\,f(x))\\ \\text{and}\\ (x+h,\\,f(x+h))');
    setTex($('#help-tex2'), '\\frac{f(x+h)-f(x)}{h}');

    setWindow($('#window-select').value);

    initExpressionInput({
      input: $('#fn-input'),
      error: $('#fn-error'),
      parse: tryParse,
      onChange(node, src) {
        state.node = node;
        state.dNode = derivative(node);
        state.f = compile(node);
        state.df = compile(state.dNode);
        state.trace.clear();
        state.x = state.xMin;
        updateUrl({ f: src });
        setX(state.xMin, { quiet: true });
      },
    });

    document.querySelectorAll('.preset').forEach(b => b.addEventListener('click', () => {
      $('#fn-input').value = b.dataset.f;
      $('#fn-input').dispatchEvent(new Event('change'));
    }));

    $('#window-select').addEventListener('change', e => { setWindow(e.target.value); setX(state.xMin, { quiet: true }); });
    $('#x-slider').addEventListener('input', e => { stopSweep(); setX(Number(e.target.value)); });
    $('#h-slider').addEventListener('input', e => {
      state.h = Number(e.target.value);
      $('#h-out').textContent = fmt(state.h, 2);
      render();
    });
    $('#clear-btn').addEventListener('click', () => {
      state.trace.clear(); render();
      announce('Trace cleared.', 100);
    });
    $('#reveal').addEventListener('change', e => { state.reveal = e.target.checked; render(); });
    $('#play-btn').addEventListener('click', () => (sweepHandle === null ? startSweep() : stopSweep()));

    document.addEventListener('keydown', e => {
      const t = /** @type {HTMLElement} */ (e.target);
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      if (e.key === ' ') { e.preventDefault(); sweepHandle === null ? startSweep() : stopSweep(); }
    });
  },
});
