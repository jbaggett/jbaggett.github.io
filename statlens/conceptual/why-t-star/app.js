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

let level = /** @type {'90'|'95'|'99'} */ ('95');
/** Which margin-of-error recipe is drawn: 1 = z*σ, 2 = z*s, 3 = t*s. */
let recipe = 1;
/** Sample size. 13 is Todd's board: t*(12 df) is 1.112 z*, almost 1 ÷ 0.9. */
let n = 13;
/** This sample's s, as a fraction of σ. 0.9 is Todd's. */
let sRatio = 0.9;
/** Where x̄ landed, in TRUE standard errors from μ. */
let zStat = 1.9;

let rng = createRng(params.get('seed') || 'why-t-star');
let drawn = 0;
const captured = [0, 0, 0];

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
const margins = () => [zStar(), zStar() * sRatio, tStar() * sRatio];
const margin = () => margins()[recipe - 1];
const captures = (/** @type {number} */ m) => Math.abs(zStat) <= m;

/**
 * The true long-run coverage of each recipe, as a probability.
 *
 * Recipes 1 and 3 are exactly the advertised level by construction. Recipe 2 is
 * P(|T| ≤ z*) with T ~ t(n−1) — the one number on the page that explains the
 * whole thing, and it is always below the advertised level.
 */
const trueCoverage = () => [conf(), 2 * tCDF(zStar(), n - 1) - 1, conf()];

// ─── The three recipes, as markup ───

const FRAC = (/** @type {string} */ num) =>
  `<span class="frac"><span class="num">${num}</span><span class="den">&radic;<span style="text-decoration:overline">n</span></span></span>`;

/** [multiplier label, numerator, what it needs that you may not have]. */
function recipeParts() {
  const z = zStar().toFixed(3);
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
    return `<label class="wts-recipe${on ? ' is-on' : ''}">`
      + `<input type="radio" name="recipe" value="${i + 1}"${on ? ' checked' : ''}>`
      + `<span class="wts-formula">${pt.mult}&nbsp;${FRAC(pt.num)}</span>`
      + `<span class="wts-len">${ms[i].toFixed(3)}&nbsp;SE <em>&mdash; ${hit ? 'reaches' : 'misses'} μ</em></span>`
      + `</label>`;
  }).join('');
  recipeNote.innerHTML = [
    `The right length &mdash; and you cannot compute it, because &sigma; is a fact about the population.`,
    `The same multiplier with <span class="s-hat">s</span> in &sigma;&rsquo;s place. Usable. `
      + `<strong>${sRatio < 1 ? 'Short' : sRatio > 1 ? 'Long' : 'Exactly right &mdash; this time'}</strong>`
      + `${sRatio === 1 ? ', because this sample&rsquo;s s happened to equal σ.' : ' by the same factor this sample&rsquo;s s is off by.'}`,
    `A bigger multiplier, chosen so that <em>over all samples</em> exactly ${level}% capture &mu;. `
      + `It does not fix <em>this</em> interval &mdash; it fixes the rate.`,
  ][recipe - 1];
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
  if (k === 0) return 'μ';
  const mag = Math.abs(k) === 1 ? 'SE' : `${Math.abs(k)}SE`;
  return `μ${k < 0 ? '−' : '+'}${mag}`;
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
  const num = useSigma ? 'σ' : 's';
  const half = 13;
  return `<text x="${cx - 30}" y="${cy + 5}" text-anchor="end" font-size="13.5" font-weight="700" fill="${color}">ME = ${multLabel}</text>`
    + `<text x="${cx - 14}" y="${cy - 3}" text-anchor="middle" font-size="14" font-weight="700" fill="${numColor}">${num}</text>`
    + `<line x1="${cx - 14 - half}" y1="${cy}" x2="${cx - 14 + half}" y2="${cy}" stroke="${color}" stroke-width="1.4"/>`
    + `<text x="${cx - 14}" y="${cy + 15}" text-anchor="middle" font-size="13" fill="${color}">√n</text>`;
}

function describe() {
  const m = margin();
  const d = Math.abs(zStat).toFixed(2);
  const names = ['z* sigma over root n', 'z* s over root n', 't* s over root n'];
  return `This sample's mean sits ${d} true standard errors ${zStat < 0 ? 'below' : 'above'} mu. `
    + `Its margin of error by ${names[recipe - 1]} is ${m.toFixed(3)} true standard errors, `
    + `so the interval ${captures(m) ? 'reaches' : 'misses'} mu. `
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
    ${compact
      ? 'Sampling distribution of the sample mean'
      : 'Sampling distribution of the sample mean &#8212; centred at &#956;, one true SE = &#963;/&#8730;n wide'}
  </text>

  <polygon points="${px(-z).toFixed(2)},${baseline} ${band.join(' ')} ${px(z).toFixed(2)},${baseline}"
           fill="${BAND}" opacity="0.26"/>
  <polyline points="${pts.join(' ')}" fill="none" stroke="#2b6b8a" stroke-width="2.2"/>
  <text x="${px(0)}" y="${py(PEAK * 0.5)}" text-anchor="middle" font-size="17" font-weight="700"
        fill="#1b5e7e">${level}%</text>

  <line x1="${M.left}" y1="${baseline}" x2="${W - M.right}" y2="${baseline}" stroke="${AXIS}" stroke-width="1.5"/>
  ${ticks}
  ${dash(M.top + 4, baseline)}
  ${dash(baseline + 30, barY + 12)}

  <line id="wts-stat-line" x1="${statX}" y1="${M.top + 2}" x2="${statX}" y2="${barY}"
        stroke="${STAT_COLOR}" stroke-width="2.4"/>
  <g id="wts-stat-sym">
    <text x="${statX}" y="${M.top - 8}" text-anchor="middle" font-size="19" font-weight="700" fill="${STAT_COLOR}">x</text>
    <line x1="${statX - 6.5}" y1="${M.top - 23.5}" x2="${statX + 6.5}" y2="${M.top - 23.5}"
          stroke="${STAT_COLOR}" stroke-width="1.8" stroke-linecap="round"/>
  </g>

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
const layoutKey = () => `${level}|${recipe}|${n}|${sRatio}|${(figure.clientWidth || 780) < 560}`;
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
  readout.textContent = `${Math.abs(zStat).toFixed(2)} SE ${zStat < 0 ? 'below' : 'above'} μ`;
  slider.setAttribute('aria-valuetext', describe());

  verdictEl.className = `wts-verdict ${hit ? 'is-yes' : 'is-no'}`;
  verdictEl.innerHTML = `<span class="wts-glyph" aria-hidden="true">${hit ? '✓' : '✕'}</span>`
    + `This interval <strong>${hit ? 'contains' : 'misses'} μ</strong> `
    + `&mdash; its margin reaches ${m.toFixed(3)} SE and μ is ${Math.abs(zStat).toFixed(2)} SE away.`;

  if (announceChange && lastHit !== null && lastHit !== hit) {
    announce(hit ? 'Now the interval contains μ.' : 'Now the interval misses μ.');
  }
  lastHit = hit;
  renderCoverage();
}

