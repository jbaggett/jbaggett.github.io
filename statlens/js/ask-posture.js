// @ts-check
/**
 * `?ask=` — the tool stops making the decisions.
 *
 * StatKey's randomization page loads with NOTHING decided: an empty plot, an
 * editable null in the sentence, three unchecked tail boxes, no marker on the
 * distribution and no p-value anywhere. To get a number out, a student has to
 * state the null, generate, choose a tail and TYPE the test statistic. Ours
 * loaded with every one of those already answered, so a student could pick the
 * matching tool off the menu, press +1000 and copy a p-value without having
 * decided anything. (Jeff, 2026-10-05: "lots of the cognitive steps have been
 * removed"; "StatKey has this part right and we don't.")
 *
 * This lives in one module because both simulation engines need it and because
 * the alternative is two copies that drift. (Jeff, 2026-10-03: "it feels like
 * we're building lots of one-off bits of code when we should be developing
 * things centrally.")
 *
 * Three steps, named individually rather than bundled behind one posture flag,
 * so an author can hand back ONE per exercise — a problem set that makes you aim
 * the instrument every time is worse than one that never does:
 *
 *   ask=null   blank the null value; no generating until it is stated
 *   ask=tail   no tail chosen, so nothing is shaded
 *   ask=stat   type the test statistic; the observed marker leaves the plot
 *   ask=bounds type both ends of the interval (bootstrap pages); the computed
 *              CI is withheld and the page reports what the typed interval
 *              actually captures, which is rarely the level that was asked for
 *   ask=all    every step the page supports
 *
 * A wrong entry is honoured, not corrected. Aim the right tail at 0.30 when p̂
 * is 0.048 and it shades and counts there. A coherent wrong picture is the thing
 * worth seeing, and the problem grades it, not the tool.
 */

/** @typedef {'left'|'right'|'both'} Tail */

/**
 * @param {object} opts
 * @param {Element|null} opts.after - the panel is inserted after this element
 * @param {{param: string, stat: string}} opts.symbols - e.g. {param:'p', stat:'p̂'}
 * @param {ArrayLike<HTMLButtonElement>} opts.genBtns
 * @param {HTMLInputElement|null} [opts.nullInput] - the page's own null field, mirrored into
 * @param {() => number} opts.count - how many statistics are on screen
 * @param {() => number} opts.observed - the page's own statistic, used for any
 *   step this posture did NOT ask for
 * @param {(stat: number, tail: Tail) => number} opts.extremeCount
 * @param {() => void} opts.onChange - redraw and re-report
 * @param {() => void} [opts.onNullChange] - a new null invalidates the distribution
 * @param {() => Tail} [opts.pageTail] - the page's own direction, for when
 *   `tail` was not asked for
 * @param {string[]} [opts.steps] - what `ask=all` means on this page; a
 *   bootstrap tool has no tail to choose and no null to state
 * @param {(lo: number, hi: number) => number} [opts.insideCount] - how many
 *   statistics fall within a typed interval
 * @param {() => number} [opts.level] - the confidence level that was asked for
 * @param {(config: Record<string, unknown>) => void} [opts.report] - receives
 *   the student's decisions once they are all made, for a grader that marks the
 *   reasoning rather than the number
 */
