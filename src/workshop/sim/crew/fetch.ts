/**
 * Fetch, the runner (REWRITE.md § B5, § B3, § G "P1", "P2"). A state machine
 * on the fixed step. Eager and too fast: it overshoots every stop and skids
 * back. It cannot leave its lane of tape (except to hurry back to it after
 * being put down elsewhere, or after being knocked off it).
 *
 * Attract mode (the vignette's Fetch, unchanged): rolls up and down its lane
 * carrying a crate; after ~4 s with no visitor input it fumbles the crate so
 * it tumbles to a stop beside the Button, looks at it, then out at the
 * visitor, hands out; if ignored for 12 s it fetches it back, shrugs and
 * carries on. The fumble repeats at most every 40 s and never after the
 * visitor's first action (§ B3 "Never nag"). It freezes while a Button rung
 * plays.
 *
 * Play mode, its rounds (S5; `FetchSpec.rounds`; § B3 "Fetch goes on carrying
 * fresh crates down the belt"): it takes the top fresh crate off the stack
 * (`pickup`: reach, then the crate comes into its hands) and sets it on the
 * belt's motor end (`place`: turn, reach out, lower, let go), at most one
 * every `rounds.every` seconds, never with more than `rounds.cap` crates in
 * play, and only while the belt runs forward; the dock restocks the stack as
 * crates ship, so the loop never runs dry. What it cannot reach from its
 * tape it stretches for (`reach`), gives up on, and prints OUT OF MY LANE
 * (then not again for `giveUpFor` seconds). When the visitor does its job
 * for it (puts a crate on the belt while it is empty-handed, or takes the
 * crate out of its hands) it looks at its empty hands and salutes.
 *
 * Knocked (S5; `fetch-knock.ts`): a free part that hits it (or the crate in
 * its hands) with speed shoves it along the part's line and spins it, by
 * one of three strengths from the part's momentum; the slide is cut short
 * of the bench edge and of every machine. It drops what it carried, charged
 * to the throw (§ E5 rule 4). It wobbles back to balance and returns to its
 * lane; it cannot be knocked again until the wobble is over. A slow part is
 * only a look (`crew.nudged`). Held, riding a machine, or frozen, it is not
 * knocked at all. The part that hit it keeps the momentum a toy would have
 * let it keep (Fetch is driven, so to the engine it is a wall).
 *
 * Its position and intentions are transient (§ E5): nothing here commits,
 * except where a part it lets go of comes to rest (charged to `crew`, or to
 * the throw that knocked it). It never touches a part the visitor has
 * touched (§ E5 rule 5: `attach` refuses it, and it checks before it reaches).
 *
 * `carry` in the brief is not a separate state: `carrying` is set while it
 * rolls, idles or skids with a crate in its hands.
 */
import type { Cause, CrewMember, FetchKnock, FetchState, Gaze, Id, Pose, Quat, SimEvent, Vec3 } from '../types.ts';
import type { SimContext, Unit } from '../context.ts';
import { HZ, steps } from '../clock.ts';
import { qnormalize, qyaw, yawOf } from '../math.ts';
import { MATERIAL, massOf } from '../parts.ts';
import { KNOCK_TUNING, classify, clearRun, obstacles, toyBounce } from './fetch-knock.ts';
import type { Strength } from './fetch-knock.ts';

/** Timings (seconds), speeds (units/s) and distances (units), at P1 size. Tune here. */
export const FETCH_TUNING = {
  accel: 7.5,
  maxSpeed: 2.6,
  brake: 8,
  /** How far past a stop it runs before skidding back. */
  overshoot: 0.3,
  skidBack: 0.8,
  /** Pause at each end of the lane: [min, max]. */
  idle: [0.8, 2.0] as readonly [number, number],
  /** The lane's stops are this far inside its ends. */
  inset: 0.3,
  bodyHalfHeight: 0.5,
  /** Hands reach this far beyond the front of its body (half depth `bodyHalfDepth`), plus the carried part's own half depth. */
  handGap: 0.03,
  bodyHalfDepth: 0.26,
  /** Nominal reach of the hands from its centre, for an S crate (used for the pickup distance). */
  handForward: 0.515,
  handHeight: 0.62,
  /** Visitor inactivity before the fumble (§ B3: about 4 s). */
  fumbleAfter: 4,
  /** At most one fumble per this many seconds (§ B3). */
  fumbleEvery: 40,
  /** From the start of the fumble to letting go. */
  fumbleWindup: 0.35,
  /** From letting go to offering. */
  fumbleRecover: 0.7,
  /** In the offer: looks at the crate this long, then out at the visitor. */
  offerLook: 0.9,
  /** Ignored this long, it fetches the crate back (§ B3: 12 s). */
  ignoredFor: 12,
  /** How far from its lane it can reach for a part (beyond `handForward`). */
  reach: 1.15,
  pickup: 0.45,
  shrug: 1.2,
  salute: 1.1,
  returnSpeed: 2.2,
  // ── S5 ──
  /** How fast it turns on the spot or into a run (radians/s). */
  turnRate: 11,
  /** After the reach, the crate comes into its hands over this long, lifted this much first (units). */
  gather: 0.55,
  gatherLift: 0.12,
  /** Setting a crate down: turn to the belt, reach out over the drop, lower it, let go; then arms back. */
  place: { turn: 0.3, out: 0.4, lower: 0.18, back: 0.3 } as const,
  /** The crate is carried out this high over the belt (units above its resting height). */
  placeLift: 0.15,
  /** The drop is clear when no other part is within this distance of it (horizontal, units). */
  dropClear: 0.55,
  /** Stretching for something past its tape, before it gives up. */
  stretch: 0.9,
  /** After giving up on something out of reach, it does not stretch (or print the slip) again for this long. */
  giveUpFor: 40,
  /** Hands up when a part in the visitor's hand comes within this distance (horizontal, units). */
  handsUpNear: 1.6,
  /** Its eye follows a loose part on the move within this distance (units). */
  gazeRange: 4,
} as const;

