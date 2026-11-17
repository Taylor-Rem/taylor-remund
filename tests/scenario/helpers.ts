import './rapier-node.ts';
import { createRapierPhysics } from '../../src/workshop/sim/physics/rapier.ts';
import { createWorld } from '../../src/workshop/sim/world.ts';
import type { World, WorldOptions } from '../../src/workshop/sim/world.ts';
import type { SimEvent, Vec3 } from '../../src/workshop/sim/types.ts';

export async function rapierWorld(seed: number | string = 1, opts: Partial<WorldOptions> = {}): Promise<World> {
  const physics = await createRapierPhysics();
  return createWorld({ seed, physics, ...opts });
}

/** Advance n steps, returning every event in order. */
export function run(world: World, n: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    world.advance();
    out.push(...world.drainEvents());
  }
  return out;
}

/** Advance until `until` is true (checked after each step) or `max` steps pass. Returns the steps taken. */
export function runUntil(world: World, until: (events: SimEvent[]) => boolean, max: number): { steps: number; events: SimEvent[] } {
  const all: SimEvent[] = [];
  for (let i = 1; i <= max; i++) {
    world.advance();
    const ev = world.drainEvents();
    all.push(...ev);
    if (until(ev)) return { steps: i, events: all };
  }
  return { steps: max, events: all };
}

/** Pick a part up, carry it along `path` (one point per step), and throw it with `velocity`. */
export function throwPart(world: World, id: string, path: readonly Vec3[], velocity: Vec3): SimEvent[] {
  const m = world.motion(id);
  if (!m) throw new Error(`no part ${id}`);
  const out: SimEvent[] = [];
  world.dispatch({ type: 'grab', id, grip: m.pose.p });
  for (const target of path) {
    world.dispatch({ type: 'carry', target });
    world.advance();
    out.push(...world.drainEvents());
  }
  world.dispatch({ type: 'release', velocity });
  world.advance();
  out.push(...world.drainEvents());
  return out;
}

/** A straight carry path of n steps from a to b. */
export function line(a: Vec3, b: Vec3, n: number): Vec3[] {
  return Array.from({ length: n }, (_, i) => {
    const f = (i + 1) / n;
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f] as Vec3;
  });
}

export const CRATES = ['crate-1', 'crate-2', 'crate-3', 'crate-4'] as const;
