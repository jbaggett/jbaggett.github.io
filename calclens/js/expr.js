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
 *  @typedef {{type:'deriv',arg:Node,v:string}} DerivNode
 *  @typedef {{type:'integ',arg:Node,v:string}} IntegNode */
/** @typedef {NumNode|VarNode|ConstNode|AddNode|MulNode|PowNode|FnNode|DerivNode} Node */

export const num = (/** @type {number} */ value) => ({ type: 'num', value });
export const vr = (/** @type {string} */ name) => ({ type: 'var', name });
export const cst = (/** @type {string} */ name) => ({ type: 'const', name });

/**
 * Rate notation: a dependent letter's derivative written dV/dt, not V′.
 *
 * Related rates is the one place where prime notation actively obstructs. V′
 * and r′ hide WHAT each rate is a rate of, and keeping track of which quantity
 * is changing is the entire skill being taught; Stewart writes dV/dt
 * throughout. So the symbol is still just a variable name — nothing downstream
 * has to know — and the printer renders the names shaped like a rate as a
 * fraction.
 */
export const rateSymbol = (/** @type {string} */ name, /** @type {string} */ v) => `d${name}/d${v}`;
/** Does this variable name mean "the rate of A with respect to B"? */
export const RATE_RE = /^d([A-Za-z]\w*)\/d([A-Za-z]\w*)$/;

/**
 * Every symbol ever handed out as "the derivative of a dependent letter".
 *
 * A derivative symbol sorts after the letter it came from — 2y·ẏ, not 2ẏ·y —
 * and a name is all the sort has to go on. `y'` and `dy/dt` are recognisable by
 * their spelling, but a caller may ask for `\dot{y}` or anything else, so the
 * ones issued are remembered. It only ever grows, which is bounded in practice
 * by the handful of symbols a page asks for.
 * @type {Set<string>}
 */
const PRIME_SYMBOLS = new Set();
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
  if (base.type !== 'var') return 0;
  // A prime sorts last too: implicit differentiation writes 3y²y′, not 3y′y².
  // A rate sorts after even those — 2πrh·dr/dt, not 2πr·dr/dt·h — and it needs
  // its OWN tier rather than sharing the increment's, because h is in
  // INCREMENT_LETTERS and in a cone problem h is the height, an ordinary
  // factor that belongs in front of the rate.
  if (RATE_RE.test(base.name)) return 2;
  return (INCREMENT_LETTERS.has(base.name) || base.name.endsWith("'")
    || PRIME_SYMBOLS.has(base.name)) ? 1 : 0;
};

