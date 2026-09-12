// @ts-check
/**
 * Sampling Designs — simple random, stratified, cluster, multistage, convenience,
 * all drawing from the same buried population.
 *
 * From Todd Will's "contrived/playful sampling example" (Sept 2026): rocks under a
 * plot of ground, sorted by size with depth, sampled four ways. The physical
 * metaphor is the good part — "a cluster sample is easier, you only dig three
 * holes" makes concrete the thing a definition never does, which is that these
 * designs differ in what they *cost to collect*.
 *
 * Three deliberate departures from the original demo:
 *
 * 1. **The simple random sample is not rigged.** The Mathematica version draws an
 *    SRS and then deletes 25 middle-stratum rocks so that it looks unbalanced. It
 *    makes a vivid picture of a false claim: an SRS is unbiased, and on average it
 *    represents the strata in proportion. Here every design is run honestly, and
 *    the real difference is shown where it actually lives — in the *spread* of the
 *    estimates over many samples, not in one rigged picture.
 *
 * 2. **Something gets estimated.** The original names the parameter (average
 *    weight) and then never computes it. Each sample here reports x̄ against μ, and
 *    "Run 500" builds the sampling distribution of x̄ for all five designs on one
 *    shared axis — which is the only way to see that stratified is *tighter* than
 *    simple random, and by how much (measured here: 0.23x its spread).
 *
 * 3. **Cost is a number.** Holes dug and rocks weighed are displayed, because the
 *    trade-off being taught is precision per unit of effort.
 *
 * And one addition the measurements forced. Running the five designs honestly
 * showed cluster sampling coming out *more* precise than a simple random sample
 * here, not less — because Todd's holes are vertical and therefore each contains
 * all three strata. That is not a quirk to hide; it is the actual principle,
 * so the cluster shape is now a control: switch to horizontal layers and watch
 * the same design collapse. Good strata are uniform inside; good clusters are
 * varied inside. Opposite rules, same ground.
 *
 * Convenience sampling is added as a fifth design: it is the only biased one, and
 * it sets up the contrast that `conceptual/sampling-bias` develops — more data
 * does not fix a sample that was chosen wrong.
 */

import { select } from 'd3-selection';
import { scaleLinear } from 'd3-scale';
import { axisBottom } from 'd3-axis';
import { mean } from '../../js/stats.js';
import { createRng } from '../../js/prng.js';
import { initHelp, announce } from '../../js/page-utils.js';
import { parseParams } from '../../js/url-params.js';

initHelp();

// ── Population ──────────────────────────────────────────────────────────
// Three depth strata. Rocks settle by size, so weight rises sharply with depth
// — that gradient is what makes stratification pay and convenience sampling
// fail, so it needs to be strong enough to see.
const STRATA = [
  { name: 'Topsoil', label: 'pebbles', depth: [0, 1], count: 320, meanW: 0.6, sd: 0.18 },
  { name: 'Subsoil', label: 'cobbles', depth: [1, 2], count: 240, meanW: 2.4, sd: 0.6 },
  { name: 'Bedrock layer', label: 'boulders', depth: [2, 3], count: 150, meanW: 7.0, sd: 1.8 },
];
const N_HOLES = 16;   // vertical columns ("holes") the plot is divided into
const N_LAYERS = 8;   // horizontal slabs, the alternative cluster shape

/** @typedef {{x: number, y: number, w: number, stratum: number, hole: number}} Rock */

/** Build the population once, from a fixed seed, so the truth is stable. */
function buildPopulation() {
  const rng = createRng('sampling-designs-population');
  /** @type {Rock[]} */
  const pop = [];
  STRATA.forEach((s, si) => {
    for (let i = 0; i < s.count; i++) {
      const x = rng();
      const y = s.depth[0] + rng() * (s.depth[1] - s.depth[0]);
      // Log-normal-ish: weights are positive and right-skewed, like real rocks.
      const z = (rng() + rng() + rng() + rng() - 2) * 1.2;
      const w = Math.max(0.05, s.meanW * Math.exp(z * (s.sd / s.meanW)));
      pop.push({ x, y, w, stratum: si, hole: Math.min(N_HOLES - 1, Math.floor(x * N_HOLES)) });
    }
  });
  return pop;
}

