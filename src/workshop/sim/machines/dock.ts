/**
 * The dock (REWRITE.md § B1: "the roll-up door; ships it: out, with a bell;
 * reads nothing; writes marks, where it is"; § D 7; § B2 X3; § E5 worked
 * example "puts a tool on the belt; it rides, sounds, ships").
 *
 * Whatever comes to rest in its mouth (the roller ramp from the belt's end
 * to the door, and the bench just before the door) is taken in: its
 * location becomes `in` the dock, charged to whoever placed it (§ E5 rule
 * 4), and the dock rolls it up to the door, opens the door, rolls it
 * through and ships it: location `shipped` and a `mark.shipped` added, both
 * in one commit under the same cause, then the bell (`shipped`). So the
 * placer's transaction holds one location entry: before = where it rested
 * before it was placed.
 *
 * After shipping:
 * - a plain crate (kind `crate`) stays shipped, and a fresh crate is set on
 *   the crate stack in its place, as `system` (a spare from behind the
 *   door; failing that, the longest-shipped crate that can no longer come
 *   back, or, last of all, the longest-shipped crate, put away first so no
 *   history points at it: § E5 rule 14);
 * - a tool comes back up the return chute a few seconds later with a
 *   `mark.return` (RETURN TO SENDER), charged to whoever shipped it;
 * - a robot does the same "by itself, written by crew" (§ E5 worked example
 *   "ships Fetch").
 *
 * Undo brings a shipment back in through the door: the world restores the
 * location and puts the body back; `restored` here opens the door and says
 * `returned` (how: `door`), and cancels a pending return to sender.
 */
import type { Cause, DockView, Id, Intent, Location, Outcome, Part, PartKind, Pose, Restore, StationId, Vec3 } from '../types.ts';
import type { Job } from '../history.ts';
import type { MachineUnit, SimContext } from '../context.ts';
import type { UnitFactory } from '../scene.ts';
import { HZ, steps } from '../clock.ts';
import { qmul, qyaw } from '../math.ts';
import { rampAt, rampDoor, rampLength, rampNearest } from '../ramp.ts';
import type { RampSpec } from '../ramp.ts';
import { Beat, CHANGED_SINCE, Lamp, OK } from '../machine.ts';

/** Content ids of the marks it writes (the words are in src/content/line.json). */
/** (I1 R1) The id of a dock's hand bell, from the dock's id. */
export const bellOf = (dock: Id): Id => `${dock}-bell`;

export const MARK_SHIPPED = 'mark.shipped';
export const MARK_RETURN = 'mark.return';

/** Tune here. Seconds and units per second. */
export const DOCK_TUNING = {
  /** The door's travel, open and shut. */
  doorOpen: 0.4,
  doorClose: 0.55,
  /** The rollers carry a part to the door and through it at this speed (above the belt's middle speed, so a run off the belt does not pile up). */
  roll: 2.2,
  /** Parts on the ramp keep at least this gap (units). */
  gap: 0.06,
  /** A part waits at the threshold until the door is this open. */
  clear: 0.85,
  /** How far past the threshold a part goes before it is gone. */
  depth: 0.8,
  /** The door stays open this long after the last part goes through. */
  linger: 0.25,
  /** A plain crate is replaced on the stack this long after it ships. */
  restockAfter: 1.4,
  /** A tool or a robot comes back up the chute this long after it ships. */
  returnAfter: { tool: 6, robot: 10 } as Readonly<Record<Exclude<PartKind, 'crate'>, number>>,
  /** A part taken in off the centre line eases onto it over this much of the ramp. */
  settleOn: 0.4,
  /** A misfire jumps the door open for this long (per level); an undo's return opens it for this long. */
  misfireOpen: 0.45,
  unshipOpen: 0.9,
  /** A restocked crate is set down this far above whatever is on the stack (a hair: dropped from higher, it toppled the stack). */
  restockDrop: 0.02,
} as const;

