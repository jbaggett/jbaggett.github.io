/**
 * Plotting a function of one variable.
 *
 * The part that is easy to underestimate is not drawing the curve, it is
 * knowing where NOT to draw it. A naive uniform sampler draws a vertical line
 * straight through every asymptote of tan(x) and 1/x, and students read that
 * line as part of the graph. `sampleCurve()` returns a LIST of polylines, split
 * at every hole and pole, and the caller draws one path per piece.
 */

import { line } from 'd3-shape';

/**
 * Sample a function into polyline pieces, split at discontinuities.
 *
 * Two passes. First a uniform sweep with recursive refinement where the curve
 * bends sharply (so √x near 0 and a tall narrow peak stay smooth). Then a
 * break-and-clamp pass:
 *
 *   - a non-finite value ends the current piece (domain hole: ln(x) at x ≤ 0)
 *   - a jump larger than several view-heights WITH a sign change ends it too:
 *     that is the signature of passing through a vertical asymptote
 *   - finite values far outside the view are clamped, so the SVG path stays
 *     small, and flagged so the caller can skip drawing markers on them
 *
 * @param {(x:number)=>number} f
 * @param {number} x0 @param {number} x1
 * @param {{samples?:number, yMin?:number, yMax?:number, refine?:number}} [opts]
 * @returns {{x:number,y:number,clipped:boolean}[][]} one array per continuous piece
 */
export function sampleCurve(f, x0, x1, opts = {}) {
  const { samples = 700, yMin = -10, yMax = 10, refine = 4 } = opts;
  const span = Math.max(1e-12, yMax - yMin);
  const lo = yMin - 6 * span, hi = yMax + 6 * span;
  const tol = span / 200;                      // "sharp bend" threshold

  /** @type {{x:number,y:number}[]} */
  const raw = [];
  const step = (x1 - x0) / samples;

  /** Bisect a segment whose midpoint strays from the chord — depth-capped. */
  function subdivide(xa, ya, xb, yb, depth) {
    if (depth <= 0) return;
    const xm = (xa + xb) / 2, ym = f(xm);
    if (!Number.isFinite(ym)) { raw.push({ x: xm, y: NaN }); return; }
    if (Math.abs(ym - (ya + yb) / 2) <= tol) return;
    subdivide(xa, ya, xm, ym, depth - 1);
    raw.push({ x: xm, y: ym });
    subdivide(xm, ym, xb, yb, depth - 1);
  }

  let prevX = x0, prevY = f(x0);
  raw.push({ x: prevX, y: prevY });
  for (let i = 1; i <= samples; i++) {
    const x = x0 + i * step, y = f(x);
    if (Number.isFinite(prevY) && Number.isFinite(y)) subdivide(prevX, prevY, x, y, refine);
    raw.push({ x, y });
    prevX = x; prevY = y;
  }

  /** @type {{x:number,y:number,clipped:boolean}[][]} */
  const pieces = [];
  /** @type {{x:number,y:number,clipped:boolean}[]} */
  let piece = [];
  let last = null;
  const flush = () => { if (piece.length > 1) pieces.push(piece); piece = []; };

  for (const p of raw) {
    if (!Number.isFinite(p.y)) { flush(); last = null; continue; }
    // Through a vertical asymptote: an enormous jump that also changes sign.
    if (last && Math.abs(p.y - last.y) > 6 * span && Math.sign(p.y) !== Math.sign(last.y)) {
      flush();
    }
    const y = Math.min(hi, Math.max(lo, p.y));
    piece.push({ x: p.x, y, clipped: y !== p.y });
    last = p;
  }
  flush();
  return pieces;
}

/**
 * `d` attribute for one polyline piece.
 * @param {{x:number,y:number}[]} points
 * @param {(x:number)=>number} xs @param {(y:number)=>number} ys
 */
export function linePath(points, xs, ys) {
  return line().x(d => xs(d.x)).y(d => ys(d.y))(points) || '';
}

/**
 * Draw a curve as one path per continuous piece.
 * @param {any} layer d3 selection to draw into
 * @param {(x:number)=>number} f
 * @param {{xs:any, ys:any, className?:string, samples?:number}} opts
 */
export function drawCurve(layer, f, opts) {
  const { xs, ys, className = 'll-curve', samples } = opts;
  const [x0, x1] = xs.domain();
  const [yMin, yMax] = ys.domain();
  const pieces = sampleCurve(f, x0, x1, { yMin, yMax, samples });
  const paths = layer.selectAll(`path.${className}`).data(pieces);
  paths.exit().remove();
  paths.enter().append('path').attr('class', className)
    .merge(paths)
    .attr('d', p => linePath(p, xs, ys))
    .attr('fill', 'none');
  return pieces;
}

/**
 * A sensible y-window for f on [x0,x1]: wide enough to show the whole graph,
 * but not stretched to ±1000 by one sample next to a pole.
 *
 * The naive fix — always trim to the middle 90% — is wrong: on a cubic it
 * chops the ends off a graph that was perfectly well behaved, and the curve
 * runs off the top of the frame. So the trim is CONDITIONAL. The extremes are
 * discarded only when they are a genuine spike, meaning the full range is
 * several times the trimmed range. A polynomial keeps its real range; 1/x and
 * tan get tamed.
 *
 * y = 0 is kept in view when it is NEARBY — within one range-width of the data.
 * Always forcing it in flattens an honest graph: a height function living
 * between 48 and 64 ft gets squashed into the top fifth of the frame by an
 * axis nothing ever approaches.
 *
 * @param {(x:number)=>number} f @param {number} x0 @param {number} x1
 * @param {{pad?:number, minSpan?:number, includeZero?:boolean}} [opts]
 * @returns {[number, number]}
 */
export function autoYDomain(f, x0, x1, opts = {}) {
  const { pad = 0.12, minSpan = 1, includeZero = true } = opts;
  const ys = [];
  for (let i = 0; i <= 400; i++) {
    const y = f(x0 + ((x1 - x0) * i) / 400);
    if (Number.isFinite(y)) ys.push(y);
  }
  if (!ys.length) return [-5, 5];
  ys.sort((a, b) => a - b);
  const q = (/** @type {number} */ p) => ys[Math.min(ys.length - 1, Math.floor(p * (ys.length - 1)))];

  const fullSpan = ys[ys.length - 1] - ys[0];
  const trimSpan = Math.max(1e-9, q(0.95) - q(0.05));
  const spiky = fullSpan > 4 * trimSpan;

  let lo = spiky ? q(0.05) : ys[0];
  let hi = spiky ? q(0.95) : ys[ys.length - 1];
  if (includeZero) {
    const width = Math.max(1e-12, hi - lo);
    if (lo > 0 && lo < width) lo = 0;
    if (hi < 0 && -hi < width) hi = 0;
  }
  if (hi - lo < minSpan) { const m = (hi + lo) / 2; lo = m - minSpan / 2; hi = m + minSpan / 2; }
  const p = (hi - lo) * pad;
  return [lo - p, hi + p];
}
