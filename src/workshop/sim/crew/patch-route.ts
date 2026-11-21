/**
 * Patch's way back to its stool (R2): round the bench's fixed bodies, never through them, with the route
 * planner Fetch uses (`fetch-route.ts`: a round footprint, straight where clear, else through way points just
 * off the bodies' corners). Two things are Patch's own:
 *
 * - where it stands is never inside a body: a set-down point, or where the ledge's haul lands, is first moved
 *   to the nearest point clear of every body by its footprint (`clearPoint`);
 * - the belt closes the strip in front of it off from the rest of the bench (except the long way round the
 *   dock), so Patch may cross it: up onto the rail, two quick steps across while the belt carries it the way it
 *   runs, and down on the far side. A crossing costs `crossCost` units on top of the legs either side, so a way
 *   round is taken where it is not much longer. A crossing is made only where the belt cannot carry it to a
 *   machine before it is off again (`safe`: clear of the motor end, the striker and the ramp at the fastest
 *   surface speed). Pure: tested alone (tests/unit/sim/patch-route.test.ts).
 */
import type { Obstacle } from './fetch-knock.ts';
import { distanceTo } from './fetch-knock.ts';
import { legClear, route } from './fetch-route.ts';
import type { SceneDesc } from '../scene.ts';
import { yawOf } from '../math.ts';
import type { Pt } from './fetch-route.ts';

export const PATCH_ROUTE = {
  /** Its footprint (world units): a stuffed raccoon at the crew's scale, feet together. */
  radius: 0.22,
  /** What a crossing of the belt costs, in units of walking, on top of the legs either side. */
  crossCost: 2,
  /** How far off the belt's sides it stands to get on, and lands. */
  railGap: 0.06,
} as const;

/** Bodies whose id starts so are soft: kept off on the way, but a crossing may land on one (and walk off it). */
export const SOFT = 'tape:';

export interface Bench2 {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** The belt, as Patch crosses it: its bed's box (world), the bed's top, and the stretch it may cross on (x). */
export interface BeltCrossing {
  readonly bed: Obstacle;
  readonly top: number;
  /** Where on the belt a crossing may start AND end (x, world): the belt cannot carry it out of here meanwhile. */
  readonly safe: readonly [number, number];
}

/** A way: the points to walk to; and, when it crosses the belt, the crossing at its end (the walk's last point is where it gets on). */
export interface Way {
  readonly points: Pt[];
  readonly cross: { readonly from: Pt; readonly x: number; readonly side: 1 | -1 } | null;
  readonly length: number;
}

const d2 = (a: Pt, b: Pt): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const lengthOf = (from: Pt, pts: readonly Pt[]): number => {
  let l = 0;
  let p = from;
  for (const q of pts) {
    l += d2(p, q);
    p = q;
  }
  return l;
};

/**
 * The nearest point to `p` that is on the bench and clear of every body by `r` (where Patch can stand): `p`
 * itself when it is already. Searched on rings round `p`; null if nothing within 3 units is clear.
 */
export function clearPoint(p: Pt, r: number, bodies: readonly Obstacle[], bench: Bench2): Pt | null {
  const ok = (q: Pt): boolean => q[0] - r >= bench.minX && q[0] + r <= bench.maxX && q[1] - r >= bench.minZ && q[1] + r <= bench.maxZ && bodies.every((o) => distanceTo(o, q[0], q[1]) >= r);
  const inB = (q: Pt): Pt => [Math.min(bench.maxX - r, Math.max(bench.minX + r, q[0])), Math.min(bench.maxZ - r, Math.max(bench.minZ + r, q[1]))];
  const p0 = inB(p);
  if (ok(p0)) return p0;
  for (let ring = 1; ring <= 60; ring++) {
    const rad = ring * 0.05;
    const n = Math.max(12, Math.round(rad * 40));
    let best: Pt | null = null;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const q: Pt = [p0[0] + Math.cos(a) * rad, p0[1] + Math.sin(a) * rad];
      if (ok(q) && (!best || d2(q, p) < d2(best, p))) best = q;
    }
    if (best) return best;
  }
  return null;
}

/** Where a crossing that starts at x on side `side` (+1: the belt's +Z side) gets on, and where it lands with the belt's drift. */
export function crossPoints(belt: BeltCrossing, x: number, side: 1 | -1, drift: number, r: number): { on: Pt; off: Pt } {
  const b = belt.bed;
  const zOn = b.z + side * (b.hz + r + PATCH_ROUTE.railGap);
  const zOff = b.z - side * (b.hz + r + PATCH_ROUTE.railGap);
  return { on: [x, zOn], off: [x + drift, zOff] };
}

/**
 * The way from `from` to `to`: on the ground round the bodies; or, if that is shut or much longer, to the belt,
 * across it, and on. `drift` is how far the belt will carry it while it crosses (signed, +X). Null: shut in.
 */
