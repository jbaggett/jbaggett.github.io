/**
 * Check My Answer — verify a derivative or an antiderivative.
 *
 * The design claim: student answers should be checked NUMERICALLY, not
 * symbolically. Proving two expressions equal is hard, brittle, and rejects
 * correct answers written in an unexpected form — which is the worst possible
 * failure mode for a homework aid. Probing both functions at a spread of x
 * values is ten lines, never rejects a correct answer for cosmetic reasons, and
 * hands back a specific counterexample when the answer really is wrong.
 *
 * For an antiderivative it goes one better: differentiate the STUDENT's answer
 * and compare that to the integrand. This is the check the course wants them to
 * internalise, so the tool performs the very method it is teaching, and says so.
 *
 * Sampling uses a golden-ratio low-discrepancy sequence rather than a PRNG:
 * deterministic (the same answer always gets the same verdict), and better
 * spread than random points.
 */

import { createChart, makeScales, drawAxes } from 'kit/chart.js';
import { drawCurve, autoYDomain } from 'kit/curve.js';
import { initPage, announce } from 'kit/page.js';
import { getParams, updateUrl } from 'kit/url.js';
import { tex, setTex } from 'kit/tex.js';
import { fmt } from 'kit/format.js';
import {
  tryParse, compile, derivative, antiderivative, toLatex, numericallyEqual,
} from '../../js/expr.js';

const $ = (/** @type {string} */ s) => /** @type {any} */ (document.querySelector(s));

const PHI = 0.6180339887498949;
/** Deterministic, well-spread probe points — the same answer always scores the same. */
function lowDiscrepancy() {
  let i = 0;
  return () => { i += 1; return (0.5 + i * PHI) % 1; };
}

let mode = 'anti';   // 'anti' | 'deriv'
let chart = null;

/* ─────────────────────────────── checking ──────────────────────────────── */

/**
 * @param {any} problem  the f the student was given
 * @param {any} answer   what the student wrote
 * @returns {{ok:boolean, reason:string, compare:{a:(x:number)=>number, b:(x:number)=>number}, worstX:number|null}}
 */
function check(problem, answer) {
  // In both modes the test is the same shape: differentiate whichever side
  // needs differentiating, then compare two plain functions.
  const target = mode === 'anti' ? problem : derivative(problem);
  const fromAnswer = mode === 'anti' ? derivative(answer) : answer;

  const a = compile(target);
  const b = compile(fromAnswer);
  const res = numericallyEqual(a, b, { rng: lowDiscrepancy(), samples: 80, tol: 1e-6, lo: -2.4, hi: 2.6 });

  if (res.checked < 8) {
    return {
      ok: false,
      reason: 'I could not find enough points where both are defined — try a problem '
        + 'whose domain includes part of −2 to 3, or check for a typo.',
      compare: { a, b },
      worstX: null,
    };
  }
  // Find a specific x to hand back — a counterexample beats a verdict.
  let worstX = null, worstErr = 0;
  const probe = lowDiscrepancy();
  for (let i = 0; i < 200; i++) {
    const x = -2.4 + 5 * probe();
    const va = a(x), vb = b(x);
    if (!Number.isFinite(va) || !Number.isFinite(vb)) continue;
    if (Math.abs(va) > 1e8 || Math.abs(vb) > 1e8) continue;
    const err = Math.abs(va - vb) / Math.max(1, Math.abs(va), Math.abs(vb));
    if (err > worstErr) { worstErr = err; worstX = x; }
  }
  return {
    ok: res.equal,
    reason: res.equal ? `Checked at ${res.checked} different values of x — they agree at every one.` : '',
    compare: { a, b },
    worstX,
  };
}

function run() {
  const pRes = tryParse($('#f-input').value);
  const aRes = tryParse($('#ans-input').value);
  showError('#f-error', '#f-input', pRes);
  showError('#ans-error', '#ans-input', aRes);
  if (!pRes.node || !aRes.node) {
    $('#result-line').innerHTML = '';
    $('#detail').innerHTML = '';
    $('#chart-wrap').hidden = true;
    return;
  }

  updateUrl({ f: $('#f-input').value, mode });

  const { ok, reason, compare, worstX } = check(pRes.node, aRes.node);
  // "an antiderivative" (there are many) but "the derivative" (there is one).
  const phrase = mode === 'anti' ? 'an antiderivative' : 'the derivative';

  $('#result-line').innerHTML = ok
    ? `<span class="ll-verdict ok">✓ Correct.</span> Your answer is ${phrase} of the problem.`
    : `<span class="ll-verdict bad">✗ Not quite.</span> That is not ${phrase} of the problem.`;
  announce(ok ? 'Correct.' : 'Not correct.', 120);

  const detail = [];
  if (ok) {
    detail.push(`<p>${reason}</p>`);
    if (mode === 'anti') {
      detail.push(`<p>Here is the check written out — differentiate your answer and `
        + `you get back the integrand:<br>`
        + `${tex(`\\frac{d}{dx}\\left[${toLatex(aRes.node)}\\right] = ${toLatex(derivative(aRes.node))}`, { display: true })}</p>`
        + `<p class="ll-hint">Do this on every antiderivative you hand in. Differentiating `
        + `is the easy direction, and it catches almost every slip.</p>`);
    }
  } else if (worstX !== null) {
    const va = compare.a(worstX), vb = compare.b(worstX);
    const label = mode === 'anti'
      ? ['the integrand', "the derivative of your answer"]
      : ["the true derivative", 'your answer'];
    detail.push(
      `<p>At <b>x = ${fmt(worstX, 2)}</b>, ${label[0]} is <b>${fmt(va, 4)}</b> `
      + `but ${label[1]} is <b>${fmt(vb, 4)}</b>. Substituting ${fmt(worstX, 2)} back `
      + `into your work is usually the quickest way to find the slip.</p>`);
    if (mode === 'anti') {
      detail.push(`<p>Differentiating your answer gives `
        + `${tex(toLatex(derivative(aRes.node)))}, and the problem asks for `
        + `${tex(toLatex(pRes.node))}.</p>`);
    }
  }
  $('#detail').innerHTML = detail.join('');

  drawComparison(compare);
}

