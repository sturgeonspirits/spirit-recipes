// v1.4.0 (2026-07-06): parse Tilt hydrometer exports (the standard Tilt Google
// Sheets template — .xlsx or .csv) into gravity-log readings. SheetJS is loaded
// lazily from cdnjs only when an .xlsx is imported. Full history: CHANGELOG.md
window.TILT = (function () {
  const SHEETJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
  let sheetJSPromise = null;

  function loadSheetJS() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (sheetJSPromise) return sheetJSPromise;
    sheetJSPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SHEETJS_URL;
      s.onload = () => resolve(window.XLSX);
      s.onerror = () => reject(new Error("Could not load the spreadsheet reader. Check your connection, or export the Tilt log as CSV and try again."));
      document.head.appendChild(s);
    });
    return sheetJSPromise;
  }

  function num(v) {
    if (v === "" || v === null || v === undefined) return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
  }

  // Excel serial date -> JS Date (days since 1899-12-30).
  function excelSerialToDate(serial) {
    const ms = Math.round((serial - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  function toDate(v) {
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    if (typeof v === "number") return excelSerialToDate(v);
    if (typeof v === "string") {
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  }
  function pad(n) { return String(n).padStart(2, "0"); }
  function fmtDate(d) { return pad(d.getMonth() + 1) + "/" + pad(d.getDate()) + "/" + d.getFullYear(); }
  function fmtTime(d) { return pad(d.getHours()) + ":" + pad(d.getMinutes()); }

  // Given a matrix of rows (array of arrays), locate the Tilt reading table and
  // return [{date: Date, sg, temp, comment}]. Handles both the "Data" layout
  // (Timestamp/SG/Temp near col A) and the "Report" layout (table starting a few
  // columns in). We scan for a header row containing an "SG" cell.
  function extractRows(matrix) {
    let headerRow = -1, sgCol = -1, tempCol = -1, timeCol = -1;
    for (let i = 0; i < Math.min(matrix.length, 15); i++) {
      const row = matrix[i] || [];
      for (let c = 0; c < row.length; c++) {
        if (String(row[c]).trim().toLowerCase() === "sg") {
          // candidate header row — find sibling columns
          const lc = row.map(x => String(x).trim().toLowerCase());
          const tImestamp = lc.indexOf("timestamp");
          const tPoint = lc.indexOf("timepoint");
          const tmp = lc.findIndex(x => x.startsWith("temp"));
          if ((tImestamp !== -1 || tPoint !== -1)) {
            headerRow = i; sgCol = c;
            tempCol = tmp;
            timeCol = tImestamp !== -1 ? tImestamp : tPoint;
            break;
          }
        }
      }
      if (headerRow !== -1) break;
    }
    if (headerRow === -1) return [];

    const out = [];
    for (let i = headerRow + 1; i < matrix.length; i++) {
      const row = matrix[i] || [];
      const sg = num(row[sgCol]);
      if (sg === null) continue;
      const d = toDate(row[timeCol]);
      if (!d) continue;
      out.push({ date: d, sg, temp: tempCol !== -1 ? num(row[tempCol]) : null });
    }
    return out;
  }

  // Prefer the "Data" sheet, then "Report", then any sheet that yields rows.
  function pickBest(sheetsByName) {
    const order = Object.keys(sheetsByName).sort((a, b) => {
      const rank = n => n.toLowerCase() === "data" ? 0 : n.toLowerCase() === "report" ? 1 : 2;
      return rank(a) - rank(b);
    });
    for (const name of order) {
      const rows = extractRows(sheetsByName[name]);
      if (rows.length) return rows;
    }
    return [];
  }

  // Sort ascending, drop exact-duplicate timestamps, and downsample evenly to at
  // most `cap` points (always keeping the first and last reading).
  function tidy(rows, cap) {
    cap = cap || 80;
    rows = rows.slice().sort((a, b) => a.date - b.date);
    const seen = new Set();
    rows = rows.filter(r => { const k = +r.date; if (seen.has(k)) return false; seen.add(k); return true; });
    if (rows.length <= cap) return rows;
    const step = (rows.length - 1) / (cap - 1);
    const out = [];
    for (let i = 0; i < cap; i++) out.push(rows[Math.round(i * step)]);
    // ensure last point is the true last
    out[out.length - 1] = rows[rows.length - 1];
    return out;
  }

  function toReadings(rows) {
    return rows.map(r => ({
      reading_date: fmtDate(r.date),
      reading_time: fmtTime(r.date),
      gravity: Math.round(r.sg * 10000) / 10000,
      temp: r.temp == null ? "" : Math.round(r.temp * 10) / 10,
      notes: ""
    }));
  }

  // ---- Public entry points ----
  async function parseFile(file, cap) {
    const name = (file.name || "").toLowerCase();
    if (name.endsWith(".csv") || file.type === "text/csv") {
      const text = await file.text();
      return parseCSVText(text, cap);
    }
    const XLSX = await loadSheetJS();
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const sheetsByName = {};
    wb.SheetNames.forEach(n => {
      sheetsByName[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: "" });
    });
    return toReadings(tidy(pickBest(sheetsByName), cap));
  }

  function parseCSVText(text, cap) {
    const matrix = csvToMatrix(text);
    return toReadings(tidy(extractRows(matrix), cap));
  }

  // Parse a raw 2D array (e.g. rows returned by the Apps Script ?tilt= endpoint,
  // which reads the Tilt Google Sheet server-side).
  function parseMatrix(matrix, cap) {
    return toReadings(tidy(extractRows(matrix || []), cap));
  }

  // Best-effort Google Sheets id from a pasted URL (or a bare id).
  function sheetIdFromUrl(input) {
    const s = String(input || "").trim();
    const m = s.match(/\/spreadsheets\/d\/(?:e\/)?([a-zA-Z0-9-_]+)/);
    if (m) return m[1];
    if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) return s;
    return null;
  }

  // Minimal CSV parser (handles quoted fields + embedded commas/newlines).
  function csvToMatrix(text) {
    const rows = [];
    let row = [], field = "", inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQ = false;
        } else field += ch;
      } else {
        if (ch === '"') inQ = true;
        else if (ch === ",") { row.push(field); field = ""; }
        else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
        else if (ch === "\r") { /* skip */ }
        else field += ch;
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  return { parseFile, parseCSVText, parseMatrix, sheetIdFromUrl, extractRows, tidy, toReadings, csvToMatrix };
})();
