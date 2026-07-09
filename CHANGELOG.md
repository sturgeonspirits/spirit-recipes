# Changelog

All notable changes to this project are logged here. Each code file also
carries a one-line version header at the top pointing back to this file.

## v1.10.2 - 2026-07-09
- **Fix: Wash ABV showed nothing (or 0) when the run had a stored wash ABV of 0.**
  The backend stores empty numeric cells as 0 in some cases; a 0 "measured"
  wash ABV was winning over the OG–FG auto-calc. `washABV` now treats ≤0 as
  "not measured" and falls back to OG–FG, the run editor blanks a stored 0, and
  the recovery calcs use the same effective wash ABV (so they too auto-calc
  from OG–FG when no measured value exists). (`js/distill.js`, `js/mash-app.js`)
- **Fix: raw datetime strings in the run editor.** Reading dates/times (and run
  and barrel dates) returned by the backend as serialized datetimes (e.g.
  `2026-07-09T05:00:00.000Z`, times as 1899-epoch strings) are now shown as
  `MM/DD/YYYY` and `hh:mm` in the editor, run cards, and compare table.
- **Readings now sort by date + time** (was date only), so same-day readings
  order correctly when deriving OG/FG. (`js/distill.js`)

## v1.10.1 - 2026-07-09
- **Fix: run editor kept stale OG/FG (and Wash ABV) on open.** Opening Edit on a
  distillation run overwrote the Original/Final gravity fields with the gravity
  log's first/last readings — so an OG or FG typed in by hand (e.g. a
  hydrometer-measured final gravity newer than the log) was silently replaced,
  and the Wash ABV auto-calc used the older figures. The editor now fills OG/FG
  from the log only when the field is blank; editing or importing readings still
  updates both, as before.
- **Wash ABV source made obvious.** The live Wash ABV stat on the run form is
  now labeled "(measured)" or "(OG–FG)" — and when a typed value overrides a
  differing OG–FG calc, the calc is shown alongside. The Wash ABV % field's
  placeholder shows the live auto value (e.g. "auto ≈ 7.6% from OG–FG").
  Front-end only (`js/mash-app.js`) — no backend change, no redeploy needed.

## v1.10.0 - 2026-07-07
- **Click-through field definitions.** Every field on the mash recipe page (and
  the Expected ABV / Attenuation / Batch stats) now has a small "?" button that
  pops a one-line definition on tap — tap again, tap away, or press Escape to
  close. Replaces the inline hints from v1.9.1 so the form stays uncluttered.
  New `js/infotips.js` (a generic `.info-btn[data-tip]` popover) + styles.
- **Additions/tweaks and gravity-reading editors rebuilt for mobile.** Both were
  cramped multi-column grids that collapsed into unreadable stacked boxes on a
  phone. They now use the same labeled component-card layout as the mash bill:
  each field has a visible label and the card reflows to two columns on narrow
  screens. Gravity readings lead with a Date/Time header, then Gravity, Temp, pH,
  and Notes. Front-end only (`mash.html`, `js/mash-app.js`, `js/infotips.js`,
  `styles.css`) — no backend change, no redeploy needed.

## v1.9.1 - 2026-07-07
- **Inline field definitions** on the mash recipe page: short helper hints under
  Strike temp, Pitch rate, and Yield unit explaining what each means. Front-end
  copy only (`mash.html`, `styles.css`) — superseded by the tooltips in v1.10.0.

## v1.9.0 - 2026-07-07
- **Access control (login required).** The app and its data are no longer open to
  anyone with the link. Every read and write now requires a valid session token.
  - Accounts live in a new `Users` tab (username, salt, password_hash,
    display_name, active). Passwords are stored only as salted SHA-256 hashes.
  - Backend (`apps-script/Code.gs`): `login` returns a session token, `logout`
    revokes it; tokens are held in Script Properties with a 14-day expiry. A new
    `AUTH_REQUIRED` flag gates `doGet`/`doPost`. Bootstrap the first account by
    running `SETUP_createUser()` from the Apps Script editor (`createUserAccount_`
    hashes the password); `SETUP_clearAllSessions()` force-signs-everyone-out.
  - Frontend: new `login.html` + `js/login-app.js` sign-in screen and `js/auth.js`
    (token storage, redirect-to-login gate, injected "Sign out" control).
    `js/api.js` now sends the token on every request and bounces to the login
    page when a session expires. `auth.js` is included on every page.
  - Demo mode (no `API_URL`) skips auth entirely, so the public demo still works.

  > Deploy: add a `Users` tab (or let it auto-create), run `SETUP_createUser()`
  > once per person from the editor, then redeploy the Web App. See README.

