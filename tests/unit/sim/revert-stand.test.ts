// Where Revert stands to work, so the visitor can see the work (S7 item 4): it fits the cover from behind
// the console, facing the visitor over it (A1 round 7); it sweeps a part from the part's far side, facing the visitor across it; and its
// track clears every fixed thing on the bench.
import { describe, expect, test } from 'vitest';
import { stubWorld, run } from './helpers.ts';
import type { StubPhysics } from '../../../src/workshop/sim/physics/stub.ts';
import type { World } from '../../../src/workshop/sim/world.ts';
import { bench, AT, REVERT, CREW_SCALE } from '../../../src/workshop/sim/scenes/bench.ts';
import { lanePath } from '../../../src/workshop/sim/path.ts';
import { FETCH_TUNING } from '../../../src/workshop/sim/crew/fetch.ts';
import { defaultHalfExtents } from '../../../src/workshop/sim/parts.ts';
import { qyaw, rotate, yawOf } from '../../../src/workshop/sim/math.ts';
import { steps } from '../../../src/workshop/sim/clock.ts';
import type { Id, RevertView, SimEvent } from '../../../src/workshop/sim/types.ts';

const { rounds: _rounds, ...quietRunner } = bench.runner;
const quietStub = () => stubWorld(1, { scene: { ...bench, runner: quietRunner } });
const R = (w: World): RevertView => w.machine('revert-crew') as RevertView;
const [HX, , HZ] = AT.revert.half;

/** Fixed things standing on the bench top, as boxes (x, z, half x, half z, yaw). */
const fixed = bench.statics.flatMap((st) => {
  const parts = st.shape.type === 'box' ? [{ half: st.shape.half, at: { p: [0, 0, 0] as const, q: [0, 0, 0, 1] as const } }] : st.shape.parts;
  return parts.flatMap((pt) => {
    const c = rotate(st.pose.q, [pt.at.p[0], pt.at.p[1], pt.at.p[2]]);
    const cy = st.pose.p[1] + c[1];
    if (cy + pt.half[1] < 0.1 || cy - pt.half[1] > 2 * AT.revert.half[1]) return [];
    const yaw = yawOf(st.pose.q) + yawOf([pt.at.q[0], pt.at.q[1], pt.at.q[2], pt.at.q[3]]);
    return [{ id: st.id, x: st.pose.p[0] + c[0], z: st.pose.p[2] + c[2], hx: pt.half[0], hz: pt.half[2], yaw }];
  });
});
/** Axes of a box turned by yaw (heading 0 faces +Z): its right and its front, on x and z. */
const axes = (h: number): [readonly [number, number], readonly [number, number]] => [
  [Math.cos(h), -Math.sin(h)],
  [Math.sin(h), Math.cos(h)],
];
/** What fixed thing its body would overlap at (x, z) facing h, if any (separating axes, both boxes oriented). */
function hits(x: number, z: number, h: number): string | null {
  const [ra, fa] = axes(h);
  for (const f of fixed) {
    const [rb, fb] = axes(f.yaw);
    const d = [f.x - x, f.z - z] as const;
    const apart = [ra, fa, rb, fb].some((ax) => {
      const pa = Math.abs(ra[0] * ax[0] + ra[1] * ax[1]) * HX + Math.abs(fa[0] * ax[0] + fa[1] * ax[1]) * HZ;
      const pb = Math.abs(rb[0] * ax[0] + rb[1] * ax[1]) * f.hx + Math.abs(fb[0] * ax[0] + fb[1] * ax[1]) * f.hz;
      return Math.abs(d[0] * ax[0] + d[1] * ax[1]) >= pa + pb;
    });
    if (!apart) return f.id;
  }
  return null;
}
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
/** Turning on the spot from one heading to another the short way, as it does. */
function turnHits(x: number, z: number, from: number, to: number): string | null {
  const d = wrap(to - from);
  for (let k = 0; k <= 24; k++) {
    const hit = hits(x, z, from + (d * k) / 24);
    if (hit) return hit;
  }
  return null;
}

function setDown(w: World, ph: StubPhysics, id: Id, x: number, z: number): void {
  const m = w.motion(id)!;
  w.dispatch({ type: 'grab', id, grip: m.pose.p });
  run(w, 1);
  ph.land(id, { p: [x, w.halfExtents(id)![1], z], q: qyaw(0) }, 6);
  w.dispatch({ type: 'release', velocity: [2, 1, 0] });
  run(w, 40);
}

