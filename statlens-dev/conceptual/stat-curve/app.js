// @ts-check
/**
 * Where the curve comes from — the sampling distribution of a test statistic.
 *
 * Jeff, 2026-10-31: "todd's app was built just to illustrate the sampling
 * distribution for chi-square … I'm sure we can figure out how to do something
 * to illustrate other important stats like F and t."
 *
 * This is the t case, built first because it carries the one idea the other two
 * cannot: the statistic's shape depends on its DENOMINATOR, and you can see
 * that by rescoring the very same samples.
 *
 * The move is a toggle, not a second simulation. Each sample contributes both
 *
 *     z = (x̄ − μ) / (σ/√n)        the true standard error, same every time
 *     t = (x̄ − μ) / (s/√n)        this sample's own s, different every time
 *
 * and the toggle chooses which of the two is piled up. Nothing about x̄ changes
 * between the views — the numerator is identical, sample for sample — so the
 * heavier tails cannot be blamed on the means. They come from a denominator
 * that wobbles. Running two independent simulations would prove nothing of the
 * sort: the shapes would differ and a reader could reasonably think the SAMPLES
 * differed.
 *
 * ⚠ The x-domain is FIXED at ±5. A statistic's distribution is being compared
 * with a curve and with its own other scoring, and an axis that rescaled on
 * each render would hide the whole effect — fatter tails drawn to the same
 * width look identical. Same reason the bin grid is locked.
 *
 * Why this is not part of the Sampling Distribution Lab: the Lab's frame is
 * parameter → estimate, and its central claim is that the parameter marker and
 * the simulated centre coincide at every n (see sampling-lab-centre.spec.js,
 * and the Watkins trap it guards). A test statistic has no parameter to mark,
 * and is generated under a stated model rather than drawn from a population
 * that exists — `statedPopulation` rather than `sampling` in the mechanism
 * vocabulary. Putting them in one page would cost the Lab the one thing it is
 * built to say.
 *
 * Sibling of `conceptual/why-t-star/`, which takes the next step: what these
 * tails cost in interval coverage. That page states the mechanism in prose —
 * "a random denominator gives (x̄−μ)/(s/√n) heavier tails than a normal" — and
 * never draws it. This page draws it.
 */

import { createRng, randNormal } from '../../js/prng.js';
import { mean, sd } from '../../js/stats.js';
import { setJStat, tCDF } from '../../js/distributions.js';
import { renderSimChart } from '../../js/chart-defaults.js';
import { normalPdf, overlayTheoryCurve } from '../../js/theory-overlay.js';
import { announce, initHelp, initSettings } from '../../js/page-utils.js';
import { tex } from '../../js/tex.js';
import { prefersReducedMotion } from '../../js/settings.js';

// ─── The population ───
//
// A concrete scale rather than N(0,1): standardizing a standard normal makes
// Step 1 and Step 2 abstract exactly where a reader is trying to see what is
// being divided by what. These are the usual IQ-ish numbers, so σ/√n and s/√n
// are visibly different quantities on a visibly real axis.
const MU = 100;
const SIGMA = 15;

/** The axis both scorings are drawn on. Fixed — see the note at the top. */
/** @type {[number, number]} */
const DOMAIN = [-5, 5];
const BIN_WIDTH = 0.25;
/**
 * The bin edges, stated explicitly.
 *
 * `binWidth` only locks a DOTPLOT's grid; a histogram takes `thresholds`. With
 * neither, the chart chose its own bin count — ten bars across ±5, which is a
 * bin a whole unit wide and far too coarse to show a tail thickening. The two
 * scorings also have to share one grid, or the comparison is between two
 * different binnings as much as between two statistics.
 */
const THRESHOLDS = Array.from(
  { length: Math.round((DOMAIN[1] - DOMAIN[0]) / BIN_WIDTH) + 1 },
  (_, i) => DOMAIN[0] + i * BIN_WIDTH);

/** The cutoff the tally counts against: the one students reach for by habit. */
const Z_CUT = 1.96;

