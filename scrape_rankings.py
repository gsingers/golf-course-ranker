#!/usr/bin/env python3
"""
Scrape Golfweek course rankings and write one CSV per list.

Usage:
    pip install requests beautifulsoup4
    python scrape_rankings.py

Output: data/ directory with one CSV per ranking list.
Each CSV has columns: rank, tied, name, rating, prev_rank, location, architects, year_opened, type
"""

import csv
import os
import re
import time

import requests
from bs4 import BeautifulSoup

LISTS = [
    ("classic_us_top200_2026",     "https://golfweek.usatoday.com/story/sports/golf/2026/06/08/top-200-classic-golf-courses-ranked-united-states-golfweeks-best-2026/90283876007/"),
    ("modern_us_top200_2026",      "https://golfweek.usatoday.com/story/sports/golf/2026/06/01/top-200-modern-golf-courses-ranked-united-states-golfweeks-best-2026/90158690007/"),
    ("international_top100_2026",  "https://golfweek.usatoday.com/story/sports/golf/2026/03/24/golfweeks-best-2026-top-100-international-courses-outside-u-s/89298490007/"),
    ("resort_us_top200_2026",      "https://golfweek.usatoday.com/story/sports/golf/2026/01/08/top-200-resort-golf-courses-united-states-2026-golfweeks-best-rankings-list/88037572007/"),
    ("residential_us_top200_2026", "https://golfweek.usatoday.com/story/sports/golf/2026/01/09/top-200-residential-golf-courses-united-states-2026-golfweeks-best-rankings-list/88053264007/"),
    ("mexico_caribbean_top50_2026","https://golfweek.usatoday.com/story/sports/golf/2026/01/13/top-50-golf-courses-mexico-caribbean-atlantic-islands-central-america-2026-rankings-list/88107937007/"),
    ("gbi_classic_top50_2026",     "https://golfweek.usatoday.com/story/sports/golf/2026/01/12/top-50-classic-golf-courses-great-britain-ireland-scotland-wales-2026-rankings-list/88106819007/"),
    ("gbi_modern_top50_2026",      "https://golfweek.usatoday.com/story/sports/golf/2026/01/12/top-50-modern-golf-courses-great-britain-ireland-scotland-wales-2026-rankings-list/88105565007/"),
    ("public_access_us_top100_2025","https://golfweek.usatoday.com/story/sports/golf/2025/06/30/golfweeks-best-2025-public-access-top-100-golf-courses-united-states-best-you-can-play/83866517007/"),
    ("short_par3_public_top25_2025","https://golfweek.usatoday.com/story/sports/golf/2025/10/22/top-25-ranking-public-access-par-3-short-non-traditional-golf-courses-2025-golfweeks-best/86819174007/"),
    ("short_par3_private_top25_2025","https://golfweek.usatoday.com/story/sports/golf/2025/10/22/top-25-ranking-private-par-3-short-non-traditional-golf-courses-2025-golfweeks-best/86820833007/"),
    ("casino_top50_2025",          "https://golfweek.usatoday.com/story/sports/golf/2025/10/06/casino-golf-courses-ranked-top-50-golfweeks-best-2025/86481807007/"),
]

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

FIELDS = ["rank", "tied", "name", "rating", "prev_rank", "location", "architects", "year_opened", "type"]

# Map label text (lowercased) → entry field name
LABEL_MAP = {
    "average rating":    "rating",
    "2025 average rating": "rating",
    "2024 average rating": "rating",
    "2025 ranking":      "prev_rank",
    "2024 ranking":      "prev_rank",
    "2024 rank":         "prev_rank",
    "2023 ranking":      "prev_rank",
    "location":          "location",
    "architect(s)":      "architects",
    "year opened":       "year_opened",
    "type":              "type",
}


def fetch_text(url: str) -> str:
    resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    for tag in soup.select("nav, footer, aside, script, style, [class*='ad']"):
        tag.decompose()
    return soup.get_text("\n")


def parse_entries(text: str) -> list[dict]:
    """Parse ranked entries from page text.

    Handles both inline format ("Average rating: 9.65") and
    split format ("Average rating:\\n 9.65") produced by BeautifulSoup.
    """
    start = text.find("\n1. ")
    if start == -1:
        return []
    lines = text[start:].splitlines()
    entries = []
    current = None
    pending_field = None  # set when label is on its own line

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue

        # New ranked entry
        m = re.match(r"^(T?)(\d+)\.\s+(.+)$", stripped)
        if m:
            if current:
                entries.append(current)
            current = {
                "rank": int(m.group(2)),
                "tied": "Y" if m.group(1) == "T" else "N",
                "name": m.group(3).replace("*", "").strip(),
            }
            pending_field = None
            continue

        if current is None:
            continue

        # Value line following a label-only line
        if pending_field:
            # Strip trailing parenthetical like "(m)" from architect strings
            value = re.sub(r"\s*\(\w\)$", "", stripped).strip()
            current[pending_field] = value
            pending_field = None
            continue

        # Label: value on same line  OR  label alone (value on next line)
        if ":" in stripped:
            label, _, rest = stripped.partition(":")
            field = LABEL_MAP.get(label.strip().lower())
            if field:
                rest = rest.strip()
                if rest:
                    current[field] = re.sub(r"\s*\(\w\)$", "", rest).strip()
                else:
                    pending_field = field  # value is on the next line

    if current:
        entries.append(current)
    return entries


def write_csv(path: str, entries: list[dict]) -> None:
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS, extrasaction="ignore")
        w.writeheader()
        w.writerows(entries)


def main() -> None:
    out_dir = os.path.join(os.path.dirname(__file__), "data")
    os.makedirs(out_dir, exist_ok=True)

    for name, url in LISTS:
        print(f"Fetching {name} ...", end=" ", flush=True)
        try:
            text = fetch_text(url)
            entries = parse_entries(text)
            if not entries:
                print(f"WARNING: no entries parsed — check URL or page structure")
                continue
            csv_path = os.path.join(out_dir, f"{name}.csv")
            write_csv(csv_path, entries)
            print(f"{len(entries)} rows → {csv_path}")
        except Exception as exc:
            print(f"ERROR: {exc}")
        time.sleep(1)  # be polite


if __name__ == "__main__":
    main()
