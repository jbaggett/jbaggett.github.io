/**
 * Secant to Tangent — the difference quotient, watched rather than asserted.
 *
 * This is the general form of the one-off applets that keep getting rebuilt per
 * lesson: P fixed, Q sliding in, the secant pivoting toward a limit. Making it
 * general costs a function box, a point box and a window box — which is exactly
 * the clutter a lecture slide does not want. So every one of those is
 * URL-suppressible via `controls=`, and a slide links the stripped version.
 *
 * Two deliberate choices:
 *
 *   h NEVER REACHES ZERO. The slider runs over log10|h|, so Q approaches P and
 *   never arrives. That is not a limitation to apologise for — h = 0 is exactly
 *   where the quotient is 0/0, and the slider refusing to go there is the point.
 *
 *   THE TANGENT IS OFF BY DEFAULT. Revealing the answer before students have
 *   guessed it wastes the only moment that teaches anything. `tangent=true`
 *   turns it on for the second pass.
 */

import { createChart, makeScales, drawAxes } from 'kit/chart.js';
import { drawCurve, autoYDomain } from 'kit/curve.js';
import { initPage, announce, prefersReducedMotion } from 'kit/page.js';
import { getParams, updateUrl } from 'kit/url.js';
import { tex, setTex, renderMathLabels } from 'kit/tex.js';
import { initExpressionInput } from 'kit/input.js';
import { fmt } from 'kit/format.js';
import { initShare } from 'kit/share.js';
import { MARK } from '../../js/mark.js';

import { tryParse, compile, derivative, freeVariables, toLatex } from '../../js/expr.js';


/**
 * Named starting states, for short links. Content only — a slide adds
 * `&embed=true&controls=...` itself, so one preset serves both the projected
 * figure and the phone a student opens from a QR code.
 */
const PRESETS = {
  ball: { f: '-16t^2 + 32t + 48', a: '0.5', window: '0,2' },
  sq: { f: 'x^2', a: '1', window: '-1,3' },
  corner: { f: 'abs(x)', a: '0', window: '-2,2' },
  root: { f: 'sqrt(x)', a: '1', window: '0,4' },
};

const $ = (/** @type {string} */ s) => /** @type {any} */ (document.querySelector(s));

/** Fixed rows, so the convergence pattern is legible before anyone touches a slider. */
const TABLE_H = [1, 0.5, 0.1, 0.01, 0.001, 0.0001];

const state = {
  node: null,
  dNode: null,
  /** @type {(x:number)=>number} */ f: () => NaN,
  /** @type {(x:number)=>number} */ df: () => NaN,
  v: 'x',          // the variable's name — the ball problem wants t, not x
  a: 1,
  h: 0,            // log10 of the gap: 0 means h = 1
  side: 1,         // +1 from the right, -1 from the left
  x0: -1,
  x1: 3,
  showTangent: false,
  /** @type {[number,number]|null} explicit y window from ?y=lo,hi */ yWin: null,
};

let chart = null;

/* ─────────────────────────────── rendering ─────────────────────────────── */

