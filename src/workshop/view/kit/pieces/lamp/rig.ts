/**
 * The lamp's arm, solved: where the shoulder, elbow and wrist go so that the
 * bulb lands on the stage's key-light position with the shade pointing along
 * its aim. Pure maths (three's vectors only); no geometry here.
 *
 * Coordinates are the lamp piece's own: origin on the bench top at the face
 * of the back wall, straight below the clamp; +Y up, +Z out from the wall
 * toward the visitor, +X to the visitor's right.
 *
 * The arm is three hinges with parallel pins (shoulder, elbow, wrist), so
 * the two arm sections and the shade's axis share one plane. The plane is
 * NOT vertical: from the fixed front camera a vertical plane through the
 * clamp and the bulb is almost edge-on (the clamp is behind the bulb, along
 * the line of sight), and the whole lamp would collapse into one stick. The
 * shoulder sits on a tilted knuckle instead, and the elbow is thrown up and
 * out to the left, so the arm reads as a zigzag from the visitor's side.
 */
import { Matrix4, Vector3 } from 'three';

export type V3 = [number, number, number];

/** Where the stage's key light is (stage/light.ts defaults), and where the lamp is clamped, in world space. */
export const STAGE_BULB: V3 = [-3.6, 5.2, -0.6];
export const STAGE_AIM: V3 = [0.6, 0, -0.1];
/** The clamp's world position: the piece's origin (on the bench top, at the wall face). */
export const LAMP_PLACE: V3 = [-4.5, 0, -5];

/** Fixed dimensions of the lamp (local units). */
export const DIM = {
  /** The wall rail the clamp bites: centre height, distance off the wall, tube radius, length. */
  rail: { y: 1.2, z: 0.2, r: 0.055, len: 1.5 },
  /** The shoulder pivot (top of the riser above the clamp). */
  shoulder: [0, 1.78, 0.24] as V3,
  /** Arm lengths, pivot to pivot. */
  l1: 3.45,
  l2: 3.3,
  /** Wrist pivot to filament, along the shade's axis. */
  neck: 0.95,
  /** Filament to the mouth of the shade, and the mouth's radius (rim half-angle ~65°, wider than the key's 60° cone). */
  mouth: 0.27,
  mouthR: 0.6,
  /** Which way the elbow is thrown (a hint; it is projected onto the circle of solutions). */
  elbowHint: [-0.62, 0.62, -0.45] as V3,
} as const;

export interface ArmSolution {
  shoulder: Vector3;
  elbow: Vector3;
  wrist: Vector3;
  bulb: Vector3;
  /** The shade's axis (unit), the direction the light leaves. */
  axis: Vector3;
  /** The hinge pin direction shared by the three joints (unit). */
  pin: Vector3;
  /** Node transforms (relative to their parents) for root → arm1 → arm2 → shade. */
  arm1: Matrix4;
  arm2: Matrix4;
  shade: Matrix4;
  /** How far the aim leaves the arm's plane (radians): the wrist knuckle's swivel takes it up. */
  aimError: number;
}

/** A node frame: origin `o`, local +X along `x`, local +Y along the pin `y`. */
function frame(o: Vector3, x: Vector3, y: Vector3): Matrix4 {
  const X = x.clone().normalize();
  const Y = y.clone().addScaledVector(X, -y.dot(X)).normalize();
  const Z = new Vector3().crossVectors(X, Y);
  return new Matrix4().makeBasis(X, Y, Z).setPosition(o);
}

/**
 * Solve the arm for a bulb position and an aim point, both in the lamp's
 * local space. Throws if the bulb is out of reach.
 */
export function solveArm(bulbIn: V3, aimPoint: V3): ArmSolution {
  const S = new Vector3(...DIM.shoulder);
  const B = new Vector3(...bulbIn);
  const a0 = new Vector3(...aimPoint).sub(B).normalize();
  let axis = a0.clone();
  let pin = new Vector3(1, 0, 0);
  let W = new Vector3(), E = new Vector3();
  for (let it = 0; it < 6; it++) {
    W = B.clone().addScaledVector(axis, -DIM.neck);
    const d = W.distanceTo(S);
    if (d > DIM.l1 + DIM.l2 - 0.05 || d < Math.abs(DIM.l1 - DIM.l2) + 0.05) throw new Error(`lamp: bulb out of reach (${d.toFixed(2)} from the shoulder)`);
    const u = W.clone().sub(S).normalize();
    const x = (DIM.l1 * DIM.l1 - DIM.l2 * DIM.l2 + d * d) / (2 * d);
    const r = Math.sqrt(Math.max(0, DIM.l1 * DIM.l1 - x * x));
    const hint = new Vector3(...DIM.elbowHint);
    const v = hint.addScaledVector(u, -hint.dot(u)).normalize();
    E = S.clone().addScaledVector(u, x).addScaledVector(v, r);
    pin = new Vector3().crossVectors(E.clone().sub(S), W.clone().sub(E)).normalize();
  }
  // the wrist is a knuckle that also swivels a little about the stem: the shade keeps the exact aim
  axis = a0.clone();
  const planeAxis = a0.clone().addScaledVector(pin, -a0.dot(pin)).normalize();
  const d1 = E.clone().sub(S).normalize();
  const d2 = W.clone().sub(E).normalize();
  const arm1W = frame(S, d1, pin);
  const arm2W = frame(E, d2, pin);
  const shadeW = frame(W, axis, pin);
  const arm2 = arm1W.clone().invert().multiply(arm2W);
  const shade = arm2W.clone().invert().multiply(shadeW);
  return { shoulder: S, elbow: E, wrist: W, bulb: B, axis, pin, arm1: arm1W, arm2, shade, aimError: Math.acos(Math.min(1, planeAxis.dot(a0))) };
}

/** The stage's default key light expressed in the lamp's local space (the lamp clamped at LAMP_PLACE). */
export function stageTarget(place: V3 = LAMP_PLACE): { bulb: V3; aim: V3 } {
  const sub = (p: V3): V3 => [p[0] - place[0], p[1] - place[1], p[2] - place[2]];
  return { bulb: sub(STAGE_BULB), aim: sub(STAGE_AIM) };
}
