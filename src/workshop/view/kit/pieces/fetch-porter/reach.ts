/**
 * Fetch's reach with its telescoping forearms (a porter: its arms run out on bright inner tubes to set a
 * crate down at a distance and run back in).
 *
 *  - `reachPose(target, { half | null })`: pure. Poses the whole body to put the grip at a point in its own
 *    space: it turns to face it, opens shoulders and elbows, leans from the wheel and rises or sinks on its
 *    spring, and only then runs the tubes out. Two claws hold a thing of `half` size level between them, or
 *    one claw's closed tips touch the point (a tap). Says how far short it fell.
 *  - `NATURAL_REACH`, `GREATEST_REACH`, `reachLimits()`: how far that is, for a test to hold a scene to.
 *  - `ReachMotion`: what a view needs to play a reach from the grip's position alone (a point every frame,
 *    not a script): a draw back before it goes, the body and arms first, the tubes after them, fast, with a
 *    hair of overshoot on their stops and a nod of the head when they hit, and the way back in the other
 *    order, quicker. Reduced motion: no draw back, no overshoot, no nod.
 *
 * Everything here is in Fetch's own space at scale 1 (the piece as built; +X its left, +Z its front, +Y up
 * from the bench under its tyre). A view at another scale divides by it on the way in.
 */
import { Vector3 } from 'three';
import { PRESETS, SHOULDER, TELE, TELE_MAX, TORSO, WHEEL_R, handPoint, teleStages, type ArmJoints, type Arms, type FetchPose } from './rig.ts';
import { Spring, clamp, lerp, smoothstep } from '../../../anim/index.ts';
import { REACH_SEEDS } from './reach-seeds.ts';

/** A point or a size in Fetch's own space (scale 1). */
export type V3 = readonly [number, number, number];

/** Where between a claw's jaws a held thing's side sits (hand space), and where the closed tips are (a tap). */
export const GRIP_POINT: V3 = [0, -0.14, 0];
export const TIP_POINT: V3 = [0, -0.205, 0];
/** How far outside a held thing's side the grip point sits (the jaw's own thickness). */
const JAW = 0.012;

export interface ReachOptions {
  /** Half-size [x, y, z] of what both claws hold between them (Fetch's units), or null: one claw's tips go to the target (a tap). Default null. */
  half?: V3 | null;
  /** The claw that taps (a tap only). Default: the one on the target's side. */
  hand?: 'left' | 'right';
  /** The last solution for a nearby target: the solver starts there (cheaper, and no jumps between answers). */
  from?: ReachSolution | null;
  /**
   * Search hard from several shapes of arm (tens of milliseconds): for a layout test and for baking the seed
   * table. Without it a cold solve starts once, from the baked table's nearest answer (about a millisecond).
   */
  thorough?: boolean;
}

export interface ReachSolution {
  /** The pose's reaching fields: lean, squash, spin and arms (the rest is the caller's). */
  pose: FetchPose;
  /** How far the grip is from the target (units): 0 when it got there. Never clamped in silence. */
  short: number;
  /** How far the telescope runs out (units; both arms alike when two hold a thing). */
  tele: number;
  /** The tapping claw, or null for a two-handed hold. */
  tap: 'left' | 'right' | null;
  /** The solver's unknowns [fore, squash, swing, abduct, elbow, tele], for a warm start. */
  q: number[];
}

/** The unknowns' bounds: lean fore, squash, swing, abduct, elbow, telescope. */
const QLO = [-0.12, -0.6, -0.6, -0.55, 0, 0];
const QHI = [0.28, 0.5, 2.2, 1.6, 2.3, TELE_MAX];
/** Where the solver starts, and what it leans toward among equal answers: carrying. */
const Q0 = [0.03, 0, 0.78, -0.2, 0.85, 0];
/** Shapes of arm a cold solve starts from: carrying; elbows out and bent; arms up and out straight. */
const SEEDS = [Q0, [0.12, 0, 1.3, 0.6, 1.2, 0], [0.24, 0, 2.0, 0.6, 0.2, 0], [0.25, 0.2, 1.0, 0.4, 0.15, 0], [0.26, 0.45, 0.8, 0.2, 0.05, 0]];

