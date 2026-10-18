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

/**
 * Converts a FeaturesFile (v1 format) into a GeoJSON FeatureCollection
 * suitable for MapLibre's built-in geojson-vt vector tile slicing.
 */
export function featuresToGeoJson(f: FeaturesFile): GeoJsonCollection {
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
  for (const flat of f.buildings) {
    const pts = decodeToGeoJsonPts(flat, f.scale);
    if (pts.length >= 3) {
      features.push({
        type: 'Feature',
        properties: { type: 'building', height: 8 },
        geometry: { type: 'Polygon', coordinates: [ensureClosedRing(pts)] },
      });
    }
  }

  return { type: 'FeatureCollection', features };
}
