// @ts-check
/**
 * Centralized chart configuration for StatLens.
 *
 * Single source of truth for thresholds, precision, bin counts, domain padding,
 * chart type selection, and the unified renderSimChart() function.
 * Every page imports from here instead of making independent decisions.
 */

import * as d3Scale from 'd3-scale';
import * as d3Selection from 'd3-selection';
import { gridCentredOn } from './grid.js';
import { drawHistogram, computeBins, snappedPropThresholds, renderOverlayLine } from './histogram.js';
import { drawDotplot } from './dotplot.js';
import { drawSpike } from './spike.js';
import { renderSimPills, renderCutlines, deoverlapLabels } from './chart-utils.js';
import { formatStat, extent} from './stats.js';
import { wrapWithStepper } from './page-utils.js';

// ─── Constants (single source of truth) ─────────────────────────────

/**
 * Where to end the axis on an unbounded right-skewed statistic.
 *
 * `TAIL_CLIP_QUANTILE` of a seeded PILOT run, never of the live draws: a
 * quantile of the accumulating data would move as draws arrive, and a picture
 * that rescales while you are watching one bar was the original complaint
 * (Jeff, 2026-10-31: "can we [fix the] axis limits in advance so that the
 * picture doesn't jump around so much as we add more samples"). The pilot takes
 * its own `presim-` rng stream, so none of this touches a seeded answer.
 *
 * `TAIL_CLIP_OBSERVED_MARGIN` only guarantees the observed mark lands on the
 * axis with a little room. ⚠ It must stay SMALL. The first draft set it to 1.3,
 * reserving space so the shaded tail would stay drawable, and that reasoning was
 * wrong: the quantile already provides that space whenever the observed sits
 * inside the bulk, and when the observed sits outside it there is nothing much
 * out there to draw. Measured on `randomization-chisq/?dataset=ask`, whose
 * observed is past 99.9% of the null draws, 1.3 made the axis 1.24× WIDER than
 * the one it replaced — the clip actively hurt the page it could not help.
 *
 * So when the observed statistic is far out in the tail there is no clip to be
 * had, and the right behaviour is to return the old axis rather than a worse
 * one: the chart has to span both the hump and the observed mark.
 *
 * @param {number[]} pilotStats - a seeded pilot run of the page's own statistic
 * @param {number} [observed]
 * @returns {number}
 */
export function clippedAxisHi(pilotStats, observed = 0) {
  const obsFloor = Number.isFinite(observed) ? observed * TAIL_CLIP_OBSERVED_MARGIN : 0;
  const n = pilotStats.length;
  if (!n) return Math.max(obsFloor, 1);
  const sorted = [...pilotStats].sort((a, b) => a - b);
  const q = sorted[Math.min(n - 1, Math.floor(n * TAIL_CLIP_QUANTILE))];
  const hi = Math.max(q * 1.05, obsFloor);
  return hi > 0 ? hi : 1;
}

/** Quantile of the pilot run the axis ends at; the rest is counted, not drawn. */
export const TAIL_CLIP_QUANTILE = 0.995;

/** The axis must reach at least this multiple of the observed statistic. */
export const TAIL_CLIP_OBSERVED_MARGIN = 1.05;

/** Max simulations before auto-switching from dotplot to histogram. */
export const DOTPLOT_AUTO_THRESHOLD = 1000;

/** Default max bins for dotplots. */
export const DOTPLOT_MAX_BINS = 40;

/**
 * Max distinct values a discrete statistic (a sample proportion k/n) can take
 * before its reasoning-mode figure switches from non-touching spike bars to a
 * binned histogram. Below this the discrete bars are readable and honest (each
 * bar is one possible k/n); above it they crowd into an unhoverable cloud.
 */
export const DISCRETE_BAR_MAX = 40;

/**
 * Most columns a discrete dotplot may span before it stops being a dotplot.
 *
 * The grid of a discrete statistic is the set of values it can take, and that
 * set gets finer as the sample grows: a single proportion spans roughly
 * 8·√(p(1−p)·n) achievable values across its null distribution — about 20 at
 * n = 62, 58 at n = 200, 127 at n = 1000. A plot about 680px wide cannot draw
 * 127 separate columns; below ~6px apart they render wider than their own slot
 * and merge into a solid block that only looks like a histogram. So past this
 * many columns 'auto' draws an actual histogram, which bins whole outcomes
 * together and says so, instead of a dotplot pretending it still resolves them.
 */
