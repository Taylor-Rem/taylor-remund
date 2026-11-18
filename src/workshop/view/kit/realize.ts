/**
 * realize: the ONLY place in the workshop where a Mesh is created
 * (REWRITE.md § E3). Callers only ever see a Group named after the piece
 * holding objects named after its nodes, found with getObjectByName and
 * posed by setting their position / quaternion / scale.
 *
 * Two backends:
 *  - 'skinned' (rigs): the node tree becomes a BONE tree (same names, same
 *    hierarchy, same local transforms and pivots) and the piece becomes ONE
 *    SkinnedMesh per (material class, variant, texture, casts-a-shadow),
 *    every vertex bound 100% to its node's bone. Rest pose = bind pose. A
 *    40-node character draws in a handful of calls instead of one per
 *    node × material.
 *  - 'nodes' (the original): a Group per node, a Mesh per (node, material)
 *    part. Kept for debugging and as the regression reference.
 * 'auto' (the default) is 'skinned' for a piece with more than one node and
 * plain meshes (one per material, no bones) for a single-node piece.
 *
 * SHADOW PROXIES (H1). The key light's shadow pass does not draw the meshes
 * the camera sees. A realised piece gets ONE extra mesh (`shadow.proxy`; per
 * node for the 'nodes' backend): position only, merged across every material
 * that casts, skinned to the same bones for a rig, on SHADOW_LAYER, which
 * only the key's shadow camera renders. The visible meshes cast nothing. A
 * piece then costs one shadow draw instead of one per material, and its
 * shadow can leave out SMALL DETAIL: a connected lump of geometry smaller
 * than `shadowDetail` on every axis (bolts, rivets, studs, label quads lying
 * on a face) casts no shadow, and its shape is simplified by vertex clustering
 * (`shadowWeld`). It still receives a shadow, and GTAO still darkens its
 * contact. A single-node piece with one casting part (the cord, whose tube is
 * re-shaped every frame), or a rig with one casting mesh and nothing cut, casts from
 * that mesh as before. Proxies are built from the REST geometry: a piece
 * whose geometry is rewritten at run time must be a single-node, single-part
 * piece (as the cord is: it then casts for itself) or be realised with
 * `shadowProxy: false`.
 *
 * Skinned meshes get a conservative bounding sphere (the rest bounds grown by
 * half their diagonal) so a posed rig is never culled wrongly; their bounding
 * box is the exact rest box, so framing and layout match the per-node backend. Their geometry is built once
 * per Piece and shared by every realisation of it (a memoised crate realised
 * four times shares one geometry; each realisation has its own bones).
 */
import { Bone, Box3, BufferAttribute, BufferGeometry, Group, Matrix4, Mesh, Skeleton, SkinnedMesh, Sphere, Uint16BufferAttribute, Uint8BufferAttribute, Vector3 } from 'three';
import type { Material, Object3D } from 'three';
import type { Materials } from '../types.ts';
import { labelAtlasOf } from '../labels/atlas.ts';
import type { KitPart, MaterialClass, Piece, PieceNode } from './types.ts';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';
import { mergeGeometries, pieceBounds } from './compose.ts';
import { transform } from './deform.ts';

export type Backend = 'auto' | 'skinned' | 'nodes';

export interface RealizeOptions {
  /** 'auto' (default): skinned for multi-node pieces, plain meshes for single-node ones. 'nodes': a Mesh per node × material ('meshes' is an old name for it). */
  backend?: Backend | 'meshes';
  /** Cast shadows (default true). Bulbs, blended decals and parts flagged `castShadow: false` never cast. */
  castShadow?: boolean;
  receiveShadow?: boolean;
  /**
   * Cast through a merged shadow proxy (default true; see the header). False: every
   * visible mesh casts for itself, as before H1 (the A/B reference; `?shadowProxy=0`).
   */
  shadowProxy?: boolean;
  /**
   * Proxies only: a connected lump smaller than this on every axis (units) casts no
   * shadow. Default SHADOW_DETAIL (`?shadowDetail=N` on a dev page); 0 keeps everything.
   */
  shadowDetail?: number;
  /** Proxies only: the vertex-clustering cell (units); 0 leaves the proxy's shape exact. Default SHADOW_WELD. */
  shadowWeld?: number;
  /**
   * The piece stands as built, in world space, and never moves or turns (the merged static
   * set). The camera never orbits (REWRITE.md § B6: fixed pitch, pan and zoom only), so a
   * triangle that faces away from every direction a camera inside FIXED_VIEW could see it
   * from is never drawn: the visible meshes leave it out (the shadow proxy keeps it).
   * Single-node pieces only. Debug and A/B: `?fixedView=set,…` on a dev page.
   */
  fixedView?: boolean;
}

/**
 * The views FIXED_VIEW culling allows for: the camera's pitch range (degrees down) and the
 * tangents of its half field of view, vertically and horizontally (generous: an ultra-wide
 * 2.6:1 window at 22 degrees). A visible point sees the camera inside this frustum,
 * wherever the camera has panned or zoomed to.
 */
export const FIXED_VIEW = { pitch: [26, 40] as const, tanV: 0.21, tanH: 0.55, margin: 0.03 };

/** The layer shadow proxies live on; only the key light's shadow camera renders it (stage/light.ts). */
export const SHADOW_LAYER = 3;

/**
 * The default small-detail cut for shadow proxies, in units (Fetch's body is 1). Set by
 * the H1 old/new/difference pictures: below it a lump's own shadow is a few texels of the
 * 2048 map, softened away by the PCF radius and covered by GTAO's contact darkening.
 */
export const SHADOW_DETAIL = 0.045;

/**
 * The default vertex-clustering cell of shadow proxies, in units (see `cluster`): about
 * 2.5 texels of the key's 2048 shadow map at the bench, under its PCF radius.
 */
export const SHADOW_WELD = 0.016;

const NO_CAST: ReadonlySet<MaterialClass> = new Set(['bulb']);
const NO_RECEIVE: ReadonlySet<MaterialClass> = new Set(['bulb']);

function materialOf(part: KitPart, materials: Materials): Material {
  return part.texture ? materials.textured(part.material, part.texture) : materials.of(part.material, part.variant);
}

