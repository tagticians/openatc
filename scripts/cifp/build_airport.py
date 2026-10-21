#!/usr/bin/env python3
"""Build a game airport file from the FAA CIFP (ARINC 424, public domain).

    python3 scripts/cifp/build_airport.py <FAACIFP18> KSAN > src/data/airports/KSAN.json

Download the current cycle from
https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/cifp/download/

Output follows the same shape as the eAIP builder (EHAM.json): runways with their approach
(transitions, final, missed), SIDs and STARs flattened to fix lists, holdings, airspace
polygons and the coordinates of every fix referenced. Leg types the game does not fly are
mapped to the nearest equivalent:
  IF/TF/CF/DF/RF/AF -> FIX         CA/VA/FA/VI -> CA (course to altitude)
  VM/FM/PI/HM/HA/HF -> end of the procedure (vectors / hold / procedure turn)
"""
import json
import re
import math
import sys
from collections import defaultdict


def col(line, a, b):
    """1-based inclusive column slice, stripped."""
    return line[a - 1 : b].strip()


def latlon(s_lat, s_lon):
    # N32440083 / W117112279: deg mm ss.ss
    if not s_lat or not s_lon:
        return None
    lat = int(s_lat[1:3]) + int(s_lat[3:5]) / 60 + int(s_lat[5:9]) / 360000
    lon = int(s_lon[1:4]) + int(s_lon[4:6]) / 60 + int(s_lon[6:10]) / 360000
    if s_lat[0] == 'S':
        lat = -lat
    if s_lon[0] == 'W':
        lon = -lon
    return [round(lat, 6), round(lon, 6)]


def feet(s):
    s = s.strip()
    if not s:
        return None
    if s.startswith('FL'):
        return int(s[2:]) * 100
    try:
        return int(s)
    except ValueError:
        return None


