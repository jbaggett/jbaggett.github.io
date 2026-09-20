/**
 * Sketch from Conditions — the model of a hand-drawn function, and the check.
 *
 * The exercise is Stewart §2.2/2.5: "sketch a function f satisfying
 * lim(x→2⁻) f = 3, lim(x→2⁺) f = −1, f(2) = 1, …". On paper it cannot be graded
 * at scale and cannot be self-checked at all, because there are infinitely many
 * correct answers. So the question here is never "does your curve match mine" —
 * it is **does your curve satisfy every condition**, one condition at a time,
 * which is also the only feedback worth giving.
 *
 * The model is piecewise BY CONSTRUCTION: the conditions name the interesting
 * x-values, and the canvas is cut into branches between them. That makes the
 * check exact rather than sampled — a branch's endpoint *is* the one-sided
 * limit there, and whether it is filled *is* whether f is defined there. No
 * probing, and the feedback can name the exact thing that is wrong.
 *
 * Node positions snap to a grid, so "close enough" never enters into it. A
 * student who drags to 3 has drawn 3, not 2.97, and the tolerance below is only
 * there to forgive the half-step.
 */

/** Positions snap here, so a dragged height is an exact answer. */
export const GRID = 0.5;
const TOL = GRID / 2;

const near = (/** @type {number} */ a, /** @type {number} */ b) => Math.abs(a - b) <= TOL;

/* ──────────────────────────── the conditions ───────────────────────────── */

/**
 * @typedef {{kind:'value', a:number, y:number}
 *   | {kind:'undefined', a:number}
 *   | {kind:'limit', a:number, side:'both'|'left'|'right', y:number}
 *   | {kind:'infinite', a:number, side:'both'|'left'|'right', dir:1|-1}
 *   | {kind:'end', at:1|-1, y:number}} Cond
 */

const num = (/** @type {string} */ s) => {
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
};

/** `2`, `-1.5`, `inf`, `-inf` — the things that can sit on either side of `=`. */
function target(/** @type {string} */ raw) {
  const t = raw.trim().toLowerCase().replace(/\s+/g, '');
  if (/^\+?inf(inity)?$/.test(t)) return { inf: 1 };
  if (/^-inf(inity)?$/.test(t)) return { inf: -1 };
  const v = num(t);
  return v === null ? null : { v };
}

/**
 * Read a problem's conditions.
 *
 * The spelling is the one a person types into a URL, and deliberately close to
 * what the textbook prints: `lim(x->2-)=3; f(2)=1; lim(x->inf)=0`. Anything
 * unreadable is reported rather than dropped — a condition silently ignored is
 * a problem the student cannot solve and cannot see why.
 *
 * @param {string} src
 * @returns {{conds:Cond[], errors:string[]}}
 */
export function parseConditions(src) {
  /** @type {Cond[]} */ const conds = [];
  /** @type {string[]} */ const errors = [];

  for (const piece of String(src || '').split(/[;\n]+/)) {
    const raw = piece.trim();
    if (!raw) continue;
    const s = raw.replace(/→/g, '->').replace(/\s+/g, '');

    // f(a) = c   |   f(a) = undefined
    let m = /^([a-z])\((-?[\d.]+)\)=(.+)$/i.exec(s);
    if (m) {
      const a = num(m[2]);
      if (a === null) { errors.push(`I could not read the point in "${raw}".`); continue; }
      if (/^(undefined|undef|dne|none)$/i.test(m[3])) { conds.push({ kind: 'undefined', a }); continue; }
      const t = target(m[3]);
      if (!t || t.inf) { errors.push(`"${raw}" — a function value has to be a number.`); continue; }
      conds.push({ kind: 'value', a, y: t.v });
      continue;
    }

    // lim(x->a)=L, lim(x->a-)=L, lim(x->inf)=L
    m = /^lim\(?[a-z]->(.+?)\)?=(.+)$/i.exec(s);
    if (m) {
      const rhs = target(m[2]);
      if (!rhs) { errors.push(`I could not read the limit in "${raw}".`); continue; }
      const to = m[1];
      if (/^[-+]?inf(inity)?$/.test(to)) {
        if (rhs.inf) { errors.push(`"${raw}" — this page cannot check an infinite limit at infinity.`); continue; }
        conds.push({ kind: 'end', at: to.startsWith('-') ? -1 : 1, y: rhs.v });
        continue;
      }
      const sm = /^(-?[\d.]+)([-+])?$/.exec(to);
      const a = sm && num(sm[1]);
      if (a === null || a === undefined) { errors.push(`I could not read the point in "${raw}".`); continue; }
      const side = sm[2] === '-' ? 'left' : sm[2] === '+' ? 'right' : 'both';
      conds.push(rhs.inf
        ? { kind: 'infinite', a, side, dir: /** @type {1|-1} */ (rhs.inf) }
        : { kind: 'limit', a, side, y: rhs.v });
      continue;
    }

    errors.push(`I could not read "${raw}".`);
  }
  return { conds, errors };
}

