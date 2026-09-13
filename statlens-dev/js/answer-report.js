// @ts-check
/**
 * Report a student's produced value to the page that frames us (REQ-055).
 *
 * This is what lets a StatLens tool be embedded *inside* a MyOpenMath question
 * rather than linked out of one: the student runs the simulation here, and the
 * value they produce lands in MOM's answer box and gets graded.
 *
 * The textbook agent verified the whole loop against stock hosted
 * myopenmath.com before asking for it. MOM's `general.js` listens for a
 * `window.postMessage` whose payload string contains `imathas.update`, parses
 * it, writes `value` into the answer input for question `qn`, and triggers
 * grading. Both the classic and Vue players; no origin check on their side.
 *
 * Three things about that are fixed by MyOpenMath and must not be "improved":
 * the subject string `imathas.update`, the key names `qn` and `value`, and the
 * fact that both are strings. Renaming any of them silently stops the listener
 * matching, and silence is the failure mode — the student would see a working
 * tool and an ungraded box.
 *
 * Everything else is ours:
 *
 *   - **Opt-in.** Nothing is posted unless `?qn=` is present, so every existing
 *     link behaves exactly as before.
 *   - **Only when framed.** With no parent frame there is nobody to tell, and
 *     posting to ourselves would just be noise.
 *   - **`?report=` picks which quantity** a tool sends, because a bootstrap run
 *     produces several (both CI bounds, the standard error) and an answer box
 *     holds one. Each caller supplies a sensible default so the common case is
 *     a bare `?qn=`.
 *
 * Security note: the post targets `'*'` because the embedding origin is not
 * known ahead of time and MOM does not check it either. That is acceptable here
 * only because what we send is a number the student just produced on screen —
 * there is nothing private in it. Do not extend this to anything else.
 */

/** MyOpenMath's listener matches on this exact string. Not ours to change. */
const SUBJECT = 'imathas.update';

/**
 * Trim binary-float noise without throwing away precision a grader might want:
 * 0.30000000000000004 becomes "0.3", while 1.2345678 survives intact.
 * @param {number} v
 */
function clean(v) {
  if (!Number.isFinite(v)) return null;
  const s = v.toPrecision(12).replace(/0+$/, '').replace(/\.$/, '');
  return String(Number(s));
}

/**
 * @typedef {object} AnswerReporter
 * @property {boolean} active - true when a parent frame asked to be told
 * @property {string} key - which quantity is being reported
 * @property {(values: Record<string, number|undefined>) => void} send
 */

/**
 * @param {object} [opts]
 * @param {string} [opts.defaultKey] - quantity to send when `?report=` is absent
 * @param {string[]} [opts.keys] - quantities this page can report (for validation)
 * @returns {AnswerReporter}
 */
export function initAnswerReport(opts = {}) {
  const qs = new URLSearchParams(location.search);
  const qn = qs.get('qn') ?? '';
  const framed = typeof window !== 'undefined' && window.parent && window.parent !== window;

  // Digits only: `qn` is spliced into MOM's input id, and a tool that will be
  // embedded in someone else's page should not pass through arbitrary strings.
  const valid = /^\d{1,6}$/.test(qn);
  const active = !!qn && valid && !!framed;

  if (qn && !valid) {
    console.warn(`StatLens: ignoring ?qn=${JSON.stringify(qn)} — it must be 1-6 digits.`);
  }

  const requested = (qs.get('report') || '').trim();
  const key = requested || opts.defaultKey || 'value';
  if (active && requested && opts.keys && !opts.keys.includes(requested)) {
    console.warn(`StatLens: ?report=${requested} is not one of this page's values `
      + `(${opts.keys.join(', ')}); nothing will be posted.`);
  }

  let lastSent = /** @type {string|null} */ (null);

  return {
    active,
    key,
    send(values) {
      if (!active) return;
      const raw = values[key];
      if (raw === undefined) return;
      const value = clean(raw);
      if (value === null) return;
      // Re-posting an unchanged value would re-trigger MOM's grading for no
      // reason; a student nudging a control shouldn't spend an attempt.
      if (value === lastSent) return;
      lastSent = value;
      try {
        window.parent.postMessage(
          JSON.stringify({ subject: SUBJECT, qn, value }), '*');
      } catch (err) {
        console.warn('StatLens: could not post the answer to the parent frame.', err);
      }
    },
  };
}
