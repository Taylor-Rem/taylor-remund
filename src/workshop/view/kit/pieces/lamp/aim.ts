/**
 * The lamp's arm as a machine a hand can move: its joints, their limits,
 * forward kinematics, and `aimLamp`, which puts the beam on a point of the
 * bench. Pure maths (three's vectors and matrices only); no geometry here.
 *
 * Coordinates are the lamp piece's own (rig.ts): origin on the bench top at
 * the face of the back wall, under the clamp; +Y up, +Z out of the wall
 * toward the visitor, +X to the visitor's right.
 *
 * THE JOINTS, from the wall out (each one a node, its pivot at the origin):
 *  - `swivel`  the riser turns in its collar on the clamp, about the
 *              vertical. Angle = the azimuth of the arm's facing direction
 *              `p` (0 = straight out of the wall, + toward +X).
 *  - `knuckle` the brass tilt knuckle on top of the riser leans the arm's
 *              plane sideways, about `p` (its local +Z). It is what keeps the
 *              arm from reading as one stick from the front camera: the
 *              plane leans so the elbow is thrown up and to the side. The
 *              lean is not free: it follows the swivel (`leanFor`), so the
 *              elbow is always thrown toward the visitor, never into the wall.
 *  - `arm1`    the lower arm pitches about the shoulder pin (local +Y).
 *  - `arm2`    the elbow (local +Y).
 *  - `shade`   the wrist: the shade tilts about the pin (local +Y) ...
 *  - `head`    ... and pans on its yoke, about the wrist's local +Z, out of
 *              the arm's plane.
 * The three pins (shoulder, elbow, wrist) are parallel, so the two arm
 * sections and the shade's tilt share one plane: spanned by `p` (out) and
 * `q` (the plane's up), with `pin` its normal.
 *
 * In-plane angles are measured from `p` toward `q`: `shoulder` is arm 1's
 * angle, `elbow` is arm 2's angle relative to arm 1, `wrist` is the shade's
 * tilt relative to arm 2. `pan` is the shade's angle out of the plane.
 */
import { Matrix4, Vector3 } from 'three';
import { DIM, solveArm, stageTarget } from './rig.ts';
import type { V3 } from './rig.ts';

const DEG = Math.PI / 180;

/** A pose of the lamp. Angles in radians; any left out take their home value. */
export interface LampPose {
  /** The riser's swivel: the azimuth of the arm's facing direction (0 = straight out of the wall, + toward +X). */
  swivel?: number;
  /** The knuckle's lean of the arm's plane about the facing direction (+ throws the elbow toward -X). */
  lean?: number;
  /** Arm 1's angle in the plane, from the facing direction up. */
  shoulder?: number;
  /** Arm 2's angle relative to arm 1 (negative: the elbow bent down). */
  elbow?: number;
  /** The shade's tilt relative to arm 2. */
  wrist?: number;
  /** The shade's pan out of the arm's plane (+ toward the pin). */
  pan?: number;
  /** Lit (default) or dark. */
  on?: boolean;
  /** Brightness when lit: 1 low, 2 middle, 3 full (default). */
  level?: 1 | 2 | 3;
}

export type Joint = 'swivel' | 'lean' | 'shoulder' | 'elbow' | 'wrist' | 'pan';
export const JOINTS: readonly Joint[] = ['swivel', 'lean', 'shoulder', 'elbow', 'wrist', 'pan'];

/** Fixed points of the mechanism (lamp space). */
export const MECH = {
  /** The shoulder pin's centre: on the swivel's axis, at the top of the knuckle. */
  shoulder: DIM.shoulder,
  /** The swivel's pivot: the riser's foot in its collar on top of the clamp. */
  swivelAt: [DIM.shoulder[0], DIM.rail.y + DIM.rail.r + 0.1, DIM.shoulder[2]] as V3,
  l1: DIM.l1,
  l2: DIM.l2,
  /** Wrist pin to filament, along the shade's axis. */
  neck: DIM.neck,
} as const;

/** Unit vectors of the arm's plane for a swivel and a lean. */
export function planeOf(swivel: number, lean: number): { p: Vector3; q: Vector3; pin: Vector3; side: Vector3 } {
  const cs = Math.cos(swivel), ss = Math.sin(swivel);
  const p = new Vector3(ss, 0, cs);
  const side = new Vector3(cs, 0, -ss); // the swivel's local +X
  const cl = Math.cos(lean), sl = Math.sin(lean);
  const pin = side.clone().multiplyScalar(cl).add(new Vector3(0, sl, 0));
  const q = side.clone().multiplyScalar(-sl).add(new Vector3(0, cl, 0));
  return { p, q, pin, side };
}

