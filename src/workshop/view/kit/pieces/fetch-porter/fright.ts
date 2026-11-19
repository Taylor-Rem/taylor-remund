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
  return o;
}
const mixArms = (a: Arms, b: Arms, k: number): Arms => ({ left: mixArm(a.left, b.left, k), right: mixArm(a.right, b.right, k) });

/** The claws pulled in tight in front of its chest, jaws shut. */
export const GUARD: Arms = { left: J(1.25, -0.3, -0.4, 2.1, -0.6, 0.1), right: J(1.2, -0.28, -0.4, 2.15, -0.6, 0.12) };
/** Both claws up and in front of its eye: hiding. */
export const HIDE: Arms = { left: J(2.2, -0.5, -0.1, 1.15, -1.0, 0.25), right: J(2.2, -0.52, -0.1, 1.2, -1.0, 0.25) };
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
  reducedMotion?: boolean;
}

export interface Fright {
  /** The frightened pose (no head aim): blend it over the acting by `weight`. */
  pose: FetchPose;
  weight: number;
  /** 0..1: the head should go from the Button to the visitor (late in the rewind), then to the card. */
  toVisitor: number;
}

export function frightened(o: FrightOptions): Fright {
  const rm = o.reducedMotion === true;
  const hide = o.rung >= 4;
  const v = hide ? 3 : ((o.presses - 1) % 3 + 3) % 3;
  const playing = o.phase === 'playing';
  const t = playing ? o.t : 1e3;
  // the startle: a hop up off the spring, then down into a crouch
  const hop = rm ? 0 : (v === 1 ? 0.07 : 0.045) * Math.sin(Math.PI * clamp(t / 0.28, 0, 1)) * (t < 0.28 ? 1 : 0);
  const crouch = smoothstep(0.15, 0.4, t);
  const arms0: Arms = hide ? HIDE : v === 2 ? COWER : GUARD;
  const snap = rm ? 1 : smoothstep(0.02, 0.12, t);
  let arms = mixArms(REST_ARMS, arms0, snap);
  // rung 4: peeks between its claws, one claw drawn down for a moment every 1.3 s
  let peek = 0;
  if (hide && !rm && playing) {
    const p = (t - 0.8) % 1.3;
    peek = t > 0.8 ? smoothstep(0, 0.15, p) * (1 - smoothstep(0.45, 0.6, p)) : 0;
    arms = { left: arms.left, right: mixArm(arms.right, J(1.6, -0.3, -0.2, 1.6, -0.8, 0.5), peek) };
  }
  // the shiver (not in reduced motion)
  const sh = rm ? 0 : 1;
  const tt = playing ? o.t : o.t + 50;
  const shiver = sh * (1 - smoothstep(0, 0.8, playing ? 0 : o.t));
  const lean: [number, number] = [
    lerp(0.02, v === 1 ? -0.14 : -0.06, crouch) + 0.014 * shiver * Math.sin(tt * Math.PI * 2 * 9.5 + 1),
    0.022 * shiver * Math.sin(tt * Math.PI * 2 * 12),
  ];
  const squash = (t < 0.12 && !rm ? -0.5 : 0) + crouch * (v === 2 ? 0.5 : 0.32);
  const pose: FetchPose = {
    lean,
    squash: clamp(squash, -0.6, 1),
    lift: hop,
    headRoll: 0.05 * shiver * Math.sin(tt * Math.PI * 2 * 10),
    headPitch: hide ? -0.15 + 0.12 * peek : -0.05,
    brow: t < 0.4 ? -1 : -0.55 - 0.3 * peek,
    pupilSize: t < 0.6 ? 0.55 : 0.7 + 0.25 * peek,
    lids: [0, hide ? 0.15 : 0.05],
    arms,
    aerial: [0.25 * shiver * Math.sin(tt * Math.PI * 2 * 6), 0.2 * shiver * Math.sin(tt * Math.PI * 2 * 7.5)],
  };
  if (playing) return { pose, weight: 1, toVisitor: 0 };
  // the rewind: it unfolds cautiously (a little, a pause, the rest), and is itself before the card comes up
  const R = Math.max(0.5, o.rewind);
  const u = clamp(o.t / R, 0, 1);
  const unfold = 0.35 * smoothstep(0.1, 0.3, u) + 0.65 * smoothstep(0.45, 0.85, u);
  return { pose, weight: 1 - unfold, toVisitor: smoothstep(0.5, 0.8, u) };
}
