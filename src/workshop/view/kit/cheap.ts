/**
 * Cheap solids: for things there are many of, or that are small on screen.
 * Promoted from the builders' own geometry (the crate's `geo.ts`, the
 * Button's `geom.ts`) so every piece can use them.
 *
 * WHEN TO USE WHICH
 *  - A part there are dozens of (planks, battens, boards, rows of studs), or
 *    one that is a few pixels on screen at the default view: the cheap forms
 *    here. They spend 10-50 triangles and buy their look from normals (a
 *    one-segment chamfer whose vertices carry the FACE normals shades like a
 *    fillet) and from wear written by intent instead of measured.
 *  - A hero part the camera gets close to (a machine body, the Button's cap,
 *    a knob you can read the knurl on): the fillet-accurate solids
 *    (`roundedBox`, `profiledBox`, `lathe`, `knurledBand`, `hexBolt`...). They
 *    cost 100-1,000 triangles and measure their wear from curvature, with the
 *    wear band reaching onto faces.
 *  - Cheap twins of detailed parts: `hexHead` (30 triangles) vs `hexBolt`
 *    (~80-250); `ridgedBand` (4 a ridge) vs `knurledBand` (~25 a ridge);
 *    `stud` (18) vs `domeRivet` (~80). The detailed functions take
 *    `cheap: true` and return the cheap twin, so a builder can switch per
 *    detail level.
 *
 * Every solid here writes the kit attributes like any other: position,
 * normal, color, surf (vec3: wear, cavity, finish 0) and lpos (the part's
 * own frame; turned parts have their axis on +X). Solids whose wear is
 * written by intent are flagged (`userData.kitSurf = 'intent'`) so `deform`
 * keeps that wear instead of re-measuring it.
 */
import { BufferAttribute, type BufferGeometry } from 'three';
import { finish, MeshData } from './mesh.ts';
import { ATTR } from './types.ts';
import type { V3 } from './loft.ts';
import { mergeGeometries } from './compose.ts';
import { grain } from './space.ts';

export type FaceName = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';
const faceName = (a: number, s: number): FaceName => (['px', 'nx', 'py', 'ny', 'pz', 'nz'] as const)[a * 2 + (s > 0 ? 0 : 1)]!;

/** Overwrite surf with per-vertex wear written by intent (cavity and finish 0) and flag the geometry. */
function intentSurf(g: BufferGeometry, wear: ArrayLike<number>): BufferGeometry {
  const n = g.getAttribute('position').count;
  const s = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) s[i * 3] = wear[i] ?? 0;
  g.setAttribute(ATTR.surf, new BufferAttribute(s, 3));
  g.userData['kitSurf'] = 'intent';
  return g;
}

// ---- bevelBox ---------------------------------------------------------------

export interface BevelBoxOptions {
  min: V3;
  max: V3;
  /** Chamfer leg (0: a plain box). */
  c?: number;
  /** Faces to leave out (never seen). Chamfers and corners touching them go too. */
  omit?: readonly FaceName[];
  /** Wear written on the chamfer band (default 0.75). */
  wear?: number;
  /**
   * Wear band onto the faces (units): one inset ring per face carrying falling wear, so chips
   * can bite into the face. Default 0 (none: the cheapest box). +8 triangles per face.
   */
  band?: number;
}

/**
 * An axis-aligned box from `min` to `max` with one chamfer per edge whose
 * vertices carry the face normals, so the chamfer shades as a fillet; the
 * chamfer's own copies of those vertices carry `wear`, so the worn-edge
 * treatment lands on the chamfer band. 44 triangles whole (fewer with
 * `omit`). The right box for anything there are many of.
 */
