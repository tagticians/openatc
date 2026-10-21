"""Build a game airport file from the LVNL eAIP (HTML pages + AD 2.24 chart PDFs).

Usage:
  python3 -I scripts/eaip/build_airport.py EHAM "LVNL/AIRAC AMDT 10-2026_2026_10_01" src/data/airports/EHAM.json

Reads AD 2 <ICAO> 1 (aerodrome data + AD 2.22 coding tables), ENR 2.1 (TMAs),
ENR 4.1/4.4 (navaids, significant points) and the aerodrome chart PDFs (RNAV
waypoint coordinates, via `pdftotext`). Writes one JSON document consumed by
src/data/airportLoader.ts.
"""
import glob
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tables import extract  # noqa: E402

ICAO, ROOT, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
EAIP = os.path.join(ROOT, 'eAIP')
warnings = []


# ------------------------------------------------------------------ helpers
COORD = r'(\d{2})(\d{2})(\d{2}(?:\.\d+)?)\s*([NS])\s*(\d{3})(\d{2})(\d{2}(?:\.\d+)?)\s*([EW])'
COORD_NC = r'\d{6}(?:\.\d+)?\s*[NS]\s*\d{7}(?:\.\d+)?\s*[EW]'


def dms(m):
    lat = int(m[1]) + int(m[2]) / 60 + float(m[3]) / 3600
    lon = int(m[5]) + int(m[6]) / 60 + float(m[7]) / 3600
    if m[4] == 'S':
        lat = -lat
    if m[8] == 'W':
        lon = -lon
    return [round(lat, 6), round(lon, 6)]


def coords_in(s):
    return [dms(m) for m in re.finditer(COORD, s)]


def flat(cell):
    return re.sub(r'\s+', ' ', cell).strip()


def ft(s):
    """'FL 070' -> 7000, '2000' -> 2000, 'F070' -> 7000."""
    s = s.strip()
    m = re.match(r'F(?:L)?\s*(\d{2,3})', s)
    if m:
        return int(m[1]) * 100
    m = re.match(r'(\d{3,5})', s)
    return int(m[1]) if m else None


def alt_cell(s):
    """Coding-table altitude: '+ FL 070', '- 3000', '@ 2000', 'B FL 140 FL 100'."""
    s = flat(s)
    if not s or s == '-':
        return None
    m = re.match(r'B\s+(FL\s*\d+|\d+)\s+(FL\s*\d+|\d+)', s)
    if m:
        a, b = ft(m[1]), ft(m[2])
        return {'below': max(a, b), 'above': min(a, b)}
    m = re.match(r'([+\-@])\s*(FL\s*\d+|\d+)', s)
    if m:
        v = ft(m[2])
        return {'+': {'above': v}, '-': {'below': v}, '@': {'at': v}}[m[1]]
    return None


def spd_cell(s):
    m = re.match(r'-\s*(\d{3})', flat(s))
    return int(m[1]) if m else None


def mag_course(s):
    m = re.match(r'(\d{3})', flat(s))
    return int(m[1]) if m else None


def star_constraints(abbrev):
    """'ARTIP [K250-, B F100 F070]' -> (alt, spd)."""
    m = re.search(r'\[(.*)\]', abbrev)
    alt = spd = None
    if not m:
        return alt, spd
    for part in [p.strip() for p in m[1].split(',')]:
        mm = re.match(r'K(\d{3})-', part)
        if mm:
            spd = int(mm[1])
            continue
        mm = re.match(r'B\s*F(\d{3})\s*F(\d{3})', part)
        if mm:
            a, b = int(mm[1]) * 100, int(mm[2]) * 100
            alt = {'below': max(a, b), 'above': min(a, b)}
            continue
        mm = re.match(r'F(\d{3})([+-]?)$', part)
        if mm:
            v = int(mm[1]) * 100
            alt = {'-': {'below': v}, '+': {'above': v}, '': {'at': v}}[mm[2]]
    return alt, spd


def norm_fix(s):
    s = flat(s).replace('THR ', 'THR')
    return s


# ------------------------------------------------------------------ AD 2 page
ad2_path = os.path.join(EAIP, f'EH-AD 2 {ICAO} 1-en-GB.html')
tables = extract(ad2_path)
all_text = re.sub(r'<[^>]+>', ' ', open(ad2_path, encoding='utf-8', errors='ignore').read())
all_text = re.sub(r'&nbsp;|\s+', ' ', all_text)

airport = {'icao': ICAO}

