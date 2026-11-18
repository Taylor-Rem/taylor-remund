// The history module alone (REWRITE.md § E5), on a bare store with a small funnel that does what
// the world's does, so each rule and each decision written in history.ts is pinned on its own.
// The named cases of § E5 run against the whole world in tests/scenario/history-named.test.ts.
import { describe, expect, test } from 'vitest';
import { Store } from '../../../src/workshop/sim/store.ts';
import { createHistory, HISTORY_TUNING } from '../../../src/workshop/sim/history.ts';
import type { Change, HistoryHooks, Recorded } from '../../../src/workshop/sim/history.ts';
import type { CommitResult } from '../../../src/workshop/sim/context.ts';
import type { Cause, PartKind } from '../../../src/workshop/sim/types.ts';
import { steps } from '../../../src/workshop/sim/clock.ts';
import { stubWorld, run } from './helpers.ts';

const HOME = { at: 'rest', pose: { p: [0, 0.4, 0], q: [0, 0, 0, 1] } } as const;
const AWAY = { at: 'rest', pose: { p: [3, 0.4, 1], q: [0, 0, 0, 1] } } as const;

function ledger(o: { play?: boolean } = {}) {
  const store = new Store();
  store.define('crate', 'colour', 'bare');
  store.define('crate', 'location', HOME);
  store.define('other', 'location', HOME);
  store.define('fetch', 'colour', 'tape-yellow');
  store.define('belt', 'speed', 1);
  const kinds: Record<string, PartKind> = { crate: 'crate', other: 'crate', fetch: 'robot' };
  const touched = new Set<string>();
  let play = o.play ?? true;
  let step = 0;
  const h: HistoryHooks = createHistory();
  const commit = (changes: readonly Change[], cause: Cause): CommitResult => {
    const refused: Change[] = [];
    const rec: Recorded[] = [];
    for (const c of changes) {
      const slot = store.slot(c.target, c.field)!;
      if (!h.admit(c, cause, slot.writer)) refused.push(c);
      else rec.push({ effect: { target: c.target, field: c.field, before: slot.value, after: c.after, cause }, previousWriter: slot.writer });
    }
    for (const r of rec) {
      store.write(r.effect.target, r.effect.field, r.effect.after, cause);
      if (cause !== 'crew' && cause !== 'system' && kinds[r.effect.target]) touched.add(r.effect.target);
    }
    if (rec.length) h.recorded(rec, step);
    return { effects: rec.map((r) => r.effect), refused };
  };
  h.bind({ store, commit, kindOf: (id) => kinds[id], touched: (id) => touched.has(id), playMode: () => play });
  return {
    store,
    h,
    commit,
    touched,
    set play(v: boolean) {
      play = v;
    },
    /** End this step and begin the next. */
    tick(n = 1) {
      for (let i = 0; i < n; i++) {
        h.endStep(step);
        step += 1;
      }
    },
    get step() {
      return step;
    },
  };
}

