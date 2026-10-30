// @ts-check
/**
 * Galton board — the binomial distribution, built one bounce at a time.
 *
 * Jeff, 2026-10-08: "I thought it might be fun to build an animation of a
 * Galton Board to illustrate the binomial distribution … I really like the
 * animation here: javalab.org/en/galton_board_en/ since it looks like the
 * physics is plausible."
 *
 * ── The one real decision ────────────────────────────────────────────────
 *
 * There are two ways to build this, and they are not close.
 *
 *   SIMULATE PHYSICS.  Give each ball a velocity, collide it with pegs, let
 *                      the pile emerge. Looks authentic. The distribution it
 *                      produces is only ROUGHLY binomial — peg geometry,
 *                      restitution and spin all bias it, and the javalab page
 *                      says so itself: "it is not possible to create a
 *                      complete binomial distribution with a Galton board".
 *   DECIDE, THEN DRAW. Flip a seeded coin at each peg, then animate the path
 *                      that produced. The counts are exactly Binomial(n, p),
 *                      and the motion is still a projectile arc off each peg.
 *
 * This is the second. A tool whose job is to illustrate the binomial should
 * produce the binomial, and on a page where `?seed=` is a promise the physics
 * would have to be deterministic anyway. What is lost is nothing a viewer can
 * see; what is gained is that the pile matches the curve drawn over it, and
 * that **p can be something other than 0.5** — a board no physical apparatus
 * can build, and the case where the binomial stops looking symmetric.
 *
 * The honesty is in the motion rather than in the mechanism: each hop is a
 * real parabola (x linear, y quadratic — constant horizontal speed, constant
 * downward acceleration), the ball squashes where it meets a peg, and the peg
 * it hit flinches. That is what makes it read as physical.
 *
 * ── Paced by the clock ───────────────────────────────────────────────────
 *
 * Every ball's position is a function of how long it has been falling, not of
 * how many frames have passed, so the board runs at the same speed on a 60Hz
 * laptop, a 120Hz monitor and a loaded machine. (The lesson of D-32 and of the
 * Law of Large Numbers play button.)
 */

import * as d3Selection from 'd3-selection';
import * as d3Scale from 'd3-scale';
import * as d3Shape from 'd3-shape';

import { createRng } from '../../js/prng.js';
import { createWorld, DT } from './physics.js';
import { announce, initHelp, initSettings } from '../../js/page-utils.js';
import { prefersReducedMotion } from '../../js/settings.js';

// ─── Look ───

const BALL = '#E07020';        // the warm "a thing that was drawn" orange
const BEAD = '#2A2A2A';        // the physical board's beads: small, dark, many
const BALL_SETTLED = '#569BBD';// once it is part of the pile it is data
const PEG = '#8FA6B2';
const CURVE = '#7B2D8E';       // the exact binomial, in the statistic purple
const NORMAL = '#D55E00';      // the normal approximation

const VIEW_W = 760;
const VIEW_H = 560;
/** The row spacing a 12-row field has — the reference the size sliders mean. */
const REF_GAP = (VIEW_H * 0.56 - 44) / 12;

/** How long one peg-to-peg hop takes. The whole fall is rows × this. */
const HOP_MS = 150;
/** Gap between releases while playing — a stream, not a volley. */
const RELEASE_MS = 190;
/** Past this the pile is bars rather than stacked balls. */
const MAX_STACK_BALLS = 28;

/**
 * Beads per second out of the hopper on the physical board.
 *
 * Counted off the board Jeff recorded: its reservoir fell 884 → 854 → 824 in
 * one second each, so 30 a second. That rate is most of why it is fun to watch
 * — the stream is dense enough to read as a pouring plume rather than a queue
 * of separate balls — and it is cheap, because at ~2 s of flight it keeps only
 * 60-odd beads in the air at once.
 */
const POUR_RATE = 30;
/**
 * How many beads the hopper starts with.
 *
 * The recorded board counts down from about a thousand, and the counter is a
 * nice piece of flavour — a pour that visibly draws down a supply. But a limit
 * that makes a student clear a tally they wanted to keep is a liability, so
 * ours is stocked well past any plausible session.
 */
const HOPPER = 5000;
/**
 * A hard ceiling on beads in the air.
 *
 * With pegs and beads both cranked up, the gap between pegs closes and beads
 * genuinely cannot get through — a jam, which is a true thing about a real
 * board and worth seeing. But the hopper would keep pouring onto it forever,
 * so the pour stalls here instead and resumes when the jam clears.
 */
const MAX_IN_FLIGHT = 240;
/** Animating more than this at once is a smear, so bigger batches go straight in. */
const ANIMATE_UP_TO = 12;

// ─── State ───

const params = new URLSearchParams(location.search);
let rows = clamp(Number(params.get('rows')) || 12, 3, 20);
let p = clampP(Number(params.get('p')) || 0.5);
const seed = params.get('seed') || 'galton';
let showNormal = params.get('normal') === 'true';
let showExact = params.get('exact') !== 'false';

let rng = createRng(`${seed}:${rows}:${p}`);
/** @type {number[]} counts per bin, 0..rows */
let counts = new Array(rows + 1).fill(0);
let dropped = 0;

/** Balls currently falling. */
/** @type {Array<{t0: number, path: Uint8Array, bin: number}>} */
let falling = [];

let playing = false;
/** @type {number|null} */ let rafId = null;
let lastRelease = 0;

/**
 * 'ideal' is the decide-then-draw board: exactly Binomial(n, p).
 * 'physical' is a real little world — gravity, bounces, balls hitting each
 * other — whose pile is NOT binomial, which is the whole reason to have both.
 */
// `board=`, not `mode=`: `mode` is the frozen site-wide parameter for
// discover/present (docs/url-api.md), and overloading it would be a contract
// break for the sake of one page's convenience.
let mode = params.get('board') === 'physical' ? 'physical' : 'ideal';
let slowmo = false;
// Pegs wider than the beads, as on the recorded board (pillar 0.35 cm,
// bead 0.25 cm). The clearance between two pegs is what deflects a bead;
// beads bigger than the gap is a knob, not a starting point.
let pegR = 7, ballR = 5;
/** @type {ReturnType<typeof createWorld>|null} */ let world = null;
let physAccum = 0;
let physLast = 0;
/** The hopper. A finite supply is what makes the stream feel like a pour. */
let reservoir = HOPPER;
/** Beads still to be poured from the last +N (or an unbounded play). */
let queued = 0;
/**
 * When the next bead is released, in SIMULATED seconds.
 *
 * Simulated, not wall-clock, and that is the difference between `?seed=` being
 * a promise here and not. The world advances in fixed steps, so a given number
 * of steps always produces the same physics — but if beads were released when
 * the WALL clock said so, a slower machine would release them at different
 * points in that sequence and get a different pile. Scheduling against the
 * world's own clock makes the whole run reproducible.
 */
