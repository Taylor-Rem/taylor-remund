/**
 * Fetch's jetpack (Taylor, 2026-11-19: "when you try to throw them off the table ... the robot could either activate
 * a little jetpack to fly back on"). Over the bench's edge it falls out of sight for a beat, its jets catch, it rises
 * clear of the edge, flies a short arc to the nearest free point of its tape, hovers, cuts the jets, drops the last
 * hair with a bounce. A scripted path (never physics while it flies), planned once when it goes over and read by
 * time; pure, so it is tested alone. Times are seconds, distances world units.
 */
import type { Vec3 } from '../types.ts';
import type { Obstacle } from './fetch-knock.ts';
import { distanceTo } from './fetch-knock.ts';

export const JET_TUNING = {
  /** From going over the edge to the jets catching: out of sight below the edge (§ the lead: about half a second), longer if it went over high (it falls to below the edge first, then a beat). */
  fall: 0.5,
  beat: 0.12,
  /** Its centre drops to this far below the bench top (its top a hair under the edge). */
  belowEdge: 0.9,
  ignite: 0.25,
  rise: 0.55,
  /** The arc over the bench: at this speed, its length kept between these. */
  cruiseSpeed: 6,
  cruiseMin: 0.45,
  cruiseMax: 1.3,
  hover: 0.25,
  /** Down from the cruise to just above its tape, then the cut, the drop, a bounce. */
  descend: 0.35,
  cutAbove: 0.12,
  bounce: 0.15,
  bounceHeight: 0.03,
  /** Its body's bottom at least this high over the bench while it cruises (clear of anything taller, plus `clear`). */
  bottomAt: 1.2,
  clear: 0.1,
  /** The cruise's bow over its straight line. */
  bow: 0.25,
} as const;

export type JetPhase = 'fall' | 'ignite' | 'rise' | 'cruise' | 'hover' | 'land';

export interface JetPlan {
  readonly p0: Vec3;
  readonly v0: Vec3;
  /** Where it rises (x, z), clear of the edge and of every body; the bottom of the fall; the cruise height (centres). */
  readonly out: readonly [number, number];
  readonly deep: number;
  readonly high: number;
  /** Its centre on its tape where it lands, and its centre height there. */
  readonly land: Vec3;
  readonly g: number;
  /** The fall in two parts: out clear of the edge in `tOut` (never below standing height on the bench top meanwhile, so never into the bench), then down from `yOut` at `vOut`. */
  readonly tOut: number;
  readonly yOut: number;
  readonly vOut: number;
  /** Its centre's height standing on the bench top. */
  readonly stand: number;
  readonly lengths: Readonly<Record<JetPhase, number>>;
  readonly total: number;
}

/** A body on the bench with its top height. */
export interface TallBody {
  readonly o: Obstacle;
  readonly top: number;
}

const smooth = (f: number): number => f * f * (3 - 2 * f);
const clamp01 = (f: number): number => Math.min(1, Math.max(0, f));
const lerp = (a: number, b: number, f: number): number => a + (b - a) * f;

/**
 * Plan the flight from where it went over (`p0`, moving `v0`) to `land` (x, z on its tape). `half` is its centre's
 * height standing on the bench; `radius` its footprint; `bench` the bench's top and bounds.
 */
export function planJet(o: {
  p0: Vec3;
  v0: Vec3;
  land: readonly [number, number];
  half: number;
  radius: number;
  bench: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number; readonly top: number };
  bodies: readonly TallBody[];
  g: number;
}): JetPlan {
  const T = JET_TUNING;
  const b = o.bench;
  const r = o.radius + T.clear;
  // out: beyond the edge it went over by its footprint, then on out until nothing stands within it
  let nx = o.p0[0] > b.maxX ? 1 : o.p0[0] < b.minX ? -1 : 0;
  let nz = o.p0[2] > b.maxZ ? 1 : o.p0[2] < b.minZ ? -1 : 0;
  if (nx === 0 && nz === 0) nz = 1;
  let ox = nx > 0 ? Math.max(o.p0[0], b.maxX + r) : nx < 0 ? Math.min(o.p0[0], b.minX - r) : o.p0[0];
  let oz = nz > 0 ? Math.max(o.p0[2], b.maxZ + r) : nz < 0 ? Math.min(o.p0[2], b.minZ - r) : o.p0[2];
  const l = Math.hypot(nx, nz);
  nx /= l;
  nz /= l;
  for (let i = 0; i < 40 && o.bodies.some((t) => distanceTo(t.o, ox, oz) < r); i++) {
    ox += nx * 0.1;
    oz += nz * 0.1;
  }
  const deep = b.top - T.belowEdge;
  // the cruise: its bottom at `bottomAt`, or over anything taller standing within its footprint of the straight line
  let high = b.top + T.bottomAt + o.half;
  for (let i = 0; i <= 32; i++) {
    const f = i / 32;
    const px = lerp(ox, o.land[0], f);
    const pz = lerp(oz, o.land[1], f);
    for (const t of o.bodies) if (distanceTo(t.o, px, pz) < r) high = Math.max(high, t.top + o.half + T.clear);
  }
  const land: Vec3 = [o.land[0], b.top + o.half, o.land[1]];
  const dist = Math.hypot(o.land[0] - ox, o.land[1] - oz);
  const drop = Math.sqrt((2 * T.cutAbove) / o.g);
  // the fall: to below the edge (from as high as it went over), then a beat out of sight
  const tOut = 0.3;
  const stand = b.top + o.half;
  const yb = o.p0[1] + o.v0[1] * tOut - 0.5 * o.g * tOut * tOut;
  const clamped = yb < stand;
  const yOut = Math.max(yb, stand);
  const vOut = clamped ? 0 : o.v0[1] - o.g * tOut;
  const toDeep = tOut + (vOut + Math.sqrt(Math.max(0, vOut * vOut + 2 * o.g * Math.max(0, yOut - deep)))) / o.g;
  const lengths: Record<JetPhase, number> = {
    fall: Math.max(T.fall, toDeep + T.beat),
    ignite: T.ignite,
    rise: T.rise,
    cruise: Math.min(T.cruiseMax, Math.max(T.cruiseMin, dist / T.cruiseSpeed)),
    hover: T.hover,
    land: T.descend + drop + T.bounce,
  };
  const total = Object.values(lengths).reduce((a, c) => a + c, 0);
  return { p0: o.p0, v0: o.v0, out: [ox, oz], deep, high, land, g: o.g, tOut, yOut, vOut, lengths, total, stand };
}

