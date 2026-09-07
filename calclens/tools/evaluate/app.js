/**
 * Function Evaluator — a calculator replacement for numerical investigation.
 *
 * The requirement behind the requirement is that students do not reliably bring
 * a calculator, so this has to work on the device they do bring: a phone,
 * usually opened from a QR code. That drives the layout and the share button
 * more than anything pedagogical does.
 *
 * Three decisions worth stating, because the obvious implementation gets each
 * of them wrong:
 *
 *   1. UNDEFINED IS AN ANSWER, and it keeps its row. The sections that need
 *      this tool most are exactly the ones about points where the function has
 *      no value: (x²−1)/(x−1) at x = 1 is the §2.2 worked example, and the whole
 *      lesson is that we cannot plug in but can look nearby. A skipped row, or
 *      a row reading NaN, erases the observation the table exists to make.
 *
 *   2. "RANGE AND SPACING" DOES NOT PRODUCE A LIMIT TABLE. The table a limit
 *      wants is 0.9, 0.99, 0.999 │ 1.001, 1.01, 1.1 — geometric, from both
 *      sides, with the point itself in the middle. A linear grid never lands
 *      near enough. Hence Approach, which is the default mode.
 *
 *   3. DECIMAL PLACES ARE THE READER'S. Full float precision makes a projected
 *      table unreadable and a handwritten one impossible; too few digits hides
 *      the convergence the table is for. Four is the default because that is
 *      what the worksheets ask for.
 *
 * The variable follows the expression, as in the secant tool: write
 * -16t^2+32t+48 and the columns label themselves t.
 */

import { initPage, announce } from 'kit/page.js';
import { getParams, updateUrl } from 'kit/url.js';
import { tex, setTex } from 'kit/tex.js';
import { initExpressionInput } from 'kit/input.js';
import { fmt } from 'kit/format.js';
import { initShare } from 'kit/share.js';
import { MARK } from '../../js/mark.js';
import { tryParse, compile, toLatex, freeVariables } from '../../js/expr.js';

const $ = (/** @type {string} */ s) => /** @type {any} */ (document.querySelector(s));

/** Named starting states, for short links. See docs/url-api.md. */
const PRESETS = {
  limit: { f: '(x^2 - 1)/(x - 1)', x: '~1' },
  ball: { f: '-16t^2 + 32t + 48', x: '0:2:0.25' },
  endbehaviour: { f: '(3x^2 + 1)/(x^2 - 4)', x: '10,100,1000,10000' },
};

const MODES = ['approach', 'list', 'range', 'single'];

const state = {
  node: null,
  /** @type {(x:number)=>number} */ f: () => NaN,
  v: 'x',
  mode: 'approach',
  dp: 4,
};

/* ─────────────────────────── choosing the values ───────────────────────── */

const num = (/** @type {string} */ s) => {
  const t = String(s).trim();
  if (!t) return NaN;
  // Accept a typed fraction — "1/3" is what a student writes for a value.
  const m = t.match(/^(-?[\d.]+)\s*\/\s*(-?[\d.]+)$/);
  const v = m ? Number(m[1]) / Number(m[2]) : Number(t);
  return Number.isFinite(v) ? v : NaN;
};

/**
 * The x-values for the current mode, plus a caption describing them.
 * @returns {{values:number[], marked:number|null, caption:string, error:string|null}}
 */
