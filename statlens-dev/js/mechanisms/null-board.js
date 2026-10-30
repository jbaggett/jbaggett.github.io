// @ts-check
import { prefersReducedMotion } from '../settings.js';

/**
 * The null model, drawn as a field you can throw darts at.
 *
 * A goodness-of-fit simulation draws n observations from hypothesised
 * proportions p₀. Shown as two bar charts — the counts you got, the counts you
 * expected — that draw is an abstraction: nothing on screen says where a
 * simulated sample *comes from*.
 *
 * So: a rectangle split into horizontal bands whose HEIGHTS are p₀. The whole
 * point is the area. A dart thrown uniformly at the rectangle lands in band i
 * with probability exactly p₀ᵢ, so a scatter of n darts **is** a draw from the
 * null — the picture is the sampling model rather than a decoration of it.
 * (Todd Will's sketch, via Jeff, 2026-10-30.)
 *
 * ⚠ Todd's own version samples without replacement from a finite population of
 * 1,000 marbles. This page draws multinomial from p₀, and Jeff kept that
 * ("sample from the null"): adopting the finite version would change the null
 * distribution — variance ratio (N−n)/(N−1) = 0.951 at his numbers — and move
 * every seeded value on the page. Darts are honest about the difference,
 * because two darts may land on the same spot and nobody minds.
 *
 * Colour: Okabe-Ito, the standard colour-blind-safe qualitative set, minus its
 * pure yellow (#F0E442 is ~1.1:1 on white, and the project's checklist rules it
 * out). Four of the seven clear 3:1 against white on their own; the lighter
 * three clear 4.4–5.6:1 against the band border, which is why every band has
 * one. Each band also carries its category name and count, so colour is never
 * the only cue.
 */

/** Okabe-Ito, yellow removed. Seven is the widest k the bundled datasets use. */
export const BAND_FILLS = [
  '#0072B2', '#D55E00', '#009E73', '#CC79A7', '#56B4E9', '#E69F00', '#999999',
];

const BORDER = '#333';
const LABEL_W = 86;      // left gutter: names live on white, not on the fill
const COUNT_W = 30;
/**
 * ⚠ There is deliberately NO minimum band height.
 *
 * A floor was tried first, to keep small categories visible. It breaks the one
 * thing this picture is for: with a 14px floor on a 110px board, `jury`'s White
 * band took 48% of the area for p₀ = 72%, so a dart thrown uniformly would
 * NOT have landed in it with probability p₀. The area has to be the
 * probability or the darts are decoration.
 *
 * Small categories therefore get thin bands — which is true, and is itself
 * worth seeing. Their name and count sit in the left gutter either way, so
 * nothing is lost but height.
 */
const MIN_BOARD_H = 120;

/**
 * @param {HTMLElement|null} container
 * @param {object} opts
 * @param {string[]} opts.categories
 * @param {number[]} opts.props      - p₀, summing to 1
 * @param {number[]} [opts.counts]   - darts to scatter, one array entry per category
 * @param {() => number} [opts.rand] - seeded, so a `?seed=` link redraws identically
 * @param {number} [opts.width]
 * @param {number} [opts.height]
 * @param {number} [opts.maxDarts]   - above this, the scatter is not drawn.
 *   The limit is LEGIBILITY, not cost: these are static circles, so drawing
 *   them is cheap, but past a point the scatter stops reading as individual
 *   observations and becomes a wash. 600 keeps `mendel_peas` (n = 556, the
 *   canonical goodness-of-fit example) and drops `stock_geometric` (n = 1,362).
 * @returns {{ dartEls: SVGCircleElement[] }|null}
 */
