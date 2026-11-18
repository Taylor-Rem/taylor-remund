/**
 * Cheap solids for pieces that come by the dozen (crates, bench planks,
 * wall boards). The kit's `roundedBox` spends ~108-156 triangles on a box;
 * a crate has thirty boxes and a budget of 1,400, so these spend 10-44 and
 * buy their look from normals and from wear written by intent:
 *
 *  - `bevelBox`: one chamfer per edge whose vertices carry the FACE normals,
 *    so the chamfer shades as a fillet (the highlight lives on it), and whose
 *    own copies of those vertices carry `wear`, so the materials' worn-edge
 *    treatment lands exactly on the chamfer band. Hidden faces can be left
 *    out (a plank's back, a rail's ends buried in a post).
 *  - `skin`: a flat ragged-edged polygon laid a hair over a face (paint).
 *  - `decalBands`: a textured rectangle cut into horizontal bands so it
 *    stops at the gaps between planks, the way spray does.
 *  - `stud`: a low dome for rivets and nail heads (18 triangles).
 *  - `innerBox`: a box whose faces look inward (the dark inside of a crate,
 *    seen through the gaps).
 *
 * Candidates for promotion to the shared kit (details.ts / solids.ts).
 */
import { BufferAttribute, type BufferGeometry } from 'three';
import { finish, MeshData } from '../../mesh.ts';
import { ATTR } from '../../types.ts';
import type { V3 } from '../../loft.ts';
import { mergeGeometries } from '../../compose.ts';

export type FaceName = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';
const FACE: Record<FaceName, [number, number]> = { px: [0, 1], nx: [0, -1], py: [1, 1], ny: [1, -1], pz: [2, 1], nz: [2, -1] };
const faceName = (a: number, s: number): FaceName => (['px', 'nx', 'py', 'ny', 'pz', 'nz'] as const)[a * 2 + (s > 0 ? 0 : 1)]!;

export interface BevelBoxOptions {
  min: V3;
  max: V3;
  /** Chamfer leg (0: a plain box). */
  c?: number;
  /** Faces to leave out (never seen). Chamfers and corners touching them go too. */
  omit?: readonly FaceName[];
  /** Wear written on the chamfer band (default 0.75). */
  wear?: number;
}

/** Write surf (x wear, y cavity, z finish) from per-vertex wear; cavity and finish 0. */
function writeSurf(g: BufferGeometry, wear: ArrayLike<number>): BufferGeometry {
  const n = g.getAttribute('position').count;
  const s = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) s[i * 3] = wear[i] ?? 0;
  g.setAttribute(ATTR.surf, new BufferAttribute(s, 3));
  return g;
}

/** An axis-aligned box from `min` to `max` with one chamfer per edge (see the file note). 44 triangles whole. */
export function bevelBox(o: BevelBoxOptions): BufferGeometry {
  const lo = o.min, hi = o.max;
  const c = Math.max(0, Math.min(o.c ?? 0, (hi[0] - lo[0]) / 2 - 1e-5, (hi[1] - lo[1]) / 2 - 1e-5, (hi[2] - lo[2]) / 2 - 1e-5));
  const omit = new Set(o.omit ?? []);
  const has = (a: number, s: number): boolean => !omit.has(faceName(a, s));
  const md = new MeshData();
  const wear: number[] = [];
  const W = o.wear ?? 0.75;
  // F: the face's own vertex; C: its copy on the chamfer band (same place, same normal, worn)
  const F = new Map<string, number>(), C = new Map<string, number>();
  const key = (a: number, s: number, sx: number, sy: number, sz: number): string => `${a}${s}|${sx}${sy}${sz}`;
  const signs = [-1, 1];
  for (let a = 0; a < 3; a++) {
    for (const s of signs) {
      if (!has(a, s)) continue;
      const n: V3 = [0, 0, 0];
      n[a] = s;
      for (const sx of signs) for (const sy of signs) for (const sz of signs) {
        const sg = [sx, sy, sz];
        if (sg[a] !== s) continue;
        const p: V3 = [0, 0, 0];
        // inset by the chamfer only toward a face that exists (an omitted neighbour leaves this face running to the edge)
        for (let k = 0; k < 3; k++) {
          const ck = has(k, sg[k]!) ? c : 0;
          p[k] = k === a ? (s > 0 ? hi[k]! : lo[k]!) : sg[k]! > 0 ? hi[k]! - ck : lo[k]! + ck;
        }
        const f = md.v(p[0], p[1], p[2], n[0], n[1], n[2]);
        wear.push(0);
        F.set(key(a, s, sx, sy, sz), f);
        if (c > 0) {
          C.set(key(a, s, sx, sy, sz), md.v(p[0], p[1], p[2], n[0], n[1], n[2]));
          wear.push(W);
        } else C.set(key(a, s, sx, sy, sz), f);
      }
      const u = (a + 1) % 3, v = (a + 2) % 3;
      const at = (su: number, sv: number): number => {
        const sg = [0, 0, 0];
        sg[a] = s;
        sg[u] = su;
        sg[v] = sv;
        return F.get(key(a, s, sg[0]!, sg[1]!, sg[2]!))!;
      };
      md.quad(at(-1, -1), at(1, -1), at(1, 1), at(-1, 1));
    }
  }
  if (c > 0) {
    for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) {
      const w = 3 - a - b;
      for (const sa of signs) for (const sb of signs) {
        if (!has(a, sa) || !has(b, sb)) continue;
        const pick = (face: number, fs: number, sw: number): number => {
          const sg = [0, 0, 0];
          sg[a] = sa;
          sg[b] = sb;
          sg[w] = sw;
          return C.get(key(face, fs, sg[0]!, sg[1]!, sg[2]!))!;
        };
        md.quad(pick(a, sa, -1), pick(a, sa, 1), pick(b, sb, 1), pick(b, sb, -1));
      }
    }
    for (const sx of signs) for (const sy of signs) for (const sz of signs) {
      if (!has(0, sx) || !has(1, sy) || !has(2, sz)) continue;
      md.tri(C.get(key(0, sx, sx, sy, sz))!, C.get(key(1, sy, sx, sy, sz))!, C.get(key(2, sz, sx, sy, sz))!);
    }
  }
  return writeSurf(finish(md), wear);
}