function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    const tmp = M[c]!;
    M[c] = M[p]!;
    M[p] = tmp;
    const d = M[c]![c]! || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / d;
      if (f !== 0) for (let k = c; k <= n; k++) M[r]![k] = M[r]![k]! - f * M[c]![k]!;
    }
  }
  return M.map((r, i) => r[n]! / (r[i]! || 1e-12));
}

/** Levenberg–Marquardt over the unknowns `free`, bounded by clamping: six unknowns, a handful of residuals. */
function lm(q: number[], free: readonly number[], res: (q: number[]) => number[], iters: number): number[] {
  let x = q.slice();
  let r = res(x);
  let cost = r.reduce((s, v) => s + v * v, 0);
  let mu = 1e-3;
  const h = 1e-4;
  for (let it = 0; it < iters && cost > 1e-12; it++) {
    const before = cost;
    const Jc: number[][] = [];
    for (const i of free) {
      const xp = x.slice();
      xp[i] = xp[i]! + h;
      const rp = res(xp);
      Jc.push(rp.map((v, k) => (v - r[k]!) / h));
    }
    const n = free.length;
    const A = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => Jc[a]!.reduce((s, v, k) => s + v * Jc[b]![k]!, 0)));
    const g = Jc.map((col) => col.reduce((s, v, k) => s + v * r[k]!, 0));
    let improved = false;
    for (let tries = 0; tries < 6; tries++) {
      const Ad = A.map((row, a) => row.map((v, b) => (a === b ? v * (1 + mu) + mu : v)));
      const dx = solveLinear(Ad, g.map((v) => -v));
      const xn = x.slice();
      free.forEach((i, a) => (xn[i] = clamp(xn[i]! + dx[a]!, QLO[i]!, QHI[i]!)));
      const rn = res(xn);
      const cn = rn.reduce((s, v) => s + v * v, 0);
      if (cn < cost) {
        x = xn;
        r = rn;
        cost = cn;
        mu = Math.max(1e-7, mu * 0.3);
        improved = true;
        break;
      }
      mu *= 8;
    }
    if (!improved || before - cost < 1e-9) break;
  }
  return x;
}

const tmpL = new Vector3();
const tmpR = new Vector3();

/**
 * The baked seed table (reach-seeds.ts, made by `bakeReachSeeds`): a thorough answer for every distance and
 * height on a grid, two-handed and tapping. A cold solve starts from the nearest one.
 */
function tableSeed(d: number, y: number, tap: boolean): number[] | null {
  const g = REACH_SEEDS;
  const rows = tap ? g.tap : g.crate;
  if (!rows.length) return null;
  const i = Math.max(0, Math.min(g.nd - 1, Math.round((d - g.d0) / g.dStep)));
  const j = Math.max(0, Math.min(g.ny - 1, Math.round((y - g.y0) / g.yStep)));
  const k = (i * g.ny + j) * 6;
  return rows.slice(k, k + 6);
}

/** The arms for the unknowns: mirrored for a two-handed hold, or one arm out and the other at rest (a tap). */
function reachArms(q: readonly number[], tap: 'left' | 'right' | null, grip: number): Arms {
  const crate = (): ArmJoints => ({ swing: q[2]!, abduct: q[3]!, twist: -0.25, elbow: q[4]!, wrist: 1.57, grip, tele: q[5]! });
  if (!tap) return { left: crate(), right: crate() };
  const point: ArmJoints = { swing: q[2]!, abduct: q[3]!, twist: 0, elbow: q[4]!, wrist: 0, grip, tele: q[5]! };
  return tap === 'left' ? { left: point, right: PRESETS.rest.right } : { left: PRESETS.rest.left, right: point };
}

/**
 * Pose the whole body to put the grip at `target` (Fetch's own space, scale 1). It turns to face it, then
 * the shoulders and elbows open and it leans from the wheel and rises or sinks on its spring; only when
 * that is not enough do the tubes run out, so a near reach uses no telescope at all. With `half`, both
 * claws hold a thing of that half-size level between them, its centre at the target; without, one claw's
 * closed tips touch the target (a tap). It answers with how far short it fell (`short`).
 */
