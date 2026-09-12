// @ts-check
/**
 * Sampling Designs — simple random, stratified, cluster, multistage and
 * convenience sampling, drawn from the same population in three settings.
 *
 * Origin: Todd Will's "contrived/playful sampling example" (Sept 2026) — rocks
 * buried under a plot of ground, sorted by size with depth, sampled four ways.
 * The physical metaphor is the good part: *"a cluster sample is easier, you only
 * have to dig three holes"* makes concrete the thing a definition never does,
 * which is that these designs differ in what they **cost to collect**.
 *
 * What this adds to the original demo:
 *
 * 1. **The simple random sample is not rigged.** The Mathematica version draws an
 *    SRS and then deletes 25 middle-stratum rocks so it *looks* unbalanced — a
 *    vivid picture of a false claim, since an SRS is unbiased and on average
 *    represents the strata in proportion. Every design here runs honestly.
 * 2. **Something gets estimated.** The original names the parameter and never
 *    computes it. Each sample reports its estimate against the truth.
 * 3. **Cost is a number** — clusters opened, items measured — because that is the
 *    argument for cluster sampling and it is usually left as an assertion.
 * 4. **Three settings** (see scenarios.js). The buried-rocks scene has only one
 *    convenient cluster and it happens to be an unusually *good* one, so on its
 *    own it teaches the exception. A beach and an orchard each offer two shapes
 *    that people actually use, which lets the tool show that a cluster's quality
 *    is a fact about the world rather than a choice the statistician makes.
 *
 * The variability machinery — 500 runs, the spread comparison, the table — sits
 * behind expert mode. A Chapter 2 reader is learning what the designs *are* and
 * what they cost; standard errors belong to a later course, and putting them in
 * front of a first reading buys confusion at full price.
 */

import { select } from 'd3-selection';
import { scaleLinear } from 'd3-scale';
import { axisBottom } from 'd3-axis';
import { mean } from '../../js/stats.js';
import { createRng } from '../../js/prng.js';
import { initHelp, announce, createExpertToggle } from '../../js/page-utils.js';
import { scenarioById, buildPopulation, clusterGroups } from './scenarios.js';

initHelp();

// ── State ───────────────────────────────────────────────────────────────
const qs = new URLSearchParams(location.search);
const DESIGN_ORDER = ['srs', 'stratified', 'cluster', 'multistage', 'convenience'];

let scenario = scenarioById((qs.get('scenario') || 'beach').toLowerCase());
let shapeKey = Object.keys(scenario.clusters)[0];
const designParam = (qs.get('design') || '').toLowerCase();
let design = DESIGN_ORDER.includes(designParam) ? designParam : 'srs';
let targetN = 60;
let drawCounter = 0;

/** @type {import('./scenarios.js').Item[]} */
let POP = [];
let MU = 0;
/** @type {import('./scenarios.js').Item[][]} */
let BY_BAND = [];
/** @type {import('./scenarios.js').Item[][]} */
let CLUSTERS = [];
let vMax = 1;

function rebuild() {
  POP = buildPopulation(scenario);
  MU = mean(POP.map(p => p.v));
  BY_BAND = scenario.bands.map((_, i) => POP.filter(p => p.band === i));
  CLUSTERS = clusterGroups(POP, scenario, scenario.clusters[shapeKey]);
  vMax = Math.max(...POP.map(p => p.v));
}

const shape = () => scenario.clusters[shapeKey];
const seedBase = qs.get('seed') || null;
const nextRng = () => createRng(`${seedBase ?? Math.random()}-${drawCounter++}`);
const fmt = (/** @type {number} */ v) => scenario.unit === 'g' ? v.toFixed(0) : v.toFixed(2);
const cap = (/** @type {string} */ s) => s.charAt(0).toUpperCase() + s.slice(1);

// ── Designs ─────────────────────────────────────────────────────────────
/**
 * @typedef {object} Draw
 * @property {import('./scenarios.js').Item[]} sample - what was measured
 * @property {number[]} picked - which clusters were opened
 * @property {import('./scenarios.js').Item[]} found - collected but not measured
 * @property {number[]|null} bandsShown
 */

