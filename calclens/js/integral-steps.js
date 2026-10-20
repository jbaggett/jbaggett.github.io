/**
 * Antidifferentiation, worked out — ∫f(x) dx, one rule per line.
 *
 * Two rules shape every line here, both inherited from the derivative and limit
 * tools and both about not writing things that are false:
 *
 * **The equality column holds only genuine equalities.** ∫f dx is not equal to
 * F(x); it is equal to F(x) + C, so the constant appears on the FIRST line
 * where no integral sign is left and on every line after it. And a change of
 * variable is an equality — ∫2x·cos(x²) dx = ∫cos u du is true — so it belongs
 * in the column, while the reasoning that chose u belongs in the margin.
 *
 * **A composite argument goes through a visible substitution.** The engine can
 * do ∫cos(3x+1) dx by looking up cos and dividing by 3, and that is exactly the
 * move students perform without understanding and then misapply to ∫cos(x²) dx.
 * So the table only fires on a BARE variable, and anything composite is made to
 * show its substitution. The silent shortcut stays in `antiderivative()`, where
 * the answer is all that is wanted.
 *
 * Scope is Calculus 1, which this semester means up to u-substitution: table,
 * linearity, constant multiples, multiplying out, and change of variable.
 * Integration by parts, partial fractions and trigonometric substitution are
 * Calculus 2 and are DECLINED by name — a page that confidently shows wrong
 * working is worse than a page that says "not this one".
 */

import {
  ANTI, FUNCTIONS, num, vr, add, mul, pow, fn, neg, sub, div, ZERO, ONE,
  simplify, expand, toLatex as toLatexPlain, toLatexRaw as toLatexRawPlain, toText,
  isConstant, isNum, numV, evaluate, derivative, findUSub, replaceSubtree,
  freeVariables, antiderivative, linearCoeffs, expandIfShorter, compile,
  integerContent, divideContent,
} from './expr.js';

/** Worked lines keep nested fractions full size; see expr.js `dwrap`. */
const DISPLAY = { displayFractions: true };
const show = (/** @type {any} */ n) => toLatexRawPlain(n, DISPLAY);
const showS = (/** @type {any} */ n) => toLatexPlain(n, DISPLAY);

const ln = (/** @type {any} */ a) => fn('ln', a);
const abs = (/** @type {any} */ a) => fn('abs', a);
/** A pending integral. @param {any} arg @param {string} v */
const I = (arg, v) => ({ type: 'integ', arg, v });
const prod = (/** @type {any[]} */ fs) => (fs.length === 1 ? fs[0] : mul(...fs));

/**
 * The rules, with the statement each one is applied by. `@` stands for the
 * variable in play, so a problem written in t is never told about x.
 */
export const RULES = {
  constant:   { name: 'Integral of a constant', tex: '\\int c\\,d@ = c@ + C' },
  sum:        { name: 'Sum rule', tex: '\\int \\left[f + g\\right]d@ = \\int f\\,d@ + \\int g\\,d@' },
  coeff:      { name: 'Constant multiple', tex: '\\int c\\,f\\,d@ = c\\int f\\,d@' },
  power:      { name: 'Power rule', tex: '\\int @^{n}\\,d@ = \\frac{@^{n+1}}{n+1} + C \\quad (n \\neq -1)' },
  reciprocal: { name: 'The exception to the power rule', tex: '\\int \\frac{1}{@}\\,d@ = \\ln\\left|@\\right| + C' },
  expe:       { name: 'Integral of eˣ', tex: '\\int e^{@}\\,d@ = e^{@} + C' },
  exponential:{ name: 'Integral of an exponential', tex: '\\int a^{@}\\,d@ = \\frac{a^{@}}{\\ln a} + C' },
  expand:     { name: 'Multiply out first', tex: '\\text{there is no product rule for integrals}' },
  content:    { name: 'Take the constant factor outside', tex: '\\frac{1}{ka^{2} + kb} = \\frac{1}{k}\\cdot\\frac{1}{a^{2} + b}' },
  usub:       { name: 'Substitution', tex: '\\int f\\!\\left(g(@)\\right)g\'(@)\\,d@ = \\int f\\!\\left(u\\right)du, \\quad u = g(@)' },
  back:       { name: 'Put the @ back', tex: '' },
  simplify:   { name: 'Tidy up', tex: '' },
  atan:       { name: 'Integral of 1/(1 + @²)', tex: '\\int \\frac{1}{1 + @^{2}}\\,d@ = \\arctan @ + C' },
  asin:       { name: 'Integral of 1/√(1 − @²)', tex: '\\int \\frac{1}{\\sqrt{1 - @^{2}}}\\,d@ = \\arcsin @ + C' },
  sec2:       { name: 'Integral of sec²', tex: '\\int \\sec^{2}@\\,d@ = \\tan @ + C' },
  csc2:       { name: 'Integral of csc²', tex: '\\int \\csc^{2}@\\,d@ = -\\cot @ + C' },
  sectan:     { name: 'Integral of sec·tan', tex: '\\int \\sec @\\tan @\\,d@ = \\sec @ + C' },
  csccot:     { name: 'Integral of csc·cot', tex: '\\int \\csc @\\cot @\\,d@ = -\\csc @ + C' },
};

