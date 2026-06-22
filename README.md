# Golf Course Ratings Tracker

A personal golf course rating system inspired by Golfweek's methodology. Track every course you play, rate them across 10 design criteria, and see your stats on a live dashboard — all in a single Excel workbook. Add new courses via a Python CLI or a Google Sheets Apps Script plugin, both powered by Claude AI for automatic metadata lookup.

## Project Files

**`Golf_Course_Ratings_Tracker.xlsx`** — Blank template ready to start fresh.

**`Golf_Course_Ratings_Tracker_with_data.xlsx`** — Pre-populated workbook with ~120 courses already entered (use this to see a working example or as your active tracker).

**`add_course.py`** — Command-line tool that appends a new course to the spreadsheet and uses the Claude API to auto-fill architect, course type, and Golfweek ranking list details. Automatically rebuilds the Top 10 sections after each addition.

**`update_rankings.py`** — Standalone script that rebuilds the Top 10 Rated Courses and Top 10 by State sections on the Rankings Dashboard from current ratings. Run this after editing any ratings in the spreadsheet.

**`Code.gs`** — Google Apps Script version of the add course and update rankings functionality. Install this in your Google Sheet for a native menu-driven experience without needing Python.

**`AddCourseDialog.html`** — The HTML form dialog used by the Apps Script plugin. Provides a clean UI for entering course details directly inside Google Sheets.

**`scrape_rankings.py`** — Fetches all Golfweek ranking lists and writes one CSV per list into `data/` (gitignored). Re-run each year when Golfweek publishes updated rankings.

**`merge_rankings.py`** — Merges all per-list CSVs in `data/` into a single `data/all_rankings.csv` with `gw_list` and `list_key` columns prepended. Import this into Google Sheets as a sheet named "GW Rankings" to enable fast, free ranking lookups that replace per-course Claude API calls.

## Spreadsheet Layout

The workbook contains three sheets:

### Course Ratings

This is the main data sheet. Row 1 is the title, row 2 is a subtitle, row 3 holds the column headers, and course data begins on row 4. The columns are:

| Columns | Purpose |
|---------|---------|
| A | Row number |
| B | Course Name |
| C | Architect (original and renovator if applicable) |
| D–E | City, State |
| F | Type — Public, Private, Resort, Semi-Private, or Military |
| G–H | Golfweek ranking list and rank number |
| I–R | Ten rating criteria, each scored 1–10 (see below) |
| S | Overall Rating (1–10) |
| T–U | Most and Least Memorable Holes |
| V | Notes |

Below the last course entry you'll find two summary rows: **AVERAGES** (formula-driven averages for every rating column) and **COURSES RATED** (count of courses with ratings entered). These rows move automatically when you add courses through the CLI.

### Rankings Dashboard

A quick-reference sheet with a rating scale guide (what scores like 8+ or below 5 mean) and live stats pulled from Course Ratings: total courses logged, courses rated, highest/lowest/average overall rating. No manual upkeep needed — the formulas update on their own.

### Rating Guide

A detailed rubric for each of the 10 rating criteria. Open this sheet whenever you're filling in scores to keep your evaluations consistent. The criteria are:

1. **Routing** — flow between holes, variety of direction changes
2. **Design Integrity / Shaping** — authenticity of design, quality of earthwork
3. **Overall Land Plan** — how well the course fits its terrain
4. **Greens & Surrounds** — contour, creativity, and recovery options
5. **Par 3 Variety & Memorability** — distance range, visual impact
6. **Par 4 Variety & Memorability** — strategic variety across lengths
7. **Par 5 Variety & Memorability** — risk-reward balance, go/no-go decisions
8. **Tree & Landscape Management** — framing, sightlines, aesthetics
9. **Conditioning & Ecology** — turf quality, firmness, sustainability
10. **Walk in the Park Test** — would you enjoy the walk even without clubs?

Each criterion uses a 1–10 scale: 9–10 is exceptional, 7–8 is excellent, 5–6 is good, 3–4 is average, and 1–2 indicates significant weaknesses.

## Using the CLI (`add_course.py`)

### Prerequisites

```
pip install anthropic openpyxl
export ANTHROPIC_API_KEY=your_key_here
```

The API key is optional — if it isn't set the script still works, it just skips the auto-fill step.

### Adding a Course

**Interactive mode** (prompts you for each field):

```
python add_course.py
```

**One-liner with required fields:**

```
python add_course.py "Pebble Beach Golf Links" "Pebble Beach" "CA"
```

**With optional flags:**

```
python add_course.py "Augusta National" "Augusta" "GA" --type Private --notes "The dream"
```

### What the Script Does

1. Opens the spreadsheet and checks for duplicate entries (same name, city, and state).
2. Calls the Claude API to look up the course's architect, type (Public/Private/Resort/etc.), and which Golfweek ranking list it might appear on.
3. Inserts a new row with proper formatting (fonts, borders, alternating row colors, gold highlight on the Overall Rating column).
4. Moves the AVERAGES and COURSES RATED summary rows down to stay below the data.
5. Updates the Rankings Dashboard formulas so the stats reflect the new range.
6. Rebuilds the Top 10 Rated Courses and Top 10 by State sections from the current ratings.

### CLI Flags

| Flag | Description |
|------|-------------|
| `--file PATH` | Use a different `.xlsx` file (defaults to the one in the same folder) |
| `--type TYPE` | Override the course type instead of using the AI lookup |
| `--notes "..."` | Add freeform notes |
| `--most-memorable "..."` | Note your most memorable hole |
| `--least-memorable "..."` | Note your least memorable hole |
| `--no-ai` | Skip the Claude lookup entirely |

