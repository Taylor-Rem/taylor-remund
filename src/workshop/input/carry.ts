/**
 * Where a carried thing heads for (W2 brief § 2 "Carry target"): the pointer
 * ray meets a surface, and that point is the `carry` target for the grip.
 *
 * - A loose part rides a horizontal plane: its bottom a comfortable height
 *   (`clearance`) above whatever is under it, so the plane rises smoothly
 *   over tall things (eased, faster up than down) and the grip point stays
 *   on the pointer's ray, i.e. under the cursor, as far as the spring allows.
 * - The cord's plug rides a vertical plane just in front of the board, so it
 *   slides over the jacks the way a hand would hold it.
 *
 * The target is clamped to stay over the bench and a little beyond its open
 * edges, so a part can be thrown off on purpose, but never into the back wall.
 * Pure maths on tuples; runs in Node.
 */
import type { Vec3 } from '../sim/types.ts';

export interface RayLike {
  readonly origin: Vec3;
  /** Unit direction. */
  readonly dir: Vec3;
}

/** A footprint and the height of its top: what a carried part must clear. */
export interface Obstacle {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  top: number;
  /** Its lowest point: things resting on top of the carried part (bottom above the part's) are not under it. */
  bottom: number;
}

export interface BenchBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly top: number;
  readonly ceiling: number;
}

/** Tune here. */
export const CARRY_TUNING = {
  /** Height of a carried part's bottom above whatever is under it, units. */
  clearance: 0.35,
  /** How far beyond the open edges (left, right, front) the target may go, units. */
  margin: 0.7,
  /** Easing of the plane's height toward its goal, 1/s: rising (fast, to clear) and falling (a gentler settle). */
  rise: 16,
  fall: 7,
  /** Extra footprint round the part when looking for what is under it, units. */
  footprintPad: 0.04,
  /** The plug's plane sits this far in front of the jacks; and never lower than this. */
  plugStandoff: 0.22,
  plugFloor: 0.15,
} as const;

export type CarryTuning = { -readonly [K in keyof typeof CARRY_TUNING]: number };

export type CarryShape =
  | {
      kind: 'part';
      /** Horizontal half extents of the part's footprint (x, z). */
      halfX: number;
      halfZ: number;
      /** Height of the grip point above the part's lowest point at the grab. */
      gripAboveBottom: number;
    }
  | { kind: 'plug'; /** z of the board's jacks. */ jackZ: number };

/** The point where a ray meets the plane y = h (or the far point along a ray that never comes down to it). */
export function rayAtHeight(ray: RayLike, h: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const dy = ray.dir[1];
  const t = dy < -1e-6 ? (h - ray.origin[1]) / dy : 1e4;
  const tt = t > 0 ? t : 0;
  out[0] = ray.origin[0] + ray.dir[0] * tt;
  out[1] = h;
  out[2] = ray.origin[2] + ray.dir[2] * tt;
  return out;
}

/** The point where a ray meets the plane z = zp. */
export function rayAtDepth(ray: RayLike, zp: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const dz = ray.dir[2];
  const t = Math.abs(dz) > 1e-6 ? (zp - ray.origin[2]) / dz : 1e4;
  const tt = t > 0 ? t : 0;
  out[0] = ray.origin[0] + ray.dir[0] * tt;
  out[1] = ray.origin[1] + ray.dir[1] * tt;
  out[2] = zp;
  return out;
}

/**
 * The highest top among obstacles whose footprint overlaps the rectangle and
 * whose bottom is below `below`, never less than `floor`.
 */
export function floorUnder(x: number, z: number, hx: number, hz: number, obstacles: Iterable<Obstacle>, floor: number, below = Infinity): number {
  let top = floor;
  for (const o of obstacles) {
    if (o.bottom >= below) continue;
    if (o.maxX < x - hx || o.minX > x + hx || o.maxZ < z - hz || o.minZ > z + hz) continue;
    if (o.top > top) top = o.top;
  }
  return top;
}

export class CarryPlane {
  readonly tuning: CarryTuning;
  private shape: CarryShape | null = null;
  /** The plane's current height (part) and its goal. */
  private h = 0;
  private lastT = 0;
  private readonly p: [number, number, number] = [0, 0, 0];

  private readonly bench: BenchBounds;

  constructor(bench: BenchBounds, tuning: Partial<CarryTuning> = {}) {
    this.bench = bench;
    this.tuning = { ...CARRY_TUNING, ...tuning };
  }

  get active(): boolean {
    return this.shape !== null;
  }

  get height(): number {
    return this.h;
  }

