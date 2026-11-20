// S5: the jetpack's flight plan alone (sim/crew/fetch-jet.ts). Since 2026-11-20 it is taken from physics falling past
// the edge, out of sight, and goes on from there with the motion it had (Taylor: "momentum and animation transitions to
// flow naturally"): it falls on under gravity, the jets brake it to a stop clear of the edge, it rises, cruises over
// anything taller, lands on its tape; the published thrust; no step jumps its velocity by more than the plan's pushes.
import { describe, expect, test } from 'vitest';
import { JET_TUNING, jetAt, planHop, planJet } from '../../../src/workshop/sim/crew/fetch-jet.ts';
import type { JetPlan } from '../../../src/workshop/sim/crew/fetch-jet.ts';
import type { Vec3 } from '../../../src/workshop/sim/types.ts';

const bench = { minX: -9, maxX: 9, minZ: -5, maxZ: 5, top: 0 };
const wall = { o: { id: 'tall', x: 0, z: 3.5, hx: 1, hz: 0.3, yaw: 0 }, top: 2.5 };
const G = 16;
const DT = 1 / 60;
/** Taken where physics hands it over: just past the front edge, its centre `takeBelow` under the top, falling and drifting out. */
const TAKEN: Vec3 = [1, -JET_TUNING.takeBelow, 5.45];
const plan = planJet({ p0: TAKEN, v0: [0.5, -6, 1.5], land: [0, 2.0], half: 0.75, radius: 0.6, bench, bodies: [wall], g: G });

const v = (p: JetPlan, t: number): Vec3 => {
  const a = jetAt(p, t).p;
  const b = jetAt(p, t + DT).p;
  return [(b[0] - a[0]) / DT, (b[1] - a[1]) / DT, (b[2] - a[2]) / DT];
};

describe('the jetpack\'s flight', () => {
  test('on from where it was taken, out clear of the edge by its footprint before it rises, over the tall body in the cruise, down on its tape', () => {
    expect(jetAt(plan, 0).p).toEqual(TAKEN);
    expect(plan.out[1]).toBeGreaterThanOrEqual(bench.maxZ + 0.6 + JET_TUNING.clear - 1e-9);
    let lowest = Infinity;
    let overWall = Infinity;
    let lastOut = -Infinity;
    for (let t = 0; t <= plan.total; t += DT) {
      const a = jetAt(plan, t);
      if (a.phase === 'fall' || a.phase === 'ignite') lowest = Math.min(lowest, a.p[1]);
      // anywhere over the body's footprint, the bottom is above its top
      if (Math.abs(a.p[0] - wall.o.x) < wall.o.hx + 0.6 && Math.abs(a.p[2] - wall.o.z) < wall.o.hz + 0.6) overWall = Math.min(overWall, a.p[1] - 0.75 - wall.top);
      // below the bench top it never comes back toward the bench; it rises only from clear of it
      if (a.p[1] - 0.75 < bench.top - 1e-9) {
        expect(a.p[2]).toBeGreaterThanOrEqual(lastOut - 1e-9);
        lastOut = a.p[2];
        if (a.phase === 'rise') expect(a.p[2] - 0.6).toBeGreaterThanOrEqual(bench.maxZ - 1e-9);
      }
    }
    expect(lowest).toBeCloseTo(plan.deep, 2); // (sampled a step at a time)
    expect(plan.deep).toBeLessThan(bench.top - JET_TUNING.catchBelow);
    expect(overWall).toBeGreaterThan(0);
    const end = jetAt(plan, plan.total + 1);
    expect(end.done).toBe(true);
    expect(end.p[0]).toBeCloseTo(0, 9);
    expect(end.p[1]).toBeCloseTo(0.75, 9);
    expect(end.p[2]).toBeCloseTo(2.0, 9);
  });

  test('the phases in order; the thrust 0 falling, rising through the catch, 1 rising, 0 after the cut', () => {
    const seen: string[] = [];
    let cutAt = -1;
    for (let t = 0; t <= plan.total; t += DT) {
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
    expect(plan.total).toBeLessThanOrEqual(4.2);
  });

  test('its first step moves on with the velocity it was taken with, under gravity alone until the jets catch', () => {
    // (the first step's finite difference is v0 less half a step of gravity: the same as Rapier's own step, give or take g·dt/2)
    const v0 = v(plan, 0);
    expect(Math.hypot(v0[0] - 0.5, v0[1] - (-6 - (G * DT) / 2), v0[2] - 1.5)).toBeLessThan(0.05); // (the shift out clear of the edge starts flat)
    for (let t = 0; t + 2 * DT < plan.fall.tA; t += DT) {
      const a = v(plan, t);
      const b = v(plan, t + DT);
      expect((b[1] - a[1]) / DT).toBeCloseTo(-G, 0);
    }
  });

  /**
   * The bound: no step's velocity changes by more than the plan's hardest push (the jets' braking `catchAccel` with the
   * eased shift out, and the rise's and the descent's eases, the exaggerated jetpack moves) of 70 units/s², 1.17 a
   * step, save the touchdown after the cut (a real contact: the drop of `cutAbove` stops and the bounce starts up).
   */
  test.each([
    ['taken falling fast past the front', planJet({ p0: TAKEN, v0: [0.5, -12, 9], land: [0, 2.0], half: 0.75, radius: 0.6, bench, bodies: [wall], g: G })],
    ['taken falling straight down by the left end', planJet({ p0: [-9.4, -0.8, -2], v0: [0, -7, 0], land: [-6, -1], half: 0.75, radius: 0.6, bench, bodies: [], g: G })],
    ['taken still past the right end (resting out there)', planJet({ p0: [9.5, 0.4, 0], v0: [0, 0, 0], land: [6, 0], half: 0.75, radius: 0.6, bench, bodies: [], g: G })],
    ['a hop off a crate', planHop({ p0: [2, 1.4, 1], v0: [0, 0, 0], land: [2, 2.5], half: 0.75, radius: 0.6, bench, bodies: [wall], g: G })],
  ])('continuous: %s', (_name, p) => {
    const touchdown = Math.sqrt(2 * G * JET_TUNING.cutAbove) + (Math.PI * JET_TUNING.bounceHeight) / JET_TUNING.bounce + 0.3;
    let prev = v(p, 0);
    for (let t = DT; t <= p.total; t += DT) {
      const now = v(p, t);
      const dv = Math.hypot(now[0] - prev[0], now[1] - prev[1], now[2] - prev[2]);
      const a = jetAt(p, t);
      expect(dv, `${a.phase} at ${t.toFixed(3)}`).toBeLessThanOrEqual(a.cut ? touchdown : 70 * DT);
      prev = now;
    }
  });
});
