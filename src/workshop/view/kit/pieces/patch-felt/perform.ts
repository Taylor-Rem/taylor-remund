/**
 * Patch's performances (REWRITE.md § B5 "Patch", amended 2026-11-18): pure
 * functions of time and a few parameters that return a `PatchPose`. No
 * state, no clock, no simulation: the station view calls them with its own
 * time and the points it knows (sockets turned into Patch's root space) and
 * hands the result to `posePatch`. The same t gives the same pose, so a
 * performance can be scrubbed, reversed, or cut short (blend out of it with
 * `blendTo`).
 *
 * Space. Everything here is in Patch's ROOT space: the seat top is the
 * origin, Patch faces +Z, its own left is +X, one unit is a unit of the
 * piece as built (the bench draws the crew 1.5×: divide world distances by
 * the crew scale). `toRoot` turns a world point into it.
 *
 * Attitude. Unimpressed and faintly amused in every frame: the lids never
 * open past "mildly interested", the head turns slowly and the eyes lead it,
 * the smirk is one-sided, it never waves and it is never hurt.
 *
 * The performances (lengths in seconds, `*_LENGTH`):
 *   job(t, targets)             the job, staged (`JOB_STAGES`, `jobStage`), ~11.5 s
 *   theLook(t, o)               the cord pulled mid-job: the dead plug, then slowly the visitor; holds
 *   held(t, carryVelocity, o)   lifted by the scruff (the root goes at the visitor's hand); loops
 *   climb(t, o)                 put down by the stool: paws on the seat, a hop, a turn, settle, headset, ~3.4 s
 *   returnToStool(t, from, o)   put down anywhere: toddles to the stool's foot, then climb
 *   duck(t, o) / catchCrate(t, o) / bonked(t, o)   a thrown crate, ≤ 1.5 s each
 *   reachJack / reachDrawer     a paw to a point, with the body leaning (and what is still short)
 */
import { Matrix4, Vector3 } from 'three';
import { clamp, clamp01, inOutCubic, inOutQuad, lerp, outBack, outCubic, inCubic, smoothstep } from '../../../anim/ease.ts';
import type { Ease } from '../../../anim/ease.ts';
import {
  EXPRESSIONS, FOREARM, GAZE_MAX, HC, HEAD_SCALE, HIPS, LEG_REST, NECK, NEUTRAL, SCRUFF, SHOULDER, UPPER_ARM, CUP,
  ARM_LIMITS, SIDE_ON, bodyMatrix, poseMatrices, resolveArms,
} from './rig.ts';
import { BOARD_WHOLE, STOOL_SEAT } from '../switchboard/board.ts';
import { POSE as BOARD_POSE } from '../switchboard/pose.ts';
import type { JackName } from '../switchboard/labels.ts';
import { PATCH_TUNING } from '../../../../sim/index.ts';
import { REACH_TABLE } from './reach-table.ts';

/** JSON replacer: numbers to 1e-4 (cache keys that survive float noise). */
const round4 = (_k: string, v: unknown): unknown => (typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v);
import type { ArmJoints, Arms, BodyPlace, LegJoints, PatchPose } from './rig.ts';

export type V3 = [number, number, number];

// ---- the resolved pose and how poses mix ------------------------------------------------

/** Every field of a pose, numeric; the body always about the seat; the arms as joints. */
export interface FullPose {
  body: { at: V3; rot: V3 };
  legs: [LegJoints, LegJoints];
  headset: [number, number];
  folder: number;
  folderOpen: number;
  lean: [number, number];
  twist: number;
  headYaw: number;
  headPitch: number;
  headTilt: number;
  gaze: [number, number];
  lids: [number, number];
  lidsLow: [number, number];
  brows: [number, number];
  browTilt: [number, number];
  mouth: [number, number];
  ears: [number, number];
  boom: number;
  arms: Arms;
  tail: [number, number];
  tailLift: number;
}

const ARM_KEYS: (keyof ArmJoints)[] = ['swing', 'abduct', 'twist', 'elbow', 'wrist', 'roll'];
const LEG_KEYS: (keyof LegJoints)[] = ['lift', 'splay', 'knee'];

/** A body placement about the scruff, re-expressed about the seat (same matrix). */
function seatPlace(b: BodyPlace | undefined): { at: V3; rot: V3 } {
  const rot: V3 = b?.rot ? [...b.rot] : [0, 0, 0];
  if (!b || b.pivot !== 'scruff') return { at: b?.at ? [...b.at] : [0, 0, 0], rot };
  const m = bodyMatrix(b);
  const o = new Vector3().applyMatrix4(m);
  return { at: [o.x, o.y, o.z], rot };
}

/** Resolve a pose (missing fields from NEUTRAL, presets into joints). */
export function resolvePose(p: PatchPose = {}): FullPose {
  const q = { ...NEUTRAL, ...p };
  const arms = resolveArms(q.arms);
  return {
    body: seatPlace(p.body),
    legs: [{ ...q.legs[0] }, { ...q.legs[1] }],
    headset: [...q.headset],
    folder: q.folder,
    folderOpen: q.folderOpen,
    lean: [...q.lean],
    twist: q.twist,
    headYaw: q.headYaw,
    headPitch: q.headPitch,
    headTilt: q.headTilt,
    gaze: [...q.gaze],
    lids: [...q.lids],
    lidsLow: [...q.lidsLow],
    brows: [...q.brows],
    browTilt: [...q.browTilt],
    mouth: [...q.mouth],
    ears: [...q.ears],
    boom: q.boom,
    arms: { left: { ...arms.left }, right: { ...arms.right } },
    tail: [...q.tail],
    tailLift: q.tailLift,
  };
}

const l2 = (a: [number, number], b: [number, number], w: number): [number, number] => [lerp(a[0], b[0], w), lerp(a[1], b[1], w)];
const l3 = (a: V3, b: V3, w: number): V3 => [lerp(a[0], b[0], w), lerp(a[1], b[1], w), lerp(a[2], b[2], w)];
const mixJ = <K extends string>(keys: K[], a: Record<K, number>, b: Record<K, number>, w: number): Record<K, number> => {
  const o = {} as Record<K, number>;
  for (const k of keys) o[k] = lerp(a[k], b[k], w);
  return o;
};

/** Channels a performance can offset in time (overlapping action). */
export type Channel = 'body' | 'head' | 'eyes' | 'face' | 'ears' | 'arms' | 'tail' | 'props';
const CHANNEL_FIELDS: Record<Channel, (keyof FullPose)[]> = {
  body: ['body', 'legs', 'lean', 'twist'],
  head: ['headYaw', 'headPitch', 'headTilt'],
  eyes: ['gaze', 'lids'],
  face: ['lidsLow', 'brows', 'browTilt', 'mouth'],
  ears: ['ears'],
  arms: ['arms'],
  tail: ['tail', 'tailLift'],
  props: ['headset', 'folder', 'folderOpen', 'boom'],
};

/** Mix two resolved poses (w = 0: a, 1: b). The folder is a switch: it follows whichever side w is nearer. */
export function mixPose(a: FullPose, b: FullPose, w: number): FullPose {
  return {
    body: { at: l3(a.body.at, b.body.at, w), rot: l3(a.body.rot, b.body.rot, w) },
    legs: [mixJ(LEG_KEYS, a.legs[0], b.legs[0], w), mixJ(LEG_KEYS, a.legs[1], b.legs[1], w)],
    headset: l2(a.headset, b.headset, w),
    folder: w < 0.5 ? a.folder : b.folder,
    folderOpen: lerp(a.folderOpen, b.folderOpen, w),
    lean: l2(a.lean, b.lean, w),
    twist: lerp(a.twist, b.twist, w),
    headYaw: lerp(a.headYaw, b.headYaw, w),
    headPitch: lerp(a.headPitch, b.headPitch, w),
    headTilt: lerp(a.headTilt, b.headTilt, w),
    gaze: l2(a.gaze, b.gaze, w),
    lids: l2(a.lids, b.lids, w),
    lidsLow: l2(a.lidsLow, b.lidsLow, w),
    brows: l2(a.brows, b.brows, w),
    browTilt: l2(a.browTilt, b.browTilt, w),
    mouth: l2(a.mouth, b.mouth, w),
    ears: l2(a.ears, b.ears, w),
    boom: lerp(a.boom, b.boom, w),
    arms: { left: mixJ(ARM_KEYS, a.arms.left, b.arms.left, w), right: mixJ(ARM_KEYS, a.arms.right, b.arms.right, w) },
    tail: l2(a.tail, b.tail, w),
    tailLift: lerp(a.tailLift, b.tailLift, w),
  };
}

/** Back to a plain `PatchPose` (for `posePatch`). */
export function toPose(f: FullPose): PatchPose {
  return { ...f, body: { at: [...f.body.at], rot: [...f.body.rot] }, arms: { left: { ...f.arms.left }, right: { ...f.arms.right } } };
}

/**
 * Cut a performance short, or leave one for another: blend from where Patch is (`from`) to `to`
 * over `dur` seconds (t from the moment of the cut). Eased; the head goes a little after the eyes.
 */
export function blendTo(from: PatchPose, to: PatchPose, t: number, dur = 0.6): PatchPose {
  const a = resolvePose(from), b = resolvePose(to);
  const w = (lag: number): number => inOutCubic(clamp01((t - lag) / dur));
  const out = mixPose(a, b, w(0.05));
  const eyes = mixPose(a, b, w(0));
  out.gaze = eyes.gaze;
  out.lids = eyes.lids;
  const tail = mixPose(a, b, w(0.15));
  out.tail = tail.tail;
  return toPose(out);
}

// ---- keyframes ---------------------------------------------------------------------------

/** A key: a time and the fields that change there (everything else carries over from the key before). */
export interface Key {
  t: number;
  /** Fields set at this key. `arms` may name one side only (`armL` / `armR` set one arm's joints). */
  set: PatchPose & { armL?: ArmJoints; armR?: ArmJoints; body?: BodyPlace };
  /** The ease INTO this key from the one before (default inOutCubic). */
  ease?: Ease;
}

/** Resolve keys cumulatively into full poses. */
export function bake(start: PatchPose | FullPose, keys: readonly Key[]): Array<{ t: number; pose: FullPose; ease: Ease }> {
  const full = (x: PatchPose | FullPose): x is FullPose => typeof x.arms === 'object' && x.arms !== null && 'left' in x.arms && Array.isArray((x as FullPose).body?.at) && Array.isArray((x as FullPose).body?.rot);
  let cur: FullPose = full(start) ? start : resolvePose(start);
  const out: Array<{ t: number; pose: FullPose; ease: Ease }> = [];
  for (const k of keys) {
    const { armL, armR, body, arms, ...rest } = k.set;
    const next: FullPose = { ...cur, ...(rest as Partial<FullPose>) };
    // pose fields that are pairs/objects: copy so later keys never alias earlier ones
    if (arms !== undefined) next.arms = resolveArms(arms);
    else next.arms = { left: { ...cur.arms.left }, right: { ...cur.arms.right } };
    if (armL) next.arms.left = { ...armL };
    if (armR) next.arms.right = { ...armR };
    if (body) next.body = seatPlace(body);
    if (rest.legs) next.legs = [{ ...rest.legs[0] }, { ...rest.legs[1] }];
    out.push({ t: k.t, pose: next, ease: k.ease ?? inOutCubic });
    cur = next;
  }
  return out;
}

/** Sample baked keys at t (held before the first and after the last). */
export function sample(keys: ReadonlyArray<{ t: number; pose: FullPose; ease: Ease }>, t: number): FullPose {
  if (t <= keys[0]!.t) return keys[0]!.pose;
  const last = keys[keys.length - 1]!;
  if (t >= last.t) return last.pose;
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1]!.t <= t) i++;
  const a = keys[i]!, b = keys[i + 1]!;
  return mixPose(a.pose, b.pose, b.ease((t - a.t) / Math.max(1e-6, b.t - a.t)));
}

/** Per-channel time offsets: + leads (the eyes), - lags (the tail). Seconds. */
export type Offsets = Partial<Record<Channel, number>>;
export const DEFAULT_OFFSETS: Offsets = { eyes: 0.07, body: -0.05, ears: -0.07, tail: -0.2 };

/** Sample with overlapping action: each channel read at its own offset time. */
export function sampleOverlap(keys: ReadonlyArray<{ t: number; pose: FullPose; ease: Ease }>, t: number, off: Offsets = DEFAULT_OFFSETS): FullPose {
  const base = sample(keys, t);
  const out = { ...base } as FullPose;
  for (const ch of Object.keys(off) as Channel[]) {
    const d = off[ch] ?? 0;
    if (!d) continue;
    const s = sample(keys, t + d);
    for (const f of CHANNEL_FIELDS[ch]) (out as unknown as Record<string, unknown>)[f] = s[f];
  }
  return out;
}

