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
import { TriBvh } from './bvh.ts';

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
  // finish (z) is kept from the geometry's existing surf if it has one, else 0
  const prev = g.getAttribute(ATTR.surf);
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
  const out = new Float32Array(n * 3);
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
    out[i * 3] = smooth(w0, w1, sharp ? c1 : c2);
    out[i * 3 + 1] = smooth(c0, cc1, sharp ? v1 : v2);
    out[i * 3 + 2] = prev && prev.itemSize === 3 ? prev.getZ(i) : 0;
  }
  return out;
}

// ---- ambient occlusion over a whole piece ---------------------------------

export interface AoOptions {
  /** Rays per vertex (spread over the vertex and its one-ring; the result is then smoothed over the mesh). Default 6. */
  samples?: number;
  /** Only occluders nearer than this count (units). Default 0.14. */
  distance?: number;
  /** Occlusion fraction at which cavity starts / is full. Default [0.06, 0.42]. */
  range?: [number, number];
  seed?: number;
}

/** Timings of the cavity bake, for the dev page and perf checks. */
export const bakeStats = { calls: 0, cacheHits: 0, lastMs: 0, totalMs: 0, lastRays: 0 };

const MEMO_MAX = 256;
const bakeMemo = new Map<string, Float32Array[]>();

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** A 64-bit-ish FNV-style hash over some float32 arrays (by bits) and int arrays (by value). */
function hashArrays(arrays: ReadonlyArray<Float32Array | Uint16Array | Uint32Array | Float64Array>): string {
  let h1 = 0x811c9dc5, h2 = 0x5bd1e995;
  for (const arr of arrays) {
    const view = arr instanceof Float32Array ? new Uint32Array(arr.buffer, arr.byteOffset, arr.length) : arr instanceof Float64Array ? new Uint32Array(arr.buffer, arr.byteOffset, arr.length * 2) : arr;
    for (let i = 0; i < view.length; i++) {
      const v = view[i]!;
      h1 = Math.imul(h1 ^ v, 0x01000193);
      h2 = Math.imul(h2 + v, 0x5bd1e995) ^ (h2 >>> 13);
    }
    h1 = Math.imul(h1 ^ view.length, 0x01000193);
  }
  return `${(h1 >>> 0).toString(36)}.${(h2 >>> 0).toString(36)}`;
}

/**
 * Ambient-occlusion cavity across several geometries that sit together (one
 * piece at rest, already in a shared space via each item's matrix). Raises
 * each vertex's surf.y to max(curvature cavity, occlusion). Done once per
 * piece build, and memoised by content: a piece whose geometry, placement and
 * options are identical to one already baked (sixty identical crates) costs a
 * hash, not a bake.
 */
