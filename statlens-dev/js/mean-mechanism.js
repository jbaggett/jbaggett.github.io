// @ts-check
/**
 * ONE shared mean-resampling mechanism (Tiles | Dotplot | Histogram), used by both
 * the bootstrap CI for a mean (sim-app.js) and the one-mean randomization test
 * (one-sample-sim.js). Previously each engine wired the rendering primitives
 * (dotplot-resample.js, summary-cards.js) separately, so the two strips drifted
 * — dot size, footprints, fly geometry, labels all diverged and had to be fixed
 * twice. This controller owns the render + sizing + view state so they can't.
 *
 * The ONLY real difference between the two pages — the randomization test first
 * shifts the sample to the null — lives in the caller: it just decides which
 * `values` to hand `renderBag`. This module never knows about the shift.
 */

import { drawMechDotplot, showResampleDotplot, mechDisplayWidth } from './dotplot-resample.js';
import { animateHistogramDraw } from './mechanisms/draw-animation.js';
import { createSharedScale } from './mechanisms/entities.js';
import { renderBagChips, renderResampleChips, CHIP_MAX } from './summary-cards.js';
import { drawMiniChart } from './chart-utils.js';
import { computeDots } from './dotplot.js';

/**
 * Dotplot view applies up to this n; tiles up to CHIP_MAX; above → histogram.
 *
 * Raised from 40 on 2026-09-27. Todd Will works at n ≈ 50 and was landing just
 * past the old cap, so the mechanism fell back to a pair of mini histograms —
 * the least informative of the three views, for a sample small enough to show
 * every value. The panels are ~220px wide, so what runs out first is stack
 * height rather than width, and drawDotplot falls back to filled columns when a
 * stack overflows; that degrades gracefully where a histogram simply throws the
 * individual observations away.
 */
export const MEAN_DOT_MAX = 80;

/**
 * @param {{ formatValue?: (v:number)=>string, initialView?: 'summary'|'dotplot' }} [config]
 */
export function createMeanMechanism(config = {}) {
  const formatValue = config.formatValue || ((v) => String(v));
  let view = config.initialView === 'dotplot' ? 'dotplot' : 'summary';
  /** @type {any} */ let bag = null;        // drawDotplot result (dotplot view)
  /** @type {HTMLElement[]} */ let bagChips = []; // chip elements (tiles view)
  /** @type {HTMLElement|null} */ let bagMiniEl = null;  // the bag's mini histogram host
  /** @type {number|null} */ let bagAnchor = null;       // the grid both panels are cut on
  // The bag and the resample must agree on dot size, or the eye reads two
  // differently-scaled pictures as comparable. That agreement used to hold
  // because both renders happened in this one closure — true by construction,
  // and only for as long as they stayed together. Stated now, so the two panels
  // can be placed anywhere and still line up (js/mechanisms/entities.js).
  const scale = createSharedScale();

  /** Tiles only for small n in tiles view. */
  const useCards = (/** @type {number} */ n) => n >= 2 && n <= CHIP_MAX && view === 'summary';
  /** Dotplot for small/medium n in dotplot view (or 30–40 in tiles view). */
  const useDots = (/** @type {number} */ n) => n >= 2 && n <= MEAN_DOT_MAX && !useCards(n);

  /** Reset the dot-sizing on a new dataset so the radius is recomputed. */
  function resetSizing() { scale.reset(); bagMiniEl = null; bagAnchor = null; }

  /**
   * Render the "bag" panel. `values` already reflect observed-vs-null (the caller
   * picks). Returns nothing; stores the bag for the resample's fly to draw from.
   * @param {HTMLElement} el
   * @param {number[]} values
   * @param {number} meanVal - the stat to mark (x̄ or μ₀)
   * @param {{ domain?: [number,number], label?: string, meanLabel?: string }} [opts]
   */
  function renderBag(el, values, meanVal, opts = {}) {
    if (!el || values.length < 2) return;
    if (useCards(values.length)) {
      bag = null;
      bagChips = renderBagChips(el, values, { formatValue, label: opts.label });
    } else if (useDots(values.length)) {
      bagChips = [];
      if (!scale.sizingMaxStack) {
        scale.fit(computeDots(values, { domain: opts.domain }).maxStack + 3, opts.domain);
      }
      // Measure HERE, on the source panel, and hand the number to the resample.
      // The resample's own panel is `hidden` until the first draw and measures
      // zero, so measuring per-panel would give the two plots different scales
      // on the very first render — the one render where they are side by side
      // and being compared.
      scale.width = mechDisplayWidth(el.parentElement);
      bag = drawMechDotplot(el, values, {
        domain: opts.domain, mean: meanVal, meanLabel: opts.meanLabel || 'x̄', sizingMaxStack: scale.sizingMaxStack,
        displayWidth: scale.width,
      });
    } else {
      bag = null; bagChips = [];
      // Remember where the bag's mini chart is, and the grid it was cut on, so
      // the resample can be cut the same way and animated out of it.
      bagMiniEl = el;
      bagAnchor = meanVal;
      drawMiniChart(el, values, {
        meanValue: meanVal, domain: opts.domain, label: opts.label || 'Sample distribution',
        binAnchor: meanVal,
      });
    }
  }

  /**
   * Render the resample panel (and animate it). `originalValues` is the bag the
   * resample was drawn from (so tiles can annotate ×N). Returns animation ms.
   * @param {HTMLElement} el
   * @param {number[]} originalValues
   * @param {number[]} resample
   * @param {number} stat - the resample's statistic (x̄*)
   * @param {boolean} animate
   * @param {{ domain?: [number,number], label?: string, meanLabel?: string, indices?: number[] }} [opts]
   */
  function renderResample(el, originalValues, resample, stat, animate, opts = {}) {
    if (!el || !resample || resample.length < 2) return 0;
    if (useCards(resample.length)) {
      return renderResampleChips(el, originalValues, resample, { formatValue, sourceChips: bagChips, animate });
    }
    if (useDots(resample.length) && bag) {
      return showResampleDotplot(el, bag, resample, {
        domain: opts.domain, mean: stat, meanLabel: opts.meanLabel || 'x̄*', sizingMaxStack: scale.sizingMaxStack, animate,
        displayWidth: scale.width,
        // Which observations this draw actually took — the animation cannot be
        // honest about repeats or misses without it (js/mechanisms/draws.js).
        indices: opts.indices,
      });
    }
    drawMiniChart(el, resample, {
      domain: opts.domain, meanValue: stat, highlightMean: animate, label: opts.label || 'Resample',
      // Same cut as the bag, or bar k here is not bar k there and the animation
      // between them would be matching up bins that do not correspond.
      binAnchor: bagAnchor ?? undefined,
    });
    if (!animate) return 0;
    return animateHistogramDraw({
      sourceSvg: bagMiniEl?.querySelector('svg.mech-minichart') ?? null,
      targetSvg: el.querySelector('svg.mech-minichart'),
    });
  }

  return {
    get view() { return view; },
    /** @param {string} v */
    setView(v) { view = v === 'dotplot' ? 'dotplot' : 'summary'; },
    useCards, useDots, resetSizing, renderBag, renderResample,
    get bag() { return bag; },
    get bagChips() { return bagChips; },
  };
}
