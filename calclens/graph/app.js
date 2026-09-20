/**
 * Grapher — the kit's plotting engine with a face on it.
 *
 * Not an attempt at Desmos. The point is the handful of things a CALCULUS
 * reader wants that a general grapher makes you build yourself:
 *
 *   - f′ and f″ differentiated SYMBOLICALLY, so they are exact rather than
 *     estimated, and drawn with their own dash patterns;
 *   - critical and inflection points found as roots of those and marked;
 *   - vertical asymptotes detected, drawn, and never drawn through — a grapher
 *     that joins the two branches of 1/x is drawing a line that is not there;
 *   - a tangent line at a point you can slide.
 *
 * Everything lives in the URL, so the same page is a live figure in an iframe
 * (`plot=only`), a slider demo in a lecture, and a question in a quiz. That is
 * the reason it is a tool rather than three bespoke embeds.
 */

import { createChart, makeScales, drawAxes, onBreakpointChange, onLayoutChange, afterLayout } from 'kit/chart.js';
import { drawCurve, autoYDomain, findBreaks } from 'kit/curve.js';
import { initPage, announce } from 'kit/page.js';
import { getParams, updateUrl } from 'kit/url.js';
import { tex, setTex } from 'kit/tex.js';
import { initPalette } from 'kit/input.js';
import { initShare } from 'kit/share.js';
import { fmt } from 'kit/format.js';
import { MARK } from '../js/mark.js';
import { tryParse, compile, derivative, toLatex, freeVariables } from '../js/expr.js';
import { findRoots, horizontalAsymptotes } from '../js/numeric.js';

const $ = (/** @type {string} */ s) => /** @type {any} */ (document.querySelector(s));

/** Colour AND dash together, so no layer is told apart by hue alone. */
const STYLE = {
  f1: { colour: '#114B5F', dash: null, width: 2.6 },
  f2: { colour: '#7B2D8E', dash: null, width: 2.4 },
  f3: { colour: '#1B7A3D', dash: null, width: 2.4 },
  deriv: { colour: '#C05E10', dash: '7 4', width: 2.2 },
  second: { colour: '#C2185B', dash: '2 3', width: 2.2 },
};

const LAYERS = ['deriv', 'second', 'critical', 'inflection', 'tangent', 'asymptotes'];

const state = {
  /** @type {{id:string, src:string, node:any, f:(x:number)=>number}[]} */ fns: [],
  /** @type {Record<string, number>} live slider values, read inside compiled fns */
  params: {},
  v: 'x',
  x0: -4, x1: 4,
  /** @type {[number,number]|null} */ yWin: null,
  at: 0,
  show: { deriv: false, second: false, critical: false, inflection: false, tangent: false, asymptotes: true },
};

let chart = null;

/* ─────────────────────────── reading the inputs ────────────────────────── */

/**
 * Parse all three fields, decide the variable, and discover which letters need
 * sliders.
 *
 * The variable is inferred from the expressions rather than assumed to be x, so
 * a velocity problem in t graphs without being told. Every OTHER letter becomes
 * a slider — which is what makes one page serve `x^2` and `a x^2 + b x + c`.
 */
function readFunctions() {
  const err = $('#f-error');
  const fields = [['#f1', '#p1', 'f1'], ['#f2', '#p2', 'f2'], ['#f3', '#p3', 'f3']];
  const parsed = [];
  const letters = new Set();

  for (const [sel, prevSel, id] of fields) {
    const src = $(sel).value.trim();
    const prev = $(prevSel);
    if (!src) { $(sel).setAttribute('aria-invalid', 'false'); prev.innerHTML = ''; continue; }
    const res = tryParse(src);
    if (!res.node) {
      $(sel).setAttribute('aria-invalid', 'true');
      prev.classList.add('ll-preview-stale');
      const caret = typeof res.pos === 'number' && res.pos < src.length
        ? ` (at "${src[res.pos]}", character ${res.pos + 1})` : '';
      err.textContent = `${res.error}${caret}`;
      err.hidden = false;
      continue;
    }
    $(sel).setAttribute('aria-invalid', 'false');
    prev.classList.remove('ll-preview-stale');
    prev.innerHTML = tex(toLatex(res.node));
    for (const l of freeVariables(res.node)) letters.add(l);
    parsed.push({ id, src, node: res.node });
  }
  if (parsed.length) err.hidden = true;

  // The variable is the one every expression shares — x when present, else
  // whichever single letter is actually being graphed against.
  state.v = letters.has('x') ? 'x' : ([...letters][0] || 'x');
  const sliders = [...letters].filter(l => l !== state.v).sort();
  syncParams(sliders);

  state.fns = parsed.map(p => ({ ...p, f: compile(p.node, state.v, state.params) }));
  return sliders;
}

