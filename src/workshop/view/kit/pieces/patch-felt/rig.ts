/**
 * Patch, take A ("the felt puppet"): the rig. Pure pose maths, no geometry:
 * a pose goes in, the local transform of every moving node comes out. No
 * time, no simulation, no animation loop; the view drives it.
 *
 * Node tree (pivots at node origins; every name unique in the piece):
 *
 *   root                    on the stool's seat (y = 0 is the seat top), facing +Z
 *    ├ spine                at the hips: leans (fore / side) and twists the whole upper body
 *    │  ├ head              at the top of the neck: yaw, pitch, tilt
 *    │  │  ├ earL / earR    at each ear's base: flick back (+) / prick forward (-), splay
 *    │  │  ├ browL / browR  at the head's centre: raise (slides the cream brow up the felt), tilt
 *    │  │  ├ lidL / lidR    upper lids, at each eyeball's centre: 0 open .. 1 closed
 *    │  │  ├ lidLowL / lidLowR   lower lids: 0 down .. 1 up (the smug squint)
 *    │  │  ├ pupilL / pupilR     the bead eyes: gaze turns them over the eyeball
 *    │  │  ├ mouthL / mouthR     the two halves of the stitched mouth, at the muzzle's centre: + curls the corner up
 *    │  │  └ boom         the headset's mic boom, at its cup: + swings the mic up
 *    │  ├ armL → forearmL → pawL      (L is Patch's own left, +X, screen right when it faces you)
 *    │  └ armR → forearmR → pawR
 *    └ tail → tail2 → tail3 → tail4   off the back of the seat
 */
import { Matrix4, Quaternion, Vector3 } from 'three';

// ---- dimensions shared by the builder and the rig (world units; 1 = Fetch's body height) ----

/** The stand-in stool's seat height: the real `stool`'s SEAT_Y (Patch's `root` goes on its `seat` socket). */
export const SEAT_H = 0.6;
/** The hips (spine pivot), in root space. */
export const HIPS = { y: 0.07, z: -0.03 } as const;
/** The neck (head pivot), in spine space. */
export const NECK = { y: 0.43, z: 0.035 } as const;
/** The head's centre, in head space: every face feature hangs off this point. */
export const HC: readonly [number, number, number] = [0, 0.165, 0.02];
/** The head's base ellipsoid (half-axes) before the jowls widen it. */
export const HEAD = { a: 0.205, bTop: 0.158, bBot: 0.168, c: 0.178, jowl: 0.16 } as const;
/** The chart radius: face features are drawn in (yaw, pitch) radians times this. */
export const R0 = 0.18;

/** Eyes: chart position (yaw, pitch, radians, + yaw toward Patch's left), eyeball radius, how far it sinks into the head. */
export const EYE = { yaw: 0.41, pitch: 0.07, r: 0.045, sink: 0.014, bead: 0.029 } as const;
/** Upper lid: lip elevation (radians above the eye's centre line) open and closed; the shell's radius over the eyeball. */
export const LID = { open: 0.95, closed: -0.62, t: 0.0075, gap: 0.0035 } as const;
/** Lower lid: lip elevation (below the centre line) down and up. */
export const LID_LOW = { down: -0.95, up: -0.28 } as const;
/** How far the bead can roll from the eye's centre (radians), so it stays on the eyeball's face. */
export const GAZE_MAX = 0.68;

/** The muzzle: its centre in head space and its half-axes (a stuffed cream pod). */
export const MUZZLE = { c: [0, 0.08, 0.15] as const, a: 0.104, b: 0.075, c2: 0.116 } as const;

/** Brows: how far they slide (radians about the head's X axis) and tilt. */
export const BROW = { up: 0.15, down: 0.07, tilt: 0.45 } as const;

/** Shoulders, in spine space; arm segment lengths. */
export const SHOULDER = { x: 0.185, y: 0.325, z: 0.0 } as const;
export const UPPER_ARM = 0.155;
export const FOREARM = 0.14;

/** The tail's root (in root space) and its four segment lengths. */
export const TAIL = { y: 0.085, z: -0.215, segs: [0.15, 0.16, 0.14, 0.13] as const } as const;
/** The head is drawn at one size and carried a little bigger: a toy's head. */
export const HEAD_SCALE = 1.12;

/** The headset: cup centres sit this far out from the head's centre (x), and the boom's pivot. */
export const CUP = { x: 0.212, y: -0.004, z: -0.004, r: 0.066 } as const;

// ---- pose -----------------------------------------------------------------------------