/**
 * Look up a rule for display. The per-function statements are GENERATED from
 * the same `ANTI` table the rules are applied from, so what a student is shown
 * can never drift from what was done.
 */
export function ruleInfo(/** @type {string} */ id, /** @type {string} */ v = 'x') {
  const sub_ = (/** @type {string} */ t) => t.replace(/@/g, v);
  if (RULES[id]) return { name: sub_(RULES[id].name), tex: sub_(RULES[id].tex) };
  if (!id.startsWith('fn:')) return { name: id, tex: '' };
  const name = id.slice(3);
  const F = ANTI[name];
  if (!F) return { name: id, tex: '' };

  const u = vr(v);
  // The function's own TeX, from the same table the printer uses. Building it
  // from the name gave `\asin`, which is not a command — KaTeX renders an
  // undefined command as red literal source rather than failing, so the rule
  // statement for arcsin was broken on screen and silent in the console.
  const f = FUNCTIONS[name];
  const shown = name === 'abs' ? `\\left|${v}\\right|`
    : name === 'cbrt' ? `\\sqrt[3]{${v}}`
      : `${f && f.tex ? f.tex : `\\${name}`}\\left(${v}\\right)`;
  return {
    name: `Integral of ${name}`,
    tex: `\\int ${shown}\\,d${v} = ${toLatexPlain(F(u))} + C`,
  };
}

/* ───────────────────────────────  one rule  ─────────────────────────────── */

/** Is this the bare variable? The table only fires on that; see the header. */
const bare = (/** @type {any} */ n, /** @type {string} */ v) => n.type === 'var' && n.name === v;

/**
 * Resolve ONE pending integral by one rule.
 *
 * @param {any} n an `integ` node
 * @param {Set<string>} used
 * @param {{name:string, expr:any}[]} subs substitutions made, innermost last
 * @returns {any|null} the replacement, or null when nothing in scope applies
 */
