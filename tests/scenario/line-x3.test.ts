// The line's part of REWRITE.md § B2 X3 ("a shipped crate comes back in through the dock door"), § D 7
// (a tool or a robot comes back up the chute with RETURN TO SENDER), § B1's bench edge, and § E5 rules
// 4, 9 and 10 on the real belt and dock. Whole bench, real Rapier.
import { describe, expect, test } from 'vitest';
import { BENCH, benchWorld, LINE, onBelt, putOn, tape, waitFor } from './line-helpers.ts';
import { throwPart, line } from './helpers.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';
import { qyaw } from '../../src/workshop/sim/math.ts';
import { defaultHalfExtents } from '../../src/workshop/sim/parts.ts';
import type { SceneDesc } from '../../src/workshop/sim/scene.ts';
import type { BeltView, Location, Restore, SimEvent } from '../../src/workshop/sim/types.ts';

const TOOL_HALF = defaultHalfExtents('tool', 'M');
/** The bench with one tool lying loose (tools stay P4 on the wall; a tool is a part like any other). */
const WITH_TOOL: SceneDesc = {
  ...BENCH,
  parts: [...BENCH.parts, { id: 'tool-rust', kind: 'tool', size: 'M', material: 'metal', colour: 'paint-orange', label: '', station: 'tools', name: 'name.crate', pose: { p: [-2.4, TOOL_HALF[1], 0.2], q: qyaw(0.3) } }],
};
const undoneOf = (ev: readonly SimEvent[]) => ev.filter((e): e is Extract<SimEvent, { type: 'undone' }> => e.type === 'undone');
const near = (a: readonly number[], b: readonly number[], d = 0.6): boolean => Math.hypot(a[0]! - b[0]!, a[2]! - b[2]!) < d;
const STACK = [-7.65, 0, 1.15] as const;