function renderCoverage() {
  const parts = recipeParts();
  const truth = trueCoverage();
  const names = [
    `<em>z</em>*&sigma;/&radic;n`,
    `<em>z</em>*<span class="s-hat">s</span>/&radic;n`,
    `<em>t</em>*<span class="s-hat">s</span>/&radic;n`,
  ];
  const rows = names.map((nm, i) => {
    const pct = drawn ? (captured[i] / drawn) * 100 : NaN;
    const off = truth[i] < conf() - 0.004;
    return `<tr class="${recipe === i + 1 ? 'is-on' : ''}">`
      + `<td>${nm}</td>`
      + `<td class="num">${drawn ? `${captured[i]}/${drawn}` : '—'}</td>`
      + `<td class="num">${drawn ? `${pct.toFixed(drawn >= 100 ? 1 : 0)}%` : '—'}</td>`
      + `<td class="num ${off ? 'short' : 'ok'}">${(truth[i] * 100).toFixed(1)}%</td>`
      + `</tr>`;
  }).join('');
  coverageWrap.innerHTML = `
    <table class="wts-coverage">
      <caption class="sr-only">Coverage of each margin-of-error recipe</caption>
      <thead><tr><th scope="col">Margin of error</th><th scope="col">Captured &#956;</th>
        <th scope="col">So far</th><th scope="col">In the long run</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="wts-sub">Advertised: <strong>${level}%</strong>. The last column is exact arithmetic, not the tally
      &mdash; for <em>z</em>*<span class="s-hat">s</span>/&radic;n it is
      2&#8201;F<sub>t</sub>(${zStar().toFixed(3)},&nbsp;${n - 1}&nbsp;df)&nbsp;&minus;&nbsp;1, and it is
      <strong>${(truth[1] * 100).toFixed(1)}%</strong>, not ${level}%.
      Raise <em>n</em> and watch it climb: <em>t</em>* is ${(tStar() / zStar()).toFixed(3)}&times; <em>z</em>* here,
      and heads for 1.</p>`;
  if (parts.length !== 3) throw new Error('recipe table out of step');
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
  sRatio = Math.round(sHat * 100) / 100;
  sInput.value = String(Math.max(0.3, Math.min(2, sRatio)));
  sReadout.innerHTML = `${sRatio.toFixed(2)}&#8201;&sigma;`;
  setStat(z);
  announce(`Drew ${n} observations. Their mean is ${Math.abs(z).toFixed(2)} SE `
    + `${z < 0 ? 'below' : 'above'} mu and their s is ${sRatio.toFixed(2)} of sigma. `
    + `${captured[recipe - 1]} of ${drawn} intervals have captured mu with this recipe.`);
}

function drawMany(/** @type {number} */ k) {
  let last = { z: zStat, sHat: sRatio };
  for (let i = 0; i < k; i++) last = drawOne();
  sRatio = Math.round(last.sHat * 100) / 100;
  sInput.value = String(Math.max(0.3, Math.min(2, sRatio)));
  sReadout.innerHTML = `${sRatio.toFixed(2)}&#8201;&sigma;`;
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

function applyUrlParams() {
  const lv = params.get('ci') || params.get('level');
  if (lv && Object.prototype.hasOwnProperty.call(LEVELS, lv)) level = /** @type {any} */ (lv);
  const nn = parseInt(params.get('n') || '', 10);
  if (Number.isFinite(nn)) n = Math.max(3, Math.min(60, nn));
  const ss = parseFloat(params.get('s') || '');
  if (Number.isFinite(ss)) sRatio = Math.max(0.3, Math.min(2, ss));
  const xb = parseFloat(params.get('xbar') || params.get('z') || '');
  if (Number.isFinite(xb)) zStat = Math.max(-3.5, Math.min(3.5, xb));
  const me = parseInt(params.get('me') || '', 10);
  if (me >= 1 && me <= 3) recipe = me;

  nInput.value = String(n);
  nReadout.textContent = String(n);
  sInput.value = String(sRatio);
  sReadout.innerHTML = `${sRatio.toFixed(2)}&#8201;&sigma;`;
  slider.value = String(zStat);
  syncToggles();
}

initHelp();
initSettings();

import('jstat').then((jstat) => {
  setJStat(/** @type {any} */ (jstat).default || jstat);
  applyUrlParams();
  update({ announceChange: false });
});
