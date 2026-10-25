"""Automated pipeline script to download, build, and deploy all 38 Indonesian provincial datasets.

Features:
- Full registry of all 38 Indonesian provinces grouped by archipelago
- Automated download from OpenStreetMap / Geofabrik mirrors
- Building graph.bin, ways.json, places.json, features.json, turns.bin
- Updating regions.json and catalog.json
- Cloudflare R2 / AWS S3 deployment helpers

Usage:
    python scripts/build_indonesia.py --list
    python scripts/build_indonesia.py --province bali
    python scripts/build_indonesia.py --group jawa-bali
    python scripts/build_indonesia.py --sync-r2 --bucket dmaps-data
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "pipeline"))
sys.path.insert(0, str(ROOT / "scripts"))

from dmaps_pipeline.build_dataset import build
from dmaps_pipeline.catalog import build_catalog

# Registry of 38 Indonesian Provinces
PROVINCES = [
    # Sumatera (10)
    {"id": "aceh", "name": "Aceh", "parent": "sumatra", "pbf": "https://download.openstreetmap.fr/extracts/asia/indonesia/aceh.osm.pbf"},
    {"id": "sumut", "name": "Sumatera Utara", "parent": "sumatra", "pbf": "https://download.openstreetmap.fr/extracts/asia/indonesia/sumatera_utara.osm.pbf"},
    {"id": "sumbar", "name": "Sumatera Barat", "parent": "sumatra", "pbf": "https://download.openstreetmap.fr/extracts/asia/indonesia/sumatera_barat.osm.pbf"},
    {"id": "riau", "name": "Riau", "parent": "sumatra", "pbf": "https://download.openstreetmap.fr/extracts/asia/indonesia/riau.osm.pbf"},
    {"id": "kepri", "name": "Kepulauan Riau", "parent": "sumatra", "pbf": "https://download.openstreetmap.fr/extracts/asia/indonesia/kepulauan_riau.osm.pbf"},
    {"id": "jambi", "name": "Jambi", "parent": "sumatra", "pbf": "https://download.openstreetmap.fr/extracts/asia/indonesia/jambi.osm.pbf"},
    {"id": "bengkulu", "name": "Bengkulu", "parent": "sumatra", "pbf": "https://download.openstreetmap.fr/extracts/asia/indonesia/bengkulu.osm.pbf"},
    {"id": "sumsel", "name": "Sumatera Selatan", "parent": "sumatra", "pbf": "https://download.openstreetmap.fr/extracts/asia/indonesia/sumatera_selatan.osm.pbf"},
    {"id": "babel", "name": "Bangka Belitung", "parent": "sumatra", "pbf": "https://download.openstreetmap.fr/extracts/asia/indonesia/kepulauan_bangka_belitung.osm.pbf"},
    {"id": "lampung", "name": "Lampung", "parent": "sumatra", "pbf": "https://download.openstreetmap.fr/extracts/asia/indonesia/lampung.osm.pbf"},

    # Jawa & Bali (7)
    {"id": "dki-jakarta", "name": "DKI Jakarta", "parent": "jawa-bali", "pbf": "https://download.openstreetmap.fr/extracts/asia/indonesia/dki_jakarta.osm.pbf"},
    {"id": "banten", "name": "Banten", "parent": "jawa-bali", "pbf": "https://download.openstreetmap.fr/extracts/asia/indonesia/banten.osm.pbf"},
    {"id": "jabar", "name": "Jawa Barat", "parent": "jawa-bali", "pbf": "https://download.openstreetmap.fr/extracts/asia/indonesia/jawa_barat.osm.pbf"},
    {"id": "jateng", "name": "Jawa Tengah", "parent": "jawa-bali", "pbf": "https://download.openstreetmap.fr/extracts/asia/indonesia/jawa_tengah.osm.pbf"},
    {"id": "yogyakarta", "name": "DI Yogyakarta", "parent": "jawa-bali", "pbf": "https://download.openstreetmap.fr/extracts/asia/indonesia/yogyakarta.osm.pbf"},
    {"id": "jatim", "name": "Jawa Timur", "parent": "jawa-bali", "pbf": "https://download.openstreetmap.fr/extracts/asia/indonesia/jawa_timur.osm.pbf"},
    {"id": "bali", "name": "Bali", "parent": "jawa-bali", "pbf": "https://download.openstreetmap.fr/extracts/asia/indonesia/bali.osm.pbf"},

    # Kalimantan (5)
    {"id": "kalbar", "name": "Kalimantan Barat", "parent": "kalimantan", "pbf": "https://download.openstreetmap.fr/extracts/asia/indonesia/kalimantan_barat.osm.pbf"},
    {"id": "kalteng", "name": "Kalimantan Tengah", "parent": "kalimantan", "pbf": "https://download.openstreetmap.fr/extracts/asia/indonesia/kalimantan_tengah.osm.pbf"},
    {"id": "kalsel", "name": "Kalimantan Selatan", "parent": "kalimantan", "pbf": "https://download.openstreetmap.fr/extracts/asia/indonesia/kalimantan_selatan.osm.pbf"},
    {"id": "kaltim", "name": "Kalimantan Timur", "parent": "kalimantan", "pbf": "https://download.openstreetmap.fr/extracts/asia/indonesia/kalimantan_timur.osm.pbf"},
    {"id": "kaltara", "name": "Kalimantan Utara", "parent": "kalimantan", "pbf": "https://download.openstreetmap.fr/extracts/asia/indonesia/kalimantan_utara.osm.pbf"},

    # Sulawesi (6)
    {"id": "sulut", "name": "Sulawesi Utara", "parent": "sulawesi", "pbf": "https://download.openstreetmap.fr/extracts/asia/indonesia/sulawesi_utara.osm.pbf"},
    {"id": "gorontalo", "name": "Gorontalo", "parent": "sulawesi", "pbf": "https://download.openstreetmap.fr/extracts/asia/indonesia/gorontalo.osm.pbf"},
    {"id": "sulteng", "name": "Sulawesi Tengah", "parent": "sulawesi", "pbf": "https://download.openstreetmap.fr/extracts/asia/indonesia/sulawesi_tengah.osm.pbf"},
    {"id": "sulbar", "name": "Sulawesi Barat", "parent": "sulawesi", "pbf": "https://download.openstreetmap.fr/extracts/asia/indonesia/sulawesi_barat.osm.pbf"},
    {"id": "sulsel", "name": "Sulawesi Selatan", "parent": "sulawesi", "pbf": "https://download.openstreetmap.fr/extracts/asia/indonesia/sulawesi_selatan.osm.pbf"},
    {"id": "sultra", "name": "Sulawesi Tenggara", "parent": "sulawesi", "pbf": "https://download.openstreetmap.fr/extracts/asia/indonesia/sulawesi_tenggara.osm.pbf"},

    # Nusa Tenggara, Maluku & Papua (10)
    {"id": "ntb", "name": "Nusa Tenggara Barat", "parent": "nusa-tenggara-maluku-papua", "pbf": "https://download.openstreetmap.fr/extracts/asia/indonesia/nusa_tenggara_barat.osm.pbf"},
    {"id": "ntt", "name": "Nusa Tenggara Timur", "parent": "nusa-tenggara-maluku-papua", "pbf": "https://download.openstreetmap.fr/extracts/asia/indonesia/nusa_tenggara_timur.osm.pbf"},
    {"id": "maluku", "name": "Maluku", "parent": "nusa-tenggara-maluku-papua", "pbf": "https://download.openstreetmap.fr/extracts/asia/indonesia/maluku.osm.pbf"},
    {"id": "malut", "name": "Maluku Utara", "parent": "nusa-tenggara-maluku-papua", "pbf": "https://download.openstreetmap.fr/extracts/asia/indonesia/maluku_utara.osm.pbf"},
    {"id": "papua", "name": "Papua", "parent": "nusa-tenggara-maluku-papua", "pbf": "https://download.openstreetmap.fr/extracts/asia/indonesia/papua.osm.pbf"},
    {"id": "papuabarat", "name": "Papua Barat", "parent": "nusa-tenggara-maluku-papua", "pbf": "https://download.openstreetmap.fr/extracts/asia/indonesia/papua_barat.osm.pbf"},
    {"id": "papuaselatan", "name": "Papua Selatan", "parent": "nusa-tenggara-maluku-papua", "pbf": "https://download.openstreetmap.fr/extracts/asia/indonesia/papua.osm.pbf"},
    {"id": "papuatengah", "name": "Papua Tengah", "parent": "nusa-tenggara-maluku-papua", "pbf": "https://download.openstreetmap.fr/extracts/asia/indonesia/papua.osm.pbf"},
    {"id": "papuapegunungan", "name": "Papua Pegunungan", "parent": "nusa-tenggara-maluku-papua", "pbf": "https://download.openstreetmap.fr/extracts/asia/indonesia/papua.osm.pbf"},
    {"id": "papuabaratdaya", "name": "Papua Barat Daya", "parent": "nusa-tenggara-maluku-papua", "pbf": "https://download.openstreetmap.fr/extracts/asia/indonesia/papua_barat.osm.pbf"},
]

PROVINCE_MAP = {p["id"]: p for p in PROVINCES}


def download_pbf(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        print(f"[*] Menggunakan file PBF lokal: {dest} ({dest.stat().st_size / 1e6:.1f} MB)")
        return

    print(f"[*] Mengunduh {url} -> {dest} ...")
    req = urllib.request.Request(url, headers={"User-Agent": "DMaps-Pipeline/1.0"})
    with urllib.request.urlopen(req) as resp, open(dest, "wb") as out_f:
        total = int(resp.headers.get("Content-Length", 0))
        downloaded = 0
        t0 = time.time()
        while True:
            chunk = resp.read(256 * 1024)
            if not chunk:
                break
            out_f.write(chunk)
            downloaded += len(chunk)
            if total > 0 and downloaded % (2 * 1024 * 1024) < 256 * 1024:
                pct = int(downloaded * 100 / total)
                print(f"    {pct}% ({downloaded / 1e6:.1f}/{total / 1e6:.1f} MB)")
        print(f"[*] Unduhan selesai dalam {time.time() - t0:.1f}s ({dest.stat().st_size / 1e6:.1f} MB)")


def build_province(prov: dict, data_dir: Path, fixtures_dir: Path) -> None:
    ds_id = prov["id"]
    name = prov["name"]
    pbf_url = prov["pbf"]
    pbf_file = fixtures_dir / ds_id / f"{ds_id}.osm.pbf"
    out_dir = data_dir / ds_id

    print("\n" + "=" * 60)
    print(f" Memproses Provinsi: {name} (ID: {ds_id})")
    print("=" * 60)

    download_pbf(pbf_url, pbf_file)

    build(
        pbf_path=pbf_file,
        dataset_id=ds_id,
        name=name,
        source_note=f"OpenStreetMap extract {time.strftime('%Y-%m-%d')}",
        out_dir=out_dir,
    )

    # Attach in regions.json
    regions_file = ROOT / "data" / "regions.json"
    cfg = json.loads(regions_file.read_text("utf-8"))
    cfg.setdefault("datasets", {})[ds_id] = {"parent": prov["parent"]}
    regions_file.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n", "utf-8")
    print(f"[*] Sukses membangun dataset '{ds_id}' di {out_dir}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--list", action="store_true", help="Daftar seluruh 38 provinsi di Indonesia")
    parser.add_argument("--province", help="ID provinsi tertentu (misal: bali, yogyakarta, dki-jakarta)")
    parser.add_argument("--group", help="Grup wilayah tertentu (misal: sumatra, jawa-bali, kalimantan, sulawesi)")
    parser.add_argument("--catalog-only", action="store_true", help="Rebuild catalog.json saja")
    parser.add_argument("--sync-r2", action="store_true", help="Tampilkan instruksi sync ke Cloudflare R2")
    parser.add_argument("--bucket", default="dmaps-data", help="Nama bucket R2 / S3")
    args = parser.parse_args()

    if args.list:
        print(f"\nDaftar 38 Provinsi Indonesia untuk D'Maps:")
        print(f"{'ID':<18} | {'Grup Pulau':<26} | {'Nama Provinsi'}")
        print("-" * 65)
        for p in PROVINCES:
            print(f"{p['id']:<18} | {p['parent']:<26} | {p['name']}")
        print(f"\nTotal: {len(PROVINCES)} provinsi terdaftar.")
        return 0

    if args.sync_r2:
        print(f"\n--- Panduan Sinkronisasi ke Cloudflare R2 ---")
        print(f"Gunakan Rclone atau AWS CLI untuk mengunggah folder public/data ke bucket '{args.bucket}':")
        print(f"\n1. Menggunakan AWS CLI (dengan endpoint Cloudflare R2):")
        print(f"   aws s3 sync public/data/ s3://{args.bucket}/ --endpoint-url https://<ACCOUNT_ID>.r2.cloudflarestorage.com --exclude 'catalog.json'")
        print(f"\n2. Menggunakan Rclone:")
        print(f"   rclone sync public/data/ r2:{args.bucket}/ --exclude 'catalog.json'")
        print(f"\n3. Pasang URL Publik / Custom Domain R2 di Vercel:")
        print(f"   VITE_STORAGE_BASE_URL=https://pub-xxxxxx.r2.dev/dmaps")
        return 0

    data_dir = ROOT / "public" / "data"
    fixtures_dir = ROOT / "data" / "fixtures"
    regions_file = ROOT / "data" / "regions.json"

    if args.catalog_only:
        print("[*] Memperbarui catalog.json ...")
        cat = build_catalog(data_dir, regions_file)
        (data_dir / "catalog.json").write_text(json.dumps(cat, separators=(",", ":"), ensure_ascii=False, sort_keys=True), "utf-8")
        print("[*] catalog.json berhasil diperbarui.")
        return 0

    targets = []
    if args.province:
        if args.province not in PROVINCE_MAP:
            print(f"[!] ID provinsi '{args.province}' tidak ditemukan. Jalankan dengan --list untuk melihat ID.")
            return 1
        targets.append(PROVINCE_MAP[args.province])
    elif args.group:
        targets = [p for p in PROVINCES if p["parent"] == args.group]
        if not targets:
            print(f"[!] Grup '{args.group}' tidak ditemukan.")
            return 1

    if not targets:
        parser.print_help()
        return 0

    for t in targets:
        build_province(t, data_dir, fixtures_dir)

    print("\n[*] Memperbarui catalog.json ...")
    cat = build_catalog(data_dir, regions_file)
    (data_dir / "catalog.json").write_text(json.dumps(cat, separators=(",", ":"), ensure_ascii=False, sort_keys=True), "utf-8")
    print("[*] Selesai! Semua dataset terpilih telah siap.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