/** Whether a part casts at all: blended decals (sprayed stencils), bulbs and castShadow:false parts never do. */
function casts(part: KitPart, material: Material, o: RealizeOptions): boolean {
  // blended decals (sprayed stencils: transparent without an alpha cut) never cast a shadow;
  // they may receive one. Cut labels (alphaTest) and opaque parts cast as usual.
  const blended = material.transparent && !(material.alphaTest > 0);
  return (o.castShadow ?? true) && !NO_CAST.has(part.material) && !blended && part.castShadow !== false && part.shadow !== 'none';
}

/** `proxied`: a shadow proxy casts for this mesh, so it casts nothing itself. */
function shadows(mesh: Mesh, part: KitPart, material: Material, o: RealizeOptions, proxied: boolean): void {
  mesh.castShadow = !proxied && casts(part, material, o);
  mesh.receiveShadow = (o.receiveShadow ?? true) && !NO_RECEIVE.has(part.material);
  mesh.userData['kitMaterial'] = part.material;
}

// ---- label atlas (T1) ----------------------------------------------------------
//
// Labels sit on shared atlas pages (view/labels/atlas.ts). Their materials' maps say which
// page and where (`labelAtlasOf`). Two or more label parts of a piece (skinned) or of a node
// (per-node) that share class, variant, page, alpha and castShadow are drawn as ONE mesh: the
// part's own 0..1 uv stays in `uv`, its place on the page goes into `uv1`, and the mesh uses
// the page's whole-page material (textures on uv channel 1, no transform). One label alone
// keeps its own material and mesh, as before.

/** Where a textured part sits on the atlas: the group it merges into and its rect, or null. */
function atlasOf(part: KitPart, materials: Materials): { group: string; page: string; rect: [number, number, number, number] } | null {
  if (!part.texture) return null;
  const info = labelAtlasOf(materialOf(part, materials));
  if (!info) return null;
  return { group: `${part.material}${part.variant ? `.${part.variant}` : ''}.${info.page}${part.castShadow === false ? '.noshadow' : ''}`, page: info.page, rect: info.rect };
}

/** Write uv1 (the atlas uv) for the vertex ranges of a merged geometry, from its uv. */
function atlasUv(g: BufferGeometry, spans: ReadonlyArray<{ start: number; count: number; rect: readonly [number, number, number, number] }>): void {
  const uv = g.getAttribute('uv');
  const n = g.getAttribute('position').count;
  const out = new Float32Array(n * 2);
  for (const { start, count, rect } of spans) {
    const [u0, v0, u1, v1] = rect;
    for (let i = start; i < start + count; i++) {
      out[i * 2] = u0 + (uv ? uv.getX(i) : 0) * (u1 - u0);
      out[i * 2 + 1] = v0 + (uv ? uv.getY(i) : 0) * (v1 - v0);
    }
  }
  g.setAttribute('uv1', new BufferAttribute(out, 2));
}

/** Which label parts merge: group name per part (null: drawn as before), only for groups of two or more. */
function atlasGroups(parts: readonly KitPart[], materials: Materials): Array<ReturnType<typeof atlasOf>> {
  const at = parts.map((q) => atlasOf(q, materials));
  const n = new Map<string, number>();
  for (const a of at) if (a) n.set(a.group, (n.get(a.group) ?? 0) + 1);
  return at.map((a) => (a && n.get(a.group)! > 1 ? a : null));
}

const partName = (part: KitPart): string =>
  `${part.material}${part.variant ? `.${part.variant}` : ''}${part.texture ? `.${part.texture}` : ''}${part.castShadow === false ? '.noshadow' : ''}`;

// ---- shadow proxies -----------------------------------------------------------

interface ProxyBuild {
  /** Null when every casting lump was small detail: the piece casts nothing. */
  geometry: BufferGeometry | null;
  /** The part whose class material stands for the proxy in the shadow pass (its side; no texture). */
  rep: KitPart;
  /** Triangles before and after the small-detail cut. */
  before: number;
  after: number;
}

/** The connected lumps of a geometry: per triangle its lump, per lump its box. */
export interface Lumps {
  /** Per triangle, its lump (an index into `box`). */
  of: Int32Array;
  /** Per lump: min x, y, z, max x, y, z. */
  box: number[][];
}

/**
 * Lumps: triangles connected through shared vertices, the vertices welded by position (so a
 * box with split normals is one lump).
 */
