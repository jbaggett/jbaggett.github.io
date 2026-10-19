/**
 * Worked Integral — the line of working, one rule at a time.
 *
 * The sibling of Worked Derivative, and withholding the next line matters more
 * here than it does there. Differentiating is a decision procedure: look at the
 * shape, apply the rule. Integrating is a SEARCH, and the only part of it worth
 * practising is choosing u. A page that prints the finished working answers
 * "what is the antiderivative" — which Check My Answer already does — while
 * revealing a line at a time asks "what would you substitute", which is the
 * question on the exam.
 */

import { initPage, applyControls, announce } from 'kit/page.js';
import { initWorking } from 'kit/working.js';
import { getParams, updateUrl } from 'kit/url.js';
import { tex, setTex } from 'kit/tex.js';
import { initExpressionInput } from 'kit/input.js';
import { initShare } from 'kit/share.js';
import { MARK } from '../../js/mark.js';

import { tryParse, toLatex, freeVariables } from '../../js/expr.js';
import { integralSteps, ruleInfo, rulesUsed } from '../../js/integral-steps.js';

const $ = (/** @type {string} */ s) => /** @type {any} */ (document.querySelector(s));

/** Lecture links: content only, never presentation. */
const PRESETS = {
  power:     { f: 'x^5' },
  sum:       { f: '3x^2 + sin(x)' },
  usub:      { f: '2x cos(x^2)' },
  inner:     { f: 'sin(x)^3 cos(x)' },
  bottom:    { f: 'x/(x^2+1)' },
  arctan:    { f: '1/(x^2+4)' },
  backwards: { f: 'x sqrt(2x+1)' },
};

let steps = [];
let varName = 'x';
let work = null;

/**
 * Which letter are we integrating with respect to?
 *
 * Auto-detected, because a physics problem is written in `t` and asking the
 * student to tell the page so is friction with no teaching value. `?var=`
 * settles the ambiguous case; `x` is the tie-break.
 */
function pickVariable(/** @type {any} */ node, /** @type {string|null} */ requested) {
  const free = [...freeVariables(node)];
  if (requested && free.includes(requested)) return requested;
  if (free.length === 1) return free[0];
  return requested || (free.includes('x') ? 'x' : (free[0] || 'x'));
}

/** The rules met, stated in full, once the derivation is open. */
function renderRules(done) {
  const sec = $('#rules-used');
  const used = done ? rulesUsed(steps) : [];
  sec.hidden = !used.length;
  if (sec.hidden) return;
  const ul = $('#rule-list');
  ul.innerHTML = '';
  for (const id of used) {
    const [rule, rv] = id.split('|');
    const info = ruleInfo(rule, rv || varName);
    const li = document.createElement('li');
    li.innerHTML = `<b>${info.name}</b>` + (info.tex ? `<span>${tex(info.tex)}</span>` : '');
    ul.appendChild(li);
  }
}

function clearWork() {
  steps = [];
  work.set([]);
  $('#outside').hidden = true;
  renderRules(false);
}

function rebuild(/** @type {any} */ node, /** @type {string} */ src) {
  varName = pickVariable(node, getParams().raw.get('var'));
  // The label is the notation being filled in, with the slot drawn the way the
  // palette draws one. It follows the variable, so a problem in t is labelled
  // in t rather than being told about x.
  setTex($('#int-label'), `\\int \\square\\,d${varName}`, { display: false });
  document.querySelectorAll('.varname').forEach((el) => { el.textContent = varName; });

  const r = integralSteps(node, varName);
  steps = r.steps;
  work.set(r.steps.map(s => ({ tex: s.tex, notes: s.notes })), { openAll: wantsAll() });

  $('#outside').hidden = !r.blocked;
  if (r.blocked) {
    $('#outside-why').textContent = r.blocked;
    // The answer is still worth having when there is one: a student who only
    // needed to check their result should not be turned away because the
    // WORKING is out of scope.
    $('#outside-answer').hidden = !r.answer;
    if (r.answer) {
      setTex($('#outside-answer'),
        `\\int ${toLatex(node)}\\,d${varName} = ${toLatex(r.answer)} + C`, { display: true });
    }
    announce(r.blocked);
  }
  renderRules(work.shownCount() >= steps.length);
  updateUrl({ f: src });
}

function wantsAll() {
  const v = getParams().raw.get('steps');
  return v === 'all' || v === 'true';
}

initPage({
  onReady() {
    initShare({ mark: MARK });
    const params = getParams(PRESETS);
    if (params.f) $('#fn-input').value = params.f;

    setTex($('#int-label'), '\\int \\square\\,dx');
    setTex($('#help-tex1'), '\\int 2x\\,dx = x^{2} + C', { display: true });
    setTex($('#help-tex2'), '\\int \\cos\\left(3x+1\\right)dx');
    setTex($('#help-tex3'), '\\int \\cos\\left(x^{2}\\right)dx');
    setTex($('#help-tex4'), '\\int e^{-x^{2}}dx');

    work = initWorking({
      mount: $('#work-mount'),
      controlsName: 'steps',
      ghost: 'what would you substitute?',
      onChange: (_shown, done) => renderRules(done),
    });

    // applyControls before the field: initExpressionInput runs immediately, and
    // reading the suppressed flag off the DOM after that would latch whatever
    // its first render decided rather than what the URL asked for.
    applyControls(params.raw.get('controls'), params.raw.get('hide'));
    work.setSuppressed(work.controlsEl.hidden);

    const field = initExpressionInput({
      input: $('#fn-input'),
      error: $('#fn-error'),
      preview: $('#fn-preview'),
      palette: $('#fn-palette'),
      parse: tryParse,
      format: (/** @type {any} */ n) => `\\int ${toLatex(n)}\\,d${pickVariable(n, getParams().raw.get('var'))}`,
      onChange: rebuild,
      onError: clearWork,
    });

    for (const b of document.querySelectorAll('.preset')) {
      b.addEventListener('click', () => field.set(b.dataset.f));
    }
  },
});
