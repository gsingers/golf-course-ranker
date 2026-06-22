#!/usr/bin/env python3
"""Merge all per-list CSVs in data/ into a single all_rankings.csv."""
from pathlib import Path
import csv

DATA_DIR = Path(__file__).parent / "data"
OUTPUT = DATA_DIR / "all_rankings.csv"
FIELDS = ['gw_list', 'list_key', 'rank', 'tied', 'name', 'rating',
          'prev_rank', 'location', 'architects', 'year_opened', 'type']

LIST_LABELS: dict[str, str] = {
    'modern_us':          'Modern',
    'classic_us':         'Classic',
    'resort_us':          'Resort',
    'public_access_us':   'Public',
    'international':      'International',
    'gbi_classic':        'GBI Classic',
    'gbi_modern':         'GBI Modern',
    'residential_us':     'Residential',
    'casino':             'Casino',
    'mexico_caribbean':   'Mexico/Caribbean',
    'short_par3_private': 'Short/Par3 Private',
    'short_par3_public':  'Short/Par3 Public',
}


def key_to_label(list_key: str) -> str:
    for prefix, label in LIST_LABELS.items():
        if list_key.startswith(prefix):
            return label
    return list_key


def merge() -> None:
    rows: list[dict] = []
    for csv_path in sorted(DATA_DIR.glob("*.csv")):
        if csv_path.name == OUTPUT.name:
            continue
        list_key = csv_path.stem
        with csv_path.open(newline='') as f:
            for row in csv.DictReader(f):
                row['list_key'] = list_key
                row['gw_list'] = key_to_label(list_key)
                rows.append(row)

    with OUTPUT.open('w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(rows)

    print(f"Merged {len(rows)} rows → {OUTPUT}")


if __name__ == '__main__':
    merge()
