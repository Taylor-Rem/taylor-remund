/**
 * poseBelt: set the belt's moving nodes from a few numbers. Pure transform
 * setting; no time, no simulation.
 *
 *  - `travel`: how far the surface has moved (world units, + is the top
 *    running left to right). Drive it with the simulation's `BeltView.phase`
 *    and give the `belt` material the SAME number as `u_offset`: the
 *    material's ribs are laid along the loop in world units (uv.x is the
 *    distance round the loop), so ribs, laced seam, stripes and rollers then
 *    all move together, whichever way and however fast.
 *    - `seam` (the laced join) rides the loop: at travel t it sits at
 *      s = SEAM_S0 + t along it (loop.ts), on the belt's outer face.
 *    - `mark1..MARKS` (with the `marks` option): painted stripes evenly
 *      spaced round the loop after the seam, so one of the three is always
 *      on the top run.
 *    - `roller0..n` turn about their local Z (the axle) by -sense·t / radius:
 *      the drums turn clockwise seen from the front as the top travels +X;
 *      the return idlers, whose tops meet the return run, the other way.
 *  - `dial`: the speed dial's detent, 1 (slow) .. 5 (fast); fractions
 *    between are the knob on its way. The `dial` node turns about its local
 *    +Y (out of the desk) by `dialAngle`.
 *  - `lever`: -1 backward (leans left), 0 stop (upright), 1 forward (leans
 *    right); fractions between are the lever on its way.
 *  - `lamp`: the station lamp lit (`lamp.lit` shown, `lamp.unlit` hidden).
 */
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { PieceNode } from '../../types.ts';
import { loopAt, loopGeom, topRunS } from './loop.ts';
import { dialAngle, leverAngle } from './controls.ts';