function applyRule(n, used, subs) {
  const f = n.arg, v = n.v;
  // The rule id carries the variable it fired in. After a substitution the
  // pending integral is in u, and "∫1/(1 + x²) dx = arctan x" is then the
  // wrong statement on the right line — the same reason `@` exists at all.
  const mark = (/** @type {string} */ id) => used.add(`${id}|${v}`);
  // Asked for at most once per call, and only when a rule is about to need it.
  let subCache; const uSub = () => (subCache === undefined ? (subCache = findUSub(f, v)) : subCache);

  // ∫c d@ = c@ — including ∫dx, where the integrand is just 1.
  if (isConstant(f, v)) { mark('constant'); return mul(f, vr(v)); }

  if (f.type === 'add') {
    mark('sum');
    // A subtracted term keeps its minus OUTSIDE its integral: a textbook writes
    // ∫u^(3/2) du − ∫√u du, not ∫u^(3/2) du + ∫(−√u) du, and the sign is easier
    // to keep track of where it is visible.
    return add(...f.args.map((a) => {
      const minus = (isNum(a) && numV(a) < 0)
        || (a.type === 'mul' && a.args.some(k => isNum(k) && numV(k) < 0));
      return minus ? mul(num(-1), I(simplify(mul(num(-1), a)), v)) : I(a, v);
    }));
  }

  if (f.type === 'mul') {
    // Constants come out front as their OWN step. A student who sees 3x² go
    // through the power rule with the 3 still inside has been told something
    // false about how the work is organised.
    const consts = f.args.filter(a => isConstant(a, v));
    const rest = f.args.filter(a => !isConstant(a, v));
    // …unless a substitution is about to put that constant straight back.
    // ∫2x·cos(x²) dx with the 2 pulled out first becomes 2∫cos(u)/2 du, and
    // the next line cancels the 2 against the ½ it just created. Substituting
    // on the whole product gives ∫cos u du in one move instead of three.
    //
    // But only when the substitution is doing something. On ∫e^u/2 du the
    // search happily offers w = e^u, which renames the integrand without
    // simplifying it, and the working then claimed dw = 0·du. A substitution
    // whose u IS the whole non-constant part is that kind of substitution, so
    // the constant comes out instead and the table takes it from there.
    const renaming = () => {
      const r = uSub();
      return r && toText(r.u) === toText(prod(rest));
    };
    if (consts.length && rest.length && (!uSub() || renaming())) {
      mark('coeff');
      return mul(...consts, I(prod(rest), v));
    }
    // The four products Calculus 1 is expected to recognise on sight.
    if (rest.length === 2) {
      const [p, q] = rest;
      const pair = (/** @type {string} */ a, /** @type {string} */ b) =>
        p.type === 'fn' && q.type === 'fn'
        && ((p.name === a && q.name === b) || (p.name === b && q.name === a))
        && bare(p.arg, v) && bare(q.arg, v);
      if (pair('sec', 'tan')) { mark('sectan'); return fn('sec', vr(v)); }
      if (pair('csc', 'cot')) { mark('csccot'); return neg(fn('csc', vr(v))); }
    }
  }

  // ∫@ d@ — the power rule's n = 1 case, worth naming as the power rule.
  if (bare(f, v)) { mark('power'); return div(pow(vr(v), num(2)), num(2)); }

  if (f.type === 'pow') {
    const { base, exp } = f;

    if (isConstant(exp, v) && bare(base, v)) {
      const e = evaluate(exp, {});
      if (Math.abs(e + 1) < 1e-12) { mark('reciprocal'); return ln(abs(vr(v))); }
      mark('power');
      return div(pow(vr(v), num(e + 1)), num(e + 1));
    }

    // a^@, and e^@ with it, since ln e = 1.
    if (isConstant(base, v) && bare(exp, v)) {
      const isE = base.type === 'const' && base.name === 'e';
      used.add(isE ? 'expe' : 'exponential');
      return isE ? f : div(f, ln(base));
    }

    if (isConstant(exp, v) && base.type === 'fn' && bare(base.arg, v)) {
      const e = evaluate(exp, {});
      if (Math.abs(e - 2) < 1e-12 && base.name === 'sec') { mark('sec2'); return fn('tan', vr(v)); }
      if (Math.abs(e - 2) < 1e-12 && base.name === 'csc') { mark('csc2'); return neg(fn('cot', vr(v))); }
    }

    // A numeric factor inside the base, brought outside, as its own line. The
    // rescaling u = x/2 turns 1/(x² + 4) into 1/(4u² + 4), and the arctan entry
    // matches 1 + u² and nothing else — so the 4 comes out first, which is the
    // step a student would write anyway.
    if (isConstant(exp, v) && base.type === 'add') {
      const g = integerContent(base);
      const scale = g > 1 ? evaluate(pow(num(g), exp), {}) : NaN;
      if (Number.isFinite(scale)) {
        mark('content');
        return I(simplify(mul(num(scale), pow(divideContent(base, g), exp))), v);
      }
    }

    // 1/(1 + @²) and 1/√(1 − @²), matched canonically rather than by shape.
    if (isNum(exp)) {
      const e = numV(exp), key = toText(base);
      if (Math.abs(e + 1) < 1e-12 && key === toText(simplify(add(ONE, pow(vr(v), num(2)))))) {
        mark('atan'); return fn('atan', vr(v));
      }
      if (Math.abs(e + 0.5) < 1e-12 && key === toText(simplify(sub(ONE, pow(vr(v), num(2)))))) {
        mark('asin'); return fn('asin', vr(v));
      }
    }
  }

  // A table function OF THE BARE VARIABLE. Composite arguments are sent to the
  // substitution below on purpose — see the header.
  if (f.type === 'fn' && ANTI[f.name] && bare(f.arg, v)) {
    mark(`fn:${f.name}`);
    return ANTI[f.name](vr(v));
  }

  // No product rule for integrals, so a product of sums has to be multiplied
  // out. This is also what a back-substituted integrand needs: reading
  // u = 2x + 1 backwards leaves (u − 1)√u, which is nothing until it is
  // u^(3/2) − u^(1/2).
  if (f.type === 'mul' || f.type === 'pow') {
    const e = simplify(expand(f));
    if (e.type === 'add' && toText(e) !== toText(f)) { mark('expand'); return I(e, v); }
  }

  // Everything else: look for a change of variable.
  const s = uSub();
  if (s) {
    const name = freshName(f, subs);
    mark('usub');
    const inU = replaceSubtree(s.inU, '_u', vr(name));
    // `coeff` is what the integrand's differential piece is a multiple of. For
    // ∫x·cos(x²)dx the substitution gives du = 2x dx, but the integrand holds
    // x dx — so the note has to solve for that, and the number it solves to is
    // the constant left sitting in front of the new integrand.
    // `v` travels with the substitution: a nested one is made INSIDE an
    // integral already in u, and a note that called it dw/dx would be naming a
    // variable the line does not contain.
    subs.push({ name, expr: s.u, v, backSub: s.backSub, coeff: numericFactor(inU) });
    return I(inU, name);
  }
  return null;
}

