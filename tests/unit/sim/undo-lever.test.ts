// The UNDO lever (REWRITE.md § B2 X3, § D 8; S4) and what the visitor has used (sim/used.ts), on the
// bench with the stub physics.
import { describe, expect, test } from 'vitest';
import { stubWorld, run, types } from './helpers.ts';
import type { World } from '../../../src/workshop/sim/world.ts';
import { bench } from '../../../src/workshop/sim/scenes/bench.ts';
import { LEVER_STEPS, LEVER_TUNING } from '../../../src/workshop/sim/machines/undo-lever.ts';
import { registryProblems } from '../../../src/workshop/sim/registry.ts';
import { steps } from '../../../src/workshop/sim/clock.ts';
import { qyaw } from '../../../src/workshop/sim/math.ts';
import { LINE } from '../../../src/workshop/sim/scenes/bench.ts';
import type { SimEvent, UndoLeverView } from '../../../src/workshop/sim/types.ts';

const benchStub = () => stubWorld(1, { scene: bench });
const L = (w: World): UndoLeverView => w.machine('undo-lever') as UndoLeverView;
const pull = (w: World): SimEvent[] => {
  w.dispatch({ type: 'press', id: 'undo-lever' });
  return run(w, 1);
};

describe('the UNDO lever', () => {
  test('is in the registry with the cover, Revert and their names; every one with a tell and a misfire', () => {
    const { world } = benchStub();
    const all = [...world.interactables()];
    expect(registryProblems(all)).toEqual([]);
    for (const id of ['undo-lever', 'button-cover', 'revert-crew', 'revert']) expect(all.map((i) => i.id)).toContain(id);
    expect(world.machine('undo-lever')?.kind).toBe('undo-lever');
    expect(world.machine('revert-crew')?.kind).toBe('revert');
  });

  test('a pull is answered in the same step: the change is already undone, the lever already travelling', () => {
    const { world } = benchStub();
    run(world, 5);
    world.dispatch({ type: 'turn', id: 'belt-dial', value: 1 });
    run(world, 40);
    expect(world.setting('belt', 'speed')).toBe(5);
    expect(L(world).armed).toBe(true);
    expect(L(world).lamp).toBe('steady');
    const ev = pull(world);
    expect(types(ev).slice(0, 2)).toEqual(['handle.worked', 'undone']);
    expect(world.setting('belt', 'speed')).toBe(3);
    expect(L(world)).toMatchObject({ phase: 'pull', latch: 1, result: 'undone', armed: false });
    expect(L(world).travel).toBeGreaterThan(0);
    // it reaches the end of its travel inside 100 ms, holds, and springs home
    run(world, steps(LEVER_TUNING.pull));
    expect(L(world).travel).toBe(1);
    run(world, LEVER_STEPS);
    expect(L(world)).toMatchObject({ phase: 'rest', travel: 0, latch: 0 });
  });

  test('with nothing to undo it still travels, and says nothing was undone', () => {
    const { world } = benchStub();
    run(world, 5);
    const ev = pull(world);
    expect(ev).toContainEqual({ type: 'undo.refused', by: 'lever', reason: 'nothing', txn: null });
    expect(L(world)).toMatchObject({ phase: 'pull', result: 'nothing' });
  });

  test('the U key (the world\'s own undo) moves the lever just the same, and clicks it a step later', () => {
    const { world } = benchStub();
    run(world, 5);
    world.dispatch({ type: 'turn', id: 'belt-dial', value: 1 });
    run(world, 40);
    world.dispatch({ type: 'undo' });
    const ev = run(world, 1);
    expect(types(ev)).toContain('undone');
    expect(L(world).phase).toBe('pull');
    expect(run(world, 1)).toContainEqual({ type: 'handle.worked', id: 'undo-lever' });
  });

  test('does not respond while a rung plays', () => {
    const { world } = benchStub();
    run(world, 5);
    world.dispatch({ type: 'turn', id: 'belt-dial', value: 1 });
    run(world, 40);
    world.dispatch({ type: 'press', id: 'button' });
    run(world, 20);
    const ev = pull(world);
    expect(types(ev)).not.toContain('undone');
    expect(types(ev)).not.toContain('handle.worked');
    expect(L(world).phase).toBe('rest');
  });

  test('a misfire: it jerks and springs back; nothing is undone', () => {
    const { world } = benchStub();
    run(world, 5);
    world.dispatch({ type: 'turn', id: 'belt-dial', value: 1 });
    run(world, 40);
    world.interactable('undo-lever')!.misfire(1);
    run(world, steps(LEVER_TUNING.twitchTime));
    expect(L(world).travel).toBeCloseTo(LEVER_TUNING.twitch, 1);
    expect(L(world).misfire?.level).toBe(1);
    run(world, LEVER_STEPS);
    expect(L(world).travel).toBe(0);
    expect(world.setting('belt', 'speed')).toBe(5);
    expect(world.undoStack()).toHaveLength(1);
  });

  test('pulling it is the visitor\'s first action (play mode)', () => {
    const { world } = benchStub();
    run(world, 5);
    expect(world.playMode).toBe(false);
    pull(world);
    expect(world.playMode).toBe(true);
  });
});

describe('what the visitor has used (sim/used.ts)', () => {
  test('fed by the world\'s own traffic: a handle, a jack, the lever, a mouth', () => {
    const { world, physics } = benchStub();
    run(world, 5);
    expect(world.button().used).toEqual([]);
    world.dispatch({ type: 'press', id: 'belt-lever' });
    run(world, 1);
    expect(world.button().used).toEqual(['belt']);
    world.dispatch({ type: 'unplug', cord: 'cord' });
    run(world, 1);
    world.dispatch({ type: 'plug', cord: 'cord', jack: null });
    run(world, 1);
    expect(world.button().used).toEqual(['belt', 'cord']);
    world.dispatch({ type: 'undo' });
    run(world, 1);
    expect(world.button().used).toEqual(['belt', 'cord', 'undo-lever']);
    // a crate set on the belt (the belt's mouth; it is used already) rides to the striker and is struck: the striker is used
    expect(world.setting('belt', 'running')).toBe(true); // the undo took back the stop
    const m = world.motion('crate-3')!;
    world.dispatch({ type: 'grab', id: 'crate-3', grip: m.pose.p });
    run(world, 1);
    physics.land('crate-3', { p: [LINE.strikerX - 1.2, LINE.belt.top + world.halfExtents('crate-3')![1], LINE.belt.z], q: qyaw(0) }, 6);
    world.dispatch({ type: 'release', velocity: [2, 0, 0] });
    const ev = run(world, steps(6));
    expect(ev.some((e) => e.type === 'struck' && e.part === 'crate-3')).toBe(true);
    expect(world.button().used).toContain('striker');
  });

  test('a handle refused during a rung is not used; the crew\'s doings are not the visitor\'s', () => {
    const { world } = benchStub();
    run(world, 5);
    world.dispatch({ type: 'press', id: 'button' });
    run(world, 5);
    world.dispatch({ type: 'turn', id: 'belt-dial', value: 1 });
    run(world, 1);
    while (world.bracketed) run(world, 1);
    // ten seconds of Fetch and the belt by themselves
    run(world, steps(10));
    expect(world.button().used).toEqual([]);
  });
});
