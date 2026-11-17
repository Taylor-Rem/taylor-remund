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
 *          ├ head             the swivel ring on the lid: yaw
 *          │  └ headTilt      the yoke pins: pitch, and a little roll
 *          │     └ eye        the front face of the turret (+Z out)
 *          │        ├ pupil   at the lens sphere's centre: gaze turns it so the iris slides over the lens
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
export const WHEEL_R = 0.165;
/** Tyre width (fat). */
export const WHEEL_W = 0.22;
/** Fork crown top, above the axle. */
export const CROWN_TOP = 0.225;
/** Spring length at rest (crown top to the torso's mounting cup). */
export const SPRING_L = 0.095;
/** The torso's built-in forward rake on its spring (radians). */
export const BODY_RAKE = 0.07;
/** How much of the spring's length a full squash takes up. */
export const SQUASH_TRAVEL = 0.45;

/** Torso, in body space (y = 0 is the mounting face under the torso). */
export const TORSO = {
  /** nominal plan size at the top rim, and corner radius */
  w: 0.58,
  d: 0.42,
  rPlan: 0.15,
  /** bottom of the pail, top rim, lid crown */
  y0: 0.03,
  y1: 0.25,
  lidTop: 0.315,
} as const;

/** The turret's swivel: where the head node sits in body space. */
export const SWIVEL = { y: 0.304, z: 0.065 } as const;
/** Turret can: radius, depth, and the yoke pin height above the swivel. */
export const CAN = { r: 0.18, depth: 0.25, pivot: 0.222, front: 0.118 } as const;
/** Eye: lens sphere radius, opening radius at the face plane, and the derived dome height. */
export const EYE = { rs: 0.16, a: 0.115 } as const;
export const EYE_H = EYE.rs - Math.sqrt(EYE.rs * EYE.rs - EYE.a * EYE.a);
/** The lens sphere's centre, in eye space (behind the face plane). */
export const EYE_C = -(EYE.rs - EYE_H);
/** Iris and pupil: angular radii on the lens sphere. */
export const IRIS = { ang: 0.36, pupil: 0.15, lift: 0.003 } as const;
/** Lids: mid-surface radius, thickness, open angle (lip above the centre line). */
export const LID = { r: EYE.rs + 0.0125, t: 0.008, open: 0.95, closed: 0.012 } as const;
/** The angular radius of the bezel's opening, seen from the lens sphere's centre. */
export const BEZEL_OPEN = Math.asin((EYE.a - 0.008) / EYE.rs);
/** Most the gaze can turn the pupil (radians), so the iris stays inside the bezel. */
export const GAZE_MAX = BEZEL_OPEN - IRIS.ang - 0.05;

/** Shoulders, in body space. */
export const SHOULDER = { x: 0.33, y: 0.15, z: 0.035 } as const;
export const UPPER_ARM = 0.12;
export const FOREARM = 0.125;
/** Aerial: base in body space, segment lengths. */
export const AERIAL = { x: -0.205, y: 0.29, z: -0.13, segs: [0.17, 0.15, 0.13] } as const;

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
  rest: { left: J(0.32, 0.16, 0.0, 0.62, 0.0, 0.25), right: J(0.3, 0.14, 0.0, 0.58, 0.0, 0.22) },
  // forearms level in front, hands brought in to a crate's width, jaws open on its sides
  carry: { left: J(0.78, -0.2, -0.25, 0.85, 1.57, 0.55), right: J(0.78, -0.2, -0.25, 0.85, 1.57, 0.55) },
  // both hands held out and up to the visitor, jaws open like cupped palms
  offer: { left: J(1.05, 0.02, 0.0, 0.55, 0.0, 0.95), right: J(1.0, 0.06, 0.0, 0.62, 0.0, 0.95) },
  // right hand to the cap's brim, left at rest
  salute: { left: J(0.3, 0.16, 0.0, 0.6, 0.0, 0.2), right: J(1.25, 0.92, 0.45, 2.15, 0.6, 0.1) },
  // upper arms out, forearms up, jaws open: "who, me?"
  shrug: { left: J(0.15, 0.62, 0.0, 1.75, 0.0, 0.9), right: J(0.15, 0.62, 0.0, 1.75, 0.0, 0.9) },
  // the fumble: arms up and everywhere, unequal
  flail: { left: J(0.9, 1.25, 0.3, 0.55, 0.4, 1.0), right: J(-0.2, 0.95, -0.2, 1.35, -0.3, 0.85) },
};

/** A neutral pose: the rest the cavity is baked in. */
export const NEUTRAL: Required<Omit<FetchPose, 'arms'>> & { arms: ArmPreset } = {
  lean: [0, 0],
  wheel: 0,
  squash: 0,
  headYaw: 0,
  headPitch: 0,
  headRoll: 0,
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
  curious: {
    lean: [0.07, -0.05],
    headYaw: 0.12,
    headPitch: 0.1,
    headRoll: -0.3,
    gaze: [0, 0],
    lids: [0, 0],
    arms: { rest: 0.7, offer: 0.3 },
    aerial: [-0.25, 0.12],
    flag: 0.6,
  },
  eager: {
    lean: [0.17, 0],
    squash: 0.35,
    headYaw: 0,
    headPitch: 0.16,
    headRoll: 0.05,
    gaze: [0, 0.25],
    lids: [0, 0],
    arms: { rest: 0.35, offer: 0.65 },
    aerial: [-0.45, 0.05],
    flag: 1.4,
  },
  oops: {
    lean: [0.12, 0.07],
    squash: 0.5,
    headYaw: 0.18,
    headPitch: -0.34,
    headRoll: 0.16,
    gaze: [0.1, -0.85],
    lids: [0, 0],
    arms: 'flail',
    aerial: [0.4, -0.3],
    flag: 2.6,
  },
  offer: {
    lean: [0.05, 0],
    squash: 0.1,
    headYaw: 0,
    headPitch: 0.24,
    headRoll: 0.2,
    gaze: [0, 0.45],
    lids: [0.18, 0],
    arms: 'offer',
    aerial: [-0.12, 0.08],
    flag: 0.3,
  },
  deadpan: {
    lean: [-0.02, 0],
    headYaw: 0,
    headPitch: -0.04,
    headRoll: 0,
    gaze: [0, -0.1],
    lids: [0.5, 0.3],
    arms: 'rest',
    aerial: [0.08, 0],
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
export const jawAngle = (grip: number): number => 0.05 + clamp(grip, 0, 1) * 0.55;

/**
 * Every moving node's local transform for a pose (missing fields are the
 * neutral pose). Pure: same pose, same matrices.
 */
export function poseMatrices(pose: FetchPose = {}): Record<string, Matrix4> {
  const p = { ...NEUTRAL, ...pose };
  const fore = clamp(p.lean[0], -0.45, 0.45), side = clamp(p.lean[1], -0.35, 0.35);
  const squash = clamp(p.squash, 0, 1);
  const yaw = clamp(p.headYaw, -1.4, 1.4), pitch = clamp(p.headPitch, -0.38, 0.38), roll = clamp(p.headRoll, -0.35, 0.35);
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
  m.headTilt = chain(T(0, CAN.pivot, 0), RZ(-roll), RX(-pitch - BODY_RAKE));
  m.eye = T(0, 0, CAN.front);
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
  m.aerial = chain(T(AERIAL.x, AERIAL.y, AERIAL.z), RX(-0.2 + bx * wts[0]!), RZ(0.1 - bz * wts[0]!));
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
