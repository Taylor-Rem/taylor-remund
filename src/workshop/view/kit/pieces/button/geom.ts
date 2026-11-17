/**
 * Geometry the Button needs that the shared kit does not have (yet):
 * a label sheet with uv and a lifting corner, painted ribbons lying on a
 * cylinder (the counter's digits), and a stripe clipped to a rectangle (the
 * hazard plate). Candidates for promotion into the kit.
 */
import type { BufferGeometry } from 'three';
import { MeshData, finish } from '../../mesh.ts';

type P2 = readonly [number, number];

/**
 * A thin sheet (label tape, a sticker) lying in the XY plane facing +Z, its
 * centre at the origin, w × h, `t` thick. The face carries uv 0..1 (u along
 * x, v up y). `lift(u, v)` returns how far (in +Z) the sheet stands off the
 * surface at that point: a peeling corner. The back is a separate geometry
 * (`back: true`) so the face can be textured and the back plain.
 */
export function sheet(o: { w: number; h: number; t?: number; nx?: number; ny?: number; lift?: (u: number, v: number) => number; back?: boolean }): BufferGeometry {
  const nx = o.nx ?? 8, ny = o.ny ?? 3;
  const t = o.t ?? 0.003;
  const lift = o.lift ?? (() => 0);
  const md = new MeshData().withUv();
  const zAt = (u: number, v: number): number => lift(u, v);
  const grid: number[][] = [];
  const e = 1e-3;
  for (let j = 0; j <= ny; j++) {
    const row: number[] = [];
    for (let i = 0; i <= nx; i++) {
      const u = i / nx, v = j / ny;
      const x = (u - 0.5) * o.w, y = (v - 0.5) * o.h;
      const z = zAt(u, v);
      // normal from the lift's slope
      const dzdx = (zAt(Math.min(1, u + e), v) - zAt(Math.max(0, u - e), v)) / ((Math.min(1, u + e) - Math.max(0, u - e)) * o.w);
      const dzdy = (zAt(u, Math.min(1, v + e)) - zAt(u, Math.max(0, v - e))) / ((Math.min(1, v + e) - Math.max(0, v - e)) * o.h);
      const s = o.back ? -1 : 1;
      row.push(md.v(x, y, o.back ? z : z + t, -dzdx * s, -dzdy * s, s, u, v));
    }
    grid.push(row);
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) md.quad(grid[j]![i]!, grid[j]![i + 1]!, grid[j + 1]![i + 1]!, grid[j + 1]![i]!);
  if (o.back) {
    // the cut edge: a thin band round the outline, so the tape has a thickness you can see where it lifts
    const ring: Array<[number, number]> = [];
    for (let i = 0; i <= nx; i++) ring.push([i, 0]);
    for (let j = 1; j <= ny; j++) ring.push([nx, j]);
    for (let i = nx - 1; i >= 0; i--) ring.push([i, ny]);
    for (let j = ny - 1; j >= 1; j--) ring.push([0, j]);
    const idx: Array<[number, number]> = [];
    for (const [i, j] of ring) {
      const u = i / nx, v = j / ny;
      const x = (u - 0.5) * o.w, y = (v - 0.5) * o.h, z = zAt(u, v);
      const nxv = u === 0 ? -1 : u === 1 ? 1 : 0, nyv = v === 0 ? -1 : v === 1 ? 1 : 0;
      idx.push([md.v(x, y, z, nxv, nyv, 0), md.v(x, y, z + t, nxv, nyv, 0)]);
    }
    for (let k = 0; k < idx.length; k++) {
      const a = idx[k]!, b = idx[(k + 1) % idx.length]!;
      md.quad(a[0], b[0], b[1], a[1]);
    }
  }
  return finish(md);
}

/**
 * Painted strokes lying on a cylinder of radius r about the Y axis: each
 * stroke is a polyline in (s, a) where s runs along the axis (world units)
 * and a is arc length round the cylinder from the angle `phi0` (world
 * units, positive toward increasing angle). Angle 0 faces local +Z, and
 * angles grow toward local -X. A stroke is a flat ribbon `width` wide,
 * standing `lift` off the surface. Cheap: two triangles per segment.
 */
