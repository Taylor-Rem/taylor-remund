// Fetch's scenarios (S5) on the bench. The layout is being moved (the stack, the lane's left end and the
// chute's landing into one cluster at the front left); until the stack is within Fetch's reach of its
// tape on the real bench, `roundsBench()` is the bench with the stack moved into reach and everything
// else as laid out. Once it is in reach, `roundsBench()` IS the real bench.
import { bench, AT, LINE, CREW_SCALE } from '../../src/workshop/sim/scenes/bench.ts';
import { belt } from '../../src/workshop/sim/machines/belt.ts';
import { striker } from '../../src/workshop/sim/machines/striker.ts';
import { dock } from '../../src/workshop/sim/machines/dock.ts';
import { chute } from '../../src/workshop/sim/machines/chute.ts';
import { FETCH_TUNING } from '../../src/workshop/sim/crew/fetch.ts';
import { CRATE_EDGE } from '../../src/workshop/sim/parts.ts';
import { qyaw } from '../../src/workshop/sim/math.ts';
import type { SceneDesc } from '../../src/workshop/sim/scene.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { Id, Vec3 } from '../../src/workshop/sim/types.ts';

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

/** Where the stack goes when the real one is out of reach: 2.1 from the lane's left stop, clear of the motor housing and Revert. */
export const NEAR_STACK = [-6.7, 1.3] as const;

/** The bench with its crate stack within Fetch's reach (the real bench, if it already is). */
export function roundsBench(): SceneDesc {
  if (laneDistance(bench, AT.stack[0], AT.stack[1]).d <= REACH - 0.2) return bench;
  const [sx, sz] = NEAR_STACK;
  const e = CRATE_EDGE;
  const stackPose: Record<string, Vec3> = {
    'crate-1': [sx, e.L / 2, sz],
    'crate-2': [sx + 0.04, e.L + e.M / 2, sz - 0.03],
    'crate-3': [sx - 0.03, e.L + e.M + e.S / 2, sz + 0.02],
  };
  const yaw: Record<string, number> = { 'crate-1': 0.04, 'crate-2': -0.09, 'crate-3': 0.13 };
  return {
    ...bench,
    id: 'bench-rounds',
    parts: bench.parts.map((p) => (stackPose[p.id] ? { ...p, pose: { p: stackPose[p.id] as Vec3, q: qyaw(yaw[p.id] as number) } } : p)),
    runner: { ...bench.runner, rounds: { ...(bench.runner.rounds as NonNullable<SceneDesc['runner']['rounds']>), stack: NEAR_STACK } },
    units: [
      belt({ id: 'belt', station: 'line', name: 'name.belt', mouth: 'belt', ...LINE.belt, dial: { id: 'belt-dial', name: 'name.belt.dial' }, lever: { id: 'belt-lever', name: 'name.belt.lever' } }),
      striker({ id: 'striker', station: 'line', name: 'name.striker', x: LINE.strikerX, mouth: 'belt' }),
      dock({ id: 'dock', station: 'line', name: 'name.dock', mouth: 'dock', ramp: LINE.ramp, stack: NEAR_STACK }),
      chute({ id: 'chute', station: 'line', name: 'name.chute' }),
      // (S3) the rest of the bench's units as they are (the Patchlamp station: the scene's platen mouth needs its machine)
      ...(bench.units ?? []).slice(4),
    ],
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
