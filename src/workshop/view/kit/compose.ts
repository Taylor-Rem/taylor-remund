/**
 * Composition: parts, placing, arraying, mirroring, merging by material,
 * and the Piece builder (named nodes for what moves, sockets, triangle
 * count, size, and the ambient-occlusion cavity bake).
 */
import { Box3, BufferAttribute, BufferGeometry, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { Token } from '../palette.ts';
import type { KitPart, MaterialClass, MaterialVariant, Piece, PieceNode } from './types.ts';
import { ATTR } from './types.ts';
import { tint } from './surface.ts';
import { bakePiece } from './bake.ts';
import type { AoOptions, TintOptions } from './surface.ts';
import { transform } from './deform.ts';
import { offsetLpos } from './space.ts';
import { hash2, rng } from './rng.ts';

/** Range of the per-part lpos offset (units). Materials' procedural detail must not repeat within it. */
export const LPOS_OFFSET = 64;

function nameSeed(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return h >>> 0;
}
import { triangleCount } from './mesh.ts';
import type { V3 } from './loft.ts';

export type PartsLike = KitPart | ReadonlyArray<PartsLike>;

/** Flatten nested part lists. */
export function flat(p: PartsLike): KitPart[] {
  if (Array.isArray(p)) return (p as ReadonlyArray<PartsLike>).flatMap(flat);
  return [p as KitPart];
}

/** A part: a geometry of one material, tinted with a palette token. */
export function part(material: MaterialClass, geometry: BufferGeometry, token?: Token, t?: TintOptions): KitPart {
  if (token) tint(geometry, token, t);
  return { material, geometry };
}

/** A textured part (label tape, card, plate): `texture` is a key made by view/labels. */
export function texturedPart(material: MaterialClass, geometry: BufferGeometry, texture: string): KitPart {
  return { material, geometry, texture };
}

/** Mark parts as a class's `variant` (e.g. 'large', the cheaper cut for surfaces that fill the screen). In place; returns them. */
export function withVariant(p: PartsLike, variant: MaterialVariant): KitPart[] {
  const list = flat(p);
  for (const q of list) q.variant = variant;
  return list;
}

/** Leave parts out of the shadow pass (tiny parts whose shadow nobody sees). In place; returns them. */
export function noShadow(p: PartsLike): KitPart[] {
  const list = flat(p);
  for (const q of list) q.castShadow = false;
  return list;
}

/**
 * A whole built piece casting in one way through its shadow proxy (kit/realize.ts): 'none'
 * (the bench's frame and the floor, whose shadows fall where nobody sees) or 'hull'. A new
 * Piece over new part records; the geometry is shared.
 */
export function withShadow(p: Piece, mode: 'hull' | 'none'): Piece {
  const node = (n: PieceNode): PieceNode => ({ ...n, parts: n.parts.map((q) => ({ ...q, shadow: mode })), ...(n.children ? { children: n.children.map(node) } : {}) });
  return { ...p, root: node(p.root) };
}

/** Shorthand: the 'large' variant (the bench top, the back wall). */
export const large = (p: PartsLike): KitPart[] => withVariant(p, 'large');

/** Recolour parts with a token (in place). */
export function paint(p: PartsLike, token: Token, t?: TintOptions): KitPart[] {
  const list = flat(p);
  for (const q of list) tint(q.geometry, token, t);
  return list;
}

// ---- matrices ------------------------------------------------------------------

const DEG = Math.PI / 180;

export interface Placement {
  at?: V3;
  /** Euler rotation in DEGREES (XYZ order). */
  rot?: V3;
  scale?: number | V3;
}

/** A transform matrix from position, rotation in degrees, and scale. */
export function mat(p: Placement = {}): Matrix4 {
  const s = p.scale === undefined ? [1, 1, 1] : typeof p.scale === 'number' ? [p.scale, p.scale, p.scale] : p.scale;
  const r = p.rot ?? [0, 0, 0];
  const q = new Quaternion().setFromEuler(new Euler(r[0] * DEG, r[1] * DEG, r[2] * DEG));
  const a = p.at ?? [0, 0, 0];
  return new Matrix4().compose(new Vector3(a[0], a[1], a[2]), q, new Vector3(s[0], s[1], s[2]));
}

/** Shorthand: translate. */
export const T = (x: number, y: number, z: number): Matrix4 => new Matrix4().makeTranslation(x, y, z);
/** Shorthand: rotation in degrees about X, Y, Z (applied X then Y then Z). */
export const Rdeg = (x: number, y: number, z: number): Matrix4 => mat({ rot: [x, y, z] });

/** Matrix product left-to-right as written: chain(A, B, C) = A·B·C (C applies first). */
export function chain(...ms: Matrix4[]): Matrix4 {
  const out = new Matrix4();
  for (const m of ms) out.multiply(m);
  return out;
}

/**
 * Orientation that turns the kit's +Y (the axis every lathe and solid is
 * built along) to point along `dir`, then moves it to `at`.
 */
export function aim(at: V3, dir: V3, spin = 0): Matrix4 {
  const d = new Vector3(dir[0], dir[1], dir[2]).normalize();
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), d);
  const qs = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), spin * DEG);
  return new Matrix4().compose(new Vector3(at[0], at[1], at[2]), q.multiply(qs), new Vector3(1, 1, 1));
}

