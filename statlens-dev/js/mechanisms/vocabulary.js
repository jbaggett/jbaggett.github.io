// @ts-check
/**
 * What the three entities are called.
 *
 * Every simulation tool has the same three: a **source** the draw comes from,
 * **one draw** from it, and the **distribution** those draws accumulate into.
 * Stage 2 of the mechanism plan set out to put those names in one place. What
 * it mostly found is that nobody had ever looked at them together.
 *
 * ## The inventory, read off the 15 shipping pages
 *
 * The **source** is named eight ways:
 *
 * | Name | Pages |
 * |---|---|
 * | Original Sample | bootstrap-mean, bootstrap-prop |
 * | Original Groups | bootstrap-two-means, bootstrap-two-props, randomization-diff-means, randomization-diff-props |
 * | Original Data | bootstrap-slope, randomization-correlation |
 * | Differences | bootstrap-paired, randomization-paired |
 * | Observed Data | randomization-one-mean, randomization-one-prop |
 * | Observed Groups | randomization-anova |
 * | Observed Table | randomization-chisq |
 * | Observed Counts | goodness-of-fit |
 *
 * Much of that is *right*. "Observed Table" tells a chi-square student more
 * than "Observed Data" would, and "Differences" is the correct noun for paired
 * data. The noun should follow the data.
 *
 * The **qualifier** in front of it should not, and does. Eight pages say
 * *Original*, five say *Observed*, and no rule separates them: two
 * randomization pages say Original while three say Observed, for the same role.
 * That is drift, not design, and it is the kind that only shows up when the
 * strings are listed side by side.
 *
 * ## Two things worse than drift
 *
 * ⚠ **A collision.** On a randomization page against a stated null, the source
 * panel and the chart beneath it are *both* titled "Null Distribution" — two
 * different entities, on screen together, sharing one name. They are the two
 * things a student is most likely to confuse, and the interface does not
 * distinguish them. `hasNameCollision('nullWorld')` reports it.
 *
 * ⚠ **A split name.** The same act — shuffle to break an association, then
 * accumulate — is called "Randomization Distribution" on sim-app's two-group
 * pages and "Null Distribution" on correlation, chi-square, ANOVA and goodness
 * of fit. One entity, two names, no signal to the student that they match.
 *
 * Neither is fixed here. Both change what students read, which is a teaching
 * decision rather than a refactor's, and `tests/unit/vocabulary.test.js` pins
 * every string so that whoever makes it has to make it on purpose.
 *
 * @typedef {object} MechanismVocabulary
 * @property {string} distribution - what the draws accumulate into
 * @property {string} verb - what one draw does, lowercase, for captions
 * @property {string} [source] - the source, where the mechanism names it rather than the page
 * @property {string} [beforeShift] - what the source is called BEFORE it is moved
 *   onto the null. Only a mechanism that shifts its source has two names for it,
 *   and the moment it changes is worth watching: the panel stops being what you
 *   measured and becomes what you are drawing from.
 * @property {string} [draw] - one draw, where the mechanism names it rather than the page
 * @property {string} [drawLatest] - the same, when several have just been made
 */

/** @type {Record<string, MechanismVocabulary>} */
export const VOCABULARY = {
  /** Bootstrap: the sample stands in for the population and is drawn from. */
  bootstrap: {
    distribution: 'Bootstrap Distribution',
    verb: 'resample',
  },

  /** Randomization by re-allocating observed values between groups (sim-app). */
  shuffle: {
    distribution: 'Randomization Distribution',
    verb: 'shuffle',
  },

  /**
   * Randomization by permuting one side of an association — correlation,
   * chi-square, ANOVA, goodness of fit. The same act as `shuffle`, under a
   * different name for the result. See the split-name note above.
   */
  permuteAssociation: {
    distribution: 'Null Distribution',
    verb: 'shuffle',
  },

  /**
   * Randomization against a null that NAMES A POPULATION — the one-proportion
   * test, where H₀ says p₀ and you draw n independent trials from it.
   *
   * Split off from `nullWorld` on 2026-10-03. The two had been sharing a
   * vocabulary, and sharing it was the bug: `nullWorld` is defined below as
   * "the data moved onto the null", which is a true description of the
   * one-MEAN test and a false one here. Your sample contributes nothing to
   * building this population; H₀ states it outright, and the sample enters once,
   * at the end, as the thing you compare against. Calling the panel "Observed
   * Data" and morphing it into the null animated a transformation that does not
   * happen. (Jeff: "that doesn't really fit here like it does for the one
   * sample mean randomization test.")
   *
   * Naming the source "Population under H₀" also resolves the collision flagged
   * below for this page: the panel and the chart no longer share a name.
   */
  statedPopulation: {
    source: 'Population under H₀',
    draw: 'This Simulation',
    drawLatest: 'Last Simulation',
    distribution: 'Null Distribution',
    verb: 'simulate',
  },

  /**
   * Randomization against a stated null value, where the source is not the data
   * as observed but the data moved onto the null. Holds the collision.
   *
   * One-MEAN only, since 2026-10-03: there the shift is real — every value moves
   * by the same constant and the resample is drawn from the shifted sample — so
   * Observed → Null is an honest animation of the mechanism.
   */
  nullWorld: {
    source: 'Null Distribution',   // ⚠ the same words as `distribution` below
    beforeShift: 'Observed Data',
    draw: 'This Simulation',
    drawLatest: 'Last Simulation',
    distribution: 'Null Distribution',
    verb: 'simulate',
  },

  /** Sampling from a population that really exists and is known. */
  sampling: {
    source: 'Population',
    draw: 'One Sample',
    drawLatest: 'Latest Sample',
    distribution: 'Sampling Distribution',
    verb: 'sample',
  },
};

