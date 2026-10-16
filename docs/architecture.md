# D'Maps architecture

Status: layers below exist and are tested on the Monaco fixture; items called *planned* in later sections are not started.

## 1. Principles

1. **Offline is the default, not a fallback.** Core features never call a remote service. This is enforced
   three ways: an ESLint rule bans `http(s)://` literals in app code (`eslint.config.js`), the e2e test fails
   on any request leaving localhost, and the e2e test reloads with the network disabled.
2. **Data is installed, not streamed.** Map data comes from versioned, hash-verified datasets that the user
   downloads once (from any static host) into IndexedDB. After install nothing needs a server.
3. **Honest coverage.** The UI states what is installed. A place or route outside the installed data yields a
   specific "not in your downloaded data" message, never a guess or an online call.
4. **Separation:** UI · map view · GPS · search · routing · storage · data pipeline are separate modules.

## 2. Layers

```
┌──────────────── React UI: Map · Regions · Settings · About ─────────────────┐
│  map view (Leaflet canvas) │ search UI │ route UI │ navigation UI │ i18n (id/en)
├──────────────────────────────────────────────────────────────────────────────┤
│  src/navigation  tracker + controller: progress, next maneuver, deviation, reroute, arrival
│  src/gps         Geolocation wrapper, error mapping, stale detection, simulated source, wake lock
│  src/search      inverted index, folding, ID abbreviations, history
│  src/routing     snap → A* (+ turn restrictions) → maneuvers (pure TS, no DOM)
│  src/storage     IndexedDB datasets, SHA-256 verify, pause/resume, quota check
│  src/regions     catalog hierarchy, per-region loading
├──────────────────────────────────────────────────────────────────────────────┤
│  Service worker (vite-plugin-pwa): app shell only, NOT map data
└──────────────────────────────────────────────────────────────────────────────┘
            ▲ installs (one-time, any static host)
pipeline/ (Python, pyosmium)  PBF → graph.bin + ways.json + turns.bin + places.json + features.json + manifest.json
```

## 3. How routing works with no internet (laptop and phone)

Same code path on both: no server, no native code.

1. The dataset (`graph.bin` etc.) lives in IndexedDB as ArrayBuffers, installed earlier.
2. At start (or when the user picks a region) the app reads `graph.bin`, parses it into typed arrays (`parseGraph`),
   and builds a spatial grid + A\* scratch arrays (`RoutingEngine`). Currently on the main thread; moving it to a Web Worker is planned.
3. A route request = snap start/end to routable nodes within 300 m (trying nearest candidates in case one sits in an
   isolated pocket) → A\* with an admissible haversine/max-speed heuristic → maneuver list (turn, fork, ramp,
   roundabout exit, U-turn, arrive) + geometry.
4. Errors are typed (`OUTSIDE_DATASET`, `NO_ROAD_NEAR_START/END`, `NO_ROUTE`) and map 1:1 to user-facing messages.
5. Rerouting after deviation is the same call from the current GPS fix; it works offline as long as the position is
   inside installed data.

**Position:** the browser Geolocation API uses the phone's GNSS chip, which needs no internet. Laptops generally have
no GNSS receiver; browsers then typically estimate position from Wi-Fi/IP using an online service, so **a laptop that is
offline will usually have no position**. The UI must say so and let the user pick the start on the map. Geolocation also
needs a secure context (HTTPS or `localhost`); testing on a phone over LAN needs HTTPS (e.g. a local dev certificate)
or USB port forwarding. Background tabs / locked screens throttle geolocation; navigation should hold a Screen Wake Lock.

## 4. Nationwide data strategy

Indonesia is an archipelago of ~17,000 islands; the road network is almost entirely **per island**. That suggests:

| Concern | Plan |
|---|---|
| Unit of download | Region datasets (island → province), each self-contained and independently versioned. Hierarchy shown in the Offline Map Manager. |
| Routing graph | One graph per region. Cross-region routes are only possible where regions are adjacent by road *and both installed*; otherwise `NO_ROUTE` with an explanation. Ferries are out of scope for v1. Planned later: a small "border portal" file linking adjacent regions. |
| Large islands | Synthetic benchmarks (`docs/measurements.md`) show plain A\* query time tracking route length, not graph size, while memory grows linearly (~1.1 GB of arrays at 9M nodes). So the pressure is **memory/storage first, CPU second**: the likely answer is a tiled or segmented graph loaded on demand (ADR 0001, option D's idea), with contraction hierarchies (option E) only if long-route query time proves too slow on real phones. Gated on real-data measurement. |
| Search | Per-region `places.json` index loaded on demand; multi-region search merges results. Planned: shard the index by name prefix for big regions. |
| Rendering | Today the app draws `features.json` vector layers on a Leaflet canvas. **Does not scale** (Monaco alone has 23k building outlines in 1.9 MB). Planned: PMTiles vector tiles built per region (e.g. with Planetiler, Apache-2.0) stored as a file in OPFS/IndexedDB and drawn with a Leaflet vector-tile plugin (e.g. protomaps-leaflet, BSD-3). Raster tiles for the whole country are explicitly **not** the plan. |
| Updates | Content-addressed files (`dataVersion` = hash of file hashes): only changed files are re-downloaded; the old version keeps working until the new one fully verifies. [built] |
| Integrity / resume | SHA-256 + size per file, file-level resume, abort support, quota pre-check with 1.25× margin. [built] Planned: HTTP range resume *within* a large file. |
| Where hosted | Any static host (object storage, GitHub Pages for small regions, your own server). Public OSM tile servers are never used for bulk data. |

Four storage classes, reported separately in the UI: **map rendering**, **routing graph**, **place search index**, **app assets**.
Real sizes: `docs/measurements.md` (Monaco only; Indonesia **not measured** — see that file for the procedure).

## 5. Project structure

```
dmaps/
  src/
    routing/     graph astar spatial engine instructions describe turns geo     pure TS, no DOM
    search/      inverted index, folding, ID abbreviations, history
    storage/     IndexedDB datasets, SHA-256 verify, pause/resume, quota, manager
    regions/     catalog (hierarchy), per-region load, multi-region set
    gps/         Geolocation wrapper, fixes/stale, simulated source, wake lock
    navigation/  tracker (position -> route progress), controller (deviation, reroute, arrival)
    nav/         NavigationView + useNavigation (UI over the controller)
    map/         vector features -> Leaflet canvas, position marker
    screens/     Map, Regions (Offline Map Manager), Settings, About
    settings/    local preference store      i18n/  id + en strings      about/  notices
  pipeline/      dmaps_pipeline/{build_dataset,profile,binfmt,turns,catalog}.py + pytest
  public/data/   catalog.json + built datasets (Monaco fixture only)
  data/          regions.json (hierarchy), fixtures/monaco/monaco.osm.pbf (test input)
  tests/         vitest unit/integration; tests/perf (timing, not pass/fail)
  e2e/           Playwright: offline, manager/settings, navigation, PWA
  docs/          architecture, ADR, measurements, data guide, testing, limitations, licensing
  scripts/       measure_dataset.py, gen_notices.mjs, gen_icons.mjs, PBF debug helpers
```

## 6. Phases (status)

| Phase | Scope | Status (2026-10-14) |
|---|---|---|
| 0 | Repo audit, feasibility, ADR | Done. Real Indonesian measurements pending (OSM hosts unreachable from the build sandbox) |
| 1 | PoC: local map, search, offline route, offline reload | Done on the Monaco fixture |
| 2 | Foundation: PWA, i18n, design tokens, icons, storage abstraction | Done, except routing in a Web Worker (routing still runs on the main thread) |
| 3 | Core: map UI, GPS, search UI, route planning, navigation | Done and tested with emulated/simulated GPS; **not tested on real hardware** |
| 4 | Nationwide pipeline: streaming build, vector tiles, CH if needed | Region catalog/manager done. Streaming pipeline, PMTiles and CH **not started**; nothing run on Indonesian data |
| 5 | Polish: a11y, error recovery, cache upgrade tests, licences | Licences/notices, error recovery and automated axe audit done. Manual keyboard/screen-reader testing and schema-migration tests **not done** |
| 6 | Final verification | Re-run all checks after each change (see README); full sign-off blocked on Phase 4 data |

## 7. Risks

| Risk | Impact | Mitigation / decision |
|---|---|---|
| Big-island graph too large for a phone tab | Core goal missed on mobile | Synthetic data says memory is the binding constraint (~120 MB at 1M nodes, ~1.1 GB at 9M). Measure real island sizes first (`docs/measurements.md`); fall back to a tiled/segmented graph, then CH/WASM |
| Large files buffered whole during install | Memory spike or killed tab on phones | Download now uses one preallocated buffer (~1×, was ~2×); chunked segments with per-chunk hashes are the proper fix for hundreds-of-MB graphs |
| iOS Safari storage limits / eviction | Downloaded data lost | Request persistent storage; recommend install to home screen; test on a real iPhone; verify-on-open + clear "reinstall" path [verify-on-open built] |
| Unsupported turn restrictions (via-way, conditional) | Illegal/unsafe routes | Simple via-node restrictions are applied; the manifest lists what was skipped and why |
| OSM coverage gaps in Indonesia (roads, one-ways, addresses) | Wrong/no routes, missing places | Surface the limitation in UI; never promise complete addresses/businesses |
| GPS drift, laptop without GNSS, background throttling | Navigation unreliable | Accuracy display, stale-fix indicator, wake lock, honest messaging; real-device testing |
| Single-process pipeline cannot process Java/Sumatra | Cannot build datasets | Streaming/partitioned extraction in Phase 4 (unmeasured; assumed from in-memory design) |
| ETA quality | Misleading times | Labelled approximate; calibrate against real trips later |

## 8. Licensing and attribution

Summary: data is © OpenStreetMap contributors (ODbL 1.0); built datasets are derived databases and keep the notice in every
manifest (enforced by the manifest validator). Runtime dependencies are permissive. Full detail:
`docs/licensing.md` and `docs/THIRD_PARTY_NOTICES.md`. **Open decision:** the project's own licence (`UNLICENSED` for now).

## 9. Unresolved decisions

1. Own-code licence (MIT/Apache-2.0/AGPL/keep private).
2. Where to host regional datasets (needed only to *distribute* downloads, never for offline use).
3. Final region hierarchy and boundaries (island vs province vs custom polygons); `data/regions.json` currently holds only the test fixture.
4. Vector-tile stack for large regions (PMTiles + Leaflet plugin vs another approach) — to be prototyped.
5. CH/WASM vs tiled graph — gated on real measurements.
6. Whether to support motorcycles (dominant in Indonesia) as a second routing profile; the current profile is `car`.
