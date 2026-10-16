import { describe, expect, it } from 'vitest';
import { SearchIndex, type PlaceRecord } from '../src/search/index';
import { fold, tokenize } from '../src/search/normalize';
import { loadDataset } from './helpers/loadDataset';

const mk = (i: number, n: string, c = 'poi', k: PlaceRecord['k'] = 'poi', la = 0, lo = 0): PlaceRecord => ({ i, n, k, c, la, lo });

describe('normalisation', () => {
  it('folds case and diacritics', () => {
    expect(fold('Hôpital Monégasque')).toBe('hopital monegasque');
  });
  it('expands Indonesian abbreviations on both sides', () => {
    expect(tokenize('Jl. Jenderal Sudirman')).toEqual(['jalan', 'jenderal', 'sudirman']);
    expect(tokenize('RSUD Raden Mattaher')).toEqual(['rumah', 'sakit', 'umum', 'daerah', 'raden', 'mattaher']);
    expect(tokenize('Gg. Mawar No.5')).toEqual(['gang', 'mawar', 'no', '5']);
  });
});

describe('SearchIndex', () => {
  const idx = new SearchIndex([
    mk(0, 'Jalan Jenderal Sudirman', 'street', 'street'),
    mk(1, 'Rumah Sakit Umum Daerah Raden Mattaher', 'hospital'),
    mk(2, 'Apotek Kimia Farma', 'pharmacy'),
    mk(3, 'Sudirman Cafe', 'restaurant'),
    mk(4, 'Pasar Angso Duo', 'shop'),
    mk(5, 'Hôtel de Paris', 'hotel'),
  ]);

  it('matches abbreviations to full names and vice versa', () => {
    expect(idx.search('Jl Sudirman')[0].place.i).toBe(0);
    expect(idx.search('RSUD mattaher')[0].place.i).toBe(1);
  });
  it('supports prefix matching for suggestions', () => {
    expect(idx.search('apot')[0].place.i).toBe(2);
    expect(idx.search('pas ang')[0].place.i).toBe(4);
  });
  it('requires every query word to match (AND)', () => {
    expect(idx.search('sudirman farma')).toEqual([]);
  });
  it('is diacritic-insensitive', () => {
    expect(idx.search('hotel paris')[0].place.i).toBe(5);
    expect(idx.search('HÔTEL')[0].place.i).toBe(5);
  });
  it('returns nothing for gibberish and empty queries without a category', () => {
    expect(idx.search('zzzqqq')).toEqual([]);
    expect(idx.search('')).toEqual([]);
  });
  it('filters by category', () => {
    const r = idx.search('sudirman', { category: 'restaurant' });
    expect(r.map((h) => h.place.i)).toEqual([3]);
  });
  it('ranks an exact name above a prefix match', () => {
    const i2 = new SearchIndex([mk(0, 'Pasar Baru Plaza'), mk(1, 'Pasar Baru')]);
    expect(i2.search('pasar baru')[0].place.i).toBe(1);
  });
  it('lists nearest places of a category when the query is empty', () => {
    const i3 = new SearchIndex([
      mk(0, 'SPBU Jauh', 'fuel', 'poi', -1.70, 103.70), mk(1, 'SPBU Dekat', 'fuel', 'poi', -1.6001, 103.6001),
      mk(2, 'Bukan SPBU', 'pharmacy', 'poi', -1.6001, 103.6001),
    ]);
    const r = i3.search('', { category: 'fuel', near: { lat: -1.6, lon: 103.6 } });
    expect(r.map((h) => h.place.i)).toEqual([1, 0]);
    expect(r[0].distanceM).toBeLessThan(30);
  });
});

describe('search on real OSM places (Monaco fixture)', () => {
  const ds = loadDataset();
  const idx = new SearchIndex(ds.places);
  it('finds a known landmark offline', () => {
    const hit = idx.search('casino de monte carlo')[0];
    expect(hit.place.n).toBe('Casino de Monte Carlo');
    expect(hit.place.c).toBe('attraction');
  });
  it('finds streets with diacritics from plain ASCII input', () => {
    expect(idx.search('avenue de la gare').some((h) => h.place.k === 'street')).toBe(true);
  });
  it('lists hospitals with their emergency flag', () => {
    const r = idx.search('', { category: 'hospital', limit: 10 });
    expect(r.length).toBeGreaterThan(0);
    expect(r.some((h) => h.place.em === 'no')).toBe(true);
  });
  it('reports a missing place as no results (UI explains the data gap)', () => {
    expect(idx.search('Warung Padang Sederhana Jambi')).toEqual([]);
  });
});

describe('search performance on synthetic scale (measured, synthetic data)', () => {
  it('indexes and queries 200k generated places', () => {
    const words = ['jalan', 'raya', 'pasar', 'baru', 'lama', 'sudirman', 'ahmad', 'yani', 'merdeka', 'mawar', 'melati', 'kenanga',
      'rumah', 'sakit', 'umum', 'apotek', 'toko', 'warung', 'makan', 'padang', 'sederhana', 'indah', 'jaya', 'abadi', 'sentosa'];
    const places: PlaceRecord[] = [];
    let seed = 1;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 200_000; i++) {
      const n = 2 + Math.floor(rnd() * 3);
      const name = Array.from({ length: n }, () => words[Math.floor(rnd() * words.length)]).join(' ') + ' ' + i;
      places.push(mk(i, name, i % 7 === 0 ? 'fuel' : 'poi', 'poi', -1 + rnd(), 103 + rnd()));
    }
    const t0 = performance.now();
    const index = new SearchIndex(places);
    const buildMs = performance.now() - t0;
    const times: number[] = [];
    for (const q of ['jalan sudirman', 'pasar bar', 'rumah sakit', 'warung padang sed', 'apo']) {
      const t = performance.now();
      const r = index.search(q, { near: { lat: -0.5, lon: 103.5 } });
      times.push(performance.now() - t);
      expect(r.length).toBeGreaterThan(0);
    }
    console.log(`[perf] search synthetic n=200000 buildMs=${buildMs.toFixed(0)} queryMs=${times.map((x) => x.toFixed(1)).join('/')}`);
    expect(buildMs).toBeLessThan(20_000);
  }, 60_000);
});