export function bakeCavity(items: ReadonlyArray<BufferGeometry | { geometry: BufferGeometry; matrix?: Matrix4 | undefined }>, opts: AoOptions = {}): void {
  const t0 = now();
  bakeStats.calls++;
  const S = opts.samples ?? 6;
  const D = opts.distance ?? 0.14;
  const [r0, r1] = opts.range ?? [0.06, 0.42];
  const seed = opts.seed ?? 7;
  const list = items.map((it) => (it instanceof BufferGeometry ? { geometry: it, matrix: undefined } : it));
  const key = hashArrays([
    Float64Array.from([S, D, r0, r1, seed]),
    ...list.flatMap(({ geometry, matrix }) => [
      geometry.getAttribute('position').array as Float32Array,
      indexOf(geometry) as Uint32Array | Uint16Array,
      Float32Array.from(matrix ? matrix.elements : [1]),
    ]),
  ]);
  const apply = (aos: Float32Array[]): void => {
    list.forEach(({ geometry }, gi) => {
      const surf = geometry.getAttribute(ATTR.surf) as BufferAttribute;
      const ao = aos[gi]!;
      for (let i = 0; i < ao.length; i++) if (ao[i]! > surf.getY(i)) surf.setY(i, ao[i]!);
      surf.needsUpdate = true;
    });
  };
  const cached = bakeMemo.get(key);
  if (cached) {
    bakeStats.cacheHits++;
    apply(cached);
    bakeStats.lastMs = now() - t0;
    bakeStats.totalMs += bakeStats.lastMs;
    return;
  }
  // piece-space positions and normals per geometry
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
  const bvh = new TriBvh(tri);
  // a fixed cosine-weighted direction set (Fibonacci hemisphere), rotated per vertex
  const dirs = new Float32Array(S * 3);
  for (let s = 0; s < S; s++) {
    const u = (s + 0.5) / S;
    const r = Math.sqrt(u);
    const a = s * 2.399963229728653;
    dirs[s * 3] = r * Math.cos(a);
    dirs[s * 3 + 1] = r * Math.sin(a);
    dirs[s * 3 + 2] = Math.sqrt(1 - u);
  }
  const maxOrigins = Math.max(1, Math.floor(S / 3));
  const RING = maxOrigins - 1; // ring points kept per vertex (the vertex itself is the first origin)
  const minRing2 = (D * 0.15) ** 2;
  // copies of one vertex (seams, poles, merged twins) with the same normal are baked once
  const done = new Map<number, number>();
  let rays = 0;
  const results: Float32Array[] = [];
  list.forEach(({ geometry }, gi) => {
    const { p, nr } = spaces[gi]!;
    const n = p.length / 3;
    const ao = new Float32Array(n);
    const surfA = geometry.getAttribute(ATTR.surf).array;
    // rays from a small part only need to reach as far as the part is big: a bolt's contact
    // with its plate is within its own size, and shorter rays visit far fewer BVH nodes
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    const Dg = Math.max(0.035, Math.min(D, (geometry.boundingSphere?.radius ?? D) * 1.2));
    results.push(ao);
    // one-ring sample points: a vertex stands for the region its triangles interpolate over,
    // so its occlusion is averaged at points part-way toward its adjacent triangles' centroids
    const idx = indexOf(geometry);
    const ring = new Float32Array(n * RING * 3);
    const ringN = new Uint8Array(n);
    const area = new Float32Array(n);
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t]!, b = idx[t + 1]!, c = idx[t + 2]!;
      const ux = p[b * 3]! - p[a * 3]!, uy = p[b * 3 + 1]! - p[a * 3 + 1]!, uz = p[b * 3 + 2]! - p[a * 3 + 2]!;
      const vx = p[c * 3]! - p[a * 3]!, vy = p[c * 3 + 1]! - p[a * 3 + 1]!, vz = p[c * 3 + 2]! - p[a * 3 + 2]!;
      const ar = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 6; // a third of the triangle
      const cx = (p[a * 3]! + p[b * 3]! + p[c * 3]!) / 3, cy = (p[a * 3 + 1]! + p[b * 3 + 1]! + p[c * 3 + 1]!) / 3, cz = (p[a * 3 + 2]! + p[b * 3 + 2]! + p[c * 3 + 2]!) / 3;
      for (const v of [a, b, c]) {
        area[v] = area[v]! + ar;
        const k = ringN[v]!;
        if (k >= RING) continue;
        const qx = (cx - p[v * 3]!) * 0.55, qy = (cy - p[v * 3 + 1]!) * 0.55, qz = (cz - p[v * 3 + 2]!) * 0.55;
        if (qx * qx + qy * qy + qz * qz <= minRing2) continue;
        const w = (v * RING + k) * 3;
        ring[w] = p[v * 3]! + qx;
        ring[w + 1] = p[v * 3 + 1]! + qy;
        ring[w + 2] = p[v * 3 + 2]! + qz;
        ringN[v] = k + 1;
      }
    }
    for (let i = 0; i < n; i++) {
      // a vertex that stands for a large area (the corner of a big flat face) cannot carry a local
      // occlusion event without smearing it across the face: fade its AO out (and skip the rays)
      const trust = 1 - smooth((D * 0.5) ** 2, (D * 1.4) ** 2, area[i]!);
      if (trust < 0.01) continue;
      // occlusion only ever raises cavity: a vertex already deep in a crease needs no rays
      if (surfA[i * 3 + 1]! > 0.92) continue;
      const px = p[i * 3]!, py = p[i * 3 + 1]!, pz = p[i * 3 + 2]!;
      const nx = nr[i * 3]!, ny = nr[i * 3 + 1]!, nz = nr[i * 3 + 2]!;
      // a numeric key from the quantised position and normal (two 32-bit hashes in one safe integer)
      const ha = hash2(hash2(Math.round(px * 1e5), Math.round(py * 1e5)), Math.round(pz * 1e5));
      const hb = hash2(hash2(Math.round(nx * 1e3), Math.round(ny * 1e3)), Math.round(nz * 1e3) ^ ha);
      const qk = ha * 2097152 + (hb & 2097151);
      const prev = done.get(qk);
      if (prev !== undefined) {
        ao[i] = prev;
        continue;
      }
      let tx: number, ty: number, tz: number;
      if (Math.abs(nx) < 0.9) { tx = 0; ty = nz; tz = -ny; } else { tx = -nz; ty = 0; tz = nx; }
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
      // the ray set's rotation comes from the position, so the result does not depend on vertex order
      const rot = (hash2(Math.round(px * 1e4) ^ (Math.round(py * 1e4) * 7919), Math.round(pz * 1e4) + seed) / 4294967296) * Math.PI * 2;
      const cr = Math.cos(rot), sr = Math.sin(rot);
      // per-origin occlusion; the vertex takes a blend of the mean and the least occluded origin,
      // so a big face whose far corner tucks under a bolt does not go dark all over
      const no = 1 + ringN[i]!;
      const per = Math.max(3, Math.ceil(S / no));
      let sum = 0;
      let least = Infinity;
      for (let k = 0; k < no; k++) {
        let ox = px, oy = py, oz = pz;
        if (k > 0) {
          const w = (i * RING + k - 1) * 3;
          ox = ring[w]!; oy = ring[w + 1]!; oz = ring[w + 2]!;
        }
        ox += nx * 0.0015; oy += ny * 0.0015; oz += nz * 0.0015;
        let occ = 0;
        for (let r = 0; r < per; r++) {
          const s = (k * per + r) % S;
          const a = dirs[s * 3]!, b = dirs[s * 3 + 1]!, c = dirs[s * 3 + 2]!;
          const u = a * cr - b * sr, v = a * sr + b * cr;
          const t = bvh.hit(ox, oy, oz, tx * u + bx * v + nx * c, ty * u + by * v + ny * c, tz * u + bz * v + nz * c, Dg);
          if (t < Dg) occ += 1 - (t / Dg) * 0.6;
        }
        rays += per;
        occ /= per;
        sum += occ;
        if (occ < least) least = occ;
      }
      const value = smooth(r0, r1, (sum / no) * 0.5 + least * 0.5) * trust;
      ao[i] = value;
      done.set(qk, value);
    }
    // few rays are noisy: average each vertex with its mesh neighbours (twice, half weight)
    const sum = new Float32Array(n), cnt = new Float32Array(n);
    for (let pass = 0; pass < 2; pass++) {
      sum.fill(0);
      cnt.fill(0);
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t]!, b = idx[t + 1]!, c = idx[t + 2]!;
        sum[a] = sum[a]! + ao[b]! + ao[c]!; cnt[a] = cnt[a]! + 2;
        sum[b] = sum[b]! + ao[a]! + ao[c]!; cnt[b] = cnt[b]! + 2;
        sum[c] = sum[c]! + ao[a]! + ao[b]!; cnt[c] = cnt[c]! + 2;
      }
      for (let i = 0; i < n; i++) if (cnt[i]! > 0 && area[i]! < (D * 1.4) ** 2) ao[i] = ao[i]! * 0.5 + (sum[i]! / cnt[i]!) * 0.5;
    }
  });
  if (bakeMemo.size >= MEMO_MAX) bakeMemo.delete(bakeMemo.keys().next().value!);
  bakeMemo.set(key, results);
  apply(results);
  bakeStats.lastRays = rays;
  bakeStats.lastMs = now() - t0;
  bakeStats.totalMs += bakeStats.lastMs;
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
  const sa = g.getAttribute(ATTR.surf);
  const s = sa.array;
  const k = sa.itemSize;
  const n = s.length / k;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const w = which === 'cavity' ? 0 : s[i * k]!;
    const c = which === 'wear' ? 0 : s[i * k + 1]!;
    out[i * 3] = 0.18 + 0.8 * w;
    out[i * 3 + 1] = 0.18 * (1 - Math.max(w, c));
    out[i * 3 + 2] = 0.18 + 0.8 * c;
  }
  return out;
}
