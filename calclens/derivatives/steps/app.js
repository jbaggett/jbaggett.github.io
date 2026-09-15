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

import { initPage, announce, applyControls } from 'kit/page.js';
import { getParams, updateUrl } from 'kit/url.js';
import { tex, setTex } from 'kit/tex.js';
import { initExpressionInput } from 'kit/input.js';
import { initShare } from 'kit/share.js';
import { MARK } from '../../js/mark.js';

import { tryParse, toLatex, freeVariables } from '../../js/expr.js';
import { derivationSteps, ruleInfo, rulesUsed } from '../../js/steps.js';

const $ = (/** @type {string} */ s) => /** @type {any} */ (document.querySelector(s));

/** Lecture links: content only, never presentation. */
const PRESETS = {
  product:  { f: 'x^2 e^x' },
  quotient: { f: '(3x+1)/(x^2-4)' },
  chain:    { f: 'sin(3x^2)' },
  logdiff:  { f: 'x^x' },
};

let steps = [];        // every line of the derivation
let shown = 1;         // how many are on screen — the statement always is
let varName = 'x';

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

function render() {
  const list = $('#steps');
  list.innerHTML = '';

  steps.slice(0, shown).forEach((s, i) => {
    const li = document.createElement('li');
    li.className = 'll-step';
    if (i === steps.length - 1 && shown === steps.length) li.classList.add('ll-step-final');

    const sign = document.createElement('span');
    sign.className = 'll-step-sign';
    sign.setAttribute('aria-hidden', 'true');
    sign.textContent = i === 0 ? '' : '=';

    const eq = document.createElement('div');
    eq.className = 'll-step-eq';
    eq.innerHTML = tex(s.tex, { display: false });

    li.append(sign, eq);

    if (s.rules.length) {
      const tags = document.createElement('div');
      tags.className = 'll-step-rules';
      for (const r of s.rules) {
        const t = document.createElement('span');
        t.className = 'll-tag' + (r === 'simplify' ? ' ll-tag-tidy' : '');
        t.textContent = ruleInfo(r, varName).name;
        tags.appendChild(t);
      }
      li.appendChild(tags);
    }
    list.appendChild(li);
  });

  // A withheld line has to look withheld, or "which rule is next?" is a
  // question about a blank space.
  if (shown < steps.length) {
    const li = document.createElement('li');
    li.className = 'll-step ll-step-ghost';
    li.innerHTML = '<span class="ll-step-sign" aria-hidden="true">=</span>'
      + '<div class="ll-step-eq">… which rule applies here?</div>';
    list.appendChild(li);
  }

  const done = shown >= steps.length;
  $('#next-btn').hidden = done;
  $('#all-btn').hidden = done || shown >= steps.length - 1;
  $('#reset-btn').hidden = !done || steps.length <= 2;
  $('#step-hint').textContent = done
    ? ''
    : `Step ${shown} of ${steps.length - 1} — press N for the next one.`;

  renderRules(done);
}

function renderRules(done) {
  const sec = $('#rules-used');
  const used = rulesUsed(steps.slice(0, shown));
  sec.hidden = !done || !used.length;
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
  steps = result.steps;
  shown = wantsAll() ? steps.length : 1;
  render();

  $('#note').hidden = result.complete;
  if (!result.complete) {
    $('#note').textContent = 'This one ran deeper than the page will unfold. '
      + 'The last line is still the correct derivative.';
  }
  updateUrl({ f: src });
}

function wantsAll() {
  const v = getParams().raw.get('steps');
  return v === 'all' || v === 'true';
}

function advance(to) {
  const before = shown;
  shown = Math.min(to, steps.length);
  if (shown === before) return;
  render();
  const s = steps[shown - 1];
  // Screen readers get the rule name — the KaTeX MathML carries the algebra,
  // but nothing in the markup says *why* the line changed.
  announce(s.rules.length
    ? `${s.rules.map(r => ruleInfo(r, varName).name).join(', ')}.`
    : `Step ${shown}.`, 120);
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

    const field = initExpressionInput({
      input: $('#fn-input'),
      error: $('#fn-error'),
      preview: $('#fn-preview'),
      palette: $('#fn-palette'),
      parse: tryParse,
      format: toLatex,
      onChange: rebuild,
    });

    for (const b of document.querySelectorAll('.preset')) {
      b.addEventListener('click', () => field.set(b.dataset.f));
    }

    applyControls(params.raw.get('controls'), params.raw.get('hide'));
    // A slide that takes the step buttons away must not also freeze the working
    // on its first line: with no way to advance, the only sane state is opened.
    if ($('#step-controls').hidden && shown < steps.length) advance(steps.length);

    $('#next-btn').addEventListener('click', () => advance(shown + 1));
    $('#all-btn').addEventListener('click', () => advance(steps.length));
    $('#reset-btn').addEventListener('click', () => { shown = 1; render(); $('#next-btn').focus(); });

    document.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
      const t = /** @type {any} */ (e.target);
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); advance(shown + 1); }
      if (e.key === 'a' || e.key === 'A') { e.preventDefault(); advance(steps.length); }
    });
  },
});
