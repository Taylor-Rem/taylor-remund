/**
 * Where a carried thing heads for (W2 brief § 2 "Carry target"): the pointer
 * ray meets a surface, and that point is the `carry` target for the grip.
 *
 * - A loose part (or Fetch, or a unit) rides a surface that is level over the
 *   bench, its bottom a comfortable height (`clearance`) above whatever it is
 *   carried over (the bench, or the top of a machine or another part: see
 *   `levelFor`), eased, faster up than down; near the back it
 *   curves up into an upright face in front of the wall (`surfaceHit`), so
 *   raising the pointer further lifts the thing instead of pushing it into
 *   the wall. A thing taken in the air has that upright face through where it
 *   was taken, so it is held up there and comes down with the pointer. The
 *   grip point stays on the pointer's ray, i.e. under the cursor.
 *   The target is a function of where the pointer is, never of how fast it
 *   moves: nothing here switches on a speed (2026-11-20: a fast lift used to
 *   be read as "up" and a slow one as "back", and at the speed between the
 *   two the hold flickered).
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
  /** The corner at the foot of the upright face a thing caught in flight is held on (a small round, so even a low catch is on the face). */
  catchFillet: 0.08,
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
  /** The surface's level now (the grip's height on its level part). */
  private h = 0;
  /** What it is carried over: the top of what the pointer was last on (the bench's, or a thing's). */
  private level = 0;
  /** Taken in the air: the depth (z) its upright face stands at, through where it was taken; null: in front of the wall. */
  private face: number | null = null;
  /** Taken hold of in the air (its bottom above what is under it by more than the carry's clearance, or flying). */
  caught = false;
  /**
   * The target's motion at the last call that was the surface's own and not the pointer's (its level easing over
   * what is under it), units/s. A throw is the hand's: this is taken out of it (`Lens.drift`).
   */
  drift: Vec3 = [0, 0, 0];
  private lastT = 0;
  /** Where the hold was at the last call (a new level is chosen nearest to it). */
  private last: Vec3 | null = null;
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

  /** Where the upright face stands now (z): where it was taken in the air, else in front of the wall. */
  get faceDepth(): number {
    return this.face ?? this.homeFace();
  }

  private homeFace(): number {
    const s = this.shape;
    const halfZ = s?.kind === 'part' ? s.halfZ : 0.2;
    return Math.max(this.tuning.backLine + halfZ + this.tuning.footprintPad, this.bench.minZ + halfZ);
  }

  /**
   * Start carrying: `grip` is where it was taken (world). `flying`: it was in the air and moving (the world says).
   * Taken from where it rests, it lifts to the carrying height over what it sits on. Caught in flight it is held
   * where it was caught: on an upright face through that point, wherever over the bench that is (it comes down with
   * the pointer and goes up with it, at that depth, so a juggle stays put; found by the browser's juggling tests
   * 2026-11-20: a low catch used to go on a level and walk back with the next flick, and one behind the back line
   * snapped forward to it). Taken out of a hand or off a perch without flying, it starts at the grip and eases down.
   */
  begin(shape: CarryShape, grip: Vec3, t: number, obstacles: Iterable<Obstacle>, flying = false): void {
    this.shape = shape;
    this.lastT = t;
    this.face = null;
    this.drift = [0, 0, 0];
    this.last = grip;
    if (shape.kind === 'part') {
      const T = this.tuning;
      // the plane starts where the lift takes the grip: its bottom `clearance` above what is under it now
      const bottom = grip[1] - shape.gripAboveBottom;
      // what it is over now: the highest thing beneath its bottom (not a thing beside it that stands taller: caught
      // near the back wall, the wall's top, 9 up, was once taken for what it stood on, and the hold went to the ceiling)
      let under = this.bench.top;
      for (const o of obstacles) if (o.top > under && o.top <= bottom + BELOW_SLACK && overlaps(o, grip[0], grip[2], shape.halfX + T.footprintPad, shape.halfZ + T.footprintPad)) under = o.top;
      const carried = Math.min(Math.max(bottom, under), under + 0.05) + T.clearance + shape.gripAboveBottom;
      this.level = under;
      this.caught = flying || bottom > under + T.clearance;
      if (flying && grip[1] >= carried + T.catchFillet) {
        this.h = carried;
        // (exactly where it was caught, even nearer the wall than its footprint as it tumbles would be carried)
        this.face = Math.max(grip[2], this.bench.minZ + 0.05);
      } else this.h = this.caught ? Math.max(grip[1], carried) : carried;
    } else this.caught = false;
  }

  end(): void {
    this.shape = null;
    this.face = null;
    this.drift = [0, 0, 0];
  }

  /**
   * The target for the pointer ray at time `t` (ms). Eases the surface's level by the time since the last call.
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
    const lift = T.clearance + s.gripAboveBottom;
    const all = Array.isArray(obstacles) ? (obstacles as Obstacle[]) : [...obstacles];
    this.level = this.levelFor(ray, all, lift, s.halfX + T.footprintPad, s.halfZ + T.footprintPad, s.halfZ);
    const goal = Math.min(b.ceiling, this.level + lift);
    const h0 = this.h;
    const rate = goal > this.h ? T.rise : T.fall;
    this.h += (goal - this.h) * (1 - Math.exp(-rate * dt));
    const hit = this.hit(ray, this.h);
    const p = this.inBounds(hit.p, s.halfZ);
    // what of that was the surface's own doing: the same pointer on the surface as it was a moment ago
    if (dt > 1e-4 && h0 !== this.h) {
      const was = this.inBounds(this.hit(ray, h0).p, s.halfZ);
      this.drift = [(p[0] - was[0]) / dt, (p[1] - was[1]) / dt, (p[2] - was[2]) / dt];
    } else if (dt > 1e-4) this.drift = [0, 0, 0];
    // caught in flight and now brought down onto the level, in front of where the surface turns up at the back:
    // the upright face is in front of the wall again (the level part only grows behind the hold, so the hold does
    // not move by it)
    if (this.face !== null && hit.theta === 0 && hit.p[2] >= this.homeFace() + T.fillet) this.face = null;
    this.last = p;
    return p;
  }

  private inBounds(p: readonly [number, number, number], halfZ: number): Vec3 {
    const b = this.bench, m = this.tuning.margin;
    const back = this.face !== null ? Math.min(b.minZ + halfZ, this.face) : b.minZ + halfZ;
    return [clamp(p[0], b.minX - m, b.maxX + m), p[1], clamp(p[2], back, b.maxZ + m)];
  }

  /**
   * The level the thing is carried over for this pointer (the bench's top, or the top of a machine or a part).
   * A level MAKES SENSE for a pointer when the thing, carried at it, would stand over something of just that height
   * and into nothing taller. Where the pointer passes above a machine's image, two levels make sense at once: on the
   * bench behind the machine, and over the machine. So the rule is continuity: it stays at the level it has while
   * that makes sense; when it stops making sense (it would run into something, or has left the top it was over) it
   * takes the level that makes sense nearest to where it is; and where none does (in front of a thing too tall to
   * be over yet) it is carried clear, at the lowest level that runs into nothing. (Until 2026-11-20 it took the
   * highest level whose machine it would be over, so a thing carried along the bench BEHIND the console was pulled
   * a unit and a half toward the visitor and up onto it, and every machine it passed above made it hop.)
   */
  private levelFor(ray: RayLike, obstacles: readonly Obstacle[], lift: number, hx: number, hz: number, halfZ: number): number {
    const b = this.bench;
    const tallest = Math.min(this.tuning.top, b.ceiling);
    const probe = (level: number): { q: Vec3; clear: boolean; over: boolean } => {
      const q = this.inBounds(this.hit(ray, level + lift).p, halfZ);
      let clear = true;
      let support = b.top;
      for (const o of obstacles) {
        // (not the bench itself and what is under it; not a wall, which nothing is carried over: the surface's own
        // upright face keeps a carried thing in front of it)
        if (o.top <= b.top || o.top > tallest || !overlaps(o, q[0], q[2], hx, hz)) continue;
        if (o.top <= level + BELOW_SLACK) support = Math.max(support, o.top);
        // (taller, and not something hanging well above the carried thing: it would run into it)
        else if (o.bottom < level + lift + ABOVE_SLACK) clear = false;
      }
      // (over something of just that height: what is under it there stands as high as the level, no lower)
      return { q, clear, over: clear && Math.abs(support - level) <= BELOW_SLACK };
    };
    const cur = probe(this.level);
    if (cur.over) return this.level;
    // On its way over a thing, or off it: it keeps that thing's level while the pointer still has to do with the
    // thing, i.e. while the ray, between where it would hold the part on the bench and where it holds it over the
    // thing, passes over the thing. (Going up the screen onto a tall crate the part first hangs in front of it, at
    // its height; without this it dropped behind the crate as soon as the bench there was free.)
    if (cur.clear && this.level > b.top + BELOW_SLACK) {
      const a = this.inBounds(this.hit(ray, b.top + lift).p, halfZ);
      for (const o of obstacles) if (Math.abs(o.top - this.level) <= BELOW_SLACK && segmentOver(o, a[0], a[2], cur.q[0], cur.q[2], hx, hz)) return this.level;
    }
    const levels = [b.top];
    for (const o of obstacles) if (o.top > b.top && o.top <= tallest && !levels.some((l) => Math.abs(l - o.top) < 1e-6)) levels.push(o.top);
    levels.sort((x, y) => x - y);
    const here = this.last;
    let best: number | null = null;
    let bestD = Infinity;
    let lowestClear: number | null = null;
    for (const l of levels) {
      const pr = probe(l);
      if (pr.clear && lowestClear === null) lowestClear = l;
      if (!pr.over) continue;
      const d = here ? Math.hypot(pr.q[0] - here[0], pr.q[1] - here[1], pr.q[2] - here[2]) : l;
      if (d < bestD) {
        bestD = d;
        best = l;
      }
    }
    return best ?? lowestClear ?? (levels[levels.length - 1] as number);
  }

  /**
   * The carried part's surface with its level at `h`: level over the bench, curving up into an upright face (in
   * front of the wall, or through where the part was taken in the air), up to `top` (or the scene's ceiling).
   */
  hit(ray: RayLike, h: number): SurfaceHit {
    const T = this.tuning;
    const zv = this.faceDepth;
    const r = this.face !== null ? T.catchFillet : T.fillet;
    const top = Math.max(h + r, Math.min(T.top, this.bench.ceiling));
    return surfaceHit(ray, h, zv + r, r, top);
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

const overlaps = (o: Obstacle, x: number, z: number, hx: number, hz: number): boolean => !(o.maxX < x - hx || o.minX > x + hx || o.maxZ < z - hz || o.minZ > z + hz);

/** Does the level segment (x0, z0)-(x1, z1) pass over an obstacle's footprint, grown by (hx, hz)? */
function segmentOver(o: Obstacle, x0: number, z0: number, x1: number, z1: number, hx: number, hz: number): boolean {
  let t0 = 0, t1 = 1;
  const clip = (p: number, d: number, lo: number, hi: number): boolean => {
    if (Math.abs(d) < 1e-12) return p >= lo && p <= hi;
    let a = (lo - p) / d, b = (hi - p) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    return t0 <= t1;
  };
  return clip(x0, x1 - x0, o.minX - hx, o.maxX + hx) && clip(z0, z1 - z0, o.minZ - hz, o.maxZ + hz);
}

/** Obstacles starting this far above the carried part's bottom still count as under it (they are beside it). */
const BELOW_SLACK = 0.05;
/** An obstacle whose bottom is this far above the carried grip's height hangs over the carried part, not in its way. */
const ABOVE_SLACK = 1.0;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
