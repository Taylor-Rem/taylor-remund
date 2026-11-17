/**
 * Fetch, take A ("the Bulb"): the rig. Dimensions, the node tree and its
 * pivots, the pose type, the arm presets, the named expressions, and
 * `poseFetch` (pose in, node transforms out: no time, no simulation).
 *
 * Design space: the piece is designed upright, facing +Z, resting on y = 0,
 * with every node's pivot a plain point (the wheel's adds a turn so its
 * local Y is the axle, the kit's convention for things that spin). The rest
 * attitude (the bulb tipped forward, the body leaning into the next errand)
 * is part of the REST pose, not of the geometry, so every node keeps a clean
 * pivot and a still at rest is just `poseFetch(root, {})`.
 *
 * Units: radians for every angle in a pose; gaze and lids are 0..1 / -1..1.
 */
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { Piece, PieceNode } from '../../types.ts';

const DEG = Math.PI / 180;

// ---- dimensions (design space, world units; 1 = Fetch's body height) -------

export const DIM = {
  /** The tyre: outer radius, width; the axle sits at the tyre's radius. */
  tyreR: 0.18,
  tyreW: 0.235,
  get axleY(): number {
    return this.tyreR;
  },
  /** Fork legs stand outside the tyre at ±forkX; the crown's top face. */
  forkX: 0.17,
  crownTop: 0.414,
  /** The neck (spring) runs from the crown to the body (the yoke). */
  bodyY: 0.468,
  /** The head's pivot: the bulb's base, sitting in the yoke. */
  headY: 0.502,
  /**
   * The bulb, in head space: neck radius and height, equator height and radius, top;
   * the face is pressed flat in front of faceZ (softly, over faceSoft).
   */
  bulb: { neckR: 0.1, neckY: 0.045, eqY: 0.3, rMax: 0.318, top: 0.555, faceZ: 0.232, faceSoft: 0.07 },
  /** The eye, in head space: centre of the lens sphere, its radius, its cap, and how far its axis looks up. */
  eye: { y: 0.3, z: 0.258, R: 0.18, capDeg: 51, upDeg: 14 },
  /** Arms: shoulder pivot (body space, +X side), segment lengths. */
  shoulder: { x: 0.24, y: 0.03, z: 0.07 },
  upperArm: 0.15,
  forearm: 0.15,
  hand: 0.09,
  /** Aerial: base (head space), direction, three segments. */
  aerial: { base: [-0.14, 0.49, -0.12] as [number, number, number], dir: [-0.24, 1, -0.32] as [number, number, number], seg: 0.135 },
  /** Most the spring compresses at squash 1. */
  squashTravel: 0.045,
} as const;

/** Eye derived sizes (eye space: origin at the lens sphere centre, +Z out of the face). */
export function eyeDims() {
  const R = DIM.eye.R;
  const cap = DIM.eye.capDeg * DEG;
  const lensBaseR = R * Math.sin(cap);
  const zb = R * Math.cos(cap) + 0.001; // the bezel's rear plane (just in front of the lens base)
  const lidTopR = R + 0.011;
  const lidBotR = R + 0.0065;
  const lip = 0.0055;
  const boreR = Math.sqrt((lidTopR + lip) ** 2 - zb * zb) + 0.004;
  return {
    R,
    cap,
    lensBaseR,
    zb,
    zFront: zb + 0.036,
    boreR,
    bezelR: boreR + 0.044,
    lidTopR,
    lidBotR,
    lip,
    irisR: 0.083,
    pupilR: 0.038,
    /** The angle the lids open to (edge elevation, from the eye axis). */
    lidOpen: 54 * DEG,
  };
}

// ---- the node tree ----------------------------------------------------------

export const NODE_NAMES = [
  'root', 'lean', 'wheel', 'spring', 'suspension', 'body', 'head', 'eye', 'pupil', 'lidTop', 'lidBottom', 'brow',
  'armL', 'forearmL', 'handL', 'pincerLa', 'pincerLb', 'armR', 'forearmR', 'handR', 'pincerRa', 'pincerRb',
  'aerial', 'aerial2', 'aerial3', 'flag',
] as const;
export type NodeName = (typeof NODE_NAMES)[number];

