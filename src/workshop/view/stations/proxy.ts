/**
 * Pick targets for one moving node of a realised piece (W3: "what can be touched must look it").
 * `ctx.pickable(id, object)` measures the object's meshes; a node of a skinned piece is a bone with
 * no mesh of its own, so a target for it is an empty group riding on that bone, sized to the node's
 * parts: an empty object is picked as a 0.1 cube in its own frame (picking.ts), so the group's scale
 * makes that cube the node's box. Scale it toward nothing to take the target away. No geometry.
 */
import { Box3, Group, Matrix4, Vector3, type Object3D } from 'three';
import type { Piece, PieceNode } from '../kit/types.ts';

/** The empty-object box picking.ts uses (±0.05). */
const EMPTY = 0.1;

/** A node's parts (and its children's), measured in the node's own frame. */
export function nodeBounds(p: Piece, name: string, out = new Box3()): Box3 {
  out.makeEmpty();
  const find = (n: PieceNode): PieceNode | null => {
    if (n.name === name) return n;
    for (const c of n.children ?? []) {
      const f = find(c);
      if (f) return f;
    }
    return null;
  };
  const node = find(p.root);
  if (!node) return out;
  const b = new Box3();
  const walk = (n: PieceNode, m: Matrix4): void => {
    for (const q of n.parts) {
      q.geometry.computeBoundingBox();
      if (q.geometry.boundingBox) out.union(b.copy(q.geometry.boundingBox).applyMatrix4(m));
    }
    for (const c of n.children ?? []) walk(c, c.transform ? m.clone().multiply(c.transform) : m);
  };
  walk(node, new Matrix4());
  return out;
}

/** An empty group on `parent` covering `box` (in the parent's frame), grown by `pad` each side. */
export function proxyOn(parent: Object3D, box: Box3, name: string, pad = 0.04): Group {
  const g = new Group();
  g.name = name;
  const c = box.getCenter(new Vector3());
  const s = box.getSize(new Vector3());
  g.position.copy(c);
  g.scale.set((s.x + 2 * pad) / EMPTY, (s.y + 2 * pad) / EMPTY, (s.z + 2 * pad) / EMPTY);
  g.userData.proxyScale = g.scale.clone();
  parent.add(g);
  return g;
}

/** Take a proxy away (shrunk to nothing) or give it back. */
export function proxyOnOff(g: Group, on: boolean): void {
  const s = g.userData.proxyScale as Vector3 | undefined;
  if (!s) return;
  if (on) g.scale.copy(s);
  else g.scale.setScalar(1e-4);
}
