import { describe, expect, test } from 'vitest';
import { stubWorld, run } from './helpers.ts';
import { p1History } from '../../../src/workshop/sim/history.ts';
import type { HistoryHooks, Recorded } from '../../../src/workshop/sim/history.ts';
import type { Effect } from '../../../src/workshop/sim/types.ts';

const effects = (events: ReturnType<typeof run>): Effect[] => events.flatMap((e) => (e.type === 'effect' ? [e.effect] : []));

describe('commit: the single funnel for durable change (§ E5 rules 1, 2, 6)', () => {
  test('starting state: every field is settled', () => {
    const { world } = stubWorld();
    const d = world.durable();
    expect(d.length).toBeGreaterThan(0);
    for (const f of d) expect(f.writer).toBe('settled');
    expect(world.setting('cord', 'jack')).toBe('jack-storefront');
  });

  test('applies a batch at once, emits one effect per field with before, after and cause, and records the writer', () => {
    const { world } = stubWorld(1, { history: p1History() }); // the funnel alone: these causes were never opened by an action
    run(world, 1);
    const res = world.commit(
      [
        { target: 'crate-1', field: 'colour', after: 'paint-blue' },
        { target: 'crate-1', field: 'label', after: 'HELLO' },
      ],
      't1',
    );
    expect(res.refused).toEqual([]);
    expect(res.effects).toEqual([
      { target: 'crate-1', field: 'colour', before: 'bare', after: 'paint-blue', cause: 't1' },
      { target: 'crate-1', field: 'label', before: '', after: 'HELLO', cause: 't1' },
    ]);
    expect(world.part('crate-1')?.colour).toBe('paint-blue');
    expect(world.writer('crate-1', 'colour')).toBe('t1');
    expect(world.writer('crate-1', 'kind')).toBe('settled');
    expect(effects(world.drainEvents())).toEqual(res.effects);
  });

  test('atomic: one invalid change in a batch applies nothing and throws', () => {
    const { world } = stubWorld();
    const before = world.durable();
    expect(() =>
      world.commit(
        [
          { target: 'crate-1', field: 'colour', after: 'paint-blue' },
          { target: 'crate-1', field: 'label', after: 'MUCH TOO LONG FOR LABEL TAPE' },
        ],
        't1',
      ),
    ).toThrow(/invalid/);
    expect(() => world.commit([{ target: 'crate-1', field: 'colour', after: 'paint-blue' }, { target: 'nope', field: 'colour', after: 'x' }], 't1')).toThrow(/not a durable field/);
    expect(() => world.commit([{ target: 'cord', field: 'jack', after: 'jack-elsewhere' }], 't1')).toThrow(/invalid/);
    expect(() => world.commit([{ target: 'crate-1', field: 'location', after: { at: 'rest', pose: { p: [0, Number.NaN, 0], q: [0, 0, 0, 1] } } }], 't1')).toThrow(/invalid/);
    expect(world.durable()).toEqual(before);
    expect(effects(world.drainEvents())).toEqual([]);
  });

  test('one entry per field: repeated writes in a batch merge, before is the original', () => {
    const { world } = stubWorld(1, { history: p1History() }); // the funnel alone: these causes were never opened by an action
    const r = world.commit(
      [
        { target: 'crate-2', field: 'colour', after: 'paint-blue' },
        { target: 'crate-2', field: 'colour', after: 'cable-red' },
      ],
      't3',
    );
    expect(r.effects).toEqual([{ target: 'crate-2', field: 'colour', before: 'bare', after: 'cable-red', cause: 't3' }]);
  });

  test('consecutive writes keep the writer chain (rule 6/8 worked example)', () => {
    const recorded: Recorded[][] = [];
    const history: HistoryHooks = { ...p1History(), recorded: (r) => recorded.push([...r]) };
    const { world } = stubWorld(1, { history });
    world.commit([{ target: 'crate-1', field: 'colour', after: 'paint-blue' }], 't1');
    world.commit([{ target: 'crate-1', field: 'colour', after: 'cable-red' }], 't2');
    expect(recorded.map((r) => r.map((x) => [x.effect.before, x.effect.after, x.previousWriter]))).toEqual([
      [['bare', 'paint-blue', 'settled']],
      [['paint-blue', 'cable-red', 't1']],
    ]);
    expect(world.writer('crate-1', 'colour')).toBe('t2');
  });

  test('rule 7 seam: a change the history refuses does not commit and is returned as refused', () => {
    const history: HistoryHooks = { ...p1History(), admit: (c, _cause, writer) => !(c.field === 'colour' && writer === 't9') };
    const { world } = stubWorld(1, { history });
    world.commit([{ target: 'crate-1', field: 'colour', after: 'paint-blue' }], 't9');
    const r = world.commit(
      [
        { target: 'crate-1', field: 'colour', after: 'cable-red' },
        { target: 'crate-1', field: 'label', after: 'OK' },
      ],
      't4',
    );
    expect(r.refused.map((c) => c.field)).toEqual(['colour']);
    expect(r.effects.map((e) => e.field)).toEqual(['label']);
    expect(world.part('crate-1')?.colour).toBe('paint-blue');
    expect(world.writer('crate-1', 'colour')).toBe('t9');
  });

  test('values handed out cannot be changed behind the funnel', () => {
    const { world } = stubWorld(1, { history: p1History() }); // the funnel alone: these causes were never opened by an action
    const marks = ['A'];
    world.commit([{ target: 'crate-1', field: 'marks', after: marks }], 't1');
    marks.push('B');
    expect(world.part('crate-1')?.marks).toEqual(['A']);
    expect(Object.isFrozen(world.part('crate-1'))).toBe(true);
    expect(Object.isFrozen(world.part('crate-1')?.location)).toBe(true);
  });

  test('a visitor transaction that changes a part makes it the visitor\'s (rule 5); crew and system do not', () => {
    const { world } = stubWorld(1, { history: p1History() }); // the funnel alone: these causes were never opened by an action
    world.commit([{ target: 'crate-2', field: 'colour', after: 'paint-blue' }], 'system');
    expect(world.touched('crate-2')).toBe(false);
    world.commit([{ target: 'crate-2', field: 'colour', after: 'paint-green' }], 't2');
    expect(world.touched('crate-2')).toBe(true);
  });

  test('nothing commits while a Button rung is bracketed', () => {
    const { world } = stubWorld();
    world.dispatch({ type: 'press', id: 'button' });
    run(world, 1);
    expect(world.bracketed).toBe(true);
    expect(() => world.commit([{ target: 'crate-1', field: 'colour', after: 'paint-blue' }], 't1')).toThrow(/bracketed/);
  });
});