/** Print order within a product: 2x cos(x²) reads better than 2 cos(x²) x. */
function factorRank(/** @type {Node} */ n) {
  if (n.type === 'num') return 0;
  if (n.type === 'const') return 1;
  if (n.type === 'var') return 2;
  if (n.type === 'pow') return n.base.type === 'var' ? 3 : 5;
  if (n.type === 'deriv' || n.type === 'integ') return 6;
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
 * The variables that are secretly functions of the one we differentiate by.
 *
 * Implicit differentiation is exactly this: in x² + y² = 25, y is not a free
 * letter, it is whatever function of x the equation forces. So d/dx[y] is not 0
 * — it is y′, and that is the single step students miss.
 *
 * Related rates needs SEVERAL at once. In V = ⁴⁄₃πr³ differentiated by t,
 * neither V nor r is t and both depend on it, so one dependent letter cannot
 * express the problem at all: the answer dV/dt = 4πr²·dr/dt mentions two rates.
 * Hence a map from each dependent name to the symbol its derivative prints as.
 * Set while a derivative is being taken; null the rest of the time.
 * @type {Map<string,string>|null}
 */
let DEP = null;

/**
 * Dependent variables, however the caller chose to name them.
 *
 * One letter for implicit differentiation (`'y'`), several for related rates
 * (`['V','r']`), or an explicit map when the caller wants to pick the symbols
 * itself. `opts.prime` overrides the symbol for the single-letter form, which
 * is how the implicit tool asks for ẏ or anything else.
 *
 * @param {string|string[]|Record<string,string>|Map<string,string>|null} [dep]
 * @param {string} [v]
 * @param {{prime?:string, notation?:'prime'|'rate'}} [opts]
 * @returns {Map<string,string>|null}
 */
export function normalizeDeps(dep, v = 'x', opts = {}) {
  if (!dep) return null;
  const sym = (/** @type {string} */ name) =>
    (opts.notation === 'rate' ? rateSymbol(name, v) : `${name}'`);
  /** @type {Map<string,string>} */ const m = new Map();
  if (typeof dep === 'string') m.set(dep, opts.prime || sym(dep));
  else if (Array.isArray(dep)) for (const name of dep) m.set(name, sym(name));
  else for (const [name, s] of (dep instanceof Map ? dep : new Map(Object.entries(dep)))) m.set(name, s);
  // A letter cannot depend on itself, and x′ in the middle of a d/dx would be
  // nonsense rather than a hard error, so it is dropped here once.
  m.delete(v);
  for (const sym of m.values()) PRIME_SYMBOLS.add(sym);
  return m.size ? m : null;
}

/** Is this subtree fixed — mentioning neither the variable nor any dependent one? */
function isFixed(/** @type {Node} */ n, /** @type {string} */ v) {
  if (!isConstant(n, v)) return false;
  if (!DEP) return true;
  for (const name of DEP.keys()) if (!isConstant(n, name)) return false;
  return true;
}

/**
 * Symbolic derivative, simplified.
 *
 * `opts.dep` names the variable — or variables — that depend on `v`, so d/dx[y]
 * comes back as the symbol y′ rather than 0. Everything downstream — the
 * product rule, the chain rule, the printer — then carries it without knowing
 * anything special. `opts.notation: 'rate'` writes those symbols as dy/dx.
 *
 * @param {Node} node
 * @param {string} [v]
 * @param {{dep?:string|string[]|Record<string,string>|Map<string,string>, prime?:string, notation?:'prime'|'rate'}} [opts]
 * @returns {Node}
 */
export function derivative(node, v = 'x', opts = {}) {
  DEP = normalizeDeps(opts.dep, v, opts);
  try { return simplify(d(node, v)); } finally { DEP = null; }
}

/**
 * Read a product back as a quotient, when it is one.
 *
 * Canonical form has no `div` node — `u/v` is `u · v⁻¹` — so the shape has to be
 * recovered before the quotient rule can be applied. Only factors whose
 * exponent is a NEGATIVE number and which actually involve the variable count
 * as the denominator; a numeric factor like ½ is a coefficient, not a divisor.
 *
 * @param {Node} n
 * @param {string} v
 * @param {string|string[]|Map<string,string>|null} [dep]
 * @returns {{num:Node, den:Node}|null}
 */
export function asQuotient(n, v, dep) {
  const deps = !dep ? [] : typeof dep === 'string' ? [dep]
    : dep instanceof Map ? [...dep.keys()] : dep;
  const moves = (/** @type {Node} */ b) =>
    !isConstant(b, v) || deps.some(dp => !isConstant(b, dp)) || !isFixed(b, v);
  const bottom = [], top = [];
  for (const a of n.args) {
    if (a.type === 'pow' && isNum(a.exp) && numV(a.exp) < 0 && moves(a.base)) {
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
    case 'var':
      if (n.name === v) return ONE;
      if (DEP && DEP.has(n.name)) return vr(/** @type {string} */ (DEP.get(n.name)));
      return ZERO;
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
      const constExp = isFixed(exp, v), constBase = isFixed(base, v);
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

/**
 * Split an expression into A·p + B, where p is a symbol it is linear in.
 *
 * Differentiating any relation implicitly always leaves something linear in y′
 * — the chain rule can only ever multiply by it once — so this is all the
 * algebra "solve for dy/dx" needs. Unlike {@link linearCoeffs} the coefficients
 * stay SYMBOLIC: for x² + y² = 25 they are 2y and 2x, not numbers.
 *
 * @param {Node} node @param {string} p
 * @returns {{a:Node, b:Node}|null} null if it is not linear in p
 */
export function linearInSymbol(node, p) {
  const ex = expand(node);
  const terms = ex.type === 'add' ? ex.args : [ex];
  const withP = [], without = [];
  for (const t of terms) {
    if (isConstant(t, p)) { without.push(t); continue; }
    const q = simplify(mul(t, pow(vr(p), num(-1))));
    if (!isConstant(q, p)) return null;      // p appears more than once over
    withP.push(q);
  }
  return {
    a: withP.length ? simplify(add(...withP)) : ZERO,
    b: without.length ? simplify(add(...without)) : ZERO,
  };
}

/**
 * The greatest integer that divides every coefficient of a sum — its content.
 *
 * `6y - 3x²` has content 3. Used to cancel the common factor out of a quotient
 * so an answer matches what a textbook prints: the folium's slope comes out of
 * the algebra as (-3x² + 6y)/(3y² - 6x) and belongs in lowest terms.
 *
 * Returns 1 when any coefficient is not a whole number, since cancelling then
 * buys nothing and risks turning exact values into decimals.
 *
 * @param {Node} node @returns {number}
 */
export function integerContent(node) {
  const terms = node.type === 'add' ? node.args : [node];
  let g = 0;
  for (const t of terms) {
    const [c] = splitCoeff(simplify(t));
    if (!isInt(c)) return 1;
    g = gcd(g, Math.abs(Math.round(c)));
  }
  return g >= 1 ? g : 1;
}

/** Divide every coefficient of a sum by k. */
export function divideContent(/** @type {Node} */ node, /** @type {number} */ k) {
  return k === 1 ? simplify(node) : expand(mul(node, num(1 / k)));
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
export const ANTI = {
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
  const simp = simplify(node);
  const r = anti(simp, v);
  if (r) return simplify(r);
  // General u-substitution is the last resort: it is the most expensive route
  // and the one most likely to find a FORM a student would not recognise, so
  // the table and the linear case get first refusal.
  const sub = findUSub(simp, v);
  return sub ? sub.result : null;
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

      // A numeric factor inside the base, taken outside. The rescaling
      // substitution u = x/2 turns 1/(x² + 4) into 1/(4u² + 4), and the arctan
      // entry only matches 1 + u² — so the 4 has to come out, exactly as it
      // would by hand: 1/(4(u² + 1)) = ¼ · 1/(u² + 1).
      if (base.type === 'add') {
        const g = integerContent(base);
        // The factor has to be worked out, not just written down: simplify
        // leaves 9^(-1/2) standing as a power, and a 3 that never meets its
        // own reciprocal printed the answer as 3·arcsin(x/3)/3.
        const scale = g > 1 ? evaluate(pow(num(g), exp), {}) : NaN;
        if (Number.isFinite(scale)) {
          const outside = anti(simplify(mul(num(scale), pow(divideContent(base, g), exp))), v);
          if (outside) return outside;
        }
      }
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

/* ───────────────────────── general u-substitution ──────────────────────── */

/**
 * The placeholder u is substituted FOR. A name no student would type, so it can
 * never collide with a letter already in the integrand.
 */
const U = '_u';

/**
 * Replace every occurrence of one subtree with another, matched canonically.
 *
 * `substitute` only replaces a VARIABLE, and u-substitution needs to replace an
 * expression: every x² inside cos(x²) becomes u. Matching on `toText` is what
 * makes that safe — it is the same canonical key simplification already uses to
 * decide two subtrees are the same thing.
 *
 * @param {Node} n @param {string} key the target's `toText`
 * @param {Node} rep
 * @returns {Node}
 */
export function replaceSubtree(n, key, rep) {
  if (toText(n) === key) return rep;
  switch (n.type) {
    case 'add': return add(...n.args.map(a => replaceSubtree(a, key, rep)));
    case 'mul': return mul(...n.args.map(a => replaceSubtree(a, key, rep)));
    case 'pow': return pow(replaceSubtree(n.base, key, rep), replaceSubtree(n.exp, key, rep));
    case 'fn': return fn(n.name, replaceSubtree(n.arg, key, rep));
    default: return n;
  }
}

/**
 * The expressions worth trying as u, best first.
 *
 * Order is PEDAGOGY, not search efficiency. A textbook picks the inside of a
 * composition — the argument of a function, the base under a power — because
 * that is the shape a student can learn to look for, so those come first and
 * the deepest one comes first among them. Trying every subtree in arbitrary
 * order would find *an* answer while teaching a choice nobody could repeat.
 *
 * @param {Node} n @param {string} v
 * @returns {Node[]}
 */
export function uSubCandidates(n, v) {
  /** @type {{node:Node, score:number}[]} */ const found = [];
  const seen = new Set();
  const add_ = (/** @type {Node} */ u, /** @type {number} */ score) => {
    // u must involve x and must not BE x: ∫f(x)dx with u = x is not a
    // substitution, it is the same integral with a new name on it.
    if (isConstant(u, v)) return;
    if (u.type === 'var') return;
    const key = toText(u);
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ node: u, score: score + depth(u) });
  };
  const walk = (/** @type {Node} */ x) => {
    switch (x.type) {
      case 'fn':
        // Both the inside and the whole of it: ∫2x·cos(x²) wants u = x², but
        // ∫sin³x·cos x wants u = sin x, whose inside is a bare x and no use.
        // The inside scores higher, so it is still tried first when it exists.
        add_(x.arg, 100); add_(x, 90); walk(x.arg); break;
      case 'pow':
        // The base under a constant power — (x²+1)⁵ wants u = x²+1 — and an
        // exponent that is a function of x, which is how e^(x²) is spelt.
        if (isConstant(x.exp, v)) add_(x.base, 100); else { add_(x.exp, 100); add_(x, 90); }
        walk(x.base); walk(x.exp); break;
      case 'add': {
        x.args.forEach(walk); add_(x, 50);
        // ∫dx/(x² + 4) is an arctan, and the substitution a textbook teaches
        // for it is u = x/2 — a RESCALING of the variable, which is nowhere to
        // be found as a subexpression and so would never be proposed. Only for
        // a² ± x², where it is the whole technique; the general case of
        // inventing substitutions is not a road worth starting down.
        const q = quadScale(x, v);
        if (q) add_(q, 40);
        break;
      }
      case 'mul': x.args.forEach(walk); break;
      default: break;
    }
  };
  walk(n);
  // A linear u is tried LAST: ∫cos(3x+1)dx is already handled by the table with
  // a division, and "divide by 3" is a smaller thing to learn than a change of
  // variable. Only reach for the heavier machinery when the light one failed.
  const rank = (/** @type {{node:Node,score:number}} */ c) =>
    c.score - (linearCoeffs(c.node, v) ? 1000 : 0);
  return found.sort((a, b) => rank(b) - rank(a)).map(c => c.node);
}

/**
 * Divide, cancelling matching factors first.
 *
 * `simplify(div(f, g))` is not enough: it collects like factors by the base's
 * canonical key, so (e^x)⁻¹·e^x survives intact — pow(pow(e,x),−1) and
 * pow(e,x) have different keys — and the leftover x then looks to the u-sub
 * search like a substitution that failed. Striking equal factors off against
 * each other is exact, needs no new simplifier rule, and is what cancelling by
 * hand looks like anyway.
 *
 * @param {Node} n @param {Node} d
 * @returns {Node}
 */
function divideCancelling(n, d) {
  const facs = (/** @type {Node} */ x) => (x.type === 'mul' ? [...x.args] : [x]);
  const top = facs(n), bottom = [];
  for (const f of facs(d)) {
    const i = top.findIndex(t => toText(t) === toText(f));
    if (i >= 0) top.splice(i, 1); else bottom.push(f);
  }
  const num_ = top.length === 0 ? ONE : top.length === 1 ? top[0] : mul(...top);
  if (!bottom.length) return simplify(num_);
  return simplify(div(num_, bottom.length === 1 ? bottom[0] : mul(...bottom)));
}

/**
 * For a² ± x², the rescaling u = x/a. Null for anything else.
 *
 * Matched narrowly on purpose: every term must be a constant or a constant
 * times v², which is the shape of the two inverse-trig table entries and
 * nothing else.
 *
 * @param {Node} n @param {string} v
 * @returns {Node|null}
 */
function quadScale(n, v) {
  let sq = 0, con = 0;
  for (const t of n.args) {
    if (isConstant(t, v)) { const c = evaluate(t, {}); if (!Number.isFinite(c)) return null; con += c; continue; }
    const factors = t.type === 'mul' ? t.args : [t];
    let coeff = 1, square = 0;
    for (const f of factors) {
      if (isConstant(f, v)) { const c = evaluate(f, {}); if (!Number.isFinite(c)) return null; coeff *= c; continue; }
      if (f.type === 'pow' && f.base.type === 'var' && f.base.name === v
        && isNum(f.exp) && numV(f.exp) === 2 && !square) { square = 1; continue; }
      return null;
    }
    if (!square) return null;
    sq += coeff;
  }
  if (!sq || !con) return null;
  const a = Math.sqrt(Math.abs(con / sq));
  // u = x already; proposing it would be the same integral under a new name.
  if (!Number.isFinite(a) || a === 0 || Math.abs(a - 1) < 1e-12) return null;
  return div(vr(v), num(a));
}

/** How deep a subtree is — the tie-break that prefers the inner composition. */
function depth(/** @type {Node} */ n) {
  switch (n.type) {
    case 'add': case 'mul': return 1 + Math.max(...n.args.map(depth));
    case 'pow': return 1 + Math.max(depth(n.base), depth(n.exp));
    case 'fn': return 1 + depth(n.arg);
    default: return 0;
  }
}

/**
 * Find a substitution that turns ∫f dx into an integral in u alone.
 *
 * The test is the one a student is taught: divide the integrand by u′ and see
 * whether what is left mentions x anywhere except inside u. If it does not, the
 * substitution works; if it does, this u was the wrong choice.
 *
 * Linear u gets a second chance. ∫x√(2x+1)dx leaves an x behind, but u = 2x + 1
 * can be read backwards — x = (u − 1)/2 — and that is a step Calc 1 does teach.
 * It is only available for linear u, because solving for x is only easy there.
 *
 * Every result is VERIFIED by differentiating it, so a bad guess is never
 * returned. The search is a heuristic; the check is not.
 *
 * @param {Node} node integrand, already simplified
 * @param {string} v
 * @returns {{u:Node, du:Node, inU:Node, antiInU:Node, result:Node, backSub:boolean}|null}
 */
export function findUSub(node, v = 'x') {
  for (const u of uSubCandidates(node, v)) {
    const du = derivative(u, v);
    if (isNum(du) && numV(du) === 0) continue;
    const key = toText(u);
    const quotient = divideCancelling(node, du);
    const uv = vr(U);

    let inU = replaceSubtree(quotient, key, uv);
    let backSub = false;
    if (!isConstant(inU, v)) {
      // Read the substitution backwards: x = (u − b)/a.
      const lin = linearCoeffs(u, v);
      if (!lin || lin.a === 0) continue;
      inU = simplify(substitute(inU, v, div(sub(uv, num(lin.b)), num(lin.a))));
      if (!isConstant(inU, v)) continue;
      backSub = true;
    }
    inU = simplify(inU);

    // Expanding is the second attempt, not the first: reading u = 2x + 1
    // backwards leaves (u − 1)√u ⁄ 4, a product the table cannot match until it
    // is multiplied out into u^(3/2) − u^(1/2). But expanding FIRST would turn
    // tidy integrands into long polynomials for no reason.
    const antiInU = anti(inU, U) || anti(simplify(expand(inU)), U);
    if (!antiInU) continue;
    const result = simplify(replaceSubtree(simplify(antiInU), U, u));

    // The search guessed; this decides. d/dx of the answer must BE the
    // integrand, checked numerically — cheaper and more robust than trying to
    // prove it, and it makes a wrong guess impossible to return.
    const back = derivative(result, v);
    const same = numericallyEqual(compile(back, v), compile(node, v), { tol: 1e-7 });
    if (!same.equal || same.checked < 8) continue;

    return { u, du, inU, antiInU, result, backSub };
  }
  return null;
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

/**
 * Keep nested fractions full size.
 *
 * TeX sets the numerator of a fraction one style smaller, so inside a worked
 * line the d/dx of a quotient rule, or the compound fraction of a common
 * denominator, comes out small enough to be genuinely hard to read on a
 * projector. `\displaystyle` on each part stops the shrinking.
 *
 * Off by default, because a lone inline fraction in a readout should NOT grow
 * to two storeys — it is only worked steps that want this. And never inside an
 * exponent: x^(2/3) with a display-size exponent is a disaster, which is what
 * SCRIPT tracks.
 */
let DISPLAY_FRACS = false;
let SCRIPT_DEPTH = 0;
const dwrap = (/** @type {string} */ s) =>
  (DISPLAY_FRACS && SCRIPT_DEPTH === 0 ? `\\displaystyle ${s}` : s);

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
export function toLatex(node, opts = {}) {
  return print(simplify(node), opts);
}

function print(/** @type {Node} */ node, /** @type {{displayFractions?:boolean}} */ opts) {
  DISPLAY_FRACS = !!opts.displayFractions;
  SCRIPT_DEPTH = 0;
  try { return texOf(node); } finally { DISPLAY_FRACS = false; }
}

/**
 * Print exactly the tree given, with no simplification.
 *
 * `toLatex` simplifies first, which is right for an answer and fatal for a line
 * of working: every intermediate step would collapse straight to the final one.
 * @param {Node} node
 * @returns {string}
 */
export function toLatexRaw(node, opts = {}) {
  return print(node, opts);
}

/** Is there a pending integral anywhere in this subtree? */
function hasInteg(/** @type {Node} */ n) {
  if (!n || typeof n !== 'object') return false;
  if (n.type === 'integ') return true;
  if (n.args) return n.args.some(hasInteg);
  if (n.type === 'pow') return hasInteg(n.base) || hasInteg(n.exp);
  if (n.type === 'fn') return hasInteg(n.arg);
  return false;
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
    case 'var': {
      // dV/dt is carried as a variable NAME, so this is the one place that
      // knows it is really a fraction. Same dwrap as every other fraction, so
      // it is the same size as the rest of the line.
      const r = RATE_RE.exec(n.name);
      return r ? `\\frac{${dwrap(`d${r[1]}`)}}{${dwrap(`d${r[2]}`)}}` : n.name;
    }

    case 'add': {
      let s = '';
      n.args.forEach((t, i) => {
        const { negative, node: abs } = stripSign(t);
        const piece = texOf(abs, 2);
        if (i === 0) { s += negative ? `-${piece}` : piece; return; }
        const op = negative ? '-' : '+';
        // The rule's own mark, on the sign the rule put there. A product rule
        // introduces the +, a quotient rule the −; writing PR or QR above it is
        // how the work is annotated on a board, and it says WHICH PART of a
        // long line each rule was responsible for — which a list in the margin
        // cannot. Only the first join is marked: one application, one mark.
        s += ` ${i === 1 && n.tag ? `\\overset{\\text{${n.tag}}}{${op}}` : op} ${piece}`;
      });
      return wrap(s, 1);
    }

    case 'mul': {
      const { negative, node: absNode } = stripSign(n);
      const factors = absNode.type === 'mul' ? absNode.args : [absNode];
      /** @type {Node[]} */ const top = [];
      /** @type {Node[]} */ const bottom = [];
      // An integral sign never goes over a fraction bar. ¼∫f du is how it is
      // written; ∫f du with a 4 underneath it is correct, unreadable and
      // nobody's handwriting. The reciprocal then prints as a leading ¼ on its
      // own, which is the same thing said the usual way. The integral can be
      // nested — ¼(∫f du − ∫g du) is the same case — so the whole subtree is
      // searched, not just the top row of factors.
      const working = factors.some(hasInteg);
      for (const f of factors) {
        if (!working && f.type === 'pow' && isNum(f.exp) && numV(f.exp) < 0) {
          bottom.push(simplifyPow(f.base, num(-numV(f.exp))));
        } else top.push(f);
      }
      // Factors are normally reordered so `2x cos(x²)` reads better than
      // `2 cos(x²) x` — but a line of working containing pending derivatives is
      // AUTHORED order, and sorting it turned the product rule from the
      // recognisable f'g + fg' into g f' + f g'. Leave working alone.
      if (factors.some(f => f.type === 'deriv' || f.type === 'integ')) {
        // Working: pull numbers to the front but keep everything else in the
        // order it was written, so `3cos(3x²)·d/dx[x²]` reads naturally without
        // the full sort turning f'g + fg' into g f' + f g'.
        // A reciprocal counts as a number for this purpose: ¼ is a
        // coefficient, and leaving it where it was written put it AFTER the
        // integral it multiplies.
        const coeff = (/** @type {Node} */ f) =>
          isNum(f) || (f.type === 'pow' && isNum(f.base) && isNum(f.exp));
        const lead = (/** @type {Node[]} */ fs) =>
          [...fs.filter(coeff), ...fs.filter(f => !coeff(f))];
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
      // A chain rule's mark goes on the dot before the inner derivative, which
      // is always the last factor. The dot is forced for a marked product even
      // where juxtaposition would do, because the mark needs something to sit on.
      if (n.tag && top.length > 1 && !bottom.length) {
        const parts = top.map(f => texOf(f, 2));
        const lead = parts.slice(0, -1).join('');
        const body0 = `${lead}\\overset{\\text{${n.tag}}}{\\cdot}${parts[parts.length - 1]}`;
        return wrap(negative ? `-${body0}` : body0, 2);
      }
      const joinTop = top.length ? half(top) : '1';
      const body = bottom.length
        ? `\\frac{${dwrap(joinTop)}}{${dwrap(half(bottom))}}`
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
        if (e < 0) return wrap(`\\frac{1}{${dwrap(texOf(simplifyPow(base, num(-e)), 0))}}`, 4);
      }
      // An exponent is script style all the way down, whatever the line wants.
      const sup = () => { SCRIPT_DEPTH += 1; const t = texOf(exp, 0); SCRIPT_DEPTH -= 1; return t; };
      if (base.type === 'const' && base.name === 'e') return wrap(`e^{${sup()}}`, 3);
      return wrap(`${texOf(base, 4)}^{${sup()}}`, 3);
    }

    case 'integ': {
      // An integral sign reaches rightwards over everything up to its d@, so it
      // is not itself parenthesised: the thin space before the differential is
      // what closes it to a reader. But a SUM has to be bracketed, because
      // ∫ sin x + 3x² dx says the 3x² is outside the integral, which is a
      // different statement and a false one.
      const inner = texOf(n.arg, 0);
      const body = n.arg.type === 'add' ? `\\left[${inner}\\right]` : inner;
      return `\\int ${body}\\,d${n.v}`;
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
    // A control sequence swallows the letters after it: \pi next to x became
    // `\pix`, an undefined command, and `throwOnError: false` renders that as
    // red literal source rather than failing. Every expression multiplying pi
    // or tau by a variable was broken this way.
    else if (i > 0 && /\\[a-zA-Z]+$/.test(out) && /^[a-zA-Z]/.test(p)) out += ' ';
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
    case 'integ': return 'I_' + n.v + '[' + toText(n.arg) + ']';
    default: return '?';
  }
}
