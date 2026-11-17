/**
 * poseSwitchboard: set the board's moving parts from a few numbers. Pure
 * node-transform setting (no geometry writes, no simulation logic, no
 * time), so it behaves the same on every `realize` backend (per-node meshes
 * or the skinned bone tree) and two boards never share state.
 *
 *  - drawers: 0 shut .. 1 pulled out (POSE.drawerTravel along the node's local +X, out of the board).
 *  - lamps: 0 dark .. 1 lit. Each lamp node holds a lit lens and a dark one; the one not
 *    showing is collapsed to HIDDEN scale inside the bezel. The switch is a threshold at 0.5.
 *
 * Works on both a realized Object3D tree (the view) and a Piece's node tree (a build-time pose).
 */
import { Matrix4, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { PieceNode } from '../../types.ts';
import { JACKS } from './labels.ts';
import type { JackName } from './labels.ts';

export interface SwitchboardPose {
  drawers?: Partial<Record<JackName, number>>;
  lamps?: Partial<Record<JackName, number>>;
}

export const POSE = {
  /** How far a drawer pulls out, world units. */
  drawerTravel: 0.42,
} as const;

/** The scale a swapped-out lens is collapsed to (inside its bezel). */
export const HIDDEN = 1e-4;

export const NAMED_POSES: Record<string, SwitchboardPose> = {
  rest: { drawers: { storefront: 0, lamp: 0 }, lamps: { storefront: 0, lamp: 0 } },
  /** A text has arrived on STOREFRONT: its lamp is lit and Patch has its drawer open. */
  storefront: { drawers: { storefront: 0.8, lamp: 0 }, lamps: { storefront: 1, lamp: 0 } },
  /** The same on LAMP. */
  lamp: { drawers: { storefront: 0, lamp: 0.8 }, lamps: { storefront: 0, lamp: 1 } },
  /** Both lamps lit (the cord in one jack, a call waiting on the other). */
  both: { drawers: { storefront: 0.3, lamp: 0 }, lamps: { storefront: 1, lamp: 1 } },
};

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

function isObject3D(n: Object3D | PieceNode): n is Object3D {
  return (n as Object3D).isObject3D === true;
}

function findNode(root: PieceNode, name: string): PieceNode | undefined {
  if (root.name === name) return root;
  for (const c of root.children ?? []) {
    const f = findNode(c, name);
    if (f) return f;
  }
  return undefined;
}

/** Pose a realized switchboard (or a built Piece's root node). Missing entries are left as they are. */
export function poseSwitchboard(root: Object3D | PieceNode, pose: SwitchboardPose): void {
  for (const j of JACKS) {
    const d = pose.drawers?.[j];
    if (d !== undefined) {
      const t = clamp01(d) * POSE.drawerTravel;
      if (isObject3D(root)) {
        const o = root.getObjectByName(`drawer.${j}`);
        if (o) {
          const u = o.userData as { boardRest?: Vector3 };
          if (!u.boardRest) u.boardRest = o.position.clone();
          // local +X of the node, in its parent's space
          const dir = new Vector3(1, 0, 0).applyQuaternion(o.quaternion);
          o.position.copy(u.boardRest).addScaledVector(dir, t);
        }
      } else {
        const n = findNode(root, `drawer.${j}`) as (PieceNode & { rest?: Matrix4 }) | undefined;
        if (n?.transform) {
          n.rest ??= n.transform.clone();
          n.transform = n.rest.clone().multiply(new Matrix4().makeTranslation(t, 0, 0));
        }
      }
    }
    const l = pose.lamps?.[j];
    if (l !== undefined) {
      const on = l >= 0.5;
      for (const [name, show] of [[`lamp.${j}.lit`, on], [`lamp.${j}.unlit`, !on]] as const) {
        const k = show ? 1 : HIDDEN;
        if (isObject3D(root)) root.getObjectByName(name)?.scale.setScalar(k);
        else {
          const n = findNode(root, name);
          if (n) n.transform = new Matrix4().makeScale(k, k, k);
        }
      }
    }
  }
}