export function lumpsOf(pos: ArrayLike<number>, index: ArrayLike<number> | null): Lumps {
  const n = pos.length / 3;
  const tris = Math.floor((index ? index.length : n) / 3);
  const q = 1e4;
  const weld = new Int32Array(n);
  const seen = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos[i * 3]! * q)},${Math.round(pos[i * 3 + 1]! * q)},${Math.round(pos[i * 3 + 2]! * q)}`;
    const w = seen.get(k);
    if (w === undefined) {
      seen.set(k, i);
      weld[i] = i;
    } else weld[i] = w;
  }
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]!]!;
      a = parent[a]!;
    }
    return a;
  };
  const vi = (t: number, c: number): number => (index ? index[t * 3 + c]! : t * 3 + c);
  for (let t = 0; t < tris; t++) {
    const a = find(weld[vi(t, 0)]!);
    for (const c of [1, 2]) {
      const b = find(weld[vi(t, c)]!);
      if (a !== b) parent[b] = a;
    }
  }
  const ids = new Map<number, number>();
  const out: Lumps = { of: new Int32Array(tris), box: [] };
  for (let t = 0; t < tris; t++) {
    const r = find(weld[vi(t, 0)]!);
    let id = ids.get(r);
    if (id === undefined) {
      id = out.box.length;
      ids.set(r, id);
      out.box.push([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
    }
    out.of[t] = id;
    const b = out.box[id]!;
    for (const c of [0, 1, 2]) {
      const i = vi(t, c);
      const x = pos[i * 3]!, y = pos[i * 3 + 1]!, z = pos[i * 3 + 2]!;
      b[0] = Math.min(b[0]!, x);
      b[1] = Math.min(b[1]!, y);
      b[2] = Math.min(b[2]!, z);
      b[3] = Math.max(b[3]!, x);
      b[4] = Math.max(b[4]!, y);
      b[5] = Math.max(b[5]!, z);
    }
  }
  return out;
}

/** Whether a lump is small detail: smaller than `detail` on every axis. */
const isSmall = (b: number[], detail: number): boolean => b[3]! - b[0]! < detail && b[4]! - b[1]! < detail && b[5]! - b[2]! < detail;

/**
 * ADAPTIVE WELDING (H1 round 2). Each lump is welded on a grid in its OWN principal frame
 * (axes from the covariance of its vertices), one cell size per axis: `frac` of the lump's
 * extent along that axis, never finer than `weld` nor coarser than `cap`; an axis along which
 * the lump is thinner than `thin` stays on `weld`. A board keeps its thickness and loses its
 * in-plane tessellation; a rod keeps its round and loses rings along its length; a bulky
 * body loses its fillets. No cell exceeds half the lump's mean wall thickness (3·volume /
 * area): a cage of bars is one lump with a big frame and thin members. Units, in the piece's
 * root space. Chosen by old/new/difference pictures (H1 round 2): {0.1, 0.25, 0.12} cuts a
 * further sixth but moves the Button guard bars' self-shadow; this does not, to the eye.
 */
export const SHADOW_ADAPT = { thin: 0.15, frac: 0.12, cap: 0.06 };

function adaptOf(): { thin: number; frac: number; cap: number } {
  // debugging and A/B only: `?shadowAdapt=thin,frac,cap` (frac 0 turns adaptation off)
  const m = /[?&]shadowAdapt=([0-9.,]+)/.exec(search());
  if (!m) return SHADOW_ADAPT;
  const [thin, frac, cap] = m[1]!.split(',').map(Number);
  return { thin: thin ?? SHADOW_ADAPT.thin, frac: frac ?? 0, cap: cap ?? SHADOW_ADAPT.cap };
}

export interface Frame3 {
  origin: [number, number, number];
  /** Three unit axes. */
  axes: [number, number, number][];
  /** Extent of the points along each axis. */
  extent: [number, number, number];
}

/** The principal frame of points (Jacobi on their covariance) and their extent along each axis. */
export function principalFrame(xyz: ArrayLike<number>, ids: readonly number[]): Frame3 {
  const n = Math.max(1, ids.length);
  let mx = 0, my = 0, mz = 0;
  for (const i of ids) {
    mx += xyz[i * 3]!;
    my += xyz[i * 3 + 1]!;
    mz += xyz[i * 3 + 2]!;
  }
  mx /= n;
  my /= n;
  mz /= n;
  const a = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const i of ids) {
    const d = [xyz[i * 3]! - mx, xyz[i * 3 + 1]! - my, xyz[i * 3 + 2]! - mz];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) a[r * 3 + c]! += d[r]! * d[c]!;
  }
  // Jacobi rotations: v's columns become the eigenvectors
  const v = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 12; sweep++) {
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]] as const) {
      const apq = a[p * 3 + q]!;
      if (Math.abs(apq) < 1e-14) continue;
      const theta = (a[q * 3 + q]! - a[p * 3 + p]!) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k * 3 + p]!, akq = a[k * 3 + q]!;
        a[k * 3 + p] = c * akp - s * akq;
        a[k * 3 + q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p * 3 + k]!, aqk = a[q * 3 + k]!;
        a[p * 3 + k] = c * apk - s * aqk;
        a[q * 3 + k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k * 3 + p]!, vkq = v[k * 3 + q]!;
        v[k * 3 + p] = c * vkp - s * vkq;
        v[k * 3 + q] = s * vkp + c * vkq;
      }
    }
  }
  const axes = [0, 1, 2].map((e) => [v[e]!, v[3 + e]!, v[6 + e]!] as [number, number, number]);
  const extent: [number, number, number] = [0, 0, 0];
  axes.forEach((ax, e) => {
    let lo = Infinity, hi = -Infinity;
    for (const i of ids) {
      const d = (xyz[i * 3]! - mx) * ax[0] + (xyz[i * 3 + 1]! - my) * ax[1] + (xyz[i * 3 + 2]! - mz) * ax[2];
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
    extent[e] = ids.length ? hi - lo : 0;
  });
  return { origin: [mx, my, mz], axes, extent };
}

/** The smallest extent of points along their principal axes. */
export function principalThickness(xyz: ArrayLike<number>, ids: readonly number[]): number {
  return Math.min(...principalFrame(xyz, ids).extent);
}

interface LumpGrid {
  frame: Frame3;
  cell: [number, number, number];
}

/** Per lump, its own welding grid (see SHADOW_ADAPT), or null where the plain `weld` grid serves. */
function lumpGrids(xyz: ArrayLike<number>, index: ArrayLike<number> | null, l: Lumps, weld: number): Array<LumpGrid | null> {
  const A = adaptOf();
  if (A.frac <= 0) return l.box.map(() => null);
  const verts: number[][] = l.box.map(() => []);
  for (let t = 0; t < l.of.length; t++) for (let c = 0; c < 3; c++) verts[l.of[t]!]!.push(index ? index[t * 3 + c]! : t * 3 + c);
  return verts.map((ids) => {
    const frame = principalFrame(xyz, ids);
    // a lump's members can be thinner than its frame says (a cage of bars is one lump): no cell
    // exceeds half its mean wall thickness, 3·volume/area (a rod's 1.5 radii; an open shell's
    // volume is unreliable and small, so it keeps the fine grid)
    let area = 0, vol = 0;
    for (let k = 0; k + 2 < ids.length; k += 3) {
      const a = ids[k]! * 3, b = ids[k + 1]! * 3, c = ids[k + 2]! * 3;
      const ux = xyz[b]! - xyz[a]!, uy = xyz[b + 1]! - xyz[a + 1]!, uz = xyz[b + 2]! - xyz[a + 2]!;
      const wx = xyz[c]! - xyz[a]!, wy = xyz[c + 1]! - xyz[a + 1]!, wz = xyz[c + 2]! - xyz[a + 2]!;
      area += Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) / 2;
      vol += (xyz[a]! * (xyz[b + 1]! * xyz[c + 2]! - xyz[b + 2]! * xyz[c + 1]!) - xyz[a + 1]! * (xyz[b]! * xyz[c + 2]! - xyz[b + 2]! * xyz[c]!) + xyz[a + 2]! * (xyz[b]! * xyz[c + 1]! - xyz[b + 1]! * xyz[c]!)) / 6;
    }
    const wall = area > 0 ? (3 * Math.abs(vol)) / area : 0;
    const most = Math.min(A.cap, Math.max(weld, wall * 0.5));
    const cell = frame.extent.map((e) => (e < A.thin ? weld : Math.min(most, Math.max(weld, e * A.frac)))) as [number, number, number];
    return cell.every((c) => c === weld) ? null : { frame, cell };
  });
}

/** A vertex's cell key: on the world grid of `weld`, or on its lump's own grid. */
function gridKey(xyz: ArrayLike<number>, i: number, bone: number, weld: number, g: LumpGrid | null, lump: number): string {
  const x = xyz[i * 3]!, y = xyz[i * 3 + 1]!, z = xyz[i * 3 + 2]!;
  if (!g) return `${bone}:${Math.floor(x / weld)},${Math.floor(y / weld)},${Math.floor(z / weld)}`;
  const o = g.frame.origin;
  const k = g.frame.axes.map((ax, e) => Math.floor(((x - o[0]) * ax[0] + (y - o[1]) * ax[1] + (z - o[2]) * ax[2]) / g.cell[e]!));
  return `${bone}#${lump}:${k.join(',')}`;
}

