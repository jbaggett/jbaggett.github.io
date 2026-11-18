/**
 * Simplifying a derivative, worked out — the algebra after the calculus.
 *
 * Jeff, 2026-11-17: *"The differentiation is the easy step. It's the algebra
 * for simplification that kills them."* Differentiating is a decision
 * procedure — look at the shape, apply the rule — and the rules are few. What
 * comes out the other end is a sum of products of powers that has to be
 * factored before it is any use, and that is where the course actually loses
 * people.
 *
 * One move does nearly all of it: **take out the lowest power of every shared
 * base**. What makes it hard is exactly what makes it one move — when the
 * exponents are fractional the lowest power is the NEGATIVE one, so taking it
 * out RAISES the exponent in every other term. A student who has only ever
 * factored x² out of x³ + x² has never met that, and it is the step they lose.
 * So when it happens, the margin says so in as many words.
 *
 * These lines are NOT shown by default. Asked for the derivative of x²√(x+1),
 * a student early in the course should get the derivative; simplification is a
 * separate skill, asked for separately, with its own button.
 */

import {
  simplify, expand, mul, num, toLatex as toLatexPlain,
  toLatexRaw as toLatexRawPlain, toText,
  factorCommon, integerContent, divideContent, replaceSubtree,
} from './expr.js';

/** Worked lines keep nested fractions full size; see expr.js `dwrap`. */
const DISPLAY = { displayFractions: true };
const show = (/** @type {any} */ n) => toLatexRawPlain(n, DISPLAY);
const showS = (/** @type {any} */ n) => toLatexPlain(n, DISPLAY);

/**
 * The sum that wants factoring, and whatever it is multiplied by.
 *
 * A quotient rule leaves its working inside a product — (stuff)·(denominator)⁻¹
 * — so the sum to factor is one level down. Returning the other factors
 * separately is what lets them be carried through untouched.
 *
 * @param {any} d
 * @returns {{sum:any, others:any[]}|null}
 */
function targetSum(d) {
  if (d.type === 'add') return { sum: d, others: [] };
  if (d.type === 'mul') {
    const i = d.args.findIndex((/** @type {any} */ a) => a.type === 'add');
    if (i >= 0) return { sum: d.args[i], others: d.args.filter((_, k) => k !== i) };
  }
  return null;
}

/**
 * @typedef {{text:string, kind:'transition'|'diagnosis'}} Note
 * @typedef {{tex:string, notes:Note[]}} WorkStep
 *
 * The lines that take a derivative to a form you can read critical numbers
 * off. Empty when there is nothing worth doing — which is the signal a page
 * uses to decide whether to offer the button at all.
 *
 * @param {any} deriv
 * @param {string} [v]
 * @returns {WorkStep[]}
 */
