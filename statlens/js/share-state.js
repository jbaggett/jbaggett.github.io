// @ts-check
/**
 * The address bar as the source of truth for what is shareable.
 *
 * There used to be two ways to get a link out of a tool, and they disagreed:
 *
 * - **Share** (`js/share.js`, on 71 pages) built its URL from `location.search`
 *   — whatever was *already* in the address bar. Its "Include current settings"
 *   toggle therefore told the truth about the URL and lied about the settings:
 *   land on a bare tool URL, pick a dataset from the dropdown, turn the toggle
 *   on, and you got the bare URL back.
 * - **Copy link** (on 2 pages) built its URL from the live in-app state, which
 *   is the correct source — but it existed almost nowhere.
 *
 * They did not differ in intent. They differed in where they looked, and only
 * one of them was looking in the right place.
 *
 * So rather than teach Share to read the state, this keeps the address bar
 * *equal* to the state. Then `location.search` is the state, Share's existing
 * toggle starts telling the truth on all 71 pages, the QR has something real to
 * encode, and the URL can simply be copied out of the browser. One fix, four
 * problems.
 *
 * ## Rules
 *
 * - **`replaceState`, never `pushState`.** Back must mean "the page before",
 *   not "undo one setting", forty times over.
 * - **Other parameters survive.** `?embed=`, `?activity=`, `?mech=` and the
 *   rest are not the tool's state to overwrite.
 * - **The seed appears only once something has been generated.** Before that it
 *   is noise, and pinning it would quietly kill "reload for a fresh random
 *   sample" on every page.
 * - **Failure is silent.** `replaceState` throws in some embeds and sandboxed
 *   frames; the tool still works, so the tool still runs.
 */

/** @typedef {{ dataset?: string, data?: number[], params?: Record<string, any> }} ShareState */

/** Params that belong to the page, not to the tool's configuration. */
const NOT_OURS = new Set(['embed', 'activity', 'mech', 'layout', 'mode', 'chrome', 'plot']);

/**
 * Inline `?data=` beyond this many values makes a URL nobody can scan or paste.
 * The ceiling for a link the user deliberately asked for.
 */
const MAX_INLINE_DATA = 2000;

/**
 * The ceiling for the ADDRESS BAR, which is ambient rather than asked for.
 *
 * 2000 values is roughly 8000 characters, and putting that in the address bar
 * on every click is both ugly and close to what some browsers will keep. A
 * deliberate share link can carry it; the URL you did not ask for should not.
 * Below this the two agree, which is the common case — a bundled dataset is one
 * short `?dataset=` either way.
 */
const MAX_AMBIENT_DATA = 200;

/** @type {(() => ShareState)|null} */
let provider = null;
let seedIsPinned = false;

/**
 * Register the page's state provider. One per page; the last wins.
 *
 * @param {() => ShareState} getState
 */
export function registerShareState(getState) {
  provider = getState;
  publish();
}

/**
 * From here on, include the seed. Called when the user generates something:
 * before that the seed is an implementation detail, after it the link is
 * worthless without it.
 */
export function markGenerated() {
  if (seedIsPinned) return;
  seedIsPinned = true;
  syncUrl();
}

/** Forget the seed again — a reset means "give me a clean tool". */
export function forgetSeed() {
  seedIsPinned = false;
}

/**
 * The URL that reproduces what is on screen, or null if the page has no state
 * provider (most pages do not, and fall back to their own address bar).
 *
 * @returns {string|null}
 */
export function shareableUrl({ ambient = false } = {}) {
  if (!provider) return null;
  let st;
  try { st = provider() || {}; } catch { return null; }
  const qp = new URLSearchParams(location.search);
  // Drop what we own, keep what we do not.
  for (const key of [...qp.keys()]) {
    if (!NOT_OURS.has(key)) qp.delete(key);
  }
  if (st.dataset) qp.set('dataset', st.dataset);
  else if (st.data && st.data.length > 0
      && st.data.length <= (ambient ? MAX_AMBIENT_DATA : MAX_INLINE_DATA)) {
    qp.set('data', st.data.join(','));
  }
  for (const [k, v] of Object.entries(st.params || {})) {
    if (v == null || v === '') continue;
    if (k === 'seed' && !seedIsPinned) continue;
    qp.set(k, String(v));
  }
  const qs = qp.toString();
  return location.origin + location.pathname + (qs ? `?${qs}` : '') + location.hash;
}

/**
 * Write the current state into the address bar.
 *
 * Cheap enough to call on every interaction; `replaceState` is a synchronous
 * pointer swap, and building the query is a handful of string operations.
 */
export function syncUrl() {
  const url = shareableUrl({ ambient: true });
  if (!url) return;
  try {
    if (url !== location.href) history.replaceState(null, '', url);
  } catch { /* blocked in some embeds — the tool still works */ }
  publish();
}

/**
 * Make the live URL readable by `js/share.js`, which is a classic script and
 * cannot await a module import at the moment the dialog opens.
 */
function publish() {
  try {
    /** @type {any} */ (window).__statlensShareUrl = () => shareableUrl();
    // `replaceState` fires no event of its own, so anything drawing the current
    // URL — the pinned QR — would have to poll. Announce it instead.
    window.dispatchEvent(new CustomEvent('statlens:urlchange'));
  } catch { /* non-browser */ }
}

/**
 * Re-sync after anything the user does.
 *
 * Delegated and debounced rather than wired into thirty individual controls:
 * the provider reads current state on demand, so "something changed" is enough
 * to know the URL is stale. Hunting every control is how a control gets missed.
 *
 * @param {number} [waitMs]
 */
export function syncUrlOnInteraction(waitMs = 200) {
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let timer;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(syncUrl, waitMs);
  };
  for (const evt of ['change', 'click']) {
    document.addEventListener(evt, schedule, { passive: true, capture: true });
  }
}
