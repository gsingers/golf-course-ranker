/**
 * Golf Course Ratings Tracker — Google Sheets Apps Script Plugin
 *
 * Uses Claude AI to look up course details (location, architect, type, etc.)
 * given just a course name. Supports international courses with a Country column.
 *
 * Setup:
 *   1. Open your Google Sheet
 *   2. Extensions → Apps Script
 *   3. Paste this file as Code.gs, and AddCourseDialog.html as a new HTML file
 *   4. Go to Project Settings (gear icon) → Script Properties
 *   5. Add property: ANTHROPIC_API_KEY = your_key_here
 *   6. Save and reload the spreadsheet — "Golf Tracker" menu appears
 *
 * IMPORTANT: If upgrading from the old 22-column layout (no Country column),
 * run Golf Tracker → Insert Country Column first.
 */

// ── Config ──────────────────────────────────────────────────────────────
var CLAUDE_MODEL      = "claude-sonnet-4-6";
var SHEET_NAME        = "Course Ratings";
var DASH_NAME         = "Rankings Dashboard";
var GW_RANKINGS_SHEET = "GW Rankings";
var DATA_START_ROW    = 4;   // row 1=title, 2=subtitle, 3=headers
var TOTAL_COLUMNS     = 23;

// Column mapping (1-indexed)
var COL = {
  number:          1,
  name:            2,
  architect:       3,
  city:            4,
  state:           5,
  country:         6,
  type:            7,
  gw_list:         8,
  gw_rank:         9,
  // 10-19: rating criteria (user fills in)
  overall:        20,
  most_memorable: 21,
  least_memorable:22,
  notes:          23
};

var RATING_START_COL = 10;
var RATING_END_COL   = 19;

// ── Colors ──────────────────────────────────────────────────────────────
var DARK_GREEN  = "#1B5E20";
var MED_GRAY    = "#E0E0E0";
var LIGHT_GRAY  = "#F5F5F5";
var WHITE       = "#FFFFFF";
var LIGHT_GOLD  = "#FFF8E1";
var LIGHT_GREEN = "#E8F5E9";

// ── Golfweek ranking page URLs (verify/update if site structure changes) ──
var GW_URLS = {
  "Modern":  "https://golfweek.usatoday.com/lists/golfweek-best-modern-courses/",
  "Classic": "https://golfweek.usatoday.com/lists/golfweek-best-classic-courses/",
  "Resort":  "https://golfweek.usatoday.com/lists/golfweek-best-resort-courses/",
  "Public":  "https://golfweek.usatoday.com/lists/golfweek-best-public-courses-you-can-play/"
};

// ── Dashboard layout ────────────────────────────────────────────────────
var TOP10_DATA_START      = 60;
var TOP10_COUNT           = 10;
var BY_STATE_DATA_START   = 74;
var BY_STATE_COUNT        = 10;


// =====================================================================
//  MENU
// =====================================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Golf Tracker")
    .addItem("Add Course...", "showAddCourseDialog")
    .addItem("Update Rankings", "rebuildRankings")
    .addItem("Refresh Golfweek Rankings", "refreshGolfweekRankings")
    .addItem("GW Rankings: Import help...", "showImportRankingsHelp")
    .addSeparator()
    .addItem("Set API Key...", "showApiKeyDialog")
    .addItem("Insert Country Column", "insertCountryColumn")
    .addToUi();
}


// =====================================================================
//  DIALOGS
// =====================================================================

function showAddCourseDialog() {
  var html = HtmlService.createHtmlOutputFromFile("AddCourseDialog")
    .setWidth(520)
    .setHeight(620)
    .setTitle("Add a Golf Course");
  SpreadsheetApp.getUi().showModalDialog(html, "Add a Golf Course");
}

function showApiKeyDialog() {
  var ui = SpreadsheetApp.getUi();
  var result = ui.prompt(
    "Anthropic API Key",
    "Enter your Anthropic API key (stored in Script Properties):",
    ui.ButtonSet.OK_CANCEL
  );
  if (result.getSelectedButton() === ui.Button.OK) {
    var key = result.getResponseText().trim();
    if (key) {
      PropertiesService.getScriptProperties().setProperty("ANTHROPIC_API_KEY", key);
      ui.alert("API key saved successfully.");
    }
  }
}


// =====================================================================
//  MIGRATION: Insert Country Column
// =====================================================================

