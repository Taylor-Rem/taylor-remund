// Fetch's scenarios (S5) on the bench: `roundsBench()` is the real bench, whose stack (A1's layout) is in
// Fetch's reach of its lane.
import { bench, AT, CREW_SCALE } from '../../src/workshop/sim/scenes/bench.ts';
import { FETCH_TUNING } from '../../src/workshop/sim/crew/fetch.ts';
import type { SceneDesc } from '../../src/workshop/sim/scene.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { Id } from '../../src/workshop/sim/types.ts';

/** How far from a point of its lane (between its stops) Fetch can take hold of a part. */
export const REACH = (FETCH_TUNING.reach + FETCH_TUNING.handForward) * CREW_SCALE;

/** The point of the lane (between its stops) nearest (x, z), and how far that is. */
export function laneDistance(scene: SceneDesc, x: number, z: number): { at: [number, number]; d: number } {
  const [ax, az] = scene.runner.lane.a;
  const [bx, bz] = scene.runner.lane.b;
  const len = Math.hypot(bx - ax, bz - az);
  const dx = (bx - ax) / len;
  const dz = (bz - az) / len;
  const inset = FETCH_TUNING.inset * (scene.crewScale ?? 1);
  const s = Math.min(len - inset, Math.max(inset, (x - ax) * dx + (z - az) * dz));
  const at: [number, number] = [ax + dx * s, az + dz * s];
  return { at, d: Math.hypot(x - at[0], z - at[1]) };
}

/** The bench Fetch's rounds run on: the real bench (A1 put its stack within reach of the lane, 2.02 from its left stop). */
export function roundsBench(): SceneDesc {
  const d = laneDistance(bench, AT.stack[0], AT.stack[1]).d;
  if (d > REACH - 0.2) throw new Error(`the bench's stack is ${d.toFixed(2)} from Fetch's lane: out of its reach (${REACH.toFixed(2)})`);
  return bench;
}

/** Play mode without changing anything: one pull of the lever on an empty stack (it answers "nothing"). */
export function startPlay(w: World): void {
  w.dispatch({ type: 'undo' });
  w.advance();
  w.drainEvents();
  if (!w.playMode) throw new Error('play mode did not start');
}

/** Crates in play as Fetch counts them: in the line's mouths, or in its hands. */
export function inPlay(w: World): number {
  const rounds = w.scene.runner.rounds!;
  let n = 0;
  for (const p of w.parts()) {
    if (p.location.at === 'in' && rounds.inPlay.includes(p.location.mouth)) n++;
    else if (w.crew('fetch')?.carrying === p.id) n++;
  }
  return n;
}

/** Crates on the stack (centre within the stack's radius, at rest or held there). */
export function onStack(w: World): Id[] {
  const r = w.scene.runner.rounds!;
  return [...w.parts()].filter((p) => p.kind === 'crate' && w.mode(p.id) === 'free' && Math.hypot(w.motion(p.id)!.pose.p[0] - r.stack[0], w.motion(p.id)!.pose.p[2] - r.stack[1]) <= r.stackRadius).map((p) => p.id);
}
