/**
 * Pitch's rig: the nodes that move and the poses that move them (pure; no
 * geometry). Units are the kit's (1 = Fetch's body height); he is drawn at
 * the crew's scale on the bench.
 *
 * The tree:
 *   root (on the ground under him)
 *   └ float          the whole airship: bob, pitch (nose up), roll, yaw; its origin is the hull's centre
 *     ├ eye           looks about (yaw, pitch)
 *     │ └ lid         the heavy upper lid: 0 open, 1 shut (he lives at a little over half mast)
 *     ├ hat           the bowler: lifted and tipped to greet (take A and C)
 *     ├ tie           swings from the knot, a beat late
 *     │ └ tieTip      the blade's lower half: a second, later swing
 *     ├ prop          spins about Z
 *     ├ rudder        the tail's moving surfaces, about Y
 *     ├ car           the gondola (briefcase or cabin): sways a little under the hull
 *     │ ├ winch       its drum turns as the cable pays out
 *     │ ├ cable       a unit-length line hanging from the drum, scaled in Y to its length
 *     │ └ hook        at the cable's end
 *     │   └ sling     the rope cradle round a crate (only while carrying)
 *     └ banner        the towed banner on its line from the tail (only while showing)
 */
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';

export type Take = 'A' | 'B' | 'C';

export interface PitchPose {
  /** Height of the hull's centre above the root (units). */
  float: number;
  /** Nose up (+) / down (−), degrees. */
  pitch: number;
  /** Roll, degrees (+: rolls toward his right, the visitor's right when he faces them). */
  roll: number;
  /** Turn about Y, degrees (0: nose toward the visitor). */
  yaw: number;
  /** Eye: [yaw, pitch] in degrees. */
  look: [number, number];
  /** Upper lid, 0 open .. 1 shut. */
  lid: number;
  /** Hat: 0 on, 1 lifted clear and tipped. */
  hat: number;
  /** Tie swing from the knot: [about X (fore-aft), about Z (side)], degrees; the tip adds `tieLag` of it again. */
  tie: [number, number];
  tieLag: number;
  /** Propeller angle, degrees. */
  prop: number;
  /** Rudder, degrees. */
  rudder: number;
  /** The car's sway under the hull, degrees about Z. */
  car: number;
  /** Cable length below the drum (units); 0 is stowed (hook tucked under the car). */
  cable: number;
  /** The hook's swing, degrees about X and Z. */
  hookSwing: [number, number];
  /** Show the rope cradle (carrying a crate) and its size: the crate's edge in units. 0 hides it. */
  sling: number;
  /** Show the banner (0 hides it, 1 out). */
  banner: number;
}

/** Where things are, relative to the hull's centre (shared by every take; each take's geometry is built to them). */
export const RIG = {
  /** The hull's centre above the ground at rest in the catalogue (the car's keel just clear of the bench). */
  float: 0.74,
  /** The hook's stowed drop below the drum. */
  stowed: 0.055,
} as const;

export const NEUTRAL: PitchPose = {
  float: RIG.float,
  pitch: 3,
  roll: 0,
  yaw: 0,
  look: [0, 0],
  lid: 0.47,
  hat: 0,
  tie: [0, 0],
  tieLag: 0.6,
  prop: 0,
  rudder: 0,
  car: 0,
  cable: 0,
  hookSwing: [0, 0],
  sling: 0,
  banner: 0,
};

export const EXPRESSIONS = {
  /** At ease: nose a touch up, lid at half mast. */
  rest: NEUTRAL,
  /** Very pleased with himself: nose up, lid lower, tie flicked forward. */
  proud: { ...NEUTRAL, pitch: 11, lid: 0.66, look: [0, -6], tie: [-14, 3], tieLag: 0.5 },
  /** Raising his hat to the visitor. */
  greet: { ...NEUTRAL, pitch: 6, hat: 1, lid: 0.25, look: [0, 4], tie: [-6, 0] },
  /** Hook out, a small crate on it, all business. */
  carry: { ...NEUTRAL, pitch: -2, cable: 0.12, sling: 0.3, tie: [10, -2], car: 1.5, lid: 0.35, look: [0, 14] },
  /** A big crate: sagging, nose down, straining, and not admitting it. */
  strain: { ...NEUTRAL, float: RIG.float - 0.12, pitch: -9, roll: -3, cable: 0.3, sling: 0.53, tie: [16, 4], car: 3, lid: 0.2, look: [0, -4], prop: 20 },
  /** Lowering a crate: cable long, eye on the job. */
  lower: { ...NEUTRAL, pitch: -6, cable: 0.62, sling: 0.3, tie: [8, 0], lid: 0.15, look: [0, 22] },
  /** The banner out, nose up, presenting. */
  present: { ...NEUTRAL, pitch: 7, banner: 1, lid: 0.5, look: [-10, 0], tie: [-8, 0] },
} satisfies Record<string, PitchPose>;

