/**
 * Stand-in machines for the history tests (REWRITE.md § E5 "What the tests
 * hold": stand-in machines, scripted rest events in place of physics).
 *
 * The real vignette world runs underneath (the funnel, the bodies, Fetch,
 * the cord, the Button), on the stub physics, so every rest is scripted and
 * every run repeats exactly. Beside it, these units exercise every rule:
 *
 * - `patch`: texts through the cord's jack. Each instruction opens a `text`
 *   transaction and becomes a job that commits after a delay, one job at a
 *   time in the order sent; "undo that" is processed in the same queue.
 * - `belt`: a setting (`standin-belt.speed`) with a handle (`turn`), and a
 *   carrier: a part that comes to rest in its zone is taken into its mouth
 *   (charged to whoever placed it), rides while the speed is above zero,
 *   then is shipped (the dock: location `shipped`, a mark added).
 * - `crew`: does work for itself, as `crew` (Fetch coming back up the chute,
 *   writing its own location; or anything a test asks, to probe rule 5).
 * - `revert`: puts parts away, as `system` (rule 14).
 */
import { createStubPhysics } from '../../../src/workshop/sim/physics/stub.ts';
import type { StubPhysics } from '../../../src/workshop/sim/physics/stub.ts';
import { createWorld } from '../../../src/workshop/sim/world.ts';
import type { World, WorldOptions } from '../../../src/workshop/sim/world.ts';
import { vignette } from '../../../src/workshop/sim/scenes/vignette.ts';
import type { SimContext, CommitResult, Unit } from '../../../src/workshop/sim/context.ts';
import type { Change, Job } from '../../../src/workshop/sim/history.ts';
import type { Id, Location, Pose, SimEvent, Value, Vec3 } from '../../../src/workshop/sim/types.ts';
import { qyaw } from '../../../src/workshop/sim/math.ts';

export const PHONE = 'standin-phone';
export const BELT = 'standin-belt';
export const SPEED = 'speed';
/** The carrier's mouth: the zone on the bench where a resting part is taken in. */
export const BELT_ZONE = { minX: 6, maxX: 9.5, minZ: -2.5, maxZ: 0 } as const;
/** Steps a part rides at speed 1 before it ships (faster at higher speeds). */
export const RIDE = 90;
/** Steps Patch takes over a job, unless the text says otherwise. */
export const PATCH_DELAY = 120;

// ───────────────────────── Patch, by text ─────────────────────────

export type Text =
  | { readonly kind: 'set'; readonly target: Id; readonly field: string; readonly value: Value; readonly delay?: number }
  | { readonly kind: 'undo-that' };

interface Pending {
  readonly job: Job | null;
  readonly text: Text;
  readonly jack: Id;
  left: number;
}

export interface Patch extends Unit {
  /** The visitor sends a text (handled at the next step, in order with every other intent). */
  send(text: Text): void;
  /** Jobs and "undo that"s waiting or in hand, oldest first. */
  queue(): readonly { kind: Text['kind']; cause: string | null }[];
  /** What each job ended as: committed, refused (rule 7: changed since), or cancelled (rule 10). */
  readonly outcomes: { cause: string; result: 'committed' | 'refused' | 'cancelled' }[];
}

export function patchStandin(ctx: SimContext): Patch {
  const inbox: Text[] = [];
  const queue: Pending[] = [];
  const outcomes: Patch['outcomes'] = [];
  return {
    id: PHONE,
    outcomes,
    send(text) {
      inbox.push(text);
    },
    queue: () => queue.map((p) => ({ kind: p.text.kind, cause: p.job ? p.job.cause : null })),
    intent(intent) {
      if (intent.type !== 'press' || intent.id !== PHONE) return false;
      const text = inbox.shift();
      if (!text) return false;
      const jack = ctx.setting('cord', 'jack') as Id;
      if (text.kind === 'undo-that') {
        queue.push({ job: null, text, jack, left: 0 }); // D5: not a transaction; carried out in order
        return true;
      }
      const cause = ctx.history.open('text', jack, ctx.clock.step);
      const p: Pending = { job: null, text, jack, left: text.delay ?? PATCH_DELAY };
      const job = ctx.history.work(cause, PHONE, () => {
        // rule 10: drop this job and return to idle
        const i = queue.indexOf(p);
        if (i >= 0) queue.splice(i, 1);
        outcomes.push({ cause, result: 'cancelled' });
      });
      queue.push(Object.assign(p, { job }));
      return true;
    },
    pre() {
      if (ctx.bracketed) return; // the crew pauses while a rung plays
      const p = queue[0];
      if (!p) return;
      if (p.left > 0) {
        p.left -= 1;
        return;
      }
      queue.shift();
      if (p.text.kind === 'undo-that') {
        ctx.undo({ by: 'text', jack: p.jack });
        return;
      }
      const job = p.job as Job;
      const r = job.commit([{ target: p.text.target, field: p.text.field, after: p.text.value }]);
      outcomes.push({ cause: job.cause, result: r.refused.length > 0 ? 'refused' : 'committed' });
      if (r.refused.length > 0) ctx.emit({ type: 'card', by: PHONE, content: 'slip.changed-since' });
      job.done();
    },
  };
}

