/**
 * Implicit Differentiation — the procedure, one move at a time.
 *
 * Jeff, 2026-10-19: "some never catch on to that ... they need procedural help
 * here." So this is the steps half of the idea and not the picture: a curve
 * with a tangent on it is prettier, and it does not tell anyone where the y′
 * came from.
 *
 * The page withholds each line until asked, like the other worked-steps tools,
 * because the question worth asking is "what is the next move" and the answer
 * on the hard line is always the same: y is a function of x.
 */

import { initPage, applyControls, announce } from 'kit/page.js';
import { initWorking } from 'kit/working.js';
import { getParams, updateUrl } from 'kit/url.js';
import { tex, setTex } from 'kit/tex.js';
import { initPalette } from 'kit/input.js';
import { fmt } from 'kit/format.js';
import { initShare } from 'kit/share.js';
import { MARK } from '../../js/mark.js';
import { toLatex } from '../../js/expr.js';
import { parseEquation, implicitSteps, slopeAt, pickLetters } from '../../js/implicit.js';
import { freeVariables } from '../../js/expr.js';

const $ = (/** @type {string} */ s) => /** @type {any} */ (document.querySelector(s));

const PRESETS = {
  circle:  { eq: 'x^2 + y^2 = 25' },
  folium:  { eq: 'x^3 + y^3 = 6xy' },
  ellipse: { eq: 'x^2/9 + y^2/4 = 1' },
  hyper:   { eq: 'xy = 1' },
};

let work = null;
let current = null;   // { lhs, rhs, answer } once a derivation succeeds
let touched = false;  // has the reader chosen the letters themselves?

function wantsAll() {
  const v = getParams().raw.get('steps');
  return v === 'all' || v === 'true';
}

function rebuild() {
  const src = $('#eq-input').value;
  const parsed = parseEquation(src);

  if ('error' in parsed) {
    $('#eq-error').textContent = parsed.error;
    $('#eq-error').hidden = false;
    $('#eq-preview').innerHTML = '';
    $('#eq-input').setAttribute('aria-invalid', 'true');
    current = null;
    work.set([]);
    $('#blocked').hidden = true;
    $('#point').hidden = true;
    return;
  }

  $('#eq-error').hidden = true;
  $('#eq-input').setAttribute('aria-invalid', 'false');
  $('#eq-preview').innerHTML = tex(`${toLatex(parsed.lhs)} = ${toLatex(parsed.rhs)}`);

  // Fill the d_/d_ boxes from the equation, unless the reader has set them.
  // Re-guessing after they have chosen would silently overrule them.
  const free = new Set([...freeVariables(parsed.lhs), ...freeVariables(parsed.rhs)]);
  if (!touched || !free.has($('#wrt-dep').value.trim())) {
    const g = pickLetters(parsed.lhs, parsed.rhs);
    $('#wrt-dep').value = g.dep;
    $('#wrt-var').value = g.v;
  }
  const dep = $('#wrt-dep').value.trim();
  const v = $('#wrt-var').value.trim();
  $('#lbl-x').textContent = v;
  $('#lbl-y').textContent = dep;
  updateUrl({ eq: src, dep, var: v });

  const bad = letterProblem(dep, v, free);
  $('#wrt-error').hidden = !bad;
  if (bad) {
    $('#wrt-error').textContent = bad;
    current = null; work.set([]); $('#blocked').hidden = true; $('#point').hidden = true;
    return;
  }

  const r = implicitSteps(parsed.lhs, parsed.rhs, { v, dep });
  work.set(r.steps.map(s => ({ tex: s.tex, notes: s.notes })), { openAll: wantsAll() });

  $('#blocked').hidden = !r.blocked;
  if (r.blocked) $('#blocked').innerHTML = `<p><b>Not an implicit problem.</b> ${r.blocked}</p>`;

  current = r.answer ? { ...parsed, answer: r.answer, v, dep } : null;
  $('#point').hidden = !current;
  $('#slope-out').textContent = '';
}

