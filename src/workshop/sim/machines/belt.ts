/**
 * The belt (REWRITE.md § B1: "its whole surface is its mouth; carries it,
 * at the speed and direction set; reads size; writes where it is"; § D 5;
 * § B2 X2: "the belt's speed dial is the tempo and its direction lever plays
 * the line backwards"). The worked example for machine authors: read
 * `sim/machine.ts` beside it.
 *
 * Durable settings (target `belt`), each with a handle and a text path:
 * - `speed`: the dial's detent, 1..5 (`BELT_TUNING.speeds`). Handle: `turn`
 *   the dial (`belt-dial`, value 0..1 snaps to the nearest detent), or
 *   `press` it (one detent up, round to the slowest after the fastest).
 * - `direction`: `forward` (+X, toward the dock) or `backward`.
 * - `running`: false with the lever in its middle notch. The lever
 *   (`belt-lever`) is a three-way switch, backward / stop / forward: `turn`
 *   it (value under 1/3, the middle third, over 2/3), or `press` it to go
 *   forward → stop → backward → stop → forward.
 * - `instruct({ verb: 'belt.set', args: { speed: ±1, running, direction } })`
 *   for texts through the BELT jack.
 *
 * Carrying: a part that comes to rest on the surface is offered to the belt
 * (law 2) and taken in: its location becomes `in` the belt (charged to
 * whoever placed it, § E5 rule 4) and it rides by script, kinematic, at the
 * surface's speed. It can be taken off at any moment (picked up). Running
 * forward it leaves the far end onto the dock's ramp (handed to physics,
 * its next rest charged to the same placer); running backward it reaches the
 * motor housing and is pushed off the front of the belt onto the bench.
 * Undone mid-ride, the ride is cancelled and the part goes back where it
 * was before; it never stops halfway.
 *
 * What size changes: where a part leaves. A part tips off the far end when
 * its centre passes the end roller, so a large crate rides a little further
 * past the striker before it drops than a small one; at the motor end a part
 * is pushed off when its near face meets the housing. Speed does not depend
 * on size (a belt carries everything at its own speed: that is what makes
 * the striker a metronome).
 */
import type { BeltView, Cause, Id, Instruction, Intent, Outcome, Part, Pose, Quat, Restore, StationId, Value } from '../types.ts';
import type { Job } from '../history.ts';
import type { LostReason, MachineUnit, SimContext } from '../context.ts';
import type { UnitFactory } from '../scene.ts';
import { HZ } from '../clock.ts';
import { rotate } from '../math.ts';
import { Beat, CHANGED_SINCE, Lamp, OK, gesture, handleTxn } from '../machine.ts';

/** Tune here. Speeds are units per second of surface. */
export const BELT_TUNING = {
  /** The dial's detents, slowest first. At the middle one a crate dropped at the motor end reaches the striker in about six seconds (§ E0). */
  speeds: [0.6, 1.0, 1.5, 2.2, 3.0] as readonly number[],
  /** How the visit begins (§ B3: "the belt is moving"). */
  start: { speed: 3, direction: 'forward' as const, running: true },
  /** The surface follows a change at this rate (1/s): 70% of the way in 100 ms (§ E0). */
  ease: 12,
  /** A misfire's lurch: the surface is kicked back to this speed (per level) for this long. */
  lurch: { speed: -1.6, seconds: 0.3 },
  /** A part leaves the far end this far past the end (its centre). */
  exit: 0.02,
  /** At the motor end parts are pushed off the front at this speed, and let go with this much of it. */
  shunt: { speed: 1.2, letGo: 0.5 },
} as const;

export const BELT_FIELDS = { speed: 'speed', direction: 'direction', running: 'running' } as const;

export interface BeltSpec {
  readonly id: Id;
  readonly station: StationId;
  /** Content id of its name. */
  readonly name: string;
  /** Its mouth (the whole carrying surface), declared in the scene. */
  readonly mouth: Id;
  /** The carrying surface: from the motor end `from` to the far end `to` along X, its top, its centre line and half width. */
  readonly from: number;
  readonly to: number;
  readonly top: number;
  readonly z: number;
  readonly halfWidth: number;
  readonly dial: { readonly id: Id; readonly name: string };
  readonly lever: { readonly id: Id; readonly name: string };
}

