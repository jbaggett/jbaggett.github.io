# Canvas Quiz + StatLens Integration Report

**Date**: 2026-03-06
**Purpose**: Assess Canvas LMS native quiz capabilities for use as the primary assessment platform in an IMS-based intro stats course (Stat 145), with StatLens providing the simulation/computation layer.

---

## Table of Contents

1. [Canvas New Quizzes Capabilities](#1-canvas-new-quizzes-capabilities)
2. [Embedding StatLens in Canvas Quiz Questions](#2-embedding-statlens-in-canvas-quiz-questions)
3. [Question Banks, Item Banks, and Randomization](#3-question-banks-item-banks-and-randomization)
4. [Blueprint Courses and Quizzes](#4-blueprint-courses-and-quizzes)
5. [Canvas Quiz + StatLens Workflow Design](#5-canvas-quiz--statlens-workflow-design)
6. [QTI Generation Pipeline](#6-qti-generation-pipeline)
7. [Canvas-Native vs WeBWorK/MyOpenMath](#7-canvas-native-vs-webworkmyopenmath)
8. [Classic vs New Quizzes Timeline](#8-classic-vs-new-quizzes-timeline)
9. [Recommendations and Next Steps](#9-recommendations-and-next-steps)

---

## 1. Canvas New Quizzes Capabilities

### Question Types Available (as of 2025-2026)

Canvas New Quizzes provides **13 question types**:

| Question Type | Auto-Graded? | Notes |
|---------------|-------------|-------|
| **Multiple Choice** | Yes | Single correct answer |
| **Multiple Answer** | Yes | Multiple correct selections |
| **True/False** | Yes | Binary |
| **Numeric** | Yes | Exact, margin, range, or precision |
| **Formula** | Yes | Variables randomized per student |
| **Fill in the Blank** | Yes | Text, dropdown, or word bank |
| **Matching** | Yes | Pair items |
| **Ordering** | Yes | Put items in correct sequence; **NOT accessible** |
| **Categorization** | Yes | Sort items into categories; **NOT accessible** |
| **Hot Spot** | Yes | Click correct area on image; **NOT accessible** |
| **Essay** | No | Manual grading required |
| **File Upload** | No | Manual grading required |
| **Stimulus** | N/A | Content panel alongside questions (not a question itself) |

**Accessibility warning**: Hot Spot, Ordering, and Categorization are inaccessible to screen reader users and keyboard-only users. Avoid these for an accessible course.

### Formula Questions

Formula questions are the key to per-student randomization. In New Quizzes:

- Variables are marked with **backticks** in the question stem: `` `x` ``, `` `n` ``
- Variable **ranges** are set by specifying min, max, and decimal places
- Canvas generates **random values within the range** for each student attempt
- The **formula definition** uses operators: `+`, `-`, `*`, `/`, `^`
- Multi-step formulas are supported: Canvas uses the **last row** as the final answer
- Each step can reference prior variables (e.g., `m = mean(v, w, x, y, z)`)

### Formula Helper Functions (Complete List)

**Mathematical**: `abs`, `sqrt`, `fact`, `round`, `ceil`, `floor`
**Trigonometric**: `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `sec`, `cosec`, `cotan`
**Logarithmic**: `ln`, `log` (with optional base)
**Combinatorics**: `comb`, `perm`
**Statistical**: `mean`, `median`, `range`, `max`, `min`, `sum`, `count`, `length`
**List operations**: `sort`, `reverse`, `at`, `first`, `last`
**Utility**: `if(bool, success, fail)`, `rand`, `deg_to_rad`, `rad_to_deg`
**Constants**: `e`, `pi()`

### CRITICAL LIMITATION: No Distribution Functions

Canvas formula questions have **NO** distribution functions:
- No `normalcdf`, `invnorm`, `tcdf`, `tinv`
- No chi-square, F, or binomial functions
- No z-score lookup capability

**This means**: Canvas cannot auto-compute answers that require looking up a t-critical value, computing a p-value from a test statistic, or finding a normal probability. The workaround documented in MEMORY.md (embedded lookup table with `at(reverse(...), index)`) works for t-critical but is extremely tedious.

**For StatLens integration, this is actually fine** -- the student uses StatLens for the computation and enters the result into Canvas. Canvas just needs to check whether the entered answer is within tolerance.

### Numeric Question Answer Types

Numeric questions (separate from Formula questions) support four grading modes:

1. **Exact Response**: Must match exactly
2. **Margin of Error**: Correct if within `answer +/- margin`
3. **Within a Range**: Correct if `start <= answer <= end`
4. **Precise Response**: Correct to N significant digits or decimal places

**For bootstrap CIs**: "Within a Range" or "Margin of Error" are the best options.

### Stimulus Content

Stimulus is a content panel that appears **side-by-side** with associated questions:
- Can contain text, images, tables, diagrams, charts, graphs
- Supports the Rich Content Editor (text formatting, links, images)
- Can embed media (video) -- YouTube and Vimeo confirmed working
- **Iframe embedding**: Available via the "Insert Media > HTML Embed" option, but unreliable for non-video content
- Not a question type itself -- must be attached to one or more questions
- Ideal for: presenting a dataset description, scenario, or instructions that multiple questions reference

---

## 2. Embedding StatLens in Canvas Quiz Questions

### Can quiz questions contain iframes?

**Technically yes, but with caveats:**

- Canvas HTML allowlist explicitly includes `<iframe>` with attributes: `src`, `width`, `height`, `name`, `align`, `allowfullscreen`
- All elements also allow: `style`, `class`, `id`, `title`, `role`, `lang`, `dir`
- YouTube and Vimeo iframes work reliably in question stems and stimulus content
- **Non-video iframes** (like a StatLens tool) may or may not work depending on:
  - Canvas **Content Security Policy (CSP)** settings at the institutional level
  - The admin allowlist of domains (max 50 custom domains, plus automatic Instructure domains)
  - LTI tools are automatically allowlisted

**Action needed**: Check whether UWL's Canvas admin has CSP enabled, and if so, whether `datascienceuwl.github.io` is on the allowlist. If not, request it be added.

### Can quiz questions contain clickable links?

**Yes -- this is the most reliable approach.**

- The Rich Content Editor in New Quizzes supports inserting external links via Insert > Link > External Link
- Links in question stems render as clickable `<a>` tags
- Links can open StatLens in a new tab
- **This is the recommended approach** over iframes

### Can formula variables be used in URLs?

**No.** Formula variables (backtick syntax) are designed for the question text and the formula definition only. They cannot be interpolated into URLs, `href` attributes, or iframe `src` attributes.

**This is the fundamental limitation**: Canvas cannot dynamically construct per-student StatLens URLs using formula variables.

### Workarounds for Per-Student StatLens URLs

**Option A: Pre-computed variants (RECOMMENDED)**

Instead of dynamic URLs, create many variants of each question, each with:
- A different StatLens URL (with a different seed parameter)
- A pre-computed correct answer

Place all variants in an item bank. Canvas randomly selects one variant per student. Each student gets a different seed, different data, and a different answer.

**Option B: Single StatLens link + formula question**

- All students visit the same StatLens URL
- StatLens generates random data client-side (no seed in URL)
- The quiz uses a formula question where the answer happens to be deterministic given the student's randomized parameters
- Works only for questions where StatLens illustrates a concept but doesn't produce the answer

**Option C: StatLens with student-entered seed**

- Quiz question tells the student: "Use seed = `seed_value`" (where `seed_value` is a formula variable)
- Student enters that seed in StatLens manually
- StatLens generates deterministic output based on the seed
- Student enters the result in Canvas
- **Problem**: Formula variables can only appear in the question stem text, and the pre-computed answer must match StatLens's output for that seed -- but Canvas computes the answer from the formula, not from StatLens's output

**Option C is theoretically elegant but practically fragile** -- it requires perfect alignment between Canvas's formula computation and StatLens's computation for every seed value. If Canvas can't compute the answer (e.g., a bootstrap CI), you'd need to use Option A anyway.

---

## 3. Question Banks, Item Banks, and Randomization

### Item Banks in New Quizzes

- **Item banks** replace Classic Quizzes' "question banks"
- Items can be added to a quiz in two ways:
  1. **All items**: Every item in the bank appears (in random order)
  2. **Random set**: Specify N items to randomly select from the bank
- Points per question can be set when pulling from a bank
- Questions pulled from the **same bank must have the same point value**
- Banks are scoped to the **course** by default; can be shared with other courses

### Question Groups (Randomization)

- Select "Randomly select questions" and specify the count
- The count must be <= total items in the bank
- Each student gets a **different random subset**
- Items display in **random order**
- For our workflow: put 50-200 variants of one problem in a bank, randomly select 1

### How Many Variants Are Practical?

Based on the pre-computed variant approach:

| Variants | Feasibility | Notes |
|----------|------------|-------|
| 10-20 | Too few | High collision rate among students |
| 50 | Minimum viable | ~2% chance of two students getting same variant |
| 100 | Good | Low collision, manageable to generate |
| 200 | Excellent | Very low collision, still reasonable file size |
| 500+ | Overkill | Diminishing returns; QTI file becomes large |

**Recommendation**: 50-100 variants per problem, generated by Python script.

### Item Bank Sharing and Import

- Item banks are **not shared** with a course by default upon creation
- Banks from one course can be shared to another
- QTI import creates items that appear under "This Course" in the Item Banks tool
- Question bank migration from Classic to New Quizzes: use "Convert content to New Quizzes" checkbox during course copy/import

---

## 4. Blueprint Courses and Quizzes

### Current Status (2025-2026)

- **New Quiz Item Banks are now supported in Blueprint Courses** -- this is a relatively recent addition
- Blueprint syncing pushes quiz content to associated courses
- **Locking quizzes**: Instructure has been working on adding Blueprint locking functionality for quizzes
- **Regrade limitation**: Regrades must be applied in each child course individually -- cannot be done from the Blueprint template

### Known Limitations

- Item banks sync, but the exact behavior for large banks (100+ items) should be tested
- New Quizzes are LTI-based (they launch in a separate frame), which can cause quirks with internal Canvas links
- For multi-section courses: each section is a separate Canvas course in the Blueprint model, so quiz attempts are per-course

### Recommendation

Blueprint is viable for Stat 145 multi-section deployment. Test with a small item bank first to verify sync behavior before creating 50+ variant banks.

---

## 5. Canvas Quiz + StatLens Workflow Design

### Recommended Workflow (Pre-Computed Variant Approach)

```
1. AUTHORING PHASE (instructor, once per problem):

   Python script:
   ├── For seed in range(1, 101):
   │   ├── Generate dataset using seed
   │   ├── Run simulation (bootstrap CI, permutation test, etc.)
   │   ├── Record correct answer (CI bounds, p-value, etc.)
   │   ├── Generate StatLens URL: https://datascienceuwl.github.io/STAT145/statlens/?seed={seed}&type=bootstrap_ci
   │   └── Create QTI question variant:
   │       ├── Stimulus: "A researcher collected data on... [context]"
   │       ├── Question stem: "Open StatLens: [link to StatLens URL]
   │       │    Run 1000 bootstrap samples. Report the 95% CI."
   │       ├── Answer: numeric, range [lower_bound, upper_bound] with margin
   │       └── (repeat for follow-up questions using same stimulus)
   └── Package all 100 variants into QTI zip file

2. IMPORT PHASE:
   ├── Import QTI zip into Canvas (Settings > Import Course Content > QTI)
   ├── Variants appear as items in an item bank
   └── Create quiz, add "Random set: 1 from [bank name]"

3. STUDENT EXPERIENCE:
   ├── Student opens Canvas quiz
   ├── Canvas randomly assigns one variant (one seed)
   ├── Student sees question with link: "Click here to open StatLens"
   ├── StatLens opens in new tab with pre-set seed → deterministic dataset
   ├── Student runs bootstrap simulation in StatLens
   ├── Student reads CI bounds from StatLens output
   ├── Student enters values into Canvas numeric fields
   ├── Canvas auto-grades using pre-computed tolerance range
   └── Score appears immediately in gradebook
```

### Answer Types for Simulation Results

| Simulation Output | Canvas Question Type | Tolerance Strategy |
|-------------------|---------------------|-------------------|
| **Bootstrap CI bounds** | Two numeric questions (lower, upper) | Range: pre-computed 2.5th/97.5th percentile +/- 0.5 units |
| **p-value** | Numeric with margin | Margin of error: +/- 0.02 (for 1000 samples) |
| **Test statistic** | Numeric with margin | Margin: +/- 0.01 (deterministic if seed is fixed) |
| **Mean of bootstrap distribution** | Numeric with margin | Margin: +/- 0.1 |
| **"Reject or fail to reject?"** | Multiple choice | Exact match |
| **Interpretation** | Essay | Manual grading |

### Tolerance for Bootstrap CIs

Bootstrap confidence intervals have inherent randomness. With a fixed seed:
- **1000 bootstrap samples**: CI endpoints vary by roughly +/- 0.5 in typical units
- **10000 bootstrap samples**: Tighter, roughly +/- 0.15

If StatLens uses a **fixed seed** and **fixed number of bootstrap samples**, the output is **fully deterministic**. The tolerance then only needs to account for:
- Rounding differences between StatLens and what the student types
- Recommended: +/- 0.1 for the CI bounds (or even exact match if StatLens rounds for the student)

If StatLens does NOT use a fixed seed:
- Need much wider tolerance (conceptual contradiction -- defeats the purpose of auto-grading)
- **Strong recommendation**: Always use fixed seeds for graded assessments

---

## 6. QTI Generation Pipeline

### Available Python Libraries

| Library | QTI Version | Question Types | Status | Canvas Compatibility |
|---------|------------|----------------|--------|---------------------|
| **text2qti** | 1.2 | MC, T/F, Multiple-answer, Numeric, Short-answer, Essay, File-upload | **Active** (v0.7.1, Oct 2025) | Classic: Yes. New: Import to Classic first, then migrate |
| **text-to-qti** | 2.1 | MC, T/F | Maintained | Limited question types |
| **qti-package-maker** | 1.2 and 2.1 | Varies | Available | Canvas + Blackboard |
| **md2Canvas** | 1.2 (via text2qti) | All text2qti types | Active | Same as text2qti |
| **canvasapi** (Python) | N/A (REST API) | All Canvas types | Active | Direct API, bypasses QTI |
| **docx2qti** | 1.2 | Various | Available | Canvas |

### text2qti: Best Choice for This Project

text2qti supports **numerical questions with tolerance**, which is exactly what we need:

```markdown
1. What is the lower bound of the 95% bootstrap confidence interval?
Open StatLens: https://datascienceuwl.github.io/STAT145/statlens/?seed=42&type=ci
= [23.45, 23.65]

2. What is the upper bound?
= [31.20, 31.40]
```

Syntax options:
- `= [min, max]` -- range
- `= value +- margin` -- margin of error
- `= value +- 5%` -- percentage margin
- `= 42` -- exact integer

### New Quizzes Compatibility Issue

**Known problem**: QTI files with question groups sometimes fail to import directly into New Quizzes (Canvas reports success but creates empty quizzes).

**Workaround (confirmed working)**:
1. Import QTI into a **Classic Quiz** first
2. Use Canvas's "Convert content to New Quizzes" migration tool
3. Questions appear in New Quizzes item banks

This two-step process is clunky but reliable.

### Alternative: Canvas REST API

For full control, use the `canvasapi` Python library to create questions directly:

```python
from canvasapi import Canvas

canvas = Canvas("https://uwlax.instructure.com", API_KEY)
course = canvas.get_course(COURSE_ID)
quiz = course.get_quiz(QUIZ_ID)

quiz.create_question(question={
    'question_name': 'Bootstrap CI Lower Bound (seed=42)',
    'question_text': '<p>Open <a href="https://datascienceuwl.github.io/STAT145/statlens/?seed=42" target="_blank">StatLens</a>. Run 1000 bootstrap samples. Report the lower bound of the 95% CI.</p>',
    'question_type': 'numerical_question',
    'points_possible': 5,
    'answers': [{
        'numerical_answer_type': 'range_answer',
        'start': 23.45,
        'end': 23.65,
        'answer_weight': 100
    }]
})
```

**Caveat**: The Canvas REST API works with **Classic Quizzes** only. New Quizzes has a separate API (less documented, still evolving).

### Recommended Pipeline

```
Python Generator Script
├── Input: problem template + parameter ranges
├── For each seed:
│   ├── Generate data
│   ├── Run simulation (scipy/numpy)
│   ├── Compute correct answers
│   ├── Format as text2qti markdown
│   └── Include StatLens URL with seed
├── Output: quiz.txt file (text2qti format)
├── Run: text2qti quiz.txt → quiz.zip (QTI 1.2)
└── Import into Canvas (Classic first, then migrate)
```

### How Many Variants?

- text2qti processes plain text, so 100-200 variants in a single file is trivial
- QTI zip files stay small (each variant is a few KB of XML + HTML)
- 200 variants = ~500 KB zip file
- Canvas item banks have no documented size limit for practical purposes
- **Recommendation**: 100 variants per problem, 10-15 problems per quiz = ~1000-1500 bank items per module

---

## 7. Canvas-Native vs WeBWorK/MyOpenMath

### Advantages of Canvas-Native Quizzes

| Factor | Canvas Native | WeBWorK | MyOpenMath |
|--------|--------------|---------|------------|
| **Student login** | Already in Canvas | Separate login (LTI helps) | Separate login (LTI approved) |
| **Gradebook sync** | Automatic, native | Via LTI (sometimes glitchy) | Via LTI (approved for UW System) |
| **SpeedGrader** | Full support | N/A | N/A |
| **Analytics** | Item analysis, discrimination index, score distribution | Basic stats | Basic stats |
| **Familiar UI** | Students already know Canvas | New interface to learn | New interface to learn |
| **Accessibility** | WCAG 2.2 Level AA (WebAIM certified) | Variable | Variable |
| **StatLens links** | Yes, in question stem | Yes, in problem text | Yes, in problem text |
| **Formula randomization** | Yes (per-student variables) | Yes (PG variables) | Yes (PHP variables) |
| **Distribution functions** | **NO** | **YES** (full R integration possible) | **YES** (limited but present) |
| **Bootstrap/simulation** | **NO** (needs StatLens) | **YES** (if Rserve enabled) | **NO** (1000-iter PHP limit) |
| **Setup effort** | Medium (QTI generation) | High (PG authoring) | Medium |
| **Maintenance** | Low (Canvas updates automatic) | Medium (server maintenance) | Low |

### When Canvas-Native Wins

1. **Concept checks**: "What does a p-value of 0.03 mean?" -- Multiple choice, no computation needed
2. **Reading quizzes**: "Which IMS chapter discusses bootstrap CIs?" -- Multiple choice
3. **Interpretation questions**: "Based on the CI (23.5, 31.4), is there evidence...?" -- Multiple choice
4. **StatLens-assisted computation**: Student uses StatLens, enters result in Canvas -- Numeric with tolerance
5. **Simple calculations**: "Compute the sample mean of: 3, 7, 2, 9, 5" -- Formula question
6. **File submission**: "Submit your R script" -- File upload

### When WeBWorK/MyOpenMath Win

1. **Multi-step statistical computations** requiring distribution lookups (t-test, chi-square test)
2. **Problems requiring R code** execution and output validation
3. **Symbolic math** or algebraic manipulation
4. **Truly randomized problems** with server-side computation of correct answers
5. **Problems where the answer depends on distribution table values** that Canvas cannot compute

### Hybrid Recommendation

Use **both** Canvas quizzes and WeBWorK/MyOpenMath:
- **Canvas quizzes**: Concept checks, reading quizzes, StatLens-assisted simulation problems, interpretation questions (~60% of assessments)
- **WeBWorK**: Computation-heavy problems requiring distribution functions, R integration if Rserve is available (~40% of assessments)

This maximizes student convenience (most work stays in Canvas) while leveraging WeBWorK's computational power where needed.

---

## 8. Classic vs New Quizzes Timeline

### Current Status (March 2026)

- Instructure has **removed the end-of-life date** for Classic Quizzes
- There is **no mandatory migration deadline** as of early 2026
- Individual institutions may set their own timelines (e.g., UHD set December 2025)
- Development focus is on New Quizzes -- Classic Quizzes receive bug fixes only
- UWL's timeline: **check with LMS admin**

### Recommendation

- **Author new content for New Quizzes** (future-proof)
- Use the Classic → New Quizzes migration path for QTI imports
- QTI 1.2 format works with both Classic and New Quizzes (with migration step)
- Test the complete pipeline early before building all 7 modules

---

## 9. Recommendations and Next Steps

### Immediate Actions

1. **Check CSP settings**: Contact UWL Canvas admin to verify `datascienceuwl.github.io` is on the CSP allowlist, or request it be added. This is required for StatLens iframes (and possibly even links, depending on how New Quizzes handles the LTI frame).

2. **Build a proof-of-concept**:
   - Create one StatLens problem with seed=42
   - Generate 10 variants using text2qti
   - Import into Canvas (Classic first, then migrate to New Quizzes)
   - Test the student experience end-to-end
   - Verify that the StatLens link works from within a New Quizzes question

3. **Test iframe vs link approach**:
   - Try embedding StatLens as an iframe in a stimulus panel
   - Try a plain hyperlink in the question stem
   - Determine which provides the better student experience

4. **Determine StatLens seed behavior**:
   - StatLens must support URL-based seed parameters
   - StatLens must produce **deterministic output** for a given seed
   - StatLens output must be easily readable (clear display of CI bounds, p-value, etc.)
   - Design the seed → answer mapping before building the QTI pipeline

### Pipeline Architecture

```
                    ┌──────────────────┐
                    │  Problem Template │
                    │  (Python + Markdown)│
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │  Generator Script │
                    │  (numpy/scipy)    │
                    │  100 seeds        │
                    └────────┬─────────┘
                             │
                ┌────────────┼────────────┐
                │            │            │
        ┌───────▼──────┐ ┌──▼───────┐ ┌──▼──────────┐
        │ StatLens URLs  │ │ Correct  │ │ text2qti    │
        │ with seeds   │ │ answers  │ │ markdown    │
        └───────┬──────┘ └──┬───────┘ └──┬──────────┘
                │           │            │
                └───────────┼────────────┘
                            │
                   ┌────────▼─────────┐
                   │  text2qti        │
                   │  → QTI 1.2 zip   │
                   └────────┬─────────┘
                            │
                   ┌────────▼─────────┐
                   │  Canvas Import   │
                   │  (Classic Quiz)  │
                   └────────┬─────────┘
                            │
                   ┌────────▼─────────┐
                   │  Migrate to      │
                   │  New Quizzes      │
                   └────────┬─────────┘
                            │
                   ┌────────▼─────────┐
                   │  Item Bank       │
                   │  (100 variants)  │
                   └────────┬─────────┘
                            │
                   ┌────────▼─────────┐
                   │  Quiz draws 1    │
                   │  random variant  │
                   └──────────────────┘
```

### Key Design Decisions Still Needed

1. **StatLens URL structure**: What parameters does StatLens accept? (`seed`, `type`, `n`, `alpha`, etc.)
2. **Tolerance strategy**: How wide for each question type? (Depends on StatLens's determinism)
3. **Number of variants**: 50 vs 100 vs 200 per problem
4. **Link vs iframe**: Which works better in the New Quizzes environment?
5. **WeBWorK split**: Which problems go to Canvas vs WeBWorK?
6. **Blueprint testing**: Verify item bank sync with 100+ items before full build

### Estimated Effort

| Task | Hours |
|------|-------|
| StatLens PoC (one problem, 10 variants) | 4-6 |
| QTI generator script (reusable template) | 8-12 |
| Build item banks for Module 1 (15 problems x 100 variants) | 12-16 |
| Canvas import + New Quizzes migration testing | 4-6 |
| CSP / iframe / link testing | 2-3 |
| Full pipeline for all 7 modules | 50-70 |
| **Total**: | **80-113** |

---

## Sources

### Canvas Documentation
- [Canvas HTML Editor Allowlist](https://community.instructure.com/t5/Canvas-Resource-Documents/Canvas-HTML-Editor-Allowlist/ta-p/387066) -- iframe is explicitly on the allowlist
- [Canvas Formula Quiz Question Helper Functions](https://community.instructure.com/en/kb/articles/387062-canvas-formula-quiz-question-helper-functions)
- [How do I create a Formula question in New Quizzes?](https://community.instructure.com/t5/Instructor-Guide/How-do-I-create-a-Formula-question-in-New-Quizzes/ta-p/956)
- [How do I insert stimulus content in New Quizzes?](https://community.instructure.com/t5/Instructor-Guide/How-do-I-insert-stimulus-content-in-New-Quizzes/ta-p/573)
- [How do I create a Numeric question in New Quizzes?](https://community.canvaslms.com/t5/Instructor-Guide/How-do-I-create-a-Numeric-question-in-New-Quizzes/ta-p/986) -- exact, margin, range, precision modes
- [Content Security Policy management](https://community.canvaslms.com/t5/Admin-Guide/How-do-I-manage-the-Content-Security-Policy-for-an-account/ta-p/149) -- CSP domain allowlist
- [Updates to New Quizzes and Blueprint Courses Syncing](https://community.canvaslms.com/t5/The-Product-Blog/Updates-to-New-Quizzes-and-Blueprint-Courses-Syncing/ba-p/534072)
- [How do I add all items or a random set from an item bank to a quiz?](https://community.canvaslms.com/t5/Instructor-Guide/How-do-I-add-all-items-or-a-random-set-from-an-item-bank-to-a/ta-p/583)
- [Quiz Questions REST API](https://canvas.instructure.com/doc/api/quiz_questions.html)
- [Classic Quizzes v. New Quizzes](https://canvas.jhu.edu/faculty-resources/classic-quizzes-v-new-quizzes/)
- [Canvas VPAT / Accessibility](https://www.instructure.com/products/canvas/accessibility) -- WCAG 2.2 Level AA
- [We're Listening: New Quizzes Features, Classic Quizzes Timeline](https://community.canvaslms.com/t5/The-Product-Blog/We-re-Listening-New-Quizzes-Features-Classic-Quizzes-Timeline/ba-p/543372)

### Tools and Libraries
- [text2qti (GitHub)](https://github.com/gpoore/text2qti) -- v0.7.1, supports numeric questions with tolerance
- [text2qti (PyPI)](https://pypi.org/project/text2qti/)
- [md2Canvas (GitHub)](https://github.com/molpopgen/md2Canvas) -- Python-generated quiz variants via text2qti
- [text2qti New Quizzes compatibility issue](https://github.com/gpoore/text2qti/issues/46) -- workaround: import to Classic first
- [canvasapi Python library](https://canvasapi.readthedocs.io/en/stable/quiz-ref.html)
- [Using Python to create Calculated Questions](https://community.instructure.com/t5/Canvas-Developers-Group/Using-Python-to-create-Calculated-Questions/ba-p/279995)
- [qti-package-maker (PyPI)](https://pypi.org/project/qti-package-maker/)

### UWL-Specific
- [UWL KB: Multi-step Formula questions in New Quizzes](https://kb.uwlax.edu/page.php?id=99238)
- [UWL KB: Multi-step Formula questions in Classic Quizzes](https://kb.uwlax.edu/page.php?id=99237)

### Institutional Guides
- [Exact and partial answer grading in New Quizzes (UAlberta)](https://support.eclass.ualberta.ca/Knowledgebase/Article/View/570/55/exact-and-partial-answer-grading-in-canvas-new-quizzes)
- [New Quizzes FAQ (U-M)](https://its.umich.edu/academics-research/teaching-learning/canvas/new-quizzes/faq)
- [Randomizing Canvas Quizzes Using Item Banks (USask)](https://teaching.usask.ca/articles/2025-03-04-randomizing-canvas-quizzes-using-item-banks.php)
- [Quizzes Accessibility Guide (Cornell)](https://blogs.cornell.edu/ctiaccessibility/canvas/quizzes/)
