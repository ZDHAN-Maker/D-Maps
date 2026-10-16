# Guide: downloading and preparing Indonesian map data

Status: the commands below are exactly what the pipeline does for the Monaco test fixture (they run in CI-style
tests). **They have not been run on Indonesian data**, because the sandbox this project was built in could not reach
OSM data hosts. Expect to find scaling problems on large extracts (see "Known limits" at the end).

## 1. Get a legitimate source extract

Use OpenStreetMap data (ODbL). Do **not** scrape public OSM tile servers or bulk-hit public APIs.

- **Geofabrik** publishes country and sub-region extracts as `.osm.pbf`. Indonesia is under
  <https://download.geofabrik.de/asia/indonesia.html>; I believe it also offers per-island sub-regions
  (Sumatra, Java, Kalimantan, Sulawesi, ...) — check the page. Read and respect their usage terms.
- Alternatively cut your own area from a planet/country file with a tool such as `osmium extract`.

Start with **one province or a small island**, not the whole country.

Record where the file came from; the pipeline stores its SHA-256 and a note in the manifest:

```bash
sha256sum jambi.osm.pbf
```

## 2. Build a dataset

```bash
cd pipeline
python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'     # once
.venv/bin/python -I -m dmaps_pipeline.build_dataset \
    --pbf /path/to/jambi.osm.pbf \
    --id jambi --name "Jambi" \
    --source-note "Geofabrik extract, downloaded 2026-10-14" \
    --out ../public/data/jambi
```

`--id` must be lowercase letters, digits, `_` or `-` (it becomes the folder and IndexedDB key). Output, deterministic for
the same input and pipeline version:

| File | Component | What it is |
|---|---|---|
| `graph.bin` | routing | Road graph for cars: nodes, directed edges (one-ways honoured), speeds, road class, flags |
| `ways.json` | routing | Road names / refs for turn instructions |
| `turns.bin` | routing | Forbidden turns from simple (via-node) OSM turn restrictions. Optional file |
| `places.json` | search | POIs, streets, areas, addresses |
| `features.json` | rendering | Vector map layers (PoC format, see limits) |
| `manifest.json` | — | Sizes, SHA-256 of every file, `dataVersion`, bounding box, statistics, limitations, attribution |

Check the manifest's `stats` and `limitations` after every build. In particular `stats.turnRestrictions` shows how many
OSM restriction relations were applied and, under `skipped`, why others were not (via-way restrictions, loop ways, ...).

## 3. Measure it (do this before trusting any storage claim)

```bash
npm run measure:data -- public/data/jambi      # size per component, raw and gzip, bytes per edge / place
npm run perf                                   # edit tests/perf/measure.perf.ts to point at your dataset
```

Add the results to `docs/measurements.md`. Also measure, on a real phone, peak browser memory after loading the dataset
(see the plan in that file). Those two numbers decide whether the engine in ADR 0001 is enough for your largest region.

## 4. Put it in the region tree

The Offline Map Manager shows a hierarchy defined in `data/regions.json`. Add groups (e.g. an island) and attach the
dataset to one; a built dataset that is not attached is an error, by design (otherwise it would be invisible):

```json
{ "groups":   [ { "id": "sumatra", "parent": "indonesia", "name": "Sumatra", "names": { "id": "Sumatra", "en": "Sumatra" } } ],
  "datasets": { "jambi": { "parent": "sumatra" } } }
```

Then regenerate the catalog the app reads:

```bash
npm run data:catalog        # writes public/data/catalog.json (sizes and hashes copied from each manifest)
```

## 5. Host it

The app fetches `<app>/data/catalog.json` and each dataset from `<app>/data/<id>/`, so by default the data is hosted on
the same origin as the app (any static host). The catalog type also allows a per-dataset `baseUrl` for another host
(hand-edited; that host must send CORS headers). Large datasets should not be committed to git; serve them from object
storage or your own server. This is only for *downloading*: once installed, nothing contacts any server.

## 6. Updating a region

Rebuild from a newer extract. `dataVersion` changes only if some file's content changed. The app re-downloads only files whose
SHA-256 changed and keeps using the old version until the new one is fully verified. Deleting a region removes all of its
files from the device.

## 7. Verify on a device

1. Install the region from the Offline Map Manager and use *Verify* (re-hashes everything stored).
2. Follow `docs/testing-offline.md`.
3. Compare a handful of routes against a trusted reference (for example a GraphHopper/OSRM instance on the same PBF).
   Differences are expected where ETAs or restrictions differ; large distance differences are bugs.

## Known limits of the pipeline (read before running it on Java or Sumatra)

- Single process, everything in memory: fine for a province, **untested** and probably too heavy for the largest islands.
  The next step is a streaming/partitioned build.
- `features.json` draws every feature at once (Monaco: 23k building outlines, 1.9 MB). It will not scale; vector tiles
  (e.g. PMTiles) are the plan for large regions.
- Routing is limited to one region at a time (no cross-region routes) and has no ferries.
- Not applied: via-way and conditional turn restrictions; ETAs use default speeds per road class, not Indonesian traffic.
- Multipolygon relations (large lakes, sea areas) are not drawn.