const POPULATION = buildPopulation();
const MU = mean(POPULATION.map(r => r.w));
/** Rock indices grouped by stratum and by cluster — precomputed, they never change. */
const BY_STRATUM = STRATA.map((_, si) => POPULATION.filter(r => r.stratum === si));
const BY_HOLE = Array.from({ length: N_HOLES }, (_, h) => POPULATION.filter(r => r.hole === h));
const BY_LAYER = Array.from({ length: N_LAYERS }, (_, l) =>
  POPULATION.filter(r => Math.min(N_LAYERS - 1, Math.floor((r.y / 3) * N_LAYERS)) === l));

/**
 * Which shape the clusters take. This is the tool's real subject.
 *
 * Measured over 500 samples: with *vertical* holes, cluster sampling is MORE
 * precise than a simple random sample (SD 0.19 vs 0.34), because every hole
 * runs top to bottom and is therefore a miniature of the whole population. With
 * *horizontal* layers it falls apart, because each cluster is uniform inside and
 * the clusters differ wildly from each other — you may dig three slabs of
 * topsoil and conclude the ground is full of pebbles.
 *
 * That is the principle, and it is the opposite of the one for strata: good
 * clusters are internally varied, good strata are internally uniform. Most
 * intro texts state that clusters "usually" lose precision without saying what
 * decides it; here you can switch the geometry and watch it happen.
 */
let clusterShape = /** @type {'holes'|'layers'} */ ('holes');
const clusterGroups = () => (clusterShape === 'holes' ? BY_HOLE : BY_LAYER);
const clusterCount = () => (clusterShape === 'holes' ? N_HOLES : N_LAYERS);

// ── Designs ─────────────────────────────────────────────────────────────

/**
 * @typedef {object} Draw
 * @property {Rock[]} sample - the rocks actually weighed
 * @property {number[]} holes - which clusters were opened
 * @property {number[]|null} strataShown - stratum indices to draw bands for
 * @property {Rock[]} [found] - rocks turned up by the digging but NOT weighed.
 *   Cluster and multistage dig the same holes; the only difference between them
 *   is how much of what they find gets weighed, and that difference is invisible
 *   unless the unweighed rocks are drawn in a state of their own.
 */

/** Random sample of k items without replacement. @param {any[]} arr @param {number} k @param {() => number} rng */
function sampleOf(arr, k, rng) {
  const idx = arr.map((_, i) => i);
  const take = Math.min(k, idx.length);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(rng() * (idx.length - i));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, take).map(i => arr[i]);
}

/**
 * Open clusters at random until they hold at least `n` rocks between them.
 * Shared by cluster and multistage so both dig the same amount — the designs
 * differ in weighing, not in digging, and the display should say only that.
 * @param {number} n
 * @param {() => number} rng
 */
function pickClusters(n, rng) {
  const groups = clusterGroups();
  const order = sampleOf(Array.from({ length: clusterCount() }, (_, i) => i), clusterCount(), rng);
  /** @type {number[]} */
  const picked = [];
  let held = 0;
  for (const h of order) {
    if (held >= n) break;
    picked.push(h);
    held += groups[h].length;
  }
  return { groups, picked: picked.sort((a, b) => a - b) };
}

/** How many holes a scattered sample touches — the digging it actually costs. */
const holesTouched = (/** @type {Rock[]} */ s) => [...new Set(s.map(r => r.hole))].sort((a, b) => a - b);

