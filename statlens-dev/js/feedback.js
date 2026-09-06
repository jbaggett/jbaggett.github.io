// @ts-check
/**
 * Per-page colleague feedback via Hypothesis (hypothes.is) — the same annotation
 * tool used for the coursepack and textbook. Colleagues highlight text or drop a
 * margin note, anchored to the exact spot on that page; annotations are naturally
 * per-page because each StatLens tool has its own URL.
 *
 * Desktop / tablet only. On a phone the annotation sidebar would eat scarce width
 * and fight the interactive calculators for space, so we simply don't inject the
 * embed below tablet size (Jeff's call). The decision is made once, at load — a
 * phone rotated to landscape keeps the clean layout it started with.
 *
 * There is no CSP on the site and the service worker is network-first for
 * cross-origin requests, so the Hypothesis client loads without special handling.
 */
(function () {
  // Never load third-party annotation under test automation — it injects a sidebar
  // iframe and edge tab that could interfere with Playwright interactions.
  if (navigator.webdriver) return;

  // Tablet portrait (iPad) is 768px; phones sit below. Load at that width and up.
  var TABLET_MIN_PX = 768;
  if (window.innerWidth < TABLET_MIN_PX) return;

  var s = document.createElement('script');
  s.src = 'https://hypothes.is/embed.js';
  s.async = true;
  document.head.appendChild(s);
})();
