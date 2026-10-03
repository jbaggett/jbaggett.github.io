// @ts-check
/**
 * Shared one-sample randomization test page logic for StatLens.
 * Handles both one-proportion (Bernoulli) and one-mean (shifted bootstrap) tests.
 *
 * Each page's app.js calls:
 *   initOneSamplePage({ mode: 'one-prop' })   // or
 *   initOneSamplePage({ mode: 'one-mean' })
 */

import { createRng } from './prng.js';
import { registerShareState, syncUrl, syncUrlOnInteraction, markGenerated, forgetSeed } from './share-state.js';
import { applyRequestedLayout } from './mechanisms/layout.js';
import { wordsFor } from './mechanisms/vocabulary.js';
import { drawBernoulliCount, drawFromShiftedNull } from './mechanisms/draws.js';
import { propBarHTML, populationBarHTML, renderPropResample, hasIndividualView }
  from './prop-bootstrap-mech.js';
import { animateDartScoop, cancelDrawAnimations } from './mechanisms/draw-animation.js';
import { proportionStep } from './grid.js';
import { mean, sd, detectPrecision, formatStat } from './stats.js';
import { drawHistogram, computeBins, snappedPropThresholds } from './histogram.js';
import { drawDotplot, computeDots } from './dotplot.js';
import { drawMechDotplot, showResampleDotplot } from './dotplot-resample.js';
import { renderBagChips, renderResampleChips, CHIP_MAX } from './summary-cards.js';
import { createMeanMechanism, MEAN_DOT_MAX } from './mean-mechanism.js';
import { renderSimPills, formatMechStat, drawMiniChart, morphMiniChart, prefersReducedMotion } from './chart-utils.js';
import { announce, initKeyboardShortcuts, initPlayPause, initTabs, animateDropToChart, flyDataStream, initDataPanel, computeHighlights, initHelp, initSettings, initMechanismCollapse, updateTabHint, getActiveTabId, getTabHintText, setPageTitle, reportInputProblem } from './page-utils.js';
import { initAnswerReport } from './answer-report.js';
import { getSetting } from './settings.js';
import { parseParams } from './url-params.js';
import { normalPdf, overlayTheoryCurve, removeTheoryOverlay, createTheoryToggle } from './theory-overlay.js';
import { resolveChartType, reasoningChartType, discreteColumnSpan, createChartToggle, displayPrecision, isExtreme as isExtremeShared, dotplotBins, histogramThresholds, renderSimChart, createBinAdjuster } from './chart-defaults.js';


/**
 * @typedef {object} OneSampleSimConfig
 * @property {'one-prop'|'one-mean'} mode
 */

/**
 * Initialize a one-sample randomization test page.
 * @param {OneSampleSimConfig} config
 */
