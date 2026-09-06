# StatLens Tool Manifest

> **For textbook authors and agents**: This document catalogs every StatLens tool page, its URL parameters, compatible datasets, and suggested embed configurations for linking from the Stat 145 textbook.
>
> **Base URL**: `https://learnlens.org/statlens/`
>
> **Last updated**: 2026-06-06 (added Power Visualizer, Multi-variable Explorer, Are You Psychic?, Stump the Chump, Dataset Builder; aligned to the 29-chapter / 5-part textbook structure)
>
> **Changes since 2026-06-06** (not yet folded into the entries below — full refresh planned for the v1 merge): see the "Added since this snapshot" block in [`capabilities-snapshot.md`](capabilities-snapshot.md) and the changelog in `statlens-textbook-contract.md`. Production-live: Activities Catalog page, CI-interpretation + Jelly Bean activities, distribution-calculator Between/Symmetric regions (`lo`/`hi`), per-tool Copy-link, editable null `δ₀`. Dev-only (`mechanism-strips` branch, lands at v1): summary-cards / dotplot resampling mechanisms + `mechview` param.

---

## Table of Contents

- [Global URL Parameters](#global-url-parameters)
- [Explore Tools](#explore-tools)
  - [Descriptive Statistics](#descriptive-statistics)
  - [Regression](#regression)
  - [Regression by Eye](#regression-by-eye)
  - [Categorical Data (Two Variables)](#categorical-data-two-variables)
  - [One Categorical Variable](#one-categorical-variable)
  - [Grouped Statistics](#grouped-statistics)
  - [Dotplot Editor](#dotplot-editor)
  - [Data Explorer (Multi-Variable)](#data-explorer-multi-variable)
  - [Are You Psychic?](#are-you-psychic)
  - [Stump the Chump](#stump-the-chump)
- [Simulation Tools — Bootstrap](#simulation-tools--bootstrap)
  - [Bootstrap: One Mean](#bootstrap-one-mean)
  - [Bootstrap: One Proportion](#bootstrap-one-proportion)
  - [Bootstrap: Paired Differences](#bootstrap-paired-differences)
  - [Bootstrap: Difference in Means](#bootstrap-difference-in-means)
  - [Bootstrap: Difference in Proportions](#bootstrap-difference-in-proportions)
  - [Bootstrap: Regression Slope](#bootstrap-regression-slope)
- [Simulation Tools — Randomization](#simulation-tools--randomization)
  - [Randomization: Difference in Means](#randomization-difference-in-means)
  - [Randomization: Difference in Proportions](#randomization-difference-in-proportions)
  - [Randomization: One Proportion](#randomization-one-proportion)
  - [Randomization: One Mean](#randomization-one-mean)
  - [Randomization: Paired Differences](#randomization-paired-differences)
  - [Randomization: Chi-Square](#randomization-chi-square)
  - [Randomization: Correlation](#randomization-correlation)
  - [Randomization: ANOVA](#randomization-anova)
- [Distribution Calculators](#distribution-calculators)
  - [Normal Distribution](#normal-distribution)
  - [t Distribution](#t-distribution)
  - [Chi-Square Distribution](#chi-square-distribution)
  - [F Distribution](#f-distribution)
  - [Binomial Distribution](#binomial-distribution)
  - [Power & Error Visualizer](#power--error-visualizer)
- [Traditional Inference](#traditional-inference)
  - [One-Sample t-Test](#one-sample-t-test)
  - [Two-Sample t-Test](#two-sample-t-test)
  - [Paired t-Test](#paired-t-test)
  - [One-Proportion z-Test](#one-proportion-z-test)
  - [Two-Proportion z-Test](#two-proportion-z-test)
  - [Chi-Square Test of Independence](#chi-square-test-of-independence)
  - [Regression Slope t-Test](#regression-slope-t-test)
  - [One-Way ANOVA](#one-way-anova)
- [Conceptual Demonstrations](#conceptual-demonstrations)
  - [Sampling Distribution Lab](#sampling-distribution-lab)
  - [Sampling Distribution Lab](#sampling-distribution-lab)
  - [CI Coverage Simulator](#ci-coverage-simulator)
  - [Randomization Test Walkthrough](#randomization-test-walkthrough)
  - [Decision Errors (Simulation)](#decision-errors-simulation)
  - [Power Lab (Simulation)](#power-lab-simulation)
- [Practice Tools](#practice-tools)
  - [Conclusion Practice](#conclusion-practice)
  - [Guess the Correlation](#guess-the-correlation)
- [Utilities (Instructor-Facing)](#utilities-instructor-facing)
  - [Dataset Builder](#dataset-builder)
- [Dataset Reference](#dataset-reference)

---

## Landing Page: "By Course Phase" Tab Mapping

The landing page's "By Course Phase" view organizes tools into 5 tabs matching the textbook's course progression (now **29 chapters in 5 parts**):

| Tab | Textbook Part | Chapters | What's Here |
|-----|---------------|----------|-------------|
| **Explore** | Part I | Ch 1–5 | Explore tools + Multi-variable Explorer, Dotplot Editor, Guess the Correlation |
| **Simulate** | Part II | Ch 6–10 | Core bootstrap/randomization (one-mean, one-prop, two-group, paired) + Sampling Dist, Randomization Test labs, Are You Psychic?, Stump the Chump + Power Visualizer (Decision Errors, Ch 8) |
| **Compute** | Part III | Ch 11–14 | Traditional inference, split into a Confidence Interval and a Hypothesis Test entry per procedure (one-prop z, two-prop z, one-mean t, two-group, paired) + Normal & t calculators + CI Coverage, Conclusion Practice labs |
| **Apply** | Part IV | Ch 15–21 | Chi-square, ANOVA, correlation, regression (all three methods: explore, simulation, traditional) + Chi-Square & F calculators + Guess the Correlation |
| **Foundations** | Part V | Ch 22–29 | Binomial & Normal calculators + CI Coverage lab + **Power Visualizer (live at `distribution/power/`)** |

The **Compute** tab was renamed from "Calculate" (2026-07-14) to match the textbook's Unit III rename; see `?scope=compute` in url-api.md.

Tools may appear in multiple tabs when they serve multiple course phases (e.g., Normal calculator in both Compute and Foundations; Power Visualizer in both Simulate/Decision-Errors and Foundations/Power).

---

## Global URL Parameters

These parameters are available across most pages via the shared `parseParams()` module and `initDataPanel()` infrastructure.

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `dataset` | string | Auto-load a bundled dataset by ID | `dataset=penny_ages` |
| `data` | comma-separated numbers | Inline numeric data (max 10,000 values) | `data=4.2,3.8,5.1` |
| `seed` | string | Deterministic PRNG seed for reproducibility | `seed=hw3q2` |
| `csv` | URL | Fetch external CSV file | `csv=https://example.com/data.csv` |
| `json` | URL | Fetch external JSON dataset | `json=https://example.com/data.json` |
| `var` | string | Pre-select a variable by name | `var=weight` |
| `x` | string | Pre-select x variable (regression/slope pages) | `x=area` |
| `y` | string | Pre-select y variable (regression/slope pages) | `y=price` |
| `group` | string | Pre-select grouping variable | `group=treatment` |
| `response` | string | Pre-select response variable | `response=weight` |
| `success` | string | Define success category (proportion pages) | `success=promoted` |
| `label` | string | Custom axis label for inline data | `label=Temperature` |
| `mode` | string | Activity mode: `discover` or `present` | `mode=present` |

**Note on `dataset`**: The value must match an `id` field in `data/datasets.json`. Dataset IDs use underscores (e.g., `penny_ages`, `sex_discrimination`). The dataset is only loaded if it passes the page's filter (e.g., regression pages only load regression-type datasets).

---

## Explore Tools

### Descriptive Statistics

**Path:** `explore/descriptive/`
**Category:** Explore
**Description:** Displays histogram, dotplot, or boxplot with full summary statistics (mean, median, SD, Q1, Q3, IQR, range, min, max) for a single quantitative variable. Includes bin frequency table, density curve overlay, relative frequency toggle, and group filter when data has a categorical variable.
**Concepts:** Distribution shape, center, spread, five-number summary, histogram bin width, dotplot vs histogram comparison, outlier identification

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `dataset` | string | Pre-load a bundled dataset | `dataset=penny_ages` |
| `data` | numbers | Inline numeric values | `data=3,5,7,8,12,15` |
| `label` | string | Custom variable label | `label=Temperature` |

**Compatible Datasets:** Datasets where `hasNumeric === true`, `hasCategorical === false`, `type !== 'regression'`, and `type !== 'paired'`. Includes: `penny_ages`, `coast_starlight`, `dolphins_mercury`, `bdims_hgt`, `births14_weight`, `loan50_interest`, `ames_price`, `ames_area`, `email50_num_char`, `county_pop`, `county_poverty`, `county_income`, `loan50_income`, `loan50_amount`, `run17`, `nba_heights`, `ball_bearing`, `manhattan`, `fastfood_calories`

**Textbook Integration Notes:** Use for introducing distributions (Ch. 2), five-number summary, and comparing center/spread measures. Link with `?dataset=` to pre-load the specific dataset discussed in the text. Cross-links automatically appear suggesting Grouped Statistics or Regression when a dataset has additional variables.

---

### Regression

**Path:** `explore/regression/`
**Category:** Explore
**Description:** Interactive scatterplot with regression line, residual plot, and regression statistics (r, R-squared, slope, intercept, residual SE). Supports toggling the regression line and residual display, variable selection from multi-column datasets.
**Concepts:** Scatterplot, correlation, linear regression, least squares line, R-squared, residual plot, slope interpretation, intercept interpretation

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `dataset` | string | Pre-load a regression dataset | `dataset=ames_regression` |

**Compatible Datasets:** Datasets where `type === 'regression'`. Includes: `ames_regression`, `possum_regression`, `elmhurst_regression`, `mariokart_regression`, `loan50_regression`, `county_regression`, `bac`, `duke_forest`, `starbucks`, `babies_crawl`, `births14_regression`, `midterms_house`, `coast_starlight_regression`, `gpa_study_hours`, `cherry`, `satgpa`, `evals`, `gifted`

**Textbook Integration Notes:** Use for introducing bivariate relationships (Ch. 7) and regression diagnostics (Ch. 24-25). The residual plot toggle is valuable for assessing linearity conditions.

---

### Regression by Eye

**Path:** `explore/regression-by-eye/`
**Category:** Explore (Lab)
**Description:** Interactive line-fitting activity. Students drag a line to fit data, toggle between absolute errors (SAE with dashed residual lines) and squared errors (SSE with visual squares), and compare to the mathematically optimal best-fit line for each metric (LAD for absolute, OLS for squared). Equation and metric values float on the chart for mobile visibility. Coefficients update live for exercise integration.
**Concepts:** Least squares regression, least absolute deviations, residuals, sum of squared errors (SSE), sum of absolute errors (SAE), line fitting, regression line, slope, intercept

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `dataset` | string | Pre-load a regression dataset | `dataset=possum_regression` |
| `exercise` | boolean | Hides "Show best-fit line" checkbox | `exercise=true` |
| `embed` | boolean | Compact mode for iframe embedding (hides header, data panel) | `embed=true` |
| `seed` | string | Deterministic random data generation (same seed = same scatterplot) | `seed=hw5q3` |
| `n` | integer | Number of random data points (default: random 15-25) | `n=12` |
| `metric` | string | Lock error metric: `squared` (SSE) or `absolute` (SAE) | `metric=squared` |
| `show` | string | Comma-separated layers to enable on load: `residuals`, `bestfit` | `show=residuals` |
| `hide` | string | Comma-separated controls to hide: `toggle`, `bestfit`, `residuals` | `hide=toggle` |
| `slope` | float | True slope for random data generating model | `slope=2.5` |
| `intercept` | float | True intercept for random data generating model | `intercept=10` |
| `sigma_error` | float | Noise fraction for random data (0-1) | `sigma_error=0.3` |
| `x` | string | Pre-select X variable from dataset | `x=total_l` |
| `y` | string | Pre-select Y variable from dataset | `y=head_l` |
| `readonly` | boolean | Disables dragging and controls (for post-grading review) | `readonly=true` |

**Compatible Datasets:** Datasets where `type === 'regression'`. Same as the Regression explore tool.

**LMS Integration Notes:** For Canvas/MOM/WebWork iframe embedding, use `?embed=true&seed=X&exercise=true`. The `seed` param ensures deterministic random data — same seed produces identical scatterplot on every load. Combine with `slope`/`intercept` to control the true generating model for known-answer grading. The `metric=squared&hide=toggle` combination locks students into SSE-only mode.

**Textbook Integration Notes:** Use for Ch. 19 (Linear Regression) to build intuition for what "least squares" means. The Absolute/Squared toggle lets instructors contrast L1 vs L2 fitting. The progressive reveal (residuals → best-fit line) supports the classroom build-up. In exercise mode (`?exercise=true`), students must find the best-fit line by dragging and enter coefficients into MOM.

---

### Scatterplot Editor

**Path:** `explore/scatterplot-editor/`
**Category:** Explore (interactive)
**Description:** The 2-D analog of the Dotplot Editor: drag data points, click empty space to add a point, click a point to remove it, and watch the least-squares line, r, R², slope, and intercept update live. Built to make **leverage vs. influence** tangible — pull a point far out in x and the OLS line chases it (high leverage + influence); pull it far in y near mid-x and it barely moves the line (an outlier). Optional residual overlay and a "high-influence point" flag (the point whose removal shifts the slope most). Presets (linear / weak / none / one far-out point) or load a regression-type dataset.
**Concepts:** Least-squares regression, correlation (r), R², leverage, influence, outliers, residuals, slope sensitivity

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `preset` | string | Starting scatter: `linear`, `weak`, `none`, `leverage` | `preset=leverage` |
| `dataset` | string | Load a regression-type dataset (first two numeric vars) | `dataset=possum_regression` |
| `seed` | string | Deterministic starting scatter for presets | `seed=demo` |

**Textbook Integration Notes:** Ch 7 (bivariate) and Ch 20/22 (regression diagnostics) — the manipulate→observe tool for leverage and influential points (`original-22-05`, `fig-leverage-influence`). Complements `explore/regression-by-eye/` (which drags the *line*, points fixed) — here the *points* move.

---

### Categorical Data (Two Variables)

**Path:** `explore/categorical/`
**Category:** Explore
**Description:** Contingency table with four display modes (counts, row proportions, column proportions, cell proportions) and bar chart with four modes (stacked, side-by-side, filled, relative frequency). Includes chart-table color linking and variable swap button.
**Concepts:** Contingency table, conditional proportions, marginal proportions, stacked/side-by-side/mosaic bar charts, independence vs association

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `dataset` | string | Pre-load a two-variable categorical dataset | `dataset=ask` |

**Compatible Datasets:** Datasets where `hasNumeric === false`, `hasCategorical === true`, and there are 2+ categorical variables. Includes: `sex_discrimination`, `opportunity_cost`, `cpr`, `yawn`, `ask`, `diabetes2`, `lizard_habitat`, `immigration`, `heart_transplant`, `malaria`, `migraine`, `fish_oil_18`, `mammogram`, `resume`, `ucb_admit`, `cards`, `burger`, `dream`, `biontech_adolescents`, `sinusitis`, `smallpox`, `smoking`, `drug_use`

**Textbook Integration Notes:** Use for introducing contingency tables (Ch. 4) and exploring categorical associations before formal chi-square tests.

---

### One Categorical Variable

**Path:** `explore/one-cat/`
**Category:** Explore
**Description:** Frequency table (count + proportion) and bar chart for a single categorical variable. Supports frequency and relative frequency chart modes. Includes spreadsheet editor and summary table (category name + count) input.
**Concepts:** Frequency table, bar chart, proportion, relative frequency

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `dataset` | string | Pre-load a one-variable categorical dataset | `dataset=jury` |

**Compatible Datasets:** Datasets where `hasNumeric === false`, `hasCategorical === true`, and there is exactly 1 categorical variable. Includes: `medical_consultant`, `transplant_survival`, `stent30`, `jury`, `env_regulation`, `supreme_court`

**Textbook Integration Notes:** Use for introducing categorical data summaries (Ch. 2). Good entry point before two-variable categorical analysis.

---

### Grouped Statistics

**Path:** `explore/grouped/`
**Category:** Explore
**Description:** Side-by-side comparison of a quantitative variable across groups defined by a categorical variable. Offers four chart types (boxplot, dotplot, histogram, density overlay) and a grouped summary statistics table (n, mean, SD, five-number summary, IQR, range per group). Shared axis domains across groups for fair comparison.
**Concepts:** Comparing distributions, side-by-side boxplots, grouped statistics, within-group vs between-group variability

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `dataset` | string | Pre-load a dataset with numeric and categorical variables | `dataset=stem_cell` |

**Compatible Datasets:** Datasets where `hasNumeric === true` AND `hasCategorical === true`. Includes: `stem_cell`, `births14_smoke`, `ncbirths_smoke`, `lizard_run`, `epa2021_mpg`, `classdata`, `nyc_marathon`, `mlb_players_18`, `plant_growth`, `hsb2_math`, `evals_rank`, `fastfood_anova`

**Textbook Integration Notes:** Use for comparing groups before introducing formal two-sample tests (Ch. 20) or ANOVA (Ch. 22). The density overlay is useful for checking normality conditions.

---

### Dotplot Editor

**Path:** `explore/dotplot-editor/`
**Category:** Explore (Lab)
**Description:** Interactive dotplot where students click the number line to add points and click existing dots to remove them. Live summary statistics table updates on every change (n, mean, median, SD, IQR, range, min, Q1, Q3, max). Includes five presets (symmetric, skewed, bimodal, uniform, empty), undo support (Ctrl+Z), boxplot overlay toggle, and a challenge mode that presents a target boxplot for students to match by building a dataset.
**Concepts:** Distribution shape, center vs spread, effect of individual points on statistics, mean vs median sensitivity, boxplot construction, outlier effects, data-to-summary relationship

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| (none page-specific) | | Uses built-in presets; no URL parameter loading | |

**Compatible Datasets:** N/A (students build data interactively; no dataset loading)

**Textbook Integration Notes:** Use for Ch. 4 (describing distributions). The challenge mode is particularly valuable for reinforcing that many different datasets can produce the same boxplot summary. In class, have students explore how adding an outlier shifts the mean but barely moves the median. The undo button encourages experimentation without fear of "breaking" the data.

---

### Data Explorer (Multi-Variable)

**Path:** `explore/multi/`
**Category:** Explore
**Description:** A multi-variable exploratory-data-analysis workspace. Loads a dataset (dropdown, pasted CSV, or uploaded file) and lists its variables in a sidebar. The student selects one or two variables, then chooses among eight chart types — histogram, dotplot, boxplot, bar chart, pie chart, waffle chart, scatterplot, density — and the tool renders the chart plus summary statistics. Conditional controls appear based on the selection (bins for histograms, density overlay, regression line for scatterplots, bar layout mode, contingency-table display mode for two categoricals). Intended as the "decision-making" EDA capstone tool: pick variables, pick the right display.
**Concepts:** Choosing an appropriate display for a variable type, univariate vs bivariate exploration, numeric vs categorical summaries, association

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `dataset` | string | Pre-load a bundled dataset | `dataset=county_multi` |
| `csv` | URL | Fetch external CSV | `csv=https://…` |
| `json` | URL | Fetch external JSON dataset | `json=https://…` |

Note: variable selection and chart type are **not** URL-driven — only data loading is. (If the textbook needs deep-linkable variable/chart presets here, file a contract request.)

**Compatible Datasets:** Datasets with multiple variables (explore- and regression-type datasets such as `county_multi`, `ames_regression`, `evals`).

**Textbook Integration Notes:** Use in Ch. 1 (Introduction to Data) and Ch. 5 (Relationships) to let students freely explore a multi-column dataset and practice matching display type to variable type. Pairs well with the single-purpose explore tools once students know which display they want.

---

### Are You Psychic?

**Path:** `explore/psychic/`
**Category:** Explore (Lab)
**Description:** A coin-guessing game that introduces hypothesis-testing logic informally. The student predicts the outcome of N fair-coin flips (Heads/Tails) one at a time, then sees their score with an interpretation of whether it looks like genuine ability or ordinary luck. The page then runs an in-page simulation of many random guessers, building a null distribution against which the student's score is compared — the conceptual seed of a p-value, before any formal vocabulary.
**Concepts:** Chance vs signal, null model, sampling under "just guessing," building a reference distribution, intuition for p-values

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `n` | integer | Number of prediction trials. Default 16; clamped to 4–50. | `n=20` |

*(A `?context=` framing switch is mentioned in a code comment but is not currently implemented.)*

**Compatible Datasets:** N/A (internally generated coin flips)

**Textbook Integration Notes:** Use early in Part II (Ch. 6 Sampling Variability / Ch. 7 Randomization Tests) as a gentle on-ramp to the testing framework before students see formal hypotheses.

---

### Stump the Chump

**Path:** `explore/random-sequence/`
**Category:** Explore (Lab)
**Description:** The student types an H/T sequence intended to *look* random (target length configurable). The tool then generates a true-random sequence of equal length and presents a side-by-side comparison: proportion of heads, longest run, number of runs, average run length, alternation rate, and a run-length frequency distribution with dotplots. The reveal shows that human-made "random" sequences alternate too often and have runs that are too short — real randomness is clumpier than people expect.
**Concepts:** Misconceptions about randomness, runs and run length, independence, why real random data clumps

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `n` | integer | Target sequence length. Default 40; clamped to 20–100. | `n=50` |

**Compatible Datasets:** N/A (random sequences generated internally; human input via text field)

**Textbook Integration Notes:** Use in Ch. 6 (Sampling Variability) to build intuition for what randomness actually looks like. Pairs naturally with Are You Psychic?.

---

## Simulation Tools — Bootstrap

All simulation pages share a common architecture (via `sim-app.js` or standalone modules). They support `+1`, `+10`, `+100`, `+1000` sample generation, dotplot/histogram toggle, CI level selection, and optional theory curve overlay.

### Bootstrap: One Mean

**Path:** `simulate/bootstrap-mean/`
**Category:** Simulate
**Description:** Bootstrap confidence interval for a single population mean. Resamples with replacement from the original data, computes the sample statistic (mean, median, SD, Q1, or Q3), and builds the bootstrap distribution. Supports percentile CI at 90%, 95%, or 99%.
**Concepts:** Bootstrap resampling, sampling variability, confidence interval construction, percentile method, sampling distribution of the mean

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `dataset` | string | Pre-load a one-sample numeric dataset | `dataset=penny_ages` |
| `data` | numbers | Inline numeric data | `data=4.2,3.8,5.1,6.0` |
| `seed` | string | Deterministic seed for reproducibility | `seed=hw5q1` |
| `ci` | integer | Confidence level (90, 95, or 99) | `ci=90` |
| `direction` | string | Alternative direction (less, greater, two-sided) | `direction=greater` |

**Compatible Datasets:** Same as Descriptive Statistics — one-variable numeric datasets (type `bootstrap` or `explore` with `hasNumeric` and not categorical/regression/paired).

**Textbook Integration Notes:** Core tool for Ch. 12 (bootstrap CI introduction) and Ch. 19 (bootstrap CI for means). Pre-load with `?dataset=penny_ages&seed=demo1` for reproducible classroom demonstrations. The statistic selector (mean/median/SD/Q1/Q3) allows exploring bootstrap distributions for different parameters.

---

### Bootstrap: One Proportion

**Path:** `simulate/bootstrap-prop/`
**Category:** Simulate
**Description:** Bootstrap confidence interval for a single population proportion. Resamples the categorical outcome variable with replacement, computes the sample proportion for each resample. Includes success outcome selector.
**Concepts:** Bootstrap for proportions, sampling variability of proportions, CI for a proportion

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `dataset` | string | Pre-load a categorical dataset | `dataset=medical_consultant` |
| `seed` | string | Deterministic seed | `seed=exam2q3` |
| `ci` | integer | Confidence level | `ci=95` |

**Compatible Datasets:** Datasets with `type === 'bootstrap_prop'`. Includes: `medical_consultant`, `transplant_survival`, `stent30`

**Textbook Integration Notes:** Use for Ch. 12 and Ch. 16 (bootstrap CI for proportions). Students select which outcome counts as "success" before running the simulation.

---

### Bootstrap: Paired Differences

**Path:** `simulate/bootstrap-paired/`
**Category:** Simulate
**Description:** Bootstrap confidence interval for paired mean differences. Computes differences (var1 - var2) for each pair, then bootstraps the differences. Shows mechanism strip with paired data and the resampled differences.
**Concepts:** Paired data, mean difference, bootstrap CI for paired differences, dependent samples

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `dataset` | string | Pre-load a paired dataset | `dataset=textbooks` |
| `seed` | string | Deterministic seed | `seed=demo` |
| `ci` | integer | Confidence level | `ci=95` |

**Compatible Datasets:** Datasets with `type === 'paired'`. Includes: `textbooks`, `hsb2_read_write`, `friday_traffic`, `helium`, `twins`, `prison`

**Textbook Integration Notes:** Use for Ch. 20 (paired data) and Ch. 21 (inference for paired data). Pre-load `?dataset=textbooks` for the classic UCLA vs Amazon textbook price comparison.

---

### Bootstrap: Difference in Means

**Path:** `simulate/bootstrap-two-means/`
**Category:** Simulate
**Description:** Bootstrap confidence interval for the difference in two population means. Resamples independently within each group, computes the difference in group means. Two-group mechanism strip shows original and resampled group distributions.
**Concepts:** Two-sample comparison, bootstrap CI for difference in means, independent samples

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `dataset` | string | Pre-load a two-group numeric dataset | `dataset=stem_cell` |
| `seed` | string | Deterministic seed | `seed=demo` |
| `ci` | integer | Confidence level | `ci=95` |

**Compatible Datasets:** Datasets with `type === 'randomization'` (numeric response, categorical group). Includes: `stem_cell`, `births14_smoke`, `ncbirths_smoke`, `lizard_run`, `epa2021_mpg`

**Textbook Integration Notes:** Use for Ch. 20 (two-sample bootstrap). Often used back-to-back with the randomization test page for the same dataset to compare CI vs hypothesis test approaches.

---

### Bootstrap: Difference in Proportions

**Path:** `simulate/bootstrap-two-props/`
**Category:** Simulate
**Description:** Bootstrap confidence interval for the difference in two population proportions (p-hat-1 minus p-hat-2). Resamples binary (0/1) data independently within each group, computes the difference in group proportions for each resample, and builds the bootstrap distribution. Supports percentile CI at 90%, 95%, or 99%. Uses the shared sim-app architecture.
**Concepts:** Bootstrap CI for difference in proportions, two-group comparison, sampling variability of proportion differences, confidence interval construction

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `dataset` | string | Pre-load a two-group categorical dataset | `dataset=cpr` |
| `seed` | string | Deterministic seed for reproducibility | `seed=hw6q2` |
| `ci` | integer | Confidence level (90, 95, or 99) | `ci=95` |

**Compatible Datasets:** Datasets with `type === 'randomization_prop'`. Includes: `sex_discrimination`, `opportunity_cost`, `cpr`, `yawn`, `heart_transplant`, `malaria`, `migraine`, `fish_oil_18`, `mammogram`, `resume`, `biontech_adolescents`, `sinusitis`, `smallpox`

**Textbook Integration Notes:** Use for Ch. 17 (inference for two proportions) alongside the randomization test page. This provides the CI perspective; pair with `simulate/randomization-diff-props/` for the hypothesis test perspective on the same data.

---

### Bootstrap: Regression Slope

**Path:** `simulate/bootstrap-slope/`
**Category:** Simulate
**Description:** Bootstrap confidence interval for the regression slope. Resamples (x, y) pairs with replacement, refits the regression line, records the slope. Scatterplot shows bootstrap regression lines overlaid on the original data.
**Concepts:** Bootstrap for regression, sampling variability of slope, CI for slope, regression line variability

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `dataset` | string | Pre-load a regression dataset | `dataset=bac` |
| `seed` | string | Deterministic seed (reproducible bootstrap) | `seed=demo` |
| `ci` | number | Confidence level (50–99.9) | `ci=98` |
| `ci_method` | string | `percentile` / `se` / `both` | `ci_method=percentile` |
| `readout` | string | `readout=false` hides the computed CI, shading, bound lines + pills — student estimates the interval off the histogram | `readout=false` |
| `plot` | string | `plot=only` — figure-only embed; hides all chrome and auto-runs the 1000-resample bootstrap distribution at `seed` | `plot=only` |

**Compatible Datasets:** Datasets with `type === 'regression'`. Same as the Regression explore tool. Includes `bdims_regression` (shoulder girth → height, n = 507; observed slope 0.604, 98% CI ≈ (0.537, 0.673)).

**Textbook Integration Notes:** Use for Ch. 24 (inference for regression). The overlaid bootstrap lines on the scatterplot are a powerful visual — show how the slope varies across resamples. Pair with `explore/regression/?dataset=bac` to first examine the scatterplot, then link to the bootstrap.

---

## Simulation Tools — Randomization

### Randomization: Difference in Means

**Path:** `simulate/randomization-diff-means/`
**Category:** Simulate
**Description:** Randomization (permutation) test for the difference in two population means. Randomly shuffles group labels, computes the difference in group means for each shuffle, builds the null distribution. Shows p-value for one-sided or two-sided alternatives.
**Concepts:** Randomization test, permutation test, null distribution, p-value, hypothesis testing for two means

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `dataset` | string | Pre-load a two-group dataset | `dataset=stem_cell` |
| `data` | numbers | Inline data (single group; needs group labels) | `data=3.2,4.1,5.0` |
| `seed` | string | Deterministic seed | `seed=exam1q4` |
| `direction` | string | Alternative: `less`, `greater`, or `two-sided` | `direction=greater` |

**Compatible Datasets:** Same as Bootstrap: Difference in Means — datasets with `type === 'randomization'`.

**Textbook Integration Notes:** Core tool for Ch. 20 (randomization tests for two means). Pre-load with `?dataset=stem_cell&direction=greater` for the classic stem cell heart repair example.

---

### Randomization: Difference in Proportions

**Path:** `simulate/randomization-diff-props/`
**Category:** Simulate
**Description:** Randomization test for the difference in two population proportions. Shuffles group labels while keeping outcomes fixed, computes the difference in group proportions for each shuffle.
**Concepts:** Randomization test for proportions, null distribution, p-value, hypothesis testing for two proportions

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `dataset` | string | Pre-load a two-group categorical dataset | `dataset=sex_discrimination` |
| `seed` | string | Deterministic seed | `seed=demo` |
| `direction` | string | Alternative direction | `direction=greater` |

**Compatible Datasets:** Datasets with `type === 'randomization_prop'`. Includes: `sex_discrimination`, `opportunity_cost`, `cpr`, `yawn`, `heart_transplant`, `malaria`, `migraine`, `fish_oil_18`, `mammogram`, `resume`, `biontech_adolescents`, `sinusitis`, `smallpox`

**Textbook Integration Notes:** Core tool for Ch. 11 (randomization tests introduction) and Ch. 17 (inference for two proportions). The sex discrimination dataset is the standard introductory example. Pre-load with `?dataset=sex_discrimination&direction=greater`.

---

### Randomization: One Proportion

**Path:** `simulate/randomization-one-prop/`
**Category:** Simulate
**Description:** One-proportion randomization test using Bernoulli(p0) simulation. Generates samples under the null hypothesis proportion, computes the sample proportion for each, builds the null distribution. Supports manual entry of successes and sample size.
**Concepts:** One-proportion test, null hypothesis proportion, Bernoulli simulation, p-value, sampling under the null

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `dataset` | string | Pre-load a categorical dataset | `dataset=medical_consultant` |
| `p` | float | Null hypothesis proportion | `p=0.10` |
| `direction` | string | Alternative: `less`, `greater`, or `twosided` | `direction=less` |
| `seed` | string | Deterministic seed | `seed=demo` |

**Compatible Datasets:** Datasets with `type === 'bootstrap_prop'` or `type === 'one_cat'`. Includes: `medical_consultant`, `transplant_survival`, `stent30`, `jury`, `env_regulation`, `supreme_court`

**Textbook Integration Notes:** Use for Ch. 16 (one-proportion hypothesis test). Pre-load with `?dataset=medical_consultant&p=0.10&direction=less` for the classic medical consultant complication rate example.

---

### Randomization: One Mean

**Path:** `simulate/randomization-one-mean/`
**Category:** Simulate
**Description:** One-mean randomization test using a shifted bootstrap. Centers the data at the null hypothesis mean, resamples with replacement, computes the sample mean. Builds the null distribution to assess how unusual the observed mean is.
**Concepts:** One-sample test for the mean, shifted bootstrap, null distribution, p-value

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `dataset` | string | Pre-load a numeric dataset | `dataset=penny_ages` |
| `null_value` | float | Null hypothesis mean | `null_value=15` |
| `direction` | string | Alternative: `less`, `greater`, or `twosided` | `direction=greater` |
| `seed` | string | Deterministic seed | `seed=demo` |

**Compatible Datasets:** Same as Bootstrap: One Mean — one-variable numeric datasets.

**Textbook Integration Notes:** Use for Ch. 19 (hypothesis test for one mean). Pair with the bootstrap mean page to compare CI and hypothesis test approaches for the same data.

---

### Randomization: Paired Differences

**Path:** `simulate/randomization-paired/`
**Category:** Simulate
**Description:** Randomization test for paired mean differences. Computes differences (var2 minus var1) for each pair, then randomly flips the sign of each difference to simulate the null distribution under H-null: mu-d = 0. Builds the null distribution of the mean difference. Supports one-sided and two-sided alternatives. Uses the shared sim-app architecture.
**Concepts:** Paired randomization test, sign-flipping mechanism, null distribution for paired differences, p-value for paired data

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `dataset` | string | Pre-load a paired dataset | `dataset=textbooks` |
| `seed` | string | Deterministic seed for reproducibility | `seed=exam2q1` |
| `direction` | string | Alternative: `less`, `greater`, or `two-sided` | `direction=less` |

**Compatible Datasets:** Datasets with `type === 'paired'`. Includes: `textbooks`, `hsb2_read_write`, `friday_traffic`, `helium`, `twins`, `prison`

**Textbook Integration Notes:** Use for Ch. 21 (paired data). Pair with `simulate/bootstrap-paired/` (CI approach) and `inference/paired/` (parametric t-test) for the same data. The sign-flipping mechanism is a good teaching moment for explaining what "no effect" means in paired designs.

---

### Randomization: Chi-Square

**Path:** `simulate/randomization-chisq/`
**Category:** Simulate
**Description:** Randomization test using the chi-square statistic. Shuffles group labels, computes the chi-square statistic for each shuffle, builds the null distribution. Always right-tailed. Supports contingency table entry and raw data input.
**Concepts:** Chi-square test, randomization test for independence, contingency table, chi-square statistic

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `dataset` | string | Pre-load a categorical dataset | `dataset=ask` |
| `seed` | string | Deterministic seed | `seed=demo` |

**Compatible Datasets:** Datasets with `type === 'chisq'` or `type === 'randomization_prop'` (2+ categorical variables). Includes: `ask`, `diabetes2`, `lizard_habitat`, `immigration`, `ucb_admit`, `cards`, `burger`, `dream`, `smoking`, `drug_use`

**Textbook Integration Notes:** Use for Ch. 18 (chi-square test). The randomization approach provides a simulation-based alternative before introducing the theoretical chi-square distribution.

---

### Chi-Square Goodness-of-Fit Simulation

**Path:** `simulate/goodness-of-fit/`
**Category:** Simulate
**Description:** Simulation-based goodness-of-fit test for a single categorical variable against a specified distribution p₀. Repeatedly draws a fresh multinomial sample of size n *from* p₀ (seeded), computes the χ² goodness-of-fit statistic Σ(O−E)²/E each time, and builds the null distribution; the observed χ² is marked and the p-value is the right-tail fraction. The mechanism strip shows observed counts vs. one simulated sample under H₀ (with dashed expected-count markers). Load a `type: gof` dataset or enter categories + observed counts + hypothesized proportions manually.
**Concepts:** Goodness-of-fit test, multinomial sampling, chi-square statistic, expected counts (n·p₀), simulation-based inference, null distribution, p-value

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `dataset` | string | Pre-load a `type: gof` dataset | `dataset=mendel_peas` |
| `seed` | string | Deterministic seed (reproducible for grading) | `seed=demo` |
| `plot` | string | `only` — figure-only auto-run embed | `plot=only` |
| `readout` | string | `false` — hide the p-value (read it off the distribution) | `readout=false` |
| `cutlines` | string | `tail` — draggable cutoff line + count pill | `cutlines=tail` |
| `observed` | string | `off` — hide the observed-stat marker (connect-the-dots) | `observed=off` |

**Compatible Datasets:** `type === 'gof'` datasets (a single categorical variable with observed counts + `gofNull` proportions). Includes (a full range): `mendel_peas` (great fit, χ²=0.47, p≈0.93), `textbooks_format` (χ²=2.32, p≈0.31), `stock_geometric` (geometric model, χ²=4.61, p≈0.60), `jury` (borderline, χ²=5.89, p≈0.12), `barking_deer` (strong reject, χ²=284, p≈0), `blood_types` (illustrative — AB expected 3.2 < 5, so the conditions checkpoint recommends the simulation).

**Textbook Integration Notes:** Fills the Ch. 16 goodness-of-fit gap — the simulation-first half that the `distribution/chisq/` calculator (theory route) could not provide. Pairs with the calculator: simulate the null, then meet the χ² formula. Supports the full reasoning-mode embed stack (`plot=only` / `readout=false` / `cutlines` / `observed=off`). Its analytic counterpart is `inference/goodness-of-fit/`.

---

### Chi-Square Goodness-of-Fit Test (analytic)

**Path:** `inference/goodness-of-fit/`
**Category:** Compute (Inference)
**Description:** Theory-based goodness-of-fit test: compares one categorical variable's observed counts to a hypothesized distribution p₀ using the chi-square distribution. Reports χ² = Σ(O−E)²/E, df = k−1, and the right-tail p-value; shows an observed / expected / (O−E)²/E table (flagging expected counts below 5), the chi-square density curve with the right tail shaded, the formula, and a plain-language conclusion. The **Check Conditions** panel lists the Goodness-of-Fit *Simulation* as the assumption-free alternative when expected counts are small. Load a `type: gof` dataset or enter counts + proportions manually.
**Concepts:** Goodness-of-fit test, chi-square distribution, expected counts (n·p₀), degrees of freedom (k−1), per-category contributions, expected-count condition (≥ 5)

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `dataset` | string | Pre-load a `type: gof` dataset | `dataset=mendel_peas` |

**Compatible Datasets:** `type === 'gof'` datasets — `mendel_peas` (χ²=0.47, p≈0.93), `textbooks_format` (χ²=2.32, p≈0.31), `stock_geometric` (χ²=4.61, p≈0.60), `jury` (χ²=5.89, p≈0.12), `barking_deer` (χ²=284, p≈0), `blood_types` (small-expected illustrative case).

**Textbook Integration Notes:** The analytic node of the Ch. 16 goodness-of-fit trio (`explore/one-cat/` → `simulate/goodness-of-fit/` → `inference/goodness-of-fit/`). Its conditions checkpoint cross-links to the simulation, mirroring `inference/chisq/` → `simulate/randomization-chisq/`.

---

### Randomization: Correlation

**Path:** `simulate/randomization-correlation/`
**Category:** Simulate
**Description:** Randomization test for the population correlation coefficient rho. Shuffles y-values while keeping x-values fixed to break the x-y pairing, computes the sample correlation r for each shuffle, and builds the null distribution. Mechanism strip shows side-by-side mini scatterplots (original data vs last shuffle) with regression lines. Supports two-sided, right-tail, and left-tail alternatives.
**Concepts:** Randomization test for correlation, null distribution of r, shuffling y-values, independence of x and y, p-value for correlation

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `dataset` | string | Pre-load a regression dataset | `dataset=possum_regression` |

**Compatible Datasets:** Datasets with `type === 'regression'`. Includes: `ames_regression`, `possum_regression`, `elmhurst_regression`, `mariokart_regression`, `loan50_regression`, `county_regression`, `bac`, `duke_forest`, `starbucks`, `babies_crawl`, `births14_regression`, `midterms_house`, `coast_starlight_regression`, `gpa_study_hours`, `cherry`, `satgpa`, `evals`, `gifted`

**Textbook Integration Notes:** Use for Ch. 24 (inference for regression). The mini scatterplots in the mechanism strip are a powerful teaching tool — students see how shuffling y-values destroys the linear pattern. Pair with `explore/regression/` to first examine the relationship, then use this page to test its significance. Compare results with `inference/slope/` for the parametric approach.

---

### Randomization: ANOVA

**Path:** `simulate/randomization-anova/`
**Category:** Simulate
**Description:** Permutation F-test for comparing means across 3 or more groups. Shuffles group labels while keeping response values fixed, computes the F statistic for each shuffle, and builds the null distribution. Always right-tailed. Mechanism strip shows side-by-side mini boxplots (original vs shuffled groups) with the observed and shuffled F statistics. Includes variable selectors for group and response columns and auto-generated conclusions.
**Concepts:** ANOVA randomization test, permutation F-test, null distribution of F, between-group vs within-group variability, shuffling group labels

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `dataset` | string | Pre-load a grouped dataset | `dataset=plant_growth` |

**Compatible Datasets:** Datasets where `hasNumeric === true` AND `hasCategorical === true`, typically with 3+ groups. Includes: `classdata`, `mlb_players_18`, `plant_growth`, `hsb2_math`, `evals_rank`, `fastfood_anova`

**Textbook Integration Notes:** Use for Ch. 22 (ANOVA). The permutation approach introduces ANOVA logic before the theoretical F-distribution. The mini boxplots in the mechanism strip help students see that shuffling group labels destroys between-group differences. Pair with `inference/anova/` for the parametric F-test on the same data. Datasets with `inferenceContexts` for `anova` auto-populate the group and response variable selectors and generate formal conclusions.

---

## Distribution Calculators

All four continuous distribution calculators share common UI via `dist-app.js`: interactive chart with draggable boundary lines, click-to-edit critical values, tail probability preset buttons, and bidirectional sync between form inputs and chart. Tail options: left, right, or two-tailed.

### Normal Distribution

**Path:** `distribution/normal/`
**Category:** Distribution
**Description:** Normal distribution calculator. Computes P(X < x), P(X > x), or P(-x < X < x) and inverse probabilities. Interactive curve with shading and draggable boundary.
**Concepts:** Normal distribution, z-scores, tail probabilities, percentiles, empirical rule

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `mu` | float | Mean (default: 0) | `mu=100` |
| `sigma` | float | Standard deviation (default: 1) | `sigma=15` |
| `tail` | string | Tail type: `left`, `right`, `both` | `tail=left` |

**Compatible Datasets:** N/A (calculator, no data input)

**Textbook Integration Notes:** Use throughout Ch. 13 (normal distribution). For z-score problems, link with default `mu=0&sigma=1`. For applied problems, set the context-specific parameters: `?mu=100&sigma=15` for IQ scores, `?mu=70&sigma=3.3` for heights. Set `?tail=left` or `?tail=right` to pre-configure the tail direction.

---

### t Distribution

**Path:** `distribution/t/`
**Category:** Distribution
**Description:** t distribution calculator. Computes tail probabilities and critical values for the t distribution. Same interactive features as the normal calculator.
**Concepts:** t distribution, degrees of freedom, t critical values, comparison to normal

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `df` | integer | Degrees of freedom (default: 10) | `df=24` |
| `tail` | string | Tail type: `left`, `right`, `both` | `tail=both` |

**Compatible Datasets:** N/A

**Textbook Integration Notes:** Use alongside inference pages (Ch. 19-21). Pre-set `?df=` to match the problem context. For example, a one-sample t-test with n=25 uses `?df=24`.

---

### Chi-Square Distribution

**Path:** `distribution/chisq/`
**Category:** Distribution
**Description:** Chi-square distribution calculator. Right-skewed distribution used for chi-square tests. Interactive curve with shading.
**Concepts:** Chi-square distribution, degrees of freedom, right-tail probability, chi-square critical values

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `df` | integer | Degrees of freedom (default: 5) | `df=3` |
| `tail` | string | Tail type: `left`, `right`, `both` | `tail=right` |

**Compatible Datasets:** N/A

**Textbook Integration Notes:** Use for Ch. 18 (chi-square tests) and Ch. 26. Set `?df=` to match the contingency table dimensions: df = (rows-1)(cols-1).

---

### F Distribution

**Path:** `distribution/f/`
**Category:** Distribution
**Description:** F distribution calculator. Used for ANOVA and comparing variances. Interactive curve with shading.
**Concepts:** F distribution, numerator/denominator degrees of freedom, F critical values, ANOVA

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `df1` | integer | Numerator degrees of freedom (default: 3) | `df1=2` |
| `df2` | integer | Denominator degrees of freedom (default: 20) | `df2=45` |
| `tail` | string | Tail type: `left`, `right`, `both` | `tail=right` |

**Compatible Datasets:** N/A

**Textbook Integration Notes:** Use for Ch. 22 (ANOVA). Set `?df1=k-1&df2=n-k` where k is the number of groups.

---

### Binomial Distribution

**Path:** `distribution/binomial/`
**Category:** Distribution
**Description:** Binomial distribution calculator. Displays PMF bar chart with shading, cumulative probabilities, probability table, and optional normal approximation overlay. Supports P(X = k), P(X <= k), P(X >= k), and P(X > k) calculations. Draggable k boundary.
**Concepts:** Binomial distribution, probability mass function, cumulative probability, normal approximation to binomial, expected value and standard deviation

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `n` | integer | Number of trials | `n=20` |
| `p` | float | Probability of success | `p=0.3` |

**Compatible Datasets:** N/A

**Textbook Integration Notes:** Use for Ch. 25 (binomial model) and as a bridge to normal approximation. The normal overlay toggle visually demonstrates when the approximation is reasonable. Example: `?n=50&p=0.3` shows a case where normal approximation works well.

---

### Power & Error Visualizer

**Path:** `distribution/power/`
**Category:** Distribution
**Description:** Statistical power and decision-error visualizer. Displays two overlapping normal sampling distributions — one centered under the null hypothesis (μ₀ = 0), one under the alternative (μ₁ = μ₀ + δ) — and shades the Type I error region (α), Type II error region (β), and power (1 − β). Sliders and numeric inputs control α, sample size n, effect size δ, and population SD σ; radio buttons select left-, right-, or two-tailed tests. A results panel shows the critical value(s), power, β, and α. Quick-preset buttons set common α values (0.01, 0.025, 0.05, 0.10). URL-shareable.
**Concepts:** Statistical power, Type I error, Type II error, significance level, effect size, the power/sample-size/effect-size/α relationship, one- vs two-tailed tests

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `alpha` | float | Significance level (Type I error rate). Default 0.05; slider range 0.001–0.20. | `alpha=0.01` |
| `n` | integer | Sample size. Default 30; slider range 2–500 (accepts up to 10000). | `n=64` |
| `delta` | float | Effect size (μ₁ − μ₀). Default 0; slider range −5 to 5. | `delta=1.5` |
| `sigma` | float | Population standard deviation (σ). Default 1; slider range 0.1–10. | `sigma=2` |
| `tail` | string | Test direction: `left`, `right`, or `both`. Default `right`. | `tail=both` |

**Compatible Datasets:** N/A (calculator, no data input)

**Textbook Integration Notes:** **This is the live power tool.** It resolves the stale "a power tool is planned" placeholder in `statistical-power.qmd`. Use across the Decision Errors chapter (Ch. 8, Part II), Type II Error (Ch. 27), Statistical Power (Ch. 28), and Sample Size Planning (Ch. 29). Pre-configure with `?alpha=0.05&n=30&delta=1&sigma=2&tail=right`. Drag δ to 0 to show that power collapses to α when there is no effect; increase n to show power rising; switch `tail=both` to show the two-tailed power cost.

---

## Traditional Inference

All inference pages compute test statistics, p-values, and confidence intervals using parametric formulas. They display the reference distribution curve with shaded p-value region, a results table with all computed values, condition checks, and auto-generated formal and practical conclusions. Each page includes a "Run simulation" cross-link to the corresponding simulation page.

### One-Sample t-Test

**Path:** `inference/one-mean/`
**Category:** Inference
**Description:** One-sample t-test and confidence interval for a population mean. Supports data input (dataset, paste, file) and summary statistics entry (x-bar, s, n). Displays t-distribution curve with p-value shading, condition warnings, and dual conclusions.
**Concepts:** One-sample t-test, confidence interval for a mean, t statistic, degrees of freedom, conditions for inference

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `dataset` | string | Pre-load a numeric dataset | `dataset=penny_ages` |
| `data` | numbers | Inline numeric data | `data=4.2,3.8,5.1` |

**Compatible Datasets:** Any dataset with `hasNumeric === true`. Datasets with `inferenceContexts` for `one-mean` will auto-populate the null value and alternative direction.

**Textbook Integration Notes:** Use for Ch. 19 (one-sample t-test). Datasets with inference contexts automatically set up the hypothesis: `?dataset=penny_ages` pre-fills the null hypothesis mean. The "Run simulation" link sends students to `simulate/bootstrap-mean/` or `simulate/randomization-one-mean/` with the same data and hypothesis.

---

### Two-Sample t-Test

**Path:** `inference/two-means/`
**Category:** Inference
**Description:** Welch's two-sample t-test and confidence interval for the difference in two population means. Supports dataset, paste/file, and summary statistics (x-bar, s, n per group) input. Automatically detects group and response variables.
**Concepts:** Two-sample t-test (Welch), confidence interval for difference in means, degrees of freedom (Satterthwaite), conditions for inference

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `dataset` | string | Pre-load a grouped dataset | `dataset=stem_cell` |
| `summary` | string | Summary stats format: `label:n:mean:sd,...` | `summary=Control:9:1.2:3.5,Treatment:9:7.8:8.2` |

**Compatible Datasets:** Datasets where `hasNumeric === true` AND `hasCategorical === true`. Same as Grouped Statistics.

**Textbook Integration Notes:** Use for Ch. 20 (two-sample t-test). Links to `simulate/randomization-diff-means/` for the simulation-based alternative.

---

### Paired t-Test

**Path:** `inference/paired/`
**Category:** Inference
**Description:** Paired t-test and confidence interval for the mean of paired differences. Computes differences (var1 - var2) internally, then runs a one-sample t-test on the differences. Supports variable selection for multi-column datasets and summary input (d-bar, s_d, n).
**Concepts:** Paired t-test, paired differences, confidence interval for mean difference, conditions for paired inference

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `dataset` | string | Pre-load a paired dataset | `dataset=textbooks` |

**Compatible Datasets:** Datasets with `type === 'paired'`. Same as Bootstrap: Paired Differences.

**Textbook Integration Notes:** Use for Ch. 21 (paired data). The variable selectors let students choose which variable is "before" and which is "after," reinforcing the direction of the difference.

---

### One-Proportion z-Test

**Path:** `inference/one-prop/`
**Category:** Inference
**Description:** One-proportion z-test and confidence interval using the normal approximation. Supports dataset loading (with success outcome selector), paste/file input, and manual summary entry (successes, n). Displays normal curve with p-value shading and condition checks (np >= 10, n(1-p) >= 10).
**Concepts:** One-proportion z-test, confidence interval for a proportion, conditions for proportion inference, success-failure condition

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `dataset` | string | Pre-load a categorical dataset | `dataset=medical_consultant` |

**Compatible Datasets:** Datasets with `type === 'bootstrap_prop'` or `type === 'one_cat'`. Same as Randomization: One Proportion.

**Textbook Integration Notes:** Use for Ch. 16 (one-proportion inference). Datasets with inference contexts auto-set the null proportion and alternative. Links to `simulate/randomization-one-prop/` for the simulation approach.

---

### Two-Proportion z-Test

**Path:** `inference/two-props/`
**Category:** Inference
**Description:** Two-proportion z-test and confidence interval for the difference in two proportions. Supports dataset loading with group and outcome variable selectors, paste/file, and manual summary entry (successes and n per group).
**Concepts:** Two-proportion z-test, confidence interval for difference in proportions, pooled proportion, conditions for two-proportion inference

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `dataset` | string | Pre-load a two-group categorical dataset | `dataset=sex_discrimination` |

**Compatible Datasets:** Datasets with `type === 'randomization_prop'`. Same as Randomization: Difference in Proportions.

**Textbook Integration Notes:** Use for Ch. 17 (two-proportion inference). Links to `simulate/randomization-diff-props/` for the simulation alternative.

---

### Chi-Square Test of Independence

**Path:** `inference/chisq/`
**Category:** Inference
**Description:** Chi-square test of independence with observed and expected frequency tables, chi-square distribution curve with right-tail shading, and condition checks (all expected counts >= 5). Supports editable contingency table entry, dataset loading, and raw data paste.
**Concepts:** Chi-square test of independence, observed vs expected counts, degrees of freedom for contingency table, conditions for chi-square test

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `dataset` | string | Pre-load a categorical dataset | `dataset=ask` |

**Compatible Datasets:** Datasets with `type === 'chisq'` or two-variable categorical data.

**Textbook Integration Notes:** Use for Ch. 18 (chi-square test) and Ch. 26. Links to `simulate/randomization-chisq/` for the randomization alternative. The editable contingency table allows entering data from textbook examples directly.

---

### Regression Slope t-Test

**Path:** `inference/slope/`
**Category:** Inference
**Description:** t-test and confidence interval for the regression slope. Tests whether the population slope differs from zero. Supports dataset and summary input (slope, SE, n). Displays t-distribution curve with p-value shading and scatterplot.
**Concepts:** Inference for regression slope, t-test for slope, confidence interval for slope, conditions for regression inference

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `dataset` | string | Pre-load a regression dataset | `dataset=bac` |

**Compatible Datasets:** Datasets with `type === 'regression'`. Same as Regression explore tool.

**Textbook Integration Notes:** Use for Ch. 24 (inference for regression). Links to `simulate/bootstrap-slope/` for the bootstrap approach. Pair with `explore/regression/` to first examine the scatterplot and residuals. Now includes a collapsible **ANOVA-for-regression table** (SST = SSR + SSE, model F, F = t²) — open by default with `?anova=true`.

---

### Multiple Linear Regression

**Path:** `inference/mlr/`
**Category:** Inference
**Description:** Fit Y = β₀ + β₁x₁ + … + βₖxₖ by ordinary least squares on a bundled or uploaded dataset. Shows the coefficient table (estimate, SE, t, p, 95% CI) matching `summary(lm)`, the model ANOVA F-test, R² / adjusted R² / residual SE, diagnostics (residuals-vs-fitted, residual histogram, Cook's-distance high-influence flag), and a pairwise scatterplot matrix of the predictors. Expert mode adds VIF.
**Concepts:** Multiple regression, least squares, coefficient inference, model F-test, R² and adjusted R², residual diagnostics, leverage / Cook's distance, multicollinearity (pairwise scatterplots + VIF)

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `dataset` | string | Bundled dataset with ≥ 3 numeric variables | `dataset=county` |
| `response` | string | Response variable Y | `response=head_l` |
| `predictors` | string[] | Comma-separated predictor names | `predictors=total_l,skull_w` |
| `diagnostics` | boolean | Expand the diagnostics panel | `diagnostics=true` |
| `expert` | boolean | Reveal the VIF column (Extended Content) | `expert=true` |

**Compatible Datasets:** Any bundled dataset with ≥ 3 numeric variables — e.g. `possum`, `county`, `loan50`, `mammals`, `floridalakes`, `sleepstudy`, `usstates`. Also accepts uploaded CSVs (3+ numeric columns).

**Textbook Integration Notes:** Use for the new Multiple Regression chapter (Ch. 22/23). The base track uses the pairwise scatterplot matrix for multicollinearity (matching the coursepack); VIF is Extended Content behind `?expert=true`. The single-predictor generalization of the F-test lives on `inference/slope/` (`?anova=true`).

---

### One-Way ANOVA

**Path:** `inference/anova/`
**Category:** Inference
**Description:** One-way ANOVA F-test for equality of means across 3+ groups. Displays F-distribution curve with right-tail shading, side-by-side boxplots, ANOVA table (SS, df, MS, F, p), and group summary statistics. Supports dataset loading, paste/file, and summary input (n, mean, sd per group). Always right-tailed (no alternative selector).
**Concepts:** ANOVA, F-test, between-group vs within-group variability, ANOVA table, F distribution, conditions for ANOVA

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `dataset` | string | Pre-load a grouped dataset | `dataset=plant_growth` |
| `summary` | string | Summary stats: `label:n:mean:sd,...` | `summary=ctrl:10:5.03:0.58,trt1:10:4.66:0.79,trt2:10:5.53:0.44` |
| `alpha` | float | Significance level | `alpha=0.05` |
| `posthoc` | string | Post-hoc method for the pairwise panel (3+ groups, raw data): `tukey` (default) or `bonferroni` | `posthoc=bonferroni` |

**Compatible Datasets:** Datasets where `hasNumeric === true` AND `hasCategorical === true`, typically with 3+ groups. Includes: `classdata`, `mlb_players_18`, `plant_growth`, `hsb2_math`, `evals_rank`, `fastfood_anova`

**Textbook Integration Notes:** Use for Ch. 22 (ANOVA). The `?summary=` parameter is particularly useful for textbook examples that provide only summary statistics. The side-by-side boxplots help assess the equal-variance condition. After a significant F, the post-hoc panel (Tukey HSD / Bonferroni) shows which pairs differ — also available as the dedicated **Multiple Comparisons** route below.

---

### Multiple Comparisons

**Path:** `inference/multiple-comparisons/`
**Category:** Inference
**Description:** Dedicated route for the multiple-comparisons chapter (Ch. 18). Reuses the ANOVA engine (same F-test) but is framed around the **post-hoc pairwise panel**: every pair of group means with a family-wise confidence interval and adjusted p-value (Tukey HSD or Bonferroni), plus a forest plot marking which pairs differ. Same data-loading and inputs as `inference/anova/`.
**Concepts:** multiple comparisons, family-wise error, Tukey HSD, Bonferroni correction, pairwise confidence intervals, post-hoc testing

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `dataset` | string | Pre-load a grouped dataset (3+ groups) | `dataset=insectsprays` |
| `posthoc` | string | `tukey` (default) or `bonferroni` | `posthoc=bonferroni` |
| `summary` | string | Summary stats: `label:n:mean:sd,...` | `summary=A:12:3.5:1.2,B:12:5.1:1.4,C:12:2.2:0.9` |
| `alpha` | float | Significance / CI level | `alpha=0.05` |

**Compatible Datasets:** Same as ANOVA (3+ groups). `insectsprays`, `plant_growth`, `chickwts`, `classdata`.

**Textbook Integration Notes:** Link this from Ch. 18 for the "which groups differ?" question. It's the same computation as the ANOVA post-hoc panel, just a stable standalone URL.

---

## Traditional Inference — Confidence Intervals (Estimation)

Estimation-only companions to the hypothesis-test pages above, under `inference/estimate/`. They mirror how the simulation side splits bootstrap (CI) from randomization (test): **no hypotheses and no p-value** — the student sets a confidence level (number box, 90/95/99 preset pills, or by **dragging the critical values** on a standardized t- or z-curve) and reads the interval, worked out. The curve reuses the distribution-calculator marker layer (editable probability pills, editable ±critical-value axis boxes, snap points at common levels) via the shared `js/critical-value-figure.js`. Each page cross-links to its bootstrap CI counterpart and a conditions check. The combined test-and-CI pages above stay live in parallel.

Common URL parameters (all six): `dataset` (pre-load), plus the same data-panel inputs (paste, file, summary) as the matching test page. Confidence level is a UI control, not a URL parameter.

| Page | Path | Parameter (population) | Distribution / df |
|------|------|------------------------|-------------------|
| CI for a Mean | `inference/estimate/one-mean/` | population mean μ | t, df = n − 1 |
| CI for a Proportion | `inference/estimate/one-prop/` | population proportion p | standard normal (z) |
| CI for a Difference in Means | `inference/estimate/two-means/` | μ₁ − μ₂ | t, Welch df |
| CI for a Mean Difference (paired) | `inference/estimate/paired/` | μ_d | t, df = n − 1 pairs |
| CI for a Difference in Proportions | `inference/estimate/two-props/` | p₁ − p₂ (unpooled SE) | standard normal (z) |
| CI for a Regression Slope | `inference/estimate/slope/` | slope β₁ | t, df = n − 2 |

**Compatible Datasets:** same filters as the corresponding test pages (one-mean = `hasNumeric`; one-prop = `bootstrap_prop`/`one_cat`; two-means = 2-level grouped; two-props = `randomization_prop`; paired = `paired`; slope = `regression`).

**Textbook Integration Notes:** Link these where a chapter is about *estimation* rather than testing. The proportion pages draw the critical value off the normal curve (z*); means, paired, and slope use the t-curve with the df the interval actually uses. Two-props uses the unpooled (Wald) SE — pooling is a null-hypothesis device with no place in an interval.

---

## Conceptual Demonstrations

### Sampling Distribution Lab

**Path:** `conceptual/sampling-lab/`
**Category:** Conceptual
**Description:** Research-backed redesign of the sampling-distribution demonstrator, covering **both means (x̄) and proportions (p̂)**. A three-tier view — population → the current sample → the sampling distribution of the statistic — makes "a distribution *of statistics*" concrete: each drawn sample collapses to one value that drops into the building distribution. Designed to avoid the documented "Watkins trap": it foregrounds spread and shape vs. n (SD of the statistic compared to σ/√n or √(p(1−p)/n)) and deliberately omits the misleading mean-of-sample-means-vs-n view. A **Freeze/compare** control pins one sample size and overlays a second on a shared axis, separating "more samples (same distribution)" from "larger n (different, narrower distribution)." Proportion mode adds a p slider and builds the sampling distribution of p̂.
**Concepts:** Sampling distribution as a distribution of statistics, Central Limit Theorem, standard error (σ/√n and √(p(1−p)/n)), effect of sample size vs. number of repetitions, np≥10 / n(1−p)≥10 normality condition for p̂

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `type` | string | `quant` (sampling dist of x̄) or `prop`/`cat` (sampling dist of p̂) | `type=prop` |
| `p` | float | Population proportion (proportion mode), 0.05–0.95 | `p=0.6` |
| `shape` | string | Population shape (quant mode): `normal`, `right-skewed`, `left-skewed`, `uniform`, `bimodal` | `shape=normal` |
| `n` | integer | Sample size, 1–500 | `n=40` |
| `seed` | string | PRNG seed (required for graded/activity use) | `seed=beads60` |
| `parameter` | string | `hidden` withholds the true parameter **with** a Reveal button (instructor demo); `locked` withholds it with **no** button (student reading / graded work) (REQ-056) | `?parameter=locked` |

**Compatible Datasets:** N/A (built-in population shapes / proportion slider)

**Activities:** `sampling-distribution-proportion.json` — predict-then-reveal walkthrough (bead bowl, p=0.60, n=40) that builds the p̂ distribution and contrasts more-samples vs. larger-n.

**Textbook Integration Notes:** The primary sampling-distribution tool for **Ch. 6 (sampling variability)** and the CLT. For the proportions storyline, deep-link `?type=prop&p=0.6&n=40&seed=...` or attach the activity. Use Freeze/compare to make the reps-vs-n distinction unmistakable (the #1 documented misconception).

---

### Sampling Bias Lab

**Path:** `conceptual/sampling-bias/`
**Category:** Conceptual
**Description:** The classic "Sampling Words from the Gettysburg Address" activity (Bingham's Ch 2 class activity), made interactive. The address is the population (N = 268 words); the variable is word length. Students hand-pick a "representative" sample of n words by clicking — which runs biased *high* because people reach for longer, memorable words — then take random samples. Two side-by-side dotplots of sample-mean word length show the by-eye distribution piling up to the right of the true mean (μ ≈ 4.3) while the random distribution centers on it. A "simulate many" control (biased model: pick probability ∝ length²) plus an n control demonstrate that **a bigger sample does not fix sampling bias** — only random selection does.
**Concepts:** Sampling bias, representative vs. convenience/judgment sampling, why random sampling matters, bias ≠ variability (bias doesn't shrink with n), population vs. sample.

**URL Parameters:** (none beyond global `mode`)

**Compatible Datasets:** N/A (built-in Gettysburg Address population)

**Textbook Integration Notes:** Ch. 2 (data collection / sampling). Direct interactive companion to Bingham's "Sampling from the Gettysburg Address" worksheet (already referenced in the Unit 1 coursepack). Use in class: have students hand-pick first, watch the by-eye dotplot skew high, then reveal random samples centering on μ.

---

### CI Coverage Simulator

**Path:** `conceptual/ci-coverage/`
**Category:** Conceptual
**Description:** Confidence interval coverage simulator. Draws repeated samples from a known population, builds an interval for each, and visualizes which intervals capture the true population mean. Shows running coverage rate. Supports population shapes (normal, right-skewed, uniform), adjustable sample size and confidence level (90%, 95%, 99%). **Four interval methods** are selectable and directly comparable on the same population: the classical **t-interval**, and three bootstrap intervals — **percentile**, **±z·SE**, and **BCa** (600 resamples per sample; the BCa acceleration uses the shared, scipy-validated `jackknife1`/`bcaCI` in `js/ci-method.js`).
**Concepts:** Confidence interval interpretation, coverage rate, "95% of intervals capture the true parameter," effect of confidence level on interval width, effect of sample size on interval width, **how coverage differs by construction method**, under-coverage of bootstrap intervals at small n from skewed populations, what BCa's bias/skew correction does and does not buy

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `dataset` | string | Bundled dataset as the population | `?dataset=penny_ages` |
| `mu` / `sigma` | float | Custom normal population | `?mu=10.4&sigma=8.1` |
| `n` | integer | Sample size per interval, 2–500 | `?n=8` |
| `ci` | integer | Confidence level: 90, 95, 99 | `?ci=90` |
| `method` | string | `t`, `bootstrap` (alias `percentile`), `se`, `bca` | `?method=bca` |
| `catseye` | flag | Start with the plausibility overlay on | `?catseye=1` |

**Compatible Datasets:** N/A (uses built-in population shapes)

**Textbook Integration Notes:** Essential for Ch. 12 (understanding what "95% confidence" means). Students often misinterpret confidence intervals — this tool directly shows that 95% confidence means 95% of intervals contain the parameter, not that there's a 95% probability the parameter is in any specific interval. Run 100+ intervals to see the coverage rate stabilize near the confidence level. **For the bootstrap chapter**, the `method` selector turns this into the empirical companion to `conceptual/bootstrap-shift/`: that page argues *why* a percentile interval should work for one sample, this one measures how often each construction actually delivers its advertised rate. Measured here on a right-skewed population at nominal 95% (1200 intervals per cell): at n = 8, t 88.4% / percentile 83.7% / ±2·SE 85.3% / BCa 85.8%; at n = 50, 92.9% / 92.5% / 93.9% / 93.8%. The honest headline is that *every* method under-covers at small n, the gap to nominal is larger than the gaps between methods, BCa helps by a point or two rather than closing it, and the t-interval holds up best at very small n.

---

### Why the Percentile CI Works

**Path:** `conceptual/bootstrap-shift/`
**Category:** Conceptual
**Description:** The justification for the bootstrap **percentile** method, made checkable. Two stages share one x-axis. **Stage 1** draws repeated samples of *n* from a visible ~200-dot population (one labelled circle per value); each sample highlights the dots it drew and drops its x̄ into the blue **true sampling distribution** below. **Stage 2** freezes one sample — ringed inside the population and blown up in an inset — and resamples *from those n values only*, with repeat draws shaded darker; each x̄* builds the red **bootstrap distribution**, overlaid on the blue one so the shift is visible. The 95% percentile CI is drawn as a bracket under the axis. A slider moves the frozen sample's mean across the sampling distribution, and the page reports **two verdicts** every frame: whether x̄ fell in the central 95% of the true sampling distribution, and whether the percentile CI captured μ. Populations: Normal or right-skewed; *n* from 2 to 60.
**Concepts:** Why the bootstrap percentile method works; the bootstrap distribution as a *shift* of the sampling distribution; percentile CI construction; capture rate and the meaning of "95%"; the limits of the shift argument (the bootstrap SE is estimated from one sample, and the clean "if and only if" also needs symmetry); why percentile intervals can be asymmetric; motivation for BCa

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `shape` | string | Population: `normal` (default) or `skewed` | `?shape=skewed` |
| `n` | integer | Sample size, 2–60 (default 10) | `?n=30` |
| `stage` | integer | `1` (sampling distribution) or `2` (bootstrap) | `?stage=2` |
| `xbar` | float | Target mean for the frozen sample in Stage 2 | `?stage=2&xbar=53.5` |
| `seed` | string | PRNG seed — required for graded/activity use | `?seed=todd1` |

**Compatible Datasets:** N/A (uses built-in population shapes)

**Textbook Integration Notes:** Built for the bootstrap-CI chapter, as the answer to "why is the middle 95% of the bootstrap distribution a confidence interval?" Sequence it **after** students have built a bootstrap distribution on `simulate/bootstrap-mean/` and after `conceptual/sampling-lab/` has established what a sampling distribution is; it assumes both. Open on `?stage=1`, build the blue distribution, then switch to Stage 2 and sweep the slider — the two verdicts flipping together *is* the argument. Then switch the population to **right-skewed** at *n* = 10 to see the argument strain: disagreements get noticeably more common, and the percentile interval comes out asymmetric (a genuine advantage over ±2 SE, which is always symmetric). That is the natural hand-off to the expert-mode `ci_method=bca` interval on the bootstrap pages. Pairs with `conceptual/ci-coverage/`, which shows the same capture idea for the *t*-interval.

---

### Randomization Test Walkthrough

**Canonical path:** `simulate/randomization-diff-props/?activity=randomization-test-gated.json`
**Legacy path (redirects):** `conceptual/randomization-test/` → 0-second redirect to the canonical URL above (preserves any query string, defaults the `activity` param). Old bookmarks still work.
**Category:** Conceptual activity (runs on the two-proportion randomization tool)
**Description:** Step-by-step interactive walkthrough of the randomization test procedure, now delivered as a **gated JSON activity** (`activities/randomization-test-gated.json`) running on the real two-proportion randomization tool with its **cards mechanism strip**. Supports Discovery mode (progressive disclosure + gated questions) and Presentation mode (`?mode=present`, all steps visible). Uses the sex-discrimination dataset by default; in present mode the instructor can switch datasets live.

**Concepts:** Randomization test logic, null hypothesis, shuffling mechanism, building a null distribution, p-value interpretation, hypothesis test conclusion

**URL Parameters:** Inherits all `simulate/randomization-diff-props/` params (`dataset`, `seed`, `direction`, `mechanism`, `success`, `failure`, …) plus `activity` and `mode`. The activity file pins `dataset=sex_discrimination`, `seed=rtgated1`, `direction=right`, `mechanism=cards`.

**Compatible Datasets:** Any two-proportion (`randomization_prop`) dataset; the activity defaults to sex discrimination. The companion instructor guide (`conceptual/randomization-test/guide.html`) notes results for sex discrimination, opportunity cost, and CPR.

**Textbook Integration Notes:** Use for Ch. 11 (introduction to hypothesis testing). In lecture, append `?mode=present` for instructor-controlled pacing; for student homework or lab, the default discover mode gives the guided, gated experience. This is the conceptual foundation that should precede free use of the simulation tools. The printable instructor guide lives at `conceptual/randomization-test/guide.html`.

---

### Decision Errors (Simulation)

**Path:** `conceptual/decision-errors/`
**Category:** Conceptual (Lab)
**Description:** A simulation-based, jargon-light introduction to decision errors. Framed as a one-proportion test — H₀: a treatment does nothing (success rate p = 0.50) vs Hₐ: it works more than half the time (one-sided). The student chooses whether H₀ or Hₐ is *actually* true (and, under Hₐ, the true success rate), the sample size, and α, then runs many studies. Each study is a dot: correctly rejected H₀ / detected (hit), missed it (Type II error), or — when H₀ is true — a false alarm (Type I error). Running rates are in plain H₀/Hₐ language; the detection rate *is* the power, and the false-alarm rate tracks α. No "effect size" terminology. Companion to the fuller Power Lab and the analytic Power & Error Visualizer.
**Concepts:** Type I and Type II errors, power as a long-run detection rate, significance level α and the error trade-off, sample size, one-proportion test, repeated sampling

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `truth` | string | `effect` (Hₐ true) or `none` (H₀ true) | `truth=none` |
| `ptrue` | integer | True success rate as a percent (50–95), used when `truth=effect` | `ptrue=55` |
| `n` | integer | Sample size per study (10/20/30/50/100/200) | `n=100` |
| `alpha` | float | Significance level: `0.10`, `0.05`, or `0.01` | `alpha=0.01` |
| `seed` | string | Deterministic seed | `seed=ch8demo` |

**Compatible Datasets:** N/A (data generated internally)

**Guided activity:** `?activity=decision-errors.json` — a stepped Type I / Type II investigation (Type I ≈ α, α's effect on the false-alarm rate, power vs true rate and n, and the α trade-off).

**Textbook Integration Notes:** Built for the **Decision Errors** chapter (Ch. 8, Part II). Start with H₀ true to show Type I error ≈ α, then flip to Hₐ true and vary the true success rate / n / α to build intuition for power before any formulas — all in proportion language that connects to the Ch. 7 randomization tests. Best used with the bundled guided activity. Pairs with the analytic `distribution/power/` and the fuller `conceptual/power-sim/`.

---

### Power Lab (Simulation)

**Path:** `conceptual/power-sim/`
**Category:** Conceptual (Lab)
**Description:** The simulation companion to the analytic Power & Error Visualizer. Models the same known-σ one-sample z-test (H₀: μ = 0 vs H₁: μ = δ) with sliders for δ, σ, n, α, and tail. Running many studies builds an **empirical power** that visibly converges to the analytic value shown beside it; a hit/miss/false-alarm strip and a **dance-of-the-p-values** panel make the variability of individual studies tangible. Setting δ = 0 demonstrates the Type I error rate. Cross-links to `distribution/power/` (the theory view) with the current parameters.
**Concepts:** Statistical power, Type I/II errors, effect size, the power/n/α relationship, sampling variability of p-values, empirical vs theoretical power

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `delta` | float | Effect size δ = μ₁ − μ₀ (0 ⇒ demonstrate Type I error) | `delta=1` |
| `sigma` | float | Population standard deviation σ | `sigma=2` |
| `n` | integer | Sample size per study | `n=64` |
| `alpha` | float | Significance level | `alpha=0.01` |
| `tail` | string | `left`, `right`, or `both` | `tail=both` |
| `seed` | string | Deterministic seed | `seed=ch28demo` |

**Compatible Datasets:** N/A (data generated internally)

**Textbook Integration Notes:** Built for **Statistical Power** (Ch. 28) and **Type II Error** (Ch. 27), and reusable in **Sample Size** (Ch. 29). Show empirical power converging to theory, then crank n or δ. Use the parameterized cross-link to flip to the analytic curves. For a gentler on-ramp, start students on `conceptual/decision-errors/`.

---

## Practice Tools

### Conclusion Practice

**Path:** `practice/conclusions/`
**Category:** Practice
**Description:** Randomized practice scenarios where students write formal and practical conclusions for hypothesis tests. Presents test results (test statistic, p-value, significance level) and has students fill in structured conclusion templates using dropdowns. Tracks score across multiple scenarios. Uses real inference contexts from bundled datasets.
**Concepts:** Writing conclusions for hypothesis tests, reject/fail to reject, formal conclusion structure, practical conclusion in context, p-value interpretation

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| (none specific) | | | |

**Compatible Datasets:** Draws from all datasets with `inferenceContexts` (42 datasets)

**Textbook Integration Notes:** Assign as practice after students learn to write conclusions (Ch. 11-12 onward). The randomized scenarios cover one-mean, two-means, paired, one-prop, two-props, chi-square, and slope tests. Score tracking helps students see their progress.

---

### Guess the Correlation

**Path:** `practice/correlation/`
**Category:** Practice
**Description:** Matching game where students are shown scatterplots and must match each to its correlation coefficient r. Generates random bivariate data using the Cholesky decomposition to achieve target correlations. Drag-and-drop interface with scoring.
**Concepts:** Correlation coefficient interpretation, reading scatterplots, strength and direction of linear relationships

**URL Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| (none specific) | | | |

**Compatible Datasets:** N/A (generates random data for each round)

**Textbook Integration Notes:** Use for Ch. 19 (correlation). Good as a warm-up activity or homework assignment. Builds intuition for what different r values look like in practice.

---

## Utilities (Instructor-Facing)

### Dataset Builder

**Path:** `data/builder/`
**Category:** Utility (not a student tool)
**Description:** An instructor utility that converts CSV/TSV data into a StatLens-format JSON dataset. Three steps: (1) paste or upload CSV/TSV — the parser auto-detects the delimiter and infers each column's type; (2) fill in metadata (name, description, source, chapter, study description, variable descriptions and labels, optional categorical `levels`); (3) export the JSON via copy-to-clipboard or file download. Includes instructions for hosting the result on a GitHub Gist and linking it into any tool via `?json=`.
**Concepts:** N/A (authoring utility)

**URL Parameters:** None. All configuration is through the on-page form.

**Compatible Datasets:** N/A — it *produces* datasets. Output can be loaded into any tool with `?json=<url>`.

**Textbook Integration Notes:** Use to add new course datasets without hand-writing JSON. The output conforms to the dataset JSON convention in `CLAUDE.md`. Not linked from student-facing chapters.

---

## Dataset Reference

Datasets are stored as JSON in `data/` and indexed in `data/datasets.json`. Each dataset has these metadata fields:

| Field | Description |
|-------|-------------|
| `id` | Unique identifier (used in `?dataset=` URL param) |
| `name` | Display name |
| `description` | Brief description |
| `type` | Primary use: `bootstrap`, `randomization`, `randomization_prop`, `bootstrap_prop`, `regression`, `paired`, `chisq`, `explore`, `one_cat`, `anova` |
| `n` | Sample size |
| `variables` | Array of variable names |
| `hasNumeric` | Whether dataset has numeric variables |
| `hasCategorical` | Whether dataset has categorical variables |

**Dataset types and their primary tool pages:**

| Type | Primary Pages |
|------|--------------|
| `bootstrap` | bootstrap-mean, descriptive |
| `bootstrap_prop` | bootstrap-prop, randomization-one-prop, inference/one-prop |
| `randomization` | randomization-diff-means, bootstrap-two-means, grouped, inference/two-means |
| `randomization_prop` | randomization-diff-props, bootstrap-two-props, inference/two-props |
| `regression` | regression, bootstrap-slope, randomization-correlation, inference/slope |
| `paired` | bootstrap-paired, randomization-paired, inference/paired |
| `chisq` | randomization-chisq, categorical, inference/chisq |
| `explore` | descriptive, grouped |
| `one_cat` | one-cat, randomization-one-prop, inference/one-prop |
| `anova` | randomization-anova, inference/anova, grouped |

**Total datasets:** 98 bundled, 47 with `inferenceContexts` for auto-populated hypothesis tests.

---

## Suggested Textbook Link Patterns

### Inline Demo Links

For embedding in textbook sections, use the full URL with parameters:

```
https://learnlens.org/statlens/explore/descriptive/?dataset=penny_ages
https://learnlens.org/statlens/distribution/normal/?mu=100&sigma=15&tail=left
https://learnlens.org/statlens/simulate/randomization-diff-props/?dataset=sex_discrimination&direction=greater
https://learnlens.org/statlens/inference/one-mean/?dataset=penny_ages
```

### Exercise Links with Seeds

For graded exercises, include a seed for deterministic results:

```
https://learnlens.org/statlens/simulate/bootstrap-mean/?dataset=penny_ages&seed=hw5q1&ci=95
```

### Conceptual Activities

For classroom presentation:

```
https://learnlens.org/statlens/simulate/randomization-diff-props/?activity=randomization-test-gated.json&mode=present
https://learnlens.org/statlens/conceptual/sampling-lab/
```

### Workflow Chains

Link explore, then simulate, then inference for the same dataset:

1. `explore/descriptive/?dataset=penny_ages` — examine the distribution
2. `simulate/bootstrap-mean/?dataset=penny_ages` — build the bootstrap CI
3. `inference/one-mean/?dataset=penny_ages` — formal t-test and CI