const el = (/** @type {string} */ id) => document.getElementById(id);

const nSlider = /** @type {HTMLInputElement} */ (el('n-slider'));
const nValue = el('n-value');

const popWrap = el('sc-pop');
const sampleWrap = el('sc-sample');
const scoreWrap = el('sc-score');
const chartZ = el('chart-z');
const chartT = el('chart-t');
const tallyZ = el('tally-z');
const tallyT = el('tally-t');
const readout = el('readout');
const genBtns = /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll('.gen-btn')]);

const params = new URLSearchParams(location.search);
const seed = params.get('seed') || 'curve';

let n = 10;
/**
 * Below this many samples the plots are drawn as individual dots, which is what
 * makes a sample pointable — the linked highlight needs something to point at.
 * Past it there are too many to tell apart and the shape is the subject, so
 * they become histograms and the pairing readout steps aside.
 */
const DOT_MAX = 200;
/** How many draws keep their individual values; see `stats`. */
const SAMPLE_STORE_MAX = 4000;
/** Which sample is being pointed at, if any. */
/** @type {number|null} */ let linked = null;
/**
 * Each plot's bars, read as ordered stacks.
 *
 * Jeff, 2026-10-31: "I'd like the ability to roll over bars and see samples by
 * thinking of each bar as an ordered stack of horizontal line segments. When
 * the frequencies get too large we might just have to [show] a subset of each
 * sample for each bar."
 *
 * A histogram bar is a dotplot column with the gaps closed, so the pointer's
 * HEIGHT inside a bar can address one draw the same way its position in a
 * column does. For each bin this keeps the sample indices that fell in it, in
 * draw order, plus the bar's pixel box — enough to turn a (x, y) into a sample
 * and a sample back into a segment to draw.
 * @type {Map<HTMLElement, { bins: Map<number, number[]>, rects: Map<number, DOMRect> }>}
 */
const stacks = new Map();
/** A segment thinner than this cannot be pointed at, so the bar offers fewer. */
const MIN_SEGMENT_PX = 3;
/**
 * Every draw, not just its two scorings — Step 2 has to be able to show the
 * sample a reader is pointing at, which means its values, its x̄ and its s.
 *
 * `values` is the only part with real bulk (n numbers per draw), so it is kept
 * for the first SAMPLE_STORE_MAX draws and dropped after that: the formulas
 * still work from x̄ and s, which cost four numbers and are always kept, and
 * past a few thousand samples nobody is picking individual draws out anyway.
 * @type {{ z: number, t: number, xbar: number, s: number, values?: number[] }[]}
 */
let stats = [];
/** @type {{ values: number[], xbar: number, s: number, z: number, t: number }|null} */
let lastSample = null;
/** @type {() => number} */
let rng = createRng(`${seed}-${n}`);


const fmt = (/** @type {number} */ v, /** @type {number} */ d = 2) => v.toFixed(d);

// ─── Drawing ───

/**
 * One sample, scored both ways.
 *
 * ⚠ Both scorings come from ONE draw. The two plots are two readings of the
 * same list, never two simulations: the claim is that the numerator is
 * identical and only the denominator moved.
 */
function drawOne() {
  const values = [];
  for (let i = 0; i < n; i++) values.push(randNormal(MU, SIGMA, rng));
  const xbar = mean(values);
  const s = sd(values);
  const gap = xbar - MU;
  return {
    values,
    xbar,
    s,
    z: gap / (SIGMA / Math.sqrt(n)),
    // s = 0 needs n identical values from a continuous distribution; guard
    // anyway rather than push an Infinity into the histogram's domain.
    t: s > 0 ? gap / (s / Math.sqrt(n)) : 0,
  };
}

/** @param {number} k */
function draw(k) {
  for (let i = 0; i < k; i++) {
    const one = drawOne();
    stats.push(stats.length < SAMPLE_STORE_MAX
      ? one
      : { z: one.z, t: one.t, xbar: one.xbar, s: one.s });
    lastSample = one;
  }
  render(stats.length - 1);
  // One sample, two destinations — the clearest statement the page can make
  // that these are two readings of one draw rather than two simulations.
  if (k === 1) flyBothWays();
  announce(`${k} sample${k === 1 ? '' : 's'} drawn. ${stats.length} in each distribution.`);
}