/** Why the chosen pair will not work, or '' if it will. */
function letterProblem(dep, v, free) {
  if (!/^[A-Za-z]$/.test(dep) || !/^[A-Za-z]$/.test(v)) {
    return 'Each box takes a single letter.';
  }
  if (dep === v) return 'The two letters have to be different.';
  if (!free.has(v)) {
    return `There is no ${v} in this equation, so nothing in it varies with ${v}. `
      + `(Several quantities each depending on ${v} is a related-rates problem, `
      + `which this page does not do.)`;
  }
  if (!free.has(dep)) return `There is no ${dep} in this equation.`;
  return '';
}

function showSlope() {
  if (!current) return;
  const x = Number($('#px').value), y = Number($('#py').value);
  const out = $('#slope-out');
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    out.className = 'im-off';
    out.textContent = 'Give a number for each of x and y.';
    return;
  }
  const r = slopeAt(current.lhs, current.rhs, current.answer, x, y, { v: current.v, dep: current.dep });
  if (!r) {
    out.className = 'im-off';
    out.textContent = `The equation is not defined at (${fmt(x, 3)}, ${fmt(y, 3)}).`;
    return;
  }
  if (!r.on) {
    // A slope at a point that is not on the curve is a number with no meaning,
    // so it is withheld rather than printed with a caveat.
    out.className = 'im-off';
    out.innerHTML = `<b>(${fmt(x, 3)}, ${fmt(y, 3)}) is not on this curve</b>, so there is `
      + `no tangent there to have a slope. Check the point against the equation first.`;
    announce('That point is not on the curve.');
    return;
  }
  out.className = '';
  out.innerHTML = `At (${fmt(x, 3)}, ${fmt(y, 3)}): `
    + tex(`\\frac{d${current.dep}}{d${current.v}} = ${fmt(r.slope, 4)}`)
    + ` — from ${tex(`\\frac{d${current.dep}}{d${current.v}} = ${toLatex(current.answer)}`)} `
    + 'with both numbers put in.';
  announce(`Slope ${fmt(r.slope, 4)}.`);
}

initPage({
  onReady() {
    initShare({ mark: MARK });
    const params = getParams(PRESETS);
    if (params.raw.get('eq')) $('#eq-input').value = params.raw.get('eq');
    if (params.raw.get('dep') && params.raw.get('var')) {
      $('#wrt-dep').value = params.raw.get('dep');
      $('#wrt-var').value = params.raw.get('var');
      touched = true;
    }

    setTex($('#help-tex1'), 'x^2 + y^2 = 25');
    setTex($('#help-tex2'), "\\frac{d}{dx}\\left[y^2\\right] = 2y\\cdot y'", { display: true });
    setTex($('#help-tex3'), "\\frac{d}{dx}\\left[y^2\\right] = 2y");
    setTex($('#help-tex4'), '\\frac{d\\square}{d\\square}');

    work = initWorking({
      mount: $('#work-mount'),
      controlsName: 'steps',
      ghost: 'what is the next move?',
      // Each line here is a whole equation, not a link in a chain of equalities,
      // so the renderer must not put an `=` in front of it.
      chain: false,
    });
    applyControls(params.raw.get('controls'), params.raw.get('hide'));
    work.setSuppressed(work.controlsEl.hidden);

    initPalette($('#eq-palette'), $('#eq-input'), rebuild);
    rebuild();

    let timer = null;
    $('#eq-input').addEventListener('input', () => {
      clearTimeout(timer); timer = setTimeout(rebuild, 260);
    });
    $('#eq-input').addEventListener('change', () => { clearTimeout(timer); rebuild(); });
    $('#eq-input').addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
      // Enter commits and hands focus back, so N and A work as shortcuts
      // instead of being typed into the equation.
      if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); rebuild(); $('#eq-input').blur(); }
    });

    for (const b of document.querySelectorAll('.preset')) {
      b.addEventListener('click', () => { $('#eq-input').value = b.dataset.eq; rebuild(); });
    }
    for (const id of ['#wrt-dep', '#wrt-var']) {
      $(id).addEventListener('input', () => { touched = true; rebuild(); });
    }
    $('#slope-btn').addEventListener('click', showSlope);
    for (const id of ['#px', '#py']) {
      $(id).addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
        if (e.key === 'Enter') { e.preventDefault(); showSlope(); }
      });
    }
  },
});