/** Place a copy of the parts under a transform (geometry is cloned). */
export function place(p: PartsLike, m: Matrix4 | Placement): KitPart[] {
  const M = m instanceof Matrix4 ? m : mat(m);
  return flat(p).map((q) => {
    const g = transform(q.geometry.clone(), M);
    return { ...q, geometry: g };
  });
}

/** Transform parts in place (no copy). */
export function apply(p: PartsLike, m: Matrix4 | Placement): KitPart[] {
  const M = m instanceof Matrix4 ? m : mat(m);
  const list = flat(p);
  for (const q of list) transform(q.geometry, M);
  return list;
}

/** `count` copies, the i-th placed by `step(i)` (a matrix) or offset by i × step (a vector). */
export function array(p: PartsLike, count: number, step: V3 | ((i: number) => Matrix4 | Placement)): KitPart[] {
  const out: KitPart[] = [];
  for (let i = 0; i < count; i++) {
    const m = typeof step === 'function' ? step(i) : T(step[0] * i, step[1] * i, step[2] * i);
    out.push(...place(p, m));
  }
  return out;
}

/** A mirrored copy across the plane through the origin normal to `axis` (winding corrected). */
export function mirror(p: PartsLike, axis: 'x' | 'y' | 'z'): KitPart[] {
  const s: V3 = [axis === 'x' ? -1 : 1, axis === 'y' ? -1 : 1, axis === 'z' ? -1 : 1];
  return place(p, new Matrix4().makeScale(s[0], s[1], s[2]));
}

/**
 * `count` copies evenly along the segment a→b (inset from both ends by
 * `inset`), each oriented by `orient` (an extra matrix applied before the
 * move, e.g. aiming a bolt along a surface normal). Seeded `jitter` (in
 * radians about the part's own Y) makes a row look hand-set.
 */
export function alongEdge(p: PartsLike, a: V3, b: V3, count: number, opts: { inset?: number; orient?: Matrix4; spin?: (i: number) => number } = {}): KitPart[] {
  const A = new Vector3(...a), B = new Vector3(...b);
  const L = A.distanceTo(B);
  const inset = opts.inset ?? 0;
  const out: KitPart[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const d = inset + (L - 2 * inset) * t;
    const P = A.clone().lerp(B, L > 0 ? d / L : 0);
    const spin = opts.spin ? new Matrix4().makeRotationY(opts.spin(i)) : new Matrix4();
    const m = T(P.x, P.y, P.z).multiply(opts.orient ?? new Matrix4()).multiply(spin);
    out.push(...place(p, m));
  }
  return out;
}

