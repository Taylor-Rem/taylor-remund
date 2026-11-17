/**
 * Fetch, take B ("the Porter"): the rig. Pure pose maths, no geometry: a
 * pose goes in, the local transform of every moving node comes out. No time,
 * no simulation, no animation loop, so it is testable and the view drives it.
 *
 * Node tree (pivots at node origins; every name is unique in the piece):
 *
 *   root                      on the bench, under the tyre
 *    └ lean                   at the axle: tilts everything fore/aft and side to side
 *       ├ wheel               spins about its local Y (= the axle, world X at rest)
 *       ├ suspension          the coil spring: scales along its own Y when squashed
 *       └ body                the lunch-pail torso, riding on the spring
 *          ├ head             the swivel ring on the lid and its periscope mast: yaw
 *          │  └ headCock      the knuckle atop the mast, carrying the yoke: roll (a cock of the head)
 *          │     └ headTilt   the yoke's pins, at the can's centre: pitch (a nod)
 *          │        ├ brow    the cap's peak, about the can's axis: + pulls it down flat, - shoots it up
 *          │        └ eye     the front face of the turret (+Z out)
 *          │           ├ pupil   at the lens sphere's centre: gaze turns it so the iris slides over the lens
 *          │           │  └ pupilDot  the black pupil: scales in the eye plane (dilate / pinpoint)
 *          │        ├ lidTop  at the same centre: rotates about X to close
 *          │        └ lidBottom
 *          ├ armL / armR      shoulders (L = Fetch's own left = +X, screen right)
 *          │  └ forearmL/R    elbows
 *          │     └ handL/R    wrists
 *          │        ├ pincerL0/L1, pincerR0/R1   the two jaws (open about the hand's Z)
 *          └ aerial → aerial2 → aerial3 → flag → flagTip
 */
import { Matrix4, Quaternion, Vector3 } from 'three';

// ---- dimensions shared by the builder and the rig (world units, 1 = Fetch's body height) ----

/** Tyre radius: the axle height. */
export const WHEEL_R = 0.155;
/** Tyre width (fat). */
export const WHEEL_W = 0.22;
/** Fork crown top, above the axle. */
export const CROWN_TOP = 0.212;
/** Spring length at rest (crown top to the torso's mounting cup). */
export const SPRING_L = 0.09;
/** The torso's built-in forward rake on its spring (radians). */
export const BODY_RAKE = 0.07;
/** How much of the spring's length a full squash takes up. */
export const SQUASH_TRAVEL = 0.45;

/** Torso, in body space (y = 0 is the mounting face under the torso). */
export const TORSO = {
  /** nominal plan size at the top rim, and corner radius */
  w: 0.55,
  d: 0.38,
  rPlan: 0.145,
  /** bottom of the pail, top rim, lid crown */
  y0: 0.03,
  y1: 0.235,
  lidTop: 0.298,
} as const;

/** The turret's swivel: where the head node sits in body space. */
export const SWIVEL = { y: 0.288, z: 0.055 } as const;
/** The periscope mast: from the swivel up to the knuckle the turret nods on. */
export const NECK = 0.078;
/** Turret can: radius, depth, and the yoke pin height above the swivel. */
/** Turret can: radius, depth, its centre (the yoke pins) above the knuckle, and its front face ahead of the centre. */
export const CAN = { r: 0.185, depth: 0.25, c: 0.245, front: 0.118 } as const;
/** Eye: lens sphere radius, opening radius at the face plane, and the derived dome height. */
export const EYE = { rs: 0.162, a: 0.12 } as const;
export const EYE_H = EYE.rs - Math.sqrt(EYE.rs * EYE.rs - EYE.a * EYE.a);
/** The lens sphere's centre, in eye space (behind the face plane). */
export const EYE_C = -(EYE.rs - EYE_H);
/** Iris and pupil: angular radii on the lens sphere. */
export const IRIS = { ang: 0.4, pupil: 0.2, lift: 0.003 } as const;
/** Lids: mid-surface radius, thickness, open angle (lip above the centre line). */
export const LID = { r: EYE.rs + 0.0125, t: 0.008, open: 0.95, closed: 0.012 } as const;
/** The angular radius of the bezel's opening, seen from the lens sphere's centre. */
export const BEZEL_OPEN = Math.asin((EYE.a - 0.008) / EYE.rs);
/** Most the gaze can turn the pupil (radians), so the iris stays inside the bezel. */
export const GAZE_MAX = BEZEL_OPEN - IRIS.ang - 0.025;

