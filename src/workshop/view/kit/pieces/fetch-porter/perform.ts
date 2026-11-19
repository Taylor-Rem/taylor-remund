/**
 * Fetch's performances: pure functions of time (seconds since the beat began)
 * and a few parameters that return a whole `FetchPose`. No state, no clock,
 * no springs: the same arguments give the same pose, so a strip of frames is
 * reproducible and a test can hold a beat to its length. The station view
 * calls them and cross-fades into and out of its own spring-driven acting
 * (`blendPose`); every beat ends on `REST` (or a pose its caller names), so
 * the hand-back is seamless.
 *
 *   knocked(t, { from, strength })   hit by a thrown part: shoved, spun, wobbles, rights itself  ≤ 1.5 s
 *   held(t, { carry })               lifted off the bench: wheel spins down, limbs dangle and sway   (loops)
 *   setDown(t, { spin })             put down: the spring takes it, it steadies                       0.8 s
 *   dizzy(t)                         the world goes round; a shake of the head and it is back         1.5 s
 *   salute(t)                        its job done for it: looks at the empty claws, salutes           1.1 s
 *   handsUp(t)                       something carried near: claws up, "here, here"                   (loops)
 *   outOfLane(t, { toward })         stretches for something past the tape, gives up                  1.4 s
 *
 * Conventions are the rig's (rig.ts): +X is Fetch's own left (screen right
 * when it faces the camera), +Z its front. Directions passed in are in
 * Fetch's own frame (the root's: its lane heading), [x, z].
 *
 * The root offsets a beat uses (`spin`, `slide`, `lift`) are drawn by the
 * rig on the `lean` node, so the station's root keeps the simulation's
 * position and heading; `contactPoint(pose)` says where the tyre is for the
 * contact shadow.
 */
import { PRESETS, stagesOf, type ArmJoints, type Arms, type FetchPose } from './rig.ts';
import { clamp, clamp01, inOutQuad, lerp, outBack, smoothstep, track } from '../../../anim/index.ts';

// ───────────────────────── small maths ─────────────────────────

const TAU = Math.PI * 2;
const J = (swing: number, abduct: number, twist: number, elbow: number, wrist: number, grip: number): ArmJoints => ({ swing, abduct, twist, elbow, wrist, grip });
/** The joints that are plain angles (the telescope's `tele` is mixed stage by stage). */
type AngleKey = Exclude<keyof ArmJoints, 'tele'>;
const KEYS: readonly AngleKey[] = ['swing', 'abduct', 'twist', 'elbow', 'wrist', 'grip'];
function mixArm(a: ArmJoints, b: ArmJoints, k: number): ArmJoints {
  const o = J(0, 0, 0, 0, 0, 0);
  for (const key of KEYS) o[key] = lerp(a[key], b[key], k);
  if (a.tele !== undefined || b.tele !== undefined) {
    const sa = stagesOf(a), sb = stagesOf(b);
    o.tele = [lerp(sa[0], sb[0], k), lerp(sa[1], sb[1], k), lerp(sa[2], sb[2], k)];
  }
  return o;
}
const mixArms = (a: Arms, b: Arms, k: number): Arms => ({ left: mixArm(a.left, b.left, k), right: mixArm(a.right, b.right, k) });
function addArm(a: ArmJoints, d: Partial<Record<AngleKey, number>>): ArmJoints {
  const o = { ...a };
  for (const key of KEYS) o[key] += d[key] ?? 0;
  return o;
}

/**
 * A struck spring's response, starting at 0 and peaking at +1: e^(-ζωt)·sin(ω_d t), normalised by its
 * first peak. `f` is the ringing frequency (Hz), `z` the damping ratio. 0 before t = 0.
 */
export function ring(t: number, f: number, z: number): number {
  if (t <= 0) return 0;
  const wd = TAU * f;
  const w = wd / Math.sqrt(1 - z * z);
  const tp = Math.atan2(wd, z * w) / wd;
  const peak = Math.exp(-z * w * tp) * Math.sin(wd * tp);
  return (Math.exp(-z * w * t) * Math.sin(wd * t)) / peak;
}
/** The same spring let go from 1 (a displaced thing settling): e^(-ζωt)·cos(ω_d t). 1 before t = 0. */
export function settle(t: number, f: number, z: number): number {
  if (t <= 0) return 1;
  const wd = TAU * f;
  const w = wd / Math.sqrt(1 - z * z);
  return Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t));
}
/** 0 → 1 → 0 between a and d, rising over a..b and falling over c..d (eased). */
function window4(t: number, a: number, b: number, c: number, d: number): number {
  return smoothstep(a, b, t) * (1 - smoothstep(c, d, t));
}
/** Rotate a root-space [x, z] into a frame spun by `spin` (the rig's lean frame). */
function unspin(v: readonly [number, number], spin: number): [number, number] {
  const c = Math.cos(spin), s = Math.sin(spin);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c];
}
/** Lean that tips the top toward a direction [x, z] in the lean frame: [fore, side]. */
const leanToward = (d: readonly [number, number], a: number): [number, number] => [d[1] * a, d[0] * a];
/** Aerial bend that carries its tip toward [x, z]: [about X, about Z]. */
const aerialToward = (d: readonly [number, number], a: number): [number, number] => [d[1] * a, d[0] * a];
/** Head roll/pitch that tips the turret's top toward [x, z] (body frame). */
const headToward = (d: readonly [number, number], a: number): { roll: number; pitch: number } => ({ roll: d[0] * a, pitch: -d[1] * a });

/** A blink: 0 open .. 1 shut .. 0, 0.17 s long, starting at `at`. */
function blink(t: number, at: number): number {
  const u = t - at;
  if (u < 0 || u > 0.17) return 0;
  return u < 0.06 ? u / 0.06 : u < 0.08 ? 1 : 1 - (u - 0.08) / 0.09;
}