/** `count` copies round a circle of `radius` in the XZ plane (or in a plane given by `frame`). */
export function ring(p: PartsLike, radius: number, count: number, opts: { phase?: number; frame?: Matrix4; spin?: (i: number) => number } = {}): KitPart[] {
  const out: KitPart[] = [];
  for (let i = 0; i < count; i++) {
    const a = (opts.phase ?? 0) + (i / count) * Math.PI * 2;
    const spin = opts.spin ? opts.spin(i) : 0;
    const m = (opts.frame ?? new Matrix4()).clone().multiply(T(Math.cos(a) * radius, 0, Math.sin(a) * radius)).multiply(new Matrix4().makeRotationY(-a + spin));
    out.push(...place(p, m));
  }
  return out;
}

/** An nx × nz grid of copies in the XZ plane, centred, spaced dx/dz. */
export function grid(p: PartsLike, nx: number, nz: number, dx: number, dz: number, frame?: Matrix4): KitPart[] {
  const out: KitPart[] = [];
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) {
      const m = (frame ?? new Matrix4()).clone().multiply(T((i - (nx - 1) / 2) * dx, 0, (j - (nz - 1) / 2) * dz));
      out.push(...place(p, m));
    }
  return out;
}

// ---- merging -------------------------------------------------------------------

/** Concatenate geometries (indexed or not) into one indexed geometry, keeping position, normal, color, surf, lpos and uv. */
export function mergeGeometries(geoms: readonly BufferGeometry[]): BufferGeometry {
  let nv = 0;
  let ni = 0;
  let anyUv = false;
  for (const g of geoms) {
    const c = g.getAttribute('position').count;
    nv += c;
    ni += g.index ? g.index.count : c;
    if (g.getAttribute('uv')) anyUv = true;
  }
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), col = new Float32Array(nv * 3), surf = new Float32Array(nv * 3), lpos = new Float32Array(nv * 3);
  const uv = anyUv ? new Float32Array(nv * 2) : null;
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0;
  for (const g of geoms) {
    const c = g.getAttribute('position').count;
    pos.set(g.getAttribute('position').array as Float32Array, vo * 3);
    const n = g.getAttribute('normal');
    if (n) nrm.set(n.array as Float32Array, vo * 3);
    const cl = g.getAttribute(ATTR.color);
    if (cl) col.set(cl.array as Float32Array, vo * 3);
    else col.fill(1, vo * 3, (vo + c) * 3);
    const s = g.getAttribute(ATTR.surf);
    if (s && s.itemSize === 3) surf.set(s.array as Float32Array, vo * 3);
    else if (s) for (let i = 0; i < c; i++) { surf[(vo + i) * 3] = s.getX(i); surf[(vo + i) * 3 + 1] = s.getY(i); }
    const l = g.getAttribute(ATTR.lpos);
    lpos.set((l ?? g.getAttribute('position')).array as Float32Array, vo * 3);
    const u = g.getAttribute('uv');
    if (uv && u) uv.set(u.array as Float32Array, vo * 2);
    if (g.index) {
      const a = g.index.array;
      for (let i = 0; i < a.length; i++) idx[io + i] = a[i]! + vo;
      io += a.length;
    } else {
      for (let i = 0; i < c; i++) idx[io + i] = vo + i;
      io += c;
    }
    vo += c;
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(pos, 3));
  out.setAttribute('normal', new BufferAttribute(nrm, 3));
  out.setAttribute(ATTR.color, new BufferAttribute(col, 3));
  out.setAttribute(ATTR.surf, new BufferAttribute(surf, 3));
  out.setAttribute(ATTR.lpos, new BufferAttribute(lpos, 3));
  if (uv) out.setAttribute('uv', new BufferAttribute(uv, 2));
  out.setIndex(new BufferAttribute(idx, 1));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/** Merge parts into one part per (material, variant, texture). Order of first appearance is kept. */
