/**
 * Worked differentiation — the steps, not just the answer.
 *
 * `derivative()` returns where you end up. A student who got a different answer
 * needs to know WHERE they diverged, and that is a different artefact: the line
 * of working that names the rule at each stage.
 *
 * The method is the one a person uses on paper. An expression containing
 * unevaluated `d/dx[…]` markers is a perfectly printable thing, so each pass
 * resolves EVERY pending marker by one rule and prints the result. Writing
 *
 *     d/dx[x² eˣ] = eˣ · d/dx[x²] + x² · d/dx[eˣ]
 *
 * before evaluating either half is exactly what the product rule looks like
 * when a human writes it out, and it is what makes the steps recognisable as
 * the same procedure the course taught.
 *
 * Lines are `tidy`-ed, never simplified: simplification is what turns a step
 * into the answer, so applying it early collapses the whole derivation to one
 * line. Tidying only drops the ×1 and +0 nobody writes down.
 */

import {
  FUNCTIONS, num, add, mul, pow, fn, neg, sub, div, cst, ZERO, ONE,
  isNum, numV, isConstant, simplify, toLatexRaw, toLatex, toText,
  evaluate, derivative, asQuotient,
} from './expr.js';

/** A pending derivative. @param {any} arg @param {string} v */
const D = (arg, v) => ({ type: 'deriv', arg, v });
const ln = (/** @type {any} */ a) => fn('ln', a);

/**
 * The rules, as a student meets them. `tex` is the statement of the rule, shown
 * next to the line that used it — the point is to connect the working to the
 * rule, not merely to label it.
 */
export const RULES = {
  constant:    { name: 'Constant rule',     tex: '\\frac{d}{d@}\\left[c\\right] = 0' },
  variable:    { name: 'Derivative of @',   tex: '\\frac{d}{d@}\\left[@\\right] = 1' },
  sum:         { name: 'Sum rule',          tex: '\\left(f + g\\right)\' = f\' + g\'' },
  coeff:       { name: 'Constant multiple', tex: '\\left(c\\,f\\right)\' = c\\,f\'' },
  product:     { name: 'Product rule',      tex: '\\left(fg\\right)\' = f\'g + fg\'' },
  quotient:    { name: 'Quotient rule',     tex: '\\left(\\frac{f}{g}\\right)\' = \\frac{f\'g - fg\'}{g^{2}}' },
  power:       { name: 'Power rule',        tex: '\\frac{d}{d@}\\left[u^{n}\\right] = n\\,u^{n-1}u\'' },
  chain:       { name: 'Chain rule',        tex: '\\frac{d}{d@}\\left[f(u)\\right] = f\'(u)\\cdot u\'' },
  expe:        { name: 'Exponential (base e)', tex: '\\frac{d}{d@}\\left[e^{u}\\right] = e^{u}\\cdot u\'' },
  exponential: { name: 'Exponential rule',  tex: '\\frac{d}{d@}\\left[a^{u}\\right] = a^{u}\\ln a\\cdot u\'' },
  logdiff:     { name: 'Logarithmic differentiation', tex: '\\frac{d}{d@}\\left[f^{g}\\right] = f^{g}\\left(g\'\\ln f + \\frac{g f\'}{f}\\right)' },
  simplify:    { name: 'Tidy up',           tex: '' },
};

/**
 * Look up a rule for display. `@` in the stored text stands for the variable in
 * play — a problem written in t should not be told that d/dx[x] = 1.
 *
 * The per-function rules are GENERATED from the same table `applyRule` uses, so
 * the statement shown to the student can never drift from the one applied.
 */
export function ruleInfo(/** @type {string} */ id, /** @type {string} */ v = 'x') {
  const sub = (/** @type {string} */ t) => t.replace(/@/g, v);
  if (RULES[id]) return { name: sub(RULES[id].name), tex: sub(RULES[id].tex) };
  const name = id.slice(3);
  const f = FUNCTIONS[name];
  if (!f) return { name: id, tex: '' };
  const u = { type: 'var', name: 'u' };
  const shown = name === 'abs' ? '\\left|u\\right|'
    : name === 'cbrt' ? '\\sqrt[3]{u}'
      : `${f.tex}\\left(u\\right)`;
  return {
    name: `Derivative of ${name === 'abs' ? '|u|' : name}`,
    tex: `\\frac{d}{du}\\left[${shown}\\right] = ${toLatex(f.d(u))}`,
  };
}

/* ─────────────────────────────── one rule ──────────────────────────────── */

/**
 * Differentiate ONE node by one rule, leaving the sub-derivatives pending.
 * @param {any} n @param {string} v @param {Set<string>} used
 */
