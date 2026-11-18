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
  bodyMatrix, poseMatrices, resolveArms,
} from './rig.ts';
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
  let cur: FullPose = 'arms' in start && start.arms && 'left' in (start.arms as object) && 'body' in start && Array.isArray((start as FullPose).body.at) ? (start as FullPose) : resolvePose(start as PatchPose);
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
  return poseMatrices({ body: f.body, lean: f.lean, twist: f.twist }).body!.clone().multiply(poseMatrices({ lean: f.lean, twist: f.twist }).spine!);
}

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
export function solveArm(side: 'left' | 'right', targetSpine: Vector3, base: ArmJoints): { joints: ArmJoints; short: number } {
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
  const f = resolvePose(base);
  const T = new Vector3(...target);
  if (o.swivel !== undefined) f.body.rot = [f.body.rot[0], o.swivel, f.body.rot[2]];
  const armBase = f.arms[side];
  let best: { fore: number; sideL: number; twist: number; short: number; joints: ArmJoints } | null = null;
  // the least lean that reaches with a little bend left in the elbow; else the closest it can get
  for (let i = 0; i <= 7; i++) {
    for (let j = -3; j <= 3; j++) {
      for (const tw of [-0.3, 0, 0.3]) {
        const fore = (i / 7) * 0.42, sideL = (j / 3) * 0.3;
        const sp = spineFrame({ body: f.body, lean: [fore, sideL], twist: tw });
        const local = T.clone().applyMatrix4(sp.clone().invert());
        const r = solveArm(side, local, armBase);
        const S = new Vector3((side === 'left' ? 1 : -1) * SHOULDER.x, SHOULDER.y, SHOULDER.z);
        const slack = Math.max(0, local.distanceTo(S) - ARM_REACH * 0.93);
        const cost = r.short * 10 + slack * 2 + fore * 0.15 + Math.abs(sideL) * 0.2 + Math.abs(tw) * 0.1;
        const prev = best ? best.short * 10 + 0 : Infinity;
        if (!best || cost < prev + (best as unknown as { cost: number }).cost) {
          (best as unknown) = { fore, sideL, twist: tw, short: r.short, joints: r.joints, cost } as unknown;
        }
      }
    }
  }
  const b = best!;
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

// ---- the targets a station gives ---------------------------------------------------------------

/** The points the job needs, in Patch's root space, at the stool's working position for that jack. */
export interface JobTargets {
  /** The line's lamp on the board (Patch notices it). */
  lamp: V3;
  /** The drawer's handle, shut. */
  handle: V3;
  /** Which way the drawer pulls out (unit) and how far (root units). */
  pull: V3;
  travel: number;
  /** Where a paw rests on the keys / the keyshelf edge. */
  keys: V3;
  /** The thing the job changed, to lean out and look at. */
  thing: V3;
  /** The visitor (the camera), far off. */
  visitor: V3;
}

/** The visitor, roughly, from the seat at the default layout (the camera is high and in front). */
export const VISITOR: V3 = [9, 6, 7];

/** Stand-in targets for the P1 board with the stool slid to the LAMP drawer (tests and reviews; the station passes real ones). */
export const DEFAULT_TARGETS: JobTargets = {
  lamp: [-0.9, 0.42, 0.55],
  handle: [-0.62, -0.05, 0.42],
  pull: [0.5, 0, 0.866],
  travel: 0.28,
  keys: [-0.55, 0.18, 0.5],
  thing: [2.4, 0.6, 3.8],
  visitor: VISITOR,
};

// ---- the seated rest ---------------------------------------------------------------------------

/** The seated rest the performances start from and come back to (the unimpressed look at the visitor). */
export const SEATED: PatchPose = EXPRESSIONS.unimpressed;

/** The arm joints for the lap (both paws in it). */
const LAP: Arms = resolveArms('lap');
const REST_ARMS: Arms = resolveArms('rest');

const J = (swing: number, abduct: number, twist: number, elbow: number, wrist: number, roll: number): ArmJoints => ({ swing, abduct, twist, elbow, wrist, roll });

/** Face presets the performances use (only the face fields). */
const FACE = {
  flat: { lids: [0.45, 0.48], lidsLow: [0.2, 0.2], brows: [-0.3, -0.2], browTilt: [-0.15, -0.1], mouth: [0.45, -0.1] },
  alert: { lids: [0.3, 0.32], lidsLow: [0.08, 0.08], brows: [0.15, 0.1], browTilt: [0, 0], mouth: [0.25, -0.05] },
  reading: { lids: [0.42, 0.44], lidsLow: [0.25, 0.25], brows: [-0.2, 0.1], browTilt: [-0.2, 0.15], mouth: [0.2, 0] },
  checking: { lids: [0.28, 0.3], lidsLow: [0.05, 0.05], brows: [0.45, 0.35], browTilt: [0.05, 0], mouth: [0.15, 0] },
  smug: { lids: [0.48, 0.5], lidsLow: [0.55, 0.45], brows: [0.25, -0.3], browTilt: [0.25, -0.1], mouth: [1, 0.35] },
  deadpan: { lids: [0.54, 0.56], lidsLow: [0.38, 0.38], brows: [-0.65, -0.35], browTilt: [-0.35, 0.05], mouth: [-0.15, -0.12] },
  squeezed: { lids: [0.95, 0.95], lidsLow: [0.7, 0.7], brows: [-0.8, -0.8], browTilt: [0.3, 0.3], mouth: [-0.3, -0.3] },
} as const satisfies Record<string, Partial<PatchPose>>;
export { FACE };

// ---- 1. the job ---------------------------------------------------------------------------------

export const JOB_STAGES = [
  { name: 'notice', at: 0, dur: 0.9 },
  { name: 'drawer', at: 0.9, dur: 1.8 },
  { name: 'folder', at: 2.7, dur: 0.9 },
  { name: 'work', at: 3.6, dur: 2.8 },
  { name: 'check', at: 6.4, dur: 1.7 },
  { name: 'nod', at: 8.1, dur: 0.6 },
  { name: 'reply', at: 8.7, dur: 1.4 },
  { name: 'shut', at: 10.1, dur: 1.5 },
] as const;
export type JobStage = (typeof JOB_STAGES)[number]['name'];
export const JOB_LENGTH = 11.6;

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
  const at = (v: V3, k: number, dy = 0): V3 => [v[0] + pull.x * k, v[1] + pull.y * k + dy, v[2] + pull.z * k];
  const out = at(T.handle, T.travel);
  const inside = at(T.handle, T.travel - 0.17, 0.02);
  // swivel: square to the drawer for the work, back round toward the bench to check
  const swWork = swivelToward(T.handle, 1.6) * 0.75;
  const work: PatchPose = { ...SEATED, body: { rot: [0, swWork, 0] } };
  const reachR = (p: V3, base: PatchPose, extra: Partial<PatchPose> = {}): PatchPose => ({ ...reach(p, 'right', { ...base, ...extra }, { swivel: swWork }).pose, ...extra });
  const onHandle = reachR(T.handle, work);
  const pulled = reachR(out, work, { lean: undefined as unknown as [number, number] });
  const inDrawer = reachR(inside, work);
  // the folder held up before the chest, open, in the right paw; the head bent over it
  const lapFolder: ArmJoints = J(0.85, 0.05, -0.55, 1.55, 0.35, -0.6);
  const lookFolderBase = resolvePose({ ...work, lean: [0.12, 0], twist: 0.1 });
  const folderAt: V3 = pawPoint(toPose({ ...lookFolderBase, arms: { left: LAP.left, right: lapFolder } }), 'right');
  const lkFolder = lookAt(lookFolderBase, [folderAt[0], folderAt[1] - 0.05, folderAt[2]], 0.85);
  const keysPose = reach(T.keys, 'left', { ...work, lean: [0.12, 0], twist: 0.1 }, { swivel: swWork, watch: false }).pose;
  const keysArm = resolvePose(keysPose).arms.left;
  // leaning out to check: swivel toward the thing, lean toward it, the head right round
  const swCheck = swivelToward(T.thing, 1.3) * 0.6;
  const checkBody = resolvePose({ body: { rot: [0, swCheck, 0] }, lean: [0.3, 0.28], twist: 0.35 });
  const lkThing = lookAt(checkBody, T.thing, 0.9);
  const restBody = resolvePose(SEATED);
  const lkVis = lookAt(restBody, T.visitor, 0.85);
  const lkLamp = lookAt(resolvePose(SEATED), T.lamp, 0.75);
  const lkHandle = lookAt(resolvePose(work), T.handle, 0.8);
  // the reply: the left paw up to the left cup (it presses to talk), the boom pulled to the mouth
  const replyBase: PatchPose = { ...SEATED, lean: [0.02, -0.04], twist: 0.05, headYaw: lkVis.headYaw * 0.8, headPitch: lkVis.headPitch, headTilt: 0.12 };
  const cup = cupPoint(replyBase, 'left');
  const cupArm = resolvePose(reach([cup[0] + 0.03, cup[1] - 0.01, cup[2]], 'left', replyBase, { watch: false }).pose).arms.left;

  const keys: Key[] = [
    // notice: the ears go first, the eyes snap to the lamp, the head follows without hurry
    { t: 0, set: { ...SEATED } },
    { t: 0.18, set: { ears: [-0.45, -0.35], ...FACE.alert, gaze: [lkLamp.gaze[0] - 0.4, lkLamp.gaze[1]] }, ease: outCubic },
    { t: 0.85, set: { headYaw: lkLamp.headYaw, headPitch: lkLamp.headPitch, gaze: lkLamp.gaze, lean: [0.06, -0.03], headTilt: 0.05, mouth: [0.3, 0], tail: [0.35, -0.1] } },
    // drawer: swivel square to it, the paw to the handle, a tug, it rolls out
    { t: 1.35, set: { body: { rot: [0, swWork * 0.7, 0] }, headYaw: lkHandle.headYaw, headPitch: lkHandle.headPitch, gaze: lkHandle.gaze, ...FACE.flat, mouth: [0.2, -0.05], armR: J(0.7, 0.15, -0.2, 0.9, 0.1, 0.4) } },
    { t: 1.75, set: { ...pick(onHandle, ['body', 'lean', 'twist']), armR: resolvePose(onHandle).arms.right, ears: [-0.2, -0.1] }, ease: inOutQuad },
    { t: 1.9, set: { lean: addL(resolvePose(onHandle).lean, -0.04, 0) } },
    { t: 2.45, set: { ...pick(pulled, ['body', 'lean', 'twist']), armR: resolvePose(pulled).arms.right, tail: [0.2, -0.25] }, ease: inOutQuad },
    // folder: the paw drops into the drawer, comes up with the folder
    { t: 2.95, set: { ...pick(inDrawer, ['lean', 'twist']), armR: resolvePose(inDrawer).arms.right, headPitch: lkHandle.headPitch - 0.08 } },
    { t: 3.05, set: { folder: 1 } },
    { t: 3.55, set: { lean: [0.12, 0], twist: 0.1, armR: lapFolder, headYaw: lkFolder.headYaw, headPitch: lkFolder.headPitch, gaze: lkFolder.gaze, ...FACE.reading, ears: [0, 0.1] } },
    // work: the left paw flips the cover, the eyes read down it, a paw on the keys twice
    { t: 3.85, set: { armL: J(0.9, -0.2, -0.6, 1.5, 0.2, 0.3) } },
    { t: 4.15, set: { folderOpen: 1, armL: LAP.left }, ease: inOutQuad },
    { t: 4.6, set: { gaze: [lkFolder.gaze[0] - 0.25, lkFolder.gaze[1] + 0.1] } },
    { t: 5.0, set: { gaze: [lkFolder.gaze[0] + 0.2, lkFolder.gaze[1] - 0.1], browTilt: [-0.3, 0.25] } },
    { t: 5.35, set: { armL: keysArm, gaze: [lkFolder.gaze[0], lkFolder.gaze[1] - 0.2] } },
    { t: 5.5, set: { armL: { ...keysArm, wrist: keysArm.wrist + 0.35 } }, ease: outCubic },
    { t: 5.62, set: { armL: keysArm }, ease: inCubic },
    { t: 5.78, set: { armL: { ...keysArm, wrist: keysArm.wrist + 0.35 } }, ease: outCubic },
    { t: 5.9, set: { armL: keysArm }, ease: inCubic },
    { t: 6.25, set: { armL: LAP.left, folderOpen: 0, mouth: [0.5, 0] } },
    // check: lean out over the bench to look at the thing it changed, really look
    { t: 6.9, set: { body: { rot: [0, swCheck, 0] }, lean: [0.18, 0.14], twist: 0.2, headYaw: lkThing.headYaw * 0.8, headPitch: lkThing.headPitch, gaze: lkThing.gaze, ...FACE.flat, ears: [-0.3, -0.3] } },
    { t: 7.45, set: { lean: checkBody.lean, twist: checkBody.twist, headYaw: lkThing.headYaw, headTilt: 0.22, ...FACE.checking, ears: [-0.7, -0.5], tail: [0.5, 0.35], armL: J(0.55, 0.35, -0.5, 0.6, 0.2, 0.9) }, ease: inOutQuad },
    { t: 7.8, set: { headPitch: lkThing.headPitch - 0.05, gaze: [lkThing.gaze[0] + 0.1, lkThing.gaze[1] - 0.05] } },
    { t: 8.1, set: { headPitch: lkThing.headPitch - 0.02, lids: [0.36, 0.38] } },
    // a small nod, and the smirk
    { t: 8.3, set: { headPitch: lkThing.headPitch - 0.2, lean: [0.22, 0.2], ...FACE.smug, mouth: [0.8, 0.2] }, ease: inOutQuad },
    { t: 8.55, set: { headPitch: lkThing.headPitch + 0.02 }, ease: outCubic },
    { t: 8.7, set: { headPitch: lkThing.headPitch - 0.05 } },
    // reply: swivel back, a paw to the cup, the boom to the mouth, a few words; eyes on the visitor
    { t: 9.15, set: { body: { rot: [0, 0, 0] }, ...pick(replyBase, ['lean', 'twist', 'headYaw', 'headPitch', 'headTilt']), gaze: [0.15, 0.2], armL: cupArm, ...FACE.flat, mouth: [0.4, 0], tail: [0.2, 0] } },
    { t: 9.3, set: { boom: -0.18, mouth: [0.1, 0.25] } },
    { t: 9.45, set: { mouth: [0.55, -0.1] } },
    { t: 9.6, set: { mouth: [0.05, 0.3] } },
    { t: 9.75, set: { mouth: [0.6, 0.0] } },
    { t: 9.95, set: { boom: 0, mouth: [0.7, -0.05], armL: REST_ARMS.left, ...FACE.smug } },
    // shut: the folder back in its drawer, the drawer shoved home, back to the rest
    { t: 10.45, set: { body: { rot: [0, swWork, 0] }, ...pick(inDrawer, ['lean', 'twist']), armR: resolvePose(inDrawer).arms.right, headYaw: lkHandle.headYaw * 0.7, headPitch: lkHandle.headPitch * 0.6, ...FACE.flat } },
    { t: 10.55, set: { folder: 0 } },
    { t: 10.7, set: { ...pick(pulled, ['lean', 'twist']), armR: resolvePose(pulled).arms.right } },
    { t: 11.05, set: { ...pick(onHandle, ['lean', 'twist']), armR: resolvePose(onHandle).arms.right }, ease: inOutQuad },
    { t: 11.6, set: { ...SEATED, body: {} } },
  ];
  const baked = bake(SEATED, keys);
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
  if (t < 1.9) return 0;
  if (t < 2.45) return inOutQuad((t - 1.9) / 0.55);
  if (t < 10.7) return 1;
  if (t < 11.05) return 1 - inOutQuad((t - 10.7) / 0.35);
  return 0;
}

