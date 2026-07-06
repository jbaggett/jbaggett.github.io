// @ts-check
/**
 * C3 — linked formula highlighting.
 *
 * Connects a value shown inside a filled-in formula to the place it came from, so a
 * student can hover (or keyboard-focus) x̄ in the t-formula and see it light up in the
 * sample summary, μ₀ light up in the stated hypothesis, and so on.
 *
 * Convention:
 *   - Formula values carry a class `fx-<key>` (rendered via KaTeX `\htmlClass`).
 *   - Source elements carry `data-fx="<key>"`.
 * Any element sharing a `<key>` highlights together. Call after each results render;
 * binding is idempotent per element.
 *
 * @param {ParentNode|null} scope - a container holding both the formulas and the sources
 */
export function linkFormula(scope) {
  if (!scope) return;

  /** Toggle the shared highlight for every element (value or source) of a key. */
  const light = (/** @type {string} */ key, /** @type {boolean} */ on) => {
    scope.querySelectorAll(`.fx-${key}, [data-fx="${key}"]`).forEach(
      el => el.classList.toggle('fx-lit', on));
  };

  const RESERVED = new Set(['fx-lit', 'fx-val']); // styling hooks, not keys
  /** @param {Element} el @returns {string|null} */
  const keyOf = (el) => {
    const src = el.getAttribute('data-fx');
    if (src) return src;
    const cls = [...el.classList].find(c => c.startsWith('fx-') && !RESERVED.has(c));
    return cls ? cls.slice(3) : null;
  };

  const targets = scope.querySelectorAll('[data-fx], [class^="fx-"], [class*=" fx-"]');
  targets.forEach((el) => {
    const key = keyOf(el);
    if (!key || /** @type {HTMLElement} */ (el).dataset.fxBound) return;
    /** @type {HTMLElement} */ (el).dataset.fxBound = '1';
    el.addEventListener('mouseenter', () => light(key, true));
    el.addEventListener('mouseleave', () => light(key, false));
    el.addEventListener('focus', () => light(key, true));
    el.addEventListener('blur', () => light(key, false));
    // Keyboard-reachable so the link isn't mouse-only (a11y).
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
  });
}
