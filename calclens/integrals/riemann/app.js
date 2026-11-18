/**
 * Riemann Sums — with the product in the foreground.
 *
 * Sealey (2014) found that what breaks for students is not the summing and not
 * the limit: it is the PRODUCT f(x)·Δx — that one rectangle is a height times a
 * width and carries the units of the answer. Most applets animate the summing,
 * which is the part students already have.
 *
 * So this page is built around one rectangle at a time. You can step through
 * them, the chosen one is drawn apart from the rest, and the line under the
 * figure spells out its product with the numbers in. The total is shown, but it
 * is deliberately not the biggest thing on screen, and the EXACT area is
 * withheld until asked for — otherwise "make the rectangles thinner and watch
 * where the number is heading" is a question with the answer printed beside it.
 */

import { select } from 'd3-selection';
import { createChart, makeScales, drawAxes, onBreakpointChange } from 'kit/chart.js';
import { drawCurve, autoYDomain } from 'kit/curve.js';
import { initPage, applyControls, announce } from 'kit/page.js';
import { getParams, updateUrl } from 'kit/url.js';
import { tex, setTex } from 'kit/tex.js';
import { initExpressionInput, initSlider } from 'kit/input.js';
import { fmt } from 'kit/format.js';
import { initShare } from 'kit/share.js';
import { initReveal, revealHidden } from 'kit/reveal.js';
import { MARK } from '../../js/mark.js';

import { tryParse, compile, toLatex } from '../../js/expr.js';
import { riemann, adaptiveSimpson, RIEMANN_RULES } from '../../js/numeric.js';

const $ = (/** @type {string} */ s) => /** @type {any} */ (document.querySelector(s));

/**
 * A number with its trailing zeros taken off.
 *
 * `fmt` gives a fixed three places, which is right in the table — the decimal
 * points line up and the settling is a column you can read down. Everywhere
 * else it is noise: Δx = 0.500 and f(0.000) read as measurements, when they are
 * just a half and a nought.
 */
const tidy = (/** @type {number} */ x) =>
  (Number.isFinite(x) ? String(Number(x.toFixed(3))) : '—');

/** Lecture links: content only, never presentation. */
const PRESETS = {
  parabola: { f: '4 - x^2', a: '0', b: '2' },
  linear:   { f: '2x', a: '0', b: '3' },
  sine:     { f: 'sin(x)', a: '0', b: 'pi' },
  signed:   { f: 'x^3', a: '-1', b: '2' },
  nasty:    { f: 'exp(-x^2)', a: '0', b: '2' },
};

const state = {
  src: '4 - x^2',
  /** @type {any} */ node: null,
  /** @type {(x:number)=>number} */ f: () => NaN,
  a: 0,
  b: 2,
  n: 4,
  rule: /** @type {'left'|'right'|'midpoint'|'trapezoid'} */ ('left'),
  /** which rectangle is being read as a product; 0-based */
  sel: 0,
  exact: NaN,
  /** @type {{sum:number, pieces:any[]}} */ last: { sum: NaN, pieces: [] },
};

let chart = createChart('#chart', { height: 360, label: 'The curve with rectangles under it' });
let reveal = null;

// Hatching for rectangles below the axis. A negative contribution must not be
// carried by colour alone, and a hatch also reads as "this is being taken
// away" in a way a second flat colour does not.
chart.svg.select('defs').append('pattern')
  .attr('id', 'rs-neg').attr('patternUnits', 'userSpaceOnUse')
  .attr('width', 7).attr('height', 7).attr('patternTransform', 'rotate(45)')
  .append('line').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 7)
  .attr('stroke', '#C05E10').attr('stroke-width', 2.4).attr('opacity', 0.55);

/* ───────────────────────────── the figure ──────────────────────────────── */

/**
 * One piece as a path.
 *
 * A rectangle for left/right/midpoint; a real trapezoid for the trapezoid rule,
 * whose stored `height` is the average of the two ends. Drawing that average as
 * a rectangle would have the right area and the wrong picture, and the picture
 * is the whole reason the rule is called what it is.
 */
function shapeOf(/** @type {any} */ p, xs, ys, rule, f) {
  const x0 = xs(p.x0), x1 = xs(p.x1), y0 = ys(0);
  if (rule === 'trapezoid') {
    return `M${x0},${y0} L${x0},${ys(f(p.x0))} L${x1},${ys(f(p.x1))} L${x1},${y0} Z`;
  }
  const yh = ys(p.height);
  return `M${x0},${y0} L${x0},${yh} L${x1},${yh} L${x1},${y0} Z`;
}

