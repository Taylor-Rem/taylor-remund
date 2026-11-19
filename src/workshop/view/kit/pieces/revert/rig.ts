/**
 * Revert, the caretaker: the rig. Pure pose maths, no geometry: a pose goes
 * in, the local transform of every moving node comes out. No time, no
 * simulation, no loop: the view supplies the timing and drives it.
 *
 * Revert is built at CREW SCALE (ART-P2 § 2, § 5): about 0.9 tall, 1.45 wide
 * and 1.1 deep as built. Place it at scale 1; do not apply the crew's 1.25.
 *
 * Node tree (pivots at node origins; every name is unique in the piece):
 *
 *   root                        on the bench, between the treads
 *    ├ chassis                  the two track frames (static under the body)
 *    │  ├ wheelLF wheelLB wheelRF wheelRB   end wheels: turn about their local X
 *    │  └ shoeL0..shoeL19, shoeR0..shoeR19  track shoes: ride round the loop with `travel`
 *    └ body                     the strongbox hull, at BODY_Y: bob, pitch, roll
 *       ├ brow                  the heavy brow plate, hinged at its back edge: + drops its front
 *       ├ eyeL / eyeR           the lamp sockets (L = Revert's own left = +X = screen right)
 *       │  ├ lampL / lampR      the glowing lamp: gaze turns it over the lens; scale 1e-4 = off
 *       │  └ lidL / lidR        the lid shutter: closes about X, slants about the eye axis
 *       ├ crank                 the brass crank on the rewind box at the back: turns about Z
 *       ├ card                  the card feed: rises out of the deck slot, slides, leans back
 *       │  └ cardL              the card's left leaf: folded behind the right one, swings open
 *       ├ arm → forearm → hand → jaw0 / jaw1   the one stubby arm, front left (screen left)
 *       └ broom                 the push broom: stowed on the left flank, or in the hand
 */
import { Matrix4, Quaternion, Vector3 } from 'three';

// ---- dimensions shared by the builder and the rig (world units, crew scale) ----

/** The treads: centre line x, half width, the end wheels' axle z, pitch radius, shoe thickness, shoes per side. */
export const TRACK = { x: 0.585, hw: 0.125, axleZ: 0.355, rp: 0.14, shoeT: 0.036, n: 18 } as const;
/** Axle height: the shoes' outer faces touch the bench. */
export const AXLE_Y = TRACK.rp + TRACK.shoeT;
/** The path the shoes' mid-thickness rides on: the radius at the ends and the loop's length. */
export const RM = TRACK.rp + TRACK.shoeT / 2;
export const LOOP = 4 * TRACK.axleZ + 2 * Math.PI * RM;
/** Shoe length along the loop (the rest of the pitch is the gap between shoes). */
export const SHOE_L = (LOOP / TRACK.n) * 0.8;

/** The body's pivot (bob, pitch, roll) in root space: the hull's middle, just above the treads. */
export const BODY_Y = 0.36;

/** The upper hull (the strongbox), in ROOT space: nominal plan, corner radius, base and deck heights. */
export const HULL = { w: 1.2, d: 0.92, rPlan: 0.15, y0: 0.3, y1: 0.74 } as const;
/** The lower hull between the treads. */
export const LOWER = { w: 0.86, d: 0.8, y0: 0.085, y1: 0.33 } as const;
/**
 * The face: the hull's front is raked back from `chin` up to the deck, so it
 * looks up at a camera 33° above the bench instead of at the floor.
 */
export const FACE = { chin: 0.355, rake: 0.52 } as const;
export const TAN_RAKE = Math.tan(FACE.rake);
/** Where the face is (z) at a height y (root space). */
export const faceZ = (y: number): number => HULL.d / 2 - Math.max(0, y - FACE.chin) * TAN_RAKE;

/** The eyes, in root space: centre x (each side) and height; they sit on the raked face. Lens: sphere radius and opening radius. */
export const EYE = { x: 0.325, y: 0.53, rs: 0.1, a: 0.073 } as const;
export const EYE_H = EYE.rs - Math.sqrt(EYE.rs * EYE.rs - EYE.a * EYE.a);
/** The lens sphere's centre, in eye space (behind the face plane). */
export const EYE_C = -(EYE.rs - EYE_H);
/** The lamp's angular radius on the lens, and how far a gaze may turn it (radians). */
export const LAMP = { ang: 0.36, lift: 0.0025 } as const;
export const GAZE_MAX = Math.asin((EYE.a - 0.006) / EYE.rs) - LAMP.ang - 0.03;
/** The lid: shell radius about the lens centre, thickness, the lip's angle above the axis when open and when shut, and the shell's span. */
export const LID = { r: EYE.rs + 0.014, t: 0.009, open: 1.0, closed: -0.86, span: 2.0 } as const;

/** The brow plate, in root space: hinge line (on the deck, behind the face's top edge), its front edge, width, thickness, travel. */
export const BROW = { hingeY: HULL.y1, hingeZ: faceZ(HULL.y1) - 0.1, front: faceZ(HULL.y1) + 0.21, w: 1.16, t: 0.1, down: 0.13, up: 0.16 } as const;

/** The rewind drum on the back of the deck and its crank, in root space: the drum's span along X, axis, radii; the crank's hub and throw. */
export const DRUM = { x0: -0.24, x1: 0.26, y: HULL.y1 + 0.125, z: -0.27, r: 0.088, flange: 0.122 } as const;
export const CRANK = { x: DRUM.x1 + 0.075, y: DRUM.y, z: DRUM.z, throw: 0.2 } as const;

