// @ts-check
/**
 * Why t* and not 1.96 — what plugging s in for σ costs, measured in true SEs.
 *
 * Todd Will's Mathematica demo, asked for here via Jeff (2026-10-09), is the
 * seed: a sampling distribution with the axis marked μ−3SE … μ+3SE, a draggable
 * x̄, and a SetterBar switching the margin of error between z*σ/√n, z*s/√n and
 * t*s/√n. His version fixes s = 0.9σ and defines t* = z* ÷ 0.9, so the third
 * recipe lands exactly on the first and the picture says "t* compensates".
 *
 * That picture is kept — ?n=13&s=0.9 reproduces it almost exactly, because
 * t*(12 df) is 1.112 z* ≈ 1/0.9 — but two things are made honest, because as
 * written the demo can teach the wrong mechanism.
 *
 *  1. **s is a slider, not a constant.** t* does not repair the s you happen to
 *     have. In a sample where s came in low the t interval is still too short;
 *     where s came in high it is longer than it needed to be. Fixing s at 0.9σ
 *     hides that, and a student who takes "t* compensates for s" literally has
 *     learnt something false. Drag it and both directions are one gesture away.
 *
 *  2. **The claim is settled by a tally, not by one sample.** What t* fixes is
 *     the RATE. So all three recipes are scored against the same draws, and the
 *     coverage table is where z*s/√n is convicted: at n = 13 and 95% it runs
 *     about 92.6%, not 95%.
 *
 * The "s is biased low" story is also not the mechanism, and the page avoids
 * it. At n = 13, E[s]/σ ≈ 0.980 — 2% low — while t* ÷ z* = 1.112, eleven per
 * cent bigger. Five times the correction the bias could explain. What t* is
 * paying for is the VARIABILITY of s: a random denominator gives (x̄−μ)/(s/√n)
 * heavier tails than a normal, and heavier tails need a wider multiplier.
 *
 * Sibling of `conceptual/two-se/`, also Todd's, and the same idiom: a symbolic
 * axis in SE units, one draggable statistic, no numbers that are not the point.
 */

import { createRng, randNormal } from '../../js/prng.js';
import { mean, sd } from '../../js/stats.js';
import { setJStat, tInv, normalInv, tCDF } from '../../js/distributions.js';
import { announce, initHelp, initSettings } from '../../js/page-utils.js';
import { prefersReducedMotion } from '../../js/settings.js';

// ─── Look ───

const CAPTURE = '#0072B2';    // Okabe–Ito blue — the interval reaches μ
const MISS = '#D55E00';       // Okabe–Ito vermillion — it does not
/**
 * The same verdict, for TEXT.
 *
 * #D55E00 is 3.86:1 on white: over the 3:1 a bar or a line needs, under the
 * 4.5:1 text needs. axe does not inspect SVG text, so this would have shipped
 * unflagged — but the figure's labels are the sentence a reader actually reads.
 */
const MISS_TEXT = '#B34D00';
const BAND = '#569BBD';
const STAT_COLOR = '#7B2D8E'; // x̄ and s: the two things this sample gave you
const AXIS = '#444';

const X_MIN = -3.7, X_MAX = 3.7;

/** @type {Record<string, number>} */
const LEVELS = { 90: 0.90, 95: 0.95, 99: 0.99 };

// ─── State ───

const params = new URLSearchParams(location.search);

/**
 * Which parameter the page is about.
 *
 * Todd Will sent a second Mathematica demo (via Jeff, 2026-10-12) for
 * "showing the effect of replacing p with p̂, a parallel to showing the effect
 * of replacing σ with s". It is the same picture with one substitution changed,
 * so it is the same page with a toggle rather than a second page — exactly the
 * shape `conceptual/two-se/` already uses, and it makes his parallel structural
 * instead of asserted.
 *
 * The difference the toggle exposes is the content: for a mean, x̄ and s are two
 * separate numbers, so the page needs two knobs. For a proportion there is only
 * p̂, and it has to be both the estimate AND the thing inside the standard
 * error — which is why that mode has one knob where this one has two.
 */
let family = /** @type {'mean'|'prop'} */ ('mean');
/** The true proportion, in proportion mode. Only ever used there. */
let pTrue = 0.2;
let level = /** @type {'90'|'95'|'99'} */ ('95');
/** Which margin-of-error recipe is drawn: 1 = z*σ, 2 = z*s, 3 = t*s. */
let recipe = 1;
/** Sample size. 13 is Todd's board: t*(12 df) is 1.112 z*, almost 1 ÷ 0.9. */
let n = 13;
/** Defaults per family. 50 with p = 0.2 puts np at exactly 10 — the course's
 *  success-failure boundary, where the condition is MET and the interval still
 *  runs at 0.9375. */
const N_DEFAULT = { mean: 13, prop: 50 };
/** This sample's s, as a fraction of σ. 0.9 is Todd's. */
let sRatio = 0.9;
/** Where x̄ landed, in TRUE standard errors from μ. */
let zStat = 1.9;

let rng = createRng(params.get('seed') || 'why-t-star');
let drawn = 0;
const captured = [0, 0, 0];
/** jStat, kept for the binomial pmf the exact proportion coverage needs. */
let jstatLib = /** @type {any} */ (null);

// ─── DOM ───

const el = (/** @type {string} */ id) => document.getElementById(id);
const figure = /** @type {HTMLElement} */ (el('wts-figure'));
const recipesEl = /** @type {HTMLElement} */ (el('recipes'));
const recipeNote = /** @type {HTMLElement} */ (el('recipe-note'));
const slider = /** @type {HTMLInputElement} */ (el('stat-pos'));
const readout = /** @type {HTMLElement} */ (el('stat-readout'));
const verdictEl = /** @type {HTMLElement} */ (el('verdict'));
const coverageWrap = /** @type {HTMLElement} */ (el('coverage-wrap'));
const nInput = /** @type {HTMLInputElement} */ (el('n-input'));
const nReadout = /** @type {HTMLElement} */ (el('n-readout'));
const sInput = /** @type {HTMLInputElement} */ (el('s-input'));
const sReadout = /** @type {HTMLElement} */ (el('s-readout'));
const pInput = /** @type {HTMLInputElement} */ (el('p-input'));
const pReadout = /** @type {HTMLElement} */ (el('p-readout'));

