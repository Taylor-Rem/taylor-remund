/**
 * Patch (the enamel figurine): geometry helpers of its own. Colour mixing
 * between palette tokens (the fur is a teal-grey no single token names),
 * a raycast to seat face details on the cast surfaces, painted bands on
 * turned parts, and the spherical shells the eyes and lids are made of.
 */
import { BufferAttribute, Matrix4, Vector3 } from 'three';
import type { BufferGeometry } from 'three';
import { linear } from '../../../palette.ts';
import type { Token } from '../../../palette.ts';
import { ATTR } from '../../types.ts';
import { MeshData, finish } from '../../mesh.ts';
import { grain } from '../../space.ts';
import { rng } from '../../rng.ts';

export type RGB = [number, number, number];

/** A linear colour mixed from two tokens (t of the way from a to b), times `shade`. */
export function mix(a: Token, b: Token, t: number, shade = 1): RGB {
  const A = linear(a), B = linear(b);
  return [(A[0] + (B[0] - A[0]) * t) * shade, (A[1] + (B[1] - A[1]) * t) * shade, (A[2] + (B[2] - A[2]) * t) * shade];
}

/** The figurine's paints, mixed from tokens. */
export const PAINT = {
  fur: mix('teal-light', 'steel', 0.32, 0.62),
  furDark: mix('teal-light', 'steel', 0.32, 0.5),
  mask: mix('teal-panel', 'ink', 0.45, 0.82),
  cream: mix('paper', 'wood-light', 0.06, 0.95),
  eyeWhite: mix('paper', 'steel', 0.18, 0.95),
  ink: linear('ink'),
  red: mix('cable-red', 'ink', 0.12, 0.8),
  redDark: mix('cable-red', 'ink', 0.3, 0.72),
} as const;

/** Write one colour on every vertex (in place). */
export function colour(g: BufferGeometry, c: RGB, jitter = 0, seed = 0): BufferGeometry {
  const n = g.getAttribute('position').count;
  const k = 1 + rng(seed).spread(jitter);
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c[0] * k;
    arr[i * 3 + 1] = c[1] * k;
    arr[i * 3 + 2] = c[2] * k;
  }
  g.setAttribute(ATTR.color, new BufferAttribute(arr, 3));
  return g;
}

/** Colour each vertex by a function of its position and normal (in place). */
export function colourBy(g: BufferGeometry, f: (p: Vector3, n: Vector3) => RGB): BufferGeometry {
  const pos = g.getAttribute('position'), nrm = g.getAttribute('normal');
  const arr = new Float32Array(pos.count * 3);
  const p = new Vector3(), n = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nrm, i);
    const c = f(p, n);
    arr[i * 3] = c[0];
    arr[i * 3 + 1] = c[1];
    arr[i * 3 + 2] = c[2];
  }
  g.setAttribute(ATTR.color, new BufferAttribute(arr, 3));
  return g;
}

/**
 * Scale (and lift) the wear signal on a geometry, weighted per vertex by `where`
 * (position and normal; 1 everywhere when omitted). For wear written by intent:
 * the rims and points a toy loses its paint from first. In place.
 */
export function wearAdd(g: BufferGeometry, k: number, add = 0, where?: (p: Vector3, n: Vector3) => number): BufferGeometry {
  const sf = g.getAttribute(ATTR.surf), pos = g.getAttribute('position'), nrm = g.getAttribute('normal');
  const p = new Vector3(), n = new Vector3();
  for (let i = 0; i < sf.count; i++) {
    let w = 1;
    if (where) {
      p.fromBufferAttribute(pos, i);
      n.fromBufferAttribute(nrm, i);
      w = Math.max(0, Math.min(1, where(p, n)));
    }
    const v = sf.getX(i) * (1 + (k - 1) * w) + add * w;
    sf.setX(i, Math.max(0, Math.min(1, v)));
  }
  sf.needsUpdate = true;
  return g;
}

/** A hit on a surface: point and normal. */
export interface Hit {
  p: Vector3;
  n: Vector3;
}

