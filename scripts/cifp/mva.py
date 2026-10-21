#!/usr/bin/env python3
"""Extract FAA Minimum Vectoring Altitude (MVA) sectors from an AIXM 5.1 file.

Source files: https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/mva_mia/mva/
(e.g. https://aeronav.faa.gov/MVA_Charts/aixm/SCT_MVA_FUS3.xml). FAA data, US public domain.
NOT FOR NAVIGATION.

Usage:
    python3 -I scripts/cifp/mva.py <aixm.xml> <lat> <lon> <radiusNM> [toleranceDeg] > out.json

Output: JSON array of {"alt": <ft MSL int>, "polygon": [[lat, lon], ...]} for every
MVA sector whose polygon comes within radiusNM of (lat, lon). Polygons are simplified
with Douglas-Peucker (default tolerance 0.002 deg). Interior rings (holes) are dropped
and only the exterior ring is kept; the hole is normally covered by its own sector
(with a different altitude), so draw/lookup sectors so that the highest or innermost
sector wins, or test point-in-polygon against all sectors and take the max alt.
Stats go to stderr.
"""
import json
import math
import sys
import xml.etree.ElementTree as ET

GML = "http://www.opengis.net/gml/3.2"
AIXM = "http://www.aixm.aero/schema/5.1"


def q(ns, tag):
    return "{%s}%s" % (ns, tag)


def parse_poslist(text):
    vals = [float(v) for v in text.split()]
    # srsName CRS84 => lon lat order
    return [(vals[i + 1], vals[i]) for i in range(0, len(vals) - 1, 2)]


def parse(path):
    tree = ET.parse(path)
    sectors = []
    holes_dropped = 0
    for airspace in tree.iter(q(AIXM, "Airspace")):
        name_el = airspace.find(".//" + q(AIXM, "name"))
        name = name_el.text if name_el is not None else None
        for vol in airspace.iter(q(AIXM, "AirspaceVolume")):
            lim = vol.find(q(AIXM, "minimumLimit"))
            ref = vol.find(q(AIXM, "minimumLimitReference"))
            if lim is None or lim.text is None:
                continue
            alt = float(lim.text)
            uom = (lim.get("uom") or "FT").upper()
            if uom == "FL":
                alt *= 100
            elif uom == "M":
                alt /= 0.3048
            if ref is not None and ref.text and ref.text.strip() != "MSL":
                print("warning: %s reference %s" % (name, ref.text), file=sys.stderr)
            for patch in vol.iter(q(GML, "PolygonPatch")):
                ext = patch.find(q(GML, "exterior"))
                if ext is None:
                    continue
                pl = ext.find(".//" + q(GML, "posList"))
                if pl is None or not pl.text:
                    continue
                holes_dropped += len(patch.findall(q(GML, "interior")))
                sectors.append({"name": name, "alt": int(round(alt)), "ring": parse_poslist(pl.text)})
    return sectors, holes_dropped


def make_proj(lat0, lon0):
    kx = 60.0 * math.cos(math.radians(lat0))

    def proj(p):
        return ((p[1] - lon0) * kx, (p[0] - lat0) * 60.0)

    return proj


def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    L = dx * dx + dy * dy
    t = 0.0 if L == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def point_in_ring(x, y, pts):
    inside = False
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            if x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
                inside = not inside
    return inside


def dist_to_ring_nm(ring, proj):
    pts = [proj(p) for p in ring]
    if point_in_ring(0.0, 0.0, pts):
        return 0.0
    return min(seg_dist(0.0, 0.0, *pts[i], *pts[(i + 1) % len(pts)]) for i in range(len(pts)))


def dp(points, tol):
    if len(points) < 3:
        return list(points)
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        s, e = stack.pop()
        (ay, ax), (by, bx) = points[s], points[e]
        best, idx = -1.0, -1
        for i in range(s + 1, e):
            d = seg_dist(points[i][1], points[i][0], ax, ay, bx, by)
            if d > best:
                best, idx = d, i
        if idx >= 0 and best > tol:
            keep[idx] = True
            stack.append((s, idx))
            stack.append((idx, e))
    return [p for p, k in zip(points, keep) if k]


def simplify_ring(ring, tol):
    pts = list(ring)
    if pts[0] == pts[-1]:
        pts = pts[:-1]
    if len(pts) < 4:
        return pts + [pts[0]]
    # split the closed ring at the vertex farthest from the first one so DP has two anchors
    a = pts[0]
    far = max(range(len(pts)), key=lambda i: (pts[i][0] - a[0]) ** 2 + (pts[i][1] - a[1]) ** 2)
    out = dp(pts[: far + 1], tol)[:-1] + dp(pts[far:] + [pts[0]], tol)[:-1]
    if len(out) < 3:
        out = pts
    return out + [out[0]]


def main(argv):
    if len(argv) < 5:
        print(__doc__, file=sys.stderr)
        return 2
    path, lat, lon, radius = argv[1], float(argv[2]), float(argv[3]), float(argv[4])
    tol = float(argv[5]) if len(argv) > 5 else 0.002
    sectors, holes = parse(path)
    proj = make_proj(lat, lon)
    out = []
    raw_pts = 0
    for s in sectors:
        d = dist_to_ring_nm(s["ring"], proj)
        if d > radius:
            continue
        raw_pts += len(s["ring"])
        ring = simplify_ring(s["ring"], tol)
        poly = [[round(p[0], 5), round(p[1], 5)] for p in ring]
        out.append({"alt": s["alt"], "polygon": poly, "_name": s["name"], "_dist": d})
    out.sort(key=lambda r: (r["alt"], r["_name"] or ""))
    pts = sum(len(r["polygon"]) for r in out)
    alts = [r["alt"] for r in out]
    print(
        "sectors in file: %d, interior rings dropped (file-wide): %d; selected %d sectors within %.0f NM; "
        "points %d -> %d; alt range %s-%s ft"
        % (len(sectors), holes, len(out), radius, raw_pts, pts, min(alts) if alts else "-", max(alts) if alts else "-"),
        file=sys.stderr,
    )
    for r in out:
        print("  %-8s %6d ft  dist %5.1f NM  %d pts" % (r["_name"], r["alt"], r["_dist"], len(r["polygon"])), file=sys.stderr)
    res = [{"alt": r["alt"], "polygon": r["polygon"]} for r in out]
    sys.stdout.write(json.dumps(res, separators=(",", ":")))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