/** World (lamp-space) frames of every moving node, and the points that matter. */
export interface ArmFrames {
  swivel: Matrix4;
  knuckle: Matrix4;
  arm1: Matrix4;
  arm2: Matrix4;
  shade: Matrix4;
  head: Matrix4;
  shoulder: Vector3;
  elbow: Vector3;
  wrist: Vector3;
  /** The filament. */
  bulb: Vector3;
  /** The shade's axis (unit), the way the light leaves. */
  axis: Vector3;
  pin: Vector3;
  p: Vector3;
  q: Vector3;
}

const basis = (o: Vector3, x: Vector3, y: Vector3, z: Vector3): Matrix4 => new Matrix4().makeBasis(x, y, z).setPosition(o);

/** Forward kinematics: every node's frame in the lamp's space for a full set of joint angles. */
export function armFrames(j: Readonly<Record<Joint, number>>): ArmFrames {
  const { p, q, pin, side } = planeOf(j.swivel, j.lean);
  const S = new Vector3(...MECH.shoulder);
  const dir = (t: number): Vector3 => p.clone().multiplyScalar(Math.cos(t)).addScaledVector(q, Math.sin(t));
  const t1 = j.shoulder, t2 = t1 + j.elbow, t3 = t2 + j.wrist;
  const d1 = dir(t1), d2 = dir(t2), d3 = dir(t3);
  const E = S.clone().addScaledVector(d1, MECH.l1);
  const W = E.clone().addScaledVector(d2, MECH.l2);
  const cp = Math.cos(j.pan), sp = Math.sin(j.pan);
  const axis = d3.clone().multiplyScalar(cp).addScaledVector(pin, sp);
  const yH = pin.clone().multiplyScalar(cp).addScaledVector(d3, -sp);
  const B = W.clone().addScaledVector(axis, MECH.neck);
  const z = (x: Vector3, y: Vector3): Vector3 => new Vector3().crossVectors(x, y);
  return {
    swivel: basis(new Vector3(...MECH.swivelAt), side, new Vector3(0, 1, 0), p),
    knuckle: basis(S, pin, q, p),
    arm1: basis(S, d1, pin, z(d1, pin)),
    arm2: basis(E, d2, pin, z(d2, pin)),
    shade: basis(W, d3, pin, z(d3, pin)),
    head: basis(W, axis, yH, z(axis, yH)),
    shoulder: S,
    elbow: E,
    wrist: W,
    bulb: B,
    axis,
    pin,
    p,
    q,
  };
}

/** The home pose: the approved picture (G1), recovered exactly from the rig's solution for the stage's key light. */
export const HOME: Readonly<Record<Joint, number>> = (() => {
  const t = stageTarget();
  const s = solveArm(t.bulb, t.aim);
  const pin = s.pin;
  const lean = Math.asin(pin.y);
  const side = new Vector3(pin.x, 0, pin.z).normalize();
  const swivel = Math.atan2(-side.z, side.x);
  const { p, q } = planeOf(swivel, lean);
  const ang = (v: Vector3): number => Math.atan2(v.dot(q), v.dot(p));
  const t1 = ang(s.elbow.clone().sub(s.shoulder));
  const t2 = ang(s.wrist.clone().sub(s.elbow));
  const t3 = ang(s.axis.clone().addScaledVector(pin, -s.axis.dot(pin)));
  const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
  return { swivel, lean, shoulder: t1, elbow: wrap(t2 - t1), wrist: wrap(t3 - t2), pan: Math.asin(Math.max(-1, Math.min(1, s.axis.dot(pin)))) };
})();

/** A full set of joint angles from a pose (home for anything left out). */
export function jointsOf(pose: LampPose = {}): Record<Joint, number> {
  return {
    swivel: pose.swivel ?? HOME.swivel,
    lean: pose.lean ?? HOME.lean,
    shoulder: pose.shoulder ?? HOME.shoulder,
    elbow: pose.elbow ?? HOME.elbow,
    wrist: pose.wrist ?? HOME.wrist,
    pan: pose.pan ?? HOME.pan,
  };
}

