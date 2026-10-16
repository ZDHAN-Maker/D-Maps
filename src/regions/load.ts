import { RoutingEngine, parseGraph, parseTurns, type WayInfo } from '../routing';
import { SearchIndex, type PlaceRecord } from '../search';
import { getDataset, readDatasetFile, readDatasetJson, type DatasetRecord } from '../storage';
import type { FeaturesFile } from '../map/features';
import type { RegionRuntime } from './regionSet';

/** Reads an installed dataset out of IndexedDB and builds its engine, search index and map features. */
export async function loadRegion(id: string): Promise<{ record: DatasetRecord; runtime: RegionRuntime }> {
  const record = await getDataset(id);
  if (!record || record.status !== 'complete') throw new Error(`dataset "${id}" is not installed`);
  const [graphBuf, ways, places, features] = await Promise.all([
    readDatasetFile(id, 'graph.bin'),
    readDatasetJson<WayInfo[]>(id, 'ways.json'),
    readDatasetJson<PlaceRecord[]>(id, 'places.json'),
    readDatasetJson<FeaturesFile>(id, 'features.json'),
  ]);
  const bbox = record.manifest.bbox;
  const graph = parseGraph(graphBuf, ways);
  // turns.bin is optional: datasets built before turn-restriction support simply do not list it
  const hasTurns = record.manifest.files.some((f) => f.name === 'turns.bin');
  const turns = hasTurns ? parseTurns(await readDatasetFile(id, 'turns.bin'), graph) : undefined;
  const engine = new RoutingEngine(graph, { bbox, turns });
  return { record, runtime: { id, name: record.name, bbox, engine, index: new SearchIndex(places), features } };
}
