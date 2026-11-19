// R2: Patch's way back (sim/crew/patch-route.ts), alone: where it may stand, round the bodies, over the belt.
import { describe, expect, test } from 'vitest';
import { obstacles, distanceTo } from '../../../src/workshop/sim/crew/fetch-knock.ts';
import { bodiesOf, legClear } from '../../../src/workshop/sim/crew/fetch-route.ts';
import type { Pt } from '../../../src/workshop/sim/crew/fetch-route.ts';
import { PATCH_ROUTE, clearPoint, planWay } from '../../../src/workshop/sim/crew/patch-route.ts';
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
});