// ---- small life on top of a pose -------------------------------------------------------------

/** A blink: 0 → 1 → 0 over 0.2 s, quick down, slower up. */
export function blinkCurve(t: number, at: number, len = 0.2): number {
  const u = (t - at) / len;
  if (u <= 0 || u >= 1) return 0;
  return u < 0.35 ? inOutQuad(u / 0.35) : 1 - inOutQuad((u - 0.35) / 0.65);
}

/** Close the lids for the blinks at the given times (they come down from wherever they are). */
export function withBlinks(p: FullPose, t: number, times: readonly number[]): FullPose {
  let b = 0;
  for (const at of times) b = Math.max(b, blinkCurve(t, at));
  if (b <= 0) return p;
  return { ...p, lids: [lerp(p.lids[0], 1, b), lerp(p.lids[1], 1, b)] };
}

/** Breathing: the chest rises a hair every 3.2 s (a toy's slow breath). */
export function withBreath(p: FullPose, t: number, amp = 1): FullPose {
  const b = Math.sin((t / 3.2) * Math.PI * 2) * 0.012 * amp;
  return { ...p, lean: [p.lean[0] - b, p.lean[1]], headPitch: p.headPitch + b * 0.6 };
}

// ---- where things are (forward kinematics, root space) ------------------------------------------

/** A node's matrix in root space for a pose, by the path of node names from `body`. */
export function nodeMatrix(pose: PatchPose, path: readonly string[]): Matrix4 {
  const ms = poseMatrices(pose);
  const out = new Matrix4();
  for (const n of path) out.multiply(ms[n] ?? new Matrix4());
  return out;
}

const PAW_CONTACT = new Vector3(0, -0.055, 0.0);

/** The middle of a paw's palm in root space (where a crate or a handle is held). */
export function pawPoint(pose: PatchPose, side: 'left' | 'right'): V3 {
  const nm = side === 'left' ? 'L' : 'R';
  const p = PAW_CONTACT.clone().applyMatrix4(nodeMatrix(pose, ['body', 'spine', `arm${nm}`, `forearm${nm}`, `paw${nm}`]));
  return [p.x, p.y, p.z];
}

/** The head's centre in root space. */
export function headPoint(pose: PatchPose): V3 {
  const p = new Vector3(...HC).applyMatrix4(nodeMatrix(pose, ['body', 'spine', 'head']));
  return [p.x, p.y, p.z];
}

/** A headset cup's outer face in root space (side: Patch's own). */
export function cupPoint(pose: PatchPose, side: 'left' | 'right'): V3 {
  const s = side === 'left' ? 1 : -1;
  const p = new Vector3(s * (CUP.x + 0.05) - HC[0], CUP.y, CUP.z).applyMatrix4(nodeMatrix(pose, ['body', 'spine', 'head', 'headset']));
  return [p.x, p.y, p.z];
}

/** The microphone on the boom's end in root space. */
export function micPoint(pose: PatchPose): V3 {
  const p = new Vector3(0.158, -0.108, 0.224).applyMatrix4(nodeMatrix(pose, ['body', 'spine', 'head', 'headset', 'boom']));
  return [p.x, p.y, p.z];
}

/** The scruff in root space for a pose. */
export function scruffPoint(pose: PatchPose): V3 {
  const p = new Vector3(...SCRUFF).applyMatrix4(nodeMatrix(pose, ['body']));
  return [p.x, p.y, p.z];
}

/** World point → Patch's root space, given the root's world matrix (the station's `patch` group, scale included). */
export function toRoot(world: V3, rootWorld: Matrix4): V3 {
  const p = new Vector3(...world).applyMatrix4(rootWorld.clone().invert());
  return [p.x, p.y, p.z];
}

/** Spine frame (root space) for a pose's body, lean and twist. */
function spineFrame(f: Pick<FullPose, 'body' | 'lean' | 'twist'>): Matrix4 {
  // the rig's own body and spine transforms (rig.ts poseMatrices), without the rest of the tree
  const fore = clamp(f.lean[0], -0.25, 0.45), side = clamp(f.lean[1], -0.35, 0.35);
  return bodyMatrix(f.body as BodyPlace)
    .multiply(_s.makeTranslation(0, HIPS.y, HIPS.z))
    .multiply(_s.makeRotationZ(-side))
    .multiply(_s.makeRotationX(fore))
    .multiply(_s.makeRotationY(clamp(f.twist, -0.6, 0.6)));
}
const _s = new Matrix4();

/**
 * Head yaw and pitch (and the eyes' share) to look at a root-space point from a body pose.
 * The head turns `headShare` of the way (0..1); the eyes take the rest, up to their reach.
 */
export function lookAt(f: Pick<FullPose, 'body' | 'lean' | 'twist'>, target: V3, headShare = 1): { headYaw: number; headPitch: number; gaze: [number, number] } {
  const sp = spineFrame(f);
  const neck = new Vector3(0, NECK.y + HC[1] * HEAD_SCALE, NECK.z).applyMatrix4(sp);
  const d = new Vector3(...target).sub(neck);
  const inv = new Matrix4().extractRotation(sp).invert();
  d.applyMatrix4(inv);
  const yaw = Math.atan2(d.x, d.z), pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  const hy = clamp(yaw * headShare, -1.3, 1.3), hp = clamp(pitch * headShare, -0.5, 0.45);
  const gx = clamp((yaw - hy) / GAZE_MAX, -1, 1), gy = clamp((pitch - hp) / (GAZE_MAX * 0.75), -1, 1);
  return { headYaw: hy, headPitch: hp, gaze: [gx, gy] };
}

// ---- reaching: a two-bone arm, honest about its length ------------------------------------------

/** How far past the wrist the palm's middle is (the forearm's working length is FOREARM + this). */
const PALM = 0.055;
export const ARM_REACH = UPPER_ARM + FOREARM + PALM;

/** Solve one arm (spine space target) to joints. Returns the joints and how far the target is out of reach. */
export function solveArm(side: 'left' | 'right', targetSpine: Vector3, base: ArmJoints, exact = false): { joints: ArmJoints; short: number } {
  const a = solveArmAnalytic(side, targetSpine, base);
  return refineArm(side, targetSpine, a.joints, a.short, exact);
}

function solveArmAnalytic(side: 'left' | 'right', targetSpine: Vector3, base: ArmJoints): { joints: ArmJoints; short: number } {
  const s = side === 'left' ? 1 : -1;
  const S = new Vector3(s * SHOULDER.x, SHOULDER.y, SHOULDER.z);
  const D = targetSpine.clone().sub(S);
  const dRaw = D.length();
  const a = UPPER_ARM, b = FOREARM + PALM;
  const d = clamp(dRaw, Math.abs(a - b) + 1e-3, a + b - 1e-3);
  const short = Math.max(0, dRaw - (a + b));
  const dh = D.clone().normalize();
  // the elbow goes out and down and a little back (toward the pole)
  const pole = new Vector3(s * 0.8, -0.5, -0.35);
  const perp = pole.clone().addScaledVector(dh, -pole.dot(dh));
  if (perp.lengthSq() < 1e-8) perp.set(s, 0, 0);
  perp.normalize();
  const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const alpha = Math.acos(cosA);
  const u = dh.clone().multiplyScalar(Math.cos(alpha)).addScaledVector(perp, Math.sin(alpha)).normalize();
  const cosE = clamp((a * a + b * b - d * d) / (2 * a * b), -1, 1);
  const elbow = Math.PI - Math.acos(cosE);
  // the bend direction: the target's side of the upper arm
  const w = dh.clone().addScaledVector(u, -dh.dot(u));
  if (w.lengthSq() < 1e-8) w.copy(perp).negate();
  w.normalize();
  // decompose u = RZ(phi) RX(-sw) (0,-1,0): two branches; take the one with the smaller outward swing
  const branches: Array<{ sw: number; phi: number }> = [];
  const sw1 = Math.asin(clamp(u.z, -1, 1));
  const phi1 = Math.atan2(u.x, -u.y);
  branches.push({ sw: sw1, phi: phi1 });
  branches.push({ sw: Math.PI - sw1, phi: Math.atan2(-u.x, u.y) });
  const wrap = (x: number): number => Math.atan2(Math.sin(x), Math.cos(x));
  let best = branches[0]!, bestCost = Infinity;
  for (const br of branches) {
    const ab = wrap(s * br.phi);
    const cost = Math.max(0, ab - 1.2) + Math.max(0, -0.25 - ab) + Math.max(0, br.sw - 2.4) + Math.max(0, -0.6 - br.sw);
    if (cost < bestCost) {
      bestCost = cost;
      best = { sw: br.sw, phi: wrap(br.phi) };
    }
  }
  const { sw, phi } = best;
  const X0 = new Vector3(Math.cos(phi), Math.sin(phi), 0);
  const Z0 = new Vector3(-Math.sin(sw) * Math.sin(phi), Math.sin(sw) * Math.cos(phi), Math.cos(sw));
  const beta = Math.atan2(w.dot(X0), w.dot(Z0));
  return { joints: { swing: sw, abduct: s * phi, twist: s * beta, elbow, wrist: base.wrist, roll: base.roll }, short };
}

/** The closed-form arm alone (no search): its joints, how far short, and how far outside the rig's limits it is. */
function analyticArm(side: 'left' | 'right', targetSpine: Vector3, base: ArmJoints): { joints: ArmJoints; short: number; outside: number } {
  const r = solveArmAnalytic(side, targetSpine, base);
  let outside = 0;
  for (const k of ARM_KEYS) outside += Math.max(0, ARM_LIMITS[k][0] - r.joints[k], r.joints[k] - ARM_LIMITS[k][1]);
  return { ...r, outside };
}

/** The palm's middle in spine space for an arm's joints (the rig's own chain). */
function palmSpine(side: 'left' | 'right', a: ArmJoints): Vector3 {
  const s = side === 'left' ? 1 : -1;
  const m = new Matrix4().makeTranslation(s * SHOULDER.x, SHOULDER.y, SHOULDER.z)
    .multiply(_m.makeRotationZ(s * a.abduct)).multiply(_m.makeRotationX(-a.swing)).multiply(_m.makeRotationY(s * a.twist))
    .multiply(_m.makeTranslation(0, -UPPER_ARM, 0)).multiply(_m.makeRotationX(-a.elbow))
    .multiply(_m.makeTranslation(0, -FOREARM, 0)).multiply(_m.makeRotationY(s * a.roll)).multiply(_m.makeRotationX(-a.wrist));
  return PAW_CONTACT.clone().applyMatrix4(m);
}
const _m = new Matrix4();

function limited(a: ArmJoints): ArmJoints {
  const o = { ...a };
  for (const k of ARM_KEYS) o[k] = clamp(o[k], ARM_LIMITS[k][0], ARM_LIMITS[k][1]);
  return o;
}

/**
 * Coordinate descent on swing, abduct, twist and elbow inside the rig's limits, from the analytic
 * answer clamped and a few seeds. Prefers the elbow low (never a wave).
 */
function refineArm(side: 'left' | 'right', target: Vector3, start: ArmJoints, short0: number, exact = false): { joints: ArmJoints; short: number } {
  const s0 = limited(start);
  const err = (a: ArmJoints): number => {
    const p = palmSpine(side, a);
    const elbowUp = Math.max(0, Math.sin(a.swing) * Math.cos(a.abduct) * 0 + (a.swing > 1.6 ? a.swing - 1.6 : 0));
    return p.distanceToSquared(target) + elbowUp * 0.002;
  };
  if (Math.sqrt(err(s0)) < 0.01 + short0) return { joints: s0, short: short0 };
  const others: ArmJoints[] = [{ ...s0, swing: 1.2, abduct: 0.3, twist: -0.6, elbow: 1.6 }, { ...s0, swing: 0.6, abduct: 0.2, twist: 0, elbow: 1.0 }, { ...s0, swing: 1.8, abduct: 0.1, twist: -1.0, elbow: 2.0 }];
  // start from whichever seed is already nearest: one descent, not four
  let seed0 = s0, e0 = err(s0);
  for (const o of others) {
    const e = err(limited(o));
    if (e < e0) {
      seed0 = o;
      e0 = e;
    }
  }
  // exact (the bake): every seed, the descent run out; in play: one descent from the nearest seed
  const seeds: ArmJoints[] = exact ? [s0, ...others] : [seed0];
  let best = s0, bestE = err(s0);
  const keys: (keyof ArmJoints)[] = ['swing', 'abduct', 'twist', 'elbow'];
  for (const seed of seeds) {
    let a = limited(seed), e = err(a);
    for (let step = 0.4; step > 0.004; step *= 0.5) {
      for (let it = 0; it < (exact ? 6 : 5); it++) {
        let moved = false;
        for (const k of keys) {
          for (const d of [step, -step]) {
            const b = limited({ ...a, [k]: a[k] + d });
            const eb = err(b);
            if (eb < e) {
              a = b;
              e = eb;
              moved = true;
            }
          }
        }
        if (!moved) break;
      }
    }
    if (e < bestE) {
      best = a;
      bestE = e;
    }
  }
  return { joints: best, short: Math.max(short0, Math.sqrt(bestE) > 0.02 ? Math.sqrt(bestE) : 0) };
}

