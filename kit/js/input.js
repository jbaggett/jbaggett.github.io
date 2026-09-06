/**
 * Form controls that need more than markup: an expression field that reports
 * parse errors where they happen, and a slider bound to a live readout.
 *
 * The parser is injected rather than imported, so this module stays free of any
 * one lens's notion of what an expression is.
 */

import { announce } from './page.js';

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
  const { input, error, parse, onChange, debounce = 220 } = opts;
  let timer = null;
  let node = null;

  function run() {
    const src = input.value;
    const result = parse(src);
    if (result.node) {
      node = result.node;
      input.setAttribute('aria-invalid', 'false');
      if (error) { error.textContent = ''; error.hidden = true; }
      onChange(node, src);
    } else {
      input.setAttribute('aria-invalid', 'true');
      if (error) {
        const caret = typeof result.pos === 'number' && result.pos < src.length
          ? ` (at "${src[result.pos]}", character ${result.pos + 1})` : '';
        error.textContent = (result.error || 'I could not read that.') + caret;
        error.hidden = false;
      }
      announce(result.error || 'Could not read that expression.');
    }
  }

  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, debounce); });
  input.addEventListener('change', () => { clearTimeout(timer); run(); });
  run();

  return {
    set(src) { input.value = src; clearTimeout(timer); run(); },
    current() { return node; },
  };
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
