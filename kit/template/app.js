/**
 * TOOL NAME — one paragraph on the misconception this targets and the single
 * move that breaks it. Write this before the code; if it cannot be written,
 * the tool does not have a point yet.
 */

import { createChart, makeScales, drawAxes } from 'kit/chart.js';
import { drawCurve, autoYDomain } from 'kit/curve.js';
import { initPage, announce } from 'kit/page.js';
import { getParams, updateUrl } from 'kit/url.js';
import { tex, setTex } from 'kit/tex.js';
import { initExpressionInput } from 'kit/input.js';
import { fmt } from 'kit/format.js';
// Subject modules stay relative — they belong to this lens, not the kit.
import { tryParse, compile } from '../../js/expr.js';

const $ = (/** @type {string} */ s) => /** @type {any} */ (document.querySelector(s));

const state = {
  /** @type {(x:number)=>number} */ f: () => NaN,
  x0: -3,
  x1: 3,
};

let chart = null;

function render() {
  chart = chart || createChart('#chart-main', { height: 320, label: 'placeholder' });
  const { xs, ys } = makeScales(chart, [state.x0, state.x1],
    autoYDomain(state.f, state.x0, state.x1, { minSpan: 2 }));
  drawAxes(chart, { xs, ys, xLabel: 'x', yLabel: 'f(x)' });
  drawCurve(chart.plot, state.f, { xs, ys });

  // Keep the chart's accessible name describing the CURRENT state, not the page.
  chart.setLabel(`Graph of the function from x = ${fmt(state.x0, 1)} to ${fmt(state.x1, 1)}.`);
  $('#readout').innerHTML = `<span><b>f(0)</b> ${fmt(state.f(0), 3)}</span>`;
}

initPage({
  onReady() {
    const p = getParams();
    if (p.f) $('#fn-input').value = p.f;

    initExpressionInput({
      input: $('#fn-input'),
      error: $('#fn-error'),
      parse: tryParse,
      onChange(node, src) {
        state.f = compile(node);
        updateUrl({ f: src });     // document any new parameter in docs/url-api.md
        render();
      },
    });
  },
});
