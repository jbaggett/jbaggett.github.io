# Activity Authoring Guide

> **For both agents**: This document is the shared reference for creating StatLens activities. Either agent (StatLens or Textbook) can author activities. Both repos have read access to both directories.

## What is an Activity?

A JSON file that loads a step-by-step instruction panel alongside any StatLens tool page. Students see the tool at full viewport with a side panel (desktop) or bottom sheet (mobile) guiding them through a sequence of actions and observations.

## Activity JSON Schema

```json
{
  "title": "Activity Title",
  "tool": "simulate/bootstrap-mean",
  "params": {
    "dataset": "penny_ages",
    "ci": 95,
    "seed": "ch8demo"
  },
  "steps": [
    {
      "instruction": "What the student should do",
      "observe": "What to watch for (optional)",
      "reveal": "Explanation shown after clicking 'Show explanation' (optional)"
    }
  ]
}
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `title` | Yes | Activity name shown in the panel header |
| `tool` | No | Tool path (for documentation/indexing; the URL determines the actual tool) |
| `params` | No | Default URL parameters injected when the activity loads. Existing URL params override these. Use this for `dataset`, `seed`, `ci`, `direction`, etc. |
| `chooseData` | No | `true` keeps the tool's data panel visible so the student can **load their own dataset**. Activity mode hides the data panel by default (it assumes the dataset comes from `params.dataset`). If your activity has no `params.dataset` and asks the student to pick a dataset on a data-driven tool (ANOVA, chi-square, paired, slope, two-means), you **must** set `"chooseData": true` — otherwise the variable selectors never populate and the student is stuck. |
| `steps` | Yes | Array of step objects (at least 1) |
| `steps[].instruction` | Yes | Action prompt — what the student should do. Supports inline markdown. |
| `steps[].observe` | No | Observation prompt — what to watch for. Rendered in a distinct callout style. |
| `steps[].reveal` | No | Explanation — hidden by default, shown when student clicks "Show explanation". |
| `steps[].gate` | No | A question the student must answer before "Next" unlocks (discovery mode). See **Gates** below. |
| `steps[].requires` | No | An **action-gate**: "Next" stays locked until the student actually does something in the tool (drew ≥ N samples, set n, pressed Freeze). See **Live tool state** below. |
| `steps[].respond` | No | **Free-text response fields** the student types into (Predict / Explain). Persist locally. See **Response capture** below. |
| `steps[].phase` | No | `"predict"` / `"do"` / `"explain"` — renders a colored badge + progress-strip node so the Predict → Do → Explain arc is visible in the tool. See **Phase badges** below. |
| `steps[].demo` | No | A named animated illustration the student can open in a popup. See **Demos** below. |

### Gates (predict-and-commit questions)

A `gate` blocks the **Next** button until the student commits to an answer. Two flavors,
chosen automatically from the schema:

- **Check gate** — at least one choice has `"correct": true`. The student retries until
  they pick a correct choice (incorrect picks show `retryFeedback` or the choice's own
  `feedback`). Use for comprehension checks where there is a right answer.
- **Prediction gate** — *no* choice is marked correct. Any committed answer unlocks the
  step. Use before running a simulation: committing to a prediction (and then watching it
  confirmed or contradicted) is what produces learning — the research is unambiguous that
  watching simulations without committing first doesn't move misconceptions. Don't grade
  predictions; let the tool deliver the verdict.

```json
{
  "instruction": "Before you click anything, commit to a prediction.",
  "gate": {
    "question": "How big do you expect one shuffled difference to be?",
    "choices": [
      { "text": "Around 29 points, like the observed difference" },
      { "text": "Usually small, near 0" },
      { "text": "Exactly 0 every time", "feedback": "Committed — now run it and watch whether chance gives *exactly* zero." }
    ],
    "feedback": "You've committed — now click **+1** and see."
  }
}
```

| Gate field | Required | Description |
|------------|----------|-------------|
| `question` | Yes | The question text (inline markdown) |
| `choices` | Yes | 2–4 choices: `{ text, correct?, feedback? }` |
| `choices[].correct` | No | Marks a right answer → check gate. Omit everywhere → prediction gate. |
| `choices[].feedback` | No | Per-choice feedback, overrides the gate-level fields |
| `feedback` | No | Shown after a passing commit |
| `retryFeedback` | No | Shown after an incorrect pick (check gates only; default "Not quite — try again.") |

**Modes:** in presentation mode (`?mode=present` or the instructor's saved setting),
gates never block — they render as an "Ask your class" discussion prompt listing the
choices. Author gates so they read well both ways.

**Mobile layout:** the panel is a bottom sheet with three states — *full* (reading,
tool dimmed), *peek* (collapsed to a "tap to expand" bar so the tool is fully visible
and interactive), and *hidden* (a floating button). Students tap the grab-bar handle or
the dimmed area to collapse to peek, then act on the tool, then tap to expand again.
You don't author this — just be aware that steps which say "click **+1**" work because
the student can peek the panel aside to reach the controls.

**Reacting to live results:** gates can now read live tool state on tools that emit
it (see **Live tool state** below) — you can require the student to actually draw
before continuing, and quote the real on-screen value back to them. On tools that
*don't* emit state, set a `seed` in `params` so every student sees the same outcome
and phrase the gate robustly. Working examples: `activities/randomization-test-gated.json`
(seed-based) and `activities/sampling-distribution-proportion.json` (live-state).

### Response capture (free-text Predict / Explain)

A `respond` block puts one or more labeled **textareas** on a step, so the student
types their own answer (a prediction, a reflection) instead of only picking a
choice. This is the tool half of the textbook's Predict → Do → Explain split: the
`.statlens` box keeps the *prompt* prose (print, offline, lecture), and the typed
*answer* lives here — which is what makes it work for e-book, rental, and library
copies where the student can't write in the book.

```json
{
  "instruction": "Predict where the sampling distribution will be centered, how spread out, and what shape.",
  "respond": {
    "prompts": [
      { "id": "center", "label": "Center", "placeholder": "e.g. around 0.10", "rows": 1 },
      { "id": "spread", "label": "Spread", "placeholder": "e.g. most within ±0.05", "rows": 1 },
      { "id": "shape",  "label": "Shape",  "placeholder": "e.g. right-skewed", "rows": 2 }
    ],
    "gateOnNonEmpty": true
  }
}
```

| `respond` field | Required | Description |
|---|---|---|
| `prompts` | Yes | Array of fields. Each needs a unique **`id`** (keys the saved answer — keep it stable across edits) and usually a `label`; optional `placeholder` and `rows` (1–6, default 2). |
| `gateOnNonEmpty` | No | `true` → **Next** stays locked until every field has content. Forces predict-*before*-reveal. There is **no correctness check** — we're capturing thinking, not grading it. |
| `answer` | No | A short "what to notice / expert reasoning" note that appears **once every field is filled** (self-study calibration — the student checks their typed prediction against it). Same role as an MC gate's `feedback`, tied to a text field. Still **not grading**. Hidden in presentation mode. Supports Markdown + `{{metric}}`. |

**Persistence & export (automatic — no config):**

- Answers save to `localStorage` on every keystroke, keyed by activity slug + step + field, so they survive reload, tab close, and returning days later on the **same browser/device**.
- Any activity containing a `respond` step shows **Download my responses** (a readable `.md` for the student **and** a machine-readable `.json` sibling) and **Clear** (with a confirm — shared/lab machines). Download is the durable escape hatch for rental / shared / private-mode devices where localStorage won't persist.
- Presentation mode (`?mode=present`) never gates on text and hides the download/clear bar.

**Authoring notes:** keep the *prompt* wording in the textbook `.statlens` box and keep the JSON labels short (`Center`, `Spread`, `Shape`) — the box asks the question, the field just captures the answer. Don't rename an `id` once students may have saved work under it (it orphans their saved response). Free text is never validated for correctness — if you need a right/wrong check, use a `gate` instead (the two can coexist on one step).

### Phase badges (Predict → Do → Explain arc)

Add `"phase": "predict"` / `"do"` / `"explain"` to a step to surface the
pedagogical arc *inside the tool* — a colored badge above the instruction plus a
progress strip at the top of the panel. This closes the coherence loop with the
textbook `.statlens` boxes, which open with "Predict → Do → Explain": a student
who reaches the tool from a Canvas link (skipping the box) still sees the frame.

```json
{ "phase": "predict", "instruction": "…", "gate": { … } }
```

**Discipline: only badge the load-bearing moves** — the anchor **Predict** at the
start and the **Explain** at the end. Leave the middle action steps *without* a
`phase` (they show as neutral dots on the strip). If every step were a "Do" badge
the labels would flatten into noise. (Same discipline as the Rossman/Chance
CATALST curriculum: name the moves, not the plumbing.) The strip only appears when
at least one step has a `phase`, so light walkthroughs stay uncluttered.

Colors: Predict = brand blue, Do = minority orange, Explain = IMS green. (The text
badge uses slightly darkened shades so white label text clears WCAG AA; the strip
dots use the exact brand hues.)

### Demos (animated illustration popups)

A `demo` renders a "▶ …" button in the step; clicking it opens a modal popup that plays
a rich animation, with a **Play again** button. Demos carry the kind of bespoke animation
that JSON steps can't express (card dealing, FLIP transitions) without requiring a
custom page. All demos respect `prefers-reduced-motion` (instant re-render, captions
still update).

```json
{
  "instruction": "You're about to shuffle the labels once...",
  "demo": {
    "type": "card-shuffle",
    "label": "Watch how one shuffle works",
    "options": {
      "group1": "Male", "group2": "Female",
      "n1": 24, "n2": 24, "success1": 21, "success2": 14,
      "successLabel": "Promoted", "failureLabel": "Not promoted"
    }
  }
}
```

| Demo field | Required | Description |
|------------|----------|-------------|
| `type` | Yes | Demo name from the registry below. Unknown types are ignored (the button isn't rendered). |
| `label` | No | Button text (default "Watch a demonstration") |
| `static` | No | `true` → show the demo's initial render only: no auto-play, no Play-again button. Use to *display* something (e.g. the observed data as cards) rather than animate it. |
| `options` | No | Demo-specific configuration |

**Tip — give every step something to see.** Simulation tools render their original-sample
panel and observed statistic only after the first generate click, so early steps that
*describe* the data have nothing on screen to point at. Use a `static` demo to show the
data (cards, etc.) in steps that come before the student's first simulation action, and
phrase `observe` callouts around what the popup shows.

**Available demos** (registry in `js/activity-panel.js`, modules in `js/demos/`):

| Type | What it shows | Options |
|------|---------------|---------|
| `card-shuffle` | Outcomes as cards in two groups; gather → shuffle → deal animation reassigns the same fixed outcomes to random groups, with per-group counts and the difference after each shuffle. Teaches "outcomes are fixed, only labels move." | `group1`, `group2` (labels), `n1`, `n2` (group sizes), `success1`, `success2` (observed successes), `successLabel`, `failureLabel` |

**Adding a new demo** (StatLens repo work, not JSON): create `js/demos/<name>.js`
exporting `mount(container, options) → { play(), destroy() }`, add the name to the
`DEMOS` allowlist in `activity-panel.js`, and document it in the table above. The
allowlist is a security boundary — activity JSON can be hosted anywhere, so it must
never control which module path gets imported.

### Live tool state (action-gates + result-aware feedback)

Some tools broadcast their state as the student works (how many samples drawn, the
current sample size, the live SD of the statistic, …). Two authoring features use it,
turning a passive walkthrough into a **Predict → Do → Observe → Explain** loop.

**1. `requires` — make the student *act* before "Next" unlocks.** Add a `requires`
object to a step; in discovery mode the **Next** button stays disabled (and your
`hint` shows) until a live metric crosses a threshold. In presentation mode it never
blocks (the instructor drives).

```json
{
  "instruction": "Click **+1000** to fill in the sampling distribution.",
  "requires": { "metric": "samples", "atLeast": 500,
                "hint": "Click **+1000** to draw at least 500 samples, then continue." }
}
```

| `requires` field | Required | Description |
|------------------|----------|-------------|
| `metric` | Yes | A metric name the tool emits (see the per-tool table below) |
| `atLeast` / `atMost` / `equals` | Yes (one) | The threshold. Exactly one. |
| `hint` | No | Shown while locked (markdown; can interpolate — see below) |
| `autoAdvance` | No | `true` → advance to the next step automatically once satisfied (and any gate on the step is passed) |

**2. `{{metric}}` — quote the live result back to the student.** Any text field
(`instruction`, `observe`, `reveal`, the gate question, choices, and feedback)
interpolates `{{metricName}}` with the current value. Use it so feedback confronts the
student with what *actually* happened — the verdict the tool delivered, not a canned
number:

```json
"feedback": "Your {{samples}} samples gave an SD of p̂'s of {{statSD}} — very close to the theory value {{theorySE}}."
```

Double braces are required (single `{ }` would collide with LaTeX like `\hat{p}`).
Numbers are rounded to 3 decimals; an unknown metric is left as-is.

**Metrics emitted by `conceptual/sampling-lab/`:**

| Metric | Meaning |
|--------|---------|
| `samples` | Number of statistics drawn so far |
| `n` | Current sample size |
| `frozen` / `frozenN` | Whether a comparison is pinned, and at what n |
| `param` | The truth — μ (means) or p (proportions) |
| `statMean` | Center of the sampling distribution (mean of the drawn statistics) |
| `statSD` | Spread — SD of the statistic (null until ≥ 2 samples) |
| `theorySE` | Theory value: σ/√n (means) or √(p(1−p)/n) (proportions) |
| `lastStat` | The most recent sample's statistic |
| `mode` | `quant` or `prop` |

> Only the **Sampling Distribution Lab** emits state today (Ch 6 flagship). Other
> tools fall back gracefully: `requires` on a non-emitting tool would never unlock,
> so don't use it there yet — use a `seed` + robust phrasing instead. As more tools
> adopt the contract, their metric tables will be added here.

**For tool authors (adding state emission to another tool):** dispatch a
`CustomEvent` on `window` after every meaningful state change —
`new CustomEvent('statlens:state', { detail: { tool, event, state } })` where `state`
is a flat object of the metrics above. Also answer the panel's load-time handshake:
`window.addEventListener('statlens:request-state', () => emitState('sync'))` so steps
that read state are correct before the first action. See `conceptual/sampling-lab/app.js`
(`emitState`) for the reference implementation.

### Inline Markdown

All text fields support simple inline markdown:
- `**bold**` — for emphasis on UI elements ("Click **+1**")
- `*italic*` — for statistical terms
- `` `code` `` — for values or literal input the student types
- `[text](url)` — for links (opens in new tab)

No block-level markdown (headers, lists, images) is supported. Keep text concise.

### Math (LaTeX)

**Write math as LaTeX — don't hunt for Unicode characters.** All text fields render
math through KaTeX:

| Syntax | Renders | Use for |
|---|---|---|
| `$H_0: p = 0.10$` | inline | almost everything |
| `\(\hat{p}\)` | inline | same as `$…$`, if you prefer |
| `$$z = \frac{\hat{p} - p_0}{\sqrt{p_0(1-p_0)/n}}$$` | display (own line) | a formula worth its own line |
| `\[ \mu_1 - \mu_2 \neq 0 \]` | display | same as `$$…$$` |

KaTeX loads automatically, on any tool page, only when an activity contains math.

**Escaping, in JSON.** A backslash must be doubled — write `"$\\hat{p}$"`, not
`"$\hat{p}$"`. This is JSON's rule, not ours; a single `\h` is an invalid escape and
the file won't parse.

**Dollar signs in prose are safe.** `$100,000–$250,000` stays money. Math needs no
space just inside the delimiters, and a closing `$` may not be followed by a digit —
so prose currency is never mistaken for a formula. To be explicit, write `\$` for a
literal dollar sign.

**Unicode (`H₀`, `p̂`, `α`) still renders** — the older activities are written that
way and don't need converting. Prefer LaTeX for new work: it's easier to type, easier
to read in the source, and it produces real MathML for screen readers, which bare
Unicode `p̂` (a combining sequence) does not.

Don't wrap formulas in `` `code` `` — that was the old workaround from when panel
math didn't typeset. Use `$…$`.

## Validate your activity

Before you ship, check the file against the schema:

```bash
npm run validate:activities                              # all activities/*.json
node scripts/validate-activities.mjs path/to/one.json    # a single file (any path)
```

It verifies the JSON parses; required fields are present and correctly typed;
`tool` resolves to a real `<tool>/index.html`; `params.dataset` is a known
dataset id; every gate has a question and 2–4 well-formed choices; each `requires`
names a metric with exactly one threshold; each `respond` block has a non-empty
`prompts` array with unique field ids; and each demo `type` is registered in
`js/activity-panel.js`. **Errors** fail the command
(exit 1); **warnings** flag likely mistakes the runtime tolerates (e.g. an
unknown demo type, which simply doesn't render). It's also bundled into
`npm run test:all`.

## Where Activities Live

- **StatLens repo**: `activities/` directory
- **Naming convention**: topic slug, `{topic}.json` (e.g., `bootstrap-explore.json`). **Do not prefix with a chapter number** — the textbook renumbered to 29 chapters/5 parts, so number prefixes go stale. Use a stable topic slug instead.
- **Deployed to**: `https://learnlens.org/statlens/activities/`

