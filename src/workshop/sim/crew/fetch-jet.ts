/**
 * Fetch's jetpack (Taylor, 2026-11-19: "when you try to throw them off the table ... the robot could either activate
 * a little jetpack to fly back on"). Over the bench's edge it falls under physics (fetch.ts) until it is out of sight
 * under the edge; this plan takes it from there with the motion it had (Taylor, 2026-11-20: "momentum and animation
 * transitions to flow naturally"): it falls on as it was falling, its jets catch and brake it to a stop clear of the
 * edge, it rises, flies a short arc to the nearest free point of its tape, hovers, cuts the jets, drops the last hair
 * with a bounce. A scripted path (never physics while it flies), planned once when it is taken and read by time;
 * pure, so it is tested alone. Times are seconds, distances world units.
 *
 * Continuity: the path's velocity at t = 0 is `v0` (the body's own), gravity alone bends it until the jets catch,
 * the jets' braking is a constant push of at most `catchAccel` (plus the eased shift out clear of the edge), and
 * every later joint (stop, rise, cruise, hover, descent) is eased so its velocity is the same on both sides.
 */
import type { Vec3 } from '../types.ts';
import type { Obstacle } from './fetch-knock.ts';
import { distanceTo } from './fetch-knock.ts';

export const JET_TUNING = {
  /** Its centre this far below the bench top, past the edge: out of sight under the edge, the script takes it from physics (fetch.ts). */
  takeBelow: 0.8,
  /** The jets catch once its centre is this far below the bench top (below the slab's underside, 1.0): it falls on until then. */
  catchBelow: 1.1,
  /** The jets' braking push when they catch (world units/s²; gravity is 16): a stop in about a third of a second from a hard fall. */
  catchAccel: 40,
  /** The braking takes at least this long (a gentle catch of a slow drop). */
  catchMin: 0.25,
  /** The fall is published for at least this long (the view tells a fall from a standing hop by its first phase). */
  fallMin: 2 / 60,
  /** A hop's crouch before the jets lift it (standing: no fall to catch). */
  ignite: 0.25,
  /** The rise: at least this long, and no faster at its middle than `riseSpeed`. */
  rise: 0.55,
  riseSpeed: 9,
  /** The arc over the bench: at this speed, its length kept between these. */
  cruiseSpeed: 6,
  cruiseMin: 0.45,
  cruiseMax: 1.6,
  hover: 0.25,
  /** Down from the cruise to just above its tape, then the cut, the drop, a bounce. */
  descend: 0.35,
  /** The eased moves (the rise, the cruise, the descent) take long enough that their hardest push stays within this (units/s²; about 3.7 g). */
  ease: 60,
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

/**
 * The fall as planned: from `p0` moving `v0` under gravity for `tA` (to `pA`, moving `vA`), then braked to a stop at
 * `stop` in `tB` by the jets; `d` (x, z) is the shift out clear of the edge, eased in over the whole fall.
 */
export interface JetFall {
  readonly tA: number;
  readonly pA: Vec3;
  readonly vA: Vec3;
  readonly tB: number;
  readonly d: readonly [number, number];
  readonly stop: Vec3;
}

export interface JetPlan {
  /** 'edge': taken falling past the bench's edge; 'hop': from standing (`planHop`). */
  readonly kind: 'edge' | 'hop';
  readonly p0: Vec3;
  readonly v0: Vec3;
  /** Where it rises (x, z), clear of the edge and of every body; the bottom of the fall; the cruise height (centres). */
  readonly out: readonly [number, number];
  readonly deep: number;
  readonly high: number;
  /** Its centre on its tape where it lands, and its centre height there. */
  readonly land: Vec3;
  readonly g: number;
  readonly fall: JetFall;
  /** Its centre's height standing on the bench top. */
  readonly stand: number;
  readonly lengths: Readonly<Record<JetPhase, number>>;
  /** The descent's part of `land` (seconds). */
  readonly descend: number;
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
/** 0 → 1 → 0 over f in [0, 1], with no slope at either end (a bob that joins its neighbours without a kink). */
const bump = (f: number): number => Math.sin(Math.PI * clamp01(f)) ** 2;

type Bench = { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number; readonly top: number };

/** From (x, z), out beyond the edge it is past (or `from` was past, if it is over the footprint) by `r`, and on out until no body stands within `r`. */
function clearOut(x: number, z: number, from: Vec3, b: Bench, r: number, bodies: readonly TallBody[]): [number, number] {
  const side = (px: number, pz: number): [number, number] => [px > b.maxX ? 1 : px < b.minX ? -1 : 0, pz > b.maxZ ? 1 : pz < b.minZ ? -1 : 0];
  let [nx, nz] = side(x, z);
  if (nx === 0 && nz === 0) [nx, nz] = side(from[0], from[2]);
  if (nx === 0 && nz === 0) nz = 1;
  let ox = nx > 0 ? Math.max(x, b.maxX + r) : nx < 0 ? Math.min(x, b.minX - r) : x;
  let oz = nz > 0 ? Math.max(z, b.maxZ + r) : nz < 0 ? Math.min(z, b.minZ - r) : z;
  const l = Math.hypot(nx, nz);
  for (let i = 0; i < 40 && bodies.some((t) => distanceTo(t.o, ox, oz) < r); i++) {
    ox += (nx / l) * 0.1;
    oz += (nz / l) * 0.1;
  }
  return [ox, oz];
}

/** The cruise's height: at least `floor`, and over anything taller standing within `r` of the straight line. */
function cruiseHeight(from: readonly [number, number], to: readonly [number, number], floor: number, half: number, r: number, bodies: readonly TallBody[]): number {
  let high = floor;
  for (let i = 0; i <= 32; i++) {
    const f = i / 32;
    const px = lerp(from[0], to[0], f);
    const pz = lerp(from[1], to[1], f);
    for (const t of bodies) if (distanceTo(t.o, px, pz) < r) high = Math.max(high, t.top + half + JET_TUNING.clear);
  }
  return high;
}

/** The shortest a smooth ease over `by` may take for its hardest push (6 by / t², at its ends) to stay within `ease`. */
const easeTime = (by: number): number => Math.sqrt((6 * Math.abs(by)) / JET_TUNING.ease);
/** The descent from the cruise to just above its tape. */
const descendOf = (high: number, land: number): number => Math.max(JET_TUNING.descend, easeTime(high - land - JET_TUNING.cutAbove));

function lengthsOf(o: { fall: number; ignite: number; riseBy: number; cruiseBy: number; descend: number; g: number }): Record<JetPhase, number> {
  const T = JET_TUNING;
  return {
    fall: o.fall,
    ignite: o.ignite,
    // (a smooth ease peaks at 1.5 times its mean speed)
    rise: Math.max(T.rise, (1.5 * Math.abs(o.riseBy)) / T.riseSpeed, easeTime(o.riseBy)),
    cruise: Math.max(easeTime(o.cruiseBy), Math.min(T.cruiseMax, Math.max(T.cruiseMin, o.cruiseBy / T.cruiseSpeed))),
    hover: T.hover,
    land: o.descend + Math.sqrt((2 * T.cutAbove) / o.g) + T.bounce,
  };
}

/**
 * Plan the flight from where the script takes it (`p0`, moving `v0`: the body's own motion that step) to `land`
 * (x, z on its tape). `half` is its centre's height standing on the bench; `radius` its footprint; `bench` the
 * bench's top and bounds.
 */
export function planJet(o: {
  p0: Vec3;
  v0: Vec3;
  land: readonly [number, number];
  half: number;
  radius: number;
  bench: Bench;
  bodies: readonly TallBody[];
  g: number;
}): JetPlan {
  const T = JET_TUNING;
  const b = o.bench;
  const g = o.g;
  const r = o.radius + T.clear;
  // on under gravity until its centre is `catchBelow` under the top (and for at least `fallMin`)
  const vy = o.v0[1];
  const dy = o.p0[1] - (b.top - T.catchBelow);
  const tDown = dy > 0 ? (vy + Math.sqrt(vy * vy + 2 * g * dy)) / g : 0;
  const tA = Math.max(T.fallMin, tDown);
  const pA: Vec3 = [o.p0[0] + o.v0[0] * tA, o.p0[1] + vy * tA - 0.5 * g * tA * tA, o.p0[2] + o.v0[2] * tA];
  const vA: Vec3 = [o.v0[0], vy - g * tA, o.v0[2]];
  // then braked to a stop by the jets: a constant push of `catchAccel` at most
  const tB = Math.max(T.catchMin, Math.hypot(vA[0], vA[1], vA[2]) / T.catchAccel);
  const raw: Vec3 = [pA[0] + (vA[0] * tB) / 2, pA[1] + (vA[1] * tB) / 2, pA[2] + (vA[2] * tB) / 2];
  const [ox, oz] = clearOut(raw[0], raw[2], o.p0, b, r, o.bodies);
  const stop: Vec3 = [ox, raw[1], oz];
  const high = cruiseHeight([ox, oz], o.land, b.top + T.bottomAt + o.half, o.half, r, o.bodies);
  const land: Vec3 = [o.land[0], b.top + o.half, o.land[1]];
  const descend = descendOf(high, land[1]);
  const lengths = lengthsOf({ fall: tA, ignite: tB, riseBy: high - stop[1], cruiseBy: Math.hypot(o.land[0] - ox, o.land[1] - oz), descend, g });
  const total = Object.values(lengths).reduce((a, c) => a + c, 0);
  const fall: JetFall = { tA, pA, vA, tB, d: [ox - raw[0], oz - raw[2]], stop };
  return { kind: 'edge', p0: o.p0, v0: o.v0, out: [ox, oz], deep: stop[1], high, land, g, fall, stand: b.top + o.half, lengths, descend, total };
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

/** Where the fall has it `u` seconds after the script took it (on through the braking; at the stop after). */
function fallAt(plan: JetPlan, u: number): Vec3 {
  const F = plan.fall;
  const whole = F.tA + F.tB;
  const S = whole > 0 ? smooth(clamp01(u / whole)) : 1;
  let p: Vec3;
  if (u <= F.tA) {
    p = [plan.p0[0] + plan.v0[0] * u, plan.p0[1] + plan.v0[1] * u - 0.5 * plan.g * u * u, plan.p0[2] + plan.v0[2] * u];
  } else {
    const s = Math.min(u - F.tA, F.tB);
    const k = F.tB > 0 ? s - (s * s) / (2 * F.tB) : 0;
    p = [F.pA[0] + F.vA[0] * k, F.pA[1] + F.vA[1] * k, F.pA[2] + F.vA[2] * k];
  }
  return [p[0] + F.d[0] * S, p[1], p[2] + F.d[1] * S];
}

/** Where it is `t` seconds after the script took it. */
export function jetAt(plan: JetPlan, t: number): JetAt {
  const T = JET_TUNING;
  const L = plan.lengths;
  const stop = plan.fall.stop;
  let u = Math.max(0, t);
  for (const phase of ORDER) {
    const len = L[phase];
    if (u < len || phase === 'land') {
      const f = len > 0 ? clamp01(u / len) : 1;
      const at = (p: Vec3, thrust: number, cut = false): JetAt => ({ p, phase, phaseTime: Math.min(u, len), phaseLength: len, thrust, cut, done: t >= plan.total });
      switch (phase) {
        case 'fall':
          return at(fallAt(plan, u), 0);
        case 'ignite':
          // from a fall: the jets catch it and brake it to a stop; from standing (a hop): a little sag as they bite
          if (plan.kind === 'edge') return at(fallAt(plan, L.fall + u), f);
          return at([stop[0], stop[1] - 0.06 * bump(f), stop[2]], f);
        case 'rise':
          return at([plan.out[0], lerp(stop[1], plan.high, smooth(f)), plan.out[1]], 1);
        case 'cruise':
          return at([lerp(plan.out[0], plan.land[0], smooth(f)), plan.high + T.bow * bump(f), lerp(plan.out[1], plan.land[2], smooth(f))], 0.7);
        case 'hover':
          return at([plan.land[0], plan.high + 0.03 * bump(f), plan.land[2]], 0.5);
        case 'land': {
          const above = plan.land[1] + T.cutAbove;
          if (u < plan.descend) return at([plan.land[0], lerp(plan.high, above, smooth(u / plan.descend)), plan.land[2]], 0.4 * (1 - u / plan.descend));
          const drop = Math.sqrt((2 * T.cutAbove) / plan.g);
          const d = u - plan.descend;
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

/**
 * R4: a hop on its jets from where it came to rest on the bench but cannot stay (on a crate, the stack, the tray, or
 * wedged against something): no fall; the jets catch where it stands, it rises, flies the short arc to `land` and
 * comes down as from any flight. The same phases and the same `jetAt`.
 */
export function planHop(o: Parameters<typeof planJet>[0]): JetPlan {
  const T = JET_TUNING;
  const stand = Math.max(o.p0[1], o.bench.top + o.half);
  // rise clear of anything it stands among: at least `bottomAt` over the bench, over where it stands now, and over
  // anything taller within its footprint of the straight line to `land`
  const r = o.radius + T.clear;
  const from: [number, number] = [o.p0[0], o.p0[2]];
  const high = cruiseHeight(from, o.land, Math.max(o.bench.top + T.bottomAt + o.half, stand + T.clear + 0.4), o.half, r, o.bodies);
  const stop: Vec3 = [o.p0[0], stand, o.p0[2]];
  const descend = descendOf(high, o.bench.top + o.half);
  const lengths = lengthsOf({ fall: 0, ignite: T.ignite, riseBy: high - stand, cruiseBy: Math.hypot(o.land[0] - o.p0[0], o.land[1] - o.p0[2]), descend, g: o.g });
  const total = Object.values(lengths).reduce((a, c) => a + c, 0);
  const fall: JetFall = { tA: 0, pA: stop, vA: [0, 0, 0], tB: 0, d: [0, 0], stop };
  return { kind: 'hop', p0: stop, v0: [0, 0, 0], out: from, deep: stand, high, land: [o.land[0], o.bench.top + o.half, o.land[1]], g: o.g, fall, stand, lengths, descend, total };
}
