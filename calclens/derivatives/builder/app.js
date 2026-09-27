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
 * The secant is OFF by default. Secant-to-tangent is a different question with
 * two tools of its own — `derivatives/secant/` for the picture and
 * `limits/difference-quotient/` for the algebra — and here it competed for the
 * same crimson line through the same point as the tangent. This tool asks one
 * thing: how a slope on the upper graph becomes a height on the lower one.
 * `?secant=true` brings it back for anyone who wants both at once.
 *
 * When shown, the secant slider carries the definition. At h = 1 the dashed secant is
 * visibly not the tangent and the difference quotient is visibly not f′(x);
 * dragging h to 0 collapses both gaps at once.
 *
 * Slopes are taken symbolically (expr.derivative), not by finite differences,
 * so |x| at 0 reports a genuine break rather than a plausible-looking 0.
 */

import { createChart, makeScales, drawAxes, onBreakpointChange } from 'kit/chart.js';
import { drawCurve, autoYDomain } from 'kit/curve.js';
import { initPage, announce, prefersReducedMotion } from 'kit/page.js';
import { getParams, updateUrl } from 'kit/url.js';
import { tex, setTex, renderMathLabels } from 'kit/tex.js';
import { initExpressionInput } from 'kit/input.js';
import { fmt } from 'kit/format.js';
import { initShare } from 'kit/share.js';
import { initReveal, revealHidden } from 'kit/reveal.js';
import { MARK } from '../../js/mark.js';

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
  secant: false,
  unitRun: false,
  /** @type {Map<number, number>} slope traced at each grid position */
  trace: new Map(),
};

let chartF = createChart('#chart-f', { height: 290, label: 'Graph of f with a tangent line at the moving point' });
let chartD = createChart('#chart-d', { height: 290, label: 'Slopes traced so far, forming the graph of f prime' });

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
  const h = state.secant ? state.h : 0;
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
    if (state.secant && h > 1e-9 && Number.isFinite(fxh)) {
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
    if (state.unitRun && Number.isFinite(slope)) {
      unitRunTriangle(chartF, xs, ys, x, fx, slope, yDom);
    }
    if (Number.isFinite(slope)) valueLabel(chartF, xs(x), ys(fx), slopeLabel(slope), { slope });
  }
  markerLine(chartF, xs(x));
  addDragTarget(chartF, xs, xs(x));

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
  // The line is drawn whether or not a slope exists there. It is the link
  // between the two graphs, and |x| at 0 — where there IS no slope — is exactly
  // the case worth being able to line up.
  markerLine(chartD, scalesD.xs(x));
  if (Number.isFinite(slope)) {
    // The height, drawn as a measured segment from the axis up to the point, in
    // the TANGENT's colour. That is the identification the pair of graphs is
    // for: this length down here is that line's steepness up there. Crimson now
    // means "the slope at the current x" in both plots — the tangent embodies
    // it above, this segment measures it below — while orange stays with f′ as
    // a function, the traced dots and the revealed curve.
    const px = scalesD.xs(x);
    chartD.gOver.append('line').attr('class', 'bd-height')
      .attr('x1', px).attr('x2', px)
      .attr('y1', scalesD.ys(0)).attr('y2', scalesD.ys(slope));
    chartD.gOver.append('circle').attr('class', 'll-point')
      .attr('cx', px).attr('cy', scalesD.ys(slope)).attr('r', 6);
    // Beside the segment, level with its middle, so the number reads as the
    // length of that segment rather than as a note about the dot.
    valueLabel(chartD, px, (scalesD.ys(0) + scalesD.ys(slope)) / 2,
      slopeLabel(slope), { dy: 0, middle: true });
  }
  addDragTarget(chartD, scalesD.xs, scalesD.xs(x));

  updateText(x, fx, slope, secantSlope);
}

/**
 * The same number, in the same words and the same colour, on both plots.
 *
 * This is the whole point of the pair: the STEEPNESS of f at x and the HEIGHT
 * of f′ at x are one quantity. Saying it in the prose underneath is weaker than
 * writing it twice in the picture, once on each graph, identically.
 *
 * Colour is never the only cue — the text is the same string in both places —
 * but the colour is f′'s, deliberately, including on the upper plot. An orange
 * number beside a crimson tangent says *this slope is an f′ value*, which is
 * the sentence the tool exists to make.
 */
function valueLabel(chart, px, py, text, opts = {}) {
  const { slope, dy = -12, middle = false } = opts;
  // Sit on the side the tangent is NOT using: a rising tangent occupies up-and-
  // right of the point, so the label goes up-and-left, and vice versa. Falls
  // back to whichever side has room near a frame edge.
  const roomRight = chart.width - chart.margin.right - px > 96;
  const roomLeft = px - chart.margin.left > 96;
  let right = slope === undefined ? roomRight : slope < 0;
  if (right && !roomRight) right = false;
  if (!right && !roomLeft) right = true;
  const t = chart.gOver.append('text').attr('class', 'bd-value')
    .attr('x', right ? px + 9 : px - 9).attr('y', py + dy)
    .attr('text-anchor', right ? 'start' : 'end')
    .text(text);
  if (middle) t.attr('dominant-baseline', 'middle');
}

