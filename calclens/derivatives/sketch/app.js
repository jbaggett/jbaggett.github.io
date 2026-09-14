/**
 * Sketch from Signs — curve sketching as an assembly job.
 *
 * The claim being taught: on any interval where f′ and f″ both keep their
 * signs, a graph can only do one of four things. Two signs, four combinations,
 * four shapes, and a curve sketch is those shapes laid end to end. Once a
 * student sees that, sketching stops being an art and becomes a lookup plus
 * some arithmetic about heights.
 *
 * So the tool does NOT plot the function. It finds the cut points — where f′
 * or f″ changes sign — reads out the two sign charts and the handful of heights
 * that pin the ends, and asks for one shape per interval. The real graph is
 * withheld until the sketch is complete.
 *
 * The consistency check is the part that teaches rather than grades. "Rising"
 * on an interval that ends lower than it starts is a contradiction between the
 * shape and the numbers, and it is named as one — the most common way a sketch
 * goes astray is the two halves telling different stories.
 */

import { createChart, makeScales, drawAxes, onBreakpointChange, onLayoutChange, afterLayout } from 'kit/chart.js';
import { drawCurve, autoYDomain } from 'kit/curve.js';
import { initPage, announce } from 'kit/page.js';
import { getParams, updateUrl } from 'kit/url.js';
import { tex, setTex, renderMathLabels } from 'kit/tex.js';
import { initExpressionInput } from 'kit/input.js';
import { initShare } from 'kit/share.js';
import { initReveal, revealHidden } from 'kit/reveal.js';
import { fmt } from 'kit/format.js';
import { MARK } from '../../js/mark.js';
import { tryParse, compile, derivative, toLatex } from '../../js/expr.js';
import { findRoots } from '../../js/numeric.js';

const $ = (/** @type {string} */ s) => /** @type {any} */ (document.querySelector(s));

/**
 * The four shapes, as (rising?, bending up?) with the arc that draws each.
 *
 * The keys are the two signs, because that is the lookup the student is
 * learning; the icons are quarter-arcs, which is what each actually looks like.
 */
const SHAPES = [
  { id: 'inc-cu', up: true, cu: true, name: 'rising, steepening',
    path: 'M3,21 Q17,21 21,3', words: 'increasing and concave up' },
  { id: 'inc-cd', up: true, cu: false, name: 'rising, levelling off',
    path: 'M3,21 Q7,3 21,3', words: 'increasing and concave down' },
  { id: 'dec-cu', up: false, cu: true, name: 'falling, levelling off',
    path: 'M3,3 Q7,21 21,21', words: 'decreasing and concave up' },
  { id: 'dec-cd', up: false, cu: false, name: 'falling, steepening',
    path: 'M3,3 Q17,3 21,21', words: 'decreasing and concave down' },
];
const byId = (/** @type {string} */ id) => SHAPES.find(s => s.id === id);

const icon = (/** @type {string} */ path, /** @type {string} */ colour = 'currentColor') =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}" fill="none" `
  + `stroke="${colour}" stroke-width="2.6" stroke-linecap="round"/></svg>`;

const state = {
  node: null,
  /** @type {(x:number)=>number} */ f: () => NaN,
  x0: -3, x1: 3,
  /** @type {{a:number,b:number,ya:number,yb:number,upTrue:boolean,cuTrue:boolean}[]} */
  intervals: [],
  /** @type {(string|null)[]} one chosen shape id per interval */ picks: [],
  checked: false,
  showReal: false,
};

let chart = null;

/* ──────────────────────── the problem, from the function ────────────────── */

/**
 * Cut the window at every sign change of f′ and f″, and record what each
 * interval actually does.
 *
 * The cut points are the critical and inflection points — which is why the
 * scaffolding this tool hands out is the same scaffolding the course asks
 * students to produce by hand.
 */