# AD 2.2: ARP, elevation, mag var
m = re.search(r'ARP coordinates and site at AD.*?' + COORD, all_text)
airport['arp'] = dms(re.search(COORD, m[0][-40:])) if m else None
m = re.search(r'ELEV:\s*(-?\d+)\s*FT', all_text)
airport['elevation'] = int(m[1]) if m else 0
m = re.search(r'MAG VAR / annual change\s*(?:\|\s*)?([\d.]+)°\s*([EW])', all_text)
airport['magVar'] = (float(m[1]) if m[2] == 'E' else -float(m[1])) if m else 0
if not m:
    warnings.append('MAG VAR not found')
m = re.search(r'Transition altitude:?\s*(\d{4})\s*FT', all_text, re.I)
airport['transitionAltitude'] = int(m[1]) if m else 3000


def find_table(pred):
    for t in tables:
        txt = ' '.join(' '.join(r) for r in t['rows'])
        if pred(t, txt):
            return t
    return None


# Runways (AD 2.12)
runways = {}
t = find_table(lambda t, x: 'THR coordinates' in x and 'True BRG' in x)
for r in t['rows']:
    if not re.fullmatch(r'\d{2}[LCR]?', flat(r[0])):
        continue
    rid = flat(r[0])
    cs = coords_in(r[4])
    elev = re.search(r'THR:\s*(-?[\d.]+)\s*FT', r[5])
    runways[rid] = {
        'id': rid,
        'trueHdg': float(re.match(r'([\d.]+)', flat(r[1]))[1]),
        'length': int(re.match(r'(\d+)', flat(r[2]))[1]),
        'width': int(re.search(r'x\s*(\d+)', flat(r[2]))[1]),
        'thr': cs[0],
        'end': cs[1],
        'elevation': round(float(elev[1])) if elev else airport['elevation'],
    }

# ILS (AD 2.19)
t = find_table(lambda t, x: 'LOC' in x and 'MHz' in x and 'Type of aid' in x)
for r in t['rows'] if t else []:
    m = re.match(r'LOC\s+(\d{2}[LCR]?)', flat(r[0]))
    if m and m[1] in runways:
        f = re.search(r'([\d.]+)\s*MHz', r[2])
        runways[m[1]]['ils'] = {'ident': flat(r[1]), 'freq': f[1] if f else ''}

# Frequencies (AD 2.18): first channel per service
freqs = {}
t = find_table(lambda t, x: 'Call sign' in x and 'Channel' in x)
service = None
for r in t['rows'] if t else []:
    cells = [flat(c) for c in r]
    if len(cells) >= 3 and re.match(r'\d{3}\.\d{3}', cells[2]):
        callsign = cells[1]
        f = cells[2]
    elif len(cells) >= 2 and re.match(r'\d{3}\.\d{3}', cells[1]):
        callsign = cells[0]
        f = cells[1]
    else:
        continue
    for key, pat in [('approach', r'Approach'), ('arrival', r'Arrival$'), ('tower', r'Tower'), ('delivery', r'Delivery'), ('ground', r'Ground'), ('atis', r'Information')]:
        if re.search(pat, callsign) and key not in freqs and float(f) < 137:
            freqs[key] = f
airport['frequencies'] = freqs

# CTR (AD 2.17)
ctr = None
t = find_table(lambda t, x: 'Designation and lateral limits' in x)
if t:
    cell = next((r[0] for r in t['rows'] if 'CTR' in r[0]), '')
    pts = coords_in(cell)
    arc = re.search(r'radius\s*([\d.]+)\s*NM.*?centre\s*' + COORD, flat(cell))
    ctr = {'points': pts, 'arc': None}
    if arc:
        ctr['arc'] = {'radius': float(arc[1]), 'centre': dms(re.search(COORD, arc[0]))}
airport['ctr'] = ctr


# ------------------------------------------------------------------ procedures
def coding_rows(rows):
    """Data rows of a 12-column coding table (serial first)."""
    for r in rows:
        if re.fullmatch(r'\d{3}', flat(r[0])) and len(r) >= 10:
            yield r


def to_leg(r):
    path = flat(r[1])
    wpt = norm_fix(r[2])
    over = flat(r[3]) == 'Y'
    crs = mag_course(r[4])
    alt = alt_cell(r[8])
    spd = spd_cell(r[9])
    if path.startswith(('CA', 'VA', 'FA', 'VM', 'FM', 'VI')) or (wpt in ('-', '') and crs is not None):
        a = (alt or {}).get('above') or (alt or {}).get('at') or (alt or {}).get('below')
        return {'t': 'CA', 'crs': crs or 0, 'alt': a or 2000}
    leg = {'t': 'FIX', 'fix': wpt}
    if alt:
        leg['alt'] = alt
    if spd:
        leg['spd'] = spd
    if over:
        leg['flyover'] = True
    return leg