/** @type {Record<string, {label: string, note: string, draw: (n: number, rng: () => number) => Draw}>} */
const DESIGNS = {
  srs: {
    label: 'Simple random',
    note: 'Every rock in the plot is equally likely — so the sample is scattered across the whole '
        + 'plot, and you end up digging almost everywhere.',
    draw: (n, rng) => {
      const sample = sampleOf(POPULATION, n, rng);
      return { sample, holes: holesTouched(sample), strataShown: null };
    },
  },
  stratified: {
    label: 'Stratified',
    note: 'Split the ground into its three depth layers first, then sample each layer at random, in '
        + 'proportion to its size. Every layer is represented every single time.',
    draw: (n, rng) => {
      /** @type {Rock[]} */
      let sample = [];
      const total = POPULATION.length;
      STRATA.forEach((s, si) => {
        const k = Math.round(n * BY_STRATUM[si].length / total);
        sample = sample.concat(sampleOf(BY_STRATUM[si], k, rng));
      });
      return { sample, holes: holesTouched(sample), strataShown: [0, 1, 2] };
    },
  },
  cluster: {
    label: 'Cluster',
    note: 'Open whole clusters at random and weigh every rock you find. Each vertical hole runs top '
        + 'to bottom, so it holds all three layers — which is exactly what makes clusters work here.',
    draw: (n, rng) => {
      const { groups, picked } = pickClusters(n, rng);
      const sample = picked.flatMap(h => groups[h]);
      return { sample, holes: picked, strataShown: null, found: [] };
    },
  },
  multistage: {
    label: 'Multistage',
    note: 'Open the same clusters — then weigh only a random sample of the rocks in each. The same '
        + 'digging, a fraction of the weighing. The pale rocks are the ones you dug up and put back.',
    draw: (n, rng) => {
      // Deliberately the same clusters cluster sampling would have opened, so
      // the only thing that differs on screen is how much of the haul is
      // weighed. That *is* the distinction between the two designs.
      const { groups, picked } = pickClusters(n, rng);
      const per = Math.max(1, Math.round(n / picked.length));
      /** @type {Rock[]} */
      let sample = [];
      for (const h of picked) sample = sample.concat(sampleOf(groups[h], per, rng));
      const weighed = new Set(sample);
      const found = picked.flatMap(h => groups[h]).filter(r => !weighed.has(r));
      return { sample, holes: picked, strataShown: null, found };
    },
  },
  convenience: {
    label: 'Convenience',
    note: 'Take what is easy to reach: scrape the surface and weigh what turns up. No randomness '
        + 'anywhere — and the topsoil is nothing but pebbles.',
    draw: (n, rng) => {
      // No digging at all: you take what is lying on top, so "holes dug" is 0.
      const sample = sampleOf(BY_STRATUM[0], n, rng);
      return { sample, holes: [], strataShown: [0] };
    },
  },
};

const DESIGN_ORDER = ['srs', 'stratified', 'cluster', 'multistage', 'convenience'];

// ── State ───────────────────────────────────────────────────────────────
const params = parseParams();
const designParam = (new URLSearchParams(location.search).get('design') || '').toLowerCase();
let design = DESIGN_ORDER.includes(designParam) ? designParam : 'srs';
let targetN = 60;
let drawCounter = 0;
/** @type {Draw|null} */
let current = null;
/** @type {Record<string, number[]>|null} */
let manyResults = null;
/** Mean sample size and mean holes dug per design, over the same 500 runs. */
let manyCost = /** @type {Record<string, {n: number, holes: number}>} */ ({});

const seedBase = params.seed ? String(params.seed) : null;
/** A fresh stream per dig; seeded when `?seed=` is given, so a class all sees the same rocks. */
const nextRng = () => createRng(`${seedBase ?? Math.random()}-${drawCounter++}`);

// ── Elements ────────────────────────────────────────────────────────────
const el = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const designBar = el('design-bar');
const targetInput = /** @type {HTMLInputElement} */ (el('target-n'));
const compareSection = el('compare-section');

// ── The ground ──────────────────────────────────────────────────────────
const GW = 760, GH = 330, GM = { t: 26, r: 14, b: 22, l: 92 };
const gx = scaleLinear().domain([0, 1]).range([GM.l, GW - GM.r]);
const gy = scaleLinear().domain([0, 3]).range([GM.t, GH - GM.b]);
/** Weight → radius. Square root, so area tracks weight rather than radius. */
const gr = (/** @type {number} */ w) => 1.4 + Math.sqrt(w) * 1.5;