/**
 * The rise over a run of exactly 1, so the rise IS the slope.
 *
 * Off by default. It only works when the rise fits the window: with x³ − 3x on
 * [−3, 3] the slope reaches 24 against a y-range of about ±20, so the triangle
 * would leave the frame. It is drawn when it fits and omitted when it does not,
 * rather than drawn clipped and lying about its height.
 */
function unitRunTriangle(chart, xs, ys, x, fx, slope, yDom) {
  const x1 = x + 1;
  const top = fx + slope;
  if (x1 > xs.domain()[1] || top > yDom[1] || top < yDom[0]) return false;
  const g = chart.gOver.append('g').attr('class', 'bd-unit');
  g.append('path')
    .attr('d', `M${xs(x)},${ys(fx)} L${xs(x1)},${ys(fx)} L${xs(x1)},${ys(top)}`)
    .attr('fill', 'none');
  g.append('text').attr('class', 'bd-unit-label')
    .attr('x', (xs(x) + xs(x1)) / 2).attr('y', ys(fx) + 14).attr('text-anchor', 'middle')
    .text('run 1');
  g.append('text').attr('class', 'bd-unit-label')
    .attr('x', xs(x1) + 6).attr('y', (ys(fx) + ys(top)) / 2)
    .attr('dominant-baseline', 'middle')
    .text(`rise ${fmt(slope, 2)}`);
  return true;
}

/**
 * The dashed line at the current x, drawn identically on both plots.
 *
 * It is what makes the pair readable as one picture: the height of f above the
 * line and the height of f′ below it are the same x. The two charts are built
 * with the same fixed margins and the same x domain, so a given x lands on the
 * same pixel column in both — without that the line would be a lie.
 */
function markerLine(chart, px) {
  chart.gOver.append('line').attr('class', 'll-marker-line')
    .attr('x1', px).attr('x2', px)
    .attr('y1', chart.margin.top).attr('y2', chart.height - chart.margin.bottom);
  // A grip at the top, so the line reads as something you can take hold of.
  // Decorative only — the drag surface above it does the hit-testing.
  chart.gOver.append('rect').attr('class', 'll-marker-grip')
    .attr('x', px - 4).attr('y', chart.margin.top - 1)
    .attr('width', 8).attr('height', 12).attr('rx', 3)
    .attr('fill', '#fff').attr('stroke', '#444').attr('stroke-width', 1.2);
}

/** The one string that appears on both graphs. */
const slopeLabel = (/** @type {number} */ slope) => `f \u2032 = ${fmt(slope, 2)}`;

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

/** How close a press has to be to the line to GRAB it rather than jump. */
const GRAB_PX = 10;
const GRAB_TOUCH_PX = 22;

/**
 * The drag surface over a plot.
 *
 * **Built once and kept.** It used to be removed and re-appended on every
 * render, which broke dragging completely: `setX` renders, the render deleted
 * the very element holding the pointer capture, and every subsequent
 * `pointermove` failed its `hasPointerCapture` guard. Exactly one move ever
 * landed — the one inside `pointerdown` — so the line appeared to teleport to
 * each click and then refuse to follow the mouse. Only the scales and the
 * line's position change per render, so those ride on the node.
 *
 * Pressing ON the line **grabs** it, keeping its offset from the cursor so it
 * does not jump out from under the pointer. Pressing away from the line still
 * jumps there, which is the quickest way across a wide graph.
 */