export interface Reach {
  /** The pose with the arm on the target and the body leant as far as it needed to. */
  pose: PatchPose;
  /** How far the paw is still short of the target (root units): the stool must come this much nearer. */
  short: number;
  /** The direction it is short in (root space, unit), for the station's rail. */
  toward: V3;
}

/**
 * A paw to a root-space point: the body swivels and leans (fore up to 0.42, side up to 0.3) only as much
 * as the arm needs, the paw goes there, the head watches it. `base` is the rest of the pose.
 */
export function reach(target: V3, side: 'left' | 'right', base: PatchPose = EXPRESSIONS.unimpressed, o: { swivel?: number; watch?: boolean } = {}): Reach {
  // the same question gets the same answer; the questions the performances ask on the bench were answered
  // when the piece was built (reach-table.ts, made by the exact search offline), so play never searches
  const key = reachKey(target, side, base, o);
  const hit = reachCache.get(key);
  if (hit) return hit;
  let r: Reach;
  const baked = bakeMode ? undefined : REACH_TABLE[key];
  if (baked) r = fromBaked(baked, target, side, base, o);
  else {
    r = reachUncached(target, side, base, o, bakeMode !== null);
    if (bakeMode) bakeMode.set(key, toBaked(r, side));
    else REACH_MISSES.add(key);
  }
  if (reachCache.size > 512) reachCache.clear();
  reachCache.set(key, r);
  return r;
}
const reachCache = new Map<string, Reach>();

/** Questions answered live (not in the table): a test holds the bench's to none. */
export const REACH_MISSES = new Set<string>();

/** The question's key: its numbers to 1e-4, hashed (FNV-1a, 52 bits) to keep the table small. */
function reachKey(target: V3, side: 'left' | 'right', base: PatchPose, o: { swivel?: number; watch?: boolean }): string {
  const str = JSON.stringify([target, side, base, o.swivel ?? null, o.watch ?? true], round4);
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
  }
  return h1.toString(36) + (h2 & 0xfffff).toString(36);
}

/** A baked answer: [fore, side, twist, short, swing, abduct, armTwist, elbow]. */
type BakedReach = readonly number[];

function toBaked(r: Reach, side: 'left' | 'right'): BakedReach {
  const f = resolvePose(r.pose);
  const a = f.arms[side];
  const q = (v: number): number => Math.round(v * 1e5) / 1e5;
  return [f.lean[0], f.lean[1], f.twist, r.short, a.swing, a.abduct, a.twist, a.elbow].map(q);
}

function fromBaked(b: BakedReach, target: V3, side: 'left' | 'right', base: PatchPose, o: { swivel?: number; watch?: boolean }): Reach {
  const f = resolvePose(base);
  if (o.swivel !== undefined) f.body.rot = [f.body.rot[0], o.swivel, f.body.rot[2]];
  f.lean = [b[0]!, b[1]!];
  f.twist = b[2]!;
  f.arms[side] = { ...f.arms[side], swing: b[4]!, abduct: b[5]!, twist: b[6]!, elbow: b[7]! };
  if (o.watch !== false) {
    const lk = lookAt(f, target, 0.8);
    f.headYaw = lk.headYaw;
    f.headPitch = lk.headPitch;
    f.gaze = lk.gaze;
  }
  const pose = toPose(f);
  // which way it is short: worked out only if someone asks (the performances never do)
  let toward: V3 | null = null;
  return {
    pose,
    short: b[3]!,
    get toward(): V3 {
      if (!toward) {
        const dir = new Vector3(...target).sub(new Vector3(...pawPoint(pose, side)));
        toward = dir.lengthSq() > 1e-10 ? (dir.normalize().toArray() as V3) : [0, 0, 0];
      }
      return toward;
    },
  };
}

/** Bake mode (the offline table maker only): every question is answered by the exact search and recorded. */
let bakeMode: Map<string, BakedReach> | null = null;

/** Run `fn` with every reach answered exactly and recorded; returns the table entries it asked for. For the table maker. */
export function bakeReaches(fn: () => void): Map<string, BakedReach> {
  const out = new Map<string, BakedReach>();
  const saved = new Map(reachCache);
  reachCache.clear();
  keyMemo.clear();
  bakeMode = out;
  try {
    fn();
  } finally {
    bakeMode = null;
    reachCache.clear();
    keyMemo.clear();
    for (const [k, v] of saved) reachCache.set(k, v);
  }
  return out;
}

/** Forget every cached answer and performance (tests). */
export function clearPerformanceCaches(): void {
  reachCache.clear();
  keyMemo.clear();
  REACH_MISSES.clear();
}

/** The leans reachUncached tries (fore, side, twist), in the order of their own penalty, with their old loop index. */
const LEAN_CANDIDATES: ReadonlyArray<{ fore: number; sideL: number; tw: number; floor: number; idx: number }> = (() => {
  const out: Array<{ fore: number; sideL: number; tw: number; floor: number; idx: number }> = [];
  for (let i = 0; i <= 7; i++) {
    for (let j = -3; j <= 3; j++) {
      for (const tw of [-0.3, 0, 0.3]) {
        const fore = (i / 7) * 0.42, sideL = (j / 3) * 0.3;
        out.push({ fore, sideL, tw, floor: fore * 0.15 + Math.abs(sideL) * 0.2 + Math.abs(tw) * 0.1, idx: out.length });
      }
    }
  }
  return out.sort((a, b) => a.floor - b.floor || a.idx - b.idx);
})();

function reachUncached(target: V3, side: 'left' | 'right', base: PatchPose, o: { swivel?: number; watch?: boolean }, exact = false): Reach {
  const f = resolvePose(base);
  const T = new Vector3(...target);
  if (o.swivel !== undefined) f.body.rot = [f.body.rot[0], o.swivel, f.body.rot[2]];
  const armBase = f.arms[side];
  let best: { fore: number; sideL: number; twist: number; short: number; joints: ArmJoints; cost: number; local: Vector3 } | null = null;
  const S = new Vector3((side === 'left' ? 1 : -1) * SHOULDER.x, SHOULDER.y, SHOULDER.z);
  // the least lean that reaches with a little bend left in the elbow; else the closest it can get.
  // Branch and bound (H1): a lean's own penalty is a floor under its cost, so the candidates are tried
  // cheapest floor first and one whose floor is above the best cost so far is skipped. The winner is the
  // same as the full search's: the lowest cost, and among equal costs the first in the old loop order.
  let bestIdx = Infinity;
  for (const c of LEAN_CANDIDATES) {
    if (best && c.floor > best.cost) break;
    const { fore, sideL, tw } = c;
    const sp = spineFrame({ body: f.body, lean: [fore, sideL], twist: tw });
    const local = T.clone().applyMatrix4(sp.clone().invert());
    // the closed-form arm scores each lean (cheap); a lean whose answer leaves the rig's limits pays for it
    // exact (the bake): every lean's arm searched inside the limits; in play the closed form scores them
    const r = exact ? solveArm(side, local, armBase, true) : analyticArm(side, local, armBase);
    const slack = Math.max(0, local.distanceTo(S) - ARM_REACH * 0.93);
    const cost = r.short * 10 + slack * 2 + fore * 0.15 + Math.abs(sideL) * 0.2 + Math.abs(tw) * 0.1;
    if (!best || cost < best.cost || (cost === best.cost && c.idx < bestIdx)) {
      best = { fore, sideL, twist: tw, short: r.short, joints: r.joints, cost, local };
      bestIdx = c.idx;
    }
  }
  const b = best!;
  // only the winner is brought inside the limits (the search, if it needs one)
  const fin = exact ? { joints: b.joints, short: b.short } : refineArm(side, b.local, b.joints, b.short);
  b.joints = fin.joints;
  b.short = fin.short;
  f.lean = [b.fore, b.sideL];
  f.twist = b.twist;
  f.arms[side] = b.joints;
  if (o.watch !== false) {
    const lk = lookAt(f, target, 0.8);
    f.headYaw = lk.headYaw;
    f.headPitch = lk.headPitch;
    f.gaze = lk.gaze;
  }
  const paw = new Vector3(...pawPoint(toPose(f), side));
  const dir = T.clone().sub(paw);
  const toward: V3 = dir.lengthSq() > 1e-10 ? (dir.normalize().toArray() as V3) : [0, 0, 0];
  return { pose: toPose(f), short: b.short, toward };
}

/** The body yaw (swivel on the stool) that turns Patch's front toward a root-space point, limited. */
export function swivelToward(target: V3, max = 2.2): number {
  return clamp(Math.atan2(target[0], target[2]), -max, max);
}

// ---- the board, and the targets a station gives ----------------------------------------------------

/** The crew's drawing scale on the bench. */
export const CREW = 1.5;
/**
 * The station keeps the root at SIDE_ON (the approved rest: side-on, face to the visitor) and Patch swivels
 * on its stool: this body yaw sits it square along the runner, facing -X, its right side to the board
 * (the switchboard's OPERATOR yaw).
 */
export const WORK_SWIVEL = -Math.PI / 2 - SIDE_ON;

/** The seat top in board space with the stool at board x `stoolX` on the runner. */
export function seatAt(stoolX: number): V3 {
  return [stoolX, BOARD_WHOLE.runner.top + STOOL_SEAT, BOARD_WHOLE.runner.z];
}

/** A board-space point in Patch's root space, the stool at board x `stoolX`, the root at SIDE_ON and drawn CREW×. */
export function boardToRoot(p: V3, stoolX: number): V3 {
  const s = seatAt(stoolX);
  const d0 = (p[0] - s[0]) / CREW, d1 = (p[1] - s[1]) / CREW, d2 = (p[2] - s[2]) / CREW;
  const a = -SIDE_ON, c = Math.cos(a), sn = Math.sin(a);
  return [d0 * c + d2 * sn, d1, -d0 * sn + d2 * c];
}

/** Where the stool stands on the runner to work a jack (board x), and where it rests. */
export function workX(jack: JackName): number {
  return BOARD_WHOLE.jackX[jack] + BOARD_WHOLE.stoolDX;
}
export const REST_X = BOARD_WHOLE.stoolRestX;

/** The points the job needs, in Patch's root space at the stool's working position for that jack. */
export interface JobTargets {
  /** The line's lamp on the board (Patch notices it). */
  lamp: V3;
  /** The plug seated in the jack (its grip). */
  plug: V3;
  /** The drawer's pull, shut. */
  handle: V3;
  /** Which way the drawer pulls out (unit) and how far (root units). */
  pull: V3;
  travel: number;
  /** Where a paw taps on the keyshelf. */
  keys: V3;
  /** The thing the job changed, to lean out and look at. */
  thing: V3;
  /** The visitor (the camera), far off in front and above. */
  visitor: V3;
}

/** The visitor in board space: the home camera is far in front of the board and well above it. */
export const VISITOR_BOARD: V3 = [1.2, 9, 16];
/** The visitor from the rest position. */
export const VISITOR: V3 = boardToRoot(VISITOR_BOARD, REST_X);

/**
 * What each line changes, in board space, as seen from the board at its bench placement (stand-ins
 * from the bench plan v0; the station passes the real ones).
 */
export const THINGS_BOARD: Record<JackName, V3> = {
  storefront: [6.5, 1.1, 0.8],
  platen: [3.95, 0.9, 2.4],
  belt: [-1.6, 0.6, 8.0],
  lamp: [-2.4, 3.3, 1.0],
};