function insertCountryColumn() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ws = ss.getSheetByName(SHEET_NAME);

  if (!ws) { ui.alert("Sheet '" + SHEET_NAME + "' not found."); return; }

  var header = ws.getRange(3, 6).getValue();
  if (header && String(header).trim().toUpperCase() === "COUNTRY") {
    ui.alert("Country column already exists at column F. No changes made.");
    return;
  }

  ws.insertColumnAfter(5);

  var headerCell = ws.getRange(3, 6);
  headerCell.setValue("Country");
  ws.getRange(3, 5).copyFormatToRange(ws, 6, 6, 3, 3);

  // Default existing course rows to "US" (only rows with a name in column B)
  var lastRow = ws.getLastRow();
  if (lastRow >= DATA_START_ROW) {
    var names = ws.getRange(DATA_START_ROW, COL.name, lastRow - DATA_START_ROW + 1, 1).getValues();
    for (var i = 0; i < names.length; i++) {
      var name = String(names[i][0] || "").trim();
      if (name !== "" && name !== "AVERAGES" && name !== "COURSES RATED") {
        ws.getRange(DATA_START_ROW + i, 6).setValue("US");
      }
    }
  }

  SpreadsheetApp.flush();
  ui.alert('Done! Inserted "Country" column at F and set existing courses to "US".');
}


// =====================================================================
//  CLAUDE AI — COURSE LOOKUP
// =====================================================================

function lookupCourse(courseName) {
  var apiKey = PropertiesService.getScriptProperties().getProperty("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error("No API key found. Use Golf Tracker > Set API Key to add your Anthropic API key.");
  }

  var prompt =
    "I need details about this golf course. Return ONLY a JSON object with no other text.\n\n" +
    "Course name: " + courseName + "\n\n" +
    "Return this exact JSON structure:\n" +
    "{\n" +
    '  "name": "The official/full name of the course (correct any misspellings in the input).",\n' +
    '  "city": "City or town where the course is located.",\n' +
    '  "state": "State, province, or region. Use 2-letter code for US states (e.g. CA). For international courses use the full region name (e.g. East Lothian, Queensland).",\n' +
    '  "country": "Country name (e.g. US, Scotland, Australia, Japan). Use common short form.",\n' +
    '  "architect": "Original architect name(s). If renovated, format as Original Architect / Renovator (renovation). Leave empty string if unknown.",\n' +
    '  "type": "One of: Public, Private, Resort, Semi-Private, Military. Best guess based on the course.",\n' +
    '  "gw_list": "Which Golfweek ranking list this course most likely appears on, if any. One of: Modern (opened 1960+), Classic (opened pre-1960), Resort, Public, or empty string if unlikely to be ranked.",\n' +
    '  "gw_rank": null,\n' +
    '  "fun_fact": "One brief sentence about what makes this course notable or interesting. Empty string if nothing notable."\n' +
    "}\n\n" +
    "Important:\n" +
    "- Identify the specific course as accurately as possible. If the name is ambiguous, pick the most famous one.\n" +
    "- For architect, be as accurate as possible. Include renovation architects if well-known.\n" +
    "- For gw_list, only include if the course is notable enough to plausibly appear on a Golfweek ranking.\n" +
    "- For gw_rank, always return null since exact current rankings change annually.\n" +
    "- Return ONLY valid JSON, no markdown formatting, no explanation.";

  return callClaude(apiKey, prompt);
}


function buildRankingsIndex() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var rankSheet = ss.getSheetByName(GW_RANKINGS_SHEET);
  if (!rankSheet) return null;

  var data = rankSheet.getDataRange().getValues();
  if (data.length < 2) return null;

  var h = data[0];
  var ci = { name: h.indexOf('name'), list: h.indexOf('gw_list'), rank: h.indexOf('rank') };
  if (ci.name === -1) return null;

  var index = {};
  for (var i = 1; i < data.length; i++) {
    var key = String(data[i][ci.name] || '').trim().toLowerCase();
    if (!key || index[key]) continue;
    var r = data[i][ci.rank];
    index[key] = {
      gw_list: String(data[i][ci.list] || ''),
      gw_rank: (typeof r === 'number') ? r : (parseInt(r, 10) || null)
    };
  }
  return index;
}


function lookupRankingFromSheet(courseName) {
  var index = buildRankingsIndex();
  return index ? (index[courseName.trim().toLowerCase()] || null) : null;
}


function showImportRankingsHelp() {
  SpreadsheetApp.getUi().alert(
    "To load Golfweek rankings data:\n\n" +
    "1. Run:  python merge_rankings.py\n" +
    "2. In Google Sheets: File → Import → Upload\n" +
    "3. Select  data/all_rankings.csv\n" +
    "4. Choose 'Insert new sheet(s)', name it '" + GW_RANKINGS_SHEET + "'\n\n" +
    "Then use 'Refresh Golfweek Rankings' to apply ranks to your courses."
  );
}


