// The vignette's layout: nothing starts inside a collider, and Fetch's lane is clear.
import { describe, expect, test } from 'vitest';
import { vignette, AT, BARE } from '../../../src/workshop/sim/scenes/vignette.ts';
import { defaultHalfExtents } from '../../../src/workshop/sim/parts.ts';
import { FETCH_TUNING } from '../../../src/workshop/sim/crew/fetch.ts';
import { qyaw, rotate } from '../../../src/workshop/sim/math.ts';
import { stubWorld } from './helpers.ts';
import type { Quat, Vec3 } from '../../../src/workshop/sim/types.ts';

interface AABB {
  min: Vec3;
  max: Vec3;
}
const aabb = (c: Vec3, half: Vec3, q: Quat = [0, 0, 0, 1]): AABB => {
  const ext = [0, 1, 2].map((k) => {
    let e = 0;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) e = Math.max(e, Math.abs(rotate(q, [sx * half[0], sy * half[1], sz * half[2]])[k]!));
    return e;
  }) as [number, number, number];
  return { min: [c[0] - ext[0], c[1] - ext[1], c[2] - ext[2]], max: [c[0] + ext[0], c[1] + ext[1], c[2] + ext[2]] };
};
/** Overlap depth on the least-overlapping axis (negative: a gap of that size). Touching faces are 0. */
const overlap = (a: AABB, b: AABB): number => Math.min(...[0, 1, 2].map((k) => Math.min(a.max[k]! - b.min[k]!, b.max[k]! - a.min[k]!)));

const statics = vignette.statics.map((s) => {
  if (s.shape.type !== 'box') throw new Error('box statics only');
  return { id: s.id, box: aabb(s.pose.p, s.shape.half, s.pose.q) };
});
const FETCH_HALF: Vec3 = defaultHalfExtents('robot', 'M');
const S_HALF: Vec3 = defaultHalfExtents('crate', 'S');

describe('the vignette layout', () => {
  test('no dynamic body starts inside a static collider (touching the bench top is fine)', () => {
    for (const p of vignette.parts) {
      const box = aabb(p.pose.p, p.half ?? defaultHalfExtents(p.kind, p.size), p.pose.q);
      for (const s of statics) expect(overlap(box, s.box), `${p.id} overlaps ${s.id}`).toBeLessThanOrEqual(1e-6);
    }
  });

  test('no two parts start inside each other', () => {
    const boxes = vignette.parts.map((p) => ({ id: p.id, box: aabb(p.pose.p, p.half ?? defaultHalfExtents(p.kind, p.size), p.pose.q) }));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i]!.box, boxes[j]!.box), `${boxes[i]!.id} / ${boxes[j]!.id}`).toBeLessThanOrEqual(1e-6);
  });

  test("Fetch and the crate in its hands clear every static along the whole lane, overshoot included, in every heading it uses", () => {
    const [ax, az] = AT.lane.points[0]!;
    const [bx, bz] = AT.lane.points[AT.lane.points.length - 1]!;
    const len = Math.hypot(bx - ax, bz - az);
    const reach = FETCH_TUNING.bodyHalfDepth + FETCH_TUNING.handGap + S_HALF[2];
    let closest = Infinity;
    let closestTo = '';
    for (let i = 0; i <= 200; i++) {
      const t = i / 200;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      for (const heading of [Math.PI / 2, -Math.PI / 2, 0]) {
        const q = qyaw(heading);
        const fwd = rotate(q, [0, 0, 1]);
        const body = aabb([x, FETCH_HALF[1], z], FETCH_HALF, q);
        const crate = aabb([x + fwd[0] * reach, FETCH_TUNING.handHeight, z + fwd[2] * reach], S_HALF, q);
        for (const s of statics) {
          if (s.id === 'bench') continue;
          for (const b of [body, crate]) {
            const d = overlap(b, s.box);
            expect(d, `at lane x ${x.toFixed(2)} heading ${heading.toFixed(2)}: overlaps ${s.id}`).toBeLessThan(0);
            if (-d < closest) [closest, closestTo] = [-d, s.id];
          }
        }
      }
    }
    expect(len).toBeGreaterThan(5);
    // the nearest any of it comes to a static (reported in the hand-in)
    expect(closest).toBeGreaterThan(0.3);
    expect(closestTo).not.toBe('');
  });

  test("the lane's tape (±0.52 round the lane) stays off every static's footprint", () => {
    const tape: AABB = { min: [Math.min(AT.lane.points[0]![0], AT.lane.points[AT.lane.points.length - 1]![0]) - 0.52, 0, AT.lane.points[0]![1] - 0.52], max: [Math.max(AT.lane.points[0]![0], AT.lane.points[AT.lane.points.length - 1]![0]) + 0.52, 0.001, AT.lane.points[AT.lane.points.length - 1]![1] + 0.52] };
    for (const s of statics) {
      if (s.id === 'bench') continue;
      const foot: AABB = { min: [s.box.min[0], 0, s.box.min[2]], max: [s.box.max[0], 0.001, s.box.max[2]] };
      expect(overlap(tape, foot), `tape under ${s.id}`).toBeLessThan(0);
    }
  });

  test('fresh crates are bare wood, not a paint; the world exposes the scene', () => {
    const { world } = stubWorld();
    for (const p of world.parts()) if (p.kind === 'crate') expect(p.colour).toBe(BARE);
    expect(world.scene).toBe(vignette);
    expect(world.scene.statics.map((s) => s.id)).toEqual(['bench', 'back-wall', 'console', 'board', 'stool', 'phone', 'belt-bed', 'belt-motor']);
  });
});
