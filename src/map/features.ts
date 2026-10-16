import L from 'leaflet';

/** Shape of features.json written by pipeline/dmaps_pipeline/build_dataset.py (format v1). */
export interface FeaturesFile {
  scale: number;
  roads: [highway: string, deltas: number[]][];
  buildings: number[][];
  water: number[][];
  green: number[][];
  coast: number[][];
}

/** Inverse of the pipeline's encode_deltas: first point absolute, then deltas, all in 1/scale degrees. */
export function decodeDeltas(flat: number[], scale: number): [number, number][] {
  const pts: [number, number][] = [];
  let a = 0, b = 0;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    if (i === 0) { a = flat[0]; b = flat[1]; } else { a += flat[i]; b += flat[i + 1]; }
    pts.push([a / scale, b / scale]);
  }
  return pts;
}

export interface Palette {
  water: string; green: string; coast: string; roadCasing: string; roadMajor: string; roadMinor: string;
  foot: string; buildingFill: string; buildingStroke: string;
}
export const PALETTES: Record<'light' | 'dark', Palette> = {
  light: {
    water: '#8DD9F5', green: '#B9F3D0', coast: '#5BBEE5', roadCasing: '#CDBE96', roadMajor: '#FFE27A', roadMinor: '#FFFFFF',
    foot: '#B8AE96', buildingFill: '#EFE6D3', buildingStroke: '#DCCFB6',
  },
  dark: {
    water: '#1F5A73', green: '#25503C', coast: '#2F86A6', roadCasing: '#11181C', roadMajor: '#B8962E', roadMinor: '#5A6A72',
    foot: '#5B6B73', buildingFill: '#2C373D', buildingStroke: '#3A474E',
  },
};

const MAJOR = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link']);
const MEDIUM = new Set(['secondary', 'secondary_link', 'tertiary', 'tertiary_link']);
const FOOT = new Set(['footway', 'path', 'steps', 'pedestrian', 'cycleway', 'track', 'bridleway', 'corridor']);

export interface FeatureLayers {
  /** water, green, roads, coast: always shown */
  base: L.LayerGroup;
  /** building outlines: only worth drawing when zoomed in */
  buildings: L.LayerGroup;
}

/**
 * Draws the dataset's vector features on a Leaflet canvas. PoC rendering path: it needs no tile
 * server, so it works offline, but it loads every feature at once and does not scale to big regions
 * (see docs/architecture.md: vector tiles are the plan for those).
 */
export function buildFeatureLayers(f: FeaturesFile, renderer: L.Renderer, pal: Palette = PALETTES.light): FeatureLayers {
  const base = L.layerGroup();
  const buildings = L.layerGroup();
  const common = { renderer, interactive: false, smoothFactor: 1 } as const;
  const poly = (flat: number[]) => decodeDeltas(flat, f.scale);

  for (const w of f.water) {
    base.addLayer(L.polygon(poly(w), { ...common, stroke: false, fillColor: pal.water, fillOpacity: 0.85 }));
  }
  for (const g of f.green) {
    base.addLayer(L.polygon(poly(g), { ...common, stroke: false, fillColor: pal.green, fillOpacity: 0.9 }));
  }
  for (const c of f.coast) {
    base.addLayer(L.polyline(poly(c), { ...common, color: pal.coast, weight: 2 }));
  }
  // casing first so every road's fill sits on top of every casing
  const roads = f.roads.map(([hw, flat]) => ({ hw, pts: decodeDeltas(flat, f.scale) }));
  for (const { hw, pts } of roads) {
    if (FOOT.has(hw)) continue;
    const w = MAJOR.has(hw) ? 9 : MEDIUM.has(hw) ? 7 : 5;
    base.addLayer(L.polyline(pts, { ...common, color: pal.roadCasing, weight: w, lineCap: 'round', lineJoin: 'round' }));
  }
  for (const { hw, pts } of roads) {
    if (FOOT.has(hw)) {
      base.addLayer(L.polyline(pts, { ...common, color: pal.foot, weight: 1, dashArray: '2 3' }));
      continue;
    }
    const major = MAJOR.has(hw);
    const w = major ? 6 : MEDIUM.has(hw) ? 4.5 : 3;
    base.addLayer(L.polyline(pts, { ...common, color: major ? pal.roadMajor : pal.roadMinor, weight: w, lineCap: 'round', lineJoin: 'round' }));
  }
  for (const b of f.buildings) {
    buildings.addLayer(L.polygon(poly(b), { ...common, color: pal.buildingStroke, weight: 0.6, fillColor: pal.buildingFill, fillOpacity: 1 }));
  }
  return { base, buildings };
}
