/**
 * Sketch from Conditions — the canvas.
 *
 * All the meaning is in `js/sketch.js`; this is the drawing surface and the
 * hands. Two things it insists on:
 *
 *   - **Every handle is a real focusable element** with a spoken name, and the
 *     arrow keys do what a drag does. A tool whose only input is dragging is a
 *     tool some students cannot use at all.
 *   - **Positions snap to the grid.** Hunting for 3.0 with a mouse is not the
 *     skill being taught, and snapping is what lets the check be exact instead
 *     of forgiving-and-vague.
 */

import { createChart, makeScales, drawAxes, onLayoutChange } from 'kit/chart.js';
import { initPage, announce, applyControls } from 'kit/page.js';
import { getParams, updateUrl } from 'kit/url.js';
import { tex, setTex } from 'kit/tex.js';
import { initShare } from 'kit/share.js';
import { MARK } from '../js/mark.js';
import {
  parseConditions, blankSketch, checkConditions, conditionTex, GRID,
} from '../js/sketch.js';

const $ = (/** @type {string} */ s) => /** @type {any} */ (document.querySelector(s));
const snap = (/** @type {number} */ v) => Math.round(v / GRID) * GRID;
const clamp = (/** @type {number} */ v, /** @type {number} */ a, /** @type {number} */ b) =>
  Math.min(b, Math.max(a, v));

/**
 * Straight from Stewart's exercise sets — the shapes students actually meet.
 * The keys double as `?preset=`, which is what a QR code on a slide wants: the
 * spelled-out conditions run to ~90 percent-encoded characters.
 */
const PROBLEMS = {
  jump:       { label: 'a jump', c: 'lim(x->2-)=3; lim(x->2+)=-1; f(2)=1; lim(x->inf)=0' },
  removable:  { label: 'a hole', c: 'lim(x->1)=2; f(1)=undefined; f(3)=1' },
  infinite:   { label: 'an asymptote', c: 'lim(x->0-)=-inf; lim(x->0+)=inf; lim(x->inf)=1; lim(x->-inf)=1' },
  onesided:   { label: 'value off the limit', c: 'lim(x->-1)=2; f(-1)=-2; lim(x->3-)=0; lim(x->3+)=0; f(3)=0' },
  ends:       { label: 'both ends', c: 'lim(x->-inf)=-2; lim(x->inf)=3; f(0)=0; lim(x->2)=inf' },
};

const state = {
  /** @type {any[]} */ conds: [],
  /** @type {any} */ sk: null,
  /** @type {[number,number]} */ win: [-5, 5],
  /** @type {[number,number]} */ yWin: [-5, 5],
  /** @type {{kind:string, bi:number, pi?:number, site?:number}|null} */ sel: null,
  /** @type {{cond:any, ok:boolean, why:string}[]|null} */ marks: null,
  src: '',
};

let chart = null, xs = null, ys = null;

/* ─────────────────────────────── the problem ───────────────────────────── */

function load(src, { keepUrl = false } = {}) {
  const { conds, errors } = parseConditions(src);
  $('#cond-error').hidden = !errors.length;
  $('#cond-error').textContent = errors.join(' ');
  state.src = src;
  state.conds = conds;

  // The window has to contain every x the problem mentions, with room either
  // side — a site sitting on the frame cannot be drawn around.
  const sites = conds.filter(c => 'a' in c).map(c => c.a);
  const lo = Math.min(-5, ...sites.map(a => a - 3));
  const hi = Math.max(5, ...sites.map(a => a + 3));
  state.win = [Math.floor(lo), Math.ceil(hi)];
  state.yWin = [-5, 5];
  state.sk = blankSketch(conds, state.win);
  state.sel = null;
  state.marks = null;
  if (!keepUrl) updateUrl({ c: src });
  renderConds();
  draw();
  renderTools();
}

function renderConds() {
  const ul = $('#conds');
  ul.innerHTML = '';
  state.conds.forEach((c, i) => {
    const m = state.marks?.[i];
    const li = document.createElement('li');
    li.className = m ? (m.ok ? 'cond-ok' : 'cond-bad') : '';
    // A glyph, not just a colour — and the reason in words underneath.
    li.innerHTML = `<span class="cond-mark" aria-hidden="true">${m ? (m.ok ? '✓' : '✗') : '•'}</span>`
      + `<span>${tex(conditionTex(c), { displayStyle: true })}</span>`
      + (m && !m.ok ? `<span class="cond-why">${m.why}</span>` : '');
    ul.append(li);
  });
  const n = state.marks ? state.marks.filter(m => m.ok).length : 0;
  $('#tally').textContent = state.marks
    ? (n === state.conds.length
      ? `All ${n} conditions hold. That is one correct answer of infinitely many.`
      : `${n} of ${state.conds.length} conditions hold.`)
    : '';
}

