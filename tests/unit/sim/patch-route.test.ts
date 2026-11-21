// R2: Patch's way back (sim/crew/patch-route.ts), alone: where it may stand, round the bodies, over the belt.
import { describe, expect, test } from 'vitest';
import { obstacles, distanceTo } from '../../../src/workshop/sim/crew/fetch-knock.ts';
import { bodiesOf, legClear } from '../../../src/workshop/sim/crew/fetch-route.ts';
import type { Pt } from '../../../src/workshop/sim/crew/fetch-route.ts';
import { PATCH_ROUTE, clearPoint, planWay, wayExists } from '../../../src/workshop/sim/crew/patch-route.ts';
import type { BeltCrossing } from '../../../src/workshop/sim/crew/patch-route.ts';
import { AT, LINE, bench, PATCHLAMP } from '../../../src/workshop/sim/scenes/bench.ts';

const R = PATCH_ROUTE.radius;
const BODIES = bodiesOf(obstacles(bench));
const B = { minX: bench.bench.minX, maxX: bench.bench.maxX, minZ: bench.bench.minZ, maxZ: bench.bench.maxZ };
const bed = BODIES.find((o) => o.id === 'belt-bed')!;
const safe = [AT.beltMotor.c[0] + AT.beltMotor.half[0] + 0.9, LINE.strikerX - 0.75] as const; // as the scene gives Patch
const BELT: BeltCrossing = { bed, top: 0.5, safe };
const FOOT: Pt = [PATCHLAMP.patch.foot[0], PATCHLAMP.patch.foot[2]];
const clear = (p: Pt): boolean => BODIES.every((o) => distanceTo(o, p[0], p[1]) >= R - 1e-9);

describe("Patch's way back", () => {
  test('the stool\'s foot is a place it can stand', () => {
    expect(clear(FOOT)).toBe(true);
  });

  test('a set-down point inside a body (the belt, the console) moves to the nearest clear point; a clear one stays', () => {
    for (const p of [[-1, 4.0], [-1, 4.6], [-0.6, 0.5], [4.4, 0.4]] as Pt[]) {
      const c = clearPoint(p, R, BODIES, B)!;
      expect(clear(c)).toBe(true);
      expect(Math.hypot(c[0] - p[0], c[1] - p[1])).toBeLessThan(1.6);
    }
    expect(clearPoint([-4, 1.5], R, BODIES, B)).toEqual([-4, 1.5]);
  });

  test('in front of the belt: the way back crosses it (cheaper than round the dock), inside the safe stretch whatever the drift', () => {
    for (const drift of [0, 1.8, -1.8]) {
      const w = planWay([-1, 4.76], FOOT, R, BODIES, B, BELT, drift)!;
      expect(w.cross).not.toBeNull();
      expect(w.cross!.x).toBeGreaterThanOrEqual(safe[0]);
      expect(w.cross!.x).toBeLessThanOrEqual(safe[1]);
      expect(w.cross!.x + drift).toBeGreaterThanOrEqual(safe[0] - 1e-9);
      expect(w.cross!.x + drift).toBeLessThanOrEqual(safe[1] + 1e-9);
    }
  });

  test('without the crossing, there is still the long way round the dock (never through a body)', () => {
    const w = planWay([-1, 4.76], FOOT, R, BODIES, B, null, 0)!;
    expect(w.cross).toBeNull();
    let a: Pt = [-1, 4.76];
    for (const p of w.points) {
      expect(legClear(a, p, R, BODIES)).toBe(true);
      a = p;
    }
    expect(w.length).toBeGreaterThan(12);
  });

  test('behind the belt the way is on the ground, round the console', () => {
    const w = planWay([-2.1, 0.5], FOOT, R, BODIES, B, BELT, 0)!;
    expect(w.cross).toBeNull();
    expect(w.points.length).toBeGreaterThan(1);
  });
  // `wayExists` is `planWay` asked only whether (it stops at the first way that is open). Where Patch gets up is
  // chosen with it, so the two must never disagree: a place taken for walkable that the planner then finds shut
  // would leave Patch standing where it cannot leave.
  test('`wayExists` says exactly what `planWay` says, from every clear place on the bench, with the belt and without, with a crate in the way and with the belt drifting', () => {
    const crate = { id: 'crate-x', x: FOOT[0] + 0.9, z: FOOT[1] + 0.4, hx: 0.3, hz: 0.3, yaw: 0.4 };
    // a pen of four boards round an open spot: inside it a place is clear to stand on and shut in
    let spot: Pt | null = null;
    for (let x = B.minX + 1.5; x <= B.maxX - 1.5 && !spot; x += 0.5)
      for (let z = B.minZ + 1.5; z <= B.maxZ - 1.5 && !spot; z += 0.5) if (BODIES.every((o) => distanceTo(o, x, z) >= 1.3) && Math.hypot(x - FOOT[0], z - FOOT[1]) > 2) spot = [x, z];
    expect(spot, 'an open spot for the pen').toBeTruthy();
    const [px, pz] = spot!;
    const pen = [
      { id: 'pen-n', x: px, z: pz - 0.6, hx: 0.75, hz: 0.08, yaw: 0 },
      { id: 'pen-s', x: px, z: pz + 0.6, hx: 0.75, hz: 0.08, yaw: 0 },
      { id: 'pen-w', x: px - 0.6, z: pz, hx: 0.08, hz: 0.75, yaw: 0 },
      { id: 'pen-e', x: px + 0.6, z: pz, hx: 0.08, hz: 0.75, yaw: 0 },
    ];
    let asked = 0, open = 0;
    for (const [bodies, belt, drift] of [[BODIES, BELT, 0], [BODIES, null, 0], [[...BODIES, crate], BELT, 0], [BODIES, BELT, 0.8], [BODIES, BELT, -0.8], [[...BODIES, ...pen], BELT, 0]] as const) {
      const froms: Pt[] = [[px, pz], [px + 0.15, pz - 0.1]];
      for (let x = B.minX + 0.3; x <= B.maxX - 0.3; x += 0.55) for (let z = B.minZ + 0.3; z <= B.maxZ - 0.3; z += 0.55) froms.push([x, z]);
      for (const from of froms) {
        if (!bodies.every((o) => distanceTo(o, from[0], from[1]) >= R - 1e-9)) continue;
        const way = planWay(from, FOOT, R, bodies, B, belt, drift) !== null;
        expect(wayExists(from, FOOT, R, bodies, B, belt, drift), `from ${from[0].toFixed(2)}, ${from[1].toFixed(2)}${belt ? '' : ' (no belt)'}${drift ? ` drift ${drift}` : ''}${bodies.length > BODIES.length + 1 ? ' (pen)' : ''}`).toBe(way);
        asked++;
        if (way) open++;
      }
    }
    // (and the question is a real one: inside the pen it is shut)
    expect(planWay([px, pz], FOOT, R, [...BODIES, ...pen], B, BELT, 0), 'inside the pen there is no way').toBeNull();
    expect(wayExists([px, pz], FOOT, R, [...BODIES, ...pen], B, BELT, 0)).toBe(false);
    expect(asked).toBeGreaterThan(1500);
    expect(open).toBeGreaterThan(asked * 0.5);
    expect(open).toBeLessThan(asked);
  }, 120_000);
});
