// Helpers for the line's scenarios (the belt, the striker, the dock, the chute) on the bench scene.
import './rapier-node.ts';
import { createRapierPhysics } from '../../src/workshop/sim/physics/rapier.ts';
import { createWorld } from '../../src/workshop/sim/world.ts';
import type { World, WorldOptions } from '../../src/workshop/sim/world.ts';
import { bench, LINE, AT } from '../../src/workshop/sim/scenes/bench.ts';
import type { SceneDesc } from '../../src/workshop/sim/scene.ts';
import type { Id, SimEvent, Vec3 } from '../../src/workshop/sim/types.ts';
import { line } from './helpers.ts';

/**
 * The line's own scenarios run on the bench without Fetch's rounds (S5): in play mode Fetch would set
 * crates of its own on the belt, beside the ones a test puts there. Fetch's tests and the whole-bench
 * soak pass the real `bench` as `scene`.
 */
const { rounds: _rounds, ...quietRunner } = bench.runner;
/**
 * (A1 round 6) Without its rounds Fetch laps its lane end to end as in P1, a crate in its hands; on the bench its path
 * ends at the platen's tray, so here it laps only the path's first run, behind the belt, out of the tray's way.
 */
const QUIET: SceneDesc = { ...bench, runner: { ...quietRunner, lane: { points: bench.runner.lane.points.slice(0, 2) } } };

export { QUIET as BENCH, bench as FULL_BENCH, LINE, AT };

export async function benchWorld(seed: number | string = 1, opts: Partial<WorldOptions> & { scene?: SceneDesc } = {}): Promise<World> {
  const physics = await createRapierPhysics();
  return createWorld({ seed, physics, scene: QUIET, ...opts });
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
  // up clear of everything, across, and down
  const high = Math.max(m.pose.p[1], target[1]) + 1.8;
  const a: Vec3 = [m.pose.p[0], high, m.pose.p[2]];
  const b: Vec3 = [target[0], high, target[2]];
  // across no faster than about 6 units a second (the carry spring's pace), so the hand arrives
  const across = Math.max(steps, Math.ceil((Math.hypot(b[0] - a[0], b[2] - a[2]) / 6) * 60));
  for (const p of [...line(m.pose.p, a, 12), ...line(a, b, across), ...line(b, target, 12)]) {
    world.dispatch({ type: 'carry', target: p });
    t.run(1);
  }
  t.run(20); // let it settle in the hand
  for (let i = 0; i < 90; i++) {
    const p = world.motion(id)!.pose.p;
    if (Math.hypot(p[0] - target[0], p[2] - target[2]) < 0.06) break;
    t.run(1);
  }
  world.dispatch({ type: 'release', velocity: [0, 0, 0] });
  t.run(1);
}

/** Run until `id` has a durable location of kind `at` (or `max` steps). */
export function waitFor(world: World, t: Tape, id: Id, at: 'rest' | 'in' | 'shipped', max = 300): boolean {
  for (let i = 0; i < max; i++) {
    if (world.part(id)!.location.at === at && world.mode(id) !== 'held') return true;
    t.run(1);
  }
  return false;
}

/** A point on the belt's surface `u` of the way from its motor end (0) to its far end (1). */
export const onBelt = (u: number, dz = 0): Vec3 => [LINE.belt.from + (LINE.belt.to - LINE.belt.from) * u, LINE.belt.top, LINE.belt.z + dz];
