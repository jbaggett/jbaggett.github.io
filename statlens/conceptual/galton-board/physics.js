// @ts-check
/**
 * A small, deterministic 2D physics world for the Galton board's Physical mode.
 *
 * Jeff, 2026-10-08, on the simulation he liked: "the balls actually bounce off
 * the pegs … you can vary the diameter of the pegs and the balls … and it
 * actually shows the balls bouncing and bouncing off of each other … it's
 * actually quite fun to watch."
 *
 * So this is the honest opposite of the Ideal board next to it. Nothing here
 * decides where a ball should land: it falls, it hits things, it ends up
 * somewhere. The pile that results is **not** binomial, and the point of having
 * both modes is that you can see by how much — and turn the knob that caused it.
 *
 * ── Deterministic, despite being a physics sim ───────────────────────────
 *
 * Two rules keep `?seed=` a promise:
 *
 *   1. FIXED TIMESTEP. The world only ever advances in steps of `DT`. A frame
 *      asks for however many whole steps the elapsed time has earned; a slow
 *      machine takes more steps per frame, not bigger ones. Variable-dt physics
 *      would make the pile depend on the viewer's frame rate.
 *   2. The only randomness is the release jitter, and it comes from the page's
 *      seeded generator, never from Math.random.
 *
 * ── Why resting balls freeze ─────────────────────────────────────────────
 *
 * Impulse solvers are bad at stacks: a pile of balls resting on each other
 * jitters forever as each contact pushes back. Once a ball has been slow and
 * supported for a few steps it becomes STATIC — it still collides, it just
 * stops integrating. The pile goes solid, which is both correct-looking and
 * what makes the simulation cheap enough to watch.
 */

/** Seconds per physics step. 1/120 keeps a fast ball moving < 1 radius a step. */
export const DT = 1 / 120;

/** Speed below which a supported ball is a candidate for sleeping. */
const SLEEP_SPEED = 9;
/** Steps it must stay that slow before it freezes. */
const SLEEP_STEPS = 14;

/**
 * @typedef {{x: number, y: number, vx: number, vy: number, r: number,
 *            angle: number, spin: number, squash: number, squashNx: number,
 *            squashNy: number, resting: boolean, slow: number, id: number}} Ball
 */

/**
 * @param {object} opts
 * @param {Array<{x: number, y: number}>} opts.pegs
 * @param {number} opts.pegR
 * @param {number} opts.floorY   - where the bins bottom out
 * @param {number} opts.leftX    - the left wall
 * @param {number} opts.rightX   - the right wall
 * @param {Array<number>} opts.dividers - x of each bin divider (walls below binTop)
 * @param {number} opts.binTop   - dividers only exist below this
 */
