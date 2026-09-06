/**
 * Numerical methods for CalcLens.
 *
 * Two audiences, deliberately kept apart:
 *
 *   1. Methods the STUDENT is looking at — `riemann()` returns every rectangle
 *      so the chart can draw them, because the picture is the lesson.
 *   2. Methods the TOOL uses behind the scenes — `adaptiveSimpson()` is the
 *      fallback whenever `antiderivative()` returns null, so the accumulation
 *      function still draws for integrands with no elementary antiderivative
 *      (which is exactly where the concept gets interesting: erf, sin(x)/x).
 *
 * Nothing here is seeded — none of it is random. Randomness lives in the tools
 * that need reproducible problem sets, using StatLens's sfc32 PRNG.
 */

/** Rectangle/trapezoid rules the Riemann tools offer. */
export const RIEMANN_RULES = ['left', 'right', 'midpoint', 'trapezoid'];

/**
 * Riemann sum, returning the pieces as well as the total — the chart needs the
 * pieces, and recomputing them separately is how the picture and the number
 * drift apart.
 *
 * @param {(x:number)=>number} f
 * @param {number} a
 * @param {number} b
 * @param {number} n number of subintervals
 * @param {'left'|'right'|'midpoint'|'trapezoid'} rule
 * @returns {{sum:number, pieces:{x0:number,x1:number,height:number,area:number,sampleX:number}[]}}
 */
export function riemann(f, a, b, n, rule = 'left') {
  const dx = (b - a) / n;
  const pieces = [];
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const x0 = a + i * dx, x1 = x0 + dx;
    let height, sampleX;
    if (rule === 'left') { sampleX = x0; height = f(x0); }
    else if (rule === 'right') { sampleX = x1; height = f(x1); }
    else if (rule === 'midpoint') { sampleX = (x0 + x1) / 2; height = f(sampleX); }
    else { sampleX = (x0 + x1) / 2; height = (f(x0) + f(x1)) / 2; }  // trapezoid
    const area = height * dx;
    if (Number.isFinite(area)) sum += area;
    pieces.push({ x0, x1, height, area, sampleX });
  }
  return { sum, pieces };
}

/**
 * Composite Simpson's rule on a fixed grid. `n` is rounded up to an even number.
 * @param {(x:number)=>number} f @param {number} a @param {number} b @param {number} [n]
 */
export function simpson(f, a, b, n = 200) {
  if (a === b) return 0;
  const m = n % 2 === 0 ? n : n + 1;
  const h = (b - a) / m;
  let s = f(a) + f(b);
  for (let i = 1; i < m; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
  return (s * h) / 3;
}

/**
 * Adaptive Simpson. Splits where the function is misbehaving instead of
 * everywhere, so a sharp peak costs subdivisions and a flat stretch does not.
 * Non-finite samples (a pole inside the interval) return NaN rather than a
 * plausible-looking wrong number.
 *
 * @param {(x:number)=>number} f @param {number} a @param {number} b
 * @param {{tol?:number, maxDepth?:number}} [opts]
 */
export function adaptiveSimpson(f, a, b, opts = {}) {
  const { tol = 1e-10, maxDepth = 20 } = opts;
  if (a === b) return 0;
  if (a > b) return -adaptiveSimpson(f, b, a, opts);

  const simp = (/** @type {number} */ lo, /** @type {number} */ hi,
    /** @type {number} */ flo, /** @type {number} */ fmid, /** @type {number} */ fhi) =>
    ((hi - lo) / 6) * (flo + 4 * fmid + fhi);

  function recurse(lo, hi, flo, fmid, fhi, whole, depth) {
    const mid = (lo + hi) / 2;
    const lmid = (lo + mid) / 2, rmid = (mid + hi) / 2;
    const flm = f(lmid), frm = f(rmid);
    if (!Number.isFinite(flm) || !Number.isFinite(frm)) return NaN;
    const left = simp(lo, mid, flo, flm, fmid);
    const right = simp(mid, hi, fmid, frm, fhi);
    if (depth >= maxDepth || Math.abs(left + right - whole) <= 15 * tol) {
      return left + right + (left + right - whole) / 15;
    }
    return recurse(lo, mid, flo, flm, fmid, left, depth + 1)
      + recurse(mid, hi, fmid, frm, fhi, right, depth + 1);
  }

  const fa = f(a), fb = f(b), fm = f((a + b) / 2);
  if (!Number.isFinite(fa) || !Number.isFinite(fb) || !Number.isFinite(fm)) return NaN;
  return recurse(a, b, fa, fm, fb, simp(a, b, fa, fm, fb), 0);
}

/**
 * The accumulation function A(x) = ∫ₐˣ f(t) dt, sampled on a grid.
 *
 * Built by marching — each step integrates only the new sliver and adds it to
 * the running total — so producing 400 points costs about the same as one
 * integration, not 400. That is what lets the accumulation tool redraw while
 * the student drags.
 *
 * @param {(t:number)=>number} f
 * @param {number} a lower limit (where A is pinned to 0)
 * @param {number} x0 left edge of the output grid
 * @param {number} x1 right edge of the output grid
 * @param {number} [steps]
 * @returns {{x:number, y:number}[]}
 */
export function accumulationCurve(f, a, x0, x1, steps = 400) {
  const dx = (x1 - x0) / steps;
  /** @type {{x:number,y:number}[]} */
  const out = [];
  // Walk out from `a` in both directions so the pin A(a) = 0 is exact.
  const gridA = Math.round((a - x0) / dx);
  let running = 0;
  for (let i = gridA; i <= steps; i++) {
    const x = x0 + i * dx;
    if (i > gridA) running += simpson(f, x - dx, x, 2);
    out.push({ x, y: running });
  }
  running = 0;
  for (let i = gridA - 1; i >= 0; i--) {
    const x = x0 + i * dx;
    running -= simpson(f, x, x + dx, 2);
    out.unshift({ x, y: running });
  }
  return out;
}

/**
 * Central-difference derivative. Used only where a symbolic one is unavailable
 * (a user-drawn curve); prefer `expr.derivative()` everywhere else.
 * @param {(x:number)=>number} f @param {number} x @param {number} [h]
 */
export function centralDiff(f, x, h = 1e-5) {
  const scale = Math.max(1, Math.abs(x));
  const step = h * scale;
  return (f(x + step) - f(x - step)) / (2 * step);
}

/**
 * Bisection root find on [a,b], for tools that need a crossing (Newton's method
 * comparisons, MVT tangent points). Returns null when f doesn't change sign.
 * @param {(x:number)=>number} f @param {number} a @param {number} b @param {number} [tol]
 */
export function bisect(f, a, b, tol = 1e-12) {
  let lo = a, hi = b, flo = f(lo), fhi = f(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null;
  for (let i = 0; i < 200 && hi - lo > tol; i++) {
    const mid = (lo + hi) / 2, fm = f(mid);
    if (!Number.isFinite(fm)) return null;
    if (flo * fm <= 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}
