/**
 * CalcLens expression engine — the whole CAS, in one file.
 *
 * Why not math.js / Algebrite / SymPy-via-Pyodide? Because Calculus 1 needs a
 * *small* symbolic engine with tight control over the OUTPUT FORM, and that is
 * the part general CAS libraries get pedagogically wrong. A CAS hands back
 * `log(x)` where the course prints `ln x`, `0.333333*x^3` where the course
 * prints `x³/3`, and `-1*cos(x)` where the course prints `−cos x`. Students read
 * that as a different answer. Owning the printer is the whole point.
 *
 * Scope is deliberately the Calc 1 catalogue and nothing more:
 *   - polynomials, roots, exp/log, the six trig + inverse trig, hyperbolics
 *   - full differentiation (product / quotient / chain / general power)
 *   - antidifferentiation by table + linearity + LINEAR u-substitution
 *
 * Anything outside that returns `null` from `antiderivative()` rather than
 * guessing. The tools fall back to numeric integration and say so.
 *
 * CANONICAL FORM. `simplify()` normalises everything to five node types —
 * num, var, const, add, mul, pow, fn. There is no `neg`, `sub` or `div` node:
 *   neg(a)   ==  mul(-1, a)
 *   a - b    ==  add(a, mul(-1, b))
 *   a / b    ==  mul(a, pow(b, -1))
 *   sqrt(a)  ==  pow(a, 1/2)
 *   exp(a)   ==  pow(e, a)
 * One form means one code path per rule. The PRINTER puts the fractions, minus
 * signs and radicals back — see `toLatex`.
 *
 * NUMBERS are floats, with one rule that keeps output readable: a numeric base
 * raised to a NEGATIVE integer is never folded (`pow(3,-1)` stays symbolic), so
 * `x^3/3` prints as a fraction instead of `0.3333x^3`. Products fold their
 * numeric parts into a reduced rational.
 *
 * NOT supported, on purpose: scientific notation (`1e-3`), because `e` is
 * Euler's number here and `2e` meaning 2·e is the likelier student intent.
 */

/* ─────────────────────────── node constructors ─────────────────────────── */

/** @typedef {{type:'num',value:number}} NumNode */
/** @typedef {{type:'var',name:string}} VarNode */
/** @typedef {{type:'const',name:string}} ConstNode */
/** @typedef {{type:'add',args:Node[]}} AddNode */
/** @typedef {{type:'mul',args:Node[]}} MulNode */
/** @typedef {{type:'pow',base:Node,exp:Node}} PowNode */
/** @typedef {{type:'fn',name:string,arg:Node}} FnNode */
/** A NOT-YET-TAKEN derivative. Only `steps.js` builds these: they let a line of
 *  working be printed while some derivatives are still pending, which is how a
 *  person writes the product rule out before evaluating either half.
 *  @typedef {{type:'deriv',arg:Node,v:string}} DerivNode */
/** @typedef {NumNode|VarNode|ConstNode|AddNode|MulNode|PowNode|FnNode|DerivNode} Node */

export const num = (/** @type {number} */ value) => ({ type: 'num', value });
export const vr = (/** @type {string} */ name) => ({ type: 'var', name });
export const cst = (/** @type {string} */ name) => ({ type: 'const', name });
export const add = (/** @type {Node[]} */ ...args) => ({ type: 'add', args });
export const mul = (/** @type {Node[]} */ ...args) => ({ type: 'mul', args });
export const pow = (/** @type {Node} */ base, /** @type {Node} */ exp) => ({ type: 'pow', base, exp });
export const fn = (/** @type {string} */ name, /** @type {Node} */ arg) => ({ type: 'fn', name, arg });

export const neg = (/** @type {Node} */ a) => mul(num(-1), a);
export const sub = (/** @type {Node} */ a, /** @type {Node} */ b) => add(a, neg(b));
export const div = (/** @type {Node} */ a, /** @type {Node} */ b) => mul(a, pow(b, num(-1)));
export const sqrt = (/** @type {Node} */ a) => pow(a, num(0.5));
const ln = (/** @type {Node} */ a) => fn('ln', a);
const E = cst('e');

export const ZERO = num(0);
export const ONE = num(1);

/* ──────────────────────────── function table ───────────────────────────── */

export const CONSTANTS = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI };

const sec_ = (/** @type {number} */ x) => 1 / Math.cos(x);
const csc_ = (/** @type {number} */ x) => 1 / Math.sin(x);
const cot_ = (/** @type {number} */ x) => 1 / Math.tan(x);

/**
 * Every function the engine knows. `f` evaluates it, `tex` is the LaTeX command,
 * `d` returns f'(u) as a node (the chain-rule outer factor).
 * @type {Record<string, {f:(x:number)=>number, tex:string, d:(u:Node)=>Node}>}
 */
export const FUNCTIONS = {
  sin: { f: Math.sin, tex: '\\sin', d: u => fn('cos', u) },
  cos: { f: Math.cos, tex: '\\cos', d: u => neg(fn('sin', u)) },
  tan: { f: Math.tan, tex: '\\tan', d: u => pow(fn('sec', u), num(2)) },
  sec: { f: sec_, tex: '\\sec', d: u => mul(fn('sec', u), fn('tan', u)) },
  csc: { f: csc_, tex: '\\csc', d: u => neg(mul(fn('csc', u), fn('cot', u))) },
  cot: { f: cot_, tex: '\\cot', d: u => neg(pow(fn('csc', u), num(2))) },
  asin: { f: Math.asin, tex: '\\arcsin', d: u => div(ONE, sqrt(sub(ONE, pow(u, num(2))))) },
  acos: { f: Math.acos, tex: '\\arccos', d: u => neg(div(ONE, sqrt(sub(ONE, pow(u, num(2)))))) },
  atan: { f: Math.atan, tex: '\\arctan', d: u => div(ONE, add(ONE, pow(u, num(2)))) },
  sinh: { f: Math.sinh, tex: '\\sinh', d: u => fn('cosh', u) },
  cosh: { f: Math.cosh, tex: '\\cosh', d: u => fn('sinh', u) },
  tanh: { f: Math.tanh, tex: '\\tanh', d: u => div(ONE, pow(fn('cosh', u), num(2))) },
  ln: { f: Math.log, tex: '\\ln', d: u => div(ONE, u) },
  log: { f: Math.log10, tex: '\\log', d: u => div(ONE, mul(u, ln(num(10)))) },
  log2: { f: Math.log2, tex: '\\log_2', d: u => div(ONE, mul(u, ln(num(2)))) },
  cbrt: { f: Math.cbrt, tex: '\\sqrt[3]', d: u => div(ONE, mul(num(3), pow(fn('cbrt', u), num(2)))) },
  abs: { f: Math.abs, tex: '\\left|', d: u => div(u, fn('abs', u)) },
};

