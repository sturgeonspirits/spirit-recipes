# Sturgeon Spirits — Recipe Book & TTB Tracker

**v1.9.0 (2026-07-07)** — see [CHANGELOG.md](CHANGELOG.md) for revision history.

A small static webapp for editing recipes, live-calculating ABV, scaling batches,
and tracking TTB formula/label approvals. Google Sheets is the database; Netlify
hosts the site; GitHub stores the code and triggers deploys.

Seed data included: 232 products merged from your notebook, `list of spirits.xlsx`,
`Formulas Online.csv`, and the TTB COLAs export — 67 have full ingredient
breakdowns, 51 have a TTB formula number, 41 have a label/COLA number.

## 1. Set up the Google Sheet (the database)

1. Create a new Google Sheet.
2. Create three tabs named exactly: `Recipes`, `Ingredients`, `ChangeLog`.
3. Import `data/recipes_seed.csv` into the **Recipes** tab (File > Import > Upload,
   "Replace current sheet", select the `Recipes` tab first).
4. Import `data/ingredients_seed.csv` into the **Ingredients** tab the same way.
5. Leave `ChangeLog` empty — the app creates its header row automatically the
   first time something is edited.

## 2. Deploy the Apps Script API

1. In the Sheet, go to **Extensions > Apps Script**.
2. Delete the placeholder code and paste in `apps-script/Code.gs`.
3. Click **Deploy > New deployment**.
4. Type: **Web app**. Execute as: **Me**. Who has access: **Anyone with the link**.
5. Click Deploy, authorize the permissions Google asks for, and copy the `.../exec` URL it gives you.
6. Open `js/config.js` in this project and paste that URL into `API_URL`.

Any time you edit `Code.gs` later, you need to create a **new version** under
**Deploy > Manage deployments > Edit > New version** for changes to go live.

## 3. Push to GitHub

```bash
cd webapp
git init
git add .
git commit -m "Recipe book webapp"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

(Create the empty repo on github.com first if you haven't — no README/license, so it stays empty for this push.)

## 4. Connect Netlify

1. Log into netlify.com > **Add new site > Import an existing project**.
2. Choose GitHub, authorize, and pick this repo.
3. Build settings: leave the build command blank and publish directory as `.`
   (already set in `netlify.toml`).
4. Deploy. Netlify gives you a URL immediately, and redeploys automatically on
   every push to `main`.

## 5. Accounts & access (login)

As of v1.9.0 the app requires a login, and the Apps Script backend rejects any
read or write without a valid session — so the `/exec` URL alone no longer
exposes your data. (Keep the deployment's access as **Anyone with the link**:
that only lets the *login request* reach the script; the token check does the
gatekeeping.)

**Create the first account** (the web app can't — logging in needs an account to
exist):

1. In **Extensions > Apps Script**, open `Code.gs`.
2. Edit `SETUP_createUser()` near the bottom — set the username, a strong
   password, and a display name.
3. In the editor's function dropdown pick **SETUP_createUser**, click **Run**, and
   authorize if prompted. This adds the user to a `Users` tab (storing only a
   salted SHA-256 hash — never the password itself).
4. Clear the password you typed out of the function and **Save**.
5. Redeploy the Web App (**Deploy > Manage deployments > Edit > New version**).

**Add more people:** change the values in `createUserAccount_(...)` and run again.
Re-running with an existing username **resets** that person's password.
**Remove someone:** set their `active` cell to `no` in the `Users` tab (and run
`SETUP_clearAllSessions()` to force everyone to sign in again).

Notes and limits of this "basic" scheme: it's a shared-nothing token model good
for a small trusted team. Sessions last 14 days. There's no self-serve password
reset or 2FA — password changes go through `SETUP_createUser()`. Because Netlify
serves the site over HTTPS, credentials and tokens are encrypted in transit.

## Using the app

- **Sign in** (`login.html`): everyone lands here first; enter your username and
  password. "Keep me signed in" persists the session on that device.
- **Recipe list** (`index.html`): search, filter by category or TTB status,
  export the whole catalog to CSV.
- **Recipe detail** (`recipe.html?id=...`): edit ingredients inline, ABV
  recalculates live. Two scaling tools:
  - **Scale batch size** — multiplies every ingredient proportionally to hit a
    new total volume.
  - **Solve for target ABV** — keeps total batch volume fixed, solves for the
    alcohol amount needed, and adjusts the ingredient named "Water" to
    compensate (same math used to bring the RTD recipes to exactly 5.0%).
  - **Save** writes ingredients + fields back to the Sheet and appends a row to
    `ChangeLog` (timestamp, field, old value, new value) so nothing gets
    silently overwritten.
  - **Export PDF / Word / CSV** for any single recipe.

## Adding the production columns to an existing Sheet

If you deployed the Sheet before `last_production_date` and `volume_produced`
were added, add two columns to the end of the **Recipes** tab's header row
with those exact names (or re-import `data/recipes_seed.csv`, which now
includes them). `update_recipe_field` looks up columns by name, so saving
will fail with "unknown field" until the header row has them.

## Distilling module (v1.3.0)

A separate section for **mash/fermentation recipes** and **distillation run
records**, reached from the "Distilling →" link in the product catalog header.

Enabling it requires two one-time steps against your existing Sheet + backend:

1. **Update the Apps Script.** Paste the current `apps-script/Code.gs` over the
   old one, then **Deploy > Manage deployments > Edit > New version**. The
   backend creates the three tabs below automatically the first time a mash or
   run is saved, so you don't have to add them by hand — but you can pre-create
   them by importing the seed CSVs if you'd like the example data:
   - `MashRecipes` ← `data/mash_recipes_seed.csv`
   - `MashComponents` ← `data/mash_components_seed.csv`
   - `DistillationRuns` ← `data/distillation_runs_seed.csv`
   - `GravityReadings` ← `data/gravity_readings_seed.csv`
   - `RunAdditions` ← `data/run_additions_seed.csv`
2. **Redeploy the site** (git push, Netlify auto-builds) so the new pages and
   scripts (`distilling.html`, `mash.html`, `js/distill.js`,
   `js/distilling-app.js`, `js/mash-app.js`, `js/tilt.js`) go live.

The seed CSVs contain real digitized data for three washes (Molasses Rum, Agave
Spirit, Rye Whiskey) with their dated runs and fermentation gravity logs — import
them to preload that history, or start empty and add your own.

What it tracks:

- **Mash recipe**: spirit type, an optional link to a product recipe, batch and
  mash-water volumes, strike temp, mash pH, target OG/FG, yeast strain, pitch
  rate, fermentation temp/days, target yield, and notes.
- **Mash bill & additions**: each grain, sugar, enzyme, nutrient, acid, or yeast
  addition with amount, unit, and when it's added (mash vs fermentation).
- **Distillation runs** (one per run, over time): date, still, operator, this
  batch's actual OG/FG and wash ABV/volume, the foreshots/heads/hearts/tails
  volumes + ABV, cut temperatures, run duration, and where the hearts went
  (barrel ID, fill date, entry proof, char level) plus notes.

Auto-calculated (all overridable): estimated ABV from OG–FG, apparent
attenuation, US **proof gallons** and **liters of absolute alcohol** per run —
the units TTB production reports and excise tax use — and the alcohol
**recovery** from wash to hearts.

**Fermentation gravity log & Tilt import.** Each run has a gravity-over-time log
(date, time, specific gravity, temp, pH, notes). Record a pH alongside any
reading to track it across the ferment — run cards and the live chart show the
pH start→end. The first and last readings auto-fill that run's OG and FG, and the
app draws the fermentation curve. You can
log readings by hand or import a Tilt hydrometer log two ways:

- **Upload Tilt file** — a Tilt export as `.xlsx`, `.xls`, or `.csv` (either the
  "Data" or "Report" sheet layout). SheetJS loads on demand from cdnjs the first
  time you import a workbook.
- **Sync from Google Sheet** — paste the Tilt sheet's normal share/edit link into
  the run and hit **Sync**. The Apps Script backend reads it server-side (runs as
  you, so no sharing or CORS needed) and pulls the readings. The link is saved
  with the run (`tilt_sheet_url`), so you can re-sync later as the Tilt keeps
  logging. Each batch is its own sheet, so each run remembers its own link; if
  you instead keep one workbook with a tab per batch, copy the link while viewing
  that batch's tab (it carries `#gid=…`) and Sync will use that tab.