describe('the dock and the chute', () => {
  test('X3: a shipped tool comes back in through the door; its location is restored in one hop', async () => {
    const w = await benchWorld(1, { scene: WITH_TOOL });
    const t = tape(w);
    t.run(30);
    const peg = w.part('tool-rust')!.location;
    putOn(w, t, 'tool-rust', onBelt(0.5));
    expect(t.until((e) => e.type === 'struck' && e.part === 'tool-rust', 10 * HZ)?.e).toMatchObject({ size: 'M', material: 'metal', note: 4, octave: 1 });
    expect(t.until((e) => e.type === 'shipped' && e.part === 'tool-rust', 10 * HZ)).not.toBeNull();
    // its location was written three times by the one action, and is one entry: before = where it lay
    const entry = w.undoStack().flatMap((x) => x.entries).filter((e) => e.target === 'tool-rust' && e.field === 'location');
    expect(entry.length).toBe(1);
    expect(entry[0]!.before).toEqual(peg);
    w.dispatch({ type: 'undo' });
    const ev = t.run(1);
    const u = undoneOf(ev)[0]!;
    const restores = u.restores.filter((r: Restore) => r.target === 'tool-rust');
    expect(restores.map((r) => r.field).sort()).toEqual(['location', 'marks']);
    const loc = restores.find((r) => r.field === 'location')!;
    expect(loc.from).toEqual({ at: 'shipped' });
    expect(loc.to).toEqual(peg);
    expect(near(loc.pose!.p, LINE.door, 0.01)).toBe(true); // the hop starts at the door
    expect(ev.find((e) => e.type === 'returned')).toMatchObject({ part: 'tool-rust', how: 'door' });
    // in one hop: it is exactly where it lay, at once, and it does not come back up the chute later
    expect(w.part('tool-rust')!.location).toEqual(peg);
    const pegPose = (peg as Extract<Location, { at: 'rest' }>).pose;
    expect(Math.hypot(...w.motion('tool-rust')!.pose.p.map((v, i) => v - pegPose.p[i]!))).toBeLessThan(0.01); // physics may settle it a hair
    const mark = t.events.length;
    t.run(12 * HZ);
    if (process.env.LINE_TRACE) for (const x of t.events.slice(mark)) if (JSON.stringify(x.e).includes('tool-rust')) console.log(x.step, JSON.stringify(x.e).slice(0, 300));
    expect(t.of('part.returned').filter((x) => x.e.id === 'tool-rust')).toEqual([]);
    expect(w.part('tool-rust')!.location).toEqual(peg);
    w.dispose();
  }, 60_000);

  test('left alone, a shipped tool comes back up the chute marked RETURN TO SENDER, and it is still the action that shipped it', async () => {
    const w = await benchWorld(1, { scene: WITH_TOOL });
    const t = tape(w);
    t.run(30);
    const peg = w.part('tool-rust')!.location;
    putOn(w, t, 'tool-rust', onBelt(0.5));
    t.until((e) => e.type === 'shipped' && e.part === 'tool-rust', 10 * HZ);
    expect(t.until((e) => e.type === 'returned' && e.part === 'tool-rust', 8 * HZ)?.e).toMatchObject({ how: 'chute' });
    expect(t.until((e) => e.type === 'flap', 4 * HZ)?.e).toMatchObject({ id: 'chute', part: 'tool-rust' });
    expect(t.until((e) => e.type === 'part.rested' && e.id === 'tool-rust', 6 * HZ)).not.toBeNull();
    const p = w.part('tool-rust')!;
    expect(p.marks).toEqual(['mark.shipped', 'mark.return']);
    expect(near(w.motion('tool-rust')!.pose.p, STACK, 2.2)).toBe(true); // set down by the crate stack
    const shipper = w.writer('tool-rust', 'location');
    expect(shipper).toMatch(/^t\d+$/);
    expect(w.writer('tool-rust', 'marks')).toBe(shipper);
    w.dispatch({ type: 'undo' });
    t.run(1);
    expect(w.part('tool-rust')!.location).toEqual(peg);
    expect(w.part('tool-rust')!.marks).toEqual([]);
    w.dispose();
  }, 60_000);

  test('ships Fetch: it comes back up the chute by itself, written by crew; the lever leaves it and says so', async () => {
    const w = await benchWorld();
    const t = tape(w);
    t.run(30);
    putOn(w, t, 'fetch', onBelt(0.55));
    expect(t.until((e) => e.type === 'shipped' && e.part === 'fetch', 12 * HZ)).not.toBeNull();
    expect(w.crew('fetch')!.state).toBe('held');
    expect(t.until((e) => e.type === 'returned' && e.part === 'fetch', 12 * HZ)?.e).toMatchObject({ how: 'chute' });
    expect(waitFor(w, t, 'fetch', 'rest', 6 * HZ)).toBe(true);
    expect(w.writer('fetch', 'location')).toBe('crew');
    expect(w.writer('fetch', 'marks')).toBe('crew');
    expect(w.part('fetch')!.marks).toEqual(['mark.shipped', 'mark.return']);
    // and it hurries back to its lane
    t.run(8 * HZ);
    expect(w.mode('fetch')).toBe('crew');
    expect(Math.abs(w.crew('fetch')!.z - BENCH.runner.lane.a[1])).toBeLessThan(0.01);
    // the lever: Fetch's location is no longer the shipping's to restore (Revert's card)
    let u: Extract<SimEvent, { type: 'undone' }> | undefined;
    for (let i = 0; i < 4 && !u?.restores.some((r) => r.target === 'fetch') && !u?.kept.some((k) => k.target === 'fetch'); i++) {
      w.dispatch({ type: 'undo' });
      u = undoneOf(t.run(1))[0];
    }
    expect(u?.kept).toEqual(expect.arrayContaining([{ target: 'fetch', field: 'location', writer: 'crew' }]));
    w.dispose();
  }, 60_000);

  test('a part thrown off the bench comes back up the chute, by the stack, and is the throw\'s', async () => {
    const w = await benchWorld();
    const t = tape(w);
    t.run(30);
    const home = w.part('crate-3')!.location;
    const p = w.motion('crate-3')!.pose.p;
    throwPart(w, 'crate-3', line(p, [p[0], 2.5, 4.6], 30), [0, 1, 6]);
    const out = t.until((e) => e.type === 'part.returned' && e.id === 'crate-3', 6 * HZ);
    expect(out).not.toBeNull();
    expect(t.of('flap').map((x) => x.e.part)).toContain('crate-3');
    expect(t.until((e) => e.type === 'part.rested' && e.id === 'crate-3', 6 * HZ)).not.toBeNull();
    expect(near(w.motion('crate-3')!.pose.p, STACK, 2.2)).toBe(true);
    const txn = w.writer('crate-3', 'location');
    expect(txn).toMatch(/^t\d+$/);
    w.dispatch({ type: 'undo' });
    t.run(1);
    expect(w.part('crate-3')!.location).toEqual(home);
    w.dispose();
  }, 60_000);
});

