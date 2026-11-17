/**
 * The loft core: one function behind the lathe, the rounded and chamfered
 * boxes, the tray, the extruded outline and the sweep. A set of loops
 * (outer + holes, in a local u/v plane) is offset by each profile sample's
 * o and carried to that sample's frame. Normals are analytic:
 *   N = no · (n.u · U + n.v · V) + ny · W
 * so fillets shade like a high-poly model and flats stay exactly flat.
 */
import { ShapeUtils, Vector2 } from 'three';
import { MeshData } from './mesh.ts';
import type { Loop, PSample } from './profile.ts';
import { loopLength } from './profile.ts';

export type V3 = [number, number, number];

/** Where a profile sample's ring sits: origin, the loop plane's axes U and V, and W (the profile's y axis). */
export interface Frame {
  o: V3;
  u: V3;
  v: V3;
  w: V3;
}

/** The plan frame at height y: loops in XZ, profile along +Y. */
export function planFrame(y: number): Frame {
  return { o: [0, y, 0], u: [1, 0, 0], v: [0, 0, 1], w: [0, 1, 0] };
}

export interface LoftInput {
  /** Outer loop first, then holes. */
  loops: Loop[];
  profile: PSample[];
  closedProfile?: boolean;
  /** Frame for each profile sample (by index). Default: planFrame(sample.y). */
  frame?: (s: PSample, i: number) => Frame;
  /** Fill the ends of an open profile (default true; 'start'/'end' for one only, e.g. to skip a hidden base). */
  caps?: boolean | 'start' | 'end';
}

const EPS = 1e-9;

export function loft(input: LoftInput, md = new MeshData()): MeshData {
  const { loops, profile } = input;
  const frameOf = input.frame ?? ((s: PSample) => planFrame(s.y));
  const K = profile.length;
  const frames = profile.map((s, i) => frameOf(s, i));
  // ring vertex indices: rings[loop][k][j]
  const rings: number[][][] = loops.map((loop) => {
    const J = loopLength(loop);
    const perK: number[][] = [];
    for (let k = 0; k < K; k++) {
      const s = profile[k]!;
      const F = frames[k]!;
      const row: number[] = [];
      for (let j = 0; j < J; j++) {
        const pu = loop.p[j * 2]! + s.o * loop.m[j * 2]!;
        const pv = loop.p[j * 2 + 1]! + s.o * loop.m[j * 2 + 1]!;
        const nu = loop.n[j * 2]!, nv = loop.n[j * 2 + 1]!;
        const x = F.o[0] + F.u[0] * pu + F.v[0] * pv;
        const y = F.o[1] + F.u[1] * pu + F.v[1] * pv;
        const z = F.o[2] + F.u[2] * pu + F.v[2] * pv;
        const nx = s.no * (nu * F.u[0] + nv * F.v[0]) + s.ny * F.w[0];
        const ny = s.no * (nu * F.u[1] + nv * F.v[1]) + s.ny * F.w[1];
        const nz = s.no * (nu * F.u[2] + nv * F.v[2]) + s.ny * F.w[2];
        row.push(md.v(x, y, z, nx, ny, nz));
      }
      perK.push(row);
    }
    return perK;
  });

  const same = (a: number, b: number): boolean => {
    const p = md.pos;
    return Math.abs(p[a * 3]! - p[b * 3]!) < EPS && Math.abs(p[a * 3 + 1]! - p[b * 3 + 1]!) < EPS && Math.abs(p[a * 3 + 2]! - p[b * 3 + 2]!) < EPS;
  };

  // strips
  const kSegs = input.closedProfile ? K : K - 1;
  loops.forEach((loop, li) => {
    const J = loopLength(loop);
    const jSegs = loop.closed ? J : J - 1;
    const R = rings[li]!;
    for (let k = 0; k < kSegs; k++) {
      const r0 = R[k]!, r1 = R[(k + 1) % K]!;
      if (r0[0] !== undefined && r1[0] !== undefined && J > 0 && same(r0[0], r1[0]) && (J < 2 || same(r0[1]!, r1[1]!))) continue; // crease duplicate
      for (let j = 0; j < jSegs; j++) {
        const j1 = (j + 1) % J;
        md.quad(r0[j]!, r0[j1]!, r1[j1]!, r1[j]!);
      }
    }
  });

  // end caps
  if (!input.closedProfile && input.caps !== false) {
    const ends = input.caps === 'start' ? [0] : input.caps === 'end' ? [K - 1] : [0, K - 1];
    for (const end of ends) {
      const s = profile[end]!;
      const F = frames[end]!;
      const sign = Math.abs(s.ny) > 0.3 ? Math.sign(s.ny) : end === 0 ? -1 : 1;
      capRings(md, loops, rings.map((R) => R[end]!), F, sign);
    }
  }

  // side caps for a partial sweep (an open single loop around an axis point)
  const first = loops[0];
  if (first && !first.closed && loops.length === 1 && input.caps !== false) {
    const J = loopLength(first);
    const R = rings[0]!;
    for (const j of [0, J - 1]) {
      const jn = j === 0 ? 1 : J - 2;
      // tangent direction along the loop, pointing away from the solid at this end
      const tu = first.n[j * 2]! - first.n[jn * 2]!;
      const tv = first.n[j * 2 + 1]! - first.n[jn * 2 + 1]!;
      sideCap(md, R.map((row) => row[j]!), profile, tu, tv, frames);
    }
  }
  return md;
}

