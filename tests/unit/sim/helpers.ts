import { createStubPhysics } from '../../../src/workshop/sim/physics/stub.ts';
import type { StubPhysics } from '../../../src/workshop/sim/physics/stub.ts';
import { createWorld } from '../../../src/workshop/sim/world.ts';
import type { World, WorldOptions } from '../../../src/workshop/sim/world.ts';
import { vignette } from '../../../src/workshop/sim/scenes/vignette.ts';
import type { SimEvent } from '../../../src/workshop/sim/types.ts';

export function stubWorld(seed: number | string = 1, opts: Partial<WorldOptions> = {}): { world: World; physics: StubPhysics } {
  const b = (opts.scene ?? vignette).bench;
  const physics = createStubPhysics({ footprint: { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ } });
  return { world: createWorld({ seed, physics, ...opts }), physics };
}

export function run(world: World, n: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    world.advance();
    out.push(...world.drainEvents());
  }
  return out;
}

export const types = (events: readonly SimEvent[]): string[] => events.map((e) => e.type);
export const crewStates = (events: readonly SimEvent[]): string[] => events.flatMap((e) => (e.type === 'crew.state' ? [e.state] : []));