/** The deck slot the card feeds from, in root space (centre of the slot's mouth). */
export const SLOT = { y: HULL.y1 + 0.016, z: -0.03 } as const;
/** The card stick: how far the clip stands above the slot when the card is up. */
export const CARD_STICK = 0.11;
/** How far back the card leans when up (degrees) so it faces a camera ~33° above the bench. */
export const CARD_LEAN = 20;

/** The arm: shoulder in root space (the face's lower left corner, screen left), segment lengths. */
export const SHOULDER = { x: -0.53, y: 0.4, z: faceZ(0.4) + 0.02 } as const;
export const UPPER = 0.17;
export const FORE = 0.16;
/** Hand: from the wrist to the grip centre. */
export const GRIP = 0.075;

/** The broom, in its own space: the head's bristle line on y = 0, the handle up +Y to `len`; where the hand holds it. */
export const BROOM = { len: 0.98, grip: 0.8, gripOut: 0.5, head: 0.4 } as const;
/** Where along the handle the hand holds it: near the top to lift it off its rack, half way down to push. */
export const broomGrip = (broom: number): number => BROOM.grip + (BROOM.gripOut - BROOM.grip) * Math.max(0, Math.min(1, broom));

// ---- pose -----------------------------------------------------------------------------

export interface ArmJoints {
  /** Turn of the whole arm about the shoulder's vertical (+ toward +X). */
  yaw: number;
  /** Swing forward (+) from hanging. */
  swing: number;
  /** Elbow bend (+ folds the forearm forward). */
  elbow: number;
  /** Wrist: tilt of the hand about its X. */
  wrist: number;
  /** Jaws: 0 shut .. 1 open. */
  grip: number;
}

export interface CardPose {
  /** 0 stowed in the hull .. 1 up in the clip; a little over 1 is the pop's overshoot (clamped -0..1.15). */
  lift?: number;
  /** 0 folded in half .. 1 open flat (the left leaf swings round from behind). */
  open?: number;
  /** Extra lean back (degrees) over CARD_LEAN once it is up: a wobble. */
  wobble?: number;
}

export interface RevertPose {
  /** Distance travelled (units): drives the shoes round the loop and turns the wheels. Per side: [left, right] or one number for both. */
  travel?: number | [number, number];
  /** Body: rise (units), pitch (+ tips the face down toward the bench), roll (+ drops its left, +X). */
  bob?: number;
  pitch?: number;
  roll?: number;
  /** The treads hang (picked up): 0 on the bench .. 1 the bottom runs sag. */
  sag?: number;
  /** Lids, [left, right]: 0 open .. 1 shut. */
  lids?: [number, number];
  /** Lid slant, [left, right], radians: + drops the lid's inner corner (toward the nose): a glare. */
  slant?: [number, number];
  /** Gaze, -1..1 each: x + toward +X (screen right), y + up. Clamped to the unit disc. */
  gaze?: [number, number];
  /** Lamps, [left, right]: on (true) or off. */
  lamps?: [boolean, boolean];
  /** Brow: -1 raised .. 0 rest .. 1 dropped low over the eyes. And a roll (+ drops its +X end), radians. */
  brow?: number;
  browRoll?: number;
  /** Crank angle, radians, about the drum's axis (+X): + carries the handle from the top toward the visitor. */
  crank?: number;
  card?: CardPose;
  /** The arm: explicit joints, a preset, or 'broom' to hold the broom wherever `broom` puts it. */
  arm?: ArmJoints | ArmPreset | 'broom';
  /** The broom: 0 stowed .. 1 out in front sweeping; in between it travels from the flank to the bench. */
  broom?: number;
  /** The sweep stroke: -1 drawn back .. 1 pushed out (with broom 1). */
  stroke?: number;
  /** R3: the dustpan: 0 stowed (small, askew on its bracket) .. 1 opened out square round a crate `panFit` units across. */
  panOpen?: number;
  panFit?: number;
  /** R3: the pan tipped outward about its inner edge (radians, +): the crate slides off its lip, down the hatch. */
  panTip?: number;
}

/**
 * R3: the dustpan on its bracket over the right tread (body space): the pan's size (W across, D deep, H high),
 * its inner edge's centre on its floor, its askew yaw and tilt when stowed, and the lip it keeps round a crate
 * when opened out. The simulation holds a carried crate centred `x + lip + edge / 2` out, its floor at `y`.
 */
