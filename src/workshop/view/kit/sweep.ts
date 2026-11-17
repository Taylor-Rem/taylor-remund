/**
 * Sweeps: a cross-section carried along a 3D path with rotation-minimising
 * frames (double reflection; no twist flips), optional taper, and ends
 * that are rounded or bevelled rather than cut. Internally a sweep is the
 * loft core with the profile's height running along the path, so a pipe's
 * end can have the same fillets and shoulders as a turned part.
 */
import type { BufferGeometry, Curve } from 'three';
import { Vector3 } from 'three';
import { finish } from './mesh.ts';
import { loft } from './loft.ts';
import type { Frame, V3 } from './loft.ts';
import { circleLoop, profile, rectLoop } from './profile.ts';
import type { Loop, Profile, PSample } from './profile.ts';
import { segs } from './solids.ts';
import type { DetailOpt } from './solids.ts';

/** A path: a dense polyline. */
export interface Path {
  points: Vector3[];
  closed?: boolean;
}

const v3 = (p: Vector3 | readonly [number, number, number]): Vector3 => (p instanceof Vector3 ? p.clone() : new Vector3(p[0], p[1], p[2]));

/** A straight path. */
export function linePath(a: Vector3 | V3, b: Vector3 | V3, n = 1): Path {
  const A = v3(a), B = v3(b);
  const points: Vector3[] = [];
  for (let i = 0; i <= n; i++) points.push(A.clone().lerp(B, i / n));
  return { points };
}

/**
 * A polyline with every interior corner rounded (radius r, `cs` segments per
 * 90°). The workhorse for handles, rails and bent pipes.
 */
export function polylinePath(pts: ReadonlyArray<Vector3 | V3>, r = 0.05, cs = 6): Path {
  const P = pts.map(v3);
  const out: Vector3[] = [];
  const first = P[0];
  if (!first) return { points: [] };
  out.push(first.clone());
  for (let i = 1; i < P.length - 1; i++) {
    const A = P[i - 1]!, B = P[i]!, C = P[i + 1]!;
    const d0 = B.clone().sub(A), d1 = C.clone().sub(B);
    const l0 = d0.length(), l1 = d1.length();
    d0.normalize();
    d1.normalize();
    const theta = Math.acos(Math.max(-1, Math.min(1, d0.dot(d1))));
    if (theta < 1e-3 || r <= 0) {
      out.push(B.clone());
      continue;
    }
    let t = r * Math.tan(theta / 2);
    t = Math.min(t, l0 * 0.49, l1 * 0.49);
    const S = B.clone().addScaledVector(d0, -t), E = B.clone().addScaledVector(d1, t);
    const n = Math.max(2, Math.round((cs * theta) / (Math.PI / 2)));
    // quadratic Bezier S-B-E is close to the circular fillet and is tangent at both ends
    // use a true arc instead: centre along the bisector
    const bis = d1.clone().sub(d0).normalize();
    const rho = t / Math.tan(theta / 2);
    const Cc = B.clone().addScaledVector(bis, Math.sqrt(rho * rho + t * t));
    const a = S.clone().sub(Cc), b = E.clone().sub(Cc);
    for (let k = 0; k <= n; k++) {
      const s = k / n;
      // slerp between a and b
      const ang = theta * s;
      const sinT = Math.sin(theta);
      const w0 = Math.sin(theta - ang) / sinT, w1 = Math.sin(ang) / sinT;
      out.push(Cc.clone().addScaledVector(a, w0).addScaledVector(b, w1));
    }
  }
  out.push(P[P.length - 1]!.clone());
  return { points: dedupe(out) };
}

/** An arc of radius r round `center`, from angle a0 to a1, in the plane spanned by unit axes `x` and `y` (default the XY plane). */
export function arcPath(center: Vector3 | V3, r: number, a0: number, a1: number, n = 16, x: V3 = [1, 0, 0], y: V3 = [0, 1, 0]): Path {
  const C = v3(center);
  const X = v3(x), Y = v3(y);
  const points: Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    points.push(C.clone().addScaledVector(X, Math.cos(a) * r).addScaledVector(Y, Math.sin(a) * r));
  }
  return { points };
}

/** An S-bend from a to b, leaving a and arriving at b along `dir` (a cubic with tangents along dir). */
export function sBendPath(a: Vector3 | V3, b: Vector3 | V3, dir: V3, n = 20): Path {
  const A = v3(a), B = v3(b);
  const D = v3(dir).normalize();
  const reach = Math.abs(B.clone().sub(A).dot(D)) * 0.5;
  const c1 = A.clone().addScaledVector(D, reach), c2 = B.clone().addScaledVector(D, -reach);
  const points: Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    points.push(
      A.clone().multiplyScalar(u * u * u).addScaledVector(c1, 3 * u * u * t).addScaledVector(c2, 3 * u * t * t).addScaledVector(B, t * t * t),
    );
  }
  return { points };
}

