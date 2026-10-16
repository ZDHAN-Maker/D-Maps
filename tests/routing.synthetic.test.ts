import { describe, expect, it } from 'vitest';
import { RoutingEngine, FLAG_ONEWAY, FLAG_ROUNDABOUT, type RouteResult } from '../src/routing';
import { makeGraph } from './helpers/graphBuilder';

const ok = (r: ReturnType<RoutingEngine['route']>): RouteResult => {
  if (!r.ok) throw new Error(`route failed: ${r.code}`);
  return r;
};
const types = (r: RouteResult) => r.steps.map((s) => s.type);

describe('crossroads maneuvers', () => {
  //            N(2)
  //             |
  //  W(4) ---- C(1) ---- E(3)
  //             |
  //            S(0)
  const nodes: [number, number][] = [[-0.002, 0], [0, 0], [0.002, 0], [0, 0.002], [0, -0.002]];
  const build = (northName: string) => new RoutingEngine(makeGraph(
    nodes,
    [['Jalan Selatan', null], ['Jalan Timur', null], ['Jalan Barat', null], [northName, null]],
    [
      { from: 0, to: 1, way: 0 }, { from: 1, to: 2, way: northName === 'Jalan Selatan' ? 0 : 3 },
      { from: 1, to: 3, way: 1 }, { from: 1, to: 4, way: 2 },
    ],
  ));

  it('turns right toward the east', () => {
    const r = ok(build('Jalan Selatan').route({ lat: -0.002, lon: 0 }, { lat: 0, lon: 0.002 }));
    expect(types(r)).toEqual(['depart', 'turn', 'arrive']);
    expect(r.steps[1].modifier).toBe('right');
    expect(r.steps[1].name).toBe('Jalan Timur');
  });

  it('turns left toward the west', () => {
    const r = ok(build('Jalan Selatan').route({ lat: -0.002, lon: 0 }, { lat: 0, lon: -0.002 }));
    expect(types(r)).toEqual(['depart', 'turn', 'arrive']);
    expect(r.steps[1].modifier).toBe('left');
  });

  it('gives no instruction when continuing straight on the same road', () => {
    const r = ok(build('Jalan Selatan').route({ lat: -0.002, lon: 0 }, { lat: 0.002, lon: 0 }));
    expect(types(r)).toEqual(['depart', 'arrive']);
  });

  it('announces a straight continuation when the road name changes', () => {
    const r = ok(build('Jalan Baru').route({ lat: -0.002, lon: 0 }, { lat: 0.002, lon: 0 }));
    expect(types(r)).toEqual(['depart', 'continue', 'arrive']);
    expect(r.steps[1].modifier).toBe('straight');
    expect(r.steps[1].name).toBe('Jalan Baru');
  });

  it('step distances add up to the route distance and geometry indices increase', () => {
    const r = ok(build('Jalan Selatan').route({ lat: -0.002, lon: 0 }, { lat: 0, lon: 0.002 }));
    expect(r.steps.reduce((s, x) => s + x.distanceM, 0)).toBeCloseTo(r.distanceM, 1);
    const idx = r.steps.map((s) => s.geometryIndex);
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
    expect(r.steps[r.steps.length - 1].distanceM).toBe(0);
  });
});

describe('fork', () => {
  it('reports "keep right" style slight turn at a Y junction', () => {
    const nodes: [number, number][] = [[-0.002, 0], [0, 0], [0.002, 0], [0.0017, 0.001]];
    const e = new RoutingEngine(makeGraph(nodes, [['Jalan Utama', null], ['Jalan Cabang', null]], [
      { from: 0, to: 1, way: 0 }, { from: 1, to: 2, way: 0 }, { from: 1, to: 3, way: 1 },
    ]));
    const r = ok(e.route({ lat: -0.002, lon: 0 }, { lat: 0.0017, lon: 0.001 }));
    expect(types(r)).toEqual(['depart', 'fork', 'arrive']);
    expect(r.steps[1].modifier).toBe('slight_right');
  });
});

