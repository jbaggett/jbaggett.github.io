/**
 * Form controls that need more than markup: an expression field that reports
 * parse errors where they happen, and a slider bound to a live readout.
 *
 * The parser is injected rather than imported, so this module stays free of any
 * one lens's notion of what an expression is.
 */

import { announce } from './page.js';
import { tex } from './tex.js';

/**
 * Echo back what the parser actually read.
 *
 * This is the cheapest correctness tool on the page: a student who types
 * `x^2sin1/x` sees at once that it was read as x²·sin(1)/x, which no error
 * message would have told them, because nothing was wrong — just not what they
 * meant.
 *
 * The preview is NOT a live region. It changes on every keystroke, and a screen
 * reader announcing each intermediate parse would be unusable. It is instead
 * pointed at by the field's `aria-describedby`, so it is read on focus and
 * reachable on demand, and KaTeX's MathML makes it speakable when it is.
 */
function showPreview(el, format, node) {
  if (!el || !format) return;
  if (!node) { el.classList.add('ll-preview-stale'); return; }
  el.classList.remove('ll-preview-stale');
  const latex = format(node);
  el.innerHTML = latex ? tex(latex) : '';
}

/**
 * Wire a text input that holds a function of x.
 *
 * Errors are shown next to the field and spoken, never swallowed: the checklist
 * requires them to be specific and actionable, so the message names what is
 * wrong ("This ( is never closed") rather than "invalid input". The caret
 * position from the parser is used to point at the offending character.
 *
 * @param {{
 *   input: HTMLInputElement,
 *   error: HTMLElement|null,
 *   parse: (src:string) => {node?:any, error?:string, pos?:number},
 *   onChange: (node:any, src:string) => void,
 *   debounce?: number
 * }} opts
 * @returns {{ set:(src:string)=>void, current:()=>any }}
 */
export function initExpressionInput(opts) {
  const {
    input, error, parse, onChange, preview, format, palette, paletteItems, debounce = 220,
  } = opts;
  let timer = null;
  let node = null;

  function run() {
    const src = input.value;
    const result = parse(src);
    if (result.node) {
      node = result.node;
      input.setAttribute('aria-invalid', 'false');
      if (error) { error.textContent = ''; error.hidden = true; }
      showPreview(preview, format, node);
      onChange(node, src);
    } else {
      input.setAttribute('aria-invalid', 'true');
      if (error) {
        const caret = typeof result.pos === 'number' && result.pos < src.length
          ? ` (at "${src[result.pos]}", character ${result.pos + 1})` : '';
        error.textContent = (result.error || 'I could not read that.') + caret;
        error.hidden = false;
      }
      showPreview(preview, format, null);
      announce(result.error || 'Could not read that expression.');
    }
  }

  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, debounce); });
  input.addEventListener('change', () => { clearTimeout(timer); run(); });
  if (palette) initPalette(palette, input, run, paletteItems);
  run();

  return {
    set(src) { input.value = src; clearTimeout(timer); run(); },
    current() { return node; },
  };
}

/**
 * The default symbol palette.
 *
 * Deliberately small. It is a shortcut for the handful of forms whose ASCII
 * spelling is not guessable, NOT a substitute for learning the syntax —
 * MyOpenMath, WeBWorK and Desmos all take the same ASCII, so the typing is a
 * transferable skill and hiding it behind buttons would work against the
 * homework.
 *
 * `insert` ending in "(" gets its closing bracket added with the caret placed
 * between, which is where the next keystroke wants to go.
 */
export const DEFAULT_PALETTE = [
  { tex: '\\sqrt{\\square}', insert: 'sqrt(', label: 'square root' },
  { tex: '\\square^{\\square}', insert: '^', label: 'to the power of' },
  { tex: '\\frac{\\square}{\\square}', insert: '/', label: 'divided by' },
  { tex: '\\pi', insert: 'pi', label: 'pi' },
  { tex: 'e^{\\square}', insert: 'e^', label: 'e to the power of' },
  { tex: '\\sin', insert: 'sin(', label: 'sine' },
  { tex: '\\cos', insert: 'cos(', label: 'cosine' },
  { tex: '\\ln', insert: 'ln(', label: 'natural log' },
  { tex: '\\left|\\square\\right|', insert: 'abs(', label: 'absolute value' },
];

/**
 * Fill a container with palette buttons that insert at the caret.
 *
 * Focus returns to the field after every insert: a palette that steals focus
 * makes keyboard users tab back and forth for each symbol, which is slower than
 * typing the ASCII they were trying to avoid.
 */
export function initPalette(container, input, onInsert, items = DEFAULT_PALETTE) {
  if (!container || !input) return;
  container.setAttribute('role', 'group');
  if (!container.hasAttribute('aria-label')) {
    container.setAttribute('aria-label', 'Insert a symbol');
  }
  for (const item of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'll-palette-btn';
    // The visible glyph is typeset; the accessible name is the plain English
    // one, because "square root" reads better than the MathML for a lone radical.
    b.innerHTML = tex(item.tex);
    b.setAttribute('aria-label', item.label);
    b.title = item.label;
    b.addEventListener('click', () => {
      insertAtCaret(input, item.insert);
      onInsert();
    });
    container.appendChild(b);
  }
}

/** Insert text at the caret, closing a trailing bracket and landing inside it. */
export function insertAtCaret(input, text) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const selected = input.value.slice(start, end);
  let insert = text;
  let caret = start + text.length;
  if (text.endsWith('(')) {
    insert = text + selected + ')';
    caret = start + text.length + selected.length;
  }
  input.value = input.value.slice(0, start) + insert + input.value.slice(end);
  input.focus();
  input.setSelectionRange(caret, caret);
}

/**
 * Make a range input keyboard- and touch-friendly and keep a readout in sync.
 * @param {{input:HTMLInputElement, output:HTMLElement|null, format?:(v:number)=>string, onInput:(v:number)=>void}} opts
 */
export function initSlider(opts) {
  const { input, output, format = String, onInput } = opts;
  const sync = () => {
    const v = Number(input.value);
    if (output) output.textContent = format(v);
    onInput(v);
  };
  input.addEventListener('input', sync);
  sync();
  return { set: (/** @type {number} */ v) => { input.value = String(v); sync(); } };
}