export interface BeltPose {
  /** How far the belt has moved, world units (+: the top runs left to right). */
  travel?: number;
  /** The dial's detent, 1..5 (default 3, the middle). */
  dial?: number;
  /** The lever: -1 backward, 0 stop, 1 forward (default 1: the visit starts running forward). */
  lever?: number;
  /** The station lamp lit. */
  lamp?: boolean;
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
/** How many painted stripes ride the loop with the seam (option `marks`). */
export const MARKS = 3;
/** Scale of a hidden twin (the lamp's unlit or lit body). */
export const HIDDEN = 1e-4;

/** Named poses for the catalogue (`?pose=`). */
export const NAMED_POSES: Readonly<Record<string, BeltPose>> = {
  rest: {},
  // the seam just coming over the tail drum
  'seam-left': { travel: -1.6 },
  // the seam near the head drum, about to go under
  'seam-right': { travel: 3.7 },
  // a quarter of the way round: the seam is underneath, out of sight
  under: { travel: 6.5 },
  // the dial's five detents
  speed1: { dial: 1 },
  speed2: { dial: 2 },
  speed3: { dial: 3 },
  speed4: { dial: 4 },
  speed5: { dial: 5 },
  // the lever's three positions
  backward: { lever: -1 },
  stop: { lever: 0 },
  forward: { lever: 1 },
  lit: { lamp: true },
};

/** `dial:2.5,lever:-0.5,travel:1.2,lamp:1` → a pose (for stills and strips of in-between frames). Null if it does not parse. */
export function parsePose(s: string): BeltPose | null {
  const out: { travel?: number; dial?: number; lever?: number; lamp?: boolean } = {};
  for (const kv of s.split(',')) {
    const [k, v] = kv.split(':');
    const n = Number(v);
    if (!k || v === undefined || !Number.isFinite(n)) return null;
    if (k === 'travel') out.travel = n;
    else if (k === 'dial') out.dial = n;
    else if (k === 'lever') out.lever = n;
    else if (k === 'lamp') out.lamp = n !== 0;
    else return null;
  }
  return out;
}

const Z = new Vector3(0, 0, 1);
const Y = new Vector3(0, 1, 0);
const tq = new Quaternion();

/** The seam node's transform (in the root's space) at `travel` for a belt `length` long. */
export function seamMatrix(length: number, travel: number): Matrix4 {
  const g = loopGeom(length);
  const p = loopAt(g, topRunS(g, SEAM_X0) + travel);
  return new Matrix4().makeRotationZ(p.angle).setPosition(p.x, p.y, 0);
}

/** Stripe k's transform (1..MARKS): evenly spaced round the loop after the seam. */
export function markMatrix(length: number, travel: number, k: number): Matrix4 {
  const g = loopGeom(length);
  const p = loopAt(g, topRunS(g, SEAM_X0) + travel - (g.length * k) / (MARKS + 1));
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

const m4 = new Matrix4();

/**
 * Pose a realized belt (the Object3D `realize` made, or any ancestor of
 * it). `length` must be the one it was built with; `rollers` is the list
 * `belt()` exported for that length (`beltRollers(length)`). Fields left
 * out of `pose` are left where they are, except `travel` (default 0).
 */
export function poseBelt(root: Object3D, length: number, rollers: readonly RollerInfo[], pose: BeltPose): void {
  const t = pose.travel ?? 0;
  const seam = root.getObjectByName('seam');
  if (seam) seamMatrix(length, t).decompose(seam.position, seam.quaternion, seam.scale);
  for (let k = 1; k <= MARKS; k++) {
    const m = root.getObjectByName(`mark${k}`);
    if (m) markMatrix(length, t, k).decompose(m.position, m.quaternion, m.scale);
  }
  for (const r of rollers) {
    const o = root.getObjectByName(r.name);
    if (!o) continue;
    o.quaternion.copy(rest(o).q).multiply(tq.setFromAxisAngle(Z, (-r.sense * t) / r.r));
  }
  if (pose.dial !== undefined) {
    const o = root.getObjectByName('dial');
    if (o) o.quaternion.copy(rest(o).q).multiply(tq.setFromAxisAngle(Y, dialAngle(pose.dial)));
  }
  if (pose.lever !== undefined) {
    const o = root.getObjectByName('lever');
    if (o) o.quaternion.copy(rest(o).q).multiply(tq.setFromAxisAngle(Y, leverAngle(pose.lever)));
  }
  if (pose.lamp !== undefined) {
    const lit = root.getObjectByName('lamp.lit'), unlit = root.getObjectByName('lamp.unlit');
    if (lit) lit.scale.setScalar(pose.lamp ? 1 : HIDDEN);
    if (unlit) unlit.scale.setScalar(pose.lamp ? HIDDEN : 1);
  }
  void m4;
}

/** The same pose on a Piece description (node transforms), for a still built in a pose. */
export function posePiece(root: PieceNode, length: number, rollers: readonly RollerInfo[], pose: BeltPose): void {
  const t = pose.travel ?? 0;
  const byName = new Map(rollers.map((r) => [r.name, r]));
  const turnY = (n: PieceNode, a: number): void => {
    const base = (n as PieceNode & { restTransform?: Matrix4 }).restTransform ?? (n.transform ?? new Matrix4()).clone();
    (n as PieceNode & { restTransform?: Matrix4 }).restTransform = base;
    n.transform = base.clone().multiply(new Matrix4().makeRotationY(a));
  };
  const walk = (n: PieceNode): void => {
    if (n.name === 'seam') n.transform = seamMatrix(length, t);
    const mk = /^mark(\d+)$/.exec(n.name);
    if (mk) n.transform = markMatrix(length, t, Number(mk[1]));
    const r = byName.get(n.name);
    if (r && t !== 0) n.transform = (n.transform ?? new Matrix4()).clone().multiply(new Matrix4().makeRotationZ((-r.sense * t) / r.r));
    if (n.name === 'dial' && pose.dial !== undefined) turnY(n, dialAngle(pose.dial));
    if (n.name === 'lever' && pose.lever !== undefined) turnY(n, leverAngle(pose.lever));
    if (pose.lamp !== undefined && (n.name === 'lamp.lit' || n.name === 'lamp.unlit')) {
      const on = (n.name === 'lamp.lit') === pose.lamp;
      const s = on ? 1 : HIDDEN;
      n.transform = new Matrix4().makeScale(s, s, s);
    }
    for (const c of n.children ?? []) walk(c);
  };
  walk(root);
}
