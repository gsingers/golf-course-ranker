# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

A personal golf course rating tracker built as a Google Sheets Apps Script plugin (`code.gs` + `AddCourseDialog.html`). Uses Claude AI for automatic metadata lookup (architect, course type, Golfweek ranking).

## Google Apps Script Plugin

### Installation

1. Open the Google Sheet → **Extensions → Apps Script**
2. Replace `Code.gs` with contents of `code.gs`
3. Add an HTML file named `AddCourseDialog` (no extension) with contents of `AddCourseDialog.html`
4. **Project Settings → Script Properties** → add `ANTHROPIC_API_KEY` = your key
5. Save and reload the sheet — a "Golf Tracker" menu appears

### Testing the API Connection

In the Apps Script editor, run `testApiKey()` directly, or use **Golf Tracker → Set API Key…** to test credentials.

## Architecture

### Spreadsheet Layout (3 sheets)

**Course Ratings** — main data sheet. Row 3 = headers, rows 4+ = course data. Columns:
- A: row number | B: course name | C: architect | D–E: city/state | F: type | G–H: Golfweek list/rank
- I–R: 10 rating criteria (1–10 each) | S: overall rating | T–U: most/least memorable holes | V: notes
- Below data: AVERAGES row (formula-driven) + COURSES RATED row (count); these move automatically

**Rankings Dashboard** — live stats and Top 10 sections (Top 10 Overall, Top 10 by State). Formulas auto-update when course data range changes.

**Rating Guide** — rubric for the 10 design criteria. Read-only reference sheet.

### Code.gs Key Functions

| Function | Purpose |
|----------|---------|
| `onOpen()` | Registers the "Golf Tracker" menu |
| `lookupCourse(name)` | HTTP POST to Claude API; returns JSON metadata |
| `addCourse(formData)` | Full pipeline: duplicate check → insert row → renumber → update dashboard |
| `findInsertionPoint(sheet, data, col)` | Detects current sort column, finds correct insertion index |
| `renumberAndRecolor(sheet, data)` | Batch-resets row numbers and alternating backgrounds |
| `writeSummaryRows(sheet, lastRow)` | Writes AVERAGES and COURSES RATED below data |
| `rebuildRankings()` | Reads all course data and rewrites both Top 10 sections |
| `insertCountryColumn()` | One-time migration: adds country column (22→23 column layout) |

### Claude Integration

- Model: `claude-sonnet-4-6` (configured in `code.gs` line ~19 as `CLAUDE_MODEL`)
- Prompt returns structured JSON: `{architect, city, state, country, type, golfweek_list, golfweek_rank, fun_fact}`
- API key stored in Google Apps Script Script Properties (never in code)
- API key set via **Golf Tracker → Set API Key…** menu (stored in Script Properties)

### Key Constants (code.gs)

```javascript
DATA_START_ROW = 4      // first course row
TOTAL_COLUMNS  = 23     // A through W
RATING_START_COL = 10   // column I (first rating criterion)
RATING_END_COL   = 19   // column R (last rating criterion)
```

Dashboard layout rows are fixed constants near the top of `code.gs` (`TOP10_DATA_START`, `BY_STATE_DATA_START`).

## No ADRs Yet

This project has no `docs/adr/` directory. Before making architectural changes (switching Claude model, changing column layout, restructuring sheets), draft an ADR first.