/* ───────────────────────────────── drawing ─────────────────────────────── */

/** Where an endpoint is DRAWN — the window edge when that end runs off it. */
function drawnY(b, i) {
  const end = i === 0 ? b.left : i === b.pts.length - 1 ? b.right : null;
  if (end === 'up') return state.yWin[1];
  if (end === 'down') return state.yWin[0];
  return b.pts[i].y;
}

function branchPath(b) {
  // A monotone fit, so the curve cannot overshoot between handles and invent a
  // bump the student did not draw. An end marked as running off the screen is
  // drawn AT the edge: leaving it at its stored height put a flat line next to
  // a detached arrowhead, so the picture claimed the function was 0 just right
  // of the asymptote and unbounded there at the same time.
  const p = b.pts.map((q, i) => [xs(q.x), ys(drawnY(b, i))]);
  const offL = b.left === 'up' || b.left === 'down';
  const offR = b.right === 'up' || b.right === 'down';
  let d = `M${p[0][0]},${p[0][1]}`;
  for (let i = 0; i < p.length - 1; i++) {
    const [x0, y0] = p[i], [x1, y1] = p[i + 1];
    const dx = (x1 - x0) / 2;
    // At an end that runs off the screen the tangent is made VERTICAL, by
    // putting the control point directly above or below the endpoint. Arcing
    // over into the asymptote is what a curve with a finite limit looks like;
    // hugging it is the thing students have to learn to draw.
    const c1 = (i === 0 && offL) ? [x0, y0 + (y1 - y0) * 0.55] : [x0 + dx, y0];
    const c2 = (i === p.length - 2 && offR) ? [x1, y1 + (y0 - y1) * 0.55] : [x1 - dx, y1];
    d += `C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${x1},${y1}`;
  }
  return d;
}

function draw() {
  $('#fig').innerHTML = '';
  chart = createChart('#fig', { height: 380, label: describe() });
  const sc = makeScales(chart, state.win, state.yWin);
  xs = sc.xs; ys = sc.ys;
  drawAxes(chart, { xs, ys, xLabel: 'x', yLabel: 'y' });

  for (const a of state.sk.sites) {
    // A site where a branch runs off the screen IS a vertical asymptote, and it
    // is drawn as one — same weight and dash as the grapher uses, so the two
    // tools teach the same notation.
    const asym = state.sk.branches.some(b =>
      (b.x1 === a && (b.right === 'up' || b.right === 'down'))
      || (b.x0 === a && (b.left === 'up' || b.left === 'down')));
    chart.plot.append('line')
      .attr('x1', xs(a)).attr('x2', xs(a)).attr('y1', ys(state.yWin[1])).attr('y2', ys(state.yWin[0]))
      .attr('stroke', asym ? 'var(--ims-gray)' : 'var(--ims-lgray)')
      .attr('stroke-dasharray', asym ? '5 5' : '4 4')
      .attr('stroke-width', asym ? 1.5 : 1);
  }

  state.sk.branches.forEach((b, bi) => {
    const g = chart.plot.append('g').attr('class', b.drawn ? '' : 'sk-ghost');
    g.append('path').attr('d', branchPath(b)).attr('fill', 'none')
      .attr('stroke', 'var(--curve-f)').attr('stroke-width', b.drawn ? 2.5 : 1.6)
      .attr('stroke-dasharray', b.drawn ? null : '6 5');
    b.pts.forEach((_, pi) => {
      const end = pi === 0 ? b.left : pi === b.pts.length - 1 ? b.right : null;
      if (end === 'up' || end === 'down') arrowHandle(bi, pi, b, end);
      else handle(bi, pi, b);
    });
  });

  for (const [k, y] of Object.entries(state.sk.dots)) dot(Number(k), y);
}

/**
 * An end that runs off the screen. This is a HANDLE, not a decoration: the
 * first version drew the arrowhead and returned without making anything
 * focusable, so pressing "runs off the top" removed the only way back — no
 * click target to undo it, and nothing for Tab to reach at all.
 */
