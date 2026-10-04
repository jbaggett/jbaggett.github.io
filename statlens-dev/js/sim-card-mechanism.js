// @ts-check
/**
 * Card rendering for the two-group proportion mechanism strip.
 *
 * Each observation is a card (filled = success, outline = failure). The two
 * groups are shown as card grids; on a single shuffle the cards gather and are
 * re-dealt to new groups via the FLIP animation in card-shuffle-anim.js — the
 * same effect as the conceptual randomization walkthrough, but inline in the
 * real tool so the dealt result drops into the live null distribution.
 *
 * Structure deliberately matches what animateCardShuffle expects: a container
 * holding `.card` elements grouped under `.card-group` with an `<h3>` label.
 */

import { obsLegendHTML } from './prop-bootstrap-mech.js';

/**
 * @typedef {object} CardOpts
 * @property {string} group1Name
 * @property {string} group2Name
 * @property {string} [successLabel]
 * @property {string} [failureLabel]
 */

/**
 * Inner HTML for both card groups (no diff line — the strip appends that).
 * @param {number[]} g1 - Group 1 values (1 = success, 0 = failure)
 * @param {number[]} g2 - Group 2 values
 * @param {CardOpts} opts
 * @returns {string}
 */
export function cardGroupsHTML(g1, g2, opts) {
  // Cards shrink as the piles grow, so the metaphor survives a bigger study
  // instead of being withdrawn at a cliff. Both groups get the SAME size, from
  // whichever is larger — two piles drawn at different scales could not be
  // compared, which is the one thing this panel exists to let you do.
  return `<div class="card-sizes" style="--card-w:${cardWidth(Math.max(g1.length, g2.length))}px">`
    + groupHTML(opts.group1Name, g1, opts)
    + groupHTML(opts.group2Name, g2, opts)
    + '</div>';
}

/**
 * Card width for a pile of `n`.
 *
 * Full size up to 50 — the size everything was drawn at before — then down to
 * 10px at 75, and no smaller. Below 10px a card stops reading as a card and the
 * metaphor is the point, so past 75 the pile grows in ROWS instead: at the
 * 105-per-group cap that is seven rows of fifteen. (Jeff, 2026-10-01, after
 * looking at the 75 case on dev — REQ-068 C.)
 *
 * @param {number} n - the larger group's size
 * @returns {number} width in px; height follows in CSS
 */
export function cardWidth(n) {
  const FULL = 15, MIN = 10, FROM = 50, TO = 75;
  if (n <= FROM) return FULL;
  if (n >= TO) return MIN;
  return Math.round((FULL - (FULL - MIN) * ((n - FROM) / (TO - FROM))) * 10) / 10;
}

/**
 * @param {string} name
 * @param {number[]} g
 * @param {CardOpts} opts
 * @returns {string}
 */
function groupHTML(name, g, opts) {
  const succ = g.filter(v => v === 1).length;
  const successLabel = opts.successLabel || 'success';
  const cards = g
    // `obs-mark` is the shared one-mark-per-observation component (geometry and
    // colour, css/style.css); `card` stays as the shuffle animation's handle.
    .map(v => `<div class="obs-mark card ${v === 1 ? 'is-success' : 'is-failure'}"></div>`)
    .join('');
  return `<div class="card-group">
      <h3>${name} <span class="mech-card-count">${succ}/${g.length}</span></h3>
      <div class="cards" role="img" aria-label="${name}: ${succ} ${successLabel} of ${g.length}">${cards}</div>
    </div>`;
}

/**
 * The card view's colour key.
 *
 * It is the shared proportion key (obsLegendHTML) wearing the card palette,
 * because the chips have to be the cards they describe — the legend sits in the
 * strip's bottom bar, outside `.mech-card-display`, so it carries the palette
 * itself rather than inheriting it.
 *
 * @param {string} successLabel
 * @param {string} failureLabel
 * @param {{ swapped?: boolean }} [opts] - `swapped`: the WHITE card is the
 *   success (?cardcolor=white), for materials whose own deck reads that way.
 * @returns {string}
 */
export function cardLegendHTML(successLabel, failureLabel, opts = {}) {
  return obsLegendHTML(successLabel, failureLabel, {
    className: `mech-card-legend obs-cards${opts.swapped ? ' is-swapped' : ''}`,
  });
}