function render() {
  const { f, df, a, x0, x1 } = state;
  const h = signedH();
  const q = a + h;
  const fa = f(a), fq = f(q);
  const slope = (fq - fa) / h;
  const exact = df(a);

  chart = chart || createChart('#chart-f', { height: 320, label: 'placeholder' });
  const yDom = state.yWin || autoYDomain(f, x0, x1, { minSpan: 2 });
  const { xs, ys } = makeScales(chart, [x0, x1], yDom);
  drawAxes(chart, { xs, ys, xLabel: state.v, yLabel: `f(${state.v})` });
  drawCurve(chart.plot, f, { xs, ys });

  chart.gOver.selectAll('*').remove();
  const inView = (/** @type {number} */ x) => x >= x0 && x <= x1;

  // Tangent underneath, so the secant visibly sits apart from it until h is small.
  if (state.showTangent && Number.isFinite(exact) && Number.isFinite(fa)) {
    const half = (x1 - x0) * 0.45;
    chart.gOver.append('line')
      .attr('stroke', 'var(--curve-df)').attr('stroke-width', 2.5)
      .attr('x1', xs(a - half)).attr('y1', ys(fa - exact * half))
      .attr('x2', xs(a + half)).attr('y2', ys(fa + exact * half));
  }

  if (Number.isFinite(fa) && Number.isFinite(fq)) {
    // Extend the secant past both points so it reads as a line, not a segment.
    const ext = (x1 - x0) * 0.35;
    const at = (/** @type {number} */ x) => fa + slope * (x - a);
    chart.gOver.append('line').attr('class', 'll-secant')
      .attr('x1', xs(Math.max(x0, Math.min(a, q) - ext)))
      .attr('y1', ys(at(Math.max(x0, Math.min(a, q) - ext))))
      .attr('x2', xs(Math.min(x1, Math.max(a, q) + ext)))
      .attr('y2', ys(at(Math.min(x1, Math.max(a, q) + ext))));

    // Rise over run, drawn: the difference quotient as a picture.
    chart.gOver.append('path')
      .attr('d', `M${xs(a)},${ys(fa)} L${xs(q)},${ys(fa)} L${xs(q)},${ys(fq)}`)
      .attr('fill', 'none').attr('stroke', 'var(--tangent)')
      .attr('stroke-width', 1).attr('stroke-dasharray', '3 3').attr('opacity', 0.8);
    if (Math.abs(xs(q) - xs(a)) > 26) {
      // The run line sits at f(a). When that is near y = 0 the label would land
      // on the x-axis tick numbers, and a white halo is not enough to make two
      // overlapping strings readable — so move it to the other side instead.
      const runY = ys(fa);
      const clash = Math.abs(runY - ys(0)) < 18;
      chart.gOver.append('text')
        .attr('x', (xs(a) + xs(q)) / 2)
        .attr('y', runY + (clash ? -9 : 16))
        .attr('text-anchor', 'middle').attr('font-size', 12).attr('fill', 'var(--tangent)')
        .attr('stroke', '#fff').attr('stroke-width', 3).attr('paint-order', 'stroke')
        .text(`h = ${fmt(h, Math.abs(h) < 0.01 ? 4 : 3)}`);
    }
  }

  // P is the anchor and Q is the one that moves, and that has to be legible
  // BEFORE the reader tries to drag: P is a plain dark dot inside a thin ring,
  // Q is a coloured dot inside a soft halo with a grab cursor. Shape, colour
  // and cursor all three, because any one of them alone excludes somebody.
  if (Number.isFinite(fa) && inView(a)) {
    drawHandle({
      key: 'P', x: a, y: fa, xs, anchor: true,
      label: 'Point P, the fixed point',
      valuetext: `P at ${state.v} = ${fmt(a, 3)}`,
      min: x0, max: x1, now: a,
      cx: xs(a), cy: ys(fa),
      onMove: nx => setA(nx),
      onKey: dir => setA(a + (dir * (x1 - x0)) / 50),
    });
  }
  if (Number.isFinite(fq) && inView(q)) {
    drawHandle({
      key: 'Q', x: q, y: fq, xs, anchor: false,
      label: 'Point Q, drag toward P',
      valuetext: `Q at ${state.v} = ${fmt(q, 4)}, gap h = ${fmt(h, 4)}`,
      min: -4, max: 0.3, now: state.h,
      cx: xs(q), cy: ys(fq),
      onMove: nx => setQ(nx),
      // Arrows step in the SAME logarithmic space as the slider, so a keyboard
      // user closes the gap at the rate a dragging one does — and can always
      // get closer, which linear steps would not allow.
      onKey: dir => { stopAnim(); setH(state.h + dir * 0.1); },
    });
  }

  chart.setLabel(
    `Graph of the function with P fixed at ${state.v} = ${fmt(a, 2)} and Q at `
    + `${fmt(q, 3)}. The secant through them has slope ${fmt(slope, 3)}.`);

  updateReadout(h, q, fa, fq, slope, exact);
  updateTable();
}

