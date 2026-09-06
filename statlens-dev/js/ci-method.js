// @ts-check
/**
 * Bootstrap confidence-interval METHOD: percentile vs normal approximation.
 *
 * A bootstrap CI can be read off the resamples two ways:
 *   percentile — cut the middle (1−α) of the bootstrap distribution
 *   ±z·SE      — centre on the estimate and step z standard errors out, where the
 *                SE is the spread of the bootstrap statistics ("±2 SE" at 95%)
 *
 * The choice drives the whole page — the interval drawn on the distribution, not
 * just the number in the results box — so this module owns the pieces both
 * bootstrap engines (sim-app.js and the standalone bootstrap-slope page) need:
 * the control, the colours, the z, and the marks on the chart.
 */

import * as d3Selection from 'd3-selection';
import { mean, sd, quantile } from './stats.js';
import { addProbPill } from './dist-markers.js';

/** Bound-line colours, one per method. Both draw dashed — the colour says which. */
export const PERCENTILE_CI_COLOR = '#B5747A';  // dusty red
export const NORMAL_CI_COLOR = '#114B5F';      // IMS dark teal

/**
 * Inverse standard-normal CDF (Acklam's rational approximation).
 * Dependency-free: jStat isn't loaded on the simulation pages.
 * @param {number} p
 * @returns {number}
 */
export function invNorm(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425, ph = 1 - pl;
  let q, r;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= ph) {
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

/**
 * Error function (Abramowitz & Stegun 7.1.26; |error| < 1.5e-7). Dependency-free.
 * @param {number} x
 * @returns {number}
 */
function erf(x) {
  const s = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}

/** Standard-normal CDF Φ. */
export function normCDF(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }

/**
 * Leave-one-out jackknife statistic values for a ONE-sample statistic.
 * @param {number[]} data
 * @param {(sample: number[]) => number} statFn
 * @returns {number[]}
 */
export function jackknife1(data, statFn) {
  const n = data.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const loo = new Array(n - 1);
    let k = 0;
    for (let j = 0; j < n; j++) if (j !== i) loo[k++] = data[j];
    out[i] = statFn(loo);
  }
  return out;
}

/**
 * BCa (bias-corrected and accelerated) bootstrap confidence interval.
 * Matches R's boot::boot.ci(type="bca") / scipy.stats.bootstrap(method="BCa"):
 *   z0 = Φ⁻¹( #{θ*_b < θ̂} / B )                (bias correction)
 *   a  = Σ(θ̄_(·) − θ̂_(i))³ / (6 [Σ(θ̄_(·) − θ̂_(i))²]^{3/2})   (acceleration, from jackknife)
 *   endpoints at adjusted percentiles Φ( z0 + (z0 ± z*)/(1 − a(z0 ± z*)) ).
 * Falls back to the plain percentile interval when z0/a are undefined
 * (e.g. all replicates on one side, or a degenerate jackknife).
 *
 * @param {number[]} stats - Bootstrap replicate statistics
 * @param {number} thetaHat - Observed statistic on the original sample
 * @param {number[]} jack - Jackknife leave-one-out statistic values
 * @param {number} ciLevel - Percent, e.g. 95
 * @returns {{ ci: [number, number], z0: number, a: number, fellBack: boolean }}
 */
export function bcaCI(stats, thetaHat, jack, ciLevel) {
  const B = stats.length;
  const alpha = (100 - ciLevel) / 100;
  const pct = () => /** @type {[number, number]} */ ([quantile(stats, alpha / 2), quantile(stats, 1 - alpha / 2)]);
  if (B < 2 || !jack || jack.length < 3) return { ci: pct(), z0: NaN, a: NaN, fellBack: true };

  // Bias correction (strict "<", matching scipy/R).
  let below = 0;
  for (const s of stats) if (s < thetaHat) below++;
  const z0 = invNorm(below / B);

  // Acceleration from the jackknife.
  const jbar = jack.reduce((s, v) => s + v, 0) / jack.length;
  let num = 0, den = 0;
  for (const ji of jack) { const d = jbar - ji; num += d * d * d; den += d * d; }
  const a = den === 0 ? 0 : num / (6 * Math.pow(den, 1.5));

  if (!isFinite(z0) || !isFinite(a)) return { ci: pct(), z0, a, fellBack: true };

  const zLo = invNorm(alpha / 2), zHi = invNorm(1 - alpha / 2);
  const adj = (/** @type {number} */ z) => { const t = z0 + z; return normCDF(z0 + t / (1 - a * t)); };
  let a1 = adj(zLo), a2 = adj(zHi);
  if (!isFinite(a1) || !isFinite(a2) || a1 >= a2) return { ci: pct(), z0, a, fellBack: true };
  a1 = Math.min(Math.max(a1, 1e-4), 1 - 1e-4);
  a2 = Math.min(Math.max(a2, 1e-4), 1 - 1e-4);
  return { ci: [quantile(stats, a1), quantile(stats, a2)], z0, a, fellBack: false };
}

