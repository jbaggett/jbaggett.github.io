/**
 * Derivative from the Definition — the difference quotient, worked out.
 *
 * All the algebra is in `js/limit-steps.js`; this page is the wiring. Two
 * decisions live here rather than there:
 *
 *   - The point is OPTIONAL and blank means symbolic. "Find f′(x) from the
 *     definition" is the commoner exercise, so it is the default, and a number
 *     in the box switches to "find f′ at this place" without a mode control.
 *
 *   - When the engine declines, the page still shows the derivative found by
 *     the RULES, and says which tool applies them. Declining is only honest if
 *     the student is not left with nothing.
 */

import { initPage, applyControls, announce } from 'kit/page.js';
import { initWorking } from 'kit/working.js';
import { getParams, updateUrl } from 'kit/url.js';
import { tex, setTex } from 'kit/tex.js';
import { initExpressionInput } from 'kit/input.js';
import { initShare } from 'kit/share.js';
import { MARK } from '../../js/mark.js';

import { tryParse, toLatex, toText, freeVariables } from '../../js/expr.js';
import { differenceQuotientSteps } from '../../js/limit-steps.js';

const $ = (/** @type {string} */ s) => /** @type {any} */ (document.querySelector(s));

/** Lecture links: content only, never presentation. */
const PRESETS = {
  poly:     { f: '2x^2' },
  cubic:    { f: 'x^3-2x' },
  root:     { f: 'sqrt(x)' },
  rational: { f: '1/x' },
  point:    { f: '5x^2-3x+2', a: '1' },
};

let work = null;
let varName = 'x';

/** The point, as a node — or null for the general derivative. */
function readPoint() {
  const raw = String($('#at-input').value || '').trim();
  const err = $('#at-error');
  if (!raw) { err.hidden = true; return { at: null }; }
  const res = tryParse(raw);
  if (!res.node || freeVariables(res.node).size > 0) {
    err.textContent = 'The point has to be a number — try 1, -2, or 0.5. '
      + 'Leave it blank for the general derivative.';
    err.hidden = false;
    $('#at-input').setAttribute('aria-invalid', 'true');
    return { at: null, bad: true };
  }
  err.hidden = true;
  $('#at-input').setAttribute('aria-invalid', 'false');
  return { at: res.node };
}

function pickVariable(node, requested) {
  const free = [...freeVariables(node)];
  if (requested && free.includes(requested)) return requested;
  if (free.length === 1) return free[0];
  return requested || (free.includes('x') ? 'x' : (free[0] || 'x'));
}

function wantsAll() {
  const v = getParams().raw.get('steps');
  return v === 'all' || v === 'true';
}

/* ──────────────────────────────── driving ──────────────────────────────── */

function rebuild(node, src) {
  const params = getParams();
  varName = pickVariable(node, params.raw.get('var'));
  // `h` is the increment by universal convention, but if the function itself is
  // written in h the quotient would be nonsense — step aside to k.
  const increment = freeVariables(node).has('h') ? 'k' : 'h';
  document.querySelectorAll('.varname').forEach(el => { el.textContent = varName; });

  const { at, bad } = readPoint();
  if (bad) { work.set([]); showBlocked(null); return; }

  const r = differenceQuotientSteps(node, { v: varName, h: increment, at });
  work.set(r.steps, { openAll: wantsAll() });
  showBlocked(r.blocked ? { reason: r.blocked, viaRules: r.viaRules, src } : null);
  updateUrl({ f: src, a: at ? toText(at) : null });
}

/**
 * Declining leaves the page with something to say, or it is just a dead end:
 * the derivative from the rules, and where to watch those rules being applied.
 */
function showBlocked(info) {
  const box = $('#blocked');
  const echo = $('#answer-echo');
  box.hidden = !info;
  echo.hidden = true;
  if (!info) return;
  const href = `../../derivatives/steps/?f=${encodeURIComponent(info.src)}`;
  box.innerHTML = `<p><b>Not by algebra alone.</b> ${info.reason}</p>`
    + `<p>The derivative is ${tex(`${'f'}'(${varName}) = ${toLatex(info.viaRules)}`)}, `
    + `found with the differentiation rules — `
    + `<a href="${href}">see those steps worked out</a>.</p>`;
  announce('This one cannot be finished by algebra; the derivative from the rules is shown instead.');
}

/* ────────────────────────────────── boot ───────────────────────────────── */

initPage({
  onReady() {
    initShare({ mark: MARK });
    const params = getParams(PRESETS);
    if (params.f) $('#fn-input').value = params.f;
    if (params.raw.get('a')) $('#at-input').value = params.raw.get('a');

    setTex($('#lede-tex'), '\\tfrac{0}{0}');
    setTex($('#help-tex1'),
      "f'(x) = \\lim_{h \\to 0}\\frac{f(x + h) - f(x)}{h}", { display: true });
    setTex($('#help-tex2'), '\\lim_{h \\to 0}\\frac{f(x+h)-f(x)}{h} = \\tfrac{0}{0}');
    setTex($('#help-tex3'), '\\lim_{h \\to 0}');
    setTex($('#help-tex4'), '\\lim_{h \\to 0}\\tfrac{\\sin h}{h} = 1');

    work = initWorking({
      mount: $('#work-mount'),
      controlsName: 'steps',
      ghost: 'what would you do next?',
    });

    // Before the field: initExpressionInput runs immediately, so reading the
    // suppressed flag off the DOM afterwards would latch that first render
    // rather than what the URL asked for.
    applyControls(params.raw.get('controls'), params.raw.get('hide'));
    work.setSuppressed(work.controlsEl.hidden);

    const field = initExpressionInput({
      input: $('#fn-input'),
      error: $('#fn-error'),
      preview: $('#fn-preview'),
      palette: $('#fn-palette'),
      parse: tryParse,
      format: toLatex,
      onChange: rebuild,
      onError: () => { work.set([]); showBlocked(null); },
    });

    if (work.controlsEl.hidden) work.openAll();

    const reread = () => {
      const node = field.current();
      if (node) rebuild(node, $('#fn-input').value);
    };
    $('#at-input').addEventListener('change', reread);
    $('#at-input').addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
      if (e.key === 'Enter') { e.preventDefault(); reread(); }
    });

    for (const b of document.querySelectorAll('.preset')) {
      b.addEventListener('click', () => {
        $('#at-input').value = b.dataset.a || '';
        field.set(b.dataset.f);
      });
    }
  },
});