// ─── The numbers ───

const conf = () => LEVELS[level];
const zStar = () => normalInv((1 + conf()) / 2);
const tStar = () => tInv((1 + conf()) / 2, n - 1);

/**
 * The three margins of error, in TRUE standard errors.
 *
 * Everything on this page is measured in σ/√n, which is why the comparison
 * works: `sRatio` is s/σ, so z*·s/√n is z*·sRatio of them. One ruler, three
 * recipes laid against it.
 */
/** The true standard error of p̂, in proportion mode. */
const seTrue = () => Math.sqrt(pTrue * (1 - pTrue) / n);

/**
 * Where p̂ sits, as a proportion rather than as a distance.
 *
 * Clamped to [0, 1] because the axis runs to ±3.5 true SE and a small n can put
 * that past the end of the scale. A clamped p̂ of exactly 0 or 1 is not a glitch
 * — it is the sample with no successes, whose Wald interval has zero width, and
 * that is worth meeting.
 */
const pHat = () => Math.max(0, Math.min(1, pTrue + zStat * seTrue()));

/**
 * The margins of error, in TRUE standard errors.
 *
 * One ruler, every recipe laid against it. For the mean that is σ/√n and
 * `sRatio` is s/σ; for the proportion it is √(p(1−p)/n), and the estimated
 * standard error is bigger or smaller than it according to whether p̂ landed
 * nearer 0.5 than p did — which is the asymmetry the whole mode is about.
 */
function margins() {
  if (family === 'prop') {
    const ph = pHat();
    return [zStar(), zStar() * Math.sqrt(ph * (1 - ph)) / Math.sqrt(pTrue * (1 - pTrue))];
  }
  return [zStar(), zStar() * sRatio, tStar() * sRatio];
}
const margin = () => margins()[recipe - 1];
const captures = (/** @type {number} */ m) => Math.abs(zStat) <= m;
/** How many recipes this family offers. */
const recipeCount = () => (family === 'prop' ? 2 : 3);

/** Binomial pmf, for the exact coverage sums. */
function binomPmf(/** @type {number} */ k, /** @type {number} */ nn, /** @type {number} */ pp) {
  return jstatLib ? jstatLib.binomial.pdf(k, nn, pp) : 0;
}

/**
 * The true long-run coverage of each recipe.
 *
 * For the mean these are closed forms. For the proportion they are **exact
 * binomial sums over the n+1 attainable values of p̂**, not the normal
 * approximation — p̂ is k/n and nothing else, and the discreteness is part of
 * why the interval misbehaves. Todd's notebook integrates a normal here and
 * says "approximate"; the two disagree by two or three points, in both
 * directions, so the honest number is cheap enough to just compute.
 */
function trueCoverage() {
  if (family === 'prop') {
    const z = zStar();
    let ideal = 0, wald = 0;
    for (let k = 0; k <= n; k++) {
      const ph = k / n;
      const mass = binomPmf(k, n, pTrue);
      if (Math.abs(ph - pTrue) <= z * seTrue()) ideal += mass;
      if (Math.abs(ph - pTrue) <= z * Math.sqrt(ph * (1 - ph) / n)) wald += mass;
    }
    return [ideal, wald];
  }
  return [conf(), 2 * tCDF(zStar(), n - 1) - 1, conf()];
}

/**
 * The p̂ values whose Wald interval actually reaches p, in true SE units.
 *
 * Solving |p̂ − p| ≤ z√(p̂(1−p̂)/n) for p̂ gives a quadratic,
 * (n + z²)p̂² − (2np + z²)p̂ + np² ≤ 0, whose roots are these. Everything
 * between them captures p; everything outside misses. Expert mode shades the
 * difference between this and the central band, which is where the missing
 * coverage went.
 */
function captureWindow() {
  const z = zStar();
  const disc = Math.sqrt(z ** 4 + 4 * n * z * z * pTrue * (1 - pTrue));
  const lo = (2 * n * pTrue + z * z - disc) / (2 * (n + z * z));
  const hi = (2 * n * pTrue + z * z + disc) / (2 * (n + z * z));
  const se = seTrue();
  return { lo: (lo - pTrue) / se, hi: (hi - pTrue) / se };
}

// ─── The three recipes, as markup ───

const FRAC = (/** @type {string} */ num) =>
  `<span class="frac"><span class="num">${num}</span><span class="den">&radic;<span style="text-decoration:overline">n</span></span></span>`;
/**
 * √( num / n ) — the proportion's standard error.
 *
 * Its own fraction, with **n** underneath rather than √n: the radical already
 * covers the whole quotient, so reusing FRAC here would have printed
 * √(p(1−p)/√n), which is a different and wrong quantity.
 */
const ROOT_FRAC = (/** @type {string} */ num) =>
  `<span class="rootfrac">&radic;<span class="under">`
  + `<span class="frac"><span class="num">${num}</span><span class="den">n</span></span>`
  + `</span></span>`;