/** Parent of each node. */
export const PARENT: Record<Exclude<NodeName, 'root'>, NodeName> = {
  lean: 'root',
  wheel: 'lean',
  spring: 'lean',
  suspension: 'lean',
  body: 'suspension',
  head: 'body',
  eye: 'head',
  pupil: 'eye',
  lidTop: 'eye',
  lidBottom: 'eye',
  brow: 'eye',
  armL: 'body',
  forearmL: 'armL',
  handL: 'forearmL',
  pincerLa: 'handL',
  pincerLb: 'handL',
  armR: 'body',
  forearmR: 'armR',
  handR: 'forearmR',
  pincerRa: 'handR',
  pincerRb: 'handR',
  aerial: 'head',
  aerial2: 'aerial',
  aerial3: 'aerial2',
  flag: 'aerial3',
};

const v = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);
const Tm = (p: Vector3): Matrix4 => new Matrix4().makeTranslation(p.x, p.y, p.z);

/** Unit aerial direction and the rotation that turns +Y onto it. */
export function aerialFrame(): { dir: Vector3; q: Quaternion } {
  const d = v(...DIM.aerial.dir).normalize();
  return { dir: d, q: new Quaternion().setFromUnitVectors(v(0, 1, 0), d) };
}

/**
 * Each node's frame in design space (upright, no pose): the matrix that
 * carries the node's local space to the piece's root space. Geometry is
 * designed in root space and brought into a node with the inverse.
 */
export function designFrames(): Record<NodeName, Matrix4> {
  const f = {} as Record<NodeName, Matrix4>;
  f.root = new Matrix4();
  f.lean = Tm(v(0, DIM.axleY, 0));
  f.wheel = Tm(v(0, DIM.axleY, 0)).multiply(new Matrix4().makeRotationZ(-Math.PI / 2)); // local +Y = world +X (the axle)
  f.spring = Tm(v(0, DIM.crownTop, 0));
  f.suspension = Tm(v(0, DIM.crownTop, 0));
  f.body = Tm(v(0, DIM.bodyY, 0));
  f.head = Tm(v(0, DIM.headY, 0));
  const C = v(0, DIM.headY + DIM.eye.y, DIM.eye.z);
  // the eye's axis looks a little up out of the face (the camera is above)
  f.eye = Tm(C).multiply(new Matrix4().makeRotationX(-DIM.eye.upDeg * DEG));
  f.pupil = f.eye.clone();
  f.lidTop = f.eye.clone();
  f.lidBottom = f.eye.clone();
  {
    const e = eyeDims();
    // the brow's hinge: on top of the eye's barrel, a little behind the bezel
    f.brow = f.eye.clone().multiply(Tm(v(0, e.bezelR + 0.016, e.zb - 0.085)));
  }
  for (const side of ['L', 'R'] as const) {
    const s = side === 'L' ? 1 : -1;
    const sh = v(s * DIM.shoulder.x, DIM.bodyY + DIM.shoulder.y, DIM.shoulder.z);
    f[`arm${side}`] = Tm(sh);
    const el = sh.clone().add(v(0, -DIM.upperArm, 0));
    f[`forearm${side}`] = Tm(el);
    const wr = el.clone().add(v(0, -DIM.forearm, 0));
    f[`hand${side}`] = Tm(wr);
    const jaw = wr.clone().add(v(0, -0.04, 0));
    f[`pincer${side}a`] = Tm(jaw);
    f[`pincer${side}b`] = Tm(jaw);
  }
  const { q, dir } = aerialFrame();
  const base = v(DIM.aerial.base[0], DIM.headY + DIM.aerial.base[1], DIM.aerial.base[2]);
  const R = new Matrix4().makeRotationFromQuaternion(q);
  const seg = DIM.aerial.seg;
  f.aerial = Tm(base).multiply(R);
  f.aerial2 = Tm(base.clone().addScaledVector(dir, seg)).multiply(R);
  f.aerial3 = Tm(base.clone().addScaledVector(dir, seg * 2)).multiply(R);
  f.flag = Tm(base.clone().addScaledVector(dir, seg * 3 - 0.012)).multiply(R);
  return f;
}