function reset() {
  stats = [];
  lastSample = null;
  // Re-seeded per n, so a given ?seed= and n always replay the same run.
  rng = createRng(`${seed}-${n}`);
  render();
}

// ─── Step 1: the population ───

function renderPopulation() {
  if (!popWrap) return;
  const W = 420, H = 96, PAD = 10;
  const lo = MU - 3.6 * SIGMA, hi = MU + 3.6 * SIGMA;
  const x = (/** @type {number} */ v) => PAD + ((v - lo) / (hi - lo)) * (W - 2 * PAD);
  const peak = normalPdf(MU, MU, SIGMA);
  const y = (/** @type {number} */ d) => H - 22 - (d / peak) * (H - 40);

  let path = '';
  for (let i = 0; i <= 120; i++) {
    const v = lo + (i / 120) * (hi - lo);
    path += `${i ? 'L' : 'M'}${x(v).toFixed(1)},${y(normalPdf(v, MU, SIGMA)).toFixed(1)}`;
  }

  // ±1σ marked as a span, not two loose ticks: σ is a width, and the sample's
  // s in Step 2 is the same kind of thing measured on the sample.
  popWrap.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img"
         aria-label="A normal population with mean ${MU} and standard deviation ${SIGMA}.">
      <path d="${path}" fill="none" stroke="#569BBD" stroke-width="2"/>
      <line x1="${PAD}" y1="${H - 22}" x2="${W - PAD}" y2="${H - 22}" stroke="#333" stroke-width="1"/>
      <line x1="${x(MU)}" y1="${y(peak)}" x2="${x(MU)}" y2="${H - 22}" stroke="#114B5F" stroke-width="1.5"/>
      <text x="${x(MU)}" y="${H - 8}" text-anchor="middle" class="sc-axis-label"
            style="font-size:10px;fill:#114B5F;font-weight:700">μ = ${MU}</text>
      <line x1="${x(MU - SIGMA)}" y1="${H - 30}" x2="${x(MU + SIGMA)}" y2="${H - 30}"
            stroke="#595959" stroke-width="1"/>
      <text x="${x(MU + SIGMA) + 5}" y="${H - 27}" style="font-size:9.5px;fill:#595959">σ = ${SIGMA}</text>
    </svg>`;
}

// ─── Step 2: this sample, scored twice ───

function renderSample() {
  if (!sampleWrap || !scoreWrap) return;
  // The sample under the pointer wins over the latest draw: hovering a dot in
  // Step 3 should bring its own sample back into Step 2, picture and formulas
  // together, or the two panels are describing different things. (Jeff,
  // 2026-10-31: "when hovering over dots the picture and formulas in step 2
  // should change with the dot.")
  const shown = (linked != null && stats[linked]) ? stats[linked] : lastSample;
  if (!shown) {
    sampleWrap.innerHTML = '';
    scoreWrap.innerHTML = '<p class="sc-hint">Draw a sample to see it scored</p>';
    return;
  }
  const { values, xbar, s, z, t } = shown;
  const W = 420, H = 62, PAD = 10;
  const lo = MU - 3.6 * SIGMA, hi = MU + 3.6 * SIGMA;
  const x = (/** @type {number} */ v) => PAD + ((v - lo) / (hi - lo)) * (W - 2 * PAD);

  // Same x-scale as Step 1 on purpose: the sample has to be visibly a handful
  // of draws from that population, not its own picture on its own axis.
  if (!values) {
    // Past SAMPLE_STORE_MAX the individual values are not kept — x̄ and s are,
    // so the arithmetic below is exact; only the picture of the draw is gone.
    sampleWrap.innerHTML = '<p class="sc-hint">(this draw\u2019s individual values were not kept)</p>';
  } else {
  const dots = values.map((v) => `<circle cx="${x(v).toFixed(1)}" cy="30" r="2.6"
      fill="#111" stroke="#fff" stroke-width="0.8"/>`).join('');

  sampleWrap.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img"
         aria-label="A sample of ${n} values. Mean ${fmt(xbar, 1)}, standard deviation ${fmt(s, 1)}.">
      <line x1="${PAD}" y1="46" x2="${W - PAD}" y2="46" stroke="#333" stroke-width="1"/>
      <line x1="${x(MU)}" y1="12" x2="${x(MU)}" y2="46" stroke="#595959" stroke-width="1" stroke-dasharray="3 2"/>
      ${dots}
      <line x1="${x(xbar)}" y1="10" x2="${x(xbar)}" y2="46" stroke="#C2410C" stroke-width="2"/>
      <text x="${x(xbar)}" y="8" text-anchor="middle" style="font-size:9.5px;fill:#C2410C;font-weight:700">x̄ = ${fmt(xbar, 1)}</text>
    </svg>`;
  }

  const gap = xbar - MU;
  const seKnown = SIGMA / Math.sqrt(n);
  const seEst = s / Math.sqrt(n);
  // The numerator is written identically in both rows, and only the
  // denominator is marked, because "only this changed" is the entire argument.
  // Typeset, not spelled out in monospace. The claim this panel makes is about
  // a NUMERATOR shared by two fractions whose DENOMINATORS differ, and a
  // fraction bar says that in one stroke where "(102.8 − 100) ÷ σ/√n = 8.03"
  // asked the reader to parse precedence first. (Jeff, 2026-10-31: "the
  // formatting of the math on the t vs z app makes it hard to read … let's use
  // properly formatted math".)
  //
  // The denominator is wrapped in \htmlClass so it can be tinted — the one
  // thing that differs between the rows, marked alongside the fraction bar that
  // already shows it rather than instead of it.
  const row = (/** @type {string} */ key, /** @type {string} */ name,
    /** @type {string} */ symDen, /** @type {string} */ numDen,
    /** @type {number} */ val) => `
    <div class="sc-row" data-row="${key}">${tex(
      `${name} = \\frac{\\bar{x} - \\mu}{\\htmlClass{sc-den}{${symDen}}}`
      + ` = \\frac{${fmt(xbar, 1)} - ${MU}}{\\htmlClass{sc-den}{${numDen}}}`
      + ` = ${fmt(val)}`, { display: true })}</div>`;
  scoreWrap.innerHTML =
    row('z', 'z', '\\dfrac{\\sigma}{\\sqrt{n}}', `\\dfrac{${SIGMA}}{\\sqrt{${n}}}`, z)
    + row('t', 't', '\\dfrac{s}{\\sqrt{n}}', `\\dfrac{${fmt(s, 1)}}{\\sqrt{${n}}}`, t)
    + `<p class="sc-hint">Same gap of ${fmt(gap, 1)} on top. Only the bottom moved.</p>`;
}

