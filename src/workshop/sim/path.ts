/**
 * Fetch's lane as a path (S5 round 2): several straight runs of tape, joined at corners. The robot
 * rides the path by distance `s` from its first point; at each corner the runs are joined by a circular
 * arc (radius `cornerRadius`, less where the runs are too short for it), so position and heading are
 * continuous: a one-wheeled robot leans round a corner, it does not pivot on the spot.
 *
 * Pure geometry, no state: the simulation moves Fetch along it; the view lays the tape round it
 * (`laneOutline`). Points are ground points (x, z); yaw is radians about +Y, 0 facing +Z.
 */

export type Pt = readonly [number, number];

/** One piece of the ridden path: a straight run, or the arc at a corner. */
type Piece =
  | { readonly kind: 'line'; readonly s0: number; readonly len: number; readonly a: Pt; readonly u: Pt }
  | { readonly kind: 'arc'; readonly s0: number; readonly len: number; readonly c: Pt; readonly r: number; readonly from: Pt; readonly sweep: number; readonly u0: Pt };

export interface LanePath {
  /** The taped points, as given. */
  readonly points: readonly Pt[];
  /** Length of the ridden path (corners rounded), units. */
  readonly length: number;
  /** The corners: where along the path each arc begins and ends, and its radius. */
  readonly corners: readonly { readonly s0: number; readonly s1: number; readonly r: number; readonly turn: number }[];
  /** The ground point at distance `s` (clamped to the path). */
  at(s: number): [number, number];
  /** The direction of travel toward the path's end at `s` (yaw). */
  yaw(s: number): number;
  /** Distance along the path of the point nearest (x, z). */
  nearest(x: number, z: number): number;
}

const rot = (v: Pt, a: number): [number, number] => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)];
const yawOf = (u: Pt): number => Math.atan2(u[0], u[1]);