/** @param {any[]} arr @param {number} k @param {() => number} rng */
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
 * Open clusters at random until they hold at least `n` items. Shared by cluster
 * and multistage so the two differ only in how much of the haul gets measured,
 * which is the whole distinction between them.
 * @param {number} n @param {() => number} rng
 */
function pickClusters(n, rng) {
  const order = sampleOf(CLUSTERS.map((_, i) => i), CLUSTERS.length, rng);
  /** @type {number[]} */
  const picked = [];
  let held = 0;
  for (const c of order) {
    if (held >= n) break;
    picked.push(c);
    held += CLUSTERS[c].length;
  }
  return picked.sort((a, b) => a - b);
}

/** @type {Record<string, {label: string, note: () => string, draw: (n: number, rng: () => number) => Draw}>} */
const DESIGNS = {
  srs: {
    label: 'Simple random',
    note: () => scenario.srsNote,
    draw: (n, rng) => ({ sample: sampleOf(POP, n, rng), picked: [], found: [], bandsShown: null }),
  },
  stratified: {
    label: 'Stratified',
    note: () => scenario.stratifiedNote,
    draw: (n, rng) => {
      /** @type {import('./scenarios.js').Item[]} */
      let sample = [];
      scenario.bands.forEach((_, i) => {
        sample = sample.concat(
          sampleOf(BY_BAND[i], Math.round(n * BY_BAND[i].length / POP.length), rng));
      });
      return { sample, picked: [], found: [], bandsShown: scenario.bands.map((_, i) => i) };
    },
  },
  cluster: {
    label: 'Cluster',
    note: () => shape().note,
    draw: (n, rng) => {
      const picked = pickClusters(n, rng);
      return { sample: picked.flatMap(c => CLUSTERS[c]), picked, found: [], bandsShown: null };
    },
  },
  multistage: {
    label: 'Multistage',
    note: () => `The same ${shape().labels}, but you measure a random handful from each instead of `
      + `everything. The pale ${scenario.items} are the ones you collected and put back.`,
    draw: (n, rng) => {
      const picked = pickClusters(n, rng);
      const per = Math.max(1, Math.round(n / picked.length));
      /** @type {import('./scenarios.js').Item[]} */
      let sample = [];
      for (const c of picked) sample = sample.concat(sampleOf(CLUSTERS[c], per, rng));
      const measured = new Set(sample);
      const found = picked.flatMap(c => CLUSTERS[c]).filter(p => !measured.has(p));
      return { sample, picked, found, bandsShown: null };
    },
  },
  convenience: {
    label: 'Convenience',
    note: () => scenario.convenience.note,
    draw: (n, rng) => {
      // Whatever is easiest to reach: always one band, never a fair picture. On
      // a beach and in an orchard that is the far band (the storm berm by the
      // car park, the crabapples by the lane); underground it is the surface.
      const i = scenario.id === 'buried' ? 0 : scenario.bands.length - 1;
      return { sample: sampleOf(BY_BAND[i], n, rng), picked: [], found: [], bandsShown: [i] };
    },
  },
};

/** @type {Draw|null} */
let current = null;
/** @type {Record<string, number[]>|null} */
let manyResults = null;
let manyCost = /** @type {Record<string, {n: number, k: number}>} */ ({});

// ── Elements ────────────────────────────────────────────────────────────
const el = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const scenarioBar = el('scenario-bar');
const designBar = el('design-bar');
const shapeBar = el('shape-bar');
const compareSection = el('compare-section');
const targetInput = /** @type {HTMLInputElement} */ (el('target-n'));

// ── The scene ───────────────────────────────────────────────────────────
const GW = 760, GH = 352, GM = { t: 26, r: 14, b: 42, l: 100 };
const gx = scaleLinear().domain([0, 1]).range([GM.l, GW - GM.r]);
const gy = scaleLinear().domain([0, 1]).range([GM.t, GH - GM.b]);
const gr = (/** @type {number} */ v) => 1.4 + Math.sqrt(v / vMax) * 5.2;

