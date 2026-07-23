// @ts-check
/**
 * Multiple linear regression by ordinary least squares (REQ-038).
 *
 * Fits y = β0 + β1·x1 + … + βk·xk via the normal equations
 * β = (XᵀX)⁻¹ Xᵀy, and returns the full inference/diagnostic bundle a
 * `summary(lm)` + `anova(lm)` would: coefficient table (estimate, SE, t, p, CI),
 * the model F-test, R² / adjusted R² / residual SE, per-point leverage and
 * Cook's distance, and per-predictor VIF.
 *
 * The linear algebra here is dependency-free. The p-values and the CI critical
 * value use the t / F CDFs from ./distributions.js, so `setJStat(...)` must have
 * run first (the page does it at startup; tests set it up explicitly).
 */
import { tCDF, tInv, fCDF } from './distributions.js';

// ─── Minimal matrix algebra ────────────────────────────────────────────────

/** @param {number[][]} A @returns {number[][]} */
function transpose(A) {
  const rows = A.length, cols = A[0].length;
  const T = Array.from({ length: cols }, () => new Array(rows));
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) T[j][i] = A[i][j];
  return T;
}

/** Matrix × matrix. @param {number[][]} A @param {number[][]} B @returns {number[][]} */
function matMul(A, B) {
  const n = A.length, m = B[0].length, p = B.length;
  const C = Array.from({ length: n }, () => new Array(m).fill(0));
  for (let i = 0; i < n; i++) {
    for (let l = 0; l < p; l++) {
      const a = A[i][l];
      if (a === 0) continue;
      for (let j = 0; j < m; j++) C[i][j] += a * B[l][j];
    }
  }
  return C;
}

/** Matrix × vector. @param {number[][]} A @param {number[]} v @returns {number[]} */
function matVec(A, v) {
  return A.map(row => row.reduce((s, a, j) => s + a * v[j], 0));
}

/**
 * Inverse via Gauss–Jordan elimination with partial pivoting.
 * @param {number[][]} M — square
 * @returns {number[][]}
 * @throws if singular (predictors collinear / too few rows)
 */
function inverse(M) {
  const n = M.length;
  // Augment [M | I]
  const A = M.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    // partial pivot: largest magnitude in this column at/under the diagonal
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-12) {
      throw new Error('Design matrix is singular — predictors are collinear or there are too few observations.');
    }
    [A[col], A[piv]] = [A[piv], A[col]];
    const d = A[col][col];
    for (let j = 0; j < 2 * n; j++) A[col][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r][col];
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) A[r][j] -= f * A[col][j];
    }
  }
  return A.map(row => row.slice(n));
}

const mean = (/** @type {number[]} */ a) => a.reduce((s, v) => s + v, 0) / a.length;

/**
 * Correlation matrix of a set of predictor columns (for VIF).
 * @param {number[][]} cols — array of predictor columns, each length n
 * @returns {number[][]}
 */
function correlationMatrix(cols) {
  const p = cols.length;
  const means = cols.map(mean);
  const sds = cols.map((c, j) => Math.sqrt(c.reduce((s, v) => s + (v - means[j]) ** 2, 0)));
  const R = Array.from({ length: p }, () => new Array(p).fill(0));
  for (let a = 0; a < p; a++) {
    for (let b = a; b < p; b++) {
      let num = 0;
      for (let i = 0; i < cols[a].length; i++) num += (cols[a][i] - means[a]) * (cols[b][i] - means[b]);
      const denom = sds[a] * sds[b];
      const r = denom === 0 ? 0 : num / denom;
      R[a][b] = R[b][a] = r;
    }
  }
  return R;
}

/**
 * @typedef {Object} MlrCoefficient
 * @property {string} name         - "(Intercept)" or a predictor name
 * @property {number} estimate
 * @property {number} se
 * @property {number} t
 * @property {number} p
 * @property {number} ciLo
 * @property {number} ciHi
 * @property {number} [vif]        - undefined for the intercept and single-predictor fits
 *
 * @typedef {Object} MlrFit
 * @property {number} n
 * @property {number} k                       - number of predictors (excl. intercept)
 * @property {string} response
 * @property {MlrCoefficient[]} coefficients  - intercept first, then predictors
 * @property {number} fStat
 * @property {number} fdf1
 * @property {number} fdf2
 * @property {number} fp
 * @property {number} r2
 * @property {number} adjR2
 * @property {number} residualSE
 * @property {number} sse
 * @property {number} ssr
 * @property {number} sst
 * @property {number[]} fitted
 * @property {number[]} residuals
 * @property {number[]} leverage
 * @property {number[]} cooksD
 * @property {number} leverageThreshold        - 2(k+1)/n rule of thumb
 * @property {number} cooksThreshold           - 4/n rule of thumb
 */

/**
 * Fit an MLR model.
 * @param {number[][]} X — predictor columns (each length n)
 * @param {number[]} y — response (length n)
 * @param {{ predictorNames?: string[], responseName?: string, confLevel?: number }} [opts]
 * @returns {MlrFit}
 */
