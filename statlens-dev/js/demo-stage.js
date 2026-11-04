// @ts-check
/**
 * The shared stage for teaching demos.
 *
 * Todd Will, to Jeff in person: he likes StatLens but would prefer more
 * teaching demos and less of a computational tool that does everything. A page
 * built for a student working alone has to offer everything; a lecturer needs
 * one idea at a time, legible from the back row. The Demos plan
 * (`Stat145_Rebuild/docs/specs/Demos_Plan.md`, REQ-085) settles the shape:
 *
 *   source → one result → a pile that grows, with a scrubber
 *
 * Demos 1–6 all have that shape, so this is **one stage with six
 * configurations, not six tools** — the plan's first rule, and the reason a fix
 * to the pile reaches every demo at once.
 *
 * ⚠ This module owns the TRIAL LOOP and the PILE. It owns no statistics. A
 * demo supplies `drawTrial(rng, i)`, which returns one statistic and whatever
 * the source panel needs to redraw itself; everything the class actually learns
 * lives in the demo's own file. That line is what keeps the stage reusable: a
 * stage that knew what χ² was could not host demo 2.
 *
 * **Exact replay, without storing anything.** Trial *i* draws from
 * `createRng(`${seed}-trial-${i}`)`, a stream of its own, so scrubbing back to
 * trial 11 re-runs trial 11 and gets the same marks, the same table and the
 * same statistic. Nothing is cached, so a 1,000-trial scrubber costs one
 * object. ⚠ This also means a demo's `drawTrial` must be a pure function of the
 * rng it is handed — reading `Math.random`, the clock, or any state left by an
 * earlier trial breaks the scrubber silently.
 *
 * **Live values reach the activity system.** Each trial dispatches
 * `statlens:state` with `{ trials, stat, ... }`, which is the channel activity
 * steps already use to wait for a condition ("500 samples") or to quote a value
 * (`{{stat}}`). The plan requires it: questions live in the activity file, so
 * the bare page stays clean for lecture.
 */

import { createRng } from './prng.js';
import { renderSimChart } from './chart-defaults.js';
import { overlayTheoryOnSimChart, removeTheoryOverlay } from './theory-overlay.js';
import { prefersReducedMotion } from './settings.js';

/**
 * How the pile is drawn, by trial count.
 *
 * From the plan, and it is a teaching device rather than a rendering detail:
 * the display grows with the count, which paces a lecture without the
 * instructor having to say anything. At ten trials you can still see each
 * sample as a sample; by five hundred you are looking at a shape.
 *
 * ⚠ The thresholds are deliberately NOT the site-wide
 * `DOTPLOT_AUTO_THRESHOLD` (1,000). A demo is watched from the back of a room,
 * where individual dots stop reading much sooner than they do on a laptop.
 */
export const PILE_DOTS_MAX = 20;
export const PILE_CURVE_MIN = 500;

/**
 * @typedef {object} DemoTrial
 * @property {number} stat - the one number this trial produced
 * @property {any} [source] - whatever the demo's source panel needs to redraw
 */

/**
 * @typedef {object} DemoStageConfig
 * @property {string} seed
 * @property {(rng: () => number, index: number) => DemoTrial} drawTrial
 *   ⚠ Must be pure in `rng`. See the note on exact replay above.
 * @property {(trial: DemoTrial, index: number, animate?: boolean) => void} [renderSource]
 *   Redraw the source panel for the trial now showing. `animate` is true only
 *   for a SINGLE manual step — never in a batch, never during Play, never when
 *   scrubbing back. A demo that animates may take as long as it likes on +1 and
 *   must be instant otherwise.
 * @property {HTMLElement} pileContainer
 * @property {[number, number]} domain - the FIXED axis; nothing rescales
 * @property {number} binWidth
 * @property {string} xLabel
 * @property {string} [titleText]
 * @property {number} [precision]
 * @property {((x: number) => number)|null} [curvePdf] - drawn from PILE_CURVE_MIN
 * @property {string} [curveLabel]
 * @property {(() => {value: number, direction: 'left'|'right'}|null)} [observedMark]
 *   Consulted on every redraw. Return a value to mark it on the pile and shade
 *   the tail at or beyond it; return null to leave the picture alone. It is a
 *   callback rather than a number because whether the mark BELONGS on screen is
 *   the demo's judgement — demo 1 withholds it until the pile is built, because
 *   "how unusual is this?" is not a question you can ask of twelve dots.
 * @property {HTMLInputElement|null} [scrubEl] - range input; the stage wires it
 * @property {HTMLElement|null} [scrubValueEl] - "11 of 240" readout beside it
 * @property {number} [maxTrials]
 * @property {string} [tool] - name reported on `statlens:state`
 * @property {(s: {trials: number, stat: number|null, showing: number}) => void} [onUpdate]
 */

