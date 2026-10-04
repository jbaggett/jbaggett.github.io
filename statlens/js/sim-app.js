// @ts-check
/**
 * Shared simulation page logic for StatLens.
 * Handles data input (URL params, paste), simulation controls, chart rendering, and results.
 */

import { parseParams } from './url-params.js';
import { registerShareState, syncUrl, syncUrlOnInteraction, markGenerated, forgetSeed } from './share-state.js';
import { applyRequestedLayout } from './mechanisms/layout.js';
import { wordsFor } from './mechanisms/vocabulary.js';
import { createSharedScale } from './mechanisms/entities.js';
import { resampleOne, resamplePairedDiffs, resampleGroups, shuffleLabels, signFlip } from './mechanisms/draws.js';
import { dismissAirborneStat, clearDrawMarks, animateHistogramDraw, animatePoolAndDeal, animatePoolAndDealMarks, animateCombineStats,
  cancelDrawAnimations } from './mechanisms/draw-animation.js';
import { proportionStep } from './grid.js';
import { parseCSV } from './csv-parser.js';
import { createRng } from './prng.js';
import { mean, median, sd, quantile, detectPrecision, formatStat, quartiles, extent} from './stats.js';
import { bootstrapCI, permutationPValue } from './sim-engine.js';
import * as d3Selection from 'd3-selection';
import { drawHistogram, computeBins, snappedPropThresholds } from './histogram.js';
import { drawDotplot } from './dotplot.js';
import { drawSpike } from './spike.js';
import { STAT_RESAMPLE, STAT_RESAMPLE_TEXT, renderSimPills, renderCutlines, formatMechStat, drawMiniBoxplot, morphMiniBoxplot, drawMiniChart, prefersReducedMotion, hasD3Transition } from './chart-utils.js';
import {
  ciMethodFromUrl, createCiMethodControl, normalApproxCI, zFor, zLabelFor,
  drawCiPills, drawCompareBounds, appendCiLegend, bcaCI, jackknife1, ciMonteCarloMargin,
  PERCENTILE_CI_COLOR, NORMAL_CI_COLOR, ciRegionMass,} from './ci-method.js';
import { initPlayPause, initHelp, initMechanismCollapse, animateDropToChart, flyDataStream, initTabs, updateTabHint, getActiveTabId, getTabHintText, setPageTitle, initDataPanel, reportInputProblem, gateBigBatches, capBatch, applySimulationCap} from './page-utils.js';
import { normalPdf, overlayTheoryCurve, removeTheoryOverlay, createTheoryToggle } from './theory-overlay.js';
import { initAnswerReport } from './answer-report.js';
import { resolveChartType, reasoningChartType, discreteColumnSpan, createChartToggle, displayPrecision, isExtreme as isExtremeShared, DOTPLOT_AUTO_THRESHOLD, createBinAdjuster } from './chart-defaults.js';
import { cardGroupsHTML, cardLegendHTML } from './sim-card-mechanism.js';
import { renderPropBag, renderPropResample, showPropResample, propBarHTML, updatePropBar, hasIndividualView, blockLayout, obsLegendHTML } from './prop-bootstrap-mech.js';
import { createMeanMechanism, MEAN_DOT_MAX as MEAN_DOT_MAX_SHARED } from './mean-mechanism.js';
import { initCoaching } from './coaching.js';
/**
 * @typedef {object} SimConfig
 * @property {'bootstrap'|'randomization'} mode
 * @property {string} [statLabel] - Display label for the statistic (randomization mode)
 * @property {(g1: number[], g2: number[]) => number} [testStat] - For randomization: compute observed stat
 * @property {boolean} [twoGroup] - Whether this is a two-group test
 * @property {boolean} [proportion] - Whether this is a proportion-based test (categorical outcome encoded as 0/1)
 * @property {boolean} [paired] - Whether this is a paired differences test (compute diffs first, then bootstrap)
 */

/**
 * Initialize a simulation page.
 * @param {SimConfig} config
 */