export const DISCRETE_COLUMN_MAX = 60;

/** Default max bins for histograms (Sturges' cap). */
export const HIST_MAX_BINS = 50;

/** Min bins for bin adjuster. */
export const BIN_MIN = 3;

/** Domain padding ratio for chart axes. */
export const DOMAIN_PADDING = 0.05;

// ─── Chart type ─────────────────────────────────────────────────────

/**
 * Determine the active chart type, resolving 'auto'.
 *
 * Dots, then bins. A dotplot is the shape students meet first and the one that
 * shows the mechanism — one shuffle, one dot — so 'auto' opens there and bins
 * only when the run outgrows it. The spike view stays an expert choice: it is
 * the exact picture of a discrete statistic, but it is also an unfamiliar one,
 * and a dotplot whose grid sits on the achievable values (see sim-app's
 * discreteGridStep) is exact too, while still looking like a dotplot.
 *
 * Reasoning-mode figures are the exception — they hide the toggle, so they pick
 * separately in reasoningChartType below.
 *
 * @param {number} n - Number of data points / simulated stats
 * @param {string} userChoice - 'auto', 'dotplot', 'histogram', or 'spike'
 * @param {object} [opts]
 * @param {number} [opts.discreteColumns] - Achievable values the data spans, for a discrete statistic
 * @returns {'dotplot'|'histogram'|'spike'}
 */
export function resolveChartType(n, userChoice, opts = {}) {
  if (userChoice && userChoice !== 'auto') return /** @type {any} */ (userChoice);

  // ── A statistic on a lattice is drawn on its lattice, at any number of draws.
  //
  // `discreteColumns` is non-zero only when the statistic has a step — the set
  // of values it can actually take. Binning such a statistic is honest only if
  // the bin width is an exact integer multiple of that step, and nothing
  // chooses bins that way, so the bars alternate for reasons that have nothing
  // to do with the distribution. Computed for p̂ with n = 34 (35 achievable
  // values), expected counts across the middle of the null distribution:
  //
  //   12 bins → 3,3,2,3,3 points per bin →  55, 334, 473, 744, 334
  //   25 bins → 1,2,1,1,2,1,2,…          →  15,  97, 108, 162, 473, 272, 473, …
  //   44 bins → 0,1,1,1,0,1,1,1,0        →   0,  33,  64, 108,   0, 162, 216, …
  //
  // The 473s are bins that caught two lattice points beside bins that caught
  // one; at 44 bins there are empty bins *between* occupied ones — gaps the
  // distribution does not have. The column form has none of this, because it is
  // the distribution: one bar per achievable value.
  //
  // This used to fall through to the count rule below, so a statistic with 35
  // achievable values — well inside DISCRETE_COLUMN_MAX — flipped to a
  // histogram at 1,001 draws, which is exactly when enough has been drawn for
  // the shape to be worth looking at. (Jeff, 2026-11-02: "for discrete
  // distributions with a moderately small number of viable values, is there any
  // reason to ever switch to a histogram?" There is not.)
  //
  // Past DISCRETE_COLUMN_MAX the columns no longer resolve and binning is the
  // lesser evil — see the note on that constant.
  if (opts.discreteColumns) {
    return opts.discreteColumns > DISCRETE_COLUMN_MAX ? 'histogram' : 'dotplot';
  }

  // Everything else — means, slopes, correlations, t, F, χ² — is not on a
  // lattice, and bins are the right picture once there are too many dots.
  return n <= DOTPLOT_AUTO_THRESHOLD ? 'dotplot' : 'histogram';
}

/**
 * How many achievable values a discrete statistic's realised range spans — the
 * number of columns a dotplot on that grid would have to draw.
 *
 * @param {number[]} stats
 * @param {number|null|undefined} step - distance between achievable values
 * @returns {number}
 */
export function discreteColumnSpan(stats, step) {
  if (!step || !(step > 0)) return 0;
  return gridCentredOn(step, 0).columnSpan(stats);
}

