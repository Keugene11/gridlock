# -*- coding: utf-8 -*-
"""Bakes NYC open data into compact game-world files in web/public/world/."""
import json, os, math, struct, csv
from shapely.geometry import shape, Polygon, MultiPolygon
from shapely.ops import transform

ROOT = os.path.join(os.path.dirname(__file__), "..")
RAW, GRAW = os.path.join(ROOT, "raw"), os.path.join(ROOT, "..", "random_project", "raw")
OUT = os.path.join(ROOT, "web", "public", "world")
os.makedirs(OUT, exist_ok=True)
LAT0, LON0 = 40.7342, -73.9890
KX, KY = math.cos(math.radians(LAT0)) * 111320.0, 110540.0
N, W, S, E = 40.7690, -74.0200, 40.6995, -73.9580


def xy(lon, lat):  # x east, z south (three.js convention: north = -z)
    return ((lon - LON0) * KX, -(lat - LAT0) * KY)


def tf(geom):
    return transform(lambda x, y, z=None: xy(x, y), geom)


BOXM = Polygon([xy(W, N), xy(E, N), xy(E, S), xy(W, S)])
BIG = BOXM.buffer(2500, join_style=2)
FT = 0.3048
Q = 4.0  # int16 at 0.25 m

# ---------- buildings ----------
blds = json.load(open(os.path.join(RAW, "buildings.json")))
out = []
for b in blds:
    try:
        g = tf(shape(b["the_geom"]))
    except Exception:
        continue
    raw_h = float(b.get("height_roof") or 0)
    h = raw_h * FT
    if h < 2.5:
        h = 4.0
    if h > 480:
        continue
    yr = int(float(b.get("construction_year") or 0) or 0)
    for p in (g.geoms if isinstance(g, MultiPolygon) else [g]):
        if p.area < 8:
            continue
        p = p.simplify(0.25, preserve_topology=True)
        if p.is_empty or p.area < 8 or p.geom_type != "Polygon":
            continue
        ring = list(p.exterior.coords)[:-1]
        if len(ring) < 3 or len(ring) > 1000:
            continue
        if Polygon(ring).exterior.is_ccw:
            ring = ring[::-1]
        out.append((ring, h, yr))
buf = bytearray(struct.pack("<I", len(out)))
for ring, h, yr in out:
    buf += struct.pack("<HHH", len(ring), min(65535, int(h * 10)), yr)
    for x, z in ring:
        buf += struct.pack("<hh", int(round(x * Q)), int(round(z * Q)))
