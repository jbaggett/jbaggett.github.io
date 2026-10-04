// @ts-check
/**
 * Which columns the tool is about — asked once, in one place.
 *
 * Every page that takes a file has needed this, and every page that has it
 * grew its own: 21 modules build their own `<select>`s, name their own ids
 * (`group-var-select`, `quant-var-select`, `sim-var-select`, `var-select`),
 * and write their own "only show it when there is a choice" rule. The four
 * two-group SIMULATE pages never grew one at all, and so took the first
 * categorical column and the first numeric column in file order. Pasted a
 * class survey —
 *
 *     id,sex,exercise_hours,housing,commute_min
 *
 * — `randomization-diff-means` grouped by `sex` and analysed **`id`**: Female
 * x̄ = 4.00, Male x̄ = 5.00, a confident answer about the row numbers, with no
 * warning and no way to correct it. (Melissa, via the review batch; measured
 * 2026-10-03.)
 *
 * So this is the picker itself, not a page's copy of one. A page declares the
 * SHAPE it needs — "a numeric response and a grouping variable with two
 * levels" — and gets back the columns, plus the control that lets a reader
 * change them. `initDataPanel` injects it, which is the same move the Open URL
 * row made: put it in the shared data layer and 37 pages have it at once.
 *
 * Bundled datasets are deliberately NOT routed through this. They are curated,
 * they carry their own `variables` metadata with an inference type, and the
 * pages already read them correctly. This is for data the tool has never seen.
 */

/** @typedef {'numeric'|'categorical'} VarKind */
/**
 * @typedef {object} Slot
 * @property {string} key      - name in the returned pick, e.g. `response`
 * @property {string} label    - what the reader sees, e.g. "Response (numeric)"
 * @property {VarKind} kind
 * @property {number} [levels] - a categorical must have exactly this many
 * @property {number} [minPerLevel] - …and at least this many rows in each
 */
/** @typedef {{headers: string[], types: string[], data: Array<Record<string, any>>}} Parsed */

/** Distinct values of a column, in first-seen order. */
function levelsOf(/** @type {Parsed} */ parsed, /** @type {string} */ col) {
  const seen = [];
  const set = new Set();
  for (const row of parsed.data) {
    const v = String(row[col]);
    if (!set.has(v)) { set.add(v); seen.push(v); }
  }
  return seen;
}

/**
 * Is this column a row label rather than a measurement?
 *
 * The case that matters is the one that broke: a numeric column of distinct
 * integers running 1, 2, 3… — `id`, `subject`, `obs`, the index a spreadsheet
 * adds without being asked. Analysing it produces a mean, a difference and a
 * p-value, all of them about nothing.
 *
 * Deliberately narrow, because a false positive silently hides a column the
 * reader wanted. A measurement that happens to be all-distinct (heights to one
 * decimal, say) must not be refused, so the pattern rule asks for all five:
 * every value distinct, every value a whole number, the whole column a
 * consecutive run, that run STARTING AT 0 OR 1, and at least five rows to see
 * it in. The start matters — `1, 2, 3…` is an index and `7, 8, 9` is data —
 * and so does the length: three rows reading 1, 3, 2 are a consecutive run by
 * arithmetic and a measurement by any other reading. (Caught by its own unit
 * test, which had written exactly that as sample data.)
 *
 * A name that looks like an id is enough on its own, since that is the author
 * telling us, and it catches the short files the pattern rule declines to judge.
 *
 * @param {Parsed} parsed
 * @param {string} col
 * @returns {boolean}
 */
export function looksLikeIdentifier(parsed, col) {
  if (/^(id|ids|index|idx|row|rowid|row_id|no|num|number|obs|observation|subject|case|record|n)$/i
      .test(col.trim())) return true;
  const vals = parsed.data.map(r => Number(r[col]));
  if (vals.length < 5 || vals.some(v => !Number.isFinite(v))) return false;
  if (!vals.every(v => Number.isInteger(v))) return false;
  if (new Set(vals).size !== vals.length) return false;
  const sorted = [...vals].sort((a, b) => a - b);
  if (sorted[0] !== 0 && sorted[0] !== 1) return false;
  return sorted.every((v, i) => i === 0 || v === sorted[i - 1] + 1);
}

/**
 * The columns a slot could be filled with, in file order.
 * @param {Parsed} parsed
 * @param {Slot} slot
 * @returns {string[]}
 */