export type { FetchState } from '../types.ts';

/**
 * Fetch at `k` times P1's size (`SceneDesc.crewScale`): its body, its hands and its reach scale, and so
 * do its speeds, so it looks just as eager. Times stay as they are.
 */
function scaled(t: typeof FETCH_TUNING, k: number): typeof FETCH_TUNING {
  if (k === 1) return t;
  return {
    ...t,
    accel: t.accel * k,
    maxSpeed: t.maxSpeed * k,
    brake: t.brake * k,
    overshoot: t.overshoot * k,
    skidBack: t.skidBack * k,
    bodyHalfHeight: t.bodyHalfHeight * k,
    handGap: t.handGap * k,
    bodyHalfDepth: t.bodyHalfDepth * k,
    handForward: t.handForward * k,
    handHeight: t.handHeight * k,
    reach: t.reach * k,
    returnSpeed: t.returnSpeed * k,
    gatherLift: t.gatherLift * k,
    placeLift: t.placeLift * k,
    dropClear: t.dropClear * k,
    handsUpNear: t.handsUpNear * k,
    gazeRange: t.gazeRange * k,
  } as typeof FETCH_TUNING;
}

/** Why it is rolling: a lap (or nothing in particular), to fumble, to fetch back the fumbled crate, to take one off the stack, to set one down, to stretch for one. */
type Purpose = 'lap' | 'fumble' | 'retrieve' | 'take' | 'place' | 'stretch';