export interface ArmJoints {
  /** Swing forward (+) / back about the shoulder's X. */
  swing: number;
  /** Raise outward (+) / across the body (-). */
  abduct: number;
  /** Twist about the upper arm's own axis (+ turns the elbow outward). */
  twist: number;
  /** Elbow bend: + folds the forearm forward / up. */
  elbow: number;
  /** Wrist: + bends the paw up (back of the paw toward the forearm). */
  wrist: number;
  /** Paw roll about the forearm (+ turns the palm inward). */
  roll: number;
}

export type ArmPreset = 'rest' | 'reach' | 'lean' | 'point' | 'lap' | 'fold';
export const ARM_PRESETS: readonly ArmPreset[] = ['rest', 'reach', 'lean', 'point', 'lap', 'fold'];

export interface Arms {
  left: ArmJoints;
  right: ArmJoints;
}

export interface PatchPose {
  /** The upper body at the hips: [fore (+ toward +Z), side (+ toward +X)] radians, and twist (+ turns the chest toward +X). */
  lean?: [number, number];
  twist?: number;
  /** Head yaw (+ turns the face toward Patch's left, +X), pitch (+ looks up), tilt (+ drops the head toward +X). Radians. */
  headYaw?: number;
  headPitch?: number;
  headTilt?: number;
  /** Bead offset within each eye, -1..1 (x + toward Patch's left, y + up). Clamped to the unit disc. */
  gaze?: [number, number];
  /** Upper lids [left, right]: 0 open .. 1 closed. Half-lidded (0.5) is Patch's rest. */
  lids?: [number, number];
  /** Lower lids [left, right]: 0 down .. 1 up (the squint of a smile). */
  lidsLow?: [number, number];
  /** Brows [left, right]: -1 down hard .. 0 rest .. 1 up. */
  brows?: [number, number];
  /** Brow tilt [left, right]: + lifts the brow's outer end. */
  browTilt?: [number, number];
  /** Mouth corners [left, right]: -1 down .. 0 flat .. 1 curled up. */
  mouth?: [number, number];
  /** Ears [left, right]: -1 pricked forward .. 0 rest .. 1 flattened back. */
  ears?: [number, number];
  /** The mic boom: + swings it up off the mouth (radians). */
  boom?: number;
  /** A preset, a weighted blend of presets, or explicit joints. */
  arms?: ArmPreset | Partial<Record<ArmPreset, number>> | Arms;
  /** Tail: [curl (+ curls the end up and forward), sway (+ swings it toward +X)], radians spread over the segments. */
  tail?: [number, number];
}

const J = (swing: number, abduct: number, twist: number, elbow: number, wrist: number, roll: number): ArmJoints => ({ swing, abduct, twist, elbow, wrist, roll });

/** The arm presets (tuned on the renders). Left is Patch's own left (+X). */
export const PRESETS: Record<ArmPreset, Arms> = {
  // the left paw resting forward on the keyshelf's edge, the right in its lap
  rest: { left: J(0.95, 0.12, -0.25, 0.55, 0.15, 0.6), right: J(0.35, 0.05, 0.2, 1.25, -0.1, 0.9) },
  // the left paw up and out to a jack, the right on its knee
  reach: { left: J(2.0, 0.12, -0.2, 0.35, 0.4, 0.2), right: J(0.35, 0.05, 0.2, 1.25, -0.1, 0.9) },
  // both paws braced on the knees, elbows out (leaning out to look)
  lean: { left: J(0.75, 0.32, -0.6, 0.55, 0.2, 0.9), right: J(0.75, 0.32, -0.6, 0.55, 0.2, 0.9) },
  // the left arm straight out at something, the right in its lap
  point: { left: J(1.35, 0.25, 0, 0.12, 0.05, 0.1), right: J(0.35, 0.05, 0.2, 1.25, -0.1, 0.9) },
  // arms folded across the cardigan: the posture of someone who will get to it in a minute
  fold: { left: J(0.32, 0.22, -1.2, 1.85, 0.1, 0.4), right: J(0.42, 0.24, -1.15, 1.7, 0.1, 0.4) },
  // both paws folded in its lap
  lap: { left: J(0.35, 0.05, 0.2, 1.25, -0.1, 0.9), right: J(0.35, 0.05, 0.2, 1.25, -0.1, 0.9) },
};

/** The neutral pose: the rest the cavity is baked in (eyes open so the lids bake in open air). */
export const NEUTRAL: Required<Omit<PatchPose, 'arms'>> & { arms: ArmPreset } = {
  lean: [0, 0],
  twist: 0,
  headYaw: 0,
  headPitch: 0,
  headTilt: 0,
  gaze: [0, 0],
  lids: [0.5, 0.5],
  lidsLow: [0, 0],
  brows: [0, 0],
  browTilt: [0, 0],
  mouth: [0, 0],
  ears: [0, 0],
  boom: 0,
  arms: 'rest',
  tail: [0, 0],
};