// ───────────────────────── limits ─────────────────────────

/**
 * What each joint allows (radians). The arm never leaves these, whatever is asked of it:
 * the swivel stops short of the wall either side, the elbow never straightens to a lock nor
 * folds onto itself, the wrist never turns the shade back onto its own arm.
 */
export const LIMITS: Readonly<Record<Joint, { min: number; max: number }>> = {
  swivel: { min: -70 * DEG, max: 75 * DEG },
  lean: { min: -HOME.lean, max: HOME.lean },
  shoulder: { min: 40 * DEG, max: 115 * DEG },
  elbow: { min: -150 * DEG, max: -12 * DEG },
  wrist: { min: -150 * DEG, max: -25 * DEG },
  pan: { min: -35 * DEG, max: 35 * DEG },
};

const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** min(a, b), rounded over a band ±k (exactly a when a < b - k): smooth, so the joints never kink. */
function softMin(a: number, b: number, k: number): number {
  const d = a - b;
  if (d <= -k) return a;
  if (d >= k) return b;
  return a - ((d + k) * (d + k)) / (4 * k);
}

/** The swivel at which the knuckle stands upright (the lean changes side there). */
export const LEAN_ZERO = -25 * DEG;

/**
 * The knuckle's lean for a swivel: the elbow is thrown to the visitor's side of the arm's plane,
 * never toward the wall. Facing right of LEAN_ZERO the plane leans left, as at home (full lean from
 * the home swivel on); facing further left it leans right. Upright only at LEAN_ZERO, where the arm
 * faces well off the camera's line, so it never folds into one stick seen end-on from the front.
 * Smooth (C1), so the knuckle never jerks as the swivel turns.
 */
export function leanFor(swivel: number): number {
  const t = clamp((swivel - LEAN_ZERO) / (HOME.swivel - LEAN_ZERO), -1, 1);
  return HOME.lean * t * (1.5 - 0.5 * t * t);
}

// ───────────────────────── aiming ─────────────────────────

/** How the arm is laid out for a target: tuned by eye (see the brief's contact sheet). */
export const AIM_FEEL = {
  /**
   * Where the wrist is left, in the arm's plane, by how far out the spot is (u, along the plane
   * from the shoulder): its distance from the shoulder, and its rise (angle above the plane's
   * horizontal). A near spot: the shade held out and looking back down at it; the home spot: as
   * approved; a far spot: the arm stretched out and lower. The curves pass through home exactly.
   */
  reach: { near: 5.0, nearAt: 0.5, far: 6.45, farAt: 11 },
  shoulder: { near: 74 * DEG, nearAt: 0.5, far: 44 * DEG, farAt: 11 },
  /** The lower arm's pitch is held under this, by swivel: lower facing left (the sign), free facing right. */
  shoulderCap: { left: 62 * DEG, right: 92 * DEG, from: -20 * DEG, to: 34 * DEG },
} as const;

/** The home spot's reach out along the plane, and the home wrist distance and shoulder pitch, for the feel curves. */
const HOME_PLANE = (() => {
  const f = armFrames(HOME);
  const T = new Vector3(...stageTarget().aim).sub(f.shoulder);
  return { u: T.dot(f.p), reach: f.wrist.distanceTo(f.shoulder), shoulder: HOME.shoulder };
})();

/** A smooth curve through (nearAt, near), (home u, home), (farAt, far). */
function feel(c: { near: number; nearAt: number; far: number; farAt: number }, home: number, u: number): number {
  return u < HOME_PLANE.u ? lerp(c.near, home, smooth(c.nearAt, HOME_PLANE.u, u)) : lerp(home, c.far, smooth(HOME_PLANE.u, c.farAt, u));
}

