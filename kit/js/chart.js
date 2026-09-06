/**
 * The SVG frame, scales and axes every lens chart sits in.
 *
 * Axes follow the mathematics convention rather than the statistics one: they
 * cross at the origin when the origin is on screen, with the label at the
 * positive end, instead of a boxed frame with the axes pushed to the edges.
 */

import { scaleLinear } from 'd3-scale';
import { select } from 'd3-selection';
import { axisBottom, axisLeft } from 'd3-axis';

export const VIEW_WIDTH = 640;
export const VIEW_HEIGHT = 400;
export const MARGIN = { top: 16, right: 18, bottom: 30, left: 40 };
/**
 * Phone geometry.
 *
 * The viewBox is what sets the apparent text size, and this is the part that is
 * easy to get wrong twice. An SVG with a 640-unit viewBox displayed at 330 CSS
 * pixels renders its 12-unit tick labels at **6 pixels** — unreadable, and no
 * amount of CSS fixes it, because the units are being scaled down by the
 * viewBox. So the phone viewBox is made NARROW, close to 1:1 with the display
 * width, and everything inside it comes back up to size.
 *
 * 360 against a typical ~330px of usable phone width is a scale of about 0.92,
 * so a 14-unit label lands at roughly 13 real pixels.
 */
export const PHONE_WIDTH = 360;
export const PHONE_MARGIN = { top: 12, right: 12, bottom: 26, left: 34 };

/** Below this viewport width a chart is built with the phone geometry. */
export const NARROW_QUERY = '(max-width: 599px)';

/**
 * Build the responsive SVG frame every CalcLens chart sits in.
 *
 * Deliberately NO role="img": these charts carry keyboard-focusable children
 * (draggable handles, tabbable points), and role="img" flattens that subtree
 * out of the accessibility tree. aria-label alone is announced. Same reasoning
 * as StatLens `chart-utils.js`.
 *
 * @param {Element|string} container
 * @param {{width?:number, height?:number, margin?:object, label:string}} opts
 */
export function createChart(container, opts) {
  // On a phone the SVG is scaled to the screen width, so a wide viewBox becomes
  // a short, unreadable strip. A narrower viewBox buys back vertical space and
  // enlarges every label proportionally, without a single px of CSS override.
  const narrow = typeof window !== 'undefined'
    && window.matchMedia && window.matchMedia(NARROW_QUERY).matches;
  const {
    width = narrow ? PHONE_WIDTH : VIEW_WIDTH,
    height = VIEW_HEIGHT,
    margin = narrow ? PHONE_MARGIN : MARGIN,
    label,
  } = opts;
  const root = typeof container === 'string' ? document.querySelector(container) : container;
  select(root).selectAll('svg').remove();

  const svg = select(root).append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .attr('aria-label', label)
    .style('width', '100%')
    .style('height', 'auto')
    .style('display', 'block');

  const clipId = `clip-${Math.random().toString(36).slice(2, 9)}`;
  svg.append('defs').append('clipPath').attr('id', clipId)
    .append('rect')
    .attr('x', margin.left).attr('y', margin.top)
    .attr('width', width - margin.left - margin.right)
    .attr('height', height - margin.top - margin.bottom);

  const gAxes = svg.append('g').attr('class', 'axes');
  const plot = svg.append('g').attr('class', 'plot').attr('clip-path', `url(#${clipId})`);
  const gOver = svg.append('g').attr('class', 'overlay');

  return {
    svg, plot, gAxes, gOver, width, height, margin,
    innerWidth: width - margin.left - margin.right,
    innerHeight: height - margin.top - margin.bottom,
    narrow,
    /**
     * Scale a font size given in desktop units.
     *
     * Text drawn by a tool sets its size numerically, and those numbers are
     * viewBox units. On the narrower phone viewBox the same number is already
     * proportionally bigger, but not by enough for annotations that have to be
     * read across a room, so they get a further nudge.
     */
    fs: (/** @type {number} */ n) => (narrow ? Math.round(n * 1.15) : n),
    setLabel: (/** @type {string} */ text) => svg.attr('aria-label', text),
  };
}

/** Linear scales for a chart frame. */
export function makeScales(chart, xDomain, yDomain) {
  const xs = scaleLinear().domain(xDomain)
    .range([chart.margin.left, chart.width - chart.margin.right]);
  const ys = scaleLinear().domain(yDomain)
    .range([chart.height - chart.margin.bottom, chart.margin.top]);
  return { xs, ys };
}

/**
 * Draw axes the way a calculus text does: crossing at the origin when the
 * origin is on screen, dropped to the border when it is not, with arrowheads
 * and the label at the positive end of each axis.
 *
 * @param {ReturnType<typeof createChart>} chart
 * @param {{xs:any, ys:any, xLabel?:string, yLabel?:string, grid?:boolean}} opts
 */
export function drawAxes(chart, opts) {
  const { xs, ys, xLabel = 'x', yLabel = 'y', grid = true } = opts;
  const { gAxes, margin, width, height } = chart;
  gAxes.selectAll('*').remove();

  const clampX = (/** @type {number} */ v) =>
    Math.min(width - margin.right, Math.max(margin.left, v));
  const clampY = (/** @type {number} */ v) =>
    Math.min(height - margin.bottom, Math.max(margin.top, v));
  const x0 = clampX(xs(0));
  const y0 = clampY(ys(0));

  if (grid) {
    const g = gAxes.append('g').attr('class', 'll-grid');
    for (const t of xs.ticks(9)) {
      g.append('line').attr('x1', xs(t)).attr('x2', xs(t))
        .attr('y1', margin.top).attr('y2', height - margin.bottom);
    }
    for (const t of ys.ticks(6)) {
      g.append('line').attr('y1', ys(t)).attr('y2', ys(t))
        .attr('x1', margin.left).attr('x2', width - margin.right);
    }
  }

  gAxes.append('g').attr('class', 'll-axis ll-axis-x')
    .attr('transform', `translate(0,${y0})`)
    .call(axisBottom(xs).ticks(9).tickSizeOuter(0));
  gAxes.append('g').attr('class', 'll-axis ll-axis-y')
    .attr('transform', `translate(${x0},0)`)
    .call(axisLeft(ys).ticks(6).tickSizeOuter(0));

  // Hide the "0" label where the two axes collide and it reads as clutter.
  gAxes.selectAll('.ll-axis-x .tick text').filter(d => d === 0).style('display', 'none');

  gAxes.append('text').attr('class', 'll-axis-label')
    .attr('x', width - margin.right + 4).attr('y', y0 + 4).text(xLabel);
  gAxes.append('text').attr('class', 'll-axis-label')
    .attr('x', x0 + 6).attr('y', margin.top - 4).text(yLabel);
}

/**
 * Run `cb` when the viewport crosses the phone/desktop boundary.
 *
 * A chart is built once, so its geometry is frozen at whatever the viewport was
 * on load. Rotating a phone, or flipping Chrome's device toolbar, then leaves a
 * desktop-sized viewBox squeezed into a phone-sized box with six-pixel labels.
 * Tools call this, drop their cached chart, and re-render.
 *
 * @param {() => void} cb
 */
export function onBreakpointChange(cb) {
  if (typeof window === 'undefined' || !window.matchMedia) return;
  window.matchMedia(NARROW_QUERY).addEventListener('change', cb);
}
