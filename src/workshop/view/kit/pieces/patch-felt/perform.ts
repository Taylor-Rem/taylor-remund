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
 * Timing. Every performance is authored FOR the simulation's stage lengths (sim/crew/patch.ts
 * PATCH_TUNING, read here, not copied) and played at natural speed: the view passes the stage's own
 * stateTime. A practised operator's economy: one clear action a beat.
 *
 * The arm. Every reach the performances ask on the bench was answered offline by the exact search and
 * is carried as data (reach-table.ts; tests/unit/kit/patch-bake.test.ts makes it and holds play to it),
 * so play never searches; a question the table lacks is answered by the quick search (REACH_MISSES).
 *
 * The performances (lengths in seconds, `*_LENGTH`):
 *   notice(t, lamp, from)                   NOTICE_LENGTH (the sim's notice)
 *   rollTo(t, {fromX, toX, length})         the sim's roll length (a shove under 0.5 s; shove, glide, stop above)
 *   movePlug(t, from, to, stoolX, from)     PLUG_LENGTH: the cord to another jack (attract mode)
 *   job(t, targets) / jobStage              JOB_STAGES: drawer, work, check, reply at the sim's lengths, then shut
 *   theLook(t, o)                           STARE_LENGTH + the look, then holds
 *   held(t, carryVelocity, o)               the root at the visitor's hand; loops
 *   climb(t, {foot})                        CLIMB_LENGTH, from PatchView.foot
 *   toddle(walked, feet, heading)           the walk back, driven by where the sim has its feet
 *   duck / catchCrate (onto PatchView.shelf) / bonked     DUCK_ / CATCH_ / BONK_LENGTH (≤ 1.5 s)
 *   reach / reachJack / reachDrawer         a paw to a point, the body leaning only as needed, and what is short
 */
import { Matrix4, Vector3 } from 'three';
import { clamp, clamp01, inOutCubic, inOutQuad, lerp, outBack, outCubic, inCubic, smoothstep } from '../../../anim/ease.ts';
import type { Ease } from '../../../anim/ease.ts';
import {
  EXPRESSIONS, FOREARM, GAZE_MAX, HC, HEAD_SCALE, HIPS, LEG_REST, NECK, NEUTRAL, SCRUFF, SHOULDER, UPPER_ARM, CUP,
  ARM_LIMITS, SIDE_ON, bodyMatrix, poseMatrices, resolveArms, KNEE, KNEE_MID, LEG, HIP,
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
  armScale: [number, number];
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
    armScale: [...q.armScale],
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
  props: ['headset', 'folder', 'folderOpen', 'boom', 'armScale'],
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
    armScale: l2(a.armScale, b.armScale, w),
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
  const pole = armPole ? new Vector3(s * armPole[0], armPole[1], armPole[2]) : new Vector3(s * 0.8, -0.5, -0.35);
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
export function reach(target: V3, side: 'left' | 'right', base: PatchPose = EXPRESSIONS.unimpressed, o: { swivel?: number; watch?: boolean; pole?: V3 } = {}): Reach {
  // the same question gets the same answer; the questions the performances ask on the bench were answered
  // when the piece was built (reach-table.ts, made by the exact search offline), so play never searches
  const key = reachKey(target, side, base, o);
  const hit = reachCache.get(key);
  if (hit) return hit;
  let r: Reach;
  const baked = bakeMode ? undefined : REACH_TABLE[key];
  if (baked) r = fromBaked(baked, target, side, base, o);
  else {
    armPole = o.pole ?? null;
    try {
      r = reachUncached(target, side, base, o, bakeMode !== null);
    } finally {
      armPole = null;
    }
    if (bakeMode) bakeMode.set(key, toBaked(r, side));
    else REACH_MISSES.add(key);
  }
  if (reachCache.size > 512) reachCache.clear();
  reachCache.set(key, r);
  return r;
}
const reachCache = new Map<string, Reach>();
/** The elbow's pole for the reach being solved (x mirrored by side), or null for the usual out-and-down. */
let armPole: V3 | null = null;

/** Questions answered live (not in the table): a test holds the bench's to none. */
export const REACH_MISSES = new Set<string>();

/** The question's key: its numbers to 1e-4, hashed (FNV-1a, 52 bits) to keep the table small. */
function reachKey(target: V3, side: 'left' | 'right', base: PatchPose, o: { swivel?: number; watch?: boolean; pole?: V3 }): string {
  const str = JSON.stringify([target, side, base, o.swivel ?? null, o.watch ?? true, ...(o.pole ? [o.pole] : [])], round4);
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

// ---- 4b. the Button's rungs: Patch is the audience ---------------------------------------------------

/** The facepalm's three readings: one paw; both paws ("again"); the paw dragged down the face. */
export type FacepalmVariant = 'one' | 'both' | 'drag';

/**
 * Patch's signature move, laid into a list of keys from t0 over L seconds: the paw comes up slowly, the head
 * drops into it, a held beat, then one eye opens between the fingers at `peek` (the first, then the second);
 * 'both' brings both paws; 'drag' ends by pulling the paw down the face and giving the visitor the look.
 * The paw is asked of a canonical seat (the body swivelled as it sits, snapped to the rest or the work) so
 * its arm comes from the reach table. The elbow goes out to the side: the silhouette carries it at home framing.
 */
function facepalmKeys(k: Key[], t0: number, L: number, variant: FacepalmVariant, sit: FullPose, vis: V3, peek: readonly V3[]): void {
  const swv = Math.abs(sit.body.rot[1] - WORK_SWIVEL) < 0.3 ? WORK_SWIVEL : 0;
  const lkVis = lookAt(resolvePose({ ...SEATED, body: { rot: [0, swv, 0] } }), vis, 0.6);
  // a toy's arm is shorter than its head is far: the arm stretches a little (armScale) and the head bows hard
  // to meet the paw. Found by a search over the rig (paw on the face, the elbow as far out as that allows).
  // the body swivels half round to the visitor on the stool, so the paw and the bowed head face the camera
  const swPalm = swv + 0.5;
  // the slump: the body sinks on the stool and the shoulders roll forward into the bow
  const sunk = { at: [0, -0.05, 0.02] as V3, rot: [0.06, swPalm, 0] as V3 };
  // the red sleeve is the shape, not the paw: the elbow up and forward and the forearm lying across the white
  // muzzle. One paw: the face turns down into the crook of the arm. Both: the first sleeve across the muzzle, the
  // second higher, across the eyes, so the whole face is behind red. (A search over the rig: the forearm in front
  // of the muzzle, the elbow as high as a toy's shoulder allows; the head pitched only so far that the camera,
  // which looks down, still sees the face it is hiding: the bow is in the shoulders and the slump.)
  const both = variant === 'both';
  const hy = both ? 0 : 0.5;
  const hp = both ? -0.4 : -0.48;
  const palmBase: PatchPose = { ...SEATED, body: sunk, lean: [0.2, 0.1], twist: 0, headYaw: hy, headPitch: hp, headTilt: 0.2 };
  // out at the side, elbow high: the silhouette reads the move before the paw arrives
  const lift: ArmJoints = J(1.2, 1.0, -0.4, 1.7, 0.3, 0.9);
  const palmL: ArmJoints = both ? J(1.6, -0.1, -1.2, 0.7, 0.3, 1.2) : J(1.6, 0.4, 0.8, 0.7, 0.3, 1.2);
  const palmR: ArmJoints | null = both ? J(1.75, 0.15, -0.9, 0.9, 0.3, 1.2) : null;
  const chin: ArmJoints | null = variant === 'drag' ? J(1.15, 0.45, 0, 0.95, 0.4, 1.2) : null;
  const lkPeek = peek.map((p) => lookAt(resolvePose(palmBase), p, 0));
  const tt = (u: number): number => t0 + L * u;
  k.push(
    // the paw comes up, slowly, out to the side first; the ears are already going back
    { t: tt(0.22), set: { armL: lift, ...(palmR ? { armR: { ...lift, abduct: lift.abduct * 0.9 } } : {}), armScale: [1.6, palmR ? 1.6 : 1], body: { rot: [0, swPalm, 0] }, ...FACE.flat, lids: [0.4, 0.42], brows: [-0.3, -0.2], ears: [0.7, 0.6] }, ease: inOutQuad },
    // the face goes into it, the ears flatten back and down, the whole figure slumps and the tail droops
    { t: tt(0.45), set: { armL: palmL, ...(palmR ? { armR: palmR } : {}), body: sunk, lean: [0.2, 0.1], twist: 0, headYaw: hy, headPitch: hp, headTilt: 0.2, lids: [1, 1], lidsLow: [0.5, 0.5], brows: [-0.65, -0.6], browTilt: [0.35, 0.3], mouth: [-0.25, -0.2], ears: [1, 1], tail: [-0.6, 0], tailLift: -0.9 }, ease: inOutCubic },
    // one slow sigh while it is held: up a little, and down again further
    { t: tt(0.56), set: { body: { at: [0, -0.015, 0.01], rot: [0.02, swPalm, 0] }, lean: [0.08, 0.1], headPitch: hp + 0.12 }, ease: inOutQuad },
    { t: tt(0.7), set: { body: { at: [0, -0.065, 0.025], rot: [0.09, swPalm, 0] }, lean: [0.26, 0.1], headPitch: hp - 0.04 }, ease: inOutCubic },
  );
  if (variant === 'drag' && chin) {
    k.push(
      { t: tt(0.86), set: { armL: chin, lean: [0.12, 0.08], twist: -0.1, headPitch: -0.12, headYaw: lkVis.headYaw, gaze: [0.2, 0.3], lids: [0.48, 0.52], lidsLow: [0.35, 0.35], brows: [-0.6, -0.3], mouth: [-0.4, -0.35] }, ease: inOutQuad },
      { t: tt(1), set: { mouth: [-0.3, -0.3] } },
    );
  } else {
    // one eye opens between the fingers: the right (the paw covers the left)
    const g0 = lkPeek[0]?.gaze ?? [0.5, 0.6];
    // and the ears come up one at a time, the open eye's side first
    k.push({ t: tt(0.8), set: { lids: [1, 0.46], lidsLow: [0.5, 0.25], gaze: [clamp(g0[0], -1, 1), clamp(g0[1] + 0.3, -1, 1)], brows: [-0.6, -0.15], browTilt: [0.35, -0.15], ears: [1, -0.2] }, ease: inOutQuad });
    const g1 = lkPeek[1];
    if (g1) k.push({ t: tt(0.92), set: { gaze: [clamp(g1.gaze[0], -1, 1), clamp(g1.gaze[1] + 0.3, -1, 1)] }, ease: inOutQuad });
    k.push({ t: tt(1), set: { lids: [1, 0.48], ears: [-0.1, -0.25] } });
  }
}

export interface FacepalmOptions {
  variant?: FacepalmVariant;
  /** How long, seconds (default 3: Fetch's offer leaves room for it and a settle). */
  length?: number;
  /** What it turns to first (root space): the crash. The eye between the fingers peeks at it, then at the visitor. */
  glance?: V3;
  visitor?: V3;
  from?: PatchPose;
}

/**
 * The facepalm on its own (Fetch fumbled its crate): a beat, the head turns to the crash, the facepalm, a peek
 * through the fingers at Fetch and at the visitor, and the paw down again by the end. Reduced motion: t = length.
 */
export function facepalm(t: number, o: FacepalmOptions = {}): PatchPose {
  const L = o.length ?? 3;
  const vis = o.visitor ?? VISITOR;
  const from = o.from ?? SEATED;
  const variant = o.variant ?? 'one';
  const keys = memoKeys('facepalm', [L, vis, from, variant, o.glance ?? null], () => {
    const f0 = resolvePose(from);
    const sit: FullPose = { ...f0, legs: [LEG_REST, LEG_REST] };
    const k: Key[] = [{ t: 0, set: toPose(sit) }];
    const glance = o.glance;
    if (glance) {
      const lk = lookCheated(sit, glance, vis, 0.8, 1.0);
      k.push({ t: 0.35, set: { ...lk, ...FACE.flat, lids: [0.34, 0.36], brows: [0.3, 0.2], ears: [-0.4, -0.3] }, ease: inOutQuad });
    }
    facepalmKeys(k, glance ? 0.45 : 0.1, L - (glance ? 0.45 : 0.1) - 0.45, variant, sit, vis, glance ? [glance, vis] : [vis]);
    // the paw comes down; the look at the visitor stays
    k.push({ t: L, set: { arms: 'rest', armScale: [1, 1], body: sit.body, lean: [0.02, 0], ...lookAt(resolvePose(SEATED), vis, 0.85), ...FACE.deadpan, ears: [0.3, 0.2], tail: [0.3, 0], tailLift: 0 }, ease: inOutQuad });
    return bake(from, k);
  });
  return toPose(sampleOverlap(keys, t, { eyes: 0.03, ears: -0.05, tail: -0.12, body: -0.02 }));
}

/** A quick glance at something and a small shake of the head, laid over whatever Patch is doing (k: 0..1 through it, ~0.9 s). */
export function glanceShake(p: PatchPose, k: number, at: V3): PatchPose {
  if (k <= 0 || k >= 1) return p;
  const f = resolvePose(p);
  const lk = lookAt(f, at, 0.6);
  const w = Math.sin(Math.PI * clamp01(k / 0.9)) ** 0.7;
  const shake = Math.sin(clamp01((k - 0.35) / 0.55) * Math.PI * 4) * 0.12 * smoothstep(0.3, 0.45, k) * (1 - smoothstep(0.85, 1, k));
  return toPose({ ...f, headYaw: lerp(f.headYaw, lk.headYaw, w) + shake, headPitch: lerp(f.headPitch, lk.headPitch, w), gaze: [lerp(f.gaze[0], lk.gaze[0], w), lerp(f.gaze[1], lk.gaze[1], w)], brows: [lerp(f.brows[0], -0.4, w), lerp(f.brows[1], -0.2, w)] });
}

export interface RungOptions {
  /** The rung's script lengths (ButtonView.script): seconds it plays, and its rewind. */
  play: number;
  rewind: number;
  /** The Button (root space): rung 3 watches it. */
  button?: V3;
  visitor?: V3;
  /** Where Patch was when the Button went (the reaction starts from it and the body stays on its seat). */
  from?: PatchPose;
  /** Presses so far: a later press of the same rung gets a slightly different reading. */
  presses?: number;
}

/**
 * Patch reacts to a Button rung, for its whole length, within its seat's worth of movement (t: seconds since
 * the press, through the play and the rewind). It has settled before Revert's card comes up (at play + rewind),
 * so the card has the eye.
 *   rung 1: a startle, then a slow facepalm, held; one eye opens to look at the visitor.
 *   rung 2: a look over its shoulder at the visitor, and a slow shake of the head.
 *   rung 3: it watches the Button with a raised brow, and nods as the bench runs back (the cover is coming).
 *   rung 4: it ducks down behind its knees and peeks out over them; it comes up as the bench runs back.
 * Reduced motion: call with t = play + rewind (the settled pose); the view blends to it once.
 */
export function rungReaction(rung: number, t: number, o: RungOptions): PatchPose {
  const r = rung <= 1 ? 1 : rung >= 4 ? 4 : rung;
  const vis = o.visitor ?? VISITOR;
  const from = o.from ?? SEATED;
  const P = Math.max(0.5, o.play), RW = Math.max(0.2, o.rewind), END = P + RW;
  const alt = (o.presses ?? 0) % 2 === 1;
  const keys = memoKeys('rung', [r, P, RW, o.button ?? null, vis, from, alt], () => {
    const f0 = resolvePose(from);
    // the body stays where the stool has it; only the seat's worth of movement
    const sit: FullPose = { ...f0, legs: [LEG_REST, LEG_REST], folder: f0.folder };
    const lkVis = lookAt(sit, vis, 0.85);
    const startle: Partial<PatchPose> = { lids: [0.12, 0.14], lidsLow: [0, 0], brows: [0.9, 0.85], browTilt: [0.2, 0.2], ears: [-1, -1], mouth: [-0.2, -0.2], boom: 0.15 };
    const k: Key[] = [{ t: 0, set: toPose(sit) }];
    const deckVariant: FacepalmVariant = (['one', 'both', 'drag'] as const)[(o.presses ?? 0) % 3]!;
    if (r === 1) {
      // the startle: a jump on the seat, everything up; a beat; then the facepalm, settled before the card
      k.push(
        { t: 0.12, set: { body: { at: [0, 0.05, 0] }, lean: [-0.12, 0], ...startle, arms: { left: J(0.6, 0.6, 0, 0.6, 0.4, 0.4), right: J(0.6, 0.6, 0, 0.6, 0.4, 0.4) }, tail: [1, 0], tailLift: 0.5 }, ease: outCubic },
        { t: 0.45, set: { body: {}, lean: [0.02, 0], ears: [0.2, 0.2], tailLift: 0, tail: [0.3, 0] }, ease: inOutQuad },
        { t: 0.75, set: { ...lkVis, ...FACE.flat, lids: [0.45, 0.48], arms: 'rest' } },
      );
      facepalmKeys(k, 0.75, END - 0.95, (o.presses ?? 1) > 4 ? deckVariant : 'one', sit, vis, [vis]);
    } else if (r === 2) {
      // "again": the look over its shoulder at the visitor, then the bigger facepalm (both paws)
      k.push(
        { t: 0.12, set: { ...startle, lids: [0.25, 0.27], ears: [-0.6, -0.6], lean: [-0.05, 0] }, ease: outCubic },
        { t: 0.8, set: { twist: 0.3, ...lkVis, ...FACE.deadpan, lids: [0.36, 0.38], ears: [0.3, 0.2], lean: [0.02, 0] }, ease: inOutCubic },
        { t: 1.25, set: { headYaw: lkVis.headYaw - 0.2 } },
        { t: 1.6, set: { headYaw: lkVis.headYaw + 0.15, mouth: [-0.1, -0.15] } },
      );
      facepalmKeys(k, 1.75, END - 1.95, (o.presses ?? 2) > 4 ? deckVariant : 'both', sit, vis, [vis]);
    } else if (r === 3) {
      // it watches the Button, one brow up; as the bench runs back, a nod: the cover is coming
      const btn = o.button ?? [0, 0, 2];
      const lkBtn = lookAt(sit, btn, 0.8);
      k.push(
        { t: 0.12, set: { ...startle, lids: [0.25, 0.27], ears: [-0.6, -0.6] }, ease: outCubic },
        { t: 0.8, set: { ...lkBtn, lean: [0.1, 0.05], ...FACE.flat, lids: [0.34, 0.36], brows: [0.5, -0.2], browTilt: [0.3, -0.1], ears: [-0.3, -0.2] }, ease: inOutCubic },
        { t: P - 0.5, set: { headPitch: lkBtn.headPitch - 0.05, gaze: [lkBtn.gaze[0] + 0.1, lkBtn.gaze[1]] } },
        { t: P + RW * 0.35, set: { headPitch: lkBtn.headPitch - 0.22, ...FACE.smug, mouth: [0.6, 0.1] }, ease: inOutQuad },
        { t: P + RW * 0.6, set: { headPitch: lkBtn.headPitch + 0.02 }, ease: outCubic },
        { t: END - 0.1, set: { ...lkVis, lean: [0.02, 0], ...FACE.smug } },
      );
    } else {
      // rung 4: down behind its knees, arms over its head; a peek over them; up as the bench runs back
      const crouch: [LegJoints, LegJoints] = [{ lift: 0.7, splay: 0.25, knee: 1.35 }, { lift: 0.7, splay: 0.25, knee: 1.35 }];
      const down: Partial<PatchPose> = { body: { at: [0.06, -0.42, 0.22], rot: [0.35, 0, 0] }, legs: crouch, lean: [0.45, 0], twist: 0, headYaw: 0.35, headPitch: -0.5, headTilt: 0.1, gaze: [0, -0.2], ...FACE.squeezed, ears: [1, 1], arms: 'fold', tail: [1, 0.3], tailLift: 0.4, boom: 0.2 };
      const peek: Partial<PatchPose> = { body: { at: [0.06, -0.28, 0.22], rot: [0.2, 0, 0] }, legs: crouch, lean: [0.3, 0], headYaw: lkVis.headYaw * 0.7, headPitch: 0.15, gaze: [0.4, 0.5], lids: [0.2, 0.22], lidsLow: [0, 0], brows: [0.7, 0.6], browTilt: [0.2, 0.2], ears: [-0.2, 0.3], mouth: [-0.25, -0.2] };
      k.push(
        { t: 0.15, set: { ...down }, ease: outCubic },
        { t: 1.3, set: { ...peek }, ease: inOutQuad },
        { t: 2.0, set: { headYaw: lkVis.headYaw * 0.3, gaze: [-0.3, 0.4] } },
        { t: 2.4, set: { ...down }, ease: inCubic },
        { t: 3.6, set: { ...peek, headYaw: lkVis.headYaw * 0.9, gaze: [0.6, 0.5] }, ease: inOutQuad },
        { t: P, set: { headPitch: 0.1 } },
        // up, as the bench runs back; straightens; the look
        { t: P + RW * 0.7, set: { body: {}, legs: [LEG_REST, LEG_REST], lean: [0.04, 0], ...lkVis, ...FACE.deadpan, ears: [0.3, 0.2], arms: 'rest', tail: [0.3, 0], tailLift: 0, boom: 0, headset: [0.06, 0] }, ease: inOutCubic },
        { t: END - 0.1, set: { headset: [0, 0] } },
      );
    }
    k.push({ t: END, set: {} });
    return bake(from, k);
  });
  let f = sampleOverlap(keys, t, { eyes: 0.03, ears: -0.05, tail: -0.12, body: -0.02 });
  if (r !== 1 && r !== 4) f = withBlinks(f, t, [P + RW * 0.8]);
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
  // the flail (a picked-up Mii): limbs paddling, tail whipping, eyes wide; a burst at the pick-up, settling
  // over about two seconds into the resigned dangle; a new burst whenever it is shaken or swung
  const speed = Math.hypot(carryVelocity[0], carryVelocity[1], carryVelocity[2]);
  // full for the first second, then running out by about two (a sigh's worth); swung or shaken, it starts again
  const A = clamp(Math.max((1 - smoothstep(0.9, 2.1, t)) * smoothstep(0, 0.1, t), smoothstep(0.2, 1.0, speed)), 0, 1);
  const g0 = flail(f, t, A);
  // the look: down at the drop first (eyes wide), then at the visitor (resigned)
  const down = smoothstep(0.05, 0.25, t) * (1 - smoothstep(0.55, 1.1, t));
  const look: FullPose = { ...g0, headPitch: lerp(g0.headPitch, -0.45, down), gaze: [lerp(g0.gaze[0], 0, down), lerp(g0.gaze[1], -0.6, down)] };
  let g = withBlinks(look, t, A > 0.3 ? [] : [0.25]);
  // the resignation as the flail runs out: the lids come down slowly, once
  const resign = A < 0.25 ? Math.exp(-(((t - 2.1) / 0.3) ** 2)) : 0;
  g = { ...g, lids: [lerp(g.lids[0], 0.8, resign), lerp(g.lids[1], 0.8, resign)] };
  const blinks: number[] = [];
  for (let k = 0; k < 40; k++) blinks.push(3.2 + k * 3.1 + (k % 2) * 0.7);
  return toPose(withBlinks(g, t, blinks));
}

/** The flail laid over the dangle, at amplitude A (0 still .. 1 all four limbs going). */
function flail(f: FullPose, t: number, A: number): FullPose {
  if (A <= 1e-3) return f;
  const s = (w: number, ph: number): number => Math.sin(t * w + ph) * A;
  // out to the sides (the silhouette at home framing), paddling: windmilling arms, kicking legs
  const arm = (a: ArmJoints, ph: number): ArmJoints => ({ ...a, swing: a.swing + 0.5 * A + s(10, ph) * 0.9, abduct: a.abduct + 1.05 * A + s(8, ph + 1) * 0.3, elbow: a.elbow + 0.4 * A + s(13, ph + 2) * 0.6, wrist: a.wrist + s(15, ph) * 0.5 });
  const leg = (l: LegJoints, ph: number): LegJoints => ({ ...l, lift: l.lift + 0.55 * A + s(12, ph) * 0.8, knee: l.knee + 0.4 * A + s(12, ph + 1.3) * 0.7, splay: l.splay + 0.6 * A + s(9, ph + 0.7) * 0.3 });
  return {
    ...f,
    arms: { left: arm(f.arms.left, 0), right: arm(f.arms.right, Math.PI) },
    legs: [leg(f.legs[0], 0.4), leg(f.legs[1], 0.4 + Math.PI)],
    tail: [f.tail[0] + s(9, 0.5) * 0.6, f.tail[1] + s(7, 0) * 1.2],
    tailLift: f.tailLift + 0.6 * A,
    headTilt: f.headTilt + s(6, 1) * 0.15,
    lean: [f.lean[0] + s(5, 0.3) * 0.08, f.lean[1] + s(6.5, 1) * 0.12],
    lids: [lerp(f.lids[0], 0.12, A), lerp(f.lids[1], 0.14, A)],
    lidsLow: [lerp(f.lidsLow[0], 0, A), lerp(f.lidsLow[1], 0, A)],
    brows: [lerp(f.brows[0], 0.8, A), lerp(f.brows[1], 0.7, A)],
    mouth: [lerp(f.mouth[0], -0.3, A), lerp(f.mouth[1], -0.3, A)],
    ears: [lerp(f.ears[0], -0.6, A) + s(10, 0) * 0.3, lerp(f.ears[1], -0.6, A) + s(10, 2) * 0.3],
  };
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
  /** Where it is going (root space): the head looks along its way. Default: straight ahead. */
  toward?: V3 | null;
  /** A scamper (a long way back): longer, quicker steps, a forward lean, arms pumping, the tail streaming. */
  scamper?: boolean;
  /** 0..1: a glance over its shoulder at the visitor (a long walk's one look back). */
  glance?: number;
  /** 0..1: stopped (something in its way, or shut in): the feet come together under it, it stands and looks. */
  stopped?: number;
}

// ── R2: the gait: feet that plant ──
// The leg in its own (z forward, y up) plane, as complex numbers w = z + i·y: the knee from the hip (thigh), and
// the sole from the knee (shin), both at the rig's zero. A rotation of the thigh by `lift` multiplies by e^{i·lift};
// the knee's by e^{-i·knee}. Two links: solved exactly for a sole point (no search).
const TW = { z: KNEE.z, y: KNEE.y };
const SW = { z: LEG.foot[2] - KNEE_MID[2], y: LEG.foot[1] - KNEE_MID[1] - 0.05 };
const LT = Math.hypot(TW.z, TW.y), LS = Math.hypot(SW.z, SW.y);
const ARG_T = Math.atan2(TW.y, TW.z), ARG_S = Math.atan2(SW.y, SW.z);
/** Hip joint height above the soles when standing (root units). */
const HIP_UP = STAND_HIPS;
/** The hip joint is this far along the body (z) from the body's origin, which stands over the feet. */
const HIPS_Z_OFF = HIP.z;

/** The leg's joints that put its sole at (z forward, y up) from the hip, in the body's frame. */
export function legFor(z: number, y: number, splay = 0.08): LegJoints {
  let r = Math.hypot(z, y);
  r = clamp(r, Math.abs(LT - LS) + 1e-4, LT + LS - 1e-4);
  const v = Math.acos(clamp((r * r - LT * LT - LS * LS) / (2 * LT * LS), -1, 1));
  // of the two ways to bend, always the one with the knee forward (continuous from straight to tucked)
  const knee = ARG_S - ARG_T + v;
  const sz = TW.z + Math.cos(-knee) * SW.z - Math.sin(-knee) * SW.y;
  const sy = TW.y + Math.sin(-knee) * SW.z + Math.cos(-knee) * SW.y;
  const lift = Math.atan2(y, z) - Math.atan2(sy, sz);
  return { lift: clamp(normAngle(lift), -1.7, 1.2), splay, knee: clamp(knee, -1.5, 1.4) };
}

/** Walk and scamper: step length (root units, one foot's step), hip drop, swing height, body bob and roll, arm swing. */
const GAIT = {
  walk: { step: 0.24, hip: 0.035, lift: 0.075, bob: 0.03, roll: 0.13, arm: 0.75, lean: 0.1, tail: 0.55 },
  scamper: { step: 0.3, hip: 0.07, lift: 0.1, bob: 0.05, roll: 0.08, arm: 1.05, lean: 0.3, tail: 0.35 },
} as const;

/**
 * Walking back to the stool (R2). The station gives where the feet are now (root space, the simulation's
 * `PatchView.at`), the body's yaw (radians about +Y), and the distance walked so far; the gait's phase runs from
 * that distance, and the stance foot moves back under the body exactly as far as the body moves on, so a planted
 * foot stays put. Weight from side to side over the stance foot, a bob, arms opposite the legs and out where they
 * show, the tail trailing and swinging, the head up and looking where it goes.
 */
export function toddle(walked: number, feet: V3, heading: number, o: WalkOptions = {}): PatchPose {
  const g = o.scamper ? GAIT.scamper : GAIT.walk;
  const stop = clamp01(o.stopped ?? 0);
  const amp = smoothstep(0, g.step * 0.5, walked) * (1 - stop);
  const cyc = walked / (2 * g.step); // one cycle: a step with each foot
  const ph = cyc - Math.floor(cyc);
  /** A foot's place along the body (z) and its height, phase u (0..0.5: on the ground, moving back; 0.5..1: swinging forward). */
  const foot = (u: number): [number, number] => {
    if (u < 0.5) return [g.step * (0.5 - 2 * u), 0];
    const s = (u - 0.5) * 2;
    const e = s * s * (3 - 2 * s);
    return [g.step * (-0.5 + e), g.lift * Math.sin(Math.PI * s)];
  };
  const hipY = HIP_UP - g.hip * amp - 0.02 * stop;
  const L = foot(ph), Rf = foot((ph + 0.5) % 1);
  const legs: [LegJoints, LegJoints] = [
    legFor(L[0] * amp - HIPS_Z_OFF, -hipY + L[1] * amp, 0.1),
    legFor(Rf[0] * amp - HIPS_Z_OFF, -hipY + Rf[1] * amp, 0.1),
  ];
  const s2 = Math.sin(ph * Math.PI * 2); // + while the left foot is down
  const bob = g.bob * amp * (0.5 + 0.5 * Math.cos(ph * Math.PI * 4)); // highest mid-stance
  const at: V3 = [feet[0], feet[1] + hipY - LEG_LIFT_HIP + bob, feet[2]];
  const roll = g.roll * amp * s2; // over the stance foot
  const rot: V3 = [g.lean * amp, heading, -roll];
  const vis = o.visitor ?? VISITOR;
  // the head: along its way (a point a little ahead at eye height), or the visitor over its shoulder
  const fullBody = { body: { at, rot }, lean: [0.06, 0] as [number, number], twist: 0 };
  const ahead: V3 = o.toward ? [o.toward[0], feet[1] + 0.55, o.toward[2]] : [feet[0] + Math.sin(heading) * 2, feet[1] + 0.4, feet[2] + Math.cos(heading) * 2];
  const lkWay = lookAt(fullBody as never, ahead, 0.85);
  const lkVis = lookAt(fullBody as never, vis, 0.9);
  const gl = smoothstep(0, 1, clamp01(o.glance ?? 0));
  const yaw = lerp(clamp(lkWay.headYaw, -0.7, 0.7), clamp(lkVis.headYaw, -1.25, 1.25), gl);
  const pitch = lerp(clamp(lkWay.headPitch, -0.35, 0.2), lkVis.headPitch, gl);
  const armA = g.arm * amp;
  const f = resolvePose({
    ...SEATED,
    body: { at, rot },
    legs,
    lean: [0.06 + (o.scamper ? 0.1 : 0) * amp, roll * 0.4],
    twist: -0.14 * amp * Math.sin(ph * Math.PI * 2 + 0.3),
    // arms out from the sweater, swinging opposite the legs (left arm forward while the right foot steps)
    arms: {
      left: J(0.25 - armA * s2 * 0.6 + (o.scamper ? 0.35 : 0), 0.32, 0.1, 0.7 + (o.scamper ? 0.6 : 0.2), 0.2, 0.5),
      right: J(0.25 + armA * s2 * 0.6 + (o.scamper ? 0.35 : 0), 0.32, 0.1, 0.7 + (o.scamper ? 0.6 : 0.2), 0.2, 0.5),
    },
    headYaw: yaw,
    headPitch: pitch + bob * 1.5,
    headTilt: roll * 0.5,
    gaze: gl > 0.5 ? lkVis.gaze : lkWay.gaze,
    ...(gl > 0.5 ? FACE.deadpan : o.scamper ? FACE.alert : FACE.flat),
    ears: o.scamper ? [0.55, 0.55] : [0.1 + 0.15 * s2 * amp, 0.1 - 0.15 * s2 * amp],
    // the tail trails: swinging a beat behind the hips, higher at a scamper
    tail: [0.25, clamp(g.tail * amp * Math.sin(ph * Math.PI * 2 - 1.2), -0.6, 0.6)],
    tailLift: o.scamper ? 0.1 * amp - 0.4 * (1 - amp) : -0.25 * amp - 0.5 * (1 - amp),
  });
  return toPose(f);
}

/**
 * Over the belt (R2: `cross`, the simulation's 0.25 + 0.45 + 0.25 s): a hop up onto the rail with the knees
 * tucked and the arms out for balance, two quick steps across while the belt carries it, a hop down and a
 * landing. `feet` is the simulation's `at` (root space: its feet, up on the belt's top meanwhile).
 */
export function crossBelt(t: number, feet: V3, heading: number, ground: number, top: number, o: WalkOptions = {}): PatchPose {
  const on = T_.crossOn, over = T_.crossOver, off = T_.crossOff;
  // the steps across: the gait's phase from the time on the belt (two steps)
  const k = clamp01((t - on) / over);
  const walked = k * 2 * GAIT.walk.step + (t > on + over ? 2 * GAIT.walk.step : 0);
  const p = resolvePose(toddle(Math.max(walked, 0.13), feet, heading, { ...o, scamper: false }));
  // a hop: up at the start, down at the end (the knees tuck in the air; a squash on landing)
  const up = t < on ? Math.sin(Math.PI * clamp01(t / on)) : t > on + over ? Math.sin(Math.PI * clamp01((t - on - over) / off)) : 0;
  const land = t > on + over + off * 0.75 ? Math.sin(Math.PI * clamp01((t - on - over - off * 0.75) / (off * 0.25))) : 0;
  const tuck = (l: LegJoints): LegJoints => ({ lift: lerp(l.lift, 0.2, up), splay: l.splay + 0.2 * up, knee: lerp(l.knee, 1.35, up) });
  return toPose({
    ...p,
    // (sized to read at 80 px: a real hop up onto the rail and a drop off it, not a glide)
    body: { at: [p.body.at[0], p.body.at[1] + up * 0.3 - land * 0.1, p.body.at[2]], rot: [p.body.rot[0] + 0.35 * up - 0.2 * land, p.body.rot[1], p.body.rot[2]] },
    legs: [tuck(p.legs[0]), tuck(p.legs[1])],
    arms: { left: J(0.6 + 0.4 * up, 0.9, 0, 0.5, 0.2, 0.4), right: J(0.6 + 0.4 * up, 0.9, 0, 0.5, 0.2, 0.4) },
    ...FACE.alert,
    ears: [0.5 * up, 0.5 * up],
    tailLift: 0.3 * up,
  });
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

// ---- R1: off the edge of the bench ---------------------------------------------------------------

export const LEDGE_LENGTH: number = T_.ledge;
export const HAUL_LENGTH: number = T_.haul;
export const DUST_LENGTH: number = T_.dust;

export interface LedgeOptions {
  /** The point of the edge its paws hold (root space: the bench top at the edge). */
  at: V3;
  /** Where its feet are once it is up (root space, on the bench just in from the edge). */
  up: V3;
  /** Its body's yaw in root space: facing in, over the edge it holds. */
  heading: number;
  /** The front edge: it is seen from behind against the bench's apron, so it turns and gives the visitor the look while it hangs. */
  front: boolean;
  visitor?: V3;
}

/** Hanging legs: down from the hips, a little bent. */
const DANGLE: [LegJoints, LegJoints] = [{ lift: -1.45, splay: 0.1, knee: -1.0 }, { lift: -1.5, splay: 0.12, knee: -0.9 }];
/** Arms up over the edge (stretched as a toy's are to reach: the head is bigger than its arms are long). */
const HANG_ARM: ArmJoints = J(2.0, 0.12, 0, 0.15, -0.2, 0);

/** The body's place that puts the paws (both: their middle; or one) on `edge` with the rest of the pose as it is. */
function hangFrom(edge: V3, p: PatchPose, which: 'both' | 'left' | 'right'): BodyPlace {
  const rot = (p.body?.rot ?? [0, 0, 0]) as V3;
  const q: PatchPose = { ...p, body: { at: [0, 0, 0], rot } };
  const l = pawPoint(q, 'left'), r = pawPoint(q, 'right');
  const g: V3 = which === 'left' ? l : which === 'right' ? r : [(l[0] + r[0]) / 2, (l[1] + r[1]) / 2, (l[2] + r[2]) / 2];
  return { at: [edge[0] - g[0], edge[1] - g[1], edge[2] - g[2]], rot };
}

/**
 * Let go of past the edge (`ledge`, `haul`, `dust`: the simulation's 1.6, 0.7 and 0.5 s): it catches the edge
 * and swings on it, legs kicking, ears flat; then, off the front, it lets go with one paw, turns round on the
 * other and gives the visitor the look over its shoulder, and takes hold again; off a side only the paws and
 * the ears show above the edge, so they do the acting: the ears come up one at a time and a paw shifts its
 * grip. It hauls itself up, a knee over the edge, onto its feet; and dusts itself off. Reduced motion: each
 * stage's end (t = the stage's length).
 */
export function overTheEdge(stage: 'ledge' | 'haul' | 'dust', t: number, o: LedgeOptions): PatchPose {
  const vis = o.visitor ?? VISITOR;
  const keys = memoKeys('ledge', [o.at, o.up, o.heading, o.front, vis], () => buildLedge(o, vis));
  const t0 = stage === 'ledge' ? 0 : stage === 'haul' ? LEDGE_LENGTH : LEDGE_LENGTH + HAUL_LENGTH;
  const L = stage === 'ledge' ? LEDGE_LENGTH : stage === 'haul' ? HAUL_LENGTH : DUST_LENGTH;
  return toPose(sampleOverlap(keys, t0 + clamp(t, 0, L), { ears: -0.05, tail: -0.12 }));
}

function buildLedge(o: LedgeOptions, vis: V3): Array<{ t: number; pose: FullPose; ease: Ease }> {
  const E = o.at, hd = o.heading;
  const base: PatchPose = {
    ...SEATED,
    legs: DANGLE,
    lean: [-0.2, 0],
    twist: 0,
    arms: { left: HANG_ARM, right: HANG_ARM },
    armScale: [1.5, 1.5],
    headYaw: 0,
    headPitch: 0.3,
    headTilt: 0,
    gaze: [0, 0.6],
    ...FACE.alert,
    ears: [1, 1],
    tail: [-0.3, 0],
    tailLift: -1.3,
    boom: 0.2,
  };
  /** A hanging pose: the body turned by (pitch, yaw, roll) about the grip, everything else from `over`. */
  const hang = (pitch: number, yaw: number, roll: number, over: PatchPose = {}, which: 'both' | 'left' | 'right' = 'both'): PatchPose => {
    const p: PatchPose = { ...base, ...over, body: { rot: [pitch, hd + yaw, roll] } };
    return { ...p, body: hangFrom(E, p, which) };
  };
  const kick = (a: number): [LegJoints, LegJoints] => [
    { lift: -1.45 + 0.5 * a, splay: 0.15, knee: -1.0 + 0.6 * Math.max(0, a) },
    { lift: -1.45 - 0.5 * a, splay: 0.15, knee: -1.0 + 0.6 * Math.max(0, -a) },
  ];
  const L = LEDGE_LENGTH;
  const k: Key[] = [
    // caught it: swung out under the edge, legs going, ears flat, eyes wide
    { t: 0, set: hang(0.45, 0, 0, { legs: kick(1) }) },
    { t: L * 0.12, set: hang(-0.18, 0, 0.16, { legs: kick(-1), lids: [0.22, 0.24], brows: [0.6, 0.5] }), ease: inOutQuad },
    { t: L * 0.27, set: hang(0.12, 0, -0.12, { legs: kick(0.7) }), ease: inOutQuad },
    { t: L * 0.42, set: hang(-0.05, 0, 0.06, { legs: kick(-0.3), ears: [0.3, 0.6], ...FACE.flat }), ease: inOutQuad },
  ];
  if (o.front) {
    // off the front: it lets go with one paw, turns round on the other and gives the visitor the look
    const dir = Math.atan2(vis[0] - E[0], vis[2] - E[2]);
    const side = normAngle(dir - hd) >= 0 ? 1 : -1; // the way round that is nearer the visitor
    const hold: 'left' | 'right' = side > 0 ? 'right' : 'left'; // it turns away from the paw it keeps
    // the arm it keeps bends: a one-armed chin-up that brings its face up to the edge for the look
    const CHIN = J(1.55, 0.2, 0, 1.45, -0.2, 0);
    const free = (j: ArmJoints): PatchPose => (hold === 'right' ? { arms: { left: j, right: CHIN }, armScale: [1, 1.5] } : { arms: { left: CHIN, right: j }, armScale: [1.5, 1] });
    const turned = (yaw: number, roll: number, over: PatchPose): PatchPose => {
      const p = hang(0, yaw, roll, { ...free(J(0.35, 0.55, 0, 0.5, 0.1, 0.4)), legs: DANGLE, ...over }, hold);
      const lk = lookAt(resolvePose(p), vis, 1);
      return { ...p, headYaw: clamp(lk.headYaw, -1.3, 1.3), headPitch: clamp(lk.headPitch, -0.3, 0.6), gaze: lk.gaze };
    };
    k.push(
      { t: L * 0.52, set: turned(side * 0.55, side * 0.1, { ...FACE.flat, ears: [-0.2, -0.2] }), ease: inOutQuad },
      // the look: deadpan, over its shoulder, swinging a little on one arm
      { t: L * 0.66, set: turned(side * 0.75, -side * 0.06, { ...FACE.deadpan, ears: [0.25, 0.15], tail: [0.2, side * 0.4] }), ease: inOutCubic },
      { t: L * 0.82, set: turned(side * 0.7, side * 0.05, { ...FACE.deadpan, lids: [0.42, 0.45], ears: [0.25, 0.15] }), ease: inOutQuad },
      // and round again, and takes hold with both
      { t: L * 0.95, set: hang(0, 0, 0, { ...FACE.flat, ears: [0.4, 0.4], legs: DANGLE }), ease: inOutCubic },
      { t: L, set: hang(0, 0, 0, { ...FACE.flat, ears: [0.4, 0.4], legs: DANGLE, headPitch: 0.35 }) },
    );
  } else {
    // off a side: only the paws and the ears show over the edge, so they act: the ears come up one at a
    // time and swivel; one paw lets go and slaps down again further along
    const shift = (j: ArmJoints): PatchPose => ({ arms: { left: HANG_ARM, right: j } });
    k.push(
      { t: L * 0.55, set: hang(0, 0, 0.03, { legs: DANGLE, ears: [-0.6, 0.6], headPitch: 0.45 }), ease: inOutQuad },
      { t: L * 0.66, set: hang(0, 0, -0.03, { legs: DANGLE, ears: [-0.6, -0.5], headPitch: 0.45 }, 'left'), ease: inOutQuad },
      { t: L * 0.76, set: hang(0, 0, 0.05, { ...shift(J(2.0, 0.35, 0, 0.9, -0.4, 0)), legs: DANGLE, ears: [-0.7, -0.6] }, 'left'), ease: outCubic },
      { t: L * 0.86, set: hang(0, 0, 0, { legs: DANGLE, ears: [0.2, -0.6], headPitch: 0.4 }), ease: inCubic },
      { t: L, set: hang(0, 0, 0, { legs: DANGLE, ears: [-0.4, -0.4], headPitch: 0.35 }) },
    );
  }
  // ── the haul: a pull, a knee over the edge, up onto its feet ──
  const H = HAUL_LENGTH;
  const inward: V3 = [Math.sin(hd), 0, Math.cos(hd)];
  const upStand = standAt(o.up);
  const pull: PatchPose = { ...base, arms: { left: J(1.2, 0.35, 0, 1.9, -0.3, 0), right: J(1.2, 0.35, 0, 1.9, -0.3, 0) }, armScale: [1.3, 1.3], lean: [0.35, 0], headPitch: 0.1, ...FACE.squeezed, ears: [0.7, 0.7], legs: [{ lift: 0.9, splay: 0.15, knee: 1.5 }, { lift: -1.4, splay: 0.1, knee: -0.8 }] };
  const pulled = { ...pull, body: hangFrom(E, { ...pull, body: { rot: [0.25, hd, 0] } }, 'both') };
  const knee: V3 = [E[0] + inward[0] * 0.1, E[1] + 0.12, E[2] + inward[2] * 0.1];
  const t1 = L;
  k.push(
    { t: t1 + H * 0.4, set: pulled, ease: inOutCubic },
    { t: t1 + H * 0.72, set: { ...SEATED, body: { at: knee, rot: [0.5, hd, 0] }, legs: [{ lift: -0.3, splay: 0.15, knee: 1.5 }, { lift: 0.4, splay: 0.15, knee: 1.6 }], lean: [0.35, 0], twist: 0, arms: { left: J(0.6, 0.25, 0, 0.3, 0.2, 0.4), right: J(0.6, 0.25, 0, 0.3, 0.2, 0.4) }, armScale: [1, 1], headPitch: 0.15, headYaw: 0, ...FACE.flat, ears: [0.4, 0.4], tail: [0.6, 0], tailLift: 0.3, boom: 0.1 }, ease: outCubic },
    { t: t1 + H, set: { body: { at: upStand, rot: [0, hd, 0] }, legs: STAND, lean: [0.05, 0], arms: { left: J(0.15, 0.12, 0, 0.45, 0.1, 0.5), right: J(0.15, 0.12, 0, 0.45, 0.1, 0.5) }, headPitch: -0.05, tail: [0.3, 0], tailLift: -0.5, boom: 0 }, ease: inOutQuad },
  );
  // ── dusting off: a brush down the front with each paw, a shake, and up straight ──
  const D = DUST_LENGTH, t2 = L + H;
  const brush = J(0.75, 0.25, 0.6, 1.7, 0.4, 0.8), down = J(0.15, 0.12, 0, 0.45, 0.1, 0.5);
  const lkVis = lookAt({ body: { at: upStand, rot: [0, hd, 0] }, lean: [0.02, 0], twist: 0 }, vis, 0.6);
  k.push(
    { t: t2 + D * 0.22, set: { arms: { left: brush, right: down }, headPitch: -0.4, headYaw: 0.15, gaze: [0, -0.5], lean: [0.15, 0], ...FACE.flat, ears: [0.2, 0.2] }, ease: inOutQuad },
    { t: t2 + D * 0.48, set: { arms: { left: down, right: brush }, headYaw: -0.15, twist: 0.12 }, ease: inOutQuad },
    { t: t2 + D * 0.7, set: { arms: { left: down, right: down }, headPitch: -0.1, headYaw: 0, headTilt: 0.25, twist: 0, lean: [0.03, 0], ears: [-0.4, 0.3] }, ease: inOutQuad },
    { t: t2 + D, set: { headYaw: clamp(lkVis.headYaw, -1.2, 1.2), headPitch: lkVis.headPitch, headTilt: 0, gaze: lkVis.gaze, ...FACE.deadpan, ears: [0.25, 0.15] }, ease: inOutQuad },
  );
  return bake(resolvePose(k[0]!.set), k);
}

// ---- R4: thrown ----------------------------------------------------------------------------------------

export const LAND_LENGTH: number = T_.land;
export const SHAKE_LENGTH: number = T_.shake;
/** The body's middle above its origin (root units): where a tumble turns about. */
const MIDDLE = 0.3;

/** The body placed so that its middle is at `mid` (root space), turned by (pitch, yaw, roll). */
function aboutMiddle(mid: V3, pitch: number, yaw: number, roll: number): BodyPlace {
  // the middle is (0, MIDDLE, 0) in the body; bodyMatrix turns RY(yaw)·RX(pitch)·RZ(-roll) about the origin
  const y1 = MIDDLE * Math.cos(pitch) * Math.cos(roll), z1 = MIDDLE * Math.sin(pitch) * Math.cos(roll), x1 = MIDDLE * Math.sin(roll);
  const x = x1 * Math.cos(yaw) + z1 * Math.sin(yaw), z = -x1 * Math.sin(yaw) + z1 * Math.cos(yaw);
  return { at: [mid[0] - x, mid[1] - y1, mid[2] - z], rot: [pitch, yaw, roll] };
}

/**
 * In the air after a throw (R4): limbs flung out (the flail's cousin), the tail streaming, ears flat, eyes wide,
 * turning head over heels about its middle. `mid` is the simulation's `at` (its middle, root space), `spin` how far
 * it has turned (radians: the station runs it on with the speed), `yaw` the way it is going, `t` seconds in the air.
 */
export function tumble(t: number, mid: V3, spin: number, yaw: number): PatchPose {
  const w = Math.sin(t * 13), w2 = Math.sin(t * 11 + 1.3);
  return toPose(
    resolvePose({
      ...SEATED,
      body: aboutMiddle(mid, spin, yaw, 0.25 * Math.sin(t * 5)),
      legs: [
        { lift: 0.5 + 0.35 * w, splay: 0.6, knee: 0.3 - 0.3 * w2 },
        { lift: 0.5 - 0.35 * w, splay: 0.6, knee: 0.3 + 0.3 * w2 },
      ],
      lean: [-0.15, 0],
      twist: 0.2 * w2,
      arms: { left: J(1.4 + 0.3 * w, 1.1, 0, 0.3, 0, 0), right: J(1.4 - 0.3 * w, 1.1, 0, 0.3, 0, 0) },
      headYaw: 0,
      headPitch: 0.2,
      headTilt: 0,
      gaze: [0, 0],
      lids: [0.15, 0.17],
      lidsLow: [0, 0],
      brows: [0.8, 0.75],
      browTilt: [0.2, 0.2],
      mouth: [-0.4, -0.35],
      ears: [1, 1],
      tail: [-0.6, 0.4 * w],
      tailLift: 0.8,
      boom: 0.3,
    }),
  );
}

/**
 * Met a wall flat (R4, the simulation's `wall`): the old gag. Spread flat against it, its back to the wall and its
 * face to the room (the silhouette that reads from the visitor's side: a starfish with a face), stuck a moment
 * (`stick` s, a quiver), then sliding down it, arms dragged up, to the bench. `mid` is the simulation's `at` (its
 * middle, root space), `yaw` the way it faces (out of the wall).
 */
export function splat(t: number, mid: V3, yaw: number, stick: number): PatchPose {
  const sliding = smoothstep(stick, stick + 0.15, t);
  const quiver = t < stick ? Math.sin(t * 60) * 0.04 * (1 - t / stick) : 0;
  // stuck: an X. The arms flung out and up flat against the wall (about ten and two: the upper arm out to the
  // side, the forearm bent up in the wall's plane, stretched a little as a toy's are), legs wide apart, the tail
  // out to one side, the head tipped back against the wall, eyes wide. Sliding: the arms trail up over the head.
  const flung = J(-0.2, 1.2, 1.2, 1.2, 0, 0);
  const trail = J(1.9, 1.15, 0, 0.15, 0, 0);
  const arm: ArmJoints = {
    swing: lerp(flung.swing, trail.swing, sliding),
    abduct: lerp(flung.abduct, trail.abduct, sliding),
    twist: lerp(flung.twist, trail.twist, sliding),
    elbow: lerp(flung.elbow, trail.elbow, sliding),
    wrist: 0,
    roll: 0,
  };
  const k = lerp(1.4, 1.15, sliding);
  return toPose(
    resolvePose({
      ...SEATED,
      // (its back and the tail flat against the wall)
      body: aboutMiddle(mid, -0.05 + quiver, yaw, quiver * 2),
      legs: [
        { lift: -1.05, splay: 0.9, knee: -0.15 },
        { lift: -1.05, splay: 0.9, knee: -0.15 },
      ],
      lean: [-0.2, 0],
      twist: 0,
      arms: { left: arm, right: arm },
      armScale: [k, k],
      headYaw: 0,
      headPitch: lerp(0.4, 0.15, sliding),
      headTilt: quiver * 3,
      gaze: [0, 0.2],
      lids: [lerp(0.1, 0.5, sliding), lerp(0.12, 0.55, sliding)],
      lidsLow: [0.05, 0.05],
      brows: [0.8, 0.75],
      browTilt: [0.25, 0.25],
      mouth: [-0.5, -0.45],
      ears: [-0.7, -0.7],
      tail: [-0.6, 0.6],
      tailLift: 0.2,
      boom: 0.35,
    }),
  );
}

/**
 * Sat on the bench where it came to rest: plonked down, legs out in front in a V with the knees a little bent,
 * paws down on the bench beside it, upright with a slight dazed slump (read at home framing: a small sat
 * figure, not one lying on its back).
 */
function satOnBench(feet: V3, yaw: number): PatchPose {
  return {
    ...SEATED,
    body: { at: [feet[0], feet[1] + 0.01, feet[2]], rot: [0.04, yaw, 0] },
    legs: [{ lift: 0.12, splay: 0.45, knee: 0.4 }, { lift: 0.08, splay: 0.5, knee: 0.55 }],
    lean: [0.08, 0],
    twist: 0,
    arms: { left: J(-0.1, 0.6, 0, 0.3, 0.3, 0.4), right: J(-0.1, 0.6, 0, 0.3, 0.3, 0.4) },
    headYaw: 0,
    headPitch: -0.05,
    headTilt: 0.12,
    ...FACE.flat,
    ears: [0.35, 0.25],
    tail: [0.5, 0.35],
    tailLift: -0.35,
    boom: 0.15,
  };
}

/**
 * Come down (R4, the simulation's `land`, 0.8 s): a bounce (higher the harder it came in), a roll head over heels
 * that eats the speed, and it ends sat up on the bench, legs out. `feet` is the simulation's `at` (root space, on
 * the bench, sliding on meanwhile), `spin0` how far it had turned in the air, `speed` how fast it came in.
 */
export function landed(t: number, feet: V3, yaw: number, spin0: number, speed: number, fromWall = false): PatchPose {
  const L = LAND_LENGTH;
  const k = clamp01(t / L);
  const hard = clamp01(speed / 6);
  // one or two bounces, decaying
  const b = Math.abs(Math.sin(Math.PI * Math.min(1, k / 0.55) * (1 + hard))) * (1 - Math.min(1, k / 0.55)) * (0.12 + 0.3 * hard);
  // the roll: on round the way it was turning, to upright
  // (come in hard, it goes head over heels once more along the way it was going: the roll that carries it on)
  const end = spin0 + ((((-spin0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) + (speed > 6 ? 2 * Math.PI : 0);
  const e = 1 - Math.pow(1 - Math.min(1, k / 0.75), 3);
  const spin = lerp(spin0, end, e);
  const sat = resolvePose(satOnBench(feet, yaw));
  // from the tumble into the sit, all the way by the last fifth (then a small settle)
  // (off a wall it was never tumbling: from the bottom of the slide, the same way round, into the sit)
  const air = fromWall
    ? resolvePose(splat(1, [feet[0], feet[1] + MIDDLE * 0.9 + b, feet[2]], yaw, 0.25))
    : resolvePose(tumble(0.3 + t, [feet[0], feet[1] + MIDDLE * 0.9 + b, feet[2]], spin, yaw));
  const w = smoothstep(0.25, 0.8, k);
  const p = mixPose(air, sat, w);
  const settle = k > 0.8 ? Math.sin(Math.PI * smoothstep(0.8, 1, k)) * 0.04 : 0;
  return toPose({ ...p, body: { at: [p.body.at[0], p.body.at[1] - settle, p.body.at[2]], rot: p.body.rot } });
}

/** Sat on the bench after a throw (R4, the simulation's `shake`, 0.6 s): a shake of the head, and the eyes clear. */
export function shakeOff(t: number, feet: V3, yaw: number): PatchPose {
  const k = clamp01(t / SHAKE_LENGTH);
  const p = satOnBench(feet, yaw);
  const sh = Math.sin(k * Math.PI * 6) * (1 - k) * 0.45;
  return { ...p, headYaw: sh, headTilt: -sh * 0.4, lids: [lerp(0.6, 0.36, k), lerp(0.62, 0.39, k)], ears: [0.3 + sh, 0.3 - sh], brows: [-0.3, -0.2] };
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
  const at = o.at ?? [0.45, 0.34, 0.3];
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
      // low across the belly (never across the face), then out to the shelf
      { t: H + (L - H) * 0.35, set: { armL: J(0.75, -0.2, -0.5, 1.15, 0.1, 0.3), twist: -0.15 }, ease: inOutQuad },
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
