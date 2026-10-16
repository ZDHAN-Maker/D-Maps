# Measurements

Rule: **only numbers that were actually measured appear here, each with where/how.**
Anything unmeasured is marked `NOT MEASURED` and has a procedure to measure it.

## What was measured (2026-10-11)

Dataset: `public/data/monaco` — the OSRM Monaco test extract (real OSM data, **not** Indonesian).
Machine: cloud VM, 2 vCPU Intel Xeon @ 2.8 GHz, Node v22.22.0. **Not a phone, not a browser.**

Reproduce: `npm run measure:data -- public/data/monaco` and `npm run perf`
(raw outputs: `docs/measurements/size-monaco.md`, `docs/measurements/perf-monaco.json`).

### Storage, by component

| Component | Files | Raw | gzip -9 |
|---|---|---:|---:|
| Routing graph | `graph.bin`, `ways.json` | 0.62 MB | 0.24 MB |
| Place search | `places.json` | 0.09 MB | 0.02 MB |
| Map rendering (PoC vector format) | `features.json` | 1.90 MB | 0.70 MB |
| **Total** | | **2.62 MB** | **0.96 MB** |

Ratios: `graph.bin` = 21.85 B per directed edge (26,873 edges, 15,335 nodes); `places.json` = 90.8 B per place (961 places).
In-memory router footprint, **computed from the typed arrays in the code** (not a runtime measurement): 19 B/edge + 37 B/node = 1.08 MB for Monaco.

> `features.json` is a PoC format (delta-encoded JSON polylines, incl. 23,326 building outlines).
> It is **not** a candidate for nationwide rendering; see the architecture doc (PMTiles/vector tiles).

### Speed (Node, 300 seeded random node pairs; 269 routed, 31 had no path)

| Metric | Result |
|---|---|
| Load + SHA-256 verify + parse graph | 14.8 ms |
| Engine init (spatial grid etc.) | 9.5 ms |
| Search index build (961 places) | 8.1 ms |
| Route compute, p50 / p95 / max | 1.6 / 4.7 / 14.6 ms |
| Nodes expanded, p50 / p95 | 4,760 / 12,133 |
| Median / max routed distance | 6.6 / 18.3 km |
| Search query, p50 / p95 / max (400 queries) | 0.01 / 0.02 / 0.57 ms |

About 10% of random pairs had no path. That is a property of picking arbitrary nodes in a real
road graph (one-way sinks, access-restricted pockets, extract edges), not evidence of a routing bug,
but it has not been analysed further. Phase 4 should report connected-component statistics per region.

## Synthetic scale benchmark (2026-10-15)

**Synthetic data, not Indonesian, not a phone.** `npm run perf:scale` builds a hierarchical grid road network
(local 30 km/h, every 10th line 50, every 50th line 80; 3% of segments removed; ~4 edges per node versus ~1.75 in Monaco)
directly as router typed arrays and times end-to-end `RoutingEngine.route()` (snap + A\* + instructions), 12 seeded queries
per length, on the same 2 vCPU Xeon / Node 22 VM as above. Raw output: `docs/measurements/perf-synthetic-scale.json`.

| Nodes / edges | graph.bin MB / router arrays MB (measured) | Routed km (median) | Route ms p50 / p95 | Nodes expanded p50 (share of graph) |
|---|---|---:|---:|---:|
| 250,000 / 968,234 | 17.5 / 30 | ~2.8 | 2 / 6.5 | 392 (0.2%) |
|  |  | ~14.2 | 2.8 / 6.1 | 6,171 (2.5%) |
| 1,000,000 / 3,876,514 | 70.1 / 120.3 | ~2.9 | 0.7 / 1.7 | 522 (0.1%) |
|  |  | ~14.2 | 4.1 / 8.2 | 7,325 (0.7%) |
|  |  | ~38.7 | 24 / 49.5 | 51,253 (5.1%) |
| 4,000,000 / 15,511,084 | 280.7 / 433.1 | ~2.8 | 2.7 / 4.4 | 476 (0%) |
|  |  | ~14.2 | 5.2 / 17.4 | 5,550 (0.1%) |
|  |  | ~39.7 | 27.7 / 36.7 | 52,956 (1.3%) |
|  |  | ~104.3 | 224.2 / 335.2 | 321,889 (8%) |
| 9,000,000 / 34,905,254 | 631.6 / 1082.8 | ~2.9 | 2.6 / 6.3 | 511 (0%) |
|  |  | ~14.2 | 7 / 14.9 | 8,760 (0.1%) |
|  |  | ~42.5 | 51.3 / 78.9 | 63,965 (0.7%) |
|  |  | ~107.4 | 342 / 475.7 | 373,161 (4.1%) |