function updateReadout(h, q, fa, fq, slope, exact) {
  const v = state.v;
  $('#readout').innerHTML = `
    <span><b>h</b> ${fmt(h, Math.abs(h) < 0.01 ? 5 : 3)}</span>
    <span><b>rise</b> ${fmt(fq - fa, 4)}</span>
    <span><b>run</b> ${fmt(h, Math.abs(h) < 0.01 ? 5 : 3)}</span>
    <span><b>slope of PQ</b> ${fmt(slope, 4)}</span>`
    + (state.showTangent ? `<span><b>f&nbsp;′(${fmt(state.a, 2)})</b> ${fmt(exact, 4)}</span>` : '');

  $('#q-pos').textContent = fmt(q, Math.abs(h) < 0.01 ? 4 : 3);
  $('#h-out').textContent = fmt(h, Math.abs(h) < 0.01 ? 5 : 3);
  document.querySelectorAll('.varname').forEach(el => { el.textContent = v; });
}

/** The table is the argument: two columns of numbers walking to the same place. */
function updateTable() {
  const { f, a, v } = state;
  const fa = f(a);
  const rows = TABLE_H.map(mag => {
    const h = mag * state.side;
    const slope = (f(a + h) - fa) / h;
    return { h, q: a + h, slope };
  });
  const near = rows.reduce((b, r) =>
    Math.abs(Math.log10(Math.abs(r.h)) - Math.log10(Math.abs(signedH()))) <
    Math.abs(Math.log10(Math.abs(b.h)) - Math.log10(Math.abs(signedH()))) ? r : b);

  $('#table-body').innerHTML = rows.map(r => `
    <tr${r === near ? ' class="ll-row-current"' : ''}>
      <td>${r.h > 0 ? '' : '−'}${fmt(Math.abs(r.h), Math.abs(r.h) < 0.01 ? 4 : 3)}</td>
      <td>${fmt(r.q, 4)}</td>
      <td>${Number.isFinite(r.slope) ? fmt(r.slope, 5) : 'undefined'}</td>
    </tr>`).join('');

  $('#table-caption').innerHTML =
    `Slope of the secant as <i>h</i> shrinks, approaching <i>P</i> `
    + `<b>from the ${state.side > 0 ? 'right' : 'left'}</b>`;

  // Say what the numbers are doing, without naming the limit unless asked.
  const last = rows[rows.length - 1].slope;
  const exact = state.df(a);
  if (!Number.isFinite(last)) {
    $('#verdict').innerHTML = `The quotient is undefined near <i>${v}</i> = ${fmt(a, 2)} on this side.`;
  } else if (Number.isFinite(exact) && Math.abs(last - exact) < 1e-3 * Math.max(1, Math.abs(exact))) {
    $('#verdict').innerHTML = state.showTangent
      ? `The slopes are converging on <b>${fmt(exact, 4)}</b>, which is `
        + `${tex(`f'(${fmt(a, 2)})`)} — the slope of the tangent line drawn above.`
      : `The slopes are settling down. What number are they heading for? `
        + `<span class="ll-hint">(Tick <b>Show the tangent</b> when you are ready.)</span>`;
  } else {
    // Includes |x| at 0, where the two sides disagree and there is no derivative.
    const otherH = -rows[rows.length - 1].h;
    const other = (f(a + otherH) - fa) / otherH;
    $('#verdict').innerHTML =
      `From this side the slopes head for <b>${fmt(last, 4)}</b>`
      + (Number.isFinite(other) && Math.abs(other - last) > 1e-6
        ? `, but from the other side they head for <b>${fmt(other, 4)}</b>. `
          + `The two do not agree, so there is <b>no tangent line</b> at `
          + `<i>${v}</i> = ${fmt(a, 2)} and the derivative does not exist there.`
        : '.');
  }
}

/* ──────────────────────────────── controls ─────────────────────────────── */