/** [multiplier label, numerator, what it needs that you may not have]. */
function recipeParts() {
  const z = zStar().toFixed(3);
  if (family === 'prop') {
    // The numerator is the whole story: the right one needs p, which is the
    // thing you are trying to estimate; the usable one puts p̂ in its place.
    return [
      { mult: `<em>z*</em>&nbsp;=&nbsp;${z}`, num: 'p(1&minus;p)', root: true },
      { mult: `<em>z*</em>&nbsp;=&nbsp;${z}`, num: '<span class="s-hat">p&#770;</span>(1&minus;<span class="s-hat">p&#770;</span>)', root: true },
    ];
  }
  const t = tStar().toFixed(3);
  // Every row names its multiplier as well as showing it: which number t* is,
  // and how far it sits above z*, is the question the page exists to answer.
  return [
    { mult: `<em>z*</em>&nbsp;=&nbsp;${z}`, num: '&sigma;' },
    { mult: `<em>z*</em>&nbsp;=&nbsp;${z}`, num: '<span class="s-hat">s</span>' },
    { mult: `<em>t*</em>&nbsp;=&nbsp;${t}`, num: '<span class="s-hat">s</span>' },
  ];
}

function renderRecipes() {
  const ms = margins();
  const parts = recipeParts();
  recipesEl.innerHTML = parts.map((pt, i) => {
    const on = recipe === i + 1;
    const hit = captures(ms[i]);
    const body = pt.root ? ROOT_FRAC(pt.num) : FRAC(pt.num);
    return `<label class="wts-recipe${on ? ' is-on' : ''}">`
      + `<input type="radio" name="recipe" value="${i + 1}"${on ? ' checked' : ''}>`
      + `<span class="wts-formula">${pt.mult}&nbsp;${body}</span>`
      + `<span class="wts-len">${ms[i].toFixed(3)}&nbsp;SE <em>&mdash; ${hit ? 'reaches' : 'misses'} ${symbols().param}</em></span>`
      + `</label>`;
  }).join('');
  recipeNote.innerHTML = noteFor(recipe);
}

