/**
 * Sketch from Signs — curve sketching as an assembly job.
 *
 * The claim being taught: on any interval where f′ and f″ both keep their
 * signs, a graph can only do one of four things. Two signs, four combinations,
 * four shapes, and a curve sketch is those shapes laid end to end.
 *
 * So the tool does not plot the function. It finds the cut points — where f′ or
 * f″ changes sign — and asks for one shape per interval. The real graph is
 * withheld until the sketch is built.
 *
 * TWO DECISIONS ABOUT THE INTERFACE, both of which turned out to matter more
 * than they sound:
 *
 * 1. THE SIGN CHARTS LIVE INSIDE THE PLOT, in a band under the x-axis, drawn in
 *    the same SVG at the same scale. A separate chart above the graph has to
 *    claim that its columns correspond to stretches of the axis; this one just
 *    is the axis, and the dashed cut lines run through both.
 *
 * 2. ONE PALETTE, NOT FOUR BUTTONS PER INTERVAL. Repeating the four shapes in
 *    every column made the page grow with the function and buried the point,
 *    which is that there are only ever four. Pick up a shape, drop it in an
 *    interval.
 *
 *    Dragging is the discoverable half and is NOT the whole interface: a tile
 *    can be clicked to pick it up and an interval clicked to place it, which is
 *    the same gesture without a mouse and the only one that works from a
 *    keyboard. Every interval is a focusable target with a spoken name.
 *
 * The consistency check is the part that teaches rather than grades: "rising"
 * on an interval that ends lower than it starts is a contradiction between the
 * shape and the numbers, and it is named as one.
 */

import { createChart, makeScales, drawAxes, onBreakpointChange, onLayoutChange, afterLayout } from 'kit/chart.js';
import { drawCurve, autoYDomain } from 'kit/curve.js';
import { initPage, announce } from 'kit/page.js';
import { getParams, updateUrl } from 'kit/url.js';
import { tex, renderMathLabels } from 'kit/tex.js';
import { initExpressionInput } from 'kit/input.js';
import { initShare } from 'kit/share.js';
import { initReveal, revealHidden } from 'kit/reveal.js';
import { fmt } from 'kit/format.js';
import { MARK } from '../../js/mark.js';
import { tryParse, compile, derivative, toLatex } from '../../js/expr.js';
import { findRoots } from '../../js/numeric.js';

const $ = (/** @type {string} */ s) => /** @type {any} */ (document.querySelector(s));

/** The four shapes, as (rising?, bending up?) with the quarter-arc that draws each. */
const SHAPES = [
  { id: 'inc-cu', up: true, cu: true, name: 'rising, steepening', path: 'M3,21 Q17,21 21,3' },
  { id: 'inc-cd', up: true, cu: false, name: 'rising, levelling off', path: 'M3,21 Q7,3 21,3' },
  { id: 'dec-cu', up: false, cu: true, name: 'falling, levelling off', path: 'M3,3 Q7,21 21,21' },
  { id: 'dec-cd', up: false, cu: false, name: 'falling, steepening', path: 'M3,3 Q17,3 21,21' },
];
const byId = (/** @type {string} */ id) => SHAPES.find(s => s.id === id);
const icon = (/** @type {string} */ path, /** @type {string} */ colour = 'currentColor', w = 2.6) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}" fill="none" stroke="${colour}" `
  + `stroke-width="${w}" stroke-linecap="round"/></svg>`;

/** Height of the sign band under the axis: two sign rows and a shape slot. */
const BAND = { rowH: 21, slotH: 30, gap: 5, pad: 10 };
const BAND_H = BAND.pad + BAND.rowH * 2 + BAND.slotH + BAND.gap * 2 + 16;

const state = {
  node: null,
  /** @type {(x:number)=>number} */ f: () => NaN,
  x0: -3, x1: 3,
  /** @type {{a:number,b:number,ya:number,yb:number,upTrue:boolean,cuTrue:boolean}[]} */
  intervals: [],
  /** @type {(string|null)[]} */ picks: [],
  /** @type {string|null} the shape currently picked up */ held: null,
  checked: false,
  showReal: false,
};

let chart = null;

/* ──────────────────────── the problem, from the function ────────────────── */

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

