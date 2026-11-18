// S6: the seams between the five simulation packages, one describe per seam, on the bench with the stub physics.
import { describe, expect, test } from 'vitest';
import { stubWorld, run } from './helpers.ts';
import { bench } from '../../../src/workshop/sim/scenes/bench.ts';
import type { CrewView, LampView, PatchView } from '../../../src/workshop/sim/types.ts';
import type { World } from '../../../src/workshop/sim/world.ts';

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

  test('a grab of Fetch or Revert (loose bodies) still holds a part', () => {
    const { world } = benchStub();
    world.dispatch({ type: 'grab', id: 'fetch', grip: world.motion('fetch')!.pose.p });
    run(world, 1);
    expect(world.holding()).toEqual({ kind: 'part', id: 'fetch' });
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

describe('seam 4: the ladder knows every station', () => {
  const ladder = bench.button.ladder!;

  test('the platen, the storefront, the lamp, the phone line and the switchboard (the cord) are on it, each a live interactable', () => {
    const { world } = benchStub();
    const ids = ladder.stations.map((s) => s.id);
    for (const id of ['platen', 'storefront', 'lamp', 'line', 'cord']) expect(ids).toContain(id);
    for (const id of ids) expect(world.interactable(id), id).toBeDefined();
  });

  test('each misfire is one transient beat of its verb: a misfire event, a beat its view shows, nothing durable', () => {
    const { world } = benchStub();
    run(world, 2);
    const before = world.durable();
    for (const id of ['platen', 'storefront', 'lamp', 'line', 'cord']) {
      world.interactable(id)!.misfire(1);
      const ev = run(world, 1);
      expect(ev).toContainEqual({ type: 'misfire', id, level: 1 });
      expect(ev.some((e) => e.type === 'effect'), id).toBe(false);
      const shown = id === 'cord' ? world.cord('cord')!.misfire : world.machine(id)!.misfire;
      expect(shown, id).toMatchObject({ level: 1 });
      expect(shown!.since).toBeLessThan(0.1);
    }
    expect(world.durable()).toEqual(before);
  });

  test('a rung can misfire a Patchlamp station: rung 2 picks the nearest unused one, and it plays once', () => {
    const { world } = benchStub();
    run(world, 10);
    const at = bench.button.at;
    const nearest = ladder.stations
      .filter((s) => s.id !== ladder.lamp && !bench.button.flinch.includes(s.id))
      .map((s) => ({ id: s.id, d: Math.hypot(s.at[0] - at[0], s.at[2] - at[2]) }))
      .sort((a, b) => a.d - b.d)[0]!.id;
    expect(['line', 'platen', 'storefront', 'cord', 'undo-lever', 'striker', 'dock', 'chute']).toContain(nearest);
    for (const _ of [1, 2]) {
      world.dispatch({ type: 'press', id: 'button' });
      run(world, 1);
      for (let i = 0; i < 2000 && world.bracketed; i++) run(world, 1);
    }
    expect(world.button().rung).toBe(2);
    expect(world.button().targets).toEqual([nearest]);
  });

  test('a text sent counts as using the phone line; nothing the crew does counts', () => {
    const { world } = benchStub();
    world.dispatch({ type: 'text', text: 'help' });
    run(world, 2);
    expect(world.button().used).toEqual(['line']);
  });
});

describe('seam 3:reduced motion at run time; the saved Button; the undo id', () => {
  const press = (w: World): void => {
    w.dispatch({ type: 'press', id: 'button' });
    run(w, 1);
    for (let i = 0; i < 2000 && w.bracketed; i++) run(w, 1);
  };

  test('the motion intent switches the next rung to the card and the lamp dip, and back', () => {
    const { world } = benchStub();
    expect(world.reducedMotion).toBe(false);
    world.dispatch({ type: 'motion', reduced: true });
    run(world, 1);
    expect(world.reducedMotion).toBe(true);
    expect(world.button().reducedMotion).toBe(true);
    press(world);
    expect(world.button().script?.reduced).toBe(true);
    expect(world.button().script?.beats.map((b) => b.kind)).toEqual(['dip', 'rewind', 'card']);
    world.dispatch({ type: 'motion', reduced: false });
    run(world, 1);
    press(world);
    expect(world.button().script?.reduced).toBe(false);
  });

  test('a rung already playing finishes as it began', () => {
    const { world } = benchStub();
    world.dispatch({ type: 'press', id: 'button' });
    run(world, 30);
    world.dispatch({ type: 'motion', reduced: true });
    run(world, 1);
    expect(world.button().script?.reduced).toBe(false);
    expect(world.bracketed).toBe(true);
  });

  test('switching it is not a first action and is not input to the crew', () => {
    const fumbleStep = (switchAt: number | null): number => {
      const { world } = benchStub();
      for (let i = 0; i < 12 * 60; i++) {
        if (i === switchAt) world.dispatch({ type: 'motion', reduced: true });
        const ev = run(world, 1);
        if (ev.some((e) => e.type === 'crew.state' && e.id === 'fetch' && e.state === 'fumble')) {
          expect(world.playMode).toBe(false);
          return world.step;
        }
      }
      return -1;
    };
    // Fetch's patience was not reset by a settings switch: the fumble comes at the same step
    expect(fumbleStep(null)).toBeGreaterThan(0);
    expect(fumbleStep(150)).toBe(fumbleStep(null));
  });

  test('a world made from a saved Button (typed ButtonSaved) keeps its reduced motion; the undo id is the lever', () => {
    const { world } = stubWorld(1, { scene: bench, button: { rung: 2, presses: 2, reached: 2, reducedMotion: true } });
    expect(world.reducedMotion).toBe(true);
    expect(world.button().reached).toBe(2);
    expect(world.undoId).toBe('undo-lever');
    expect(world.interactable(world.undoId!)).toBeDefined();
  });
});
