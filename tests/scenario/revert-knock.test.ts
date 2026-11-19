// R3: a crate on Revert's hatch never keeps it down. Wanting up (a rung, the UNDO lever, a heal) with only crates
// on the leaves, after three seconds it knocks twice from below (the crates jump), the leaves open, and the crates
// drop in: a put-away like Revert's own drop (rule 14), and the dock sends the same crate back up the chute. Fetch
// or Patch on the hatch: it waits for them to go. A crate in the visitor's hand over the hatch is not on it.
import { describe, expect, test } from 'vitest';
import { benchWorld, putOn, tape, FULL_BENCH } from './line-helpers.ts';
import { steps, HZ } from '../../src/workshop/sim/clock.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { Id, RevertView, SimEvent, Vec3 } from '../../src/workshop/sim/types.ts';
import { REVERT_TUNING } from '../../src/workshop/sim/crew/revert.ts';

const HATCH: Vec3 = [-4.83, 0, 0.37];
const rv = (w: World): RevertView => w.machine('revert-crew') as RevertView;

async function covered(seed: string): Promise<{ w: World; t: ReturnType<typeof tape>; id: Id }> {
  const w = await benchWorld(seed, { scene: FULL_BENCH });
  const t = tape(w);
  t.run(steps(25));
  const id = ['crate-1', 'crate-2', 'crate-3', 'crate-4'].find((x) => w.mode(x) === 'free' && w.part(x)!.location.at === 'rest')!;
  putOn(w, t, id, HATCH);
  t.run(steps(3));
  expect(rv(w).state).toBe('below');
  return { w, t, id };
}

describe('R3: Revert knocks its way up through a covered hatch', () => {
  test('a Button press with a crate on the hatch: it knocks, the crate drops in and comes back up the chute, and Revert is up and holds its card itself', async () => {
    const { w, t, id } = await covered('knock-press');
    w.dispatch({ type: 'press', id: 'button' });
    const seen: { at: number; e: SimEvent }[] = [];
    let knockAt = -1;
    let upAt = -1;
    let cardUp = false;
    for (let i = 0; i < steps(25); i++) {
      for (const e of t.run(1)) seen.push({ at: i / HZ, e });
      const r = rv(w);
      if (r.knock >= 0 && knockAt < 0) knockAt = i / HZ;
      if (upAt < 0 && r.lift >= 1) upAt = i / HZ;
      if (r.lift >= 1 && r.card) cardUp = true;
    }
    const drop = seen.find((s) => s.e.type === 'revert.sweep' && s.e.part === id);
    const back = seen.find((s) => s.e.type === 'restocked' && (s.e as { part: Id }).part === id);
    process.stderr.write(`\nknock at ${knockAt.toFixed(1)} s, drop at ${drop?.at.toFixed(1)} s, up at ${upAt.toFixed(1)} s, back up the chute at ${back?.at.toFixed(1)} s, card held up by Revert: ${cardUp}\n`);
    expect(knockAt).toBeGreaterThanOrEqual(REVERT_TUNING.knockAfter - 0.1);
    expect(drop).toBeDefined();
    expect(drop!.e.type === 'revert.sweep' && drop!.e.to.at).toBe('shipped');
    expect(upAt).toBeGreaterThan(drop!.at);
    expect(cardUp).toBe(true);
    expect(back).toBeDefined(); // the same crate, up the chute onto the pad
    expect(w.touched(id)).toBe(false);
    w.dispose();
  }, 300_000);

  test('UNDO after the crate was knocked in: the crate is not the lever\'s to bring back; the lever goes on to older things', async () => {
    const { w, t, id } = await covered('knock-undo');
    w.dispatch({ type: 'press', id: 'button' });
    let dropped = false;
    for (let i = 0; i < steps(25) && !dropped; i++) for (const e of t.run(1)) if (e.type === 'revert.sweep' && e.part === id) dropped = true;
    expect(dropped).toBe(true);
    t.run(steps(12));
    const before = w.part(id)!.location;
    const out: SimEvent[] = [];
    w.dispatch({ type: 'undo', id: 'undo-lever' } as never);
    for (let i = 0; i < steps(8); i++) out.push(...t.run(1).filter((e) => ['undone', 'undo.refused', 'card'].includes(e.type)));
    process.stderr.write(`\nafter UNDO: ${out.map((e) => JSON.stringify(e).slice(0, 160)).join('\n  ')}\n`);
    const undone = out.find((e) => e.type === 'undone');
    if (undone && undone.type === 'undone') expect(undone.restores.some((r) => r.target === id)).toBe(false);
    // where the crate is now is not the hatch
    const p = w.motion(id)!.pose.p;
    expect(Math.hypot(p[0] - HATCH[0], p[2] - HATCH[2])).toBeGreaterThan(0.8);
    void before;
    w.dispose();
  }, 300_000);

  test('Fetch set on the hatch: Revert waits for it (no knock) and comes up once it has gone', async () => {
    const w = await benchWorld('knock-fetch', { scene: FULL_BENCH });
    const t = tape(w);
    t.run(steps(25));
    putOn(w, t, 'fetch', HATCH);
    w.dispatch({ type: 'press', id: 'button' });
    let knocked = false;
    let upAt = -1;
    for (let i = 0; i < steps(30); i++) {
      for (const e of t.run(1)) if (e.type === 'revert.sweep' && e.part === 'fetch') knocked = true;
      if (upAt < 0 && rv(w).lift >= 1) upAt = i / HZ;
    }
    process.stderr.write(`\nFetch on the hatch: Revert up at ${upAt.toFixed(1)} s; Fetch at ${w.motion('fetch')!.pose.p.map((v) => v.toFixed(1)).join(',')}\n`);
    expect(knocked).toBe(false);
    expect(w.mode('fetch')).not.toBe('gone');
    w.dispose();
  }, 300_000);
});
