/**
 * poseUndoLever: set the UNDO lever's moving nodes from a few numbers. Pure
 * transform setting; no simulation logic, no easing, no springs (the view
 * drives it, overshoot included: `pull` may go a little past 0 and 1).
 *
 * Nodes (each pivot at its node's origin; hinges turn about the node's local
 * +Y, sliders travel along its local +X, as kit/types.ts asks):
 *  - `lever`  the lever, about the pivot pin (local +Y is world +Z, toward the
 *             visitor). Home leans right; a pull swings it left through
 *             LEVER.travelDeg.
 *  - `latch`  (under `lever`) the brass catch handle beside the grip, about
 *             its hinge at the grip's top: a squeeze closes it on the grip.
 *  - `catch`  (under `lever`) the catch block and its rod, sliding up the
 *             lever when the latch is squeezed (lifting the pin out of the
 *             quadrant's notch).
 *  - `spring` the return spring, from its anchor on the deck to the lug on
 *             the lever, aimed at the lug (never scaled). Under it,
 *             `spring.ring0`.. are its coils and `spring.end` its far hook,
 *             moved apart along its local +X: the coils spread visibly as the
 *             lever is pulled, and close up again at home.
 *  - `lamp.lit` / `lamp.unlit` (under `lamp`): the little amber lamp, lit
 *             while there is something to undo; posing swaps their scales.
 */
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { PieceNode } from '../../types.ts';

export interface UndoPose {
  /** 0 home .. 1 pulled all the way (clamped to -0.15..1.1: a little overshoot either way). */
  pull?: number;
  /** 0 free .. 1 the catch handle squeezed against the grip. */
  latch?: number;
  /** The lamp lit (something to undo). */
  lamp?: boolean;
}

const DEG = Math.PI / 180;

/** The lever's fixed geometry, shared by the builder and the poser (root space, world units). */
export const LEVER = {
  /** The pivot pin's centre. */
  pivot: [0, 0.7, -0.055] as const,
  /** The lever's angle about +Z at home, degrees (negative: the top leans right). */
  homeDeg: -24,
  /** Its travel to fully pulled, degrees (the top swings left). */
  travelDeg: 58,
  /** Pivot to the top of the grip's ball finial, along the lever. */
  length: 1.32,
  /** The spring's lug: its distance along the lever from the pivot, and its z (behind the bars). */
  lugR: 0.3,
  lugZ: -0.145,
  /** The spring's anchor on the deck (root space). */
  anchor: [0.5, 0.56, -0.145] as const,
  /** The catch handle's squeeze, degrees, and the catch block's travel up the lever. */
  latchDeg: 9,
  catchTravel: 0.035,
  /** The spring's coils: how many rings, and how far the hooks reach in from each end. */
  rings: 7,
  hook: 0.06,
} as const;

/** Scale of a hidden twin (a lamp's unlit or lit body). */
export const HIDDEN = 1e-4;

/** The lever's angle about +Z (radians) for a pull 0..1. */
export function leverAngle(pull: number): number {
  const p = Math.max(-0.15, Math.min(1.1, pull));
  return (LEVER.homeDeg + LEVER.travelDeg * p) * DEG;
}

/** Where the spring's lug is (root space) with the lever at `angle` (radians about +Z). */
export function lugAt(angle: number): Vector3 {
  const [px, py] = LEVER.pivot;
  // the lever's +Y turned by `angle` about +Z
  return new Vector3(px - Math.sin(angle) * LEVER.lugR, py + Math.cos(angle) * LEVER.lugR, LEVER.lugZ);
}

/** The spring at rest (home), as built: its length from anchor to lug. */
export function springRestLength(): number {
  const a = new Vector3(...LEVER.anchor);
  return lugAt(leverAngle(0)).distanceTo(a);
}

/** The spring's length (anchor to lug) with the lever at `angle`. */
export function springLength(angle: number): number {
  const a = new Vector3(...LEVER.anchor);
  return lugAt(angle).distanceTo(a);
}

/**
 * The spring node's transform (in root space) with the lever at `angle`: at the anchor, its local +X aimed
 * at the lug. It is never stretched: its coils (`spring.ring<k>`) and far hook (`spring.end`) are moved
 * apart along +X instead, so the turns SPREAD as the lever is pulled (`ringX`).
 */
export function springMatrix(angle: number): Matrix4 {
  const a = new Vector3(...LEVER.anchor);
  const d = lugAt(angle).sub(a);
  const rot = Math.atan2(d.y, d.x);
  return new Matrix4().makeTranslation(a.x, a.y, a.z).multiply(new Matrix4().makeRotationZ(rot));
}

