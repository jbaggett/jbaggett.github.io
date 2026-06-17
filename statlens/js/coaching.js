// @ts-check
/**
 * Coaching layer (opt-in) for novice students on simulation pages.
 *
 * Pedagogy-forward, low-friction onboarding. Guidance is **state-driven**, not
 * time-driven: hints update only when the student acts (load data, run shuffles),
 * never on an idle timer — so a student *thinking* about a distribution is never
 * interrupted. See the project_onboarding_coaching_design memory.
 *
 * Enabled via the Settings dialog (persisted) or ?coach=true (reliable in LMS
 * embeds where localStorage may be partitioned). settings.js sets the
 * `data-coach="true"` body attribute; this module sets `data-sim-state`
 * (empty | loaded | running | built) which drives:
 *   - the next-step line under the controls,
 *   - the empty-state coach over the chart,
 *   - which generate button is visually emphasized (the happy-path next action).
 *
 * The button emphasis follows the SBI flow: +1 first (do one shuffle), then
 * +1000 (build the distribution), then attention shifts to the chart/results.
 */

import { getCoaching } from './settings.js';

/**
 * Wire up the coaching hints. No-op unless coaching is on. Safe to call once at
 * the end of page init; reads live DOM signals (button state + clicks).
 */
export function initCoaching() {
  if (!getCoaching()) return;
  document.body.setAttribute('data-coach', 'true');

  const controls = document.getElementById('controls');
  const chart = document.getElementById('chart');
  const results = document.getElementById('results');
  const resultSummary = document.getElementById('result-summary');
  const genBtns = /** @type {NodeListOf<HTMLButtonElement>} */ (
    document.querySelectorAll('.gen-btn'));
  const resetBtn = document.getElementById('reset-btn');
  if (!controls || !genBtns.length) return;

  // Next-step line, placed at the top of the results sidebar — next to where
  // students read outcomes, and costing ~no vertical space (the sidebar has
  // slack). On mobile the sidebar stacks below the chart. CSS shows it only
  // while running/building; the empty-state coach carries the start cue.
  const line = document.createElement('p');
  line.className = 'coach-line';
  line.setAttribute('role', 'status'); // aria-live polite
  if (results && resultSummary) results.insertBefore(line, resultSummary);
  else controls.insertAdjacentElement('afterend', line);

  // Empty-state coach, overlaid on the (still empty) chart area.
  let empty = null;
  if (chart) {
    empty = document.createElement('div');
    empty.className = 'coach-empty';
    empty.setAttribute('aria-hidden', 'true'); // decorative; coach-line carries the message for SR
    chart.appendChild(empty);
  }

  let totalRuns = 0;
  let dataLoaded = !genBtns[0].disabled;

  function update() {
    let state, lineHtml, emptyHtml;
    if (!dataLoaded) {
      state = 'empty';
      lineHtml = '👋 Start by choosing a dataset above.';
      emptyHtml = 'Your shuffle results will appear here<br>once you load data and run a shuffle.';
    } else if (totalRuns === 0) {
      state = 'loaded';
      lineHtml = 'Click the highlighted <strong>+1</strong> to shuffle once and watch where the result lands.';
      emptyHtml = 'This space fills with shuffle results.<br><strong>Click +1 to add the first one.</strong>';
    } else if (totalRuns < 100) {
      state = 'running';
      lineHtml = `That's ${totalRuns} shuffle${totalRuns === 1 ? '' : 's'}. Add more shuffles to see the pattern chance produces.`;
      emptyHtml = '';
    } else {
      state = 'built';
      lineHtml = 'Now find the <strong>observed</strong> line on the chart — the fraction of shuffles beyond it is your p-value (see the results panel).';
      emptyHtml = '';
    }
    document.body.setAttribute('data-sim-state', state);
    line.innerHTML = lineHtml;
    if (empty) empty.innerHTML = `<span class="coach-empty-msg">${emptyHtml}</span>`;
  }

  // Detect data load: the generate buttons start disabled and are enabled on load.
  if (!dataLoaded) {
    const obs = new MutationObserver(() => {
      if (!genBtns[0].disabled) {
        dataLoaded = true;
        update();
      }
    });
    obs.observe(genBtns[0], { attributes: true, attributeFilter: ['disabled'] });
  }

  // Count cumulative shuffles from button clicks; reset zeroes the count.
  for (const b of genBtns) {
    b.addEventListener('click', () => {
      totalRuns += Number(b.getAttribute('data-count') || 0);
      update();
    });
  }
  if (resetBtn) {
    resetBtn.addEventListener('click', () => { totalRuns = 0; update(); });
  }

  update();
}
