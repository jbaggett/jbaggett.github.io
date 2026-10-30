// @ts-check
/**
 * The teaching populations — one definition, shared.
 *
 * `conceptual/sampling-lab/` grew these shapes first. When a second page needed
 * the same five ("select the population (like sampling lab distribution)" —
 * Jeff, 2026-10-07) the choice was to copy them or to lift them out, and a copy
 * would drift: the shapes are the thing both pages are *about*, so two
 * populations called "right-skewed" that differ in their tail would quietly
 * make the two pages disagree about the same demonstration.
 *
 * The draw sequence is preserved exactly as the Lab had it — same generator
 * calls in the same order — because `?seed=` is a reproducibility promise on a
 * page used in lectures and graded work. Moving code must not move numbers.
 */

import { randNormal } from './prng.js';

/** How many individuals a teaching population holds. */
export const POP_SIZE = 1000;

/**
 * The shapes, in the order they should appear in a picker.
 * @type {Array<{id: string, label: string, blurb: string}>}
 */
export const POPULATION_SHAPES = [
  { id: 'normal', label: 'Normal', blurb: 'symmetric, single peak' },
  { id: 'right-skewed', label: 'Right-skewed', blurb: 'a long tail of large values' },
  { id: 'left-skewed', label: 'Left-skewed', blurb: 'a long tail of small values' },
  { id: 'uniform', label: 'Uniform', blurb: 'every value equally likely' },
  { id: 'bimodal', label: 'Bimodal', blurb: 'two separated peaks' },
];

/**
 * Draw from `make` until the value lands in [lo, hi].
 *
 * The skewed shapes are unbounded exponentials, so a rare draw can land far
 * past the plotted domain and overflow the page. Redrawing rather than clamping
 * keeps the distribution's natural shape — it tapers to a clean edge with no
 * pile-up spike at the boundary. μ and σ are then computed from this bounded
 * population, so a sampling distribution still centres honestly on the μ line.
 *
 * @param {() => number} make @param {number} lo @param {number} hi
 */
function bounded(make, lo, hi) {
  let x;
  do { x = make(); } while (x < lo || x > hi);
  return x;
}

/**
 * A quantitative teaching population of `size` values.
 *
 * @param {string} shape - one of POPULATION_SHAPES' ids; anything else is normal
 * @param {() => number} rng
 * @param {number} [size]
 * @returns {number[]}
 */
export function generateQuantPopulation(shape, rng, size = POP_SIZE) {
  /** @type {number[]} */
  const vals = [];
  switch (shape) {
    case 'right-skewed':
      for (let i = 0; i < size; i++) vals.push(bounded(() => -Math.log(1 - rng()) / 0.1, 0, 50));
      break;
    case 'left-skewed':
      for (let i = 0; i < size; i++) vals.push(bounded(() => 50 - (-Math.log(1 - rng()) / 0.1), 0, 50));
      break;
    case 'uniform':
      for (let i = 0; i < size; i++) vals.push(rng() * 100);
      break;
    case 'bimodal':
      for (let i = 0; i < size; i++) {
        vals.push(bounded(() => (rng() < 0.5 ? randNormal(30, 5, rng) : randNormal(70, 5, rng)), 10, 90));
      }
      break;
    case 'normal':
    default:
      for (let i = 0; i < size; i++) vals.push(bounded(() => randNormal(50, 10, rng), 15, 85));
  }
  return vals;
}