/**
 * Chart type for a reasoning-mode figure (plot=only / readout=false), where the
 * chrome-hidden embed can't offer the dotplot/spike/histogram toggle. A discrete
 * statistic (a sample proportion) shows as non-touching spike bars — the honest
 * "these are the possible k/n" picture — up to DISCRETE_BAR_MAX distinct values,
 * then bins into a histogram so large n doesn't degrade into a spike cloud.
 * Continuous statistics (means, slopes) always histogram.
 * @param {number[]} stats - the simulated statistics
 * @param {{ proportion?: boolean }} [opts]
 * @returns {'spike'|'histogram'}
 */
export function reasoningChartType(stats, opts = {}) {
  if (opts.proportion && new Set(stats).size <= DISCRETE_BAR_MAX) return 'spike';
  return 'histogram';
}

// ─── Bin counts ─────────────────────────────────────────────────────

/**
 * Compute the number of bins for a dotplot.
 * For proportions, uses sampleN so bin centers align with possible k/n values.
 * @param {number} n - Number of data points
 * @param {object} [opts]
 * @param {boolean} [opts.proportion] - Is the statistic a proportion?
 * @param {number} [opts.sampleN] - Original sample size (for proportion alignment)
 * @param {number} [opts.userBins] - User-specified bin count override
 * @returns {number}
 */
export function dotplotBins(n, opts = {}) {
  if (opts.userBins != null) return opts.userBins;
  if (opts.proportion && opts.sampleN) return opts.sampleN;
  return Math.min(n, DOTPLOT_MAX_BINS);
}

/**
 * Compute thresholds for a histogram.
 * For proportions, snaps to k/n grid so bars align with possible values.
 * @param {object} opts
 * @param {boolean} [opts.proportion]
 * @param {number} [opts.sampleN]
 * @param {[number,number]} [opts.domain]
 * @param {number} [opts.dataLength]
 * @returns {number[]|undefined}
 */
export function histogramThresholds(opts = {}) {
  if (opts.proportion && opts.sampleN && opts.domain && opts.dataLength) {
    return snappedPropThresholds(opts.sampleN, opts.domain, opts.dataLength);
  }
  return undefined;
}

// ─── Precision ──────────────────────────────────────────────────────

/**
 * Determine display precision for chart labels and stat values.
 * @param {number} dataPrecision - Precision detected from source data
 * @param {object} [opts]
 * @param {boolean} [opts.proportion]
 * @param {number} [opts.sampleN]
 * @returns {number}
 */
export function displayPrecision(dataPrecision, opts = {}) {
  if (opts.proportion && opts.sampleN) {
    return Math.max(3, String(opts.sampleN).length);
  }
  return dataPrecision;
}

// ─── Domain ─────────────────────────────────────────────────────────

/**
 * Compute a padded domain for chart axes.
 * @param {number[]} values
 * @param {object} [opts]
 * @param {number} [opts.padding] - Padding ratio (default DOMAIN_PADDING)
 * @param {number} [opts.includeValue] - Extra value to include (e.g. observed stat)
 * @param {boolean} [opts.startAtZero] - Force domain to start at 0 (for chi-sq, proportions)
 * @returns {[number, number]}
 */
export function computeDomain(values, opts = {}) {
  const padding = opts.padding ?? DOMAIN_PADDING;
  // Loop, not spread: at ~125k values an argument list blows the stack.
  let [lo, hi] = extent(values);
  if (opts.includeValue != null) {
    lo = Math.min(lo, opts.includeValue);
    hi = Math.max(hi, opts.includeValue);
  }
  const range = hi - lo || 1;
  const pad = range * padding;
  lo = opts.startAtZero ? 0 : lo - pad;
  hi = hi + pad;
  return [lo, hi];
}

// ─── Extreme / region predicates ────────────────────────────────────

/**
 * Check if a value is in the extreme tail relative to an observed statistic.
 * Used by randomization tests.
 * @param {number} v - Simulated value
 * @param {number} observed - Observed test statistic
 * @param {'left'|'right'|'both'} direction
 * @param {number} [nullCenter] - Center of null distribution (for 'both' direction)
 * @returns {boolean}
 */
export function isExtreme(v, observed, direction, nullCenter) {
  if (direction === 'left') return v <= observed;
  if (direction === 'both') {
    const c = nullCenter ?? 0;
    return Math.abs(v - c) >= Math.abs(observed - c);
  }
  return v >= observed;
}

// ─── Chart type toggle ──────────────────────────────────────────────

