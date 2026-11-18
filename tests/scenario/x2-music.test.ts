// REWRITE.md § B2 X2, "the belt is a music box": three crates small to large play a falling run; the
// dial changes the interval; the lever plays it backwards. Whole bench, real Rapier.
import { describe, expect, test } from 'vitest';
import { BENCH, benchWorld, onBelt, putOn, tape, waitFor } from './line-helpers.ts';
import type { Tape } from './line-helpers.ts';
import { striker } from '../../src/workshop/sim/machines/striker.ts';
import { BELT_TUNING } from '../../src/workshop/sim/machines/belt.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { SceneDesc } from '../../src/workshop/sim/scene.ts';

/** The lever: 0 backward, 0.5 stop, 1 forward. */
const lever = (w: World, t: Tape, v: number): void => {
  w.dispatch({ type: 'turn', id: 'belt-lever', value: v });
  t.run(1);
};
const dial = (w: World, t: Tape, detent: number): void => {
  w.dispatch({ type: 'turn', id: 'belt-dial', value: (detent - 1) / (BELT_TUNING.speeds.length - 1) });
  t.run(1);
};

/** Stop the belt, set S, M, L on it in a row (S ahead), start it; return the strikes that follow. */
async function play(o: { detent?: number; scene?: SceneDesc; at?: number } = {}): Promise<{ w: World; t: Tape; strikes: () => { step: number; part: string | null; note: number }[] }> {
  const w = await benchWorld(1, o.scene ? { scene: o.scene } : {});
  const t = tape(w);
  t.run(30);
  lever(w, t, 0.5);
  if (o.detent) dial(w, t, o.detent);
  const u = o.at ?? 0.3;
  putOn(w, t, 'crate-3', onBelt(u + 0.24)); // S, ahead
  waitFor(w, t, 'crate-3', 'in');
  putOn(w, t, 'crate-2', onBelt(u + 0.12)); // M
  waitFor(w, t, 'crate-2', 'in');
  putOn(w, t, 'crate-1', onBelt(u)); // L, last
  waitFor(w, t, 'crate-1', 'in');
  for (const id of ['crate-1', 'crate-2', 'crate-3']) expect(w.part(id)!.location, id).toEqual({ at: 'in', station: 'line', mouth: 'belt' });
  const from = w.step;
  lever(w, t, 1);
  return { w, t, strikes: () => t.of('struck').filter((x) => x.step > from).map((x) => ({ step: x.step, part: x.e.part, note: x.e.note })) };
}

describe('X2: the belt is a music box', () => {
  test('three crates small to large play a falling run; the dial is the tempo', async () => {
    const mid = await play();
    mid.t.run(12 * HZ);
    const a = mid.strikes();
    expect(a.map((s) => s.part)).toEqual(['crate-3', 'crate-2', 'crate-1']);
    expect(a.map((s) => s.note)).toEqual([7, 4, 0]); // falling: S, M, L
    const gapsMid = [a[1]!.step - a[0]!.step, a[2]!.step - a[1]!.step];

    const fast = await play({ detent: 5 });
    fast.t.run(12 * HZ);
    const b = fast.strikes();
    expect(b.map((s) => s.note)).toEqual([7, 4, 0]);
    const gapsFast = [b[1]!.step - b[0]!.step, b[2]!.step - b[1]!.step];
    console.log(`X2: intervals at detent 3 ${gapsMid.map((g) => (g / HZ).toFixed(2))} s, at detent 5 ${gapsFast.map((g) => (g / HZ).toFixed(2))} s`);
    // the same spacing played twice as fast (3.0 against 1.5 units/s): about half the interval
    for (let i = 0; i < 2; i++) expect(gapsFast[i]! / gapsMid[i]!).toBeCloseTo(BELT_TUNING.speeds[2]! / BELT_TUNING.speeds[4]!, 1);
    mid.w.dispose();
    fast.w.dispose();
  }, 60_000);

  test('the lever plays it backwards (striker mid-belt, so the whole run fits past it)', async () => {
    // On the bench as laid out the arm stands 0.45 from the belt's far end: one crate's room, so a reversed
    // run cannot be heard there. With the arm mid-belt the mechanism is the same; see the hand-in.
    const scene: SceneDesc = { ...BENCH, units: BENCH.units!.map((u, i) => (i === 1 ? striker({ id: 'striker', station: 'line', name: 'name.striker', x: -0.4, mouth: 'belt' }) : u)) };
    const { w, t, strikes } = await play({ scene, at: 0.2 });
    const done = t.until(() => strikes().length === 3, 12 * HZ);
    expect(done).not.toBeNull();
    t.run(HZ / 2);
    lever(w, t, 0);
    t.run(10 * HZ);
    const s = strikes();
    expect(s.map((x) => x.note)).toEqual([7, 4, 0, 0, 4, 7]); // forward falling, then back rising
    w.dispose();
  }, 60_000);
});
