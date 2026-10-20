import type { FeaturesFile } from '../features';

export type GeoJsonFeature =
  | {
      type: 'Feature';
      properties: Record<string, string | number | boolean>;
      geometry: {
        type: 'LineString';
        coordinates: [number, number][];
      };
    }
  | {
      type: 'Feature';
      properties: Record<string, string | number | boolean>;
      geometry: {
        type: 'Polygon';
        coordinates: [number, number][][];
      };
    };

export interface GeoJsonCollection {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
}

const MAJOR = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link']);
const MEDIUM = new Set(['secondary', 'secondary_link', 'tertiary', 'tertiary_link']);
const FOOT = new Set(['footway', 'path', 'steps', 'pedestrian', 'cycleway', 'track', 'bridleway', 'corridor']);

const CELL_SIZE = 0.04; // ~4.4km spatial cells for building viewport queries
const geoJsonCache = new WeakMap<FeaturesFile, GeoJsonCollection>();

export interface BuildingSpatialIndex {
  query(bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number }, limit?: number): GeoJsonFeature[];
}

/**
 * Creates a lightweight spatial grid index for dataset buildings to allow
 * fast viewport culling when zoomed in (zoom >= 15) without overloading memory.
 */
export function createBuildingSpatialIndex(f: FeaturesFile): BuildingSpatialIndex {
  const grid = new Map<string, [number, number][][]>();
  for (const flat of f.buildings) {
    if (flat.length < 6) continue;
    const pts = decodeToGeoJsonPts(flat, f.scale);
    if (pts.length < 3) continue;

    let minLo = 180, maxLo = -180, minLa = 90, maxLa = -90;
    for (const [lo, la] of pts) {
      if (lo < minLo) minLo = lo; if (lo > maxLo) maxLo = lo;
      if (la < minLa) minLa = la; if (la > maxLa) maxLa = la;
    }

    const gx0 = Math.floor(minLo / CELL_SIZE), gx1 = Math.floor(maxLo / CELL_SIZE);
    const gy0 = Math.floor(minLa / CELL_SIZE), gy1 = Math.floor(maxLa / CELL_SIZE);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        const k = `${gx}:${gy}`;
        let cell = grid.get(k);
        if (!cell) { cell = []; grid.set(k, cell); }
        cell.push(pts);
      }
    }
  }

  return {
    query(bbox, limit = 3000) {
      const gx0 = Math.floor(bbox.minLon / CELL_SIZE), gx1 = Math.floor(bbox.maxLon / CELL_SIZE);
      const gy0 = Math.floor(bbox.minLat / CELL_SIZE), gy1 = Math.floor(bbox.maxLat / CELL_SIZE);
      const seen = new Set<[number, number][]>();
      const features: GeoJsonFeature[] = [];

      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gy = gy0; gy <= gy1; gy++) {
          const cell = grid.get(`${gx}:${gy}`);
          if (!cell) continue;
          for (let i = 0; i < cell.length; i++) {
            const pts = cell[i];
            if (seen.has(pts)) continue;
            seen.add(pts);
            features.push({
              type: 'Feature',
              properties: { type: 'building', height: 8 },
              geometry: { type: 'Polygon', coordinates: [ensureClosedRing(pts)] },
            });
            if (features.length >= limit) return features;
          }
        }
      }
      return features;
    },
  };
}

/**
 * Decodes flat delta arrays from FeaturesFile into [lon, lat] GeoJSON coordinates.
 */
function decodeToGeoJsonPts(flat: number[], scale: number): [number, number][] {
  const pts: [number, number][] = [];
  let a = 0, b = 0;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    if (i === 0) { a = flat[0]; b = flat[1]; } else { a += flat[i]; b += flat[i + 1]; }
    pts.push([b / scale, a / scale]); // GeoJSON is [lon, lat]
  }
  return pts;
}

/**
 * Ensures a polygon linear ring is closed and has at least 4 positions (GeoJSON spec RFC 7946).
 */
