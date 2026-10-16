# ADR 0001 — Offline routing engine

- **Status:** Accepted for the proof of concept and regional datasets. **Re-evaluate** after the Phase 4 measurements (see "Revisit triggers").
- **Date:** 2026-10-11
- **Deciders:** project owner (SHIWA)

## Context

D'Maps must calculate routes with **no network and no server**, on both a laptop browser and a
mid-range phone, inside an installable PWA. "Nationwide Indonesia" is a long-term target.

Hard constraints from the product brief:

1. Runs in a browser / PWA (laptop **and** mobile). No native app, no companion server for core features.
2. Free and open-source, licence-compatible with ODbL data.
3. Route geometry **and** turn-by-turn instructions, one-way and access restrictions honoured.
4. Never silently fall back to an online API.

## Options considered

Assessments below come from the projects' public design, not from benchmarks run here (the
sandbox cannot reach OSM data hosts — see `docs/measurements.md`). Only the custom engine was
actually built and measured.

| # | Option | Runs in browser/PWA on phone? | Offline | Memory/storage model | Nationwide fit | Data prep | Licence | Verdict |
|---|---|---|---|---|---|---|---|---|
| A | **Custom TypeScript router** (A\* on a compact CSR graph in typed arrays) | Yes, any modern browser; worker-friendly | Yes | Whole regional graph in RAM: ~19 B/edge + ~37 B/node (formula from the code) | Per island/province datasets now; needs CH or tiling for large islands | We own the pipeline (pyosmium → `graph.bin`) | Ours (deps MIT/BSD/ISC) | **Chosen** |
| B | OSRM | No browser build. C++ server; designed to hold the whole dataset in memory | Only via local server | Heavy RAM for large extracts | Good on a server | `osrm-extract/partition/customize` | BSD-2 | Rejected: needs a process the PWA cannot start; fails the phone requirement |
| C | GraphHopper | No browser build. Java; could only run in a browser via a JVM-to-JS/WASM layer (heavy, unproven for this) | Only via local server / Android app | JVM heap | Good on a server | Import step builds graph on disk | Apache-2.0 | Rejected for the web PWA; remains a good **reference oracle** for validating our routes |
| D | Valhalla | No maintained, verifiable browser build known to me. C++ with hierarchical **tiles** (the right idea for offline) | Only via local server / native | Tile-based, loads on demand | Good | `valhalla_build_tiles` | MIT | Rejected as a dependency; its tile model informs our Phase 4 design |
| E | Rust/C++ routing library compiled to WASM (e.g. contraction-hierarchy crates) | Yes, if the library compiles cleanly to wasm32 | Yes | Compact CH graphs | Good (CH is fast on big graphs) | We write the glue + CH preprocessing | Varies (permissive options exist) | **Planned upgrade path** if A's query time/RAM fail at island scale |
| F | Local OSRM/GraphHopper on the laptop + PWA as client | Laptop only | Yes (local) | Server RAM | Good | Per-engine | — | Rejected: no phone story, extra install burden |
| G | Online routing API | Yes | **No** | — | — | — | — | Forbidden by the brief |

## Decision

Use **Option A**: a pure-TypeScript routing engine over a compact, versioned binary graph
(`graph.bin`, format v1), prepared offline by our own Python pipeline from OpenStreetMap PBF.

Why:

- It is the only option that demonstrably satisfies "runs in a PWA on a phone with no server" today,
  and it is already implemented and tested (see `tests/routing.*.test.ts`: A\* is checked against a
  reference Dijkstra on random pairs, one-ways, roundabouts, access restrictions).
- It keeps the engine, the data format, and the instruction generator under our control, which
  matters for a learning project and for honest limitation reporting.
- The graph format is engine-agnostic enough to feed a WASM CH engine later (Option E) without
  changing the pipeline's source-of-truth step.

## Consequences

Accepted costs / known gaps (all also recorded in each dataset's `manifest.json` `limitations`):

1. **Only simple turn restrictions are applied** (via-node, from `turns.bin`; added after this ADR was first written).
   Via-way and conditional (time-based) restrictions are not, so the router may still use a banned turn in those cases.
2. **Snapping goes to the nearest graph node, not the nearest road segment.** Planned: edge snapping.
3. **ETAs are heuristic** (class defaults + `maxspeed` tags), not traffic-aware, and not calibrated to Indonesia.
4. **No alternatives route** yet (single best path). Planned: penalty-based alternatives.
5. **Ferries and cross-island links are not in the graph.** Indonesia is an archipelago; road graphs are
   largely per-island. A route across a strait is reported as "no route in downloaded data", never faked.
6. **Plain A\* may not scale unchanged to the largest islands.** Real Java/Sumatra graph sizes are **unmeasured**.
   See the update below for what synthetic benchmarks show.

## Revisit triggers (switch to Option E or a tiled graph)

Re-open this ADR if, on real Indonesian data and a mid-range phone, any of these is true:

- loading a single island's graph exceeds the memory the browser tab can reliably hold
  (the app would be killed), or
- p95 route query time on long routes is above ~1 s, or
- IndexedDB cannot hold the graph on a target browser (notably iOS Safari) within its storage quota.

The measurement procedure is in `docs/measurements.md`.

## Update 2026-10-15 — synthetic scale benchmark

`npm run perf:scale` (synthetic hierarchical grids, 0.25M–9M nodes, server CPU; details and caveats in `docs/measurements.md`):

- Query time is driven mainly by **route length**, with a ~2× penalty on the largest graphs (cache effects, not investigated): ~100 km routes took ~0.22–0.34 s p50 at 4M–9M nodes. The "p95 > 1 s" trigger
  was not approached.
- Memory is linear in graph size: router arrays ~120 MB at 1M nodes, ~1.1 GB at 9M. The **memory trigger is the likely one to fire first**
  on phones, not the CPU trigger.

Consequence for the decision: Option A stays, but the expected next step for large islands is a **segmented/tiled graph** (load only
the tiles a route needs), not contraction hierarchies. CH moves down the list unless real-phone long-route timings say otherwise.
This remains a hypothesis about real islands until Indonesian data is built and measured.