/** The job's targets for a jack (board numbers from the switchboard), the thing changed in board space. */
export function jobTargets(jack: JackName, thing: V3 = THINGS_BOARD[jack], visitor: V3 = VISITOR_BOARD): JobTargets {
  const L = BOARD_WHOLE, x = workX(jack), jx = L.jackX[jack];
  const r = (p: V3): V3 => boardToRoot(p, x);
  const plateZ = L.panelZ + L.plateT;
  const zero = r([0, 0, 0]), out = r([0, 0, 1]);
  const n = Math.hypot(out[0] - zero[0], out[1] - zero[1], out[2] - zero[2]);
  const pull: V3 = [(out[0] - zero[0]) / n, (out[1] - zero[1]) / n, (out[2] - zero[2]) / n];
  return {
    lamp: r([jx + L.lampDX, L.jackY, plateZ + 0.07]),
    plug: r([jx, L.jackY, plateZ + 0.086 + 0.3]),
    handle: r([L.drawerX[jack] + 0.17, L.drawerY + 0.01, L.drawerZ + 0.06]),
    pull,
    travel: BOARD_POSE.drawerTravel / CREW,
    keys: r([jx + 0.05, L.shelfY + 0.02, L.shelfZ - 0.08]),
    thing: r(thing),
    visitor: r(visitor),
  };
}
/** The STOREFRONT line's targets (tests and reviews). */
export const DEFAULT_TARGETS: JobTargets = jobTargets('storefront');

// ---- the seated rest ---------------------------------------------------------------------------

/** The seated rest the performances start from and come back to (the unimpressed look at the visitor). */
export const SEATED: PatchPose = EXPRESSIONS.unimpressed;

/** The arm joints for the lap (both paws in it). */
const LAP: Arms = resolveArms('lap');
const REST_ARMS: Arms = resolveArms('rest');

const J = (swing: number, abduct: number, twist: number, elbow: number, wrist: number, roll: number): ArmJoints => ({ swing, abduct, twist, elbow, wrist, roll });

/** Face presets the performances use (only the face fields). */
const FACE = {
  flat: { lids: [0.36, 0.39], lidsLow: [0.2, 0.2], brows: [-0.3, -0.2], browTilt: [-0.15, -0.1], mouth: [0.45, -0.1] },
  alert: { lids: [0.3, 0.32], lidsLow: [0.08, 0.08], brows: [0.15, 0.1], browTilt: [0, 0], mouth: [0.25, -0.05] },
  reading: { lids: [0.36, 0.38], lidsLow: [0.25, 0.25], brows: [-0.2, 0.1], browTilt: [-0.2, 0.15], mouth: [0.2, 0] },
  checking: { lids: [0.28, 0.3], lidsLow: [0.05, 0.05], brows: [0.45, 0.35], browTilt: [0.05, 0], mouth: [0.15, 0] },
  smug: { lids: [0.38, 0.41], lidsLow: [0.55, 0.45], brows: [0.25, -0.3], browTilt: [0.25, -0.1], mouth: [1, 0.35] },
  serene: { lids: [0.5, 0.52], lidsLow: [0.42, 0.42], brows: [0.1, 0.05], browTilt: [0.1, 0.1], mouth: [0.7, 0.2] },
  deadpan: { lids: [0.33, 0.36], lidsLow: [0.24, 0.24], brows: [-0.65, -0.35], browTilt: [-0.35, 0.05], mouth: [-0.15, -0.12] },
  squeezed: { lids: [0.95, 0.95], lidsLow: [0.7, 0.7], brows: [-0.8, -0.8], browTilt: [0.3, 0.3], mouth: [-0.3, -0.3] },
} as const satisfies Record<string, Partial<PatchPose>>;
export { FACE };

/** Sat at a jack, side-on along the runner, looking at the board (the start and end of the job). */
export function atWork(T: JobTargets = DEFAULT_TARGETS): PatchPose {
  // the shoulders a touch to the room; the head toward the lamp only so far as keeps a three-quarter face to the camera
  const base = resolvePose({ ...SEATED, body: { rot: [0, WORK_SWIVEL, 0] }, lean: [0.04, -0.04], twist: 0.1 });
  const lk = lookCheated(base, T.lamp, T.visitor, 0.8, 0.9);
  return toPose({ ...base, ...lk, ...FACE.flat, headTilt: 0.05, ears: [-0.1, -0.2], arms: resolveArms('rest') } as FullPose);
}

// ---- timing: the simulation's stages, played at natural speed ---------------------------------------

/**
 * Every performance is authored FOR the simulation's stage lengths (sim/crew/patch.ts PATCH_TUNING), so
 * the view plays it at natural speed (t = the stage's own seconds) with no scaling. A practised
 * operator's economy: one clear action a beat, anticipation and follow-through sized to the stage.
 */
const T_ = PATCH_TUNING;

const ids = new WeakMap<object, number>();
let nextId = 1;
const idOf = (o: object): number => {
  let i = ids.get(o);
  if (i === undefined) ids.set(o, (i = nextId++));
  return i;
};

/** Baked keys for a performance and its options, kept (a performance is sampled every frame). */
const keyMemo = new Map<string, Array<{ t: number; pose: FullPose; ease: Ease }>>();
function memoKeys(name: string, args: readonly unknown[], build: () => Array<{ t: number; pose: FullPose; ease: Ease }>): Array<{ t: number; pose: FullPose; ease: Ease }> {
  // poses are keyed by identity (a station passes the same object for as long as a performance runs), points by value
  const k = name + JSON.stringify(args.map((a) => (a !== null && typeof a === 'object' && !Array.isArray(a) ? `#${idOf(a)}` : a)), round4);
  let v = keyMemo.get(k);
  if (!v) {
    if (keyMemo.size > 96) keyMemo.clear();
    v = build();
    keyMemo.set(k, v);
  }
  return v;
}

/**
 * Look at a point without turning the face away from the visitor: the head goes toward the target only
 * as far as keeps it within `lim` of the visitor (a three-quarter face at worst); the eyes do the rest.
 */
export function lookCheated(f: Pick<FullPose, 'body' | 'lean' | 'twist'>, target: V3, visitor: V3, share = 0.8, lim = 0.95): { headYaw: number; headPitch: number; gaze: [number, number] } {
  const lt = lookAt(f, target, share), lv = lookAt(f, visitor, 1), full = lookAt(f, target, 1);
  const hy = clamp(lt.headYaw, lv.headYaw - lim, lv.headYaw + lim);
  return { headYaw: hy, headPitch: lt.headPitch, gaze: [clamp((full.headYaw - hy) / GAZE_MAX, -1, 1), lt.gaze[1]] };
}

// ---- 0. noticing a line ---------------------------------------------------------------------------

export const NOTICE_LENGTH: number = T_.notice;
/** A line's lamp lights: the ears go first, the eyes snap to it, the head follows. `lamp` in root space. */
export function notice(t: number, lamp: V3, from: PatchPose = SEATED): PatchPose {
  const L = NOTICE_LENGTH;
  const keys = memoKeys('notice', [lamp, from], () => {
    const f = resolvePose(from);
    const lk = lookAt(f, lamp, 0.7);
    return bake(from, [
      { t: 0, set: toPose(f) },
      { t: L * 0.2, set: { ears: [-0.5, -0.4], ...FACE.alert, gaze: [clamp(lk.gaze[0] + (lk.headYaw - f.headYaw) / GAZE_MAX, -1, 1), clamp(lk.gaze[1] + (lk.headPitch - f.headPitch) / (GAZE_MAX * 0.75), -1, 1)] }, ease: outCubic },
      { t: L * 0.85, set: { headYaw: lk.headYaw, headPitch: lk.headPitch, gaze: lk.gaze, headTilt: 0.04, ...FACE.flat, mouth: [0.3, -0.05], tail: [0.4, -0.1] } },
      { t: L, set: { headPitch: lk.headPitch - 0.02 } },
    ]);
  });
  return toPose(sampleOverlap(keys, t, { eyes: 0.04, ears: -0.04, tail: -0.12, body: -0.03 }));
}

// ---- 1. the roll along the runner -----------------------------------------------------------------

export interface RollOptions {
  /** Board x of the stool where it starts and where it stops (REST_X, or workX(jack)). */
  fromX: number;
  toX: number;
  /** How long the roll takes (s): the simulation's stage (`PatchView.stateLength`). Default: as the simulation would. */
  length?: number;
  /** The pose it starts from (default: the rest at REST_X, else at work). */
  from?: PatchPose;
  /** The pose it ends in (default: the rest at REST_X, else at work facing that jack's lamp). */
  to?: PatchPose;
  /** The visitor in board space. */
  visitor?: V3;
}

export interface RollFrame {
  pose: PatchPose;
  /** The stool's board x on the runner now. */
  stoolX: number;
}

/** The roll's length as the simulation would make it (T.rollWhole for the whole runner, its share for less). */
export function rollLength(fromX: number, toX: number): number {
  const whole = Math.max(1e-6, REST_X - BOARD_WHOLE.runner.x0 - 0.5);
  return Math.min(T_.rollWhole, (T_.rollWhole * Math.abs(toX - fromX)) / whole);
}

/** The roll's beats for a length: the shove before the stool moves, and the stop before the end. */
function rollBeats(L: number): { prep: number; stop: number } {
  const prep = clamp(L * 0.22, 0.05, 0.26);
  const settle = clamp(L * 0.24, 0.06, 0.3);
  return { prep, stop: L - settle };
}

/** The stool's board x through a roll of length L: a give back, the shove, the coast, a hard stop. */
export function rollX(t: number, fromX: number, toX: number, L = rollLength(fromX, toX)): number {
  const D = toX - fromX;
  const { prep, stop } = rollBeats(L);
  if (t <= 0) return fromX;
  if (t >= stop) return toX;
  // the paw pulls the stool the wrong way a hair first
  const back = -Math.sign(D) * Math.min(0.02, Math.abs(D) * 0.05) * Math.sin(Math.PI * clamp01(t / prep));
  if (t <= prep) return fromX + back;
  const u = clamp01((t - prep) / Math.max(1e-6, stop - prep));
  // fast out of the shove, coasting, still moving when the paw catches the shelf (or the end stop)
  const f = 0.72 * (1 - (1 - u) ** 2.2) + 0.28 * u;
  return fromX + D * f;
}

/** The stool's stops on the runner (board x): its rest and one per jack. */
export const STOOL_STOPS: readonly number[] = [BOARD_WHOLE.stoolRestX, ...(Object.keys(BOARD_WHOLE.jackX) as JackName[]).map((j) => BOARD_WHOLE.jackX[j] + BOARD_WHOLE.stoolDX)];
/** A stool position snapped to its stop when it is within a few millimetres of one (the reach questions are asked at the stops). */
export function snapStop(x: number): number {
  for (const s of STOOL_STOPS) if (Math.abs(s - x) < 0.06) return s;
  return x;
}

function nearestTargets(x: number): JobTargets {
  let best: JackName = 'storefront';
  for (const j of Object.keys(BOARD_WHOLE.jackX) as JackName[]) if (Math.abs(workX(j) - x) < Math.abs(workX(best) - x)) best = j;
  return jobTargets(best);
}

/**
 * The roll, at the simulation's speed. A paw on the keyshelf's edge, one shove, and it glides with its
 * legs out and its chin up; on a long glide its eyes come round to the visitor, deadpan. A paw slaps the
 * shelf at the far end; the stool stops and Patch does not quite. Back to the rest it does not bother to
 * turn round: it rides backwards and stops on the end stop. Under half a second it is only a shove.
 */
export function rollTo(t: number, o: RollOptions): RollFrame {
  const { fromX, toX } = o;
  const L = o.length ?? rollLength(fromX, toX);
  const keys = memoKeys('roll', [fromX, toX, L, o.from ?? null, o.to ?? null, o.visitor ?? null], () => rollKeys(o, L));
  const { stop } = rollBeats(L);
  let f = sampleOverlap(keys, t, { eyes: 0.03, ears: -0.06, tail: -0.12, body: -0.02 });
  if (L > 0.8) f = withBlinks(f, t, [stop + 0.12]);
  return { pose: toPose(f), stoolX: rollX(t, fromX, toX, L) };
}

