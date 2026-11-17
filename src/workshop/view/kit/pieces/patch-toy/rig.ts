/**
 * Patch, take "the enamel figurine": the rig. Pure pose maths, no geometry:
 * a pose goes in, the local transform of every moving node comes out. No
 * time, no simulation, no animation loop, so it is testable and the view
 * drives it.
 *
 * Patch is a jointed tin toy: the head turns on a brass neck rivet, the arms
 * on brass shoulder rivets, the tail in four cast segments. Everything else
 * that moves is on the face: two moving lid shutters, two painted brows,
 * the pupils riding the eyeballs, the ears.
 *
 * Node tree (pivots at node origins; every name is unique in the piece):
 *
 *   root                    the seat top, under the middle of Patch's seat
 *    ├ spine                at the pelvis: lean (fore/aft), twist (yaw), side bend
 *    │  ├ head              the neck rivet: yaw, pitch, tilt
 *    │  │  ├ earL / earR    ear bases: perk (about the ear's own X) and splay (about Z)
 *    │  │  ├ browL / browR  painted brow ridges: raise / lower and tilt
 *    │  │  ├ eyeL / eyeR    eye centres (fixed; the lids and pupils pivot here)
 *    │  │  │  ├ lidL / lidR       upper lid shutters: 0 open .. 1 closed (0.5 is the rest)
 *    │  │  │  └ pupilL / pupilR   the black pupil riding the eyeball: gaze
 *    │  │  └ boom          the mic boom, pivoting at the right earcup
 *    │  ├ armL / armR      shoulder rivets (L = Patch's own left = +X, screen right)
 *    │  │  └ forearmL/R    elbows
 *    │  │     └ pawL/R     wrists
 *    └ tail → tail2 → tail3 → tail4   the ringed tail, hanging off the back of the stool
 */
import { Matrix4, Quaternion, Vector3 } from 'three';

// ---- dimensions shared by the builder and the rig (world units; 1 = Fetch's body height) ----

/** How a view seats Patch at the board: its yaw on the stool (degrees; the board to the visitor's left, Patch side-on to the visitor). The expressions turn the head to the visitor from here. */
export const SIT_YAW = -100;
/** The stool seat Patch sits on (until the real stool lands): its top height above the bench. */
export const SEAT_H = 0.55;
/** The spine pivot (the pelvis) in root space. */
export const PELVIS = { y: 0.07, z: -0.02 } as const;
/** The torso, in spine space: from the seat (y0) to the shoulders' top (y1). Radii of its oval section. */
export const TORSO = { y0: -0.07, y1: 0.37, rx: 0.218, rz: 0.18 } as const;
/** The neck rivet (the head's pivot) in spine space. */
export const NECK = { y: 0.385, z: 0.015 } as const;
/** The head's centre in head space, and the cranium's half-sizes. */
export const HEAD = { y: 0.2, z: 0.02, rx: 0.25, ry: 0.175, rz: 0.2 } as const;
/** Eye centres in head space (L is +X), eyeball radius, and the outward droop of the eye (radians about Z). */
export const EYE = { x: 0.1, y: 0.214, z: 0.198, r: 0.05, droop: 0.2 } as const;
/** How far each eye is turned outward to follow the head's curve (radians). */
export const EYE_YAW = 0.32;
/** The pupil: angular radius on the eyeball. */
export const PUPIL = { ang: 0.62 } as const;
/** Lids: lip angle above the eye's centre line when open and when closed (radians). */
export const LID = { open: 1.35, closed: -0.55, t: 0.009 } as const;
/** Most the gaze can turn the pupil (radians). */
export const GAZE_MAX = 0.6;
/** Brow ridges in head space. */
export const BROW = { x: 0.1, y: 0.292, z: 0.172 } as const;
/** Ear bases in head space. */
export const EAR = { x: 0.172, y: 0.33, z: 0.01 } as const;
/** Earcups (the headset) in head space: their centres on the head's flanks. */
export const CUP = { x: 0.286, y: 0.2, z: -0.015, r: 0.072 } as const;
/** Shoulders in spine space. */
export const SHOULDER = { x: 0.198, y: 0.29, z: 0.0 } as const;
export const UPPER_ARM = 0.15;
export const FOREARM = 0.14;
/** Tail base in root space, and its four segment lengths. */
export const TAIL = { y: 0.06, z: -0.2, segs: [0.15, 0.14, 0.13, 0.12] } as const;

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
  /** Wrist: + curls the paw down / in. */
  wrist: number;
}

export type ArmPreset = 'rest' | 'reach' | 'lean' | 'point';
export const ARM_PRESETS: readonly ArmPreset[] = ['rest', 'reach', 'lean', 'point'];