export interface DockSpec {
  readonly id: Id;
  readonly station: StationId;
  readonly name: string;
  readonly mouth: Id;
  /** The roller ramp from the belt's far end to the door's sill (sim/ramp.ts); the door is at its end. */
  readonly ramp: RampSpec;
  /** The crate stack's ground point (x, z): fresh crates are set on it. */
  readonly stack: readonly [number, number];
  /**
   * The speed of whatever feeds the ramp (the belt's surface, read from the world's settings): the
   * rollers never run slower than it, so a run off a fast belt does not close up on the ramp.
   */
  readonly feed?: (ctx: SimContext) => number;
  /**
   * S6: the stack holds at most this many crates: a crate that ships while it is full is not replaced (the
   * spare stays behind the door), so a fourth crate dropped on a tower of three never topples it.
   */
  readonly stackMax?: number;
}

export interface DockUnit extends MachineUnit {
  view(): DockView;
}

interface Shipment {
  readonly id: Id;
  readonly job: Job;
  /** Where along the ramp, and how far past the sill. */
  s: number;
  inside: number;
  /** Where it was taken in: along the ramp, its height over the rollers, its offset from the centre line (eased out), its turn and the ramp's heading there. */
  readonly s0: number;
  readonly h: number;
  readonly off: readonly [number, number];
  readonly q0: Pose['q'];
  readonly yaw0: number;
}

interface Return {
  readonly id: Id;
  readonly at: number;
  /** The tool's: the shipper's transaction (cancelled by its undo). Null for a robot (it comes back as crew). */
  readonly job: Job | null;
}

export function dock(spec: DockSpec): UnitFactory {
  return (ctx) => createDock(ctx, spec);
}

