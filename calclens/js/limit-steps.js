/**
 * The difference quotient, worked out — lim(h→0) [f(a+h) − f(a)] / h.
 *
 * The rule that shapes every line here: **the equality column holds only
 * genuine equalities.** `lim … = 0/0` is false — 0/0 is not a value the limit
 * equals, it is the result of an attempt that failed — and it is exactly the
 * error students reproduce on exams. So "substituting h = 0 gives 0/0" is a
 * DIAGNOSIS note in the margin, never a line. For the same reason `lim` rides
 * every line until the limit is actually taken: dropping it early and writing
 * `= 12 + 2h = 12` is the same false equality in a different place.
 *
 * Three algebraic routes cover what Calculus 1 asks for, chosen by looking at
 * the numerator f(a+h) − f(a):
 *
 *   polynomial  multiply out, collect, factor h, cancel
 *   rational    common denominator, collect, factor h, cancel
 *   conjugate   multiply by the conjugate to clear the root, then as above
 *
 * Anything needing a special limit (sin h / h, (eʰ − 1)/h) is DECLINED rather
 * than guessed at: a limits tool that confidently states a wrong limit is worse
 * than no tool. The caller is handed the derivative found by the rules instead,
 * and says so.
 */

import {
  num, vr, add, mul, pow, sub, div, ZERO, ONE,
  simplify, expand, substitute, toLatex as toLatexPlain, toLatexRaw as toLatexRawPlain, toText,
  isConstant, isNum, numV, evaluate, compile, derivative,
} from './expr.js';

/** Worked lines keep nested fractions full size; see expr.js `dwrap`. */
const DISPLAY = { displayFractions: true };
const toLatexRaw = (/** @type {any} */ n) => toLatexRawPlain(n, DISPLAY);
const toLatex = (/** @type {any} */ n) => toLatexPlain(n, DISPLAY);

const dependsOn = (/** @type {any} */ n, /** @type {string} */ v) => !isConstant(n, v);

/** Walk every node. */
function walk(/** @type {any} */ n, /** @type {(x:any)=>void} */ fn) {
  if (!n || typeof n !== 'object') return;
  fn(n);
  if (n.args) n.args.forEach(a => walk(a, fn));
  if (n.type === 'pow') { walk(n.base, fn); walk(n.exp, fn); }
  if (n.type === 'fn') walk(n.arg, fn);
}

/** A root of something that moves with `v` — `sqrt(x + h)`, not `sqrt(2)`. */
function hasRadical(/** @type {any} */ n, /** @type {string} */ v) {
  let found = false;
  walk(n, x => {
    if (x.type === 'pow' && isNum(x.exp)
      && Math.abs(numV(x.exp) - Math.round(numV(x.exp))) > 1e-12
      && dependsOn(x.base, v)) found = true;
  });
  return found;
}

/** A denominator that moves with `v` — canonical form spells it as a ⁻¹ power. */
function hasNegPower(/** @type {any} */ n, /** @type {string} */ v) {
  let found = false;
  walk(n, x => {
    if (x.type === 'pow' && isNum(x.exp) && numV(x.exp) < 0 && dependsOn(x.base, v)) found = true;
  });
  return found;
}

/**
 * Is this function outside what algebra alone will do?
 * @returns {string|null} a reason, in the student's language
 */
export function beyondScope(/** @type {any} */ f, /** @type {string} */ v) {
  let reason = null;
  walk(f, x => {
    if (reason) return;
    if (x.type === 'fn' && dependsOn(x, v)) {
      reason = x.name === 'abs'
        ? 'An absolute value has to be split into cases before the quotient can be simplified.'
        : `Working out this one by hand needs a special limit (such as sin h / h → 1), not algebra.`;
    }
    if (x.type === 'pow' && dependsOn(x.exp, v)) {
      reason = 'A variable in the exponent needs a special limit, not algebra.';
    }
  });
  return reason;
}

/**
 * Multiply, flat and without the ×1 nobody writes.
 *
 * Flattening matters for the PRINTER: `mul(mul(-1, x), (x + h + 1))` hides its
 * leading minus one level down, and the sum containing it printed
 * `+ -x(x + h + 1)` instead of `- x(x + h + 1)`.
 */
