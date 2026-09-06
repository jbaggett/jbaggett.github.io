/**
 * Accumulation function — A(x) = ∫ₐˣ f(t) dt, built while the student watches.
 *
 * The whole point is the LINK between the two graphs, so everything on screen
 * exists to make one pairing unmissable: the *height* of f at x is the *slope*
 * of A at x. Both are drawn, both are labelled with their number, and the two
 * numbers are placed side by side in the readout. FTC Part 1 stops being a
 * formula to memorise and becomes something already seen.
 *
 * A is computed numerically (marching Simpson), never from the symbolic
 * antiderivative — so e^(−x²) works exactly as well as x². The symbolic
 * antiderivative, when one exists, is shown underneath as a *second* account of
 * the same curve, not as the source of it.
 */

import { select } from 'd3-selection';
import { area as d3area } from 'd3-shape';
import { createChart, makeScales, drawAxes } from 'kit/chart.js';
import { drawCurve, autoYDomain, linePath } from 'kit/curve.js';
import { initPage, announce, prefersReducedMotion } from 'kit/page.js';
import { getParams, updateUrl } from 'kit/url.js';
import { tex, setTex } from 'kit/tex.js';
import { initExpressionInput } from 'kit/input.js';
import { fmt } from 'kit/format.js';
import { tryParse, compile, antiderivative, toLatex, evaluate } from '../../js/expr.js';
import { accumulationCurve, simpson } from '../../js/numeric.js';

const $ = (/** @type {string} */ sel) => /** @type {any} */ (document.querySelector(sel));

const state = {
  node: null,
  /** @type {(x:number)=>number} */ f: () => NaN,
  src: '2x - 2',
  a: 0,
  x: 0,
  xMin: -4,
  xMax: 4,
  slopeLink: true,
  /** @type {{x:number,y:number}[]} */ accum: [],
};

const chartF = createChart('#chart-f', { height: 300, label: 'Graph of f with the area from a to x shaded' });
const chartA = createChart('#chart-a', { height: 300, label: 'Graph of the accumulation function A' });

// Hatching for negative contributions: signed area must not be carried by
// colour alone (accessibility checklist), and a hatch also reads as "this is
// being taken away" in a way a second flat colour does not.
chartF.svg.select('defs').append('pattern')
  .attr('id', 'neg-hatch').attr('patternUnits', 'userSpaceOnUse')
  .attr('width', 7).attr('height', 7)
  .attr('patternTransform', 'rotate(45)')
  .append('line')
  .attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 7)
  .attr('stroke', '#C05E10').attr('stroke-width', 2.4).attr('opacity', 0.55);

/* ───────────────────────────── signed area ─────────────────────────────── */

/**
 * Split the region between the curve and the axis into runs of constant sign,
 * so each run can be filled as "counts positive" or "counts negative".
 *
 * The sign that matters is the sign of the CONTRIBUTION, not of f: sweeping
 * leftwards from a (x < a) flips it. Students who have only ever integrated
 * left-to-right find that genuinely surprising, which is the point.
 *
 * @param {(x:number)=>number} f @param {number} a @param {number} x
 * @returns {{points:{x:number,y:number}[], positive:boolean}[]}
 */
function signedRegions(f, a, x) {
  const lo = Math.min(a, x), hi = Math.max(a, x);
  if (hi - lo < 1e-9) return [];
  const backwards = x < a;
  const steps = 320;
  const dx = (hi - lo) / steps;
  /** @type {{points:{x:number,y:number}[], positive:boolean}[]} */
  const runs = [];
  let current = null;

  for (let i = 0; i <= steps; i++) {
    const xi = lo + i * dx;
    const yi = f(xi);
    if (!Number.isFinite(yi)) { current = null; continue; }
    const positive = (yi >= 0) !== backwards;
    if (!current || current.positive !== positive) {
      // Interpolate the crossing so the two fills meet exactly on the axis.
      if (current && current.points.length) {
        const prev = current.points[current.points.length - 1];
        const t = prev.y / (prev.y - yi);
        const xc = prev.x + t * (xi - prev.x);
        if (Number.isFinite(xc)) current.points.push({ x: xc, y: 0 });
        runs.push(current);
        current = { points: [{ x: xc, y: 0 }], positive };
      } else {
        current = { points: [], positive };
      }
    }
    current.points.push({ x: xi, y: yi });
  }
  if (current && current.points.length > 1) runs.push(current);
  return runs.filter(r => r.points.length > 1);
}

/* ─────────────────────────────── rendering ─────────────────────────────── */

