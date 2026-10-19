/**
 * Implicit differentiation, worked out.
 *
 * The whole difficulty is one step, and students miss the same one every time:
 * in x² + y² = 25, y is not a free letter. It is whatever function of x the
 * equation forces, so d/dx[y²] is 2y·y′ and not 2y. Everything after that is
 * algebra they already have.
 *
 * So the working is deliberately short — four moves, not a rule-by-rule
 * expansion — and the one line that matters carries the reason in the margin
 * every single time. Rule-by-rule belongs in Worked Derivative; this page is
 * about the step that page cannot show.
 */

import {
  num, vr, add, mul, div, ZERO,
  simplify, expand, toLatex, toLatexRaw, isConstant, isNum, numV,
  derivative, linearInSymbol, freeVariables, tryParse, evaluate,
} from './expr.js';

/** Worked lines keep nested fractions full size; see expr.js `dwrap`. */
const DISPLAY = { displayFractions: true };
const show = (/** @type {any} */ n) => toLatexRaw(n, DISPLAY);
const showS = (/** @type {any} */ n) => toLatex(n, DISPLAY);

/**
 * Read `x^2 + y^2 = 25` as two sides.
 * @returns {{lhs:any, rhs:any}|{error:string}}
 */
export function parseEquation(/** @type {string} */ src) {
  const text = String(src || '');
  const parts = text.split('=');
  if (parts.length < 2) return { error: 'This needs to be an equation — it has no = in it.' };
  if (parts.length > 2) return { error: 'I can only read one = sign.' };
  const L = tryParse(parts[0]), R = tryParse(parts[1]);
  if (!L.node) return { error: `Left of the = : ${L.error || 'I could not read that.'}` };
  if (!R.node) return { error: `Right of the = : ${R.error || 'I could not read that.'}` };
  return { lhs: L.node, rhs: R.node };
}

/**
 * @typedef {{text:string, kind:'transition'|'diagnosis'}} Note
 * @typedef {{tex:string, notes:Note[]}} WorkStep
 *
 * @param {any} lhs @param {any} rhs
 * @param {{v?:string, dep?:string}} [opts]
 * @returns {{steps:WorkStep[], answer:any, blocked:string|null}}
 */
export function implicitSteps(lhs, rhs, opts = {}) {
  const v = opts.v || 'x';
  const dep = opts.dep || 'y';
  const prime = `${dep}'`;
  const P = vr(prime);

  /** @type {WorkStep[]} */ const steps = [];
  const T = (/** @type {string} */ t) => ({ text: t, kind: /** @type {const} */ ('transition') });
  const G = (/** @type {string} */ t) => ({ text: t, kind: /** @type {const} */ ('diagnosis') });
  const push = (/** @type {string} */ tex, /** @type {Note[]} */ ...notes) => steps.push({ tex, notes });
  const stop = (/** @type {string} */ reason) => ({ steps, answer: null, blocked: reason });

  push(`${show(lhs)} = ${show(rhs)}`);

  const free = new Set([...freeVariables(lhs), ...freeVariables(rhs)]);
  if (!free.has(dep)) {
    return stop(`There is no ${dep} in this equation, so there is nothing implicit about it. `
      + `Try something like x^2 + y^2 = 25.`);
  }
  if (!free.has(v)) {
    return stop(`There is no ${v} in this equation, so d${dep}/d${v} has nothing to depend on.`);
  }

  push(`\\frac{d}{d${v}}\\!\\left[${show(lhs)}\\right] = \\frac{d}{d${v}}\\!\\left[${show(rhs)}\\right]`,
    T(`differentiate both sides with respect to ${v}`));

  const dL = derivative(lhs, v, { dep, prime });
  const dR = derivative(rhs, v, { dep, prime });
  push(`${show(dL)} = ${show(dR)}`,
    T('the usual rules, applied to both sides'),
    G(`${dep} is a function of ${v}, so every ${dep} term picks up a ${prime} — `
      + `that is the chain rule, and it is the step that is easy to forget`));

  // Everything on one side, then split into (coefficient of y′)·y′ + the rest.
  const split = linearInSymbol(simplify(add(dL, mul(num(-1), dR))), prime);
  if (!split) {
    return stop(`I could not gather the ${prime} terms here — this one is not linear in ${prime}.`);
  }
  if (isNum(split.a) && numV(split.a) === 0) {
    return stop(`Every ${prime} cancelled, so this equation does not determine d${dep}/d${v}.`);
  }

  // expand, not simplify: negating a sum leaves -(3x² - 6y) sitting in brackets,
  // and nobody writes the next line of their work that way.
  const rest = expand(mul(num(-1), split.b));
  push(`${show(mul(split.a, P))} = ${show(rest)}`,
    T(`gather the ${prime} terms on one side and everything else on the other`));

  const answer = simplify(div(rest, split.a));
  push(`${prime} = ${showS(answer)}`,
    T(`divide by the coefficient of ${prime}`),
    G(`it depends on BOTH ${v} and ${dep} — that is normal here, and it is why you `
      + `need a point on the curve before you get a number`));

  return { steps, answer, blocked: null };
}

/**
 * The slope at one point, and whether that point is even on the curve.
 *
 * The check matters: dy/dx here depends on y as well as x, so a student who
 * invents a y gets a number that means nothing. Saying "that point is not on
 * the curve" is the useful answer.
 *
 * @returns {{on:boolean, slope:number}|null}
 */
export function slopeAt(lhs, rhs, answer, xv, yv, opts = {}) {
  const scope = { [opts.v || 'x']: xv, [opts.dep || 'y']: yv };
  const left = evaluate(lhs, scope), right = evaluate(rhs, scope);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  const scale = Math.max(1, Math.abs(left), Math.abs(right));
  return { on: Math.abs(left - right) <= 1e-6 * scale, slope: evaluate(answer, scope) };
}