/** Every x the conditions single out, in order. */
export function sitesOf(/** @type {Cond[]} */ conds) {
  const xs = conds.filter(c => 'a' in c).map(c => /** @type {any} */ (c).a);
  return [...new Set(xs)].sort((p, q) => p - q);
}

/* ───────────────────────────── the drawing ─────────────────────────────── */

/**
 * @typedef {{x0:number, x1:number, pts:{x:number,y:number}[], drawn:boolean,
 *   left:'open'|'closed'|'up'|'down', right:'open'|'closed'|'up'|'down'}} Branch
 * @typedef {{branches:Branch[], sites:number[], dots:Record<string, number>,
 *   hlines:number[], window:[number,number]}} Sketch
 */

/**
 * The blank canvas for a problem: cut at every site the conditions mention.
 *
 * Every branch starts UNDRAWN. Laying them along y = 0 instead would quietly
 * satisfy any condition whose answer happens to be 0 — a student opening a
 * problem with `lim(x→∞) f = 0` in it would find that one already ticked
 * without having drawn anything. A piece counts only once it has been touched.
 */
export function blankSketch(/** @type {Cond[]} */ conds, /** @type {[number,number]} */ win) {
  const sites = sitesOf(conds).filter(a => a > win[0] && a < win[1]);
  const cuts = [win[0], ...sites, win[1]];
  /** @type {Branch[]} */ const branches = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const x0 = cuts[i], x1 = cuts[i + 1];
    branches.push({
      x0, x1, left: 'open', right: 'open', drawn: false,
      pts: [{ x: x0, y: 0 }, { x: (x0 + x1) / 2, y: 0 }, { x: x1, y: 0 }],
    });
  }
  return { branches, sites, dots: {}, hlines: [], window: win };
}

/** Which branch owns this x? */
const branchAt = (/** @type {Sketch} */ sk, /** @type {number} */ x) =>
  sk.branches.find(b => x > b.x0 && x < b.x1) || null;

/**
 * The one-sided limit the sketch shows at `a`.
 * @returns {{y:number}|{inf:1|-1}|null}
 */
export function limitAt(sk, a, side) {
  if (side === 'both') {
    const l = limitAt(sk, a, 'left'), r = limitAt(sk, a, 'right');
    if (!l || !r) return null;
    if ('inf' in l && 'inf' in r) return l.inf === r.inf ? l : null;
    if ('y' in l && 'y' in r) return near(l.y, r.y) ? l : null;
    return null;
  }
  // The branch ENDING at a from the left; the branch STARTING at a on the right.
  const b = sk.branches.find(br => (side === 'left' ? br.x1 === a : br.x0 === a));
  if (!b || !b.drawn) return null;
  const end = side === 'left' ? b.right : b.left;
  if (end === 'up') return { inf: 1 };
  if (end === 'down') return { inf: -1 };
  const pt = side === 'left' ? b.pts[b.pts.length - 1] : b.pts[0];
  return { y: pt.y };
}

/**
 * The value the sketch shows at `a` — or a conflict.
 *
 * Two filled endpoints at different heights is the interesting mistake here: a
 * function cannot have two values at one x. It is reported rather than silently
 * resolved, because noticing it is the point.
 *
 * @returns {{y:number}|{conflict:number[]}|null}
 */
export function valueAt(sk, a) {
  const found = [];
  const left = sk.branches.find(b => b.x1 === a);
  const right = sk.branches.find(b => b.x0 === a);
  if (left?.drawn && left.right === 'closed') found.push(left.pts[left.pts.length - 1].y);
  if (right?.drawn && right.left === 'closed') found.push(right.pts[0].y);
  const dot = sk.dots[String(a)];
  if (typeof dot === 'number') found.push(dot);
  const distinct = found.filter((y, i) => found.findIndex(z => near(z, y)) === i);
  if (distinct.length > 1) return { conflict: distinct };
  return distinct.length ? { y: distinct[0] } : null;
}

/** The height the sketch runs out at, on the far left or far right. */
function endValue(sk, at) {
  const b = at === 1 ? sk.branches[sk.branches.length - 1] : sk.branches[0];
  if (!b || !b.drawn) return null;
  const end = at === 1 ? b.right : b.left;
  if (end === 'up' || end === 'down') return null;
  const pt = at === 1 ? b.pts[b.pts.length - 1] : b.pts[0];
  return pt.y;
}

/* ────────────────────────────── the check ──────────────────────────────── */

const show = (/** @type {number} */ y) => (Number.isInteger(y) ? String(y) : String(y));
const sideWord = { both: '', left: ' from the left', right: ' from the right' };

