// The carry surface's level among the REAL bench's bodies (input/carry.ts `levelFor`).
//
// carry.test.ts holds the rule with one obstacle at a time. That was not enough: with every machine's top a level,
// the rule took whichever level "made sense" nearest to where the part was, on either side of what was in its way.
// Going up the screen in front of the UNDO lever's housing a crate climbed the face a unit, then went for the bench
// BEHIND the housing, through it, and stayed pinned to the face; pushed at the housing from behind it went for the
// bench in front, likewise. Nothing could be put on a tall machine by hand (found by the builder who moved the
// browser suite onto the body Patch, 2026-11-20: a test had to `place` its crate there).
//
// What a visitor should get: a part pushed into a machine from in front goes up its face under the pointer and onto
// its top; pushed into it from behind it comes over its top; carried along behind it, it stays on the bench.
import { describe, expect, it } from 'vitest';
import { CarryPlane, type Obstacle, type RayLike } from '../../../src/workshop/input/carry.ts';
import { solidsOf } from '../../../src/workshop/sim/crew/patch-route.ts';
import { bench as scene } from '../../../src/workshop/sim/scenes/bench.ts';
import type { Vec3 } from '../../../src/workshop/sim/types.ts';

const b = scene.bench;
const bench = { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ, top: b.top, ceiling: 8 };
const SOLIDS = solidsOf(scene);
/** Every fixed body as the carry surface is given it (none of the ones used below is turned). */
const obstacles: Obstacle[] = SOLIDS.map((o) => ({ minX: o.x - o.hx, maxX: o.x + o.hx, minZ: o.z - o.hz, maxZ: o.z + o.hz, top: o.y1, bottom: o.y0 }));
const body = (id: string): Obstacle => {
  const o = SOLIDS.find((s) => s.id === id)!;
  return { minX: o.x - o.hx, maxX: o.x + o.hx, minZ: o.z - o.hz, maxZ: o.z + o.hz, top: o.y1, bottom: o.y0 };
};
/** A pointer ray from up and in front, aimed at the bench point (x, 0, z), at about 33 degrees (the bench's camera, near enough). */
function rayAt(x: number, z: number): RayLike {
  const n = Math.hypot(13, 20);
  return { origin: [x, 13, z + 20], dir: [0, -13 / n, -20 / n] };
}
const HALF = 0.3;
const shape = { kind: 'part' as const, halfX: HALF, halfZ: HALF, gripAboveBottom: 0.3 };
const LIFT = 0.35 + 0.3; // clearance + the grip above the part's bottom
const levelOf = (plane: CarryPlane): number => (plane as unknown as { level: number }).level;
/**
 * Is the part, held at `p`, well inside `o` (its footprint into the body's by more than `EASE`, its bottom below the
 * body's top)? Its height is eased toward its level, so going up a face the hold runs a little into the face before
 * its height has caught up (the part itself is a body and is stopped by the face meanwhile): at the pointer speed
 * of these sweeps, about a tenth of a unit. Through the body is a unit or more.
 */
const EASE = 0.2;
const inside = (p: Vec3, o: Obstacle): boolean => p[0] + HALF > o.minX + EASE && p[0] - HALF < o.maxX - EASE && p[2] + HALF > o.minZ + EASE && p[2] - HALF < o.maxZ - EASE && p[1] - 0.3 < o.top - 0.02;

