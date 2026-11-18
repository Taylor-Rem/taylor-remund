// Fetch's scenarios (S5) on the bench: `roundsBench()` is the real bench, whose stack (A1's layout) is in
// Fetch's reach of its lane.
import { bench, AT } from '../../src/workshop/sim/scenes/bench.ts';
import { FETCH_TUNING, fetchReach } from '../../src/workshop/sim/crew/fetch.ts';
import { lanePath } from '../../src/workshop/sim/path.ts';
import type { SceneDesc } from '../../src/workshop/sim/scene.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { Id } from '../../src/workshop/sim/types.ts';

/** How far Fetch's grip goes from its centre on the real bench (the scene's `reach`, or P2's number). */
export const REACH = fetchReach(bench);

/** The point of the lane's path (between its stops) nearest (x, z), and how far that is. */
export function laneDistance(scene: SceneDesc, x: number, z: number): { at: [number, number]; d: number } {
  const k = scene.crewScale ?? 1;
  const path = lanePath(scene.runner.lane.points, FETCH_TUNING.cornerRadius * k);
  const inset = FETCH_TUNING.inset * k;
  const s = Math.min(path.length - inset, Math.max(inset, path.nearest(x, z)));
  const at = path.at(s);
  return { at, d: Math.hypot(x - at[0], z - at[1]) };
}

/** The bench Fetch's rounds run on: the real bench (A1 put its stack within reach of the lane, 2.02 from its left stop). */
export function roundsBench(): SceneDesc {
  const d = laneDistance(bench, AT.stack[0], AT.stack[1]).d;
  if (d > fetchReach(bench) - 0.2) throw new Error(`the bench's stack is ${d.toFixed(2)} from Fetch's lane: out of its reach (${REACH.toFixed(2)})`);
  return bench;
}

/**
 * S5 round 2: the bench with an honest reach (`FetchSpec.reach` = `reach`) and a lane of runs laid to serve
 * the stack, the belt's feed, the phone and the platen's tray within it (a path of five points: along the
 * front, in behind the striker, across to the phone, down to the tray). For the reach property only: its runs
 * cross the motor housing's corner and the platen's deck, which a kinematic Fetch passes through.
 */
export function reachBench(reach = 1.3): SceneDesc {
  return {
    ...bench,
    id: 'bench-reach',
    runner: {
      ...bench.runner,
      reach,
      lane: { points: [[-6.1, 2.8], [1.3, 2.8], [1.3, 1.9], [4.65, 1.9], [4.65, 0.85]] },
    },
  };
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
