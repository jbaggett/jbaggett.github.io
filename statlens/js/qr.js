// @ts-check
/**
 * QR generation, shared.
 *
 * `js/share.js` renders a *branded* code — StatLens mark in the middle, high
 * error correction to make room for it — which is right for a link an
 * instructor sends to one person. A room code projected at a lecture hall wants
 * the opposite: no logo, maximum contrast, scannable from the back row by a
 * phone held at an angle. Both need the same library loaded the same way, so
 * the loader lives here and each caller draws what it needs.
 */

/** @type {Promise<void>|null} */
let loading = null;

/** Load qrcode-generator once per page, from the CDN StatLens already uses. */
export function ensureQrLib() {
  if (typeof window !== 'undefined' && typeof window['qrcode'] !== 'undefined') {
    return Promise.resolve();
  }
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js';
      script.onload = () => resolve();
      script.onerror = () => {
        loading = null;   // let a later attempt retry rather than fail forever
        reject(new Error('Failed to load QR library'));
      };
      document.head.appendChild(script);
    });
  }
  return loading;
}

/**
 * A plain black-on-white QR, no logo.
 *
 * Error correction is 'M' rather than the branded renderer's 'H': with no logo
 * punched out of the middle there is nothing to compensate for, and the lower
 * level means fewer, larger modules — which is what actually matters for a code
 * being read across a room.
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {number} [opts.cellSize] - px per module in the viewBox
 * @returns {string} SVG markup
 */
export function plainQrSvg(text, opts = {}) {
  const cell = opts.cellSize ?? 8;
  // @ts-ignore — loaded by ensureQrLib
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();

  const count = qr.getModuleCount();
  const margin = cell * 2;                 // the quiet zone scanners require
  const size = count * cell + margin * 2;

  let rects = '';
  for (let r = 0; r < count; r++) {
    // Run-length the dark modules along each row: one <rect> per run instead of
    // one per module keeps a 40-ish module code from becoming 1,600 elements.
    let runStart = -1;
    for (let c = 0; c <= count; c++) {
      const dark = c < count && qr.isDark(r, c);
      if (dark && runStart < 0) runStart = c;
      if (!dark && runStart >= 0) {
        rects += `<rect x="${margin + runStart * cell}" y="${margin + r * cell}" `
          + `width="${(c - runStart) * cell}" height="${cell}"/>`;
        runStart = -1;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" `
    + `shape-rendering="crispEdges" role="img" aria-label="QR code to join the room">`
    + `<rect width="${size}" height="${size}" fill="#fff"/>`
    + `<g fill="#000">${rects}</g></svg>`;
}