/** Both arms. Left is Patch's own left (+X, screen right when it faces you). */
export interface Arms {
  left: ArmJoints;
  right: ArmJoints;
}

export interface PatchPose {
  /** The spine: [lean, twist, side] radians. lean + bends toward the visitor (+Z); twist + turns the chest toward +X; side + toward +X. */
  spine?: [number, number, number];
  /** Head yaw (+ turns the face toward +X, Patch's left), pitch (+ looks up), tilt (+ tips the crown toward +X). Radians. */
  headYaw?: number;
  headPitch?: number;
  headTilt?: number;
  /** Pupil offset within the eye, -1..1 each (x + toward Patch's left / screen right, y + up). Clamped to the unit disc. */
  gaze?: [number, number];
  /** Upper lids [left, right]: 0 open .. 1 closed. 0.5 is the half-lidded rest. */
  lids?: [number, number];
  /** Brows [left, right]: -1 pulled down flat .. 0 rest .. 1 raised. */
  brows?: [number, number];
  /** Ears [left, right]: -1 laid back .. 0 rest .. 1 pricked forward. */
  ears?: [number, number];
  /** A preset, a weighted blend of presets, or explicit joints. */
  arms?: ArmPreset | Partial<Record<ArmPreset, number>> | Arms;
  /** Tail: [curl, swing]. curl 0 hangs .. 1 curled up round; swing + carries it toward +X. */
  tail?: [number, number];
  /** The mic boom swung down (+) or up (-) from its rest, radians. */
  boom?: number;
}

const J = (swing: number, abduct: number, twist: number, elbow: number, wrist: number): ArmJoints => ({ swing, abduct, twist, elbow, wrist });

/** The arm presets (tuned by eye on the renders). */
export const PRESETS: Record<ArmPreset, Arms> = {
  // one paw out on the board's ledge (the left), the other in the lap
  rest: { left: J(1.2, 0.1, 0.2, 0.35, 0.3), right: J(0.35, 0.05, 0.25, 1.15, 0.45) },
  // the left paw up and out to a jack, the right braced on the knee
  reach: { left: J(1.75, 0.25, 0.1, 0.25, 0.1), right: J(0.35, 0.12, 0.3, 1.05, 0.5) },
  // leaning out: the left paw braced on the stool's edge, the right on its own knee
  lean: { left: J(-0.15, 0.38, 0.1, 0.25, 0.4), right: J(0.5, 0.05, 0.3, 1.0, 0.5) },
  // the left arm out level with one claw pointing; the right in the lap
  point: { left: J(1.45, 0.42, 0.0, 0.12, -0.15), right: J(0.35, 0.05, 0.25, 1.15, 0.45) },
};

/** A neutral pose: the rest the cavity is baked in (head forward, arms down a little, tail hanging). */
export const NEUTRAL: Required<Omit<PatchPose, 'arms'>> & { arms: Arms } = {
  spine: [0, 0, 0],
  headYaw: 0,
  headPitch: 0,
  headTilt: 0,
  gaze: [0, 0],
  lids: [0.5, 0.5],
  brows: [0, 0],
  ears: [0, 0],
  arms: { left: J(0.3, 0.12, 0, 0.6, 0.2), right: J(0.3, 0.12, 0, 0.6, 0.2) },
  tail: [0.35, 0],
  boom: 0,
};

/**
 * The named expressions. Each must read in a still picture. Patch is never
 * excited: the range runs from flat to faintly amused, and the whole
 * character is in how far the lids come down and which way the pupils slide.
 */
