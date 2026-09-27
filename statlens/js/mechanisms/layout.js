// @ts-check
/**
 * Where the three entities go.
 *
 * Stage 3 made source, one draw and the distribution three things the code can
 * name. This is the first thing to take advantage of that: a second layout,
 * chosen by `?mech=`, with no change to the default.
 *
 * Named `mech` rather than `layout` because `?layout=` was taken at the time by
 * a current/tight/rail/focus page-layout experiment, which wrote
 * `body[data-layout]` and silently overwrote an earlier draft of this module's
 * attribute. That experiment has since been removed (2026-09-27) and the name
 * is free again, but `mech` is the better one anyway: this lays out the
 * mechanism, not the page.
 *
 * Chosen by `?mech=` on a single link, or by the **Resampling layout** setting
 * (`legacy` / `split`) for every page on this machine. The parameter wins.
 *
 * - **`strip`** (the `legacy` setting, and today's default) — what every simulation page ships today. Source and
 *   draw side by side with an arrow between them, in a collapsible strip; the
 *   distribution further down the page in its own section.
 * - **`tiers`** — all three stacked in order, each labelled with its role, so
 *   the *sequence* is the picture. Population → sample → sampling distribution
 *   is the same shape as source → resample → bootstrap distribution, and a
 *   student meeting both currently has no way to see that.
 * - **`split`** — what the Sampling Distribution Lab actually does on a wide
 *   screen, which is not a stack: steps 1 and 2 share a narrow left column and
 *   step 3 takes a wider right one (`0.82fr / 1.18fr` above 820px, one column
 *   below, `main` widened to 1180px). The two inputs sit beside the thing they
 *   build, and the draw travels sideways into it rather than downward past it.
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
import { getResamplingLayout } from '../settings.js';

/** @typedef {'strip'|'tiers'|'split'} LayoutMode */

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
  // An explicit `?mech=` wins, including `strip`: a link is a deliberate act and
  // should show what it says whoever opens it, whatever they have saved.
  if (raw === 'tiers' || raw === 'split' || raw === 'strip') return raw;
  // Otherwise the saved preference. 'legacy' is the strip, named for what it is
  // to a reader of the settings dialog rather than for what the CSS calls it.
  try {
    return getResamplingLayout() === 'split' ? 'split' : 'strip';
  } catch {
    return 'strip';
  }
}

/**
 * Move the three entities into stacked, labelled tiers.
 *
 * Does nothing if an entity is missing or the page has already been converted,
 * so calling it twice, or on a page that has no mechanism, is safe.
 *
 * @param {string} mechanismKind - which vocabulary to label the tiers with
 * @param {Document} [doc]
 * @param {'tiers'|'split'} [mode] - stacked, or the Lab's two columns
 * @returns {boolean} whether the layout was applied
 */
export function applyTierLayout(mechanismKind, doc = document, mode = 'tiers') {
  if (doc.querySelector('.mech-tiers')) return false;
  const { source, draw, distribution } = resolveEntities(doc);
  if (!source || !draw || !distribution) return false;

  const words = wordsFor(mechanismKind);
  const strip = doc.getElementById('mechanism-strip');
  const host = strip?.parentElement;
  if (!host) return false;

  const tiers = doc.createElement('section');
  tiers.className = mode === 'split' ? 'mech-tiers mech-tiers--split' : 'mech-tiers';
  tiers.setAttribute('aria-label', 'How this simulation works, step by step');

  // In split, steps 1 and 2 share a left column and step 3 takes the right —
  // the Lab's own grid. The tiers themselves are identical either way; only
  // where they are placed differs, which is the whole point of Stage 3.
  const left = doc.createElement('div');
  const right = doc.createElement('div');
  if (mode === 'split') {
    left.className = 'mech-col-left';
    right.className = 'mech-col-right';
    tiers.appendChild(left);
    tiers.appendChild(right);
  }
  /** @param {string} role */
  const columnFor = (role) => mode !== 'split' ? tiers
    : (role === 'distribution' ? right : left);

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
    columnFor(role).appendChild(tier);
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
  doc.body.setAttribute('data-mech-layout', mode);
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
  if (mode !== 'strip') applyTierLayout(mechanismKind, document, mode);
  return mode;
}
