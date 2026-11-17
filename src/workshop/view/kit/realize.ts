/**
 * realize: the ONLY place in the workshop where a Mesh is created
 * (REWRITE.md § E3). A Piece becomes a Group tree that mirrors its node
 * tree: one Group per node, named after it (so views can find and animate
 * it with getObjectByName), and one Mesh per (node, material) part inside.
 *
 * The backend is a parameter so a later one (one rigid-skinned mesh per
 * material for a whole rig, or instancing for repeated pieces) can be added
 * without changing callers: they only ever see named Object3Ds.
 */
import { Group, Mesh } from 'three';
import type { Object3D } from 'three';
import type { Materials } from '../types.ts';
import type { KitPart, MaterialClass, Piece, PieceNode } from './types.ts';

export interface RealizeOptions {
  /** 'meshes' (the only one so far): a Group per node, a Mesh per part. */
  backend?: 'meshes';
  /** Cast shadows (default true). Bulbs never cast. */
  castShadow?: boolean;
  receiveShadow?: boolean;
}

const NO_CAST: ReadonlySet<MaterialClass> = new Set(['bulb']);
const NO_RECEIVE: ReadonlySet<MaterialClass> = new Set(['bulb']);

function meshOf(node: PieceNode, part: KitPart, materials: Materials, o: RealizeOptions): Mesh {
  const material = part.texture ? materials.textured(part.material, part.texture) : materials.of(part.material, part.variant);
  const mesh = new Mesh(part.geometry, material);
  mesh.name = `${node.name}.${part.material}${part.variant ? `.${part.variant}` : ''}${part.texture ? `.${part.texture}` : ''}`;
  mesh.castShadow = (o.castShadow ?? true) && !NO_CAST.has(part.material);
  mesh.receiveShadow = (o.receiveShadow ?? true) && !NO_RECEIVE.has(part.material);
  mesh.userData['kitMaterial'] = part.material;
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

/** Turn a Piece into Three.js objects: a Group named after the piece, holding its node tree. */
export function realize(piece: Piece, materials: Materials, o: RealizeOptions = {}): Object3D {
  const top = new Group();
  top.name = piece.name;
  top.userData['kitPiece'] = piece.name;
  top.add(nodeOf(piece.root, materials, o));
  return top;
}
