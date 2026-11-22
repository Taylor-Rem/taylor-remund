// Helpers for Pitch (sim/crew/pitch.ts) on the whole bench with him on it (`withPitch`): a hand that takes hold,
// carries and lets go as the page does, and what the tests read: his view, and whether he is home.
import { benchWorld, tape } from './line-helpers.ts';
import type { Tape } from './line-helpers.ts';
import { bench, withPitch, PITCH_SPEC, PITCH_BODY } from '../../src/workshop/sim/scenes/bench.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { SceneDesc } from '../../src/workshop/sim/scene.ts';
import type { Lens, PitchView, Vec3 } from '../../src/workshop/sim/types.ts';

export const PITCHED: SceneDesc = withPitch(bench);
export { PITCH_SPEC, PITCH_BODY };
export const BODY = PITCH_BODY.id;
export const LENS: Lens = { away: [0, -1], tilt: 0.7 };
const H = PITCH_SPEC.heading;
/** His middle moored. */
export const MOORED: Vec3 = [PITCH_SPEC.mast[0] - Math.sin(H) * PITCH_SPEC.nose, PITCH_SPEC.mast[1], PITCH_SPEC.mast[2] - Math.cos(H) * PITCH_SPEC.nose];

export const pitchOf = (w: World): PitchView => {
  const c = w.crewView('pitch');
  if (!c || c.kind !== 'pitch') throw new Error('no Pitch on this bench');
  return c.view;
};
export const fmt = (v: readonly number[], d = 2): string => v.map((x) => x.toFixed(d)).join(', ');

/** At his mast: moored, his middle where it belongs, his nose the mast's way, his body out of the world. */
export function home(w: World): boolean {
  const v = pitchOf(w);
  const a = v.at;
  return v.state === 'moored' && Math.hypot(a[0] - MOORED[0], a[1] - MOORED[1], a[2] - MOORED[2]) < 0.02 && Math.abs(Math.atan2(Math.sin(v.heading - H), Math.cos(v.heading - H))) < 0.05 && w.mode(BODY) === 'gone';
}

export async function world(scene: SceneDesc = PITCHED, seed: number | string = 'pitch'): Promise<{ w: World; t: Tape }> {
  const w = await benchWorld(seed, { scene });
  const t = tape(w);
  t.run(30);
  return { w, t };
}

/** Take hold of him where he is (at his middle, a little up) and carry him to `at`, eased, held still there. */
export function lift(w: World, t: Tape, at: Vec3, still = 20): void {
  const a = pitchOf(w).at;
  w.dispatch({ type: 'grab', id: 'pitch', grip: [a[0], a[1] + 0.3, a[2]] });
  t.run(1);
  if (w.holding()?.id !== 'pitch') throw new Error(`Pitch was not taken hold of (${pitchOf(w).state})`);
  const from: Vec3 = [a[0], a[1] + 0.3, a[2]];
  const n = Math.max(30, Math.round((Math.hypot(at[0] - from[0], at[2] - from[2]) / 6) * HZ));
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    const e = k * k * (3 - 2 * k);
    w.dispatch({ type: 'carry', target: [from[0] + (at[0] - from[0]) * e, from[1] + (at[1] - from[1]) * e, from[2] + (at[2] - from[2]) * e] });
    t.run(1);
  }
  for (let i = 0; i < still; i++) {
    w.dispatch({ type: 'carry', target: at });
    t.run(1);
  }
}

/** The hand moves from `at` at `v` for `n` steps and lets go without stating a velocity, as the page does. */
export function fling(w: World, t: Tape, at: Vec3, v: Vec3, n = 10, lens: Lens = LENS): Vec3 {
  let hand: Vec3 = at;
  for (let i = 0; i < n; i++) {
    const k = Math.min(1, (i + 1) / 3) / HZ;
    hand = [hand[0] + v[0] * k, hand[1] + v[1] * k, hand[2] + v[2] * k];
    w.dispatch({ type: 'carry', target: hand });
    t.run(1);
  }
  w.dispatch({ type: 'release', lens });
  t.run(1);
  return hand;
}

/** Steps until he is home (or `max`): the count, or -1. */
export function untilHome(w: World, t: Tape, max = 60 * 30): number {
  for (let i = 0; i < max; i++) {
    if (home(w)) return i;
    t.run(1);
  }
  return home(w) ? max : -1;
}
