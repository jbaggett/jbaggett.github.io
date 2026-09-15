/**
 * Squeezing π — Archimedes' method of exhaustion, as a squeeze theorem.
 *
 * The port of a one-off "add sides" widget, with the change that makes it worth
 * generalising: the circle is bounded on BOTH sides. An inscribed polygon alone
 * shows a number climbing toward π, which is suggestive; a pair of bounds
 * closing on it is a proof, and it is the squeeze theorem's hypothesis in a
 * picture — two sequences with the same limit, and the thing you care about
 * trapped between them.
 *
 * THE SECOND LESSON IS THE SAME PICTURE. Write x = π/n for the half-wedge angle:
 *
 *     A_in  = π · cos(x) · sin(x)/x
 *     A_out = π · (sin(x)/x) / cos(x)
 *
 * so A_in ≤ π ≤ A_out says precisely cos x ≤ sin(x)/x ≤ 1/cos x. The limit
 * needed to differentiate sine is not an analogy to this figure, it IS this
 * figure, read one wedge at a time instead of all the way round. Both facts
 * come out of the same three areas: triangle inside, sector, triangle outside.
 *
 * π itself is withheld by default. The whole point is watching two numbers
 * close on something and being asked what it is.
 */

import { createChart, onBreakpointChange, onLayoutChange, afterLayout } from 'kit/chart.js';
import { initPage, announce, prefersReducedMotion, applyControls } from 'kit/page.js';
import { getParams, updateUrl } from 'kit/url.js';
import { tex, setTex } from 'kit/tex.js';
import { initShare } from 'kit/share.js';
import { initReveal, revealHidden } from 'kit/reveal.js';
import { fmt } from 'kit/format.js';
import { MARK } from '../../js/mark.js';

const $ = (/** @type {string} */ s) => /** @type {any} */ (document.querySelector(s));

/** His actual path: a hexagon, doubled four times, by hand. */
const DOUBLING = [6, 12, 24, 48, 96];

const PRESETS = {
  archimedes: { n: '96' },
  hexagon: { n: '6' },
  triangle: { n: '3' },
};

const state = { n: 6, wedge: true, showPi: false };

let chart = null;

/* ───────────────────────────── the two areas ───────────────────────────── */

/** Area of the regular n-gon inscribed in a unit circle. */
const inner = (/** @type {number} */ n) => (n / 2) * Math.sin((2 * Math.PI) / n);
/** Area of the regular n-gon circumscribed about a unit circle. */
const outer = (/** @type {number} */ n) => n * Math.tan(Math.PI / n);

/* ─────────────────────────────── the figure ────────────────────────────── */