open(os.path.join(OUT, "buildings.bin"), "wb").write(buf)
print("buildings", len(out), len(buf) // 1024, "KB")

# ---------- streets -> graph ----------
st = json.load(open(os.path.join(RAW, "streets.json")))
nodes, nidx, edges = [], {}, []


def node(x, z):
    k = (round(x / 1.5), round(z / 1.5))
    for dx in (-1, 0, 1):
        for dz in (-1, 0, 1):
            kk = (k[0] + dx, k[1] + dz)
            if kk in nidx:
                i = nidx[kk]
                nx, nz = nodes[i]
                if (nx - x) ** 2 + (nz - z) ** 2 < 2.25:
                    return i
    nidx[k] = len(nodes)
    nodes.append((x, z))
    return nidx[k]


for r in st:
    if r.get("rw_type") not in ("1", "2"):
        continue
    if r.get("from_level_code") != "13" or r.get("to_level_code") != "13":
        continue
    td = r.get("trafdir")
    if td not in ("FT", "TF", "TW"):
        continue
    try:
        g = tf(shape(r["the_geom"]))
    except Exception:
        continue
    for ln in (g.geoms if g.geom_type == "MultiLineString" else [g]):
        ln = ln.simplify(0.5)
        pts = [(x, z) for x, z in ln.coords]
        if len(pts) < 2 or ln.length < 3:
            continue
        w = float(r.get("streetwidth") or 0) * FT
        name = " ".join((r.get("full_street_name") or "").split())
        if not w:
            w = 18 if r["rw_type"] == "2" else 9
        w = max(6.0, min(w, 30.0))
        lanes = int(r.get("number_travel_lanes") or 0) or max(1, int(w // 4.5))
        a, bb = node(*pts[0]), node(*pts[-1])
        if a == bb:
            continue
        pts[0], pts[-1] = nodes[a], nodes[bb]
        dirc = {"TW": 0, "FT": 1, "TF": -1}[td]
        edges.append({"a": a, "b": bb, "p": [round(c, 1) for pt in pts for c in pt],
                      "w": round(w, 1), "d": dirc, "l": max(1, min(lanes, 6)), "n": name,
                      "hw": 1 if r["rw_type"] == "2" else 0, "s": int(r.get("posted_speed") or 25)})
json.dump({"nodes": [[round(x, 1), round(z, 1)] for x, z in nodes], "edges": edges},
          open(os.path.join(OUT, "roads.json"), "w"), separators=(",", ":"))
print("roads", len(nodes), "nodes", len(edges), "edges")


# ---------- land, parks ----------
def rings(geom, tol):
    res = []
    geom = geom.simplify(tol, preserve_topology=True)
    for p in (geom.geoms if hasattr(geom, "geoms") else [geom]):
        if p.geom_type != "Polygon" or p.area < 50:
            continue
        ext = [round(c, 1) for pt in p.exterior.coords[:-1] for c in pt]
        holes = [[round(c, 1) for pt in h.coords[:-1] for c in pt] for h in p.interiors if Polygon(h).area > 200]
        res.append([ext] + holes)
    return res


boro = json.load(open(os.path.join(GRAW, "boro.geojson")))
land = []
for f in boro["features"]:
    g = tf(shape(f["geometry"])).buffer(0).intersection(BIG)
    if not g.is_empty:
        land += rings(g, 1.5)
# New Jersey isn't in NYC data: approximate the Hudson's west bank as a land band.
nj = [xy(*c) for c in [(-74.0600, 40.6900), (-74.0330, 40.7000), (-74.0300, 40.7100), (-74.0335, 40.7180),
                       (-74.0320, 40.7300), (-74.0275, 40.7400), (-74.0250, 40.7520), (-74.0200, 40.7600),
                       (-74.0130, 40.7700), (-74.0050, 40.7850), (-74.0600, 40.7900)]]
land += rings(Polygon(nj).intersection(BIG), 1.5)
parks = json.load(open(os.path.join(GRAW, "parks.geojson")))
pk = []
for f in parks["features"]:
    try:
        g = tf(shape(f["geometry"])).buffer(0)
    except Exception:
        continue
    if not g.intersects(BIG):
        continue
    g = g.intersection(BIG)
    if g.area < 400:
        continue
    pk += rings(g, 0.8)
json.dump({"land": land, "parks": pk}, open(os.path.join(OUT, "land.json"), "w"), separators=(",", ":"))
print("land", len(land), "parks", len(pk))

# ---------- trees ----------
tr = []
with open(os.path.join(GRAW, "trees.csv"), encoding="utf-8") as fh:
    for r in csv.DictReader(fh):
        try:
            lat, lon = float(r["latitude"]), float(r["longitude"])
        except Exception:
            continue
        if not (S - 0.01 < lat < N + 0.01 and W - 0.01 < lon < E + 0.01):
            continue
        x, z = xy(lon, lat)
        sp = (r["spc_common"] or "").lower()
        kind = 1 if ("pine" in sp or "spruce" in sp or "cedar" in sp) else (2 if ("locust" in sp or "pear" in sp) else 0)
        tr += [int(round(x * 2)), int(round(z * 2)), kind]
open(os.path.join(OUT, "trees.bin"), "wb").write(struct.pack("<I", len(tr) // 3) + struct.pack(f"<{len(tr)}i", *tr))
print("trees", len(tr) // 3)

# ---------- places (fares + map labels) ----------
P = [("Empire State Building", -73.9857, 40.7484), ("Times Square", -73.9855, 40.7580), ("Grand Central", -73.9772, 40.7527),
     ("Flatiron Building", -73.9897, 40.7411), ("Washington Square Park", -73.9973, 40.7308), ("Union Square", -73.9903, 40.7359),
     ("Penn Station", -73.9935, 40.7506), ("Bryant Park", -73.9832, 40.7536), ("Rockefeller Center", -73.9787, 40.7587),
     ("Wall Street", -74.0090, 40.7060), ("One World Trade", -74.0131, 40.7127), ("Chinatown", -73.9970, 40.7158),
     ("SoHo", -74.0000, 40.7233), ("Chelsea Market", -74.0060, 40.7424), ("Hudson Yards", -74.0020, 40.7536),
     ("Columbus Circle", -73.9819, 40.7681), ("Carnegie Hall", -73.9799, 40.7651), ("Madison Square Garden", -73.9934, 40.7505),
     ("Tompkins Square Park", -73.9818, 40.7265), ("Battery Park", -74.0156, 40.7033), ("City Hall", -74.0060, 40.7128),
     ("Little Italy", -73.9977, 40.7191), ("Stuyvesant Town", -73.9776, 40.7316), ("United Nations", -73.9680, 40.7489),
     ("Lower East Side", -73.9880, 40.7150), ("Tribeca", -74.0090, 40.7163), ("West Village", -74.0040, 40.7347),
     ("Koreatown", -73.9873, 40.7477), ("Kips Bay", -73.9780, 40.7420), ("Chrysler Building", -73.9755, 40.7516)]
json.dump([{"n": n, "x": round(xy(lo, la)[0], 1), "z": round(xy(lo, la)[1], 1)} for n, lo, la in P],
          open(os.path.join(OUT, "places.json"), "w"))
print("done")
