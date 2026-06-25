"""
Local test harness for the course-name matching logic in code.gs.
Mirrors: normalizeCourseName → exact → normalized → Jaccard token overlap.
"""
import csv
import re

SUFFIX_RE = re.compile(
    r'\b(golf links|golf course|golf club|golf resort|country club'
    r'|golf & country club|g&cc|gc|cc|club)\b'
)
PUNCT_RE  = re.compile(r"['''.,-]")
PAREN_RE  = re.compile(r'\(([^)]+)\)')
STOPWORDS = {'the', 'at', 'of', 'in', 'a', 'an', 'and'}

# Primary lists win key collisions over secondary lists
PRIMARY_LISTS = {'Modern', 'Classic', 'Public', 'Resort', 'GBI Classic', 'GBI Modern', 'International'}


def normalize(name):
    s = name.strip().lower()
    if s.startswith('the '):
        s = s[4:]
    s = PUNCT_RE.sub('', s)
    s = SUFFIX_RE.sub('', s)
    return ' '.join(s.split())


def token_set(name):
    return [t for t in normalize(name).split()
            if len(t) > 1 and t not in STOPWORDS]


def jaccard(a_tokens, b_tokens):
    a, b = set(a_tokens), set(b_tokens)
    union = len(a | b)
    return len(a & b) / union if union else 0


THRESHOLD = 0.6


def _push_also(winner: dict, loser: dict) -> None:
    """Add loser's ranking to winner's also_ranked — only for same-named courses."""
    if winner.get('_name') != loser.get('_name'):
        return  # different courses sharing a key fragment; skip
    if not loser.get('_primary') or not loser.get('gw_list') or not loser.get('rank'):
        return
    if winner.get('gw_list') == loser.get('gw_list') and winner.get('rank') == loser.get('rank'):
        return  # same entry (exact == normalized key collision with itself)
    also = winner.setdefault('also_ranked', [])
    item = {'gw_list': loser['gw_list'], 'rank': loser['rank']}
    if not any(a['gw_list'] == item['gw_list'] and a['rank'] == item['rank'] for a in also):
        also.append(item)
    for a in (loser.get('also_ranked') or []):
        if not any(x['gw_list'] == a['gw_list'] and x['rank'] == a['rank'] for x in also):
            also.append(a)


def _add(index, key, entry):
    if not key:
        return
    if key not in index:
        index[key] = entry
        return
    ex = index[key]
    ex_primary  = ex.get('_primary', False)
    new_primary = entry.get('_primary', False)
    if ex_primary != new_primary:
        entry_wins = new_primary
    else:
        try:
            entry_wins = int(entry['rank']) < int(ex['rank'])
        except (ValueError, TypeError):
            entry_wins = False
    winner, loser = (entry, ex) if entry_wins else (ex, entry)
    if entry_wins:
        index[key] = entry
    _push_also(winner, loser)


def _significant_tokens(name):
    return [t for t in normalize(name).split() if len(t) > 1 and t not in STOPWORDS]


def _index_row(index, raw, entry):
    _add(index, raw.lower(), entry)
    _add(index, normalize(raw), entry)
    m = PAREN_RE.search(raw)
    if m:
        paren_content = m.group(1).strip()
        pre_paren     = raw[:m.start()].strip()
        if len(_significant_tokens(paren_content)) >= 2:
            _add(index, normalize(paren_content), entry)
        if len(_significant_tokens(pre_paren)) >= 2:
            _add(index, normalize(pre_paren), entry)
        combined = normalize(pre_paren) + ' ' + normalize(paren_content)
        _add(index, ' '.join(combined.split()), entry)