/** How far the brow travels (radians): down onto the eye, and up off it. */
export const BROW = { down: 0.45, up: 0.42 } as const;

/** Shoulders, in body space. */
export const SHOULDER = { x: 0.315, y: 0.15, z: 0.03 } as const;
export const UPPER_ARM = 0.13;
export const FOREARM = 0.13;
/** Aerial: base in body space, segment lengths. */
export const AERIAL = { x: -0.205, y: 0.275, z: -0.12, segs: [0.17, 0.15, 0.13] } as const;

// ---- pose -----------------------------------------------------------------------------

export interface ArmJoints {
  /** Swing forward (+) / back about the shoulder's X. */
  swing: number;
  /** Raise outward (+) / across the body (-). */
  abduct: number;
  /** Twist about the upper arm's own axis (+ turns the elbow outward). */
  twist: number;
  /** Elbow bend: + folds the forearm forward/up. */
  elbow: number;
  /** Wrist roll about the forearm's axis. */
  wrist: number;
  /** Pincers: 0 closed .. 1 wide open. */
  grip: number;
}

export type ArmPreset = 'rest' | 'carry' | 'offer' | 'salute' | 'shrug' | 'flail';
export const ARM_PRESETS: readonly ArmPreset[] = ['rest', 'carry', 'offer', 'salute', 'shrug', 'flail'];

/** Both arms. Left is Fetch's own left (+X). */
export interface Arms {
  left: ArmJoints;
  right: ArmJoints;
}

export interface FetchPose {
  /** [fore, side] radians about the axle: fore + tips the top toward the visitor (+Z); side + toward +X. */
  lean?: [number, number];
  /** Wheel spin, radians. */
  wheel?: number;
  /** 0 rest .. 1 the spring fully compressed. */
  squash?: number;
  /** Turret yaw (+ turns the eye toward +X, Fetch's left) and pitch (+ looks up). Radians. */
  headYaw?: number;
  headPitch?: number;
  /** Cock of the turret in its yoke (+ tips the top toward +X). Radians, small. */
  headRoll?: number;
  /** The cap's peak: -1 shot up (surprise) .. 0 rest .. 1 pulled down flat over the eye (deadpan, a frown). */
  brow?: number;
  /** Pupil size: 0.55 pinpoint .. 1 rest .. 1.35 dilated. */
  pupilSize?: number;
  /** Pupil offset within the eye, -1..1 each (x + toward Fetch's left / screen right, y + up). Clamped to the unit disc. */
  gaze?: [number, number];
  /** [top, bottom] 0 open .. 1 closed. */
  lids?: [number, number];
  /** A preset, a weighted blend of presets, or explicit joints. */
  arms?: ArmPreset | Partial<Record<ArmPreset, number>> | Arms;
  /** Aerial bend, radians spread over its three segments: [about X (+ whips forward), about Z (+ toward +X)]. */
  aerial?: [number, number];
  /** Flag flutter phase, radians. */
  flag?: number;
}

const J = (swing: number, abduct: number, twist: number, elbow: number, wrist: number, grip: number): ArmJoints => ({ swing, abduct, twist, elbow, wrist, grip });

/** The arm presets (tuned by eye on the renders). */
export const PRESETS: Record<ArmPreset, Arms> = {
  // hanging a little forward and out, elbows soft, jaws ajar: ready
  rest: { left: J(0.42, 0.2, -0.35, 0.95, -0.3, 0.3), right: J(0.38, 0.18, -0.35, 0.9, -0.3, 0.25) },
  // forearms level in front, hands brought in to a crate's width, jaws open on its sides
  carry: { left: J(0.78, -0.2, -0.25, 0.85, 1.57, 0.55), right: J(0.78, -0.2, -0.25, 0.85, 1.57, 0.55) },
  // both hands held out and up to the visitor, jaws open like cupped palms
  offer: { left: J(1.15, 0.1, -0.5, 0.45, -1.1, 1.0), right: J(1.1, 0.14, -0.5, 0.5, -1.1, 1.0) },
  // right hand to the cap's brim, left at rest
  salute: { left: J(0.3, 0.16, 0.0, 0.6, 0.0, 0.2), right: J(1.25, 0.92, 0.45, 2.15, 0.6, 0.1) },
  // upper arms out, forearms up, jaws open: "who, me?"
  shrug: { left: J(0.2, 0.75, -0.9, 1.9, 0.0, 0.9), right: J(0.2, 0.75, -0.9, 1.9, 0.0, 0.9) },
  // the fumble: arms up and everywhere, unequal
  flail: { left: J(2.0, 1.25, 0.4, 0.35, 0.6, 1.0), right: J(1.0, 1.55, -0.6, 1.2, -0.4, 0.85) },
};