/** The job at time t (0..JOB_LENGTH; held at the ends). */
export function job(t: number, targets: JobTargets = DEFAULT_TARGETS): JobFrame {
  const keys = jobKeys(targets);
  let f = sampleOverlap(keys, t);
  f = withBlinks(f, t, [2.6, 4.85, 8.95, 11.4]);
  f = withBreath(f, t, 0.6);
  let st: (typeof JOB_STAGES)[number] = JOB_STAGES[0];
  for (const s of JOB_STAGES) if (t >= s.at) st = s;
  return { pose: toPose(f), drawer: drawerAt(t), stage: st.name, u: clamp01((t - st.at) / st.dur) };
}

/** One stage of the job, u 0..1 through it (play u backwards to reverse it). */
export function jobStage(stage: JobStage, u: number, targets: JobTargets = DEFAULT_TARGETS): JobFrame {
  const st = JOB_STAGES.find((s) => s.name === stage)!;
  return job(st.at + clamp01(u) * st.dur, targets);
}

/** The pose reaching a jack's mouth with the left paw (the cord's plug), and what is short. */
export function reachJack(jack: V3, base: PatchPose = SEATED): Reach {
  return reach(jack, jack[0] < 0 ? 'right' : 'left', base);
}

/** The pose with a paw on a drawer's handle, swivelled square to it, and what is short. */
export function reachDrawer(handle: V3, base: PatchPose = SEATED): Reach {
  return reach(handle, 'right', base, { swivel: swivelToward(handle, 1.6) * 0.75 });
}