/**
 * Build a stage. Returns the handle a demo page wires its buttons to.
 *
 * @param {DemoStageConfig} cfg
 */
export function createDemoStage(cfg) {
  const maxTrials = cfg.maxTrials ?? 1000;
  /** Every statistic drawn so far, in order. The pile. */
  /** @type {number[]} */ let stats = [];
  /** Which trial the source panel is showing (1-based; 0 = none yet). */
  let showing = 0;
  /** @type {number|null} */ let playTimer = null;
  let speedMs = 450;

  /**
   * Run trial `i` (1-based) and return it, without touching the pile.
   *
   * Separate from `addTrial` because the scrubber needs to re-run an old trial
   * for display only — if this appended, scrubbing would grow the pile it was
   * meant to look back through.
   */
  function runTrial(i) {
    return cfg.drawTrial(createRng(`${cfg.seed}-trial-${i}`), i);
  }

  function emit(event) {
    const state = {
      trials: stats.length,
      stat: stats.length ? stats[stats.length - 1] : null,
      showing,
      statShowing: showing > 0 && showing <= stats.length ? stats[showing - 1] : null,
      mean: stats.length ? stats.reduce((a, b) => a + b, 0) / stats.length : null,
    };
    try {
      window.dispatchEvent(new CustomEvent('statlens:state',
        { detail: { tool: cfg.tool ?? 'demo', event, state } }));
    } catch { /* CustomEvent unsupported — activities fall back to seed gates */ }
    if (cfg.scrubEl) {
      cfg.scrubEl.disabled = stats.length === 0;
      cfg.scrubEl.max = String(Math.max(1, stats.length));
      cfg.scrubEl.value = String(Math.max(1, showing));
    }
    if (cfg.scrubValueEl) {
      cfg.scrubValueEl.textContent = stats.length ? `${showing} of ${stats.length}` : '—';
    }
    cfg.onUpdate?.({ trials: stats.length, stat: state.stat, showing });
  }

  /** Dots, bars, or bars with a curve — by count. See PILE_DOTS_MAX. */
  function renderPile() {
    if (!cfg.pileContainer) return;
    if (stats.length === 0) {
      cfg.pileContainer.innerHTML = '';
      return;
    }
    const mark = cfg.observedMark?.() ?? null;
    const span = cfg.domain[1] - cfg.domain[0];
    const numBins = Math.max(1, Math.round(span / cfg.binWidth));
    const chart = renderSimChart(cfg.pileContainer, stats, {
      chartType: stats.length <= PILE_DOTS_MAX ? 'dotplot' : 'histogram',
      id: 'demo-pile',
      xLabel: cfg.xLabel,
      titleText: cfg.titleText ?? 'The pile',
      // The axis is fixed by the demo and never recomputed, so a class watching
      // the shape build never has it shift underneath them.
      domain: cfg.domain,
      numBins,
      precision: cfg.precision ?? 2,
      // The newest trial, highlighted, so "that one" is findable while talking.
      highlightIndex: stats.length - 1,
      ...(mark ? { observedStat: mark.value, direction: mark.direction } : {}),
    });
    removeTheoryOverlay(cfg.pileContainer);
    if (cfg.curvePdf && stats.length >= PILE_CURVE_MIN) {
      overlayTheoryOnSimChart(cfg.pileContainer, chart, {
        pdf: cfg.curvePdf,
        totalN: stats.length,
        label: cfg.curveLabel,
      });
    }
  }

  /** Add one trial, show it, and redraw. */
  function addTrial() {
    if (stats.length >= maxTrials) return false;
    const i = stats.length + 1;
    const trial = runTrial(i);
    stats.push(trial.stat);
    showing = i;
    cfg.renderSource?.(trial, i, false);
    return true;
  }

  /**
   * Add `n` trials as one step.
   *
   * ⚠ The source panel is redrawn ONCE, for the last trial, not n times. A
   * batch of 100 that repainted the board 100 times would be a flicker with no
   * information in it, and on a projector it reads as a fault.
   */
  function add(n) {
    let added = 0;
    for (let k = 0; k < n; k++) {
      if (stats.length >= maxTrials) break;
      const i = stats.length + 1;
      stats.push(runTrial(i).stat);
      added++;
    }
    if (added) {
      showing = stats.length;
      // The one case worth watching: a single step, taken by hand. A batch has
      // nothing to show frame by frame, and during Play the next interval would
      // arrive before the animation finished.
      cfg.renderSource?.(runTrial(showing), showing, added === 1 && playTimer === null);
      renderPile();
      emit('add');
    }
    return added;
  }

  /** Show trial `i` again — its source, its table, its place in the pile. */
  function scrubTo(i) {
    const n = Math.max(1, Math.min(stats.length, Math.round(i)));
    if (!stats.length) return;
    showing = n;
    // Looking back, not drawing: the sample already happened.
    cfg.renderSource?.(runTrial(n), n, false);
    emit('scrub');
  }

  function reset() {
    stop();
    stats = [];
    showing = 0;
    cfg.pileContainer.innerHTML = '';
    emit('reset');
  }

  function step() {
    if (!addTrial()) { stop(); return; }
    renderPile();
    emit('step');
  }

  function play() {
    if (playTimer !== null) return;
    // ⚠ Reduced motion gets the RESULT, not a refusal: one jump to the end of
    // what play would have done. A demo that simply does nothing on press reads
    // as broken from the back of a room.
    if (prefersReducedMotion()) { add(50); return; }
    playTimer = window.setInterval(step, speedMs);
    emit('play');
  }

  function stop() {
    if (playTimer !== null) { clearInterval(playTimer); playTimer = null; emit('pause'); }
  }

  function setSpeed(ms) {
    speedMs = ms;
    if (playTimer !== null) { clearInterval(playTimer); playTimer = window.setInterval(step, speedMs); }
  }

  // The scrubber, wired once here rather than in every demo. Demos 1–6 all have
  // one (the plan: "a scrubber. Go back to any earlier trial"), and a stage that
  // leaves each of them to bind the input, clamp the value and keep the readout
  // in step is a stage that will be reimplemented six times, slightly
  // differently. Same argument as `initPlayPause` building its own button.
  if (cfg.scrubEl) {
    cfg.scrubEl.addEventListener('input', () => {
      scrubTo(Number(cfg.scrubEl?.value));
      if (cfg.scrubValueEl) cfg.scrubValueEl.textContent = `${showing} of ${stats.length}`;
    });
  }

  // ⚠ The activity panel asks for state when it loads, and a step that reads a
  // metric is wrong until the tool answers. Required by the authoring guide's
  // tool-author contract, and easy to leave out — nothing fails loudly without
  // it, the numbers are just stale on the first step.
  try {
    window.addEventListener('statlens:request-state', () => emit('sync'));
  } catch { /* no window (unit context) */ }

  return {
    step,
    add,
    play,
    stop,
    reset,
    scrubTo,
    setSpeed,
    renderPile,
    isPlaying: () => playTimer !== null,
    get trials() { return stats.length; },
    get showing() { return showing; },
    get stats() { return stats.slice(); },
    /** Re-run a trial for display without adding it — used by tests and the scrubber. */
    peek: runTrial,
    emit,
  };
}
