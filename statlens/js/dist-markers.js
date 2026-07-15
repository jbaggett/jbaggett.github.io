// @ts-check
/**
 * Shared distribution-chart marker primitives.
 *
 * These are the interactive SVG overlays used on the probability-distribution
 * calculator pages (js/dist-app.js) AND the confidence-interval estimation
 * figure (js/critical-value-figure.js): dashed draggable boundary lines,
 * click-to-edit probability pills, editable critical-value boxes on the axis,
 * and the small "snap" triangles marking common values.
 *
 * Each primitive is a pure drawing function that takes a D3 annotations group,
 * the chart frame, the x-scale, and callbacks — it owns NO page state. The
 * caller decides what a drag/edit means (update an input, recompute a level,
 * etc.). This keeps a single source of truth for the look-and-feel while each
 * page keeps its own semantics.
 */

import { pillDimensions } from './chart-utils.js';
import { enableHorizontalDrag, showInlineEdit, formatEditValue } from './chart-interactions.js';
import * as d3Selection from 'd3-selection';

const BLUE = '#569BBD';
const PURPLE = '#7B2D8E';
const GRAY_TEXT = '#6B6B6B';

/**
 * Small upward triangles on the x-axis baseline at each snap value in domain.
 * @param {*} group - D3 selection of the `.annotations` group
 * @param {import('./types.js').ChartFrame} frame
 * @param {import('d3-scale').ScaleLinear<number,number>} xScale
 * @param {number[]} xs - Data-space x positions (unfiltered; off-domain skipped)
 */
export function drawSnapTriangles(group, frame, xScale, xs) {
  const [lo, hi] = xScale.domain();
  const y = frame.height;
  const size = 4;
  for (const sp of xs) {
    if (!(sp > lo && sp < hi)) continue;
    const px = xScale(sp);
    group.append('polygon')
      .attr('class', 'snap-indicator')
      .attr('points', `${px},${y} ${px - size},${y + size + 1} ${px + size},${y + size + 1}`)
      .attr('fill', BLUE)
      .attr('opacity', 0.5);
  }
}

/**
 * A draggable dashed vertical boundary line with an invisible wide grab handle.
 * The primitive moves ITS OWN line + handle during drag (snapped); the caller's
 * `onDrag(newX)` does everything else (mirror a partner, update labels, …).
 *
 * @param {*} group
 * @param {import('./types.js').ChartFrame} frame
 * @param {import('d3-scale').ScaleLinear<number,number>} xScale
 * @param {number} value - Data-space x position
 * @param {object} [opts]
 * @param {'single'|'lo'|'hi'} [opts.boundKey='single']
 * @param {(rawX: number) => number} [opts.snap] - Snap raw pointer-x → data-x
 * @param {(newX: number) => void} [opts.onDrag] - Called each move with snapped x
 * @param {(newX: number) => void} [opts.onDragEnd]
 * @returns {{ line: any, handle: any }}
 */
export function addBoundaryLine(group, frame, xScale, value, opts = {}) {
  const { boundKey = 'single', snap = (x) => x, onDrag = () => {}, onDragEnd } = opts;
  const px = xScale(value);
  const handleWidth = 44;

  const line = group.append('line')
    .attr('class', 'crit-line')
    .attr('data-bound', boundKey)
    .attr('x1', px).attr('y1', 0)
    .attr('x2', px).attr('y2', frame.height)
    .attr('stroke', '#333')
    .attr('stroke-width', 1.5)
    .attr('stroke-dasharray', '6,3');

  const handle = group.append('rect')
    .attr('class', 'drag-handle')
    .attr('data-bound', boundKey)
    .attr('x', px - handleWidth / 2)
    .attr('y', 0)
    .attr('width', handleWidth)
    .attr('height', frame.height)
    .attr('fill', 'transparent')
    .attr('cursor', 'ew-resize');

  enableHorizontalDrag(
    handle.node(),
    /** @type {SVGSVGElement} */ (frame.svg),
    frame,
    xScale,
    (rawX) => {
      const newX = snap(rawX);
      const newPx = xScale(newX);
      line.attr('x1', newPx).attr('x2', newPx);
      handle.attr('x', newPx - handleWidth / 2);
      onDrag(newX);
    },
    onDragEnd,
  );

  return { line, handle };
}

/**
 * A probability label in a rounded pill inside a region, with a dashed leader
 * line to the shaded area. Optionally click-to-edit.
 *
 * @param {*} group
 * @param {import('./types.js').ChartFrame} frame
 * @param {import('d3-scale').ScaleLinear<number,number>} xScale
 * @param {number} xLo - Region left edge (data space)
 * @param {number} xHi - Region right edge (data space)
 * @param {number} prob
 * @param {object} [opts]
 * @param {boolean} [opts.isComplement=false] - Lighter "not primary" styling
 * @param {(dataX: number, pillBottomY: number) => number} [opts.leaderEndY] - Leader endpoint y
 * @param {HTMLElement} [opts.editContainer] - Container for the inline-edit overlay
 * @param {(newProb: number) => void} [opts.onEdit] - Commit handler (enables editing)
 * @param {string} [opts.tip='Click to edit this probability']
 * @returns {{ textEl: any, bgRect: any }}
 */