/** The in-plane solve for one swivel: joint angles and where the out-of-plane offset leaves the pan. */
function solvePlane(T: Vector3, swivel: number): Record<Joint, number> {
  const lean = leanFor(swivel);
  const { p, q, pin } = planeOf(swivel, lean);
  const d = T.clone().sub(new Vector3(...MECH.shoulder));
  const u = d.dot(p), v = d.dot(q), h = d.dot(pin);
  // where the hand leaves the shade: the lower arm's pitch and the wrist's distance from the shoulder
  // (the elbow follows), further out and lower for a far spot; the lower arm leans out more when the
  // arm faces left, so the elbow stays clear of the sign
  const rc = feel(AIM_FEEL.reach, HOME_PLANE.reach, u);
  const cap = lerp(AIM_FEEL.shoulderCap.left, AIM_FEEL.shoulderCap.right, smooth(AIM_FEEL.shoulderCap.from, AIM_FEEL.shoulderCap.to, swivel));
  const want = feel(AIM_FEEL.shoulder, HOME_PLANE.shoulder, u);
  const t1 = softMin(want, cap, 6 * DEG);
  const { l1, l2 } = MECH;
  const inner = Math.acos(clamp((l1 * l1 + l2 * l2 - rc * rc) / (2 * l1 * l2), -1, 1));
  const t2 = t1 - (Math.PI - inner);
  const wu = l1 * Math.cos(t1) + l2 * Math.cos(t2), wv = l1 * Math.sin(t1) + l2 * Math.sin(t2);
  const t3 = Math.atan2(v - wv, u - wu);
  const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
  const pan = Math.atan2(h, Math.hypot(u - wu, v - wv));
  return { swivel, lean, shoulder: t1, elbow: wrap(t2 - t1), wrist: wrap(t3 - t2), pan };
}

/** Azimuth of a point from the swivel's axis (0 = straight out of the wall). */
const azimuth = (T: Vector3): number => Math.atan2(T.x - MECH.shoulder[0], T.z - MECH.shoulder[2]);
const HOME_AZ_OFFSET = HOME.swivel - azimuth(new Vector3(...stageTarget().aim));

/** Clamp every joint to its limits. */
export function clampJoints(j: Record<Joint, number>): Record<Joint, number> {
  const out = { ...j };
  for (const k of JOINTS) out[k] = clamp(j[k], LIMITS[k].min, LIMITS[k].max);
  return out;
}

export interface Aimed {
  /** The pose (joint angles, plus `on`/`level` passed through from the options). */
  pose: LampPose & Record<Joint, number>;
  /** The filament (lamp space) and the shade's axis (unit): where the key light goes and which way it points. */
  bulb: V3;
  axis: V3;
  /** Where the beam's axis meets the target's height (lamp space): the target itself when it was reachable. */
  lands: V3;
  /** True when the beam lands on the target as asked (it was inside REACH and the joints allowed it). */
  reached: boolean;
  /** The target actually solved for (the asked one, or the nearest point of REACH to it). */
  target: V3;
}

export interface AimOptions {
  /** Keep the target inside REACH (default true). False: solve for it as given, the joints still clamped. */
  clampToReach?: boolean;
  on?: boolean;
  level?: 1 | 2 | 3;
}

/**
 * Put the beam on a point (lamp space; usually on the bench top, y = 0). The arm is laid out as a
 * hand would leave it: the shade hovers back up the beam from the spot, the elbow thrown up and to
 * the visitor's side, the pan near its home angle (the swivel takes the bearing). Out of reach, it
 * solves for the nearest point of REACH instead and says where the beam lands. Continuous: as the
 * target moves continuously, every joint does (no branch is ever switched).
 */
export function aimLamp(target: V3 | Vector3, opts: AimOptions = {}): Aimed {
  const asked = target instanceof Vector3 ? target.clone() : new Vector3(...target);
  const T = opts.clampToReach === false ? asked.clone() : nearestInReach(asked);
  // the swivel: bearing plus home's offset, then corrected so the pan stays at its home angle
  let sw = azimuth(T) + HOME_AZ_OFFSET;
  for (let it = 0; it < 4; it++) {
    const a = solvePlane(T, sw);
    const e = 1e-4;
    const b = solvePlane(T, sw + e);
    const g = (b.pan - a.pan) / e;
    if (Math.abs(g) < 1e-6) break;
    sw -= clamp((a.pan - HOME.pan) / g, -0.3, 0.3);
  }
  sw = clamp(sw, LIMITS.swivel.min, LIMITS.swivel.max);
  const j = clampJoints(solvePlane(T, sw));
  const f = armFrames(j);
  const lands = landing(f, T.y);
  const reached = lands.distanceTo(T) < 1e-3 && asked.distanceTo(T) < 1e-6;
  const pose: LampPose & Record<Joint, number> = { ...j };
  if (opts.on !== undefined) pose.on = opts.on;
  if (opts.level !== undefined) pose.level = opts.level;
  return { pose, bulb: f.bulb.toArray() as V3, axis: f.axis.toArray() as V3, lands: lands.toArray() as V3, reached, target: T.toArray() as V3 };
}