let nextRelease = 0;
let simTime = 0;

function clamp(/** @type {number} */ v, /** @type {number} */ lo, /** @type {number} */ hi) {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}
function clampP(/** @type {number} */ v) {
  return Number.isFinite(v) ? Math.max(0.05, Math.min(0.95, v)) : 0.5;
}

// ─── Elements ───

const el = (/** @type {string} */ id) => document.getElementById(id);
const boardBox = el('board');
const statsEl = el('board-stats');
const rowsInput = /** @type {HTMLInputElement|null} */ (el('rows-input'));
const pInput = /** @type {HTMLInputElement|null} */ (el('p-input'));
const pReadout = el('p-readout');
const normalToggle = /** @type {HTMLInputElement|null} */ (el('normal-toggle'));
const modeToggle = el('mode-toggle');
const physicsBox = el('physics-controls');
const driftEl = el('drift');
const pField = el('p-field');
const pegrInput = /** @type {HTMLInputElement|null} */ (el('pegr-input'));
const ballrInput = /** @type {HTMLInputElement|null} */ (el('ballr-input'));
const bounceInput = /** @type {HTMLInputElement|null} */ (el('bounce-input'));
const interactToggle = /** @type {HTMLInputElement|null} */ (el('interact-toggle'));
const slowmoToggle = /** @type {HTMLInputElement|null} */ (el('slowmo-toggle'));
const genLabel = document.querySelector('.gen-label');
const exactToggle = /** @type {HTMLInputElement|null} */ (el('exact-toggle'));
/** @type {HTMLButtonElement|null} */ let playBtn = null;

// ─── Geometry ───

/**
 * Where everything sits. Recomputed on a change of rows so the board always
 * fills the frame: a 4-row board and a 20-row board should both look made for
 * the space rather than one being a shrunken copy of the other.
 */
function geometry() {
  const padX = 40, padTop = 34, binTop = VIEW_H * 0.56, binBottom = VIEW_H - 46;
  // The widest peg row is `rows` pegs across; bins are rows+1 wide.
  const usable = VIEW_W - padX * 2;
  const colGap = usable / (rows + 1);
  const rowGap = (binTop - padTop - 18) / Math.max(1, rows);
  const cx = VIEW_W / 2;
  return { padX, padTop, binTop, binBottom, colGap, rowGap, cx, usable };
}

/** The peg at row r (0-based), offset k from the left of that row. */
/**
 * The physical board's lattice: pegs across the FULL width, offset row to row.
 *
 * The ideal board draws a triangle, because that is exactly where a coin-flip
 * path can go. A real Galton board is a full field of pins, and the difference
 * is not cosmetic: in a triangle a bead that wanders sideways meets nothing,
 * and the plume cannot spread. Across a full field it keeps being deflected
 * wherever it goes — which is what makes the falling cloud widen into the
 * distribution before it ever reaches the bottom. That widening plume is the
 * thing worth watching. (From the board Jeff recorded, 2026-10-08.)
 */
function fieldGeometry() {
  const padX = 24, top = 44;
  const bottom = VIEW_H * 0.56;
  const usable = VIEW_W - padX * 2;
  const rowGap = (bottom - top) / Math.max(1, rows);

  // Pegs and beads are sized RELATIVE to the row spacing, not in fixed pixels.
  //
  // The field band is a fixed height, so twenty rows sit twice as close as ten.
  // With fixed-pixel pegs, a twenty-row board had pegs overlapping their
  // neighbours in the row above — measured: 600 of 600 beads stuck, the board
  // simply sealed shut. Sizing to the spacing means the sliders set the thing
  // that actually matters anyway, the CLEARANCE between two pegs relative to
  // the bead, and every row count builds a board that works.
  // …but only up to a point. At three rows the spacing is four times the
  // reference and the "beads" become boulders that cannot leave the hopper.
  const k = Math.min(2, rowGap / REF_GAP);
  const pr = pegR * k, br = ballR * k;

  // Column spacing is set by the bead the board has to pass, and by nothing
  // else. A real board is built this way: pins close enough that a bead cannot
  // sail between two of them untouched, far enough that it can get through.
  //
  // The first build instead spaced pegs by the hex ratio, rowGap/0.866, and the
  // gap that left was wide enough to fall through: 100 beads landed with SD
  // 0.68 against a target of 1.73 — a spike, not a binomial. Keeping the hex
  // ratio as a FLOOR was no better at low row counts, where the rows are far
  // apart and the floor reopens the same gap: at 5 rows, SD 1.73 against a
  // target of 1.12. Spacing to the bead alone holds the ratio between 0.95 and
  // 1.17 of √(npq) at every row count from 3 to 20.
  const colGap = 2 * pr + 2 * br + rowGap * 0.09;
  // The reachable part of the board is rows/2 columns either side of centre —
  // that is what "number of times it went right" can reach. The pins run a few
  // columns past that, as a real board's do, so a bead that bounces out of the
  // plume still has something to land on. Much wider than that and the board is
  // mostly empty field with a thin stream down the middle.
  const halfW = Math.min(usable / 2, (rows / 2 + 4.5) * colGap);
  const cols = Math.ceil((halfW * 2) / colGap) + 2;
  return { padX, top, bottom, usable, rowGap, colGap, cols, pr, br, halfW, cx: VIEW_W / 2,
           barTop: bottom + 26, barBottom: VIEW_H - 40 };
}

