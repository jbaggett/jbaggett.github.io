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

import { drawMechDotplot, showResampleDotplot } from './dotplot-resample.js';
import { renderBagChips, renderResampleChips, CHIP_MAX } from './summary-cards.js';
import { drawMiniChart } from './chart-utils.js';
import { computeDots } from './dotplot.js';

/** Dotplot view applies up to this n; tiles up to CHIP_MAX; above → histogram. */
export const MEAN_DOT_MAX = 40;

/**
 * @param {{ formatValue?: (v:number)=>string, initialView?: 'summary'|'dotplot' }} [config]
 */
export function createMeanMechanism(config = {}) {
  const formatValue = config.formatValue || ((v) => String(v));
  let view = config.initialView === 'dotplot' ? 'dotplot' : 'summary';
  /** @type {any} */ let bag = null;        // drawDotplot result (dotplot view)
  /** @type {HTMLElement[]} */ let bagChips = []; // chip elements (tiles view)
  let sizingMax = 0;                         // shared bag/resample stack capacity

  /** Tiles only for small n in tiles view. */
  const useCards = (/** @type {number} */ n) => n >= 2 && n <= CHIP_MAX && view === 'summary';
  /** Dotplot for small/medium n in dotplot view (or 30–40 in tiles view). */
  const useDots = (/** @type {number} */ n) => n >= 2 && n <= MEAN_DOT_MAX && !useCards(n);

  /** Reset the dot-sizing on a new dataset so the radius is recomputed. */
  function resetSizing() { sizingMax = 0; }

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
      if (!sizingMax) sizingMax = computeDots(values, { domain: opts.domain }).maxStack + 3;
      bag = drawMechDotplot(el, values, {
        domain: opts.domain, mean: meanVal, meanLabel: opts.meanLabel || 'x̄', sizingMaxStack: sizingMax,
      });
    } else {
      bag = null; bagChips = [];
      drawMiniChart(el, values, { meanValue: meanVal, domain: opts.domain, label: opts.label || 'Sample distribution' });
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
   * @param {{ domain?: [number,number], label?: string, meanLabel?: string }} [opts]
   */
  function renderResample(el, originalValues, resample, stat, animate, opts = {}) {
    if (!el || !resample || resample.length < 2) return 0;
    if (useCards(resample.length)) {
      return renderResampleChips(el, originalValues, resample, { formatValue, sourceChips: bagChips, animate });
    }
    if (useDots(resample.length) && bag) {
      return showResampleDotplot(el, bag, resample, {
        domain: opts.domain, mean: stat, meanLabel: opts.meanLabel || 'x̄*', sizingMaxStack: sizingMax, animate,
      });
    }
    drawMiniChart(el, resample, {
      domain: opts.domain, meanValue: stat, highlightMean: animate, label: opts.label || 'Resample',
    });
    return 0;
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