def build_index(rankings_path):
    index = {}
    with open(rankings_path, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            raw = row['name'].strip()
            if not raw:
                continue
            is_primary = row['gw_list'] in PRIMARY_LISTS
            entry = {'gw_list': row['gw_list'], 'rank': row['rank'],
                     '_primary': is_primary, '_name': raw.lower()}
            _index_row(index, raw, entry)
    return index


def _exact(name, index):
    return index.get(name.strip().lower())


def _norm(name, index):
    return index.get(normalize(name))


def _dash_to_paren_keys(course_name):
    """Yield candidate exact keys for 'X - Y' → 'X (Y)' and 'X (Y)' without leading The."""
    m = re.match(r'^(.+?)\s+-\s+(.+)$', course_name)
    if not m:
        return
    base, variant = m.group(1).strip(), m.group(2).strip()
    for b in [base, re.sub(r'^[Tt]he\s+', '', base)]:
        yield (b + ' (' + variant + ')').lower()


def _number_paren_key(course_name):
    """Convert '#N' → '(No. N)' for numbered course lookups."""
    if '#' not in course_name:
        return None
    return re.sub(r'#(\d+)', r'(No. \1)', course_name).lower()


def _fuzzy(name, index):
    tokens = token_set(name)
    if not tokens:
        return None, None, None
    best_score, best_entry, best_key = 0, None, None
    for key, entry in index.items():
        score = jaccard(tokens, [t for t in key.split()
                                 if len(t) > 1 and t not in STOPWORDS])
        if score > best_score:
            best_score, best_entry, best_key = score, entry, key
    if best_score >= THRESHOLD:
        return best_entry, best_key, round(best_score, 2)
    return None, None, None


def lookup(course_name, index):
    # 1. Exact
    hit = _exact(course_name, index)
    if hit:
        return 'exact', hit, None

    # 2. Dash-to-paren: "X - Y" → "X (Y)" checked BEFORE normalize to avoid
    #    false collisions like "The Prairie Club - Dunes" → "prairie dunes"
    for key in _dash_to_paren_keys(course_name):
        hit = index.get(key)
        if hit:
            return 'dash-to-paren', hit, None

    # 3. "#N" → "(No. N)" for numbered courses (e.g. Pinehurst #4)
    nkey = _number_paren_key(course_name)
    if nkey:
        hit = index.get(nkey)
        if hit:
            return 'number-paren', hit, None

    # 4. Normalized
    hit = _norm(course_name, index)
    if hit:
        return 'normalized', hit, None

    # 5. Strip-variant base name (exact + normalized)
    base = re.sub(r'\s*-\s*.*$', '', course_name).strip()
    if base != course_name:
        hit = _exact(base, index) or _norm(base, index)
        if hit:
            return 'strip-variant', hit, None

    # 6. Fuzzy — run on base name only for dash-names to prevent token bleed
    #    from the variant suffix (e.g. avoid "prairie" + "dunes" merging)
    fuzzy_name = base if base != course_name else course_name
    entry, key, score = _fuzzy(fuzzy_name, index)
    if entry:
        return 'fuzzy', entry, (key, score)

    return None, None, None


def main():
    base = '/Users/grantingersoll/projects/golf/golf-course-ranker/data'
    rankings_path = f'{base}/all_rankings.csv'
    sample_path   = f'{base}/sample_courses.csv'

    index = build_index(rankings_path)

    matched, unmatched = [], []
    with open(sample_path, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = row['course_name'].strip()
            method, entry, fuzzy_info = lookup(name, index)
            if method:
                matched.append((name, method, entry, fuzzy_info))
            else:
                unmatched.append(name)

    print(f'\n=== MATCHED ({len(matched)}) ===')
    for name, method, entry, fuzzy_info in matched:
        tag = f'[{method}]'
        if fuzzy_info:
            tag += f' via "{fuzzy_info[0]}" score={fuzzy_info[1]}'
        also = entry.get('also_ranked') or []
        also_str = '  (also: ' + ', '.join(f'{a["gw_list"]} #{a["rank"]}' for a in also) + ')' if also else ''
        print(f'  {tag:55s}  {name}  →  {entry["gw_list"]} #{entry["rank"]}{also_str}')

    print(f'\n=== UNMATCHED ({len(unmatched)}) ===')
    for name in unmatched:
        print(f'  {name}')
        print(f'    normalized: "{normalize(name)}"')
        print(f'    tokens:     {token_set(name)}')

    print(f'\nSummary: {len(matched)} matched, {len(unmatched)} unmatched out of {len(matched)+len(unmatched)} courses')


if __name__ == '__main__':
    main()
