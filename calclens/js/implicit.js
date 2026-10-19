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
  simplify, expand, toLatex, toLatexRaw, toText, isConstant, isNum, numV,
  derivative, linearInSymbol, freeVariables, tryParse, evaluate,
  integerContent, divideContent,
} from './expr.js';
import { beginDeriv, stepOnce, hasPending, ruleInfo } from './steps.js';

/** Worked lines keep nested fractions full size; see expr.js `dwrap`. */
const DISPLAY = { displayFractions: true };
const gcd2 = (/** @type {number} */ a, /** @type {number} */ b) => (b ? gcd2(b, a % b) : a);
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
 * Guess which letter depends on which, from the equation itself.
 *
 * Nobody should have to tell the page that V = (4/3)πr³ is about dV/dr. Three
 * readings, in order: x and y together mean dy/dx; a side that is a lone
 * variable names itself the dependent one; otherwise a conventional independent
 * letter is preferred. Falls back to y and x when it cannot tell.
 *
 * @returns {{dep:string, v:string}}
 */
export function pickLetters(lhs, rhs) {
  const free = [...new Set([...freeVariables(lhs), ...freeVariables(rhs)])];
  if (free.includes('x') && free.includes('y')) return { dep: 'y', v: 'x' };
  if (free.length < 2) return { dep: free[0] || 'y', v: 'x' };

  const lone = (/** @type {any} */ n) => (n.type === 'var' ? n.name : null);
  const named = lone(lhs) || lone(rhs);

  // The letters a course reaches for when it means "the thing varying".
  const prefer = ['x', 't', 'u', 'r'].find(c => free.includes(c) && c !== named);
  const v = prefer || free.find(c => c !== named) || free[0];
  const dep = (named && named !== v) ? named : (free.find(c => c !== v) || 'y');
  return { dep, v };
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

  // Both sides advance in LOCKSTEP, one rule per line each. Collapsing this
  // into a single "the usual rules, applied to both sides" hid three rules
  // firing at once on cos(x²y³) = x⁵y² — a chain rule and a product rule on the
  // left, a product rule on the right — which is exactly the part a student
  // cannot do yet. The two sides must step together or the lines stop being
  // equations.
  let L = beginDeriv(lhs, v);
  let R = beginDeriv(rhs, v);
  push(`${show(L)} = ${show(R)}`, T(`differentiate both sides with respect to ${v}`));

  let guard = 0;
  while ((hasPending(L) || hasPending(R)) && guard++ < 16) {
    const a = hasPending(L) ? stepOnce(L, v, { dep, prime }) : { node: L, rules: [] };
    const b = hasPending(R) ? stepOnce(R, v, { dep, prime }) : { node: R, rules: [] };
    L = a.node; R = b.node;
    const rules = [...new Set([...a.rules, ...b.rules])];
    const line = `${show(L)} = ${show(R)}`;
    if (line === steps[steps.length - 1].tex) continue;
    // The dependent rule is left out of the plain list: the diagnosis below
    // says the same thing and says more, and printing both put "y is a function
    // of x" on the line twice.
    const notes = rules.filter(r => !r.startsWith('dep:')).map(r => T(ruleInfo(r, v).name));
    if (rules.some(r => r.startsWith('dep:'))) {
      notes.push(G(`${dep} is a function of ${v}, so differentiating it leaves a ${prime} `
        + `behind — that is the chain rule, and it is the step that is easy to forget`));
    }
    push(line, ...notes);
  }

  const dL = simplify(L);
  const dR = simplify(R);
  const tidied = `${show(dL)} = ${show(dR)}`;
  if (tidied !== steps[steps.length - 1].tex) push(tidied, T('tidy up'));

  // ── already solved? ────────────────────────────────────────────────────
  // An explicit function put through this machinery — y = 3x³ + sin(x) — comes
  // out as y′ = … on the tidy-up line, and the three moves that follow are all
  // no-ops: "1y′ = …", then the same line again, then the same line a third
  // time. Stopping here makes one tool serve explicit and implicit alike, which
  // is the honest position anyway: implicit differentiation CONTAINS the
  // ordinary kind, it is not a different procedure.
  const solvedLeft = toText(dL) === prime && isConstant(dR, prime);
  const solvedRight = toText(dR) === prime && isConstant(dL, prime);
  if (solvedLeft || solvedRight) {
    const ans = solvedLeft ? dR : dL;
    if (solvedRight) push(`${prime} = ${showS(ans)}`, T(`write it with ${prime} on the left`));
    steps[steps.length - 1].notes.push(
      G(`${dep} was given explicitly, so there was nothing to gather — the same `
        + `machinery just does ordinary differentiation, which is why it is one `
        + `procedure and not two`));
    return { steps, answer: ans, blocked: null };
  }

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
  // Gathering and factoring are two moves, and the second is the one students
  // stall on: seeing 3y²y′ − 6xy′ and not recognising that y′ comes out of it.
  const gathered = `${show(expand(mul(split.a, P)))} = ${show(rest)}`;
  push(gathered, T(`gather the ${prime} terms on one side and everything else on the other`));

  // Only when there is something to factor. With a single y′ term the two lines
  // are the same line, and 2yy′ = −2x does not need saying twice.
  const factored = `${show(mul(split.a, P))} = ${show(rest)}`;
  if (factored !== gathered) {
    push(factored, T(`factor the ${prime} out of the left-hand side`));
  }

  const raw = simplify(div(rest, split.a));
  push(`${prime} = ${showS(raw)}`, T(`divide by the coefficient of ${prime}`));

  // Lowest terms, as its own line. The folium's slope falls out of the algebra
  // as (-3x² + 6y)/(3y² - 6x), and a student comparing that to the book sees a
  // different answer. Cancelling silently inside the previous step would be
  // worse — three 3s would just vanish.
  const g = gcd2(integerContent(rest), integerContent(split.a));
  const answer = g > 1
    ? simplify(div(divideContent(rest, g), divideContent(split.a, g)))
    : raw;
  // Only when it actually changes the line. For x² + y² = 25 the content is 2
  // on both sides, but simplify had already folded it into the single fraction,
  // so announcing the cancellation would print the same line twice.
  const reduced = `${prime} = ${showS(answer)}`;
  if (reduced !== steps[steps.length - 1].tex) {
    push(reduced, T(`divide the top and bottom by ${g}`));
  }
  if (!isConstant(answer, dep)) {
    steps[steps.length - 1].notes.push(
      G(`it depends on BOTH ${v} and ${dep} — that is normal here, and it is why you `
        + `need a point on the curve before you get a number`));
  }

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
