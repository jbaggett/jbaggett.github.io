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

## Shared — every lens page (`kit/js/url.js`)

| Parameter | Type | Meaning |
|---|---|---|
| `embed` | `true` | Strip page chrome for an iframe: no header, no home button, no lede. Never hides content, only furniture. |
| `mode` | string | Activity mode, where a lens supports one (`present` / `discover`). |
| `seed` | string | Seed for any randomness on the page, so a graded link is reproducible. |
| `f` | expression | The function under study, written as a student would type it. |
| `a`, `b` | number | The page's two principal numeric inputs — a lens says below what they mean for it. |

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
| `tangent` | `true` | off | Reveal the tangent line. **Off by default on purpose** — students should predict the limit first. |
| `controls` | list | all | Which control groups to show: `f`, `a`, `window`, `h`, `tangent`, `table`. Anything omitted is hidden, and a panel left with no visible control is hidden too. |
| `var` | letter | inferred | Only used when the expression has no variable to infer from. The expression always wins. |

**The lecture-figure form** — figure, one slider, the table, nothing else:

```
calclens/derivatives/secant/?f=-16t%5E2%2B32t%2B48&a=0.5&window=0,2
  &embed=true&controls=h,table&tangent=false
```

## CalcLens — Accumulation Function

`calclens/integrals/accumulation/`

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `f` | expression | `2x - 2` | The integrand. |
| `a` | number | `0` | Lower limit — where *A* is pinned to 0. |
| `b` | number | `a + 1.2` | Starting position of the upper limit *x*. |

## CalcLens — Derivative Builder

`calclens/derivatives/builder/`

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `f` | expression | `x^3 - 3x` | The function. |

## CalcLens — Check My Answer

`calclens/tools/check-answer/`

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `f` | expression | `x^2` | The problem. |
| `mode` | `anti` \| `deriv` | `anti` | Which kind of answer is being checked. |

## Not yet frozen

Anything not listed above is provisional and may change. If you are about to
link to a parameter that is not here, add it here first.