/** z for a confidence level, with z = 2 exactly at 95% (the "±2 SE" rule of thumb). */
export function zFor(/** @type {number} */ ciLevel) {
  return ciLevel === 95 ? 2 : invNorm(1 - (100 - ciLevel) / 100 / 2);
}

/** "2" at 95%, else the z to 2 dp — for labelling the button and the formula. */
export function zLabelFor(/** @type {number} */ ciLevel) {
  return ciLevel === 95 ? '2' : zFor(ciLevel).toFixed(2);
}

/**
 * The ±z·SE interval: the bootstrap distribution's own centre, stepped out z of
 * its own standard errors.
 * @param {number[]} stats - Bootstrap statistics
 * @param {number} ciLevel - Percent, e.g. 95
 * @returns {[number, number]}
 */
export function normalApproxCI(stats, ciLevel) {
  const m = mean(stats);
  const s = sd(stats);
  const z = zFor(ciLevel);
  return [m - z * s, m + z * s];
}

/**
 * Build the Percentile / ±z·SE / Both control and insert it after the confidence
 * level. Returns a handle for keeping its label and pressed state in sync.
 *
 * @param {HTMLElement} ciPrimary - The .ci-primary block holding the confidence level.
 * @param {object} opts
 * @param {string} opts.method - Initial method: 'percentile' | 'se' | 'both'.
 * @param {(method: string) => void} opts.onChange
 * @returns {{ syncPressed: (method: string) => void, syncLabel: (ciLevel: number) => void, setNormalAvailable: (available: boolean) => void }}
 */
export function createCiMethodControl(ciPrimary, { method, onChange }) {
  const row = document.createElement('div');
  row.className = 'ci-method-row';
  row.innerHTML = `<span class="ci-method-label">Method:</span>
    <div class="seg-control ci-method-toggle" role="group" aria-label="Confidence interval method">
      <button type="button" data-cim="percentile">Percentile</button>
      <button type="button" data-cim="se">±2 SE</button>
      <button type="button" data-cim="both">Both</button>
      <button type="button" data-cim="bca" class="expert-only" title="Bias-corrected and accelerated — adjusts the percentile interval for skew and bias in the bootstrap distribution.">BCa</button>
    </div>`;
  ciPrimary.insertAdjacentElement('afterend', row);

  const toggle = /** @type {HTMLElement} */ (row.querySelector('.ci-method-toggle'));
  toggle.addEventListener('click', (e) => {
    const btn = /** @type {HTMLButtonElement} */ (
      /** @type {HTMLElement} */ (e.target).closest('button[data-cim]'));
    // A disabled button emits no native click, but the listener is delegated to
    // the group, so guard explicitly for keyboard/synthetic events.
    if (btn && !btn.disabled) onChange(btn.getAttribute('data-cim') || 'percentile');
  });

  const syncPressed = (/** @type {string} */ m) => {
    for (const b of toggle.querySelectorAll('button[data-cim]')) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-cim') === m));
    }
  };
  const syncLabel = (/** @type {number} */ ciLevel) => {
    const btn = toggle.querySelector('button[data-cim="se"]');
    if (btn) btn.textContent = `±${zLabelFor(ciLevel)} SE`;
  };
  // The ±z·SE and Both methods ARE the normal approximation, which only holds for
  // a statistic whose sampling distribution is ~normal (the mean, via CLT). The
  // caller disables them for a median / SD / quartile, where percentile is the
  // honest interval. Disabled buttons carry a tooltip so the "why" is discoverable.
  const setNormalAvailable = (/** @type {boolean} */ available) => {
    for (const cim of ['se', 'both']) {
      const b = /** @type {HTMLButtonElement|null} */ (
        toggle.querySelector(`button[data-cim="${cim}"]`));
      if (!b) continue;
      b.disabled = !available;
      b.setAttribute('aria-disabled', String(!available));
      if (available) b.removeAttribute('title');
      else b.title = 'The normal approximation (±z·SE) applies to the mean. For this statistic, use the percentile interval.';
    }
  };

  syncPressed(method);
  return { syncPressed, syncLabel, setNormalAvailable };
}