/** Names the parser accepts, mapped to the canonical entry in FUNCTIONS. */
const FN_ALIASES = {
  arcsin: 'asin', arccos: 'acos', arctan: 'atan',
  arsinh: 'sinh', sinhh: 'sinh',
  loge: 'ln', log10: 'log',
};

/** Rewritten away at parse time (see CANONICAL FORM). */
const REWRITTEN = { sqrt: 'sqrt', exp: 'exp' };

/* ────────────────────────────── tokenizer ──────────────────────────────── */

export class ParseError extends Error {
  /** @param {string} message @param {number} pos */
  constructor(message, pos) {
    super(message);
    this.name = 'ParseError';
    this.pos = pos;
  }
}

/** Longest-first so `arcsin` wins over `a`, and `exp` over `e`. */
const WORDS = [
  ...Object.keys(FUNCTIONS), ...Object.keys(FN_ALIASES), ...Object.keys(REWRITTEN),
  ...Object.keys(CONSTANTS),
].sort((a, b) => b.length - a.length);

/**
 * `2x`, `sin x`, `xy` — students do not type `*`. Identifiers are matched
 * greedily against the known-word list, and anything left over is a
 * SINGLE-LETTER variable. That is what makes `xy` mean x·y while `sin` stays
 * one token.
 * @param {string} src
 */
function tokenize(src) {
  const s = String(src);
  const out = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(s[i + 1] || ''))) {
      let j = i;
      while (j < s.length && /[0-9]/.test(s[j])) j++;
      if (s[j] === '.') { j++; while (j < s.length && /[0-9]/.test(s[j])) j++; }
      out.push({ kind: 'num', value: parseFloat(s.slice(i, j)), pos: i });
      i = j;
      continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      const rest = s.slice(i);
      const word = WORDS.find(w => rest.startsWith(w) && !/[A-Za-z0-9]/.test(rest[w.length] || ''))
        // `2sinx` — allow a function name followed immediately by more letters.
        || WORDS.find(w => rest.startsWith(w) && (w in FUNCTIONS || w in FN_ALIASES || w in REWRITTEN));
      if (word) {
        const kind = (word in CONSTANTS) ? 'const' : 'func';
        out.push({ kind, name: word, pos: i });
        i += word.length;
      } else {
        out.push({ kind: 'var', name: ch, pos: i });
        i++;
      }
      continue;
    }
    if ('+-*/^(),'.includes(ch)) {
      out.push({ kind: ch === '(' || ch === ')' ? ch : 'op', value: ch, pos: i });
      i++;
      continue;
    }
    // Common lookalikes students paste from a document.
    if ('−–—'.includes(ch)) { out.push({ kind: 'op', value: '-', pos: i }); i++; continue; }
    if ('×·⋅'.includes(ch)) { out.push({ kind: 'op', value: '*', pos: i }); i++; continue; }
    if ('÷'.includes(ch)) { out.push({ kind: 'op', value: '/', pos: i }); i++; continue; }
    if ('[{'.includes(ch)) { out.push({ kind: '(', value: '(', pos: i }); i++; continue; }
    if (']}'.includes(ch)) { out.push({ kind: ')', value: ')', pos: i }); i++; continue; }
    throw new ParseError(`I don't recognise the character "${ch}".`, i);
  }
  out.push({ kind: 'end', pos: s.length });
  return out;
}

/* ──────────────────────────────── parser ───────────────────────────────── */

/**
 * Precedence-climbing parser.
 *
 *   expr   := term (('+' | '-') term)*
 *   term   := unary (('*' | '/' | implicit) unary)*
 *   unary  := '-' unary | power
 *   power  := primary ('^' unary)?          // right-associative: 2^3^2 = 2^9
 *   primary:= num | const | var | func arg | '(' expr ')'
 *
 * `-x^2` parses as `-(x^2)` and `2x^2` as `2·(x^2)`, both matching convention.
 *
 * @param {string} src
 * @returns {Node}
 */
export function parse(src) {
  if (!String(src).trim()) throw new ParseError('Enter a function of x.', 0);
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (/** @type {string} */ v) => toks[p].kind === 'op' && toks[p].value === v;

  function expr() {
    let left = term();
    for (;;) {
      if (isOp('+')) { p++; left = add(left, term()); }
      else if (isOp('-')) { p++; left = sub(left, term()); }
      else return left;
    }
  }

  function term() {
    let left = unary();
    for (;;) {
      if (isOp('*')) { p++; left = mul(left, unary()); }
      else if (isOp('/')) { p++; left = div(left, unary()); }
      else if (startsPrimary()) { left = mul(left, unary()); }  // implicit: 2x, x(x+1)
      else return left;
    }
  }

  function startsPrimary() {
    const t = peek();
    return t.kind === 'num' || t.kind === 'var' || t.kind === 'const'
      || t.kind === 'func' || t.kind === '(';
  }

  function unary() {
    if (isOp('-')) { p++; return neg(unary()); }
    if (isOp('+')) { p++; return unary(); }
    return power();
  }

  function power() {
    const base = primary();
    if (isOp('^')) { p++; return pow(base, unary()); }
    return base;
  }

  function primary() {
    const t = peek();
    if (t.kind === 'num') { p++; return num(t.value); }
    if (t.kind === 'const') { p++; return cst(t.name); }
    if (t.kind === 'var') { p++; return vr(t.name); }
    if (t.kind === '(') {
      p++;
      const e = expr();
      if (peek().kind !== ')') throw new ParseError('This "(" is never closed.', t.pos);
      p++;
      return e;
    }
    if (t.kind === 'func') {
      p++;
      // `sin(x)` and `sin x` both work; bare application binds at power level,
      // so `sin x^2` is sin(x²) — the way it is printed in a textbook.
      const arg = peek().kind === '(' ? primary() : power();
      const name = FN_ALIASES[t.name] || t.name;
      if (name === 'sqrt') return sqrt(arg);
      if (name === 'exp') return pow(E, arg);
      return fn(name, arg);
    }
    if (t.kind === ')') throw new ParseError('There is a ")" with no matching "(".', t.pos);
    if (t.kind === 'op') throw new ParseError(`"${t.value}" needs something after it.`, t.pos);
    throw new ParseError('The expression ends too early — something is missing.', t.pos);
  }

  const result = expr();
  if (peek().kind !== 'end') throw new ParseError('I could not read the rest of this expression.', peek().pos);
  return simplify(result);
}

