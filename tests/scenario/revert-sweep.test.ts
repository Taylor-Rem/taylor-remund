// Revert's sweep tidies (S7 round 2, item 3; REWRITE.md § B5 "puts away the oldest things nobody has
// touched for a while"), on the whole bench under real Rapier: with the bench crowded it goes to a proper
// stand by the oldest stray (its far side, facing the visitor), sweeps it into the dustpan, and the stray
// is put back where it belongs (onto the stack). A stray with no clear stand is left for later, never swept
// from wherever Revert happens to be.
import { describe, expect, test } from 'vitest';
import { benchWorld, putOn, tape, AT } from './line-helpers.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';
import { REVERT } from '../../src/workshop/sim/scenes/bench.ts';
import type { RevertView, Vec3 } from '../../src/workshop/sim/types.ts';

describe("Revert's sweep", () => {
  test('crowded: it sweeps the oldest stray it can get at from a proper stand, and the stray goes onto the stack', async () => {
    const w = await benchWorld('sweep');
    const t = tape(w);
    t.run(30);
    // four strays (the bench is crowded at four); the oldest is set down first
    const spots: [string, Vec3][] = [['crate-3', [-6.5, 0, -1.5]], ['crate-1', [4.5, 0, -1.8]], ['crate-2', [-1.5, 0, -3.3]], ['crate-4', [0.5, 0, 3.0]]];
    for (const [id, at] of spots) putOn(w, t, id, at);
    const sweeps: { part: string; from: Vec3; revert: RevertView }[] = [];
    let atSweep: RevertView | null = null;
    for (let i = 0; i < 130 * HZ; i++) {
      for (const e of t.run(1)) if (e.type === 'revert.sweep') sweeps.push({ part: e.part, from: e.from.p, revert: atSweep! });
      const r = w.machine('revert-crew') as RevertView;
      if (r.state === 'sweep' && (!atSweep || atSweep.state !== 'sweep' || atSweep.sweeping !== r.sweeping)) atSweep = r;
      else if (r.state !== 'sweep') atSweep = null;
    }
    expect(sweeps.length).toBeGreaterThan(0);
    const hz = AT.revert.half[2];
    for (const s of sweeps) {
      // into the dustpan, and on to the stack
      const loc = w.part(s.part)!.location;
      expect(loc.at, s.part).toBe('rest');
      if (loc.at === 'rest') expect(Math.hypot(loc.pose.p[0] - AT.stack[0], loc.pose.p[2] - AT.stack[1]), s.part).toBeLessThan(0.6);
      expect(w.writer(s.part, 'location')).toBe('system');
      // from a proper stand: close by, on the far side, its front or side to the visitor
      const r = s.revert;
      const toVisitor = Math.atan2(REVERT.outward[0] - s.from[0], REVERT.outward[2] - s.from[2]);
      const off = Math.atan2(Math.sin(r.heading - toVisitor), Math.cos(r.heading - toVisitor));
      expect(Math.abs(off), `${s.part} heading`).toBeLessThanOrEqual(Math.PI / 2 + 1e-6);
      expect(Math.hypot(r.x - s.from[0], r.z - s.from[2]), `${s.part} distance`).toBeLessThan(hz + 0.5 + 0.3);
      // facing the part: it is in front of Revert, not off to a side or behind
      const toPart = Math.atan2(s.from[0] - r.x, s.from[2] - r.z);
      expect(Math.abs(Math.atan2(Math.sin(toPart - r.heading), Math.cos(toPart - r.heading))), `${s.part} in front`).toBeLessThan(0.3);
    }
    // the first is the oldest it could get at
    expect(sweeps[0]!.part).toBe('crate-3');
    w.dispose();
  }, 120_000);
});