export function reachPose(target: V3, o: ReachOptions = {}): ReachSolution {
  const half = o.half ?? null;
  const d = Math.hypot(target[0], target[2]);
  const face = Math.atan2(target[0], target[2]);
  const tap: 'left' | 'right' | null = half ? null : (o.hand ?? (target[0] >= 0 ? 'left' : 'right'));
  // a tap turns a little less than square on, so the tapping shoulder faces the target
  const sideOff = tap ? (tap === 'left' ? 1 : -1) * Math.asin(clamp((SHOULDER.x * 0.85) / Math.max(d, 0.4), -0.9, 0.9)) : 0;
  const spin = face - sideOff;
  // the target in the frame it now faces
  const c = Math.cos(spin), s = Math.sin(spin);
  const tx = target[0] * c - target[2] * s, tz = target[0] * s + target[2] * c, ty = target[1];
  const side: 'L' | 'R' = tap === 'right' ? 'R' : 'L';
  const local = tap ? TIP_POINT : GRIP_POINT;
  const grip = half ? 0.5 : 0.08;
  // a held thing never goes into its body: its near face stays in front of the pail (a big crate held close is
  // drawn out to there, and the pull counts in `short`), and the lean may not carry the pail into it
  const nearest = half ? TORSO.d / 2 + 0.03 + half[2] : 0;
  const pushed = half ? Math.max(0, nearest - tz) : 0;
  const want = half ? new Vector3(half[0] + JAW, ty, tz + pushed) : new Vector3(tx, ty, tz);
  const room = half ? tz + pushed - half[2] - 0.012 : Infinity;
  /** How far the leaning pail's front, at the crate's height, comes past the crate's near face (0: clear). */
  const clip = (q: number[]): number => (half ? Math.max(0, TORSO.d / 2 + 0.02 + Math.sin(q[0]!) * Math.max(0, ty - WHEEL_R) - room) : 0);
  const err = (q: number[]): Vector3 => {
    const arms = reachArms(q, tap, grip);
    return handPoint({ lean: [q[0]!, 0], squash: q[1]! }, side, side === 'L' ? arms.left : arms.right, local, tmpL).sub(want);
  };
  // A: no telescope; lean and spring cost a little, the arm's own joints almost nothing (they open first)
  const resA = (q: number[]): number[] => {
    const e = err(q);
    return [e.x, e.y, e.z, 4 * clip(q), 0.03 * (q[0]! - Q0[0]!), 0.016 * q[1]!, 0.004 * (q[2]! - Q0[2]!), 0.004 * (q[3]! - Q0[3]!), 0.004 * (q[4]! - Q0[4]!)];
  };
  // warm, from the last answer; cold, from the baked table's nearest answer for this distance and height (the
  // problem is the same at any bearing: it turns to face the target); thorough, from a few shapes of arm too
  const warm = o.from && o.from.tap === tap ? o.from : null;
  const thorough = o.thorough === true;
  const seed = tableSeed(d, ty, tap !== null);
  const starts = warm ? [warm.q] : thorough ? (seed ? [seed, ...SEEDS] : SEEDS) : [seed ?? Q0];
  const itA = warm ? 4 : thorough ? 30 : 16;
  let q: number[] = [];
  let e = Infinity;
  // warm and already telescoping: the tubes stay in play (phase B alone; its pull on the tubes takes them in
  // again when they are not needed), which halves a frame's work
  const skipA = warm !== null && warm.q[5]! > 1e-3;
  if (skipA) {
    q = warm.q.slice();
    e = err(q).length();
  }
  for (const st of skipA ? [] : starts) {
    const x0 = st.slice();
    x0[5] = 0;
    const x = lm(x0, [0, 1, 2, 3, 4], resA, itA);
    const ex = err(x).length();
    if (ex < e - 1e-5) {
      q = x;
      e = ex;
    }
    if (e < 0.001) break;
  }
  if (e > 0.003) {
    // B: the tubes run out for what is left, the body held as it was at full stretch
    const qa = q.slice();
    const resB = (x: number[]): number[] => {
      const ee = err(x);
      return [ee.x, ee.y, ee.z, 4 * clip(x), 0.05 * (x[0]! - qa[0]!), 0.03 * (x[1]! - qa[1]!), 0.004 * (x[4]! - qa[4]!), (skipA ? 0.012 : 0.004) * x[5]!];
    };
    // from the last answer (warm) or the seed (cold) with its own telescope, else from A's answer
    const from = warm ? warm.q : seed;
    const qb = from && from[5]! > 1e-3 ? from.slice() : q.slice();
    if (qb[5]! < 1e-3) qb[5] = Math.min(TELE_MAX, e * 0.8);
    let best = lm(qb, [0, 1, 2, 3, 4, 5], resB, warm ? 6 : thorough ? 30 : 16);
    let eb = err(best).length();
    // far and low (or wherever the first answer went wrong): from the other shapes too, tubes half out
    if (eb > 0.003 && (thorough || !warm)) {
      // (cold: one more shape only, a millisecond; thorough: all of them)
      for (const st of thorough ? SEEDS : SEEDS.slice(0, 3)) {
        const x = lm([st[0]!, st[1]!, st[2]!, st[3]!, st[4]!, TELE_MAX * 0.5], [0, 1, 2, 3, 4, 5], resB, 30);
        const ex = err(x).length();
        if (ex < eb - 1e-4) {
          best = x;
          eb = ex;
        }
      }
    }
    q = best;
    e = eb;
  }
  return { pose: { lean: [q[0]!, 0], squash: q[1]!, spin, arms: reachArms(q, tap, grip) }, short: e + pushed, tele: q[5]!, tap, q };
}