/** Parse, returning `{ node }` or `{ error, pos }` instead of throwing. */
export function tryParse(/** @type {string} */ src) {
  try {
    return { node: parse(src) };
  } catch (e) {
    if (e instanceof ParseError) return { error: e.message, pos: e.pos };
    throw e;
  }
}

/* ─────────────────────────────── evaluation ────────────────────────────── */

/**
 * Compile to a closure tree. Plotting samples thousands of points per frame, so
 * this walks the AST once instead of once per point.
 * @param {Node} node
 * @param {string} [v] the independent variable
 * @param {Record<string,number>|null} [params] live values for every OTHER
 *   letter, read at call time so a slider moves without recompiling
 * @returns {(x:number)=>number}
 */
export function compile(node, v = 'x', params = null) {
  switch (node.type) {
    case 'num': { const c = node.value; return () => c; }
    case 'const': { const c = CONSTANTS[node.name] ?? NaN; return () => c; }
    case 'var': {
      if (node.name === v) return (x => x);
      // Any OTHER letter is a parameter: a slider's value, read at call time so
      // moving the slider does not mean recompiling the expression. Without
      // this, `a*sin(b*x)` could only ever evaluate to NaN.
      if (params) { const name = node.name; return () => params[name] ?? NaN; }
      return (() => NaN);
    }
    case 'add': {
      const fs = node.args.map(a => compile(a, v, params));
      return x => { let s = 0; for (const f of fs) s += f(x); return s; };
    }
    case 'mul': {
      const fs = node.args.map(a => compile(a, v, params));
      return x => { let s = 1; for (const f of fs) s *= f(x); return s; };
    }
    case 'pow': {
      const b = compile(node.base, v, params), e = compile(node.exp, v, params);
      return x => Math.pow(b(x), e(x));
    }
    case 'fn': {
      const g = FUNCTIONS[node.name].f, a = compile(node.arg, v, params);
      return x => g(a(x));
    }
    default: return () => NaN;
  }
}

/** One-off numeric evaluation. @param {Node} node @param {Record<string,number>} [scope] */
export function evaluate(node, scope = {}) {
  switch (node.type) {
    case 'num': return node.value;
    case 'const': return CONSTANTS[node.name] ?? NaN;
    case 'var': return node.name in scope ? scope[node.name] : NaN;
    case 'add': return node.args.reduce((s, a) => s + evaluate(a, scope), 0);
    case 'mul': return node.args.reduce((s, a) => s * evaluate(a, scope), 1);
    case 'pow': return Math.pow(evaluate(node.base, scope), evaluate(node.exp, scope));
    case 'fn': return FUNCTIONS[node.name].f(evaluate(node.arg, scope));
    default: return NaN;
  }
}

/* ─────────────────────────────── simplify ──────────────────────────────── */

export const isNum = (/** @type {Node} */ n) => n.type === 'num';
export const numV = (/** @type {Node} */ n) => /** @type {NumNode} */(n).value;
const isInt = (/** @type {number} */ x) => Number.isFinite(x) && Math.abs(x - Math.round(x)) < 1e-12;

/**
 * Every variable letter appearing in an expression.
 *
 * Tools use this to work in whatever letter the author wrote rather than
 * insisting on x — a velocity problem is written in t, and forcing the reader
 * to translate is exactly the friction the tool exists to remove.
 *
 * @param {Node} node @param {Set<string>} [out]
 * @returns {Set<string>}
 */
export function freeVariables(node, out = new Set()) {
  switch (node.type) {
    case 'var': out.add(node.name); break;
    case 'add': case 'mul': node.args.forEach(a => freeVariables(a, out)); break;
    case 'pow': freeVariables(node.base, out); freeVariables(node.exp, out); break;
    case 'fn': freeVariables(node.arg, out); break;
    default: break;
  }
  return out;
}

/** Does this subtree mention the variable at all? */
export function isConstant(/** @type {Node} */ node, /** @type {string} */ v = 'x') {
  switch (node.type) {
    case 'num': case 'const': return true;
    case 'var': return node.name !== v;
    case 'add': case 'mul': return node.args.every(a => isConstant(a, v));
    case 'pow': return isConstant(node.base, v) && isConstant(node.exp, v);
    case 'fn': return isConstant(node.arg, v);
    default: return false;
  }
}

const gcd = (/** @type {number} */ a, /** @type {number} */ b) => (b < 1e-9 ? a : gcd(b, a % b));

/**
 * Letters that are conventionally an INCREMENT, not the subject of the problem.
 * They print last among variables, so a difference quotient expands to the
 * `2x² + 4xh + 2h²` a textbook shows rather than `2x² + 4hx + 2h²`. Plain
 * alphabetical order puts h first, which reads as a different expression to a
 * student checking their own work against it.
 */
const INCREMENT_LETTERS = new Set(['h', 'k', 'dx', 'dt']);
const incRank = (/** @type {Node} */ n) => {
  const base = n.type === 'pow' ? n.base : n;
  return base.type === 'var' && INCREMENT_LETTERS.has(base.name) ? 1 : 0;
};

/** Print order within a product: 2x cos(x²) reads better than 2 cos(x²) x. */
function factorRank(/** @type {Node} */ n) {
  if (n.type === 'num') return 0;
  if (n.type === 'const') return 1;
  if (n.type === 'var') return 2;
  if (n.type === 'pow') return n.base.type === 'var' ? 3 : 5;
  if (n.type === 'deriv') return 6;
  if (n.type === 'fn') return 4;
  return 6;
}

/**
 * Reduce to canonical form. Bottom-up: fold constants, flatten n-ary add/mul,
 * collect like terms and like factors, drop identities.
 * @param {Node} node
 * @returns {Node}
 */
export function simplify(node) {
  switch (node.type) {
    case 'num': case 'var': case 'const': return node;
    case 'add': return simplifyAdd(node.args.map(simplify));
    case 'mul': return simplifyMul(node.args.map(simplify));
    case 'pow': return simplifyPow(simplify(node.base), simplify(node.exp));
    case 'fn': return simplifyFn(node.name, simplify(node.arg));
    default: return node;
  }
}

function flatten(/** @type {string} */ type, /** @type {Node[]} */ args) {
  const out = [];
  for (const a of args) {
    if (a.type === type) out.push(.../** @type {AddNode} */(a).args);
    else out.push(a);
  }
  return out;
}

