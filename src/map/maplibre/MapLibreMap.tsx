import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Map, Marker, setWorkerUrl, type GeoJSONSource, type LngLatBoundsLike } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

// Configure MapLibre Web Worker URL for Vite bundling and dev server
setWorkerUrl(maplibreWorkerUrl);
import { Compass, Box } from 'lucide-react';
import { createMapLibreStyle } from './style';
import { featuresToGeoJson, createBuildingSpatialIndex, type BuildingSpatialIndex, type GeoJsonFeature } from './featuresToGeojson';
import type { FeaturesFile } from '../features';

const buildingIndexCache = new WeakMap<FeaturesFile, BuildingSpatialIndex>();
function getBuildingIndex(f: FeaturesFile): BuildingSpatialIndex {
  let idx = buildingIndexCache.get(f);
  if (!idx) {
    idx = createBuildingSpatialIndex(f);
    buildingIndexCache.set(f, idx);
  }
  return idx;
}
import { registerPMTilesProtocol } from './pmtilesProtocol';
import { MapLibrePositionPuck } from './positionPuck';
import { createPlaceBadgeHtml, createBookmarkBadgeHtml } from '../badges';
import type { RegionRuntime } from '../../regions/regionSet';
import type { Fix } from '../../gps';
import type { RouteResult } from '../../routing';
import type { Bookmark } from '../../storage/bookmarks';

export interface Point {
  lat: number;
  lon: number;
  label: string;
}

export interface MapLibreMapHandle {
  focus(lat: number, lon: number, zoom?: number): void;
}

interface Props {
  regions: RegionRuntime[];
  theme: 'light' | 'dark';
  from: Point | null;
  to: Point | null;
  shownRoute: RouteResult | null;
  fix: Fix | null;
  stale: boolean;
  navigating: boolean;
  following: boolean;
  active?: boolean;
  bookmarks?: Bookmark[];
  onMapClick(lat: number, lon: number): void;
  onUserDrag(): void;
  onRecenter?(): void;
  onCenterChange?(center: { lat: number; lon: number }): void;
  onError?(): void;
}