export function createWorld(opts) {
  const { pegs, floorY, leftX, rightX, dividers, binTop } = opts;
  let pegR = opts.pegR;

  /** @type {Ball[]} */
  const balls = [];
  let nextId = 1;

  /** Tunables the page exposes. */
  const params = {
    gravity: 900,
    restitution: 0.38,   // bounciness against pegs and walls
    friction: 0.22,      // tangential loss at contact — this is what makes spin
    ballRestitution: 0.3,
    interact: true,      // do balls collide with each other?
    maxSpeed: 1200,
  };

  // A uniform grid for the broad phase. Without it, a few hundred balls is
  // 10^4+ pair tests every step at 120 steps a second.
  const CELL = 28;
  /** @type {Map<number, number[]>} */
  const grid = new Map();
  const key = (/** @type {number} */ cx, /** @type {number} */ cy) => cx * 100000 + cy;

  function rebuildGrid() {
    grid.clear();
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      const k = key(Math.floor(b.x / CELL), Math.floor(b.y / CELL));
      const cell = grid.get(k);
      if (cell) cell.push(i); else grid.set(k, [i]);
    }
  }

  /** Peg lookup is static, so bucket them once. */
  /** @type {Map<number, Array<{x: number, y: number}>>} */
  const pegGrid = new Map();
  function rebuildPegGrid() {
    pegGrid.clear();
    for (const p of pegs) {
      const k = key(Math.floor(p.x / CELL), Math.floor(p.y / CELL));
      const cell = pegGrid.get(k);
      if (cell) cell.push(p); else pegGrid.set(k, [p]);
    }
  }
  rebuildPegGrid();

  /**
   * Bounce a ball off a static circle. Returns true if they were touching.
   * @param {Ball} b @param {number} px @param {number} py @param {number} pr
   */
  function hitStatic(b, px, py, pr) {
    const dx = b.x - px, dy = b.y - py;
    const min = b.r + pr;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min || d2 === 0) return false;
    const d = Math.sqrt(d2);
    const nx = dx / d, ny = dy / d;

    // Push out of the peg, then reflect.
    b.x = px + nx * min;
    b.y = py + ny * min;
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) {
      const tx = -ny, ty = nx;
      let vt = b.vx * tx + b.vy * ty;
      // Tangential friction both slows the slide and spins the ball — which is
      // the detail that makes a bounce read as a bounce.
      const spinTransfer = vt * params.friction;
      vt -= spinTransfer;
      b.spin += spinTransfer * 0.045;
      const outN = -vn * params.restitution;
      b.vx = nx * outN + tx * vt;
      b.vy = ny * outN + ty * vt;
      // Squash along the contact normal, recovering over the next few steps.
      b.squash = Math.min(1, Math.abs(vn) / 300);
      b.squashNx = nx; b.squashNy = ny;
    }
    return true;
  }

  /** @param {Ball} a @param {Ball} b */
  function hitBall(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const min = a.r + b.r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min || d2 === 0) return;
    const d = Math.sqrt(d2);
    const nx = dx / d, ny = dy / d;
    const overlap = min - d;

    // Separate. A resting ball does not move, so the live one takes it all.
    if (a.resting && b.resting) return;
    if (a.resting) { b.x += nx * overlap; b.y += ny * overlap; }
    else if (b.resting) { a.x -= nx * overlap; a.y -= ny * overlap; }
    else {
      a.x -= nx * overlap / 2; a.y -= ny * overlap / 2;
      b.x += nx * overlap / 2; b.y += ny * overlap / 2;
    }

    const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
    const vn = rvx * nx + rvy * ny;
    if (vn > 0) return;                       // already separating
    const e = params.ballRestitution;
    if (a.resting || b.resting) {
      const live = a.resting ? b : a;
      const sign = a.resting ? 1 : -1;
      const j = -(1 + e) * vn;
      live.vx += sign * j * nx;
      live.vy += sign * j * ny;
      live.squash = Math.min(1, Math.abs(vn) / 300);
      live.squashNx = nx; live.squashNy = ny;
      // A knock wakes a sleeping ball only if it is hard enough to matter.
      if (Math.abs(vn) > 140) { (a.resting ? a : b).resting = false; (a.resting ? a : b).slow = 0; }
    } else {
      const j = -(1 + e) * vn / 2;            // equal masses
      a.vx -= j * nx; a.vy -= j * ny;
      b.vx += j * nx; b.vy += j * ny;
      a.squash = b.squash = Math.min(1, Math.abs(vn) / 320);
      a.squashNx = b.squashNx = nx; a.squashNy = b.squashNy = ny;
    }
  }

  /**
   * Keep a ball inside whatever bin it is in. Dividers are solid all the way
   * from `binTop` to the floor, as they are on a real board.
   * @param {Ball} b
   */
  function confine(b) {
    if (dividers.length < 2) return;
    // Which slot: the dividers are evenly spaced, so this is arithmetic rather
    // than a search.
    const pitch = dividers[1] - dividers[0];
    let i = Math.floor((b.x - dividers[0]) / pitch);
    i = Math.max(0, Math.min(dividers.length - 2, i));
    const lo = dividers[i] + b.r, hi = dividers[i + 1] - b.r;
    if (hi <= lo) { b.x = (dividers[i] + dividers[i + 1]) / 2; return; }
    if (b.x < lo) { b.x = lo; if (b.vx < 0) b.vx = -b.vx * params.restitution; }
    else if (b.x > hi) { b.x = hi; if (b.vx > 0) b.vx = -b.vx * params.restitution; }
  }

  return {
    params,
    balls,
    setPegR(/** @type {number} */ r) { pegR = r; },

    /** @param {number} x @param {number} y @param {number} vx @param {number} r */
    add(x, y, vx, r) {
      balls.push({ x, y, vx, vy: 0, r, angle: 0, spin: 0,
                   squash: 0, squashNx: 0, squashNy: 1, resting: false, slow: 0, id: nextId++ });
    },

    clear() { balls.length = 0; },
    rebuildPegs() { rebuildPegGrid(); },

    /** Advance exactly one fixed step. */
    step() {
      const g = params.gravity * DT;
      for (const b of balls) {
        if (b.resting) {
          b.squash *= 0.8;
          // A resting ball still belongs to its bin: the pile can press on it,
          // and without this it creeps across a divider over many steps.
          if (b.y > binTop) confine(b);
          continue;
        }
        b.vy += g;
        const sp = Math.hypot(b.vx, b.vy);
        if (sp > params.maxSpeed) { b.vx *= params.maxSpeed / sp; b.vy *= params.maxSpeed / sp; }
        b.x += b.vx * DT;
        b.y += b.vy * DT;
        b.angle += b.spin * DT;
        b.spin *= 0.995;
        b.squash *= 0.78;

        // Pegs: only the cells the ball could be touching.
        const cx = Math.floor(b.x / CELL), cy = Math.floor(b.y / CELL);
        for (let ix = cx - 1; ix <= cx + 1; ix++) {
          for (let iy = cy - 1; iy <= cy + 1; iy++) {
            const cell = pegGrid.get(key(ix, iy));
            if (!cell) continue;
            for (const p of cell) hitStatic(b, p.x, p.y, pegR);
          }
        }

        // Outer walls, and the bin dividers once the ball is low enough.
        if (b.x - b.r < leftX) { b.x = leftX + b.r; b.vx = Math.abs(b.vx) * params.restitution; }
        if (b.x + b.r > rightX) { b.x = rightX - b.r; b.vx = -Math.abs(b.vx) * params.restitution; }
        // Bin walls, as a hard constraint rather than a distance test.
        //
        // Testing each divider for |x - dx| < r let fast balls tunnel through
        // and let resting ones be shoved across by the pile, so balls ended up
        // heaped on the floor instead of in bins — and the counts, which come
        // from where a ball RESTS, were counting the heap. Clamping to the bin
        // the ball is already in cannot tunnel: there is nowhere else to be.
        if (b.y > binTop) confine(b);

        if (b.y + b.r > floorY) {
          b.y = floorY - b.r;
          if (b.vy > 0) {
            b.vy = -b.vy * params.restitution;
            b.spin *= 0.6;
            b.squash = Math.min(1, Math.abs(b.vy) / 300);
            b.squashNx = 0; b.squashNy = -1;
          }
          // Rolling friction. Without it a landed ball skates the length of the
          // floor and the pile never forms where the ball arrived.
          b.vx *= 0.90;
        }
      }

      if (params.interact) {
        rebuildGrid();
        for (let i = 0; i < balls.length; i++) {
          const a = balls[i];
          const cx = Math.floor(a.x / CELL), cy = Math.floor(a.y / CELL);
          for (let ix = cx - 1; ix <= cx + 1; ix++) {
            for (let iy = cy - 1; iy <= cy + 1; iy++) {
              const cell = grid.get(key(ix, iy));
              if (!cell) continue;
              for (const j of cell) if (j > i) hitBall(a, balls[j]);
            }
          }
        }
      }

      // Sleep: slow, and low enough to be part of the pile rather than in flight.
      for (const b of balls) {
        if (b.resting) continue;
        const slowEnough = Math.hypot(b.vx, b.vy) < SLEEP_SPEED && b.y > binTop;
        b.slow = slowEnough ? b.slow + 1 : 0;
        if (b.slow >= SLEEP_STEPS) {
          b.resting = true;
          b.vx = b.vy = 0;
          b.spin *= 0.2;
        }
      }
    },
  };
}