/** A helix about the Y axis from y = 0: radius, pitch (rise per turn), turns. For springs. */
export function helixPath(radius: number, pitch: number, turns: number, perTurn = 24): Path {
  const n = Math.max(4, Math.round(turns * perTurn));
  const points: Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * turns * Math.PI * 2;
    points.push(new Vector3(Math.cos(a) * radius, (a / (Math.PI * 2)) * pitch, Math.sin(a) * radius));
  }
  return { points };
}

/** Sample any three.js curve. */
export function curvePath(curve: Curve<Vector3>, n = 32): Path {
  return { points: curve.getSpacedPoints(n) };
}

/** Join paths end to end (dropping duplicate joints). */
export function joinPaths(...paths: Path[]): Path {
  return { points: dedupe(paths.flatMap((p) => p.points)) };
}

/** Split segments longer than `step`. */
function densify(p: Path, step: number): Path {
  const out: Vector3[] = [];
  for (let i = 0; i < p.points.length; i++) {
    const a = p.points[i]!;
    out.push(a.clone());
    const b = p.points[i + 1];
    if (!b) break;
    const n = Math.floor(a.distanceTo(b) / step);
    for (let k = 1; k < n; k++) out.push(a.clone().lerp(b, k / n));
  }
  return p.closed ? { points: out, closed: true } : { points: out };
}

function dedupe(pts: Vector3[]): Vector3[] {
  const out: Vector3[] = [];
  for (const p of pts) {
    const l = out[out.length - 1];
    if (!l || l.distanceToSquared(p) > 1e-14) out.push(p);
  }
  return out;
}

export function pathLength(p: Path): number {
  let L = 0;
  for (let i = 1; i < p.points.length; i++) L += p.points[i]!.distanceTo(p.points[i - 1]!);
  return L;
}

interface RMF {
  l: number[];
  P: Vector3[];
  T: Vector3[];
  N: Vector3[];
  B: Vector3[];
}

/** Rotation-minimising frames by double reflection (Wang et al. 2008). */
function frames(path: Path, up?: V3): RMF {
  const P = path.points;
  const n = P.length;
  const T: Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const a = P[Math.max(0, i - 1)]!, b = P[Math.min(n - 1, i + 1)]!;
    T.push(b.clone().sub(a).normalize());
  }
  const l = [0];
  for (let i = 1; i < n; i++) l.push(l[i - 1]! + P[i]!.distanceTo(P[i - 1]!));
  // initial normal: perpendicular to T0, as close to `up` (or Y, or X) as possible
  const T0 = T[0]!;
  let ref = up ? v3(up) : new Vector3(0, 1, 0);
  if (Math.abs(ref.clone().normalize().dot(T0)) > 0.95) ref = new Vector3(1, 0, 0);
  if (Math.abs(ref.clone().normalize().dot(T0)) > 0.95) ref = new Vector3(0, 0, 1);
  const N0 = ref.clone().addScaledVector(T0, -ref.dot(T0)).normalize();
  const N: Vector3[] = [N0];
  for (let i = 0; i < n - 1; i++) {
    const v1 = P[i + 1]!.clone().sub(P[i]!);
    const c1 = v1.dot(v1);
    if (c1 < 1e-16) {
      N.push(N[i]!.clone());
      continue;
    }
    const rL = N[i]!.clone().addScaledVector(v1, (-2 / c1) * v1.dot(N[i]!));
    const tL = T[i]!.clone().addScaledVector(v1, (-2 / c1) * v1.dot(T[i]!));
    const v2 = T[i + 1]!.clone().sub(tL);
    const c2 = v2.dot(v2);
    const Ni = c2 < 1e-16 ? rL : rL.addScaledVector(v2, (-2 / c2) * v2.dot(rL));
    N.push(Ni.addScaledVector(T[i + 1]!, -Ni.dot(T[i + 1]!)).normalize());
  }
  if (path.closed && n > 2) {
    // distribute the closing twist
    const Nend = N[n - 1]!, Bend = T[n - 1]!.clone().cross(Nend);
    const twist = Math.atan2(N0.dot(Bend), N0.dot(Nend));
    for (let i = 0; i < n; i++) N[i]!.applyAxisAngle(T[i]!, (twist * l[i]!) / l[n - 1]!);
  }
  const B = T.map((t, i) => t.clone().cross(N[i]!).normalize());
  return { l, P, T, N, B };
}

function frameAt(R: RMF, l: number): Frame {
  const L = R.l;
  let i = 0;
  while (i < L.length - 2 && L[i + 1]! < l) i++;
  const span = L[i + 1]! - L[i]! || 1;
  const t = Math.max(0, Math.min(1, (l - L[i]!) / span));
  const lerp = (a: Vector3, b: Vector3): Vector3 => a.clone().lerp(b, t);
  const extra = l < 0 ? l : l > L[L.length - 1]! ? l - L[L.length - 1]! : 0;
  const T = lerp(R.T[i]!, R.T[i + 1]!).normalize();
  const P = lerp(R.P[i]!, R.P[i + 1]!).addScaledVector(T, extra);
  const N = lerp(R.N[i]!, R.N[i + 1]!);
  N.addScaledVector(T, -N.dot(T)).normalize();
  const B = T.clone().cross(N).normalize();
  return { o: [P.x, P.y, P.z], u: [N.x, N.y, N.z], v: [B.x, B.y, B.z], w: [T.x, T.y, T.z] };
}

