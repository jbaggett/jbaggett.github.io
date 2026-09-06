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
 * How large chart text should actually appear, in CSS pixels.
 *
 * Font sizes inside a viewBox are units, not pixels, so the same number renders
 * at a different size on every screen. Rather than guessing per breakpoint —
 * which got a landscape phone wrong, treating 664x390 as a desktop and shrinking
 * its labels to 11px at the exact moment the reader turned the phone to see
 * better — the scale is MEASURED after layout and the unit size solved for.
 */
const TARGET_TEXT_PX = 13;

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

  // Solve for the font unit that lands at TARGET_TEXT_PX once the browser has
  // scaled the viewBox to its actual display width. Clamped, so a chart in a
  // very narrow or very wide box still gets a sane size.
  let unit = 12;
  function applyTextScale() {
    const shown = /** @type {SVGSVGElement} */ (svg.node()).getBoundingClientRect().width;
    if (!shown) return;                       // not laid out yet (hidden tab, say)
    const scale = shown / width;
    unit = Math.max(9, Math.min(24, TARGET_TEXT_PX / scale));
    // A custom property, not `font-size`: d3-axis puts font-size="10" on the
    // axis group it builds, so `1em` on a tick would resolve against THAT
    // rather than against this element. Custom properties inherit past it.
    svg.style('--chart-text', `${unit.toFixed(2)}px`);
  }

  const gAxes = svg.append('g').attr('class', 'axes');
  const plot = svg.append('g').attr('class', 'plot').attr('clip-path', `url(#${clipId})`);
  const gOver = svg.append('g').attr('class', 'overlay');

  applyTextScale();
  // Re-solve whenever the box changes size — rotation, a resized window, a
  // sidebar opening. Cheaper than re-rendering, and the axis text picks it up
  // immediately because it is sized in em.
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(applyTextScale).observe(/** @type {Element} */ (root));
  }

  return {
    svg, plot, gAxes, gOver, width, height, margin,
    innerWidth: width - margin.left - margin.right,
    innerHeight: height - margin.top - margin.bottom,
    narrow,
    /**
     * Scale a font size given in desktop units (where 12 is body-ish).
     *
     * Text a tool sets numerically is in viewBox units, so it needs the same
     * solved scale the axis text gets from `em`.
     */
    fs: (/** @type {number} */ n) => Number(((n * unit) / 12).toFixed(2)),
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