const ORDER: readonly JetPhase[] = ['fall', 'ignite', 'rise', 'cruise', 'hover', 'land'];

export interface JetAt {
  readonly p: Vec3;
  readonly phase: JetPhase;
  readonly phaseTime: number;
  readonly phaseLength: number;
  readonly thrust: number;
  /** The jets are off (after the cut, in `land`). */
  readonly cut: boolean;
  readonly done: boolean;
}

/** Where it is `t` seconds after going over. */
export function jetAt(plan: JetPlan, t: number): JetAt {
  const T = JET_TUNING;
  const L = plan.lengths;
  // the fall's own path, needed by the phases after it
  const fallAt = (u: number): Vec3 => {
    const k = smooth(clamp01(u / plan.tOut)); // out clear of the edge quickly, before it is below the top
    const stand = plan.stand;
    const y =
      u < plan.tOut
        ? Math.max(stand, plan.p0[1] + plan.v0[1] * u - 0.5 * plan.g * u * u)
        : Math.max(plan.deep, plan.yOut + plan.vOut * (u - plan.tOut) - 0.5 * plan.g * (u - plan.tOut) ** 2);
    return [lerp(plan.p0[0], plan.out[0], k), y, lerp(plan.p0[2], plan.out[1], k)];
  };
  const fallEnd = fallAt(L.fall);
  let u = Math.max(0, t);
  for (const phase of ORDER) {
    const len = L[phase];
    if (u < len || phase === 'land') {
      const f = clamp01(u / len);
      const at = (p: Vec3, thrust: number, cut = false): JetAt => ({ p, phase, phaseTime: Math.min(u, len), phaseLength: len, thrust, cut, done: t >= plan.total });
      switch (phase) {
        case 'fall':
          return at(fallAt(u), 0);
        case 'ignite':
          // the fall caught: a little sag as the jets bite
          return at([fallEnd[0], fallEnd[1] - 0.06 * Math.sin(Math.PI * f), fallEnd[2]], f);
        case 'rise':
          return at([plan.out[0], lerp(fallEnd[1], plan.high, smooth(f)), plan.out[1]], 1);
        case 'cruise':
          return at([lerp(plan.out[0], plan.land[0], smooth(f)), plan.high + T.bow * Math.sin(Math.PI * f), lerp(plan.out[1], plan.land[2], smooth(f))], 0.7);
        case 'hover':
          return at([plan.land[0], plan.high + 0.03 * Math.sin(2 * Math.PI * f), plan.land[2]], 0.5);
        case 'land': {
          const above = plan.land[1] + T.cutAbove;
          if (u < T.descend) return at([plan.land[0], lerp(plan.high, above, smooth(u / T.descend)), plan.land[2]], 0.4 * (1 - u / T.descend));
          const drop = Math.sqrt((2 * T.cutAbove) / plan.g);
          const d = u - T.descend;
          if (d < drop) return at([plan.land[0], above - 0.5 * plan.g * d * d, plan.land[2]], 0, true);
          const bf = clamp01((d - drop) / T.bounce);
          return at([plan.land[0], plan.land[1] + T.bounceHeight * Math.sin(Math.PI * bf), plan.land[2]], 0, true);
        }
      }
    }
    u -= len;
  }
  return { p: plan.land, phase: 'land', phaseTime: L.land, phaseLength: L.land, thrust: 0, cut: true, done: true };
}
