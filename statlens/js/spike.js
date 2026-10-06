// @ts-check
/**
 * Spike (lollipop) chart module for StatLens.
 * Shows vertical lines at each discrete value, ideal for proportion data.
 *
 * @import { ChartFrame } from './types.js'
 */

import * as d3Array from 'd3-array';
import * as d3Scale from 'd3-scale';
import * as d3Selection from 'd3-selection';
import * as d3Axis from 'd3-axis';
import { createChart, addAxes, formatTick, valueFormat, setLabelText, attachTooltip } from './chart-utils.js';

/** Default spike color (IMS blue) — used when no isTail predicate. */
const SPIKE_COLOR = '#569BBD';

/** Body spike color when isTail is active (subdued gray, WCAG 3:1). */
const BODY_SPIKE = '#8a8a8a';

/** Region-of-interest spike color when isTail is active (bold IMS blue). */
const REGION_SPIKE = '#569BBD';

/** Spike cap radius. */
const CAP_RADIUS = 3;

/**
 * Count occurrences of each unique value (rounded to avoid float issues).
 * @param {number[]} values
 * @param {number} [precision] - Decimal places to round to
 * @returns {Map<number, number>}
 */
function countValues(values, precision = 8) {
  const counts = new Map();
  for (const v of values) {
    const key = Math.round(v * 10 ** precision) / 10 ** precision;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Draw a spike chart into a container element.
 *
 * @param {string|Element} container - CSS selector or DOM element
 * @param {number[]} values - Numeric data
 * @param {object} [options]
 * @param {string} [options.xLabel] - X-axis label
 * @param {string} [options.yLabel] - Y-axis label (default: "Frequency")
 * @param {string} [options.titleText] - Chart title for accessibility
 * @param {string} [options.descText] - Chart description for accessibility
 * @param {string} [options.id] - Unique ID prefix
 * @param {(value: number) => boolean} [options.isTail] - Predicate for tail shading
 * @param {number} [options.observedStat] - Value for observed statistic vertical line
 * @param {string} [options.observedLabel] - Label prefix for the observed line (e.g. "p")
 * @param {number} [options.viewHeight] - Override SVG viewBox height (compact mode)
 * @param {boolean} [options.showExport] - Whether to render copy/download buttons
 * @param {[number,number]} [options.ciLines] - CI bound values to draw as vertical lines
 * @param {string} [options.ciColor] - Colour of the CI bound lines (default: dusty red)
 * @param {boolean} [options.animate] - Whether to animate (default: true)
 * @param {[number,number]} [options.domain] - Override x-axis domain
 * @param {{top:number,right:number,bottom:number,left:number}} [options.margin]
 * @param {number[]} [options.prevCounts] - Previous counts per value for delta highlight
 * @param {string} [options.color] - Base spike/cap colour (default IMS blue); ignored where isTail applies
 * @param {number} [options.precision] - Decimal places for values in tooltips and
 *   screen-reader labels; omit for the compact axis format
 * @returns {{ frame: ChartFrame, xScale: d3Scale.ScaleLinear<number,number>, yScale: d3Scale.ScaleLinear<number,number>, counts: Map<number, number> }}
 */
export function drawSpike(container, values, options = {}) {
  const {
    xLabel,
    yLabel = 'Frequency',
    titleText = 'Spike Chart',
    descText = '',
    id,
    isTail,
    /** @type {{below: number, above: number}|undefined} Rank cut, for a spike
     *  that straddles the boundary (see the comment at the lines below). */
    splitRanks,
    observedStat,
    ciLines,
    ciColor = '#B5747A',
    animate = true,
    margin,
    domain: domainOpt,
    prevCounts,
    viewHeight,
    showExport,
    observedLabel,
    color,
    showObservedMarker,
    // Decimal places for the values shown to the reader. A spike plot is the
    // discrete picture of a statistic (each spike is one achievable k/n), so
    // the value under the cursor should read the same as the page's own p̂.
    precision,
  } = options;
  const fmtValue = valueFormat(precision);
  // The marker labels had a hardcoded 2 places, so an observed 209.420 was
  // drawn as 209.42 next to a readout saying 209.420. Keep 2 as the fallback.
  const overlayPrecision = Number.isFinite(precision) ? precision : 2;
  // Reasoning-mode `?observed=off` hides the observed-statistic marker so a
  // student must place the cutoff line at the value given in the problem text.
  const showObsMarker = showObservedMarker ?? (
    typeof location === 'undefined' ||
    new URLSearchParams(location.search).get('observed') !== 'off'
  );
  // Base spike/cap colour when no isTail predicate is active (default IMS blue).
  const baseColor = color || SPIKE_COLOR;

  const frame = createChart(container, {
    titleText, descText, id, margin, showExport,
    ...(viewHeight != null && { viewHeight }),
  });
  const counts = countValues(values);
  const keys = [...counts.keys()].sort((a, b) => a - b);
  const total = values.length;

  // Domain
  let lo, hi;
  if (domainOpt) {
    [lo, hi] = domainOpt;
  } else if (keys.length > 0) {
    lo = keys[0];
    hi = keys[keys.length - 1];
    const pad = (hi - lo) * 0.05 || 0.5;
    lo -= pad;
    hi += pad;
  } else {
    lo = 0;
    hi = 1;
  }

  const xScale = d3Scale.scaleLinear()
    .domain([lo, hi])
    .range([0, frame.width]);

  const maxCount = d3Array.max([...counts.values()]) ?? 1;
  const yScale = d3Scale.scaleLinear()
    .domain([0, maxCount])
    .nice()
    .range([frame.height, 0]);

  const xAxis = d3Axis.axisBottom(xScale).tickFormat(formatTick).tickSizeOuter(0);
  const yAxis = d3Axis.axisLeft(yScale).tickFormat(formatTick);
  addAxes(frame, xAxis, yAxis, xLabel, yLabel);

  const dataGroup = d3Selection.select(frame.inner).select('.data');

  // Render spikes
  const spikeData = keys.map(k => ({ value: k, count: counts.get(k) ?? 0 }));

  // Lines, in up to two pieces.
  //
  // `splitRanks` says how many of the sorted values fall outside the region at
  // each end, which on a lattice is the only way to say "two of these
  // twenty-eight". A spike that straddles the cut is drawn grey up to the cut
  // and coloured above it at the left bound, and the other way round at the
  // right — the StatKey picture, and the same rule the dotplot's columns use.
  // (Jeff, 2026-10-04.)
  /** @type {Array<{value:number, count:number, from:number, to:number, region:boolean}>} */
  const pieces = [];
  if (splitRanks) {
    let seen = 0;
    const loCut = splitRanks.below, hiCut = total - splitRanks.above;
    for (const d of spikeData) {
      const start = seen, end = seen + d.count;
      seen = end;
      // [start, end) are this spike's ranks. Split at the two cuts.
      // `isTail` has always meant "in the region of interest" — the CI for a
      // bootstrap, the tail for a randomization — so the middle piece is the
      // one that gets the region colour.
      const parts = [
        { n: Math.max(0, Math.min(end, loCut) - start), region: false },
        { n: Math.max(0, Math.min(end, hiCut) - Math.max(start, loCut)), region: true },
        { n: Math.max(0, end - Math.max(start, hiCut)), region: false },
      ].filter(q => q.n > 0);
      let base = 0;
      for (const q of parts) {
        pieces.push({ value: d.value, count: d.count, from: base, to: base + q.n, region: q.region });
        base += q.n;
      }
    }
  } else {
    for (const d of spikeData) {
      pieces.push({ value: d.value, count: d.count, from: 0, to: d.count,
        region: isTail ? !!isTail(d.value) : false });
    }
  }

  dataGroup.selectAll('.spike-line')
    .data(pieces)
    .join('line')
    .attr('class', 'spike-line')
    .attr('x1', d => xScale(d.value))
    .attr('x2', d => xScale(d.value))
    .attr('y1', d => (d.from === 0 ? frame.height : yScale(d.from)))
    .attr('y2', d => yScale(d.to))
    .attr('stroke', d => {
      if (!isTail && !splitRanks) return baseColor;
      return d.region ? REGION_SPIKE : BODY_SPIKE;
    })
    .attr('stroke-width', 2)
    .attr('role', 'listitem')
    .attr('aria-label', d => `${fmtValue(d.value)}: ${d.count}`);

  // Caps (small circles at top)
  dataGroup.selectAll('.spike-cap')
    .data(spikeData)
    .join('circle')
    .attr('class', 'spike-cap')
    .attr('cx', d => xScale(d.value))
    .attr('cy', d => yScale(d.count))
    .attr('r', CAP_RADIUS)
    // The cap belongs to the TOP of its spike, so on a split spike it takes the
    // upper piece's colour — grey on the right-hand boundary spike, where the
    // part above the cut is outside the interval.
    .attr('fill', d => {
      if (!isTail && !splitRanks) return baseColor;
      const top = pieces.filter(q => q.value === d.value).pop();
      if (top) return top.region ? REGION_SPIKE : BODY_SPIKE;
      return isTail && isTail(d.value) ? REGION_SPIKE : BODY_SPIKE;
    });

  // Tooltips (mouse + keyboard)
  attachTooltip(dataGroup.selectAll('.spike-line'), frame.inner, (d) => ({
    lines: [fmtValue(d.value), `Frequency: ${d.count}`],
    x: xScale(d.value),
    y: yScale(d.count),
  }));

  // Click spike → show count label
  dataGroup.selectAll('.spike-line')
    .style('cursor', 'pointer')
    .on('click', function (event, d) {
      dataGroup.selectAll('.spike-count-label').remove();
      dataGroup.selectAll('.spike-line').attr('stroke-width', 2);
      d3Selection.select(this).attr('stroke-width', 3.5);
      dataGroup.append('text')
        .attr('class', 'spike-count-label')
        .attr('x', xScale(d.value))
        .attr('y', yScale(d.count) - 8)
        .attr('text-anchor', 'middle')
        .attr('fill', '#000')
        .attr('font-size', '0.75rem')
        .text(d.count);
    });

  // Overlay lines (observed stat, CI bounds)
  const overlays = d3Selection.select(frame.inner).select('.overlays');
  if (observedStat != null && showObsMarker) {
    renderOverlayLine(overlays, observedStat, xScale, frame.height,
      '#7B2D8E', 'Observed statistic', false, observedLabel ? `${observedLabel} = ` : '',
      overlayPrecision);
  }
  if (ciLines) {
    renderOverlayLine(overlays, ciLines[0], xScale, frame.height,
      ciColor, 'CI lower bound', true, '', overlayPrecision);
    renderOverlayLine(overlays, ciLines[1], xScale, frame.height,
      ciColor, 'CI upper bound', true, '', overlayPrecision);
  }

  return { frame, xScale, yScale, counts };
}

/**
 * Render a vertical overlay line.
 * @param {d3Selection.Selection} overlays
 * @param {number} value
 * @param {d3Scale.ScaleLinear<number,number>} xScale
 * @param {number} innerHeight
 * @param {string} color
 * @param {string} label
 */
function renderOverlayLine(overlays, value, xScale, innerHeight, color, label, dashed = false, prefix = '', precision = 2) {
  const x = xScale(value);
  const line = overlays.append('line')
    .attr('x1', x).attr('x2', x)
    .attr('y1', 0).attr('y2', innerHeight)
    .attr('stroke', color)
    .attr('stroke-width', dashed ? 2 : 2.5)
    .attr('aria-label', `${label}: ${value.toFixed(precision)}`);
  if (dashed) line.attr('stroke-dasharray', '6,3');
  overlays.append('text')
    .attr('class', 'overlay-value')
    .attr('x', x).attr('y', -4)
    .attr('text-anchor', 'middle')
    .attr('fill', color)
    .each(function () {
      setLabelText(/** @type {SVGTextElement} */ (this), prefix + value.toFixed(precision));
    });
}
