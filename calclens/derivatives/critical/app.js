/**
 * Critical Numbers — what the simplifying was for.
 *
 * The page exists to make one claim visible: a derivative in the shape the
 * rules produce hides its critical numbers, and the factored form shows BOTH
 * kinds at once. The numerator's zeros are where f′ = 0; the denominator's are
 * where f′ fails to exist. Students remember the first kind and forget the
 * second, and no amount of saying so works as well as putting them in the same
 * expression where one is on top and the other underneath.
 *
 * The algebra that gets there is a toggle, not a fixture — by the time a
 * student is hunting critical numbers they may well be past wanting it spelled
 * out, and the same reasoning that gives Worked Derivative its own button
 * applies here.
 */

import { select } from 'd3-selection';
import { createChart, makeScales, drawAxes, onBreakpointChange } from 'kit/chart.js';
import { drawCurve, autoYDomain } from 'kit/curve.js';
import { initPage, applyControls, announce } from 'kit/page.js';
import { initWorking } from 'kit/working.js';
import { getParams, updateUrl } from 'kit/url.js';
import { setTex } from 'kit/tex.js';
import { initExpressionInput } from 'kit/input.js';
import { fmt } from 'kit/format.js';
import { initShare } from 'kit/share.js';
import { MARK } from '../../js/mark.js';

import { tryParse, compile, toLatex } from '../../js/expr.js';
import { criticalPoints } from '../../js/critical.js';
import { simplifySteps } from '../../js/factor-steps.js';

const $ = (/** @type {string} */ s) => /** @type {any} */ (document.querySelector(s));

/** Lecture links: content only, never presentation. */
const PRESETS = {
  cusp:       { f: 'x^(2/3)(x-4)' },
  fractional: { f: 'x^2(x-1)^(1/3)' },
  classic:    { f: 'x^3-3x' },
  noturn:     { f: 'x^3' },
  undefined_: { f: 'x+1/x' },
  none:       { f: 'x/sqrt(x+1)' },
};

let chart = createChart('#chart', { height: 300, label: 'The graph of f with its critical points marked' });
let work = null;
let showAlgebra = false;
/** @type {any} */ let current = null;
/** @type {any} */ let fNode = null;

/* ──────────────────────────────── the answer ───────────────────────────── */

function renderList(r) {
  const ul = $('#cn-list');
  ul.innerHTML = '';
  $('#cn-none').hidden = r.points.length > 0;
  if (!r.points.length) {
    $('#cn-none').textContent = 'This function has no critical numbers — there is no '
      + 'x in its domain where the derivative is zero or fails to exist.';
  }
  const TURN = {
    max: 'a local maximum', min: 'a local minimum',
    neither: 'neither — f ′ does not change sign here',
  };
  for (const p of r.points) {
    const li = document.createElement('li');
    li.className = p.kind === 'zero' ? 'cn-zero' : 'cn-undef';
    li.innerHTML = `<span class="cn-at">x = ${p.label}</span>`
      + `<span class="cn-why">${p.kind === 'zero'
        ? 'the numerator is zero here, so f ′ = 0'
        : 'the denominator is zero here, so f ′ does not exist'}</span>`
      + `<span class="cn-turn">${TURN[p.turn]}</span>`
      + (p.exact ? '' : '<span class="ll-hint">(found numerically)</span>');
    ul.appendChild(li);
  }
  $('#cn-warn').hidden = !r.domainWarnings.length;
  $('#cn-warn').textContent = r.domainWarnings[0] || '';
}

/** One column per interval, the critical numbers as the boundaries. */
function renderSignChart(r) {
  const body = $('#sign-chart tbody');
  body.innerHTML = '';
  if (!r.points.length) { $('#sign-chart').hidden = true; return; }
  $('#sign-chart').hidden = false;

  const head = document.createElement('tr');
  head.innerHTML = '<td class="cn-rowname">interval</td>'
    + r.intervals.map((iv, i) => {
      const left = i === 0 ? '' : r.points[i - 1].label;
      const right = i === r.intervals.length - 1 ? '' : r.points[i].label;
      return `<th scope="col">${left ? `${left} &lt; x` : 'x'}${right ? ` &lt; ${right}` : ''}</th>`;
    }).join('');
  body.appendChild(head);

  const signs = document.createElement('tr');
  signs.innerHTML = '<td class="cn-rowname">sign of <i>f</i> ′</td>'
    + r.intervals.map(iv => `<td class="${iv.sign > 0 ? 'cn-pos' : iv.sign < 0 ? 'cn-neg' : ''}">`
      + `${iv.sign > 0 ? '+' : iv.sign < 0 ? '−' : '?'}</td>`).join('');
  body.appendChild(signs);

  const shape = document.createElement('tr');
  shape.innerHTML = '<td class="cn-rowname"><i>f</i> is</td>'
    + r.intervals.map(iv => `<td>${iv.sign > 0 ? 'increasing ↗'
      : iv.sign < 0 ? 'decreasing ↘' : '—'}</td>`).join('');
  body.appendChild(shape);
}

