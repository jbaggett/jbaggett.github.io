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

/**
 * Typeset every `[data-math]` element from the expression it carries.
 *
 * This exists because hand-written labels drift from the notation. A preset
 * button spelled `√x` in HTML shows a radical that does NOT extend over its
 * argument — the glyph is a character, not a construction — so `√x+1` reads as
 * "root x, plus one" when the expression means the opposite. Superscripts hit
 * the same wall: `e<sup>−x²</sup>` is four separate typographic guesses.
 *
 * Generating the label from the source string removes the possibility: the
 * button shows exactly the expression it inserts, typeset properly.
 *
 * No `aria-label` is set, deliberately. KaTeX emits MathML for screen readers
 * alongside the visual output, so a button containing it already has a correct
 * accessible name; an `aria-label` would override that with something worse.
 *
 * @param {(src:string)=>string|null} toTex  source → LaTeX, or null if unreadable
 * @param {{root?:ParentNode, attr?:string}} [opts]
 */
export function renderMathLabels(toTex, opts = {}) {
  const { root = document, attr = 'data-math' } = opts;
  for (const el of root.querySelectorAll(`[${attr}]`)) {
    const src = el.getAttribute(attr);
    if (!src) continue;
    const latex = toTex(src);
    // Unreadable source keeps whatever the HTML said — better a plain label
    // than an empty button.
    if (latex) el.innerHTML = tex(latex);
  }
}
