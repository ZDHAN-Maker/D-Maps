# D'Maps

> Jelajah Indonesia, Kapan Saja, Di Mana Saja.

Personal offline-first navigation web app (React + Vite + TypeScript + Leaflet, PWA). Map data comes from
OpenStreetMap, is installed into the browser (IndexedDB), and routing/search/navigation run locally with no server.

## Honest status (2026-10-14)

**Working and tested, on the Monaco test extract only** (real OSM data, **not** Indonesian):

- [x] Offline vector map drawn from installed data (no tile server); light/dark theme
- [x] Offline place search: names, streets, categories, Indonesian abbreviations, distance, history and recent destinations
- [x] Offline routing with turn-by-turn instructions (Bahasa Indonesia / English), simple turn restrictions applied
- [x] GPS following, next-maneuver card, deviation detection and offline reroute, arrival summary, stale/denied-permission handling;
      a clearly labelled **simulation mode** for laptops without GNSS
- [x] Offline Map Manager: region tree, per-component status (rendering / routing / search), pause, resume, verify, delete
- [x] Settings, About, attribution and third-party notices; installable PWA with icons
- [x] App reloads and works with the network off, proven by Playwright (and a negative control proving the test can fail)
- [x] Automated accessibility audit (axe) of all screens in both themes, with a negative control

**Not done / not verified:**

- [ ] **Indonesian data: nothing built or measured.** Storage sizes, memory and route speed for real regions are unknown.
      The build sandbox cannot reach OSM data hosts. **Nationwide coverage is not claimed.**
- [ ] No real-device testing (GPS hardware, iOS Safari storage, mid-range Android). Only Chromium is exercised.
- [ ] Accessibility: the automated axe audit (WCAG 2.x A/AA; every screen, light and dark) passes, but manual keyboard and
      screen-reader testing has **not** been done.
- [ ] Phase 4 (nationwide pipeline: streaming build for large islands, vector tiles, routing in a worker) not started.

Full list with detail: [`docs/limitations.md`](docs/limitations.md).

## Setup

Requirements: Node 22+, Python 3.10+ (pipeline only).

```bash
npm ci                                   # app dependencies
npx playwright install chromium          # e2e only (skip if you have Chromium; see DMAPS_CHROMIUM)

cd pipeline && python3 -m venv .venv && .venv/bin/pip install -e '.[dev]' && cd ..   # dataset builder
```

## Daily commands

| Task | Command |
|---|---|
| Dev server | `npm run dev` (the service worker only exists in the production build) |
| Typecheck / lint | `npm run typecheck` · `npm run lint` |
| Unit + integration tests | `npm test` |
| Pipeline tests | `cd pipeline && .venv/bin/python -I -m pytest -q` |
| Production build + preview | `npm run build && npm run preview` → <http://127.0.0.1:4173> |
| Offline e2e | `npm run test:e2e` (set `DMAPS_CHROMIUM=/path/to/chromium` to use an existing browser) |
| Rebuild the Monaco dataset | `npm run data:monaco` |
| Rebuild the region catalog | `npm run data:catalog` |
| Measure dataset size | `npm run measure:data -- public/data/monaco` |
| Timing measurements | `npm run perf` → `docs/measurements/perf-monaco.json` |
| Synthetic router scale benchmark | `npm run perf:scale` (minutes; needs ~2 GB RAM) → `docs/measurements/perf-synthetic-scale.json` |
| Regenerate third-party notices | `npm run notices` |

## Try it offline by hand

1. `npm run build && npm run preview`, open <http://127.0.0.1:4173>.
2. Open the **Regions** tab, download **Monaco (test fixture)**, wait for "Terpasang".
3. Reload once (so the service worker takes control), then go fully offline (DevTools → Network → Offline, or airplane mode).
4. Reload. The map, search ("casino", "balmoral"), routing and navigation still work. On a laptop use the
   simulation button; a phone's GPS works without internet but needs HTTPS or `localhost`.

DevTools' offline switch is only a convenience: the automated tests also abort and record every request to a non-local
origin and assert that search and routing perform **zero** requests of any kind. Details: [`docs/testing-offline.md`](docs/testing-offline.md).

## Using real Indonesian data (your machine)

Not run here (see above). Follow [`docs/data-guide.md`](docs/data-guide.md): get a legitimate extract (start with one
province), build it with the pipeline, measure it with `npm run measure:data`, and record the numbers in
[`docs/measurements.md`](docs/measurements.md). The pipeline is single-process and in-memory: fine for a province, not
expected to handle Java or Sumatra yet.

## Privacy

No accounts, analytics or tracking. GPS positions are used in memory for navigation and are neither stored nor sent anywhere.
Preferences, search history and downloaded map data stay in the browser and can be cleared. The network is used only to
download the region list and map data.

## Docs

| Doc | Content |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | Layers, offline routing, nationwide data strategy, phases, risks, open decisions |
| [`docs/adr/0001-offline-routing-engine.md`](docs/adr/0001-offline-routing-engine.md) | Engine comparison and decision |
| [`docs/measurements.md`](docs/measurements.md) | What was measured, what was not, how to measure the rest |
| [`docs/data-guide.md`](docs/data-guide.md) | Downloading and preparing map data |
| [`docs/testing-offline.md`](docs/testing-offline.md) | Testing without internet; what needs real hardware |
| [`docs/limitations.md`](docs/limitations.md) | Known limitations and future work |
| [`docs/licensing.md`](docs/licensing.md), [`docs/THIRD_PARTY_NOTICES.md`](docs/THIRD_PARTY_NOTICES.md) | Licences and attribution |

## Licence

Map data © OpenStreetMap contributors, ODbL 1.0 (derived datasets must keep this notice). The project's own licence is
undecided (`UNLICENSED` in `package.json`).