function render() {
  const n = state.n;
  chart = chart || createChart('#fig', { height: 420, fit: true, label: 'placeholder' });

  const { width, height, margin } = chart;
  const cx = width / 2;
  const cy = height / 2;
  // The circumscribed polygon sticks out furthest at a vertex, by 1/cos(π/n),
  // so the radius is chosen to keep IT inside the box, not the circle.
  const room = Math.min(width - margin.left - margin.right, height - margin.top - margin.bottom) / 2;
  const R = room * Math.cos(Math.PI / Math.max(n, 3)) * 0.97;

  chart.plot.selectAll('*').remove();
  chart.gOver.selectAll('*').remove();

  const ring = (/** @type {number} */ r, /** @type {number} */ k) =>
    Array.from({ length: n }, (_, i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * (i + k)) / n;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    });

  const inPts = ring(R, 0);
  // The outer polygon is the inner one rotated half a step and scaled out, so
  // each of its sides touches the circle at exactly one point.
  const outPts = ring(R / Math.cos(Math.PI / n), 0.5);
  const path = (/** @type {number[][]} */ pts) => pts.map(p => p.join(',')).join(' ');

  chart.plot.append('polygon').attr('points', path(outPts))
    .attr('fill', 'none').attr('stroke', 'var(--curve-df)')
    .attr('stroke-width', 2).attr('stroke-dasharray', '7 4');
  chart.plot.append('polygon').attr('points', path(inPts))
    .attr('fill', 'var(--area-pos)').attr('stroke', 'var(--ims-blue-text)').attr('stroke-width', 2);
  chart.plot.append('circle').attr('cx', cx).attr('cy', cy).attr('r', R)
    .attr('fill', 'none').attr('stroke', 'var(--curve-f)').attr('stroke-width', 2.5);

  // Spokes fade out as n climbs: at 96 sides they would be a grey disc.
  const spokeOpacity = Math.max(0, 0.5 - n / 90);
  if (spokeOpacity > 0.02) {
    for (const [x, y] of inPts) {
      chart.plot.append('line').attr('x1', cx).attr('y1', cy).attr('x2', x).attr('y2', y)
        .attr('stroke', 'var(--ims-gray)').attr('stroke-width', 1).attr('opacity', spokeOpacity);
    }
  }

  if (state.wedge) drawWedge(cx, cy, R, n);

  const ai = inner(n), ao = outer(n);
  chart.setLabel(
    `A circle of radius 1 with a regular ${n}-sided polygon drawn inside it and `
    + `another drawn around it. The inside polygon has area ${fmt(ai, 5)}, the `
    + `outside one ${fmt(ao, 5)}, and the circle's area lies between them.`);

  updateText(n, ai, ao);
}

/**
 * One wedge, opened up: the triangle inside, the sector, the triangle outside.
 *
 * This is the whole sin(x)/x proof drawn at the size of a single slice, and it
 * is why the tool bothers highlighting anything — without it the figure shows
 * that π is trapped and says nothing about why sine behaves the way it does
 * near zero.
 */
function drawWedge(cx, cy, R, n) {
  // The HALF-wedge, not the whole one, and that is not a detail.
  //
  // The inscribed polygon's vertices and the circumscribed polygon's tangent
  // points coincide, but their wedge boundaries do not: an inner triangle spans
  // vertex to vertex, an outer triangle spans tangent point to tangent point,
  // half a step out of phase. Drawing a full wedge of each put two regions side
  // by side that were not comparable — they looked like a nested trio and were
  // not one.
  //
  // Cut at a vertex and go half a step instead. Now all three share the same
  // two radii, and with x = pi/n their areas are exactly
  //
  //     (1/2) sin x cos x   <=   (1/2) x   <=   (1/2) tan x
  //
  // which is the sin(x)/x inequality itself, drawn. Multiply by 2n and the same
  // three become A_in <= pi <= A_out.
  const x = Math.PI / n;
  const a0 = -Math.PI / 2;           // an inscribed vertex, and a tangent point
  const a1 = a0 + x;                 // half a step on
  const at = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];

  const T = at(R, a0);                 // the shared corner
  const E = at(R * Math.cos(x), a1);   // inscribed edge crossing the far radius
  const V = at(R / Math.cos(x), a1);   // circumscribed vertex on the far radius
  const S = at(R, a1);                 // the arc's far end

  const g = chart.gOver.append('g');
  g.append('path')
    .attr('d', `M${cx},${cy} L${T.join(',')} A${R},${R} 0 0 1 ${S.join(',')} Z`)
    .attr('fill', 'var(--curve-f)').attr('opacity', 0.22);
  g.append('polygon').attr('points', `${cx},${cy} ${T.join(',')} ${E.join(',')}`)
    .attr('fill', 'var(--ims-blue-text)').attr('opacity', 0.5);
  g.append('polygon').attr('points', `${cx},${cy} ${T.join(',')} ${V.join(',')}`)
    .attr('fill', 'none').attr('stroke', 'var(--curve-df)').attr('stroke-width', 2.5);
  g.append('line').attr('x1', cx).attr('y1', cy).attr('x2', V[0]).attr('y2', V[1])
    .attr('stroke', 'var(--curve-df)').attr('stroke-width', 1).attr('opacity', 0.6);
}

