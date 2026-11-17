/**
 * Surface signals: the per-vertex `surf` attribute (x = wear, y = cavity)
 * and vertex colour.
 *
 *  - wear: how convex the surface is at a vertex (edges, corners, rims),
 *    from a discrete curvature estimate over the welded mesh.
 *  - cavity: how concave (creases, grooves, inside fillets), from the same
 *    estimate, plus an ambient-occlusion pass over a whole piece at build
 *    time (`bakeCavity`) so that where one part meets another (a bolt on a
 *    panel, a pipe entering a collar) the junction reads as a crease.
 */
import { BufferAttribute, BufferGeometry, Matrix3, Matrix4 } from 'three';
import { linear } from '../palette.ts';
import type { Token } from '../palette.ts';
import { ATTR } from './types.ts';
import { hash2, rng } from './rng.ts';

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Group vertices that share a position (within `eps`). Returns group id per vertex and the group count. */
export function weld(pos: ArrayLike<number>, eps = 1e-5): { id: Int32Array; groups: number } {
  const n = pos.length / 3;
  const id = new Int32Array(n);
  const map = new Map<string, number>();
  let groups = 0;
  const inv = 1 / eps;
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(pos[i * 3]! * inv)},${Math.round(pos[i * 3 + 1]! * inv)},${Math.round(pos[i * 3 + 2]! * inv)}`;
    let g = map.get(key);
    if (g === undefined) {
      g = groups++;
      map.set(key, g);
    }
    id[i] = g;
  }
  return { id, groups };
}

function indexOf(g: BufferGeometry): ArrayLike<number> {
  if (g.index) return g.index.array;
  const n = g.getAttribute('position').count;
  const a = new Uint32Array(n);
  for (let i = 0; i < n; i++) a[i] = i;
  return a;
}

/**
 * Wear and cavity from discrete curvature. For each vertex, against each
 * welded neighbour q: k = -2 n·(q-p) / |q-p|² (≈ 1/radius of the osculating
 * circle; positive where the surface falls away = convex). Wear is the
 * largest convex k, cavity the largest concave k, each through a smoothstep
 * whose thresholds are curvatures in 1/units (world: 1 unit = Fetch's height).
 */
export function surfFromCurvature(g: BufferGeometry, opts: { wear?: [number, number]; cavity?: [number, number] } = {}): Float32Array {
  const [w0, w1] = opts.wear ?? [10, 45];
  const [c0, cc1] = opts.cavity ?? [6, 30];
  const pos = g.getAttribute('position').array;
  const nrm = g.getAttribute('normal').array;
  const n = pos.length / 3;
  const { id, groups } = weld(pos);
  const rep = new Float32Array(groups * 3);
  for (let i = 0; i < n; i++) {
    const k = id[i]!;
    rep[k * 3] = pos[i * 3]!;
    rep[k * 3 + 1] = pos[i * 3 + 1]!;
    rep[k * 3 + 2] = pos[i * 3 + 2]!;
  }
  const nb: Set<number>[] = Array.from({ length: groups }, () => new Set<number>());
  const idx = indexOf(g);
  for (let t = 0; t < idx.length; t += 3) {
    const a = id[idx[t]!]!, b = id[idx[t + 1]!]!, c = id[idx[t + 2]!]!;
    nb[a]!.add(b).add(c);
    nb[b]!.add(a).add(c);
    nb[c]!.add(a).add(b);
  }
  // a group is a crease if its copies carry different normals (split normals on a sharp edge)
  const gn = new Float32Array(groups * 3);
  const crease = new Uint8Array(groups);
  const seen = new Uint8Array(groups);
  for (let i = 0; i < n; i++) {
    const k = id[i]!;
    const nx = nrm[i * 3]!, ny = nrm[i * 3 + 1]!, nz = nrm[i * 3 + 2]!;
    if (!seen[k]) {
      seen[k] = 1;
      gn[k * 3] = nx; gn[k * 3 + 1] = ny; gn[k * 3 + 2] = nz;
    } else if (gn[k * 3]! * nx + gn[k * 3 + 1]! * ny + gn[k * 3 + 2]! * nz < 0.95) crease[k] = 1;
  }
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const px = pos[i * 3]!, py = pos[i * 3 + 1]!, pz = pos[i * 3 + 2]!;
    const nx = nrm[i * 3]!, ny = nrm[i * 3 + 1]!, nz = nrm[i * 3 + 2]!;
    // Curvature toward each neighbour. A vertex inside a fillet curves away toward neighbours on
    // *opposite* sides; a vertex where a fillet meets a flat curves only toward one side. So wear
    // (cavity) takes the best opposite pair: min(k_a, k_b) over neighbours a, b on opposite sides,
    // which keeps it inside fillets and zero along their tangent lines.
    let c1 = 0, v1 = 0, c2 = 0, v2 = 0;
    const ks: number[] = [];
    const es: number[] = [];
    for (const j of nb[id[i]!]!) {
      if (j === id[i]) continue;
      const ex = rep[j * 3]! - px, ey = rep[j * 3 + 1]! - py, ez = rep[j * 3 + 2]! - pz;
      const e2 = ex * ex + ey * ey + ez * ez;
      if (e2 < 1e-12) continue;
      const k = (-2 * (nx * ex + ny * ey + nz * ez)) / e2;
      if (k > c1) c1 = k;
      if (-k > v1) v1 = -k;
      const el = Math.sqrt(e2);
      ks.push(k);
      es.push(ex / el, ey / el, ez / el);
    }
    for (let a = 0; a < ks.length; a++) {
      for (let b = a + 1; b < ks.length; b++) {
        const d = es[a * 3]! * es[b * 3]! + es[a * 3 + 1]! * es[b * 3 + 1]! + es[a * 3 + 2]! * es[b * 3 + 2]!;
        if (d > -0.6) continue;
        const ka = ks[a]!, kb = ks[b]!;
        const cv = Math.min(ka, kb), cc = Math.min(-ka, -kb);
        if (cv > c2) c2 = cv;
        if (cc > v2) v2 = cc;
      }
    }
    const sharp = crease[id[i]!] === 1;
    out[i * 2] = smooth(w0, w1, sharp ? c1 : c2);
    out[i * 2 + 1] = smooth(c0, cc1, sharp ? v1 : v2);
  }
  return out;
}

// ---- ambient occlusion over a whole piece ---------------------------------

/** A tiny BVH over triangles, for occlusion rays. Built once per piece. */
class Bvh {
  private tri: Float32Array; // 9 floats per triangle
  private order: Uint32Array;
  // node layout: minx miny minz maxx maxy maxz, then (left/first, right/count, leaf flag) in nodeI
  private box: number[] = [];
  private nodeI: number[] = [];

  constructor(tri: Float32Array) {
    this.tri = tri;
    const n = tri.length / 9;
    this.order = new Uint32Array(n);
    for (let i = 0; i < n; i++) this.order[i] = i;
    const cen = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      for (let a = 0; a < 3; a++) cen[i * 3 + a] = (tri[i * 9 + a]! + tri[i * 9 + 3 + a]! + tri[i * 9 + 6 + a]!) / 3;
    }
    if (n > 0) this.build(cen, 0, n);
  }

  private build(cen: Float32Array, start: number, end: number): number {
    const node = this.nodeI.length / 3;
    this.nodeI.push(0, 0, 0);
    let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
    let cmn = [Infinity, Infinity, Infinity], cmx = [-Infinity, -Infinity, -Infinity];
    for (let i = start; i < end; i++) {
      const t = this.order[i]!;
      for (let v = 0; v < 3; v++) {
        const x = this.tri[t * 9 + v * 3]!, y = this.tri[t * 9 + v * 3 + 1]!, z = this.tri[t * 9 + v * 3 + 2]!;
        if (x < mnx) mnx = x; if (x > mxx) mxx = x;
        if (y < mny) mny = y; if (y > mxy) mxy = y;
        if (z < mnz) mnz = z; if (z > mxz) mxz = z;
      }
      for (let a = 0; a < 3; a++) {
        const c = cen[t * 3 + a]!;
        if (c < cmn[a]!) cmn[a] = c;
        if (c > cmx[a]!) cmx[a] = c;
      }
    }
    this.box.push(mnx, mny, mnz, mxx, mxy, mxz);
    const count = end - start;
    if (count <= 4) {
      this.nodeI[node * 3] = start;
      this.nodeI[node * 3 + 1] = count;
      this.nodeI[node * 3 + 2] = 1;
      return node;
    }
    let axis = 0;
    const ext = [cmx[0]! - cmn[0]!, cmx[1]! - cmn[1]!, cmx[2]! - cmn[2]!];
    if (ext[1]! > ext[axis]!) axis = 1;
    if (ext[2]! > ext[axis]!) axis = 2;
    const mid = (cmn[axis]! + cmx[axis]!) / 2;
    let i = start, j = end - 1;
    while (i <= j) {
      if (cen[this.order[i]! * 3 + axis]! < mid) i++;
      else {
        const t = this.order[i]!;
        this.order[i] = this.order[j]!;
        this.order[j] = t;
        j--;
      }
    }
    let split = i;
    if (split === start || split === end) split = (start + end) >> 1;
    const left = this.build(cen, start, split);
    const right = this.build(cen, split, end);
    this.nodeI[node * 3] = left;
    this.nodeI[node * 3 + 1] = right;
    this.nodeI[node * 3 + 2] = 0;
    return node;
  }

  /** Nearest hit distance along the ray within tmax, or Infinity. */
  hit(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tmax: number): number {
    if (this.nodeI.length === 0) return Infinity;
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    const stack: number[] = [0];
    let best = tmax;
    const b = this.box;
    const T = this.tri;
    while (stack.length) {
      const nd = stack.pop()!;
      let t0 = 0, t1 = best;
      let ta = (b[nd * 6]! - ox) * ix, tb = (b[nd * 6 + 3]! - ox) * ix;
      t0 = Math.max(t0, Math.min(ta, tb)); t1 = Math.min(t1, Math.max(ta, tb));
      ta = (b[nd * 6 + 1]! - oy) * iy; tb = (b[nd * 6 + 4]! - oy) * iy;
      t0 = Math.max(t0, Math.min(ta, tb)); t1 = Math.min(t1, Math.max(ta, tb));
      ta = (b[nd * 6 + 2]! - oz) * iz; tb = (b[nd * 6 + 5]! - oz) * iz;
      t0 = Math.max(t0, Math.min(ta, tb)); t1 = Math.min(t1, Math.max(ta, tb));
      if (t0 > t1) continue;
      if (this.nodeI[nd * 3 + 2] === 1) {
        const s = this.nodeI[nd * 3]!, c = this.nodeI[nd * 3 + 1]!;
        for (let k = s; k < s + c; k++) {
          const t = this.order[k]! * 9;
          const ax = T[t]!, ay = T[t + 1]!, az = T[t + 2]!;
          const e1x = T[t + 3]! - ax, e1y = T[t + 4]! - ay, e1z = T[t + 5]! - az;
          const e2x = T[t + 6]! - ax, e2y = T[t + 7]! - ay, e2z = T[t + 8]! - az;
          const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
          const det = e1x * px + e1y * py + e1z * pz;
          if (Math.abs(det) < 1e-12) continue;
          const inv = 1 / det;
          const sx = ox - ax, sy = oy - ay, sz = oz - az;
          const u = (sx * px + sy * py + sz * pz) * inv;
          if (u < 0 || u > 1) continue;
          const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
          const v = (dx * qx + dy * qy + dz * qz) * inv;
          if (v < 0 || u + v > 1) continue;
          const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
          if (tt > 1e-5 && tt < best) best = tt;
        }
      } else {
        stack.push(this.nodeI[nd * 3]!, this.nodeI[nd * 3 + 1]!);
      }
    }
    return best;
  }
}

export interface AoOptions {
  /** Rays per vertex (spread over the vertex and its one-ring). Default 16. */
  samples?: number;
  /** Only occluders nearer than this count (units). Default 0.14. */
  distance?: number;
  /** Occlusion fraction at which cavity starts / is full. Default [0.06, 0.42]. */
  range?: [number, number];
  seed?: number;
}

/**
 * Ambient-occlusion cavity across several geometries that sit together (one
 * piece at rest, already in a shared space). Raises each vertex's surf.y to
 * max(curvature cavity, occlusion). Done once per piece build.
 */
export function bakeCavity(items: ReadonlyArray<BufferGeometry | { geometry: BufferGeometry; matrix?: Matrix4 | undefined }>, opts: AoOptions = {}): void {
  const S = opts.samples ?? 16;
  const D = opts.distance ?? 0.14;
  const [r0, r1] = opts.range ?? [0.06, 0.42];
  const list = items.map((it) => (it instanceof BufferGeometry ? { geometry: it, matrix: undefined } : it));
  // world-space (piece-space) positions and normals per geometry
  const spaces = list.map(({ geometry, matrix }) => {
    const p = geometry.getAttribute('position').array;
    const nr = geometry.getAttribute('normal').array;
    if (!matrix) return { p, nr };
    const e = matrix.elements;
    const nm = new Matrix3().getNormalMatrix(matrix).elements;
    const n = p.length / 3;
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const x = p[i * 3]!, y = p[i * 3 + 1]!, z = p[i * 3 + 2]!;
      P[i * 3] = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!;
      P[i * 3 + 1] = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!;
      P[i * 3 + 2] = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!;
      const a = nr[i * 3]!, b = nr[i * 3 + 1]!, c = nr[i * 3 + 2]!;
      let u = nm[0]! * a + nm[3]! * b + nm[6]! * c, v = nm[1]! * a + nm[4]! * b + nm[7]! * c, w = nm[2]! * a + nm[5]! * b + nm[8]! * c;
      const l = Math.hypot(u, v, w) || 1;
      u /= l; v /= l; w /= l;
      N[i * 3] = u; N[i * 3 + 1] = v; N[i * 3 + 2] = w;
    }
    return { p: P, nr: N };
  });
  let triCount = 0;
  for (const { geometry } of list) triCount += indexOf(geometry).length / 3;
  const tri = new Float32Array(triCount * 9);
  let o = 0;
  list.forEach(({ geometry }, gi) => {
    const p = spaces[gi]!.p;
    const idx = indexOf(geometry);
    for (let t = 0; t < idx.length; t++) {
      const v = idx[t]!;
      tri[o++] = p[v * 3]!;
      tri[o++] = p[v * 3 + 1]!;
      tri[o++] = p[v * 3 + 2]!;
    }
  });
  const bvh = new Bvh(tri);
  // a fixed cosine-weighted direction set (Fibonacci hemisphere), rotated per vertex
  const dirs: number[] = [];
  for (let s = 0; s < S; s++) {
    const u = (s + 0.5) / S;
    const r = Math.sqrt(u);
    const a = s * 2.399963229728653;
    dirs.push(r * Math.cos(a), r * Math.sin(a), Math.sqrt(1 - u));
  }
  const seed = opts.seed ?? 7;
  list.forEach(({ geometry }, gi) => {
    const { p, nr } = spaces[gi]!;
    const surf = geometry.getAttribute(ATTR.surf) as BufferAttribute;
    const n = p.length / 3;
    // one-ring sample points: a vertex stands for the region its triangles interpolate over,
    // so its occlusion is averaged at points part-way toward each adjacent triangle's centroid
    const idx = indexOf(geometry);
    const ringPts: number[][] = Array.from({ length: n }, () => []);
    const area = new Float32Array(n);
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t]!, b = idx[t + 1]!, c = idx[t + 2]!;
      {
        const ux = p[b * 3]! - p[a * 3]!, uy = p[b * 3 + 1]! - p[a * 3 + 1]!, uz = p[b * 3 + 2]! - p[a * 3 + 2]!;
        const vx = p[c * 3]! - p[a * 3]!, vy = p[c * 3 + 1]! - p[a * 3 + 1]!, vz = p[c * 3 + 2]! - p[a * 3 + 2]!;
        const ar = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 6; // a third of the triangle
        area[a] = area[a]! + ar; area[b] = area[b]! + ar; area[c] = area[c]! + ar;
      }
      const cx = (p[a * 3]! + p[b * 3]! + p[c * 3]!) / 3, cy = (p[a * 3 + 1]! + p[b * 3 + 1]! + p[c * 3 + 1]!) / 3, cz = (p[a * 3 + 2]! + p[b * 3 + 2]! + p[c * 3 + 2]!) / 3;
      for (const v of [a, b, c]) {
        const list = ringPts[v]!;
        if (list.length < 18) list.push(p[v * 3]! + (cx - p[v * 3]!) * 0.55, p[v * 3 + 1]! + (cy - p[v * 3 + 1]!) * 0.55, p[v * 3 + 2]! + (cz - p[v * 3 + 2]!) * 0.55);
      }
    }
    for (let i = 0; i < n; i++) {
      const nx = nr[i * 3]!, ny = nr[i * 3 + 1]!, nz = nr[i * 3 + 2]!;
      let tx: number, ty: number, tz: number;
      if (Math.abs(nx) < 0.9) { tx = 0; ty = nz; tz = -ny; } else { tx = -nz; ty = 0; tz = nx; }
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
      // the ray set's rotation comes from the position, so copies of one vertex (seams, poles) agree
      const rot = (hash2(Math.round(p[i * 3]! * 1e4) ^ (Math.round(p[i * 3 + 1]! * 1e4) * 7919), Math.round(p[i * 3 + 2]! * 1e4) + seed) / 4294967296) * Math.PI * 2;
      const cr = Math.cos(rot), sr = Math.sin(rot);
      // origins: the vertex, then its ring points (only those that are far enough away to matter)
      const origins: number[] = [p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!];
      const rp = ringPts[i]!;
      for (let k = 0; k < rp.length; k += 3) {
        const dx = rp[k]! - p[i * 3]!, dy = rp[k + 1]! - p[i * 3 + 1]!, dz = rp[k + 2]! - p[i * 3 + 2]!;
        if (dx * dx + dy * dy + dz * dz > (D * 0.15) ** 2) origins.push(rp[k]!, rp[k + 1]!, rp[k + 2]!);
      }
      // per-origin occlusion; the vertex takes a blend of the mean and the least occluded origin,
      // so a big face whose far corner tucks under a bolt does not go dark all over
      const no = Math.min(origins.length / 3, 6);
      const per = Math.max(3, Math.ceil(S / no));
      let sum = 0;
      let least = Infinity;
      for (let k = 0; k < no; k++) {
        const ox = origins[k * 3]! + nx * 0.0015, oy = origins[k * 3 + 1]! + ny * 0.0015, oz = origins[k * 3 + 2]! + nz * 0.0015;
        let o = 0;
        for (let r = 0; r < per; r++) {
          const s = (k * per + r) % S;
          const a = dirs[s * 3]!, b = dirs[s * 3 + 1]!, c = dirs[s * 3 + 2]!;
          const u = a * cr - b * sr, v = a * sr + b * cr;
          const dx = tx * u + bx * v + nx * c, dy = ty * u + by * v + ny * c, dz = tz * u + bz * v + nz * c;
          const t = bvh.hit(ox, oy, oz, dx, dy, dz, D);
          if (t < D) o += 1 - (t / D) * 0.6;
        }
        o /= per;
        sum += o;
        if (o < least) least = o;
      }
      const occ = (sum / no) * 0.5 + least * 0.5;
      // a vertex that stands for a large area (the corner of a big flat face) cannot carry a local
      // occlusion event without smearing it across the face: fade its AO out
      const trust = 1 - smooth((D * 0.5) ** 2, (D * 1.4) ** 2, area[i]!);
      const ao = smooth(r0, r1, occ) * trust;
      if (ao > surf.getY(i)) surf.setY(i, ao);
    }
    surf.needsUpdate = true;
  });
}

// ---- colour ----------------------------------------------------------------

export interface TintOptions {
  /** Tone jitter: the colour's brightness is scaled by 1 ± jitter (seeded, one value for the whole geometry). */
  jitter?: number;
  /** Also shift warmth a little (± fraction moved toward red/blue). */
  warm?: number;
  seed?: number;
  /** Multiply the token by this (e.g. 0.8 for a darker part of the same paint). */
  shade?: number;
}

/** Write the linear colour of a palette token into the geometry's colour attribute. Returns the geometry. */
export function tint(g: BufferGeometry, token: Token, opts: TintOptions = {}): BufferGeometry {
  const [r0, g0, b0] = linear(token);
  const R = rng(opts.seed ?? 0);
  const k = (opts.shade ?? 1) * (1 + R.spread(opts.jitter ?? 0));
  const w = R.spread(opts.warm ?? 0);
  const col = [r0 * k * (1 + w), g0 * k, b0 * k * (1 - w)];
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = col[0]!;
    arr[i * 3 + 1] = col[1]!;
    arr[i * 3 + 2] = col[2]!;
  }
  g.setAttribute(ATTR.color, new BufferAttribute(arr, 3));
  return g;
}

/**
 * Debug colouring for the dev page: wear in red, cavity in blue, over a
 * neutral grey. Returns a Float32Array for a colour attribute (does not
 * modify the geometry).
 */
export function surfDebugColors(g: BufferGeometry, which: 'both' | 'wear' | 'cavity' = 'both'): Float32Array {
  const s = g.getAttribute(ATTR.surf).array;
  const n = s.length / 2;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const w = which === 'cavity' ? 0 : s[i * 2]!;
    const c = which === 'wear' ? 0 : s[i * 2 + 1]!;
    out[i * 3] = 0.18 + 0.8 * w;
    out[i * 3 + 1] = 0.18 * (1 - Math.max(w, c));
    out[i * 3 + 2] = 0.18 + 0.8 * c;
  }
  return out;
}