const isRight = (/** @type {number} */ i) => {
  const s = byId(state.picks[i]);
  const iv = state.intervals[i];
  return !!s && s.up === iv.upTrue && s.cu === iv.cuTrue;
};

/* ─────────────────────────────── the palette ───────────────────────────── */

function renderPalette() {
  $('#palette').innerHTML = SHAPES.map(s =>
    `<button type="button" class="sk-tile" data-shape="${s.id}" aria-pressed="${state.held === s.id}"`
    + ` aria-label="${s.name}. Pick up, then choose an interval.">`
    + icon(s.path, 'var(--ims-blue-text)')
    + `<small>${s.name}</small></button>`).join('');

  // ONE gesture handler, not two. A separate click listener alongside
  // pointerdown meant every tap ran both: pointerdown picked the shape up and
  // the click that followed toggled it straight back off, so nothing was ever
  // held and nothing could be placed. Tap and drag are the same gesture here,
  // told apart at pointerup by whether it landed on an interval.
  document.querySelectorAll('.sk-tile').forEach(t => {
    t.addEventListener('pointerdown', ev => startDrag(ev, t.dataset.shape));
  });
}

function hold(id) {
  state.held = id;
  document.querySelectorAll('.sk-tile').forEach(t =>
    t.setAttribute('aria-pressed', String(t.dataset.shape === id)));
  updateHint();
  if (id) announce(`${byId(id).name} picked up. Now choose an interval.`);
}

function updateHint() {
  const left = state.picks.filter(p => !p).length;
  // A held shape stays held, so the same shape can go in several intervals —
  // but the count has to stay visible or there is no way to tell how far along
  // you are without counting boxes.
  const todo = left
    ? `${left} interval${left > 1 ? 's' : ''} still empty.`
    : 'Every interval has a shape — check your sketch.';
  $('#drop-hint').innerHTML = state.held
    ? `<b>${byId(state.held).name}</b> is picked up — click an interval to place it. ${todo}`
    : left
      ? `${todo} Pick a shape above, then click an interval.`
      : todo;
}

/* ─────────────────────────────── the drawing ───────────────────────────── */

/**
 * One piece: a curve from (a, ya) to (b, yb) with the chosen concavity.
 *
 * Only two interpolants are needed. With y = ya + (yb − ya)·s(t), the curve is
 * concave up exactly when (yb − ya)·s″ > 0 — so which of t² and 2t − t² means
 * "concave up" flips with the direction the interval actually runs. That is
 * also why the direction claim can be checked for free.
 */
function piecePath(iv, shape, xs, ys) {
  const accel = (iv.yb > iv.ya) ? shape.cu : !shape.cu;
  const s = accel ? (t => t * t) : (t => 2 * t - t * t);
  const pts = [];
  for (let k = 0; k <= 40; k++) {
    const t = k / 40;
    pts.push([xs(iv.a + (iv.b - iv.a) * t), ys(iv.ya + (iv.yb - iv.ya) * s(t))]);
  }
  return 'M' + pts.map(p => p.join(',')).join(' L');
}

function render() {
  const { x0, x1 } = state;
  chart = chart || createChart('#fig', {
    height: 470,
    // The bottom margin holds the sign band, so the curve never runs into it.
    margin: { top: 16, right: 20, bottom: 34 + BAND_H, left: 44 },
    label: 'placeholder',
  });

  const yDom = autoYDomain(state.f, x0, x1, { minSpan: 2 });
  const { xs, ys } = makeScales(chart, [x0, x1], yDom);
  drawAxes(chart, { xs, ys, xLabel: 'x', yLabel: 'y' });

  chart.plot.selectAll('*').remove();
  chart.gOver.selectAll('*').remove();

  if (state.showReal) {
    const g = chart.plot.append('g');
    drawCurve(g, state.f, { xs, ys, className: 'sk-real' });
    g.selectAll('path').attr('stroke', 'var(--curve-f)').attr('stroke-width', 2.5)
      .attr('stroke-dasharray', '6 3').attr('fill', 'none').attr('opacity', 0.85);
  }

  drawBand(xs);

  // The given heights.
  const marks = state.intervals.length
    ? [state.intervals[0].a, ...state.intervals.map(iv => iv.b)] : [];
  for (const x of marks) {
    const y = state.f(x);
    if (!Number.isFinite(y)) continue;
    chart.gOver.append('circle').attr('cx', xs(x)).attr('cy', ys(y)).attr('r', 4.5)
      .attr('fill', '#222').attr('stroke', '#fff').attr('stroke-width', 1.5);
  }

  state.intervals.forEach((iv, i) => {
    const shape = byId(state.picks[i]);
    if (!shape) return;
    chart.plot.append('path')
      .attr('d', piecePath(iv, shape, xs, ys))
      .attr('fill', 'none')
      .attr('stroke', state.checked && !isRight(i) ? 'var(--bad)' : 'var(--ims-blue-text)')
      .attr('stroke-width', 3).attr('stroke-linecap', 'round');
  });

  drawTargets(xs);

  const done = state.picks.filter(Boolean).length;
  chart.setLabel(`Your sketch: ${done} of ${state.intervals.length} intervals filled`
    + (state.showReal ? ', with the real graph over it' : '') + '.');
  updateHint();
}