/** Split a product into its leading numeric coefficient and the rest. */
function splitCoeff(/** @type {Node} */ n) {
  if (isNum(n)) return [numV(n), ONE];
  if (n.type === 'mul') {
    const nums = n.args.filter(isNum), rest = n.args.filter(a => !isNum(a));
    const c = nums.reduce((s, a) => s * numV(a), 1);
    if (rest.length === 0) return [c, ONE];
    return [c, rest.length === 1 ? rest[0] : mul(...rest)];
  }
  return [1, n];
}

/** Degree in x, used only to order printed terms high-power-first. */
function degree(/** @type {Node} */ n) {
  switch (n.type) {
    case 'var': return n.name === 'x' ? 1 : 0.5;
    case 'mul': return n.args.reduce((s, a) => s + degree(a), 0);
    case 'pow': return isNum(n.exp) ? degree(n.base) * numV(n.exp) : 2.5;
    case 'fn': return isConstant(n) ? 0 : 2.5;
    case 'add': return Math.max(...n.args.map(degree));
    default: return 0;
  }
}

function simplifyAdd(/** @type {Node[]} */ args) {
  const flat = flatten('add', args);
  let constant = 0;
  /** @type {Map<string, {coeff:number, node:Node}>} */
  const terms = new Map();
  for (const a of flat) {
    if (isNum(a)) { constant += numV(a); continue; }
    const [c, rest] = splitCoeff(a);
    const key = toText(rest);
    const hit = terms.get(key);
    if (hit) hit.coeff += c;
    else terms.set(key, { coeff: c, node: rest });
  }
  // sin²u + cos²u = 1. The only identity in the engine, and it earns its place:
  // without it the quotient rule on sin(x)/(1 + cos(x)) stalls at
  // cos²x + sin²x + cos x, one identity short of the answer every textbook
  // prints. Both halves must carry the same coefficient to collapse.
  for (const [key, t] of terms) {
    if (!key.startsWith('(sin(')) continue;
    const u = key.slice(5, -4);
    if (key !== `(sin(${u})^2)`) continue;
    const other = terms.get(`(cos(${u})^2)`);
    if (!other || Math.abs(other.coeff - t.coeff) > 1e-14) continue;
    constant += t.coeff;
    terms.delete(key); terms.delete(`(cos(${u})^2)`);
  }

  const out = [];
  for (const { coeff, node } of terms.values()) {
    if (Math.abs(coeff) < 1e-14) continue;
    out.push(coeff === 1 ? node : simplifyMul([num(coeff), node]));
  }
  out.sort((a, b) => degree(b) - degree(a));
  if (Math.abs(constant) > 1e-14) out.push(num(constant));
  if (out.length === 0) return ZERO;
  if (out.length === 1) return out[0];
  return add(...out);
}

function simplifyMul(/** @type {Node[]} */ args) {
  const flat = flatten('mul', args);
  // Numeric part is tracked as a rational so `x^3/3` never becomes `0.333x^3`.
  let cNum = 1, cDen = 1;
  /** @type {Map<string, {base:Node, exp:Node[]}>} */
  const factors = new Map();
  for (const a of flat) {
    if (isNum(a)) { cNum *= numV(a); continue; }
    // A numeric base with an integer exponent folds into the rational.
    if (a.type === 'pow' && isNum(a.base) && isNum(a.exp) && isInt(numV(a.exp))) {
      const b = numV(a.base), e = Math.round(numV(a.exp));
      if (e >= 0) cNum *= Math.pow(b, e); else cDen *= Math.pow(b, -e);
      continue;
    }
    const base = a.type === 'pow' ? a.base : a;
    const exp = a.type === 'pow' ? a.exp : ONE;
    const key = toText(base);
    const hit = factors.get(key);
    if (hit) hit.exp.push(exp);
    else factors.set(key, { base, exp: [exp] });
  }
  if (cNum === 0) return ZERO;
  if (isInt(cNum) && isInt(cDen) && cDen !== 1) {
    const g = gcd(Math.abs(Math.round(cNum)), Math.abs(Math.round(cDen))) || 1;
    cNum /= g; cDen /= g;
  }
  const out = [];
  for (const { base, exp } of factors.values()) {
    const e = exp.length === 1 ? exp[0] : simplifyAdd(exp);
    const f = simplifyPow(base, e);
    if (isNum(f)) { cNum *= numV(f); continue; }
    if (f.type === 'mul') out.push(...f.args); else out.push(f);
  }
  // Normalise the numeric part to one reduced rational, so d/dx sqrt(x) prints
  // as 1/(2 sqrt x) and not as the fraction-inside-a-fraction (1/2)/sqrt(x).
  if (cDen !== 1 || !isInt(cNum)) {
    const ratio = cNum / cDen;
    if (isInt(ratio)) { cNum = Math.round(ratio); cDen = 1; }
    else {
      const fr = asFraction(ratio);
      if (fr) { cNum = fr.n; cDen = fr.d; }
    }
  }
  // The increment sorts after everything else it shares a term with — ahead of
  // the factor category, so 3hx² prints as 3x²h — but numbers still lead.
  out.sort((a, b) => incRank(a) - incRank(b)
    || factorRank(a) - factorRank(b)
    || (toText(a) < toText(b) ? -1 : 1));
  if (cNum !== 1 || out.length === 0) out.unshift(num(cNum));
  if (cDen !== 1) out.push(pow(num(cDen), num(-1)));
  const kept = out.filter(f => !(isNum(f) && numV(f) === 1) || out.length === 1);
  if (kept.length === 0) return ONE;
  if (kept.length === 1) return kept[0];
  return mul(...kept);
}

function simplifyPow(/** @type {Node} */ base, /** @type {Node} */ exp) {
  if (isNum(exp)) {
    const e = numV(exp);
    if (e === 0) return ONE;
    if (e === 1) return base;
    if (isNum(base)) {
      const b = numV(base);
      if (b === 0) return e > 0 ? ZERO : num(Infinity);
      if (b === 1) return ONE;
      // Negative integer exponents stay symbolic — that is what keeps
      // antiderivatives printing as `x^3/3` rather than `0.3333x^3`.
      if (isInt(e) && e > 0) return num(Math.pow(b, e));
      if (!isInt(e)) {
        const r = Math.pow(b, e);
        if (isInt(r)) return num(Math.round(r));   // sqrt(4) → 2
      }
    }
    // (a^m)^n → a^(mn) when the outer exponent is an integer (always valid).
    if (base.type === 'pow' && isNum(base.exp) && isInt(e)) {
      return simplifyPow(base.base, num(numV(base.exp) * e));
    }
    // (ab)^n → a^n b^n for integer n. Without it a numeric factor trapped
    // inside a reciprocal never meets its partner outside: d/dx sqrt(2x+5) came
    // out of the definition as 2/(2√(2x+5)) instead of 1/√(2x+5).
    if (base.type === 'mul' && isInt(e)) {
      return simplifyMul(base.args.map(a => simplifyPow(a, num(e))));
    }
  }
  if (isNum(base) && numV(base) === 1) return ONE;
  return pow(base, exp);
}