function render() {
  const { f, a, xMin, xMax } = state;
  const x = clampX(state.x);

  /* ---- top chart: f, with the swept area ---- */
  const yDomF = autoYDomain(f, xMin, xMax, { minSpan: 2 });
  const { xs, ys } = makeScales(chartF, [xMin, xMax], yDomF);
  drawAxes(chartF, { xs, ys, xLabel: 't', yLabel: 'f(t)' });

  const areaGen = d3area().x(d => xs(d.x)).y0(ys(0)).y1(d => ys(d.y));
  const regions = signedRegions(f, a, x);
  const shapes = chartF.plot.selectAll('path.ll-region').data(regions);
  shapes.exit().remove();
  shapes.enter().append('path').attr('class', 'll-region')
    .merge(shapes)
    .attr('d', r => areaGen(r.points) || '')
    .attr('fill', r => (r.positive ? 'var(--area-pos)' : 'url(#neg-hatch)'))
    .attr('stroke', 'none');

  drawCurve(chartF.plot, f, { xs, ys });

  const fx = f(x);
  chartF.gOver.selectAll('*').remove();
  // The two limits, marked on the frame. Labels sit at the BOTTOM of the plot
  // area rather than the top, where they would collide with the y-axis label,
  // and merge into one when a and x coincide (which is the opening state).
  const labelY = chartF.height - chartF.margin.bottom - 5;
  const together = Math.abs(xs(a) - xs(x)) < 16;
  for (const [pos, label] of (together ? [[a, 'a = x']] : [[a, 'a'], [x, 'x']])) {
    chartF.gOver.append('line').attr('class', 'll-marker-line')
      .attr('x1', xs(pos)).attr('x2', xs(pos))
      .attr('y1', chartF.margin.top).attr('y2', chartF.height - chartF.margin.bottom);
    chartF.gOver.append('text')
      .attr('x', xs(pos)).attr('y', labelY)
      .attr('text-anchor', 'middle').attr('font-style', 'italic')
      .attr('font-size', 13).attr('fill', '#333')
      .attr('stroke', '#fff').attr('stroke-width', 3).attr('paint-order', 'stroke')
      .text(label);
  }
  if (Number.isFinite(fx) && state.slopeLink) {
    // The height of f at x — the quantity that reappears as a slope below.
    chartF.gOver.append('line').attr('class', 'll-tangent')
      .attr('x1', xs(x) - 26).attr('x2', xs(x) + 26)
      .attr('y1', ys(fx)).attr('y2', ys(fx));
    chartF.gOver.append('circle').attr('class', 'll-point')
      .attr('cx', xs(x)).attr('cy', ys(fx)).attr('r', 5);
    chartF.gOver.append('text')
      .attr('x', xs(x) + 32).attr('y', ys(fx) + 4)
      .attr('font-size', 12).attr('fill', 'var(--tangent)')
      .attr('stroke', '#fff').attr('stroke-width', 3).attr('paint-order', 'stroke')
      .text(`height ${fmt(fx, 2)}`);
  }
  addDragTarget(chartF, xs);

  /* ---- bottom chart: A ---- */
  state.accum = accumulationCurve(f, a, xMin, xMax, 400);
  const finite = state.accum.filter(p => Number.isFinite(p.y));
  const lo = Math.min(0, ...finite.map(p => p.y));
  const hi = Math.max(0, ...finite.map(p => p.y));
  const padA = Math.max(0.5, (hi - lo) * 0.15);
  const scalesA = makeScales(chartA, [xMin, xMax], [lo - padA, hi + padA]);
  drawAxes(chartA, { xs: scalesA.xs, ys: scalesA.ys, xLabel: 'x', yLabel: 'A(x)' });

  // Ghost of the whole curve, solid only over the part already swept — the
  // visual claim is "this much has been collected so far".
  const swept = finite.filter(p => (p.x >= Math.min(a, x) && p.x <= Math.max(a, x)));
  chartA.plot.selectAll('path').remove();
  chartA.plot.append('path').attr('class', 'll-curve-ghost')
    .attr('d', linePath(finite, scalesA.xs, scalesA.ys));
  if (swept.length > 1) {
    chartA.plot.append('path').attr('class', 'll-curve-acc')
      .attr('d', linePath(swept, scalesA.xs, scalesA.ys));
  }

  const Ax = accumAt(x);
  chartA.gOver.selectAll('*').remove();
  chartA.gOver.append('line').attr('class', 'll-marker-line')
    .attr('x1', scalesA.xs(a)).attr('x2', scalesA.xs(a))
    .attr('y1', chartA.margin.top).attr('y2', chartA.height - chartA.margin.bottom);
  if (Number.isFinite(Ax)) {
    if (state.slopeLink && Number.isFinite(fx)) {
      // A tangent whose slope IS f(x). Same number, different role.
      const dx = (xMax - xMin) * 0.13;
      chartA.gOver.append('line').attr('class', 'll-tangent')
        .attr('x1', scalesA.xs(x - dx)).attr('y1', scalesA.ys(Ax - fx * dx))
        .attr('x2', scalesA.xs(x + dx)).attr('y2', scalesA.ys(Ax + fx * dx));
      chartA.gOver.append('text')
        .attr('x', scalesA.xs(x) + 10).attr('y', scalesA.ys(Ax) - 12)
        .attr('font-size', 12).attr('fill', 'var(--tangent)')
        .attr('stroke', '#fff').attr('stroke-width', 3).attr('paint-order', 'stroke')
        .text(`slope ${fmt(fx, 2)}`);
    }
    chartA.gOver.append('circle').attr('class', 'll-point-acc')
      .attr('cx', scalesA.xs(x)).attr('cy', scalesA.ys(Ax)).attr('r', 6);
  }
  addDragTarget(chartA, scalesA.xs);

  updateText(x, fx, Ax);
}