export function merge(p: PartsLike): KitPart[] {
  const groups = new Map<string, { material: MaterialClass; variant?: MaterialVariant | undefined; texture?: string | undefined; noCast: boolean; geoms: BufferGeometry[]; modes: Array<'hull' | 'none' | undefined> }>();
  for (const q of flat(p)) {
    const key = `${q.material}|${q.variant ?? ''}|${q.texture ?? ''}${q.castShadow === false ? '|nocast' : ''}`;
    let g = groups.get(key);
    if (!g) {
      g = { material: q.material, variant: q.variant, texture: q.texture, noCast: q.castShadow === false, geoms: [], modes: [] };
      groups.set(key, g);
    }
    g.geoms.push(q.geometry);
    g.modes.push(q.shadow);
  }
  return [...groups.values()].map((g) => {
    const geometry = g.geoms.length === 1 ? g.geoms[0]! : mergeGeometries(g.geoms);
    // where parts that cast in their own way went (kit/realize.ts reads it for the shadow proxy)
    const spans: Array<{ start: number; count: number; mode: 'hull' | 'none' }> = [];
    let tri = 0;
    g.geoms.forEach((gg, k) => {
      const n = Math.floor((gg.index ? gg.index.count : gg.getAttribute('position').count) / 3);
      const mode = g.modes[k];
      if (mode) spans.push({ start: tri, count: n, mode });
      for (const s of (gg.userData['shadowSpans'] as typeof spans | undefined) ?? []) if (!mode) spans.push({ ...s, start: s.start + tri });
      tri += n;
    });
    if (spans.length) geometry.userData = { ...geometry.userData, shadowSpans: spans };
    const out: KitPart = { material: g.material, geometry };
    if (g.variant) out.variant = g.variant;
    if (g.noCast) out.castShadow = false;
    if (g.texture) out.texture = g.texture;
    return out;
  });
}

// ---- the Piece builder -------------------------------------------------------------

export class NodeBuilder {
  readonly name: string;
  transform: Matrix4 | undefined;
  readonly parts: KitPart[] = [];
  readonly children: NodeBuilder[] = [];
  /** The piece's detail level; 'low' skips parts added with `small`. */
  readonly detail: 'high' | 'low';

  constructor(name: string, transform?: Matrix4, detail: 'high' | 'low' = 'high') {
    this.name = name;
    this.transform = transform;
    this.detail = detail;
  }

  /** Add parts to this node. */
  add(...p: PartsLike[]): this {
    for (const q of p) this.parts.push(...flat(q));
    return this;
  }

  /** Add the smallest parts (rivets, screws, tack welds): dropped at detail 'low'. Pass a thunk to skip building them too. */
  small(...p: Array<PartsLike | (() => PartsLike)>): this {
    if (this.detail === 'low') return this;
    for (const q of p) this.parts.push(...flat(typeof q === 'function' ? q() : q));
    return this;
  }

  /** A child node (something that moves relative to this one). Its parts are built in its own local space. */
  node(name: string, transform?: Matrix4 | Placement): NodeBuilder {
    const n = new NodeBuilder(name, transform === undefined ? undefined : transform instanceof Matrix4 ? transform : mat(transform), this.detail);
    this.children.push(n);
    return n;
  }
}

export interface PieceOptions {
  /** Seed for the per-part material-space offsets (default: from the piece name). Pass the piece's own seed. */
  seed?: number;
  /** Bake ambient-occlusion cavity across the whole piece at rest (default true). */
  ao?: AoOptions | false;
  /** Detail level: 'low' drops parts added with `small` (default 'high'). */
  detail?: 'high' | 'low';
}

export class PieceBuilder extends NodeBuilder {
  readonly pieceName: string;
  private readonly sockets: Record<string, Matrix4> = {};
  private readonly opts: PieceOptions;

  constructor(name: string, opts: PieceOptions = {}) {
    super('root', undefined, opts.detail ?? 'high');
    this.pieceName = name;
    this.opts = opts;
  }

  socket(name: string, m: Matrix4 | Placement): this {
    this.sockets[name] = m instanceof Matrix4 ? m : mat(m);
    return this;
  }

  /**
   * Offset every part's lpos by a seeded distance along +X, so two identical parts (two bolts, sixty
   * crates' planks) never show the same chips or grain. Deterministic from the piece seed and
   * the part's order in the tree; done once, here, so builders never have to think about it.
   */
  private offsetDone = false;

