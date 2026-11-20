/**
 * Where a carried thing heads for (W2 brief § 2 "Carry target"): the pointer
 * ray meets a surface, and that point is the `carry` target for the grip.
 *
 * - A loose part (or Fetch, or a unit) rides a surface that is level over the
 *   bench, its bottom a comfortable height (`clearance`) above whatever is
 *   under it, so it rises smoothly over tall things (eased, faster up than
 *   down); near the back it curves up into an upright face in front of the
 *   wall (`surfaceHit`), so raising the pointer further lifts the thing
 *   instead of pushing it into the wall. The grip point stays on the
 *   pointer's ray, i.e. under the cursor, as far as the spring allows.
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
  /**
   * (Taylor, 2026-11-20: "once the cursor reaches a certain height, it starts lifting them up rather than trying to
   * continue lifting them backwards") The carry surface is level over the bench and curves up near the back: a
   * quarter-round fillet of radius `fillet` turns it into an upright face whose carried part's back stands at
   * `backLine` (just in front of the switchboard's front, z -3.90; the wall's face is at -5.0), up to `top` (the grip's
   * height). Raising the pointer further up the screen lifts the thing instead of pushing it into the wall.
   */
  backLine: -3.85,
  fillet: 0.6,
  top: 7.5,
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

/** Where a ray meets the carry surface, and where along it. */
export interface SurfaceHit {
  /** The point. */
  readonly p: [number, number, number];
  /**
   * The surface unrolled: distance along its profile, equal to z on the level part and decreasing on round the fillet
   * and up the upright face (so a hand measured in (x, s) moves the same on screen wherever it is).
   */
  readonly s: number;
  /** The slope there: 0 on the level, π/2 on the upright face. */
  readonly theta: number;
}

/**
 * The carry surface's profile in (z, y), the same at every x: level at height `h` in front of `z0`, a quarter-round
 * fillet of radius `r` behind it (centre (z0, h + r)), then upright at z = z0 - r up to `top`. Each piece meets the
 * next with the same slope, so a steady hand moves the point without a jump in place or speed.
 */
