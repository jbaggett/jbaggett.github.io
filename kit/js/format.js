/**
 * Number formatting for on-screen readouts.
 *
 * Small, but exactly the kind of thing each lens would otherwise reinvent
 * slightly differently — and the "-0.00" rule below is one every one of them
 * needs, because students read a leading minus as a real negative value.
 */

/** Round to a "nice" number for axis ticks and readouts. */
export function niceRound(/** @type {number} */ x, /** @type {number} */ sig = 4) {
  if (!Number.isFinite(x)) return x;
  if (x === 0) return 0;
  return Number(x.toPrecision(sig));
}

/**
 * Format a number for on-screen readout: fixed decimals, but never "-0.00",
 * which students read as a real negative value.
 * @param {number} x @param {number} [dp]
 */
export function fmt(x, dp = 3) {
  if (!Number.isFinite(x)) return '—';
  const s = x.toFixed(dp);
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s;
}
