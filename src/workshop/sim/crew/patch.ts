/**
 * Patch, the operator (REWRITE.md § B5 "Patch", § D 3, § D 13, § E5 rule 10
 * and its worked example "pulls the lever while Patch is still reaching for
 * the drawer"; § F3). On its stool at the switchboard; it never walks the
 * bench except to get back to the stool.
 *
 * The job, in stages the view performs (`PatchView.state`), each a fixed
 * time on the simulation clock, the whole job about 2.85 s (the real thing
 * takes about a minute; the hatch says the toy is sped up, § F3):
 *   notice  0.35 s  turns to the board: the line's lamp is lit;
 *   drawer  0.55 s  pulls open the drawer for THAT jack (one folder per line);
 *   work    0.90 s  does it; at the end of this stage the change commits
 *                   (the desk's `perform`, sim/machines/line.ts);
 *   check   0.70 s  leans out toward the station to see it is really there;
 *   reply   0.35 s  texts back (the desk's `finish`: the reply is checked
 *                   against the durable state as it is sent).
 * Nothing durable is Patch's: it never commits anything itself except where
 * a part it caught comes to rest (charged to the throw).
 *
 * With the visitor (each reaction at most 1.5 s, § B5):
 * - the plug pulled mid-job: the job is dropped (nothing written); Patch
 *   looks at the dead plug (`stare`), then at the visitor (`look`);
 * - the lever pulled while it works: the job is dropped (rule 10); Patch
 *   looks at the lever;
 * - lifted off the stool (`drag` intents with its id): it hangs (`held`);
 *   put down anywhere it walks back (`walk`) and climbs up (`climb`). A job
 *   in hand waits and carries on where it was; texts wait meanwhile;
 * - a part thrown at it gets one of three answers, chosen by where the part
 *   is going: high (at its head) it ducks; at its hands, and small enough
 *   and slow enough, it catches it and sets it down on the shelf beside the
 *   board (the rest charged to the throw, rule 4); otherwise it takes it on
 *   the head (`bonk`: the part bounces off; Patch gives it the look). Patch
 *   is never moved by physics and never hurt.
 */
import type { Cause, Id, Intent, Outcome, PatchAnswer, PatchState, PatchView, Pose, SimEvent, StationId, Vec3 } from '../types.ts';
import type { LostReason, MachineUnit, SimContext } from '../context.ts';
import type { Job } from '../history.ts';
import type { UnitFactory } from '../scene.ts';
import type { Call } from '../machines/line.ts';
import { deskOf } from '../machines/line.ts';
import { boardOf } from '../machines/shared/patchlamp.ts';
import { HZ, steps } from '../clock.ts';
import { add, dist, dot, length, scale, sub } from '../math.ts';

/** Seconds, units, units per second. Tune here. */
export const PATCH_TUNING = {
  /** The job's stages (§ B5), in order. */
  notice: 0.35,
  drawer: 0.55,
  work: 0.9,
  check: 0.7,
  reply: 0.35,
  /** The dead plug, then the visitor (together at most 1.5 s, § B5). */
  stare: 0.6,
  look: 0.9,
  /** The look at the lever. */
  lever: 1.2,
  duck: 0.9,
  /** Catch: holds it up this long, then sets it on the shelf over `catchSet`. */
  catchHold: 0.55,
  catchSet: 0.45,
  bonk: 1.2,
  /** How far ahead it sees a part coming (s), and how soon before the part arrives it reacts. */
  horizon: 0.6,
  lead: 0.3,
  /** It catches only a part this slow (units/s) and not large. */
  catchMax: 6,
  /** A throw is watched this long after it leaves the hand. */
  watch: 2.5,
  /** Slower than this on release is not a throw. */
  throwMin: 1.2,
  /** How much speed a part keeps bouncing off its head. */
  bounce: 0.45,
  /** Walking back to the stool, and climbing up. */
  walk: 1.6,
  climb: 0.8,
} as const;