describe('carrying among the bench\'s own bodies', () => {
  for (const id of ['undo', 'console', 'platen-plinth']) {
    it(`pushed into the ${id} from in front, it goes up the face and onto the top: never through, never down on the way`, () => {
      const o = body(id);
      const x = (o.minX + o.maxX) / 2;
      const plane = new CarryPlane(bench);
      // (it starts on the open bench 0.9 in front of the face: `rayAt` aims at the bench, and the hold at the
      // carrying height is one unit nearer the visitor than that)
      plane.begin(shape, [x, 0.3, o.maxZ + 0.9], 0, obstacles);
      let t = 0;
      let prev = plane.target(rayAt(x, o.maxZ - 0.1), (t += 16), obstacles);
      expect(levelOf(plane), 'it starts on the bench').toBeCloseTo(0, 6);
      let highest = levelOf(plane);
      let over = false;
      for (let z = o.maxZ - 0.1; z >= o.minZ - 6 && !over; z -= 0.03) {
        const p = plane.target(rayAt(x, z), (t += 16), obstacles);
        // never held inside it (the hold at a level under its top, its footprint into the body's)
        expect(inside(p, o), `pointer at ${z.toFixed(2)}: held at ${p.map((n) => n.toFixed(2))}`).toBe(false);
        // its level only ever rises on the way in, and its height is eased (no jump from one frame to the next)
        expect(levelOf(plane), `pointer at ${z.toFixed(2)}`).toBeGreaterThanOrEqual(highest - 1e-9);
        expect(Math.abs(p[1] - prev[1])).toBeLessThan(0.3);
        highest = levelOf(plane);
        prev = p;
        over = Math.abs(levelOf(plane) - o.top) < 1e-6 && p[2] - HALF < o.maxZ && p[2] + HALF > o.minZ;
      }
      expect(over, `it came over the ${id} (its level ${levelOf(plane).toFixed(2)}, the top ${o.top})`).toBe(true);
      // held still there, it is over the top, clear of it
      let p = prev;
      const zAt = rayAtBench(prev, o);
      for (let i = 0; i < 40; i++) p = plane.target(rayAt(x, zAt), (t += 16), obstacles);
      expect(p[1]).toBeCloseTo(o.top + LIFT, 2);
    });
  }

  it('pushed into the UNDO housing from behind, it comes over the top (held at the housing\'s height until the pointer is past it) and down in front', () => {
    const o = body('undo');
    const x = (o.minX + o.maxX) / 2;
    const plane = new CarryPlane(bench);
    plane.begin(shape, [x, 0.3, o.minZ - 2], 0, obstacles);
    let t = 0;
    const seen: number[] = [];
    let last: Vec3 = [0, 0, 0];
    for (let z = o.minZ - 3; z <= o.maxZ + 0.6; z += 0.03) {
      last = plane.target(rayAt(x, z), (t += 16), obstacles);
      const l = levelOf(plane);
      if (seen.at(-1) !== l) seen.push(l);
    }
    for (let i = 0; i < 60; i++) last = plane.target(rayAt(x, o.maxZ + 0.6), (t += 16), obstacles);
    // on the bench behind it, then at its top's level, then down the levels in front to the bench: and never a level
    // between the bench and its top while it was still behind it (a target in front of the housing lower than its
    // top is one the part cannot get to: it was pinned to the back face)
    expect(seen[0]).toBeCloseTo(0, 6);
    expect(seen[1]).toBeCloseTo(o.top, 6);
    expect(seen.at(-1)).toBeCloseTo(0, 6);
    expect(last[1]).toBeCloseTo(LIFT, 2);
    expect(last[2] - HALF).toBeGreaterThan(o.maxZ);
  });

  it('carried along the bench behind the UNDO housing, it stays on the bench behind it', () => {
    const o = body('undo');
    const plane = new CarryPlane(bench);
    const zHold = o.minZ - 1.2;
    plane.begin(shape, [o.minX - 2, 0.3, zHold], 0, obstacles);
    let t = 0;
    // (aimed so that the hold runs along z = zHold at the carrying height: one unit further in on the bench)
    for (let x = o.minX - 2; x <= o.maxX + 2; x += 0.05) {
      const p = plane.target(rayAt(x, zHold - LIFT * (20 / 13)), (t += 16), obstacles);
      expect(levelOf(plane), `at x ${x.toFixed(2)}`).toBeCloseTo(0, 6);
      expect(p[2]).toBeCloseTo(zHold, 2);
    }
  });
});

/** The bench point a ray through `p` is aimed at (the inverse of `rayAt` for a hold at `p`). */
function rayAtBench(p: Vec3, _o: Obstacle): number {
  return p[2] - p[1] * (20 / 13);
}
