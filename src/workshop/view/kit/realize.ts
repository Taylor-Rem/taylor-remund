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
 * Skinned meshes get a conservative bounding sphere (the rest bounds grown by
 * half their diagonal) so a posed rig is never culled wrongly; their bounding
 * box is the exact rest box, so framing and layout match the per-node backend. Their geometry is built once
 * per Piece and shared by every realisation of it (a memoised crate realised
 * four times shares one geometry; each realisation has its own bones).
 */
import { Bone, Box3, BufferAttribute, Group, Matrix4, Mesh, Skeleton, SkinnedMesh, Sphere, Uint16BufferAttribute, Uint8BufferAttribute, Vector3 } from 'three';
import type { BufferGeometry, Material, Object3D } from 'three';
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
}

const NO_CAST: ReadonlySet<MaterialClass> = new Set(['bulb']);
const NO_RECEIVE: ReadonlySet<MaterialClass> = new Set(['bulb']);

function materialOf(part: KitPart, materials: Materials): Material {
  return part.texture ? materials.textured(part.material, part.texture) : materials.of(part.material, part.variant);
}

function shadows(mesh: Mesh, part: KitPart, material: Material, o: RealizeOptions): void {
  // blended decals (sprayed stencils: transparent without an alpha cut) never cast a shadow;
  // they may receive one. Cut labels (alphaTest) and opaque parts cast as usual.
  const blended = material.transparent && !(material.alphaTest > 0);
  mesh.castShadow = (o.castShadow ?? true) && !NO_CAST.has(part.material) && !blended && part.castShadow !== false;
  mesh.receiveShadow = (o.receiveShadow ?? true) && !NO_RECEIVE.has(part.material);
  mesh.userData['kitMaterial'] = part.material;
}

const partName = (part: KitPart): string =>
  `${part.material}${part.variant ? `.${part.variant}` : ''}${part.texture ? `.${part.texture}` : ''}${part.castShadow === false ? '.noshadow' : ''}`;

// ---- nodes backend ------------------------------------------------------------

function meshOf(node: PieceNode, part: KitPart, materials: Materials, o: RealizeOptions): Mesh {
  const material = materialOf(part, materials);
  const mesh = new Mesh(part.geometry, material);
  mesh.name = `${node.name}.${partName(part)}`;
  shadows(mesh, part, material, o);
  return mesh;
}

function nodeOf(node: PieceNode, materials: Materials, o: RealizeOptions): Group {
  const g = new Group();
  g.name = node.name;
  if (node.transform) node.transform.decompose(g.position, g.quaternion, g.scale);
  for (const part of node.parts) g.add(meshOf(node, part, materials, o));
  for (const c of node.children ?? []) g.add(nodeOf(c, materials, o));
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
  const built = { stamp, groups, sphere, box };
  skinCache.set(piece, built);
  return built;
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
  for (const g of built.groups) {
    const material = materialOf(g.part, materials);
    const mesh = new SkinnedMesh(g.geometry, material);
    mesh.name = `skin.${partName(g.part)}`;
    shadows(mesh, g.part, material, o);
    mesh.boundingSphere = built.sphere.clone();
    mesh.boundingBox = built.box.clone();
    top.add(mesh);
    mesh.updateMatrixWorld(true);
    mesh.bind(skeleton);
  }
  top.userData['kitBackend'] = 'skinned';
}

/**
 * Debugging and A/B only: a page URL carrying `kitBackend=nodes|skinned|auto` picks the
 * default backend for every realize on that page that does not name one (so any page, the
 * catalogue or the stage, can be compared without code changes). Never used by the site.
 */
function debugBackend(): Backend | undefined {
  const search = (globalThis as { location?: { search?: string } }).location?.search ?? '';
  const m = /[?&]kitBackend=(nodes|skinned|auto)\b/.exec(search);
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

/** How a realised piece draws: meshes, how many cast (each caster draws again in the shadow pass), and the calls that makes. */
export function drawStats(object: Object3D): { meshes: number; casting: number; calls: number } {
  let meshes = 0, casting = 0;
  object.traverse((x) => {
    if ((x as Mesh).isMesh) {
      meshes++;
      if ((x as Mesh).castShadow) casting++;
    }
  });
  return { meshes, casting, calls: meshes + casting };
}
