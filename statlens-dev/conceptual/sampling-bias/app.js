// @ts-check
/**
 * Sampling Bias Lab — the "Sampling Words from the Gettysburg Address" activity.
 * Population = the 268 words of the address; variable = word length (letters).
 * Hand-picked "representative" samples are biased high; random samples are not.
 */
import { mean } from '../../js/stats.js';
import { createRng } from '../../js/prng.js';
import { drawDotplot } from '../../js/dotplot.js';
import { initHelp, announce } from '../../js/page-utils.js';

initHelp();

const GETTYSBURG = `Four score and seven years ago, our fathers brought forth upon this continent a new nation: conceived in liberty, and dedicated to the proposition that all men are created equal. Now we are engaged in a great civil war, testing whether that nation, or any nation so conceived and so dedicated, can long endure. We are met on a great battlefield of that war. We have come to dedicate a portion of that field as a final resting place for those who here gave their lives that that nation might live. It is altogether fitting and proper that we should do this. But, in a larger sense, we cannot dedicate, we cannot consecrate, we cannot hallow this ground. The brave men, living and dead, who struggled here have consecrated it, far above our poor power to add or detract. The world will little note, nor long remember, what we say here, but it can never forget what they did here. It is for us the living, rather, to be dedicated here to the unfinished work which they who fought here have thus far so nobly advanced. It is rather for us to be here dedicated to the great task remaining before us, that from these honored dead we take increased devotion to that cause for which they gave the last full measure of devotion, that we here highly resolve that these dead shall not have died in vain, that this nation, under God, shall have a new birth of freedom, and that government of the people, by the people, for the people, shall not perish from the earth.`;

/** Population: one entry per word, with its display token and letter-length. */
const WORDS = GETTYSBURG.split(/\s+/).map((tok, i) => ({
  i,
  token: tok,
  len: tok.replace(/[^A-Za-z]/g, '').length,
}));
const POP_MEAN = mean(WORDS.map(w => w.len)); // ≈ 4.295

// ─── DOM ───
const passageEl = document.getElementById('passage');
const sizeInput = /** @type {HTMLInputElement} */ (document.getElementById('sample-size'));
const addByeyeBtn = /** @type {HTMLButtonElement} */ (document.getElementById('add-byeye'));
const addRandomBtn = /** @type {HTMLButtonElement} */ (document.getElementById('add-random'));
const simByeyeBtn = /** @type {HTMLButtonElement} */ (document.getElementById('sim-byeye'));
const simRandomBtn = /** @type {HTMLButtonElement} */ (document.getElementById('sim-random'));
const resetBtn = /** @type {HTMLButtonElement} */ (document.getElementById('reset-btn'));
const pickCountEl = document.getElementById('pick-count');
const pickTargetEl = document.getElementById('pick-target');
const randTargetEl = document.getElementById('rand-target');
const byeyeStatEl = document.getElementById('byeye-stat');
const randomStatEl = document.getElementById('random-stat');
const resultDiv = document.getElementById('result-summary');

// ─── State ───
let n = 10;
/** @type {Set<number>} */
const picked = new Set();
/** @type {number[]} */ let byeyeMeans = [];
/** @type {number[]} */ let randomMeans = [];
const rng = createRng('gettysburg');
// Shared x domain so both charts compare directly (sample means of 2–25 word lengths).
const DOMAIN = /** @type {[number,number]} */ ([2, 7.5]);

// ─── Passage rendering (clickable words) ───
function renderPassage() {
  if (!passageEl) return;
  passageEl.innerHTML = '';
  for (const w of WORDS) {
    const span = document.createElement('span');
    span.className = 'gw';
    span.textContent = w.token;
    span.dataset.i = String(w.i);
    span.setAttribute('role', 'button');
    span.setAttribute('tabindex', '0');
    span.setAttribute('aria-label', `${w.token}, ${w.len} letters`);
    span.addEventListener('click', () => togglePick(w.i, span));
    span.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePick(w.i, span); }
    });
    passageEl.appendChild(span);
    passageEl.appendChild(document.createTextNode(' '));
  }
}

/** @param {number} i @param {HTMLElement} span */
function togglePick(i, span) {
  if (picked.has(i)) {
    picked.delete(i);
    span.classList.remove('picked');
  } else if (picked.size < n) {
    picked.add(i);
    span.classList.add('picked');
  } else {
    announce(`You already picked ${n} words. Deselect one first, or add this sample.`);
    return;
  }
  updatePickUI();
}

function updatePickUI() {
  if (pickCountEl) pickCountEl.textContent = String(picked.size);
  if (addByeyeBtn) addByeyeBtn.disabled = picked.size !== n;
}

function clearPicks() {
  picked.clear();
  passageEl?.querySelectorAll('.gw.picked').forEach(el => el.classList.remove('picked'));
  updatePickUI();
}

// ─── Sampling ───
/** Uniform random sample of n distinct word indices. */
function randomSample() {
  const idx = [];
  const pool = WORDS.map(w => w.i);
  for (let k = 0; k < n && pool.length; k++) {
    const j = Math.floor(rng() * pool.length);
    idx.push(pool[j]);
    pool.splice(j, 1);
  }
  return idx;
}