export function eligibleColumns(parsed, slot) {
  const out = [];
  parsed.headers.forEach((h, i) => {
    if (parsed.types[i] !== slot.kind) return;
    if (slot.kind === 'categorical') {
      const levels = levelsOf(parsed, h);
      if (slot.levels != null && levels.length !== slot.levels) return;
      if (slot.levels == null && levels.length < 2) return;
      if (slot.minPerLevel != null) {
        const counts = new Map();
        for (const row of parsed.data) {
          const v = String(row[h]);
          counts.set(v, (counts.get(v) ?? 0) + 1);
        }
        if ([...counts.values()].some(c => c < slot.minPerLevel)) return;
      }
    }
    out.push(h);
  });
  return out;
}

/**
 * What to pick before anyone has chosen: the first eligible column per slot,
 * skipping row labels and anything another slot has already taken.
 *
 * A slot is filled with an identifier only when nothing else is eligible —
 * refusing to load at all would be worse than loading the one column there is,
 * and the control is on screen to correct it.
 *
 * @param {Parsed} parsed
 * @param {Slot[]} slots
 * @returns {Record<string, string>} slot key → column name (missing if none fits)
 */
export function defaultPick(parsed, slots) {
  /** @type {Record<string, string>} */
  const pick = {};
  const taken = new Set();
  for (const slot of slots) {
    const eligible = eligibleColumns(parsed, slot).filter(c => !taken.has(c));
    const real = eligible.filter(c => !looksLikeIdentifier(parsed, c));
    const chosen = real[0] ?? eligible[0];
    if (chosen) { pick[slot.key] = chosen; taken.add(chosen); }
  }
  return pick;
}

/** Whether a reader has any choice to make — one option everywhere is not one. */
export function hasChoice(/** @type {Parsed} */ parsed, /** @type {Slot[]} */ slots) {
  return slots.some(slot => eligibleColumns(parsed, slot).length > 1);
}

/**
 * The control itself.
 *
 * Shown only when there is something to choose, which is the rule every
 * hand-rolled copy already had — a dropdown with one option in it is furniture.
 *
 * @param {object} opts
 * @param {HTMLElement} opts.host     - where the control lives (the data panel)
 * @param {Slot[]} opts.slots
 * @param {(pick: Record<string, string>) => void} opts.onChange
 * @returns {{ update(parsed: Parsed|null): Record<string, string>, pick(): Record<string, string>, clear(): void }}
 */
export function createVariablePicker({ host, slots, onChange }) {
  /** @type {Parsed|null} */
  let current = null;
  /** @type {Record<string, string>} */
  let pick = {};

  const wrap = document.createElement('div');
  // `var-selector-row` is the shared look the hand-rolled pickers already use —
  // one row of label+select pairs — so this one is not a new visual language.
  wrap.className = 'data-var-picker var-selector-row';
  wrap.hidden = true;
  host.appendChild(wrap);

  wrap.addEventListener('change', (e) => {
    const sel = /** @type {HTMLSelectElement} */ (e.target);
    if (!sel.dataset.slot) return;
    pick = { ...pick, [sel.dataset.slot]: sel.value };
    // Two slots may not hold the same column: a page asking for a response and
    // a grouping variable is asking about the relationship BETWEEN two things.
    for (const other of wrap.querySelectorAll('select')) {
      const key = /** @type {HTMLSelectElement} */ (other).dataset.slot;
      if (!key || other === sel || pick[key] !== sel.value) continue;
      const slot = slots.find(s => s.key === key);
      const alt = current && slot
        ? eligibleColumns(current, slot).find(c => c !== sel.value) : null;
      if (alt) { pick[key] = alt; /** @type {HTMLSelectElement} */ (other).value = alt; }
    }
    onChange(pick);
  });

  return {
    update(parsed) {
      current = parsed;
      if (!parsed) { wrap.hidden = true; wrap.innerHTML = ''; pick = {}; return pick; }
      pick = defaultPick(parsed, slots);
      if (!hasChoice(parsed, slots)) { wrap.hidden = true; wrap.innerHTML = ''; return pick; }
      wrap.innerHTML = slots.map(slot => {
        const cols = eligibleColumns(parsed, slot);
        if (!cols.length) return '';
        const id = `var-pick-${slot.key}`;
        const opts = cols.map(c =>
          `<option value="${c.replace(/"/g, '&quot;')}"${c === pick[slot.key] ? ' selected' : ''}>${c}</option>`
        ).join('');
        return `<label for="${id}">${slot.label}`
          + `<select id="${id}" data-slot="${slot.key}">${opts}</select></label>`;
      }).join('');
      wrap.hidden = false;
      return pick;
    },
    pick: () => pick,
    clear() { wrap.hidden = true; wrap.innerHTML = ''; pick = {}; current = null; },
  };
}
