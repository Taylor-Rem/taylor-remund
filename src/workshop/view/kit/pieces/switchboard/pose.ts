/**
 * poseSwitchboard: set the board's moving parts from a few numbers. Pure
 * transform and colour setting; no simulation logic, no easing, no time.
 *
 *  - drawers: 0 shut .. 1 pulled out (BOARD.drawerTravel along the node's local +X, out of the board).
 *  - lamps: 0 dark .. 1 lit. Lighting rewrites the vertex colour of the lens in the node
 *    `lamp.<jack>` (the bulb class emits its vertex colour), so a realized board must own its
 *    lens geometry: realize one board per switchboard, not a shared memoised piece twice.
 *
 * Works on both a realized Object3D tree (the view) and a Piece's node tree (a build-time pose).
 */
import { Matrix4, Vector3 } from 'three';
import type { BufferAttribute, Mesh, Object3D } from 'three';
import type { PieceNode } from '../../types.ts';
import { linear } from '../../../palette.ts';
import { JACKS } from './labels.ts';
import type { JackName } from './labels.ts';

export interface SwitchboardPose {
  drawers?: Partial<Record<JackName, number>>;
  lamps?: Partial<Record<JackName, number>>;
}

export const POSE = {
  /** How far a drawer pulls out, world units. */
  drawerTravel: 0.42,
  /** Brightness of an unlit lens (dark amber glass). */
  lensOff: 0.07,
} as const;

export const NAMED_POSES: Record<string, SwitchboardPose> = {
  rest: { drawers: { storefront: 0, lamp: 0 }, lamps: { storefront: 0, lamp: 0 } },
  /** A text has arrived on STOREFRONT: its lamp is lit and Patch has its drawer open. */
  storefront: { drawers: { storefront: 0.8, lamp: 0 }, lamps: { storefront: 1, lamp: 0 } },
  /** The same on LAMP. */
  lamp: { drawers: { storefront: 0, lamp: 0.8 }, lamps: { storefront: 0, lamp: 1 } },
  /** Both lamps lit (the cord in one jack, a call waiting on the other). */
  both: { drawers: { storefront: 0.3, lamp: 0 }, lamps: { storefront: 1, lamp: 1 } },
};

/** Linear colour of a lens at brightness k (0 dark .. 1 lit). */
export function lensColour(k: number): [number, number, number] {
  const c = linear('amber-glow');
  const s = POSE.lensOff + (1 - POSE.lensOff) * Math.max(0, Math.min(1, k));
  return [c[0] * s, c[1] * s, c[2] * s];
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

function writeColour(attr: BufferAttribute | undefined, k: number): void {
  if (!attr) return;
  const [r, g, b] = lensColour(k);
  for (let i = 0; i < attr.count; i++) attr.setXYZ(i, r, g, b);
  attr.needsUpdate = true;
}

function isObject3D(n: Object3D | PieceNode): n is Object3D {
  return (n as Object3D).isObject3D === true;
}

function findObj(root: Object3D, name: string): Object3D | undefined {
  return root.getObjectByName(name) ?? undefined;
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
        const o = findObj(root, `drawer.${j}`);
        if (o) {
          const u = o.userData as { boardRest?: Vector3 };
          if (!u.boardRest) u.boardRest = o.position.clone();
          // local +X of the node, in its parent's space
          const dir = new Vector3(1, 0, 0).applyQuaternion(o.quaternion);
          o.position.copy(u.boardRest).addScaledVector(dir, t);
        }
      } else {
        const n = findNode(root, `drawer.${j}`);
        if (n?.transform) {
          const rest = (n as PieceNode & { rest?: Matrix4 }).rest ?? n.transform.clone();
          (n as PieceNode & { rest?: Matrix4 }).rest = rest;
          n.transform = rest.clone().multiply(new Matrix4().makeTranslation(t, 0, 0));
        }
      }
    }
    const l = pose.lamps?.[j];
    if (l !== undefined) {
      if (isObject3D(root)) {
        const o = findObj(root, `lamp.${j}`);
        o?.children.forEach((c) => {
          const m = c as Mesh;
          if (m.isMesh && m.userData['kitMaterial'] === 'bulb') writeColour(m.geometry.getAttribute('color') as BufferAttribute, l);
        });
      } else {
        const n = findNode(root, `lamp.${j}`);
        for (const q of n?.parts ?? []) if (q.material === 'bulb') writeColour(q.geometry.getAttribute('color') as BufferAttribute, l);
      }
    }
  }
}