function prod(/** @type {any[]} */ xs) {
  const flat = [];
  for (const a of xs) { if (a.type === 'mul') flat.push(...a.args); else flat.push(a); }
  const kept = flat.filter(a => !(isNum(a) && numV(a) === 1));
  if (!kept.length) return ONE;
  return kept.length === 1 ? kept[0] : mul(...kept);
}
const isOne = (/** @type {any} */ n) => isNum(n) && numV(n) === 1;

/**
 * Read one term as num/den. Canonical form has no `div`, so this undoes it.
 *
 * Deliberately variable-free. Asking "does this denominator move with x?" gets
 * f′(2) wrong — after substituting the point, everything is in h and nothing
 * moves with x — and asking about h gets the symbolic case wrong, because the
 * 1/x term's denominator is constant in h but is still a denominator. Anything
 * raised to a negative power that is not a bare number goes underneath.
 */
function splitFrac(/** @type {any} */ t) {
  const factors = t.type === 'mul' ? t.args : [t];
  /** @type {any[]} */ const top = [];
  /** @type {any[]} */ const bottom = [];
  for (const a of factors) {
    // A NUMBER underneath is still a denominator. Excluding it left f′(2) for
    // 1/x showing (1 − (h+2)/2)/(h+2) — correct, and three fractions deep —
    // where the textbook has (2 − (2+h)) / 2(2+h).
    if (a.type === 'pow' && isNum(a.exp) && numV(a.exp) < 0) {
      bottom.push(simplify(pow(a.base, num(-numV(a.exp)))));
    } else top.push(a);
  }
  if (!bottom.length) return { num: t, den: ONE };
  return { num: prod(top), den: prod(bottom) };
}

/**
 * Put a sum of fractions over one denominator — the step a student writes as
 * "common denominator". Returns null if there was nothing to combine.
 */
export function combineFraction(/** @type {any} */ n) {
  const terms = n.type === 'add' ? n.args : [n];
  const parts = terms.map(splitFrac);
  /** @type {any[]} */ const dens = [];
  for (const p of parts) {
    if (isOne(p.den)) continue;
    if (!dens.some(d => toText(d) === toText(p.den))) dens.push(p.den);
  }
  if (!dens.length) return null;
  const den = prod(dens);
  const nums = parts.map(p => prod([p.num, ...dens.filter(d => toText(d) !== toText(p.den))]));
  return { num: nums.length === 1 ? nums[0] : add(...nums), den };
}

/** Q with n = h·Q, or null when h does not divide the numerator evenly. */
function factorOutVar(/** @type {any} */ n, /** @type {string} */ h) {
  // `expand`, not `simplify`: dividing a SUM by h has to reach every term.
  // simplify treats (4xh + 2h²)·h⁻¹ as one opaque factor times h⁻¹ and cancels
  // nothing, so every polynomial difference quotient came back unfactorable.
  const q = expand(mul(n, pow(vr(h), num(-1))));
  return hasNegPower(q, h) ? null : q;
}

/** The answer the differentiation rules give — the independent check. */
function agrees(/** @type {any} */ ans, /** @type {any} */ f, /** @type {string} */ v, /** @type {any} */ at) {
  const dF = derivative(f, v);
  if (at) {
    const want = compile(dF, v)(evaluate(at, {}));
    const got = evaluate(ans, {});
    return Number.isFinite(want) && Number.isFinite(got)
      && Math.abs(want - got) <= 1e-7 * Math.max(1, Math.abs(want));
  }
  const g = compile(ans, v), w = compile(dF, v);
  let checked = 0;
  for (let i = 1; i <= 40; i++) {
    const x = -2.4 + 5 * ((0.5 + i * 0.6180339887498949) % 1);
    const a = g(x), b = w(x);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (Math.abs(a - b) > 1e-6 * Math.max(1, Math.abs(b))) return false;
    checked += 1;
  }
  return checked >= 6;
}

/* ───────────────────────────── the derivation ──────────────────────────── */