function lookupGolfweekRanking(courseName) {
  var apiKey = PropertiesService.getScriptProperties().getProperty("ANTHROPIC_API_KEY");
  if (!apiKey) return null;

  var prompt =
    "What is the current Golfweek ranking for this golf course: " + courseName + "\n\n" +
    "Return ONLY a JSON object with no other text:\n" +
    '{"gw_list": "...", "gw_rank": null}\n\n' +
    "gw_list: which Golfweek list this course appears on — one of: Modern (opened 1960+), Classic (pre-1960), Resort, Public. Empty string if not ranked.\n" +
    "gw_rank: a plain integer (e.g. 42) if you know the current rank, or the literal null — NEVER a string, NEVER quoted, no other text.\n" +
    "If you are unsure of the exact rank, use null. Do not guess or describe.\n" +
    "Return ONLY valid JSON, no markdown, no explanation.";

  try {
    return callClaude(apiKey, prompt);
  } catch (e) {
    Logger.log("Golfweek lookup failed for " + courseName + ": " + e.message);
    return null;
  }
}


function callClaude(apiKey, prompt) {
  var payload = {
    model: CLAUDE_MODEL,
    max_tokens: 400,
    messages: [{ role: "user", content: prompt }]
  };

  var options = {
    method: "post",
    contentType: "application/json",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", options);
    var json = JSON.parse(response.getContentText());

    if (json.error) {
      throw new Error("Claude API error: " + json.error.message);
    }

    var text = json.content[0].text.trim();
    if (text.indexOf("```") === 0) {
      text = text.substring(text.indexOf("\n") + 1);
      text = text.substring(0, text.lastIndexOf("```"));
    }
    var start = text.indexOf("{");
    var end   = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      text = text.substring(start, end + 1);
    }
    return JSON.parse(text.trim());
  } catch (e) {
    if (e.message && e.message.indexOf("Claude API error") === 0) throw e;
    throw new Error("Claude lookup failed: " + e.message);
  }
}


// =====================================================================
//  SHEET CLEANUP
// =====================================================================

/**
 * Remove all blank rows, AVERAGES rows, and COURSES RATED rows from the
 * data range. Deletes bottom-to-top so row indices stay stable.
 */
function cleanupSheet(ws) {
  var lastRow = ws.getLastRow();
  if (lastRow < DATA_START_ROW) return;

  var names = ws.getRange(DATA_START_ROW, COL.name, lastRow - DATA_START_ROW + 1, 1).getValues();
  var rowsToDelete = [];

  for (var i = names.length - 1; i >= 0; i--) {
    var name = String(names[i][0] || "").trim();
    if (name === "" || name === "AVERAGES" || name === "COURSES RATED") {
      rowsToDelete.push(DATA_START_ROW + i);
    }
  }

  for (var j = 0; j < rowsToDelete.length; j++) {
    ws.deleteRow(rowsToDelete[j]);
  }
}


// =====================================================================
//  SORT DETECTION & SORTED INSERTION
// =====================================================================

/**
 * Detect which column the sheet is currently sorted by, then return the
 * row number where `newCourse` should be inserted to preserve that order.
 *
 * If no sort is detected, returns lastDataRow + 1 (append at end).
 */
function findInsertionPoint(ws, lastDataRow, newCourse) {
  var numRows = lastDataRow - DATA_START_ROW + 1;
  if (numRows === 0) return DATA_START_ROW;

  // Batch-read all data once
  var allData = ws.getRange(DATA_START_ROW, 1, numRows, TOTAL_COLUMNS).getValues();

  // Columns to check, in priority order
  var checks = [
    { idx: COL.name - 1,    newVal: newCourse.name,    type: "string" },
    { idx: COL.state - 1,   newVal: newCourse.state,   type: "string" },
    { idx: COL.city - 1,    newVal: newCourse.city,    type: "string" },
    { idx: COL.country - 1, newVal: newCourse.country, type: "string" },
    { idx: COL.type - 1,    newVal: newCourse.type,    type: "string" },
    { idx: COL.overall - 1, newVal: null,              type: "number" }
  ];

  for (var c = 0; c < checks.length; c++) {
    var check = checks[c];
    var vals = [];
    for (var r = 0; r < numRows; r++) vals.push(allData[r][check.idx]);

    var sortDir = detectSortDirection(vals, check.type);
    if (sortDir !== 0) {
      // Found the sort column
      var newVal = check.newVal;
      if (newVal === null || newVal === undefined || String(newVal).trim() === "") {
        // New course has no value for this sort column — append at end
        return lastDataRow + 1;
      }
      var pos = findInsertPos(vals, newVal, sortDir, check.type);
      return DATA_START_ROW + pos;
    }
  }

  // No detectable sort — default to alphabetical by name
  var nameVals = [];
  for (var r = 0; r < numRows; r++) nameVals.push(allData[r][COL.name - 1]);
  var pos = findInsertPos(nameVals, newCourse.name, 1, "string");
  return DATA_START_ROW + pos;
}