/** A(x) read off the precomputed curve, refined by one exact Simpson step. */
function accumAt(/** @type {number} */ x) {
  const { accum } = state;
  if (!accum.length) return NaN;
  let best = accum[0];
  for (const p of accum) if (Math.abs(p.x - x) < Math.abs(best.x - x)) best = p;
  const tail = simpson(state.f, best.x, x, 4);
  return Number.isFinite(tail) ? best.y + tail : best.y;
}

/**
 * Dragging is the discoverable way to move x; the slider is the accessible one.
 * Both must exist — a drag with no keyboard alternative fails the checklist.
 */
function addDragTarget(chart, xs) {
  chart.svg.selectAll('rect.ll-drag').remove();
  const rect = chart.svg.append('rect').attr('class', 'll-drag')
    .attr('x', chart.margin.left).attr('y', chart.margin.top)
    .attr('width', chart.innerWidth).attr('height', chart.innerHeight)
    .attr('fill', 'transparent')
    .style('cursor', 'ew-resize')
    .style('touch-action', 'none');

  const move = (/** @type {PointerEvent} */ ev) => {
    const box = chart.svg.node().getBoundingClientRect();
    const px = ((ev.clientX - box.left) / box.width) * chart.width;
    setX(xs.invert(px), { fromDrag: true });
  };
  rect.on('pointerdown', function (ev) {
    ev.preventDefault();
    stopSweep();
    this.setPointerCapture(ev.pointerId);
    move(ev);
  });
  rect.on('pointermove', function (ev) {
    if (this.hasPointerCapture?.(ev.pointerId)) move(ev);
  });
}

const clampX = (/** @type {number} */ v) => Math.min(state.xMax, Math.max(state.xMin, v));

function setX(v, opts = {}) {
  state.x = clampX(v);
  $('#x-slider').value = String(state.x);
  $('#x-out').textContent = fmt(state.x, 2);
  render();
  if (!opts.quiet) {
    announce(`x is ${fmt(state.x, 2)}. Accumulated area ${fmt(accumAt(state.x), 2)}.`);
  }
}

/* ───────────────────────────── explanations ────────────────────────────── */

function updateText(x, fx, Ax) {
  $('#readout').innerHTML = `
    <span><b>x</b> ${fmt(x, 2)}</span>
    <span><b>f(x)</b> ${fmt(fx, 3)}</span>
    <span><b>A(x)</b> ${fmt(Ax, 3)}</span>
    <span><b>slope of A</b> ${fmt(fx, 3)}</span>`;

  const rising = fx > 0.005 ? 'rising' : fx < -0.005 ? 'falling' : 'flat — it has turned around';
  const sign = fx > 0.005 ? 'above' : fx < -0.005 ? 'below' : 'on';
  $('#ftc-line').innerHTML =
    `At <i>x</i> = ${fmt(x, 2)}, <i>f</i> is <b>${sign}</b> the axis with height `
    + `<b>${fmt(fx, 3)}</b>, and <i>A</i> is <b>${rising}</b> with exactly that slope. `
    + `That is ${tex("A'(x) = f(x)")}, the Fundamental Theorem of Calculus, Part 1.`;

  const F = state.node ? antiderivative(state.node) : null;
  if (F) {
    const Fa = evaluate(F, { x: state.a });
    const check = Number.isFinite(Fa)
      ? ` Evaluated: ${tex(`F(${fmt(x, 2)}) - F(${fmt(state.a, 2)}) = ${fmt(evaluate(F, { x }) - Fa, 3)}`)},`
        + ` matching the shaded area.`
      : '';
    $('#anti-line').innerHTML =
      `This <i>f</i> does have an antiderivative you can write down: `
      + `${tex(`F(x) = ${toLatex(F)} + C`)}. So ${tex('A(x) = F(x) - F(a)')}.${check}`;
  } else {
    $('#anti-line').innerHTML =
      `<b>No elementary antiderivative.</b> There is no formula in the usual `
      + `functions for ${tex('\\int f(x)\\,dx')} here — and yet <i>A</i> above is a `
      + `perfectly ordinary, smooth curve. The accumulation function exists `
      + `whether or not anybody can write it down; that is why the integral is `
      + `defined by area rather than by a formula.`;
  }
}

