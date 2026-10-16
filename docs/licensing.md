# Licensing and attribution

This is a summary for the project owner, not legal advice.

## Map data — OpenStreetMap (ODbL 1.0)

- Source: © OpenStreetMap contributors, Open Database License 1.0 (<https://www.openstreetmap.org/copyright>).
- **Attribution** is shown in the map corner, in the About screen, and stored in every dataset manifest
  (`attribution`, `license`). The app refuses a manifest without attribution.
- **Derived datasets**: `graph.bin`, `places.json`, `features.json`, `turns.bin` are derived databases. If you distribute them
  publicly, offer them under the ODbL and keep the notice. Personal use on your own devices does not distribute anything.
- **Rendered maps** (screenshots, exports) are produced works: attribution is required.
- Keep the source file's provenance in the manifest (`source.file`, `source.sha256`, `source.note`).
- Use legitimate data sources. Never bulk-download from the public OSM tile servers or APIs, and follow the terms of
  whichever extract host you use.

## Test fixture

`data/fixtures/monaco/monaco.osm.pbf` is the OSRM project's Monaco test extract (OSM data via Geofabrik), used only to
validate the engine. It is **not** Indonesian data and is labelled as a test fixture in the app.

## Software dependencies

Runtime dependencies are all permissive (MIT, ISC, BSD-2-Clause). The complete list with full licence texts is generated
into `docs/THIRD_PARTY_NOTICES.md` by `scripts/gen_notices.mjs`, and a table is shown in the About screen
(`src/about/notices.json`). Regenerate after changing dependencies. Build and test tools (Vite, Vitest, Playwright,
TypeScript, ESLint) and the Python pipeline library `pyosmium` (BSD-2-Clause) are not shipped to users.

## The project's own licence

Undecided: `package.json` says `UNLICENSED`. Options: keep it private; MIT/Apache-2.0 if you want others to reuse it
(compatible with all dependencies above); a copyleft licence if you want improvements shared back. Decide before publishing
the repository or any dataset.

## Logo

The D'Maps logo and icons (`public/icons/`) are original artwork made for this project.
