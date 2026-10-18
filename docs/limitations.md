# Known limitations and future improvements

Last reviewed: 2026-10-14. Everything here is true of the code as tested; "not verified" means exactly that.

## Coverage and data

| Limitation | Detail |
|---|---|
| **Indonesian data coverage** | Jambi province built and measured (663k nodes, 1.36M edges, 61 MB storage, ~53 MB RAM, p50 route 42 ms). Other provinces and island-scale datasets (all of Sumatra / Java) remain unmeasured and unbuilt. Nationwide coverage is **not** claimed. |
| OSM completeness | Roads, one-ways, addresses and businesses in Indonesia may be missing or wrong in OpenStreetMap. The app says so and never implies completeness. |
| One region at a time | Routes cannot cross region boundaries; both ends must be inside one installed region (`DIFFERENT_REGIONS`). |
| No ferries / cross-island links | Indonesia's road graph is largely per island; a strait crossing is reported as "no route in downloaded data". |
| Sea and large lakes not drawn | OSM multipolygon relations are not rendered. |

## Routing and navigation

| Limitation | Detail |
|---|---|
| Car profile only | No motorcycle (dominant in Indonesia), bicycle or walking routes. |
| Turn restrictions: simple ones only | Via-node restrictions are applied (Monaco: 27/27 relations, 35 forbidden pairs). Via-way, conditional (time-based) restrictions and loop-way cases are **not** applied; the manifest lists what was skipped and why. |
| Snapping to nearest node | Start/end snap to the nearest road *node*, not the nearest segment: can be wrong on sparse nodes or parallel roads. |
| ETAs are heuristic | Default speeds per road class and `maxspeed` tags; no traffic and not calibrated for Indonesia. Labelled approximate in the UI. |
| One route, no alternatives | No alternative-route search yet. |
| Performance on real islands/phones unknown | Plain A\* on the main thread (no worker yet). A synthetic benchmark (`docs/measurements.md`) shows query time tracking route length (~0.2–0.35 s for ~100 km at 4–9M nodes, server CPU) and memory growing linearly (~1.1 GB at 9M nodes) — so memory, not CPU, is the likely limit on phones. Real island sizes and phone behaviour are **unmeasured**. |
| GPS | Drift, tunnels and dense areas affect deviation detection. A laptop without GNSS typically has no offline position. Browsers throttle location when the screen is off; a Wake Lock is requested but not guaranteed. Not tested on real hardware. |
| No voice guidance | Visual instructions only (as scoped in the brief). |

## Storage and platform

| Limitation | Detail |
|---|---|
| Browser storage can be evicted | Persistent storage is requested but may be denied. iOS Safari limits and eviction behaviour are **not verified**. The app re-verifies stored files on demand and reports missing ones. |
| Big files are held in memory | A download is buffered in one preallocated buffer (~1× file size) and stored as one IndexedDB record; the file is then hashed whole. Fine for Monaco-size data; for graphs of hundreds of MB, chunked segments with per-chunk hashes are needed. |
| Pause/resume is per file | A partially downloaded *file* restarts; verified files are kept. Range-based resume inside a large file is not implemented. |
| No schema migrations yet | IndexedDB schema is v1; the upgrade path is untested because there is nothing to upgrade from. |

## Quality gaps

- Accessibility: automated axe checks (WCAG 2.x A/AA rules, all screens, both themes) pass; that covers only the machine-detectable subset. Manual keyboard and screen-reader testing has not been done.
- No real-device testing of any kind.
- Only Chromium is exercised by the e2e suite.

## Future improvements (in rough priority order)

1. **Measure real Indonesian regions** (sizes, build time, memory, query time, iOS/Android behaviour) and revisit ADR 0001.
2. Snap to road segments; rejoin the route properly after a deviation.
3. Streaming/partitioned pipeline for the largest islands; PMTiles vector tiles for rendering.
4. Routing in a Web Worker; contraction hierarchies (WASM) or a tiled graph if measurements demand it.
5. Motorcycle profile; alternative routes; border links between adjacent regions and ferries.
6. Via-way and conditional turn restrictions.
7. Manual accessibility testing (keyboard, screen reader); schema migration tests; Firefox/WebKit e2e.