function render() {
  const { f, a, b, n, rule } = state;
  if (!(b > a)) return;

  const r = riemann(f, a, b, n, rule);
  state.last = r;
  state.sel = Math.min(state.sel, n - 1);

  // The axis must show y = 0: a rectangle is measured from it, and a window
  // that floats above it would draw rectangles with no visible base.
  const auto = autoYDomain(f, a, b, { minSpan: 1 });
  const yDom = [Math.min(0, auto[0]), Math.max(0, auto[1])];
  const padX = (b - a) * 0.06;
  const { xs, ys } = makeScales(chart, [a - padX, b + padX], yDom);
  drawAxes(chart, { xs, ys, xLabel: 'x', yLabel: 'f(x)' });

  const bars = chart.plot.selectAll('path.rs-bar').data(r.pieces);
  bars.exit().remove();
  bars.enter().append('path')
    .on('click', (/** @type {any} */ _e, /** @type {any} */ d) => select_(r.pieces.indexOf(d)))
    .merge(bars)
    .attr('class', (d, i) => 'rs-bar'
      + (d.area < 0 ? ' rs-bar-neg' : '')
      + (i === state.sel ? ' rs-bar-sel' : ''))
    .attr('d', d => shapeOf(d, xs, ys, rule, f))
    .style('cursor', 'pointer');

  // The curve goes ON TOP of the rectangles, so where a top overshoots the
  // curve and where it falls short is visible without anything being added to
  // say so. That sliver IS the error.
  drawCurve(chart.plot, f, { xs, ys });

  chart.gOver.selectAll('*').remove();
  drawSamplePoints(r.pieces, xs, ys, rule, n);
  drawWidthRule(r.pieces, xs, ys, n);
  if (n <= 8) drawHeightLabels(r.pieces, xs, ys, rule);

  chart.svg.attr('aria-label',
    `${n} ${rule} rectangle${n === 1 ? '' : 's'} under f from ${tidy(a)} to ${tidy(b)}, `
    + `each ${tidy((b - a) / n)} wide. The estimate is ${fmt(r.sum)}.`);

  updateText();
}

/** The dot where each rectangle's height was read off the curve. */
function drawSamplePoints(pieces, xs, ys, rule, n) {
  if (rule === 'trapezoid' || n > 24) return;
  const g = chart.gOver.append('g');
  for (const p of pieces) {
    const y = p.height;
    if (!Number.isFinite(y)) continue;
    g.append('circle')
      .attr('class', 'rs-dot' + (y < 0 ? ' rs-dot-neg' : ''))
      .attr('cx', xs(p.sampleX)).attr('cy', ys(y)).attr('r', n > 12 ? 2.5 : 3.5);
  }
}

/**
 * Δx, measured across the rectangle being read: the width every one shares.
 *
 * Drawn INSIDE the plot, along the base of that rectangle. Below the axis it
 * landed on top of the tick labels and hid them, and there is no room under
 * them for both. At the base it is also where a width belongs — against the
 * thing it measures — and it follows the selection, so the product line and
 * the picture are always talking about the same strip.
 */
function drawWidthRule(pieces, xs, ys, n) {
  if (!pieces.length || n > 16) return;
  const p = pieces[Math.min(state.sel, pieces.length - 1)];
  const tall = Math.abs(ys(p.height) - ys(0));
  // No room to write against a short rectangle, and a label spilling out of
  // one reads as belonging to its neighbour.
  if (!Number.isFinite(tall) || tall < 34) return;
  const below = p.height < 0;
  const y = ys(0) + (below ? 18 : -10);
  const g = chart.gOver.append('g');
  g.append('line').attr('class', 'rs-width-rule')
    .attr('x1', xs(p.x0)).attr('x2', xs(p.x1)).attr('y1', y).attr('y2', y);
  for (const x of [p.x0, p.x1]) {
    g.append('line').attr('class', 'rs-width-rule')
      .attr('x1', xs(x)).attr('x2', xs(x)).attr('y1', y - 3).attr('y2', y + 3);
  }
  g.append('text').attr('class', 'rs-width-label')
    .attr('x', (xs(p.x0) + xs(p.x1)) / 2).attr('y', y + (below ? 13 : -5))
    .text(`Δx = ${tidy((state.b - state.a) / state.n)}`);
}