// ─── Step 3: both scorings, one axis ───

/**
 * Two plots, stacked, sharing a domain and a bin grid.
 *
 * Jeff, 2026-10-31: "would it be more effective if the two sampling
 * distributions, z and t, were stacked vertically in the same panel and if we
 * hovered over a dot in one the dot in both would be highlighted."
 *
 * It is, and the hover is why. A toggle made the reader hold one shape in
 * memory while looking at the other; stacked on one axis, the comparison is
 * there to be pointed at. And pointing is what turns "the same samples, scored
 * two ways" from a claim into something visible: one dot lights up in each
 * plot, at two different places, and the readout says what the sample's s was.
 *
 * @param {number} [newest] - index to mark as the latest arrival
 */
function renderDistributions(newest = -1) {
  if (!chartZ || !chartT) return;
  const zs = stats.map((p) => p.z);
  const ts = stats.map((p) => p.t);
  // Dots while a sample is still an individual thing; past that the shape is
  // the subject and dots would be a smear.
  const chartType = stats.length <= DOT_MAX ? 'dotplot' : 'histogram';

  const one = (/** @type {HTMLElement} */ host, /** @type {number[]} */ values,
    /** @type {string} */ id, /** @type {string} */ xLabel) => {
    // ⚠ Values outside the fixed axis are removed BEFORE the chart sees them.
    //
    // A d3 scale does not clamp, so a statistic past the domain is mapped past
    // the plot and drawn outside the SVG — on a dotplot it really was painted
    // ~90px beyond the chart's own right edge, unhittable and unexplained,
    // which is how this was found. The tally already says these exist and how
    // many; the picture must not half-show them.
    const shown = values.map((v, i) => /** @type {[number, number]} */ ([v, i]))
      .filter(([v]) => Math.abs(v) <= DOMAIN[1]);
    const result = renderSimChart(host, shown.map(([v]) => v), {
      chartType, id, xLabel,
      titleText: '',
      domain: DOMAIN,
      thresholds: THRESHOLDS,
      binWidth: BIN_WIDTH,
      binOrigin: DOMAIN[0],
      // Positional within `shown`, not the sample's index — they differ once
      // anything has been filtered out.
      highlightIndex: newest < 0 ? -1 : shown.findIndex(([, i]) => i === newest),
      precision: 2,
    });
    // `computeDots` maps without sorting, so circle k is shown[k] — relabel
    // each with the SAMPLE's index, which is what the two plots are linked by.
    // Without this, filtering would silently renumber them and the pairing
    // would point at the wrong sample.
    for (const c of host.querySelectorAll('circle[data-stat-index]')) {
      const k = Number(c.getAttribute('data-stat-index'));
      if (shown[k]) c.setAttribute('data-stat-index', String(shown[k][1]));
    }
    // Index the bars as stacks: which draws are in each bin, in draw order,
    // and where that bin's bar sits. Everything in SVG user space — the bars
    // carry their own x/y/width/height there, and the x-scale inverts, so a
    // bar can say which bin it is rather than being matched by eye.
    const bins = new Map();
    for (const [v, i] of shown) {
      const k = Math.max(0, Math.min(THRESHOLDS.length - 2,
        Math.floor((v - DOMAIN[0]) / BIN_WIDTH)));
      if (!bins.has(k)) bins.set(k, []);
      bins.get(k).push(i);
    }
    const rects = new Map();
    for (const r of host.querySelectorAll('.data rect')) {
      const x = Number(r.getAttribute('x'));
      const w = Number(r.getAttribute('width'));
      if (!(w > 0)) continue;
      const v = result.xScale.invert(x + w / 2);
      const k = Math.floor((v - DOMAIN[0]) / BIN_WIDTH + 1e-9);
      if (bins.has(k)) {
        rects.set(k, { x, w, y: Number(r.getAttribute('y')), h: Number(r.getAttribute('height')) });
      }
    }
    stacks.set(host, { bins, rects });
    wireStackHover(host);

    if (!values.length || !result) return;
    // The SAME reference curve over both. It is what the z pile should match
    // and what the t pile should overflow; drawing t(df) over the lower one
    // would make both piles fit their own curve and the comparison would
    // vanish — which is the only thing this page is for.
    const yScale = chartType === 'histogram' ? result.yScale : result.countToY;
    if (result.xScale && yScale) {
      overlayTheoryCurve({
        container: host,
        pdf: (v) => normalPdf(v, 0, 1),
        xDomain: DOMAIN,
        totalN: values.length,
        // Ours, not the chart's: we set the thresholds, so we know the width
        // the curve has to be scaled by.
        binWidth: result.binWidth ?? BIN_WIDTH,
        xScale: result.xScale,
        yScale,
        label: 'N(0, 1)',
      });
    }
  };

  // Just the letter. Step 2 shows what each one is, typeset, directly above —
  // repeating the recipe on the axis in flat text put the least readable
  // rendering of it in the most prominent place, and the label over each plot
  // already names which SE it divided by. (Jeff, 2026-10-31.)
  one(chartZ, zs, 'sc-chart-z', 'z');
  one(chartT, ts, 'sc-chart-t', 't');
  if (chartType === 'dotplot') wireLinkedHover();
  showLinked(linked);
}

