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
import type { Cause, DockView, Id, Intent, Location, Outcome, Part, PartKind, Pose, Restore, SimEvent, StationId, Vec3 } from '../types.ts';
import type { Job } from '../history.ts';
import type { MachineUnit, SimContext } from '../context.ts';
import type { UnitFactory } from '../scene.ts';
import { HZ, steps } from '../clock.ts';
import { qaxis, qmul, qyaw, rotate } from '../math.ts';
import { rampAt, rampDoor, rampLength, rampNearest } from '../ramp.ts';
import type { RampSpec } from '../ramp.ts';
import { Beat, CHANGED_SINCE, Lamp, OK } from '../machine.ts';
import { distanceTo, obstacles } from '../crew/fetch-knock.ts';

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
  /**
   * R3: the bench never holds more loose crates than this (on it, in hands, riding, flying): a crate Revert drops
   * down its hatch comes back up the chute onto the pad only below it (else it stays a spare), and so does the
   * last resort's spare. Six, not five: five handled crates with one of them on Revert's hatch (it cannot come up)
   * and none Fetch may take leave the bench dry for good unless the last resort may bring a sixth.
   */
  looseMax: 6,
  /** R3: the last resort: Fetch has had nothing it may carry for this long and Revert has put nothing away meanwhile: one spare up the chute. */
  lastResort: 60,
  /**
   * A tool or a robot comes back up the chute this long after it ships. (R2) A robot with a pad to land by is
   * refused at once: the door shuts on it, a beat, and it is thrown back out (ten seconds of nothing read as gone).
   */
  returnAfter: { tool: 6, robot: 10 } as Readonly<Record<Exclude<PartKind, 'crate'>, number>>,
  /** R2: the beat between a robot going through the door and the chute throwing it back (s; under two with nothing of it on screen). */
  refuseAfter: 1.5,
  /** A part taken in off the centre line eases onto it over this much of the ramp. */
  settleOn: 0.4,
  /** A misfire jumps the door open for this long (per level); an undo's return opens it for this long. */
  misfireOpen: 0.45,
  unshipOpen: 0.9,
  /** A restocked crate is set down this far above whatever is on the stack (a hair: dropped from higher, it toppled the stack). */
  restockDrop: 0.02,
  /**
   * The pad is free for a crate when nothing lies within this of the box it will land in (its own size, square at its
   * mark): its landing's bounce and settle carry it about `LAND_SHORT` on, and it must not touch a neighbour doing so.
   */
  padClear: 0.08,
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
  /**
   * S5 R1: the chute's pad. With it, a plain crate's replacement does not appear on the stack: it comes up the
   * return chute and is thrown onto the pad (the stack is Fetch's to restock from there). `from` is the chute's
   * mouth, `apex` the height of the throw's top (world y); `radius` how far from `at` a crate counts as on the pad.
   * A replacement waits (owed) while the pad is taken.
   */
  readonly pad?: {
    readonly at: readonly [number, number];
    readonly radius: number;
    readonly from: Vec3;
    readonly apex: number;
    /** Aim by the crate's near face: every size lands with its face toward this point AT it (a big crate further in), not centred on `at`. */
    readonly near?: readonly [number, number];
    /**
     * R2: where a shipped robot is thrown back to (x, z), first choice first: by its stand at the pad; if that is taken,
     * the next free one along its tape. None free: the first, and physics parts them.
     */
    readonly home?: readonly (readonly [number, number])[];
  };
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

/** S5 R1: a crate thrown from the chute's mouth onto the pad: a ballistic arc, steps flown so far. */
interface Flight {
  readonly id: Id;
  age: number;
  readonly from: Vec3;
  readonly to: Vec3;
  /** Horizontal velocity, the upward start speed, the time of flight (s), its yaw and its tumble. */
  readonly vx: number;
  readonly vz: number;
  readonly vy: number;
  readonly time: number;
  readonly yaw0: number;
  readonly spin: number;
  readonly axis: Vec3;
  /** Whose rest it is on touchdown: the system's for a fresh crate, the crew's for a robot thrown home (R2). */
  readonly cause: Cause;
}