function rollKeys(o: RollOptions, L: number): Array<{ t: number; pose: FullPose; ease: Ease }> {
  const fromX = snapStop(o.fromX), toX = snapStop(o.toX);
  const D = toX - fromX, dir = Math.sign(D) || -1;
  const { prep, stop } = rollBeats(L);
  const toRest = Math.abs(toX - REST_X) < 0.05;
  const fromRest = Math.abs(fromX - REST_X) < 0.05;
  const backward = dir > 0; // facing -X, travelling +X
  const visB = o.visitor ?? VISITOR_BOARD;
  const BW = BOARD_WHOLE;
  const shelfEdge = (x: number): V3 => [clamp(x, -BW.w / 2 + 0.1, BW.w / 2 - 0.05), BW.shelfY + 0.015, BW.shelfZ + 0.02];
  const start = resolvePose(o.from ?? (fromRest ? SEATED : atWork(nearestTargets(fromX))));
  const end = resolvePose(o.to ?? (toRest ? SEATED : atWork(nearestTargets(toX))));
  const glideBody = resolvePose({ body: { rot: [0, WORK_SWIVEL, 0] }, lean: [-0.1, 0], twist: 0 });
  // the paw on the shelf to shove off; the paw on the shelf at the far end to stop
  const grabF = resolvePose(reach(boardToRoot(shelfEdge(fromX - 0.35), fromX), 'right', toPose({ ...glideBody, lean: [0.12, -0.08] }), { swivel: WORK_SWIVEL, watch: false }).pose);
  const brakeF = resolvePose(reach(boardToRoot(shelfEdge(toX - 0.3), toX), 'right', toPose({ ...glideBody, lean: [0.2, -0.05] }), { swivel: WORK_SWIVEL, watch: false }).pose);
  const lkVis = lookAt(glideBody, boardToRoot(visB, (fromX + toX) / 2), 0.9);
  const lkAhead = lookAt(glideBody, boardToRoot([fromX - 2, 1.0, BW.runner.z], fromX), 0.9);
  const legsOut: [LegJoints, LegJoints] = [{ lift: 0.45, splay: 0.12, knee: -0.95 }, { lift: 0.4, splay: 0.1, knee: -0.85 }];
  const legsTuck: [LegJoints, LegJoints] = [{ lift: -0.15, splay: 0.05, knee: 1.1 }, { lift: -0.1, splay: 0.05, knee: 1.15 }];
  const trail = J(-0.35, 0.22, 0.1, 0.35, 0.2, 0.6);
  const G = stop - prep;
  const keys: Key[] = [{ t: 0, set: toPose(start) }];
  if (L < 0.5) {
    // a short hop along the runner: a paw on the shelf, one shove, and it is there
    keys.push(
      { t: prep, set: { body: { rot: [0, WORK_SWIVEL, 0] }, lean: grabF.lean, twist: grabF.twist, armR: grabF.arms.right, headYaw: backward ? 0.6 : lkAhead.headYaw * 0.5 + 0.25, headPitch: 0.05, ...FACE.flat, ears: [0.2, 0.2] } },
      { t: stop, set: { lean: [-0.08, 0], armR: trail, tail: [0.2, 0.25 * dir] }, ease: outCubic },
      { t: stop + (L - stop) * 0.5, set: { lean: backward ? [-0.14, 0] : [0.22, -0.03], ears: [-0.4, -0.3], headset: [0, backward ? -0.06 : 0.06] }, ease: outCubic },
      { t: L, set: { ...toPose(end), legs: [LEG_REST, LEG_REST] } },
    );
  } else {
    keys.push(
      // square along the runner, the paw on the shelf's edge, the legs drawn under: the wind-up
      { t: prep * 0.65, set: { body: { rot: [0, WORK_SWIVEL, 0] }, lean: [grabF.lean[0] + 0.08, grabF.lean[1]], twist: grabF.twist, armR: grabF.arms.right, legs: legsTuck, headYaw: backward ? 0.7 : lkAhead.headYaw * 0.5 + 0.25, headPitch: 0.05, gaze: [0.3, 0], ...FACE.flat, ears: [0.2, 0.2], tail: [0.6, 0] } },
      // the shove and the kick
      { t: prep + 0.05, set: { legs: legsOut, lean: backward ? [0.2, 0] : [-0.16, 0], armR: backward ? J(1.2, 0.15, -0.3, 0.1, 0.2, 0.3) : trail, headPitch: 0.12 }, ease: outCubic },
      // the glide: chin up, eyes half shut, ears back, tail streaming
      { t: prep + Math.min(0.2, G * 0.3), set: { lean: [-0.1, 0], twist: 0, armR: trail, armL: J(0.45, 0.1, 0.2, 1.0, 0, 0.9), headYaw: backward ? 0.9 : lkAhead.headYaw * 0.4, headPitch: 0.2, headTilt: 0.06, gaze: [0, 0.1], ...FACE.serene, ears: [0.85, 0.75], tail: [-0.3, 0.2 * dir], tailLift: 0.5, boom: 0.18, headset: [0, -0.06] } },
    );
    // a long glide: the head comes round to the visitor, deadpan, as if this were nothing
    if (G > 0.45) keys.push({ t: prep + G * 0.55, set: { headYaw: lkVis.headYaw, headPitch: lkVis.headPitch, gaze: lkVis.gaze, ...FACE.deadpan, mouth: [0.35, -0.1] }, ease: inOutQuad });
    keys.push(
      backward
        ? { t: stop - 0.04, set: { lean: [-0.06, 0], legs: legsOut } }
        : { t: stop - 0.04, set: { armR: brakeF.arms.right, lean: [0.0, -0.05], twist: brakeF.twist, headYaw: lkAhead.headYaw * 0.6, headPitch: 0.05, gaze: [0, -0.1] }, ease: inOutQuad },
      // the stool stops; Patch does not
      { t: stop + (L - stop) * 0.35, set: { lean: backward ? [-0.25, 0] : [0.42, -0.04], headPitch: backward ? 0.3 : -0.12, legs: backward ? legsTuck : [{ lift: 0.6, splay: 0.1, knee: -1.2 }, { lift: 0.55, splay: 0.1, knee: -1.1 }], ears: [-0.6, -0.5], tail: [0.9, -0.3 * dir], tailLift: 0.3, boom: -0.1, headset: [0.04, backward ? -0.12 : 0.12], ...FACE.flat, lids: [0.38, 0.4] }, ease: outCubic },
      { t: L, set: { ...toPose(end), legs: [LEG_REST, LEG_REST] } },
    );
  }
  return bake(toPose(start), keys);
}

// ---- 2. the cord moved to another jack (attract mode) --------------------------------------------

export const PLUG_LENGTH: number = T_.plug;

export interface PlugFrame {
  pose: PatchPose;
  /** The right paw's palm (root space): the view draws the plug there. */
  paw: V3;
}

/**
 * The cord moved by Patch from one jack to another (the stool at `stoolX`): a paw to the plug, a yank that
 * brings it out on its cord, across, and home in the new jack, the head following the plug.
 */
export function movePlug(t: number, fromJack: JackName, toJack: JackName, stoolX: number, from: PatchPose = SEATED): PlugFrame {
  const U = clamp01(t / PLUG_LENGTH);
  const K = memoKeys('plug', [fromJack, toJack, snapStop(stoolX), from], () => {
    const BW = BOARD_WHOLE;
    stoolX = snapStop(stoolX);
    const grip = (j: JackName): V3 => boardToRoot([BW.jackX[j], BW.jackY, BW.panelZ + BW.plateT + 0.3], stoolX);
    const base = atWork(jobTargets(toJack));
    const a = grip(fromJack), b = grip(toJack);
    const mid: V3 = [(a[0] + b[0]) / 2 + 0.05, Math.max(a[1], b[1]) - 0.02, (a[2] + b[2]) / 2 + 0.2];
    const r = (p: V3): FullPose => resolvePose(reach(p, 'right', base, { swivel: WORK_SWIVEL }).pose);
    const s = resolvePose(from);
    return [{ t: 0, pose: s, ease: inOutCubic }, { t: 0.3, pose: r(a), ease: inOutCubic }, { t: 0.5, pose: r(mid), ease: outCubic }, { t: 0.85, pose: r(b), ease: inOutQuad }, { t: 1, pose: mixPose(r(b), s, 0.25), ease: inOutCubic }];
  });
  const pose = toPose(sample(K, U));
  return { pose, paw: pawPoint(pose, 'right') };
}

// ---- 3. the job ---------------------------------------------------------------------------------

/** After the reply, the view's own follow-through (the folder back in its drawer, the drawer shut), s. */
export const SHUT_LENGTH = 0.9;

/** The job's stages at the jack, at the simulation's lengths (`notice` and `rollTo` come before, `rollTo` back after). */
export const JOB_STAGES = (() => {
  const out: Array<{ name: 'drawer' | 'work' | 'check' | 'reply' | 'shut'; at: number; dur: number }> = [];
  let at = 0;
  for (const [name, dur] of [['drawer', T_.drawer], ['work', T_.work], ['check', T_.check], ['reply', T_.reply], ['shut', SHUT_LENGTH]] as const) {
    out.push({ name, at, dur });
    at += dur;
  }
  return out;
})();
export type JobStage = (typeof JOB_STAGES)[number]['name'];
export const JOB_LENGTH: number = JOB_STAGES.reduce((a, s) => a + s.dur, 0);
const stageAt = (n: JobStage): { at: number; dur: number } => JOB_STAGES.find((s) => s.name === n)!;

export interface JobFrame {
  pose: PatchPose;
  /** The drawer for this jack: 0 shut .. 1 out (the station poses the board with it). */
  drawer: number;
  stage: JobStage;
  /** 0..1 through the stage. */
  u: number;
}

const jobCache = new WeakMap<JobTargets, Array<{ t: number; pose: FullPose; ease: Ease }>>();