sids, seen_sids = [], set()
for t in tables:
    m = re.search(r'SIDs RWY (\d{2}[LCR]?)', t['heading'])
    if not m:
        continue
    rwy = m[1]
    head = t['rows'][0]
    nm = re.match(r'([A-Z]{2,5} ?\d[A-Z])\s*\[([A-Z0-9]+)\]', flat(head[0]))
    if not nm:
        continue
    name, ident = nm[1], nm[2]
    remarks = flat(' '.join(head[1:]))
    if name in seen_sids:  # RF / Y coding variants: keep the standard one
        continue
    legs = [to_leg(r) for r in coding_rows(t['rows'])]
    if not legs:
        continue
    seen_sids.add(name)
    climb = re.search(r'climb to (FL \d+|\d+ FT)', remarks)
    sids.append({'name': name, 'ident': ident, 'runway': rwy, 'legs': legs, 'initialAlt': ft(climb[1]) if climb else None, 'supplementary': 'Supplementary' in t['heading']})

stars = []
for t in tables:
    if 'STAR descriptions' not in t['heading'] and 'STAR' not in t['heading']:
        continue
    rows = t['rows']
    if len(rows) < 3 or 'ARINC' not in ' '.join(rows[1]):
        continue
    name = flat(rows[0][0])
    legs = []
    ident = None
    for r in rows[2:]:
        cells = [flat(c) for c in r]
        if cells and cells[0].startswith('['):
            ident = cells[0].strip('[]')
            cells = cells[1:]
        # The abbreviated description is the cell that looks like 'FIX [constraints]'.
        abbrev = next((c for c in cells if re.fullmatch(r'[A-Z0-9]{2,5}(\s*\[.*\])?', c)), '')
        fixname = re.match(r'([A-Z0-9]{2,5})', abbrev)
        if not fixname:
            continue
        alt, spd = star_constraints(abbrev)
        leg = {'t': 'FIX', 'fix': fixname[1]}
        if alt:
            leg['alt'] = alt
        if spd:
            leg['spd'] = spd
        legs.append(leg)
    if legs:
        stars.append({'name': name, 'ident': ident or name.replace(' ', ''), 'legs': legs})

holdings = {}
t = find_table(lambda t, x: 'Holding' in x and 'Inbound' in x)
for r in t['rows'][1:] if t else []:
    cells = [flat(c) for c in r]
    if len(cells) < 8:
        continue
    inbound = re.match(r'(\d{3})', cells[2])
    if not inbound:
        continue
    holdings[cells[1]] = {'inbound': int(inbound[1]), 'turn': 'L' if cells[7] == 'L' else 'R', 'minAlt': ft(cells[4]) or 2000, 'maxSpd': int(cells[3]) if cells[3].isdigit() else None}

# Approach segments: per-runway tables, excluding RNP APCH codings.
approaches = {}
for t in tables:
    m = re.search(r'RWY (\d{2}[LCR]?)$', t['heading'])
    if not m or m[1] not in runways:
        continue
    rows = list(coding_rows(t['rows']))
    if not rows or any('RNP APCH' in ' '.join(r) for r in rows):
        continue
    seqs, cur = [], []
    for r in rows:
        if flat(r[0]) == '001' and cur:
            seqs.append(cur)
            cur = []
        cur.append(r)
    if cur:
        seqs.append(cur)
    a = approaches.setdefault(m[1], {'transitions': {}, 'final': None, 'missed': None})
    for seq in seqs:
        legs = [to_leg(r) for r in seq]
        names = [l.get('fix') for l in legs]
        thr = next((i for i, n in enumerate(names) if n and n.startswith('THR')), None)
        if thr is not None:
            if a['final'] is None:
                a['final'] = legs[: thr + 1]
                a['missed'] = [l for l in legs[thr + 1:]]
        else:
            start = names[0]
            if start and start not in a['transitions']:
                a['transitions'][start] = legs
for rid, a in approaches.items():
    runways[rid]['approach'] = a

# ------------------------------------------------------------------ coordinates
fixes = {}
for rid, r in runways.items():
    fixes['THR' + rid] = r['thr']


def parse_named_points(text):
    toks = [x.strip() for x in re.split(r'\n|\|', text) if x.strip()]
    out = {}
    for i, tk in enumerate(toks):
        if re.fullmatch(r'[A-Z]{2,5}', tk):
            for j in range(i + 1, min(i + 8, len(toks))):
                s = ' '.join(toks[j:j + 2])
                cm = re.match(COORD, s)
                if cm:
                    c = dms(cm)
                    prec = len(cm[3])
                    if tk not in out or out[tk][1] < prec:
                        out[tk] = (c, prec)
                    break
    return out


def page_text(name):
    path = os.path.join(EAIP, f'EH-{name}-en-GB.html')
    t = open(path, encoding='utf-8', errors='ignore').read()
    t = re.sub(r'(?is)<(script|style).*?</\1>', '', t)
    t = re.sub(r'(?i)<br\s*/?>|</p>|</tr>|</h\d>|</div>', '\n', t)
    t = re.sub(r'(?i)</t[dh]>', ' | ', t)
    t = re.sub(r'<[^>]+>', '', t)
    import html as _h
    return _h.unescape(t)


