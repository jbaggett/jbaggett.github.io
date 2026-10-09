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
const BALL_SETTLED = '#569BBD';// once it is part of the pile it is data
const PEG = '#8FA6B2';
const CURVE = '#7B2D8E';       // the exact binomial, in the statistic purple
const NORMAL = '#D55E00';      // the normal approximation

const VIEW_W = 760;
const VIEW_H = 560;

/** How long one peg-to-peg hop takes. The whole fall is rows × this. */
const HOP_MS = 150;
/** Gap between releases while playing — a stream, not a volley. */
const RELEASE_MS = 190;
/** Past this the pile is bars rather than stacked balls. */
const MAX_STACK_BALLS = 28;
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
let pegR = 5, ballR = 7;
/** @type {ReturnType<typeof createWorld>|null} */ let world = null;
let physAccum = 0;
let physLast = 0;
/** Balls that have come to rest and been counted. */
let settledIds = new Set();
/**
 * Release times, in SIMULATED seconds, still waiting to be poured.
 *
 * Simulated, not wall-clock, and that is the difference between `?seed=` being
 * a promise here and not. The world advances in fixed steps, so a given number
 * of steps always produces the same physics — but if balls were released when
 * the WALL clock said so, a slower machine would release them at different
 * points in that sequence and get a different pile. Scheduling against the
 * world's own clock makes the whole run reproducible.
 */
/** @type {number[]} */ let pending = [];
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
    if (mode === 'physical') continue;   // the pile IS the balls, drawn by physics
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

  // How tall one ball's worth of pile is.
  //
  // In Ideal mode the bins are single-file stacks, so a ball is one disc high.
  // In Physical mode a bin is several balls WIDE — about colGap/2r of them —
  // so the same count makes a pile a quarter as tall, and a curve scaled for
  // stacks towers absurdly over it. Scaling to the pile is what keeps "the
  // balls are growing into the curve" an honest statement in both modes.
  let scale;
  if (mode === 'physical') {
    const perLayer = Math.max(1, Math.floor(g.colGap / (2 * ballR)));
    scale = (2 * ballR * 0.9) / perLayer;
    // Never taller than the bin: a huge pile should flatten, not escape.
    scale = Math.min(scale, h / Math.max(maxCount, 6));
  } else {
    scale = h / Math.max(maxCount, 6);
  }

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
  if (!dropped) {
    statsEl.innerHTML = '<span class="stat-item">Drop a ball to begin.</span>';
    return;
  }
  const mean = counts.reduce((a, c, k) => a + c * k, 0) / dropped;
  const variance = counts.reduce((a, c, k) => a + c * (k - mean) ** 2, 0) / Math.max(1, dropped - 1);
  statsEl.innerHTML =
      `<span class="stat-item"><span class="stat-label">Balls:</span> <span class="stat-value">${dropped.toLocaleString()}</span></span>`
    + `<span class="stat-item"><span class="stat-label">Mean bin:</span> <span class="stat-value">${mean.toFixed(2)}</span></span>`
    + `<span class="stat-item"><span class="stat-label">np:</span> <span class="stat-value">${(rows * p).toFixed(2)}</span></span>`
    + `<span class="stat-item"><span class="stat-label">SD:</span> <span class="stat-value">${Math.sqrt(variance).toFixed(2)}</span></span>`
    + `<span class="stat-item"><span class="stat-label">√(npq):</span> <span class="stat-value">${Math.sqrt(rows * p * (1 - p)).toFixed(2)}</span></span>`;
}

function redraw() {
  drawBins();
  drawCurves();
  drawStats();
  drawDrift();
  if (mode === 'physical') drawPhysical();
}

// ─── The physical board ───

/** Build (or rebuild) the world to match the current geometry and knobs. */
function buildWorld() {
  const g = geometry();
  /** @type {Array<{x: number, y: number}>} */
  const pegList = [];
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k <= r; k++) pegList.push(pegXY(r, k));
  }
  const dividers = [];
  for (let b = 0; b <= rows + 1; b++) dividers.push(binX(b) - g.colGap / 2);

  world = createWorld({
    pegs: pegList,
    pegR,
    floorY: g.binBottom,
    leftX: binX(0) - g.colGap / 2,
    rightX: binX(rows) + g.colGap / 2,
    dividers,
    binTop: g.binTop,
  });
  world.params.restitution = bounceInput ? Number(bounceInput.value) : 0.38;
  world.params.interact = interactToggle ? interactToggle.checked : true;
  settledIds = new Set();
}

/**
 * Release one ball into the physical world.
 *
 * The only randomness is a sub-pixel nudge off dead centre, from the page's
 * seeded generator. Without it every ball would take the identical path — a
 * perfectly centred ball on a perfectly symmetric board is a knife edge, and
 * the real thing is nudged by air, dust and the hopper.
 */
function releasePhysical() {
  if (!world) return;
  const g = geometry();
  const jitter = (rng() - 0.5) * ballR * 0.9;
  // The tilt is how `p` survives into the physical board: a board leaning
  // right sends balls right, rather than a coin deciding for them.
  const tilt = (p - 0.5) * 120;
  world.add(g.cx + jitter, g.padTop - g.rowGap * 1.2, tilt, ballR);
}