/**
 * `bevelBox` with a chamfer only on the edges `chamfered(a, sa, b, sb)` picks (the edge between
 * face a of sign sa and face b of sign sb), for parts whose other edges no one sees chamfered:
 * where a chamfer runs out into a face whose own edges are sharp, that face takes the chamfer's
 * cut corner (a pentagon or an octagon). Two uses:
 *  - `cornerChamfer(sx, sy, sz)`: the three edges meeting one corner and the corner itself (an
 *    iron bracket: its outer corner of the crate is what catches the light; its edges against the
 *    wood are a sheet's crisp step). 22 triangles.
 *  - `axisChamfer(axis)`: the four edges along one axis (a post: its ends sit under the lid and on
 *    the ground). 28 triangles.
 * Not every pick is supported: an edge set must be one of those two kinds (all three edges at a
 * corner, or edges that never meet).
 */
export function chamferBox(o: { min: V3; max: V3; c: number; wear?: number; chamfered: (a: number, sa: number, b: number, sb: number) => boolean }): BufferGeometry {
  const lo = o.min, hi = o.max;
  const c = Math.max(0, Math.min(o.c, (hi[0] - lo[0]) / 2 - 1e-5, (hi[1] - lo[1]) / 2 - 1e-5, (hi[2] - lo[2]) / 2 - 1e-5));
  const ch = (a: number, sa: number, b: number, sb: number): boolean => c > 0 && (a < b ? o.chamfered(a, sa, b, sb) : o.chamfered(b, sb, a, sa));
  const md = new MeshData();
  const wear: number[] = [];
  const W = o.wear ?? 0.75;
  const C = new Map<string, number>();
  const key = (a: number, s: number, sg: readonly number[]): string => `${a}${s}|${sg[0]}${sg[1]}${sg[2]}`;
  const signs = [-1, 1];
  const point = (sg: readonly number[], inset: readonly number[]): V3 => {
    const p: V3 = [0, 0, 0];
    for (let k = 0; k < 3; k++) p[k] = (sg[k]! > 0 ? hi[k]! : lo[k]!) - sg[k]! * (inset[k] ?? 0);
    return p;
  };
  for (let a = 0; a < 3; a++) {
    const u = (a + 1) % 3, v = (a + 2) % 3;
    for (const s of signs) {
      const n: V3 = [0, 0, 0];
      n[a] = s;
      const ring: number[] = [];
      let prev: [number, number] = [-1, 1];
      for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        const sg = [0, 0, 0];
        sg[a] = s;
        sg[u] = su;
        sg[v] = sv;
        const cu = ch(a, s, u, su), cv = ch(a, s, v, sv), cuv = ch(u, su, v, sv);
        if (cu || cv) {
          const inset = [0, 0, 0];
          if (cu) inset[u] = c;
          if (cv) inset[v] = c;
          const p = point(sg, inset);
          ring.push(md.v(p[0], p[1], p[2], n[0], n[1], n[2]));
          wear.push(0);
          C.set(key(a, s, sg), md.v(p[0], p[1], p[2], n[0], n[1], n[2]));
          wear.push(W);
        } else if (cuv) {
          // the u-v chamfer runs out here: cut the corner. Coming along u (same v), the point inset along u first
          const iu = [0, 0, 0], iv = [0, 0, 0];
          iu[u] = c;
          iv[v] = c;
          const alongU = prev[1] === sv;
          for (const inset of alongU ? [iu, iv] : [iv, iu]) {
            const p = point(sg, inset);
            ring.push(md.v(p[0], p[1], p[2], n[0], n[1], n[2]));
            wear.push(0);
          }
        } else {
          const p = point(sg, [0, 0, 0]);
          ring.push(md.v(p[0], p[1], p[2], n[0], n[1], n[2]));
          wear.push(0);
        }
        prev = [su, sv];
      }
      for (let i = 1; i < ring.length - 1; i++) md.tri(ring[0]!, ring[i]!, ring[i + 1]!);
    }
  }
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) {
    const w = 3 - a - b;
    for (const sa of signs) for (const sb of signs) {
      if (!ch(a, sa, b, sb)) continue;
      const pick = (face: number, fs: number, sw: number): number => {
        const sg = [0, 0, 0];
        sg[a] = sa;
        sg[b] = sb;
        sg[w] = sw;
        return C.get(key(face, fs, sg))!;
      };
      md.quad(pick(a, sa, -1), pick(a, sa, 1), pick(b, sb, 1), pick(b, sb, -1));
    }
  }
  for (const sx of signs) for (const sy of signs) for (const sz of signs) {
    if (!ch(0, sx, 1, sy) || !ch(0, sx, 2, sz) || !ch(1, sy, 2, sz)) continue;
    const sg = [sx, sy, sz];
    md.tri(C.get(key(0, sx, sg))!, C.get(key(1, sy, sg))!, C.get(key(2, sz, sg))!);
  }
  return writeSurf(finish(md), wear);
}