// ---- poses --------------------------------------------------------------------

/** One arm's joints (radians). Mirrored for the right arm, so presets read the same for both. */
export interface ArmJoints {
  /** Swing forward about the shoulder (0 = hanging down, π/2 = pointing at the visitor). */
  swing: number;
  /** Out to the side (abduction). */
  out: number;
  /** Twist of the upper arm about its own axis (positive turns the forearm outward). */
  twist: number;
  /** Elbow bend (forward). */
  elbow: number;
  /** Wrist bend (forward). */
  wrist: number;
  /** Pincer opening, 0 shut .. 1 wide. */
  grip: number;
}

export type ArmPreset = 'rest' | 'carry' | 'offer' | 'salute' | 'shrug' | 'flail';

const J = (swing: number, out: number, twist: number, elbow: number, wrist: number, grip: number): ArmJoints => ({
  swing: swing * DEG,
  out: out * DEG,
  twist: twist * DEG,
  elbow: elbow * DEG,
  wrist: wrist * DEG,
  grip,
});

/** The arm presets, [left, right]. Left is Fetch's left: the +X side, the visitor's right. */
export const ARM_PRESETS: Record<ArmPreset, readonly [ArmJoints, ArmJoints]> = {
  // hanging a little forward, elbows bent, pincers loosely shut
  rest: [J(26, 36, 16, 58, 14, 0.25), J(22, 33, 10, 64, 10, 0.3)],
  // forearms level and forward, hands at crate width
  carry: [J(30, 6, -8, 70, -6, 0.35), J(30, 6, -8, 70, -6, 0.35)],
  // both hands out to the visitor, out past the eye, a little up, pincers open
  offer: [J(95, 30, -30, 22, -36, 0.9), J(90, 28, -28, 26, -34, 0.85)],
  // right hand up to the eye's brim; left at rest
  salute: [J(26, 36, 16, 58, 14, 0.25), J(5, 128, 40, 62, 20, 0.0)],
  // elbows out, forearms up, open hands
  shrug: [J(14, 72, -76, 100, -22, 0.95), J(14, 70, -76, 102, -22, 0.95)],
  // up and everywhere, not symmetric
  flail: [J(40, 105, -50, 70, -10, 1.0), J(15, 80, -30, 35, 25, 0.7)],
};

export interface FetchPose {
  /** Lean of everything above the axle: [forward, toward +X] (radians), added to the rest lean. */
  lean: [number, number];
  /** Wheel turn (radians). */
  wheel: number;
  /** Spring compression, 0..1. */
  squash: number;
  /** Head turn toward +X (radians). */
  headYaw: number;
  /** Head pitch, positive = looking up (radians), added to the bulb's rest tip. */
  headPitch: number;
  /** Head cock toward +X (radians): the curious tilt. Not in the brief's list; optional. */
  headRoll: number;
  /** Pupil offset in the eye, x toward +X, y up, each -1..1 (clamped to the unit disc). */
  gaze: [number, number];
  /** Lid shutters, 0 open .. 1 closed (top and bottom meet at 1, 1). */
  lids: [number, number];
  /** The brow visor over the eye: [lift (+ up: surprise; − down over the eye: a frown), slant (+ lowers its +X end)] in radians. Optional. */
  brow: [number, number];
  /** Iris size, 0.55 (a pinprick: surprise, focus) .. 1 (normal). Optional. */
  iris: number;
  /** Slant of each lid's edge about the eye's axis (radians, + lowers its +X end): a brow without a brow. Optional. */
  lidTilt: [number, number];
  /** Arms: a preset, a weighted blend of presets, or explicit joints [left, right]. */
  arms: ArmPreset | Partial<Record<ArmPreset, number>> | readonly [ArmJoints, ArmJoints];
  /** Aerial bend at its base: [toward +X (about Z), toward +Z (about X)] in radians; spread over its three segments. */
  aerial: [number, number];
  /** Flag flutter phase (radians). */
  flag: number;
}