export function addProbPill(group, frame, xScale, xLo, xHi, prob, opts = {}) {
  const { isComplement = false, leaderEndY, editContainer, onEdit, tip = 'Click to edit this probability' } = opts;
  const labelY = frame.height * 0.6;
  const midX = (xLo + xHi) / 2;
  const midPx = xScale(midX);
  const clampedX = Math.max(45, Math.min(frame.width - 45, midPx));

  const labelText = prob.toFixed(4);
  const { charW, pad, pillH } = pillDimensions('prob');
  const textWidth = labelText.length * charW + pad;
  const editable = typeof onEdit === 'function';

  const bgRect = group.append('rect')
    .attr('class', isComplement ? 'prob-label-bg prob-complement-bg' : 'prob-label-bg')
    .attr('x', clampedX - textWidth / 2)
    .attr('y', labelY - pillH / 2)
    .attr('width', textWidth)
    .attr('height', pillH)
    .attr('rx', 4)
    .attr('fill', isComplement ? '#ffffff' : '#e8f4f8')
    .attr('stroke', isComplement ? '#888' : BLUE)
    .attr('stroke-width', 1)
    .attr('cursor', editable ? 'pointer' : 'default');
  if (editable) bgRect.append('title').text(tip);

  const textEl = group.append('text')
    .attr('class', isComplement ? 'prob-label prob-complement' : 'prob-label')
    .attr('x', clampedX)
    .attr('y', labelY)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'central')
    .attr('fill', isComplement ? GRAY_TEXT : PURPLE)
    .attr('cursor', editable ? 'pointer' : 'default')
    .text(labelText);

  const leaderTargetX = Math.max(4, Math.min(frame.width - 4, midPx));
  const pillBottomY = labelY + pillH / 2 + 2;
  const endY = leaderEndY ? leaderEndY(midX, pillBottomY) : Math.max((labelY + frame.height) / 2, (pillBottomY + frame.height) / 2);
  group.append('line')
    .attr('class', 'prob-leader')
    .attr('x1', clampedX).attr('y1', pillBottomY)
    .attr('x2', leaderTargetX).attr('y2', endY)
    .attr('stroke', isComplement ? '#888' : BLUE)
    .attr('stroke-width', 1)
    .attr('stroke-dasharray', '3,2')
    .style('pointer-events', 'none');

  if (editable) {
    const clickHandler = async () => {
      const newProb = await showInlineEdit(editContainer, textEl.node(), prob, prob.toFixed(4));
      if (newProb == null || newProb <= 0 || newProb >= 1) return;
      onEdit(newProb);
    };
    textEl.on('click', clickHandler);
    bgRect.on('click', clickHandler);
  }

  return { textEl, bgRect };
}

/**
 * An editable critical-value box sitting just below the x-axis, with overlapping
 * axis tick labels hidden. Optionally click-to-edit.
 *
 * @param {*} group
 * @param {import('./types.js').ChartFrame} frame
 * @param {import('d3-scale').ScaleLinear<number,number>} xScale
 * @param {number} value
 * @param {object} [opts]
 * @param {HTMLElement} [opts.editContainer]
 * @param {(newVal: number) => void} [opts.onEdit]
 * @param {boolean} [opts.hideOverlappingTicks=true]
 * @returns {{ textEl: any }}
 */
export function addAxisValueBox(group, frame, xScale, value, opts = {}) {
  const { editContainer, onEdit, hideOverlappingTicks = true } = opts;
  const px = xScale(value);
  const labelText = formatEditValue(value);
  const { charW, pad, pillH } = pillDimensions('crit');
  const textWidth = labelText.length * charW + pad;
  const editable = typeof onEdit === 'function';

  group.append('rect')
    .attr('class', 'crit-label-bg')
    .attr('x', px - textWidth / 2)
    .attr('y', frame.height + 6)
    .attr('width', textWidth)
    .attr('height', pillH)
    .attr('rx', 3)
    .attr('fill', '#fff')
    .attr('stroke', BLUE)
    .attr('stroke-width', 1)
    .attr('cursor', editable ? 'pointer' : 'default');

  const textEl = group.append('text')
    .attr('class', 'crit-label')
    .attr('x', px)
    .attr('y', frame.height + 6 + pillH / 2)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'central')
    .attr('fill', '#333')
    .attr('cursor', editable ? 'pointer' : 'default')
    .text(labelText);

  if (hideOverlappingTicks) {
    const pillRanges = [[px - textWidth / 2, px + textWidth / 2]];
    const inner = d3Selection.select(frame.inner);
    inner.select('.x-axis').selectAll('.tick').each(function () {
      const tick = d3Selection.select(this);
      const tickX = parseFloat(tick.attr('transform')?.replace(/translate\(([^,]+).*/, '$1') || '0');
      for (const [lo, hi] of pillRanges) {
        if (tickX >= lo - 4 && tickX <= hi + 4) {
          tick.select('text').attr('visibility', 'hidden');
          break;
        }
      }
    });
  }

  if (editable) {
    const clickHandler = async () => {
      const newVal = await showInlineEdit(editContainer, textEl.node(), value);
      if (newVal == null) return;
      onEdit(newVal);
    };
    textEl.on('click', clickHandler);
    textEl.node()?.previousSibling &&
      d3Selection.select(textEl.node().previousSibling).on('click', clickHandler);
  }

  return { textEl };
}
