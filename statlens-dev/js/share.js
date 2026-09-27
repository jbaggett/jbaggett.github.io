/**
 * share.js — Share button with URL + SVG QR code dialog.
 *
 * Loaded by page-number.js on every page. Adds a share icon to .header-actions.
 * On click, opens a dialog with two sharing modes:
 *   - "Include current settings" ON  → full URL with all query params (dataset, ci, seed, etc.)
 *   - "Include current settings" OFF → bare tool URL (just the page path)
 *
 * QR code includes the StatLens logo (EC level H for 30% recovery).
 * QR library (qrcode-generator) is lazy-loaded from CDN on first use.
 */

/** This file's own URL, captured at parse time while `currentScript` is valid. */
const SHARE_SCRIPT_SRC = document.currentScript
  ? /** @type {HTMLScriptElement} */ (document.currentScript).src
  : location.href;

(function initShare() {
  const actions = document.querySelector('.header-actions');
  if (!actions) return;

  // Don't show share button in embed mode
  if (document.body?.getAttribute('data-embed') === 'true' ||
      document.documentElement.getAttribute('data-embed') === 'true') return;

  // ─── Share button ───
  const btn = document.createElement('button');
  btn.className = 'share-btn';
  btn.setAttribute('aria-label', 'Share page');
  btn.title = 'Share';
  btn.type = 'button';
  // Share icon (three dots connected by two lines)
  btn.innerHTML = '<svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16"><circle cx="14" cy="4" r="2.5" fill="currentColor"/><circle cx="14" cy="16" r="2.5" fill="currentColor"/><circle cx="4" cy="10" r="2.5" fill="currentColor"/><line x1="6.2" y1="8.9" x2="11.8" y2="5.1" stroke="currentColor" stroke-width="1.5"/><line x1="6.2" y1="11.1" x2="11.8" y2="14.9" stroke="currentColor" stroke-width="1.5"/></svg>';

  // Insert before help button
  const helpBtn = actions.querySelector('.help-btn');
  if (helpBtn) {
    actions.insertBefore(btn, helpBtn);
    actions.insertBefore(document.createTextNode(' '), helpBtn);
  } else {
    actions.appendChild(btn);
  }

  // ─── Dialog ───
  const dialog = document.createElement('dialog');
  dialog.className = 'share-dialog';
  dialog.setAttribute('aria-label', 'Share this page');
  document.body.appendChild(dialog);

  btn.addEventListener('click', () => showShareDialog());

  /** @type {boolean} */
  let qrLibLoaded = false;

  // The loader moved to js/qr.js when Live Rooms needed the same library for an
  // unbranded, projector-sized code (REQ-067).
  //
  // Imported *dynamically*: page-number.js injects this file as a classic
  // <script>, so a top-level `import` is a syntax error and the whole share
  // button disappears site-wide. And the specifier is resolved against this
  // script's own URL, because a bare './qr.js' in a classic script resolves
  // against the *document* — which sits at a different depth on every page.
  async function loadQrLib() {
    const { ensureQrLib } = await import(new URL('./qr.js', SHARE_SCRIPT_SRC).href);
    await ensureQrLib();
    qrLibLoaded = true;
  }

  // StatLens favicon as inline SVG (blue circle + bell curve)
  const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
    <circle cx="16" cy="16" r="15" fill="#569BBD"/>
    <path d="M4 24 C4 24, 8 23, 10 20 C12 17, 13 8, 16 8 C19 8, 20 17, 22 20 C24 23, 28 24, 28 24"
          fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>
  </svg>`;

  // ─── URL helpers ───

  /** Human-readable labels for known URL params */
  const PARAM_LABELS = {
    dataset: 'Dataset',
    data: 'Inline data',
    seed: 'Seed',
    ci: 'CI level',
    direction: 'Direction',
    p: 'Null proportion',
    null_value: 'Null value',
    var: 'Variable',
    x: 'X variable',
    y: 'Y variable',
    group: 'Group variable',
    response: 'Response variable',
    success: 'Success label',
    failure: 'Failure label',
    group1: 'Group 1',
    group2: 'Group 2',
    var1: 'Variable 1',
    var2: 'Variable 2',
    label: 'Label',
    units: 'Units',
    expert: 'Expert mode',
    interpret: 'Show interpretations',
    mode: 'Activity mode',
    activity: 'Activity',
    mu: 'Population mean',
    sigma: 'Population SD',
    n: 'Sample size',
    mean: 'Mean',
    sd: 'Std dev',
    df: 'Degrees of freedom',
    df1: 'df₁',
    df2: 'df₂',
    tail: 'Tail',
    trials: 'Trials',
    prob: 'Probability',
    stat: 'Statistic',
  };

  /** Params that are display/mode-only (not data settings) — excluded from summary */
  const DISPLAY_PARAMS = new Set(['embed', 'guided', 'static', 'readonly']);

  /**
   * Get the base URL (no query params) for the current page.
   * @returns {string}
   */
  function getBaseUrl() {
    return location.origin + location.pathname;
  }

  /**
   * Get current URL params as an array of {key, value, label} objects.
   * Filters out display-only params.
   * @returns {Array<{key: string, value: string, label: string}>}
   */
  function getUrlParams() {
    const params = new URLSearchParams(location.search);
    const result = [];
    for (const [key, value] of params) {
      if (DISPLAY_PARAMS.has(key)) continue;
      result.push({
        key,
        value,
        label: PARAM_LABELS[key] || key,
      });
    }
    return result;
  }

  // ─── Pinned QR ───────────────────────────────────────────────────────
  //
  // An instructor demoing in class wants students to open the tool on their
  // phones and follow along, but does not want to stand at the front waiting
  // for thirty scans before starting. A QR that stays on screen lets him begin
  // immediately and lets students scan whenever they look up.
  //
  // It follows the live URL rather than freezing one. That is the point: a
  // student who scans at minute five lands where the class IS, not where it
  // began. A frozen link would strand late scanners at the start, which is the
  // problem restated.
  //
  // What a link cannot carry is the accumulated run — a scanner gets the same
  // dataset and seed with an empty chart, and clicks +1000 to catch up. With
  // the seed pinned (see share-state.js) their numbers match the projector's.

  const PIN_KEY = 'statlens:qr-pinned';

  function isPinned() {
    try { return localStorage.getItem(PIN_KEY) === '1'; } catch { return false; }
  }

  function setPinned(on) {
    try { localStorage.setItem(PIN_KEY, on ? '1' : '0'); } catch { /* private mode */ }
    renderPin();
  }

  /** Draw, update or remove the pinned panel to match the stored preference. */
  async function renderPin() {
    let panel = document.getElementById('qr-pin');
    if (!isPinned()) { panel?.remove(); return; }
    if (!qrLibLoaded) {
      try { await loadQrLib(); } catch { return; }   // CDN down: no pin, page fine
    }

    if (!panel) {
      panel = document.createElement('aside');
      panel.id = 'qr-pin';
      panel.className = 'qr-pin';
      panel.setAttribute('aria-label', 'Scan to open this page');
      panel.innerHTML = '<div class="qr-pin-code"></div>'
        + '<p class="qr-pin-caption">Scan to open this page</p>'
        + '<button type="button" class="qr-pin-bigger" aria-pressed="false">Bigger</button>'
        + '<button type="button" class="qr-pin-close" aria-label="Remove pinned QR code">\u00d7</button>';
      panel.querySelector('.qr-pin-close')?.addEventListener('click', () => setPinned(false));
      panel.querySelector('.qr-pin-bigger')?.addEventListener('click', (e) => {
        const big = panel.classList.toggle('qr-pin--big');
        const b = /** @type {HTMLElement} */ (e.currentTarget);
        b.setAttribute('aria-pressed', String(big));
        b.textContent = big ? 'Smaller' : 'Bigger';
      });
      document.body.appendChild(panel);
    }

    const url = liveUrl();
    if (panel.dataset.url === url) return;   // nothing moved
    panel.dataset.url = url;
    const code = panel.querySelector('.qr-pin-code');
    const svg = generateQrSvg(url);
    if (code) {
      code.innerHTML = svg
        || '<p class="hint">This link is too long for a QR code.</p>';
    }
  }

  /** The URL a share should point at: the tool's live state, else the address bar. */
  function liveUrl() {
    try {
      const f = /** @type {any} */ (window).__statlensShareUrl;
      if (typeof f === 'function') return f() || location.href;
    } catch { /* fall through */ }
    return location.href;
  }

  // The address bar is kept in step with the tool (js/share-state.js), which
  // announces each change — replaceState fires no event of its own.
  window.addEventListener('statlens:urlchange', () => { renderPin(); });
  // And restore the pin on load, for the instructor who set it last lesson.
  if (isPinned()) renderPin();

  // ─── QR generation ───

  /**
   * A QR for this text, or null when there is no such QR.
   *
   * Too long to encode is a real answer, not an error: a link with a few
   * thousand pasted values cannot be scanned by anyone, and the honest response
   * is to say so and still offer the link to copy.
   *
   * @param {string} text
   * @returns {ReturnType<typeof makeQr>|null}
   */
  function tryMakeQr(text) {
    try { return makeQr(text); } catch { return null; }
  }

  /**
   * Core QR module renderer (shared by display and download versions).
   * @param {string} text
   * @returns {{qr: any, count: number, cellSize: number, margin: number, size: number, qrSize: number, logoSize: number, logoX: number, logoY: number, logoPad: number}}
   */
  function makeQr(text) {
    // @ts-ignore — qrcode is loaded dynamically
    const qr = qrcode(0, 'H');
    qr.addData(text);
    // Throws when the text exceeds what a version-40 code can hold — about 1270
    // bytes at error-correction level H. A URL carrying inline `?data=` reaches
    // that easily (2000 values is ~8000 characters), and both call sites used to
    // let it escape, so the dialog broke instead of saying it could not draw one.
    qr.make();

    const count = qr.getModuleCount();
    const cellSize = 6;
    const margin = cellSize * 2;
    const size = count * cellSize + margin * 2;
    const qrSize = count * cellSize;
    const logoSize = Math.round(qrSize * 0.22);
    const logoX = margin + (qrSize - logoSize) / 2;
    const logoY = margin + (qrSize - logoSize) / 2;
    const logoPad = Math.round(cellSize * 0.6);

    return { qr, count, cellSize, margin, size, qrSize, logoSize, logoX, logoY, logoPad };
  }

  /**
   * Render QR modules as SVG rects, skipping the logo area.
   * @param {ReturnType<typeof makeQr>} q
   * @returns {string}
   */
  function renderModules(q) {
    const { qr, count, cellSize, margin, logoX, logoY, logoSize, logoPad } = q;
    const logoLeft = logoX - logoPad;
    const logoRight = logoX + logoSize + logoPad;
    const logoTop = logoY - logoPad;
    const logoBottom = logoY + logoSize + logoPad;

    let rects = '';
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) {
          const px = col * cellSize + margin;
          const py = row * cellSize + margin;
          if (px + cellSize > logoLeft && px < logoRight &&
              py + cellSize > logoTop && py < logoBottom) continue;
          rects += `<rect x="${px}" y="${py}" width="${cellSize}" height="${cellSize}" fill="#000"/>`;
        }
      }
    }
    return rects;
  }

  /**
   * White circle behind logo.
   * @param {ReturnType<typeof makeQr>} q
   * @returns {string}
   */
  function renderLogoBackground(q) {
    const circR = (q.logoSize + q.logoPad * 2) / 2;
    const circCx = q.logoX + q.logoSize / 2;
    const circCy = q.logoY + q.logoSize / 2;
    return `<circle cx="${circCx}" cy="${circCy}" r="${circR}" fill="#fff"/>`;
  }

  /**
   * Generate display SVG (uses foreignObject for logo — works in browsers).
   * @param {string} text
   * @returns {string}
   */
  function generateQrSvg(text) {
    const q = tryMakeQr(text);
    if (!q) return null;
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${q.size} ${q.size}" width="${q.size}" height="${q.size}" shape-rendering="crispEdges">`;
    svg += `<rect width="${q.size}" height="${q.size}" fill="#fff"/>`;
    svg += renderModules(q);
    svg += renderLogoBackground(q);
    svg += `<foreignObject x="${q.logoX}" y="${q.logoY}" width="${q.logoSize}" height="${q.logoSize}">`;
    svg += `<body xmlns="http://www.w3.org/1999/xhtml" style="margin:0;padding:0;background:transparent">`;
    svg += `<img src="data:image/svg+xml;base64,${btoa(LOGO_SVG)}" width="${q.logoSize}" height="${q.logoSize}" alt="" style="display:block"/>`;
    svg += `</body></foreignObject>`;
    svg += '</svg>';
    return svg;
  }

  /**
   * Generate downloadable SVG (native SVG logo — works standalone).
   * @param {string} text
   * @returns {string}
   */
  function generateDownloadableSvg(text) {
    const q = tryMakeQr(text);
    if (!q) return null;
    let svg = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    svg += `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${q.size} ${q.size}" width="${q.size}" height="${q.size}" shape-rendering="crispEdges">`;
    svg += `<rect width="${q.size}" height="${q.size}" fill="#fff"/>`;
    svg += renderModules(q);
    svg += renderLogoBackground(q);

    // Native SVG logo (scaled from 32x32 viewBox)
    const s = q.logoSize / 32;
    const lx = q.logoX;
    const ly = q.logoY;
    svg += `<circle cx="${lx + 16 * s}" cy="${ly + 16 * s}" r="${15 * s}" fill="#569BBD"/>`;
    svg += `<path d="M${lx + 4 * s} ${ly + 24 * s} C${lx + 4 * s} ${ly + 24 * s}, ${lx + 8 * s} ${ly + 23 * s}, ${lx + 10 * s} ${ly + 20 * s} C${lx + 12 * s} ${ly + 17 * s}, ${lx + 13 * s} ${ly + 8 * s}, ${lx + 16 * s} ${ly + 8 * s} C${lx + 19 * s} ${ly + 8 * s}, ${lx + 20 * s} ${ly + 17 * s}, ${lx + 22 * s} ${ly + 20 * s} C${lx + 24 * s} ${ly + 23 * s}, ${lx + 28 * s} ${ly + 24 * s}, ${lx + 28 * s} ${ly + 24 * s}" fill="none" stroke="#fff" stroke-width="${2.2 * s}" stroke-linecap="round"/>`;

    svg += '</svg>';
    return svg;
  }

  // ─── Dialog ───

  async function showShareDialog() {
    const urlParams = getUrlParams();
    const hasParams = urlParams.length > 0;

    dialog.innerHTML = `
      <h2>Share this page</h2>
      ${hasParams ? `
        <label class="share-toggle">
          <input type="checkbox" class="share-settings-cb" checked>
          <span>Include current settings</span>
        </label>
        <div class="share-param-summary"></div>
      ` : ''}
      <div class="share-url-row">
        <input type="text" class="share-url-input" readonly>
        <button type="button" class="share-copy-btn" title="Copy URL">Copy</button>
      </div>
      <div class="share-qr-container">
        <p class="share-qr-loading">Generating QR code...</p>
      </div>
      <div class="share-actions">
        <button type="button" class="share-pin-btn">Keep QR on screen</button>
        <button type="button" class="share-download-btn" disabled>Download SVG</button>
        <button type="button" class="share-close-btn">Close</button>
      </div>
    `;

    dialog.showModal();

    const urlInput = /** @type {HTMLInputElement} */ (dialog.querySelector('.share-url-input'));
    const copyBtn = /** @type {HTMLButtonElement} */ (dialog.querySelector('.share-copy-btn'));
    const qrContainer = /** @type {HTMLElement} */ (dialog.querySelector('.share-qr-container'));
    const downloadBtn = /** @type {HTMLButtonElement} */ (dialog.querySelector('.share-download-btn'));
    const settingsCb = /** @type {HTMLInputElement|null} */ (dialog.querySelector('.share-settings-cb'));
    const pinBtn = /** @type {HTMLButtonElement} */ (dialog.querySelector('.share-pin-btn'));
    pinBtn.textContent = isPinned() ? 'Remove pinned QR' : 'Keep QR on screen';
    pinBtn.addEventListener('click', () => {
      setPinned(!isPinned());
      pinBtn.textContent = isPinned() ? 'Remove pinned QR' : 'Keep QR on screen';
    });
    const paramSummary = dialog.querySelector('.share-param-summary');

    /** Build the param summary HTML */
    function renderParamSummary(includeSettings) {
      if (!paramSummary || !hasParams) return;
      if (!includeSettings) {
        paramSummary.innerHTML = '<p class="share-param-hint">Students will arrive at the blank tool.</p>';
        return;
      }
      let html = '<table class="share-param-table">';
      for (const p of urlParams) {
        // Truncate long values (e.g., inline data)
        const displayVal = p.value.length > 40 ? p.value.slice(0, 37) + '...' : p.value;
        html += `<tr><td class="share-param-key">${p.label}</td><td class="share-param-val">${escapeHtml(displayVal)}</td></tr>`;
      }
      html += '</table>';
      paramSummary.innerHTML = html;
    }

    /** Get the URL to share based on toggle state */
    function getShareUrl() {
      if (settingsCb && !settingsCb.checked) return getBaseUrl();
      // Prefer the tool's live state where a page publishes it. The address bar
      // is kept in step with it (js/share-state.js), so these normally agree —
      // but asking the tool directly means the dialog is right even in an embed
      // where history.replaceState is blocked and the URL cannot be updated.
      try {
        const live = /** @type {any} */ (window).__statlensShareUrl;
        if (typeof live === 'function') return live() || location.href;
      } catch { /* fall through to the address bar */ }
      return location.href;
    }

    /** Update URL input, QR, and download button */
    async function updateShare() {
      const url = getShareUrl();
      const includeSettings = settingsCb ? settingsCb.checked : false;

      urlInput.value = url;
      renderParamSummary(includeSettings);

      if (!qrLibLoaded) return; // QR not loaded yet, will be set on initial load

      const svg = generateQrSvg(url);
      if (svg) {
        qrContainer.innerHTML = svg;
        downloadBtn.disabled = false;
      } else {
        // A link carrying a few thousand pasted values has no scannable code.
        // Say so, and leave the link itself copyable.
        qrContainer.innerHTML = '<p class="hint" style="max-width:15rem;margin:0">'
          + 'This link is too long for a QR code \u2014 it carries the data itself. '
          + 'Copy the link instead, or host the data at a URL and load it from there.'
          + '</p>';
        downloadBtn.disabled = true;
      }
    }

    // Wire toggle
    if (settingsCb) {
      settingsCb.addEventListener('change', () => updateShare());
    }

    // Wire copy button
    copyBtn.addEventListener('click', () => {
      const url = getShareUrl();
      navigator.clipboard.writeText(url).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
      }).catch(() => {
        urlInput.select();
      });
    });

    // Wire close
    dialog.querySelector('.share-close-btn')?.addEventListener('click', () => dialog.close());

    // Wire download button
    downloadBtn.addEventListener('click', () => {
      const url = getShareUrl();
      const svgStr = generateDownloadableSvg(url);
      if (!svgStr) return;   // nothing to download; the dialog already says why
      const blob = new Blob([svgStr], { type: 'image/svg+xml' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const pageName = location.pathname
        .replace(/\/statlens(-dev)?/, '')
        .replace(/\//g, '-')
        .replace(/^-|-$/g, '') || 'statlens';
      a.download = `${pageName}-qr.svg`;
      a.click();
      URL.revokeObjectURL(a.href);
    });

    // Set initial state
    urlInput.value = getShareUrl();
    renderParamSummary(hasParams);

    // Load QR library and generate
    try {
      await loadQrLib();
      await updateShare();
    } catch {
      qrContainer.innerHTML = '<p class="share-qr-error">Could not generate QR code (no internet?)</p>';
    }
  }

  /**
   * @param {string} str
   * @returns {string}
   */
  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Close on backdrop click
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
})();
