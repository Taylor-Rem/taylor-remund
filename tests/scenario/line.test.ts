// REWRITE.md § E8 scenario, release 1: "a crate put on the belt sounds at the striker and ships at the
// dock", on the whole bench under real Rapier, with the feel target of the brief (§ E0): a crate put on
// the running belt at its motor end reaches the striker in 4 to 8 seconds at the middle speed.
import { describe, expect, test } from 'vitest';
import { benchWorld, LINE, onBelt, putOn, tape } from './line-helpers.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';
import type { BeltView, Value } from '../../src/workshop/sim/types.ts';

/** A location as its kind (`rest`, `in`, `shipped`); anything else as it is. */
const short = (v: Value): Value => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as { at: string }).at : v);

describe('a crate put on the belt sounds at the striker and ships at the dock', () => {
  test('the top crate of the stack, put at the motor end of the running belt', async () => {
    const w = await benchWorld();
    const t = tape(w);
    t.run(30);
    putOn(w, t, 'crate-3', onBelt(0.06));
    const placed = w.step;
    const taken = t.until((e) => e.type === 'taken-in' && e.part === 'crate-3', 120);
    expect(taken?.e).toMatchObject({ id: 'belt', mouth: 'belt' });
    expect(w.part('crate-3')!.location).toEqual({ at: 'in', station: 'line', mouth: 'belt' });
    expect(w.mode('crate-3')).toBe('machine');
    expect((w.machine('belt') as BeltView).riding).toEqual(['crate-3']);

    const struck = t.until((e) => e.type === 'struck' && e.part === 'crate-3', 20 * HZ);
    expect(struck?.e).toMatchObject({ id: 'striker', size: 'S', material: 'wood', note: 7, octave: 0 });
    const seconds = (struck!.step - placed) / HZ;
    console.log(`belt: let go at the motor end, struck after ${seconds.toFixed(2)} s at the middle speed`);
    expect(seconds).toBeGreaterThanOrEqual(4);
    expect(seconds).toBeLessThanOrEqual(8);
    // at the step it passed: its centre crossed the arm's plane in that very step
    expect(w.motion('crate-3')!.pose.p[0]).toBeGreaterThanOrEqual(LINE.strikerX);

    const shipped = t.until((e) => e.type === 'shipped' && e.part === 'crate-3', 10 * HZ);
    expect(shipped?.e).toMatchObject({ id: 'dock' });
    expect(t.of('door').map((x) => x.e.open)).toEqual([true]);
    const p = w.part('crate-3')!;
    expect(p.location).toEqual({ at: 'shipped' });
    expect(p.marks).toEqual(['mark.shipped']);
    expect(w.mode('crate-3')).toBe('gone');
    // all of it is the placing's: one transaction, one location entry from the stack to shipped
    const stack = w.undoStack();
    const mine = stack.filter((x) => x.entries.some((e) => e.target === 'crate-3'));
    expect(mine.length).toBe(1);
    expect(mine[0]!.entries.filter((e) => e.target === 'crate-3').map((e) => [e.field, short(e.before), short(e.after)])).toEqual([
      ['location', 'rest', 'shipped'],
      ['marks', [], ['mark.shipped']],
    ]);

    // a fresh crate is set on the stack in its place, and the door shuts
    const restocked = t.until((e) => e.type === 'restocked', 5 * HZ);
    expect(restocked?.e).toMatchObject({ id: 'dock', part: 'crate-spare-1' });
    t.run(4 * HZ);
    expect(t.of('door').map((x) => x.e.open)).toEqual([true, false]);
    const spare = w.part('crate-spare-1')!;
    expect(spare.location.at).toBe('rest');
    expect(w.writer('crate-spare-1', 'location')).toBe('system');
    const sp = w.motion('crate-spare-1')!.pose.p;
    expect(Math.hypot(sp[0] - -7.65, sp[2] - 1.15)).toBeLessThan(0.7);

    // one pull: it comes back in through the door, in one hop, and the spare stays
    w.dispatch({ type: 'undo' });
    const back = t.run(1);
    const u = back.find((e) => e.type === 'undone');
    expect(u?.type).toBe('undone');
    expect(back.find((e) => e.type === 'returned')).toMatchObject({ id: 'dock', part: 'crate-3', how: 'door' });
    const r = u?.type === 'undone' ? u.restores.find((x) => x.target === 'crate-3' && x.field === 'location') : undefined;
    expect(r?.from).toEqual({ at: 'shipped' });
    expect((r?.to as { at: string }).at).toBe('rest');
    // the hop starts at the door
    expect(Math.hypot(r!.pose!.p[0] - LINE.door[0], r!.pose!.p[2] - LINE.door[2])).toBeLessThan(0.01);
    expect(w.part('crate-3')!.marks).toEqual([]);
    expect(w.mode('crate-3')).toBe('free');
    w.dispose();
  }, 60_000);
});
