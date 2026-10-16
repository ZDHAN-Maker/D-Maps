import type { Graph } from './graph';

/** Loader/validator for turns.bin (format v1). Layout: pipeline/dmaps_pipeline/binfmt.py. */
export class TurnsFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TurnsFormatError';
  }
}

const HEADER = 16;

/**
 * Forbidden turns: arriving over edge `from` you may not leave over edge `to`.
 *
 * Only edges that are the *incoming* side of some forbidden pair ("restricted edges") need
 * edge-level search state; every other arrival can share its node's state. That keeps the extra
 * memory proportional to the number of restrictions, not the size of the graph.
 */
export class TurnRestrictions {
  /** number of forbidden (from, to) pairs */
  readonly size: number;
  /** restricted incoming edges, by rank */
  readonly edgeOfRank: Uint32Array;
  private readonly mask: Uint32Array;
  private readonly rankOf = new Map<number, number>();
  /** per rank: sorted list of forbidden outgoing edges */
  private readonly forbidden: Uint32Array[] = [];

  /** @param flat sorted flat pairs [from0, to0, from1, to1, ...] */
  constructor(flat: Uint32Array, edgeCount: number) {
    this.size = flat.length / 2;
    this.mask = new Uint32Array((edgeCount + 31) >>> 5);
    const edges: number[] = [];
    let current = -1;
    let bucket: number[] = [];
    const flush = () => { if (current >= 0) this.forbidden.push(Uint32Array.from(bucket)); bucket = []; };
    for (let i = 0; i < flat.length; i += 2) {
      const from = flat[i], to = flat[i + 1];
      if (from !== current) {
        flush();
        current = from;
        this.rankOf.set(from, edges.length);
        edges.push(from);
        this.mask[from >>> 5] |= 1 << (from & 31);
      }
      bucket.push(to);
    }
    flush();
    this.edgeOfRank = Uint32Array.from(edges);
  }

  get restrictedCount(): number { return this.edgeOfRank.length; }

  /** rank of `edge` if it is the incoming side of a forbidden pair, else -1 (cheap bitset test first) */
  rank(edge: number): number {
    if ((this.mask[edge >>> 5] & (1 << (edge & 31))) === 0) return -1;
    return this.rankOf.get(edge) ?? -1;
  }

  /** is leaving over `to` forbidden for someone who arrived over the edge with this rank? */
  forbids(rank: number, to: number): boolean {
    const list = this.forbidden[rank];
    for (let i = 0; i < list.length; i++) if (list[i] === to) return true;
    return false;
  }

  /** public, rank-free form for tests and tools */
  forbidsPair(from: number, to: number): boolean {
    const r = this.rank(from);
    return r >= 0 && this.forbids(r, to);
  }

  static empty(edgeCount: number): TurnRestrictions {
    return new TurnRestrictions(new Uint32Array(0), edgeCount);
  }

  /** build from explicit pairs (tests, tools); sorts them */
  static fromPairs(pairs: [number, number][], edgeCount: number): TurnRestrictions {
    const sorted = [...pairs].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return new TurnRestrictions(Uint32Array.from(sorted.flat()), edgeCount);
  }

  /** all pairs, for tests and diagnostics */
  pairs(): [number, number][] {
    const out: [number, number][] = [];
    this.edgeOfRank.forEach((from, r) => { for (const to of this.forbidden[r]) out.push([from, to]); });
    return out;
  }
}

/** Parses and validates turns.bin against the graph it belongs to. Throws TurnsFormatError if anything is off. */
export function parseTurns(buf: ArrayBuffer, g: Graph): TurnRestrictions {
  if (buf.byteLength < HEADER) throw new TurnsFormatError('turns.bin is too small');
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'DMTN') throw new TurnsFormatError('turns.bin has the wrong magic number');
  const version = dv.getUint32(4, true);
  if (version !== 1) throw new TurnsFormatError(`unsupported turns format version ${version}`);
  const count = dv.getUint32(8, true);
  if (buf.byteLength !== HEADER + 8 * count) {
    throw new TurnsFormatError(`turns.bin size mismatch: expected ${HEADER + 8 * count} bytes, got ${buf.byteLength}`);
  }
  // copy into an aligned array: the buffer slice may not be 4-byte aligned in every caller
  const flat = new Uint32Array(buf.slice(HEADER));
  let pf = -1, pt = -1;
  for (let i = 0; i < flat.length; i += 2) {
    const from = flat[i], to = flat[i + 1];
    if (from >= g.edgeCount || to >= g.edgeCount) throw new TurnsFormatError(`turn pair ${i / 2} references a missing edge`);
    if (g.target[from] !== g.source[to]) throw new TurnsFormatError(`turn pair ${i / 2}: edges do not meet at one node`);
    if (from < pf || (from === pf && to <= pt)) throw new TurnsFormatError('turn pairs are not sorted / unique');
    pf = from; pt = to;
  }
  return new TurnRestrictions(flat, g.edgeCount);
}