// ───────────────────────── the resting pose every beat lands on ─────────────────────────

/** Where every beat ends: the station's own idle at rest (lids a hair down, everything else neutral). */
export const REST: Readonly<Required<Omit<FetchPose, 'arms'>> & { arms: Arms }> = {
  lean: [0.02, 0],
  wheel: 0,
  squash: 0,
  headYaw: 0,
  headPitch: 0,
  headRoll: 0,
  brow: 0,
  pupilSize: 1,
  gaze: [0, 0],
  lids: [0.12, 0.1],
  arms: PRESETS.rest,
  aerial: [0, 0],
  flag: 0,
  spin: 0,
  slide: [0, 0],
  lift: 0,
  hang: [0, 0],
};

/** Named strengths for `knocked`. */
export const KNOCK = { nudge: 0.25, knock: 0.6, wallop: 1 } as const;
export type KnockName = keyof typeof KNOCK;

/** How long each finite beat lasts (s). `knocked` depends on its strength: `knockedLength`. */
export const LENGTHS = { setDown: 0.8, dizzy: 1.5, salute: 1.1, outOfLane: 1.4 } as const;

/** A knock's length: 0.8 s for a nudge, 1.5 s for a wallop (§ B5: a reaction lasts at most a second and a half). */
export function knockedLength(strength: number | KnockName): number {
  const s = typeof strength === 'number' ? clamp01(strength) : KNOCK[strength];
  return lerp(0.75, 1.5, smoothstep(0.15, 1, s));
}

// ───────────────────────── blending ─────────────────────────

const arr = (v: number | readonly number[] | undefined, n: number, d: readonly number[]): number[] => (Array.isArray(v) ? [...(v as number[])] : typeof v === 'number' ? [v] : [...d]).slice(0, n);

/**
 * Mix two poses, `k` = 0 all `a` .. 1 all `b`. Arms are resolved and mixed joint by joint; wheel
 * and flag phases mix linearly (keep them continuous yourself if you cross-fade a long way).
 */
export function blendPose(a: FetchPose, b: FetchPose, k: number): FetchPose {
  const ra = { ...REST, ...a }, rb = { ...REST, ...b };
  const t = clamp01(k);
  const l2 = (x: readonly number[], y: readonly number[]): [number, number] => [lerp(x[0]!, y[0]!, t), lerp(x[1]!, y[1]!, t)];
  const armsOf = (p: FetchPose): Arms => {
    const v = p.arms;
    if (v === undefined) return PRESETS.rest;
    if (typeof v === 'string') return PRESETS[v];
    if ('left' in v && 'right' in v) return v as Arms;
    // a weighted blend of presets
    let total = 0;
    const out: Arms = { left: J(0, 0, 0, 0, 0, 0), right: J(0, 0, 0, 0, 0, 0) };
    for (const w of Object.values(v)) total += Math.max(0, w ?? 0);
    for (const [name, w] of Object.entries(v)) {
      const f = Math.max(0, w ?? 0) / (total || 1);
      const pr = PRESETS[name as keyof typeof PRESETS];
      for (const key of KEYS) {
        out.left[key] += pr.left[key] * f;
        out.right[key] += pr.right[key] * f;
      }
    }
    return total > 0 ? out : PRESETS.rest;
  };
  return {
    lean: l2(arr(ra.lean, 2, [0, 0]), arr(rb.lean, 2, [0, 0])),
    wheel: lerp(ra.wheel, rb.wheel, t),
    squash: lerp(ra.squash, rb.squash, t),
    headYaw: lerp(ra.headYaw, rb.headYaw, t),
    headPitch: lerp(ra.headPitch, rb.headPitch, t),
    headRoll: lerp(ra.headRoll, rb.headRoll, t),
    brow: lerp(ra.brow, rb.brow, t),
    pupilSize: lerp(ra.pupilSize, rb.pupilSize, t),
    gaze: l2(arr(ra.gaze, 2, [0, 0]), arr(rb.gaze, 2, [0, 0])),
    lids: l2(arr(ra.lids, 2, [0, 0]), arr(rb.lids, 2, [0, 0])),
    arms: mixArms(armsOf(a), armsOf(b), t),
    aerial: l2(arr(ra.aerial, 2, [0, 0]), arr(rb.aerial, 2, [0, 0])),
    flag: lerp(ra.flag, rb.flag, t),
    spin: lerp(ra.spin, rb.spin, t),
    slide: l2(arr(ra.slide, 2, [0, 0]), arr(rb.slide, 2, [0, 0])),
    lift: lerp(ra.lift, rb.lift, t),
    hang: l2(arr(ra.hang, 2, [0, 0]), arr(rb.hang, 2, [0, 0])),
  };
}

// ───────────────────────── knocked ─────────────────────────

export interface KnockedOptions {
  /** Where the hit came FROM, in Fetch's own frame [x, z] (any length; +Z its front, +X its left). */
  from: readonly [number, number];
  /** 0..1, or a name: nudge (0.25), knock (0.6), wallop (1). */
  strength: number | KnockName;
}

/**
 * Hit by a thrown part. The body is shoved away from the hit and the spring
 * takes the blow; the head whips round late; the eye goes wide, then
 * squeezes shut; the arms fling and the aerial lashes; the wheel skids. A
 * hard hit spins it (a wallop, a full turn) and pops the wheel off the
 * bench. Then it wobbles on its one wheel with decaying over-corrections,
 * shakes its head (knock and up), blinks, and rolls back under itself. Ends
 * on `REST` at `knockedLength(strength)`.
 */