function drawScene() {
  const svg = select('#scene');
  svg.selectAll('*').remove();
  const measured = new Set(current ? current.sample : []);
  const heldBack = new Set(current ? current.found : []);
  const alongX = scenario.gradient === 'x';

  // Bands across the gradient — the natural strata
  const bands = svg.append('g');
  scenario.bands.forEach((b, i) => {
    const a0 = i / 3, a1 = (i + 1) / 3;
    bands.append('rect')
      .attr('x', alongX ? gx(a0) : gx(0)).attr('y', alongX ? gy(0) : gy(a0))
      .attr('width', alongX ? gx(a1) - gx(a0) : gx(1) - gx(0))
      .attr('height', alongX ? gy(1) - gy(0) : gy(a1) - gy(a0))
      .attr('fill', i % 2 ? '#f3efe9' : '#faf7f2');
    if (alongX) {
      const cx = gx((a0 + a1) / 2);
      bands.append('text').attr('x', cx).attr('y', GH - GM.b + 16).attr('text-anchor', 'middle')
        .attr('font-size', 12).attr('fill', '#5a5148').text(b.name);
      bands.append('text').attr('x', cx).attr('y', GH - GM.b + 29).attr('text-anchor', 'middle')
        .attr('font-size', 10.5).attr('fill', '#8a7f72').text(`(${b.label})`);
    } else {
      const cy = (gy(a0) + gy(a1)) / 2;
      bands.append('text').attr('x', GM.l - 8).attr('y', cy).attr('text-anchor', 'end')
        .attr('dominant-baseline', 'middle').attr('font-size', 12).attr('fill', '#5a5148').text(b.name);
      bands.append('text').attr('x', GM.l - 8).attr('y', cy + 13).attr('text-anchor', 'end')
        .attr('dominant-baseline', 'middle').attr('font-size', 10.5).attr('fill', '#8a7f72')
        .text(`(${b.label})`);
    }
  });

  // The water's edge, so a beach reads as a beach
  if (scenario.id === 'beach') {
    svg.append('rect').attr('x', gx(0)).attr('y', gy(0) - 8).attr('width', gx(1) - gx(0))
      .attr('height', 8).attr('fill', '#9ec9e0');
    svg.append('text').attr('x', gx(1) - 4).attr('y', gy(0) - 11).attr('text-anchor', 'end')
      .attr('font-size', 10.5).attr('fill', '#4a7f9c').text('water');
  }

  // Clusters that were opened
  if (current?.picked.length) {
    const g = svg.append('g');
    const sh = shape();
    const stripVertical = scenario.gradient === 'y';
    for (const c of current.picked) {
      let x0, y0, w, h;
      if (sh.kind === 'strip') {
        if (stripVertical) { x0 = gx(c / sh.n); y0 = gy(0); w = gx(1 / sh.n) - gx(0); h = gy(1) - gy(0); }
        else { x0 = gx(0); y0 = gy(c / sh.n); w = gx(1) - gx(0); h = gy(1 / sh.n) - gy(0); }
      } else {
        const cols = sh.n, rows = sh.rows ?? 4;
        x0 = gx((c % cols) / cols); y0 = gy(Math.floor(c / cols) / rows);
        w = gx(1 / cols) - gx(0); h = gy(1 / rows) - gy(0);
      }
      g.append('rect').attr('x', x0).attr('y', y0).attr('width', w).attr('height', h)
        .attr('fill', '#569BBD').attr('fill-opacity', 0.1)
        .attr('stroke', '#114B5F').attr('stroke-opacity', 0.45).attr('stroke-dasharray', '3 2');
    }
  }

  // Band boundaries, when the design uses them
  if (current?.bandsShown) {
    const g = svg.append('g');
    for (const i of current.bandsShown) {
      for (const a of [i / 3, (i + 1) / 3]) {
        g.append('line')
          .attr('x1', alongX ? gx(a) : gx(0)).attr('x2', alongX ? gx(a) : gx(1))
          .attr('y1', alongX ? gy(0) : gy(a)).attr('y2', alongX ? gy(1) : gy(a))
          .attr('stroke', '#114B5F').attr('stroke-width', 1.5).attr('stroke-dasharray', '5 3');
      }
    }
  }

  // Items in three states: left alone, collected but not measured, measured.
  const dots = svg.append('g');
  for (const p of POP) {
    if (measured.has(p) || heldBack.has(p)) continue;
    dots.append('circle').attr('cx', gx(p.x)).attr('cy', gy(p.y)).attr('r', gr(p.v))
      .attr('fill', '#b9b2a8').attr('fill-opacity', 0.75);
  }
  for (const p of heldBack) {
    dots.append('circle').attr('cx', gx(p.x)).attr('cy', gy(p.y)).attr('r', gr(p.v))
      .attr('fill', '#fff').attr('fill-opacity', 0.85)
      .attr('stroke', '#C08700').attr('stroke-width', 1.2).attr('stroke-dasharray', '2 1.5');
  }
  for (const p of measured) {
    dots.append('circle').attr('cx', gx(p.x)).attr('cy', gy(p.y)).attr('r', gr(p.v) + 0.6)
      .attr('fill', '#E07020').attr('stroke', '#5a2d00').attr('stroke-width', 1);
  }

  svg.append('text').attr('x', gx(0)).attr('y', 14).attr('font-size', 12).attr('fill', '#5a5148')
    .text(current ? `${DESIGNS[design].label} — ${current.sample.length} ${scenario.items} measured`
                  : scenario.name);

  if (heldBack.size > 0) {
    const lg = svg.append('g').attr('transform', `translate(${gx(1) - 250},5)`);
    lg.append('circle').attr('cx', 6).attr('cy', 6).attr('r', 5)
      .attr('fill', '#E07020').attr('stroke', '#5a2d00').attr('stroke-width', 1);
    lg.append('text').attr('x', 16).attr('y', 6).attr('dominant-baseline', 'middle')
      .attr('font-size', 11).attr('fill', '#5a5148').text('measured');
    lg.append('circle').attr('cx', 100).attr('cy', 6).attr('r', 5).attr('fill', '#fff')
      .attr('stroke', '#C08700').attr('stroke-width', 1.2).attr('stroke-dasharray', '2 1.5');
    lg.append('text').attr('x', 110).attr('y', 6).attr('dominant-baseline', 'middle')
      .attr('font-size', 11).attr('fill', '#5a5148').text('collected, put back');
  }

  svg.attr('aria-label', current
    ? `${scenario.name}. ${current.sample.length} ${scenario.items} highlighted as the `
      + `${DESIGNS[design].label.toLowerCase()} sample.`
    : scenario.name);
}

