// Export helpers: PDF (browser print), Word (.doc via HTML blob -- opens fine in
// Word/Google Docs without needing a docx library), and CSV.
// v1.1.0 (2026-07-05): include last_production_date + volume_produced in Word/CSV exports. Full history: CHANGELOG.md
window.EXPORT = (function () {

  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function printPDF() {
    window.print(); // print.css hides nav/buttons; user chooses "Save as PDF" in the print dialog
  }

  function recipeToHTML(recipe, abv) {
    const rows = (recipe.ingredients || []).map(i =>
      `<tr><td>${escapeHTML(i.name)}</td><td>${i.amount ?? ""} ${escapeHTML(i.unit || "")}</td><td>${i.is_alcohol ? (i.abv_percent + "%") : ""}</td></tr>`
    ).join("");
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{font-family:Georgia,serif;} h1{color:#3B5B45;} table{border-collapse:collapse;width:100%;}
      td,th{border:1px solid #ccc;padding:6px 10px;text-align:left;font-family:Arial,sans-serif;font-size:13px;}
      th{background:#3B5B45;color:#fff;}
      .meta{font-family:Arial,sans-serif;font-size:12px;color:#555;margin-bottom:14px;}
      </style></head><body>
      <h1>${escapeHTML(recipe.name)}</h1>
      <div class="meta">Category: ${escapeHTML(recipe.category || "")} &nbsp;|&nbsp;
      Batch size: ${recipe.batch_size || ""} ${escapeHTML(recipe.batch_unit || "")} &nbsp;|&nbsp;
      ABV: ${abv !== null && abv !== undefined ? abv.toFixed(2) + "%" : "n/a"}</div>
      <table><thead><tr><th>Ingredient</th><th>Amount</th><th>ABV</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <p class="meta">TTB Formula #: ${escapeHTML(recipe.ttb_formula_number || "")} &nbsp;
      Label/COLA #: ${escapeHTML(recipe.ttb_label_cola_id || "")} &nbsp;
      Notes: ${escapeHTML(recipe.notes || "")}</p>
      <p class="meta">Last produced: ${escapeHTML(recipe.last_production_date || "n/a")} &nbsp;
      Volume produced: ${recipe.volume_produced ? escapeHTML(String(recipe.volume_produced)) + " " + escapeHTML(recipe.batch_unit || "") : "n/a"}</p>
      </body></html>`;
  }

  function escapeHTML(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function exportWord(recipe, abv) {
    const html = recipeToHTML(recipe, abv);
    download(sanitizeFilename(recipe.name) + ".doc", html, "application/msword");
  }

  function exportRecipeCSV(recipe) {
    const rows = [["ingredient_name", "amount", "unit", "is_alcohol", "abv_percent"]];
    (recipe.ingredients || []).forEach(i => rows.push([i.name, i.amount, i.unit, i.is_alcohol ? "yes" : "no", i.abv_percent || ""]));
    download(sanitizeFilename(recipe.name) + ".csv", toCSV(rows), "text/csv");
  }

  function exportAllCSV(recipes) {
    const rows = [["recipe_id","name","category","batch_size","batch_unit","abv_percent",
      "ttb_formula_number","ttb_formula_status","ttb_label_cola_id","ttb_label_status","ttb_label_date",
      "last_production_date","volume_produced","notes"]];
    recipes.forEach(r => rows.push([r.recipe_id, r.name, r.category, r.batch_size, r.batch_unit,
      r.abv_percent, r.ttb_formula_number, r.ttb_formula_status, r.ttb_label_cola_id, r.ttb_label_status, r.ttb_label_date,
      r.last_production_date, r.volume_produced, r.notes]));
    download("recipe_book_export.csv", toCSV(rows), "text/csv");
  }

  function toCSV(rows) {
    return rows.map(r => r.map(c => {
      const s = String(c ?? "");
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(",")).join("\n");
  }

  function sanitizeFilename(s) {
    return String(s || "recipe").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
  }

  return { printPDF, exportWord, exportRecipeCSV, exportAllCSV };
})();
