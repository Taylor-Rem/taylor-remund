/**
 * Fetch frightened by the Big Red Button (state `frozen`, for the whole rung): a pure function of the rung's
 * clock. A startle hop, the arms snapped in close (the telescopes short), the eye wide and a shiver; on rung 4
 * it hides its eye behind its claws and peeks between them; on the rewind it unfolds cautiously and its
 * weight goes to zero before Revert's card comes up, so the card has the eye. Each press is a little
 * different (`presses`), so the fourth is not the first again. Reduced motion: a pose, no hop, no shiver.
 *
 * The head's aim (at the Button, then at the visitor) is the caller's; this gives the body, the arms, the
 * lids, a shiver of the head and how much of the pose is the fright's.
 */
import { type ArmJoints, type Arms, type FetchPose } from './rig.ts';
import { clamp, lerp, smoothstep } from '../../../anim/index.ts';

const J = (swing: number, abduct: number, twist: number, elbow: number, wrist: number, grip: number): ArmJoints => ({ swing, abduct, twist, elbow, wrist, grip, tele: 0 });
const KEYS = ['swing', 'abduct', 'twist', 'elbow', 'wrist', 'grip'] as const;
function mixArm(a: ArmJoints, b: ArmJoints, k: number): ArmJoints {
  const o = J(0, 0, 0, 0, 0, 0);
  for (const key of KEYS) o[key] = lerp(a[key], b[key], k);
  const ta = typeof a.tele === 'number' ? a.tele : 0, tb = typeof b.tele === 'number' ? b.tele : 0;
  o.tele = lerp(ta, tb, k);
  return o;
}
const mixArms = (a: Arms, b: Arms, k: number): Arms => ({ left: mixArm(a.left, b.left, k), right: mixArm(a.right, b.right, k) });

/** The claws pulled in tight in front of its chest, jaws shut. */
export const GUARD: Arms = { left: J(1.55, -0.3, -0.4, 2.0, -0.6, 0.1), right: J(1.5, -0.28, -0.4, 2.05, -0.6, 0.12) };
/**
 * Hiding from the home camera (which sits off Fetch's right and above, the turret turned toward it):
 * the right claw on its tubes square in front of the eye, the left up over its head. Solved offline
 * against the home camera (shots/V/hide2.test.ts); the lids close behind the claw as well.
 */
export const HIDE: Arms = { left: { ...J(2.9, 0.75, 0, 0.15, -1.0, 0.2), tele: 0.22 }, right: { ...J(2.8, 0.35, 0.4, 0.15, -1.0, 0.2), tele: 0.22 } };
/** The peek: the covering claw dropped well clear of the eye. */
const PEEK_R: ArmJoints = { ...J(1.3, 0.7, 0, 1.3, -0.8, 0.5), tele: 0.03 };
/** The startle: both arms flung straight up, the tubes run out, jaws wide. */
const UP: Arms = { left: { ...J(2.9, 0.6, 0, 0.15, 0, 1), tele: 0.225 }, right: { ...J(2.9, 0.6, 0, 0.15, 0, 1), tele: 0.225 } };
/** The turret's aim while hiding, toward the home camera: yaw (a share of the camera's bearing) and pitch. */
export const HIDE_AIM = { yawShare: 0.67, pitch: -0.2 } as const;
/** Claws over its head: cowering. */
export const COWER: Arms = { left: J(2.2, 0.3, 0.6, 1.7, 0, 0.2), right: J(2.15, 0.32, 0.6, 1.75, 0, 0.2) };
const REST_ARMS: Arms = { left: J(0.42, 0.2, -0.35, 0.95, -0.3, 0.3), right: J(0.38, 0.18, -0.35, 0.9, -0.3, 0.25) };

export interface FrightOptions {
  /** 'playing' (the rung's show) or 'rewinding' (it runs backwards). */
  phase: 'playing' | 'rewinding';
  /** Seconds into the phase. */
  t: number;
  /** The rewind's length (s). */
  rewind: number;
  /** Which rung (1..4, then from the deck) and how many presses so far: what varies the reaction. */
  rung: number;
  presses: number;
  /** Unit [fore, side] in its root frame pointing away from the Button: it leans that way the whole rung. */
  away?: readonly [number, number];
  /** The camera's bearing in its root frame (radians, as headYaw): rung 4 turns its hidden face toward it. */
  camYaw?: number;
  reducedMotion?: boolean;
}

export interface Fright {
  /** The frightened pose (no head aim): blend it over the acting by `weight`. */
  pose: FetchPose;
  weight: number;
  /** 0..1: the head should go from the Button to the visitor (late in the rewind), then to the card. */
  toVisitor: number;
  /** Rung 4: how much of the head's aim is the pose's own (headYaw/headPitch absolute), not the caller's. */
  aim: number;
}