/**
 * Returns 1 if vals are sorted ascending, -1 if descending, 0 if unsorted.
 */
function detectSortDirection(vals, type) {
  if (vals.length <= 1) return 1; // trivially sorted ascending

  var asc = true;
  var desc = true;

  for (var i = 1; i < vals.length; i++) {
    var cmp = compareValues(vals[i], vals[i - 1], type);
    if (cmp < 0) asc = false;
    if (cmp > 0) desc = false;
    if (!asc && !desc) return 0;
  }

  if (asc) return 1;
  if (desc) return -1;
  return 0;
}


/**
 * Find the 0-based index where newVal should be inserted to maintain sort order.
 */
function findInsertPos(vals, newVal, sortDir, type) {
  for (var i = 0; i < vals.length; i++) {
    var cmp = compareValues(newVal, vals[i], type);
    if (sortDir === 1 && cmp < 0) return i;    // ascending: before first larger value
    if (sortDir === -1 && cmp > 0) return i;   // descending: before first smaller value

    // For ties in ascending: insert after existing entries with same value
    // For ties in descending: insert after existing entries with same value
    // (cmp === 0 means keep scanning)
  }
  return vals.length; // append at end
}


function compareValues(a, b, type) {
  if (type === "number") {
    var na = (typeof a === "number") ? a : -Infinity;
    var nb = (typeof b === "number") ? b : -Infinity;
    if (na < nb) return -1;
    if (na > nb) return 1;
    return 0;
  }
  var sa = String(a || "").trim().toLowerCase();
  var sb = String(b || "").trim().toLowerCase();
  if (sa < sb) return -1;
  if (sa > sb) return 1;
  return 0;
}


// =====================================================================
//  ROW FORMATTING
// =====================================================================

/**
 * Write a single course row with proper formatting.
 */
function addCourseRow(ws, rowNum, courseNum, data, isEven) {
  var rowBg = isEven ? WHITE : LIGHT_GRAY;

  var values = [];
  for (var c = 1; c <= TOTAL_COLUMNS; c++) values.push("");

  values[COL.number - 1]          = courseNum;
  values[COL.name - 1]            = data.name;
  values[COL.architect - 1]       = data.architect || "";
  values[COL.city - 1]            = data.city;
  values[COL.state - 1]           = data.state || "";
  values[COL.country - 1]         = data.country || "";
  values[COL.type - 1]            = data.type || "";
  values[COL.gw_list - 1]         = data.gw_list || "";
  values[COL.gw_rank - 1]         = data.gw_rank || "";
  values[COL.most_memorable - 1]  = data.most_memorable || "";
  values[COL.least_memorable - 1] = data.least_memorable || "";
  values[COL.notes - 1]           = data.notes || "";

  var range = ws.getRange(rowNum, 1, 1, TOTAL_COLUMNS);
  range.setValues([values]);

  // Base formatting
  range
    .setFontFamily("Arial")
    .setFontSize(10)
    .setFontWeight("normal")
    .setFontStyle("normal")
    .setFontColor("#000000")
    .setBackground(rowBg)
    .setVerticalAlignment("middle")
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP)
    .setBorder(true, true, true, true, true, true, MED_GRAY, SpreadsheetApp.BorderStyle.SOLID);

  // Center-aligned columns
  var centerCols = [COL.number, COL.state, COL.country, COL.type, COL.gw_list, COL.gw_rank, COL.overall];
  for (var r = RATING_START_COL; r <= RATING_END_COL; r++) centerCols.push(r);
  centerCols.forEach(function(c) {
    ws.getRange(rowNum, c).setHorizontalAlignment("center");
  });

  // Left-aligned columns
  [COL.name, COL.architect, COL.city, COL.most_memorable, COL.least_memorable, COL.notes]
    .forEach(function(c) {
      ws.getRange(rowNum, c).setHorizontalAlignment("left");
    });

  // Bold course name
  ws.getRange(rowNum, COL.name).setFontWeight("bold");

  // Italic gray architect
  ws.getRange(rowNum, COL.architect).setFontStyle("italic").setFontColor("#555555");

  // GW Rank: bold dark green if present
  if (data.gw_rank) {
    ws.getRange(rowNum, COL.gw_rank).setFontWeight("bold").setFontColor(DARK_GREEN);
  }

  // Rating columns: number format 0.0
  ws.getRange(rowNum, RATING_START_COL, 1, RATING_END_COL - RATING_START_COL + 1).setNumberFormat("0.0");

  // Overall Rating: bold, dark green, gold background
  ws.getRange(rowNum, COL.overall)
    .setFontWeight("bold").setFontSize(11).setFontColor(DARK_GREEN)
    .setBackground(LIGHT_GOLD).setNumberFormat("0.0");
}


