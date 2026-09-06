/**
 * Living inside an iframe.
 *
 * The perennial iframe problem is height: the parent has to guess, and guesses
 * wrong the moment a table grows or a phone rotates. So an embedded lens page
 * reports its own height to whoever framed it, and the deck resizes to fit.
 *
 * The message carries a height and a URL and nothing else, so posting it to '*'
 * gives nothing away. The parent should still check `event.data.type` before
 * acting, and check `event.origin` if it embeds anything it does not control.
 *
 * Parent side, for a slide deck:
 *
 *   window.addEventListener('message', e => {
 *     if (e.data?.type !== 'learnlens:height') return;
 *     for (const f of document.querySelectorAll('iframe'))
 *       if (f.contentWindow === e.source) f.style.height = e.data.height + 'px';
 *   });
 */

/** Report our height to the framing page, now and whenever it changes. */
export function initEmbedHeight() {
  if (window.parent === window) return;   // not framed — nothing to tell
  let last = 0;
  const post = () => {
    const height = Math.ceil(document.documentElement.scrollHeight);
    if (Math.abs(height - last) < 2) return;   // ignore sub-pixel churn
    last = height;
    window.parent.postMessage({ type: 'learnlens:height', height, url: location.href }, '*');
  };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(post).observe(document.documentElement);
  window.addEventListener('load', post);
  post();
}