export function planWay(from: Pt, to: Pt, r: number, bodies: readonly Obstacle[], bench: Bench2, belt: BeltCrossing | null, drift: number): Way | null {
  const ground = route(from, to, r, bodies, bench);
  let best: Way | null = ground ? { points: ground, cross: null, length: lengthOf(from, ground) } : null;
  if (!belt) return best;
  const b = belt.bed;
  const sideOf = (p: Pt): 1 | -1 => (p[1] > b.z ? 1 : -1);
  const side = sideOf(from);
  if (sideOf(to) === side) return best; // the belt is not between them
  // where along the belt: as near as can be to the straight line, inside the stretch it may cross on with the drift
  const lo = belt.safe[0] - Math.min(0, drift), hi = belt.safe[1] - Math.max(0, drift);
  if (lo > hi) return best;
  const tries = [Math.min(hi, Math.max(lo, from[0])), Math.min(hi, Math.max(lo, (from[0] + to[0]) / 2)), Math.min(hi, Math.max(lo, to[0] - drift))];
  for (const x of tries) {
    const { on, off } = crossPoints(belt, x, side, drift, r);
    // (getting on and off: clear of every solid body; a `soft` one, such as Fetch's tape, it may step off the belt onto and leave)
    const solid = bodies.filter((o) => o !== b && !o.id.startsWith(SOFT));
    if (!solid.every((o) => distanceTo(o, on[0], on[1]) >= r) || !solid.every((o) => distanceTo(o, off[0], off[1]) >= r)) continue;
    const a = route(from, on, r, bodies, bench);
    if (!a) continue;
    // landed on a soft body (Fetch's tape runs close behind the belt): off it the shortest way, across it if need be
    const c = route(off, to, r, bodies.filter((o) => !o.id.startsWith(SOFT)), bench);
    if (!c) continue;
    const len = lengthOf(from, a) + PATCH_ROUTE.crossCost + d2(on, off) + lengthOf(off, c);
    if (!best || len < best.length) best = { points: a, cross: { from: on, x, side }, length: len };
  }
  return best;
}

/**
 * Is there a way from `from` to `to` at all (`planWay` would not return null)? The same ways in the same order,
 * stopping at the first that is open: asked of every place Patch might get up at, where which way is shortest does
 * not matter and planning all of them (up to seven routes each) cost a third of a second in one step.
 */
export function wayExists(from: Pt, to: Pt, r: number, bodies: readonly Obstacle[], bench: Bench2, belt: BeltCrossing | null, drift: number): boolean {
  if (route(from, to, r, bodies, bench)) return true;
  if (!belt) return false;
  const b = belt.bed;
  const sideOf = (p: Pt): 1 | -1 => (p[1] > b.z ? 1 : -1);
  const side = sideOf(from);
  if (sideOf(to) === side) return false;
  const lo = belt.safe[0] - Math.min(0, drift), hi = belt.safe[1] - Math.max(0, drift);
  if (lo > hi) return false;
  const tries = [Math.min(hi, Math.max(lo, from[0])), Math.min(hi, Math.max(lo, (from[0] + to[0]) / 2)), Math.min(hi, Math.max(lo, to[0] - drift))];
  const solid = bodies.filter((o) => o !== b && !o.id.startsWith(SOFT));
  const hard = bodies.filter((o) => !o.id.startsWith(SOFT));
  for (const x of tries) {
    const { on, off } = crossPoints(belt, x, side, drift, r);
    if (!solid.every((o) => distanceTo(o, on[0], on[1]) >= r) || !solid.every((o) => distanceTo(o, off[0], off[1]) >= r)) continue;
    if (route(from, on, r, bodies, bench) && route(off, to, r, hard, bench)) return true;
  }
  return false;
}

/** Is the next step clear of `bodies` (dynamic ones: Fetch, a crate) by `r`, or at least no nearer than now? */
export function stepClear(a: Pt, b: Pt, r: number, bodies: readonly Obstacle[]): boolean {
  return legClear(a, b, r, bodies);
}

/** R4: a fixed body in three dimensions (its footprint as an Obstacle, and its height): what a thrown Patch meets. */
export interface Solid extends Obstacle {
  readonly y0: number;
  readonly y1: number;
}

/** Every fixed body standing on the bench (not the slab), with its height. */
export function solidsOf(scene: SceneDesc): Solid[] {
  const top = scene.bench.top;
  const out: Solid[] = [];
  for (const st of scene.statics) {
    const yaw = yawOf(st.pose.q);
    const parts = st.shape.type === 'box' ? [{ half: st.shape.half, at: [0, 0, 0] as const }] : st.shape.parts.map((q) => ({ half: q.half, at: q.at.p }));
    for (const q of parts) {
      const cy = st.pose.p[1] + q.at[1];
      if (cy + q.half[1] <= top + 0.05) continue;
      const c = Math.cos(yaw), sn = Math.sin(yaw);
      out.push({ id: st.id, x: st.pose.p[0] + c * q.at[0] + sn * q.at[2], z: st.pose.p[2] - sn * q.at[0] + c * q.at[2], hx: q.half[0], hz: q.half[2], yaw, y0: cy - q.half[1], y1: cy + q.half[1] });
    }
  }
  return out;
}

/** Is a sphere at (x, y, z) of radius r inside (or touching) a solid? */
export function sphereMeets(o: Solid, x: number, y: number, z: number, r: number): boolean {
  if (y + r < o.y0 || y - r > o.y1) return false;
  const dy = Math.max(0, o.y0 - y, y - o.y1);
  const d = distanceTo(o, x, z);
  return d * d + dy * dy < r * r;
}

/** The way off a body's top from (x, z): out by its nearer side (unit, world x and z). */
export function offTop(o: Obstacle, x: number, z: number): Pt {
  const dx = x - o.x, dz = z - o.z;
  const c = Math.cos(o.yaw), sn = Math.sin(o.yaw);
  const lx = c * dx - sn * dz, lz = sn * dx + c * dz;
  // in the body's frame: along whichever of its axes is the nearer way out
  const alongX = o.hx - Math.abs(lx) < o.hz - Math.abs(lz);
  const l: Pt = alongX ? [lx >= 0 ? 1 : -1, 0] : [0, lz >= 0 ? 1 : -1];
  // back to the world (the inverse of the turn above)
  return [c * l[0] + sn * l[1], -sn * l[0] + c * l[1]];
}