export const PAN = { W: 0.3, D: 0.22, H: 0.1, cx: HULL.w / 2 + 0.11, x: HULL.w / 2 + 0.11 - 0.15, y: 0.43, z: -0.04, zOpen: -0.064, yaw: -0.12, tilt: 0.12, lip: 0.06, rim: 2.2 } as const;
/** The pan's transform (body space) for an opening, a crate size and a tip. */
export function panMatrixInto(open: number, fit: number, tip: number, out: Matrix4, s: { t0: Matrix4; v0: Vector3; q0: Quaternion }): Matrix4 {
  const k = smooth(0, 1, clamp(open, 0, 1));
  const w = Math.max(PAN.W, fit + 2 * PAN.lip);
  const sx = 1 + (w / PAN.W - 1) * k;
  const sz = 1 + (w / PAN.D - 1) * k;
  const sy = 1 + (PAN.rim - 1) * k;
  out.makeRotationZ(-clamp(tip, 0, 1.2)).multiply(s.t0.makeRotationY(PAN.yaw * (1 - k))).multiply(s.t0.makeRotationX(PAN.tilt * (1 - k)));
  out.scale(s.v0.set(sx, sy, sz));
  // the pan's sheet is built askew (as it sits stowed): undo that before the opening's square scale
  out.multiply(s.t0.makeRotationX(-PAN.tilt)).multiply(s.t0.makeRotationY(-PAN.yaw));
  // stowed, the inner edge is where the askew pan (its middle on the bracket at `cx`) puts it; open, at `x`
  const x0 = PAN.cx - (PAN.W / 2) * Math.cos(PAN.yaw), z0 = PAN.z + (PAN.W / 2) * Math.sin(PAN.yaw);
  return out.setPosition(x0 + (PAN.x - x0) * k, PAN.y - BODY_Y, z0 + (PAN.zOpen - z0) * k);
}

export type ArmPreset = 'tucked' | 'hang' | 'point' | 'dangle';
export const ARM_PRESETS: readonly ArmPreset[] = ['tucked', 'hang', 'point', 'dangle'];

const A = (yaw: number, swing: number, elbow: number, wrist: number, grip: number): ArmJoints => ({ yaw, swing, elbow, wrist, grip });

/** Arm presets (tuned by eye on renders). */
export const ARMS: Record<ArmPreset, ArmJoints> = {
  // folded against the hull's front corner, out of the way: its working rest
  tucked: A(0.25, 0.35, 2.05, 0.5, 0.2),
  // let down beside the bumper
  hang: A(0.15, 0.75, 1.15, 0.3, 0.35),
  // jabbed up at the card (or at the visitor)
  point: A(-1.0, 2.3, 0.5, 0.0, 0.05),
  // limp: hanging straight down, jaws open
  dangle: A(-0.05, -0.05, 0.05, 0.0, 0.7),
};

/** The rest the cavity is baked in. */
export const NEUTRAL: Required<Omit<RevertPose, 'card' | 'arm' | 'travel'>> & { card: Required<CardPose>; arm: ArmPreset; travel: number } = {
  travel: 0,
  bob: 0,
  pitch: 0,
  roll: 0,
  sag: 0,
  lids: [0, 0],
  slant: [0, 0],
  gaze: [0, 0],
  lamps: [true, true],
  brow: 0,
  browRoll: 0,
  crank: 0,
  card: { lift: 0, open: 0, wobble: 0 },
  arm: 'tucked',
  broom: 0,
  stroke: 0,
  panOpen: 0,
  panFit: 0.8,
  panTip: 0,
};

/**
 * The named poses. Each must read in a still at 90 px. Deadpan is the whole
 * character: its lids are never fully open while it is awake, and it never smiles.
 */
export const POSES = {
  // parked, waiting: flat lids, level brow, looking straight at the visitor
  idle: { lids: [0.42, 0.42], gaze: [0, 0.15], brow: 0.15, arm: 'tucked', crank: 0.5 },
  // under way: the shoes have moved half a pitch, the nose lifts a touch, the lids a little lower
  trundle: { travel: LOOP / TRACK.n / 2, pitch: -0.1, bob: 0.016, roll: 0.02, lids: [0.52, 0.52], gaze: [0.05, 0.0], brow: 0.3, arm: 'tucked', crank: -0.6 },
  // the broom out in front on the bench, pushed, head down to the job
  sweep: { pitch: 0.07, bob: -0.012, roll: 0.035, lids: [0.5, 0.5], gaze: [-0.55, -0.75], brow: 0.35, arm: 'broom', broom: 1, stroke: 0.6, crank: 0.5 },
  // turning its crank: the rewind; it leans into it, one eye squeezed, looking at what it is undoing
  crank: { roll: -0.1, pitch: -0.05, bob: 0.01, lids: [0.86, 0.36], slant: [0.15, -0.05], gaze: [0.45, 0.25], brow: 0.5, browRoll: 0.1, arm: 'tucked', crank: -0.25 },
  // the card up, open, facing the visitor; the arm jabs at it; deadpan stare
  'card-up': { lids: [0.45, 0.45], gaze: [0, 0.3], brow: 0.2, arm: 'point', card: { lift: 1, open: 1 }, crank: 0.5 },
  // picked up: treads sag, arm dangles, eyes rolled up under half-shut lids, crank swung down
  limp: { bob: 0.0, pitch: -0.14, roll: 0.12, sag: 1, lids: [0.5, 0.62], slant: [-0.15, 0.1], gaze: [0.15, 1], brow: -0.6, browRoll: -0.08, arm: 'dangle', crank: Math.PI },
  // parked, powered down: one eye shut, the other still open a slit, watching
  asleep: { bob: -0.03, pitch: 0.08, roll: 0.05, lids: [1, 0.3], gaze: [-0.25, 0.1], lamps: [false, true], brow: 0.2, browRoll: 0.2, arm: 'hang', crank: Math.PI * 0.85 },
  // the face sheet: four expressions held close
  deadpan: { lids: [0.5, 0.5], gaze: [0, 0.2], brow: 0.1, arm: 'tucked', crank: 0.5 },
  glare: { pitch: 0.04, lids: [0.6, 0.6], slant: [0.24, 0.24], gaze: [0.45, 0.2], brow: 1, arm: 'tucked', crank: 0.5 },
  flat: { lids: [0.66, 0.66], gaze: [0, 0], brow: 0.35, arm: 'tucked', crank: 0.5 },
} satisfies Record<string, RevertPose>;

