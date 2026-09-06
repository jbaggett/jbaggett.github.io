/**
 * Shared KaTeX rendering — the single choke point for math on the tool pages.
 *
 * Before this module, fifteen page modules each defined their own identical
 * `tex()` helper, and two subtly different KaTeX option sets drifted between
 * them. Three invariants now live here instead of being re-derived per page:
 *
 *   1. Trust set. `formula-link.js`'s hover linkage needs `\htmlClass`, which
 *      KaTeX only honours under `{ trust: true, strict: false }`. Because
 *      `throwOnError: false` swallows the failure, a page that forgot the trust
 *      set produced silently-dead hover links. Baking it in makes that
 *      un-forgettable. Trust also enables `\href`, which is exactly why every
 *      caller MUST run user-supplied text through `escapeTex()` first.
 *
 *   2. Offline fallback. KaTeX is loaded from a CDN. Offline, the global
 *      `katex` is undefined, and a bare `katex.renderToString(...)` threw a
 *      ReferenceError that took down the entire results render — not just one
 *      formula. Here it degrades to inline <code> so the rest of the page lives.
 *
 *   3. Escaping. TeX and HTML have different metacharacters; there was no
 *      `escapeTex()` anywhere, so pages either escaped wrongly (HTML-escaping a
 *      TeX string) or not at all. `escapeTex()` is the one correct answer.
 *
 * The activity panel (`activity-panel.js`) keeps its own renderer: it lazy-loads
 * KaTeX on demand rather than via a page <script>, and already degrades to
 * <code>. It is the one intentional exception to the single choke point.
 */

/** Minimal HTML escape for the offline <code> fallback text. */
function escapeHtml(/** @type {string} */ s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Neutralize a user-supplied string for safe interpolation *inside* a TeX
 * `\text{...}` group. Group names, column names, and variable names can arrive
 * from `?data=` (the MyOpenMath path), so they are untrusted input reaching a
 * `trust: true` renderer where a bare backslash could inject `\href`.
 *
 * Each TeX metacharacter is mapped to its literal-rendering escape so the name
 * still displays verbatim: "Height_cm (mm)" shows as written, not with "cm" as
 * a subscript. Use this ONLY for content, never for the formula structure.
 *
 * @param {string} str
 * @returns {string}
 */
export function escapeTex(str) {
  return String(str).replace(/[\\{}$&#^_%~]/g, ch => ({
    '\\': '\\textbackslash{}',
    '{': '\\{',
    '}': '\\}',
    '$': '\\$',
    '&': '\\&',
    '#': '\\#',
    '^': '\\textasciicircum{}',
    '_': '\\_',
    '%': '\\%',
    '~': '\\textasciitilde{}',
  }[ch]));
}

/**
 * Render a LaTeX string to an HTML string via KaTeX.
 *
 * @param {string} latex - The TeX source. Interpolate untrusted names only
 *   after passing them through {@link escapeTex}.
 * @param {boolean|{display?: boolean}} [opts] - Display mode. A bare boolean is
 *   accepted for backward compatibility with the old per-page `tex(latex, bool)`.
 * @returns {string} HTML string, or an inline <code> fallback if KaTeX is absent.
 */
export function tex(latex, opts = false) {
  const display = typeof opts === 'boolean' ? opts : !!(opts && opts.display);
  // eslint-disable-next-line no-undef -- `katex` is a CDN global (window.katex)
  if (typeof katex === 'undefined' || !katex.renderToString) {
    return `<code class="tex-fallback">${escapeHtml(latex)}</code>`;
  }
  // eslint-disable-next-line no-undef
  return katex.renderToString(latex, {
    throwOnError: false,
    displayMode: display,
    trust: true,
    strict: false,
  });
}