/** Where the grip is for a pose (root space): the middle of the two claws (two-handed), or a claw's closed tips. */
export function gripOf(pose: FetchPose, tap: 'left' | 'right' | null, out = new Vector3()): Vector3 {
  const arms = pose.arms && typeof pose.arms === 'object' && 'left' in pose.arms ? (pose.arms as Arms) : PRESETS.rest;
  const b = { lean: pose.lean ?? [0, 0], squash: pose.squash ?? 0, spin: pose.spin ?? 0, slide: pose.slide ?? [0, 0], lift: pose.lift ?? 0 };
  if (!tap) {
    handPoint(b, 'L', arms.left, GRIP_POINT, tmpL);
    handPoint(b, 'R', arms.right, GRIP_POINT, tmpR);
    return out.copy(tmpL).add(tmpR).multiplyScalar(0.5);
  }
  return handPoint(b, tap === 'left' ? 'L' : 'R', tap === 'left' ? arms.left : arms.right, TIP_POINT, out);
}

/**
 * How far it reaches, horizontally from its centre to the grip, at a height (Fetch's units): with arms,
 * lean and spring alone (`natural`), and with the telescope all the way out (`greatest`).
 */
export function reachLimits(height: number, half: V3 | null): { natural: number; greatest: number } {
  const far = (useTele: boolean): number => {
    let lo = 0.2, hi = 1.6;
    for (let i = 0; i < 18; i++) {
      const m = (lo + hi) / 2;
      const r = reachPose([0, height, m], { half, thorough: true });
      if (r.short < 0.002 && (useTele || r.tele < 1e-3)) lo = m;
      else hi = m;
    }
    return lo;
  };
  return { natural: far(false), greatest: far(true) };
}

/** The crate-carrying height the simulation uses (sim FETCH_TUNING.handHeight, Fetch's units). */
export const REACH_HEIGHT = 0.62;
/** An S crate (0.45 a side) held at the bench's crew scale of 1.5: its half-size in Fetch's units. */
export const S_CRATE_HALF: V3 = [0.15, 0.1467, 0.15];
// (measured by reachLimits and held to it by a test; constants so that nothing is solved when the module loads)
/** Its reach with arms, lean and spring alone: centre to grip, an S crate at the carrying height (Fetch's units, scale 1). */
export const NATURAL_REACH = 0.529;
/** Its reach with the telescope all the way out, the same way (Fetch's units, scale 1). */
export const GREATEST_REACH = 0.774;

// ───────────────────────── the motion ─────────────────────────

export interface ReachInput {
  /** Where the grip should be (Fetch's own space, scale 1), or null: no reach (the arms go back to the caller's). */
  target: V3 | null;
  /** Half-size of what the claws hold or go for, or null: a tap. */
  half: V3 | null;
  /** Something is in its claws (they close on it); else, reaching, they open. */
  holding: boolean;
  /** The claw that taps (a tap only): the caller picks the one the visitor sees. Default: the one on the target's side. */
  hand?: 'left' | 'right';
  dt: number;
  reducedMotion?: boolean;
  /**
   * Let go at once (knocked, picked up, a fumble: the simulation's hands jump to null): the tubes snap home
   * and the reach lets the arms go in a tenth of a second, both together, instead of in turn. No pop.
   */
  drop?: boolean;
}

