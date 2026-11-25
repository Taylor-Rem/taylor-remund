/**
 * P4 S6 round two: the arm of the opening stand's two candidate looks (`?standLook=1|2`, kit/pieces/opening-stand/
 * station.ts), driven here. Pure: from what the bench shows (the crate open on the stand and its lid, a project crate in
 * the hand, the clock), where the arm's tip goes and what it looks at; then a two-link solve to the four bones.
 *
 * What it does, in order of precedence:
 *  - a crate opens on the stand: the tip comes down under the lid's front edge (the lid waits for it: parts.ts
 *    `LID_HOLD`), rides up with it as it opens, and stays against it (2: then leans in and looks into the crate);
 *  - the visitor carries a shut project crate: it turns to it (1: rises to meet it; 2: looks at it, its lens alight,
 *    brighter as it comes near);
 *  - idle: poised over the empty outline; now and then (and on the registry's tell) 1 taps the deck, 2 sweeps the
 *    outline with its look.
 * Reduced motion: every move a cut, no idle beat.
 */
import { Quaternion, Vector3, type Object3D } from 'three';

export type V3 = [number, number, number];

/** Tune here (world units, seconds). */
export const ARM_FEEL = {
  /** How fast the tip moves toward where it wants to be (share of the way a second, as a spring's rate). */
  follow: 6,
  /** Faster while it rides a lid. */
  ride: 14,
  /** How long the lid waits for the tip to come under it (s). */
  lead: 0.6,
  /** Under the lid's edge by this much (along the lid's normal). */
  under: 0.03,
  /** Idle: a beat every `every` s (seeded jitter `jitter`), lasting `beat` s. */
  every: 7,
  jitter: 3,
  beat: { 1: 1.1, 2: 2.6 },
  /** 2: the lens lights within `near` of the held crate, fully at `full`. */
  near: 4,
  full: 1.2,
} as const;

/** The arm's measures, in the stand's own frame (its base's middle on the bench, +Z to the visitor). */
export interface ArmSpec {
  readonly look: 1 | 2;
  readonly shoulder: V3;
  readonly upper: number;
  readonly fore: number;
  /** The deck's top. */
  readonly deck: number;
}

export interface ArmBones {
  yaw: Object3D;
  upper: Object3D;
  fore: Object3D;
  tip: Object3D;
  lit: Object3D | null;
}

/** The two-link solve: yaw about Y at the shoulder, then the upper arm and forearm in that plane (elbow up). */
export function solve(a: ArmSpec, target: V3): { yaw: number; up: number; elbow: number; reach: V3 } {
  const dx = target[0] - a.shoulder[0], dy = target[1] - a.shoulder[1], dz = target[2] - a.shoulder[2];
  const yaw = Math.atan2(dx, dz);
  const r = Math.hypot(dx, dz);
  const L1 = a.upper, L2 = a.fore;
  const d = Math.max(Math.abs(L1 - L2) + 1e-3, Math.min(L1 + L2 - 1e-3, Math.hypot(r, dy)));
  const base = Math.atan2(dy, r);
  const inner = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d))));
  const up = base + inner; // the upper arm's rise over the level (elbow up)
  const knee = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2))));
  const elbow = Math.PI - knee; // the forearm's bend down from the upper arm's line
  // where the tip lands (the target, or as near as it reaches)
  const ex = L1 * Math.cos(up), ey = L1 * Math.sin(up);
  const fx = ex + L2 * Math.cos(up - elbow), fy = ey + L2 * Math.sin(up - elbow);
  const reach: V3 = [a.shoulder[0] + Math.sin(yaw) * fx, a.shoulder[1] + fy, a.shoulder[2] + Math.cos(yaw) * fx];
  return { yaw, up, elbow, reach };
}

/** Pose the bones: the arm to `tip`, the tip's own pitch so it points along `pitch` (radians over the level, + up). */
export function pose(a: ArmSpec, b: ArmBones, tip: V3, pitch: number): void {
  const s = solve(a, tip);
  b.yaw.rotation.y = s.yaw;
  // a bone's +Z is its arm's line; a turn about X by -θ lifts +Z by θ
  b.upper.rotation.x = -s.up;
  b.fore.rotation.x = s.elbow;
  b.tip.rotation.x = -(pitch - (s.up - s.elbow));
}

const q = new Quaternion();
const v = new Vector3();
/** A crate's lid's front edge at `open` (0..1 of LID_OPEN), in the stand's frame; and the lid's angle over the level. */
export function lidEdge(cp: { p: V3; q: readonly [number, number, number, number] }, half: V3, open: number, lidOpen: number, origin: V3): { at: V3; angle: number } {
  const th = open * lidOpen;
  const D = 2 * half[2];
  v.set(0, half[1] + D * Math.sin(th), -half[2] + D * Math.cos(th));
  q.set(cp.q[0], cp.q[1], cp.q[2], cp.q[3]);
  v.applyQuaternion(q);
  return { at: [cp.p[0] + v.x - origin[0], cp.p[1] + v.y - origin[1], cp.p[2] + v.z - origin[2]], angle: th };
}

/** Ease `cur` toward `goal` at `rate` (share a second), in place. */
export function ease(cur: V3, goal: V3, rate: number, dt: number): void {
  const k = 1 - Math.exp(-rate * dt);
  for (let i = 0; i < 3; i++) cur[i] = cur[i]! + (goal[i]! - cur[i]!) * k;
}
