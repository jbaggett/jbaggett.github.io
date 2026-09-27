// @ts-check
/**
 * The grid a distribution is drawn on.
 *
 * Every chart in StatLens that stacks, bins or bars a set of values needs the
 * same two numbers: how wide a bin is, and where the bins sit. Four places used
 * to answer that question independently, and between 2026-09-25 and 2026-09-27
 * all four turned out to be wrong in the same way — the grid was tied to the
 * **container** (the panel's left edge, the pixel origin, the pilot domain)
 * while the data moved across it:
 *
 * - `js/sim-app.js` took its width from a *rounded* effective n and its phase
 *   from the domain's left edge, so columns drifted off the values a difference
 *   in proportions can actually take. One reachable outcome rendered as
 *   impossible, with the observed statistic stranded in the gap beside it.
 * - `snappedPropThresholds` took the same rounded n, so histogram edges walked
 *   off the same grid — and one caller computed the exact step and then handed
 *   over `round(1/step)`, putting the rounding back.
 * - `drawMiniHistogram` anchored edges to the panel's left edge, so sliding a
 *   sample onto μ₀ re-cut it and the shape changed.
 * - `drawMiniDotplot` did the same against the pixel origin.
 *
 * One rule, then: **a grid is a width and an origin, and the origin belongs to
 * the data.** Anchor it on something that travels with the values — the
 * observed statistic, the mean marker — and the picture translates when the
 * data moves instead of being re-cut. Anchor it on an achievable value of a
 * discrete statistic and every bin centre lands on an outcome, so a column is
 * one outcome and nothing sits between two of them.
 *
 * The three ways to pick an origin are the three constructors below. They are
 * not modes; they are one expression each.
 */

/**
 * @typedef {object} Grid
 * @property {number} width - distance between adjacent bin centres
 * @property {number} origin - a bin CENTRE, on the data's own grid
 * @property {boolean} discrete - true when `width` is the statistic's own step
 * @property {(v: number) => number} centerOf - snap a value to its bin centre
 * @property {(domain: [number, number]) => number[]} edgesWithin - interior bin edges
 * @property {(values: number[]) => number} columnSpan - bins the values span
 * @property {(m: number) => Grid} coarsen - m bins per bin, same phase
 */

/**
 * @param {number} width
 * @param {number} origin - a bin centre
 * @param {{ discrete?: boolean }} [opts]
 * @returns {Grid}
 */
export function createGrid(width, origin, opts = {}) {
  const discrete = !!opts.discrete;
  /** @type {Grid} */
  const grid = {
    width,
    origin,
    discrete,

    centerOf(v) {
      if (!(width > 0)) return v;
      return Math.round((v - origin) / width) * width + origin;
    },

    edgesWithin(domain) {
      /** @type {number[]} */
      const edges = [];
      if (!(width > 0) || !domain) return edges;
      const [lo, hi] = domain;
      // Edges sit half a width off the centres, so no achievable value ever
      // lands ON one — which is where floating point would get to decide the
      // side, and where a tie would be silently counted as not-a-tie.
      const firstEdge = origin - width / 2;
      let edge = firstEdge + Math.ceil((lo - firstEdge) / width) * width;
      // Guard against a domain edge landing exactly on a bin edge.
      if (edge <= lo) edge += width;
      let guard = 0;
      while (edge < hi && guard++ < 10000) {
        edges.push(edge);
        edge += width;
      }
      return edges;
    },

    columnSpan(values) {
      if (!(width > 0) || !values || values.length === 0) return 0;
      let lo = values[0], hi = values[0];
      for (const v of values) { if (v < lo) lo = v; if (v > hi) hi = v; }
      return Math.round((hi - lo) / width) + 1;
    },

    coarsen(m) {
      const k = Math.max(1, Math.round(m));
      // Same origin, so a coarsened grid still lands on the fine one: each bin
      // holds a whole number of outcomes rather than straddling them.
      return createGrid(width * k, origin, { discrete });
    },
  };
  return grid;
}

/**
 * A grid whose bin CENTRE sits on `anchor`.
 *
 * For a discrete statistic pass its own step as the width and an achievable
 * value as the anchor — in practice the observed statistic, which is achievable
 * by construction. Every centre then lands on an outcome.
 *
 * @param {number} width
 * @param {number} anchor
 * @param {{ discrete?: boolean }} [opts]
 * @returns {Grid}
 */
export function gridCentredOn(width, anchor, opts = {}) {
  return createGrid(width, anchor, opts);
}

/**
 * A grid whose bin EDGE sits on `anchor`.
 *
 * What a histogram wants when the anchor opens a tail: the anchor's bin starts
 * there, so every value in it is on the same side of the line as the anchor.
 *
 * @param {number} width
 * @param {number} anchor
 * @param {{ discrete?: boolean }} [opts]
 * @returns {Grid}
 */
export function gridEdgedOn(width, anchor, opts = {}) {
  return createGrid(width, anchor + width / 2, opts);
}

/**
 * The step between the values a proportion statistic can take.
 *
 * A single proportion moves by `1/n`. A difference of two moves by
 * `1/n₁ + 1/n₂`: under the null a shuffle takes one success out of one group
 * and puts it in the other, so both proportions move at once.
 *
 * Do not reach this through a rounded "effective sample size". The reciprocal
 * of the harmonic mean *is* `1/n₁ + 1/n₂` exactly, but rounding it first throws
 * the identity away — on 34 vs 16 that gives 0.0909 against a true 0.0919, and
 * ten bins later the grid has walked off the outcomes.
 *
 * @param {number} n1
 * @param {number} [n2] - the second group, for a difference of proportions
 * @returns {number|null} null when there is no grid to speak of
 */
export function proportionStep(n1, n2) {
  if (!(n1 > 0)) return null;
  return (n2 && n2 > 0) ? 1 / n1 + 1 / n2 : 1 / n1;
}
