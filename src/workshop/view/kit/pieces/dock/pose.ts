/**
 * poseDock: set the dock's moving nodes from a few numbers. Pure node
 * transforms (drawing is skinned: no geometry, material or visibility
 * swaps), no time, no simulation; the same on a realized Object3D tree (the
 * view) and on a Piece's node tree (a still built in a pose).
 *
 *  - `door` 0 shut .. 1 open. The slats `door.0` (the bottom bar) ..
 *    `door.<n>` ride up together; a slat whose bottom edge has gone up past
 *    the housing's lip is inside the drum housing and is collapsed to HIDDEN
 *    there (the housing's skin hides the moment it goes in).
 *  - `bell` swing in degrees about the bell's hanger (its local Z, the
 *    door's face normal: it swings across the door's face, toward and away
 *    from the jamb); `clapper` swing in degrees, relative to the bell, about
 *    the same axis (it lags: the view drives both from a damped spring).
 *  - `flap` swing in degrees about its hinge (its local X, along the top of
 *    the opening): + swings it IN (something being shipped pushes through),
 *    - swings it OUT toward the visitor (something coming back).
 *  - `lamp` 0 dark .. 1 lit (`lamp.lit` / `lamp.unlit` swap scales at 0.5).
 *  - `rollers` the ramp's rollers' turn, radians, about their own axles
 *    (local Y): + turns them the way a part riding into the dock turns them.
 */
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { PieceNode } from '../../types.ts';
import { DOCK } from './dims.ts';

export interface DockPose {
  door?: number;
  bell?: number;
  clapper?: number;
  flap?: number;
  lamp?: number;
  rollers?: number;
}

/** The scale a hidden node is collapsed to. */
export const HIDDEN = 1e-4;

/** How far the shutter rises when fully open (the opening's height and a little, so the bar clears the lip). */
export const DOOR_TRAVEL = DOCK.openH + 0.03;

export const NAMED_POSES: Readonly<Record<string, DockPose>> = {
  shut: { door: 0, lamp: 0 },
  half: { door: 0.5, lamp: 1 },
  open: { door: 1, lamp: 1 },
  /** Something being shipped: the door up, the flap pushed in, the bell swinging, its clapper lagging. */
  shipping: { door: 1, flap: 34, bell: 16, clapper: -18, lamp: 1, rollers: 2.2 },
  /** Something coming back out: the door half up, the flap kicked out toward the visitor. */
  returning: { door: 0.62, flap: -30, bell: -6, clapper: 8, lamp: 1, rollers: -1.5 },
  /** The bell at the top of its swing (a still of the ring). */
  ring: { door: 0, bell: 24, clapper: -22, lamp: 1 },
};

/** Per-slat data the pose needs: name, its bottom edge at rest (door-local y), and its height. */
export interface SlatInfo {
  name: string;
  y0: number;
  h: number;
}

/** The slats from the bottom bar up, in door-local heights. */
export function slats(): SlatInfo[] {
  const out: SlatInfo[] = [];
  const bar = 0.11;
  out.push({ name: 'door.0', y0: DOCK.sillY, h: bar });
  const n = Math.round((DOCK.openH - bar) / DOCK.slatPitch);
  const p = (DOCK.openH - bar) / n;
  for (let i = 0; i < n; i++) out.push({ name: `door.${i + 1}`, y0: DOCK.sillY + bar + i * p, h: p });
  return out;
}

/** The housing's lip: a slat whose bottom edge passes this height is inside. */
export const LIP_Y = DOCK.sillY + DOCK.openH;

const clamp = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x));

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

type Rested = { dockRest?: Matrix4 };

/** Set node `name` to rest · m (rest = its built transform, remembered on first use). */
function setLocal(root: Object3D | PieceNode, name: string, m: Matrix4): void {
  if (isObject3D(root)) {
    const o = root.getObjectByName(name);
    if (!o) return;
    const u = o.userData as Rested;
    if (!u.dockRest) {
      o.updateMatrix();
      u.dockRest = o.matrix.clone();
    }
    u.dockRest.clone().multiply(m).decompose(o.position, o.quaternion, o.scale);
  } else {
    const n = findNode(root, name) as (PieceNode & { dockRest?: Matrix4 }) | undefined;
    if (!n) return;
    n.dockRest ??= (n.transform ?? new Matrix4()).clone();
    n.transform = n.dockRest.clone().multiply(m);
  }
}

const DEG = Math.PI / 180;
const S = new Vector3(), P = new Vector3(), Q = new Quaternion();

/** The slat's local transform (relative to its rest) at door opening `o`. */
export function slatMatrix(s: SlatInfo, o: number): Matrix4 {
  const rise = clamp(o, 0, 1) * DOOR_TRAVEL;
  const inside = s.y0 + rise >= LIP_Y - 0.004;
  P.set(0, inside ? LIP_Y + 0.12 - s.y0 : rise, 0);
  S.setScalar(inside ? HIDDEN : 1);
  return new Matrix4().compose(P, Q.identity(), S);
}

/** The ramp rollers' node names (as built). */
export function rollerNames(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `ramp.roller${i}`);
}

/** Pose a realized dock (or a built Piece's root node). Missing entries are left as they are. */
export function poseDock(root: Object3D | PieceNode, pose: DockPose, rollerCount = 0): void {
  if (pose.door !== undefined) for (const s of slats()) setLocal(root, s.name, slatMatrix(s, pose.door));
  if (pose.bell !== undefined) setLocal(root, 'bell', new Matrix4().makeRotationZ(pose.bell * DEG));
  if (pose.clapper !== undefined) setLocal(root, 'bell.clapper', new Matrix4().makeRotationZ(pose.clapper * DEG));
  if (pose.flap !== undefined) setLocal(root, 'flap', new Matrix4().makeRotationX(pose.flap * DEG));
  if (pose.lamp !== undefined) {
    const on = pose.lamp >= 0.5;
    setLocal(root, 'lamp.lit', new Matrix4().makeScale(on ? 1 / HIDDEN : 1, on ? 1 / HIDDEN : 1, on ? 1 / HIDDEN : 1));
    setLocal(root, 'lamp.unlit', new Matrix4().makeScale(on ? HIDDEN : 1, on ? HIDDEN : 1, on ? HIDDEN : 1));
  }
  if (pose.rollers !== undefined) for (const n of rollerNames(rollerCount)) setLocal(root, n, new Matrix4().makeRotationY(pose.rollers));
}
