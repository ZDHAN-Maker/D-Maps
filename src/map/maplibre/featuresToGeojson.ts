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
 * Converts a FeaturesFile (v1 format) into a GeoJSON FeatureCollection
 * suitable for MapLibre's built-in geojson-vt vector tile slicing.
 */
export function featuresToGeoJson(f: FeaturesFile): GeoJsonCollection {
  const features: GeoJsonFeature[] = [];

  // 1. Water
  for (const flat of f.water) {
    const pts = decodeToGeoJsonPts(flat, f.scale);
    if (pts.length >= 3) {
      features.push({
        type: 'Feature',
        properties: { type: 'water' },
        geometry: { type: 'Polygon', coordinates: [pts] },
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
        geometry: { type: 'Polygon', coordinates: [pts] },
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
  for (const [hw, flat] of f.roads) {
    const pts = decodeToGeoJsonPts(flat, f.scale);
    if (pts.length >= 2) {
      const cls = MAJOR.has(hw) ? 'major' : MEDIUM.has(hw) ? 'medium' : FOOT.has(hw) ? 'foot' : 'minor';
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
        geometry: { type: 'Polygon', coordinates: [pts] },
      });
    }
  }

  return { type: 'FeatureCollection', features };
}