describe('Revert stands where the work is seen', () => {
  test('its track clears every fixed thing, driving each leg and turning at each corner, both ways', () => {
    const pts = REVERT.path;
    const headings: number[] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [a, b] = [pts[i]!, pts[i + 1]!];
      const h = Math.atan2(b[0] - a[0], b[1] - a[1]);
      headings.push(h);
      for (let k = 0; k <= 40; k++) {
        const t = k / 40;
        expect(hits(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, h), `leg ${i} at ${t}`).toBeNull();
      }
    }
    for (let i = 1; i + 1 < pts.length; i++) {
      const [x, z] = pts[i]!;
      expect(turnHits(x, z, headings[i - 1]!, headings[i]!), `corner ${i} outward`).toBeNull();
      expect(turnHits(x, z, wrap(headings[i]! + Math.PI), wrap(headings[i - 1]! + Math.PI)), `corner ${i} back`).toBeNull();
    }
    // at each place (on the track, or a spur straight from its nearest waypoint): arriving, turning to the
    // place's heading, and turning back to leave
    for (const [name, spot] of Object.entries({ home: REVERT.home, button: REVERT.button, park: REVERT.park })) {
      expect(hits(spot.x, spot.z, spot.heading), name).toBeNull();
      const i = pts.findIndex(([x, z]) => Math.hypot(x - spot.x, z - spot.z) < 1e-9);
      const ins: number[] = [];
      if (i < 0) {
        let n = 0;
        pts.forEach(([x, z], k) => {
          if (Math.hypot(x - spot.x, z - spot.z) < Math.hypot(pts[n]![0] - spot.x, pts[n]![1] - spot.z)) n = k;
        });
        const [wx, wz] = pts[n]!;
        const h = Math.atan2(spot.x - wx, spot.z - wz);
        for (let k = 0; k <= 20; k++) expect(hits(wx + ((spot.x - wx) * k) / 20, wz + ((spot.z - wz) * k) / 20, h), `${name} spur`).toBeNull();
        for (const hh of [headings[n - 1], headings[n]]) {
          if (hh === undefined) continue;
          expect(turnHits(wx, wz, hh, h), `${name} spur corner`).toBeNull();
          expect(turnHits(wx, wz, wrap(h + Math.PI), wrap(hh + Math.PI)), `${name} spur corner back`).toBeNull();
          expect(turnHits(wx, wz, wrap(h + Math.PI), hh), `${name} spur corner on`).toBeNull();
        }
        ins.push(h);
      } else {
        if (i > 0) ins.push(headings[i - 1]!);
        if (i < headings.length) ins.push(wrap(headings[i]! + Math.PI));
      }
      for (const h of ins) {
        expect(turnHits(spot.x, spot.z, h, spot.heading), `${name} arriving`).toBeNull();
        expect(turnHits(spot.x, spot.z, spot.heading, wrap(h + Math.PI)), `${name} leaving`).toBeNull();
      }
    }
  });

  test('it fits the cover from behind the console, facing the visitor over it, where its turning circle clears Fetch, the platen and Patch', () => {
    const b = REVERT.button;
    expect(b.heading).toBe(0);
    const back = AT.console.c[2] - AT.console.half[2];
    expect(b.z).toBeLessThan(back);
    // its shoulder (front left) in line with the Button's cap
    expect(Math.abs(b.x - 0.64 - AT.buttonCap[0])).toBeLessThan(0.05);
    const turn = Math.hypot(HX, HZ);
    // Fetch's path, its round footprint round every point of it
    const fr = Math.hypot(defaultHalfExtents('robot', 'M')[0], defaultHalfExtents('robot', 'M')[2]) * CREW_SCALE;
    const path = lanePath(AT.lane.points as readonly (readonly [number, number])[], FETCH_TUNING.cornerRadius * CREW_SCALE);
    for (let i = 0; i <= 400; i++) {
      const [x, z] = path.at((path.length * i) / 400);
      expect(Math.hypot(x - b.x, z - b.z) - fr, `Fetch at (${x.toFixed(2)}, ${z.toFixed(2)})`).toBeGreaterThan(turn);
    }
    // the platen, Patch's runner and its stool at every stop, and the console itself
    const stool = AT.stool.half;
    const boxes: Array<[string, number, number, number, number]> = [
      ...[AT.platen, AT.platenPlinth, AT.platenColumn, AT.platenTank].map((p, i) => [`platen ${i}`, p.c[0], p.c[2], p.half[0], p.half[2]] as [string, number, number, number, number]),
      ['runner', AT.boardRunner.c[0], AT.boardRunner.c[2], AT.boardRunner.half[0], AT.boardRunner.half[2]],
      ...Object.entries(AT.stoolAt).map(([k, s]) => [`stool at ${k}`, s[0], s[1], stool[0], stool[2]] as [string, number, number, number, number]),
      ['console', AT.console.c[0], AT.console.c[2], AT.console.half[0], AT.console.half[2]],
    ];
    for (const [id, cx, cz, hx, hz] of boxes) {
      const dx = Math.max(0, Math.abs(b.x - cx) - hx), dz = Math.max(0, Math.abs(b.z - cz) - hz);
      expect(Math.hypot(dx, dz), id).toBeGreaterThan(turn);
    }
  });

  test('it sweeps a stray from the stray\'s far side, facing the visitor across it, then goes home and down', () => {
    const { world, physics } = quietStub();
    run(world, 5);
    // four strays out in the open; the oldest (crate-3) is the one it sweeps
    setDown(world, physics, 'crate-3', -6.6, -1.6);
    run(world, steps(5));
    setDown(world, physics, 'crate-2', -6.5, 1);
    setDown(world, physics, 'crate-1', -7.8, -1);
    setDown(world, physics, 'crate-4', 1.5, -3.2);
    const ev: SimEvent[] = [];
    let at: RevertView | null = null;
    for (let i = 0; i < steps(110) && !ev.some((e) => e.type === 'revert.sweep'); i++) {
      ev.push(...run(world, 1));
      if (R(world).state === 'sweep' && !at) at = R(world);
    }
    expect(at).not.toBeNull();
    expect(at!.sweeping).toBe('crate-3');
    const c = world.motion('crate-3')!; // still where it was: the sweep happened from its far side
    const p = ev.find((e) => e.type === 'revert.sweep');
    expect(p).toBeDefined();
    const from = p && p.type === 'revert.sweep' ? p.from.p : c.pose.p;
    expect(at!.z).toBeLessThan(from[2]); // behind it, seen from the visitor
    const toVisitor = Math.atan2(REVERT.outward[0] - from[0], REVERT.outward[2] - from[2]);
    expect(Math.abs(wrap(at!.heading - toVisitor))).toBeLessThan(0.71); // facing out toward the visitor (one of the first stands tried round the far side), the part between
    expect(Math.hypot(at!.x - from[0], at!.z - from[2])).toBeLessThan(HZ + 0.6);
    // then home, and down
    const after = [] as SimEvent[];
    for (let i = 0; i < steps(20) && R(world).state !== 'below'; i++) after.push(...run(world, 1));
    const seq = after.flatMap((e) => (e.type === 'crew.state' && e.id === 'revert' ? [e.state] : []));
    expect(seq).toEqual(expect.arrayContaining(['sinking', 'below'])); // (R3: the trip home, the crate in its pan, began in the sweep's own step)
    expect(after.some((e) => e.type === 'revert.sweep' && e.to.at === 'shipped')).toBe(true); // and down the hatch
  });

  test('where the bench leaves no room behind a part, it takes the nearest stand that keeps its front or side to the visitor', () => {
    const { world, physics } = quietStub();
    run(world, 5);
    // crate-3 against the back of the bench: no room behind it
    setDown(world, physics, 'crate-3', -6.2, -4.5);
    run(world, steps(5));
    setDown(world, physics, 'crate-2', -6.5, 1);
    setDown(world, physics, 'crate-1', -2, -3.5);
    setDown(world, physics, 'crate-4', 1.5, -3.2);
    let at: RevertView | null = null;
    for (let i = 0; i < steps(110) && !at; i++) {
      run(world, 1);
      if (R(world).state === 'sweep') at = R(world);
    }
    expect(at).not.toBeNull();
    const from = world.motion('crate-3')!.pose.p;
    const toVisitor = Math.atan2(REVERT.outward[0] - from[0], REVERT.outward[2] - from[2]);
    expect(Math.abs(wrap(at!.heading - toVisitor))).toBeLessThanOrEqual(Math.PI / 2 + 1e-6); // its front or its side to the visitor
    expect(Math.abs(wrap(at!.heading - toVisitor))).toBeGreaterThan(0.1); // not straight behind: there was no room
    expect(hits(at!.x, at!.z, at!.heading)).toBeNull();
  });
});

