# StatLens URL API Reference

## Stability Contract

Parameters documented here are part of the stable public API. They will never be renamed or removed. New parameters may be added. If behavior needs to change, a new parameter will be introduced that overrides the default.

Unknown parameters are silently ignored by the parser.

## Base URL

```
https://learnlens.org/statlens/
```

All tool paths are relative to this base. For example, the one-sample t-test page is at:

```
https://learnlens.org/statlens/inference/one-mean/
```

---

## Global Parameters

These parameters are accepted by all or most pages. They are parsed by `js/url-params.js` and handled by `js/page-utils.js` (data loading) and `js/settings.js` (display modes).

### Data Loading

| Parameter | Type | Default | Description | Example |
|-----------|------|---------|-------------|---------|
| `dataset` | string | _(none)_ | Load a bundled dataset by ID. Must match a filename in `data/` (without `.json`). Only alphanumeric, underscore, and hyphen characters are allowed. | `?dataset=penny_ages` |
| `data` | string | _(none)_ | Inline comma-separated numeric data. Parsed as floats; non-finite values are dropped. Maximum 10,000 values. If both `dataset` and `data` are present, `dataset` takes precedence. | `?data=23.1,19.4,27.8,31.0` |
| `csv` | string (URL) | _(none)_ | URL of a remote CSV file to fetch and parse. Must be an **HTTPS** URL (or `http://localhost` / `http://127.0.0.1` for local development). Maximum 2,000 characters. Multi-column CSVs are supported — the page exposes variable pickers so the student chooses the relevant column(s). | `?csv=https://example.com/data.csv` |
| `json` | string (URL) | _(none)_ | URL of a remote JSON dataset to fetch. Must be an **HTTPS** URL (or `http://localhost` for local development). Maximum 2,000 characters. Must conform to the StatLens dataset JSON schema (with `variables` and `rows` arrays). | `?json=https://example.com/ds.json` |
| `seed` | string | _(random)_ | PRNG seed for deterministic simulation output. When provided, a "Seed: ..." notice is displayed. Maximum 100 characters. Critical for graded assessments where reproducibility is required. | `?seed=abc123` |

**Data loading priority** (in `initDataPanel`):
1. `?dataset=` — auto-selects from the dataset dropdown
2. `?dataset=` **deep-link bypass** — if the id isn't in the (curated) dropdown but the tool opts in (a `deepLinkFilter`), it still loads when the dataset exists in the full index and passes that tool's capability guard. Lets a deep-link open a dataset the browse-dropdown deliberately hides. Enabled on `explore/descriptive` (any dataset with a numeric column) and `explore/grouped` (numeric + a grouping factor with ≥ 2 levels); a dataset that fails the guard (e.g. categorical-only into `explore/descriptive`) silently does nothing, as before. A `?dataset=` naming an id that isn't in the full index still no-ops.
3. `?data=` — converted to single-column CSV and loaded as "URL data"
4. `?json=` — fetched as external JSON dataset
5. `?csv=` — fetched as external CSV file
6. sessionStorage transfer data (cross-page navigation)
7. No auto-load (user picks manually)

### Variable Selection

These parameters are parsed and available in `StatLensParams` but are currently consumed primarily through `buildSimLink()` for cross-page navigation and future direct-link use.

| Parameter | Type | Default | Description | Example |
|-----------|------|---------|-------------|---------|
| `var` | string | _(none)_ | Select a variable by column name (single-variable pages). Lowercased and sanitized. | `?var=age` |
| `x` | string | _(none)_ | X variable for bivariate analysis (regression, scatterplot). | `?x=area_total` |
| `y` | string | _(none)_ | Y variable for bivariate analysis. | `?y=price` |
| `group` | string | _(none)_ | Grouping variable column name (two-group tests, ANOVA). | `?group=treatment` |
| `response` | string | _(none)_ | Response variable column name (ANOVA, grouped analysis). | `?response=score` |
| `success` | string | _(none)_ | Label for the "success" category (proportion tools). Highest priority — overrides the dataset's `inferenceContext` success label and the first-level default. Honored by the simulation proportion pages **and** the analytic `inference/one-prop` + `inference/two-props` pages, so a graded embed can pin the success level (e.g. `?dataset=malaria&success=Infected`) and stay fixed regardless of later context/default changes. An unrecognized level is ignored (falls back to the normal default). | `?success=yes` |
| `failure` | string | _(none)_ | Label for the "failure" category (proportion tests). | `?failure=no` |
| `group1` | string | _(none)_ | Label for group 1 (two-group comparisons). | `?group1=control` |
| `group2` | string | _(none)_ | Label for group 2 (two-group comparisons). | `?group2=treatment` |
| `var1` | string | _(none)_ | First variable label (paired tests). | `?var1=before` |
| `var2` | string | _(none)_ | Second variable label (paired tests). | `?var2=after` |
| `label` | string | _(none)_ | Display label for the primary variable. | `?label=age` |
| `units` | string | _(none)_ | Units string for the variable. | `?units=inches` |

### Display & Mode

These parameters are handled by `js/settings.js` and read via `URLSearchParams` directly (not through `parseParams`). They override the corresponding localStorage setting for the current page load only.

