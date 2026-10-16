import { haversineM } from '../routing/geo';
import { fold, tokenize } from './normalize';

export type PlaceKind = 'poi' | 'street' | 'area' | 'address';

export interface PlaceRecord {
  i: number;
  n: string;
  k: PlaceKind;
  c: string;
  la: number;
  lo: number;
  a?: string;
  /** hospitals only: whether OSM maps an emergency department */
  em?: 'yes' | 'no';
}

export interface SearchOptions {
  category?: string;
  near?: { lat: number; lon: number };
  limit?: number;
}

export interface SearchHit {
  place: PlaceRecord;
  score: number;
  distanceM?: number;
}

const KIND_WEIGHT: Record<PlaceKind, number> = { poi: 1.0, area: 1.2, street: 0.8, address: 0.6 };
const MAX_POSTINGS_PER_TOKEN = 20_000;

/**
 * In-memory inverted index over one dataset's places. Built once at load; queries are
 * O(matching postings). Larger-than-region datasets are sharded per region (docs/architecture.md).
 */
export class SearchIndex {
  private readonly vocab: string[];
  private readonly postings: Int32Array[];
  private readonly folded: string[];
  readonly size: number;

  constructor(private readonly places: PlaceRecord[]) {
    this.size = places.length;
    const map = new Map<string, number[]>();
    this.folded = new Array<string>(places.length);
    places.forEach((p, idx) => {
      this.folded[idx] = fold(p.n);
      const seen = new Set<string>();
      for (const t of tokenize(p.n)) {
        if (seen.has(t)) continue;
        seen.add(t);
        let list = map.get(t);
        if (!list) map.set(t, (list = []));
        list.push(idx);
      }
    });
    this.vocab = [...map.keys()].sort();
    this.postings = this.vocab.map((t) => Int32Array.from(map.get(t) as number[]));
  }

  /** Index range [lo, hi) of vocabulary entries starting with prefix. */
  private range(prefix: string): [number, number] {
    const v = this.vocab;
    let lo = 0, hi = v.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (v[m] < prefix) lo = m + 1; else hi = m; }
    const start = lo;
    hi = v.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (v[m].startsWith(prefix) || v[m] < prefix) lo = m + 1; else hi = m; }
    return [start, lo];
  }

  search(query: string, opts: SearchOptions = {}): SearchHit[] {
    const limit = opts.limit ?? 20;
    const qTokens = tokenize(query);
    const cat = opts.category;
    let candidates: Map<number, number>; // place index -> match score

    if (qTokens.length === 0) {
      // no text: "nearby <category>" browsing
      if (!cat) return [];
      candidates = new Map();
      this.places.forEach((p, idx) => { if (p.c === cat) candidates.set(idx, 0); });
    } else {
      let acc: Map<number, number> | null = null;
      for (const qt of qTokens) {
        const [lo, hi] = this.range(qt);
        const hit = new Map<number, number>();
        for (let t = lo; t < hi; t++) {
          const w = this.vocab[t] === qt ? 3 : 1;
          const list = this.postings[t];
          const n = Math.min(list.length, MAX_POSTINGS_PER_TOKEN);
          for (let k = 0; k < n; k++) {
            const idx = list[k];
            if (hit.get(idx) === undefined || (hit.get(idx) as number) < w) hit.set(idx, w);
          }
        }
        if (acc === null) acc = hit;
        else {
          const next = new Map<number, number>();
          for (const [idx, s] of acc) { const h = hit.get(idx); if (h !== undefined) next.set(idx, s + h); }
          acc = next;
        }
        if (acc.size === 0) return [];
      }
      candidates = acc as Map<number, number>;
    }

    const qFold = fold(query).trim();
    const hits: SearchHit[] = [];
    for (const [idx, base] of candidates) {
      const p = this.places[idx];
      if (cat && p.c !== cat) continue;
      let score = base * KIND_WEIGHT[p.k];
      const name = this.folded[idx];
      if (qFold && name === qFold) score += 6;
      else if (qFold && name.startsWith(qFold)) score += 3;
      const hit: SearchHit = { place: p, score };
      if (opts.near) {
        const d = haversineM(opts.near.lat, opts.near.lon, p.la, p.lo);
        hit.distanceM = d;
        // gentle distance preference: a nearby partial match beats a far one, but never beats an exact name
        hit.score += 2 / (1 + d / 2000);
      }
      hits.push(hit);
    }
    hits.sort((a, b) => b.score - a.score
      || (a.distanceM ?? 0) - (b.distanceM ?? 0)
      || a.place.n.localeCompare(b.place.n) || a.place.i - b.place.i);
    // "nearby category" browsing sorts purely by distance
    if (qTokens.length === 0 && opts.near) hits.sort((a, b) => (a.distanceM as number) - (b.distanceM as number));
    return hits.slice(0, limit);
  }
}
export * from './history';
