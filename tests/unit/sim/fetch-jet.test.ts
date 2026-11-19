// S5: the jetpack's flight plan alone (sim/crew/fetch-jet.ts): it falls below the edge, rises clear of it, cruises
// over anything taller, lands on its tape; the published thrust; four seconds from a low edge.
import { describe, expect, test } from 'vitest';
import { JET_TUNING, jetAt, planJet } from '../../../src/workshop/sim/crew/fetch-jet.ts';

const bench = { minX: -9, maxX: 9, minZ: -5, maxZ: 5, top: 0 };
const wall = { o: { id: 'tall', x: 0, z: 3.5, hx: 1, hz: 0.3, yaw: 0 }, top: 2.5 };

describe('the jetpack\'s flight', () => {
  const plan = planJet({ p0: [1, 0.75, 5.1], v0: [0, 0, 1.5], land: [0, 2.0], half: 0.75, radius: 0.6, bench, bodies: [wall], g: 16 });

  test('out clear of the edge by its footprint, below the edge in the fall, over the tall body in the cruise, down on its tape', () => {
    expect(plan.out[1]).toBeGreaterThanOrEqual(bench.maxZ + 0.6);
    let lowest = Infinity;
    let overWall = Infinity;
    for (let t = 0; t <= plan.total; t += 1 / 60) {
      const a = jetAt(plan, t);
      if (a.phase === 'fall') lowest = Math.min(lowest, a.p[1]);
      // anywhere over the body's footprint, the bottom is above its top
      if (Math.abs(a.p[0] - wall.o.x) < wall.o.hx + 0.6 && Math.abs(a.p[2] - wall.o.z) < wall.o.hz + 0.6) overWall = Math.min(overWall, a.p[1] - 0.75 - wall.top);
      // below the bench top, never over the bench
      if (a.p[1] - 0.75 < bench.top - 1e-9) expect(a.p[2] - 0.6).toBeGreaterThanOrEqual(bench.maxZ - 1e-9);
    }
    expect(lowest).toBeCloseTo(bench.top - JET_TUNING.belowEdge, 6);
    expect(overWall).toBeGreaterThan(0);
    const end = jetAt(plan, plan.total + 1);
    expect(end.done).toBe(true);
    expect(end.p[0]).toBeCloseTo(0, 9);
    expect(end.p[1]).toBeCloseTo(0.75, 9);
    expect(end.p[2]).toBeCloseTo(2.0, 9);
  });

  test('the phases in order; the thrust 0 falling, 1 rising, 0 after the cut; four seconds from a low edge', () => {
    const seen: string[] = [];
    let cutAt = -1;
    for (let t = 0; t <= plan.total; t += 1 / 60) {
      const a = jetAt(plan, t);
      if (seen.at(-1) !== a.phase) seen.push(a.phase);
      if (a.phase === 'fall') expect(a.thrust).toBe(0);
      if (a.phase === 'rise') expect(a.thrust).toBe(1);
      if (a.cut) {
        expect(a.thrust).toBe(0);
        if (cutAt < 0) cutAt = t;
      }
    }
    expect(seen).toEqual(['fall', 'ignite', 'rise', 'cruise', 'hover', 'land']);
    expect(cutAt).toBeGreaterThan(0);
    expect(plan.total).toBeLessThanOrEqual(4);
  });

  test('continuous: no step jumps further than its fastest leg allows', () => {
    let last = jetAt(plan, 0).p;
    for (let t = 1 / 60; t <= plan.total; t += 1 / 60) {
      const p = jetAt(plan, t).p;
      expect(Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2])).toBeLessThan(0.4);
      last = p;
    }
  });
});