let lumpSerial = 0;


/** Per triangle, whether it is kept: lumps smaller than `detail` on every axis are dropped. */
export function detailMask(g: BufferGeometry, detail: number): Uint8Array {
  const pos = g.getAttribute('position');
  const l = lumpsOf(pos.array, g.index ? g.index.array : null);
  const keep = new Uint8Array(l.of.length).fill(1);
  if (detail <= 0) return keep;
  for (let t = 0; t < l.of.length; t++) if (isSmall(l.box[l.of[t]!]!, detail)) keep[t] = 0;
  return keep;
}

/**
 * Where a key light can be (the lamp is dragged about in P2): a box above the bench. Used
 * only for `fixedView` pieces (world space, never moved): a triangle that faces every point
 * of this box is drawn from its front by the light, so the shadow pass (which draws back
 * faces) never rasterises it, and the proxy leaves it out.
 */
export const KEY_REGION = { min: [-10, 2.6, -5] as const, max: [10, 8, 6] as const };

/**
 * World-space rules for `fixedView` pieces (H1 round 2), in units: a triangle wholly below
 * `below` (legs, braces, floor: their shadows fall into the room's fog) and a downward face
 * at bench level (`ground`: the underside of tape, bays, feet; its shadow is the bench under
 * itself) cast nothing.
 */
export const FIXED_SHADOW = { below: -0.3, ground: 0.03 };

interface ProxyPart {
  geometry: BufferGeometry;
  world: Matrix4 | null;
  bone: number;
  /** The part's own `shadow` mode. */
  mode?: 'hull' | 'none' | undefined;
}

function lightFacing(a: Vector3, b: Vector3, c: Vector3, n: Vector3): boolean {
  const R = KEY_REGION;
  for (let k = 0; k < 8; k++) {
    const L = [k & 1 ? R.max[0] : R.min[0], k & 2 ? R.max[1] : R.min[1], k & 4 ? R.max[2] : R.min[2]];
    for (const p of [a, b, c]) if (n.x * (L[0]! - p.x) + n.y * (L[1]! - p.y) + n.z * (L[2]! - p.z) <= 0) return false;
  }
  return true;
}

/** The convex hull of points, pulled `inset` toward their centre (never more than 2% of their size). */
function hullOf(pts: number[], bone: number, out: number[], bones: number[], inset = 0.004): void {
  if (pts.length < 12) return;
  const vs: Vector3[] = [];
  for (let i = 0; i < pts.length; i += 3) vs.push(new Vector3(pts[i], pts[i + 1], pts[i + 2]));
  const hull = new ConvexHull().setFromPoints(vs);
  const box = new Box3().setFromPoints(vs);
  const centre = box.getCenter(new Vector3());
  const pull = Math.min(inset, box.getSize(new Vector3()).length() * 0.02);
  const w = new Vector3();
  for (const face of hull.faces) {
    let e = face.edge;
    const ring: Vector3[] = [];
    do {
      ring.push(e.head().point);
      e = e.next;
    } while (e !== face.edge);
    for (let k = 1; k + 1 < ring.length; k++) {
      for (const q of [ring[0]!, ring[k]!, ring[k + 1]!]) {
        w.copy(q).sub(centre);
        const d = w.length();
        if (d > 1e-9) w.multiplyScalar((d - pull) / d);
        out.push(centre.x + w.x, centre.y + w.y, centre.z + w.z);
        bones.push(bone);
      }
    }
  }
}

/**
 * One position-only, non-indexed geometry of `parts`, each placed by its matrix (into the
 * piece's root space, where the cut and the welding are measured) and, when `skinned`,
 * bound to its bone. Small lumps are cut; parts (or merged spans) marked `shadow: 'none'`
 * are left out and those marked 'hull' cast as their hull; the rest are welded (SHADOW_ADAPT).
 * `fixed`: world space, never moved (the FIXED_SHADOW and KEY_REGION rules apply).
 */