export type PoseName = keyof typeof POSES;
export const POSE_NAMES = Object.keys(POSES) as PoseName[];

// ---- pose → transforms ------------------------------------------------------------------

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const T = (x: number, y: number, z: number): Matrix4 => new Matrix4().makeTranslation(x, y, z);
const RX = (a: number): Matrix4 => new Matrix4().makeRotationX(a);
const RY = (a: number): Matrix4 => new Matrix4().makeRotationY(a);
const RZ = (a: number): Matrix4 => new Matrix4().makeRotationZ(a);
const S = (k: number): Matrix4 => new Matrix4().makeScale(k, k, k);
const chain = (...ms: Matrix4[]): Matrix4 => {
  const o = new Matrix4();
  for (const m of ms) o.multiply(m);
  return o;
};
/** A shown/hidden node's scale (drawing is skinned: nothing is ever made invisible, only shrunk into itself). */
export const HIDDEN = 1e-4;

/**
 * A point on the track loop (in a track's own y-z plane) for an arc length s:
 * position and the angle of its outward normal about X (0 up, pi/2 forward).
 * The loop runs forward along the top, down round the front wheel, back along
 * the bottom and up round the back wheel, so + travel drives Revert forward.
 */
export function loopPoint(s: number, sag = 0): { y: number; z: number; phi: number } {
  const a = TRACK.axleZ;
  const arc = Math.PI * RM;
  let u = s % LOOP;
  if (u < 0) u += LOOP;
  if (u < 2 * a) return { y: AXLE_Y + RM, z: -a + u, phi: 0 };
  u -= 2 * a;
  if (u < arc) {
    const p = u / RM;
    return { y: AXLE_Y + RM * Math.cos(p), z: a + RM * Math.sin(p), phi: p };
  }
  u -= arc;
  if (u < 2 * a) {
    const k = u / (2 * a);
    // the bottom run hangs in a shallow curve when the treads are off the ground
    return { y: AXLE_Y - RM - sag * 0.07 * Math.sin(Math.PI * k), z: a - u, phi: Math.PI - sag * 0.25 * Math.cos(Math.PI * k) };
  }
  u -= 2 * a;
  const p = Math.PI + u / RM;
  return { y: AXLE_Y + RM * Math.cos(p), z: -a + RM * Math.sin(p), phi: p };
}

/** The arm's joints that put the grip centre at `p` (shoulder space) with the elbow up and back. */
export function armReach(p: Vector3): { yaw: number; swing: number; elbow: number } {
  const L1 = UPPER, L2 = FORE + GRIP;
  const h = Math.hypot(p.x, p.z), v = -p.y;
  const yaw = Math.atan2(p.x, p.z);
  const D = clamp(Math.hypot(h, v), Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-3);
  const alpha = Math.atan2(h, v);
  const beta = Math.acos(clamp((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), -1, 1));
  const gamma = Math.acos(clamp((L1 * L1 + L2 * L2 - D * D) / (2 * L1 * L2), -1, 1));
  // the elbow bends up and out of the way (it would otherwise dig into the tread below the shoulder)
  return { yaw, swing: alpha + beta, elbow: -(Math.PI - gamma) };
}

/** The broom's transform in BODY space for a `broom` value and a stroke. */
export function broomMatrix(broom: number, stroke: number): Matrix4 {
  const k = clamp(broom, 0, 1);
  // stowed: over its shoulder like a rifle, along the left flank, the head up behind the back corner, bristles up
  const e = 0.6;
  const stowQ = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(new Vector3(1, 0, 0), new Vector3(0, -Math.sin(e), Math.cos(e)), new Vector3(0, -Math.cos(e), -Math.sin(e))));
  const stowP = new Vector3(-HULL.w / 2 - 0.04, 1.0 - BODY_Y, -0.56);
  // out: head on the bench ahead of the left tread, handle back up to the shoulder, pushed by `stroke`
  const reach = 0.92 + 0.08 * clamp(stroke, -1, 1);
  const outQ = new Quaternion().setFromRotationMatrix(chain(RY(-0.35), RX(-(Math.PI / 2 - 0.55))));
  const outP = new Vector3(-0.78, -BODY_Y + 0.004, reach);
  // in between it rides up and over, so the head clears the tread
  const p = stowP.clone().lerp(outP, smooth(0, 1, k));
  p.y += Math.sin(Math.PI * k) * 0.22;
  p.x -= Math.sin(Math.PI * k) * 0.12;
  const q = stowQ.clone().slerp(outQ, smooth(0.1, 0.9, k));
  return new Matrix4().compose(p, q, new Vector3(1, 1, 1));
}

/** Resolve the arm field into joints (for 'broom', reach for the broom's grip). */
function armJoints(p: Required<Pick<RevertPose, 'broom' | 'stroke'>> & { arm: RevertPose['arm'] }, broomM: Matrix4): ArmJoints {
  const a = p.arm ?? 'tucked';
  if (typeof a === 'object') return a;
  if (a !== 'broom') return ARMS[a];
  const grip = new Vector3(0, broomGrip(p.broom), 0).applyMatrix4(broomM);
  const rel = grip.sub(new Vector3(SHOULDER.x, SHOULDER.y - BODY_Y, SHOULDER.z));
  const r = armReach(rel);
  return { ...r, wrist: 0, grip: 0.1 };
}

