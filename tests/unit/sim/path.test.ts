// S5 round 2: Fetch's lane as a path of runs (sim/path.ts): its length, its corners, continuity, the nearest point, the tape round it.
import { describe, expect, test } from 'vitest';
import { lanePath, laneOutline } from '../../../src/workshop/sim/path.ts';
import type { Pt } from '../../../src/workshop/sim/path.ts';

const L: Pt[] = [[0, 0], [4, 0], [4, 3]];
const U: Pt[] = [[0, 0], [4, 0], [4, 2], [0, 2]];
const r = 0.45;
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

describe('a lane of runs', () => {
  test('two points: a straight run, its length the distance, no corner', () => {
    const p = lanePath([[-1, 2], [3, 2]], r);
    expect(p.length).toBeCloseTo(4, 12);
    expect(p.corners).toEqual([]);
    expect(p.at(1)).toEqual([0, 2]);
    expect(p.yaw(1)).toBeCloseTo(Math.PI / 2, 12); // +X
    expect(p.nearest(0.5, 9)).toBeCloseTo(1.5, 12);
  });

  test('an L: the corner is an arc of the radius, so the path is shorter than the runs by 2r - r·π/2', () => {
    const p = lanePath(L, r);
    expect(p.corners).toHaveLength(1);
    expect(p.corners[0]!.r).toBeCloseTo(r, 12);
    expect(p.length).toBeCloseTo(7 - 2 * r + (r * Math.PI) / 2, 9);
    expect(p.at(0)).toEqual([0, 0]);
    const end = p.at(p.length);
    expect(end[0]).toBeCloseTo(4, 9);
    expect(end[1]).toBeCloseTo(3, 9);
    // the arc's ends are on the runs, r back from the taped corner
    const [c] = p.corners;
    const a = p.at(c!.s0);
    const b = p.at(c!.s1);
    expect(a[0]).toBeCloseTo(4 - r, 9);
    expect(a[1]).toBeCloseTo(0, 9);
    expect(b[0]).toBeCloseTo(4, 9);
    expect(b[1]).toBeCloseTo(r, 9);
  });

  test('a U of four points: two corners; position and heading continuous end to end', () => {
    for (const pts of [L, U]) {
      const p = lanePath(pts, r);
      const n = 2000;
      let last = p.at(0);
      let lastYaw = p.yaw(0);
      for (let i = 1; i <= n; i++) {
        const s = (p.length * i) / n;
        const q = p.at(s);
        // a step along the path moves the point by no more than the step
        expect(Math.hypot(q[0] - last[0], q[1] - last[1])).toBeLessThanOrEqual(p.length / n + 1e-9);
        // and the heading turns by no more than the step over the radius
        expect(Math.abs(wrap(p.yaw(s) - lastYaw))).toBeLessThanOrEqual(p.length / n / r + 1e-6);
        last = q;
        lastYaw = p.yaw(s);
      }
    }
    expect(lanePath(U, r).corners).toHaveLength(2);
    expect(lanePath(U, r).yaw(lanePath(U, r).length)).toBeCloseTo(-Math.PI / 2, 9); // back along -X
  });

  test('the nearest point: on a run, on a corner, beside the far run of a U', () => {
    const p = lanePath(U, r);
    // beside the first run
    expect(p.at(p.nearest(1.5, -1))).toEqual([1.5, 0]);
    // beside the far run (z 2), not the near one
    const far = p.at(p.nearest(1.5, 2.6));
    expect(far[0]).toBeCloseTo(1.5, 9);
    expect(far[1]).toBeCloseTo(2, 9);
    // outside the corner: on the arc, the radius from its centre
    const s = p.nearest(5, -1);
    const [c] = p.corners;
    expect(s).toBeGreaterThanOrEqual(c!.s0 - 1e-9);
    expect(s).toBeLessThanOrEqual(c!.s1 + 1e-9);
    const q = p.at(s);
    expect(Math.hypot(q[0] - (4 - r), q[1] - r)).toBeCloseTo(r, 9);
  });

  test('a run too short for two corners: they are tightened, never overlap', () => {
    const p = lanePath([[0, 0], [4, 0], [4, 0.5], [0, 0.5]], r);
    expect(p.corners).toHaveLength(2);
    expect(p.corners[0]!.s1).toBeLessThanOrEqual(p.corners[1]!.s0 + 1e-9);
    expect(p.corners[0]!.r).toBeCloseTo(0.25, 9);
  });

  test('the tape: a closed outline the half width either side, past each end, mitred at the corners', () => {
    const o = laneOutline([[0, 0], [4, 0]], 0.5, 0.3);
    expect(o).toEqual([[-0.3, -0.5], [4.3, -0.5], [4.3, 0.5], [-0.3, 0.5], [-0.3, -0.5]]);
    const l = laneOutline(L, 0.5, 0.3);
    expect(l[0]).toEqual(l[l.length - 1]);
    // the outer corner of the L's tape: the mitre, half the width out along both runs
    expect(l.some(([x, z]) => Math.abs(x - 4.5) < 1e-9 && Math.abs(z + 0.5) < 1e-9)).toBe(true);
    expect(l.some(([x, z]) => Math.abs(x - 3.5) < 1e-9 && Math.abs(z - 0.5) < 1e-9)).toBe(true);
  });
});