/** One slider per free letter, keeping any value already set. */
function syncParams(names) {
  const wrap = $('#params-wrap');
  wrap.hidden = names.length === 0;
  const box = $('#params');
  const existing = new Set([...box.querySelectorAll('input')].map(i => i.dataset.name));
  if (names.length === existing.size && names.every(n => existing.has(n))) return;

  box.innerHTML = '';
  for (const name of names) {
    if (!(name in state.params)) state.params[name] = 1;
    const id = `param-${name}`;
    const label = document.createElement('label');
    label.innerHTML = `<span><i>${name}</i></span>`
      + `<input type="range" id="${id}" data-name="${name}" min="-5" max="5" step="0.1" value="${state.params[name]}">`
      + `<output for="${id}">${fmt(state.params[name], 1)}</output>`;
    box.appendChild(label);
    const input = label.querySelector('input');
    const out = label.querySelector('output');
    input.addEventListener('input', () => {
      state.params[name] = Number(input.value);
      out.textContent = fmt(state.params[name], 1);
      updateUrl({ [name]: state.params[name] });
      render();            // the compiled functions read params live
    });
  }
}

/* ───────────────────────────────── drawing ─────────────────────────────── */

function render() {
  const { x0, x1 } = state;
  chart = chart || createChart('#fig', { height: 420, fit: true, label: 'placeholder' });

  const primary = state.fns[0];
  const layers = [];
  for (const fn of state.fns) layers.push({ f: fn.f, ...STYLE[fn.id], key: fn.id });
  if (primary && state.show.deriv) {
    layers.push({ f: compile(derivative(primary.node, state.v), state.v, state.params), ...STYLE.deriv, key: 'deriv' });
  }
  if (primary && state.show.second) {
    layers.push({ f: compile(derivative(derivative(primary.node, state.v), state.v), state.v, state.params), ...STYLE.second, key: 'second' });
  }

  // The window fits WHAT YOU TYPED, and derived layers are drawn on those axes.
  //
  // Fitting it over every visible layer instead meant ticking "show f′" moved
  // the function you were looking at — a box that is not about f changing f's
  // shape on screen. The frame belongs to the functions the reader entered;
  // f′ and f″ are answers drawn onto it, and if one runs off the top that is
  // worth knowing rather than worth rescaling for. It is said out loud below
  // instead, and the y field overrides all of this.
  const typed = layers.filter(l => l.key === 'f1' || l.key === 'f2' || l.key === 'f3');
  const yDom = state.yWin || typed.reduce((acc, l) => {
    const d = autoYDomain(l.f, x0, x1, { minSpan: 2 });
    return acc ? [Math.min(acc[0], d[0]), Math.max(acc[1], d[1])] : d;
  }, null) || [-5, 5];

  const { xs, ys } = makeScales(chart, [x0, x1], yDom);
  drawAxes(chart, { xs, ys, xLabel: state.v, yLabel: 'y' });

  chart.plot.selectAll('*').remove();
  chart.gOver.selectAll('*').remove();

  if (state.show.asymptotes && primary) drawAsymptotes(primary.f, xs, ys, yDom);

  for (const l of layers) {
    const g = chart.plot.append('g');
    drawCurve(g, l.f, { xs, ys, className: `gr-${l.key}`, samples: 900 });
    g.selectAll('path').attr('stroke', l.colour).attr('stroke-width', l.width)
      .attr('fill', 'none').attr('stroke-dasharray', l.dash);
  }

  if (primary) markPoints(primary, xs, ys);
  if (primary && state.show.tangent) drawTangent(primary, xs, ys);

  state.clipped = layers.filter(l => (l.key === 'deriv' || l.key === 'second')
    && !anyVisible(l.f, x0, x1, yDom)).map(l => (l.key === 'deriv' ? 'f ′' : 'f ″'));

  updateLegend(layers);
  updateReadout(primary);
  chart.setLabel(describe(layers, yDom));
}

/** Does any of this curve fall inside the window at all? */
function anyVisible(f, x0, x1, yDom) {
  for (let i = 0; i <= 200; i++) {
    const y = f(x0 + ((x1 - x0) * i) / 200);
    if (Number.isFinite(y) && y >= yDom[0] && y <= yDom[1]) return true;
  }
  return false;
}

