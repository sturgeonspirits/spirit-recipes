# Changelog

All notable changes to this project are logged here. Each code file also
carries a one-line version header at the top pointing back to this file.

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
