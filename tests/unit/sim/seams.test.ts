// S6: the seams between the five simulation packages, one describe per seam, on the bench with the stub physics.
import { describe, expect, test } from 'vitest';
import { stubWorld, run } from './helpers.ts';
import { bench } from '../../../src/workshop/sim/scenes/bench.ts';
import type { CrewView } from '../../../src/workshop/sim/types.ts';

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