| Parameter | Type | Default | Description | Example |
|-----------|------|---------|-------------|---------|
| `mode` | string | `discover` | Activity mode for conceptual demo pages. `discover` enables progressive disclosure with gated questions. `present` shows all steps with a clean interface for instructor projection. | `?mode=present` |
| `expert` | string | `false` | Expert mode toggle. When `true` or `1`, shows advanced controls (statistic selector, CI level, chart toggle, bin adjuster, theory overlay). When `false` or `0`, hides them for intro students. | `?expert=true` |
| `interpret` | string | `true` | Show auto-generated conclusions and interpretation text. When `false` or `0`, hides interpretations so students must produce their own (calculator-only mode). | `?interpret=false` |
| `readout` | string | `true` | **Reasoning mode** (simulation pages). When `false`/`0`/`no`, hides the computed **answer** — the CI / p-value numbers, the region shading, the CI bound lines, and the probability pills — while keeping the distribution, its histogram tooltips (bin edges + count), the observed-stat marker, the mechanism strip, and the generate bar. The results panel prompts the student to read the interval / p-value off the distribution. For MOM "estimate the CI/p-value from the histogram" exercises. Applies to the `sim-app.js` pages (all `bootstrap-*` and `randomization-diff-*`), the standalone `randomization-chisq/anova/correlation` + `conceptual/sampling-lab`, `simulate/bootstrap-slope/`, `simulate/goodness-of-fit/`, and the one-sample pages `randomization-one-prop` / `randomization-one-mean`. | `?readout=false` |
| `plot` | string | _(none)_ | **Figure-only embed.** `plot=only` renders **just the interactive chart** — hides all controls, the mechanism strip, the generate bar, the results/readout, and page chrome (implies `embed`). On the **simulation** pages it also **auto-runs** the distribution on load (1000 reps at the given `seed`), so the finished, hoverable bootstrap/randomization figure is there with no click. On **explore** pages it shows the dataset's chart bare. The student reads the plot (and its bin-edge/count tooltips) to answer — the least-friction home for "estimate from the figure" problems. This is the one mode that overrides the "never hide the mechanism strip" rule. Reasoning-mode figures (`plot=only`/`readout=false`) also pick a **readable shape without the chart-type toggle**: a discrete statistic (a sample proportion `k/n`) shows as **non-touching spike bars** up to ~40 distinct values — the honest "these are the possible `k/n`" picture — then **bins to a histogram** beyond that (so large `n` can't degrade into an unhoverable spike cloud); continuous statistics (means, slopes) use a histogram. | `?dataset=…&seed=…&plot=only` |
| `observed` | string | `on` | **Hide the observed-statistic marker** (reasoning-mode; pairs with `plot=only`/`cutlines=tail`). `observed=off` removes the observed-stat marker line + label (and its bar-split) from the simulation distribution, while keeping everything else — the distribution, hover tooltips, and the draggable cutoff line **with its x-value readout**. Use it to make the student **place** the line at the statistic quoted in the problem text ("connect the dots") instead of dragging to a pre-drawn dot — the locating step is the point. Also suppresses the auto tail-shading that would otherwise reveal the location. Honored by every simulation chart (spike / histogram / dotplot), so it works on all read-off pages (`randomization-chisq`, `bootstrap-*` CI reads, one-sample, `sim-app.js` pages). Any value other than `off` (or omitting it) keeps the marker. | `?dataset=…&plot=only&cutlines=tail&observed=off` |
| `cutlines` | string | _(none)_ | **Draggable cutoff lines** (reasoning-mode overlay; pairs with `plot=only`/`readout=false`). Instead of counting bars, the student drags vertical cutoff line(s) and reads **region counts** off distribution-calculator-style pills. `cutlines=ci` draws **two** lines with **three region pills** — left-tail, central (blue = the confidence level), right-tail — each showing `count / N = %` (count-led: simulation inference is counting outcomes, and the proportion is what's reported); each line carries its **x-value** (the CI bound the student reports) at the axis. Drag until each tail reads (100−CL)/2%. `cutlines=tail` draws **one** line with a **tail-count pill** (the p-value) plus its x-value — drag to the observed-stat marker. Lines **start at the extremes / centre**, never pre-placed at the answer. Each line's x-value pill is flanked by **−/+ fine-adjust buttons** (one smallest-displayed-unit per click, snapping to a clean grid) so the mouse can land on an exact quoted value after a rough drag. Fully keyboard-accessible (each line is a `role="slider"`: ←/→ nudge, Shift=×5, Home/End jump; the −/+ buttons are focusable `role="button"`s; `aria-valuetext` announces count + %). Rides on the spike bars or histogram (whichever the shape rule picked). Works on every sim tool (`sim-app.js` pages, `bootstrap-slope`, one-sample, and the standalone randomization tools). | `?dataset=…&plot=only&cutlines=ci` |
| `embed` | string | `false` | Compact mode for iframe embedding. Hides the page header, data panel, skip links, footer, and page number badge. Also disables service worker update toasts and home button navigation (which would break iframe context). Supported on all pages via shared CSS and `js/page-number.js`. | `?embed=true` |
| `guided` | string | `false` | Textbook guided mode. Only meaningful when `embed=true` is also set. Hides the controls row (statistic dropdown, CI level dropdown, seed notice) on simulation pages, since these are pre-configured via URL params in a textbook context. Keeps the generate bar, mechanism strip, chart, and results fully visible. | `?embed=true&guided=true` |
| `coach` | string | `false` | Turns on **coaching hints** for novice students: emphasizes the primary action, shows an empty-state cue on the blank chart, and a state-anchored "next step" line that updates only when the student acts (never on a timer). `?coach=true` forces hints on, `?coach=false` forces them off; either overrides the saved Settings preference. Works everywhere including LMS embeds (where saved settings can be blocked), so it's the reliable way to enable coaching in a textbook/Canvas link. Currently active on the simulation pages. | `?coach=true` |
| `readonly` | string | `false` | Disables interactive controls (page-specific). Currently supported on `explore/regression-by-eye/` (disables line dragging, Try Again, and Generate buttons). Intended for post-grading review where students can see their result but not modify it. | `?readonly=true` |
| `activity` | string | _(none)_ | URL or filename of a JSON activity file. Loads a step-by-step instruction panel alongside the tool. Bare filenames resolve to `activities/{name}` relative to the StatLens root. Absolute URLs (`https://...`) and root-relative paths (`/activities/...`) are also supported. Hides the data panel and controls row (sets `data-activity` and `data-guided` on body). Activity JSON `params` are injected as URL defaults — existing URL params take precedence. | `?activity=bootstrap-explore.json` |
| `static` | string | `false` | Screenshot-optimized rendering. Implies `embed=true`. Intended for Playwright-based screenshot capture for print/PDF textbook fallbacks. | `?static=true` |

---

## Simulation Parameters

Accepted by pages under `simulate/`. Parsed by `js/url-params.js`, consumed by `js/sim-app.js` (shared simulation pages) and `js/one-sample-sim.js` (one-sample pages).

### Pages using `sim-app.js` (shared)

`bootstrap-mean/`, `bootstrap-prop/`, `bootstrap-paired/`, `bootstrap-two-means/`, `bootstrap-two-props/`, `randomization-diff-means/`, `randomization-diff-props/`, `randomization-paired/`

| Parameter | Type | Default | Description | Example |
|-----------|------|---------|-------------|---------|
| `dataset` | string | _(none)_ | Auto-select a bundled dataset from the dropdown. | `?dataset=penny_ages` |
| `data` | float[] | _(none)_ | Inline numeric data (single-variable pages only). Ignored when `dataset` is also present. | `?data=1.2,3.4,5.6` |
| `seed` | string | _(random)_ | PRNG seed for reproducible resampling. | `?seed=hw3q2` |
| `ci` | integer | `95` | Confidence interval level (as a percentage). Applied to the CI level dropdown. | `?ci=90` |
| `ci_method` | string | `percentile` | Which CI(s) the results show on **bootstrap** pages: `percentile` (default, IMS), `se` (estimate ± z·SE — the "±2 SE" 95% rule of thumb), `both`, or `bca` (bias-corrected and accelerated). A live **Percentile \| ±2 SE \| Both** toggle is in the results; the **BCa** button is shown only in expert mode. `?ci_method=bca` selects it directly (works regardless of expert mode, for instructor links). | `?ci_method=both` |
| `stat` | string | `mean` | Bootstrap statistic selector (bootstrap-mean page only). Valid values: `mean`, `median`, `sd`, `q1`, `q3`. Sets the `#boot-stat` dropdown on page load. | `?stat=median` |
| `direction` | string | _(page default)_ | Tail direction for hypothesis test shading. Valid values: `less`, `greater`, `two-sided` (mapped internally to `twosided`). Sets the alternative hypothesis direction button. | `?direction=greater` |
| `mechanism` | string | _(bars)_ | Mechanism-strip view for **two-group proportion randomization** pages (`randomization-diff-props`). `cards` sets the initial view to dealt cards instead of proportion bars; a live "Bars / Cards" toggle is available regardless. Cards are shown only for small samples (≤50 per group); ignored otherwise. Pairs with `success`/`failure` for card legend labels (which otherwise derive from the data's outcome levels). | `?mechanism=cards` |

### Pages using `one-sample-sim.js`

`randomization-one-prop/`, `randomization-one-mean/`

| Parameter | Type | Default | Description | Example |
|-----------|------|---------|-------------|---------|
| `dataset` | string | _(none)_ | Auto-select a bundled dataset. | `?dataset=opportunity_cost` |
| `data` | float[] | _(none)_ | Inline numeric data (one-mean only). | `?data=5,8,3,7,9` |
| `seed` | string | _(random)_ | PRNG seed. | `?seed=exam2` |
| `p` | float | _(page default)_ | Null hypothesis proportion (one-prop only). Sets the null value input. | `?p=0.5` |
| `null_value` | float | _(page default)_ | Null hypothesis mean (one-mean only). Sets the null value input. | `?null_value=100` |
| `direction` | string | _(page default)_ | Alternative hypothesis direction: `less`, `greater`, or `two-sided`. | `?direction=less` |
| `mechview` | string | `summary` | Resample mechanism view for **one-mean** (`randomization-one-mean`, and the same control on `bootstrap-mean`). `summary` shows value cards annotated ×N / "not selected"; `dotplot` shows the pluck-and-fly dotplot. A live **Tiles / Dotplots** toggle (bottom-right of the strip) is available regardless. Applies to small samples (cards ≤30, dotplot ≤40); larger n falls back to a histogram. | `?mechview=dotplot` |

### Randomization ANOVA (`simulate/randomization-anova/`)

Standalone page (does not use `sim-app.js`). Uses `initDataPanel` for data loading. Shuffles group labels to build a null distribution of the F statistic. Always right-tailed.

| Parameter | Type | Default | Description | Example |
|-----------|------|---------|-------------|---------|
| `dataset` | string | _(none)_ | Auto-select a bundled dataset. Filters to datasets with both numeric and categorical columns. | `?dataset=classdata` |

Does not currently consume `seed` or `direction` from URL parameters. The test is always right-tailed (F ≥ 0). Grouping and response variables are selected via dropdown after data loads; they auto-select from `inferenceContexts` if the dataset has an ANOVA context.

### Randomization Correlation (`simulate/randomization-correlation/`)

Standalone page (does not use `sim-app.js`). Uses `initDataPanel` for data loading. Shuffles y-values to break x-y pairing and builds a null distribution of the correlation coefficient r. Supports two-sided, right-tail, and left-tail alternatives via a direction toggle button.

| Parameter | Type | Default | Description | Example |
|-----------|------|---------|-------------|---------|
| `dataset` | string | _(none)_ | Auto-select a bundled dataset. Filters to datasets with `type: "regression"`. | `?dataset=possum_regression` |

Does not currently consume `seed` or `direction` from URL parameters. The direction toggle is controlled via the UI only.

### Standalone simulation pages (no additional URL parameters)

`randomization-chisq/` — uses `initDataPanel` for data loading (`dataset`, `data`, `csv`, `json`) plus `seed`, `readout`, and `plot=only` (see those rows), but no other simulation-specific parameters.

`bootstrap-slope/` has its own engine (draws bootstrap regression lines on a scatterplot) and now honors `seed`, `readout=false`, `plot=only`, `ci`, and `ci_method` on top of data loading (`dataset`, `csv`, `json`). `?ci=` sets the confidence level (50–99.9); `?ci_method=` picks `percentile` / `se` / `both`; `plot=only` auto-runs the 1000-resample bootstrap distribution at the given `seed`.

---

## Distribution Parameters

Accepted by pages under `distribution/`. Parsed by `js/url-params.js`, consumed by `js/dist-app.js` (shared calculator logic).

### Common to all continuous distribution pages

| Parameter | Type | Default | Description | Example |
|-----------|------|---------|-------------|---------|
| `tail` | string | `left` | Shading direction. Valid values: `left`, `right`, `both`, `middle`. | `?tail=both` |

### Normal (`distribution/normal/`)

| Parameter | Type | Default | Description | Example |
|-----------|------|---------|-------------|---------|
| `mu` | float | `0` | Mean of the normal distribution. | `?mu=100` |
| `sigma` | float | `1` | Standard deviation (must be > 0). | `?sigma=15` |
| `tail` | string | `left` | Region to shade: `left`, `right`, `between` (shade the middle band between two bounds), or `symmetric` (shade the two outer tails; bounds mirror the mean). Legacy `both` is accepted as an alias for `symmetric`. | `?tail=between` |
| `lo` | float | _(HTML default)_ | Primary boundary: the cut for `left`/`right`, the magnitude for `symmetric`, or the lower bound of a `between` band. | `?lo=-1` |
| `hi` | float | _(HTML default)_ | Upper boundary — only used by `between`. | `?hi=2` |

> **Region modes.** `between` and `symmetric` are the two-boundary modes. `between` reveals a second bound input (upper bound) and shades the **middle**; `symmetric` keeps a single bound and mirrors it about the mean to shade **both outer tails**. Every region shows a probability pill, and pills are click-to-edit. In `between`, editing any region sets it to the typed value and splits the remaining probability across the other two regions **in proportion to their current sizes** (so the band keeps its shape); in `symmetric`, editing a tail sets each tail's area and editing the middle sets the central probability. Deep-link a band with `?tail=between&lo=-1&hi=2`.

### t (`distribution/t/`)

| Parameter | Type | Default | Description | Example |
|-----------|------|---------|-------------|---------|
| `df` | integer | `10` | Degrees of freedom (must be >= 1). | `?df=24` |
| `tail` | string | `left` | Region to shade: `left`, `right`, `between`, or `symmetric`. Legacy `both` → `symmetric`. | `?tail=symmetric` |
| `lo` / `hi` | float | _(HTML default)_ | Boundaries — see the normal page notes above. | `?lo=-2&hi=2` |

### Chi-squared (`distribution/chisq/`)

| Parameter | Type | Default | Description | Example |
|-----------|------|---------|-------------|---------|
| `df` | integer | `5` | Degrees of freedom (must be >= 1). | `?df=3` |
| `tail` | string | `right` | Region to shade: `left`, `right`, or `between`. (No `symmetric` — the distribution is asymmetric.) | `?tail=between` |
| `lo` / `hi` | float | _(HTML default)_ | Boundaries for `between` (and the cut for `left`/`right`). | `?lo=2&hi=11` |

### F (`distribution/f/`)

| Parameter | Type | Default | Description | Example |
|-----------|------|---------|-------------|---------|
| `df1` | integer | `3` | Numerator degrees of freedom (must be >= 1). | `?df1=2` |
| `df2` | integer | `20` | Denominator degrees of freedom (must be >= 1). | `?df2=45` |
| `tail` | string | `right` | Region to shade: `left`, `right`, or `between`. (No `symmetric` — the distribution is asymmetric.) | `?tail=between` |
| `lo` / `hi` | float | _(HTML default)_ | Boundaries for `between` (and the cut for `left`/`right`). | `?lo=0.5&hi=3` |

### Binomial (`distribution/binomial/`)

Reads its parameters directly (standalone page, not `dist-app.js`). Values are clamped to the same ranges the page enforces; existing behaviour (draggable `k`, presets) is unchanged.

| Parameter | Type | Default | Description | Example |
|-----------|------|---------|-------------|---------|
| `n` | integer | `20` | Number of trials. Clamped to 1–500. | `?n=8` |
| `p` | float | `0.5` | Success probability. Clamped to 0–1. | `?p=0.25` |
| `k` | integer | `0` | The boundary value. Clamped to 0–`n`. | `?k=6` |
| `type` | string | `leq` | Probability type. Values: `exact` (`P(X=k)`), `leq` (`P(X≤k)`), `geq` (`P(X≥k)`), `lt` (`P(X<k)`), `gt` (`P(X>k)`). Aliases `eq`→`exact`, `le`→`leq`, `ge`→`geq` are accepted. | `?type=geq` |

> Deep-link a specific probability with `?n=8&p=0.25&k=6&type=geq` → `P(X ≥ 6) ≈ 0.0042`. Activities can set these via `params` (e.g. `activities/binomial-esp.json`).

### Power & Error Visualizer (`distribution/power/`)

Standalone page (does not use `dist-app.js`). Parses params via `js/url-params.js` and applies them to its sliders/inputs (`distribution/power/app.js:62–76`). Visualizes Type I error (α), Type II error (β), and power (1 − β) from two overlapping normal sampling distributions.

| Parameter | Type | Default | Description | Example |
|-----------|------|---------|-------------|---------|
| `alpha` | float | `0.05` | Significance level (Type I error rate). Slider range 0.001–0.20. | `?alpha=0.01` |
| `n` | integer | `30` | Sample size. Slider range 2–500 (accepts up to 10000). | `?n=64` |
| `delta` | float | `0` | Effect size, μ₁ − μ₀. Slider range −5 to 5. | `?delta=1.5` |
| `sigma` | float | `1` | Population standard deviation (σ). Slider range 0.1–10. | `?sigma=2` |
| `tail` | string | `right` | Test direction: `left`, `right`, or `both`. | `?tail=both` |

---

## Inference Parameters

Accepted by pages under `inference/`. Data loading uses `initDataPanel` (see Global Parameters). Additional parameters are consumed after data loads.

### Common inference parameters

| Parameter | Type | Default | Description | Pages |
|-----------|------|---------|-------------|-------|
| `dataset` | string | _(none)_ | Auto-load a bundled dataset. | All inference pages |
| `data` | float[] | _(none)_ | Inline numeric data. | `one-mean/`, `paired/`, `slope/`, `two-means/` |
| `csv` | string (URL) | _(none)_ | External CSV to fetch. | All inference pages |
| `json` | string (URL) | _(none)_ | External JSON dataset to fetch. | All inference pages |

### ANOVA (`inference/anova/`)

| Parameter | Type | Default | Description | Example |
|-----------|------|---------|-------------|---------|
| `alpha` | float | `0.05` | Significance level. Must match one of the dropdown options. | `?alpha=0.01` |
| `group` | string | _(none)_ | Pre-select the grouping variable column. | `?group=treatment` |
| `response` | string | _(none)_ | Pre-select the response variable column. | `?response=score` |
| `summary` | string | _(none)_ | Compact summary statistics for auto-load without raw data. Format: `label:n:mean:sd` per group, comma-separated. Overrides dataset. | `?summary=A:30:12.5:2.1,B:28:14.2:1.8,C:32:11.8:2.4` |
| `posthoc` | string | `tukey` | Post-hoc multiple-comparisons method shown below the F-test (3+ groups, raw data only): `tukey` (Tukey HSD, studentized range) or `bonferroni` (pairwise t with p×#pairs). A live "Tukey HSD / Bonferroni" toggle is available; both report all pairwise differences with family-wise CIs + adjusted p-values and a forest plot. The CI level follows `alpha`. | `?posthoc=bonferroni` |

### Regression slope (`inference/slope/`)

| Parameter | Type | Default | Description | Example |
|-----------|------|---------|-------------|---------|
| `x0` | float | _(x̄)_ | Point at which to report a **prediction** (raw data only). Sets the initial value of the "Predict a response" input; the readout shows the fitted ŷ, the CI for the **mean response** at x₀, and the **prediction interval** for a new observation. Defaults to the mean of x. Editable live. | `?x0=3.5` |
| `interval` | string | `both` | Which interval(s) the x₀ readout shows: `mean` (mean-response CI only), `prediction` (prediction interval only), or `both`. | `?interval=mean` |
| `anova` | boolean | `false` | Expands the **ANOVA table for the regression** panel by default (SST = SSR + SSE, model F-test, and F = t² for the single-predictor equivalence). The panel is present and collapsed regardless; this opens it on load for chapter links. Raw data only. | `?anova=true` |

### Multiple linear regression (`inference/mlr/`)

| Parameter | Type | Default | Description | Example |
|-----------|------|---------|-------------|---------|
| `dataset` | string | `possum` | Bundled dataset (must have ≥ 3 numeric variables). | `?dataset=county` |
| `response` | string | _(first numeric)_ | Response variable Y. | `?response=head_l` |
| `predictors` | string[] | _(first two numeric ≠ response)_ | Comma-separated predictor names. | `?predictors=total_l,skull_w` |
| `diagnostics` | boolean | `false` | Expand the diagnostics panel (residual plots + Cook's-distance flag) by default. | `?diagnostics=true` |
| `expert` | boolean | `false` | Reveal the VIF column (multicollinearity metric; Extended Content). Default shows the pairwise-predictor scatterplot matrix instead. | `?expert=true` |

### Summary input format

The `summary` parameter supports compact encoding of summary statistics so that links can be constructed without embedding raw data.

**ANOVA format**: `label:n:mean:sd,label:n:mean:sd,...` (2+ groups required)

```
?summary=Control:25:10.2:3.1,Treatment:25:14.8:2.9
```

**Two-means format**: Same as ANOVA but with exactly 2 groups.

**One-sample format**: `n:mean:sd`

```
?summary=30:12.5:2.1
```

---

## Explore Parameters

### External data loading (all Explore tools)

Every Explore tool loads data through `initDataPanel`, so they all accept
`dataset`, `data`, `csv`, and `json` (see Global Parameters). Multi-column files
are fine — each tool exposes the relevant variable picker(s):

| Tool | Variable picker behaviour with a multi-column file |
|------|----------------------------------------------------|
| `explore/descriptive/` | numeric-variable dropdown (pick the quantitative column) |
| `explore/one-cat/` | categorical-variable dropdown (pick the categorical column; shown only when >1 categorical) |
| `explore/grouped/` | response (numeric) + grouping (categorical) dropdowns |
| `explore/categorical/` | two categorical-variable dropdowns |
| `explore/regression/` | x / y numeric dropdowns |
| `explore/multi/` | variable list — click 1–2 variables to chart |

Example (deep-link the Explore Tech Tutorial's shared CSV):
`explore/one-cat/?csv=https://…/class_survey.csv` (pick `year`),
`explore/grouped/?csv=https://…/class_survey.csv` (response `commute_min`, group `housing`).

#### Regression bands (`explore/regression/`)

| Parameter | Type | Default | Description | Example |
|-----------|------|---------|-------------|---------|
| `predict` | string | `true` | The **prediction marker** (a draggable point on the line showing the predicted ŷ at x₀, with a live "predicted y" readout) — INDEPENDENT of the bands. On by default; `predict=false` hides it (e.g. for a course that doesn't want it). Needs n ≥ 2. | `?dataset=cats&predict=false` |
| `bands` | string | `false` | Overlay the **95% confidence band** (mean response, blue solid edge) and wider **prediction band** (a new observation, orange dashed edge), with a legend; also adds the CI/PI interval whiskers to the prediction marker and interval lines to the readout. Fully optional and OFF by default (`true`/`1`, alias `interval=`). For back-compat `bands=true` also turns the prediction marker on. Computed via `regressionIntervals()` (matches R `predict.lm`); needs n ≥ 3. | `?dataset=possum_regression&bands=true` |
| `x0` | float | _(x̄)_ | Initial position of the prediction marker (data units). Drag the marker (anywhere along its vertical line) or type in the "Predict at x₀" box to move it; a slight extrapolation past the data is allowed with a warning. | `?dataset=cats&x0=3.5` |

### Chart Type (`explore/descriptive/`, `explore/one-cat/`, `explore/grouped/`)

Pre-selects the active chart type on page load. The value must match one of the page's radio button values.

| Page | Parameter | Valid Values | Default | Example |
|------|-----------|-------------|---------|---------|
| `explore/descriptive/` | `chart` | `histogram`, `dotplot`, `boxplot` | `histogram` | `?dataset=loan50_interest&chart=boxplot` |
| `explore/one-cat/` | `chart` | `bar`, `pie`, `waffle` | `bar` | `?dataset=homeownership&chart=pie` |
| `explore/grouped/` | `chart` | `boxplot`, `dotplot`, `histogram`, `density` | `boxplot` | `?dataset=county_income_popgain&chart=density` |

### Label Visibility (`explore/one-cat/`, `explore/descriptive/`)

Controls numeric annotation visibility on charts. Designed for exercises where students must judge visually before seeing numbers.

| Parameter | Type | Valid Values | Default | Description |
|-----------|------|-------------|---------|-------------|
| `labels` | string | `full`, `names`, `none` | `full` | Controls what numeric information is shown on charts |

**Levels:**

- **`full`** — Default behavior. All counts, percentages, tooltips, and legends show full numeric detail.
- **`names`** — Category names visible but **no numbers**. Tooltips show category/bin name only; legend shows name + swatch only; pie slice labels hidden; histogram click-to-count disabled; boxplot five-number summary shows labels without values.
- **`none`** — No tooltips, no legend. Maximum visual-only mode.

When `labels` is `names` or `none`, a **"Show values" checkbox** appears, letting students reveal numbers after forming their judgment. The frequency table (one-cat) and statistics panel (descriptive) are hidden until values are shown.

**Examples:**
```
explore/one-cat/?dataset=jury&labels=names
explore/descriptive/?dataset=loans50&chart=boxplot&labels=none
```

### Category Order (`explore/one-cat/`)

Controls the sort order of categories in bar charts, pie charts, waffle charts, and the frequency table. Lets students explore how reordering categories affects chart readability — a key IMS Ch. 3 topic.

| Parameter | Type | Valid Values | Default | Description |
|-----------|------|-------------|---------|-------------|
| `sort` | string | `data`, `freq-desc`, `freq-asc`, `alpha` | `data` | Category sort order |

**Sort modes:**

- **`data`** — Categories appear in the order they occur in the dataset (first-occurrence). If the dataset variable has a `levels` array in its metadata, that order is used instead — this preserves meaningful ordinal sequences (e.g., Likert scales) regardless of row order.
- **`freq-desc`** — Descending frequency (tallest bar first, Pareto-style). Best for comparing relative sizes.
- **`freq-asc`** — Ascending frequency (shortest bar first).
- **`alpha`** — Alphabetical by category label (`localeCompare`).

The sort order applies consistently across all chart types (bar, pie, waffle) and the frequency table.

**Examples:**
```
explore/one-cat/?dataset=brexit&sort=freq-desc
explore/one-cat/?dataset=brexit&sort=alpha
explore/one-cat/?dataset=brexit&sort=data&labels=names
```

### Regression by Eye (`explore/regression-by-eye/`)

Uses `initDataPanel` for data loading (see Global Parameters). Also supports random data generation with `?seed=` for deterministic output.

**Page-specific parameters:**

| Parameter | Type | Default | Description | Example |
|-----------|------|---------|-------------|---------|
| `exercise` | boolean | `false` | Hides the "Show best-fit line" checkbox. Students must find the line by dragging and report their slope/intercept. | `?exercise=true` |
| `metric` | string | `squared` | Lock the error metric mode. `squared` = SSE with visual squares; `absolute` = SAE with dashed residual lines. | `?metric=absolute` |
| `show` | string | _(none)_ | Comma-separated list of layers to enable on load: `residuals`, `bestfit`. | `?show=residuals` |
| `hide` | string | _(none)_ | Comma-separated list of controls to hide: `toggle` (Absolute/Squared switch), `bestfit` (same as exercise), `residuals` (residuals checkbox). | `?hide=toggle` |
| `n` | integer | _(random 15-25)_ | Number of points for random data generation. Requires random data mode (no `dataset` param). | `?n=12` |
| `slope` | float | _(random)_ | True slope for the random data generating model. Combined with `seed` for reproducible known-answer exercises. | `?slope=2.5` |
| `intercept` | float | _(random)_ | True intercept for the random data generating model. | `?intercept=10` |
| `sigma_error` | float | _(random 0.1-0.7)_ | Noise fraction for random data (0 = perfect line, 1 = very noisy). | `?sigma_error=0.3` |

**Typical usage patterns:**

```
# Textbook link — named dataset, exercise mode
explore/regression-by-eye/?dataset=possum_regression&exercise=true

# MOM homework — seeded random data, exercise mode, embedded
explore/regression-by-eye/?seed=hw5q3&exercise=true&embed=true

# Instructor demo — known slope, residuals visible, 8 points for clarity
explore/regression-by-eye/?seed=demo1&n=8&slope=2&intercept=5&show=residuals

# Canvas quiz — embedded, locked to squared mode, no toggle
explore/regression-by-eye/?seed=quiz3&embed=true&exercise=true&hide=toggle&metric=squared

# L1 vs L2 comparison exercise — absolute mode
explore/regression-by-eye/?dataset=possum_regression&metric=absolute

# Variable pre-selection for multi-column dataset
explore/regression-by-eye/?dataset=possum_regression&x=total_l&y=head_l
```

### Dotplot Editor (`explore/dotplot-editor/`)

Interactive explore tool for adding/removing points on a number line with live summary statistics and optional boxplot overlay. Includes a challenge mode where students build datasets to match a target boxplot.

This page does not use `initDataPanel` and does not accept any URL parameters. Data is entered interactively by clicking the number line or selected from built-in presets (symmetric, skewed, bimodal, uniform, empty) via a dropdown.

### Data Explorer — multi-variable (`explore/multi/`)

Uses `initDataPanel` for data loading only (`dataset`, `csv`, `json` — see Global Parameters). Variable selection and chart type are chosen in the UI and are **not** URL-driven. No page-specific URL parameters.

### Are You Psychic? (`explore/psychic/`)

Reads its own params with `URLSearchParams` (`explore/psychic/app.js:20`).

| Parameter | Type | Default | Description | Example |
|-----------|------|---------|-------------|---------|
| `n` | integer | `16` | Number of coin-flip prediction trials. Clamped to 4–50. | `?n=20` |

A `context` switch is referenced in a code comment (`?context=milne`) but is **not** currently implemented.

### Stump the Chump (`explore/random-sequence/`)

Reads its own params with `URLSearchParams` (`explore/random-sequence/app.js:18`).

| Parameter | Type | Default | Description | Example |
|-----------|------|---------|-------------|---------|
| `n` | integer | `40` | Target H/T sequence length the student types. Clamped to 20–100. | `?n=50` |

### Dataset Builder (`data/builder/`)

Instructor utility (CSV/TSV → StatLens JSON). Does **not** read any URL parameters; all configuration is via the on-page form.

---

## Data Generation Parameters (datagen.js)

Parametric data generation via `js/datagen.js`. Supports two modes:

1. **Inline URL params** — `?dist=normal&mu=100&sigma=15&n=50&gen_seed=hw3` generates data directly from URL parameters.
2. **Generator blocks in dataset JSON** — Dataset files in `data/` can include a `generator` object; when loaded with `?gen_seed=`, the generator produces fresh data from the distribution spec.

All generation uses the sfc32 PRNG (same as simulation resampling) for full determinism. The `gen_seed` parameter controls generation; `seed` remains reserved for simulation resampling.

### Core generation parameters

| Parameter | Type | Default | Description | Example |
|-----------|------|---------|-------------|---------|
| `dist` | string | _(none)_ | Distribution family. Required for inline generation. Valid: `normal`, `gamma`, `exponential`, `bernoulli`, `binomial`, `poisson`, `uniform`, `lognormal`, `chisq`, `t`, `categorical`. | `?dist=normal` |
| `gen_seed` | string | _(none)_ | PRNG seed for data generation. Separate from `seed` (used for simulation resampling). When present with a generator-block dataset, triggers fresh generation instead of using stored rows. | `?gen_seed=hw3q2` |
| `n` | integer | _(varies)_ | Sample size. For inline generation, required. For generator blocks, overrides the block's default `n`. | `?n=50` |

### Distribution-specific parameters

| Parameter | Type | Default | Distributions | Description | Example |
|-----------|------|---------|---------------|-------------|---------|
| `mu` | float | `0` | normal, lognormal | Mean (or log-mean for lognormal). | `?mu=100` |
| `sigma` | float | `1` | normal, lognormal | Standard deviation (or log-SD for lognormal). | `?sigma=15` |
| `shape` | float | `1` | gamma | Shape parameter α. Must be > 0. | `?shape=2.5` |
| `scale` | float | `1` | gamma | Scale parameter β. Must be > 0. | `?scale=3` |
| `lambda` | float | `1` | exponential, poisson | Rate parameter. Must be > 0. | `?lambda=0.5` |
| `prob` | float | `0.5` | bernoulli, binomial | Success probability in [0, 1]. Uses `prob` instead of `p` to avoid conflict with the null hypothesis proportion parameter. | `?prob=0.3` |
| `trials` | integer | `10` | binomial | Number of trials. Must be > 0. | `?trials=20` |
| `a` | float | `0` | uniform | Lower bound. | `?a=2` |
| `b` | float | `1` | uniform | Upper bound. | `?b=8` |
| `df` | integer | `1` | chisq, t | Degrees of freedom. Must be > 0. | `?df=5` |

### Post-generation transforms

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `round` | integer | Round generated values to this many decimal places. | `?round=0` (integers) |
| `decimals` | float | Alias for `round` (rounding decimal places). | `?decimals=1` |
| `clip_min` | float | Clamp values to this lower bound after generation. | `?clip_min=0` |
| `clip_max` | float | Clamp values to this upper bound after generation. | `?clip_max=200` |

### Categorical generation

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `cats` | string | Comma-separated category labels. | `?cats=A,B,C` |
| `probs` | string | Comma-separated probabilities (should sum to ~1). | `?probs=0.5,0.3,0.2` |

### Two-group and regression parameters (planned)

These parameters are parsed and available in `StatLensParams` but not yet consumed by datagen. They are reserved for future two-group and regression data generation.

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `gen` | string | Generator type (legacy; prefer `dist` for new usage). | `?gen=normal` |
| `n1` | integer | Group 1 sample size (two-group). | `?n1=30` |
| `n2` | integer | Group 2 sample size (two-group). | `?n2=30` |
| `mu1` | float | Group 1 mean. | `?mu1=10` |
| `mu2` | float | Group 2 mean. | `?mu2=15` |
| `sigma1` | float | Group 1 standard deviation. | `?sigma1=3` |
| `sigma2` | float | Group 2 standard deviation. | `?sigma2=4` |
| `p1` | float | Group 1 proportion. | `?p1=0.4` |
| `p2` | float | Group 2 proportion. | `?p2=0.6` |
| `rho` | float | Correlation (paired, regression). | `?rho=0.7` |
| `intercept` | float | Regression intercept. | `?intercept=5.2` |
| `slope` | float | Regression slope. | `?slope=1.3` |
| `sigma_error` | float | Regression error standard deviation. | `?sigma_error=2.0` |
| `x_min` | float | Regression x lower bound. | `?x_min=0` |
| `x_max` | float | Regression x upper bound. | `?x_max=100` |
| `context` | string | Named context preset. | `?context=coins` |

### Example URLs

```
# Inline normal generation — 50 observations from N(100, 15), rounded to integers
simulate/bootstrap-mean/?dist=normal&mu=100&sigma=15&n=50&round=0&gen_seed=hw3q2

# Inline uniform generation — 200 observations from U(0, 10), 1 decimal place
explore/descriptive/?dist=uniform&a=0&b=10&n=200&decimals=1&gen_seed=demo1

# Inline categorical generation
explore/one-cat/?dist=categorical&n=300&cats=Yes,No,Maybe&probs=0.5,0.3,0.2&gen_seed=quiz4

# Generator block — dataset JSON with generator, fresh data per seed
simulate/bootstrap-mean/?dataset=heights_gen&gen_seed=student42
```

---

## Additional String Parameters

These are parsed by `url-params.js` and available in `StatLensParams`. Some are actively consumed; others are defined for cross-page linking and future use.

| Parameter | Type | Description | Active Use |
|-----------|------|-------------|------------|
| `stat` | string | Bootstrap statistic selector: `mean`, `median`, `sd`, `q1`, `q3` (bootstrap-mean). Also planned for inference pages: `prop`, `diff_mean`, `diff_prop`, `chisq`, `F`, `slope`. | **Active** (bootstrap-mean); Planned (others) |
| `direction` | string | Tail direction for simulation pages: `less`, `greater`, `two-sided`. | sim-app.js, one-sample-sim.js |
| `alt` | string | Alternative hypothesis direction for inference pages: `less`, `greater`, `two-sided`. Parsed/validated defensively but **intentionally not consumed** — see note. | **Not implemented (by design)** |
| `x_label` | string | X-axis label (regression). | Planned |
| `y_label` | string | Y-axis label (regression). | Planned |

> **Note on `alt` (by design, 2026-07-31):** StatLens deliberately does **not** let a URL force the alternative-hypothesis direction on the analytic inference tools. Choosing the direction of the alternative is a skill students are meant to exercise; pre-setting it via an embed would train them to skip that decision. The direction stays student-selectable in the tool. (The parameter is still parsed/validated so links carrying it don't error, but it has no effect.) If a prompt's stated alternative clashes with a dataset's default, fix the dataset's `inferenceContext` or the prompt wording rather than overriding via URL.

---

## Sanitization Rules

All parameter values are sanitized before use:

| Parameter class | Sanitization |
|----------------|-------------|
| Integer params (`n`, `B`, `ci`, `df`, `df1`, `df2`, `n1`, `n2`, `trials`, `round`) | Parsed as integer; must be finite and positive (> 0). |
| Float params (all numeric params above) | Parsed as float; must be finite. |
| `seed` | HTML tags and control characters stripped; truncated to 100 characters. |
| `dataset` | Only `[a-zA-Z0-9_-]` characters allowed (path traversal prevention). |
| `csv`, `json` | Must be HTTPS (or `http://localhost` / `http://127.0.0.1` for local development); truncated to 2,000 characters. |
| `summary` | Only `[a-zA-Z0-9_.:, -]` allowed; truncated to 2,000 characters. |
| `alt` | Must be exactly `less`, `greater`, or `two-sided`; all others rejected. |
| `data` | Each value parsed as float; non-finite values dropped; array truncated to 10,000 elements. |
| All other string params | HTML tags and control characters stripped; only `[a-zA-Z0-9_ -]` retained; lowercased. |

---

## Constructing Links

### Pattern for textbook callouts

Direct students to a specific tool with a pre-loaded dataset:

```
https://learnlens.org/statlens/{tool-path}/?dataset={id}
```

Example:

```
https://learnlens.org/statlens/simulate/bootstrap-mean/?dataset=penny_ages
```

### Pattern for graded assessments

Include a seed for reproducible output:

```
https://learnlens.org/statlens/{tool-path}/?dataset={id}&seed={seed}
```

Example:

```
https://learnlens.org/statlens/simulate/randomization-one-prop/?dataset=opportunity_cost&seed=hw3q5&direction=less
```

### Pattern for inline data (MyOpenMath)

Pass data directly in the URL when MOM generates per-student values:

```
https://learnlens.org/statlens/{tool-path}/?data={comma-separated-values}&seed={seed}
```

Example:

```
https://learnlens.org/statlens/simulate/bootstrap-mean/?data=12.3,15.1,9.8,11.2,14.7&seed=student42
```

### Pattern for distribution calculators

Pre-configure a distribution with specific parameters and shading:

```
https://learnlens.org/statlens/distribution/normal/?mu=100&sigma=15&tail=right
```

```
https://learnlens.org/statlens/distribution/t/?df=24&tail=both
```

### Pattern for summary-stats-only inference

When raw data is unavailable, pass summary statistics:

```
https://learnlens.org/statlens/inference/anova/?summary=A:30:12.5:2.1,B:28:14.2:1.8
```

### Pattern for instructor presentation mode

Override the activity mode for projection:

```
https://learnlens.org/statlens/simulate/randomization-diff-props/?activity=randomization-test-gated.json&mode=present
```

### Pattern for guided activities (textbook integration)

Load a step-by-step activity panel alongside any tool page. The activity JSON provides default URL params, so the link stays simple:

```
https://learnlens.org/statlens/{tool-path}/?activity={filename-or-url}
```

Example (bare filename — resolves to `activities/bootstrap-explore.json`):

```
https://learnlens.org/statlens/simulate/bootstrap-mean/?activity=bootstrap-explore.json
```

Example (external URL — activity hosted elsewhere):

```
https://learnlens.org/statlens/simulate/bootstrap-mean/?activity=https://example.com/activities/my-activity.json
```

The activity JSON's `params` object provides defaults (dataset, seed, ci, etc.), so those don't need to be in the URL. Any URL params explicitly set will override the activity defaults.

**Activity JSON schema:**
```json
{
  "title": "Activity Title",
  "tool": "simulate/bootstrap-mean",
  "params": { "dataset": "penny_ages", "ci": 95, "seed": "ch8demo" },
  "steps": [
    {
      "instruction": "What the student should do (supports **bold**, *italic*, `code`, [links](url))",
      "observe": "What to watch for (optional)",
      "reveal": "Explanation shown after clicking 'Show explanation' (optional)"
    }
  ]
}
```

### Pattern for calculator-only mode

Hide auto-generated interpretations so students write their own:

```
https://learnlens.org/statlens/inference/one-mean/?dataset=penny_ages&interpret=false
```

### Combining parameters

Parameters can be freely combined. Order does not matter.

```
https://learnlens.org/statlens/simulate/bootstrap-mean/?dataset=penny_ages&seed=exam1&ci=90&expert=true
```

---

## Conceptual Demo Parameters

### CI Coverage (`conceptual/ci-coverage/`)

Standalone page with its own population model. Supports URL parameters for dataset-based or custom populations.

| Parameter | Type | Default | Description | Example |
|-----------|------|---------|-------------|---------|
| `dataset` | string | _(none)_ | Load a bundled dataset as the population. The first numeric variable's values become the population from which subsamples are drawn. Hides the population shape selector. | `?dataset=penny_ages` |
| `mu` | float | `50` | Population mean for generated normal population. Only used when `dataset` is not set. Must be paired with `sigma`. | `?mu=10.4` |
| `sigma` | float | `10` | Population standard deviation for generated normal population. Only used when `dataset` is not set. Must be paired with `mu`. | `?sigma=8.1` |
| `n` | integer | `25` | Sample size for each CI. Range: 2–500. Sets the sample size input. | `?n=50` |
| `ci` | integer | `95` | Confidence level. Valid values: 90, 95, 99. Sets the CI level dropdown. | `?ci=90` |
| `catseye` | flag | _(off)_ | Start with the cat's-eye (peaked-plausibility) overlay enabled. `1`/`true` checks the "Show plausibility shape" box; off by default so the coverage headline stays clean. | `?catseye=1` |
| `method` | string | `t` | How each interval is built. `t` = classical x̄ ± t*·s/√n; `bootstrap` (alias `percentile`) = middle 95% of the bootstrap distribution; `se` = the bootstrap distribution's centre ± z of its own SEs (always symmetric); `bca` = percentile with the cut-points shifted for bias and skew. The three bootstrap methods draw 600 resamples per sample and cannot be re-widened from a stored SE, so changing `ci` on one redraws the run instead of rescaling the existing intervals. | `?method=bca` |

**Example: Matching textbook Figure 8.4 (penny ages, n = 50):**
```
https://learnlens.org/statlens/conceptual/ci-coverage/?dataset=penny_ages&n=50
```

**Example: Custom normal population:**
```
https://learnlens.org/statlens/conceptual/ci-coverage/?mu=10.4&sigma=8.1&n=50&ci=95
```

**Example: comparing interval methods on the failure case.** Right-skewed
population, small `n`, one link per method — the coverage rates separate:
```
https://learnlens.org/statlens/conceptual/ci-coverage/?method=t&n=8
https://learnlens.org/statlens/conceptual/ci-coverage/?method=bootstrap&n=8
https://learnlens.org/statlens/conceptual/ci-coverage/?method=se&n=8
https://learnlens.org/statlens/conceptual/ci-coverage/?method=bca&n=8
```
Measured on the page (right-skewed, nominal 95%, 1200 intervals per cell):
at n = 8 → t 88.4%, percentile 83.7%, ±2·SE 85.3%, BCa 85.8%; at n = 50 →
92.9% / 92.5% / 93.9% / 93.8%. Every method under-covers at small n, the gap to
nominal exceeds the gaps between methods, and BCa buys a point or two rather
than closing it.

### Decision Errors (`conceptual/decision-errors/`)

Standalone simulation page (imports `js/power-sim.js`). Runs repeated one-proportion z-tests of H₀: p = 0.50 vs Hₐ: p > 0.50 (one-sided). Read with `URLSearchParams`; activity-ready (waits for `window.__activityParamsReady`).

| Parameter | Type | Default | Description | Example |
|-----------|------|---------|-------------|---------|
| `truth` | string | `effect` | What is actually true: `effect` (Hₐ true) or `none` (H₀ true). | `?truth=none` |
| `ptrue` | integer | `65` | True success rate as a percent (50–95), used when `truth=effect`. | `?ptrue=55` |
| `n` | integer | `30` | Sample size per study. One of 10, 20, 30, 50, 100, 200. | `?n=100` |
| `alpha` | float | `0.05` | Significance level. One of `0.10`, `0.05`, `0.01`. | `?alpha=0.01` |
| `seed` | string | _(random)_ | PRNG seed for reproducible runs. | `?seed=ch8demo` |

Guided activity: `?activity=decision-errors.json` overlays a stepped Type I / Type II investigation.

### Power Lab (`conceptual/power-sim/`)

Standalone simulation page (imports `js/power-sim.js`). Models the same known-σ one-sample z-test as `distribution/power/`; the empirical reject-rate converges to the analytic power. Read with `URLSearchParams`.

| Parameter | Type | Default | Description | Example |
|-----------|------|---------|-------------|---------|
| `delta` | float | `0.5` | Effect size δ = μ₁ − μ₀. Set to 0 to demonstrate the Type I error rate. | `?delta=1` |
| `sigma` | float | `1` | Population standard deviation σ (> 0). | `?sigma=2` |
| `n` | integer | `30` | Sample size per study. | `?n=64` |
| `alpha` | float | `0.05` | Significance level. | `?alpha=0.01` |
| `tail` | string | `right` | Test direction: `left`, `right`, or `both`. | `?tail=both` |
| `seed` | string | _(random)_ | PRNG seed for reproducible runs. | `?seed=ch28demo` |

### Sampling Distribution Lab (`conceptual/sampling-lab/`)

Standalone page. Builds the sampling distribution of a statistic in a three-tier
view (population → one sample → sampling distribution), with honest spread/shape
framing, a freeze/compare control for two sample sizes, and both means and
proportions. Read with `URLSearchParams`; activity-ready (waits for
`window.__activityParamsReady`). This is **the** sampling-distribution tool.

| Parameter | Type | Default | Description | Example |
|-----------|------|---------|-------------|---------|
| `type` | string | `quant` | Population type: `quant` (sampling distribution of x̄) or `prop`/`cat` (sampling distribution of p̂). | `?type=prop` |
| `p` | float | `0.6` | Population proportion (proportion mode), 0.05–0.95. Sets the p slider. | `?p=0.5` |
| `shape` | string | `right-skewed` | Population shape (quantitative mode): `normal`, `right-skewed`, `left-skewed`, `uniform`, `bimodal`. | `?shape=normal` |
| `n` | integer | `30` | Sample size, 1–500. | `?n=40` |
| `seed` | string | _(random)_ | PRNG seed for reproducible draws (required for graded/activity use). | `?seed=beads60` |

Guided activity: `?activity=sampling-distribution-proportion.json` overlays a
predict-then-reveal walkthrough that builds the sampling distribution of p̂ and
contrasts more-samples vs larger-n.

---

### Why the Percentile CI Works (`conceptual/bootstrap-shift/`)

Standalone page. Two stages on one shared x-axis: Stage 1 builds the true
sampling distribution from repeated samples of a visible ~200-dot population;
Stage 2 freezes one sample and overlays the bootstrap distribution resampled
from it, with the 95% percentile CI drawn as a bracket. The page reports two
verdicts every frame — whether x̄ fell in the central 95% of the sampling
distribution, and whether the percentile CI captured μ — so the "shift"
justification for the percentile method can be checked rather than asserted.
Read with `URLSearchParams` at load.

| Parameter | Type | Default | Description | Example |
|-----------|------|---------|-------------|---------|
| `shape` | string | `normal` | Population shape: `normal` (mean 50, SD 5) or `skewed` (right-skewed, same mean and SD). The skewed population is the stress test — the clean "if and only if" needs a symmetric sampling distribution, so disagreements between the two verdicts get noticeably more common. | `?shape=skewed` |
| `n` | integer | `10` | Sample size, 2–60. Small `n` is the interesting case: the bootstrap SE is estimated from one sample, so the bootstrap distribution is not exactly a shift of the sampling distribution. Raising `n` makes the two verdicts agree far more often. | `?n=30` |
| `stage` | integer | `1` | Which stage to open on. `1` = sampling distribution; `2` = bootstrap (jumps straight to a finished picture — the full sampling distribution, a frozen sample, and its complete bootstrap distribution). | `?stage=2` |
| `xbar` | float | _(μ + 1.2 SE)_ | Target mean for the frozen "original sample" in Stage 2. The page picks the pre-drawn sample whose mean is closest, so the displayed x̄ is near, not exactly, this value. Clamped to the slider's range (roughly μ ± 3.5 SE). | `?stage=2&xbar=53.5` |
| `seed` | string | _(random)_ | PRNG seed for the sample pool and the bootstrap resamples. Required for graded or activity use — without it the population is fixed but the draws are not. | `?seed=todd1` |

Useful links: `?stage=2&seed=demo` opens the finished exhibit; `?shape=skewed&n=10&stage=2`
opens the case where the percentile method's justification is weakest (and which
`ci_method=bca` on the bootstrap pages exists to correct).

---

## Practice Parameters

### Conclusion writing (`practice/conclusions/`)

Scope the scenario pool to the inference procedures students have learned so far
(e.g. a Part III "Compute" capstone shouldn't surface χ² scenarios). The tool
produces six procedure types: `one-mean`, `paired`, `two-means`, `one-prop`,
`two-props`, `chisq`. Default (no param) = full pool.

| Parameter | Type | Default | Description | Example |
|-----------|------|---------|-------------|---------|
| `scope` | string | _(full pool)_ | Named scope. `compute` = means + proportions only (`one-prop`, `two-props`, `one-mean`, `two-means`, `paired` — **no χ²**); `apply` / `all` = full pool. **`calculate` is a deprecated alias for `compute`** — still honoured, never removed, but new links should use `compute` (the textbook unit was renamed Calculate → Compute). | `?scope=compute` |
| `procedures` | string (CSV) | _(full pool)_ | Explicit comma-list of procedure types to include. Accepts the six testTypes plus common aliases (`two-prop`→`two-props`, `two-mean`→`two-means`, `chi-square`/`chisq-gof`/`chisq-indep`→`chisq`). Tags with no scenarios (`anova`, `slope`) are accepted but contribute nothing. An all-unrecognized list falls back to the full pool. | `?procedures=one-prop,two-prop,one-mean,two-mean,paired` |

`scope` takes precedence over `procedures` when both are present.

---

## Tool Path Reference

| Path | Tool | Data Source |
|------|------|-------------|
| `simulate/bootstrap-mean/` | Bootstrap CI for a mean | dataset, data, csv, json |
| `simulate/bootstrap-prop/` | Bootstrap CI for a proportion | dataset, csv, json |
| `simulate/bootstrap-paired/` | Bootstrap CI for paired mean difference | dataset, csv, json |
| `simulate/bootstrap-two-means/` | Bootstrap CI for difference in means | dataset, csv, json |
| `simulate/bootstrap-two-props/` | Bootstrap CI for difference in proportions | dataset, csv, json |
| `simulate/bootstrap-slope/` | Bootstrap CI for regression slope | dataset, csv, json |
| `simulate/randomization-one-prop/` | Randomization test for one proportion | dataset, csv, json |
| `simulate/randomization-one-mean/` | Randomization test for one mean | dataset, data, csv, json |
| `simulate/randomization-diff-means/` | Randomization test for difference in means | dataset, csv, json |
| `simulate/randomization-diff-props/` | Randomization test for difference in proportions | dataset, csv, json |
| `simulate/randomization-paired/` | Randomization test for paired data | dataset, csv, json |
| `simulate/randomization-anova/` | Randomization test for ANOVA (permutation F-test) | dataset, csv, json |
| `simulate/randomization-correlation/` | Randomization test for correlation | dataset, csv, json |
| `simulate/randomization-chisq/` | Randomization test for chi-squared | dataset, csv, json |
| `distribution/normal/` | Normal distribution calculator | mu, sigma, tail |
| `distribution/t/` | t distribution calculator | df, tail |
| `distribution/chisq/` | Chi-squared distribution calculator | df, tail |
| `distribution/f/` | F distribution calculator | df1, df2, tail |
| `distribution/binomial/` | Binomial distribution calculator | _(UI only)_ |
| `distribution/power/` | Power & error visualizer (Type I/II, power) | alpha, n, delta, sigma, tail |
| `explore/descriptive/` | Descriptive statistics & plots | dataset, data, csv, json |
| `explore/regression/` | Scatterplot & regression | dataset, csv, json |
| `explore/categorical/` | Categorical data explorer | dataset, csv, json |
| `explore/one-cat/` | One categorical variable explorer | dataset, csv, json |
| `explore/grouped/` | Grouped numeric data explorer | dataset, csv, json |
| `explore/dotplot-editor/` | Interactive dotplot editor with live stats | _(UI only — presets)_ |
| `explore/multi/` | Multi-variable data explorer (8 chart types) | dataset, csv, json |
| `explore/psychic/` | Are You Psychic? coin-guessing intro to testing | n |
| `explore/random-sequence/` | Stump the Chump human-vs-random sequences | n |
| `explore/regression-by-eye/` | Regression by eye exercise | dataset, data, csv, json, seed |
| `inference/one-mean/` | One-sample t-test | dataset, data, csv, json |
| `inference/one-prop/` | One-proportion z-test | dataset, csv, json |
| `inference/two-means/` | Two-sample t-test | dataset, data, csv, json |
| `inference/paired/` | Paired t-test | dataset, data, csv, json |
| `inference/two-props/` | Two-proportion z-test | dataset, csv, json |
| `inference/chisq/` | Chi-squared test | dataset, csv, json |
| `inference/slope/` | Regression slope t-test | dataset, csv, json |
| `inference/anova/` | One-way ANOVA | dataset, csv, json, summary |
| `inference/multiple-comparisons/` | Pairwise CIs for 3+ groups (Tukey / Bonferroni) | dataset, posthoc, summary, alpha |
| `inference/estimate/one-mean/` | Confidence interval for a mean (estimation only) | dataset, data, csv, json |
| `inference/estimate/one-prop/` | Confidence interval for a proportion | dataset, csv, json |
| `inference/estimate/two-means/` | Confidence interval for a difference in means (Welch) | dataset, csv, json |
| `inference/estimate/paired/` | Confidence interval for a mean difference (paired) | dataset, csv, json |
| `inference/estimate/two-props/` | Confidence interval for a difference in proportions | dataset, csv, json |
| `inference/estimate/slope/` | Confidence interval for a regression slope | dataset, csv, json |
| `conceptual/sampling-lab/` | Sampling Distribution Lab (means + proportions, 3-tier, freeze/compare) | type, p, shape, n, seed |
| `conceptual/ci-coverage/` | CI coverage demo (t / percentile / ±z·SE / BCa) | mode, dataset, mu, sigma, n, ci, method, catseye |
| `conceptual/bootstrap-shift/` | Why the Percentile CI Works (sampling vs bootstrap distribution on one axis) | shape, n, stage, xbar, seed |
| `conceptual/randomization-test/` | Randomization test walkthrough — **redirects** to `simulate/randomization-diff-props/?activity=randomization-test-gated.json` (legacy URL, still honored) | mode, dataset |
| `conceptual/decision-errors/` | Decision Errors (one-proportion simulation: Type I / Type II) | truth, ptrue, n, alpha, seed |
| `conceptual/power-sim/` | Power Lab (simulation: empirical power + p-value dance) | delta, sigma, n, alpha, tail, seed |
| `data/builder/` | Dataset Builder (CSV/TSV → StatLens JSON) | _(UI only)_ |

---

## Source Files

- **Parser**: `js/url-params.js` — central `parseParams()` function, sanitization, and parameter classification
- **Type definitions**: `js/types.js` — `StatLensParams` typedef with all parameter descriptions
- **Data generation**: `js/datagen.js` — `generateFromConfig()`, `configFromUrlParams()`, `configFromGenerator()`, all distribution samplers
- **Settings (mode/expert/interpret)**: `js/settings.js` — `getActivityMode()`, `getExpertMode()`, `getShowInterpretations()`
- **Data panel**: `js/page-utils.js` — `initDataPanel()` handles `dataset`, `data`, `csv`, `json` auto-loading
- **Simulation shared**: `js/sim-app.js` — consumes `seed`, `data`, `dataset`, `ci`, `direction`
- **One-sample sim**: `js/one-sample-sim.js` — consumes `p`, `null_value`, `direction`
- **Distribution shared**: `js/dist-app.js` — consumes distribution params and `tail`
- **Link builder**: `js/page-utils.js` — `buildSimLink()` constructs cross-page URLs