export function cylinderRibbons(strokes: ReadonlyArray<ReadonlyArray<P2>>, o: { r: number; width: number; lift?: number; phi0?: number }): BufferGeometry {
  const md = new MeshData();
  const R = o.r + (o.lift ?? 0.0006);
  const at = (s: number, a: number, off: number): [number, number, number, number, number, number] => {
    const phi = (o.phi0 ?? 0) + a / R;
    const nx = -Math.sin(phi), nz = Math.cos(phi);
    return [nx * R, s + off, nz * R, nx, 0, nz];
  };
  for (const raw of strokes) {
    if (raw.length < 2) continue;
    // split long runs round the drum: a straight chord across many degrees would sink under the surface
    const maxDa = R * 0.07;
    const st: P2[] = [raw[0]!];
    for (let k = 1; k < raw.length; k++) {
      const p = raw[k - 1]!, q = raw[k]!;
      const n = Math.max(1, Math.ceil(Math.abs(q[1] - p[1]) / maxDa));
      for (let i = 1; i <= n; i++) st.push([p[0] + ((q[0] - p[0]) * i) / n, p[1] + ((q[1] - p[1]) * i) / n]);
    }
    const pairs: Array<[number, number]> = [];
    for (let k = 0; k < st.length; k++) {
      const p = st[k]!;
      // a closed loop (the 0, the 8) joins its ends with a mitre too
      const closed = Math.hypot(st[0]![0] - st[st.length - 1]![0], st[0]![1] - st[st.length - 1]![1]) < 1e-9;
      const prev = k > 0 ? st[k - 1]! : closed ? st[st.length - 2]! : p;
      const next = k < st.length - 1 ? st[k + 1]! : closed ? st[1]! : p;
      // mitred joins: offset along the bisector of the two segments' normals, lengthened (clamped) so corners stay full width
      const unit = (x: number, y: number): [number, number] => {
        const l = Math.hypot(x, y) || 1;
        return [x / l, y / l];
      };
      const d1 = next !== p ? unit(next[0] - p[0], next[1] - p[1]) : unit(p[0] - prev[0], p[1] - prev[1]);
      const d0 = prev !== p ? unit(p[0] - prev[0], p[1] - prev[1]) : d1;
      let [ts, ta] = unit(d0[0] + d1[0], d0[1] + d1[1]);
      if (Math.hypot(d0[0] + d1[0], d0[1] + d1[1]) < 1e-6) [ts, ta] = d0;
      const cosHalf = Math.max(0.5, ts * d1[0] + ta * d1[1]);
      // offset across the stroke (perpendicular in the (s, a) plane)
      const hw = o.width / 2 / cosHalf;
      const ps = -ta * hw, pa = ts * hw;
      const A = at(p[0] + ps, p[1] + pa, 0), B = at(p[0] - ps, p[1] - pa, 0);
      pairs.push([md.v(A[0], A[1], A[2], A[3], A[4], A[5]), md.v(B[0], B[1], B[2], B[3], B[4], B[5])]);
    }
    for (let k = 0; k + 1 < pairs.length; k++) md.quad(pairs[k]![0], pairs[k + 1]![0], pairs[k + 1]![1], pairs[k]![1]);
  }
  return finish(md);
}

/**
 * A cheap knurled band about the Y axis from y = 0 to h: `ridges` straight
 * ridges with flat facets (crease normals, so each facet catches the light
 * on its own), crowns at radius r, valleys `depth` in. Open at both ends:
 * it sits between two lips of a turned part that hide them. 4 triangles a
 * ridge, against the kit knurl's ~30.
 */
export function ridgedBand(r: number, h: number, ridges: number, depth: number): BufferGeometry {
  const md = new MeshData();
  const n = ridges * 2;
  const pt = (k: number): [number, number] => {
    const a = (k / n) * Math.PI * 2;
    const rr = k % 2 === 0 ? r : r - depth;
    return [Math.cos(a) * rr, Math.sin(a) * rr];
  };
  for (let k = 0; k < n; k++) {
    const [x0, z0] = pt(k), [x1, z1] = pt(k + 1);
    // facet normal: perpendicular to the facet in the XZ plane, outward
    let nx = z1 - z0, nz = -(x1 - x0);
    if (nx * (x0 + x1) + nz * (z0 + z1) < 0) {
      nx = -nx;
      nz = -nz;
    }
    const a = md.v(x0, 0, z0, nx, 0, nz), b = md.v(x1, 0, z1, nx, 0, nz), c = md.v(x1, h, z1, nx, 0, nz), d = md.v(x0, h, z0, nx, 0, nz);
    md.quad(a, b, c, d);
  }
  return finish(md);
}

/**
 * A cheap hex bolt head standing on y = 0: six flat flanks, a chamfered top
 * edge (where the highlight lives) and a flat crown. 30 triangles, against
 * the kit hexBolt's ~100; for rows of big bolts on a budget.
 */