function addDragTarget(chart, xs, px) {
  let rect = chart.svg.select('rect.ll-drag');
  const fresh = rect.empty();
  if (fresh) rect = chart.svg.append('rect').attr('class', 'll-drag');

  rect
    .attr('x', chart.margin.left).attr('y', chart.margin.top)
    .attr('width', chart.innerWidth).attr('height', chart.innerHeight)
    .attr('fill', 'transparent').style('touch-action', 'none');

  const node = rect.node();
  node.__xs = xs;          // the current scale
  node.__px = px;          // where the line is, in pixels
  if (!fresh) return;      // handlers are already bound, and close over `chart`

  const pointerX = (/** @type {PointerEvent} */ ev) => {
    const box = chart.svg.node().getBoundingClientRect();
    return ((ev.clientX - box.left) / box.width) * chart.width;
  };
  const tolerance = (/** @type {PointerEvent} */ ev) =>
    (ev.pointerType === 'touch' ? GRAB_TOUCH_PX : GRAB_PX);

  rect.on('pointerdown', function (ev) {
    ev.preventDefault();
    stopSweep();
    this.setPointerCapture(ev.pointerId);
    const p = pointerX(ev);
    this.__grab = Math.abs(p - this.__px) <= tolerance(ev) ? this.__px - p : 0;
    this.style.cursor = 'grabbing';
    setX(this.__xs.invert(p + this.__grab));
  });

  rect.on('pointermove', function (ev) {
    if (this.hasPointerCapture?.(ev.pointerId)) {
      setX(this.__xs.invert(pointerX(ev) + (this.__grab || 0)));
      return;
    }
    // Not dragging: say whether a press here would grab the line or jump.
    this.style.cursor = Math.abs(pointerX(ev) - this.__px) <= GRAB_PX ? 'grab' : 'ew-resize';
  });

  const release = function (/** @type {PointerEvent} */ ev) {
    this.__grab = 0;
    this.style.cursor = 'grab';
    this.releasePointerCapture?.(ev.pointerId);
  };
  rect.on('pointerup', release);
  rect.on('pointercancel', release);
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
    <span><b>f(x)</b> ${fmt(fx, 3)}</span>`
    + (state.secant ? `<span><b>secant slope</b> ${fmt(secantSlope, 3)}</span>` : '')
    + `<span><b>f ′(x)</b> ${fmt(slope, 3)}</span>`;

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
      + (!state.secant ? ''
        : state.h > 1e-9
          ? `The secant across a gap of <i>h</i> = ${fmt(state.h, 2)} gives `
            + `<b>${fmt(secantSlope, 3)}</b> — off by ${fmt(gap, 3)}. `
            + `Shrink <i>h</i> and that error shrinks with it.`
          : `With <i>h</i> = 0 the secant <em>is</em> the tangent: the difference `
            + `quotient has reached its limit.`);
  }

  // The formula is part of the payoff: printing it while the curve is hidden
  // gives the answer away in words instead of in ink.
  $('#symbolic').innerHTML = (state.reveal && state.dNode)
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
    initShare({ mark: MARK });
    const q = getParams().raw;
    const params = getParams();
    if (params.f) $('#fn-input').value = params.f;

    // Settled before anything renders: the first frame has to know whether the
    // secant exists. `?h=` implies it, so an older link that set a gap still
    // shows one.
    // `?h=` implies the secant, so an older link that set a gap still shows one.
    state.secant = q.get('secant') === 'true' || q.has('h');
    state.unitRun = q.get('unitrun') === 'true';
    if (q.has('h')) {
      const hv = Number(q.get('h'));
      if (Number.isFinite(hv)) { state.h = hv; $('#h-slider').value = String(hv); $('#h-out').textContent = fmt(hv, 2); }
    }
    for (const el of document.querySelectorAll('[data-secant]')) {
      /** @type {HTMLElement} */ (el).hidden = !state.secant;
    }


    setTex($('#help-tex1'), '(x,\\,f(x))\\ \\text{and}\\ (x+h,\\,f(x+h))');
    setTex($('#help-tex2'), '\\frac{f(x+h)-f(x)}{h}');
    setTex($('#help-tex3'), "f\\,' = m");


    // Preset labels are typeset from the very expression they insert, so the
    // notation can never disagree with the maths — a literal "√x" in HTML shows
    // a radical that does not extend over its argument.
    renderMathLabels(src => { const r = tryParse(src); return r.node ? toLatex(r.node) : null; });

    // A chart's geometry is frozen at build time, so rotating a phone (or
    // flipping Chrome's device toolbar) would otherwise leave a desktop viewBox
    // squeezed into a phone-sized box with six-pixel labels.
    onBreakpointChange(() => { chartF = createChart('#chart-f', { height: 290, label: 'Graph of f' });
      chartD = createChart('#chart-d', { height: 290, label: 'Slopes traced so far' }); render(); });
    setWindow($('#window-select').value);

    initExpressionInput({
      input: $('#fn-input'),
      error: $('#fn-error'),
      parse: tryParse,
      preview: $('#fn-preview'),
      format: toLatex,
      palette: $('#fn-palette'),
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
    initReveal({
      mount: $('#reveal-slot'),
      label: "the true f ′",
      hidden: revealHidden(q, false),
      prompt: 'Sketch what you think f ′ looks like first',
      onChange(shown) { state.reveal = shown; render(); },
    });
    $('#play-btn').addEventListener('click', () => (sweepHandle === null ? startSweep() : stopSweep()));

    document.addEventListener('keydown', e => {
      const t = /** @type {HTMLElement} */ (e.target);
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      if (e.key === ' ') { e.preventDefault(); sweepHandle === null ? startSweep() : stopSweep(); }
    });
  },
});
