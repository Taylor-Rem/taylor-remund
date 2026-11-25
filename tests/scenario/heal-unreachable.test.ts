// R3 (Taylor: "the simulation will never get stuck because Fetch can't reach any boxes"): three layouts the healing
// traffic soak found on 2026-11-20 where the belt was never fed again, set out here directly (each crate where the
// soak left it, the handled ones touched by a hand that let go at once; no other crate on the bench; play mode),
// so that they do not depend on how the hand carries.
//  - stack's edge (soak seed 5): a fresh crate (crate-2) at the stack's edge, (2.3, 1.4), out of Fetch's reach from its
//    tape beside the handled L at (2.5, 2.1). It looked like Fetch's work to Revert and to the dock, so neither healed,
//    while Fetch reached for it and gave up every 40 s. Now Fetch's give-up (`crew.gaveUp`) makes it not Fetch's work.
//  - no stand (soak seed 1): every handled crate where Revert has no stand: crate-1 half on the belt's bed beside the
//    pad (so the dock's last resort waits for the pad for good), crates on the console's and the UNDO housing's tops,
//    one at the bench's far right. Now, the bench dry and no stray Revert can get at, after `heal.stir` one goes home
//    by the chute where it lies, the one on the pad first.
//  - in the way (soak seed 9): a handled crate beside Revert's hatch, with no stand of its own, stood in the way of every
//    heal's trip: Revert waited for it and gave up, again and again. It counts as out of reach, and goes first.
import { describe, expect, test } from 'vitest';
import { benchWorld, tape, FULL_BENCH } from './line-helpers.ts';
import { startPlay } from './fetch-helpers.ts';
import { REVERT_HEAL } from '../../src/workshop/sim/scenes/bench.ts';
import { steps, HZ } from '../../src/workshop/sim/clock.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { SceneDesc } from '../../src/workshop/sim/scene.ts';
import type { Id, SimEvent, Vec3 } from '../../src/workshop/sim/types.ts';

type Tape = ReturnType<typeof tape>;
/** The bench with the named crates at these places (the rest shipped behind the dock's door), Fetch empty-handed. */
function laidOut(at: Record<string, Vec3>): SceneDesc {
  return {
    ...FULL_BENCH,
    parts: FULL_BENCH.parts.map((p) => {
      if (p.kind !== 'crate') return p;
      const q = at[p.id];
      return q ? { ...p, pose: { p: q, q: [0, 0, 0, 1] as const }, shipped: false } : { ...p, shipped: true };
    }),
    runner: { ...FULL_BENCH.runner, carrying: undefined },
  } as unknown as SceneDesc;
}
async function setOut(seed: string, at: Record<string, Vec3>, handled: readonly Id[]): Promise<{ w: World; t: Tape }> {
  const w = await benchWorld(seed, { scene: laidOut(at) });
  const t = tape(w);
  startPlay(w);
  // a hand on each handled crate, let go at once: it is the visitor's now, where it lies
  for (const id of handled) {
    w.dispatch({ type: 'grab', id, grip: w.motion(id)!.pose.p });
    t.run(1);
    w.dispatch({ type: 'release', velocity: [0, 0, 0] });
    t.run(1);
    expect(w.touched(id)).toBe(true);
  }
  return { w, t };
}
function leftAlone(t: Tape, secs: number): { ev: { s: number; e: SimEvent }[]; fed: number | null } {
  const ev: { s: number; e: SimEvent }[] = [];
  let fed: number | null = null;
  for (let i = 0; i < steps(secs) && fed === null; i++) {
    for (const e of t.run(1)) {
      ev.push({ s: i / HZ, e });
      if (e.type === 'taken-in' && e.id === 'belt' && fed === null) fed = i / HZ;
    }
  }
  return { ev, fed };
}
/** Parts put away with no sweep of theirs in the same step: taken by the chute where they lay. */
const chuted = (ev: { s: number; e: SimEvent }[]): Id[] =>
  ev.filter(({ s, e }) => e.type === 'put-away' && !ev.some((x) => x.s === s && x.e.type === 'revert.sweep' && x.e.part === e.id)).map(({ e }) => (e as { id: Id }).id);
const events = (ev: { s: number; e: SimEvent }[]): string =>
  ev.filter(({ e }) => ['put-away', 'revert.sweep', 'restocked', 'crew.gaveUp', 'taken-in'].includes(e.type)).map(({ s, e }) => `${s.toFixed(1)} ${e.type} ${(e as unknown as { part?: Id }).part ?? (e as unknown as { id?: Id }).id}`).join(' | ');
