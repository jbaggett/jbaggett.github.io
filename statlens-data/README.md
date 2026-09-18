# Contributed datasets — the store

Datasets instructors sent in, hosted here so they don't have to host anything
themselves. Listed on the [Extra Datasets page](https://learnlens.org/statlens/data/extra/)
and served at `https://learnlens.org/statlens-data/<id>.json`.

**This directory is deliberately not in the StatLens repo.** It is other
people's data: a fork of StatLens should get the tool, not a colleague's class
data, and anything committed to that repo is in its public history for good —
the wrong property for material a contributor may later ask to withdraw.
Being a sibling of `statlens/` rather than inside it also means `deploy.sh`,
which wipes and rewrites that directory on every deploy, cannot delete these.

They are **deliberately absent from the tools' dataset menus.** Those menus already
run 11–36 options deep per tool and are curated for the course; growing them with
every submission is how a menu stops being read. Contributed datasets are reached
by `?dataset=<id>`, which works in any tool the data fits.

## Adding one (a minute, if they sent JSON)

Instructors are asked to send the **JSON** from the [Dataset Builder](../builder/),
not a spreadsheet — the JSON carries their own study and variable descriptions,
which is the half nobody else can write. The builder shows them a "Ready to
send?" checklist so they know what's still empty.

1. **Check the metadata.** Open the JSON and read `studyDescription` and
   `variableDescriptions`. If they're missing or thin, ask the sender — don't
   invent them. Facts only, per the dataset convention in CLAUDE.md: "this is an
   observational study", not "so we cannot draw causal conclusions".
2. **Add `"contributor"`** — the name to credit on the page
   (`"contributor": "Todd Will"`). Optional, but it's why people send things in.
3. **Check the `id`,** then **save the file here with a matching filename**
   (`will_commute.json` for `id: "will_commute"`) — the id is what `?dataset=`
   addresses, and it's permanent once you've handed out a link.

If they sent a spreadsheet instead (the documented fallback), run it through the
Dataset Builder yourself — drop in the CSV, or paste its link — and fill in what
they told you in the email.

## Then

4. **Run the indexer** (from the StatLens repo) and commit this repo:

   ```bash
   cd ~/statlens && node scripts/build-contributed-index.mjs   # rewrites index.json here
   cd ~/jbaggett.github.io && git add statlens-data && git commit -m "Add <id>" && git push
   ```

   No StatLens deploy is needed: this store is a sibling of the deployed
   `statlens/` directory, not part of it. `bash deploy.sh` never touches it —
   which is also why it survives every deploy.

5. **Send the sender their link.** Any tool the data fits, e.g.
   `https://learnlens.org/statlens/explore/grouped/?dataset=will_commute`.
   Tell them the tool's **Share** button turns it into a QR code. The Extra
   Datasets page has copy-ready links for every compatible tool.

## Notes

- `scripts/build-contributed-index.mjs` is safe to re-run: it rewrites
  `index.json` here from whatever `.json` files are in this directory. It
  refuses an id that collides with a built-in StatLens dataset (a `?dataset=`
  link resolves built-ins first, so the contributed file would silently never
  load) and skips any file whose id doesn't match its filename.

- **Removing a dataset** is deleting its file and re-running the indexer. The
  link dies immediately. Git history here still holds it, so if a contributor
  needs it truly gone, the file has to be purged from this repo's history too.
- It records `numericCount` / `catCount`, which the built-in index doesn't
  carry — that's how the Extra Datasets page knows whether to offer a
  regression link.
- **Nothing student-identifiable goes in here.** These files are public the
  moment they deploy. A dataset the class collected about itself needs the
  identifying columns stripped first.
- To retire one: delete the JSON, re-run `build-extra.js`, deploy. Any link
  handed out for it stops loading, so tell whoever was using it.