describe('history: transactions, entries, writers (rules 3, 6, 8)', () => {
  test('one entry per field; later writes by the same transaction only move `after`; the lever restores what it found', () => {
    const L = ledger();
    const t = L.h.open('turn', 'belt', L.step);
    L.commit([{ target: 'belt', field: 'speed', after: 2 }], t);
    L.commit([{ target: 'belt', field: 'speed', after: 3 }], t);
    expect(L.h.stack()[0]!.entries).toMatchObject([{ target: 'belt', field: 'speed', before: 1, previousWriter: 'settled', after: 3 }]);
    const out = L.h.undo({ by: 'lever' }, L.step);
    expect(out).toMatchObject({ ok: true, undone: { txn: t, restores: [{ target: 'belt', field: 'speed', from: 3, to: 1, writer: 'settled' }] } });
    expect(L.store.slot('belt', 'speed')).toEqual({ value: 1, writer: 'settled' });
    expect(L.h.stack()).toEqual([]);
  });

  test('D1: a transaction writing again after the crew wrote in between re-bases its entry, so undo gives back the crew\'s value', () => {
    const L = ledger();
    const t = L.h.open('text', 'jack-platen', L.step);
    L.commit([{ target: 'fetch', field: 'colour', after: 'paint-blue' }], t);
    L.commit([{ target: 'fetch', field: 'colour', after: 'paint-green' }], 'crew'); // a robot's own field: the crew may
    expect(L.commit([{ target: 'fetch', field: 'colour', after: 'cable-red' }], t).refused).toEqual([]);
    expect(L.h.stack()[0]!.entries).toMatchObject([{ before: 'paint-green', previousWriter: 'crew', after: 'cable-red' }]);
    L.h.undo({ by: 'lever' }, L.step);
    expect(L.store.slot('fetch', 'colour')).toEqual({ value: 'paint-green', writer: 'crew' });
  });

  test('rule 8: a field the crew or the system wrote since is left as it is, and reported as kept', () => {
    const L = ledger();
    const t = L.h.open('release', 'fetch', L.step);
    L.commit([{ target: 'fetch', field: 'colour', after: 'paint-blue' }], t);
    L.commit([{ target: 'belt', field: 'speed', after: 2 }], t);
    L.commit([{ target: 'fetch', field: 'colour', after: 'paint-green' }], 'crew');
    const out = L.h.undo({ by: 'lever' }, L.step);
    expect(out.ok && out.undone.kept).toEqual([{ target: 'fetch', field: 'colour', writer: 'crew' }]);
    expect(out.ok && out.undone.restores.map((r) => r.field)).toEqual(['speed']);
    expect(L.store.slot('fetch', 'colour')).toEqual({ value: 'paint-green', writer: 'crew' });
  });

  test('restores come most recent first', () => {
    const L = ledger();
    const t = L.h.open('release', 'crate', L.step);
    L.commit([{ target: 'other', field: 'location', after: AWAY }], t);
    L.commit([{ target: 'crate', field: 'location', after: AWAY }], t);
    L.commit([{ target: 'other', field: 'location', after: HOME }], t); // moved again: now the latest
    const out = L.h.undo({ by: 'lever' }, L.step);
    expect(out.ok && out.undone.restores.map((r) => r.target)).toEqual(['other', 'crate']);
  });

  test('the lever on an empty stack reports nothing', () => {
    const L = ledger();
    expect(L.h.undo({ by: 'lever' }, 0)).toEqual({ ok: false, reason: 'nothing', txn: null });
    expect(L.h.undo({ by: 'text', jack: 'jack-lamp' }, 0)).toEqual({ ok: false, reason: 'nothing', txn: null });
  });

  test('"undo that" picks the newest instruction through that jack, not through another, and not a handle', () => {
    const L = ledger();
    const a = L.h.open('text', 'jack-lamp', L.step);
    L.commit([{ target: 'crate', field: 'colour', after: 'paint-blue' }], a);
    const b = L.h.open('text', 'jack-storefront', L.step);
    L.commit([{ target: 'fetch', field: 'colour', after: 'paint-blue' }], b);
    const c = L.h.open('turn', 'belt', L.step);
    L.commit([{ target: 'belt', field: 'speed', after: 3 }], c);
    const out = L.h.undo({ by: 'text', jack: 'jack-lamp' }, L.step);
    expect(out.ok && out.undone.txn).toBe(a);
    expect(L.h.stack().map((t) => t.id)).toEqual([b, c]);
  });
});

describe('history: writes in order, causes that are gone (rule 7, D4, D6)', () => {
  test('rule 7: a change whose field a newer transaction has written is refused', () => {
    const L = ledger();
    const t1 = L.h.open('text', 'jack-lamp', L.step);
    const t2 = L.h.open('turn', 'belt', L.step);
    L.commit([{ target: 'belt', field: 'speed', after: 3 }], t2);
    expect(L.commit([{ target: 'belt', field: 'speed', after: 2 }], t1).refused).toHaveLength(1);
    expect(L.store.slot('belt', 'speed')).toEqual({ value: 3, writer: t2 });
  });

  test('D6: a transaction id that was never opened throws', () => {
    const L = ledger();
    expect(() => L.commit([{ target: 'belt', field: 'speed', after: 2 }], 't7')).toThrow(/never opened/);
    expect(() => L.h.work('t7', 'patch', () => {})).toThrow(/never opened/);
  });

  test('D4: once undone, a transaction commits nothing, and work begun under it is born inactive', () => {
    const L = ledger();
    const t = L.h.open('text', 'jack-lamp', L.step);
    let aborted = 0;
    const job = L.h.work(t, 'patch', () => aborted++);
    L.h.undo({ by: 'lever' }, L.step);
    expect(aborted).toBe(1);
    expect(job.active).toBe(false);
    expect(job.commit([{ target: 'belt', field: 'speed', after: 2 }])).toEqual({ effects: [], refused: [{ target: 'belt', field: 'speed', after: 2 }] });
    expect(L.commit([{ target: 'belt', field: 'speed', after: 2 }], t).refused).toHaveLength(1);
    const late = L.h.work(t, 'patch', () => {});
    expect(late.active).toBe(false);
    expect(L.store.slot('belt', 'speed')).toEqual({ value: 1, writer: 'settled' });
  });

  test('rule 10: an abort runs with the transaction already off the stack, so it cannot commit under it', () => {
    const L = ledger();
    const t = L.h.open('text', 'jack-lamp', L.step);
    let res: CommitResult | null = null;
    L.h.work(t, 'patch', () => {
      res = L.commit([{ target: 'belt', field: 'speed', after: 9 }], t);
    });
    L.h.undo({ by: 'lever' }, L.step);
    expect(res!.refused).toHaveLength(1);
    expect(L.store.get('belt', 'speed')).toBe(1);
  });
});

