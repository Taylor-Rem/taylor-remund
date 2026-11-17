/**
 * Fetch, the runner (REWRITE.md § B5, § B3, § G "P1"). A state machine on
 * the fixed step. Eager and too fast: it overshoots every stop and skids
 * back. It cannot leave its lane of tape (except to hurry back to it after
 * being put down elsewhere).
 *
 * The vignette's Fetch: rolls up and down its lane carrying a crate; after
 * ~4 s with no visitor input it fumbles the crate so it tumbles to a stop
 * beside the Button, looks at it, then out at the visitor, hands out; if
 * ignored for 12 s it fetches it back, shrugs and carries on. The fumble
 * repeats at most every 40 s and never after the visitor's first action
 * (§ B3 "Never nag"). It freezes while a Button rung plays.
 *
 * Its position and intentions are transient (§ E5): nothing here commits,
 * except where a fumbled crate comes to rest (charged to `crew`). It never
 * touches a part the visitor has touched (§ E5 rule 5).
 *
 * `carry` in the brief is not a separate state: `carrying` is set while it
 * rolls, idles or skids with a crate in its hands.
 */
import type { CrewMember, FetchState, Id, Pose, Vec3 } from '../types.ts';
import type { SimContext, Unit } from '../context.ts';
import { HZ, steps } from '../clock.ts';
import { qyaw, yawOf } from '../math.ts';

/** Timings (seconds), speeds (units/s) and distances (units). Tune here. */
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
  handForward: 0.44,
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
  /** How far from its lane it can reach for a part. */
  reach: 1.15,
  pickup: 0.45,
  shrug: 1.2,
  salute: 1.1,
  returnSpeed: 2.2,
} as const;

export type { FetchState } from '../types.ts';
type Purpose = 'lap' | 'fumble' | 'retrieve';

export interface FetchUnit extends Unit {
  member(): CrewMember;
}

export function createFetch(ctx: SimContext, tuning: Partial<typeof FETCH_TUNING> = {}): FetchUnit {
  const T = { ...FETCH_TUNING, ...tuning };
  const spec = ctx.scene.runner;
  const rng = ctx.rng('fetch');
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

  const enter = (next: FetchState): void => {
    if (next === state) return;
    const from = state;
    state = next;
    entered = ctx.clock.step;
    ctx.emit({ type: 'crew.state', id: spec.id, state: next, from });
  };
  const inState = (): number => ctx.clock.step - entered;

  const bodyPose = (): Pose => ({ p: [x, T.bodyHalfHeight, z], q: qyaw(heading) });
  const handPose = (): Pose => {
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    return { p: [x + fx * T.handForward, T.handHeight, z + fz * T.handForward], q: qyaw(heading) };
  };

  // take hold of its own body and its crate
  ctx.crewFor(spec.id, {
    grabbed() {
      if (carrying) {
        ctx.detach(carrying, [0, 0, 0], [0, 0, 0], 'crew');
        carrying = null;
      }
      fumbled = null;
      v = 0;
      lookAt = null;
      enter('held');
    },
    taken(part) {
      if (part !== carrying) return;
      carrying = null;
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
    if (purpose === 'fumble') enter('fumble');
    else if (purpose === 'retrieve') enter('pickup');
    else {
      idleFor = steps(rng.range(T.idle[0], T.idle[1]));
      enter('idle');
    }
    purpose = purpose === 'retrieve' ? 'retrieve' : 'lap';
  }

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
    if (Math.abs(v) > 0.01) heading = v > 0 ? laneYaw : laneYaw + Math.PI;
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

  const unit: FetchUnit = {
    id: spec.id,

    bracket(on) {
      if (on) {
        if (state === 'held') return; // cannot happen: the Button refuses presses while anything is held
        frozenFrom = { state, entered, at: ctx.clock.step };
        enter('frozen');
      } else if (frozenFrom) {
        const was = frozenFrom;
        frozenFrom = null;
        enter(was.state);
        // resume as if no time had passed in the frozen state
        entered = was.entered + (ctx.clock.step - was.at);
      }
    },

    pre() {
      if (state === 'frozen') return;
      lookAt = null;
      const mode = ctx.mode(spec.id);

      if (state === 'held') {
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

      switch (state) {
        case 'idle': {
          if (fumbleDue()) {
            rollTo(spec.fumbleAt * laneLen, 'fumble');
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
          roll();
          laneXZ();
          break;
        case 'skid':
          skid();
          laneXZ();
          break;
        case 'fumble': {
          v = 0;
          if (carrying && inState() >= steps(T.fumbleWindup)) {
            const crate = carrying;
            carrying = null;
            fumbled = crate;
            lastFumble = ctx.clock.step;
            ctx.detach(crate, spec.toss.linvel, spec.toss.angvel, 'crew');
          }
          if (fumbled) lookAt = ctx.pose(fumbled)?.p ?? null;
          if (inState() >= steps(T.fumbleWindup + T.fumbleRecover)) enter(fumbled ? 'offer' : 'idle');
          break;
        }
        case 'offer': {
          if (!fumbled || ctx.touched(fumbled) || ctx.mode(fumbled) !== 'free') {
            fumbled = null;
            idleFor = steps(rng.range(T.idle[0], T.idle[1]));
            enter('idle');
            break;
          }
          lookAt = inState() < steps(T.offerLook) ? (ctx.pose(fumbled)?.p ?? null) : spec.outward;
          if (inState() >= steps(T.ignoredFor) && ctx.settled(fumbled)) {
            const p = ctx.pose(fumbled);
            if (p) rollTo(nearest(p.p[0], p.p[2]), 'retrieve');
          }
          break;
        }
        case 'pickup': {
          if (fumbled) lookAt = ctx.pose(fumbled)?.p ?? null;
          if (inState() < steps(T.pickup)) break;
          const crate = fumbled;
          fumbled = null;
          purpose = 'lap';
          const p = crate ? ctx.pose(crate) : undefined;
          if (crate && p && !ctx.touched(crate) && ctx.mode(crate) === 'free' && Math.hypot(p.p[0] - x, p.p[2] - z) <= T.reach + T.handForward) {
            if (ctx.attach(crate, spec.id)) carrying = crate;
          } else if (crate) {
            ctx.emit({ type: 'card', by: spec.id, content: 'slip.out-of-lane' });
          }
          enter('shrug');
          break;
        }
        case 'shrug':
          if (inState() >= steps(T.shrug)) {
            idleFor = steps(rng.range(T.idle[0], T.idle[1]));
            enter('idle');
          }
          break;
        case 'salute':
          if (inState() >= steps(T.salute)) {
            idleFor = steps(rng.range(T.idle[0], T.idle[1]));
            enter('idle');
          }
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
            idleFor = steps(rng.range(T.idle[0], T.idle[1]));
            enter('idle');
          } else {
            x += (dx / d) * stepLen;
            z += (dz / d) * stepLen;
            heading = Math.atan2(dx, dz);
            v = T.returnSpeed;
          }
          break;
        }
      }

      if (state === 'idle' || state === 'shrug' || state === 'salute' || state === 'fumble' || state === 'offer' || state === 'pickup') v = 0;
      if (ctx.mode(spec.id) === 'crew') ctx.drive(spec.id, bodyPose());
      if (carrying) ctx.drive(carrying, handPose());
    },

    member(): CrewMember {
      const facing = Math.cos(heading - laneYaw) >= 0 ? 1 : -1;
      const speed = state === 'return' ? v : v * facing;
      return { id: spec.id, state, stateTime: inState() / HZ, x, z, heading, speed, carrying, lookAt };
    },
  };
  return unit;
}