/* ────────────────────────────── the numbers ────────────────────────────── */

function updateText(n, ai, ao) {
  const x = Math.PI / n;
  // The caption names the figure; the numbers live once, in the working. Two
  // copies of the same bounds was the mistake already made and removed on the
  // secant tool's run label.
  setTex($('#fig-caption'), `n = ${n}`);

  // The working, in the evidence column: the bound pair, then the gap.
  $('#working').innerHTML = tex(
    `\\begin{aligned}`
    + `\\tfrac{n}{2}\\sin\\tfrac{2\\pi}{n} \\;&\\le\\; \\text{area} \\;\\le\\; n\\tan\\tfrac{\\pi}{n} \\\\[2pt]`
    + `${fmt(ai, 6)} \\;&\\le\\; \\text{area} \\;\\le\\; ${fmt(ao, 6)} \\\\[2pt]`
    + `\\text{gap} \\;&=\\; ${fmt(ao - ai, 6)}`
    + `\\end{aligned}`, { display: true });

  $('#tbl-body').innerHTML = DOUBLING.map(k => `
    <tr${k === n ? ' class="ll-row-current"' : ''}>
      <td>${k}</td><td>${fmt(inner(k), 5)}</td>
      <td>${fmt(outer(k), 5)}</td><td>${fmt(outer(k) - inner(k), 5)}</td>
    </tr>`).join('');

  $('#verdict').innerHTML = state.showPi
    ? `Both bounds are closing on <b>${tex('\\pi = 3.14159265\\ldots')}</b>, and at `
      + `<i>n</i> = ${n} the gap is down to <b>${fmt(ao - ai, 6)}</b>. `
      + `Neither polygon is ever the circle; together they leave it nowhere to go.`
    : `The two bounds are closing on the same number, and at <i>n</i> = ${n} they `
      + `already agree to <b>${agreementDigits(ai, ao)}</b>. <b>What number is it?</b>`;

  // The same figure, read one wedge at a time.
  $('#sinx').innerHTML =
    `<h3 style="margin-top:0">The same picture, one wedge at a time</h3>`
    + `<p>Cut a wedge in half and let ${tex(`x = \\tfrac{\\pi}{n} = ${fmt(x, 5)}`)}. `
    + `The three areas — triangle inside, sector, triangle outside — read off as `
    + `${tex('\\sin x\\cos x \\le x \\le \\tan x')}, and dividing by ${tex('\\sin x')} turns that into</p>`
    + tex(`\\cos x \\;\\le\\; \\frac{\\sin x}{x} \\;\\le\\; \\frac{1}{\\cos x}`, { display: true })
    + `<p>At <i>n</i> = ${n} that is `
    + `${tex(`${fmt(Math.cos(x), 6)} \\le ${fmt(Math.sin(x) / x, 6)} \\le ${fmt(1 / Math.cos(x), 6)}`)}. `
    + `Adding sides sends <i>x</i> to 0 and both ends to 1 — so `
    + `${tex('\\lim_{x\\to 0}\\tfrac{\\sin x}{x} = 1')}, which is the fact you need to `
    + `differentiate sine, proved by the figure above.</p>`;
}

/** How far the two bounds agree — the honest way to say "close" without saying π. */
function agreementDigits(a, b) {
  const sa = a.toFixed(8), sb = b.toFixed(8);
  let k = 0;
  while (k < sa.length && sa[k] === sb[k]) k++;
  const dot = sa.indexOf('.');
  const dp = k <= dot ? 0 : k - dot - 1;
  return dp === 0 ? 'the units digit' : `${dp} decimal place${dp === 1 ? '' : 's'}`;
}

/* ────────────────────────────── interaction ────────────────────────────── */

function setN(n, opts = {}) {
  state.n = Math.min(120, Math.max(3, Math.round(n)));
  $('#n-slider').value = String(state.n);
  $('#n-out').textContent = String(state.n);
  updateUrl({ n: state.n === 6 ? null : state.n });
  render();
  if (!opts.quiet) {
    announce(`${state.n} sides. Between ${fmt(inner(state.n), 4)} and ${fmt(outer(state.n), 4)}.`);
  }
}

