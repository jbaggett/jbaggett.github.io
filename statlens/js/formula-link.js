// @ts-check
/**
 * C3 — linked formula highlighting.
 *
 * Connects a value shown inside a filled-in formula to the place it came from, so a
 * student can hover (or keyboard-focus) x̄ in the t-formula and see it light up in the
 * sample summary, μ₀ light up in the stated hypothesis, and so on.
 *
 * Convention:
 *   - Formula values/symbols carry a class `fx-<key>` (rendered via KaTeX `\htmlClass`).
 *   - Source elements carry `data-fx="<key>"`.
 * Any element sharing a `<key>` highlights together.
 *
 * Hover is resolved with `elementsFromPoint` rather than per-element `mouseenter`,
 * because KaTeX fractions stack `.vlist`/strut spans ON TOP of a value — so the classed
 * span is often not the topmost element under the cursor and a plain mouseenter never
 * fires. Keyboard focus is wired per element (and makes each value tabbable).
 *
 * Call after each results render; binding is idempotent per element / per scope.
 *
 * @param {ParentNode & { dataset?: DOMStringMap }|null} scope - container holding the
 *   formulas AND the sources (use a wide-enough scope, e.g. <main>, so the hypothesis
 *   display is included).
 */
export function linkFormula(scope) {
  if (!scope) return;
  const RESERVED = new Set(['fx-lit', 'fx-val']); // styling hooks, not keys

  /** @param {Element|null} el @returns {string|null} */
  const keyOf = (el) => {
    if (!el) return null;
    const src = el.getAttribute && el.getAttribute('data-fx');
    if (src) return src;
    const cls = el.classList && [...el.classList].find(c => c.startsWith('fx-') && !RESERVED.has(c));
    return cls ? cls.slice(3) : null;
  };

  /** Toggle the shared highlight for every element (value / symbol / source) of a key. */
  const light = (/** @type {string|null} */ key, /** @type {boolean} */ on) => {
    if (!key) return;
    scope.querySelectorAll(`.fx-${key}, [data-fx="${key}"]`).forEach(
      el => el.classList.toggle('fx-lit', on));
  };

  /** @type {string|null} */
  let active = null;
  const setActive = (/** @type {string|null} */ key) => {
    if (key === active) return;
    if (active) light(active, false);
    active = key;
    if (active) light(active, true);
  };

  // ── Mouse: hit-test the full stack under the pointer ──
  const el = /** @type {any} */ (scope);
  if (el.dataset && !el.dataset.fxHoverBound) {
    el.dataset.fxHoverBound = '1';
    scope.addEventListener('pointermove', (/** @type {any} */ e) => {
      const stack = document.elementsFromPoint(e.clientX, e.clientY);
      let key = null;
      for (const node of stack) {
        const k = keyOf(node);
        if (k) { key = k; break; }
        if (node === scope) break; // don't hit-test outside the scope
      }
      setActive(key);
    });
    scope.addEventListener('pointerleave', () => setActive(null));
  }

  // ── Keyboard: focus/blur per element (also makes values tabbable) ──
  scope.querySelectorAll('[data-fx], [class^="fx-"], [class*=" fx-"]').forEach((node) => {
    const key = keyOf(node);
    const n = /** @type {any} */ (node);
    if (!key || n.dataset.fxBound) return;
    n.dataset.fxBound = '1';
    node.addEventListener('focus', () => setActive(key));
    node.addEventListener('blur', () => { if (active === key) setActive(null); });
    if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '0');
  });
}