export interface ReachOutput {
  /** How much of the pose is the reach's (0 none .. 1 all): blend the caller's pose toward `pose` by it. */
  weight: number;
  /** The reaching fields (lean, squash, spin, arms) plus a nod to add to the head's pitch. */
  pose: FetchPose;
  nod: number;
  /** How far short of the target the solver says it is (units). */
  short: number;
  /** Where the drawn grip is (root space): a held thing drawn here sits in its claws. */
  grip: Vector3;
  /** The telescope's run as drawn (units, total of the three stages). */
  tele: number;
}

/**
 * A reach played from the grip's position alone, frame by frame. Feed it the target (or null) every
 * frame; it keeps the springs. Order going out: a small draw back, the body leans and the arms open, then
 * the tubes run out quickly and overshoot a hair on their stops (a nod when they hit), the claws open.
 * Coming back: claws, tubes in first, quicker, then the arms and the body.
 */
export class ReachMotion {
  private readonly w = new Spring(0, { omega: 11, zeta: 1 });
  private readonly fore = new Spring(0.03, { omega: 8.5, zeta: 0.62 });
  private readonly squash = new Spring(0, { omega: 10, zeta: 0.6 });
  private readonly spin = new Spring(0, { omega: 10, zeta: 0.8 });
  private readonly joints = [new Spring(0.78, { omega: 13, zeta: 0.72 }), new Spring(-0.2, { omega: 13, zeta: 0.72 }), new Spring(0.85, { omega: 13, zeta: 0.72 })];
  private readonly stages = [0, 1, 2].map(() => new Spring(0, { omega: 30, zeta: 0.42 }));
  private readonly nodS = new Spring(0, { omega: 18, zeta: 0.35 });
  private readonly gripS = new Spring(0.5, { omega: 22, zeta: 0.8 });
  private last: ReachSolution | null = null;
  private lastTarget: V3 | null = null;
  private startAt = -1;
  private time = 0;
  private hit = [false, false, false];
  private tap: 'left' | 'right' | null = null;
  private latch = 0;

  private solvedFor: V3 | null = null;
  private readonly warm: Array<{ target: V3; tap: boolean; sol: ReachSolution }> = [];

  /**
   * Solve the places it will reach for in advance (when the view is built, during the loading picture), so a
   * reach to one of them starts warm. Fetch's own space, scale 1. Returns the milliseconds it took.
   */
  warmUp(places: ReadonlyArray<{ target: V3; half: V3 | null }>): number {
    const t0 = performance.now();
    for (const p of places) this.warm.push({ target: p.target, tap: p.half === null, sol: reachPose(p.target, { half: p.half }) });
    return performance.now() - t0;
  }

  /** The solved pose for a place near `t` (0.12 at most, the same kind of reach), if any. */
  private nearestWarm(t: V3, half: V3 | null): ReachSolution | null {
    let best: ReachSolution | null = null;
    let bd = 0.12;
    for (const w of this.warm) {
      if (w.tap !== (half === null)) continue;
      // the reach is the same at any bearing: compare distance and height only
      const d = Math.hypot(Math.hypot(t[0], t[2]) - Math.hypot(w.target[0], w.target[2]), t[1] - w.target[1]);
      if (d < bd) {
        bd = d;
        best = w.sol;
      }
    }
    return best;
  }

  /** Its state as it was at rest (call when the robot is reset). */
  reset(): void {
    this.w.set(0);
    this.last = null;
    this.lastTarget = null;
    for (const s of this.stages) s.set(0);
  }

