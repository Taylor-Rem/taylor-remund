// The line keeps order and spacing (lead's follow-up to S2): parts that ride do not collide. At the top
// speed, a run set down touching keeps its gaps on the belt, a part enters the ramp only once the one
// ahead has cleared its length, the dock's rollers keep up with the belt, and they ship in the order they
// rode. And each machine takes a part in once per ride.
import { describe, expect, test } from 'vitest';
import { benchWorld, LINE, onBelt, putOn, tape, waitFor } from './line-helpers.ts';
import { rideWatch } from './rides.ts';
import { BELT_TUNING } from '../../src/workshop/sim/machines/belt.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';
import { yawOf } from '../../src/workshop/sim/math.ts';
import type { World } from '../../src/workshop/sim/world.ts';

/** Pairs of parts in a machine's hands whose footprints (their boxes turned by yaw) overlap by more than `slack` (2-D separating axes). */
function overlaps(w: World, slack = 0.02): string[] {
  const held = [...w.parts()].filter((p) => w.mode(p.id) === 'machine').map((p) => {
    const m = w.motion(p.id)!;
    const h = w.halfExtents(p.id)!;
    const y = yawOf(m.pose.q);
    // its own x and z axes on the bench plane (a turn about +Y)
    return { id: p.id, c: [m.pose.p[0], m.pose.p[2]] as const, u: [Math.cos(y), -Math.sin(y)] as const, v: [Math.sin(y), Math.cos(y)] as const, hx: h[0], hz: h[2] };
  });
  type B = (typeof held)[number];
  const extent = (b: B, ax: readonly [number, number]): number => b.hx * Math.abs(b.u[0] * ax[0] + b.u[1] * ax[1]) + b.hz * Math.abs(b.v[0] * ax[0] + b.v[1] * ax[1]);
  const depth = (a: B, b: B): number => {
    let d = Infinity;
    for (const ax of [a.u, a.v, b.u, b.v]) {
      const dist = Math.abs((b.c[0] - a.c[0]) * ax[0] + (b.c[1] - a.c[1]) * ax[1]);
      d = Math.min(d, extent(a, ax) + extent(b, ax) - dist);
    }
    return d;
  };
  const out: string[] = [];
  for (let i = 0; i < held.length; i++) for (let j = i + 1; j < held.length; j++) if (depth(held[i]!, held[j]!) > slack) out.push(`${held[i]!.id}/${held[j]!.id}`);
  return out;
}

describe('order and spacing', () => {
  test('at the top speed a run set down touching never overlaps, enters the ramp one at a time, and ships in the order it rode', async () => {
    const w = await benchWorld();
    const t = tape(w);
    t.run(30);
    w.dispatch({ type: 'turn', id: 'belt-lever', value: 0.5 });
    w.dispatch({ type: 'turn', id: 'belt-dial', value: 1 });
    t.run(1);
    // set down from the far end backward, as close as a hand can: S, then M, then L behind it
    const xS = LINE.belt.to - 1.4;
    const at = (x: number): number => (x - LINE.belt.from) / (LINE.belt.to - LINE.belt.from);
    putOn(w, t, 'crate-3', onBelt(at(xS)));
    const ok3 = waitFor(w, t, 'crate-3', 'in');
    expect(ok3).toBe(true);
    putOn(w, t, 'crate-2', onBelt(at(xS - 0.55)));
    expect(waitFor(w, t, 'crate-2', 'in')).toBe(true);
    putOn(w, t, 'crate-1', onBelt(at(xS - 0.55 - 0.72)));
    expect(waitFor(w, t, 'crate-1', 'in')).toBe(true);
    w.dispatch({ type: 'turn', id: 'belt-lever', value: 1 });
    t.run(1);
    const watch = rideWatch();
    const bad: string[] = [];
    for (let i = 0; i < 10 * HZ; i++) {
      watch(t.run(1), w.step);
      const o = overlaps(w);
      bad.push(...o.map((x) => `${w.step}:${x}`));
    }
    expect(bad).toEqual([]);
    const shipped = t.of('shipped').map((x) => x.e.part);
    expect(shipped).toEqual(['crate-3', 'crate-2', 'crate-1']);
    // one at a time onto the ramp: each was taken in by the dock only after the one ahead had rolled on
    const dockIn = t.of('taken-in').filter((x) => x.e.id === 'dock').map((x) => x.step);
    expect(dockIn.length).toBe(3);
    for (let i = 1; i < 3; i++) expect(dockIn[i]! - dockIn[i - 1]!).toBeGreaterThan(5);
    expect(watch.takes).toBe(3);
    w.dispose();
  }, 60_000);

  test("the dock's rollers are never slower than the belt", async () => {
    const w = await benchWorld();
    const t = tape(w);
    t.run(30);
    w.dispatch({ type: 'turn', id: 'belt-dial', value: 1 });
    t.run(1);
    putOn(w, t, 'crate-3', onBelt(0.8));
    expect(t.until((e) => e.type === 'taken-in' && e.id === 'dock', 6 * HZ)).not.toBeNull();
    const a = w.motion('crate-3')!.pose.p;
    t.run(6);
    const b = w.motion('crate-3')!.pose.p;
    const speed = Math.hypot(b[0] - a[0], b[2] - a[2]) / (6 / HZ);
    expect(speed).toBeGreaterThanOrEqual(BELT_TUNING.speeds[4]! * 0.9);
    w.dispose();
  }, 60_000);
});