/* ─────────────────────────────── sweeping ──────────────────────────────── */

let sweepHandle = null;

function stopSweep() {
  if (sweepHandle === null) return;
  cancelAnimationFrame(sweepHandle);
  clearInterval(sweepHandle);
  sweepHandle = null;
  $('#play-btn').textContent = '▶ Sweep';
  $('#play-btn').setAttribute('aria-pressed', 'false');
}

function startSweep() {
  stopSweep();
  $('#play-btn').textContent = '❚❚ Stop';
  $('#play-btn').setAttribute('aria-pressed', 'true');
  state.x = state.xMin;

  if (prefersReducedMotion()) {
    // Minimised motion: ten discrete stops rather than a continuous slide.
    let i = 0;
    sweepHandle = setInterval(() => {
      i++;
      setX(state.xMin + ((state.xMax - state.xMin) * i) / 10, { quiet: true });
      if (i >= 10) stopSweep();
    }, 420);
    return;
  }
  const t0 = performance.now();
  const step = (/** @type {number} */ now) => {
    const t = Math.min(1, (now - t0) / 4000);
    setX(state.xMin + (state.xMax - state.xMin) * t, { quiet: true });
    if (t < 1) sweepHandle = requestAnimationFrame(step);
    else stopSweep();
  };
  sweepHandle = requestAnimationFrame(step);
}

/* ────────────────────────────────── boot ───────────────────────────────── */

function setWindow(/** @type {string} */ value) {
  const [lo, hi] = value.split(',').map(Number);
  state.xMin = lo; state.xMax = hi;
  const slider = $('#x-slider');
  slider.min = String(lo); slider.max = String(hi);
  state.x = clampX(state.x);
  slider.value = String(state.x);
}

initPage({
  onReady() {
    const params = getParams();
    if (params.f) $('#fn-input').value = params.f;
    if (params.a !== null) $('#a-input').value = String(params.a);

    setTex($('#lede-tex'), 'A(x) = \\int_a^x f(t)\\,dt');
    setTex($('#help-tex1'), 'A(x) = \\int_a^x f(t)\\,dt');

    setWindow($('#window-select').value);
    state.a = Number($('#a-input').value) || 0;
    // Arrive with area already on screen: a blank first frame (x = a, nothing
    // accumulated) is technically correct and pedagogically a dead start.
    state.x = params.b !== null ? params.b : state.a + 1.2;

    initExpressionInput({
      input: $('#fn-input'),
      error: $('#fn-error'),
      parse: tryParse,
      onChange(node, src) {
        state.node = node;
        state.f = compile(node);
        state.src = src;
        updateUrl({ f: src });
        render();
      },
    });

    document.querySelectorAll('.preset').forEach(b => b.addEventListener('click', () => {
      $('#fn-input').value = b.dataset.f;
      $('#fn-input').dispatchEvent(new Event('change'));
    }));

    $('#a-input').addEventListener('input', () => {
      state.a = Number($('#a-input').value) || 0;
      updateUrl({ a: state.a });
      render();
    });

    $('#window-select').addEventListener('change', e => {
      setWindow(e.target.value);
      render();
    });

    $('#x-slider').addEventListener('input', e => { stopSweep(); setX(Number(e.target.value)); });
    $('#reset-btn').addEventListener('click', () => { stopSweep(); setX(state.a); });
    $('#play-btn').addEventListener('click', () => (sweepHandle === null ? startSweep() : stopSweep()));

    document.addEventListener('keydown', e => {
      const t = /** @type {HTMLElement} */ (e.target);
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      if (e.key === ' ') { e.preventDefault(); sweepHandle === null ? startSweep() : stopSweep(); }
    });

    setX(state.x, { quiet: true });
  },
});
