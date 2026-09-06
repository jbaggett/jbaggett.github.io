# MyOpenMath Investigation Report for STAT 145 (IMS-Aligned)

**Prepared for**: Jeffrey Baggett, UW-La Crosse
**Date**: March 6, 2026
**Subject**: Comprehensive investigation of MyOpenMath for an IMS-aligned introductory statistics course

---

## Executive Summary

MyOpenMath (MOM) is a viable platform for the standard computation problems in STAT 145 but has significant gaps for simulation-based inference (SBI). Key findings:

1. **No IMS course template exists** on MyOpenMath as of March 2026. OpenIntro is still actively recruiting a volunteer to build one (20-50 hours, unpaid). The only existing stats templates are for OpenIntro Statistics (OIS, 4th ed) and AP Statistics -- both aligned with the older, non-SBI-focused OpenIntro textbook.

2. **The OpenIntro Statistics problem library** covers roughly chapters 1-5 and chapter 7, with partial chapter 8. These are direct ports of OIS textbook exercises -- not IMS exercises. Coverage is incomplete and focused on traditional methods.

3. **Stats capabilities are strong for formula-based problems**: distribution functions (normal, t, chi-square, F, binomial, Poisson), random data generation, histogram/boxplot rendering, regression, ANOVA -- all built in. Authoring is concise (~15 lines for a CI problem).

4. **No bootstrap/permutation simulation is possible** due to the hard 1000-iteration PHP sandbox limit. StatLens (or your seeded simulation tool) must handle all SBI activities externally.

5. **Iframe embedding in question text appears supported** (question text is HTML-based), but underdocumented. The `csvdownloadlink()` function can give each student a downloadable dataset. String concatenation can construct per-student URLs for StatLens.

6. **UW System Canvas LTI is approved** (except UW-Madison). LTI 1.1 and 1.3 both supported. Grade passback works.

7. **For this specific course**, the MOM + StatLens combination covers ~80% of homework needs with minimal infrastructure. The remaining 20% (SBI interpretation problems) requires either MC questions in MOM or WeBWorK+R for dynamic plots.

---

## 1. Existing IMS-Aligned Courses on MyOpenMath

### 1.1 Current Template Status: None for IMS

As of March 2026, there is **no MyOpenMath course template for Introduction to Modern Statistics (IMS)**. The OpenIntro project's "Get Involved" page still lists this as an open volunteer position:

- **Role**: MyOpenMath Course Template Developer for IMS
- **Time commitment**: 20-50 hours over a 4-month period
- **Approach**: Build the template while teaching your own IMS course, then generalize
- **Senior advisors**: Mine Cetinkaya-Rundel and Jo Hardin (IMS authors)
- **Status**: Still recruiting -- no one has completed or claimed this project publicly

Source: https://openintro.org/teachers/get_involved/

### 1.2 Existing Templates (Not IMS)

Two course templates exist for OpenIntro textbooks:

| Template | Creator | Course ID | Textbook |
|----------|---------|-----------|----------|
| OpenIntro Statistics | Adam Gilbert | 10899 | OIS 3e/4e |
| OpenIntro AP Statistics | Leah Dorazio | 11774 | AHSS |

The OIS template (cid=10899) includes:
- 11-week course structure
- Embedded YouTube videos from OpenIntro
- Mine Cetinkaya-Rundel's Google Slides
- Auto-graded homework from OIS textbook exercises
- Links to full textbook and tablet-friendly PDFs
- Has been copied over 50 times since 2016
- Updated for 4th edition (with 3rd edition maintained as default)

**Important**: OIS and IMS are different books with different pedagogical approaches. OIS is traditional-methods-first; IMS is simulation-first. The OIS template would need substantial reworking, not just reordering.

Sources: https://www.openintro.org/teachers/myopenmath/ , https://www.openintro.org/forums/thread/?topic=65

### 1.3 Opportunity

Since the IMS volunteer position remains open, you could:
- **Option A**: Apply as the volunteer and build the template while teaching STAT 145, getting OpenIntro credit and community support
- **Option B**: Build your own MOM course privately and share if desired
- **Option C**: Use the OIS template as a structural starting point and heavily modify

---

## 2. Existing Intro Stats Problem Libraries

### 2.1 OpenIntro Textbook Problems Library

The "OpenIntro Textbook Problems" library is accessible within MOM's question search:

**Navigation**: Select Libraries > Textbook Specific > OpenIntro Statistics > OpenIntro Textbook Problems

**Coverage** (as of last documented update):
- Chapters 1-5: Substantially complete
- Chapter 7: Written in
- Chapter 8: Small selection
- Chapters 6, 9: Unknown/incomplete

**Characteristics**:
- Problems appear almost exactly as in the OIS textbook
- Some have been "randomized" with algorithmic parameters (flagged as [RG])
- Many problems used over 100 times on the platform
- Adjustments made so p-values from distribution tables are accepted
- Video solution hints planned/partially added

**Critical limitation**: These are **OIS** problems, not **IMS** problems. IMS has different exercises, different notation, and a fundamentally different sequencing (simulation before CLT). You would need to write new problems for IMS-specific content.

### 2.2 Other Statistics Resources on MOM

| Resource | Notes |
|----------|-------|
| MTH243 Statistics (cid=10962) | 14-unit course, traditional methods, no SBI |
| MTH243 Statistics ReMaster (cid=47403) | OpenStax-aligned, traditional methods |
| MTH243 Statistics Spring 2019 (cid=47610) | Another semester instance |
| Various LibreTexts-linked courses | Citrus College, others -- traditional stats |

**None of these include bootstrap or simulation-based inference content.**

### 2.3 Bootstrap/SBI Problem Gap

This is the fundamental gap: **No MOM problem library anywhere includes bootstrap, permutation test, or simulation-based inference problems.** This is both because:
1. The 1000-iteration limit prevents MOM from running simulations
2. The IMS/SBI pedagogy is newer and no one has built the content yet

For SBI problems, your options are:
- **Multiple choice** in MOM (interpret a given bootstrap distribution, identify correct CI)
- **WeBWorK+R** for fully dynamic SBI problems with per-student plots
- **StatLens + MOM integration** (MOM generates data, links to StatLens, student reads result back)

Sources: https://groups.google.com/g/statistics-teachers/c/7BtELctlRKE , https://openintro.info/stat/myopenmath.php

---

## 3. MyOpenMath Stats Capabilities (Verified and Updated)

### 3.1 The Stats Library -- Full Function Reference

Load with `loadlibrary("stats")` in the Common Control section. The complete function list from the IMathAS source code:

**Distribution Functions (CDF)**:
| Function | Description |
|----------|-------------|
| `normalcdf(z, [dec])` | Standard normal CDF (left-tail area) |
| `tcdf(t, df, [dec])` | t-distribution CDF |
| `chi2cdf(x, df)` | Chi-squared CDF |
| `fcdf(f, df1, df2)` | F-distribution **right-tail** area (1-CDF) |
| `binomialpdf(N, p, x)` / `binomialcdf(N, p, x)` | Binomial PMF/CDF |
| `poissonpdf(lambda, x)` / `poissoncdf(lambda, x)` | Poisson PMF/CDF |
| `gamma_cdf(x, shape, [scale, offset])` | Gamma CDF |
| `beta_cdf(x, alpha, beta)` | Beta CDF |

**Inverse Distribution Functions**:
| Function | Description |
|----------|-------------|
| `invnormalcdf(p, [dec])` | z-value for left-tail area p |
| `invtcdf(p, df, [dec])` | t-value for left-tail probability |
| `invchi2cdf(p, df)` | Chi-squared inverse |
| `invfcdf(p, df1, df2)` | F-distribution inverse |
| `gamma_inv(p, shape, [scale])` | Gamma inverse |
| `beta_inv(p, alpha, beta)` | Beta inverse |

**Descriptive Statistics**:
| Function | Description |
|----------|-------------|
| `mean(array, [weights])` | Mean (optionally weighted) |
| `variance(array, [weights])` / `stdev(array, [weights])` | Sample variance / SD |
| `median(array)` | Median |
| `modes(array)` | Mode(s), "DNE" if none |
| `percentile(array, p)` | p/100*N method |
| `interppercentile(array, p, [mode])` | Interpolated (3 modes) |
| `Nplus1percentile(array, p)` | p/100*(N+1) method |
| `quartile(array, q)` | Quartiles (0-4) |
| `TIquartile(array, q)` | TI-84 calculator method |
| `Excelquartile(array, q)` | Excel QUARTILE.INC |
| `Excelquartileexc(array, q)` | Excel QUARTILE.EXC |
| `countif(array, condition)` | Count matching condition |
| `frequency(array, start, classwidth)` | Frequency array |
| `freqdist(array, label, start, classwidth)` | HTML frequency table |