function showError(errSel, inputSel, res) {
  const el = $(errSel);
  if (res.node) {
    el.hidden = true; el.textContent = '';
    $(inputSel).setAttribute('aria-invalid', 'false');
  } else {
    const src = $(inputSel).value;
    const caret = typeof res.pos === 'number' && res.pos < src.length
      ? ` (at "${src[res.pos]}", character ${res.pos + 1})` : '';
    el.textContent = (res.error || 'I could not read that.') + caret;
    el.hidden = false;
    $(inputSel).setAttribute('aria-invalid', 'true');
  }
}

function drawComparison({ a, b }) {
  $('#chart-wrap').hidden = false;
  $('#chart-caption').textContent = mode === 'anti'
    ? 'The integrand, and the derivative of your answer. A correct answer puts the dashed curve exactly on the solid one.'
    : 'The true derivative, and your answer. A correct answer puts the dashed curve exactly on the solid one.';
  $('#leg-a').textContent = mode === 'anti' ? 'the integrand f(x)' : 'the true derivative';
  $('#leg-b').textContent = mode === 'anti' ? 'derivative of your answer' : 'your answer';

  chart = createChart('#chart', { height: 300, label: 'Comparison of the required function and the one implied by your answer' });
  const dom = [-3, 3];
  const yA = autoYDomain(a, dom[0], dom[1], { minSpan: 2 });
  const yB = autoYDomain(b, dom[0], dom[1], { minSpan: 2 });
  const yDom = [Math.min(yA[0], yB[0]), Math.max(yA[1], yB[1])];
  const { xs, ys } = makeScales(chart, dom, yDom);
  drawAxes(chart, { xs, ys, xLabel: 'x', yLabel: 'y' });
  drawCurve(chart.plot, a, { xs, ys, className: 'll-curve' });
  drawCurve(chart.plot, b, { xs, ys, className: 'll-curve-df' });
}

/* ────────────────────────────────── modes ──────────────────────────────── */

function setMode(next) {
  mode = next;
  $('#mode-anti').setAttribute('aria-pressed', String(mode === 'anti'));
  $('#mode-deriv').setAttribute('aria-pressed', String(mode === 'deriv'));
  setTex($('#f-prompt'), mode === 'anti' ? '\\int f(x)\\,dx \\quad\\text{where}\\quad f(x) =' : "f(x) =");
  $('#ans-label').innerHTML = mode === 'anti'
    ? 'Your answer: <span class="ll-math"></span>F(x) ='
    : "Your answer: f ′(x) =";
  $('#c-note').hidden = mode !== 'anti';
  $('#result-line').innerHTML = '';
  $('#detail').innerHTML = '';
  $('#chart-wrap').hidden = true;
}

function showOne() {
  const pRes = tryParse($('#f-input').value);
  if (!pRes.node) { showError('#f-error', '#f-input', pRes); return; }
  if (mode === 'deriv') {
    $('#detail').innerHTML = `<p>One correct answer: `
      + `${tex(toLatex(derivative(pRes.node)), { display: true })}</p>`;
    return;
  }
  const F = antiderivative(pRes.node);
  $('#detail').innerHTML = F
    ? `<p>One correct answer: ${tex(`${toLatex(F)} + C`, { display: true })}</p>`
      + `<p class="ll-hint">Any expression differing from this by a constant is equally correct.</p>`
    : `<p><b>This one is outside what I can do symbolically.</b> Either it needs a `
      + `technique beyond Calculus 1's standard table and linear substitution, or it `
      + `has no elementary antiderivative at all — <span class="ll-math">${tex('e^{-x^2}')}</span> `
      + `is the famous example. Your own answer can still be checked above.</p>`;
}

/* ────────────────────────────────── boot ───────────────────────────────── */

initPage({
  onReady() {
    const params = getParams();
    if (params.f) $('#f-input').value = params.f;
    if (params.mode === 'deriv' || params.mode === 'anti') mode = params.mode;

    setTex($('#plusc'), '+\\,C');
    setTex($('#help-tex1'), '\\tfrac{1}{2}\\sin^2 x');
    setTex($('#help-tex2'), '-\\tfrac{1}{2}\\cos^2 x');
    setMode(mode);

    $('#mode-anti').addEventListener('click', () => setMode('anti'));
    $('#mode-deriv').addEventListener('click', () => setMode('deriv'));
    $('#check-btn').addEventListener('click', run);
    $('#show-btn').addEventListener('click', showOne);

    for (const sel of ['#f-input', '#ans-input']) {
      $(sel).addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
        if (e.key === 'Enter') { e.preventDefault(); run(); }
      });
    }
  },
});