/**
 * Create and insert a chart type toggle (segmented control) before a container element.
 * Returns the element and a function to get/set the current chart type.
 *
 * @param {HTMLElement} container - The chart container element
 * @param {object} opts
 * @param {Array<[string, string]>} [opts.types] - [value, label] pairs
 * @param {string} [opts.initial] - Initial chart type ('auto' resolves on render)
 * @param {(chartType: string) => void} opts.onChange - Called when user changes chart type
 * @returns {{ fieldset: HTMLElement, setSelected: (type: string) => void }}
 */
export function createChartToggle(container, opts) {
  const types = opts.types ?? [['dotplot', 'Dotplot'], ['histogram', 'Histogram']];
  const initial = opts.initial ?? 'dotplot';

  const seg = document.createElement('div');
  seg.className = 'seg-control chart-type-toggle';
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Chart type');

  /** @type {Map<string, HTMLButtonElement>} */
  const btnMap = new Map();
  for (const [value, label] of types) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.dataset.value = value;
    btn.setAttribute('aria-pressed', String(value === initial));
    btn.addEventListener('click', () => {
      setSelected(value);
      opts.onChange(value);
    });
    seg.appendChild(btn);
    btnMap.set(value, btn);
  }

  const parent = container.parentElement;
  if (parent) parent.insertBefore(seg, container);

  function setSelected(type) {
    for (const [v, btn] of btnMap) {
      btn.setAttribute('aria-pressed', String(v === type));
    }
  }

  return { fieldset: seg, setSelected };
}

// ─── Bin adjuster ───────────────────────────────────────────────────

/**
 * @typedef {object} BinAdjusterControl
 * @property {HTMLLabelElement} element - The label element
 * @property {(mode: 'dotplot'|'histogram'|'spike') => void} setMode - Update label text for chart type
 * @property {(value: number) => void} setValue - Set the input value programmatically
 */

/**
 * Create a bin/stack count adjuster control and append it to a parent element.
 * Label changes between "Stacks" (dotplot) and "Bins" (histogram).
 *
 * @param {HTMLElement} parent - Container to append the control to
 * @param {object} opts
 * @param {number} opts.currentBins - Current bin count
 * @param {number} [opts.min] - Minimum bins (default BIN_MIN)
 * @param {number} [opts.max] - Maximum bins (default HIST_MAX_BINS)
 * @param {(bins: number) => void} opts.onChange - Called when bin count changes
 * @returns {BinAdjusterControl}
 */
export function createBinAdjuster(parent, opts) {
  const min = opts.min ?? BIN_MIN;
  const max = opts.max ?? HIST_MAX_BINS;
  const label = document.createElement('label');
  const labelSpan = document.createElement('span');
  labelSpan.textContent = 'Bins:';
  label.appendChild(labelSpan);
  label.insertAdjacentHTML('beforeend', ` <input type="number" id="bin-count" min="${min}" max="${max}" step="1">`);
  label.style.cssText = 'display:inline-flex;flex-direction:row;align-items:center;gap:0.3rem;font-weight:400;font-size:0.85rem;';
  parent.appendChild(label);

  const input = /** @type {HTMLInputElement} */ (label.querySelector('input'));
  input.style.cssText = 'width:3.5rem;padding:0.15rem 0.3rem;font-size:0.85rem;';
  input.value = String(opts.currentBins);
  wrapWithStepper(input);

  input.addEventListener('input', () => {
    const n = parseInt(input.value, 10);
    if (isFinite(n) && n >= min) opts.onChange(n);
  });

  return {
    element: label,
    setMode: (mode) => {
      // The spike view draws one bar per achievable value, so there is nothing
      // to count bins of — hide the control rather than leave it inert.
      label.hidden = mode === 'spike';
      labelSpan.textContent = mode === 'dotplot' ? 'Stacks:' : 'Bins:';
    },
    setValue: (value) => {
      input.value = String(value);
    },
  };
}

// ─── Unified sim chart renderer ─────────────────────────────────────

/**
 * @typedef {object} SimChartResult
 * @property {import('./types.js').ChartFrame} frame
 * @property {any} xScale
 * @property {any} [yScale]
 * @property {any[]} [bins]
 * @property {[number,number]} [domain]
 * @property {number} [maxStack]
 * @property {number} [binWidth]
 * @property {(count: number) => number} [countToY] - Dotplot only: count → pixel y.
 */