function applyRule(n, v, used) {
  // Anything free of the variable is a constant, however complicated it looks.
  if (isConstant(n, v)) { used.add('constant'); return ZERO; }

  switch (n.type) {
    case 'var': used.add('variable'); return ONE;

    case 'add': used.add('sum'); return add(...n.args.map(a => D(a, v)));

    case 'mul': {
      // Numeric and constant factors come out FIRST, as their own step. A
      // student who sees 3x² go through the product rule has been told
      // something false about how the work is organised.
      const consts = n.args.filter(a => isConstant(a, v));
      const vars = n.args.filter(a => !isConstant(a, v));
      if (consts.length && vars.length) {
        used.add('coeff');
        return mul(...consts, D(vars.length === 1 ? vars[0] : mul(...vars), v));
      }

      const q = asQuotient(n, v);
      if (q) {
        used.add('quotient');
        return div(sub(mul(D(q.num, v), q.den), mul(q.num, D(q.den, v))), pow(q.den, num(2)));
      }

      used.add('product');
      return add(...n.args.map((_, i) =>
        mul(...n.args.map((b, j) => (i === j ? D(b, v) : b)))));
    }

    case 'pow': {
      const { base, exp } = n;
      const constExp = isConstant(exp, v), constBase = isConstant(base, v);

      if (constExp) {
        used.add('power');
        const e = evaluate(exp, {});
        const next = Number.isFinite(e) ? num(e - 1) : sub(exp, ONE);
        if (base.type === 'var') return mul(exp, pow(base, next));
        used.add('chain');
        return mul(exp, pow(base, next), D(base, v));
      }

      if (constBase) {
        const isE = base.type === 'const' && base.name === 'e';
        used.add(isE ? 'expe' : 'exponential');
        const parts = isE ? [n] : [n, ln(base)];
        if (exp.type === 'var') return parts.length === 1 ? parts[0] : mul(...parts);
        used.add('chain');
        return mul(...parts, D(exp, v));
      }

      used.add('logdiff');
      return mul(n, add(mul(D(exp, v), ln(base)), div(mul(exp, D(base, v)), base)));
    }

    case 'fn': {
      used.add(`fn:${n.name}`);
      const outer = FUNCTIONS[n.name].d(n.arg);
      if (n.arg.type === 'var') return outer;
      used.add('chain');
      return mul(outer, D(n.arg, v));
    }

    default: return ZERO;
  }
}

/** Resolve every pending derivative by ONE rule each — one written line. */
function expandOnce(/** @type {any} */ n, /** @type {string} */ v, /** @type {Set<string>} */ used) {
  switch (n.type) {
    // Not recursed into: the markers this rule creates belong to the NEXT line.
    case 'deriv': return applyRule(n.arg, n.v || v, used);
    case 'add': return add(...n.args.map(a => expandOnce(a, v, used)));
    case 'mul': return mul(...n.args.map(a => expandOnce(a, v, used)));
    case 'pow': return pow(expandOnce(n.base, v, used), expandOnce(n.exp, v, used));
    case 'fn': return fn(n.name, expandOnce(n.arg, v, used));
    default: return n;
  }
}

/**
 * Drop the ×1 and +0 that nobody writes down — and nothing else. Order is
 * preserved and like terms are NOT collected, because that is the difference
 * between a step and the answer.
 */
function tidy(/** @type {any} */ n) {
  switch (n.type) {
    case 'add': {
      const args = flat('add', n.args.map(tidy)).filter(a => !(isNum(a) && numV(a) === 0));
      if (!args.length) return ZERO;
      return args.length === 1 ? args[0] : add(...args);
    }
    case 'mul': {
      // Nesting has to go: the chain rule builds mul(cos(3x²), mul(3, mul(2, x)))
      // and un-flattened that prints as cos(3x²)·(3·(2x)) — true, and not how
      // anyone writes a product.
      const args = flat('mul', n.args.map(tidy));
      if (args.some(a => isNum(a) && numV(a) === 0)) return ZERO;
      const kept = args.filter(a => !(isNum(a) && numV(a) === 1));
      if (!kept.length) return ONE;
      return kept.length === 1 ? kept[0] : mul(...kept);
    }
    // x^1 is the power rule's own output (x^(2-1)), and nobody leaves it written.
    case 'pow': {
      const base = tidy(n.base), exp = tidy(n.exp);
      if (isNum(exp) && numV(exp) === 1) return base;
      if (isNum(exp) && numV(exp) === 0) return ONE;
      return pow(base, exp);
    }
    case 'fn': return fn(n.name, tidy(n.arg));
    case 'deriv': return n;        // the pending part is quoted verbatim
    default: return n;
  }
}

function flat(/** @type {string} */ t, /** @type {any[]} */ args) {
  const out = [];
  for (const a of args) { if (a.type === t) out.push(...a.args); else out.push(a); }
  return out;
}

function hasDeriv(/** @type {any} */ n) {
  if (!n || typeof n !== 'object') return false;
  if (n.type === 'deriv') return true;
  if (n.args) return n.args.some(hasDeriv);
  if (n.type === 'pow') return hasDeriv(n.base) || hasDeriv(n.exp);
  if (n.type === 'fn') return hasDeriv(n.arg);
  return false;
}

/* ─────────────────────────────── the working ───────────────────────────── */

/**
 * @typedef {{tex:string, rules:string[]}} Step
 *
 * @param {any} node   the function to differentiate
 * @param {string} [v] the variable
 * @param {{maxLines?:number}} [opts]
 * @returns {{steps:Step[], answer:any, complete:boolean}}
 */
export function derivationSteps(node, v = 'x', opts = {}) {
  const maxLines = opts.maxLines ?? 16;
  let cur = D(node, v);
  /** @type {Step[]} */
  const steps = [{ tex: toLatexRaw(cur), rules: [] }];

  let guard = 0;
  while (hasDeriv(cur) && guard++ < maxLines) {
    /** @type {Set<string>} */
    const used = new Set();
    cur = tidy(expandOnce(cur, v, used));
    const tex = toLatexRaw(cur);
    // A pass that changed nothing visible is not a step worth a line.
    if (tex === steps[steps.length - 1].tex) continue;
    steps.push({ tex, rules: [...used] });
  }

  const answer = derivative(node, v);
  const final = toLatex(answer);
  if (final !== steps[steps.length - 1].tex) steps.push({ tex: final, rules: ['simplify'] });

  return { steps, answer, complete: !hasDeriv(cur) };
}

/** Every rule used, in the order first met — the legend under the working. */
export function rulesUsed(/** @type {Step[]} */ steps) {
  const seen = [];
  for (const s of steps) for (const r of s.rules) if (r !== 'simplify' && !seen.includes(r)) seen.push(r);
  return seen;
}
