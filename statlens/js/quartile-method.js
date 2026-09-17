// @ts-check
/**
 * Which quartile convention the descriptive tools display.
 *
 * Three rules are in circulation and students meet all of them: the course
 * teaches median-of-halves with the median excluded when *n* is odd, a TI-84
 * agrees, R's `fivenum` keeps the median in both halves, and most software
 * interpolates (type 7). They agree far more often than they disagree — which
 * is exactly why the disagreement confuses people when it surfaces.
 *
 * So the method is selectable, expert-mode only, defaulting to the course rule.
 * The point is not configurability for its own sake: it lets an instructor put
 * two conventions side by side on the same data and show that "the quartile"
 * is a definition, not a discovery.
 *
 * ## Resolution order
 *
 * 1. `?quartile_method=` — wins always, so an embed in the coursepack can pin
 *    the course rule no matter what the reader's browser remembers.
 * 2. The session setting, changed by the expert-mode control.
 * 3. The course rule.
 *
 * Like `expertMode`, the setting is **session-only** — `settings.js` drops it
 * on load rather than persisting it. A student who once clicked "most software"
 * must not find their quartiles silently disagreeing with the book a week
 * later; a fresh page is always the course's.
 *
 * Display only. The percentile bootstrap CI in `sim-engine.js` and `ci-method.js`
 * keeps using `quantile()` (type 7), which is the right standard there.
 */

import { getSetting, setSettings } from './settings.js';

/** @typedef {'exclusive'|'inclusive'|'type7'} QuartileMethod */

/**
 * The three conventions, in the order they should appear in the control:
 * the course's first, then the two a student is most likely to meet elsewhere.
 */
export const QUARTILE_METHODS = /** @type {const} */ ([
  {
    id: 'exclusive',
    label: 'Median excluded (n odd)',
    short: 'course method',
    hint: 'Q1 and Q3 are the medians of the lower and upper halves; when n is odd the '
      + 'median belongs to neither half. This is the coursepack and TI-84 rule.',
  },
  {
    id: 'inclusive',
    label: 'Median included (n odd)',
    short: 'median in both halves',
    hint: 'Same split, but when n is odd the median stays in both halves. Identical to '
      + 'the course rule whenever n is even.',
  },
  {
    id: 'type7',
    label: 'Most software (type 7)',
    short: 'type 7',
    hint: 'Interpolates between neighbouring values instead of taking a median of a half. '
      + 'R, NumPy and Excel report these by default.',
  },
]);

/** @type {QuartileMethod} */
export const DEFAULT_QUARTILE_METHOD = 'exclusive';

const IDS = QUARTILE_METHODS.map(m => m.id);

/** @param {any} value @returns {value is QuartileMethod} */
export function isQuartileMethod(value) {
  return typeof value === 'string' && IDS.includes(/** @type {any} */ (value));
}

/**
 * The method this page should display, resolved from URL then session.
 * @returns {QuartileMethod}
 */
export function getQuartileMethod() {
  const pinned = pinnedMethod();
  if (pinned) return pinned;
  const setting = getSetting('quartileMethod');
  return isQuartileMethod(setting) ? setting : DEFAULT_QUARTILE_METHOD;
}

/**
 * A `?quartile_method=` pin, if the page carries a valid one.
 * @returns {QuartileMethod|null}
 */
export function pinnedMethod() {
  if (typeof location === 'undefined') return null;
  try {
    const raw = new URLSearchParams(location.search).get('quartile_method');
    return isQuartileMethod(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Change the method for this session. Ignored when the URL pins one — an embed
 * that asked for a convention gets to keep it.
 * @param {QuartileMethod} method
 */
export function setQuartileMethod(method) {
  if (!isQuartileMethod(method) || pinnedMethod()) return;
  setSettings({ quartileMethod: method });
}

/** @param {QuartileMethod} [method] */
export function quartileMethodLabel(method) {
  const id = method ?? getQuartileMethod();
  return QUARTILE_METHODS.find(m => m.id === id)?.label ?? id;
}

/** The short form, for a caption under a table. @param {QuartileMethod} [method] */
export function quartileMethodShort(method) {
  const id = method ?? getQuartileMethod();
  return QUARTILE_METHODS.find(m => m.id === id)?.short ?? id;
}

/**
 * Mount the expert-mode control, plus a note that appears whenever the page is
 * *not* showing the course rule.
 *
 * The control is `.expert-only`; the note is not. That asymmetry is deliberate.
 * Expert mode is session-scoped and can be turned off again from the settings
 * dialog, which would otherwise leave a student looking at type-7 quartiles
 * with no visible reason why they disagree with the coursepack. The note is the
 * reason, and it costs nothing on the default path because it stays hidden.
 *
 * @param {HTMLElement} container
 * @param {() => void} onChange - re-render whatever displays quartiles
 * @returns {{refresh: () => void}}
 */
export function mountQuartileControl(container, onChange) {
  const pinned = pinnedMethod();
  const options = QUARTILE_METHODS
    .map(m => `<option value="${m.id}">${m.label}</option>`).join('');

  container.innerHTML = `
    <div class="quartile-method expert-only">
      <label class="control-label" for="quartile-method-select">Quartile method</label>
      <select id="quartile-method-select" aria-describedby="quartile-method-hint"
        ${pinned ? 'disabled' : ''}>${options}</select>
      <p class="hint" id="quartile-method-hint"></p>
    </div>
    <p class="hint quartile-method-note" hidden></p>`;

  const select = /** @type {HTMLSelectElement} */ (
    container.querySelector('#quartile-method-select'));
  const hint = /** @type {HTMLElement} */ (container.querySelector('#quartile-method-hint'));
  const note = /** @type {HTMLElement} */ (container.querySelector('.quartile-method-note'));

  const refresh = () => {
    const active = getQuartileMethod();
    select.value = active;
    const spec = QUARTILE_METHODS.find(m => m.id === active);
    hint.textContent = pinned
      ? `Fixed by the link that opened this page. ${spec?.hint ?? ''}`
      : (spec?.hint ?? '');
    const off = active !== DEFAULT_QUARTILE_METHOD;
    note.hidden = !off;
    if (off) {
      note.textContent = `Q1, Q3 and IQR use the “${quartileMethodLabel(active)}” rule, `
        + 'not the course’s median-of-halves. Your hand calculation may differ.';
    }
  };

  select.addEventListener('change', () => {
    setQuartileMethod(/** @type {QuartileMethod} */ (select.value));
    refresh();
    onChange();
  });

  refresh();
  return { refresh };
}
