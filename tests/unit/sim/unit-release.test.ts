// R4: a unit let go of gets the hand's velocity from the world (the drag intent's `velocity`), as a part does;
// a reset and a tap-placing ('place') send none. Seen through Patch, which flies when it gets one.
import { describe, expect, test } from 'vitest';
import { stubWorld, run } from './helpers.ts';
import { bench } from '../../../src/workshop/sim/scenes/bench.ts';
import type { PatchView } from '../../../src/workshop/sim/types.ts';

const lift = () => {
  const { world } = stubWorld(1, { scene: bench });
  run(world, 2);
  const patch = (): PatchView => world.machine('patch') as PatchView;
  const seat = patch().at;
  world.dispatch({ type: 'grab', id: 'patch', grip: [seat[0], seat[1] + 1, seat[2]] });
  run(world, 1);
  world.dispatch({ type: 'carry', target: [0, 1.2, 1] }); // (a hand's height: higher, let go still, it falls: R4)
  run(world, 1);
  return { world, patch };
};

describe("a unit let go of gets the hand's velocity", () => {
  test('release with a velocity: the unit receives it (Patch is thrown with it)', () => {
    const { world, patch } = lift();
    world.dispatch({ type: 'release', velocity: [4, 1, -2] });
    run(world, 1);
    const v = patch();
    expect(v.state).toBe('fly');
    expect(v.thrown?.v?.[0]).toBeCloseTo(4, 6);
    expect(v.thrown?.v?.[2]).toBeCloseTo(-2, 6);
  });
  test('release with none, a placing, and a reset: no velocity (a set-down, not a throw)', () => {
    const a = lift();
    a.world.dispatch({ type: 'release', velocity: [0, 0, 0] });
    run(a.world, 1);
    expect(['walk', 'climb']).toContain(a.patch().state);
    const b = lift();
    b.world.dispatch({ type: 'place', at: [-3, 0, 1] });
    run(b.world, 1);
    expect(['walk', 'climb']).toContain(b.patch().state);
    const c = lift();
    c.world.dispatch({ type: 'reset' });
    run(c.world, 1);
    expect(c.patch().state).toBe('seated');
  });
});
