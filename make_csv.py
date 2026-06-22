#!/usr/bin/env python3
"""Convert JSON course ranking data to CSV."""
import json, csv, sys, os

def to_csv(json_path, csv_path):
    with open(json_path) as f:
        data = json.load(f)
    if not data:
        return
    fields = ['rank', 'tied', 'name', 'rating', 'prev_rank', 'location', 'architects', 'year_opened', 'type']
    with open(csv_path, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction='ignore')
        w.writeheader()
        for row in data:
            row['tied'] = 'Y' if row.get('tied') else 'N'
            w.writerow(row)
    print(f"Wrote {len(data)} rows to {csv_path}")

if __name__ == '__main__':
    data_dir = os.path.dirname(os.path.abspath(__file__))
    for fn in os.listdir(data_dir):
        if fn.endswith('.json') and fn != 'make_csv.py':
            base = fn[:-5]
            to_csv(os.path.join(data_dir, fn), os.path.join(data_dir, base + '.csv'))