/**
 * Cast a ray from `from` along `dir` against the geometries (each in the same
 * space, or with its own matrix) and return the first hit, with the
 * interpolated vertex normal there.
 */
export function cast(geoms: ReadonlyArray<BufferGeometry | [BufferGeometry, Matrix4]>, from: Vector3, dir: Vector3): Hit | null {
  let best: Hit | null = null;
  let bestT = Infinity;
  const d = dir.clone().normalize();
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), e1 = new Vector3(), e2 = new Vector3(), h = new Vector3(), s = new Vector3(), q = new Vector3();
  for (const item of geoms) {
    const [g, m] = Array.isArray(item) ? item : [item, null];
    const pos = g.getAttribute('position'), nrm = g.getAttribute('normal');
    const idx = g.index!.array;
    const nm = m ? new Matrix4().copy(m).invert().transpose() : null;
    const P = (i: number, out: Vector3): Vector3 => (m ? out.fromBufferAttribute(pos, i).applyMatrix4(m) : out.fromBufferAttribute(pos, i));
    for (let t = 0; t < idx.length; t += 3) {
      const i0 = idx[t]!, i1 = idx[t + 1]!, i2 = idx[t + 2]!;
      P(i0, a);
      P(i1, b);
      P(i2, c);
      e1.subVectors(b, a);
      e2.subVectors(c, a);
      h.crossVectors(d, e2);
      const det = e1.dot(h);
      if (Math.abs(det) < 1e-12) continue;
      const f = 1 / det;
      s.subVectors(from, a);
      const u = f * s.dot(h);
      if (u < 0 || u > 1) continue;
      q.crossVectors(s, e1);
      const v = f * d.dot(q);
      if (v < 0 || u + v > 1) continue;
      const tt = f * e2.dot(q);
      if (tt <= 1e-6 || tt >= bestT) continue;
      bestT = tt;
      const n0 = new Vector3().fromBufferAttribute(nrm, i0), n1 = new Vector3().fromBufferAttribute(nrm, i1), n2 = new Vector3().fromBufferAttribute(nrm, i2);
      const n = n0.multiplyScalar(1 - u - v).add(n1.multiplyScalar(u)).add(n2.multiplyScalar(v));
      if (nm) n.applyMatrix4(nm);
      best = { p: from.clone().addScaledVector(d, tt), n: n.normalize() };
    }
  }
  return best;
}

/**
 * A spherical patch of radius r about the origin: polar angle (from +Z) out
 * to `ang`, as a dome facing +Z. `lift` thickens it into a shell with a
 * rolled lip (so its edge catches light and wear). For pupils.
 */
export function sphereCap(r: number, ang: number, o: { segs?: number; rings?: number; lip?: number } = {}): BufferGeometry {
  const md = new MeshData();
  const segs = o.segs ?? 16, rings = o.rings ?? 4;
  const lip = o.lip ?? 0;
  const ids: number[][] = [];
  const centre = md.v(0, 0, r, 0, 0, 1);
  for (let j = 1; j <= rings; j++) {
    const a = (ang * j) / rings;
    const row: number[] = [];
    for (let i = 0; i < segs; i++) {
      const t = (i / segs) * Math.PI * 2;
      const x = Math.sin(a) * Math.cos(t), y = Math.sin(a) * Math.sin(t), z = Math.cos(a);
      row.push(md.v(x * r, y * r, z * r, x, y, z));
    }
    ids.push(row);
  }
  for (let i = 0; i < segs; i++) md.tri(centre, ids[0]![i]!, ids[0]![(i + 1) % segs]!);
  for (let j = 0; j < rings - 1; j++) for (let i = 0; i < segs; i++) md.quad(ids[j]![i]!, ids[j]![(i + 1) % segs]!, ids[j + 1]![(i + 1) % segs]!, ids[j + 1]![i]!);
  if (lip > 0) {
    // the lip: the rim turned down into the ball, so the cap sits in the surface with a visible edge
    const last = ids[rings - 1]!;
    const row: number[] = [];
    for (let i = 0; i < segs; i++) {
      const t = (i / segs) * Math.PI * 2;
      const x = Math.sin(ang) * Math.cos(t), y = Math.sin(ang) * Math.sin(t), z = Math.cos(ang);
      const rr = r - lip;
      row.push(md.v(x * rr, y * rr, z * rr, x * 0.3 + Math.cos(t) * Math.cos(ang), y * 0.3 + Math.sin(t) * Math.cos(ang), z * 0.3 - Math.sin(ang)));
    }
    for (let i = 0; i < segs; i++) md.quad(last[i]!, last[(i + 1) % segs]!, row[(i + 1) % segs]!, row[i]!);
  }
  return grain(finish(md), 'z');
}