function buildIntervals() {
  const { x0, x1, node } = state;
  const d1 = compile(derivative(node), 'x');
  const d2 = compile(derivative(derivative(node)), 'x');
  const cuts = [...findRoots(d1, x0, x1), ...findRoots(d2, x0, x1)]
    .sort((a, b) => a - b)
    .filter((c, i, arr) => i === 0 || Math.abs(c - arr[i - 1]) > (x1 - x0) * 1e-4);

  const edges = [x0, ...cuts, x1];
  const out = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const a = edges[i], b = edges[i + 1];
    const mid = (a + b) / 2;
    const ya = state.f(a), yb = state.f(b);
    if (!Number.isFinite(ya) || !Number.isFinite(yb)) continue;
    out.push({ a, b, ya, yb, upTrue: d1(mid) > 0, cuTrue: d2(mid) > 0 });
  }
  state.intervals = out;
  state.picks = out.map(() => null);
  state.checked = false;
}

/* ────────────────────────────── the sign chart ─────────────────────────── */

function renderChart() {
  const grid = $('#chart-grid');
  const n = state.intervals.length;
  if (!n) { grid.innerHTML = '<p class="ll-error">No sign changes found in this window.</p>'; return; }

  // Columns are proportional to the intervals they describe, so reading across
  // the chart is reading along the axis — equal columns made a 2-unit stretch
  // and a 1-unit stretch look alike, which is the correspondence the whole
  // exercise depends on. The minimum stops a narrow interval crushing its
  // picker.
  const widths = state.intervals.map(iv => iv.b - iv.a);
  const total = widths.reduce((s2, w) => s2 + w, 0);
  grid.style.gridTemplateColumns = 'auto '
    + widths.map(w => `minmax(86px, ${((w / total) * 100).toFixed(2)}fr)`).join(' ');
  const cell = (cls, html) => `<div class="${cls}">${html}</div>`;
  let html = '';

  html += cell('sk-row-label', tex("f'(x)"));
  for (const iv of state.intervals) {
    html += cell(`sk-sign ${iv.upTrue ? 'pos' : 'neg'}`, iv.upTrue ? '+' : '−');
  }
  html += cell('sk-row-label', tex('f\'\'(x)'));
  for (const iv of state.intervals) {
    html += cell(`sk-sign ${iv.cuTrue ? 'pos' : 'neg'}`, iv.cuTrue ? '+' : '−');
  }

  html += cell('sk-row-label', '<span class="ll-hint">shape</span>');
  state.intervals.forEach((iv, i) => {
    const pick = state.picks[i];
    html += `<div class="sk-pick" role="group" aria-label="Shape for the interval from ${fmt(iv.a, 2)} to ${fmt(iv.b, 2)}">`
      + SHAPES.map(s => {
        let mark = '';
        if (state.checked && pick === s.id) mark = isRight(i) ? ' sk-right' : ' sk-wrong';
        return `<button type="button" class="sk-shape${mark}" data-iv="${i}" data-shape="${s.id}" `
          + `aria-pressed="${pick === s.id}" title="${s.name}" aria-label="${s.name}">${icon(s.path)}</button>`;
      }).join('') + '</div>';
  });

  // The cut points, under the columns they separate.
  html += cell('sk-row-label', '<span class="ll-hint">from … to</span>');
  for (const iv of state.intervals) {
    html += cell('sk-cut', `${fmt(iv.a, 2)} … ${fmt(iv.b, 2)}`);
  }
  grid.innerHTML = html;

  grid.querySelectorAll('button.sk-shape').forEach(b => b.addEventListener('click', () => {
    const i = Number(b.dataset.iv);
    state.picks[i] = state.picks[i] === b.dataset.shape ? null : b.dataset.shape;
    state.checked = false;
    $('#verdict').innerHTML = '';
    renderChart();
    render();
  }));

  const vals = [state.intervals[0].a, ...state.intervals.map(iv => iv.b)];
  $('#values').innerHTML = 'You are given: '
    + vals.map(x => tex(`f(${fmt(x, 2)}) = ${fmt(state.f(x), 2)}`)).join('&nbsp; &nbsp;');
}

const isRight = (/** @type {number} */ i) => {
  const s = byId(state.picks[i]);
  const iv = state.intervals[i];
  return !!s && s.up === iv.upTrue && s.cu === iv.cuTrue;
};

/* ─────────────────────────────── the sketch ────────────────────────────── */

