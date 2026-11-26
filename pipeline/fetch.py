import json, os, sys, urllib.request, urllib.parse, concurrent.futures as cf
OUT = os.path.join(os.path.dirname(__file__), "..", "raw")
BOX = "40.6995,-74.0200,40.7690,-73.9580"  # within_box(lat_n, lon_w, lat_s, lon_e) ordering handled below
N, W, S, E = 40.7690, -74.0200, 40.6995, -73.9580
def get(ds, where, select=None, page=50000):
    rows, off = [], 0
    while True:
        q = {"$where": where, "$limit": page, "$offset": off, "$order": ":id"}
        if select: q["$select"] = select
        url = f"https://data.cityofnewyork.us/resource/{ds}.json?" + urllib.parse.urlencode(q)
        r = json.load(urllib.request.urlopen(url, timeout=300))
        rows += r; off += page
        print(ds, len(rows), flush=True)
        if len(r) < page: return rows
box = f"within_box(the_geom,{N},{W},{S},{E})"
jobs = {
  "buildings": ("5zhs-2jue", box, "the_geom,height_roof,ground_elevation,construction_year,feature_code,bin"),
  "streets": ("inkn-q76z", box + " AND boroughcode='1'", "the_geom,trafdir,rw_type,streetwidth,full_street_name,number_travel_lanes,from_level_code,to_level_code,posted_speed,physicalid"),
}
def run(k):
    ds, w, s = jobs[k]
    json.dump(get(ds, w, s), open(os.path.join(OUT, k + ".json"), "w"))
with cf.ThreadPoolExecutor(4) as ex: list(ex.map(run, jobs))