/**
 * Render a simulation distribution chart (dotplot or histogram) with all
 * standard decorations: region shading, observed stat line, CI lines, pills.
 *
 * This is the single entry point for all simulation/conceptual pages that
 * need a dotplot-or-histogram with pills.
 *
 * @param {HTMLElement} container
 * @param {number[]} stats - Simulated statistics
 * @param {object} opts
 * @param {string} opts.chartType - 'dotplot' or 'histogram' (already resolved, not 'auto')
 * @param {string} opts.id - SVG id
 * @param {string} opts.xLabel
 * @param {string} [opts.titleText]
 * @param {string} [opts.descText] - What the chart shows, for the SVG's
 *   accessible name. Without it the name is the title alone, which says
 *   nothing about the content — and nothing at all on an empty chart whose
 *   only content is the observed statistic (REQ-069).
 * @param {[number,number]} [opts.domain]
 * @param {number} [opts.observedStat]
 * @param {[number,number]} [opts.ciLines]
 * @param {'left'|'right'|'both'} [opts.direction]
 * @param {number} [opts.nullCenter] - For 'both' direction isExtreme
 * @param {((v: number) => boolean)} [opts.regionPredicate] - Custom region predicate (overrides direction-based)
 * @param {number} [opts.highlightIndex]
 * @param {Set<number>} [opts.highlightIndices]
 * @param {number[]} [opts.prevBinCounts]
 * @param {number[]} [opts.thresholds] - Explicit histogram thresholds
 * @param {number} [opts.numBins] - Bin count override (dotplot or histogram)
 * @param {number} [opts.binWidth] - Locked bin width for dotplot (overrides numBins)
 * @param {number} [opts.binOrigin] - Bin origin for dotplot grid alignment
 * @param {number} [opts.precision]
 * @param {'randomization'|'bootstrap'} [opts.pillMode]
 * @param {number} [opts.pValue] - Pre-computed p-value for pills
 * @param {string} [opts.proportionLabel] - Pre-computed proportion label for bootstrap pills
 * @returns {SimChartResult}
 */
/**
 * The parameter marker's colour: dark neutral, 9.7:1 on white, distinct from
 * both the purple statistic line and the chart's blue. See renderSimChart.
 */
const PARAMETER_COLOR = '#444';

/**
 * Everything past the drawn axis, counted and stated rather than drawn.
 *
 * The right-skewed statistics (χ², F) have no upper bound, so an axis wide
 * enough for the rarest draw squashes the body where all the mass is. Measured
 * at 2,000 draws, as a fraction of the drawn axis:
 *
 *   GOF blood_types   median 0.096   95% 0.344   rightmost draw 0.784
 *   GOF jury          median 0.132   95% 0.423   rightmost draw 0.846
 *   ANOVA baumann     median 0.099   95% 0.395   rightmost draw 0.964
 *
 * Half the mass in the left tenth, and the far right holding no draw at all.
 * Jeff, 2026-11-02: "I wonder if we could clip those very long tails in the
 * interest of clear pedagogy?"
 *
 * ⚠ The clipped draws must stay COUNTABLE, not merely disappear. `?readout=false`
 * asks the student to read the p-value off the picture by counting the tail, so
 * a draw that vanishes makes the picture disagree with the p-value beside it —
 * the objection already written at `simulate/goodness-of-fit/app.js`. Hence a
 * stated count, which is also easier to read than counting twenty dots.
 *
 * ⚠ Nothing is DRAWN past the break. An overflow bar was the first design and
 * was rejected (Jeff, 2026-11-02): it compresses a wide stretch of tail into one
 * bin, so at a 99% clip it stands about ten times its neighbours and reads as a
 * second hump. A number cannot misstate a shape.
 *
 * Both chart paths needed this, for opposite reasons — measured, not assumed:
 *
 *   computeBins([1,2,3,4,5,50,99], domain [0,10]) → bins 5 of 7, the rest
 *     silently DROPPED, so bar heights quietly stopped summing to n
 *   computeDots(same) → all 7 kept, centres at 50 and 99, which a d3 scale
 *     does NOT clamp and so paints outside the plot
 *
 * So the filter here is what makes the two agree, and it is a safety net for
 * every page that passes a domain: a mark can no longer land off-plot, and a
 * dropped mark can no longer go unmentioned.
 *
 * @param {number[]} stats
 * @param {[number,number]|undefined} domain
 * @returns {{ drawn: number[], beyond: number, below: number, remap: (i: number) => number }}
 */
