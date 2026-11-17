/**
 * Felt-toy helpers for Patch (take A, "the felt puppet"). Everything here is
 * geometry the shared kit does not have yet; it lives in this folder until
 * the lead promotes it.
 *
 *  - `radialSolid`: a stuffed form given as a radius per direction from its
 *    centre (a head, a muzzle), and `radialChart`, the same surface as a
 *    (u, v) chart so other pieces can sit on it.
 *  - `appliqué`: a cut-out felt piece sewn onto a chart: a star-shaped
 *    outline, a flat (slightly puffed) top, a rounded raised edge, and a
 *    skirt that tucks into the body under it.
 *  - `stitches`: blanket or running stitches along an outline, as tiny
 *    tapered threads lying on the felt (6 triangles each).
 *  - colour helpers: felt tones mixed from palette tokens (no literals).
 */
import { BufferAttribute, Vector3 } from 'three';
import type { BufferGeometry } from 'three';
import { MeshData, finish } from '../../mesh.ts';
import { deform, transform } from '../../deform.ts';
import { ellipsoid } from '../../solids.ts';
import { T } from '../../compose.ts';
import { linear } from '../../../palette.ts';
import type { Token } from '../../../palette.ts';
import type { Rng } from '../../rng.ts';

export type P2 = readonly [number, number];
export type RGB = [number, number, number];

// ---- colour ---------------------------------------------------------------------

/** A tone mixed from two palette tokens (linear), then scaled: t = 0 is `a`, 1 is `b`. */
export function mixTone(a: Token, b: Token, t: number, shade = 1): RGB {
  const A = linear(a), B = linear(b);
  return [(A[0] + (B[0] - A[0]) * t) * shade, (A[1] + (B[1] - A[1]) * t) * shade, (A[2] + (B[2] - A[2]) * t) * shade];
}

/** Write one linear colour into a geometry's colour attribute, with a little seeded tone jitter. Returns the geometry. */
export function colour(g: BufferGeometry, c: RGB, jitter = 0, R?: Rng): BufferGeometry {
  const k = 1 + (R ? R.spread(jitter) : 0);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c[0] * k;
    arr[i * 3 + 1] = c[1] * k;
    arr[i * 3 + 2] = c[2] * k;
  }
  g.setAttribute('color', new BufferAttribute(arr, 3));
  return g;
}

/** Colour each vertex by a function of its position (bands, blocks). Returns the geometry. */
export function colourBy(g: BufferGeometry, f: (x: number, y: number, z: number) => RGB): BufferGeometry {
  const pos = g.getAttribute('position');
  const arr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = f(pos.getX(i), pos.getY(i), pos.getZ(i));
    arr[i * 3] = c[0];
    arr[i * 3 + 1] = c[1];
    arr[i * 3 + 2] = c[2];
  }
  g.setAttribute('color', new BufferAttribute(arr, 3));
  return g;
}

// ---- radial solids and their charts ----------------------------------------------------

export type RadiusFn = (dx: number, dy: number, dz: number) => number;

/** A stuffed form: a sphere pushed out to `r(direction)` round `centre`. */
export function radialSolid(r: RadiusFn, centre: readonly [number, number, number], segs = 32): BufferGeometry {
  const g = transform(ellipsoid({ rx: 1, ry: 1, rz: 1, segs }), T(0, -1, 0));
  deform(g, (x, y, z) => {
    const l = Math.hypot(x, y, z) || 1;
    const dx = x / l, dy = y / l, dz = z / l;
    // scale the point (not its direction): the map keeps a radial derivative, so normals survive the Jacobian
    const k = r(dx, dy, dz);
    return [centre[0] + x * k, centre[1] + y * k, centre[2] + z * k];
  });
  return g;
}

/** A point and normal on a surface for chart coordinates (u, v). */
export type Chart = (u: number, v: number) => { p: Vector3; n: Vector3 };

/**
 * The chart of a radial solid: (u, v) are yaw and pitch in radians times
 * `scale` (so outlines are drawn in roughly world units), about `frame`'s
 * +Z (yaw toward +X, pitch toward +Y).
 */
export function radialChart(r: RadiusFn, centre: readonly [number, number, number], scale: number, tiltX = 0): Chart {
  const c = new Vector3(centre[0], centre[1], centre[2]);
  const ct = Math.cos(tiltX), st = Math.sin(tiltX);
  const at = (u: number, v: number): Vector3 => {
    const yaw = u / scale, pitch = v / scale;
    let dx = Math.sin(yaw) * Math.cos(pitch), dy = Math.sin(pitch), dz = Math.cos(yaw) * Math.cos(pitch);
    // tilt the chart's pole about X (+ tilts it down), so a chart can centre on the underside of a form
    const ny = dy * ct - dz * st, nz = dy * st + dz * ct;
    dy = ny;
    dz = nz;
    return c.clone().add(new Vector3(dx, dy, dz).multiplyScalar(r(dx, dy, dz)));
  };
  const h = 1e-4;
  return (u, v) => {
    const p = at(u, v);
    const du = at(u + h, v).sub(at(u - h, v));
    const dv = at(u, v + h).sub(at(u, v - h));
    const n = du.cross(dv).normalize();
    // the outward side: away from the centre
    if (n.dot(p.clone().sub(c)) < 0) n.negate();
    return { p, n };
  };
}