export interface FetchUnit extends Unit {
  member(): CrewMember;
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (f: number): number => f * f * (3 - 2 * f);
const clamp01 = (f: number): number => Math.min(1, Math.max(0, f));
function nlerp(a: Quat, b: Quat, f: number): Quat {
  const s = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
  return qnormalize([a[0] + (b[0] * s - a[0]) * f, a[1] + (b[1] * s - a[1]) * f, a[2] + (b[2] * s - a[2]) * f, a[3] + (b[3] * s - a[3]) * f]);
}
const lerp3 = (a: Vec3, b: Vec3, f: number): Vec3 => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
const isTxn = (c: Cause): boolean => c !== 'crew' && c !== 'system';

export function createFetch(ctx: SimContext, tuning: Partial<typeof FETCH_TUNING> = {}): FetchUnit {
  const k = ctx.scene.crewScale ?? 1;
  const T = scaled({ ...FETCH_TUNING, ...tuning }, k);
  const K = KNOCK_TUNING;
  const spec = ctx.scene.runner;
  const rounds = spec.rounds ?? null;
  const rng = ctx.rng('fetch');
  const knockRng = ctx.rng('fetch:knock'); // its own fork: a knock never shifts the idle pauses
  const [ax, az] = spec.lane.a;
  const [bx, bz] = spec.lane.b;
  const laneLen = Math.hypot(bx - ax, bz - az);
  const dir: readonly [number, number] = [(bx - ax) / laneLen, (bz - az) / laneLen];
  const laneYaw = Math.atan2(dir[0], dir[1]);
  const stopA = Math.min(T.inset, laneLen / 2);
  const stopB = Math.max(laneLen - T.inset, laneLen / 2);
  const clampLane = (s: number): number => Math.min(stopB, Math.max(stopA, s));
  const at = (s: number): [number, number] => [ax + dir[0] * s, az + dir[1] * s];
  /** Lane parameter (units) of the point nearest (x, z). */
  const nearest = (x: number, z: number): number => clampLane((x - ax) * dir[0] + (z - az) * dir[1]);
  /** How far from a point of its lane it can take hold of a part (horizontal, to the part's centre). */
  const R = T.reach + T.handForward;
  const selfSpec = ctx.scene.parts.find((p) => p.id === spec.id);
  const selfHalf: Vec3 = ctx.halfExtents(spec.id) ?? [0.3, 0.5, 0.26];
  const selfMass = selfSpec?.mass ?? massOf(selfHalf, selfSpec?.material ?? 'metal');
  const selfE = MATERIAL[selfSpec?.material ?? 'metal'].restitution;
  /** Its footprint as a circle, for the knock's clearance. */
  const footprint = Math.hypot(selfHalf[0], selfHalf[2]) + K.margin * k;
  const OBSTACLES = obstacles(ctx.scene);

  let state: FetchState = 'idle';
  let entered = ctx.clock.step;
  let s = clampLane(spec.start * laneLen);
  let x = at(s)[0];
  let z = at(s)[1];
  let v = 0; // signed speed along the lane (+ toward b)
  let heading = laneYaw;
  let carrying: Id | null = null;
  let target = s;
  /** Direction of the current run along the lane, fixed when it starts (the overshoot is past the stop in this direction). */
  let rollDir = 1;
  let purpose: Purpose = 'lap';
  let idleFor = steps(rng.range(T.idle[0], T.idle[1]));
  let lastFumble: number | null = null;
  let fumbled: Id | null = null; // the crate it fumbled and is offering
  let frozenFrom: { state: FetchState; entered: number; at: number } | null = null;
  let lookAt: Vec3 | null = null;

  // ── S5 ──
  /** The part it is going for (pickup, reach), and what for. */
  let goal: Id | null = null;
  let goalWhy: 'retrieve' | 'take' = 'take';
  /** The crate coming into its hands: from where, since when. */
  let gather: { from: Pose; at: number } | null = null;
  /** Setting a crate down: the drop pose (bottom of the crate at the mouth's drop point), and whether it has let go. */
  let placing: { to: Pose; above: Pose; from: Pose | null; out: number; let: boolean } | null = null;
  /** The step it last set a crate down (the pace), and the crate, while it is still falling the last hair. */
  let lastPlaced = -Infinity;
  let justPlaced: Id | null = null;
  /** It gave up on something out of reach: not again until this step. */
  let giveUpUntil = -Infinity;
  /** The visitor did its job for it this step: salute at the next. */
  let saluteDue = false;
  /** The knock in progress, with where it started. */
  let knock: (FetchKnock & { x0: number; z0: number; h0: number; dx: number; dz: number }) | null = null;
  /** A hit heard this step, acted on at the next (`heard` never acts). */
  let hit: { by: Id; strength: Strength | 'nudge'; dirX: number; dirZ: number; speed: number; mass: number; spinSign: number } | null = null;
  /** A part to give back a toy's bounce to, at the next step. */
  let bounce: { id: Id; dv: Vec3 } | null = null;
  /** A nudge's look: at this part until this step. */
  let nudge: { id: Id; until: number } | null = null;
  /** Free parts' recent motion, to know how a part was moving just before it hit (last two steps). */
  const motion = new Map<Id, { p: Vec3; v: Vec3; vPrev: Vec3; age: number }>();
  let gaze: Gaze | null = null;
  let handsUp = false;

  const enter = (next: FetchState): void => {
    if (next === state) return;
    const from = state;
    state = next;
    entered = ctx.clock.step;
    ctx.emit({ type: 'crew.state', id: spec.id, state: next, from });
  };
  const inState = (): number => ctx.clock.step - entered;
  const turnToward = (yaw: number): boolean => {
    const d = wrap(yaw - heading);
    const max = T.turnRate / HZ;
    heading = Math.abs(d) <= max ? yaw : heading + Math.sign(d) * max;
    return Math.abs(d) <= max;
  };
  const yawTo = (p: Vec3): number => Math.atan2(p[0] - x, p[2] - z);

  const bodyPose = (): Pose => ({ p: [x, T.bodyHalfHeight, z], q: qyaw(heading) });
  const handPose = (): Pose => {
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    // never inside its own body: the crate's near face sits just clear of Fetch's front
    const reach = T.bodyHalfDepth + T.handGap + (carrying ? (ctx.halfExtents(carrying)?.[2] ?? 0.225) : 0.225);
    return { p: [x + fx * reach, T.handHeight, z + fz * reach], q: qyaw(heading) };
  };
  /** Where the crate in its hands is: coming into them, in them, or on its way out over the belt. */
  function cratePose(): Pose {
    const hand = handPose();
    const now = ctx.clock.step;
    if (gather) {
      const f = clamp01((now - gather.at) / Math.max(1, steps(T.gather)));
      if (f >= 1) gather = null;
      else {
        // straight up off whatever it sat on, across above the hands (never down through what it sat on), then into them
        const high = Math.max(gather.from.p[1] + T.gatherLift, hand.p[1]);
        const lifted: Vec3 = [gather.from.p[0], high, gather.from.p[2]];
        const over: Vec3 = [hand.p[0], high, hand.p[2]];
        const p = f < 0.25 ? lerp3(gather.from.p, lifted, smooth(f / 0.25)) : f < 0.75 ? lerp3(lifted, over, smooth((f - 0.25) / 0.5)) : lerp3(over, hand.p, smooth((f - 0.75) / 0.25));
        return { p, q: nlerp(gather.from.q, hand.q, smooth(f)) };
      }
    }
    if (placing && !placing.let && placing.from) {
      const out = steps(T.place.out);
      const lower = steps(T.place.lower);
      const t = now - placing.out;
      if (t <= out) return { p: lerp3(placing.from.p, placing.above.p, smooth(clamp01(t / Math.max(1, out)))), q: nlerp(placing.from.q, placing.to.q, smooth(clamp01(t / Math.max(1, out)))) };
      return { p: lerp3(placing.above.p, placing.to.p, smooth(clamp01((t - out) / Math.max(1, lower)))), q: placing.to.q };
    }
    return hand;
  }

  /** Let go of the crate in its hands (the visitor took Fetch, or a knock): it falls, its rest charged to `cause`. */
  function letGo(linvel: Vec3, angvel: Vec3, cause: Cause | null): Id | null {
    const c = carrying;
    if (!c) return null;
    carrying = null;
    gather = null;
    placing = null;
    if (ctx.mode(c) === 'crew') ctx.detach(c, linvel, angvel, cause);
    return c;
  }

  // take hold of its own body and its crate
  ctx.crewFor(spec.id, {
    grabbed() {
      letGo([0, 0, 0], [0, 0, 0], 'crew');
      fumbled = null;
      goal = null;
      knock = null;
      hit = null;
      v = 0;
      lookAt = null;
      enter('held');
    },
    taken(part) {
      if (part !== carrying) return;
      carrying = null;
      gather = null;
      placing = null;
      goal = null;
      if (purpose === 'fumble') purpose = 'lap';
      v = 0;
      enter('salute');
    },
  });
  ctx.attach(spec.id, spec.id);
  ctx.drive(spec.id, bodyPose(), true);
  if (spec.carrying && ctx.attach(spec.carrying, spec.id)) {
    carrying = spec.carrying;
    ctx.drive(carrying, handPose(), true);
  }

  function rollTo(lanePos: number, why: Purpose): void {
    target = clampLane(lanePos);
    rollDir = Math.sign(target - s) || 1;
    purpose = why;
    if (Math.abs(target - s) < 0.01) arrive();
    else enter('roll');
  }

  function arrive(): void {
    s = target;
    v = 0;
    const why = purpose;
    purpose = why === 'retrieve' ? 'retrieve' : 'lap';
    if (why === 'fumble') enter('fumble');
    else if (why === 'retrieve' || why === 'take') enter('pickup');
    else if (why === 'place') enter('place');
    else if (why === 'stretch') enter('reach');
    else {
      idleFor = steps(rng.range(T.idle[0], T.idle[1]));
      enter('idle');
    }
  }

  const toIdle = (): void => {
    idleFor = steps(rng.range(T.idle[0], T.idle[1]));
    enter('idle');
  };

  const fumbleDue = (): boolean =>
    carrying !== null &&
    !ctx.playMode &&
    ctx.idleSteps() >= steps(T.fumbleAfter) &&
    (lastFumble === null || ctx.clock.step - lastFumble >= steps(T.fumbleEvery));

  function roll(): void {
    const dt = 1 / HZ;
    const aim = Math.min(laneLen, Math.max(0, target + rollDir * T.overshoot));
    const toAim = aim - s;
    const stopping = (v * v) / (2 * T.brake);
    if (Math.sign(toAim) === Math.sign(v) && Math.abs(toAim) <= stopping) {
      v -= Math.sign(v) * T.brake * dt;
    } else {
      v += Math.sign(toAim) * T.accel * dt;
      v = Math.max(-T.maxSpeed, Math.min(T.maxSpeed, v));
    }
    const nextS = s + v * dt;
    // past the aim, or stopped near it: skid back to the stop
    if ((v > 0 && nextS >= aim) || (v < 0 && nextS <= aim) || (Math.abs(v) < T.brake * dt && Math.abs(toAim) < 0.02)) {
      s = Math.min(laneLen, Math.max(0, aim));
      v = 0;
      if (Math.abs(s - target) < 0.005) arrive();
      else enter('skid');
      return;
    }
    s = nextS;
    // into the run: a quick spin round (never a snap, so a crate in its hands swings rather than jumps)
    if (Math.abs(v) > 0.01) turnToward(v > 0 ? laneYaw : laneYaw + Math.PI);
  }

  function skid(): void {
    const dt = 1 / HZ;
    const d = target - s;
    const step = Math.sign(d) * Math.min(Math.abs(d), Math.max(0.15, Math.min(1, Math.abs(d) * 6)) * T.skidBack * dt);
    s += step;
    // skidding backwards: heading unchanged, so the speed along it is negative
    v = step / dt;
    if (Math.abs(target - s) < 0.003) arrive();
  }

  function laneXZ(): void {
    [x, z] = at(s);
  }

  // ── its rounds (play mode) ──

  const horizontal = (a: Vec3, bx: number, bz: number): number => Math.hypot(a[0] - bx, a[2] - bz);
  /** A crate it may use (rule 5): a crate nobody has touched, lying still, not in any machine. */
  const fresh = (id: Id): boolean => {
    const p = ctx.part(id);
    return !!p && p.kind === 'crate' && !ctx.touched(id) && ctx.mode(id) === 'free' && ctx.settled(id) && p.location.at === 'rest';
  };
  /** The top fresh crate on the stack, if any. */
  function stackTop(): Id | null {
    if (!rounds) return null;
    let best: Id | null = null;
    let bestY = -Infinity;
    for (const id of ctx.parts()) {
      if (!fresh(id)) continue;
      const p = ctx.pose(id);
      if (!p || horizontal(p.p, rounds.stack[0], rounds.stack[1]) > rounds.stackRadius) continue;
      if (p.p[1] > bestY) [best, bestY] = [id, p.p[1]];
    }
    return best;
  }
  /** Crates in play: riding or being shipped, the one in its hands, and the one it has just let go of. */
  function inPlay(): number {
    if (!rounds) return 0;
    let n = 0;
    for (const id of ctx.parts()) {
      if (id === carrying) {
        n++;
        continue;
      }
      const l = ctx.part(id)?.location;
      if (l?.at === 'in' && rounds.inPlay.includes(l.mouth)) n++;
      else if (id === justPlaced && ctx.mode(id) === 'free' && !ctx.settled(id)) n++;
    }
    return n;
  }
  const drop = (): Vec3 | null => (rounds ? (ctx.mouth(rounds.mouth)?.drop ?? null) : null);
  const feeding = (): boolean => !!rounds && rounds.feedWhen.every((c) => ctx.setting(c.target, c.field) === c.is);
  function dropClear(): boolean {
    const d = drop();
    if (!d) return false;
    for (const id of ctx.parts()) {
      if (id === carrying || id === spec.id) continue;
      const m = ctx.mode(id);
      if (m === 'gone' || m === 'chute' || m === 'crew') continue;
      const p = ctx.pose(id);
      if (p && horizontal(p.p, d[0], d[2]) < T.dropClear + (ctx.halfExtents(id)?.[0] ?? 0.3) && p.p[1] < d[1] + 2) return false;
    }
    return true;
  }
  /** Go for a part: to the nearest point of its tape, then take it, or stretch for it if it is past reach. */
  function goFor(part: Id, why: 'retrieve' | 'take'): void {
    const p = ctx.pose(part);
    if (!p) return;
    goal = part;
    goalWhy = why;
    const sl = nearest(p.p[0], p.p[2]);
    const [lx, lz] = at(sl);
    rollTo(sl, Math.hypot(p.p[0] - lx, p.p[2] - lz) <= R ? why : 'stretch');
  }
  /** Idle in play mode with its rounds: what next? True if it set off. */
  function nextJob(): boolean {
    if (!rounds) return false;
    const now = ctx.clock.step;
    if (carrying) {
      if (!gather && feeding() && now - lastPlaced >= steps(rounds.every) && inPlay() <= rounds.cap && dropClear()) {
        const d = drop() as Vec3;
        rollTo(nearest(d[0], d[2]), 'place');
        return true;
      }
      return false;
    }
    // the crate it fumbled, if it is still there for the taking
    if (fumbled && fresh(fumbled)) {
      goFor(fumbled, 'retrieve');
      return true;
    }
    fumbled = null;
    if (inPlay() >= rounds.cap) return false;
    const top = stackTop();
    if (!top) return false;
    const p = ctx.pose(top) as Pose;
    const sl = nearest(p.p[0], p.p[2]);
    const [lx, lz] = at(sl);
    if (Math.hypot(p.p[0] - lx, p.p[2] - lz) > R && now < giveUpUntil) return false; // gave up on it a moment ago: never nag
    goFor(top, 'take');
    return true;
  }

  // ── knocked ──

  function beginKnock(h: NonNullable<typeof hit>): void {
    const st = h.strength as Strength;
    const i = st - 1;
    const want = (K.distance[i] as number) * k;
    const run = clearRun(x, z, h.dirX, h.dirZ, want, footprint, ctx.scene.bench, OBSTACLES);
    const spin = h.spinSign * (K.spin[i] as number) * 2 * Math.PI;
    // what it carried falls, its rest charged to the throw (§ E5 rule 4)
    const cause = ctx.history.chargeMachine(h.by);
    const shoveSpeed = run / Math.max(1e-3, K.shove[i] as number);
    const dropped = letGo([h.dirX * shoveSpeed * 0.8, 1.2, h.dirZ * shoveSpeed * 0.8], [h.dirZ * 4, spin * 0.5, -h.dirX * 4], cause);
    if (dropped && isTxn(cause)) ctx.history.claim(dropped, cause, ctx.clock.step);
    goal = null;
    placing = null;
    gather = null;
    v = 0;
    knock = { by: h.by, strength: st, dir: Math.atan2(h.dirX, h.dirZ), distance: run, spin, shove: K.shove[i] as number, wobble: K.wobble[i] as number, x0: x, z0: z, h0: heading, dx: h.dirX, dz: h.dirZ };
    // the toy's bounce, at the next step
    const u = h.speed;
    bounce = { id: h.by, dv: toyBounce([h.dirX, 0, h.dirZ], u, h.mass, selfMass, (selfE + (MATERIAL[ctx.part(h.by)?.material ?? 'wood'].restitution ?? 0.2)) / 2) };
    lookAt = null;
    ctx.emit({ type: 'crew.knocked', id: spec.id, by: h.by, strength: st, dir: knock.dir, distance: run, spin, dropped });
    enter('knocked');
  }

  /** Can it be knocked now? Not held, not in a machine, not frozen, not still recovering from the last one. */
  const knockable = (): boolean => state !== 'held' && state !== 'frozen' && state !== 'knocked' && !ctx.bracketed && ctx.mode(spec.id) === 'crew';

  /** Read a step's hits: one involving Fetch (or the crate in its hands) and a free part. */
  function hear(events: readonly SimEvent[]): void {
    if (!knockable()) return;
    for (const e of events) {
      if (e.type !== 'part.hit' || e.other === null) continue;
      const mine = (id: Id): boolean => id === spec.id || (id === carrying && carrying !== null);
      const by = mine(e.id) ? e.other : mine(e.other) ? e.id : null;
      if (by === null || by === carrying || ctx.mode(by) !== 'free') continue;
      const part = ctx.part(by);
      const half = ctx.halfExtents(by);
      const pose = ctx.pose(by);
      if (!part || !half || !pose) continue;
      const mass = massOf(half, part.material);
      // toward Fetch: from the part's centre to Fetch's
      let nx = x - pose.p[0];
      let nz = z - pose.p[2];
      const nl = Math.hypot(nx, nz) || 1;
      nx /= nl;
      nz /= nl;
      // how it was moving just before the hit (the step before this one); else from the impulse
      const m = motion.get(by);
      let vx = 0;
      let vz = 0;
      let speed: number;
      if (m && m.age >= 2) {
        [vx, , vz] = m.vPrev;
        speed = vx * nx + vz * nz;
      } else {
        speed = e.strength / (mass * (1 + MATERIAL[part.material].restitution));
        vx = nx * speed;
        vz = nz * speed;
      }
      const kind = classify(speed, mass * Math.max(0, speed));
      if (kind === 0) continue;
      // shoved along the way the part was going (its line through Fetch, if it was barely moving across)
      const hv = Math.hypot(vx, vz);
      const [dx, dz] = hv > 1e-3 ? [vx / hv, vz / hv] : [nx, nz];
      // spun by where it struck: the torque about Fetch's centre; a dead-centre hit spins it either way
      const rx = pose.p[0] - x;
      const rz = pose.p[2] - z;
      const torque = (rz * vx - rx * vz) / Math.max(1e-6, Math.hypot(rx, rz) * Math.max(hv, 1e-6));
      const spinSign = Math.abs(torque) > K.offCentre ? Math.sign(torque) : knockRng.chance(0.5) ? 1 : -1;
      const h = { by, strength: kind, dirX: dx, dirZ: dz, speed: Math.max(0, speed), mass, spinSign };
      // the hardest hit of the step wins
      const rank = (x: Strength | 'nudge'): number => (x === 'nudge' ? 0 : x);
      if (!hit || rank(h.strength) > rank(hit.strength)) hit = h;
    }
  }

  function knocked(): void {
    const kn = knock;
    if (!kn) {
      enter('return');
      return;
    }
    const t = inState() / HZ;
    const f = clamp01(t / kn.shove);
    // eased out: it leaves fast and slides to a stop
    const e = 1 - (1 - f) * (1 - f) * (1 - f);
    x = kn.x0 + kn.dx * kn.distance * e;
    z = kn.z0 + kn.dz * kn.distance * e;
    heading = kn.h0 + kn.spin * e;
    v = f < 1 ? (kn.distance / kn.shove) * 3 * (1 - f) * (1 - f) : 0;
    if (t >= kn.shove + kn.wobble) {
      heading = wrap(heading);
      knock = null;
      s = nearest(x, z);
      enter('return');
    }
  }

  // ── what it watches ──

  function watch(): void {
    // free parts' motion, for the next step's hits
    for (const id of ctx.parts()) {
      if (id === spec.id || ctx.mode(id) !== 'free') {
        motion.delete(id);
        continue;
      }
      const p = ctx.pose(id) as Pose;
      const m = motion.get(id);
      const nv: Vec3 = m ? [(p.p[0] - m.p[0]) * HZ, (p.p[1] - m.p[1]) * HZ, (p.p[2] - m.p[2]) * HZ] : [0, 0, 0];
      motion.set(id, { p: p.p, v: nv, vPrev: m ? m.v : nv, age: m ? m.age + 1 : 0 });
    }
    // the eye: what the visitor carries, else the nearest thing on the move
    gaze = null;
    handsUp = false;
    const h = ctx.holding();
    if (h?.kind === 'part' && h.id !== spec.id) {
      const p = ctx.pose(h.id);
      if (p) {
        gaze = { at: p.p, what: 'held', id: h.id };
        const calm = state === 'idle' || state === 'offer' || state === 'roll' || state === 'skid' || state === 'salute' || state === 'shrug' || state === 'return';
        handsUp = calm && carrying === null && Math.hypot(p.p[0] - x, p.p[2] - z) <= T.handsUpNear;
      }
      return;
    }
    let best: number = T.gazeRange;
    for (const [id, m] of motion) {
      if (ctx.settled(id) || Math.hypot(m.v[0], m.v[1], m.v[2]) < 0.3) continue;
      const d = Math.hypot(m.p[0] - x, m.p[1] - T.handHeight, m.p[2] - z);
      if (d < best) [best, gaze] = [d, { at: m.p, what: 'moving', id }];
    }
  }

  const unit: FetchUnit = {
    id: spec.id,

    bracket(on) {
      if (on) {
        if (state === 'held') return; // cannot happen: the Button refuses presses while anything is held
        frozenFrom = { state, entered, at: ctx.clock.step };
        hit = null;
        bounce = null;
        enter('frozen');
      } else if (frozenFrom) {
        const was = frozenFrom;
        frozenFrom = null;
        const shift = ctx.clock.step - was.at;
        enter(was.state);
        // resume as if no time had passed in the frozen state
        entered = was.entered + shift;
        if (gather) gather = { ...gather, at: gather.at + shift };
        if (placing) placing = { ...placing, out: placing.out + shift };
      }
    },

    reset() {
      // "Reset the workshop": back to idle on its lane (what is in its hands stays there; the world leaves crew parts be)
      goal = null;
      gather = null;
      placing = null;
      knock = null;
      hit = null;
      bounce = null;
      nudge = null;
      saluteDue = false;
      justPlaced = null;
      fumbled = null;
      giveUpUntil = -Infinity;
      lastPlaced = -Infinity;
      purpose = 'lap';
      v = 0;
      if (state !== 'held' && state !== 'frozen') {
        if (ctx.mode(spec.id) === 'crew') {
          s = nearest(x, z);
          enter('return');
        }
      }
    },

    heard(events) {
      hear(events);
      if (!rounds) return;
      for (const e of events) {
        // the visitor did its job for it: a crate of theirs taken in by the belt while it is empty-handed
        if (e.type === 'taken-in' && e.mouth === rounds.mouth && e.part !== justPlaced && ctx.touched(e.part)) saluteDue = true;
        if (e.type === 'taken-in' && e.part === justPlaced) justPlaced = null;
      }
    },

    pre() {
      if (state === 'frozen') return;
      const now = ctx.clock.step;
      lookAt = null;
      const mode = ctx.mode(spec.id);

      if (bounce) {
        if (ctx.mode(bounce.id) === 'free') ctx.shove(bounce.id, bounce.dv);
        bounce = null;
      }

      if (state === 'held') {
        hit = null;
        saluteDue = false;
        // put down: once it has come to rest, it rights itself and hurries back to its lane
        if (mode === 'free' && ctx.settled(spec.id)) {
          const p = ctx.pose(spec.id);
          if (p) {
            x = p.p[0];
            z = p.p[2];
            heading = yawOf(p.q);
          }
          ctx.attach(spec.id, spec.id);
          ctx.drive(spec.id, bodyPose(), true);
          s = nearest(x, z);
          enter('return');
        }
        return;
      }

      // a hit heard last step: a knock, or a look
      if (hit) {
        const h = hit;
        hit = null;
        if (knockable() && ctx.mode(h.by) !== undefined) {
          if (h.strength === 'nudge') {
            nudge = { id: h.by, until: now + steps(K.nudgeLook) };
            ctx.emit({ type: 'crew.nudged', id: spec.id, by: h.by });
          } else beginKnock(h);
        }
      }

      // the crate in its hands became the visitor's (changed by them): it sets it down where it is (rule 5)
      if (carrying && ctx.touched(carrying) && ctx.playMode) letGo([0, 0, 0], [0, 0, 0], null);

      if (saluteDue) {
        saluteDue = false;
        const busy = carrying !== null || state === 'knocked' || state === 'return' || state === 'fumble' || state === 'offer' || state === 'place' || state === 'reach';
        if (!busy && ctx.playMode) {
          goal = null;
          purpose = 'lap';
          v = 0;
          lastPlaced = now; // it counts as a crate set down: the pace starts again
          enter('salute');
        }
      }

      switch (state) {
        case 'idle': {
          if (fumbleDue()) {
            rollTo(spec.fumbleAt * laneLen, 'fumble');
            break;
          }
          if (rounds && ctx.playMode) {
            // its rounds: a job if there is one; otherwise it waits where it is, facing the belt with its load
            if (inState() >= Math.min(idleFor, steps(0.4)) && nextJob()) break;
            const d = drop();
            if (carrying && d) turnToward(yawTo(d));
            break;
          }
          if (inState() >= idleFor) rollTo(Math.abs(s - stopA) < Math.abs(s - stopB) ? stopB : stopA, 'lap');
          break;
        }
        case 'roll':
          if (purpose === 'lap' && fumbleDue()) {
            // change of plan mid-run: head for the fumble mark (turning round if it is behind)
            target = clampLane(spec.fumbleAt * laneLen);
            rollDir = Math.sign(target - s) || rollDir;
            purpose = 'fumble';
          }
          if ((purpose === 'take' || purpose === 'retrieve' || purpose === 'stretch') && (goal === null || ctx.mode(goal) !== 'free' || ctx.touched(goal))) purpose = 'lap'; // gone from under its nose
          roll();
          laneXZ();
          break;
        case 'skid':
          skid();
          laneXZ();
          break;
        case 'fumble': {
          v = 0;
          // turn to the fumble heading during the wind-up (shortest way), so the toss is the same whichever way it came
          if (carrying) {
            const left = Math.max(1, steps(T.fumbleWindup) - inState());
            const d = Math.atan2(Math.sin(spec.fumbleHeading - heading), Math.cos(spec.fumbleHeading - heading));
            heading += d / left;
          }
          if (carrying && inState() >= steps(T.fumbleWindup)) {
            heading = spec.fumbleHeading;
            const crate = carrying;
            carrying = null;
            fumbled = crate;
            lastFumble = ctx.clock.step;
            ctx.detach(crate, spec.toss.linvel, spec.toss.angvel, 'crew');
          }
          if (fumbled) {
            lookAt = ctx.pose(fumbled)?.p ?? null;
            // after letting go, turn to face the visitor for the offer
            const left = Math.max(1, steps(T.fumbleWindup + T.fumbleRecover) - inState());
            heading += Math.atan2(Math.sin(spec.offerHeading - heading), Math.cos(spec.offerHeading - heading)) / left;
          }
          if (inState() >= steps(T.fumbleWindup + T.fumbleRecover)) {
            if (fumbled) heading = spec.offerHeading;
            enter(fumbled ? 'offer' : 'idle');
          }
          break;
        }
        case 'offer': {
          if (!fumbled || ctx.touched(fumbled) || ctx.mode(fumbled) !== 'free') {
            fumbled = null;
            toIdle();
            break;
          }
          lookAt = inState() < steps(T.offerLook) ? (ctx.pose(fumbled)?.p ?? null) : spec.outward;
          if (inState() >= steps(T.ignoredFor) && ctx.settled(fumbled)) goFor(fumbled, 'retrieve');
          break;
        }
        case 'pickup': {
          const g = goal;
          if (g && !carrying) {
            const p = ctx.pose(g);
            if (p) {
              lookAt = p.p;
              turnToward(yawTo(p.p));
            }
            if (inState() < steps(T.pickup)) break;
            goal = null;
            if (g === fumbled) fumbled = null;
            const ok = p && !ctx.touched(g) && ctx.mode(g) === 'free' && ctx.settled(g) && Math.hypot(p.p[0] - x, p.p[2] - z) <= R;
            if (ok && ctx.attach(g, spec.id)) {
              carrying = g;
              gather = { from: p, at: now };
              break;
            }
            if (p && Math.hypot(p.p[0] - x, p.p[2] - z) > R && !ctx.touched(g)) {
              // it moved out of reach while it rolled up: say so
              ctx.emit({ type: 'card', by: spec.id, content: 'slip.out-of-lane' });
              giveUpUntil = now + steps(T.giveUpFor);
            }
            enter('shrug');
            break;
          }
          if (gather) {
            // the crate coming into its hands: face back to the lane as it arrives
            break;
          }
          purpose = 'lap';
          if (goalWhy === 'retrieve' || !carrying) enter('shrug');
          else toIdle();
          break;
        }
        case 'reach': {
          // stretching for something past its tape; then it gives up and says so (§ B5)
          const g = goal;
          const p = g ? ctx.pose(g) : undefined;
          if (p) {
            lookAt = p.p;
            turnToward(yawTo(p.p));
          }
          if (inState() >= steps(T.stretch)) {
            if (g && g === fumbled) fumbled = null;
            goal = null;
            giveUpUntil = now + steps(T.giveUpFor);
            ctx.emit({ type: 'card', by: spec.id, content: 'slip.out-of-lane' });
            enter('shrug');
          }
          break;
        }
        case 'place': {
          const d = drop();
          if ((!carrying && !placing?.let) || !d || !rounds) {
            placing = null;
            toIdle();
            break;
          }
          if (!placing && carrying) {
            const half = ctx.halfExtents(carrying) ?? [0.3, 0.3, 0.3];
            const to: Pose = { p: [d[0], d[1] + half[1] + 0.005, d[2]], q: qyaw(0) };
            placing = { to, above: { p: [d[0], d[1] + half[1] + T.placeLift, d[2]], q: to.q }, from: null, out: -1, let: false };
          }
          if (!placing) break;
          lookAt = placing.to.p;
          const t = inState();
          if (!placing.from) {
            turnToward(yawTo(placing.to.p));
            if (t < steps(T.place.turn)) break;
            // last look before reaching out: the belt still running forward, the drop still clear
            if (!feeding() || !dropClear() || inPlay() > rounds.cap) {
              placing = null;
              toIdle();
              break;
            }
            placing.from = cratePose();
            placing.out = now;
            break;
          }
          const sinceOut = now - placing.out;
          if (!placing.let && carrying && sinceOut >= steps(T.place.out) + steps(T.place.lower)) {
            const c = carrying;
            ctx.drive(c, placing.to);
            ctx.detach(c, [0, 0, 0], [0, 0, 0], 'crew');
            carrying = null;
            placing.let = true;
            lastPlaced = now;
            justPlaced = c;
          }
          if (placing.let && sinceOut >= steps(T.place.out) + steps(T.place.lower) + steps(T.place.back)) {
            placing = null;
            toIdle();
          }
          break;
        }
        case 'knocked':
          knocked();
          break;
        case 'shrug':
          if (inState() >= steps(T.shrug)) toIdle();
          break;
        case 'salute':
          if (inState() >= steps(T.salute)) toIdle();
          break;
        case 'return': {
          const [tx, tz] = at(s);
          const dx = tx - x;
          const dz = tz - z;
          const d = Math.hypot(dx, dz);
          const stepLen = T.returnSpeed / HZ;
          if (d <= stepLen) {
            x = tx;
            z = tz;
            v = 0;
            heading = Math.cos(heading - laneYaw) >= 0 ? laneYaw : laneYaw + Math.PI;
            toIdle();
          } else {
            x += (dx / d) * stepLen;
            z += (dz / d) * stepLen;
            turnToward(Math.atan2(dx, dz));
            v = T.returnSpeed;
          }
          break;
        }
      }

      if (nudge && lookAt === null) {
        if (now < nudge.until && ctx.pose(nudge.id)) lookAt = ctx.pose(nudge.id)?.p ?? null;
        else nudge = null;
      }
      if (state === 'idle' || state === 'shrug' || state === 'salute' || state === 'fumble' || state === 'offer' || state === 'pickup' || state === 'place' || state === 'reach') v = 0;
      if (ctx.mode(spec.id) === 'crew') ctx.drive(spec.id, bodyPose());
      if (carrying) ctx.drive(carrying, cratePose());
    },

    post() {
      if (state === 'frozen') return;
      watch();
    },

    member(): CrewMember {
      const facing = Math.cos(heading - laneYaw) >= 0 ? 1 : -1;
      const speed = state === 'return' || state === 'knocked' ? v : v * facing;
      const kn: FetchKnock | null = knock && state === 'knocked' ? { by: knock.by, strength: knock.strength, dir: knock.dir, distance: knock.distance, spin: knock.spin, shove: knock.shove, wobble: knock.wobble } : null;
      return { id: spec.id, state, stateTime: inState() / HZ, x, z, heading, speed, carrying, lookAt, gaze, handsUp, knock: kn };
    },
  };
  return unit;
}