describe('history: forgetting, pruning, putting away (rule 14)', () => {
  test('the thirty-first transaction forgets the oldest: its writes and previous-writer marks become settled', () => {
    const L = ledger();
    const t1 = L.h.open('text', 'jack-lamp', L.step);
    L.commit([{ target: 'crate', field: 'colour', after: 'paint-blue' }], t1);
    L.commit([{ target: 'belt', field: 'speed', after: 2 }], t1);
    const t2 = L.h.open('turn', 'belt', L.step);
    L.commit([{ target: 'belt', field: 'speed', after: 3 }], t2);
    for (let i = 0; i < HISTORY_TUNING.depth - 1; i++) {
      const t = L.h.open('release', 'other', L.step);
      L.commit([{ target: 'other', field: 'location', after: i % 2 ? HOME : AWAY }], t);
    }
    expect(L.h.stack()).toHaveLength(HISTORY_TUNING.depth);
    expect(L.h.stack()[0]!.id).toBe(t2);
    expect(L.store.writer('crate', 'colour')).toBe('settled');
    expect(L.h.stack()[0]!.entries[0]).toMatchObject({ before: 2, previousWriter: 'settled' });
  });

  test('D4: work under a transaction that is then forgotten still completes, as `system`', () => {
    const L = ledger();
    const t1 = L.h.open('text', 'jack-lamp', L.step);
    const job = L.h.work(t1, 'patch', () => {});
    for (let i = 0; i < HISTORY_TUNING.depth; i++) {
      const t = L.h.open('turn', 'belt', L.step);
      L.commit([{ target: 'belt', field: 'speed', after: i + 2 }], t);
    }
    expect(L.h.stack().map((t) => t.id)).not.toContain(t1);
    expect(job.commit([{ target: 'crate', field: 'colour', after: 'paint-blue' }]).effects).toMatchObject([{ cause: 'system' }]);
    expect(L.store.writer('crate', 'colour')).toBe('system');
  });

  test('an empty transaction leaves the stack at the end of its step; pending work or an open window keeps it', () => {
    const L = ledger();
    const empty = L.h.open('plug', 'cord', L.step);
    const pending = L.h.open('text', 'jack-lamp', L.step);
    const job = L.h.work(pending, 'patch', () => {});
    L.tick();
    expect(L.h.stack().map((t) => t.id)).toEqual([pending]);
    expect(empty).not.toBe(pending);
    job.done();
    L.tick();
    expect(L.h.stack()).toEqual([]);
    const thrown = L.h.open('release', 'crate', L.step);
    L.h.claim('crate', thrown, L.step);
    L.tick(10);
    expect(L.h.stack()).toMatchObject([{ id: thrown, moving: ['crate'] }]);
    expect(L.h.chargeRest('crate', L.step)).toBe(thrown);
    L.tick();
    expect(L.h.stack()).toEqual([]); // it came to rest where it was: nothing recorded, nothing left
  });

  test('putting a part away deletes every entry about it and settles its writers; an emptied transaction leaves', () => {
    const L = ledger();
    const t1 = L.h.open('release', 'crate', L.step);
    L.commit([{ target: 'crate', field: 'location', after: AWAY }], t1);
    L.commit([{ target: 'other', field: 'location', after: AWAY }], t1);
    const t2 = L.h.open('text', 'jack-platen', L.step);
    L.commit([{ target: 'crate', field: 'colour', after: 'paint-blue' }], t2);
    L.h.putAway('crate');
    expect(L.h.stack().flatMap((t) => t.entries.map((e) => e.target))).toEqual(['other']);
    expect(L.store.writer('crate', 'colour')).toBe('settled');
    expect(L.store.writer('crate', 'location')).toBe('settled');
    L.tick();
    expect(L.h.stack().map((t) => t.id)).toEqual([t1]);
  });
});

