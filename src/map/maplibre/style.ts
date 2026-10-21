import type { StyleSpecification } from 'maplibre-gl';
import { PALETTES, type Palette } from '../palette';
import worldLand from './worldLand.json';

export function createMapLibreStyle(theme: 'light' | 'dark' = 'light'): StyleSpecification {
  const pal: Palette = PALETTES[theme];
  const landColor = theme === 'dark' ? '#131C21' : '#F5F3ED';
  const routeCasing = theme === 'dark' ? '#0B1418' : '#FFFFFF';
  const routeLine = theme === 'dark' ? '#8DD9F5' : '#0F4C5C';

  return {
    version: 8,
    sources: {
      world: {
        type: 'geojson',
        data: worldLand as GeoJSON.GeoJSON,
      },
      features: {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        tolerance: 1.5,
        buffer: 16,
        maxzoom: 14,
      },
      buildings: {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        tolerance: 0.5,
        buffer: 0,
        maxzoom: 16,
      },
      route: {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      },
    },
    layers: [
      // 1. Base ocean background
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': pal.water },
      },
      // 2. Offline World Landmasses (Continents & Archipelago)
      {
        id: 'world-land',
        type: 'fill',
        source: 'world',
        paint: {
          'fill-color': landColor,
          'fill-opacity': 1,
        },
      },
      {
        id: 'world-coast',
        type: 'line',
        source: 'world',
        paint: {
          'line-color': pal.coast,
          'line-width': 1.2,
        },
      },
      // 3. Installed Region Vector Features
      {
        id: 'water',
        type: 'fill',
        source: 'features',
        filter: ['==', ['get', 'type'], 'water'],
        paint: {
          'fill-color': pal.water,
          'fill-opacity': 0.85,
        },
      },
      {
        id: 'water-line',
        type: 'line',
        source: 'features',
        filter: ['==', ['get', 'type'], 'water-line'],
        paint: {
          'line-color': pal.water,
          'line-width': 2,
        },
      },
      {
        id: 'green',
        type: 'fill',
        source: 'features',
        filter: ['==', ['get', 'type'], 'green'],
        paint: {
          'fill-color': pal.green,
          'fill-opacity': 0.85,
        },
      },
      {
        id: 'coast',
        type: 'line',
        source: 'features',
        filter: ['==', ['get', 'type'], 'coast'],
        paint: {
          'line-color': pal.coast,
          'line-width': 2,
        },
      },
      // 3D Buildings with fill-extrusion (base dataset or viewport source)
      {
        id: 'buildings',
        type: 'fill-extrusion',
        source: 'features',
        filter: ['==', ['get', 'type'], 'building'],
        minzoom: 15,
        paint: {
          'fill-extrusion-color': pal.buildingFill,
          'fill-extrusion-height': 8,
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.95,
        },
      },
      {
        id: 'buildings-viewport',
        type: 'fill-extrusion',
        source: 'buildings',
        filter: ['==', ['get', 'type'], 'building'],
        minzoom: 15,
        paint: {
          'fill-extrusion-color': pal.buildingFill,
          'fill-extrusion-height': 8,
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.95,
        },
      },
      // Road casings
      {
        id: 'road-casing-major',
        type: 'line',
        source: 'features',
        filter: ['all', ['==', ['get', 'type'], 'road'], ['==', ['get', 'class'], 'major']],
        minzoom: 3,
        paint: {
          'line-color': pal.roadCasing,
          'line-width': ['interpolate', ['linear'], ['zoom'], 4, 2, 12, 6, 16, 10],
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      },
      {
        id: 'road-casing-medium',
        type: 'line',
        source: 'features',
        filter: ['all', ['==', ['get', 'type'], 'road'], ['==', ['get', 'class'], 'medium']],
        minzoom: 7,
        paint: {
          'line-color': pal.roadCasing,
          'line-width': ['interpolate', ['linear'], ['zoom'], 7, 2, 12, 4, 16, 8],
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      },
      {
        id: 'road-casing-minor',
        type: 'line',
        source: 'features',
        filter: ['all', ['==', ['get', 'type'], 'road'], ['==', ['get', 'class'], 'minor']],
        minzoom: 10,
        paint: {
          'line-color': pal.roadCasing,
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 16, 6],
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      },
      // Road fills
      {
        id: 'road-fill-minor',
        type: 'line',
        source: 'features',
        filter: ['all', ['==', ['get', 'type'], 'road'], ['==', ['get', 'class'], 'minor']],
        minzoom: 10,
        paint: {
          'line-color': pal.roadMinor,
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.2, 16, 4],
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      },
      {
        id: 'road-fill-medium',
        type: 'line',
        source: 'features',
        filter: ['all', ['==', ['get', 'type'], 'road'], ['==', ['get', 'class'], 'medium']],
        minzoom: 7,
        paint: {
          'line-color': pal.roadMinor,
          'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1.5, 12, 3, 16, 6],
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      },
      {
        id: 'road-fill-major',
        type: 'line',
        source: 'features',
        filter: ['all', ['==', ['get', 'type'], 'road'], ['==', ['get', 'class'], 'major']],
        minzoom: 3,
        paint: {
          'line-color': pal.roadMajor,
          'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1, 12, 4, 16, 8],
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      },
      {
        id: 'road-foot',
        type: 'line',
        source: 'features',
        filter: ['all', ['==', ['get', 'type'], 'road'], ['==', ['get', 'class'], 'foot']],
        minzoom: 13,
        paint: {
          'line-color': pal.foot,
          'line-width': 1.2,
          'line-dasharray': [2, 2],
        },
      },
      // Route line
      {
        id: 'route-casing',
        type: 'line',
        source: 'route',
        paint: {
          'line-color': routeCasing,
          'line-width': 10,
          'line-opacity': 0.95,
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      },
      {
        id: 'route-line',
        type: 'line',
        source: 'route',
        paint: {
          'line-color': routeLine,
          'line-width': 6,
          'line-opacity': 0.95,
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      },
    ],
  };
}
