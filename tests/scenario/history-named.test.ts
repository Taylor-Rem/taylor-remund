// REWRITE.md § E5 "Named cases": one deterministic test each, named after the case, against
// stand-in machines with scripted rests (tests/scenario/standins). Then the worked examples.
import { describe, expect, test } from 'vitest';
import { BELT, PHONE, SPEED, OFF_BENCH, at, bench, catchAndSet, knock, lever, loc, restPose, settle, text, throwTo, turn } from './standins/index.ts';
import type { Bench } from './standins/index.ts';
import type { Restore, SimEvent } from '../../src/workshop/sim/types.ts';
import { HISTORY_TUNING } from '../../src/workshop/sim/history.ts';

const BARE = 'bare';
const undone = (ev: readonly SimEvent[]) => ev.flatMap((e) => (e.type === 'undone' ? [e] : []));
const refusedUndo = (ev: readonly SimEvent[]) => ev.flatMap((e) => (e.type === 'undo.refused' ? [e] : []));
const effects = (ev: readonly SimEvent[]) => ev.flatMap((e) => (e.type === 'effect' ? [e.effect] : []));
const stackIds = (b: Bench) => b.world.undoStack().map((t) => t.id);
const entryOf = (b: Bench, txn: string, target: string, field: string) => b.world.undoStack().find((t) => t.id === txn)?.entries.find((e) => e.target === target && e.field === field);
/** Paint by text and wait until Patch has done it. */
function paint(b: Bench, target: string, colour: string): void {
  text(b, { kind: 'set', target, field: 'colour', value: colour, delay: 10 });
  b.run(12);
}
function textSpeed(b: Bench, value: number, delay = 10): void {
  text(b, { kind: 'set', target: BELT, field: SPEED, value, delay });
}
function undoThat(b: Bench): SimEvent[] {
  return [...text(b, { kind: 'undo-that' }), ...b.run(2)];
}

