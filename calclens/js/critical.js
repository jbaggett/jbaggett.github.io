/**
 * Critical numbers, read off the factored derivative.
 *
 * The reason simplifying matters, made concrete. A derivative left as
 * 2x(x−1)^(1/3) + x²/(3(x−1)^(2/3)) hides both of the things you need; the
 * same derivative as x(7x−6)/(3(x−1)^(2/3)) shows them at a glance — the
 * numerator's zeros are where f′ = 0, and the denominator's are where f′ does
 * not exist. Students reliably remember the first kind and forget the second,
 * and the factored form is what puts them side by side.
 *
 * Roots are taken FACTOR BY FACTOR rather than from the whole derivative,
 * which is both more exact and more robust: a linear factor gives its root
 * exactly, and x² gives 0 even though f′ never changes sign there — a scan for
 * sign changes across the whole expression would walk straight past it.
 */

import {
  simplify, derivative, compile, isConstant, toText, toLatex,
  factorForCriticalNumbers, asQuotient, linearCoeffs, isNum, numV, evaluate,
} from './expr.js';
import { findRoots } from './numeric.js';

/** The factors of a product, or the thing itself. */
const factorsOf = (/** @type {any} */ n) => (n && n.type === 'mul' ? n.args : [n]);

/** A power contributes exactly the roots of its base. */
function baseOf(/** @type {any} */ n) {
  let b = n;
  while (b && b.type === 'pow' && Number.isFinite(evaluate(b.exp, {}))) b = b.base;
  return b;
}

/**
 * a·x² + b·x + c by sampling, or null if it is not a quadratic.
 * Three points determine it and a fourth checks it, which is cheaper and more
 * general than walking the tree for coefficients.
 */
function quadCoeffs(/** @type {any} */ n, /** @type {string} */ v) {
  const f = compile(n, v);
  const p0 = f(0), p1 = f(1), pm = f(-1);
  if (![p0, p1, pm].every(Number.isFinite)) return null;
  const c = p0, a = (p1 + pm) / 2 - c, b = (p1 - pm) / 2;
  for (const t of [2, -3, 0.5]) {
    const want = a * t * t + b * t + c;
    const got = f(t);
    if (!Number.isFinite(got) || Math.abs(got - want) > 1e-7 * Math.max(1, Math.abs(want))) return null;
  }
  return { a, b, c };
}

/** A rational as "6/7" when it is one, else a rounded decimal. */
export function exactLabel(/** @type {number} */ x) {
  if (!Number.isFinite(x)) return '—';
  if (Math.abs(x - Math.round(x)) < 1e-10) return String(Math.round(x));
  for (let d = 2; d <= 64; d += 1) {
    const top = x * d;
    if (Math.abs(top - Math.round(top)) < 1e-10) return `${Math.round(top)}/${d}`;
  }
  return String(Number(x.toPrecision(6)));
}

/**
 * Where one factor is zero.
 * @returns {{x:number, exact:boolean}[]}
 */
function rootsOfFactor(/** @type {any} */ fct, /** @type {string} */ v, lo = -12, hi = 12) {
  const base = baseOf(fct);
  if (!base || isConstant(base, v)) return [];

  const lin = linearCoeffs(base, v);
  if (lin && lin.a !== 0) return [{ x: -lin.b / lin.a, exact: true }];

  const q = quadCoeffs(base, v);
  if (q && Math.abs(q.a) > 1e-12) {
    const disc = q.b * q.b - 4 * q.a * q.c;
    if (disc < -1e-12) return [];                       // no real zeros
    const r = Math.sqrt(Math.max(0, disc));
    const xs = [(-q.b - r) / (2 * q.a), (-q.b + r) / (2 * q.a)];
    return (Math.abs(disc) < 1e-12 ? [xs[0]] : xs).map(x => ({ x, exact: true }));
  }

  // Anything else: numerically, and over the factor rather than the whole
  // derivative, so a root it only touches is still a sign change of the factor.
  // A modest window on purpose — cos x has a root every π, and listing
  // thirty of them says less than listing four and saying there are more.
  return findRoots(compile(base, v), lo, hi).map(x => ({ x, exact: false }));
}