export function knocked(t: number, o: KnockedOptions): FetchPose {
  const s = typeof o.strength === 'number' ? clamp01(o.strength) : KNOCK[o.strength];
  const L = knockedLength(s);
  const tt = clamp(t, 0, L);
  // the direction of the shove: away from the hit
  const fl = Math.hypot(o.from[0], o.from[1]) || 1;
  const from: [number, number] = [o.from[0] / fl, o.from[1] / fl];
  const away: [number, number] = [-from[0], -from[1]];
  // which way it is spun: a hit on its left side turns it clockwise, and so on (straight on: one way, always)
  const sgn = Math.abs(from[0]) > 0.15 ? -Math.sign(from[0]) : 1;
  const hard = smoothstep(0.55, 1, s); // 0 nudge .. 1 wallop
  const mid = smoothstep(0.2, 0.6, s); // knock and up

  // ── where it goes: skid away, spin, roll back under itself ──
  const out = 0.05 + 0.2 * s * s + 0.05 * s; // how far the skid carries it
  const back0 = lerp(0.35, 0.75, s), back1 = L - 0.12;
  const slideK = (u: number): number => (1 - Math.exp(-u / 0.07)) * (1 - inOutQuad(clamp01((u - back0) / (back1 - back0))));
  const slideAt = (u: number): [number, number] => [away[0] * out * slideK(u), away[1] * out * slideK(u)];
  // spin: a nudge turns it a little and it turns back; a knock half way round and back; a wallop all the way round
  const spinAt = (u: number): number => {
    if (hard > 0.5) {
      // a full turn, fast then slowing, a little past and back (it catches itself)
      const turn = TAU * outBack(0.9)(clamp01(u / 0.85));
      return sgn * turn;
    }
    // turned, and springing back round through its heading once before it settles
    const peak = lerp(0.35, 1.3, smoothstep(0.15, 0.8, s));
    return sgn * peak * ring(u, lerp(1.3, 0.85, smoothstep(0.15, 0.8, s)), 0.42) * (1 - smoothstep(L - 0.3, L, u));
  };
  const spin = spinAt(tt);
  const slide = slideAt(tt);
  // the wheel: scrubs while it skids (a fraction of a roll), rolls properly coming back
  let wheel = 0;
  {
    const n = 48;
    const h = tt / n;
    let prev = slideAt(0);
    for (let i = 1; i <= n; i++) {
      const u = i * h;
      const cur = slideAt(u);
      const sp = spinAt(u);
      // forward component of the move along the spun facing
      const ds = (cur[0] - prev[0]) * Math.sin(sp) + (cur[1] - prev[1]) * Math.cos(sp);
      const rolling = u < back0 ? 0.3 : 1;
      wheel += (ds / 0.155) * rolling;
      prev = cur;
    }
    // and a wild free spin while it is off the ground
    wheel += sgn * hard * 9 * Math.max(0, Math.min(tt, 0.3) - 0.04);
  }
  // a wallop pops it off the bench for a moment
  const lift = hard * 0.06 * Math.sin(Math.PI * clamp01((tt - 0.03) / 0.22));

  // ── the body: shoved over, then wobbling round to upright ──
  // the shove (quick, well damped) and then the wobble it leaves (slower, ringing on): it finds its balance
  const A = lerp(0.14, 0.3, s);
  const f = lerp(2.8, 2.2, s), z = lerp(0.3, 0.12, s);
  const main = 0.8 * ring(tt, f * 1.2, 0.42) + 0.75 * ring(tt - 0.22, f * 0.85, z);
  // a quarter-cycle-late wobble across the shove: the over-corrections go round, not just back and forth
  const across = ring(tt - 0.12, f * 1.13, z * 1.1) * 0.45 * mid;
  const perp: [number, number] = [-away[1], away[0]];
  const tipW: [number, number] = [away[0] * main * A + perp[0] * across * A * sgn, away[1] * main * A + perp[1] * across * A * sgn];
  const tip = unspin(tipW, spin);
  // a slow wind-down sway that dies by the end (it finds its balance)
  const fade = 1 - smoothstep(L - 0.3, L, tt);
  const lean = leanToward(tip, 1);
  lean[0] = lean[0] * fade + 0.02 * smoothstep(L - 0.3, L, tt);
  lean[1] *= fade;
  // the spring: struck at the hit, rebounds
  const squash = clamp(lerp(0.4, 1, s) * ring(tt - 0.01, 6.5, 0.32) - 0.25 * mid * window4(tt, 0.15, 0.25, 0.35, 0.5), -0.6, 1) * fade;

  // ── the head: late, then over the top ──
  const awayB = unspin(away, spin);
  const lag = ring(tt - 0.05, 3.2, 0.28); // starts after the body, lags the other way
  const ht = headToward(awayB, -0.42 * lerp(0.6, 1, s) * lag);
  // the head shake: "brr" (knock and wallop)
  const sh0 = lerp(0.5, 0.78, hard), sh1 = sh0 + lerp(0.3, 0.42, hard);
  const shake = mid * window4(tt, sh0, sh0 + 0.06, sh1 - 0.08, sh1) * Math.sin(TAU * 6.5 * (tt - sh0));
  // a wallop leaves it looking round for a beat (the eye trails the spin)
  const lookBack = hard * window4(tt, 0.85, 1.0, 1.15, 1.3);
  const headYaw = (0.45 * shake + 0.5 * lookBack * -sgn) * fade - 0.25 * hard * ring(tt - 0.02, 1.4, 0.4) * sgn;
  const headRoll = clamp(ht.roll + 0.18 * shake * mid, -0.42, 0.42) * fade;
  const headPitch = clamp(ht.pitch, -0.45, 0.5) * fade;

  // ── the eye: wide, squeezed shut, dazed, a blink, itself ──
  const wideEnd = 0.06, shut0 = 0.09, shut1 = lerp(0.2, 0.45, s), open1 = shut1 + 0.12;
  const squeeze = window4(tt, wideEnd, shut0, shut1, open1);
  const dazed = window4(tt, shut1, open1, L - 0.35, L - 0.15) * mid;
  const bl = blink(tt, L - 0.3);
  const lidT = Math.max(lerp(lerp(0, 0.12, smoothstep(L - 0.3, L, tt)), 1, squeeze) + 0.35 * dazed, bl);
  const lidB = Math.max(lerp(lerp(0, 0.1, smoothstep(L - 0.3, L, tt)), 0.92, squeeze) + 0.25 * dazed, bl * 0.85);
  const brow = tt < wideEnd ? -1 : lerp(lerp(-1, 0, smoothstep(open1, L, tt)), 1, squeeze) + 0.3 * dazed;
  const pupilSize = tt < shut0 ? lerp(1, 0.55, smoothstep(0, 0.03, tt)) : lerp(0.55, 1, smoothstep(open1, L - 0.2, tt));
  // dazed: the pupil drifts round in a small circle
  const dz = dazed * (1 - smoothstep(sh0 - 0.05, sh0 + 0.1, tt) * 0.5);
  const gaze: [number, number] = [0.45 * dz * Math.cos(TAU * 2.2 * tt), 0.3 * dz * Math.sin(TAU * 2.2 * tt) - 0.15 * dz];

  // ── the arms: flung, then dropping back with a bounce ──
  const fling = clamp01(ring(tt - 0.02, 2.1, 0.38) * 1.15) * lerp(0.45, 1, s);
  const fl2 = Math.max(0, -ring(tt - 0.02, 2.1, 0.38)); // the swing back past rest
  let arms = mixArms(PRESETS.rest, PRESETS.flail, clamp01(fling));
  // the arm on the side the hit came from lags hardest; both swing back against the shove's fore/aft
  const fromB = unspin(from, spin);
  const lw = clamp01(0.6 + 0.5 * fromB[0]), rw = clamp01(0.6 - 0.5 * fromB[0]);
  arms = {
    left: addArm(arms.left, { swing: -0.6 * awayB[1] * fling * lw - 0.3 * fl2, abduct: 0.3 * fling * lw, grip: 0.4 * fling }),
    right: addArm(arms.right, { swing: -0.6 * awayB[1] * fling * rw - 0.25 * fl2, abduct: 0.3 * fling * rw, grip: 0.4 * fling }),
  };
  arms = mixArms(arms, PRESETS.rest, smoothstep(L - 0.35, L, tt));

  // ── aerial and pennant: the aerial lags the shove, then lashes ──
  const lash = ring(tt - 0.015, 3.4, 0.11) * lerp(0.7, 1.4, s) * (1 - smoothstep(L - 0.25, L, tt));
  const aerial = aerialToward(awayB, -lash);
  const flag = 2 * tt + lerp(5, 14, s) * (1 - Math.exp(-tt / 0.35));

  return {
    lean: [clamp(lean[0], -0.45, 0.45), clamp(lean[1], -0.35, 0.35)],
    wheel,
    squash,
    headYaw,
    headPitch,
    headRoll,
    brow: clamp(brow, -1, 1),
    pupilSize,
    gaze,
    lids: [clamp01(lidT), clamp01(lidB)],
    arms,
    aerial,
    flag,
    spin,
    slide,
    lift: Math.max(0, lift),
  };
}

