# Bespoke "What is a Randomization Test?" walkthrough — fallback

This directory currently serves a **0-second redirect** (`index.html`) to the JSON
gated activity running on the real two-proportion tool:
`simulate/randomization-diff-props/?activity=randomization-test-gated.json`.

Kept here as a **fallback** are the original *bespoke* walkthrough files, recovered
from commit `ea48837^` (just before the 2026-06-19 "migrate to gated activity"
commit):

- `bespoke-index.html` — the standalone, decluttered walkthrough page (449 lines)
- `app.js` — its custom step/card-animation engine (875 lines)
- `guide.html` — the instructor guide (never removed)

Verified **working as-is** on 2026-07-15 (loads clean, no console errors) — the
decluttered card walkthrough with progressive steps and gated questions, none of
the full tool's hypothesis/controls chrome.

## Why it's here

We're trying **Option B** first — teaching the activity system a "minimal chrome"
mode so the JSON activity on the real tool can hide the clutter. This bespoke page
is **Option A**, the fallback if B doesn't pan out.

## To reactivate the bespoke page (revert to Option A)

1. Replace the redirect with the bespoke page:
   `mv bespoke-index.html index.html` (overwrites the redirect stub).
2. Repoint inbound links from the JSON activity back to this page
   (`conceptual/randomization-test/`):
   - the landing page card in `index.html` (search for `randomization-test-gated.json`)
   - any activity/tool links pointing at the gated activity
3. Remove `conceptual/randomization-test/` from the redirect-stub skip list in
   `tests/integration/no-orphan-pages.spec.js` (it becomes a real reachable page again).
4. Re-test and redeploy.
