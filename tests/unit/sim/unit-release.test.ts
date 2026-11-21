// R4: a unit the hand holds that has no body of its own (the lamp by its shade) is let go with the hand's velocity
// from the world (the drag intent's `velocity`), as a part is; a set-down states zero, and a tap-placing ('place') and
// a reset send none. Until 2026-11-21 this was seen through the scripted Patch, the one such unit that flew; Patch has
// a body now (let go, its body is thrown as a part is: tests/scenario/patch-body.test.ts), so a probe unit that
// records its drags stands in for it here.
import { describe, expect, test } from 'vitest';
import { stubWorld, run } from './helpers.ts';
import { vignette } from '../../../src/workshop/sim/scenes/vignette.ts';
import type { Intent } from '../../../src/workshop/sim/types.ts';
import type { Unit } from '../../../src/workshop/sim/context.ts';

type Drag = Extract<Intent, { type: 'drag' }>;

const lift = () => {
  const drags: Drag[] = [];
  const probe: Unit = {
    id: 'probe',
    holds: (what) => what === 'probe',
    intent(intent) {
      if (intent.type !== 'drag' || intent.id !== 'probe') return false;
      drags.push(intent);
      return true;
    },
  };
  const { world } = stubWorld(1, { scene: { ...vignette, units: [...(vignette.units ?? []), () => probe] } });
  run(world, 2);
  world.dispatch({ type: 'grab', id: 'probe', grip: [0, 1, 0] });
  run(world, 1);
  expect(world.holding()).toEqual({ kind: 'unit', id: 'probe' });
  world.dispatch({ type: 'carry', target: [-2, 1.2, -1] });
  run(world, 1);
  const end = (): Drag | undefined => drags.find((d) => d.end);
  return { world, end };
};

describe("a unit let go of gets the hand's velocity", () => {
  test('release with a velocity: the unit receives it', () => {
    const { world, end } = lift();
    world.dispatch({ type: 'release', velocity: [4, 1, -2] });
    run(world, 1);
    expect(end()?.velocity?.[0]).toBeCloseTo(4, 6);
    expect(end()?.velocity?.[2]).toBeCloseTo(-2, 6);
    expect(world.holding()).toBeNull();
  });
  test('a set-down states zero; a placing and a reset state none', () => {
    const a = lift();
    a.world.dispatch({ type: 'release', velocity: [0, 0, 0] });
    run(a.world, 1);
    expect(a.end()?.velocity).toEqual([0, 0, 0]);
    const b = lift();
    b.world.dispatch({ type: 'place', at: [-3, 0, 1] });
    run(b.world, 1);
    expect(b.end()).toBeTruthy();
    expect(b.end()?.velocity).toBeUndefined();
    const c = lift();
    c.world.dispatch({ type: 'reset' });
    run(c.world, 1);
    expect(c.end()).toBeTruthy();
    expect(c.end()?.velocity).toBeUndefined();
    expect(c.world.holding()).toBeNull();
  });
});