function ensureClosedRing(pts: [number, number][]): [number, number][] {
  if (pts.length < 3) return pts;
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    const copy = pts.slice();
    copy.push([first[0], first[1]]);
    return copy;
  }
  return pts;
}

export interface FeaturesToGeoJsonOptions {
  maxBuildings?: number;
}

/**
 * Converts a FeaturesFile (v1 format) into a GeoJSON FeatureCollection
 * suitable for MapLibre's built-in geojson-vt vector tile slicing.
 *
 * For large datasets (>5,000 buildings like Jambi with 320k+ buildings),
 * buildings are excluded from the initial static base layer to prevent
 * browser freezing and MapLibre WebWorker OOM crashes.
 */
export function featuresToGeoJson(f: FeaturesFile, options?: FeaturesToGeoJsonOptions): GeoJsonCollection {
  if (!options && geoJsonCache.has(f)) {
    return geoJsonCache.get(f)!;
  }

  const features: GeoJsonFeature[] = [];

  // 1. Water (polygons for lakes/seas, linestrings for rivers/streams)
  for (const flat of f.water) {
    const pts = decodeToGeoJsonPts(flat, f.scale);
    if (pts.length >= 3) {
      features.push({
        type: 'Feature',
        properties: { type: 'water' },
        geometry: { type: 'Polygon', coordinates: [ensureClosedRing(pts)] },
      });
    } else if (pts.length === 2) {
      features.push({
        type: 'Feature',
        properties: { type: 'water-line' },
        geometry: { type: 'LineString', coordinates: pts },
      });
    }
  }

  // 2. Green
  for (const flat of f.green) {
    const pts = decodeToGeoJsonPts(flat, f.scale);
    if (pts.length >= 3) {
      features.push({
        type: 'Feature',
        properties: { type: 'green' },
        geometry: { type: 'Polygon', coordinates: [ensureClosedRing(pts)] },
      });
    }
  }

  // 3. Coast
  for (const flat of f.coast) {
    const pts = decodeToGeoJsonPts(flat, f.scale);
    if (pts.length >= 2) {
      features.push({
        type: 'Feature',
        properties: { type: 'coast' },
        geometry: { type: 'LineString', coordinates: pts },
      });
    }
  }

  // 4. Roads
  let hasMajor = false;
  for (const [hw] of f.roads) {
    if (MAJOR.has(hw)) {
      hasMajor = true;
      break;
    }
  }

  for (const [hw, flat] of f.roads) {
    const pts = decodeToGeoJsonPts(flat, f.scale);
    if (pts.length >= 2) {
      const cls = MAJOR.has(hw) || (!hasMajor && !FOOT.has(hw))
        ? 'major'
        : MEDIUM.has(hw)
          ? 'medium'
          : FOOT.has(hw)
            ? 'foot'
            : 'minor';
      features.push({
        type: 'Feature',
        properties: { type: 'road', highway: hw, class: cls },
        geometry: { type: 'LineString', coordinates: pts },
      });
    }
  }

  // 5. Buildings (with height property for 3D extrusion)
  // Datasets with <= 5,000 buildings (like Monaco or test fixtures) include all buildings.
  // Large province datasets (>5,000 buildings) load buildings on demand via spatial index.
  const maxBuildings = options?.maxBuildings !== undefined
    ? options.maxBuildings
    : (f.buildings.length > 5000 ? 0 : 5000);

  let bldgCount = 0;
  for (const flat of f.buildings) {
    if (bldgCount >= maxBuildings) break;
    const pts = decodeToGeoJsonPts(flat, f.scale);
    if (pts.length >= 3) {
      bldgCount++;
      features.push({
        type: 'Feature',
        properties: { type: 'building', height: 8 },
        geometry: { type: 'Polygon', coordinates: [ensureClosedRing(pts)] },
      });
    }
  }

  const result: GeoJsonCollection = { type: 'FeatureCollection', features };
  if (!options) {
    geoJsonCache.set(f, result);
  }
  return result;
}
