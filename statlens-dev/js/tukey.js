// @ts-check
/**
 * Studentized range distribution (Tukey's q) — `ptukey`/`qtukey`, the pieces
 * jStat lacks, needed for Tukey HSD multiple comparisons (REQ-026).
 *
 * ptukey(q, k, df) = P(W ≤ q) where W is the studentized range of k group means
 * on `df` within-group degrees of freedom. Computed by numerical integration
 * (Simpson) of the range-of-k-normals CDF mixed over the scale `s = √(χ²_df/df)`.
 * Matches R's ptukey/qtukey to ~3–4 decimals across typical (k ≤ 12, df ≥ 2).
 */

import { normalCDF } from './distributions.js';

const SQRT2PI = Math.sqrt(2 * Math.PI);
const phi = (/** @type {number} */ x) => Math.exp(-0.5 * x * x) / SQRT2PI;
const Phi = (/** @type {number} */ x) => normalCDF(x, 0, 1);

/** Lanczos log-gamma. */
function lgamma(x) {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Composite Simpson integration of f over [a,b] with n (even) intervals. */
function simpson(f, a, b, n) {
  if (n % 2) n++;
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * f(a + i * h);
  return (s * h) / 3;
}

/**
 * CDF of the range of k iid standard normals at w:
 *   P(W ≤ w) = k ∫ φ(x) [Φ(x) − Φ(x−w)]^(k−1) dx   (integrate over the max x).
 * @param {number} w @param {number} k
 */
function rangeCDF(w, k) {
  if (w <= 0) return 0;
  const integrand = (/** @type {number} */ x) => k * phi(x) * Math.pow(Phi(x) - Phi(x - w), k - 1);
  // φ negligible beyond ±8.5; widen a touch for large w.
  const a = -8.5, b = 8.5 + w;
  return Math.min(1, Math.max(0, simpson(integrand, a, b, 240)));
}

/**
 * P(studentized range ≤ q) for k groups, df within-group degrees of freedom.
 * @param {number} q @param {number} k @param {number} df
 */
export function ptukey(q, k, df) {
  if (q <= 0) return 0;
  if (!(k >= 2)) return NaN;
  if (df >= 25000) return rangeCDF(q, k); // df = ∞ limit
  // Density of s = √(χ²_df/df):  g(s) = 2 (df/2)^(df/2) / Γ(df/2) · s^(df−1) e^(−df s²/2)
  const logC = Math.log(2) + (df / 2) * Math.log(df / 2) - lgamma(df / 2);
  const g = (/** @type {number} */ s) => (s <= 0 ? 0 : Math.exp(logC + (df - 1) * Math.log(s) - (df * s * s) / 2));
  // s concentrates near 1; cover the upper tail generously (heavy for small df).
  const sMax = Math.sqrt((df + 6 * Math.sqrt(2 * df) + 30) / df);
  const integrand = (/** @type {number} */ s) => g(s) * rangeCDF(q * s, k);
  return Math.min(1, Math.max(0, simpson(integrand, 1e-6, sMax, 160)));
}

/**
 * Studentized range quantile: the q with ptukey(q,k,df) = p. Bisection.
 * @param {number} p @param {number} k @param {number} df
 */
export function qtukey(p, k, df) {
  if (!(p > 0 && p < 1)) return NaN;
  let lo = 0, hi = 100;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (ptukey(mid, k, df) < p) lo = mid; else hi = mid;
    if (hi - lo < 1e-5) break;
  }
  return (lo + hi) / 2;
}