/**
 * Every peg in the physical field — on a lattice, but not a perfect one.
 *
 * The jitter is the part that matters. On a mathematically perfect lattice a
 * bead lands square on each peg's crown, and a deterministic simulation has no
 * way to fall off one side rather than the other: it resolves the tie the same
 * way every time, so the bead goes right, left, right, left and arrives back
 * where it started. Traced: a bead oscillating between x = 381 and x = 393 for
 * twelve rows, every bead landing in the middle bin.
 *
 * Real pins are set by hand and are out by a fraction of a millimetre, and that
 * is enough to decide every one of those ties. Ours are out by up to 8% of the
 * spacing, from the page's seeded generator — so a given `?seed=` is a
 * particular board with its own particular crookedness, the same for everyone
 * who opens the link, and a different seed is a different board. Over five
 * seeds at n = 12 that is worth a spread of 1.45 to 2.06 against a √(npq) of
 * 1.73, and a lean of up to a third of a bin either way: real boards are not
 * the ideal board, and two real boards are not each other.
 *
 * Don't raise it much. At 30% of the spacing the displaced pegs close the gaps
 * and the board seals shut — measured, 150 of 150 beads stuck.
 */
function fieldPegs() {
  const f = fieldGeometry();
  const jit = createRng(`pegs:${seed}:${rows}`);
  const amp = f.colGap * 0.08;
  /** @type {Array<{x: number, y: number}>} */
  const out = [];
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) ? f.colGap / 2 : 0;
    for (let c = -Math.ceil(f.cols / 2); c <= Math.ceil(f.cols / 2); c++) {
      const x = f.cx + c * f.colGap + offset;
      if (Math.abs(x - f.cx) > f.halfW) continue;
      out.push({ x: x + (jit() - 0.5) * amp,
                 y: f.top + (r + 0.5) * f.rowGap + (jit() - 0.5) * amp });
    }
  }
  return out;
}

function pegXY(/** @type {number} */ r, /** @type {number} */ k) {
  const g = geometry();
  // Row r holds r+1 pegs, centred: offsets -r/2 … +r/2.
  return {
    x: g.cx + (k - r / 2) * g.colGap,
    y: g.padTop + r * g.rowGap,
  };
}

/** Where a ball sits mid-fall, as a pure function of its age. */
function ballXY(/** @type {{path: Uint8Array}} */ ball, /** @type {number} */ ageMs) {
  const g = geometry();
  const seg = Math.min(rows, Math.floor(ageMs / HOP_MS));
  const t = Math.min(1, (ageMs - seg * HOP_MS) / HOP_MS);

  if (seg >= rows) {
    // Past the last peg: drop straight into the bin.
    const rights = ball.path.reduce((a, b) => a + b, 0);
    const last = pegXY(rows - 1, rightsIn(ball.path, rows - 1));
    const bx = binX(rights);
    const dropT = Math.min(1, (ageMs - rows * HOP_MS) / HOP_MS);
    return { x: last.x + (bx - last.x) * dropT, y: last.y + (g.binTop - last.y) * dropT * dropT,
             squash: 0 };
  }

  const from = seg === 0
    ? { x: g.cx, y: g.padTop - g.rowGap * 0.9 }
    : pegXY(seg - 1, rightsIn(ball.path, seg - 1));
  const to = pegXY(seg, rightsIn(ball.path, seg));

  // A projectile: constant horizontal speed, constant downward acceleration.
  // The quadratic in y is what stops it reading as a dot sliding down a wire.
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * (t * t),
    // Squashed at the moment of contact, recovering over the next few frames.
    // Gently: at the first attempt the ball went to 1.9:1 and read as a pebble
    // being stepped on rather than a ball meeting a peg.
    squash: t > 0.88 ? (t - 0.88) / 0.12 : 0,
  };
}

/** How many rights among the first `upto+1` decisions — i.e. which peg of its row. */
function rightsIn(/** @type {Uint8Array} */ path, /** @type {number} */ upto) {
  let s = 0;
  for (let i = 0; i <= upto && i < path.length; i++) s += path[i];
  return s;
}

function binX(/** @type {number} */ bin) {
  const g = geometry();
  return g.cx + (bin - rows / 2) * g.colGap;
}

// ─── The exact distribution, and its normal approximation ───

/** Binomial(rows, p) probabilities. Exact: rows ≤ 20, so the coefficients fit. */
function binomialPmf() {
  const out = new Array(rows + 1);
  let c = 1;                                   // C(rows, k), built up
  for (let k = 0; k <= rows; k++) {
    out[k] = c * Math.pow(p, k) * Math.pow(1 - p, rows - k);
    c = c * (rows - k) / (k + 1);
  }
  return out;
}

const normalPdf = (/** @type {number} */ x, /** @type {number} */ m, /** @type {number} */ s) =>
  Math.exp(-((x - m) ** 2) / (2 * s * s)) / (s * Math.sqrt(2 * Math.PI));

// ─── Drawing ───

/** @type {any} */ let svg = null;