function proxyGeometry(parts: ReadonlyArray<ProxyPart>, detail: number, weld: number, skinned: boolean, big: boolean, fixed = false): Omit<ProxyBuild, 'rep'> {
  const v = new Vector3();
  const out: number[] = [];
  const bones: number[] = [];
  const keys: string[] = [];
  const hulls: Array<{ pts: number[]; bone: number }> = [];
  const A = new Vector3(), B = new Vector3(), C = new Vector3(), N = new Vector3();
  // debugging and A/B only: `?shadowFixed=abc` picks the fixedView rules (a light-facing, b below, c ground)
  const rules = /[?&]shadowFixed=([a-z]*)/.exec(search())?.[1] ?? 'abc';
  let before = 0;
  for (const p of parts) {
    const g = p.geometry;
    const pos = g.getAttribute('position');
    const idx = g.index;
    const tris = Math.floor((idx ? idx.count : pos.count) / 3);
    before += tris;
    if (p.mode === 'none') continue;
    const placed = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      if (p.world) v.applyMatrix4(p.world);
      placed[i * 3] = v.x;
      placed[i * 3 + 1] = v.y;
      placed[i * 3 + 2] = v.z;
    }
    // per triangle, its mode: the part's own, or its merged span's
    const modeOf = new Array<'hull' | 'none' | undefined>(tris).fill(p.mode);
    const spanOf = new Int32Array(tris).fill(-1);
    const spans = (g.userData['shadowSpans'] as Array<{ start: number; count: number; mode: 'hull' | 'none' }> | undefined) ?? [];
    if (!p.mode) {
      spans.forEach((sp, k) => {
        for (let t = sp.start; t < Math.min(tris, sp.start + sp.count); t++) {
          modeOf[t] = sp.mode;
          spanOf[t] = k;
        }
      });
    }
    const hullAt = new Map<number, { pts: number[]; bone: number }>();
    const l = lumpsOf(placed, idx ? idx.array : null);
    const grids = weld > 0 ? lumpGrids(placed, idx ? idx.array : null, l, weld) : null;
    const serial = l.box.map(() => lumpSerial++);
    const order = p.world && p.world.determinant() < 0 ? [0, 2, 1] : [0, 1, 2];
    const at = (t: number, c: number): number => (idx ? idx.getX(t * 3 + order[c]!) : t * 3 + order[c]!);
    for (let t = 0; t < tris; t++) {
      const lump = l.of[t]!;
      const mode = modeOf[t];
      if (mode === 'none') continue;
      if (mode === 'hull') {
        let h = hullAt.get(spanOf[t]!);
        if (!h) hullAt.set(spanOf[t]!, (h = { pts: [], bone: p.bone }));
        for (let c = 0; c < 3; c++) {
          const i = at(t, c);
          h.pts.push(placed[i * 3]!, placed[i * 3 + 1]!, placed[i * 3 + 2]!);
        }
        continue;
      }
      if (detail > 0 && isSmall(l.box[lump]!, detail)) continue;
      if (fixed) {
        A.fromArray(placed, at(t, 0) * 3);
        B.fromArray(placed, at(t, 1) * 3);
        C.fromArray(placed, at(t, 2) * 3);
        const top = Math.max(A.y, B.y, C.y);
        if (rules.includes('b') && top < FIXED_SHADOW.below) continue;
        N.subVectors(B, A).cross(v.subVectors(C, A));
        const len = N.length();
        if (len > 1e-12) {
          N.multiplyScalar(1 / len);
          if (rules.includes('c') && N.y < -0.5 && top < FIXED_SHADOW.ground) continue;
          if (rules.includes('a') && lightFacing(A, B, C, N)) continue;
        }
      }
      for (let c = 0; c < 3; c++) {
        const i = at(t, c);
        out.push(placed[i * 3]!, placed[i * 3 + 1]!, placed[i * 3 + 2]!);
        bones.push(p.bone);
        if (grids) keys.push(gridKey(placed, i, p.bone, weld, grids[lump] ?? null, serial[lump]!));
      }
    }
    hulls.push(...hullAt.values());
  }
  const welded = weld > 0 ? clusterKeys(out, bones, keys) : { pos: out, bones };
  for (const h of hulls) hullOf(h.pts, h.bone, welded.pos, welded.bones);
  const after = welded.pos.length / 9;
  if (after === 0) return { geometry: null, before, after };
  return finish(welded.pos, welded.bones, skinned, big, before, after);
}

/**
 * Vertex clustering: every vertex moves to the mean of the vertices of its bone that share
 * its `cell`-sized grid cell; triangles that collapse, and repeats, are dropped. A shadow
 * seen through the soft PCF filter loses nothing smaller than the cell; fillets, wear bands
 * and dense lathes lose most of their triangles. (Too big a cell flattens thin rods: at
 * 0.03 the Button guard's bars lost their self-shadow; see SHADOW_WELD.)
 */
export function cluster(pos: readonly number[], bones: readonly number[], cell: number): { pos: number[]; bones: number[] } {
  const keys: string[] = [];
  for (let i = 0; i < pos.length / 3; i++) keys.push(gridKey(pos, i, bones[i]!, cell, null, 0));
  return clusterKeys(pos, bones, keys);
}

/** Vertex clustering by precomputed cell keys (see `cluster`). */
function clusterKeys(pos: readonly number[], bones: readonly number[], keyOf: readonly string[]): { pos: number[]; bones: number[] } {
  const n = pos.length / 3;
  const sum = new Map<string, [number, number, number, number]>();
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3]!, y = pos[i * 3 + 1]!, z = pos[i * 3 + 2]!;
    const k = keyOf[i]!;
    const s = sum.get(k);
    if (s) {
      s[0] += x;
      s[1] += y;
      s[2] += z;
      s[3]++;
    } else sum.set(k, [x, y, z, 1]);
  }
  const outPos: number[] = [];
  const outBones: number[] = [];
  const seen = new Set<string>();
  for (let t = 0; t < n / 3; t++) {
    const a = keyOf[t * 3]!, b = keyOf[t * 3 + 1]!, c = keyOf[t * 3 + 2]!;
    if (a === b || b === c || a === c) continue;
    // the same triangle with the same winding, whichever vertex it starts at
    const tri = a < b && a < c ? `${a}|${b}|${c}` : b < c ? `${b}|${c}|${a}` : `${c}|${a}|${b}`;
    if (seen.has(tri)) continue;
    seen.add(tri);
    for (const k of [a, b, c]) {
      const s = sum.get(k)!;
      outPos.push(s[0] / s[3], s[1] / s[3], s[2] / s[3]);
    }
    outBones.push(bones[t * 3]!, bones[t * 3 + 1]!, bones[t * 3 + 2]!);
  }
  return { pos: outPos, bones: outBones };
}

function finish(out: readonly number[], bones: readonly number[], skinned: boolean, big: boolean, before: number, after: number): Omit<ProxyBuild, 'rep'> {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(out), 3));
  if (skinned) {
    const n = bones.length;
    const si = big ? new Uint16Array(n * 4) : new Uint8Array(n * 4);
    const sw = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      si[i * 4] = bones[i]!;
      sw[i * 4] = 255;
    }
    geometry.setAttribute('skinIndex', big ? new Uint16BufferAttribute(si, 4) : new Uint8BufferAttribute(si, 4));
    geometry.setAttribute('skinWeight', new BufferAttribute(sw, 4, true));
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { geometry, before, after };
}

/** Proxies of single nodes ('nodes' backend), cached on the node's part list. */
const nodeProxyCache = new WeakMap<readonly KitPart[], Map<string, ProxyBuild>>();

function proxyMaterial(rep: KitPart, materials: Materials): Material {
  // the class's shared material, never a textured one: three derives the depth material from
  // it (its side; no map, so no alpha cut). The camera never draws the proxy.
  return materials.of(rep.material, rep.variant);
}