What this does show (for plain A\* with a max-speed heuristic on this network shape):

- **Query time is driven mainly by route length, with a modest graph-size penalty.** A ~40 km route expands about the same number of nodes
  (51k–64k) at 1M and 9M nodes, but p50 rises from 24 ms to 51 ms (about 2×, plausibly cache effects — not investigated);
  ~100 km takes ~0.22–0.34 s p50 (p95 ≤ 0.48 s) at 4M–9M nodes. Nothing here approaches the ADR's 1 s p95 trigger on a server CPU.
- **Memory grows linearly and is the real constraint.** Router arrays measured 30 / 120 / 433 / 1,083 MB at 0.25M / 1M / 4M / 9M nodes
  (formula 19 B/edge + 37 B/node is within ~10% of measured). 9M nodes means ~1.1 GB of typed arrays plus a 632 MB `graph.bin`
  — not viable in a phone browser tab; 1M nodes (~120 MB) very likely is, but that is **unverified on a phone**.
- Engine init (spatial grid etc.) grows with graph size: 41 ms at 0.25M, 446 ms at 4M, 883 ms at 9M nodes.

What it does **not** show: how many nodes real Indonesian islands have (unknown until data is built), real network shape,
phone CPU/memory behaviour, or routes longer than ~107 km. Real graphs have fewer edges per node, so real memory per node is
lower than this grid's — do not read the table as a prediction.

## What cannot be concluded from this

- Nothing about Indonesian dataset sizes: **NOT MEASURED** (OSM data hosts are unreachable from the build sandbox).
- Nothing about phones, Safari/iOS, or in-browser memory: **NOT MEASURED**.
- Monaco is 15k nodes. Do not extrapolate p50 = 1.6 ms to an island; use the synthetic curve above for the shape of the scaling and real regions for the numbers.

## Measurement plan (run on your own machine)

Prerequisites: download a **legitimate** extract (Geofabrik publishes Indonesia and, I believe, per-island
sub-extracts — verify on <https://download.geofabrik.de/asia/indonesia.html>; respect their fair-use policy
and prefer a small region first, e.g. one province).

```bash
cd pipeline && python3 -m venv .venv && .venv/bin/pip install -e .
.venv/bin/python -I -m dmaps_pipeline.build_dataset --pbf /path/to/region.osm.pbf \
    --id jambi --name "Jambi" --out ../public/data/jambi
cd .. && npm run measure:data -- public/data/jambi
```

| # | Question | How | Status |
|---|---|---|---|
| 1 | Size of each component per island / province | `measure_dataset.py` on each real build | NOT MEASURED |
| 2 | Does the single-process pipeline survive the big islands (RAM/time)? | Run on the largest extract; watch peak RSS (`/usr/bin/time -v`) | NOT MEASURED — pipeline is in-memory by design for PoC |
| 3 | Peak browser memory loading a graph on a mid-range Android phone | Chrome remote debugging → Memory tab, load dataset from IndexedDB | NOT MEASURED |
| 4 | p50/p95 route time vs distance on real regions | extend `tests/perf/measure.perf.ts` to the new dataset; also run in a worker in the browser | NOT MEASURED on real data (synthetic curve above) |
| 5 | IndexedDB quota and write speed: desktop Chrome/Firefox, Android Chrome, iOS Safari (browser and installed PWA) | `navigator.storage.estimate()` + install a real region; check persistence after days | NOT MEASURED |
| 6 | Initial app load and offline cold start | Lighthouse + Playwright (offline reload e2e exists for the PoC) | PoC only |
| 7 | Real GPS accuracy, heading, drift during navigation | Physical device, outdoors | NOT MEASURED — needs hardware |
