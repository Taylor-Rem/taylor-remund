/**
 * The dock's roller ramp as the simulation owns it (data plus pure maths):
 * it leaves the belt's far end along +X at the belt's height, runs straight
 * for `approach`, bends by `turn` degrees on `radius` (toward the back,
 * -Z, so it meets a bay turned toward the camera square to its door), runs
 * on for `lead` to the threshold's lip, and falls on an eased curve from
 * `topY` to `sillY` along the way. Past the lip, `lipZ` further on, is the
 * door's origin (the middle of the door on the bench plane): the dock piece
 * is placed there.
 *
 * It is the same shape as the dock piece's own `rampGeom`/`rampAt`
 * (view/kit/pieces/dock/dims.ts), written from the other end: there the
 * door is fixed and the ramp found; here the belt's end is fixed and the
 * door follows. A test holds the two together.
 */
import type { Vec3 } from './types.ts';

export interface RampSpec {
  /** The centre line's start: the roller tops just past the belt's far end. Heading +X. */
  readonly start: Vec3;
  readonly approach: number;
  readonly radius: number;
  /** Degrees of the bend. */
  readonly turn: number;
  /** Straight run from the bend's end to the lip. */
  readonly lead: number;
  /** From the lip to the door's origin. */
  readonly lipZ: number;
  readonly topY: number;
  readonly sillY: number;
  /** Width of the rollers (for the colliders). */
  readonly width: number;
}

export interface RampPoint {
  readonly p: Vec3;
  /** Heading (unit, in XZ): the way things ride. */
  readonly hx: number;
  readonly hz: number;
}

const DEG = Math.PI / 180;

export const rampArc = (r: RampSpec): number => r.radius * r.turn * DEG;
export const rampLength = (r: RampSpec): number => r.approach + rampArc(r) + r.lead;

/** The centre line (roller tops) at distance `s` from the start; past the end it runs on along the last heading. */
export function rampAt(r: RampSpec, sIn: number): RampPoint {
  const s = Math.max(0, sIn);
  const len = rampLength(r);
  const u = Math.min(1, s / len);
  const y = r.topY + (r.sillY - r.topY) * (u * u * (3 - 2 * u));
  const [x0, , z0] = r.start;
  if (s <= r.approach) return { p: [x0 + s, y, z0], hx: 1, hz: 0 };
  const cx = x0 + r.approach;
  const cz = z0 - r.radius;
  const arc = rampArc(r);
  const sa = s - r.approach;
  if (sa <= arc) {
    const th = sa / r.radius;
    return { p: [cx + r.radius * Math.sin(th), y, cz + r.radius * Math.cos(th)], hx: Math.cos(th), hz: -Math.sin(th) };
  }
  const t = r.turn * DEG;
  const hx = Math.cos(t);
  const hz = -Math.sin(t);
  const v = sa - arc;
  return { p: [cx + r.radius * Math.sin(t) + hx * v, y, cz + r.radius * Math.cos(t) + hz * v], hx, hz };
}

/** The door's origin (middle of the door on the bench plane, y 0) and the way in (unit). */
export function rampDoor(r: RampSpec): { origin: Vec3; inward: Vec3; sill: Vec3 } {
  const end = rampAt(r, rampLength(r));
  return { origin: [end.p[0] + end.hx * r.lipZ, 0, end.p[2] + end.hz * r.lipZ], inward: [end.hx, 0, end.hz], sill: end.p };
}

/** Distance along the ramp of the centre-line point nearest (x, z). */
export function rampNearest(r: RampSpec, x: number, z: number): number {
  const len = rampLength(r);
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i <= 64; i++) {
    const s = (len * i) / 64;
    const p = rampAt(r, s).p;
    const d = (p[0] - x) ** 2 + (p[2] - z) ** 2;
    if (d < bd) [bd, best] = [d, s];
  }
  return best;
}