describe('history: who is charged (rule 4)', () => {
  test('the window: the released part and whatever it disturbs rest charged to the release; a grab takes a part out', () => {
    const L = ledger();
    const t = L.h.open('release', 'crate', L.step);
    L.h.claim('crate', t, L.step);
    L.h.disturbed('other');
    expect(L.h.chargeMachine('other')).toBe(t);
    L.h.take('other');
    expect(L.h.chargeRest('other', L.step)).toBe('system');
    expect(L.h.chargeRest('crate', L.step)).toBe(t);
  });

  test('D2: any new action closes the older window; what still moves passes to it', () => {
    const L = ledger();
    const t1 = L.h.open('release', 'crate', L.step);
    L.h.claim('crate', t1, L.step);
    L.h.disturbed('other');
    expect(L.h.chargeRest('crate', L.step)).toBe(t1);
    const t2 = L.h.open('turn', 'belt', L.step);
    expect(L.h.stack().find((t) => t.id === t2)!.moving).toEqual(['other']);
    expect(L.h.chargeRest('other', L.step)).toBe(t2);
  });

  test('D3: a window closes after six seconds; a straggler rests charged to the world\'s fallback, or system', () => {
    const L = ledger();
    const t = L.h.open('release', 'crate', L.step);
    L.h.claim('crate', t, L.step);
    L.tick(steps(HISTORY_TUNING.windowSeconds) + 1);
    expect(L.h.chargeRest('crate', L.step)).toBe('system');
    expect(L.h.chargeRest('crate', L.step, 'crew')).toBe('crew');
  });

  test('a machine\'s effect on a part is charged to whoever last placed it, while that is on the stack', () => {
    const L = ledger();
    expect(L.h.chargeMachine('crate')).toBe('system');
    const t = L.h.open('place', 'crate', L.step);
    L.commit([{ target: 'crate', field: 'location', after: AWAY }], t);
    expect(L.h.chargeMachine('crate')).toBe(t);
    L.h.undo({ by: 'lever' }, L.step);
    expect(L.h.chargeMachine('crate')).toBe('system');
    L.commit([{ target: 'other', field: 'location', after: AWAY }], 'crew'); // Fetch put a fresh crate down
    expect(L.h.chargeMachine('other')).toBe('crew');
  });
});

describe('history: single writers (rule 5) and the Button (rule 13)', () => {
  test('in play mode the crew is refused a setting and a part the visitor touched, but not its own robot', () => {
    const L = ledger();
    const t = L.h.open('release', 'crate', L.step);
    L.commit([{ target: 'crate', field: 'location', after: AWAY }], t);
    expect(L.commit([{ target: 'belt', field: 'speed', after: 3 }], 'crew').refused).toHaveLength(1);
    expect(L.commit([{ target: 'crate', field: 'colour', after: 'paint-blue' }], 'crew').refused).toHaveLength(1);
    expect(L.commit([{ target: 'other', field: 'location', after: AWAY }], 'crew').refused).toEqual([]);
    L.touched.add('fetch');
    expect(L.commit([{ target: 'fetch', field: 'colour', after: 'paint-blue' }], 'crew').refused).toEqual([]);
    expect(L.commit([{ target: 'belt', field: 'speed', after: 3 }], 'system').refused).toEqual([]);
  });

  test('in attract mode the crew may demonstrate anything', () => {
    const L = ledger({ play: false });
    expect(L.commit([{ target: 'belt', field: 'speed', after: 3 }], 'crew').refused).toEqual([]);
  });

  test('while a rung is bracketed the stack is frozen: nothing opens, nothing is undone, windows wait', () => {
    const L = ledger();
    const t = L.h.open('release', 'crate', L.step);
    L.h.claim('crate', t, L.step);
    L.h.bracket(true);
    expect(() => L.h.open('turn', 'belt', L.step)).toThrow(/bracketed/);
    expect(L.h.undo({ by: 'lever' }, L.step)).toEqual({ ok: false, reason: 'frozen', txn: null });
    L.tick(steps(HISTORY_TUNING.windowSeconds) * 2);
    L.h.bracket(false);
    expect(L.h.chargeRest('crate', L.step)).toBe(t);
  });
});