## Refreshing Rankings After Editing Ratings

Whenever you change ratings in the spreadsheet, run:

```
python update_rankings.py
```

This rebuilds both Top 10 sections on the Rankings Dashboard. If you use `add_course.py` to add courses, this happens automatically.

## Google Sheets Apps Script Plugin

If you prefer working entirely inside Google Sheets rather than running Python locally, the Apps Script plugin provides the same functionality through a native menu and dialog.

### Installation

1. Open your Golf Course Ratings Tracker in Google Sheets.
2. Go to **Extensions → Apps Script**.
3. Replace the default `Code.gs` content with the contents of `Code.gs` from this repo.
4. Click the **+** next to "Files" → select **HTML** → name it `AddCourseDialog` (no extension) and paste the contents of `AddCourseDialog.html`.
5. In the Apps Script editor, go to **Project Settings** (gear icon) → **Script Properties** → click **Add script property** and set the name to `ANTHROPIC_API_KEY` with your Anthropic API key as the value.
6. Save the project and reload your spreadsheet.

After the page reloads a **Golf Tracker** menu will appear in the toolbar.

### Menu Options

**Add Course…** — Opens a form dialog where you enter the course name, city, state, and optional fields (type override, most/least memorable holes, notes). On submit, the script looks up the course's Golfweek ranking (from the GW Rankings sheet if available, otherwise via the Claude API), checks for duplicates, inserts a formatted row, and rebuilds the Top 10 sections.

**Update Rankings** — Rebuilds both Top 10 sections on the Rankings Dashboard from current data. Use this after manually editing ratings.

**Refresh Golfweek Rankings** — Updates the gw_list and gw_rank columns for every course in the sheet. Reads from the GW Rankings sheet (fast, free); shows import instructions if that sheet is missing.

**GW Rankings: Import help…** — Displays step-by-step instructions for running `merge_rankings.py` and importing `all_rankings.csv` into the spreadsheet.

**Set API Key…** — Prompts you to enter or update your Anthropic API key (stored in Script Properties, not visible in the spreadsheet).

### Features

The Apps Script plugin mirrors every feature of the Python CLI: Claude AI auto-fill for architect, course type, and Golfweek ranking list; duplicate detection with an option to force-add; alternating white/gray row backgrounds; bold course names, italic gray architects, dark green overall ratings on a gold background; thin gray borders; AVERAGES and COURSES RATED summary rows that follow the data; dashboard formula range updates; and live Top 10 rebuilds. The dialog also displays a fun fact about the course when available.


## Scraping and Loading Golfweek Rankings

`scrape_rankings.py` fetches the current Golfweek ranking lists and writes one CSV per list into the `data/` directory. `merge_rankings.py` then combines them into a single file you can import into Google Sheets. The `data/` directory is gitignored — run the scripts yourself to generate fresh data.

### Setup

```bash
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install requests beautifulsoup4
```

Or with `uv`:

```bash
uv venv .venv
uv pip install requests beautifulsoup4
```

### Running

```bash
python3 scrape_rankings.py   # writes data/<list_key>.csv for each list
python3 merge_rankings.py    # writes data/all_rankings.csv (merged)
```

Then in Google Sheets: **File → Import → Upload** → select `data/all_rankings.csv` → choose **Insert new sheet(s)** → name it `GW Rankings`. After that, **Golf Tracker → Refresh Golfweek Rankings** applies accurate ranks to all your courses instantly.

### CSV Columns

| Column | Description |
|--------|-------------|
| `rank` | Numeric rank |
| `tied` | `Y` if tied (entry prefixed with `T`), else `N` |
| `name` | Course name |
| `rating` | Average panelist rating |
| `prev_rank` | Prior year rank |
| `location` | City, State |
| `architects` | Designer(s) |
| `year_opened` | Year course opened |
| `type` | Course type (Public, Private, etc.) |

### Keeping Rankings Current

URLs in the `LISTS` array at the top of `scrape_rankings.py` point to specific article pages. When Golfweek publishes updated rankings each year, replace the stale URLs with the new ones.

### Lists Included (2025–2026)

- Classic US Top 200
- Modern US Top 200
- International Top 100
- Resort US Top 200
- Residential US Top 200
- Mexico/Caribbean Top 50
- Great Britain & Ireland Classic Top 50
- Great Britain & Ireland Modern Top 50
- Public Access US Top 100
- Short/Par-3 Public Top 25
- Short/Par-3 Private Top 25
- Casino Top 50

## Typical Workflow

### With the Python CLI

1. Play a round.
2. Run `python add_course.py "Course Name" "City" "ST"` to add the course with auto-filled metadata.
3. Open the spreadsheet and fill in your 1–10 ratings for each of the 10 criteria plus your Overall Rating.
4. Run `python update_rankings.py` to refresh the Top 10 lists.
5. Optionally jot down your most/least memorable holes and any notes.
6. Check the Rankings Dashboard to see how the new course stacks up.

### With the Google Sheets Plugin

1. **One-time setup**: run `python3 scrape_rankings.py && python3 merge_rankings.py`, then import `data/all_rankings.csv` into your spreadsheet as a sheet named `GW Rankings`.
2. Play a round.
3. Open your Google Sheet and click **Golf Tracker → Add Course…** to enter the course (ranking pulled from the GW Rankings sheet automatically).
4. Fill in your 1–10 ratings directly in the sheet.
5. Click **Golf Tracker → Update Rankings** to refresh the Top 10 lists.
6. Check the Rankings Dashboard.
7. Each year after Golfweek publishes updated rankings: re-run the two Python scripts, re-import `all_rankings.csv`, then use **Golf Tracker → Refresh Golfweek Rankings** to update all courses at once.