  /** Start carrying: `floor` is the top of whatever the part sits on now (its bottom, when resting). */
  begin(shape: CarryShape, grip: Vec3, t: number, obstacles: Iterable<Obstacle>): void {
    this.shape = shape;
    this.lastT = t;
    if (shape.kind === 'part') {
      // the plane starts where the lift takes the grip: its bottom `clearance` above what is under it now
      const bottom = grip[1] - shape.gripAboveBottom;
      const under = floorUnder(grip[0], grip[2], shape.halfX + this.tuning.footprintPad, shape.halfZ + this.tuning.footprintPad, obstacles, this.bench.top, bottom + BELOW_SLACK);
      this.h = Math.min(Math.max(bottom, under), under + 0.05) + this.tuning.clearance + shape.gripAboveBottom;
    }
  }

  end(): void {
    this.shape = null;
  }

  /**
   * The target for the pointer ray at time `t` (ms). Eases the plane's
   * height by the time since the last call.
   */
  target(ray: RayLike, t: number, obstacles: Iterable<Obstacle>): Vec3 {
    const s = this.shape;
    if (!s) return rayAtHeight(ray, this.bench.top, this.p).slice() as unknown as Vec3;
    const dt = Math.min(0.1, Math.max(0, (t - this.lastT) / 1000));
    this.lastT = Math.max(this.lastT, t);
    const T = this.tuning;
    const b = this.bench;
    if (s.kind === 'plug') {
      const p = rayAtDepth(ray, s.jackZ + T.plugStandoff, this.p);
      return [clamp(p[0], b.minX, b.maxX), clamp(p[1], b.top + T.plugFloor, b.ceiling), p[2]];
    }
    // What the part must clear. Each obstacle is tested at the height the part would ride over
    // it: is the pointer ray, at that height, over its footprint? Testing at the plane's current
    // height instead would feed back (rising moves the ray's point toward the camera, off the
    // obstacle, and the plane would fall again).
    const lift = T.clearance + s.gripAboveBottom;
    let goal = b.top + lift;
    const hx = s.halfX + T.footprintPad;
    const hz = s.halfZ + T.footprintPad;
    // where the part is heading now, at the plane's current height: whatever it is already above stays under it
    const now = rayAtHeight(ray, this.h, this.p);
    const nx = clamp(now[0], b.minX - T.margin, b.maxX + T.margin);
    const nz = clamp(now[2], b.minZ + s.halfZ, b.maxZ + T.margin);
    const bottomNow = this.h - s.gripAboveBottom;
    for (const o of obstacles) {
      const hc = o.top + lift;
      if (hc <= goal) continue;
      if (o.top <= bottomNow + BELOW_SLACK && !(o.maxX < nx - hx || o.minX > nx + hx || o.maxZ < nz - hz || o.minZ > nz + hz)) {
        goal = hc;
        continue;
      }
      const q = rayAtHeight(ray, hc, this.p);
      const x = clamp(q[0], b.minX - T.margin, b.maxX + T.margin);
      const z = clamp(q[2], b.minZ + s.halfZ, b.maxZ + T.margin);
      if (o.maxX < x - hx || o.minX > x + hx || o.maxZ < z - hz || o.minZ > z + hz) continue;
      goal = hc;
    }
    goal = Math.min(b.ceiling, goal);
    const rate = goal > this.h ? T.rise : T.fall;
    this.h += (goal - this.h) * (1 - Math.exp(-rate * dt));
    const p = rayAtHeight(ray, this.h, this.p);
    return [clamp(p[0], b.minX - T.margin, b.maxX + T.margin), this.h, clamp(p[2], b.minZ + s.halfZ, b.maxZ + T.margin)];
  }

  /**
   * Where a part set down at the pointer would land: the top of whatever is
   * under the ray (the spot for tap-then-tap `place`).
   */
  spot(ray: RayLike, halfX: number, halfZ: number, obstacles: Iterable<Obstacle>): Vec3 {
    const b = this.bench;
    let h = b.top;
    // two rounds: the bench point, then the top of what is there
    for (let i = 0; i < 3; i++) {
      const p = rayAtHeight(ray, h, this.p);
      const next = floorUnder(clamp(p[0], b.minX, b.maxX), clamp(p[2], b.minZ, b.maxZ), halfX, halfZ, obstacles, b.top);
      if (Math.abs(next - h) < 1e-4) break;
      h = next;
    }
    const p = rayAtHeight(ray, h, this.p);
    return [clamp(p[0], b.minX + halfX, b.maxX - halfX), h, clamp(p[2], b.minZ + halfZ, b.maxZ - halfZ)];
  }
}

/** Obstacles starting this far above the carried part's bottom still count as under it (they are beside it). */
const BELOW_SLACK = 0.05;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