/** Where coil `k` sits along the spring (its local +X) for a spring `len` long: evenly between the hooks. */
export function ringX(k: number, len: number): number {
  const n = LEVER.rings;
  return LEVER.hook + ((len - 2 * LEVER.hook) * (k + 0.5)) / n;
}

/** Named poses for the catalogue (`?pose=`): what the view will show. */
export const NAMED_POSES: Readonly<Record<string, UndoPose>> = {
  home: {},
  lit: { lamp: true },
  squeezed: { latch: 1, lamp: true },
  quarter: { latch: 1, pull: 0.25, lamp: true },
  half: { latch: 1, pull: 0.5, lamp: true },
  'three-quarter': { latch: 1, pull: 0.75, lamp: true },
  pulled: { latch: 1, pull: 1, lamp: true },
  overshoot: { latch: 0.4, pull: 1.08, lamp: true },
};

/** The new local matrix of every moving node, given its rest local matrix. */
function targets(pose: UndoPose, rest: (name: string) => Matrix4 | null): Map<string, Matrix4> {
  const out = new Map<string, Matrix4>();
  const pull = pose.pull ?? 0;
  const latch = Math.max(0, Math.min(1, pose.latch ?? 0));
  const alpha = leverAngle(pull) - leverAngle(0);
  const r = (n: string): Matrix4 | null => rest(n);
  const lever = r('lever');
  if (lever) out.set('lever', lever.clone().multiply(new Matrix4().makeRotationY(alpha)));
  const lt = r('latch');
  if (lt) out.set('latch', lt.clone().multiply(new Matrix4().makeRotationY(LEVER.latchDeg * DEG * latch)));
  const ct = r('catch');
  if (ct) out.set('catch', ct.clone().multiply(new Matrix4().makeTranslation(LEVER.catchTravel * latch, 0, 0)));
  if (r('spring')) out.set('spring', springMatrix(leverAngle(pull)));
  const len = springLength(leverAngle(pull));
  for (let k = 0; k < LEVER.rings; k++) {
    const rk = r(`spring.ring${k}`);
    if (rk) out.set(`spring.ring${k}`, new Matrix4().makeTranslation(ringX(k, len), 0, 0).multiply(new Matrix4().extractRotation(rk)));
  }
  if (r('spring.end')) out.set('spring.end', new Matrix4().makeTranslation(len, 0, 0));
  const on = pose.lamp ?? false;
  if (r('lamp.lit')) out.set('lamp.lit', new Matrix4().makeScale(...(on ? [1, 1, 1] : [HIDDEN, HIDDEN, HIDDEN]) as [number, number, number]));
  if (r('lamp.unlit')) out.set('lamp.unlit', new Matrix4().makeScale(...(on ? [HIDDEN, HIDDEN, HIDDEN] : [1, 1, 1]) as [number, number, number]));
  return out;
}

const MOVING: readonly string[] = ['lever', 'latch', 'catch', 'spring', 'spring.end', ...Array.from({ length: LEVER.rings }, (_, k) => `spring.ring${k}`), 'lamp.lit', 'lamp.unlit'];

/**
 * Pose a realized UNDO lever (the Object3D `realize` made, or any ancestor of
 * it). Moves only the nodes listed above; anything else is untouched.
 */
export function poseUndoLever(root: Object3D, pose: UndoPose): void {
  const objs = new Map<string, Object3D>();
  for (const n of MOVING) {
    const o = root.getObjectByName(n);
    if (o) objs.set(n, o);
  }
  const t = targets(pose, (n) => {
    const o = objs.get(n);
    if (!o) return null;
    const u = o.userData as { undoRest?: Matrix4 };
    u.undoRest ??= new Matrix4().compose(o.position, o.quaternion, o.scale);
    return u.undoRest;
  });
  const p = new Vector3(), q = new Quaternion(), s = new Vector3();
  for (const [n, m] of t) {
    const o = objs.get(n)!;
    m.decompose(p, q, s);
    o.position.copy(p);
    o.quaternion.copy(q);
    o.scale.copy(s);
  }
}

/**
 * The same pose applied to a Piece description (its node transforms), for a
 * still built in a pose. Call once on a freshly built piece (the cavity bake
 * stays at rest).
 */
export function posePiece(root: PieceNode, pose: UndoPose): void {
  const nodes = new Map<string, PieceNode>();
  const walk = (n: PieceNode): void => {
    nodes.set(n.name, n);
    for (const c of n.children ?? []) walk(c);
  };
  walk(root);
  const t = targets(pose, (n) => {
    const node = nodes.get(n);
    return node ? (node.transform ?? new Matrix4()) : null;
  });
  for (const [n, m] of t) nodes.get(n)!.transform = m;
}
