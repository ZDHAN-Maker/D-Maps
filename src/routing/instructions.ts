import { FLAG_LINK, FLAG_ROUNDABOUT, type Graph, latOf, lonOf } from './graph';
import { angleDiff, bearingDeg } from './geo';

export type ManeuverType =
  | 'depart' | 'continue' | 'turn' | 'fork' | 'ramp' | 'uturn'
  | 'roundabout' | 'exit_roundabout' | 'arrive';

export type Modifier =
  | 'straight' | 'slight_left' | 'left' | 'sharp_left'
  | 'slight_right' | 'right' | 'sharp_right' | 'uturn';

export interface Step {
  type: ManeuverType;
  modifier?: Modifier;
  /**
   * Roundabout exit number (1-based). Undefined only when the route *ends inside* the
   * roundabout (destination on the ring): then the instruction is "enter the roundabout",
   * never an invented exit number.
   */
  exit?: number;
  /** road the driver is on *after* this maneuver */
  name: string | null;
  ref: string | null;
  /** distance from this maneuver to the next one, metres */
  distanceM: number;
  durationS: number;
  /** [lat, lon] of the maneuver point */
  location: [number, number];
  /** index into the route geometry where this step begins */
  geometryIndex: number;
  /** heading just after the maneuver, degrees */
  bearingAfter: number;
}

/** Sampling distance for bearings: avoids noise from tiny OSM segments near junctions. */
const LOOK_M = 15;
const STRAIGHT_DEG = 15;
const SLIGHT_DEG = 45;
const SHARP_DEG = 120;
const UTURN_DEG = 165;

export function modifierFor(angle: number): Modifier {
  const a = Math.abs(angle);
  const right = angle > 0;
  if (a < STRAIGHT_DEG) return 'straight';
  if (a < SLIGHT_DEG) return right ? 'slight_right' : 'slight_left';
  if (a < SHARP_DEG) return right ? 'right' : 'left';
  if (a < UTURN_DEG) return right ? 'sharp_right' : 'sharp_left';
  return 'uturn';
}

function wayLabel(g: Graph, edge: number): { name: string | null; ref: string | null } {
  const w = g.ways[g.way[edge]];
  return { name: w?.[0] ?? null, ref: w?.[1] ?? null };
}

const sameRoad = (a: { name: string | null; ref: string | null }, b: { name: string | null; ref: string | null }) =>
  a.name === b.name && (a.name !== null || a.ref === b.ref);