/**
 * The numeric factor out in front, with 1 for "none".
 *
 * A reciprocal is stored as a power — ½ is `pow(2, -1)` — so looking only for
 * `num` nodes finds nothing in `cos(u)/2`, which is exactly the case this is
 * for.
 */
function numericFactor(/** @type {any} */ n) {
  if (isNum(n)) return numV(n);
  if (n.type !== 'mul') return 1;
  let c = 1;
  for (const a of n.args) {
    if (isNum(a)) c *= numV(a);
    else if (a.type === 'pow' && isNum(a.base) && isNum(a.exp)) c *= numV(a.base) ** numV(a.exp);
  }
  return c;
}

/** A letter for u that is not already spoken for in this problem. */
function freshName(/** @type {any} */ f, /** @type {{name:string}[]} */ subs) {
  const taken = new Set([...freeVariables(f), ...subs.map(s => s.name)]);
  return ['u', 'w', 's', 'p'].find(c => !taken.has(c)) || 'u';
}

/** Resolve every pending integral in the tree by one rule each. */
function expandOnce(/** @type {any} */ n, /** @type {Set<string>} */ used, /** @type {any[]} */ subs) {
  if (!n || typeof n !== 'object') return n;
  if (n.type === 'integ') {
    const r = applyRule(n, used, subs);
    return r === null ? n : r;
  }
  switch (n.type) {
    case 'add': return add(...n.args.map(a => expandOnce(a, used, subs)));
    case 'mul': return mul(...n.args.map(a => expandOnce(a, used, subs)));
    case 'pow': return pow(expandOnce(n.base, used, subs), expandOnce(n.exp, used, subs));
    case 'fn': return fn(n.name, expandOnce(n.arg, used, subs));
    default: return n;
  }
}

/** Is an integral sign still standing anywhere in here? */
function hasPending(/** @type {any} */ n) {
  if (!n || typeof n !== 'object') return false;
  if (n.type === 'integ') return true;
  if (n.args) return n.args.some(hasPending);
  if (n.type === 'pow') return hasPending(n.base) || hasPending(n.exp);
  if (n.type === 'fn') return hasPending(n.arg);
  return false;
}

