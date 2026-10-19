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
  FUNCTIONS, num, vr, add, mul, pow, fn, neg, sub, div, cst, ZERO, ONE, isNum, numV, isConstant, normalizeDeps, simplify, toLatexRaw, toLatex, toText, evaluate, derivative, asQuotient,
} from './expr.js';

/** Worked lines keep nested fractions full size; see expr.js `dwrap`. */
const DISPLAY = { displayFractions: true };
const show = (/** @type {any} */ n) => toLatexRaw(n, DISPLAY);

/**
 * The variables that are secretly functions of the one we differentiate by.
 *
 * Implicit differentiation needs the working, not just the answer, so the same
 * dependence expr.js understands has to reach the rule-by-rule expansion: when
 * `y` turns up, the rule that fires is "y is a function of x" and the result is
 * y′, not 0. Related rates needs several letters at once — see expr.js `DEP`.
 * @type {Map<string,string>|null}
 */
let DEP = null;

/** Fixed = mentions neither the variable nor any dependent one. */
const isFixed = (/** @type {any} */ n, /** @type {string} */ v) => {
  if (!isConstant(n, v)) return false;
  if (!DEP) return true;
  for (const name of DEP.keys()) if (!isConstant(n, name)) return false;
  return true;
};

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
 * Begin a derivation: the whole expression, still un-differentiated.
 * @param {any} node @param {string} v
 */
export const beginDeriv = (node, v = 'x') => D(node, v);

/** Is there still a `d/dx[...]` waiting to be resolved? */
export const hasPending = (/** @type {any} */ n) => hasDeriv(n);

/**
 * Resolve every pending derivative by ONE rule each — one written line.
 *
 * Exported so a caller can drive two expressions in LOCKSTEP, which is what
 * implicit differentiation needs: the two sides of an equation have to advance
 * together or the lines stop being equations.
 *
 * @param {any} n @param {string} v
 * @param {{dep?:string|string[]|Record<string,string>|Map<string,string>, prime?:string, notation?:'prime'|'rate'}} [opts]
 * @returns {{node:any, rules:string[]}}
 */