export function createDock(ctx: SimContext, spec: DockSpec): DockUnit {
  const T = DOCK_TUNING;
  const lamp = new Lamp(ctx);
  const beat = new Beat(ctx);
  const rng = ctx.rng(`dock:${spec.id}`);
  const queue: Shipment[] = [];
  let returns: Return[] = [];
  let restocks: { at: number; size: Part['size'] }[] = [];
  /** Crates in the order they shipped (oldest first): restocking takes from the front. */
  let shippedOrder: Id[] = [];
  let door = 0;
  let doorTarget = 0;
  /** The door is held open until this step (a misfire, an undo's return, the last part's linger). */
  let openUntil = -1;
  const dt = 1 / HZ;
  const fresh = new Map(ctx.scene.parts.map((p) => [p.id, { colour: p.colour, label: p.label, marks: p.marks ?? [], contents: p.contents ?? null }]));

  const R = spec.ramp;
  const LEN = rampLength(R);
  const gate = rampDoor(R);
  const headingOf = (s: number): number => {
    const a = rampAt(R, s);
    return Math.atan2(-a.hz, a.hx);
  };
  /** Where a shipment's body is now: on the rollers, turning with the ramp, then through the door. */
  function poseOf(x: Shipment): Pose {
    const a = rampAt(R, x.s);
    const k = Math.max(0, 1 - (x.s - x.s0) / T.settleOn);
    const q = qmul(qyaw(headingOf(x.s) - x.yaw0), x.q0);
    return { p: [a.p[0] + x.off[0] * k + gate.inward[0] * x.inside, a.p[1] + x.h, a.p[2] + x.off[1] * k + gate.inward[2] * x.inside], q };
  }
  const exitPose = (x: Shipment): Pose => ({ p: [gate.sill[0], gate.sill[1] + x.h, gate.sill[2]], q: poseOf(x).q });
  const isTxn = (w: string | undefined): boolean => w !== undefined && w !== 'crew' && w !== 'system' && w !== 'settled';

  function drop(part: Id): void {
    const i = queue.findIndex((s) => s.id === part);
    if (i < 0) return;
    queue.splice(i, 1);
    if (ctx.mode(part) === 'machine') ctx.release(part, [0, 0, 0], [0, 0, 0], null);
  }

  function take(part: Id, cause: Cause): void {
    const pose = ctx.pose(part) as Pose;
    const job = ctx.history.work(cause, spec.id, () => drop(part));
    const s0 = rampNearest(R, pose.p[0], pose.p[2]);
    const a = rampAt(R, s0);
    const h = Math.max(pose.p[1] - a.p[1], ctx.halfExtents(part)?.[1] ?? 0.2);
    queue.push({ id: part, job, s: s0, inside: 0, s0, h, off: [pose.p[0] - a.p[0], pose.p[2] - a.p[2]], q0: pose.q, yaw0: headingOf(s0) });
    lamp.used();
  }

  function ship(s: Shipment): void {
    const part = ctx.part(s.id) as Part;
    const out = s.job.commit([
      { target: s.id, field: 'location', after: { at: 'shipped' } },
      { target: s.id, field: 'marks', after: [...part.marks.filter((m) => m !== MARK_SHIPPED), MARK_SHIPPED] },
    ]);
    s.job.done();
    queue.splice(queue.indexOf(s), 1);
    if (out.refused.some((c) => c.field === 'location')) {
      // rule 7: someone newer wrote where it is; it does not ship (it is let go at the door)
      ctx.release(s.id, [0, 0, 0], [0, 0, 0], null);
      return;
    }
    ctx.stow(s.id, exitPose(s));
    ctx.emit({ type: 'shipped', id: spec.id, part: s.id });
    openUntil = Math.max(openUntil, ctx.clock.step + steps(T.linger));
    if (part.kind === 'crate') {
      shippedOrder = [...shippedOrder.filter((x) => x !== s.id), s.id];
      restocks.push({ at: ctx.clock.step + steps(T.restockAfter), size: part.size });
      return;
    }
    const at = ctx.clock.step + steps(T.returnAfter[part.kind]);
    if (part.kind === 'robot') returns.push({ id: s.id, at, job: null });
    else returns.push({ id: s.id, at, job: ctx.history.work(ctx.history.chargeMachine(s.id), spec.id, () => (returns = returns.filter((r) => r.id !== s.id))) });
  }

  /** RETURN TO SENDER: the mark, then up the chute; its rest is the same cause's. */
  function sendBack(r: Return): void {
    const part = ctx.part(r.id);
    if (!part || part.location.at !== 'shipped' || ctx.mode(r.id) !== 'gone') {
      r.job?.done();
      return;
    }
    const marks = { target: r.id, field: 'marks', after: [...part.marks.filter((m) => m !== MARK_RETURN), MARK_RETURN] };
    let cause: Cause | null;
    if (r.job) {
      r.job.commit([marks]);
      cause = r.job.cause;
      r.job.done();
    } else {
      ctx.commit([marks], 'crew');
      cause = 'crew';
    }
    ctx.toChute(r.id, cause);
    ctx.emit({ type: 'returned', id: spec.id, part: r.id, how: 'chute' });
  }

  /** A fresh crate onto the stack, as the system. */
  /**
   * Put a crate back on the stack. Answers false when it must wait: while the crew has a crate in its
   * hands at the stack (lifting the top one, or setting one down), the stack cannot be counted or
   * measured (a crate in the crew's hands is neither free nor held), and a crate set down then lands
   * inside the one being lifted.
   */
  function restock(size: Part['size']): boolean {
    {
      const [sx, sz] = spec.stack;
      const inHand = ctx.parts().some((id) => {
        const p = ctx.pose(id)?.p;
        return ctx.part(id)?.kind === 'crate' && ctx.mode(id) === 'crew' && !!p && Math.hypot(p[0] - sx, p[2] - sz) <= 0.55;
      });
      if (inHand) return false;
    }
    if (spec.stackMax !== undefined) {
      const [sx, sz] = spec.stack;
      const standing = ctx.parts().filter((id) => {
        const m = ctx.mode(id);
        const p = ctx.pose(id)?.p;
        return ctx.part(id)?.kind === 'crate' && (m === 'free' || m === 'held') && !!p && Math.hypot(p[0] - sx, p[2] - sz) <= 0.55;
      }).length;
      if (standing >= spec.stackMax) return true;
    }
    const crates = ctx.parts().filter((id) => ctx.part(id)?.kind === 'crate' && ctx.part(id)?.location.at === 'shipped' && ctx.mode(id) === 'gone');
    const free = crates.filter((id) => !isTxn(ctx.writer(id, 'location')));
    // (S5 round 2) the same size first, a spare or else the longest shipped, so the stack is put back as it was
    const sameSize = (id: Id): boolean => ctx.part(id)?.size === size;
    const spare = free.find((id) => sameSize(id) && !shippedOrder.includes(id)) ?? shippedOrder.find((id) => free.includes(id) && sameSize(id)) ?? free.find((id) => !shippedOrder.includes(id)) ?? shippedOrder.find((id) => free.includes(id)) ?? shippedOrder.find((id) => crates.includes(id));
    if (spare === undefined) return true;
    shippedOrder = shippedOrder.filter((x) => x !== spare);
    const p = ctx.part(spare) as Part;
    const f = fresh.get(spare);
    const stale = p.marks.length > 0 || (f && (p.colour !== f.colour || p.label !== f.label || p.contents !== f.contents));
    if (isTxn(ctx.writer(spare, 'location')) || ctx.touched(spare) || stale) {
      // rule 14: put away first (every history entry about it forgotten), then made fresh again
      ctx.putAway(spare, { at: 'shipped' });
      if (f) ctx.commit([{ target: spare, field: 'colour', after: f.colour }, { target: spare, field: 'label', after: f.label }, { target: spare, field: 'marks', after: f.marks }, { target: spare, field: 'contents', after: f.contents }], 'system');
    }
    const half = ctx.halfExtents(spare) ?? [0.3, 0.3, 0.3];
    const [sx, sz] = spec.stack;
    let top = 0;
    for (const id of ctx.parts()) {
      const m = ctx.mode(id);
      const pose = ctx.pose(id);
      if (id === spare || !pose || (m !== 'free' && m !== 'held')) continue;
      if (Math.hypot(pose.p[0] - sx, pose.p[2] - sz) > 0.55) continue;
      top = Math.max(top, pose.p[1] + (ctx.halfExtents(id)?.[1] ?? 0.3));
    }
    ctx.launch(spare, { p: [sx, top + half[1] + T.restockDrop, sz], q: qyaw(rng.range(-0.12, 0.12)) }, [0, 0, 0], [0, 0, 0], 'system');
    ctx.emit({ type: 'restocked', id: spec.id, part: spare });
    return true;
  }

  // (I1 R1) the brass bell over the door can be rung by hand: a press swings and sounds it. It is the visitor's
  // action (it ends attract mode) and changes nothing durable; the view swings it and the score rings it on the
  // `handle.worked` this emits.
  const bellId = bellOf(spec.id);
  ctx.register({
    id: bellId,
    station: spec.station,
    name: `${spec.name}.bell`,
    affordances: ['press'],
    tell: () => ctx.emit({ type: 'tell', id: bellId }),
    misfire: (level) => ctx.emit({ type: 'misfire', id: bellId, level }),
  });

  const unit: DockUnit = {
    id: spec.id,
    station: spec.station,
    name: spec.name,
    affordances: [],
    intent(intent: Intent): boolean {
      if (intent.type !== 'press' || intent.id !== bellId || ctx.bracketed) return false;
      ctx.emit({ type: 'handle.worked', id: bellId });
      return true;
    },
    tell() {
      lamp.tell();
      ctx.emit({ type: 'tell', id: spec.id });
    },
    misfire(level) {
      beat.hit(level);
      openUntil = Math.max(openUntil, ctx.clock.step + steps(T.misfireOpen * level));
      door = Math.max(door, 0.6); // the door jumps
      ctx.emit({ type: 'misfire', id: spec.id, level });
    },

    accept(part: Part, cause: Cause, mouth: Id): Outcome {
      const r = ctx.commit([{ target: part.id, field: 'location', after: { at: 'in', station: spec.station, mouth } }], cause);
      if (r.refused.length > 0) return { ok: false, wanted: CHANGED_SINCE };
      if (!ctx.take(part.id, spec.id)) return OK;
      take(part.id, cause);
      return OK;
    },

    abort(cause: Cause) {
      for (const s of [...queue]) if (s.job.cause === cause) {
        drop(s.id);
        s.job.done();
      }
      for (const r of returns) if (r.job?.cause === cause) r.job.done();
      returns = returns.filter((r) => r.job?.cause !== cause);
    },

    // behind the curtain: once its leading face passes the door's plane (`lipZ` past the sill, S6) it is inside the bay's
    // collider; it can no longer be taken. Short of it, waiting on the sill, it can.
    keeps: (part: Id): boolean => queue.some((x) => x.id === part && x.s + x.inside + Math.max(...[0, 2].map((k) => ctx.halfExtents(part)?.[k] ?? 0.3)) > LEN + R.lipZ),

    lost(part: Id) {
      const s = queue.find((x) => x.id === part);
      if (!s) return;
      queue.splice(queue.indexOf(s), 1);
      s.job.done();
    },

    restored(restores: readonly Restore[]) {
      for (const rs of restores) {
        if (rs.field !== 'location') continue;
        const from = rs.from as Location;
        const to = rs.to as Location;
        if (from.at === 'shipped' && to.at !== 'shipped') {
          // back in through the door: it opens, a reversing beep (the view draws the hop from `rs.pose`)
          for (const r of returns) if (r.id === rs.target) r.job?.done();
          returns = returns.filter((r) => r.id !== rs.target);
          shippedOrder = shippedOrder.filter((x) => x !== rs.target);
          openUntil = Math.max(openUntil, ctx.clock.step + steps(T.unshipOpen));
          ctx.emit({ type: 'returned', id: spec.id, part: rs.target, how: 'door' });
        }
        if (to.at === 'in' && to.mouth === spec.mouth && !queue.some((s) => s.id === rs.target) && ctx.take(rs.target, spec.id)) take(rs.target, ctx.history.chargeMachine(rs.target));
      }
    },

    reset() {
      for (const s of [...queue]) s.job.done();
      queue.length = 0;
      for (const r of returns) r.job?.done();
      returns = [];
      restocks = [];
      shippedOrder = [];
      openUntil = -1;
      lamp.reset();
      beat.reset();
    },

    pre() {
      // the door: open while anything is on its way through (or held open), eased
      const want = queue.length > 0 || ctx.clock.step < openUntil ? 1 : 0;
      if (want !== doorTarget) {
        doorTarget = want;
        ctx.emit({ type: 'door', id: spec.id, open: want === 1 });
      }
      door = want ? Math.min(1, door + dt / T.doorOpen) : Math.max(0, door - dt / T.doorClose);
      if (ctx.bracketed) return;

      const step = Math.max(T.roll, spec.feed?.(ctx) ?? 0) * dt;
      /** How far each has come (along the ramp, then through the door), first first: the one behind keeps its length and a gap. */
      const along = (x: Shipment): number => x.s + x.inside;
      const reach = (x: Shipment): number => Math.max(...[0, 2].map((k) => ctx.halfExtents(x.id)?.[k] ?? 0.3));
      let ahead: Shipment | null = null;
      for (const x of [...queue].sort((a, b) => along(b) - along(a))) {
        const room = ahead ? along(ahead) - reach(ahead) - T.gap - reach(x) - along(x) : Infinity;
        ahead = x;
        if (room <= 0) {
          ctx.drive(x.id, poseOf(x));
          continue;
        }
        // along the ramp to the sill; through the door once it is open
        const go = Math.min(step, room);
        if (x.s < LEN) x.s = Math.min(LEN, x.s + go);
        else if (x.inside > 0 || door >= T.clear) x.inside += go;
        if (x.inside >= T.depth) {
          ship(x);
          continue;
        }
        ctx.drive(x.id, poseOf(x));
      }
      const now = ctx.clock.step;
      for (const r of returns.filter((x) => x.at <= now)) {
        returns = returns.filter((x) => x !== r);
        sendBack(r);
      }
      for (const r of restocks.filter((x) => x.at <= now)) {
        // not while the crew's hands are in the stack: it stays owed and is tried again next step
        if (restock(r.size)) restocks = restocks.filter((x) => x !== r);
      }
    },

    view(): DockView {
      return { kind: 'dock', id: spec.id, station: spec.station, lamp: lamp.state(queue.length > 0 || door > 0), misfire: beat.view(), door, shipping: queue.map((s) => s.id) };
    },
  };
  return unit;
}