// ───────────────────────── held and set down ─────────────────────────

/** Arms hanging out to the sides in the visitor's hand (the station's own dangle). */
export const DANGLE: Arms = { left: J(0.7, 1.15, -0.5, 0.6, -0.4, 0.95), right: J(0.65, 1.2, -0.5, 0.7, -0.4, 0.9) };

export interface HeldOptions {
  /** The hand's velocity in Fetch's own frame [x, y, z] (units/s). The wheel and limbs trail it. */
  carry?: readonly [number, number, number];
  /** Wheel spin at the moment it left the bench (rad/s; + rolls forward). Default 26. */
  spin?: number;
}

/**
 * In the visitor's hand. The hand holds the torso: the caller puts the root
 * where the hand is (no lean to undo: `lean` is 0 here and the swing is the
 * rig's `hang`, the wheel assembly swinging under a torso that stays put).
 * The wheel spins freely and runs down; the
 * spring hangs out long; arms, fork and aerial swing like a pendulum after
 * the lift and trail the hand's movement; the eye looks down at the bench,
 * blinks, then up at the visitor ("well?"), and back down, round and round.
 * Loops: valid for any t ≥ 0.
 */
export function held(t: number, o: HeldOptions = {}): FetchPose {
  const tt = Math.max(0, t);
  const [vx, vy, vz] = o.carry ?? [0, 0, 0];
  const w0 = o.spin ?? 26;
  // (the wheel spins freely; it whirs up again in a panic, below)
  // the wheel runs down on its bearing
  const tau = 1.8;
  const wheel = w0 * tau * (1 - Math.exp(-tt / tau));
  // the spring: snatched long at the lift, bouncing, then hanging out
  const squash = -0.6 + 0.6 * settle(tt, 3.2, 0.3) * Math.exp(-tt * 0.5);
  // the pendulum: the wheel swings under the body after the lift (a figure, not a line), and trails the hand
  const swF = 0.2 * ring(tt - 0.02, 1.3, 0.1), swS = 0.26 * ring(tt - 0.12, 1.15, 0.1);
  const sway = Math.sin(TAU * 0.55 * tt + 0.7);
  const trail = (v: number): number => clamp(0.12 * v, -0.45, 0.45);
  // + hang puts the tyre on the far side from + lean's top: the tyre trails the hand's motion
  const hang: [number, number] = [clamp(trail(vz) + swF + 0.03 * sway, -0.6, 0.6), clamp(trail(vx) + swS + 0.05 * Math.sin(TAU * 0.42 * tt), -0.6, 0.6)];
  // arms: a pendulum a beat behind the wheel's, out to the sides, trailing the hand
  const ap = 0.3 * ring(tt - 0.1, 1.5, 0.12) + 0.05 * sway;
  const as = 0.28 * ring(tt - 0.16, 1.35, 0.12);
  const bob = clamp(-0.06 * vy, -0.4, 0.4); // a hand lifting fast leaves them low; dropping, they float
  // the flail (a picked-up Mii): arms paddling out of step, jaws snapping, for about two seconds after the lift
  // and in a burst whenever the hand shakes or swings it; then a resigned dangle with the odd kick
  const speed = Math.hypot(vx, vy, vz);
  const panic = Math.max(Math.exp(-tt / 1.1), smoothstep(0.8, 2.6, speed));
  const kickAt = tt > 2 ? (tt - 2) % 1.9 : -1;
  const kick = kickAt >= 0 ? Math.sin(Math.PI * clamp(kickAt / 0.28, 0, 1)) * (kickAt < 0.28 ? 1 : 0) : 0;
  const kickLeft = Math.floor((tt - 2) / 1.9) % 2 === 0;
  const pad = (ph: number): number => Math.sin(TAU * 2.9 * tt + ph);
  const arms: Arms = {
    left: addArm(DANGLE.left, {
      swing: -ap - clamp(0.12 * vz, -0.5, 0.5) + 0.75 * panic * pad(0) + (kickLeft ? 0.6 * kick : 0),
      abduct: -as + clamp(-0.16 * vx, -0.5, 0.5) + bob + 0.3 * panic * pad(1.2),
      elbow: 0.4 * panic * pad(2.1),
      grip: 0.1 * Math.sin(TAU * 1.1 * tt) + 0.45 * panic * Math.max(0, pad(0.5)),
    }),
    right: addArm(DANGLE.right, {
      swing: -ap * 0.85 - clamp(0.12 * vz, -0.5, 0.5) + 0.75 * panic * pad(Math.PI) + (!kickLeft ? 0.6 * kick : 0),
      abduct: as + clamp(0.16 * vx, -0.5, 0.5) + bob + 0.3 * panic * pad(Math.PI + 1.2),
      elbow: 0.4 * panic * pad(Math.PI + 2.1),
      grip: 0.1 * Math.sin(TAU * 1.1 * tt + 1.3) + 0.45 * panic * Math.max(0, pad(Math.PI + 0.5)),
    }),
  };
  // the wheel kicks on its fork too while it panics
  hang[0] += 0.12 * panic * Math.sin(TAU * 2.2 * tt + 0.7);
  hang[1] += 0.1 * panic * Math.sin(TAU * 1.7 * tt);
  const lean: [number, number] = [0, 0];
  const aerial: [number, number] = [clamp(-0.18 * vz - 0.9 * ring(tt, 2.6, 0.12), -1.4, 1.4), clamp(-0.18 * vx, -1.2, 1.2)];
  const flag = 1.5 * tt + 0.4 * Math.hypot(vx, vy, vz) * tt;

  // the eye: down at the bench for 1.3 s, a blink, up at the visitor for 1.2 s, a blink, down again ...
  const first = 1.3, up = 1.2, down = 1.6;
  let lookUp: number;
  let bl: number;
  if (tt < first) {
    lookUp = 0;
    bl = 0;
  } else {
    const u = (tt - first) % (up + down);
    lookUp = window4(u, 0.04, 0.16, up, up + 0.14);
    bl = blink(u, -0.04) + blink(u, up - 0.05);
  }
  const headPitch = lerp(-0.45, 0.42, lookUp);
  const gaze: [number, number] = [lerp(0.1 * Math.sin(TAU * 0.9 * tt), 0, lookUp), lerp(-0.85, 0.5, lookUp)];
  const lids: [number, number] = [Math.max(lerp(0, 0.06, lookUp), bl), Math.max(lerp(0, 0.32, lookUp), bl * 0.85)];
  const brow = lerp(-0.85, -0.35, lookUp);
  const pupilSize = lerp(0.68, 1.22, lookUp);
  // a worried little roll of the head while it looks down, a cock of it at the visitor
  const headRoll = lerp(0.08 * Math.sin(TAU * 0.45 * tt), 0.2, lookUp);
  return { lean, wheel, squash: clamp(squash, -0.6, 1), headYaw: 0, headPitch, headRoll, brow, pupilSize, gaze, lids, arms, aerial, flag, spin: 0, slide: [0, 0], lift: 0, hang };
}

