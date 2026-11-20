// Revert's sweep tidies (S7 round 2, item 3; REWRITE.md § B5 "puts away the oldest things nobody has
// touched for a while"), on the whole bench under real Rapier: with the bench crowded it goes to a proper
// stand by the oldest stray (its far side, facing the visitor), sweeps it into the dustpan, and the stray
// is put back where it belongs (onto the stack). A stray with no clear stand is left for later, never swept
// from wherever Revert happens to be.
import { describe, expect, test } from 'vitest';
import { benchWorld, putOn, tape, AT, FULL_BENCH } from './line-helpers.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';
import { REVERT } from '../../src/workshop/sim/scenes/bench.ts';
import type { RevertView, Vec3 } from '../../src/workshop/sim/types.ts';

describe("Revert's sweep", () => {
  test('strays (R3, 2026-11-20: any crate Fetch may not carry, a few seconds after it was set down): it sweeps each it can get at from a proper stand, nearest first, carries it home and down its hatch, and the chute gives it back', async () => {
    const w = await benchWorld('sweep', { scene: FULL_BENCH });
    const t = tape(w);
    t.run(30);
    // four strays; the one nearest Revert's hatch is set down first
    const spots: [string, Vec3][] = [['crate-3', [-6.5, 0, -1.5]], ['crate-1', [4.5, 0, -1.8]], ['crate-2', [-1.5, 0, -3.3]], ['crate-4', [0.5, 0, 3.0]]];
    for (const [id, at] of spots) putOn(w, t, id, at);
    const sweeps: { part: string; from: Vec3; revert: RevertView }[] = [];
    const dropped = new Set<string>();
    const back = new Set<string>();
    let atSweep: RevertView | null = null;
    for (let i = 0; i < 130 * HZ; i++) {
      for (const e of t.run(1)) {
        // R3: into the pan (`to` rest: the pan), carried home, and down the hatch (`to` shipped); up the chute again
        if (e.type === 'revert.sweep' && e.to.at === 'rest') sweeps.push({ part: e.part, from: e.from.p, revert: atSweep! });
        if (e.type === 'revert.sweep' && e.to.at === 'shipped') dropped.add(e.part);
        if (e.type === 'restocked') back.add(e.part);
      }
      const r = w.machine('revert-crew') as RevertView;
      if (r.state === 'sweep' && (!atSweep || atSweep.state !== 'sweep' || atSweep.sweeping !== r.sweeping)) atSweep = r;
      else if (r.state !== 'sweep') atSweep = null;
    }
    expect(sweeps.length).toBeGreaterThan(0);
    const hz = AT.revert.half[2];
    for (const s of sweeps) {
      // R3: into the dustpan, carried home and down the hatch, and back up the chute onto the pad
      expect(dropped.has(s.part), `${s.part} down the hatch`).toBe(true);
      // back up the chute onto the pad, or owed until the pad is free (this bench has no rounds: nobody takes the pad's crate)
      const padTaken = ['crate-1', 'crate-2', 'crate-3', 'crate-4', 'crate-spare-1', 'crate-spare-2', 'crate-spare-3'].some((id) => {
        const q = w.motion(id)?.pose.p;
        return w.mode(id) === 'free' && !!q && Math.hypot(q[0] - AT.pad[0], q[2] - AT.pad[1]) < 0.5;
      });
      expect(back.has(s.part) || padTaken, `${s.part} back up the chute (or owed: the pad is taken)`).toBe(true);
      expect(w.touched(s.part)).toBe(false); // a fresh crate again
      // from a proper stand: close by, on the far side, its front or side to the visitor
      const r = s.revert;
      const toVisitor = Math.atan2(REVERT.outward[0] - s.from[0], REVERT.outward[2] - s.from[2]);
      const off = Math.atan2(Math.sin(r.heading - toVisitor), Math.cos(r.heading - toVisitor));
      // (out in the open, its front or side to the visitor; against the back of the bench, any stand it can drive straight to)
      if (s.part === 'crate-3') expect(Math.abs(off), `${s.part} heading`).toBeLessThanOrEqual(Math.PI / 2 + 1e-6);
      expect(Math.hypot(r.x - s.from[0], r.z - s.from[2]), `${s.part} distance`).toBeLessThan(hz + 0.5 + 0.3);
      // facing the part: it is in front of Revert, not off to a side or behind
      const toPart = Math.atan2(s.from[0] - r.x, s.from[2] - r.z);
      expect(Math.abs(Math.atan2(Math.sin(toPart - r.heading), Math.cos(toPart - r.heading))), `${s.part} in front`).toBeLessThan(0.3);
    }
    // the first is the nearest it could get at
    expect(sweeps[0]!.part).toBe('crate-3');
    w.dispose();
  }, 120_000);
});
