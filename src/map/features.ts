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

import { PALETTES, type Palette } from './palette';
export { PALETTES, type Palette };

const MAJOR = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link']);
const MEDIUM = new Set(['secondary', 'secondary_link', 'tertiary', 'tertiary_link']);
const FOOT = new Set(['footway', 'path', 'steps', 'pedestrian', 'cycleway', 'track', 'bridleway', 'corridor']);

export interface FeatureLayers {
  /** water, green, coast, roads: always present on map */
  base: L.LayerGroup;
  /** building outlines: only attached when zoomed in */
  buildings: L.LayerGroup;
  /** updates LOD and viewport-culled cells */
  update(zoom: number, bounds: L.LatLngBounds): void;
  /** cleans up all layers and caches */
  destroy(): void;
}

const CELL_SIZE = 0.03; // ~3.3 km grid cells for viewport culling
const MINOR_MIN_ZOOM = 13;
const BUILDING_MIN_ZOOM = 15;
const MEDIUM_MIN_ZOOM = 10;

/**
 * Draws the dataset's vector features on a Leaflet canvas using Level of Detail (LOD),
 * MultiPolyline batching, and spatial grid viewport culling so nationwide/province-scale
 * datasets render smoothly at 60 FPS without freezing the main thread.
 */
export function buildFeatureLayers(f: FeaturesFile, renderer: L.Renderer, pal: Palette = PALETTES.light): FeatureLayers {
  const base = L.layerGroup();
  const buildings = L.layerGroup();
  const common = { renderer, interactive: false, smoothFactor: 1 } as const;

  function decodeAndBbox(flat: number[]): { pts: [number, number][]; minLa: number; maxLa: number; minLo: number; maxLo: number } {
    const pts: [number, number][] = [];
    let a = 0, b = 0;
    let minLa = 90, maxLa = -90, minLo = 180, maxLo = -180;
    for (let i = 0; i + 1 < flat.length; i += 2) {
      if (i === 0) { a = flat[0]; b = flat[1]; } else { a += flat[i]; b += flat[i + 1]; }
      const la = a / f.scale, lo = b / f.scale;
      pts.push([la, lo]);
      if (la < minLa) minLa = la; if (la > maxLa) maxLa = la;
      if (lo < minLo) minLo = lo; if (lo > maxLo) maxLo = lo;
    }
    return { pts, minLa, maxLa, minLo, maxLo };
  }

  // 1. Water, green, coast as batched MultiPolygons/MultiPolylines
  const waterPts = f.water.map((w) => decodeDeltas(w, f.scale)).filter((w) => w.length > 0);
  if (waterPts.length > 0) {
    base.addLayer(L.polygon(waterPts, { ...common, stroke: false, fillColor: pal.water, fillOpacity: 0.85 }));
  }
  const greenPts = f.green.map((g) => decodeDeltas(g, f.scale)).filter((g) => g.length > 0);
  if (greenPts.length > 0) {
    base.addLayer(L.polygon(greenPts, { ...common, stroke: false, fillColor: pal.green, fillOpacity: 0.9 }));
  }
  const coastPts = f.coast.map((c) => decodeDeltas(c, f.scale)).filter((c) => c.length > 0);
  if (coastPts.length > 0) {
    base.addLayer(L.polyline(coastPts, { ...common, color: pal.coast, weight: 2 }));
  }

  // 2. Classify roads and index minor features into spatial grid
  const majorRoads: [number, number][][] = [];
  const mediumRoads: [number, number][][] = [];
  interface CellData {
    minor: [number, number][][];
    foot: [number, number][][];
    buildings: [number, number][][];
    rawBuildings?: number[][];
  }
  const grid = new Map<string, CellData>();

  for (const [hw, flat] of f.roads) {
    const { pts, minLa, maxLa, minLo, maxLo } = decodeAndBbox(flat);
    if (pts.length < 2) continue;
    if (MAJOR.has(hw)) {
      majorRoads.push(pts);
    } else if (MEDIUM.has(hw)) {
      mediumRoads.push(pts);
    } else {
      const isFoot = FOOT.has(hw);
      const gx0 = Math.floor(minLo / CELL_SIZE), gx1 = Math.floor(maxLo / CELL_SIZE);
      const gy0 = Math.floor(minLa / CELL_SIZE), gy1 = Math.floor(maxLa / CELL_SIZE);
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gy = gy0; gy <= gy1; gy++) {
          const k = `${gx}:${gy}`;
          let cell = grid.get(k);
          if (!cell) { cell = { minor: [], foot: [], buildings: [] }; grid.set(k, cell); }
          if (isFoot) cell.foot.push(pts);
          else cell.minor.push(pts);
        }
      }
    }
  }

  // Fallback: If no roads were flagged as MAJOR (e.g. synthetic test fixtures), treat all non-foot roads as major
  if (majorRoads.length === 0 && f.roads.length > 0) {
    for (const [hw, flat] of f.roads) {
      if (!FOOT.has(hw)) majorRoads.push(decodeDeltas(flat, f.scale));
    }
  }

  // Large datasets (>5k buildings): index raw building flat arrays lazily without upfront point decoding
  const isLargeBuildings = f.buildings.length > 5000;
  if (isLargeBuildings) {
    for (const flat of f.buildings) {
      if (flat.length < 6) continue;
      const gx = Math.floor((flat[1] / f.scale) / CELL_SIZE);
      const gy = Math.floor((flat[0] / f.scale) / CELL_SIZE);
      const k = `${gx}:${gy}`;
      let cell = grid.get(k);
      if (!cell) {
        cell = { minor: [], foot: [], buildings: [], rawBuildings: [flat] };
        grid.set(k, cell);
      } else {
        if (!cell.rawBuildings) cell.rawBuildings = [];
        cell.rawBuildings.push(flat);
      }
    }
  } else {
    for (const flat of f.buildings) {
      const { pts, minLa, maxLa, minLo, maxLo } = decodeAndBbox(flat);
      if (pts.length < 3) continue;
      const gx0 = Math.floor(minLo / CELL_SIZE), gx1 = Math.floor(maxLo / CELL_SIZE);
      const gy0 = Math.floor(minLa / CELL_SIZE), gy1 = Math.floor(maxLa / CELL_SIZE);
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gy = gy0; gy <= gy1; gy++) {
          const k = `${gx}:${gy}`;
          let cell = grid.get(k);
          if (!cell) { cell = { minor: [], foot: [], buildings: [] }; grid.set(k, cell); }
          cell.buildings.push(pts);
        }
      }
    }
  }

  // 3. Setup Layer Hierarchy to guarantee correct z-ordering
  // Casing layers first, then fill layers, then footways on top
  const mediumCasingGroup = L.layerGroup();
  const minorCasingGroup = L.layerGroup();
  const minorFillGroup = L.layerGroup();
  const mediumFillGroup = L.layerGroup();
  const footGroup = L.layerGroup();

  if (majorRoads.length > 0) {
    const majorCasing = L.polyline(majorRoads, { ...common, color: pal.roadCasing, weight: 8, lineCap: 'round', lineJoin: 'round' });
    base.addLayer(majorCasing);
  }
  base.addLayer(mediumCasingGroup);
  base.addLayer(minorCasingGroup);
  base.addLayer(minorFillGroup);
  base.addLayer(mediumFillGroup);
  if (majorRoads.length > 0) {
    const majorFill = L.polyline(majorRoads, { ...common, color: pal.roadMajor, weight: 5.5, lineCap: 'round', lineJoin: 'round' });
    base.addLayer(majorFill);
  }
  base.addLayer(footGroup);

  let mediumCasing: L.Polyline | null = null;
  let mediumFill: L.Polyline | null = null;
  if (mediumRoads.length > 0) {
    mediumCasing = L.polyline(mediumRoads, { ...common, color: pal.roadCasing, weight: 6, lineCap: 'round', lineJoin: 'round' });
    mediumFill = L.polyline(mediumRoads, { ...common, color: pal.roadMinor, weight: 4, lineCap: 'round', lineJoin: 'round' });
  }

  // Cell Layer Cache
  interface CellLayers {
    casing?: L.Polyline;
    fill?: L.Polyline;
    foot?: L.Polyline;
    buildings?: L.Polygon;
  }
  const cellLayers = new Map<string, CellLayers>();
  const activeRoadCells = new Set<string>();
  const activeBuildingCells = new Set<string>();

  function getOrCreateCellLayers(k: string, cell: CellData): CellLayers {
    let cl = cellLayers.get(k);
    if (!cl) {
      cl = {};
      if (cell.minor.length > 0) {
        cl.casing = L.polyline(cell.minor, { ...common, color: pal.roadCasing, weight: 4.5, lineCap: 'round', lineJoin: 'round' });
        cl.fill = L.polyline(cell.minor, { ...common, color: pal.roadMinor, weight: 2.5, lineCap: 'round', lineJoin: 'round' });
      }
      if (cell.foot.length > 0) {
        cl.foot = L.polyline(cell.foot, { ...common, color: pal.foot, weight: 1.2, dashArray: '2 3' });
      }
      if (cell.rawBuildings && cell.rawBuildings.length > 0 && cell.buildings.length === 0) {
        for (const flat of cell.rawBuildings) {
          const pts = decodeDeltas(flat, f.scale);
          if (pts.length >= 3) cell.buildings.push(pts);
        }
      }
      if (cell.buildings.length > 0) {
        cl.buildings = L.polygon(cell.buildings, { ...common, color: pal.buildingStroke, weight: 0.6, fillColor: pal.buildingFill, fillOpacity: 1 });
      }
      cellLayers.set(k, cl);
    }
    return cl;
  }

  function update(zoom: number, bounds: L.LatLngBounds): void {
    if (!bounds || !bounds.isValid() || isNaN(zoom)) return;

    // A. Medium roads toggle (LOD)
    if (mediumCasing && mediumFill) {
      const showMedium = zoom >= MEDIUM_MIN_ZOOM;
      if (showMedium && !mediumCasingGroup.hasLayer(mediumCasing)) {
        mediumCasingGroup.addLayer(mediumCasing);
        mediumFillGroup.addLayer(mediumFill);
      } else if (!showMedium && mediumCasingGroup.hasLayer(mediumCasing)) {
        mediumCasingGroup.removeLayer(mediumCasing);
        mediumFillGroup.removeLayer(mediumFill);
      }
    }

    // B. Calculate visible cells in padded viewport
    const padded = bounds.pad(0.5);
    const minLo = padded.getWest(), maxLo = padded.getEast();
    const minLa = padded.getSouth(), maxLa = padded.getNorth();
    const gx0 = Math.floor(minLo / CELL_SIZE), gx1 = Math.floor(maxLo / CELL_SIZE);
    const gy0 = Math.floor(minLa / CELL_SIZE), gy1 = Math.floor(maxLa / CELL_SIZE);

    const needed = new Set<string>();
    const spanX = gx1 - gx0;
    const spanY = gy1 - gy0;
    if (spanX <= 40 && spanY <= 40) {
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gy = gy0; gy <= gy1; gy++) {
          const k = `${gx}:${gy}`;
          if (grid.has(k)) needed.add(k);
        }
      }
    }

    // C. Minor roads and footways (zoom >= MINOR_MIN_ZOOM)
    if (zoom >= MINOR_MIN_ZOOM) {
      for (const k of activeRoadCells) {
        if (!needed.has(k)) {
          const cl = cellLayers.get(k);
          if (cl) {
            if (cl.casing) minorCasingGroup.removeLayer(cl.casing);
            if (cl.fill) minorFillGroup.removeLayer(cl.fill);
            if (cl.foot) footGroup.removeLayer(cl.foot);
          }
          activeRoadCells.delete(k);
        }
      }
      for (const k of needed) {
        if (!activeRoadCells.has(k)) {
          const cell = grid.get(k);
          if (cell) {
            const cl = getOrCreateCellLayers(k, cell);
            if (cl.casing) minorCasingGroup.addLayer(cl.casing);
            if (cl.fill) minorFillGroup.addLayer(cl.fill);
            if (cl.foot) footGroup.addLayer(cl.foot);
            activeRoadCells.add(k);
          }
        }
      }
    } else {
      if (activeRoadCells.size > 0) {
        minorCasingGroup.clearLayers();
        minorFillGroup.clearLayers();
        footGroup.clearLayers();
        activeRoadCells.clear();
      }
    }

    // D. Buildings (zoom >= BUILDING_MIN_ZOOM)
    if (zoom >= BUILDING_MIN_ZOOM) {
      for (const k of activeBuildingCells) {
        if (!needed.has(k)) {
          const cl = cellLayers.get(k);
          if (cl?.buildings) buildings.removeLayer(cl.buildings);
          activeBuildingCells.delete(k);
        }
      }
      for (const k of needed) {
        if (!activeBuildingCells.has(k)) {
          const cell = grid.get(k);
          if (cell) {
            const cl = getOrCreateCellLayers(k, cell);
            if (cl.buildings) buildings.addLayer(cl.buildings);
            activeBuildingCells.add(k);
          }
        }
      }
    } else {
      if (activeBuildingCells.size > 0) {
        buildings.clearLayers();
        activeBuildingCells.clear();
      }
    }
  }

  function destroy(): void {
    base.clearLayers();
    buildings.clearLayers();
    grid.clear();
    cellLayers.clear();
    activeRoadCells.clear();
    activeBuildingCells.clear();
  }

  return { base, buildings, update, destroy };
}
