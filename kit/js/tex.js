/**
 * The single choke point for rendered math across every lens.
 *
 * StatLens grew six different ways to put math on screen and four spellings of
 * x-bar, and every one had to be hunted down later. The rule for LearnLens is
 * set here: `tex()` is the only path to rendered math and `.ll-math` is the only
 * class that carries it. Nothing anywhere else calls KaTeX directly.
 *
 * KaTeX is vendored (kit/vendor/katex), not loaded from a CDN — these tools run
 * in lecture halls. It is still loaded as a global <script>, so `tex()` degrades
 * to readable <code> if it is missing rather than throwing a ReferenceError that
 * takes the whole render down.
 */

function escapeHtml(/** @type {string} */ s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Neutralise a user-supplied string for interpolation inside `\text{...}`.
 * Student input reaches the renderer, so a bare backslash must not become a
 * command.
 * @param {string} str
 */
export function escapeTex(str) {
  return String(str).replace(/[\\{}$&#^_%~]/g, ch => ({
    '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', $: '\\$', '&': '\\&',
    '#': '\\#', '^': '\\textasciicircum{}', _: '\\_', '%': '\\%', '~': '\\textasciitilde{}',
  }[ch]));
}

/**
 * Render LaTeX to an HTML string. The single choke point for math.
 * @param {string} latex
 * @param {{display?:boolean}} [opts]
 * @returns {string}
 */
export function tex(latex, opts = {}) {
  const katex = /** @type {any} */ (globalThis).katex;
  if (!katex || !katex.renderToString) {
    return `<code class="ll-tex-fallback">${escapeHtml(latex)}</code>`;
  }
  return katex.renderToString(latex, {
    throwOnError: false,
    displayMode: !!opts.display,
    strict: false,
  });
}

/** Render LaTeX into an element (clearing it first). */
export function setTex(/** @type {Element|null} */ el, /** @type {string} */ latex, opts = {}) {
  if (el) el.innerHTML = tex(latex, opts);
}
