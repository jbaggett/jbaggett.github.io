// @ts-check
/**
 * TEMPORARY layout-variant prototypes for the simulation pages.
 *
 * Lets us A/B/C three candidate layouts for the sim pages without committing to
 * one, so the vertical-space problem can be judged on the real tool. The visual
 * differences are driven by CSS on `body[data-layout="…"]` (set in settings.js);
 * this module only handles the two variants that need DOM/behavior changes:
 *
 *   - current : today's layout (no-op)
 *   - tight   : pure-CSS condensing (no-op here)
 *   - focus   : tight + mechanism strip auto-collapses on mass simulation,
 *               handing the screen to the distribution
 *   - rail    : mechanism strip moves into the right rail beside the chart
 *
 * Select via the Settings dialog or the ?layout= URL param. Once a winner is
 * picked, fold it into the real layout and delete this module + the CSS block
 * marked "TEMP LAYOUT VARIANTS".
 */

import { getSetting } from './settings.js';

const ALLOWED = ['current', 'tight', 'rail', 'focus'];

/**
 * Resolve the active layout variant (URL param overrides the saved setting).
 * @returns {'current'|'tight'|'rail'|'focus'}
 */
export function getLayoutVariant() {
  const url = new URLSearchParams(window.location.search).get('layout');
  if (url && ALLOWED.includes(url)) return /** @type {any} */ (url);
  const saved = getSetting('layout');
  return ALLOWED.includes(saved) ? saved : 'current';
}

/**
 * Apply behavior for layout variants that need more than CSS.
 * Safe to call once during page init; no-op for current/tight.
 */
export function initLayoutVariants() {
  const layout = getLayoutVariant();
  if (layout === 'rail') initRail();
  else if (layout === 'focus') initFocus();
}

/** Move the mechanism strip into the right rail, below the results panel. */
function initRail() {
  const strip = document.getElementById('mechanism-strip');
  const sidebar = document.querySelector('#chart-and-results .app-sidebar');
  if (strip && sidebar) sidebar.appendChild(strip);
}

/**
 * Auto-collapse the mechanism strip once the student runs a mass simulation
 * (+100 or more), and re-expand it on a single shuffle. The collapse button and
 * one-line summary are provided by initMechanismCollapse() in page-utils.js.
 */
function initFocus() {
  const strip = document.getElementById('mechanism-strip');
  if (!strip) return;

  /** @param {boolean} yes */
  const setCollapsed = (yes) => {
    strip.classList.toggle('collapsed', yes);
    const btn = strip.querySelector('.mechanism-collapse-btn');
    if (btn) {
      btn.textContent = yes ? 'Show sampling detail' : 'Hide sampling detail';
      btn.setAttribute('aria-expanded', String(!yes));
    }
  };

  document.querySelectorAll('.gen-btn').forEach((b) => {
    b.addEventListener('click', () => {
      const n = Number(b.getAttribute('data-count') || '0');
      setCollapsed(n >= 100);
    });
  });
}
