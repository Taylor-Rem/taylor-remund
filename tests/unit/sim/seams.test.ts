// S6: the seams between the five simulation packages, one describe per seam, on the bench with the stub physics.
import { describe, expect, test } from 'vitest';
import { stubWorld, run } from './helpers.ts';
import { bench } from '../../../src/workshop/sim/scenes/bench.ts';
import type { CrewView, LampView, PatchView } from '../../../src/workshop/sim/types.ts';

const benchStub = () => stubWorld(1, { scene: bench });

describe('seam 1: one crew', () => {
  test('the world lists the whole crew in step order, each as the view it already had', () => {
    const { world } = benchStub();
    run(world, 2);
    const crew = world.crewViews();
    expect(crew.map((c) => c.kind)).toEqual(['fetch', 'revert', 'patch']);
    const fetch = crew[0] as Extract<CrewView, { kind: 'fetch' }>;
    expect(fetch.member).toEqual(world.crew('fetch'));
    const revert = crew[1] as Extract<CrewView, { kind: 'revert' }>;
    expect(revert.view).toEqual(world.machine('revert-crew'));
    const patch = crew[2] as Extract<CrewView, { kind: 'patch' }>;
    expect(patch.view).toEqual(world.machine('patch'));
    expect(patch.body).toBeNull();
  });

  test('a member is found by its unit id or by its body, and nothing else is crew', () => {
    const { world } = benchStub();
    expect(world.crewView('fetch')?.kind).toBe('fetch');
    expect(world.crewView('revert')?.kind).toBe('revert');
    expect(world.crewView('revert-crew')?.kind).toBe('revert');
    expect(world.crewView('patch')?.kind).toBe('patch');
    for (const id of ['crate-1', 'belt', 'button', 'nobody']) expect(world.crewView(id)).toBeUndefined();
  });
});

describe('seam 2: one grab', () => {
  test('grab, carry and release lift Patch off its stool and put it down, as drag did; holding() knows', () => {
    const { world } = benchStub();
    run(world, 2);
    const patch = () => world.machine('patch') as PatchView;
    const seat = patch().at;
    world.dispatch({ type: 'grab', id: 'patch', grip: [seat[0], seat[1] + 1, seat[2]] });
    run(world, 1);
    expect(world.holding()).toEqual({ kind: 'unit', id: 'patch' });
    expect(world.playMode).toBe(true);
    expect(patch().state).toBe('held');
    world.dispatch({ type: 'carry', target: [0, 2, 1] });
    run(world, 1);
    expect(patch().at).toEqual([0, 2, 1]);
    world.dispatch({ type: 'release', velocity: [3, 0, 0] });
    run(world, 1);
    expect(world.holding()).toBeNull();
    expect(['walk', 'climb']).toContain(patch().state);
  });

  test("the lamp's shade: one grab, the arm follows the hand, one transaction when it is let go", () => {
    const { world } = benchStub();
    const lamp = () => world.machine('lamp') as LampView;
    const home = lamp().bulb;
    world.dispatch({ type: 'grab', id: 'lamp', grip: home });
    run(world, 1);
    expect(world.holding()).toEqual({ kind: 'unit', id: 'lamp' });
    for (let i = 1; i <= 30; i++) {
      world.dispatch({ type: 'carry', target: [home[0] + i * 0.03, home[1], home[2] - i * 0.02] });
      run(world, 1);
    }
    expect(lamp().dragging).toBe(true);
    expect(world.undoStack()).toHaveLength(0); // nothing durable while the hand has it
    run(world, 6 * 60); // a hand held still longer than the lost-drag timeout is still holding
    expect(lamp().dragging).toBe(true);
    world.dispatch({ type: 'release', velocity: [0, 0, 0] });
    run(world, 1);
    expect(world.holding()).toBeNull();
    expect(lamp().dragging).toBe(false);
    expect(world.undoStack()).toHaveLength(1);
    expect(world.setting('lamp', 'x')).not.toBe(home[0]);
    world.dispatch({ type: 'undo' });
    run(world, 1);
    expect(lamp().bulb[0]).toBeCloseTo(home[0], 6);
  });

  test('while the hand holds a unit nothing else can be picked up, and the Button does not play', () => {
    const { world } = benchStub();
    world.dispatch({ type: 'grab', id: 'patch', grip: [3, 2, -3] });
    run(world, 1);
    const m = world.motion('crate-1')!;
    world.dispatch({ type: 'grab', id: 'crate-1', grip: m.pose.p });
    world.dispatch({ type: 'press', id: 'button' });
    run(world, 1);
    expect(world.holding()).toEqual({ kind: 'unit', id: 'patch' });
    expect(world.button().phase).toBe('idle');
  });

  test('a grab of something neither loose nor holdable is refused, and is not a first action', () => {
    const { world } = benchStub();
    world.dispatch({ type: 'grab', id: 'belt', grip: [0, 0.5, 3.9] });
    run(world, 1);
    expect(world.holding()).toBeNull();
    expect(world.playMode).toBe(false);
  });

  test('Reset the workshop lets go of a held unit', () => {
    const { world } = benchStub();
    world.dispatch({ type: 'grab', id: 'patch', grip: [3, 2, -3] });
    run(world, 1);
    world.dispatch({ type: 'reset' });
    run(world, 1);
    expect(world.holding()).toBeNull();
  });
});
