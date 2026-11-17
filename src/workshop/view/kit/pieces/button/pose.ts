/**
 * poseButton: set the Button's moving nodes from three numbers. Pure
 * transform setting; no simulation logic, no easing, no springs (the view
 * drives it, overshoot included: `press` may go a little below 0).
 */
import { Quaternion, Vector3 } from 'three';
import type { Object3D } from 'three';

export interface ButtonPose {
  /** 0 at rest .. 1 fully pressed (the cap travels POSE.travel down its axis). Clamped to -0.3..1 (a little overshoot up). */
  press?: number;
  /** 0 parked open .. 1 shut over the cap. */
  guard?: number;
  /** The press count on the counter's wheels. Fractional values roll the wheels between digits, odometer style. */
  count?: number;
}

export const POSE = {
  /** Cap travel, world units. */
  travel: 0.06,
  /** Guard angle about the hinge line, degrees: parked open (tilted back past vertical) and shut. */
  guardOpenDeg: -106,
  guardClosedDeg: 0,
  digits: 4,
} as const;

const DEG = Math.PI / 180;
const Y = new Vector3(0, 1, 0);

interface Rest {
  p: Vector3;
  q: Quaternion;
}

/** The node's transform as `realize` made it (remembered on first pose). */
function rest(o: Object3D): Rest {
  const u = o.userData as { buttonRest?: Rest };
  if (!u.buttonRest) u.buttonRest = { p: o.position.clone(), q: o.quaternion.clone() };
  return u.buttonRest;
}

const tq = new Quaternion();
const tv = new Vector3();

/** Rotate a node about its own rest-frame Y by `angle` radians from its rest pose. */
function turn(o: Object3D, angle: number): void {
  const r = rest(o);
  o.quaternion.copy(r.q).multiply(tq.setFromAxisAngle(Y, angle));
}

/** The digit (0..10, fractional while rolling) wheel `i` shows for `count`. */
export function wheelDigit(count: number, i: number): number {
  const c = Math.max(0, count);
  const place = Math.pow(10, i);
  const whole = Math.floor(c / place);
  // a wheel rolls only while every wheel below it is rolling from 9 to 0
  const below = c - whole * place; // 0 .. place
  const roll = i === 0 ? c - Math.floor(c) : Math.max(0, Math.min(1, below - (place - 1)));
  return (whole % 10) + roll;
}

/**
 * Pose a realized Button (the Object3D `realize` made, or any ancestor of
 * it). Moves only `cap`, `guard` and `digit0..3`; anything else is untouched.
 */
export function poseButton(root: Object3D, pose: ButtonPose): void {
  const press = Math.max(-0.3, Math.min(1, pose.press ?? 0));
  const guardT = Math.max(0, Math.min(1, pose.guard ?? 0));
  const cap = root.getObjectByName('cap');
  if (cap) {
    const r = rest(cap);
    // down the cap's own axis (the deck is tilted toward the visitor)
    tv.copy(Y).applyQuaternion(r.q).multiplyScalar(-POSE.travel * press);
    cap.position.copy(r.p).add(tv);
  }
  const guard = root.getObjectByName('guard');
  if (guard) turn(guard, (POSE.guardClosedDeg - POSE.guardOpenDeg) * guardT * DEG);
  const count = pose.count ?? 0;
  for (let i = 0; i < POSE.digits; i++) {
    const w = root.getObjectByName(`digit${i}`);
    if (w) turn(w, -wheelDigit(count, i) * ((Math.PI * 2) / 10));
  }
}