**Combinatorics**: `nCr(n,r)`, `nPr(n,r)`

**Random Data Generation**:
| Function | Description |
|----------|-------------|
| `normrand(mu, sigma, n, [rnd, positive, skew])` | Normal (Box-Muller) |
| `expdistrand(mu, n, [rnd])` | Exponential |
| `stats_randt(mu, sigma, df, n)` | t-distribution |
| `stats_randchi2(df, n)` | Chi-squared |
| `stats_randF(df1, df2, n)` | F-distribution |
| `stats_randpoisson(lambda, n)` | Poisson |
| `stats_randg(shape, n)` | Gamma |

**Visualization** (server-rendered SVG with automatic alt text):
| Function | Output |
|----------|--------|
| `histogram(data, label, start, cw, ...)` | Frequency histogram |
| `fdhistogram(freqarray, label, start, cw, ...)` | Histogram from frequencies |
| `boxplot(data, label, [options])` | Box plot (supports `showvals`, `showoutliers`, `qmethod`) |
| `dotplot(data, label, ...)` | Dot plot |
| `stem_plot(data, [options])` | Stem-and-leaf |
| `fdbargraph(labels, freqs, label, ...)` | Bar graph |
| `cluster_bargraph(v1labels, v2labels, freqs, ...)` | Grouped bar chart |
| `piechart(percents, labels, ...)` | Pie chart (Google Charts API) |
| `mosaicplot(rowlabels, collabels, matrix, ...)` | Mosaic plot |

**Regression and Inference**:
| Function | Description |
|----------|-------------|
| `linreg(x, y)` | Returns `[r, slope, intercept]` |
| `expreg(x, y)` | Exponential regression |
| `student_t(arr1, arr2, [equalVar, paired])` | Two-sample t-test `[t, p, df]` |
| `chi2teststat(matrix)` | Chi-square test statistic |
| `anova1way(arr1, arr2, ...)` | One-way ANOVA table |
| `anova2way(arr, [replication])` | Two-way ANOVA |

**Utility**:
| Function | Description |
|----------|-------------|
| `csvdownloadlink([filename], string, array, ...)` | Downloadable CSV link |

Source: https://github.com/drlippman/IMathAS/blob/master/assessment/libs/stats.html

### 3.2 Answer Types Available

| Type | Description |
|------|-------------|
| Number | Numeric entry with tolerance |
| Calculated | Computed from formula |
| Multiple Choice | Single-select |
| Multiple Answer | Multi-select |
| Matching | Drag-and-drop or dropdown pairs |
| Function/Expression | Algebraic entry |
| String | Text entry |
| Matrix | Matrix entry |
| Interval | Interval notation |
| Drawing | Canvas-based drawing |
| File Upload | Student uploads a file |
| Essay | Free-text response |
| Multipart | Combined question types |
| Conditional | Branching based on earlier answers |

### 3.3 Per-Student Randomization

MOM generates unique question variants per student through its randomization functions (`rand()`, `rrand()`, `normrand()`, etc.). Internally, each student-question assignment gets a **seed** value (confirmed in the IMathAS source code: `$RND->srand($seed)` in `displayq2.php`). This seed:

- Is generated automatically by the system per student-question pair
- Seeds the internal PRNG so the same student sees the same numbers on reload
- Is **NOT directly accessible** to question authors as a variable
- Cannot be extracted to construct external URLs with matching randomization

This is a key limitation for StatLens integration (discussed in Section 4).

### 3.4 What MOM Cannot Do (Confirmed)

1. **No bootstrap resampling**: 1000-iteration limit in PHP sandbox prevents `for` loops over array operations
2. **No permutation tests**: Same iteration limit
3. **No sampling distribution construction**: Cannot build a distribution from repeated sampling
4. **No arbitrary R/Python execution**: Unlike WeBWorK+R, MOM runs only its own macro language
5. **No seed export**: Cannot give StatLens the same random seed to reproduce data

---

## 4. MyOpenMath + StatLens Integration

### 4.1 Can MOM Embed Iframes in Question Text?

**Likely yes, but underdocumented.** The evidence:

- MOM question text is HTML-based ("The Question text section should be HTML based")
- The documentation states "all HTML tags are valid" for question text
- MOM course items support embedding videos via drag-and-drop
- The underlying IMathAS sanitizer (`sanitize.php`) uses the `htmLawed` library, which can be configured to allow iframes
- YouTube video embedding in text items is documented as working

**However**: The sanitizer denies `on*` event handlers and `data*` attributes. Whether `<iframe>` specifically passes through the filter is not explicitly documented. This needs empirical testing by:
1. Creating a test question with `<iframe src="https://datascienceuwl.github.io/STAT145/statlens/...">` in the question text
2. Verifying it renders for students

### 4.2 Per-Student URL Construction

The challenge: you want MOM to generate random data AND pass it to StatLens via URL parameters. Here is what IS possible:

**String concatenation works** in MOM (the `.` operator):

```php
loadlibrary("stats")
$data = normrand(100, 15, 25, 1)
$datastr = implode(",", $data)
$url = "https://datascienceuwl.github.io/STAT145/statlens/bootstrap.html?data=" . $datastr
```

Then in question text:
```html
<a href="$url" target="_blank">Open StatLens with your data</a>
```

**What is NOT possible**:
- Passing MOM's internal seed to StatLens (seed is not exposed to authors)
- Having StatLens generate the same data independently (no shared seed)
- Guaranteeing URL length stays under limits for large datasets

### 4.3 The csvdownloadlink() Function

This is a particularly useful function for statistics problems. It creates a downloadable CSV file link from arrays defined in the question:

```php
loadlibrary("stats")
$heights = normrand(68, 3.5, 30, 1)
$weights = normrand(165, 25, 30, 0)
$download = csvdownloadlink("sample_data", "Height", $heights, "Weight", $weights)
```

In question text: `$download` renders as a clickable "Download CSV" link.

