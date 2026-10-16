import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CatalogError, buildTree, bytesByComponent, componentOf, datasetBaseUrl, datasetsUnder, displayName, validateCatalog,
  type CatalogFile,
} from '../src/regions/catalog';
import { RegionSet, type RegionRuntime } from '../src/regions/regionSet';
import { RoutingEngine } from '../src/routing';
import { SearchIndex } from '../src/search';
import { loadDataset, MONACO_DIR } from './helpers/loadDataset';

const catalog = JSON.parse(readFileSync(join(MONACO_DIR, '..', 'catalog.json'), 'utf8')) as CatalogFile;

describe('catalog', () => {
  it('the shipped catalog.json is valid and agrees with the Monaco manifest', () => {
    const c = validateCatalog(catalog);
    const m = c.regions.find((r) => r.id === 'monaco');
    const manifest = JSON.parse(readFileSync(join(MONACO_DIR, 'manifest.json'), 'utf8'));
    expect(m?.kind).toBe('dataset');
    if (m?.kind === 'dataset') {
      expect(m.dataVersion).toBe(manifest.dataVersion);
      expect(m.files).toEqual(manifest.files);
    }
  });

  it('keeps an empty Indonesia group so the UI can say nothing is available yet', () => {
    const roots = buildTree(validateCatalog(catalog).regions);
    const indonesia = roots.find((n) => n.region.id === 'indonesia');
    expect(indonesia?.children).toEqual([]);
    expect(datasetsUnder(indonesia!)).toEqual([]);
    const fixtures = roots.find((n) => n.region.id === 'test-fixtures');
    expect(datasetsUnder(fixtures!).map((d) => d.id)).toEqual(['monaco']);
  });

  const mutate = (fn: (c: CatalogFile) => void) => { const c = structuredClone(catalog); fn(c); return c; };
  it.each([
    ['wrong format', (c: CatalogFile) => { (c as { formatVersion: number }).formatVersion = 2; }, /unsupported catalog format/],
    ['duplicate id', (c: CatalogFile) => { c.regions.push({ ...c.regions[0] }); }, /duplicate region id/],
    ['unknown parent', (c: CatalogFile) => { c.regions[2].parent = 'nowhere'; }, /unknown parent/],
    ['path-traversal file name', (c: CatalogFile) => { const d = c.regions[2]; if (d.kind === 'dataset') d.files[0].name = '../evil'; }, /invalid file entry/],
    ['bytes mismatch', (c: CatalogFile) => { const d = c.regions[2]; if (d.kind === 'dataset') d.bytes += 1; }, /does not equal the sum/],
    ['bad dataVersion', (c: CatalogFile) => { const d = c.regions[2]; if (d.kind === 'dataset') d.dataVersion = 'xyz'; }, /invalid dataVersion/],
  ])('rejects %s', (_n, fn, re) => {
    expect(() => validateCatalog(mutate(fn))).toThrow(CatalogError);
    expect(() => validateCatalog(mutate(fn))).toThrow(re);
  });

  it('maps files to the four storage classes and sums them', () => {
    expect(componentOf('graph.bin')).toBe('routing');
    expect(componentOf('ways.json')).toBe('routing');
    expect(componentOf('places.json')).toBe('search');
    expect(componentOf('features.json')).toBe('rendering');
    expect(componentOf('mystery.dat')).toBe('other');
    const d = catalog.regions.find((r) => r.id === 'monaco');
    if (d?.kind !== 'dataset') throw new Error('monaco missing');
    const sums = bytesByComponent(d.files);
    expect(sums.routing + sums.search + sums.rendering + sums.other).toBe(d.bytes);
    expect(sums.other).toBe(0);
  });

  it('localises names with a fallback and builds download URLs', () => {
    expect(displayName({ name: 'Uji', names: { en: 'Test' } }, 'en')).toBe('Test');
    expect(displayName({ name: 'Uji', names: { en: 'Test' } }, 'id')).toBe('Uji');
    const d = catalog.regions.find((r) => r.kind === 'dataset');
    if (d?.kind !== 'dataset') throw new Error('no dataset');
    expect(datasetBaseUrl(d, '/data/')).toBe('/data/monaco');
    expect(datasetBaseUrl({ ...d, baseUrl: '/cdn/m' }, '/data')).toBe('/cdn/m');
  });
});

describe('RegionSet', () => {
  const ds = loadDataset();
  const monaco: RegionRuntime = {
    id: 'monaco', name: 'Monaco', bbox: ds.manifest.bbox,
    engine: new RoutingEngine(ds.graph, { bbox: ds.manifest.bbox }), index: new SearchIndex(ds.places),
    features: { scale: 1e6, roads: [], buildings: [], water: [], green: [], coast: [] },
  };
  // a second, unrelated region far away (Jambi-ish) with its own tiny index and a router that must never be called
  const far: RegionRuntime = {
    id: 'far', name: 'Far', bbox: [-1.8, 103.4, -1.4, 103.8],
    engine: { route: () => { throw new Error('far router must not be used for Monaco points'); } },
    index: new SearchIndex([{ i: 0, n: 'Casino Kota', k: 'poi', c: 'attraction', la: -1.6, lo: 103.6 }]),
    features: monaco.features,
  };
  const set = new RegionSet([far, monaco]);
  const casino = { lat: 43.73926, lon: 7.428548 };
  const beach = { lat: 43.720623, lon: 7.394386 };

  it('routes inside the region that contains both points', () => {
    const r = set.route(casino, beach);
    expect(r.ok).toBe(true);
  });

  it('says so when the points are in two different downloaded regions', () => {
    const r = set.route(casino, { lat: -1.6, lon: 103.6 });
    expect(r).toEqual({ ok: false, code: 'DIFFERENT_REGIONS' });
  });

  it('says outside-dataset when a point is in no downloaded region', () => {
    expect(set.route(casino, { lat: 0, lon: 0 })).toEqual({ ok: false, code: 'OUTSIDE_DATASET' });
    expect(new RegionSet([]).route(casino, beach)).toEqual({ ok: false, code: 'OUTSIDE_DATASET' });
  });

  it('merges search across regions and tags each hit with its region', () => {
    const hits = set.search('casino', { limit: 50 });
    const regions = new Set(hits.map((h) => h.regionId));
    expect(regions).toEqual(new Set(['monaco', 'far']));
    expect(hits.find((h) => h.regionId === 'far')?.place.n).toBe('Casino Kota');
  });

  it('category browsing sorts by distance from the reference point across regions', () => {
    const hits = set.search('', { category: 'attraction', near: { lat: -1.6, lon: 103.6 }, limit: 5 });
    expect(hits[0].regionId).toBe('far');
    const d = hits.map((h) => h.distanceM as number);
    expect([...d].sort((a, b) => a - b)).toEqual(d);
  });

  it('prefers the smaller region when bounding boxes overlap, and falls back if it cannot route', () => {
    const big: RegionRuntime = { ...monaco, id: 'big', bbox: [43.0, 7.0, 44.0, 8.0], engine: { route: () => ({ ok: false, code: 'NO_ROUTE' }) } };
    const overlap = new RegionSet([big, monaco]);
    expect(overlap.regions[0].id).toBe('monaco');
    expect(overlap.route(casino, beach).ok).toBe(true);
    const onlyBig = new RegionSet([big]);
    expect(onlyBig.route(casino, beach)).toEqual({ ok: false, code: 'NO_ROUTE' });
  });
});