function asProxy<T extends Mesh>(mesh: T): T {
  mesh.name = 'shadow.proxy';
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.layers.set(SHADOW_LAYER);
  mesh.userData['shadowProxy'] = true;
  return mesh;
}

/** Whether a proxy should cast for these parts: something casts, and merging or cutting saves a draw or triangles. */
const worthIt = (casting: number, b: ProxyBuild | null): b is ProxyBuild => !!b && !(casting === 1 && b.after === b.before);

const search = (): string => (globalThis as { location?: { search?: string } }).location?.search ?? '';

function proxiesOn(o: RealizeOptions): boolean {
  return o.shadowProxy ?? !/[?&]shadowProxy=0\b/.test(search());
}

interface Detail {
  cut: number;
  weld: number;
  key: string;
}

function detailOf(o: RealizeOptions): Detail {
  // debugging and A/B only: a page URL carrying `shadowDetail=N` or `shadowWeld=N`
  const m = /[?&]shadowDetail=([0-9.]+)/.exec(search());
  const w = /[?&]shadowWeld=([0-9.]+)/.exec(search());
  const cut = o.shadowDetail ?? (m ? Number(m[1]) : SHADOW_DETAIL);
  const weld = o.shadowWeld ?? (w ? Number(w[1]) : SHADOW_WELD);
  return { cut, weld, key: `${cut}|${weld}` };
}

// ---- nodes backend ------------------------------------------------------------

const awayCache = new WeakMap<BufferGeometry, BufferGeometry>();

/** The directions (unit, toward the camera) at the corners of every view FIXED_VIEW allows. */
function viewCorners(): Vector3[] {
  const out: Vector3[] = [];
  for (const deg of FIXED_VIEW.pitch) {
    const p = (deg * Math.PI) / 180;
    const m = new Vector3(0, Math.sin(p), Math.cos(p));
    const up = new Vector3(0, Math.cos(p), -Math.sin(p));
    for (const sv of [-1, 1]) for (const sh of [-1, 1]) out.push(m.clone().addScaledVector(up, sv * FIXED_VIEW.tanV).add(new Vector3(sh * FIXED_VIEW.tanH, 0, 0)).normalize());
  }
  return out;
}

/**
 * The geometry without the triangles no allowed view can see the front of (sharing its
 * attributes; a new index). Its positions must already be in world space.
 */
export function cullAway(g: BufferGeometry): BufferGeometry {
  const hit = awayCache.get(g);
  if (hit) return hit;
  const pos = g.getAttribute('position');
  const idx = g.index;
  const tris = Math.floor((idx ? idx.count : pos.count) / 3);
  const corners = viewCorners();
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  const keep: number[] = [];
  for (let t = 0; t < tris; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1).sub(a);
    c.fromBufferAttribute(pos, i2).sub(a);
    const n = b.cross(c);
    const len = n.length();
    // degenerate: keep (it draws nothing either way)
    if (len < 1e-12 || corners.some((d) => n.dot(d) / len > -FIXED_VIEW.margin)) keep.push(i0, i1, i2);
  }
  let out = g;
  if (keep.length < tris * 3) {
    out = new BufferGeometry();
    for (const [k, v] of Object.entries(g.attributes)) out.setAttribute(k, v);
    out.setIndex(keep);
    out.userData = { ...g.userData };
    out.computeBoundingBox();
    out.computeBoundingSphere();
  }
  awayCache.set(g, out);
  return out;
}

function meshOf(node: PieceNode, part: KitPart, materials: Materials, o: RealizeOptions, proxied: boolean): Mesh {
  const material = materialOf(part, materials);
  // culled only where a proxy casts for it: a mesh that casts for itself needs its back faces
  const mesh = new Mesh(o.fixedView && proxied ? cullAway(part.geometry) : part.geometry, material);
  mesh.name = `${node.name}.${partName(part)}`;
  shadows(mesh, part, material, o, proxied);
  return mesh;
}

function nodeProxy(node: PieceNode, materials: Materials, o: RealizeOptions): ProxyBuild | null {
  if (!proxiesOn(o)) return null;
  const casting = node.parts.filter((q) => casts(q, materialOf(q, materials), o));
  if (casting.length === 0) return null;
  const detail = detailOf(o);
  let byDetail = nodeProxyCache.get(node.parts);
  if (!byDetail) nodeProxyCache.set(node.parts, (byDetail = new Map()));
  const cacheKey = `${detail.key}|${o.fixedView ? 1 : 0}`;
  let built = byDetail.get(cacheKey);
  if (!built) {
    built = { ...proxyGeometry(casting.map((q) => ({ geometry: q.geometry, world: null, bone: 0, mode: q.shadow })), detail.cut, detail.weld, false, false, !!o.fixedView), rep: casting[0]! };
    byDetail.set(cacheKey, built);
  }
  // a single mesh casts for itself: its geometry may be rewritten at run time (the cord's tube)
  return casting.length > 1 ? built : null;
}

/** A node's label parts merged per atlas group (cached per node and materials). */
const nodeAtlasCache = new WeakMap<readonly KitPart[], { materials: Materials; merged: Array<{ part: KitPart; geometry: BufferGeometry }>; rest: KitPart[] }>();

function nodeAtlas(node: PieceNode, materials: Materials): { merged: Array<{ part: KitPart; geometry: BufferGeometry }>; rest: KitPart[] } {
  const hit = nodeAtlasCache.get(node.parts);
  if (hit && hit.materials === materials) return hit;
  const groups = atlasGroups(node.parts, materials);
  const byGroup = new Map<string, { page: string; parts: KitPart[]; rects: Array<[number, number, number, number]> }>();
  const rest: KitPart[] = [];
  node.parts.forEach((q, i) => {
    const a = groups[i];
    if (!a) {
      rest.push(q);
      return;
    }
    let b = byGroup.get(a.group);
    if (!b) byGroup.set(a.group, (b = { page: a.page, parts: [], rects: [] }));
    b.parts.push(q);
    b.rects.push(a.rect);
  });
  const merged = [...byGroup.values()].map(({ page, parts, rects }) => {
    const geometry = mergeGeometries(parts.map((q) => q.geometry));
    let v = 0;
    const spans = parts.map((q, k) => {
      const count = q.geometry.getAttribute('position').count;
      const sp = { start: v, count, rect: rects[k]!, source: q.geometry, texture: q.texture };
      v += count;
      return sp;
    });
    atlasUv(geometry, spans);
    geometry.userData['kitSources'] = spans.map((sp) => ({ source: sp.source, node: node.name, start: sp.start, count: sp.count, texture: sp.texture }));
    return { part: { ...parts[0]!, texture: page }, geometry };
  });
  const out = { materials, merged, rest };
  nodeAtlasCache.set(node.parts, out);
  return out;
}