export interface SetDownOptions {
  /** Wheel spin at the moment it touches (rad/s): it brakes on the bench. Default 6. */
  spin?: number;
  /** The pose it had in the hand (default `held(1.3)`): the landing starts from it. */
  from?: FetchPose;
}

/**
 * Put down. t = 0 is the moment the tyre touches. The spring takes the
 * weight and rebounds, the wheel brakes with a squeak of a skid, the arms
 * drop and bounce, the eye squeezes on the bump and opens, a blink, and it
 * is standing at `REST` by 0.8 s.
 */
export function setDown(t: number, o: SetDownOptions = {}): FetchPose {
  const L = LENGTHS.setDown;
  const tt = clamp(t, 0, L);
  const from = o.from ?? held(1.3);
  const spin0 = o.spin ?? 6;
  // the body: from the hand's pose to rest in the first beat
  const k = smoothstep(0, 0.12, tt);
  const base = blendPose(from, REST, k);
  const squash = clamp(lerp(base.squash ?? 0, 0, k) + 0.85 * ring(tt - 0.005, 3.6, 0.3), -0.6, 1);
  const wob = ring(tt - 0.05, 2.6, 0.3);
  const lean: [number, number] = [0.02 + 0.07 * wob, -0.05 * ring(tt - 0.12, 2.2, 0.35)];
  const wheel = spin0 * 0.08 * (1 - Math.exp(-tt / 0.08));
  // arms: dropped by the bump, bounce up once
  const armK = clamp01(smoothstep(0, 0.2, tt) + 0.25 * ring(tt - 0.2, 2.4, 0.4));
  const arms = mixArms(base.arms as Arms, PRESETS.rest, armK);
  const bump = ring(tt - 0.01, 3.6, 0.3);
  const arms2: Arms = { left: addArm(arms.left, { swing: -0.25 * Math.max(0, bump) }), right: addArm(arms.right, { swing: -0.22 * Math.max(0, bump) }) };
  const aerial: [number, number] = [0.9 * ring(tt - 0.01, 3.2, 0.13) * (1 - smoothstep(0.6, L, tt)), 0];
  // the eye
  const squeeze = window4(tt, 0.01, 0.05, 0.12, 0.22);
  const bl = blink(tt, 0.5);
  const lids: [number, number] = [Math.max(lerp(lerp(0, 0.12, smoothstep(0.2, 0.6, tt)), 0.85, squeeze), bl), Math.max(lerp(lerp(0.2, 0.1, smoothstep(0.2, 0.6, tt)), 0.7, squeeze), bl * 0.85)];
  const brow = lerp(lerp(-0.6, 0, smoothstep(0.2, 0.7, tt)), 0.7, squeeze);
  const headPitch = lerp(base.headPitch ?? 0, 0, smoothstep(0.1, 0.45, tt)) - 0.15 * Math.max(0, bump);
  const gaze: [number, number] = [0, lerp((base.gaze ?? [0, 0])[1], 0, smoothstep(0.15, 0.5, tt))];
  const fin = smoothstep(0.6, L, tt);
  return {
    ...base,
    lean: [lerp(lean[0], 0.02, fin), lerp(lean[1], 0, fin)],
    wheel,
    squash: lerp(squash, 0, fin),
    headPitch,
    headRoll: lerp(base.headRoll ?? 0, 0, smoothstep(0.1, 0.5, tt)),
    headYaw: 0,
    brow,
    pupilSize: lerp(base.pupilSize ?? 1, 1, smoothstep(0.15, 0.5, tt)),
    gaze,
    lids,
    arms: arms2,
    aerial,
    flag: (base.flag ?? 0) + 3 * tt,
    spin: 0,
    slide: [0, 0],
    lift: 0,
    hang: base.hang ?? [0, 0],
  };
}