  update(i: ReachInput): ReachOutput {
    const dt = Math.min(Math.max(i.dt, 0), 0.1);
    const rm = i.reducedMotion === true;
    this.time += dt;
    const params = (sp: Spring, omega: number, zeta: number): void => {
      sp.omega = omega;
      sp.zeta = rm ? Math.max(1, zeta) : zeta;
    };
    let sol: ReachSolution | null = null;
    if (i.target) {
      // a new reach (or a jump to somewhere else): start the clock for the draw back
      const jump = !this.lastTarget || Math.hypot(i.target[0] - this.lastTarget[0], i.target[1] - this.lastTarget[1], i.target[2] - this.lastTarget[2]) > 0.35;
      if (jump) {
        this.startAt = this.time;
        this.latch = 0;
        // from nothing: the arms start where the caller's are (about at rest), so they visibly open first
        if (this.w.x < 0.05) {
          const r = PRESETS.rest.left;
          this.joints[0]!.set(r.swing);
          this.joints[1]!.set(r.abduct);
          this.joints[2]!.set(r.elbow);
          this.fore.set(0.03);
          this.squash.set(0);
          this.spin.set(0);
        }
      }
      const t = i.target;
      const still = this.last && this.solvedFor && !jump && Math.hypot(t[0] - this.solvedFor[0], t[1] - this.solvedFor[1], t[2] - this.solvedFor[2]) < 2e-4;
      if (still) sol = this.last!;
      else {
        // warm from the last answer while the grip moves on; a jump starts from a pose solved in advance for a
        // place near there (`warmUp`), else from the baked table: never a search during play
        const from = jump ? this.nearestWarm(t, i.half) : this.last;
        sol = reachPose(t, { half: i.half, from, ...(i.hand ? { hand: i.hand } : {}) });
        this.solvedFor = [t[0], t[1], t[2]];
      }
      this.last = sol;
      this.tap = sol.tap;
    }
    this.lastTarget = i.target;
    const going = sol !== null;
    // the claws first in, the tubes next: the arms and the body leave last
    const teleNow = this.stages.reduce((s, x) => s + Math.max(0, x.x), 0);
    const drop = !going && i.drop === true;
    params(this.w, going ? 11 : drop ? 34 : 13, 1);
    this.w.step(going ? 1 : drop || teleNow <= 0.012 ? 0 : this.w.x, dt);
    const since = this.time - this.startAt;
    // the draw back: a hair back and down before it goes (not in reduced motion)
    const draw = going && !rm ? smoothstep(0, 0.06, since) * (1 - smoothstep(0.1, 0.2, since)) : 0;
    const q = sol?.q ?? this.last?.q ?? [0.03, 0, 0.78, -0.2, 0.85, 0];
    params(this.fore, 8.5, 0.62);
    params(this.squash, 10, 0.6);
    const fore = this.fore.step((going ? q[0]! : 0.03) - 0.07 * draw, dt);
    const squash = this.squash.step((going ? q[1]! : 0) + 0.25 * draw, dt);
    const spin = this.spin.step(going ? (sol!.pose.spin ?? 0) : this.spin.x, dt);
    const jt = [q[2]! - 0.3 * draw, q[3]!, q[4]! + 0.2 * draw];
    for (let k = 0; k < 3; k++) {
      params(this.joints[k]!, going ? 13 : 16, 0.72);
      this.joints[k]!.step(going ? jt[k]! : this.joints[k]!.x, dt);
    }
    // the tubes: out only once the arms are nearly there (they open first), fast; back in first, faster
    const armErr = going ? Math.max(...jt.map((v, k) => Math.abs(v - this.joints[k]!.x))) : 0;
    // (latched: once the arms are there the tubes stay out, whatever the arm springs do after)
    this.latch = going ? Math.max(this.latch, (1 - smoothstep(0.08, 0.3, armErr)) * smoothstep(0.6, 0.95, this.w.x)) : 0;
    const gate = this.latch;
    const total = going ? q[5]! * gate : 0;
    const want = teleStages(total);
    let nodKick = 0;
    for (let k = 0; k < 3; k++) {
      const sp = this.stages[k]!;
      params(sp, going ? 30 : drop ? 60 : 38, going ? 0.42 : 0.8);
      sp.step(want[k]!, dt);
      // the stop: a hair past it (the brass ring takes the blow), then back; the first touch nods the head
      const max = TELE.out[k]!;
      const give = rm ? 0 : 0.005;
      if (sp.x > max + give) {
        if (!this.hit[k] && sp.v > 0.25) nodKick = Math.max(nodKick, Math.min(1, sp.v / 1.2));
        sp.x = max + give;
        sp.v = rm ? 0 : -0.35 * sp.v;
        this.hit[k] = true;
      } else if (sp.x < max - 0.01) this.hit[k] = false;
      if (sp.x < 0) {
        sp.x = 0;
        sp.v = 0;
      }
    }
    if (!rm && nodKick > 0) this.nodS.kick(-2.6 * nodKick);
    params(this.nodS, 18, 0.35);
    const nod = rm ? 0 : this.nodS.step(0, dt);
    // the claws: open as it goes for something, closed on what it holds (and on nothing, for a tap)
    params(this.gripS, 22, 0.8);
    const g = this.gripS.step(!going ? 0.5 : i.holding ? 0.5 : this.tap ? 0.08 : lerp(0.5, 1, gate), dt);
    const stagesNow: [number, number, number] = [this.stages[0]!.x, this.stages[1]!.x, this.stages[2]!.x];
    const tap = this.tap;
    const arm = (wrist: number, twist: number): ArmJoints => ({ swing: this.joints[0]!.x, abduct: this.joints[1]!.x, twist, elbow: this.joints[2]!.x, wrist, grip: g, tele: stagesNow });
    const arms: Arms = !tap
      ? { left: arm(1.57, -0.25), right: arm(1.57, -0.25) }
      : tap === 'left' ? { left: arm(0, 0), right: PRESETS.rest.right } : { left: PRESETS.rest.left, right: arm(0, 0) };
    const pose: FetchPose = { lean: [fore, 0], squash, spin, arms };
    const grip = gripOf(pose, tap, new Vector3());
    return { weight: clamp(this.w.x, 0, 1), pose, nod, short: sol?.short ?? 0, grip, tele: stagesNow[0] + stagesNow[1] + stagesNow[2] };
  }
}