let anim = null;
function stopAnim() {
  if (anim === null) return;
  cancelAnimationFrame(anim); clearInterval(anim); anim = null;
  $('#run-btn').textContent = '▶ Add sides';
  $('#run-btn').setAttribute('aria-pressed', 'false');
}
function startAnim() {
  stopAnim();
  $('#run-btn').textContent = '❚❚ Stop';
  $('#run-btn').setAttribute('aria-pressed', 'true');
  setN(3, { quiet: true });
  if (prefersReducedMotion()) {
    let i = 0;
    anim = setInterval(() => {
      i++; setN(DOUBLING[Math.min(i, DOUBLING.length - 1)], { quiet: true });
      if (i >= DOUBLING.length - 1) { stopAnim(); announce('96 sides — where Archimedes stopped.', 100); }
    }, 700);
    return;
  }
  const t0 = performance.now();
  const step = (/** @type {number} */ now) => {
    const t = Math.min(1, (now - t0) / 5000);
    // Eased so the early sides, where the picture changes most, are not a blur.
    setN(3 + 117 * t * t, { quiet: true });
    if (t < 1) anim = requestAnimationFrame(step);
    else { stopAnim(); announce('The gap has closed. Read the verdict below the table.', 100); }
  };
  anim = requestAnimationFrame(step);
}

/* ────────────────────────────────── boot ───────────────────────────────── */

initPage({
  onReady() {
    initShare({ mark: MARK });
    const q = getParams(PRESETS).raw;

    setTex($('#t1'), 'A_{\\text{in}} = \\tfrac{n}{2}\\sin\\tfrac{2\\pi}{n}');
    setTex($('#t2'), 'A_{\\text{out}} = n\\tan\\tfrac{\\pi}{n}');
    setTex($('#t3'), '3\\tfrac{10}{71} < \\pi < 3\\tfrac{1}{7}');
    setTex($('#t4'), 'x = \\tfrac{\\pi}{n}');
    setTex($('#t5'), '\\sin x\\cos x \\le x \\le \\tan x');
    setTex($('#t6'), '\\cos x \\le \\tfrac{\\sin x}{x} \\le \\tfrac{1}{\\cos x}');

    if (q.get('n')) state.n = Number(q.get('n')) || 6;
    state.wedge = q.get('wedge') !== 'false';
    $('#wedge-check').checked = state.wedge;

    // π is the answer, so it starts hidden: the point is watching two numbers
    // close on something and being asked what it is.
    const rev = initReveal({
      mount: $('#reveal-slot'),
      label: 'the answer',
      hidden: revealHidden(q, false),
      prompt: 'What are the bounds closing on?',
      onChange(shown) { state.showPi = shown; render(); },
    });
    state.showPi = rev.shown;

    $('#n-slider').addEventListener('input', e => { stopAnim(); setN(Number(e.target.value)); });
    $('#double-btn').addEventListener('click', () => { stopAnim(); setN(state.n * 2); });
    $('#halve-btn').addEventListener('click', () => { stopAnim(); setN(state.n / 2); });
    $('#run-btn').addEventListener('click', () => (anim === null ? startAnim() : stopAnim()));
    $('#wedge-check').addEventListener('change', e => {
      state.wedge = e.target.checked;
      updateUrl({ wedge: state.wedge ? null : 'false' });
      render();
    });

    document.addEventListener('keydown', e => {
      const t = /** @type {HTMLElement} */ (e.target);
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      if (e.key === ' ') { e.preventDefault(); anim === null ? startAnim() : stopAnim(); }
    });

    onBreakpointChange(() => { chart = null; render(); });
    onLayoutChange(() => { chart = null; render(); });
    afterLayout(() => { chart = null; render(); });

    applyControls(q.get('controls'), q.get('hide'));
    setN(state.n, { quiet: true });
  },
});