function nodeOf(node: PieceNode, materials: Materials, o: RealizeOptions): Group {
  const g = new Group();
  g.name = node.name;
  if (node.transform) node.transform.decompose(g.position, g.quaternion, g.scale);
  const proxy = nodeProxy(node, materials, o);
  const at = nodeAtlas(node, materials);
  for (const part of at.rest) g.add(meshOf(node, part, materials, o, !!proxy));
  for (const m of at.merged) g.add(meshOf(node, { ...m.part, geometry: m.geometry }, materials, o, !!proxy));
  for (const c of node.children ?? []) g.add(nodeOf(c, materials, o));
  // last, so a builder that takes "the mesh" of a single-part node still finds its own
  if (proxy?.geometry) g.add(asProxy(new Mesh(proxy.geometry, proxyMaterial(proxy.rep, materials))));
  return g;
}

// ---- skinned backend ----------------------------------------------------------

interface SkinGroup {
  /** A representative part (material, variant, texture, castShadow). */
  part: KitPart;
  geometry: BufferGeometry;
}

interface SkinBuild {
  /** The node transforms it was built from (rebuilt if a piece's nodes were re-posed in place). */
  stamp: string;
  /** The materials it was grouped for (label parts merge by the atlas page their material names). */
  materials: Materials;
  groups: SkinGroup[];
  sphere: Sphere;
  box: Box3;
  /** Shadow proxies by detail cut, built on first use. */
  proxies: Map<string, ProxyBuild | null>;
}

const skinCache = new WeakMap<Piece, SkinBuild>();

/** Where one part's geometry went inside a skinned mesh's merged geometry (its vertices, in order). */
export interface SkinSource {
  /** The part's own geometry (the Piece's), as a builder registered it. */
  source: BufferGeometry;
  /** The node (bone) it is bound to. */
  node: string;
  /** First vertex and vertex count in the merged geometry. */
  start: number;
  count: number;
  /** The label key the part was textured with (merged atlas meshes: the mesh's own name names the page). */
  texture?: string | undefined;
}

/**
 * The parts inside a realised mesh: for a skinned mesh, where each source part's vertices
 * sit in the merged geometry; for a per-node mesh, the one part it draws. A builder that
 * edits a part after realize (repainting a crate) finds its vertices with this.
 */
export function sourcesOf(mesh: Mesh): SkinSource[] {
  const s = mesh.geometry.userData['kitSources'] as SkinSource[] | undefined;
  if (s) return s;
  return [{ source: mesh.geometry, node: mesh.parent?.name ?? '', start: 0, count: mesh.geometry.getAttribute('position').count }];
}

/** Every node in depth-first order, with its rest world matrix (in the piece's root space). */
function nodesOf(piece: Piece): Array<{ node: PieceNode; parent: number; world: Matrix4 }> {
  const out: Array<{ node: PieceNode; parent: number; world: Matrix4 }> = [];
  const walk = (n: PieceNode, parent: number, pw: Matrix4): void => {
    const world = pw.clone().multiply(n.transform ?? new Matrix4());
    const me = out.length;
    out.push({ node: n, parent, world });
    for (const c of n.children ?? []) walk(c, me, world);
  };
  walk(piece.root, -1, new Matrix4());
  return out;
}

/** The merged, bone-bound geometries of a piece (built once per Piece). */
function skinBuild(piece: Piece, materials: Materials): SkinBuild {
  const nodes = nodesOf(piece);
  const stamp = nodes.map(({ world }) => world.elements.map((e) => e.toFixed(6)).join(',')).join(';');
  const cached = skinCache.get(piece);
  if (cached && cached.stamp === stamp && cached.materials === materials) return cached;
  const order: string[] = [];
  const byKey = new Map<string, { part: KitPart; geoms: BufferGeometry[]; bones: number[]; sources: BufferGeometry[]; rects: Array<[number, number, number, number] | null>; textures: Array<string | undefined> }>();
  const groups = atlasGroups(
    nodes.flatMap(({ node }) => node.parts),
    materials,
  );
  let pi = 0;
  nodes.forEach(({ node, world }, bone) => {
    for (const part of node.parts) {
      const a = groups[pi++];
      const key = a ? a.group : partName(part);
      let g = byKey.get(key);
      if (!g) {
        g = { part: a ? { ...part, texture: a.page } : part, geoms: [], bones: [], sources: [], rects: [], textures: [] };
        byKey.set(key, g);
        order.push(key);
      }
      g.rects.push(a ? a.rect : null);
      g.textures.push(part.texture);
      // into the piece's root space at rest (the bind pose); lpos, surf, colour, uv ride along unchanged
      const copy = part.geometry.clone();
      copy.userData = { ...part.geometry.userData }; // its own (clone shares the object)
      g.geoms.push(transform(copy, world));
      g.bones.push(bone);
      g.sources.push(part.geometry);
    }
  });
  const big = nodes.length > 255;
  const skinGroups: SkinGroup[] = order.map((key) => {
    const g = byKey.get(key)!;
    const geometry = g.geoms.length === 1 ? g.geoms[0]! : mergeGeometries(g.geoms);
    const n = geometry.getAttribute('position').count;
    // every vertex 100% on its node's bone: four slots as three expects, weights as normalised bytes
    const idx = big ? new Uint16Array(n * 4) : new Uint8Array(n * 4);
    const wgt = new Uint8Array(n * 4);
    let v = 0;
    const sources: SkinSource[] = [];
    const spans: Array<{ start: number; count: number; rect: [number, number, number, number] }> = [];
    g.geoms.forEach((gg, k) => {
      const c = gg.getAttribute('position').count;
      sources.push({ source: g.sources[k]!, node: nodes[g.bones[k]!]!.node.name, start: v, count: c, texture: g.textures[k] });
      const rect = g.rects[k];
      if (rect) spans.push({ start: v, count: c, rect });
      for (let i = 0; i < c; i++, v++) {
        idx[v * 4] = g.bones[k]!;
        wgt[v * 4] = 255;
      }
    });
    if (spans.length) atlasUv(geometry, spans);
    geometry.setAttribute('skinIndex', big ? new Uint16BufferAttribute(idx, 4) : new Uint8BufferAttribute(idx, 4));
    geometry.setAttribute('skinWeight', new BufferAttribute(wgt, 4, true));
    geometry.userData['kitSources'] = sources;
    return { part: g.part, geometry };
  });
  // conservative culling volume: the rest bounds grown by half their diagonal, so any
  // reasonable pose (a hatch swung open, an arm reaching) stays inside it
  const b = pieceBounds(piece);
  const centre = b.getCenter(new Vector3());
  const half = b.getSize(new Vector3()).length() / 2;
  const reach = half * 0.5 + 0.1;
  const sphere = new Sphere(centre, half + reach);
  // the box stays the exact rest bounds: Box3.setFromObject (framing, layout) reads it, and must
  // agree with the per-node backend at rest; culling reads the (conservative) sphere
  const box = b.clone();
  const built: SkinBuild = { stamp, materials, groups: skinGroups, sphere, box, proxies: new Map() };
  skinCache.set(piece, built);
  return built;
}

