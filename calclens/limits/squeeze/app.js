/**
 * Squeeze Theorem — the trap, closing.
 *
 * The misconception this targets is not the statement, which students can
 * recite, but what it *does*: they read it as a trick for evaluating g at a,
 * and are unsettled that g is never evaluated there at all. So the tool never
 * evaluates it there either. What moves is the WINDOW, and the conclusion is
 * read off the two neighbours.
 *
 * The second misconception is quieter and shows up on exams: students come away
 * believing the oscillation settles down. It does not — only the room for it
 * does. Hence the "rescale the vertical axis" box. With it off the wobble is
 * crushed flat; with it on, x² sin(1/x) is just as violent at δ = 0.001 as at
 * δ = 1. Both pictures are true and students need to have seen both.
 *
 * And the hypothesis is checked rather than assumed: bounds the student types
 * are verified to actually bound, and the verdict refuses to conclude when the
 * two bounds do not agree in the limit (the sin(1/x) preset).
 */

import { createChart, makeScales, drawAxes } from 'kit/chart.js';
import { drawCurve, autoYDomain, sampleCurve, linePath } from 'kit/curve.js';
import { initPage, announce, prefersReducedMotion } from 'kit/page.js';
import { getParams, updateUrl } from 'kit/url.js';
import { tex, setTex } from 'kit/tex.js';
import { fmt } from 'kit/format.js';
import { tryParse, compile } from '../../js/expr.js';

const $ = (/** @type {string} */ s) => /** @type {any} */ (document.querySelector(s));

const TABLE_D = [1, 0.5, 0.1, 0.01, 0.001, 0.0001];

const state = {
  /** @type {(x:number)=>number} */ g: () => NaN,
  /** @type {(x:number)=>number} */ lo: () => NaN,
  /** @type {(x:number)=>number} */ hi: () => NaN,
  a: 0,
  d: 0,              // log10 of the window half-width
  rescale: false,
  /** @type {[number,number]|null} the y window fixed at the opening view */
  yLock: null,
};

let chart = null;
const delta = () => Math.pow(10, state.d);

/* ─────────────────────────────── rendering ─────────────────────────────── */

function render() {
  const { g, lo, hi, a } = state;
  const d = delta();
  const x0 = a - d, x1 = a + d;

  chart = chart || createChart('#chart-main', { height: 340, label: 'placeholder' });

  // The vertical axis stays where it started unless asked otherwise. That is
  // what makes the trap visibly close instead of silently rescaling itself.
  if (!state.yLock) state.yLock = boundsDomain(a - 1, a + 1);
  const yDom = state.rescale ? boundsDomain(x0, x1) : state.yLock;

  const { xs, ys } = makeScales(chart, [x0, x1], yDom);
  drawAxes(chart, { xs, ys, xLabel: 'x', yLabel: 'y' });

  // The trap itself, drawn as one polygon per run where both bounds are finite.
  chart.plot.selectAll('path.ll-trap').remove();
  for (const run of bandRuns(lo, hi, x0, x1)) {
    const top = run.map(p => `${xs(p.x)},${ys(p.hi)}`).join(' L');
    const bottom = run.slice().reverse().map(p => `${xs(p.x)},${ys(p.lo)}`).join(' L');
    chart.plot.append('path').attr('class', 'll-trap')
      .attr('d', `M${top} L${bottom} Z`)
      .attr('fill', 'var(--area-pos)').attr('stroke', 'none');
  }

  chart.plot.selectAll('path.ll-curve, path.ll-bound-lo, path.ll-bound-hi').remove();
  // Distinct class names, not just distinct calls: drawCurve joins on
  // `path.<className>`, so two curves sharing one class means the second
  // silently replaces the first and only one bound ever appears.
  drawCurve(chart.plot, lo, { xs, ys, className: 'll-bound-lo', samples: 1400 });
  drawCurve(chart.plot, hi, { xs, ys, className: 'll-bound-hi', samples: 1400 });
  // g last and thickest — it is the one being talked about. A high sample count
  // matters here: sin(1/x) near 0 aliases badly at the default.
  drawCurve(chart.plot, g, { xs, ys, className: 'll-curve', samples: 2400 });

  chart.gOver.selectAll('*').remove();
  chart.gOver.append('line').attr('class', 'll-marker-line')
    .attr('x1', xs(a)).attr('x2', xs(a))
    .attr('y1', chart.margin.top).attr('y2', chart.height - chart.margin.bottom);
  chart.gOver.append('text')
    .attr('x', xs(a)).attr('y', chart.height - chart.margin.bottom - 5)
    .attr('text-anchor', 'middle').attr('font-style', 'italic').attr('font-size', 13)
    .attr('stroke', '#fff').attr('stroke-width', 3).attr('paint-order', 'stroke')
    .text('a');

  const L = limitOfBounds();
  if (L !== null && Number.isFinite(ys(L))) {
    // The open circle is the honest mark: this is where g is HEADING, and the
    // one place the theorem never looks.
    chart.gOver.append('circle')
      .attr('cx', xs(a)).attr('cy', ys(L)).attr('r', 5.5)
      .attr('fill', '#fff').attr('stroke', 'var(--curve-accum)').attr('stroke-width', 2.5);
  }

  chart.setLabel(
    `Graph over x from ${fmt(x0, 4)} to ${fmt(x1, 4)}. The shaded trap between the `
    + `bounds has width ${fmt(gapAt(d), 4)} at the window edge, with g inside it.`);

  updateReadout(d);
  updateTable();
  checkHypothesis(x0, x1);
}

