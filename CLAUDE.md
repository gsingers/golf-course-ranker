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
- A: row number | B: course name | C: architect | D: city | E: state | F: country | G: type | H: gw_list | I: gw_rank
- J–S: 10 rating criteria (1–10 each) | T: overall rating | U: most memorable hole | V: least memorable hole | W: notes
- Below data: AVERAGES row (formula-driven) + COURSES RATED row (count); these move automatically

**Rankings Dashboard** — live stats and Top 10 sections (Top 10 Overall, Top 10 by State). Formulas auto-update when course data range changes.

**GW Rankings** — optional sheet populated from `data/all_rankings.csv` (produced by `merge_rankings.py`). When present, ranking lookups read from this sheet instead of calling the Claude API. See "Golfweek Rankings Sheet" below.

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
| `buildRankingsIndex()` | Reads GW Rankings sheet once; returns lowercased-name → `{gw_list, gw_rank}` map |
| `lookupRankingFromSheet(name)` | Single-course lookup via `buildRankingsIndex()`; returns null if sheet absent |
| `refreshGolfweekRankings()` | Bulk-updates gw_list/gw_rank for all courses from GW Rankings sheet |
| `showImportRankingsHelp()` | Displays step-by-step instructions for importing `all_rankings.csv` |
| `insertCountryColumn()` | One-time migration: adds country column (22→23 column layout) |

### Claude Integration

- Model: `claude-sonnet-4-6` (configured in `code.gs` line ~19 as `CLAUDE_MODEL`)
- Prompt returns structured JSON: `{architect, city, state, country, type, golfweek_list, golfweek_rank, fun_fact}`
- API key stored in Google Apps Script Script Properties (never in code)
- API key set via **Golf Tracker → Set API Key…** menu (stored in Script Properties)

### Key Constants (code.gs)

```javascript
DATA_START_ROW    = 4             // first course row
TOTAL_COLUMNS     = 23            // A through W
RATING_START_COL  = 10            // column J (first rating criterion)
RATING_END_COL    = 19            // column S (last rating criterion)
GW_RANKINGS_SHEET = "GW Rankings" // optional rankings lookup sheet
```

Dashboard layout rows are fixed constants near the top of `code.gs` (`TOP10_DATA_START`, `BY_STATE_DATA_START`).

## Golfweek Rankings Sheet

When a sheet named `GW Rankings` exists in the spreadsheet, ranking lookups read from it instead of calling the Claude API. This is faster, free, and more accurate.

### Setup workflow

1. Run `python3 scrape_rankings.py` — writes one CSV per list to `data/`
2. Run `python3 merge_rankings.py` — merges all per-list CSVs into `data/all_rankings.csv` (adds `gw_list` and `list_key` columns)
3. In Google Sheets: **File → Import → Upload** → select `data/all_rankings.csv` → choose **Insert new sheet(s)** → name the sheet `GW Rankings`
4. Use **Golf Tracker → Refresh Golfweek Rankings** to apply ranks to all courses in bulk

Or in the menu: **Golf Tracker → GW Rankings: Import help...** prints these steps as an in-app alert.

### `merge_rankings.py` details

- Reads all `*.csv` files in `data/` (skips `all_rankings.csv` itself)
- Derives `gw_list` label from filename prefix (e.g. `modern_us_*` → `"Modern"`, `gbi_classic_*` → `"GBI Classic"`)
- Year suffix in filenames is ignored by the prefix match, so new annual scrapes work without code changes
- Output columns: `gw_list, list_key, rank, tied, name, rating, prev_rank, location, architects, year_opened, type`

### Lookup priority in code.gs

`addCourse()` and `refreshGolfweekRankings()` both try the GW Rankings sheet first. If the sheet is absent, `addCourse()` falls back to a Claude API call; `refreshGolfweekRankings()` shows the import instructions instead.

## Golfweek Rankings Scraper

`scrape_rankings.py` — standalone Python script that fetches Golfweek ranking articles and writes one CSV per list to `data/`.

- **Dependencies**: `requests`, `beautifulsoup4` (install in `.venv`)
- **Output directory**: `data/` — gitignored, not committed
- **Run**: `python scrape_rankings.py`

### LISTS array

Twelve tuples of `(key, url)` at the top of the file. URLs point to specific article pages and need updating each year when Golfweek publishes new rankings. Key naming convention: `{category}_{region}_top{N}_{year}`.

### Parser details

Pages are server-rendered, so plain `requests` + BeautifulSoup works (no headless browser needed). The parser handles two label formats produced by BeautifulSoup's `get_text()`:

- **Inline**: `Average rating: 9.65` — label and value on same line
- **Split**: `Average rating:\n 9.65` — label-only line, value on next line

`LABEL_MAP` normalizes label variants across years (e.g. `"2024 rank"`, `"2025 ranking"` → `prev_rank`).

Tied entries have a `T` prefix (e.g. `T67.`) — the `tied` CSV column records `Y`/`N`.

### CSV columns

`rank`, `tied`, `name`, `rating`, `prev_rank`, `location`, `architects`, `year_opened`, `type`

## No ADRs Yet

This project has no `docs/adr/` directory. Before making architectural changes (switching Claude model, changing column layout, restructuring sheets), draft an ADR first.
