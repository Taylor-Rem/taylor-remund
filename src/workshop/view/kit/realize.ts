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
import type { KitPart, MaterialClass, Piece, PieceNode } from './types.ts';
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
}

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
  return (o.castShadow ?? true) && !NO_CAST.has(part.material) && !blended && part.castShadow !== false;
}

/** `proxied`: a shadow proxy casts for this mesh, so it casts nothing itself. */
function shadows(mesh: Mesh, part: KitPart, material: Material, o: RealizeOptions, proxied: boolean): void {
  mesh.castShadow = !proxied && casts(part, material, o);
  mesh.receiveShadow = (o.receiveShadow ?? true) && !NO_RECEIVE.has(part.material);
  mesh.userData['kitMaterial'] = part.material;
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
 * One position-only, non-indexed geometry of `parts`, each placed by its matrix (into the
 * piece's root space, where the cut and the welding are measured) and, when `skinned`,
 * bound to its bone. Small lumps are cut; the rest are welded on a `weld` grid.
 */
function proxyGeometry(parts: ReadonlyArray<{ geometry: BufferGeometry; world: Matrix4 | null; bone: number }>, detail: number, weld: number, skinned: boolean, big: boolean): Omit<ProxyBuild, 'rep'> {
  const v = new Vector3();
  const out: number[] = [];
  const bones: number[] = [];
  let before = 0;
  for (const p of parts) {
    const g = p.geometry;
    const pos = g.getAttribute('position');
    const idx = g.index;
    const tris = Math.floor((idx ? idx.count : pos.count) / 3);
    before += tris;
    const placed = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      if (p.world) v.applyMatrix4(p.world);
      placed[i * 3] = v.x;
      placed[i * 3 + 1] = v.y;
      placed[i * 3 + 2] = v.z;
    }
    const l = lumpsOf(placed, idx ? idx.array : null);
    const order = p.world && p.world.determinant() < 0 ? [0, 2, 1] : [0, 1, 2];
    for (let t = 0; t < tris; t++) {
      if (detail > 0 && isSmall(l.box[l.of[t]!]!, detail)) continue;
      for (const c of order) {
        const i = idx ? idx.getX(t * 3 + c) : t * 3 + c;
        out.push(placed[i * 3]!, placed[i * 3 + 1]!, placed[i * 3 + 2]!);
        bones.push(p.bone);
      }
    }
  }
  const welded = weld > 0 ? cluster(out, bones, weld) : { pos: out, bones };
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
  const n = pos.length / 3;
  const keyOf: string[] = new Array<string>(n);
  const sum = new Map<string, [number, number, number, number]>();
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3]!, y = pos[i * 3 + 1]!, z = pos[i * 3 + 2]!;
    const k = `${bones[i]}:${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
    keyOf[i] = k;
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

function meshOf(node: PieceNode, part: KitPart, materials: Materials, o: RealizeOptions, proxied: boolean): Mesh {
  const material = materialOf(part, materials);
  const mesh = new Mesh(part.geometry, material);
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
  let built = byDetail.get(detail.key);
  if (!built) {
    built = { ...proxyGeometry(casting.map((q) => ({ geometry: q.geometry, world: null, bone: 0 })), detail.cut, detail.weld, false, false), rep: casting[0]! };
    byDetail.set(detail.key, built);
  }
  // a single mesh casts for itself: its geometry may be rewritten at run time (the cord's tube)
  return casting.length > 1 ? built : null;
}

function nodeOf(node: PieceNode, materials: Materials, o: RealizeOptions): Group {
  const g = new Group();
  g.name = node.name;
  if (node.transform) node.transform.decompose(g.position, g.quaternion, g.scale);
  const proxy = nodeProxy(node, materials, o);
  for (const part of node.parts) g.add(meshOf(node, part, materials, o, !!proxy));
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
function skinBuild(piece: Piece): SkinBuild {
  const nodes = nodesOf(piece);
  const stamp = nodes.map(({ world }) => world.elements.map((e) => e.toFixed(6)).join(',')).join(';');
  const cached = skinCache.get(piece);
  if (cached && cached.stamp === stamp) return cached;
  const order: string[] = [];
  const byKey = new Map<string, { part: KitPart; geoms: BufferGeometry[]; bones: number[]; sources: BufferGeometry[] }>();
  nodes.forEach(({ node, world }, bone) => {
    for (const part of node.parts) {
      const key = partName(part);
      let g = byKey.get(key);
      if (!g) {
        g = { part, geoms: [], bones: [], sources: [] };
        byKey.set(key, g);
        order.push(key);
      }
      // into the piece's root space at rest (the bind pose); lpos, surf, colour, uv ride along unchanged
      const copy = part.geometry.clone();
      copy.userData = { ...part.geometry.userData }; // its own (clone shares the object)
      g.geoms.push(transform(copy, world));
      g.bones.push(bone);
      g.sources.push(part.geometry);
    }
  });
  const big = nodes.length > 255;
  const groups: SkinGroup[] = order.map((key) => {
    const g = byKey.get(key)!;
    const geometry = g.geoms.length === 1 ? g.geoms[0]! : mergeGeometries(g.geoms);
    const n = geometry.getAttribute('position').count;
    // every vertex 100% on its node's bone: four slots as three expects, weights as normalised bytes
    const idx = big ? new Uint16Array(n * 4) : new Uint8Array(n * 4);
    const wgt = new Uint8Array(n * 4);
    let v = 0;
    const sources: SkinSource[] = [];
    g.geoms.forEach((gg, k) => {
      const c = gg.getAttribute('position').count;
      sources.push({ source: g.sources[k]!, node: nodes[g.bones[k]!]!.node.name, start: v, count: c });
      for (let i = 0; i < c; i++, v++) {
        idx[v * 4] = g.bones[k]!;
        wgt[v * 4] = 255;
      }
    });
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
  const built: SkinBuild = { stamp, groups, sphere, box, proxies: new Map() };
  skinCache.set(piece, built);
  return built;
}

/** The skinned shadow proxy of a piece: every casting part, bound to its bone (cached per Piece and cut). */
function skinProxy(piece: Piece, built: SkinBuild, castsPart: (q: KitPart) => boolean, detail: Detail): ProxyBuild | null {
  const key = detail.key;
  if (built.proxies.has(key)) return built.proxies.get(key)!;
  const nodes = nodesOf(piece);
  const parts: Array<{ geometry: BufferGeometry; world: Matrix4; bone: number }> = [];
  let rep: KitPart | null = null;
  nodes.forEach(({ node, world }, bone) => {
    for (const q of node.parts) {
      if (!castsPart(q)) continue;
      rep ??= q;
      parts.push({ geometry: q.geometry, world, bone });
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
  const built = skinBuild(piece);
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