function chooseValues() {
  const v = state.v;
  if (state.mode === 'single') {
    const x = num($('#sg-val').value);
    if (Number.isNaN(x)) return { values: [], marked: null, caption: '', error: 'Enter a number to evaluate at.' };
    return { values: [x], marked: null, caption: `One value of ${v}`, error: null };
  }

  if (state.mode === 'list') {
    const parts = $('#li-vals').value.split(',').map(s => s.trim()).filter(Boolean);
    const values = parts.map(num);
    const bad = parts.find((_, i) => Number.isNaN(values[i]));
    if (bad !== undefined) return { values: [], marked: null, caption: '', error: `"${bad}" is not a number.` };
    if (!values.length) return { values: [], marked: null, caption: '', error: 'List at least one value.' };
    return { values, marked: null, caption: `${values.length} values of ${v}`, error: null };
  }

  if (state.mode === 'range') {
    const from = num($('#rg-from').value), to = num($('#rg-to').value), step = num($('#rg-step').value);
    if ([from, to, step].some(Number.isNaN)) return { values: [], marked: null, caption: '', error: 'From, to and step must all be numbers.' };
    if (step === 0) return { values: [], marked: null, caption: '', error: 'The step cannot be zero.' };
    if ((to - from) / step < 0) return { values: [], marked: null, caption: '', error: 'The step runs away from "to" — check its sign.' };
    const n = Math.floor((to - from) / step + 1e-9);
    if (n > 400) return { values: [], marked: null, caption: '', error: `That is ${n + 1} rows. Use a bigger step, or a shorter range.` };
    const values = [];
    for (let i = 0; i <= n; i++) values.push(from + i * step);
    return { values, marked: null, caption: `${v} from ${fmt(from, 4)} to ${fmt(to, 4)} in steps of ${fmt(step, 4)}`, error: null };
  }

  // approach — the shape a limit table wants
  const a = num($('#ap-a').value);
  if (Number.isNaN(a)) return { values: [], marked: null, caption: '', error: 'Enter the number to close in on.' };
  const steps = Number($('#ap-steps').value) || 3;
  const values = [];
  for (let k = 1; k <= steps; k++) values.push(a - Math.pow(10, -k));   // 0.9, 0.99, 0.999
  values.push(a);                                                       // the point itself
  for (let k = steps; k >= 1; k--) values.push(a + Math.pow(10, -k));   // 1.001, 1.01, 1.1
  return {
    values, marked: a,
    caption: `Closing in on ${v} = ${fmt(a, 6)} from both sides`,
    error: null,
  };
}

/** Serialise the current value spec into the single `x` parameter. */
function valueSpec() {
  if (state.mode === 'single') return $('#sg-val').value.trim();
  if (state.mode === 'list') return $('#li-vals').value.replace(/\s+/g, '');
  if (state.mode === 'range') return `${$('#rg-from').value.trim()}:${$('#rg-to').value.trim()}:${$('#rg-step').value.trim()}`;
  return `~${$('#ap-a').value.trim()}`;
}

/** Read an `x` parameter back into the right mode and fields. */
function applySpec(spec) {
  if (!spec) return;
  const t = spec.trim();
  if (t.startsWith('~')) { setMode('approach'); $('#ap-a').value = t.slice(1); return; }
  if (t.includes(':')) {
    const [a, b, c] = t.split(':');
    setMode('range');
    $('#rg-from').value = a; $('#rg-to').value = b; if (c) $('#rg-step').value = c;
    return;
  }
  if (t.includes(',')) { setMode('list'); $('#li-vals').value = t; return; }
  setMode('single'); $('#sg-val').value = t;
}

/* ────────────────────────────── the table ──────────────────────────────── */

/**
 * Format a value for the table.
 *
 * `undefined` covers both NaN (0/0 at a removable hole) and ±Infinity (division
 * by zero): in both cases the function genuinely has no value there, and one
 * honest word beats two kinds of technical noise on a phone screen.
 */
function formatValue(y, dp) {
  if (!Number.isFinite(y)) return { text: 'undefined', undef: true };
  const mag = Math.abs(y);
  // Fixed decimals are unreadable past a certain size, and hide everything
  // below a certain smallness.
  if (mag !== 0 && (mag >= 1e7 || mag < Math.pow(10, -dp) / 2)) {
    return { text: y.toExponential(Math.min(dp, 6)), undef: false };
  }
  return { text: fmt(y, dp), undef: false };
}

