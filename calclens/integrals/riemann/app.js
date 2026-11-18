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
import { initWorking } from 'kit/working.js';
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
let work = null;

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
  // Each piece carries its own index. Looking one up with `indexOf` against a
  // captured array is what broke clicking: the handler held the array from the
  // render that created the path, the datum came from the CURRENT render, and
  // a fresh object is never found in a stale array — so every click resolved
  // to −1 and was dropped without a sound.
  r.pieces.forEach((p, i) => { p.i = i; });
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
    .merge(bars)
    .attr('class', (d, i) => 'rs-bar'
      + (d.area < 0 ? ' rs-bar-neg' : '')
      + (i === state.sel ? ' rs-bar-sel' : ''))
    .attr('d', d => shapeOf(d, xs, ys, rule, f));

  // The curve goes ON TOP of the rectangles, so where a top overshoots the
  // curve and where it falls short is visible without anything being added to
  // say so. That sliver IS the error.
  drawCurve(chart.plot, f, { xs, ys });
  // The curve is drawn over the rectangles on purpose, and the decorations sit
  // over everything — so near the top of a rectangle, where the curve, the
  // sample dot and the height label all are, a click landed on one of those
  // instead of on the rectangle. None of them is a thing to click.
  chart.plot.selectAll('path.ll-curve').attr('pointer-events', 'none');

  chart.gOver.attr('pointer-events', 'none');
  chart.gOver.selectAll('*').remove();
  drawHitStrips(r.pieces, xs, ys);
  drawSamplePoints(r.pieces, xs, ys, rule, n);
  drawWidthRule(r.pieces, xs, ys, n);
  if (n <= 8) drawHeightLabels(r.pieces, xs, ys, rule);

  chart.svg.attr('aria-label',
    `${n} ${rule} rectangle${n === 1 ? '' : 's'} under f from ${tidy(a)} to ${tidy(b)}, `
    + `each ${tidy((b - a) / n)} wide. The estimate is ${fmt(r.sum)}.`);

  updateText();
}

/**
 * A full-height invisible strip over each rectangle's column, which is what
 * actually takes the clicks.
 *
 * Clicking the rectangle itself is no good near a zero of f, where it is three
 * pixels tall and on a phone cannot be hit at all — and those flat end
 * rectangles are exactly the ones worth inspecting, since their product is
 * nearly nothing. The strip spans the plot, so every column is as easy to
 * reach as every other however short its rectangle.
 *
 * The strips are JOINED, never cleared and rebuilt. A click only fires when
 * mousedown and mouseup land on the same element, and clicking the chart blurs
 * the function box — which fires its `change`, which re-renders. Rebuilding
 * the strips in between meant the mouseup landed on a different element and no
 * click was ever dispatched: the first click after typing did nothing, every
 * time.
 */