/**
 * Dragging is tracked on the WINDOW, not on the handle.
 *
 * The handle cannot own its own drag: every move re-renders the chart, which
 * destroys and recreates the very element holding the pointer capture, so the
 * second `pointermove` lands on a node that is no longer in the document and
 * the drag dies after one pixel. Listening on the window survives the redraw.
 *
 * @type {{xs:any, onMove:(x:number)=>void}|null}
 */
let dragging = null;

function onWindowDrag(/** @type {PointerEvent} */ ev) {
  if (!dragging) return;
  ev.preventDefault();
  const box = chart.svg.node().getBoundingClientRect();
  dragging.onMove(dragging.xs.invert(((ev.clientX - box.left) / box.width) * chart.width));
}

function endDrag() {
  dragging = null;
  window.removeEventListener('pointermove', onWindowDrag);
  window.removeEventListener('pointerup', endDrag);
  window.removeEventListener('pointercancel', endDrag);
}

function beginDrag(xs, onMove) {
  dragging = { xs, onMove };
  window.addEventListener('pointermove', onWindowDrag, { passive: false });
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
}

/**
 * A draggable, focusable point on the curve.
 *
 * The visible dot stays small so it does not hide the curve beneath it, but the
 * hit area is 44px — the touch-target minimum, and also what makes it grabbable
 * with a mouse. `role="slider"` is the correct ARIA for a handle that moves
 * along one axis: it gives screen-reader users arrow keys and a spoken value,
 * which a bare draggable circle does not.
 */
function drawHandle(o) {
  const g = chart.gOver.append('g')
    .attr('class', 'll-grab')
    .attr('tabindex', 0)
    .attr('role', 'slider')
    .attr('aria-label', o.label)
    .attr('aria-valuemin', o.min)
    .attr('aria-valuemax', o.max)
    .attr('aria-valuenow', o.now)
    .attr('aria-valuetext', o.valuetext);

  const { cx, cy } = o;
  g.append('circle').attr('class', 'll-grab-hit').attr('cx', cx).attr('cy', cy).attr('r', 22);
  if (o.anchor) {
    g.append('circle').attr('class', 'll-point-anchor-ring').attr('cx', cx).attr('cy', cy).attr('r', 11);
    g.append('circle').attr('class', 'll-point-anchor').attr('cx', cx).attr('cy', cy).attr('r', 6.5);
  } else {
    g.append('circle').attr('class', 'll-point-halo').attr('cx', cx).attr('cy', cy).attr('r', 12);
    g.append('circle').attr('class', 'll-point-move').attr('cx', cx).attr('cy', cy).attr('r', 6);
  }
  g.append('text')
    .attr('x', cx + 13).attr('y', cy - 11).attr('font-size', 13).attr('font-style', 'italic')
    .attr('stroke', '#fff').attr('stroke-width', 3).attr('paint-order', 'stroke')
    .attr('fill', o.anchor ? '#222' : 'var(--tangent)')
    .text(o.key);

  const node = g.node();
  node.addEventListener('pointerdown', ev => {
    ev.preventDefault(); ev.stopPropagation(); stopAnim();
    beginDrag(o.xs, o.onMove);
    node.focus?.();
  });
  node.addEventListener('keydown', ev => {
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') { ev.preventDefault(); o.onKey(-1); }
    else if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') { ev.preventDefault(); o.onKey(1); }
  });
  return g;
}

/** Move P. The gap keeps its size, so the picture re-anchors rather than jumping. */
function setA(nx) {
  state.a = Math.min(state.x1, Math.max(state.x0, nx));
  $('#a-input').value = String(Number(state.a.toFixed(4)));
  updateUrl({ a: Number(state.a.toFixed(4)) });
  render();
  announce(`P moved to ${state.v} = ${fmt(state.a, 3)}.`);
}

/**
 * Move Q by dragging it. Dragging THROUGH P flips which side the approach comes
 * from — the cheapest way to discover that a two-sided limit has two sides.
 */
