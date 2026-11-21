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
 * Reduced motion (P3, § B10: "the belt and crew start still"): while the
 * bench is still (`SimContext.still`: reduced motion on, the visitor not yet
 * acted) a running belt stops: `running` is written false by `system`, a
 * durable change like any other (its lever shows the middle notch, its lamp
 * goes dark, what rides on it waits where it is). It is not the visitor's,
 * so UNDO never takes it back, and their own use of the lever and the dial
 * is theirs as always: from their first action the belt runs when they
 * switch it on. Full motion switched back on (before their first action or
 * after it) puts it back as it was (`running` true, again by `system`) if
 * nobody has written it since; if they have, it is theirs and stays so.
 *
 * Carrying: a part that comes to rest on the surface is offered to the belt
 * (law 2) and taken in: its location becomes `in` the belt (charged to
 * whoever placed it, § E5 rule 4) and it rides by script, kinematic, at the
 * surface's speed. It can be taken off at any moment (picked up). Running
 * forward it is set down still on the dock's ramp head past the far end
 * (its rest is charged to the same placer, and the dock takes it in that
 * step); running backward it reaches the motor housing and the deflector
 * guides it off the BACK of the belt and sets it down still at the slide's
 * foot: the scene's `offBack` spot, or (S7) the farthest free place along
 * the foot's row (`offBackRow`) it can reach without passing through or
 * landing on anything; with the foot full it waits at the deflector (the
 * belt running under it) and the belt tells, and goes as soon as a place is
 * free. Nothing it sets down is ever set on another part. Undone mid-ride, the ride
 * is cancelled and the part goes back where it was before; it never stops
 * halfway.
 *
 * Order and spacing: riding parts never overlap. Each keeps `gap` to the one
 * ahead of it (they queue behind a part held at an end), the head waits at
 * the far end until the ramp's head is clear of the part ahead by both their
 * lengths, and at the motor end one part at a time goes round the
 * deflector.
 *
 * What size changes: where a part leaves and how close parts queue. A part
 * is set down past the far end when its centre passes it, so a large crate
 * rides a little further past the striker than a small one; at the motor
 * end it turns off when its near face meets the housing; queued parts keep
 * their lengths apart. Speed does not depend on size (a belt carries
 * everything at its own speed: that is what makes the striker a metronome).
 */
