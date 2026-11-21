// Helpers for Patch's body (the 2026-11-20 prototype: `PatchSpec.flight: 'body'`, scene `benchBody`): a hand that
// takes hold, carries and lets go as the page does (grab, a carry each step, a release that states no velocity), and
// what the tests measure: where Patch's middle is, step by step, whichever Patch it is.
import { benchWorld, FULL_SCRIPT_BENCH, tape } from './line-helpers.ts';
import type { Tape } from './line-helpers.ts';
import { benchBody, PATCH_BODY } from '../../src/workshop/sim/scenes/bench.ts';
import { PATCH_TUNING } from '../../src/workshop/sim/crew/patch.ts';
import { solidsOf } from '../../src/workshop/sim/crew/patch-route.ts';
import { distanceTo } from '../../src/workshop/sim/crew/fetch-knock.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { SceneDesc } from '../../src/workshop/sim/scene.ts';
import type { Lens, PatchView, Vec3 } from '../../src/workshop/sim/types.ts';

/**
 * `SCRIPT`: the whole bench with the scripted Patch (`benchScript`), for comparing. (The bench itself, `bench`, is
 * `benchBody` since 2026-11-20.)
 */
export { benchBody, PATCH_BODY, FULL_SCRIPT_BENCH as SCRIPT };
export const BODY = PATCH_BODY.id;
export const SOLIDS = solidsOf(benchBody);
/** The page's lens at the home view (as the hand tests take it). */
export const LENS: Lens = { away: [0, -1], tilt: 0.7 };

export const patch = (w: World): PatchView => w.machine('patch') as PatchView;
export const len = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);
export const level = (v: Vec3): number => Math.hypot(v[0], v[2]);
export const fmt = (v: readonly number[], d = 2): string => v.map((x) => x.toFixed(d)).join(', ');

export async function world(scene: SceneDesc = benchBody, seed: number | string = 'patch-body'): Promise<{ w: World; t: Tape }> {
  const w = await benchWorld(seed, { scene });
  const t = tape(w);
  t.run(30);
  return { w, t };
}

/**
 * Where Patch's middle is, whichever Patch it is: its body's middle while its body is in the world; else from `at`
 * as the scripted Patch means it (the hand when held, its middle in the air and at the wall, its feet otherwise).
 */
export function middle(w: World): Vec3 {
  const v = patch(w);
  if (v.body) return v.body.pose.p;
  if (v.state === 'held') return [v.at[0], v.at[1] - PATCH_TUNING.hangBelow, v.at[2]];
  if (v.state === 'fly' || v.state === 'wall' || v.state === 'away' || v.state === 'ledge') return v.at;
  // (getting up from how its body lay: its middle is where the body's was, carried along with the move it makes)
  if (v.state === 'land' && v.lay) return [v.lay.pose.p[0] + v.at[0] - v.lay.from[0], v.lay.pose.p[1] + v.at[1] - v.lay.from[1], v.lay.pose.p[2] + v.at[2] - v.lay.from[2]];
  // (hauling itself up over the edge: from its paws on the edge to its feet on the bench)
  const k = v.state === 'haul' ? Math.min(1, v.stateTime / v.stateLength) : 1;
  return [v.at[0], v.at[1] + PATCH_TUNING.restMid * k, v.at[2]];
}

/** Take hold of Patch where it is and carry it to `at` (the hand; eased, over a low arc), held still there. */
export function lift(w: World, t: Tape, at: Vec3, still = 20): void {
  const a = patch(w).at;
  const state = patch(w).state;
  w.dispatch({ type: 'grab', id: 'patch', grip: state === 'held' ? a : [a[0], a[1] + 0.5, a[2]] });
  t.run(1);
  if (w.holding()?.id !== 'patch') throw new Error(`Patch was not taken hold of (${state})`);
  const from = patch(w).at;
  const n = Math.max(30, Math.round((Math.hypot(at[0] - from[0], at[2] - from[2]) / 9) * HZ));
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    const e = k * k * (3 - 2 * k);
    w.dispatch({ type: 'carry', target: [from[0] + (at[0] - from[0]) * e, from[1] + (at[1] - from[1]) * e + 1.6 * Math.sin(Math.PI * k), from[2] + (at[2] - from[2]) * e] });
    t.run(1);
  }
  for (let i = 0; i < still; i++) {
    w.dispatch({ type: 'carry', target: at });
    t.run(1);
  }
}

/**
 * The hand moves from `at` at `v` (units/s; it gets up to that over its first three steps) for `n` steps, and lets
 * go without stating a velocity, as the page does: what is thrown is what the held thing was doing. Returns where
 * the hand was at the end. Runs the step in which it is let go.
 */
export function fling(w: World, t: Tape, at: Vec3, v: Vec3, n = 10, lens?: Lens): Vec3 {
  let hand: Vec3 = at;
  for (let i = 0; i < n; i++) {
    const k = Math.min(1, (i + 1) / 3) / HZ;
    hand = [hand[0] + v[0] * k, hand[1] + v[1] * k, hand[2] + v[2] * k];
    w.dispatch({ type: 'carry', target: hand });
    t.run(1);
  }
  w.dispatch(lens ? { type: 'release', lens } : { type: 'release' });
  t.run(1);
  return hand;
}

/** One step of what a watcher keeps: Patch's state, its middle, how far it moved in the step. */
export interface Sample {
  readonly step: number;
  readonly state: PatchView['state'];
  readonly mid: Vec3;
  /** Its velocity over the step (units/s), from its middle. */
  readonly v: Vec3;
  readonly speed: number;
  /** Is its body in the world (the body Patch only)? */
  readonly body: boolean;
  readonly at: Vec3;
}

/** Record Patch step by step: `step()` advances the world once and returns the sample. */
export function watcher(w: World, t: Tape): { samples: Sample[]; step(): Sample; until(pred: (s: Sample) => boolean, seconds: number): Sample | null } {
  const samples: Sample[] = [];
  let last = middle(w);
  const step = (): Sample => {
    t.run(1);
    const v = patch(w);
    const mid = middle(w);
    const d: Vec3 = [(mid[0] - last[0]) * HZ, (mid[1] - last[1]) * HZ, (mid[2] - last[2]) * HZ];
    last = mid;
    const s: Sample = { step: w.step, state: v.state, mid, v: d, speed: len(d), body: !!v.body, at: v.at };
    samples.push(s);
    return s;
  };
  return {
    samples,
    step,
    until(pred, seconds) {
      for (let i = 0; i < seconds * HZ; i++) {
        const s = step();
        if (pred(s)) return s;
      }
      return null;
    },
  };
}

/**
 * Is the point inside a fixed body by more than `margin` (0: on its top or a side counts as out)? A point on the
 * bench top under a body that stands on the bench is inside it (its feet in a machine's footprint).
 */
export function insideSolid(p: Vec3, margin = 0.03): string | null {
  for (const o of SOLIDS) {
    // (above its bottom: for one that stands on the bench itself, the bench top under it counts)
    const above = o.y0 < 0.01 ? p[1] > o.y0 - 1e-6 : p[1] > o.y0 + margin;
    if (above && p[1] < o.y1 - margin && distanceTo(o, p[0], p[2]) <= 0 && inset(o, p) > margin) return o.id;
  }
  return null;
}
/** How far inside a body's footprint a point is (its distance to the nearest side). */
function inset(o: { x: number; z: number; hx: number; hz: number; yaw: number }, p: Vec3): number {
  const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
  const dx = p[0] - o.x, dz = p[2] - o.z;
  return Math.min(o.hx - Math.abs(c * dx - s * dz), o.hz - Math.abs(s * dx + c * dz));
}