// ---- 2. the look ---------------------------------------------------------------------------------

export interface LookOptions {
  /** The dead plug (root space). */
  plug: V3;
  visitor?: V3;
  /** Where Patch was when the cord came out (default the seated rest). */
  from?: PatchPose;
}
export const LOOK_LENGTH = 4.4;

/**
 * The cord pulled out mid-job. Patch stops; its ears go first; its eyes drop to the dead plug, the head
 * follows; it looks at the plug for a good long second. Then, without moving its head, its eyes come
 * round to the visitor, slowly. A beat. The head follows, partway, heavier-lidded than before; one brow
 * down; the tail flicks once. Then it holds there, blinking now and then, for as long as it likes.
 */
export function theLook(t: number, o: LookOptions): PatchPose {
  const from = resolvePose(o.from ?? SEATED);
  const vis = o.visitor ?? VISITOR;
  // the body settles out of whatever it was doing: upright, swivelled a little toward the plug
  const settle: FullPose = { ...from, lean: [from.lean[0] * 0.4 + 0.04, from.lean[1] * 0.3], twist: from.twist * 0.4 };
  const lkPlug = lookAt(settle, o.plug, 0.85);
  const lkVisEyes = lookAt({ ...settle }, vis, 0);
  const vNow = lookAt(settle, vis, 1);
  const headTo = { headYaw: lerp(lkPlug.headYaw, vNow.headYaw, 0.62), headPitch: lerp(lkPlug.headPitch, vNow.headPitch, 0.62) };
  const eyesFromHead = (hy: number, hp: number): [number, number] => {
    const g = lookAt({ ...settle }, vis, 0);
    // gaze relative to a head turned (hy, hp): what is left of the full angle
    const full = lookAt(settle, vis, 1);
    void g;
    return [clamp((full.headYaw - hy) / GAZE_MAX, -1, 1), clamp((full.headPitch - hp) / (GAZE_MAX * 0.75), -1, 1)];
  };
  void lkVisEyes;
  const keys: Key[] = [
    { t: 0, set: toPose(from) },
    // it stops: ears up a fraction, lids lift a hair; the working paw hangs where it was
    { t: 0.12, set: { ears: [-0.35, -0.3], lids: [0.36, 0.38] }, ease: outCubic },
    // the eyes drop to the plug
    { t: 0.42, set: { gaze: [clamp(lkPlug.gaze[0] + (lkPlug.headYaw - from.headYaw) / GAZE_MAX, -1, 1), clamp(lkPlug.gaze[1] + (lkPlug.headPitch - from.headPitch) / (GAZE_MAX * 0.75), -1, 1)] }, ease: outCubic },
    // the head follows; the body comes upright; the paws sink to the lap
    { t: 1.05, set: { headYaw: lkPlug.headYaw, headPitch: lkPlug.headPitch, headTilt: -0.06, gaze: lkPlug.gaze, lean: settle.lean, twist: settle.twist, arms: { left: { ...settle.arms.left, elbow: settle.arms.left.elbow * 0.8 }, right: { ...settle.arms.right, elbow: settle.arms.right.elbow * 0.8 } }, lids: [0.44, 0.46], boom: 0 }, ease: inOutCubic },
    { t: 1.4, set: { arms: { left: LAP.left, right: LAP.right }, ears: [0.15, 0.2], brows: [-0.2, -0.1] }, ease: inOutQuad },
    // a long look at the plug
    { t: 1.95, set: { lids: [0.5, 0.52], lidsLow: [0.25, 0.25], gaze: [lkPlug.gaze[0], lkPlug.gaze[1] - 0.05] } },
    // the eyes alone come round to the visitor (slowly)
    { t: 2.75, set: { gaze: eyesFromHead(lkPlug.headYaw, lkPlug.headPitch), brows: [-0.6, -0.25], browTilt: [-0.35, 0.05], mouth: [0.05, -0.1] }, ease: inOutQuad },
    { t: 3.05, set: { lidsLow: [0.32, 0.32] } },
    // the head follows, partway; heavier lids; the deadpan
    { t: 4.1, set: { ...headTo, headTilt: 0.08, gaze: eyesFromHead(headTo.headYaw, headTo.headPitch), ...FACE.deadpan, ears: [0.35, 0.25] }, ease: inOutCubic },
    { t: LOOK_LENGTH, set: { mouth: [0.25, -0.1] } },
  ];
  const baked = bake(from, keys);
  let f = sampleOverlap(baked, t, { eyes: 0.04, body: -0.08, ears: -0.06, tail: -0.25 });
  // the tail: one slow flick as the eyes arrive
  const flick = Math.exp(-((t - 3.0) / 0.35) ** 2);
  f = { ...f, tail: [f.tail[0] + 0.5 * flick, f.tail[1] + 0.35 * flick] };
  // holding: blink now and then (the first one is very slow: the look)
  const holds = [3.6];
  for (let k = 0; k < 40; k++) holds.push(6.2 + k * 3.7 + (k % 3) * 0.6);
  f = withBlinks(f, t, holds);
  f = withBreath(f, t, t > LOOK_LENGTH ? 1 : 0.3);
  return toPose(f);
}

