/**
 * poseChute: the return chute's one moving node, `flap`, swung about its
 * hinge (its local X, along the mouth's top edge). Pure node transforms, no
 * time; the same on a realized Object3D tree and on a Piece's node tree.
 *
 *  - `flap` degrees: 0 shut (hanging in the mouth), + kicked open (out and
 *    up, as a part pops through). The view drives it from a spring: a kick
 *    to about 70, a bounce or two, back to 0.
 */
import { Matrix4 } from 'three';
import type { Object3D } from 'three';
import type { PieceNode } from '../../types.ts';

export interface ChutePose {
  flap?: number;
}

export const NAMED_POSES: Readonly<Record<string, ChutePose>> = {
  shut: { flap: 0 },
  /** A part just through: the flap kicked out and up. */
  kicked: { flap: 72 },
  /** Swinging back, half way. */
  settling: { flap: 28 },
};

const DEG = Math.PI / 180;

function findNode(root: PieceNode, name: string): PieceNode | undefined {
  if (root.name === name) return root;
  for (const c of root.children ?? []) {
    const f = findNode(c, name);
    if (f) return f;
  }
  return undefined;
}

/** Pose a realized chute (or a built Piece's root node). */
export function poseChute(root: Object3D | PieceNode, pose: ChutePose): void {
  if (pose.flap === undefined) return;
  // + swings the hanging plate's foot out along the mouth's +Z
  const m = new Matrix4().makeRotationX(-pose.flap * DEG);
  if ((root as Object3D).isObject3D) {
    const o = (root as Object3D).getObjectByName('flap');
    if (!o) return;
    const u = o.userData as { chuteRest?: Matrix4 };
    if (!u.chuteRest) {
      o.updateMatrix();
      u.chuteRest = o.matrix.clone();
    }
    u.chuteRest.clone().multiply(m).decompose(o.position, o.quaternion, o.scale);
  } else {
    const n = findNode(root as PieceNode, 'flap') as (PieceNode & { chuteRest?: Matrix4 }) | undefined;
    if (!n) return;
    n.chuteRest ??= (n.transform ?? new Matrix4()).clone();
    n.transform = n.chuteRest.clone().multiply(m);
  }
}