/**
 * The arc's shape (Taylor, 2026-11-20: crates "abruptly stopping during returns"): it is handed to physics the step
 * before it touches down, moving exactly as the arc moves there, and the engine lands it (a small bounce and settle,
 * by its material). So that it still rests where Fetch takes it every time, the last stretch is steep and slow across:
 * its way across eases out to `ACROSS_END` of its mean speed at touchdown (it leaves the chute's mouth that much faster
 * instead), and its tumble (whole turns) is done and still by `TUMBLE_BY` of the flight. Gravity is untouched.
 */
const ACROSS_END = 0;
/** The tumble is done (square, still) by this share of the flight: it comes down flat, not rocking onto a corner. */
const TUMBLE_BY = 0.8;
/** Measured (tests/scenario/chute-landing.test.ts): the bounce and settle carry a crate about this far on along the throw; it is aimed that much short of the pad's near line. */
const LAND_SHORT = 0.04;
/** The share of the way across after `k` of the flight, and its rate (per unit of `k`). */
const across = (k: number): number => (2 - ACROSS_END) * k - (1 - ACROSS_END) * k * k;
const acrossRate = (k: number): number => 2 - ACROSS_END - 2 * (1 - ACROSS_END) * k;
/** The share of the tumble after `k` (eased in and out, done by `TUMBLE_BY`: square and still at both ends), and its rate (per unit of `k`). */
const tumble = (k: number): number => {
  const u = Math.min(1, k / TUMBLE_BY);
  return u * u * (3 - 2 * u);
};
const tumbleRate = (k: number): number => {
  const u = Math.min(1, k / TUMBLE_BY);
  return (6 * u * (1 - u)) / TUMBLE_BY;
};