export function stepOnce(n, v = 'x', opts = {}) {
  DEP = normalizeDeps(opts.dep, v, opts);
  try {
    /** @type {Set<string>} */ const used = new Set();
    // Marks from the previous line are cleared first: each line is annotated
    // with the rules that fired on IT, not with every rule used so far.
    return { node: tidy(expandOnce(stripTags(n), v, used)), rules: [...used] };
  } finally { DEP = null; }
}

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
  if (id.startsWith('dep:')) {
    const [y, sym] = id.slice(4).split(':');
    return {
      name: `${y} is a function of ${v}`,
      tex: `\\frac{d}{d${v}}\\left[${y}\\right] = ${toLatex(vr(sym || `${y}'`))}`,
    };
  }
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
  if (isFixed(n, v)) { used.add('constant'); return ZERO; }

  switch (n.type) {
    case 'var':
      if (DEP && DEP.has(n.name)) {
        const sym = /** @type {string} */ (DEP.get(n.name));
        // The symbol travels WITH the id: ruleInfo is asked later, by which
        // time DEP has been cleared, and with several dependent letters the
        // name alone no longer says what the derivative is written as.
        used.add(`dep:${n.name}:${sym}`);
        return vr(sym);
      }
      used.add('variable');
      return ONE;

    case 'add': used.add('sum'); return add(...n.args.map(a => D(a, v)));

    case 'mul': {
      // Numeric and constant factors come out FIRST, as their own step. A
      // student who sees 3x² go through the product rule has been told
      // something false about how the work is organised.
      const consts = n.args.filter(a => isFixed(a, v));
      const vars = n.args.filter(a => !isFixed(a, v));
      if (consts.length && vars.length) {
        used.add('coeff');
        return mul(...consts, D(vars.length === 1 ? vars[0] : mul(...vars), v));
      }

      const q = asQuotient(n, v, DEP);
      if (q) {
        used.add('quotient');
        const top = sub(mul(D(q.num, v), q.den), mul(q.num, D(q.den, v)));
        top.tag = 'QR';
        return div(top, pow(q.den, num(2)));
      }

      used.add('product');
      const prod = add(...n.args.map((_, i) =>
        mul(...n.args.map((b, j) => (i === j ? D(b, v) : b)))));
      prod.tag = 'PR';
      return prod;
    }

    case 'pow': {
      const { base, exp } = n;
      const constExp = isFixed(exp, v), constBase = isFixed(base, v);

      if (constExp) {
        used.add('power');
        const e = evaluate(exp, {});
        const next = Number.isFinite(e) ? num(e - 1) : sub(exp, ONE);
        // Only the variable itself needs no chain factor. A dependent y is
        // also a bare var, and d/dx[y³] without the y′ is simply wrong.
        if (base.type === 'var' && base.name === v) return mul(exp, pow(base, next));
        used.add('chain');
        const ch = mul(exp, pow(base, next), D(base, v));
        ch.tag = 'CR';
        return ch;
      }

      if (constBase) {
        const isE = base.type === 'const' && base.name === 'e';
        used.add(isE ? 'expe' : 'exponential');
        const parts = isE ? [n] : [n, ln(base)];
        if (exp.type === 'var' && exp.name === v) return parts.length === 1 ? parts[0] : mul(...parts);
        used.add('chain');
        const ch = mul(...parts, D(exp, v));
        ch.tag = 'CR';
        return ch;
      }

      used.add('logdiff');
      return mul(n, add(mul(D(exp, v), ln(base)), div(mul(exp, D(base, v)), base)));
    }

    case 'fn': {
      used.add(`fn:${n.name}`);
      const outer = FUNCTIONS[n.name].d(n.arg);
      if (n.arg.type === 'var' && n.arg.name === v) return outer;
      used.add('chain');
      const ch = mul(outer, D(n.arg, v));
      ch.tag = 'CR';
      return ch;
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
      if (args.length === 1) return args[0];
      return keepTag(add(...args), n);
    }
    case 'mul': {
      // Nesting has to go: the chain rule builds mul(cos(3x²), mul(3, mul(2, x)))
      // and un-flattened that prints as cos(3x²)·(3·(2x)) — true, and not how
      // anyone writes a product.
      const args = flat('mul', n.args.map(tidy));
      if (args.some(a => isNum(a) && numV(a) === 0)) return ZERO;
      const kept = args.filter(a => !(isNum(a) && numV(a) === 1));
      if (!kept.length) return ONE;
      if (kept.length === 1) return kept[0];
      return keepTag(mul(...kept), n);
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

/** Carry a rule mark across a rebuild. */
function keepTag(/** @type {any} */ built, /** @type {any} */ from) {
  if (from.tag) built.tag = from.tag;
  return built;
}

/** Drop every mark — a new line annotates only the rules IT used. */
function stripTags(/** @type {any} */ n) {
  if (!n || typeof n !== 'object') return n;
  const out = { ...n };
  delete out.tag;
  if (out.args) out.args = out.args.map(stripTags);
  if (out.type === 'pow') { out.base = stripTags(out.base); out.exp = stripTags(out.exp); }
  if (out.type === 'fn') out.arg = stripTags(out.arg);
  if (out.type === 'deriv') out.arg = stripTags(out.arg);
  return out;
}

function flat(/** @type {string} */ t, /** @type {any[]} */ args) {
  const out = [];
  for (const a of args) {
    // A marked node keeps its identity: absorbing it into the parent destroys
    // the operator the mark is meant to sit on, and the chain rule's CR would
    // silently disappear from a line where a product rule also fired.
    if (a.type === t && !a.tag) out.push(...a.args);
    else out.push(a);
  }
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
 * @param {{maxLines?:number, dep?:string|string[]|Record<string,string>|Map<string,string>, prime?:string, notation?:'prime'|'rate'}} [opts]
 * @returns {{steps:Step[], answer:any, complete:boolean}}
 */
export function derivationSteps(node, v = 'x', opts = {}) {
  const maxLines = opts.maxLines ?? 16;
  DEP = normalizeDeps(opts.dep, v, opts);
  let cur = D(node, v);
  /** @type {Step[]} */
  const steps = [{ tex: show(cur), rules: [] }];

  let guard = 0;
  while (hasDeriv(cur) && guard++ < maxLines) {
    /** @type {Set<string>} */
    const used = new Set();
    cur = tidy(expandOnce(stripTags(cur), v, used));
    const tex = show(cur);
    // A pass that changed nothing visible is not a step worth a line.
    if (tex === steps[steps.length - 1].tex) continue;
    steps.push({ tex, rules: [...used] });
  }

  // derivative() sets and clears DEP of its own, so the dependence has to be
  // handed on explicitly — and nothing after this line may rely on ours.
  const answer = derivative(node, v, opts);
  DEP = null;
  const final = toLatex(answer, DISPLAY);
  if (final !== steps[steps.length - 1].tex) steps.push({ tex: final, rules: ['simplify'] });

  return { steps, answer, complete: !hasDeriv(cur) };
}

/** Every rule used, in the order first met — the legend under the working. */
export function rulesUsed(/** @type {Step[]} */ steps) {
  const seen = [];
  for (const s of steps) for (const r of s.rules) if (r !== 'simplify' && !seen.includes(r)) seen.push(r);
  return seen;
}