/**
 * Vertical asymptotes, drawn.
 *
 * `sampleCurve` already refuses to join the curve across one, so the graph is
 * honest without this — but silence is not the same as saying so. A reader
 * looking at 1/x should see WHY the two branches are separate.
 */
function drawAsymptotes(f, xs, ys, yDom) {
  const dashed = (/** @type {number[]} */ p) => chart.plot.append('line')
    .attr('x1', p[0]).attr('y1', p[1]).attr('x2', p[2]).attr('y2', p[3])
    .attr('stroke', 'var(--ims-gray)').attr('stroke-width', 1.5)
    .attr('stroke-dasharray', '5 5').attr('opacity', 0.8);

  const breaks = findBreaks(f, state.x0, state.x1, { yMin: yDom[0], yMax: yDom[1] });
  for (const b of breaks) {
    if (b.kind !== 'pole') continue;      // a domain edge is not an asymptote
    dashed([xs(b.x), ys(yDom[1]), xs(b.x), ys(yDom[0])]);
  }

  // Horizontal ones are measured, not found in the window: the behaviour that
  // defines them happens off the edge of any window the reader can see, which
  // is exactly why the picture alone does not tell them.
  const h = horizontalAsymptotes(f);
  const levels = [];
  for (const [side, y] of [['right', h.right], ['left', h.left]]) {
    if (y === null) continue;
    const same = levels.find(l => Math.abs(l.y - y) <= 1e-9 * Math.max(1, Math.abs(y)));
    if (same) same.side = 'both'; else levels.push({ y, side });
  }
  for (const l of levels) {
    // A level outside the window is still true, and drawing it at the edge
    // would be a line the function never approaches there.
    if (l.y < yDom[0] || l.y > yDom[1]) continue;
    dashed([xs(state.x0), ys(l.y), xs(state.x1), ys(l.y)]);
  }

  state.asymptotes = {
    vertical: breaks.filter(b => b.kind === 'pole').map(b => b.x),
    horizontal: levels,
  };
}

/** "y = 3 as x → ∞, y = −3 as x → −∞", or just "y = 2" when both ends agree. */
function horizontalText(levels, arrow = true) {
  const to = { both: '', right: ` as ${state.v} → ∞`, left: ` as ${state.v} → −∞` };
  // A level the detector snapped to a whole number should read "y = 3", not
  // "y = 3.0000" — the trailing zeros suggest a measurement it is not.
  const level = (/** @type {number} */ y) => (Number.isInteger(y) ? String(y) : fmt(y, 4));
  return (levels || []).map(l => `y = ${level(l.y)}${arrow ? to[l.side] : ''}`).join(', ');
}

/** Is any asymptote worth mentioning? */
function anyAsymptote() {
  const a = state.asymptotes;
  return !!(a && (a.vertical?.length || a.horizontal?.length));
}

/** Critical points (f′ = 0) and inflection points (f″ = 0), on the curve. */
function markPoints(primary, xs, ys) {
  state.critical = []; state.inflection = [];
  const mark = (roots, colour, r) => {
    for (const x of roots) {
      const y = primary.f(x);
      if (!Number.isFinite(y)) continue;
      chart.gOver.append('circle').attr('cx', xs(x)).attr('cy', ys(y)).attr('r', r)
        .attr('fill', colour).attr('stroke', '#fff').attr('stroke-width', 1.6);
    }
  };
  if (state.show.critical) {
    const d = compile(derivative(primary.node, state.v), state.v, state.params);
    state.critical = findRoots(d, state.x0, state.x1);
    mark(state.critical, STYLE.deriv.colour, 5.5);
  }
  if (state.show.inflection) {
    const dd = compile(derivative(derivative(primary.node, state.v), state.v), state.v, state.params);
    state.inflection = findRoots(dd, state.x0, state.x1);
    // Hollow, so an inflection is not mistaken for a critical point at a glance.
    for (const x of state.inflection) {
      const y = primary.f(x);
      if (!Number.isFinite(y)) continue;
      chart.gOver.append('circle').attr('cx', xs(x)).attr('cy', ys(y)).attr('r', 5.5)
        .attr('fill', '#fff').attr('stroke', STYLE.second.colour).attr('stroke-width', 2.4);
    }
  }
}

