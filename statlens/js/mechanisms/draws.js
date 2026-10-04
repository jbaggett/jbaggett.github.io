// @ts-check
/**
 * The nine draws.
 *
 * Every simulation tool in StatLens is a source, one draw from it, a statistic,
 * and an accumulated distribution. This module owns the *draw* — the only part
 * that touches the PRNG, and therefore the only part a seeded link depends on.
 *
 * Two rules govern everything here.
 *
 * **1. PRNG consumption is the contract.** A seeded URL is used in graded
 * Canvas quizzes and MyOpenMath homework: the same seed has to keep producing
 * the same numbers. Every function below consumes `rng()` in exactly the order
 * the shipping code did before it moved here, and
 * `tests/fixtures/draw-golden-master.json` pins the output of all nine at a
 * fixed seed. If a change makes that file need editing, the change is wrong.
 *
 * **2. A draw returns provenance, not just values.** Which observations were
 * taken is a fact the display needs and cannot recover afterwards: when several
 * observations share a value, a value-level resample leaves no way to know
 * which of them was drawn, and a panel forced to guess guesses in one direction.
 * On 200 paired differences sharing 38 distinct values that showed ~31
 * observations untouched where the truth is ~73 — a panel whose whole job is
 * "resampling takes some twice and misses others", hiding 58% of the effect.
 * (Todd Will, 2026-09-27.) So `indices` comes back wherever it is a fact.
 *
 * @typedef {object} Draw
 * @property {number[]} values - the drawn data
 * @property {number[]} [indices] - which observations were taken, when that is knowable
 */

import { sampleIndicesWithReplacement, sampleMultinomial, shuffle } from '../prng.js';

// ─── Bootstrap: resampling with replacement ─────────────────────────────

/**
 * Which of n observations a resample takes — the draw itself, before any
 * values are attached. Used directly where the unit is a *row* rather than a
 * number, as when a regression resamples (x, y) pairs.
 *
 * @param {number} n
 * @param {() => number} rng
 * @returns {number[]}
 */
export function resampleIndices(n, rng) {
  return sampleIndicesWithReplacement(n, n, rng);
}

/**
 * Resample one sample with replacement, n from n.
 *
 * @param {number[]} values
 * @param {() => number} rng
 * @returns {Draw}
 */
export function resampleOne(values, rng) {
  const indices = resampleIndices(values.length, rng);
  return { values: indices.map(i => values[i]), indices };
}

/**
 * Resample paired differences with replacement. The pair is the unit — a
 * bootstrap of paired data resamples *pairs*, which is the same thing as
 * resampling their differences.
 *
 * @param {number[]} first
 * @param {number[]} second
 * @param {() => number} rng
 * @returns {Draw}
 */
export function resamplePairedDiffs(first, second, rng) {
  const diffs = second.map((v, i) => v - first[i]);
  return resampleOne(diffs, rng);
}

/**
 * Resample two groups independently, group 1 first.
 *
 * The order matters and is part of the contract: both groups draw from one
 * stream, so swapping them would change every seeded result.
 *
 * @param {number[]} g1
 * @param {number[]} g2
 * @param {() => number} rng
 * @returns {{ first: Draw, second: Draw }}
 */
export function resampleGroups(g1, g2, rng) {
  const first = resampleOne(g1, rng);
  const second = resampleOne(g2, rng);
  return { first, second };
}

// ─── Randomization: re-allocating what was observed ─────────────────────

/**
 * Re-allocate the observed values between two groups of the same sizes — the
 * null hypothesis that the group labels carry no information.
 *
 * @param {number[]} g1
 * @param {number[]} g2
 * @param {() => number} rng
 * @returns {{ first: Draw, second: Draw }}
 */
export function shuffleLabels(g1, g2, rng) {
  const combined = g1.concat(g2);
  // Shuffle the POSITIONS, then read the values through them. Shuffling the
  // values directly throws away which observation each one was — and a draw
  // that cannot say where a value came from cannot be animated honestly, which
  // is the same gap `indices` closed for resampling. The order the PRNG is
  // consumed in is unchanged, so seeded links reproduce exactly as before.
  // (2026-10-02.)
  const order = combined.map((_, i) => i);
  shuffle(order, rng);
  const take = (/** @type {number[]} */ idx) => ({
    values: idx.map(i => combined[i]),
    indices: idx,
  });
  return {
    first: take(order.slice(0, g1.length)),
    second: take(order.slice(g1.length)),
  };
}

/**
 * Flip the sign of each difference independently — the null hypothesis that
 * within a pair, which member got the larger value was a coin toss.
 *
 * @param {number[]} diffs
 * @param {() => number} rng
 * @returns {Draw}
 */
export function signFlip(diffs, rng) {
  return { values: diffs.map(d => (rng() < 0.5 ? d : -d)) };
}

/**
 * Break an association by permuting one side of it, leaving the other fixed.
 *
 * One draw, three readings, because they are the same act:
 *   - correlation: shuffle y against x — "x and y are unrelated"
 *   - chi-square:  shuffle the group assignment against the outcomes
 *   - ANOVA:       shuffle the group labels across the values
 * In each case the null says one side carries no information about the other,
 * and the draw says: then it should not matter which way round they are.
 *
 * Takes anything indexable, because a label is as permutable as a number.
 *
 * @template T
 * @param {T[]} side - the side to permute; the caller's array is not modified
 * @param {() => number} rng
 * @returns {{ values: T[] }}
 */
export function shufflePairing(side, rng) {
  const shuffled = [...side];
  shuffle(shuffled, rng);
  return { values: shuffled };
}

// ─── Drawing from a stated null world ───────────────────────────────────

/**
 * Count successes in n independent Bernoulli(p₀) trials.
 *
 * Returns the count rather than the trials: the trials are not shown, and
 * materialising n of them would consume no extra randomness but a lot of
 * memory on a large sample.
 *
 * @param {number} n
 * @param {number} p0
 * @param {() => number} rng
 * @returns {number} successes
 */
export function drawBernoulliCount(n, p0, rng) {
  let successes = 0;
  for (let i = 0; i < n; i++) if (rng() < p0) successes++;
  return successes;
}

/**
 * Resample a sample that has been shifted to sit on the null value — the
 * bootstrap-under-the-null used by the one-mean randomization test.
 *
 * The shift is the caller's, because what "centred on the null" means belongs
 * to the tool, not the draw.
 *
 * @param {number[]} shiftedValues - already centred on the null
 * @param {() => number} rng
 * @returns {Draw}
 */
export function drawFromShiftedNull(shiftedValues, rng) {
  return resampleOne(shiftedValues, rng);
}

/**
 * Draw category counts from a stated null vector of probabilities.
 *
 * @param {number} n
 * @param {number[]} probs
 * @param {() => number} rng
 * @returns {number[]} counts per category, summing to n
 */
export function drawMultinomial(n, probs, rng) {
  return sampleMultinomial(n, probs, rng);
}

// ─── Sampling: drawing from a population that really exists ─────────────

/**
 * Draw a sample of size n from a population, WITHOUT replacement.
 *
 * The one draw here that is sampling rather than resampling, and the
 * distinction is the whole subject of the Sampling Distribution Lab: the
 * population is real and known, and an observation cannot be taken twice.
 *
 * @param {number[]} population
 * @param {number} n
 * @param {() => number} rng
 * @returns {Draw}
 */
export function sampleFromPopulation(population, n, rng) {
  const indices = population.map((_, i) => i);
  shuffle(indices, rng);
  const taken = indices.slice(0, Math.min(n, population.length));
  return { values: taken.map(i => population[i]), indices: taken };
}
