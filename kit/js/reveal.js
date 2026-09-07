/**
 * Withholding a tool's payoff, and giving it back.
 *
 * This course does not lecture. Its slides carry "your turn" far more often
 * than "my turn", and the shape is always prompt → silence → answer. So the
 * highest-value use of a tool here is not illustrating a result: it is being
 * the reveal at the end of the silence, after students have committed to an
 * answer on paper.
 *
 * That gives one rule, which this module exists to make cheap:
 *
 *     Every tool should be able to withhold its payoff.
 *
 * Two requirements follow, and the second is the one that is easy to miss:
 *
 *   1. A documented URL parameter starts it hidden, so a slide can pose the
 *      question before answering it.
 *   2. It must be revealable WITHOUT A PAGE RELOAD. The instructor reveals
 *      mid-discussion, in front of the class, from the podium — reloading would
 *      lose the state the discussion is about and take the projector somewhere
 *      else for a second. So: a visible button, and a single keypress.
 *
 * The DEFAULT is deliberately not fixed here. Whether a tool starts hidden is a
 * pedagogical judgement about that tool — the secant tool's tangent is the
 * answer to the question the tool asks, so it starts hidden; the accumulation
 * curve is the whole picture, so it starts shown and a lecture link hides it.
 * Each tool decides, and documents it in url-api.md.
 */

import { announce } from './page.js';

/**
 * @param {{
 *   mount: Element|null,
 *   label: string,          // what is being withheld, as a noun phrase
 *   hidden?: boolean,       // start withheld
 *   prompt?: string,        // shown in place of the payoff while it is hidden
 *   hotkey?: string,        // default "r"
 *   onChange: (shown:boolean) => void
 * }} opts
 * @returns {{shown:boolean, toggle:()=>void, set:(v:boolean)=>void}}
 */
export function initReveal(opts) {
  const { mount, label, prompt, hotkey = 'r', onChange } = opts;
  let shown = !opts.hidden;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'll-reveal-btn';
  // A toggle button, so aria-pressed — not aria-expanded, which would promise a
  // disclosure region that does not exist (the payoff is drawn into a chart).
  btn.setAttribute('aria-pressed', String(shown));

  const hint = document.createElement('span');
  hint.className = 'll-hint ll-reveal-hint';

  if (mount) {
    mount.classList.add('ll-reveal-slot');
    mount.append(btn, hint);
  }

  function paint() {
    btn.textContent = shown ? `Hide ${label}` : `Show ${label}`;
    btn.setAttribute('aria-pressed', String(shown));
    btn.classList.toggle('ll-reveal-armed', !shown);
    hint.textContent = shown ? '' : (prompt ? `${prompt} — press R when ready.` : 'Press R to reveal.');
  }

  function set(v, opts2 = {}) {
    if (v === shown) return;
    shown = v;
    paint();
    onChange(shown);
    if (!opts2.quiet) announce(shown ? `${label} shown.` : `${label} hidden.`, 120);
  }

  btn.addEventListener('click', () => set(!shown));

  document.addEventListener('keydown', e => {
    const t = /** @type {HTMLElement} */ (e.target);
    // Never steal the key from someone typing an expression.
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key.toLowerCase() !== hotkey) return;
    e.preventDefault();
    set(!shown);
  });

  paint();
  return {
    get shown() { return shown; },
    toggle() { set(!shown); },
    set(v) { set(v); },
  };
}

/**
 * Read the withhold-the-answer parameter.
 *
 * `readout` is the SHARED spelling across lenses. StatLens froze it first, for
 * the same idea in different clothes — `readout=false` there hides the computed
 * CI or p-value so the student reads it off the histogram, which is exactly
 * this: withhold the answer, keep the evidence. One concept should not have two
 * names across two lenses that sit side by side on the same site.
 *
 * `reveal` remains as a CalcLens spelling, and a tool may name one older
 * parameter of its own (`tangent`). All three are honoured forever; `readout`
 * is what new links should use. First one present wins, most specific first.
 *
 * @param {URLSearchParams} q
 * @param {boolean} shownByDefault
 * @param {string} [legacy] a tool's own older, still-frozen parameter name
 */
export function revealHidden(q, shownByDefault, legacy) {
  for (const name of [legacy, 'reveal', 'readout']) {
    if (!name) continue;
    const v = q.get(name);
    if (v === 'false' || v === '0' || v === 'no') return true;
    if (v === 'true' || v === '1' || v === 'yes') return false;
  }
  return !shownByDefault;
}