function drawTangent(primary, xs, ys) {
  const a = state.at;
  const y = primary.f(a);
  const m = compile(derivative(primary.node, state.v), state.v, state.params)(a);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return;
  const half = (state.x1 - state.x0) * 0.3;
  chart.gOver.append('line').attr('class', 'll-tangent')
    .attr('x1', xs(a - half)).attr('y1', ys(y - m * half))
    .attr('x2', xs(a + half)).attr('y2', ys(y + m * half));
  chart.gOver.append('circle').attr('class', 'll-point')
    .attr('cx', xs(a)).attr('cy', ys(y)).attr('r', 5.5);
}

/* ───────────────────────────── words and numbers ───────────────────────── */

function updateLegend(layers) {
  const name = { f1: 'f', f2: 'g', f3: 'h', deriv: 'f ′', second: 'f ″' };
  $('#legend').innerHTML = layers.map(l =>
    `<span><svg viewBox="0 0 26 10"><line x1="1" y1="5" x2="25" y2="5" stroke="${l.colour}" `
    + `stroke-width="${l.width}"${l.dash ? ` stroke-dasharray="${l.dash}"` : ''}/></svg> `
    + `<i>${name[l.key]}</i></span>`).join('')
    + asymptoteKey();
}

/**
 * The legend swatch has to match what is actually on the graph. A vertical tick
 * beside the word "asymptote" is a plain miscue when the only asymptote drawn
 * is horizontal — and both orientations can be present at once.
 */
function asymptoteKey() {
  if (!state.show.asymptotes || !anyAsymptote()) return '';
  const a = state.asymptotes;
  const dash = 'stroke="#808080" stroke-width="1.5" stroke-dasharray="3 3"';
  const marks = [
    a.vertical?.length ? `<line x1="13" y1="0" x2="13" y2="10" ${dash}/>` : '',
    a.horizontal?.length ? `<line x1="1" y1="5" x2="25" y2="5" ${dash}/>` : '',
  ].join('');
  return `<span><svg viewBox="0 0 26 10">${marks}</svg> asymptote</span>`;
}

function updateReadout(primary) {
  if (!primary) { $('#readout').innerHTML = ''; return; }
  const bits = [];
  if (state.show.tangent) {
    const m = compile(derivative(primary.node, state.v), state.v, state.params)(state.at);
    bits.push(`<span><b>${state.v}</b> ${fmt(state.at, 3)}</span>`);
    bits.push(`<span><b>f(${state.v})</b> ${fmt(primary.f(state.at), 4)}</span>`);
    bits.push(`<span><b>f ′(${state.v})</b> ${fmt(m, 4)}</span>`);
  }
  const list = (xs2, label) => xs2?.length
    ? `<span><b>${label}</b> ${xs2.map(x => fmt(x, 3)).join(', ')}</span>` : '';
  bits.push(list(state.critical, 'critical at'));
  bits.push(list(state.inflection, 'inflection at'));
  bits.push(list(state.asymptotes?.vertical, `vertical asymptote at ${state.v} =`));
  if (state.asymptotes?.horizontal?.length) {
    bits.push(`<span><b>horizontal asymptote</b> ${horizontalText(state.asymptotes.horizontal)}</span>`);
  }
  if (state.clipped?.length) {
    bits.push(`<span class="ll-hint">${state.clipped.join(' and ')} `
      + `${state.clipped.length > 1 ? 'are' : 'is'} outside this window — set a `
      + `<i>y</i> range to bring ${state.clipped.length > 1 ? 'them' : 'it'} in.</span>`);
  }
  $('#readout').innerHTML = bits.filter(Boolean).join('');
}

function describe(layers, yDom) {
  const names = { f1: 'the function', f2: 'a second function', f3: 'a third function',
    deriv: 'its derivative', second: 'its second derivative' };
  return `A graph over ${state.v} from ${fmt(state.x0, 2)} to ${fmt(state.x1, 2)} and y from `
    + `${fmt(yDom[0], 2)} to ${fmt(yDom[1], 2)}, showing `
    + layers.map(l => names[l.key]).join(', ')
    + (state.asymptotes?.vertical?.length
      ? `, with vertical asymptotes at ${state.v} = ${state.asymptotes.vertical.map(x => fmt(x, 3)).join(', ')}` : '')
    + (state.asymptotes?.horizontal?.length
      ? `, and a horizontal asymptote ${horizontalText(state.asymptotes.horizontal)}` : '')
    + '.';
}