function render() {
  const { values, marked, caption, error } = chooseValues();
  const err = $('#vals-error');
  if (error) { err.textContent = error; err.hidden = false; } else { err.hidden = true; }

  const v = state.v;
  $('#col-x').innerHTML = `<i>${v}</i>`;
  $('#col-fx').innerHTML = `<i>f</i>(<i>${v}</i>)`;
  document.querySelectorAll('.varname').forEach(el => { el.textContent = v; });

  let anyUndef = false;
  const rows = values.map(x => {
    const cell = formatValue(state.f(x), state.dp);
    if (cell.undef) anyUndef = true;
    const isMark = marked !== null && Math.abs(x - marked) < 1e-12;
    return `<tr${isMark ? ' class="ll-row-current"' : ''}>`
      + `<td>${formatX(x)}</td>`
      + `<td${cell.undef ? ' class="ll-undef"' : ''}>${cell.text}</td></tr>`;
  });

  $('#tbl-body').innerHTML = rows.join('');
  $('#tbl-caption').textContent = error ? '' : caption;
  $('#undef-note').hidden = !anyUndef;

  if (!error) {
    updateUrl({ x: valueSpec(), decimals: state.dp === 4 ? null : state.dp });
    announce(`${values.length} value${values.length === 1 ? '' : 's'} shown.`);
  }
}

/**
 * Show a chosen x exactly as chosen.
 *
 * The decimal-places setting governs the OUTPUT column only. Padding the input
 * column to it turns 0.9 into 0.9000 and, worse, would round 0.9999 to 1.0000 —
 * making a limit table appear to reach the very point it is approaching. The
 * `toPrecision(12)` strips float noise first, so a 0.25 step does not produce
 * 0.30000000000000004.
 */
function formatX(x) {
  if (!Number.isFinite(x)) return '—';
  return String(Number(x.toPrecision(12)));
}

/* ────────────────────────────────── modes ──────────────────────────────── */

function setMode(mode) {
  if (!MODES.includes(mode)) return;
  state.mode = mode;
  for (const m of MODES) {
    $(`#mode-${m}`).hidden = m !== mode;
    const btn = document.querySelector(`.mode-btn[data-mode="${m}"]`);
    if (btn) btn.setAttribute('aria-pressed', String(m === mode));
  }
}

/* ────────────────────────────────── boot ───────────────────────────────── */

initPage({
  onReady() {
    initShare({ mark: MARK });
    const q = getParams(PRESETS).raw;

    setTex($('#t1'), '\\frac{x^2-1}{x-1}');
    setTex($('#t2'), 's(t) = -16t^2 + 32t + 48');

    if (q.get('f')) $('#fn-input').value = q.get('f');
    // `decimals` is StatLens's frozen spelling for the same idea.
    if (q.get('decimals')) {
      const d = Number(q.get('decimals'));
      if (Number.isFinite(d) && d >= 0 && d <= 10) { state.dp = d; $('#dp-input').value = String(d); }
    }
    applySpec(q.get('x'));

    initExpressionInput({
      input: $('#fn-input'),
      error: $('#fn-error'),
      parse: tryParse,
      preview: $('#fn-preview'),
      format: toLatex,
      palette: $('#fn-palette'),
      onChange(node, src) {
        const vars = [...freeVariables(node)];
        state.v = vars.length === 1 ? vars[0] : (vars.includes('x') ? 'x' : (vars[0] || 'x'));
        state.node = node;
        state.f = compile(node, state.v);
        updateUrl({ f: src });
        render();
      },
    });

    document.querySelectorAll('.mode-btn').forEach(b => b.addEventListener('click', () => {
      setMode(/** @type {HTMLElement} */ (b).dataset.mode);
      render();
    }));

    for (const sel of ['#ap-a', '#ap-steps', '#li-vals', '#rg-from', '#rg-to', '#rg-step', '#sg-val']) {
      $(sel).addEventListener('input', render);
      $(sel).addEventListener('change', render);
    }
    $('#dp-input').addEventListener('input', () => {
      const d = Number($('#dp-input').value);
      if (Number.isFinite(d) && d >= 0 && d <= 10) { state.dp = d; render(); }
    });

    render();
  },
});