/** Each rectangle's height, while there is room to write them. */
function drawHeightLabels(pieces, xs, ys, rule) {
  if (rule === 'trapezoid') return;
  const g = chart.gOver.append('g');
  for (const p of pieces) {
    if (!Number.isFinite(p.height) || Math.abs(ys(p.height) - ys(0)) < 14) continue;
    g.append('text').attr('class', 'rs-hlabel')
      .attr('x', (xs(p.x0) + xs(p.x1)) / 2)
      .attr('y', ys(p.height) + (p.height < 0 ? -5 : 13))
      .text(tidy(p.height));
  }
}

/* ───────────────────────────── the numbers ─────────────────────────────── */

/**
 * The chosen rectangle, written as the product it is.
 *
 * Height first, then width, then the answer — in that order, because the order
 * is the claim: this number came from the curve, that one is the strip's width,
 * and multiplying them gives an area.
 */
function productLine() {
  const p = state.last.pieces[state.sel];
  if (!p) return '';
  const dx = (state.b - state.a) / state.n;
  const at = state.rule === 'trapezoid'
    ? `\\tfrac{1}{2}\\left[f(${tidy(p.x0)}) + f(${tidy(p.x1)})\\right]`
    : `f(${tidy(p.sampleX)})`;
  return `\\underbrace{${at}}_{\\text{height}} \\cdot \\underbrace{\\Delta x}_{\\text{width}}`
    + ` = ${tidy(p.height)} \\cdot ${tidy(dx)} = ${tidy(p.area)}`;
}

function updateText() {
  const { n, sum } = { n: state.n, sum: state.last.sum };
  $('#rect-which').textContent = `rectangle ${state.sel + 1} of ${n}`;
  setTex($('#product-line'), productLine(), { display: true });

  $('#sum-line').innerHTML = `Adding all ${n} of them: <b>${fmt(sum)}</b>`;

  const shown = reveal ? reveal.shown : false;
  const v = $('#verdict-line');
  v.hidden = !shown || !Number.isFinite(state.exact);
  if (!v.hidden) {
    const err = sum - state.exact;
    const word = Math.abs(err) < 5e-7 ? 'exactly right'
      : err > 0 ? 'an over-estimate' : 'an under-estimate';
    v.innerHTML = `Exact area <b>${fmt(state.exact)}</b> — so this is ${word}`
      + (Math.abs(err) < 5e-7 ? '.' : `, off by ${fmt(Math.abs(err))}.`);
  }
  buildTable(shown);
}

/**
 * The same rule at doubling n, so the settling is a column you can read rather
 * than something you have to remember from dragging.
 */
function buildTable(withError) {
  const tbody = $('#conv-table tbody');
  tbody.innerHTML = '';
  $('#err-head').hidden = !withError;
  const ns = [];
  for (let k = 1; k <= 256; k *= 2) ns.push(k);
  if (!ns.includes(state.n)) ns.push(state.n);
  ns.sort((p, q) => p - q);
  for (const n of ns) {
    const s = riemann(state.f, state.a, state.b, n, state.rule).sum;
    const tr = document.createElement('tr');
    if (n === state.n) tr.className = 'rs-now';
    const cells = [String(n), fmt((state.b - state.a) / n), fmt(s)];
    if (withError) cells.push(Number.isFinite(state.exact) ? fmt(s - state.exact) : '—');
    tr.innerHTML = cells.map(c => `<td>${c}</td>`).join('');
    tbody.append(tr);
  }
}

/* ──────────────────────────────── driving ─────────────────────────────── */

function select_(/** @type {number} */ i) {
  if (i < 0 || i >= state.n) return;
  state.sel = i;
  render();
  const p = state.last.pieces[i];
  if (p) announce(`Rectangle ${i + 1} of ${state.n}, height ${tidy(p.height)}, area ${tidy(p.area)}.`, 150);
}

function recompute(opts = {}) {
  if (!state.node) return;
  state.f = compile(state.node, 'x');
  // Numerically, always — so e^(−x²) is no harder than x², and the exact value
  // never disagrees with the picture because one came from a formula.
  state.exact = (state.b > state.a) ? adaptiveSimpson(state.f, state.a, state.b) : NaN;
  render();
  if (!opts.quiet) {
    updateUrl({ f: state.src, a: state.a, b: state.b, rule: state.rule, n: state.n });
  }
}