function drawHitStrips(pieces, xs, ys) {
  const [top, bottom] = ys.range();
  let g = chart.plot.select('g.rs-hits');
  if (g.empty()) g = chart.plot.append('g').attr('class', 'rs-hits');
  const strips = g.selectAll('rect').data(pieces);
  strips.exit().remove();
  strips.enter().append('rect')
    .merge(strips)
    .attr('x', d => xs(d.x0))
    .attr('width', d => Math.max(1, xs(d.x1) - xs(d.x0)))
    .attr('y', Math.min(top, bottom))
    .attr('height', Math.abs(bottom - top))
    .attr('fill', 'transparent')
    .style('cursor', 'pointer')
    .on('click', (/** @type {any} */ _e, /** @type {any} */ d) => select_(d.i));
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

/**
 * The sum, organised the way it is taught: Δx factored out, the heights added.
 *
 * Jeff, 2026-11-17: *"when organizing the computations to show students, factor
 * the delta x term and just sum the function values. that approach doesn't show
 * in the app."* It does now, and it is the point of the organisation — you
 * multiply ONCE at the end rather than n times, so what is actually being added
 * is a list of heights.
 *
 * Long sums are elided to the first two terms and the last. Writing out two
 * hundred of them would be a wall rather than a demonstration, and the shape
 * is what is being shown.
 * @returns {{tex:string, notes:{text:string,kind:'transition'|'diagnosis'}[]}[]}
 */
function sumSteps() {
  const { pieces } = state.last;
  const n = state.n;
  if (!pieces.length) return [];
  const dx = (state.b - state.a) / n;
  const trap = state.rule === 'trapezoid';
  const T = (/** @type {string} */ t) => ({ text: t, kind: /** @type {const} */ ('transition') });
  const long = n > 6;

  /** The terms to actually print, with an ellipsis standing for the rest. */
  const shown = long ? [0, 1, -1, n - 1] : pieces.map((_, i) => i);
  const join = (/** @type {(i:number)=>string} */ term) => shown
    .map(i => (i === -1 ? '\\cdots' : term(i)))
    .join(' + ');
  /** Values join with their own sign, or a negative height reads as "+ −0.4". */
  const joinSigned = (/** @type {(i:number)=>number} */ val) => shown.map((i, k) => {
    if (i === -1) return '+ \\cdots';
    const v = val(i);
    const body = tidy(Math.abs(v));
    if (k === 0) return v < 0 ? `-${body}` : body;
    return `${v < 0 ? '-' : '+'} ${body}`;
  }).join(' ');

  const paren = (/** @type {string} */ inner) => `\\left(${inner}\\right)`;
  // A trapezoid's height is the average of its two ends, so f(x_i) would be the
  // wrong name for it. It gets a neutral one rather than a wrong one.
  const sym = trap ? ((/** @type {number} */ i) => `h_{${i + 1}}`)
    : ((/** @type {number} */ i) => `f(x_{${i + 1}})`);
  const subbed = trap ? ((/** @type {number} */ i) => `h_{${i + 1}}`)
    : ((/** @type {number} */ i) => `f(${tidy(pieces[i].sampleX)})`);

  const total = pieces.reduce((acc, p) => acc + (Number.isFinite(p.height) ? p.height : 0), 0);
  const steps = [];

  steps.push({
    tex: `${paren(join(sym))}\\Delta x`,
    notes: [T(trap
      ? `each \\(h_i\\) is the average of the two ends of its strip`
      : `all \\(${n}\\) rectangles share the same width, so \\(\\Delta x\\) `
        + `comes out as a common factor`)],
  });
  steps.push({
    tex: `${paren(join(subbed))}${paren(tidy(dx))}`,
    notes: [T(`${trap ? '' : 'the sample points, and '}\\(\\Delta x = \\frac{b-a}{n} `
      + `= \\frac{${tidy(state.b - state.a)}}{${n}} = ${tidy(dx)}\\)`)],
  });
  steps.push({
    tex: `${paren(joinSigned(i => pieces[i].height))}${paren(tidy(dx))}`,
    notes: [T('each height, read off the curve'
      + (long ? ` — \\(${n}\\) of them, two shown` : ''))],
  });
  steps.push({
    tex: `${paren(tidy(total))}${paren(tidy(dx))}`,
    notes: [T('add the heights — this is the whole of the work')],
  });
  steps.push({
    tex: tidy(state.last.sum),
    notes: [T('one multiplication, at the end — not \\(n\\) of them')],
  });
  return steps;
}

function updateText() {
  const { n, sum } = { n: state.n, sum: state.last.sum };
  $('#rect-which').textContent = `rectangle ${state.sel + 1} of ${n}`;
  setTex($('#product-line'), productLine(), { display: true });

  if (work) work.set(sumSteps(), { openAll: true });

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

    work = initWorking({
      mount: $('#work-mount'),
      // Not a step-by-step exercise: the lines are a live readout that changes
      // whenever the slider does, so gating them behind a button that resets on
      // every drag would be the wrong kind of friction. The component is reused
      // for the look and the margin column, with its controls stood down.
      chain: true,
    });
    work.setSuppressed(true);

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
