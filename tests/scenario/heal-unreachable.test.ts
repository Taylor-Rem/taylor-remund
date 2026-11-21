// R3 (Taylor: "the simulation will never get stuck because Fetch can't reach any boxes"): two layouts the healing
// traffic soak found on 2026-11-20 where the belt was never fed again. The visitor strews every crate as in
// heal-traffic (its seeds 5 and 1, the same strewing) and sets Patch down; then nobody touches anything.
//  - traffic-5: a fresh crate (crate-2, back from Revert's hatch) lies at the stack's edge, (2.3, 1.4), out of Fetch's
//    reach from its tape beside the handled L at (2.5, 2.1). It looked like Fetch's work to Revert and to the dock, so
//    neither healed, while Fetch reached for it and gave up every 40 s. Now Fetch's give-up (`crew.gaveUp`) makes it
//    not Fetch's work: Revert sweeps it.
//  - traffic-1: every handled crate lies where Revert has no stand (crate-1 half on the belt's bed beside the pad, so
//    the dock's last resort waits for the pad for good; crates on the console's and the UNDO housing's tops). Now,
//    the bench dry and no stray Revert can get at, after `heal.after` the nearest goes home by the chute.
import { describe, expect, test } from 'vitest';
import { benchWorld, putOn, tape, FULL_BENCH } from './line-helpers.ts';
import { REVERT_HEAL } from '../../src/workshop/sim/scenes/bench.ts';
import { rng } from '../../src/workshop/sim/rng.ts';
import { steps, HZ } from '../../src/workshop/sim/clock.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { Id, PatchView, SimEvent, Vec3 } from '../../src/workshop/sim/types.ts';

const CRATES = ['crate-1', 'crate-2', 'crate-3', 'crate-4', 'crate-spare-1', 'crate-spare-2', 'crate-spare-3'];

/** heal-traffic's session up to the visitor leaving (its strewing and Patch set down, from `traffic-<seed>`). */
async function strewn(seed: number): Promise<{ w: World; t: ReturnType<typeof tape> }> {
  const r = rng(`traffic-${seed}`);
  const w = await benchWorld(`traffic-${seed}`, { scene: FULL_BENCH });
  const t = tape(w);
  t.run(steps(20));
  for (let k = 0; k < 16; k++) {
    const fresh = CRATES.filter((id) => w.mode(id) === 'free' && w.part(id)!.location.at === 'rest' && !w.touched(id));
    const busy = CRATES.some((id) => ['machine', 'chute', 'crew'].includes(w.mode(id) ?? ''));
    if (!fresh.length && !busy && k > 2) break;
    for (const id of fresh) {
      putOn(w, t, id, [r.range(-8.3, 8.3), 0, r.range(-4.3, 4.4)]);
      t.run(steps(0.5));
    }
    t.run(steps(4));
  }
  const at: Vec3 = [r.range(-7, 6), 0.4, r.range(-2.5, 1.5)];
  w.dispatch({ type: 'grab', id: 'patch', grip: (w.machine('patch') as PatchView).at });
  for (let i = 1; i <= 30; i++) {
    w.dispatch({ type: 'carry', target: [at[0], 2.5 - (2 * i) / 30, at[2]] });
    t.run(1);
  }
  w.dispatch({ type: 'release', velocity: [0, 0, 0] });
  return { w, t };
}
function leftAlone(w: World, t: ReturnType<typeof tape>, secs: number): { ev: { s: number; e: SimEvent }[]; fed: number | null } {
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
  ev.filter(({ e }) => ['put-away', 'revert.sweep', 'restocked', 'crew.gaveUp', 'taken-in'].includes(e.type)).map(({ s, e }) => `${s.toFixed(1)} ${e.type} ${(e as unknown as { part?: Id; id?: Id }).part ?? (e as unknown as { id?: Id }).id}`).join(' | ');
const near = (w: World, id: Id, x: number, z: number, d: number): boolean => {
  const p = w.motion(id)!.pose.p;
  return Math.hypot(p[0] - x, p[2] - z) < d;
};

describe('the bench heals what Fetch cannot reach', () => {
  test('traffic-5: a fresh crate at the stack\'s edge (2.3, 1.4), out of Fetch\'s reach: Fetch gives up on it, and that starts the heal (no stand for it either: a stray goes home by the chute); the belt is fed', async () => {
    const { w, t } = await strewn(5);
    const out = leftAlone(w, t, 150);
    const gave = out.ev.find(({ e }) => e.type === 'crew.gaveUp');
    const healed = gave ? out.ev.find(({ s, e }) => s > gave.s && (e.type === 'put-away' || e.type === 'revert.sweep')) : undefined;
    process.stderr.write(`\ntraffic-5: ${events(out.ev)}\n`);
    expect(gave, 'Fetch reached for a crate it could not take').toBeTruthy();
    expect((gave!.e as { part: Id }).part).toBe('crate-2');
    expect(healed, 'a heal after it').toBeTruthy();
    // (within the heal's own times: Fetch dry `heal.after` (20 s), then `heal.after` with no stray Revert can stand by)
    expect(healed!.s - gave!.s).toBeLessThan(2 * REVERT_HEAL.after + 5);
    expect(out.fed, 'the belt is fed again').not.toBeNull();
    w.dispose();
  }, 300_000);

  test('traffic-1: every handled crate where Revert has no stand (crate-1 half on the belt\'s bed beside the pad, so the dock\'s last resort waits for the pad; the others on machine tops): they go home by the chute one at a time, crate-1 among them; the belt is fed', async () => {
    const { w, t } = await strewn(1);
    t.run(steps(1));
    // the layout: crate-1 half on the belt's bed beside the pad
    expect(near(w, 'crate-1', -3.8, 3.4, 0.3), 'crate-1 beside the pad on the belt\'s bed').toBe(true);
    expect(w.motion('crate-1')!.pose.p[1]).toBeGreaterThan(0.6);
    const out = leftAlone(w, t, 150);
    process.stderr.write(`\ntraffic-1: ${events(out.ev)}\n`);
    expect(chuted(out.ev), 'what nobody could get at went home by the chute').toContain('crate-1');
    expect(out.fed, 'the belt is fed again').not.toBeNull();
    w.dispose();
  }, 300_000);
});