describe('roundabout', () => {
  const c = 0.0003;
  // ring (clockwise): R0 south(0) -> R1 west(1) -> R2 north(2) -> R3 east(3); arms A0..A3 (4..7)
  const nodes: [number, number][] = [
    [-c, 0], [0, -c], [c, 0], [0, c],
    [-0.002, 0], [0, -0.002], [0.002, 0], [0, 0.002],
  ];
  const ways: [string | null, string | null][] = [['Bundaran', null], ['Jalan Selatan', null], ['Jalan Barat', null], ['Jalan Utara', null], ['Jalan Timur', null]];
  const R = FLAG_ROUNDABOUT | FLAG_ONEWAY;
  const engine = new RoutingEngine(makeGraph(nodes, ways, [
    { from: 0, to: 1, way: 0, flags: R, twoWay: false }, { from: 1, to: 2, way: 0, flags: R, twoWay: false },
    { from: 2, to: 3, way: 0, flags: R, twoWay: false }, { from: 3, to: 0, way: 0, flags: R, twoWay: false },
    { from: 4, to: 0, way: 1 }, { from: 5, to: 1, way: 2 }, { from: 6, to: 2, way: 3 }, { from: 7, to: 3, way: 4 },
  ]));
  const from = { lat: -0.002, lon: 0 };

  it.each([
    ['first exit (west)', { lat: 0, lon: -0.002 }, 1, 'Jalan Barat'],
    ['second exit (north)', { lat: 0.002, lon: 0 }, 2, 'Jalan Utara'],
    ['third exit (east)', { lat: 0, lon: 0.002 }, 3, 'Jalan Timur'],
  ])('counts the %s', (_label, to, exit, name) => {
    const r = ok(engine.route(from, to));
    expect(types(r)).toEqual(['depart', 'roundabout', 'exit_roundabout', 'arrive']);
    expect(r.steps[1].exit).toBe(exit);
    expect(r.steps[1].name).toBe(name);
    expect(r.steps[2].name).toBe(name);
  });
});

describe('route that ends on the roundabout itself', () => {
  const c = 0.0003;
  const nodes: [number, number][] = [[-c, 0], [0, -c], [c, 0], [0, c], [-0.002, 0]];
  const R = FLAG_ROUNDABOUT | FLAG_ONEWAY;
  const engine = new RoutingEngine(makeGraph(nodes, [['Bundaran', null], ['Jalan Selatan', null]], [
    { from: 0, to: 1, way: 0, flags: R, twoWay: false }, { from: 1, to: 2, way: 0, flags: R, twoWay: false },
    { from: 2, to: 3, way: 0, flags: R, twoWay: false }, { from: 3, to: 0, way: 0, flags: R, twoWay: false },
    { from: 4, to: 0, way: 1 },
  ]));

  it('does not invent an exit number when the destination is on the ring', () => {
    const r = ok(engine.route({ lat: -0.002, lon: 0 }, { lat: c, lon: 0 }));
    expect(types(r)).toEqual(['depart', 'roundabout', 'arrive']);
    expect(r.steps[1].exit).toBeUndefined();
  });
});

describe('road directionality, errors', () => {
  //  a(0) --oneway--> b(1)      c(2) is a two-way detour above
  const nodes: [number, number][] = [[0, 0], [0, 0.002], [0.002, 0.001]];
  const engine = new RoutingEngine(makeGraph(nodes, [['Jalan Satu Arah', null], ['Jalan A', null], ['Jalan B', null]], [
    { from: 0, to: 1, way: 0, flags: FLAG_ONEWAY, twoWay: false },
    { from: 1, to: 2, way: 1 }, { from: 2, to: 0, way: 2 },
  ]), { bbox: [-0.01, -0.01, 0.01, 0.01] });

  it('uses the one-way street in its allowed direction', () => {
    const r = ok(engine.route({ lat: 0, lon: 0 }, { lat: 0, lon: 0.002 }));
    expect(r.distanceM).toBeCloseTo(222, -1);
  });

  it('takes the longer detour when the one-way street would be driven the wrong way', () => {
    const r = ok(engine.route({ lat: 0, lon: 0.002 }, { lat: 0, lon: 0 }));
    expect(r.distanceM).toBeGreaterThan(400);
    expect(r.geometry.length).toBe(3);
  });

  it('reports a point outside the downloaded data instead of guessing', () => {
    expect(engine.route({ lat: 5, lon: 5 }, { lat: 0, lon: 0 })).toEqual({ ok: false, code: 'OUTSIDE_DATASET' });
  });

  it('reports no road near a point that is inside the bbox but far from any road', () => {
    const r = engine.route({ lat: 0.009, lon: -0.009 }, { lat: 0, lon: 0 });
    expect(r).toEqual({ ok: false, code: 'NO_ROAD_NEAR_START' });
  });

  it('reports NO_ROUTE for disconnected road networks rather than inventing a path', () => {
    const g = makeGraph([[0, 0], [0, 0.001], [0.003, 0], [0.003, 0.001]], [['x', null]], [
      { from: 0, to: 1, way: 0 }, { from: 2, to: 3, way: 0 },
    ]);
    const r = new RoutingEngine(g, { maxSnapM: 100 }).route({ lat: 0, lon: 0 }, { lat: 0.003, lon: 0.001 });
    expect(r).toEqual({ ok: false, code: 'NO_ROUTE' });
  });
});