  private offsetParts(): void {
    if (this.offsetDone) return;
    this.offsetDone = true;
    const seed = this.opts.seed ?? nameSeed(this.pieceName);
    const seen = new Set<BufferGeometry>();
    let k = 0;
    const walk = (b: NodeBuilder): void => {
      for (let i = 0; i < b.parts.length; i++) {
        const q = b.parts[i]!;
        if (seen.has(q.geometry)) b.parts[i] = { ...q, geometry: q.geometry.clone() };
        const g = b.parts[i]!.geometry;
        seen.add(g);
        const h = hash2(seed, k++);
        const r = rng(h);
        // along +X only: the part's own axis stays at y = z = 0 (turned rings and a plank's pith centre on it)
        offsetLpos(g, r.range(0, LPOS_OFFSET), 0, 0);
      }
      for (const c of b.children) walk(c);
    };
    walk(this);
  }

  build(): Piece {
    this.offsetParts();
    const all: Array<{ geometry: BufferGeometry; matrix: Matrix4 }> = [];
    let triangles = 0;
    const box = new Box3();
    const walk = (b: NodeBuilder, parent: Matrix4): PieceNode => {
      const world = parent.clone().multiply(b.transform ?? new Matrix4());
      const parts = merge(b.parts);
      for (const p of parts) {
        triangles += triangleCount(p.geometry);
        all.push({ geometry: p.geometry, matrix: world });
        p.geometry.computeBoundingBox();
        const bb = p.geometry.boundingBox;
        if (bb && !bb.isEmpty()) box.union(bb.clone().applyMatrix4(world));
      }
      const node: PieceNode = { name: b.name, parts };
      if (b.transform) node.transform = b.transform.clone();
      if (b.children.length) node.children = b.children.map((c) => walk(c, world));
      return node;
    };
    const root = walk(this, new Matrix4());
    // the cavity bake: looked up in the bake table when it holds this exact input, else ray-traced (kit/bake.ts)
    if (this.opts.ao !== false) bakePiece(all, this.opts.ao ?? {});
    const size = box.isEmpty() ? { x: 0, y: 0, z: 0 } : { x: box.max.x - box.min.x, y: box.max.y - box.min.y, z: box.max.z - box.min.z };
    const piece: Piece = { name: this.pieceName, root, size, triangles };
    if (Object.keys(this.sockets).length) piece.sockets = { ...this.sockets };
    return piece;
  }
}

/** Start building a Piece. */
export function piece(name: string, opts?: PieceOptions): PieceBuilder {
  return new PieceBuilder(name, opts);
}

/** Triangles in a piece (recount from the tree). */
export function countTriangles(p: Piece | PieceNode): number {
  const node = 'root' in p ? p.root : p;
  let n = 0;
  for (const q of node.parts) n += triangleCount(q.geometry);
  for (const c of node.children ?? []) n += countTriangles(c);
  return n;
}

export interface BudgetRow {
  /** Node path from the root, e.g. 'root/hatch'. */
  node: string;
  material: MaterialClass;
  variant?: MaterialVariant | undefined;
  texture?: string | undefined;
  triangles: number;
}

export interface Budget {
  total: number;
  /** Triangles per node (its own parts only), keyed by node path. */
  byNode: Record<string, number>;
  /** Triangles per material class, over the whole piece. */
  byMaterial: Partial<Record<MaterialClass, number>>;
  /** One row per realised mesh (node × material × variant × texture), largest first. */
  rows: BudgetRow[];
  /**
   * Draw calls as `realize` (default backend) will make them: meshes, how many cast a shadow
   * (each caster draws again in the shadow pass), calls = meshes + casting. `nodesCalls` is the
   * same for the per-node backend, for comparison.
   */
  meshes: number;
  casting: number;
  calls: number;
  nodesCalls: number;
  /** The cap it was checked against, if any, and whether it fits. */
  cap?: number | undefined;
  fits: boolean;
  /** A few lines for a HUD or a console. */
  text: string;
}

/**
 * Where a piece's triangles go: per node, per material class, per mesh, largest first. For
 * builders fighting their cap (hero pieces ~11k at high; see the brief for yours).
 */
