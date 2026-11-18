/**
 * poseSwitchboard: set the board's moving parts from a few numbers. Pure
 * node-transform setting (no geometry writes, no simulation logic, no
 * time), so it behaves the same on every `realize` backend (per-node meshes
 * or the skinned bone tree) and two boards never share state.
 *
 *  - drawers: 0 shut .. 1 pulled out (POSE.drawerTravel along the node's local +X, out of the board).
 *  - lamps: 0 dark .. 1 lit. Each lamp node holds a lit lens and a dark one; the one not
 *    showing is collapsed to HIDDEN scale inside the bezel. The switch is a threshold at 0.5.
 *  - collars: 0 down .. 1 offered: the jack's knurled collar lifts COLLAR_LIFT out of the
 *    plate along the node's local +Z and swells by POSE.collarSwell, showing the yellow sleeve
 *    under it (§ D 4: while the plug is held, the live jacks show themselves). Continuous, so
 *    the view can run it up and down (or pulse it) on its own clock.
 *
 * A jack the board does not have (the slice has two) is skipped.
 * Works on both a realized Object3D tree (the view) and a Piece's node tree (a build-time pose).
 */
import { Matrix4, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { PieceNode } from '../../types.ts';
import { JACKS } from './labels.ts';
import type { JackName } from './labels.ts';
import { COLLAR_LIFT } from './parts.ts';

export interface SwitchboardPose {
  drawers?: Partial<Record<JackName, number>>;
  lamps?: Partial<Record<JackName, number>>;
  collars?: Partial<Record<JackName, number>>;
}

export const POSE = {
  /** How far a drawer pulls out, world units. */
  drawerTravel: 0.42,
  /** How much an offered collar swells (scale 1 + this at collar 1). */
  collarSwell: 0.1,
} as const;

/** The scale a swapped-out lens is collapsed to (inside its bezel). */
export const HIDDEN = 1e-4;

const each = (v: number): Record<JackName, number> => ({ storefront: v, platen: v, belt: v, lamp: v });
const only = (j: JackName, v: number): Record<JackName, number> => ({ ...each(0), [j]: v });

export const NAMED_POSES: Record<string, SwitchboardPose> = {
  /** Every drawer shut, every lamp dark, every collar down. */
  rest: { drawers: each(0), lamps: each(0), collars: each(0) },
  /** A text has arrived on STOREFRONT: its lamp is lit and Patch has its drawer open. */
  storefront: { drawers: only('storefront', 0.8), lamps: only('storefront', 1), collars: each(0) },
  /** The same on PLATEN, BELT, LAMP. */
  platen: { drawers: only('platen', 0.8), lamps: only('platen', 1), collars: each(0) },
  belt: { drawers: only('belt', 0.8), lamps: only('belt', 1), collars: each(0) },
  lamp: { drawers: only('lamp', 0.8), lamps: only('lamp', 1), collars: each(0) },
  /** Both lamps lit (the cord in one jack, a call waiting on the other). */
  both: { drawers: { ...each(0), storefront: 0.3 }, lamps: { ...each(0), storefront: 1, lamp: 1 }, collars: each(0) },
  /** The plug is held: every live jack lifts its collar (§ D 4). */
  offer: { drawers: each(0), lamps: each(0), collars: each(1) },
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

/** Move a node by `t` along `axis` (in its own frame) from its rest, and scale it by `k`. */
function offset(root: Object3D | PieceNode, name: string, axis: Vector3, t: number, k = 1): void {
  if (isObject3D(root)) {
    const o = root.getObjectByName(name);
    if (!o) return;
    const u = o.userData as { boardRest?: Vector3 };
    if (!u.boardRest) u.boardRest = o.position.clone();
    const dir = axis.clone().applyQuaternion(o.quaternion);
    o.position.copy(u.boardRest).addScaledVector(dir, t);
    o.scale.setScalar(k);
  } else {
    const n = findNode(root, name) as (PieceNode & { rest?: Matrix4 }) | undefined;
    if (!n?.transform) return;
    n.rest ??= n.transform.clone();
    n.transform = n.rest.clone().multiply(new Matrix4().makeTranslation(axis.x * t, axis.y * t, axis.z * t)).multiply(new Matrix4().makeScale(k, k, k));
  }
}

const X = new Vector3(1, 0, 0);
const Z = new Vector3(0, 0, 1);

/** Pose a realized switchboard (or a built Piece's root node). Missing entries are left as they are. */
export function poseSwitchboard(root: Object3D | PieceNode, pose: SwitchboardPose): void {
  for (const j of JACKS) {
    const d = pose.drawers?.[j];
    if (d !== undefined) offset(root, `drawer.${j}`, X, clamp01(d) * POSE.drawerTravel);
    const c = pose.collars?.[j];
    if (c !== undefined) offset(root, `collar.${j}`, Z, clamp01(c) * COLLAR_LIFT, 1 + clamp01(c) * POSE.collarSwell);
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
