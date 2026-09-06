/**
 * The CalcLens mark: a white integral sign in the IMS blue circle.
 *
 * Sibling to StatLens's bell curve in the same circle, and `#569BBD` is not an
 * arbitrary blue — it is the same value both lenses already render for `h1`, so
 * the mark and the design tokens are one system.
 *
 * Drawn as a `<path>`, not a `<text>` glyph. A typographic integral renders
 * differently on every machine and does not rasterise reliably to a favicon,
 * and the bell curve is a path for exactly the same reason.
 *
 * It is also drawn WIDER than a typographic integral — the sweep spans about
 * two thirds of its height where a text glyph is far narrower. At 22% of a QR
 * code a true integral reads as a stray stroke rather than a symbol.
 */
export const MARK = {
  viewBox: '0 0 32 32',
  svg:
    '<circle cx="16" cy="16" r="15" fill="#569BBD"/>'
    + '<path d="M22.3 9.2 C22.3 5.2 17.4 4.8 16.8 9.1 C15.9 14.6 16.1 17.6 15.2 23 '
    + 'C14.5 27.2 9.7 26.8 9.7 22.7" fill="none" stroke="#fff" stroke-width="2.6" '
    + 'stroke-linecap="round"/>',
};

/** The same mark as a standalone SVG document, for favicons and downloads. */
export const MARK_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK.viewBox}">${MARK.svg}</svg>`;
