// @ts-check
/**
 * Hovering a statistic to see the resample behind it.
 *
 * Built first inside js/one-sample-sim.js; js/sim-app.js needs the same thing
 * for eleven more tools, so it lives here rather than twice. The page keeps the
 * resamples (js/resample-store.js) and says how to describe one; this is the
 * wiring and the hit-testing.
 *
 * Two modes, picked by what is actually on screen rather than by the name of
 * the view:
 *
 *   exact        one mark per statistic (a dotplot at small n). The mark is
 *                stamped `data-stat-index`, so hover and keyboard focus both
 *                land on a known repetition.
 *   approximate  columns. A dotplot at 1,000 repetitions draws FILLED COLUMNS
 *                rather than circles, so the view is still called a dotplot and
 *                has no per-dot marks at all — which is why the test is "are
 *                there exact targets", not "is this a dotplot". The pointer's x
 *                picks the column and its height picks the rank within it, so
 *                hovering near the top of a spike gives a later repetition than
 *                hovering near its foot. On a spike plot the column is one
 *                achievable value and only the choice among ties is arbitrary;
 *                on a histogram the column is a bin, so the x is approximate
 *                too and the caller should say so.
 */

import { localPoint } from './chart-utils.js';

const NS = 'http://www.w3.org/2000/svg';

/** Drop the highlight from whatever was last under the pointer. */
function clearActive(root) {
  for (const el of root.querySelectorAll('.peek-active')) el.classList.remove('peek-active');
}

/**
 * @param {object} opts
 * @param {HTMLElement|null} opts.container - the chart container
 * @param {HTMLElement} opts.peek - where the description is written
 * @param {() => number[]} opts.stats - the statistics currently plotted
 * @param {{xScale: any, yScale: any, frame: any, bins: any[]|null}|null} opts.geom
 * @param {(index: number, approximate: boolean) => {title: string, detail: string}|null} opts.describe
 * @param {() => void} [opts.onLeave] - the pointer has left; put back whatever
 *   the page was showing before
 */
