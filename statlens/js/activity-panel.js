// @ts-check
/**
 * Activity Panel — loads step-by-step guided activities from JSON.
 *
 * When ?activity=URL is present, fetches the JSON and renders an
 * instruction panel alongside the tool. Desktop: left side panel.
 * Mobile: bottom sheet with floating action button.
 *
 * Activity JSON params are injected as URL defaults (existing URL
 * params take precedence) so the calling URL can be simple:
 *   ?activity=bootstrap-explore.json
 */

(function initActivityPanel() {
  const params = new URLSearchParams(location.search);
  const activityUrl = params.get('activity');
  if (!activityUrl) return;

  // page-number.js already fetched the activity JSON and injected params into
  // the URL (REQ-020 race condition fix). Reuse that promise if available;
  // otherwise fall back to fetching ourselves.
  const activityPromise = window.__activityParamsReady || (() => {
    const resolvedUrl = resolveActivityUrl(activityUrl);
    return fetch(resolvedUrl)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(activity => { applyDefaultParams(activity.params || {}); return activity; });
  })();

  activityPromise
    .then(activity => {
      if (!activity) return; // fetch failed in page-number.js
      // Params already injected by page-number.js; just trigger dataset load and render UI
      triggerDatasetLoad(activity.params || {});
      renderPanel(activity);
    })
    .catch(err => {
      console.warn('Activity panel: failed to load', err);
    });

  /**
   * Resolve an activity URL. Supports:
   * - Absolute URLs (https://...)
   * - Root-relative (/activities/foo.json)
   * - Bare filenames (foo.json → ../../activities/foo.json)
   */
  function resolveActivityUrl(url) {
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    if (url.startsWith('/')) return url;
    // Bare filename — resolve relative to StatLens activities/ dir
    const link = document.querySelector('link[rel="stylesheet"][href*="style.css"]');
    if (link) {
      const href = link.getAttribute('href') || '';
      const prefix = href.replace(/css\/style\.css$/, '');
      return `${prefix}activities/${url}`;
    }
    return `/activities/${url}`;
  }

  /**
   * Inject activity params as URL defaults. Existing URL params win.
   * This lets the activity JSON specify dataset, ci, seed, etc.
   * without requiring them in the textbook's link URL.
   */
  function applyDefaultParams(defaults) {
    const current = new URLSearchParams(location.search);
    let changed = false;
    for (const [key, value] of Object.entries(defaults)) {
      if (key === 'activity') continue; // don't recurse
      if (!current.has(key)) {
        current.set(key, String(value));
        changed = true;
      }
    }
    if (changed) {
      history.replaceState(null, '', '?' + current.toString());
    }
  }

  /**
   * After params are in the URL, apply non-dataset params that the page may
   * have already read before injection (e.g., CI level).
   *
   * Dataset loading is handled by initDataPanel which now awaits
   * __activityParamsReady before reading URL params (REQ-020 fix).
   * This function only handles params that initDataPanel doesn't cover.
   */
  function triggerDatasetLoad(defaults) {
    // Set CI level if specified (page already parsed URL before our params were injected)
    if (defaults.ci) {
      const ciSel = /** @type {HTMLSelectElement|null} */ (document.getElementById('ci-level'));
      if (ciSel) {
        ciSel.value = String(defaults.ci);
        ciSel.dispatchEvent(new Event('change'));
      }
    }
  }

  /**
   * Simple inline markdown: **bold**, *italic*, `code`, ![alt](src), [text](url)
   */
  function md(text) {
    if (!text) return '';
    return text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      // Images first — ![alt](src) — so the link rule below doesn't swallow the [alt](src) tail.
      // An "Enlarge" button (magnifying-glass-with-+ icon) sits ABOVE the image;
      // clicking it or the image opens a full-screen lightbox (wired in render()).
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g,
        '<span class="activity-img-wrap">'
        + '<button type="button" class="activity-img-zoom">'
        + '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
        + '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>'
        + '<span>Enlarge</span></button>'
        + '<img class="activity-img" src="$2" alt="$1" loading="lazy" title="Enlarge">'
        + '</span>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }

  /**
   * Current activity mode: 'discover' (gates block) or 'present' (gates render
   * as discussion prompts). URL ?mode= wins; falls back to the data-mode body
   * attribute set by applySettings(); defaults to discover.
   * (Plain script — can't import settings.js, so read the published state.)
   */
  function getMode() {
    const urlMode = new URLSearchParams(location.search).get('mode');
    if (urlMode === 'present' || urlMode === 'discover') return urlMode;
    const bodyMode = document.body.getAttribute('data-mode');
    if (bodyMode === 'present' || bodyMode === 'discover') return bodyMode;
    return 'discover';
  }

  /**
   * Demo registry — named, self-contained animated illustrations that steps
   * can open in a popup via `"demo": { "type": "...", ... }`.
   * Allowlist only: activity JSON can be hosted anywhere, so the type must
   * map to a known local module (never a path from the JSON).
   */
  const DEMOS = {
    'card-shuffle': 'js/demos/card-shuffle.js',
  };

  /** Resolve a repo-root-relative path the same way activity URLs resolve. */
  function rootPath(rel) {
    const link = document.querySelector('link[rel="stylesheet"][href*="style.css"]');
    const prefix = link ? (link.getAttribute('href') || '').replace(/css\/style\.css$/, '') : '/';
    return new URL(prefix + rel, location.href).href;
  }

  /**
   * Open a demo in a modal dialog and play it.
   * `static: true` shows the demo's initial render only — no auto-play, no
   * Play-again button (e.g. "see the data as cards" before any shuffling).
   * @param {{ type: string, label?: string, static?: boolean, options?: object }} demo
   */
  async function openDemo(demo) {
    const modulePath = DEMOS[demo.type];
    if (!modulePath) { console.warn(`Activity demo: unknown type "${demo.type}"`); return; }

    const dialog = document.createElement('dialog');
    dialog.className = 'activity-demo-dialog';
    dialog.setAttribute('aria-label', demo.label || 'Demonstration');
    dialog.innerHTML = `
      <div class="demo-stage"><p class="demo-loading">Loading…</p></div>
      <div class="demo-actions">
        ${demo.static ? '' : '<button type="button" class="demo-play-btn">▶ Play again</button>'}
        <button type="button" class="demo-close-btn">Close</button>
      </div>
    `;
    document.body.appendChild(dialog);
    dialog.addEventListener('close', () => dialog.remove());
    dialog.querySelector('.demo-close-btn')?.addEventListener('click', () => dialog.close());
    dialog.showModal();

    try {
      const mod = await import(rootPath(modulePath));
      const stage = /** @type {HTMLElement} */ (dialog.querySelector('.demo-stage'));
      const instance = mod.mount(stage, demo.options || {});
      dialog.addEventListener('close', () => instance.destroy());
      dialog.querySelector('.demo-play-btn')?.addEventListener('click', () => instance.play());
      // Let the mounted layout paint before the first play
      if (!demo.static) setTimeout(() => instance.play(), 400);
    } catch (err) {
      console.warn('Activity demo: failed to load', err);
      const stage = dialog.querySelector('.demo-stage');
      if (stage) stage.innerHTML = '<p>Sorry — this demonstration could not be loaded.</p>';
    }
  }

  /**
   * @typedef {object} GateChoice
   * @property {string} text
   * @property {boolean} [correct] - Mark exactly the right answer(s). If NO
   *   choice is marked correct, the gate is a *prediction* gate: any committed
   *   answer unlocks the step (committing is what does the pedagogical work).
   * @property {string} [feedback] - Per-choice feedback (overrides gate-level)
   *
   * @typedef {object} GateSpec
   * @property {string} question
   * @property {GateChoice[]} choices
   * @property {string} [feedback] - Shown after a passing commit
   * @property {string} [retryFeedback] - Shown after an incorrect pick (check gates)
   */

  /**
   * Build and insert the activity panel into the DOM.
   * @typedef {object} StepRequires
   * @property {string} metric - Live-state metric name (from a `statlens:state` event)
   * @property {number} [atLeast] - Unlock when metric >= this
   * @property {number} [atMost] - Unlock when metric <= this
   * @property {number} [equals] - Unlock when metric === this
   * @property {string} [hint] - Shown while locked ("Draw at least 100 samples")
   * @property {boolean} [autoAdvance] - Advance automatically once satisfied
   *
   * @param {{ title: string, steps: Array<{instruction: string, observe?: string, reveal?: string, gate?: GateSpec, requires?: StepRequires, demo?: {type: string, label?: string, options?: object}}> }} activity
   */
  function renderPanel(activity) {
    const steps = activity.steps || [];
    if (steps.length === 0) return;

    let currentStep = 0;
    /** @type {Set<number>} */
    const revealed = new Set();
    /** @type {Map<number, {chosen: number, passed: boolean}>} */
    const gateState = new Map();
    const present = getMode() === 'present';

    // ─── Live tool state (REQ-034: action-gates + result-aware feedback) ──────
    // Tools dispatch `statlens:state` CustomEvents carrying a flat `state` bag of
    // named metrics (see the event contract in docs/activity-authoring-guide.md).
    // A step can require a metric threshold before "Next" unlocks (`requires`),
    // and any text can interpolate metrics via {{metric}} (double braces so they
    // never collide with LaTeX `\hat{p}` / `\frac{}{}`).
    /** @type {Record<string, any>} */
    let liveState = {};

    /** Format a metric for display: round floats to 3 dp, pass strings through. */
    function fmtMetric(v) {
      if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
      return v == null ? '' : String(v);
    }
    /** Replace {{metric}} tokens with current live values. */
    function interp(text) {
      if (typeof text !== 'string' || !text.includes('{{')) return text;
      return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key) => (key in liveState ? fmtMetric(liveState[key]) : m));
    }
    /** Is a step's `requires` action-gate currently satisfied? */
    function requiresMet(step) {
      const req = step && step.requires;
      if (!req || present) return true; // presentation mode never blocks
      const val = Number(liveState[req.metric]);
      if (!Number.isFinite(val)) return false; // metric not reported yet
      if (typeof req.atLeast === 'number') return val >= req.atLeast;
      if (typeof req.atMost === 'number') return val <= req.atMost;
      if (typeof req.equals === 'number') return val === req.equals;
      return true;
    }
    /** Does the current step read live state (so a state event should re-render)? */
    function stepUsesState(step) {
      if (!step) return false;
      if (step.requires) return true;
      if (['instruction', 'observe', 'reveal'].some(f => typeof step[f] === 'string' && step[f].includes('{{'))) return true;
      return !!step.gate && JSON.stringify(step.gate).includes('{{');
    }

    window.addEventListener('statlens:state', (e) => {
      const detail = /** @type {CustomEvent} */ (e).detail;
      if (!detail || typeof detail.state !== 'object' || detail.state === null) return;
      liveState = detail.state;
      const step = steps[currentStep];
      if (!stepUsesState(step)) return;
      // Auto-advance when an action-gate is satisfied (opt-in, and only if no gate blocks).
      const gatePassed = !step.gate || !!gateState.get(currentStep)?.passed;
      if (step.requires?.autoAdvance && requiresMet(step) && gatePassed && currentStep < steps.length - 1) {
        currentStep++;
      }
      render();
    });
    // Ask the tool to broadcast its current state now, so steps that read state
    // are correct on load (not just after the next action). Tools that emit
    // `statlens:state` should answer `statlens:request-state` with a fresh emit.
    try { window.dispatchEvent(new CustomEvent('statlens:request-state')); } catch { /* no CustomEvent */ }

    // Mark body so CSS can adjust layout
    document.body.setAttribute('data-activity', 'true');
    // Also hide data panel and controls row
    document.body.setAttribute('data-guided', 'true');

    // ─── Desktop side panel ──────────────────────────────────────
    const panel = document.createElement('aside');
    panel.className = 'activity-panel';
    panel.setAttribute('aria-label', 'Activity instructions');

    // ─── Mobile FAB + bottom sheet ───────────────────────────────
    const fab = document.createElement('button');
    fab.className = 'activity-fab';
    fab.setAttribute('aria-label', 'Show activity instructions');
    fab.type = 'button';

    const sheet = document.createElement('div');
    sheet.className = 'activity-sheet';
    const sheetBackdrop = document.createElement('div');
    sheetBackdrop.className = 'activity-sheet-backdrop';

    /**
     * Render a gate block for the current step.
     * Discovery: choice buttons; commit unlocks (prediction) or
     * retry-until-correct (check). Presentation: discussion prompt, no blocking.
     * @param {GateSpec} gate
     */
    function gateHtml(gate) {
      const state = gateState.get(currentStep);
      const isPrediction = !gate.choices.some(c => c.correct);

      if (present) {
        return `
          <div class="gate-question activity-gate" data-present="true">
            <p class="activity-gate-label">Ask your class:</p>
            <p>${md(interp(gate.question))}</p>
            <ul class="activity-gate-discuss">
              ${gate.choices.map(c => `<li>${md(interp(c.text))}</li>`).join('')}
            </ul>
          </div>
        `;
      }

      const buttons = gate.choices.map((c, i) => {
        let cls = 'gate-choice';
        let disabled = '';
        if (state) {
          if (state.passed) {
            disabled = 'disabled';
            if (state.chosen === i) cls += isPrediction ? ' committed' : ' correct';
          } else if (state.chosen === i) {
            cls += ' incorrect';
          }
        }
        return `<button type="button" class="${cls}" data-choice="${i}" ${disabled}>${md(interp(c.text))}</button>`;
      }).join('');

      let feedback = '';
      if (state) {
        const choice = gate.choices[state.chosen];
        if (state.passed) {
          const text = choice.feedback || gate.feedback;
          if (text) feedback = `<div class="gate-feedback success">${md(interp(text))}</div>`;
        } else {
          const text = choice.feedback || gate.retryFeedback || 'Not quite — try again.';
          feedback = `<div class="gate-feedback retry">${md(interp(text))}</div>`;
        }
      }

      return `
        <div class="gate-question activity-gate">
          <p>${md(interp(gate.question))}</p>
          <div class="gate-choices">${buttons}</div>
          <div class="activity-gate-feedback" role="status" aria-live="polite">${feedback}</div>
        </div>
      `;
    }

    /** @param {number} choiceIdx */
    function commitGate(choiceIdx) {
      const gate = steps[currentStep].gate;
      if (!gate) return;
      const isPrediction = !gate.choices.some(c => c.correct);
      const passed = isPrediction || !!gate.choices[choiceIdx].correct;
      gateState.set(currentStep, { chosen: choiceIdx, passed });
      render();
    }

    /** End the activity: strip activity/mode params, reload as the bare tool. */
    function endActivity() {
      const p = new URLSearchParams(location.search);
      p.delete('activity');
      const qs = p.toString();
      location.href = location.pathname + (qs ? '?' + qs : '');
    }

    // Build panel content
    function render() {
      const step = steps[currentStep];
      const isFirst = currentStep === 0;
      const isLast = currentStep === steps.length - 1;
      const isRevealed = revealed.has(currentStep);
      const gateBlocks = !present && step.gate && !gateState.get(currentStep)?.passed;
      const requiresBlocks = !present && step.requires && !requiresMet(step);

      const html = `
        <div class="activity-header">
          <span class="activity-title">${md(activity.title)}</span>
          <span class="activity-step-count">Step ${currentStep + 1} of ${steps.length}</span>
          <button type="button" class="activity-end-btn" aria-label="End activity and keep the tool open" title="End activity">✕</button>
        </div>
        <div class="activity-body">
          <div class="activity-instruction">${md(interp(step.instruction))}</div>
          ${step.demo && DEMOS[step.demo.type] ? `<button type="button" class="activity-demo-btn">▶ ${md(step.demo.label || 'Watch a demonstration')}</button>` : ''}
          ${step.observe ? `<div class="activity-observe"><span class="activity-observe-label">Look for:</span> ${md(interp(step.observe))}</div>` : ''}
          ${step.gate ? gateHtml(step.gate) : ''}
          ${requiresBlocks && step.requires.hint ? `<div class="activity-requires" role="status">${md(interp(step.requires.hint))}</div>` : ''}
          ${step.reveal ? `
            <div class="activity-reveal-section">
              <button type="button" class="activity-reveal-btn">${isRevealed ? 'Hide explanation' : 'Show explanation'}</button>
              <div class="activity-reveal ${isRevealed ? 'open' : ''}">${md(interp(step.reveal))}</div>
            </div>
          ` : ''}
        </div>
        <div class="activity-nav">
          <button type="button" class="activity-prev" ${isFirst ? 'disabled' : ''}>← Back</button>
          <button type="button" class="activity-next" ${isLast || gateBlocks || requiresBlocks ? 'disabled' : ''}
            ${gateBlocks ? 'title="Answer the question above to continue" aria-disabled="true"' : requiresBlocks ? 'title="Do the action above to continue" aria-disabled="true"' : ''}>Next →</button>
        </div>
      `;

      panel.innerHTML = html;
      sheet.innerHTML = `<button type="button" class="activity-sheet-handle" aria-label="Collapse or expand instructions">`
        + `<span class="activity-peek-hint">Step ${currentStep + 1} of ${steps.length} · tap to expand</span></button>`
        + `${html}<button type="button" class="activity-sheet-close" aria-label="Hide instructions">✕</button>`;
      fab.textContent = `${currentStep + 1}/${steps.length}`;

      // Typeset any LaTeX in the freshly-injected step text (REQ-031). KaTeX
      // auto-render only fires once at load, so panel content added later needs
      // an explicit pass. Guarded — not every tool page loads KaTeX.
      if (typeof window !== 'undefined' && typeof window.renderMathInElement === 'function') {
        const opts = { delimiters: [
          { left: '\\(', right: '\\)', display: false },
          { left: '$$', right: '$$', display: true },
        ], throwOnError: false };
        try { window.renderMathInElement(panel, opts); window.renderMathInElement(sheet, opts); } catch { /* ignore */ }
      }

      // Wire events — identical controls exist in panel and sheet
      for (const root of [panel, sheet]) {
        const prevBtn = root.querySelector('.activity-prev');
        const nextBtn = root.querySelector('.activity-next');
        const revealBtn = root.querySelector('.activity-reveal-btn');
        const endBtn = root.querySelector('.activity-end-btn');
        const demoBtn = root.querySelector('.activity-demo-btn');
        if (prevBtn) prevBtn.addEventListener('click', () => { currentStep--; render(); });
        if (nextBtn) nextBtn.addEventListener('click', () => { currentStep++; render(); });
        if (revealBtn) revealBtn.addEventListener('click', () => { toggleReveal(); });
        if (endBtn) endBtn.addEventListener('click', () => { endActivity(); });
        if (demoBtn && steps[currentStep].demo) {
          demoBtn.addEventListener('click', () => openDemo(steps[currentStep].demo));
        }
        for (const btn of root.querySelectorAll('.gate-choice[data-choice]')) {
          btn.addEventListener('click', () => {
            commitGate(parseInt(/** @type {HTMLElement} */ (btn).dataset.choice || '0', 10));
          });
        }
        // Embedded images open full-screen in a lightbox (the panel is too narrow
        // to read a figure like a comic comfortably). A click anywhere in the
        // wrapper — the image or its "Enlarge" button — opens it; the <button>
        // gives keyboard users a native focus stop and Enter/Space activation.
        for (const wrap of root.querySelectorAll('.activity-img-wrap')) {
          const img = wrap.querySelector('.activity-img');
          if (!img) continue;
          wrap.addEventListener('click', () =>
            openLightbox(img.getAttribute('src') || '', img.getAttribute('alt') || ''));
        }
      }
      const sClose = sheet.querySelector('.activity-sheet-close');
      if (sClose) sClose.addEventListener('click', () => { closeSheet(); });
      const sHandle = sheet.querySelector('.activity-sheet-handle');
      if (sHandle) sHandle.addEventListener('click', () => {
        if (sheet.classList.contains('peek')) openSheet(); else peekSheet();
      });
    }

    /** @type {HTMLDialogElement|null} */
    let lightbox = null;
    /**
     * Open an embedded image full-screen. Uses a native <dialog> for free
     * Escape-to-close, focus trapping, and a dimmed ::backdrop.
     * @param {string} src
     * @param {string} alt
     */
    function openLightbox(src, alt) {
      if (!lightbox) {
        lightbox = /** @type {HTMLDialogElement} */ (document.createElement('dialog'));
        lightbox.className = 'activity-lightbox';
        lightbox.innerHTML = '<button type="button" class="activity-lightbox-close" aria-label="Close image">✕</button>'
          + '<img class="activity-lightbox-img" alt="">';
        document.body.appendChild(lightbox);
        // Click outside the image (on the dialog/backdrop padding) closes it.
        lightbox.addEventListener('click', (e) => { if (e.target === lightbox) lightbox?.close(); });
        lightbox.querySelector('.activity-lightbox-close')
          ?.addEventListener('click', () => lightbox?.close());
      }
      const img = /** @type {HTMLImageElement} */ (lightbox.querySelector('.activity-lightbox-img'));
      img.src = src;
      img.alt = alt;
      if (typeof lightbox.showModal === 'function') lightbox.showModal();
    }

    function toggleReveal() {
      if (revealed.has(currentStep)) {
        revealed.delete(currentStep);
      } else {
        revealed.add(currentStep);
      }
      render();
    }

    // Mobile sheet has three states:
    //  full  — .open (backdrop on): reading instructions, tool not interactive
    //  peek  — .open.peek (no backdrop): collapsed to a bottom bar, tool visible
    //          and interactive — lets students act on the instructions
    //  hidden — neither class: only the FAB shows
    function openSheet() {
      sheet.classList.add('open');
      sheet.classList.remove('peek');
      sheetBackdrop.classList.add('open');
      fab.classList.add('hidden');
    }

    function peekSheet() {
      sheet.classList.add('open', 'peek');
      sheetBackdrop.classList.remove('open');
      fab.classList.add('hidden');
    }

    function closeSheet() {
      sheet.classList.remove('open', 'peek');
      sheetBackdrop.classList.remove('open');
      fab.classList.remove('hidden');
    }

    fab.addEventListener('click', () => openSheet());
    // Tapping the dimmed area collapses to peek (keeps the step visible) rather
    // than hiding entirely — students rarely want to lose their place.
    sheetBackdrop.addEventListener('click', () => peekSheet());

    // Insert into DOM
    document.body.appendChild(panel);
    document.body.appendChild(fab);
    document.body.appendChild(sheetBackdrop);
    document.body.appendChild(sheet);

    render();

    // Auto-open sheet on mobile on first load
    if (window.innerWidth <= 768) {
      setTimeout(() => openSheet(), 500);
    }
  }
})();