// ───────────────────────── for a layout test ─────────────────────────

export interface ReachFromOptions {
  /** The crew's drawing scale on the bench (Fetch's units × scale = world units). Default 1.5 (view/bench CREW_SCALE). */
  scale?: number;
  /** Half-size (world units) of what both claws hold there, or null for a tap with one claw. Default: an S crate. */
  half?: V3 | null;
}

/**
 * Can the grip get to `point` (world) with Fetch standing at `stand` (world, its root: on the bench under its
 * tyre; it turns to face the point, so its heading does not matter)? The solver's answer in world units: how
 * far short it falls (0: it gets there), how far its tubes run out, and whether it needed them at all. For a
 * layout test of the stack's top, the belt's drop and the tray's seat at their real heights (the reach is
 * longest at the carrying height and shorter above and below it).
 */
export function reachFrom(stand: V3, point: V3, o: ReachFromOptions = {}): { short: number; tele: number; telescoped: boolean } {
  const k = o.scale ?? 1.5;
  const half = o.half === undefined ? [0.225, 0.22, 0.225] as V3 : o.half;
  const target: V3 = [(point[0] - stand[0]) / k, (point[1] - stand[1]) / k, (point[2] - stand[2]) / k];
  const r = reachPose(target, { half: half ? [half[0] / k, half[1] / k, half[2] / k] : null, thorough: true });
  return { short: r.short * k, tele: r.tele * k, telescoped: r.tele > 1e-3 };
}

/**
 * Bake the seed table: a thorough solve at every grid point (distance × height), two-handed (an S crate at the
 * bench's scale) and tapping. Seconds of work: run it offline when the rig or the solver changes and write the
 * result into reach-seeds.ts (shots/V/gen-seeds.test.ts does both).
 */
export function bakeReachSeeds(grid = { d0: 0.2, dStep: 0.05, nd: 17, y0: 0, yStep: 0.0625, ny: 17 }): typeof REACH_SEEDS {
  const crate: number[] = [];
  const tap: number[] = [];
  const r3 = (v: number): number => Math.round(v * 1000) / 1000;
  for (let i = 0; i < grid.nd; i++) {
    for (let j = 0; j < grid.ny; j++) {
      const d = grid.d0 + i * grid.dStep, y = grid.y0 + j * grid.yStep;
      crate.push(...reachPose([0, y, d], { half: S_CRATE_HALF, thorough: true }).q.map(r3));
      tap.push(...reachPose([0, y, d], { half: null, hand: 'left', thorough: true }).q.map(r3));
    }
  }
  return { ...grid, crate, tap };
}
