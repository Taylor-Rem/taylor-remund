// R4 (Taylor, 2026-11-20: "when you throw a box off the ledge it shoots out of the shoot really weakly instead of on the
// spot it's supposed to land on"). A part that leaves the bench came back up the return chute and popped out of its
// mouth with P1's fixed little push, to lie behind the belt's motor at the chute's foot; a replacement crate is thrown
// in an arc onto the pad (R1). Now everything that comes back up the chute comes back the same way: thrown onto the
// pad, tumbling, or, the pad taken, onto the nearest free spot beside it; two at once never land in each other.
import { describe, expect, test } from 'vitest';
import { AT, benchWorld, FULL_BENCH, tape, type Tape } from './line-helpers.ts';
import { HZ, steps } from '../../src/workshop/sim/clock.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { Vec3 } from '../../src/workshop/sim/types.ts';

const PAD = AT.pad;
const MOUTH = AT.chute.p;

/** Lift `id`, carry it to `from` and throw it at `v`. */
function throwFrom(w: World, t: Tape, id: string, from: Vec3, v: Vec3): void {
  w.dispatch({ type: 'grab', id, grip: w.motion(id)!.pose.p });
  t.run(1);
  expect(w.holding()?.id).toBe(id);
  for (let i = 0; i < 70; i++) {
    w.dispatch({ type: 'carry', target: from });
    t.run(1);
  }
  w.dispatch({ type: 'release', velocity: v });
}

/** Run until `id` has been back on the bench and still for half a second (or `max` s); where it lies then. */
function backAndStill(w: World, t: Tape, id: string, max = 12): { at: Vec3 | null; returned: boolean } {
  let returned = t.events.some((x) => x.e.type === 'part.returned' && x.e.id === id);
  let still = 0;
  for (let i = 0; i < steps(max); i++) {
    for (const e of t.run(1)) if (e.type === 'part.returned' && e.id === id) returned = true;
    const m = w.motion(id)!;
    const sp = Math.hypot(m.pose.p[0] - m.prev.p[0], m.pose.p[1] - m.prev.p[1], m.pose.p[2] - m.prev.p[2]) * HZ;
    still = returned && m.mode === 'free' && sp < 0.05 ? still + 1 : 0;
    if (still > HZ / 2) return { at: m.pose.p, returned };
  }
  return { at: null, returned };
}

const EDGES: [string, Vec3, Vec3][] = [
  ['the front', [0.5, 1.5, 4.2], [0, 0, 1]],
  ['the back (over the wall: it stands 6 high)', [-3, 7, -4.2], [0, 0.2, -1]],
  ['the left end', [-8.2, 1.5, 0], [-1, 0, 0]],
  ['the right end', [8.2, 1.5, 1.5], [1, 0, 0]],
];

describe('thrown off the bench, a crate comes back up the chute onto the pad', () => {
  for (const [edge, from, dir] of EDGES) {
    for (const speed of [6, 10, 14]) {
      test(`off ${edge} at ${speed} u/s: thrown back onto the pad (or beside it), never left at the chute's mouth`, async () => {
        const w = await benchWorld(`r4-chute-${edge}-${speed}`, { scene: FULL_BENCH });
        const t = tape(w);
        t.run(steps(1));
        throwFrom(w, t, 'crate-3', from, [dir[0] * speed, Math.max(dir[1] * speed, 1.6), dir[2] * speed]);
        const launched = t.until((e) => e.type === 'restock.launched' && e.part === 'crate-3', steps(8));
        expect(launched, 'thrown back up the chute').not.toBeNull();
        const r = backAndStill(w, t, 'crate-3');
        expect(r.at, 'back and at rest').not.toBeNull();
        const p = r.at!;
        const dPad = Math.hypot(p[0] - PAD[0], p[2] - PAD[1]);
        expect(dPad, 'on the pad (within 0.6 of its middle) or on the free spot beside it').toBeLessThan(2.4);
        expect(Math.hypot(p[0] - MOUTH[0], p[2] - MOUTH[2]), 'not at the chute\'s mouth').toBeGreaterThan(1.5);
        expect(p[1], 'on the bench').toBeLessThan(0.6);
        w.dispose();
      }, 120_000);
    }
  }

  test('the pad empty: it lands on the pad itself, within 0.6 of its middle', async () => {
    const w = await benchWorld('r4-chute-pad', { scene: FULL_BENCH });
    const t = tape(w);
    t.run(steps(1));
    throwFrom(w, t, 'crate-3', [-8.2, 1.5, 0], [-10, 1.6, 0]);
    const r = backAndStill(w, t, 'crate-3');
    const p = r.at!;
    // (unless a replacement got there first: then beside it, as above)
    const replacementOnPad = ['crate-1', 'crate-2', 'crate-4', 'crate-spare-1', 'crate-spare-2', 'crate-spare-3'].some((id) => {
      const q = w.motion(id)?.pose.p;
      return !!q && w.mode(id) === 'free' && Math.hypot(q[0] - PAD[0], q[2] - PAD[1]) < 0.6;
    });
    if (!replacementOnPad) expect(Math.hypot(p[0] - PAD[0], p[2] - PAD[1])).toBeLessThan(0.6);
    w.dispose();
  }, 120_000);

  test('two thrown off together both come back, neither landing in the other', async () => {
    const w = await benchWorld('r4-chute-two', { scene: FULL_BENCH });
    const t = tape(w);
    t.run(steps(1));
    throwFrom(w, t, 'crate-3', [0.5, 1.5, 4.2], [0, 1.6, 12]);
    t.run(2);
    throwFrom(w, t, 'crate-2', [1.5, 1.5, 4.2], [0, 1.6, 12]);
    const a = backAndStill(w, t, 'crate-3', 14);
    const b = backAndStill(w, t, 'crate-2', 14);
    expect(a.at && b.at).toBeTruthy();
    const pa = w.motion('crate-3')!.pose.p;
    const pb = w.motion('crate-2')!.pose.p;
    const ha = w.halfExtents('crate-3')!;
    const hb = w.halfExtents('crate-2')!;
    expect(Math.hypot(pa[0] - pb[0], pa[2] - pb[2]), 'apart').toBeGreaterThan(Math.min(ha[0], ha[2]) + Math.min(hb[0], hb[2]));
    for (const p of [pa, pb]) {
      expect(Math.hypot(p[0] - PAD[0], p[2] - PAD[1])).toBeLessThan(2.4);
      expect(p[1]).toBeLessThan(0.6);
    }
    w.dispose();
  }, 120_000);
});