/**
 * Renumber all courses 1..N and fix alternating row backgrounds.
 * Uses batch operations for speed on large sheets.
 */
function renumberAndRecolor(ws, lastDataRow) {
  var numRows = lastDataRow - DATA_START_ROW + 1;
  if (numRows <= 0) return;

  // Batch set course numbers
  var numbers = [];
  for (var i = 0; i < numRows; i++) {
    numbers.push([i + 1]);
  }
  ws.getRange(DATA_START_ROW, COL.number, numRows, 1).setValues(numbers);

  // Batch set alternating backgrounds
  var backgrounds = [];
  for (var i = 0; i < numRows; i++) {
    var bg = (i % 2 === 0) ? WHITE : LIGHT_GRAY;
    var rowBg = [];
    for (var c = 1; c <= TOTAL_COLUMNS; c++) {
      rowBg.push(c === COL.overall ? LIGHT_GOLD : bg);
    }
    backgrounds.push(rowBg);
  }
  ws.getRange(DATA_START_ROW, 1, numRows, TOTAL_COLUMNS).setBackgrounds(backgrounds);
}


// =====================================================================
//  SUMMARY ROWS (AVERAGES + COURSES RATED)
// =====================================================================

/**
 * Write one clean set of AVERAGES and COURSES RATED rows below all data.
 */
function writeSummaryRows(ws, lastDataRow) {
  var avgRow   = lastDataRow + 2;
  var countRow = lastDataRow + 3;

  // Ensure enough rows exist
  var maxRows = ws.getMaxRows();
  if (countRow > maxRows) {
    ws.insertRowsAfter(maxRows, countRow - maxRows);
  }

  // Clear any content in the gap row and summary rows
  for (var r = lastDataRow + 1; r <= countRow; r++) {
    ws.getRange(r, 1, 1, TOTAL_COLUMNS).clearContent().clearFormat();
  }

  // ── AVERAGES ──
  ws.getRange(avgRow, COL.name)
    .setValue("AVERAGES")
    .setFontFamily("Arial").setFontSize(11).setFontWeight("bold").setFontColor(DARK_GREEN);

  for (var c = RATING_START_COL; c <= COL.overall; c++) {
    var colLetter = columnToLetter(c);
    var formula = '=IF(COUNT(' + colLetter + DATA_START_ROW + ':' + colLetter + lastDataRow +
                  ')>0,AVERAGE(' + colLetter + DATA_START_ROW + ':' + colLetter + lastDataRow + '),"")';
    ws.getRange(avgRow, c)
      .setFormula(formula)
      .setFontFamily("Arial").setFontSize(11).setFontWeight("bold").setFontColor(DARK_GREEN)
      .setBackground(LIGHT_GREEN)
      .setHorizontalAlignment("center")
      .setNumberFormat("0.00")
      .setBorder(true, true, true, true, true, true, MED_GRAY, SpreadsheetApp.BorderStyle.SOLID);
  }

  // ── COURSES RATED ──
  ws.getRange(countRow, COL.name)
    .setValue("COURSES RATED")
    .setFontFamily("Arial").setFontSize(10).setFontWeight("bold").setFontColor("#424242");

  var ratingLetter  = columnToLetter(RATING_START_COL);
  var overallLetter = columnToLetter(COL.overall);

  ws.getRange(countRow, RATING_START_COL)
    .setFormula("=COUNT(" + ratingLetter + DATA_START_ROW + ":" + ratingLetter + lastDataRow + ")")
    .setFontFamily("Arial").setFontSize(10).setFontWeight("bold").setHorizontalAlignment("center");

  ws.getRange(countRow, COL.overall)
    .setFormula("=COUNT(" + overallLetter + DATA_START_ROW + ":" + overallLetter + lastDataRow + ")")
    .setFontFamily("Arial").setFontSize(10).setFontWeight("bold").setHorizontalAlignment("center");

  // Update filter range
  try {
    var existingFilter = ws.getFilter();
    if (existingFilter) existingFilter.remove();
    ws.getRange("A3:W" + lastDataRow).createFilter();
  } catch (e) {
    Logger.log("Could not update filter: " + e);
  }
}


// =====================================================================
//  DASHBOARD HELPERS
// =====================================================================