export const EXPRESSIONS = {
  // the default: side-on at the board, the head turned right round over the left shoulder to the visitor,
  // chin up a little, lids heavy, one brow a hair lower. "Yes?"
  unimpressed: {
    spine: [0.03, 0.3, 0],
    headYaw: 1.2,
    headPitch: 0.1,
    headTilt: 0.08,
    gaze: [0.15, 0.2],
    lids: [0.55, 0.5],
    brows: [-0.35, -0.05],
    ears: [-0.1, 0],
    arms: 'rest',
    tail: [0.35, 0.1],
    boom: 0,
  },
  // faintly amused: the same turn, head cocked, one brow up, the lids eased into a smug squint
  amused: {
    spine: [0.0, 0.32, 0.05],
    headYaw: 1.15,
    headPitch: 0.16,
    headTilt: -0.24,
    gaze: [0.2, 0.25],
    lids: [0.62, 0.66],
    brows: [0.85, -0.3],
    ears: [0.25, -0.2],
    arms: 'rest',
    tail: [0.6, -0.2],
    boom: 0,
  },
  // the look: the head stays on the board, only the pupils slide hard round to the visitor, lids low, brows flat
  'the-look': {
    spine: [-0.02, 0.05, 0],
    headYaw: 0.8,
    headPitch: 0.24,
    headTilt: 0.12,
    gaze: [1, 0.35],
    lids: [0.5, 0.56],
    brows: [-0.65, 0.35],
    ears: [-0.55, -0.3],
    arms: 'rest',
    tail: [0.2, 0],
    boom: 0,
  },
  // working: chin down to the board, eyes down on the jack, lids relaxed (attention, not interest), ears forward
  working: {
    spine: [0.12, -0.05, 0],
    headYaw: 0.6,
    headPitch: -0.3,
    headTilt: 0.05,
    gaze: [0, -0.6],
    lids: [0.4, 0.4],
    brows: [-0.1, -0.1],
    ears: [0.45, 0.3],
    arms: { left: { swing: 1.2, abduct: 0.1, twist: 0.1, elbow: 0.6, wrist: 0.3 }, right: { swing: 0.35, abduct: 0.12, twist: 0.3, elbow: 1.05, wrist: 0.5 } },
    tail: [0.3, 0.15],
    boom: 0.05,
  },
  // checking: leaning right out over its left side toward the bench, head down and round, brows up, eyes wider
  checking: {
    spine: [0.1, 0.3, 0.16],
    headYaw: 1.25,
    headPitch: -0.4,
    headTilt: 0.2,
    gaze: [0.2, -0.7],
    lids: [0.25, 0.25],
    brows: [0.45, 0.4],
    ears: [0.55, 0.5],
    arms: 'lean',
    tail: [0.45, -0.35],
    boom: 0,
  },
} satisfies Record<string, PatchPose>;

export type ExpressionName = keyof typeof EXPRESSIONS;
export const EXPRESSION_NAMES = Object.keys(EXPRESSIONS) as ExpressionName[];

// ---- pose → transforms ------------------------------------------------------------------

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const T = (x: number, y: number, z: number): Matrix4 => new Matrix4().makeTranslation(x, y, z);
const RX = (a: number): Matrix4 => new Matrix4().makeRotationX(a);
const RY = (a: number): Matrix4 => new Matrix4().makeRotationY(a);
const RZ = (a: number): Matrix4 => new Matrix4().makeRotationZ(a);
const chain = (...ms: Matrix4[]): Matrix4 => {
  const o = new Matrix4();
  for (const m of ms) o.multiply(m);
  return o;
};

/** Resolve the `arms` field into joints (a preset, a weighted blend, or explicit). */
export function resolveArms(a: PatchPose['arms']): Arms {
  if (a === undefined) return NEUTRAL.arms;
  if (typeof a === 'string') return PRESETS[a];
  if ('left' in a && 'right' in a) return a as Arms;
  const w = a as Partial<Record<ArmPreset, number>>;
  let total = 0;
  for (const k of ARM_PRESETS) total += Math.max(0, w[k] ?? 0);
  if (total <= 0) return NEUTRAL.arms;
  const keys: (keyof ArmJoints)[] = ['swing', 'abduct', 'twist', 'elbow', 'wrist'];
  const side = (s: 'left' | 'right'): ArmJoints => {
    const o = J(0, 0, 0, 0, 0);
    for (const k of ARM_PRESETS) {
      const f = Math.max(0, w[k] ?? 0) / total;
      if (f === 0) continue;
      for (const key of keys) o[key] += PRESETS[k][s][key] * f;
    }
    return o;
  };
  return { left: side('left'), right: side('right') };
}

/** Arm joint limits. */
export const ARM_LIMITS: Record<keyof ArmJoints, [number, number]> = {
  swing: [-0.6, 2.4],
  abduct: [-0.25, 1.4],
  twist: [-1.2, 1.2],
  elbow: [0, 2.2],
  wrist: [-0.8, 1.0],
};

function limitArm(a: ArmJoints): ArmJoints {
  const o = { ...a };
  for (const k of Object.keys(ARM_LIMITS) as (keyof ArmJoints)[]) o[k] = clamp(o[k], ARM_LIMITS[k][0], ARM_LIMITS[k][1]);
  return o;
}

/** The lid's lip angle (above the eye's centre line) for a lid value 0 open .. 1 closed. */
export const lidAngle = (v: number): number => LID.open + (LID.closed - LID.open) * clamp(v, 0, 1);

/**
 * Every moving node's local transform for a pose (missing fields are the
 * neutral pose). Pure: same pose, same matrices.
 */