function setRule(/** @type {string} */ rule) {
  if (!RIEMANN_RULES.includes(rule)) return;
  state.rule = /** @type {any} */ (rule);
  for (const b of document.querySelectorAll('.rule-btn')) {
    b.setAttribute('aria-pressed', String(b.dataset.rule === rule));
    b.classList.toggle('ll-primary', b.dataset.rule === rule);
  }
  recompute();
}

function setN(/** @type {number} */ n) {
  state.n = Math.max(1, Math.min(200, Math.round(n)));
  $('#n-out').textContent = String(state.n);
  if ($('#n-slider').value !== String(state.n)) $('#n-slider').value = String(state.n);
  recompute();
}

/* ────────────────────────────────── boot ──────────────────────────────── */

initPage({
  onReady() {
    initShare({ mark: MARK });
    const params = getParams(PRESETS);
    const q = params.raw;

    if (params.f) $('#fn-input').value = params.f;
    if (params.a !== undefined && params.a !== null) $('#a-input').value = String(params.a);
    if (params.b !== undefined && params.b !== null) $('#b-input').value = String(params.b);
    state.a = Number($('#a-input').value);
    state.b = Number($('#b-input').value);
    state.n = Math.max(1, Math.min(200, Number(q.get('n')) || 4));
    $('#n-slider').value = String(state.n);
    $('#n-out').textContent = String(state.n);

    setTex($('#help-tex1'),
      '\\underbrace{f(x_i)}_{\\text{height}}\\cdot\\underbrace{\\Delta x}_{\\text{width}}'
      + ' = \\text{the area of one rectangle}', { display: true });

    reveal = initReveal({
      mount: $('#exact-slot'),
      label: 'the exact area',
      // revealHidden RETURNS whether to hide, which is why every other page
      // passes it straight through. `readout` is the shared spelling across
      // both lenses; a new tool has no older name of its own to honour.
      hidden: revealHidden(q, false),
      prompt: 'Make the rectangles thinner first — where is the number heading?',
      onChange: () => updateText(),
    });

    applyControls(q.get('controls'), q.get('hide'));

    const field = initExpressionInput({
      input: $('#fn-input'),
      error: $('#fn-error'),
      preview: $('#fn-preview'),
      palette: $('#fn-palette'),
      parse: tryParse,
      // A sum under an integral sign is bracketed: ∫ −x² + 4 dx says the 4 is
      // outside the integral, which is a different statement and a false one.
      format: (/** @type {any} */ nd) => {
        const inner = toLatex(nd);
        const body = nd.type === 'add' ? `\\left[${inner}\\right]` : inner;
        return `\\int_{${tidy(state.a)}}^{${tidy(state.b)}} ${body}\\,dx`;
      },
      onChange: (/** @type {any} */ node, /** @type {string} */ src) => {
        state.node = node; state.src = src; recompute();
      },
      onError: () => { chart.plot.selectAll('path.rs-bar').remove(); },
    });

    for (const id of ['#a-input', '#b-input']) {
      $(id).addEventListener('change', () => {
        const a = Number($('#a-input').value), b = Number($('#b-input').value);
        if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) {
          $('#fn-error').hidden = false;
          $('#fn-error').textContent = 'The interval needs b to be bigger than a.';
          return;
        }
        $('#fn-error').hidden = true;
        state.a = a; state.b = b; state.sel = 0;
        field.refresh?.();
        recompute();
      });
    }

    for (const b of document.querySelectorAll('.rule-btn')) {
      b.addEventListener('click', () => setRule(b.dataset.rule));
    }
    for (const b of document.querySelectorAll('.n-btn')) {
      b.addEventListener('click', () => setN(Number(b.dataset.n)));
    }
    initSlider({ input: $('#n-slider'), output: $('#n-out'), onInput: (v) => setN(v) });

    $('#prev-rect').addEventListener('click', () => select_(state.sel - 1));
    $('#next-rect').addEventListener('click', () => select_(state.sel + 1));
    document.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); select_(state.sel - 1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); select_(state.sel + 1); }
    });

    setRule(q.get('rule') || params.rule || 'left');
    onBreakpointChange(() => {
      chart = createChart('#chart', { height: 360, label: 'The curve with rectangles under it' });
      chart.svg.select('defs').append('pattern')
        .attr('id', 'rs-neg').attr('patternUnits', 'userSpaceOnUse')
        .attr('width', 7).attr('height', 7).attr('patternTransform', 'rotate(45)')
        .append('line').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 7)
        .attr('stroke', '#C05E10').attr('stroke-width', 2.4).attr('opacity', 0.55);
      render();
    });
  },
});