/* ──────────────────────────── honest declines ──────────────────────────── */

/** Does this look like a polynomial in v? */
function isPoly(/** @type {any} */ n, /** @type {string} */ v) {
  if (isConstant(n, v)) return true;
  switch (n.type) {
    case 'var': return n.name === v;
    case 'add': case 'mul': return n.args.every(a => isPoly(a, v));
    case 'pow': return isPoly(n.base, v) && isNum(n.exp)
      && Number.isInteger(numV(n.exp)) && numV(n.exp) >= 0;
    default: return false;
  }
}

/**
 * Name the method this integral would need, when it is one we do not do.
 *
 * Saying "integration by parts, which is Calculus 2" is worth far more than
 * "I cannot do this": it tells the student their setup was probably fine and
 * the obstacle is the technique, which is the difference between moving on and
 * assuming they made an algebra error.
 *
 * @returns {string} a sentence, already ending in a full stop
 */
export function whyNot(/** @type {any} */ node, /** @type {string} */ v) {
  const f = simplify(node);
  // No mention of the answer here: whether there IS one is the caller's to
  // know, and promising one that does not exist is worse than saying nothing.
  const C2 = (/** @type {string} */ m) =>
    `This one needs ${m}, which is Calculus 2 — not a mistake on your part.`;

  const factors = f.type === 'mul' ? f.args : [f];
  const polyish = factors.filter(a => isPoly(a, v) && !isConstant(a, v));
  const transcendental = factors.filter(a =>
    (a.type === 'fn' && ['ln', 'log', 'asin', 'acos', 'atan', 'sin', 'cos', 'tan'].includes(a.name))
    || (a.type === 'pow' && isConstant(a.base, v) && !isConstant(a.exp, v)));
  if (polyish.length && transcendental.length) return C2('integration by parts');
  if (factors.some(a => a.type === 'fn' && ['ln', 'log'].includes(a.name))) return C2('integration by parts');

  // A quotient of polynomials whose denominator is not a power of a linear
  // factor: that is the partial-fractions shape.
  // A negative INTEGER power is a denominator; a half power is a root, and a
  // root of a polynomial is not a rational function to split up.
  const bottom = factors.filter(a => a.type === 'pow' && isNum(a.exp)
    && numV(a.exp) < 0 && Number.isInteger(numV(a.exp)));
  if (bottom.length && bottom.every(b => isPoly(b.base, v))
    && bottom.some(b => !linearCoeffs(b.base, v) && hasRealRoot(b.base, v))) {
    return C2('partial fractions');
  }

  if (hasRootOfQuadratic(f, v)) return C2('trigonometric substitution');
  return 'This one is outside what this page can work through. Some integrals have '
    + 'no elementary antiderivative at all, and others need a technique from a later course.';
}

/**
 * Does this polynomial cross zero?
 *
 * The test that separates partial fractions from an arctan form: 1/(x² − 1)
 * splits into partial fractions, 1/(x² + 4) does not and never will, because
 * there is nothing to factor. Sampling for a sign change is enough here and
 * needs no root-finding — the alternative is extracting coefficients and
 * computing a discriminant, which only answers the quadratic case anyway.
 */
function hasRealRoot(/** @type {any} */ p, /** @type {string} */ v) {
  const f = compile(p, v);
  let prev = NaN;
  for (let x = -40; x <= 40; x += 0.25) {
    const y = f(x);
    if (!Number.isFinite(y)) { prev = NaN; continue; }
    if (Math.abs(y) < 1e-9) return true;
    if (Number.isFinite(prev) && Math.sign(y) !== Math.sign(prev)) return true;
    prev = y;
  }
  return false;
}

