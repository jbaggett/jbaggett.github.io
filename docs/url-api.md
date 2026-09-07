# LearnLens URL API

**Every parameter listed here is frozen.** Once a name ships in a lecture slide,
a textbook page, or a homework link, it can never be renamed or removed — only
added to. Slides and coursepacks outlive refactors.

Add a parameter's entry here **in the same commit** that adds the parameter.

Values are URL-encoded as usual. Note that `+` means a space in a query string,
so a plus sign inside a function must be written `%2B`:

```
?f=-16t%5E2%2B32t%2B48        →  f = -16t^2+32t+48
```

## Names are shared with StatLens

CalcLens and StatLens sit side by side on the same site and are read by the same
people, so **a parameter that means the same thing must be spelled the same
way.** StatLens's `docs/url-api.md` is the older and larger vocabulary; check it
before naming anything new here. Alignments already made:

| concept | shared name | notes |
|---|---|---|
| withhold the computed answer | **`readout=false`** | StatLens hides the CI/p-value so it is read off the histogram; CalcLens hides the tangent, the true *f*′, the named limit. Same idea. `reveal=` and the per-tool `tangent=` still work. |
| decimal places | **`decimals`** | was `dp` here |
| hide controls by name | **`hide=`** | StatLens's blacklist, now honoured alongside our `controls=` keep-list |
| compact iframe mode | **`embed=true`** | already identical |
| deterministic seed | **`seed`** | already identical |

And one name we must NOT reuse: **`p`** is StatLens's null-hypothesis
proportion, a float. Named presets here are `preset=` for that reason.

`controls=` (a keep-list) has no StatLens equivalent and stays, because a
lecture figure wants to name the two things it needs rather than the nine it
does not. `hide=` does the inverse for consistency.

## Shared — every lens page (`kit/js/url.js`)

| Parameter | Type | Meaning |
|---|---|---|
| `embed` | `true` | Strip page chrome for an iframe: no header, no home button, no lede. Never hides content, only furniture. |
| `mode` | string | Activity mode, where a lens supports one (`present` / `discover`). |
| `seed` | string | Seed for any randomness on the page, so a graded link is reproducible. |
| `f` | expression | The function under study, written as a student would type it. |
| `a`, `b` | number | The page's two principal numeric inputs — a lens says below what they mean for it. |
| `preset` | key | Expands a named starting state into the parameters it stands for. See below. |
| `readout` | `true` / `false` | Show or withhold the tool's computed answer. Per-tool default; see each tool. `reveal=` is an accepted alias. |
| `prose` | `lean` / `none` | How much the page explains itself. See below. |

### `reveal` — withholding the answer

This course does not lecture: its slides carry "your turn" far more often than
"my turn", and the shape is prompt → silence → answer. So a tool's highest-value
use is being **the reveal at the end of the silence**, after students have
committed to an answer on paper. Every tool that has a payoff can therefore
withhold it.

`reveal=false` starts it hidden. `reveal=true` starts it shown. **The default is
per tool**, because whether to start hidden is a judgement about that tool, not
a rule the kit can impose — the secant tool's tangent is the answer to the
question the tool asks, so it starts hidden; the accumulation curve is the whole
picture, so it starts shown and a lecture link hides it.

While the payoff is hidden the tool shows the *question* in its place, rather
than a blank: the squeeze verdict says "both bounds are heading for the same
place — **what number?**" instead of naming it.

**It is always revealable without a page reload.** There is a prominent button —
it turns orange while the answer is withheld, because it is what the instructor
reaches for in front of the class — and the **`R` key** toggles it from
anywhere on the page (except while typing in a field). Reloading mid-discussion
would lose the state the discussion is about.

### `preset` — named presets, for QR codes

A fully spelled-out lecture link runs to ~126 characters, and percent-encoding
makes it worse than it reads. `?p=<key>` names the same state in a fraction of
the length, which matters when the link is a QR code scanned from the back of a
room. Measured, at error-correction level H (what a centre mark needs):

| | chars | modules |
|---|---:|---:|
| `…/secant/?f=-16t%5E2%2B32t%2B48&a=0.5&window=0,2` | 91 | 53 × 53 |
| `…/secant/?preset=ball` | 62 | **41 × 41** |