function setQ(qx) {
  const raw = qx - state.a;
  const side = raw < 0 ? -1 : 1;
  // |h| is clamped to the slider's own range. The lower clamp is not cosmetic:
  // h = 0 is where the quotient is 0/0, and Q must never land on P.
  const mag = Math.min(Math.pow(10, 0.3), Math.max(1e-4, Math.abs(raw)));
  if (side !== state.side) setSide(side);
  state.side = side;
  setH(Math.log10(mag));
}

/** The slider is log10|h|: every arrow key is a proportional step, and 0 is unreachable. */
function signedH() {
  return state.side * Math.pow(10, state.h);
}

function setH(logH, opts = {}) {
  state.h = Math.min(0.3, Math.max(-4, logH));
  $('#h-slider').value = String(state.h);
  render();
  if (!opts.quiet) {
    const h = signedH();
    announce(`h is ${fmt(h, 4)}. Secant slope ${fmt((state.f(state.a + h) - state.f(state.a)) / h, 3)}.`);
  }
}

function setSide(side) {
  state.side = side;
  $('#side-right').setAttribute('aria-pressed', String(side > 0));
  $('#side-left').setAttribute('aria-pressed', String(side < 0));
  updateUrl({ side: side > 0 ? null : 'left' });
  render();
}

let anim = null;
function stopAnim() {
  if (anim === null) return;
  cancelAnimationFrame(anim); clearInterval(anim); anim = null;
  $('#close-btn').textContent = '▶ Close the gap';
  $('#close-btn').setAttribute('aria-pressed', 'false');
}
function startAnim() {
  stopAnim();
  $('#close-btn').textContent = '❚❚ Stop';
  $('#close-btn').setAttribute('aria-pressed', 'true');
  const from = 0.3, to = -4;
  if (prefersReducedMotion()) {
    let i = 0;
    anim = setInterval(() => {
      i++; setH(from + ((to - from) * i) / 10, { quiet: true });
      if (i >= 10) { stopAnim(); announce('Gap closed.', 100); }
    }, 420);
    return;
  }
  const t0 = performance.now();
  const step = (/** @type {number} */ now) => {
    const t = Math.min(1, (now - t0) / 4500);
    setH(from + (to - from) * t, { quiet: true });
    if (t < 1) anim = requestAnimationFrame(step);
    else { stopAnim(); announce('Gap closed. Read the slope off the table.', 100); }
  };
  anim = requestAnimationFrame(step);
}

/**
 * Hide the controls a slide does not want. `controls=h` leaves the h slider and
 * the table and takes everything else away, which is the lecture-figure form.
 */
function applyControls(/** @type {string|null} */ list) {
  if (!list) return;
  const keep = new Set(list.split(',').map(s => s.trim()).filter(Boolean));
  document.querySelectorAll('[data-control]').forEach(el => {
    const name = /** @type {HTMLElement} */ (el).dataset.control;
    if (!keep.has(name)) /** @type {HTMLElement} */ (el).hidden = true;
  });
  // A panel emptied of every control should not leave a bare box behind.
  document.querySelectorAll('.ll-panel').forEach(p => {
    const live = [...p.querySelectorAll('[data-control]')].some(e => !(/** @type {HTMLElement} */ (e).hidden));
    const own = p.querySelectorAll('[data-control]').length;
    if (own > 0 && !live) /** @type {HTMLElement} */ (p).hidden = true;
  });
}

/**
 * Take on a parsed expression, working in whatever letter it was written in.
 *
 * `?var=` used to be the only way to say "this problem is in t", which made
 * `f=-16x^2+32x+48&var=t` compile against a variable the expression never
 * mentions and quietly produce NaN everywhere. The expression itself is the
 * authority now; `?var` only names the letter when there is none to find.
 */
function adopt(node) {
  const vars = [...freeVariables(node)];
  if (vars.length === 1) state.v = vars[0];
  else if (vars.length > 1) state.v = vars.includes('x') ? 'x' : vars[0];
  state.node = node;
  state.dNode = derivative(node, state.v);
  state.f = compile(node, state.v);
  state.df = compile(state.dNode, state.v);
  setTex($('#help-tex1'), `\\frac{f(${state.v}_0+h)-f(${state.v}_0)}{h}`);
  setTex($('#help-tex2'), `f'(${state.v}_0)`);
}