/** Count any ball that has just come to rest, by where it rests. */
function harvestSettled() {
  if (!world) return false;
  let changed = false;
  for (const b of world.balls) {
    if (!b.resting || settledIds.has(b.id)) continue;
    settledIds.add(b.id);
    const g = geometry();
    const bin = Math.max(0, Math.min(rows, Math.round((b.x - g.cx) / g.colGap + rows / 2)));
    counts[bin] += 1;
    dropped += 1;
    changed = true;
  }
  return changed;
}

/** The physical pile, drawn as the balls actually lie. */
function drawPhysical() {
  if (!svg || !world) return;
  const layer = svg.select('.balls');
  layer.selectAll('*').remove();
  for (const b of world.balls) {
    const sq = b.squash;
    // Squash along the contact normal: scale down on the normal, out on the
    // tangent, which is what a struck ball does.
    const ang = Math.atan2(b.squashNy, b.squashNx) * 180 / Math.PI;
    const gg = layer.append('g')
      .attr('transform', `translate(${b.x},${b.y}) rotate(${ang})`);
    gg.append('ellipse')
      .attr('rx', b.r * (1 - sq * 0.3)).attr('ry', b.r * (1 + sq * 0.22))
      .attr('fill', b.resting ? BALL_SETTLED : BALL);
    // A stripe so the spin is visible — a plain disc rotating looks like a
    // plain disc, and the spin is half of what makes a bounce read as physical.
    gg.append('line')
      .attr('transform', `rotate(${b.angle * 180 / Math.PI - ang})`)
      .attr('x1', -b.r * 0.72).attr('x2', b.r * 0.72).attr('y1', 0).attr('y2', 0)
      .attr('stroke', b.resting ? '#2E6E8E' : '#A64B0B')
      .attr('stroke-width', Math.max(1, b.r * 0.26))
      .attr('stroke-linecap', 'round');
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

  // A handful of balls says nothing. The SD of an SD is large at small n, and
  // a tool that cries "the model is broken!" after ten balls has taught the
  // opposite of what it should. Sixty is where a 25% gap stops being ordinary
  // noise for the board sizes this page allows.
  if (dropped < 60) {
    driftEl.className = 'gb-drift';
    driftEl.innerHTML = `Spread ${sd.toFixed(2)} against \u221a(npq) = ${npq.toFixed(2)}, `
      + `from ${dropped} ball${dropped === 1 ? '' : 's'} \u2014 far too few to tell `
      + `a real difference from ordinary noise. Keep pouring.`;
    return;
  }
  driftEl.className = off > 0.2 ? 'gb-drift is-off' : 'gb-drift';
  driftEl.innerHTML = off > 0.2
    ? `This pile is <strong>not</strong> the binomial drawn over it \u2014 its spread is `
      + `${(off * 100).toFixed(0)}% ${sd > npq ? 'wider' : 'narrower'} than \u221a(npq), `
      + `over ${dropped} balls. Something about this board is breaking an assumption `
      + `the model makes.`
    : `Spread ${sd.toFixed(2)} against \u221a(npq) = ${npq.toFixed(2)} over ${dropped} balls. `
      + `This board is behaving itself \u2014 try bigger balls, more bounce, or letting them `
      + `collide.`;
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
    // There is no fast path here: a physical ball's bin is wherever it ends
    // up, so it has to actually fall. Big batches become a long pour.
    for (let i = 0; i < Math.min(count, 120); i++) pending.push(simTime + i * 0.09);
    ensureLoop();
    announce(`Pouring ${Math.min(count, 120)} balls.`);
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
  while (physAccum >= DT && steps < 10) {
    // Releases are interleaved with the steps, against the world's own clock,
    // so the run is the same on any machine.
    while (pending.length && simTime >= pending[0]) { pending.shift(); releasePhysical(); }
    if (playing && simTime - lastRelease >= RELEASE_MS / 1000) {
      lastRelease = simTime;
      releasePhysical();
    }
    world?.step();
    simTime += DT;
    physAccum -= DT;
    steps++;
  }
  if (physAccum > DT * 10) physAccum = 0;

  if (harvestSettled()) { drawBins(); drawCurves(); drawStats(); drawDrift(); }
  drawPhysical();

  const busy = playing || pending.length || (world && world.balls.some((b) => !b.resting));
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
  pending = [];
  simTime = 0;
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
  reset(mode === 'physical'
    ? 'Physical board. The balls now fall and bounce for themselves, and the pile is whatever that produces.'
    : 'Ideal board. Every bounce is a coin flip, so the pile is exactly binomial.');
});

pegrInput?.addEventListener('input', () => {
  pegR = Number(pegrInput.value);
  if (world) { world.setPegR(pegR); }
  buildBoard();
  if (mode === 'physical') { buildWorld(); redraw(); }
});
ballrInput?.addEventListener('input', () => { ballR = Number(ballrInput.value); });
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
if (mode === 'physical' && pField) {
  pField.querySelector('.gb-label').innerHTML = 'Tilt the board <em>p</em>:';
}
if (exactToggle) exactToggle.checked = showExact;

buildBoard();
if (mode === 'physical') buildWorld();
redraw();

const preset = Number(params.get('balls'));
if (Number.isFinite(preset) && preset > 0) drop(Math.min(preset, 100000));