function clipToDomain(stats, domain) {
  const identity = { drawn: stats, beyond: 0, below: 0, remap: (/** @type {number} */ i) => i };
  if (!domain) return identity;
  const [lo, hi] = domain;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return identity;
  let beyond = 0;
  let below = 0;
  for (const v of stats) {
    if (v > hi) beyond++;
    else if (v < lo) below++;
  }
  if (beyond === 0 && below === 0) return identity;
  /** @type {number[]} */ const drawn = [];
  /** @type {Map<number,number>} */ const index = new Map();
  for (let i = 0; i < stats.length; i++) {
    const v = stats[i];
    if (v >= lo && v <= hi) {
      index.set(i, drawn.length);
      drawn.push(v);
    }
  }
  return { drawn, beyond, below, remap: (i) => (i == null ? -1 : index.get(i) ?? -1) };
}

/**
 * The axis break and the count, at the right end of the plot.
 *
 * The label is #595959 on white — 7.0:1, above the 4.5:1 floor for text — and
 * the break is #666666, 5.7:1, above the 3:1 floor for a graphical mark. The
 * glyph is a shape (a double slash), not a colour, so neither carries meaning on
 * its own. The same sentence goes into the chart's `aria-label`, because a
 * screen-reader user counting a tail needs the number as much as a sighted one.
 *
 * @param {import('./types.js').ChartFrame} frame
 * @param {number} count
 * @param {number} at - the clip point, in data units
 */
function renderClipNote(frame, count, at) {
  const g = d3Selection.select(frame.inner).append('g')
    .attr('class', 'clip-note')
    .attr('aria-hidden', 'true');
  const x = frame.width;
  const y = frame.height;
  // ⚠ The label goes at the TOP right, not beside the break. The x-axis label is
  // centred at `height + margin.bottom - 8` — the same baseline the first draft
  // used — so on a narrow viewport the two collide. The top right of a
  // right-skewed distribution is empty by construction, and the pills sit at 60%
  // of the height, so nothing else is up there.
  const labelY = 12;
  // The break: two slashes across the axis end, saying the line stops short of
  // the data rather than the data stopping short of the line.
  for (const dx of [-4, 1]) {
    g.append('line')
      .attr('x1', x + dx - 3).attr('y1', y + 5)
      .attr('x2', x + dx + 3).attr('y2', y - 5)
      .attr('stroke', '#FFFFFF').attr('stroke-width', 3);
    g.append('line')
      .attr('x1', x + dx - 3).attr('y1', y + 5)
      .attr('x2', x + dx + 3).attr('y2', y - 5)
      .attr('stroke', '#666666').attr('stroke-width', 1);
  }
  // ⚠ `formatStat`'s default branch is `toFixed(d + 1)`, so `1` means two
  // decimals. Passing the chart's own precision gave "+5 beyond 13.0412".
  const label = `+${count} beyond ${formatStat(at, 1)}`;
  g.append('text')
    .attr('class', 'clip-note-label')
    .attr('x', x)
    .attr('y', labelY)
    .attr('text-anchor', 'end')
    .attr('font-size', '11px')
    .attr('fill', '#595959')
    .text(label);
  // Same sentence, spelled out, for anyone reading the chart by its label.
  // ⚠ These charts carry no `<desc>` element — `createChartFrame` puts the
  // description in the SVG's `aria-label`, so appending to a `<desc>` was a
  // silent no-op that left screen-reader users with a tail they could not count.
  const draws = count === 1 ? 'draw is' : 'draws are';
  const prev = frame.svg.getAttribute('aria-label') ?? '';
  frame.svg.setAttribute('aria-label', `${prev} ${count} ${draws} beyond `
    + `${formatStat(at, 1)}, past the right end of the axis; they are `
    + `counted in the p-value but not drawn.`);
}