/** The skinned shadow proxy of a piece: every casting part, bound to its bone (cached per Piece and cut). */
function skinProxy(piece: Piece, built: SkinBuild, castsPart: (q: KitPart) => boolean, detail: Detail): ProxyBuild | null {
  const key = detail.key;
  if (built.proxies.has(key)) return built.proxies.get(key)!;
  const nodes = nodesOf(piece);
  const parts: ProxyPart[] = [];
  let rep: KitPart | null = null;
  nodes.forEach(({ node, world }, bone) => {
    for (const q of node.parts) {
      if (!castsPart(q)) continue;
      rep ??= q;
      parts.push({ geometry: q.geometry, world, bone, mode: q.shadow });
    }
  });
  const out = rep ? { ...proxyGeometry(parts, detail.cut, detail.weld, true, nodes.length > 255), rep } : null;
  built.proxies.set(key, out);
  return out;
}

function realizeSkinned(piece: Piece, materials: Materials, o: RealizeOptions, top: Group): void {
  const nodes = nodesOf(piece);
  const bones: Bone[] = nodes.map(({ node }) => {
    const b = new Bone();
    b.name = node.name;
    if (node.transform) node.transform.decompose(b.position, b.quaternion, b.scale);
    return b;
  });
  nodes.forEach(({ parent }, i) => {
    if (parent >= 0) bones[parent]!.add(bones[i]!);
  });
  top.add(bones[0]!);
  top.updateMatrixWorld(true);
  const skeleton = new Skeleton(bones);
  const built = skinBuild(piece, materials);
  const castsPart = (q: KitPart): boolean => casts(q, materialOf(q, materials), o);
  const casting = built.groups.filter((g) => castsPart(g.part)).length;
  const proxy = proxiesOn(o) && casting > 0 ? skinProxy(piece, built, castsPart, detailOf(o)) : null;
  const useProxy = worthIt(casting, proxy);
  const bind = (mesh: SkinnedMesh): void => {
    mesh.boundingSphere = built.sphere.clone();
    mesh.boundingBox = built.box.clone();
    top.add(mesh);
    mesh.updateMatrixWorld(true);
    mesh.bind(skeleton);
  };
  for (const g of built.groups) {
    const material = materialOf(g.part, materials);
    const mesh = new SkinnedMesh(g.geometry, material);
    mesh.name = `skin.${partName(g.part)}`;
    shadows(mesh, g.part, material, o, useProxy);
    bind(mesh);
  }
  if (useProxy && proxy.geometry) bind(asProxy(new SkinnedMesh(proxy.geometry, proxyMaterial(proxy.rep, materials))));
  top.userData['kitBackend'] = 'skinned';
}

/**
 * Debugging and A/B only: a page URL carrying `kitBackend=nodes|skinned|auto` picks the
 * default backend for every realize on that page that does not name one (so any page, the
 * catalogue or the stage, can be compared without code changes). Never used by the site.
 */
function debugBackend(): Backend | undefined {
  const m = /[?&]kitBackend=(nodes|skinned|auto)\b/.exec(search());
  return m ? (m[1] as Backend) : undefined;
}

/** Turn a Piece into Three.js objects: a Group named after the piece, holding its node tree (Groups, or Bones for a skinned rig). */
export function realize(piece: Piece, materials: Materials, o: RealizeOptions = {}): Object3D {
  const top = new Group();
  top.name = piece.name;
  top.userData['kitPiece'] = piece.name;
  const backend = o.backend ?? debugBackend() ?? 'auto';
  const multi = (piece.root.children?.length ?? 0) > 0;
  const fixed = o.fixedView ?? new RegExp(`[?&]fixedView=([^&]*,)?${piece.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(,|&|$)`).test(search());
  if (fixed && !multi) o = { ...o, fixedView: true };
  else if (o.fixedView) o = { ...o, fixedView: false };
  if (backend === 'skinned' || (backend === 'auto' && multi)) {
    realizeSkinned(piece, materials, o, top);
    return top;
  }
  top.userData['kitBackend'] = 'nodes';
  top.add(nodeOf(piece.root, materials, o));
  return top;
}

/**
 * How a realised piece draws: meshes the camera draws, how many draws the shadow pass
 * makes (casting meshes and shadow proxies), and the calls that makes (culling aside).
 */
export function drawStats(object: Object3D): { meshes: number; casting: number; calls: number } {
  let meshes = 0, casting = 0;
  object.traverse((x) => {
    if ((x as Mesh).isMesh) {
      if (!x.userData['shadowProxy']) meshes++;
      if ((x as Mesh).castShadow) casting++;
    }
  });
  return { meshes, casting, calls: meshes + casting };
}

/** Triangles a realised piece sends to the shadow pass (casting meshes and proxies; culling aside). */
export function shadowTriangles(object: Object3D): number {
  let n = 0;
  object.traverse((x) => {
    const m = x as Mesh;
    if (!m.isMesh || !m.castShadow) return;
    const g = m.geometry;
    n += Math.floor((g.index ? g.index.count : g.getAttribute('position').count) / 3);
  });
  return n;
}