const MapLibreMap = forwardRef<MapLibreMapHandle, Props>(function MapLibreMap(
  {
    regions,
    theme,
    from,
    to,
    shownRoute,
    fix,
    stale,
    navigating,
    following,
    active = true,
    bookmarks = [],
    onMapClick,
    onUserDrag,
    onCenterChange,
    onError,
  }: Props,
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const puckRef = useRef<MapLibrePositionPuck | null>(null);
  const fromMarkerRef = useRef<Marker | null>(null);
  const toMarkerRef = useRef<Marker | null>(null);
  const bookmarkMarkersRef = useRef<Marker[]>([]);
  const placeMarkersRef = useRef<Marker[]>([]);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onUserDragRef = useRef(onUserDrag);
  onUserDragRef.current = onUserDrag;
  const onCenterChangeRef = useRef(onCenterChange);
  onCenterChangeRef.current = onCenterChange;
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;
  const fittedKey = useRef('');
  const fittedRouteRef = useRef<string | null>(null);
  const hasBuildingDataRef = useRef(false);
  const [pitch3D, setPitch3D] = useState(false);
  const [bearing, setBearing] = useState(0);

  useImperativeHandle(ref, () => ({
    focus(lat: number, lon: number, zoom: number = 17) {
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      const map = mapRef.current;
      if (!map) return;
      map.easeTo({
        center: [lon, lat],
        zoom: Math.max(map.getZoom(), zoom),
        duration: 500,
      });
    },
  }));

  // Initialize PMTiles protocol once
  useEffect(() => {
    registerPMTilesProtocol();
  }, []);

  // Initialize MapLibre GL map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const isTest = typeof navigator !== 'undefined' && (
      navigator.webdriver === true ||
      Boolean((window as unknown as { __PLAYWRIGHT__?: boolean }).__PLAYWRIGHT__)
    );

    let map: Map;
    try {
      map = new Map({
        container: containerRef.current,
        style: createMapLibreStyle(theme),
        center: [103.6, -1.6], // Default near central Sumatra / Jambi
        zoom: 6,
        maxPitch: 65,
        pixelRatio: Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2),
        canvasContextAttributes: {
          preserveDrawingBuffer: isTest,
          powerPreference: 'default',
        },
      });
    } catch (err) {
      console.error('Failed to initialize MapLibre GL map:', err);
      onErrorRef.current?.();
      return;
    }

    const canvas = map.getCanvas();
    const handleContextLost = (e: Event) => {
      e.preventDefault();
      console.warn('WebGL context lost. Prevented browser crash.');
    };
    canvas.addEventListener('webglcontextlost', handleContextLost);

    puckRef.current = new MapLibrePositionPuck(map);

    const handleUserInteraction = (e: { originalEvent?: unknown }) => {
      if (e?.originalEvent) {
        onUserDragRef.current();
      }
    };

    map.on('dragstart', () => {
      onUserDragRef.current();
    });
    map.on('zoomstart', handleUserInteraction);
    map.on('rotatestart', handleUserInteraction);
    map.on('pitchstart', handleUserInteraction);

    map.on('rotate', () => {
      setBearing(Math.round(map.getBearing()));
    });

    map.on('pitch', () => {
      setPitch3D(map.getPitch() > 20);
    });

    map.on('moveend', () => {
      try {
        const c = map.getCenter();
        if (Number.isFinite(c.lat) && Number.isFinite(c.lng)) {
          onCenterChangeRef.current?.({ lat: c.lat, lon: c.lng });
        }
      } catch {
        /* ignore */
      }
      syncBuildings();
      syncLabels();
    });

    map.on('click', (e) => {
      onMapClickRef.current(e.lngLat.lat, e.lngLat.lng);
    });

    map.on('load', () => {
      isLoadedRef.current = true;
      syncFeatures();
      syncBuildings();
      syncRoute();
      syncLabels();
    });

    map.on('style.load', () => {
      syncFeatures();
      syncBuildings();
      syncRoute();
      syncLabels();
    });

    mapRef.current = map;

    return () => {
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      puckRef.current?.remove();
      fromMarkerRef.current?.remove();
      toMarkerRef.current?.remove();
      for (const m of bookmarkMarkersRef.current) m.remove();
      for (const m of placeMarkersRef.current) m.remove();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Resize on active tab or navigation view change
  useEffect(() => {
    if (active) {
      const id = setTimeout(() => mapRef.current?.resize(), 50);
      return () => clearTimeout(id);
    }
  }, [active, navigating]);

  // Update theme / style
  const prevThemeRef = useRef(theme);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (prevThemeRef.current === theme) return;
    prevThemeRef.current = theme;
    map.setStyle(createMapLibreStyle(theme), { diff: true });
  }, [theme]);

  const isLoadedRef = useRef(false);
  const regionsRef = useRef(regions);
  regionsRef.current = regions;
  const routeRef = useRef(shownRoute);
  routeRef.current = shownRoute;

  const syncFeatures = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const source = map.getSource('features') as GeoJSONSource | undefined;
    if (!source) return;

    const currentRegions = regionsRef.current;
    let combinedFeatures: ReturnType<typeof featuresToGeoJson>['features'] = [];
    for (const r of currentRegions) {
      if (r.features) {
        const col = featuresToGeoJson(r.features);
        if (combinedFeatures.length === 0) {
          combinedFeatures = col.features;
        } else {
          for (let i = 0; i < col.features.length; i++) {
            combinedFeatures.push(col.features[i]);
          }
        }
      }
    }
    source.setData({
      type: 'FeatureCollection',
      features: combinedFeatures,
    });

    // Fit bounds to installed region bbox
    const key = currentRegions.map((r) => r.id).join(',');
    if (key && key !== fittedKey.current) {
      const b = currentRegions.map((r) => r.bbox);
      if (b.length > 0) {
        let minLat = b[0][0], minLon = b[0][1], maxLat = b[0][2], maxLon = b[0][3];
        for (let i = 1; i < b.length; i++) {
          if (b[i][0] < minLat) minLat = b[i][0];
          if (b[i][1] < minLon) minLon = b[i][1];
          if (b[i][2] > maxLat) maxLat = b[i][2];
          if (b[i][3] > maxLon) maxLon = b[i][3];
        }
        map.fitBounds(
          [
            [minLon, minLat],
            [maxLon, maxLat],
          ],
          { padding: 40, duration: 800 }
        );
        fittedKey.current = key;
      }
    }
  }, []);

  const syncBuildings = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const source = map.getSource('buildings') as GeoJSONSource | undefined;
    if (!source) return;

    const zoom = map.getZoom();
    if (zoom < 14.5) {
      if (hasBuildingDataRef.current) {
        source.setData({ type: 'FeatureCollection', features: [] });
        hasBuildingDataRef.current = false;
      }
      return;
    }

    const bounds = map.getBounds();
    const bbox = {
      minLon: bounds.getWest(),
      minLat: bounds.getSouth(),
      maxLon: bounds.getEast(),
      maxLat: bounds.getNorth(),
    };

    const currentRegions = regionsRef.current;
    const buildingFeatures: GeoJsonFeature[] = [];
    for (const r of currentRegions) {
      if (r.features && r.features.buildings.length > 5000) {
        const idx = getBuildingIndex(r.features);
        const feats = idx.query(bbox, 3000);
        for (let i = 0; i < feats.length; i++) {
          buildingFeatures.push(feats[i]);
          if (buildingFeatures.length >= 3000) break;
        }
      }
    }

    source.setData({
      type: 'FeatureCollection',
      features: buildingFeatures,
    });
    hasBuildingDataRef.current = buildingFeatures.length > 0;
  }, []);

  const syncRoute = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const source = map.getSource('route') as GeoJSONSource | undefined;
    if (!source) return;

    const currentRoute = routeRef.current;
    if (currentRoute?.geometry && currentRoute.geometry.length >= 2) {
      const coords = currentRoute.geometry
        .filter(([la, lo]) => Number.isFinite(la) && Number.isFinite(lo))
        .map(([la, lo]) => [lo, la]); // [lon, lat]

      source.setData({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: coords },
          },
        ],
      });

      if (!navigating && coords.length >= 2) {
        const routeKey = `${coords.length}:${coords[0].join(',')}-${coords[coords.length - 1].join(',')}`;
        if (routeKey !== fittedRouteRef.current) {
          fittedRouteRef.current = routeKey;
          let minLon = coords[0][0], maxLon = coords[0][0];
          let minLat = coords[0][1], maxLat = coords[0][1];
          for (let i = 1; i < coords.length; i++) {
            const [lon, lat] = coords[i];
            if (lon < minLon) minLon = lon;
            if (lon > maxLon) maxLon = lon;
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
          }
          const bounds: LngLatBoundsLike = [
            [minLon, minLat],
            [maxLon, maxLat],
          ];
          map.fitBounds(bounds, { padding: 50, duration: 800 });
        }
      }
    } else {
      fittedRouteRef.current = null;
      source.setData({ type: 'FeatureCollection', features: [] });
    }
  }, [navigating]);

  // Street & Place labels on MapLibre (Google Maps style)
  const syncLabels = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const zoom = map.getZoom();
    if (zoom < 13.5) {
      for (const m of placeMarkersRef.current) m.remove();
      placeMarkersRef.current = [];
      return;
    }
    const bounds = map.getBounds();
    const minLon = bounds.getWest(), maxLon = bounds.getEast();
    const minLat = bounds.getSouth(), maxLat = bounds.getNorth();

    const currentRegions = regionsRef.current;
    const visiblePlaces: { name: string; lat: number; lon: number; kind: string; category?: string }[] = [];
    const seen = new Set<string>();

    for (const r of currentRegions) {
      if (r.places) {
        for (const p of r.places) {
          if (p.la >= minLat && p.la <= maxLat && p.lo >= minLon && p.lo <= maxLon) {
            const key = `${p.n}:${p.la.toFixed(4)},${p.lo.toFixed(4)}`;
            if (!seen.has(key)) {
              seen.add(key);
              visiblePlaces.push({ name: p.n, lat: p.la, lon: p.lo, kind: p.k, category: p.c });
              if (visiblePlaces.length >= 50) break;
            }
          }
        }
      }
      if (visiblePlaces.length >= 50) break;
    }

    for (const m of placeMarkersRef.current) m.remove();
    placeMarkersRef.current = [];

    const isDark = theme === 'dark';
    for (const vp of visiblePlaces) {
      const el = document.createElement('div');
      el.className = 'dmaps-maplibre-label-wrapper';
      el.innerHTML = createPlaceBadgeHtml(vp.name, vp.kind, vp.category, isDark ? 'dark' : 'light');
      el.title = vp.name;
      el.onclick = (e) => {
        e.stopPropagation();
        onMapClickRef.current(vp.lat, vp.lon);
      };
      const m = new Marker({ element: el }).setLngLat([vp.lon, vp.lat]).addTo(map);
      placeMarkersRef.current.push(m);
    }
  }, [theme]);

  // Saved location bookmarks on MapLibre
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const m of bookmarkMarkersRef.current) m.remove();
    bookmarkMarkersRef.current = [];

    for (const bm of bookmarks) {
      const el = document.createElement('div');
      el.className = 'dmaps-maplibre-label-wrapper';
      el.innerHTML = createBookmarkBadgeHtml(bm.name);
      el.title = `${bm.name} (${bm.lat.toFixed(5)}, ${bm.lon.toFixed(5)})`;
      el.onclick = (e) => {
        e.stopPropagation();
        onMapClickRef.current(bm.lat, bm.lon);
      };
      const marker = new Marker({ element: el }).setLngLat([bm.lon, bm.lat]).addTo(map);
      bookmarkMarkersRef.current.push(marker);
    }
  }, [bookmarks]);

  // Feed installed vector features to MapLibre GeoJSON source
  useEffect(() => {
    if (!active) return;
    if (isLoadedRef.current) {
      syncFeatures();
      syncBuildings();
      syncLabels();
    }
  }, [active, regions, syncFeatures, syncBuildings, syncLabels]);

  // Feed route line to MapLibre GeoJSON source
  useEffect(() => {
    if (!active) return;
    if (isLoadedRef.current) {
      syncRoute();
    }
  }, [active, shownRoute, navigating, syncRoute]);

  // Markers for Origin ('from') and Destination ('to')
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // From marker
    if (from && Number.isFinite(from.lat) && Number.isFinite(from.lon)) {
      if (!fromMarkerRef.current) {
        const el = document.createElement('div');
        el.className = 'dmaps-ml-marker dmaps-ml-from';
        el.style.width = '24px';
        el.style.height = '24px';
        el.style.background = 'linear-gradient(135deg, #10B981, #059669)';
        el.style.border = '3px solid #FFFFFF';
        el.style.borderRadius = '50%';
        el.style.boxShadow = '0 4px 12px rgba(16,185,129,0.6)';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        el.style.color = '#FFFFFF';
        el.style.fontWeight = 'bold';
        el.style.fontSize = '12px';
        el.textContent = 'A';
        fromMarkerRef.current = new Marker({ element: el }).setLngLat([from.lon, from.lat]).addTo(map);
      } else {
        fromMarkerRef.current.setLngLat([from.lon, from.lat]);
      }
    } else {
      fromMarkerRef.current?.remove();
      fromMarkerRef.current = null;
    }

    // To marker
    if (to && Number.isFinite(to.lat) && Number.isFinite(to.lon)) {
      if (!toMarkerRef.current) {
        const el = document.createElement('div');
        el.className = 'dmaps-ml-marker dmaps-ml-to';
        el.style.width = '26px';
        el.style.height = '26px';
        el.style.background = 'linear-gradient(135deg, #EF4444, #DC2626)';
        el.style.border = '3px solid #FFFFFF';
        el.style.borderRadius = '50%';
        el.style.boxShadow = '0 4px 14px rgba(239,68,68,0.65)';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        el.style.color = '#FFFFFF';
        el.style.fontWeight = 'bold';
        el.style.fontSize = '13px';
        el.textContent = 'B';
        toMarkerRef.current = new Marker({ element: el }).setLngLat([to.lon, to.lat]).addTo(map);
      } else {
        toMarkerRef.current.setLngLat([to.lon, to.lat]);
      }
    } else {
      toMarkerRef.current?.remove();
      toMarkerRef.current = null;
    }
  }, [from, to]);

  // GPS Position puck & Camera Follow / Navigation 3D Driving Mode
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!fix || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lon)) {
      puckRef.current?.remove();
      return;
    }

    puckRef.current?.update(fix, stale);

    if (following && navigating) {
      // Google Maps Navigation 3D driving mode: auto-rotate heading + 50° pitch tilt!
      const targetBearing = fix.heading !== null && fix.heading !== undefined && Number.isFinite(fix.heading)
        ? fix.heading
        : map.getBearing();

      map.easeTo({
        center: [fix.lon, fix.lat],
        zoom: Math.max(map.getZoom(), 17),
        bearing: targetBearing,
        pitch: 50,
        duration: 350,
      });
    }
  }, [fix, stale, following, navigating]);

  const toggle3D = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const next = map.getPitch() < 20;
    map.easeTo({ pitch: next ? 55 : 0, duration: 400 });
    setPitch3D(next);
  }, []);

  const resetNorth = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ bearing: 0, pitch: 0, duration: 400 });
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%' }}
        data-testid="maplibre-map"
      />

      {/* Floating 3D and Compass controls like Google Maps */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          zIndex: 10,
        }}
      >
        <button
          type="button"
          onClick={resetNorth}
          title="Reset Utara (North)"
          aria-label="Reset North"
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            backgroundColor: theme === 'dark' ? '#1E293B' : '#FFFFFF',
            border: '1px solid rgba(0,0,0,0.15)',
            boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transform: `rotate(${-bearing}deg)`,
            transition: 'transform 0.15s ease',
          }}
        >
          <Compass size={22} color="#E53935" />
        </button>

        <button
          type="button"
          onClick={toggle3D}
          title="Toggle Perspektif 3D"
          aria-label="Toggle 3D"
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            backgroundColor: pitch3D ? '#1E88E5' : theme === 'dark' ? '#1E293B' : '#FFFFFF',
            color: pitch3D ? '#FFFFFF' : theme === 'dark' ? '#E2E8F0' : '#334155',
            border: '1px solid rgba(0,0,0,0.15)',
            boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            fontWeight: 700,
            fontSize: 13,
          }}
        >
          <Box size={20} />
        </button>
      </div>
    </div>
  );
});

export default MapLibreMap;