// ── One sample ──────────────────────────────────────────────────────────
function takeSample() {
  current = DESIGNS[design].draw(targetN, nextRng());
  const est = mean(current.sample.map(p => p.v));
  const err = est - MU;
  const usesClusters = design === 'cluster' || design === 'multistage';

  el('out-mu').innerHTML = `${fmt(MU)} <span class="unit">${scenario.unit}</span>`;
  el('out-est').innerHTML = `${fmt(est)} <span class="unit">${scenario.unit}</span>`;
  el('out-err').innerHTML = `${err >= 0 ? '+' : ''}${fmt(err)} <span class="unit">${scenario.unit}</span>`;
  el('out-n').textContent = String(current.sample.length);
  el('lab-n').textContent = `${cap(scenario.items)} measured`;

  const collectedRow = el('collected-row');
  collectedRow.hidden = current.found.length === 0;
  if (current.found.length) {
    el('out-collected').textContent = String(current.sample.length + current.found.length);
    el('lab-collected').textContent = `${cap(scenario.items)} collected`;
  }

  const costRow = el('cost-row');
  costRow.hidden = !usesClusters;
  if (usesClusters) {
    el('out-cost').textContent = String(current.picked.length);
    el('lab-cost').textContent = `${cap(shape().labels)} ${shape().verb}`;
  }

  el('design-note').textContent = DESIGNS[design].note();
  el('cost-note').textContent = costSentence();
  drawScene();
  announce(`${DESIGNS[design].label}: ${current.sample.length} ${scenario.items} measured, `
    + `estimate ${fmt(est)} ${scenario.unit} against a true average of ${fmt(MU)}.`);
}

