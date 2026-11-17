import { describe, expect, test } from 'vitest';
import { stubWorld, run, types } from './helpers.ts';
import { registryProblems } from '../../../src/workshop/sim/registry.ts';
import { rng } from '../../../src/workshop/sim/rng.ts';
import type { Intent, Interactable } from '../../../src/workshop/sim/types.ts';

describe('the registry (§ E4 invariant 1)', () => {
  test('every interactable has a name, a tell and a misfire, and each speaks as an event', () => {
    const { world } = stubWorld();
    const all = [...world.interactables()];
    expect(registryProblems(all)).toEqual([]);
    const ids = all.map((i) => i.id);
    for (const id of ['crate-1', 'crate-2', 'crate-3', 'crate-4', 'fetch', 'lamp', 'belt', 'button', 'cord', 'jack-storefront', 'jack-lamp']) expect(ids).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const i of all) {
      i.tell();
      i.misfire(1);
      expect(world.drainEvents()).toEqual([
        { type: 'tell', id: i.id },
        { type: 'misfire', id: i.id, level: 1 },
      ]);
    }
    // every part is in the registry, and can be grabbed
    for (const p of world.parts()) expect(world.interactable(p.id)?.affordances).toContain('grab');
  });

  test('the check catches an interactable without a name, a tell or a misfire', () => {
    const bad = [
      { id: 'a', station: 'line', name: '', affordances: [], tell() {}, misfire() {} },
      { id: 'b', station: 'line', name: 'x', affordances: [], misfire() {} },
      { id: 'c', station: 'line', name: 'x', affordances: [], tell() {} },
    ] as unknown as Interactable[];
    expect(registryProblems(bad)).toEqual(['a: no name', 'b: no tell', 'c: no misfire']);
  });
});

describe('the cord (§ B2 X1): exactly one jack at all times', () => {
  test('unplug lifts (transient), plug commits, plug(null) returns it', () => {
    const { world } = stubWorld();
    world.dispatch({ type: 'unplug', cord: 'cord' });
    let ev = run(world, 1);
    expect(ev).toContainEqual({ type: 'cord.unplugged', cord: 'cord', jack: 'jack-storefront' });
    expect(world.cord('cord')).toMatchObject({ lifted: true, jack: 'jack-storefront' });
    expect(world.setting('cord', 'jack')).toBe('jack-storefront');
    expect(world.holding()).toEqual({ kind: 'plug', id: 'cord' });

    world.dispatch({ type: 'carry', target: [1, 1, -3] });
    run(world, 1);
    expect(world.cord('cord')?.plugAt).toEqual([1, 1, -3]);

    world.dispatch({ type: 'plug', cord: 'cord', jack: null });
    ev = run(world, 1);
    expect(ev).toEqual([{ type: 'cord.plugged', cord: 'cord', jack: 'jack-storefront' }]);
    expect(world.holding()).toBeNull();

    world.dispatch({ type: 'unplug', cord: 'cord' });
    world.dispatch({ type: 'plug', cord: 'cord', jack: 'jack-lamp' });
    ev = run(world, 1);
    expect(types(ev)).toEqual(['cord.unplugged', 'effect', 'cord.plugged']);
    const eff = ev[1];
    expect(eff?.type === 'effect' && eff.effect).toEqual({ target: 'cord', field: 'jack', before: 'jack-storefront', after: 'jack-lamp', cause: 't1' });
    expect(world.setting('cord', 'jack')).toBe('jack-lamp');
    expect(world.writer('cord', 'jack')).toBe('t1');
  });

  test('a jack that is not on the board returns the plug where it came from', () => {
    const { world } = stubWorld();
    world.dispatch({ type: 'unplug', cord: 'cord' });
    world.dispatch({ type: 'plug', cord: 'cord', jack: 'jack-nowhere' });
    expect(run(world, 1)).toContainEqual({ type: 'cord.plugged', cord: 'cord', jack: 'jack-storefront' });
    expect(world.setting('cord', 'jack')).toBe('jack-storefront');
  });

  test('random intent sequences never leave the cord outside exactly one jack', () => {
    for (let seed = 0; seed < 30; seed++) {
      const r = rng(`cord-${seed}`);
      const { world } = stubWorld(seed);
      const jacks = ['jack-storefront', 'jack-lamp'];
      for (let i = 0; i < 200; i++) {
        const k = r.int(7);
        const intent: Intent =
          k === 0 ? { type: 'unplug', cord: 'cord' }
          : k === 1 ? { type: 'plug', cord: 'cord', jack: r.pick([...jacks, null, 'bogus']) }
          : k === 2 ? { type: 'carry', target: [r.range(-3, 3), r.range(0, 2), r.range(-5, 0)] }
          : k === 3 ? { type: 'release', velocity: [0, 0, 0] }
          : k === 4 ? { type: 'press', id: 'button' }
          : k === 5 ? { type: 'grab', id: r.pick(['crate-1', 'crate-4', 'fetch']), grip: [0, 0.5, 0] }
          : { type: 'place', at: r.pick(['jack-lamp', 'jack-storefront', [0, 0, 0] as const]) };
        world.dispatch(intent);
        world.advance();
        world.drainEvents();
        const jack = world.setting('cord', 'jack');
        expect(jacks.filter((j) => j === jack)).toHaveLength(1);
        const view = world.cord('cord');
        expect(view?.jack).toBe(jack);
        if (!view?.lifted) expect(world.holding()?.kind).not.toBe('plug');
      }
    }
  });
});

describe('play mode (§ B3): flips on the first visitor intent that acts', () => {
  test('hovering and carrying with nothing held do not count', () => {
    const { world } = stubWorld();
    world.dispatch({ type: 'hover', id: 'button' });
    world.dispatch({ type: 'carry', target: [0, 1, 0] });
    world.dispatch({ type: 'release', velocity: [0, 0, 0] });
    world.dispatch({ type: 'plug', cord: 'cord', jack: 'jack-lamp' });
    world.dispatch({ type: 'grab', id: 'no-such-part', grip: [0, 0, 0] });
    run(world, 5);
    expect(world.playMode).toBe(false);
    expect(world.hovered).toBe('button');
  });

  for (const [what, intent] of [
    ['grab', { type: 'grab', id: 'crate-1', grip: [-2.7, 0.4, 0.7] }],
    ['press', { type: 'press', id: 'button' }],
    ['unplug', { type: 'unplug', cord: 'cord' }],
  ] as const) {
    test(`${what} flips it, and it stays flipped`, () => {
      const { world } = stubWorld();
      run(world, 3);
      expect(world.playMode).toBe(false);
      world.dispatch(intent);
      run(world, 1);
      expect(world.playMode).toBe(true);
      run(world, 400);
      expect(world.playMode).toBe(true);
    });
  }
});