## v1.8.0 - 2026-07-07
- **Suggested cuts on the run form.** The Cuts section now leads with a
  best-practice guidance panel for a pot-still spirit run: foreshots to discard
  (~50 mL per gallon of wash, filled in as a concrete mL figure from the wash
  volume), heads ~20–30%, hearts ~35–45% with the hearts→tails cut around
  55–60% ABV (start checking by ~65%), and tails below ~40% ABV saved for the
  next stripping run. When wash volume and ABV are known it also shows the
  expected pure alcohol (L and proof gallons) to split across the cuts. New
  `suggestCuts` helper in `js/distill.js`; heuristics sourced from common home/
  craft distilling references (homedistiller wiki, learntomoonshine, etc.).
  Guidance only — a reminder to confirm heads by aroma and hearts by taste.

## v1.7.0 - 2026-07-07
- **Predicted ABV from OG** on the run form. As soon as an original gravity is
  entered (and before a real final gravity exists), the run editor shows a live
  "Predicted ABV ~X%" readout under the OG/FG fields, projecting from OG using
  the recipe's target FG as the fermentation assumption (falling back to
  ferment-to-dry, FG 1.000). It steps aside once an actual FG is entered, since
  the measured Wash ABV then covers it. New `potentialABV` helper in
  `js/distill.js`.