/**
 * Score every condition against the sketch.
 *
 * Each result carries a REASON, not a verdict: "your graph approaches 2 there,
 * not 3" is something a student can act on, and "✗" is not.
 *
 * @param {Sketch} sk @param {Cond[]} conds
 * @returns {{cond:Cond, ok:boolean, why:string}[]}
 */
export function checkConditions(sk, conds) {
  return conds.map(cond => {
    const r = checkOne(sk, cond);
    return { cond, ok: r.ok, why: r.why };
  });
}

function checkOne(sk, cond) {
  const ok = { ok: true, why: '' };
  switch (cond.kind) {
    case 'value': {
      const v = valueAt(sk, cond.a);
      if (v && 'conflict' in v) {
        return { ok: false, why: `Your graph has two filled points at x = ${cond.a}, `
          + `at ${v.conflict.map(show).join(' and ')}. A function has only one value there.` };
      }
      if (!v) return { ok: false, why: `Your graph has no filled point at x = ${cond.a}, so f(${cond.a}) is undefined there.` };
      return near(v.y, cond.y) ? ok
        : { ok: false, why: `Your filled point at x = ${cond.a} is at ${show(v.y)}, not ${show(cond.y)}.` };
    }
    case 'undefined': {
      const v = valueAt(sk, cond.a);
      if (!v) return ok;
      if ('conflict' in v) return { ok: false, why: `Your graph has filled points at x = ${cond.a}. f should have no value there.` };
      return { ok: false, why: `Your graph has a filled point at (${cond.a}, ${show(v.y)}). f should have no value there.` };
    }
    case 'limit': {
      const l = limitAt(sk, cond.a, cond.side);
      if (!l) {
        const drawn = sk.branches.some(b => b.drawn && (b.x0 === cond.a || b.x1 === cond.a));
        return { ok: false, why: cond.side === 'both' && drawn
          ? `The two sides of x = ${cond.a} do not meet, so there is no limit there.`
          : `Nothing is drawn at x = ${cond.a}${sideWord[cond.side]} yet.` };
      }
      if ('inf' in l) {
        return { ok: false, why: `Your graph runs off to ${l.inf > 0 ? '∞' : '−∞'} at `
          + `x = ${cond.a}${sideWord[cond.side]}, so the limit is not ${show(cond.y)}.` };
      }
      return near(l.y, cond.y) ? ok
        : { ok: false, why: `Your graph approaches ${show(l.y)} at x = ${cond.a}${sideWord[cond.side]}, not ${show(cond.y)}.` };
    }
    case 'infinite': {
      const l = limitAt(sk, cond.a, cond.side);
      const want = cond.dir > 0 ? '∞' : '−∞';
      if (!l) return { ok: false, why: `Nothing is drawn at x = ${cond.a}${sideWord[cond.side]} yet.` };
      if (!('inf' in l)) {
        return { ok: false, why: `Your graph approaches ${show(l.y)} at x = ${cond.a}${sideWord[cond.side]}. `
          + `For a limit of ${want} it has to run off the top or bottom — use the arrow control on that end.` };
      }
      return l.inf === cond.dir ? ok
        : { ok: false, why: `Your graph runs off to ${l.inf > 0 ? '∞' : '−∞'} there, not ${want}.` };
    }
    case 'end': {
      const y = endValue(sk, cond.at);
      const where = cond.at > 0 ? '∞' : '−∞';
      const b = cond.at === 1 ? sk.branches[sk.branches.length - 1] : sk.branches[0];
      if (!b?.drawn) return { ok: false, why: `Nothing is drawn out towards ${where} yet.` };
      if (y === null) return { ok: false, why: `Your graph runs off the top or bottom as x → ${where}, so it has no limit there.` };
      return near(y, cond.y) ? ok
        : { ok: false, why: `Your graph levels off at ${show(y)} as x → ${where}, not ${show(cond.y)}.` };
    }
    default: return ok;
  }
}

/* ───────────────────────────── for the screen ──────────────────────────── */

/** A condition as the textbook would print it. */
export function conditionTex(cond, v = 'x') {
  const n = (/** @type {number} */ y) => String(y);
  switch (cond.kind) {
    case 'value': return `f(${cond.a}) = ${n(cond.y)}`;
    case 'undefined': return `f(${cond.a}) \\text{ is undefined}`;
    case 'limit': case 'infinite': {
      const arrow = `${v} \\to ${cond.a}${cond.side === 'left' ? '^-' : cond.side === 'right' ? '^+' : ''}`;
      const rhs = cond.kind === 'infinite' ? (cond.dir > 0 ? '\\infty' : '-\\infty') : n(cond.y);
      return `\\lim_{${arrow}} f(${v}) = ${rhs}`;
    }
    case 'end':
      return `\\lim_{${v} \\to ${cond.at > 0 ? '\\infty' : '-\\infty'}} f(${v}) = ${n(cond.y)}`;
    default: return '';
  }
}