export function bevelBox(o: BevelBoxOptions): BufferGeometry {
  const lo = o.min, hi = o.max;
  const c = Math.max(0, Math.min(o.c ?? 0, (hi[0] - lo[0]) / 2 - 1e-5, (hi[1] - lo[1]) / 2 - 1e-5, (hi[2] - lo[2]) / 2 - 1e-5));
  const omit = new Set(o.omit ?? []);
  const has = (a: number, s: number): boolean => !omit.has(faceName(a, s));
  const md = new MeshData();
  const wear: number[] = [];
  const W = o.wear ?? 0.75;
  const band = Math.max(0, o.band ?? 0);
  // F: the face's own vertex; C: its copy on the chamfer band (same place, same normal, worn)
  const F = new Map<string, number>(), C = new Map<string, number>();
  const key = (a: number, s: number, sx: number, sy: number, sz: number): string => `${a}${s}|${sx}${sy}${sz}`;
  const signs = [-1, 1];
  for (let a = 0; a < 3; a++) {
    for (const s of signs) {
      if (!has(a, s)) continue;
      const n: V3 = [0, 0, 0];
      n[a] = s;
      const u = (a + 1) % 3, v = (a + 2) % 3;
      // this face's band: no wider than a third of the face
      const fb = Math.min(band, (hi[u]! - lo[u]! - 2 * c) / 3, (hi[v]! - lo[v]! - 2 * c) / 3);
      const ring = fb > 1e-4;
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
        wear.push(ring ? W * 0.6 : 0);
        F.set(key(a, s, sx, sy, sz), f);
        if (c > 0) {
          C.set(key(a, s, sx, sy, sz), md.v(p[0], p[1], p[2], n[0], n[1], n[2]));
          wear.push(W);
        } else C.set(key(a, s, sx, sy, sz), f);
      }
      const at = (map: Map<string, number>, su: number, sv: number): number => {
        const sg = [0, 0, 0];
        sg[a] = s;
        sg[u] = su;
        sg[v] = sv;
        return map.get(key(a, s, sg[0]!, sg[1]!, sg[2]!))!;
      };
      const corners: Array<[number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      if (!ring) {
        md.quad(at(F, -1, -1), at(F, 1, -1), at(F, 1, 1), at(F, -1, 1));
        continue;
      }
      // inset ring (wear 0) a band in from the face's edge, the band as four quads
      const inner = corners.map(([su, sv]) => {
        const f = at(F, su, sv);
        const p: V3 = [md.pos[f * 3]!, md.pos[f * 3 + 1]!, md.pos[f * 3 + 2]!];
        p[u] = p[u]! - su * fb;
        p[v] = p[v]! - sv * fb;
        wear.push(0);
        return md.v(p[0], p[1], p[2], n[0], n[1], n[2]);
      });
      const outer = corners.map(([su, sv]) => at(F, su, sv));
      for (let k = 0; k < 4; k++) md.quad(outer[k]!, outer[(k + 1) % 4]!, inner[(k + 1) % 4]!, inner[k]!);
      md.quad(inner[0]!, inner[1]!, inner[2]!, inner[3]!);
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
  return intentSurf(finish(md), wear);
}

/** A box seen from inside: six faces whose normals point inward (12 triangles). The dark inside of a crate. */
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
  return intentSurf(finish(md), []);
}

/**
 * A flat polygon in the XY plane at z = 0 facing +Z, covering [x0, x1] ×
 * [y0, y1] with a ragged edge (paint laid a hair over a face): `n` boundary
 * points, each pulled inward by up to `bite` (one in five much further: a
 * chip; corners take the worst). A fan from the centre: n triangles. `r` is a
 * seeded 0..1 source (an `Rng`).
 */
export function skin(x0: number, x1: number, y0: number, y1: number, n: number, bite: number, r: () => number): BufferGeometry {
  const md = new MeshData();
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const centre = md.v(cx, cy, 0, 0, 0, 1);
  const w = x1 - x0, h = y1 - y0;
  const per = 2 * (w + h);
  const ids: number[] = [];
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
  return intentSurf(finish(md), []);
}

/**
 * A textured rectangle [x0, x1] × [y0, y1] (uv 0..1, u along +X, v up) in
 * the plane z = 0 facing +Z, cut to the horizontal `bands` it overlaps (each
 * [yb0, yb1]): what falls in a gap between bands (planks) is left out, the
 * way spray stops at a gap. Null if nothing is left.
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
  return intentSurf(finish(md), []);
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
  return grain(intentSurf(finish(md), wear), 'y');
}

/**
 * Merge geometries into one and report where each of the `marked` ones ended
 * up (vertex start, count): for a builder that must find a sub-range later.
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

// ---- from the Button --------------------------------------------------------

type P2 = readonly [number, number];

export interface SheetOptions {
  w: number;
  h: number;
  /** Thickness (default 0.003). */
  t?: number;
  /** Grid resolution (default 8 × 3), enough for a lifting corner to bend. */
  nx?: number;
  ny?: number;
  /** How far (+Z) the sheet stands off the surface at (u, v): a peeling corner. */
  lift?: (u: number, v: number) => number;
  /** Build the back and the cut edge instead of the face (so the face can be textured and the back plain). */
  back?: boolean;
}