function drawGround() {
  const svg = select('#ground');
  svg.selectAll('*').remove();
  const sampled = new Set(current ? current.sample : []);

  // Strata bands, labelled — the structure students are meant to notice
  const bands = svg.append('g');
  STRATA.forEach((s, si) => {
    bands.append('rect')
      .attr('x', gx(0)).attr('y', gy(s.depth[0]))
      .attr('width', gx(1) - gx(0)).attr('height', gy(s.depth[1]) - gy(s.depth[0]))
      .attr('fill', si % 2 ? '#f3efe9' : '#faf7f2');
    bands.append('text')
      .attr('x', GM.l - 8).attr('y', (gy(s.depth[0]) + gy(s.depth[1])) / 2)
      .attr('text-anchor', 'end').attr('dominant-baseline', 'middle')
      .attr('font-size', 12).attr('fill', '#5a5148')
      .text(`${s.name}`);
    bands.append('text')
      .attr('x', GM.l - 8).attr('y', (gy(s.depth[0]) + gy(s.depth[1])) / 2 + 13)
      .attr('text-anchor', 'end').attr('dominant-baseline', 'middle')
      .attr('font-size', 10.5).attr('fill', '#8a7f72')
      .text(`(${s.label})`);
  });

  // Hole walls, when the design digs specific holes
  const digsHoles = design === 'cluster' || design === 'multistage';
  if (digsHoles && current) {
    const g = svg.append('g');
    for (const h of current.holes) {
      const vertical = clusterShape === 'holes';
      g.append('rect')
        .attr('x', vertical ? gx(h / N_HOLES) : gx(0))
        .attr('y', vertical ? gy(0) : gy((h / N_LAYERS) * 3))
        .attr('width', vertical ? gx(1 / N_HOLES) - gx(0) : gx(1) - gx(0))
        .attr('height', vertical ? gy(3) - gy(0) : gy(3 / N_LAYERS) - gy(0))
        .attr('fill', '#569BBD').attr('fill-opacity', 0.1)
        .attr('stroke', '#114B5F').attr('stroke-opacity', 0.45).attr('stroke-dasharray', '3 2');
    }
  }
  // Stratum boundaries, when the design uses them
  if (current?.strataShown) {
    const g = svg.append('g');
    for (const si of current.strataShown) {
      for (const d of STRATA[si].depth) {
        g.append('line')
          .attr('x1', gx(0)).attr('x2', gx(1)).attr('y1', gy(d)).attr('y2', gy(d))
          .attr('stroke', '#114B5F').attr('stroke-width', 1.5).attr('stroke-dasharray', '5 3');
      }
    }
  }

  // Rocks, in three states: left in the ground, dug up but not weighed, weighed.
  const foundOnly = new Set(current?.found ?? []);
  const rocks = svg.append('g');
  for (const r of POPULATION) {
    if (sampled.has(r) || foundOnly.has(r)) continue;
    rocks.append('circle')
      .attr('cx', gx(r.x)).attr('cy', gy(r.y)).attr('r', gr(r.w))
      .attr('fill', '#b9b2a8').attr('fill-opacity', 0.75);
  }
  // Dug up and put back: hollow, so it reads as "handled but not measured" and
  // is distinguishable from both other states without relying on colour.
  for (const r of foundOnly) {
    rocks.append('circle')
      .attr('cx', gx(r.x)).attr('cy', gy(r.y)).attr('r', gr(r.w))
      .attr('fill', '#fff').attr('fill-opacity', 0.85)
      .attr('stroke', '#C08700').attr('stroke-width', 1.2).attr('stroke-dasharray', '2 1.5');
  }
  // Sampled rocks: filled orange AND ringed dark — never colour alone.
  for (const r of (current ? current.sample : [])) {
    rocks.append('circle')
      .attr('cx', gx(r.x)).attr('cy', gy(r.y)).attr('r', gr(r.w) + 0.6)
      .attr('fill', '#E07020').attr('stroke', '#5a2d00').attr('stroke-width', 1);
  }

  svg.append('text')
    .attr('x', gx(0)).attr('y', 16).attr('font-size', 12).attr('fill', '#5a5148')
    .text(current ? `${DESIGNS[design].label} sample — ${current.sample.length} rocks weighed`
                  : 'The plot, before you dig');

  if (foundOnly.size > 0) {
    const lg = svg.append('g').attr('transform', `translate(${gx(1) - 232},6)`);
    lg.append('circle').attr('cx', 6).attr('cy', 7).attr('r', 5)
      .attr('fill', '#E07020').attr('stroke', '#5a2d00').attr('stroke-width', 1);
    lg.append('text').attr('x', 16).attr('y', 7).attr('dominant-baseline', 'middle')
      .attr('font-size', 11).attr('fill', '#5a5148').text('weighed');
    lg.append('circle').attr('cx', 92).attr('cy', 7).attr('r', 5)
      .attr('fill', '#fff').attr('stroke', '#C08700').attr('stroke-width', 1.2)
      .attr('stroke-dasharray', '2 1.5');
    lg.append('text').attr('x', 102).attr('y', 7).attr('dominant-baseline', 'middle')
      .attr('font-size', 11).attr('fill', '#5a5148').text('dug up, put back');
  }
  svg.attr('aria-label', current
    ? `Cross-section of the ground. ${current.sample.length} rocks highlighted as the `
      + `${DESIGNS[design].label.toLowerCase()} sample, from ${current.holes.length} holes.`
    : 'Cross-section of the ground before any sample is taken.');
}

