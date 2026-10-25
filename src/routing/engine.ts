import { Router } from './astar';
import { type Graph, type WayInfo, parseGraph, latOf, lonOf } from './graph';
import { NodeGrid } from './spatial';
import type { TurnRestrictions } from './turns';
import { buildSteps, type Step } from './instructions';

export interface LatLon { lat: number; lon: number }

export type RouteErrorCode =
  | 'OUTSIDE_DATASET'      // a point is outside the downloaded region's bounding box
  | 'NO_ROAD_NEAR_START'   // no routable road within snap range of the start
  | 'NO_ROAD_NEAR_END'
  | 'NO_ROUTE'            // both ends snap, but the downloaded graph does not connect them
  | 'DIFFERENT_REGIONS';  // each point is in a downloaded region, but not the same one (no cross-region routing yet)

export interface RouteError { ok: false; code: RouteErrorCode; detail?: string }

export interface RouteResult {
  ok: true;
  distanceM: number;
  durationS: number;
  geometry: [number, number][];
  steps: Step[];
  snapped: { from: LatLon & { offsetM: number }; to: LatLon & { offsetM: number } };
  stats: { expandedNodes: number; computeMs: number };
}

export interface EngineOptions {
  /** how far a clicked point may be from a routable node, metres */
  maxSnapM?: number;
  /** [minLat, minLon, maxLat, maxLon] of the downloaded dataset, if known */
  bbox?: [number, number, number, number];
  /** forbidden turns from turns.bin; absent = no turn restrictions known for this dataset */
  turns?: TurnRestrictions;
}

const SNAP_CANDIDATES = 3;

/**
 * Offline routing facade: snap -> A* -> maneuvers. Pure TypeScript, no network, runs in a
 * worker or on the main thread. Limitations (also listed in dataset manifests): only simple
 * (via-node) turn restrictions are applied, and snapping goes to the nearest *node*, not edge segment.
 */
export class RoutingEngine {
  private readonly router: Router;
  private readonly grid: NodeGrid;
  private readonly hasIn: Uint8Array;
  private readonly maxSnapM: number;

  constructor(readonly graph: Graph, private readonly opts: EngineOptions = {}) {
    this.router = new Router(graph, opts.turns);
    this.grid = new NodeGrid(graph);
    this.maxSnapM = opts.maxSnapM ?? 300;
    this.hasIn = new Uint8Array(graph.nodeCount);
    for (let e = 0; e < graph.edgeCount; e++) this.hasIn[graph.target[e]] = 1;
  }

  static fromBuffer(buf: ArrayBuffer, ways: WayInfo[], opts?: EngineOptions): RoutingEngine {
    return new RoutingEngine(parseGraph(buf, ways), opts);
  }

  private outside(p: LatLon): boolean {
    const b = this.opts.bbox;
    return !!b && (p.lat < b[0] || p.lat > b[2] || p.lon < b[1] || p.lon > b[3]);
  }

  route(from: LatLon, to: LatLon): RouteResult | RouteError {
    const t0 = performance.now();
    if (this.outside(from) || this.outside(to)) return { ok: false, code: 'OUTSIDE_DATASET' };
    const g = this.graph;

    const starts = this.grid.nearest(from.lat, from.lon, (n) => g.first[n + 1] > g.first[n], SNAP_CANDIDATES, this.maxSnapM);
    if (starts.length === 0) return { ok: false, code: 'NO_ROAD_NEAR_START' };
    const ends = this.grid.nearest(to.lat, to.lon, (n) => this.hasIn[n] === 1, SNAP_CANDIDATES, this.maxSnapM);
    if (ends.length === 0) return { ok: false, code: 'NO_ROAD_NEAR_END' };

    // Evaluate snap candidates to select the fastest and most accurate door-to-door route.
    // Rather than blindly taking the first connected candidate pair (which could be an alley or detour),
    // we evaluate candidates and choose the one that minimizes total travel time (road duration + snap transition).
    let bestResult: RouteResult | null = null;
    let bestScore = Infinity;
    let expanded = 0;
    const ACCESS_SPEED_MS = 1.39; // ~5 km/h walking / maneuver speed to road network

    for (const s of starts) {
      for (const d of ends) {
        const path = this.router.route(s.node, d.node);
        if (!path) { continue; }
        expanded += path.expanded;

        const effectiveDuration = path.durationS + (s.distanceM + d.distanceM) / ACCESS_SPEED_MS;
        if (
          effectiveDuration < bestScore - 0.1 ||
          (Math.abs(effectiveDuration - bestScore) <= 0.1 && (!bestResult || path.distanceM < bestResult.distanceM))
        ) {
          bestScore = effectiveDuration;
          const { steps, geometry } = buildSteps(g, path.nodes, path.edges);
          bestResult = {
            ok: true,
            distanceM: path.distanceM,
            durationS: path.durationS,
            geometry,
            steps,
            snapped: {
              from: { lat: latOf(g, s.node), lon: lonOf(g, s.node), offsetM: s.distanceM },
              to: { lat: latOf(g, d.node), lon: lonOf(g, d.node), offsetM: d.distanceM },
            },
            stats: { expandedNodes: expanded, computeMs: 0 },
          };
        }
      }
    }

    if (bestResult) {
      bestResult.stats.expandedNodes = expanded;
      bestResult.stats.computeMs = performance.now() - t0;
      return bestResult;
    }
    return { ok: false, code: 'NO_ROUTE' };
  }
}
