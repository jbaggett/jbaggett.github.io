/**
 * Share button: the page's URL, and a QR code for it.
 *
 * Ported from StatLens `js/share.js`, which had already solved the parts that
 * are easy to get wrong, with one substantive change: **the QR library is
 * vendored, not fetched from a CDN.** StatLens lazy-loaded it from jsDelivr,
 * which would fail silently in a lecture room with no network — exactly where
 * a projected QR is being scanned by thirty phones.
 *
 * What carries over from StatLens:
 *   - error-correction level H, which is what buys the ~30% recovery a centre
 *     logo needs;
 *   - the mark at 22% of the QR, with the modules underneath SKIPPED rather
 *     than painted over, so the scanner is never asked to read a module that
 *     the logo has covered;
 *   - SVG output, because a QR on a projector or in a printed handout wants to
 *     be vector.
 *
 * The mark itself is per-lens: CalcLens puts an integral in the blue circle
 * where StatLens puts a bell curve.
 */

/** The vendored UMD script, resolved relative to THIS module so depth is irrelevant. */
const QR_SRC = new URL('../vendor/qrcode/qrcode.js', import.meta.url).href;

let qrLoading = null;

function loadQr() {
  if (/** @type {any} */ (window).qrcode) return Promise.resolve();
  if (qrLoading) return qrLoading;
  qrLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = QR_SRC;
    s.onload = () => resolve(undefined);
    s.onerror = () => reject(new Error('QR library failed to load'));
    document.head.appendChild(s);
  });
  return qrLoading;
}

/**
 * Build the QR geometry. Everything downstream derives from this, so the
 * on-screen and downloaded versions cannot drift apart.
 * @param {string} text
 */
function makeQr(text) {
  const qr = /** @type {any} */ (window).qrcode(0, 'H');
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  const cellSize = 6;
  const margin = cellSize * 2;
  const qrSize = count * cellSize;
  const size = qrSize + margin * 2;
  const logoSize = Math.round(qrSize * 0.22);
  const logoX = margin + (qrSize - logoSize) / 2;
  const logoY = logoX;
  const logoPad = Math.round(cellSize * 0.6);
  return { qr, count, cellSize, margin, size, qrSize, logoSize, logoX, logoY, logoPad };
}

/** Modules as rects, skipping the square the mark will occupy. */
function renderModules(q) {
  const { qr, count, cellSize, margin, logoX, logoY, logoSize, logoPad } = q;
  const l = logoX - logoPad, r = logoX + logoSize + logoPad;
  const t = logoY - logoPad, b = logoY + logoSize + logoPad;
  let rects = '';
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (!qr.isDark(row, col)) continue;
      const px = col * cellSize + margin, py = row * cellSize + margin;
      if (px + cellSize > l && px < r && py + cellSize > t && py < b) continue;
      rects += `<rect x="${px}" y="${py}" width="${cellSize}" height="${cellSize}"/>`;
    }
  }
  return rects;
}

/**
 * The complete QR as an SVG string, mark included.
 * The mark is inlined as a nested <svg>, not an <image>, so the result is one
 * self-contained file that survives being downloaded and dropped into a slide.
 */
function qrSvg(text, mark) {
  const q = makeQr(text);
  const cx = q.logoX + q.logoSize / 2;
  const cy = q.logoY + q.logoSize / 2;
  const r = (q.logoSize + q.logoPad * 2) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${q.size} ${q.size}" `
    + `width="${q.size}" height="${q.size}" shape-rendering="crispEdges" role="img" `
    + `aria-label="QR code linking to this page">`
    + `<rect width="${q.size}" height="${q.size}" fill="#fff"/>`
    + `<g fill="#000">${renderModules(q)}</g>`
    + `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff"/>`
    + `<svg x="${q.logoX}" y="${q.logoY}" width="${q.logoSize}" height="${q.logoSize}" `
    + `viewBox="${mark.viewBox}" shape-rendering="geometricPrecision">${mark.svg}</svg>`
    + `</svg>`;
}

/**
 * Wire the share button.
 *
 * @param {{mark: {viewBox: string, svg: string}, name?: string}} opts
 */
export function initShare(opts) {
  const btn = document.querySelector('.share-btn');
  if (!btn) return;
  const name = opts.name || 'this page';

  const dialog = document.createElement('dialog');
  dialog.className = 'll-help-dialog ll-share-dialog';
  dialog.setAttribute('aria-label', 'Share this page');
  dialog.innerHTML = `
    <h2>Share</h2>
    <p class="ll-hint">This link carries everything currently on screen — the
       function, the values, the settings. Anyone opening it sees what you see.</p>
    <label for="ll-share-url" class="sr-only">Link to this page</label>
    <input type="text" id="ll-share-url" readonly>
    <div class="ll-row" style="margin:0.6rem 0;">
      <button type="button" id="ll-copy" class="ll-primary">Copy link</button>
      <button type="button" id="ll-dl">Download QR (SVG)</button>
      <span id="ll-copied" class="ll-hint" role="status" aria-live="polite"></span>
    </div>
    <div id="ll-qr" class="ll-qr"></div>
    <p class="ll-hint" id="ll-qr-note"></p>
    <button type="button" data-close>Close</button>`;
  document.body.appendChild(dialog);

  const urlField = /** @type {HTMLInputElement} */ (dialog.querySelector('#ll-share-url'));
  const qrBox = dialog.querySelector('#ll-qr');
  const note = dialog.querySelector('#ll-qr-note');

  async function open() {
    const url = location.href;
    urlField.value = url;
    qrBox.innerHTML = '<span class="ll-hint">Building QR…</span>';
    dialog.showModal();
    try {
      await loadQr();
      qrBox.innerHTML = qrSvg(url, opts.mark);
      const modules = qrBox.querySelector('svg').getAttribute('viewBox').split(' ')[2];
      // Density is the thing that decides whether this scans from the back of a
      // room, so say it rather than leaving the author to squint at it.
      const count = Math.round((Number(modules) - 24) / 6);
      note.textContent = `${count} x ${count} modules. Shorter links make a sparser code — `
        + `see the p= preset parameter if this is going on a projected slide.`;
    } catch {
      qrBox.innerHTML = '<p class="ll-error">The QR library did not load, so no code '
        + 'could be drawn. The link above still works.</p>';
      note.textContent = '';
    }
  }

  btn.addEventListener('click', open);
  dialog.querySelectorAll('[data-close]').forEach(b =>
    b.addEventListener('click', () => dialog.close()));

  dialog.querySelector('#ll-copy').addEventListener('click', async () => {
    const said = dialog.querySelector('#ll-copied');
    try {
      await navigator.clipboard.writeText(urlField.value);
      said.textContent = 'Copied.';
    } catch {
      // Clipboard access is refused in plenty of ordinary situations; select
      // the text so the reader can copy it themselves rather than being told
      // nothing happened.
      urlField.select();
      said.textContent = 'Press Ctrl+C to copy.';
    }
    setTimeout(() => { said.textContent = ''; }, 3000);
  });

  dialog.querySelector('#ll-dl').addEventListener('click', () => {
    const svg = qrBox.querySelector('svg');
    if (!svg) return;
    const blob = new Blob([svg.outerHTML], { type: 'image/svg+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(document.title.split('|')[0] || name).trim().toLowerCase().replace(/\W+/g, '-')}-qr.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
}