/**
 * Every moving node's local transform for a pose (missing fields are the
 * neutral pose). Pure: same pose, same matrices.
 */
export function poseMatrices(pose: RevertPose = {}): Record<string, Matrix4> {
  const p = { ...NEUTRAL, ...pose, card: { ...NEUTRAL.card, ...(pose.card ?? {}) } };
  const m: Record<string, Matrix4> = {};
  m.root = new Matrix4();
  m.chassis = new Matrix4();

  // ---- treads ----
  const [tl, tr] = typeof p.travel === 'number' ? [p.travel, p.travel] : p.travel;
  const sag = clamp(p.sag, 0, 1);
  for (const [side, sx, tv] of [['L', 1, tl], ['R', -1, tr]] as const) {
    for (const [end, z] of [['F', TRACK.axleZ], ['B', -TRACK.axleZ]] as const) m[`wheel${side}${end}`] = chain(T(sx * TRACK.x, AXLE_Y, z), RX(tv / RM));
    for (let i = 0; i < TRACK.n; i++) {
      const q = loopPoint((i * LOOP) / TRACK.n + tv, sag);
      m[`shoe${side}${i}`] = chain(T(sx * TRACK.x, q.y, q.z), RX(q.phi));
    }
  }

  // ---- body ----
  m.body = chain(T(0, BODY_Y + clamp(p.bob, -0.05, 0.08), 0), RX(clamp(p.pitch, -0.25, 0.25)), RZ(-clamp(p.roll, -0.2, 0.2)));
  const b = clamp(p.brow, -1, 1);
  m.brow = chain(T(0, BROW.hingeY - BODY_Y, BROW.hingeZ), RX(b > 0 ? b * BROW.down : b * BROW.up), RZ(-clamp(p.browRoll, -0.2, 0.2)));

  // ---- eyes ----
  let gx = p.gaze[0], gy = p.gaze[1];
  const gl = Math.hypot(gx, gy);
  if (gl > 1) {
    gx /= gl;
    gy /= gl;
  }
  for (const [side, sx, k] of [['L', 1, 0], ['R', -1, 1]] as const) {
    m[`eye${side}`] = chain(T(sx * EYE.x, EYE.y - BODY_Y, faceZ(EYE.y)), RX(-FACE.rake));
    const on = p.lamps[k] ? 1 : HIDDEN;
    m[`lamp${side}`] = chain(T(0, 0, EYE_C), RY(gx * GAZE_MAX), RX(-gy * GAZE_MAX), S(on));
    const l = clamp(p.lids[k], 0, 1);
    const lip = LID.open + (LID.closed - LID.open) * l;
    // a + slant drops the inner corner: for the left eye (+X) the inner corner is toward -X
    m[`lid${side}`] = chain(T(0, 0, EYE_C), RZ(sx * clamp(p.slant[k], -0.5, 0.5)), RX(-lip));
  }

  // ---- crank ----
  m.crank = chain(T(CRANK.x, CRANK.y - BODY_Y, CRANK.z), RX(p.crank));

  // ---- the card ----
  const lift = clamp(p.card.lift, 0, 1.15);
  const open = clamp(p.card.open, 0, 1);
  m.card = cardMatrix(lift, open, p.card.wobble, CARD_ESTIMATE.w);
  m.cardL = RY(-Math.PI * (1 - open));

  // ---- the arm and the broom ----
  const broomM = broomMatrix(p.broom, p.stroke);
  m.broom = broomM;
  const j = armJoints({ arm: p.arm, broom: p.broom, stroke: p.stroke }, broomM);
  m.arm = chain(T(SHOULDER.x, SHOULDER.y - BODY_Y, SHOULDER.z), RY(j.yaw), RX(-j.swing));
  m.forearm = chain(T(0, -UPPER, 0), RX(-j.elbow));
  if (p.arm === 'broom') {
    // the hand turns to close round the handle: its jaw axis (+X in hand space) along the handle
    const handW = chain(m.body!, m.arm!, m.forearm!, T(0, -FORE, 0));
    const handleDir = new Vector3(0, 1, 0).transformDirection(chain(m.body!, broomM));
    const inv = new Matrix4().extractRotation(handW).invert();
    const local = handleDir.clone().transformDirection(inv);
    const q = new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), local);
    m.hand = new Matrix4().compose(new Vector3(0, -FORE, 0), q, new Vector3(1, 1, 1));
  } else {
    m.hand = chain(T(0, -FORE, 0), RX(-j.wrist));
  }
  const jaw = 0.08 + clamp(j.grip, 0, 1) * 0.55;
  m.jaw0 = chain(T(0, -0.035, 0.022), RX(-jaw));
  m.jaw1 = chain(T(0, -0.035, -0.022), RX(jaw));
  m.pan = panMatrixInto(p.panOpen, p.panFit, p.panTip, new Matrix4(), { t0: new Matrix4(), v0: new Vector3(), q0: new Quaternion() });
  return m;
}

/** Card size to lay out with when no label was made (clay, tests): the longest of Revert's four cards at its cap height. */
export const CARD_ESTIMATE = { w: 2.05, h: 1.46 } as const;
/** Revert's cards are typed a hair smaller than the cue card's default, so a folded card fits its deck and still passes 12 px. */
export const CARD_CAP = 0.22;

