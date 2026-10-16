"""Build a D'Maps offline dataset (graph, places, render features, manifest) from an OSM PBF.

    python -I -m dmaps_pipeline.build_dataset --pbf region.osm.pbf --id monaco \
        --name "Monaco" --out ../public/data/monaco

PoC scope: single-process, in-memory (suitable for city/province extracts).  Nationwide
scale needs a streaming/partitioned variant -- see docs/data-pipeline.md.  Output is
deterministic: same input PBF + same pipeline version => byte-identical files.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import osmium

from . import profile as P
from .binfmt import write_graph, write_turns
from .turns import Restriction, resolve_turns

PIPELINE_VERSION = "0.1.0"
FORMAT_VERSION = 1
COORD_SCALE = 1_000_000  # features.json delta-encoded integers, 1e-6 degrees (~0.11 m)

EARTH_R = 6_371_008.8


def haversine_m(lat1, lon1, lat2, lon2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R * math.asin(min(1.0, math.sqrt(a)))


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def encode_deltas(coords) -> list[int]:
    """[(lat, lon), ...] -> flat ints: first point absolute, then deltas (1e-6 deg)."""
    out: list[int] = []
    pla = plo = 0
    for i, (la, lo) in enumerate(coords):
        a, b = round(la * COORD_SCALE), round(lo * COORD_SCALE)
        out.extend((a, b) if i == 0 else (a - pla, b - plo))
        pla, plo = a, b
    return out


def decode_deltas(flat) -> list[tuple[float, float]]:
    pts, a, b = [], 0, 0
    for i in range(0, len(flat), 2):
        a, b = (flat[i], flat[i + 1]) if i == 0 else (a + flat[i], b + flat[i + 1])
        pts.append((a / COORD_SCALE, b / COORD_SCALE))
    return pts


class Extractor(osmium.SimpleHandler):
    def __init__(self) -> None:
        super().__init__()
        # routing
        self.route_ways: list[dict] = []     # {osm_nodes, cls, speed, flags, dir, name, ref}
        # rendering
        self.roads: list[tuple[str, list]] = []
        self.buildings: list[list] = []
        self.water: list[list] = []
        self.green: list[list] = []
        self.coast: list[list] = []
        # places
        self.places: list[dict] = []
        self.street_cells: set = set()
        self.node_loc: dict[int, tuple[float, float]] = {}
        self.restrictions = 0                # relations with type=restriction seen
        self.turn_relations: list[Restriction] = []
        self.restriction_unsupported = 0     # type=restriction but no simple car-relevant `restriction` tag
        self.bbox = [90.0, 180.0, -90.0, -180.0]

    # -- helpers ------------------------------------------------------------------
    def _coords(self, w):
        try:
            pts = [(n.lat, n.lon) for n in w.nodes]
        except osmium.InvalidLocationError:
            return None
        return pts if len(pts) >= 2 else None

    def _grow(self, la, lo):
        b = self.bbox
        b[0], b[1], b[2], b[3] = min(b[0], la), min(b[1], lo), max(b[2], la), max(b[3], lo)

    @staticmethod
    def _addr(tags):
        street, num = tags.get("addr:street"), tags.get("addr:housenumber")
        if street and num:
            return f"{street} {num}"
        return street or None

    def _add_place(self, kind, cat, name, la, lo, tags):
        rec = {"n": name, "k": kind, "c": cat, "la": round(la, 6), "lo": round(lo, 6)}
        a = self._addr(tags)
        if a:
            rec["a"] = a
        # OSM hospitals include non-emergency facilities (emergency=no): keep the tag so the
        # UI can tell users which hospitals are mapped as having an emergency department.
        if cat == "hospital" and tags.get("emergency") in ("yes", "no"):
            rec["em"] = tags["emergency"]
        self.places.append(rec)

    # -- callbacks ----------------------------------------------------------------
    def node(self, n):
        t = n.tags
        if not len(t) or not n.location.valid():
            return
        la, lo = n.location.lat, n.location.lon
        place = t.get("place")
        name = P.display_name(t)
        if place in P.PLACE_AREAS and t.get("name"):
            self._add_place("area", "area", t["name"], la, lo, t)
            return
        cat = P.poi_category(t)
        if cat and (name or cat in ("atm", "fuel")):
            self._add_place("poi", cat, name or cat, la, lo, t)
        elif t.get("addr:housenumber") and t.get("addr:street"):
            self._add_place("address", "address", f"{t['addr:street']} {t['addr:housenumber']}", la, lo, t)

    def way(self, w):
        t = w.tags
        if not len(t):
            return
        pts = self._coords(w)
        if pts is None:
            return
        for la, lo in pts:
            self._grow(la, lo)
        closed = w.is_closed()
        hw = t.get("highway")

        if hw:
            self.roads.append((hw, pts))
            cls = P.road_class(t)
            if cls is not None and P.access(t) != "no":
                roundabout = t.get("junction") in ("roundabout", "circular")
                link = hw.endswith("_link")
                direction = P.oneway(t, hw in ("motorway", "motorway_link"), roundabout)
                flags = 0
                if roundabout: flags |= P.FLAG_ROUNDABOUT
                if direction != 0: flags |= P.FLAG_ONEWAY
                if link: flags |= P.FLAG_LINK
                if P.access(t) == "destination": flags |= P.FLAG_DESTINATION
                self.route_ways.append({
                    "id": w.id,
                    "nodes": [(n.ref, n.lat, n.lon) for n in w.nodes],
                    "cls": P.CLASS_ID[cls], "speed": P.speed_kmh(t, cls, link),
                    "flags": flags, "dir": direction,
                    "name": t.get("name"), "ref": t.get("ref"),
                })
                # street search entries: one per (name, ~550 m cell)
                nm = t.get("name")
                if nm and cls != "service":
                    mid = pts[len(pts) // 2]
                    cell = (nm, round(mid[0] / 0.005), round(mid[1] / 0.005))
                    if cell not in self.street_cells:
                        self.street_cells.add(cell)
                        self._add_place("street", "street", nm, mid[0], mid[1], t)

        if t.get("building") and closed and len(pts) >= 4:
            self.buildings.append(pts)
        if closed and len(pts) >= 4:
            if t.get("natural") == "water" or t.get("landuse") == "reservoir":
                self.water.append(pts)
            elif (t.get("leisure") in ("park", "garden", "pitch", "golf_course", "nature_reserve")
                  or t.get("landuse") in ("grass", "forest", "meadow", "village_green", "recreation_ground")
                  or t.get("natural") in ("wood", "scrub", "grassland")):
                self.green.append(pts)
        if t.get("waterway") in ("river", "canal", "stream"):
            self.water.append(pts)
        if t.get("natural") == "coastline":
            self.coast.append(pts)

        # named POI areas (hospital buildings, hotels mapped as ways...)
        cat = P.poi_category(t)
        name = P.display_name(t)
        if cat and name and not hw and closed:
            la = sum(p[0] for p in pts) / len(pts)
            lo = sum(p[1] for p in pts) / len(pts)
            self._add_place("poi", cat, name, la, lo, t)

    def relation(self, r):
        if r.tags.get("type") != "restriction":
            return
        self.restrictions += 1
        kind = P.restriction_kind(r.tags)
        if kind is None or not P.restriction_applies_to_cars(r.tags):
            # conditional / hgv-only / bus-only / car-exempt restrictions do not forbid a turn for cars
            if kind is None:
                self.restriction_unsupported += 1
            return
        from_way = to_way = via_node = None
        via_is_way = False
        for m in r.members:
            if m.role == "from" and m.type == "w":
                from_way = m.ref
            elif m.role == "to" and m.type == "w":
                to_way = m.ref
            elif m.role == "via":
                if m.type == "n":
                    via_node = m.ref
                else:
                    via_is_way = True
        self.turn_relations.append(Restriction(kind[0], kind[1], from_way, via_node, to_way, via_is_way))


def build_graph(route_ways):
    """Compact node numbering + CSR arrays.  Deterministic (sorted by OSM id / edge tuple)."""
    loc: dict[int, tuple[float, float]] = {}
    for w in route_ways:
        for ref, la, lo in w["nodes"]:
            loc[ref] = (la, lo)
    ids = sorted(loc)
    index = {ref: i for i, ref in enumerate(ids)}
    lat1e7 = [round(loc[r][0] * 1e7) for r in ids]
    lon1e7 = [round(loc[r][1] * 1e7) for r in ids]

    way_table: list[list] = []
    edges: list[tuple] = []  # (src, dst, len_dm, way_idx, speed, cls, flags)
    for w in route_ways:
        widx = len(way_table)
        way_table.append([w["name"], w["ref"]])
        pts = w["nodes"]
        for (a_ref, a_la, a_lo), (b_ref, b_la, b_lo) in zip(pts, pts[1:]):
            if a_ref == b_ref:
                continue
            dm = max(1, round(haversine_m(a_la, a_lo, b_la, b_lo) * 10))
            a, b = index[a_ref], index[b_ref]
            if w["dir"] >= 0:
                edges.append((a, b, dm, widx, w["speed"], w["cls"], w["flags"]))
            if w["dir"] <= 0:
                edges.append((b, a, dm, widx, w["speed"], w["cls"], w["flags"]))
    edges.sort()

    n = len(ids)
    first = [0] * (n + 1)
    for e in edges:
        first[e[0] + 1] += 1
    for i in range(n):
        first[i + 1] += first[i]
    cols = list(zip(*edges)) if edges else [[]] * 7
    return {
        "lat": lat1e7, "lon": lon1e7, "first": first, "target": list(cols[1]),
        "len": list(cols[2]), "way": list(cols[3]), "speed": list(cols[4]),
        "cls": list(cols[5]), "flags": list(cols[6]), "ways": way_table, "index": index,
    }


def dump_json(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":"), sort_keys=True), "utf-8")


def build(pbf: Path, out: Path, dataset_id: str, name: str, source_note: str = "") -> dict:
    out.mkdir(parents=True, exist_ok=True)
    ex = Extractor()
    ex.apply_file(str(pbf), locations=True)

    g = build_graph(ex.route_ways)
    graph_path = out / "graph.bin"
    write_graph(graph_path, g["lat"], g["lon"], g["first"], g["target"], g["len"], g["way"],
                g["speed"], g["cls"], g["flags"])
    dump_json(out / "ways.json", g["ways"])
    turn_pairs, turn_stats = resolve_turns(ex.route_ways, ex.turn_relations, g["index"], g["first"], g["target"], g["way"])
    turn_stats["skipped"]["unsupported_or_not_for_cars"] = ex.restriction_unsupported
    write_turns(out / "turns.bin", turn_pairs)

    ex.places.sort(key=lambda p: (p["k"], p["c"], p["n"], p["la"], p["lo"]))
    for i, p in enumerate(ex.places):
        p["i"] = i
    dump_json(out / "places.json", ex.places)

    def poly(items):
        return [encode_deltas(p) for p in items]

    dump_json(out / "features.json", {
        "scale": COORD_SCALE,
        "roads": [[t, encode_deltas(pts)] for t, pts in ex.roads],
        "buildings": poly(ex.buildings), "water": poly(ex.water),
        "green": poly(ex.green), "coast": poly(ex.coast),
    })

    files = []
    # turns.bin is last so that older tooling that knows the first four files keeps its ordering
    for fname in ("graph.bin", "ways.json", "places.json", "features.json", "turns.bin"):
        p = out / fname
        files.append({"name": fname, "bytes": p.stat().st_size, "sha256": sha256_file(p)})
    content_id = hashlib.sha256("".join(f["sha256"] for f in files).encode()).hexdigest()[:12]
    cats: dict[str, int] = {}
    for p in ex.places:
        cats[p["c"]] = cats.get(p["c"], 0) + 1

    manifest = {
        "formatVersion": FORMAT_VERSION, "pipelineVersion": PIPELINE_VERSION,
        "id": dataset_id, "name": name, "dataVersion": content_id,
        "bbox": [round(v, 6) for v in ex.bbox],  # minLat, minLon, maxLat, maxLon
        "source": {"file": pbf.name, "sha256": sha256_file(pbf), "note": source_note},
        "attribution": "© OpenStreetMap contributors (ODbL 1.0)",
        "license": "ODbL-1.0",
        "stats": {"nodes": len(g["lat"]), "edges": len(g["target"]), "ways": len(g["ways"]),
                  "places": len(ex.places), "placesByCategory": cats,
                  "restrictionRelationsSeen": ex.restrictions,
                  "turnRestrictions": turn_stats},
        "profile": {"name": "car", "speedModel": "heuristic class defaults + maxspeed tags"},
        "limitations": [
            "simple turn-restriction relations (via node) are applied; via-way and conditional turn-restriction relations are NOT",
            "snapping uses the nearest graph node, not the nearest edge segment",
            "ETAs use default speeds per road class, not real traffic data",
            "multipolygon relations (e.g. large lakes, sea) are not rendered",
        ],
        "files": files,
    }
    dump_json(out / "manifest.json", manifest)
    return manifest


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pbf", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--id", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--source-note", default="")
    a = ap.parse_args(argv)
    m = build(a.pbf, a.out, a.id, a.name, a.source_note)
    print(json.dumps({"id": m["id"], "dataVersion": m["dataVersion"], "stats": m["stats"],
                      "files": {f["name"]: f["bytes"] for f in m["files"]}}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
