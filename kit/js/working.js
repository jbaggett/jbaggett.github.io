/**
 * A line of working — the shared presentation for worked-steps tools.
 *
 * Two rules are baked in here rather than left to each tool:
 *
 *   1. **The equality column holds only genuine equalities.** Everything a step
 *      OBSERVES rather than asserts — "substituting h = 0 gives 0/0" — is a
 *      note, never a line. Writing `lim … = 0/0` is false (0/0 is not a value
 *      the limit equals, it is the result of an attempt that failed) and it is
 *      the exact error students reproduce on exams. The note column exists so
 *      that diagnosis has somewhere honest to go.
 *
 *   2. **The next line is withheld until asked.** Printing a finished
 *      derivation answers "what is it"; revealing it a line at a time asks
 *      "what would you do next", which is the part that is actually hard.
 *
 * Notes come in two kinds. A `transition` says how this line came from the one
 * above — it describes the arrow. A `diagnosis` says what was observed about
 * this line, and is why the NEXT step is what it is; it describes the line
 * itself, so it can sit on the first row, where there is no arrow yet.
 */

import { tex } from './tex.js';
import { announce } from './page.js';

/**
 * @typedef {{text:string, kind?:'transition'|'diagnosis'}} Note
 * @typedef {{tex:string, notes?:Note[]}} WorkStep
 */

function el(/** @type {string} */ tag, /** @type {string} */ cls, /** @type {string} */ text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

/**
 * @param {{
 *   mount: Element,
 *   ghost?: string,            // the question the withheld line asks
 *   controlsName?: string,     // data-control value, for ?controls=
 *   labels?: {next?:string, all?:string, reset?:string, hint?:(n:number,total:number)=>string},
 *   onChange?: (shown:number, done:boolean) => void,
 * }} opts
 */
export function initWorking(opts) {
  const { mount, ghost = 'what would you do next?', controlsName, onChange } = opts;
  const L = {
    next: 'Next step ▸', all: 'Show all', reset: 'Start over',
    hint: (/** @type {number} */ n, /** @type {number} */ total) =>
      `Step ${n} of ${total} — press N for the next one.`,
    ...(opts.labels || {}),
  };

  const list = el('ol', 'll-steps', '');
  const bar = el('div', 'll-work-controls', '');
  if (controlsName) bar.dataset.control = controlsName;
  const nextBtn = el('button', 'll-primary', L.next);
  const allBtn = el('button', '', L.all);
  const resetBtn = el('button', '', L.reset);
  const hint = el('span', 'll-hint', '');
  for (const b of [nextBtn, allBtn, resetBtn]) b.type = 'button';
  bar.append(nextBtn, allBtn, resetBtn, hint);
  mount.append(list, bar);

  /** @type {WorkStep[]} */ let steps = [];
  let shown = 1;
  let suppressed = false;      // ?controls= took the buttons away

  function render() {
    list.innerHTML = '';
    steps.slice(0, shown).forEach((s, i) => {
      const li = el('li', 'll-wstep', '');
      if (i === steps.length - 1 && shown === steps.length) li.classList.add('ll-wstep-final');

      const sign = el('span', 'll-wstep-sign', i === 0 ? '' : '=');
      sign.setAttribute('aria-hidden', 'true');
      const eq = el('div', 'll-wstep-eq', '');
      eq.innerHTML = tex(s.tex);
      li.append(sign, eq);

      if (s.notes && s.notes.length) {
        const box = el('div', 'll-wstep-notes', '');
        for (const n of s.notes) {
          box.append(el('span', `ll-note ll-note-${n.kind || 'transition'}`, n.text));
        }
        li.append(box);
      }
      list.append(li);
    });

    // A withheld line has to LOOK withheld, or "what comes next?" is a question
    // about a blank space. The question goes in the note column, where its
    // answer will appear — which is also what teaches that column's job.
    if (shown < steps.length) {
      const li = el('li', 'll-wstep ll-wstep-ghost', '');
      li.innerHTML = '<span class="ll-wstep-sign" aria-hidden="true">=</span>'
        + '<div class="ll-wstep-eq" aria-hidden="true">…</div>';
      li.append(el('div', 'll-wstep-notes', ghost));
      list.append(li);
    }

    // Nothing to step through (an unreadable function, say) must not leave live
    // buttons over an empty panel: that reads as a broken page, not a typo.
    bar.hidden = suppressed || steps.length === 0;
    const done = shown >= steps.length;
    nextBtn.hidden = done;
    allBtn.hidden = done || shown >= steps.length - 1;
    resetBtn.hidden = !done || steps.length <= 2;
    hint.textContent = done ? '' : L.hint(shown, steps.length - 1);
    onChange?.(shown, done);
  }

  function advance(/** @type {number} */ to) {
    const before = shown;
    shown = Math.max(1, Math.min(to, steps.length));
    if (shown === before) return;
    render();
    // The rendered maths carries its own MathML, but nothing in the markup says
    // WHY the line changed — which is the part worth hearing.
    const s = steps[shown - 1];
    const said = (s.notes || []).map(n => n.text).join('. ');
    announce(said || `Step ${shown}.`, 120);
  }

  nextBtn.addEventListener('click', () => advance(shown + 1));
  allBtn.addEventListener('click', () => advance(steps.length));
  resetBtn.addEventListener('click', () => { shown = 1; render(); nextBtn.focus(); });

  document.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
    const t = /** @type {any} */ (e.target);
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey || bar.hidden) return;
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); advance(shown + 1); }
    if (e.key === 'a' || e.key === 'A') { e.preventDefault(); advance(steps.length); }
  });

  return {
    controlsEl: bar,
    /** @param {WorkStep[]} next @param {{openAll?:boolean}} [o] */
    set(next, o = {}) {
      steps = next || [];
      shown = o.openAll ? steps.length : 1;
      render();
    },
    openAll() { advance(steps.length); },
    /** Tell it the buttons were removed by `?controls=`, before any render. */
    setSuppressed(/** @type {boolean} */ v) { suppressed = v; },
    shownCount: () => shown,
    total: () => steps.length,
  };
}