function buildBoard() {
  if (!boardBox) return;
  if (mode === 'physical') { buildField(); return; }
  boardBox.innerHTML = '';
  const g = geometry();

  svg = d3Selection.select(boardBox).append('svg')
    .attr('viewBox', `0 0 ${VIEW_W} ${VIEW_H}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .attr('role', 'img')
    .attr('aria-label', `Galton board with ${rows} rows of pegs`)
    .style('width', '100%')
    .style('height', 'auto');

  // The funnel the balls come out of.
  svg.append('path')
    .attr('d', `M ${g.cx - 26} ${g.padTop - g.rowGap * 1.5} L ${g.cx - 5} ${g.padTop - g.rowGap * 0.75}
                L ${g.cx + 5} ${g.padTop - g.rowGap * 0.75} L ${g.cx + 26} ${g.padTop - g.rowGap * 1.5}`)
    .attr('fill', 'none').attr('stroke', PEG).attr('stroke-width', 2.5)
    .attr('stroke-linejoin', 'round');

  const pegs = svg.append('g').attr('class', 'pegs');
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k <= r; k++) {
      const { x, y } = pegXY(r, k);
      pegs.append('circle')
        .attr('class', `peg peg-${r}-${k}`)
        .attr('cx', x).attr('cy', y).attr('r', Math.max(2, g.colGap * 0.1))
        .attr('fill', PEG);
    }
  }

  svg.append('g').attr('class', 'bins');
  svg.append('g').attr('class', 'curves');
  svg.append('g').attr('class', 'balls');

  // Bin floor.
  svg.append('line')
    .attr('x1', g.cx - (rows / 2 + 0.6) * g.colGap).attr('x2', g.cx + (rows / 2 + 0.6) * g.colGap)
    .attr('y1', g.binBottom).attr('y2', g.binBottom)
    .attr('stroke', '#444').attr('stroke-width', 2);

  drawBins();
  drawCurves();
}

function drawBins() {
  if (!svg) return;
  const g = geometry();
  const bins = svg.select('.bins');
  bins.selectAll('*').remove();

  const maxCount = Math.max(1, ...counts);
  const h = g.binBottom - g.binTop;
  const scale = h / Math.max(maxCount, 6);
  const ballR = Math.min(g.colGap * 0.34, scale * 0.45);
  const asBalls = maxCount <= MAX_STACK_BALLS && ballR >= 2.2;

  for (let b = 0; b <= rows; b++) {
    const x = binX(b);
    // Bin walls, so the pile reads as contained rather than floating.
    bins.append('line')
      .attr('x1', x - g.colGap / 2).attr('x2', x - g.colGap / 2)
      .attr('y1', g.binTop).attr('y2', g.binBottom)
      .attr('stroke', '#DDE4E8').attr('stroke-width', 1);

    if (!counts[b]) continue;
    if (asBalls) {
      for (let i = 0; i < counts[b]; i++) {
        bins.append('circle')
          .attr('cx', x)
          .attr('cy', g.binBottom - ballR - i * ballR * 2)
          .attr('r', ballR)
          .attr('fill', BALL_SETTLED);
      }
    } else {
      const barH = counts[b] * scale;
      bins.append('rect')
        .attr('x', x - g.colGap * 0.42).attr('y', g.binBottom - barH)
        .attr('width', g.colGap * 0.84).attr('height', barH)
        .attr('fill', BALL_SETTLED).attr('rx', 1);
    }
  }
  bins.append('line')
    .attr('x1', binX(rows) + g.colGap / 2).attr('x2', binX(rows) + g.colGap / 2)
    .attr('y1', g.binTop).attr('y2', g.binBottom)
    .attr('stroke', '#DDE4E8').attr('stroke-width', 1);

  // The bin number IS the statistic — how many times the ball went right — and
  // without it on the picture the pile is just a shape. Labels thin out when
  // the bins get narrow rather than overlapping.
  const every = g.colGap < 26 ? (g.colGap < 16 ? 4 : 2) : 1;
  for (let b = 0; b <= rows; b++) {
    if (b % every !== 0 && b !== rows) continue;
    bins.append('text')
      .attr('x', binX(b)).attr('y', g.binBottom + 16)
      .attr('text-anchor', 'middle').attr('font-size', 12)
      .attr('fill', 'var(--ims-gray-text, #666)')
      .text(b);
  }
  bins.append('text')
    .attr('x', g.cx).attr('y', g.binBottom + 36)
    .attr('text-anchor', 'middle').attr('font-size', 13).attr('font-weight', 700)
    .attr('fill', 'var(--ims-gray-text, #666)')
    .text('Number of times the ball went right');
}

/**
 * The exact binomial, and optionally its normal approximation, over the pile.
 *
 * Both are scaled to the same thing the bars are scaled to, so "the pile is
 * growing into that curve" is a statement about the picture and not a
 * coincidence of two y-axes.
 */
function drawCurves() {
  if (!svg) return;
  const g = geometry();
  const curves = svg.select('.curves');
  curves.selectAll('*').remove();
  if (!dropped) return;

  const maxCount = Math.max(1, ...counts);
  const h = g.binBottom - g.binTop;
  const pmf = binomialPmf();

  // One ball's worth of height: the bins are single-file stacks here, so a
  // ball is one disc, and the curve is scaled to the same thing the stacks are.
  const scale = h / Math.max(maxCount, 6);

  if (showExact) {
    const pts = pmf.map((q, k) => /** @type {[number, number]} */ (
      [binX(k), g.binBottom - q * dropped * scale]));
    curves.append('path')
      .attr('class', 'exact-curve')
      .attr('fill', 'none').attr('stroke', CURVE).attr('stroke-width', 2.5)
      .attr('d', d3Shape.line().curve(d3Shape.curveMonotoneX)(pts) ?? '');
    for (const [x, y] of pts) {
      curves.append('circle').attr('cx', x).attr('cy', y).attr('r', 2.5).attr('fill', CURVE);
    }
  }

  if (showNormal) {
    const mu = rows * p, sg = Math.sqrt(rows * p * (1 - p));
    /** @type {Array<[number, number]>} */
    const pts = [];
    for (let k = -0.5; k <= rows + 0.5; k += 0.1) {
      pts.push([binX(k), g.binBottom - normalPdf(k, mu, sg) * dropped * scale]);
    }
    curves.append('path')
      .attr('class', 'normal-curve')
      .attr('fill', 'none').attr('stroke', NORMAL).attr('stroke-width', 2.5)
      .attr('stroke-dasharray', '7,4')
      .attr('d', d3Shape.line()(pts) ?? '');
  }
}

function drawFalling(/** @type {number} */ now) {
  if (!svg) return;
  const g = geometry();
  const layer = svg.select('.balls');
  layer.selectAll('*').remove();
  const r = Math.max(3, g.colGap * 0.26);
  for (const ball of falling) {
    const { x, y, squash } = ballXY(ball, now - ball.t0);
    layer.append('ellipse')
      .attr('cx', x).attr('cy', y)
      .attr('rx', r * (1 + squash * 0.16))
      .attr('ry', r * (1 - squash * 0.14))
      .attr('fill', BALL);
  }
}

function drawStats() {
  if (!statsEl) return;
  const hopper = mode === 'physical'
    ? `<span class="stat-item"><span class="stat-label">Hopper:</span> `
      + `<span class="stat-value">${reservoir.toLocaleString()}</span></span>`
    : '';
  if (!dropped) {
    statsEl.innerHTML = (mode === 'physical'
      ? '<span class="stat-item">Open the tap to begin.</span>'
      : '<span class="stat-item">Drop a ball to begin.</span>') + hopper;
    return;
  }
  const mean = counts.reduce((a, c, k) => a + c * k, 0) / dropped;
  const variance = counts.reduce((a, c, k) => a + c * (k - mean) ** 2, 0) / Math.max(1, dropped - 1);
  statsEl.innerHTML =
      `<span class="stat-item"><span class="stat-label">${mode === 'physical' ? 'Beads' : 'Balls'}:</span> <span class="stat-value">${dropped.toLocaleString()}</span></span>`
    + `<span class="stat-item"><span class="stat-label">Mean bin:</span> <span class="stat-value">${mean.toFixed(2)}</span></span>`
    + `<span class="stat-item"><span class="stat-label">np:</span> <span class="stat-value">${(rows * p).toFixed(2)}</span></span>`
    + `<span class="stat-item"><span class="stat-label">SD:</span> <span class="stat-value">${Math.sqrt(variance).toFixed(2)}</span></span>`
    + `<span class="stat-item"><span class="stat-label">√(npq):</span> <span class="stat-value">${Math.sqrt(rows * p * (1 - p)).toFixed(2)}</span></span>`
    + hopper;
}

function redraw() {
  if (mode === 'physical') {
    drawFieldTally();
    drawStats();
    drawDrift();
    drawPhysical();
    return;
  }
  drawBins();
  drawCurves();
  drawStats();
  drawDrift();
}

// ─── The physical board ───

/** Where bin `b` of the tally sits, in field coordinates. */
function fieldBinX(/** @type {number} */ b) {
  const f = fieldGeometry();
  return f.cx + (b - rows / 2) * f.colGap;
}

/**
 * The physical board: a field of pins, a hopper, and a tally underneath.
 *
 * Note what is NOT here — bin walls, and a floor for beads to pile on. On the
 * recorded board the beads fall straight out of the bottom of the pin field
 * and the histogram below is drawn, not stacked. Both of our earlier attempts
 * piled real beads into real bins, and both had the same two problems: a bin
 * is several beads wide, so the pile was a quarter the height of the curve
 * over it and had to be rescaled by a fudge factor; and resting stacks are the
 * expensive, jittery part of any impulse solver. Letting them fall through and
 * counting where they exit costs nothing, never jitters, and the bars it draws
 * are on the same footing as every other histogram on this site.
 */
function buildField() {
  if (!boardBox) return;
  boardBox.innerHTML = '';
  const f = fieldGeometry();

  svg = d3Selection.select(boardBox).append('svg')
    .attr('viewBox', `0 0 ${VIEW_W} ${VIEW_H}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .attr('role', 'img')
    .attr('aria-label', `A field of ${rows} rows of pegs with beads falling through it`)
    .style('width', '100%')
    .style('height', 'auto');

  // The hopper: a funnel whose throat is one lattice cell wide. That width is
  // not decoration — see `releasePhysical` for what it is holding up.
  const throat = f.colGap / 2;
  const hy = f.top - f.rowGap * 0.95;
  svg.append('path')
    .attr('d', `M ${f.cx - throat * 3.2} 5 L ${f.cx - throat} ${hy} L ${f.cx - throat} ${hy + 6}`
             + ` M ${f.cx + throat * 3.2} 5 L ${f.cx + throat} ${hy} L ${f.cx + throat} ${hy + 6}`)
    .attr('fill', 'none').attr('stroke', PEG).attr('stroke-width', 2.5)
    .attr('stroke-linejoin', 'round');

  const pegs = svg.append('g').attr('class', 'pegs');
  for (const { x, y } of fieldPegs()) {
    pegs.append('circle').attr('cx', x).attr('cy', y).attr('r', f.pr).attr('fill', PEG);
  }

  // The line beads fall past on their way out, and are counted at.
  svg.append('line')
    .attr('x1', f.cx - f.halfW - f.colGap / 2).attr('x2', f.cx + f.halfW + f.colGap / 2)
    .attr('y1', f.bottom + f.rowGap * 0.6).attr('y2', f.bottom + f.rowGap * 0.6)
    .attr('stroke', '#DDE4E8').attr('stroke-width', 1).attr('stroke-dasharray', '4,4');

  svg.append('g').attr('class', 'bars');
  svg.append('g').attr('class', 'curves');
  svg.append('g').attr('class', 'balls');

  // The tally's baseline.
  svg.append('line')
    .attr('x1', fieldBinX(0) - f.colGap).attr('x2', fieldBinX(rows) + f.colGap)
    .attr('y1', f.barBottom).attr('y2', f.barBottom)
    .attr('stroke', '#444').attr('stroke-width', 2);

  drawFieldTally();
}

/**
 * The tally of exits, as bars, with the binomial drawn over it.
 *
 * Bars and curve share one scale — counts per bead-worth of height — so "the
 * tally is growing into the curve" is a statement about the picture.
 */
function drawFieldTally() {
  if (!svg) return;
  const f = fieldGeometry();
  const bars = svg.select('.bars');
  const curves = svg.select('.curves');
  bars.selectAll('*').remove();
  curves.selectAll('*').remove();

  const h = f.barBottom - f.barTop;
  const scale = h / Math.max(Math.max(1, ...counts), 6);
  const w = f.colGap * 0.86;

  for (let b = 0; b <= rows; b++) {
    if (!counts[b]) continue;
    bars.append('rect')
      .attr('x', fieldBinX(b) - w / 2).attr('y', f.barBottom - counts[b] * scale)
      .attr('width', w).attr('height', counts[b] * scale)
      .attr('fill', BALL_SETTLED).attr('rx', 1);
  }

  const every = f.colGap < 26 ? (f.colGap < 16 ? 4 : 2) : 1;
  for (let b = 0; b <= rows; b++) {
    if (b % every !== 0 && b !== rows) continue;
    bars.append('text')
      .attr('x', fieldBinX(b)).attr('y', f.barBottom + 15)
      .attr('text-anchor', 'middle').attr('font-size', 12)
      .attr('fill', 'var(--ims-gray-text, #666)')
      .text(b);
  }
  bars.append('text')
    .attr('x', f.cx).attr('y', f.barBottom + 33)
    .attr('text-anchor', 'middle').attr('font-size', 13).attr('font-weight', 700)
    .attr('fill', 'var(--ims-gray-text, #666)')
    .text('Number of times the bead went right');

  svg.attr('aria-label', dropped
    ? `A field of ${rows} rows of pegs with beads falling through it, over a histogram `
      + `of where ${dropped} beads came out: tallest bar at ${counts.indexOf(Math.max(...counts))}, `
      + `against a binomial mean of ${(rows * p).toFixed(1)}.`
    : `A field of ${rows} rows of pegs. No beads have been poured yet.`);

  if (!dropped) return;
  const pmf = binomialPmf();
  if (showExact) {
    const pts = pmf.map((q, k) => /** @type {[number, number]} */ (
      [fieldBinX(k), f.barBottom - q * dropped * scale]));
    curves.append('path')
      .attr('class', 'exact-curve')
      .attr('fill', 'none').attr('stroke', CURVE).attr('stroke-width', 2.5)
      .attr('d', d3Shape.line().curve(d3Shape.curveMonotoneX)(pts) ?? '');
    for (const [x, y] of pts) {
      curves.append('circle').attr('cx', x).attr('cy', y).attr('r', 2.5).attr('fill', CURVE);
    }
  }
  if (showNormal) {
    const mu = rows * p, sg = Math.sqrt(rows * p * (1 - p));
    /** @type {Array<[number, number]>} */
    const pts = [];
    for (let k = -0.5; k <= rows + 0.5; k += 0.1) {
      pts.push([fieldBinX(k), f.barBottom - normalPdf(k, mu, sg) * dropped * scale]);
    }
    curves.append('path')
      .attr('class', 'normal-curve')
      .attr('fill', 'none').attr('stroke', NORMAL).attr('stroke-width', 2.5)
      .attr('stroke-dasharray', '7,4')
      .attr('d', d3Shape.line()(pts) ?? '');
  }
}


/**
 * Build the world for the physical field.
 *
 * No bin dividers and no floor: beads fall out of the bottom of the field, get
 * tallied by where they exit, and are removed. That is how the recorded board
 * behaves, and it is also a large simplification — nothing rests, so there are
 * no stacks to keep from jittering and no sleeping to manage, which is what
 * lets hundreds of beads be in the air at once.
 */
function buildWorld() {
  const f = fieldGeometry();
  world = createWorld({
    pegs: fieldPegs(),
    pegR: f.pr,
    floorY: VIEW_H * 4,      // far below: beads are removed long before this
    leftX: f.cx - f.halfW - f.colGap / 2,
    rightX: f.cx + f.halfW + f.colGap / 2,
    dividers: [],            // nothing to confine; the field is open
    binTop: VIEW_H * 4,      // nothing ever sleeps
  });
  world.params.restitution = bounceInput ? Number(bounceInput.value) : 0.2;
  // Low, and that is not a detail. Friction here turns a bead's sideways slide
  // into spin, and spin does nothing — so a high value just glues beads to the
  // peg they landed on. Measured at 0.9: transit 22 s a bead and a spread of
  // 1.1 against 1.73. At 0.05 the bead rolls off and goes on with its walk.
  world.params.friction = 0.05;
  // Heavier than the ideal board's notional gravity: a bead only has one row
  // gap to re-accelerate in after each bounce, and at 900 it dawdles through
  // the field for seconds. This is the knob that sets how long a bead is in
  // the air, and so how dense the stream looks at a given pour rate.
  world.params.gravity = 2800;
  world.params.interact = interactToggle ? interactToggle.checked : true;
}

/**
 * Beads per second for the board as it is currently built.
 *
 * A bead has to clear the throat before the next one arrives, and that takes
 * longer for a fat bead. At a flat 30 a second a five-row board — whose beads
 * are twice the size — jammed at the hopper, and the jam, not the pins, decided
 * where the beads went: the histogram came out nearly flat.
 */
function pourRate() {
  return Math.max(8, Math.min(45, POUR_RATE * (5 / fieldGeometry().br)));
}

/**
 * Drop one bead into the top of the field, from the hopper.
 * @returns {boolean} false if it could not — empty hopper, or a jam.
 */
function releasePhysical() {
  if (!world || reservoir <= 0) return false;
  if (world.balls.length >= MAX_IN_FLIGHT) return false;
  const f = fieldGeometry();
  // The hopper's throat is one lattice cell wide, and that width matters more
  // than it looks. The first row has a peg directly under the hopper, so a
  // bead released exactly on centre lands exactly on the peg's crown — a knife
  // edge, which a deterministic simulation does not fall off. Measured: with a
  // ±2px nudge, every one of six beads balanced its way down the centre column
  // and landed in bin 6, taking 10 seconds about it. Spread across the cell,
  // each bead meets its first peg off-centre and deflects, which is the whole
  // mechanism.
  const jitter = (rng() - 0.5) * f.colGap;
  const tilt = (p - 0.5) * 90;      // `p` leans the whole apparatus
  world.add(f.cx + jitter, f.top - f.rowGap * 0.8, tilt, f.br);
  reservoir -= 1;
  return true;
}

/**
 * Tally and remove every bead that has fallen out of the field.
 *
 * The bin is where it EXITS, which is the honest reading: the bead's horizontal
 * position after `rows` rows of deflection.
 */
function harvestSettled() {
  if (!world) return false;
  const f = fieldGeometry();
  let changed = false;
  for (let i = world.balls.length - 1; i >= 0; i--) {
    const b = world.balls[i];
    // They keep falling past the pins and into the bars, which is where they
    // are counted and removed. Vanishing at the edge of the pin field read as
    // a glitch; dropping into the histogram reads as the histogram being made
    // of the beads, which is the whole claim.
    if (b.y < f.barBottom - b.r) continue;
    const bin = Math.max(0, Math.min(rows,
      Math.round((b.x - f.cx) / f.colGap + rows / 2)));
    counts[bin] += 1;
    dropped += 1;
    world.balls.splice(i, 1);
    changed = true;
  }
  return changed;
}

/** The beads in flight — small, dark, and many. */
function drawPhysical() {
  if (!svg || !world) return;
  const layer = svg.select('.balls');
  layer.selectAll('*').remove();
  for (const b of world.balls) {
    const sq = b.squash;
    const ang = Math.atan2(b.squashNy, b.squashNx) * 180 / Math.PI;
    layer.append('ellipse')
      .attr('transform', `translate(${b.x},${b.y}) rotate(${ang})`)
      .attr('rx', b.r * (1 - sq * 0.28)).attr('ry', b.r * (1 + sq * 0.2))
      .attr('fill', BEAD);
  }
}

/** How far the physical pile has drifted from the binomial it is imitating. */
function drawDrift() {
  if (!driftEl) return;
  if (mode !== 'physical' || !dropped) { driftEl.textContent = ''; driftEl.className = 'gb-drift'; return; }
  const mean = counts.reduce((a, c, k) => a + c * k, 0) / dropped;
  const sd = Math.sqrt(counts.reduce((a, c, k) => a + c * (k - mean) ** 2, 0) / Math.max(1, dropped - 1));
  const npq = Math.sqrt(rows * p * (1 - p));
  const off = Math.abs(sd - npq) / npq;

  // A handful of beads says nothing: the SD of an SD is large at small n, and a
  // tool that cries "the model is broken!" after ten beads teaches the opposite
  // of what it should.
  if (dropped < 60) {
    driftEl.className = 'gb-drift';
    driftEl.innerHTML = `Spread ${sd.toFixed(2)} against \u221a(npq) = ${npq.toFixed(2)}, `
      + `from ${dropped} bead${dropped === 1 ? '' : 's'} \u2014 far too few to tell `
      + `a real difference from ordinary noise. Keep pouring.`;
    return;
  }
  driftEl.className = off > 0.2 ? 'gb-drift is-off' : 'gb-drift';
  driftEl.innerHTML = off > 0.2
    ? `These bars are <strong>not</strong> the binomial drawn over them \u2014 their spread is `
      + `${(off * 100).toFixed(0)}% ${sd > npq ? 'wider' : 'narrower'} than \u221a(npq), `
      + `over ${dropped} beads. Something about this board is breaking an assumption `
      + `the model makes.`
    : `Spread ${sd.toFixed(2)} against \u221a(npq) = ${npq.toFixed(2)} over ${dropped} beads. `
      + `This board is behaving itself \u2014 try bigger beads, more bounce, or turning off `
      + `<em>Beads hit each other</em> and comparing.`;
}

// ─── Dropping ───

/** One ball's decisions: right with probability p at every peg. */
function newPath() {
  const path = new Uint8Array(rows);
  for (let i = 0; i < rows; i++) path[i] = rng() < p ? 1 : 0;
  return path;
}

/** Land a ball in its bin without animating it. */
function landNow(/** @type {Uint8Array} */ path) {
  const bin = path.reduce((a, b) => a + b, 0);
  counts[bin] += 1;
  dropped += 1;
}

/** @param {number} count */
function drop(count) {
  if (mode === 'physical') {
    // There is no fast path here: a physical bead's bin is wherever it ends up,
    // so it has to actually fall. A big batch becomes a long pour.
    const n = Math.min(count, reservoir - queued);
    if (n <= 0) { announce('The hopper is empty. Clear the board to refill it.'); return; }
    queued += n;
    if (!nextRelease) nextRelease = simTime;
    ensureLoop();
    announce(`Pouring ${n} bead${n === 1 ? '' : 's'}.`);
    return;
  }
  if (count <= ANIMATE_UP_TO && !prefersReducedMotion()) {
    const now = performance.now();
    for (let i = 0; i < count; i++) {
      const path = newPath();
      falling.push({ t0: now + i * RELEASE_MS, path, bin: path.reduce((a, b) => a + b, 0) });
    }
    ensureLoop();
  } else {
    for (let i = 0; i < count; i++) landNow(newPath());
    redraw();
  }
  announce(`${count} ball${count === 1 ? '' : 's'} dropped; ${dropped + falling.length} in all.`);
}

function tick(/** @type {number} */ now) {
  rafId = null;
  if (mode === 'physical') { tickPhysical(now); return; }
  // Release a new ball on schedule while playing — by the clock, so the stream
  // is the same rate on any machine.
  if (playing && now - lastRelease >= RELEASE_MS) {
    lastRelease = now;
    const path = newPath();
    falling.push({ t0: now, path, bin: path.reduce((a, b) => a + b, 0) });
  }

  const total = (rows + 1) * HOP_MS;   // rows hops, plus the drop into the bin
  let landed = false;
  falling = falling.filter((ball) => {
    if (now - ball.t0 < total) return true;
    counts[ball.bin] += 1;
    dropped += 1;
    landed = true;
    return false;
  });
  if (landed) redraw();
  drawFalling(now);

  if (playing || falling.length) ensureLoop();
}

function ensureLoop() {
  if (rafId === null) rafId = requestAnimationFrame(tick);
}

/**
 * One frame of the physical board.
 *
 * The world only ever advances in whole steps of DT. A frame works out how
 * many it has earned from the clock and takes that many — so a 120Hz monitor
 * and a loaded laptop run the same simulation, just drawn more or less often.
 * The step budget per frame is capped: after a background tab, catching up
 * honestly would freeze the page, so the world simply loses that time.
 */
function tickPhysical(/** @type {number} */ now) {
  if (!world) buildWorld();
  if (!physLast) physLast = now;
  const rate = slowmo ? 0.25 : 1;
  physAccum += Math.min(0.25, (now - physLast) / 1000) * rate;
  physLast = now;

  let steps = 0;
  let poured = false;
  while (physAccum >= DT && steps < 10) {
    // Releases are interleaved with the steps, against the world's own clock,
    // so the run is the same on any machine.
    if ((queued > 0 || playing) && simTime >= nextRelease) {
      if (releasePhysical()) {
        if (queued > 0) queued -= 1;
        poured = true;
        nextRelease = simTime + 1 / pourRate();
      } else {
        // Empty hopper or a jam. Either way, come back shortly rather than
        // burning the backlog the instant a space appears.
        nextRelease = simTime + 0.2;
        if (reservoir <= 0) { queued = 0; playing = false; setPlayButton(); }
      }
    }
    world?.step();
    simTime += DT;
    physAccum -= DT;
    steps++;
  }
  if (physAccum > DT * 10) physAccum = 0;

  if (harvestSettled()) { drawFieldTally(); drawDrift(); drawStats(); }
  else if (poured) drawStats();              // the hopper is counting down
  drawPhysical();

  const busy = playing || queued > 0 || (world && world.balls.length > 0);
  if (busy) ensureLoop();
}

function setPlayButton() {
  if (!playBtn) return;
  playBtn.textContent = playing ? '■' : '▶';
  playBtn.title = playing ? 'Stop' : 'Play — keep dropping balls';
  playBtn.setAttribute('aria-label', playing ? 'Stop dropping balls' : 'Play: keep dropping balls');
  playBtn.setAttribute('aria-pressed', String(playing));
}

function togglePlay() {
  playing = !playing;
  if (playing) { lastRelease = 0; ensureLoop(); }
  setPlayButton();
  announce(playing ? 'Dropping balls continuously.' : `Stopped at ${dropped} balls.`);
}

function reset(message = 'Board cleared.') {
  playing = false;
  setPlayButton();
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  falling = [];
  queued = 0;
  reservoir = HOPPER;
  simTime = 0;
  nextRelease = 0;
  lastRelease = 0;
  counts = new Array(rows + 1).fill(0);
  dropped = 0;
  rng = createRng(`${seed}:${rows}:${p}`);
  buildBoard();
  if (mode === 'physical') { buildWorld(); physAccum = 0; physLast = 0; }
  redraw();
  announce(message);
}

// ─── Wiring ───

for (const btn of document.querySelectorAll('.gen-btn')) {
  btn.addEventListener('click', () => {
    if (playing) togglePlay();
    drop(Number(/** @type {HTMLElement} */ (btn).dataset.count) || 1);
  });
}
el('reset-btn')?.addEventListener('click', () => reset());

{
  const bar = el('controls');
  const resetButton = el('reset-btn');
  if (bar) {
    playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'play-btn';
    setPlayButton();
    playBtn.addEventListener('click', togglePlay);
    bar.insertBefore(playBtn, resetButton);
  }
}

rowsInput?.addEventListener('change', () => {
  const v = clamp(Number(rowsInput.value), 3, 20);
  rowsInput.value = String(v);
  if (v === rows) return;
  rows = v;
  reset(`${rows} rows. The board is cleared, because a ball that fell through `
    + `${rows} pegs is not comparable with one that fell through fewer.`);
});

pInput?.addEventListener('input', () => {
  p = clampP(Number(pInput.value));
  if (pReadout) pReadout.textContent = p.toFixed(2);
});
pInput?.addEventListener('change', () => {
  reset(`Probability of bouncing right is now ${p.toFixed(2)}.`);
});

normalToggle?.addEventListener('change', () => {
  showNormal = !!normalToggle.checked;
  drawCurves();
  announce(showNormal ? 'Normal approximation shown.' : 'Normal approximation hidden.');
});
exactToggle?.addEventListener('change', () => {
  showExact = !!exactToggle.checked;
  drawCurves();
  announce(showExact ? 'Exact binomial shown.' : 'Exact binomial hidden.');
});

modeToggle?.addEventListener('click', (ev) => {
  const btn = /** @type {HTMLElement} */ (ev.target).closest('button[data-mode]');
  if (!btn) return;
  const next = /** @type {string} */ (/** @type {HTMLElement} */ (btn).dataset.mode);
  if (next === mode) return;
  mode = next;
  for (const b of modeToggle.querySelectorAll('button[data-mode]')) {
    b.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (b).dataset.mode === mode));
  }
  if (physicsBox) physicsBox.hidden = mode !== 'physical';
  // `p` means something different in each board — a coin's bias in one, a lean
  // of the whole apparatus in the other — so it stays, but the label would lie
  // if it still said "chance". The hint on the field says which.
  if (pField) {
    pField.querySelector('.gb-label').innerHTML = mode === 'physical'
      ? 'Tilt the board <em>p</em>:' : 'Chance of going right <em>p</em>:';
  }
  if (genLabel) genLabel.textContent = mode === 'physical' ? 'Beads' : 'Balls';
  reset(mode === 'physical'
    ? 'Physical board. The balls now fall and bounce for themselves, and the pile is whatever that produces.'
    : 'Ideal board. Every bounce is a coin flip, so the pile is exactly binomial.');
});

