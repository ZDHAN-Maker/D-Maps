import { kvGet, kvSet } from '../storage/db';

/** The three kinds of data a dataset contains, reported separately in the Offline Map Manager. */
export type Component = 'rendering' | 'routing' | 'search' | 'other';

const COMPONENT_OF: Record<string, Component> = {
  'graph.bin': 'routing',
  'ways.json': 'routing',
  'turns.bin': 'routing',
  'places.json': 'search',
  'features.json': 'rendering',
};
export const COMPONENTS: Component[] = ['rendering', 'routing', 'search'];
export const componentOf = (file: string): Component => COMPONENT_OF[file] ?? 'other';

export interface CatalogFileEntry { name: string; bytes: number; sha256: string }

interface Base {
  id: string;
  parent: string | null;
  name: string;
  /** localized display names, when the proper noun differs per language */
  names?: Partial<Record<'id' | 'en', string>>;
  testFixture?: boolean;
}
export interface CatalogGroup extends Base { kind: 'group' }
export interface CatalogDataset extends Base {
  kind: 'dataset';
  dataVersion: string;
  bbox: [number, number, number, number];
  bytes: number;
  files: CatalogFileEntry[];
  license: string;
  /** where the files are hosted; default `<catalog base>/<id>` */
  baseUrl?: string;
}
export type CatalogRegion = CatalogGroup | CatalogDataset;
export interface CatalogFile { formatVersion: 1; regions: CatalogRegion[] }

export class CatalogError extends Error {
  constructor(message: string) { super(message); this.name = 'CatalogError'; }
}

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SHA_RE = /^[0-9a-f]{64}$/;

export function validateCatalog(raw: unknown): CatalogFile {
  const c = raw as Partial<CatalogFile> | null;
  if (!c || typeof c !== 'object') throw new CatalogError('catalog is not an object');
  if (c.formatVersion !== 1) throw new CatalogError(`unsupported catalog format ${String(c.formatVersion)}`);
  if (!Array.isArray(c.regions)) throw new CatalogError('catalog has no regions list');
  const ids = new Set<string>();
  const groups = new Set<string>();
  for (const r of c.regions) {
    if (typeof r?.id !== 'string' || !ID_RE.test(r.id)) throw new CatalogError(`invalid region id: ${String(r?.id)}`);
    if (ids.has(r.id)) throw new CatalogError(`duplicate region id ${r.id}`);
    ids.add(r.id);
    if (typeof r.name !== 'string' || !r.name) throw new CatalogError(`region ${r.id} has no name`);
    const kind: string = r.kind;
    if (kind === 'group') groups.add(r.id);
    else if (kind !== 'dataset') throw new CatalogError(`region ${r.id} has unknown kind`);
  }
  for (const r of c.regions) {
    if (r.parent !== null && !groups.has(r.parent)) throw new CatalogError(`region ${r.id} has unknown parent ${String(r.parent)}`);
    if (r.kind !== 'dataset') continue;
    if (!/^[0-9a-f]{12}$/.test(r.dataVersion)) throw new CatalogError(`region ${r.id}: invalid dataVersion`);
    if (!Array.isArray(r.bbox) || r.bbox.length !== 4 || r.bbox.some((x) => !Number.isFinite(x))) throw new CatalogError(`region ${r.id}: invalid bbox`);
    if (!Array.isArray(r.files) || r.files.length === 0) throw new CatalogError(`region ${r.id}: no files`);
    let total = 0;
    for (const f of r.files) {
      if (!FILE_RE.test(f?.name ?? '') || !Number.isInteger(f.bytes) || f.bytes < 0 || !SHA_RE.test(f.sha256 ?? '')) {
        throw new CatalogError(`region ${r.id}: invalid file entry ${String(f?.name)}`);
      }
      total += f.bytes;
    }
    if (total !== r.bytes) throw new CatalogError(`region ${r.id}: bytes (${r.bytes}) does not equal the sum of its files (${total})`);
  }
  return c as CatalogFile;
}

export interface TreeNode { region: CatalogRegion; children: TreeNode[] }

/** Roots first as listed in the catalog; children keep catalog order. Datasets never have children. */
export function buildTree(regions: CatalogRegion[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>(regions.map((r) => [r.id, { region: r, children: [] }]));
  const roots: TreeNode[] = [];
  for (const r of regions) {
    const node = nodes.get(r.id) as TreeNode;
    if (r.parent === null) roots.push(node);
    else nodes.get(r.parent)?.children.push(node);
  }
  return roots;
}

export const displayName = (r: Pick<Base, 'name' | 'names'>, lang: 'id' | 'en'): string => r.names?.[lang] ?? r.name;

/** All dataset regions below (and including) a node. */
export function datasetsUnder(node: TreeNode): CatalogDataset[] {
  return node.region.kind === 'dataset' ? [node.region] : node.children.flatMap(datasetsUnder);
}

export function bytesByComponent(files: { name: string; bytes: number }[]): Record<Component, number> {
  const out: Record<Component, number> = { rendering: 0, routing: 0, search: 0, other: 0 };
  for (const f of files) out[componentOf(f.name)] += f.bytes;
  return out;
}

export const datasetBaseUrl = (r: CatalogDataset, catalogBase: string): string =>
  r.baseUrl ?? `${catalogBase.replace(/\/+$/, '')}/${r.id}`;

const KV_KEY = 'catalog.cache';
export interface CachedCatalog { catalog: CatalogFile; fetchedAt: number }

/**
 * Fetches the list of downloadable regions. Needs a network (it is on a static host); the last good copy is
 * kept locally so the manager can still show what exists when offline, clearly marked as possibly outdated.
 */
export async function fetchCatalog(catalogBase: string, fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<CachedCatalog> {
  const res = await fetchImpl(`${catalogBase.replace(/\/+$/, '')}/catalog.json`, { cache: 'no-store', signal });
  if (!res.ok) throw new CatalogError(`catalog request failed: HTTP ${res.status}`);
  const catalog = validateCatalog(await res.json());
  const cached: CachedCatalog = { catalog, fetchedAt: Date.now() };
  try { await kvSet(KV_KEY, cached); } catch { /* cache is best-effort */ }
  return cached;
}

export async function loadCachedCatalog(): Promise<CachedCatalog | null> {
  try {
    const v = await kvGet<CachedCatalog>(KV_KEY);
    return v ? { catalog: validateCatalog(v.catalog), fetchedAt: v.fetchedAt } : null;
  } catch { return null; }
}
