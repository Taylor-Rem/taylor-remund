/**
 * poseBelt: set the belt's moving nodes from one number, the belt's travel.
 * Pure transform setting; no time, no simulation (the view passes the
 * travel it also gives the `belt` material as `u_offset`, so the ribs, the
 * laced seam and the rollers all agree).
 *
 *  - `seam` (the laced join) rides the loop: at travel t it sits at
 *    s = SEAM_S0 + t along it (loop.ts), on the belt's outer face.
 *  - `roller0..n` turn about their local Z (the axle) by -sense·t / radius:
 *    the drums turn clockwise seen from the front as the top travels +X;
 *    the return idlers, whose tops meet the return run, the other way.
 */
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { PieceNode } from '../../types.ts';
import { loopAt, loopGeom, topRunS } from './loop.ts';

export interface BeltPose {
  /** How far the belt has moved, world units (+: the top runs left to right). */
  travel?: number;
}

/** Per-roller data the view and the pose need: name, axle position, the radius its surface turns at. */
export interface RollerInfo {
  name: string;
  x: number;
  y: number;
  /** Radius at which the belt drives it (its surface). */
  r: number;
  /** 1: the belt drives its top (it turns clockwise seen from the front as the top runs +X); -1: its top meets the return run. */
  sense: 1 | -1;
}

/** Where the seam sits at travel 0, as an x on the carrying run (seen, toward the left). */
export const SEAM_X0 = -1.15;

/** Named poses for the catalogue (`?pose=`). */
export const NAMED_POSES: Readonly<Record<string, BeltPose>> = {
  rest: {},
  // the seam just coming over the tail drum
  'seam-left': { travel: -1.6 },
  // the seam near the head drum, about to go under
  'seam-right': { travel: 3.7 },
  // a quarter of the way round: the seam is underneath, out of sight
  under: { travel: 6.5 },
};

const Z = new Vector3(0, 0, 1);
const tq = new Quaternion();

/** The seam node's transform (in the root's space) at `travel` for a belt `length` long. */
export function seamMatrix(length: number, travel: number): Matrix4 {
  const g = loopGeom(length);
  const p = loopAt(g, topRunS(g, SEAM_X0) + travel);
  return new Matrix4().makeRotationZ(p.angle).setPosition(p.x, p.y, 0);
}

interface Rest {
  q: Quaternion;
}

function rest(o: Object3D): Rest {
  const u = o.userData as { beltRest?: Rest };
  if (!u.beltRest) u.beltRest = { q: o.quaternion.clone() };
  return u.beltRest;
}

/**
 * Pose a realized belt (the Object3D `realize` made, or any ancestor of
 * it). `length` must be the one it was built with; `rollers` is the list
 * `belt()` exported for that length (`beltRollers(length)`).
 */
export function poseBelt(root: Object3D, length: number, rollers: readonly RollerInfo[], pose: BeltPose): void {
  const t = pose.travel ?? 0;
  const seam = root.getObjectByName('seam');
  if (seam) seamMatrix(length, t).decompose(seam.position, seam.quaternion, seam.scale);
  for (const r of rollers) {
    const o = root.getObjectByName(r.name);
    if (!o) continue;
    o.quaternion.copy(rest(o).q).multiply(tq.setFromAxisAngle(Z, (-r.sense * t) / r.r));
  }
}

/** The same pose on a Piece description (node transforms), for a still built in a pose. */
export function posePiece(root: PieceNode, length: number, rollers: readonly RollerInfo[], pose: BeltPose): void {
  const t = pose.travel ?? 0;
  const byName = new Map(rollers.map((r) => [r.name, r]));
  const walk = (n: PieceNode): void => {
    if (n.name === 'seam') n.transform = seamMatrix(length, t);
    const r = byName.get(n.name);
    if (r && t !== 0) n.transform = (n.transform ?? new Matrix4()).clone().multiply(new Matrix4().makeRotationZ((-r.sense * t) / r.r));
    for (const c of n.children ?? []) walk(c);
  };
  walk(root);
}