named = {}
for page in ['ENR 4.4', 'ENR 4.1']:
    for k, (c, prec) in parse_named_points(page_text(page)).items():
        if k not in named or named[k][1] < prec:
            named[k] = (c, prec)

chart_dir = os.path.join(ROOT, 'documents', 'Root_WePub', 'Charts', 'AD', ICAO)
chart_text = ''
for pdf in sorted(glob.glob(os.path.join(chart_dir, '*.pdf'))):
    try:
        chart_text += subprocess.run(['pdftotext', '-layout', pdf, '-'], capture_output=True, text=True, timeout=60).stdout + '\n'
    except Exception as e:  # pragma: no cover
        warnings.append(f'pdftotext failed for {pdf}: {e}')
chart_pts = {}
for m in re.finditer(r'\b([A-Z]{2}\d{3}|[A-Z]{3,5})\s+' + COORD, chart_text):
    sub = re.match(r'([A-Z0-9]+)\s+(.*)', m[0])
    c = coords_in(sub[2])
    if c:
        chart_pts.setdefault(m[1], c[0])
# AD 2.22 text lists ("Waypoints: RD182 RD183 Coordinates: ...")
for m in re.finditer(r'Waypoints?:\s*((?:[A-Z]{2}\d{3}\s*)+)Coordinates?:\s*((?:' + COORD_NC + r'\s*)+)', all_text):
    names = m[1].split()
    cs = coords_in(m[2])
    for n, c in zip(names, cs):
        chart_pts.setdefault(n, c)

used = set()
for p in sids + stars:
    for l in p['legs']:
        if l['t'] == 'FIX':
            used.add(l['fix'])
for r in runways.values():
    a = r.get('approach') or {}
    for seq in list(a.get('transitions', {}).values()) + [a.get('final') or [], a.get('missed') or []]:
        for l in seq:
            if l['t'] == 'FIX':
                used.add(l['fix'])
used |= set(holdings)

# Foreign or chart-only points not in the Dutch ENR tables.
ov_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'overrides.json')
overrides = json.load(open(ov_path)) if os.path.exists(ov_path) else {}
for k, v in overrides.items():
    chart_pts.setdefault(k, coords_in(v)[0])

missing = []
for f in sorted(used):
    if f in fixes:
        continue
    if f in chart_pts:
        fixes[f] = chart_pts[f]
    elif f in named:
        fixes[f] = named[f][0]
    else:
        missing.append(f)
# Prefer high-precision named coordinates over chart labels for 5-letter fixes / navaids.
for f in list(fixes):
    if f in named and named[f][1] >= 1:
        fixes[f] = named[f][0]

# Drop procedures that reference unknown fixes (report them).
def ok(p):
    bad = [l['fix'] for l in p['legs'] if l['t'] == 'FIX' and l['fix'] not in fixes]
    if bad:
        warnings.append(f"{p['name']}: unknown fixes {bad}")
    return not bad


sids = [p for p in sids if ok(p)]
stars = [p for p in stars if ok(p)]

# ------------------------------------------------------------------ TMAs (ENR 2.1)
city = {'EHAM': 'SCHIPHOL', 'EHRD': 'ROTTERDAM'}.get(ICAO, ICAO)
enr21 = re.sub(r'\s+', ' ', page_text('ENR 2.1').replace('|', ' '))
tmas = []
for m in re.finditer(city + r' TMA (\d+) \(\w+\) (.*?)\.\s*(FL \d+|\d+ FT AMSL)\s*(\d+ FT AMSL|FL \d+|GND)\s*Airspace class:\s*([A-G])', enr21):
    pts = coords_in(m[2])
    if len(pts) >= 3:
        tmas.append({'name': f'{city} TMA {m[1]}', 'upper': m[3], 'lower': m[4], 'cls': m[5], 'polygon': pts})

airport.update({
    'runways': runways,
    'sids': sids,
    'stars': stars,
    'holdings': holdings,
    'tmas': tmas,
    'fixes': fixes,
    'source': os.path.basename(os.path.normpath(ROOT)),
})
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(airport, open(OUT, 'w'), indent=1)

print(f'{ICAO}: {len(runways)} runways, {len(sids)} SIDs, {len(stars)} STARs, {len(holdings)} holds, '
      f'{sum(len(r.get("approach", {}).get("transitions", {})) for r in runways.values())} transitions, '
      f'{len(fixes)} fixes, {len(tmas)} TMAs, freqs {freqs}')
if missing:
    print('UNRESOLVED fixes:', missing)
for w in warnings:
    print('WARN', w)