/** A neutral pose: the rest the cavity is baked in. */
export const NEUTRAL: Required<Omit<FetchPose, 'arms'>> & { arms: ArmPreset } = {
  lean: [0, 0],
  wheel: 0,
  squash: 0,
  headYaw: 0,
  headPitch: 0,
  headRoll: 0,
  brow: 0,
  pupilSize: 1,
  gaze: [0, 0],
  lids: [0, 0],
  arms: 'rest',
  aerial: [0, 0],
  flag: 0,
};

/**
 * The named expressions. Each must read in a still picture. `lean` carries
 * the temperament: Fetch always tips a little forward, keen to go.
 */
export const EXPRESSIONS = {
  // head cocked hard over, peak lifted, big pupil looking right at the visitor, a claw at its "chin": hm?
  curious: {
    lean: [0.1, -0.12],
    squash: 0.15,
    headYaw: 0.15,
    headPitch: 0.34,
    headRoll: -0.42,
    brow: -0.55,
    pupilSize: 1.3,
    gaze: [0.35, 0.3],
    lids: [0, 0.12],
    arms: { left: J(0.42, 0.2, -0.35, 0.95, -0.3, 0.3), right: J(0.75, 0.1, 0.5, 2.1, 0.4, 0.25) },
    aerial: [-0.35, 0.55],
    flag: 0.6,
  },
  // crouched on its spring and tipped hard forward, eye up and dilated, both claws up and open: let me, let me
  eager: {
    lean: [0.36, 0],
    squash: 0.8,
    headYaw: 0,
    headPitch: 0.5,
    headRoll: 0.06,
    brow: -0.35,
    pupilSize: 1.35,
    gaze: [0, 0.75],
    lids: [0, 0],
    arms: { left: J(2.15, 0.55, -0.4, 0.45, 0, 1.0), right: J(2.1, 0.5, -0.4, 0.55, 0, 1.0) },
    aerial: [-0.95, 0.05],
    flag: 1.4,
  },
  // just fumbled: everything up, peak shot up, eye wide open with a pinpoint pupil hard down at the crate
  oops: {
    lean: [0.2, 0.16],
    squash: 0.55,
    headYaw: 0.2,
    headPitch: -0.45,
    headRoll: 0.28,
    brow: -1,
    pupilSize: 0.55,
    gaze: [0.1, -1],
    lids: [0, 0],
    arms: 'flail',
    aerial: [0.75, -0.6],
    flag: 2.6,
  },
  // looking up at the visitor, both claws held out open, a sorry tilt, lower lid up in a soft smile
  offer: {
    lean: [0.12, 0.05],
    squash: 0.25,
    headYaw: -0.05,
    headPitch: 0.5,
    headRoll: 0.34,
    brow: 0.25,
    pupilSize: 1.2,
    gaze: [-0.2, 0.7],
    lids: [0.15, 0.45],
    arms: 'offer',
    aerial: [-0.2, 0.3],
    flag: 0.3,
  },
  // a flat slot of an eye under a pulled-down peak, staring straight at the visitor; arms limp, aerial flopped over
  deadpan: {
    lean: [-0.05, 0],
    headYaw: 0,
    headPitch: 0.32,
    headRoll: 0,
    brow: 1,
    pupilSize: 0.85,
    gaze: [0, 0.1],
    lids: [0.84, 0.62],
    arms: { left: J(0.0, 0.06, 0, 0.1, 0, 0.05), right: J(0.0, 0.06, 0, 0.1, 0, 0.05) },
    aerial: [1.3, -0.8],
    flag: 0,
  },
} satisfies Record<string, FetchPose>;