/** Biased sample: pick longer/"important" words more often (weight ∝ len^2). */
function biasedSample() {
  const idx = [];
  const pool = WORDS.slice();
  for (let k = 0; k < n && pool.length; k++) {
    const weights = pool.map(w => w.len * w.len);
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rng() * total;
    let j = 0;
    while (j < pool.length - 1 && (r -= weights[j]) > 0) j++;
    idx.push(pool[j].i);
    pool.splice(j, 1);
  }
  return idx;
}

const meanLen = (/** @type {number[]} */ idx) => mean(idx.map(i => WORDS[i].len));

// ─── Actions ───
function addByeye() {
  if (picked.size !== n) return;
  byeyeMeans.push(meanLen([...picked]));
  clearPicks();
  render();
  announce(`Added your by-eye sample. ${byeyeMeans.length} by-eye samples so far.`);
}

function addRandom() {
  const idx = randomSample();
  // briefly highlight the random words in the passage
  passageEl?.querySelectorAll('.gw.rand').forEach(el => el.classList.remove('rand'));
  for (const i of idx) passageEl?.querySelector(`.gw[data-i="${i}"]`)?.classList.add('rand');
  setTimeout(() => passageEl?.querySelectorAll('.gw.rand').forEach(el => el.classList.remove('rand')), 1500);
  randomMeans.push(meanLen(idx));
  render();
  announce(`Took a random sample of ${n}. ${randomMeans.length} random samples so far.`);
}

function simulate(kind, count) {
  for (let k = 0; k < count; k++) {
    const idx = kind === 'byeye' ? biasedSample() : randomSample();
    (kind === 'byeye' ? byeyeMeans : randomMeans).push(meanLen(idx));
  }
  render();
  announce(`Simulated ${count} ${kind} samples.`);
}

// ─── Rendering ───
function panelStat(/** @type {number[]} */ vals) {
  if (vals.length === 0) return '';
  const m = mean(vals);
  const off = m - POP_MEAN;
  const dir = off > 0.05 ? 'above' : off < -0.05 ? 'below' : 'right on';
  return `${vals.length} samples · mean of sample means = <strong>${m.toFixed(2)}</strong> (${dir} μ = ${POP_MEAN.toFixed(2)})`;
}

function renderChart(containerId, vals, fill) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '';
  if (vals.length === 0) return;
  drawDotplot(el, vals, {
    id: containerId,
    xLabel: 'Sample mean word length',
    titleText: '',
    observedStat: POP_MEAN,
    observedLabel: 'μ',
    animate: false,
    domain: DOMAIN,
    fillColor: fill,
    viewHeight: 200,
    showExport: false,
  });
}

function render() {
  renderChart('byeye-chart', byeyeMeans, '#C08700');
  renderChart('random-chart', randomMeans, '#0072B2');
  if (byeyeStatEl) byeyeStatEl.innerHTML = panelStat(byeyeMeans);
  if (randomStatEl) randomStatEl.innerHTML = panelStat(randomMeans);
  displayInterpretation();
}

function displayInterpretation() {
  if (!resultDiv) return;
  if (byeyeMeans.length === 0 && randomMeans.length === 0) {
    resultDiv.innerHTML = '<p class="placeholder">Add a by-eye sample and a random sample to compare them.</p>';
    return;
  }
  const bm = byeyeMeans.length ? mean(byeyeMeans) : null;
  const rm = randomMeans.length ? mean(randomMeans) : null;
  let html = `<p><strong>True mean word length: μ = ${POP_MEAN.toFixed(2)} letters</strong> (all 268 words).</p>`;
  if (bm !== null) html += `<p>Your <span class="byeye-accent">by-eye</span> samples average <strong>${bm.toFixed(2)}</strong> — ${bm > POP_MEAN ? `<strong>${(bm - POP_MEAN).toFixed(2)} letters too high</strong>. People reach for longer, memorable words, so the sample is biased.` : 'close to the truth this time — but with more samples the upward bias usually shows.'}</p>`;
  if (rm !== null) html += `<p>Your <span class="rand-accent">random</span> samples average <strong>${rm.toFixed(2)}</strong> — centered on μ. Random selection has no preference for long or short words.</p>`;
  if (byeyeMeans.length >= 20 && randomMeans.length >= 20) {
    html += `<p class="interpretation">Try increasing <i>n</i> and simulating again: the random distribution tightens around μ, but the by-eye distribution tightens around the <em>wrong</em> value. <strong>A bigger sample does not fix sampling bias</strong> — only random selection does.</p>`;
  }
  resultDiv.innerHTML = html;
}

function reset() {
  byeyeMeans = [];
  randomMeans = [];
  clearPicks();
  render();
}

// ─── Wiring ───
function setN(val) {
  n = Math.max(2, Math.min(25, val || 10));
  sizeInput.value = String(n);
  if (pickTargetEl) pickTargetEl.textContent = String(n);
  if (randTargetEl) randTargetEl.textContent = String(n);
  clearPicks();
  // A different n is a different sampling distribution — start fresh.
  byeyeMeans = [];
  randomMeans = [];
  render();
}

sizeInput.addEventListener('change', () => setN(parseInt(sizeInput.value, 10)));
addByeyeBtn.addEventListener('click', addByeye);
addRandomBtn.addEventListener('click', addRandom);
simByeyeBtn.addEventListener('click', () => simulate('byeye', 50));
simRandomBtn.addEventListener('click', () => simulate('random', 50));
resetBtn.addEventListener('click', () => { reset(); announce('Reset.'); });

// ─── Init ───
renderPassage();
setN(10);