function simplifyFn(/** @type {string} */ name, /** @type {Node} */ arg) {
  if (isNum(arg) || arg.type === 'const') {
    const a = isNum(arg) ? numV(arg) : (CONSTANTS[arg.name] ?? NaN);
    const r = FUNCTIONS[name].f(a);
    // Fold only when the answer is exact: sin(0)=0, cos(0)=1, ln(1)=0, ln(e)=1,
    // cos(pi)=-1. Anything inexact (ln(pi)) stays symbolic.
    if (Number.isFinite(r) && Math.abs(r - Math.round(r)) < 1e-12) return num(Math.round(r));
  }
  return fn(name, arg);
}

/* ────────────────────────────── derivative ─────────────────────────────── */

/**
 * Symbolic derivative, simplified.
 * @param {Node} node
 * @param {string} [v]
 * @returns {Node}
 */
export function derivative(node, v = 'x') {
  return simplify(d(node, v));
}

/**
 * Read a product back as a quotient, when it is one.
 *
 * Canonical form has no `div` node — `u/v` is `u · v⁻¹` — so the shape has to be
 * recovered before the quotient rule can be applied. Only factors whose
 * exponent is a NEGATIVE number and which actually involve the variable count
 * as the denominator; a numeric factor like ½ is a coefficient, not a divisor.
 *
 * @returns {{num:Node, den:Node}|null}
 */
export function asQuotient(n, v) {
  const bottom = [], top = [];
  for (const a of n.args) {
    if (a.type === 'pow' && isNum(a.exp) && numV(a.exp) < 0 && !isConstant(a.base, v)) {
      bottom.push(simplifyPow(a.base, num(-numV(a.exp))));
    } else top.push(a);
  }
  if (!bottom.length) return null;
  return {
    num: top.length === 0 ? ONE : (top.length === 1 ? top[0] : mul(...top)),
    den: bottom.length === 1 ? bottom[0] : mul(...bottom),
  };
}

/**
 * Distribute products over sums — but only where it SHORTENS the result.
 *
 * The quotient rule leaves a numerator like `2x(x² − 1) − 2x(x² + 1)`, which is
 * correct and is not what any textbook prints: multiplied out it is `−4x`.
 * Expanding unconditionally would be worse elsewhere — `cos(x)(cos(x) + 1) +
 * sin(x)²` needs the Pythagorean identity to pay off, and this engine has no
 * trig identities — so the expansion is kept only when it comes out no longer
 * than the factored form. `pow` is never expanded, which keeps (x²+1)⁵ intact.
 *
 * @param {Node} n @returns {Node}
 */
export function expandIfShorter(n) {
  const wide = simplify(distribute(n));
  const tight = simplify(n);
  return toText(wide).length <= toText(tight).length ? wide : tight;
}

function distribute(/** @type {Node} */ n, /** @type {boolean} */ powers = false) {
  switch (n.type) {
    // Flattened, not merely mapped: distributing -1 over (x + h) turns one
    // argument into a sum of its own, and an unflattened nest hides those terms
    // from the cartesian product below. `2/(3 - x)` stalled there with a
    // numerator it could not factor h out of.
    case 'add': {
      const out = [];
      for (const a of n.args.map(x => distribute(x, powers))) {
        if (a.type === 'add') out.push(...a.args); else out.push(a);
      }
      return add(...out);
    }
    // (a + b)^n, by repeated multiplication. Off by default: expandIfShorter
    // must keep (x² + 1)⁵ factored, and a quotient-rule numerator that expands
    // a fifth power is never the answer anyone wanted. The difference quotient
    // needs it, so it asks.
    case 'pow': {
      if (!powers || !isNum(n.exp)) return n;
      const e = numV(n.exp);
      if (!isInt(e) || e < 2 || e > 8) return n;
      const base = distribute(n.base, powers);
      if (base.type !== 'add') return n;
      let acc = base;
      for (let i = 1; i < e; i++) acc = distribute(mul(acc, base), powers);
      return acc;
    }
    case 'mul': {
      // Cartesian product across every factor that is a sum.
      let terms = [[]];
      for (const a of n.args.map(x => distribute(x, powers))) {
        const parts = a.type === 'add' ? a.args : [a];
        if (terms.length * parts.length > 60) return mul(...n.args.map(x => distribute(x, powers)));
        const next = [];
        for (const t of terms) for (const p of parts) next.push([...t, p]);
        terms = next;
      }
      if (terms.length === 1) return mul(...terms[0]);
      return add(...terms.map(t => mul(...t)));
    }
    default: return n;
  }
}

/**
 * Multiply everything out, powers included, and collect. This is the "expand"
 * of a worked line, so it is deliberately unconditional — unlike
 * {@link expandIfShorter}, which is an answer-formatting decision.
 * @param {Node} n @returns {Node}
 */
export function expand(n) {
  return simplify(distribute(n, true));
}

/**
 * Replace every occurrence of a variable with a subtree.
 *
 * The whole of the difference quotient is this plus algebra: f(x + h) is
 * `substitute(f, 'x', x + h)`.
 * @param {Node} n @param {string} v @param {Node} rep @returns {Node}
 */
export function substitute(n, v, rep) {
  switch (n.type) {
    case 'var': return n.name === v ? rep : n;
    case 'add': return add(...n.args.map(a => substitute(a, v, rep)));
    case 'mul': return mul(...n.args.map(a => substitute(a, v, rep)));
    case 'pow': return pow(substitute(n.base, v, rep), substitute(n.exp, v, rep));
    case 'fn': return fn(n.name, substitute(n.arg, v, rep));
    default: return n;
  }
}