describe('§ E5 named cases', () => {
  test('consecutive-writes', () => {
    const b = bench();
    paint(b, 'crate-1', 'paint-blue'); // T1
    paint(b, 'crate-1', 'cable-red'); // T2
    expect(stackIds(b)).toEqual(['t1', 't2']);
    expect(entryOf(b, 't2', 'crate-1', 'colour')).toMatchObject({ before: 'paint-blue', previousWriter: 't1', after: 'cable-red' });
    lever(b);
    expect(b.world.part('crate-1')!.colour).toBe('paint-blue');
    expect(b.world.writer('crate-1', 'colour')).toBe('t1');
    lever(b);
    expect(b.world.part('crate-1')!.colour).toBe(BARE);
    expect(b.world.writer('crate-1', 'colour')).toBe('settled');
  });

  test('consecutive-writes-forgotten', () => {
    const b = bench();
    paint(b, 'crate-1', 'paint-blue'); // T1
    paint(b, 'crate-1', 'cable-red'); // T2
    // T1 drops off the bottom: thirty newer... T2 and twenty-nine turns of the dial
    for (let i = 0; i < HISTORY_TUNING.depth - 1; i++) turn(b, i + 2);
    expect(b.world.undoStack().length).toBe(HISTORY_TUNING.depth);
    expect(stackIds(b)).not.toContain('t1');
    expect(entryOf(b, 't2', 'crate-1', 'colour')).toMatchObject({ before: 'paint-blue', previousWriter: 'settled' });
    for (let i = 0; i < HISTORY_TUNING.depth - 1; i++) lever(b); // the turns
    expect(b.world.setting(BELT, SPEED)).toBe(1);
    lever(b); // T2
    expect(b.world.part('crate-1')!.colour).toBe('paint-blue');
    expect(b.world.writer('crate-1', 'colour')).toBe('settled');
    const ev = lever(b);
    expect(refusedUndo(ev)).toEqual([{ type: 'undo.refused', by: 'lever', reason: 'nothing', txn: null }]);
    expect(b.world.part('crate-1')!.colour).toBe('paint-blue');
    expect(b.world.writer('crate-1', 'colour')).toBe('settled');
  });

  test('targeted-undo-clean', () => {
    const b = bench();
    paint(b, 'crate-1', 'paint-blue'); // T1, by text
    throwTo(b, 'crate-3', at(4, -1)); // T2 moves another part
    settle(b);
    const moved = loc(b.world, 'crate-3');
    const t2Entry = entryOf(b, 't2', 'crate-3', 'location');
    expect(t2Entry).toBeDefined();
    const ev = undoThat(b);
    expect(undone(ev)).toMatchObject([{ txn: 't1', by: 'text', restores: [{ target: 'crate-1', field: 'colour', from: 'paint-blue', to: BARE, writer: 'settled' }] }]);
    expect(b.world.part('crate-1')!.colour).toBe(BARE);
    expect(stackIds(b)).toEqual(['t2']); // T1 gone from the middle
    expect(entryOf(b, 't2', 'crate-3', 'location')).toEqual(t2Entry);
    expect(loc(b.world, 'crate-3')).toEqual(moved);
    lever(b);
    expect(stackIds(b)).toEqual([]);
    expect(b.world.writer('crate-3', 'location')).toBe('settled');
  });

  test('targeted-undo-refused', () => {
    const b = bench();
    textSpeed(b, 2); // T1 "faster"
    b.run(12);
    turn(b, 3); // T2, the dial by hand
    expect(entryOf(b, 't2', BELT, SPEED)).toMatchObject({ before: 2, previousWriter: 't1' });
    const durable = b.world.durable();
    const stack = b.world.undoStack();
    const ev = undoThat(b);
    expect(refusedUndo(ev)).toEqual([{ type: 'undo.refused', by: 'text', reason: 'changed-since', txn: 't1' }]);
    expect(undone(ev)).toEqual([]);
    expect(b.world.durable()).toEqual(durable);
    expect(b.world.undoStack()).toEqual(stack);
    lever(b);
    expect(b.world.setting(BELT, SPEED)).toBe(2);
    expect(b.world.writer(BELT, SPEED)).toBe('t1');
    lever(b);
    expect(b.world.setting(BELT, SPEED)).toBe(1);
    expect(b.world.writer(BELT, SPEED)).toBe('settled');
  });

  test('targeted-undo-refused-by-crew', () => {
    const b = bench();
    // the platen changes anything on its tray, a robot included (§ B2 X1): T1 paints Fetch by text
    paint(b, 'fetch', 'paint-blue');
    // a stand-in crew member writes that field (D7: a robot's own fields are the crew's to write)
    b.crew.write([{ target: 'fetch', field: 'colour', after: 'paint-green' }]);
    b.run(1);
    expect(b.crew.results.at(-1)!.refused).toEqual([]);
    const durable = b.world.durable();
    const stack = b.world.undoStack();
    const ev = undoThat(b);
    expect(refusedUndo(ev)).toEqual([{ type: 'undo.refused', by: 'text', reason: 'changed-since', txn: 't1' }]);
    expect(b.world.durable()).toEqual(durable);
    expect(b.world.undoStack()).toEqual(stack);
    expect(stackIds(b)).toEqual(['t1']);
  });

  test('late-commit-dropped', () => {
    const b = bench();
    textSpeed(b, 2, 60); // T1 "faster", Patch takes a second
    turn(b, 3); // T2: the dial by hand, before Patch gets there
    const ev = b.run(70); // Patch reaches the job
    expect(b.patch.outcomes).toEqual([{ cause: 't1', result: 'refused' }]);
    expect(ev).toContainEqual({ type: 'card', by: PHONE, content: 'slip.changed-since' });
    expect(effects(ev)).toEqual([]);
    expect(b.world.setting(BELT, SPEED)).toBe(3);
    expect(b.world.writer(BELT, SPEED)).toBe('t2');
    expect(stackIds(b)).toEqual(['t2']); // T1, with nothing committed and nothing pending, left the stack
    lever(b);
    expect(b.world.setting(BELT, SPEED)).toBe(1); // from before both
    expect(b.world.writer(BELT, SPEED)).toBe('settled');
  });

  test('window-handover', () => {
    const b = bench();
    const start = b.world.durable();
    const before = { 1: restPose(b.world, 'crate-1'), 2: restPose(b.world, 'crate-2'), 3: restPose(b.world, 'crate-3') };
    throwTo(b, 'crate-3', at(-1, 1), 20); // T1: the throw
    knock(b, 'crate-2', at(-4, 1.5), 10); // a part that comes to rest quickly
    knock(b, 'crate-1', at(-5, 2), 120); // and one that is still moving later
    b.run(25);
    expect(b.world.writer('crate-3', 'location')).toBe('t1');
    expect(b.world.writer('crate-2', 'location')).toBe('t1');
    expect(b.world.motion('crate-1')!.awake).toBe(true);
    const t1Rest = loc(b.world, 'crate-3');
    throwTo(b, 'crate-3', at(1, 1.5), 20); // T2 while crate-1 still moves
    settle(b);
    expect(entryOf(b, 't1', 'crate-1', 'location')).toBeUndefined();
    expect(entryOf(b, 't2', 'crate-1', 'location')).toMatchObject({ before: { at: 'rest', pose: before[1] }, previousWriter: 'settled' });
    expect(entryOf(b, 't1', 'crate-2', 'location')).toMatchObject({ before: { at: 'rest', pose: before[2] } });
    expect(entryOf(b, 't2', 'crate-3', 'location')).toMatchObject({ previousWriter: 't1' });
    lever(b);
    expect(loc(b.world, 'crate-1')).toEqual({ at: 'rest', pose: before[1] });
    expect(loc(b.world, 'crate-3')).toEqual(t1Rest);
    lever(b);
    expect(b.world.durable()).toEqual(start);
    expect(b.world.motion('crate-3')!.pose).toEqual(before[3]);
  });

  test('window-claim-by-grab', () => {
    const b = bench();
    const start = b.world.durable();
    const before2 = restPose(b.world, 'crate-2');
    throwTo(b, 'crate-3', at(-1, 1), 20); // T1
    knock(b, 'crate-2', at(-6, 2), 120); // falling
    b.run(25);
    expect(b.world.motion('crate-2')!.awake).toBe(true);
    catchAndSet(b, 'crate-2', [2, 0, -1]); // caught mid-fall, set down: T2
    settle(b);
    expect(entryOf(b, 't1', 'crate-2', 'location')).toBeUndefined();
    expect(entryOf(b, 't2', 'crate-2', 'location')).toMatchObject({ before: { at: 'rest', pose: before2 } });
    lever(b);
    expect(loc(b.world, 'crate-2')).toEqual({ at: 'rest', pose: before2 });
    lever(b);
    expect(b.world.durable()).toEqual(start);
  });

  test('open-transaction-undo', () => {
    const b = bench();
    const start = b.world.durable();
    textSpeed(b, 2, 120); // T sends a text
    expect(b.world.undoStack()).toMatchObject([{ id: 't1', kind: 'text', entries: [], pending: [PHONE] }]);
    const ev = lever(b); // before the commit
    expect(undone(ev)).toEqual([{ type: 'undone', txn: 't1', action: 'text', by: 'lever', restores: [], kept: [], cancelled: [PHONE] }]);
    expect(b.patch.outcomes).toEqual([{ cause: 't1', result: 'cancelled' }]);
    expect(b.patch.queue()).toEqual([]);
    const later = b.run(200);
    expect(effects(later)).toEqual([]); // the job is cancelled: nothing is ever written
    expect(b.world.durable()).toEqual(start);
    expect(stackIds(b)).toEqual([]);
  });

  test('put-away-forgets', () => {
    for (const withEarlier of [true, false]) {
      const b = bench();
      if (withEarlier) turn(b, 2); // T0, the transaction before T
      paint(b, 'crate-1', 'paint-blue'); // T paints a crate
      b.revert.putAway('crate-1', { at: 'rest', pose: at(8, -4.5) });
      const ev = b.run(1);
      expect(ev).toContainEqual({ type: 'put-away', id: 'crate-1' });
      for (const t of b.world.undoStack()) for (const e of t.entries) expect(e.target).not.toBe('crate-1');
      expect(b.world.writer('crate-1', 'colour')).toBe('settled');
      expect(b.world.touched('crate-1')).toBe(false);
      const pull = lever(b);
      expect(b.world.part('crate-1')!.colour).toBe('paint-blue');
      if (withEarlier) {
        expect(undone(pull)).toMatchObject([{ txn: 't1', restores: [{ target: BELT, field: SPEED, to: 1 }] }]);
      } else {
        expect(refusedUndo(pull)).toEqual([{ type: 'undo.refused', by: 'lever', reason: 'nothing', txn: null }]);
      }
    }
  });

  test('button-bracket', () => {
    const b = bench();
    throwTo(b, 'crate-3', at(-1, 1)); // actions
    settle(b);
    turn(b, 2);
    const durable = b.world.durable();
    const stack = b.world.undoStack();
    b.world.dispatch({ type: 'press', id: 'button' });
    b.run(1);
    expect(b.world.bracketed).toBe(true);
    b.world.dispatch({ type: 'undo' }); // handles do not respond during a rung
    for (let i = 0; i < 600 && b.world.bracketed; i++) b.run(1);
    expect(b.world.bracketed).toBe(false);
    expect(b.world.durable()).toEqual(durable);
    expect(b.world.undoStack()).toEqual(stack);
    const ev = lever(b);
    expect(undone(ev)).toMatchObject([{ txn: 't2', restores: [{ target: BELT, field: SPEED, from: 2, to: 1 }] }]);
    expect(b.world.writer('crate-3', 'location')).toBe('t1');
  });
});

