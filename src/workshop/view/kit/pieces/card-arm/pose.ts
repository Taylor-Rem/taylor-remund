/**
 * poseCardArm: set the card arm's two moving nodes from a few numbers. Pure
 * transform setting; the view supplies the springs and the timing.
 */
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Object3D } from 'three';

export interface CardArmPose {
  /** 0 stowed under the bench .. 1 raised; a little over 1 is the pop's overshoot (clamped to -0.05..1.25). */
  lift?: number;
  /** Lean of the stick, degrees, positive = top back (away from the visitor). */
  lean?: number;
  /** Sway of the stick about the slot, degrees, positive = top to the visitor's left. */
  sway?: number;
  /** Twist of the stick about its own axis, degrees. */
  twist?: number;
  /** Flap of the card in its clip, degrees, positive = top back. */
  flap?: number;
}

export const CARD_POSE = {
  /** The raised pose's lean and flap: the card faces the camera (about 33 degrees above the bench). */
  lean: 22,
  flap: 10,
} as const;

const DEG = Math.PI / 180;
const clampLift = (l: number): number => Math.max(-0.05, Math.min(1.25, l));

const qa = new Quaternion();
const qb = new Quaternion();
const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);

/** The arm node's transform for a pose (pivot at the slot; slides along its own axis). */
export function armTransform(p: CardArmPose, stow: number, out = new Matrix4()): Matrix4 {
  const lift = clampLift(p.lift ?? 1);
  qa.setFromAxisAngle(Z, (p.sway ?? 0) * DEG);
  qa.multiply(qb.setFromAxisAngle(X, -(p.lean ?? CARD_POSE.lean) * DEG));
  qa.multiply(qb.setFromAxisAngle(Y, (p.twist ?? 0) * DEG));
  const along = new Vector3(0, -(1 - lift) * stow, 0).applyQuaternion(qa);
  return out.compose(along, qa, new Vector3(1, 1, 1));
}

/** The card node's transform: its rest place in the clip, flapped about X. */
export function cardTransform(p: CardArmPose, rest: Matrix4, out = new Matrix4()): Matrix4 {
  return out.copy(rest).multiply(new Matrix4().makeRotationX(-(p.flap ?? CARD_POSE.flap) * DEG));
}

interface Rest {
  m: Matrix4;
}
function rest(o: Object3D): Matrix4 {
  const u = o.userData as { cardArmRest?: Rest };
  if (!u.cardArmRest) u.cardArmRest = { m: new Matrix4().compose(o.position, o.quaternion, o.scale) };
  return u.cardArmRest.m;
}

const tm = new Matrix4();

/**
 * Pose a realized card arm (the Object3D `realize` made, or an ancestor).
 * `stow` is `stowDepth(cardH)` of the card it was built with. Hides the arm
 * while it is fully stowed.
 */
export function poseCardArm(root: Object3D, pose: CardArmPose, stow: number): void {
  const arm = root.getObjectByName('arm');
  if (arm) {
    armTransform(pose, stow, tm).decompose(arm.position, arm.quaternion, arm.scale);
    arm.visible = clampLift(pose.lift ?? 1) > 0.001;
  }
  const card = root.getObjectByName('card');
  if (card) {
    const r = rest(card);
    cardTransform(pose, r, tm).decompose(card.position, card.quaternion, card.scale);
  }
}

/** Named poses for the catalogue (`?pose=`). */
export const NAMED_POSES: Readonly<Record<string, CardArmPose>> = {
  raised: {},
  stowed: { lift: 0 },
  half: { lift: 0.55, lean: 6, flap: 2 },
  pop: { lift: 1.12, lean: 8, flap: -10 },
  wobble: { lift: 1, lean: 20, sway: 3, flap: 22 },
};