/** chamferBox's edge pick: the three edges meeting the corner of signs (sx, sy, sz). */
export const cornerChamfer = (sx: number, sy: number, sz: number) => (a: number, sa: number, b: number, sb: number): boolean => sa === [sx, sy, sz][a] && sb === [sx, sy, sz][b];
/** chamferBox's edge pick: the four edges running along `axis` (0 x, 1 y, 2 z). */
export const axisChamfer = (axis: number) => (a: number, _sa: number, b: number): boolean => a !== axis && b !== axis;

/** A box seen from inside: six faces whose normals point inward (12 triangles). */
export function innerBox(min: V3, max: V3): BufferGeometry {
  const md = new MeshData();
  for (let a = 0; a < 3; a++) {
    for (const s of [-1, 1]) {
      const n: V3 = [0, 0, 0];
      n[a] = -s;
      const u = (a + 1) % 3, v = (a + 2) % 3;
      const ids: number[] = [];
      for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        const p: V3 = [0, 0, 0];
        p[a] = s > 0 ? max[a]! : min[a]!;
        p[u] = su > 0 ? max[u]! : min[u]!;
        p[v] = sv > 0 ? max[v]! : min[v]!;
        ids.push(md.v(p[0], p[1], p[2], n[0], n[1], n[2]));
      }
      md.quad(ids[0]!, ids[1]!, ids[2]!, ids[3]!);
    }
  }
  return writeSurf(finish(md), []);
}

/**
 * A flat polygon in the XY plane at z = 0 facing +Z, covering the rectangle
 * [x0, x1] × [y0, y1] with a ragged edge: `n` boundary points, each pulled
 * inward by up to `bite` (a few pulled much further: chips). A fan from the
 * centre: n triangles. `r` is a seeded 0..1 source.
 */