// ───────────────────────── dizzy ─────────────────────────

/**
 * The world going round. The turret wheels in a slow circle on its yoke
 * while the pupil circles the other way, lids half down; the body sways
 * round on its wheel, arms loose, aerial drooping. At 0.95 s a sharp shake
 * of the head, a blink, a bounce up on the spring, and it is itself at 1.5 s.
 */
export function dizzy(t: number): FetchPose {
  const L = LENGTHS.dizzy;
  const tt = clamp(t, 0, L);
  const on = smoothstep(0, 0.15, tt) * (1 - smoothstep(0.9, 1.0, tt));
  const ph = TAU * 1.6 * tt;
  // body: a slow circle, out of step with the head
  const lean: [number, number] = [0.02 + 0.12 * on * Math.sin(ph * 0.75), 0.13 * on * Math.cos(ph * 0.75)];
  const headRoll = 0.3 * on * Math.cos(ph);
  const headPitchC = 0.22 * on * Math.sin(ph) - 0.05 * on;
  // the shake: fast, three swings, damped
  const sh = window4(tt, 0.95, 1.0, 1.18, 1.26) * Math.sin(TAU * 7 * (tt - 0.95));
  const perk = ring(tt - 1.2, 2.4, 0.4); // up on its spring, ready again
  const squash = 0.18 * on - 0.35 * perk;
  const gaze: [number, number] = [0.6 * on * Math.cos(-ph * 1.3), 0.6 * on * Math.sin(-ph * 1.3)];
  const lids: [number, number] = [Math.max(lerp(0.12, 0.45, on), blink(tt, 1.22)), Math.max(lerp(0.1, 0.3, on), blink(tt, 1.22) * 0.85)];
  const brow = 0.35 * on - 0.6 * Math.max(0, perk);
  const loose: Arms = { left: J(0.15, 0.4, -0.3, 0.35, -0.2, 0.1), right: J(0.1, 0.45, -0.3, 0.3, -0.2, 0.1) };
  let arms = mixArms(PRESETS.rest, loose, on);
  arms = { left: addArm(arms.left, { swing: 0.25 * on * Math.sin(ph * 0.75 + 1) }), right: addArm(arms.right, { swing: 0.25 * on * Math.sin(ph * 0.75 + 2.2) }) };
  const aerial: [number, number] = [0.7 * on * Math.sin(ph * 0.75 - 0.6) + 0.5 * on, 0.7 * on * Math.cos(ph * 0.75 - 0.6) - 0.4 * sh];
  // the perk's bounce is let go into rest over the last fifth of a second
  const pose: FetchPose = {
    lean,
    wheel: 0.6 * on * Math.sin(ph * 0.75 - 0.4),
    squash,
    headYaw: 0.4 * sh,
    headPitch: headPitchC + 0.1 * Math.max(0, perk),
    headRoll: clamp(headRoll + 0.1 * sh, -0.42, 0.42),
    brow: clamp(brow, -1, 1),
    pupilSize: lerp(1, 0.8, on) + 0.2 * Math.max(0, perk),
    gaze,
    lids,
    arms,
    aerial,
    flag: 3 * tt,
    spin: 0,
    slide: [0, 0],
    lift: 0,
  };
  return blendPose(pose, { ...REST, wheel: pose.wheel ?? 0, flag: pose.flag ?? 0 }, smoothstep(L - 0.22, L, tt));
}

