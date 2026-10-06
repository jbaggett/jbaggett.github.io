// @ts-check
/**
 * What one dot came from.
 *
 * The single hardest confusion in simulation-based inference is "what is one
 * dot?" — students read a dot as an observation rather than as a whole
 * resample's statistic. StatKey answers it by letting you hover a dot and see
 * the sample behind it. We already answer it for ONE dot: the mechanism strip
 * shows the resample that produced the newest statistic. What was missing is
 * being able to ask about dot 47. (Jeff, 2026-10-05.)
 *
 * So this is retrieval, not a new idea — and it is deliberately cheap. A
 * resample is stored as the least that reconstructs it:
 *
 *   a proportion   the success COUNT. k of n is the whole resample; there is
 *                  nothing else to know, so this costs one number per dot and
 *                  every dot can be kept however many are drawn.
 *   a mean         the PRNG STATE the draw started from — four integers. The
 *                  draw is replayed from it on demand (js/prng.js
 *                  `rngFromState`), which costs n random numbers once, when a
 *                  reader actually asks about that dot.
 *
 * The state replaced storing the n indices drawn, which cost n numbers PER dot
 * and so had to run under a budget: at Ames' n = 2,930 a 100,000-value budget
 * held 34 of 1,000 resamples, and hovering any of the other 966 did nothing at
 * all — silently, because a missing record is indistinguishable from a dot with
 * nothing to say. Four numbers per dot is 4,000 for a full run, so the budget
 * no longer binds on the paths that use it. (Jeff, 2026-10-06: "when I hover
 * over dots in the resampling distribution the histogram for the resample
 * should update but it doesn't.")
 *
 * The budget remains for `rememberValues`, which stores a sample the generator
 * cannot replay because the thing drawn from is itself regenerated.
 */

const BUDGET = 100000;

export function createResampleStore() {
  /** @type {Map<number, {k?: number, n?: number, st?: number[], idx?: ArrayLike<number>, idx2?: ArrayLike<number>, vals?: ArrayLike<number>}>} */
  const byIndex = new Map();
  /** @type {number[]} */
  const order = [];
  let stored = 0;

  /** Drop the oldest until the budget is met. */
  function trim() {
    while (stored > BUDGET && order.length) {
      const old = /** @type {number} */ (order.shift());
      const rec = byIndex.get(old);
      stored -= rec?.idx ? rec.idx.length + (rec.idx2?.length ?? 0)
        : rec?.vals ? rec.vals.length
        : rec?.st ? 4 : 1;
      byIndex.delete(old);
    }
  }

  return {
    /**
     * A resample of a categorical outcome: k successes of n.
     * @param {number} index @param {number} k @param {number} n
     */
    rememberCount(index, k, n) {
      if (byIndex.has(index)) return;
      byIndex.set(index, { k, n });
      order.push(index);
      stored += 1;
      trim();
    },
    /**
     * The generator state a draw started from — replay it to get the draw back.
     * Four numbers, whatever n is.
     * @param {number} index @param {ReadonlyArray<number>|null|undefined} state
     */
    rememberState(index, state) {
      if (!state || byIndex.has(index)) return;
      byIndex.set(index, { st: [state[0], state[1], state[2], state[3]] });
      order.push(index);
      stored += 4;
      trim();
    },
    /**
     * A resample of a numeric variable, as the indices drawn.
     * @param {number} index @param {ArrayLike<number>|null|undefined} idx
     */
    rememberIndices(index, idx) {
      if (!idx || byIndex.has(index)) return;
      byIndex.set(index, { idx: Int32Array.from(idx) });
      order.push(index);
      stored += idx.length;
      trim();
    },
    /**
     * A two-group draw: each group is resampled separately, so the record is a
     * PAIR. Storing only the first group made the readout say "treatment only",
     * which is accurate but half a picture.
     * @param {number} index
     * @param {ArrayLike<number>|null|undefined} a
     * @param {ArrayLike<number>|null|undefined} bIdx
     */
    rememberIndexPair(index, a, bIdx) {
      if (!a || !bIdx || byIndex.has(index)) return;
      byIndex.set(index, { idx: Int32Array.from(a), idx2: Int32Array.from(bIdx) });
      order.push(index);
      stored += a.length + bIdx.length;
      trim();
    },
    /**
     * A sample stored by VALUE. Needed where the thing drawn from is itself
     * regenerated — the sampling lab rebuilds its population whenever the shape
     * or size changes, so an index into it would not survive.
     * @param {number} index @param {ArrayLike<number>|null|undefined} values
     */
    rememberValues(index, values) {
      if (!values || byIndex.has(index)) return;
      byIndex.set(index, { vals: Float64Array.from(values) });
      order.push(index);
      stored += values.length;
      trim();
    },
    /** @param {number} index */
    get(index) { return byIndex.get(index) ?? null; },
    /** Whether anything is retained for this dot. */
    has(/** @type {number} */ index) { return byIndex.has(index); },
    clear() { byIndex.clear(); order.length = 0; stored = 0; },
    get size() { return byIndex.size; },
  };
}

/**
 * One line describing a stored resample, in the words of the page it came from.
 *
 * @param {{k?: number, n?: number, idx?: ArrayLike<number>}} rec
 * @param {number} statIndex - which repetition this was
 * @param {number} statValue - the statistic it produced
 * @param {object} opts
 * @param {boolean} opts.proportion
 * @param {number[]} [opts.source] - the original values, for a numeric resample
 * @param {string} [opts.successLabel]
 * @param {(v: number) => string} [opts.fmt]
 * @returns {{ title: string, detail: string }}
 */
export function describeResample(rec, statIndex, statValue, opts) {
  const fmt = opts.fmt ?? ((/** @type {number} */ v) => String(Math.round(v * 1000) / 1000));
  const title = `Repetition ${statIndex + 1}`;
  if (opts.proportion && rec.k != null && rec.n != null) {
    const label = opts.successLabel;
    return {
      title,
      // The outcome's own word is a category value ("complication", "survived",
      // "yes") and will not take a plural or an article reliably, so it is
      // quoted rather than conjugated.
      detail: label
        ? `${rec.k} of ${rec.n} were “${label}” → ${fmt(statValue)}`
        : `${rec.k} successes out of ${rec.n} → ${fmt(statValue)}`,
    };
  }
  if (rec.idx && opts.source) {
    const vals = Array.from(rec.idx, (i) => opts.source?.[i]).filter((v) => v != null);
    // Count the repeats, because "drawn twice, never drawn" is the part of
    // resampling with replacement that a list of numbers hides.
    const seen = new Set(rec.idx);
    // Two different counts, and I had them as one expression: a draw that
    // repeats is `idx.length - distinct`; an observation never drawn is
    // `source.length - distinct`. They coincide only when the resample is the
    // same size as the sample — usual, but not the thing being said.
    const duplicated = rec.idx.length - seen.size;
    const unused = opts.source.length - seen.size;
    const shown = vals.slice(0, 12).map((v) => fmt(/** @type {number} */ (v))).join(', ');
    return {
      title,
      detail: `${shown}${vals.length > 12 ? ', …' : ''} → ${fmt(statValue)}`
        + (duplicated > 0 ? ` \u00b7 ${duplicated} drawn more than once, ${unused} never drawn` : ''),
    };
  }
  return { title, detail: `→ ${fmt(statValue)}` };
}
