#!/usr/bin/env python3
"""Measure a built D'Maps dataset: size per component (raw and gzip) and per-unit ratios.

    python3 -I scripts/measure_dataset.py public/data/monaco [more dataset dirs...]

Prints a Markdown table plus JSON (last line) so results can be pasted into
docs/measurements.md.  Run it on every real regional dataset you build; it is the
source of truth for storage planning.  Nothing here estimates -- it only reports bytes
that exist on disk.

Component mapping (see docs/architecture.md):
    routing graph : graph.bin, ways.json, turns.bin
    place search  : places.json
    map rendering : features.json   (PoC vector format; replaced by PMTiles for large regions)
"""
from __future__ import annotations

import gzip
import json
import sys
from pathlib import Path

COMPONENT = {
    "graph.bin": "routing graph",
    "ways.json": "routing graph",
    "turns.bin": "routing graph",
    "places.json": "place search",
    "features.json": "map rendering",
}


def gz_size(path: Path) -> int:
    return len(gzip.compress(path.read_bytes(), compresslevel=9, mtime=0))


def measure(d: Path) -> dict:
    manifest = json.loads((d / "manifest.json").read_text("utf-8"))
    stats = manifest["stats"]
    files = []
    for f in manifest["files"]:
        p = d / f["name"]
        raw = p.stat().st_size
        if raw != f["bytes"]:
            raise SystemExit(f"{p}: size on disk {raw} != manifest {f['bytes']}")
        files.append({"name": f["name"], "component": COMPONENT.get(f["name"], "other"),
                      "raw": raw, "gzip": gz_size(p)})
    comp: dict[str, dict[str, int]] = {}
    for f in files:
        c = comp.setdefault(f["component"], {"raw": 0, "gzip": 0})
        c["raw"] += f["raw"]
        c["gzip"] += f["gzip"]
    edges, nodes, places = stats["edges"], stats["nodes"], stats["places"]
    graph_raw = next(f["raw"] for f in files if f["name"] == "graph.bin")
    # In-memory footprint of the routing engine, derived from the typed arrays in
    # src/routing (graph.ts, astar.ts, spatial.ts, engine.ts).  Formula, not a measurement:
    #   per edge: target4 + lenDm4 + way4 + speed1 + cls1 + flags1 + source4          = 19 B
    #   per node: lat4 + lon4 + first4 + cost8 + prevEdge4 + prevState4 + stamp4 + closed4
    #             + hasIn1 + grid cellNodes4                                         = 41 B
    #   plus, per edge that is the incoming side of a forbidden turn: ~1 B bitset share + one
    #   search state (24 B) + its forbidden list -- small, proportional to the restriction count
    # (the lazily-built reverse index adds 8 B/edge, and is not used by the A* router)
    mem = edges * 19 + nodes * 41
    return {
        "id": manifest["id"], "dataVersion": manifest["dataVersion"],
        "nodes": nodes, "edges": edges, "places": places,
        "files": files, "components": comp,
        "total": {"raw": sum(f["raw"] for f in files), "gzip": sum(f["gzip"] for f in files)},
        "ratios": {
            "graph_bin_bytes_per_edge": round(graph_raw / edges, 2),
            "places_json_bytes_per_place": round(next(f["raw"] for f in files if f["name"] == "places.json") / places, 1),
        },
        "router_memory_formula_bytes": mem,
    }


def mb(n: int) -> str:
    return f"{n / 1e6:.2f} MB"


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    results = [measure(Path(a)) for a in argv]
    for r in results:
        print(f"\n### {r['id']} (dataVersion {r['dataVersion']}): "
              f"{r['nodes']:,} nodes, {r['edges']:,} edges, {r['places']:,} places\n")
        print("| File | Component | Raw | gzip -9 |")
        print("|---|---|---:|---:|")
        for f in r["files"]:
            print(f"| {f['name']} | {f['component']} | {mb(f['raw'])} | {mb(f['gzip'])} |")
        print("\n| Component | Raw | gzip -9 |")
        print("|---|---:|---:|")
        for name, c in r["components"].items():
            print(f"| {name} | {mb(c['raw'])} | {mb(c['gzip'])} |")
        print(f"| **total** | **{mb(r['total']['raw'])}** | **{mb(r['total']['gzip'])}** |")
        print(f"\ngraph.bin: {r['ratios']['graph_bin_bytes_per_edge']} B/edge; "
              f"places.json: {r['ratios']['places_json_bytes_per_place']} B/place; "
              f"router in-memory (formula): {mb(r['router_memory_formula_bytes'])}")
    print(json.dumps(results, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