/* ────────────────────────────────── boot ───────────────────────────────── */

function readWindow() {
  const px = String($('#win-x').value).split(',').map(Number);
  if (px.length === 2 && px.every(Number.isFinite) && px[1] > px[0]) [state.x0, state.x1] = px;
  const py = String($('#win-y').value).trim();
  if (!py) state.yWin = null;
  else {
    const p = py.split(',').map(Number);
    state.yWin = (p.length === 2 && p.every(Number.isFinite) && p[1] > p[0]) ? [p[0], p[1]] : null;
  }
  const at = $('#at-slider');
  at.min = String(state.x0); at.max = String(state.x1);
  state.at = Math.min(state.x1, Math.max(state.x0, state.at));
  at.value = String(state.at);
  $('#at-out').textContent = fmt(state.at, 2);
}

function refresh() { readFunctions(); readWindow(); render(); }

initPage({
  onReady() {
    initShare({ mark: MARK });
    const q = getParams().raw;

    for (const [param, sel] of [['f', '#f1'], ['f2', '#f2'], ['f3', '#f3']]) {
      if (q.get(param)) $(sel).value = q.get(param);
    }
    if (q.get('window')) $('#win-x').value = q.get('window');
    if (q.get('y')) $('#win-y').value = q.get('y');
    if (q.get('at')) state.at = Number(q.get('at')) || 0;

    // `show=` is StatLens's spelling for a list of layers to switch on.
    const show = (q.get('show') || '').split(',').map(s => s.trim()).filter(Boolean);
    const hide = (q.get('hide') || '').split(',').map(s => s.trim()).filter(Boolean);
    for (const layer of LAYERS) {
      if (show.includes(layer)) state.show[layer] = true;
      if (hide.includes(layer)) state.show[layer] = false;
      const box = $(`#L-${layer}`);
      if (box) box.checked = state.show[layer];
    }
    // Asymptotes are NOT one of the optional layers, whatever `show=` lists.
    // Drawing them is about not lying: the curve is already split there, and a
    // reader looking at 1/x should see why the two branches are separate.
    // Asking for `show=deriv` must not quietly switch that off — only
    // `hide=asymptotes`, or the checkbox, does.
    // Parameter values arrive as plain letters: ?a=2&b=-1
    for (const [k, val] of q.entries()) {
      if (/^[a-z]$/.test(k) && Number.isFinite(Number(val))) state.params[k] = Number(val);
    }

    // `plot=only` — the figure alone, for an iframe. StatLens's spelling.
    if (q.get('plot') === 'only') {
      document.body.classList.add('ll-embed');
      document.body.setAttribute('data-prose', 'none');
      for (const el of document.querySelectorAll('[data-control]')) {
        /** @type {HTMLElement} */ (el).hidden = true;
      }
      $('#controls').hidden = true;
      $('#legend').hidden = true;
      $('#readout').hidden = true;
    }

    for (const sel of ['#f1', '#f2', '#f3']) {
      $(sel).addEventListener('change', () => {
        updateUrl({ f: $('#f1').value, f2: $('#f2').value || null, f3: $('#f3').value || null });
        refresh();
      });
      let t = null;
      $(sel).addEventListener('input', () => { clearTimeout(t); t = setTimeout(refresh, 260); });
    }
    initPalette($('#palette'), $('#f1'), refresh);

    for (const sel of ['#win-x', '#win-y']) {
      $(sel).addEventListener('change', () => {
        updateUrl({ window: $('#win-x').value, y: $('#win-y').value || null });
        refresh();
      });
    }

    for (const layer of LAYERS) {
      const box = $(`#L-${layer}`);
      if (!box) continue;
      box.addEventListener('change', () => {
        state.show[layer] = box.checked;
        $('#at-wrap').hidden = !state.show.tangent;
        updateUrl({ show: LAYERS.filter(k => state.show[k]).join(',') || null });
        render();
        announce(`${layer} ${box.checked ? 'shown' : 'hidden'}.`);
      });
    }
    $('#at-slider').addEventListener('input', e => {
      state.at = Number(e.target.value);
      $('#at-out').textContent = fmt(state.at, 2);
      updateUrl({ at: state.at });
      render();
    });
    $('#at-wrap').hidden = !state.show.tangent;

    onBreakpointChange(() => { chart = null; render(); });
    onLayoutChange(() => { chart = null; render(); });
    afterLayout(() => { chart = null; render(); });

    refresh();
  },
});