/** The rest attitude: what `{}` means. */
export const REST: Readonly<FetchPose> = {
  lean: [0, 0],
  wheel: 0,
  squash: 0,
  headYaw: 0,
  headPitch: 0,
  headRoll: 0,
  gaze: [0, 0],
  lids: [0.34, 0.16],
  lidTilt: [0, 0],
  brow: [0, 0],
  iris: 1,
  arms: 'rest',
  aerial: [0, 0],
  flag: 0,
};

/** The bulb's built-in forward tip and the body's built-in keen lean (radians). */
export const REST_TIP = 7 * DEG;
export const REST_LEAN = 4 * DEG;
/** How far the pupil can travel (radians about the lens centre) at |gaze| = 1. */
export const GAZE_MAX = 21 * DEG;

export type Expression = 'curious' | 'eager' | 'oops' | 'offer' | 'deadpan';

/** The named expressions, as poses. Each must read in a still. */
export const EXPRESSIONS: Record<Expression, Partial<FetchPose>> = {
  // head cocked hard, one side of the brow up, eye wide, pupil right up at the camera (in front and above)
  curious: { lean: [-3 * DEG, 6 * DEG], headYaw: -16 * DEG, headPitch: 12 * DEG, headRoll: 19 * DEG, gaze: [0.45, 0.85], lids: [0.04, 0], brow: [0.24, 0.3], arms: { rest: 0.5, offer: 0.5 }, aerial: [-0.3, -0.1], flag: 0.6 },
  // thrown forward on a loaded spring, grinning (bottom lid up), brow up, arms up, aerial flat back
  eager: { lean: [19 * DEG, 0], squash: 0.75, headPitch: 10 * DEG, gaze: [0, 0.6], lids: [0.08, 0.5], brow: [0.28, 0], arms: { offer: 0.75, shrug: 0.25 }, aerial: [0.05, -0.85], flag: 1.4 },
  // just fumbled: rocked back, eye a full circle with a pinprick iris, brow shot up, staring down at the crate, arms flung
  oops: { lean: [-14 * DEG, -6 * DEG], squash: 0.2, headPitch: -20 * DEG, headYaw: 10 * DEG, headRoll: -10 * DEG, gaze: [0.2, -1], lids: [0, 0], iris: 0.58, brow: [0.42, -0.1], arms: 'flail', aerial: [-0.45, 0.4], flag: 2.6 },
  // looking up at the visitor, both hands out, brow and lid slanted: sorry about that; aerial drooped
  offer: { lean: [7 * DEG, -4 * DEG], headPitch: 20 * DEG, headRoll: -16 * DEG, gaze: [-0.1, 1], lids: [0.3, 0.22], lidTilt: [0.34, -0.1], brow: [0.1, -0.33], arms: 'offer', aerial: [0.2, 0.85], flag: 0.2 },
  // a slot: lids nearly meeting, brow down on the lid, dead level, unbothered
  deadpan: { lean: [-1 * DEG, 0], headPitch: -3 * DEG, headYaw: 4 * DEG, gaze: [0.15, -0.1], lids: [0.66, 0.5], brow: [-0.15, 0], arms: { rest: 1 }, aerial: [0.04, 0.05], flag: 0 },
};

/** Resolve the arms field to explicit joints [left, right]. */
export function armJoints(arms: FetchPose['arms']): [ArmJoints, ArmJoints] {
  if (Array.isArray(arms)) return [{ ...arms[0]! }, { ...arms[1]! }];
  const w: Partial<Record<ArmPreset, number>> = typeof arms === 'string' ? { [arms]: 1 } : (arms as Partial<Record<ArmPreset, number>>);
  let total = 0;
  for (const k of Object.keys(w) as ArmPreset[]) total += Math.max(0, w[k] ?? 0);
  if (total <= 0) return [{ ...ARM_PRESETS.rest[0] }, { ...ARM_PRESETS.rest[1] }];
  const out: [ArmJoints, ArmJoints] = [J(0, 0, 0, 0, 0, 0), J(0, 0, 0, 0, 0, 0)];
  for (const k of Object.keys(w) as ArmPreset[]) {
    const a = Math.max(0, w[k] ?? 0) / total;
    const p = ARM_PRESETS[k];
    for (let s = 0; s < 2; s++) {
      const o = out[s]!, q = p[s]!;
      o.swing += q.swing * a;
      o.out += q.out * a;
      o.twist += q.twist * a;
      o.elbow += q.elbow * a;
      o.wrist += q.wrist * a;
      o.grip += q.grip * a;
    }
  }
  return out;
}

