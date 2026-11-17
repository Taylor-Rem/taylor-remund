/**
 * The low-level mesh builder every kit solid writes into, and the step that
 * turns it into a BufferGeometry carrying the kit attributes (position,
 * normal, color, surf, lpos, optional uv; see kit/types.ts).
 *
 * Triangles are auto-oriented: a triangle is wound so its geometric normal
 * agrees with the sum of its vertex normals. Builders therefore only have to
 * get the *normals* right; winding follows. Degenerate triangles (collapsed
 * poles, zero-width crease strips) are dropped.
 */
import { BufferAttribute, BufferGeometry } from 'three';
import { ATTR } from './types.ts';
import { surfFromCurvature } from './surface.ts';

export class MeshData {
  pos: number[] = [];
  nrm: number[] = [];
  /** Optional material-space positions (one vec3 per vertex); when absent, lpos = position. */
  lpos: number[] | null = null;
  uv: number[] | null = null;
  idx: number[] = [];

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  /** Add a vertex; returns its index. The normal is normalised here. */
  v(x: number, y: number, z: number, nx: number, ny: number, nz: number, u = 0, w = 0): number {
    const l = Math.hypot(nx, ny, nz) || 1;
    this.pos.push(x, y, z);
    this.nrm.push(nx / l, ny / l, nz / l);
    if (this.uv) this.uv.push(u, w);
    if (this.lpos) this.lpos.push(x, y, z);
    return this.pos.length / 3 - 1;
  }

  /** Keep a material-space position per vertex (initialised to the positions so far). */
  withLpos(): this {
    if (!this.lpos) this.lpos = this.pos.slice();
    return this;
  }

  /** Set vertex i's material-space position. */
  setL(i: number, x: number, y: number, z: number): void {
    const l = this.withLpos().lpos!;
    l[i * 3] = x;
    l[i * 3 + 1] = y;
    l[i * 3 + 2] = z;
  }

  withUv(): this {
    if (!this.uv) this.uv = new Array<number>((this.pos.length / 3) * 2).fill(0);
    return this;
  }

  /** Add a triangle, oriented by its vertex normals; degenerate ones are skipped. */
  tri(a: number, b: number, c: number): void {
    const p = this.pos;
    const n = this.nrm;
    const ax = p[a * 3]!, ay = p[a * 3 + 1]!, az = p[a * 3 + 2]!;
    const ux = p[b * 3]! - ax, uy = p[b * 3 + 1]! - ay, uz = p[b * 3 + 2]! - az;
    const vx = p[c * 3]! - ax, vy = p[c * 3 + 1]! - ay, vz = p[c * 3 + 2]! - az;
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    const g2 = gx * gx + gy * gy + gz * gz;
    const scale = Math.max(ux * ux + uy * uy + uz * uz, vx * vx + vy * vy + vz * vz);
    if (g2 <= 1e-14 * scale * scale || g2 < 1e-24) return;
    const sx = n[a * 3]! + n[b * 3]! + n[c * 3]!;
    const sy = n[a * 3 + 1]! + n[b * 3 + 1]! + n[c * 3 + 1]!;
    const sz = n[a * 3 + 2]! + n[b * 3 + 2]! + n[c * 3 + 2]!;
    if (gx * sx + gy * sy + gz * sz < 0) this.idx.push(a, c, b);
    else this.idx.push(a, b, c);
  }

  /** Quad a-b-c-d (in loop order), split along the shorter diagonal. */
  quad(a: number, b: number, c: number, d: number): void {
    const p = this.pos;
    const d2 = (i: number, j: number): number =>
      (p[i * 3]! - p[j * 3]!) ** 2 + (p[i * 3 + 1]! - p[j * 3 + 1]!) ** 2 + (p[i * 3 + 2]! - p[j * 3 + 2]!) ** 2;
    if (d2(a, c) <= d2(b, d)) {
      this.tri(a, b, c);
      this.tri(a, c, d);
    } else {
      this.tri(a, b, d);
      this.tri(b, c, d);
    }
  }

  /** Append another MeshData. */
  append(o: MeshData): void {
    const base = this.vertexCount;
    this.pos.push(...o.pos);
    this.nrm.push(...o.nrm);
    if (this.uv || o.uv) {
      this.withUv();
      if (o.uv) this.uv!.push(...o.uv);
      else this.uv!.push(...new Array<number>(o.vertexCount * 2).fill(0));
    }
    if (this.lpos || o.lpos) {
      this.withLpos();
      this.lpos!.push(...(o.lpos ?? o.pos));
    }
    for (const i of o.idx) this.idx.push(i + base);
  }
}

export interface FinishOptions {
  /** Curvature (1/radius) at which wear starts / is full. */
  wear?: [number, number];
  /** Concave curvature at which cavity starts / is full. */
  cavity?: [number, number];
  /** Write uv from lpos: u = lpos.x (along the part, world units), v = lpos.y (sweeps: across the section, along its first axis). */
  uvFromLpos?: boolean;
  /** Wear band (see surface.ts `SurfOptions.band`): remembered on the geometry for later recomputes. */
  band?: number;
}

/**
 * Turn builder data into a kit geometry: position, normal, color (white
 * until tinted), surf (wear and cavity from curvature, finish 0), lpos
 * (material space: the local position unless the builder supplied its own), uv if present.
 */
export function finish(md: MeshData, opts: FinishOptions = {}): BufferGeometry {
  const g = new BufferGeometry();
  const n = md.vertexCount;
  g.setAttribute('position', new BufferAttribute(new Float32Array(md.pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(md.nrm), 3));
  g.setAttribute(ATTR.color, new BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  if (md.uv) g.setAttribute('uv', new BufferAttribute(new Float32Array(md.uv), 2));
  const index = n > 65535 ? new Uint32Array(md.idx) : new Uint16Array(md.idx);
  g.setIndex(new BufferAttribute(index, 1));
  if (opts.band) g.userData['kitBand'] = opts.band;
  g.setAttribute(ATTR.surf, new BufferAttribute(surfFromCurvature(g, opts), 3));
  // material space: the solid's own local position until a builder re-aims it (see `grain`)
  const lp = new Float32Array(md.lpos ?? md.pos);
  g.setAttribute(ATTR.lpos, new BufferAttribute(lp, 3));
  if (opts.uvFromLpos) {
    const uv = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      uv[i * 2] = lp[i * 3]!;
      uv[i * 2 + 1] = lp[i * 3 + 1]!;
    }
    g.setAttribute('uv', new BufferAttribute(uv, 2));
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Triangles in a geometry (indexed or not). */
export function triangleCount(g: BufferGeometry): number {
  return g.index ? g.index.count / 3 : g.getAttribute('position').count / 3;
}