/** A y-window that holds both bounds over a range, ignoring g's excursions. */
function boundsDomain(x0, x1) {
  const a = autoYDomain(state.lo, x0, x1, { minSpan: 0.5 });
  const b = autoYDomain(state.hi, x0, x1, { minSpan: 0.5 });
  return [Math.min(a[0], b[0]), Math.max(a[1], b[1])];
}

/** Contiguous runs where both bounds are finite, for filling the band. */
function bandRuns(lo, hi, x0, x1, steps = 500) {
  const runs = [];
  let run = [];
  for (let i = 0; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps;
    const l = lo(x), h = hi(x);
    if (!Number.isFinite(l) || !Number.isFinite(h)) {
      if (run.length > 1) runs.push(run);
      run = [];
      continue;
    }
    run.push({ x, lo: Math.min(l, h), hi: Math.max(l, h) });
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

const gapAt = (/** @type {number} */ d) =>
  Math.abs(state.hi(state.a + d) - state.lo(state.a + d));

/**
 * The common limit of the two bounds, or null when they do not agree.
 * Estimated from both sides at a very small offset — the bounds are the tame
 * functions, so this is safe in a way evaluating g never would be.
 */
function limitOfBounds() {
  const { a, lo, hi } = state;
  const eps = 1e-7;
  const vals = [lo(a + eps), hi(a + eps), lo(a - eps), hi(a - eps)];
  if (!vals.every(Number.isFinite)) return null;
  const spread = Math.max(...vals) - Math.min(...vals);
  const scale = Math.max(1, ...vals.map(Math.abs));
  return spread / scale < 1e-4 ? (vals.reduce((s, v) => s + v, 0) / 4) : null;
}

function updateReadout(d) {
  const { a, g, lo, hi } = state;
  const x = a + d;
  $('#d-out').textContent = fmt(d, d < 0.01 ? 5 : 3);
  $('#cap-x').innerHTML = `<i>x</i> = <i>a</i> + <i>δ</i>`;
  $('#readout').innerHTML = `
    <span><b>δ</b> ${fmt(d, d < 0.01 ? 5 : 3)}</span>
    <span><b>f(a+δ)</b> ${fmt(lo(x), 5)}</span>
    <span><b>g(a+δ)</b> ${fmt(g(x), 5)}</span>
    <span><b>h(a+δ)</b> ${fmt(hi(x), 5)}</span>
    <span><b>gap</b> ${fmt(gapAt(d), 5)}</span>`;
}

function updateTable() {
  const { a, lo, hi } = state;
  const rows = TABLE_D.map(d => ({
    d, lo: lo(a + d), hi: hi(a + d), gap: Math.abs(hi(a + d) - lo(a + d)),
  }));
  const cur = rows.reduce((b, r) =>
    Math.abs(Math.log10(r.d) - state.d) < Math.abs(Math.log10(b.d) - state.d) ? r : b);

  $('#table-body').innerHTML = rows.map(r => `
    <tr${r === cur ? ' class="ll-row-current"' : ''}>
      <td>${fmt(r.d, r.d < 0.01 ? 4 : 3)}</td>
      <td>${Number.isFinite(r.lo) ? fmt(r.lo, 6) : '—'}</td>
      <td>${Number.isFinite(r.hi) ? fmt(r.hi, 6) : '—'}</td>
      <td>${Number.isFinite(r.gap) ? fmt(r.gap, 6) : '—'}</td>
    </tr>`).join('');

  const L = limitOfBounds();
  const lastGap = rows[rows.length - 1].gap;
  if (L !== null) {
    $('#verdict').innerHTML =
      `The gap closes to ${fmt(lastGap, 6)}. Both bounds head for `
      + `<b>${fmt(L, 4)}</b>, so ${tex(`\\lim_{x \\to ${fmt(state.a, 2)}} g(x) = ${fmt(L, 4)}`)} `
      + `— <b>without ever evaluating <i>g</i> at ${fmt(state.a, 2)}</b>. That is the whole move.`;
  } else if (Number.isFinite(lastGap)) {
    $('#verdict').innerHTML =
      `<b class="ll-verdict bad">No conclusion.</b> The gap is still `
      + `<b>${fmt(lastGap, 4)}</b> at <i>δ</i> = 0.0001 and is not closing, so the two `
      + `bounds do not agree in the limit. <i>g</i> really is trapped between them — `
      + `that part is true — but a trap that never closes pins nothing down. `
      + `The theorem needs both hypotheses, and this is the one students drop.`;
  } else {
    $('#verdict').innerHTML = `The bounds are undefined near <i>x</i> = ${fmt(state.a, 2)}.`;
  }
}

/** Verify the bounds actually bound. Typed bounds are often simply wrong. */
function checkHypothesis(x0, x1) {
  const { g, lo, hi } = state;
  let bad = null, checked = 0;
  for (let i = 0; i <= 400; i++) {
    const x = x0 + ((x1 - x0) * i) / 400;
    const gv = g(x), l = lo(x), h = hi(x);
    if (![gv, l, h].every(Number.isFinite)) continue;
    checked++;
    const tol = 1e-9 * Math.max(1, Math.abs(gv));
    if (gv < Math.min(l, h) - tol || gv > Math.max(l, h) + tol) { bad = { x, gv, l, h }; break; }
  }
  const el = $('#hyp-warn');
  if (bad) {
    el.hidden = false;
    el.innerHTML = `The hypothesis fails: at <i>x</i> = ${fmt(bad.x, 4)}, `
      + `<i>g</i> = ${fmt(bad.gv, 4)} is outside [${fmt(Math.min(bad.l, bad.h), 4)}, `
      + `${fmt(Math.max(bad.l, bad.h), 4)}]. <i>g</i> is not trapped here, so the `
      + `theorem does not apply — whatever the picture suggests.`;
  } else {
    el.hidden = true;
  }
}

/* ──────────────────────────────── controls ─────────────────────────────── */

function setD(logD, opts = {}) {
  state.d = Math.min(0.3, Math.max(-3, logD));
  $('#d-slider').value = String(state.d);
  render();
  if (!opts.quiet) announce(`Delta is ${fmt(delta(), 5)}. Gap ${fmt(gapAt(delta()), 5)}.`);
}

let anim = null;
function stopAnim() {
  if (anim === null) return;
  cancelAnimationFrame(anim); clearInterval(anim); anim = null;
  $('#zoom-btn').textContent = '▶ Close the trap';
  $('#zoom-btn').setAttribute('aria-pressed', 'false');
}
function startAnim() {
  stopAnim();
  $('#zoom-btn').textContent = '❚❚ Stop';
  $('#zoom-btn').setAttribute('aria-pressed', 'true');
  const from = 0.3, to = -3;
  if (prefersReducedMotion()) {
    let i = 0;
    anim = setInterval(() => {
      i++; setD(from + ((to - from) * i) / 10, { quiet: true });
      if (i >= 10) { stopAnim(); announce('The trap has closed.', 100); }
    }, 420);
    return;
  }
  const t0 = performance.now();
  const step = (/** @type {number} */ now) => {
    const t = Math.min(1, (now - t0) / 4500);
    setD(from + (to - from) * t, { quiet: true });
    if (t < 1) anim = requestAnimationFrame(step);
    else { stopAnim(); announce('The trap has closed. Read the verdict below the table.', 100); }
  };
  anim = requestAnimationFrame(step);
}

function applyControls(/** @type {string|null} */ list) {
  if (!list) return;
  const keep = new Set(list.split(',').map(s => s.trim()).filter(Boolean));
  document.querySelectorAll('[data-control]').forEach(el => {
    if (!keep.has(/** @type {HTMLElement} */ (el).dataset.control)) {
      /** @type {HTMLElement} */ (el).hidden = true;
    }
  });
  document.querySelectorAll('.ll-panel').forEach(p => {
    const own = p.querySelectorAll('[data-control]').length;
    const live = [...p.querySelectorAll('[data-control]')].some(e => !(/** @type {HTMLElement} */ (e).hidden));
    if (own > 0 && !live) /** @type {HTMLElement} */ (p).hidden = true;
  });
}

/** Parse all three fields; report the first failure against its own input. */
function reparse() {
  const fields = [
    ['#g-input', 'g'], ['#lower-input', 'lo'], ['#upper-input', 'hi'],
  ];
  const err = $('#err');
  for (const [sel, key] of fields) {
    const res = tryParse($(sel).value);
    if (!res.node) {
      $(sel).setAttribute('aria-invalid', 'true');
      const src = $(sel).value;
      const caret = typeof res.pos === 'number' && res.pos < src.length
        ? ` (at "${src[res.pos]}", character ${res.pos + 1})` : '';
      err.textContent = `${sel === '#g-input' ? 'Squeezed function' : sel === '#lower-input' ? 'Lower bound' : 'Upper bound'}: ${res.error}${caret}`;
      err.hidden = false;
      return false;
    }
    $(sel).setAttribute('aria-invalid', 'false');
    state[key] = compile(res.node);
  }
  err.hidden = true;
  return true;
}

/* ────────────────────────────────── boot ───────────────────────────────── */

initPage({
  onReady() {
    const q = getParams().raw;
    if (q.get('g')) $('#g-input').value = q.get('g');
    if (q.get('lower')) $('#lower-input').value = q.get('lower');
    if (q.get('upper')) $('#upper-input').value = q.get('upper');
    if (q.get('a')) { state.a = Number(q.get('a')) || 0; $('#a-input').value = String(state.a); }
    if (q.get('delta')) state.d = Math.log10(Math.abs(Number(q.get('delta')) || 1));
    state.rescale = q.get('rescale') === 'true';
    $('#rescale').checked = state.rescale;

    setTex($('#t1'), 'f(x) \\le g(x) \\le h(x)');
    setTex($('#t2'), 'x^2\\sin(1/x)');

    const refresh = (/** @type {boolean} */ resetY = true) => {
      if (!reparse()) return;
      if (resetY) state.yLock = null;
      render();
    };

    for (const sel of ['#g-input', '#lower-input', '#upper-input']) {
      $(sel).addEventListener('change', () => {
        updateUrl({
          g: $('#g-input').value, lower: $('#lower-input').value, upper: $('#upper-input').value,
        });
        refresh();
      });
    }
    $('#a-input').addEventListener('input', () => {
      state.a = Number($('#a-input').value) || 0;
      updateUrl({ a: state.a });
      refresh();
    });
    document.querySelectorAll('.preset').forEach(b => b.addEventListener('click', () => {
      const d = /** @type {HTMLElement} */ (b).dataset;
      $('#g-input').value = d.g;
      $('#lower-input').value = d.lo;
      $('#upper-input').value = d.hi;
      $('#a-input').value = d.a;
      state.a = Number(d.a);
      state.d = 0;
      updateUrl({ g: d.g, lower: d.lo, upper: d.hi, a: d.a });
      refresh();
      setD(0, { quiet: true });
    }));

    $('#d-slider').addEventListener('input', e => { stopAnim(); setD(Number(e.target.value)); });
    $('#zoom-btn').addEventListener('click', () => (anim === null ? startAnim() : stopAnim()));
    $('#rescale').addEventListener('change', e => { state.rescale = e.target.checked; render(); });

    document.addEventListener('keydown', e => {
      const t = /** @type {HTMLElement} */ (e.target);
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      if (e.key === ' ') { e.preventDefault(); anim === null ? startAnim() : stopAnim(); }
    });

    applyControls(q.get('controls'));
    refresh();
    setD(state.d, { quiet: true });
  },
});