export type ExpressionName = keyof typeof EXPRESSIONS;
export const EXPRESSION_NAMES = Object.keys(EXPRESSIONS) as ExpressionName[];

// ---- pose → transforms ------------------------------------------------------------------

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const T = (x: number, y: number, z: number): Matrix4 => new Matrix4().makeTranslation(x, y, z);
const RX = (a: number): Matrix4 => new Matrix4().makeRotationX(a);
const RY = (a: number): Matrix4 => new Matrix4().makeRotationY(a);
const RZ = (a: number): Matrix4 => new Matrix4().makeRotationZ(a);
const S = (x: number, y: number, z: number): Matrix4 => new Matrix4().makeScale(x, y, z);
const chain = (...ms: Matrix4[]): Matrix4 => {
  const o = new Matrix4();
  for (const m of ms) o.multiply(m);
  return o;
};

/** Resolve the `arms` field into joints (a preset, a weighted blend, or explicit). */
export function resolveArms(a: FetchPose['arms']): Arms {
  if (a === undefined) return PRESETS.rest;
  if (typeof a === 'string') return PRESETS[a];
  if ('left' in a && 'right' in a) return a as Arms;
  const w = a as Partial<Record<ArmPreset, number>>;
  let total = 0;
  for (const k of ARM_PRESETS) total += Math.max(0, w[k] ?? 0);
  if (total <= 0) return PRESETS.rest;
  const keys: (keyof ArmJoints)[] = ['swing', 'abduct', 'twist', 'elbow', 'wrist', 'grip'];
  const side = (s: 'left' | 'right'): ArmJoints => {
    const o = J(0, 0, 0, 0, 0, 0);
    for (const k of ARM_PRESETS) {
      const f = Math.max(0, w[k] ?? 0) / total;
      if (f === 0) continue;
      for (const key of keys) o[key] += PRESETS[k][s][key] * f;
    }
    return o;
  };
  return { left: side('left'), right: side('right') };
}

/** Arm joint limits (they keep the hands outside the body and the jaws inside their travel). */
export const ARM_LIMITS: Record<keyof ArmJoints, [number, number]> = {
  swing: [-0.6, 2.2],
  abduct: [-0.3, 1.6],
  twist: [-1.6, 1.6],
  elbow: [0, 2.3],
  wrist: [-1.6, 1.6],
  grip: [0, 1],
};

function limitArm(a: ArmJoints): ArmJoints {
  const o = { ...a };
  for (const k of Object.keys(ARM_LIMITS) as (keyof ArmJoints)[]) o[k] = clamp(o[k], ARM_LIMITS[k][0], ARM_LIMITS[k][1]);
  return o;
}

/** Jaw opening angle for a grip value. */
export const jawAngle = (grip: number): number => 0.04 + clamp(grip, 0, 1) * 0.5;

/**
 * Every moving node's local transform for a pose (missing fields are the
 * neutral pose). Pure: same pose, same matrices.
 */