function d(/** @type {Node} */ n, /** @type {string} */ v) {
  switch (n.type) {
    case 'num': case 'const': return ZERO;
    case 'var': return n.name === v ? ONE : ZERO;
    case 'add': return add(...n.args.map(a => d(a, v)));
    case 'mul': {
      // A quotient is stored as u·v⁻¹, and differentiating it AS a product is
      // correct but unrecognisable: d/dx[x/(x+1)] came out as
      // 1/(x+1) − x/(x+1)², which a student compares against 1/(x+1)² and
      // concludes they are wrong. Spotting the quotient and applying the
      // quotient rule directly gives the single fraction a textbook prints —
      // and lets the worked steps name the rule the course actually taught.
      const q = asQuotient(n, v);
      if (q) {
        const top = sub(mul(d(q.num, v), q.den), mul(q.num, d(q.den, v)));
        return div(expandIfShorter(top), pow(q.den, num(2)));
      }
      // Generalised product rule: sum over i of (d of arg i) × (all the others).
      return add(...n.args.map((_, i) =>
        mul(...n.args.map((b, j) => (i === j ? d(b, v) : b)))));
    }
    case 'pow': {
      const { base, exp } = n;
      const constExp = isConstant(exp, v), constBase = isConstant(base, v);
      if (constExp && constBase) return ZERO;
      // Power rule + chain rule. The new exponent is evaluated rather than left
      // as a subtraction: x^(2/3) was differentiating to 2x^(2/3 − 1)/3, which
      // is right and reads like a mistake.
      if (constExp) {
        const e = evaluate(exp, {});
        const next = Number.isFinite(e) ? num(e - 1) : sub(exp, ONE);
        return mul(exp, pow(base, next), d(base, v));
      }
      // Exponential rule: a^u.
      if (constBase) return mul(n, ln(base), d(exp, v));
      // General f^g, via logarithmic differentiation.
      return mul(n, add(mul(d(exp, v), ln(base)), div(mul(exp, d(base, v)), base)));
    }
    case 'fn': return mul(FUNCTIONS[n.name].d(n.arg), d(n.arg, v));
    default: return ZERO;
  }
}

/** Convenience: nth derivative. */
export function nthDerivative(/** @type {Node} */ node, /** @type {number} */ n, /** @type {string} */ v = 'x') {
  let out = node;
  for (let i = 0; i < n; i++) out = derivative(out, v);
  return out;
}

/* ───────────────────────────── antiderivative ──────────────────────────── */

/**
 * Is this node `a·x + b`? Returns the numeric coefficients, or null.
 * Constants are evaluated numerically, so `sin(2πx)` gives a ≈ 6.283.
 * @param {Node} n @param {string} v
 * @returns {{a:number,b:number}|null}
 */
export function linearCoeffs(n, v = 'x') {
  if (isConstant(n, v)) {
    const b = evaluate(n, {});
    return Number.isFinite(b) ? { a: 0, b } : null;
  }
  switch (n.type) {
    case 'var': return n.name === v ? { a: 1, b: 0 } : null;
    case 'add': {
      let a = 0, b = 0;
      for (const t of n.args) {
        const c = linearCoeffs(t, v);
        if (!c) return null;
        a += c.a; b += c.b;
      }
      return { a, b };
    }
    case 'mul': {
      let a = 0, b = 1;
      for (const t of n.args) {
        const c = linearCoeffs(t, v);
        if (!c) return null;
        if (c.a !== 0 && a !== 0) return null;      // x·x is not linear
        if (c.a !== 0) { a = c.a * b; b = c.b * b; }
        else { a *= c.b; b *= c.b; }
      }
      return { a, b };
    }
    case 'pow': {
      if (isNum(n.exp) && numV(n.exp) === 1) return linearCoeffs(n.base, v);
      return null;
    }
    default: return null;
  }
}

/**
 * Antiderivatives of the base functions, as u ↦ F(u). `null` means "no
 * elementary form inside Calc 1's reach".
 * @type {Record<string, (u:Node)=>Node>}
 */
const ANTI = {
  sin: u => neg(fn('cos', u)),
  cos: u => fn('sin', u),
  tan: u => neg(ln(fn('abs', fn('cos', u)))),
  cot: u => ln(fn('abs', fn('sin', u))),
  sec: u => ln(fn('abs', add(fn('sec', u), fn('tan', u)))),
  csc: u => neg(ln(fn('abs', add(fn('csc', u), fn('cot', u))))),
  ln: u => sub(mul(u, ln(u)), u),
  log: u => div(sub(mul(u, ln(u)), u), ln(num(10))),
  sinh: u => fn('cosh', u),
  cosh: u => fn('sinh', u),
  tanh: u => ln(fn('cosh', u)),
  asin: u => add(mul(u, fn('asin', u)), sqrt(sub(ONE, pow(u, num(2))))),
  acos: u => sub(mul(u, fn('acos', u)), sqrt(sub(ONE, pow(u, num(2))))),
  atan: u => sub(mul(u, fn('atan', u)), mul(num(0.5), ln(add(ONE, pow(u, num(2)))))),
};

/**
 * Symbolic antiderivative — table + linearity + linear u-substitution.
 * Returns null when it is outside the supported catalogue; callers fall back to
 * numeric integration and say so rather than guessing.
 *
 * Does NOT add "+ C" — that is the caller's job (and the printer's teaching moment).
 *
 * @param {Node} node
 * @param {string} [v]
 * @returns {Node|null}
 */
export function antiderivative(node, v = 'x') {
  const r = anti(simplify(node), v);
  return r ? simplify(r) : null;
}