About 1.7× less area for the same module size. Two rules:

- **Presets carry content only** — the function, the point, the window — never
  presentation. A slide adds `&embed=true&controls=…` itself, so one preset
  serves both the projected figure and the phone a student opens.
- **An explicit parameter always wins**, and a parameter whose value still
  matches the preset is dropped from the address bar rather than written back —
  otherwise the first render would re-expand `?preset=ball` and undo the saving.

Preset keys are defined per tool and listed with it below. Ask for a new key
rather than inventing one; like every other name here, they are frozen once used.

### `prose` — how much the page explains itself

A third axis, orthogonal to the other two. `embed` strips **site chrome**;
`readout` withholds the **answer**; `prose` removes the page's **self-explanation**.
They are genuinely different decisions — a page embedded in a student handout
wants the first without the third.

| | `full` (default) | `lean` | `none` |
|---|---|---|---|
| intro paragraph | yes | — | — |
| explanatory hints | yes | — | — |
| legend | yes | yes | — |
| live readout row | yes | yes | — |
| **controls, figure, table, and the question being asked** | yes | yes | **yes** |

At `none` the page also widens past the reading column and the figure is sized
by **height**, so the table stays on screen beside it — on a projector the table
is the evidence the class is being asked to read, so it wins the tie against a
slightly larger graph.

A student alone at 11pm needs every word; the same page narrated to a room wants
none of them. Nothing that carries the lesson is ever removed at any level.

### Sharing

Every tool page has a **share button** (the QR glyph beside Help). It shows the
current URL — carrying everything on screen — and a QR code for it with the
CalcLens mark in the centre, downloadable as SVG for a slide or a handout. The
QR library is vendored, not fetched, so it works in a room with no network.

### Reading what you typed

Every expression field shows a **live preview** of what the parser actually read,
typeset. This catches the class of mistake no error message can: nothing is
*wrong* with `x^2sin1/x`, it simply parses as x²·sin(1)/x, which is not what the
writer meant. The preview is deliberately **not** a live region — it changes on
every keystroke — but each field points at it with `aria-describedby`, so a
screen reader reads it on focus and KaTeX's MathML makes it speakable.

A small **symbol palette** sits under the main field on tools with one. It is a
shortcut for forms whose ASCII spelling is not guessable, not a replacement for
learning the syntax: MyOpenMath, WeBWorK and Desmos all take the same ASCII, so
the typing transfers and hiding it behind buttons would work against the
homework.

An embedded page also posts its height to the framing window
(`{type: 'learnlens:height', height, url}`) so a deck can size the iframe. See
`kit/js/embed.js` for the parent-side listener.

## CalcLens — Secant to Tangent

`calclens/derivatives/secant/`

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `f` | expression | `x^2` | The function. **Write it in whatever letter the problem uses** — `-16t^2+32t+48` works, and the page then labels everything `t`. |
| `a` | number | `1` | Where the fixed point *P* sits. |
| `h` | number | `1` | Starting gap to *Q*. The slider is logarithmic and never reaches 0. |
| `side` | `left` | right | Which side *Q* approaches from. |
| `window` | `lo,hi` | `-1,3` | Horizontal window. |
| `y` | `lo,hi` | auto | Vertical window. Give this when the automatic frame is not the one you drew. |
| `tangent` | `true`/`false` | off | Frozen older spelling of `reveal` for this tool. Still honoured; prefer `reveal`. |
| `readout` | `true`/`false` | **off** | The tangent line. Off by default: it is the answer to the question the tool asks. |
| `controls` | list | all | Which control groups to show: `f`, `a`, `window`, `h`, `tangent`, `table`. Anything omitted is hidden, and a panel left with no visible control is hidden too. |
| `var` | letter | inferred | Only used when the expression has no variable to infer from. The expression always wins. |

Both points are **draggable on the graph** and reachable by keyboard: each is a
`role="slider"` handle with a 44px hit area, so Tab reaches it and the arrow keys
move it. *P* is drawn as a dark dot inside a ring (anchored); *Q* is coloured
with a halo and a grab cursor (movable) — shape, colour and cursor, since any
one of the three alone excludes somebody. Dragging *Q* through *P* flips `side`
automatically. When *Q* is very close to *P* their hit areas overlap and *Q*
wins; move *P* with its number field or by keyboard in that case.