/** The path through `points` (two or more), corners rounded to `cornerRadius` where the runs allow. */
export function lanePath(points: readonly Pt[], cornerRadius: number): LanePath {
  if (points.length < 2) throw new Error('lane: a path needs two or more points');
  const n = points.length;
  const seg = points.slice(1).map((b, i) => {
    const a = points[i] as Pt;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) throw new Error(`lane: points ${i} and ${i + 1} are the same`);
    return { a, b, len, u: [(b[0] - a[0]) / len, (b[1] - a[1]) / len] as Pt };
  });
  // each interior corner: its turn, and how far back along each run its arc starts (tangent length)
  const corner = Array.from({ length: n }, () => ({ t: 0, r: 0, turn: 0, sign: 1 }));
  for (let i = 1; i < n - 1; i++) {
    const u = (seg[i - 1] as (typeof seg)[number]).u;
    const w = (seg[i] as (typeof seg)[number]).u;
    const cross = u[0] * w[1] - u[1] * w[0];
    const turn = Math.acos(Math.max(-1, Math.min(1, u[0] * w[0] + u[1] * w[1])));
    if (turn < 1e-6) continue;
    const tanHalf = Math.tan(turn / 2);
    // never more than half of a run shared with another corner, nor all of an end run
    const room = Math.min(i - 1 === 0 ? (seg[i - 1] as (typeof seg)[number]).len : (seg[i - 1] as (typeof seg)[number]).len / 2, i === n - 2 ? (seg[i] as (typeof seg)[number]).len : (seg[i] as (typeof seg)[number]).len / 2);
    const t = Math.min(cornerRadius * tanHalf, room);
    corner[i] = { t, r: t / tanHalf, turn, sign: cross >= 0 ? 1 : -1 };
  }
  const pieces: Piece[] = [];
  const corners: { s0: number; s1: number; r: number; turn: number }[] = [];
  let s = 0;
  for (let i = 0; i < n - 1; i++) {
    const g = seg[i] as (typeof seg)[number];
    const t0 = (corner[i] as (typeof corner)[number]).t;
    const t1 = (corner[i + 1] as (typeof corner)[number]).t;
    const a: Pt = [g.a[0] + g.u[0] * t0, g.a[1] + g.u[1] * t0];
    const len = Math.max(0, g.len - t0 - t1);
    pieces.push({ kind: 'line', s0: s, len, a, u: g.u });
    s += len;
    const c = corner[i + 1] as (typeof corner)[number];
    if (i + 1 < n - 1 && c.t > 0) {
      const from: Pt = [g.b[0] - g.u[0] * c.t, g.b[1] - g.u[1] * c.t];
      // the centre: off the run toward the turn
      const nrm: Pt = [-g.u[1] * c.sign, g.u[0] * c.sign];
      const centre: Pt = [from[0] + nrm[0] * c.r, from[1] + nrm[1] * c.r];
      const arcLen = c.r * c.turn;
      pieces.push({ kind: 'arc', s0: s, len: arcLen, c: centre, r: c.r, from: [from[0] - centre[0], from[1] - centre[1]], sweep: c.turn * c.sign, u0: g.u });
      corners.push({ s0: s, s1: s + arcLen, r: c.r, turn: c.turn });
      s += arcLen;
    }
  }
  const length = s;
  const pieceAt = (sv: number): Piece => {
    for (const p of pieces) if (sv <= p.s0 + p.len) return p;
    return pieces[pieces.length - 1] as Piece;
  };
  const clamp = (sv: number): number => Math.min(length, Math.max(0, sv));
  const path: LanePath = {
    points,
    length,
    corners,
    at(sv) {
      const q = clamp(sv);
      const p = pieceAt(q);
      const d = q - p.s0;
      if (p.kind === 'line') return [p.a[0] + p.u[0] * d, p.a[1] + p.u[1] * d];
      const v = rot(p.from, (p.sweep * d) / Math.max(1e-9, p.len));
      return [p.c[0] + v[0], p.c[1] + v[1]];
    },
    yaw(sv) {
      const q = clamp(sv);
      const p = pieceAt(q);
      if (p.kind === 'line') return yawOf(p.u);
      return yawOf(rot(p.u0, (p.sweep * (q - p.s0)) / Math.max(1e-9, p.len)));
    },
    nearest(x, z) {
      let best = 0;
      let bestD = Infinity;
      for (const p of pieces) {
        let cand: number;
        if (p.kind === 'line') cand = p.s0 + Math.min(p.len, Math.max(0, (x - p.a[0]) * p.u[0] + (z - p.a[1]) * p.u[1]));
        else {
          // the angle of the point round the centre, measured from the arc's start in the turn's sense
          const vx = x - p.c[0];
          const vz = z - p.c[1];
          const ang = Math.atan2(p.from[0] * vz - p.from[1] * vx, p.from[0] * vx + p.from[1] * vz) * Math.sign(p.sweep);
          const f = Math.min(1, Math.max(0, ang / Math.abs(p.sweep)));
          cand = p.s0 + f * p.len;
        }
        const [px, pz] = path.at(cand);
        const d = Math.hypot(px - x, pz - z);
        if (d < bestD - 1e-12) [best, bestD] = [cand, d];
      }
      return best;
    },
  };
  return path;
}

/**
 * The tape round a path: a closed outline `half` either side of every run, carried `past` beyond its two
 * ends, mitred at each corner (the tape laid in straight strips, overlapping where they meet). Closed: the
 * last point repeats the first.
 */
export function laneOutline(points: readonly Pt[], half: number, past: number): [number, number][] {
  const n = points.length;
  const u = points.slice(1).map((b, i) => {
    const a = points[i] as Pt;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l] as Pt;
  });
  const first = u[0] as Pt;
  const last = u[u.length - 1] as Pt;
  const p = points.map((q) => [q[0], q[1]] as [number, number]);
  p[0] = [p[0]![0] - first[0] * past, p[0]![1] - first[1] * past];
  p[n - 1] = [p[n - 1]![0] + last[0] * past, p[n - 1]![1] + last[1] * past];
  // one side, then the other: at each point the offset along the bisector of its two runs' normals (a mitre)
  const side = (sg: number): [number, number][] =>
    p.map((q, i) => {
      const a = u[Math.max(0, i - 1)] as Pt;
      const b = u[Math.min(u.length - 1, i)] as Pt;
      const na: Pt = [-a[1] * sg, a[0] * sg];
      const nb: Pt = [-b[1] * sg, b[0] * sg];
      const m: Pt = [na[0] + nb[0], na[1] + nb[1]];
      const ml = Math.hypot(m[0], m[1]) || 1;
      const cos = (m[0] / ml) * na[0] + (m[1] / ml) * na[1];
      const k = half / Math.max(0.2, cos);
      return [q[0] + (m[0] / ml) * k, q[1] + (m[1] / ml) * k];
    });
  const out = [...side(-1), ...side(1).reverse()];
  out.push([out[0]![0], out[0]![1]]);
  return out;
}
