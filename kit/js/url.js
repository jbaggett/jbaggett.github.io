/**
 * URL parameters — the contract between a lens and everything that links to it.
 *
 * Once a parameter name ships in a slide, a textbook page or a homework link it
 * can never be renamed or removed, only added to. Every name here is documented
 * in docs/url-api.md; add the doc entry in the same commit as the parameter.
 */

/**
 * Read the page's URL parameters.
 *
 * These are a CONTRACT with the textbook and with MyOpenMath, exactly as in
 * StatLens: once a name ships in a link inside course material, it can never be
 * renamed or removed — only added to. Document every new one in
 * `calclens/docs/url-api.md` before shipping it.
 *
 * @returns {{f:string|null, a:number|null, b:number|null, mode:string|null, embed:boolean, seed:string|null, raw:URLSearchParams}}
 */
export function getParams() {
  const q = new URLSearchParams(location.search);
  const numOr = (/** @type {string} */ k) => {
    const v = q.get(k);
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    f: q.get('f'),
    a: numOr('a'),
    b: numOr('b'),
    mode: q.get('mode'),
    embed: q.get('embed') === 'true',
    seed: q.get('seed'),
    raw: q,
  };
}

/** Reflect current state into the address bar without adding history entries. */
export function updateUrl(/** @type {Record<string, string|number|null>} */ updates) {
  const q = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(updates)) {
    if (v === null || v === '') q.delete(k);
    else q.set(k, String(v));
  }
  const qs = q.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}
