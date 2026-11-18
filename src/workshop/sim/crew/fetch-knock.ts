/**
 * Fetch knocked about (REWRITE.md § B5, as amended by Taylor 2026-11-18:
 * "hit by a thrown part it is shoved and spun, not merely bumped into; it
 * wobbles, finds its balance and goes back to its lane"). Pure functions,
 * so the rules are tested alone (tests/unit/sim/fetch-knock.test.ts):
 *
 * - `classify`: how hard a hit was, from the part's speed toward Fetch and
 *   its momentum: nothing, a nudge (only a look), or strength 1, 2 or 3.
 * - `obstacles` / `clearRun`: the knock is scripted and bounded. The slide
 *   is cut short before Fetch's footprint would leave the bench or touch any
 *   machine (every static standing on the bench, and every mouth).
 * - `toyBounce`: Fetch is driven (kinematic), so to the physics engine it is
 *   a wall. The part that hit it is given back the momentum a light toy
 *   would have let it keep (a one-dimensional collision with Fetch's mass).
 */
import type { Id, Vec3 } from '../types.ts';
import type { SceneDesc } from '../scene.ts';
import { yawOf } from '../math.ts';

export type Strength = 1 | 2 | 3;

/** The knock's numbers at P1 size; distances scale with the crew (`SceneDesc.crewScale`), times do not. */
export const KNOCK_TUNING = {
  /** Below this speed toward Fetch (units/s) a hit is a nudge at most. */
  minSpeed: 1.2,
  /** Momentum (mass × speed toward Fetch) at which a hit is a nudge, strength 1, 2 and 3. */
  momentum: [0.04, 0.12, 0.35, 0.8] as readonly [number, number, number, number],
  /** How far it slides at each strength (P1 units; × crewScale). */
  distance: [0.25, 0.55, 0.95] as readonly [number, number, number],
  /** How far round it spins while sliding, in turns. "Shoved and spun". */
  spin: [0.3, 0.6, 1.15] as readonly [number, number, number],
  /** Seconds sliding, then seconds wobbling back to balance: together never over 1.5 s (§ B5: a reaction lasts at most a second and a half). */
  shove: [0.3, 0.42, 0.55] as readonly [number, number, number],
  wobble: [0.5, 0.75, 0.95] as readonly [number, number, number],
  /** A hit this far off the line through Fetch's centre (as a fraction of the part's speed) turns it that way; nearer the middle the turn's sense is a coin toss. */
  offCentre: 0.15,
  /** Clearance kept from the bench edge and from every machine while sliding (P1 units; × crewScale). */
  margin: 0.06,
  /** Samples along the slide when cutting it short. */
  samples: 24,
  /** How long a nudge holds its look (seconds). */
  nudgeLook: 0.8,
} as const;

/** What a hit amounts to: nothing at all, a nudge (a look), or a knock of strength 1-3. */
export function classify(speed: number, momentum: number, T: typeof KNOCK_TUNING = KNOCK_TUNING): 0 | 'nudge' | Strength {
  if (momentum < T.momentum[0] || speed <= 0) return 0;
  if (speed < T.minSpeed || momentum < T.momentum[1]) return 'nudge';
  if (momentum < T.momentum[2]) return 1;
  if (momentum < T.momentum[3]) return 2;
  return 3;
}

/** A footprint on the bench: a box turned about +Y. */
export interface Obstacle {
  readonly id: Id;
  readonly x: number;
  readonly z: number;
  readonly hx: number;
  readonly hz: number;
  /** Radians about +Y. */
  readonly yaw: number;
}

/** Every machine's footprint: the statics that stand on the bench (not the bench itself), and every mouth. */
export function obstacles(scene: SceneDesc): Obstacle[] {
  const top = scene.bench.top;
  const out: Obstacle[] = [];
  for (const s of scene.statics) {
    const yaw = yawOf(s.pose.q);
    const parts = s.shape.type === 'box' ? [{ half: s.shape.half, at: [0, 0, 0] as Vec3 }] : s.shape.parts.map((p) => ({ half: p.half, at: p.at.p }));
    for (const p of parts) {
      const cy = s.pose.p[1] + p.at[1];
      if (cy + p.half[1] <= top + 0.05) continue; // the bench slab (and anything flush with it)
      const c = Math.cos(yaw);
      const sn = Math.sin(yaw);
      out.push({ id: s.id, x: s.pose.p[0] + c * p.at[0] + sn * p.at[2], z: s.pose.p[2] - sn * p.at[0] + c * p.at[2], hx: p.half[0], hz: p.half[2], yaw });
    }
  }
  for (const m of scene.mouths ?? []) out.push({ id: `mouth:${m.id}`, x: m.c[0], z: m.c[2], hx: m.half[0], hz: m.half[2], yaw: ((m.yaw ?? 0) * Math.PI) / 180 });
  return out;
}

/** Distance from (x, z) to the obstacle's box (0 inside). */
export function distanceTo(o: Obstacle, x: number, z: number): number {
  const dx = x - o.x;
  const dz = z - o.z;
  // into the box's frame (a yaw of +a turns +X toward -Z)
  const c = Math.cos(o.yaw);
  const s = Math.sin(o.yaw);
  const lx = c * dx - s * dz;
  const lz = s * dx + c * dz;
  const ox = Math.max(0, Math.abs(lx) - o.hx);
  const oz = Math.max(0, Math.abs(lz) - o.hz);
  return Math.hypot(ox, oz);
}

/**
 * How far along (dx, dz) (a unit vector) from (x, z) a round footprint of `radius` can slide, up to
 * `distance`, without leaving `bench` or coming within `radius` of any obstacle. An obstacle it already
 * touches at the start does not stop it moving away (only getting closer).
 */
export function clearRun(
  x: number,
  z: number,
  dx: number,
  dz: number,
  distance: number,
  radius: number,
  bench: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number },
  obs: readonly Obstacle[],
  samples: number = KNOCK_TUNING.samples,
): number {
  const start = obs.map((o) => distanceTo(o, x, z));
  let ok = 0;
  for (let i = 1; i <= samples; i++) {
    const d = (distance * i) / samples;
    const px = x + dx * d;
    const pz = z + dz * d;
    if (px - radius < bench.minX || px + radius > bench.maxX || pz - radius < bench.minZ || pz + radius > bench.maxZ) break;
    let blocked = false;
    for (let k = 0; k < obs.length; k++) {
      const now = distanceTo(obs[k] as Obstacle, px, pz);
      if (now < radius && now < (start[k] as number) - 1e-9) {
        blocked = true;
        break;
      }
    }
    if (blocked) break;
    ok = d;
  }
  return ok;
}

/**
 * The change of velocity that turns "bounced off a wall" into "bounced off a toy of mass `mToy`": along
 * the line of the hit `n` (a unit vector from the part toward the toy), a part of mass `m` arriving at
 * speed `u` leaves at -e·u off a wall but at (m - e·mToy)/(m + mToy)·u off a free toy. The difference,
 * m(1+e)/(m+mToy)·u along `n`, is given back to it.
 */
export function toyBounce(n: Vec3, u: number, m: number, mToy: number, e: number): Vec3 {
  const k = (u * m * (1 + e)) / (m + mToy);
  return [n[0] * k, 0, n[2] * k];
}