function jobKeys(T: JobTargets): Array<{ t: number; pose: FullPose; ease: Ease }> {
  const hit = jobCache.get(T);
  if (hit) return hit;
  const pull = new Vector3(...T.pull).normalize();
  const along = (v: V3, k: number, dy = 0): V3 => [v[0] + pull.x * k, v[1] + pull.y * k + dy, v[2] + pull.z * k];
  const out = along(T.handle, T.travel);
  const inside = along(T.handle, T.travel - 0.2, 0.03);
  const start = atWork(T);
  const work: PatchPose = { ...start, body: { rot: [0, WORK_SWIVEL, 0] } };
  const reachR = (p: V3, base: PatchPose): PatchPose => reach(p, 'right', base, { swivel: WORK_SWIVEL }).pose;
  const onHandle = resolvePose(reachR(T.handle, work));
  const pulled = resolvePose(reachR(out, work));
  const inDrawer = resolvePose(reachR(inside, work));
  // the drawer is low on its right: the head goes down to it only so far as keeps a three-quarter face to the camera
  const lkHandle = lookCheated(resolvePose(work), T.handle, T.visitor, 0.6, 0.9);
  // the folder held up before the chest in the right paw; reading, it swivels off the board toward the room
  const lapFolder: ArmJoints = J(0.95, -0.05, -0.65, 1.6, 0.4, -0.5);
  const readBody = resolvePose({ ...work, body: { rot: [0, WORK_SWIVEL + 0.75, 0] }, lean: [0.1, 0], twist: 0.15 });
  const folderAt: V3 = pawPoint(toPose({ ...readBody, arms: { left: LAP.left, right: lapFolder } }), 'right');
  const lkFolder = lookAt(readBody, [folderAt[0], folderAt[1] + 0.02, folderAt[2]], 0.7);
  // the check: swivel round toward the bench past the visitor, lean OUT over the runner, the face to the camera
  const swCheck = clamp(swivelToward(T.thing, 2.2), WORK_SWIVEL + 0.6, 1.9);
  const thingDir = new Vector3(...T.thing).applyMatrix4(new Matrix4().makeRotationY(-swCheck)).setY(0).normalize();
  const leanOut: [number, number] = [clamp(thingDir.z * 0.36, 0.1, 0.4), clamp(thingDir.x * 0.32, -0.3, 0.3)];
  const checkBody = resolvePose({ body: { rot: [0, swCheck, 0] }, lean: leanOut, twist: 0.1 });
  const lkThing = lookCheated(checkBody, T.thing, T.visitor, 0.85, 1.2);
  // the reply: square to the visitor (whatever it checked), a paw to the mic, a few words
  const swReply = 0.45;
  const replyBody = resolvePose({ body: { rot: [0, swReply, 0] }, lean: [0.02, 0], twist: 0 });
  const lkVis = lookAt(replyBody, T.visitor, 0.8);
  const replyBase: PatchPose = { ...SEATED, body: { rot: [0, swReply, 0] }, lean: [0.02, -0.04], twist: 0.05, headYaw: lkVis.headYaw, headPitch: lkVis.headPitch, headTilt: 0.12 };
  const mic = micPoint({ ...replyBase, boom: -0.18 });
  const micArm = resolvePose(reach([mic[0] + 0.02, mic[1] - 0.03, mic[2] + 0.02], 'left', replyBase, { watch: false }).pose).arms.left;

  const D = stageAt('drawer'), W = stageAt('work'), C = stageAt('check'), R = stageAt('reply'), S = stageAt('shut');
  const d = (k: number): number => D.at + D.dur * k, w = (k: number): number => W.at + W.dur * k;
  const c = (k: number): number => C.at + C.dur * k, r = (k: number): number => R.at + R.dur * k, s = (k: number): number => S.at + S.dur * k;
  const keys: Key[] = [
    { t: 0, set: { ...start } },
    // drawer: one reach to the pull (the head down to it, the face kept to the room), a tug, a dip in for the folder
    { t: d(0.3), set: { body: { rot: [0, WORK_SWIVEL, 0] }, lean: onHandle.lean, twist: onHandle.twist, armR: onHandle.arms.right, ...lkHandle, ...FACE.flat, mouth: [0.2, -0.05], ears: [-0.2, -0.1] }, ease: inOutQuad },
    { t: d(0.4), set: { lean: addL(onHandle.lean, -0.05, 0) } },
    { t: d(0.72), set: { lean: pulled.lean, twist: pulled.twist, armR: pulled.arms.right, tail: [0.2, -0.25] }, ease: inOutQuad },
    { t: d(0.95), set: { lean: inDrawer.lean, twist: inDrawer.twist, armR: inDrawer.arms.right, headPitch: lkHandle.headPitch - 0.05 } },
    { t: d(0.98), set: { folder: 1 } },
    // work: up with the folder, swivelled to the room; the cover flipped; one read down it; one decisive tap
    { t: w(0.28), set: { body: { rot: [0, WORK_SWIVEL + 0.75, 0] }, lean: readBody.lean, twist: readBody.twist, armR: lapFolder, headYaw: lkFolder.headYaw, headPitch: lkFolder.headPitch, gaze: lkFolder.gaze, ...FACE.reading, ears: [0, 0.1] } },
    { t: w(0.38), set: { armL: J(0.95, -0.25, -0.7, 1.55, 0.2, 0.3) } },
    { t: w(0.5), set: { folderOpen: 1, armL: LAP.left, gaze: [lkFolder.gaze[0] - 0.25, lkFolder.gaze[1] + 0.1] }, ease: inOutQuad },
    { t: w(0.72), set: { gaze: [lkFolder.gaze[0] + 0.2, lkFolder.gaze[1] - 0.12], browTilt: [-0.3, 0.25] } },
    { t: w(0.82), set: { armL: J(1.05, -0.2, -0.6, 1.3, 0.3, 0.3) } },
    { t: w(0.9), set: { armL: J(1.0, -0.2, -0.6, 1.2, -0.1, 0.3), mouth: [0.5, 0] }, ease: inCubic },
    { t: w(1.0), set: { armL: LAP.left } },
    // check: round toward the bench (the face comes back to the camera), leaning out over the runner; a look; a nod
    { t: c(0.32), set: { body: { rot: [0, swCheck, 0] }, lean: leanOut, twist: 0.1, ...lkThing, headTilt: 0.2, ...FACE.checking, ears: [-0.7, -0.5], tail: [0.5, 0.35], folderOpen: 0, armL: J(0.55, 0.35, -0.5, 0.6, 0.2, 0.9), armR: J(0.55, 0.1, -0.5, 1.5, 0.3, -0.5) }, ease: inOutQuad },
    { t: c(0.58), set: { headPitch: lkThing.headPitch - 0.05, gaze: [lkThing.gaze[0] + 0.1, lkThing.gaze[1] - 0.05], lids: [0.34, 0.36] } },
    { t: c(0.76), set: { headPitch: lkThing.headPitch - 0.22, lean: addL(leanOut, 0.04, 0), ...FACE.smug, mouth: [0.8, 0.2] }, ease: inOutQuad },
    { t: c(0.92), set: { headPitch: lkThing.headPitch + 0.02 }, ease: outCubic },
    { t: c(1.0), set: { headPitch: lkThing.headPitch - 0.03 } },
    // reply: upright, square to the visitor, a paw to the mic, a few words
    { t: r(0.3), set: { ...pick(replyBase, ['body', 'lean', 'twist', 'headYaw', 'headPitch', 'headTilt']), gaze: lkVis.gaze, armL: micArm, boom: -0.18, ...FACE.flat, mouth: [0.1, 0.25], tail: [0.2, 0] } },
    { t: r(0.45), set: { mouth: [0.55, -0.1] } },
    { t: r(0.6), set: { mouth: [0.05, 0.3] } },
    { t: r(0.75), set: { mouth: [0.6, 0.0] } },
    { t: r(1.0), set: { boom: 0, armL: REST_ARMS.left, ...FACE.smug, mouth: [0.7, -0.05] } },
    // shut (the view's follow-through): the folder back in its drawer, the drawer shoved home
    { t: s(0.35), set: { body: { rot: [0, WORK_SWIVEL, 0] }, lean: inDrawer.lean, twist: clamp(inDrawer.twist + 0.25, -0.6, 0.6), armR: inDrawer.arms.right, ...lkHandle, ...FACE.flat } },
    { t: s(0.42), set: { folder: 0 } },
    { t: s(0.58), set: { lean: pulled.lean, twist: clamp(pulled.twist + 0.2, -0.6, 0.6), armR: pulled.arms.right } },
    { t: s(0.78), set: { lean: onHandle.lean, twist: onHandle.twist, armR: onHandle.arms.right }, ease: inOutQuad },
    { t: s(1.0), set: { ...start } },
  ];
  const baked = bake(start, keys);
  jobCache.set(T, baked);
  return baked;
}

function pick<K extends keyof PatchPose>(p: PatchPose, ks: K[]): Pick<PatchPose, K> {
  const o = {} as Pick<PatchPose, K>;
  for (const k of ks) if (p[k] !== undefined) o[k] = p[k];
  return o;
}
const addL = (l: [number, number], a: number, b: number): [number, number] => [l[0] + a, l[1] + b];

/** The drawer's travel through the job (0 shut .. 1 out). */
function drawerAt(t: number): number {
  const D = stageAt('drawer'), S = stageAt('shut');
  const o0 = D.at + D.dur * 0.4, o1 = D.at + D.dur * 0.72;
  const c0 = S.at + S.dur * 0.58, c1 = S.at + S.dur * 0.78;
  if (t < o0) return 0;
  if (t < o1) return inOutQuad((t - o0) / (o1 - o0));
  if (t < c0) return 1;
  if (t < c1) return 1 - inOutQuad((t - c0) / (c1 - c0));
  return 0;
}

/** The job at time t (0..JOB_LENGTH; held at the ends). Each stage plays at the simulation's speed. */
export function job(t: number, targets: JobTargets = DEFAULT_TARGETS): JobFrame {
  const keys = jobKeys(targets);
  let f = sampleOverlap(keys, t, { eyes: 0.04, body: -0.03, ears: -0.05, tail: -0.12 });
  f = withBlinks(f, t, [stageAt('work').at + 0.15, stageAt('reply').at + 0.05]);
  f = withBreath(f, t, 0.6);
  let st: (typeof JOB_STAGES)[number] = JOB_STAGES[0]!;
  for (const s of JOB_STAGES) if (t >= s.at) st = s;
  return { pose: toPose(f), drawer: drawerAt(t), stage: st.name, u: clamp01((t - st.at) / st.dur) };
}

/** One stage of the job, u 0..1 through it (play u backwards to reverse it). */
export function jobStage(stage: JobStage, u: number, targets: JobTargets = DEFAULT_TARGETS): JobFrame {
  const st = stageAt(stage);
  return job(st.at + clamp01(u) * st.dur, targets);
}

/** A paw on the plug seated in a jack (root space), the body swivelled side-on along the runner; and what is short. */
export function reachJack(plug: V3, base: PatchPose = atWork()): Reach {
  return reach(plug, 'right', base, { swivel: WORK_SWIVEL });
}

/** A paw on a drawer's pull (root space), side-on along the runner; and what is short. */
export function reachDrawer(handle: V3, base: PatchPose = atWork()): Reach {
  return reach(handle, 'right', base, { swivel: WORK_SWIVEL });
}

// ---- 4. the look ---------------------------------------------------------------------------------

export interface LookOptions {
  /** The dead plug (root space). */
  plug: V3;
  visitor?: V3;
  /** Where Patch was when the cord came out (default the seated rest). */
  from?: PatchPose;
}
/** The stare at the dead plug, then the look at the visitor: the simulation's two stages; after them it holds. */
export const STARE_LENGTH: number = T_.stare;
export const LOOK_LENGTH: number = T_.stare + T_.look;

/**
 * The cord pulled out mid-job. Patch stops; its eyes drop to the dead plug and the head follows (cheated
 * toward the visitor: a three-quarter face at worst). A beat on the plug. Then the eyes alone come round
 * to the visitor, and the head follows partway, heavier-lidded, one brow down; the tail flicks once.
 * Then it holds, blinking now and then, for as long as the plug is out.
 */
export function theLook(t: number, o: LookOptions): PatchPose {
  const from = o.from ?? SEATED;
  const vis = o.visitor ?? VISITOR;
  const A = STARE_LENGTH, L = LOOK_LENGTH;
  const keys = memoKeys('look', [o.plug, vis, from], () => {
    const f0 = resolvePose(from);
    // the body settles out of whatever it was doing: upright, the shoulders turned a little to the room
    const settle: FullPose = { ...f0, lean: [f0.lean[0] * 0.4 + 0.04, f0.lean[1] * 0.3], twist: clamp(f0.twist * 0.4 + 0.15, -0.6, 0.6) };
    const lkPlug = lookCheated(settle, o.plug, vis, 0.65, 0.95);
    const full = lookAt(settle, vis, 1);
    const headTo = { headYaw: lerp(lkPlug.headYaw, full.headYaw, 0.62), headPitch: lerp(lkPlug.headPitch, full.headPitch, 0.62) };
    const eyesOn = (hy: number, hp: number): [number, number] => [clamp((full.headYaw - hy) / GAZE_MAX, -1, 1), clamp((full.headPitch - hp) / (GAZE_MAX * 0.75), -1, 1)];
    return bake(from, [
      { t: 0, set: toPose(f0) },
      // it stops; the eyes drop to the plug
      { t: A * 0.18, set: { ears: [-0.35, -0.3], lids: [0.36, 0.38], gaze: [clamp(lkPlug.gaze[0] + (lkPlug.headYaw - f0.headYaw) / GAZE_MAX, -1, 1), clamp(lkPlug.gaze[1] + (lkPlug.headPitch - f0.headPitch) / (GAZE_MAX * 0.75), -1, 1)] }, ease: outCubic },
      // the head follows; the body comes upright; whatever it holds, it keeps holding
      { t: A * 0.7, set: { ...lkPlug, headTilt: -0.06, lean: settle.lean, twist: settle.twist, lids: [0.4, 0.42], boom: 0, armL: mixJ(ARM_KEYS, settle.arms.left, LAP.left, 0.6) as ArmJoints, armR: f0.folder >= 0.5 ? { ...settle.arms.right, swing: settle.arms.right.swing - 0.45, elbow: settle.arms.right.elbow - 0.3 } : (mixJ(ARM_KEYS, settle.arms.right, LAP.right, 0.6) as ArmJoints) }, ease: inOutCubic },
      { t: A, set: { lids: [0.38, 0.4], lidsLow: [0.2, 0.2], ears: [0.15, 0.2], brows: [-0.2, -0.1] } },
      // the eyes alone come round to the visitor
      { t: A + (L - A) * 0.38, set: { gaze: eyesOn(lkPlug.headYaw, lkPlug.headPitch), brows: [-0.6, -0.25], browTilt: [-0.35, 0.05], mouth: [0.05, -0.1], lidsLow: [0.32, 0.32] }, ease: inOutQuad },
      // the head follows, partway; heavier lids; the deadpan
      { t: L, set: { ...headTo, headTilt: 0.08, gaze: eyesOn(headTo.headYaw, headTo.headPitch), ...FACE.deadpan, ears: [0.35, 0.25] }, ease: inOutCubic },
      { t: L + 0.5, set: { mouth: [0.25, -0.1] } },
    ]);
  });
  let f = sampleOverlap(keys, t, { eyes: 0.03, body: -0.05, ears: -0.05, tail: -0.15 });
  // the tail: one flick as the eyes arrive
  const flick = Math.exp(-(((t - (A + (L - A) * 0.45)) / 0.18) ** 2));
  f = { ...f, tail: [f.tail[0] + 0.5 * flick, f.tail[1] + 0.35 * flick] };
  // holding: blink now and then (the first one slow: the look)
  const holds = [L + 0.6];
  for (let k = 0; k < 40; k++) holds.push(L + 2.8 + k * 3.7 + (k % 3) * 0.6);
  f = withBlinks(f, t, holds);
  f = withBreath(f, t, t > L ? 1 : 0.3);
  return toPose(f);
}

// ---- 5. lifted, and back to the stool ------------------------------------------------------------