export interface BeltUnit extends MachineUnit {
  view(): BeltView;
}

interface Ride {
  readonly id: Id;
  readonly job: Job;
  x: number;
  readonly y: number;
  z: number;
  readonly q: Quat;
  /** Half its extent along X and Z (its box, turned as it lies). */
  readonly ex: number;
  readonly ez: number;
  /** Being pushed off the front at the motor end. */
  shunt: boolean;
}

const isDetent = (n: number) => (v: Value) => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= n;

export function belt(spec: BeltSpec): UnitFactory {
  return (ctx) => createBelt(ctx, spec);
}

export function createBelt(ctx: SimContext, spec: BeltSpec): BeltUnit {
  const T = BELT_TUNING;
  const N = T.speeds.length;
  const id = spec.id;
  ctx.defineSetting(id, BELT_FIELDS.speed, T.start.speed, isDetent(N));
  ctx.defineSetting(id, BELT_FIELDS.direction, T.start.direction, (v) => v === 'forward' || v === 'backward');
  ctx.defineSetting(id, BELT_FIELDS.running, T.start.running, (v) => typeof v === 'boolean');

  const lamp = new Lamp(ctx);
  const beat = new Beat(ctx);
  const dialGesture = gesture();
  const leverGesture = gesture();
  const rides: Ride[] = [];
  /** Where a part was riding when the visitor took it off: an undo that puts it back `in` puts it there. */
  const takenAt = new Map<Id, { x: number; y: number; z: number; q: Quat }>();
  const dt = 1 / HZ;
  const speedOf = (): number => ctx.setting(id, BELT_FIELDS.speed) as number;
  const forward = (): boolean => ctx.setting(id, BELT_FIELDS.direction) === 'forward';
  const running = (): boolean => ctx.setting(id, BELT_FIELDS.running) === true;
  /** The speed the settings ask for, signed along +X. */
  const wanted = (): number => (running() ? (T.speeds[speedOf() - 1] ?? 0) * (forward() ? 1 : -1) : 0);
  let surface = wanted();
  let phase = 0;
  let lurchUntil = -1;

  const handle = (hid: Id, name: string, affordance: 'turn' | 'slide') =>
    ctx.register({
      id: hid,
      station: spec.station,
      name,
      affordances: [affordance, 'press'],
      tell: () => {
        lamp.tell();
        ctx.emit({ type: 'tell', id: hid });
      },
      misfire: (level) => ctx.emit({ type: 'misfire', id: hid, level }),
    });
  handle(spec.dial.id, spec.dial.name, 'turn');
  handle(spec.lever.id, spec.lever.name, 'slide');

  /** A box's half extent along world X and Z, turned by `q`. */
  function extents(part: Id, q: Quat): { ex: number; ez: number } {
    const h = ctx.halfExtents(part) ?? [0.3, 0.3, 0.3];
    let ex = 0;
    let ez = 0;
    for (let k = 0; k < 3; k++) {
      const axis = rotate(q, [k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0]);
      ex += Math.abs(axis[0]) * (h[k] as number);
      ez += Math.abs(axis[2]) * (h[k] as number);
    }
    return { ex, ez };
  }

  function seat(part: Id, at: { x: number; y: number; z: number; q: Quat }, job: Job): void {
    const { ex, ez } = extents(part, at.q);
    const x = Math.min(spec.to, Math.max(spec.from + ex, at.x));
    const z = Math.min(spec.z + spec.halfWidth, Math.max(spec.z - spec.halfWidth, at.z));
    rides.push({ id: part, job, x, y: at.y, z, q: at.q, ex, ez, shunt: false });
    ctx.drive(part, { p: [x, at.y, z], q: at.q }, true);
  }

  function end(r: Ride): void {
    const i = rides.indexOf(r);
    if (i >= 0) rides.splice(i, 1);
    r.job.done();
  }

  /** Rule 10 (the job's abort) and `Machine.abort`: drop the ride; the part is let go where it is (an undo then puts it back). */
  function drop(part: Id): void {
    const r = rides.find((x) => x.id === part);
    if (!r) return;
    rides.splice(rides.indexOf(r), 1);
    if (ctx.mode(part) === 'machine') ctx.release(part, [0, 0, 0], [0, 0, 0], null);
  }

  function work(part: Id, cause: Cause): Job {
    return ctx.history.work(cause, id, () => drop(part));
  }

  /** Commit settings under the handle's gesture; nothing (and no transaction) if nothing changes. */
  function set(hid: Id, g: ReturnType<typeof gesture>, changes: Record<string, Value>): boolean {
    const list = Object.entries(changes).filter(([f, v]) => ctx.setting(id, f) !== v);
    lamp.used();
    if (list.length === 0) return true;
    const t = handleTxn(ctx, g, 'turn', hid);
    ctx.commit(
      list.map(([field, after]) => ({ target: id, field, after })),
      t,
    );
    return true;
  }

  const unit: BeltUnit = {
    id,
    station: spec.station,
    name: spec.name,
    affordances: [],
    tell() {
      lamp.tell();
      ctx.emit({ type: 'tell', id });
    },
    misfire(level) {
      beat.hit(level);
      lurchUntil = ctx.clock.step + Math.round(T.lurch.seconds * HZ);
      ctx.emit({ type: 'misfire', id, level });
    },

    intent(intent: Intent): boolean {
      if (ctx.bracketed) return false;
      if (intent.type === 'turn' && intent.id === spec.dial.id) {
        const v = Math.min(1, Math.max(0, intent.value));
        const detent = 1 + Math.round(v * (N - 1));
        ctx.emit({ type: 'handle.worked', id: spec.dial.id, value: (detent - 1) / (N - 1) });
        return set(spec.dial.id, dialGesture, { [BELT_FIELDS.speed]: detent });
      }
      if (intent.type === 'press' && intent.id === spec.dial.id) {
        const detent = (speedOf() % N) + 1;
        ctx.emit({ type: 'handle.worked', id: spec.dial.id, value: (detent - 1) / (N - 1) });
        return set(spec.dial.id, gesture(), { [BELT_FIELDS.speed]: detent });
      }
      if ((intent.type === 'turn' || intent.type === 'press') && intent.id === spec.lever.id) {
        let to: { running: boolean; direction?: 'forward' | 'backward' };
        if (intent.type === 'turn') {
          const v = Math.min(1, Math.max(0, intent.value));
          to = v < 1 / 3 ? { running: true, direction: 'backward' } : v <= 2 / 3 ? { running: false } : { running: true, direction: 'forward' };
        } else to = running() ? { running: false } : { running: true, direction: forward() ? 'backward' : 'forward' };
        const changes: Record<string, Value> = { [BELT_FIELDS.running]: to.running };
        if (to.direction) changes[BELT_FIELDS.direction] = to.direction;
        ctx.emit({ type: 'handle.worked', id: spec.lever.id, value: !to.running ? 0.5 : (to.direction ?? (forward() ? 'forward' : 'backward')) === 'forward' ? 1 : 0 });
        return set(spec.lever.id, intent.type === 'press' ? gesture() : leverGesture, changes);
      }
      return false;
    },

    instruct(cmd: Instruction, cause: Cause): Outcome {
      if (cmd.verb !== 'belt.set') return { ok: false, wanted: 'help.belt' };
      const a = cmd.args;
      const changes: { target: Id; field: string; after: Value }[] = [];
      if (a['speed'] === 1 || a['speed'] === -1) {
        const next = speedOf() + (a['speed'] as number);
        if (next > N) return { ok: false, wanted: 'belt.fastest' };
        if (next < 1) return { ok: false, wanted: 'belt.slowest' };
        changes.push({ target: id, field: BELT_FIELDS.speed, after: next });
      }
      if (typeof a['running'] === 'boolean') changes.push({ target: id, field: BELT_FIELDS.running, after: a['running'] });
      const d = a['direction'];
      if (d === 'forward' || d === 'backward') changes.push({ target: id, field: BELT_FIELDS.direction, after: d });
      else if (d === 'flip') changes.push({ target: id, field: BELT_FIELDS.direction, after: forward() ? 'backward' : 'forward' });
      if (changes.length === 0) return OK;
      lamp.used();
      const r = ctx.commit(changes, cause);
      return r.refused.length > 0 ? { ok: false, wanted: CHANGED_SINCE } : OK;
    },

    accept(part: Part, cause: Cause, mouth: Id): Outcome {
      const pose = ctx.pose(part.id);
      if (!pose) return OK;
      const r = ctx.commit([{ target: part.id, field: 'location', after: { at: 'in', station: spec.station, mouth } }], cause);
      if (r.refused.length > 0) return { ok: false, wanted: CHANGED_SINCE };
      if (!ctx.take(part.id, id)) return OK;
      lamp.used();
      takenAt.delete(part.id);
      seat(part.id, { x: pose.p[0], y: pose.p[1], z: pose.p[2], q: pose.q }, work(part.id, cause));
      return OK;
    },

    abort(cause: Cause) {
      for (const r of [...rides]) if (r.job.cause === cause) {
        drop(r.id);
        r.job.done();
      }
    },

    lost(part: Id, why: LostReason) {
      const r = rides.find((x) => x.id === part);
      if (!r) return;
      if (why === 'grab') takenAt.set(part, { x: r.x, y: r.y, z: r.z, q: r.q });
      end(r);
    },

    restored(restores: readonly Restore[]) {
      for (const rs of restores) {
        if (rs.field !== 'location') continue;
        const to = rs.to as { at: string; mouth?: Id };
        if (to.at !== 'in' || to.mouth !== spec.mouth) {
          takenAt.delete(rs.target);
          continue;
        }
        // put back `in` the belt: back where it was taken off, and its ride is the placer's again (rule 4)
        if (rides.some((x) => x.id === rs.target) || !ctx.take(rs.target, id)) continue;
        const pose = ctx.pose(rs.target) as Pose;
        const at = takenAt.get(rs.target) ?? { x: pose.p[0], y: spec.top + (ctx.halfExtents(rs.target)?.[1] ?? 0.3), z: pose.p[2], q: pose.q };
        takenAt.delete(rs.target);
        seat(rs.target, at, work(rs.target, ctx.history.chargeMachine(rs.target)));
      }
    },

    reset() {
      for (const r of [...rides]) end(r);
      takenAt.clear();
      lamp.reset();
      beat.reset();
      lurchUntil = -1;
    },

    pre() {
      surface += (wanted() - surface) * (1 - Math.exp(-T.ease * dt));
      if (Math.abs(surface - wanted()) < 1e-4) surface = wanted();
      const shown = ctx.clock.step < lurchUntil ? T.lurch.speed * (beat.view()?.level ?? 1) : surface;
      phase += shown * dt;
      if (ctx.bracketed) return; // a rung plays: nothing rides (the lurch is the surface's alone)
      for (const r of [...rides]) {
        if (r.shunt) {
          r.z += T.shunt.speed * dt;
          ctx.drive(r.id, { p: [r.x, r.y, r.z], q: r.q });
          if (r.z > spec.z + spec.halfWidth + 0.02) {
            // off the front edge at the motor end: let it drop onto the bench, the placer's still
            end(r);
            ctx.release(r.id, [0, 0, T.shunt.speed * T.shunt.letGo], [0, 0, 0], ctx.history.chargeMachine(r.id));
          }
          continue;
        }
        r.x += surface * dt;
        if (surface > 0 && r.x > spec.to + T.exit) {
          // the far end: onto the dock's ramp, moving; where it rests is the placer's (rule 4)
          end(r);
          ctx.release(r.id, [surface, 0, 0], [0, 0, 0], ctx.history.chargeMachine(r.id));
          continue;
        }
        if (surface < 0 && r.x - r.ex <= spec.from) {
          r.x = spec.from + r.ex;
          r.shunt = true;
        }
        ctx.drive(r.id, { p: [r.x, r.y, r.z], q: r.q });
      }
    },

    view(): BeltView {
      return {
        kind: 'belt',
        id,
        station: spec.station,
        lamp: lamp.state(running()),
        misfire: beat.view(),
        speed: speedOf(),
        detents: N,
        direction: forward() ? 'forward' : 'backward',
        running: running(),
        surface: ctx.clock.step < lurchUntil ? T.lurch.speed * (beat.view()?.level ?? 1) : surface,
        phase,
        riding: [...rides].sort((a, b) => a.x - b.x).map((r) => r.id),
      };
    },
  };
  return unit;
}