/** A flat chart: the XY plane, facing +Z (side 1) or -Z (side -1), at depth z0. */
export function planeChart(side: 1 | -1 = 1, z0 = 0): Chart {
  return (u, v) => ({ p: new Vector3(u, v, z0), n: new Vector3(0, 0, side) });
}

/** A sewn, stuffed flat piece (an ear, a ruff): two pillow appliqués back to back on the XY plane. */
export function pillow(outline: ReadonlyArray<P2>, o: { t: number; edge?: number; puff?: number; back?: number; centre?: P2; rings?: number }): BufferGeometry[] {
  const common = { edge: o.edge ?? o.t * 0.8, sink: 0, ...(o.centre ? { centre: o.centre } : {}), ...(o.rings ? { rings: o.rings } : {}) };
  return [
    applique(planeChart(1), outline, { t: o.t, puff: o.puff ?? 0, ...common }),
    applique(planeChart(-1), outline, { t: o.back ?? o.t, puff: (o.puff ?? 0) * 0.5, ...common }),
  ];
}

// ---- outlines --------------------------------------------------------------------

/** A closed Catmull-Rom curve through control points, `n` samples (counter-clockwise outlines stay so). */
export function smoothLoop(ctrl: ReadonlyArray<P2>, n: number): P2[] {
  const m = ctrl.length;
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * m;
    const k = Math.floor(t), f = t - k;
    const p0 = ctrl[(k - 1 + m) % m]!, p1 = ctrl[k % m]!, p2 = ctrl[(k + 1) % m]!, p3 = ctrl[(k + 2) % m]!;
    const f2 = f * f, f3 = f2 * f;
    const cr = (a: number, b: number, c: number, d: number): number =>
      0.5 * (2 * b + (-a + c) * f + (2 * a - 5 * b + 4 * c - d) * f2 + (-a + 3 * b - 3 * c + d) * f3);
    out.push([cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])]);
  }
  return out;
}

/** An outline turned by `a` radians and moved to (cx, cy). */
export function placeLoop(pts: ReadonlyArray<P2>, cx: number, cy: number, a = 0, sx = 1, sy = 1): P2[] {
  const c = Math.cos(a), s = Math.sin(a);
  return pts.map(([x, y]) => [cx + (x * sx) * c - (y * sy) * s, cy + (x * sx) * s + (y * sy) * c] as const);
}

/** Mirror an outline in u (for the other side of a face), keeping it counter-clockwise. */
export function mirrorLoop(pts: ReadonlyArray<P2>): P2[] {
  return pts.map(([x, y]) => [-x, y] as const).reverse();
}

function centroid(pts: ReadonlyArray<P2>): P2 {
  let x = 0, y = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
  }
  return [x / pts.length, y / pts.length];
}

// ---- appliqué ----------------------------------------------------------------------

export interface AppliqueOptions {
  /** Felt thickness above the surface. */
  t?: number;
  /** Radius of the rounded top edge (≤ t). */
  edge?: number;
  /** Extra dome in the middle (a puffed piece). */
  puff?: number;
  /** How far the skirt tucks below the surface. */
  sink?: number;
  /** The point the outline is star-shaped about (default its centroid). */
  centre?: P2;
  /** Interior rings between the centre and the edge band (default 3). */
  rings?: number;
}

/**
 * A felt cut-out sewn onto a chart: flat top with a soft dome, a rounded
 * raised edge, the cut side, and a skirt into the body. The outline must be
 * star-shaped about its centre.
 */