export function skin(x0: number, x1: number, y0: number, y1: number, n: number, bite: number, r: () => number): BufferGeometry {
  const md = new MeshData();
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const centre = md.v(cx, cy, 0, 0, 0, 1);
  const w = x1 - x0, h = y1 - y0;
  const per = 2 * (w + h);
  const ids: number[] = [];
  // distribute points along the perimeter (corners always included)
  const corners = [0, w, w + h, 2 * w + h];
  const ts: number[] = [...corners];
  const extra = Math.max(0, n - 4);
  for (let i = 0; i < extra; i++) ts.push(((i + 0.5 + (r() - 0.5) * 0.6) / extra) * per);
  ts.sort((a, b) => a - b);
  for (const t of ts) {
    let x: number, y: number, nx: number, ny: number;
    if (t < w) { x = x0 + t; y = y0; nx = 0; ny = 1; }
    else if (t < w + h) { x = x1; y = y0 + (t - w); nx = -1; ny = 0; }
    else if (t < 2 * w + h) { x = x1 - (t - w - h); y = y1; nx = 0; ny = -1; }
    else { x = x0; y = y1 - (t - 2 * w - h); nx = 1; ny = 0; }
    const isCorner = corners.some((c) => Math.abs(c - t) < 1e-9);
    // corners take the worst of it; one point in five is a real chip
    let d = bite * (0.25 + 0.75 * r());
    if (isCorner) d *= 1.6;
    else if (r() < 0.2) d *= 2.6;
    if (isCorner) {
      x += (x < cx ? 1 : -1) * d * 0.7;
      y += (y < cy ? 1 : -1) * d * 0.7;
    } else {
      x += nx * d;
      y += ny * d;
    }
    ids.push(md.v(x, y, 0, 0, 0, 1));
  }
  for (let i = 0; i < ids.length; i++) md.tri(centre, ids[i]!, ids[(i + 1) % ids.length]!);
  return writeSurf(finish(md), []);
}

/**
 * A textured rectangle [x0, x1] × [y0, y1] (uv 0..1, u along +X, v up) in
 * the plane z = 0 facing +Z, cut to the horizontal `bands` it overlaps
 * (each [yb0, yb1]): what falls in a gap between bands is left out.
 */
export function decalBands(x0: number, x1: number, y0: number, y1: number, bands: ReadonlyArray<readonly [number, number]>): BufferGeometry | null {
  const md = new MeshData().withUv();
  for (const [b0, b1] of bands) {
    const a = Math.max(y0, b0), b = Math.min(y1, b1);
    if (b - a < 1e-4) continue;
    const va = (a - y0) / (y1 - y0), vb = (b - y0) / (y1 - y0);
    const i0 = md.v(x0, a, 0, 0, 0, 1, 0, va);
    const i1 = md.v(x1, a, 0, 0, 0, 1, 1, va);
    const i2 = md.v(x1, b, 0, 0, 0, 1, 1, vb);
    const i3 = md.v(x0, b, 0, 0, 0, 1, 0, vb);
    md.quad(i0, i1, i2, i3);
  }
  if (md.vertexCount === 0) return null;
  return writeSurf(finish(md), []);
}

/** A low dome (rivet head, nail head) standing on y = 0: radius r, height h, `segs` round (18 triangles at 6). */
export function stud(r: number, h: number, segs = 6): BufferGeometry {
  const md = new MeshData();
  const base: number[] = [], mid: number[] = [];
  const wear: number[] = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const cx = Math.cos(a), cz = Math.sin(a);
    base.push(md.v(cx * r, 0, cz * r, cx, 0.35, cz));
    wear.push(0.2);
    mid.push(md.v(cx * r * 0.74, h * 0.62, cz * r * 0.74, cx * 0.8, 0.9, cz * 0.8));
    wear.push(0.8);
  }
  const top = md.v(0, h, 0, 0, 1, 0);
  wear.push(0.5);
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs;
    md.quad(base[i]!, base[j]!, mid[j]!, mid[i]!);
    md.tri(mid[i]!, mid[j]!, top);
  }
  return writeSurf(finish(md), wear);
}

/**
 * A rivet or nail head for where it is a dot of light (a pixel or two at the bench): a low cone of
 * `segs` sides (`segs` triangles) whose normals lean like a dome's, so it shades as `stud` does.
 */
export function pip(r: number, h: number, segs = 5): BufferGeometry {
  const md = new MeshData();
  const wear: number[] = [];
  const base: number[] = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const cx = Math.cos(a), cz = Math.sin(a);
    base.push(md.v(cx * r, 0, cz * r, cx, 0.6, cz));
    wear.push(0.3);
  }
  const top = md.v(0, h, 0, 0, 1, 0);
  wear.push(0.7);
  for (let i = 0; i < segs; i++) md.tri(base[i]!, base[(i + 1) % segs]!, top);
  return writeSurf(finish(md), wear);
}

/**
 * Merge geometries into one and report where each of the `marked` ones ended
 * up (vertex start, count): a builder that needs to find a sub-range later
 * (the paint on a crate) merges with this.
 */
export function mergeMarked(geoms: readonly BufferGeometry[], marked: ReadonlySet<BufferGeometry>): { geometry: BufferGeometry; ranges: Array<[number, number]> } {
  const ranges: Array<[number, number]> = [];
  let at = 0;
  for (const g of geoms) {
    const n = g.getAttribute('position').count;
    if (marked.has(g)) ranges.push([at, n]);
    at += n;
  }
  return { geometry: geoms.length === 1 ? geoms[0]! : mergeGeometries(geoms), ranges };
}

export const FACES = FACE;