function costSentence() {
  if (!current) return '';
  const sh = shape();
  const k = current.picked.length;
  const name = k === 1 ? sh.label : sh.labels;
  if (design === 'convenience') return 'Nothing was chosen at random, and nothing was searched for.';
  if (design === 'cluster') {
    return `You ${sh.verb} ${k} ${name} out of ${CLUSTERS.length}, and measured every one of the `
      + `${current.sample.length} ${scenario.items} in them.`;
  }
  if (design === 'multistage') {
    return `You ${sh.verb} the same ${k} ${name}, collected `
      + `${current.sample.length + current.found.length} ${scenario.items}, and measured only `
      + `${current.sample.length}.`;
  }
  const axis = scenario.gradient === 'y' ? 'x' : 'y';
  const touched = new Set(current.sample.map(p =>
    Math.min(sh.n - 1, Math.floor(p[axis] * sh.n)))).size;
  return `Your ${scenario.items} came from ${touched} different parts of the site. There is no `
    + `shortcut with this design — that is what it costs to give everything an equal chance.`;
}

// ── Many samples (expert) ───────────────────────────────────────────────
const CW = 760, CH = 300, CM = { t: 16, r: 18, b: 34, l: 100 };

function runMany() {
  const REPS = 500;
  /** @type {Record<string, number[]>} */
  const out = {};
  /** @type {Record<string, {n: number, k: number}>} */
  const cost = {};
  for (const key of DESIGN_ORDER) {
    const vals = []; let nSum = 0, kSum = 0;
    for (let i = 0; i < REPS; i++) {
      const d = DESIGNS[key].draw(targetN,
        createRng(`${seedBase ?? 'many'}-${scenario.id}-${shapeKey}-${key}-${i}`));
      vals.push(mean(d.sample.map(p => p.v)));
      nSum += d.sample.length; kSum += d.picked.length;
    }
    out[key] = vals;
    cost[key] = { n: nSum / REPS, k: kSum / REPS };
  }
  manyResults = out; manyCost = cost;
  compareSection.hidden = false;
  drawCompare();
  renderVerdict();
  announce('500 samples from each design. The comparison is below.');
  compareSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function drawCompare() {
  if (!manyResults) return;
  const svg = select('#compare');
  svg.selectAll('*').remove();
  const all = DESIGN_ORDER.flatMap(k => /** @type {number[]} */ (manyResults?.[k] ?? []));
  const lo = Math.min(MU, ...all), hi = Math.max(MU, ...all);
  const pad = (hi - lo) * 0.06 || 0.1;
  const x = scaleLinear().domain([lo - pad, hi + pad]).range([CM.l, CW - CM.r]);
  const rowH = (CH - CM.t - CM.b) / DESIGN_ORDER.length;

  svg.append('line').attr('x1', x(MU)).attr('x2', x(MU)).attr('y1', CM.t - 6).attr('y2', CH - CM.b)
    .attr('stroke', '#114B5F').attr('stroke-width', 2).attr('stroke-dasharray', '6 4');
  svg.append('text').attr('x', x(MU)).attr('y', CM.t - 9).attr('text-anchor', 'middle')
    .attr('font-size', 11.5).attr('font-weight', 700).attr('fill', '#114B5F')
    .text(`truth ${fmt(MU)} ${scenario.unit}`);

  DESIGN_ORDER.forEach((key, i) => {
    const yMid = CM.t + i * rowH + rowH / 2;
    const biased = key === 'convenience';
    svg.append('text').attr('x', CM.l - 8).attr('y', yMid).attr('text-anchor', 'end')
      .attr('dominant-baseline', 'middle').attr('font-size', 12)
      .attr('font-weight', biased ? 700 : 400).attr('fill', biased ? '#A33' : '#333')
      .text(DESIGNS[key].label);
    const jit = createRng(`jitter-${key}`);
    for (const v of manyResults[key]) {
      svg.append('circle').attr('cx', x(v)).attr('cy', yMid + (jit() - 0.5) * (rowH * 0.55))
        .attr('r', 1.9).attr('fill', biased ? '#A33' : '#569BBD').attr('fill-opacity', 0.45);
    }
  });

  svg.append('g').attr('transform', `translate(0,${CH - CM.b})`)
    .call(/** @type {any} */ (axisBottom(x).ticks(7)));
  svg.append('text').attr('x', (CM.l + CW - CM.r) / 2).attr('y', CH - 4).attr('text-anchor', 'middle')
    .attr('font-size', 11.5).attr('fill', '#5a5148')
    .text(`estimated average ${scenario.measure} (${scenario.unit})`);
}

function renderVerdict() {
  if (!manyResults) return;
  const rows = DESIGN_ORDER.map(key => {
    const v = /** @type {number[]} */ (manyResults?.[key] ?? []);
    const m = mean(v);
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
    return { key, label: DESIGNS[key].label, bias: m - MU, sd, ...manyCost[key] };
  });
  const srsSd = rows.find(r => r.key === 'srs')?.sd ?? 1;
  const cl = rows.find(r => r.key === 'cluster');
  const sh = shape();

  const body = rows.map(r => {
    const biased = Math.abs(r.bias) > 3 * r.sd / Math.sqrt(500) + 0.02 * MU;
    return `<tr><td>${r.label}</td>
      <td class="${biased ? 'biased' : ''}">${r.bias >= 0 ? '+' : ''}${fmt(r.bias)}</td>
      <td>${fmt(r.sd)}</td><td>${(r.sd / srsSd).toFixed(2)}&times;</td>
      <td>${Math.round(r.n)}</td><td>${r.k ? r.k.toFixed(1) : '—'}</td></tr>`;
  }).join('');

  const clusterVerdict = !cl ? ''
    : cl.sd < srsSd
      ? `Cluster sampling came out <strong>tighter</strong> than simple random here, on about
         ${cl.k.toFixed(0)} ${sh.labels} rather than a search across the whole site. A ${sh.label}
         cuts across all three bands, so each one is a small copy of the whole — the condition under
         which clustering does well, and not the usual one.`
      : `Cluster sampling came out <strong>${(cl.sd / srsSd).toFixed(1)}&times; wider</strong> than
         simple random, on about ${cl.k.toFixed(0)} ${sh.labels}. A ${sh.label} sits inside one band,
         so everything in it is alike: you measured ${Math.round(cl.n)} ${scenario.items} but only
         really looked in ${cl.k.toFixed(0)} places. That is the usual situation, and it is why
         cluster sampling normally costs precision for a given sample size and earns it back by being
         cheap.`;

  el('verdict').innerHTML = `
    <div class="verdict-scroll"><table>
      <caption class="sr-only">Bias, spread and cost of each design over 500 samples</caption>
      <thead><tr><th>Design</th><th>Average error</th><th>SD of estimates</th>
        <th>Spread vs simple random</th><th>Measured</th><th>Clusters</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>
    <p style="margin-top:0.5rem">Four designs have an average error near zero: random selection makes
       them <strong>accurate</strong>, however the randomness is organised. Where they differ is
       <strong>precision</strong> — and in what they cost. Stratifying cuts the spread sharply, because
       it removes the luck of how much of each band you happened to catch.</p>
    <p>${clusterVerdict}</p>
    <p><strong>Convenience</strong> is in a different category. Its estimates are <em>precise</em> —
       they agree closely with each other — and consistently wrong. Measuring more would only tighten
       them around the wrong answer.</p>
    <p class="hint"><strong>Worth comparing those last two rows carefully</strong>, because one sample
       of each can feel alike: pick three trees of one variety and you have essentially looked in one
       place, just as a convenience sample does. Over many samples they behave in opposite ways.
       Cluster sampling is <em>unbiased and scattered</em> — its average error is near zero, and it
       misses in both directions, because the clusters were chosen at random. Convenience is
       <em>biased and tight</em> — it misses the same way every time, and a larger sample would
       sharpen the error rather than remove it. A cluster sample of ${cl ? cl.k.toFixed(0) : 'k'}
       homogeneous clusters behaves like a simple random sample of ${cl ? cl.k.toFixed(0) : 'k'}
       items: a very small honest sample, not a large dishonest one.</p>`;
}

// ── Wiring ──────────────────────────────────────────────────────────────
function syncShapeBar() {
  const keys = Object.keys(scenario.clusters);
  const relevant = keys.length > 1 && (design === 'cluster' || design === 'multistage');
  shapeBar.hidden = !relevant;
  // Clear when hiding: a scenario with one cluster shape (buried rocks) would
  // otherwise keep the previous scenario's buttons in the DOM.
  if (!relevant) { shapeBar.innerHTML = ''; return; }
  shapeBar.innerHTML = '<span class="shape-label">Clusters are</span>'
    + keys.map(k => `<button type="button" data-shape="${k}" aria-pressed="${k === shapeKey}">`
      + `${scenario.clusters[k].labels}</button>`).join('');
}

function clearMany() {
  manyResults = null;
  compareSection.hidden = true;
}

scenarioBar.addEventListener('click', (e) => {
  const btn = /** @type {HTMLElement} */ (e.target).closest('button[data-scenario]');
  if (!btn) return;
  scenario = scenarioById(btn.getAttribute('data-scenario') ?? 'beach');
  shapeKey = Object.keys(scenario.clusters)[0];
  for (const b of scenarioBar.querySelectorAll('button[data-scenario]')) {
    b.setAttribute('aria-pressed', String(b === btn));
  }
  el('scenario-blurb').textContent = scenario.blurb;
  rebuild();
  clearMany();
  syncShapeBar();
  takeSample();
});

designBar.addEventListener('click', (e) => {
  const btn = /** @type {HTMLElement} */ (e.target).closest('button[data-design]');
  if (!btn) return;
  design = btn.getAttribute('data-design') ?? 'srs';
  for (const b of designBar.querySelectorAll('button[data-design]')) {
    b.setAttribute('aria-pressed', String(b === btn));
  }
  syncShapeBar();
  takeSample();
});

shapeBar.addEventListener('click', (e) => {
  const btn = /** @type {HTMLElement} */ (e.target).closest('button[data-shape]');
  if (!btn) return;
  shapeKey = btn.getAttribute('data-shape') ?? Object.keys(scenario.clusters)[0];
  rebuild();
  clearMany();
  syncShapeBar();
  takeSample();
});

el('take-btn').addEventListener('click', takeSample);
el('run-many').addEventListener('click', runMany);
targetInput.addEventListener('change', () => {
  targetN = Math.max(12, Math.min(200, parseInt(targetInput.value, 10) || 60));
  targetInput.value = String(targetN);
  clearMany();
  takeSample();
});
el('reset-btn').addEventListener('click', () => { clearMany(); takeSample(); });

// ── Init ────────────────────────────────────────────────────────────────
for (const b of scenarioBar.querySelectorAll('button[data-scenario]')) {
  b.setAttribute('aria-pressed', String(b.getAttribute('data-scenario') === scenario.id));
}
for (const b of designBar.querySelectorAll('button[data-design]')) {
  b.setAttribute('aria-pressed', String(b.getAttribute('data-design') === design));
}
el('scenario-blurb').textContent = scenario.blurb;
createExpertToggle(/** @type {HTMLElement} */ (document.querySelector('.generate-bar')));
if (qs.get('n')) targetInput.value = String(parseInt(qs.get('n') ?? '60', 10));
targetN = Math.max(12, Math.min(200, parseInt(targetInput.value, 10) || 60));
rebuild();
syncShapeBar();
takeSample();