export interface PatchSpec {
  readonly id: Id;
  readonly station: StationId;
  /** Content id of its name. */
  readonly name: string;
  /** The phone line's unit id (its desk is where Patch works). */
  readonly line: Id;
  /** Where it sits: the top of the stool, under its middle. */
  readonly seat: Vec3;
  /** Its heading on the stool (radians about +Y; 0 faces +Z, the camera). */
  readonly facing: number;
  /** Where it climbs down to and up from: the bench in front of the stool. */
  readonly foot: Vec3;
  /** Its body for thrown parts: a sphere `up` above the seat, of radius `radius`; above `head` (over the seat) a part is at its head. */
  readonly body: { readonly up: number; readonly radius: number; readonly head: number; readonly hands: number };
  /** Where a caught part is set down (its bottom centre). */
  readonly shelf: Vec3;
  /** Things it looks at: the UNDO lever, the visitor, the phone. */
  readonly lever: Vec3;
  readonly visitor: Vec3;
  readonly phone: Vec3;
  /** Each jack's mouth (world): the line's lamp and the drawer under it. */
  readonly jacks: Readonly<Record<Id, Vec3>>;
  /** Where each station on a line is (unit id → world): it leans out toward it to check. */
  readonly stations: Readonly<Record<Id, Vec3>>;
  /** The bench: where it can be put down. */
  readonly bench: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number };
}

export interface PatchUnit extends MachineUnit {
  view(): PatchView;
}

const JOB: readonly PatchState[] = ['notice', 'drawer', 'work', 'check', 'reply'];
const isJob = (s: PatchState): boolean => JOB.includes(s);

interface Watched {
  readonly id: Id;
  last: Vec3;
  until: number;
  /** Set once Patch has chosen its answer. */
  answer: PatchAnswer | null;
  cause: Cause | null;
}

export function patch(spec: PatchSpec): UnitFactory {
  return (ctx) => createPatch(ctx, spec);
}