function renderChart(r) {
  const f = compile(fNode, 'x');
  const xs0 = r.points.map(p => p.x);
  const span = xs0.length ? Math.max(1, (xs0[xs0.length - 1] - xs0[0]) || 2) : 2;
  const lo = (xs0.length ? xs0[0] : 0) - span;
  const hi = (xs0.length ? xs0[xs0.length - 1] : 0) + span;
  const yDom = autoYDomain(f, lo, hi, { minSpan: 1 });
  const { xs, ys } = makeScales(chart, [lo, hi], yDom);
  drawAxes(chart, { xs, ys, xLabel: 'x', yLabel: 'f(x)' });
  drawCurve(chart.plot, f, { xs, ys });

  chart.gOver.selectAll('*').remove();
  for (const p of r.points) {
    const y = f(p.x);
    if (!Number.isFinite(y)) continue;
    // Shape as well as colour: a zero of f′ is a disc, a point where f′ does
    // not exist is a ring. Two kinds of thing must not differ by hue alone.
    chart.gOver.append('circle')
      .attr('cx', xs(p.x)).attr('cy', ys(y)).attr('r', 5)
      .attr('fill', p.kind === 'zero' ? 'var(--ims-blue-text)' : '#fff')
      .attr('stroke', p.kind === 'zero' ? '#fff' : '#C05E10')
      .attr('stroke-width', 2.2);
    chart.gOver.append('text')
      .attr('x', xs(p.x)).attr('y', ys(y) - 10)
      .attr('text-anchor', 'middle')
      .attr('font-size', 11)
      .attr('fill', p.kind === 'zero' ? 'var(--ims-blue-text)' : '#C05E10')
      .attr('paint-order', 'stroke fill').attr('stroke', '#fff').attr('stroke-width', 3)
      .text(p.label);
  }
  chart.svg.attr('aria-label', `The graph of f with ${r.points.length} critical `
    + `point${r.points.length === 1 ? '' : 's'} marked.`);
}

function paintAlgebra() {
  $('#algebra').hidden = !showAlgebra;
  $('#algebra-btn').textContent = showAlgebra ? 'Hide the algebra' : 'Show the algebra';
  $('#algebra-hint').hidden = showAlgebra;
  if (!showAlgebra || !current) return;
  const steps = simplifySteps(current.deriv, 'x');
  work.set([
    { tex: toLatex(current.deriv), notes: [{ text: 'what the rules give', kind: 'transition' }] },
    ...steps,
  ], { openAll: true });
}

function rebuild(node, src) {
  fNode = node;
  current = criticalPoints(node, 'x');
  setTex($('#deriv-line'), `f'(x) = ${toLatex(current.factored)}`, { display: true });
  renderList(current);
  renderSignChart(current);
  renderChart(current);
  // Only offer the algebra when there is any: for 3x² there is nothing to show.
  $('[data-control="algebra"]').hidden = simplifySteps(current.deriv, 'x').length === 0;
  paintAlgebra();
  updateUrl({ f: src });
}

/* ────────────────────────────────── boot ───────────────────────────────── */

initPage({
  onReady() {
    initShare({ mark: MARK });
    const params = getParams(PRESETS);
    if (params.f) $('#fn-input').value = params.f;
    showAlgebra = ['true', '1', 'yes'].includes(String(params.raw.get('algebra')));

    setTex($('#help-tex1'),
      '2x\\left(x-1\\right)^{\\frac{1}{3}} + \\frac{x^{2}}{3\\left(x-1\\right)^{\\frac{2}{3}}}',
      { display: true });
    setTex($('#help-tex2'),
      '\\frac{x\\left(7x-6\\right)}{3\\left(x-1\\right)^{\\frac{2}{3}}}', { display: true });

    work = initWorking({ mount: $('#work-mount'), chain: true });
    work.setSuppressed(true);

    applyControls(params.raw.get('controls'), params.raw.get('hide'));

    initExpressionInput({
      input: $('#fn-input'),
      error: $('#fn-error'),
      preview: $('#fn-preview'),
      palette: $('#fn-palette'),
      parse: tryParse,
      format: toLatex,
      onChange: rebuild,
      onError: () => { $('#cn-list').innerHTML = ''; },
    });

    $('#algebra-btn').addEventListener('click', () => {
      showAlgebra = !showAlgebra;
      paintAlgebra();
      updateUrl({ algebra: showAlgebra ? 'true' : null });
      announce(showAlgebra ? 'The algebra is shown.' : 'The algebra is hidden.');
    });

    for (const b of document.querySelectorAll('.preset')) {
      b.addEventListener('click', () => { $('#fn-input').value = b.dataset.f; rebuild(tryParse(b.dataset.f).node, b.dataset.f); });
    }

    onBreakpointChange(() => {
      chart = createChart('#chart', { height: 300, label: 'The graph of f with its critical points marked' });
      if (current) renderChart(current);
    });
  },
});