export interface HeldOptions {
  visitor?: V3;
  /** Body yaw while hanging (radians, root space; default: turned to keep its face to the visitor). */
  yaw?: number;
}

/**
 * Held up by the scruff. The station puts the `patch` group's origin at the visitor's hand (the scruff hangs
 * from it) and passes the hand's velocity in root space (units/s; smooth it: a damped follower, about
 * 0.15 s). Patch hangs limp-armed, the legs and tail dangling and swinging behind the motion, its eyes
 * half-lidded on the visitor. The swing settles but never quite stops.
 */
export function held(t: number, carryVelocity: V3 = [0, 0, 0], o: HeldOptions = {}): PatchPose {
  const vis = o.visitor ?? VISITOR;
  const [vx, , vz] = carryVelocity;
  const yaw = o.yaw ?? clamp(Math.atan2(vis[0], vis[2]) * 0.75, -1.6, 1.6);
  // the pick-up jolt: a pendulum swing that decays; the drag of being carried tips the body behind the hand
  const decay = Math.exp(-t / 1.1);
  const swing = 0.22 * decay * Math.sin(t * 5.4 + 0.4) + 0.025 * Math.sin(t * 1.9);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  // velocity into the body's own frame
  const bx = vx * cy - vz * sy, bz = vx * sy + vz * cy;
  const pitch = clamp(-bz * 0.35, -0.5, 0.5) + swing * 0.5;
  const roll = clamp(bx * 0.35, -0.5, 0.5) + swing;
  const lift = smoothstep(0, 0.35, t);
  // dangling limbs lag the body: their swing is the body's, later and larger
  const lag = 0.24 * decay * Math.sin(t * 5.4 - 0.6) + 0.04 * Math.sin(t * 1.9 - 0.8);
  const legsSwing = clamp(-pitch * 0.8, -0.6, 0.6) + lag * 0.8;
  const legL: LegJoints = { lift: lerp(0, -1.25, lift) + legsSwing, splay: 0.12 + roll * 0.3, knee: lerp(0, -0.95, lift) + lag * 0.4 };
  const legR: LegJoints = { lift: lerp(0, -1.2, lift) + legsSwing * 0.9 + 0.06, splay: 0.08 - roll * 0.3, knee: lerp(0, -0.85, lift) + lag * 0.3 };
  // arms hang: straight down whatever the body does (they counter the roll a little late)
  const armHang = (s: 1 | -1): ArmJoints => J(lerp(0.95, -0.08, lift) - pitch * 0.6 + lag * 0.5, lerp(0.12, 0.1, lift) - s * roll * 0.7 + 0.04, 0, lerp(0.55, 0.22, lift), 0.25, 0.4);
  const lk = lookAt({ body: { at: [0, 0, 0], rot: [0, yaw, 0] }, lean: [0, 0], twist: 0 }, vis, 0.85);
  const f = resolvePose({
    ...SEATED,
    body: { pivot: 'scruff', at: [0, 0, 0], rot: [pitch * lift, yaw * lift, roll * lift] },
    legs: [legL, legR],
    lean: [-0.05, 0],
    twist: 0,
    arms: { left: armHang(1), right: armHang(-1) },
    headYaw: lk.headYaw,
    headPitch: lk.headPitch + 0.06,
    headTilt: clamp(-roll * 0.6, -0.3, 0.3) + 0.06,
    gaze: lk.gaze,
    ...FACE.flat,
    lids: [0.42, 0.45],
    lidsLow: [0.3, 0.3],
    brows: [-0.4, -0.15],
    mouth: [0.35, -0.12],
    ears: [0.3, 0.25],
    tail: [-0.4 + lag, clamp(-roll * 0.9 + lag * 1.2, -0.6, 0.6)],
    tailLift: lerp(0, -1.15, lift) + clamp(pitch * 0.5, -0.3, 0.3),
  });
  // the first moment: eyes shut slowly in resignation, then open half
  let g = withBlinks(f, t, [0.25]);
  const resign = Math.exp(-(((t - 0.45) / 0.25) ** 2));
  g = { ...g, lids: [lerp(g.lids[0], 0.85, resign), lerp(g.lids[1], 0.85, resign)] };
  const blinks: number[] = [];
  for (let k = 0; k < 40; k++) blinks.push(2.6 + k * 3.1 + (k % 2) * 0.7);
  return toPose(withBlinks(g, t, blinks));
}

export interface ClimbOptions {
  /** Its feet on the bench in front of the stool, root space (the simulation's `PatchView.foot`): where the climb starts. */
  foot?: V3;
  /** The seat's height above the floor (root units), when no `foot` is given. */
  seatH?: number;
  /** Which side of the stool it climbs from, when no `foot` is given: an angle about +Y in root space. */
  from?: number;
  visitor?: V3;
}
/** The stool in the brief: seat 0.65 above the bench, drawn 1.5×. */
export const SEAT_DROP = 0.65 / 1.5;
export const CLIMB_LENGTH: number = T_.climb;
/** How far from the seat's centre Patch stands to start climbing (root units), when no `foot` is given. */
export const CLIMB_STAND = 0.38;

/** The standing pose's hip height above the soles (root units). */
const STAND_HIPS = 0.519;
/** The hip joint's own height in the body (the legs hang from it). */
const LEG_LIFT_HIP = 0.09;

/** Standing legs: thighs down, shins straight. */
const STAND: [LegJoints, LegJoints] = [{ lift: -1.5, splay: 0.06, knee: -1.25 }, { lift: -1.5, splay: 0.06, knee: -1.25 }];

const normAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** The body placement that stands its soles on a floor point (root space), facing `yaw`. */
function standAt(feet: V3): V3 {
  return [feet[0], feet[1] + STAND_HIPS - LEG_LIFT_HIP, feet[2]];
}

function footOf(o: ClimbOptions): V3 {
  if (o.foot) return o.foot;
  const dir = o.from ?? 2.6;
  return [Math.sin(dir) * CLIMB_STAND, -(o.seatH ?? SEAT_DROP), Math.cos(dir) * CLIMB_STAND];
}

/**
 * Put down by the stool, from its foot: two paws on the seat and a crouch, one hop, onto its knees, round
 * and sat, in the simulation's 0.8 s. A practised move: it has done this before and it shows.
 */
export function climb(t: number, o: ClimbOptions = {}): PatchPose {
  const L = CLIMB_LENGTH;
  const foot = footOf(o);
  const vis = o.visitor ?? VISITOR;
  const keys = memoKeys('climb', [foot, vis], () => {
    const dir = Math.atan2(foot[0], foot[2]);
    const dx = Math.sin(dir), dz = Math.cos(dir);
    const face = normAngle(dir + Math.PI); // facing the stool
    const atStand = standAt(foot);
    const standBase: PatchPose = { ...SEATED, body: { at: atStand, rot: [0, face, 0] }, legs: STAND, lean: [0.0, 0], twist: 0, tailLift: -0.6, tail: [0.5, 0] };
    const edge = (side: number): V3 => [dx * 0.12 + Math.cos(dir) * side * 0.11, 0.01, dz * 0.12 - Math.sin(dir) * side * 0.11];
    const pawsUp = resolvePose({ ...standBase, lean: [0.25, 0] });
    const pl = reach(edge(1), 'left', toPose(pawsUp), { watch: false });
    const pr = reach(edge(-1), 'right', toPose(pawsUp), { watch: false });
    const armsOnSeat: Arms = { left: resolvePose(pl.pose).arms.left, right: resolvePose(pr.pose).arms.right };
    const lkSeat = lookAt({ body: pawsUp.body, lean: [0.1, 0], twist: 0 }, [0, 0.05, 0], 0.8);
    const knee: V3 = [dx * 0.06, 0.02, dz * 0.06];
    const lkVis = lookAt(resolvePose(SEATED), vis, 1);
    const turnTo = face + (normAngle(-face) > 0 ? 1 : -1) * Math.abs(normAngle(-face)) * 0.95;
    return bake(standBase, [
      { t: 0, set: { ...standBase, ...FACE.flat, headPitch: 0.25, headYaw: 0, gaze: [0, 0.3], arms: { left: J(0.6, 0.08, 0, 0.6, 0.1, 0.5), right: J(0.6, 0.08, 0, 0.6, 0.1, 0.5) } } },
      // two paws on the seat, and down into a crouch
      { t: L * 0.2, set: { body: { at: [atStand[0], atStand[1] - 0.06, atStand[2]], rot: [0, face, 0] }, legs: [{ lift: -1.05, splay: 0.15, knee: -0.4 }, { lift: -1.05, splay: 0.15, knee: -0.4 }], lean: [0.38, 0], arms: armsOnSeat, headPitch: lkSeat.headPitch + 0.15, ...FACE.flat, ears: [0.3, 0.3] }, ease: inOutQuad },
      // the hop: up and in, knees tucked
      { t: L * 0.4, set: { body: { at: [dx * 0.17, 0.16, dz * 0.17], rot: [0.15, face, 0] }, legs: [{ lift: 0.5, splay: 0.1, knee: 1.1 }, { lift: 0.4, splay: 0.1, knee: 1.2 }], lean: [0.3, 0], arms: { left: J(0.3, 0.2, 0, 0.3, 0.3, 0.6), right: J(0.3, 0.2, 0, 0.3, 0.3, 0.6) }, tailLift: 0.4 }, ease: outCubic },
      // onto its knees on the seat
      { t: L * 0.54, set: { body: { at: [knee[0], 0.13, knee[2]], rot: [0.08, face, 0] }, legs: [{ lift: -0.6, splay: 0.12, knee: 1.35 }, { lift: -0.6, splay: 0.12, knee: 1.35 }], lean: [0.24, 0], tailLift: 0, ears: [0.1, 0.1] }, ease: inCubic },
      // round, and sat, legs over the edge, the head already on the visitor
      { t: L * 0.84, set: { body: { at: [0, 0.03, 0], rot: [0, turnTo, 0] }, legs: [LEG_REST, LEG_REST], lean: [-0.04, 0], headYaw: lkVis.headYaw, headPitch: lkVis.headPitch, gaze: [0.1, 0.25], arms: 'rest', tail: [0.4, 0.1] }, ease: inOutQuad },
      { t: L, set: { ...SEATED, body: {}, headset: [0.06, 0] }, ease: outCubic },
      // a tug at the headset, after (follow-through, as the view goes back to the rest)
      { t: L + 0.3, set: { headset: [0, 0] } },
    ]);
  });
  let f = sampleOverlap(keys, t, { eyes: 0.04, ears: -0.05, tail: -0.12 });
  f = withBlinks(f, t, [L * 0.6]);
  return toPose(f);
}

export interface WalkOptions {
  visitor?: V3;
}
/** The toddle's stride (one step, root units): short legs, quick steps. */
const STRIDE = 0.15;

/**
 * Walking back to the stool: a quick toddle at the simulation's walking speed. The station gives where the
 * feet are now (root space, the simulation's `PatchView.at`) and which way it is going (radians about +Y);
 * the gait's phase runs from the distance walked so far, so the feet never slide.
 */
export function toddle(walked: number, feet: V3, heading: number, o: WalkOptions = {}): PatchPose {
  const ph = (walked / (2 * STRIDE)) * Math.PI * 2;
  const amp = smoothstep(0, STRIDE * 0.6, walked);
  const step = Math.sin(ph) * amp;
  const bob = Math.abs(Math.cos(ph)) * 0.022 * amp;
  const at = standAt(feet);
  const legs: [LegJoints, LegJoints] = [
    { lift: STAND[0].lift + Math.max(0, step) * 0.6 - Math.max(0, -step) * 0.2, splay: 0.08, knee: STAND[0].knee + Math.max(0, step) * 0.75 },
    { lift: STAND[1].lift + Math.max(0, -step) * 0.6 - Math.max(0, step) * 0.2, splay: 0.08, knee: STAND[1].knee + Math.max(0, -step) * 0.75 },
  ];
  const vis = o.visitor ?? VISITOR;
  const body = resolvePose({ body: { at: [at[0], at[1] + bob, at[2]], rot: [0.08 * amp, heading, step * 0.07] }, lean: [0.08, 0], twist: -step * 0.12 });
  const lk = lookAt(body, vis, 0.6);
  const f = resolvePose({
    ...SEATED,
    body: { at: [at[0], at[1] + bob, at[2]], rot: [0.08 * amp, heading, step * 0.07] },
    legs,
    lean: [0.08, 0],
    twist: -step * 0.12,
    arms: { left: J(0.15 - step * 0.4, 0.12, 0, 0.45, 0.1, 0.5), right: J(0.15 + step * 0.4, 0.12, 0, 0.45, 0.1, 0.5) },
    headYaw: clamp(lk.headYaw, -0.9, 0.9),
    headPitch: 0.05,
    headTilt: -step * 0.05,
    gaze: lk.gaze,
    ...FACE.flat,
    tail: [0.3, step * 0.4],
    tailLift: -0.5,
  });
  return toPose(f);
}