function capRings(md: MeshData, loops: Loop[], rows: number[][], F: Frame, sign: number): void {
  // 2D coords in (u, v) for each ring, deduped
  const polys: Array<{ pts: Vector2[]; ids: number[] }> = [];
  loops.forEach((_loop, li) => {
    const row = rows[li]!;
    const pts: Vector2[] = [];
    const ids: number[] = [];
    for (const id of row) {
      const x = md.pos[id * 3]! - F.o[0], y = md.pos[id * 3 + 1]! - F.o[1], z = md.pos[id * 3 + 2]! - F.o[2];
      const u = x * F.u[0] + y * F.u[1] + z * F.u[2];
      const v = x * F.v[0] + y * F.v[1] + z * F.v[2];
      const last = pts[pts.length - 1];
      if (last && Math.abs(last.x - u) < 1e-7 && Math.abs(last.y - v) < 1e-7) continue;
      pts.push(new Vector2(u, v));
      ids.push(id);
    }
    while (pts.length > 2 && pts[0]!.distanceTo(pts[pts.length - 1]!) < 1e-7) {
      pts.pop();
      ids.pop();
    }
    polys.push({ pts, ids });
  });
  const outer = polys[0];
  if (!outer || outer.pts.length < 3 || Math.abs(ShapeUtils.area(outer.pts)) < 1e-10) return;
  const holes = polys.slice(1).filter((h) => h.pts.length >= 3 && Math.abs(ShapeUtils.area(h.pts)) > 1e-10);
  const faces = ShapeUtils.triangulateShape(
    outer.pts.map((p) => p.clone()),
    holes.map((h) => h.pts.map((p) => p.clone())),
  );
  const allIds = [...outer.ids, ...holes.flatMap((h) => h.ids)];
  const nx = F.w[0] * sign, ny = F.w[1] * sign, nz = F.w[2] * sign;
  const capId = new Map<number, number>();
  const get = (src: number): number => {
    let v = capId.get(src);
    if (v === undefined) {
      v = md.v(md.pos[src * 3]!, md.pos[src * 3 + 1]!, md.pos[src * 3 + 2]!, nx, ny, nz);
      capId.set(src, v);
    }
    return v;
  };
  for (const f of faces) md.tri(get(allIds[f[0]!]!), get(allIds[f[1]!]!), get(allIds[f[2]!]!));
}

function sideCap(md: MeshData, column: number[], profile: PSample[], tu: number, tv: number, frames: Frame[]): void {
  // the profile polygon at this loop sample, triangulated in (o, y)
  const pts: Vector2[] = [];
  const ids: number[] = [];
  column.forEach((id, k) => {
    const s = profile[k]!;
    const last = pts[pts.length - 1];
    if (last && Math.abs(last.x - s.o) < 1e-7 && Math.abs(last.y - s.y) < 1e-7) return;
    pts.push(new Vector2(s.o, s.y));
    ids.push(id);
  });
  if (pts.length < 3 || Math.abs(ShapeUtils.area(pts)) < 1e-10) return;
  const F = frames[0]!;
  const l = Math.hypot(tu, tv) || 1;
  const nx = (F.u[0] * tu + F.v[0] * tv) / l, ny = (F.u[1] * tu + F.v[1] * tv) / l, nz = (F.u[2] * tu + F.v[2] * tv) / l;
  const faces = ShapeUtils.triangulateShape(pts, []);
  const map = new Map<number, number>();
  const get = (src: number): number => {
    let v = map.get(src);
    if (v === undefined) {
      v = md.v(md.pos[src * 3]!, md.pos[src * 3 + 1]!, md.pos[src * 3 + 2]!, nx, ny, nz);
      map.set(src, v);
    }
    return v;
  };
  for (const f of faces) md.tri(get(ids[f[0]!]!), get(ids[f[1]!]!), get(ids[f[2]!]!));
}