export function frightened(o: FrightOptions): Fright {
  const rm = o.reducedMotion === true;
  const hide = o.rung >= 4;
  const v = hide ? 3 : ((o.presses - 1) % 3 + 3) % 3;
  const playing = o.phase === 'playing';
  const t = playing ? o.t : 1e3;
  // the startle: a real jump (a third of its height clear of the bench), stretched in the air, squashed on landing
  const AIR = 0.5;
  const u = t / AIR;
  const jump = rm ? 0 : u < 1 ? (v === 1 ? 0.5 : 0.45) * 4 * u * (1 - u) : 0;
  const land = rm ? 0 : t >= AIR && t < AIR + 0.4 ? Math.sin(Math.PI * clamp((t - AIR) / 0.4, 0, 1)) * (1 - (t - AIR) / 0.4) : 0;
  const crouch = smoothstep(AIR, AIR + 0.35, t);
  // arms flung straight up for the first quarter second, then snapped in to the guard
  const arms0: Arms = hide ? HIDE : v === 2 ? COWER : v === 1 ? { left: GUARD.left, right: COWER.right } : GUARD;
  const snap = rm ? 1 : smoothstep(0.25, 0.4, t);
  let arms = rm ? arms0 : mixArms(mixArms(REST_ARMS, UP, smoothstep(0, 0.06, t)), arms0, snap);
  // rung 4: peeks, the covering claw dropped right away from the eye for a beat every 1.3 s
  let peek = 0;
  if (hide && !rm && playing) {
    const p = (t - 1.0) % 1.3;
    peek = t > 1.0 ? smoothstep(0, 0.12, p) * (1 - smoothstep(0.5, 0.62, p)) : 0;
    arms = { left: arms.left, right: mixArm(arms.right, PEEK_R, peek) };
  }
  // the shiver (not in reduced motion)
  const tt = playing ? o.t : o.t + 50;
  const shiver = rm ? 0 : 1 - smoothstep(0, 0.8, playing ? 0 : o.t);
  const aw = o.away ?? [0, 0];
  const LEAN = 0.3; // 17 degrees away from the Button, the whole rung
  const lean: [number, number] = [
    LEAN * aw[0] + (v === 1 ? -0.06 : 0) * crouch + 0.03 * shiver * Math.sin(tt * Math.PI * 2 * 9.5 + 1),
    LEAN * aw[1] + 0.07 * shiver * Math.sin(tt * Math.PI * 2 * 12),
  ];
  const squash = (jump > 0 ? -0.5 : 0) + 0.95 * land + crouch * (v === 2 ? 0.5 : 0.32);
  const hidden = hide ? 1 - peek : 0;
  const pose: FetchPose = {
    lean,
    squash: clamp(squash, -0.6, 1),
    lift: jump,
    headRoll: 0.1 * shiver * Math.sin(tt * Math.PI * 2 * 10),
    headPitch: hide ? lerp(HIDE_AIM.pitch, 0.15, peek) : -0.05,
    headYaw: hide ? HIDE_AIM.yawShare * (o.camYaw ?? 0) : 0,
    brow: t < 0.5 ? -1 : -0.55 - 0.4 * peek,
    pupilSize: hide ? lerp(0.7, 0.6, peek) : t < 0.6 ? 0.55 : 0.7,
    // the eye: wide (the whole disc bigger), its brightest thing; hiding, the lids close behind the claw
    eyeScale: hide ? lerp(1.0, 1.45, peek) : t < 0.6 ? 1.45 : 1.38,
    lids: hide ? [0.62 * hidden, 0.45 * hidden] : [0, 0.05],
    arms,
    aerial: [0.5 * shiver * Math.sin(tt * Math.PI * 2 * 6) + (jump > 0 ? -0.8 : 0), 0.4 * shiver * Math.sin(tt * Math.PI * 2 * 7.5)],
  };
  if (playing) return { pose, weight: 1, toVisitor: 0, aim: hide ? 1 : 0 };
  // the rewind: it unfolds cautiously (a little, a pause, the rest), and is itself before the card comes up
  const R = Math.max(0.5, o.rewind);
  const ur = clamp(o.t / R, 0, 1);
  const unfold = 0.35 * smoothstep(0.1, 0.3, ur) + 0.65 * smoothstep(0.45, 0.85, ur);
  return { pose, weight: 1 - unfold, toVisitor: smoothstep(0.5, 0.8, ur), aim: hide ? 1 - smoothstep(0.1, 0.5, ur) : 0 };
}