export function applique(chart: Chart, outline: ReadonlyArray<P2>, o: AppliqueOptions = {}): BufferGeometry {
  const t = o.t ?? 0.006, eb = Math.min(o.edge ?? t * 0.8, t), puff = o.puff ?? 0, sink = o.sink ?? 0.006;
  const C = o.centre ?? centroid(outline);
  const nr = o.rings ?? 3;
  const N = outline.length;
  // ring samples: (fraction toward the edge for the interior | inset from the edge for the band, height)
  type Ring = { s?: number; inset?: number; h: number | null };
  const rings: Ring[] = [];
  for (let k = 1; k <= nr; k++) rings.push({ s: k / (nr + 1), h: null });
  const edgeSegs = 3;
  for (let k = 0; k <= edgeSegs; k++) {
    const a = (k / edgeSegs) * (Math.PI / 2);
    rings.push({ inset: eb - eb * Math.sin(a), h: t - eb + eb * Math.cos(a) });
  }
  rings.push({ inset: -0.0006, h: -sink });
  // positions in (u, v, h)
  const P: Vector3[] = [];
  const grid: number[][] = [];
  const at = (u: number, v: number, h: number): Vector3 => {
    const q = chart(u, v);
    return q.p.addScaledVector(q.n, h);
  };
  const centreTop = t + puff;
  P.push(at(C[0], C[1], centreTop));
  for (let i = 0; i < N; i++) {
    const [ex, ey] = outline[i]!;
    const dx = ex - C[0], dy = ey - C[1];
    const L = Math.hypot(dx, dy) || 1e-6;
    const row: number[] = [];
    for (const rg of rings) {
      let d: number, h: number;
      if (rg.s !== undefined) {
        d = rg.s * (L - eb);
        const q = d / Math.max(1e-6, L - eb);
        h = t + puff * (1 - q * q);
      } else {
        d = L - (rg.inset ?? 0);
        h = rg.h!;
      }
      row.push(P.length);
      P.push(at(C[0] + (dx / L) * d, C[1] + (dy / L) * d, h));
    }
    grid.push(row);
  }
  // triangles (any winding: normals are measured, then MeshData orients by them)
  const tris: Array<[number, number, number]> = [];
  for (let i = 0; i < N; i++) {
    const a = grid[i]!, b = grid[(i + 1) % N]!;
    tris.push([0, a[0]!, b[0]!]);
    for (let k = 0; k < rings.length - 1; k++) {
      tris.push([a[k]!, a[k + 1]!, b[k + 1]!]);
      tris.push([a[k]!, b[k + 1]!, b[k]!]);
    }
  }
  return buildMeasured(P, tris, chart(C[0], C[1]).n);
}

/**
 * Positions + triangles → a finished kit geometry with area-weighted normals,
 * oriented so they agree with `out` on the whole (all our felt pieces face out).
 */
export function buildMeasured(P: Vector3[], tris: ReadonlyArray<readonly [number, number, number]>, out?: Vector3): BufferGeometry {
  const nrm = P.map(() => new Vector3());
  // orient the first triangle's sense by `out`, then keep the given winding consistent
  let flip = false;
  if (out) {
    let s = 0;
    for (const [a, b, c] of tris) s += P[b]!.clone().sub(P[a]!).cross(P[c]!.clone().sub(P[a]!)).dot(out);
    flip = s < 0;
  }
  for (const [a, b, c] of tris) {
    const f = P[b]!.clone().sub(P[a]!).cross(P[c]!.clone().sub(P[a]!));
    if (flip) f.negate();
    nrm[a]!.add(f);
    nrm[b]!.add(f);
    nrm[c]!.add(f);
  }
  const md = new MeshData();
  for (let i = 0; i < P.length; i++) {
    const n = nrm[i]!.lengthSq() > 1e-20 ? nrm[i]!.normalize() : out ?? new Vector3(0, 1, 0);
    md.v(P[i]!.x, P[i]!.y, P[i]!.z, n.x, n.y, n.z);
  }
  for (const [a, b, c] of tris) md.tri(a, b, c);
  return finish(md);
}

// ---- stitches --------------------------------------------------------------------

/** One stitch: a tiny tapered thread from A to B lying along `n` (6 triangles). Appends to md. */
function thread(md: MeshData, A: Vector3, B: Vector3, n: Vector3, w: number): void {
  const d = B.clone().sub(A);
  const L = d.length();
  if (L < 1e-5) return;
  d.normalize();
  const side = n.clone().cross(d).normalize();
  const up = d.clone().cross(side).normalize();
  const mid = A.clone().add(B).multiplyScalar(0.5);
  const ia = md.v(A.x, A.y, A.z, -d.x + up.x * 0.3, -d.y + up.y * 0.3, -d.z + up.z * 0.3);
  const ib = md.v(B.x, B.y, B.z, d.x + up.x * 0.3, d.y + up.y * 0.3, d.z + up.z * 0.3);
  const ring: number[] = [];
  for (let k = 0; k < 3; k++) {
    const a = -Math.PI / 2 + (k / 2) * Math.PI; // a half-round section lying on the felt
    const off = side.clone().multiplyScalar(Math.sin(a) * w).addScaledVector(up, Math.cos(a) * w * 0.8);
    const q = mid.clone().add(off);
    const nn = off.clone().normalize();
    ring.push(md.v(q.x, q.y, q.z, nn.x, nn.y, nn.z));
  }
  for (let k = 0; k < 2; k++) {
    md.tri(ia, ring[k]!, ring[k + 1]!);
    md.tri(ib, ring[k + 1]!, ring[k]!);
  }
  // the underside lies on the felt: never seen, never built
}