/** √(a² ± x²) anywhere in here — the trig-substitution signature. */
function hasRootOfQuadratic(/** @type {any} */ n, /** @type {string} */ v) {
  if (!n || typeof n !== 'object') return false;
  if (n.type === 'pow' && isNum(n.exp) && Math.abs(Math.abs(numV(n.exp)) - 0.5) < 1e-12) {
    const b = n.base;
    if (b.type === 'add' && isPoly(b, v) && !linearCoeffs(b, v)) return true;
  }
  const kids = n.args || [n.base, n.exp, n.arg].filter(Boolean);
  return (kids || []).some((/** @type {any} */ k) => hasRootOfQuadratic(k, v));
}

/* ────────────────────────────── the working ─────────────────────────────── */

/**
 * @typedef {{text:string, kind:'transition'|'diagnosis'}} Note
 * @typedef {{tex:string, notes:Note[], rules:string[]}} WorkStep
 *
 * @param {any} node the integrand
 * @param {string} [v]
 * @param {{maxLines?:number}} [opts]
 * @returns {{steps:WorkStep[], answer:any, blocked:string|null, substitutions:{name:string,expr:any}[]}}
 */
export function integralSteps(node, v = 'x', opts = {}) {
  const maxLines = opts.maxLines ?? 20;
  const T = (/** @type {string} */ t) => ({ text: t, kind: /** @type {const} */ ('transition') });
  const G = (/** @type {string} */ t) => ({ text: t, kind: /** @type {const} */ ('diagnosis') });

  /** @type {WorkStep[]} */ const steps = [];
  /** @type {string[]} */ let pendingRules = [];
  const push = (/** @type {string} */ tex, /** @type {Note[]} */ ...notes) => {
    if (steps.length && steps[steps.length - 1].tex === tex) { pendingRules = []; return; }
    steps.push({ tex, notes, rules: pendingRules });
    pendingRules = [];
  };

  const f0 = simplify(node);
  let cur = I(f0, v);
  push(show(cur));

  /** @type {{name:string, expr:any}[]} */ const subs = [];
  let guard = 0;
  let stuck = false;
  while (hasPending(cur) && guard++ < maxLines) {
    /** @type {Set<string>} */ const used = new Set();
    const before = subs.length;
    const next = simplify(expandOnce(cur, used, subs));
    if (!used.size) { stuck = true; break; }
    cur = next;

    /** @type {Note[]} */ const notes = [];
    pendingRules = [...used];
    for (const id of used) {
      const [rule, rv] = id.split('|');
      if (rule === 'usub') continue;
      notes.push(T(ruleInfo(rule, rv || v).name));
    }
    // The substitution gets its own words, because the choice of u is the whole
    // content of the step and a rule name does not convey it.
    if ([...used].some(id => id.startsWith('usub|'))) {
      for (const s of subs.slice(before)) notes.push(...subNotes(s, s.v || v, T, G));
    }
    push(tail(cur, hasPending(cur)), ...notes);
  }

  if (stuck || hasPending(cur)) {
    const answer = antiderivative(f0, v);
    const why = whyNot(f0, v)
      + (answer ? ' The answer itself is below — it is the working that is out of reach here.' : '');
    return { steps, answer, blocked: why, substitutions: subs };
  }

  // Undo the substitutions, innermost first, each as its own line: putting the
  // x back is a step students forget, and a line it never occupied is a line
  // they will not remember.
  for (let i = subs.length - 1; i >= 0; i -= 1) {
    const s = subs[i];
    cur = simplify(replaceSubtree(cur, s.name, s.expr));
    push(tail(cur, false),
      T(`put \\(${showS(s.expr)}\\) back in place of \\(${s.name}\\)`));
  }

  // Multiplying out is the LAST thing, and only when it shortens the line: a
  // coefficient left outside gives ((2u^(5/2))/5 − (2u^(3/2))/3)/4, a fraction
  // of fractions that nobody writes as a final answer.
  const tidied = expandIfShorter(simplify(cur));
  push(tail(tidied, false), T(ruleInfo('simplify', v).name));

  return { steps, answer: tidied, blocked: null, substitutions: subs };
}

/**
 * Every rule used, in the order first met — the legend under the working.
 *
 * `simplify` and `back` are left out: they name a bookkeeping move, not a rule
 * of integration, and a legend that lists "Tidy up" as a technique dilutes the
 * ones that matter.
 * @param {WorkStep[]} steps
 * @returns {string[]}
 */
