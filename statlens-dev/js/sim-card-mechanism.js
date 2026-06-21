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
  return groupHTML(opts.group1Name, g1, opts) + groupHTML(opts.group2Name, g2, opts);
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
    .map(v => `<div class="card ${v === 1 ? 'is-success' : 'is-failure'}"></div>`)
    .join('');
  return `<div class="card-group">
      <h3>${name} <span class="mech-card-count">${succ}/${g.length}</span></h3>
      <div class="cards" role="img" aria-label="${name}: ${succ} ${successLabel} of ${g.length}">${cards}</div>
    </div>`;
}

/**
 * Compact legend markup (filled vs outline) for the strip description area.
 * @param {string} successLabel
 * @param {string} failureLabel
 * @returns {string}
 */
export function cardLegendHTML(successLabel, failureLabel) {
  return `<span class="mech-card-legend">`
    + `<span class="mech-card-swatch is-success"></span> ${successLabel}`
    + `<span class="mech-card-swatch is-failure"></span> ${failureLabel}</span>`;
}