/**
 * An eyelid shutter: a spherical shell of mid radius r and thickness t over
 * the eye, spanning `span` radians from its lip (at the front, +Z) back over
 * the top, `hw` (fraction of r) wide either side. A thick rounded lip.
 */
export function lidShell(r: number, t: number, span: number, o: { segs?: number; across?: number; hw?: number } = {}): BufferGeometry {
  const md = new MeshData();
  const ns = o.segs ?? 8, na = o.across ?? 12;
  const hw = (o.hw ?? 0.99) * Math.PI / 2;
  const Ro = r + t / 2, Ri = r - t / 2;
  // a point on a sphere of radius R at elevation e (0 = front, + up over the top) and azimuth b (across, -hw..hw)
  const P = (R: number, e: number, b: number): [number, number, number] => [Math.sin(b) * R, Math.cos(b) * Math.sin(e) * R, Math.cos(b) * Math.cos(e) * R];
  const outer: number[][] = [], inner: number[][] = [];
  for (let j = 0; j <= ns; j++) {
    const e = (span * j) / ns;
    const ro: number[] = [], ri: number[] = [];
    for (let i = 0; i <= na; i++) {
      const b = -hw + (2 * hw * i) / na;
      const po = P(Ro, e, b), pi = P(Ri, e, b);
      ro.push(md.v(po[0], po[1], po[2], po[0], po[1], po[2]));
      ri.push(md.v(pi[0], pi[1], pi[2], -pi[0], -pi[1], -pi[2]));
    }
    outer.push(ro);
    inner.push(ri);
  }
  for (let j = 0; j < ns; j++)
    for (let i = 0; i < na; i++) {
      md.quad(outer[j]![i]!, outer[j]![i + 1]!, outer[j + 1]![i + 1]!, outer[j + 1]![i]!);
      md.quad(inner[j]![i]!, inner[j + 1]![i]!, inner[j + 1]![i + 1]!, inner[j]![i + 1]!);
    }
  // the lip: a rounded roll from outer to inner at elevation 0, a little below it
  const rollN = 3;
  const roll: number[][] = [outer[0]!];
  for (let k = 1; k < rollN; k++) {
    const a = (Math.PI * k) / rollN; // 0 = outer, pi = inner, round the front-bottom
    const row: number[] = [];
    for (let i = 0; i <= na; i++) {
      const b = -hw + (2 * hw * i) / na;
      const R = r + (t / 2) * Math.cos(a);
      const e = -(t / 2 / r) * Math.sin(a) * 1.4;
      const p = P(R, e, b);
      // normal: between the sphere normal and the downward tangent
      const rad = P(1, e, b);
      const tan = [0, -Math.cos(b) * Math.cos(e), Math.cos(b) * Math.sin(e)];
      const nx = rad[0] * Math.cos(a) + tan[0]! * Math.sin(a), ny = rad[1] * Math.cos(a) + tan[1]! * Math.sin(a), nz = rad[2] * Math.cos(a) + tan[2]! * Math.sin(a);
      row.push(md.v(p[0], p[1], p[2], nx, ny, nz));
    }
    roll.push(row);
  }
  roll.push(inner[0]!);
  for (let k = 0; k < roll.length - 1; k++) for (let i = 0; i < na; i++) md.quad(roll[k]![i]!, roll[k]![i + 1]!, roll[k + 1]![i + 1]!, roll[k + 1]![i]!);
  return grain(finish(md), 'x');
}