// ---- 3. lifted, and back to the stool ------------------------------------------------------------

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
  const at = SCRUFF;
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
    body: { pivot: 'scruff', at: [at[0], at[1], at[2]], rot: [pitch * lift, yaw * lift, roll * lift] },
    legs: [legL, legR],
    lean: [-0.05, 0],
    twist: 0,
    arms: { left: armHang(1), right: armHang(-1) },
    headYaw: lk.headYaw,
    headPitch: lk.headPitch + 0.06,
    headTilt: clamp(-roll * 0.6, -0.3, 0.3) + 0.06,
    gaze: lk.gaze,
    ...FACE.flat,
    lids: [0.55, 0.57],
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
  /** The seat's height above the floor Patch is put down on (root units: world height / crew scale). */
  seatH?: number;
  /** Which side of the stool it climbs from: an angle about +Y in root space (0 = in front, +Z). */
  from?: number;
  visitor?: V3;
}
/** The stool in the brief: seat 0.65 above the bench, drawn 1.5×. */
export const SEAT_DROP = 0.65 / 1.5;
export const CLIMB_LENGTH = 3.4;
/** How far from the seat's centre Patch stands to start climbing (root units). */
export const CLIMB_STAND = 0.38;

/** The standing pose's hip height above the soles (root units). */
const STAND_HIPS = 0.405;