describe('the world with the history', () => {
  test('a thrown part caught by the lever mid-flight is recalled to where it rested, nothing durable changes', () => {
    const { world, physics } = stubWorld();
    const home = world.part('crate-3')!.location;
    world.dispatch({ type: 'grab', id: 'crate-3', grip: world.motion('crate-3')!.pose.p });
    world.dispatch({ type: 'carry', target: [0, 2, 2] });
    run(world, 1);
    physics.land('crate-3', { p: [4, 0.3, 2], q: [0, 0, 0, 1] }, 60);
    world.dispatch({ type: 'release', velocity: [3, 0, 0] });
    run(world, 10);
    const flying = world.motion('crate-3')!.pose;
    world.dispatch({ type: 'undo' });
    const ev = run(world, 1);
    expect(ev).toContainEqual({ type: 'undone', txn: 't1', action: 'release', by: 'lever', restores: [{ target: 'crate-3', field: 'location', from: home, to: home, writer: 'settled', pose: flying }], kept: [], cancelled: [] });
    expect(world.motion('crate-3')!.pose).toEqual(home.at === 'rest' ? home.pose : null);
    expect(run(world, 120).filter((e) => e.type === 'effect')).toEqual([]);
    expect(world.undoStack()).toEqual([]);
  });

  test('the cord: undoing a plug puts it back in exactly the jack it came from', () => {
    const { world } = stubWorld();
    world.dispatch({ type: 'unplug', cord: 'cord' });
    world.dispatch({ type: 'plug', cord: 'cord', jack: 'jack-lamp' });
    run(world, 1);
    world.dispatch({ type: 'undo' });
    const ev = run(world, 1);
    expect(ev).toContainEqual(expect.objectContaining({ type: 'undone', restores: [{ target: 'cord', field: 'jack', from: 'jack-lamp', to: 'jack-storefront', writer: 'settled' }] }));
    expect(world.cord('cord')?.jack).toBe('jack-storefront');
  });

  test('the lever does not respond while a rung plays, and counts as the visitor\'s first action', () => {
    const { world } = stubWorld();
    world.dispatch({ type: 'undo' });
    const ev = run(world, 1);
    expect(ev).toContainEqual({ type: 'undo.refused', by: 'lever', reason: 'nothing', txn: null });
    expect(world.playMode).toBe(true);
    world.dispatch({ type: 'press', id: 'button' });
    run(world, 1);
    world.dispatch({ type: 'undo' });
    expect(run(world, 1).some((e) => e.type === 'undo.refused' || e.type === 'undone')).toBe(false);
  });

  test('"Reset the workshop": everything back to its start, settled, the stack empty, pending work cancelled', () => {
    const { world, physics } = stubWorld();
    const start = world.durable();
    world.dispatch({ type: 'unplug', cord: 'cord' });
    world.dispatch({ type: 'plug', cord: 'cord', jack: 'jack-lamp' });
    world.dispatch({ type: 'grab', id: 'crate-1', grip: world.motion('crate-1')!.pose.p });
    run(world, 1);
    physics.land('crate-1', { p: [5, 0.4, 1], q: [0, 0, 0, 1] }, 20);
    world.dispatch({ type: 'release', velocity: [2, 0, 0] });
    run(world, 60);
    expect(world.undoStack()).toHaveLength(2);
    world.dispatch({ type: 'reset' });
    const ev = run(world, 1);
    const reset = ev.find((e) => e.type === 'reset');
    expect(reset && reset.type === 'reset' && reset.restores.map((r) => `${r.target}.${r.field}`).sort()).toEqual(['cord.jack', 'crate-1.location']);
    expect(world.durable()).toEqual(start);
    expect(world.undoStack()).toEqual([]);
    expect(world.touched('crate-1')).toBe(false);
    const home = world.part('crate-1')!.location;
    expect(home.at === 'rest' && world.motion('crate-1')!.pose).toEqual(home.at === 'rest' ? home.pose : null);
  });
});