export function createPatch(ctx: SimContext, spec: PatchSpec): PatchUnit {
  const T = PATCH_TUNING;
  const id = spec.id;
  const g = ctx.scene.gravity;
  let state: PatchState = 'seated';
  let since = ctx.clock.step;
  let length_ = Infinity;
  let call: Call | null = null;
  /** A job stage interrupted (lifted, a reaction): where to carry on, and how far in it was. */
  let resume: { state: PatchState; elapsed: number } | null = null;
  let lookAt: Vec3 | null = null;
  let at: Vec3 = spec.seat;
  let heading = spec.facing;
  /** A caught part, the throw it is charged to, and the job that keeps that throw on the stack while Patch has it (rule 4, rule 10). */
  let holding: { id: Id; cause: Cause | null; job: Job | null } | null = null;
  /** A caught part set down: its throw stays on the stack until the part has come to rest (and that rest is the throw's). */
  const finishing: { job: Job; part: Id; until: number }[] = [];
  let cancelledAt = -1;
  const watched: Watched[] = [];

  const bodyCentre = (): Vec3 => add(spec.seat, [0, spec.body.up, 0]);
  const seconds = (): number => (ctx.clock.step - since) / HZ;
  const lengthOf = (s: PatchState): number =>
    ({ notice: T.notice, drawer: T.drawer, work: T.work, check: T.check, reply: T.reply, stare: T.stare, look: T.look, duck: T.duck, catch: T.catchHold + T.catchSet, bonk: T.bonk, climb: T.climb })[s as string] ?? Infinity;

  function enter(s: PatchState, elapsed = 0, len = lengthOf(s)): void {
    const from = state;
    state = s;
    since = ctx.clock.step - Math.round(elapsed * HZ);
    length_ = len;
    if (isJob(s)) lookAt = jobLook(s);
    if (from !== s) ctx.emit({ type: 'crew.state', id, state: s, from });
  }

  const jackAt = (j: Id): Vec3 => spec.jacks[j] ?? spec.seat;
  const drawerAt = (j: Id): Vec3 => {
    const p = jackAt(j);
    return [p[0], spec.seat[1] - 0.45, p[2] + 0.6];
  };

  /** Where its eyes go in a job stage. */
  function jobLook(s: PatchState): Vec3 | null {
    if (!call) return null;
    if (s === 'notice') return jackAt(call.jack);
    if (s === 'drawer' || s === 'work') return drawerAt(call.jack);
    if (s === 'check') return spec.stations[call.station] ?? null;
    if (s === 'reply') return spec.phone;
    return null;
  }

  /** Back to the job it was doing, or to sitting. */
  function carryOn(): void {
    lookAt = null;
    if (call && resume && isJob(resume.state)) {
      const r = resume;
      resume = null;
      enter(r.state, r.elapsed);
      return;
    }
    resume = null;
    enter('seated');
  }

  /** Something interrupts a job stage: remember where it was. */
  function interrupt(): void {
    if (isJob(state) && call) resume = { state, elapsed: seconds() };
  }

  const seatedOrWorking = (): boolean => state === 'seated' || isJob(state);

  // the desk tells Patch when the job it may hold is dropped
  function onCancel(c: Call, why: 'cord' | 'undo'): void {
    if (c !== call) return;
    call = null;
    if (resume) resume = null;
    if (!(seatedOrWorking() || state === 'stare' || state === 'look')) return; // lifted or walking: it will find out
    if (why === 'cord') {
      lookAt = boardOf(ctx).plugAt ?? jackAt(c.jack);
      enter('stare');
    } else {
      cancelledAt = ctx.clock.step;
      lookAt = null;
      enter('seated');
    }
  }

  function setDown(part: Id, cause: Cause | null): void {
    if (ctx.mode(part) !== 'machine') return;
    const h = ctx.halfExtents(part)?.[1] ?? 0.3;
    ctx.drive(part, { p: [spec.shelf[0], spec.shelf[1] + h + 0.01, spec.shelf[2]], q: ctx.pose(part)?.q ?? [0, 0, 0, 1] }, true);
    ctx.release(part, [0, 0, 0], [0, 0, 0], cause);
  }

  /** Set the caught part down on the shelf: its rest is the throw's (committed this step); the job ends after it. */
  function letGoOfCatch(): void {
    const h = holding;
    holding = null;
    if (!h) return;
    setDown(h.id, h.cause);
    if (h.job) finishing.push({ job: h.job, part: h.id, until: ctx.clock.step + steps(3) });
  }

  /** Watch the parts in flight; answer one coming at it. */
  function watch(): void {
    const now = ctx.clock.step;
    const c = bodyCentre();
    for (const w of [...watched]) {
      const mode = ctx.mode(w.id);
      const pose = ctx.pose(w.id);
      if (now > w.until || mode !== 'free' || !pose) {
        watched.splice(watched.indexOf(w), 1);
        continue;
      }
      const v = scale(sub(pose.p, w.last), HZ);
      w.last = pose.p;
      const r = spec.body.radius + Math.max(...(ctx.halfExtents(w.id) ?? [0.3, 0.3, 0.3]));
      if (w.answer === null) {
        if (!seatedOrWorking()) continue;
        // where is it going? when its fall first meets Patch's body, and where it passes nearest its middle
        let hit: number | null = null;
        let nearest: { d: number; p: Vec3 } = { d: Infinity, p: pose.p };
        for (let k = 1; k <= Math.round(T.horizon * HZ); k++) {
          const t = k / HZ;
          const p: Vec3 = [pose.p[0] + v[0] * t, pose.p[1] + v[1] * t + 0.5 * g * t * t, pose.p[2] + v[2] * t];
          const d = dist(p, c);
          if (d < r && hit === null) hit = t;
          if (d < nearest.d) nearest = { d, p };
          else if (hit !== null) break;
        }
        if (hit === null || hit > T.lead) continue;
        const y = nearest.p[1] - spec.seat[1];
        const size = ctx.part(w.id)?.size;
        const answer: PatchAnswer = y > spec.body.head ? 'duck' : y >= spec.body.hands && size !== 'L' && length(v) < T.catchMax && holding === null ? 'catch' : 'bonk';
        w.answer = answer;
        w.cause = ctx.history.chargeMachine(w.id); // the throw's, while it flies (rule 4): a catch's rest is charged to it
        interrupt();
        lookAt = pose.p;
        enter(answer);
        ctx.emit({ type: 'patch.reacted', part: w.id, answer });
        if (answer === 'duck') watched.splice(watched.indexOf(w), 1);
        continue;
      }
      // it has chosen: meet the part when it arrives
      if (dist(pose.p, c) > r) continue;
      watched.splice(watched.indexOf(w), 1);
      if (w.answer === 'catch' && state === 'catch' && holding === null && ctx.take(w.id, id)) {
        const part = w.id;
        const cause = w.cause;
        // the throw stays on the stack while Patch holds what it threw (the window let go of it at the take)
        const job = cause !== null && cause !== 'crew' && cause !== 'system' ? ctx.history.work(cause, id, () => {
          if (holding?.id === part) holding = null; // undone (rule 10): the world puts the part back
        }) : null;
        holding = { id: part, cause, job };
      } else {
        const n = sub(pose.p, c);
        const ln = length(n) || 1;
        const u = scale(n, 1 / ln);
        const vn = dot(v, u);
        if (vn < 0) ctx.shove(w.id, scale(u, -(1 + T.bounce) * vn));
      }
    }
  }

  const unit: PatchUnit = {
    id,
    station: spec.station,
    name: spec.name,
    affordances: ['grab'],
    tell() {
      ctx.emit({ type: 'tell', id });
    },
    misfire(level) {
      ctx.emit({ type: 'misfire', id, level });
    },

    // S6: one grab: the world turns grab / carry / release of Patch into the `drag` intents below
    holds: (what: Id): boolean => what === id,

    intent(intent: Intent): boolean {
      if (intent.type !== 'drag' || intent.id !== id || ctx.bracketed) return false;
      if (state !== 'held') {
        interrupt();
        if (holding) {
          letGoOfCatch();
        }
        for (const w of watched) w.answer = null;
        lookAt = spec.visitor;
        enter('held');
      }
      at = intent.target;
      if (intent.end) {
        const b = spec.bench;
        at = [Math.min(b.maxX, Math.max(b.minX, intent.target[0])), spec.foot[1], Math.min(b.maxZ, Math.max(b.minZ, intent.target[2]))];
        lookAt = null;
        enter(dist(at, spec.foot) < 0.15 ? 'climb' : 'walk');
      }
      return true;
    },

    accept(): Outcome {
      return { ok: false, wanted: 'not-here' }; // no mouth: a part thrown at it is answered by `watch`
    },
    abort() {},

    lost(part: Id, _why: LostReason) {
      if (holding?.id === part) {
        holding.job?.done();
        holding = null;
      }
    },

    post() {
      for (const f of [...finishing])
        if (ctx.settled(f.part) || ctx.mode(f.part) !== 'free' || ctx.clock.step > f.until) {
          finishing.splice(finishing.indexOf(f), 1);
          f.job.done();
        }
    },

    heard(events: readonly SimEvent[]) {
      for (const e of events) {
        if (e.type === 'part.released' && e.speed >= T.throwMin && e.id !== id) {
          const p = ctx.pose(e.id);
          if (p) watched.push({ id: e.id, last: p.p, until: ctx.clock.step + steps(T.watch), answer: null, cause: null });
        } else if (e.type === 'undone' && e.by === 'lever' && e.cancelled.includes(spec.line) && cancelledAt === ctx.clock.step && state === 'seated') {
          // § E5's example: the lever pulled while Patch reached for the drawer; Patch looks at the lever
          lookAt = spec.lever;
          enter('look', 0, T.lever);
        }
      }
    },

    pre() {
      if (ctx.bracketed) {
        since += 1; // frozen: no stage advances while a rung plays
        return;
      }
      const desk = deskOf(ctx);
      if (desk && desk.onCancel !== onCancel) desk.onCancel = onCancel;
      watch();
      const t = seconds();
      switch (state) {
        case 'seated':
          at = spec.seat;
          heading = spec.facing;
          if (desk && !call) {
            const next = desk.next();
            if (next) {
              call = next;
              desk.start(next);
              enter('notice');
            }
          }
          break;
        case 'notice':
        case 'drawer':
        case 'work':
        case 'check':
        case 'reply': {
          if (!call || !desk) {
            enter('seated');
            break;
          }
          lookAt = jobLook(state);
          if (t < length_) break;
          const i = JOB.indexOf(state);
          if (state === 'work' && !desk.perform(call)) break; // dropped: `onCancel` has already moved Patch
          if (state === 'reply') {
            const c = call;
            call = null;
            desk.finish(c);
            lookAt = null;
            enter('seated');
            break;
          }
          enter(JOB[i + 1] as PatchState);
          break;
        }
        case 'stare':
          if (t >= length_) {
            lookAt = spec.visitor;
            enter('look');
          }
          break;
        case 'look':
        case 'duck':
        case 'bonk':
          if (t >= length_) carryOn();
          break;
        case 'catch':
          if (holding) {
            const hands: Vec3 = add(spec.seat, [0, spec.body.hands + 0.15, 0.35]);
            const h = ctx.halfExtents(holding.id)?.[1] ?? 0.3;
            const goal = t < T.catchHold ? hands : add(hands, scale(sub([spec.shelf[0], spec.shelf[1] + h + 0.01, spec.shelf[2]], hands), Math.min(1, (t - T.catchHold) / T.catchSet)));
            // into its hands quickly but not in one jump; then along the way to the shelf
            const cur = ctx.pose(holding.id) ?? { p: goal, q: [0, 0, 0, 1] };
            const p = add(cur.p, scale(sub(goal, cur.p), t < T.catchHold ? 0.3 : 0.6));
            ctx.drive(holding.id, { p, q: cur.q } as Pose);
            lookAt = p;
          }
          if (t >= length_) {
            letGoOfCatch();
            carryOn();
          }
          break;
        case 'held':
          break;
        case 'walk': {
          const d = sub(spec.foot, at);
          const n = Math.hypot(d[0], d[2]);
          const stepLen = T.walk / HZ;
          if (n <= stepLen) {
            at = spec.foot;
            enter('climb');
          } else {
            at = [at[0] + (d[0] / n) * stepLen, spec.foot[1], at[2] + (d[2] / n) * stepLen];
            heading = Math.atan2(d[0], d[2]);
          }
          break;
        }
        case 'climb': {
          const k = Math.min(1, t / T.climb);
          at = add(spec.foot, scale(sub(spec.seat, spec.foot), k));
          if (t >= length_) {
            at = spec.seat;
            heading = spec.facing;
            carryOn();
          }
          break;
        }
      }
    },

    reset() {
      call = null;
      resume = null;
      holding = null;
      finishing.length = 0;
      watched.length = 0;
      lookAt = null;
      at = spec.seat;
      heading = spec.facing;
      enter('seated');
    },

    crewView: () => ({ kind: 'patch', id, body: null, view: unit.view() }),

    view(): PatchView {
      return {
        kind: 'patch',
        id,
        station: spec.station,
        lamp: 'dark',
        misfire: null,
        state,
        stateTime: seconds(),
        stateLength: length_,
        at,
        heading,
        drawer: call && (state === 'drawer' || state === 'work' || state === 'check' || (resume !== null && ['drawer', 'work', 'check'].includes(resume.state))) ? call.jack : null,
        serving: call?.station ?? null,
        lookAt,
        holding: holding?.id ?? null,
      };
    },
  };
  return unit;
}