export function renderSimChart(container, stats, opts) {
  container.innerHTML = '';

  // Opt-in reasoning-mode overlay: draggable cutoff line(s) with a live tail
  // readout. `?cutlines=ci|tail` — read straight from the URL so every sim tool
  // that calls renderSimChart gets it with no per-tool wiring. Cutlines ride on
  // a binned shape (spike bars or histogram) — never a raw dot cloud — so if the
  // caller asked for a dotplot while cutlines are on, coerce to a histogram.
  const cutlinesMode = opts.cutlines
    ?? (typeof location !== 'undefined' && new URLSearchParams(location.search).get('cutlines'));
  const cutlinesOn = cutlinesMode === 'ci' || cutlinesMode === 'tail';
  let effectiveChartType = opts.chartType;
  if (cutlinesOn && effectiveChartType !== 'spike') effectiveChartType = 'histogram';

  // `?observed=off` hides the observed-stat marker (handled inside the chart
  // primitives) AND must suppress the auto tail-shading below, which would
  // otherwise reveal the observed location the student is meant to place.
  const observedOff = typeof location !== 'undefined'
    && new URLSearchParams(location.search).get('observed') === 'off';

  // Clip the long right tail: count what lies past the axis, do not draw it.
  // `stats` stays whole below — every probability, pill and p-value is computed
  // from all of it — and only the GEOMETRY uses `drawnStats`.
  const clip = clipToDomain(stats, opts.domain);
  const drawnStats = clip.drawn;
  const highlightIndex = clip.beyond + clip.below > 0
    ? clip.remap(opts.highlightIndex ?? -1)
    : (opts.highlightIndex ?? -1);
  // ⚠ A Set, not an array — `computeHighlights` returns `Set<number>`, and the
  // first draft called `.map` on it and took every chart on three pages down.
  const highlightIndices = clip.beyond + clip.below > 0 && opts.highlightIndices
    ? new Set([...opts.highlightIndices].map(clip.remap).filter((i) => i >= 0))
    : opts.highlightIndices;

  // Build region predicate from direction if not provided
  let regionPred = opts.regionPredicate;
  if (!regionPred && !observedOff && opts.observedStat != null && opts.direction) {
    const obs = opts.observedStat;
    const dir = opts.direction;
    const nc = opts.nullCenter;
    regionPred = (v) => isExtreme(v, obs, dir, nc);
  }

  /** @type {import('./types.js').ChartFrame} */
  let frame;
  /** @type {any} */
  let xScale;
  /** @type {any} */
  let yScale;
  /** @type {any[]} */
  let bins = [];
  /** @type {[number,number]|undefined} */
  let chartDomain = opts.domain;
  /** @type {number|undefined} */
  let dotMaxStack;
  /** @type {number|undefined} */
  let dotBinWidth;
  /** @type {((count: number) => number)|undefined} */
  let dotCountToY;

  if (effectiveChartType === 'dotplot') {
    const r = drawDotplot(container, drawnStats, {
      id: opts.id,
      xLabel: opts.xLabel,
      titleText: opts.titleText ?? 'Null Distribution',
      descText: opts.descText,
      isExtreme: regionPred,
      observedStat: opts.observedStat,
      ciLines: opts.ciLines,
      animate: false,
      domain: opts.domain,
      numBins: opts.numBins,
      binWidth: opts.binWidth,
      binOrigin: opts.binOrigin,
      highlightIndex: highlightIndex,
      highlightIndices: highlightIndices,
      precision: opts.precision,
      baseFill: opts.baseFill,
      extremeFill: opts.extremeFill,
    });
    frame = r.frame;
    xScale = r.xScale;
    dotMaxStack = r.maxStack;
    dotBinWidth = r.binWidth;
    // The dotplot's own count → pixel-y mapping, which an overlay (e.g. a theory
    // curve) must use to line up: stacked dots at small n, a y-axis scale once the
    // stacks overflow into filled columns.
    dotCountToY = r.countToY;
    if (r.maxStack > 0 && frame) {
      yScale = d3Scale.scaleLinear()
        .domain([0, r.maxStack * 1.05])
        .range([frame.height, 0]);
    }
    chartDomain = opts.domain;
  } else if (effectiveChartType === 'spike') {
    // Discrete non-touching bars — one per distinct value — for a discrete
    // statistic (a sample proportion) at small/moderate n.
    const r = drawSpike(container, drawnStats, {
      id: opts.id,
      xLabel: opts.xLabel,
      titleText: opts.titleText ?? 'Null Distribution',
      descText: opts.descText,
      isTail: regionPred,
      observedStat: opts.observedStat,
      ciLines: opts.ciLines,
      animate: false,
      domain: opts.domain,
      precision: opts.precision,
    });
    frame = r.frame;
    xScale = r.xScale;
    yScale = r.yScale;
    chartDomain = opts.domain;
  } else {
    const r = drawHistogram(container, drawnStats, {
      id: opts.id,
      xLabel: opts.xLabel,
      titleText: opts.titleText ?? 'Null Distribution',
      descText: opts.descText,
      isTail: regionPred,
      observedStat: opts.observedStat,
      ciLines: opts.ciLines,
      animate: false,
      domain: opts.domain,
      thresholds: opts.thresholds,
      prevBinCounts: opts.prevBinCounts,
      numBins: opts.numBins,
      precision: opts.precision,
    });
    frame = r.frame;
    xScale = r.xScale;
    yScale = r.yScale;
    bins = r.bins;
    chartDomain = opts.domain || [0, 1];
  }

  // Add probability pills
  if (frame && xScale && stats.length > 0 && opts.pillMode) {
    if (opts.pillMode === 'randomization' && opts.observedStat != null && opts.direction) {
      renderSimPills(frame, xScale, {
        mode: 'randomization',
        pValue: opts.pValue ?? 0,
        observedStat: opts.observedStat,
        direction: opts.direction,
      });
    } else if (opts.pillMode === 'bootstrap' && opts.ciLines) {
      const propLabel = opts.proportionLabel ??
        formatStat(stats.filter(v => v >= opts.ciLines[0] && v <= opts.ciLines[1]).length / stats.length, 0, 'proportion');
      renderSimPills(frame, xScale, {
        mode: 'bootstrap',
        proportionLabel: propLabel,
        ci: opts.ciLines,
      });
    }
  }

  // Draw the draggable cutoff line(s) over the binned shape (spike bars or
  // histogram) — the mass is read from the stats, so either works.
  if (cutlinesOn && frame && xScale && stats.length > 0
      && (effectiveChartType === 'histogram' || effectiveChartType === 'spike')) {
    renderCutlines(frame, xScale, stats, {
      mode: /** @type {'ci'|'tail'} */ (cutlinesMode),
      direction: opts.direction,
      precision: opts.precision,
    });
  }

  // The value H₀ names, marked on the distribution it generated.
  //
  // A null distribution is CENTRED on the null value by construction, and until
  // now nothing on the chart said so: the only line was the observed statistic.
  // So a student could run a thousand simulations against μ₀ = 0 on data
  // centred near 130, get p = 0, and never see that the question was the
  // problem (the one-mean page defaulted μ₀ to 0 and ignored the value its own
  // datasets carry — fixed 2026-10-03, and this is what makes it visible).
  //
  // Dark and dashed, deliberately NOT purple: purple means "the statistic you
  // observed" on every randomization page, and the Sampling Distribution Lab
  // already spends purple on the parameter. Rather than make one colour mean
  // both things a week apart, the parameter gets its own quiet treatment here.
  // (Jeff, 2026-10-03.)
  //
  // Only the one-sample pages pass it. On the two-group and paired tests the
  // null is 0, the axis already crosses there, and a line would say what the
  // axis says.
  if (opts.parameterMark && frame && xScale && stats.length > 0) {
    const { value, label } = opts.parameterMark;
    if (Number.isFinite(value)) {
      const overlays = d3Selection.select(frame.inner).select('.overlays');
      renderOverlayLine(overlays, value, xScale, frame.height, PARAMETER_COLOR,
        label, opts.precision ?? 2, label, true);
      // Re-settle every label, including the one just added — the observed line
      // and the parameter can land on top of each other, and when they do it is
      // because the two are close, which is exactly when you want to read both.
      deoverlapLabels([...frame.inner.querySelectorAll('.overlays text')]);
    }
  }

  // The stated count for everything past the axis. Drawn last so it sits over
  // the plot, and only when there is something to state.
  if (frame && clip.beyond > 0 && opts.domain) {
    renderClipNote(frame, clip.beyond, opts.domain[1]);
  }

  return { frame, xScale, yScale, bins, domain: chartDomain, maxStack: dotMaxStack, binWidth: dotBinWidth, countToY: dotCountToY };
}