/**
 * The sign charts, drawn in the same SVG as the graph and at the same scale.
 *
 * This is the whole reason they moved: a chart drawn separately has to assert
 * that its columns line up with stretches of the axis, and then keep that
 * promise through every layout change. Drawn here they cannot drift, because
 * they use the same x scale the curve does.
 */
function drawBand(xs) {
  const top = chart.height - chart.margin.bottom + BAND.pad;
  const rows = [
    { y: top, h: BAND.rowH, label: "f'", get: iv => iv.upTrue },
    { y: top + BAND.rowH + BAND.gap, h: BAND.rowH, label: "f''", get: iv => iv.cuTrue },
  ];
  const slotY = top + (BAND.rowH + BAND.gap) * 2;
  const g = chart.gOver.append('g').attr('class', 'sk-band');

  // Dashed cut lines, top of the plot right down through the band — the same
  // rule the graph already draws at those points.
  const cuts = state.intervals.length
    ? [state.intervals[0].a, ...state.intervals.map(iv => iv.b)] : [];
  for (const x of cuts) {
    g.append('line').attr('x1', xs(x)).attr('x2', xs(x))
      .attr('y1', chart.margin.top).attr('y2', slotY + BAND.slotH)
      .attr('stroke', '#8a8a8a').attr('stroke-width', 1).attr('stroke-dasharray', '3 3');
    g.append('text').attr('x', xs(x)).attr('y', slotY + BAND.slotH + 13)
      .attr('text-anchor', 'middle').attr('font-size', chart.fs(11))
      .attr('font-family', 'var(--font-mono)').attr('fill', 'var(--ims-gray-text)')
      .text(fmt(x, 2));
  }

  for (const row of rows) {
    g.append('text').attr('x', chart.margin.left - 8).attr('y', row.y + row.h * 0.72)
      .attr('text-anchor', 'end').attr('font-size', chart.fs(12))
      .attr('font-style', 'italic').attr('fill', 'var(--ims-gray-text)')
      .text(row.label === "f'" ? 'f ′' : 'f ″');
    for (const iv of state.intervals) {
      const on = row.get(iv);
      g.append('rect').attr('x', xs(iv.a) + 1).attr('y', row.y)
        .attr('width', Math.max(0, xs(iv.b) - xs(iv.a) - 2)).attr('height', row.h)
        .attr('fill', on ? 'rgba(27,122,61,0.10)' : 'rgba(165,39,20,0.09)').attr('rx', 3);
      g.append('text').attr('x', (xs(iv.a) + xs(iv.b)) / 2).attr('y', row.y + row.h * 0.76)
        .attr('text-anchor', 'middle').attr('font-size', chart.fs(14)).attr('font-weight', '700')
        .attr('fill', on ? '#1B7A3D' : '#A52714')
        .text(on ? '+' : '−');
    }
  }

  // The slot row: what has been dropped, or an empty dashed box inviting one.
  g.append('text').attr('x', chart.margin.left - 8).attr('y', slotY + BAND.slotH * 0.68)
    .attr('text-anchor', 'end').attr('font-size', chart.fs(12))
    .attr('fill', 'var(--ims-gray-text)').text('shape');
  state.intervals.forEach((iv, i) => {
    const w = Math.max(0, xs(iv.b) - xs(iv.a) - 2);
    const shape = byId(state.picks[i]);
    const wrong = state.checked && shape && !isRight(i);
    const right = state.checked && shape && isRight(i);
    g.append('rect').attr('x', xs(iv.a) + 1).attr('y', slotY)
      .attr('width', w).attr('height', BAND.slotH).attr('rx', 4)
      .attr('fill', right ? '#F0F8F2' : wrong ? '#FFF2F0' : shape ? '#EAF3F8' : 'none')
      .attr('stroke', right ? 'var(--ok)' : wrong ? 'var(--bad)' : shape ? 'var(--ims-blue-text)' : '#b4b4b4')
      .attr('stroke-width', shape ? 1.6 : 1)
      .attr('stroke-dasharray', shape ? null : '4 3');
    if (shape && w > 14) {
      const size = Math.min(BAND.slotH - 6, w - 6);
      const cx = (xs(iv.a) + xs(iv.b)) / 2;
      g.append('g')
        .attr('transform', `translate(${cx - size / 2},${slotY + (BAND.slotH - size) / 2}) scale(${size / 24})`)
        .html(`<path d="${shape.path}" fill="none" stroke="${wrong ? 'var(--bad)' : 'var(--ims-blue-text)'}" stroke-width="2.6" stroke-linecap="round"/>`);
    }
  });
  state.slotY = slotY;
}