export interface SweepOptions extends DetailOpt {
  /** Tube radius for the default round section (default 0.03). */
  radius?: number;
  /** Cross-section loop (default: a circle; offsets by `radius`). Use sections.* helpers. */
  section?: Loop;
  /** End treatment: 'round' (default: a fillet of `endRadius`), 'flat' (crisp), 'dome' (a half-round cap). */
  ends?: 'round' | 'flat' | 'dome';
  endRadius?: number;
  /** Radius scale along the path, t in 0..1. */
  taper?: (t: number) => number;
  /** Segments round the section (default 12). */
  segs?: number;
  /** A hint for which way the section's first axis points at the start. */
  up?: V3;
  /** Most distance between rings along the path (default: path length / 48 when tapered, else only the path's own points). */
  step?: number;
  /** A custom profile along the path, in (offset, distance along path from 0 to the path length). Overrides radius/ends. */
  profile?: Profile | PSample[];
}

/** Section helpers: loops whose offset gives the section's size. */
export const sections = {
  /** Round: offset = radius. */
  circle: (n: number): Loop => circleLoop(n),
  /** Rounded rectangle of half-size (hx + o, hz + o) at offset o: the core is (hx, hz). */
  roundRect: (hx: number, hz: number, cornerSegs = 3): Loop => rectLoop(hx, hz, cornerSegs),
};

/** Sweep a section along a path. */
export function sweep(pathIn: Path, o: SweepOptions = {}): BufferGeometry {
  const first = pathIn.points[0];
  let path: Path =
    pathIn.closed && first && pathIn.points[pathIn.points.length - 1]!.distanceToSquared(first) > 1e-12
      ? { points: [...pathIn.points, first.clone()], closed: true }
      : pathIn;
  const step = o.step ?? (o.taper ? pathLength(path) / 48 : 0);
  if (step > 0) path = densify(path, step);
  const R = frames(path, o.up);
  const L = R.l[R.l.length - 1]!;
  const radius = o.radius ?? 0.03;
  const section = o.section ?? circleLoop(segs(o.segs ?? 12, o.detail, 5));
  let samples: PSample[];
  if (o.profile) {
    samples = Array.isArray(o.profile) ? o.profile : o.profile.expand({ detail: o.detail === 'low' ? 0.5 : 1 });
  } else if (path.closed) {
    samples = [
      { o: radius, y: 0, no: 1, ny: 0 },
      { o: radius, y: L, no: 1, ny: 0 },
    ];
  } else {
    const ends = o.ends ?? 'round';
    const er = Math.min(o.endRadius ?? radius * (ends === 'dome' ? 1 : 0.35), L / 2, radius);
    const corner = ends === 'flat' ? { sharp: true } : { fillet: er, segs: ends === 'dome' ? 4 : 2 };
    samples = profile(0, 0).to(radius, 0, corner).to(radius, L, corner).to(0, L).expand({ detail: o.detail === 'low' ? 0.5 : 1 });
  }
  // add rings at the path's own samples between profile samples, so the tube follows the curve
  const rings: PSample[] = [];
  for (let k = 0; k < samples.length; k++) {
    const s = samples[k]!;
    rings.push({ ...s });
    const nx = samples[k + 1];
    if (!nx) continue;
    if (nx.y - s.y > 1e-6) {
      for (const l of R.l) {
        if (l > s.y + 1e-6 && l < nx.y - 1e-6) {
          const t = (l - s.y) / (nx.y - s.y);
          const no = s.no + (nx.no - s.no) * t, ny = s.ny + (nx.ny - s.ny) * t;
          const nl = Math.hypot(no, ny) || 1;
          rings.push({ o: s.o + (nx.o - s.o) * t, y: l, no: no / nl, ny: ny / nl });
        }
      }
    }
  }
  if (o.taper) {
    const f = o.taper;
    const h = 1e-3;
    for (const s of rings) {
      const t = Math.max(0, Math.min(1, s.y / L));
      const k = f(t);
      const dk = (f(Math.min(1, t + h)) - f(Math.max(0, t - h))) / (2 * h) / L;
      // tilt the side normal by the radius slope
      if (Math.abs(s.no) > 0.5) {
        const no = s.no, ny = s.ny - s.o * dk * Math.sign(s.no);
        const nl = Math.hypot(no, ny) || 1;
        s.no = no / nl;
        s.ny = ny / nl;
      }
      s.o *= k;
    }
  }
  return finish(
    loft({
      loops: [section],
      profile: rings,
      frame: (s) => frameAt(R, s.y),
      caps: !path.closed,
    }),
  );
}
