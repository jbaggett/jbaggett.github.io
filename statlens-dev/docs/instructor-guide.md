# StatLens Instructor Guide

A practical guide for instructors using StatLens in their courses. Covers how to get data into StatLens, how to share pre-configured tool links with students, and how to use instructor-specific features.

---

## Getting Data Into StatLens

StatLens offers several ways to load data, from zero-setup to fully automated.

### Built-in Datasets

Every tool page has a **Datasets** tab with curated datasets filtered to match the tool. Students select from a dropdown — no files or URLs needed.

### Open a File

Every tool page has an **Open File** tab that accepts:

- **CSV** files (comma-separated values)
- **TSV** files (tab-separated values — common when copying from spreadsheets)
- **JSON** files (StatLens dataset format — created by the [Dataset Builder](https://learnlens.org/statlens/data/builder/))

This is the simplest way for instructors to distribute custom data: build a dataset JSON in the Dataset Builder, download it, and share the `.json` file with students (via LMS, email, or course website). Students open it on whatever StatLens page they need.

### Paste or Type Data

The **Edit Data** tab on each page lets students paste CSV data, type values into a spreadsheet-style editor, or (on categorical pages) enter summary counts directly.

JSON dataset files can also be pasted into the CSV textarea — StatLens detects the format automatically.

### URL Parameters

For textbook links, LMS integration, and pre-configured activities, data can be loaded via URL parameters:

| Parameter | Use case | Example |
|-----------|----------|---------|
| `?dataset=penny_ages` | Load a built-in dataset by ID | Textbook callouts |
| `?json=https://...` | Load a JSON dataset from a URL | Hosted custom datasets |
| `?csv=https://...` | Load a CSV/TSV file from a URL | Quick sharing without JSON conversion |
| `?data=1.2,3.4,5.6` | Inline numeric data | MyOpenMath per-student data |

See the full [URL API Reference](url-api.md) for all parameters.

### Hosting Custom Datasets

To create a shareable URL that auto-loads your dataset:

1. Build your dataset in the [Dataset Builder](https://learnlens.org/statlens/data/builder/) or prepare a CSV file
2. Host it on [GitHub Gist](https://gist.github.com) (click "Raw" to get the direct URL) or any HTTPS server
3. Append `?json=YOUR_RAW_URL` or `?csv=YOUR_RAW_URL` to any StatLens page URL

This works on every page — explore tools, simulation pages, inference tests, distribution calculators.

---

## The Dataset Builder

The [Dataset Builder](https://learnlens.org/statlens/data/builder/) is an instructor tool for creating StatLens-compatible dataset files.

1. **Paste or upload** CSV/TSV data
2. **Configure columns** — override auto-detected types, set ordinal level ordering for categorical variables
3. **Add metadata** — display name, description, study context, variable descriptions
4. **Export** — copy JSON to clipboard or download as a `.json` file

### Ordinal Level Ordering

For categorical variables with a meaningful order (Likert scales, education levels, income brackets), you can specify the level order in the **Levels** column of the Column Configuration table. Enter comma-separated values in order:

```
Strongly Disagree, Disagree, Neutral, Agree, Strongly Agree
```

When a dataset with levels is loaded in StatLens, the "Data order" sort option respects this sequence. Without levels, categories appear in first-occurrence order.

---

## Pre-Configuring Tools with URL Parameters

Every StatLens page reads URL parameters to pre-configure its state. This lets you create direct links that open exactly the view you want students to see.

### Common patterns

**Textbook callout** — link students to a specific dataset:
```
https://learnlens.org/statlens/simulate/bootstrap-mean/?dataset=penny_ages
```

**Graded assessment** — add a seed for reproducible output:
```
https://learnlens.org/statlens/simulate/randomization-one-prop/?dataset=opportunity_cost&seed=hw3q5&direction=less
```

**Visual judgment exercise** — hide numeric labels so students must judge from the chart:
```
https://learnlens.org/statlens/explore/one-cat/?dataset=brexit&labels=names
```

**Category ordering exploration** — start with alphabetical sort so students discover frequency ordering is better:
```
https://learnlens.org/statlens/explore/one-cat/?dataset=brexit&sort=alpha
```

**Embedded in an LMS** — compact mode hides navigation chrome:
```
https://learnlens.org/statlens/simulate/bootstrap-mean/?dataset=penny_ages&embed=true
```

**Guided activity** — load a step-by-step instruction panel alongside the tool:
```
https://learnlens.org/statlens/simulate/bootstrap-mean/?activity=bootstrap-explore.json
```

See the full [URL API Reference](url-api.md) for all available parameters.

---

## Presentation Mode

StatLens activity pages support two modes:

- **Discovery mode** (default) — progressive disclosure with gated questions for student self-pacing
- **Presentation mode** — all steps visible, clean interface for instructor projection

Toggle via the settings gear on any activity page, or add `?mode=present` to the URL.

---

## Guided Activities

Activities are JSON files that add a step-by-step instruction panel to any tool page. They're used for in-class walkthroughs and homework explorations.

- **Using activities**: Append `?activity=filename.json` to any tool URL
- **Authoring activities**: See the [Activity Authoring Guide](activity-authoring-guide.md)
- **Activity files**: Stored in [`activities/`](https://learnlens.org/statlens/activities/)

---

## Assessment Integration

### MyOpenMath

MOM homework problems can generate per-student data and build StatLens URLs with `?data=` and `?seed=`. Students run simulations in StatLens and enter results back in MOM. The deterministic PRNG ensures reproducible output for grading.

### Canvas New Quizzes

Pre-computed quiz variants link to StatLens with specific seeds. See [Canvas Integration Report](Canvas_Quiz_StatLens_Integration_Report.md) and [MyOpenMath Investigation](MyOpenMath_Investigation_Report.md) for details.

---

## Quick Reference

| I want to... | Do this |
|---|---|
| Share a custom dataset with students | Build in Dataset Builder → download JSON → share file |
| Link students to a pre-loaded tool | Use `?dataset=id` or `?json=url` in the link |
| Hide numbers for a visual exercise | Add `?labels=names` or `?labels=none` |
| Pre-set category ordering | Add `?sort=alpha` or `?sort=freq-desc` |
| Embed in Canvas/Moodle | Add `?embed=true` to the URL |
| Make output reproducible for grading | Add `?seed=some_string` |
| Create a guided walkthrough | Write an activity JSON, link with `?activity=filename.json` |
| Project in class without gates | Add `?mode=present` or use settings gear |