// ── One dig ─────────────────────────────────────────────────────────────
function dig() {
  const rng = nextRng();
  current = DESIGNS[design].draw(targetN, rng);
  const xbar = mean(current.sample.map(r => r.w));
  const err = xbar - MU;

  el('out-mu').innerHTML = `${MU.toFixed(2)} <span class="unit">kg</span>`;
  el('out-xbar').innerHTML = `${xbar.toFixed(2)} <span class="unit">kg</span>`;
  el('out-err').innerHTML = `${err >= 0 ? '+' : ''}${err.toFixed(2)} <span class="unit">kg</span>`;
  el('out-n').textContent = String(current.sample.length);
  el('out-holes').textContent = String(current.holes.length);
  const dugUp = current.sample.length + (current.found?.length ?? 0);
  const foundRow = el('found-row');
  const usesClusters = design === 'cluster' || design === 'multistage';
  foundRow.hidden = !usesClusters;
  if (usesClusters) el('out-found').textContent = String(dugUp);

  el('design-note').textContent = DESIGNS[design].note;
  const holes = current.holes.length;
  const unit = (design === 'cluster' || design === 'multistage') && clusterShape === 'layers'
    ? 'layer' : 'hole';
  const outOf = (design === 'cluster' || design === 'multistage') ? clusterCount() : N_HOLES;
  const dug = current.sample.length + (current.found?.length ?? 0);
  el('cost-note').textContent = design === 'convenience'
    ? 'No digging at all — you took what was lying on the surface.'
    : design === 'multistage'
      ? `You opened ${holes} ${unit}${holes === 1 ? '' : 's'}, turned up ${dug} rocks, and weighed `
        + `${current.sample.length} of them. Cluster sampling digs exactly the same ${unit}s and `
        + `weighs all ${dug}.`
      : design === 'cluster'
        ? `You opened ${holes} ${unit}${holes === 1 ? '' : 's'} and weighed every one of the ${dug} `
          + `rocks in them. Multistage digs the same ${unit}s and weighs only some.`
        : holes >= N_HOLES - 1
          ? `You dug in all ${holes} places across the plot to find those rocks.`
          : `You opened ${holes} ${unit}${holes === 1 ? '' : 's'} out of ${outOf}.`;

  drawGround();
  announce(`${DESIGNS[design].label}: ${current.sample.length} rocks from ${holes} holes, `
    + `estimate ${xbar.toFixed(2)} kilograms against a true mean of ${MU.toFixed(2)}.`);
}

// ── Many samples ────────────────────────────────────────────────────────
const CW = 760, CH = 300, CM = { t: 16, r: 18, b: 34, l: 92 };