/** A box's footprint on the bench: its middle, and its own horizontal axes with their half extents (a tilted box's, projected). */
interface Footprint {
  readonly x: number;
  readonly z: number;
  /** The box's three local axes in world (x, z) and its half extent along each, with its vertical span. */
  readonly axes: readonly (readonly [number, number, number])[];
  readonly lo: number;
  readonly hi: number;
}
function footprint(pose: Pose, half: Vec3): Footprint {
  const axes = ([[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Vec3[]).map((e, k) => {
    const a = rotate(pose.q, e);
    return [a[0], a[2], half[k] as number, a[1]] as const;
  });
  const up = axes.reduce((s, a) => s + Math.abs(a[3]) * a[2], 0);
  return { x: pose.p[0], z: pose.p[2], axes: axes.map(([ax, az, h]) => [ax, az, h] as const), lo: pose.p[1] - up, hi: pose.p[1] + up };
}
/** Half its extent along the horizontal unit axis (ux, uz). */
const reachAlong = (f: Footprint, ux: number, uz: number): number => f.axes.reduce((s, [ax, az, h]) => s + Math.abs(ax * ux + az * uz) * h, 0);
/**
 * Do two footprints come within `margin` of each other on the bench (and overlap in height)? Separating axes: the
 * world's x and z and each box's own horizontal axes; a pair no axis separates is taken to touch (for a tilted box a
 * few more axes could part them: it errs toward "taken").
 */
function footprintsMeet(a: Footprint, b: Footprint, margin: number): boolean {
  if (a.lo > b.hi + margin || b.lo > a.hi + margin) return false;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const cands: [number, number][] = [[1, 0], [0, 1]];
  for (const f of [a, b]) for (const [ax, az] of f.axes) {
    const l = Math.hypot(ax, az);
    if (l > 0.2) cands.push([ax / l, az / l]);
  }
  for (const [ux, uz] of cands) if (Math.abs(dx * ux + dz * uz) > reachAlong(a, ux, uz) + reachAlong(b, ux, uz) + margin) return false;
  return true;
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
  let restocks: { at: number; size: Part['size']; part?: Id }[] = [];
  /** S5 R1: replacements in the air from the chute to the pad (the dock's custody, kinematic, until they touch down). */
  let flights: Flight[] = [];
  /** Crates come back up the chute while the pad was not free for them: waiting inside it (out of the world), thrown onto the pad when it is, oldest first. */
  let owed: { readonly id: Id; readonly cause: Cause }[] = [];
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
    lamp.used(part);
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
    const at = ctx.clock.step + steps(part.kind === 'robot' && spec.pad?.home ? T.refuseAfter : T.returnAfter[part.kind]);
    if (part.kind === 'robot') returns.push({ id: s.id, at, job: null });
    else returns.push({ id: s.id, at, job: ctx.history.work(ctx.history.chargeMachine(s.id), spec.id, () => (returns = returns.filter((r) => r.id !== s.id))) });
  }

  // ── R3: the bench never runs dry ──
  let starvedSince = -1;
  let lastPutAway = -Infinity;
  /** Crates Revert has swept into its pan (heard on the bus), until they go down its hatch or out of its hands. */
  const inPan = new Set<Id>();
  /** Crates Fetch gave up on (`crew.gaveUp`): not its work until a hand or a machine moves them (as Revert hears it). */
  const gaveUp = new Set<Id>();
  /**
   * Crates in the world (not shipped behind the door or down Revert's hatch), and those already owed back to it
   * (a restock queued and not yet thrown: several drops inside `restockAfter` must not overshoot `looseMax`).
   */
  function looseCrates(): number {
    return ctx.parts().filter((id) => ctx.part(id)?.kind === 'crate' && ctx.part(id)?.location.at !== 'shipped').length + restocks.length;
  }
  /** A crate Fetch may carry now (nobody has touched it, lying still on the pad or the stack), or one already in someone's hands or a machine. */
  function fetchHasWork(): boolean {
    const [sx, sz] = spec.stack;
    return ctx.parts().some((id) => {
      const p = ctx.part(id);
      if (!p || p.kind !== 'crate') return false;
      const m = ctx.mode(id);
      if (m === 'crew' && inPan.has(id)) return false; // in Revert's pan on its way down the hatch: not Fetch's work
      if (m === 'crew' || m === 'chute' || (m === 'machine' && p.location.at === 'in' && (p.location.mouth === 'belt' || p.location.mouth === 'dock'))) return true;
      if (ctx.touched(id) || gaveUp.has(id) || m !== 'free' || p.location.at !== 'rest') return false;
      const q = ctx.pose(id)?.p;
      if (!q) return false;
      if (Math.hypot(q[0] - sx, q[2] - sz) <= 0.55) return true;
      return !!spec.pad && Math.hypot(q[0] - spec.pad.at[0], q[2] - spec.pad.at[1]) <= spec.pad.radius;
    }) || flights.length > 0 || owed.length > 0;
  }
  /**
   * R3, the last resort ("never stuck" even when Revert cannot help: its hatch covered, its way shut, the handled
   * crates where it cannot stand): Fetch has had nothing it may carry for `lastResort` seconds in play mode and
   * nothing has been put away meanwhile: one spare up the chute onto the pad, as `system`, if the bench holds fewer
   * than `looseMax` crates. Then it waits as long again.
   */
  function lastResort(now: number): void {
    if (!spec.pad || !ctx.playMode || fetchHasWork() || restocks.length > 0) {
      starvedSince = -1;
      return;
    }
    if (starvedSince < 0) starvedSince = now;
    if (now - starvedSince < steps(T.lastResort) || now - lastPutAway < steps(T.lastResort)) return;
    starvedSince = now;
    if (looseCrates() >= T.looseMax) return;
    const spare = ctx.parts().find((id) => ctx.part(id)?.kind === 'crate' && ctx.part(id)?.location.at === 'shipped' && ctx.mode(id) === 'gone');
    if (spare) restocks.push({ at: now, size: (ctx.part(spare) as Part).size });
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
    if (part.kind === 'robot' && spec.pad?.home && r.id === ctx.scene.runner.id) throwHome(r.id);
    else ctx.toChute(r.id, cause);
    ctx.emit({ type: 'returned', id: spec.id, part: r.id, how: 'chute' });
  }

  /** A fresh crate onto the stack, as the system. */
  /**
   * Put a crate back on the stack. Answers false when it must wait: while the crew has a crate in its
   * hands at the stack (lifting the top one, or setting one down), the stack cannot be counted or
   * measured (a crate in the crew's hands is neither free nor held), and a crate set down then lands
   * inside the one being lifted.
   */
  function restock(size: Part['size'], want?: Id): boolean {
    if (!spec.pad) {
      const [sx, sz] = spec.stack;
      const inHand = ctx.parts().some((id) => {
        const p = ctx.pose(id)?.p;
        return ctx.part(id)?.kind === 'crate' && ctx.mode(id) === 'crew' && !!p && Math.hypot(p[0] - sx, p[2] - sz) <= 0.55;
      });
      if (inHand) return false;
    }
    if (!spec.pad && spec.stackMax !== undefined) {
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
    // (R3) the very crate Revert dropped down its hatch, when it is owed back: the visitor sees the same crate return
    // (R3) the very crate Revert dropped down its hatch: that one or none. Revert's put-away forgot every entry
    // about it (rule 14), so no transaction is its writer; were one ever, it is put away again below like any spare
    if (want !== undefined && !crates.includes(want)) return true; // no longer down there (reset): nothing owed
    const spare = (want !== undefined ? want : undefined) ?? free.find((id) => sameSize(id) && !shippedOrder.includes(id)) ?? shippedOrder.find((id) => free.includes(id) && sameSize(id)) ?? free.find((id) => !shippedOrder.includes(id)) ?? shippedOrder.find((id) => free.includes(id)) ?? shippedOrder.find((id) => crates.includes(id));
    if (spare === undefined) return true;
    if (spec.pad && !padFreeFor(spare)) return false; // S5 R1: owed until the pad is free for it
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
    if (spec.pad) {
      throwToPad(spare, half);
      return true;
    }
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
    ctx.emit({ type: 'restocked', id: spec.id, part: spare, on: 'stack' });
    return true;
  }

  // ── S5 R1: the chute throws the replacement onto the pad ──

  const g = Math.abs(ctx.scene.gravity);
  /**
   * Where a crate of these half extents lands on the pad (its middle; square, yaw 0): by its near face (`pad.near`),
   * its extent along the line from `near` through the pad's middle further in, and `LAND_SHORT` more (its landing's
   * bounce carries it about that far on toward the stand). Without `near`, the pad's middle.
   */
  function padMark(half: Vec3): Vec3 {
    const pad = spec.pad as NonNullable<DockSpec['pad']>;
    let [cx, cz] = pad.at;
    if (pad.near) {
      const dx0 = pad.at[0] - pad.near[0];
      const dz0 = pad.at[1] - pad.near[1];
      const l0 = Math.hypot(dx0, dz0) || 1;
      const ux = dx0 / l0;
      const uz = dz0 / l0;
      const ext = half[0] * Math.abs(ux) + half[2] * Math.abs(uz);
      [cx, cz] = [pad.near[0] + ux * (ext + LAND_SHORT), pad.near[1] + uz * (ext + LAND_SHORT)];
    }
    return [cx, ctx.scene.bench.top + half[1] + 0.005, cz];
  }
  /**
   * Is the pad free for `id` (2026-11-20, "the pad after a bounce")? Nothing in the air toward it, and nothing (a part
   * of any kind, lying, held low over it, or in a machine's hands) within `padClear` of the box `id` will land in at
   * its mark. Read from what is there, not a circle: a crate lying just beside the pad no longer keeps every
   * replacement off it, and one whose corner reaches over the mark does. Fetch on its rounds (it stands at the pad's
   * stand; the mark is aimed to clear it) does not count.
   */
  function padFreeFor(id: Id): boolean {
    const pad = spec.pad;
    if (!pad) return false;
    const half = ctx.halfExtents(id) ?? [0.3, 0.3, 0.3];
    const mark = padMark(half);
    const lands = footprint({ p: mark, q: [0, 0, 0, 1] }, half);
    const runner = ctx.scene.runner.id;
    for (const f of flights) {
      if (f.id === id) continue;
      if (footprintsMeet(lands, footprint({ p: f.to, q: qyaw(f.yaw0) }, ctx.halfExtents(f.id) ?? [0.3, 0.3, 0.3]), T.padClear)) return false;
    }
    return ctx.parts().every((o) => {
      if (o === id) return true;
      const m = ctx.mode(o);
      if (m === 'gone' || m === 'chute' || (o === runner && m === 'crew') || (m === 'machine' && flights.some((f) => f.id === o))) return true;
      const pose = ctx.pose(o);
      const h = ctx.halfExtents(o);
      if (!pose || !h) return true;
      const f = footprint(pose, h);
      // (held or flying high over it: not in the way of a landing; low over it, or lying there: in the way)
      if (f.lo > lands.hi + 0.5) return true;
      if (m === 'crew' && ctx.part(o)?.kind !== 'crate') {
        // a crew body on its feet or treads (Revert at its sweep beside the pad, Patch afoot): in the second the throw
        // is in the air it may turn on the spot into the landing, so it takes the whole circle it turns in (measured:
        // Revert turning away from its sweep there knocked the landing crate off the pad, three times in 200). Fetch
        // waiting at its stand for the crate is not in it; Revert waiting for Fetch to go, Fetch gives way to
        const dx = pose.p[0] - mark[0];
        const dz = pose.p[2] - mark[2];
        const d = Math.hypot(dx, dz);
        return d < 1e-6 ? false : d - Math.hypot(h[0], h[2]) - reachAlong(lands, dx / d, dz / d) > T.padClear;
      }
      return !footprintsMeet(lands, f, T.padClear);
    });
  }
  /** Out of the chute's mouth, up over the deflector's row and down onto the pad: a ballistic arc with its top at `apex`. */
  function throwToPad(id: Id, half: Vec3, cause: Cause = 'system'): void {
    // how it will lie: square to the pad (a turned crate reaches further toward the stand, or its middle further from
    // Fetch's reach: on this pad there is no room for either); it tumbles in the air by whole turns
    // (exactly square since its landing is the engine's: turned even a degree, it comes down on one edge first and its
    // bounce carries it up to 0.08 off its mark, out of Fetch's reach; the draw is kept so the dock's other choices
    // come from the stream they always did)
    void rng.range(-0.02, 0.02);
    throwTo(id, padMark(half), 0, 0, cause);
  }
  /** Out of the chute's mouth on an arc with its top at the pad's `apex`, tumbling by whole turns, to land square at `to`. */
  function throwTo(id: Id, to: Vec3, yaw0: number, spin: number, cause: Cause): void {
    const pad = spec.pad as NonNullable<DockSpec['pad']>;
    const from = pad.from;
    const apex = Math.max(pad.apex, from[1] + 0.1, to[1] + 0.1);
    const vy = Math.sqrt(2 * g * (apex - from[1]));
    const time = vy / g + Math.sqrt((2 * (apex - to[1])) / g);
    // a tumble that ends square: whole turns about a level axis across the throw, and a little yaw
    const dx = to[0] - from[0];
    const dz = to[2] - from[2];
    const l = Math.hypot(dx, dz) || 1;
    const f: Flight = { id, age: 0, from, to, vx: dx / time, vz: dz / time, vy, time, yaw0, spin, axis: [-dz / l, 0, dx / l], cause };
    ctx.launch(id, { p: from, q: qyaw(yaw0) }, [0, 0, 0], [0, 0, 0], cause);
    if (!ctx.take(id, spec.id)) return; // (never: it was just put into the world, free)
    // (R4) a part thrown back is still the transaction that threw it off: back into its window (taking it left it)
    if (isTxn(cause)) ctx.history.claim(id, cause, ctx.clock.step);
    flights.push(f);
    ctx.emit({ type: 'restock.launched', id: spec.id, part: id, from, to, flight: time });
  }
  /**
   * R2: a robot the dock refused, thrown back up the chute to land on its wheels by its stand at the pad (or the next
   * free place along its tape: never onto whatever stands there, nor where a crate is landing). The crew's.
   */
  function throwHome(id: Id, cause: Cause = 'crew'): void {
    const pad = spec.pad as NonNullable<DockSpec['pad']>;
    const homes = pad.home as NonNullable<DockSpec['pad']>['home'] & object;
    const half = ctx.halfExtents(id) ?? [0.3, 0.3, 0.3];
    const mine = Math.hypot(half[0], half[2]);
    const free = ([hx, hz]: readonly [number, number]): boolean =>
      ctx.parts().every((o) => {
        if (o === id) return true;
        const m = ctx.mode(o);
        const p = ctx.pose(o)?.p;
        if (!p || m === 'gone' || m === 'chute' || p[1] > 1.6) return true;
        const h = ctx.halfExtents(o) ?? [0.3, 0.3, 0.3];
        return Math.hypot(p[0] - hx, p[2] - hz) > mine + Math.hypot(h[0], h[2]) + 0.05;
      }) && flights.every((f) => Math.hypot(f.to[0] - hx, f.to[2] - hz) > mine + 0.7);
    // (R4) none of its tape's points free (another robot, big Revert, or crates there): the nearest free spot by the pad
    // (the tape is Fetch's: another robot, Revert, lands by the pad, never on Fetch's stand)
    const own = id === ctx.scene.runner.id;
    const [hx, hz] = (own ? homes.find(free) : undefined) ?? besidePad(id, half) ?? (homes[0] as readonly [number, number]);
    throwTo(id, [hx, ctx.scene.bench.top + half[1] + 0.005, hz], rng.range(-0.08, 0.08), 0, cause);
  }

  /** R4: the fixed bodies and the mouths on the bench (where nothing thrown back may land). */
  const BODIES = obstacles(ctx.scene);
  /**
   * R4: where a part thrown back up the chute lands: on the pad if nothing stands on it or is landing on it; else the
   * nearest free spot beside it (rings round the pad, clear of every body and mouth, of every part, and of every
   * landing already in the air).
   */
  function besidePad(id: Id, half: Vec3): readonly [number, number] | null {
    const pad = spec.pad as NonNullable<DockSpec['pad']>;
    const b = ctx.scene.bench;
    const ext = Math.hypot(half[0], half[2]);
    for (const r of [0.85, 1.1, 1.35, 1.6, 1.9, 2.2]) {
      const n = Math.max(12, Math.round(r * 14));
      let best: readonly [number, number] | null = null;
      let bestD = Infinity;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const px = pad.at[0] + Math.cos(a) * r;
        const pz = pad.at[1] + Math.sin(a) * r;
        if (px - ext < b.minX + 0.1 || px + ext > b.maxX - 0.1 || pz - ext < b.minZ + 0.1 || pz + ext > b.maxZ - 0.1) continue;
        if (BODIES.some((o) => distanceTo(o, px, pz) < ext + 0.05)) continue;
        const crowded = ctx.parts().some((o) => {
          if (o === id) return false;
          const m = ctx.mode(o);
          const q = ctx.pose(o)?.p;
          if (!q || m === 'gone' || m === 'chute' || q[1] > b.top + 2.5) return false;
          const h = ctx.halfExtents(o) ?? [0.3, 0.3, 0.3];
          return Math.hypot(q[0] - px, q[2] - pz) < ext + Math.hypot(h[0], h[2]) + 0.05;
        });
        if (crowded || flights.some((f) => Math.hypot(f.to[0] - px, f.to[2] - pz) < ext + 0.7)) continue;
        // the nearest to the pad's stand side first (toward the bench's middle), then round
        const d = Math.hypot(px - (pad.near?.[0] ?? pad.at[0]), pz - (pad.near?.[1] ?? pad.at[1]));
        if (d < bestD) [best, bestD] = [[px, pz], d];
      }
      if (best) return best;
    }
    return null;
  }

  /** R4: anything due out of the return chute is thrown back onto the pad (or beside it), as a replacement is. */
  function catchReturn(id: Id, cause: Cause | null): boolean {
    if (!spec.pad) return false;
    const part = ctx.part(id);
    if (!part) return false;
    // (R4: Fetch is thrown home beside the pad; Revert comes home through its own hatch: its own unit takes it)
    if (part.kind === 'robot' && id !== ctx.scene.runner.id) return false;
    if (part.kind === 'robot' && spec.pad.home) {
      throwHome(id, cause ?? 'crew');
      return true;
    }
    const half = ctx.halfExtents(id) ?? [0.3, 0.3, 0.3];
    if (padFreeFor(id)) {
      throwToPad(id, half, cause ?? 'system');
      return true;
    }
    // (2026-11-20) a crate Fetch may carry (nobody has touched it), the pad not free for it: it waits in the chute until
    // it is, as a replacement does. Thrown beside the pad it lay where Fetch cannot take it, and only the healing put it
    // back into circulation. (The visitor's crate is not Fetch's wherever it lands: beside the pad it leaves the pad free.)
    if (part.kind === 'crate' && !ctx.touched(id)) {
      if (!owed.some((o) => o.id === id)) {
        ctx.stow(id, { p: spec.pad.from, q: [0, 0, 0, 1] });
        owed.push({ id, cause: cause ?? 'system' });
      }
      return true;
    }
    const at = besidePad(id, half);
    if (!at) return false; // nowhere free: the old pop out of the chute's mouth
    throwTo(id, [at[0], ctx.scene.bench.top + half[1] + 0.005, at[1]], rng.range(-0.1, 0.1), 0, cause ?? 'system');
    return true;
  }
  /** Its pose `t` seconds into the flight (to the touchdown at `time`, exactly at `to`). */
  function flightPose(f: Flight, t: number): Pose {
    const k = Math.min(1, t / f.time);
    const a = across(k) * f.time;
    const p: Vec3 = [f.from[0] + f.vx * a, f.from[1] + f.vy * t - 0.5 * g * t * t, f.from[2] + f.vz * a];
    return { p, q: qmul(qyaw(f.yaw0 + f.spin * k), qaxis(f.axis, 2 * Math.PI * tumble(k))) };
  }
  /** How it is moving `t` seconds into the flight: its velocity and its spin (world, rad/s). */
  function flightMotion(f: Flight, t: number): [Vec3, Vec3] {
    const k = Math.min(1, t / f.time);
    const r = acrossRate(k);
    const turn = (2 * Math.PI * tumbleRate(k)) / f.time;
    const q = qyaw(f.yaw0 + f.spin * k);
    // the tumble's axis turned by the yaw it is thrown with (a hair), plus the yaw's own turn
    const ax = rotate(q, f.axis);
    return [
      [f.vx * r, f.vy - g * t, f.vz * r],
      [ax[0] * turn, ax[1] * turn + f.spin / f.time, ax[2] * turn],
    ];
  }
  function fly(): void {
    for (const f of [...flights]) {
      if (ctx.mode(f.id) !== 'machine') {
        flights = flights.filter((x) => x !== f);
        continue;
      }
      f.age += 1;
      if ((f.age + 1) / HZ < f.time) {
        ctx.drive(f.id, flightPose(f, f.age / HZ));
        continue;
      }
      // the step before it would touch down: handed to physics where it is, moving exactly as the arc moves there,
      // and the engine lands it on the pad (the arc's last stretch is steep and slow across: it settles where it
      // lands); whatever stands on the pad by now, physics parts them
      flights = flights.filter((x) => x !== f);
      const [v, w] = flightMotion(f, (f.age - 1) / HZ); // (where the last step left it: physics adds this step's gravity)
      ctx.release(f.id, v, w, f.cause);
      if (ctx.part(f.id)?.kind === 'crate') ctx.emit({ type: 'restocked', id: spec.id, part: f.id, on: 'pad' });
    }
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
      flights = flights.filter((f) => f.id !== part); // a crate caught in the air: the visitor's now
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

    catchReturn,

    reset() {
      starvedSince = -1;
      lastPutAway = -Infinity;
      for (const s of [...queue]) s.job.done();
      queue.length = 0;
      for (const r of returns) r.job?.done();
      returns = [];
      restocks = [];
      flights = [];
      owed = [];
      shippedOrder = [];
      openUntil = -1;
      lamp.reset();
      beat.reset();
    },

    heard(events: readonly SimEvent[]) {
      for (const e of events) {
        if (e.type === 'revert.sweep' || e.type === 'put-away') lastPutAway = ctx.clock.step;
        if (e.type === 'revert.sweep') {
          if (e.to.at === 'rest') inPan.add(e.part);
          else inPan.delete(e.part);
        }
        if (e.type === 'part.grabbed' || e.type === 'reset') inPan.clear();
        // (a crate Fetch reached for and could not take is not its work until a hand or a machine moves it)
        if (e.type === 'crew.gaveUp') gaveUp.add(e.part);
        else if (e.type === 'reset') gaveUp.clear();
        else if ((e.type === 'part.grabbed' || e.type === 'part.released' || e.type === 'part.returned' || e.type === 'put-away') && gaveUp.has(e.id)) gaveUp.delete(e.id);
        else if ((e.type === 'taken-in' || e.type === 'shipped' || e.type === 'returned' || e.type === 'restocked') && gaveUp.has(e.part)) gaveUp.delete(e.part);
        // R3: a crate Revert dropped down its hatch comes back up the chute onto the pad (bounded: `looseMax`)
        if (e.type === 'revert.sweep' && e.to.at === 'shipped' && ctx.part(e.part)?.kind === 'crate' && looseCrates() < T.looseMax) {
          restocks.push({ at: ctx.clock.step + steps(T.restockAfter), size: (ctx.part(e.part) as Part).size, part: e.part });
        }
      }
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
      fly();
      // a crate waiting in the chute for the pad (one a step: once it flies, the pad is not free for the next)
      owed = owed.filter((o) => ctx.mode(o.id) === 'gone'); // (brought back by an undo meanwhile: not owed)
      const next = owed[0];
      if (next && padFreeFor(next.id)) {
        owed = owed.slice(1);
        throwToPad(next.id, ctx.halfExtents(next.id) ?? [0.3, 0.3, 0.3], next.cause);
      }
      const now = ctx.clock.step;
      for (const r of returns.filter((x) => x.at <= now)) {
        returns = returns.filter((x) => x !== r);
        sendBack(r);
      }
      for (const r of restocks.filter((x) => x.at <= now)) {
        // not while the crew's hands are in the stack: it stays owed and is tried again next step
        if (restock(r.size, r.part)) restocks = restocks.filter((x) => x !== r);
      }
      lastResort(now);
    },

    view(): DockView {
      return { kind: 'dock', id: spec.id, station: spec.station, lamp: lamp.state(queue.length > 0 || door > 0), misfire: beat.view(), door, shipping: queue.map((s) => s.id) };
    },
  };
  return unit;
}
