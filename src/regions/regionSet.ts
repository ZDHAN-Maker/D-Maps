import type { LatLon, RouteError, RouteResult } from '../routing';
import type { LocalRouter } from '../navigation';
import type { PlaceRecord, SearchHit, SearchIndex, SearchOptions } from '../search';
import type { FeaturesFile } from '../map/features';

export type BBox = [minLat: number, minLon: number, maxLat: number, maxLon: number];

export interface RegionRuntime {
  id: string;
  name: string;
  bbox: BBox;
  engine: LocalRouter;
  index: Pick<SearchIndex, 'search'>;
  features: FeaturesFile;
  places?: PlaceRecord[];
}

export interface RegionHit extends SearchHit { regionId: string }

const inBox = (b: BBox, p: LatLon) => p.lat >= b[0] && p.lat <= b[2] && p.lon >= b[1] && p.lon <= b[3];
const area = (b: BBox) => (b[2] - b[0]) * (b[3] - b[1]);

/**
 * All installed regions behind one search and one router. Routing never crosses regions: both ends must be
 * inside the same downloaded region, otherwise the answer is an explicit error (never an online fallback).
 */
export class RegionSet implements LocalRouter {
  /** smallest bounding box first, so a city dataset wins over a province dataset that contains it */
  readonly regions: RegionRuntime[];

  constructor(regions: RegionRuntime[]) {
    this.regions = [...regions].sort((a, b) => area(a.bbox) - area(b.bbox));
  }

  get isEmpty(): boolean { return this.regions.length === 0; }

  regionAt(p: LatLon): RegionRuntime | undefined {
    return this.regions.find((r) => inBox(r.bbox, p));
  }

  search(query: string, opts: SearchOptions = {}): RegionHit[] {
    const limit = opts.limit ?? 20;
    const all: RegionHit[] = [];
    for (const r of this.regions) for (const h of r.index.search(query, { ...opts, limit })) all.push({ ...h, regionId: r.id });
    const browsing = !query.trim() && opts.near;
    all.sort((a, b) => (browsing ? (a.distanceM ?? 0) - (b.distanceM ?? 0) : b.score - a.score)
      || (a.distanceM ?? 0) - (b.distanceM ?? 0) || a.place.n.localeCompare(b.place.n));
    return all.slice(0, limit);
  }

  route(from: LatLon, to: LatLon): RouteResult | RouteError {
    const shared = this.regions.filter((r) => inBox(r.bbox, from) && inBox(r.bbox, to));
    if (shared.length === 0) {
      const a = this.regionAt(from), b = this.regionAt(to);
      return { ok: false, code: a && b ? 'DIFFERENT_REGIONS' : 'OUTSIDE_DATASET' };
    }
    let firstFailure: RouteError | null = null;
    for (const r of shared) {
      const res = r.engine.route(from, to);
      if (res.ok) return res;
      firstFailure ??= res;
    }
    return firstFailure as RouteError;
  }
}