export function renderNullBoard(container, opts) {
  if (!container) return null;
  const { categories, props, counts = [], rand = Math.random,
    width = 300, height = 150, maxDarts = 600 } = opts;
  if (!categories?.length || !props?.length) return null;

  const total = props.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return null;

  const fieldW = Math.max(40, width - LABEL_W - COUNT_W);
  // Enough height that a band still reads at the smallest proportion present,
  // then shared out in EXACT proportion — no floor. (See MIN_BOARD_H.)
  const smallest = Math.min(...props.map((v) => v / total));
  const boardH = Math.max(height, MIN_BOARD_H,
    Math.min(260, smallest > 0 ? 7 / smallest : 0));

  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${boardH}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('class', 'null-board');
  svg.setAttribute('aria-label',
    `The null model: ${categories.map((c, i) =>
      `${c} ${(props[i] / total * 100).toFixed(0)}%`).join(', ')}`);

  /** @type {SVGCircleElement[]} */
  const dartEls = [];
  /**
   * Each band's labels and its true centre, for the de-collision pass below.
   * @type {{ centre: number, els: SVGTextElement[] }[]}
   */
  const labelRows = [];
  const dartTotal = counts.reduce((a, b) => a + b, 0);
  const drawDarts = dartTotal > 0 && dartTotal <= maxDarts;

  let y = 0;
  categories.forEach((cat, i) => {
    const h = (props[i] / total) * boardH;

    const rect = document.createElementNS(NS, 'rect');
    // Classed, like every other element in this SVG. `flyBandsToTally` and the
    // height assertions both used to select a bare `rect`, which was correct
    // only while bands were the sole rects here — a frame or a backdrop added
    // later would have joined them silently and flown from the wrong box.
    rect.setAttribute('class', 'null-board-band');
    rect.setAttribute('x', String(LABEL_W));
    rect.setAttribute('y', String(y));
    rect.setAttribute('width', String(fieldW));
    rect.setAttribute('height', String(h));
    rect.setAttribute('fill', BAND_FILLS[i % BAND_FILLS.length]);
    rect.setAttribute('fill-opacity', '0.55');
    rect.setAttribute('stroke', BORDER);
    rect.setAttribute('stroke-width', '1');
    svg.appendChild(rect);

    const name = document.createElementNS(NS, 'text');
    name.setAttribute('x', String(LABEL_W - 6));
    name.setAttribute('y', String(y + h / 2));
    name.setAttribute('text-anchor', 'end');
    name.setAttribute('dominant-baseline', 'middle');
    name.setAttribute('class', 'null-board-cat');
    name.textContent = cat;
    svg.appendChild(name);
    const row = { centre: y + h / 2, els: [name] };
    labelRows.push(row);

    if (counts[i] != null) {
      const n = document.createElementNS(NS, 'text');
      n.setAttribute('x', String(LABEL_W + fieldW + 5));
      n.setAttribute('y', String(y + h / 2));
      n.setAttribute('dominant-baseline', 'middle');
      n.setAttribute('class', 'null-board-count');
      n.textContent = String(counts[i]);
      svg.appendChild(n);
      row.els.push(n);
    }

    if (drawDarts) {
      // Placed to MATCH the drawn counts rather than thrown and tallied: the
      // counts are the data, the positions are only the picture. Seeded, so the
      // same ?seed= link redraws the same scatter.
      for (let d = 0; d < counts[i]; d++) {
        const c = document.createElementNS(NS, 'circle');
        c.setAttribute('cx', String(LABEL_W + 3 + rand() * (fieldW - 6)));
        c.setAttribute('cy', String(y + 3 + rand() * Math.max(1, h - 6)));
        c.setAttribute('r', '2.6');
        c.setAttribute('class', 'null-board-dart');
        c.setAttribute('data-band', String(i));
        svg.appendChild(c);
        dartEls.push(c);
      }
    }
    y += h;
  });

  // ── Labels that do not sit on top of each other ───────────────────────
  //
  // A band's height IS its p₀ (see above), so a rare category gets a band
  // thinner than a line of text and its label lands on its neighbour's. On
  // `stock_geometric` the last three bands are 6.1, 2.7 and 2.3 units tall
  // against a 9.5-unit font, and the board shipped with 8 overlapping pairs —
  // four category names and their counts stacked into an unreadable smudge at
  // the bottom edge. Measured at 390px, which is where it is worst.
  //
  // Growing the board instead cannot work: `boardH` already asks for
  // `7 / smallest` and is capped at 260, because the honest height for a 0.9%
  // category is ~795 units of mostly-empty blue.
  //
  // So the labels dodge apart and a leader line says which band each belongs
  // to. The leader is the part that matters — without it the dodge would just
  // move the lie somewhere quieter.
  const dodge = () => {
    // 14, not the 11 that "one 9.5px line" suggests: a text element's box is
    // the font's full line box, ~1.3x its size, and at 11 the labels still
    // touched — `jury` overlapped at a 11.4-unit spacing without even
    // triggering a dodge. Measured, not derived from the font-size.
    const GAP = 14;
    const ys = labelRows.map((r) => r.centre);
    // Down the stack, then back up off the bottom edge: the standard two-pass,
    // which lands on the arrangement closest to the true centres that fits.
    for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i], ys[i - 1] + GAP);
    const floor = boardH - GAP / 2;
    if (ys[ys.length - 1] > floor) {
      ys[ys.length - 1] = floor;
      for (let i = ys.length - 2; i >= 0; i--) ys[i] = Math.min(ys[i], ys[i + 1] - GAP);
    }
    labelRows.forEach((r, i) => {
      const moved = Math.abs(ys[i] - r.centre);
      for (const el of r.els) el.setAttribute('y', String(ys[i]));
      if (moved < 1.5) return;
      // Leader from the label back to the band it names, on whichever side
      // that label sits.
      for (const el of r.els) {
        const isCount = el.classList.contains('null-board-count');
        const line = document.createElementNS(NS, 'line');
        line.setAttribute('x1', String(isCount ? LABEL_W + fieldW + 2 : LABEL_W - 4));
        line.setAttribute('y1', String(ys[i]));
        line.setAttribute('x2', String(isCount ? LABEL_W + fieldW : LABEL_W));
        line.setAttribute('y2', String(r.centre));
        line.setAttribute('class', 'null-board-leader');
        svg.insertBefore(line, svg.firstChild);
      }
    });
  };
  if (labelRows.length > 1) dodge();

  container.innerHTML = '';
  container.appendChild(svg);
  return { dartEls };
}

