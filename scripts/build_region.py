"""One-command automated script to download, build, and measure an Indonesian regional dataset.

Usage:
    python scripts/build_region.py --id jambi --name "Jambi" --parent sumatra

Options:
    --id       Dataset identifier (default: jambi)
    --name     Human-readable name (default: Jambi)
    --parent   Parent group ID in regions.json (default: sumatra)
    --url      Custom download URL for the OSM PBF file
    --skip-download  Use existing fixture if present
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

# Add project root and pipeline to sys.path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "pipeline"))
sys.path.insert(0, str(ROOT / "scripts"))

from dmaps_pipeline.build_dataset import build
from dmaps_pipeline.catalog import build_catalog
import measure_dataset

REGION_DEFAULTS = {
    "jambi": {
        "name": "Jambi",
        "parent": "sumatra",
        "url": "https://download.openstreetmap.fr/extracts/asia/indonesia/jambi.osm.pbf",
        "group_name": "Sumatra",
    },
    "bali": {
        "name": "Bali",
        "parent": "nusa-tenggara",
        "url": "https://download.openstreetmap.fr/extracts/asia/indonesia/bali.osm.pbf",
        "group_name": "Nusa Tenggara",
    },
    "yogyakarta": {
        "name": "DI Yogyakarta",
        "parent": "java",
        "url": "https://download.openstreetmap.fr/extracts/asia/indonesia/yogyakarta.osm.pbf",
        "group_name": "Jawa",
    },
}

KNOWN_GROUPS = {
    "sumatra": {"name": "Sumatra", "names": {"id": "Sumatra", "en": "Sumatra"}, "parent": "indonesia"},
    "java": {"name": "Jawa", "names": {"id": "Jawa", "en": "Java"}, "parent": "indonesia"},
    "nusa-tenggara": {"name": "Nusa Tenggara", "names": {"id": "Nusa Tenggara", "en": "Lesser Sunda Islands"}, "parent": "indonesia"},
    "kalimantan": {"name": "Kalimantan", "names": {"id": "Kalimantan", "en": "Borneo"}, "parent": "indonesia"},
    "sulawesi": {"name": "Sulawesi", "names": {"id": "Sulawesi", "en": "Celebes"}, "parent": "indonesia"},
    "maluku": {"name": "Maluku", "names": {"id": "Maluku", "en": "Moluccas"}, "parent": "indonesia"},
    "papua": {"name": "Papua", "names": {"id": "Papua", "en": "Papua"}, "parent": "indonesia"},
}


def download_with_progress(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        print(f"[*] Found existing PBF file: {dest} ({dest.stat().st_size / 1e6:.2f} MB)")
        return

    print(f"[*] Downloading {url} -> {dest} ...")
    req = urllib.request.Request(url, headers={"User-Agent": "DMaps-Pipeline/1.0"})
    with urllib.request.urlopen(req) as resp, open(dest, "wb") as out_f:
        total_size = int(resp.headers.get("Content-Length", 0))
        downloaded = 0
        last_pct = -1
        start_time = time.time()
        chunk_size = 256 * 1024

        while True:
            chunk = resp.read(chunk_size)
            if not chunk:
                break
            out_f.write(chunk)
            downloaded += len(chunk)
            if total_size > 0:
                pct = int(downloaded * 100 / total_size)
                if pct != last_pct and pct % 10 == 0:
                    last_pct = pct
                    speed = downloaded / (time.time() - start_time) / 1024 / 1024
                    print(f"    Progress: {pct}% ({downloaded / 1e6:.1f} / {total_size / 1e6:.1f} MB) - {speed:.2f} MB/s")

    elapsed = time.time() - start_time
    print(f"[*] Download completed in {elapsed:.1f}s ({dest.stat().st_size / 1e6:.2f} MB)")


def update_regions_config(regions_file: Path, dataset_id: str, parent_group: str) -> None:
    cfg = json.loads(regions_file.read_text("utf-8"))
    groups = cfg.setdefault("groups", [])
    datasets = cfg.setdefault("datasets", {})

    group_ids = {g["id"] for g in groups}
    if parent_group not in group_ids:
        grp_meta = KNOWN_GROUPS.get(parent_group, {
            "name": parent_group.capitalize(),
            "names": {"id": parent_group.capitalize(), "en": parent_group.capitalize()},
            "parent": "indonesia",
        })
        groups.append({
            "id": parent_group,
            "parent": grp_meta.get("parent", "indonesia"),
            "name": grp_meta["name"],
            "names": grp_meta["names"],
        })
        print(f"[*] Added group '{parent_group}' to regions.json")

    datasets[dataset_id] = {"parent": parent_group}
    regions_file.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n", "utf-8")
    print(f"[*] Attached dataset '{dataset_id}' under group '{parent_group}' in regions.json")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--id", default="jambi", help="Dataset ID (e.g. jambi)")
    parser.add_argument("--name", help="Display name (default: from registry or capitalized ID)")
    parser.add_argument("--parent", help="Parent group in regions.json (default: sumatra for jambi)")
    parser.add_argument("--url", help="Download URL for .osm.pbf file")
    parser.add_argument("--pbf", type=Path, help="Explicit path to existing .osm.pbf file")
    parser.add_argument("--catalog-only", action="store_true", help="Only rebuild catalog.json from existing manifests")
    args = parser.parse_args()

    regions_path = ROOT / "data" / "regions.json"
    if args.catalog_only:
        print("[*] Rebuilding catalog.json from existing manifests ...")
        catalog = build_catalog(ROOT / "public" / "data", regions_path)
        catalog_path = ROOT / "public" / "data" / "catalog.json"
        catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":"), sort_keys=True), "utf-8")
        print(f"[*] Catalog updated at {catalog_path}")
        return 0

    ds_id = args.id.lower()
    meta = REGION_DEFAULTS.get(ds_id, {})
    name = args.name or meta.get("name", ds_id.capitalize())
    parent = args.parent or meta.get("parent", "sumatra")
    url = args.url or meta.get("url")

    pbf_path = args.pbf or (ROOT / "data" / "fixtures" / ds_id / f"{ds_id}.osm.pbf")
    out_dir = ROOT / "public" / "data" / ds_id
    regions_path = ROOT / "data" / "regions.json"

    print("=" * 60)
    print(f"D'Maps — Build & Measure Indonesia Dataset: {name} (ID: {ds_id})")
    print("=" * 60)

    # 1. Download PBF if not given explicitly or missing
    if not pbf_path.exists():
        if not url:
            print(f"[!] Error: No PBF file found at {pbf_path} and no download URL specified.")
            return 1
        download_with_progress(url, pbf_path)
    else:
        print(f"[*] Using PBF file: {pbf_path} ({pbf_path.stat().st_size / 1e6:.2f} MB)")

    # 2. Build dataset
    print(f"\n[*] Running pipeline build_dataset ...")
    t0 = time.time()
    source_note = f"OSM France extract, built on {time.strftime('%Y-%m-%d %H:%M:%S')}"
    manifest = build(
        pbf=pbf_path,
        out=out_dir,
        dataset_id=ds_id,
        name=name,
        source_note=source_note,
    )
    build_sec = time.time() - t0
    print(f"[*] Pipeline build completed in {build_sec:.2f}s!")

    # 3. Update regions.json & rebuild catalog
    print(f"\n[*] Updating region hierarchy and catalog ...")
    update_regions_config(regions_path, ds_id, parent)
    catalog = build_catalog(ROOT / "public" / "data", regions_path)
    catalog_path = ROOT / "public" / "data" / "catalog.json"
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":"), sort_keys=True), "utf-8")
    print(f"[*] Catalog updated at {catalog_path}")

    # 4. Measure dataset
    print(f"\n[*] Measuring storage breakdown and memory footprint ...")
    m = measure_dataset.measure(out_dir)
    measure_dataset.main([str(out_dir)])

    # 5. Output summary block for docs/measurements.md
    summary_path = ROOT / "docs" / "measurements" / f"size-{ds_id}.json"
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(json.dumps(m, indent=2), "utf-8")
    print(f"\n[*] Saved measurement json to {summary_path}")
    print(f"\nSUCCESS: Dataset {ds_id} ({name}) is ready and available in D'Maps!")
    return 0


if __name__ == "__main__":
    sys.exit(main())
