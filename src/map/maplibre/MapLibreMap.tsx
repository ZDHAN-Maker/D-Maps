import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Map, Marker, setWorkerUrl, type GeoJSONSource, type LngLatBoundsLike } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

// Configure MapLibre Web Worker URL for Vite bundling and dev server
setWorkerUrl(maplibreWorkerUrl);
import { Compass, Box } from 'lucide-react';
import { createMapLibreStyle } from './style';
import { featuresToGeoJson } from './featuresToGeojson';
import { registerPMTilesProtocol } from './pmtilesProtocol';
import { MapLibrePositionPuck } from './positionPuck';
import type { RegionRuntime } from '../../regions/regionSet';
import type { Fix } from '../../gps';
import type { RouteResult } from '../../routing';

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
  onMapClick(lat: number, lon: number): void;
  onUserDrag(): void;
  onRecenter?(): void;
  onCenterChange?(center: { lat: number; lon: number }): void;
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
    onMapClick,
    onUserDrag,
    onCenterChange,
  }: Props,
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const puckRef = useRef<MapLibrePositionPuck | null>(null);
  const fromMarkerRef = useRef<Marker | null>(null);
  const toMarkerRef = useRef<Marker | null>(null);
  const fittedKey = useRef('');
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

    const map = new Map({
      container: containerRef.current,
      style: createMapLibreStyle(theme),
      center: [103.6, -1.6], // Default near central Sumatra / Jambi
      zoom: 6,
      maxPitch: 65,
    });

    puckRef.current = new MapLibrePositionPuck(map);

    map.on('dragstart', () => {
      onUserDrag();
    });

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
          onCenterChange?.({ lat: c.lat, lon: c.lng });
        }
      } catch {
        /* ignore */
      }
    });

    map.on('click', (e) => {
      onMapClick(e.lngLat.lat, e.lngLat.lng);
    });

    mapRef.current = map;

    return () => {
      puckRef.current?.remove();
      fromMarkerRef.current?.remove();
      toMarkerRef.current?.remove();
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
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(createMapLibreStyle(theme), { diff: true });
  }, [theme]);

  // Feed installed vector features to MapLibre GeoJSON source
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const updateSource = () => {
      const source = map.getSource('features') as GeoJSONSource | undefined;
      if (!source) return;

      const combinedFeatures: ReturnType<typeof featuresToGeoJson>['features'] = [];
      for (const r of regions) {
        if (r.features) {
          const col = featuresToGeoJson(r.features);
          combinedFeatures.push(...col.features);
        }
      }
      source.setData({
        type: 'FeatureCollection',
        features: combinedFeatures,
      });

      // Fit bounds to installed region bbox
      const key = regions.map((r) => r.id).join(',');
      if (key && key !== fittedKey.current) {
        const b = regions.map((r) => r.bbox);
        const minLat = Math.min(...b.map((x) => x[0]));
        const minLon = Math.min(...b.map((x) => x[1]));
        const maxLat = Math.max(...b.map((x) => x[2]));
        const maxLon = Math.max(...b.map((x) => x[3]));
        map.fitBounds(
          [
            [minLon, minLat],
            [maxLon, maxLat],
          ],
          { padding: 40, duration: 800 }
        );
        fittedKey.current = key;
      }
    };

    if (map.isStyleLoaded()) {
      updateSource();
    } else {
      map.once('load', updateSource);
      map.once('styledata', updateSource);
    }
  }, [regions]);

  // Feed route line to MapLibre GeoJSON source
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const updateRoute = () => {
      const source = map.getSource('route') as GeoJSONSource | undefined;
      if (!source) return;

      if (shownRoute?.geometry && shownRoute.geometry.length >= 2) {
        const coords = shownRoute.geometry
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
          const lons = coords.map((c) => c[0]);
          const lats = coords.map((c) => c[1]);
          const bounds: LngLatBoundsLike = [
            [Math.min(...lons), Math.min(...lats)],
            [Math.max(...lons), Math.max(...lats)],
          ];
          map.fitBounds(bounds, { padding: 50, duration: 800 });
        }
      } else {
        source.setData({ type: 'FeatureCollection', features: [] });
      }
    };

    if (map.isStyleLoaded()) {
      updateRoute();
    } else {
      map.once('load', updateRoute);
      map.once('styledata', updateRoute);
    }
  }, [shownRoute, navigating]);

  // Markers for Origin ('from') and Destination ('to')
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // From marker
    if (from && Number.isFinite(from.lat) && Number.isFinite(from.lon)) {
      if (!fromMarkerRef.current) {
        const el = document.createElement('div');
        el.className = 'dmaps-ml-marker dmaps-ml-from';
        el.style.width = '16px';
        el.style.height = '16px';
        el.style.backgroundColor = '#4CAF50';
        el.style.border = '3px solid #FFFFFF';
        el.style.borderRadius = '50%';
        el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.4)';
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
        el.style.width = '18px';
        el.style.height = '18px';
        el.style.backgroundColor = '#E53935';
        el.style.border = '3px solid #FFFFFF';
        el.style.borderRadius = '50%';
        el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.4)';
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

    if (following) {
      if (navigating) {
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
      } else {
        // Standard 2D follow
        map.easeTo({
          center: [fix.lon, fix.lat],
          zoom: Math.max(map.getZoom(), 16),
          duration: 350,
        });
      }
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