export function fitMLR(X, y, opts = {}) {
  const confLevel = opts.confLevel ?? 0.95;
  const predictorNames = opts.predictorNames ?? X.map((_, j) => `x${j + 1}`);
  const n = y.length;
  const k = X.length;                 // predictors, excluding intercept
  const cols = k + 1;                 // design columns incl. intercept
  if (n <= cols) throw new Error(`Need more observations than coefficients (n = ${n}, coefficients = ${cols}).`);

  // Design matrix (n × cols), intercept column of 1s first.
  const Xm = [];
  for (let i = 0; i < n; i++) {
    const row = [1];
    for (let j = 0; j < k; j++) row.push(X[j][i]);
    Xm.push(row);
  }

  const Xt = transpose(Xm);
  const XtX = matMul(Xt, Xm);
  const XtXinv = inverse(XtX);         // throws if singular
  const beta = matVec(matMul(XtXinv, Xt), y);

  const fitted = matVec(Xm, beta);
  const residuals = y.map((yi, i) => yi - fitted[i]);
  const ybar = mean(y);
  const sse = residuals.reduce((s, e) => s + e * e, 0);
  const sst = y.reduce((s, yi) => s + (yi - ybar) ** 2, 0);
  const ssr = sst - sse;
  const dfResid = n - cols;
  const mse = sse / dfResid;
  const residualSE = Math.sqrt(mse);

  const r2 = sst === 0 ? 0 : ssr / sst;
  const adjR2 = 1 - (1 - r2) * (n - 1) / dfResid;

  const fStat = (ssr / k) / mse;
  const fp = 1 - fCDF(fStat, k, dfResid);

  const tCrit = tInv(1 - (1 - confLevel) / 2, dfResid);

  // VIF per predictor (needs ≥ 2 predictors); diagonal of inverse correlation matrix.
  let vif = null;
  if (k >= 2) {
    try {
      const Rinv = inverse(correlationMatrix(X));
      vif = Rinv.map((row, j) => row[j]);
    } catch { vif = null; }  // perfectly collinear predictors
  }

  const names = ['(Intercept)', ...predictorNames];
  const coefficients = beta.map((est, j) => {
    const se = Math.sqrt(mse * XtXinv[j][j]);
    const t = se === 0 ? 0 : est / se;
    const p = 2 * (1 - tCDF(Math.abs(t), dfResid));
    return {
      name: names[j],
      estimate: est,
      se,
      t,
      p,
      ciLo: est - tCrit * se,
      ciHi: est + tCrit * se,
      vif: (j >= 1 && vif) ? vif[j - 1] : undefined,
    };
  });

  // Leverage h_i = x_iᵀ (XᵀX)⁻¹ x_i ; Cook's D_i.
  const leverage = Xm.map(row => {
    const v = matVec(XtXinv, row);       // (XᵀX)⁻¹ x_i
    return row.reduce((s, a, j) => s + a * v[j], 0);
  });
  const cooksD = residuals.map((e, i) => {
    const h = leverage[i];
    return (e * e / (cols * mse)) * (h / ((1 - h) ** 2));
  });

  return {
    n, k, response: opts.responseName ?? 'y',
    coefficients,
    fStat, fdf1: k, fdf2: dfResid, fp,
    r2, adjR2, residualSE,
    sse, ssr, sst,
    fitted, residuals, leverage, cooksD,
    leverageThreshold: (2 * cols) / n,
    cooksThreshold: 4 / n,
  };
}

/**
 * Predict at a new point, with a CI for the mean response and a prediction
 * interval for a new observation.
 * @param {MlrFit} fit
 * @param {number[][]} X — the predictor columns the fit was built from
 * @param {number[]} y
 * @param {number[]} xNew — one value per predictor (in predictor order)
 * @param {number} [confLevel]
 * @returns {{ yhat:number, ciLo:number, ciHi:number, piLo:number, piHi:number }}
 */
export function predictMLR(fit, X, y, xNew, confLevel = 0.95) {
  const n = y.length, k = X.length, cols = k + 1;
  const Xm = [];
  for (let i = 0; i < n; i++) { const row = [1]; for (let j = 0; j < k; j++) row.push(X[j][i]); Xm.push(row); }
  const XtXinv = inverse(matMul(transpose(Xm), Xm));
  const x0 = [1, ...xNew];
  const beta = fit.coefficients.map(c => c.estimate);
  const yhat = x0.reduce((s, a, j) => s + a * beta[j], 0);
  const mse = fit.residualSE ** 2;
  const leverage0 = x0.reduce((s, a, j) => s + a * matVec(XtXinv, x0)[j], 0);
  const tCrit = tInv(1 - (1 - confLevel) / 2, n - cols);
  const seMean = Math.sqrt(mse * leverage0);
  const sePred = Math.sqrt(mse * (1 + leverage0));
  return {
    yhat,
    ciLo: yhat - tCrit * seMean, ciHi: yhat + tCrit * seMean,
    piLo: yhat - tCrit * sePred, piHi: yhat + tCrit * sePred,
  };
}