const lies = (w: World, id: Id, x: number, z: number, d = 0.15): boolean => {
  const p = w.motion(id)!.pose.p;
  return w.mode(id) === 'free' && Math.hypot(p[0] - x, p[2] - z) < d;
};

describe('the bench heals what Fetch cannot reach', () => {
  test('stack\'s edge: a fresh crate at (2.3, 1.4) beside the handled L at (2.5, 2.1), out of Fetch\'s reach: Fetch gives up on it, and that starts the heal; the belt is fed', async () => {
    const { w, t } = await setOut('heal-stack-edge', { 'crate-1': [2.5, 0.4, 2.1], 'crate-2': [2.3, 0.3, 1.4] }, ['crate-1']);
    expect(lies(w, 'crate-2', 2.3, 1.4) && !w.touched('crate-2'), 'crate-2 fresh at the stack\'s edge').toBe(true);
    const out = leftAlone(t, 150);
    process.stderr.write(`\nstack's edge: ${events(out.ev)}\n`);
    const gave = out.ev.find(({ e }) => e.type === 'crew.gaveUp');
    expect(gave, 'Fetch reached for a crate it could not take').toBeTruthy();
    expect((gave!.e as { part: Id }).part).toBe('crate-2');
    const healed = out.ev.find(({ s, e }) => s > gave!.s && (e.type === 'put-away' || e.type === 'revert.sweep'));
    expect(healed, 'a heal after it').toBeTruthy();
    // (within the heal's own times: Fetch dry `heal.after`, then the sweep's trip, or `heal.stir` with no stray Revert can get at)
    expect(healed!.s - gave!.s).toBeLessThan(REVERT_HEAL.after + REVERT_HEAL.stir + 15);
    expect(out.fed, 'the belt is fed again').not.toBeNull();
    w.dispose();
  }, 300_000);

  test('no stand: six handled crates (the most the bench holds, so the dock\'s last resort brings no seventh), every one where Revert has no stand (on the console\'s and the UNDO housing\'s tops, at the bench\'s far right): they go home by the chute one at a time; the belt is fed', async () => {
    const at: Record<string, Vec3> = { 'crate-1': [8.1, 0.4, 1.7], 'crate-2': [-8.15, 1.19, -1.35], 'crate-3': [-7.05, 1.11, -1.25], /* (L2: the console's top, in the corner) */ 'crate-4': [-2.9, 2.19, 0.4], 'crate-spare-1': [-2.2, 2.19, 0.3], 'crate-spare-2': [8.2, 0.3, 3.4] };
    const { w, t } = await setOut('heal-no-stand', at, Object.keys(at));
    for (const [id, p] of Object.entries(at)) expect(lies(w, id, p[0], p[2]), `${id} where it was set`).toBe(true);
    const out = leftAlone(t, 150);
    process.stderr.write(`\nno stand: ${events(out.ev)}\n`);
    expect(out.ev.some(({ e }) => e.type === 'revert.sweep'), 'Revert could sweep none of them').toBe(false);
    expect(chuted(out.ev).length, 'what nobody could get at went home by the chute').toBeGreaterThan(0);
    expect(out.fed, 'the belt is fed again').not.toBeNull();
    w.dispose();
  }, 300_000);

  test('in the way: a handled crate (crate-3) beside Revert\'s hatch at (-3.9, -0.9), no stand of its own, in the way of the heal\'s trip to crate-1 at the back: it goes home by the chute first; the belt is fed', async () => {
    const { w, t } = await setOut('heal-in-the-way', { 'crate-1': [-4.1, 0.4, -4.3], 'crate-2': [-3.6, 0.3, 3.0], 'crate-3': [-3.9, 0.225, -0.9] }, ['crate-1', 'crate-2', 'crate-3']);
    expect(lies(w, 'crate-3', -3.9, -0.9), 'crate-3 beside the hatch').toBe(true);
    const out = leftAlone(t, 150);
    process.stderr.write(`\nin the way: ${events(out.ev)}\n`);
    expect(chuted(out.ev)[0], 'the crate in the way went home by the chute first').toBe('crate-3');
    expect(out.fed, 'the belt is fed again').not.toBeNull();
    w.dispose();
  }, 300_000);
});