function reparse() {
  const res = tryParse($('#fn-input').value);
  if (res.node) adopt(res.node);
}

/* ────────────────────────────────── boot ───────────────────────────────── */

initPage({
  onReady() {
    initShare({ mark: MARK });
    const p = getParams(PRESETS);
    const q = p.raw;

    if (q.get('var')) state.v = q.get('var').slice(0, 1);
    if (p.f) $('#fn-input').value = p.f;
    if (p.a !== null) { state.a = p.a; $('#a-input').value = String(p.a); }
    if (q.get('window')) $('#win-input').value = q.get('window');
    if (q.get('h')) state.h = Math.log10(Math.abs(Number(q.get('h')) || 1));
    if (q.get('side') === 'left') state.side = -1;
    if (q.get('y')) {
      const yp = q.get('y').split(',').map(Number);
      if (yp.length === 2 && yp.every(Number.isFinite) && yp[1] > yp[0]) state.yWin = [yp[0], yp[1]];
    }
    state.showTangent = q.get('tangent') === 'true';
    $('#show-tangent').checked = state.showTangent;

    setTex($('#help-tex1'), `\\frac{f(${state.v}_0+h)-f(${state.v}_0)}{h}`);
    setTex($('#help-tex2'), `f'(${state.v}_0)`);

    const readWindow = () => {
      const parts = String($('#win-input').value).split(',').map(Number);
      if (parts.length === 2 && parts.every(Number.isFinite) && parts[1] > parts[0]) {
        [state.x0, state.x1] = parts;
      }
    };
    readWindow();

    initExpressionInput({
      input: $('#fn-input'),
      error: $('#fn-error'),
      parse: (src) => tryParse(src),
      preview: $('#fn-preview'),
      format: toLatex,
      palette: $('#fn-palette'),
      onChange(node, src) {
        adopt(node);
        updateUrl({ f: src });
        render();
      },
    });

    document.querySelectorAll('.preset').forEach(b => b.addEventListener('click', () => {
      const d = /** @type {HTMLElement} */ (b).dataset;
      state.v = d.var || 'x';
      $('#a-input').value = d.a;
      $('#win-input').value = d.win;
      state.a = Number(d.a);
      readWindow();
      updateUrl({ a: d.a, window: d.win, var: d.var || null });
      $('#fn-input').value = d.f;
      $('#fn-input').dispatchEvent(new Event('change'));
    }));

    $('#a-input').addEventListener('input', () => {
      state.a = Number($('#a-input').value) || 0;
      updateUrl({ a: state.a });
      render();
    });
    $('#win-input').addEventListener('change', () => { readWindow(); updateUrl({ window: $('#win-input').value }); render(); });
    $('#h-slider').addEventListener('input', e => { stopAnim(); setH(Number(e.target.value)); });
    $('#side-right').addEventListener('click', () => setSide(1));
    $('#side-left').addEventListener('click', () => setSide(-1));
    $('#close-btn').addEventListener('click', () => (anim === null ? startAnim() : stopAnim()));
    $('#show-tangent').addEventListener('change', e => {
      state.showTangent = e.target.checked;
      updateUrl({ tangent: state.showTangent ? 'true' : null });
      render();
    });

    document.addEventListener('keydown', e => {
      const t = /** @type {HTMLElement} */ (e.target);
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      if (e.key === ' ') { e.preventDefault(); anim === null ? startAnim() : stopAnim(); }
    });


    // Preset labels are typeset from the very expression they insert, so the
    // notation can never disagree with the maths — a literal "√x" in HTML shows
    // a radical that does not extend over its argument.
    renderMathLabels(src => { const r = tryParse(src); return r.node ? toLatex(r.node) : null; });

    applyControls(q.get('controls'));
    reparse();
    $('#h-slider').value = String(state.h);
    setSide(state.side);
    setH(state.h, { quiet: true });
  },
});
