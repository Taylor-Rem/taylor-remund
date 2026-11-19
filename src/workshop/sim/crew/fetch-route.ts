/**
 * Fetch's way back to its path (S5 round 3): after a knock, or set down by the visitor, it returns to the
 * nearest point of its path. Straight, if that line keeps its footprint clear of the scene's fixed bodies;
 * otherwise the shortest way round them through way points just off the bodies' corners (each corner pushed
 * out by the footprint): round the body in the way by its nearer side, and round the next one if that is in
 * the way too. If no way is clear it is shut in (null) and stays where it is. Pure, so it is tested alone
 * (tests/unit/sim/fetch-route.test.ts).
 */
import type { Obstacle } from './fetch-knock.ts';
import { distanceTo } from './fetch-knock.ts';

export type Pt = readonly [number, number];

/** The fixed bodies Fetch drives round: the obstacles that are statics (not mouths, which are volumes). */
export const bodiesOf = (obs: readonly Obstacle[]): Obstacle[] => obs.filter((o) => !o.id.startsWith('mouth:'));

/** Into a body's own frame (a yaw of +a turns +X toward -Z). */
function local(o: Obstacle, p: Pt): Pt {
  const dx = p[0] - o.x;
  const dz = p[1] - o.z;
  const c = Math.cos(o.yaw);
  const s = Math.sin(o.yaw);
  return [c * dx - s * dz, s * dx + c * dz];
}

/** Distance from point p to segment a-b. */
function pointSeg(p: Pt, a: Pt, b: Pt): number {
  const vx = b[0] - a[0];
  const vz = b[1] - a[1];
  const l2 = vx * vx + vz * vz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vz) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - vx * t, p[1] - a[1] - vz * t);
}

/** Do segments a-b and c-d cross? */
function cross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt): number => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a);
  const d2 = o(c, d, b);
  const d3 = o(a, b, c);
  const d4 = o(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** The least distance between segment a-b and a body's box (0 where they meet). */
export function segmentToBody(o: Obstacle, a: Pt, b: Pt): number {
  const la = local(o, a);
  const lb = local(o, b);
  const inside = (p: Pt): boolean => Math.abs(p[0]) <= o.hx && Math.abs(p[1]) <= o.hz;
  if (inside(la) || inside(lb)) return 0;
  const k: Pt[] = [[-o.hx, -o.hz], [o.hx, -o.hz], [o.hx, o.hz], [-o.hx, o.hz]];
  for (let i = 0; i < 4; i++) if (cross(la, lb, k[i] as Pt, k[(i + 1) % 4] as Pt)) return 0;
  let d = Math.min(distanceTo(o, a[0], a[1]), distanceTo(o, b[0], b[1]));
  for (const q of k) d = Math.min(d, pointSeg(q, la, lb));
  return d;
}

/**
 * Is the leg a→b clear: the footprint (radius r) never closer to a body than r; a leg that starts closer than
 * that (set down against something) may move along it or away, never nearer than it began.
 */
export function legClear(a: Pt, b: Pt, r: number, bodies: readonly Obstacle[]): boolean {
  for (const o of bodies) {
    const allowed = Math.min(r, distanceTo(o, a[0], a[1])) - 1e-9;
    if (segmentToBody(o, a, b) < allowed) return false;
  }
  return true;
}

/** The four points just off a body's corners, `out` beyond its sides in its own frame. */
function cornersOf(o: Obstacle, out: number): Pt[] {
  const c = Math.cos(o.yaw);
  const s = Math.sin(o.yaw);
  return ([[1, 1], [1, -1], [-1, -1], [-1, 1]] as const).map(([sx, sz]) => {
    const lx = sx * (o.hx + out);
    const lz = sz * (o.hz + out);
    return [o.x + c * lx + s * lz, o.z - s * lx + c * lz] as Pt;
  });
}

const dist = (a: Pt, b: Pt): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * The way from `from` to `to` for a round footprint of radius `r`: the way points after `from`, the last
 * `to`; or null when shut in. `bench` keeps way points on the bench by the footprint.
 */
export function route(from: Pt, to: Pt, r: number, bodies: readonly Obstacle[], bench: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number }): Pt[] | null {
  if (legClear(from, to, r, bodies)) return [to];
  const onBench = (p: Pt): boolean => p[0] - r >= bench.minX && p[0] + r <= bench.maxX && p[1] - r >= bench.minZ && p[1] + r <= bench.maxZ;
  const ways = bodies.flatMap((o) => cornersOf(o, r + 0.06)).filter((p) => onBench(p) && bodies.every((o) => distanceTo(o, p[0], p[1]) >= r));
  // the shortest way through the corners (Dijkstra; legs tested as they are reached)
  const nodes: Pt[] = [from, ...ways, to];
  const goal = nodes.length - 1;
  const best = nodes.map(() => Infinity);
  const prev = nodes.map(() => -1);
  const done = nodes.map(() => false);
  best[0] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < nodes.length; i++) if (!done[i] && best[i]! < Infinity && (u < 0 || best[i]! < best[u]!)) u = i;
    if (u < 0) return null; // shut in
    if (u === goal) break;
    done[u] = true;
    for (let v = 1; v < nodes.length; v++) {
      if (done[v]) continue;
      const d = best[u]! + dist(nodes[u]!, nodes[v]!);
      if (d >= best[v]!) continue;
      if (!legClear(nodes[u]!, nodes[v]!, r, bodies)) continue;
      best[v] = d;
      prev[v] = u;
    }
  }
  const out: Pt[] = [];
  for (let i = goal; i > 0; i = prev[i]!) out.unshift(nodes[i]!);
  return out;
}
