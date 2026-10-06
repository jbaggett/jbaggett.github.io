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
 *   a mean         the INDICES drawn, which the draw already returns for the
 *                  animation (it has to know which observation was taken twice
 *                  and which never). Values are recovered by lookup.
 *
 * Indices cost n numbers per dot, so they are kept under a budget rather than
 * without limit: 100,000 stored values is a few hundred KB and covers 1,000
 * resamples of n = 100 completely. Past it the OLDEST are dropped, because the
 * dot a reader hovers is overwhelmingly one they just watched land.
 */

const BUDGET = 100000;

export function createResampleStore() {
  /** @type {Map<number, {k?: number, n?: number, idx?: ArrayLike<number>}>} */
  const byIndex = new Map();
  /** @type {number[]} */
  const order = [];
  let stored = 0;

  /** Drop the oldest until the budget is met. */
  function trim() {
    while (stored > BUDGET && order.length) {
      const old = /** @type {number} */ (order.shift());
      const rec = byIndex.get(old);
      stored -= rec?.idx ? rec.idx.length : 1;
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