/**
 * Read the method from ?ci_method=, defaulting to percentile.
 * @returns {string}
 */
export function ciMethodFromUrl() {
  const m = (new URLSearchParams(location.search).get('ci_method') || '').toLowerCase();
  return (m === 'se' || m === 'both' || m === 'bca') ? m : 'percentile';
}

/**
 * Three symmetric probability pills on a bootstrap distribution: the middle (blue)
 * is the fraction of resamples INSIDE the interval, each tail (gray) the fraction
 * beyond a bound. These report what actually happened, not the nominal level — in
 * ±SE mode that's the point (the shortcut lands near 95%, not exactly on it).
 *
 * @param {import('./chart-utils.js').ChartFrame} frame
 * @param {any} xScale
 * @param {number[]} stats
 * @param {[number,number]} ci
 */
export function drawCiPills(frame, xScale, stats, ci) {
  const n = stats.length;
  if (n === 0) return;
  const leftProb = stats.filter(v => v <= ci[0]).length / n;
  const rightProb = stats.filter(v => v >= ci[1]).length / n;
  const midProb = Math.max(0, 1 - leftProb - rightProb);
  const [dMin, dMax] = xScale.domain();
  const grp = d3Selection.select(frame.inner).select('.annotations');
  addProbPill(grp, frame, xScale, dMin, ci[0], leftProb, { isComplement: true });
  addProbPill(grp, frame, xScale, ci[0], ci[1], midProb, { isComplement: false });
  addProbPill(grp, frame, xScale, ci[1], dMax, rightProb, { isComplement: true });
}

/**
 * Draw a second pair of bounds (Both mode) alongside the ones the chart already
 * shaded: dashed like them, dark teal to say "normal approximation", with the
 * values on a second row so they don't sit on top of the percentile ones.
 *
 * @param {import('./chart-utils.js').ChartFrame} frame
 * @param {any} xScale
 * @param {[number,number]} bounds
 * @param {number} precision
 */
export function drawCompareBounds(frame, xScale, bounds, precision) {
  const overlays = d3Selection.select(frame.inner).select('.overlays');
  const w = xScale.range()[1];
  for (const v of bounds) {
    const x = xScale(v);
    overlays.append('line')
      .attr('x1', x).attr('x2', x)
      .attr('y1', 26).attr('y2', frame.height)
      .attr('stroke', NORMAL_CI_COLOR)
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '6,3')
      .attr('aria-label', `Normal-approximation bound: ${v}`);
    overlays.append('text')
      .attr('class', 'overlay-value')
      .attr('x', Math.max(4, Math.min(w - 4, x)))
      .attr('y', 24)
      .attr('text-anchor', x < w * 0.15 ? 'start' : x > w * 0.85 ? 'end' : 'middle')
      .attr('fill', NORMAL_CI_COLOR)
      .text(v.toFixed(precision));
  }
}

/**
 * Legend for Both mode — the two dashed pairs differ only by colour, so say which.
 * @param {HTMLElement} container - The chart container to append to.
 * @param {number} ciLevel
 */
export function appendCiLegend(container, ciLevel) {
  const legend = document.createElement('p');
  legend.className = 'hint chart-legend';
  legend.innerHTML = `<span class="key key-pct">– –</span> percentile &nbsp;·&nbsp;
    <span class="key key-se">– –</span> ±${zLabelFor(ciLevel)}·SE (normal approximation)`;
  container.appendChild(legend);
}