describe('§ E5 worked examples', () => {
  test('"make it blue", then at once drag a different crate away: the lever takes the drag first, then the paint', () => {
    const b = bench();
    text(b, { kind: 'set', target: 'crate-1', field: 'colour', value: 'paint-blue', delay: 120 }); // T1: nothing yet
    throwTo(b, 'crate-3', at(3, -1)); // T2: the second crate
    b.run(40);
    expect(entryOf(b, 't1', 'crate-1', 'colour')).toBeUndefined();
    expect(entryOf(b, 't2', 'crate-3', 'location')).toBeDefined();
    b.run(100); // two seconds later Patch commits: T1 gains the colour
    expect(entryOf(b, 't1', 'crate-1', 'colour')).toMatchObject({ before: BARE, after: 'paint-blue' });
    let ev = lever(b);
    expect(undone(ev)[0]?.txn).toBe('t2');
    ev = lever(b);
    expect(undone(ev)[0]).toMatchObject({ txn: 't1', restores: [{ target: 'crate-1', field: 'colour', from: 'paint-blue', to: BARE }] });
  });

  test('throw a crate into the stack: all hop back, last moved first, with the pose each was flying from', () => {
    const b = bench();
    const start = b.world.durable();
    throwTo(b, 'crate-4', at(-3, 0.5), 20); // taken out of Fetch's hands and thrown
    knock(b, 'crate-3', at(-2, 1), 10);
    knock(b, 'crate-2', at(-4, 1), 40);
    knock(b, 'crate-1', at(-3.5, 1.8), 60);
    settle(b);
    const t = b.world.undoStack().at(-1)!;
    expect(t.entries.map((e) => e.target).sort()).toEqual(['crate-1', 'crate-2', 'crate-3', 'crate-4']);
    const ev = lever(b);
    const u = undone(ev)[0]!;
    expect(u.restores.map((r) => r.target)).toEqual(['crate-1', 'crate-2', 'crate-4', 'crate-3']); // rested last, first back
    for (const r of u.restores) expect(r.pose).toEqual((r.from as { pose: unknown }).pose);
    expect(b.world.durable()).toEqual(start);
  });

  test('a tool on the belt rides, ships, and comes back as one entry; undone mid-ride it never stops halfway', () => {
    const b = bench();
    const home = loc(b.world, 'crate-3');
    throwTo(b, 'crate-3', at(7, -1)); // into the carrier's mouth
    b.run(40);
    expect(loc(b.world, 'crate-3')).toEqual({ at: 'in', station: 'line', mouth: BELT });
    b.run(100);
    expect(loc(b.world, 'crate-3')).toEqual({ at: 'shipped' });
    const t = b.world.undoStack().at(-1)!;
    expect(t.entries.filter((e) => e.field === 'location')).toMatchObject([{ before: home, after: { at: 'shipped' } }]);
    const u = undone(lever(b))[0]!;
    expect(u.restores).toMatchObject([
      { target: 'crate-3', field: 'marks', from: ['SHIPPED'], to: [] },
      { target: 'crate-3', field: 'location', from: { at: 'shipped' }, to: home },
    ]);
    expect(loc(b.world, 'crate-3')).toEqual(home);
    b.run(200);
    expect(loc(b.world, 'crate-3')).toEqual(home); // not taken in again

    // mid-ride: the ride is cancelled and the part is home at once
    throwTo(b, 'crate-3', at(7, -1));
    b.run(60);
    expect(b.belt.riding()).toHaveLength(1);
    const v = undone(lever(b))[0]!;
    expect(v.cancelled).toEqual([BELT]);
    expect(b.belt.riding()).toEqual([]);
    expect(loc(b.world, 'crate-3')).toEqual(home);
    expect(effects(b.run(200))).toEqual([]);
  });

  test('put a crate on a stopped belt; a minute later start it: the shipment belongs to putting the crate down', () => {
    const b = bench();
    turn(b, 0); // T1: stop the belt
    throwTo(b, 'crate-3', at(7, -1)); // T2: put the crate down
    b.run(3600);
    expect(loc(b.world, 'crate-3')).toEqual({ at: 'in', station: 'line', mouth: BELT });
    turn(b, 1); // T3: start it
    const ev = b.run(120);
    expect(effects(ev).filter((e) => e.target === 'crate-3').map((e) => [e.field, e.cause])).toEqual([
      ['location', 't2'],
      ['marks', 't2'],
    ]);
    expect(undone(lever(b))[0]).toMatchObject({ txn: 't3' });
    expect(b.world.setting(BELT, SPEED)).toBe(0);
    expect(undone(lever(b))[0]).toMatchObject({ txn: 't2' });
    expect(loc(b.world, 'crate-3').at).toBe('rest');
    expect(undone(lever(b))[0]).toMatchObject({ txn: 't1' });
  });

  test('ship Fetch; it comes back by itself (crew): the lever leaves its location and says so', () => {
    const b = bench();
    throwTo(b, 'fetch', at(7.5, -1, 0, 0.5)); // T
    b.run(200);
    expect(loc(b.world, 'fetch')).toEqual({ at: 'shipped' });
    // ten seconds later Fetch comes back up the chute by itself
    b.crew.write([{ target: 'fetch', field: 'location', after: { at: 'rest', pose: at(-8, 3, 0, 0.5) } }]);
    b.run(1);
    expect(b.world.writer('fetch', 'location')).toBe('crew');
    const u = undone(lever(b))[0]!;
    expect(u.kept).toEqual([{ target: 'fetch', field: 'location', writer: 'crew' }]);
    // (picking Fetch up made it drop its crate: that is the visitor's doing, so the crate is this action's too)
    expect(u.restores.filter((r: Restore) => r.target === 'fetch').map((r: Restore) => r.field)).toEqual(['marks']);
    expect(loc(b.world, 'fetch')).toEqual({ at: 'rest', pose: at(-8, 3, 0, 0.5) });
  });

  test('the lever while Patch is still reaching for the drawer: the job is cancelled, nothing changes', () => {
    const b = bench();
    const start = b.world.durable();
    text(b, { kind: 'set', target: 'crate-1', field: 'label', value: 'TAYLOR', delay: 90 });
    b.run(30);
    const u = undone(lever(b))[0]!;
    expect(u).toMatchObject({ restores: [], cancelled: [PHONE] });
    b.run(200);
    expect(b.world.durable()).toEqual(start);
  });

  test('a part thrown off the bench comes back up the chute charged to the throw, and the lever puts it back', () => {
    const b = bench();
    const home = loc(b.world, 'crate-3');
    throwTo(b, 'crate-3', OFF_BENCH, 20);
    const ev = b.run(400);
    expect(ev).toContainEqual({ type: 'part.returned', id: 'crate-3' });
    expect(b.world.writer('crate-3', 'location')).toBe('t1');
    lever(b);
    expect(loc(b.world, 'crate-3')).toEqual(home);
    expect(b.world.writer('crate-3', 'location')).toBe('settled');
  });
});
