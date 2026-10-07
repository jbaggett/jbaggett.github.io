// @ts-check
/**
 * The landing page's tool search.
 *
 * Jeff, 2026-10-07: "we need to work on the organization of the site, maybe
 * have a search bar and add keywords each page, we could also have an index
 * page." The landing page already carries 203 links across three views, so the
 * gap was never structure — it was finding a tool when you do not yet know
 * which bucket it lives in, or what it is called.
 *
 * Which is why the keywords carry both vocabularies (Jeff's call, same day):
 * a student types "before and after" or "is my coin fair"; an instructor types
 * "paired t-test" or "permutation test". Both have to land.
 *
 * The index is fetched once, lazily, on first interaction — the landing page
 * should not pay for it on load, and a reader who never searches never
 * downloads it. `find/` is the static fallback and is linked from here, so the
 * site stays navigable with JavaScript off or if this fetch fails.
 */

const INDEX_URL = new URL('../search-index.json', import.meta.url).href;
const MAX_RESULTS = 8;

/** @typedef {{p: string, t: string, d: string, k: string}} Entry */

/** @type {Entry[]|null} */
let entries = null;
/** @type {Promise<void>|null} */
let loading = null;

function loadIndex() {
  if (entries) return Promise.resolve();
  if (!loading) {
    loading = fetch(INDEX_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => { entries = data.pages ?? []; })
      .catch(() => { entries = []; });   // the static index page is the fallback
  }
  return loading;
}

/**
 * Score one entry against a query.
 *
 * Deliberately crude and explainable rather than fuzzy: a word that starts a
 * title beats a word inside one, a title beats a keyword, and a keyword beats
 * the description. A reader who types "boot" should get the bootstrap tools in
 * the order a person would list them, and should never be shown a match they
 * cannot see the reason for.
 *
 * @param {Entry} e @param {string[]} terms
 * @returns {number} 0 means "no match"
 */
function score(e, terms) {
  const title = e.t.toLowerCase();
  const keys = e.k.toLowerCase();
  const desc = e.d.toLowerCase();
  let total = 0;
  for (const term of terms) {
    let best = 0;
    if (title.startsWith(term)) best = 100;
    else if (new RegExp(`\\b${term}`).test(title)) best = 70;
    else if (title.includes(term)) best = 45;
    else if (new RegExp(`\\b${term}`).test(keys)) best = 32;
    else if (keys.includes(term)) best = 20;
    else if (desc.includes(term)) best = 10;
    // Every term must appear somewhere; "two means" should not match a page
    // that only knows about "two".
    if (!best) return 0;
    total += best;
  }
  return total;
}

/** @param {string} q @returns {Entry[]} */
function search(q) {
  const terms = q.toLowerCase().split(/\s+/).map((t) => t.trim()).filter(Boolean);
  if (!terms.length || !entries) return [];
  return entries
    .map((e) => ({ e, s: score(e, terms) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || a.e.t.localeCompare(b.e.t))
    .slice(0, MAX_RESULTS)
    .map((r) => r.e);
}

/** Which keywords actually matched, so the result can say why it is there. */
function matchedKeywords(/** @type {Entry} */ e, /** @type {string} */ q) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  return e.k.split(',').map((k) => k.trim())
    .filter((k) => terms.some((t) => k.toLowerCase().includes(t)))
    .slice(0, 3);
}

const escapeHtml = (/** @type {string} */ s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function initSiteSearch() {
  const input = /** @type {HTMLInputElement|null} */ (document.getElementById('site-search-input'));
  const list = document.getElementById('site-search-results');
  const status = document.getElementById('site-search-status');
  if (!input || !list) return;

  /** @type {Entry[]} */
  let current = [];
  let active = -1;

  const close = () => {
    list.hidden = true;
    list.innerHTML = '';
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
    current = [];
  };

  const render = (/** @type {string} */ q) => {
    current = search(q);
    active = -1;
    if (!q.trim()) { close(); if (status) status.textContent = ''; return; }
    if (!current.length) {
      list.innerHTML = `<p class="ss-empty">Nothing matched &ldquo;${escapeHtml(q)}&rdquo;. `
        + `<a href="find/">Browse every page</a> instead.</p>`;
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      if (status) status.textContent = `No tools matched ${q}.`;
      return;
    }
    list.innerHTML = current.map((e, i) => {
      const why = matchedKeywords(e, q);
      return `<a class="ss-result" role="option" id="ss-opt-${i}" aria-selected="false" href="${e.p}">`
        + `<span class="ss-title">${escapeHtml(e.t)}</span>`
        + `<span class="ss-desc">${escapeHtml(e.d)}</span>`
        + (why.length ? `<span class="ss-why">${escapeHtml(why.join(' · '))}</span>` : '')
        + `</a>`;
    }).join('');
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (status) {
      status.textContent = `${current.length} tool${current.length === 1 ? '' : 's'} matched. `
        + `Use the down arrow to step through them.`;
    }
  };

  const setActive = (/** @type {number} */ i) => {
    const opts = list.querySelectorAll('.ss-result');
    if (!opts.length) return;
    active = (i + opts.length) % opts.length;
    opts.forEach((o, k) => {
      const on = k === active;
      o.setAttribute('aria-selected', String(on));
      o.classList.toggle('is-active', on);
      if (on) {
        input.setAttribute('aria-activedescendant', o.id);
        /** @type {HTMLElement} */ (o).scrollIntoView({ block: 'nearest' });
      }
    });
  };

  const onInput = () => { loadIndex().then(() => render(input.value)); };
  input.addEventListener('input', onInput);
  input.addEventListener('focus', () => { loadIndex(); });

  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); setActive(active + 1); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); setActive(active - 1); }
    else if (ev.key === 'Enter') {
      const opts = list.querySelectorAll('.ss-result');
      if (active >= 0 && opts[active]) {
        ev.preventDefault();
        /** @type {HTMLAnchorElement} */ (opts[active]).click();
      }
    } else if (ev.key === 'Escape') {
      if (list.hidden) { input.value = ''; } else { close(); }
    }
  });

  document.addEventListener('click', (ev) => {
    if (!list.hidden && !list.contains(/** @type {Node} */ (ev.target))
        && ev.target !== input) close();
  });
}

// Exported for the tests, which should not have to drive a browser to check
// that "two means" does not match a page that only knows the word "two".
export const __test = { score, search, setEntries: (/** @type {Entry[]} */ e) => { entries = e; } };