/** Where the shade's axis meets the plane y = `y` (or the point on the axis 20 units out, if it never comes down). */
export function landing(f: ArmFrames, y = 0): Vector3 {
  if (f.axis.y > -1e-3) return f.bulb.clone().addScaledVector(f.axis, 20);
  const t = (y - f.bulb.y) / f.axis.y;
  return f.bulb.clone().addScaledVector(f.axis, t);
}

/** The key light for a pose: the filament and a point `reach` along the axis (lamp space). */
export function lampLight(pose: LampPose = {}, reach = 6.7): { position: V3; aim: V3 } {
  const f = armFrames(jointsOf(pose));
  return { position: f.bulb.toArray() as V3, aim: f.bulb.clone().addScaledVector(f.axis, reach).toArray() as V3 };
}

/**
 * Named spots for the review pictures, in the lamp's space with the lamp clamped at the BENCH's
 * spot (view/bench.ts: world x -3.1, z -5). The Button's red cap, the bench's far left and far right
 * front corners (the right one is out of reach), the switchboard's face, and the bench straight
 * down at the lamp's own clamp.
 */
export const AIM_TARGETS = {
  button: [3.05, 0.9, 5.55] as V3,
  'far-left': [-5.5, 0, 9.6] as V3,
  'far-right': [11.7, 0, 9.6] as V3,
  switchboard: [3.65, 1.7, 1.4] as V3,
  clamp: [0.2, 0, 0.75] as V3,
} as const;

// ───────────────────────── the reachable region ─────────────────────────

/**
 * Where on the bench top (y = 0) the beam can be put, as a convex polygon in the lamp's space
 * (x, z), counter-clockwise seen from above. Inside it `aimLamp` lands the beam exactly, inside
 * every joint limit, with the arm clear of the wall, the bench and the wall's neighbours (tested
 * on a fine grid). The home point is inside it. The simulation clamps a drag to it.
 */
export const REACH: ReadonlyArray<readonly [number, number]> = [
  [-5.8, 0.6],
  [-5.8, 10],
  [11.0, 10],
  [11.9, 8.6],
  [11.9, 6.2],
  [8.6, 0.6],
];

/** Which side of each edge is inside (the polygon's winding). */
const WIND = Math.sign(REACH.reduce((s, [ax, az], i) => {
  const [bx, bz] = REACH[(i + 1) % REACH.length]!;
  return s + (ax * bz - bx * az);
}, 0));

/** REACH in world (x, z) for a lamp clamped with its origin at `place` (no yaw): for a simulation that keeps the aim in world space. */
export function reachInWorld(place: V3): Array<[number, number]> {
  return REACH.map(([x, z]) => [x + place[0], z + place[2]]);
}

/** True when (x, z) is inside REACH (or on its edge). */
export function inReach(x: number, z: number): boolean {
  const n = REACH.length;
  for (let i = 0; i < n; i++) {
    const [ax, az] = REACH[i]!, [bx, bz] = REACH[(i + 1) % n]!;
    if (WIND * ((bx - ax) * (z - az) - (bz - az) * (x - ax)) < -1e-9) return false;
  }
  return true;
}

/** The nearest point of REACH to a point (its height kept). Continuous: REACH is convex. */
export function nearestInReach(t: Vector3): Vector3 {
  if (inReach(t.x, t.z)) return t.clone();
  let best: [number, number] = [t.x, t.z];
  let bd = Infinity;
  const n = REACH.length;
  for (let i = 0; i < n; i++) {
    const [ax, az] = REACH[i]!, [bx, bz] = REACH[(i + 1) % n]!;
    const ex = bx - ax, ez = bz - az;
    const k = clamp(((t.x - ax) * ex + (t.z - az) * ez) / (ex * ex + ez * ez), 0, 1);
    const px = ax + ex * k, pz = az + ez * k;
    const dd = (px - t.x) ** 2 + (pz - t.z) ** 2;
    if (dd < bd) {
      bd = dd;
      best = [px, pz];
    }
  }
  return new Vector3(best[0], t.y, best[1]);
}

export { DEG };