function arrowHandle(bi, pi, b, dir) {
  const pt = b.pts[pi];
  const tip = ys(dir === 'up' ? state.yWin[1] : state.yWin[0]);
  const back = tip + (dir === 'up' ? 18 : -18);
  const ref = { kind: 'end', bi, pi };
  chart.gOver.append('path')
    .attr('class', 'sk-handle')
    .attr('d', `M${xs(pt.x) - 7},${back}L${xs(pt.x)},${tip}L${xs(pt.x) + 7},${back}Z`)
    .attr('fill', 'var(--curve-f)').attr('stroke', 'var(--curve-f)').attr('stroke-width', 2)
    .attr('tabindex', 0).attr('role', 'button')
    .attr('aria-label', nameOf(bi, pi, b, state.sk.sites.includes(pt.x), dir))
    .on('pointerdown', ev => { ev.preventDefault(); select(ref); renderTools(); })
    .on('focus', () => select(ref))
    .on('keydown', ev => onKey(ev, ref));
}

function dot(a, y) {
  chart.gOver.append('circle')
    .attr('class', 'sk-handle').attr('tabindex', 0).attr('role', 'button')
    .attr('aria-label', `The value of f at x = ${a}, at height ${y}. Arrow keys move it.`)
    // The curve's colour, not a highlight: a solid dot at (2, 1) IS the
    // function's value there, and drawing it as something else would teach the
    // notation wrong. It is findable by being draggable and focusable.
    .attr('cx', xs(a)).attr('cy', ys(y)).attr('r', 6.5)
    .attr('fill', 'var(--curve-f)').attr('stroke', 'var(--curve-f)').attr('stroke-width', 2.2)
    .on('pointerdown', ev => startDrag(ev, { kind: 'dot', site: a }))
    .on('focus', () => select({ kind: 'dot', site: a }))
    .on('keydown', ev => onKey(ev, { kind: 'dot', site: a }));
}

/** An endpoint or an interior control point. */
function handle(bi, pi, b) {
  const pt = b.pts[pi];
  const isEnd = pi === 0 || pi === b.pts.length - 1;
  const atSite = isEnd && state.sk.sites.includes(pt.x);
  const end = pi === 0 ? b.left : b.right;
  if (isEnd && (end === 'up' || end === 'down')) return;      // the arrow stands in for it

  const ref = { kind: isEnd ? 'end' : 'mid', bi, pi };
  const sel = state.sel && state.sel.kind === ref.kind && state.sel.bi === bi && state.sel.pi === pi;

  const node = atSite
    ? chart.gOver.append('circle').attr('cx', xs(pt.x)).attr('cy', ys(pt.y)).attr('r', 6.5)
      .attr('fill', end === 'closed' ? 'var(--curve-f)' : '#fff')
      .attr('stroke', 'var(--curve-f)').attr('stroke-width', 2.2)
    : chart.gOver.append('rect').attr('x', xs(pt.x) - 4.5).attr('y', ys(pt.y) - 4.5)
      .attr('width', 9).attr('height', 9).attr('rx', 2)
      .attr('fill', sel ? 'var(--accent)' : '#fff')
      .attr('stroke', 'var(--accent)').attr('stroke-width', 2);

  node.attr('class', 'sk-handle').attr('tabindex', 0).attr('role', 'button')
    .attr('aria-label', nameOf(bi, pi, b, atSite, end))
    .on('pointerdown', ev => startDrag(ev, ref))
    .on('focus', () => select(ref))
    .on('keydown', ev => onKey(ev, ref));
}

function nameOf(bi, pi, b, atSite, end) {
  const pt = b.pts[pi];
  // Named from the SITE's point of view, not the piece's: the handle at the
  // start of the piece [2, 5] is what the function does approaching 2 from the
  // right, and calling it "the right-hand limit at 2" is both what it is and
  // the vocabulary the section is teaching.
  const kindWord = end === 'closed' ? 'solid' : end === 'open' ? 'hollow'
    : end === 'up' ? 'running off the top' : 'running off the bottom';
  const where = atSite
    ? `${pi === 0 ? 'Right' : 'Left'}-hand limit at x = ${pt.x}, ${kindWord}`
    : (pi === 0 || pi === b.pts.length - 1)
      ? `Far ${pi === 0 ? 'left' : 'right'} end of the graph`
      : `Shape handle on piece ${bi + 1}`;
  const off = end === 'up' || end === 'down';
  return `${where}${off ? '' : `, at height ${pt.y}`}.`
    + `${b.drawn ? '' : ' This piece is not drawn yet.'}`
    + `${off ? ' Use the tools below to bring it back on screen.' : ' Arrow keys move it.'}`;
}