// ───────────────────────── the belt: a setting with a handle, a carrier, a shipper ─────────────────────────

export interface Belt extends Unit {
  /** Parts riding, with the cause each is charged to. */
  riding(): readonly { id: Id; cause: string }[];
}

const inZone = (l: Value | undefined): boolean => {
  if (!l || typeof l !== 'object' || Array.isArray(l)) return false;
  const loc = l as Location;
  if (loc.at !== 'rest') return false;
  const [x, , z] = loc.pose.p;
  return x >= BELT_ZONE.minX && x <= BELT_ZONE.maxX && z >= BELT_ZONE.minZ && z <= BELT_ZONE.maxZ;
};

export function beltStandin(ctx: SimContext): Belt {
  ctx.defineSetting(BELT, SPEED, 1, (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0);
  const rides: { id: Id; job: Job; left: number }[] = [];
  /** The location value last looked at, per part: a part is taken in only when it newly comes to rest in the zone. */
  const seen = new Map<Id, Value>();
  const parts = [...ctx.scene.parts.map((p) => p.id)];
  for (const id of parts) seen.set(id, ctx.setting(id, 'location') ?? null); // (the world's part() is not ready while units are made)
  return {
    id: BELT,
    riding: () => rides.map((r) => ({ id: r.id, cause: r.job.cause })),
    intent(intent) {
      if (intent.type !== 'turn' || intent.id !== BELT) return false;
      const cause = ctx.history.open('turn', BELT, ctx.clock.step);
      ctx.commit([{ target: BELT, field: SPEED, after: intent.value }], cause);
      return true;
    },
    post() {
      if (ctx.bracketed) return;
      const speed = ctx.setting(BELT, SPEED) as number;
      // carry: rides advance with the speed; at the end the dock ships
      for (const r of [...rides]) {
        const l = ctx.part(r.id)?.location;
        const mode = ctx.mode(r.id);
        if (l?.at !== 'in' || l.mouth !== BELT || mode === 'held' || mode === 'chute' || (mode === 'free' && !ctx.settled(r.id))) {
          // taken off the belt (picked up, knocked, or moved by someone else): the ride is over
          rides.splice(rides.indexOf(r), 1);
          r.job.done();
          continue;
        }
        if (speed <= 0) continue;
        r.left -= speed;
        if (r.left > 0) continue;
        rides.splice(rides.indexOf(r), 1);
        const marks = ctx.part(r.id)?.marks ?? [];
        // the dock: out, then the mark; if the part's location was written by someone newer (rule 7), nothing ships
        const out = r.job.commit([{ target: r.id, field: 'location', after: { at: 'shipped' } }]);
        if (out.refused.length === 0) r.job.commit([{ target: r.id, field: 'marks', after: [...marks, 'SHIPPED'] }]);
        r.job.done();
      }
      // the mouth: a part that has newly come to rest in the zone is taken in (§ B1 law 2)
      for (const id of parts) {
        const loc = ctx.part(id)?.location ?? null;
        if (loc === seen.get(id)) continue;
        seen.set(id, loc);
        if (!inZone(loc) || ctx.mode(id) !== 'free' || !ctx.settled(id) || rides.some((r) => r.id === id)) continue;
        const cause = ctx.history.chargeMachine(id); // rule 4: whoever placed it, while on the stack
        const job = ctx.history.work(cause, BELT, () => {
          const i = rides.findIndex((r) => r.job === job);
          if (i >= 0) rides.splice(i, 1);
        });
        const res = job.commit([{ target: id, field: 'location', after: { at: 'in', station: 'line', mouth: BELT } }]);
        if (res.refused.length > 0) {
          job.done();
          continue;
        }
        seen.set(id, ctx.part(id)?.location ?? null);
        rides.push({ id, job, left: RIDE });
      }
    },
    restored(restores) {
      // a restored part is not "newly come to rest": do not take it in again
      for (const r of restores) if (r.field === 'location') seen.set(r.target, ctx.part(r.target)?.location ?? null);
    },
  };
}

// ───────────────────────── the crew, working for itself ─────────────────────────

export interface Crew extends Unit {
  /** Next step, write these as `crew`. */
  write(changes: readonly Change[]): void;
  readonly results: CommitResult[];
}

export function crewStandin(ctx: SimContext): Crew {
  const todo: (readonly Change[])[] = [];
  const results: CommitResult[] = [];
  return {
    id: 'standin-crew',
    results,
    write(changes) {
      todo.push(changes);
    },
    pre() {
      if (ctx.bracketed) return;
      for (const c of todo.splice(0)) results.push(ctx.commit(c, 'crew'));
    },
  };
}

// ───────────────────────── Revert, putting things away ─────────────────────────

export interface Revert extends Unit {
  putAway(part: Id, at: Location): void;
}

export function revertStandin(ctx: SimContext): Revert {
  const todo: { part: Id; at: Location }[] = [];
  return {
    id: 'standin-revert',
    putAway(part, at) {
      todo.push({ part, at });
    },
    pre() {
      if (ctx.bracketed) return;
      for (const t of todo.splice(0)) ctx.putAway(t.part, t.at);
    },
  };
}

// ───────────────────────── the bench ─────────────────────────

export interface Bench {
  readonly world: World;
  readonly physics: StubPhysics;
  readonly patch: Patch;
  readonly belt: Belt;
  readonly crew: Crew;
  readonly revert: Revert;
  /** Every event since the bench was made, in order. */
  readonly log: SimEvent[];
  /** Advance n steps; returns this stretch's events. */
  run(n: number): SimEvent[];
}

/** `observe` is called after every step with that step's events (the replay check and the invariants hang here). */
export function bench(seed: number | string = 1, opts: Partial<WorldOptions> = {}, observe?: (events: readonly SimEvent[]) => void): Bench {
  const b = vignette.bench;
  const physics = createStubPhysics({ footprint: { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ } });
  const made: Partial<{ patch: Patch; belt: Belt; crew: Crew; revert: Revert }> = {};
  const world = createWorld({
    seed,
    physics,
    ...opts,
    units: [(c) => (made.patch = patchStandin(c)), (c) => (made.belt = beltStandin(c)), (c) => (made.crew = crewStandin(c)), (c) => (made.revert = revertStandin(c)), ...(opts.units ?? [])],
  });
  const log: SimEvent[] = [];
  const run = (n: number): SimEvent[] => {
    const out: SimEvent[] = [];
    for (let i = 0; i < n; i++) {
      world.advance();
      const ev = world.drainEvents();
      out.push(...ev);
      observe?.(ev);
    }
    log.push(...out);
    return out;
  };
  return { world, physics, patch: made.patch as Patch, belt: made.belt as Belt, crew: made.crew as Crew, revert: made.revert as Revert, log, run };
}

// ───────────────────────── scripted actions ─────────────────────────

export const at = (x: number, z: number, yaw = 0, y = 0.4): Pose => ({ p: [x, y, z], q: qyaw(yaw) });
/** A pose off the bench: whatever lands there falls into the return chute. */
export const OFF_BENCH: Pose = { p: [11.5, -3, 0], q: [0, 0, 0, 1] };

/** The visitor throws `id`: picks it up, carries it one step, lets go; it lands at `to` after `flight` steps (scripted). */
export function throwTo(bench: Bench, id: Id, to: Pose, flight = 30): void {
  const { world, physics } = bench;
  const m = world.motion(id);
  if (!m) throw new Error(`no part ${id}`);
  world.dispatch({ type: 'grab', id, grip: m.pose.p });
  world.dispatch({ type: 'carry', target: [m.pose.p[0], m.pose.p[1] + 0.5, m.pose.p[2]] });
  bench.run(1);
  physics.land(id, to, flight);
  world.dispatch({ type: 'release', velocity: [3, 1, 0] });
  bench.run(1);
}

/**
 * Something already moving knocks `id` off its rest: it slides to `to` over `steps` steps (scripted).
 * A real knock happens inside a physics step; run a step before dispatching anything else.
 */
export function knock(bench: Bench, id: Id, to: Pose, steps = 30): void {
  bench.physics.setVelocity(id, [1, 0, 0]);
  bench.physics.land(id, to, steps);
}

/** The visitor catches `id` (perhaps still moving) and sets it down at `to` (tap-then-tap). */
export function catchAndSet(bench: Bench, id: Id, to: Vec3): void {
  const { world } = bench;
  const m = world.motion(id);
  if (!m) throw new Error(`no part ${id}`);
  world.dispatch({ type: 'grab', id, grip: m.pose.p });
  bench.run(1);
  world.dispatch({ type: 'place', at: to });
  bench.run(1);
}

export function turn(bench: Bench, value: number): void {
  bench.world.dispatch({ type: 'turn', id: BELT, value });
  bench.run(1);
}

export function text(bench: Bench, t: Text): SimEvent[] {
  bench.patch.send(t);
  bench.world.dispatch({ type: 'press', id: PHONE });
  return bench.run(1);
}

export function lever(bench: Bench): SimEvent[] {
  bench.world.dispatch({ type: 'undo' });
  return bench.run(1);
}

/** Advance until no part is moving and no window is open (or `max` steps). */
export function settle(bench: Bench, max = 600): void {
  for (let i = 0; i < max; i++) {
    const moving = [...bench.world.parts()].some((p) => {
      const mode = bench.world.mode(p.id);
      return mode === 'chute' || (mode === 'free' && bench.world.motion(p.id)?.awake);
    });
    const windowOpen = bench.world.undoStack().some((t) => t.moving.length > 0);
    if (!moving && !windowOpen && i > 2) return;
    bench.run(1);
  }
}

export const loc = (w: World, id: Id): Location => w.part(id)!.location;
export const restPose = (w: World, id: Id): Pose => {
  const l = loc(w, id);
  if (l.at !== 'rest') throw new Error(`${id} is not at rest: ${JSON.stringify(l)}`);
  return l.pose;
};