export function budget(p: Piece, cap?: number): Budget {
  const rows: BudgetRow[] = [];
  const byNode: Record<string, number> = {};
  const byMaterial: Partial<Record<MaterialClass, number>> = {};
  const walk = (n: PieceNode, path: string): void => {
    let own = 0;
    for (const q of n.parts) {
      const t = triangleCount(q.geometry);
      own += t;
      byMaterial[q.material] = (byMaterial[q.material] ?? 0) + t;
      rows.push({ node: path, material: q.material, variant: q.variant, texture: q.texture, triangles: t });
    }
    byNode[path] = own;
    for (const c of n.children ?? []) walk(c, `${path}/${c.name}`);
  };
  walk(p.root, p.root.name);
  // draw calls: the skinned backend draws one mesh per (material, variant, texture, castShadow)
  // for a multi-node piece; a single-node piece and the 'nodes' backend one per node × material
  const casts = (q: { material: MaterialClass; texture?: string | undefined; castShadow?: false | undefined; shadow?: 'hull' | 'none' | undefined }): boolean =>
    q.material !== 'bulb' && q.castShadow !== false && q.shadow !== 'none' && !(q.texture ?? '').startsWith('stencil');
  const allParts: KitPart[] = [];
  const gather = (n: PieceNode): void => {
    allParts.push(...n.parts);
    for (const c of n.children ?? []) gather(c);
  };
  gather(p.root);
  const keyOf = (q: KitPart): string => `${q.material}|${q.variant ?? ''}|${q.texture ?? ''}|${q.castShadow === false ? 'n' : ''}`;
  const multi = (p.root.children?.length ?? 0) > 0;
  const merged = new Map<string, KitPart>();
  for (const q of allParts) if (!merged.has(keyOf(q))) merged.set(keyOf(q), q);
  const drawn = multi ? [...merged.values()] : allParts;
  const meshes = drawn.length;
  // the shadow pass draws ONE shadow proxy per realised piece (kit/realize.ts), or the lone
  // casting mesh itself; the per-node backend one per node that has a casting part
  const casting = drawn.some(casts) ? 1 : 0;
  let castingNodes = 0;
  const countNodes = (n: PieceNode): void => {
    if (n.parts.some(casts)) castingNodes++;
    for (const c of n.children ?? []) countNodes(c);
  };
  countNodes(p.root);
  const nodesCalls = allParts.length + castingNodes;
  rows.sort((a, b) => b.triangles - a.triangles);
  const total = rows.reduce((s, r) => s + r.triangles, 0);
  const fits = cap === undefined || total <= cap;
  const pct = (t: number): string => `${((100 * t) / Math.max(1, total)).toFixed(0)}%`;
  const text = [
    `${p.name}: ${total} triangles${cap !== undefined ? ` / cap ${cap} ${fits ? 'ok' : 'OVER'}` : ''}`,
    `draw calls: ${meshes + casting} (${meshes} meshes, ${casting} cast a shadow)${multi ? `; per-node backend would be ${nodesCalls}` : ''}`,
    `by material: ${Object.entries(byMaterial).sort((a, b) => b[1]! - a[1]!).map(([m, t]) => `${m} ${t} (${pct(t!)})`).join(', ')}`,
    `by node: ${Object.entries(byNode).sort((a, b) => b[1] - a[1]).map(([nd, t]) => `${nd} ${t}`).join(', ')}`,
  ].join('\n');
  return { total, byNode, byMaterial, rows, meshes, casting, calls: meshes + casting, nodesCalls, cap, fits, text };
}

/** Axis-aligned bounds of a piece at rest, in its root space. */
export function pieceBounds(p: Piece): Box3 {
  const box = new Box3();
  const walk = (n: PieceNode, parent: Matrix4): void => {
    const w = parent.clone().multiply(n.transform ?? new Matrix4());
    for (const q of n.parts) {
      q.geometry.computeBoundingBox();
      if (q.geometry.boundingBox) box.union(q.geometry.boundingBox.clone().applyMatrix4(w));
    }
    for (const c of n.children ?? []) walk(c, w);
  };
  walk(p.root, new Matrix4());
  return box;
}
