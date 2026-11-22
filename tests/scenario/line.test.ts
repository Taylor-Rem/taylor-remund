// REWRITE.md § E8 scenario, release 1: "a crate put on the belt sounds at the striker and ships at the
// dock", on the whole bench under real Rapier, with the feel target of the brief (§ E0): a crate put on
// the running belt at its motor end reaches the striker in 4 to 8 seconds at the middle speed.
import { describe, expect, test } from 'vitest';
import { AT, benchWorld, LINE, onBelt, putOn, tape } from './line-helpers.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';
import { NOTE } from '../../src/workshop/sim/machines/striker.ts';
import type { BeltView, Value } from '../../src/workshop/sim/types.ts';

/** A location as its kind (`rest`, `in`, `shipped`); anything else as it is. */
const short = (v: Value): Value => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as { at: string }).at : v);

describe('a crate put on the belt sounds at the striker and ships at the dock', () => {
  test('the top crate of the stack, put at the motor end of the running belt', async () => {
    const w = await benchWorld();
    const t = tape(w);
    t.run(30);
    putOn(w, t, 'crate-2', onBelt(0.06));
    const placed = w.step;
    const taken = t.until((e) => e.type === 'taken-in' && e.part === 'crate-2', 120);
    expect(taken?.e).toMatchObject({ id: 'belt', mouth: 'belt' });
    expect(w.part('crate-2')!.location).toEqual({ at: 'in', station: 'line', mouth: 'belt' });
    expect(w.mode('crate-2')).toBe('machine');
    expect((w.machine('belt') as BeltView).riding).toEqual(['crate-2']);

    const struck = t.until((e) => e.type === 'struck' && e.part === 'crate-2', 20 * HZ);
    expect(struck?.e).toMatchObject({ id: 'striker', size: 'M', material: 'wood', note: NOTE.M, octave: 0 }); // (A1 round 7: the stack is two high, its top the M)
    const seconds = (struck!.step - placed) / HZ;
    console.log(`belt: let go at the motor end, struck after ${seconds.toFixed(2)} s at the middle speed`);
    expect(seconds).toBeGreaterThanOrEqual(4);
    expect(seconds).toBeLessThanOrEqual(8);
    // at the step it passed: its centre crossed the arm's plane in that very step
    expect(w.motion('crate-2')!.pose.p[0]).toBeGreaterThanOrEqual(LINE.strikerX);

    const shipped = t.until((e) => e.type === 'shipped' && e.part === 'crate-2', 10 * HZ);
    if (process.env.LINE_TRACE) for (const x of t.events.slice(-700)) if (JSON.stringify(x.e).includes('crate-2') && x.e.type !== 'part.hit') console.log(x.step, JSON.stringify(x.e).slice(0, 160), w.mode('crate-2'), JSON.stringify(w.motion('crate-2')!.pose.p));
    expect(shipped?.e).toMatchObject({ id: 'dock' });
    expect(t.of('door').map((x) => x.e.open)).toEqual([true]);
    const p = w.part('crate-2')!;
    expect(p.location).toEqual({ at: 'shipped' });
    expect(p.marks).toEqual(['mark.shipped']);
    expect(w.mode('crate-2')).toBe('gone');
    // all of it is the placing's: one transaction, one location entry from the stack to shipped
    const stack = w.undoStack();
    const mine = stack.filter((x) => x.entries.some((e) => e.target === 'crate-2'));
    expect(mine.length).toBe(1);
    expect(mine[0]!.entries.filter((e) => e.target === 'crate-2').map((e) => [e.field, short(e.before), short(e.after)])).toEqual([
      ['location', 'rest', 'shipped'],
      ['marks', [], ['mark.shipped']],
    ]);

    // a fresh crate comes up the chute onto the pad in its place (S5 R1: it no longer appears on the stack), and the door shuts
    const restocked = t.until((e) => e.type === 'restocked', 5 * HZ);
    // (P4 S5: the spares are small; with none of crate-2's size behind the door, the first comes up)
    expect(restocked?.e).toMatchObject({ id: 'dock', part: 'crate-spare-1', on: 'pad' });
    t.run(4 * HZ);
    expect(t.of('door').map((x) => x.e.open)).toEqual([true, false]);
    const spare = w.part('crate-spare-1')!;
    expect(spare.location.at).toBe('rest');
    expect(w.writer('crate-spare-1', 'location')).toBe('system');
    const sp = w.motion('crate-spare-1')!.pose.p;
    expect(Math.hypot(sp[0] - AT.pad[0], sp[2] - AT.pad[1])).toBeLessThan(0.45);

    // one pull: it comes back in through the door, in one hop, and the spare stays
    w.dispatch({ type: 'undo' });
    const back = t.run(1);
    const u = back.find((e) => e.type === 'undone');
    expect(u?.type).toBe('undone');
    expect(back.find((e) => e.type === 'returned')).toMatchObject({ id: 'dock', part: 'crate-2', how: 'door' });
    const r = u?.type === 'undone' ? u.restores.find((x) => x.target === 'crate-2' && x.field === 'location') : undefined;
    expect(r?.from).toEqual({ at: 'shipped' });
    expect((r?.to as { at: string }).at).toBe('rest');
    // the hop starts at the door
    expect(Math.hypot(r!.pose!.p[0] - LINE.door.sill[0], r!.pose!.p[2] - LINE.door.sill[2])).toBeLessThan(0.01);
    expect(w.part('crate-2')!.marks).toEqual([]);
    expect(w.mode('crate-2')).toBe('free');
    w.dispose();
  }, 60_000);
});