/** The sentence under the selected recipe. */
function noteFor(/** @type {number} */ r) {
  if (family === 'prop') {
    const ph = pHat();
    const wider = ph * (1 - ph) > pTrue * (1 - pTrue);
    return [
      `The right length &mdash; and you cannot compute it, because it needs <em>p</em>, `
        + `which is the very thing you are estimating.`,
      `The same multiplier with <span class="s-hat">p&#770;</span> in <em>p</em>&rsquo;s place. Usable, and `
        + `<strong>${Math.abs(ph - pTrue) < 1e-9 ? 'exactly right &mdash; this time' : wider ? 'too long' : 'too short'}</strong>`
        + `${Math.abs(ph - pTrue) < 1e-9 ? ', because this sample&rsquo;s p&#770; happened to equal p.'
            : `, because p&#770; = ${ph.toFixed(3)} sits ${wider ? 'nearer' : 'further from'} 0.5 than `
              + `p = ${pTrue.toFixed(2)} does, so p&#770;(1&minus;p&#770;) is ${wider ? 'bigger' : 'smaller'} than p(1&minus;p).`}`,
    ][r - 1];
  }
  return [
    `The right length &mdash; and you cannot compute it, because &sigma; is a fact about the population.`,
    `The same multiplier with <span class="s-hat">s</span> in &sigma;&rsquo;s place. Usable. `
      + `<strong>${sRatio < 1 ? 'Short' : sRatio > 1 ? 'Long' : 'Exactly right &mdash; this time'}</strong>`
      + `${sRatio === 1 ? ', because this sample&rsquo;s s happened to equal \u03C3.' : ' by the same factor this sample&rsquo;s s is off by.'}`,
    `A bigger multiplier, chosen so that <em>over all samples</em> exactly ${level}% capture &mu;. `
      + `It does not fix <em>this</em> interval &mdash; it fixes the rate.`,
  ][r - 1];
}

/** Parameter and statistic symbols for the current family. */
function symbols() {
  return family === 'prop'
    ? { param: 'p', stat: 'p\u0302', statPlain: 'p-hat', se: '\u221a(p(1\u2212p)/n)' }
    : { param: '\u03BC', stat: 'x\u0304', statPlain: 'x-bar', se: '\u03C3/\u221an' };
}

// ─── Figure ───

/**
 * Narrower viewBox on a phone, so the labels render near 1:1 instead of being
 * shrunk to illegibility along with the picture. (Same reasoning as two-se.)
 */
function geom(/** @type {boolean} */ compact) {
  const W = compact ? 400 : 780;
  // The bottom margin has to clear the interval bar AND the fraction under it,
  // whose denominator sits 49 units below the bar. At 92 the √n was sheared off
  // the bottom of the phone viewBox.
  const H = compact ? 322 : 330;
  const M = compact
    ? { top: 46, right: 12, bottom: 106, left: 12 }
    : { top: 54, right: 20, bottom: 108, left: 20 };
  return { W, H, M, PLOT_W: W - M.left - M.right, PLOT_H: H - M.top - M.bottom };
}
let g = geom(false);

const pdf = (/** @type {number} */ x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
const PEAK = pdf(0);
const px = (/** @type {number} */ x) => g.M.left + ((x - X_MIN) / (X_MAX - X_MIN)) * g.PLOT_W;
const py = (/** @type {number} */ d) => g.M.top + g.PLOT_H - (d / PEAK) * g.PLOT_H;
const bottomOf = () => g.M.top + g.PLOT_H;

/** A tick in SE units, written the way it goes on a board: `μ−2SE`, never `−2`. */
function tickLabel(/** @type {number} */ k) {
  const par = symbols().param;
  if (k === 0) return par;
  const mag = Math.abs(k) === 1 ? 'SE' : `${Math.abs(k)}SE`;
  return `${par}${k < 0 ? '−' : '+'}${mag}`;
}

/**
 * The statistic's symbol with its decoration drawn rather than typed.
 *
 * `x̄` is a letter plus a combining macron and `p̂` a letter plus a combining
 * circumflex; in SVG both drift off the glyph depending on which font actually
 * loaded. Drawing the bar and the hat as geometry puts them where they belong
 * at any size. (Same reason `conceptual/two-se/` does it this way.)
 */
function statSymbolSvg(cx, cy, color) {
  if (family === 'prop') {
    return `<text x="${cx}" y="${cy}" text-anchor="middle" font-size="19" font-weight="700" fill="${color}">p</text>`
      + `<path d="M ${cx - 5.5} ${cy - 14} L ${cx} ${cy - 19.5} L ${cx + 5.5} ${cy - 14}" fill="none"`
      + ` stroke="${color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  return `<text x="${cx}" y="${cy}" text-anchor="middle" font-size="19" font-weight="700" fill="${color}">x</text>`
    + `<line x1="${cx - 6.5}" y1="${cy - 15.5}" x2="${cx + 6.5}" y2="${cy - 15.5}"`
    + ` stroke="${color}" stroke-width="1.8" stroke-linecap="round"/>`;
}

/**
 * The margin-of-error formula, drawn as SVG geometry.
 *
 * A fraction in SVG has to be built from two texts and a rule — there is no
 * markup for it — and `s` is drawn in the statistic's purple wherever it
 * appears, which is Todd's colour code: purple means "this came out of your
 * sample, and would have been a different number from a different sample".
 */
function formulaSvg(cx, cy, color, useSigma, multLabel) {
  const numColor = useSigma ? color : STAT_COLOR;
  color = color === MISS ? MISS_TEXT : color;
  if (family === 'prop') {
    // A root over a fraction is three stacked pieces in SVG and reads worse
    // small than it does set inline, so this one is written on a single line.
    const inner = useSigma ? 'p(1\u2212p)' : 'p\u0302(1\u2212p\u0302)';
    return `<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="13.5" font-weight="700" fill="${color}">`
      + `ME = ${multLabel} \u221a(<tspan fill="${numColor}">${inner}</tspan>/n)</text>`;
  }
  const num = useSigma ? 'σ' : 's';
  const half = 13;
  return `<text x="${cx - 30}" y="${cy + 5}" text-anchor="end" font-size="13.5" font-weight="700" fill="${color}">ME = ${multLabel}</text>`
    + `<text x="${cx - 14}" y="${cy - 3}" text-anchor="middle" font-size="14" font-weight="700" fill="${numColor}">${num}</text>`
    + `<line x1="${cx - 14 - half}" y1="${cy}" x2="${cx - 14 + half}" y2="${cy}" stroke="${color}" stroke-width="1.4"/>`
    + `<text x="${cx - 14}" y="${cy + 15}" text-anchor="middle" font-size="13" fill="${color}">√n</text>`;
}

/**
 * Expert mode: the two strips that make up the coverage shortfall.
 *
 * Between ±z* lie the p̂ a student would call typical. Between the roots of
 * |p̂ − p| ≤ z√(p̂(1−p̂)/n) lie the p̂ whose interval actually reaches p. They
 * are not the same interval, and the gap in each direction is what the
 * advertised coverage loses and wins back:
 *
 *   coverage = (1 − α) − (band outside the window) + (window outside the band)
 *
 * Off by default. The words "acceptance region" never appear — the shading is
 * labelled by what it means for a sample, which is as far into this as an intro
 * course should go. Jeff, 2026-10-13: put it behind expert mode.
 */
function coverageShading(baseline) {
  if (family !== 'prop') return '';
  const z = zStar();
  const { lo, hi } = captureWindow();
  if (!isFinite(lo) || !isFinite(hi)) return '';
  /** @param {number} a @param {number} b */
  const strip = (a, b, fill) => {
    if (!(b > a)) return '';
    const pts = [];
    for (let i = 0; i <= 60; i++) {
      const x = a + (i / 60) * (b - a);
      pts.push(`${px(x).toFixed(2)},${py(pdf(x)).toFixed(2)}`);
    }
    return `<polygon points="${px(a).toFixed(2)},${baseline} ${pts.join(' ')} ${px(b).toFixed(2)},${baseline}"`
      + ` fill="${fill}" opacity="0.5"/>`;
  };
  // Typical samples whose interval misses anyway, and unusual ones that reach
  // p regardless because their estimated SE came out large.
  return `<g class="expert-only">`
    + strip(-z, Math.min(lo, z), MISS)
    + strip(Math.max(hi, -z), z, MISS)
    + strip(lo, Math.min(-z, hi), CAPTURE)
    + strip(Math.max(z, lo), hi, CAPTURE)
    + `</g>`;
}

function describe() {
  const m = margin();
  const d = Math.abs(zStat).toFixed(2);
  const names = family === 'prop'
    ? ['z* root p(1-p) over n', 'z* root p-hat(1-p-hat) over n']
    : ['z* sigma over root n', 'z* s over root n', 't* s over root n'];
  const who = family === 'prop' ? "This sample's proportion" : "This sample's mean";
  const par = family === 'prop' ? 'p' : 'mu';
  return `${who} sits ${d} true standard errors ${zStat < 0 ? 'below' : 'above'} ${par}. `
    + `Its margin of error by ${names[recipe - 1]} is ${m.toFixed(3)} true standard errors, `
    + `so the interval ${captures(m) ? 'reaches' : 'misses'} ${par}. `
    + `The shaded band holds the middle ${level} per cent of sample means.`;
}

function rebuild() {
  const compact = (figure.clientWidth || 780) < 560;
  g = geom(compact);
  const { W, H, M } = g;
  const z = zStar();
  const m = margin();
  const hit = captures(m);
  const color = hit ? CAPTURE : MISS;
  const baseline = bottomOf();

  const pts = [];
  for (let i = 0; i <= 240; i++) {
    const x = X_MIN + (i / 240) * (X_MAX - X_MIN);
    pts.push(`${px(x).toFixed(2)},${py(pdf(x)).toFixed(2)}`);
  }
  const band = [];
  for (let i = 0; i <= 160; i++) {
    const x = -z + (i / 160) * (2 * z);
    band.push(`${px(x).toFixed(2)},${py(pdf(x)).toFixed(2)}`);
  }

  const ticks = [-3, -2, -1, 0, 1, 2, 3].map((k) => {
    const x = px(k);
    const show = !compact || Math.abs(k) !== 1;
    return `<line x1="${x}" y1="${baseline}" x2="${x}" y2="${baseline + 6}" stroke="${AXIS}" stroke-width="1.5"/>`
      + (show ? `<text x="${x}" y="${baseline + 22}" text-anchor="middle" font-size="13"`
        + ` fill="${k === 0 ? '#111' : AXIS}" font-weight="${k === 0 ? 700 : 400}">${tickLabel(k)}</text>` : '');
  }).join('');

  const statX = px(zStat);
  const loX = px(zStat - m);
  const hiX = px(zStat + m);
  const barY = baseline + 46;
  const useSigma = recipe === 1;
  const multLabel = recipe === 3 ? `t*` : zStar().toFixed(2);

  // μ's own line, carried down to the interval bar in two pieces so the tick
  // label's row stays clear — a dashed stem running into "μ" reads as a p.
  const dash = (/** @type {number} */ y1, /** @type {number} */ y2) =>
    `<line x1="${px(0)}" y1="${y1}" x2="${px(0)}" y2="${y2}" stroke="#111" stroke-width="1.4"`
    + ` stroke-dasharray="3,3" opacity="0.65"/>`;

  figure.innerHTML = `
<svg viewBox="0 0 ${W} ${H}" role="img" preserveAspectRatio="xMidYMid meet" aria-label="${describe()}">
  <title>Sampling distribution of the sample mean, with one sample's interval drawn under it</title>
  <text x="${W / 2}" y="18" text-anchor="middle" font-size="${compact ? 12 : 14}" fill="#555">
    ${family === 'prop'
      ? (compact ? 'Sampling distribution of the sample proportion'
        : 'Sampling distribution of the sample proportion &#8212; centred at p, one true SE = &#8730;(p(1&#8722;p)/n) wide')
      : (compact ? 'Sampling distribution of the sample mean'
        : 'Sampling distribution of the sample mean &#8212; centred at &#956;, one true SE = &#963;/&#8730;n wide')}
  </text>

  <polygon points="${px(-z).toFixed(2)},${baseline} ${band.join(' ')} ${px(z).toFixed(2)},${baseline}"
           fill="${BAND}" opacity="0.26"/>
  ${coverageShading(baseline)}
  <polyline points="${pts.join(' ')}" fill="none" stroke="#2b6b8a" stroke-width="2.2"/>
  <text x="${px(0)}" y="${py(PEAK * 0.5)}" text-anchor="middle" font-size="17" font-weight="700"
        fill="#1b5e7e">${level}%</text>

  <line x1="${M.left}" y1="${baseline}" x2="${W - M.right}" y2="${baseline}" stroke="${AXIS}" stroke-width="1.5"/>
  ${ticks}
  ${dash(M.top + 4, baseline)}
  ${dash(baseline + 30, barY + 12)}

  <line id="wts-stat-line" x1="${statX}" y1="${M.top + 2}" x2="${statX}" y2="${barY}"
        stroke="${STAT_COLOR}" stroke-width="2.4"/>
  <g id="wts-stat-sym">${statSymbolSvg(statX, M.top - 8, STAT_COLOR)}</g>

  <line id="wts-bar" x1="${loX}" y1="${barY}" x2="${hiX}" y2="${barY}" stroke="${color}" stroke-width="3.4"/>
  <line id="wts-bar-lo" x1="${loX}" y1="${barY - 8}" x2="${loX}" y2="${barY + 8}" stroke="${color}" stroke-width="3.4"/>
  <line id="wts-bar-hi" x1="${hiX}" y1="${barY - 8}" x2="${hiX}" y2="${barY + 8}" stroke="${color}" stroke-width="3.4"/>
  <circle id="wts-bar-dot" cx="${statX}" cy="${barY}" r="4.5" fill="${color}"/>
  <g id="wts-formula">${formulaSvg(Math.max(118, Math.min(W - 34, statX)), barY + 34, color, useSigma, multLabel)}</g>
</svg>`;
  builtFor = layoutKey();
  builtStatX = statX;
  attachDrag();
}

/** Only these force a rebuild; dragging x̄ moves a handful of nodes instead. */
const layoutKey = () => `${family}|${level}|${recipe}|${n}|${sRatio}|${pTrue}|${(figure.clientWidth || 780) < 560}`;
let builtFor = '';
let builtStatX = 0;

function reposition() {
  const svgEl = figure.querySelector('svg');
  if (!svgEl) return;
  const m = margin();
  const hit = captures(m);
  const color = hit ? CAPTURE : MISS;
  const statX = px(zStat);
  const set = (/** @type {string} */ id, /** @type {Record<string, string|number>} */ attrs) => {
    const node = svgEl.querySelector('#' + id);
    if (!node) return;
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  };
  set('wts-stat-line', { x1: statX, x2: statX });
  const sym = svgEl.querySelector('#wts-stat-sym');
  if (sym) sym.setAttribute('transform', `translate(${(statX - builtStatX).toFixed(2)},0)`);
  // The interval is drawn at its full length even when an end leaves the frame:
  // clamping it would shorten the interval exactly in the cases worth seeing.
  set('wts-bar', { x1: px(zStat - m), x2: px(zStat + m), stroke: color });
  set('wts-bar-lo', { x1: px(zStat - m), x2: px(zStat - m), stroke: color });
  set('wts-bar-hi', { x1: px(zStat + m), x2: px(zStat + m), stroke: color });
  set('wts-bar-dot', { cx: statX, fill: color });
  const fg = svgEl.querySelector('#wts-formula');
  if (fg) fg.setAttribute('transform', `translate(${(statX - builtStatX).toFixed(2)},0)`);
  svgEl.setAttribute('aria-label', describe());
}

// ─── Dragging ───

function attachDrag() {
  const svgEl = figure.querySelector('svg');
  if (!svgEl) return;
  let dragging = false;
  const toZ = (/** @type {PointerEvent} */ e) => {
    const r = svgEl.getBoundingClientRect();
    const xInView = ((e.clientX - r.left) / r.width) * g.W;
    const frac = (xInView - g.M.left) / g.PLOT_W;
    return Math.max(-3.5, Math.min(3.5, X_MIN + frac * (X_MAX - X_MIN)));
  };
  svgEl.addEventListener('pointerdown', (e) => {
    dragging = true;
    svgEl.setPointerCapture(e.pointerId);
    setStat(toZ(e));
  });
  svgEl.addEventListener('pointermove', (e) => { if (dragging) { e.preventDefault(); setStat(toZ(e)); } });
  svgEl.addEventListener('pointerup', () => { dragging = false; });
  svgEl.addEventListener('pointercancel', () => { dragging = false; });
  svgEl.style.touchAction = 'pan-y';
  svgEl.style.cursor = 'ew-resize';
}

// ─── Readouts ───

let lastHit = /** @type {boolean|null} */ (null);

function setStat(/** @type {number} */ z, { fromSlider = false } = {}) {
  zStat = Math.max(-3.5, Math.min(3.5, z));
  if (!fromSlider) slider.value = String(zStat);
  update();
}

function update({ announceChange = true } = {}) {
  if (layoutKey() !== builtFor) rebuild();
  reposition();
  renderRecipes();

  const m = margin();
  const hit = captures(m);
  readout.textContent = `${Math.abs(zStat).toFixed(2)} SE ${zStat < 0 ? 'below' : 'above'} ${symbols().param}`;
  slider.setAttribute('aria-valuetext', describe());

  renderShadingNote();
  verdictEl.className = `wts-verdict ${hit ? 'is-yes' : 'is-no'}`;
  const par = symbols().param;
  verdictEl.innerHTML = `<span class="wts-glyph" aria-hidden="true">${hit ? '✓' : '✕'}</span>`
    + `This interval <strong>${hit ? 'contains' : 'misses'} ${par}</strong> `
    + `&mdash; its margin reaches ${m.toFixed(3)} SE and ${par} is ${Math.abs(zStat).toFixed(2)} SE away.`;

  if (announceChange && lastHit !== null && lastHit !== hit) {
    announce(hit ? `Now the interval contains ${symbols().param}.` : `Now the interval misses ${symbols().param}.`);
  }
  lastHit = hit;
  renderCoverage();
}

function renderCoverage() {
  const truth = trueCoverage();
  const names = family === 'prop'
    ? [`<em>z*</em>&radic;(p(1&minus;p)/n)`,
       `<em>z*</em>&radic;(<span class="s-hat">p&#770;</span>(1&minus;<span class="s-hat">p&#770;</span>)/n)`]
    : [`<em>z*</em>&sigma;/&radic;n`,
       `<em>z*</em><span class="s-hat">s</span>/&radic;n`,
       `<em>t*</em><span class="s-hat">s</span>/&radic;n`];
  const rows = names.map((nm, i) => {
    const pct = drawn ? (captured[i] / drawn) * 100 : NaN;
    const off = truth[i] < conf() - 0.004;
    return `<tr class="${recipe === i + 1 ? 'is-on' : ''}">`
      + `<td>${nm}</td>`
      + `<td class="num">${drawn ? `${captured[i]}/${drawn}` : '\u2014'}</td>`
      + `<td class="num">${drawn ? `${pct.toFixed(drawn >= 100 ? 1 : 0)}%` : '\u2014'}</td>`
      + `<td class="num ${off ? 'short' : 'ok'}">${(truth[i] * 100).toFixed(1)}%</td>`
      + `</tr>`;
  }).join('');
  coverageWrap.innerHTML = `
    <table class="wts-coverage">
      <caption class="sr-only">Coverage of each margin-of-error recipe</caption>
      <thead><tr><th scope="col">Margin of error</th><th scope="col">Captured ${symbols().param}</th>
        <th scope="col">So far</th><th scope="col">In the long run</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="wts-sub">Advertised: <strong>${level}%</strong>. ${longRunNote(truth)}</p>`;
}

/**
 * The caption for the expert strips.
 *
 * Without it they are two unexplained slivers of colour. The words
 * "acceptance region" stay out of it: what the shading means for a SAMPLE is
 * as far into this as the course should go.
 */
function renderShadingNote() {
  const note = el('shading-note');
  if (!note) return;
  if (family !== 'prop') { note.innerHTML = ''; return; }
  const z = zStar();
  const { lo, hi } = captureWindow();
  const truth = trueCoverage();
  const lost = Math.max(0, conf() - truth[1]);
  note.innerHTML =
    `<strong>The shaded slivers are the whole of the shortfall.</strong> Inside the band are the `
    + `p&#770; you would call typical; between <strong>${lo.toFixed(2)}</strong> and `
    + `<strong>${hi.toFixed(2)}</strong> SE are the p&#770; whose interval actually reaches p. They are `
    + `not the same stretch. <span class="swatch-miss"></span> marks ordinary samples whose interval `
    + `misses anyway; <span class="swatch-hit"></span> marks unusual ones that reach p regardless, `
    + `because their p&#770; landed nearer 0.5 and inflated the estimated SE. The second is smaller `
    + `than the first, and the difference &mdash; about `
    + `<strong>${(lost * 100).toFixed(1)} points</strong> here &mdash; is the coverage you were `
    + `promised and did not get.`;
}

/** What the exact right-hand column is, and what it is telling you. */
function longRunNote(truth) {
  if (family === 'prop') {
    const np = (n * Math.min(pTrue, 1 - pTrue));
    return `The last column is exact: p&#770; can only be k/n, so it is a sum over the `
      + `${n + 1} values it can take, not an approximation. With <em>p</em> = ${pTrue.toFixed(2)} and `
      + `<em>n</em> = ${n}, the usable recipe really captures <strong>${(truth[1] * 100).toFixed(1)}%</strong>, `
      + `not ${level}%. The smaller of <em>np</em> and <em>n</em>(1&minus;<em>p</em>) is `
      + `<strong>${np.toFixed(0)}</strong> &mdash; the course wants it at 10 or more, and even there the `
      + `interval is not quite what it says. <strong>No multiplier fixes this</strong>: how far short it `
      + `falls depends on <em>p</em>, which you do not know. That is why the course simulates.`;
  }
  return `The last column is exact arithmetic, not the tally &mdash; for `
    + `<em>z*</em><span class="s-hat">s</span>/&radic;n it is `
    + `2&#8201;F<sub>t</sub>(${zStar().toFixed(3)},&nbsp;${n - 1}&nbsp;df)&nbsp;&minus;&nbsp;1, and it is `
    + `<strong>${(truth[1] * 100).toFixed(1)}%</strong>, not ${level}%. `
    + `Raise <em>n</em> and watch it climb: <em>t*</em> is ${(tStar() / zStar()).toFixed(3)}&times; <em>z*</em> here, `
    + `and heads for 1.`;
}

// ─── Drawing samples ───

/**
 * One real sample: n draws, then x̄ and s computed from them.
 *
 * σ = 1 and μ = 0, so the true SE is 1/√n and x̄ in SE units is x̄·√n — and
 * s, in units of σ, is just s. Scoring all three recipes on the SAME draw is
 * the point: they differ only in the multiplier and in which spread they use.
 */
function drawOne() {
  if (family === 'prop') {
    // n Bernoulli trials, so p̂ is k/n and nothing else — the discreteness is
    // part of the phenomenon, not noise to be smoothed away.
    let k = 0;
    for (let i = 0; i < n; i++) if (rng() < pTrue) k += 1;
    const ph = k / n;
    const se = seTrue();
    const z = (ph - pTrue) / se;
    const ms = [zStar(), zStar() * Math.sqrt(ph * (1 - ph)) / Math.sqrt(pTrue * (1 - pTrue))];
    drawn += 1;
    for (let i = 0; i < 2; i++) if (Math.abs(z) <= ms[i]) captured[i] += 1;
    return { z, sHat: ph };
  }
  const xs = [];
  for (let i = 0; i < n; i++) xs.push(randNormal(0, 1, rng));
  const z = mean(xs) * Math.sqrt(n);
  const sHat = sd(xs);
  const ms = [zStar(), zStar() * sHat, tStar() * sHat];
  drawn += 1;
  for (let i = 0; i < 3; i++) if (Math.abs(z) <= ms[i]) captured[i] += 1;
  return { z, sHat };
}

function drawSample() {
  const { z, sHat } = drawOne();
  if (family === 'mean') {
    sRatio = Math.round(sHat * 100) / 100;
    sInput.value = String(Math.max(0.3, Math.min(2, sRatio)));
    sReadout.innerHTML = `${sRatio.toFixed(2)}&#8201;&sigma;`;
  }
  setStat(z);
  announce(`Drew ${n} observations. Their mean is ${Math.abs(z).toFixed(2)} SE `
    + `${z < 0 ? 'below' : 'above'} mu and their s is ${sRatio.toFixed(2)} of sigma. `
    + `${captured[recipe - 1]} of ${drawn} intervals have captured mu with this recipe.`);
}

function drawMany(/** @type {number} */ k) {
  let last = { z: zStat, sHat: sRatio };
  for (let i = 0; i < k; i++) last = drawOne();
  if (family === 'mean') {
    sRatio = Math.round(last.sHat * 100) / 100;
    sInput.value = String(Math.max(0.3, Math.min(2, sRatio)));
    sReadout.innerHTML = `${sRatio.toFixed(2)}&#8201;&sigma;`;
  }
  setStat(last.z);
  announce(`Drew ${k} more samples; ${drawn} in all. `
    + names().map((nm, i) => `${nm}: ${((captured[i] / drawn) * 100).toFixed(1)} per cent`).join('. ') + '.');
}

const names = () => ['z star sigma', 'z star s', 't star s'];

function resetTally() {
  drawn = 0;
  captured[0] = captured[1] = captured[2] = 0;
  rng = createRng(params.get('seed') || 'why-t-star');
  renderCoverage();
  announce('Tally reset.');
}

// ─── Wiring ───

el('level-toggle')?.addEventListener('click', (e) => {
  const btn = /** @type {HTMLElement} */ (e.target).closest('button[data-level]');
  if (!btn) return;
  level = /** @type {any} */ (btn.getAttribute('data-level'));
  syncToggles();
  // The tally counts captures at one level; keeping it across a change would
  // make the percentages a blend of two different rules.
  resetTally();
  update({ announceChange: false });
  announce(`${level} per cent. z* is ${zStar().toFixed(3)} and t* is ${tStar().toFixed(3)}.`);
});

el('family-toggle')?.addEventListener('click', (e) => {
  const btn = /** @type {HTMLElement} */ (e.target).closest('button[data-family]');
  if (!btn) return;
  const next = /** @type {'mean'|'prop'} */ (btn.getAttribute('data-family'));
  if (next === family) return;
  family = next;
  // n means something different in each family, and a recipe index can point at
  // a row the other family does not have.
  n = N_DEFAULT[family];
  nInput.value = String(n);
  nReadout.textContent = String(n);
  if (recipe > recipeCount()) recipe = recipeCount();
  syncFamilyUI();
  resetTally();
  update({ announceChange: false });
  announce(family === 'prop'
    ? `Proportion. The standard error is root p times one minus p over n, and p\u0302 has to stand in for p inside it.`
    : `Mean. The standard error is sigma over root n, and s has to stand in for sigma inside it.`);
});

recipesEl.addEventListener('change', (e) => {
  const input = /** @type {HTMLInputElement} */ (e.target);
  if (input?.name !== 'recipe') return;
  recipe = Number(input.value);
  update({ announceChange: false });
  announce(`Margin of error: ${['z star sigma over root n', 'z star s over root n',
    't star s over root n'][recipe - 1]}.`);
});

nInput.addEventListener('input', () => {
  n = Number(nInput.value);
  nReadout.textContent = String(n);
  update({ announceChange: false });
});
nInput.addEventListener('change', () => {
  // t* moved, so the old captures were scored under a different rule.
  resetTally();
  announce(`n = ${n}. t* is ${tStar().toFixed(3)}, which is `
    + `${(tStar() / zStar()).toFixed(3)} times z*.`);
});

pInput?.addEventListener('input', () => {
  pTrue = Number(pInput.value);
  pReadout.textContent = pTrue.toFixed(2);
  update({ announceChange: false });
});
pInput?.addEventListener('change', () => {
  // The whole sampling distribution moved, so the tally was counting a
  // different experiment.
  resetTally();
  announce(`p = ${pTrue.toFixed(2)}. The smaller of np and n(1\u2212p) is `
    + `${(n * Math.min(pTrue, 1 - pTrue)).toFixed(0)}.`);
});

sInput.addEventListener('input', () => {
  sRatio = Number(sInput.value);
  sReadout.innerHTML = `${sRatio.toFixed(2)}&#8201;&sigma;`;
  update({ announceChange: false });
});

slider.addEventListener('input', () => setStat(parseFloat(slider.value), { fromSlider: true }));
el('draw-btn')?.addEventListener('click', drawSample);
el('draw100-btn')?.addEventListener('click', () => drawMany(100));
el('reset-btn')?.addEventListener('click', resetTally);

el('reveal-btn')?.addEventListener('click', () => {
  const answer = /** @type {HTMLElement} */ (el('prompt-answer'));
  const btn = /** @type {HTMLButtonElement} */ (el('reveal-btn'));
  const open = answer.hidden;
  answer.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  btn.textContent = open ? 'Hide the answer' : 'Show the answer';
  if (open) {
    answer.innerHTML = `<p><strong>Less.</strong> Not because <span class="s-hat">s</span> is systematically`
      + ` too small &mdash; it is only a little &mdash; but because it is <em>variable</em>. Samples where`
      + ` <span class="s-hat">s</span> comes in low get a short interval, and a short interval is exactly what`
      + ` you cannot afford; samples where it comes in high get a long one, and a long interval was going to`
      + ` capture &mu; anyway. The losses are not repaid by the gains. At ${level}% with <em>n</em> = ${n}`
      + ` the real rate is <strong>${(trueCoverage()[1] * 100).toFixed(1)}%</strong>. Draw a few hundred and see.</p>`;
  }
});

document.addEventListener('keydown', (e) => {
  if (e.target !== document.body || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'd' || e.key === 'D') { e.preventDefault(); drawSample(); }
  if (e.key === 'r' || e.key === 'R') { e.preventDefault(); resetTally(); }
});

let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    if (layoutKey() !== builtFor) { rebuild(); reposition(); }
  }, prefersReducedMotion() ? 0 : 120);
});