/**
 * @typedef {{x:number, label:string, exact:boolean, kind:'zero'|'undefined',
 *            turn:'max'|'min'|'neither'}} Critical
 *
 * @param {any} fNode
 * @param {string} [v]
 * @returns {{
 *   deriv:any, factored:any, num:any, den:any|null,
 *   points:Critical[], intervals:{from:number, to:number, sign:number}[],
 *   domainWarnings:string[],
 * }}
 */
export function criticalPoints(fNode, v = 'x') {
  const deriv = simplify(derivative(fNode, v));
  const factored = factorForCriticalNumbers(deriv, v);
  const q = factored.type === 'mul' ? asQuotient(factored, v) : null;
  const num = q ? q.num : factored;
  const den = q ? q.den : null;

  const fAt = compile(fNode, v);
  const dAt = compile(deriv, v);
  /** @type {Critical[]} */ const points = [];
  const add = (/** @type {{x:number, exact:boolean}} */ r, /** @type {'zero'|'undefined'} */ kind) => {
    if (!Number.isFinite(r.x)) return;
    // A point where f itself is undefined is not a critical number — it is not
    // in the domain, so there is nothing there to be a maximum or a minimum of.
    if (!Number.isFinite(fAt(r.x))) return;
    if (points.some(p => Math.abs(p.x - r.x) < 1e-7)) return;
    points.push({ x: r.x, label: exactLabel(r.x), exact: r.exact, kind });
  };

  for (const fct of factorsOf(num)) for (const r of rootsOfFactor(fct, v)) add(r, 'zero');
  if (den) for (const fct of factorsOf(den)) for (const r of rootsOfFactor(fct, v)) add(r, 'undefined');
  points.sort((a, b) => a.x - b.x);

  // ── the sign of f′ between them ──────────────────────────────────────────
  const xs = points.map(p => p.x);
  const span = xs.length ? Math.max(1, (xs[xs.length - 1] - xs[0]) || 2) : 2;
  const lo = (xs.length ? xs[0] : 0) - span;
  const hi = (xs.length ? xs[xs.length - 1] : 0) + span;
  const edges = [lo, ...xs, hi];
  const intervals = [];
  for (let i = 0; i < edges.length - 1; i += 1) {
    const a = edges[i], b = edges[i + 1];
    // Several probes, because one can land on a point where f′ is undefined.
    let s = 0;
    for (const t of [0.5, 0.25, 0.75, 0.1, 0.9]) {
      const y = dAt(a + (b - a) * t);
      if (Number.isFinite(y) && Math.abs(y) > 1e-12) { s = Math.sign(y); break; }
    }
    intervals.push({ from: a, to: b, sign: s });
  }

  // Say so rather than quietly truncating: a periodic derivative has roots
  // outside any window, and a list that stops without comment reads as a
  // complete list.
  const warnings = [];
  if (points.some(p => !p.exact && Math.abs(p.x) > 10)) {
    warnings.push('This derivative has zeros outside the window searched — '
      + 'the ones listed are those between −12 and 12.');
  }
  // What each one turns out to be. A critical number is not automatically an
  // extremum — f′ = 3x² is zero at the origin and x³ has no turning point
  // there — and the sign on either side is the whole of the first derivative
  // test, so it is read off here rather than left as an exercise in squinting.
  points.forEach((p, i) => {
    const before = intervals[i] ? intervals[i].sign : 0;
    const after = intervals[i + 1] ? intervals[i + 1].sign : 0;
    p.turn = (before > 0 && after < 0) ? 'max'
      : (before < 0 && after > 0) ? 'min'
        : 'neither';
  });

  return { deriv, factored, num, den, points, intervals, domainWarnings: warnings };
}