/** The card node's transform for a lift, an opening and a card width (the folded card is centred on the slot). */
export function cardMatrix(lift: number, open: number, wobble: number, cardW: number, cardH: number = CARD_ESTIMATE.h): Matrix4 {
  const l = clamp(lift, 0, 1.15);
  // the crease sits a quarter card left of centre while folded, so the folded half is centred on the slot;
  // it slides back to the middle as the card opens
  const x = -(cardW / 4) * (1 - clamp(open, 0, 1));
  const travel = cardH + CARD_STICK + 0.06;
  const lean = (CARD_LEAN + wobble) * smooth(0.82, 1, l) * (Math.PI / 180);
  // stowed, it is shrunk into the slot itself (drawing is skinned: nothing is hidden, only shrunk), so it never pokes out under the treads
  if (l < 0.015) return chain(T(x, SLOT.y - BODY_Y - 0.03, SLOT.z), S(HIDDEN));
  return chain(T(x, SLOT.y - BODY_Y, SLOT.z), RX(-lean), T(0, (l - 1) * travel, 0));
}

/** Anything with named children that have a position/quaternion/scale (a realized Object3D). */
interface Posable {
  getObjectByName(name: string): { position: Vector3; quaternion: Quaternion; scale: Vector3 } | undefined;
}

/**
 * Pose a realized Revert (the Object3D `realize` returns, or any ancestor of
 * its nodes): sets every moving node's local transform. `cardW`/`cardH` are
 * the size of the card it was built with (default: the clay estimate).
 */
export function poseRevert(root: Posable, pose: RevertPose = {}, card: { w: number; h: number } = CARD_ESTIMATE): void {
  let s = SCRATCHES.get(root);
  if (!s) {
    s = revertScratch();
    SCRATCHES.set(root, s);
  }
  poseRevertInto(root, pose, card, s);
}
const SCRATCHES = new WeakMap<Posable, RevertScratch>();

/** The pose matrices with the card laid out for a real card size. */
export function poseMatricesFor(pose: RevertPose, card: { w: number; h: number }): Record<string, Matrix4> {
  const ms = poseMatrices(pose);
  const c = { ...NEUTRAL.card, ...(pose.card ?? {}) };
  ms.card = cardMatrix(c.lift, c.open, c.wobble, card.w, card.h);
  return ms;
}

// ---- the same, without allocating (for a view that poses every frame) -----------------------

/** Everything `poseRevertInto` works in: one per realised Revert, made once with `revertScratch()`. */
export interface RevertScratch {
  /** The realised nodes, found on the first call: [matrix, node] pairs. */
  nodes: Array<[Matrix4, { position: Vector3; quaternion: Quaternion; scale: Vector3 }]> | null;
  /** The posing root the nodes were found under. */
  root: Posable | null;
  /** One matrix per moving node (the result). */
  m: Record<string, Matrix4>;
  t0: Matrix4;
  t1: Matrix4;
  v0: Vector3;
  v1: Vector3;
  v2: Vector3;
  q0: Quaternion;
  q1: Quaternion;
  loop: { y: number; z: number; phi: number };
  reach: { yaw: number; swing: number; elbow: number };
  joints: ArmJoints;
}

const SIDE = [['L', 1, 0], ['R', -1, 1]] as const;
const ENDS = [['F', TRACK.axleZ], ['B', -TRACK.axleZ]] as const;
/** Every moving node's name, in the order they are posed. */
export const MOVING_NODES: readonly string[] = (() => {
  const n: string[] = ['chassis'];
  for (const [s] of SIDE) {
    for (const [e] of ENDS) n.push(`wheel${s}${e}`);
    for (let i = 0; i < TRACK.n; i++) n.push(`shoe${s}${i}`);
  }
  n.push('body', 'brow', 'eyeL', 'lampL', 'lidL', 'eyeR', 'lampR', 'lidR', 'crank', 'card', 'cardL', 'broom', 'arm', 'forearm', 'hand', 'jaw0', 'jaw1', 'pan');
  return n;
})();

/** The node names posed in loops, made once (no strings built per frame). */
const WHEELS = SIDE.map(([s]) => ENDS.map(([e]) => `wheel${s}${e}`));
const SHOES = SIDE.map(([s]) => Array.from({ length: TRACK.n }, (_, i) => `shoe${s}${i}`));
const EYES = SIDE.map(([s]) => [`eye${s}`, `lamp${s}`, `lid${s}`] as const);

/** The broom's two end orientations and its stowed place (constants of `broomMatrix`). */
const BROOM_STOW_Q = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(new Vector3(1, 0, 0), new Vector3(0, -Math.sin(0.6), Math.cos(0.6)), new Vector3(0, -Math.cos(0.6), -Math.sin(0.6))));
const BROOM_OUT_Q = new Quaternion().setFromRotationMatrix(new Matrix4().makeRotationY(-0.35).multiply(new Matrix4().makeRotationX(-(Math.PI / 2 - 0.55))));
const BROOM_STOW_P = new Vector3(-HULL.w / 2 - 0.04, 1.0 - BODY_Y, -0.56);
const ONE = new Vector3(1, 1, 1);
const UP = new Vector3(0, 1, 0);
const XAXIS = new Vector3(1, 0, 0);