function syncToggles() {
  for (const b of document.querySelectorAll('#level-toggle button')) {
    b.setAttribute('aria-pressed', String(b.getAttribute('data-level') === level));
  }
}

/** Show the controls this family has, and hide the ones it doesn't. */
function syncFamilyUI() {
  document.body.setAttribute('data-family', family);
  for (const b of document.querySelectorAll('#family-toggle button')) {
    b.setAttribute('aria-pressed', String(b.getAttribute('data-family') === family));
  }
  const posLabel = el('stat-pos-label');
  if (posLabel) {
    posLabel.textContent = family === 'prop'
      ? "Where this sample's proportion landed:"
      : "Where this sample's mean landed:";
  }
}

function applyUrlParams() {
  const fam = (params.get('param') || '').toLowerCase();
  if (fam === 'prop' || fam === 'mean') family = /** @type {any} */ (fam);
  n = N_DEFAULT[family];
  if (family === 'prop') { recipe = 1; zStat = -1.9; }
  const pp = parseFloat(params.get('p') || '');
  if (Number.isFinite(pp)) pTrue = Math.max(0.02, Math.min(0.98, pp));
  const lv = params.get('ci') || params.get('level');
  if (lv && Object.prototype.hasOwnProperty.call(LEVELS, lv)) level = /** @type {any} */ (lv);
  const nn = parseInt(params.get('n') || '', 10);
  if (Number.isFinite(nn)) n = Math.max(3, Math.min(60, nn));
  const ss = parseFloat(params.get('s') || '');
  if (Number.isFinite(ss)) sRatio = Math.max(0.3, Math.min(2, ss));
  const xb = parseFloat(params.get('xbar') || params.get('z') || '');
  if (Number.isFinite(xb)) zStat = Math.max(-3.5, Math.min(3.5, xb));
  const me = parseInt(params.get('me') || '', 10);
  if (me >= 1 && me <= recipeCount()) recipe = me;

  nInput.value = String(n);
  nReadout.textContent = String(n);
  sInput.value = String(sRatio);
  sReadout.innerHTML = `${sRatio.toFixed(2)}&#8201;&sigma;`;
  if (pInput) pInput.value = String(pTrue);
  if (pReadout) pReadout.textContent = pTrue.toFixed(2);
  slider.value = String(zStat);
  syncToggles();
  syncFamilyUI();
}

initHelp();
initSettings();

import('jstat').then((jstat) => {
  jstatLib = /** @type {any} */ (jstat).default || jstat;
  setJStat(jstatLib);
  applyUrlParams();
  update({ announceChange: false });
});