describe('the belt carries whatever is put on it', () => {
  test('reversed, a part rides back and leaves by the motor end onto the bench, still the placing\'s', async () => {
    const w = await benchWorld();
    const t = tape(w);
    t.run(30);
    w.dispatch({ type: 'turn', id: 'belt-lever', value: 0 });
    t.run(1);
    expect((w.machine('belt') as BeltView).direction).toBe('backward');
    putOn(w, t, 'crate-3', onBelt(0.3));
    expect(waitFor(w, t, 'crate-3', 'in')).toBe(true);
    const placer = w.writer('crate-3', 'location');
    // back to the motor end, then pushed off the front onto the bench
    expect(waitFor(w, t, 'crate-3', 'rest', 10 * HZ)).toBe(true);
    const at = w.motion('crate-3')!.pose.p;
    expect(at[2]).toBeGreaterThan(LINE.belt.z + LINE.belt.halfWidth);
    expect(at[0]).toBeLessThan(LINE.belt.from + 1.2);
    expect(w.writer('crate-3', 'location')).toBe(placer);
    expect((w.machine('belt') as BeltView).riding).toEqual([]);
    w.dispose();
  }, 60_000);

  test('undone mid-ride, a part never stops halfway: it goes back where it was before it was put on', async () => {
    const w = await benchWorld();
    const t = tape(w);
    t.run(30);
    const home = w.part('crate-3')!.location;
    putOn(w, t, 'crate-3', onBelt(0.1));
    expect(waitFor(w, t, 'crate-3', 'in')).toBe(true);
    t.run(2 * HZ);
    expect(w.mode('crate-3')).toBe('machine');
    w.dispatch({ type: 'undo' });
    const ev = t.run(1);
    expect(undoneOf(ev)[0]!.cancelled).toContain('belt');
    expect(w.part('crate-3')!.location).toEqual(home);
    expect((w.machine('belt') as BeltView).riding).toEqual([]);
    t.run(3 * HZ);
    expect(w.part('crate-3')!.location).toEqual(home);
    expect(t.of('struck')).toEqual([]);
    w.dispose();
  }, 60_000);

  test('a riding part can be taken off at any moment; undoing that puts it back on the belt where it was, and it still ships as the first placing\'s', async () => {
    const w = await benchWorld();
    const t = tape(w);
    t.run(30);
    putOn(w, t, 'crate-3', onBelt(0.1));
    expect(waitFor(w, t, 'crate-3', 'in')).toBe(true);
    const placer = w.writer('crate-3', 'location');
    t.run(2 * HZ);
    const x = w.motion('crate-3')!.pose.p[0];
    putOn(w, t, 'crate-3', [0, 0, 3.0 - 0.9]); // taken off, set on the bench behind it... in front of the lane
    expect(waitFor(w, t, 'crate-3', 'rest')).toBe(true);
    expect((w.machine('belt') as BeltView).riding).toEqual([]);
    w.dispatch({ type: 'undo' });
    t.run(1);
    expect(w.part('crate-3')!.location).toEqual({ at: 'in', station: 'line', mouth: 'belt' });
    expect(w.writer('crate-3', 'location')).toBe(placer);
    expect((w.machine('belt') as BeltView).riding).toEqual(['crate-3']);
    expect(Math.abs(w.motion('crate-3')!.pose.p[0] - x)).toBeLessThan(0.05);
    expect(t.until((e) => e.type === 'shipped' && e.part === 'crate-3', 12 * HZ)).not.toBeNull();
    expect(w.writer('crate-3', 'location')).toBe(placer);
    w.dispose();
  }, 60_000);
});

describe('picking Fetch up', () => {
  test('the crate it drops is the visitor\'s doing: the lever puts it back', async () => {
    const w = await benchWorld();
    const t = tape(w);
    t.run(30);
    expect(w.crew('fetch')!.carrying).toBe('crate-4');
    const home = w.part('crate-4')!.location;
    putOn(w, t, 'fetch', [0, 0, 2.6]);
    expect(waitFor(w, t, 'crate-4', 'rest')).toBe(true);
    t.run(2 * HZ);
    expect(w.part('crate-4')!.location).not.toEqual(home);
    expect(w.writer('crate-4', 'location')).toMatch(/^t\d+$/);
    for (let i = 0; i < 3; i++) {
      w.dispatch({ type: 'undo' });
      t.run(1);
    }
    expect(w.part('crate-4')!.location).toEqual(home);
    w.dispose();
  }, 60_000);
});
