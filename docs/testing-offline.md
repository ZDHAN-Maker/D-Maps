# Guide: testing D'Maps without internet

Principle: "works offline" is proven three independent ways, because the browser's offline switch alone can hide a leak
(a request that fails silently, or is answered by a cache).

1. **The network is off** (browser offline mode) and the app is reloaded from a cold start.
2. **Every request that leaves localhost is aborted and recorded**; the test fails if any occurred.
3. **Search and routing must make zero requests**, even to localhost — they run on data already in IndexedDB.

A static lint rule additionally forbids `http(s)://` literals in app code (`eslint.config.js`).

## Automated

```bash
npm test                    # unit + integration (165+ tests): search, routing, turn restrictions, storage, GPS, navigation
cd pipeline && .venv/bin/python -I -m pytest -q      # pipeline tests
npm run test:e2e            # Playwright against the production build (service worker only exists there)
# in a sandbox with a pre-installed browser:  DMAPS_CHROMIUM=/path/to/chromium npm run test:e2e
```

What the end-to-end tests cover (`e2e/`):

| Spec | Proves |
|---|---|
| `offline.spec.ts` | Install data → go offline → cold reload → map draws → search → route + instructions (id/en) → zero requests for search+routing, nothing leaves localhost; failed and corrupt downloads are reported; **negative control**: with the service worker blocked, an offline reload must fail (so the main test cannot pass vacuously) |
| `manager.spec.ts` | Offline Map Manager: region tree, per-component status, verify, delete, pause/resume (verified files are not re-downloaded), offline behaviour, settings/theme/language persistence, search history, About screen |
| `navigation.spec.ts` | GPS following with simulated and device positions, next-maneuver changes, deviation → offline reroute, arrival summary, permission denied, stale position, clearly labelled simulation mode |
| `pwa.spec.ts` | Manifest is installable-shaped, every declared icon is served, the service worker precaches the app shell but **not** map datasets |

Unit/integration tests worth knowing about: routing is cross-checked against an independent Dijkstra (including random
grids with random turn restrictions), datasets are verified by SHA-256, interrupted downloads resume, corrupt or
missing files are detected.

## Manual, in a normal browser

1. `npm run build && npm run preview`, open <http://127.0.0.1:4173>.
2. Offline Map Manager → install the Monaco test data (or a region you built).
3. Reload once so the service worker takes control (check DevTools → Application → Service Workers).
4. DevTools → Network → *Offline* (or real airplane mode), reload.
5. Check: app opens, map draws, search finds places, a route appears with instructions, the Offline Map Manager still lists
   what is installed and says the catalog may be out of date.
6. DevTools → Network: confirm there are no failing requests to other hosts while you search and route.

## Needs real hardware (not automatable here)

| What | Why | How |
|---|---|---|
| Real GPS accuracy, heading, drift | The GNSS chip only exists on a device | Phone, outdoors, drive or walk a known route; compare against the route line |
| Background / screen-off behaviour | Browsers throttle geolocation when the page is hidden | Navigate with the screen locked; the app asks for a Wake Lock but support varies |
| iOS Safari storage quota and eviction | Differs from Chromium | Install a region on an iPhone (browser and installed home-screen app), return after several days, run *Verify* |
| Peak memory loading a large region | Depends on the device | Chrome remote debugging → Memory tab on a mid-range Android phone |
| Laptop offline position | Laptops usually have no GNSS; browsers use online Wi-Fi/IP lookup | Expect "location unavailable" offline and use map selection |

Geolocation needs a secure context: `localhost` works, but a phone on your LAN needs HTTPS (a local dev certificate) or
USB port forwarding (`chrome://inspect` → port forwarding).

## Simulated GPS

The navigation view has an explicitly labelled **simulation mode** that drives the route with synthetic positions, and the
e2e tests also inject device positions through Playwright's geolocation emulation. These prove the app's logic (progress,
maneuver changes, deviation, reroute, arrival), not the quality of a real GPS signal.

## What is not covered yet

Cache/IndexedDB schema upgrade paths (the schema is still v1 with no migrations to test), manual accessibility testing
(keyboard, screen reader — only automated axe checks exist, in `e2e/a11y.spec.ts`), real-device runs, and anything on Indonesian data.