/**
 * One piece of the sketch: a curve from (a, ya) to (b, yb) with the chosen
 * concavity.
 *
 * Only two interpolants are needed. With y = ya + (yb − ya)·s(t), the curve is
 * concave up exactly when (yb − ya)·s″ > 0 — so which of t² and 2t − t² gives
 * "concave up" FLIPS with the direction the interval actually runs. That is
 * also why the direction claim can be checked for free: the values already
 * decide whether it rises.
 */
function piecePath(iv, shape, xs, ys) {
  const rising = iv.yb > iv.ya;
  const wantCU = shape.cu;
  const accel = rising ? wantCU : !wantCU;      // true → s(t) = t²
  const s = accel ? (t => t * t) : (t => 2 * t - t * t);
  const pts = [];
  for (let k = 0; k <= 40; k++) {
    const t = k / 40;
    pts.push([xs(iv.a + (iv.b - iv.a) * t), ys(iv.ya + (iv.yb - iv.ya) * s(t))]);
  }
  return 'M' + pts.map(p => p.join(',')).join(' L');
}

function render() {
  chart = chart || createChart('#fig', { height: 400, fit: true, label: 'placeholder' });
  const { x0, x1 } = state;
  const yDom = autoYDomain(state.f, x0, x1, { minSpan: 2 });
  const { xs, ys } = makeScales(chart, [x0, x1], yDom);
  drawAxes(chart, { xs, ys, xLabel: 'x', yLabel: 'y' });

  chart.plot.selectAll('*').remove();
  chart.gOver.selectAll('*').remove();

  // The real graph, dashed, only once asked for.
  if (state.showReal) {
    const g = chart.plot.append('g');
    drawCurve(g, state.f, { xs, ys, className: 'sk-real' });
    g.selectAll('path').attr('stroke', 'var(--curve-f)').attr('stroke-width', 2.5)
      .attr('stroke-dasharray', '6 3').attr('fill', 'none').attr('opacity', 0.85);
  }

  // The cut points, which are the heights the student was given.
  const marks = state.intervals.length
    ? [state.intervals[0].a, ...state.intervals.map(iv => iv.b)] : [];
  for (const x of marks) {
    const y = state.f(x);
    if (!Number.isFinite(y)) continue;
    chart.gOver.append('line').attr('class', 'll-marker-line')
      .attr('x1', xs(x)).attr('x2', xs(x))
      .attr('y1', chart.margin.top).attr('y2', chart.height - chart.margin.bottom);
    chart.gOver.append('circle').attr('cx', xs(x)).attr('cy', ys(y)).attr('r', 4.5)
      .attr('fill', '#222').attr('stroke', '#fff').attr('stroke-width', 1.5);
  }

  // The student's pieces.
  state.intervals.forEach((iv, i) => {
    const shape = byId(state.picks[i]);
    if (!shape) return;
    const wrong = state.checked && !isRight(i);
    chart.plot.append('path')
      .attr('d', piecePath(iv, shape, xs, ys))
      .attr('fill', 'none')
      .attr('stroke', wrong ? 'var(--bad)' : 'var(--ims-blue-text)')
      .attr('stroke-width', 3).attr('stroke-linecap', 'round');
  });

  const done = state.picks.filter(Boolean).length;
  chart.setLabel(`Your sketch: ${done} of ${state.intervals.length} intervals drawn`
    + (state.showReal ? ', with the real graph laid over it' : '') + '.');
}

/* ────────────────────────────── checking ───────────────────────────────── */

