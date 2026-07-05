# Changelog

All notable changes to this project are logged here. Each code file also
carries a one-line version header at the top pointing back to this file.

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
