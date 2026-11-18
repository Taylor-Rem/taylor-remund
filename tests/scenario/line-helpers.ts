// Helpers for the line's scenarios (the belt, the striker, the dock, the chute) on the bench scene.
import './rapier-node.ts';
import { createRapierPhysics } from '../../src/workshop/sim/physics/rapier.ts';
import { createWorld } from '../../src/workshop/sim/world.ts';
import type { World, WorldOptions } from '../../src/workshop/sim/world.ts';
import { bench, LINE } from '../../src/workshop/sim/scenes/bench.ts';
import type { SceneDesc } from '../../src/workshop/sim/scene.ts';
import type { Id, SimEvent, Vec3 } from '../../src/workshop/sim/types.ts';
import { line } from './helpers.ts';

export { bench as BENCH, LINE };

export async function benchWorld(seed: number | string = 1, opts: Partial<WorldOptions> & { scene?: SceneDesc } = {}): Promise<World> {
  const physics = await createRapierPhysics();
  return createWorld({ seed, physics, scene: bench, ...opts });
}

/** A recorder: every event with the step it happened in. */
export interface Tape {
  readonly events: { step: number; e: SimEvent }[];
  run(n: number): SimEvent[];
  until(pred: (e: SimEvent) => boolean, max: number): { step: number; e: SimEvent } | null;
  of<T extends SimEvent['type']>(type: T): { step: number; e: Extract<SimEvent, { type: T }> }[];
}

export function tape(world: World): Tape {
  const events: { step: number; e: SimEvent }[] = [];
  const step = (): SimEvent[] => {
    world.advance();
    const ev = world.drainEvents();
    for (const e of ev) events.push({ step: world.step, e });
    return ev;
  };
  return {
    events,
    run(n) {
      const out: SimEvent[] = [];
      for (let i = 0; i < n; i++) out.push(...step());
      return out;
    },
    until(pred, max) {
      for (let i = 0; i < max; i++) {
        const ev = step();
        const hit = ev.find(pred);
        if (hit) return { step: world.step, e: hit };
      }
      return null;
    },
    of(type) {
      return events.filter((x) => x.e.type === type) as never;
    },
  };
}

/** The visitor carries a part to a spot above `to` (bench coordinates of its bottom) and lets go there, still. */
export function putOn(world: World, t: Tape, id: Id, to: Vec3, steps = 30): void {
  const m = world.motion(id);
  if (!m) throw new Error(`no part ${id}`);
  const h = world.halfExtents(id)![1];
  world.dispatch({ type: 'grab', id, grip: m.pose.p });
  const target: Vec3 = [to[0], to[1] + h + 0.12, to[2]];
  for (const p of line([m.pose.p[0], m.pose.p[1] + 0.6, m.pose.p[2]], target, steps)) {
    world.dispatch({ type: 'carry', target: p });
    t.run(1);
  }
  t.run(20); // let it settle in the hand
  world.dispatch({ type: 'release', velocity: [0, 0, 0] });
  t.run(1);
}

/** A point on the belt's surface `u` of the way from its motor end (0) to its far end (1). */
export const onBelt = (u: number, dz = 0): Vec3 => [LINE.belt.from + (LINE.belt.to - LINE.belt.from) * u, LINE.belt.top, LINE.belt.z + dz];
