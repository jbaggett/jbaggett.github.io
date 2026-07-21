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
    // KaTeX must be in place BEFORE the first render — md() is synchronous, so a
    // late-arriving KaTeX would leave step 1 showing raw-TeX <code> fallbacks.
    .then(activity => (activity && usesMath(activity) ? ensureKatex().then(() => activity) : activity))
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
    // Math is extracted FIRST and parked behind placeholders. `_`, `*`, `[` and
    // `{` are meaningful in BOTH TeX and markdown, so the rules below would
    // otherwise mangle a formula (e.g. $a * b$ would trip the *italic* rule).
    const math = [];
    const ESC = '\u0001';   // parks an escaped \$ so it cannot open a math span
    const MARK = '\u0000';  // brackets a parked math span
    const park = (tex, display) => {
      math.push({ tex: tex, display: display });
      return MARK + 'M' + (math.length - 1) + MARK;
    };
    let src = String(text).split('\\$').join(ESC);
    // Display math first, so $$…$$ is not eaten by the $…$ rule below. \(…\)
    // and $$…$$ are the delimiters REQ-031 documented; $…$ is the shorthand.
    src = src.replace(/\$\$([\s\S]+?)\$\$/g, (m, tex) => park(tex, true));
    src = src.replace(/\\\[([\s\S]+?)\\\]/g, (m, tex) => park(tex, true));
    src = src.replace(/\\\(([\s\S]+?)\\\)/g, (m, tex) => park(tex, false));
    src = src.replace(/\$([^$]+)\$(?!\d)/g, (m, tex) => {
      // Pandoc's delimiter rule, which is what keeps prose currency out of the
      // math parser: no space just inside either delimiter, and no digit right
      // after the closing one. It is why '$100,000-$250,000' stays money.
      if (/^\s|\s$/.test(tex)) return m;
      return park(tex, false);
    });
    return src
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
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      // Math last: swap the parked spans for rendered KaTeX, then un-escape \$.
      .replace(new RegExp(MARK + 'M(\\d+)' + MARK, 'g'), (m, i) => renderTex(math[+i]))
      .split(ESC).join('$');
  }

  /**
   * Render one inline TeX span. KaTeX is loaded lazily (see ensureKatex) and only
   * when an activity actually contains math — most tool pages never load it. If it
   * is unavailable or the TeX is malformed, fall back to the raw source in <code>
   * rather than dropping the formula on the floor.
   */
  function renderTex(span) {
    const tex = span.tex;
    const katex = /** @type {any} */ (window).katex;
    if (katex) {
      try {
        return katex.renderToString(tex, {
          throwOnError: false, strict: false, trust: true, displayMode: !!span.display,
        });
      } catch (err) {
        console.warn('Activity panel: bad TeX', tex, err);
      }
    }
    return '<code>' + String(tex).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</code>';
  }

  /**
   * Load KaTeX from the CDN on demand. Activities render on top of ANY tool page,
   * and only the inference pages ship KaTeX themselves — so the panel cannot
   * assume it exists. Resolves even on failure; renderTex degrades to <code>.
   */
  function ensureKatex() {
    const w = /** @type {any} */ (window);
    if (w.katex) return Promise.resolve();
    if (w.__katexReady) return w.__katexReady;
    w.__katexReady = new Promise((resolve) => {
      if (!document.querySelector('link[href*="katex"]')) {
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = 'https://cdn.jsdelivr.net/npm/katex@0.16/dist/katex.min.css';
        document.head.appendChild(css);
      }
      const js = document.createElement('script');
      js.src = 'https://cdn.jsdelivr.net/npm/katex@0.16/dist/katex.min.js';
      js.onload = () => resolve();
      js.onerror = () => { console.warn('Activity panel: KaTeX failed to load'); resolve(); };
      document.head.appendChild(js);
    });
    return w.__katexReady;
  }

  /** True if any string anywhere in the activity uses $…$ math. */
  function usesMath(activity) {
    // Must match EVERY delimiter md() understands, not just $…$ — an activity
    // written entirely in \(…\) would otherwise never load KaTeX and would
    // silently render as <code> on any page that does not ship KaTeX itself.
    try {
      const s = JSON.stringify(activity);
      return /\$[^$]+\$/.test(s) || /\\\\\(/.test(s) || /\\\\\[/.test(s);
    } catch { return false; }
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
   * @typedef {object} RespondPrompt
   * @property {string} id - Stable field id (part of the localStorage key + export)
   * @property {string} [label] - Shown above the textarea
   * @property {string} [placeholder]
   * @property {number} [rows] - Textarea height in rows (1–6, default 2)
   *
   * @typedef {object} RespondSpec
   * @property {RespondPrompt[]} prompts - One labeled textarea per prompt
   * @property {boolean} [gateOnNonEmpty] - Block "Next" until every field has content
   *   (REQ-041: forces the predict-before-reveal commit; never a correctness check)
   *
   * @param {{ title: string, steps: Array<{instruction: string, observe?: string, reveal?: string, gate?: GateSpec, requires?: StepRequires, respond?: RespondSpec, demo?: {type: string, label?: string, options?: object}}> }} activity
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

    // ─── Free-text response capture (REQ-041) ─────────────────────────────────
    // A step can declare a `respond` block of labeled textareas. The textbook
    // keeps the Predict/Explain *prompts* (narrative, print, offline); the typed
    // *answers* live here, so e-book / rental / library students who can't write
    // in the book still can. Answers persist to localStorage and export.
    //
    // Everything routes through ONE response store (load / save / serialize).
    // Today it feeds a single sink — Download. The Gen-2 seam (Jeff's AI-eval
    // vision) is exactly this: a future `postMessage`-emit or POST is just a
    // second sink over `serializeResponses()`, no re-plumbing. That is also why
    // Download emits a machine-readable `.json` beside the human-readable file.
    const escapeAttr = (/** @type {string} */ s) =>
      String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const escapeTextarea = (/** @type {string} */ s) =>
      String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

    const activitySlug = String(activityUrl || 'activity').split('/').pop().replace(/\.json$/, '');
    const RESP_KEY = `statlens-activity-responses:${activitySlug}`;
    const activityHasRespond = steps.some(s => s && s.respond && Array.isArray(s.respond.prompts));

    /** @type {Record<string, Record<string, string>>} step-index → field-id → text */
    const responses = (() => {
      try { return JSON.parse(localStorage.getItem(RESP_KEY) || '{}') || {}; }
      catch { return {}; }
    })();
    // True once the student has typed something not yet exported — arms the
    // beforeunload hint. localStorage already persists every keystroke, so this
    // warns about un-downloaded work, not lost work.
    let responsesDirty = false;

    function saveResponses() {
      try { localStorage.setItem(RESP_KEY, JSON.stringify(responses)); }
      catch { /* quota / private mode: the in-memory copy still works this session */ }
    }
    function respVal(/** @type {number} */ stepIdx, /** @type {string} */ fieldId) {
      return (responses[stepIdx] && responses[stepIdx][fieldId]) || '';
    }
    /** Every prompt on a `respond` step has non-blank content. */
    function respondComplete(/** @type {number} */ stepIdx) {
      const r = steps[stepIdx] && steps[stepIdx].respond;
      if (!r || !Array.isArray(r.prompts)) return true;
      return r.prompts.every(p => respVal(stepIdx, p.id).trim().length > 0);
    }
    function anyResponses() {
      return Object.values(responses).some(
        step => Object.values(step || {}).some(v => String(v).trim().length > 0));
    }

    /** Structured snapshot — the single source every export/emit sink reads. */
    function serializeResponses() {
      const out = [];
      steps.forEach((s, i) => {
        if (!s.respond || !Array.isArray(s.respond.prompts)) return;
        out.push({
          step: i + 1,
          instruction: typeof s.instruction === 'string' ? s.instruction : '',
          fields: s.respond.prompts.map(p => ({
            id: p.id, label: p.label || p.id, response: respVal(i, p.id),
          })),
        });
      });
      return { activity: activitySlug, title: activity.title || activitySlug, steps: out };
    }
    function responsesToText() {
      const data = serializeResponses();
      const lines = [`# ${data.title} — my responses`, ''];
      for (const step of data.steps) {
        lines.push(`## Step ${step.step}`);
        for (const f of step.fields) lines.push(`**${f.label}:** ${f.response || '(blank)'}`);
        lines.push('');
      }
      return lines.join('\n');
    }
    function downloadBlob(/** @type {string} */ text, /** @type {string} */ mime, /** @type {string} */ ext) {
      try {
        const url = URL.createObjectURL(new Blob([text], { type: mime }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `${activitySlug}-responses.${ext}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      } catch { /* download unavailable in this context */ }
    }
    function downloadResponses() {
      // Two sinks over the same store: a readable file for the student, a JSON
      // sibling for a machine (LMS / the future AI-eval pipeline).
      downloadBlob(responsesToText(), 'text/markdown;charset=utf-8', 'md');
      downloadBlob(JSON.stringify(serializeResponses(), null, 2), 'application/json;charset=utf-8', 'json');
      responsesDirty = false;
    }
    function clearResponses() {
      // Confirm before wiping — shared lab / classroom workstations are a real
      // usage mode (textbook agent's explicit ask).
      if (anyResponses() && !window.confirm('Clear all your typed responses for this activity? This cannot be undone.')) return;
      for (const k of Object.keys(responses)) delete responses[k];
      saveResponses();
      responsesDirty = false;
      render();
    }

    /**
     * Free-text response fields for a step. Values come from the persisted store
     * so they survive re-render, reload, and tab close. The <textarea> is wrapped
     * in its <label> (implicit association) so the panel and the mobile sheet —
     * which render identical markup — don't collide on duplicate `id`s.
     * @param {number} stepIdx
     * @param {RespondSpec} respond
     */
    function respondHtml(stepIdx, respond) {
      if (!respond || !Array.isArray(respond.prompts)) return '';
      const fields = respond.prompts.map(p => {
        const rows = Math.max(1, Math.min(6, Number(p.rows) || 2));
        const ph = p.placeholder ? ` placeholder="${escapeAttr(p.placeholder)}"` : '';
        return `<label class="activity-respond-field">
          <span class="activity-respond-label">${md(p.label || p.id)}</span>
          <textarea class="activity-respond-input" rows="${rows}"
            data-respond-step="${stepIdx}" data-respond-field="${escapeAttr(p.id)}"${ph}>${escapeTextarea(respVal(stepIdx, p.id))}</textarea>
        </label>`;
      }).join('');
      return `<div class="activity-respond" role="group" aria-label="Write your response">${fields}</div>`;
    }

    /** Persist one field on input WITHOUT a re-render (which would blur the box). */
    function onRespondInput(/** @type {HTMLTextAreaElement} */ ta) {
      const stepIdx = ta.dataset.respondStep;
      const fieldId = ta.dataset.respondField;
      if (stepIdx == null || fieldId == null) return;
      const val = ta.value;
      if (!responses[stepIdx]) responses[stepIdx] = {};
      responses[stepIdx][fieldId] = val;
      saveResponses();
      if (val.trim().length > 0) responsesDirty = true;
      // Mirror into the twin textarea in the other root (panel <-> sheet).
      document.querySelectorAll('.activity-respond-input').forEach(el => {
        const other = /** @type {HTMLTextAreaElement} */ (el);
        if (other !== ta && other.dataset.respondStep === stepIdx
            && other.dataset.respondField === fieldId && other.value !== val) {
          other.value = val;
        }
      });
      updateNextEnabled();
    }

    /** Re-evaluate the Next button without a full re-render (keeps textarea focus). */
    function updateNextEnabled() {
      const step = steps[currentStep];
      const isLast = currentStep === steps.length - 1;
      const gateB = !present && step.gate && !gateState.get(currentStep)?.passed;
      const requiresB = !present && step.requires && !requiresMet(step);
      const respondB = !present && step.respond && step.respond.gateOnNonEmpty && !respondComplete(currentStep);
      const disabled = isLast || gateB || requiresB || respondB;
      for (const root of [panel, sheet]) {
        const nb = /** @type {HTMLButtonElement|null} */ (root.querySelector('.activity-next'));
        if (!nb) continue;
        nb.disabled = !!disabled;
        // Keep aria-disabled in sync with the property — the initial render sets
        // it when a gate blocks, and a stale "true" would report the enabled
        // button as disabled to assistive tech (and to Playwright's toBeEnabled).
        if (disabled) nb.setAttribute('aria-disabled', 'true');
        else nb.removeAttribute('aria-disabled');
        if (respondB) nb.setAttribute('title', 'Fill in every field above to continue');
        else nb.removeAttribute('title');
      }
    }

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

    // Mark body so CSS can adjust layout. The data panel is hidden via
    // body[data-activity]; that is all activity mode hides by default.
    document.body.setAttribute('data-activity', 'true');
    // NOTE: activities deliberately do NOT set data-guided. That flag hides the
    // .control-row (stat / confidence-level / tail dropdowns) and belongs to the
    // textbook *embed* path (?embed=true&guided=true, wired in page-number.js),
    // where parameters are pre-set and the student shouldn't touch them. An
    // activity is the opposite: its steps walk the student *through* those
    // controls, so hiding them makes an instruction like "change the confidence
    // level to 90%" impossible to follow (this broke ci-level.json). Activities
    // that want a stripped-down surface opt into chrome:minimal below, which now
    // also hides the control row.
    // Opt-in "minimal chrome": an activity can strip the host tool's advanced
    // controls (hypotheses, success selector, Copy link, More options, seed, and
    // the stat/CI control row) down to just the mechanism + chart + generate bar
    // — for gentle conceptual intros where that machinery is clutter. CSS keys
    // off body[data-chrome="minimal"].
    if (activity.chrome === 'minimal') {
      document.body.setAttribute('data-chrome', 'minimal');
    }

    // Optional friendlier page heading (the host tool's h1 can be clunky for an
    // intro, e.g. "Randomization Test for Difference in Proportions"). Replace the
    // leading heading text while keeping the header-actions (home/help/settings).
    if (activity.heading) {
      const h1 = document.querySelector('main > h1');
      if (h1) {
        const actions = h1.querySelector('.header-actions');
        h1.textContent = activity.heading;
        if (actions) h1.appendChild(actions);
        document.title = `${activity.heading} | StatLens`;
      }
    }

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
      const respondBlocks = !present && step.respond && step.respond.gateOnNonEmpty && !respondComplete(currentStep);

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
          ${step.respond ? respondHtml(currentStep, step.respond) : ''}
          ${requiresBlocks && step.requires.hint ? `<div class="activity-requires" role="status">${md(interp(step.requires.hint))}</div>` : ''}
          ${step.reveal ? `
            <div class="activity-reveal-section">
              <button type="button" class="activity-reveal-btn">${isRevealed ? 'Hide explanation' : 'Show explanation'}</button>
              <div class="activity-reveal ${isRevealed ? 'open' : ''}">${md(interp(step.reveal))}</div>
            </div>
          ` : ''}
        </div>
        ${activityHasRespond && !present ? `<div class="activity-responses-bar">
          <button type="button" class="activity-download-responses" title="Download your typed responses as a file">⬇ Download my responses</button>
          <button type="button" class="activity-clear-responses" title="Erase your typed responses">Clear</button>
        </div>` : ''}
        <div class="activity-nav">
          <button type="button" class="activity-prev" ${isFirst ? 'disabled' : ''}>← Back</button>
          <button type="button" class="activity-next" ${isLast || gateBlocks || requiresBlocks || respondBlocks ? 'disabled' : ''}
            ${gateBlocks ? 'title="Answer the question above to continue" aria-disabled="true"' : requiresBlocks ? 'title="Do the action above to continue" aria-disabled="true"' : respondBlocks ? 'title="Fill in every field above to continue" aria-disabled="true"' : ''}>Next →</button>
        </div>
      `;

      panel.innerHTML = html;
      sheet.innerHTML = `<button type="button" class="activity-sheet-handle" aria-label="Collapse or expand instructions">`
        + `<span class="activity-peek-hint">Step ${currentStep + 1} of ${steps.length} · tap to expand</span></button>`
        + `${html}<button type="button" class="activity-sheet-close" aria-label="Hide instructions">✕</button>`;
      fab.textContent = `${currentStep + 1}/${steps.length}`;

      // No KaTeX pass needed here: md() renders every math span to HTML before
      // this point (REQ-031 originally relied on KaTeX auto-render, but that only
      // ever existed on conceptual/sampling-lab, so panel math silently never
      // typeset anywhere else — which is why activities were authored in ASCII).

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
        // REQ-041 free-text fields: persist + sync on input, but never re-render
        // here (that would blur the box mid-keystroke — see onRespondInput).
        for (const ta of root.querySelectorAll('.activity-respond-input')) {
          ta.addEventListener('input', () => onRespondInput(/** @type {HTMLTextAreaElement} */ (ta)));
        }
        const dlBtn = root.querySelector('.activity-download-responses');
        if (dlBtn) dlBtn.addEventListener('click', () => downloadResponses());
        const clrBtn = root.querySelector('.activity-clear-responses');
        if (clrBtn) clrBtn.addEventListener('click', () => clearResponses());
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

    // Warn on tab close if the student has typed responses they haven't exported.
    // localStorage already persisted them, so this guards un-downloaded work, not
    // lost work — relevant on rental / shared / private-mode machines where the
    // store won't survive, and the download is the way to keep it (REQ-041).
    if (activityHasRespond) {
      window.addEventListener('beforeunload', (e) => {
        if (responsesDirty && anyResponses()) { e.preventDefault(); e.returnValue = ''; }
      });
    }

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