// Both diameters change the lattice — the board is spaced for the bead it has
// to pass — so both rebuild the field and the world under it.
function resizeParts() {
  if (world) world.setPegR(fieldGeometry().pr);
  buildBoard();
  if (mode === 'physical') { buildWorld(); redraw(); }
}
pegrInput?.addEventListener('input', () => { pegR = Number(pegrInput.value); resizeParts(); });
ballrInput?.addEventListener('input', () => { ballR = Number(ballrInput.value); resizeParts(); });
bounceInput?.addEventListener('input', () => {
  if (world) world.params.restitution = Number(bounceInput.value);
});
interactToggle?.addEventListener('change', () => {
  if (world) world.params.interact = interactToggle.checked;
  announce(interactToggle.checked
    ? 'Balls collide with each other \u2014 their paths are no longer independent.'
    : 'Balls pass through each other \u2014 each one falls as if it were alone.');
});
slowmoToggle?.addEventListener('change', () => {
  slowmo = slowmoToggle.checked;
  announce(slowmo ? 'Slow motion.' : 'Normal speed.');
});

document.addEventListener('keydown', (ev) => {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(/** @type {HTMLElement} */ (ev.target).tagName)) return;
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const counts_ = { '1': 1, '2': 10, '3': 100, '4': 1000 };
  if (ev.key in counts_) { ev.preventDefault(); if (playing) togglePlay(); drop(counts_[/** @type {'1'} */ (ev.key)]); }
  else if (ev.key === 'p' || ev.key === 'P') { ev.preventDefault(); togglePlay(); }
  else if (ev.key === 'r' || ev.key === 'R') { ev.preventDefault(); reset(); }
});

initHelp();
initSettings();

if (rowsInput) rowsInput.value = String(rows);
if (pInput) pInput.value = String(p);
if (pReadout) pReadout.textContent = p.toFixed(2);
if (normalToggle) normalToggle.checked = showNormal;
if (physicsBox) physicsBox.hidden = mode !== 'physical';
for (const b of modeToggle?.querySelectorAll('button[data-mode]') ?? []) {
  b.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (b).dataset.mode === mode));
}
if (mode === 'physical') {
  if (pField) pField.querySelector('.gb-label').innerHTML = 'Tilt the board <em>p</em>:';
  if (genLabel) genLabel.textContent = 'Beads';
}
if (exactToggle) exactToggle.checked = showExact;

buildBoard();
if (mode === 'physical') buildWorld();
redraw();

const preset = Number(params.get('balls'));
// The physical board is nothing BUT motion, so a `?balls=` link must not start
// it pouring at someone who has asked for less of that. The buttons still work
// — a pour they started themselves, and can stop, is a different thing.
if (Number.isFinite(preset) && preset > 0 && !(mode === 'physical' && prefersReducedMotion())) {
  drop(Math.min(preset, 100000));
}
