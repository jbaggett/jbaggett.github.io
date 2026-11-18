/**
 * Worked Derivative — the line of working, one rule at a time.
 *
 * The page deliberately withholds the next line until asked. A tool that prints
 * the whole derivation at once answers the question "what is the derivative",
 * which the student could already get from Check My Answer; revealing it a step
 * at a time answers "which rule applies here", which is the part of
 * differentiation that is actually hard and the part an answer key never
 * teaches. `?steps=all` opens it fully for a worked example on a slide.
 */

import { initPage, applyControls, announce } from 'kit/page.js';
import { initWorking } from 'kit/working.js';
import { getParams, updateUrl } from 'kit/url.js';
import { tex, setTex } from 'kit/tex.js';
import { initExpressionInput } from 'kit/input.js';
import { initShare } from 'kit/share.js';
import { MARK } from '../../js/mark.js';

import { tryParse, toLatex, freeVariables } from '../../js/expr.js';
import { derivationSteps, ruleInfo, rulesUsed } from '../../js/steps.js';
import { simplifySteps } from '../../js/factor-steps.js';

const $ = (/** @type {string} */ s) => /** @type {any} */ (document.querySelector(s));

/** Lecture links: content only, never presentation. */
const PRESETS = {
  product:  { f: 'x^2 e^x' },
  quotient: { f: '(3x+1)/(x^2-4)' },
  chain:    { f: 'sin(3x^2)' },
  logdiff:  { f: 'x^x' },
};

let rawSteps = [];   // the engine's shape: {tex, rules[]} — rulesUsed reads this
let varName = 'x';
let work = null;
let baseSteps = [];  // the derivation, without the algebra
let simpSteps = [];  // the algebra, when it has been asked for
let simplifying = false;

/* ─────────────────────────────── variable ──────────────────────────────── */

/**
 * Which letter are we differentiating with respect to?
 *
 * Auto-detected, because a physics problem is written in `t` and asking the
 * student to also tell the page so is friction with no teaching value. `?var=`
 * settles the ambiguous case; `x` is the tie-break.
 */
function pickVariable(node, requested) {
  const free = [...freeVariables(node)];
  if (requested && free.includes(requested)) return requested;
  if (free.length === 1) return free[0];
  return requested || (free.includes('x') ? 'x' : (free[0] || 'x'));
}

/* ─────────────────────────────── rendering ─────────────────────────────── */

/** The rules met, stated in full, once the derivation is open. */
function renderRules(done) {
  const sec = $('#rules-used');
  const used = done ? rulesUsed(rawSteps) : [];
  sec.hidden = !used.length;
  if (sec.hidden) return;
  const ul = $('#rule-list');
  ul.innerHTML = '';
  for (const id of used) {
    const info = ruleInfo(id, varName);
    const li = document.createElement('li');
    li.innerHTML = `<b>${info.name}</b>` + (info.tex ? `<span>${tex(info.tex)}</span>` : '');
    ul.appendChild(li);
  }
}

/* ──────────────────────────────── driving ──────────────────────────────── */

function rebuild(node, src) {
  varName = pickVariable(node, getParams().raw.get('var'));
  document.querySelectorAll('.varname').forEach(el => { el.textContent = varName; });

  const result = derivationSteps(node, varName);
  rawSteps = result.steps;
  // The engine speaks in rule ids; the renderer wants notes. Every rule here
  // describes how the line was reached, so every note is a transition.
  baseSteps = result.steps.map(s => ({
    tex: s.tex,
    notes: s.rules.map(r => ({ text: ruleInfo(r, varName).name, kind: 'transition' })),
  }));
  // Differentiating and simplifying are two skills, and early in the course
  // you want only the first — so the algebra is computed but not shown until
  // it is asked for.
  simpSteps = result.answer ? simplifySteps(result.answer, varName) : [];
  simplifying = simplifying && simpSteps.length > 0;
  paintSteps({ openAll: wantsAll() });

  $('#note').hidden = result.complete;
  if (!result.complete) {
    $('#note').textContent = 'This one ran deeper than the page will unfold. '
      + 'The last line is still the correct derivative.';
  }
  updateUrl({ f: src });
}

/**
 * The working, with or without the algebra on the end.
 *
 * `keep` on an append: the button only appears once the derivation is open, so
 * collapsing back to line 1 would throw away what the reader had revealed —
 * and the new lines arriving withheld is the point of asking for them.
 */
function paintSteps(opts = {}) {
  const all = simplifying ? [...baseSteps, ...simpSteps] : baseSteps;
  work.set(all, opts);
  paintSimplifyRow(work.shownCount() >= all.length);
}


/** The button shows only when there IS algebra and the derivation is open. */
function paintSimplifyRow(done) {
  const row = $('#simplify-row');
  row.hidden = !simpSteps.length || (!done && !simplifying);
  $('#simplify-btn').textContent = simplifying ? 'Hide the algebra' : 'Simplify further';
  $('#simplify-hint').hidden = simplifying;
}

function wantsAll() {
  const v = getParams().raw.get('steps');
  return v === 'all' || v === 'true';
}

/* ────────────────────────────────── boot ───────────────────────────────── */

initPage({
  onReady() {
    initShare({ mark: MARK });
    const params = getParams(PRESETS);
    if (params.f) $('#fn-input').value = params.f;

    setTex($('#help-tex1'), '\\frac{d}{dx}\\!\\left[x^{2}\\right]');
    setTex($('#help-tex2'),
      '\\frac{d}{dx}\\!\\left[x^{2}e^{x}\\right] = \\frac{d}{dx}\\!\\left[x^{2}\\right]e^{x}'
      + ' + x^{2}\\cdot\\frac{d}{dx}\\!\\left[e^{x}\\right]');
    setTex($('#help-tex3'),
      '2x\\left(x-1\\right)^{\\frac{1}{3}} + \\frac{x^{2}}{3\\left(x-1\\right)^{\\frac{2}{3}}}',
      { display: true });

    work = initWorking({
      mount: $('#work-mount'),
      controlsName: 'steps',
      // The withheld line asks about whichever job the next line belongs to:
      // the calculus, or the algebra that follows it.
      ghost: (/** @type {number} */ shown) => (simplifying && shown >= baseSteps.length
        ? 'what would you take out of every term?'
        : 'which rule applies here?'),
      onChange: (shown, done) => {
        // The rules legend lists the rules of DIFFERENTIATION, so it is open
        // once those lines are, whether or not the algebra follows them.
        renderRules(shown >= baseSteps.length);
        paintSimplifyRow(done);
      },
    });
    simplifying = ['true', '1', 'yes'].includes(String(params.raw.get('simplify')));

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
      format: toLatex,
      onChange: rebuild,
      onError: () => { rawSteps = []; work.set([]); },
    });

    for (const b of document.querySelectorAll('.preset')) {
      b.addEventListener('click', () => field.set(b.dataset.f));
    }

    $('#simplify-btn').addEventListener('click', () => {
      simplifying = !simplifying;
      paintSteps({ keep: true });
      updateUrl({ simplify: simplifying ? 'true' : null });
      announce(simplifying
        ? 'The algebra is added to the working. Reveal it a line at a time.'
        : 'The algebra is hidden again.');
    });
  },
});