export function attachResamplePeek({ container, peek, stats, geom, describe, onLeave }) {
  if (!container) return;
  const show = (/** @type {number} */ i, /** @type {boolean} */ approx) => {
    const d = describe(i, approx);
    if (!d) { peek.hidden = true; return; }
    peek.innerHTML = `<strong>${d.title}:</strong> ${d.detail}`;
    peek.hidden = false;
  };

  // ── exact: one mark per statistic ──
  const marks = container.querySelectorAll('[data-stat-index]');
  if (marks.length) {
    for (const m of marks) {
      const i = Number(m.getAttribute('data-stat-index'));
      m.setAttribute('tabindex', '0');
      m.setAttribute('role', 'button');
      m.setAttribute('aria-label', `Repetition ${i + 1} — press to see the resample behind it`);
      const lift = () => { clearActive(container); m.classList.add('peek-active'); show(i, false); };
      m.addEventListener('mouseenter', lift);
      m.addEventListener('focus', lift);
      m.addEventListener('blur', () => m.classList.remove('peek-active'));
    }
    container.addEventListener('mouseleave', () => {
      clearActive(container);
      peek.hidden = true;
      onLeave?.();
    }, { once: true });
    return;
  }

  // ── approximate: columns ──
  const all = stats();
  if (!geom || !all.length) return;
  const { xScale, yScale, frame, bins } = geom;
  const inner = frame?.inner;
  const svgRoot = inner?.ownerSVGElement ?? inner?.closest?.('svg');
  if (!inner || !svgRoot || !xScale || !yScale) return;

  /** @type {Map<string, {center: number, idx: number[]}>} */
  const cols = new Map();
  const keyOf = (/** @type {number} */ v) => {
    if (!bins || !bins.length) return v.toPrecision(12);
    for (let i = 0; i < bins.length; i++) {
      if (v >= bins[i].x0 && (v < bins[i].x1 || i === bins.length - 1)) return 'b' + i;
    }
    return 'b0';
  };
  all.forEach((v, i) => {
    const k = keyOf(v);
    const c = cols.get(k);
    if (c) c.idx.push(i); else cols.set(k, { center: v, idx: [i] });
  });
  if (bins && bins.length) {
    for (const [k, c] of cols) {
      const i = Number(k.slice(1));
      if (bins[i]) c.center = (bins[i].x0 + bins[i].x1) / 2;
    }
  }
  const columns = [...cols.values()];
  if (!columns.length) return;

  // Created on first hover, not up front: a <circle> sitting unused in the
  // chart is how a chart-type detector decides it is looking at a dotplot, and
  // a transparent hit rect gets read as a histogram bar. Listening on the SVG
  // root needs no rect, and adding nothing until it is wanted avoids the rest.
  /**
   * The band, not a dot.
   *
   * A bar IS an ordered stack of the samples in it — hovering near its foot
   * gives an early repetition and near its top a late one — and a floating
   * circle only hinted at that. A slice the full width of the bar, one count
   * tall, says it: the bar reads as segments, and the one under the pointer is
   * lit. Jeff, 2026-11-04: "I want histograms to be ordered stacks of
   * horizontal segments we can hover over. Hovering should turn the current
   * segment / dot orange."
   *
   * @type {SVGRectElement|null}
   */
  let marker = null;
  const ensureMarker = () => {
    if (!marker) {
      marker = /** @type {SVGRectElement} */ (document.createElementNS(NS, 'rect'));
      marker.setAttribute('class', 'peek-marker');
      marker.setAttribute('pointer-events', 'none');
      inner.appendChild(marker);
    }
    return marker;
  };

  /**
   * The drawn bar under a given x, so the band matches the bar it is in.
   *
   * ⚠ Measured from what was actually rendered rather than recomputed from the
   * scale: a spike plot, a histogram and a filled dotplot column all arrive
   * here, and they do not agree on how wide a column is.
   */
  const barAt = (/** @type {number} */ px) => {
    let hit = null;
    for (const r of inner.querySelectorAll('.data rect')) {
      const x = Number(r.getAttribute('x'));
      const w = Number(r.getAttribute('width'));
      if (px >= x - 0.5 && px <= x + w + 0.5) { hit = { x, w }; break; }
    }
    return hit;
  };

  const baseline = yScale(0);
  svgRoot.addEventListener('mousemove', (/** @type {MouseEvent} */ e) => {
    // The group's bounding box is not its origin — the y-axis labels sit left
    // of it — so this has to go through the screen CTM or the marker lands to
    // the right of the pointer by the width of those labels.
    const { x: mx, y: my } = localPoint(inner, e.clientX, e.clientY);
    let best = columns[0], bestD = Infinity;
    for (const c of columns) {
      const d = Math.abs(xScale(c.center) - mx);
      if (d < bestD) { bestD = d; best = c; }
    }
    const n = best.idx.length;
    const top = yScale(n);
    const frac = (baseline - my) / Math.max(1, baseline - top);
    const rank = Math.min(n, Math.max(1, Math.ceil(frac * n)));
    const i = best.idx[rank - 1];
    const m = ensureMarker();
    const cx = xScale(best.center);
    const bar = barAt(cx);
    const unit = (baseline - top) / n;           // one count, in pixels
    const yTop = baseline - rank * unit;
    // ⚠ A floor on the height: past a few hundred in one bar a segment is a
    // fraction of a pixel and the band vanishes. 3px still points at a place in
    // the stack, which is what the reader is being shown.
    const h = Math.max(3, unit);
    m.setAttribute('x', String(bar ? bar.x : cx - 6));
    m.setAttribute('width', String(bar ? bar.w : 12));
    m.setAttribute('y', String(Math.min(yTop, baseline - h)));
    m.setAttribute('height', String(h));
    m.style.display = '';
    show(i, !!(bins && bins.length));
  });
  svgRoot.addEventListener('mouseleave', () => {
    if (marker) marker.style.display = 'none';
    peek.hidden = true;
    onLeave?.();
  });
}

/**
 * The readout, created once per page — announced, not displayed.
 *
 * Jeff, 2026-10-06: "I don't think we need the repetition text below the
 * sampling distribution when we hover. just seeing the graph change is enough."
 * True for anyone who can see the graph change. A screen-reader user cannot,
 * and this element is the `aria-live` region that tells them a different
 * repetition is now in the panel — so the text stays and only the pixels go.
 */
export function createPeekElement(after) {
  const el = document.createElement('p');
  el.className = 'resample-peek sr-only';
  el.id = 'resample-peek';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.hidden = true;
  after?.insertAdjacentElement('afterend', el);
  return el;
}