/* ──────────────────────────── moving the handles ───────────────────────── */

function refPoint(ref) {
  if (ref.kind === 'dot') return null;
  return state.sk.branches[ref.bi].pts[ref.pi];
}

function moveTo(ref, x, y) {
  const yv = clamp(snap(y), state.yWin[0], state.yWin[1]);
  if (ref.kind === 'dot') { state.sk.dots[String(ref.site)] = yv; return; }
  const b = state.sk.branches[ref.bi];
  const pt = b.pts[ref.pi];
  b.drawn = true;                       // touching a piece is what draws it
  pt.y = yv;
  // Only interior handles move sideways, and only strictly between their
  // neighbours: an endpoint IS the site, and sliding it would change which
  // x the one-sided limit is about.
  if (ref.kind === 'mid' && x !== null) {
    const lo = b.pts[ref.pi - 1].x, hi = b.pts[ref.pi + 1].x;
    const step = (hi - lo) / 12;
    pt.x = clamp(snap(x), lo + step, hi - step);
  }
}

function startDrag(ev, ref) {
  ev.preventDefault();
  /** @type {Element} */ (ev.target).setPointerCapture?.(ev.pointerId);
  select(ref);
  const move = (e) => {
    const r = chart.svg.node().getBoundingClientRect();
    const vb = chart.svg.node().viewBox.baseVal;
    const px = ((e.clientX - r.left) / r.width) * vb.width;
    const py = ((e.clientY - r.top) / r.height) * vb.height;
    moveTo(ref, xs.invert(px), ys.invert(py));
    state.marks = null;
    draw(); renderConds(); renderTools();
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function onKey(ev, ref) {
  if (ref.kind === 'end') {
    const b0 = state.sk.branches[ref.bi];
    const e0 = ref.pi === 0 ? b0.left : b0.right;
    if (e0 === 'up' || e0 === 'down') return;   // no height to nudge at infinity
  }
  const pt = refPoint(ref);
  const y = ref.kind === 'dot' ? state.sk.dots[String(ref.site)] : pt.y;
  let dx = 0, dy = 0;
  if (ev.key === 'ArrowUp') dy = GRID;
  else if (ev.key === 'ArrowDown') dy = -GRID;
  else if (ev.key === 'ArrowRight') dx = GRID;
  else if (ev.key === 'ArrowLeft') dx = -GRID;
  else return;
  ev.preventDefault();
  moveTo(ref, pt && dx ? pt.x + dx : null, y + dy);
  state.marks = null;
  draw(); renderConds(); renderTools();
  refocus(ref);
  announce(`height ${ref.kind === 'dot' ? state.sk.dots[String(ref.site)] : refPoint(ref).y}`, 60);
}

/** Redrawing throws the focused node away; put focus back where it was. */
function refocus(ref) {
  const nodes = [...document.querySelectorAll('.sk-handle')];
  const want = ref.kind === 'dot'
    ? nodes.find(n => n.getAttribute('aria-label')?.startsWith(`The value of f at x = ${ref.site}`))
    : nodes.find(n => n.getAttribute('aria-label') === nameOfRef(ref));
  /** @type {any} */ (want)?.focus();
}

function nameOfRef(ref) {
  const b = state.sk.branches[ref.bi];
  const pt = b.pts[ref.pi];
  const isEnd = ref.pi === 0 || ref.pi === b.pts.length - 1;
  const atSite = isEnd && state.sk.sites.includes(pt.x);
  return nameOf(ref.bi, ref.pi, b, atSite, ref.pi === 0 ? b.left : b.right);
}

/* ─────────────────────────────── the toolbar ───────────────────────────── */

function select(ref) { state.sel = ref; renderTools(); }

function renderTools() {
  const bar = $('#tools');
  bar.innerHTML = '';
  const add = (label, fn, pressed) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label;
    if (pressed !== undefined) b.setAttribute('aria-pressed', String(pressed));
    b.addEventListener('click', () => { fn(); state.marks = null; draw(); renderConds(); renderTools(); });
    bar.append(b);
    return b;
  };

  const ref = state.sel;
  if (!ref) {
    bar.innerHTML = '<span class="ll-hint">Select a handle on the graph — click it, or Tab to it — '
      + 'and its options appear here.</span>';
    return;
  }

  if (ref.kind === 'end') {
    const b = state.sk.branches[ref.bi];
    const side = ref.pi === 0 ? 'left' : 'right';
    const pt = b.pts[ref.pi];
    if (!state.sk.sites.includes(pt.x)) {
      bar.innerHTML = '<span class="ll-hint">This is the far end of the graph. Drag it to set what '
        + 'the function does out there.</span>';
      return;
    }
    const set = (v) => () => { b[side] = v; b.drawn = true; };
    add('○ hollow', set('open'), b[side] === 'open');
    add('● solid', set('closed'), b[side] === 'closed');
    add('↑ runs off the top', set('up'), b[side] === 'up');
    add('↓ runs off the bottom', set('down'), b[side] === 'down');
    const note = document.createElement('span');
    note.className = 'll-hint';
    note.textContent = `The ${side === 'left' ? 'right' : 'left'}-hand limit at x = ${pt.x}. `
      + 'Hollow means the graph approaches this height without taking it.';
    bar.append(note);
    return;
  }

  if (ref.kind === 'mid') {
    bar.innerHTML = '<span class="ll-hint">A shape handle — drag it, or use the arrow keys, to bend '
      + 'this piece. It changes the shape, not any limit.</span>';
    return;
  }

  if (ref.kind === 'dot') {
    add('Remove this value', () => { delete state.sk.dots[String(ref.site)]; state.sel = null; });
    const note = document.createElement('span');
    note.className = 'll-hint';
    note.textContent = `f(${ref.site}) = ${state.sk.dots[String(ref.site)]}.`;
    bar.append(note);
  }
}

/** One "add a value here" button per site, always available. */
function renderSiteButtons() {
  const row = $('#picker');
  [...row.querySelectorAll('[data-site]')].forEach(n => n.remove());
  for (const a of state.sk.sites) {
    if (String(a) in state.sk.dots) continue;
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.site = String(a);
    b.textContent = `● add f(${a})`;
    b.addEventListener('click', () => {
      state.sk.dots[String(a)] = 0;
      state.marks = null;
      draw(); renderConds(); renderTools(); renderSiteButtons();
      announce(`A value at x = ${a} added, at height 0. Drag it.`);
    });
    row.append(b);
  }
}

function describe() {
  return 'Your sketch, drawn in pieces cut at '
    + (state.sk.sites.length ? `x = ${state.sk.sites.join(', ')}` : 'no interior points')
    + `, over x from ${state.win[0]} to ${state.win[1]}.`;
}

/* ────────────────────────────────── boot ───────────────────────────────── */

function check() {
  state.marks = checkConditions(state.sk, state.conds);
  renderConds();
  const n = state.marks.filter(m => m.ok).length;
  announce(n === state.conds.length
    ? 'All conditions hold.'
    : `${n} of ${state.conds.length} conditions hold. The ones that do not say why.`);
}

initPage({
  onReady() {
    initShare({ mark: MARK });
    const params = getParams(Object.fromEntries(
      Object.entries(PROBLEMS).map(([k, v]) => [k, { c: v.c }])));
    setTex($('#help-tex1'), '\\lim_{x \\to \\infty} f(x) = 0');

    for (const [key, p] of Object.entries(PROBLEMS)) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'preset'; b.textContent = p.label;
      b.addEventListener('click', () => {
        $('#own-input').value = p.c;
        load(p.c); renderSiteButtons();
      });
      $('#preset-row').append(b);
    }

    const start = params.raw.get('c') || PROBLEMS.jump.c;
    $('#own-input').value = start;
    load(start, { keepUrl: !params.raw.get('c') });
    renderSiteButtons();

    $('#check-btn').addEventListener('click', check);
    $('#reset-btn').addEventListener('click', () => { load(state.src); renderSiteButtons(); });
    $('#own-btn').addEventListener('click', () => { load($('#own-input').value); renderSiteButtons(); });

    document.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
      const t = /** @type {any} */ (e.target);
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); check(); }
    });

    applyControls(params.raw.get('controls'), params.raw.get('hide'));
    onLayoutChange(() => { draw(); renderTools(); });
  },
});