/**
 * A focusable, clickable target per interval, covering the graph and the band.
 *
 * Dragging is the discoverable gesture; this is the one that works without a
 * mouse. Both end in the same place — a shape assigned to an interval — so
 * neither is a second-class path.
 */
function drawTargets(xs) {
  const top = chart.margin.top;
  const bottom = state.slotY + BAND.slotH;
  state.intervals.forEach((iv, i) => {
    const shape = byId(state.picks[i]);
    const node = chart.gOver.append('rect')
      .attr('class', 'sk-drop')
      .attr('x', xs(iv.a)).attr('y', top)
      .attr('width', Math.max(0, xs(iv.b) - xs(iv.a))).attr('height', bottom - top)
      .attr('fill', 'transparent')
      .attr('tabindex', 0)
      .attr('role', 'button')
      .attr('data-iv', i)
      .attr('aria-label',
        `Interval from ${fmt(iv.a, 2)} to ${fmt(iv.b, 2)}. `
        + `f prime is ${iv.upTrue ? 'positive' : 'negative'}, `
        + `f double prime is ${iv.cuTrue ? 'positive' : 'negative'}. `
        + (shape ? `Currently ${shape.name}.` : 'Currently empty.'))
      .node();
    node.addEventListener('click', () => place(i));
    node.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); place(i); }
    });
  });
}

function place(i) {
  if (state.held) {
    state.picks[i] = state.held;
    announce(`${byId(state.held).name} placed on ${fmt(state.intervals[i].a, 2)} to ${fmt(state.intervals[i].b, 2)}.`);
  } else if (state.picks[i]) {
    state.picks[i] = null;
    announce('Interval cleared.');
  } else {
    announce('Pick up a shape first.');
    return;
  }
  state.checked = false;
  $('#verdict').innerHTML = '';
  const hadFocus = document.activeElement?.classList?.contains('sk-drop');
  render();
  // render() rebuilds the targets, so a keyboard user would lose their place.
  if (hadFocus) document.querySelector(`.sk-drop[data-iv="${i}"]`)?.focus();
}

/* ─────────────────────────────── dragging ──────────────────────────────── */

let ghost = null;
/** Was this shape already held when the gesture began? A tap then toggles it off. */
let heldBefore = false;
let dragFrom = { x: 0, y: 0 };