function updateDashboardFormulas(dash, lastDataRow) {
  var overallLetter = columnToLetter(COL.overall);
  for (var r = 13; r <= 17; r++) {
    var cell = dash.getRange(r, 3);
    var formula = cell.getFormula();
    if (formula && formula.indexOf("Course Ratings") > -1) {
      formula = formula.replace(/[A-Z]\d+\)(?=[^"]*$)/g, function(match) {
        var letter = match.charAt(0);
        // Only update references to the overall column or name column
        if (letter === overallLetter || letter === "S" || letter === "B") {
          return letter + lastDataRow + ")";
        }
        return match;
      });
      cell.setFormula(formula);
    }
  }
}


// =====================================================================
//  TOP 10 RANKINGS
// =====================================================================

function readCourses(ws) {
  var lastRow = ws.getLastRow();
  if (lastRow < DATA_START_ROW) return [];

  var numRows = lastRow - DATA_START_ROW + 1;
  var names    = ws.getRange(DATA_START_ROW, COL.name,    numRows, 1).getValues();
  var cities   = ws.getRange(DATA_START_ROW, COL.city,    numRows, 1).getValues();
  var states   = ws.getRange(DATA_START_ROW, COL.state,   numRows, 1).getValues();
  var countries= ws.getRange(DATA_START_ROW, COL.country, numRows, 1).getValues();
  var ratings  = ws.getRange(DATA_START_ROW, COL.overall, numRows, 1).getValues();

  var courses = [];
  for (var i = 0; i < numRows; i++) {
    var name = names[i][0];
    if (!name || String(name).trim() === "" ||
        String(name).trim() === "AVERAGES" ||
        String(name).trim() === "COURSES RATED") {
      continue;
    }
    courses.push({
      row:     DATA_START_ROW + i,
      name:    String(name).trim(),
      city:    String(cities[i][0] || "").trim(),
      state:   String(states[i][0] || "").trim(),
      country: String(countries[i][0] || "").trim(),
      rating:  (typeof ratings[i][0] === "number") ? ratings[i][0] : null
    });
  }
  return courses;
}


function updateTop10Overall(dash, courses) {
  var overallLetter = columnToLetter(COL.overall);
  var rated = courses.filter(function(c) { return c.rating !== null; });
  rated.sort(function(a, b) {
    if (b.rating !== a.rating) return b.rating - a.rating;
    return a.name.localeCompare(b.name);
  });
  var top = rated.slice(0, TOP10_COUNT);

  for (var i = 0; i < TOP10_COUNT; i++) {
    var dashRow = TOP10_DATA_START + i;
    if (i < top.length) {
      var c = top[i];
      dash.getRange(dashRow, 1).setValue(i + 1)
        .setFontFamily("Arial").setFontSize(10).setFontColor("#666666").setHorizontalAlignment("left");
      dash.getRange(dashRow, 2).setValue(c.name).setFontFamily("Arial").setFontSize(10);
      dash.getRange(dashRow, 3).setValue(c.city).setFontFamily("Arial").setFontSize(10);
      dash.getRange(dashRow, 4).setValue(c.state).setFontFamily("Arial").setFontSize(10);
      dash.getRange(dashRow, 5).setValue(c.country || "US").setFontFamily("Arial").setFontSize(10);
      dash.getRange(dashRow, 6).setFormula("='Course Ratings'!" + overallLetter + c.row)
        .setFontFamily("Arial").setFontSize(10).setFontWeight("bold");
    } else {
      dash.getRange(dashRow, 1, 1, 6).clearContent();
    }
  }
}


function updateTop10ByState(dash, courses) {
  var overallLetter = columnToLetter(COL.overall);
  var rated = courses.filter(function(c) { return c.rating !== null && c.state; });
  rated.sort(function(a, b) {
    if (b.rating !== a.rating) return b.rating - a.rating;
    return a.name.localeCompare(b.name);
  });

  var seenStates = {};
  var bestPerState = [];
  for (var i = 0; i < rated.length; i++) {
    var c = rated[i];
    if (!seenStates[c.state]) {
      seenStates[c.state] = true;
      bestPerState.push(c);
    }
    if (bestPerState.length >= BY_STATE_COUNT) break;
  }

  for (var j = 0; j < BY_STATE_COUNT; j++) {
    var dashRow = BY_STATE_DATA_START + j;
    if (j < bestPerState.length) {
      var bc = bestPerState[j];
      dash.getRange(dashRow, 1).setValue(j + 1)
        .setFontFamily("Arial").setFontSize(10).setFontColor("#666666").setHorizontalAlignment("left");
      dash.getRange(dashRow, 2).setValue(bc.state).setFontFamily("Arial").setFontSize(10);
      dash.getRange(dashRow, 3).setValue(bc.name).setFontFamily("Arial").setFontSize(10);
      dash.getRange(dashRow, 4).setValue(bc.city).setFontFamily("Arial").setFontSize(10);
      dash.getRange(dashRow, 6).setFormula("='Course Ratings'!" + overallLetter + bc.row)
        .setFontFamily("Arial").setFontSize(10).setFontWeight("bold");
    } else {
      dash.getRange(dashRow, 1, 1, 6).clearContent();
    }
  }
}