export function surfaceHit(ray: RayLike, h: number, z0: number, r: number, top: number): SurfaceHit {
  const [ox, oy, oz] = ray.origin;
  const [dx, dy, dz] = ray.dir;
  const at = (t: number): [number, number, number] => [ox + dx * t, oy + dy * t, oz + dz * t];
  // the level, in front of the fillet
  if (dy < -1e-6) {
    const t = (h - oy) / dy;
    const p = at(Math.max(0, t));
    if (p[2] >= z0) return { p: [p[0], h, p[2]], s: p[2], theta: 0 };
  }
  // the fillet: where the ray leaves the circle, if that is on the lower back quarter
  const ez = oz - z0;
  const ey = oy - (h + r);
  const a = dz * dz + dy * dy;
  if (a > 1e-12) {
    const b = 2 * (ez * dz + ey * dy);
    const c = ez * ez + ey * ey - r * r;
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const t = (-b + Math.sqrt(disc)) / (2 * a);
      const p = at(Math.max(0, t));
      if (t > 0 && p[2] <= z0 && p[1] <= h + r) {
        const theta = Math.atan2(z0 - p[2], h + r - p[1]);
        return { p, s: z0 - r * theta, theta };
      }
    }
  }
  // the upright face
  const zv = z0 - r;
  const base = z0 - (r * Math.PI) / 2;
  if (dz < -1e-6) {
    const t = (zv - oz) / dz;
    const p = at(Math.max(0, t));
    if (p[1] <= top) {
      const y = Math.max(h + r, p[1]);
      return { p: [p[0], y, zv], s: base - (y - h - r), theta: Math.PI / 2 };
    }
  }
  // above the top of the face (a camera that sees higher, the phone's): a ceiling at `top` running back toward the
  // camera, so the thing stays under the pointer (a corner here, not a fillet: it is reached only at the very top)
  if (Math.abs(dy) > 1e-6 && (top - oy) / dy > 0) {
    // (looking down at it from above, or up at it from a camera below it)
    const t = (top - oy) / dy;
    const p = at(t);
    if (p[2] >= zv) return { p: [p[0], top, p[2]], s: base - (top - h - r) - (p[2] - zv), theta: Math.PI };
  }
  // a ray that passes over the top of the face and meets nothing of the surface (the pointer above the highest a
  // thing may be carried, seen from high up): the top of the face, below where the ray crosses it
  const tz = Math.abs(dz) > 1e-6 ? (zv - oz) / dz : 0;
  return { p: [tz > 0 ? ox + dx * tz : ox, top, zv], s: base - (top - h - r), theta: Math.PI / 2 };
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
  /** Taken hold of in the air (its bottom above what is under it by more than the carry's clearance). */
  caught = false;
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
      const carried = Math.min(Math.max(bottom, under), under + 0.05) + this.tuning.clearance + shape.gripAboveBottom;
      // caught in the air: the surface starts where it was caught (the grip on the pointer's ray, no jump) and eases
      // down to the carrying height from there
      this.caught = bottom > under + this.tuning.clearance;
      this.h = this.caught ? Math.max(grip[1], carried) : carried;
    } else this.caught = false;
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
    // where the part is heading now, on the surface at its current height: whatever it is already above stays under it
    const now = this.hit(ray, this.h).p;
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
      // (the surface's level at hc: an obstacle under the upright face, the storefront say, lifts the whole profile)
      const q = this.hit(ray, hc).p;
      const x = clamp(q[0], b.minX - T.margin, b.maxX + T.margin);
      const z = clamp(q[2], b.minZ + s.halfZ, b.maxZ + T.margin);
      if (o.maxX < x - hx || o.minX > x + hx || o.maxZ < z - hz || o.minZ > z + hz) continue;
      goal = hc;
    }
    goal = Math.min(b.ceiling, goal);
    const rate = goal > this.h ? T.rise : T.fall;
    this.h += (goal - this.h) * (1 - Math.exp(-rate * dt));
    const p = this.hit(ray, this.h).p;
    return [clamp(p[0], b.minX - T.margin, b.maxX + T.margin), p[1], clamp(p[2], b.minZ + s.halfZ, b.maxZ + T.margin)];
  }

  /**
   * The carried part's surface with its level at `h`: level over the bench, curving up near the back so the part's
   * back face never passes `backLine`, up to `top` (or the scene's ceiling). (For a plug: its own plane.)
   */
  hit(ray: RayLike, h: number): SurfaceHit {
    const s = this.shape;
    const T = this.tuning;
    const halfZ = s?.kind === 'part' ? s.halfZ : 0.2;
    const zv = Math.max(T.backLine + halfZ + T.footprintPad, this.bench.minZ + halfZ);
    const top = Math.max(h + T.fillet, Math.min(T.top, this.bench.ceiling));
    return surfaceHit(ray, h, zv + T.fillet, T.fillet, top);
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

/**
 * Tune here: holding a thing up (Taylor, 2026-11-20: juggling). While the pointer goes up the screen fast, or while
 * a thing caught in the air is still held up, the hold rises on an upright plane through the thing, facing the room
 * (its depth fixed, as a flick up is read), instead of sliding back along the carry surface; when the
 * pointer slows, stops, or goes down or sideways, it eases back onto the surface. `speed` px/s up the screen (and
 * `ratio` times its sideways speed), over at least `reach` px in the window, is fast; the blend rises with time constant `rise` s and falls with `fall` s;
 * the pointer's speed is taken over its last `window` ms, and a pointer that has not moved for `still` ms is still;
 * a lift up the screen longer than `flick` ms is a carry toward the back, not a flick, and goes back onto the surface.
 */
/**
 * Where the pointer's ray holds a thing up from `anchor`: at the anchor's depth (z fixed, so juggling stays put), its
 * height where the ray crosses that depth, and its x where the ray crosses the plane through the anchor square to the
 * camera's axis (so straight up the screen is straight up in the world, not drifting toward the middle of the view as
 * it would on the depth plane alone). Null for a ray along the depth plane.
 */
export function heldUp(ray: RayLike, anchor: Vec3, forward: Vec3 | null = null): Vec3 | null {
  const [ox, oy, oz] = ray.origin;
  const [dx, dy, dz] = ray.dir;
  if (Math.abs(dz) < 1e-6) return null;
  const kz = (anchor[2] - oz) / dz;
  const y = oy + dy * kz;
  // the plane through the anchor square to the camera's axis (where the screen's columns are world columns: a
  // camera that does not roll keeps x along a column of pixels); without the axis, square to the line of sight
  const lx = anchor[0] - ox, ly = anchor[1] - oy, lz = anchor[2] - oz;
  const f = forward ?? [lx, ly, lz];
  const dn = dx * f[0] + dy * f[1] + dz * f[2];
  const x = Math.abs(dn) > 1e-9 ? ox + dx * ((lx * f[0] + ly * f[1] + lz * f[2]) / dn) : ox + dx * kz;
  return [x, y, anchor[2]];
}

export const UP_HOLD = { speed: 300, reach: 8, ratio: 1.5, rise: 0, fall: 0.15, window: 50, still: 60, flick: 160 } as const;

export class UpHold {
  private readonly hist: { t: number; x: number; y: number }[] = [];
  private w = 0;
  private lastT = 0;
  private anchor: Vec3 | null = null;
  private airborne = false;
  private upSince: number | null = null;
  private out: Vec3 | null = null;

  /** Start a hold: `caught` a thing taken in the air at `grip` (held up where it was taken). */
  begin(t: number, grip: Vec3, caught: boolean): void {
    this.hist.length = 0;
    this.upSince = null;
    this.lastT = t;
    this.airborne = caught;
    this.w = caught ? 1 : 0;
    this.anchor = caught ? grip : null;
    this.out = null;
  }

  /** Where the hold up is anchored while it is up (null on the surface). */
  get anchored(): Vec3 | null {
    return this.anchor;
  }

  /** How much of the hold is on the upright plane now (0 on the surface, 1 up). */
  get blend(): number {
    return this.w;
  }

  /** The hold for the pointer at (x, y) at time t: `onSurface` is the carry surface's point on the same ray. */
  target(ray: RayLike, x: number, y: number, t: number, onSurface: Vec3, top: number, forward: Vec3 | null = null): Vec3 {
    const T = UP_HOLD;
    const last = this.hist[this.hist.length - 1];
    if (!last || last.x !== x || last.y !== y) this.hist.push({ t, x, y });
    while (this.hist.length > 2 && t - (this.hist[1] as { t: number }).t > T.window) this.hist.shift();
    const b = this.hist[this.hist.length - 1] as { t: number; x: number; y: number };
    // where the hand was at the start of its present movement: the oldest sample in the window, but not one it stood
    // still at before setting off (that one starts the movement 10 ms, one event, before the next sample)
    const a = this.hist[0] as { t: number; x: number; y: number };
    let at = a.t;
    const next = this.hist[1];
    if (next && next.t - a.t > T.still) at = next.t - 10;
    const span = (b.t - at) / 1000;
    const moving = t - b.t < T.still && span > 0.004;
    const vx = moving ? (b.x - a.x) / span : 0;
    const up = moving ? -(b.y - a.y) / span : 0;
    // fast, and far enough to be a flick, not a few events of a slow hand arriving together
    const fastUp = up > T.speed && up > T.ratio * Math.abs(vx) && a.y - b.y >= T.reach;
    // a flick is short: a hand that goes on up the screen for longer than `flick` ms is carrying it back, and the
    // hold goes back onto the surface (where a carry toward the back lifts it near the wall)
    if (!fastUp) this.upSince = null;
    else this.upSince ??= t;
    const flicking = fastUp && t - (this.upSince ?? t) <= T.flick;
    // held up after a catch until the hand goes down or sideways
    if (this.airborne && moving && (-up > T.speed * 0.5 || (Math.abs(vx) > T.speed && Math.abs(vx) > T.ratio * Math.max(up, 0)))) this.airborne = false;
    const want = flicking || this.airborne ? 1 : 0;
    const dt = Math.max(0, (t - this.lastT) / 1000);
    this.lastT = Math.max(this.lastT, t);
    const tau = want > this.w ? T.rise : T.fall;
    this.w = tau <= 0 ? want : this.w + (want - this.w) * (1 - Math.exp(-dt / tau));
    if (this.w < 0.005 && want === 0) {
      this.w = 0;
      this.anchor = null;
      this.out = onSurface;
      return onSurface;
    }
    this.anchor ??= this.out ?? onSurface;
    let up3: Vec3 = onSurface;
    const f = heldUp(ray, this.anchor, forward);
    // held up from where it was taken: never below the lower of the surface and where it was taken (a lift over a
    // station raises the surface itself; the hold does not need to)
    const floor = Math.min(onSurface[1], this.anchor[1]);
    if (f && f[1] >= floor - 0.05) up3 = [f[0], Math.min(top, f[1]), f[2]];
    else if (this.airborne) this.airborne = false; // brought down to the surface: on it again
    const w = this.w;
    const out: Vec3 = [onSurface[0] + (up3[0] - onSurface[0]) * w, onSurface[1] + (up3[1] - onSurface[1]) * w, onSurface[2] + (up3[2] - onSurface[2]) * w];
    this.out = out;
    return out;
  }
}
