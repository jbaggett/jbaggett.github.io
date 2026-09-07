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
/**
 * The preset in force, if any. `updateUrl` consults it so that expanding a
 * preset does not immediately un-shorten the address bar.
 * @type {Record<string,string|number>|null}
 */
let activePreset = null;

export function getParams(presets) {
  const q = new URLSearchParams(location.search);
  // `?preset=<key>` expands a named preset into the parameters it stands for.
  //
  // This exists for QR codes. A fully spelled-out lecture link runs to ~126
  // characters, and percent-encoding makes it worse than it reads (`%5E`,
  // `%2F`, `%2B` are three characters each where the source is one) — which
  // pushes the code to 49x49 modules, or 61x61 once error-correction level H
  // makes room for the centre mark. `?p=ball` gets the same state in a third of
  // the length, and a QR scanned from the back of a lecture room lives or dies
  // on module size.
  //
  // Presets carry CONTENT only — the function, the point, the window — never
  // presentation. A slide adds `&embed=true&controls=...` itself, so the same
  // preset serves the projected figure and the phone a student opens.
  //
  // An explicitly given parameter always wins over the preset's value.
  const key = q.get('preset');
  if (key && presets && Object.prototype.hasOwnProperty.call(presets, key)) {
    activePreset = presets[key];
    for (const [k, v] of Object.entries(presets[key])) {
      if (!q.has(k)) q.set(k, String(v));
    }
  }
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
    // A value the preset already stands for is dropped rather than written.
    // Otherwise the first render expands `?preset=ball` back into the full
    // parameter list, the address bar grows to 120 characters, and the QR code
    // the preset existed to shrink is dense again.
    if (activePreset && Object.prototype.hasOwnProperty.call(activePreset, k)
        && v !== null && String(v) === String(activePreset[k])) {
      q.delete(k);
      continue;
    }
    if (v === null || v === '') q.delete(k);
    else q.set(k, String(v));
  }
  const qs = q.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}