function check() {
  const n = state.intervals.length;
  const missing = state.picks.filter(p => !p).length;
  if (missing) {
    $('#verdict').innerHTML = `<b>${missing} interval${missing > 1 ? 's' : ''}</b> `
      + `still ${missing > 1 ? 'have' : 'has'} no shape. Pick one for each, then check.`;
    announce(`${missing} intervals still empty.`);
    return;
  }
  state.checked = true;

  const wrong = [];
  const contradictions = [];
  state.intervals.forEach((iv, i) => {
    const s = byId(state.picks[i]);
    if (!isRight(i)) wrong.push(i);
    // The shape and the numbers must tell the same story. This is a different
    // error from "wrong shape", and worth naming separately.
    if (s.up !== (iv.yb > iv.ya)) contradictions.push({ i, iv, s });
  });

  const parts = [];
  if (!wrong.length) {
    parts.push(`<span class="ll-verdict ok">✓ All ${n} intervals right.</span> `
      + `That sketch is the function's shape everywhere — only the exact heights between `
      + `the marked points are approximations.`);
  } else {
    parts.push(`<span class="ll-verdict bad">${n - wrong.length} of ${n} right.</span> `
      + `The ones in red are marked on both the chart and the sketch.`);
  }
  for (const c of contradictions) {
    parts.push(`<br>On <b>${fmt(c.iv.a, 2)} to ${fmt(c.iv.b, 2)}</b> you chose `
      + `<b>${c.s.name}</b>, but you were given `
      + `${tex(`f(${fmt(c.iv.a, 2)}) = ${fmt(c.iv.ya, 2)}`)} and `
      + `${tex(`f(${fmt(c.iv.b, 2)}) = ${fmt(c.iv.yb, 2)}`)} — it ends `
      + `${c.iv.yb > c.iv.ya ? 'higher' : 'lower'} than it starts, so it cannot be `
      + `${c.s.up ? 'rising' : 'falling'}. The shape and the numbers have to agree.`);
  }
  $('#verdict').innerHTML = parts.join('');
  announce(wrong.length ? `${n - wrong.length} of ${n} correct.` : 'All correct.', 120);
  renderChart();
  render();
}

/* ────────────────────────────────── boot ───────────────────────────────── */

function rebuild() {
  if (!state.node) return;
  buildIntervals();
  renderChart();
  render();
}

initPage({
  onReady() {
    initShare({ mark: MARK });
    const q = getParams().raw;
    if (q.get('f')) $('#fn-input').value = q.get('f');
    if (q.get('window')) $('#win-input').value = q.get('window');

    $('#key').innerHTML = SHAPES.map(s =>
      `<span>${icon(s.path, 'var(--ims-blue-text)')}</span>`
      + `<span>${tex(`f' ${s.up ? '>' : '<'} 0, \\; f'' ${s.cu ? '>' : '<'} 0`)}</span>`
      + `<span>${s.name}</span>`).join('');

    const rev = initReveal({
      mount: $('#reveal-slot'),
      label: 'the real graph',
      hidden: revealHidden(q, false),
      prompt: 'Build the sketch first',
      onChange(shown) { state.showReal = shown; render(); },
    });
    state.showReal = rev.shown;

    const readWindow = () => {
      const p = String($('#win-input').value).split(',').map(Number);
      if (p.length === 2 && p.every(Number.isFinite) && p[1] > p[0]) [state.x0, state.x1] = p;
    };
    readWindow();

    initExpressionInput({
      input: $('#fn-input'),
      error: $('#fn-error'),
      parse: tryParse,
      onChange(node, src) {
        state.node = node;
        state.f = compile(node, 'x');
        updateUrl({ f: src });
        rebuild();
      },
    });

    document.querySelectorAll('.preset').forEach(b => b.addEventListener('click', () => {
      $('#win-input').value = b.dataset.win;
      readWindow();
      updateUrl({ window: b.dataset.win });
      $('#fn-input').value = b.dataset.f;
      $('#fn-input').dispatchEvent(new Event('change'));
    }));
    $('#win-input').addEventListener('change', () => {
      readWindow(); updateUrl({ window: $('#win-input').value }); rebuild();
    });
    $('#check-btn').addEventListener('click', check);
    $('#clear-btn').addEventListener('click', () => {
      state.picks = state.intervals.map(() => null);
      state.checked = false;
      $('#verdict').innerHTML = '';
      renderChart(); render();
      announce('Cleared.', 100);
    });

    renderMathLabels(src => { const r = tryParse(src); return r.node ? toLatex(r.node) : null; });
    onBreakpointChange(() => { chart = null; render(); });
    onLayoutChange(() => { chart = null; render(); });
    afterLayout(() => { chart = null; render(); });
  },
});