/**
 * @typedef {{text:string, kind:'transition'|'diagnosis'}} Note
 * @typedef {{tex:string, notes:Note[]}} WorkStep
 *
 * @param {any} f            the function, as a parsed node
 * @param {{v?:string, h?:string, at?:any, name?:string}} [opts]
 *   `at` is the point, as a node; omit it for the general derivative f′(x).
 * @returns {{steps:WorkStep[], answer:any, blocked:string|null, method:string|null, viaRules:any}}
 */
export function differenceQuotientSteps(f, opts = {}) {
  const v = opts.v || 'x';
  const h = opts.h || 'h';
  const at = opts.at || null;
  const name = opts.name || 'f';
  const H = vr(h);
  const A = at || vr(v);
  const aTex = toLatex(A);
  const aTxt = toText(A);

  /** @type {WorkStep[]} */ const steps = [];
  const T = (/** @type {string} */ t) => ({ text: t, kind: /** @type {const} */ ('transition') });
  const G = (/** @type {string} */ t) => ({ text: t, kind: /** @type {const} */ ('diagnosis') });
  const lim = (/** @type {string} */ inner) => `\\lim_{${h} \\to 0}${inner}`;
  // `lim(h→0) 4x + 2h` reads as (lim 4x) + 2h. A bare sum under a limit needs
  // its brackets; a fraction is self-bracketing and does not.
  const limOf = (/** @type {any} */ n) =>
    lim(n.type === 'add' ? `\\left(${toLatexRaw(n)}\\right)` : toLatexRaw(n));
  // "Factor h OUT" is written with the h in front, and that is also where it
  // lines up with the h underneath it that it is about to cancel with.
  const hTimes = (/** @type {any} */ q) =>
    (isNum(q) ? toLatexRaw(prod([H, q])) : `${h}\\left(${toLatexRaw(q)}\\right)`);
  // Both parts display style, so a compound fraction — the common-denominator
  // line is one — does not shrink its way out of legibility.
  const frac = (/** @type {string} */ a, /** @type {string} */ b) =>
    `\\frac{\\displaystyle ${a}}{\\displaystyle ${b}}`;
  const push = (/** @type {string} */ tex, /** @type {Note[]} */ ...notes) => steps.push({ tex, notes });
  const viaRules = derivative(f, v);
  const stop = (/** @type {string} */ reason) =>
    ({ steps: dedupe(steps), answer: null, blocked: reason, method: null, viaRules });

  // The definition, written with the function's NAME — the line every one of
  // these problems starts from, before any particular f is put into it.
  push(lim(frac(`${name}\\!\\left(${aTex} + ${h}\\right) - ${name}\\!\\left(${aTex}\\right)`, h)),
    T('the definition of the derivative'));

  const outOfScope = beyondScope(f, v);
  if (outOfScope) return stop(outOfScope);

  const fAh = substitute(f, v, add(A, H));
  // f(a) is worked out when a is a number — a student writes f(1) = 4, not
  // 5·1² − 3 + 2, and leaving it unevaluated made one half of the subtraction
  // expanded and the other half not. f(x + h) stays as written: expanding it is
  // its own step.
  const fA = at ? simplify(substitute(f, v, A)) : substitute(f, v, A);

  if (at) {
    const y = evaluate(fA, {});
    if (!Number.isFinite(y)) {
      return stop(`${name} is not defined at ${v} = ${aTxt}, so it has no derivative there.`);
    }
  }

  const N0 = sub(fAh, fA);
  push(lim(frac(toLatexRaw(N0), h)),
    T(`substitute ${name}(${aTxt} + ${h}) and ${name}(${aTxt})`),
    G(`substituting ${h} = 0 gives 0/0 — indeterminate, so the quotient has to be rewritten`));

  /** The numerator, and whatever else ends up under the line beside h. */
  let P, Q = ONE, method;
  /** Denominator as a node, so its brackets come out of the printer, not me. */
  const under = (/** @type {any} */ q) => (isOne(q) ? H : prod([H, q]));

  if (hasRadical(N0, h)) {
    method = 'conjugate';
    const conj = add(fAh, fA);
    const sqA = simplify(pow(fAh, num(2)));
    const sqB = simplify(pow(fA, num(2)));
    const cleared = expand(sub(sqA, sqB));
    // The conjugate only pays when it actually clears the root: it does for
    // sqrt(x), and it does not for sqrt(x) + x, where squaring leaves a cross
    // term. Better to decline than to print three lines that go nowhere.
    if (hasRadical(cleared, h)) {
      return stop('The conjugate does not clear this root — a root mixed with other '
        + 'terms needs each piece handled separately.');
    }
    push(lim(frac(`\\left(${toLatexRaw(fAh)} - ${toLatexRaw(fA)}\\right)\\left(${toLatexRaw(conj)}\\right)`,
      toLatexRaw(prod([H, conj])))),
      T('multiply top and bottom by the conjugate'));
    push(lim(frac(toLatexRaw(sub(sqA, sqB)), toLatexRaw(prod([H, conj])))),
      T('(a − b)(a + b) = a² − b², and the roots are gone'));
    P = cleared; Q = conj;
    push(lim(frac(toLatexRaw(P), toLatexRaw(prod([H, conj])))), T('collect the numerator'));
  } else if (hasNegPower(N0, h)) {
    method = 'rational';
    const comb = combineFraction(simplify(N0));
    if (!comb) return stop('I could not put this numerator over a common denominator.');
    push(lim(frac(frac(toLatexRaw(comb.num), toLatexRaw(comb.den)), h)),
      T('put the numerator over a common denominator'));
    push(lim(frac(toLatexRaw(comb.num), toLatexRaw(under(comb.den)))),
      T(`dividing by ${h} puts an ${h} in the denominator`));
    P = expand(comb.num); Q = comb.den;
    push(lim(frac(toLatexRaw(P), toLatexRaw(under(Q)))), T('multiply out and collect the numerator'));
  } else {
    method = 'polynomial';
    const ex = expand(fAh);
    push(lim(frac(toLatexRaw(sub(ex, fA)), h)), T(`multiply out ${name}(${aTxt} + ${h})`));
    // expand, not simplify: f(a) arrives as a bracketed sum being subtracted,
    // and until the minus sign is distributed over it nothing cancels —
    // 3x + 3h + 1 − (3x + 1) collected to "3x − (3x + 1) + 3h + 1".
    P = expand(sub(ex, fA));
    push(lim(frac(toLatexRaw(P), h)),
      T(`collect like terms — everything without an ${h} in it cancels`));
  }

  // A constant function: the numerator is 0 for every h, so nothing is
  // indeterminate any more and there is nothing left to cancel.
  if (isNum(P) && numV(P) === 0) {
    push('0', T(`the numerator is 0 for every ${h}, so the quotient is 0`));
    return { steps: dedupe(steps), answer: ZERO, blocked: null, method, viaRules };
  }

  const Qn = factorOutVar(P, h);
  if (!Qn) {
    return stop(`After the rewrite there is still no ${h} to cancel, so this is not a `
      + 'case the page can finish by algebra.');
  }

  push(lim(frac(hTimes(Qn), toLatexRaw(under(Q)))), T(`factor ${h} out of the numerator`));

  const cancelled = isOne(Q) ? Qn : div(Qn, Q);
  push(limOf(cancelled),
    T(`cancel ${h}`),
    G(`valid: the limit never uses ${h} = 0, so this is never 0/0`));

  const answer = simplify(substitute(cancelled, h, ZERO));
  if (!agrees(answer, f, v, at)) {
    return stop('The algebra and the differentiation rules disagree here, so the page '
      + 'will not show a result it cannot stand behind.');
  }
  push(toLatex(answer), T(`substitute ${h} = 0 — this expression is continuous there`));

  return { steps: dedupe(steps), answer, blocked: null, method, viaRules };
}

/** A pass that changed nothing visible is not a step worth a line. */
function dedupe(/** @type {WorkStep[]} */ steps) {
  const out = [];
  for (const s of steps) {
    const prev = out[out.length - 1];
    if (prev && prev.tex === s.tex) { prev.notes = [...prev.notes, ...s.notes]; continue; }
    out.push(s);
  }
  return out;
}