export function poseMatrices(pose: PatchPose = {}): Record<string, Matrix4> {
  const p = { ...NEUTRAL, ...pose };
  const [lean, twist, side] = p.spine;
  const yaw = clamp(p.headYaw, -1.5, 1.5), pitch = clamp(p.headPitch, -0.5, 0.45), tilt = clamp(p.headTilt, -0.4, 0.4);
  let gx = p.gaze[0], gy = p.gaze[1];
  const gl = Math.hypot(gx, gy);
  if (gl > 1) {
    gx /= gl;
    gy /= gl;
  }
  const arms = resolveArms(p.arms);
  const L = limitArm(arms.left), R = limitArm(arms.right);
  const m: Record<string, Matrix4> = {};

  m.root = new Matrix4();
  m.spine = chain(T(0, PELVIS.y, PELVIS.z), RY(clamp(twist, -0.6, 0.6)), RZ(-clamp(side, -0.4, 0.4)), RX(clamp(lean, -0.3, 0.45)));
  // + pitch looks up: the face (+Z) turns toward +Y, a rotation of -pitch about X; + tilt tips the crown toward +X
  m.head = chain(T(0, NECK.y, NECK.z), RY(yaw), RX(-pitch), RZ(-tilt));

  for (const [s, nm, k] of [[1, 'L', 0], [-1, 'R', 1]] as const) {
    // the eyes droop outward (the bored slant): about Z, + for the left eye tips its outer corner down
    m[`eye${nm}`] = chain(T(s * EYE.x, EYE.y, EYE.z), RY(s * EYE_YAW), RZ(-s * EYE.droop));
    m[`lid${nm}`] = RX(-lidAngle(p.lids[k]));
    // gaze turns the pupil on the eyeball, in the head's frame: undo the eye's own slant and
    // outward turn (most of it: a hair of wall-eye reads friendlier than a squint), then look
    m[`pupil${nm}`] = chain(RZ(s * EYE.droop), RY(-s * EYE_YAW * 0.85), RY(gx * GAZE_MAX), RX(-gy * GAZE_MAX * 0.8));
    const b = clamp(p.brows[k], -1, 1);
    // a raised brow lifts and arches (its inner end up); a lowered one drops flat and slants in
    m[`brow${nm}`] = chain(T(s * BROW.x, BROW.y + b * 0.022, BROW.z + Math.max(0, -b) * 0.006), RZ(s * (0.16 + b * 0.16)));
    const e = clamp(p.ears[k], -1, 1);
    m[`ear${nm}`] = chain(T(s * EAR.x, EAR.y, EAR.z), RZ(-s * (0.36 - e * 0.1)), RX(e * 0.35), RY(s * (0.25 - e * 0.12)));
  }
  m.boom = chain(T(-(CUP.x + 0.03), CUP.y, CUP.z), RX(clamp(p.boom, -0.4, 0.4)));

  const arm = (s: 1 | -1, a: ArmJoints, nm: 'L' | 'R'): void => {
    // s = +1 for the left arm (+X). Abduction raises outward: about Z by +a for the left, -a for the right.
    m[`arm${nm}`] = chain(T(s * SHOULDER.x, SHOULDER.y, SHOULDER.z), RZ(s * a.abduct), RX(-a.swing), RY(s * a.twist));
    m[`forearm${nm}`] = chain(T(0, -UPPER_ARM, 0), RX(-a.elbow));
    m[`paw${nm}`] = chain(T(0, -FOREARM, 0), RX(-a.wrist));
  };
  arm(1, L, 'L');
  arm(-1, R, 'R');

  const [curl, swing] = p.tail;
  const c = clamp(curl, 0, 1), sw = clamp(swing, -1, 1);
  const segs = TAIL.segs;
  // rest: out backward from under the seat and down, each segment curling a little more toward the visitor (+Z) at the tip
  // (a segment is built hanging along -Y; + about X swings its tip back, toward -Z)
  m.tail = chain(T(0, TAIL.y, TAIL.z), RY(sw * 0.5), RX(1.25 + c * 0.15));
  m.tail2 = chain(T(0, -segs[0], 0), RX(-0.45 - c * 0.35), RZ(sw * 0.15));
  m.tail3 = chain(T(0, -segs[1], 0), RX(-0.5 - c * 0.5), RZ(sw * 0.2));
  m.tail4 = chain(T(0, -segs[2], 0), RX(-0.5 - c * 0.65), RZ(sw * 0.25));
  return m;
}

/** Anything with named children that have a position/quaternion/scale (a realized Object3D). */
interface Posable {
  getObjectByName(name: string): { position: Vector3; quaternion: Quaternion; scale: Vector3 } | undefined;
}

/**
 * Pose a realized Patch (the Object3D `realize` returns, or any ancestor of
 * its nodes): sets every moving node's local transform. Pure apart from
 * writing those transforms.
 */
export function posePatch(root: Posable, pose: PatchPose = {}): void {
  const ms = poseMatrices(pose);
  for (const [name, mat] of Object.entries(ms)) {
    if (name === 'root') continue;
    const o = root.getObjectByName(name);
    if (o) mat.decompose(o.position, o.quaternion, o.scale);
  }
}