Each student gets different data (from MOM's randomization) and can download their personal dataset. This is powerful for:
- "Download your dataset, import it into R/Posit Cloud, and compute..."
- "Download your dataset and paste it into StatLens"

### 4.4 Recommended Integration Pattern

```
[MOM Question]
  1. Generates random dataset via normrand() etc.
  2. Displays dataset in question text (showarrays or table)
  3. Provides csvdownloadlink() for download
  4. Embeds StatLens iframe OR provides link with data in URL params
  5. Asks student to read off result from StatLens and enter it back in MOM
  6. MOM checks answer with tolerance (computed from known data)
```

**Challenge**: MOM cannot pre-compute the bootstrap CI to check against, because it cannot run the bootstrap itself. Two workarounds:

- **Wide tolerance**: Accept any answer within a reasonable range of the theoretical CI
- **Theoretical answer**: Ask for the theoretical (CLT-based) answer as the "correct" answer, while StatLens shows the empirical version for comparison
- **Multiple choice**: "Which of these intervals is closest to your bootstrap result?"

---

## 5. UW System Canvas LTI Setup

### 5.1 Approval Status

**MyOpenMath is approved for UW System Canvas** (all campuses except UW-Madison).

- Approval documented at: https://kb.wisconsin.edu/dle/101040
- Last updated: April 18, 2025
- Both **WeBWorK and MyOpenMath** are approved

### 5.2 LTI Versions

MOM supports both:
- **LTI 1.1**: Course-level or college-wide configuration
- **LTI 1.3**: College-wide configuration only; certified compliant; TrustEd Apps certification

For LTI 1.3 (recommended), the campus admin uses dynamic registration:
```
Dynamic Registration URL: https://www.myopenmath.com/lti/dynreg.php
```

**Important warning**: If instructors currently use LTI 1.1 course-level connections, installing LTI 1.3 college-wide may override them and cause problems. Installation should occur between academic terms.

### 5.3 Grade Passback

**Yes, grade passback works.** MOM supports grade passback to Canvas through LTI. Specific Canvas configuration depends on whether LTI 1.1 or 1.3 is used.

### 5.4 Setup Process for an Instructor

1. Request an instructor account at myopenmath.com (approval takes a few days)
2. Create a course (or copy from a template)
3. Add assessments and content
4. If LTI is configured campus-wide: add MOM links in Canvas modules
5. Students click through from Canvas; SSO handles authentication
6. Grades pass back to Canvas gradebook

### 5.5 Support Model

- **Community-based support only**: Forums, training videos, documentation
- **No vendor support** for instructors or students
- Sales/institutional inquiries: sales@myopenmath.com
- The platform is free; optional paid SLAs available for institutions

### 5.6 Known Limitations

- DLE approval does not bypass campus procurement processes
- No roster sync (students self-enroll or are imported via CSV)
- Analytics are limited to gradebook viewing -- no learning analytics highlighting problem areas
- "New Quizzes" style features not available (MOM has its own assessment engine)

---

## 6. Comparison with WeBWorK for THIS Specific Use Case

### 6.1 The Key Question: With StatLens, What Does WeBWorK+R Still Provide?

If StatLens handles all bootstrap/permutation simulations externally, WeBWorK's R integration advantage narrows significantly:

| Capability | MOM + StatLens | WeBWorK + R | Winner |
|------------|-------------|-------------|--------|
| Standard computation (CI, hypothesis test) | Yes (~15 lines) | Yes (~50 lines) | MOM |
| Distribution functions (t, chi-sq, F) | Built-in | Built-in | Tie |
| Random dataset per student | normrand() etc. | rnorm() etc. | Tie |
| Histogram/boxplot in problem | SVG (basic quality) | ggplot2 (publication quality) | WeBWorK |
| Bootstrap/permutation simulation | Via StatLens link | Server-side with plot | WeBWorK |
| Per-student bootstrap plot IN problem | No (link out to StatLens) | Yes (inline R plot) | WeBWorK |
| Check bootstrap CI answer | Wide tolerance only | Exact (R computes it) | WeBWorK |
| Course template for stats | OIS template exists | Poor | MOM |
| Authoring effort per problem | Low | Medium-High | MOM |
| Infrastructure required | None (hosted free) | Server + Rserve | MOM |
| UW Canvas approved | Yes | Yes | Tie |
| Existing problems at UWL | None for STAT 145 | Yes (Reineke, Bennie, etc.) | WeBWorK |
| Student cost | Free | Free | Tie |
| Learning analytics | Basic gradebook | Per-problem attempt data | WeBWorK |

### 6.2 WeBWorK's Remaining Advantages

Even with StatLens handling simulations, WeBWorK+R still wins for:

1. **Inline bootstrap distribution plots**: Each student sees a dynamically generated histogram of their bootstrap distribution *within the problem*, not in a separate tab
2. **Exact answer checking for SBI problems**: R can compute the actual bootstrap CI from the student's data and check the answer precisely
3. **Existing problem sets at UWL**: Reineke, Bennie, Peirce, and Pingree already have STAT 145 WeBWorK problems -- you could start from their work
4. **Complex multi-step problems**: WeBWorK's `MultiAnswer` checker can validate intermediate steps

### 6.3 MOM's Advantages

1. **Zero infrastructure**: No server to maintain, no Rserve to install, no IT requests
2. **Simpler authoring**: 3-4x less code per problem
3. **Better course management**: Built-in content pages, forums, file sharing
4. **Course templates**: OIS template provides a starting structure
5. **Lower learning curve**: No Perl, no R, no PG syntax -- just MOM's macro language
6. **csvdownloadlink()**: Elegant per-student dataset delivery

### 6.4 Can WeBWorK Problems Be Migrated to MOM?

**No automated migration path exists.** WeBWorK uses Perl/.pg files; MOM uses its own IMathAS macro language. Each problem would need manual rewriting. However:

- Standard computation problems (CI, hypothesis test, descriptive stats) are straightforward to rewrite -- the math is the same, just different syntax
- R-dependent problems (bootstrap plots, simulation) cannot be migrated -- MOM lacks the execution environment
- One source claims "zero cost migration from any publisher platform, WeBWorK, or MyOpenMath is available in hours" via Edfinity, but this likely refers to Edfinity specifically, not direct MOM import

### 6.5 Instructor Learning Curve

| Aspect | MyOpenMath | WeBWorK |
|--------|-----------|---------|
| Account setup | 5 minutes + approval wait | Need server access from IT |
| First problem authored | 1-2 hours | 4-8 hours |
| Comfortable authoring | 1-2 weeks | 2-4 weeks |
| Languages to learn | MOM macros only | Perl + PG + PGML (+ R for SBI) |
| Documentation quality | Adequate, community-maintained | Better, MAA-supported wiki |
| Debugging | In-browser preview | Command-line or web preview |
| Community size | Smaller, math-focused | Larger, MAA-backed |

### 6.6 Recommended Hybrid Approach

Given your specific situation:

**Use MOM for**: Standard computation homework (descriptive stats, probability, normal/t/chi-sq/F problems, CI construction, hypothesis testing, regression) -- ~70% of homework assignments

**Use WeBWorK+R for**: Bootstrap CI, permutation test, and sampling distribution problems where you want inline plots and exact answer checking -- ~20% of homework

**Use StatLens standalone**: In-class activities and guided explorations where auto-grading is not the primary goal -- ~10% of activities

This avoids:
- Writing 50-line WeBWorK problems for simple CI calculations
- Settling for wide-tolerance StatLens-linked problems when exact checking is better
- Maintaining all infrastructure yourself

---

## 7. UW-Oshkosh Math 109 Course

### 7.1 What We Know

- UW-Oshkosh uses MyOpenMath for **Math 109: Elementary Statistics**
- The earlier investigation identified this as master course cid=190038
- UW-Oshkosh also runs WeBWorK at `webwork.math.uwosh.edu` for other math courses

### 7.2 What We Could Not Determine

- The course content is **not publicly accessible** (requires enrollment key)
- No public documentation of what textbook it aligns with
- No information on whether it includes SBI content
- No indication of whether the instructor would share access

### 7.3 How to Access It

To copy from another instructor's MOM course, you need their **Course ID** and **Enrollment Key**. Steps:

1. Contact the Math 109 instructor at UW-Oshkosh (check department website for who teaches it)
2. Ask if they would share their enrollment key for you to copy their course
3. In MOM: Admin Page > Add New Course > Copy Course Items > enter their cid and key
4. MOM will copy the structure, assessments, and question associations (but not student data)

Given that UW-Oshkosh and UW-La Crosse are sister institutions in the same system, this is a reasonable professional request.

---

## 8. Actionable Recommendations

### Immediate Actions (This Week)

1. **Create a MOM instructor account** at myopenmath.com if you do not have one already
2. **Copy the OIS template** (cid=10899, key="key") to examine its structure and problems
3. **Test iframe embedding**: Create a test question with `<iframe src="https://datascienceuwl.github.io/STAT145/test/">` to verify HTML rendering
4. **Test csvdownloadlink()**: Create a test question generating random data with a download link

### Short-Term Actions (This Month)

5. **Contact UW-Oshkosh**: Email the Math 109 instructor requesting access to their MOM course
6. **Ask WeBWorK admin about Rserve**: Determine if the hybrid approach is feasible
7. **Get colleague WeBWorK exports**: Ask Reineke or Bennie for their STAT 145 .def files
8. **Consider applying as IMS volunteer**: The OpenIntro volunteer position would give you community support and visibility

### Medium-Term Actions (Before Fall)

9. **Build MOM course**: Create assessments for IMS chapters, starting with standard computation problems
10. **Write StatLens integration problems**: Test the pattern of MOM-generates-data + link-to-StatLens + student-enters-result
11. **Write WeBWorK+R problems** for the 5-8 key SBI homework assignments (if Rserve is available)

---

## 9. Key Sources

- OpenIntro MyOpenMath page: https://www.openintro.org/teachers/myopenmath/
- OpenIntro volunteer opportunities: https://openintro.org/teachers/get_involved/
- OpenIntro community forum on MOM: https://www.openintro.org/forums/thread/?topic=65
- IMathAS stats library source: https://github.com/drlippman/IMathAS/blob/master/assessment/libs/stats.html
- MOM help (question writing): https://www.myopenmath.com/help.php?section=writingquestions
- MOM help (course management): https://www.myopenmath.com/help.php?section=coursemanagement
- MOM LTI integration: https://www.myopenmath.com/info/lti.php
- UW System Canvas approval: https://kb.wisconsin.edu/dle/101040
- IMathAS language reference: http://www.imathas.com/imathas/docs/languageref.html
- IMathAS GitHub repository: https://github.com/drlippman/IMathAS
- MOM more examples: https://www.myopenmath.com/docs/morequestions.html
- Virginia Tech OER homework comparison: https://guides.lib.vt.edu/oer/homework
- OpenIntro Statistics problems discussion: https://groups.google.com/g/statistics-teachers/c/7BtELctlRKE