- **Compare runs table.** A new collapsible "Compare runs" section on each mash
  recipe lines up every run of that recipe in one table — date, OG → FG, wash
  ABV, pH (start→end), ferment days, hearts yield, proof gallons, recovery, and
  the tweaks used. A "Highlight a tweak" dropdown (built from the distinct
  additions across the recipe's runs) highlights the runs that used a given item
  and dims the rest — so an A/B like "SuperFerm vs. the usual yeast food" reads
  at a glance. Front-end only (`js/mash-app.js`, `mash.html`, `styles.css`); it
  reuses the run/reading/addition data already loaded.

## v1.6.0 - 2026-07-07
- **Per-run additions / tweaks list.** Each distillation run now has a structured
  list of what you changed from the base recipe that batch — nutrients, yeast,
  acid, a different sugar — so tweaks can be compared across runs instead of
  living in free-text notes. (Motivating case: testing SuperFerm as a nutrient
  and seeing which runs used it.)
  - New Sheet tab `RunAdditions` (addition_id, run_id, mash_id, item, category,
    amount, unit, timing, notes), auto-created by the backend and cascade-deleted
    with its run or mash. Seed file `data/run_additions_seed.csv`.
  - Backend (`apps-script/Code.gs`): additions nest under each run on
    `?mash=`/`?mashes=1`; new `replace_additions` action; `delete_run` and
    `delete_mash` also remove additions.
  - Run editor gains an "Additions & tweaks" table (item, category, amount, unit,
    timing, why/result). Run cards show the tweaks as compact chips.
  - API (`js/api.js`): `replaceAdditions`.

## v1.5.0 - 2026-07-07
- **pH tracking in the fermentation log.** Each gravity reading now carries an
  optional `ph` value, so pH is recorded and trended across a distillation run
  instead of being buried in note text.
  - Data/backend: new `ph` column on the `GravityReadings` tab, persisted by
    `replace_readings` (`apps-script/Code.gs`). Existing sheets pick it up once a
    `ph` header cell is added; a freshly auto-created tab includes it. Seed file
    `data/gravity_readings_seed.csv` updated, with the pH values that were living
    in reading notes (e.g. 5.0, 3.8, 6.4) migrated into the new column.
  - Run editor: each reading row gains a pH input. A reading is now kept on save
    if it has a gravity **or** a pH value, so a pH-only spot check can be logged.
  - `readingSpan` (`js/distill.js`) summarizes pH (first/last/range); run cards
    and the live chart caption show "pH start→end".

## v1.4.0 - 2026-07-06
- **Fermentation gravity-over-time log** on each distillation run. New Sheet tab
  `GravityReadings` (reading_id, run_id, mash_id, reading_date, reading_time,
  gravity, temp, notes), auto-created by the backend and cascade-deleted with
  its run or mash.
  - Backend (`apps-script/Code.gs`): readings nest under each run on
    `?mash=`/`?mashes=1`; new `replace_readings` action; `delete_run` and
    `delete_mash` now also remove readings.
  - Run editor gains an editable reading table (date/time/gravity/temp/notes).
    The first and last readings auto-fill the run's OG and FG, and an inline SVG
    curve is drawn live: gravity plus, when the log has temps, a second
    temperature line on its own scale (legend + temp range shown). Run cards show
    the same mini dual-line curve plus "OG → FG over N days · M readings".
  - Calc helpers (`js/distill.js`): `readingSpan` derives OG/FG/elapsed-days from
    a log; `sortedReadings` orders it.
- **Tilt hydrometer import** (`js/tilt.js`): pull a Tilt proof-monitoring log
  into a run's gravity log, two ways —
  - **Upload a file**: .xlsx, .xls, or .csv (both the "Data" and "Report"
    template layouts). SheetJS is lazy-loaded from cdnjs only when a workbook is
    imported.
  - **Sync from the Google Sheet**: paste the Tilt sheet's link on the run
    (stored in a new `tilt_sheet_url` column) and hit Sync. The Apps Script
    reads it server-side via `?tilt=` (so no sharing/CORS needed), honoring the
    specific file — and, if you keep multiple batches as tabs in one workbook,
    the tab from the link's `#gid=` (or a picker). Re-sync anytime to pull new
    readings as fermentation continues. Since each batch is its own sheet, each
    run just remembers its own link.
  - Readings are parsed, de-duplicated, sorted, and evenly downsampled to ~80
    points either way.
- **Seed data**: replaced the placeholder bourbon example with real production
  data digitized from the uploaded spreadsheets — three mash recipes (Molasses
  Rum Wash, Agave Spirit Wash, Rye Whiskey Mash), 18 components, 14 dated runs,
  and 35 gravity readings (`data/mash_recipes_seed.csv`,
  `data/mash_components_seed.csv`, `data/distillation_runs_seed.csv`,
  `data/gravity_readings_seed.csv`).

## v1.3.0 - 2026-07-06
- New **Distilling module** for mash/fermentation recipes and per-run
  distillation records, kept separate from the product catalog but linkable to
  it.
- Data model — three new Google Sheet tabs (auto-created by the backend on
  first write; seed CSVs included):
  - `MashRecipes` — one row per mash/ferment recipe: spirit type, optional
    `linked_recipe_id` to a product, batch/water volumes, strike temp, mash pH,
    target OG/FG, yeast strain, pitch rate, ferment temp/days, target yield,
    notes.
  - `MashComponents` — mash bill + fermentation additions (grain, sugar/adjunct,
    enzyme, nutrient, acid/pH, yeast, water, other) with amount, unit, timing,
    notes.
  - `DistillationRuns` — time-series log, one row per run: date, still,
    operator, actual OG/FG + wash ABV/volume, foreshots/heads/hearts/tails
    volumes + ABV, cut temps, run duration, and barrel/aging (barrel ID, fill
    date, entry proof, char level).
- Backend (`apps-script/Code.gs`): new GET params `?mash=` / `?mashes=1` and
  actions `add_mash`, `update_mash_field`, `replace_mash_components`,
  `delete_mash`, `add_run`, `update_run`, `delete_run`. All changes are logged
  to `changelog` like the product recipes.
- Calculations (`js/distill.js`): ABV from OG–FG, apparent attenuation, US
  proof gallons and liters of absolute alcohol (LAA), and hearts/total alcohol
  recovery — computed live on both the mash page and the run editor. Any value
  can still be overridden by typing it in.
- Frontend: `distilling.html` (searchable mash-recipe list with run counts) and
  `mash.html` (detail page with editable mash bill, fermentation/target fields,
  linked-product picker, and the run log with an add/edit run modal). Reached
  via a "Distilling →" link in the product catalog header.

## v1.2.0 - 2026-07-06
- Recipe detail page (`recipe.html`, `styles.css`, `js/recipe-app.js`): added
  "Make" mode — a full-screen, read-only production view for using a recipe at
  the bench. Opened via the "▶ Make" button in the header; closed with "Done"
  or Escape.
  - Large, high-contrast ingredient list; tap any ingredient to check it off,
    with a live "N / M added" progress counter and a Reset button.
  - Batch scaler (½× / 1× / 2× / 3× presets plus a custom multiplier) scales
    every ingredient amount and the batch size live; ABV is unaffected by
    uniform scaling.
  - Prominent ABV + batch-this-run readout and the recipe notes (shown only
    when present).
  - Screen wake lock keeps the display awake while make mode is open (where
    supported).
  - Read-only: no data is written from make mode.

## v1.1.0 - 2026-07-05
- Added `last_production_date` and `volume_produced` columns to the Recipes
  data model (`data/recipes_seed.csv`, `data/sheets/recipes_seed*.csv`,
  `data/seed.json`).
- Recipe detail page (`recipe.html`, `js/recipe-app.js`): new "Production"
  section with "Date of Last Production" and "Volume Produced" fields;
  volume field shows a live unit hint from the batch unit; both fields save
  through the existing generic `update_recipe_field` API.
- Recipe list (`js/app.js`): cards show "Last produced <date> · <volume>
  <unit>" when set.
- Exports (`js/export.js`): Word export and both CSV exports (single recipe
  + full catalog) include the new fields.
- README: documented that an already-deployed Google Sheet needs the two new
  columns added to the Recipes tab header (or re-import the updated seed
  CSV), since `Code.gs` resolves columns by name.

## v1.0.0 - (pre-existing, baseline)
- Mobile-first UI redesign.
- Ingredient name display bug fix; added canned cocktail recipes.
- Initial commit.