export function poseMatrices(pose: FetchPose = {}): Record<string, Matrix4> {
  const p = { ...NEUTRAL, ...pose };
  const fore = clamp(p.lean[0], -0.45, 0.45), side = clamp(p.lean[1], -0.35, 0.35);
  const squash = clamp(p.squash, 0, 1);
  const yaw = clamp(p.headYaw, -1.4, 1.4), pitch = clamp(p.headPitch, -0.45, 0.5), roll = clamp(p.headRoll, -0.42, 0.42);
  let gx = p.gaze[0], gy = p.gaze[1];
  const gl = Math.hypot(gx, gy);
  if (gl > 1) {
    gx /= gl;
    gy /= gl;
  }
  const lt = clamp(p.lids[0], 0, 1), lb = clamp(p.lids[1], 0, 1);
  const arms = resolveArms(p.arms);
  const L = limitArm(arms.left), R = limitArm(arms.right);
  const m: Record<string, Matrix4> = {};

  m.root = new Matrix4();
  m.lean = chain(T(0, WHEEL_R, 0), RZ(-side), RX(fore));
  m.wheel = chain(RZ(-Math.PI / 2), RY(p.wheel));
  const k = 1 - squash * SQUASH_TRAVEL;
  m.suspension = chain(T(0, CROWN_TOP, 0), S(1, k, 1));
  // the torso rides raked a little forward on its spring: keen, top-heavy, wants to go
  m.body = chain(T(0, CROWN_TOP + SPRING_L * k, 0), RX(BODY_RAKE));
  m.head = chain(T(0, SWIVEL.y, SWIVEL.z), RY(yaw));
  // + pitch looks up: the eye (+Z) turns toward +Y, which is a rotation of -pitch about X
  // (the body's rake is taken out here, so a pitch of 0 looks level)
  m.headCock = chain(T(0, NECK, 0), RZ(-roll));
  m.headTilt = chain(T(0, CAN.c, 0), RX(-pitch - BODY_RAKE));
  // + brow pulls the peak forward and down over the eye (a rotation of + about X carries the top toward +Z)
  m.brow = RX(clamp(p.brow, -1, 1) * (p.brow > 0 ? BROW.down : BROW.up));
  m.eye = T(0, 0, CAN.front);
  const ps = clamp(p.pupilSize, 0.55, 1.35);
  m.pupilDot = S(ps, ps, 1);
  const ga = GAZE_MAX;
  m.pupil = chain(T(0, 0, EYE_C), RY(gx * ga), RX(-gy * ga));
  // lids: their lips sit at +open (top) / -open (bottom) above/below the centre line when open
  const topA = LID.open + (LID.closed - LID.open) * lt;
  const botA = LID.open + (LID.closed - LID.open) * lb;
  m.lidTop = chain(T(0, 0, EYE_C), RX(-topA));
  m.lidBottom = chain(T(0, 0, EYE_C), RX(botA));

  const arm = (s: 1 | -1, a: ArmJoints, nm: 'L' | 'R'): void => {
    // s = +1 for the left arm (+X). Abduction raises outward: about Z by +a for the left, -a for the right.
    m[`arm${nm}`] = chain(T(s * SHOULDER.x, SHOULDER.y, SHOULDER.z), RZ(s * a.abduct), RX(-a.swing), RY(s * a.twist));
    m[`forearm${nm}`] = chain(T(0, -UPPER_ARM, 0), RX(-a.elbow));
    m[`hand${nm}`] = chain(T(0, -FOREARM, 0), RY(s * a.wrist));
    const j = jawAngle(a.grip);
    m[`pincer${nm}0`] = chain(T(0.02, -0.044, 0), RZ(j));
    m[`pincer${nm}1`] = chain(T(-0.02, -0.044, 0), RZ(-j));
  };
  arm(1, L, 'L');
  arm(-1, R, 'R');

  const [bx, bz] = p.aerial;
  const wts = [0.25, 0.35, 0.4];
  const segs = AERIAL.segs;
  // rest: the aerial rakes back and out a little
  m.aerial = chain(T(AERIAL.x, AERIAL.y, AERIAL.z), RX(-0.22 + bx * wts[0]!), RZ(0.2 - bz * wts[0]!));
  m.aerial2 = chain(T(0, segs[0], 0), RX(bx * wts[1]!), RZ(-bz * wts[1]!));
  m.aerial3 = chain(T(0, segs[1], 0), RX(bx * wts[2]!), RZ(-bz * wts[2]!));
  // the pennant trails out to Fetch's right and back; it flutters about the aerial
  const f = p.flag;
  m.flag = chain(T(0, segs[2] - 0.012, 0), RY(-2.35 + 0.28 * Math.sin(f)));
  m.flagTip = chain(T(0.085, 0, 0), RY(0.35 * Math.sin(f - 1.1)));
  return m;
}

/** Anything with named children that have a position/quaternion/scale (a realized Object3D). */
interface Posable {
  getObjectByName(name: string): { position: Vector3; quaternion: Quaternion; scale: Vector3 } | undefined;
}

/**
 * Pose a realized Fetch (the Object3D `realize` returns, or any ancestor of
 * its nodes): sets every moving node's local transform. Pure apart from
 * writing those transforms.
 */
export function poseFetch(root: Posable, pose: FetchPose = {}): void {
  const ms = poseMatrices(pose);
  for (const [name, mat] of Object.entries(ms)) {
    const o = root.getObjectByName(name);
    if (o) mat.decompose(o.position, o.quaternion, o.scale);
  }
}