Either way the SG/temp series is de-duplicated, sorted, and downsampled to ~80
points before the curve is redrawn.

> Adding to an already-deployed sheet: the DistillationRuns tab gains a
> `tilt_sheet_url` column — add it to the header row (or re-import
> `data/distillation_runs_seed.csv`). Column lookups are by name, so Sync's save
> will report "unknown field" until it's present. Likewise, add a `ph` column to
> the `GravityReadings` tab (after `temp`) so per-reading pH values persist.

**Per-run additions / tweaks.** Each run has an "Additions & tweaks" list for
what you changed from the base recipe that batch — nutrients, yeast, acid, a
different sugar (item, category, amount, unit, timing, and a why/result note).
It's stored per run in the `RunAdditions` tab, so you can compare batches — e.g.
which runs used SuperFerm as the nutrient and how they fermented — instead of
digging through free-text notes. Run cards show the tweaks as chips.

> Adding to an already-deployed sheet: the backend auto-creates the
> `RunAdditions` tab the first time a run's additions are saved (or add it from
> `data/run_additions_seed.csv`).

**Compare runs.** A "Compare runs" section on each recipe puts all of its runs in
one table — date, OG → FG, wash ABV, pH, ferment days, hearts yield, proof
gallons, recovery, and the tweaks used. Pick a tweak from the "Highlight a tweak"
dropdown to spotlight the runs that used it (and dim the rest), so ingredient
A/Bs like SuperFerm vs. the usual nutrient are easy to read across batches. It's
purely front-end — no extra sheet or backend call.

## Data notes

- ABV assumptions: where the real catalog didn't have a number, unflavored
  vodka/gin defaults to 40%, GNS to 93% — both editable per recipe.
- A few catalog rows show `abt 20` for ABV (Aperol, Campari, Blue Curaçao,
  Irish Cream, Triple Sec, Melon) — that's transcribed as-is from your
  spreadsheet; replace with an exact number when you have one.
- 165 catalog products don't have ingredient detail yet (they were in your
  tracking sheet but not in the notebook pages digitized so far) — they show
  up in the list with TTB info but an empty ingredient table, ready for you to
  fill in.
