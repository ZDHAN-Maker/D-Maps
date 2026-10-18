import { describe, expect, it } from 'vitest';
import { featuresToGeoJson } from '../src/map/maplibre/featuresToGeojson';
import { createMapLibreStyle } from '../src/map/maplibre/style';
import { registerPMTilesProtocol } from '../src/map/maplibre/pmtilesProtocol';
import type { FeaturesFile } from '../src/map/features';

describe('MapLibre GL & PMTiles integration', () => {
  it('registers PMTiles protocol without throwing', () => {
    const proto = registerPMTilesProtocol();
    expect(proto).toBeDefined();
    expect(typeof proto.tile).toBe('function');
  });

  it('converts FeaturesFile vector data to GeoJSON FeatureCollection', () => {
    const fakeFeatures: FeaturesFile = {
      scale: 1e5,
      water: [[100000, 100000, 0, 1000, 1000, 0]], // triangle
      green: [[200000, 200000, 0, 1000, 1000, 0]],
      coast: [[300000, 300000, 1000, 1000]],
      roads: [
        ['primary', [400000, 400000, 500, 500]],
        ['secondary', [410000, 410000, 500, 500]],
        ['residential', [420000, 420000, 500, 500]],
        ['footway', [430000, 430000, 500, 500]],
      ],
      buildings: [[500000, 500000, 0, 500, 500, 0]],
    };

    const col = featuresToGeoJson(fakeFeatures);
    expect(col.type).toBe('FeatureCollection');
    expect(col.features.length).toBe(8);

    const water = col.features.find((f) => f.properties.type === 'water');
    expect(water).toBeDefined();
    expect(water?.geometry.type).toBe('Polygon');

    const roadMajor = col.features.find((f) => f.properties.type === 'road' && f.properties.class === 'major');
    expect(roadMajor).toBeDefined();
    expect(roadMajor?.geometry.type).toBe('LineString');

    const roadMedium = col.features.find((f) => f.properties.type === 'road' && f.properties.class === 'medium');
    expect(roadMedium).toBeDefined();

    const roadFoot = col.features.find((f) => f.properties.type === 'road' && f.properties.class === 'foot');
    expect(roadFoot).toBeDefined();

    const building = col.features.find((f) => f.properties.type === 'building');
    expect(building).toBeDefined();
    expect(building?.properties.height).toBe(8); // 3D extrusion height
  });

  it('generates a valid MapLibre Style Specification for light and dark themes', async () => {
    const lightStyle = createMapLibreStyle('light');
    expect(lightStyle.version).toBe(8);
    expect(lightStyle.sources.world).toBeDefined();
    expect(lightStyle.sources.features).toBeDefined();
    expect(lightStyle.sources.route).toBeDefined();

    // Check world land and 3D building extrusion layer
    const worldLandLayer = lightStyle.layers.find((l) => l.id === 'world-land');
    expect(worldLandLayer).toBeDefined();
    expect(worldLandLayer?.type).toBe('fill');

    const bldgLayer = lightStyle.layers.find((l) => l.id === 'buildings');
    expect(bldgLayer).toBeDefined();
    expect(bldgLayer?.type).toBe('fill-extrusion');

    // Check dark theme
    const darkStyle = createMapLibreStyle('dark');
    expect(darkStyle.version).toBe(8);
    const darkBg = darkStyle.layers.find((l) => l.id === 'background');
    expect((darkBg?.paint as Record<string, unknown> | undefined)?.['background-color']).toBe('#1F5A73');

    const { validateStyleMin } = await import('@maplibre/maplibre-gl-style-spec');
    const errors = validateStyleMin(lightStyle);
    expect(errors).toEqual([]);
  });
});