function anti(/** @type {Node} */ n, /** @type {string} */ v) {
  // ∫ c dx = cx
  if (isConstant(n, v)) return mul(n, vr(v));

  // Linearity: ∫(f + g) = ∫f + ∫g
  if (n.type === 'add') {
    const parts = n.args.map(a => anti(a, v));
    if (parts.some(p => p === null)) return null;
    return add(...parts);
  }

  if (n.type === 'mul') {
    // Pull constant factors out front.
    const consts = n.args.filter(a => isConstant(a, v));
    const rest = n.args.filter(a => !isConstant(a, v));
    if (consts.length && rest.length) {
      const inner = anti(rest.length === 1 ? rest[0] : mul(...rest), v);
      return inner ? mul(...consts, inner) : null;
    }
    // The two product forms Calc 1 expects to recognise on sight.
    if (rest.length === 2) {
      const [p, q] = rest;
      const pair = (a, b) => p.type === 'fn' && q.type === 'fn' && p.name === a && q.name === b
        && toText(p.arg) === toText(q.arg);
      if (pair('sec', 'tan') || pair('tan', 'sec')) return uSub(fn('sec', p.arg), p.arg, v);
      if (pair('csc', 'cot') || pair('cot', 'csc')) return uSub(neg(fn('csc', p.arg)), p.arg, v);
    }
    return null;
  }

  // ∫ x dx
  if (n.type === 'var' && n.name === v) return div(pow(vr(v), num(2)), num(2));

  if (n.type === 'pow') {
    const { base, exp } = n;

    // ∫ u^n du/a — power rule under a linear substitution.
    if (isConstant(exp, v)) {
      const e = evaluate(exp, {});
      const lin = linearCoeffs(base, v);
      if (lin && lin.a !== 0) {
        if (Math.abs(e + 1) < 1e-12) return div(ln(fn('abs', base)), num(lin.a));
        return div(pow(base, num(e + 1)), num(lin.a * (e + 1)));
      }
      // ∫ sec²(u) du and ∫ csc²(u) du — the pair students must recognise.
      if (Math.abs(e - 2) < 1e-12 && base.type === 'fn') {
        if (base.name === 'sec') return uSub(fn('tan', base.arg), base.arg, v);
        if (base.name === 'csc') return uSub(neg(fn('cot', base.arg)), base.arg, v);
      }
      // The two inverse-trig forms: 1/(1 + x²) → arctan x, 1/√(1 − x²) → arcsin x.
      const key = toText(base);
      if (Math.abs(e + 1) < 1e-12 && key === toText(simplify(add(ONE, pow(vr(v), num(2))))))
        return fn('atan', vr(v));
      if (Math.abs(e + 0.5) < 1e-12 && key === toText(simplify(sub(ONE, pow(vr(v), num(2))))))
        return fn('asin', vr(v));
      return null;
    }

    // ∫ a^(mx+b) dx = a^(mx+b) / (m ln a)   — covers e^x, since ln e = 1.
    if (isConstant(base, v)) {
      const lin = linearCoeffs(exp, v);
      if (lin && lin.a !== 0) return div(n, mul(num(lin.a), ln(base)));
      return null;
    }

    return null;
  }

  if (n.type === 'fn') {
    const F = ANTI[n.name];
    if (!F) return null;
    return uSub(F(n.arg), n.arg, v);
  }

  return null;
}

/** Divide by the inner linear coefficient — the whole of "linear u-substitution". */
function uSub(/** @type {Node} */ F, /** @type {Node} */ innerArg, /** @type {string} */ v) {
  const lin = linearCoeffs(innerArg, v);
  if (!lin || lin.a === 0) return null;
  return lin.a === 1 ? F : div(F, num(lin.a));
}

/* ──────────────────────── numeric answer checking ──────────────────────── */

/**
 * Are two functions the same? Probe them at random points rather than trying to
 * prove it symbolically. This is smaller, more robust, and handles anything the
 * parser handles — a symbolic equality test on student input is a losing game.
 *
 * @param {(x:number)=>number} f
 * @param {(x:number)=>number} g
 * @param {{lo?:number, hi?:number, samples?:number, tol?:number, minValid?:number, rng?:()=>number}} [opts]
 * @returns {{equal:boolean, checked:number, worst:number}}
 */
export function numericallyEqual(f, g, opts = {}) {
  const { lo = -2.6, hi = 2.6, samples = 60, tol = 1e-6, minValid = 8, rng = Math.random } = opts;
  let checked = 0, worst = 0;
  for (let i = 0; i < samples; i++) {
    const x = lo + (hi - lo) * rng();
    const a = f(x), b = g(x);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;   // domain hole in one or both
    if (Math.abs(a) > 1e8 || Math.abs(b) > 1e8) continue;       // near a pole — unreliable
    checked++;
    const err = Math.abs(a - b) / Math.max(1, Math.abs(a), Math.abs(b));
    if (err > worst) worst = err;
  }
  return { equal: checked >= minValid && worst <= tol, checked, worst };
}

/**
 * Do two functions differ by a constant? This is the honest check for a student
 * antiderivative — "+ C" means F and G need only be parallel, not equal — and it
 * is exactly the check the course wants them to internalise.
 *
 * @param {(x:number)=>number} F
 * @param {(x:number)=>number} G
 * @param {{lo?:number, hi?:number, samples?:number, tol?:number, minValid?:number, rng?:()=>number}} [opts]
 * @returns {{equal:boolean, constant:number, checked:number, spread:number}}
 */
export function differsByConstant(F, G, opts = {}) {
  const { lo = -2.6, hi = 2.6, samples = 60, tol = 1e-6, minValid = 8, rng = Math.random } = opts;
  const diffs = [];
  for (let i = 0; i < samples; i++) {
    const x = lo + (hi - lo) * rng();
    const a = F(x), b = G(x);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (Math.abs(a) > 1e8 || Math.abs(b) > 1e8) continue;
    diffs.push(a - b);
  }
  if (diffs.length < minValid) return { equal: false, constant: NaN, checked: diffs.length, spread: Infinity };
  const mean = diffs.reduce((s, x) => s + x, 0) / diffs.length;
  const scale = Math.max(1, ...diffs.map(Math.abs));
  const spread = Math.max(...diffs.map(x => Math.abs(x - mean))) / scale;
  return { equal: spread <= tol, constant: mean, checked: diffs.length, spread };
}

/* ─────────────────────────────── printing ──────────────────────────────── */

/** Precedence for parenthesising: add < mul < pow < atom. */
const PREC = { add: 1, mul: 2, pow: 3 };
const precOf = (/** @type {Node} */ n) => PREC[n.type] ?? 4;

/**
 * Approximate a float as a small fraction, so stray decimals print as fractions.
 * Returns null when the number is not a nice rational.
 * @param {number} x
 */
function asFraction(x) {
  if (isInt(x)) return null;
  for (let den = 2; den <= 64; den++) {
    const numr = x * den;
    if (Math.abs(numr - Math.round(numr)) < 1e-10) return { n: Math.round(numr), d: den };
  }
  return null;
}

/** Print a number: integers plain, nice rationals as fractions, else 4 sig figs. */
function numToLatex(/** @type {number} */ x) {
  if (isInt(x)) return String(Math.round(x));
  const fr = asFraction(x);
  if (fr) return `\\frac{${Math.abs(fr.n)}}{${fr.d}}`;
  return String(Number(x.toPrecision(4)));
}

/**
 * Render to LaTeX. This is where the canonical form is undone: negative
 * exponents become denominators, `mul(-1, …)` becomes a leading minus,
 * `pow(u, 1/2)` becomes a radical, `pow(e, u)` becomes `e^u`.
 * @param {Node} node
 * @returns {string}
 */
export function toLatex(node) {
  return texOf(simplify(node));
}

/**
 * Print exactly the tree given, with no simplification.
 *
 * `toLatex` simplifies first, which is right for an answer and fatal for a line
 * of working: every intermediate step would collapse straight to the final one.
 * @param {Node} node
 * @returns {string}
 */
export function toLatexRaw(node) {
  return texOf(node);
}

