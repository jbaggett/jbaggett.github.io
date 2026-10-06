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

const NS = 'http://www.w3.org/2000/svg';

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
      m.addEventListener('mouseenter', () => show(i, false));
      m.addEventListener('focus', () => show(i, false));
    }
    container.addEventListener('mouseleave', () => { peek.hidden = true; onLeave?.(); }, { once: true });
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
  /** @type {SVGCircleElement|null} */
  let marker = null;
  const ensureMarker = () => {
    if (!marker) {
      marker = /** @type {SVGCircleElement} */ (document.createElementNS(NS, 'circle'));
      marker.setAttribute('class', 'peek-marker');
      marker.setAttribute('r', '5');
      marker.setAttribute('fill', 'none');
      marker.setAttribute('pointer-events', 'none');
      inner.appendChild(marker);
    }
    return marker;
  };

  const baseline = yScale(0);
  svgRoot.addEventListener('mousemove', (/** @type {MouseEvent} */ e) => {
    const box = inner.getBoundingClientRect();
    const mx = e.clientX - box.left;
    const my = e.clientY - box.top;
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
    m.setAttribute('cx', String(xScale(best.center)));
    m.setAttribute('cy', String(baseline - ((rank - 0.5) / n) * (baseline - top)));
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