/**
 * The sample leaves Step 2 twice, for two different places.
 *
 * Jeff, 2026-10-31: "maybe an animation for the sampling?" This is the one
 * worth animating. Each flyer starts on its own row in Step 2 — the z row, the
 * t row — and lands on that sample's dot in the matching plot. They set off
 * together from the same sample and arrive at different x, which is the whole
 * argument in one gesture.
 *
 * Skipped under reduced motion, where the dots are simply there already.
 */
function flyBothWays() {
  if (prefersReducedMotion()) return;
  const i = stats.length - 1;
  const pairs = [
    [document.querySelector('[data-row="z"]'), chartZ],
    [document.querySelector('[data-row="t"]'), chartT],
  ];
  for (const [from, host] of pairs) {
    const target = host?.querySelector(`circle[data-stat-index="${i}"]`);
    if (!from || !target) continue;
    const a = from.getBoundingClientRect();
    const b = target.getBoundingClientRect();
    if (!a.width || !b.width) continue;

    const dot = document.createElement('span');
    dot.className = 'sc-flyer';
    dot.style.left = `${a.right - 18}px`;
    dot.style.top = `${a.top + a.height / 2}px`;
    document.body.appendChild(dot);

    const dx = (b.left + b.width / 2) - (a.right - 18);
    const dy = (b.top + b.height / 2) - (a.top + a.height / 2);
    dot.animate([
      { transform: 'translate(0,0) scale(0.5)', opacity: 0 },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 22}px) scale(1)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) scale(1)`, opacity: 1 },
    ], { duration: 560, easing: 'cubic-bezier(.4,0,.3,1)' }).onfinish = () => {
      dot.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200 }).onfinish = () => dot.remove();
    };
  }
}

/**
 * How many segments a bar can usefully offer, and which draw each one stands for.
 *
 * A bin holding 300 draws cannot give each of them a pointable slice of a 40px
 * bar, so the bar offers as many segments as fit at MIN_SEGMENT_PX and each
 * stands for one draw taken evenly through the bin's list. The ORDER is kept:
 * segment 0 at the bottom is the earliest draw in that bin, which is what makes
 * the stack a stack rather than a lookup table.
 *
 * @param {number} count - draws in the bin
 * @param {number} barH - the bar's height in SVG units
 * @param {number} unit - SVG units per screen pixel
 */
function segmentsFor(count, barH, unit) {
  const fit = Math.max(1, Math.floor(barH / (MIN_SEGMENT_PX * unit)));
  return Math.min(count, fit);
}

/** SVG units per screen pixel for a plot, so a 3px floor means 3 real pixels. */
function unitPerPx(/** @type {HTMLElement} */ host) {
  const svg = host.querySelector('svg');
  const box = svg?.getBoundingClientRect();
  const vb = svg?.viewBox?.baseVal;
  return (box?.width && vb?.width) ? vb.width / box.width : 1;
}

/** Point at a bar; the height under the pointer picks the draw. */
function wireStackHover(/** @type {HTMLElement} */ host) {
  const svg = host.querySelector('svg');
  if (!svg || svg.dataset.stackWired) return;
  svg.dataset.stackWired = '1';

  svg.addEventListener('mousemove', (ev) => {
    const st = stacks.get(host);
    if (!st || !st.rects.size) return;
    // Screen → the coordinate system the BARS are in.
    //
    // ⚠ Not the root svg's. The bars live inside `.chart-inner`, a <g> that is
    // translated by the chart's margins, and their x/y attributes are in that
    // group's space. Inverting the root matrix put the pointer tens of units
    // away from where the rectangles think they are, so no bar was ever under
    // it and nothing happened at all.
    const inner = svg.querySelector('.chart-inner') || svg;
    const ctm = inner.getScreenCTM();
    if (!ctm) return;
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX; pt.y = ev.clientY;
    const { x: px, y: py } = pt.matrixTransform(ctm.inverse());

    for (const [k, r] of st.rects) {
      if (px < r.x || px > r.x + r.w) continue;
      if (py < r.y || py > r.y + r.h) break;          // above the bar: nothing
      const list = st.bins.get(k) || [];
      const nSeg = segmentsFor(list.length, r.h, unitPerPx(host));
      const fromBottom = (r.y + r.h) - py;
      const seg = Math.max(0, Math.min(nSeg - 1, Math.floor((fromBottom / r.h) * nSeg)));
      const idx = nSeg >= list.length ? seg : Math.floor((seg * list.length) / nSeg);
      showLinked(list[idx]);
      return;
    }
  });
  svg.addEventListener('mouseleave', () => showLinked(null));
}

/**
 * Draw sample `i` as the segment it occupies in each bar.
 *
 * The mirror of the hit test: find the draw's place in its bin's stack and mark
 * that slice. Since the two plots bin the same draw differently, the two marks
 * land at different heights as well as different x — which is the pairing, said
 * in the one place a histogram can say it.
 */
function markSegments(/** @type {number} */ i) {
  for (const host of [chartZ, chartT]) {
    const st = host && stacks.get(host);
    const svg = host?.querySelector('svg');
    if (!st || !svg) continue;
    const value = host === chartZ ? stats[i]?.z : stats[i]?.t;
    if (value == null) continue;
    const k = Math.floor((value - DOMAIN[0]) / BIN_WIDTH);
    const list = st.bins.get(k);
    const r = st.rects.get(k);
    if (!list || !r) continue;
    const pos = list.indexOf(i);
    if (pos < 0) continue;

    const nSeg = segmentsFor(list.length, r.h, unitPerPx(host));
    const seg = nSeg >= list.length ? pos : Math.round((pos * nSeg) / list.length);
    const segH = r.h / nSeg;
    const y = r.y + r.h - (Math.min(seg, nSeg - 1) + 0.5) * segH;

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('class', 'sc-seg');
    line.setAttribute('x1', String(r.x));
    line.setAttribute('x2', String(r.x + r.w));
    line.setAttribute('y1', String(y));
    line.setAttribute('y2', String(y));
    (svg.querySelector('.data') || svg).appendChild(line);
  }
}

// ─── The same sample, in both plots ───

/** Every circle that stands for sample `i`, in either plot. */
const dotsFor = (/** @type {number} */ i) =>
  /** @type {SVGCircleElement[]} */ ([...document.querySelectorAll(
    `#chart-z circle[data-stat-index="${i}"], #chart-t circle[data-stat-index="${i}"]`)]);

function wireLinkedHover() {
  for (const host of [chartZ, chartT]) {
    for (const c of host?.querySelectorAll('circle[data-stat-index]') ?? []) {
      const i = Number(c.getAttribute('data-stat-index'));
      if (!stats[i]) continue;
      // `focusin` as well as `mouseenter`: the dotplot already gives every
      // circle a tabindex for its own tooltip, so the keyboard costs nothing.
      c.addEventListener('mouseenter', () => showLinked(i));
      c.addEventListener('focusin', () => showLinked(i));
      // Both scorings in the label, so the pairing survives without a pointer.
      c.setAttribute('aria-label',
        `sample ${i + 1}: z = ${fmt(stats[i].z)}, t = ${fmt(stats[i].t)}`);
    }
  }
  chartZ?.addEventListener('mouseleave', () => showLinked(null));
  chartT?.addEventListener('mouseleave', () => showLinked(null));
}

/** @param {number|null} i */
function showLinked(i) {
  // mousemove fires constantly, so the same sample is not redrawn twice — but
  // null must always fall through, because clearing is also what writes the
  // "point anywhere in a bar" hint in the first place.
  if (i === linked && i !== null) return;
  for (const c of document.querySelectorAll('.sc-linked')) c.classList.remove('sc-linked');
  for (const l of document.querySelectorAll('.sc-seg')) l.remove();
  linked = i;
  const box = el('paired');
  if (!box) return;
  if (i == null || !stats[i]) {
    renderSample();                 // back to the latest draw
    box.className = 'sc-paired is-empty';
    box.textContent = stats.length && stats.length <= DOT_MAX
      ? 'Point at a dot to see the same sample in both plots'
      : 'Point anywhere in a bar — its height picks one of the draws stacked in it';
    return;
  }
  const dots = dotsFor(i);
  for (const c of dots) c.classList.add('sc-linked');
  if (!dots.length) markSegments(i);    // histogram mode: mark the slice instead
  renderSample();
  const { z, t, s: sEst } = stats[i];
  box.className = 'sc-paired';
  box.innerHTML = `Sample ${i + 1}: <strong>z = ${fmt(z)}</strong>, <strong>t = ${fmt(t)}</strong>`
    + ` — its s was ${fmt(sEst, 1)} against σ = ${SIGMA},`
    + ` so dividing by it moved the value ${Math.abs(t) > Math.abs(z) ? 'further out' : 'closer in'}.`;
}

// ─── The tallies ───

/**
 * @param {HTMLElement|null} host
 * @param {number[]} values
 * @param {number} expected - what the right curve says the tail should be
 */
function renderTally(host, values, expected) {
  if (!host) return;
  if (!values.length) { host.textContent = ''; return; }
  const beyond = values.filter((v) => Math.abs(v) >= Z_CUT).length;
  // Values past the end of a fixed axis are DROPPED by the plot, and silently
  // dropping the most extreme draws from a figure about tails is the wrong kind
  // of tidy. At n = 3 the t statistic puts about 4% outside ±5.
  const offAxis = values.filter((v) => Math.abs(v) > DOMAIN[1]).length;
  host.innerHTML = `beyond ±${Z_CUT}: <span class="sc-big">${beyond}</span> of ${values.length}`
    + ` = <span class="sc-big">${fmt((100 * beyond) / values.length, 1)}%</span>`
    + ` (this curve says ${fmt(expected, 1)}%)`
    + (offAxis ? ` — ${offAxis} past the edge, counted but not drawn` : '');
}

function renderReadout() {
  renderTally(tallyZ, stats.map((p) => p.z), 5);
  renderTally(tallyT, stats.map((p) => p.t), 100 * 2 * (1 - tCDF(Z_CUT, n - 1)));
  if (!readout) return;
  readout.innerHTML = stats.length
    ? `<p class="sc-note">With s in the denominator and ${n - 1} degrees of freedom,
       ±${Z_CUT} cuts off more than 5% — which is why t* for n = ${n} is bigger than 1.96.</p>`
    : '<p class="sc-note">Draw some samples to build the distributions.</p>';
}

/** @param {number} [newest] */
function render(newest = -1) {
  renderSample();
  renderDistributions(newest);
  renderReadout();
}

// ─── Wiring ───

for (const b of genBtns) {
  b.addEventListener('click', () => draw(Number(b.dataset.count) || 1));
}
el('reset-btn')?.addEventListener('click', () => {
  reset();
  announce('Starting over.');
});

nSlider?.addEventListener('input', () => {
  n = Number(nSlider.value);
  if (nValue) nValue.textContent = String(n);
  // Each n has its own curve — df changes, and so does how much s wobbles — so
  // a tally collected at another n is not part of this one.
  reset();
});

// KaTeX is a deferred CDN script, so a reader who presses +1 before it arrives
// gets `tex()`'s <code> fallback and keeps it until the next draw. One re-render
// once the page has finished loading closes that window; it is a no-op when the
// math is already typeset, which is the normal case.
addEventListener('load', () => {
  if (lastSample && !document.querySelector('.sc-row .katex')) render();
});

initHelp();
initSettings();
renderPopulation();

import('jstat').then((jstat) => {
  setJStat(/** @type {any} */ (jstat).default || jstat);
  const urlN = Number(params.get('n'));
  if (Number.isFinite(urlN) && urlN >= 3 && urlN <= 50) {
    n = Math.round(urlN);
    if (nSlider) nSlider.value = String(n);
    if (nValue) nValue.textContent = String(n);
  }
  reset();
});
