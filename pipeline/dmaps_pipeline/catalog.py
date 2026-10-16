"""Build the region catalog (public/data/catalog.json) that the Offline Map Manager lists.

    python -I -m dmaps_pipeline.catalog --data ../public/data --regions ../data/regions.json

Every dataset directory containing a manifest.json is listed under the parent group given in
regions.json.  A dataset that is not attached to a known group is an error (it would otherwise be
invisible in the app).  Groups with no datasets are kept on purpose: the app then says honestly that
nothing is available for that area yet, instead of hiding it.  Output is deterministic.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

CATALOG_FORMAT = 1


class CatalogError(ValueError):
    pass


def build_catalog(data_dir: Path, regions_file: Path) -> dict:
    cfg = json.loads(regions_file.read_text("utf-8"))
    groups = cfg.get("groups", [])
    attach = cfg.get("datasets", {})
    group_ids = {g["id"] for g in groups}
    if len(group_ids) != len(groups):
        raise CatalogError("duplicate group id in regions.json")
    for g in groups:
        if g.get("parent") is not None and g["parent"] not in group_ids:
            raise CatalogError(f"group {g['id']!r} has unknown parent {g['parent']!r}")

    regions: list[dict] = []
    for g in groups:
        entry = {"id": g["id"], "kind": "group", "parent": g.get("parent"), "name": g["name"]}
        if "names" in g:
            entry["names"] = g["names"]
        if g.get("testFixture"):
            entry["testFixture"] = True
        regions.append(entry)

    seen_ids = set(group_ids)
    for mf in sorted(data_dir.glob("*/manifest.json")):
        m = json.loads(mf.read_text("utf-8"))
        ds_id = m["id"]
        if mf.parent.name != ds_id:
            raise CatalogError(f"{mf}: directory name must equal manifest id {ds_id!r}")
        if ds_id in seen_ids:
            raise CatalogError(f"id {ds_id!r} is used twice (group and dataset?)")
        seen_ids.add(ds_id)
        a = attach.get(ds_id)
        if a is None:
            raise CatalogError(f"dataset {ds_id!r} is not attached to any group in regions.json")
        if a["parent"] not in group_ids:
            raise CatalogError(f"dataset {ds_id!r}: unknown parent group {a['parent']!r}")
        files = [{"name": f["name"], "bytes": f["bytes"], "sha256": f["sha256"]} for f in m["files"]]
        entry = {
            "id": ds_id, "kind": "dataset", "parent": a["parent"], "name": m["name"],
            "dataVersion": m["dataVersion"], "bbox": m["bbox"], "license": m["license"],
            "bytes": sum(f["bytes"] for f in files), "files": files,
        }
        if a.get("testFixture"):
            entry["testFixture"] = True
        regions.append(entry)

    stale = set(attach) - seen_ids
    if stale:
        raise CatalogError(f"regions.json attaches datasets that were not built: {sorted(stale)}")
    return {"formatVersion": CATALOG_FORMAT, "regions": regions}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", required=True, type=Path, help="directory holding <id>/manifest.json")
    ap.add_argument("--regions", required=True, type=Path)
    ap.add_argument("--out", type=Path, help="default: <data>/catalog.json")
    a = ap.parse_args(argv)
    cat = build_catalog(a.data, a.regions)
    out = a.out or a.data / "catalog.json"
    out.write_text(json.dumps(cat, ensure_ascii=False, separators=(",", ":"), sort_keys=True), "utf-8")
    ds = [r for r in cat["regions"] if r["kind"] == "dataset"]
    print(f"{out}: {len(cat['regions'])} regions ({len(ds)} datasets)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