def bearing(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    y = math.sin(lo2 - lo1) * math.cos(la2)
    x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(lo2 - lo1)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def dist_nm(a, b):
    k = math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot((a[0] - b[0]) * 60, (a[1] - b[1]) * 60 * k)


def main(path, icao):
    lines = [l.rstrip('\n') for l in open(path, encoding='latin-1')]
    apt_prefix = f'SUSAP {icao}'

    # ------------------------------------------------------------ fix database
    enroute, navaid, ndb, terminal = {}, {}, {}, defaultdict(dict)
    for l in lines:
        if l.startswith('SUSAEAENRT'):
            enroute[(col(l, 14, 18), col(l, 20, 21))] = latlon(col(l, 33, 41), col(l, 42, 51))
        elif l.startswith('SUSAD '):
            p = latlon(col(l, 33, 41), col(l, 42, 51)) or latlon(col(l, 56, 64), col(l, 65, 74))
            navaid[(col(l, 14, 17), col(l, 20, 21))] = p
        elif l.startswith('SUSADB'):
            ndb[(col(l, 14, 17), col(l, 20, 21))] = latlon(col(l, 33, 41), col(l, 42, 51))
        elif l.startswith('SUSAP ') and l[12] == 'C':
            terminal[col(l, 7, 10)][col(l, 14, 18)] = latlon(col(l, 33, 41), col(l, 42, 51))
        elif l.startswith('SUSAP ') and l[12] == 'N':
            terminal[col(l, 7, 10)][col(l, 14, 17)] = latlon(col(l, 33, 41), col(l, 42, 51))

    recs = [l for l in lines if l.startswith(apt_prefix)]
    a = next(l for l in recs if l[12] == 'A')
    arp = latlon(col(a, 33, 41), col(a, 42, 51))
    mv = col(a, 52, 56)
    mag_var = (1 if mv[0] == 'E' else -1) * int(mv[1:]) / 10
    elevation = int(col(a, 57, 61))
    trans_alt = feet(col(a, 71, 75)) or 18000
    name = col(a, 94, 123)

    fixes = {}

    def resolve(ident, region, sect):
        if not ident:
            return None
        if ident in fixes:
            return ident
        p = None
        if sect == 'EA':
            p = enroute.get((ident, region))
        elif sect == 'D':
            p = navaid.get((ident, region))
        elif sect == 'DB':
            p = ndb.get((ident, region))
        elif sect in ('PC', 'PN'):
            p = terminal[icao].get(ident)
            if p is None:  # terminal fix filed under a neighbouring airport: take the nearest
                cands = [t[ident] for t in terminal.values() if ident in t]
                p = min(cands, key=lambda q: dist_nm(q, arp)) if cands else None
        elif sect == 'PG':
            p = runways_raw.get(ident[2:], {}).get('thr')
        if p is None:
            p = enroute.get((ident, region)) or navaid.get((ident, region))
        if p is None:  # region code differs (e.g. Mexican fixes): nearest of that name
            cands = [v for (k, _), v in list(enroute.items()) + list(navaid.items()) if k == ident and v]
            p = min(cands, key=lambda q: dist_nm(q, arp)) if cands else None
        if p is None:
            print(f'warning: unresolved fix {ident} {region} {sect}', file=sys.stderr)
            return None
        fixes[ident] = p
        return ident

    # ------------------------------------------------------------ runways and ILS
    runways_raw = {}
    for l in recs:
        if l[12] == 'G':
            rid = col(l, 14, 18)[2:]
            runways_raw[rid] = {
                'id': rid,
                'length_ft': int(col(l, 23, 27)),
                'magBrg': int(col(l, 28, 31)) / 10,
                'thr': latlon(col(l, 33, 41), col(l, 42, 51)),
                'elevation': int(col(l, 67, 71)),
                'displaced_ft': int(col(l, 72, 75) or 0),
                'loc': col(l, 82, 85),
            }
    ils = {}
    for l in recs:
        if l[12] == 'I':
            ident = col(l, 14, 17)
            freq = int(col(l, 23, 27)) / 100
            gs = col(l, 88, 90)  # glide slope angle, hundredths of a degree
            rid = col(l, 28, 32)[2:]
            ils[rid] = {'ident': ident, 'freq': f'{freq:.2f}', 'gs': int(gs) / 100 if gs.isdigit() and int(gs) else None}

    def opposite(rid):
        n = (int(rid[:2]) + 18 - 1) % 36 + 1
        side = {'L': 'R', 'R': 'L', 'C': 'C'}.get(rid[2:], '')
        return f'{n:02d}{side}'

    # ------------------------------------------------------------ procedures
    procs = defaultdict(list)  # (subsection, ident) -> records
    for l in recs:
        if l[12] in 'DEF' and l[38] in '01':
            procs[(l[12], col(l, 14, 19))].append(l)

    def alt_constraint(l):
        d = l[82]
        a1, a2 = feet(col(l, 85, 89)), feet(col(l, 90, 94))
        if a1 is None:
            return None
        if d == '+':
            return {'above': a1}
        if d == '-':
            return {'below': a1}
        if d == 'B':
            return {'below': a1, 'above': a2} if a2 else {'below': a1}
        return {'at': a1}

    holdings = {}

    def legs_of(rows, vectors=False):
        """ARINC legs -> game legs. Returns (legs, meta)."""
        out = []
        meta = {'faf': None, 'iaf': [], 'if': None, 'vda': None, 'rw': None}
        rows = sorted(rows, key=lambda l: int(col(l, 27, 29)))
        for i, l in enumerate(rows):
            pt = col(l, 48, 49)
            fid = col(l, 30, 34)
            region, sect = col(l, 35, 36), (l[36] + l[37]).strip()
            desc = l[39:43]
            crs = col(l, 71, 74)
            crs = round(int(crs) / 10) % 360 if crs.isdigit() else None
            alt = alt_constraint(l)
            spd = col(l, 100, 102)
            vda = col(l, 103, 106)
            if vda.startswith('-') and vda[1:].isdigit():
                meta['vda'] = int(vda[1:]) / 100
            if pt in ('HM', 'HA', 'HF'):
                f = resolve(fid, region, sect)
                if f and crs is not None:
                    holdings[f] = {'inbound': crs, 'turn': l[43] if l[43] in 'LR' else 'R', 'minAlt': (alt or {}).get('at') or (alt or {}).get('above') or 3000}
                break
            if pt in ('VM', 'FM'):
                # Heading (or course) until radar vectors: the aircraft holds it after take-off
                # and the controller turns it towards the route.
                if vectors and crs is not None:
                    out.append({'t': 'VM', 'crs': crs})
                break
            if pt == 'PI':
                break
            if pt in ('CA', 'VA', 'FA'):
                a = feet(col(l, 85, 89)) or 0
                out.append({'t': 'CA', 'crs': crs or 0, 'alt': a})
                continue
            if pt in ('VI', 'CI', 'VD', 'VR', 'CD', 'CR'):
                # Heading/course to an intercept: fly it as course-to-altitude only when it
                # starts the procedure (a turn right after take-off); otherwise go to the next fix.
                if pt in ('VI', 'CI') and crs is not None and not out:
                    out.append({'t': 'CA', 'crs': crs, 'alt': elevation + 500})
                continue
            if not fid:
                continue
            if sect == 'PG':
                meta['rw'] = fid[2:]
                out.append({'t': 'FIX', 'fix': f'THR{fid[2:]}'})
                continue
            f = resolve(fid, region, sect)
            if not f:
                continue
            leg = {'t': 'FIX', 'fix': f}
            if alt:
                leg['alt'] = alt
            if spd.isdigit():
                leg['spd'] = int(spd)
            if desc[1] == 'Y' or desc[1] == 'B':
                leg['flyover'] = True
            if desc[3] == 'F':
                meta['faf'] = f
            if desc[3] == 'A':
                meta['iaf'].append(f)
            if desc[3] == 'I':
                meta['if'] = f
            if out and out[-1].get('fix') == f:  # junction between route parts
                out[-1].update({k: v for k, v in leg.items() if k != 't'})
                continue
            out.append(leg)
        return out, meta

    def split(rows):
        groups = defaultdict(list)
        for l in rows:
            groups[(l[19], col(l, 21, 25))].append(l)
        return groups

    def join(*parts):
        out = []
        for p in parts:
            for leg in p:
                if out and leg['t'] == 'FIX' and out[-1].get('fix') == leg['fix']:
                    out[-1] = {**out[-1], **leg}
                else:
                    out.append(leg)
        return out

    pretty = lambda ident: ident[:-1] + ' ' + ident[-1] if ident[-1].isdigit() else ident

    # STARs: enroute transition + common route; runway transitions become approach transitions.
    stars, star_rwy = [], defaultdict(dict)
    for (sub, ident), rows in sorted(procs.items()):
        if sub != 'E':
            continue
        g = split(rows)
        enr = {tr: legs_of(r)[0] for (rt, tr), r in g.items() if rt in '147'}
        com = [legs_of(r)[0] for (rt, tr), r in g.items() if rt in '258']
        common = com[0] if com else []
        for (rt, tr), r in g.items():
            if rt in '369':
                legs, _ = legs_of(r)
                rw = tr[2:]
                targets = [k for k in runways_raw if k == rw or (rw.endswith('B') and k.startswith(rw[:2]))]
                for t in targets:
                    if legs and legs[0]['t'] == 'FIX':
                        star_rwy[t][legs[0]['fix']] = legs
        for tr, legs in (enr.items() or [('', [])]):
            full = join(legs, common)
            if len([x for x in full if x['t'] == 'FIX']) >= 2:
                stars.append({'name': pretty(ident), 'ident': ident, 'transition': tr, 'legs': full})

    # SIDs: runway transition + common + enroute transition.
    sids = []
    for (sub, ident), rows in sorted(procs.items()):
        if sub != 'D':
            continue
        g = split(rows)
        rwys = defaultdict(list)
        common = []
        enr = {}
        for (rt, tr), r in g.items():
            legs, _ = legs_of(r, vectors=True)
            if tr.startswith('RW'):
                rw = tr[2:]
                for k in runways_raw:
                    if k == rw or (rw.endswith('B') and k.startswith(rw[:2])) or rw == 'ALL':
                        rwys[k].append(legs)
            elif rt in '258':
                common = legs
            elif rt in '369':
                enr[tr] = legs
        for rw, parts in rwys.items():
            for tr, e in (enr.items() or [('', [])]):
                legs = join(*parts, common, e)
                if not legs:
                    continue
                sids.append({'name': pretty(ident), 'ident': ident, 'runway': rw, 'transition': tr, 'legs': legs})

    # Approaches: one per runway, preferring ILS, then LOC, then RNAV.
    approaches = {}
    for (sub, ident), rows in procs.items():
        if sub != 'F':
            continue
        kind = ident[0]
        rw = ''.join(c for c in ident[1:].split('-')[0])
        if rw not in runways_raw:
            continue
        rank = {'I': 0, 'L': 1, 'R': 2, 'H': 3}.get(kind)
        if rank is None:
            continue
        g = split(rows)
        finals = [r for (rt, tr), r in g.items() if rt != 'A']
        if not finals:
            continue
        legs, meta = legs_of(finals[0])
        try:
            rw_idx = next(i for i, x in enumerate(legs) if x.get('fix') == f'THR{rw}')
        except StopIteration:
            continue
        final, missed = legs[: rw_idx + 1], legs[rw_idx + 1 :]
        trans = {}
        for (rt, tr), r in g.items():
            if rt == 'A':
                tl, _ = legs_of(r)
                if tl and tl[0]['t'] == 'FIX':
                    trans[tl[0]['fix']] = tl
        cand = {'ident': ident, 'rank': rank, 'final': final, 'missed': missed, 'transitions': trans, 'faf': meta['faf'], 'if': meta['if'] or (final[0].get('fix') if final else None), 'vda': meta['vda']}
        cur = approaches.get(rw)
        if not cur or (rank, ident) < (cur['rank'], cur['ident']):
            # Keep transitions from every approach to this runway (RNP arcs, LOC, ILS).
            if cur:
                cand['transitions'] = {**cur['transitions'], **cand['transitions']}
            approaches[rw] = cand
        else:
            cur['transitions'] = {**trans, **cur['transitions']}

    runways = {}
    for rid, r in runways_raw.items():
        opp = runways_raw.get(opposite(rid))
        end = opp['thr'] if opp else r['thr']
        thr = r['thr']
        fixes[f'THR{rid}'] = thr
        ap = approaches.get(rid)
        il = ils.get(rid)
        rw = {
            'id': rid,
            'trueHdg': round(bearing(thr, end), 2),
            'length': round(r['length_ft'] * 0.3048),
            'thr': thr,
            'end': end,
            'elevation': r['elevation'],
            'displaced': r['displaced_ft'],
        }
        if il:
            rw['ils'] = {'ident': il['ident'], 'freq': il['freq']}
            rw['locOnly'] = not il['gs']
        if ap:
            gp = (il or {}).get('gs') or ap['vda'] or 3.0
            rw['gpAngle'] = gp
            transitions = {**ap['transitions'], **star_rwy.get(rid, {})}
            # Transitions that join the final elsewhere (RNP arcs) continue to the FAF.
            final_fixes = [x.get('fix') for x in ap['final']]
            for k, tl in transitions.items():
                last = tl[-1].get('fix') if tl else None
                if last not in (ap['if'], ap['faf']) and ap['faf']:
                    transitions[k] = tl + [x for x in ap['final'] if x.get('fix') == ap['faf']]
            rw['approach'] = {'ident': ap['ident'], 'transitions': transitions, 'final': ap['final'], 'missed': ap['missed'], 'ifix': ap['if'], 'faf': ap['faf']}
        runways[rid] = rw

    # Arrivals hold at the end of their STAR when not yet cleared: publish-style holds there
    # (inbound along the STAR's last leg, right turns), unless a real one exists.
    for st in stars:
        fx = [x for x in st['legs'] if x['t'] == 'FIX']
        if len(fx) < 2 or fx[-1]['fix'] in holdings:
            continue
        a, b = fixes[fx[-2]['fix']], fixes[fx[-1]['fix']]
        alt = fx[-1].get('alt') or {}
        holdings[fx[-1]['fix']] = {'inbound': round((bearing(a, b) - mag_var) % 360), 'turn': 'R', 'minAlt': alt.get('at') or alt.get('above') or alt.get('below') or 6000, 'synthetic': True}

    # Make sure every fix a STAR/SID/approach mentions exists (runway thresholds included).
    for p in stars + sids:
        p['legs'] = [x for x in p['legs'] if x['t'] != 'FIX' or x['fix'] in fixes]

    # ------------------------------------------------------------ airspace (Class B/C around the airport)
    airspace = []
    def polygons(rows_iter, group_key):
        shells = []
        for l in sorted(rows_iter, key=lambda l: (group_key(l), l[19], int(col(l, 21, 24)))):
            if col(l, 82, 86) or not shells or (group_key(shells[-1][0]), shells[-1][0][19]) != (group_key(l), l[19]):
                shells.append([])
            shells[-1].append(l)
        return shells

    shells = []
    for l in sorted((l for l in lines if l.startswith('SUSAUC') and col(l, 10, 13) == icao), key=lambda l: (l[19], int(col(l, 21, 24)))):
        # A new polygon starts on the record that carries the vertical limits.
        if col(l, 82, 86) or not shells or shells[-1][0][19] != l[19]:
            shells.append([])
        shells[-1].append(l)
    for rows in shells:
        key = rows[0][19]
        first = rows[0]
        lower = col(first, 82, 86)
        upper = col(first, 88, 92)
        nm = col(first, 94, 123)
        pts = []
        for i, l in enumerate(rows):
            via = l[30]
            p = latlon(col(l, 33, 41), col(l, 42, 51))
            nxt = latlon(col(rows[(i + 1) % len(rows)], 33, 41), col(rows[(i + 1) % len(rows)], 42, 51))
            if via == 'C':
                c = latlon(col(l, 52, 60), col(l, 61, 70))
                rad = int(col(l, 71, 74)) / 10
                k = math.cos(math.radians(c[0]))
                for a in range(0, 361, 5):
                    t = math.radians(a)
                    pts.append([c[0] + rad / 60 * math.cos(t), c[1] + rad / 60 * math.sin(t) / k])
                continue
            if p:
                pts.append(p)
            if via in ('R', 'L') and p and nxt:
                c = latlon(col(l, 52, 60), col(l, 61, 70))
                rad = int(col(l, 71, 74)) / 10
                k = math.cos(math.radians(c[0]))
                b0, b1 = bearing(c, p), bearing(c, nxt)
                sweep = (b1 - b0) % 360 if via == 'R' else -((b0 - b1) % 360)
                n = max(2, int(abs(sweep) / 5))
                for j in range(1, n):
                    t = math.radians(b0 + sweep * j / n)
                    pts.append([c[0] + rad / 60 * math.cos(t), c[1] + rad / 60 * math.sin(t) / k])
        pts = [[round(x, 5), round(y, 5)] for x, y in pts]
        airspace.append({'name': nm or f'{icao} {key}', 'cls': col(first, 17, 17) or 'B', 'lower': f'{feet(lower) or 0}', 'upper': f'{feet(upper) or 0}', 'polygon': pts})

    # Prohibited / restricted areas near the airport (e.g. P-56 over the White House).
    restricted = []
    rest_rows = [l for l in lines if l.startswith('SUSAUR') and l[8] in 'PR' and (latlon(col(l, 33, 41), col(l, 42, 51)) or latlon(col(l, 52, 60), col(l, 61, 70)))]
    for rows in polygons(rest_rows, lambda l: col(l, 9, 19)):
        pts = []
        for i, l in enumerate(rows):
            via = l[30]
            p = latlon(col(l, 33, 41), col(l, 42, 51))
            nxt = latlon(col(rows[(i + 1) % len(rows)], 33, 41), col(rows[(i + 1) % len(rows)], 42, 51))
            if via == 'C':
                c = latlon(col(l, 52, 60), col(l, 61, 70)) or p
                rad = int(col(l, 71, 74) or 0) / 10
                k = math.cos(math.radians(c[0]))
                pts += [[c[0] + rad / 60 * math.cos(math.radians(a)), c[1] + rad / 60 * math.sin(math.radians(a)) / k] for a in range(0, 361, 10)]
                continue
            if p:
                pts.append(p)
            if via in ('R', 'L') and p and nxt:
                c = latlon(col(l, 52, 60), col(l, 61, 70))
                rad = int(col(l, 71, 74)) / 10
                k = math.cos(math.radians(c[0]))
                b0, b1 = bearing(c, p), bearing(c, nxt)
                sweep = (b1 - b0) % 360 if via == 'R' else -((b0 - b1) % 360)
                n = max(2, int(abs(sweep) / 5))
                pts += [[c[0] + rad / 60 * math.cos(math.radians(b0 + sweep * j / n)), c[1] + rad / 60 * math.sin(math.radians(b0 + sweep * j / n)) / k] for j in range(1, n)]
        if not pts or min(dist_nm(q, arp) for q in pts) > 25:
            continue
        first = rows[0]
        restricted.append({'name': (col(first, 94, 123) or (first[8] + '-' + col(first, 10, 19))) + (first[19] if first[19] != 'A' else ''), 'cls': first[8], 'lower': col(first, 82, 86), 'upper': col(first, 88, 92), 'polygon': [[round(x, 5), round(y, 5)] for x, y in pts]})

    json.dump(
        {
            'icao': icao,
            'name': name,
            'arp': arp,
            'elevation': elevation,
            'magVar': mag_var,
            'transitionAltitude': trans_alt,
            'runways': runways,
            'sids': sids,
            'stars': stars,
            'holdings': holdings,
            'airspace': airspace,
            'restricted': restricted,
            'fixes': fixes,
            'source': 'FAA CIFP cycle ' + (re.search(r'(\d{4})\s+\d{2}-[A-Z]{3}-\d{4}', lines[0]) or [None, '?'])[1],
        },
        sys.stdout,
        indent=1,
    )


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
