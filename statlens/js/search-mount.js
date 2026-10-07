// @ts-check
/**
 * Put the search on every page.
 *
 * Jeff, 2026-10-07: "should we make the search button available everywhere?"
 * Yes — and the earlier objection to it does not survive contact with the
 * markup. The worry was that search is permanent chrome on every page; but the
 * chrome is already there, because every page carries a Home / Help / Settings
 * cluster. This is one more 28px icon in a cluster that exists, and it answers
 * a real situation: a student halfway through a tool who wants a different one
 * currently has to go Home first.
 *
 * The button and the overlay are BUILT HERE rather than written into 80 files.
 * One module to change, nothing to keep in sync, and a page joins in by loading
 * it. It is idempotent, so the landing page — which had the markup inline
 * first — is not double-mounted.
 *
 * `search-index.json` is resolved against this module's own URL, so it is found
 * from any directory depth without the page having to say where it is.
 */

import { initSiteSearchDialog } from './site-search.js';

const PLACEHOLDER = 'Search tools — try “p-value”, “coin”, or “before and after”';

/** Where `find/` is, from here — the same trick the index URL uses. */
const FIND_URL = new URL('../find/', import.meta.url).href;

function makeButton() {
  if (document.querySelector('.search-btn')) return;
  let actions = document.querySelector('.header-actions');
  if (!actions) {
    // A handful of pages have no icon cluster. Give them one rather than
    // leaving the button somewhere different on four pages out of eighty.
    const h1 = document.querySelector('h1');
    if (!h1) return;
    actions = document.createElement('span');
    actions.className = 'header-actions';
    h1.appendChild(actions);
  }
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'search-btn';
  btn.setAttribute('aria-label', 'Search tools');
  btn.title = 'Search tools  (press /)';
  btn.innerHTML = '<svg aria-hidden="true" viewBox="0 0 20 20" width="15" height="15">'
    + '<circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="2"/>'
    + '<line x1="12.8" y1="12.8" x2="17.5" y2="17.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  // After Home, which has been the first icon on every page since there were
  // pages — moving it would break whatever muscle memory people have. On the
  // landing page there is no Home (this IS home), so search leads there.
  const home = actions.querySelector('.home-btn');
  if (home && home.nextSibling) actions.insertBefore(btn, home.nextSibling);
  else if (home) actions.appendChild(btn);
  else actions.insertBefore(btn, actions.firstChild);
}

function makeDialog() {
  if (document.getElementById('site-search-dialog')) return;
  const dlg = document.createElement('dialog');
  dlg.id = 'site-search-dialog';
  dlg.setAttribute('aria-label', 'Search StatLens tools');
  dlg.innerHTML = `
        <div class="ss-dialog-head">
            <label class="sr-only" for="site-search-input">Search StatLens tools</label>
            <input type="search" id="site-search-input" autocomplete="off"
                   role="combobox" aria-expanded="false" aria-controls="site-search-results"
                   aria-autocomplete="list" placeholder="${PLACEHOLDER}">
            <button type="button" class="ss-close" aria-label="Close search">&times;</button>
        </div>
        <div id="site-search-results" class="site-search-results" role="listbox"
             aria-label="Search results" hidden></div>
        <p id="site-search-status" class="sr-only" role="status" aria-live="polite"></p>
        <p class="site-search-hint"><kbd>Esc</kbd> closes &middot; <a href="${FIND_URL}">see every page in one list</a></p>`;
  document.body.appendChild(dlg);
}

export function mountSearch() {
  makeButton();
  makeDialog();
  initSiteSearchDialog();
}

// Pages load this module and nothing else; mounting on import keeps the per-page
// cost to one <script> line.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountSearch, { once: true });
} else {
  mountSearch();
}