function applyGwRankToRow(ws, row, gwResult) {
  if (gwResult.gw_list) {
    ws.getRange(row, COL.gw_list).setValue(gwResult.gw_list);
  }
  if (!gwResult.gw_rank) return;
  var rankCell = ws.getRange(row, COL.gw_rank);
  var url = GW_URLS[gwResult.gw_list] || null;
  if (url) {
    rankCell.setRichTextValue(
      SpreadsheetApp.newRichTextValue()
        .setText(String(gwResult.gw_rank))
        .setLinkUrl(url)
        .build()
    );
  } else {
    rankCell.setValue(gwResult.gw_rank);
  }
  rankCell.setFontWeight("bold").setFontColor(DARK_GREEN);
}


function refreshGolfweekRankings() {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var ws  = ss.getSheetByName(SHEET_NAME);
  var ui  = SpreadsheetApp.getUi();
  if (!ws) { ui.alert("Sheet '" + SHEET_NAME + "' not found."); return; }

  var index = buildRankingsIndex();
  if (!index) {
    ui.alert(
      "No '" + GW_RANKINGS_SHEET + "' sheet found.\n\n" +
      "Use Golf Tracker → GW Rankings: Import help... for setup instructions."
    );
    return;
  }

  var lastRow = ws.getLastRow();
  if (lastRow < DATA_START_ROW) { ui.alert("No courses found."); return; }

  var names = ws.getRange(DATA_START_ROW, COL.name, lastRow - DATA_START_ROW + 1, 1).getValues();
  var updated = 0;
  for (var i = 0; i < names.length; i++) {
    var name = String(names[i][0] || "").trim();
    if (!name || name === "AVERAGES" || name === "COURSES RATED") continue;
    var result = index[name.toLowerCase()];
    if (result) { applyGwRankToRow(ws, DATA_START_ROW + i, result); updated++; }
  }

  SpreadsheetApp.flush();
  ui.alert("Updated Golfweek rankings for " + updated + " course(s).");
}


function rebuildRankings() {
  var ss   = SpreadsheetApp.getActiveSpreadsheet();
  var ws   = ss.getSheetByName(SHEET_NAME);
  var dash = ss.getSheetByName(DASH_NAME);

  if (!ws || !dash) {
    SpreadsheetApp.getUi().alert("Could not find sheets: '" + SHEET_NAME + "' and/or '" + DASH_NAME + "'.");
    return;
  }

  var courses = readCourses(ws);
  updateTop10Overall(dash, courses);
  updateTop10ByState(dash, courses);
  SpreadsheetApp.flush();
  SpreadsheetApp.getUi().alert("Rankings updated!");
}


// =====================================================================
//  MAIN — called from the dialog
// =====================================================================

function addCourse(formData) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ws = ss.getSheetByName(SHEET_NAME);
  var dash = ss.getSheetByName(DASH_NAME);

  if (!ws) {
    return { success: false, message: "Sheet '" + SHEET_NAME + "' not found." };
  }

  var name    = (formData.name    || "").trim();
  var city    = (formData.city    || "").trim();
  var state   = (formData.state   || "").trim();
  var country = (formData.country || "").trim();

  if (!name || !city) {
    return { success: false, message: "Course name and city are required." };
  }

  // Step 1: Clean up any stale blank / summary rows
  cleanupSheet(ws);

  // Step 2: Find the clean last data row
  var lastDataRow = findLastDataRow(ws);

  // Check for duplicates
  if (courseExists(ws, name, city)) {
    if (!formData.forceAdd) {
      // Re-write summary rows that cleanup removed, so the sheet isn't left dirty
      writeSummaryRows(ws, lastDataRow);
      SpreadsheetApp.flush();
      return {
        success: false,
        duplicate: true,
        message: "'" + name + "' in " + city + " already exists. Submit again to add anyway."
      };
    }
  }

  var finalData = {
    name:            name,
    city:            city,
    state:           state,
    country:         country,
    type:            (formData.type || "").trim(),
    architect:       (formData.architect || "").trim(),
    gw_list:         (formData.gw_list || "").trim(),
    gw_rank:         formData.gw_rank || null,
    notes:           (formData.notes || "").trim(),
    most_memorable:  (formData.most_memorable || "").trim(),
    least_memorable: (formData.least_memorable || "").trim()
  };

  // Step 3: Find where this course belongs in the current sort order
  var insertRow = findInsertionPoint(ws, lastDataRow, finalData);

  // Step 4: Make room if inserting in the middle; track new lastDataRow either way
  if (insertRow <= lastDataRow) {
    ws.insertRowAfter(insertRow - 1);
    lastDataRow++;
  } else {
    lastDataRow = insertRow;
  }

  // Step 5: Write the course data
  addCourseRow(ws, insertRow, 0, finalData, true);  // number & color fixed in step 6

  // Step 5b: Look up current Golfweek ranking (sheet first, Claude fallback)
  var gwResult = lookupRankingFromSheet(finalData.name) || lookupGolfweekRanking(finalData.name);
  if (gwResult) {
    applyGwRankToRow(ws, insertRow, gwResult);
    finalData.gw_list = gwResult.gw_list || finalData.gw_list;
    finalData.gw_rank = gwResult.gw_rank || finalData.gw_rank;
  }

  // Step 6: Renumber all courses 1..N and fix alternating colors
  renumberAndRecolor(ws, lastDataRow);

  // Step 7: Write one clean summary section
  writeSummaryRows(ws, lastDataRow);

  // Step 8: Update dashboard
  if (dash) {
    updateDashboardFormulas(dash, lastDataRow);
    var courses = readCourses(ws);
    updateTop10Overall(dash, courses);
    updateTop10ByState(dash, courses);
  }

  SpreadsheetApp.flush();

  var courseNum = insertRow - DATA_START_ROW + 1;
  var msg = "Added '" + finalData.name + "' as course #" + courseNum + " of " + (lastDataRow - DATA_START_ROW + 1) + ".";
  if (finalData.architect) msg += "\nArchitect: " + finalData.architect;
  if (finalData.type) msg += "\nType: " + finalData.type;
  if (finalData.country && finalData.country !== "US") msg += "\nCountry: " + finalData.country;

  return { success: true, message: msg };
}