export function buildSteps(g: Graph, nodes: number[], edges: number[]): { steps: Step[]; geometry: [number, number][] } {
  const geometry: [number, number][] = nodes.map((n) => [latOf(g, n), lonOf(g, n)]);
  const cum: number[] = [0];
  for (const e of edges) cum.push(cum[cum.length - 1] + g.lenDm[e] / 10);

  const bearingBefore = (k: number): number => {
    let j = k - 1;
    while (j > 0 && cum[k] - cum[j] < LOOK_M) j--;
    return bearingDeg(geometry[j][0], geometry[j][1], geometry[k][0], geometry[k][1]);
  };
  const bearingAfterNode = (k: number): number => {
    let j = k + 1;
    while (j < nodes.length - 1 && cum[j] - cum[k] < LOOK_M) j++;
    return bearingDeg(geometry[k][0], geometry[k][1], geometry[j][0], geometry[j][1]);
  };

  const steps: Step[] = [];
  const open = (s: Omit<Step, 'distanceM' | 'durationS'>): Step => {
    const step: Step = { ...s, distanceM: 0, durationS: 0 };
    steps.push(step);
    return step;
  };

  if (edges.length === 0) {
    open({ type: 'arrive', name: null, ref: null, location: geometry[0] ?? [0, 0], geometryIndex: 0, bearingAfter: 0 });
    return { steps, geometry };
  }

  const first = wayLabel(g, edges[0]);
  open({ type: 'depart', ...first, location: geometry[0], geometryIndex: 0, bearingAfter: bearingAfterNode(0) });

  let roundabout: { step: Step; exits: number } | null = null;

  for (let k = 1; k < nodes.length - 1; k++) {
    const inE = edges[k - 1];
    const outE = edges[k];
    const v = nodes[k];
    const prev = nodes[k - 1];
    const next = nodes[k + 1];
    const inRound = (g.flags[inE] & FLAG_ROUNDABOUT) !== 0;
    const outRound = (g.flags[outE] & FLAG_ROUNDABOUT) !== 0;
    const outLabel = wayLabel(g, outE);
    const at = geometry[k];

    // Accumulate the edge we just crossed into the currently open step.
    const cur = steps[steps.length - 1];
    cur.distanceM += g.lenDm[inE] / 10;
    cur.durationS += g.lenDm[inE] / 10 / (g.speed[inE] / 3.6);

    if (!inRound && outRound) {
      const step = open({ type: 'roundabout', ...outLabel, location: at, geometryIndex: k, bearingAfter: bearingAfterNode(k) });
      roundabout = { step, exits: 0 };
      continue;
    }
    if (inRound && outRound) {
      if (roundabout) {
        // every non-roundabout way leaving this node is an exit the driver passes
        let hasExit = false;
        for (let e = g.first[v]; e < g.first[v + 1]; e++) {
          if (!(g.flags[e] & FLAG_ROUNDABOUT) && g.target[e] !== prev) { hasExit = true; break; }
        }
        if (hasExit) roundabout.exits++;
      }
      continue;
    }
    if (inRound && !outRound && roundabout) {
      roundabout.step.exit = roundabout.exits + 1;
      roundabout.step.name = outLabel.name;
      roundabout.step.ref = outLabel.ref;
      roundabout = null;
      open({ type: 'exit_roundabout', ...outLabel, location: at, geometryIndex: k, bearingAfter: bearingAfterNode(k) });
      continue;
    }

    const angle = angleDiff(bearingBefore(k), bearingAfterNode(k));
    const inLabel = wayLabel(g, inE);
    const nameChanged = !sameRoad(inLabel, outLabel) && (outLabel.name !== null || outLabel.ref !== null);

    // Alternatives: other roads one could drive onto from here (not the way we came).
    // Only roads of comparable importance count as a *decision* the driver must be told about:
    // a driveway or service lane branching off a primary road is not announced. Road class ids
    // are ordered most -> least important (see pipeline profile.CLASSES).
    const importance = Math.max(g.cls[inE], g.cls[outE]);
    let alternatives = 0;      // any other drivable exit (used for ramps)
    let significant = 0;       // exits comparable to the roads we are on
    for (let e = g.first[v]; e < g.first[v + 1]; e++) {
      if (g.target[e] === prev || g.target[e] === next) continue;
      alternatives++;
      if (g.cls[e] <= importance + 1) significant++;
    }

    let emit: { type: ManeuverType; modifier?: Modifier } | null = null;
    if (next === prev) {
      emit = { type: 'uturn', modifier: 'uturn' };
    } else if ((g.flags[outE] & FLAG_LINK) && !(g.flags[inE] & FLAG_LINK) && alternatives > 0) {
      emit = { type: 'ramp', modifier: angle >= 0 ? 'slight_right' : 'slight_left' };
    } else if (significant > 0) {
      // A hairpin onto a *different* road is a sharp turn, not a U-turn: "make a U-turn" would
      // be wrong (and possibly illegal). 'uturn' is reserved for reversing along the same road.
      let mod = modifierFor(angle);
      if (mod === 'uturn') mod = angle > 0 ? 'sharp_right' : 'sharp_left';
      if (mod === 'straight') {
        if (nameChanged) emit = { type: 'continue', modifier: 'straight' };
      } else if (mod === 'slight_left' || mod === 'slight_right') {
        emit = { type: 'fork', modifier: mod };
      } else {
        emit = { type: 'turn', modifier: mod };
      }
    } else if (nameChanged && Math.abs(angle) >= STRAIGHT_DEG) {
      const m = modifierFor(angle);
      emit = { type: 'continue', modifier: m === 'uturn' ? (angle > 0 ? 'sharp_right' : 'sharp_left') : m };
    } else if (nameChanged && inLabel.name !== null && outLabel.name !== null) {
      emit = { type: 'continue', modifier: 'straight' };
    }

    if (emit) {
      open({ ...emit, ...outLabel, location: at, geometryIndex: k, bearingAfter: bearingAfterNode(k) });
    }
  }

  // last edge, then arrival
  const lastEdge = edges[edges.length - 1];
  const tail = steps[steps.length - 1];
  tail.distanceM += g.lenDm[lastEdge] / 10;
  tail.durationS += g.lenDm[lastEdge] / 10 / (g.speed[lastEdge] / 3.6);
  const end = geometry[geometry.length - 1];
  open({ type: 'arrive', name: null, ref: null, location: end, geometryIndex: geometry.length - 1,
    bearingAfter: bearingBefore(nodes.length - 1) });
  return { steps, geometry };
}