function texOf(/** @type {Node} */ n, /** @type {number} */ parentPrec = 0) {
  const wrap = (/** @type {string} */ s, /** @type {number} */ own) =>
    own < parentPrec ? `\\left(${s}\\right)` : s;

  switch (n.type) {
    case 'num': {
      const s = numToLatex(Math.abs(n.value));
      return n.value < 0 ? wrap(`-${s}`, 1) : s;
    }
    case 'const': return n.name === 'pi' ? '\\pi' : n.name === 'tau' ? '\\tau' : n.name;
    case 'var': return n.name;

    case 'add': {
      let s = '';
      n.args.forEach((t, i) => {
        const { negative, node: abs } = stripSign(t);
        const piece = texOf(abs, 2);
        if (i === 0) s += negative ? `-${piece}` : piece;
        else s += negative ? ` - ${piece}` : ` + ${piece}`;
      });
      return wrap(s, 1);
    }

    case 'mul': {
      const { negative, node: absNode } = stripSign(n);
      const factors = absNode.type === 'mul' ? absNode.args : [absNode];
      /** @type {Node[]} */ const top = [];
      /** @type {Node[]} */ const bottom = [];
      for (const f of factors) {
        if (f.type === 'pow' && isNum(f.exp) && numV(f.exp) < 0) {
          bottom.push(simplifyPow(f.base, num(-numV(f.exp))));
        } else top.push(f);
      }
      // Factors are normally reordered so `2x cos(x²)` reads better than
      // `2 cos(x²) x` — but a line of working containing pending derivatives is
      // AUTHORED order, and sorting it turned the product rule from the
      // recognisable f'g + fg' into g f' + f g'. Leave working alone.
      if (factors.some(f => f.type === 'deriv')) {
        // Working: pull numbers to the front but keep everything else in the
        // order it was written, so `3cos(3x²)·d/dx[x²]` reads naturally without
        // the full sort turning f'g + fg' into g f' + f g'.
        const lead = (/** @type {Node[]} */ fs) =>
          [...fs.filter(isNum), ...fs.filter(f => !isNum(f))];
        top.splice(0, top.length, ...lead(top));
        bottom.splice(0, bottom.length, ...lead(bottom));
      } else {
        // Same comparator simplifyMul uses, or the print-time sort undoes it:
        // simplifyMul had already put 3hx² in the order 3, x², h and this sort
        // pulled the bare h back in front of the x².
        const order = (/** @type {Node} */ a, /** @type {Node} */ b) =>
          incRank(a) - incRank(b) || factorRank(a) - factorRank(b);
        top.sort(order);
        bottom.sort(order);
      }
      // Inside \frac{}{} the braces already group, so a lone sum needs no
      // parentheses: \frac{(-3x^2 - 2x - 12)}{...} was printing a redundant
      // pair on the numerator of every quotient-rule answer.
      const half = (/** @type {Node[]} */ fs) =>
        (fs.length === 1 ? texOf(fs[0], 0) : joinFactors(fs));
      const joinTop = top.length ? half(top) : '1';
      const body = bottom.length
        ? `\\frac{${joinTop}}{${half(bottom)}}`
        : joinFactors(top.length ? top : [ONE]);
      const signed = negative ? `-${body}` : body;
      // A fraction is visually self-bracketing; a bare product is not.
      const own = bottom.length && !negative ? 4 : 2;
      return wrap(signed, own);
    }

    case 'pow': {
      const { base, exp } = n;
      if (isNum(exp)) {
        const e = numV(exp);
        if (Math.abs(e - 0.5) < 1e-12) return `\\sqrt{${texOf(base, 0)}}`;
        if (Math.abs(e - 1 / 3) < 1e-6) return `\\sqrt[3]{${texOf(base, 0)}}`;
        if (e < 0) return wrap(`\\frac{1}{${texOf(simplifyPow(base, num(-e)), 0)}}`, 4);
      }
      if (base.type === 'const' && base.name === 'e') return wrap(`e^{${texOf(exp, 0)}}`, 3);
      return wrap(`${texOf(base, 4)}^{${texOf(exp, 0)}}`, 3);
    }

    case 'deriv':
      return wrap(`\\frac{d}{d${n.v}}\\!\\left[${texOf(n.arg, 0)}\\right]`, 3);

    case 'fn': {
      const inner = texOf(n.arg, 0);
      if (n.name === 'abs') return `\\left|${inner}\\right|`;
      if (n.name === 'cbrt') return `\\sqrt[3]{${inner}}`;
      return `${FUNCTIONS[n.name].tex}\\left(${inner}\\right)`;
    }
    default: return '?';
  }
}

/** Pull a leading −1 (or negative coefficient) out of a product. */
function stripSign(/** @type {Node} */ n) {
  if (isNum(n) && n.value < 0) return { negative: true, node: num(-n.value) };
  if (n.type === 'mul') {
    const i = n.args.findIndex(a => isNum(a) && numV(a) < 0);
    if (i >= 0) {
      const rest = n.args.map((a, j) => (j === i ? num(-numV(a)) : a))
        .filter(a => !(isNum(a) && numV(a) === 1));
      if (rest.length === 0) return { negative: true, node: ONE };
      return { negative: true, node: rest.length === 1 ? rest[0] : mul(...rest) };
    }
  }
  return { negative: false, node: n };
}

/** Juxtapose factors, inserting `\cdot` only where it is genuinely needed. */
function joinFactors(/** @type {Node[]} */ factors) {
  const parts = factors.map(f => texOf(f, 2));
  let out = '';
  parts.forEach((p, i) => {
    if (i > 0 && /^(?:[0-9]|\\frac)/.test(p) && /[0-9}]$/.test(out)) out += ' \\cdot ';
    out += p;
  });
  return out;
}

/**
 * ASCII form. Used for canonical keys during simplification (so it must be
 * deterministic and fully parenthesised) and as the KaTeX-less fallback.
 * @param {Node} n
 * @returns {string}
 */
export function toText(n) {
  switch (n.type) {
    case 'num': return isInt(n.value) ? String(Math.round(n.value)) : String(Number(n.value.toPrecision(12)));
    case 'const': return n.name;
    case 'var': return n.name;
    case 'add': return '(' + n.args.map(toText).join(' + ') + ')';
    case 'mul': return '(' + n.args.map(toText).join('*') + ')';
    case 'pow': return '(' + toText(n.base) + '^' + toText(n.exp) + ')';
    case 'fn': return n.name + '(' + toText(n.arg) + ')';
    case 'deriv': return 'D[' + toText(n.arg) + ']';
    default: return '?';
  }
}
