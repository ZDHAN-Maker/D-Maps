/** Loader for graph.bin (format v1). Layout is documented in pipeline/dmaps_pipeline/binfmt.py. */

export const FLAG_ROUNDABOUT = 1 << 0;
export const FLAG_ONEWAY = 1 << 1;
export const FLAG_LINK = 1 << 2;
export const FLAG_DESTINATION = 1 << 3;

export type WayInfo = [name: string | null, ref: string | null];

export class GraphFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphFormatError';
  }
}

export interface Graph {
  nodeCount: number;
  edgeCount: number;
  /** degrees * 1e7 */
  lat: Int32Array;
  lon: Int32Array;
  /** CSR offsets, length nodeCount + 1 */
  first: Uint32Array;
  target: Uint32Array;
  /** edge length, decimetres */
  lenDm: Uint32Array;
  way: Uint32Array;
  speed: Uint8Array;
  cls: Uint8Array;
  flags: Uint8Array;
  /** source node of each edge (derived at load) */
  source: Uint32Array;
  ways: WayInfo[];
  maxSpeedKmh: number;
  /** reverse CSR (incoming edges), derived lazily */
  reverse?: { first: Uint32Array; edge: Uint32Array };
}

const HEADER = 32;
const align4 = (n: number) => n + ((4 - (n % 4)) % 4);

export function parseGraph(buf: ArrayBuffer, ways: WayInfo[]): Graph {
  if (buf.byteLength < HEADER) throw new GraphFormatError('graph.bin is too small');
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'DMGR') throw new GraphFormatError('graph.bin has the wrong magic number');
  const version = dv.getUint32(4, true);
  if (version !== 1) throw new GraphFormatError(`unsupported graph format version ${version}`);
  const n = dv.getUint32(8, true);
  const e = dv.getUint32(12, true);

  const expected = HEADER + 4 * n * 2 + 4 * (n + 1) + 4 * e * 3 + align4(e) * 3;
  if (buf.byteLength !== expected) {
    throw new GraphFormatError(`graph.bin size mismatch: expected ${expected} bytes, got ${buf.byteLength}`);
  }

  let off = HEADER;
  const take = <T>(ctor: new (b: ArrayBuffer, o: number, l: number) => T, len: number, bytes: number): T => {
    const view = new ctor(buf, off, len);
    off += align4(len * bytes);
    return view;
  };
  const lat = take(Int32Array, n, 4);
  const lon = take(Int32Array, n, 4);
  const first = take(Uint32Array, n + 1, 4);
  const target = take(Uint32Array, e, 4);
  const lenDm = take(Uint32Array, e, 4);
  const way = take(Uint32Array, e, 4);
  const speed = take(Uint8Array, e, 1);
  const cls = take(Uint8Array, e, 1);
  const flags = take(Uint8Array, e, 1);

  if (first[0] !== 0 || first[n] !== e) throw new GraphFormatError('corrupt CSR offsets');

  const source = new Uint32Array(e);
  let maxSpeed = 1;
  for (let u = 0; u < n; u++) for (let k = first[u]; k < first[u + 1]; k++) source[k] = u;
  for (let k = 0; k < e; k++) if (speed[k] > maxSpeed) maxSpeed = speed[k];

  return { nodeCount: n, edgeCount: e, lat, lon, first, target, lenDm, way, speed, cls, flags,
    source, ways, maxSpeedKmh: maxSpeed };
}

export const latOf = (g: Graph, i: number): number => g.lat[i] / 1e7;
export const lonOf = (g: Graph, i: number): number => g.lon[i] / 1e7;

export function reverseIndex(g: Graph): { first: Uint32Array; edge: Uint32Array } {
  if (g.reverse) return g.reverse;
  const first = new Uint32Array(g.nodeCount + 1);
  for (let k = 0; k < g.edgeCount; k++) first[g.target[k] + 1]++;
  for (let i = 0; i < g.nodeCount; i++) first[i + 1] += first[i];
  const fill = first.slice(0, g.nodeCount);
  const edge = new Uint32Array(g.edgeCount);
  for (let k = 0; k < g.edgeCount; k++) edge[fill[g.target[k]]++] = k;
  g.reverse = { first, edge };
  return g.reverse;
}