export function initOneSamplePage(config) {
  const isProp = config.mode === 'one-prop';
  /**
   * Above this many observations the darts are not thrown — the dots still
   * appear, all at once. Sixty flyers is already a downpour; a hundred and
   * twenty is a screen of moving objects that says nothing the first thirty
   * did not. (The dot block itself survives to 120; see hasIndividualView.)
   */
  const DART_MAX = 60;
  // These pages simulate against a stated null value, so the source panel is
  // the data moved onto the null rather than the data as observed.
  // One-prop's null NAMES a population; one-mean's is the data moved onto the
  // null. Sharing a vocabulary is what let the proportion page call its source
  // "Observed Data" and morph it into something the data never became.
  const words = wordsFor(isProp ? 'statedPopulation' : 'nullWorld');
  applyRequestedLayout('nullWorld');

  // ─── DOM elements ───

  const chartContainer = document.getElementById('chart-container');
  const resultDiv = document.getElementById('result-summary');
  const resetBtn = /** @type {HTMLButtonElement} */ (document.getElementById('reset-btn'));
  const dataSummary = document.getElementById('data-summary');
  const dataPreview = document.getElementById('data-preview');
  const hypothesisDisplay = document.getElementById('hypothesis-display');

  const nullInput = /** @type {HTMLInputElement} */ (
    document.getElementById(isProp ? 'null-prop' : 'null-mean'));
  const altDirectionBtn = /** @type {HTMLButtonElement} */ (document.getElementById('alt-direction'));
  const altNullValue = document.getElementById('alt-null-value');

  const genBtns = /** @type {NodeListOf<HTMLButtonElement>} */ (
    document.querySelectorAll('.gen-btn'));

  // Controls section (for expert toggle)
  const controlsSection = document.getElementById('controls');

  // Note: hypothesis controls (null value, direction) are essential for students — NOT expert-only

  // Add expert toggle link next to generate bar
  const generateBar = /** @type {HTMLElement|null} */ (controlsSection?.querySelector('.generate-bar'));
  // The old inline "More options" button lived here, beside "Shuffles", where it
  // read as more options FOR shuffles. It is now the Simple | Detailed control in
  // the page header (js/page-utils.js initDisplayToggle).

  /**
   * Snapshot the current configuration as a shareable URL state: data source
   * (bundled dataset id, or the ?csv/?data the page loaded with), the null
   * value, alternative direction, success outcome, and the seed.
   * @returns {{dataset?: string, params: Record<string, any>}}
   */
  function getShareState() {
    /** @type {Record<string, any>} */
    const params = {};
    if (seed != null && seed !== '') params.seed = seed;
    if (altDirectionBtn) {
      const dirMap = { right: 'greater', left: 'less', both: 'two-sided' };
      params.direction = dirMap[getDirection()];
    }
    // Null value: ?p= for proportions, ?null_value= for means (omit defaults).
    const nv = getNullValue();
    if (isProp) { if (nv !== 0.5) params.p = nv; }
    else if (nv !== 0) params.null_value = nv;
    // Success outcome for one-proportion.
    const succ = /** @type {HTMLSelectElement|null} */ (successOutcome)?.value;
    if (isProp && succ) params.success = succ;

    /** @type {{dataset?: string, params: Record<string, any>}} */
    const state = { params };
    if (currentDatasetId) {
      state.dataset = currentDatasetId;
    } else {
      const up = /** @type {any} */ (parseParams());
      if (up.csv) params.csv = up.csv;
      else if (up.json) params.json = up.json;
      else if (up.data) params.data = up.data;
    }
    return state;
  }

  // The address bar carries the shareable state, so Share, the QR and a
  // straight copy out of the browser all agree (js/share-state.js). This
  // replaced a "Copy link" button that was the only thing doing it correctly,
  // and existed on two pages out of seventy-one.
  registerShareState(getShareState);
  syncUrlOnInteraction();

  // Mechanism strip
  const mechanismStrip = document.getElementById('mechanism-strip');
  const mechObservedStat = document.getElementById('mech-observed-stat');
  const mechSimStat = document.getElementById('mech-sim-stat');
  const mechanismDescEl = document.getElementById('mechanism-description');
  const simTitleEl = document.getElementById('sim-title');

  // One-prop only
  const successSelector = document.getElementById('success-selector');
  const successOutcome = /** @type {HTMLSelectElement} */ (document.getElementById('success-outcome'));
  const inputN = /** @type {HTMLInputElement} */ (document.getElementById('input-n'));
  const inputSuccesses = /** @type {HTMLInputElement} */ (document.getElementById('input-successes'));
  const loadSummaryBtn = document.getElementById('load-summary');

  initTabs({ hintTarget: resultDiv, hintAction: 'run a simulation to see results' });

  // REQ-055: one-sample randomization pages report the p-value by default.
  const answer = initAnswerReport({ defaultKey: 'p_value', keys: ['p_value', 'count', 'stat'] });
  initKeyboardShortcuts(genBtns, resetBtn);
  initPlayPause(genBtns, resetBtn);
  initHelp();
  initSettings();

  // ─── Mode-dependent constants ───

  const xLabel = isProp ? 'Sample Proportion (p\u0302)' : 'Simulated Mean (x\u0304*)';

  // ─── Chart type toggle ───

  let chartType = 'auto';
  /** @type {HTMLFieldSetElement|null} */
  let toggleFieldset = null;
  /** @type {((type: string) => void)|null} */
  let setToggleSelected = null;
  // ─── Bin adjuster (continuous data only — proportions have fixed k/n bins) ───
  const DEFAULT_BINS = 20;
  /** @type {number|undefined} */
  let userBinCount = isProp ? undefined : DEFAULT_BINS;
  /** @type {import('./chart-defaults.js').BinAdjusterControl|null} */
  let binAdjuster = null;

  if (chartContainer) {
    const toggle = createChartToggle(chartContainer, {
      // p̂ is discrete, so this page offers the spike view — and 'auto' picks it.
      // Without the button the toggle could not show the view being drawn.
      types: isProp
        ? [['dotplot', 'Dotplot'], ['spike', 'Spike'], ['histogram', 'Histogram']]
        : undefined,
      onChange: (type) => {
        chartType = type;
        if (binAdjuster) binAdjuster.setMode(type);
        if (allStats.length > 0) {
          renderChart(allStats, observedStat, getDirection());
        }
      },
    });
    toggleFieldset = toggle.fieldset;
    setToggleSelected = toggle.setSelected;
    // Chart toggle, theory overlay, and bin adjuster are expert-only
    toggle.fieldset.classList.add('expert-only');

    createTheoryToggle(toggleFieldset, (checked) => {
      theoryOverlayOn = checked;
      if (allStats.length > 0 && chartContainer) {
        if (checked) {
          renderChart(allStats, observedStat, getDirection());
        } else {
          removeTheoryOverlay(chartContainer);
        }
      }
    });

    if (!isProp) {
      binAdjuster = createBinAdjuster(toggleFieldset, {
        currentBins: 20,
        onChange: (bins) => {
          userBinCount = bins;
          if (allStats.length > 0) {
            renderChart(allStats, observedStat, getDirection());
          }
        },
      });
    }
  }

  // ─── State ───

  /** @type {number[]} */
  let allStats = [];
  /** @type {(() => number)|null} */
  let rng = null;
  // Seed: honor a URL seed for reproducibility (shared links / graded work),
  // otherwise random each session.
  const urlSeed = parseParams().seed;
  let seed = urlSeed ?? Math.random().toString(36).slice(2, 10);

  // Reasoning mode (?readout=false) / figure-only embed (?plot=only): hide the
  // p-value + tail shading + pills so students read the result off the null
  // distribution; plot=only also auto-runs once and shows only the chart.
  // (parseParams only surfaces known typed params — read these straight.)
  const _usp = new URLSearchParams(location.search);
  const plotOnly = _usp.get('plot') === 'only';
  let plotOnlyRan = false;
  const showReadout = !plotOnly
    && !/^(false|0|no)$/i.test(_usp.get('readout') || '');

  let sampleN = 0;
  let observedStat = 0;
  let dataPrecision = 0;
  let theoryOverlayOn = false;
  /** Whether the mechanism strip has been initialized (deferred to first generate). */
  let mechanismInitialized = false;
  /** Whether the left panel has been morphed from "Observed" to "Null Distribution". */
  let nullShown = false;
  /** The Observed/Null view toggle buttons (built lazily). */
  /** @type {NodeListOf<HTMLButtonElement>|null} */
  let nullToggleBtns = null;
  /** The title element of the observed/null panel. */
  const mechObservedTitle = document.querySelector('#mech-observed .mechanism-title');
  /** @type {{ population?: string, parameter?: string, nullClaim?: string, successLabel?: string }} */
  let datasetContext = {};
  /** Base page title (before dataset context). */
  const baseTitle = document.title.replace(/\s*\|\s*StatLens$/, '');
  /** Track current data source name for display. */
  let currentSourceName = '';
  /** Bundled dataset id (for the Copy-link button); '' when data came from CSV/URL. */
  let currentDatasetId = '';

  /** @type {{ xScale: any, yScale: any, bins: any[], domain: [number,number] } | null} */
  let lastHistResult = null;
  /** @type {{ xScale: any, frame: any, domain: [number,number], maxStack: number, numBins: number } | null} */
  let lastDotResult = null;
  /** Pre-simulated domain for stable axis limits. */
  /** @type {[number,number]|null} */
  let preSimDomain = null;

  // One-prop state
  let sampleSuccesses = 0;
  /** @type {string[]} */
  let rawOutcomes = [];

  // One-mean state
  /** @type {number[]} */
  let sampleData = [];
  /** @type {number[]} */
  let shiftedData = [];

  // ─── Shared helpers ───

  /** Recompute shifted data for one-mean (no-op for one-prop). */
  function computeShiftedData() {
    if (isProp) return;
    const mu0 = getNullValue();
    const shift = mu0 - observedStat;
    shiftedData = sampleData.map(v => v + shift);
  }

  /**
   * Compute a shared domain that covers both original and shifted data,
   * so the boxplot morph slides smoothly without rescaling.
   * @returns {[number, number]}
   */
  function sharedBoxplotDomain() {
    const all = sampleData.concat(shiftedData);
    if (all.length === 0) return [0, 1];
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const pad = (hi - lo) * 0.08 || 0.5;
    return [lo - pad, hi + pad];
  }

  // ── Shared mean mechanism (Tiles | Dotplot | Histogram) ───────────────────
  // The bootstrap CI for a mean and this randomization test use the SAME
  // controller (js/mean-mechanism.js) so the two strips can't drift. The only
  // difference — the null shift — is handled here: we just hand renderBag the
  // observed or null-shifted values, and animate the shift ourselves.
  /** Chip text honouring the data precision. */
  const fmtChip = (/** @type {number} */ v) => (Number.isInteger(v) ? String(v) : formatStat(v, dataPrecision));
  // The dotplot leads for numeric data, matching bootstrap-mean: at the sample
  // sizes where you can watch a resample happen, tiles showed two rows of
  // numbers and the dotplot never appeared unless you found the toggle. Tiles
  // say WHICH values were drawn and how often; the dotplot says what the sample
  // looks like and hands its statistic to the distribution — the thing being
  // taught. `?mechview=tiles` still asks for the other one, and the toggle is
  // one click away. Proportions are unaffected: they have their own mechanism.
  // (Jeff, 2026-09-27.)
  const mechviewParam = (new URLSearchParams(location.search).get('mechview') || '').toLowerCase();
  const initialView = mechviewParam === 'dotplot' ? 'dotplot'
    : (mechviewParam === 'tiles' || mechviewParam === 'summary') ? 'summary'
    : (isProp ? 'summary' : 'dotplot');
  const mech = createMeanMechanism({ formatValue: fmtChip, initialView });
  /** Hold the observed sample on the very first shift so it's clear what we start from. */
  let firstShiftDone = false;
  const meanMechActive = () => !isProp && sampleData.length >= 2 && sampleData.length <= MEAN_DOT_MAX;
  const useCards = () => !isProp && mech.useCards(sampleData.length);
  const useDots = () => !isProp && mech.useDots(sampleData.length);
  // Latest resample (page scope so the view-render helpers + toggle can re-render).
  let lastSimStat = 0;
  /** @type {number[]|null} */
  let lastResampleArr = null;
  /** Which observation each draw took — the animation is blind without it. */
  /** @type {number[]|null} */
  let lastResampleIdx = null;

  const obsChartEl = () => /** @type {HTMLElement|null} */ (document.getElementById('mech-obs-chart'));

  /** Render the left "bag" panel using the observed or null-shifted sample. */
  function renderMeanBagView() {
    const el = obsChartEl();
    if (!el || sampleData.length < 2) return;
    const vals = nullShown ? shiftedData : sampleData;
    const meanVal = nullShown ? getNullValue() : observedStat;
    mech.renderBag(el, vals, meanVal, {
      domain: sharedBoxplotDomain(), meanLabel: 'x̄',
      label: nullShown ? 'Null-shifted sample' : 'Observed sample',
    });
  }

  /** Render the right resample panel (drawn from the null-shifted bag). Returns ms. */
  function renderMeanResampleView(animate) {
    const el = /** @type {HTMLElement|null} */ (document.getElementById('mech-sim-chart'));
    if (!el || !lastResampleArr || lastResampleArr.length < 2) return 0;
    return mech.renderResample(el, shiftedData, lastResampleArr, lastSimStat, animate, {
      domain: sharedBoxplotDomain(), meanLabel: 'x̄*',
      label: 'Simulated resample from null distribution',
      indices: lastResampleIdx ?? undefined,
    });
  }

  /**
   * The proportion draw: dots, scooped off the null population.
   *
   * Same mechanism as the Sampling Distribution Lab, so the same picture —
   * darts rain onto the population, stick, and fly into the sample as dots,
   * leaving footprints that show where this sample came from. The Lab draws
   * from a population at p; this page draws from one at p₀. That is the only
   * difference, and it belongs in the label, not in the animation.
   * (Jeff, 2026-10-03.)
   *
   * @param {number[]} trials - the draw, successes first
   * @param {boolean} animate
   * @returns {number} ms
   */
  function renderPropDraw(trials, animate) {
    const host = /** @type {HTMLElement|null} */ (mechSimStat?.querySelector('.mech-prop-draw'));
    if (!host) return 0;
    renderPropResample(host, trials, {
      style: 'dots', label: 'This simulated sample', delta: false, wide: true,
    });
    if (!animate) return 0;
    // The board only exists while the null side is showing. Toggle back to the
    // observed sample and there is nothing to throw at — the generic data
    // stream runs instead (see `ownAnim`).
    // The POPULATION board, not the sample beside it: `pbm-population` is the
    // class populationBarHTML puts on the one you draw from.
    const board = /** @type {HTMLElement|null} */
      (mechObservedStat?.querySelector('.mech-prop-bar.pbm-population'));
    const dots = /** @type {HTMLElement[]} */ ([...host.querySelectorAll('.pbm-dot')]);
    if (!board || dots.length !== trials.length) return 0;
    const mark = (/** @type {boolean} */ ok) =>
      `obs-mark pbm-dot ${ok ? 'pbm-success' : 'pbm-failure'}`;
    return animateDartScoop({
      board,
      split: getNullValue(),
      targets: dots,
      successCount: trials.reduce((a, v) => a + v, 0),
      flyerClass: (ok) => `pbm-flyer ${mark(ok)}`,
      ghostClass: (ok) => `scoop-ghost ${mark(ok)}`,
      max: DART_MAX,
    });
  }

  /** Animate the bag cards' values observed→shifted (or back) so students see the
   *  SAME constant subtracted from every observation. */
  function animateCardsShift(toNull) {
    const chips = mech.bagChips;
    const fromVals = (toNull ? [...sampleData] : [...shiftedData]).sort((a, b) => a - b);
    const toVals = (toNull ? [...shiftedData] : [...sampleData]).sort((a, b) => a - b);
    if (!chips.length || chips.length !== toVals.length) { renderMeanBagView(); return 0; }
    const setVal = (/** @type {HTMLElement} */ c, /** @type {number} */ v) => { c.textContent = fmtChip(v); };
    if (prefersReducedMotion()) { chips.forEach((c, i) => setVal(c, toVals[i])); return 0; }
    const DUR = 950;
    const t0 = performance.now();
    chips.forEach(c => c.classList.add('chip-shifting'));
    function step(now) {
      const t = Math.min((now - t0) / DUR, 1);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      for (let i = 0; i < chips.length; i++) setVal(chips[i], fromVals[i] + (toVals[i] - fromVals[i]) * e);
      if (t < 1) { requestAnimationFrame(step); return; }
      chips.forEach((c, i) => { setVal(c, toVals[i]); c.classList.remove('chip-shifting'); });
    }
    requestAnimationFrame(step);
    return DUR;
  }

  /** (Re)draw the bag dotplot with `values` (used by the null-shift glide). */
  function drawMeanBag(values, meanVal) {
    const el = obsChartEl();
    if (el && values.length >= 2) mech.renderBag(el, values, meanVal, { domain: sharedBoxplotDomain(), meanLabel: 'x̄' });
  }

  /** Slide the bag's dots + mean line by `deltaPx` → 0 (the observed↔null shift).
   *  The dots are already drawn at their shifted positions; we start them at the
   *  observed offset and slide to 0 (uniform block — the shift IS uniform). Returns ms. */
  function glideBag(deltaPx) {
    if (!mech.bag || prefersReducedMotion()) return 0;
    const inner = mech.bag.frame.inner;
    const groups = /** @type {SVGGElement[]} */ (Array.from(inner.querySelectorAll('.data, .overlays')));
    const DUR = 850;
    groups.forEach(g => { g.style.transition = 'none'; g.style.transform = `translateX(${deltaPx}px)`; });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      groups.forEach(g => { g.style.transition = `transform ${DUR}ms ease`; g.style.transform = 'translateX(0)'; });
    }));
    return DUR;
  }

  function getNullValue() {
    const val = parseFloat(nullInput?.value);
    if (!isFinite(val)) return isProp ? 0.5 : 0;
    if (isProp && (val < 0 || val > 1)) return 0.5;
    return val;
  }

  function getDirection() {
    const alt = altDirectionBtn?.dataset.value ?? 'greater';
    if (alt === 'greater') return /** @type {const} */ ('right');
    if (alt === 'less') return /** @type {const} */ ('left');
    return /** @type {const} */ ('both');
  }

  /**
   * @param {number[]} [stats] - defaults to every stat currently on screen
   * @returns {'dotplot'|'histogram'|'spike'}
   */
  function getActiveChartType(stats = allStats) {
    // Reasoning-mode figures (plot=only / readout=false) hide the chart toggle:
    // discrete spike bars for a small/moderate-n proportion, binning to a
    // histogram only once the k/n values would crowd (see sim-app.js note).
    if ((plotOnly || !showReadout) && chartType === 'auto') {
      return reasoningChartType(stats, { proportion: isProp });
    }
    // p̂ moves in steps of 1/n, so a big sample spans more achievable values
    // than a dotplot can draw apart — bin them rather than overlap them.
    return resolveChartType(stats.length, chartType,
      { discreteColumns: isProp ? discreteColumnSpan(stats, proportionStep(sampleN) ?? 0) : 0 });
  }

  function syncAltNullValue() {
    if (altNullValue) altNullValue.textContent = nullInput?.value ?? (isProp ? '0.5' : '0');
  }

  /**
   * Whether Step 1 also draws your observed sample under the null population.
   *
   * OFF since 2026-10-03, the day it went on: Jeff didn't like the placement
   * ("I don't like the placement of the observed sample bar below the null bar,
   * let's remove or hide it for now"). Left as one flag rather than deleted,
   * because the thing it was for — comparing your p̂ against p₀ by eye — is
   * still a real want and may come back somewhere else on the page.
   *
   * Nothing is lost meanwhile: p̂ is in the data bar at the top, and the Step 3
   * distribution now marks BOTH values, so the comparison happens where the
   * decision does.
   */
  const SHOW_SAMPLE_IN_SOURCE = false;

  /**
   * Step 1 on the proportion page: the population H₀ names, and your sample.
   *
   * TWO OBJECTS, drawn on the same board at the same width so the two
   * boundaries can be compared by eye — not two states of one object. The old
   * panel showed the observed sample and morphed it into the null, which
   * animates a transformation that does not happen: your sample contributes
   * nothing to building this population. H₀ states p₀ outright, you draw n
   * independent trials from it, and the sample enters once, at the end, as the
   * thing you compare against. (Jeff, 2026-10-03: "that doesn't really fit here
   * like it does for the one sample mean randomization test.")
   *
   * The arrow leaves the NULL board — that is what the draw comes from — and
   * the darts are thrown at it (see renderPropDraw's `.pbm-population` lookup).
   *
   * Rebuilt whenever p₀ changes, so the board is a live picture of the H₀ box
   * above it: type 0.3 and the boundary moves.
   */
  function renderPropSource() {
    if (!isProp || !mechObservedStat || sampleN === 0) return;
    const p0 = getNullValue();
    const label = SHOW_SAMPLE_IN_SOURCE
      ? `what H\u2080 says \u00b7 <span class="is-parameter">p\u2080 = ${p0}</span>`
      : `<span class="is-parameter">p\u2080 = ${p0}</span>`;
    let html = `<span class="pbm-src-row"><span class="pbm-src-label">${label}</span>`
      + populationBarHTML(p0, { style: 'margin-top:2px', board: true }) + '</span>';
    if (SHOW_SAMPLE_IN_SOURCE) {
      html += `<span class="pbm-src-row"><span class="pbm-src-label">your sample \u00b7 `
        + `<span class="is-statistic">p\u0302 = ${fmtObs(observedStat)}</span>`
        + `<span class="pbm-src-count"> (${sampleSuccesses} of ${sampleN})</span></span>`
        + propBarHTML(sampleSuccesses, sampleN - sampleSuccesses,
            { style: 'margin-top:2px', board: true })
        + '</span>';
    }
    mechObservedStat.innerHTML = html;
  }

  /** Format observed stat for display. */
  function fmtObs(v) {
    return isProp ? formatStat(v, 0, 'proportion') : formatStat(v, dataPrecision);
  }

  /** HTML for the stat symbol. */
  const statSymbolHTML = isProp ? 'p\u0302' : '<span class="x-bar">x</span>';

  /** Scroll to controls after data loads. */
  function scrollToControls() {
    setTimeout(() => {
      const target = document.getElementById('controls') || genBtns[0]?.closest('.generate-bar');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }

  /** Enable generate buttons and show hypothesis. */
  /**
   * Show the mechanism strip, with the source panel already in it.
   *
   * On load rather than on the first +1: a student who loads data should see
   * what is about to be drawn from before they draw from it, not after. (Todd's
   * idea, via Jeff, 2026-10-03.) Idempotent, and still called from the first
   * generate so a page that reaches +1 another way still initialises.
   */
  function initMechanismStrip() {
    if (mechanismInitialized || !mechanismStrip) return;
    mechanismInitialized = true;
    mechanismStrip.hidden = false;
    initMechanismCollapse(mechanismStrip);
    ensureNullToggle();
    ensureMeanViewToggle();
    // The proportion page's source is its null POPULATION, which exists as soon
    // as H₀ does — so it can be drawn now. The mean page's source is the
    // null-SHIFTED sample, and the shift is an animation the first +1 performs;
    // seeding it here would play the morph to an empty room.
    if (isProp) renderPropSource();
    else renderMeanBagView();
  }

  function enableControls() {
    if (hypothesisDisplay) hypothesisDisplay.hidden = false;
    for (const btn of genBtns) btn.disabled = false;
    initMechanismStrip();
    resultDiv.innerHTML = '<p class="hint">Data loaded. Click a generate button to begin.</p>';

    // Figure-only embed: auto-run the largest batch once so the finished,
    // hoverable null distribution appears with no click (the generate bar is
    // hidden under plot=only, so there is no other way to run it).
    if (plotOnly && !plotOnlyRan) {
      plotOnlyRan = true;
      const bigBtn = genBtns[genBtns.length - 1];
      if (bigBtn) requestAnimationFrame(() => bigBtn.click());
    }
  }

  /**
   * Run a silent pre-simulation to establish stable axis limits.
   * Called after data loads so the chart domain doesn't jump as resamples accumulate.
   */
  function computePreSimDomain() {
    const PRE_N = 2000;
    const TRIM = 5;
    // Seeded from the page's seed, not the wall clock. This pilot fixes the
    // axis limits AND the dotplot's bin grid, so a clock seed made the same
    // ?seed= link draw a visibly different chart on every load — different
    // axis range, different bins, different shape — while the statistics
    // underneath were perfectly reproducible. url-api.md promises this
    // parameter is "critical for graded assessments where reproducibility is
    // required"; half of it was. (Found 2026-09-27 while trying to build a
    // no-visual-change guard and discovering nothing on these pages could be
    // stable run to run.)
    const preRng = createRng('presim-' + seed);
    const preStats = [];
    const p0 = getNullValue();

    if (isProp) {
      for (let i = 0; i < PRE_N; i++) {
        let k = 0;
        for (let j = 0; j < sampleN; j++) {
          if (preRng() < p0) k++;
        }
        preStats.push(k / sampleN);
      }
    } else {
      // One-mean: shifted bootstrap
      const shift = p0 - observedStat;
      const shifted = sampleData.map(v => v + shift);
      for (let i = 0; i < PRE_N; i++) {
        preStats.push(mean(drawFromShiftedNull(shifted, preRng).values));
      }
    }

    if (preStats.length === 0) { preSimDomain = null; return; }

    preStats.sort((a, b) => a - b);
    const lo = preStats[TRIM];
    const hi = preStats[preStats.length - 1 - TRIM];
    const pad = (hi - lo) * 0.1 || 0.05;
    preSimDomain = [lo - pad, hi + pad];

    // Render empty chart with pre-sim axes
    renderChart([], observedStat, getDirection());
  }

  // ─── Data loading ───

  if (isProp) {
    // One-prop: categorical data input

    /**
     * Populate success outcome selector.
     * @param {string[]} levels
     * @param {string} [autoSelect]
     */
    function populateSuccessSelector(levels, autoSelect) {
      if (!successSelector || !successOutcome) return;
      successOutcome.innerHTML = '';
      for (const lev of levels) {
        const opt = document.createElement('option');
        opt.value = lev;
        opt.textContent = lev;
        successOutcome.appendChild(opt);
      }
      // URL param ?success= takes priority over dataset context hint
      const urlSuccess = new URLSearchParams(location.search).get('success');
      if (urlSuccess && levels.includes(urlSuccess)) {
        successOutcome.value = urlSuccess;
      } else if (autoSelect && levels.includes(autoSelect)) {
        successOutcome.value = autoSelect;
      }
      successSelector.hidden = false;
      applyDatasetOutcome();
    }

    function applyDatasetOutcome() {
      const successVal = successOutcome?.value;
      if (!successVal || rawOutcomes.length === 0) return;

      sampleN = rawOutcomes.length;
      sampleSuccesses = rawOutcomes.filter(v => v === successVal).length;
      observedStat = sampleSuccesses / sampleN;

      resetSimulation();
      enableControls();
      if (dataSummary) {
        const namePrefix = currentSourceName ? `${currentSourceName}: ` : '';
        dataSummary.innerHTML = `${namePrefix}n = ${sampleN}, successes = ${sampleSuccesses} ("${successVal}"), <span class="observed-highlight">p\u0302 = ${fmtObs(observedStat)}</span>`;
      }

      // Populate mechanism strip content (stays hidden until first generate)
      renderPropSource();
      computePreSimDomain();
      scrollToControls();
    }

    const propDataApi = initDataPanel({
      autoCollapse: true,
      stickyControls: true,
      showPreview: true,
      datasetFilter: (/** @type {any} */ ds) => ds.type === 'bootstrap_prop',
      onDataset: (/** @type {any} */ ds) => {
        const catVar = ds.variables.find(/** @param {any} v */ v => v.type === 'categorical') || ds.variables[0];
        if (!catVar) { announce('No categorical variable found.'); return; }
        rawOutcomes = ds.rows.map(/** @param {any} r */ r => String(r[catVar.name]));
        const levels = [...new Set(rawOutcomes)];
        datasetContext = ds.context || {};
        currentSourceName = ds.name || '';
        currentDatasetId = ds.id || '';
        populateSuccessSelector(levels, datasetContext.successLabel);
        announce(`${ds.name}.`);
      },
      onText: (/** @type {any} */ parsed) => {
        let catIdx = parsed.types.indexOf('categorical');
        // Inline 0/1 samples (e.g. ?data=1,1,0,1) type as a single NUMERIC
        // column, but for a one-proportion test a binary 0/1 column IS the
        // outcome. Accept it as a proportion (successes = count of 1s) instead
        // of rejecting — mirroring sim-app.js's numeric fallback for
        // bootstrap-prop, so ?data=…&success=1 loads here too.
        if (catIdx < 0) {
          const numIdx = parsed.types.indexOf('numeric');
          const numName = numIdx >= 0 ? parsed.headers[numIdx] : null;
          const vals = numName ? parsed.data.map(/** @param {any} r */ r => r[numName]) : [];
          // parseCSV keeps cell values as strings even for a numeric column, so
          // test against "0"/"1" (or numeric 0/1) after trimming.
          const isBinary = vals.length > 0 && vals.every(/** @param {any} v */ v => {
            const s = String(v).trim();
            return s === '0' || s === '1';
          });
          if (isBinary) {
            catIdx = numIdx;
          } else {
            announce('Need at least one categorical column, or a single 0/1 outcome column.');
            return;
          }
        }
        const colName = parsed.headers[catIdx];
        rawOutcomes = parsed.data.map(/** @param {any} r */ r => String(r[colName]));
        currentSourceName = '';
        currentDatasetId = '';
        populateSuccessSelector([...new Set(rawOutcomes)]);
      },
      onClear: () => {
        rawOutcomes = [];
        datasetContext = {};
        currentSourceName = '';
        currentDatasetId = '';
        resetSimulation();
        if (dataPreview) dataPreview.hidden = true;
        if (dataSummary) dataSummary.textContent = '\u2014';
        for (const btn of genBtns) btn.disabled = true;
        announce('Data cleared.');
      },
    });

    if (successOutcome) {
      successOutcome.addEventListener('change', applyDatasetOutcome);
    }

    // Summary input tab
    if (loadSummaryBtn) {
      loadSummaryBtn.addEventListener('click', () => {
        const n = parseInt(inputN?.value, 10);
        const k = parseInt(inputSuccesses?.value, 10);
        if (!n || n < 1 || !isFinite(k) || k < 0 || k > n) {
          reportInputProblem(loadSummaryBtn,
            !n || n < 1
              ? 'Enter a sample size (n) — the grey number is only an example.'
              : `Successes must be a whole number between 0 and ${n}.`);
          return;
        }
        reportInputProblem(loadSummaryBtn, '');
        // A new problem, so the old study goes with it — same gap as sim-app's
        // summary handler (Todd Will, REQ-068 B): the dataset's name and its
        // `nullClaim` sentence used to survive summary entry and sit over
        // numbers from somewhere else.
        datasetContext = {};
        currentSourceName = '';
        sampleN = n;
        sampleSuccesses = k;
        observedStat = k / n;

        resetSimulation();
        enableControls();
        if (dataSummary) {
          dataSummary.innerHTML = `n = ${n}, successes = ${k}, <span class="observed-highlight">p\u0302 = ${fmtObs(observedStat)}</span>`;  // No dataset name for manual summary input
        }
        // Populate mechanism strip content (stays hidden until first generate)
        renderPropSource();
        propDataApi.triggerPostLoad();
        setPageTitle(baseTitle, currentSourceName, { n });
        announce(`Data loaded: n = ${n}, successes = ${k}`);
        scrollToControls();
      });
    }
  } else {
    // One-mean: numeric data input

    /** @param {number[]} values */
    function loadNumericData(values) {
      sampleData = values;
      sampleN = values.length;
      observedStat = mean(sampleData);
      dataPrecision = detectPrecision(sampleData);

      resetSimulation();
      enableControls();

      if (dataSummary) {
        const sampleSD = sd(sampleData);
        const namePrefix = currentSourceName ? `${currentSourceName}: ` : '';
        dataSummary.innerHTML = `${namePrefix}n = ${sampleN}, <span class="observed-highlight"><span class="x-bar">x</span> = ${formatStat(observedStat, dataPrecision)}</span>, s = ${formatStat(sampleSD, dataPrecision)}`;
      }

      computeShiftedData();

      // Populate mechanism strip content (stays hidden until first generate)
      if (mechObservedStat) {
        mechObservedStat.innerHTML = `<div id="mech-obs-chart" class="mech-chart-container"></div>
          <span class="mech-stat-text">n = ${sampleN}, <span class="observed-highlight"><span class="x-bar">x</span> = ${formatStat(observedStat, dataPrecision)}</span></span>`;
        const obsChartEl = document.getElementById('mech-obs-chart');
        if (obsChartEl && sampleData.length >= 2) {
          mech.resetSizing(); // recompute sizing for the new dataset
          renderMeanBagView();
        }
      }
      computePreSimDomain();
      setPageTitle(baseTitle, currentSourceName, { n: sampleN });
      scrollToControls();
    }

    initDataPanel({
      autoCollapse: true,
      stickyControls: true,
      showPreview: true,
      // Single-quantitative-variable datasets only — match the CI-for-a-mean tool
      // (simulate/bootstrap-mean). Excludes regression and paired datasets, which
      // have multiple numeric columns and aren't appropriate for a one-mean test.
      datasetFilter: (/** @type {any} */ ds) =>
        ds.hasNumeric === true && ds.hasCategorical !== true
        && ds.type !== 'regression' && ds.type !== 'paired',
      onDataset: (/** @type {any} */ ds) => {
        const numVar = ds.variables.find(/** @param {any} v */ v => v.type === 'numeric') || ds.variables[0];
        if (!numVar) { announce('No numeric variable found.'); return; }
        const values = ds.rows
          .map(/** @param {any} r */ r => Number(r[numVar.name]))
          .filter(/** @param {number} v */ v => isFinite(v));
        if (values.length === 0) { announce('No valid numeric values found.'); return; }
        datasetContext = ds.context || {};
        currentSourceName = ds.name || '';
        currentDatasetId = ds.id || '';
        adoptDatasetNull(ds);
        loadNumericData(values);
        announce(`${ds.name}.`);
      },
      onText: (/** @type {any} */ parsed) => {
        const numIdx = parsed.types.indexOf('numeric');
        if (numIdx < 0) {
          announce('Need at least one numeric column.');
          return;
        }
        const colName = parsed.headers[numIdx];
        const values = parsed.data
          .map(/** @param {any} r */ r => Number(r[colName]))
          .filter(/** @param {number} v */ v => isFinite(v));
        if (values.length === 0) { announce('No valid numeric values found.'); return; }
        currentSourceName = '';
        currentDatasetId = '';
        loadNumericData(values);
      },
      onClear: () => {
        sampleData = [];
        shiftedData = [];
        datasetContext = {};
        currentSourceName = '';
        currentDatasetId = '';
        resetSimulation();
        if (dataPreview) dataPreview.hidden = true;
        if (dataSummary) dataSummary.textContent = '\u2014';
        if (hypothesisDisplay) hypothesisDisplay.hidden = true;
        for (const btn of genBtns) btn.disabled = true;
        announce('Data cleared.');
      },
    });
  }

  // ─── Null value & direction ───

  if (nullInput) {
    nullInput.addEventListener('change', () => {
      syncAltNullValue();
      if (!isProp && sampleData.length > 0) {
        computeShiftedData();
      }
      // Revert left panel so the next +1 will re-morph to the new null value
      if (nullShown) revertToObserved();
      if (allStats.length > 0) {
        resetSimulation();
        const paramLabel = isProp ? 'Null proportion' : 'Null mean';
        resultDiv.innerHTML = `<p class="hint">${paramLabel} changed. Run simulation again.</p>`;
        announce(`${paramLabel} changed. Simulation reset.`);
      }
      // Recompute pre-sim domain for new null value
      if (sampleN > 0) computePreSimDomain();
    });
    nullInput.addEventListener('input', syncAltNullValue);
    // Step 1 is a picture of this box: change p₀ and the boundary moves.
    //
    // On `change`, NOT on `input`. Redrawing per keystroke opened a window where
    // the board showed 0.3 while the distribution below it had been built at
    // 0.5 — and a picture is read faster than a number, so that window lies
    // louder than the input does. `change` fires at the same moment the handler
    // above resets the simulation, so the board and the chart move together.
    nullInput.addEventListener('change', renderPropSource);
  }

  if (altDirectionBtn) {
    const vals = (altDirectionBtn.dataset.values || '').split(',');
    const labels = (altDirectionBtn.dataset.labels || '').split(',');
    altDirectionBtn.addEventListener('click', () => {
      const cur = vals.indexOf(altDirectionBtn.dataset.value || 'greater');
      const next = (cur + 1) % vals.length;
      altDirectionBtn.dataset.value = vals[next];
      altDirectionBtn.textContent = labels[next];
      if (allStats.length > 0) {
        const direction = getDirection();
        renderChart(allStats, observedStat, direction);
        const { pValue, extremeCount } = computePValue(allStats, observedStat, direction);
        displayResults(allStats, observedStat, pValue, extremeCount, direction);
      }
    });
  }

  /** Whether the null came from the URL, which beats anything a dataset says. */
  let urlNullValue = false;

  /**
   * Take the null value a dataset ships, if it has one for this test.
   *
   * There is no defensible default μ₀ for a mean, and 0 is the worst available
   * one: pick "Coast Starlight" (centred near 130) and the page tested μ₀ = 0,
   * ran a thousand simulations and reported p = 0, with nothing on screen
   * suggesting the question rather than the data was the problem. 23 of the 136
   * datasets carry a `one-mean` null in `inferenceContexts` and the page was
   * ignoring all of them. A proportion needs no such rescue — p₀ = 0.5 is
   * defensible for any proportion — so this is means only.
   * (Jeff, 2026-10-03.)
   *
   * An explicit `?null_value=` still wins: a link is a deliberate act.
   *
   * @param {any} ds
   */
  function adoptDatasetNull(ds) {
    if (isProp || urlNullValue || !nullInput) return;
    const ctx = Array.isArray(ds?.inferenceContexts) ? ds.inferenceContexts : [];
    const hit = ctx.find((/** @type {any} */ c) => c && c.test === 'one-mean'
      && Number.isFinite(Number(c.nullValue)));
    if (!hit) return;
    nullInput.value = String(Number(hit.nullValue));
    syncAltNullValue();
  }

  // ─── Apply URL params for hypothesis (from cross-links) ───
  {
    const urlP = parseParams();
    // Set null value from ?p= (proportion) or ?null_value= (mean).
    //
    // `null_value` is accepted on the proportion page too. It is the obvious
    // name, it is what every other page spells it, and typing it there did
    // nothing at all — no warning, no effect, just the default null and a
    // simulation answering a question nobody asked. `p` stays the documented
    // spelling for proportions. (2026-10-02.)
    const nullVal = isProp ? (urlP.p ?? urlP.null_value) : urlP.null_value;
    if (nullVal != null && nullInput) {
      nullInput.value = String(nullVal);
      urlNullValue = true;
      syncAltNullValue();
    }
    // Set direction from ?direction=
    if (urlP.direction && altDirectionBtn) {
      const vals = (altDirectionBtn.dataset.values || '').split(',');
      const labels = (altDirectionBtn.dataset.labels || '').split(',');
      // Map inference page values to sim page values
      const dirMap = { 'less': 'less', 'greater': 'greater', 'two-sided': 'twosided', 'twosided': 'twosided' };
      const mapped = dirMap[urlP.direction] || urlP.direction;
      const idx = vals.indexOf(mapped);
      if (idx >= 0) {
        altDirectionBtn.dataset.value = vals[idx];
        altDirectionBtn.textContent = labels[idx];
      }
    }
  }

  // ─── Null distribution morph ───

  /**
   * Build the Observed ↔ Null view toggle inside the left mechanism panel (once),
   * so an instructor can step between "the original sample" and "what it looks
   * like if H₀ is true" at their own pace instead of relying on the auto-morph.
   */
  /**
   * Set a panel heading's words without evicting what lives in it.
   *
   * The Observed | Null toggle sits INSIDE this heading now, and `textContent =`
   * takes it with it — `morphToNull` rewrites the heading on the very first
   * generate, so the control was built and destroyed in the same tick. (The
   * paired page's heading had the identical problem on the other engine.)
   *
   * @param {Element|null} el
   * @param {string} text
   */
  function setPanelHeading(el, text) {
    if (!el) return;
    const keep = [...el.children];
    el.textContent = text;
    for (const child of keep) el.appendChild(child);
  }

  function ensureNullToggle() {
    // Proportions have nothing to toggle BETWEEN: Step 1 shows the population
    // H₀ names and your sample at the same time, which is better than making
    // you hold one in memory while looking at the other — and they were never
    // two states of one thing in the first place. (Jeff, 2026-10-03.)
    if (isProp) return;
    if (nullToggleBtns) return;
    const panel = document.getElementById('mech-observed');
    const titleEl = panel?.querySelector('.mechanism-title');
    if (!panel || !titleEl) return;
    const wrap = document.createElement('div');
    wrap.className = 'seg-control mech-null-toggle';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', 'Show the observed sample or the null distribution');
    wrap.innerHTML =
      '<button type="button" data-view="observed" aria-pressed="true">Observed</button>'
      + '<button type="button" data-view="null" aria-pressed="false">Null</button>';
    // Inside the heading, at its far end — it used to go AFTER the title, which
    // put it on a row of its own under "Observed Data". Same placement as the
    // View toggle on the bootstrap pages. (Jeff, 2026-10-02.)
    titleEl.appendChild(wrap);
    nullToggleBtns = wrap.querySelectorAll('button');
    for (const b of nullToggleBtns) {
      b.addEventListener('click', () => {
        if (b.dataset.view === 'null') morphToNull();
        else revertToObserved();
      });
    }
  }

  /** Reflect the current nullShown state on the toggle buttons. */
  function syncNullToggle() {
    if (!nullToggleBtns) return;
    for (const b of nullToggleBtns) {
      b.setAttribute('aria-pressed', String((b.dataset.view === 'null') === nullShown));
    }
  }

  /** @type {NodeListOf<HTMLButtonElement>|null} */
  let meanViewBtns = null;
  /** Add a Summary | Dotplot toggle next to "This Simulation" (one-mean, small n). */
  function ensureMeanViewToggle() {
    if (isProp || !simTitleEl) return;
    // Offer exactly the views this sample size can actually be drawn as, and
    // nothing else. The mechanism has three:
    //
    //   tiles      one chip per observation, up to CHIP_MAX
    //   dotplot    one dot per observation, up to MEAN_DOT_MAX
    //   histogram  beyond that — not a choice, a consequence
    //
    // The toggle used to appear for anything up to MEAN_DOT_MAX and always
    // offer both, so between CHIP_MAX and MEAN_DOT_MAX it advertised Tiles and
    // then did nothing when clicked: the mechanism fell through to dots
    // whatever the button said. Measured at n = 50, 73 and 75 — click Tiles,
    // get dots. (Jeff, 2026-09-27.) A control with one option is not a choice
    // either, so below it disappears rather than sitting there pressed.
    const n = sampleData.length;
    const views = [];
    if (n >= 2 && n <= CHIP_MAX) views.push(['summary', 'Tiles']);
    if (n >= 2 && n <= MEAN_DOT_MAX) views.push(['dotplot', 'Dotplots']);
    if (views.length < 2) {
      document.querySelector('.mech-view-toggle')?.remove();
      meanViewBtns = null;
      // Whatever it was set to, only one view is drawable — make the mechanism
      // agree, so a remembered 'summary' does not fight a sample too big for it.
      if (views.length === 1 && mech.view !== views[0][0]) mech.setView(views[0][0]);
      return;
    }
    if (meanViewBtns && document.contains(meanViewBtns[0])) return;
    meanViewBtns = null;
    const wrap = document.createElement('div');
    wrap.className = 'seg-control mech-view-toggle';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', 'Resample view');
    wrap.innerHTML = views.map(([v, label]) =>
      `<button type="button" data-mview="${v}" aria-pressed="${String(mech.view === v)}">${label}</button>`
    ).join('');
    // Place it in a full-width bottom bar next to the "Resample N values…" caption
    // so it reads as applying to the whole mechanism (not just the right plot).
    const strip = document.getElementById('mechanism-strip');
    const desc = document.getElementById('mechanism-description');
    if (strip && desc) {
      let bar = strip.querySelector('.mech-bottom-bar');
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'mech-bottom-bar';
        desc.parentElement?.insertBefore(bar, desc);
        bar.appendChild(desc); // move the caption into the bar
      }
      bar.appendChild(wrap);
    } else {
      (document.getElementById('mech-simulation') || /** @type {HTMLElement} */ (simTitleEl.parentElement)).appendChild(wrap);
    }
    meanViewBtns = wrap.querySelectorAll('button');
    for (const b of meanViewBtns) {
      b.addEventListener('click', () => {
        const want = b.dataset.mview === 'dotplot' ? 'dotplot' : 'summary';
        if (want === mech.view) return;
        mech.setView(want);
        for (const x of meanViewBtns) x.setAttribute('aria-pressed', String(x.dataset.mview === mech.view));
        // Re-render both panels statically in the new view.
        mech.resetSizing();
        renderMeanBagView();
        if (lastResampleArr && lastResampleArr.length >= 2) renderMeanResampleView(false);
      });
    }
  }

  /**
   * Morph the left "Observed Data" panel into "Null Distribution".
   * For one-mean: boxplot slides to center on μ₀.
   * For one-prop: proportion bar morphs to p₀ width.
   * @returns {number} Animation duration in ms (0 if already shown or instant)
   */
  function morphToNull() {
    if (nullShown || !mechObservedStat) return 0;
    nullShown = true;

    const p0 = getNullValue();

    if (isProp) {
      // Nothing to morph. The population under H₀ has been on screen since the
      // data loaded, beside the sample, and your sample was never turned into
      // it. `nullShown` stays true only so the rest of the engine — the dart
      // scoop's gate, the toggle sync — can keep asking one question.
      renderPropSource();
      return 0;
    }

    {
      // One-mean: morph boxplot from observed x̄ to shifted (centered at μ₀)
      setPanelHeading(mechObservedTitle, words.source);

      // Stat line doubles as the PERSISTENT explanation of how this null
      // distribution was made (every value shifted by the same constant).
      const statText = mechObservedStat.querySelector('.mech-stat-text');
      if (statText && !isProp) {
        const d = observedStat - getNullValue();
        const op = d >= 0 ? '\u2212' : '+'; // \u2212 or +
        statText.innerHTML = `n = ${sampleN} \u00B7 each value ${op} ${formatStat(Math.abs(d), dataPrecision)} \u2192 `
          + `<span class="observed-highlight">\u03BC\u2080 = ${getNullValue()}</span>`;
      } else if (statText) {
        statText.innerHTML = `n = ${sampleN}, <span class="observed-highlight">\u03BC\u2080 = ${getNullValue()}</span>`;
      }

      const chartEl = document.getElementById('mech-obs-chart');
      if (chartEl && shiftedData.length >= 2) {
        const dom = sharedBoxplotDomain();
        if (useCards()) {
          // Cards: tween every value by the same constant so the subtraction is
          // visible, with a caption. On the FIRST shift, hold the observed sample
          // for a beat first so it's clear what we're subtracting from.
          const hold = firstShiftDone ? 0 : 900;
          firstShiftDone = true;
          let ms;
          if (hold) { setTimeout(() => animateCardsShift(true), hold); ms = hold + 1000; }
          else { ms = animateCardsShift(true); }
          syncNullToggle();
          return Math.max(ms, 350);
        }
        if (useDots()) {
          // Re-draw the bag as the null-shifted sample, then glide the dots from
          // the observed positions to the shifted ones (the shift is uniform).
          drawMeanBag(shiftedData, getNullValue());
          const deltaPx = mech.bag ? (mech.bag.xScale(observedStat) - mech.bag.xScale(getNullValue())) : 0;
          const ms = glideBag(deltaPx);
          syncNullToggle();
          return Math.max(ms, 850);
        }
        const ms = morphMiniChart(chartEl, shiftedData, {
          meanValue: mean(shiftedData),
          highlightMean: true,
          domain: dom,
          label: 'Null distribution (shifted to μ₀)',
          durationMs: 850, // slower slide — the shift was easy to miss (feedback A4)
        });
        syncNullToggle();
        return Math.max(ms, 850);
      }
      syncNullToggle();
      return 0;
    }
  }

  /**
   * Revert the left panel from "Null Distribution" back to "Observed Data".
   * Called on reset or when null value changes.
   */
  function revertToObserved() {
    nullShown = false;
    setPanelHeading(mechObservedTitle, words.beforeShift ?? words.source);

    if (isProp) {
      // Unreachable: the proportion page has no Observed|Null toggle to revert
      // from. Step 1 shows the population AND the sample at once, because they
      // are two objects rather than two states of one. Kept as a no-op so the
      // shared reset path does not have to know which page it is on.
      renderPropSource();
    } else {
      // One-mean: slide the dots back from the null-shifted positions to the
      // observed ones — symmetric with morphToNull (don't rebuild = no blink).
      if (mechObservedStat && sampleData.length >= 2) {
        const statText = mechObservedStat.querySelector('.mech-stat-text');
        if (statText) {
          statText.innerHTML = `n = ${sampleN}, <span class="observed-highlight"><span class="x-bar">x</span> = ${formatStat(observedStat, dataPrecision)}</span>`;
        }
        const chartEl = document.getElementById('mech-obs-chart');
        if (useCards()) {
          animateCardsShift(false); // tween shifted → observed values
        } else if (useDots() && chartEl) {
          // Re-draw the bag as the observed sample, then glide back from the
          // null-shifted positions.
          drawMeanBag(sampleData, observedStat);
          const deltaPx = mech.bag ? (mech.bag.xScale(getNullValue()) - mech.bag.xScale(observedStat)) : 0;
          glideBag(deltaPx);
        } else if (chartEl && chartEl.querySelector('svg')) {
          morphMiniChart(chartEl, sampleData, {
            meanValue: observedStat,
            highlightMean: true,
            domain: sharedBoxplotDomain(),
            label: 'Observed data distribution',
            durationMs: 850,
          });
        } else {
          // No existing chart (first render) — draw it.
          mechObservedStat.innerHTML = `<div id="mech-obs-chart" class="mech-chart-container"></div>
            <span class="mech-stat-text">n = ${sampleN}, <span class="observed-highlight"><span class="x-bar">x</span> = ${formatStat(observedStat, dataPrecision)}</span></span>`;
          const obsChartEl = document.getElementById('mech-obs-chart');
          if (obsChartEl) {
            drawMiniChart(obsChartEl, sampleData, {
              meanValue: observedStat, domain: sharedBoxplotDomain(),
              label: 'Observed data distribution',
            });
          }
        }
      }
    }
    syncNullToggle();
  }

  // ─── Generate ───

  for (const btn of genBtns) {
    btn.addEventListener('click', () => {
      const count = parseInt(btn.dataset.count, 10);
      if (sampleN === 0) {
        announce('Please load data first.');
        return;
      }
      generateSimulations(count);
    });
  }

  /** @param {number} count */
  function generateSimulations(count) {
    // A clean slate: see the note in js/sim-app.js. The dart scoop hides its
    // target dots until the darts arrive, so an interrupted run would leave
    // them invisible.
    cancelDrawAnimations();
    if (!rng) rng = createRng(seed);

    initMechanismStrip();

    // On first generate, morph left panel from "Observed" to "Null Distribution"
    const nullMorphMs = morphToNull();
    if (nullMorphMs > 0 && count === 1) {
      // Delay the rest of the generation so students see the shift first
      setTimeout(() => doGenerate(count), nullMorphMs + 100);
      return;
    }

    doGenerate(count);
  }

  /** @param {number} count */
  function doGenerate(count) {
    const prevLength = allStats.length;

    if (simTitleEl) {
      // The one-mean page draws WITH REPLACEMENT from the null-shifted sample,
      // so it can say so, the way the bootstrap pages do — the STEP 2 tag
      // beside it already says which panel it is. The one-prop page is left
      // alone: its draw is a Bernoulli sample from p₀, not a resample of
      // anything, and calling it one would be false. (Jeff, 2026-10-02.)
      setPanelHeading(simTitleEl, isProp
        ? (count === 1 ? words.draw : words.drawLatest)
        : 'Resample with Replacement');
    }

    lastSimStat = 0;
    let lastSimDetail = '';
    /** The trials behind the latest proportion draw, for the dot block. */
    /** @type {number[]|null} */ let lastPropDraw = null;
    // Dots while they fit the panel; the aggregate bar above that.
    const propDots = isProp && hasIndividualView(sampleN);
    let mechAnimMs = 0; // resample-build animation duration (delays the drop)

    const isSingle = count === 1;
    lastResampleArr = null;
    lastResampleIdx = null;

    if (isProp) {
      // Bernoulli(p₀) simulation
      const p0 = getNullValue();
      const n = sampleN;
      let lastSuccesses = 0;
      for (let i = 0; i < count; i++) {
        const successes = drawBernoulliCount(n, p0, rng);
        lastSuccesses = successes;
        allStats.push(successes / n);
      }
      lastSimStat = lastSuccesses / n;
      const hlClass = isSingle ? ' highlight-last' : '';
      const lastFailures = n - lastSuccesses;
      const pct = n > 0 ? (lastSuccesses / n * 100) : 0;
      lastSimDetail = `${lastSuccesses} of ${n} (p\u0302 = <span class="mech-stat-value${hlClass}">${fmtObs(lastSimStat)}</span>)`;

      // The draw itself. Dots while they fit, so this page shows a sample the
      // same way the bootstrap CI for a proportion does and the same way the
      // Sampling Distribution Lab does — one dot per observation, successes
      // first, so the amber fraction IS p̂. Above that, the aggregate bar: the
      // display changes with SCALE, never with the kind of thing being shown.
      // (Jeff, 2026-10-03.)
      //
      // The trials are materialised here rather than drawn as an array:
      // `drawBernoulliCount` returns a count because the trials used not to be
      // shown, and the order of n exchangeable Bernoulli trials carries
      // nothing — a sorted array and a shuffled one are the same sample. What
      // is NOT free is the count, and that comes from the seeded draw.
      lastPropDraw = Array.from({ length: n }, (_, i) => (i < lastSuccesses ? 1 : 0));
      lastSimDetail += propDots
        ? '<div class="mech-prop-draw"></div>'
        : `\n        ${propBarHTML(lastSuccesses, lastFailures, { style: 'margin-top:4px', board: true })}`;

      if (mechanismDescEl) {
        // What the draw actually is: n independent trials, each a success with
        // probability p₀. "From the null distribution" invited the reading that
        // there was a fixed thing of size n being sampled.
        mechanismDescEl.textContent =
          `Draw ${n} independent trials \u00b7 each a success with probability ${p0}`;
        mechanismDescEl.hidden = false;
      }
    } else {
      // Shifted bootstrap
      const n = shiftedData.length;
      for (let i = 0; i < count; i++) {
        // Keep the INDICES, not just the values. Without them the draw
        // animation cannot say which observation was taken twice or never —
        // this page showed dots flying with no marks at all, while
        // bootstrap-mean (which kept them) showed both. (2026-09-28.)
        const draw = drawFromShiftedNull(shiftedData, rng);
        const resampleArr = draw.values;
        const simMean = mean(resampleArr);
        lastSimStat = simMean;
        lastResampleArr = /** @type {number[]} */ (resampleArr);
        lastResampleIdx = draw.indices ?? null;
        allStats.push(simMean);
      }
      const hlClass = isSingle ? ' highlight-last' : '';
      lastSimDetail = '<div id="mech-sim-chart" class="mech-chart-container"></div>';
      lastSimDetail += `<span class="mech-stat-text"><span class="x-bar">x</span>* = <span class="mech-stat-value${hlClass}">${formatStat(lastSimStat, dataPrecision)}</span></span>`;

      if (mechanismDescEl) {
        mechanismDescEl.textContent = `Resample ${n} values (with replacement) from null distribution (\u03BC\u2080 = ${getNullValue()}), compute mean`;
        mechanismDescEl.hidden = false;
      }
    }

    if (mechSimStat) {
      // The cards / dotplot views do their own animation; only fire the generic
      // stream for the other cases (proportions, large-n histogram).
      const ownAnim = (!isProp && (useCards() || useDots()) && lastResampleArr && lastResampleArr.length >= 2)
        || (propDots && nullShown && sampleN <= DART_MAX);
      if (isSingle && mechObservedStat && !ownAnim) {
        flyDataStream(mechObservedStat, mechSimStat);
      }

      mechSimStat.innerHTML = lastSimDetail;

      // Render the resample for one-mean in the current view after the DOM update.
      // Capture the animation duration so the "drop into the sampling distribution"
      // waits until the resample has actually finished building (was firing early).
      if (!isProp && lastResampleArr && lastResampleArr.length >= 2) {
        mechAnimMs = renderMeanResampleView(isSingle);
      }
      if (propDots && lastPropDraw) {
        mechAnimMs = Math.max(mechAnimMs, renderPropDraw(lastPropDraw, isSingle));
      }
    }

    const direction = getDirection();

    // Compute domain for consistent bin alignment
    // Never shrink below the pre-simulated domain
    let lo = Math.min(...allStats, observedStat);
    let hi = Math.max(...allStats, observedStat);
    const pad = (hi - lo) * 0.05 || 0.05;
    lo -= pad; hi += pad;
    if (preSimDomain) {
      lo = Math.min(lo, preSimDomain[0]);
      hi = Math.max(hi, preSimDomain[1]);
    }
    const hlDomain = /** @type {[number,number]} */ ([lo, hi]);

    // Thresholds: snapped for proportions, default for means
    // Pass numBins to match renderChart so delta bars align correctly
    const thresholdOpts = isProp
      ? { domain: hlDomain, thresholds: snappedPropThresholds(sampleN, hlDomain, allStats.length,
          { anchor: observedStat }) }
      : { domain: hlDomain, numBins: userBinCount };
    const { bins: fullBins } = computeBins(allStats, thresholdOpts);
    const lockedThresholds = fullBins.slice(1).map(b => b.x0);

    const { hlIndex, hlIndices, prevBinCounts } = computeHighlights(
      allStats, prevLength, count, computeBins,
      { domain: hlDomain, thresholds: lockedThresholds, numBins: isProp ? undefined : userBinCount });

    const { pValue, extremeCount } = computePValue(allStats, observedStat, direction);
    displayResults(allStats, observedStat, pValue, extremeCount, direction);
    if (resetBtn) resetBtn.hidden = false;

    if (count === 1) {
      // Wait for the resample to finish building before the stat drops into the
      // sampling distribution — otherwise the drop fires out of order.
      setTimeout(() => {
        renderChart(allStats, observedStat, direction, hlIndex, hlIndices, prevBinCounts, hlDomain, lockedThresholds);
        if (mechSimStat && chartContainer) {
          animateDropToChart(mechSimStat, chartContainer);
        }
      }, Math.max(150, mechAnimMs));
    } else {
      renderChart(allStats, observedStat, direction, hlIndex, hlIndices, prevBinCounts, hlDomain, lockedThresholds);
    }
    announce(`Generated ${count} simulation${count > 1 ? 's' : ''}. Total: ${allStats.length}`);
    // Something has been generated, so the link is worthless without the seed.
    markGenerated();
  }

  // ─── Chart rendering ───

  /**
   * @param {number[]} stats
   * @param {number} observed
   * @param {'left'|'right'|'both'} direction
   * @param {number} [highlightIndex]
   * @param {Set<number>} [highlightIndices]
   * @param {number[]} [prevBinCounts]
   * @param {[number,number]} [hlDomain]
   * @param {number[]} [hlThresholds]
   */
  function renderChart(stats, observed, direction, highlightIndex = -1, highlightIndices, prevBinCounts, hlDomain, hlThresholds) {
    chartContainer.innerHTML = '';
    const n = stats.length;

    let cLo = n > 0 ? Math.min(...stats, observed) : observed;
    let cHi = n > 0 ? Math.max(...stats, observed) : observed;
    const cPad = (cHi - cLo) * 0.05 || 0.05;
    cLo -= cPad; cHi += cPad;
    if (preSimDomain) {
      cLo = Math.min(cLo, preSimDomain[0]);
      cHi = Math.max(cHi, preSimDomain[1]);
    }
    /** @type {[number, number]} */
    const domain = hlDomain || [cLo, cHi];

    const activeChart = getActiveChartType(stats);
    if (setToggleSelected) setToggleSelected(activeChart);
    if (binAdjuster) binAdjuster.setMode(activeChart);

    lastHistResult = null;
    lastDotResult = null;
    const precision = displayPrecision(dataPrecision, { proportion: isProp, sampleN });
    const nullVal = getNullValue();

    const { pValue } = n > 0 ? computePValue(stats, observed, direction) : { pValue: 0 };

    const result = renderSimChart(chartContainer, stats, {
      chartType: activeChart,
      id: 'sim-chart',
      xLabel,
      titleText: words.distribution,
      domain,
      observedStat: observed,
      direction,
      nullCenter: nullVal,
      // The value H₀ names, marked on the distribution it generated — the
      // distribution is centred there by construction and nothing said so.
      parameterMark: Number.isFinite(nullVal)
        ? { value: nullVal, label: isProp ? 'p\u2080' : '\u03BC\u2080' }
        : null,
      highlightIndex,
      highlightIndices,
      prevBinCounts,
      thresholds: hlThresholds || histogramThresholds({ proportion: isProp, sampleN, domain, dataLength: n }),
      numBins: isProp ? undefined : userBinCount,
      // p̂ moves in steps of 1/n, and 0 is an achievable p̂, so a grid centred
      // there puts every column on a value the statistic can take (js/grid.js).
      binWidth: isProp ? (proportionStep(sampleN) ?? undefined) : undefined,
      binOrigin: isProp ? 0 : undefined,
      precision,
      // Reasoning / figure-only mode: no tail shading or p-value pills — the
      // student reads the p-value off the histogram. Observed marker stays.
      regionPredicate: showReadout ? undefined : () => false,
      pillMode: (showReadout && n > 0) ? 'randomization' : undefined,
      pValue,
    });

    if (result.bins && result.bins.length > 0) {
      lastHistResult = { xScale: result.xScale, yScale: result.yScale, bins: result.bins, domain };
    } else if (activeChart === 'dotplot' && result.maxStack > 0) {
      const effectiveBins = isProp ? sampleN : (userBinCount ?? DEFAULT_BINS);
      lastDotResult = {
        xScale: result.xScale, frame: result.frame, domain, maxStack: result.maxStack,
        numBins: effectiveBins,
        // The dotplot's own count → pixel-y mapping, so a theory curve lines up in
        // both stacked-dot and filled-column modes.
        countToY: result.countToY, binWidth: result.binWidth,
      };
    }

    // Theory overlay (histogram or dotplot)
    if (theoryOverlayOn && (activeChart === 'histogram' || activeChart === 'dotplot')) {
      applyTheoryOverlay();
    }

  }

  // ─── P-value & extremes ───

  /** @type {(v: number, obs: number, dir: 'left'|'right'|'both') => boolean} */
  function isExtreme(v, obs, dir) {
    return isExtremeShared(v, obs, dir, getNullValue());
  }

  /**
   * @param {number[]} stats
   * @param {number} observed
   * @param {'left'|'right'|'both'} direction
   */
  function computePValue(stats, observed, direction) {
    let extremeCount = 0;
    const nullVal = getNullValue();
    for (const s of stats) {
      if (direction === 'right' && s >= observed) extremeCount++;
      else if (direction === 'left' && s <= observed) extremeCount++;
      else if (direction === 'both' && Math.abs(s - nullVal) >= Math.abs(observed - nullVal)) extremeCount++;
    }
    return { pValue: extremeCount / stats.length, extremeCount };
  }

  // ─── Results display ───

  /**
   * @param {number[]} stats
   * @param {number} observed
   * @param {number} pValue
   * @param {number} extremeCount
   * @param {'left'|'right'|'both'} direction
   */
  function displayResults(stats, observed, pValue, extremeCount, direction) {
    const dirLabel = direction === 'both' ? 'two-sided'
      : direction === 'right' ? 'right-tail' : 'left-tail';

    // REQ-055: post the p-value to a framing MyOpenMath question, rounded the
    // way this page displays it — the decimals are a user setting, so reading
    // it from there keeps the answer box and the screen agreeing. `fmtPValue`
    // itself is not used: it can return "< 0.0001", which is true but is not a
    // number an answer box can grade. Suppressed in reasoning mode below, where
    // the student is meant to read the p-value off the chart themselves.
    if (showReadout) {
      const dp = getSetting('decimalsPValue');
      answer.send({ p_value: Number(pValue.toFixed(dp)), count: extremeCount, stat: observed });
    }

    if (!showReadout) {
      // Reasoning mode: keep the count + observed marker, hide the p-value — the
      // student estimates it from the tail of the null distribution.
      const nv = getNullValue();
      const np = isProp ? 'p₀' : 'μ₀';
      resultDiv.innerHTML = `
        <p><strong>Null Distribution</strong> (${stats.length} simulations, ${np} = ${nv})</p>
        <p>Observed <span class="observed-highlight">${statSymbolHTML} = ${fmtObs(observed)}</span></p>
        <p class="hint">Estimate the ${dirLabel} p-value by reading the fraction of the null distribution at least as extreme as the observed statistic off the histogram.</p>
      `;
      return;
    }

    let strength;
    if (pValue < 0.01) strength = 'very strong';
    else if (pValue < 0.05) strength = 'strong';
    else if (pValue < 0.10) strength = 'moderate';
    else strength = 'little';

    const nullVal = getNullValue();
    const nullParam = isProp ? 'p\u2080' : '\u03BC\u2080';
    const nullSymbol = isProp ? 'p' : '\u03BC';
    const statName = isProp ? 'proportions' : 'means';

    const defaultNull = isProp
      ? `${nullSymbol} = ${nullVal}`
      : `${nullSymbol} = ${nullVal}`;
    const nullDesc = datasetContext.nullClaim || defaultNull;
    const pFmt = formatStat(pValue, 0, 'pvalue');
    const pDisplay = pFmt.startsWith('p') ? pFmt : `p-value: ${pFmt}`;
    // The p-value is itself an estimate from N simulations, with Monte-Carlo
    // SE = √(p(1−p)/N). The two-group and bootstrap pages have shown that
    // margin since REQ-031; these one-sample pages never did — which is the
    // inconsistency Todd Will noticed (2026-09-26), and he is right that it is
    // the thing that tells a student when more clicking stops helping. It was
    // never behind expert mode on either engine; it simply was not here.
    const N = stats.length;
    const mcMargin = 1.96 * Math.sqrt(Math.max(pValue * (1 - pValue), 0) / N);
    const pLine = extremeCount === 0
      ? `<strong>p-value = 0/${N} ≈ 0</strong> — none of ${N} simulations were this extreme`
      : `<strong>${pDisplay} ± ${mcMargin.toFixed(3)}</strong>`;

    resultDiv.innerHTML = `
      <p><strong>Null Distribution</strong> (${N} simulations, ${nullParam} = ${nullVal})</p>
      <p>Observed <span class="observed-highlight">${statSymbolHTML} = ${fmtObs(observed)}</span></p>
      <p>Extreme count: ${extremeCount} of ${N} (${dirLabel})</p>
      <p>${pLine}</p>
      ${extremeCount === 0 ? '' : `<p class="hint">Run it again and the p-value could shift
         <strong>±${mcMargin.toFixed(3)}</strong>. <strong>More simulations → tighter</strong>;
         once it stops shrinking, more clicking will not change your conclusion.</p>`}
      <p class="interpretation">${extremeCount} of ${N} simulated ${statName} were at least as extreme as the observed <span class="observed-highlight">${statSymbolHTML} = ${fmtObs(observed)}</span>. This provides ${strength} evidence against H\u2080: ${nullDesc}.</p>
    `;
  }

  // ─── Reset ───

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      resetSimulation();
      announce('Simulation reset.');
    });
  }

  function resetSimulation() {
    // A reset means "give me a clean tool", which includes a clean address bar.
    forgetSeed();
    allStats = [];
    rng = null;
    mechanismInitialized = false;
    // Keep a URL-pinned seed stable so shared links stay reproducible.
    seed = urlSeed ?? Math.random().toString(36).slice(2, 10);
    chartContainer.innerHTML = '';
    resultDiv.innerHTML = `<p class="placeholder">${getTabHintText(getActiveTabId(), 'run a simulation to see results')}</p>`;
    if (resetBtn) resetBtn.hidden = true;
    // Revert left panel from "Null Distribution" back to "Observed Data"
    revertToObserved();
    // Hide mechanism strip (will re-show on next first generate)
    if (mechanismStrip) mechanismStrip.hidden = true;
  }

  // ─── Theory overlay ───

  function applyTheoryOverlay() {
    if (!chartContainer || sampleN === 0) return;
    if (!lastHistResult && !lastDotResult) return;
    const nullVal = getNullValue();
    let se;

    if (isProp) {
      se = Math.sqrt(nullVal * (1 - nullVal) / sampleN);
    } else {
      const sampleSD = sd(sampleData);
      se = sampleSD / Math.sqrt(sampleN);
    }
    if (!isFinite(se) || se <= 0) return;

    const label = isProp ? `N(${nullVal}, ${se.toFixed(3)})` : 'N(\u03BC\u2080, SE)';

    if (lastHistResult) {
      const { xScale: hxScale, yScale: hyScale, bins, domain: dom } = lastHistResult;
      if (bins.length === 0) return;
      const binWidth = /** @type {number} */ (bins[0].x1) - /** @type {number} */ (bins[0].x0);

      overlayTheoryCurve({
        container: chartContainer,
        pdf: (x) => normalPdf(x, nullVal, se),
        xDomain: dom,
        totalN: allStats.length,
        binWidth,
        xScale: hxScale,
        yScale: hyScale,
        label,
      });
    } else if (lastDotResult) {
      // Same frequency scaling as the histogram (expected count = n · binWidth · pdf),
      // mapped through the dotplot's OWN count → pixel-y function: stacked dots at
      // small n, a y-axis scale once the stacks overflow into filled columns.
      const { xScale: dxScale, maxStack, countToY, binWidth: dotBinWidth, domain: dom } = lastDotResult;
      if (!countToY || !dotBinWidth || maxStack <= 0) return;

      overlayTheoryCurve({
        container: chartContainer,
        pdf: (x) => normalPdf(x, nullVal, se),
        xDomain: dom,
        totalN: allStats.length,
        binWidth: dotBinWidth,
        xScale: dxScale,
        yScale: countToY,
        label,
      });
    }
  }
}