// ───────────────────────── salute ─────────────────────────

const SALUTE_T = {
  // look down at the claws (0 .. 0.3), dip (0.3 .. 0.4), snap up (0.4 .. 0.52), hold, drop (0.85 .. 1.1)
  arm: track([0, 0], [0.4, 0], [0.52, 1, outBack(2.2)], [0.85, 1], [1.1, 0]),
  look: track([0, 0], [0.34, 0], [0.46, 1], [1.1, 1]),
  tall: track([0, 0], [0.3, 0], [0.4, -0.7], [0.52, 1, outBack(1.8)], [0.86, 1], [1.1, 0]),
  hands: track([0, 1], [0.32, 1], [0.42, 0]),
};

/**
 * Its job done for it (§ B5): it looks down at its empty claws, opening and
 * closing them once (where did it go?), dips on its spring, then snaps up
 * tall into a salute with the right claw at the cap's peak and its eye on
 * the visitor, holds, and drops back to rest at 1.1 s. Turning to face the
 * visitor is the caller's (the station turns the body).
 */
export function salute(t: number): FetchPose {
  const L = LENGTHS.salute;
  const tt = clamp(t, 0, L);
  const s = SALUTE_T.arm.sample(tt), lk = SALUTE_T.look.sample(tt), tall = SALUTE_T.tall.sample(tt), hk = SALUTE_T.hands.sample(tt);
  // the empty claws held out where the crate was, opening and closing: "?"
  // both claws brought up in front of the eye, turned up like palms, opening and shutting on nothing
  const empty: Arms = { left: J(1.25, 0.32, -0.9, 1.25, -1.2, 0.5 + 0.5 * Math.cos(TAU * 3.2 * tt)), right: J(1.2, 0.36, -0.9, 1.3, -1.2, 0.5 + 0.5 * Math.cos(TAU * 3.2 * tt + 0.5)) };
  const start = mixArms(PRESETS.rest, empty, hk);
  let arms = mixArms(start, PRESETS.salute, s);
  if (tt > 0.85) arms = mixArms(PRESETS.rest, PRESETS.salute, s);
  const bl = blink(tt, 0.36);
  const pose: FetchPose = {
    lean: [lerp(0.12, -0.05, lk) + 0.04 * Math.max(0, -tall), 0],
    wheel: 0,
    squash: clamp(-0.4 * tall, -0.6, 1),
    headYaw: 0,
    headPitch: lerp(-0.4, 0.38, lk) * (tt > 0.86 ? 1 - smoothstep(0.86, 1.1, tt) : 1),
    headRoll: -0.14 * Math.max(0, tall),
    brow: lerp(-0.45, 0.35, lk) * (1 - smoothstep(0.9, 1.1, tt)),
    pupilSize: lerp(1.25, 1.05, lk),
    gaze: [lerp(0.08 * Math.sin(TAU * 1.6 * tt), 0, lk), lerp(-0.6, 0.35, lk) * (1 - smoothstep(0.9, 1.1, tt))],
    lids: [Math.max(lerp(0, 0.16, lk) * (1 - smoothstep(0.95, 1.1, tt)) + 0.12 * smoothstep(0.95, 1.1, tt), bl), Math.max(lerp(0.05, 0.42, lk) * (1 - smoothstep(0.95, 1.1, tt)) + 0.1 * smoothstep(0.95, 1.1, tt), bl * 0.85)],
    arms,
    aerial: [-0.5 * Math.max(0, tall) * Math.exp(-Math.max(0, tt - 0.45) * 2) + 0.5 * ring(tt - 0.45, 3, 0.15) * (1 - smoothstep(0.8, 1.1, tt)), 0],
    flag: 2 * tt,
    spin: 0,
    slide: [0, 0],
    lift: 0,
  };
  return blendPose(pose, { ...REST, flag: pose.flag ?? 0 }, smoothstep(L - 0.16, L, tt));
}

// ───────────────────────── hands up ─────────────────────────

/** Both claws up beside the turret, out wide, jaws open: "here, here!" (upper arms out, forearms turned up). */
export const HANDS_UP: Arms = { left: J(0.45, 1.35, 1.5, 1.75, 0, 1), right: J(0.4, 1.4, 1.5, 1.8, 0, 1) };

/**
 * Something carried near it: up on its spring with both claws high,
 * snapping open and shut out of step ("here! here!"), a little bounce on the
 * wheel, pupil big, peak up. The claws go up with a bounce in the first
 * 0.25 s, then it loops. The caller aims the head and gaze at the thing.
 */
export function handsUp(t: number): FetchPose {
  const tt = Math.max(0, t);
  const up = outBack(1.8)(clamp01(tt / 0.25));
  const loop = smoothstep(0.2, 0.4, tt);
  const g = (ph: number): number => 0.55 + 0.45 * Math.cos(TAU * 2.6 * tt + ph);
  const reach = 0.12 * Math.sin(TAU * 1.3 * tt);
  const target: Arms = {
    left: addArm(HANDS_UP.left, { abduct: reach * loop, elbow: 0.5 * reach * loop, grip: (g(0) - 1) * loop }),
    right: addArm(HANDS_UP.right, { abduct: -reach * loop, elbow: -0.5 * reach * loop, grip: (g(Math.PI) - 1) * loop }),
  };
  const arms = mixArms(PRESETS.rest, target, up);
  const bounce = 0.12 * loop * Math.abs(Math.sin(TAU * 1.3 * tt));
  return {
    lean: [0.06 * up + 0.03 * loop * Math.sin(TAU * 1.3 * tt), 0],
    wheel: 0.15 * loop * Math.sin(TAU * 1.3 * tt),
    squash: -0.35 * up - bounce + 0.25 * ring(tt, 3, 0.4) * (1 - up),
    headYaw: 0,
    headPitch: 0.3 * up,
    headRoll: 0.08 * loop * Math.sin(TAU * 0.65 * tt),
    brow: -0.55 * up,
    pupilSize: lerp(1, 1.28, up),
    gaze: [0, 0.4 * up],
    lids: [0, lerp(0.1, 0.22, up)],
    arms,
    aerial: [-0.5 * up + 0.15 * loop * Math.sin(TAU * 1.3 * tt - 0.8), 0],
    flag: 4 * tt,
    spin: 0,
    slide: [0, 0],
    lift: 0,
  };
}