describe("Revert's trips are safe against the layout (S7 round 2)", () => {
  /** The parts its footprint overlaps (as its own `blocker` measures them): what it would be pushing. */
  function touching(w: World, r: RevertView): Id[] {
    const [ra, fa] = axes(r.heading);
    const out: Id[] = [];
    for (const p of w.parts()) {
      if (p.id === 'revert' || w.mode(p.id) === 'gone' || w.mode(p.id) === 'chute') continue;
      const m = w.motion(p.id)!.pose.p;
      const e = w.halfExtents(p.id)!;
      if (m[1] - e[1] > 2 * AT.revert.half[1]) continue;
      const d = [m[0] - r.x, m[2] - r.z] as const;
      const lx = Math.abs(d[0] * ra[0] + d[1] * ra[1]);
      const lz = Math.abs(d[0] * fa[0] + d[1] * fa[1]);
      const rr = Math.max(e[0], e[2]) * 0.8;
      if (lx < HX + rr - 1e-6 && lz < HZ + rr - 1e-6) out.push(p.id);
    }
    return out;
  }
  /** Rung 1 brings it up; then the visitor sets it down at (x, z). */
  function upAndSetDown(x: number, z: number): { world: World; physics: StubPhysics } {
    const { world, physics } = quietStub();
    run(world, 5);
    world.dispatch({ type: 'press', id: 'button' });
    for (let i = 0; i < 2000 && (i < 2 || world.bracketed); i++) run(world, 1);
    run(world, 10);
    setDown(world, physics, 'revert', x, z);
    return { world, physics };
  }

  test('set down anywhere on the open bench, it finds its way home without ever driving or turning into a fixed thing', () => {
    let tried = 0;
    let home = 0;
    for (const x of [-7.5, -5, -2.5, 0.4, 2.5, 5, 7.5])
      for (const z of [-3.6, -2, 0.6, 1.4, 3.2]) {
        if (hits(x, z, 0) !== null) continue; // not a place it can be set down
        const { world } = upAndSetDown(x, z);
        if (R(world).state !== 'idle' || Math.hypot(R(world).x - x, R(world).z - z) > 0.01) continue;
        tried++;
        let went = 0;
        for (let i = 0; i < steps(40) && R(world).state !== 'below'; i++) {
          run(world, 1);
          const r = R(world);
          if (!r.drawn || r.lift < 1) continue;
          expect(hits(r.x, r.z, r.heading), `set down at ${x}, ${z}: at ${r.x.toFixed(2)}, ${r.z.toFixed(2)} facing ${r.heading.toFixed(2)}`).toBeNull();
          if (r.state === 'trundle' && r.speed !== 0) went++;
        }
        if (R(world).state === 'below') home++;
        else expect(went, `set down at ${x}, ${z}: it stays put only when it has no clear way onto its track`).toBe(0);
      }
    expect(tried).toBeGreaterThanOrEqual(12);
    expect(home / tried).toBeGreaterThan(0.8);
  }, 120_000);

  test('something put in its way: it stops short, never pushes it, backs off to turn if it must, and gives the trip up (home shut: it parks)', () => {
    const { world, physics } = upAndSetDown(0.4, -2.6);
    // the visitor drops crates on its way home and on its hatch
    setDown(world, physics, 'crate-3', -2.5, -1.6);
    setDown(world, physics, 'crate-1', REVERT.home.x, REVERT.home.z);
    const still = new Map(['crate-3', 'crate-1'].map((id) => [id, world.motion(id)!.pose.p]));
    const seen = new Set<string>();
    for (let i = 0; i < steps(60); i++) {
      run(world, 1);
      const r = R(world);
      seen.add(r.state);
      expect(touching(world, r).filter((id) => id === 'crate-3' || id === 'crate-1'), `step ${i}`).toEqual([]);
      expect(hits(r.x, r.z, r.heading)).toBeNull();
    }
    for (const [id, p] of still) expect(world.motion(id)!.pose.p, id).toEqual(p);
    expect(seen.has('trundle')).toBe(true);
    expect(R(world).state).not.toBe('below');
  });
});
