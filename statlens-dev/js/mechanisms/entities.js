// @ts-check
/**
 * The three entities, addressable independently of where they sit.
 *
 * Every simulation page has a **source**, **one draw** from it, and the
 * **distribution** those draws accumulate into. On the Sampling Distribution
 * Lab those are three panels stacked vertically. Everywhere else the first two
 * are fused into one horizontal strip and the third lives in a different
 * `<section>` — same three things, laid out perpendicular, and the code could
 * not say so because it addressed them by whatever the page happened to call
 * its divs. Four naming schemes were in use for the same two roles:
 * `original-sample`/`bootstrap-sample`, `mech-original`/`mech-resample`,
 * `mech-observed`/`mech-simulation`, and five pages with no ids at all.
 *
 * Now each role has one address, `data-entity`, and this module resolves it.
 * That is the whole of the decoupling: nothing downstream needs to know that
 * the source and the draw are siblings, or that the distribution is far away.
 *
 * ## What fused them, and what has to survive
 *
 * Six things held source and draw together. Four were accidents of
 * co-location — one `<section>`, an arrow element *between* them, one shared
 * caption, one collapse state. Two are real, and this module makes them
 * explicit rather than letting adjacency enforce them:
 *
 * - **A shared scale.** A draw drawn at a different dot size or on a different
 *   x-domain than the source it came from is a lie: the eye reads the two
 *   panels as comparable. `createSharedScale` is handed to both.
 * - **A linkage.** The arrow, and the animation that flies values from source
 *   to draw, need to know *which two things* they connect. They used to know
 *   it by DOM position. Now they take element references, so the entities can
 *   be anywhere.
 *
 * @typedef {object} MechanismEntities
 * @property {HTMLElement|null} source - what the draw comes from
 * @property {HTMLElement|null} draw - one draw from it
 * @property {HTMLElement|null} distribution - what the draws accumulate into
 */

/**
 * Ids used for these roles before `data-entity` existed. Kept as a fallback so
 * a page that has not been tagged still resolves rather than silently losing
 * its mechanism.
 */
const LEGACY_IDS = {
  source: ['mech-observed', 'mech-original', 'original-sample'],
  draw: ['mech-simulation', 'mech-resample', 'bootstrap-sample'],
  distribution: ['chart-container', 'hist-container'],
};

/**
 * Find the three entities on a page.
 *
 * @param {ParentNode} [root]
 * @returns {MechanismEntities}
 */
export function resolveEntities(root = document) {
  /** @param {'source'|'draw'|'distribution'} role */
  const find = (role) => {
    const tagged = /** @type {HTMLElement|null} */ (
      root.querySelector(`[data-entity="${role}"]`));
    if (tagged) return tagged;
    for (const id of LEGACY_IDS[role]) {
      const el = /** @type {HTMLElement|null} */ (root.querySelector(`#${id}`));
      if (el) return el;
    }
    return null;
  };
  return { source: find('source'), draw: find('draw'), distribution: find('distribution') };
}

/**
 * The scale two entities must agree on.
 *
 * Dot radius and x-domain were previously shared by sitting in one closure and
 * being rendered in one function — true by construction, and only for as long
 * as the two panels were rendered together. This states it: whoever draws the
 * source and whoever draws the draw are handed the same object.
 *
 * `reset()` exists because a new dataset invalidates the fit: sizing computed
 * for 20 values makes 200 unreadable.
 *
 * @returns {{ sizingMaxStack: number, domain: [number, number]|null,
 *   fit: (stack: number, domain?: [number, number]|null) => void, reset: () => void }}
 */
export function createSharedScale() {
  const scale = {
    sizingMaxStack: 0,
    /** @type {[number, number]|null} */
    domain: null,
    /**
     * Widen the scale to hold what it has been asked to show. Only ever grows
     * within a dataset, so a later draw cannot shrink the picture under an
     * earlier one.
     */
    fit(stack, domain) {
      if (stack > scale.sizingMaxStack) scale.sizingMaxStack = stack;
      if (domain) {
        scale.domain = scale.domain
          ? [Math.min(scale.domain[0], domain[0]), Math.max(scale.domain[1], domain[1])]
          : [domain[0], domain[1]];
      }
    },
    reset() {
      scale.sizingMaxStack = 0;
      scale.domain = null;
    },
  };
  return scale;
}

/**
 * The relationship between two entities — what the arrow points along, and
 * what a draw animation travels.
 *
 * Takes references, not positions. Today the two are siblings with an arrow
 * element between them and the answer is "yes, horizontal"; that is a fact
 * about the current layout, not about the mechanism, so it is computed rather
 * than assumed.
 *
 * @param {HTMLElement|null} from
 * @param {HTMLElement|null} to
 * @returns {{ connected: boolean, adjacent: boolean, axis: 'horizontal'|'vertical'|null }}
 */
export function linkage(from, to) {
  if (!from || !to) return { connected: false, adjacent: false, axis: null };
  // Adjacency is a fact about the document, not about layout, so it survives an
  // entity being hidden or not yet drawn. Only the AXIS needs a measured box.
  const adjacent = from.parentElement === to.parentElement;
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  if (!a.width && !a.height) return { connected: true, adjacent, axis: null };
  const dx = Math.abs((b.left + b.width / 2) - (a.left + a.width / 2));
  const dy = Math.abs((b.top + b.height / 2) - (a.top + a.height / 2));
  return { connected: true, adjacent, axis: dx >= dy ? 'horizontal' : 'vertical' };
}