export function rulesUsed(steps) {
  /** @type {string[]} */ const seen = [];
  for (const s of steps) {
    for (const id of s.rules || []) {
      const rule = id.split('|')[0];
      if (rule === 'simplify' || rule === 'back') continue;
      if (!seen.includes(id)) seen.push(id);
    }
  }
  return seen;
}

/**
 * The margin for a substitution step: what u is, and — the step that matters —
 * the differential solved for the piece the integrand actually holds.
 *
 * `du = 2x dx` is true of ∫x·cos(x²)dx and does not help: the integrand has
 * x dx. Saying "the rest of the integrand is exactly 2x dx" was simply false
 * there. What a student is taught to do, and what this now says, is solve for
 * what they need — ½du = x dx — and that is also the line that explains where
 * the ½ in front of the next integral came from.
 *
 * @param {{name:string, expr:any, v?:string, backSub?:boolean, coeff?:number}} s
 * @param {string} v the variable this substitution was made in — not always the
 *   page's, since a nested substitution happens inside an integral already in u
 * @returns {Note[]}
 */
function subNotes(s, v, T, G) {
  const du = simplify(derivative(s.expr, v));
  const d = (/** @type {string} */ body) => `\\(${body}\\)`;
  // Nobody writes "1 dx". A coefficient of one is not written at all.
  const diff = (/** @type {any} */ n, /** @type {string} */ letter) =>
    (isNum(n) && Math.abs(numV(n) - 1) < 1e-12 ? `d${letter}` : `${showS(n)}\\,d${letter}`);
  /** @type {Note[]} */ const notes = [];

  // Every piece of maths inside the delimiters, including the ones that LOOK
  // like plain text: `x^{2}` renders as literal x^{2} otherwise, which reads as
  // a typo rather than as a power.
  notes.push(T(`let ${d(`${s.name} = ${showS(s.expr)}`)}, so `
    + `${d(`\\frac{d${s.name}}{d${v}} = ${showS(du)}`)} and `
    + `${d(`d${s.name} = ${diff(du, v)}`)}`));

  if (s.backSub) {
    // A linear u read backwards. The differential is the easy half; the point
    // worth making is that an x survived and has to be rewritten too.
    const lin = linearCoeffs(s.expr, v) || { a: 1, b: 0 };
    notes.push(T(`solve for ${d(`d${v}`)}: `
      + `${d(`d${v} = ${diff(simplify(div(ONE, num(lin.a))), s.name)}`)}`));
    notes.push(G(`there is still an ${d(v)} left over, so the substitution is read `
      + `backwards as well: ${d(`${v} = ${showS(div(sub(vr(s.name), num(lin.b)), num(lin.a)))}`)}`));
    return notes;
  }

  const c = s.coeff ?? 1;
  const piece = simplify(mul(num(c), du));
  if (Math.abs(c - 1) > 1e-12) {
    // One span, with the relation inside it. An `=` set in prose between two
    // maths fragments is the same mistake as an `=` in its own column: TeX
    // spaces a relation, and the browser's text does not.
    notes.push(T(`solve for the piece the integrand actually has: `
      + `${d(`${diff(num(c), s.name)} = ${diff(piece, v)}`)}`));
  }
  // "and nothing else in x" was wrong: cos(x²) is in x. What makes the
  // substitution work is that everything else is a function of u.
  notes.push(G(`the integrand holds ${d(diff(piece, v))}, and all the rest of it is a `
    + `function of ${d(s.name)} — which is what makes this substitution the one to try`));
  return notes;
}

/**
 * A line, with "+ C" once the last integral sign has gone.
 *
 * The constant is not decoration. ∫f dx equals F(x) + C and not F(x), so the
 * line that drops the integral sign is exactly the line that must gain the
 * constant — and every line after it keeps it.
 */
function tail(/** @type {any} */ n, /** @type {boolean} */ pending) {
  const body = show(n);
  return pending ? body : `${body} + C`;
}