export function initSimPage(config) {
  initHelp();
  const urlParams = parseParams(window.location.search);

  // Reasoning mode (?readout=false): show the distribution + histogram tooltips
  // (bin edges + count) + the observed-stat marker, but HIDE the computed answer —
  // the CI/p-value numbers, the region shading, the CI bound lines, and the
  // probability pills/legend. The student must read the interval / p-value off the
  // distribution themselves (MOM "estimate from the histogram" exercises). The
  // mechanism strip, generate bar, and tooltips stay so the reasoning is feasible.
  // Read straight from the URL — parseParams only surfaces known typed params.
  // `?plot=only` is the figure-only embed: auto-run on load, show ONLY the
  // distribution (with tooltips + observed marker), hide all other UI. It implies
  // reasoning mode (no answer on the chart). CSS (data-plot="only") does the
  // hiding; the auto-run + readout logic live here.
  const plotOnly = new URLSearchParams(window.location.search).get('plot') === 'only';
  let plotOnlyRan = false; // guard so the figure auto-runs exactly once
  const showReadout = !plotOnly
    && !/^(false|0|no)$/i.test(new URLSearchParams(window.location.search).get('readout') || '');
  // Opt-in reasoning overlay: draggable cutoff line(s) with a live tail readout.
  // ci = two lines (percentile bounds); tail = one line (p-value). See renderCutlines.
  const cutlinesMode = new URLSearchParams(window.location.search).get('cutlines');

  // Card mechanism: render the two-group proportion shuffle as dealt cards
  // instead of proportion bars. Available on any two-group proportion page; a
  // live "Bars / Cards" toggle in the strip flips between views (great for
  // demos — show the bars, then reveal the cards behind them). ?mechanism=cards
  // just sets the initial view.
  // Cards are a permutation metaphor (re-deal the *same* cards into new groups),
  // so they only fit two-group proportion *randomization* — not bootstrap, which
  // resamples with replacement.
  const cardModeAvailable = !!config.proportion && !!config.twoGroup && config.mode === 'randomization';
  // Cards only read well for small samples; past this many in either group the
  // grid is an unreadable wall, so the toggle/card view is suppressed (size is
  // only known once data loads, so this is checked at data-load via cardsAllowed).
  // 105 per group — seven rows of fifteen at the size cards settle to.
  //
  // Was 50, which refused Opportunity Cost at exactly 75: the coursepack
  // promised a shuffle the tool declined to draw and said nothing about why
  // (Todd Will, REQ-068 C). Cards shrink from 50 up to 10px at 75
  // (js/sim-card-mechanism.js cardWidth) and then hold that size, so past 75
  // the pile grows in ROWS rather than getting smaller — a card below 10px
  // stops reading as a card, and the metaphor is the point. (Jeff, 2026-10-01.)
  const CARD_MAX_GROUP = 105;
  /** @returns {boolean} Whether card view is allowed given the loaded sample sizes. */
  function cardsAllowed() {
    return cardModeAvailable && Math.max(data1.length, data2.length) <= CARD_MAX_GROUP;
  }
  // `?mechanism=cards` with `?mechstyle=aggregate` is a contradiction: cards
  // are a rendering INSIDE the individual view, and the aggregate has one
  // rendering of its own. The role wins — it is the coarser choice, and the
  // live toggle already drops the cards when you switch to Aggregate, so a link
  // that did not would open in a state the UI cannot return you to.
  let cardMechanism = /** @type {any} */ (urlParams).mechanism === 'cards' && cardModeAvailable;
  // Which card colour carries the success (?cardcolor=red|white).
  //
  // Red = success is this tool's convention and the textbook's, but a
  // coursepack example can deal its own deck the other way round — the
  // opportunity-cost activity makes red the "buy", which is the NON-success —
  // and a student then meets two opposite conventions in one sitting. Which
  // colour means success is a property of the material, not of the statistics,
  // so it is a setting: a URL parameter for the link an assignment hands out,
  // and a control in the legend for the person already looking at it.
  // (Todd Will + Jeff, REQ-071.)
  let cardColorSwapped = /^(white|swap|swapped)$/i.test(
    new URLSearchParams(location.search).get('cardcolor') || '');
  // The proportion mechanism's view. Two roles, as the mean pages have:
  // INDIVIDUAL — one mark per observation, which can say which observations
  // were drawn and how often — and AGGREGATE, which throws the individuals away
  // and keeps the proportion. Individual leads, because the repeats and misses
  // are the thing being taught; the aggregate is where it goes when n outgrows
  // a mark per observation, and is the only view above MAX_MARBLES.
  //
  // `grid` (marbles) and `bars` (one cell per observation) are the earlier
  // displays. They are still reachable by ?mechstyle= — activities and specs
  // name them — but they are no longer offered in the UI: the marble grid and
  // the dot block do the same job in two visual languages, and the cell bar is
  // an aggregate drawn the expensive way. (Jeff, 2026-10-02.)
  let propMechStyle = (() => {
    const v = new URLSearchParams(location.search).get('mechstyle');
    if (v === 'individual') return 'dots';
    if (v === 'aggregate' || v === 'bars' || v === 'dots' || v === 'grid') return v;
    return 'dots';
  })();
  // …and the role settles the contradiction named above: `?mechstyle=aggregate`
  // with `?mechanism=cards` opened a card view whose role control said
  // Aggregate, a state no click could produce or leave.
  if (propMechStyle === 'aggregate') cardMechanism = false;
  const useNewPropMech = config.mode === 'bootstrap' && config.proportion && !config.twoGroup;
  // B4: two-proportion bootstrap reuses the same grid/bar resampling per group.
  /**
   * The two-group proportion display: one mark per observation, per group (or
   * the aggregate bar once n outgrows a mark each).
   *
   * The randomization page drew two 14px `propBarHTML` strips instead — a
   * picture that carries a proportion and nothing else, while the CI page
   * beside it drew the same kind of data as blocks of marks. Two displays for
   * one idea, and the thinner one on the page where the mechanism is harder.
   * (Jeff, 2026-10-03: "the two proportion bars don't convey much, I wonder if
   * we can use the wider bars we use in one sample land … we could also use two
   * of the dot blocks when we have small samples.")
   *
   * Not in the card view: there the cards ARE the individual marks, dealt
   * rather than blocked, so the two are alternative renderings of the same
   * role and not layers of one display.
   */
  const twoPropBlockPage = config.proportion && !!config.twoGroup
    && (config.mode === 'bootstrap' || config.mode === 'randomization');
  const useNewPropMech2 = () => twoPropBlockPage && !cardMechanism;
  // B1: one-sample mean bootstrap — animated dotplot resampling for small samples
  // (the non-summary view). Large samples keep the histogram.
  // Shared with the one-sample engine — a second copy of this number is how the
  // two engines drift apart (see the chart-type decision, 2026-09-25).
  const MEAN_DOT_MAX = MEAN_DOT_MAX_SHARED;
  // Which of the three entities this page names how (js/mechanisms/vocabulary.js).
  const words = wordsFor(config.mode === 'bootstrap' ? 'bootstrap' : 'shuffle');
  // Opt-in second layout (?layout=tiers). Applied here, before anything is
  // drawn: charts measure the box they land in, so moving one afterwards means
  // re-rendering it. Default is unchanged.
  const mechLayout = applyRequestedLayout(config.mode === 'bootstrap' ? 'bootstrap' : 'shuffle');
  // Does this page's draw POOL the two groups? If it does, the two dotplots
  // have to stay stacked on one axis whatever the layout: the shuffle's whole
  // argument is that the dots move vertically only — a value that never moves
  // sideways is a value that did not change — and side by side, every dealt dot
  // crosses the gap between two differently-placed axes and says the opposite.
  // The bootstrap pages resample each group on its own and have no such claim
  // to protect, so they take the side-by-side tiers. (2026-10-03.)
  const poolsGroups = config.mode !== 'bootstrap' && config.twoGroup && !config.proportion;
  if (poolsGroups) document.body.setAttribute('data-mech-pools', 'true');

  /**
   * A shorter, tighter dotplot for a pooling page in a tier layout.
   *
   * Those pages keep their two groups stacked whatever the layout, because the
   * shuffle's argument depends on it — so the only way to fit two tiers on a
   * laptop is to make each plot shorter, and a shorter box IS smaller dots
   * (computeDotRadius bounds the radius by innerHeight / (maxStack · 2.05)).
   *
   * The margins come down with it. At the default 210 they are 78 units — 37%
   * of the box — so cutting height alone would spend most of the saving on
   * whitespace and crush the dots to nothing. 34 still clears the x tick labels
   * at their 16-unit font.
   *
   * The number is picked by measuring, not by taste: it is the tallest box that
   * still brings Step 2 above the fold on a 1296x880 laptop. It was 132 (dots at
   * r = 6) until the key column stopped printing a mean the plot already shows
   * and the difference moved onto the STEP heading line; those two gave back
   * ~24px of tier, which is spent here on 148 and r = 7.4 — the same height
   * budget, bigger dots. (Jeff, 2026-10-03.)
   */
  /**
   * How tall a dotplot in the mechanism strip may be.
   *
   * A PHONE is the binding case and it was never measured. At 393px the strip
   * on randomization-diff-means came to 1,049px after a draw — four stacked
   * dotplots at the desktop's 210-unit viewBox, 194px each on screen — against
   * a 727px viewport, so the picture the +1 button animates could not be seen
   * whole, let alone beside the button. Shorter here, because a phone's
   * constraint is height and its dotplots are narrow anyway. (Jeff, 2026-10-05:
   * "the tiered layouts, some of them have gotten very big, and they may cause
   * issues on mobile devices.")
   *
   * Read at render time, not once: an orientation change is a different device
   * as far as this is concerned, and the strip redraws on the next step.
   */
  const phoneLayout = () =>
    typeof window !== 'undefined' && window.matchMedia?.('(max-width: 560px)').matches;
  const tierDotGeometry = () => phoneLayout()
    ? { viewHeight: 120, margin: { top: 12, right: 18, bottom: 30, left: 18 } }
    : (poolsGroups && mechLayout !== 'strip')
      ? { viewHeight: 148, margin: { top: 20, right: 24, bottom: 34, left: 24 } }
      : {};
    const isMeanOneSample = config.mode === 'bootstrap' && !config.proportion && !config.twoGroup && !config.paired;
  // ── View: Individual | Aggregate, for the quantitative pages ────────
  //
  // The same two roles the proportion pages already name: one mark per
  // observation, or the shape with the individuals gone. They were here all
  // along under other names — "Tiles | Dotplots" on the one-sample mean,
  // "Tiles | Histogram" everywhere else — which asked a reader to pick between
  // two PICTURES rather than between what they wanted to see, and gave the two
  // families different words for the same decision. (Jeff, 2026-10-02.)
  //
  // On the one-sample mean the individual role has two renderings, the dotplot
  // and the value tiles, so that choice gets its own control rather than being
  // flattened into this one. Everywhere else the role IS the rendering.
  /** @type {'individual'|'aggregate'} */
  let meanRole = 'individual';
  /** How the individual role was being drawn when it was last left. */
  let individualMode = 'histogram';
  /** The n above which one mark per observation stops being drawable here. */
  const individualMax = () => usesMeanMech() ? MEAN_DOT_MAX : CHIP_THRESHOLD;
  /** Whether there is a choice of role to offer at all. */
  const individualAvailable = () => {
    if (config.proportion) return false;
    const n = resampleSourceValues().length;
    return n >= 2 && n <= individualMax();
  };

  /**
   * Pages whose draw is "resample these numbers with replacement", which is
   * what the mean mechanism animates.
   *
   * Paired belongs here: its DIFFERENCES are a one-sample bootstrap, and it
   * had its own bespoke tiles and no animation at all because nobody had said
   * so in code. `resampleSourceValues()` already hands back the differences.
   * (Jeff, 2026-10-02: "route through one-mean mechanism".)
   */
  const usesMeanMech = () => !config.proportion && !config.twoGroup
    && (config.mode === 'bootstrap' || config.paired);
  /** True when the animated mean-dotplot mechanism should be used right now. */
  const meanDotActive = () => {
    if (!usesMeanMech()) return false;
    const n = resampleSourceValues().length;
    return n >= 2 && n <= MEAN_DOT_MAX
      && meanRole === 'individual' && resampleViewMode !== 'summary';
  };
  /** @type {[number,number]|null} */
  let meanDomain = null;
  // The CI-for-a-mean dotplot uses the SAME shared controller as the one-mean
  // randomization test (js/mean-mechanism.js) — owns the bag, the resample, dot
  // sizing and the pluck-and-fly, so the two strips can't drift. (The CI's Tiles
  // view still uses sim-app's own showResampleSummary; converging that is separate.)
  const meanMech = createMeanMechanism({ formatValue: formatChipValue });
  /** Shared dotplot domain from the original sample (with padding). */
  function computeMeanDomain() {
    const vals = resampleSourceValues();
    if (!vals.length) return null;
    const [lo, hi] = extent(vals);
    const pad = (hi - lo) * 0.08 || 0.5;
    return /** @type {[number,number]} */ ([lo - pad, hi + pad]);
  }

  // B3: two-means bootstrap — show the actual resampling as a pair of dotplots with
  // pluck-and-fly, one shared mean mechanism per group (reusing the one-mean
  // controller). Falls back to the mini-histogram pair for large groups.
  // The two-group DISPLAY — stacked dotplots on one scale — is about the data,
  // not about what the page does to it. It was gated to bootstrap, so the
  // randomization test for a difference in means drew the histogram pair at any
  // n, including n = 9 per group where every observation could have been a dot.
  // What differs between the two pages is the DRAW, and that is decided
  // separately below. (2026-10-02.)
  const isMeanTwoGroup = config.twoGroup && !config.proportion;
  const twoMeanDotActive = () => isMeanTwoGroup && data2.length > 0
    && data1.length >= 2 && data1.length <= MEAN_DOT_MAX
    && data2.length >= 2 && data2.length <= MEAN_DOT_MAX;
  // One scale for both groups: same dot size, same sizing stack, so the two
  // rows are genuinely comparable rather than merely adjacent.
  const twoGroupScale = createSharedScale();
  const mechG1 = createMeanMechanism({ formatValue: formatChipValue, initialView: 'dotplot', scale: twoGroupScale });
  const mechG2 = createMeanMechanism({ formatValue: formatChipValue, initialView: 'dotplot', scale: twoGroupScale });
  /** Shared dotplot domain across BOTH groups so the two panels are comparable. */
  function computeTwoMeanDomain() {
    const all = [...data1, ...data2];
    if (!all.length) return undefined;
    const [lo, hi] = extent(all);
    const pad = (hi - lo) * 0.08 || 0.5;
    return /** @type {[number,number]} */ ([lo - pad, hi + pad]);
  }
  /** @returns {import('./sim-card-mechanism.js').CardOpts} */
  const cardOpts = () => {
    // Prefer the real outcome levels from the data (e.g. "promoted" /
    // "not promoted"); fall back to explicit URL params, then generic words.
    const otherLevel = outcomeLevels.length === 2
      ? outcomeLevels.find(l => l !== successOutcome)
      : (successOutcome ? `not ${successOutcome}` : '');
    return {
      group1Name,
      group2Name,
      successLabel: /** @type {any} */ (urlParams).success || successOutcome || 'success',
      failureLabel: /** @type {any} */ (urlParams).failure || otherLevel || 'failure',
    };
  };

  // DOM elements
  const chartContainer = document.getElementById('chart-container');
  const resultDiv = document.getElementById('result-summary');
  const announceDiv = document.getElementById('sr-announce');
  const resetBtn = /** @type {HTMLButtonElement} */ (document.getElementById('reset-btn'));
  // Confidence-level control: a percent number input (id="ci-level") plus preset
  // pills (.conf-pills), matching the parametric CI pages. Continuous levels.
  const ciSelect = /** @type {HTMLInputElement} */ (document.getElementById('ci-level'));
  const ciPills = /** @type {HTMLElement|null} */ (ciSelect?.closest('.ci-primary, .ci-level-control, .control-row')?.querySelector('.conf-pills') ?? null);
  /** Current confidence level as a percent in [50, 99.9]. */
  const getCiLevel = () => Math.min(99.9, Math.max(50, parseFloat(ciSelect?.value ?? '95') || 95));
  /** Highlight the preset pill matching the current level (if any). */
  function syncCiPills() {
    if (!ciPills) return;
    const lvl = +getCiLevel().toFixed(1);
    for (const b of ciPills.querySelectorAll('button[data-level]')) {
      b.setAttribute('aria-pressed', String(Number(b.getAttribute('data-level')) === lvl));
    }
  }
  // The CI method (percentile vs ±z·SE), its z, its colours, and its marks on the
  // chart all live in js/ci-method.js — shared with the standalone bootstrap-slope page.
  let ciMethod = ciMethodFromUrl();
  /**
   * What the chart's three probability labels show: the level the interval asks
   * for ('target', the default) or the share of resamples actually in each
   * region ('actual'). `?pills=actual` for a link; the control is in the
   * results panel under Show: Detailed.
   */
  let pillMode = /^actual$/i.test(new URLSearchParams(location.search).get('pills') || '')
    ? 'actual' : 'target';
  /** Last bootstrap result, so the CI-method toggle can re-render without a new run.
   *  @type {{stats:number[], ci:number[], se:number, ciLevel:number}|null} */
  let lastBoot = null;
  const seedNotice = document.getElementById('seed-notice');
  const dataSummary = document.getElementById('data-summary');
  const dataPreview = document.getElementById('data-preview');
  const bootStatSelect = /** @type {HTMLSelectElement} */ (document.getElementById('boot-stat'));

  // Bootstrap stat functions keyed by select value
  /** @type {Record<string, {fn: (d: number[]) => number, label: string}>} */
  const BOOT_STATS = {
    mean:   { fn: (d) => mean(d),             label: 'Sample Mean',     longLabel: 'mean' },
    median: { fn: (d) => median(d),           label: 'Sample Median',   longLabel: 'median' },
    sd:     { fn: (d) => sd(d),               label: 'Sample Std Dev',  longLabel: 'standard deviation' },
    // Median-of-halves, matching every quartile a student reads elsewhere on the
    // site (Jeff, 2026-09-20: "let's use median-of-halves throughout"). NOT the
    // percentile-CI quantiles in sim-engine.js, which stay type-7 — that is the
    // interval's own method, not the statistic being bootstrapped.
    // The label drops "25th %ile": under this rule Q1 is the median of the lower
    // half, which is not the interpolated 25th percentile, and naming it that
    // would teach the thing we just stopped computing.
    q1:     { fn: (d) => quartiles(d).q1,     label: 'Q1 (first quartile)', longLabel: 'first quartile' },
    q3:     { fn: (d) => quartiles(d).q3,     label: 'Q3 (third quartile)', longLabel: 'third quartile' },
  };

  /** Get the current bootstrap stat function and label. */
  function getBootstrapStat() {
    const key = bootStatSelect?.value ?? 'mean';
    return BOOT_STATS[key] ?? BOOT_STATS.mean;
  }

  // Generate bar buttons
  const genBtns = /** @type {NodeListOf<HTMLButtonElement>} */ (
    document.querySelectorAll('.gen-btn'));

  // Controls section (for sticky + expert toggle)
  const controlsSection = document.getElementById('controls');

  // Confidence level is the CORE control of a CI tool → keep it always visible on
  // bootstrap pages; only the advanced statistic selector (bootstrap-mean:
  // median/SD/quartiles) stays behind "More options". It sits in its own row above
  // the confidence control (mirroring the proportion pages' success selector) so the
  // confidence box + pills land in the same place on every bootstrap page.
  // Randomization pages keep the whole control row expert-only as before.
  const controlRow = controlsSection?.querySelector('.control-row');
  if (config.mode === 'bootstrap') {
    const statRow = document.getElementById('stat-selector')
      ?? controlsSection?.querySelector('label[for="boot-stat"]');
    if (statRow) statRow.classList.add('expert-only');
  } else if (controlRow) {
    controlRow.classList.add('expert-only');
  }

  // Add expert toggle link next to generate bar
  const generateBar = controlsSection?.querySelector('.generate-bar');
  // The old inline "More options" button lived here, beside "Shuffles", where it
  // read as more options FOR shuffles. It is now the Simple | Detailed control in
  // the page header (js/page-utils.js initDisplayToggle).

  /**
   * Snapshot the current tool configuration as a shareable URL state.
   * Captures the data source (bundled dataset id, or the original ?csv/?data
   * the page was loaded with) plus every control toggle and the seed, so the
   * copied link reproduces this exact configuration for another viewer.
   * @returns {{dataset?: string, data?: number[], params: Record<string, any>}}
   */
  function getShareState() {
    /** @type {Record<string, any>} */
    const params = {};
    // Seed — always pin so the link reproduces the same simulation.
    if (seed != null && seed !== '') params.seed = seed;
    // Alternative-hypothesis direction (randomization pages).
    if (altDirectionBtn) {
      const dirMap = { right: 'greater', left: 'less', both: 'two-sided' };
      params.direction = dirMap[getDirection()];
    }
    // CI level + bootstrap statistic (bootstrap pages; omit defaults).
    if (config.mode === 'bootstrap') {
      const ci = ciSelect?.value;
      if (ci && ci !== '95') params.ci = ci;
      const stat = bootStatSelect?.value;
      if (stat && stat !== 'mean') params.stat = stat;
    }
    // Card mechanism toggle (two-proportion randomization).
    if (cardMechanism) params.mechanism = 'cards';
    // …and which colour it deals the success as, when that is not the default.
    if (cardColorSwapped) params.cardcolor = 'white';
    // Individual | Aggregate, when it has been moved off the default AND the
    // choice was the reader's. Above MAX_MARBLES the aggregate is forced by n,
    // and pinning that in the link would carry it to a dataset small enough to
    // have had the choice.
    const biggestGroup = Math.max(data1?.length ?? 0, data2?.length ?? 0);
    if ((useNewPropMech || useNewPropMech2()) && propMechStyle !== 'dots'
        && hasIndividualView(biggestGroup)) {
      params.mechstyle = propMechStyle === 'aggregate' ? 'aggregate' : propMechStyle;
    }
    // Editable null value (expert mode; omit the default 0).
    const nv = getNullValue();
    if (nv !== 0) params.null_value = nv;
    // What the plot's probability labels show (omit the default).
    if (pillMode === 'actual') params.pills = 'actual';
    // Success outcome for proportion tests.
    if (successOutcome && successOutcome !== 'success') params.success = successOutcome;

    /** @type {{dataset?: string, data?: number[], params: Record<string, any>}} */
    const state = { params };
    if (currentDatasetJSON?.id) {
      state.dataset = currentDatasetJSON.id;
    } else {
      // Data came from a URL (?csv=/?data=/?json=) — preserve it verbatim.
      const up = /** @type {any} */ (urlParams);
      if (up.csv) params.csv = up.csv;
      else if (up.json) params.json = up.json;
      else if (up.data) params.data = up.data;
    }
    return state;
  }

  // Mount the "Copy link" button in the generate bar.
  // The address bar carries the shareable state, so Share, the QR and a
  // straight copy out of the browser all agree (js/share-state.js). This
  // replaced a "Copy link" button that was the only thing doing it correctly,
  // and existed on two pages out of seventy-one.
  registerShareState(getShareState);
  syncUrlOnInteraction();

  // Mechanism strip elements
  const mechanismStrip = document.getElementById('mechanism-strip');
  const mechanismDescEl = document.getElementById('mechanism-description');

  // One-sample bootstrap mechanism (specific elements)
  const originalContentEl = document.getElementById('original-sample-content');
  const resampleContentEl = document.getElementById('resample-content');
  const bootstrapSampleEl = document.getElementById('bootstrap-sample');

  // Move mechanism description inside the resample panel so it appears under that half
  if (mechanismDescEl && bootstrapSampleEl) {
    bootstrapSampleEl.appendChild(mechanismDescEl);
  }
  const origNEl = document.getElementById('orig-n');
  const origMeanEl = document.getElementById('orig-mean');
  const resampleMeanEl = document.getElementById('resample-mean');
  const resampleToggle = document.getElementById('resample-view-toggle');

  // Two-group mechanism (bootstrap two-sample and randomization)
  const mechOriginalContent = document.getElementById('mech-original-content');
  const mechResampleContent = document.getElementById('mech-resample-content');

  /** Threshold: show individual chips below this, histogram above. */
  const CHIP_THRESHOLD = 30;
  /** viewBox height for the strip's mini histograms — see the margin comment. */
  const MINI_VIEW_H = 250;
  /** @type {'summary'|'histogram'} */
  let resampleViewMode = 'summary';
  /** Whether the view mode was explicitly chosen by the user (overrides auto-default). */
  let resampleViewExplicit = false;
  // ?mview= pins the mechanism view so an activity can ask for one. Needed
  // because a dataset over CHIP_THRESHOLD auto-switches to the histogram, and
  // `bootstrap-explore` on penny_ages (648 rows) is built around COUNTING
  // repeats — a task the histogram cannot do. Reported as "'Tiles' need to be
  // selected to determine how many pennies were selected 3+ times"
  // (REQ-057 item 2, Todd Will). Treated as an explicit choice, so the
  // auto-default leaves it alone.
  {
    // Only `tiles` is honoured. The mean mechanism carries its own three-way
    // Tiles|Dotplot|Histogram control, so forcing `histogram` from here sets
    // sim-app's two-way mode without moving that one — a documented value that
    // half-works is worse than no value, and the histogram is already the
    // auto-default for large n anyway.
    const mv = (new URLSearchParams(location.search).get('mview') || '').toLowerCase();
    if (mv === 'tiles' || mv === 'summary') { resampleViewMode = 'summary'; resampleViewExplicit = true; }
    // …and the role, by its own name. `aggregate` is what `histogram` always
    // meant here; it is spelled the way the control now spells it.
    if (mv === 'aggregate') { meanRole = 'aggregate'; resampleViewMode = 'histogram'; resampleViewExplicit = true; }
    // The ROLE only. Pinning the rendering as well is what `tiles` is for, and
    // doing it here made ?mview=individual mean "individual, drawn as tiles" —
    // which on a page where Dots leads is not what it says.
    if (mv === 'individual') meanRole = 'individual';
  }
  /** @type {number[]} */
  let lastResample = [];
  /** The differences the last sign flip was applied to, for a view switch. */
  /** @type {number[]} */
  let lastPairedOriginal = [];
  /** Which observations the last resample drew, when it was drawn by index. */
  /** @type {number[]|null} */
  let lastResampleIndices = null;
  /** The same, per group, for the two-sample bootstrap. */
  /** @type {number[]|null} */
  let lastRsIdx1 = null;
  /** @type {number[]|null} */
  let lastRsIdx2 = null;
  /** Last shuffled/resampled two-group grouping — lets the Bars/Cards toggle
   *  re-render the resample panel without re-running the simulation. */
  /** @type {number[]} */
  let lastTwoG1 = [];
  /** @type {number[]} */
  let lastTwoG2 = [];
  /** Cached original-sample histogram result for morph animation (large-n). */
  /** @type {{ bins: ReturnType<typeof computeBins>['bins'], thresholds: number[], numBins: number } | null} */
  let origHistCache = null;
  /** Cached original proportion counts for proportion bar morph. */
  /** @type {{ successes: number, failures: number, pHat: number } | null} */
  let origPropCache = null;
  /** Duration (ms) of last two-group boxplot morph animation. */
  let twoGroupMorphMs = 0;
  /** Whether the last generate action was +1 (for persistent highlight). */
  let lastWasSingle = false;
  /** Whether the mechanism strip has been initialized (deferred to first generate). */
  let mechanismInitialized = false;

  /** Dataset context for natural-language interpretations. */
  /** @type {{population?:string, parameter?:string, unit?:string, nullClaim?:string, successLabel?:string, mechanismVerb?:string}} */
  let datasetContext = {};
  /** Full dataset JSON for info panel. @type {object|undefined} */
  let currentDatasetJSON;

  /** Base page title (before dataset context is added). */
  const baseTitle = document.title.replace(/\s*\|\s*StatLens$/, '');

  /** Track current data source name for save filename. */
  let currentSourceName = 'data';

  /** Track selected variable name for interpretation text. */
  let selectedVarName = '';

  /** Decimal places in source data (for formatStat). */
  let dataPrecision = 0;


  // Chart highlight state (declared early so renderChart can be called from showDataLoaded)
  /** Index of single newest dot for +1 highlight, or -1. */
  let lastStatIndex = -1;
  /** Indices of batch-added dots for +10 highlight, or null. */
  /** @type {Set<number>|null} */
  let batchHighlightIndices = null;
  /** Previous histogram bin counts for stacked delta highlight (batch only). */
  /** @type {number[]|null} */
  let prevBinCounts = null;
  /** New stat value for single-value histogram highlight (+1 case). */
  /** @type {number|null} */
  let lastHighlightValue = null;
  /** User's chart type preference: 'auto' (dotplot ≤200, histogram >200), 'dotplot', or 'histogram'. */
  /** @type {'auto'|'dotplot'|'histogram'} */
  let chartType = 'auto';
  /** Cached render params for chart type toggle re-render. */
  /** @type {[number,number]|null} */
  // REQ-055: when embedded in a MyOpenMath question, post the value the student
  // produces into the answer box. Bootstrap pages default to the lower CI bound
  // and randomization pages to the p-value, since those are what the homework
  // asks for; `?report=` overrides.
  const answer = initAnswerReport({
    defaultKey: config.mode === 'bootstrap' ? 'ci_lower' : 'p_value',
    keys: ['ci_lower', 'ci_upper', 'se', 'stat', 'p_value', 'count'],
  });

  let lastCI = null;
  /** @type {number|undefined} */
  let lastObserved;
  /** @type {'left'|'right'|'both'|undefined} */
  let lastDirection;
  /** Pre-simulated domain for initial empty chart axis. */
  /** @type {[number,number]|null} */
  let preSimDomain = null;
  /** Locked dotplot bin grid — computed once from preSimDomain, reused for all renders. */
  /** @type {{ binWidth: number, binOrigin: number } | null} */
  let lockedDotGrid = null;
  /** Cached histogram result for theory overlay. */
  /** @type {{ xScale: any, yScale: any, bins: any[], domain: [number,number] } | null} */
  let lastHistResult = null;
  /** Cached dotplot result for theory overlay on dotplots. */
  /** @type {{ xScale: any, frame: any, domain: [number,number], maxStack: number, numBins: number } | null} */
  let lastDotResult = null;

  // Chart type toggle (Dotplot / Histogram) — radio-based segmented control
  /** @type {HTMLFieldSetElement|null} */
  let toggleFieldset = null;
  /** @type {((type: string) => void)|null} */
  let setToggleSelected = null;
  if (chartContainer) {
    const toggle = createChartToggle(chartContainer, {
      onChange: (type) => {
        chartType = type;
        if (binAdjuster) binAdjuster.setMode(type);
        if (allStats.length > 0) {
          lastStatIndex = -1;
          batchHighlightIndices = null;
          prevBinCounts = null;
          lastHighlightValue = null;
          renderChart(allStats, lastCI, lastObserved, lastDirection);
        }
      },
    });
    toggleFieldset = toggle.fieldset;
    setToggleSelected = toggle.setSelected;
    // Chart toggle, theory overlay, and bin adjuster are expert-only
    toggleFieldset.classList.add('expert-only');
  }

  // ─── Theory overlay toggle ───
  /** @type {HTMLInputElement|null} */
  let theoryCheckbox = null;
  let theoryOverlayOn = false;
  if (toggleFieldset && config.mode === 'bootstrap') {
    theoryCheckbox = createTheoryToggle(toggleFieldset, (checked) => {
      theoryOverlayOn = checked;
      if (allStats.length > 0) {
        if (checked) {
          renderChart(allStats, lastCI, lastObserved, lastDirection);
        } else if (chartContainer) {
          removeTheoryOverlay(chartContainer);
        }
      }
    });
  }

  // ─── Bin adjuster (continuous data only — proportions have fixed k/n bins) ───
  const DEFAULT_BINS = 20;
  /** @type {number|undefined} */
  let userBinCount = config.proportion ? undefined : DEFAULT_BINS;
  /** @type {import('./chart-defaults.js').BinAdjusterControl|null} */
  let binAdjuster = null;
  if (toggleFieldset && !config.proportion) {
    binAdjuster = createBinAdjuster(toggleFieldset, {
      currentBins: 20,
      onChange: (bins) => {
        userBinCount = bins;
        // Recompute locked dot grid with new bin count
        if (preSimDomain) {
          const gridBinWidth = (preSimDomain[1] - preSimDomain[0]) / bins;
          lockedDotGrid = { binWidth: gridBinWidth, binOrigin: preSimDomain[0] };
        }
        if (allStats.length > 0) {
          lastStatIndex = -1;
          batchHighlightIndices = null;
          prevBinCounts = null;
          lastHighlightValue = null;
          renderChart(allStats, lastCI, lastObserved, lastDirection);
        }
      },
    });
  }

  /**
   * Get the active chart type for a set of simulated stats, resolving 'auto'.
   * @param {number[]} [stats] - defaults to every stat currently on screen
   * @returns {'dotplot'|'histogram'|'spike'}
   */
  function getActiveChartType(stats = allStats) {
    // Reasoning-mode figures (plot=only / readout=false) hide the chart toggle,
    // so pick a shape that reads well without controls: discrete spike bars for
    // a small/moderate-n proportion (the honest "possible k/n" picture), binning
    // to a histogram only once the discrete values would crowd into a cloud, and
    // a histogram for continuous statistics. (readout=false keeps the toggle, so
    // the student can still switch.)
    if ((plotOnly || !showReadout) && chartType === 'auto') {
      return reasoningChartType(stats, { proportion: !!config.proportion });
    }
    // A discrete grid gets finer as the sample grows; past a point its columns
    // can no longer be drawn apart, and a histogram is the honest shape.
    return resolveChartType(stats.length, chartType,
      { discreteColumns: discreteColumnSpan(stats, discreteGridStep()) });
  }

  /**
   * Overlay a normal theory curve on the current histogram.
   * Computes the appropriate normal approximation depending on the mode:
   *   - One mean: N(x̄, s/√n)
   *   - Paired: N(d̄, s_d/√n)
   *   - Two means: N(x̄₁ - x̄₂, SE) where SE = √(s₁²/n₁ + s₂²/n₂)
   *   - One proportion: N(p̂, √(p̂(1−p̂)/n))
   *   - Two proportions: N(p̂₁ - p̂₂, SE) where SE uses individual p̂'s
   * @param {number[]} stats
   */
  function applyTheoryOverlay(stats) {
    if (!chartContainer || data1.length === 0) return;

    let center = 0;
    let se = 0;
    let label = 'N(est, SE)';

    if (config.paired && data2.length > 0) {
      // Paired: bootstrap the mean difference
      const diffs = data2.map((v, i) => v - data1[i]);
      center = mean(diffs);
      se = sd(diffs) / Math.sqrt(diffs.length);
      label = 'N(d\u0304, SE)';
    } else if (config.proportion && config.twoGroup && data2.length > 0) {
      // Two proportions: bootstrap the difference p̂₁ − p̂₂
      const p1 = mean(data1);
      const p2 = mean(data2);
      center = p1 - p2;
      se = Math.sqrt(p1 * (1 - p1) / data1.length + p2 * (1 - p2) / data2.length);
      label = 'N(p\u0302₁−p\u0302₂, SE)';
    } else if (config.proportion) {
      // One proportion
      const pHat = mean(data1);
      center = pHat;
      se = Math.sqrt(pHat * (1 - pHat) / data1.length);
      label = `N(p\u0302, SE)`;
    } else if (config.twoGroup && data2.length > 0) {
      // Two means: bootstrap the difference x̄₁ − x̄₂
      center = mean(data1) - mean(data2);
      const s1 = sd(data1);
      const s2 = sd(data2);
      se = Math.sqrt(s1 * s1 / data1.length + s2 * s2 / data2.length);
      label = 'N(x\u0304₁−x\u0304₂, SE)';
    } else {
      // One mean (default)
      center = mean(data1);
      se = sd(data1) / Math.sqrt(data1.length);
      label = 'N(x\u0304, SE)';
    }

    if (!isFinite(se) || se <= 0) return;

    if (lastHistResult) {
      // Histogram mode: scale PDF to match histogram bar heights
      const { xScale: hxScale, yScale: hyScale, bins, domain: dom } = lastHistResult;
      if (!bins || bins.length === 0) return;
      // The TYPICAL bin, not the first one.
      //
      // A frequency histogram's bars are n·w·density, so the curve has to be
      // scaled by a bin width — and this took `bins[0]`'s. On a discrete
      // statistic the thresholds are snapped to the lattice and the bins come
      // out ragged: measured on transplant_survival at n = 34, widths run
      // 0.0456, 0.0588, 0.0588, 0.0441, 0.0147, … so the first bin is 22%
      // narrower than the common one and the curve was drawn 22% short of the
      // bars it is meant to be compared with — 2,332 against a 2,835 peak.
      // (Jeff, 2026-10-04: "the normal curve on the sampling distribution is
      // not scaled correctly.")
      //
      // The median is the width most bars actually have, so the curve tracks
      // the bulk of the histogram and stays smooth. It cannot also match the
      // narrow bins — with unequal widths no single smooth curve can, which is
      // a property of the binning rather than of the curve (see D-30).
      const widths = bins
        .map(b => /** @type {number} */ (b.x1) - /** @type {number} */ (b.x0))
        .filter(w => Number.isFinite(w) && w > 0)
        .sort((a, b) => a - b);
      if (!widths.length) return;
      const binWidth = widths[Math.floor(widths.length / 2)];

      overlayTheoryCurve({
        container: chartContainer,
        pdf: (x) => normalPdf(x, center, se),
        xDomain: dom,
        totalN: stats.length,
        binWidth,
        xScale: hxScale,
        yScale: hyScale,
        label,
      });
    } else if (lastDotResult) {
      // Dotplot mode: same frequency scaling as the histogram — the expected count
      // in a bin is n · binWidth · pdf(x) — mapped through the dotplot's OWN
      // count → pixel-y function. That mapping is stacked dots at small n and a
      // y-axis scale once the stacks would overflow into filled columns; deriving
      // it from the dot radius instead (as this used to) left the curve wildly
      // out of scale in column mode.
      const { xScale: dxScale, maxStack, countToY, binWidth: dotBinWidth, domain: dom } = lastDotResult;
      if (!countToY || !dotBinWidth || maxStack <= 0) return;

      overlayTheoryCurve({
        container: chartContainer,
        pdf: (x) => normalPdf(x, center, se),
        xDomain: dom,
        totalN: stats.length,
        binWidth: dotBinWidth,
        xScale: dxScale,
        yScale: countToY,
        label,
      });
    }
  }

  /**
   * Rebuild the chart toggle options based on whether data is discrete.
   * @param {boolean} isDiscrete
   */
  function updateToggleButtons(isDiscrete) {
    if (!toggleFieldset) return;
    const currentType = chartType;
    if (!isDiscrete && currentType === 'spike') chartType = 'auto';
    const types = isDiscrete
      ? [['dotplot', 'Dotplot'], ['spike', 'Spike'], ['histogram', 'Histogram']]
      : [['dotplot', 'Dotplot'], ['histogram', 'Histogram']];
    // Highlight whatever 'auto' would actually draw, not a guess.
    const selected = chartType === 'auto'
      ? resolveChartType(allStats.length, 'auto')
      : chartType;
    // Remove existing chart type buttons but keep non-button children (theory toggle, bin adjuster)
    toggleFieldset.querySelectorAll('button[data-value]').forEach(b => b.remove());
    // ...which orphans the closure createChartToggle handed back: its setSelected
    // still points at the buttons just removed, so pressing Spike or Histogram
    // updated detached nodes and "Dotplot" stayed highlighted however many times
    // you switched (Todd Will, 2026-09-25). Re-point it at the live buttons.
    setToggleSelected = (/** @type {string} */ type) => {
      for (const b of toggleFieldset.querySelectorAll('button[data-value]')) {
        b.setAttribute('aria-pressed', String(b.getAttribute('data-value') === type));
      }
    };
    // Insert new segmented buttons at the start
    const refChild = toggleFieldset.firstChild;
    for (const [value, label] of types) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.dataset.value = value;
      btn.setAttribute('aria-pressed', String(value === selected));
      btn.addEventListener('click', () => {
        chartType = value;
        if (setToggleSelected) setToggleSelected(value);
        if (binAdjuster) binAdjuster.setMode(value);
        if (allStats.length > 0) {
          lastStatIndex = -1;
          batchHighlightIndices = null;
          prevBinCounts = null;
          lastHighlightValue = null;
          renderChart(allStats, lastCI, lastObserved, lastDirection);
        }
      });
      toggleFieldset.insertBefore(btn, refChild);
    }
  }

  // Tab handling. Shared with every other data page (page-utils), so the
  // "Open URL" tab that initDataPanel injects later is wired here too.
  initTabs({ hintTarget: resultDiv, hintAction: 'run a simulation to see results' });

  // Hypothesis display elements (randomization tests)
  const hypothesisDisplay = document.getElementById('hypothesis-display');
  const altDirectionBtn = /** @type {HTMLButtonElement} */ (document.getElementById('alt-direction'));
  const swapGroupsBtn = document.getElementById('swap-groups');
  const hGroup1 = document.getElementById('h-group1');
  const hGroup2 = document.getElementById('h-group2');
  const haGroup1 = document.getElementById('ha-group1');
  const haGroup2 = document.getElementById('ha-group2');

  // Editable null value (expert-only, for paired/two-group means randomization)
  const nullValueInput = /** @type {HTMLInputElement|null} */ (document.getElementById('null-value'));
  const nullDisplayMirror = document.getElementById('null-display');

  /** Get the null hypothesis value (δ₀). Returns 0 in standard mode or when input is absent. */
  function getNullValue() {
    if (!nullValueInput) return 0;
    const val = parseFloat(nullValueInput.value);
    return isFinite(val) ? val : 0;
  }

  // A null value asked for in the link.
  //
  // `getShareState` has written `null_value` into every shared link since the
  // editable null landed, and nothing ever read it back — so a link pinning a
  // non-zero null reopened at zero, silently answering a different question
  // from the one it was sharing. The share state and the page have to agree on
  // the round trip or the link is worse than no link. (Jeff, 2026-10-02:
  // "fix it so that we can pass null values".)
  if (nullValueInput) {
    const asked = parseParams().null_value;
    if (asked != null && Number.isFinite(Number(asked))) {
      nullValueInput.value = String(asked);
      if (nullDisplayMirror) nullDisplayMirror.textContent = String(asked);
    }
  }

  // Sync null-display mirror and re-run when null value changes
  if (nullValueInput) {
    nullValueInput.addEventListener('input', () => {
      if (nullDisplayMirror) nullDisplayMirror.textContent = nullValueInput.value || '0';
      // Re-render chart + results if simulation has run
      if (allStats.length > 0) {
        const nullDiff = getNullValue();
        const rawObserved = config.paired
          ? mean(data2.map((v, i) => v - data1[i]))
          : config.testStat(data1, data2);
        const observedStat = rawObserved - nullDiff;
        const direction = getDirection();
        renderChart(allStats, null, observedStat, direction);
        const { pValue, extremeCount } = permutationPValue(allStats, observedStat, direction);
        displayRandomizationResults(allStats, observedStat, pValue, extremeCount, direction);
      }
    });
  }

  // Success outcome selector (proportion tests)
  const successSelector = document.getElementById('success-selector');
  const successOutcomeSelect = /** @type {HTMLSelectElement} */ (document.getElementById('success-outcome'));

  /** @type {number[]} */
  let data1 = [];
  /** @type {number[]} */
  let data2 = [];
  let group1Name = 'Group 1';
  let group2Name = 'Group 2';

  // Raw categorical data for proportion tests (needed for re-encoding on success change)
  /** @type {string[]} */
  let rawOutcomes1 = [];
  /** @type {string[]} */
  let rawOutcomes2 = [];
  let successOutcome = '';
  /** All outcome levels in the loaded data (used to label the card legend). */
  /** @type {string[]} */
  let outcomeLevels = [];

  // Accumulated stats and RNG
  /** @type {number[]} */
  let allStats = [];
  /** @type {(() => number)|null} */
  let rng = null;

  // Seed: use URL seed for reproducibility (graded work), otherwise random each session
  const urlSeed = urlParams.seed;
  let seed = urlSeed ?? Math.random().toString(36).slice(2, 10);
  if (urlSeed && seedNotice) {
    seedNotice.hidden = false;
    seedNotice.textContent = `Seed: ${urlSeed}`;
  }

  // Apply URL params (data loading is now handled by initDataPanel)
  if (urlParams.ci && ciSelect) {
    ciSelect.value = String(urlParams.ci);
  }
  if (urlParams.stat && bootStatSelect) {
    bootStatSelect.value = urlParams.stat;
  }

  // ─── Variable selector ───
  //
  // There isn't one here any more. This engine grew its own — a `<select>` of
  // the numeric columns, built, inserted and torn down by hand — and so did
  // twenty other modules, each with its own ids and its own "only show it when
  // there is a choice" rule, while the two-group pages had none at all. It is
  // the data panel's job now: `needs: simNeeds` above, resolved by
  // js/variable-picker.js. (Jeff, 2026-10-03: "it feels like we're building
  // lots of one-off bits of code when we should be developing things centrally
  // and applying them … shouldn't that just be kind of universal?")

  // ─── Data loading ───

  /**
   * Load a table the tool has never seen before.
   *
   * `pick` says which column fills which role — resolved by the shared picker
   * (js/variable-picker.js) from the shape `simNeeds` declares, with the
   * reader's control on screen to change it. This function used to decide for
   * itself, with `parsed.types.indexOf('numeric')`: the FIRST numeric column in
   * file order, which on a class survey is the row number.
   *
   * @param {{headers: string[], types: string[], data: Array<Record<string, any>>}} parsed
   * @param {Record<string, string>} pick slot key → column name
   * @param {string} raw the original text, for data that is not a table at all
   */
  function loadParsedData(parsed, pick, raw) {
    datasetContext = {};
    // Changing a column is new data, not a new view of the old: whatever has
    // been simulated was simulated from something else. (The engine's own
    // variable selector used to do this; the central picker re-enters here.)
    resetSimulation();
    const col = (/** @type {string} */ key) => pick[key];
    const values = (/** @type {string} */ name) =>
      parsed.data.map(r => parseFloat(r[name])).filter(v => isFinite(v));

    if (parsed.headers.length > 0 && parsed.data.length > 0) {
      if (config.paired && col('first') && col('second')) {
        group1Name = col('first');
        group2Name = col('second');
        data1 = values(col('first'));
        data2 = values(col('second'));
        const minLen = Math.min(data1.length, data2.length);
        data1 = data1.slice(0, minLen);
        data2 = data2.slice(0, minLen);
        showDataLoaded();
        return;
      }
      if (config.proportion && !config.twoGroup && col('outcome')) {
        rawOutcomes1 = parsed.data.map(r => r[col('outcome')]);
        rawOutcomes2 = [];
        populateSuccessSelector([...new Set(rawOutcomes1)]);
        encodeProportionData();
        showDataLoaded();
        return;
      }
      if (config.proportion && col('group') && col('outcome')) {
        const g = col('group'), o = col('outcome');
        const groups = [...new Set(parsed.data.map(r => r[g]))];
        if (groups.length >= 2) {
          group1Name = groups[0];
          group2Name = groups[1];
          rawOutcomes1 = parsed.data.filter(r => r[g] === groups[0]).map(r => r[o]);
          rawOutcomes2 = parsed.data.filter(r => r[g] === groups[1]).map(r => r[o]);
          populateSuccessSelector([...new Set(parsed.data.map(r => r[o]))]);
          encodeProportionData();
          showDataLoaded();
          return;
        }
      }
      if (config.twoGroup && col('group') && col('response')) {
        const g = col('group'), v = col('response');
        const groups = [...new Set(parsed.data.map(r => r[g]))];
        if (groups.length >= 2) {
          group1Name = groups[0];
          group2Name = groups[1];
          data1 = parsed.data.filter(r => r[g] === groups[0]).map(r => parseFloat(r[v])).filter(x => isFinite(x));
          data2 = parsed.data.filter(r => r[g] === groups[1]).map(r => parseFloat(r[v])).filter(x => isFinite(x));
          showDataLoaded();
          return;
        }
      }
      if (col('response')) {
        selectedVarName = col('response');
        datasetContext.parameter = col('response');
        data1 = values(col('response'));
        data2 = [];
        showDataLoaded();
        return;
      }
      // A table the page cannot use. Say which columns it was looking for
      // rather than falling through to "no numeric data found", which is both
      // wrong and unactionable when the file is full of numbers.
      const wanted = simNeeds.map(n => n.label.replace(/:$/, '').toLowerCase()).join(' and ');
      announce(`This tool needs ${wanted}. Nothing in this file fits.`);
      return;
    }

    // Not a table: a bare list of numbers, which `?data=` and a quick paste
    // both produce.
    const flat = String(raw).split(/[\n,]+/)
      .map(t => t.trim()).filter(t => t.length > 0)
      .map(Number).filter(v => isFinite(v));
    if (flat.length > 0) {
      data1 = flat;
      data2 = [];
      showDataLoaded();
    } else {
      announce('No numeric data found. Check your data format.');
    }
  }

  // ── Summary input (proportion pages) ──
  const loadSummaryBtn = document.getElementById('load-summary');
  if (loadSummaryBtn && config.proportion) {
    loadSummaryBtn.addEventListener('click', () => {
      // Summary stats are a NEW problem, so the old study goes with them.
      //
      // This handler used to set the group names and re-render, leaving
      // `datasetContext` and the source name untouched — so after loading
      // heart_transplant and then typing an unrelated 30/100 vs 45/120, the
      // summary line still read "Heart Transplant Survival: …" and the
      // plain-language null still read "survival rate is the same regardless of
      // whether a transplant was received", over numbers from another study.
      // (Todd Will, REQ-068 B.)
      //
      // The paste/file loader has always cleared the context, and the
      // dataset→dataset path was fixed on 2026-09-25; summary entry was the one
      // loader that never did. All three clear it now.
      datasetContext = {};
      currentSourceName = '';
      selectedVarName = '';
      resetSimulation();
      reportInputProblem(loadSummaryBtn, '');   // clear any previous refusal

      if (config.twoGroup) {
        // Two-proportion summary: two groups with successes + n
        const x1El = /** @type {HTMLInputElement|null} */ (document.getElementById('input-x1'));
        const n1El = /** @type {HTMLInputElement|null} */ (document.getElementById('input-n1'));
        const x2El = /** @type {HTMLInputElement|null} */ (document.getElementById('input-x2'));
        const n2El = /** @type {HTMLInputElement|null} */ (document.getElementById('input-n2'));
        const lbl1El = /** @type {HTMLInputElement|null} */ (document.getElementById('input-label1'));
        const lbl2El = /** @type {HTMLInputElement|null} */ (document.getElementById('input-label2'));

        const x1 = Math.round(Number(x1El?.value));
        const n1 = Math.round(Number(n1El?.value));
        const x2 = Math.round(Number(x2El?.value));
        const n2 = Math.round(Number(n2El?.value));

        if (!Number.isFinite(n1) || n1 < 1 || !Number.isFinite(n2) || n2 < 1) {
          reportInputProblem(loadSummaryBtn, 'Enter both sample sizes — the grey numbers are only examples.');
          return;
        }
        if (!Number.isFinite(x1) || x1 < 0 || x1 > n1) {
          reportInputProblem(loadSummaryBtn, 'Group 1 successes must be between 0 and n\u2081.');
          return;
        }
        if (!Number.isFinite(x2) || x2 < 0 || x2 > n2) {
          reportInputProblem(loadSummaryBtn, 'Group 2 successes must be between 0 and n\u2082.');
          return;
        }

        group1Name = lbl1El?.value?.trim() || 'Group 1';
        group2Name = lbl2El?.value?.trim() || 'Group 2';
        successOutcome = 'success';

        // Encode as 0/1 arrays
        data1 = Array(n1).fill(0);
        for (let i = 0; i < x1; i++) data1[i] = 1;
        data2 = Array(n2).fill(0);
        for (let i = 0; i < x2; i++) data2[i] = 1;

        rawOutcomes1 = data1.map(v => v === 1 ? 'success' : 'failure');
        rawOutcomes2 = data2.map(v => v === 1 ? 'success' : 'failure');

        if (successSelector) successSelector.hidden = true;
        showDataLoaded();
        dataApi.triggerPostLoad();
        announce(`Loaded: ${group1Name} ${x1}/${n1}, ${group2Name} ${x2}/${n2}.`);
      } else {
        // One-proportion summary: successes + n
        const nEl = /** @type {HTMLInputElement|null} */ (document.getElementById('input-n'));
        const kEl = /** @type {HTMLInputElement|null} */ (document.getElementById('input-successes'));

        const n = Math.round(Number(nEl?.value));
        const k = Math.round(Number(kEl?.value));

        if (!Number.isFinite(n) || n < 1) {
          reportInputProblem(loadSummaryBtn, 'Enter a sample size (n) — the grey number is only an example.');
          return;
        }
        if (!Number.isFinite(k) || k < 0 || k > n) {
          reportInputProblem(loadSummaryBtn, 'Successes must be a whole number between 0 and n.');
          return;
        }

        successOutcome = 'success';
        data1 = Array(n).fill(0);
        for (let i = 0; i < k; i++) data1[i] = 1;
        data2 = [];

        rawOutcomes1 = data1.map(v => v === 1 ? 'success' : 'failure');
        rawOutcomes2 = [];

        if (successSelector) successSelector.hidden = true;
        showDataLoaded();
        dataApi.triggerPostLoad();
        announce(`Loaded: n = ${n}, successes = ${k}.`);
      }
    });
  }

  function showDataLoaded() {
    // Set dataPrecision based on source data type, capped at 2 so that
    // computed stats (d + 1 rule) never exceed 3 decimal places.
    if (config.proportion) {
      dataPrecision = 0; // proportion data is 0/1 integers
    } else if (config.paired || (config.twoGroup && data2.length > 0)) {
      dataPrecision = Math.min(2, Math.max(detectPrecision(data1), detectPrecision(data2)));
    } else {
      dataPrecision = Math.min(2, detectPrecision(data1));
    }

    if (dataPreview) dataPreview.hidden = false;
    if (dataSummary) {
      const namePrefix = currentSourceName && currentSourceName !== 'data' ? `${currentSourceName}: ` : '';
      if (config.paired) {
        const diffs = data2.map((v, i) => v - data1[i]);
        const m = mean(diffs);
        dataSummary.innerHTML =
          `${namePrefix}${data1.length} pairs | ${group1Name}: <span class="x-bar">x</span> = ${formatStat(mean(data1), dataPrecision)} | ` +
          `${group2Name}: <span class="x-bar">x</span> = ${formatStat(mean(data2), dataPrecision)} | Mean diff (${group2Name} \u2212 ${group1Name}) = ${formatStat(m, dataPrecision)}`;
      } else if (config.proportion && !config.twoGroup) {
        const p1 = mean(data1);
        const s1 = data1.filter(v => v === 1).length;
        dataSummary.textContent =
          `${namePrefix}n = ${data1.length}, successes = ${s1}, p̂ = ${formatStat(p1, dataPrecision, 'proportion')}`;
      } else if (config.proportion && data2.length > 0) {
        const p1 = mean(data1);
        const p2 = mean(data2);
        const s1 = data1.filter(v => v === 1).length;
        const s2 = data2.filter(v => v === 1).length;
        dataSummary.textContent =
          `${namePrefix}${group1Name}: ${s1}/${data1.length} (p̂ = ${formatStat(p1, dataPrecision, 'proportion')}) | ` +
          `${group2Name}: ${s2}/${data2.length} (p̂ = ${formatStat(p2, dataPrecision, 'proportion')})`;
      } else if (config.twoGroup && data2.length > 0) {
        dataSummary.innerHTML =
          `${namePrefix}${group1Name}: n = ${data1.length}, <span class="x-bar">x</span> = ${formatStat(mean(data1), dataPrecision)} | ` +
          `${group2Name}: n = ${data2.length}, <span class="x-bar">x</span> = ${formatStat(mean(data2), dataPrecision)}`;
      } else {
        const n = data1.length;
        const m = mean(data1);
        const s = sd(data1);
        const varPrefix = selectedVarName ? `${selectedVarName}: ` : '';
        dataSummary.textContent = `${namePrefix}${varPrefix}n = ${n}, mean = ${formatStat(m, dataPrecision)}, SD = ${formatStat(s, dataPrecision)}`;
      }
    }
    for (const btn of genBtns) btn.disabled = false;
    // …except a batch big enough to freeze the page. See gateBigBatches.
    gateBigBatches(genBtns, data1.length + data2.length);
    // Update chart toggle: discrete (proportion) data gets spike option
    updateToggleButtons(!!config.proportion);
    // Clear stale results
    resultDiv.innerHTML = '<p class="hint">Data loaded. Click a generate button to begin.</p>';
    // ?plot=only: auto-run the full distribution once, so the embedded figure is
    // already drawn with no Generate click. genBtns[3] = +1000 (data-count order).
    if (plotOnly && !plotOnlyRan) {
      plotOnlyRan = true;
      const bigBtn = genBtns[genBtns.length - 1] || genBtns[3];
      // Defer so the chart container has laid out before the first draw.
      requestAnimationFrame(() => bigBtn && bigBtn.click());
    }
    // Samples too large for a readable card grid → fall back to bars (and skip
    // the early strip + toggle), even if ?mechanism=cards was requested. Also
    // remove any stale toggle left over from a previously-loaded small dataset.
    if (!cardsAllowed()) {
      cardMechanism = false;
      mechanismStrip?.querySelector('.mech-view-toggle')?.remove();
    }

    // The mechanism strip opens AS SOON AS THERE IS DATA, with the original
    // sample already in it.
    //
    // It used to wait for the first +1 everywhere except small two-group
    // proportion pages, which had been given this treatment on their own —
    // "so the observed data is visible before any shuffle". That reason was
    // never specific to those pages. A student who loads data met a chart area
    // with nothing in it, and the panel that says what is about to happen
    // appeared only after they had made it happen. (Todd's idea, via Jeff,
    // 2026-10-03: "immediately show the original samples when the data is
    // loaded instead of waiting for a +1".)
    initMechanismStrip();
    // Cards asked for by name (an activity pointing at them) open the strip
    // even if a stale "collapsed" is remembered from another page.
    if (cardsAllowed() && cardMechanism && mechanismStrip) {
      initMechanismCollapse(mechanismStrip, { forceExpanded: true });
    }
    // Unconditional: it also REMOVES a control left over from a dataset whose
    // groups were small enough to deal.
    if (cardModeAvailable) ensureViewToggle();
    // The colour key, on every proportion page and in every view. It names the
    // outcomes in the dataset's words, so it has to follow the data.
    if (config.proportion) updateMechCardLegend();

    // The H₀ sentence under the strip names the study ("survival rate is the
    // same regardless of whether a transplant was received"), so it has to
    // follow the data. It used to be written only from the mechanism-init
    // block, which runs once — and on pages where the strip opens at load
    // (small two-group proportion data, where cards are viable) that block
    // never runs again. So loading heart_transplant and then yawn left the
    // transplant hypothesis sitting over the yawning data, describing a study
    // the numbers had nothing to do with. Datasets with no `nullClaim` fall
    // back to the generic sentence, which is why this must re-run on every
    // load rather than only when a claim exists. (Jeff, 2026-09-25.)
    if (config.mode === 'randomization') renderMechanismNull();

    // Note: data panel collapse and sticky controls are handled by initDataPanel's postLoadUI

    // Show hypothesis display (randomization tests)
    if (config.mode === 'randomization' && (config.twoGroup || config.paired) && hypothesisDisplay) {
      hypothesisDisplay.hidden = false;
      if (config.twoGroup) updateHypothesisDisplay();
    }
    // Show group order (two-sample bootstrap)
    const groupOrderEl = document.getElementById('group-order');
    const groupOrderLabel = document.getElementById('group-order-label');
    if (config.mode === 'bootstrap' && config.twoGroup && groupOrderEl && groupOrderLabel) {
      groupOrderEl.hidden = false;
      groupOrderLabel.textContent = `${group1Name} − ${group2Name}`;
    }
    // Update document.title with dataset context
    const totalN = config.twoGroup || config.paired ? data1.length + data2.length : data1.length;
    setPageTitle(baseTitle, currentSourceName, {
      variable: selectedVarName || undefined,
      n: totalN,
    });

    announce(`Data loaded: n = ${data1.length}`);

    // Render empty chart with sensible axis limits by running a silent pre-simulation
    renderEmptyChart();

    // Scroll chart into view after DOM settles
    setTimeout(() => {
      const target = document.getElementById('chart');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 150);
  }

  /**
   * Run a silent pre-simulation to establish sensible axis limits,
   * then render an empty chart (0 dots, just axes, no observed line).
   */
  function renderEmptyChart() {
    const PRE_SIM_N = 2000;
    const TRIM = 5; // 5/2000 = 0.25th percentile — captures extreme tails
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

    if (config.mode === 'bootstrap') {
      const statFn = getBootstrapStat().fn;
      if (config.paired && data2.length > 0) {
        const diffs = data2.map((v, i) => v - data1[i]);
        for (let i = 0; i < PRE_SIM_N; i++) preStats.push(statFn(resampleOne(diffs, preRng).values));
      } else if (config.twoGroup && data2.length > 0) {
        for (let i = 0; i < PRE_SIM_N; i++) {
          const g = resampleGroups(data1, data2, preRng);
          preStats.push(statFn(g.first.values) - statFn(g.second.values));
        }
      } else {
        for (let i = 0; i < PRE_SIM_N; i++) preStats.push(statFn(resampleOne(data1, preRng).values));
      }
    } else if (config.paired && data2.length > 0) {
      // Paired randomization: sign-flip pre-sim
      const diffs = data2.map((v, i) => v - data1[i]);
      for (let i = 0; i < PRE_SIM_N; i++) {
        const flipped = signFlip(diffs, preRng).values;
        preStats.push(mean(flipped));
      }
    } else if (config.testStat) {
      for (let i = 0; i < PRE_SIM_N; i++) {
        const { first: { values: g1 }, second: { values: g2 } } = shuffleLabels(data1, data2, preRng);
        preStats.push(config.testStat(g1, g2));
      }
    }

    if (preStats.length === 0) return;

    // Sort and trim extremes for a stable domain
    preStats.sort((a, b) => a - b);
    const lo = preStats[TRIM];
    const hi = preStats[preStats.length - 1 - TRIM];
    const pad = (hi - lo) * 0.1 || 0.5;
    preSimDomain = [lo - pad, hi + pad];

    // Lock the dotplot bin grid so dots don't shift as domain grows. For a
    // discrete statistic the grid is not a choice — it is the set of values the
    // statistic can actually take (see discreteGridStep).
    const gridNumBins = userBinCount ?? 40;
    const gridBinWidth = discreteGridStep()
      ?? (preSimDomain[1] - preSimDomain[0]) / gridNumBins;
    lockedDotGrid = { binWidth: gridBinWidth, binOrigin: preSimDomain[0] };

    // Render empty chart (no observed stat line — just axes)
    renderChart([]);
  }

  function updateHypothesisDisplay() {
    if (hGroup1) hGroup1.textContent = group1Name;
    if (hGroup2) hGroup2.textContent = group2Name;
    if (haGroup1) haGroup1.textContent = group1Name;
    if (haGroup2) haGroup2.textContent = group2Name;
  }

  // ─── Proportion helpers ───

  /**
   * Populate the success-outcome dropdown with available outcomes.
   * @param {string[]} outcomes
   */
  function populateSuccessSelector(outcomes) {
    if (!successOutcomeSelect || !successSelector) return;
    outcomeLevels = outcomes.slice();
    successOutcomeSelect.innerHTML = '';
    for (const o of outcomes) {
      const opt = document.createElement('option');
      opt.value = o;
      opt.textContent = o;
      successOutcomeSelect.appendChild(opt);
    }
    // Check URL param ?success= first, then dataset context successLabel
    const urlSuccess = new URLSearchParams(location.search).get('success');
    if (urlSuccess && outcomes.includes(urlSuccess)) {
      successOutcomeSelect.value = urlSuccess;
      successOutcome = urlSuccess;
    } else if (datasetContext.successLabel && outcomes.includes(datasetContext.successLabel)) {
      successOutcomeSelect.value = datasetContext.successLabel;
      successOutcome = datasetContext.successLabel;
    } else {
      successOutcome = outcomes[0];
    }
    successSelector.hidden = false;
  }

  /** Encode raw categorical outcomes as 1 (success) / 0 (not success). */
  function encodeProportionData() {
    data1 = rawOutcomes1.map(o => o === successOutcome ? 1 : 0);
    if (rawOutcomes2.length > 0) {
      data2 = rawOutcomes2.map(o => o === successOutcome ? 1 : 0);
    }
  }

  // Success outcome change → re-encode and reset
  if (successOutcomeSelect) {
    successOutcomeSelect.addEventListener('change', () => {
      successOutcome = successOutcomeSelect.value;
      encodeProportionData();
      if (allStats.length > 0) resetSimulation();
      showDataLoaded();
      announce(`Success outcome changed to "${successOutcome}".`);
    });
  }

  // ─── Data panel (shared initDataPanel) ───

  // Two-group difference-in-means tools (bootstrap-two-means, randomization-diff-means)
  // require a grouping variable with EXACTLY 2 levels and >=3 obs per group (REQ-024).
  // groupLevels/minGroupN are precomputed in data/datasets.json (see data/rebuild-index.js).
  /** @param {any} ds */
  const isTwoGroupMeans = ds => ds.type === 'randomization' && ds.groupLevels === 2 && ds.minGroupN >= 3;

  /** @param {any} ds */
  function simDatasetFilter(ds) {
    if (config.paired) return ds.type === 'paired';
    if (config.mode === 'bootstrap' && config.proportion && !config.twoGroup) return ds.type === 'bootstrap_prop';
    if (config.mode === 'bootstrap' && config.twoGroup && config.proportion) return ds.type === 'randomization_prop';
    if (config.mode === 'bootstrap' && config.twoGroup) return isTwoGroupMeans(ds);
    if (config.mode === 'bootstrap') return ds.hasNumeric === true && ds.hasCategorical !== true && ds.type !== 'regression' && ds.type !== 'paired';
    if (config.proportion) return ds.type === 'randomization_prop';
    if (config.twoGroup) return isTwoGroupMeans(ds);
    return ds.type === 'randomization' || ds.type === 'randomization_prop';
  }

  /**
   * What this page needs from a file it has never seen.
   *
   * Declared, not inferred: the engine used to take the first categorical
   * column and the first numeric column in file order, which on a class survey
   * — `id,sex,exercise_hours,housing,commute_min` — grouped by `sex` and
   * analysed `id`. The picker in js/variable-picker.js resolves the shape,
   * skips row labels, and gives the reader the control to change it.
   */
  const simNeeds = (() => {
    const num = (/** @type {string} */ key, /** @type {string} */ label) =>
      ({ key, label, kind: /** @type {const} */ ('numeric') });
    const cat = (/** @type {string} */ key, /** @type {string} */ label, /** @type {object} */ extra = {}) =>
      ({ key, label, kind: /** @type {const} */ ('categorical'), ...extra });
    if (config.paired) return [num('first', 'First measurement:'), num('second', 'Second measurement:')];
    if (config.proportion && !config.twoGroup) return [cat('outcome', 'Outcome:')];
    if (config.proportion) return [cat('group', 'Grouping variable:', { levels: 2 }), cat('outcome', 'Outcome:')];
    // Two groups of three is what a difference in means needs to exist at all
    // (REQ-024), and it is also what keeps a 1-of-each column out of the list.
    if (config.twoGroup) return [cat('group', 'Grouping variable:', { levels: 2, minPerLevel: 3 }),
                                 num('response', 'Response variable:')];
    return [num('response', 'Variable:')];
  })();

  const dataApi = initDataPanel({
    autoCollapse: true,
    needs: simNeeds,
    stickyControls: true,
    showPreview: true,
    datasetFilter: simDatasetFilter,
    // A flat `?data=` list cannot express two groups or matched pairs, so the
    // comparison pages ignore it instead of loading half a dataset.
    acceptsInlineData: !config.twoGroup && !config.paired,
    onDataset: (/** @type {any} */ ds) => {
      resetSimulation();
      selectedVarName = '';
      datasetContext = ds.context || {};
      currentDatasetJSON = ds;
      currentSourceName = ds.name || ds.id;

      if (config.paired) {
        const numVars = ds.variables.filter(/** @param {any} v */ v => v.type === 'numeric');
        if (numVars.length < 2) return;
        group1Name = numVars[0].name;
        group2Name = numVars[1].name;
        data1 = ds.rows.map(/** @param {any} r */ r => r[numVars[0].name]).filter(/** @param {any} v */ v => isFinite(v));
        data2 = ds.rows.map(/** @param {any} r */ r => r[numVars[1].name]).filter(/** @param {any} v */ v => isFinite(v));
        const minLen = Math.min(data1.length, data2.length);
        data1 = data1.slice(0, minLen);
        data2 = data2.slice(0, minLen);
      } else if (config.mode === 'bootstrap' && config.proportion && !config.twoGroup) {
        const catVar = ds.variables.find(/** @param {any} v */ v => v.type === 'categorical');
        if (!catVar) return;
        rawOutcomes1 = ds.rows.map(/** @param {any} r */ r => r[catVar.name]);
        rawOutcomes2 = [];
        populateSuccessSelector([...new Set(rawOutcomes1)]);
        encodeProportionData();
      } else if (config.mode === 'bootstrap' && !config.twoGroup) {
        const numVar = ds.variables.find(/** @param {any} v */ v => v.type === 'numeric');
        if (!numVar) return;
        data1 = ds.rows.map(/** @param {any} r */ r => r[numVar.name]).filter(/** @param {any} v */ v => isFinite(v));
        data2 = [];
      } else if (config.proportion) {
        const catVars = ds.variables.filter(/** @param {any} v */ v => v.type === 'categorical');
        if (catVars.length < 2) return;
        const groupVar = catVars[0];
        const outcomeVar = catVars[1];
        const groups = [...new Set(ds.rows.map(/** @param {any} r */ r => r[groupVar.name]))];
        if (groups.length < 2) return;
        const outcomes = [...new Set(ds.rows.map(/** @param {any} r */ r => r[outcomeVar.name]))];
        group1Name = groups[0];
        group2Name = groups[1];
        rawOutcomes1 = ds.rows
          .filter(/** @param {any} r */ r => r[groupVar.name] === groups[0])
          .map(/** @param {any} r */ r => r[outcomeVar.name]);
        rawOutcomes2 = ds.rows
          .filter(/** @param {any} r */ r => r[groupVar.name] === groups[1])
          .map(/** @param {any} r */ r => r[outcomeVar.name]);
        populateSuccessSelector(outcomes);
        encodeProportionData();
      } else {
        const catVar = ds.variables.find(/** @param {any} v */ v => v.type === 'categorical');
        const numVar = ds.variables.find(/** @param {any} v */ v => v.type === 'numeric');
        if (!catVar || !numVar) return;
        const groups = [...new Set(ds.rows.map(/** @param {any} r */ r => r[catVar.name]))];
        if (groups.length < 2) return;
        group1Name = groups[0];
        group2Name = groups[1];
        data1 = ds.rows
          .filter(/** @param {any} r */ r => r[catVar.name] === groups[0])
          .map(/** @param {any} r */ r => r[numVar.name])
          .filter(/** @param {any} v */ v => isFinite(v));
        data2 = ds.rows
          .filter(/** @param {any} r */ r => r[catVar.name] === groups[1])
          .map(/** @param {any} r */ r => r[numVar.name])
          .filter(/** @param {any} v */ v => isFinite(v));
      }

      showDataLoaded();
      announce(`${ds.name}.`);
    },
    onText: (/** @type {any} */ parsed, /** @type {string} */ sourceName,
             /** @type {Record<string,string>} */ pick, /** @type {string} */ raw) => {
      currentSourceName = sourceName || 'data';
      loadParsedData(parsed, pick || {}, raw || '');
    },
    onClear: () => {
      data1 = [];
      data2 = [];
      resampleViewExplicit = false;
      resetSimulation();
      if (dataPreview) dataPreview.hidden = true;
      if (dataSummary) dataSummary.textContent = '\u2014';
      for (const btn of genBtns) btn.disabled = true;
      if (mechanismStrip) mechanismStrip.hidden = true;
      if (successSelector) successSelector.hidden = true;
      if (hypothesisDisplay) hypothesisDisplay.hidden = true;
      const groupOrderEl = document.getElementById('group-order');
      if (groupOrderEl) groupOrderEl.hidden = true;
      announce('Data cleared.');
    },
  });

  /** Map alternative hypothesis selection to tail direction. */
  function getDirection() {
    const alt = altDirectionBtn?.dataset.value ?? 'greater';
    if (alt === 'greater') return /** @type {const} */ ('right');
    if (alt === 'less') return /** @type {const} */ ('left');
    return /** @type {const} */ ('both');
  }

  // Swap groups button
  if (swapGroupsBtn) {
    swapGroupsBtn.addEventListener('click', () => {
      [data1, data2] = [data2, data1];
      [group1Name, group2Name] = [group2Name, group1Name];
      [rawOutcomes1, rawOutcomes2] = [rawOutcomes2, rawOutcomes1];
      if (allStats.length > 0) resetSimulation();
      showDataLoaded();
      announce(`Swapped groups: ${group1Name} − ${group2Name}`);
    });
  }

  // Alt hypothesis change → cycle button and re-render
  if (altDirectionBtn) {
    const vals = (altDirectionBtn.dataset.values || '').split(',');
    const labels = (altDirectionBtn.dataset.labels || '').split(',');
    altDirectionBtn.addEventListener('click', () => {
      const cur = vals.indexOf(altDirectionBtn.dataset.value || 'greater');
      const next = (cur + 1) % vals.length;
      altDirectionBtn.dataset.value = vals[next];
      altDirectionBtn.textContent = labels[next];
      if (allStats.length > 0) {
        const nullDiff = getNullValue();
        const rawObserved = config.paired
          ? mean(data2.map((v, i) => v - data1[i]))
          : config.testStat(data1, data2);
        const observedStat = rawObserved - nullDiff;
        const direction = getDirection();
        renderChart(allStats, null, observedStat, direction);
        const { pValue, extremeCount } = permutationPValue(allStats, observedStat, direction);
        displayRandomizationResults(allStats, observedStat, pValue, extremeCount, direction);
      }
    });
  }

  // Apply ?direction= from URL (from cross-links)
  if (urlParams.direction && altDirectionBtn) {
    const vals = (altDirectionBtn.dataset.values || '').split(',');
    const labels = (altDirectionBtn.dataset.labels || '').split(',');
    const dirMap = { 'less': 'less', 'greater': 'greater', 'two-sided': 'twosided', 'twosided': 'twosided' };
    const mapped = dirMap[urlParams.direction] || urlParams.direction;
    const idx = vals.indexOf(mapped);
    if (idx >= 0) {
      altDirectionBtn.dataset.value = vals[idx];
      altDirectionBtn.textContent = labels[idx];
    }
  }

  // ─── Generate bar ───

  for (const btn of genBtns) {
    btn.addEventListener('click', () => {
      const count = parseInt(btn.dataset.count, 10);
      if (data1.length === 0) {
        announce('Please load data first.');
        return;
      }
      generateSamples(count);
    });
  }

  /**
   * Generate N samples/permutations and add to the accumulation.
   * @param {number} count
   */
  /** @type {ReturnType<typeof setTimeout>|null} */
  let pendingChartTimer = null;
  /**
   * The two group means meet on the difference, then it flies to the chart.
   *
   * The number being plotted is not something either group has — it is what you
   * get by taking one from the other — and the drop used to start at the
   * difference as if it had simply appeared there. (Jeff, 2026-10-03.)
   *
   * Returns immediately with no combine step when there are no mean markers to
   * leave from: proportions draw blocks rather than dotplots, and a large-n
   * mean draws a histogram.
   *
   * @param {Element|null} dropSource - the difference readout
   */
  function combineThenDrop(dropSource) {
    if (!dropSource || !chartContainer) return;
    // A dotplot marks its mean with an overlay line; a mini histogram marks it
    // with `.mc-mean`. Past the dotplot cap the panel is histograms, and
    // looking only for the first would have left the bigger samples with no
    // combine at all. (2026-10-03.)
    const marker = (/** @type {number} */ i) =>
      document.getElementById(`mech-dot-resamp-${i}`)?.querySelector('.overlays line')
      ?? document.getElementById(`mech-hist-resamp-${i}`)?.querySelector('.mc-mean')
      ?? null;
    const ms = animateCombineStats({
      sources: [marker(1), marker(2)],
      target: dropSource,
    });
    if (!ms) {
      animateDropToChart(/** @type {HTMLElement} */ (dropSource), chartContainer);
      return;
    }
    setTimeout(() => animateDropToChart(
      /** @type {HTMLElement} */ (dropSource), /** @type {HTMLElement} */ (chartContainer)), ms);
  }

  /**
   * Show the mechanism strip, with the ORIGINAL sample already in it.
   *
   * This used to wait for the first +1 — so a student who loaded data met a
   * page with a chart area and nothing in it, and the panel that says what is
   * about to happen appeared only after they had made it happen. Todd's point,
   * by way of Jeff (2026-10-03): show the original sample as soon as there is
   * one. The draw panel keeps its placeholder until there is a draw, because
   * seeding it with the original looked like a completed one.
   *
   * Idempotent: called on load and again on the first generate, so a page that
   * somehow reaches +1 without a load still initialises.
   */
  function initMechanismStrip() {
    if (mechanismInitialized || !mechanismStrip) return;
    mechanismInitialized = true;
    // Every one-sample mechanism: the mean, the proportion, and both paired
    // pages. This briefly read `usesMeanMech()`, which excludes proportions —
    // so bootstrap-prop stopped entering the branch that unhides the strip
    // and nothing rendered at all. (2026-10-02.)
    if ((config.mode === 'bootstrap' || config.paired) && !config.twoGroup && originalContentEl) {
      // Both paired pages come through here. The note that used to send them
      // down a branch of their own said flipping the view "gains no
      // animation, and wiring paired onto the mean mechanism is the real
      // fix" — that is done, so the reason is gone.
      //
      // The randomization one takes the DISPLAY and not the draw: its draw is
      // a SIGN FLIP, where nothing is taken twice and nothing is missed, so
      // burst's vocabulary would be saying something false about it. Same
      // split as randomization-diff-means. (2026-09-28 → 2026-10-02.)
      mechanismStrip.hidden = false;
      initMechanismCollapse(mechanismStrip);
      if (useNewPropMech) ensurePropStyleToggle();
      renderOriginalSample();
      // Say what the empty panel is waiting for. The two-group pages have done
      // this since they opened at load; the one-sample ones opened at load for
      // the first time on 2026-10-03 and inherited a blank box beside a full
      // one, which reads as broken rather than as pending.
      if (resampleContentEl && !resampleContentEl.textContent.trim()) {
        resampleContentEl.innerHTML = resamplePanelPlaceholderHTML();
      }
      // The non-tiles view is the default for numeric data.
      //
      // It used to be tiles below 30 observations and a histogram above, which
      // meant a 16-value sample — the size where you can actually watch a
      // resample happen — showed two rows of numbered tiles and never the
      // dotplot. Tiles say WHICH values were drawn and how often; the dotplot
      // says what the resample looks like and hands its mean to the
      // distribution. The second is the thing being taught, so it leads, and
      // Tiles stays one click away. (Jeff, 2026-09-27.)
      //
      // Above MEAN_DOT_MAX this same mode is a histogram, which is why the
      // condition is about the data being numeric rather than about its size.
      // Proportions use proportion bars in both views, so they are left alone.
      if (!resampleViewExplicit && !config.proportion) {
        setResampleViewMode('histogram');
      }
    } else if (config.twoGroup) {
      mechanismStrip.hidden = false;
      initMechanismCollapse(mechanismStrip);
      if (twoPropBlockPage) ensurePropStyleToggle();
      renderTwoGroupOriginal();
      // Blank until the first shuffle (was seeded with the original grouping,
      // which looked like a completed shuffle).
      if (mechResampleContent) {
        mechResampleContent.innerHTML = resamplePanelPlaceholderHTML();
      }
    }
    // Randomization: explain *why* we shuffle, right by the mechanism.
    if (config.mode === 'randomization') renderMechanismNull();
  }

  function generateSamples(count) {
  // No more than MAX_SIMULATIONS in total: past it the Monte-Carlo margin is
  // smaller than any digit a conclusion turns on, and a held Play button would
  // otherwise run to a million.
  {
    const cap = capBatch(allStats.length, count);
    if (cap.allowed <= 0) { applySimulationCap(genBtns, allStats.length, 'simulations'); return; }
    count = cap.allowed;
    // …and the controls go dead as the last batch lands.
    if (cap.atCap) queueMicrotask(() => applySimulationCap(genBtns, allStats.length, 'simulations'));
  }
    // A clean slate. Press +1 before the last draw has finished and two runs
    // shared the screen — the old flyers still travelling, the old dots still
    // hidden waiting for a finish that would arrive after the new ones landed.
    // (Jeff, 2026-10-03.)
    cancelDrawAnimations();
    // Detect auto-play: skip flying chip animation when play button is active
    const playBtn = document.querySelector('.play-btn');
    const isAutoPlay = playBtn?.getAttribute('aria-pressed') === 'true';
    if (pendingChartTimer !== null) {
      clearTimeout(pendingChartTimer);
      pendingChartTimer = null;
    }
    if (!rng) rng = createRng(seed);

    initMechanismStrip();

    // Capture previous state for histogram delta highlight
    const prevLength = allStats.length;

    // Update resample panel title
    if (resampleTitleEl) {
      // Verb is author-overridable per dataset (context.mechanismVerb) so activity
      // text can say "re-allocate" (experiment) / "re-sample" (sample) without
      // contradicting the panel title (REQ-031).
      const verb = config.mode === 'randomization'
        ? (datasetContext.mechanismVerb || 'Shuffle')
        : 'Resample';
      // The bootstrap panel names the mechanism rather than pointing at the
      // panel: "This Resample" told you which one you were looking at, which
      // the STEP 2 tag beside it already does, and left the caption underneath
      // to explain what a resample is. (Jeff, 2026-10-02.)
      const title = config.mode === 'bootstrap'
        ? 'Resample with Replacement'
        : (count === 1 ? `This ${verb}` : `Last ${verb}`);
      resampleTitleEl.textContent = title;
      // The tier layouts copy this heading into their own at init, before the
      // first draw has set it — so Step 2 kept whatever the HTML shipped with
      // ("This Resample") while the strip said something else. The copy is
      // kept in step instead of being a snapshot. (2026-10-02.)
      const tierHead = document.querySelector('.mech-tier--draw .mech-tier-head');
      if (tierHead) {
        const tag = tierHead.querySelector('.mech-tier-tag');
        tierHead.textContent = '';
        if (tag) tierHead.appendChild(tag);
        tierHead.appendChild(document.createTextNode(title));
      }
    }

    if (config.mode === 'bootstrap') {
      const statFn = getBootstrapStat().fn;
      /** @type {number[]} */
      let lastResampleValues = [];

      if (config.paired && data2.length > 0) {
        // Paired bootstrap: resample the differences.
        // Drawn by INDEX so the mechanism panel can say which observations were
        // taken. Identical PRNG consumption to resample(), so seeded links are
        // unaffected — see sampleIndicesWithReplacement.
        const diffs = data2.map((v, i) => v - data1[i]);
        for (let i = 0; i < count; i++) {
          const { values: rs, indices: idx } = resamplePairedDiffs(data1, data2, rng);
          lastResampleValues = rs;
          lastResampleIndices = idx ?? null;
          allStats.push(statFn(rs));
        }
      } else if (config.twoGroup && data2.length > 0) {
        // Two-sample bootstrap: resample each group independently
        /** @type {number[]} */ let lastRs1 = [];
        /** @type {number[]} */ let lastRs2 = [];
        for (let i = 0; i < count; i++) {
          const { first, second } = resampleGroups(data1, data2, rng);
          const rs1 = first.values;
          const rs2 = second.values;
          lastRs1 = rs1;
          lastRs2 = rs2;
          // Each group is its own draw with replacement, so each panel gets its
          // own indices — without them the two-group animation flew dots with
          // no marks on either side. (2026-09-28.)
          lastRsIdx1 = first.indices ?? null;
          lastRsIdx2 = second.indices ?? null;
          const stat = statFn(rs1) - statFn(rs2);
          allStats.push(stat);
        }
        twoGroupMorphMs = showTwoGroupMechanism(lastRs1, lastRs2, false, count === 1);
      } else {
        // One-sample bootstrap — by index, for the same reason.
        for (let i = 0; i < count; i++) {
          const { values: rs, indices: idx } = resampleOne(data1, rng);
          lastResampleValues = rs;
          lastResampleIndices = idx ?? null;
          allStats.push(statFn(rs));
        }
      }

      const ciLevel = getCiLevel();
      let ci = null;
      const CI_MIN = 20; // Don't show CI until this many resamples
      if (allStats.length >= CI_MIN) {
        const result = bootstrapCI([...allStats], ciLevel);
        ci = result.ci;
        displayBootstrapResults(allStats, result.ci, result.se, ciLevel);
      } else {
        resultDiv.innerHTML = `<p><strong>Bootstrap Distribution</strong> (${allStats.length} resamples)</p>
          <p>Need at least ${CI_MIN} resamples for CI estimate.</p>`;
      }
      // Track new data for highlight — always compute dot-level highlights
      if (count === 1) {
        lastStatIndex = allStats.length - 1;
        // For histogram +1: pass the new value directly (no bin alignment issues)
        lastHighlightValue = allStats[allStats.length - 1];
      } else {
        lastHighlightValue = null;
        batchHighlightIndices = new Set();
        for (let j = prevLength; j < allStats.length; j++) {
          batchHighlightIndices.add(j);
        }
      }
      // Batch histogram delta: compute previous bin counts for stacked overlay
      if (count > 1 && allStats.length > DOTPLOT_AUTO_THRESHOLD && prevLength > 0) {
        const domainVals = allStats;
        let [lo, hi] = extent(domainVals);
        const dPad = (hi - lo) * 0.05 || 0.5;
        lo -= dPad; hi += dPad;
        if (preSimDomain) {
          lo = Math.min(lo, preSimDomain[0]);
          hi = Math.max(hi, preSimDomain[1]);
        }
        /** @type {[number,number]} */
        const fullDomain = [lo, hi];
        const histThresholds = config.proportion
          ? snappedPropThresholds(0, fullDomain, allStats.length,
              { step: discreteGridStep(), anchor: lastObserved })
          : undefined;
        const { bins: fullBins } = computeBins(allStats, {
          domain: fullDomain, thresholds: histThresholds,
          numBins: config.proportion ? undefined : userBinCount,
        });
        const lockedThresholds = fullBins.slice(1).map(b => b.x0);
        const prevStats = allStats.slice(0, prevLength);
        const { bins: prevBins } = computeBins(prevStats, {
          domain: fullDomain, thresholds: lockedThresholds,
        });
        prevBinCounts = prevBins.map(b => b.length);
      }
      // Only show CI lines once we have enough resamples for stability
      const ciForChart = allStats.length >= CI_MIN ? ci : null;

      // Determine if this page uses one-sample mechanism strip
      const showOneSampleMech = !config.twoGroup || config.paired;

      if (count === 1) {
        lastWasSingle = true;
        let mechAnimMs = 0;
        if (showOneSampleMech) {
          lastResample = lastResampleValues;
          mechAnimMs = showResample(lastResampleValues, false, true, !isAutoPlay);
        } else if (config.twoGroup && !config.paired) {
          // Two-group boxplot morph duration (returned from showTwoGroupMechanism above)
          mechAnimMs = twoGroupMorphMs;
        }


        // For two-group, get the diff value element for drop animation
        const bootDiffEl = !showOneSampleMech
          ? document.querySelector('#mech-resample-content .mech-diff')
          : null;
        const bootDiffValueEl = bootDiffEl?.querySelector('.mech-stat-value') ?? null;
        // Wait for mechanism animation to finish, then render chart + drop
        const chartDelay = Math.max(150, mechAnimMs);
        pendingChartTimer = setTimeout(() => {
          pendingChartTimer = null;
          renderChart(allStats, ciForChart, computeObservedStat());
          const dropSource = bootDiffValueEl || bootDiffEl || resampleMeanEl;
          combineThenDrop(dropSource);
        }, chartDelay);
      } else {
        lastWasSingle = false;
        renderChart(allStats, ciForChart, computeObservedStat());
        if (showOneSampleMech) {
          lastResample = lastResampleValues;
          showResample(lastResampleValues, false, false);
        }
      }

      announce(`Generated ${count} resample${count > 1 ? 's' : ''}. Total: ${allStats.length}`);
      // Something has been generated, so the link is worthless without the seed.
      markGenerated();
    } else if (config.paired) {
      // ─── Paired randomization: sign-flip test ───
      const diffs = data2.map((v, i) => v - data1[i]);
      const nullDiff = getNullValue();
      // Center diffs around 0 under H₀: μ_d = δ₀
      const centeredDiffs = nullDiff === 0 ? diffs : diffs.map(d => d - nullDiff);
      const observedStat = mean(centeredDiffs);
      const direction = getDirection();

      /** @type {number[]} */ let lastFlipped = [];
      for (let i = 0; i < count; i++) {
        const flipped = signFlip(centeredDiffs, rng).values;
        lastFlipped = flipped;
        allStats.push(mean(flipped));
      }

      // Show paired sign-flip mechanism
      lastResample = lastFlipped;
      lastPairedOriginal = centeredDiffs;
      showPairedMechanism(centeredDiffs, lastFlipped, count === 1);

      // Highlights
      if (count === 1) {
        lastStatIndex = allStats.length - 1;
        lastHighlightValue = allStats[allStats.length - 1];
      } else {
        lastHighlightValue = null;
        batchHighlightIndices = new Set();
        for (let j = prevLength; j < allStats.length; j++) {
          batchHighlightIndices.add(j);
        }
      }
      // Histogram delta for batch
      if (count > 1 && allStats.length > DOTPLOT_AUTO_THRESHOLD && prevLength > 0) {
        let [rLo, rHi] = extent(allStats, observedStat);
        const rPad = (rHi - rLo) * 0.05 || 0.5;
        rLo -= rPad; rHi += rPad;
        if (preSimDomain) {
          rLo = Math.min(rLo, preSimDomain[0]);
          rHi = Math.max(rHi, preSimDomain[1]);
        }
        /** @type {[number,number]} */
        const rDomain = [rLo, rHi];
        const { bins: fullBins } = computeBins(allStats, { domain: rDomain, numBins: userBinCount });
        const lockedThresholds = fullBins.slice(1).map(b => b.x0);
        const prevStats = allStats.slice(0, prevLength);
        const { bins: prevBins } = computeBins(prevStats, { domain: rDomain, thresholds: lockedThresholds });
        prevBinCounts = prevBins.map(b => b.length);
      }

      const { pValue, extremeCount } = permutationPValue(allStats, observedStat, direction);
      displayRandomizationResults(allStats, observedStat, pValue, extremeCount, direction);

      if (count === 1) {
        lastWasSingle = true;
        pendingChartTimer = setTimeout(() => {
          pendingChartTimer = null;
          renderChart(allStats, null, observedStat, direction);
          if (resampleMeanEl && chartContainer) {
            animateDropToChart(resampleMeanEl, chartContainer);
          }
        }, 150);
      } else {
        lastWasSingle = false;
        renderChart(allStats, null, observedStat, direction);
      }
      announce(`Generated ${count} shuffle${count > 1 ? 's' : ''}. Total: ${allStats.length}`);
      // Something has been generated, so the link is worthless without the seed.
      markGenerated();
    } else {
      const nullDiff = getNullValue();
      const observedStat = config.testStat(data1, data2) - nullDiff;
      const direction = getDirection();

      /** @type {number[]} */ let lastG1 = [];
      /** @type {number[]} */ let lastG2 = [];
      for (let i = 0; i < count; i++) {
        const { first, second } = shuffleLabels(data1, data2, rng);
        const g1 = first.values, g2 = second.values;
        // Which pooled observation landed in which group — what the deal
        // animation flies, and what says how many crossed over.
        lastRsIdx1 = first.indices ?? null;
        lastRsIdx2 = second.indices ?? null;
        lastG1 = g1;
        lastG2 = g2;
        const stat = config.testStat(g1, g2);
        allStats.push(stat);
      }

      twoGroupMorphMs = showTwoGroupMechanism(lastG1, lastG2, false, count === 1);
      // Always compute dot-level highlights
      if (count === 1) {
        lastStatIndex = allStats.length - 1;
        lastHighlightValue = allStats[allStats.length - 1];
      } else {
        lastHighlightValue = null;
        batchHighlightIndices = new Set();
        for (let j = prevLength; j < allStats.length; j++) {
          batchHighlightIndices.add(j);
        }
      }
      if (count > 1 && allStats.length > DOTPLOT_AUTO_THRESHOLD && prevLength > 0) {
        // Histogram mode: compute previous bin counts for stacked delta
        // Loop, not spread — see `extent`. This is the one that actually
        // fired: at 125k resamples the batch handler threw and the chart
        // stopped redrawing while the counter kept climbing.
        let [rLo, rHi] = extent(allStats, observedStat ?? NaN);
        const rPad = (rHi - rLo) * 0.05 || 0.5;
        rLo -= rPad; rHi += rPad;
        if (preSimDomain) {
          rLo = Math.min(rLo, preSimDomain[0]);
          rHi = Math.max(rHi, preSimDomain[1]);
        }
        /** @type {[number,number]} */
        const rDomain = [rLo, rHi];
        const rThresholds = config.proportion
          ? snappedPropThresholds(0, rDomain, allStats.length,
              { step: discreteGridStep(), anchor: lastObserved })
          : undefined;
        // Bin the FULL dataset first to lock in bin edges
        // Pass same numBins as renderChart to ensure identical bin edges
        const { bins: fullBins } = computeBins(allStats, {
          domain: rDomain, thresholds: rThresholds,
          numBins: config.proportion ? undefined : userBinCount,
        });
        const lockedThresholds = fullBins.slice(1).map(b => b.x0);
        const prevStats = allStats.slice(0, prevLength);
        const { bins: prevBins } = computeBins(prevStats, {
          domain: rDomain, thresholds: lockedThresholds,
        });
        prevBinCounts = prevBins.map(b => b.length);
      }
      const { pValue, extremeCount } = permutationPValue(allStats, observedStat, direction);
      displayRandomizationResults(allStats, observedStat, pValue, extremeCount, direction);

      if (count === 1) {
        // The diff value gets highlight-last via showTwoGroupMechanism(…, highlight=true)
        const mechDiffEl = document.querySelector('#mech-resample-content .mech-diff');
        // Wait for boxplot morph to finish, then render chart + drop
        const randDelay = Math.max(150, twoGroupMorphMs);
        pendingChartTimer = setTimeout(() => {
          pendingChartTimer = null;
          renderChart(allStats, null, observedStat, direction);
          const dropSourceEl = mechDiffEl || resampleMeanEl;
          combineThenDrop(dropSourceEl);
        }, randDelay);
      } else {
        renderChart(allStats, null, observedStat, direction);
      }
      announce(`Generated ${count} shuffle${count > 1 ? 's' : ''}. Total: ${allStats.length}`);
      // Something has been generated, so the link is worthless without the seed.
      markGenerated();
    }

    if (resetBtn) resetBtn.hidden = false;
  }

  // ─── Resample visualization ───

  /**
   * Set a panel heading's words without evicting what lives in it.
   *
   * The paired page's heading is `#orig-diff-title`, which is also the element
   * the View toggle is appended to — so `textContent = …` silently took the
   * control with it, and paired had the mechanism but no way to switch it.
   * (2026-10-02.)
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

  function renderOriginalSample() {
    if (!originalContentEl) return;
    // Whether an Individual | Aggregate choice exists depends on n, so the
    // toggle is re-decided whenever the source panel is drawn. Switching
    // datasets hides the strip and defers the redraw to the first generate,
    // which is also exactly when the stale toggle would become visible again.
    ensurePropStyleToggle();
    syncRenderingToggle();
    placeStatRows();
    originalContentEl.innerHTML = '';

    if (config.paired && data2.length > 0 && !meanDotActive()) {
      // Paired data: show the differences (sorted for easier visual tracking).
      // Only when the dotplot is not what is wanted — the differences ARE a
      // one-sample bootstrap, so they go through the mean mechanism below
      // whenever it applies, and these tiles are the Tiles rendering and the
      // large-n fallback rather than the only thing paired can show.
      const diffs = data2.map((v, i) => v - data1[i]);
      const sortedDiffs = [...diffs].sort((a, b) => a - b);
      const container = document.createElement('div');
      container.className = 'sample-dots';
      container.setAttribute('role', 'img');
      container.setAttribute('aria-label', `Paired differences (${group2Name} − ${group1Name})`);

      // Tiles are an INDIVIDUAL display, here as everywhere: asking for
      // Aggregate left Step 1 on tiles beside a Step 2 histogram, the same
      // mismatch the one-sample page had. (2026-10-02.)
      if (diffs.length <= CHIP_THRESHOLD && meanRole === 'individual') {
        for (const d of sortedDiffs) {
          const dot = document.createElement('span');
          dot.className = 'sample-dot';
          dot.textContent = formatChipValue(d);
          dot.title = String(d);
          container.appendChild(dot);
        }
      } else {
        container.className = 'mini-chart';
        drawHistogram(container, diffs, {
          id: 'orig-hist',
          xLabel: '',
          titleText: `Differences (${group2Name} − ${group1Name})`,
          numBins: Math.min(Math.ceil(Math.sqrt(diffs.length)), 40),
          animate: false,
          margin: { top: 5, right: 12, bottom: 44, left: 48 },
          // A 614x371 viewBox inside a box capped at 140px tall was letterboxed
          // to 232px of drawing in a 491px panel — half the width thrown away,
          // and the ticks rendered at 4px. A shorter view fills the panel
          // instead, which is also what makes the labels legible: they scale
          // with the drawing. (Jeff, 2026-10-02.)
          viewHeight: MINI_VIEW_H,
          showExport: false,
        });
      }
      originalContentEl.appendChild(container);

      if (origNEl) origNEl.textContent = `${diffs.length} pairs`;
      if (origMeanEl) origMeanEl.textContent = formatStat(mean(diffs), dataPrecision);
      // Update title to show difference direction
      setPanelHeading(document.getElementById('orig-diff-title'),
        `Differences (${group2Name} \u2212 ${group1Name})`);
      return;
    }

    if (config.proportion && !config.twoGroup) {
      // One-sample proportion: the original sample is a fixed "bag" of n
      // observations (B2). Render as a marble grid or a proportion bar (?mechstyle=).
      const successes = data1.filter(v => v === 1).length;
      const failures = data1.length - successes;
      const pHat = mean(data1);
      origPropCache = { successes, failures, pHat };
      renderPropBag(originalContentEl, data1, {
        style: propMechStyle,
        label: `Original sample: ${successes} successes, ${failures} failures, p-hat = ${formatStat(pHat, dataPrecision, 'proportion')}`,
      });
    } else if (meanDotActive()) {
      // Original sample as a dotplot bag, via the shared mean mechanism.
      meanDomain = computeMeanDomain();
      meanMech.setView('dotplot');
      meanMech.resetSizing();
      // The values this page resamples — the sample itself, or the paired
      // differences.
      const vals = resampleSourceValues();
      meanMech.renderBag(originalContentEl, vals, mean(vals), {
        domain: meanDomain ?? undefined, meanLabel: config.paired ? 'd̄' : 'x̄',
        ...tierDotGeometry() });
      if (config.paired) {
        if (origNEl) origNEl.textContent = `${vals.length} pairs`;
        if (origMeanEl) origMeanEl.textContent = formatStat(mean(vals), dataPrecision);
        setPanelHeading(document.getElementById('orig-diff-title'),
          `Differences (${group2Name} \u2212 ${group1Name})`);
      }
    } else if (data1.length <= CHIP_THRESHOLD && meanRole === 'individual') {
      // Value tiles are an INDIVIDUAL display — one mark per observation — so
      // they belong to that role and not to "n happens to be small". Asking for
      // Aggregate used to leave Step 1 showing tiles beside a Step 2 histogram,
      // two different pictures of the same switch; and the histogram draw
      // animation needs a histogram to leave FROM, so it never ran at this
      // size either. (Jeff, 2026-10-02.)
      const container = document.createElement('div');
      container.className = 'sample-dots';
      container.setAttribute('role', 'img');
      container.setAttribute('aria-label', 'Original sample values');
      const sorted = [...data1].sort((a, b) => a - b);
      for (const v of sorted) {
        const dot = document.createElement('span');
        dot.className = 'sample-dot';
        dot.textContent = formatChipValue(v);
        dot.title = String(v);
        container.appendChild(dot);
      }
      originalContentEl.appendChild(container);
    } else {
      // Large dataset: show mini histogram + cache bins for morph animation
      const nBins = Math.min(Math.ceil(Math.sqrt(data1.length)), 40);
      const binResult = computeBins(data1, { numBins: nBins });
      // Extract explicit thresholds from computed bin edges
      const thresholds = binResult.bins.slice(1).map(b => b.x0);
      origHistCache = { bins: binResult.bins, thresholds, numBins: nBins };

      const container = document.createElement('div');
      container.className = 'mini-chart';
      drawHistogram(container, data1, {
        id: 'orig-hist',
        xLabel: '',
        titleText: 'Original sample distribution',
        numBins: nBins,
        animate: false,
        margin: { top: 5, right: 12, bottom: 44, left: 48 },
          // A 614x371 viewBox inside a box capped at 140px tall was letterboxed
          // to 232px of drawing in a 491px panel — half the width thrown away,
          // and the ticks rendered at 4px. A shorter view fills the panel
          // instead, which is also what makes the labels legible: they scale
          // with the drawing. (Jeff, 2026-10-02.)
          viewHeight: MINI_VIEW_H,
        showExport: false,
      });
      originalContentEl.appendChild(container);
    }

    if (origNEl) origNEl.textContent = String(data1.length);
    if (origMeanEl) {
      if (config.proportion && !config.twoGroup) {
        // …and the same arithmetic here, or the resample would be the only one
        // showing its working and the two lines would stop rhyming.
        const s = data1.filter(v => v === 1).length;
        origMeanEl.textContent = `${s}/${data1.length} = `
          + formatStat(mean(data1), dataPrecision, 'proportion');
      } else if (config.proportion) {
        origMeanEl.textContent = formatStat(mean(data1), dataPrecision, 'proportion');
      } else {
        origMeanEl.textContent = formatStat(mean(data1), dataPrecision);
      }
    }
  }

  // ─── Two-group mechanism strip ───

  /**
   * Build HTML for a two-group panel (shared by original and resample).
   * @param {number[]} g1 - Group 1 values
   * @param {number[]} g2 - Group 2 values
   * @param {boolean} [highlightDiff] - Highlight diff in orange
   * @returns {string} HTML string
   */
  /** Shared x-domain for two-group mini charts (set from original data). */
  let twoGroupChartDomain = /** @type {[number,number]|null} */ (null);
  /** Shared bin count for two-group mini histograms. */
  let twoGroupNumBins = 10;

  /**
   * Build HTML for a two-group panel (shared by original and resample).
   * For non-proportion data, includes mini boxplots. For proportions, shows prop bars.
   * @param {number[]} g1 - Group 1 values
   * @param {number[]} g2 - Group 2 values
   * @param {boolean} [highlightDiff] - Highlight diff value in orange
   * @param {boolean} [isOriginal] - True if rendering the original (left) panel
   * @returns {string} HTML string (boxplot containers are populated after innerHTML set)
   */
  function buildTwoGroupHTML(g1, g2, highlightDiff = false, isOriginal = false) {
    const statFn = config.mode === 'bootstrap' ? getBootstrapStat().fn : mean;
    const statSymbol = config.proportion ? 'p̂' : '<span class="x-bar">x</span>';
    const s1 = statFn(g1);
    const s2 = statFn(g2);
    const fmtType = config.proportion ? 'proportion' : undefined;
    const diffVal = formatStat(s1 - s2, dataPrecision, fmtType);

    let html = '';

    if (config.proportion && cardMechanism) {
      // Card mode: each observation is a card, grouped into two grids
      html += `<div class="mech-card-display${cardColorSwapped ? ' is-swapped' : ''}">`
        + `${cardGroupsHTML(g1, g2, cardOpts())}</div>`;
    } else if (config.proportion) {
      // Proportion groups: show S/F chip bars + stats
      const succ1 = g1.filter(v => v === 1).length;
      const fail1 = g1.length - succ1;
      const succ2 = g2.filter(v => v === 1).length;
      const fail2 = g2.length - succ2;
      const pct1 = g1.length > 0 ? (succ1 / g1.length * 100) : 0;
      const pct2 = g2.length > 0 ? (succ2 / g2.length * 100) : 0;

      html += `
        <div class="mech-group-row"><span class="mech-group-name">${group1Name}:</span>
          <span class="mech-group-stat">n = ${g1.length}, ${statSymbol} = ${formatStat(s1, dataPrecision, fmtType)}</span></div>
        ${propBarHTML(succ1, fail1)}
        <div class="mech-group-row"><span class="mech-group-name">${group2Name}:</span>
          <span class="mech-group-stat">n = ${g2.length}, ${statSymbol} = ${formatStat(s2, dataPrecision, fmtType)}</span></div>
        ${propBarHTML(succ2, fail2)}`;
    } else if (twoMeanDotActive()) {
      // B3: the two groups STACKED on one scale, not side by side.
      //
      // They always shared a domain — `computeTwoMeanDomain` pools both groups
      // — but sat in separate halves of the panel, so a value of 7.0 was at one
      // screen position in the left plot and a different one in the right.
      // Comparing two independently-placed dotplots means carrying a position
      // across a gap by eye, which is the hard version of the only question the
      // panel is asking. Stacked, the shift between the groups is simply
      // visible, each group gets the full panel width instead of half, and a
      // value sits at the same x in both rows — which is what lets the shuffle
      // animation pool them without anything moving sideways.
      // (Jeff, 2026-10-02.)
      const tag = isOriginal ? 'orig' : 'resamp';
      // The group's name and its statistic are the same column of information —
      // "who this row is" — so they stack in ONE column on the left and the
      // plot takes everything else. They used to flank the plot, costing it a
      // column on each side. (Jeff, 2026-10-02.)
      // The key says WHO the row is and how many — and stops there. The mean is
      // already drawn on the plot, labelled, in the colour that means "the
      // statistic"; printing it again two inches to the left spent a whole
      // column on a number the eye has already found. Without it the name is
      // free to wrap over several short lines, so the column can be narrow and
      // the plot gets the width back. (Jeff, 2026-10-03.)
      const key = (/** @type {string} */ name, /** @type {number} */ n, /** @type {number} */ stat) => `
            <div class="mech-dot-key">
              <div class="mech-group-label">${name}</div>
              <div class="mech-group-stat-sm">n = ${n}</div>
            </div>`;
      html += `
        <div class="mech-dot-stack">
          <div class="mech-dot-row">${key(group1Name, g1.length, s1)}
            <div id="mech-dot-${tag}-1" class="mech-dot-cell"></div>
          </div>
          <div class="mech-dot-row">${key(group2Name, g2.length, s2)}
            <div id="mech-dot-${tag}-2" class="mech-dot-cell"></div>
          </div>
        </div>`;
    } else {
      // Means: side-by-side mini histograms
      const tag = isOriginal ? 'orig' : 'resamp';
      html += `
        <div class="mech-hist-pair">
          <div class="mech-hist-col">
            <div class="mech-group-label">${group1Name}</div>
            <div id="mech-hist-${tag}-1" class="mech-hist-cell"></div>
            <div class="mech-group-stat-sm">n=${g1.length}, ${statSymbol}=${formatStat(s1, dataPrecision, fmtType)}</div>
          </div>
          <div class="mech-hist-col">
            <div class="mech-group-label">${group2Name}</div>
            <div id="mech-hist-${tag}-2" class="mech-hist-cell"></div>
            <div class="mech-group-stat-sm">n=${g2.length}, ${statSymbol}=${formatStat(s2, dataPrecision, fmtType)}</div>
          </div>
        </div>`;
    }

    const hlClass = highlightDiff ? ' highlight-last' : '';
    html += `<div class="mech-diff">diff = <span class="mech-stat-value${hlClass}">${diffVal}</span></div>`;
    return html;
  }

  /**
   * Placeholder for the resample ("Shuffled/Resampled Groups") panel BEFORE the
   * first draw. Previously the panel was seeded with a copy of the original
   * grouping (and its diff), which read as if a shuffle had already happened.
   * @returns {string}
   */
  function resamplePanelPlaceholderHTML() {
    const verb = config.mode === 'randomization' ? 'shuffle' : 'resample';
    return `<p class="mech-resample-empty">Click <strong>+1</strong> to ${verb}.</p>`;
  }

  /**
   * Render mini histograms into the two-group mechanism containers.
   * Must be called AFTER innerHTML is set (so the containers exist in DOM).
   * @param {number[]} g1 - Group 1 values
   * @param {number[]} g2 - Group 2 values
   * @param {string} tag - 'orig' or 'resamp'
   * @param {boolean} [highlightMean=false] - Highlight mean markers in orange
   */
  /**
   * Animate both groups' mini histograms from original to resampled.
   *
   * The same handover the one-sample mean CI runs, once per group. The two are
   * started together so the pair reads as one draw rather than two, and the
   * longer of the two durations is what the caller waits on.
   *
   * @param {number} n - observations behind the draw, which paces the stream
   * @returns {number} ms
   */
  function animateHistogramPair(n) {
    const svg = (/** @type {string} */ id) =>
      document.getElementById(id)?.querySelector('svg.mech-minichart') ?? null;
    let ms = 0;
    for (const i of [1, 2]) {
      ms = Math.max(ms, animateHistogramDraw({
        sourceSvg: svg(`mech-hist-orig-${i}`),
        targetSvg: svg(`mech-hist-resamp-${i}`),
        n: Math.round(n / 2),
      }));
    }
    return ms;
  }

  function renderTwoGroupCharts(g1, g2, tag, highlightMean = false) {
    if (config.proportion) return;
    const statFn = config.mode === 'bootstrap' ? getBootstrapStat().fn : mean;

    // Set domain and bins from original data (stable across resamples)
    if (tag === 'orig') {
      const allVals = [...g1, ...g2];
      const [lo, hi] = extent(allVals);
      const pad = (hi - lo) * 0.08 || 0.5;
      twoGroupChartDomain = [lo - pad, hi + pad];
      twoGroupNumBins = Math.min(Math.max(Math.ceil(Math.sqrt(Math.max(g1.length, g2.length))), 6), 15);
    }

    const cell1 = document.getElementById(`mech-hist-${tag}-1`);
    const cell2 = document.getElementById(`mech-hist-${tag}-2`);
    const prefix = tag === 'orig' ? 'Original' : 'Resampled';
    const opts = {
      // No width/height: `drawMiniChart` measures the cell it is drawn into
      // (`miniChartWidth`/`miniChartHeight`). These were pinned at 180x70, so
      // the two-group panel opted out of the sizing every other mini chart got
      // on 2026-10-03 and stayed small in a tier with room to spare. One more
      // place where this path had quietly become its own implementation.
      // (Jeff, 2026-10-03: "you've got room to make the histograms a little
      // bigger here.") A floor, because the shared height formula is tuned for
      // a wide one-sample panel and leaves a half-width cell squatter than the
      // 70px it replaced.
      minHeight: 88,
      domain: twoGroupChartDomain ?? undefined,
      numBins: twoGroupNumBins,
      highlightMean,
    };
    if (cell1 && g1.length >= 1) {
      drawMiniChart(cell1, g1, { ...opts, meanValue: statFn(g1), label: `${prefix} ${group1Name}` });
    }
    if (cell2 && g2.length >= 1) {
      drawMiniChart(cell2, g2, { ...opts, meanValue: statFn(g2), label: `${prefix} ${group2Name}` });
    }
  }

  /** Render original group summaries in the mechanism strip. */
  function renderTwoGroupOriginal() {
    if (!mechOriginalContent) return;
    if (useNewPropMech2()) { renderTwoPropBags(); return; }
    mechOriginalContent.innerHTML = buildTwoGroupHTML(data1, data2, false, true);
    if (twoMeanDotActive()) {
      const domain = computeTwoMeanDomain();
      mechG1.resetSizing(); mechG2.resetSizing();
      const c1 = document.getElementById('mech-dot-orig-1');
      const c2 = document.getElementById('mech-dot-orig-2');
      // The cell's own width, not the panel's. Each row gives its plot a `1fr`
      // grid column narrower than the panel, so measuring the panel drew for
      // 491 and placed it in 391 — letterboxed, with the drawing floating in
      // the middle of its own box. Both groups take the same number, since they
      // share the column. (2026-10-02.)
      const cellW = Math.round((c1 ?? c2)?.getBoundingClientRect().width ?? 0) || undefined;
      const geom = tierDotGeometry();
      if (c1) mechG1.renderBag(c1, data1, mean(data1), { domain, meanLabel: 'x̄', label: `Observed ${group1Name}`, displayWidth: cellW, ...geom });
      if (c2) mechG2.renderBag(c2, data2, mean(data2), { domain, meanLabel: 'x̄', label: `Observed ${group2Name}`, displayWidth: cellW, ...geom });
      return;
    }
    renderTwoGroupCharts(data1, data2, 'orig');
  }

  // ── B4: two-proportion bootstrap mechanism (grid/bar per group) ──────

  /** Build the two-stacked-group scaffold (empty host divs + per-group stats). */
  function twoPropPanelHTML(kind, g1, g2, withDiff) {
    const f = (/** @type {number} */ v) => formatStat(v, dataPrecision, 'proportion');
    // p̂ sits in its own span so a shuffle can hold it back until the marks have
    // landed. n cannot change — a permutation keeps the group sizes — so it is
    // never hidden, and the row does not reflow when the value appears.
    const stat = (/** @type {number[]} */ g) =>
      `n = ${g.length}, p̂ = <span class="pbm-stat-value">${f(mean(g))}</span>`;
    let html = `<div class="pbm-twogroup">
      <div class="pbm-group">
        <div class="mech-group-row"><span class="mech-group-name">${group1Name}:</span>
          <span class="mech-group-stat">${stat(g1)}</span></div>
        <div id="pbm-${kind}-1"></div>
      </div>
      <div class="pbm-group">
        <div class="mech-group-row"><span class="mech-group-name">${group2Name}:</span>
          <span class="mech-group-stat">${stat(g2)}</span></div>
        <div id="pbm-${kind}-2"></div>
      </div>
    </div>`;
    if (withDiff) {
      html += `<div class="mech-diff">diff = <span class="mech-stat-value">${f(mean(g1) - mean(g2))}</span></div>`;
    }
    return html;
  }

  /**
   * Dot size for the two-group blocks.
   *
   * The randomization page stacks four of them — two groups and their two
   * shuffled versions — above an H₀ sentence and a colour key, which at the
   * 24px the bootstrap page uses is taller than a laptop shows beside the
   * distribution. (Jeff, 2026-10-03: "for that particular page, let's make the
   * dots a little smaller to occupy less vertical".) It bites only where the
   * dots were at their maximum: cpr's 50 and 40 draw at 18px instead of 24, in
   * the same three rows; at 90 per group both pages already draw 14px.
   */
  const twoPropBlockOpts = () => ({
    ...(config.mode === 'randomization' ? { maxSize: 18 } : {}),
    // A phone stacks all four blocks in one column, so a row of dots costs
    // four times what it costs on a desktop. Two rows of a slightly smaller
    // dot read as well and give the strip a screenful back.
    ...(phoneLayout() ? { maxRows: 2 } : {}),
  });

  /** Render the two original group "bags". */
  function renderTwoPropBags() {
    if (!mechOriginalContent) return;
    ensurePropStyleToggle();
    mechOriginalContent.innerHTML = twoPropPanelHTML('bag', data1, data2, false);
    // ONE geometry for both groups. Dot size falls as n rises, so a group of 34
    // beside a group of 69 would otherwise draw 24px dots against 18px — two
    // scales for the one comparison the panel is for. The bigger group decides,
    // because it is the one with a size constraint. (2026-10-03.)
    const c1 = document.getElementById('pbm-bag-1');
    const shared = blockLayout(Math.max(data1.length, data2.length),
      Math.round(c1?.getBoundingClientRect().width ?? 0), twoPropBlockOpts());
    renderPropBag(c1, data1, { style: propMechStyle, label: `${group1Name} sample`, layout: shared });
    renderPropBag(document.getElementById('pbm-bag-2'), data2, { style: propMechStyle, label: `${group2Name} sample`, layout: shared });
  }

  /**
   * Render the two resamples (each drawn with replacement from its own bag) and
   * the difference p̂₁* − p̂₂*. Animates the draw on +1.
   * @returns {number} animation duration ms
   */
  function showTwoPropResample(g1, g2, animateDraw) {
    if (!mechResampleContent) return 0;
    mechResampleContent.innerHTML = twoPropPanelHTML('rs', g1, g2, true);
    // The indices are what let the dot block say which observations were drawn
    // and how often — `showStackDraw` has nothing honest to animate without
    // them and returns 0. The one-sample page has passed them since the block
    // was built; these two never did, so the two-proportion CI drew its blocks
    // and then simply sat there while the aggregate view beside it animated.
    // `lastRsIdx1`/`lastRsIdx2` exist for exactly this. (Jeff, 2026-10-02:
    // "two sample CIs should just double up these animations".)
    const ms1 = showPropResample(document.getElementById('pbm-rs-1'), document.getElementById('pbm-bag-1'),
      g1, data1, { style: propMechStyle, animate: animateDraw, indices: lastRsIdx1 ?? undefined });
    const ms2 = showPropResample(document.getElementById('pbm-rs-2'), document.getElementById('pbm-bag-2'),
      g2, data2, { style: propMechStyle, animate: animateDraw, indices: lastRsIdx2 ?? undefined });
    const ms = Math.max(ms1, ms2);
    const diffEl = mechResampleContent.querySelector('.mech-stat-value');
    const setDiff = () => {
      if (!diffEl) return;
      diffEl.textContent = formatStat(mean(g1) - mean(g2), dataPrecision, 'proportion');
      diffEl.classList.add('highlight-last');
    };
    if (ms > 0) setTimeout(setDiff, Math.max(0, ms - 100)); else setDiff();
    return ms;
  }

  /**
   * A shuffle of the two groups, drawn as blocks of marks.
   *
   * The bootstrap's `showTwoPropResample` cannot be reused for it. Its whole
   * vocabulary is repeats and misses — this one was drawn twice, that one never
   * — and a permutation has neither: every observation appears exactly once, in
   * one group or the other, and the group sizes never change. What this has to
   * say instead is that the OUTCOMES did not change, only which group they sit
   * in, so the marks pool, scramble, and are dealt back out keeping their
   * colour. (js/mechanisms/draw-animation.js: animatePoolAndDealMarks.)
   *
   * @param {number[]} g1 @param {number[]} g2
   * @param {boolean} animate - only on +1; a hundred of these is a flicker
   * @returns {number} animation duration in ms
   */
  /** Pool, hold — then the two groups are dealt from it. */
  const POOL_MERGE_MS = 620, POOL_HOLD_MS = 320;
  /**
   * How long the pooled bar stays after the deal begins.
   *
   * The last fleck leaves at `DRAW_MS * 0.6` (prop-bootstrap-mech) — about
   * 690ms — but a bar that goes the moment it has finished launching is gone
   * while the thing it fed is still filling, and the eye has nothing left to
   * compare the two shuffled bars against. It now stays until the boundaries
   * have essentially settled. (Jeff, 2026-10-03: "make the pooled bar persist
   * a little longer".)
   */
  const POOL_DEAL_TAIL = 1320;

  /**
   * The bar a shuffle deals from.
   *
   * Past a mark per observation there is nothing to pool and deal — the display
   * is two boundaries, and a boundary cannot fly. But the claim is the same one
   * the marks make: under H₀ the labels carry no information, so each group is
   * a draw from the OUTCOMES OF BOTH. So the two bags slide together into one
   * pooled bar between the panels, and the flecks that fill the shuffled bars
   * leave from there rather than from each group's own bag — which is what the
   * aggregate draw does on the bootstrap page, and would be the wrong claim
   * here. (Jeff, 2026-10-03: "for two prop shuffling in aggregate we could
   * animate a pooled bar and flying dots from there".)
   *
   * @returns {{x0:number,x1:number,y:number,split:number}|null} where the deal
   *   launches from, or null if there is nothing to pool
   */
  function poolTheBags() {
    const bar = (/** @type {string} */ id) =>
      /** @type {HTMLElement|null} */ (document.querySelector(`#${id} .mech-prop-bar`));
    const b1 = bar('pbm-bag-1'), b2 = bar('pbm-bag-2');
    const t1 = document.getElementById('pbm-rs-1');
    if (!b1 || !b2 || !t1) return null;
    const r1 = b1.getBoundingClientRect(), r2 = b2.getBoundingClientRect();
    const rt = t1.getBoundingClientRect();
    if (!r1.width || !r2.width) return null;

    const s = data1.filter(v => v === 1).length + data2.filter(v => v === 1).length;
    const f = (data1.length + data2.length) - s;
    // Narrower than a panel's bar: at full width it lay across both panels and
    // read as a third row of the display rather than as something passing
    // between them.
    const width = Math.min(Math.max(r1.width, r2.width) * 0.62, 340);
    // Between the two panels, on the line the two bags share — the pile the
    // marks make, at the scale a bar works in.
    const cx = (r1.left + r1.width / 2 + rt.left + rt.width / 2) / 2;
    const cy = (r1.top + r2.bottom) / 2;

    const pool = document.createElement('div');
    pool.className = 'pbm-pool';
    pool.style.cssText = `position:fixed;left:${cx - width / 2}px;top:${cy - 26}px;`
      + `width:${width}px;z-index:999;pointer-events:none;opacity:0;`;
    pool.innerHTML = `<div class="pbm-pool-label">pooled</div>${propBarHTML(s, f)}`;
    document.body.appendChild(pool);

    // The bags do not vanish — they are still the data — so what travels is a
    // ghost of each, fading as the pooled bar takes its place.
    const ghosts = [r1, r2].map((r, i) => {
      const g = /** @type {HTMLElement} */ ((i ? b2 : b1).cloneNode(true));
      g.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;`
        + `width:${r.width}px;height:${r.height}px;z-index:998;pointer-events:none;`
        + `transition:transform ${POOL_MERGE_MS}ms cubic-bezier(.45,.05,.35,1),`
        + ` opacity ${POOL_MERGE_MS}ms ease;`;
      document.body.appendChild(g);
      return { el: g, r };
    });

    const target = pool.querySelector('.mech-prop-bar')?.getBoundingClientRect();
    requestAnimationFrame(() => {
      pool.style.transition = `opacity ${POOL_MERGE_MS}ms ease`;
      pool.style.opacity = '1';
      for (const g of ghosts) {
        const dx = (target ? target.left + target.width / 2 : cx) - (g.r.left + g.r.width / 2);
        const dy = (target ? target.top + target.height / 2 : cy) - (g.r.top + g.r.height / 2);
        g.el.style.transform = `translate(${dx}px, ${dy}px) scaleX(${target ? target.width / g.r.width : 1})`;
        g.el.style.opacity = '0';
      }
    });
    setTimeout(() => { for (const g of ghosts) g.el.remove(); }, POOL_MERGE_MS + 60);

    const geom = (() => {
      const b = pool.querySelector('.mech-prop-bar');
      const fill = pool.querySelector('.mech-prop-fill');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x0: r.left, x1: r.right, y: r.top + r.height / 2,
               split: fill ? fill.getBoundingClientRect().width : 0 };
    })();

    // It leaves once it has been dealt from — which is after the LAST fleck has
    // left it, not after the first.
    const dismiss = () => {
      pool.style.transition = 'opacity 420ms ease';
      pool.style.opacity = '0';
      setTimeout(() => pool.remove(), 460);
    };
    return { geom, dismiss };
  }

  function showTwoPropShuffle(g1, g2, animate) {
    if (!mechResampleContent) return 0;
    mechResampleContent.innerHTML = twoPropPanelHTML('rs', g1, g2, true);
    const c1 = /** @type {HTMLElement} */ (document.getElementById('pbm-rs-1'));
    const c2 = /** @type {HTMLElement} */ (document.getElementById('pbm-rs-2'));
    // One geometry for all four blocks, from the biggest group — the same rule
    // the bags use, for the same reason: two scales cannot be compared.
    const shared = blockLayout(Math.max(data1.length, data2.length),
      Math.round(c1?.getBoundingClientRect().width ?? 0), twoPropBlockOpts());
    const common = { style: propMechStyle, layout: shared, delta: false };
    renderPropResample(c1, g1, { ...common, label: `Shuffled ${group1Name}`,
      reference: data1.length ? mean(data1) : null });
    renderPropResample(c2, g2, { ...common, label: `Shuffled ${group2Name}`,
      reference: data2.length ? mean(data2) : null });

    const marks = (/** @type {Element|null} */ el) =>
      /** @type {HTMLElement[]} */ ([...(el?.querySelectorAll('.pbm-dot') ?? [])]);
    // Which display was actually drawn, rather than which was asked for:
    // `effStyle` retires the individual view once n outgrows a mark each, so
    // the preference can say "dots" while the panel holds two bars.
    const individual = marks(c1).length > 0;
    let ms = 0;
    if (animate && individual) {
      ms = animatePoolAndDealMarks({
        sourceGroups: [marks(document.getElementById('pbm-bag-1')),
                       marks(document.getElementById('pbm-bag-2'))],
        targetGroups: [marks(c1), marks(c2)],
      });
    } else if (animate && !prefersReducedMotion()) {
      // Aggregate: pool the two bags into one bar, hold, then deal both
      // shuffled bars out of it. Guarded here rather than inside: the pooled
      // bar is built before anything downstream gets to decline, so without
      // this it appeared and vanished for a reader who asked for no motion.
      const pooled = poolTheBags();
      if (pooled?.geom) {
        const wait = POOL_MERGE_MS + POOL_HOLD_MS;
        const deal = (/** @type {HTMLElement} */ host, /** @type {number[]} */ g,
                      /** @type {number[]} */ orig) =>
          showPropResample(host, null, g, orig,
            { style: propMechStyle, animate: true, source: pooled.geom, delay: wait, delta: false });
        ms = Math.max(deal(c1, g1, data1), deal(c2, g2, data2));
        // The flecks launch across the first 60% of the draw; the bar they come
        // from has to outlast them.
        setTimeout(pooled.dismiss, wait + POOL_DEAL_TAIL);
      }
    }

    // Every number the deal produces waits for the deal.
    //
    // The counts, each group's p̂ and the difference were all written with the
    // panel, so the answer was on screen in full while the marks were still in
    // the air — and a student who reads "13 S, 37 F" before anything lands has
    // no reason to watch the thing that produced it. They are hidden rather
    // than emptied, so nothing reflows when they appear. (Jeff, 2026-10-03:
    // "don't reveal the numbers of S and F in the shuffled groups until the
    // animation completes".)
    const diffEl = mechResampleContent.querySelector('.mech-stat-value');
    const reveal = () => {
      mechResampleContent?.classList.remove('pbm-reveal-pending');
      diffEl?.classList.add('highlight-last');
    };
    if (ms > 0) {
      mechResampleContent.classList.add('pbm-reveal-pending');
      setTimeout(reveal, Math.max(0, ms - 120));
    } else reveal();
    return ms;
  }

  /**
   * Encoded null next to the shuffle mechanism (randomization only): connect H₀
   * to *why* we shuffle — "the labels carry no information, so we re-allocate
   * them." Injected from JS so every randomization page gets it without per-page
   * HTML (REQ-031). Text adapts to the mechanism (re-allocate vs sign-flip).
   */
  function renderMechanismNull() {
    if (!mechanismStrip) return;
    let el = mechanismStrip.querySelector('.mechanism-null');
    if (!el) {
      el = document.createElement('p');
      el.className = 'mechanism-null';
      const panels = mechanismStrip.querySelector('.mechanism-panels');
      if (panels && panels.parentNode) panels.parentNode.insertBefore(el, panels.nextSibling);
      else mechanismStrip.appendChild(el);
    }
    const claim = datasetContext.nullClaim
      ? `<strong>H₀:</strong> ${datasetContext.nullClaim}. `
      : '';
    const mech = config.paired
      ? 'Under the null, each pair’s difference is just as likely to be + or −, so each shuffle randomly <strong>flips the signs</strong> — the values don’t change, only the ± labels.'
      : 'Under the null, the group labels carry no information, so each shuffle <strong>re-allocates</strong> the same outcomes to new groups — the outcomes don’t change, only who’s in which group.';
    el.innerHTML = claim + mech;
  }

  /**
   * The colour key under the strip — for every proportion view, not just cards.
   *
   * The card view has always named its two colours; the bar and dot views named
   * neither. A student met "11 S" and "39 F" inside the bars and had to infer
   * that amber was the outcome being counted — the letters abbreviate the
   * OUTCOME, they do not translate the colour. Now both are named wherever a
   * proportion is drawn, in the words the dataset uses ("survived" / "died").
   * (Jeff, 2026-10-03: "for proportions simulations let's find a way to add a
   * legend somewhere for success and failures (the two colors)".)
   *
   * In the card view the key also carries the control for WHICH colour is the
   * success, since that is the one place the question arises (REQ-071).
   */
  function updateMechCardLegend() {
    if (!config.proportion || !mechanismStrip) return;
    // Its own row at the foot of the strip, not the caption paragraph.
    // `#mechanism-description` is already spoken for: `placeStatRows` moves it
    // into Step 2's stat row on the one-proportion bootstrap, inside a panel
    // that stays hidden until the first draw — so a key written there was
    // correct and invisible.
    // In a tier layout the strip is an empty shell — the panels were moved out
    // of it before the first render — so a key appended there was built, filled
    // and never seen. It goes under Step 1, where the colours first appear.
    const legendHost = document.querySelector('.mech-tier--source') ?? mechanismStrip;
    let row = document.querySelector('.mech-legend-row');
    if (!row) {
      row = document.createElement('p');
      row.className = 'mech-legend-row';
    }
    if (row.parentElement !== legendHost) legendHost.appendChild(row);
    const mechanismDescEl = /** @type {HTMLElement} */ (row);
    const o = cardOpts();
    const succ = o.successLabel || 'success';
    const fail = o.failureLabel || 'failure';
    mechanismDescEl.innerHTML = cardMechanism
      ? cardLegendHTML(succ, fail, { swapped: cardColorSwapped })
        + `<button type="button" class="obs-swap-btn" aria-pressed="${String(cardColorSwapped)}"`
        + ` title="Swap which card colour means ${succ}">⇄ Swap colours</button>`
      : obsLegendHTML(succ, fail);
    mechanismDescEl.hidden = false;
    const swapBtn = mechanismDescEl.querySelector('.obs-swap-btn');
    if (swapBtn) swapBtn.addEventListener('click', () => {
      cardColorSwapped = !cardColorSwapped;
      rerenderMechanismView();
      announce(`${succ} is now the ${cardColorSwapped ? 'white' : 'red'} card.`);
    });
  }

  /**
   * Each panel's trailing line is ONE line.
   *
   * Step 1 ended with its statistic and then the Dots | Tiles control under it;
   * Step 2 with its statistic and then a caption. Both are a short fact and a
   * short aside, and both fit beside each other — which is two lines of panel
   * height back, on a strip where height is what the chart is competing for.
   * (Jeff, 2026-10-02: "I wonder if we can put the last two lines on step 1
   * into one line … and the last two lines condensed into one".)
   *
   * Rebuilt rather than assumed, because the tier layouts reparent both the
   * panels and the caption after this has run once.
   *
   * @param {HTMLElement} [trailer] the control to sit beside Step 1's statistic
   */
  function placeStatRows(trailer) {
    /** @param {Element|null} panel @param {Element|null|undefined} tail */
    const row = (panel, tail) => {
      const stat = panel?.querySelector('.mechanism-stat');
      if (!stat || !tail) return;
      let r = panel.querySelector('.mech-stat-row');
      if (!r) {
        r = document.createElement('div');
        r.className = 'mech-stat-row';
        stat.parentElement?.insertBefore(r, stat);
        r.appendChild(stat);
      } else if (stat.parentElement !== r) {
        r.insertBefore(stat, r.firstChild);
      }
      if (tail.parentElement !== r) r.appendChild(tail);
    };
    row(document.querySelector('[data-entity="source"]'), trailer);
    row(document.querySelector('[data-entity="draw"]'), mechanismDescEl);
  }

  /** Re-render both mechanism panels in the current view (Bars/Cards). No
   *  animation — this is a view switch, not a simulation step. */
  function rerenderMechanismView() {
    renderTwoGroupOriginal();
    if (mechResampleContent) {
      const haveResample = lastTwoG1.length > 0 && lastTwoG2.length > 0;
      if (!haveResample) {
        // No shuffle yet — keep the panel blank rather than mirroring the original.
        mechResampleContent.innerHTML = resamplePanelPlaceholderHTML();
      } else if (useNewPropMech2()) {
        // A view switch, not a simulation step: no draw, no deal.
        if (config.mode === 'randomization') showTwoPropShuffle(lastTwoG1, lastTwoG2, false);
        else showTwoPropResample(lastTwoG1, lastTwoG2, false);
      } else {
        mechResampleContent.innerHTML = buildTwoGroupHTML(lastTwoG1, lastTwoG2, false);
        renderTwoGroupCharts(lastTwoG1, lastTwoG2, 'resamp');
      }
    }
    updateMechCardLegend();
  }

  /**
   * Dots | Cards — the RENDERING inside the individual view.
   *
   * It is the same dimension the mean pages call Dots | Tiles: the role (one
   * mark per observation, or the aggregate) is the other control's, and this
   * says which picture that role is drawn as. It used to be "Bars | Cards" in
   * the strip's collapse bar, grey and top-right among the page chrome, where
   * a reader who did not already know cards existed had no reason to look —
   * and "Bars" stopped being true when the individual view became blocks of
   * marks. Now it sits beside Step 1's heading, next to the role it modifies.
   * (Jeff, 2026-10-03: "make it discoverable".)
   *
   * Idempotent. Rebuilt on every data load, because `cardsAllowed()` depends
   * on the group sizes.
   */
  /**
   * The heading's controls sit together, in a box of their own.
   *
   * Two of them share Step 1's heading now, and in a tier layout the heading
   * line also carries the difference, parked at its far right — so the two
   * controls and the number were laid out on top of each other ("diff" written
   * through "Draw as:"). A box lets the heading wrap them onto a line of their
   * own without the title following them down. (Jeff, 2026-10-03, from a tiers
   * screenshot: "have some elements overlapping here … maybe make toggles two
   * rows".)
   *
   * @param {Element} host the panel title or tier heading
   */
  function headControls(host) {
    let box = host.querySelector('.mech-head-controls');
    if (!box) {
      box = document.createElement('span');
      box.className = 'mech-head-controls';
      if (host.classList.contains('mechanism-collapse-bar')) host.insertBefore(box, host.firstChild);
      else host.appendChild(box);
    }
    return box;
  }

  function ensureViewToggle() {
    if (!mechanismStrip) return;
    const existing = mechanismStrip.querySelector('.mech-view-toggle')
      ?? document.querySelector('.mech-view-toggle');
    // Cards need small groups, and the aggregate has one rendering — so in
    // either case the control goes away rather than sitting there meaning
    // nothing (the same rule the role control follows).
    if (!cardsAllowed() || propMechStyle === 'aggregate') { existing?.remove(); return; }
    if (existing) return;

    // Beside Step 1's heading, after the role control — the two read as one
    // sentence: View: Individual | Aggregate, drawn as Dots | Cards.
    const host = document.querySelector('.mech-tier--source .mech-tier-head')
      ?? document.querySelector('[data-entity="source"] .mechanism-title')
      ?? mechanismStrip.querySelector('.mechanism-collapse-bar');
    if (!host) return;

    const wrap = document.createElement('div');
    wrap.className = 'pbm-style-toggle mech-view-toggle';
    wrap.innerHTML =
      '<span class="seg-label">Draw as:</span>'
      + '<div class="seg-control" role="group" aria-label="Mechanism rendering">'
      + `<button type="button" data-view="dots" aria-pressed="${String(!cardMechanism)}">Dots</button>`
      + `<button type="button" data-view="cards" aria-pressed="${String(cardMechanism)}">Cards</button>`
      + '</div>';

    wrap.addEventListener('click', (e) => {
      const btn = /** @type {HTMLElement} */ (e.target).closest('button[data-view]');
      if (!btn) return;
      const wantCards = btn.getAttribute('data-view') === 'cards';
      if (wantCards === cardMechanism) return;
      cardMechanism = wantCards;
      for (const b of wrap.querySelectorAll('button')) {
        b.setAttribute('aria-pressed', String((b.getAttribute('data-view') === 'cards') === cardMechanism));
      }
      syncUrl();
      rerenderMechanismView();
    });

    headControls(host).appendChild(wrap);
  }

  /** Add the Grid/Bar segmented toggle for the one-proportion bootstrap
   *  mechanism (B2). Idempotent; flips bag + resample between representations. */
  /**
   * View: Individual | Aggregate, when there is a choice to make.
   *
   * Above MAX_MARBLES there is no individual view — one mark per observation
   * stops being drawable — so the control is removed rather than left with one
   * position that does nothing. It is rebuilt on every data load because the
   * answer changes with the dataset: switching from cpr (40 + 50) to avandia
   * (609 + 1,391) has to take the toggle with it. (Jeff, 2026-10-02.)
   */
  function ensurePropStyleToggle() {
    // The ROLE control belongs to the page, not to the rendering: cards are an
    // individual view too, so switching to them must not take away the way back
    // to Aggregate — and a ?mechanism=cards link has to open with both controls
    // the live toggle shows.
    const forProps = useNewPropMech || twoPropBlockPage;
    // One control, both families. The proportion pages flip which DISPLAY the
    // mechanism draws; the quantitative ones flip which ROLE the resample panel
    // shows. Same question, same words, same place — which is the whole point
    // of doing this rather than leaving each family its own vocabulary.
    if ((!forProps && config.proportion) || !mechanismStrip) return;
    // Where the control can actually be SEEN. The collapse bar lives inside the
    // mechanism strip, and the tier layouts hide the strip — so building it
    // there gave ?mech=split and ?mech=tiers a toggle that existed, reported
    // itself present to a spec, and had zero width on screen. That is the same
    // trap the Tiles/Dotplots control fell into on 2026-09-27, in the same
    // element; the comment left there did not stop the next control repeating
    // it, so this one tests for visibility rather than existence.
    // In a tier layout it belongs beside STEP 1's heading, because what it
    // switches is how the source and the draw are drawn. (Jeff, 2026-10-02.)
    // Step 1's own heading in every layout. It used to take the strip's shared
    // collapse bar when there were no tiers, which put it hard against the
    // draw panel's title — and once that title became "Resample with
    // Replacement" the two ran into each other. Beside the thing it governs is
    // both the right place and the one that does not collide.
    const bar = document.querySelector('.mech-tier--source .mech-tier-head')
      ?? document.querySelector('[data-entity="source"] .mechanism-title')
      ?? mechanismStrip.querySelector('.mechanism-collapse-bar');
    if (!bar) return;

    const biggest = Math.max(data1?.length ?? 0, data2?.length ?? 0);
    const existing = document.querySelector('.pbm-style-toggle');
    const haveChoice = forProps ? hasIndividualView(biggest) : individualAvailable();
    if (!haveChoice) {
      existing?.remove();
      // The PREFERENCE is deliberately left alone. `effStyle` already resolves
      // it to the aggregate at this size, so forcing the variable as well only
      // destroys what the reader picked: switch to a big dataset and back and
      // you came back to Aggregate having never chosen it. (2026-10-02.)
      return;
    }
    if (existing) return;

    const seg = document.createElement('div');
    seg.className = 'pbm-style-toggle';
    const individual = forProps
      ? (propMechStyle === 'dots' || propMechStyle === 'grid')
      : meanRole === 'individual';
    const pressed = (/** @type {string} */ v) => String(v === 'dots' ? individual : !individual);
    // The label sits OUTSIDE the segmented control: inside its border it reads
    // as a third, dead position.
    seg.innerHTML =
      '<span class="seg-label">View:</span>'
      + '<div class="seg-control" role="group" aria-label="View">'
      + `<button type="button" data-pstyle="dots" aria-pressed="${pressed('dots')}">Individual</button>`
      + `<button type="button" data-pstyle="aggregate" aria-pressed="${pressed('aggregate')}">Aggregate</button>`
      + '</div>';

    seg.addEventListener('click', (e) => {
      const btn = /** @type {HTMLElement} */ (e.target).closest('button[data-pstyle]');
      if (!btn) return;
      const want = btn.getAttribute('data-pstyle') === 'aggregate' ? 'aggregate' : 'dots';
      if (!forProps) {
        const role = want === 'aggregate' ? 'aggregate' : 'individual';
        if (role === meanRole) return;
        meanRole = role;
        resampleViewExplicit = true;
        for (const b of seg.querySelectorAll('button')) {
          b.setAttribute('aria-pressed', String(b.getAttribute('data-pstyle')
            === (role === 'aggregate' ? 'aggregate' : 'dots')));
        }
        // Aggregate has one rendering, so the Dots | Tiles choice goes away
        // with it rather than sitting there meaning nothing.
        syncRenderingToggle();
        // One static re-render for the role change, via the same path the
        // rendering switch uses. Leaving Individual remembers how it was being
        // drawn, so coming back restores it — without that, a page whose
        // individual rendering is tiles went to the histogram and stayed
        // there, because 'histogram' is what Aggregate had left behind.
        if (role === 'aggregate') individualMode = resampleViewMode;
        // Pages with no Dots | Tiles choice have one individual rendering, and
        // it is the tiles one.
        const back = viewToggleIsLive ? individualMode : 'summary';
        setResampleViewMode(role === 'aggregate' ? 'histogram' : back);
        syncUrl();
        return;
      }
      if (want === propMechStyle) return;
      propMechStyle = want;
      for (const b of seg.querySelectorAll('button')) {
        b.setAttribute('aria-pressed', String(b.getAttribute('data-pstyle') === propMechStyle));
      }
      // The aggregate has one rendering, so Dots | Cards goes with it.
      if (cardModeAvailable) {
        if (propMechStyle === 'aggregate') cardMechanism = false;
        ensureViewToggle();
      }
      syncUrl();
      // Re-render bag + current resample (static) in the new representation.
      if (useNewPropMech2()) {
        rerenderMechanismView();
      } else {
        renderOriginalSample();
        if (lastResample.length && resampleContentEl) {
          renderPropResample(resampleContentEl, lastResample, {
            style: propMechStyle,
            // The aggregate view pins the observed proportion; a style switch
            // has to carry it through or the reference line vanishes.
            reference: data1.length ? mean(data1) : null,
            // The panel's own closing line says what changed, so the display
            // does not say it again underneath.
            delta: false,
          });
        }
      }
    });

    // In the strip it leads the collapse bar; in a tier heading it trails the
    // title, so "STEP 1  Original Sample" still reads first. Either way it goes
    // in the heading's controls box, beside whatever else lives there.
    const box = headControls(bar);
    box.insertBefore(seg, box.firstChild);
  }

  /**
   * Show the two-group mechanism after a simulation step.
   * @param {number[]} g1 - Group 1 values (resample or shuffled)
   * @param {number[]} g2 - Group 2 values (resample or shuffled)
   * @param {boolean} [_flash] - Unused (kept for call-site compat)
   * @param {boolean} [highlight] - Highlight diff value (+1 animation, auto-fades via CSS)
   */
  function showTwoGroupMechanism(g1, g2, _flash = false, highlight = false) {
    if (!mechResampleContent || !mechanismDescEl) return 0;

    // Remember the latest grouping so the toggle can re-render it.
    lastTwoG1 = g1;
    lastTwoG2 = g2;

    // B4: two-proportion bootstrap uses the per-group grid/bar mechanism.
    if (useNewPropMech2()) {
      return config.mode === 'randomization'
        ? showTwoPropShuffle(g1, g2, highlight)
        : showTwoPropResample(g1, g2, highlight);
    }

    // B3: two stacked dotplots per group.
    if (twoMeanDotActive()) {
      mechResampleContent.innerHTML = buildTwoGroupHTML(g1, g2, true, false);
      const domain = computeTwoMeanDomain();
      const c1 = document.getElementById('mech-dot-resamp-1');
      const c2 = document.getElementById('mech-dot-resamp-2');
      // The bootstrap's pluck-and-fly says "this dot was drawn from that one,
      // and some were drawn twice". A shuffle has no such facts — every
      // observation appears exactly once, in one group or the other — so it
      // renders statically until the pool-and-deal animation exists, rather
      // than borrowing a picture that means something else. (2026-10-02.)
      const isBoot = config.mode === 'bootstrap';
      const drawn = isBoot && highlight;
      const verb = isBoot ? 'Resampled' : 'Shuffled';
      let ms = 0;
      const geom = tierDotGeometry();
      if (c1) ms = Math.max(ms, mechG1.renderResample(c1, data1, g1, mean(g1), drawn, { domain, meanLabel: 'x̄*', label: `${verb} ${group1Name}`, indices: isBoot ? (lastRsIdx1 ?? undefined) : undefined, ...geom }));
      if (c2) ms = Math.max(ms, mechG2.renderResample(c2, data2, g2, mean(g2), drawn, { domain, meanLabel: 'x̄*', label: `${verb} ${group2Name}`, indices: isBoot ? (lastRsIdx2 ?? undefined) : undefined, ...geom }));
      // A shuffle pools both groups and deals them back out — the book's card
      // shuffle, with dots. Only on +1: a hundred of these is a flicker.
      if (!isBoot && highlight) {
        const dots = (/** @type {Element|null} */ el) =>
          [...(el?.querySelectorAll('svg .data circle') ?? [])];
        const shuffleMs = animatePoolAndDeal({
          sourceGroups: [dots(document.getElementById('mech-dot-orig-1')),
                         dots(document.getElementById('mech-dot-orig-2'))],
          targetGroups: [dots(c1), dots(c2)],
        });
        if (shuffleMs) ms = Math.max(ms, shuffleMs);
      }
      return ms;
    }

    const statFn = config.mode === 'bootstrap' ? getBootstrapStat().fn : mean;
    const fmtType = config.proportion ? 'proportion' : undefined;

    // Can we morph existing histograms? (non-proportion, single-step, charts exist)
    // Can we animate proportion bars? (proportion, single-step, bars already rendered)
    const canAnimateProps = config.proportion && highlight && !cardMechanism
      && mechResampleContent.querySelector('.mech-prop-bar');

    // Card mode: re-deal the cards (FLIP) on a single shuffle. On the FIRST
    // shuffle the panel is still the blank "click +1" placeholder — seed it
    // instantly with the ORIGINAL grouping so the deal has a starting layout to
    // animate from (otherwise the first shuffle would just snap in, unanimated).
    let cardContainer = null;
    if (cardMechanism && highlight) {
      cardContainer = mechResampleContent.querySelector('.mech-card-display');
      if (!cardContainer) {
        mechResampleContent.innerHTML = buildTwoGroupHTML(data1, data2, false);
        cardContainer = mechResampleContent.querySelector('.mech-card-display');
      }
    }

    let morphMs = 0;

    if (cardMechanism && cardContainer) {
      // The cards take the dots' choreography.
      //
      // `animateCardShuffle` re-dealt the SHUFFLED panel's own cards with a
      // FLIP: they gathered, mixed and spread out again without the original
      // groups taking any part, so the picture said "this panel rearranged
      // itself" when what happens is that BOTH groups are poured together and
      // dealt back out. The dot view already tells it properly, and its
      // animation is not about dots — `animatePoolAndDealMarks` flies whatever
      // marks it is given, copying each one's own computed style, so the
      // flyers here come out as cards. (Jeff, 2026-10-04: "I want the original
      // groups to merge into the FLIP and then deal, or you can just use the
      // dots choreography.")
      const diffSpan = mechResampleContent.querySelector('.mech-stat-value');
      cardContainer.innerHTML = cardGroupsHTML(g1, g2, cardOpts());
      const cards = (/** @type {Element|null} */ root) =>
        /** @type {HTMLElement[]} */ ([...(root?.querySelectorAll('.card-group .card') ?? [])]);
      const srcGroups = [...(mechOriginalContent?.querySelectorAll('.card-group') ?? [])];
      const tgtGroups = [...cardContainer.querySelectorAll('.card-group')];
      const setDiff = () => {
        if (!diffSpan) return;
        diffSpan.textContent = formatStat(statFn(g1) - statFn(g2), dataPrecision, fmtType);
        diffSpan.classList.add('highlight-last');
        /** @type {HTMLElement} */ (diffSpan).style.opacity = '1';
      };
      morphMs = srcGroups.length === 2 && tgtGroups.length === 2
        ? animatePoolAndDealMarks({
            sourceGroups: [cards(srcGroups[0]), cards(srcGroups[1])],
            targetGroups: [cards(tgtGroups[0]), cards(tgtGroups[1])],
          })
        : 0;
      if (morphMs > 0) {
        // The dealt counts wait for the cards, the way the blocks' do: "13/50"
        // sitting over an empty panel is the answer printed before the deal.
        mechResampleContent.classList.add('pbm-reveal-pending');
        if (diffSpan) /** @type {HTMLElement} */ (diffSpan).style.opacity = '0.3';
        setTimeout(() => {
          mechResampleContent?.classList.remove('pbm-reveal-pending');
          setDiff();
        }, Math.max(0, morphMs - 150));
      } else setDiff();

    } else if (canAnimateProps && mechOriginalContent) {
      // Ghost: fade resample panel to low opacity
      const propBars = mechResampleContent.querySelectorAll('.mech-prop-fill');
      const statSpans = mechResampleContent.querySelectorAll('.mech-group-stat');
      // `.mech-prop-count` since the counts moved inside their own regions;
      // the aside is the below-bar fallback for a region too narrow to hold one.
      const propLabels = mechResampleContent.querySelectorAll('.mech-prop-count, .mech-prop-aside');
      const diffSpan = mechResampleContent.querySelector('.mech-stat-value');

      propBars.forEach(b => { /** @type {HTMLElement} */ (b).style.opacity = '0.25'; });
      propLabels.forEach(l => { /** @type {HTMLElement} */ (l).style.opacity = '0.2'; });
      statSpans.forEach(s => { /** @type {HTMLElement} */ (s).style.opacity = '0.2'; });
      if (diffSpan) /** @type {HTMLElement} */ (diffSpan).style.opacity = '0.2';

      // Fire flying dots from original → resample
      flyDataStream(mechOriginalContent, mechResampleContent);

      // After dots are mid-flight, update prop bars to new values
      setTimeout(() => {
        const statSymbol = 'p\u0302';
        const succ1 = g1.filter(v => v === 1).length;
        const fail1 = g1.length - succ1;
        const succ2 = g2.filter(v => v === 1).length;
        const fail2 = g2.length - succ2;
        const pct1 = g1.length > 0 ? (succ1 / g1.length * 100) : 0;
        const pct2 = g2.length > 0 ? (succ2 / g2.length * 100) : 0;
        const s1 = statFn(g1);
        const s2 = statFn(g2);

        // Animate the bar widths and move the counts with them. The counts live
        // inside their own regions now, so they cannot be patched by index —
        // updatePropBar owns both, including gaining or losing the below-bar
        // fallback when a region crosses the too-narrow threshold.
        const bars = mechResampleContent.querySelectorAll('.mech-prop-bar');
        updatePropBar(bars[0], succ1, fail1, { animate: true });
        updatePropBar(bars[1], succ2, fail2, { animate: true });

        // Update stat text
        if (statSpans[0]) { statSpans[0].innerHTML = `n = ${g1.length}, ${statSymbol} = ${formatStat(s1, dataPrecision, fmtType)}`; }
        if (statSpans[1]) { statSpans[1].innerHTML = `n = ${g2.length}, ${statSymbol} = ${formatStat(s2, dataPrecision, fmtType)}`; }
        statSpans.forEach(s => {
          /** @type {HTMLElement} */ (s).style.transition = 'opacity 250ms ease';
          /** @type {HTMLElement} */ (s).style.opacity = '1';
        });

        // Update diff
        const diffVal = formatStat(s1 - s2, dataPrecision, fmtType);
        if (diffSpan) {
          diffSpan.textContent = diffVal;
          diffSpan.classList.add('highlight-last');
          /** @type {HTMLElement} */ (diffSpan).style.transition = 'opacity 250ms ease';
          /** @type {HTMLElement} */ (diffSpan).style.opacity = '1';
        }
      }, 200);

      morphMs = 200 + 400;

    } else {
      // EVERY single draw rebuilds and animates — there is no quick path.
      //
      // There used to be one: the first +1 rebuilt the panel and ran the full
      // handover, and every +1 after it took a morph instead — a fade and a
      // shift, over in 600ms. So the mechanism explained itself once and then
      // stopped, exactly when a student starts pressing +1 to watch it again.
      // Batching is how you skip an animation on this site (+10, +100), and it
      // already works; a single draw should always be the whole story.
      // (Jeff, 2026-10-03: "keep the same animation with lots of dots
      // throughout for every +1, animations can be avoided by pressing +10".)
      mechResampleContent.innerHTML = buildTwoGroupHTML(g1, g2, highlight);
      renderTwoGroupCharts(g1, g2, 'resamp', highlight);
      // Past the dotplot cap the groups are mini histograms, and the panel just
      // redrew — bars appearing with nothing to say where they came from. The
      // one-sample mean CI already animates this exact handover, bar to bar;
      // run it per group so a bigger sample is the SAME mechanism at a coarser
      // grain rather than a different, duller one. (Jeff, 2026-10-03.)
      if (highlight && !twoMeanDotActive() && !config.proportion) {
        morphMs = Math.max(morphMs, animateHistogramPair(g1.length + g2.length));
      }
    }

    // Describe the mechanism as a subtitle on the resample column title, rather
    // than a separate full-width caption row — saves vertical space.
    const descText = config.mode === 'bootstrap'
      ? 'with replacement'
      : 'same values, new grouping';
    const resampleTitle = document.querySelector('#mech-resample .mechanism-title');
    if (resampleTitle) {
      let sub = resampleTitle.querySelector('.mechanism-subtitle');
      if (!sub) {
        sub = document.createElement('span');
        sub.className = 'mechanism-subtitle';
        resampleTitle.appendChild(sub);
      }
      sub.textContent = ` · ${descText}`;
    }
    // The bottom caption row carries the colour key (and, in the card view, the
    // control for which colour is the success). One implementation, so the two
    // call sites cannot drift.
    updateMechCardLegend();
    return morphMs;
  }

  /**
   * Show the bootstrap resample using the current view mode.
   * @param {number[]} resampleValues
   * @param {boolean} [flash] - Whether to flash the statistic (for +1)
   */
  /**
   * @param {number[]} resampleValues
   * @param {boolean} [flash] - Trigger mechanism flash animation
   * @param {boolean} [highlightStat] - Highlight resample stat orange (+1 only)
   * @returns {number} Animation duration in ms (0 if no animation)
   */
  function showResample(resampleValues, _flash = false, highlightStat = false, flyingAnim = true) {
    if (!resampleContentEl || !bootstrapSampleEl) return 0;
    bootstrapSampleEl.hidden = false;

    // Fire flying dots from original → resample on +1. The new one-proportion
    // mechanism (B2) and the mean-dotplot mechanism (B1) do their own
    // draw-with-replacement animation instead.
    if (highlightStat && flyingAnim && originalContentEl && resampleContentEl
        && !useNewPropMech && !meanDotActive()) {
      flyDataStream(originalContentEl, resampleContentEl);
    }

    let animMs = 0;
    if (resampleViewMode === 'histogram') {
      animMs = showResampleHistogram(resampleValues, highlightStat && flyingAnim);
    } else {
      animMs = showResampleSummary(resampleValues, highlightStat && flyingAnim);
    }

    if (resampleMeanEl) {
      const stat = getBootstrapStat();
      const resampleVal = stat.fn(resampleValues);
      const statKey = bootStatSelect?.value ?? 'mean';

      // Build symbol HTML with proper overline for x-bar
      let symHTML;
      if (config.proportion) {
        symHTML = 'p\u0302';
      } else if (statKey === 'mean') {
        symHTML = '<span class="x-bar">x</span>';
      } else if (statKey === 'median') {
        symHTML = 'median';
      } else if (statKey === 'sd') {
        symHTML = 's';
      } else {
        symHTML = stat.label.replace('Sample ', '').toLowerCase();
      }

      // A proportion shows its own arithmetic: p-hat = 7/62 = 0.113. The two
      // counts are already on the block above, so the fraction is what ties
      // them to the number that goes into the distribution — otherwise 0.113
      // arrives from nowhere. Only for a single sample: a difference of two
      // proportions has no one fraction to show. (Jeff, 2026-10-01.)
      const valText = config.proportion
        ? (config.twoGroup
          ? formatStat(resampleVal, dataPrecision, 'proportion')
          : `${resampleValues.filter(v => v === 1).length}/${resampleValues.length}`
            + ` = ${formatStat(resampleVal, dataPrecision, 'proportion')}`)
        : formatStat(resampleVal, dataPrecision);

      // Update the value span with symbol + value, styled orange
      resampleMeanEl.innerHTML = `${symHTML} = ${valText}`;
      resampleMeanEl.style.color = STAT_RESAMPLE_TEXT;
      resampleMeanEl.style.fontWeight = '700';

      // Orange highlight class for +1 (used by dot-drop animation source)
      resampleMeanEl.classList.remove('highlight-last');
      if (highlightStat) {
        void resampleMeanEl.offsetWidth;
        resampleMeanEl.classList.add('highlight-last');
      }

      // Update the label span: just "Resample" in the default color
      const statLabelEl = document.getElementById('resample-stat-label');
      if (statLabelEl) {
        statLabelEl.textContent = config.mode === 'randomization' ? 'Shuffled' : 'Resample';
      }
    }
    // Mechanism description: summarize what "with replacement" did
    if (mechanismDescEl) {
      if (config.proportion && !config.twoGroup) {
        const origS = data1.filter(v => v === 1).length;
        const resampS = resampleValues.filter(v => v === 1).length;
        const diff = resampS - origS;
        const sign = diff > 0 ? '+' : '';
        mechanismDescEl.textContent =
          `successes changed by ${diff < 0 ? '\u2212' : sign}${Math.abs(diff)}`;
      } else {
        let notSelected = 0;
        let repeated = 0;
        for (const { drawn } of allocateDrawCounts(resampleSourceValues(), resampleValues)) {
          if (drawn === 0) notSelected++;
          if (drawn > 1) repeated++;
        }
        mechanismDescEl.textContent =
          `${repeated} drawn more than once · ${notSelected} not selected`;
      }
      mechanismDescEl.hidden = false;
    }

    return animMs;
  }

  /**
   * Summary view: chips (small n) or text counts (large n).
   * @param {number[]} resampleValues
   * @param {boolean} [stagger=false] - Animate chips appearing sequentially (+1 only)
   * @returns {number} Total animation duration in ms (0 if no animation)
   */
  /**
   * The values a resample is actually drawn from.
   *
   * On a paired page that is the differences, not `data1` — `data1` holds one
   * of the two raw variables, which the resample never touches. Three readouts
   * needed this and only one had it, so a 200-pair dataset reported "30 not
   * selected, 0 selected once, 0 selected twice": 30 being the number of
   * distinct read-scores, none of which appear among the resampled differences,
   * so every lookup missed. (Todd Will, 2026-09-27.)
   *
   * @returns {number[]}
   */
  function resampleSourceValues() {
    return (config.paired && data2.length > 0)
      ? data2.map((v, i) => v - data1[i])
      : data1;
  }

  /**
   * How many times each ORIGINAL OBSERVATION was drawn.
   *
   * `resample()` returns values, not indices, so when a value appears in
   * several observations there is no fact about which of them was drawn. The
   * chips settle it by allocating a value's draws evenly across the positions
   * holding it, and this returns exactly that allocation so the chips, the
   * text tally and the caption all describe the same picture — and so the
   * tally sums to n, which counting distinct VALUES did not.
   *
   * @param {number[]} origValues
   * @param {number[]} resampleValues
   * @returns {{ value: number, drawn: number }[]} sorted ascending by value
   */
  function allocateDrawCounts(origValues, resampleValues) {
    // When the draw recorded WHICH observations it took, there is nothing to
    // allocate — count them. The order matches the chips, which sort ascending.
    if (lastResampleIndices && lastResampleIndices.length === resampleValues.length) {
      const drawn = new Array(origValues.length).fill(0);
      for (const j of lastResampleIndices) {
        if (j >= 0 && j < drawn.length) drawn[j]++;
      }
      return origValues
        .map((value, i) => ({ value, drawn: drawn[i] }))
        .sort((a, b) => a.value - b.value);
    }
    /** @type {Map<number, number>} */
    const remaining = new Map();
    for (const v of resampleValues) remaining.set(v, (remaining.get(v) ?? 0) + 1);
    const sorted = [...origValues].sort((a, b) => a - b);
    /** @type {Map<number, number>} */
    const positionsLeft = new Map();
    for (const v of sorted) positionsLeft.set(v, (positionsLeft.get(v) ?? 0) + 1);
    return sorted.map((v) => {
      const rem = remaining.get(v) ?? 0;
      const pLeft = positionsLeft.get(v) ?? 1;
      const drawn = Math.ceil(rem / pLeft);
      remaining.set(v, rem - drawn);
      positionsLeft.set(v, pLeft - 1);
      return { value: v, drawn };
    });
  }

  function showResampleSummary(resampleValues, stagger = false) {
    resampleContentEl.innerHTML = '';

    // Proportion mode: use proportion bar (same as histogram view)
    if (config.proportion && !config.twoGroup) {
      return showResamplePropBar(resampleValues, stagger);
    }

    const origValues = resampleSourceValues();

    // Should we animate the stagger? Only for small n on +1, with motion allowed
    const shouldStagger = stagger && origValues.length <= CHIP_THRESHOLD && !prefersReducedMotion();

    // Get original chips for draw-link flash animation
    const origChips = shouldStagger && originalContentEl
      ? /** @type {HTMLElement[]} */ ([...originalContentEl.querySelectorAll('.sample-dot')])
      : [];

    if (origValues.length <= CHIP_THRESHOLD) {
      const container = document.createElement('div');
      container.className = 'sample-dots';
      container.setAttribute('role', 'img');
      container.setAttribute('aria-label', 'Bootstrap resample values');
      // The same allocation the text tally and the caption use, so all three
      // describe one picture.
      const alloc = allocateDrawCounts(origValues, resampleValues);

      /** @type {{dot: HTMLElement, chipIdx: number}[]} */
      const drawnChips = [];
      /** @type {HTMLElement[]} */
      const notDrawnChips = [];
      for (let chipIdx = 0; chipIdx < alloc.length; chipIdx++) {
        const { value: v, drawn: allocated } = alloc[chipIdx];
        const dot = document.createElement('span');
        dot.className = 'sample-dot';
        if (config.proportion) {
          dot.classList.add(v === 1 ? 'sample-dot--success' : 'sample-dot--failure');
        }
        if (allocated === 0) {
          dot.classList.add('not-drawn');
        } else if (allocated > 1) {
          dot.classList.add('multi-drawn');
        }
        dot.textContent = config.proportion ? (v === 1 ? 'S' : 'F') : formatChipValue(v);
        dot.title = allocated === 0 ? 'Not selected'
          : allocated === 1 ? 'Selected once'
          : `Selected ${allocated} times`;
        if (allocated > 1) {
          const badge = document.createElement('sup');
          badge.className = 'draw-count';
          badge.textContent = `\u00d7${allocated}`;
          dot.appendChild(badge);
        }
        // Stagger: hide chip initially, animate a flying dot from original → resample
        if (shouldStagger && allocated > 0) {
          dot.classList.add('chip-hidden');
          drawnChips.push({ dot, chipIdx });
        } else if (shouldStagger && allocated === 0) {
          dot.classList.add('chip-hidden');
          notDrawnChips.push(dot);
        }
        container.appendChild(dot);
      }
      resampleContentEl.appendChild(container);

      // Animate flying dots from original → resample chips
      if (shouldStagger && drawnChips.length > 0) {
        const STAGGER_MS = 60;  // time between each draw
        const FLIGHT_MS = 250;  // flight duration
        for (let i = 0; i < drawnChips.length; i++) {
          const { dot, chipIdx } = drawnChips[i];
          const origChip = origChips[chipIdx];
          const delay = i * STAGGER_MS;

          setTimeout(() => {
            // Flash the source chip
            if (origChip) {
              origChip.classList.add('chip-source-flash');
              setTimeout(() => origChip.classList.remove('chip-source-flash'), 400);

              // Create flying dot
              const origRect = origChip.getBoundingClientRect();
              const destRect = dot.getBoundingClientRect();
              const flyer = document.createElement('span');
              flyer.className = 'chip-flyer';
              flyer.textContent = dot.textContent.replace(/×\d+$/, ''); // strip badge text
              flyer.style.left = origRect.left + 'px';
              flyer.style.top = origRect.top + 'px';
              flyer.style.width = origRect.width + 'px';
              flyer.style.height = origRect.height + 'px';
              document.body.appendChild(flyer);

              // Force reflow then animate to destination
              void flyer.offsetHeight;
              flyer.style.transition = `left ${FLIGHT_MS}ms cubic-bezier(0.4, 0, 0.2, 1), top ${FLIGHT_MS}ms cubic-bezier(0.4, 0, 0.2, 1), opacity ${FLIGHT_MS * 0.3}ms ease ${FLIGHT_MS * 0.7}ms`;
              flyer.style.left = destRect.left + 'px';
              flyer.style.top = destRect.top + 'px';
              flyer.style.opacity = '0';

              // On arrival: reveal the actual chip, remove the flyer
              setTimeout(() => {
                dot.classList.remove('chip-hidden');
                dot.classList.add('chip-appear');
                flyer.remove();
              }, FLIGHT_MS);
            } else {
              // No original chip (shouldn't happen) — just reveal
              dot.classList.remove('chip-hidden');
              dot.classList.add('chip-appear');
            }
          }, delay);
        }

        // Not-drawn chips fade in after all flights complete
        const notDrawnDelay = drawnChips.length * STAGGER_MS + FLIGHT_MS + 50;
        for (const ndot of notDrawnChips) {
          setTimeout(() => ndot.classList.remove('chip-hidden'), notDrawnDelay);
        }
        return notDrawnDelay + 150; // total animation duration
      }
      return 0;
    } else {
      let notSelected = 0, once = 0, twice = 0, threeOrMore = 0;
      for (const { drawn } of allocateDrawCounts(origValues, resampleValues)) {
        if (drawn === 0) notSelected++;
        else if (drawn === 1) once++;
        else if (drawn === 2) twice++;
        else threeOrMore++;
      }
      const summary = document.createElement('div');
      summary.className = 'resample-summary';
      summary.innerHTML = `
        <div class="resample-bar">
          <span class="rs-chip not-drawn">${notSelected} not selected</span>
          <span class="rs-chip">${once} selected once</span>
          <span class="rs-chip multi-drawn">${twice} selected twice</span>
          ${threeOrMore > 0 ? `<span class="rs-chip multi-drawn">${threeOrMore} selected 3+ times</span>` : ''}
        </div>
      `;
      resampleContentEl.appendChild(summary);
    }
    return 0;
  }

  /**
   * Histogram view: mini histogram of the resample values.
   * When origHistCache is available and morph=true, uses shared bin edges
   * and transitions bars from original heights to resample heights, with
   * brief color highlights on bars that grew or shrank.
   * Also draws a dashed mean line on the resample histogram.
   * @param {number[]} resampleValues
   * @param {boolean} [morph=false] - Animate bar morph from original heights (+1 only)
   * @returns {number} Animation duration in ms (0 if no morph)
   */
  /**
   * Show resample as a proportion bar with morph animation from original proportions.
   * @param {number[]} resampleValues
   * @param {boolean} [animate=false] - Animate bar width transition (+1 only)
   * @returns {number} Animation duration in ms
   */
  function showResamplePropBar(resampleValues, animate = false) {
    // B2 prototype: render the resample as marbles/dots; on +1, animate the
    // draw-with-replacement from the bag (marbles fill from the two ends).
    if (useNewPropMech && resampleContentEl) {
      // The indices are what let the bag say which observations were drawn, and
      // how many times. The grid animation never asked for them.
      return showPropResample(resampleContentEl, originalContentEl, resampleValues, data1,
        { style: propMechStyle, animate, indices: lastResampleIndices ?? undefined, delta: false });
    }
    const successes = resampleValues.filter(v => v === 1).length;
    const failures = resampleValues.length - successes;
    const pHat = mean(resampleValues);
    const pct = (pHat * 100).toFixed(1);

    const shouldAnimate = animate && origPropCache && !prefersReducedMotion();
    const origPct = origPropCache ? (origPropCache.pHat * 100).toFixed(1) : pct;

    const container = document.createElement('div');
    container.className = 'prop-bar-wrap';
    container.setAttribute('role', 'img');
    container.setAttribute('aria-label', `Resample: ${successes} successes, ${failures} failures`);

    const fill = document.createElement('div');
    fill.className = 'mech-prop-fill';
    // Start at original width if animating, else jump to final
    fill.style.width = shouldAnimate ? `${origPct}%` : `${pct}%`;

    const bar = document.createElement('div');
    bar.className = 'mech-prop-bar mech-prop-bar-lg';
    bar.appendChild(fill);

    const labelL = document.createElement('span');
    labelL.className = 'mech-prop-label-left';
    labelL.textContent = `${successes} S`;
    bar.appendChild(labelL);

    const labelR = document.createElement('span');
    labelR.className = 'mech-prop-label-right';
    labelR.textContent = `${failures} F`;
    bar.appendChild(labelR);

    container.appendChild(bar);
    resampleContentEl.appendChild(container);

    const MORPH_MS = 400;
    const GHOST_PAUSE = 200;
    if (shouldAnimate) {
      // Ghost: show original proportion at low opacity
      bar.style.opacity = '0.25';

      // Hide stat text and labels during ghost phase
      const mechStatEl = resampleMeanEl?.closest('.mechanism-stat');
      if (mechStatEl) {
        /** @type {HTMLElement} */ (mechStatEl).style.opacity = '0';
        /** @type {HTMLElement} */ (mechStatEl).style.transition = 'opacity 250ms ease';
      }
      labelL.style.opacity = '0';
      labelR.style.opacity = '0';

      // After ghost pause, solidify and morph
      setTimeout(() => {
        bar.style.transition = `opacity ${MORPH_MS}ms ease`;
        bar.style.opacity = '1';
        fill.style.transition = `width ${MORPH_MS}ms ease-out`;
        fill.style.width = `${pct}%`;

        // Update and reveal labels + stat text after morph
        labelL.textContent = `${successes} S`;
        labelR.textContent = `${failures} F`;
        labelL.style.transition = 'opacity 200ms ease';
        labelR.style.transition = 'opacity 200ms ease';
        labelL.style.opacity = '1';
        labelR.style.opacity = '1';

        if (mechStatEl) {
          setTimeout(() => {
            /** @type {HTMLElement} */ (mechStatEl).style.opacity = '1';
          }, MORPH_MS);
        }
      }, GHOST_PAUSE);

      return GHOST_PAUSE + MORPH_MS + 250;
    }
    return 0;
  }

  function showResampleHistogram(resampleValues, morph = false) {
    resampleContentEl.innerHTML = '';

    // Proportion mode: use proportion bar instead of histogram
    if (config.proportion && !config.twoGroup) {
      return showResamplePropBar(resampleValues, morph);
    }

    // Small mean samples — animated dotplot resample, via the shared mechanism.
    if (meanDotActive()) {
      meanMech.setView('dotplot');
      // A sign flip is not a draw with replacement, so it gets the display
      // without the pluck-and-fly.
      const drawn = morph && config.mode === 'bootstrap';
      return meanMech.renderResample(resampleContentEl, resampleSourceValues(), resampleValues,
        mean(resampleValues), drawn, {
          domain: meanDomain ?? computeMeanDomain() ?? undefined,
          meanLabel: config.paired ? 'd̄' : 'x̄',
          indices: lastResampleIndices ?? undefined,
          ...tierDotGeometry(),
        });
    }

    const container = document.createElement('div');
    container.className = 'mini-chart';

    const shouldMorph = morph && origHistCache && !prefersReducedMotion();
    const nBins = origHistCache ? origHistCache.numBins : Math.min(Math.ceil(Math.sqrt(resampleValues.length)), 40);
    // Use same thresholds as original so bars align for visual comparison
    const thresholds = origHistCache ? origHistCache.thresholds : undefined;

    const result = drawHistogram(container, resampleValues, {
      id: 'resample-hist',
      xLabel: '',
      titleText: 'Bootstrap resample distribution',
      numBins: nBins,
      thresholds,
      animate: false,
      margin: { top: 5, right: 12, bottom: 44, left: 48 },
      viewHeight: MINI_VIEW_H,
      showExport: false,
    });
    resampleContentEl.appendChild(container);

    // Draw resample statistic line on the histogram (dashed orange)
    // When morphing, start hidden and reveal after bars finish transitioning
    /** @type {SVGElement|null} */
    let meanLineGroup = null;
    if (result && result.xScale && result.frame) {
      const stat = getBootstrapStat();
      const resampleVal = stat.fn(resampleValues);
      const xPos = result.xScale(resampleVal);
      const fh = result.frame.height;
      const overlays = d3Selection.select(result.frame.inner).select('.overlays');
      const g = overlays.append('g')
        .attr('class', 'resample-mean-group')
        .style('opacity', shouldMorph ? '0' : '1');
      meanLineGroup = /** @type {SVGElement} */ (g.node());
      g.append('line')
        .attr('x1', xPos).attr('x2', xPos)
        .attr('y1', 0).attr('y2', fh)
        .attr('stroke', STAT_RESAMPLE)
        .attr('stroke-width', 3)
        .attr('stroke-dasharray', '6,3');
      // Symbol label below x-axis, centered on the dashed line
      const statKey = bootStatSelect?.value ?? 'mean';
      const labelY = fh + 22;
      const fontSize = 1.15; // em
      if (statKey === 'mean' && !config.proportion) {
        // Draw x with a manually positioned overline (combining char is unreliable in SVG)
        const xText = g.append('text')
          .attr('x', xPos).attr('y', labelY)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .attr('fill', STAT_RESAMPLE_TEXT)
          .attr('stroke', 'white')
          .attr('stroke-width', 3)
          .attr('paint-order', 'stroke')
          .attr('font-size', `${fontSize}em`)
          .attr('font-weight', '700')
          .text('x');
        // Overline: white shadow for contrast, then colored bar
        const barY = labelY - 9;
        g.append('line')
          .attr('x1', xPos - 7).attr('x2', xPos + 7)
          .attr('y1', barY).attr('y2', barY)
          .attr('stroke', 'white')
          .attr('stroke-width', 5)
          .attr('stroke-linecap', 'round');
        g.append('line')
          .attr('x1', xPos - 6).attr('x2', xPos + 6)
          .attr('y1', barY).attr('y2', barY)
          .attr('stroke', STAT_RESAMPLE_TEXT)
          .attr('stroke-width', 2)
          .attr('stroke-linecap', 'round');
      } else {
        const sym = config.proportion ? 'p\u0302'
          : statKey === 'median' ? 'M\u0303'
          : statKey === 'sd' ? 's' : stat.label.split(' ').pop() || '';
        g.append('text')
          .attr('x', xPos).attr('y', labelY)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .attr('fill', STAT_RESAMPLE_TEXT)
          .attr('stroke', 'white')
          .attr('stroke-width', 3)
          .attr('paint-order', 'stroke')
          .attr('font-size', `${fontSize}em`)
          .attr('font-weight', '700')
          .text(sym);
      }
    }

    if (!shouldMorph || !result || !origHistCache) return 0;

    // Past the dot limit the resample is bars, so the draw is animated as bars:
    // every bar of the SOURCE leaves as a ghost, travels to the resample panel
    // (which starts blank), solidifies on the way, and lands at the height the
    // resample actually gave that bin — taller if it came up more often than
    // its share, shorter if less. Then the bars gather into x̄*, which is handed
    // to the same drop animation a dot would be. (Jeff's design, 2026-09-28.)
    //
    // This replaces the in-place morph below, which grew the bars from the
    // original heights without anything travelling between the two panels.
    const srcSvg = originalContentEl?.querySelector('svg') ?? null;
    const tgtSvg = container.querySelector('svg');
    if (srcSvg && tgtSvg) {
      const ms = animateHistogramDraw({ sourceSvg: srcSvg, targetSvg: tgtSvg, n: resampleValues.length });
      if (ms) {
        if (meanLineGroup) {
          setTimeout(() => { /** @type {SVGElement} */ (meanLineGroup).style.opacity = '1'; }, ms - 700);
        }
        const statEl = resampleMeanEl?.closest('.mechanism-stat');
        if (statEl) {
          /** @type {HTMLElement} */ (statEl).style.opacity = '0';
          /** @type {HTMLElement} */ (statEl).style.transition = 'opacity 250ms ease';
          setTimeout(() => { /** @type {HTMLElement} */ (statEl).style.opacity = '1'; }, ms - 500);
        }
        return ms;
      }
    }

    // Hide the resample stat text during morph — it will be revealed after bars finish
    const mechStatEl = resampleMeanEl?.closest('.mechanism-stat');
    if (mechStatEl) {
      /** @type {HTMLElement} */ (mechStatEl).style.opacity = '0';
      /** @type {HTMLElement} */ (mechStatEl).style.transition = 'opacity 250ms ease';
    }

    // Build a map of original bin counts keyed by bin x0
    /** @type {Map<number, number>} */
    const origCounts = new Map();
    for (const b of origHistCache.bins) {
      origCounts.set(b.x0, b.length);
    }

    // Morph animation using CSS transitions on SVG rect attributes
    const svg = container.querySelector('svg');
    if (!svg) return 0;
    const rects = /** @type {SVGRectElement[]} */ ([...svg.querySelectorAll('.data rect')]);
    const { yScale, frame } = result;
    if (!yScale || !frame) return 0;
    const innerHeight = frame.height;

    const MORPH_MS = 450;
    const FADE_MS = 600;
    const GROW_FILL = '#2A6496'; // dark blue — bar grew (more values landed here)
    const SHRINK_FILL = '#B8D4E8'; // light blue — bar shrank (fewer values here)
    const DEFAULT_FILL = '#569BBD80';

    // Record final (resample) positions, then snap to original positions as ghost
    /** @type {Array<{rect: SVGRectElement, finalY: string, finalH: string, grew: boolean, shrank: boolean}>} */
    const morphData = [];

    for (const rect of rects) {
      const finalY = rect.getAttribute('y') || '0';
      const finalH = rect.getAttribute('height') || '0';

      // Parse bin x0 from the aria-label ("x0 to x1: count")
      const label = rect.getAttribute('aria-label') || '';
      const x0Match = label.match(/^([\d.e+-]+)\s+to/);
      const x0 = x0Match ? parseFloat(x0Match[1]) : NaN;

      const origCount = isNaN(x0) ? 0 : (origCounts.get(x0) ?? 0);
      const resampleBin = result.bins.find(b => Math.abs(b.x0 - x0) < 1e-10);
      const newCount = resampleBin ? resampleBin.length : 0;
      const grew = newCount > origCount;
      const shrank = newCount < origCount;

      // Snap bar to original height
      const origY = origCount > 0 ? yScale(origCount) : innerHeight;
      const origH = innerHeight - origY;
      rect.setAttribute('y', String(origY));
      rect.setAttribute('height', String(Math.max(0, origH)));

      morphData.push({ rect, finalY, finalH, grew, shrank });
    }

    // Ghost: show bars at low opacity (faded copy of original)
    const GHOST_OPACITY = 0.25;
    const svgNode = /** @type {SVGSVGElement} */ (svg);
    svgNode.style.opacity = String(GHOST_OPACITY);

    /** @type {Array<{rect: SVGRectElement, startY: number, startH: number, endY: number, endH: number, grew: boolean, shrank: boolean}>} */
    const animItems = morphData.map(({ rect, finalY, finalH, grew, shrank }) => ({
      rect,
      startY: parseFloat(rect.getAttribute('y') || '0'),
      startH: parseFloat(rect.getAttribute('height') || '0'),
      endY: parseFloat(finalY),
      endH: parseFloat(finalH),
      grew, shrank,
    }));

    // Delay morph start so ghost is visible briefly while dots fly
    const GHOST_PAUSE = 200;
    setTimeout(() => {
      // Apply highlight colors at morph start
      for (const { rect, grew, shrank } of animItems) {
        if (grew) rect.setAttribute('fill', GROW_FILL);
        else if (shrank) rect.setAttribute('fill', SHRINK_FILL);
      }

      const startTime = performance.now();
      /** Ease-out cubic */
      function easeOut(/** @type {number} */ t) { return 1 - Math.pow(1 - t, 3); }

      function morphFrame(/** @type {number} */ now) {
        const elapsed = now - startTime;
        const t = Math.min(1, elapsed / MORPH_MS);
        const e = easeOut(t);

        // Morph bar geometry
        for (const { rect, startY, startH, endY, endH } of animItems) {
          const y = startY + (endY - startY) * e;
          const h = startH + (endH - startH) * e;
          rect.setAttribute('y', String(y));
          rect.setAttribute('height', String(Math.max(0, h)));
        }

        // Solidify: ghost opacity → full opacity during morph
        const opacity = GHOST_OPACITY + (1 - GHOST_OPACITY) * e;
        svgNode.style.opacity = String(opacity);

        if (t < 1) {
          requestAnimationFrame(morphFrame);
        } else {
          svgNode.style.opacity = '1';
          // Morph complete — reveal the mean line and stat text, then fade bar colors
          if (meanLineGroup) {
            meanLineGroup.style.transition = 'opacity 250ms ease';
            meanLineGroup.style.opacity = '1';
          }
          if (mechStatEl) {
            /** @type {HTMLElement} */ (mechStatEl).style.opacity = '1';
          }
          fadeColors();
        }
      }
      requestAnimationFrame(morphFrame);
    }, GHOST_PAUSE);

    function fadeColors() {
      // SVG fill IS a CSS presentation property, so CSS transition works here
      for (const { rect, grew, shrank } of animItems) {
        if (!grew && !shrank) continue;
        rect.style.transition = `fill ${FADE_MS}ms ease`;
        rect.setAttribute('fill', DEFAULT_FILL);
      }
      setTimeout(() => {
        for (const { rect } of animItems) {
          rect.style.transition = '';
        }
      }, FADE_MS);
    }

    // Return time until dot should drop: ghost pause + morph + brief pause after mean line
    // (color fade continues in background but shouldn't delay the dot drop)
    return GHOST_PAUSE + MORPH_MS + 300;
  }

  /**
   * Display paired randomization mechanism: original diffs → sign-flipped diffs.
   * Shows which differences had their sign flipped, with a clear visual indicator.
   * @param {number[]} originalDiffs - The original paired differences
   * @param {number[]} flippedDiffs - The sign-flipped differences
   * @param {boolean} highlightStat - Whether to highlight the resulting statistic
   */
  function showPairedMechanism(originalDiffs, flippedDiffs, highlightStat) {
    if (!resampleContentEl || !bootstrapSampleEl) return;
    bootstrapSampleEl.hidden = false;

    resampleContentEl.innerHTML = '';

    // Dots lead, as everywhere else. The flip chips stay one click away under
    // Tiles, and they are not a lesser view here: they say WHICH differences
    // flipped, with a ± on each, which is the one thing a dotplot of the
    // flipped values cannot show. (Jeff, 2026-10-02.)
    if (meanDotActive()) {
      meanMech.setView('dotplot');
      meanMech.renderResample(resampleContentEl, originalDiffs, flippedDiffs,
        mean(flippedDiffs), false, {
          domain: meanDomain ?? computeMeanDomain() ?? undefined,
          meanLabel: 'd̄*', label: 'Sign-flipped differences',
          ...tierDotGeometry(),
        });
      return;
    }

    if (originalDiffs.length <= CHIP_THRESHOLD) {
      // Small n: show aligned chips with flip indicators
      const container = document.createElement('div');
      container.className = 'sample-dots paired-flip-dots';
      container.setAttribute('role', 'img');
      container.setAttribute('aria-label', 'Sign-flipped differences');

      const shouldAnimate = highlightStat && !prefersReducedMotion();
      for (let i = 0; i < flippedDiffs.length; i++) {
        const orig = originalDiffs[i];
        const flipped = flippedDiffs[i];
        const wasFlipped = Math.sign(orig) !== 0 && Math.sign(orig) !== Math.sign(flipped);

        const dot = document.createElement('span');
        dot.className = 'sample-dot' + (wasFlipped ? ' sign-flipped' : '');
        dot.textContent = formatChipValue(flipped);
        dot.title = wasFlipped
          ? `${formatChipValue(orig)} → ${formatChipValue(flipped)} (flipped)`
          : `${formatChipValue(orig)} (kept)`;
        if (wasFlipped) {
          const badge = document.createElement('sup');
          badge.className = 'flip-badge';
          badge.textContent = '\u00b1';
          dot.appendChild(badge);
          // Animate: scaleX flip with stagger
          if (shouldAnimate) {
            dot.style.animationDelay = `${i * 20}ms`;
            dot.classList.add('chip-flip');
          }
        }
        container.appendChild(dot);
      }
      resampleContentEl.appendChild(container);
    } else {
      // Large n: summary counts
      let flippedCount = 0;
      let keptCount = 0;
      for (let i = 0; i < originalDiffs.length; i++) {
        const wasFlipped = Math.sign(originalDiffs[i]) !== 0
          && Math.sign(originalDiffs[i]) !== Math.sign(flippedDiffs[i]);
        if (wasFlipped) flippedCount++;
        else keptCount++;
      }
      const summary = document.createElement('div');
      summary.className = 'resample-summary';
      summary.innerHTML = `
        <div class="resample-bar">
          <span class="rs-chip">${keptCount} kept original sign</span>
          <span class="rs-chip sign-flipped">${flippedCount} sign flipped</span>
        </div>
      `;
      resampleContentEl.appendChild(summary);
    }

    // Update stat value: "Shuffled" (dark) + "x̄ = value" (orange)
    if (resampleMeanEl) {
      const resampleVal = mean(flippedDiffs);
      const valText = formatStat(resampleVal, dataPrecision);
      resampleMeanEl.innerHTML = `<span class="x-bar">x</span> = ${valText}`;
      resampleMeanEl.style.color = STAT_RESAMPLE_TEXT;
      resampleMeanEl.style.fontWeight = '700';
      resampleMeanEl.classList.remove('highlight-last');
      if (highlightStat) {
        void resampleMeanEl.offsetWidth;
        resampleMeanEl.classList.add('highlight-last');
      }
      const statLabelEl = document.getElementById('resample-stat-label');
      if (statLabelEl) statLabelEl.textContent = 'Shuffled';
    }

    // Mechanism description
    if (mechanismDescEl) {
      let flippedCount = 0;
      for (let i = 0; i < originalDiffs.length; i++) {
        if (Math.sign(originalDiffs[i]) !== 0
            && Math.sign(originalDiffs[i]) !== Math.sign(flippedDiffs[i])) {
          flippedCount++;
        }
      }
      mechanismDescEl.textContent =
        `Randomly flip signs · ${flippedCount} of ${originalDiffs.length} differences flipped`;
      mechanismDescEl.hidden = false;
    }
  }

  // Replace single toggle button with segmented control
  /** @type {HTMLButtonElement|null} */
  let btnSummary = null;
  /** @type {HTMLButtonElement|null} */
  let btnHistogram = null;

  /**
   * Switch resample view mode and update toggle UI.
   * @param {'summary'|'histogram'} mode
   */
  function setResampleViewMode(mode) {
    resampleViewMode = mode;
    if (btnSummary) btnSummary.setAttribute('aria-pressed', String(mode === 'summary'));
    if (btnHistogram) btnHistogram.setAttribute('aria-pressed', String(mode === 'histogram'));
    syncRenderingToggle();
    // B1: the mean dotplot view shows the original as a dotplot too — re-render
    // it so the bag/tiles switch with the view. `usesMeanMech`, not
    // `isMeanOneSample`: paired is on this mechanism now, and testing the
    // narrower flag left it showing whatever Step 1 had rendered a moment
    // before the view changed. (2026-10-02.)
    // Unconditional: Step 1 changes with the role on every page that has one
    // (paired's tiles become a histogram too), and the two-group pages have no
    // `originalContentEl`, so this is a no-op there rather than a special case.
    renderOriginalSample();
    // The paired randomization panel draws itself — its Tiles view is the flip
    // chips, with a ± on each difference that changed sign, which the generic
    // resample renderer knows nothing about. Switching the view used to hand it
    // to that renderer and the badges vanished. (2026-10-02.)
    if (config.paired && config.mode === 'randomization' && lastResample.length) {
      showPairedMechanism(lastPairedOriginal, lastResample, false);
      return;
    }
    // Statically. This passed `lastWasSingle`, so switching the view re-ran the
    // whole +1 animation — dots flying out of a panel nobody had asked to
    // resample, and a statistic setting off for the chart from geometry that
    // had just been replaced, which is what sent it to the top-left corner.
    // Changing how something is drawn is not an event in the simulation.
    // (Jeff, 2026-10-02.)
    if (lastResample.length > 0) showResample(lastResample, false, false, false);
  }

  // Proportions have nothing to toggle between. `showResampleSummary` and
  // `showResampleHistogram` both hand a one-sample proportion to
  // `showResamplePropBar`, and a two-group one to `showTwoPropResample`, so the
  // control sat on the page changing an `aria-pressed` and re-rendering the
  // identical panel. (The comment at the view default already said as much —
  // "Proportions use proportion bars in both views, so they are left alone" —
  // without anyone taking the next step and removing the control.) These pages
  // have their own Grid | Bar toggle, which is the one that does something.
  // (Jeff, 2026-10-01: "we still have the tiles | histogram toggle that doesn't
  // seem wired to anything".)
  // The bottom-bar control is now ONLY the choice of rendering inside the
  // individual role — Dots or Tiles — which exists on the one-sample mean and
  // nowhere else. On every other quantitative page "Tiles | Histogram" was the
  // ROLE choice wearing the names of its two pictures, and that has moved to
  // the View control beside Step 1, where the proportion pages keep theirs.
  // (Jeff, 2026-10-02.)
  const viewToggleIsLive = !config.proportion && !config.twoGroup
    && (config.mode === 'bootstrap' || config.paired);
  /** Hide the rendering choice when the role it belongs to is not showing. */
  let syncRenderingToggle = () => {};
  if (resampleToggle) {
    const seg = document.createElement('div');
    seg.className = 'seg-control';
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Resample view');

    btnHistogram = /** @type {HTMLButtonElement} */ (document.createElement('button'));
    btnHistogram.type = 'button';
    btnHistogram.textContent = 'Dots';
    btnHistogram.setAttribute('aria-pressed', 'true');

    btnSummary = /** @type {HTMLButtonElement} */ (document.createElement('button'));
    btnSummary.type = 'button';
    btnSummary.textContent = 'Tiles';
    btnSummary.setAttribute('aria-pressed', 'false');

    if (viewToggleIsLive) {
      // Dots leads: it is what the resample looks like and what hands its mean
      // to the distribution. Tiles say WHICH values were drawn and how often,
      // which is the second question, so it is one click away. (2026-09-27.)
      seg.appendChild(btnHistogram);
      seg.appendChild(btnSummary);
    }
    // NB: do NOT add the `mech-view-toggle` class — the data-load handler removes
    // that class for non-card datasets (it manages the prop Bars/Cards toggle).
    resampleToggle.remove();

    if (viewToggleIsLive) {
      btnSummary.addEventListener('click', () => { resampleViewExplicit = true; setResampleViewMode('summary'); });
      btnHistogram.addEventListener('click', () => { resampleViewExplicit = true; setResampleViewMode('histogram'); });
      // Aggregate has one rendering, so this choice goes away with the role
      // rather than sitting there meaning nothing.
      syncRenderingToggle = () => {
        placeStatRows(seg);
        const show = meanRole === 'individual' && individualAvailable();
        seg.hidden = !show;
        btnHistogram.setAttribute('aria-pressed', String(resampleViewMode !== 'summary'));
        btnSummary.setAttribute('aria-pressed', String(resampleViewMode === 'summary'));
      };
      syncRenderingToggle();
    }
  }

  // Re-render when the confidence level changes (box typing, or a preset pill).
  function applyCiLevel() {
    syncCiPills();
    syncMethodToggleLabel();
    if (allStats.length >= 10) {
      const ciLevel = getCiLevel();
      const result = bootstrapCI([...allStats], ciLevel);
      displayBootstrapResults(allStats, result.ci, result.se, ciLevel);
      const CI_MIN = 20;
      renderChart(allStats, allStats.length >= CI_MIN ? result.ci : null, computeObservedStat());
    }
  }
  if (ciSelect) {
    ciSelect.addEventListener('input', applyCiLevel);
    ciSelect.addEventListener('change', applyCiLevel);
  }
  if (ciPills) {
    ciPills.addEventListener('click', (e) => {
      const btn = /** @type {HTMLElement} */ (e.target).closest('button[data-level]');
      if (!btn || !ciSelect) return;
      ciSelect.value = btn.getAttribute('data-level') || '95';
      applyCiLevel();
    });
    syncCiPills();
  }

  // ─── CI method toggle (bootstrap only) ───
  // Percentile / ±z·SE / Both. This drives the WHOLE page — the interval drawn on
  // the bootstrap distribution, not just the number in the results box — so the
  // interval a student reads is the one they see.
  /** True while the normal-curve overlay is on only because the method asked for it. */
  let theoryAutoOn = false;

  /** @type {{syncPressed: (m: string) => void, syncLabel: (l: number) => void}|null} */
  let methodControl = null;

  if (config.mode === 'bootstrap' && ciSelect) {
    const ciPrimary = /** @type {HTMLElement|null} */ (ciSelect.closest('.ci-primary'));
    if (ciPrimary) {
      methodControl = createCiMethodControl(ciPrimary, {
        method: ciMethod, onChange: setCiMethod,
        pillMode,
        onPillMode: (/** @type {string} */ mode) => {
          if (mode === pillMode) return;
          pillMode = mode;
          methodControl?.syncPills(pillMode, ciMethod);
          syncUrl();
          // With its arguments. `renderChart()` bare draws an empty chart —
          // the distribution simply vanished on the first click of the new
          // control. (Jeff, 2026-10-04.) The method toggle beside it has always
          // passed them; this is the same redraw.
          renderChart(allStats, lastCI, lastObserved, lastDirection);
        },
      });
      methodControl.syncLabel(getCiLevel());
      // Honour the current statistic before the first render: a ?stat=median link
      // that also asked for ci_method=se must land on percentile, not the normal
      // approximation. This calls syncTheoryToMethod() itself.
      syncNormalApproxAvailability();
    }
  }

  /**
   * The normal approximation — the ±z·SE / Both CI methods and the fitted normal
   * curve — assumes the bootstrap statistic's sampling distribution is roughly
   * normal. The CLT gives that for the MEAN (and the difference in means), but the
   * bootstrap distribution of a median, SD, or quartile is often skewed, discrete,
   * or lumpy, so a normal approximation there teaches a method that doesn't hold.
   * Percentile is the honest interval for those, so we take the normal approximation
   * off the table entirely when the chosen statistic isn't the mean.
   */
  function normalApproxApplies() {
    return (bootStatSelect?.value ?? 'mean') === 'mean';
  }

  function syncNormalApproxAvailability() {
    const ok = normalApproxApplies();
    methodControl?.setNormalAvailable(ok);
    if (theoryCheckbox) {
      theoryCheckbox.disabled = !ok;
      theoryCheckbox.closest('.theory-toggle')?.classList.toggle('is-disabled', !ok);
    }
    if (!ok) {
      // Fall back to percentile and drop any normal-curve overlay the previous
      // statistic (or a URL param) had switched on. BCa is left alone — it's
      // valid for any statistic, not just the mean.
      if (ciMethod === 'se' || ciMethod === 'both') setCiMethod('percentile');
      if (theoryOverlayOn) {
        theoryOverlayOn = false;
        theoryAutoOn = false;
        if (theoryCheckbox) theoryCheckbox.checked = false;
        if (chartContainer) removeTheoryOverlay(chartContainer);
      }
    } else {
      // Mean again: let the method drive the overlay as usual.
      syncTheoryToMethod();
    }
  }

  /** @param {string} method */
  function setCiMethod(method) {
    if (method === ciMethod) return;
    ciMethod = method;
    methodControl?.syncPressed(ciMethod);
    // ±SE has nothing for the plot-label choice to decide, so the control goes
    // dead there rather than offering a setting that does nothing.
    methodControl?.syncPills(pillMode, ciMethod);
    syncTheoryToMethod();
    if (lastBoot) {
      displayBootstrapResults(lastBoot.stats, lastBoot.ci, lastBoot.se, lastBoot.ciLevel);
      renderChart(allStats, lastCI, lastObserved, lastDirection);
    }
    announce(method === 'percentile' ? 'Percentile method.'
      : method === 'se' ? 'Normal-approximation method: estimate ± z · SE.'
      : method === 'bca' ? 'BCa method: the percentile interval corrected for bias and skew.'
      : 'Showing both the percentile and the normal-approximation interval.');
  }

  /** The ±SE button reads "±2 SE" at 95% and "±z SE" elsewhere. */
  function syncMethodToggleLabel() {
    methodControl?.syncLabel(getCiLevel());
  }

  /**
   * The normal approximation only makes sense next to a fitted normal curve, so
   * turn the theory overlay on with it — and take it back off when we return to
   * the percentile method, unless the student had switched it on themselves.
   */
  function syncTheoryToMethod() {
    // Only the normal-approximation methods pair with the fitted normal curve.
    // Percentile and BCa are read off the bootstrap distribution itself.
    const want = ciMethod === 'se' || ciMethod === 'both';
    if (want && !theoryOverlayOn) {
      theoryOverlayOn = true;
      theoryAutoOn = true;
      if (theoryCheckbox) theoryCheckbox.checked = true;
    } else if (!want && theoryAutoOn) {
      theoryOverlayOn = false;
      theoryAutoOn = false;
      if (theoryCheckbox) theoryCheckbox.checked = false;
      if (chartContainer) removeTheoryOverlay(chartContainer);
    }
  }

  // Reset when bootstrap stat changes (mixing stats would be meaningless)
  if (bootStatSelect) {
    bootStatSelect.addEventListener('change', () => {
      // The normal approximation is offered only for the mean; recheck first so
      // the ±SE/Both buttons and normal-curve toggle enable or disable to match.
      syncNormalApproxAvailability();
      if (allStats.length > 0) {
        resetSimulation();
        // Re-show original sample since data is still loaded
        if (data1.length > 0) {
          showDataLoaded();
        }
        const suffix = normalApproxApplies()
          ? ''
          : ' The normal approximation is unavailable for this statistic; showing the percentile interval.';
        announce(`Statistic changed to ${getBootstrapStat().label}. Simulation reset.${suffix}`);
      }
    });
  }

  /**
   * Format a value for display in a chip.
   * Uses fewer decimals for integers, more for precise values.
   * @param {number} v
   * @returns {string}
   */
  function formatChipValue(v) {
    if (Number.isInteger(v)) return String(v);
    return formatStat(v, dataPrecision);
  }

  // ─── Reset ───

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      resetSimulation();
      announce('Simulation reset.');
    });
  }

  function resetSimulation() {
  // Starting again lifts the cap.
  applySimulationCap(genBtns, 0, 'simulations');
    // A reset means "give me a clean tool", which includes a clean address bar.
    forgetSeed();
    allStats = [];
    rng = null;
    lockedDotGrid = null;
    mechanismInitialized = false;
    origHistCache = null;
    origPropCache = null;
    // New random seed each reset (unless URL-locked for graded work)
    if (!urlSeed) {
      seed = Math.random().toString(36).slice(2, 10);
    }
    chartContainer.innerHTML = '';
    resultDiv.innerHTML = `<p class="placeholder">${getTabHintText(getActiveTabId(), 'run a simulation to see results')}</p>`;
    if (resetBtn) resetBtn.hidden = true;
    if (bootstrapSampleEl) bootstrapSampleEl.hidden = true;
    if (mechResampleContent) mechResampleContent.innerHTML = '';
    if (mechanismDescEl) mechanismDescEl.hidden = true;
    // Hide mechanism strip (will re-show on next first generate)
    if (mechanismStrip) mechanismStrip.hidden = true;

    // …and the SOURCE side, which used to survive a reset.
    //
    // Switching datasets calls this. The resample panel was cleared and the
    // strip hidden, but the source panel kept the previous dataset's plot and
    // the mean mechanism kept its `bag` — a drawDotplot result pointing at an
    // SVG that was about to be replaced — along with the dot sizing and the
    // measured width fitted to the old sample. So the first +1 on the new
    // dataset animated from stale geometry: it drew from the old plot's dots
    // and the merged statistic flew off the left of the screen.
    // (Jeff, 2026-09-28, mammals n=54 → amtrak n=16.)
    if (originalContentEl) originalContentEl.innerHTML = '';
    if (resampleContentEl) resampleContentEl.innerHTML = '';
    // …and the TWO-GROUP source panel, which has its own id and was missed when
    // the one-sample panels were cleared on 2026-09-28. On the two-proportion
    // randomization test the strip is shown at data-load rather than deferred,
    // so switching to a dataset that path cannot handle left the previous
    // study's groups on screen — 11/50 and 14/40 still sitting under an Avandia
    // summary line — until a shuffle rebuilt them. (Jeff, 2026-10-01.)
    if (mechOriginalContent) mechOriginalContent.innerHTML = '';
    meanMech.resetSizing();
    mechG1.resetSizing();
    mechG2.resetSizing();
    lastResample = [];
    lastResampleIndices = null;
    lastRsIdx1 = null;
    lastRsIdx2 = null;
    meanDomain = null;
    // Anything still in the air belongs to the sample that just went away.
    dismissAirborneStat();
    clearDrawMarks(document);
  }

  // ─── Chart rendering ───

  // Resample panel title element (dynamic: "This Resample" vs "Last Resample")
  const resampleTitleEl = document.getElementById('resample-title');

  /**
   * @param {number[]} stats
   * @param {[number,number]} [ci]
   * @param {number} [observedStat]
   * @param {'left'|'right'|'both'} [direction]
   */
  /**
   * The observed statistic of the ORIGINAL sample — where the bootstrap
   * distribution centers. Pinning it on the chart counters the misconception
   * that the distribution centers on the population parameter (REQ-032, M6).
   * @returns {number|undefined}
   */
  function computeObservedStat() {
    if (config.mode !== 'bootstrap' || data1.length === 0) return undefined;
    if (config.paired && data2.length === data1.length && data2.length > 0) {
      return mean(data1.map((v, i) => data2[i] - v));
    }
    if (config.twoGroup && typeof config.testStat === 'function') {
      return config.testStat(data1, data2);
    }
    // Two-group bootstrap: the statistic is the DIFFERENCE, matching what each
    // resample computes (statFn(rs1) − statFn(rs2)). Falling through to
    // statFn(data1) drew the observed line at group 1's own mean/proportion —
    // far outside the bootstrap distribution it was supposed to sit in the middle of.
    if (config.twoGroup && data2.length > 0) {
      const statFn = getBootstrapStat().fn;
      return statFn(data1) - statFn(data2);
    }
    return getBootstrapStat().fn(data1);
  }

  /**
   * BCa bootstrap interval (expert-only method). Uses the SAME statistic that
   * generated the replicates (getBootstrapStat().fn) for the observed value and
   * the jackknife, so bias-correction and acceleration are consistent.
   * @param {number[]} stats - Bootstrap replicate statistics
   * @param {number} ciLevel
   * @returns {{ ci: [number,number], z0: number, a: number, fellBack: boolean } | null}
   */
  function computeBcaResult(stats, ciLevel) {
    if (config.mode !== 'bootstrap' || !stats || stats.length < 20) return null;
    const thetaHat = computeObservedStat();
    if (thetaHat == null) return null;
    const statFn = getBootstrapStat().fn;
    /** @type {number[]} */
    let jack;
    if (config.paired && data2.length === data1.length && data2.length > 0) {
      const diffs = data1.map((v, i) => data2[i] - v);
      jack = jackknife1(diffs, statFn);
    } else if (config.twoGroup && data2.length > 0) {
      // Jackknife over the pooled observations: leave out each point from its
      // own group and recompute the difference statistic.
      jack = [];
      const s2Full = statFn(data2);
      for (let i = 0; i < data1.length; i++) {
        jack.push(statFn(data1.filter((_, j) => j !== i)) - s2Full);
      }
      const s1Full = statFn(data1);
      for (let i = 0; i < data2.length; i++) {
        jack.push(s1Full - statFn(data2.filter((_, j) => j !== i)));
      }
    } else {
      jack = jackknife1(data1, statFn);
    }
    return bcaCI([...stats], thetaHat, jack, ciLevel);
  }

  /**
   * The step between values a discrete statistic can actually take, or `null`
   * when the statistic is continuous.
   *
   * A single proportion moves in steps of `1/n`. A difference of two moves in
   * steps of `1/n₁ + 1/n₂`: under the null a shuffle takes one success out of
   * one group and puts it in the other, so both proportions move at once.
   *
   * This used to be derived as `1 / round(n₁n₂/(n₁+n₂))`. The reciprocal of that
   * harmonic mean *is* `1/n₁ + 1/n₂` — exactly — but the rounding threw the
   * identity away: on 34 vs 16 it gives 1/11 = 0.0909 against a true step of
   * 0.0919, about 1% short. One bin off by 1% is invisible; eleven of them slip
   * an eighth of a bin, which is enough that some bins swallow two achievable
   * values and their neighbours catch none — the uneven gaps Jeff spotted on the
   * yawn data (2026-09-26). So: no rounding.
   *
   * @returns {number|null}
   */
  function discreteGridStep() {
    if (!config.proportion) return null;
    return proportionStep(data1.length, config.twoGroup ? data2.length : 0);
  }

  /**
   * Phase the dot grid against the observed statistic.
   *
   * `computeDots` snaps each value to the nearest bin CENTRE, and the grid's
   * origin was the pilot domain's left edge — nothing tied it to the observed,
   * or to anything else meaningful. So a shuffle just past the observed could
   * round down into a bin whose centre draws to the LEFT of the line, and the
   * dots a student counts beyond it disagreed with the p-value. Todd Will
   * counted one dot past the line where the p-value said 16.
   *
   * For a **discrete** statistic the fix is not a phase trick: the bin width is
   * the step between achievable values, so putting a centre on the observed —
   * itself achievable — lands every centre on an achievable value. One column
   * per outcome. Nothing straddles the line because nothing lies between the
   * outcomes, ties stand in their own column on the line, and the note under
   * the p-value says they count. This also fixes column mode, which colours by
   * bin centre: the centre is now a value the statistic can actually take.
   *
   * For a **continuous** two-group statistic there is no such grid, so the best
   * available is a bin BOUNDARY on the observed — centres sit at `origin + k·w`,
   * so a boundary sits there when the origin is a half-width below. No bin can
   * then hold values from both sides. Only the phase changes; the width, and so
   * every dot's size, is untouched.
   *
   * In that continuous case ties are not left to chance. A value exactly equal
   * to the observed sits precisely on the boundary, where `Math.round` decides
   * it — and there floating point decides: `(0.5 - 0.4) / 0.2` is 0.4999999…,
   * which rounds DOWN, putting a tie on the non-extreme side for no reason
   * anyone could see. The phase is therefore nudged a fraction of a bin so ties
   * land on the side the p-value counts them: above for a right-tailed or
   * two-sided test, below for a left-tailed one.
   *
   * @param {number|undefined} observed
   * @param {string|undefined} direction
   * @returns {number|undefined}
   */
  function dotGridOrigin(observed, direction) {
    const w = lockedDotGrid?.binWidth;
    const origin = lockedDotGrid?.binOrigin;
    if (!w || origin === undefined) return origin;
    if (!Number.isFinite(observed)) return origin;
    // Discrete statistic: put a bin CENTRE on the observed value. The observed
    // value is itself achievable, and the bin width is the step between
    // achievable values, so every centre then lands on one — each column is one
    // outcome, and none of them is a value the statistic could not produce.
    // Shuffles equal to the observed get their own column, sitting on the line
    // where they belong, and the note under the p-value says they count.
    if (discreteGridStep() != null) return /** @type {number} */ (observed);
    if (!config.twoGroup) return origin;
    // Continuous statistic: there is no achievable grid to land on, so the best
    // available is a bin BOUNDARY on the observed — no bin can then hold values
    // from both sides of the line.
    // Left tail: ties are extreme on the low side, so tip them below the line.
    const tieNudge = direction === 'less' ? w * 1e-9 : -w * 1e-9;
    return /** @type {number} */ (observed) - w / 2 + tieNudge;
  }

  function renderChart(stats, ci, observedStat, direction) {
    chartContainer.innerHTML = '';
    const n = stats.length;
    // Cache params for chart type toggle re-render. lastCI stays the PERCENTILE
    // interval; the method-selected bounds are derived from it below on each render.
    lastCI = ci;
    lastObserved = observedStat;
    lastDirection = direction;

    // The CI-method toggle drives the picture, not just the results box:
    //   percentile → bounds at the resample percentiles (default)
    //   se         → bounds at estimate ± z·SE, over a fitted normal curve
    //   both       → percentile bounds shade the histogram; the ±z·SE bounds are
    //                drawn alongside so the two methods can be compared directly.
    /** @type {[number,number]|null} */
    let normalCI = null;
    if (config.mode === 'bootstrap' && ci && stats.length > 1) {
      normalCI = normalApproxCI(stats, getCiLevel());
    }
    /** BCa bounds (expert-only method) — read off the distribution like percentile. */
    let bcaBounds = null;
    if (config.mode === 'bootstrap' && ci && ciMethod === 'bca') {
      const r = computeBcaResult(stats, getCiLevel());
      if (r) bcaBounds = r.ci;
    }
    /** Bounds that shade the distribution and drive the pills. */
    const shownCI = (bcaBounds && ciMethod === 'bca') ? bcaBounds
      : (normalCI && ciMethod === 'se') ? normalCI : ci;
    /** A second pair of bounds drawn for comparison (Both mode only). */
    const compareCI = (normalCI && ciMethod === 'both') ? normalCI : null;
    // Percentile bounds are dusty red; normal-approximation bounds are dark teal.
    // Both are dashed — the colour is what says which method drew them.
    const ciLineColor = (ciMethod === 'se') ? NORMAL_CI_COLOR : PERCENTILE_CI_COLOR;
    ci = shownCI;
    const titleText = words.distribution;
    let xLabel;
    if (config.mode === 'bootstrap') {
      if (config.proportion) {
        xLabel = config.twoGroup ? 'Diff in Proportions' : 'Sample Proportion (p̂)';
      } else if (config.paired) {
        xLabel = 'Mean Difference';
      } else {
        const sl = getBootstrapStat().label;
        xLabel = config.twoGroup ? `Diff in ${sl}s` : sl;
      }
    } else {
      xLabel = config.statLabel ?? '';
    }

    // Compute domain
    /** @type {[number,number]|undefined} */
    let domain;
    if (stats.length > 0) {
      const vals = observedStat != null ? [...stats, observedStat] : [...stats];
      // A ±z·SE bound can sit outside the range of the resamples — keep it on screen.
      if (shownCI) vals.push(...shownCI);
      if (compareCI) vals.push(...compareCI);
      // Loop, not spread: an argument list of 125k resamples blows the stack,
      // and the counter kept climbing while the chart stopped redrawing.
      let [lo, hi] = extent(vals);
      const pad = (hi - lo) * 0.05 || 0.5;
      lo -= pad;
      hi += pad;
      // Never shrink below the pre-simulated domain
      if (preSimDomain) {
        lo = Math.min(lo, preSimDomain[0]);
        hi = Math.max(hi, preSimDomain[1]);
      }
      domain = [lo, hi];
    } else if (preSimDomain) {
      domain = preSimDomain;
    }

    // Highlight new dots in dotplot mode
    const highlightIndex = lastStatIndex >= 0 ? lastStatIndex : -1;
    const highlightIndices = batchHighlightIndices ?? undefined;
    // A rough column count, used only to size dots when nothing better is
    // available. The GRID itself comes from discreteGridStep(), which does not
    // round — rounding here is why the columns used to drift off the outcomes.
    const sampleSize = (config.twoGroup && config.proportion && data2.length > 0)
      ? Math.round(data1.length * data2.length / (data1.length + data2.length))
      : data1.length;

    // Snap the histogram's bin edges to the achievable grid too, anchored on the
    // observed statistic: whole outcomes per bar, and the observed opens its own
    // bin instead of sitting inside one where the shaded tail would disagree
    // with the p-value.
    /** @type {number[]|undefined} */
    let propThresholds;
    if (config.proportion && domain) {
      propThresholds = snappedPropThresholds(0, domain, n,
        { step: discreteGridStep(), anchor: observedStat });
    }

    // One decision point for the chart type, shared with the toggle — these used
    // to be two copies of the same rule, which is how they came apart.
    const activeChart = getActiveChartType(stats);

    // Sync toggle radios and bin adjuster label to reflect actual chart type
    if (setToggleSelected) setToggleSelected(activeChart);
    if (binAdjuster) binAdjuster.setMode(activeChart);
    // Build region-of-interest predicate
    // Randomization: extreme values (tail) are the region of interest
    // Bootstrap CI: values inside the CI are the region of interest
    /** @type {((v: number) => boolean)|undefined} */
    let regionPredicate;
    /** @type {{below: number, above: number}|undefined} */
    let splitRanks;
    if (config.mode === 'randomization' && observedStat != null && direction) {
      regionPredicate = (v) => isExtreme(v, observedStat, direction);
    } else if (config.mode === 'bootstrap' && ci) {
      regionPredicate = (v) => v >= ci[0] && v <= ci[1];
      // In Target mode the shading is the LEVEL, counted off the ranks, so the
      // picture holds exactly what the pills claim — and a boundary column is
      // drawn in two pieces when the level falls inside it. That split is a
      // depiction of where 95% would cut, not a claim that two resamples with
      // the same value differ; switching to Actual puts the whole column back
      // and the pill moves to what it really holds, which is the comparison.
      // (Jeff, 2026-10-04.)
      if (pillMode === 'target' && ciMethod !== 'se') {
        const tail = Math.round(stats.length * (1 - getCiLevel() / 100) / 2);
        if (tail > 0 && tail * 2 < stats.length) splitRanks = { below: tail, above: tail };
      }
    }

    // Reasoning mode hides everything that reveals the answer on the chart: no
    // region shading, no CI bound lines. The observed-stat marker stays.
    const ciForChart = showReadout ? ci : null;
    if (!showReadout) { regionPredicate = undefined; splitRanks = undefined; }

    /** @type {import('./chart-utils.js').ChartFrame|undefined} */
    let chartResult;
    /** @type {any} */
    let chartXScale;
    // Bootstrap: inside CI = blue (region), outside = gray (de-emphasized)
    // Randomization: tail = darker blue (extreme), body = blue (normal)
    const isBootstrap = config.mode === 'bootstrap';
    const dotBaseFill = isBootstrap && ciForChart ? '#a0a0a0' : undefined;   // gray for outside-CI
    const dotExtremeFill = isBootstrap && ciForChart ? '#569BBD' : undefined; // blue for inside-CI

    if (activeChart === 'dotplot') {
      const r = drawDotplot(chartContainer, stats, {
        id: 'sim-chart',
        xLabel,
        titleText,
        isExtreme: regionPredicate,
        splitRanks,
        observedStat,
        ciLines: ciForChart ?? undefined,
        ciColor: ciLineColor,
        animate: false,
        domain,
        numBins: config.proportion ? sampleSize : userBinCount,
        binWidth: lockedDotGrid?.binWidth ?? discreteGridStep() ?? undefined,
        binOrigin: dotGridOrigin(observedStat, direction),
        highlightIndex,
        highlightIndices,
        precision: config.proportion ? Math.max(dataPrecision + 1, 3) : dataPrecision + 1,
        baseFill: dotBaseFill,
        extremeFill: dotExtremeFill,
        // Slimmer dots on a discrete grid: the gap between columns is the point,
        // since between two achievable values there is nothing to draw.
        dotRadiusScale: discreteGridStep() != null ? 0.8 : 1,
      });
      chartResult = r.frame;
      chartXScale = r.xScale;
      const maxStack = r.dots.reduce((m, d) => Math.max(m, d.stackIndex + 1), 0);
      const effectiveBins = (config.proportion ? sampleSize : userBinCount)
        ?? (lockedDotGrid && domain ? Math.ceil((domain[1] - domain[0]) / lockedDotGrid.binWidth) : null)
        ?? DEFAULT_BINS;
      lastDotResult = {
        xScale: r.xScale, frame: r.frame, domain: domain || [0, 1], maxStack,
        numBins: effectiveBins,
        // The dotplot's own count → pixel-y mapping, which differs between stacked
        // dots and filled columns. A theory curve must use it or it won't line up.
        countToY: r.countToY, binWidth: r.binWidth,
      };
      lastHistResult = null;
    } else if (activeChart === 'spike') {
      const r = drawSpike(chartContainer, stats, {
        id: 'sim-chart',
        xLabel,
        titleText,
        isTail: regionPredicate,
        splitRanks,
        observedStat: observedStat ?? undefined,
        ciLines: ciForChart ?? undefined,
        ciColor: ciLineColor,
        animate: false,
        domain,
        // Each spike is one achievable value of the statistic, so the tooltip
        // should read the way the page prints that statistic.
        precision: config.proportion ? Math.max(dataPrecision + 1, 3) : dataPrecision + 1,
      });
      chartResult = r.frame;
      chartXScale = r.xScale;
    } else {
      const r = drawHistogram(chartContainer, stats, {
        id: 'sim-chart',
        xLabel,
        titleText,
        isTail: regionPredicate,
        splitRanks,
        observedStat: observedStat ?? undefined,
        ciLines: ciForChart ?? undefined,
        ciColor: ciLineColor,
        animate: false,
        domain,
        thresholds: propThresholds,
        numBins: userBinCount,
        prevBinCounts: prevBinCounts ?? undefined,
        highlightValue: lastHighlightValue ?? undefined,
        precision: config.proportion ? Math.max(dataPrecision + 1, 3) : dataPrecision + 1,
      });
      chartResult = r.frame;
      chartXScale = r.xScale;
      lastHistResult = { xScale: r.xScale, yScale: r.yScale, bins: r.bins, domain: domain || [0, 1] };
      lastDotResult = null;
    }

    // Add probability pills — the pills print the p-value / CI %, so they are part
    // of the "answer" and are suppressed in reasoning mode.
    if (showReadout && chartResult && chartXScale && stats.length > 0) {
      if (config.mode === 'randomization' && observedStat != null && direction) {
        const { pValue } = permutationPValue(stats, observedStat, direction);
        renderSimPills(chartResult, chartXScale, {
          mode: 'randomization', pValue, observedStat, direction,
        });
      } else if (config.mode === 'bootstrap' && ci) {
        // The percentile and BCa intervals ask for a level, so the pills print
        // the level. ±SE is an approximation whose whole point is that it does
        // not land on it, so that view keeps the counted shares.
        drawCiPills(chartResult, chartXScale, stats, ci,
          (ciMethod === 'se' || pillMode === 'actual') ? null : getCiLevel() / 100);
      }
    }

    // Both mode: draw the ±z·SE bounds next to the percentile ones (dashed like
    // them, dark teal instead of dusty red) plus a legend, so the student can see
    // where the two methods agree — and, on a skewed bootstrap distribution, where
    // they don't.
    if (showReadout && compareCI && chartResult && chartXScale) {
      const prec = config.proportion ? Math.max(dataPrecision + 1, 3) : dataPrecision + 1;
      drawCompareBounds(chartResult, chartXScale, compareCI, prec);
      appendCiLegend(chartContainer, getCiLevel());
    }

    // Opt-in draggable cutoff line(s) — the student positions the line(s) and
    // reads the tail mass off the live label instead of counting bars. Only on
    // the binned histogram (reasoning mode forces one); mode 'ci' = two lines
    // for the percentile bounds, 'tail' = one line for the p-value.
    if ((cutlinesMode === 'ci' || cutlinesMode === 'tail')
        && (activeChart === 'histogram' || activeChart === 'spike')
        && chartResult && chartXScale && stats.length > 0) {
      renderCutlines(chartResult, chartXScale, stats, {
        mode: cutlinesMode,
        direction: direction ?? undefined,
        precision: config.proportion ? Math.max(dataPrecision + 1, 3) : dataPrecision + 1,
      });
    }

    // Theory overlay (histogram or dotplot, bootstrap mode only). The ±SE and Both
    // methods switch it on: the normal curve is where that interval comes from.
    if (theoryOverlayOn && (activeChart === 'histogram' || activeChart === 'dotplot') && config.mode === 'bootstrap') {
      applyTheoryOverlay(stats);
    }

    lastStatIndex = -1; // Reset after rendering
    batchHighlightIndices = null;
    prevBinCounts = null;
    lastHighlightValue = null;
  }

  /** @type {(v: number, obs: number, dir?: 'left'|'right'|'both') => boolean} */
  const isExtreme = isExtremeShared;

  // renderSimPills and _addSimPill are now in chart-utils.js

  function displayBootstrapResults(stats, ci, se, ciLevel) {
    const m = mean(stats);
    let statLabel, paramLabel, paramName;
    if (config.paired) {
      statLabel = 'Mean Difference';
      paramLabel = `Mean Difference (${group2Name} − ${group1Name})`;
      paramName = `true mean difference (${group2Name} − ${group1Name})`;
    } else if (config.proportion) {
      statLabel = 'Sample Proportion';
      paramLabel = config.twoGroup
        ? `Difference in ${statLabel}s (${group1Name} − ${group2Name})`
        : statLabel;
      paramName = config.twoGroup
        ? 'difference in population proportions'
        : 'true population proportion';
    } else {
      statLabel = getBootstrapStat().label;
      paramLabel = config.twoGroup
        ? `Difference in ${statLabel}s (${group1Name} − ${group2Name})`
        : statLabel;
      const longLabel = getBootstrapStat().longLabel;
      paramName = config.twoGroup
        ? `difference in population ${longLabel}s`
        : `true population ${longLabel}`;
    }
    // Contextual interpretation using dataset metadata
    const ctx = datasetContext;
    const bootLong = getBootstrapStat().longLabel;
    // Adapt context parameter to current stat (e.g. "mean mercury level" → "standard deviation of mercury level")
    let ctxParam;
    if (ctx.parameter) {
      // Replace leading "mean"/"median"/etc with current stat's long label
      const adapted = ctx.parameter.replace(/^(mean|median|standard deviation|first quartile|third quartile)\b/i, bootLong);
      // If no replacement happened (e.g. "difference in ..."), prepend the stat
      ctxParam = adapted === ctx.parameter && !ctx.parameter.toLowerCase().startsWith(bootLong)
        ? `population ${bootLong} of ${ctx.parameter}`
        : `population ${adapted}`;
    } else {
      ctxParam = paramName;
    }
    const unitSuffix = ctx.unit ? ` ${ctx.unit}` : '';
    const popPhrase = ctx.population ? ` for ${ctx.population}` : '';
    /** @param {number} v */
    const fmt = (v) => config.proportion ? formatStat(v, dataPrecision, 'proportion') : formatStat(v, dataPrecision);
    const ciLo = `<span class="ci-value">${fmt(ci[0])}</span>`;
    const ciHi = `<span class="ci-value">${fmt(ci[1])}</span>`;
    // REQ-055: report the number the student can see. Posting full float
    // precision would put 9.68665123457 in the answer box beside a 9.69 on
    // screen, and a student comparing the two would be right to distrust it.
    answer.send({
      ci_lower: Number(fmt(ci[0])), ci_upper: Number(fmt(ci[1])),
      se: Number(fmt(se)), stat: lastObserved,
    });
    // Data spread (SD) vs bootstrap spread (SE): the classic confusion (REQ-032).
    // The bootstrap distribution's spread is the SE — how much the *statistic*
    // varies — and is much narrower than the spread of the *data*. Shown for the
    // one-sample quantitative case where "SD of the data" is unambiguous.
    let dataSpreadContrast = '';
    if (config.mode === 'bootstrap' && !config.proportion && !config.twoGroup
        && !config.paired && data1.length > 1) {
      const dataSD = sd(data1);
      dataSpreadContrast = `<p class="hint">Spread of the <em>data</em> (SD ≈ ${fmt(dataSD)}) is much wider than the spread of the bootstrap ${bootLong}s — the <strong>SE ≈ ${fmt(se)}</strong>. The SE measures how much the <strong>${bootLong}</strong> varies from sample to sample, <em>not</em> how spread out the values are.</p>`;
    }
    lastBoot = { stats, ci, se, ciLevel };

    // Symbol for the estimate, used in the worked ±z·SE formula.
    let statSymbol;
    if (config.paired) statSymbol = 'd̄';
    else if (config.proportion) statSymbol = config.twoGroup ? 'p̂₁ − p̂₂' : 'p̂';
    else if (config.twoGroup) statSymbol = 'x̄₁ − x̄₂';
    else statSymbol = (bootStatSelect?.value ?? 'mean') === 'mean' ? 'x̄' : 'estimate';

    // Float-safe percent label (levels can be continuous now).
    const ciPct = Number.isInteger(ciLevel) ? String(ciLevel) : ciLevel.toFixed(1);

    // ±z·SE (normal-approximation) interval, centred on the estimate. z = 2 at 95%
    // (the "±2 SE" rule of thumb); otherwise the exact normal critical value.
    const z = zFor(ciLevel);
    const zLabel = zLabelFor(ciLevel);
    const seBounds = normalApproxCI(stats, ciLevel);
    const seLo = `<span class="ci-value">${fmt(seBounds[0])}</span>`;
    const seHi = `<span class="ci-value">${fmt(seBounds[1])}</span>`;

    const pctLine = `<p><strong>${ciPct}% CI (percentile):</strong> (${ciLo}, ${ciHi})</p>`;
    // Worked normal-approximation formula, e.g. "x̄ ± 2·SE = 20.0 ± 2 × 0.99 = (18.0, 22.0)".
    const seLineHtml = `<p><strong>${ciPct}% CI (±${zLabel}·SE):</strong> <span class="ci-formula">${statSymbol} &plusmn; ${zLabel}&middot;SE = ${fmt(m)} &plusmn; ${zLabel} &times; ${fmt(se)} = (${seLo}, ${seHi})</span></p>`;
    // BCa (expert-only): bias-corrected & accelerated interval, read off the
    // distribution like percentile but with the cutoffs shifted for skew/bias.
    let bcaLine = '';
    let bcaLo = ciLo, bcaHi = ciHi;
    if (ciMethod === 'bca') {
      const r = computeBcaResult(stats, ciLevel);
      if (r) {
        bcaLo = `<span class="ci-value">${fmt(r.ci[0])}</span>`;
        bcaHi = `<span class="ci-value">${fmt(r.ci[1])}</span>`;
        const fell = r.fellBack
          ? ' (bootstrap distribution too degenerate for the adjustment; showing the plain percentile interval)'
          : ` The cutoffs are shifted for bias (z&#8320; = ${r.z0.toFixed(3)}) and skew (a = ${r.a.toFixed(3)}).`;
        bcaLine = `<p><strong>${ciPct}% CI (BCa):</strong> (${bcaLo}, ${bcaHi})<span class="hint" style="display:block">Bias-corrected and accelerated.${fell}</span></p>`;
      }
    }
    const ciBlock = ciMethod === 'se' ? seLineHtml
      : ciMethod === 'both' ? pctLine + seLineHtml
      : ciMethod === 'bca' ? (bcaLine || pctLine)
      : pctLine;
    const bothNote = ciMethod === 'both'
      ? '<p class="hint">The two methods agree closely when the bootstrap distribution is symmetric; they diverge when it’s skewed (where the percentile CI is the more honest one).</p>'
      : '';

    // The interval the student reads is the one the chart draws. In Both mode the
    // percentile interval is the one being shaded, so it carries the interpretation.
    const interpLo = ciMethod === 'se' ? seLo : ciMethod === 'bca' ? bcaLo : ciLo;
    const interpHi = ciMethod === 'se' ? seHi : ciMethod === 'bca' ? bcaHi : ciHi;

    // How much the interval is a guess about ITSELF. The randomization pages
    // have carried this for the p-value since REQ-031 and the bootstrap pages
    // said nothing, so the same idea — your answer is an estimate from B draws,
    // and more draws sharpen it — was taught on eight pages and dropped on
    // five. One line, same voice, no control. (Jeff, 2026-10-02.)
    const mcMethod = ciMethod === 'se' ? 'se' : ciMethod === 'bca' ? 'bca' : 'percentile';
    const mcLevels = ciMethod === 'bca' ? (computeBcaResult(stats, ciLevel)?.levels ?? null) : null;
    const mc = ciMonteCarloMargin(stats, ciLevel, { method: mcMethod, levels: mcLevels });
    let mcLine = '';
    if (mc) {
      const lo = fmt(mc.lo), hi = fmt(mc.hi);
      // Below the precision the bounds are printed at there is no honest number
      // to quote, and "±0.000" would read as "exact". On a discrete statistic
      // this is the ordinary case: the bound sits on a repeated resample value.
      const tiny = Number(lo) === 0 && Number(hi) === 0;
      // "Could", not "would": it is what re-running might do, not a prediction
      // that it will. And short — the parenthetical spelling out that this is
      // the simulation's wobble rather than the parameter's was a third line of
      // text for a point the sentence already makes by saying what shifts.
      // (Jeff, 2026-10-02.)
      mcLine = tiny
        ? `<p class="hint">Run it again and the ends could barely move at this precision — already steady.</p>`
        : `<p class="hint">Run it again and the ends could shift <strong>±${lo}</strong> and
             <strong>±${hi}</strong>. <strong>More resamples → tighter.</strong></p>`;
    }

    // What the bounds actually hold.
    //
    // The pills on the chart print the LEVEL — 2.5% / 95% / 2.5% — because that
    // is what the procedure asks for and what "95% CI" means. On a lumpy
    // statistic the bounds cannot deliver it exactly: at n = 62 a nominal 95%
    // percentile interval holds 97.8% of the resamples, because a whole atom of
    // the distribution sits inside the bound. That is not hidden, it is said
    // here, with the reason — and the reason differs. Sometimes the statistic
    // is simply granular; sometimes the bound has run out of distribution and
    // the tail has nowhere to sit, which is a different sentence.
    // (Jeff, 2026-10-04: "print actual in the results section.")
    let actualLine = '';
    if (ciMethod !== 'se' && stats.length > 0) {
      const shown = ciMethod === 'bca' && bcaLine
        ? /** @type {[number, number]} */ ([
            Number(String(bcaLo).replace(/<[^>]*>/g, '')),
            Number(String(bcaHi).replace(/<[^>]*>/g, ''))])
        : ci;
      if (shown && Number.isFinite(shown[0]) && Number.isFinite(shown[1])) {
        const { midProb } = ciRegionMass(stats, shown);
        const target = ciLevel / 100;
        if (Math.abs(midProb - target) >= 0.005) {
          const [lowest, highest] = extent(stats);
          const atFloor = shown[0] <= lowest, atCeiling = shown[1] >= highest;
          const why = atFloor && atCeiling ? 'they span every value the resamples took'
            : atFloor ? 'the low end is as low as a resample got, so there is no bottom tail'
            : atCeiling ? 'the high end is as high as a resample got, so there is no top tail'
            : `${statSymbol} can only take certain values, so exactly ${ciPct}% is not available`;
          actualLine = `<p class="hint">Actually holds
            <strong>${(midProb * 100).toFixed(1)}%</strong>: ${why}.</p>`;
        }
      }
    }

    resultDiv.innerHTML = showReadout ? `
      <p><strong>Bootstrap Distribution</strong> (${stats.length} resamples)</p>
      <p>${paramLabel}: ${fmt(m)}</p>
      <p>SE: ${fmt(se)}</p>
      ${dataSpreadContrast}
      ${ciBlock}
      ${bothNote}
      ${actualLine}
      ${mcLine}
      <p class="interpretation">We are ${ciPct}% confident that the ${ctxParam}${popPhrase} is between ${interpLo}${unitSuffix} and ${interpHi}${unitSuffix}.</p>
      ${stats.length < 50 ? '<p class="hint">CI is approximate with few resamples. Generate more for stability.</p>' : ''}
    ` : `
      <p><strong>Bootstrap Distribution</strong> (${stats.length} resamples)</p>
      <p class="reasoning-prompt"><strong>Estimate the ${ciPct}% confidence interval yourself.</strong> Hover (or focus) the bars to read each bin's edges and count, and find the values that cut off the bottom ${((100 - ciPct) / 2).toFixed(1)}% and top ${((100 - ciPct) / 2).toFixed(1)}% of the ${stats.length} resamples.</p>
      ${stats.length < 50 ? '<p class="hint">Generate more resamples for a clearer distribution.</p>' : ''}
    `;
  }

  /**
   * @param {number[]} stats
   * @param {number} observedStat
   * @param {number} pValue
   * @param {number} extremeCount
   * @param {'left'|'right'|'both'} direction
   */
  function displayRandomizationResults(stats, observedStat, pValue, extremeCount, direction) {
    const dirLabel = direction === 'both' ? 'two-sided'
      : direction === 'right' ? 'right-tail' : 'left-tail';
    const nullDiff = getNullValue();
    // Show the raw (unshifted) observed difference for display
    const rawObserved = observedStat + nullDiff;
    let obsLabel;
    if (config.proportion) {
      obsLabel = `p̂<sub>${group1Name}</sub> − p̂<sub>${group2Name}</sub> = <span class="observed-value">${formatStat(rawObserved, dataPrecision, 'proportion')}</span>`;
    } else if (config.twoGroup) {
      obsLabel = `<span class="x-bar">x</span><sub>${group1Name}</sub> − <span class="x-bar">x</span><sub>${group2Name}</sub> = <span class="observed-value">${formatStat(rawObserved, dataPrecision)}</span>`;
    } else {
      obsLabel = `<span class="observed-value">${formatStat(rawObserved, dataPrecision)}</span>`;
    }
    // Plain-language interpretation
    let strength;
    if (pValue < 0.01) strength = 'very strong';
    else if (pValue < 0.05) strength = 'strong';
    else if (pValue < 0.10) strength = 'moderate';
    else strength = 'little';
    const defaultNull = config.proportion
      ? 'no difference in population proportions'
      : nullDiff === 0
        ? 'no difference in population means'
        : `a difference of ${formatStat(nullDiff, dataPrecision)} in population means`;
    const nullDesc = datasetContext.nullClaim || defaultNull;
    const N = stats.length;
    // The p-value is itself an estimate from N shuffles, with Monte-Carlo
    // SE = sqrt(p(1−p)/N). Show a 95% margin that visibly shrinks as N grows, so
    // re-runs don't look arbitrary (REQ-031). And present the p-value *by
    // construction* — it IS the fraction of shuffles at least as extreme.
    const mcMargin = 1.96 * Math.sqrt(Math.max(pValue * (1 - pValue), 0) / N);
    // Discrete statistics land exactly on the observed value, often a lot: on
    // sex_discrimination those ties are 84% of the p-value, so a student who
    // counts only what is PAST the line reads 0.004 where the answer is 0.025.
    // The chart already colours that spike as extreme and `isExtreme` already
    // uses >=; what was missing is anyone saying so. Shown only when ties exist,
    // which is exactly the discrete case — a continuous statistic never repeats
    // its observed value, so this line never appears there.
    const tieCount = stats.filter(v => Math.abs(v - observedStat) < 1e-9).length;
    const tieNote = tieCount > 0
      ? `<p class="hint tie-note"><strong>${tieCount} of those ${extremeCount}</strong> came out
           <em>exactly</em> as extreme as the observed value — the column sitting on the line.
           They count: “at least as extreme” includes equal.</p>`
      : '';
    const pLine = extremeCount === 0
      ? `<strong>p-value = ${extremeCount}/${N} ≈ 0</strong> — none of ${N} shuffles were this extreme`
      : `<strong>p-value = ${extremeCount}/${N} = ${pValue.toFixed(3)} ± ${mcMargin.toFixed(3)}</strong>`;
    // REQ-055: report what the student can see, to the same 3 decimals. Not
    // when `?readout=false` is on — that mode exists to make them read the
    // p-value off the chart themselves, and posting it would answer the
    // question for them.
    if (showReadout) {
      answer.send({ p_value: Number(pValue.toFixed(3)), count: extremeCount,
        stat: observedStat + getNullValue() });
    }
    resultDiv.innerHTML = showReadout ? `
      <p><strong>Randomization Distribution</strong> (${N} shuffles)</p>
      <p>Observed statistic: ${obsLabel}</p>
      <p>${pLine}</p>
      <p class="hint">The p-value <em>is</em> the fraction of shuffles at least as extreme as the observed value (${dirLabel}). Run it again and it could shift <strong>±${mcMargin.toFixed(3)}</strong>. <strong>More shuffles → tighter.</strong></p>
      ${tieNote}
      <p class="interpretation">${extremeCount} of ${N} shuffled statistics were at least as extreme as the observed value. This provides ${strength} evidence against H₀: ${nullDesc}.</p>
    ` : `
      <p><strong>Randomization Distribution</strong> (${N} shuffles)</p>
      <p>Observed statistic: ${obsLabel}</p>
      <p class="reasoning-prompt"><strong>Estimate the p-value yourself.</strong> The observed value is marked on the distribution. Hover (or focus) the bars to read each bin's count, then find the fraction of the ${N} shuffles that are at least as extreme as the observed value (${dirLabel}).</p>
      ${tieCount > 0 ? `<p class="hint tie-note">Some shuffles landed <em>exactly</em> on the
           observed value — the column on the line. Count those in: “at least as extreme”
           includes equal.</p>` : ''}
    `;
  }

  function announce(msg) {
    if (announceDiv) announceDiv.textContent = msg;
  }

  // ─── Keyboard shortcuts ───

  // The number keys every help dialog advertises.
  //
  // This whole block was gated on `document.getElementById('keyboard-help')`,
  // and no page has that element — all fifteen call their dialog `page-help`.
  // So 1/2/3/4/0 have never worked on any simulation page, while every help
  // dialog listed them. Found 2026-10-04 adding the fifth. `?` and the close
  // button are `initHelp`'s, which does know both ids; this only needs the
  // generate keys.
  document.addEventListener('keydown', (e) => {
    if (e.target !== document.body) return;
    if (e.ctrlKey || e.metaKey) return;
    if (e.key === '1') genBtns[0]?.click();
    if (e.key === '2') genBtns[1]?.click();
    if (e.key === '3') genBtns[2]?.click();
    if (e.key === '4') genBtns[3]?.click();
    if (e.key === '5') genBtns[4]?.click();
    if (e.key === '0' && resetBtn && !resetBtn.hidden) resetBtn.click();
  });

  initPlayPause(genBtns, resetBtn);

  // TEMPORARY: apply experimental layout variant (rail/focus behavior)
  // Opt-in coaching hints (state-driven; no-op unless enabled)
  initCoaching();
}