export function createAskPosture(opts) {
  const raw = (new URLSearchParams(location.search).get('ask') || '').toLowerCase().trim();
  // A page declares the steps it can actually hand back, and anything else is
  // ignored rather than honoured. `ask=tail` on a bootstrap page would otherwise
  // demand a tail choice with no tail buttons to make it with — an unsatisfiable
  // requirement that locks the page on "Your turn" forever.
  const supported = opts.steps ?? ['null', 'tail', 'stat'];
  const requested = raw === 'all' ? supported : raw.split(/[,\s]+/).filter(Boolean);
  const ask = new Set(requested.filter(k => supported.includes(k)));
  /** @param {string} k */
  const asks = (k) => ask.has(k);
  const active = ask.size > 0;

  /** @type {number|null} */ let aimStat = null;
  /** @type {Tail|null} */ let aimTail = null;
  /** @type {number|null} */ let aimLo = null;
  /** @type {number|null} */ let aimHi = null;
  let nullStated = !asks('null');
  /** Last configuration posted, so a nudge does not re-trigger grading. */
  let lastReported = '';

  const api = {
    active,
    asks,
    /** The statistic the shading is aimed at — null until typed, when asked for. */
    get stat() { return asks('stat') ? aimStat : undefined; },
    /** The tail chosen — null until chosen, when asked for. */
    get tail() { return asks('tail') ? aimTail : undefined; },
    /** What the shading is actually aimed at: theirs if asked for, else the page's. */
    aimed() { return asks('stat') ? aimStat : opts.observed(); },
    /** The interval the student typed, once both ends are in. */
    get bounds() {
      return (asks('bounds') && aimLo != null && aimHi != null)
        ? /** @type {[number, number]} */ ([Math.min(aimLo, aimHi), Math.max(aimLo, aimHi)])
        : null;
    },
    /** Everything the posture asked for has been supplied. */
    complete() {
      return (!asks('null') || nullStated)
        && (!asks('tail') || aimTail != null)
        && (!asks('stat') || aimStat != null)
        && (!asks('bounds') || (aimLo != null && aimHi != null));
    },
    /** What is still outstanding, as phrases for a prompt. */
    missing() {
      /** @type {string[]} */ const m = [];
      if (asks('null') && !nullStated) m.push('state the null hypothesis');
      if (asks('tail') && aimTail == null) m.push('choose which tail counts as extreme');
      if (asks('stat') && aimStat == null) m.push('enter the test statistic');
      if (asks('bounds') && (aimLo == null || aimHi == null)) m.push('enter both ends of your interval');
      return m;
    },
    sync,
  };
  if (!active) return api;

  const panel = document.createElement('div');
  panel.className = 'aim-panel';
  const s = opts.symbols;
  panel.innerHTML = `
    ${asks('null') ? `<div class="aim-row"><label for="aim-null">Null hypothesis:
      <span class="aim-sym">${s.param}</span> =</label>
      <input type="number" id="aim-null" step="any" placeholder="?" aria-describedby="aim-null-hint">
      <span class="aim-hint" id="aim-null-hint">State it before you simulate.</span></div>` : ''}
    ${asks('tail') ? `<div class="aim-row" role="group" aria-label="Which tail counts as extreme">
      <span class="aim-label">Tail:</span>
      <div class="seg-control aim-tail">
        <button type="button" data-tail="left" aria-pressed="false">Left</button>
        <button type="button" data-tail="both" aria-pressed="false">Two-tail</button>
        <button type="button" data-tail="right" aria-pressed="false">Right</button>
      </div></div>` : ''}
    ${asks('stat') ? `<div class="aim-row"><label for="aim-stat">Test statistic:
      <span class="aim-sym">${s.stat}</span> =</label>
      <input type="number" id="aim-stat" step="any" placeholder="?" aria-describedby="aim-stat-hint">
      <span class="aim-hint" id="aim-stat-hint">Read it off your sample above.</span></div>` : ''}
    ${asks('bounds') ? `<div class="aim-row"><span class="aim-label">Your interval:</span>
      <label class="sr-only" for="aim-lo">Lower bound</label>
      <input type="number" id="aim-lo" step="any" placeholder="lower">
      <span aria-hidden="true">to</span>
      <label class="sr-only" for="aim-hi">Upper bound</label>
      <input type="number" id="aim-hi" step="any" placeholder="upper">
      <span class="aim-hint">Find the values that cut off the middle of the distribution.</span></div>` : ''}
    <p class="aim-readout" id="aim-readout" role="status" aria-live="polite"></p>`;
  opts.after?.insertAdjacentElement('afterend', panel);

  const nullField = /** @type {HTMLInputElement|null} */ (panel.querySelector('#aim-null'));
  const statField = /** @type {HTMLInputElement|null} */ (panel.querySelector('#aim-stat'));

  nullField?.addEventListener('input', () => {
    const v = parseFloat(nullField.value);
    nullStated = Number.isFinite(v);
    if (nullStated && opts.nullInput) opts.nullInput.value = String(v);
    // The distribution is built FROM the null, so a new one invalidates what is
    // on screen rather than quietly mixing two null worlds.
    if (nullStated && opts.count() > 0) opts.onNullChange?.();
    sync();
  });
  statField?.addEventListener('input', () => {
    const v = parseFloat(statField.value);
    aimStat = Number.isFinite(v) ? v : null;
    sync();
  });
  for (const id of ['#aim-lo', '#aim-hi']) {
    const f = /** @type {HTMLInputElement|null} */ (panel.querySelector(id));
    f?.addEventListener('input', () => {
      const v = parseFloat(f.value);
      const val = Number.isFinite(v) ? v : null;
      if (id === '#aim-lo') aimLo = val; else aimHi = val;
      sync();
    });
  }
  panel.querySelector('.aim-tail')?.addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement} */ (e.target).closest('button[data-tail]');
    if (!btn) return;
    aimTail = /** @type {Tail} */ (btn.getAttribute('data-tail'));
    for (const b of panel.querySelectorAll('.aim-tail button')) {
      b.setAttribute('aria-pressed', String(b === btn));
    }
    sync();
  });

  function sync() {
    if (!active) return;
    const blocked = asks('null') && !nullStated;
    for (const b of Array.from(opts.genBtns)) {
      // Additive: this gate switches a button OFF, never back on — the batch
      // cutoff and the repetition cap have their own reasons to disable one.
      if (blocked) {
        b.disabled = true;
        b.title = 'State the null hypothesis first — the simulation is built from it.';
      } else if (b.title.startsWith('State the null')) {
        b.disabled = false;
        b.title = '';
      }
    }
    const readout = panel.querySelector('#aim-readout');
    if (readout) {
      const want = [];
      if (asks('null') && !nullStated) want.push('a null value');
      if (asks('tail') && aimTail == null) want.push('a tail');
      if (asks('stat') && aimStat == null) want.push('a test statistic');
      const n = opts.count();
      if (n === 0) {
        // With an empty plot, say BOTH outstanding things — "still to choose"
        // alone reads as though the simulation were already there.
        readout.textContent = want.length
          ? `Generate some samples, and choose: ${want.join(', ')}.`
          : 'Now generate some samples.';
      } else if (want.length) {
        readout.textContent = `Still to choose: ${want.join(', ')}.`;
      } else if (asks('bounds') && api.bounds && opts.insideCount) {
        const [lo, hi] = api.bounds;
        const k = opts.insideCount(lo, hi);
        const pct = (k / n) * 100;
        const level = opts.level?.();
        // What the typed interval HOLDS, next to what was asked for. Landing on
        // the level exactly is the exception, not the goal — the gap is the
        // thing being taught.
        readout.innerHTML = `Your interval holds <strong>${k}</strong> of ${n} resamples `
          + `&mdash; <strong>${pct.toFixed(1)}%</strong>`
          + (level ? `. You were asked for <strong>${level}%</strong>.` : '.');
      } else {
        // A step this posture did not ask for still has a value — the page's
        // own. Only the asked-for ones wait on the student.
        const stat = /** @type {number} */ (api.aimed());
        const tail = /** @type {Tail} */ (api.tail ?? opts.pageTail?.() ?? 'both');
        const k = opts.extremeCount(stat, tail);
        const word = tail === 'both' ? 'as far from the centre as'
          : tail === 'left' ? 'at or below' : 'at or above';
        readout.innerHTML = `<strong>${k}</strong> of ${n} simulated statistics are `
          + `${word} <strong>${stat}</strong> &mdash; a proportion of `
          + `<strong>${(k / n).toFixed(4)}</strong>.`;
      }
    }
    // What they decided, once they have decided it all. The number they
    // produced is already posted by the answer channel; this is the reasoning
    // behind it, and without it a grader can only mark the arithmetic.
    if (api.complete() && opts.report) {
      const config = {};
      if (asks('null')) config.nullValue = Number(nullField?.value);
      if (asks('tail')) config.tail = aimTail;
      if (asks('stat')) config.statistic = aimStat;
      if (asks('bounds')) config.bounds = api.bounds;
      config.repetitions = opts.count();
      const key = JSON.stringify(config);
      if (key !== lastReported) { lastReported = key; opts.report(config); }
    }
    opts.onChange();
  }

  sync();
  return api;
}