export function revertScratch(): RevertScratch {
  const m: Record<string, Matrix4> = {};
  for (const n of MOVING_NODES) m[n] = new Matrix4();
  return {
    nodes: null,
    root: null,
    m,
    t0: new Matrix4(),
    t1: new Matrix4(),
    v0: new Vector3(),
    v1: new Vector3(),
    v2: new Vector3(),
    q0: new Quaternion(),
    q1: new Quaternion(),
    loop: { y: 0, z: 0, phi: 0 },
    reach: { yaw: 0, swing: 0, elbow: 0 },
    joints: { yaw: 0, swing: 0, elbow: 0, wrist: 0, grip: 0 },
  };
}

/** `loopPoint` into `out`. */
function loopPointInto(s: number, sag: number, out: { y: number; z: number; phi: number }): void {
  const a = TRACK.axleZ;
  const arc = Math.PI * RM;
  let u = s % LOOP;
  if (u < 0) u += LOOP;
  if (u < 2 * a) {
    out.y = AXLE_Y + RM;
    out.z = -a + u;
    out.phi = 0;
    return;
  }
  u -= 2 * a;
  if (u < arc) {
    const p = u / RM;
    out.y = AXLE_Y + RM * Math.cos(p);
    out.z = a + RM * Math.sin(p);
    out.phi = p;
    return;
  }
  u -= arc;
  if (u < 2 * a) {
    const k = u / (2 * a);
    out.y = AXLE_Y - RM - sag * 0.07 * Math.sin(Math.PI * k);
    out.z = a - u;
    out.phi = Math.PI - sag * 0.25 * Math.cos(Math.PI * k);
    return;
  }
  u -= 2 * a;
  const p = Math.PI + u / RM;
  out.y = AXLE_Y + RM * Math.cos(p);
  out.z = -a + RM * Math.sin(p);
  out.phi = p;
}

/** `armReach` into `out`. */
function armReachInto(p: Vector3, out: { yaw: number; swing: number; elbow: number }): void {
  const L1 = UPPER, L2 = FORE + GRIP;
  const h = Math.hypot(p.x, p.z), v = -p.y;
  const D = clamp(Math.hypot(h, v), Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-3);
  out.yaw = Math.atan2(p.x, p.z);
  out.swing = Math.atan2(h, v) + Math.acos(clamp((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), -1, 1));
  out.elbow = -(Math.PI - Math.acos(clamp((L1 * L1 + L2 * L2 - D * D) / (2 * L1 * L2), -1, 1)));
}

/** `broomMatrix` into `out`. */
export function broomMatrixInto(broom: number, stroke: number, out: Matrix4, s: RevertScratch): Matrix4 {
  const k = clamp(broom, 0, 1);
  const p = s.v0.copy(BROOM_STOW_P).lerp(s.v1.set(-0.78, -BODY_Y + 0.004, 0.92 + 0.08 * clamp(stroke, -1, 1)), smooth(0, 1, k));
  p.y += Math.sin(Math.PI * k) * 0.22;
  p.x -= Math.sin(Math.PI * k) * 0.12;
  const q = s.q0.copy(BROOM_STOW_Q).slerp(BROOM_OUT_Q, smooth(0.1, 0.9, k));
  return out.compose(p, q, ONE);
}

/** `cardMatrix` into `out`. */
export function cardMatrixInto(lift: number, open: number, wobble: number, cardW: number, cardH: number, out: Matrix4, s: RevertScratch): Matrix4 {
  const l = clamp(lift, 0, 1.15);
  const x = -(cardW / 4) * (1 - clamp(open, 0, 1));
  if (l < 0.015) return out.makeScale(HIDDEN, HIDDEN, HIDDEN).setPosition(x, SLOT.y - BODY_Y - 0.03, SLOT.z);
  const travel = cardH + CARD_STICK + 0.06;
  const lean = (CARD_LEAN + wobble) * smooth(0.82, 1, l) * (Math.PI / 180);
  out.makeRotationX(-lean).multiply(s.t0.makeTranslation(0, (l - 1) * travel, 0));
  return out.premultiply(s.t0.makeTranslation(x, SLOT.y - BODY_Y, SLOT.z));
}

/** A rotation (made by `rot`) with a translation in front of it: T(x, y, z) · R. */
const at = (m: Matrix4, x: number, y: number, z: number): Matrix4 => m.setPosition(x, y, z);

/**
 * `poseRevert` without allocating: every moving node's local transform for a pose, into the
 * realised nodes under `root`. The scratch (`revertScratch()`) belongs to that one Revert.
 */