import type { BeltView, Cause, Id, Instruction, Intent, Outcome, Part, Pose, Quat, Restore, StationId, Value, Vec3 } from '../types.ts';
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
  /**
   * A part leaves the far end this far past the end (its centre), set down still on the ramp's head (the
   * dock takes it in the same step). Far enough that the engine settling it cannot nudge its centre back
   * over the end into the belt's own mouth.
   */
  exit: 0.15,
  /** Riding parts keep at least this gap between them (units); the head waits at the far end until the ramp is clear by as much. */
  gap: 0.06,
  /** At the motor end the deflector guides a part off the back of the belt onto the bench in this long (seconds), and sets it down still. */
  guide: 0.7,
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
  /** Running backward, parts leave the motor end off the back of the belt and are set down still here (bench point, y the bench top). */
  readonly offBack: Vec3;
  /** The x at which a part riding backward meets the deflector (its near face). */
  readonly deflectAt: number;
  /**
   * S6: bench a part guided off the back must not be set down on (x, z bounds): Fetch's lane, where its
   * wheel goes (a part set down there would be shoved by the next pass). The foot's places inside one are taken.
   */
  readonly keepClear?: readonly { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number }[];
  /**
   * S7: the slide's foot as a row along X at `offBack`'s z, between these world x (the faces of the parts
   * set down in it). Parts guided off the back go to the farthest free place along it (left first, then
   * right, then the spot itself), so a later one never has to pass over or through an earlier one. Without
   * it, the foot is the one spot.
   */
  readonly offBackRow?: { readonly minX: number; readonly maxX: number };
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
  /** Being guided off the back at the motor end: seconds into it, from where, to where, and how (`guided`). */
  guide: { t: number; readonly a: Vec3; readonly b: Vec3; readonly over: boolean } | null;
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
  /** S7: the part held at the deflector because the foot is full (it told once when it began to wait). */
  let waiting: Id | null = null;
  /** P3: this belt was running and the system stopped it because the bench went still (reduced motion). */
  let stoppedForStill = false;

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
    rides.push({ id: part, job, x, y: at.y, z, q: at.q, ex, ez, guide: null });
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

  /** A part's radius on the bench plane (its box's larger half extent across). */
  const radius = (part: Id): number => {
    const h = ctx.halfExtents(part) ?? [0.3, 0.3, 0.3];
    return Math.max(h[0], h[2]);
  };

  /**
   * How far the head `r` may go toward the far end: while anything not riding the belt (the one ahead
   * rolling up the ramp, or anything lying there) is within the two parts' reach of the hand-off point, it
   * waits at the end, and never closer to such a part than the gap. So a part never enters the ramp before
   * the one ahead has cleared its length.
   */
  function headLimit(r: Ride): number {
    const hx = spec.to + T.exit;
    let limit = Infinity;
    for (const other of ctx.parts()) {
      if (other === r.id || rides.some((x) => x.id === other && !x.guide)) continue;
      const m = ctx.mode(other);
      if (m === 'gone' || m === 'chute' || m === 'held') continue;
      const p = ctx.pose(other);
      if (!p || p.p[1] > spec.top + 1.6 || p.p[0] < spec.to - 0.05) continue;
      const ro = radius(other);
      if (Math.abs(p.p[2] - spec.z) < ro + spec.halfWidth) limit = Math.min(limit, p.p[0] - ro - T.gap - r.ex);
      if (Math.hypot(p.p[0] - hx, p.p[2] - spec.z) < ro + r.ex + T.gap) limit = Math.min(limit, spec.to);
    }
    return limit;
  }

  /**
   * Where a guided part is along its way off the back, `u` 0..1: off the back first (toward -Z), then down
   * the slide to its place, descending as it goes; or (`over`, when that way would touch a part already at
   * the foot) along the foot at the slide's height past what is there, and only then down into its place.
   */
  function guided(a: Vec3, b: Vec3, u: number, over: boolean): Vec3 {
    const ease = (v: number): number => v * v * (3 - 2 * v);
    const span = (u0: number, u1: number): number => ease(Math.min(1, Math.max(0, (u - u0) / (u1 - u0))));
    const zu = over ? span(0, 0.4) : span(0, 0.5);
    const xu = over ? span(0.35, 0.75) : span(0.5, 1);
    const yu = over ? span(0.75, 1) : xu;
    return [a[0] + (b[0] - a[0]) * xu, a[1] + (b[1] - a[1]) * yu, a[2] + (b[2] - a[2]) * zu];
  }

  /**
   * Where a part guided off the back is set down (S7): the farthest free place along the slide's foot it
   * can reach (the row's left end first, then its right end, then the scene's spot), its whole way there
   * clear of every other part and of `keepClear` (Fetch's lane); null when there is none (the foot is
   * full: it waits at the deflector).
   */
  function offBackFor(r: Ride): { readonly b: Vec3; readonly over: boolean } | null {
    const [x0, y0, z0] = spec.offBack;
    const h = r.y - spec.top;
    const restY = y0 + h + 0.005;
    const a: Vec3 = [spec.deflectAt + r.ex, r.y, r.z];
    const g = T.gap / 2;
    // everything it could meet: other parts in the world (not this one), as boxes
    const others: { x: number; y: number; z: number; ex: number; ey: number; ez: number }[] = [];
    for (const other of ctx.parts()) {
      if (other === r.id || rides.some((x) => x.id === other && !x.guide)) continue; // the belt's own queue keeps its gaps
      const m = ctx.mode(other);
      const p = ctx.pose(other);
      const e = ctx.halfExtents(other);
      if (!p || !e || m === 'gone' || m === 'chute' || m === undefined) continue;
      const rr = radius(other);
      others.push({ x: p.p[0], y: p.p[1], z: p.p[2], ex: rr, ey: e[1], ez: rr });
    }
    const clearAt = (p: Vec3): boolean =>
      others.every((o) => Math.abs(p[0] - o.x) >= r.ex + o.ex + g || Math.abs(p[2] - o.z) >= r.ez + o.ez + g || Math.abs(p[1] - o.y) >= h + o.ey + 0.01) &&
      !(spec.keepClear ?? []).some((k) => p[1] - h < 0.05 && p[0] + r.ex + g > k.minX && p[0] - r.ex - g < k.maxX && p[2] + r.ez + g > k.minZ && p[2] - r.ez - g < k.maxZ);
    const clearWay = (b: Vec3, over: boolean): boolean => {
      for (let k = 1; k <= 32; k++) if (!clearAt(guided(a, b, k / 32, over))) return false;
      return true;
    };
    // the row's ends for this part, and how far it can slide each way before it meets something resting in the row
    const row = spec.offBackRow ?? { minX: x0 - r.ex, maxX: x0 + r.ex };
    let lo = row.minX + r.ex;
    let hi = row.maxX - r.ex;
    // the row ends where it meets a keep-clear band (Fetch's lane)
    for (const k of spec.keepClear ?? []) {
      if (z0 + r.ez + g <= k.minZ || z0 - r.ez - g >= k.maxZ) continue;
      if (k.minX >= a[0]) hi = Math.min(hi, k.minX - T.gap - r.ex);
      else if (k.maxX <= a[0]) lo = Math.max(lo, k.maxX + T.gap + r.ex);
    }
    for (const o of others) {
      if (Math.abs(o.z - z0) >= r.ez + o.ez + g || o.y - o.ey > restY + h) continue;
      // set down a whole gap from its neighbour; the way there need only clear things by half of one
      if (o.x <= a[0]) lo = Math.max(lo, Math.min(o.x + o.ex + T.gap + r.ex, a[0]));
      else hi = Math.min(hi, Math.max(o.x - o.ex - T.gap - r.ex, a[0]));
    }
    const places = [lo, hi, x0].filter((x, i, all) => x >= lo - 1e-9 && x <= hi + 1e-9 && all.indexOf(x) === i);
    for (const x of places) {
      const b: Vec3 = [x, restY, z0];
      if (clearWay(b, false)) return { b, over: false };
      if (clearWay(b, true)) return { b, over: true };
    }
    return null;
  }

  /** One step of carrying: in the order they lie along the way they go, each keeps its gap to the one ahead. */
  function carry(): void {
    const fwd = surface >= 0;
    const order = rides.filter((r) => !r.guide).sort((a, b) => (fwd ? b.x - a.x : a.x - b.x));
    const guiding = rides.some((r) => r.guide);
    let ahead: Ride | null = null;
    for (const r of order) {
      let next = r.x + surface * dt;
      if (fwd) {
        if (ahead) next = Math.min(next, ahead.x - ahead.ex - T.gap - r.ex);
        else next = Math.min(next, headLimit(r));
        next = Math.max(next, r.x); // held, it waits where it is; it is never pushed backward
      } else {
        if (ahead) next = Math.max(next, ahead.x + ahead.ex + T.gap + r.ex);
        else if (guiding) next = Math.max(next, spec.deflectAt + r.ex);
        next = Math.min(next, r.x);
      }
      if (fwd && !ahead && surface > 0 && (ctx.pose(r.id)?.p[0] ?? r.x) > spec.to + T.exit) {
        // the far end (judged where the body is: the last drive has landed): set down on the ramp's head; its rest is the placer's (rule 4)
        end(r);
        ctx.release(r.id, [0, 0, 0], [0, 0, 0], ctx.history.chargeMachine(r.id));
        continue;
      }
      if (!fwd && !ahead && !guiding && next - r.ex <= spec.deflectAt) {
        // the motor end: the deflector guides it off the back of the belt, down the slide, to a free place
        // at the foot; with the foot full it waits here (the belt runs on under it) and the belt tells, once
        next = spec.deflectAt + r.ex;
        const to = offBackFor(r);
        if (to) {
          r.guide = { t: 0, a: [next, r.y, r.z], b: to.b, over: to.over };
          if (waiting === r.id) waiting = null;
        } else if (waiting !== r.id) {
          waiting = r.id;
          unit.tell();
        }
      }
      r.x = next;
      ctx.drive(r.id, { p: [r.x, r.y, r.z], q: r.q });
      ahead = r;
    }
    for (const r of rides.filter((x) => x.guide)) {
      const g = r.guide as NonNullable<Ride['guide']>;
      if (g.t >= T.guide) {
        // the last drive has landed: set it down still, the placer's
        end(r);
        ctx.release(r.id, [0, 0, 0], [0, 0, 0], ctx.history.chargeMachine(r.id));
        continue;
      }
      g.t = Math.min(T.guide, g.t + dt);
      // along the deflector off the back first (toward -Z), then down the slide and along the foot to its place
      const p = guided(g.a, g.b, g.t / T.guide, g.over);
      r.x = p[0];
      r.z = p[2];
      ctx.drive(r.id, { p, q: r.q });
    }
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
      lamp.used(part.id);
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
      stoppedForStill = false;
      lamp.reset();
      beat.reset();
      lurchUntil = -1;
      waiting = null;
    },

    pre() {
      // P3 (§ B10): a still bench's belt is stopped (by the system); full motion again puts it back if it is still the system's
      if (!ctx.bracketed) {
        if (ctx.still && running()) {
          ctx.commit([{ target: id, field: BELT_FIELDS.running, after: false }], 'system');
          stoppedForStill = true;
        } else if (stoppedForStill && !ctx.reducedMotion) {
          stoppedForStill = false;
          if (!running() && ctx.writer(id, BELT_FIELDS.running) === 'system') ctx.commit([{ target: id, field: BELT_FIELDS.running, after: true }], 'system');
        }
      }
      surface += (wanted() - surface) * (1 - Math.exp(-T.ease * dt));
      if (Math.abs(surface - wanted()) < 1e-4) surface = wanted();
      const shown = ctx.clock.step < lurchUntil ? T.lurch.speed * (beat.view()?.level ?? 1) : surface;
      phase += shown * dt;
      if (ctx.bracketed) return; // a rung plays: nothing rides (the lurch is the surface's alone)
      carry();
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
        waiting: waiting !== null && rides.some((r) => r.id === waiting && !r.guide) ? waiting : null,
      };
    },
  };
  return unit;
}