/**
 * A thin sheet (label tape, a sticker, a paper slip) in the XY plane facing
 * +Z, centred on the origin, w × h, `t` thick. The face carries uv 0..1 (u
 * along x, v up y); `lift` peels a corner. `back: true` gives the plain back
 * and the visible cut edge as a separate geometry.
 */
export function sheet(o: SheetOptions): BufferGeometry {
  const nx = o.nx ?? 8, ny = o.ny ?? 3;
  const t = o.t ?? 0.003;
  const lift = o.lift ?? (() => 0);
  const md = new MeshData().withUv();
  const grid: number[][] = [];
  const e = 1e-3;
  for (let j = 0; j <= ny; j++) {
    const row: number[] = [];
    for (let i = 0; i <= nx; i++) {
      const u = i / nx, v = j / ny;
      const x = (u - 0.5) * o.w, y = (v - 0.5) * o.h;
      const z = lift(u, v);
      const dzdx = (lift(Math.min(1, u + e), v) - lift(Math.max(0, u - e), v)) / ((Math.min(1, u + e) - Math.max(0, u - e)) * o.w);
      const dzdy = (lift(u, Math.min(1, v + e)) - lift(u, Math.max(0, v - e))) / ((Math.min(1, v + e) - Math.max(0, v - e)) * o.h);
      const s = o.back ? -1 : 1;
      row.push(md.v(x, y, o.back ? z : z + t, -dzdx * s, -dzdy * s, s, u, v));
    }
    grid.push(row);
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) md.quad(grid[j]![i]!, grid[j]![i + 1]!, grid[j + 1]![i + 1]!, grid[j + 1]![i]!);
  if (o.back) {
    const ring: Array<[number, number]> = [];
    for (let i = 0; i <= nx; i++) ring.push([i, 0]);
    for (let j = 1; j <= ny; j++) ring.push([nx, j]);
    for (let i = nx - 1; i >= 0; i--) ring.push([i, ny]);
    for (let j = ny - 1; j >= 1; j--) ring.push([0, j]);
    const idx: Array<[number, number]> = [];
    for (const [i, j] of ring) {
      const u = i / nx, v = j / ny;
      const x = (u - 0.5) * o.w, y = (v - 0.5) * o.h, z = lift(u, v);
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
 * Painted strokes lying on a cylinder of radius r about the Y axis (digits on
 * a counter wheel): each stroke is a polyline in (s, a), s along the axis and
 * a the arc length round the cylinder from the angle `phi0` (0 faces +Z,
 * angles grow toward -X). A flat ribbon `width` wide, `lift` off the surface.
 * Two triangles a segment.
 */
export function cylinderRibbons(strokes: ReadonlyArray<ReadonlyArray<P2>>, o: { r: number; width: number; lift?: number; phi0?: number }): BufferGeometry {
  const md = new MeshData();
  const R = o.r + (o.lift ?? 0.0006);
  const at = (s: number, a: number): [number, number, number, number, number, number] => {
    const phi = (o.phi0 ?? 0) + a / R;
    const nx = -Math.sin(phi), nz = Math.cos(phi);
    return [nx * R, s, nz * R, nx, 0, nz];
  };
  for (const st of strokes) {
    if (st.length < 2) continue;
    const pairs: Array<[number, number]> = [];
    for (let k = 0; k < st.length; k++) {
      const p = st[k]!;
      const prev = st[Math.max(0, k - 1)]!, next = st[Math.min(st.length - 1, k + 1)]!;
      let ts = next[0] - prev[0], ta = next[1] - prev[1];
      const l = Math.hypot(ts, ta) || 1;
      ts /= l;
      ta /= l;
      const hw = o.width / 2;
      const ps = -ta * hw, pa = ts * hw;
      const A = at(p[0] + ps, p[1] + pa), B = at(p[0] - ps, p[1] - pa);
      pairs.push([md.v(A[0], A[1], A[2], A[3], A[4], A[5]), md.v(B[0], B[1], B[2], B[3], B[4], B[5])]);
    }
    for (let k = 0; k + 1 < pairs.length; k++) md.quad(pairs[k]![0], pairs[k + 1]![0], pairs[k + 1]![1], pairs[k]![1]);
  }
  return grain(finish(md), 'y');
}

/**
 * A cheap knurled band about the Y axis from y = 0 to h: `ridges` straight
 * ridges with flat facets (crease normals, so each facet catches the light
 * on its own), crowns at radius r, valleys `depth` in. Open at both ends (it
 * sits between two lips that hide them). 4 triangles a ridge, against the
 * fillet-accurate `knurledBand`'s ~25.
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
    let nx = z1 - z0, nz = -(x1 - x0);
    if (nx * (x0 + x1) + nz * (z0 + z1) < 0) {
      nx = -nx;
      nz = -nz;
    }
    const a = md.v(x0, 0, z0, nx, 0, nz), b = md.v(x1, 0, z1, nx, 0, nz), c = md.v(x1, h, z1, nx, 0, nz), d = md.v(x0, h, z0, nx, 0, nz);
    md.quad(a, b, c, d);
  }
  return grain(finish(md), 'y');
}

/**
 * A cheap hex bolt head standing on y = 0: six flat flanks, a chamfered top
 * edge (where the highlight lives) and a flat crown. 30 triangles, against
 * `hexBolt`'s ~80-250; for rows of bolts on a budget. `af` across flats.
 */
export function hexHead(af: number, h: number, spin = 0): BufferGeometry {
  const md = new MeshData();
  const R = af / Math.sqrt(3);
  const c = h * 0.32;
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
    const [ax, az] = corner(k, Rt), [bx, bz] = corner(k1, Rt);
    const [cx, cz] = corner(k, R), [dx, dz] = corner(k1, R);
    const ch = [md.v(ax, h, az, fx, 1, fz), md.v(bx, h, bz, fx, 1, fz), md.v(dx, h - c, dz, fx, 1, fz), md.v(cx, h - c, cz, fx, 1, fz)];
    md.quad(ch[0]!, ch[1]!, ch[2]!, ch[3]!);
    const fl = [md.v(cx, h - c, cz, fx, 0, fz), md.v(dx, h - c, dz, fx, 0, fz), md.v(dx, 0, dz, fx, 0, fz), md.v(cx, 0, cz, fx, 0, fz)];
    md.quad(fl[0]!, fl[1]!, fl[2]!, fl[3]!);
  }
  return grain(finish(md), 'y');
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

function polyArea(p: P2[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!, b = p[(i + 1) % p.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

/**
 * Diagonal stripes (hazard paint) clipped to the rectangle |x| <= hx,
 * |y| <= hy: the 2D polygons where c0 + k·pitch <= x·dx + y·dy <= c0 +
 * k·pitch + width. Turn each into geometry with `extrude` (a raised stripe)
 * or a flat fan.
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
    if (poly.length >= 3 && polyArea(poly) > width * width * 0.05) out.push(poly);
  }
  return out;
}

/**
 * The ten digits as strokes in a box 0.6 wide × 1 tall (x right, y up), for
 * `cylinderRibbons` on a counter's wheels. Numerals on a mechanism, drawn
 * as strokes, not text.
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