export type ExpressionName = keyof typeof EXPRESSIONS;
export const EXPRESSION_NAMES = Object.keys(EXPRESSIONS) as ExpressionName[];

const DEG = Math.PI / 180;
const R = (x: number, y: number, z: number, order: 'XYZ' | 'YXZ' | 'ZXY' = 'XYZ'): Quaternion => new Quaternion().setFromEuler(new Euler(x * DEG, y * DEG, z * DEG, order));
const M = (p: readonly [number, number, number], q: Quaternion = new Quaternion(), s: number | readonly [number, number, number] = 1): Matrix4 =>
  new Matrix4().compose(new Vector3(p[0], p[1], p[2]), q, typeof s === 'number' ? new Vector3(s, s, s) : new Vector3(s[0], s[1], s[2]));

/** Hidden parts are scaled to this, never 0 (a skin's bind pose must stay invertible). */
export const HIDDEN = 1e-3;

/** Where each take puts its moving parts' pivots (relative to the hull's centre or the car). */
export interface Pivots {
  eye: [number, number, number];
  /** The eye's rest tilt up from straight ahead (degrees): it sits on the nose's slope and looks along it, nose in the air. */
  eyeTilt: number;
  /** The eye's outward direction (unit), used for the lid's hinge frame. */
  hat: [number, number, number];
  /** The hat's forward tilt at rest, degrees. */
  hatTilt: number;
  knot: [number, number, number];
  /** The tie blade's half-way point below the knot. */
  tieMid: number;
  prop: [number, number, number];
  rudder: [number, number, number];
  tow: [number, number, number];
  /** Where the car hangs from the hull (its frame's origin, under the belly). */
  car: [number, number, number];
  /** The winch drum's axle, in the car's frame. */
  drum: [number, number, number];
}

/** The node transforms for a pose. */
export function poseMatrices(pose: PitchPose, pv: Pivots): Record<string, Matrix4> {
  const out: Record<string, Matrix4> = {};
  out.float = M([0, pose.float, 0], R(-pose.pitch, pose.yaw, pose.roll, 'YXZ'));
  out.eye = M(pv.eye, R(-pose.look[1] - pv.eyeTilt, pose.look[0], 0, 'YXZ'));
  // the lid hinges about the eye's local X: closed is rotated down over the lens
  out.lid = M([0, 0, 0], R(lidAngle(pose.lid), 0, 0));
  // the hat: lifted along its own up and tipped forward toward the visitor
  const h = Math.max(0, Math.min(1, pose.hat));
  const lift = Math.sin(h * Math.PI * 0.5) * 0.16;
  out.hat = M([pv.hat[0], pv.hat[1] + lift, pv.hat[2] + h * 0.07], R(pv.hatTilt + h * 30, 0, h * -10));
  out.tie = M(pv.knot, R(pose.tie[0], 0, pose.tie[1]));
  out.tieTip = M([0, -pv.tieMid, 0], R(pose.tie[0] * pose.tieLag, 0, pose.tie[1] * pose.tieLag));
  out.prop = M(pv.prop, R(0, 0, pose.prop));
  out.rudder = M(pv.rudder, R(0, pose.rudder, 0));
  out.car = M(pv.car, R(0, 0, pose.car));
  out.winch = M(pv.drum, R(-pose.cable * 600, 0, 0));
  const len = Math.max(RIG.stowed, pose.cable + RIG.stowed);
  out.cable = M(pv.drum, new Quaternion(), [1, len, 1]);
  const swing = R(pose.hookSwing[0], 0, pose.hookSwing[1]);
  const drop = new Vector3(0, -len, 0).applyQuaternion(swing);
  out.hook = M([pv.drum[0] + drop.x, pv.drum[1] + drop.y, pv.drum[2] + drop.z], swing);
  const sl = pose.sling > 0 ? pose.sling / 0.3 : HIDDEN;
  out.sling = M([0, -0.06, 0], new Quaternion(), sl);
  out.banner = M(pv.tow, new Quaternion(), pose.banner > 0 ? 1 : HIDDEN);
  return out;
}

/** The lid's hinge angle (degrees) for 0..1 closed: open sits back over the top of the lens. */
export function lidAngle(c: number): number {
  return -90 + Math.max(0, Math.min(1, c)) * 178;
}

/** Something with named children whose transforms a pose sets (a realized piece). */
export interface Posable {
  getObjectByName(name: string): { position: Vector3; quaternion: Quaternion; scale: Vector3 } | undefined;
}

/** Set a pose on a realized piece's nodes. */
export function posePitch(root: Posable, pose: PitchPose, pv: Pivots): void {
  const ms = poseMatrices(pose, pv);
  for (const [name, m] of Object.entries(ms)) {
    const o = root.getObjectByName(name);
    if (o) m.decompose(o.position, o.quaternion, o.scale);
  }
}