/** Standing legs: thighs down, shins straight. */
const STAND: [LegJoints, LegJoints] = [{ lift: -1.5, splay: 0.06, knee: -1.25 }, { lift: -1.5, splay: 0.06, knee: -1.25 }];

/**
 * Put down by the stool: it stands, looks up at the seat with a look, puts two paws on it, crouches,
 * hops, lands on its knees, turns round on the seat, sits, and puts its headset straight.
 */
export function climb(t: number, o: ClimbOptions = {}): PatchPose {
  const H = o.seatH ?? SEAT_DROP;
  const dir = o.from ?? 2.6;
  const vis = o.visitor ?? VISITOR;
  const dx = Math.sin(dir), dz = Math.cos(dir);
  const face = dir + Math.PI; // facing the stool
  const R = CLIMB_STAND;
  const floorY = -H + STAND_HIPS - LEG_LIFT_HIP;
  const atStand: V3 = [dx * R, floorY, dz * R];
  const standBase: PatchPose = { ...SEATED, body: { at: atStand, rot: [0, face, 0] }, legs: STAND, lean: [0.0, 0], twist: 0, tailLift: -0.6, tail: [0.5, 0] };
  // the paws on the seat's near edge
  const edge = (side: number): V3 => [dx * 0.12 + Math.cos(dir) * side * 0.11, 0.01, dz * 0.12 - Math.sin(dir) * side * 0.11];
  const pawsUp = resolvePose({ ...standBase, lean: [0.25, 0] });
  const pl = reach(edge(1), 'left', toPose(pawsUp), { watch: false });
  const pr = reach(edge(-1), 'right', toPose(pawsUp), { watch: false });
  const armsOnSeat: Arms = { left: resolvePose(pl.pose).arms.left, right: resolvePose(pr.pose).arms.right };
  const lkSeat = lookAt({ body: pawsUp.body, lean: [0.1, 0], twist: 0 }, [0, 0.05, 0], 0.8);
  const knee: V3 = [dx * 0.06, 0.02, dz * 0.06];
  const lkVis = lookAt(resolvePose(SEATED), vis, 1);
  const cupPose: PatchPose = { ...SEATED, headTilt: -0.18, headset: [0.12, 0] };
  const cup = cupPoint(cupPose, 'left');
  const cupArm = resolvePose(reach([cup[0] + 0.02, cup[1], cup[2]], 'left', cupPose, { watch: false }).pose).arms.left;
  const keys: Key[] = [
    { t: 0, set: { ...standBase, ...FACE.flat, headPitch: 0.1, headYaw: 0, gaze: [0, 0.3], arms: { left: J(0.1, 0.08, 0, 0.3, 0.1, 0.5), right: J(0.1, 0.08, 0, 0.3, 0.1, 0.5) } } },
    // a look up at the seat: really?
    { t: 0.35, set: { headPitch: 0.35, headTilt: 0.1, ...FACE.deadpan, gaze: [0.1, 0.2] } },
    // two paws on the seat
    { t: 0.85, set: { lean: [0.22, 0], arms: armsOnSeat, headPitch: lkSeat.headPitch + 0.15, headTilt: 0, ...FACE.flat, ears: [-0.2, -0.2] } },
    // crouch
    { t: 1.15, set: { body: { at: [atStand[0], atStand[1] - 0.06, atStand[2]], rot: [0, face, 0] }, legs: [{ lift: -1.05, splay: 0.15, knee: -0.4 }, { lift: -1.05, splay: 0.15, knee: -0.4 }], lean: [0.4, 0], ears: [0.3, 0.3] }, ease: inOutQuad },
    // the hop: up and in, knees tucked
    { t: 1.38, set: { body: { at: [dx * 0.17, 0.16, dz * 0.17], rot: [0.15, face, 0] }, legs: [{ lift: 0.5, splay: 0.1, knee: 1.1 }, { lift: 0.4, splay: 0.1, knee: 1.2 }], lean: [0.3, 0], arms: { left: J(0.3, 0.2, 0, 0.3, 0.3, 0.6), right: J(0.3, 0.2, 0, 0.3, 0.3, 0.6) }, tailLift: 0.4 }, ease: outCubic },
    // lands on its knees on the seat
    { t: 1.6, set: { body: { at: [knee[0], 0.15, knee[2]], rot: [0.1, face, 0] }, legs: [{ lift: -0.6, splay: 0.12, knee: 1.35 }, { lift: -0.6, splay: 0.12, knee: 1.35 }], lean: [0.2, 0], tailLift: 0, ears: [0.1, 0.1] }, ease: inCubic },
    { t: 1.72, set: { body: { at: [knee[0], 0.12, knee[2]], rot: [0.05, face, 0] }, lean: [0.26, 0] }, ease: outCubic },
    // turns round on its knees
    { t: 2.25, set: { body: { at: [0, 0.12, 0], rot: [0, face + (normAngle(-face) > 0 ? 1 : -1) * Math.abs(normAngle(-face)) * 0.95, 0] }, lean: [0.08, 0], headYaw: lkVis.headYaw * 0.6, headPitch: 0.05, gaze: [0.4, 0.2], arms: 'lap' } },
    // sits: legs forward over the edge
    { t: 2.55, set: { body: {}, legs: [LEG_REST, LEG_REST], lean: [-0.04, 0], headYaw: lkVis.headYaw, headPitch: lkVis.headPitch, gaze: [0.1, 0.25], tail: [0.4, 0.1], tailLift: 0 }, ease: inOutQuad },
    { t: 2.65, set: { lean: [0.02, 0] }, ease: outCubic },
    // the headset straight
    { t: 2.95, set: { ...pick(cupPose, ['headTilt']), headset: [0.12, 0], armL: cupArm, ...FACE.flat } },
    { t: 3.15, set: { headset: [0, 0], headTilt: 0.05 } },
    { t: CLIMB_LENGTH, set: { ...SEATED, body: {} } },
  ];
  const baked = bake(toPose({ ...resolvePose(standBase) }), keys);
  let f = sampleOverlap(baked, t, { eyes: 0.06, ears: -0.06, tail: -0.18 });
  f = withBlinks(f, t, [0.6, 2.4]);
  return toPose(f);
}
/** The hip joint's own height in the body (the legs hang from it). */
const LEG_LIFT_HIP = 0.09;

const normAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

export interface ReturnOptions extends ClimbOptions {
  /** Walking speed (root units/s). */
  speed?: number;
}

/** How long the walk back from a root-space floor point takes, before the climb. */
export function walkDuration(from: V3, o: ReturnOptions = {}): number {
  const dir = o.from ?? 2.6;
  const goal = [Math.sin(dir) * CLIMB_STAND, Math.cos(dir) * CLIMB_STAND];
  const d = Math.hypot(from[0] - goal[0]!, from[2] - goal[1]!);
  return d / (o.speed ?? 0.55);
}

/** Put down at a root-space point on the floor: toddles to the stool's foot (unhurried), then climbs. */
export function returnToStool(t: number, from: V3, o: ReturnOptions = {}): PatchPose {
  const W = walkDuration(from, o);
  if (t >= W) return climb(t - W, o);
  const H = o.seatH ?? SEAT_DROP;
  const dir = o.from ?? 2.6;
  const goal: V3 = [Math.sin(dir) * CLIMB_STAND, 0, Math.cos(dir) * CLIMB_STAND];
  const u = W > 0 ? t / W : 1;
  const e = inOutQuad(u);
  const x = lerp(from[0], goal[0], e), z = lerp(from[2], goal[2], e);
  const heading = Math.atan2(goal[0] - from[0], goal[2] - from[2]);
  const face = dir + Math.PI;
  // turn to face the stool over the last steps
  const yaw = lerp(heading, heading + normAngle(face - heading), smoothstep(0.75, 1, u));
  // the toddle: short quick steps, a bob and a roll
  const ph = t * 7.5;
  const amp = smoothstep(0, 0.12, u) * (1 - smoothstep(0.88, 1, u));
  const step = Math.sin(ph) * amp;
  const bob = Math.abs(Math.cos(ph)) * 0.025 * amp;
  const floorY = -H + STAND_HIPS - LEG_LIFT_HIP;
  const legs: [LegJoints, LegJoints] = [
    { lift: STAND[0].lift + Math.max(0, step) * 0.55 - Math.max(0, -step) * 0.15, splay: 0.08, knee: STAND[0].knee + Math.max(0, step) * 0.7 },
    { lift: STAND[1].lift + Math.max(0, -step) * 0.55 - Math.max(0, step) * 0.15, splay: 0.08, knee: STAND[1].knee + Math.max(0, -step) * 0.7 },
  ];
  const f = resolvePose({
    ...SEATED,
    body: { at: [x, floorY + bob, z], rot: [0.06 * amp, yaw, step * 0.08] },
    legs,
    lean: [0.05, 0],
    twist: -step * 0.12,
    arms: { left: J(0.1 - step * 0.35, 0.12, 0, 0.35, 0.1, 0.5), right: J(0.1 + step * 0.35, 0.12, 0, 0.35, 0.1, 0.5) },
    headYaw: 0.25,
    headPitch: 0.05,
    headTilt: -step * 0.06,
    gaze: [0.6, 0.15],
    ...FACE.flat,
    lids: [0.5, 0.52],
    tail: [0.3, step * 0.4],
    tailLift: -0.5,
  });
  return toPose(withBlinks(f, t, [1.3, 3.5]));
}