/** The pose with defaults filled, gaze clamped to the unit disc and every range clamped. */
export function resolvePose(p: Partial<FetchPose> = {}): FetchPose {
  const r: FetchPose = { ...REST, ...p } as FetchPose;
  const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
  let [gx, gy] = r.gaze;
  const gl = Math.hypot(gx, gy);
  if (gl > 1) {
    gx /= gl;
    gy /= gl;
  }
  return {
    ...r,
    lean: [clamp(r.lean[0], -0.6, 0.6), clamp(r.lean[1], -0.5, 0.5)],
    squash: clamp(r.squash, 0, 1),
    headYaw: clamp(r.headYaw, -1.2, 1.2),
    headPitch: clamp(r.headPitch, -0.45, 0.45),
    headRoll: clamp(r.headRoll, -0.35, 0.35),
    gaze: [gx, gy],
    lids: [clamp(r.lids[0], 0, 1), clamp(r.lids[1], 0, 1)],
    lidTilt: [clamp(r.lidTilt[0], -0.45, 0.45), clamp(r.lidTilt[1], -0.45, 0.45)],
    brow: [clamp(r.brow[0], -0.16, 0.42), clamp(r.brow[1], -0.35, 0.35)],
    iris: clamp(r.iris, 0.55, 1),
    aerial: [clamp(r.aerial[0], -0.9, 0.9), clamp(r.aerial[1], -0.9, 0.9)],
  };
}

const euler = (x: number, y: number, z: number, order: 'XYZ' | 'ZXY' | 'YXZ' = 'XYZ'): Matrix4 => new Matrix4().makeRotationFromEuler(new Euler(x, y, z, order));

/**
 * The local transform of every node (relative to its parent) for a pose.
 * Pure: the same pose gives the same matrices.
 */