// ───────────────────────── out of its lane ─────────────────────────

export interface OutOfLaneOptions {
  /** Where the thing it wants is, past the tape, in its own frame [x, z]. Default straight ahead. */
  toward?: readonly [number, number];
}

/**
 * Something it wants is past the tape. It sees it (the eye first), rolls up
 * to the line and is stopped dead by it, stretches: up on its spring, over
 * on its wheel, the near claw reaching and snapping, trembling at the full
 * stretch; then gives up: sinks, arms drop, the peak comes down over a
 * flat, put-out eye, a sigh of the head, and back to rest at 1.4 s.
 */
export function outOfLane(t: number, o: OutOfLaneOptions = {}): FetchPose {
  const L = LENGTHS.outOfLane;
  const tt = clamp(t, 0, L);
  const tw = o.toward ?? [0, 1];
  const tl = Math.hypot(tw[0], tw[1]) || 1;
  const d: [number, number] = [tw[0] / tl, tw[1] / tl];
  const yaw = Math.atan2(d[0], d[1]);
  // which arm reaches: the one on that side (left = +X); straight ahead, the right
  const leftReach = d[0] > 0.2;
  const see = smoothstep(0, 0.12, tt);
  const stretch = smoothstep(0.15, 0.42, tt) * (1 - smoothstep(0.86, 1.04, tt));
  const strain = window4(tt, 0.5, 0.6, 0.82, 0.9);
  const giveUp = window4(tt, 0.86, 1.0, 1.2, L);
  const tremble = strain * Math.sin(TAU * 13 * tt) * 0.5 + strain * Math.sin(TAU * 7.3 * tt) * 0.5;
  // the bump: rolls a hair over toward the line and is stopped by it
  const bonk = 0.035 * window4(tt, 0.1, 0.2, 0.22, 0.32);
  const slide: [number, number] = [d[0] * bonk, d[1] * bonk];
  const wheel = (bonk / 0.155) * Math.cos(yaw);
  // lean over toward it (in its own frame: no spin here)
  const lean = leanToward(d, 0.3 * stretch + 0.015 * tremble);
  lean[0] += 0.02 - 0.08 * giveUp;
  // the reaching arm: forward and up, elbow straight, claw snapping; the other arm out for balance
  // up and out toward it (forward reaches are foreshortened to the camera: it lifts the arm high and wide)
  const reach = J(lerp(1.5, 0.45, Math.abs(d[0])), lerp(0.5, 1.45, Math.abs(d[0])), 0, 0.1, 0, 0.5 + 0.5 * Math.sin(TAU * 3.5 * tt));
  const balance = J(0.25, 0.35, -0.35, 0.7, -0.3, 0.4);
  const droop = J(0.0, 0.08, 0, 0.12, 0, 0.05);
  const stretched: Arms = leftReach ? { left: reach, right: balance } : { left: balance, right: reach };
  let arms = mixArms(PRESETS.rest, stretched, stretch);
  arms = mixArms(arms, { left: droop, right: droop }, giveUp);
  arms = { left: addArm(arms.left, { swing: 0.06 * tremble }), right: addArm(arms.right, { swing: -0.06 * tremble }) };
  // the turret turns to it as far as it will go
  const headYaw = clamp(yaw, -0.85, 0.85) * (see * (1 - giveUp * 0.6)) * (1 - smoothstep(1.2, L, tt));
  const sigh = window4(tt, 1.0, 1.12, 1.22, L);
  const pupilSize = lerp(1, 1.3, see) * (1 - giveUp) + 0.9 * giveUp;
  const pose: FetchPose = {
    lean: [clamp(lean[0], -0.45, 0.45), clamp(lean[1], -0.35, 0.35)],
    wheel,
    squash: -0.6 * stretch + 0.35 * giveUp - 0.04 * tremble,
    headYaw,
    headPitch: -0.15 * see * (1 - giveUp) - 0.32 * sigh,
    headRoll: 0.05 * tremble - 0.15 * giveUp * Math.sign(d[0] || 1),
    brow: lerp(lerp(0, -0.7, see), 0.85, giveUp) * (1 - smoothstep(1.25, L, tt)),
    pupilSize,
    gaze: [lerp(0, clamp((yaw - headYaw) / 0.5, -1, 1), see) * (1 - giveUp), lerp(0, -0.35, see) * (1 - giveUp) - 0.2 * sigh],
    lids: [lerp(lerp(0.12, 0, see), 0.62, giveUp) + 0.12 * smoothstep(1.2, L, tt) * (1 - giveUp), lerp(0.1, 0.45, giveUp) + 0.1 * smoothstep(1.2, L, tt) * (1 - giveUp)],
    arms,
    aerial: [0.3 * stretch * d[1] + 0.9 * giveUp + 0.06 * tremble, 0.3 * stretch * d[0]],
    flag: 2 * tt,
    spin: 0,
    slide,
    lift: 0,
  };
  return blendPose(pose, { ...REST, wheel: pose.wheel ?? 0, flag: pose.flag ?? 0 }, smoothstep(L - 0.16, L, tt));
}

// the reach (telescoping forearms) lives in reach.ts
export * from './reach.ts';