/**
 * Throw the sample at the board.
 *
 * The darts are ALREADY where they belong — `renderNullBoard` placed them to
 * match counts the statistical rng had already decided. This only governs when
 * each one arrives, so the reader watches a sample being taken instead of
 * finding one that was always there. (Jeff, 2026-10-30: "It would be nice if
 * there was some animation, somehow, with the sample from the population.")
 *
 * The k-band sibling of `animateDartScoop`, which cannot be reused: that one
 * splits a board left|right on a single proportion and asks each dart whether
 * it was a success. Here the band a dart lands in IS its category, and there
 * are up to seven of them.
 *
 * ⚠ The launch order is SHUFFLED. The darts are created band by band, so
 * animating them in document order would fill the board top-down by category —
 * a picture that says "first we draw the Whites, then the Blacks", when the
 * whole claim is that each observation is an independent draw from p₀. Same
 * reasoning as `animateDartScoop`, which learned it first. (Jeff, 2026-10-03.)
 *
 * @param {Element[]} darts - the board's dart circles, as rendered
 * @param {object} [opts]
 * @param {() => number} [opts.rand] - decoration only; never the page's rng
 * @param {number} [opts.max] - decline above this many (the board declines too)
 * @param {() => void} [opts.onDone]
 * @returns {number} ms the rain will take (0 if it was skipped)
 */
export function rainDarts(darts, { rand = Math.random, max = 600, onDone } = {}) {
  const done = () => { if (onDone) onDone(); };
  if (prefersReducedMotion() || !darts?.length || darts.length > max) { done(); return 0; }

  const n = darts.length;
  // A rat-a-tat that stays about half a second whether n is 20 or 500: the
  // cadence is the point, not one dart per beat.
  const STAGGER = Math.min(520 / n, 9);
  const DUR = 280;

  const order = darts.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = order[i]; order[i] = order[j]; order[j] = t;
  }
  order.forEach((idx, pos) => {
    const d = /** @type {SVGElement} */ (darts[idx]);
    d.style.animation = `nb-dart-land ${DUR}ms cubic-bezier(.34,1.56,.64,1) ${pos * STAGGER}ms both`;
  });

  const total = (n - 1) * STAGGER + DUR;
  setTimeout(done, total);
  return total;
}

/**
 * Fly the darts of each band into that band's row in the tally.
 *
 * The step between the two panels: the board shows where the observations
 * landed, the table shows them counted, and without this the count simply
 * appears. Jeff, 2026-10-30: "the dots could fly from each category in the null
 * to the aggregated observed value."
 *
 * One flyer per category, not per dart — 556 flyers would be a smear, and the
 * claim being made is about the TALLY, not about individual observations. Each
 * flyer leaves from the middle of its band and lands on its own Observed cell.
 *
 * @param {object} opts
 * @param {SVGSVGElement|null} opts.board
 * @param {HTMLElement|null} opts.table - holds `[data-tally-cell="i"]` per row
 * @param {number} [opts.duration]
 * @param {() => void} [opts.onDone]
 * @returns {number} ms the flight will take (0 if it was skipped)
 */
export function flyBandsToTally({ board, table, duration = 520, onDone }) {
  const done = () => { if (onDone) onDone(); };
  // The project's own check, not a bare matchMedia: it is settings-aware, so a
  // reader who turned motion off in StatLens gets the same answer as one whose
  // OS says so.
  if (prefersReducedMotion() || !board || !table) { done(); return 0; }

  const cells = [...table.querySelectorAll('[data-tally-cell]')];
  const bands = [...board.querySelectorAll('.null-board-band')];
  if (!cells.length || !bands.length) { done(); return 0; }

  const layer = document.createElement('div');
  layer.className = 'tally-fly-layer';
  document.body.appendChild(layer);

  let landed = 0;
  const finish = () => {
    landed += 1;
    if (landed < cells.length) return;
    layer.remove();
    done();
  };

  cells.forEach((cell, i) => {
    const band = bands[i];
    if (!band) { finish(); return; }
    const from = band.getBoundingClientRect();
    const to = cell.getBoundingClientRect();
    if (!from.width || !to.width) { finish(); return; }

    const dot = document.createElement('span');
    dot.className = 'tally-flyer';
    dot.style.background = band.getAttribute('fill') || '#333';
    dot.style.left = `${from.left + from.width / 2}px`;
    dot.style.top = `${from.top + from.height / 2}px`;
    layer.appendChild(dot);

    const dx = (to.left + to.width / 2) - (from.left + from.width / 2);
    const dy = (to.top + to.height / 2) - (from.top + from.height / 2);
    // Staggered, so four flights read as four categories rather than one blur.
    const delay = i * 70;
    const anim = dot.animate(
      [{ transform: 'translate(0,0) scale(1)', opacity: 0.95 },
       { transform: `translate(${dx}px, ${dy}px) scale(0.6)`, opacity: 0.2 }],
      { duration, delay, easing: 'cubic-bezier(.4,.1,.3,1)', fill: 'forwards' });
    anim.onfinish = () => { cell.classList.add('tally-cell-landed'); finish(); };
    anim.oncancel = finish;
  });

  return duration + (cells.length - 1) * 70;
}