/**
 * What each page calls its source and its one draw, as shipped.
 *
 * An inventory, not yet an authority: these strings still live in the pages'
 * own HTML. Recorded here so the drift above is checkable from one file, and so
 * Stage 3 has something to render from when the entities come apart.
 *
 * Specifically the names a page **ships in its markup** — what a student sees
 * before touching anything. Several pages rewrite the draw title once a draw has
 * happened (goodness-of-fit's "One Sample under H₀" becomes "This Sample under
 * H₀"), which is a third place names are decided and a reason this table is not
 * yet the authority. `tests/unit/vocabulary.test.js` reads the markup and
 * asserts this matches it, so the table cannot drift from the pages.
 *
 * @type {Record<string, { source: string, draw: string }>}
 */
export const PAGE_LABELS = {
  'bootstrap-mean': { source: 'Original Sample', draw: 'This Resample' },
  'bootstrap-prop': { source: 'Original Sample', draw: 'This Resample' },
  'bootstrap-paired': { source: 'Differences', draw: 'This Resample' },
  'bootstrap-slope': { source: 'Original Data', draw: 'This Resample' },
  'bootstrap-two-means': { source: 'Original Groups', draw: 'Resampled Groups' },
  'bootstrap-two-props': { source: 'Original Groups', draw: 'Resampled Groups' },
  'randomization-diff-means': { source: 'Original Groups', draw: 'Shuffled Groups' },
  'randomization-diff-props': { source: 'Original Groups', draw: 'Shuffled Groups' },
  'randomization-paired': { source: 'Differences', draw: 'This Shuffle' },
  'randomization-correlation': { source: 'Original Data', draw: 'This Shuffle' },
  'randomization-anova': { source: 'Observed Groups', draw: 'This Shuffle' },
  'randomization-chisq': { source: 'Observed Table', draw: 'This Shuffle' },
  'randomization-one-mean': { source: 'Observed Data', draw: 'This Simulation' },
  'randomization-one-prop': { source: 'Population under H₀', draw: 'This Simulation' },
  'goodness-of-fit': { source: 'Observed Counts', draw: 'One Sample under H₀' },
};

/**
 * The words for a mechanism, falling back to the two-group randomization
 * vocabulary rather than throwing: a missing entry should degrade to a readable
 * page, not a blank one.
 *
 * @param {string} kind
 * @returns {MechanismVocabulary}
 */
export function wordsFor(kind) {
  return VOCABULARY[kind] ?? VOCABULARY.shuffle;
}

/**
 * Does this mechanism call its source and its distribution the same thing?
 *
 * Reported rather than silently tolerated: an interface that gives two
 * different entities one name is a defect, and this makes it checkable.
 *
 * @param {string} kind
 * @returns {boolean}
 */
export function hasNameCollision(kind) {
  const w = wordsFor(kind);
  return !!w.source && w.source === w.distribution;
}

/**
 * The qualifier a page puts in front of its source noun — "Original",
 * "Observed", or none. Eight pages say one, five say the other, and no rule
 * separates them.
 *
 * @param {string} page
 * @returns {'Original'|'Observed'|null}
 */
export function sourceQualifier(page) {
  const label = PAGE_LABELS[page]?.source ?? '';
  if (label.startsWith('Original')) return 'Original';
  if (label.startsWith('Observed')) return 'Observed';
  return null;
}