Activities can also be hosted externally (any URL with CORS headers). The `?activity=` parameter accepts bare filenames, root-relative paths, or full URLs.

## The Activity Library — Using, Sharing, and Contributing

StatLens activities are designed to grow into an instructor-contributed library.
The options, from lowest to highest commitment:

### 1. Use the bundled activities
Everything in `activities/` is deployed and linkable:
`https://learnlens.org/statlens/<tool-path>/?activity=<name>.json`.
No setup required.

### 2. Author and self-host (no contribution needed)
Write a JSON file following this guide and host it anywhere that serves it with CORS
headers — a GitHub repo (via raw/pages URL), a Gist, or your course site. Then point
any StatLens tool at it:

```
https://learnlens.org/statlens/simulate/bootstrap-mean/?activity=https://your-site.edu/my-activity.json
```

You can iterate live: edit your hosted file, refresh the tool page. Your students use
your URL; nothing needs to be merged anywhere. **This is also the recommended way to
develop an activity you intend to contribute** — get it working against the live tools
first.

### 3. Contribute to the shared library
Open a pull request adding your JSON file to `activities/` in the StatLens repo
(https://github.com/jbaggett/statlens). Conventions:

- File name: stable topic slug (`sampling-bias.json`), no chapter-number prefixes
- Follow the authoring principles in this guide (one tool, one concept, 3–6 steps)
- Test against the live site via the external-URL method above before submitting
- Contributions are curated — expect light editing for tone/accessibility consistency
- Contributed activities are credited and shared under **CC BY 4.0** (you keep
  attribution; others may adapt with credit)

### Planned library infrastructure
(See `Planned_Features.md`, June 2026 master idea list, section A.)

- **Browsable catalog**: `activities/index.json` manifest (title, tool, chapter,
  concepts, minutes, author) + an `/activities/` page rendering it with preview links
- **CI enforcement**: `npm run validate:activities` is implemented (see "Validate
  your activity" above) and bundled into `test:all`, but no CI workflow is wired
  up yet — add one so broken contributions can't merge
- **Activity Builder**: a form-driven authoring page (like the Dataset Builder) that
  emits activity JSON with live preview — for instructors who don't want to hand-edit JSON
- ~~**Tool event hooks**: gates/steps that react to live tool state~~ — **SHIPPED** (2026-06).
  See **Live tool state (action-gates + result-aware feedback)** above; the Sampling
  Distribution Lab emits `statlens:state`, and `requires` gates can auto-advance / be
  result-aware. More tools will adopt the contract over time.

## How the Textbook References Activities

```markdown
::: {.statlens}
**See it in action.** Open the [Bootstrap Resampling Activity]({{< var statlens-url >}}/simulate/bootstrap-mean/?activity=bootstrap-explore.json){target="_blank"} to explore how bootstrap confidence intervals work step by step.
:::
```

The `params` in the JSON provide defaults (dataset, seed, CI level), so the URL stays simple. Only `?activity=filename.json` is needed.

## Authoring Principles

### 1. One Tool, One Concept
Each activity should focus on a single statistical concept using a single StatLens tool. Don't try to cover an entire chapter — write multiple short activities instead.

### 2. Do → Observe → Understand
Each step follows a pattern:
- **instruction**: A concrete action ("Click **+100**")
- **observe**: Direct attention to the right place ("What shape is forming?")
- **reveal**: Connect observation to concept ("This is the Central Limit Theorem in action")

### 3. Progressive Complexity
- Step 1: Simple action, basic observation (click +1, see what happens)
- Middle steps: Build up, vary parameters, compare
- Final step: Draw a conclusion or answer a question

### 4. Use `params` to Set the Stage
Pre-configure the tool so students start in the right state:
- `dataset` — load the right data automatically
- `seed` — ensure reproducible results for discussion
- `ci` — set confidence level if relevant
- `direction` — set hypothesis direction if relevant

### 5. Keep Steps Short
- 1-2 sentences per instruction
- 1 sentence for observe
- 2-3 sentences for reveal
- 3-6 steps per activity (5 minutes of student time)

## Available Tools for Activities

See `/home/jbaggett/statlens/docs/tool-manifest.md` for the complete catalog. Key tools for activities:

### Simulation Tools (Part II: Ch 6-9)
| Tool Path | What Students Do |
|-----------|-----------------|
| `simulate/bootstrap-mean/` | Build bootstrap distribution of sample means |
| `simulate/bootstrap-prop/` | Build bootstrap distribution of sample proportions |
| `simulate/bootstrap-paired/` | Bootstrap CI for paired mean differences |
| `simulate/bootstrap-two-means/` | Bootstrap CI for difference in two means |
| `simulate/bootstrap-two-props/` | Bootstrap CI for difference in two proportions |
| `simulate/randomization-one-prop/` | Randomization test for one proportion |
| `simulate/randomization-one-mean/` | Randomization test for one mean |
| `simulate/randomization-diff-means/` | Randomization test for difference in means |
| `simulate/randomization-diff-props/` | Randomization test for difference in proportions |

### Explore Tools (Part I: Ch 1-5)
| Tool Path | What Students Do |
|-----------|-----------------|
| `explore/descriptive/` | Visualize and compute summary statistics |
| `explore/regression/` | Scatterplot with regression line, r, R² |
| `explore/categorical/` | Contingency tables, bar charts, mosaic plots |
| `explore/grouped/` | Compare distributions across groups |
| `explore/dotplot-editor/` | Build dotplots by clicking, explore variability |

### Conceptual Labs
| Tool Path | What Students Do |
|-----------|-----------------|
| `conceptual/sampling-lab/` | **Sampling Distribution Lab** — three-tier view (population → one sample → sampling distribution) for **both means (x̄) and proportions (p̂)**; Freeze/compare pins two sample sizes on a shared axis (the reps-vs-n distinction). Activity params: `type` (`quant`/`prop`), `p` (0.05–0.95), `shape` (`normal`/`right-skewed`/`left-skewed`/`uniform`/`bimodal`), `n` (1–500), `seed`. **Primary Ch 6 tool — target this, not `sampling-dist/`.** |
| `conceptual/sampling-dist/` | _Legacy, means-only — superseded by `sampling-lab/`. Don't target for new activities._ |
| `conceptual/ci-coverage/` | Simulate many CIs, see coverage rate |
| `conceptual/randomization-test/` | _Legacy — redirects to `simulate/randomization-diff-props/?activity=randomization-test-gated.json`. Author new randomization activities against the `simulate/` tools directly._ |

### Distribution Calculators (Part III: Ch 10-13)

All distribution calculators host the activity panel (via `page-number.js`). Activity `params` map to their URL parameters (see `docs/url-api.md`). These pages emit **no live state**, so use `gate` / `respond` steps, not `requires`.

| Tool Path | What Students Do | Activity `params` |
|-----------|-----------------|-------------------|
| `distribution/normal/` | Find areas/quantiles on the normal curve | `mu`, `sigma`, `tail` (`left`/`right`/`between`/`symmetric`), `lo`, `hi` — e.g. `activities/normal-area.json` |
| `distribution/binomial/` | Find `P(X=k)`, `P(X≤k)`, `P(X≥k)`, … on the binomial PMF | `n`, `p`, `k`, `type` (`exact`/`leq`/`geq`/`lt`/`gt`) — e.g. `activities/binomial-esp.json` |
| `distribution/t/` | Find areas/quantiles on the t distribution | `df`, `tail`, `lo`, `hi` |

### Inference Tools (Part III: Ch 10-13)
| Tool Path | What Students Do |
|-----------|-----------------|
| `inference/one-mean/` | One-sample t-test with full output |
| `inference/one-prop/` | One-proportion z-test |
| `inference/two-means/` | Two-sample t-test |
| `inference/paired/` | Paired t-test |

## URL Parameters Reference

See `/home/jbaggett/statlens/docs/url-api.md` for the complete parameter list. Key params for activities:

| Parameter | Use in Activities |
|-----------|------------------|
| `dataset` | Pre-load a dataset (e.g., `penny_ages`, `cpr`, `sex_discrimination`) |
| `seed` | Fix PRNG seed for reproducible results. Convention: `ch{NN}{type}` |
| `ci` | Set confidence level: `90`, `95`, `99` |
| `direction` | Set hypothesis direction: `less`, `greater`, `two-sided` |
| `embed` | Set to `true` to hide header/footer (activity mode does this automatically) |

## Textbook Chapter Reference

For mapping activities to chapters, see `/home/jbaggett/statlens/docs/textbook-toc.md`. Key chapters for early activities:

| Chapter | Topic | Best StatLens Tools |
|---------|-------|---------------------|
| Ch 1-2 | Data types, study design | `explore/descriptive/`, `explore/categorical/` |
| Ch 3 | Numerical data | `explore/descriptive/`, `explore/dotplot-editor/` |
| Ch 4 | Categorical data | `explore/categorical/`, `explore/one-cat/` |
| Ch 5 | Regression intro | `explore/regression/` |
| Ch 6 | Sampling distributions | `conceptual/sampling-lab/` (means + proportions; add `?type=prop` for the p̂ storyline) |
| Ch 7 | Bootstrap CI intro | `simulate/bootstrap-mean/`, `simulate/bootstrap-prop/` |
| Ch 8 | Bootstrap CI applications | `simulate/bootstrap-paired/`, `simulate/bootstrap-two-means/` |
| Ch 9 | Hypothesis testing | `simulate/randomization-*` pages |
| Ch 10-11 | Normal/t-based inference | `distribution/normal/`, `inference/one-mean/` |
| Ch 12-13 | Two-group inference | `inference/two-means/`, `inference/two-props/` |

## Dataset Reference

See `/home/jbaggett/statlens/data/datasets.json` for the full index. Datasets have:
- `id` — used in `?dataset=` parameter
- `name` — display name
- `studyDescription` — what the study measured
- `inferenceContexts` — pre-configured test setups (null hypothesis, alternative, parameter description)

Key datasets for textbook activities:
- `penny_ages` — Ch 7-8 bootstrap demos (648 pennies, right-skewed ages)
- `cpr` — Ch 9 randomization test (blood thinner experiment, 90 patients)
- `sex_discrimination` — Ch 9 randomization test (promotion bias, 48 resumes)
- `opportunity_cost` — Ch 9 randomization test (framing effect, 150 students)
- `stent30` — Ch 7 bootstrap proportion (stent trial, 30-day outcomes)
- `possum_regression` — Ch 5 regression (possum body measurements)
