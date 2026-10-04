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
  if (B < 2 || !jack || jack.length < 3) return { ci: pct(), z0: NaN, a: NaN, fellBack: true, levels: null };

  // Bias correction (strict "<", matching scipy/R).
  let below = 0;
  for (const s of stats) if (s < thetaHat) below++;
  const z0 = invNorm(below / B);

  // Acceleration from the jackknife.
  const jbar = jack.reduce((s, v) => s + v, 0) / jack.length;
  let num = 0, den = 0;
  for (const ji of jack) { const d = jbar - ji; num += d * d * d; den += d * d; }
  const a = den === 0 ? 0 : num / (6 * Math.pow(den, 1.5));

  if (!isFinite(z0) || !isFinite(a)) return { ci: pct(), z0, a, fellBack: true, levels: null };

  const zLo = invNorm(alpha / 2), zHi = invNorm(1 - alpha / 2);
  const adj = (/** @type {number} */ z) => { const t = z0 + z; return normCDF(z0 + t / (1 - a * t)); };
  let a1 = adj(zLo), a2 = adj(zHi);
  if (!isFinite(a1) || !isFinite(a2) || a1 >= a2) return { ci: pct(), z0, a, fellBack: true, levels: null };
  a1 = Math.min(Math.max(a1, 1e-4), 1 - 1e-4);
  a2 = Math.min(Math.max(a2, 1e-4), 1 - 1e-4);
  // The adjusted cutoffs go out with the interval: the Monte-Carlo margin is a
  // statement about the quantile INDEX, so it needs the level each end actually
  // came from, not the nominal one.
  return { ci: [quantile(stats, a1), quantile(stats, a2)], z0, a, fellBack: false, levels: [a1, a2] };
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
export function createCiMethodControl(ciPrimary, { method, onChange, pillMode, onPillMode }) {
  const row = document.createElement('div');
  row.className = 'ci-method-row';
  row.innerHTML = `<span class="ci-method-label">Method:</span>
    <div class="seg-control ci-method-toggle" role="group" aria-label="Confidence interval method">
      <button type="button" data-cim="percentile">Percentile</button>
      <button type="button" data-cim="se">±2 SE</button>
      <button type="button" data-cim="both">Both</button>
      <button type="button" data-cim="bca" class="expert-only" title="Bias-corrected and accelerated — adjusts the percentile interval for skew and bias in the bootstrap distribution.">BCa</button>
    </div>
    <span class="ci-method-label expert-only">Plot labels:</span>
    <div class="seg-control ci-pills-toggle expert-only" role="group" aria-label="What the plot's probability labels show">
      <button type="button" data-pills="target" title="The level the interval asks for: 2.5% in each tail, 95% between.">Target</button>
      <button type="button" data-pills="actual" title="The share of resamples actually in each region — not the same thing when the statistic is lumpy.">Actual</button>
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

  // What the plot's three probability labels show. Behind Detailed, because the
  // default is the one a student should meet and an instructor is the only
  // person who wants the other — and because the interface is already carrying
  // as many controls as it can. (Jeff, 2026-10-04: "most of my instructors
  // aren't going to be using the URL parameters … I'm a little concerned about
  // overly complicating the interface. We could leave the toggle hidden unless
  // 'detailed' view is selected.")
  const pills = /** @type {HTMLElement} */ (row.querySelector('.ci-pills-toggle'));
  pills.addEventListener('click', (e) => {
    const btn = /** @type {HTMLButtonElement} */ (
      /** @type {HTMLElement} */ (e.target).closest('button[data-pills]'));
    if (btn && !btn.disabled) onPillMode?.(btn.getAttribute('data-pills') || 'target');
  });
  const syncPills = (/** @type {string} */ mode, /** @type {string} */ m) => {
    for (const b of pills.querySelectorAll('button[data-pills]')) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-pills') === mode));
      // ±SE is an approximation whose point is that it does NOT land on the
      // level, so its labels always report what the interval holds; the choice
      // has nothing to decide there.
      const off = m === 'se';
      /** @type {HTMLButtonElement} */ (b).disabled = off;
      b.setAttribute('aria-disabled', String(off));
      if (off) b.title = '±SE is an approximation — its labels always show what the interval actually holds.';
      else b.removeAttribute('title');
    }
  };

  syncPressed(method);
  syncPills(pillMode || 'target', method);
  return { syncPressed, syncLabel, setNormalAvailable, syncPills };
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
 * How far each end of the interval would move if you ran the whole simulation
 * again — the Monte-Carlo margin, in the data's own units.
 *
 * The randomization pages have said this about the p-value since REQ-031
 * (`p ± 1.96·sqrt(p(1−p)/N)`) and the bootstrap pages said nothing, so the same
 * idea was taught on eight pages and silently dropped on five. It is one idea
 * either way: **a count out of B resamples is binomial.** For a p-value it is
 * the count of extreme resamples. For a CI bound it is the INDEX of the
 * quantile — the 2.5th percentile is the 25th of 1000, and resampling noise
 * puts that index at 25 ± 10, so the bound could have been anywhere from the
 * 15th to the 35th smallest resample. Read those two off the sorted array and
 * the margin is already in the right units. (Jeff, 2026-10-02.)
 *
 * It works from the LEVEL each end came from, not from where the bound value
 * happens to sit. Looking the value up instead was the first version and it is
 * wrong in exactly the case worth being right about: on a discrete statistic a
 * bound often lands on an atom, and the lookup returns the atom's top edge
 * rather than the quantile's own index. On 3 of 62 at B = 10,000 that reported
 * ±0.008 where the truth is 0 — the bound is pinned and no number of resamples
 * will move it. BCa passes its own adjusted cutoffs, so its shifted ends need
 * no special case.
 *
 * ±z·SE is not a quantile at all. Its ends are `mean(stats) ± z·sd(stats)`, and
 * BOTH of those move: Var ≈ σ²/B + z²σ²/(2B). Using only the SE term — the
 * second version — came out a consistent 0.82× of the truth, which is exactly
 * sqrt(1/2)/sqrt(1/2 + 1/z²·…) says it should be.
 *
 * Every branch is checked against brute force: the spread of the bound over 400
 * independent bootstrap runs. See tests/unit/ci-mc-margin.test.js.
 *
 * Returns null below 100 resamples, where the order statistics clamp to the
 * ends of the array and the number would be noise reported as precision.
 *
 * @param {number[]} stats bootstrap statistics
 * @param {number} ciLevel e.g. 95
 * @param {{method?: string, levels?: [number,number]|null}} [opts]
 * @returns {{lo: number, hi: number}|null} 95% margin on each end
 */
export function ciMonteCarloMargin(stats, ciLevel, opts = {}) {
  const B = stats?.length ?? 0;
  if (B < 100) return null;

  if (opts.method === 'se') {
    const z = zFor(ciLevel);
    const m = 1.96 * sd(stats) * Math.sqrt((1 + (z * z) / 2) / B);
    return { lo: m, hi: m };
  }

  const alpha = (100 - ciLevel) / 100;
  const levels = opts.levels ?? [alpha / 2, 1 - alpha / 2];
  const sorted = [...stats].sort((a, b) => a - b);
  return { lo: quantileMargin(sorted, levels[0]), hi: quantileMargin(sorted, levels[1]) };
}

/**
 * The margin for one bound: half the spread between the order statistics 1.96
 * binomial SDs either side of the quantile's index.
 *
 * When one repeated value covers that whole span the spread is zero — the right
 * answer, and a useful one: more resamples will not move this bound. That is
 * the ordinary case on a discrete statistic.
 *
 * @param {number[]} sorted
 * @param {number} q
 * @returns {number}
 */
function quantileMargin(sorted, q) {
  const B = sorted.length;
  const k = B * q;
  const spread = 1.96 * Math.sqrt(B * q * (1 - q));
  const at = (/** @type {number} */ x) =>
    sorted[Math.max(0, Math.min(B - 1, Math.round(x) - 1))];
  return Math.max(0, (at(k + spread) - at(k - spread)) / 2);
}

/**
 * Split resamples into below / inside / above the interval — the same cut the
 * chart uses to colour its dots, so what a pill claims is what a reader can
 * count. Exported for tests.
 *
 * @param {number[]} stats
 * @param {[number,number]} ci
 * @returns {{leftProb: number, midProb: number, rightProb: number}}
 */
export function ciRegionMass(stats, ci) {
  const n = stats.length;
  if (n === 0) return { leftProb: 0, midProb: 0, rightProb: 0 };
  const [lo, hi] = ci;
  let left = 0, mid = 0, right = 0;
  for (const v of stats) {
    if (v < lo) left++;
    else if (v > hi) right++;
    else mid++;
  }
  return { leftProb: left / n, midProb: mid / n, rightProb: right / n };
}

/**
 * Three symmetric probability pills on a bootstrap distribution: the middle
 * (blue) is the share of the distribution inside the interval, each tail (gray)
 * the share beyond a bound.
 *
 * `target` picks WHICH share. The percentile method asks for 2.5% / 95% / 2.5%
 * and the pills say so, because that is what the student is being asked to find
 * and what the headline "95% CI" means. The ±SE method gets the counted shares
 * instead: there the gap IS the lesson — the shortcut lands near 95%, not on
 * it — so printing its target would hide the only thing that view is for.
 * (Jeff, 2026-10-04: "yes to target as default, and use the bare number.")
 *
 * What is given up is that on a lumpy statistic the middle pill no longer
 * equals a count of the bars under it: at n = 62 a nominal 95% interval holds
 * 97.8% of the resamples. That number is not hidden — `ciRegionMass` still
 * computes it and the results panel prints it with the reason — but it is no
 * longer the thing a reader meets first, because "the middle 95%" is the idea
 * and 0.978 is a consequence of arithmetic they have not been taught yet.
 *
 * The three regions are a PARTITION, cut the same way the chart colours its
 * dots: the interval is closed, so a resample sitting exactly on a bound is
 * inside it and blue. The tails used to be counted inclusively (`<=`, `>=`)
 * while the shading was inclusive of the middle, with the middle taken as the
 * leftover — so a spike landing exactly on a bound was counted in the tail and
 * drawn blue at the same time. On a discrete statistic that is not an edge
 * case but the normal case: at n = 62 with p-hat = 3/62 the lower bound comes
 * out at exactly 0, and the 4.7% of resamples with no successes were being
 * reported as a left tail with no grey dots anywhere to point at.
 * (Jeff, 2026-10-01: "at the low end we have .0469, but there are no gray dots
 * to point to".)
 *
 * The three now sum to 1 by construction, and every dot a pill counts is a dot
 * the reader can find. The consequence is worth seeing rather than hiding: on a
 * lumpy statistic a nominal 95% percentile interval really does hold ~99% of
 * the resamples, because a whole atom sits inside the bound.
 *
 * @param {import('./chart-utils.js').ChartFrame} frame
 * @param {any} xScale
 * @param {number[]} stats
 * @param {[number,number]} ci
 * @param {number|null} [target] the nominal level (e.g. 0.95) to print instead
 *   of the counted shares; null keeps the counts.
 */
export function drawCiPills(frame, xScale, stats, ci, target = null) {
  const n = stats.length;
  if (n === 0) return;
  const counted = ciRegionMass(stats, ci);
  const { leftProb, midProb, rightProb } = target == null ? counted : (() => {
    const mid = Math.max(0, Math.min(1, target));
    const tail = (1 - mid) / 2;
    return { leftProb: tail, midProb: mid, rightProb: tail };
  })();
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