// ---- 4. a thrown crate ----------------------------------------------------------------------------

export interface CrateOptions {
  visitor?: V3;
  /** Where the crate comes from (root space): the duck turns from it; the bonk tips away from it. */
  from?: V3;
}
export const REACTION_LENGTH = 1.5;

/** It flattens, the crate goes over, it comes up slowly, and gives the visitor the look. */
export function duck(t: number, o: CrateOptions = {}): PatchPose {
  const vis = o.visitor ?? VISITOR;
  const src = o.from ?? vis;
  const rest = resolvePose(SEATED);
  const lkVis = lookAt(rest, vis, 0.75);
  const away = Math.atan2(src[0], src[2]);
  const keys: Key[] = [
    { t: 0, set: { ...SEATED } },
    // down: hunched over the knees, eyes screwed shut, ears flat, paws over the head... no: arms tucked in
    { t: 0.13, set: { body: { at: [0, -0.05, 0.02], rot: [0.18, -clamp(away, -1, 1) * 0.25, 0] }, lean: [0.42, 0], twist: 0, headYaw: 0.15, headPitch: -0.45, headTilt: 0.1, gaze: [0, -0.3], ...FACE.squeezed, ears: [1, 1], arms: 'fold', tail: [0.9, 0], tailLift: 0.3, boom: 0.15 }, ease: outCubic },
    { t: 0.5, set: { body: { at: [0, -0.055, 0.02], rot: [0.2, -clamp(away, -1, 1) * 0.25, 0] }, headPitch: -0.48 } },
    // up, slowly; one eye first
    { t: 0.95, set: { body: {}, lean: [0.08, 0], headYaw: lkVis.headYaw * 0.4, headPitch: 0.0, headTilt: 0.05, lids: [0.6, 0.85], lidsLow: [0.3, 0.4], brows: [-0.5, -0.6], ears: [0.4, 0.5], tail: [0.4, 0], tailLift: 0, boom: 0, arms: 'lap', gaze: [0.4, 0.2] }, ease: inOutCubic },
    // the look
    { t: 1.45, set: { headYaw: lkVis.headYaw, headPitch: lkVis.headPitch, headTilt: 0.06, gaze: lkVis.gaze, ...FACE.deadpan, ears: [0.3, 0.2], lean: [0.02, 0] }, ease: inOutQuad },
    { t: REACTION_LENGTH, set: {} },
  ];
  let f = sampleOverlap(bake(SEATED, keys), t, { eyes: 0.03, ears: -0.04, tail: -0.12, body: -0.02 });
  f = withBlinks(f, t, [1.62]);
  return toPose(f);
}

export interface CatchOptions extends CrateOptions {
  /** Where the crate is caught (root space): about an arm's length out on Patch's left. */
  at?: V3;
  /** Where it is set down (the keyshelf, root space). */
  shelf?: V3;
}

export interface CatchFrame {
  pose: PatchPose;
  /** Where the crate's centre is while Patch has it (root space), or null before the catch and after it lets go. */
  crate: V3 | null;
}