function startDrag(ev, id) {
  ev.preventDefault();
  heldBefore = state.held === id;
  dragFrom = { x: ev.clientX, y: ev.clientY };
  hold(id);
  ghost = document.createElement('div');
  ghost.className = 'sk-ghost';
  ghost.innerHTML = icon(byId(id).path, 'var(--ims-blue-text)', 3);
  document.body.appendChild(ghost);
  moveGhost(ev);
  window.addEventListener('pointermove', moveGhost);
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
}
function moveGhost(ev) {
  if (ghost) { ghost.style.left = `${ev.clientX}px`; ghost.style.top = `${ev.clientY}px`; }
}
function endDrag(ev) {
  window.removeEventListener('pointermove', moveGhost);
  window.removeEventListener('pointerup', endDrag);
  window.removeEventListener('pointercancel', endDrag);
  if (ghost) { ghost.remove(); ghost = null; }
  // elementFromPoint rather than a drop handler: the target is an SVG rect, and
  // HTML5 drag-and-drop on SVG is not reliable across browsers or on touch.
  const el = document.elementFromPoint(ev.clientX, ev.clientY);
  const iv = el && el.closest && el.closest('.sk-drop');
  if (iv) { place(Number(iv.getAttribute('data-iv'))); return; }
  // Not a drop. If the pointer barely moved it was a tap on the tile, which
  // picks the shape up — or puts it back down if it was already held.
  const moved = Math.hypot(ev.clientX - dragFrom.x, ev.clientY - dragFrom.y);
  if (moved < 6 && heldBefore) hold(null);
}

/* ────────────────────────────── checking ───────────────────────────────── */

function check() {
  const n = state.intervals.length;
  const missing = state.picks.filter(p => !p).length;
  if (missing) {
    $('#verdict').innerHTML = `<b>${missing} interval${missing > 1 ? 's' : ''}</b> still `
      + `${missing > 1 ? 'have' : 'has'} no shape.`;
    announce(`${missing} intervals still empty.`);
    return;
  }
  state.checked = true;

  const wrong = [];
  const contradictions = [];
  state.intervals.forEach((iv, i) => {
    const s = byId(state.picks[i]);
    if (!isRight(i)) wrong.push(i);
    if (s.up !== (iv.yb > iv.ya)) contradictions.push({ iv, s });
  });

  const parts = [];
  if (!wrong.length) {
    parts.push(`<span class="ll-verdict ok">✓ All ${n} intervals right.</span> `
      + `That sketch has the function's shape everywhere — only the heights between `
      + `the marked points are approximations.`);
  } else {
    parts.push(`<span class="ll-verdict bad">${n - wrong.length} of ${n} right.</span> `
      + `The wrong ones are outlined in red, in the graph and in the shape row.`);
  }
  for (const c of contradictions) {
    parts.push(`<br>On <b>${fmt(c.iv.a, 2)} to ${fmt(c.iv.b, 2)}</b> you chose `
      + `<b>${c.s.name}</b>, but you were given ${tex(`f(${fmt(c.iv.a, 2)}) = ${fmt(c.iv.ya, 2)}`)} `
      + `and ${tex(`f(${fmt(c.iv.b, 2)}) = ${fmt(c.iv.yb, 2)}`)} — it ends `
      + `${c.iv.yb > c.iv.ya ? 'higher' : 'lower'} than it starts, so it cannot be `
      + `${c.s.up ? 'rising' : 'falling'}. The shape and the numbers have to agree.`);
  }
  $('#verdict').innerHTML = parts.join('');
  announce(wrong.length ? `${n - wrong.length} of ${n} correct.` : 'All correct.', 120);
  render();
}

/* ────────────────────────────────── boot ───────────────────────────────── */

function rebuild() {
  if (!state.node) return;
  buildIntervals();
  const vals = state.intervals.length
    ? [state.intervals[0].a, ...state.intervals.map(iv => iv.b)] : [];
  $('#values').innerHTML = vals.length
    ? 'You are given: ' + vals.map(x => tex(`f(${fmt(x, 2)}) = ${fmt(state.f(x), 2)}`)).join('&nbsp; &nbsp;')
    : '';
  render();
}

initPage({
  onReady() {
    initShare({ mark: MARK });
    const q = getParams().raw;
    if (q.get('f')) $('#fn-input').value = q.get('f');
    if (q.get('window')) $('#win-input').value = q.get('window');

    renderPalette();
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
      hold(null);
      $('#verdict').innerHTML = '';
      render();
      announce('Cleared.', 100);
    });

    renderMathLabels(src => { const r = tryParse(src); return r.node ? toLatex(r.node) : null; });
    onBreakpointChange(() => { chart = null; render(); });
    onLayoutChange(() => { chart = null; render(); });
    afterLayout(() => { chart = null; render(); });
  },
});
