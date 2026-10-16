import { type Graph, latOf, lonOf } from './graph';
import { haversineM } from './geo';

export interface Snap {
  node: number;
  distanceM: number;
}

/** Uniform-grid index over graph nodes for nearest-node queries. */
export class NodeGrid {
  private readonly minLat: number;
  private readonly minLon: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly cellStart: Uint32Array;
  private readonly cellNodes: Uint32Array;
  private readonly cellMeters: number;

  constructor(private readonly g: Graph, private readonly cellDeg = 0.002) {
    let minLat = 90, minLon = 180, maxLat = -90, maxLon = -180;
    for (let i = 0; i < g.nodeCount; i++) {
      const la = latOf(g, i), lo = lonOf(g, i);
      if (la < minLat) minLat = la;
      if (la > maxLat) maxLat = la;
      if (lo < minLon) minLon = lo;
      if (lo > maxLon) maxLon = lo;
    }
    if (g.nodeCount === 0) { minLat = minLon = maxLat = maxLon = 0; }
    this.minLat = minLat;
    this.minLon = minLon;
    this.cols = Math.floor((maxLon - minLon) / cellDeg) + 1;
    this.rows = Math.floor((maxLat - minLat) / cellDeg) + 1;
    const midLat = (minLat + maxLat) / 2;
    // conservative metres per cell: the smaller of the lat / lon extents
    this.cellMeters = Math.min(cellDeg * 111_000, cellDeg * 111_000 * Math.cos((midLat * Math.PI) / 180));

    const count = new Uint32Array(this.cols * this.rows + 1);
    const cellOf = new Uint32Array(g.nodeCount);
    for (let i = 0; i < g.nodeCount; i++) {
      const c = this.cellIndex(latOf(g, i), lonOf(g, i));
      cellOf[i] = c;
      count[c + 1]++;
    }
    for (let c = 0; c < this.cols * this.rows; c++) count[c + 1] += count[c];
    const fill = count.slice(0, this.cols * this.rows);
    this.cellNodes = new Uint32Array(g.nodeCount);
    for (let i = 0; i < g.nodeCount; i++) this.cellNodes[fill[cellOf[i]]++] = i;
    this.cellStart = count;
  }

  private cellIndex(lat: number, lon: number): number {
    const cx = Math.min(this.cols - 1, Math.max(0, Math.floor((lon - this.minLon) / this.cellDeg)));
    const cy = Math.min(this.rows - 1, Math.max(0, Math.floor((lat - this.minLat) / this.cellDeg)));
    return cy * this.cols + cx;
  }

  /** Up to `limit` nearest nodes accepted by `accept`, nearest first, within maxM metres. */
  nearest(lat: number, lon: number, accept: (node: number) => boolean, limit = 1, maxM = 500): Snap[] {
    const cx = Math.floor((lon - this.minLon) / this.cellDeg);
    const cy = Math.floor((lat - this.minLat) / this.cellDeg);
    const found: Snap[] = [];
    const maxRing = Math.min(Math.ceil(maxM / this.cellMeters) + 1, Math.max(this.cols, this.rows) + 1);
    for (let r = 0; r <= maxRing; r++) {
      for (let y = cy - r; y <= cy + r; y++) {
        for (let x = cx - r; x <= cx + r; x++) {
          if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r) continue; // ring perimeter only
          if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) continue;
          const c = y * this.cols + x;
          for (let k = this.cellStart[c]; k < this.cellStart[c + 1]; k++) {
            const node = this.cellNodes[k];
            if (!accept(node)) continue;
            const d = haversineM(lat, lon, latOf(this.g, node), lonOf(this.g, node));
            if (d <= maxM) found.push({ node, distanceM: d });
          }
        }
      }
      // Every unvisited cell is at least r * cellMeters away: stop once we have enough closer hits.
      if (found.length >= limit) {
        found.sort((a, b) => a.distanceM - b.distanceM);
        if (found[limit - 1].distanceM <= r * this.cellMeters) break;
      }
    }
    found.sort((a, b) => a.distanceM - b.distanceM);
    return found.slice(0, limit);
  }
}