export function poseRevertInto(root: Posable, pose: RevertPose, card: { w: number; h: number }, s: RevertScratch): void {
  const m = s.m;
  const N = NEUTRAL;
  const tv = pose.travel ?? N.travel;
  const tl = typeof tv === 'number' ? tv : tv[0];
  const tr = typeof tv === 'number' ? tv : tv[1];
  const sag = clamp(pose.sag ?? N.sag, 0, 1);

  // ---- treads ----
  m.chassis!.identity();
  for (let si = 0; si < 2; si++) {
    const sx = si === 0 ? 1 : -1;
    const t = si === 0 ? tl : tr;
    for (let e = 0; e < 2; e++) at(m[WHEELS[si]![e]!]!.makeRotationX(t / RM), sx * TRACK.x, AXLE_Y, e === 0 ? TRACK.axleZ : -TRACK.axleZ);
    const shoes = SHOES[si]!;
    for (let i = 0; i < TRACK.n; i++) {
      loopPointInto((i * LOOP) / TRACK.n + t, sag, s.loop);
      at(m[shoes[i]!]!.makeRotationX(s.loop.phi), sx * TRACK.x, s.loop.y, s.loop.z);
    }
  }

  // ---- body ----
  const body = m.body!.makeRotationX(clamp(pose.pitch ?? N.pitch, -0.25, 0.25)).multiply(s.t0.makeRotationZ(-clamp(pose.roll ?? N.roll, -0.2, 0.2)));
  at(body, 0, BODY_Y + clamp(pose.bob ?? N.bob, -0.05, 0.08), 0);
  const b = clamp(pose.brow ?? N.brow, -1, 1);
  at(m.brow!.makeRotationX(b > 0 ? b * BROW.down : b * BROW.up).multiply(s.t0.makeRotationZ(-clamp(pose.browRoll ?? N.browRoll, -0.2, 0.2))), 0, BROW.hingeY - BODY_Y, BROW.hingeZ);

  // ---- eyes ----
  const gz = pose.gaze ?? N.gaze;
  let gx = gz[0], gy = gz[1];
  const gl = Math.hypot(gx, gy);
  if (gl > 1) {
    gx /= gl;
    gy /= gl;
  }
  const lamps = pose.lamps ?? N.lamps;
  const lids = pose.lids ?? N.lids;
  const slant = pose.slant ?? N.slant;
  for (let k = 0; k < 2; k++) {
    const sx = k === 0 ? 1 : -1;
    const [eyeN, lampN, lidN] = EYES[k]!;
    at(m[eyeN]!.makeRotationX(-FACE.rake), sx * EYE.x, EYE.y - BODY_Y, faceZ(EYE.y));
    const on = lamps[k] ? 1 : HIDDEN;
    at(m[lampN]!.makeRotationY(gx * GAZE_MAX).multiply(s.t0.makeRotationX(-gy * GAZE_MAX)).scale(s.v0.set(on, on, on)), 0, 0, EYE_C);
    const lip = LID.open + (LID.closed - LID.open) * clamp(lids[k]!, 0, 1);
    at(m[lidN]!.makeRotationZ(sx * clamp(slant[k]!, -0.5, 0.5)).multiply(s.t0.makeRotationX(-lip)), 0, 0, EYE_C);
  }

  // ---- crank ----
  at(m.crank!.makeRotationX(pose.crank ?? N.crank), CRANK.x, CRANK.y - BODY_Y, CRANK.z);

  // ---- the card ----
  const c = pose.card;
  const open = clamp(c?.open ?? N.card.open, 0, 1);
  cardMatrixInto(c?.lift ?? N.card.lift, open, c?.wobble ?? N.card.wobble, card.w, card.h, m.card!, s);
  m.cardL!.makeRotationY(-Math.PI * (1 - open));

  // ---- the arm and the broom ----
  const broomV = pose.broom ?? N.broom;
  const broomM = broomMatrixInto(broomV, pose.stroke ?? N.stroke, m.broom!, s);
  const arm = pose.arm ?? N.arm;
  let j: ArmJoints;
  if (typeof arm === 'object') j = arm;
  else if (arm !== 'broom') j = ARMS[arm];
  else {
    const grip = s.v1.set(0, broomGrip(broomV), 0).applyMatrix4(broomM).sub(s.v2.set(SHOULDER.x, SHOULDER.y - BODY_Y, SHOULDER.z));
    armReachInto(grip, s.reach);
    j = s.joints;
    j.yaw = s.reach.yaw;
    j.swing = s.reach.swing;
    j.elbow = s.reach.elbow;
    j.wrist = 0;
    j.grip = 0.1;
  }
  at(m.arm!.makeRotationY(j.yaw).multiply(s.t0.makeRotationX(-j.swing)), SHOULDER.x, SHOULDER.y - BODY_Y, SHOULDER.z);
  at(m.forearm!.makeRotationX(-j.elbow), 0, -UPPER, 0);
  if (arm === 'broom') {
    // the hand turns to close round the handle: its jaw axis (+X in hand space) along the handle
    const handW = s.t0.copy(body).multiply(m.arm!).multiply(m.forearm!).multiply(s.t1.makeTranslation(0, -FORE, 0));
    const dir = s.v1.copy(UP).transformDirection(s.t1.copy(body).multiply(broomM));
    const inv = s.t1.extractRotation(handW).invert();
    dir.transformDirection(inv);
    s.q1.setFromUnitVectors(XAXIS, dir);
    m.hand!.compose(s.v2.set(0, -FORE, 0), s.q1, ONE);
  } else at(m.hand!.makeRotationX(-j.wrist), 0, -FORE, 0);
  const jaw = 0.08 + clamp(j.grip, 0, 1) * 0.55;
  at(m.jaw0!.makeRotationX(-jaw), 0, -0.035, 0.022);
  at(m.jaw1!.makeRotationX(jaw), 0, -0.035, -0.022);
  panMatrixInto(pose.panOpen ?? N.panOpen, pose.panFit ?? N.panFit, pose.panTip ?? N.panTip, m.pan!, s);

  // ---- into the nodes ----
  if (s.root !== root || !s.nodes) {
    s.root = root;
    s.nodes = [];
    for (const n of MOVING_NODES) {
      const o = root.getObjectByName(n);
      if (o) s.nodes.push([m[n]!, o]);
    }
  }
  const nodes = s.nodes;
  for (let i = 0; i < nodes.length; i++) nodes[i]![0].decompose(nodes[i]![1].position, nodes[i]![1].quaternion, nodes[i]![1].scale);
}
