/**
 * share.js — the share panel: a QR code, and the link behind it.
 *
 * Loaded by page-number.js on every page. Adds a share icon to
 * .header-actions; clicking it opens a panel in the bottom-right corner
 * showing the code at full size. It stays until dismissed with the ×, so an
 * instructor can start the lesson while the room scans rather than standing at
 * the front waiting for thirty phones.
 *
 * **More options** expands the panel to show the link itself, a Copy button, a
 * summary of what the link carries, and a Download SVG button. "Include
 * current settings" off gives the bare tool URL, for a class starting clean.
 *
 * This replaced a modal dialog (2026-09-27). The modal showed the same code and
 * the same link, but had to be dismissed before anyone could watch you use the
 * page — the opposite of what a demo wants.
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

  // Sharing is one surface now: the panel in the corner. Clicking Share opens
  // it; the × closes it. There is no modal in between, because the modal only
  // ever existed to show the same code and the same link — and a modal has to
  // be dismissed before the class can watch you do anything, which is the
  // opposite of what a lesson wants. (Jeff, 2026-09-27.)
  btn.addEventListener('click', () => {
    if (isPinned()) {
      // Already up: bring the code back to full size rather than doing nothing.
      setBig(true);
      const panel = document.getElementById('qr-pin');
      if (panel) { panel.classList.add('qr-pin--big'); syncSizeButton(panel, true); }
      return;
    }
    setBig(true);
    setPinned(true);
  });

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
    view: 'Layout',
    tab: 'Tab',
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
   * Get the shared link's params as an array of {key, value, label} objects.
   * Filters out display-only params.
   *
   * Reads the LINK, not the address bar. They are normally the same — the tool
   * keeps the address bar equal to its state (js/share-state.js) — but a page
   * may hold state it deliberately does not write on arrival: the landing page
   * leaves the bare home URL bare and still shares which layout and tab you
   * are on. Reading `location.search` there printed "Nothing is set yet" under
   * a link that carried two settings, which is the one thing this table is for.
   * (2026-10-02.)
   * @returns {Array<{key: string, value: string, label: string}>}
   */
  function getUrlParams() {
    let search = location.search;
    try { search = new URL(liveUrl()).search; } catch { /* keep the address bar */ }
    const params = new URLSearchParams(search);
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
  /**
   * Pinned codes start BIG (Jeff, 2026-09-27). The pin exists to be scanned
   * from across a room while the instructor gets on with the lesson, and a
   * 116px code on a projector is not scannable from row three. Smaller is one
   * click away, and remembered for whoever prefers it on a laptop.
   */
  const SIZE_KEY = 'statlens:qr-pin-size';

  function isBig() {
    try { return localStorage.getItem(SIZE_KEY) !== 'small'; } catch { return true; }
  }

  function setBig(big) {
    try { localStorage.setItem(SIZE_KEY, big ? 'big' : 'small'); } catch { /* private mode */ }
  }

  function isPinned() {
    try { return localStorage.getItem(PIN_KEY) === '1'; } catch { return false; }
  }

  function setPinned(on) {
    try { localStorage.setItem(PIN_KEY, on ? '1' : '0'); } catch { /* private mode */ }
    renderPin();
  }

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

  /** Guards renderPanel against itself — see the note below. */
  let pinRendering = false;

  /** Is the options section open? Panel-lifetime only; not worth remembering. */
  let optionsOpen = false;

  /**
   * Draw, update or remove the share panel.
   *
   * Re-entrant by nature: a page that loads with the panel pinned calls this
   * once on load and again on the first URL sync, and both await the QR
   * library. Without the flag both calls got past the "does a panel exist?"
   * check while the import was in flight, and both appended one — two stacked
   * panels sharing an id.
   */
  async function renderPin() {
    if (pinRendering) return;
    let panel = document.getElementById('qr-pin');
    if (!isPinned()) { panel?.remove(); return; }
    if (!qrLibLoaded) {
      pinRendering = true;
      try { await loadQrLib(); } catch { return; }   // CDN down: no panel, page fine
      finally { pinRendering = false; }
      if (!isPinned()) return;
      panel = document.getElementById('qr-pin');
    }

    if (!panel) {
      panel = document.createElement('aside');
      panel.id = 'qr-pin';
      panel.className = 'qr-pin';
      panel.setAttribute('aria-label', 'Share this page');
      panel.innerHTML = `
        <button type="button" class="qr-pin-close" aria-label="Close">\u00d7</button>
        <div class="qr-pin-code"></div>
        <p class="qr-pin-caption">Scan to open this page</p>
        <div class="qr-pin-links">
          <button type="button" class="qr-pin-bigger"></button>
          <button type="button" class="qr-pin-more" aria-expanded="false">More options</button>
        </div>
        <div class="qr-pin-options" hidden>
          <label class="share-toggle">
            <input type="checkbox" class="share-settings-cb" checked>
            <span>Include current settings</span>
          </label>
          <div class="share-param-summary"></div>
          <div class="share-url-row">
            <input type="text" class="share-url-input" readonly aria-label="Link to this page">
            <button type="button" class="share-copy-btn" title="Copy link">Copy</button>
          </div>
          <button type="button" class="share-download-btn">Download SVG</button>
        </div>`;
      wirePanel(panel);
      document.body.appendChild(panel);

      const big = isBig();
      panel.classList.toggle('qr-pin--big', big);
      syncSizeButton(panel, big);
    }

    drawPanel(panel);
  }

  /** One-time wiring for a freshly built panel. */
  function wirePanel(panel) {
    panel.querySelector('.qr-pin-close')?.addEventListener('click', () => setPinned(false));

    panel.querySelector('.qr-pin-bigger')?.addEventListener('click', () => {
      const big = panel.classList.toggle('qr-pin--big');
      setBig(big);
      syncSizeButton(panel, big);
    });

    const moreBtn = panel.querySelector('.qr-pin-more');
    moreBtn?.addEventListener('click', () => {
      optionsOpen = !optionsOpen;
      const opts = panel.querySelector('.qr-pin-options');
      if (opts) /** @type {HTMLElement} */ (opts).hidden = !optionsOpen;
      moreBtn.textContent = optionsOpen ? 'Fewer options' : 'More options';
      moreBtn.setAttribute('aria-expanded', String(optionsOpen));
      panel.classList.toggle('qr-pin--open', optionsOpen);
      drawPanel(panel);
    });

    // "Include current settings" off — the bare tool, for a class starting clean.
    panel.querySelector('.share-settings-cb')?.addEventListener('change', () => drawPanel(panel));

    panel.querySelector('.share-copy-btn')?.addEventListener('click', (e) => {
      const b = /** @type {HTMLElement} */ (e.currentTarget);
      const input = /** @type {HTMLInputElement|null} */ (panel.querySelector('.share-url-input'));
      navigator.clipboard.writeText(panelUrl(panel)).then(() => {
        b.textContent = 'Copied!';
        setTimeout(() => { b.textContent = 'Copy'; }, 2000);
      }).catch(() => { input?.select(); });
    });

    panel.querySelector('.share-download-btn')?.addEventListener('click', () => {
      const svgStr = generateDownloadableSvg(panelUrl(panel));
      if (!svgStr) return;   // nothing to download; the panel already says why
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
  }

  /** @param {HTMLElement} panel @param {boolean} big */
  function syncSizeButton(panel, big) {
    const b = /** @type {HTMLElement|null} */ (panel.querySelector('.qr-pin-bigger'));
    if (!b) return;
    b.textContent = big ? 'Smaller' : 'Bigger';
    b.setAttribute('aria-pressed', String(big));
  }

  /** The URL this panel is currently offering. */
  function panelUrl(panel) {
    const cb = /** @type {HTMLInputElement|null} */ (panel.querySelector('.share-settings-cb'));
    return (cb && !cb.checked) ? getBaseUrl() : liveUrl();
  }

  /** Redraw the code, the link and the parameter summary. */
  function drawPanel(panel) {
    const url = panelUrl(panel);
    const code = panel.querySelector('.qr-pin-code');
    const input = /** @type {HTMLInputElement|null} */ (panel.querySelector('.share-url-input'));
    const dl = /** @type {HTMLButtonElement|null} */ (panel.querySelector('.share-download-btn'));
    if (input) input.value = url;
    if (panel.dataset.url !== url) {
      const svg = generateQrSvg(url);
      if (code) {
        code.innerHTML = svg || '<p class="qr-pin-toolong">This link carries the data itself, '
          + 'so it is too long for a QR code. Copy the link instead, or host the data at a URL.</p>';
      }
      if (dl) dl.disabled = !svg;
      panel.dataset.url = url;
    }
    const summary = panel.querySelector('.share-param-summary');
    if (summary && optionsOpen) {
      const cb = /** @type {HTMLInputElement|null} */ (panel.querySelector('.share-settings-cb'));
      renderParamSummary(/** @type {HTMLElement} */ (summary), !cb || cb.checked);
    }
  }

  /**
   * The table of what a shared link carries, so an instructor can see at a
   * glance whether they are sending a configured tool or a blank one.
   *
   * @param {HTMLElement} into
   * @param {boolean} includeSettings
   */
  function renderParamSummary(into, includeSettings) {
    const params = getUrlParams();
    if (!includeSettings || params.length === 0) {
      into.innerHTML = '<p class="share-param-hint">'
        + (includeSettings ? 'Nothing is set yet — this is the blank tool.'
                           : 'Students will arrive at the blank tool.')
        + '</p>';
      return;
    }
    let html = '<table class="share-param-table">';
    for (const p of params) {
      const displayVal = p.value.length > 40 ? p.value.slice(0, 37) + '...' : p.value;
      html += `<tr><td class="share-param-key">${p.label}</td><td class="share-param-val">${escapeHtml(displayVal)}</td></tr>`;
    }
    html += '</table>';
    into.innerHTML = html;
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
  // And restore the panel on load, for the instructor who set it last lesson.
  if (isPinned()) renderPin();

  /**
   * @param {string} str
   * @returns {string}
   */
  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

})();
