/**
 * Page chrome every lens page shares: the help dialog, the screen-reader live
 * region, reduced-motion, embed mode, and the standard boot sequence.
 */

import { getParams } from './url.js';
import { initEmbedHeight } from './embed.js';

let announceTimer = null;

/**
 * Speak a message through the page's `#sr-announce` live region.
 *
 * Debounced: dragging a slider fires dozens of updates a second, and a screen
 * reader that tries to read every one says nothing useful. The last message
 * within the quiet window wins.
 *
 * @param {string} msg
 * @param {number} [delay]
 */
export function announce(msg, delay = 400) {
  const el = document.getElementById('sr-announce');
  if (!el) return;
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => { el.textContent = msg; }, delay);
}

/** @returns {boolean} */
export function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Wire the `?` button to the help <dialog>, plus the `?` and Esc keys. */
export function initHelp() {
  const dialog = /** @type {HTMLDialogElement|null} */ (document.querySelector('.ll-help-dialog'));
  const btn = document.querySelector('.help-btn');
  if (!dialog || !btn) return;
  const open = () => { if (!dialog.open) dialog.showModal(); };
  btn.addEventListener('click', open);
  dialog.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => dialog.close()));
  document.addEventListener('keydown', e => {
    const target = /** @type {HTMLElement} */ (e.target);
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable;
    if (e.key === '?' && !typing && !dialog.open) { e.preventDefault(); open(); }
  });
}

/**
 * Apply `?embed=true`: strip the page down to the tool itself for an iframe in
 * the textbook. Everything hidden is chrome, never content.
 */
/**
 * How much the page explains itself.
 *
 * Orthogonal to `?controls=`, which decides which controls EXIST. This decides
 * how much prose surrounds them, and the two are genuinely different decisions:
 * a student alone at 11pm needs every word, while the same page on a projector
 * with an instructor narrating wants the figure twice the size and the prose
 * gone. Deliberately not folded into `?embed=true` either — stripping site
 * chrome and stripping pedagogical prose are different asks, and a page
 * embedded in a student handout wants the first without the second.
 *
 *   full  (default)  everything
 *   lean             no lede, no explanatory hints; legend and readout stay
 *   none             also no legend, no readout, and the page widens to the
 *                    full projector rather than the reading-width column
 *
 * What NEVER goes at any level: the controls, the figure, the table, and the
 * question the tool is asking. Those are the lesson, not the commentary.
 *
 * It works on every existing tool with no per-page markup, because it keys off
 * the kit's own classes.
 */
export function applyProse() {
  const level = getParams().raw.get('prose');
  if (level === 'lean' || level === 'none') {
    document.body.setAttribute('data-prose', level);
  }
}

export function applyEmbed() {
  // Height reporting is useful whenever we are framed, with or without ?embed.
  initEmbedHeight();
  if (!getParams().embed) return;
  document.body.classList.add('ll-embed');
}

/**
 * Hide the controls a slide does not want.
 *
 * `controls=` is a KEEP-list (ours) and `hide=` a blacklist (StatLens's
 * spelling); both are honoured, because a lecture figure wants to name the two
 * things it needs rather than the nine it does not. Elements opt in by carrying
 * `data-control="<name>"`, and a panel emptied of every control hides itself
 * rather than leaving a bare box behind.
 *
 * This lived in three tools and had already drifted — only two of the copies
 * carried the `#reveal-slot` guard, so `?controls=` could hide the reveal
 * button on the squeeze page while leaving its R key working with nothing on
 * screen to say so. One copy, in the kit, is the fix.
 *
 * @param {string|null} list      `controls=` — names to KEEP
 * @param {string|null} [hideList] `hide=` — names to drop
 */
export function applyControls(list, hideList) {
  const keep = list ? new Set(list.split(',').map(s => s.trim()).filter(Boolean)) : null;
  const drop = hideList ? new Set(hideList.split(',').map(s => s.trim()).filter(Boolean)) : null;
  if (!keep && !drop) return;
  document.querySelectorAll('[data-control]').forEach(el => {
    const name = /** @type {HTMLElement} */ (el).dataset.control;
    if ((keep && !keep.has(name)) || (drop && drop.has(name))) {
      /** @type {HTMLElement} */ (el).hidden = true;
    }
  });
  document.querySelectorAll('.ll-panel').forEach(p => {
    // Never collapse the panel holding the reveal control: hiding it leaves the
    // R key live with nothing on screen to announce it.
    if (p.querySelector('#reveal-slot')) return;
    const own = p.querySelectorAll('[data-control]').length;
    const live = [...p.querySelectorAll('[data-control]')].some(e => !(/** @type {HTMLElement} */ (e).hidden));
    if (own > 0 && !live) /** @type {HTMLElement} */ (p).hidden = true;
  });
}

/**
 * Standard boot sequence for a tool page.
 * @param {{onReady?:()=>void}} [opts]
 */
export function initPage(opts = {}) {
  applyEmbed();
  applyProse();
  initHelp();
  opts.onReady?.();
}