/**
 * How Patch sits at the board in the default layout: its body turned side-on,
 * its own left toward the visitor... see `SIDE_ON`. The named expressions
 * assume this turn (their head yaw brings the face back round to the visitor).
 */
export const SIDE_ON = -1.05;

/**
 * The named expressions. Each must read in a still at 80 px. Patch is
 * unimpressed, faintly amused, and never waves.
 */
export const EXPRESSIONS = {
  // the rest state: half lids, flat brows, a one-sided smirk, looking at you over its shoulder
  unimpressed: {
    lean: [0.02, 0.0],
    twist: 0.05,
    headYaw: 1.1,
    headPitch: 0.24,
    headTilt: 0.1,
    gaze: [0.05, 0.3],
    lids: [0.42, 0.46],
    lidsLow: [0.2, 0.2],
    brows: [-0.35, -0.2],
    browTilt: [-0.2, -0.1],
    mouth: [0.6, -0.1],
    ears: [0.2, 0.1],
    boom: 0,
    arms: 'rest',
    tail: [0.2, 0.0],
  },
  // something is funny, and Patch is not going to admit it: lower lids up, one brow up, smirk both sides, head cocked
  amused: {
    lean: [-0.06, -0.06],
    twist: 0.15,
    headYaw: 1.15,
    headPitch: 0.3,
    headTilt: -0.32,
    gaze: [0.1, 0.35],
    lids: [0.4, 0.46],
    lidsLow: [0.8, 0.7],
    brows: [0.9, -0.15],
    browTilt: [0.35, 0.0],
    mouth: [1, 0.6],
    ears: [-0.3, 0.2],
    boom: 0.1,
    arms: 'fold',
    tail: [0.7, 0.15],
  },
  // the slow sideways stare: head still mostly at the board, the beads slid hard round to the visitor, lids heavy
  'the-look': {
    lean: [0.02, 0],
    twist: -0.05,
    headYaw: 0.6,
    headPitch: 0.12,
    headTilt: -0.08,
    gaze: [1, 0.25],
    lids: [0.5, 0.5],
    lidsLow: [0.45, 0.45],
    brows: [-0.7, -0.4],
    browTilt: [-0.4, 0.1],
    mouth: [-0.2, -0.1],
    ears: [0.6, 0.4],
    boom: 0,
    arms: 'rest',
    tail: [-0.1, 0],
  },
  // attention on the board: face turned to the jacks, a paw up at one, lids level and steady
  working: {
    lean: [0.12, 0],
    twist: 0.0,
    headYaw: 0.1,
    headPitch: 0.15,
    headTilt: 0.05,
    gaze: [0, 0.2],
    lids: [0.35, 0.35],
    lidsLow: [0.1, 0.1],
    brows: [-0.15, -0.15],
    browTilt: [0, 0],
    mouth: [0.2, 0],
    ears: [-0.6, -0.6],
    boom: 0,
    arms: 'reach',
    tail: [0.1, -0.1],
  },
  // leaning out over the knees to look at the bench: head down and round, brows up, lids a little wider
  checking: {
    lean: [0.14, 0.28],
    twist: -0.3,
    headYaw: 0.85,
    headPitch: 0.05,
    headTilt: 0.25,
    gaze: [0.1, -0.55],
    lids: [0.3, 0.3],
    lidsLow: [0.05, 0.05],
    brows: [0.45, 0.35],
    browTilt: [0, 0],
    mouth: [0.1, 0],
    ears: [-0.7, -0.5],
    boom: 0,
    arms: 'lean',
    tail: [0.3, 0.3],
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
const RAxis = (ax: Vector3, a: number): Matrix4 => new Matrix4().makeRotationAxis(ax, a);
const chain = (...ms: Matrix4[]): Matrix4 => {
  const o = new Matrix4();
  for (const m of ms) o.multiply(m);
  return o;
};

/** Unit direction from the head's centre for a chart (yaw, pitch). */
export function chartDir(yaw: number, pitch: number): Vector3 {
  return new Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
}

/** The head's surface radius along a unit direction from its centre (HC). */
export function headRadius(dx: number, dy: number, dz: number): number {
  const b = dy > 0 ? HEAD.bTop : HEAD.bBot;
  // jowls: the lower half widens toward the cheeks (a pear of a face: smug, well fed)
  const low = Math.max(0, -dy);
  const jowl = 1 + HEAD.jowl * Math.exp(-Math.pow((dy + 0.32) / 0.3, 2)) * (0.4 + 0.6 * Math.abs(dx));
  // a slightly flattened face (the features sit on a plane, like a sewn toy's face panel)
  const front = dz > 0 ? 1 - 0.06 * Math.pow(dz, 4) : 1;
  const a = HEAD.a * jowl;
  const r = 1 / Math.sqrt((dx / a) ** 2 + (dy / b) ** 2 + (dz / HEAD.c) ** 2);
  return r * front * (1 - 0.03 * low * low);
}

/** The eye's frame in head space (origin at the eyeball's centre, +Z out of the eye, +X along the head's X). */
export function eyeFrame(side: 1 | -1): Matrix4 {
  const d = chartDir(side * EYE.yaw, EYE.pitch);
  const r = headRadius(d.x, d.y, d.z);
  const c = new Vector3(HC[0], HC[1], HC[2]).addScaledVector(d, r - EYE.sink);
  // the eye looks a little more forward than the surface faces: toy eyes are set to meet yours
  const z = d.clone().add(new Vector3(0, 0, 0.9)).normalize();
  const x = new Vector3(0, 1, 0).cross(z).normalize();
  const y = z.clone().cross(x).normalize();
  return new Matrix4().makeBasis(x, y, z).setPosition(c);
}

/** The muzzle's mouth-axis: where the mouth's centre sits on the muzzle (a direction from its centre). */
export const MOUTH_DIR = new Vector3(0, -0.5, 0.86).normalize();

/** Resolve the `arms` field into joints (a preset, a weighted blend, or explicit). */
export function resolveArms(a: PatchPose['arms']): Arms {
  if (a === undefined) return PRESETS.rest;
  if (typeof a === 'string') return PRESETS[a];
  if ('left' in a && 'right' in a) return a as Arms;
  const w = a as Partial<Record<ArmPreset, number>>;
  let total = 0;
  for (const k of ARM_PRESETS) total += Math.max(0, w[k] ?? 0);
  if (total <= 0) return PRESETS.rest;
  const keys: (keyof ArmJoints)[] = ['swing', 'abduct', 'twist', 'elbow', 'wrist', 'roll'];
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

/** Arm joint limits (they keep the paws out of the body). */
export const ARM_LIMITS: Record<keyof ArmJoints, [number, number]> = {
  swing: [-0.5, 2.0],
  abduct: [-0.25, 1.2],
  twist: [-1.2, 1.2],
  elbow: [0, 2.1],
  wrist: [-0.8, 0.8],
  roll: [-1.6, 1.6],
};

function limitArm(a: ArmJoints): ArmJoints {
  const o = { ...a };
  for (const k of Object.keys(ARM_LIMITS) as (keyof ArmJoints)[]) o[k] = clamp(o[k], ARM_LIMITS[k][0], ARM_LIMITS[k][1]);
  return o;
}

/** Where each ear sits on the head (head space) and its rest orientation. */
export function earBase(side: 1 | -1): Matrix4 {
  const d = chartDir(side * 0.6, 0.86);
  const r = headRadius(d.x, d.y, d.z);
  const p = new Vector3(HC[0], HC[1], HC[2]).addScaledVector(d, r - 0.028);
  // stood up and splayed out a little, facing forward and a touch outward
  return chain(T(p.x, p.y, p.z - 0.01), RY(side * 0.3), RZ(-side * 0.34), RX(-0.1), new Matrix4().makeScale(1.3, 1.3, 1.15));
}

/**
 * Every moving node's local transform for a pose (missing fields are the
 * neutral pose). Pure: same pose, same matrices. `root` is not set: the
 * layout (or the catalogue) places it.
 */
export function poseMatrices(pose: PatchPose = {}): Record<string, Matrix4> {
  const p = { ...NEUTRAL, ...pose };
  const m: Record<string, Matrix4> = {};
  const fore = clamp(p.lean[0], -0.25, 0.45), side = clamp(p.lean[1], -0.35, 0.35);
  m.spine = chain(T(0, HIPS.y, HIPS.z), RZ(-side), RX(fore), RY(clamp(p.twist, -0.6, 0.6)));

  const yaw = clamp(p.headYaw, -1.3, 1.3), pitch = clamp(p.headPitch, -0.5, 0.45), tilt = clamp(p.headTilt, -0.45, 0.45);
  // + pitch looks up: the face (+Z) turns toward +Y, a rotation of -pitch about X
  m.head = chain(T(0, NECK.y, NECK.z), RY(yaw), RX(-pitch), RZ(-tilt), new Matrix4().makeScale(HEAD_SCALE, HEAD_SCALE, HEAD_SCALE));

  for (const [s, nm, i] of [[1, 'L', 0], [-1, 'R', 1]] as const) {
    // ears: + flattens back (about the base's X), and splays out as it goes
    const e = clamp(p.ears[i], -1, 1);
    m[`ear${nm}`] = chain(earBase(s), RX(-e * 0.5), RZ(-s * Math.max(0, e) * 0.35));
    // brows: slide over the felt about the head's centre; tilt about their own direction
    const bv = clamp(p.brows[i], -1, 1);
    const raise = bv > 0 ? bv * BROW.up : bv * BROW.down;
    const bd = chartDir(s * 0.4, 0.36);
    m[`brow${nm}`] = chain(T(HC[0], HC[1], HC[2]), RX(-raise), RAxis(bd, -s * clamp(p.browTilt[i], -1, 1) * BROW.tilt));
    // eyes: upper lid lip from `open` (above) down to `closed`; the lower lid up from `down`
    const F = eyeFrame(s);
    const lt = clamp(p.lids[i], 0, 1), lb = clamp(p.lidsLow[i], 0, 1);
    const topA = LID.open + (LID.closed - LID.open) * lt;
    m[`lid${nm}`] = chain(F, RX(-topA));
    const lowA = LID_LOW.down + (LID_LOW.up - LID_LOW.down) * lb;
    m[`lidLow${nm}`] = chain(F, RX(-lowA));
    let gx = p.gaze[0], gy = p.gaze[1];
    const gl = Math.hypot(gx, gy);
    if (gl > 1) {
      gx /= gl;
      gy /= gl;
    }
    m[`pupil${nm}`] = chain(F, RY(gx * GAZE_MAX), RX(-gy * GAZE_MAX * 0.75));
    // mouth halves turn about the mouth axis through the muzzle's centre: + curls the corner up
    const mv = clamp(p.mouth[i], -1, 1);
    m[`mouth${nm}`] = chain(T(MUZZLE.c[0], MUZZLE.c[1], MUZZLE.c[2]), RAxis(MOUTH_DIR, s * mv * 0.28));
  }
  // the boom swings about the cup's axis (head X)
  m.boom = chain(T(-CUP.x - 0.032, HC[1] + CUP.y, HC[2] + CUP.z), RX(-clamp(p.boom, -0.3, 0.6)));

  const arms = resolveArms(p.arms);
  const arm = (s: 1 | -1, a: ArmJoints, nm: 'L' | 'R'): void => {
    m[`arm${nm}`] = chain(T(s * SHOULDER.x, SHOULDER.y, SHOULDER.z), RZ(s * a.abduct), RX(-a.swing), RY(s * a.twist));
    m[`forearm${nm}`] = chain(T(0, -UPPER_ARM, 0), RX(-a.elbow));
    m[`paw${nm}`] = chain(T(0, -FOREARM, 0), RY(s * a.roll), RX(-a.wrist));
  };
  arm(1, limitArm(arms.left), 'L');
  arm(-1, limitArm(arms.right), 'R');

  // the tail: out of the rump, back over the seat's edge, down, and curling up at the end
  const [curl, sway] = [clamp(p.tail[0], -0.6, 1), clamp(p.tail[1], -0.6, 0.6)];
  const segs = TAIL.segs;
  // the segments are built along their local +Y; the base points back and a little down
  // (+Y of a segment turned by a about X points along (0, cos a, sin a): -1.9 is back and down, -3 straight down)
  m.tail = chain(T(0, TAIL.y, TAIL.z), RZ(-sway * 0.5), RX(-1.75));
  m.tail2 = chain(T(0, segs[0], 0), RZ(-sway * 0.4), RX(-0.95 + curl * 0.2));
  m.tail3 = chain(T(0, segs[1], 0), RZ(-sway * 0.3), RX(0.85 + curl * 0.4));
  m.tail4 = chain(T(0, segs[2], 0), RZ(-sway * 0.3), RX(0.95 + curl * 0.5));
  return m;
}

/** Anything with named children that have a position/quaternion/scale (a realized Object3D). */
interface Posable {
  getObjectByName(name: string): { position: Vector3; quaternion: Quaternion; scale: Vector3 } | undefined;
}

/**
 * Pose a realized Patch (the Object3D `realize` returns, or any ancestor of
 * its nodes): sets every moving node's local transform. `root` is left to
 * the layout.
 */
export function posePatch(root: Posable, pose: PatchPose = {}): void {
  const ms = poseMatrices(pose);
  for (const [name, mat] of Object.entries(ms)) {
    const o = root.getObjectByName(name);
    if (o) mat.decompose(o.position, o.quaternion, o.scale);
  }
}