export function simplifySteps(deriv, v = 'x') {
  const T = (/** @type {string} */ t) => ({ text: t, kind: /** @type {const} */ ('transition') });
  const G = (/** @type {string} */ t) => ({ text: t, kind: /** @type {const} */ ('diagnosis') });
  const d = simplify(deriv);
  const target = targetSum(d);
  const fc = target ? factorCommon(target.sum, v) : null;
  if (!fc) {
    // Nothing to take out, but a sum may still be sitting unmultiplied —
    // (2(x+1) + x) over a denominator is one common-factor step from done and
    // one arithmetic step from finished.
    const loose = firstUncollected(d);
    if (!loose) return [];
    const done = simplify(replaceSubtree(d, toText(loose), simplify(expand(loose))));
    if (toText(done) === toText(d)) return [];
    return [{ tex: show(done), notes: [T('multiply out the bracket and collect what is left')] }];
  }

  /** @type {WorkStep[]} */ const steps = [];
  const push = (/** @type {string} */ tex, /** @type {Note[]} */ ...notes) => {
    if (steps.length && steps[steps.length - 1].tex === tex) return;
    steps.push({ tex, notes });
  };

  // ── the common factor, taken out ──────────────────────────────────────────
  const factored = simplify(mul(...target.others, fc.factor, fc.rest));
  const named = fc.common.map(c => showS(c.base));
  // Only the negative ones: the sentence is about them, and listing x¹ beside
  // them while calling the lowest power negative reads as a contradiction.
  const lowest = fc.common.filter(c => c.exp < 0)
    .map(c => `\\(${parenBase(c.base)}^{${fmtExp(c.exp)}}\\)`)
    .join(' and ');
  /** @type {Note[]} */ const why = [];
  why.push(T(fc.common.length
    ? `every term has ${named.length === 1 ? 'a factor of' : 'factors of'} `
      + `${named.map(t => `\\(${t}\\)`).join(' and ')} — take out the lowest power of each`
    : 'every term has the same numeric factor — take it out'));
  if (fc.common.some(c => c.exp < 0)) {
    // The step they lose, said plainly on the line where it happens.
    why.push(G(`the lowest power here is a NEGATIVE one, ${lowest} — so taking it out `
      + `RAISES the exponent in the other terms rather than lowering it, and it is `
      + `what puts everything over one denominator`));
  }
  push(show(factored), ...why);

  // ── the bracket, multiplied out ───────────────────────────────────────────
  let rest = simplify(expand(fc.rest));
  let factor = fc.factor;
  const g = integerContent(rest);
  if (g > 1) { rest = divideContent(rest, g); factor = simplify(mul(factor, num(g))); }
  const done = simplify(mul(...target.others, factor, rest));
  push(show(done), T('multiply out the bracket and collect what is left'));

  // "Multiply out" is sometimes a no-op — x²sin(3x) factors to x(3x cos 3x +
  // 2 sin 3x) and there is nothing to expand — and the dedupe then leaves a
  // single step. That step is still the whole point, so the test is whether
  // anything changed from the derivative, not how many lines came out.
  if (steps.length === 1 && steps[0].tex === show(d)) return [];
  return steps;
}

/**
 * The first sum in here that multiplying out would change.
 *
 * This is how "you are not finished" is told apart from "you wrote it in a
 * different order": term order is already canonical, so a sum that changes
 * under `expand` is genuinely uncollected — 2(x+1) + x does, 3x + 2 does not,
 * and neither does 2 + 3x, which is the same thing written backwards.
 *
 * Only SUMS are tested, never the whole expression. Expanding
 * (x−2)²(x+1)(5x−1) would turn a properly factored answer into a quartic and
 * call it progress, which is the opposite of the point.
 */
function firstUncollected(/** @type {any} */ n) {
  if (!n || typeof n !== 'object') return null;
  if (n.type === 'add') {
    const e = simplify(expand(n));
    if (toText(e) !== toText(n)) return n;
  }
  const kids = n.args || [n.base, n.exp, n.arg].filter(Boolean);
  for (const k of kids) {
    const hit = firstUncollected(k);
    if (hit) return hit;
  }
  return null;
}

/** A base ready to carry an exponent: x needs no brackets, x − 1 does. */
function parenBase(/** @type {any} */ b) {
  const t = showS(b);
  return (b.type === 'var' || b.type === 'num' || b.type === 'const') ? t : `\\left(${t}\\right)`;
}

/** An exponent for prose: −2/3 rather than −0.667. */
function fmtExp(/** @type {number} */ e) {
  if (Number.isInteger(e)) return String(e);
  for (let den = 2; den <= 12; den += 1) {
    const top = e * den;
    if (Math.abs(top - Math.round(top)) < 1e-9) {
      return `${Math.round(top) < 0 ? '-' : ''}\\frac{${Math.abs(Math.round(top))}}{${den}}`;
    }
  }
  return String(Number(e.toFixed(3)));
}

/**
 * Is this expression already simplified, in the sense the course means?
 *
 * Equality is not the question — the unsimplified derivative is equal to the
 * simplified one, so a numeric check alone can never tell a student they have
 * finished. This asks the question that matters: would the simplifier still
 * have something to do? If it would, they are not done.
 *
 * @param {any} node @param {string} [v]
 * @returns {boolean}
 */
export function looksSimplified(node, v = 'x') {
  return simplifySteps(node, v).length === 0;
}