export interface ReturnOptions extends ClimbOptions {
  /** Walking speed (root units/s): the simulation's (PATCH_TUNING.walk) over the crew scale. */
  speed?: number;
}

/** How long the walk back from a root-space floor point to the stool's foot takes, before the climb. */
export function walkDuration(from: V3, o: ReturnOptions = {}): number {
  const foot = footOf(o);
  return Math.hypot(from[0] - foot[0], from[2] - foot[2]) / (o.speed ?? T_.walk / CREW);
}

/** Put down at a root-space floor point: toddles to the stool's foot, then climbs (for reviews; the view drives `toddle` and `climb` itself). */
export function returnToStool(t: number, from: V3, o: ReturnOptions = {}): PatchPose {
  const W = walkDuration(from, o);
  if (t >= W) return climb(t - W, o);
  const foot = footOf(o);
  const u = W > 0 ? t / W : 1;
  const feet: V3 = [lerp(from[0], foot[0], u), foot[1], lerp(from[2], foot[2], u)];
  const heading = Math.atan2(foot[0] - from[0], foot[2] - from[2]);
  return toddle(t * (o.speed ?? T_.walk / CREW), feet, heading, o);
}

// ---- 6. a thrown crate ----------------------------------------------------------------------------

export interface CrateOptions {
  visitor?: V3;
  /** Where the crate comes from (root space): the duck turns from it; the bonk tips away from it. */
  from?: V3;
}
export const DUCK_LENGTH: number = T_.duck;
export const CATCH_LENGTH: number = T_.catchHold + T_.catchSet;
export const BONK_LENGTH: number = T_.bonk;
/** The longest reaction (each is the simulation's own stage, never over 1.5 s). */
export const REACTION_LENGTH: number = Math.max(DUCK_LENGTH, CATCH_LENGTH, BONK_LENGTH);

/** It flattens, the crate goes over, it comes up, and gives the visitor the look. */
export function duck(t: number, o: CrateOptions = {}): PatchPose {
  const vis = o.visitor ?? VISITOR;
  const src = o.from ?? vis;
  const away = Math.atan2(src[0], src[2]) >= 0 ? 1 : -1;
  const L = DUCK_LENGTH;
  const keys = memoKeys('duck', [vis, away], () => {
    const lkVis = lookAt(resolvePose(SEATED), vis, 0.75);
    return bake(SEATED, [
      { t: 0, set: { ...SEATED } },
      // down: hunched over the knees, eyes screwed shut, ears flat, arms tucked in
      { t: L * 0.12, set: { body: { at: [0, -0.05, 0.02], rot: [0.18, -away * 0.25, 0] }, lean: [0.42, 0], twist: 0, headYaw: 0.15, headPitch: -0.45, headTilt: 0.1, gaze: [0, -0.3], ...FACE.squeezed, ears: [1, 1], arms: 'fold', tail: [0.9, 0], tailLift: 0.3, boom: 0.15 }, ease: outCubic },
      { t: L * 0.38, set: { body: { at: [0, -0.055, 0.02], rot: [0.2, -away * 0.25, 0] }, headPitch: -0.48 } },
      // up; one eye first
      { t: L * 0.66, set: { body: {}, lean: [0.08, 0], headYaw: lkVis.headYaw * 0.5, headPitch: 0.0, headTilt: 0.05, lids: [0.45, 0.8], lidsLow: [0.3, 0.4], brows: [-0.5, -0.6], ears: [0.4, 0.5], tail: [0.4, 0], tailLift: 0, boom: 0, arms: 'lap', gaze: [0.4, 0.2] }, ease: inOutCubic },
      // the look
      { t: L * 0.92, set: { headYaw: lkVis.headYaw, headPitch: lkVis.headPitch, headTilt: 0.06, gaze: lkVis.gaze, ...FACE.deadpan, ears: [0.3, 0.2], lean: [0.02, 0] }, ease: inOutQuad },
      { t: L, set: {} },
    ]);
  });
  return toPose(sampleOverlap(keys, t, { ears: -0.04, tail: -0.1, body: -0.02 }));
}

export interface CatchOptions extends CrateOptions {
  /** Where the crate is caught (root space): about an arm's length out on Patch's left. */
  at?: V3;
  /** Where it is set down (root space): the simulation's `PatchView.shelf` (the crate's centre there). */
  shelf?: V3;
}

export interface CatchFrame {
  pose: PatchPose;
  /** Where the crate's centre is while Patch has it (root space): in the paw, then on its way to the shelf, arriving at `shelf` at the end. Null before the catch. */
  crate: V3 | null;
}

/** At the rest position, the end of the keyshelf by the stool (root space): where a caught crate is set down by default. */
export const CATCH_SHELF: V3 = boardToRoot([BOARD_WHOLE.w / 2 - 0.3, BOARD_WHOLE.shelfY + 0.02, BOARD_WHOLE.shelfZ - 0.05], BOARD_WHOLE.stoolRestX);
/** How far above the palm a held crate's centre sits (root units; a small crate). */
const CRATE_ON_PAW = 0.13;

/**
 * One paw, without looking: caught (the simulation's `catchHold`), then set down on the shelf (its
 * `catchSet`). Where the shelf is past the paw's reach, the paw goes as far as it can and the crate is
 * lobbed the rest of the way, landing on the shelf exactly as the stage ends. The eyes never leave the visitor.
 */
export function catchCrate(t: number, o: CatchOptions = {}): CatchFrame {
  const vis = o.visitor ?? VISITOR;
  const at = o.at ?? [0.5, 0.5, 0.22];
  const shelf = o.shelf ?? CATCH_SHELF;
  const H = T_.catchHold, L = CATCH_LENGTH;
  const keys = memoKeys('catch', [vis, at, shelf], () => {
    const lkVis = lookAt(resolvePose(SEATED), vis, 0.85);
    const face: PatchPose = { ...SEATED, headYaw: lkVis.headYaw, headPitch: lkVis.headPitch, gaze: lkVis.gaze };
    const up = reach(at, 'left', { ...face, lean: [0, 0.05] }, { watch: false });
    const upArm = resolvePose(up.pose).arms.left;
    const give: V3 = [at[0] - 0.03, at[1] - 0.06, at[2] - 0.02];
    const giveArm = resolvePose(reach(give, 'left', face, { watch: false }).pose).arms.left;
    // the paw goes toward the shelf (the target on a 2 cm grid, so the bench's few shelves are in the reach table);
    // the crate itself ends exactly on the shelf
    const q = (v: number): number => Math.round(v / 0.02) * 0.02;
    const setR = reach([q(shelf[0]), q(shelf[1] - CRATE_ON_PAW + 0.02), q(shelf[2])], 'left', face, { watch: false });
    const setArm = resolvePose(setR.pose).arms.left;
    return bake(face, [
      { t: 0, set: { ...face } },
      { t: H * 0.22, set: { armL: upArm, lean: up.pose.lean ?? [0, 0], twist: up.pose.twist ?? 0, lids: [0.4, 0.38], ears: [0.05, 0.1] }, ease: outBack(1.2) },
      { t: H * 0.55, set: { armL: giveArm, lean: [0.03, 0.06] }, ease: outCubic },
      { t: H, set: { brows: [0.35, -0.25], browTilt: [0.3, -0.1], ...pick(FACE.smug, ['lidsLow', 'mouth']) } },
      { t: H + (L - H) * 0.7, set: { armL: setArm, lean: setR.pose.lean ?? [0.08, 0], twist: setR.pose.twist ?? 0 }, ease: inOutCubic },
      { t: L, set: { armL: { ...setArm, wrist: setArm.wrist - 0.25 } }, ease: outCubic },
      { t: L + 0.35, set: { arms: 'rest', lean: [0.02, 0], twist: 0.05, ...FACE.smug } },
    ]);
  });
  const f = sampleOverlap(keys, t, { tail: -0.12, ears: -0.05 });
  const pose = toPose(f);
  let crate: V3 | null = null;
  const tCatch = H * 0.22;
  if (t >= tCatch && t < L) {
    const p = pawPoint(pose, 'left');
    const inPaw: V3 = [p[0] + 0.05, p[1] + CRATE_ON_PAW, p[2] + 0.02];
    // let go at 70% of the set-down; from there the crate goes on to the shelf on its own (a lob if the paw fell short)
    const tLet = H + (L - H) * 0.7;
    if (t < tLet) crate = inPaw;
    else {
      const k = (t - tLet) / (L - tLet);
      const pLet = pawPoint(toPose(sample(keys, tLet)), 'left');
      const from: V3 = [pLet[0] + 0.05, pLet[1] + CRATE_ON_PAW, pLet[2] + 0.02];
      const gap = Math.hypot(shelf[0] - from[0], shelf[1] - from[1], shelf[2] - from[2]);
      const arc = Math.sin(Math.PI * k) * Math.min(0.12, gap * 0.4);
      crate = [lerp(from[0], shelf[0], k), lerp(from[1], shelf[1], k) + arc, lerp(from[2], shelf[2], k)];
    }
  } else if (t >= L) crate = [shelf[0], shelf[1], shelf[2]];
  return { pose, crate };
}

/** It glances off the headset, which goes askew; Patch straightens it with great dignity. */
export function bonked(t: number, o: CrateOptions = {}): PatchPose {
  const vis = o.visitor ?? VISITOR;
  const src = o.from ?? vis;
  const side = src[0] >= 0 ? 1 : -1; // knocked away from where it came
  const L = BONK_LENGTH;
  const keys = memoKeys('bonk', [vis, side], () => {
    const lkVis = lookAt(resolvePose(SEATED), vis, 0.85);
    const askew: [number, number] = [-side * 0.55, -0.22];
    const knocked: PatchPose = { ...SEATED, headTilt: -side * 0.32, headYaw: lkVis.headYaw - side * 0.2, headset: askew };
    // the cup nearer the front (with the head turned to the visitor, its right one)
    const cup = cupPoint({ ...knocked, headTilt: 0, headPitch: lkVis.headPitch + 0.12, headYaw: lkVis.headYaw }, 'right');
    const fix = reach([cup[0], cup[1] + 0.01, cup[2] + 0.02], 'right', { ...SEATED, headYaw: lkVis.headYaw, headPitch: lkVis.headPitch + 0.12 }, { watch: false });
    const fixArm = resolvePose(fix.pose).arms.right;
    return bake(SEATED, [
      { t: 0, set: { ...SEATED, headYaw: lkVis.headYaw, headPitch: lkVis.headPitch, gaze: lkVis.gaze } },
      // the knock: head and headset tip away; lids shut; the boom flies up
      { t: L * 0.06, set: { headTilt: -side * 0.45, headYaw: lkVis.headYaw - side * 0.25, headPitch: lkVis.headPitch - 0.08, headset: askew, boom: 0.5, lids: [1, 1], lean: [0, -side * 0.12], ears: [0.6, 0.6] }, ease: outCubic },
      // the head comes back; the headset stays where it went
      { t: L * 0.24, set: { headTilt: -side * 0.12, headYaw: lkVis.headYaw - side * 0.08, headPitch: lkVis.headPitch, boom: 0.3, lids: [0.85, 0.85], lean: [0.0, 0] }, ease: inOutQuad },
      // a moment. the eyes open on the visitor
      { t: L * 0.45, set: { lids: [0.42, 0.48], gaze: [0.3, 0.15], ...pick(FACE.deadpan, ['brows', 'browTilt', 'lidsLow']), mouth: [0, -0.1] } },
      // the paw goes up, the chin comes up
      { t: L * 0.68, set: { armR: fixArm, headTilt: 0, headYaw: lkVis.headYaw, headPitch: lkVis.headPitch + 0.12, gaze: lkVis.gaze, lids: [0.44, 0.46], twist: fix.pose.twist ?? 0, lean: fix.pose.lean ?? [0, 0] } },
      // straightens it
      { t: L * 0.82, set: { headset: [0, 0], boom: 0, armR: { ...fixArm, roll: fixArm.roll + 0.2 } } },
      { t: L, set: { arms: 'rest', twist: 0.05, lean: [0.02, 0], lids: [0.38, 0.4], mouth: [0.3, -0.1], headPitch: lkVis.headPitch + 0.08 } },
    ]);
  });
  return toPose(sampleOverlap(keys, t, { eyes: 0.02, tail: -0.1, ears: -0.04 }));
}