export function poseMatrices(pose: Partial<FetchPose> = {}): Record<NodeName, Matrix4> {
  const p = resolvePose(pose);
  const F = designFrames();
  const rel = (n: Exclude<NodeName, 'root'>): Matrix4 => F[PARENT[n]].clone().invert().multiply(F[n]);
  const out = {} as Record<NodeName, Matrix4>;
  out.root = new Matrix4();
  // lean about the axle: forward tips the top toward +Z (about +X), side toward +X (about -Z)
  out.lean = rel('lean').multiply(new Matrix4().makeRotationZ(-p.lean[1])).multiply(new Matrix4().makeRotationX(REST_LEAN + p.lean[0]));
  out.wheel = rel('wheel').multiply(new Matrix4().makeRotationY(p.wheel));
  const sq = p.squash * DIM.squashTravel;
  const springH = DIM.bodyY - DIM.crownTop;
  out.spring = rel('spring').multiply(new Matrix4().makeScale(1, (springH - sq) / springH, 1));
  out.suspension = rel('suspension').multiply(new Matrix4().makeTranslation(0, -sq, 0));
  out.body = rel('body');
  // head: tip (forward), then roll, then yaw about the bulb's own axis
  out.head = rel('head')
    .multiply(new Matrix4().makeRotationX(REST_TIP - p.headPitch))
    .multiply(new Matrix4().makeRotationZ(-p.headRoll))
    .multiply(new Matrix4().makeRotationY(p.headYaw));
  out.eye = rel('eye');
  // the pupil turns about the lens centre: +x looks toward +X (about +Y), +y looks up (about -X)
  const e = eyeDims();
  // the iris shrinks in the lens plane; z is eased out so its rim stays on the glass
  const aI = Math.asin(e.irisR / e.R);
  const zfix = Math.sqrt(1 - (p.iris * Math.sin(aI)) ** 2) / Math.cos(aI);
  out.pupil = rel('pupil').multiply(euler(-p.gaze[1] * GAZE_MAX, p.gaze[0] * GAZE_MAX, 0, 'YXZ')).multiply(new Matrix4().makeScale(p.iris, p.iris, zfix));
  out.brow = rel('brow').multiply(new Matrix4().makeRotationZ(-p.brow[1])).multiply(new Matrix4().makeRotationX(-p.brow[0]));
  // lids are built shut (edges on the eye's horizon); opening turns them away from it
  out.lidTop = rel('lidTop').multiply(new Matrix4().makeRotationZ(-p.lidTilt[0])).multiply(new Matrix4().makeRotationX(-(1 - p.lids[0]) * e.lidOpen));
  out.lidBottom = rel('lidBottom').multiply(new Matrix4().makeRotationZ(-p.lidTilt[1])).multiply(new Matrix4().makeRotationX((1 - p.lids[1]) * e.lidOpen));
  const [L, R] = armJoints(p.arms);
  for (const [side, j, s] of [['L', L, 1], ['R', R, -1]] as const) {
    out[`arm${side}`] = rel(`arm${side}`)
      .multiply(new Matrix4().makeRotationZ(s * j.out))
      .multiply(new Matrix4().makeRotationX(-j.swing))
      .multiply(new Matrix4().makeRotationY(s * j.twist));
    out[`forearm${side}`] = rel(`forearm${side}`).multiply(new Matrix4().makeRotationX(-j.elbow));
    out[`hand${side}`] = rel(`hand${side}`).multiply(new Matrix4().makeRotationX(-j.wrist));
    const g = (0.06 + j.grip * 0.5) * (1 as number);
    out[`pincer${side}a`] = rel(`pincer${side}a`).multiply(new Matrix4().makeRotationX(-g));
    out[`pincer${side}b`] = rel(`pincer${side}b`).multiply(new Matrix4().makeRotationX(g));
  }
  // the aerial bends from its base; each segment takes a share, the tip the most (a whip)
  const share = [0.45, 0.33, 0.22];
  const segs = ['aerial', 'aerial2', 'aerial3'] as const;
  segs.forEach((n, i) => {
    out[n] = rel(n).multiply(new Matrix4().makeRotationZ(-p.aerial[0] * share[i]!)).multiply(new Matrix4().makeRotationX(p.aerial[1] * share[i]!));
  });
  out.flag = rel('flag').multiply(new Matrix4().makeRotationY(Math.sin(p.flag) * 0.42));
  return out;
}

/** World (root-space) matrix of every node for a pose. */
export function poseWorld(pose: Partial<FetchPose> = {}): Record<NodeName, Matrix4> {
  const L = poseMatrices(pose);
  const W = {} as Record<NodeName, Matrix4>;
  const get = (n: NodeName): Matrix4 => {
    if (W[n]) return W[n];
    W[n] = n === 'root' ? L.root.clone() : get(PARENT[n]).clone().multiply(L[n]);
    return W[n];
  };
  for (const n of NODE_NAMES) get(n);
  return W;
}

/**
 * Pose a realised Fetch (an Object3D tree from `realize`, or anything with
 * named children) or a Piece description. Pure: pose → transforms. Nodes
 * that are missing (a low-detail build) are skipped.
 */
export function poseFetch(root: Object3D | Piece, pose: Partial<FetchPose> = {}): void {
  const M = poseMatrices(pose);
  if ('root' in root && (root as Piece).triangles !== undefined) {
    const walk = (n: PieceNode): void => {
      const m = M[n.name as NodeName];
      if (m && n.name !== 'root') n.transform = m.clone();
      for (const c of n.children ?? []) walk(c);
    };
    walk((root as Piece).root);
    return;
  }
  const obj = root as Object3D;
  for (const name of NODE_NAMES) {
    if (name === 'root') continue;
    const o = obj.getObjectByName(name);
    if (!o) continue;
    M[name].decompose(o.position, o.quaternion, o.scale);
  }
}