**The lecture-figure form** — figure, one slider, the table, nothing else:

```
calclens/derivatives/secant/?f=-16t%5E2%2B32t%2B48&a=0.5&window=0,2
  &embed=true&controls=h,table&tangent=false
```

## CalcLens — Function Evaluator

`calclens/tools/evaluate/`

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `f` | expression | `(x^2 - 1)/(x - 1)` | The function. Any letter is the variable; the table labels itself from the expression. |
| `x` | values spec | `~1` | **One parameter, four modes** — see below. |
| `decimals` | 0–10 | `4` | Decimal places in the *output* column. The input column always shows the values as chosen. |

The `x` parameter carries every input mode, which keeps links short enough to
encode well:

| form | meaning | example |
|---|---|---|
| `2` | one value | `?x=2` |
| `0.9,0.99,1.01` | a list | `?x=10,100,1000` |
| `from:to:step` | an even grid | `?x=0:2:0.25` |
| `~a` | **close in on `a` from both sides** | `?x=~1` |

`~a` produces `a−0.1, a−0.01, a−0.001, a, a+0.001, a+0.01, a+0.1` — the shape a
limit table wants, which an even grid never gives. The row at `a` itself is kept
and marked, and reads **undefined** when the function has no value there. That
row is not noise: for `(x²−1)/(x−1)` at `x = 1` it is the entire point.

Presets: `?preset=limit`, `ball`, `endbehaviour`.

## CalcLens — Squeeze Theorem

`calclens/limits/squeeze/`

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `g` | expression | `x^2 sin(1/x)` | The squeezed function. Never evaluated at `a`. |
| `lower` | expression | `-x^2` | The lower bound *f*. |
| `upper` | expression | `x^2` | The upper bound *h*. |
| `a` | number | `0` | The point being approached. |
| `delta` | number | `1` | Starting window half-width. The slider is logarithmic. |
| `readout` | `true`/`false` | **on** | The named limit in the verdict. `reveal=false` swaps it for "what number?". |
| `rescale` | `true` | off | Rescale the vertical axis while zooming. **Off by default**: with it off the trap visibly closes, which is the point; with it on, *g* keeps oscillating just as violently all the way down. Both pictures are true and students should see both. |
| `controls` | list | all | `f`, `a`, `delta`, `rescale`, `table`. |
| `preset` | key | — | `classic`, `linear`, `nosqueeze`. |

Bounds the reader types are **checked**: if *g* leaves the band anywhere in the
window, the page says so and refuses to pretend the theorem applies. If the two
bounds do not agree in the limit, the verdict is "no conclusion" rather than a
made-up limit — that is what the `sin(1/x)` preset demonstrates.

**Lecture-figure form:**

```
calclens/limits/squeeze/?g=x%5E2+sin(1%2Fx)&lower=-x%5E2&upper=x%5E2&a=0
  &embed=true&controls=delta,table
```

## CalcLens — Accumulation Function

`calclens/integrals/accumulation/`

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `f` | expression | `2x - 2` | The integrand. |
| `a` | number | `0` | Lower limit — where *A* is pinned to 0. |
| `b` | number | `a + 1.2` | Starting position of the upper limit *x*. |
| `readout` | `true`/`false` | **on** | The *A*(*x*) curve. `reveal=false` keeps the axes and the marker so the shape can be predicted first. |

## CalcLens — Derivative Builder

`calclens/derivatives/builder/`

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `f` | expression | `x^3 - 3x` | The function. |
| `readout` | `true`/`false` | **off** | The true *f*′ curve *and* its formula. Off by default — the tool is "trace it yourself", and printing the formula would give the answer away in words. |

## CalcLens — Check My Answer

`calclens/tools/check-answer/`

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `f` | expression | `x^2` | The problem. |
| `mode` | `anti` \| `deriv` | `anti` | Which kind of answer is being checked. |

## Not yet frozen

Anything not listed above is provisional and may change. If you are about to
link to a parameter that is not here, add it here first.