function runMany() {
  const REPS = 500;
  /** @type {Record<string, number[]>} */
  const out = {};
  /** @type {Record<string, {n: number, holes: number}>} */
  const cost = {};
  for (const key of DESIGN_ORDER) {
    const vals = [];
    let nSum = 0, holeSum = 0;
    for (let i = 0; i < REPS; i++) {
      const rng = createRng(`${seedBase ?? 'many'}-${key}-${i}`);
      const d = DESIGNS[key].draw(targetN, rng);
      vals.push(mean(d.sample.map(r => r.w)));
      nSum += d.sample.length;
      holeSum += d.holes.length;
    }
    out[key] = vals;
    cost[key] = { n: nSum / REPS, holes: holeSum / REPS };
  }
  manyResults = out;
  manyCost = cost;
  compareSection.hidden = false;
  drawCompare();
  renderVerdict();
  announce('500 samples from each of the five designs. The comparison is below the ground.');
  compareSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function drawCompare() {
  if (!manyResults) return;
  const svg = select('#compare');
  svg.selectAll('*').remove();

  const all = DESIGN_ORDER.flatMap(k => manyResults[k]);
  const lo = Math.min(MU, ...all), hi = Math.max(MU, ...all);
  const pad = (hi - lo) * 0.06 || 0.1;
  const x = scaleLinear().domain([lo - pad, hi + pad]).range([CM.l, CW - CM.r]);
  const rowH = (CH - CM.t - CM.b) / DESIGN_ORDER.length;

  // Truth line, drawn under the dots and labelled
  svg.append('line')
    .attr('x1', x(MU)).attr('x2', x(MU)).attr('y1', CM.t - 6).attr('y2', CH - CM.b)
    .attr('stroke', '#114B5F').attr('stroke-width', 2).attr('stroke-dasharray', '6 4');
  svg.append('text')
    .attr('x', x(MU)).attr('y', CM.t - 9).attr('text-anchor', 'middle')
    .attr('font-size', 11.5).attr('font-weight', 700).attr('fill', '#114B5F')
    .text(`truth ${MU.toFixed(2)} kg`);

  DESIGN_ORDER.forEach((key, i) => {
    const yTop = CM.t + i * rowH;
    const yMid = yTop + rowH / 2;
    const vals = manyResults[key];
    const biased = key === 'convenience';

    svg.append('text')
      .attr('x', CM.l - 8).attr('y', yMid).attr('text-anchor', 'end')
      .attr('dominant-baseline', 'middle').attr('font-size', 12)
      .attr('font-weight', biased ? 700 : 400)
      .attr('fill', biased ? '#A33' : '#333')
      .text(DESIGNS[key].label);

    // Jittered strip: one dot per sample, deterministic jitter so it doesn't
    // twitch between redraws.
    const jit = createRng(`jitter-${key}`);
    for (const v of vals) {
      svg.append('circle')
        .attr('cx', x(v))
        .attr('cy', yMid + (jit() - 0.5) * (rowH * 0.55))
        .attr('r', 1.9)
        .attr('fill', biased ? '#A33' : '#569BBD')
        .attr('fill-opacity', 0.45);
    }
  });

  const axis = svg.append('g').attr('transform', `translate(0,${CH - CM.b})`);
  axis.call(/** @type {any} */ (axisBottom(x).ticks(7)));
  svg.append('text')
    .attr('x', (CM.l + CW - CM.r) / 2).attr('y', CH - 4)
    .attr('text-anchor', 'middle').attr('font-size', 11.5).attr('fill', '#5a5148')
    .text('estimated average weight (kg)');
}

function renderVerdict() {
  if (!manyResults) return;
  const rows = DESIGN_ORDER.map(key => {
    const v = manyResults[key];
    const m = mean(v);
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
    const cost = manyCost[key];
    return { key, label: DESIGNS[key].label, bias: m - MU, sd, n: cost.n, holes: cost.holes };
  });
  const srsSd = rows.find(r => r.key === 'srs')?.sd ?? 1;

  const body = rows.map(r => {
    const biased = Math.abs(r.bias) > 3 * r.sd / Math.sqrt(500) + 0.02;
    return `<tr>
      <td>${r.label}</td>
      <td class="${biased ? 'biased' : ''}">${r.bias >= 0 ? '+' : ''}${r.bias.toFixed(3)}</td>
      <td>${r.sd.toFixed(3)}</td>
      <td>${(r.sd / srsSd).toFixed(2)}&times;</td>
      <td>${Math.round(r.n)}</td>
      <td>${r.holes.toFixed(1)}</td>
    </tr>`;
  }).join('');

  // Say what actually happened rather than what usually happens: with vertical
  // holes cluster sampling here beats a simple random sample, and claiming
  // otherwise in front of the table would be teaching a slogan over the data.
  const clusterRow = rows.find(r => r.key === 'cluster');
  const clusterTighter = clusterRow ? clusterRow.sd < srsSd : false;
  const shapeSentence = clusterShape === 'holes'
    ? `Cluster sampling came out <strong>${clusterTighter ? 'tighter' : 'wider'}</strong> than simple
       random here, on ${clusterRow ? Math.round(clusterRow.holes) : 3} holes instead of a dig across
       the whole plot. That is not luck: a hole runs top to bottom, so each one is a small copy of the
       whole population. Switch <em>Clusters are</em> to <strong>horizontal layers</strong> and run it
       again — same design, same sample size, and watch what happens.`
    : `With clusters as horizontal layers the spread is <strong>${clusterRow ? (clusterRow.sd / srsSd).toFixed(1) : '?'}&times;</strong>
       simple random's. Each layer holds only one kind of rock, so three layers tell you about three
       depths and guess at the rest. The design did not change &mdash; only the shape of the clusters did.`;

  el('verdict').innerHTML = `
    <div class="verdict-scroll"><table>
      <caption class="sr-only">Bias, spread and cost of each design over 500 samples</caption>
      <thead><tr><th>Design</th><th>Average error</th><th>SD of estimates</th>
        <th>Spread vs simple random</th><th>Rocks weighed</th><th>Holes dug</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>
    <p style="margin-top:0.5rem">Four designs have an average error near zero: random selection makes
       them <strong>accurate</strong>, however the randomness is organised. Where they differ is
       <strong>precision</strong> — and in what they cost to collect. Stratifying cuts the spread
       sharply, because it removes the luck of how many deep rocks you happened to catch.</p>
    <p>${shapeSentence}</p>
    <p><strong>Convenience</strong> is in a different category altogether. Its estimates are
       <em>precise</em> — they agree closely with each other — and consistently wrong by about
       ${rows.find(r => r.key === 'convenience') ? Math.abs(rows.find(r => r.key === 'convenience').bias).toFixed(1) : '?'} kg.
       Weighing more pebbles would tighten them further around the wrong answer.</p>`;
}

// ── Wiring ──────────────────────────────────────────────────────────────
designBar.addEventListener('click', (e) => {
  const btn = /** @type {HTMLElement} */ (e.target).closest('button[data-design]');
  if (!btn) return;
  design = btn.getAttribute('data-design') ?? 'srs';
  for (const b of designBar.querySelectorAll('button[data-design]')) {
    b.setAttribute('aria-pressed', String(b === btn));
  }
  syncShapeBar();
  dig();
});

const shapeBar = el('shape-bar');
shapeBar.addEventListener('click', (e) => {
  const btn = /** @type {HTMLElement} */ (e.target).closest('button[data-shape]');
  if (!btn) return;
  clusterShape = /** @type {'holes'|'layers'} */ (btn.getAttribute('data-shape') ?? 'holes');
  for (const b of shapeBar.querySelectorAll('button[data-shape]')) {
    b.setAttribute('aria-pressed', String(b === btn));
  }
  // The comparison is now stale — it was computed with the other geometry, and
  // that is precisely the number this control changes.
  if (manyResults) { manyResults = null; compareSection.hidden = true; }
  dig();
  announce(clusterShape === 'layers'
    ? 'Clusters are now horizontal layers — each one is all the same kind of rock.'
    : 'Clusters are now vertical holes — each one runs through all three layers.');
});

/** The shape control only means anything for the two designs that use clusters. */
function syncShapeBar() {
  shapeBar.hidden = !(design === 'cluster' || design === 'multistage');
}

el('dig-btn').addEventListener('click', dig);
el('run-many').addEventListener('click', runMany);
targetInput.addEventListener('change', () => {
  targetN = Math.max(12, Math.min(200, parseInt(targetInput.value, 10) || 60));
  targetInput.value = String(targetN);
  dig();
  if (manyResults) { manyResults = null; compareSection.hidden = true; }
});
el('reset-btn').addEventListener('click', () => {
  manyResults = null;
  compareSection.hidden = true;
  dig();
});

// Reflect the chosen design in the button bar when it came from the URL
for (const b of designBar.querySelectorAll('button[data-design]')) {
  b.setAttribute('aria-pressed', String(b.getAttribute('data-design') === design));
}
syncShapeBar();
if (params.n) targetInput.value = String(params.n);
targetN = Math.max(12, Math.min(200, parseInt(targetInput.value, 10) || 60));
dig();