export interface StitchOptions {
  /** 'blanket' crosses the edge (perpendicular); 'running' follows it in dashes. */
  kind?: 'blanket' | 'running';
  /** Spacing between stitches along the outline (chart units ≈ world units). */
  pitch?: number;
  /** Stitch length. */
  len?: number;
  /** Thread half-width. */
  w?: number;
  /** How far inside the outline the stitch line runs (running) or starts (blanket). */
  inset?: number;
  /** Height of the felt the stitches lie on (the appliqué's thickness). */
  h?: number;
  /** Seeded wobble in angle and spacing: hand-sewn. */
  R?: Rng;
  /** Only stitch where this says so (u, v). */
  where?: (u: number, v: number) => boolean;
  /** Treat the outline as open (a seam line), not a loop. */
  open?: boolean;
}

/** Stitches along an outline on a chart, as one geometry. */
export function stitches(chart: Chart, outline: ReadonlyArray<P2>, o: StitchOptions = {}): BufferGeometry | null {
  const kind = o.kind ?? 'running', pitch = o.pitch ?? 0.014, len = o.len ?? 0.009, w = o.w ?? 0.0014, inset = o.inset ?? 0.004, h = o.h ?? 0.006;
  const open = o.open ?? false;
  const C = centroid(outline);
  const md = new MeshData();
  // walk the outline by arc length
  const n = outline.length;
  const segsN = open ? n - 1 : n;
  let carry = pitch * 0.5;
  for (let i = 0; i < segsN; i++) {
    const a = outline[i]!, b = outline[(i + 1) % n]!;
    const sl = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let s = carry;
    while (s < sl) {
      const f = s / sl;
      const u = a[0] + (b[0] - a[0]) * f, v = a[1] + (b[1] - a[1]) * f;
      const tu = (b[0] - a[0]) / sl, tv = (b[1] - a[1]) / sl;
      // inward normal: toward the centroid side (open seams: to the left of travel)
      let iu = -tv, iv = tu;
      if (!open && (C[0] - u) * iu + (C[1] - v) * iv < 0) {
        iu = -iu;
        iv = -iv;
      }
      if (!o.where || o.where(u, v)) {
        const wob = o.R ? o.R.spread(0.25) : 0;
        let p0: P2, p1: P2;
        if (kind === 'blanket') {
          const du = iu + tu * wob, dv = iv + tv * wob;
          p0 = [u - iu * inset * 0.2, v - iv * inset * 0.2];
          p1 = [u + du * (inset + len), v + dv * (inset + len)];
        } else {
          const cu = u + iu * inset, cv = v + iv * inset;
          const du = tu + iu * wob * 0.5, dv = tv + iv * wob * 0.5;
          p0 = [cu - (du * len) / 2, cv - (dv * len) / 2];
          p1 = [cu + (du * len) / 2, cv + (dv * len) / 2];
        }
        const q0 = chart(p0[0], p0[1]), q1 = chart(p1[0], p1[1]);
        const h0 = kind === 'blanket' ? h * 0.35 : h, h1 = h;
        thread(md, q0.p.addScaledVector(q0.n, h0 + w * 0.3), q1.p.addScaledVector(q1.n, h1 + w * 0.3), q0.n.clone().add(q1.n).normalize(), w);
      }
      s += pitch * (1 + (o.R ? o.R.spread(0.12) : 0));
    }
    carry = s - sl;
  }
  if (md.vertexCount === 0) return null;
  return finish(md);
}

/** Stitches along a list of 3D points with a fixed normal for each (seams on parts that are not charts). */
export function stitchLine(pts: ReadonlyArray<Vector3>, normals: ReadonlyArray<Vector3>, o: { pitch?: number; len?: number; w?: number; across?: boolean } = {}): BufferGeometry | null {
  const md = new MeshData();
  const pitch = o.pitch ?? 0.016, len = o.len ?? 0.01, w = o.w ?? 0.0015;
  let carry = pitch * 0.5;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    const sl = a.distanceTo(b);
    let s = carry;
    while (s < sl) {
      const f = s / sl;
      const p = a.clone().lerp(b, f);
      const n = normals[i]!.clone().lerp(normals[i + 1]!, f).normalize();
      const d = b.clone().sub(a).normalize();
      const dir = o.across ? n.clone().cross(d).normalize() : d;
      thread(md, p.clone().addScaledVector(dir, -len / 2), p.clone().addScaledVector(dir, len / 2), n, w);
      s += pitch;
    }
    carry = s - sl;
  }
  return md.vertexCount ? finish(md) : null;
}