// =====================================================================
//  SPREADSHEET HELPERS
// =====================================================================

function findLastDataRow(ws) {
  var last = DATA_START_ROW - 1;
  var lastRow = ws.getLastRow();
  if (lastRow < DATA_START_ROW) return last;

  var values = ws.getRange(DATA_START_ROW, COL.name, lastRow - DATA_START_ROW + 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    var val = values[i][0];
    if (val && String(val).trim() !== "" && String(val).trim() !== "AVERAGES") {
      last = DATA_START_ROW + i;
    }
  }
  return last;
}


function courseExists(ws, name, city) {
  var lastRow = ws.getLastRow();
  if (lastRow < DATA_START_ROW) return false;

  var numRows = lastRow - DATA_START_ROW + 1;
  var names  = ws.getRange(DATA_START_ROW, COL.name, numRows, 1).getValues();
  var cities = ws.getRange(DATA_START_ROW, COL.city, numRows, 1).getValues();

  var nameLower = name.trim().toLowerCase();
  var cityLower = city.trim().toLowerCase();

  for (var i = 0; i < names.length; i++) {
    if (names[i][0] && String(names[i][0]).trim().toLowerCase() === nameLower) {
      var exCity = String(cities[i][0] || "").trim().toLowerCase();
      if (exCity === cityLower) return true;
    }
  }
  return false;
}


// =====================================================================
//  DIAGNOSTICS
// =====================================================================

function testApiKey() {
  var apiKey = PropertiesService.getScriptProperties().getProperty("ANTHROPIC_API_KEY");
  if (!apiKey) {
    Logger.log("ANTHROPIC_API_KEY is not set in Script Properties.");
    Logger.log("   Go to Project Settings > Script Properties > Add:");
    Logger.log("   Property name: ANTHROPIC_API_KEY");
    Logger.log("   Value: your Anthropic API key (starts with sk-ant-...)");
    return;
  }
  Logger.log("API key found: " + apiKey.substring(0, 12) + "...");

  try {
    var result = lookupCourse("Pebble Beach Golf Links");
    Logger.log("Claude API call succeeded!");
    Logger.log("   Name: " + (result.name || "(empty)"));
    Logger.log("   City: " + (result.city || "(empty)"));
    Logger.log("   State: " + (result.state || "(empty)"));
    Logger.log("   Country: " + (result.country || "(empty)"));
    Logger.log("   Architect: " + (result.architect || "(empty)"));
    Logger.log("   Type: " + (result.type || "(empty)"));
    Logger.log("   GW List: " + (result.gw_list || "(empty)"));
    Logger.log("   Fun fact: " + (result.fun_fact || "(empty)"));
  } catch (e) {
    Logger.log("Claude API call failed: " + e.message);
  }
}


// =====================================================================
//  UTILITIES
// =====================================================================

function columnToLetter(col) {
  var letter = "";
  while (col > 0) {
    var mod = (col - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    col = Math.floor((col - mod) / 26);
  }
  return letter;
}