export function hexHead(af: number, h: number, spin = 0): BufferGeometry {
  const md = new MeshData();
  const R = af / Math.sqrt(3);
  const c = h * 0.32; // chamfer leg
  const Rt = R - c * 1.1;
  const corner = (k: number, r: number): [number, number] => {
    const a = spin + (k / 6) * Math.PI * 2;
    return [Math.cos(a) * r, Math.sin(a) * r];
  };
  const top = md.v(0, h, 0, 0, 1, 0);
  const crown: number[] = [];
  for (let k = 0; k < 6; k++) {
    const [x, z] = corner(k, Rt);
    crown.push(md.v(x, h, z, 0, 1, 0));
  }
  for (let k = 0; k < 6; k++) md.tri(top, crown[k]!, crown[(k + 1) % 6]!);
  for (let k = 0; k < 6; k++) {
    const k1 = (k + 1) % 6;
    const am = spin + ((k + 0.5) / 6) * Math.PI * 2;
    const fx = Math.cos(am), fz = Math.sin(am);
    // chamfer facet (45°-ish), then the flank
    const [ax, az] = corner(k, Rt), [bx, bz] = corner(k1, Rt);
    const [cx, cz] = corner(k, R), [dx, dz] = corner(k1, R);
    const ch = [md.v(ax, h, az, fx, 1, fz), md.v(bx, h, bz, fx, 1, fz), md.v(dx, h - c, dz, fx, 1, fz), md.v(cx, h - c, cz, fx, 1, fz)];
    md.quad(ch[0]!, ch[1]!, ch[2]!, ch[3]!);
    const fl = [md.v(cx, h - c, cz, fx, 0, fz), md.v(dx, h - c, dz, fx, 0, fz), md.v(dx, 0, dz, fx, 0, fz), md.v(cx, 0, cz, fx, 0, fz)];
    md.quad(fl[0]!, fl[1]!, fl[2]!, fl[3]!);
  }
  return finish(md);
}

/** Clip a convex polygon by the half-plane a·x + b·y <= c (Sutherland–Hodgman). */
function clipHalf(poly: P2[], a: number, b: number, c: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
    const fp = a * p[0] + b * p[1] - c, fq = a * q[0] + b * q[1] - c;
    if (fp <= 0) out.push(p);
    if ((fp < 0 && fq > 0) || (fp > 0 && fq < 0)) {
      const t = fp / (fp - fq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

/**
 * Diagonal stripes (hazard paint) clipped to the rectangle |x| <= hx,
 * |y| <= hy: bands where c0 + k·pitch <= x·dx + y·dy <= c0 + k·pitch + width.
 */
export function stripes(hx: number, hy: number, width: number, pitch: number, dir: P2 = [Math.SQRT1_2, Math.SQRT1_2], c0 = 0): P2[][] {
  const rect: P2[] = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]];
  const reach = Math.abs(hx * dir[0]) + Math.abs(hy * dir[1]);
  const out: P2[][] = [];
  const k0 = Math.floor((-reach - c0) / pitch) - 1, k1 = Math.ceil((reach - c0) / pitch) + 1;
  for (let k = k0; k <= k1; k++) {
    const lo = c0 + k * pitch, hi = lo + width;
    let poly = clipHalf(rect, dir[0], dir[1], hi);
    poly = clipHalf(poly, -dir[0], -dir[1], -lo);
    if (poly.length >= 3 && area(poly) > width * width * 0.05) out.push(poly);
  }
  return out;
}

function area(p: P2[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!, b = p[(i + 1) % p.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

/**
 * The ten digits as strokes in a box 0.6 wide × 1 tall (x right, y up),
 * for printing on the counter's wheels. Drawn, not typed: numerals on a
 * mechanism, not a sentence.
 */
export const DIGIT_STROKES: ReadonlyArray<ReadonlyArray<ReadonlyArray<P2>>> = (() => {
  const loop = (cx: number, cy: number, rx: number, ry: number, n = 10): P2[] => {
    const pts: P2[] = [];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.PI / 2;
      pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
    }
    return pts;
  };
  return [
    [loop(0.3, 0.5, 0.27, 0.48, 9)],
    [[[0.12, 0.78], [0.34, 1.0], [0.34, 0.0]]],
    [[[0.04, 0.8], [0.14, 0.96], [0.32, 1.0], [0.5, 0.94], [0.56, 0.76], [0.48, 0.56], [0.03, 0.02], [0.6, 0.02]]],
    [
      [[0.04, 0.9], [0.28, 1.0], [0.52, 0.9], [0.53, 0.66], [0.26, 0.54]],
      [[0.26, 0.54], [0.54, 0.42], [0.56, 0.14], [0.32, 0.0], [0.03, 0.08]],
    ],
    [[[0.46, 0.0], [0.46, 1.0], [0.02, 0.3], [0.6, 0.3]]],
    [[[0.54, 1.0], [0.1, 1.0], [0.06, 0.56], [0.3, 0.62], [0.54, 0.48], [0.56, 0.2], [0.32, 0.0], [0.03, 0.08]]],
    [[[0.52, 0.94], [0.3, 1.0], [0.08, 0.8], [0.03, 0.3], [0.28, 0.0], [0.54, 0.16], [0.52, 0.48], [0.28, 0.6], [0.06, 0.44]]],
    [[[0.02, 1.0], [0.58, 1.0], [0.22, 0.0]]],
    [loop(0.3, 0.75, 0.21, 0.24, 7), loop(0.3, 0.26, 0.27, 0.27, 8)],
    [[[0.08, 0.06], [0.32, 0.0], [0.52, 0.2], [0.57, 0.7], [0.3, 1.0], [0.06, 0.84], [0.06, 0.56], [0.32, 0.4], [0.54, 0.56]]],
  ];
})();
