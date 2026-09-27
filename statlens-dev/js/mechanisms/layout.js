// @ts-check
/**
 * Where the three entities go.
 *
 * Stage 3 made source, one draw and the distribution three things the code can
 * name. This is the first thing to take advantage of that: a second layout,
 * chosen by `?mech=`, with no change to the default.
 *
 * Not `?layout=`, which the plan proposed and which is already taken:
 * `js/layout-variants.js` uses it for the current/tight/rail/focus prototypes,
 * and `settings.js` writes `body[data-layout]` from it — so an earlier draft of
 * this module had its attribute silently overwritten, leaving an emptied strip
 * visible beneath the tiers on whichever pages happened to apply settings last.
 * Hence `data-mech-layout`.
 *
 * - **`strip`** (default) — what every simulation page ships today. Source and
 *   draw side by side with an arrow between them, in a collapsible strip; the
 *   distribution further down the page in its own section.
 * - **`tiers`** — the Sampling Distribution Lab's arrangement, applied to a
 *   simulation tool: all three stacked, each labelled with its role, so the
 *   *sequence* is the picture. Population → sample → sampling distribution is
 *   the same shape as source → resample → bootstrap distribution, and a student
 *   meeting both has currently no way to see that.
 *
 * The point of building it is to be able to look at the two side by side rather
 * than argue about them. Whether a bootstrap should look like the Lab is a
 * teaching question, and teaching questions are better answered by a preview
 * than by a paragraph.
 *
 * **Applied before the first render.** Charts measure the box they are drawn
 * into, so moving one afterwards means re-rendering it. Reparenting first means
 * every render happens in the final home and nothing has to be told about it.
 */

import { resolveEntities } from './entities.js';
import { wordsFor } from './vocabulary.js';

/** @typedef {'strip'|'tiers'} LayoutMode */

/**
 * The layout asked for in the URL. Anything unrecognised is the default, so a
 * typo shows the familiar page rather than a broken one.
 *
 * @param {string} [search]
 * @returns {LayoutMode}
 */
export function requestedLayout(search) {
  const raw = new URLSearchParams(
    search ?? (typeof location === 'undefined' ? '' : location.search)).get('mech');
  return raw === 'tiers' ? 'tiers' : 'strip';
}

/**
 * Move the three entities into stacked, labelled tiers.
 *
 * Does nothing if an entity is missing or the page has already been converted,
 * so calling it twice, or on a page that has no mechanism, is safe.
 *
 * @param {string} mechanismKind - which vocabulary to label the tiers with
 * @param {Document} [doc]
 * @returns {boolean} whether the layout was applied
 */
export function applyTierLayout(mechanismKind, doc = document) {
  if (doc.querySelector('.mech-tiers')) return false;
  const { source, draw, distribution } = resolveEntities(doc);
  if (!source || !draw || !distribution) return false;

  const words = wordsFor(mechanismKind);
  const strip = doc.getElementById('mechanism-strip');
  const host = strip?.parentElement;
  if (!host) return false;

  const tiers = doc.createElement('section');
  tiers.className = 'mech-tiers';
  tiers.setAttribute('aria-label', 'How this simulation works, step by step');

  /**
   * Wrap an entity in a tier, keeping the entity element itself intact — its
   * contents are rendered by code that knows nothing about this layout.
   */
  const addTier = (/** @type {HTMLElement} */ el, role, tag, title) => {
    const tier = doc.createElement('div');
    tier.className = `mech-tier mech-tier--${role}`;
    const head = doc.createElement('h3');
    head.className = 'mech-tier-head';
    const tagEl = doc.createElement('span');
    tagEl.className = 'mech-tier-tag';
    tagEl.textContent = tag;
    head.appendChild(tagEl);
    head.appendChild(doc.createTextNode(title));
    tier.appendChild(head);
    // The entity keeps its own heading inside the strip; in tiers the tier
    // heading says it, so the inner one would say it twice.
    el.querySelectorAll('.mechanism-title').forEach(t => { t.hidden = true; });
    tier.appendChild(el);
    tiers.appendChild(tier);
  };

  // The order IS the argument: this, then one of these, then all of them.
  // Each page's own noun wins over the mechanism's generic one — "Observed
  // Table" and "Differences" say more than "Source" would.
  addTier(source, 'source', 'Step 1', panelTitle(source) ?? words.source ?? 'Source');
  addTier(draw, 'draw', 'Step 2', panelTitle(draw) ?? words.draw ?? 'One draw');
  addTier(distribution, 'distribution', 'Step 3', words.distribution);

  // The caption explains the draw, so in tiers it belongs to the draw's tier
  // rather than to a strip that is about to disappear.
  const caption = doc.getElementById('mechanism-description');
  const drawTier = tiers.querySelector('.mech-tier--draw');
  if (caption && drawTier) drawTier.appendChild(caption);

  host.insertBefore(tiers, strip);
  // The strip is now an empty shell — its arrow only meant something between
  // two side-by-side panels. `hidden` is not enough: the engines set
  // `strip.hidden = false` when the mechanism initialises, which would reveal
  // an empty box under the tiers. A body attribute drives a CSS rule instead —
  // its own attribute, since `data-layout` belongs to the layout variants.
  doc.body.setAttribute('data-mech-layout', 'tiers');
  return true;
}

/**
 * The title a page gave a panel, so a tier can keep the page's own noun
 * ("Observed Table", "Differences") rather than flattening it to a role name.
 *
 * Read before the inner heading is hidden — see addTier.
 *
 * @param {HTMLElement} el
 * @returns {string|null}
 */
function panelTitle(el) {
  const t = el.querySelector('.mechanism-title');
  return t?.textContent?.trim() || null;
}

/**
 * Apply whatever the URL asked for. Safe to call on any page.
 *
 * @param {string} mechanismKind
 * @returns {LayoutMode}
 */
export function applyRequestedLayout(mechanismKind) {
  const mode = requestedLayout();
  if (mode === 'tiers') applyTierLayout(mechanismKind);
  return mode;
}
