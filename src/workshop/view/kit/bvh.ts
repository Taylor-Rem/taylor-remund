/**
 * A small BVH over triangles for the cavity bake's occlusion rays: binned
 * SAH build, depth-first flattened nodes in typed arrays (left child is the
 * next node), triangles reordered so a leaf's are contiguous, and ordered
 * nearest-hit traversal with a fixed typed stack. No allocation per ray.
 */

const BINS = 12;
const LEAF = 6;

export class TriBvh {
  /** Triangle vertices, 9 floats each, in leaf order. */
  private readonly t: Float32Array;
  /** Node bounds: 6 floats each (min xyz, max xyz). */
  private b: Float32Array;
  /** Node data: 2 ints each. Interior: (right child index, -1 - axis). Leaf: (first triangle, count). */
  private d: Int32Array;
  private nodes = 0;
  private readonly stack = new Int32Array(256);
  private readonly cnt = new Int32Array(BINS);
  private readonly bb = new Float32Array(BINS * 6);
  private readonly leftA = new Float32Array(BINS);
  private readonly leftN = new Int32Array(BINS);

  constructor(tri: Float32Array) {
    const n = tri.length / 9;
    const cen = new Float32Array(n * 3);
    const lo = new Float32Array(n * 3), hi = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      for (let a = 0; a < 3; a++) {
        const v0 = tri[i * 9 + a]!, v1 = tri[i * 9 + 3 + a]!, v2 = tri[i * 9 + 6 + a]!;
        lo[i * 3 + a] = Math.min(v0, v1, v2);
        hi[i * 3 + a] = Math.max(v0, v1, v2);
        cen[i * 3 + a] = (lo[i * 3 + a]! + hi[i * 3 + a]!) / 2;
      }
    }
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    const cap = Math.max(1, 2 * n);
    this.b = new Float32Array(cap * 6);
    this.d = new Int32Array(cap * 2);
    if (n > 0) this.build(idx, 0, n, lo, hi, cen);
    this.t = new Float32Array(n * 9);
    for (let i = 0; i < n; i++) this.t.set(tri.subarray(idx[i]! * 9, idx[i]! * 9 + 9), i * 9);
  }

  private build(idx: Uint32Array, start: number, end: number, lo: Float32Array, hi: Float32Array, cen: Float32Array): number {
    const node = this.nodes++;
    let bx0 = Infinity, by0 = Infinity, bz0 = Infinity, bx1 = -Infinity, by1 = -Infinity, bz1 = -Infinity;
    let cx0 = Infinity, cy0 = Infinity, cz0 = Infinity, cx1 = -Infinity, cy1 = -Infinity, cz1 = -Infinity;
    for (let i = start; i < end; i++) {
      const t = idx[i]! * 3;
      let v = lo[t]!; if (v < bx0) bx0 = v;
      v = lo[t + 1]!; if (v < by0) by0 = v;
      v = lo[t + 2]!; if (v < bz0) bz0 = v;
      v = hi[t]!; if (v > bx1) bx1 = v;
      v = hi[t + 1]!; if (v > by1) by1 = v;
      v = hi[t + 2]!; if (v > bz1) bz1 = v;
      v = cen[t]!; if (v < cx0) cx0 = v; if (v > cx1) cx1 = v;
      v = cen[t + 1]!; if (v < cy0) cy0 = v; if (v > cy1) cy1 = v;
      v = cen[t + 2]!; if (v < cz0) cz0 = v; if (v > cz1) cz1 = v;
    }
    const B = this.b;
    B[node * 6] = bx0; B[node * 6 + 1] = by0; B[node * 6 + 2] = bz0;
    B[node * 6 + 3] = bx1; B[node * 6 + 4] = by1; B[node * 6 + 5] = bz1;
    const count = end - start;
    const leaf = (): number => {
      this.d[node * 2] = start;
      this.d[node * 2 + 1] = count;
      return node;
    };
    if (count <= LEAF) return leaf();
    // binned SAH on the axis of largest centroid extent
    const ext = [cx1 - cx0, cy1 - cy0, cz1 - cz0];
    let axis = 0;
    if (ext[1]! > ext[axis]!) axis = 1;
    if (ext[2]! > ext[axis]!) axis = 2;
    const cmin = [cx0, cy0, cz0][axis]!;
    const e = ext[axis]!;
    if (e < 1e-9) return leaf();
    const cnt = this.cnt;
    const bb = this.bb;
    cnt.fill(0);
    for (let k = 0; k < BINS; k++) { bb[k * 6] = bb[k * 6 + 1] = bb[k * 6 + 2] = Infinity; bb[k * 6 + 3] = bb[k * 6 + 4] = bb[k * 6 + 5] = -Infinity; }
    const scale = BINS / e;
    for (let i = start; i < end; i++) {
      const t = idx[i]!;
      const k = Math.min(BINS - 1, Math.floor((cen[t * 3 + axis]! - cmin) * scale));
      cnt[k]!++;
      const q = k * 6, w = t * 3;
      if (lo[w]! < bb[q]!) bb[q] = lo[w]!;
      if (lo[w + 1]! < bb[q + 1]!) bb[q + 1] = lo[w + 1]!;
      if (lo[w + 2]! < bb[q + 2]!) bb[q + 2] = lo[w + 2]!;
      if (hi[w]! > bb[q + 3]!) bb[q + 3] = hi[w]!;
      if (hi[w + 1]! > bb[q + 4]!) bb[q + 4] = hi[w + 1]!;
      if (hi[w + 2]! > bb[q + 5]!) bb[q + 5] = hi[w + 2]!;
    }
    const area = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number => {
      const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
      return dx < 0 ? 0 : dx * dy + dy * dz + dz * dx;
    };
    // sweep from the left and right
    const leftA = this.leftA, leftN = this.leftN;
    {
      let a0 = Infinity, a1 = Infinity, a2 = Infinity, a3 = -Infinity, a4 = -Infinity, a5 = -Infinity, c = 0;
      for (let k = 0; k < BINS; k++) {
        c += cnt[k]!;
        if (cnt[k]! > 0) {
          a0 = Math.min(a0, bb[k * 6]!); a1 = Math.min(a1, bb[k * 6 + 1]!); a2 = Math.min(a2, bb[k * 6 + 2]!);
          a3 = Math.max(a3, bb[k * 6 + 3]!); a4 = Math.max(a4, bb[k * 6 + 4]!); a5 = Math.max(a5, bb[k * 6 + 5]!);
        }
        leftA[k] = c > 0 ? area(a0, a1, a2, a3, a4, a5) : 0;
        leftN[k] = c;
      }
    }
    let best = Infinity, split = -1;
    {
      let a0 = Infinity, a1 = Infinity, a2 = Infinity, a3 = -Infinity, a4 = -Infinity, a5 = -Infinity, c = 0;
      for (let k = BINS - 1; k > 0; k--) {
        c += cnt[k]!;
        if (cnt[k]! > 0) {
          a0 = Math.min(a0, bb[k * 6]!); a1 = Math.min(a1, bb[k * 6 + 1]!); a2 = Math.min(a2, bb[k * 6 + 2]!);
          a3 = Math.max(a3, bb[k * 6 + 3]!); a4 = Math.max(a4, bb[k * 6 + 4]!); a5 = Math.max(a5, bb[k * 6 + 5]!);
        }
        const cost = leftA[k - 1]! * leftN[k - 1]! + (c > 0 ? area(a0, a1, a2, a3, a4, a5) * c : 0);
        if (leftN[k - 1]! > 0 && c > 0 && cost < best) {
          best = cost;
          split = k;
        }
      }
    }
    if (split < 0) return leaf();
    // partition
    let i = start, j = end - 1;
    while (i <= j) {
      if (Math.min(BINS - 1, Math.floor((cen[idx[i]! * 3 + axis]! - cmin) * scale)) < split) i++;
      else {
        const tmp = idx[i]!;
        idx[i] = idx[j]!;
        idx[j] = tmp;
        j--;
      }
    }
    if (i === start || i === end) return leaf();
    this.build(idx, start, i, lo, hi, cen);
    const right = this.build(idx, i, end, lo, hi, cen);
    this.d[node * 2] = right;
    this.d[node * 2 + 1] = -1 - axis;
    return node;
  }

  private readonly stackT = new Float32Array(256);

  /** Nearest hit distance along a unit ray within (1e-5, tmax), or tmax if none. */
  hit(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tmax: number): number {
    if (this.nodes === 0) return tmax;
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    // per-ray slab offsets: which bound is entered first on each axis
    const nxo = ix >= 0 ? 0 : 3, nyo = iy >= 0 ? 1 : 4, nzo = iz >= 0 ? 2 : 5;
    const fxo = 3 - nxo, fyo = 5 - nyo, fzo = 7 - nzo;
    const B = this.b, D = this.d, T = this.t, st = this.stack, stt = this.stackT;
    let sp = 0;
    let best = tmax;
    let nd = 0;
    for (;;) {
      const second = D[nd * 2 + 1]!;
      if (second >= 0) {
        const s = D[nd * 2]!;
        for (let k = s; k < s + second; k++) {
          const t = k * 9;
          const ax = T[t]!, ay = T[t + 1]!, az = T[t + 2]!;
          const e1x = T[t + 3]! - ax, e1y = T[t + 4]! - ay, e1z = T[t + 5]! - az;
          const e2x = T[t + 6]! - ax, e2y = T[t + 7]! - ay, e2z = T[t + 8]! - az;
          const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
          const det = e1x * px + e1y * py + e1z * pz;
          if (det > -1e-12 && det < 1e-12) continue;
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
        // interior: entry distances of both children, nearer first
        const l = nd + 1, r = D[nd * 2]!;
        let o = l * 6;
        let t0 = (B[o + nxo]! - ox) * ix, t1 = (B[o + fxo]! - ox) * ix;
        let a = (B[o + nyo]! - oy) * iy, b = (B[o + fyo]! - oy) * iy;
        if (a > t0) t0 = a;
        if (b < t1) t1 = b;
        a = (B[o + nzo]! - oz) * iz; b = (B[o + fzo]! - oz) * iz;
        if (a > t0) t0 = a;
        if (b < t1) t1 = b;
        if (t0 < 0) t0 = 0;
        const tl = t0 <= t1 && t0 < best ? t0 : Infinity;
        o = r * 6;
        t0 = (B[o + nxo]! - ox) * ix; t1 = (B[o + fxo]! - ox) * ix;
        a = (B[o + nyo]! - oy) * iy; b = (B[o + fyo]! - oy) * iy;
        if (a > t0) t0 = a;
        if (b < t1) t1 = b;
        a = (B[o + nzo]! - oz) * iz; b = (B[o + fzo]! - oz) * iz;
        if (a > t0) t0 = a;
        if (b < t1) t1 = b;
        if (t0 < 0) t0 = 0;
        const tr = t0 <= t1 && t0 < best ? t0 : Infinity;
        if (tl !== Infinity && tr !== Infinity) {
          if (tl <= tr) { stt[sp] = tr; st[sp++] = r; nd = l; } else { stt[sp] = tl; st[sp++] = l; nd = r; }
          continue;
        }
        if (tl !== Infinity) { nd = l; continue; }
        if (tr !== Infinity) { nd = r; continue; }
      }
      // pop, skipping nodes that start beyond a closer hit
      let found = false;
      while (sp > 0) {
        sp--;
        if (stt[sp]! < best) { nd = st[sp]!; found = true; break; }
      }
      if (!found) return best;
    }
  }

  /** Does a unit ray hit anything within (1e-5, tmax)? Stops at the first hit (cheaper than `hit`). */
  any(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tmax: number): boolean {
    if (this.nodes === 0) return false;
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    // per-ray slab offsets: which bound is entered first on each axis
    const nxo = ix >= 0 ? 0 : 3, nyo = iy >= 0 ? 1 : 4, nzo = iz >= 0 ? 2 : 5;
    const fxo = 3 - nxo, fyo = 5 - nyo, fzo = 7 - nzo;
    const B = this.b, D = this.d, T = this.t, st = this.stack, stt = this.stackT;
    let sp = 0;
    let best = tmax;
    let nd = 0;
    for (;;) {
      const second = D[nd * 2 + 1]!;
      if (second >= 0) {
        const s = D[nd * 2]!;
        for (let k = s; k < s + second; k++) {
          const t = k * 9;
          const ax = T[t]!, ay = T[t + 1]!, az = T[t + 2]!;
          const e1x = T[t + 3]! - ax, e1y = T[t + 4]! - ay, e1z = T[t + 5]! - az;
          const e2x = T[t + 6]! - ax, e2y = T[t + 7]! - ay, e2z = T[t + 8]! - az;
          const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
          const det = e1x * px + e1y * py + e1z * pz;
          if (det > -1e-12 && det < 1e-12) continue;
          const inv = 1 / det;
          const sx = ox - ax, sy = oy - ay, sz = oz - az;
          const u = (sx * px + sy * py + sz * pz) * inv;
          if (u < 0 || u > 1) continue;
          const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
          const v = (dx * qx + dy * qy + dz * qz) * inv;
          if (v < 0 || u + v > 1) continue;
          const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
          if (tt > -1e-4 && tt < best) return true; // a ray leaving a vertex that sits on another surface hits it at t ~ 0
        }
      } else {
        // interior: entry distances of both children, nearer first
        const l = nd + 1, r = D[nd * 2]!;
        let o = l * 6;
        let t0 = (B[o + nxo]! - ox) * ix, t1 = (B[o + fxo]! - ox) * ix;
        let a = (B[o + nyo]! - oy) * iy, b = (B[o + fyo]! - oy) * iy;
        if (a > t0) t0 = a;
        if (b < t1) t1 = b;
        a = (B[o + nzo]! - oz) * iz; b = (B[o + fzo]! - oz) * iz;
        if (a > t0) t0 = a;
        if (b < t1) t1 = b;
        if (t0 < 0) t0 = 0;
        const tl = t0 <= t1 && t0 < best ? t0 : Infinity;
        o = r * 6;
        t0 = (B[o + nxo]! - ox) * ix; t1 = (B[o + fxo]! - ox) * ix;
        a = (B[o + nyo]! - oy) * iy; b = (B[o + fyo]! - oy) * iy;
        if (a > t0) t0 = a;
        if (b < t1) t1 = b;
        a = (B[o + nzo]! - oz) * iz; b = (B[o + fzo]! - oz) * iz;
        if (a > t0) t0 = a;
        if (b < t1) t1 = b;
        if (t0 < 0) t0 = 0;
        const tr = t0 <= t1 && t0 < best ? t0 : Infinity;
        if (tl !== Infinity && tr !== Infinity) {
          if (tl <= tr) { stt[sp] = tr; st[sp++] = r; nd = l; } else { stt[sp] = tl; st[sp++] = l; nd = r; }
          continue;
        }
        if (tl !== Infinity) { nd = l; continue; }
        if (tr !== Infinity) { nd = r; continue; }
      }
      // pop, skipping nodes that start beyond a closer hit
      let found = false;
      while (sp > 0) {
        sp--;
        if (stt[sp]! < best) { nd = st[sp]!; found = true; break; }
      }
      if (!found) return false;
    }
  }
}