/** One paw, without looking: caught, set down on the keyshelf, and the paw back in the lap. The eyes never leave the visitor. */
export function catchCrate(t: number, o: CatchOptions = {}): CatchFrame {
  const vis = o.visitor ?? VISITOR;
  const at = o.at ?? [0.38, 0.42, 0.18];
  const shelf = o.shelf ?? [0.05, 0.12, 0.42];
  const rest = resolvePose(SEATED);
  const lkVis = lookAt(rest, vis, 0.85);
  const face: PatchPose = { ...SEATED, headYaw: lkVis.headYaw, headPitch: lkVis.headPitch, gaze: lkVis.gaze };
  const up = reach(at, 'left', { ...face, lean: [0, 0.05] }, { watch: false });
  const upArm = resolvePose(up.pose).arms.left;
  const give: V3 = [at[0] - 0.03, at[1] - 0.06, at[2] - 0.02];
  const giveArm = resolvePose(reach(give, 'left', face, { watch: false }).pose).arms.left;
  const set = reach([shelf[0], shelf[1] + 0.06, shelf[2]], 'left', face, { watch: false });
  const setArm = resolvePose(set.pose).arms.left;
  const keys: Key[] = [
    { t: 0, set: { ...face } },
    { t: 0.16, set: { armL: upArm, lean: up.pose.lean ?? [0, 0], twist: up.pose.twist ?? 0, lids: [0.5, 0.48], ears: [0.05, 0.1] }, ease: outBack(1.2) },
    { t: 0.3, set: { armL: giveArm, lean: [0.03, 0.06] }, ease: outCubic },
    { t: 0.5, set: { brows: [0.35, -0.25], browTilt: [0.3, -0.1], ...pick(FACE.smug, ['lidsLow', 'mouth']) } },
    { t: 0.85, set: { armL: setArm, lean: set.pose.lean ?? [0.08, 0], twist: set.pose.twist ?? 0 }, ease: inOutCubic },
    { t: 1.0, set: { armL: { ...setArm, wrist: setArm.wrist - 0.25 } }, ease: outCubic },
    { t: 1.4, set: { arms: 'rest', lean: [0.02, 0], twist: 0.05, ...FACE.smug } },
    { t: REACTION_LENGTH, set: {} },
  ];
  const f = sampleOverlap(bake(face, keys), t, { tail: -0.15, ears: -0.05 });
  const pose = toPose(withBlinks(f, t, [1.2]));
  let crate: V3 | null = null;
  if (t >= 0.16 && t < 1.0) {
    const p = pawPoint(pose, 'left');
    crate = [p[0] + 0.02, p[1] + 0.07, p[2] + 0.03];
  }
  return { pose, crate };
}

/** It glances off the headset, which goes askew; Patch straightens it with great dignity. */
export function bonked(t: number, o: CrateOptions = {}): PatchPose {
  const vis = o.visitor ?? VISITOR;
  const src = o.from ?? vis;
  const rest = resolvePose(SEATED);
  const lkVis = lookAt(rest, vis, 0.85);
  const side = src[0] >= 0 ? 1 : -1; // knocked away from where it came
  const askew: [number, number] = [-side * 0.42, -0.18];
  const knocked: PatchPose = { ...SEATED, headTilt: -side * 0.32, headYaw: lkVis.headYaw - side * 0.2, headset: askew };
  const cup = cupPoint({ ...knocked, headTilt: 0, headPitch: lkVis.headPitch + 0.12, headYaw: lkVis.headYaw }, 'left');
  const fix = reach([cup[0] + 0.015, cup[1] + 0.02, cup[2] + 0.01], 'left', { ...SEATED, headYaw: lkVis.headYaw, headPitch: lkVis.headPitch + 0.12 }, { watch: false });
  const fixArm = resolvePose(fix.pose).arms.left;
  const keys: Key[] = [
    { t: 0, set: { ...SEATED, headYaw: lkVis.headYaw, headPitch: lkVis.headPitch, gaze: lkVis.gaze } },
    // the knock: head and headset tip away; lids shut; the boom flies up
    { t: 0.07, set: { headTilt: -side * 0.38, headYaw: lkVis.headYaw - side * 0.25, headPitch: lkVis.headPitch - 0.08, headset: askew, boom: 0.5, lids: [1, 1], lean: [0, -side * 0.12], ears: [0.6, 0.6] }, ease: outCubic },
    // the head comes back; the headset stays where it went
    { t: 0.3, set: { headTilt: -side * 0.12, headYaw: lkVis.headYaw - side * 0.08, headPitch: lkVis.headPitch, boom: 0.3, lids: [0.85, 0.85], lean: [0.0, 0] }, ease: inOutQuad },
    // a moment. the eyes open on the visitor, slowly
    { t: 0.62, set: { lids: [0.56, 0.6], gaze: [0.3, 0.15], ...pick(FACE.deadpan, ['brows', 'browTilt', 'lidsLow']), mouth: [0, -0.1] } },
    // the paw goes up, the chin comes up
    { t: 0.95, set: { armL: fixArm, headTilt: 0, headYaw: lkVis.headYaw, headPitch: lkVis.headPitch + 0.12, gaze: lkVis.gaze, lids: [0.6, 0.62], twist: fix.pose.twist ?? 0, lean: fix.pose.lean ?? [0, 0] } },
    // straightens it
    { t: 1.18, set: { headset: [0, 0], boom: 0, armL: { ...fixArm, roll: fixArm.roll + 0.2 } } },
    { t: 1.45, set: { arms: 'rest', twist: 0.05, lean: [0.02, 0], lids: [0.52, 0.54], mouth: [0.3, -0.1], headPitch: lkVis.headPitch + 0.08 } },
    { t: REACTION_LENGTH, set: {} },
  ];
  const f = sampleOverlap(bake(SEATED, keys), t, { eyes: 0.02, tail: -0.12, ears: -0.04 });
  return toPose(f);
}
