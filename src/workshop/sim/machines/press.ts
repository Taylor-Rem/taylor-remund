/**
 * The report press (P4 D3): the Report Generation Framework's demonstration, the thing in its crate (`crate-2`). A
 * table-top press of cast iron and brass on a wooden base, one loose part (kind `tool`) with state, and one lever.
 * What it is true to, and what it simplifies, is said in `shared/report-press.ts`.
 *
 * One pull of the lever (`press`) is the visitor's transaction, one effect group:
 * - the press's `report` (`REPORT_FIELD`): what the dock has shipped this visit, as the press heard it (below);
 * - the press's `drawer` (`DRAWER_FIELD`): one more stored copy;
 * - the envelope's `seal` (`SEAL_FIELD`), when the envelope is in the press: the colour of the report's last mark.
 * Then, about two seconds in (`PRESS_SHOW.flickAt`), the spring arm flicks the envelope (the one real loose part
 * here, kind `tool`, material paper) onto the belt: a high lob from wherever the press stands to the belt's feed, or
 * behind the last thing riding it, so it queues. Its flight is this unit's (kinematic, a ballistic arc whose way
 * across eases to nothing at touchdown, so it lands where it was aimed and stays); handed to physics just before it
 * touches down, or at once if anything is in its way, and from there it is a part like any other. Its rest, its ride
 * and its shipment are charged to the pull (§ E5 rule 4). While the envelope is out, a pull still prints and stores,
 * and the arm's bed comes up empty with a shrug (`press.shrug`).
 *
 * The record (brief: "events or history"): events. The press hears every `shipped` on the bus and notes the part and
 * the paint it had as it went through the door; an undo that brings a shipment back in through the door
 * (`returned`, how `door`) takes that shipment off the record again (it did not ship after all). The history could
 * not serve: it forgets after thirty transactions, holds nothing of what the crew or the system ship (Fetch's
 * crates), and would have to be read backwards. The record is transient (a fresh visit, or "Reset the workshop",
 * starts it empty); what was printed from it is durable, and is what the lever restores.
 *
 * The envelope never comes back up the chute. Shipped, the dock queues no return for it (the dock's `homeward`); this
 * unit brings it home, back in the press folded flat, the dock's own return time later
 * (`DOCK_TUNING.returnAfter.tool`, handed in by the scene as `homeAfter`), charged as the dock charges a tool's return (to whoever shipped it, while that is
 * on the stack). Off the bench it comes back up the chute as every part does; nothing else here knows about it.
 *
 * Undo restores recorded values: the sheets show the report before, the drawer is one thinner, the seal is what it
 * was, and an envelope out on its journey (flying, lying, riding, rolling through the dock, shipped) is back in the
 * press wherever it had got to. Nothing runs backwards here: the world puts the envelope where its durable location
 * says (`in` the press), and `restored` takes it out of the world again.
 *
 * Reachable (free on the bench, or in a machine's mouth: its crate's tray, the belt, the platen) a pull prints; in a
 * hand, stowed, shipped or down the chute it is a misfire (the lever twitches, nothing prints). A pull while a pull
 * is showing waits its turn under its own transaction, as the ledger board's crank does. With reduced motion there is
 * no show: the sheets are printed, the drawer is one thicker and the envelope is set down on the belt at once.
 */
import type { Cause, Id, Intent, Outcome, Pose, PressView, Restore, SimEvent, StationId, TransactionId, Value, Vec3 } from '../types.ts';
import type { MachineUnit, SimContext } from '../context.ts';
import type { Change, Job } from '../history.ts';
import type { UnitFactory } from '../scene.ts';
import { HZ, steps } from '../clock.ts';
import { Beat, OK, gesture, handleTxn } from '../machine.ts';
import { qyaw, rotate, yawOf } from '../math.ts';
import { DRAWER_MAX, pullScript, reportOf, sealOf, validDrawer, validReport, validSeal, type PressScript, type Report, type Shipment } from './shared/report-press.ts';

/** The press's durable fields (on its own id) and the envelope's. */
export const REPORT_FIELD = 'report';
export const DRAWER_FIELD = 'drawer';
export const SEAL_FIELD = 'seal';

/** Tune here. Units and seconds. */
export const PRESS_TUNING = {
  /** The lob's top is this far over the higher of its two ends (a slow high lob across the bench is worth watching). */
  lob: 2.3,
  /** The lob falls this hard (units/s²): floatier than the bench's gravity, so the flight is slow and worth watching (the engine takes over for the last step). */
  flightGravity: 8,
  /** The envelope turns this many times about the vertical in the air (a flicked card spins flat). */
  spin: 1,
  /** It lands this far behind the last thing riding the belt. */
  gap: 0.08,
  /** Anything within this of its middle on the way is in the way: it goes to physics there. */
  clearance: 0.03,
  /**
   * (as the ledger's: LEDGER_TUNING) A second press on the lever this soon after the first is held a moment
   * (`doubleSteps`) before it pulls: if the visitor's double-tap asks for the press (`select`) meanwhile, it was half
   * of that, and only the look happens.
   */
  doubleSeconds: 0.36,
  doubleSteps: 3,
} as const;

export interface PressSpec {
  /** The unit's id (its view: `WorldView.machine(id)`). */
  readonly id: Id;
  readonly station: StationId;
  /** The press: a loose part of the scene (kind `tool`, `stowedIn` its crate). */
  readonly body: Id;
  /** The envelope: a loose part of the scene (kind `tool`, `stowedIn` the press). */
  readonly envelope: Id;
  readonly lever: { readonly id: Id; readonly name: string };
  /** Where the envelope sits on the arm's bed, in the press's own frame from its body's middle (it leaves from here). */
  readonly bed: Vec3;
  /**
   * The belt as the flick aims at it: its mouth, its carrying surface (x from `from` to `to`, its top, its centre line
   * z), where things are set on it (`feed`, x), and how far from its motor end nothing is set down (`clear`, the deflector's).
   */
  readonly belt: { readonly mouth: Id; readonly from: number; readonly to: number; readonly top: number; readonly z: number; readonly feed: number; readonly clear: number };
  /** Seconds from the envelope's shipment to its homecoming: the dock's own return time for a tool (the scene passes `DOCK_TUNING.returnAfter.tool`). */
  readonly homeAfter: number;
  /** The id of its own look box (registered by its view, never pressed): what it asks the camera for off its tray. */
  readonly look: Id;
  /** Its crate's card (what it asks the camera for while it is on its crate's tray). */
  readonly card?: Id;
  /** Statics the envelope may touch on its way without being stopped (the bench top and the belt's bed it lands on). */
  readonly ignore?: readonly Id[];
}

export interface PressUnit extends MachineUnit {
  view(): PressView;
}

export function press(spec: PressSpec): UnitFactory {
  return (ctx) => createPress(ctx, spec);
}

interface Flight {
  readonly job: Job;
  readonly from: Vec3;
  readonly to: Vec3;
  readonly vx: number;
  readonly vz: number;
  readonly vy: number;
  readonly time: number;
  readonly yaw0: number;
  age: number;
}

const isTxn = (c: Cause | string | undefined): c is TransactionId => typeof c === 'string' && /^t\d+$/.test(c);
/** The way across, eased out to nothing at touchdown (as the dock's chute throw: it lands where it is aimed and stays). */
const across = (k: number): number => 2 * k - k * k;
const acrossRate = (k: number): number => 2 - 2 * k;

export function createPress(ctx: SimContext, spec: PressSpec): PressUnit {
  const T = PRESS_TUNING;
  const lever = new Beat(ctx);
  const bodySpec = ctx.scene.parts.find((p) => p.id === spec.body);
  const envSpec = ctx.scene.parts.find((p) => p.id === spec.envelope);
  if (!bodySpec || bodySpec.kind === 'crate') throw new Error(`press: ${spec.body} is not a loose part of this scene (nor may it be a crate)`);
  if (!envSpec || envSpec.kind === 'crate' || envSpec.stowedIn !== spec.body) throw new Error(`press: ${spec.envelope} is not a loose part stowed in ${spec.body}`);
  ctx.defineSetting(spec.body, REPORT_FIELD, null, validReport as (v: Value) => boolean);
  ctx.defineSetting(spec.body, DRAWER_FIELD, 0, validDrawer as (v: Value) => boolean);
  ctx.defineSetting(spec.envelope, SEAL_FIELD, null, validSeal as (v: Value) => boolean);
  const g = PRESS_TUNING.flightGravity;
  const HOME: Value = { at: 'in', station: envSpec.station, mouth: spec.body };

  /** What the dock has shipped this visit, as heard (transient). */
  let record: Shipment[] = [];
  /** The pull being shown (transient). */
  let show: { start: number; before: Report; after: Report; drawer: number; envelope: boolean; script: PressScript; said: number } | null = null;
  /** A pull waiting for the show to end: its work, under its own transaction. */
  let waiting: Job | null = null;
  /** The flick to come (the envelope is spoken for: a second pull's bed comes up empty), and the flight. */
  let flick: { job: Job; at: number } | null = null;
  let flight: Flight | null = null;
  /** The envelope's homecoming after it ships. */
  let home: { job: Job | null; at: number } | null = null;
  /** The last shrug of the arm's spring (a pull with the envelope out), the step it began. */
  let shrugAt = -1;
  /** The last polite refusal (a pull with the envelope in the air), the step it began. */
  let refusedAt = -1;
  /** "Reset the workshop" is under way (`reset`, then `restored`). */
  let resetting = false;

  ctx.register({
    id: spec.lever.id,
    station: spec.station,
    name: spec.lever.name,
    affordances: ['press'],
    on: spec.body,
    tell: () => ctx.emit({ type: 'tell', id: spec.lever.id }),
    misfire: (level) => {
      // a twitch of the lever, without the verb: nothing is printed
      lever.hit(level);
      ctx.emit({ type: 'misfire', id: spec.lever.id, level });
    },
  });

  const report = (): Report => {
    const v = ctx.setting(spec.body, REPORT_FIELD);
    return validReport(v) ? v : null;
  };
  const drawer = (): number => {
    const v = ctx.setting(spec.body, DRAWER_FIELD);
    return validDrawer(v) ? v : 0;
  };
  /** In the world and in nobody's hand: free on the bench, or in a machine's mouth. */
  const reachable = (): boolean => {
    const m = ctx.mode(spec.body);
    return m === 'free' || m === 'machine';
  };
  /** The envelope is in the press (its durable place), out of the world, not spoken for. */
  const envelopeIn = (): boolean => {
    const l = ctx.part(spec.envelope)?.location;
    return !!l && l.at === 'in' && l.mouth === spec.body && ctx.mode(spec.envelope) === 'gone';
  };
  const elapsed = (): number => (show ? (ctx.clock.step - show.start) / HZ : Infinity);
  const playing = (): boolean => show !== null && elapsed() < show.script.length;

  /** Where the flick leaves from: the arm's bed on the press as it stands, turned with its yaw. */
  function bedPose(): Pose | null {
    const p = ctx.pose(spec.body);
    if (!p) return null;
    const yaw = yawOf(p.q);
    const off = rotate(qyaw(yaw), spec.bed);
    return { p: [p.p[0] + off[0], p.p[1] + off[1], p.p[2] + off[2]], q: qyaw(yaw) };
  }

  /** Where on the belt it is aimed: its feed, or behind the last thing riding it (the belt is the queue); never in the deflector's reach. */
  function aim(): Vec3 {
    const B = spec.belt;
    const eh = ctx.halfExtents(spec.envelope) ?? [0.09, 0.006, 0.06];
    let x = B.feed;
    for (const id of ctx.parts()) {
      if (id === spec.envelope) continue;
      const l = ctx.part(id)?.location;
      if (!l || l.at !== 'in' || l.mouth !== B.mouth) continue;
      const p = ctx.pose(id);
      const h = ctx.halfExtents(id);
      if (!p || !h) continue;
      x = Math.min(x, p.p[0] - Math.max(h[0], h[2]) - T.gap - eh[0]);
    }
    x = Math.max(x, B.from + B.clear + eh[0]);
    return [x, B.top + eh[1] + 0.004, B.z];
  }

  /** Is anything in the way of the envelope's middle at `p` (a part other than the press and itself, or a static)? */
  function blocked(p: Vec3): boolean {
    const r = T.clearance;
    for (const id of ctx.parts()) {
      if (id === spec.envelope || id === spec.body) continue;
      const m = ctx.mode(id);
      if (m === 'gone' || m === 'chute' || m === undefined) continue;
      const q = ctx.pose(id);
      const h = ctx.halfExtents(id);
      if (!q || !h) continue;
      const l = rotate([-q.q[0], -q.q[1], -q.q[2], q.q[3]], [p[0] - q.p[0], p[1] - q.p[1], p[2] - q.p[2]]);
      if (Math.abs(l[0]) < h[0] + r && Math.abs(l[1]) < h[1] + r && Math.abs(l[2]) < h[2] + r) return true;
    }
    for (const s of ctx.scene.statics) {
      if (s.shape.type !== 'box' || spec.ignore?.includes(s.id)) continue;
      const h = s.shape.half;
      const q = s.pose.q;
      const l = rotate([-q[0], -q[1], -q[2], q[3]], [p[0] - s.pose.p[0], p[1] - s.pose.p[1], p[2] - s.pose.p[2]]);
      if (Math.abs(l[0]) < h[0] + r && Math.abs(l[1]) < h[1] + r && Math.abs(l[2]) < h[2] + r) return true;
    }
    return false;
  }

  function flightPose(f: Flight, t: number): Pose {
    const k = Math.min(1, t / f.time);
    const a = across(k) * f.time;
    return { p: [f.from[0] + f.vx * a, f.from[1] + f.vy * t - 0.5 * g * t * t, f.from[2] + f.vz * a], q: qyaw(f.yaw0 + Math.PI * 2 * T.spin * k) };
  }
  function flightMotion(f: Flight, t: number): [Vec3, Vec3] {
    const k = Math.min(1, t / f.time);
    const r = acrossRate(k);
    return [
      [f.vx * r, f.vy - g * t, f.vz * r],
      [0, (Math.PI * 2 * T.spin) / f.time, 0],
    ];
  }

  /** Hand the envelope to physics (its rest the pull's), and the flight is over. */
  function letGo(f: Flight, t: number): void {
    flight = null;
    const [v, w] = flightMotion(f, t);
    const cause = f.job.cause;
    if (ctx.mode(spec.envelope) === 'machine') {
      ctx.release(spec.envelope, v, w, cause);
      // (a part sent flying by a pull is still the pull's: in its window until it rests, so an undo recalls it)
      if (isTxn(cause)) ctx.history.claim(spec.envelope, cause, ctx.clock.step);
    }
    f.job.done();
  }

  /** The flick: out of the world's custody of the press into the air, a lob to the belt. */
  function doFlick(job: Job): void {
    const from = bedPose();
    if (!job.active || !envelopeIn() || !reachable() || !from) {
      job.done();
      return;
    }
    const to = aim();
    const apex = Math.max(from.p[1], to[1]) + T.lob;
    const vy = Math.sqrt(2 * g * (apex - from.p[1]));
    const time = vy / g + Math.sqrt((2 * (apex - to[1])) / g);
    // (the way across eases out, so it starts at twice the mean speed)
    const f: Flight = { job, from: from.p, to, vx: (to[0] - from.p[0]) / time, vz: (to[2] - from.p[2]) / time, vy, time, yaw0: yawOf(from.q), age: 0 };
    ctx.launch(spec.envelope, { p: from.p, q: from.q }, [0, 0, 0], [0, 0, 0], job.cause);
    if (!ctx.take(spec.envelope, spec.id)) {
      job.done();
      return;
    }
    flight = f;
    ctx.emit({ type: 'press.flicked', id: spec.id, envelope: spec.envelope, from: from.p, to, flight: time });
    // the close view is done: the page eases back out to watch the lob, the ride and the bell
    ctx.emit({ type: 'look.back', target: lookTarget() });
  }

  /** Reduced motion: no travel; the envelope is set down still on the belt where the lob would have landed it. */
  function setOnBelt(cause: Cause): void {
    const to = aim();
    const yaw = yawOf(ctx.pose(spec.body)?.q ?? [0, 0, 0, 1]);
    ctx.launch(spec.envelope, { p: to, q: qyaw(yaw) }, [0, 0, 0], [0, 0, 0], cause);
    if (ctx.take(spec.envelope, spec.id)) ctx.release(spec.envelope, [0, 0, 0], [0, 0, 0], cause);
    ctx.emit({ type: 'press.flicked', id: spec.id, envelope: spec.envelope, from: to, to, flight: 0 });
  }

  function step(f: Flight): void {
    if (ctx.mode(spec.envelope) !== 'machine') {
      flight = null;
      f.job.done();
      return;
    }
    f.age += 1;
    const t = f.age / HZ;
    if ((f.age + 1) / HZ >= f.time) {
      // the step before it would touch down: physics lands it, moving exactly as the arc moves there
      letGo(f, (f.age - 1) / HZ);
      return;
    }
    const next = flightPose(f, t);
    // (clear of the press it left first: the first tenth of a second it is still over its own bed)
    if (t > 0.1 && blocked(next.p)) {
      letGo(f, (f.age - 1) / HZ);
      return;
    }
    ctx.drive(spec.envelope, next);
  }

  /** Print: one effect group under `commit`'s cause. False if the history refused it. */
  function act(commit: (changes: readonly Change[]) => boolean, cause: Cause): boolean {
    const before = report();
    const after = reportOf(record);
    const free = envelopeIn() && !flick && !flight;
    const changes: Change[] = [
      { target: spec.body, field: REPORT_FIELD, after: [...after] },
      { target: spec.body, field: DRAWER_FIELD, after: Math.min(DRAWER_MAX, drawer() + 1) },
    ];
    if (free) changes.push({ target: spec.envelope, field: SEAL_FIELD, after: sealOf(after) });
    const was = drawer();
    if (!commit(changes)) return false;
    const script = pullScript(free);
    ctx.emit({ type: 'press.printed', id: spec.id, body: spec.body, marks: after.length, envelope: free });
    if (!free) shrugAt = ctx.clock.step;
    if (ctx.reducedMotion || !reachable()) {
      show = null;
      for (const kind of ['thunk', 'click'] as const) ctx.emit({ type: 'press.beat', id: spec.id, body: spec.body, beat: kind, n: 0 });
      if (free && reachable()) setOnBelt(cause);
      return true;
    }
    show = { start: ctx.clock.step, before, after, drawer: was, envelope: free, script, said: 0 };
    if (free && script.flickAt !== null) {
      const job = ctx.history.work(cause, spec.id, () => {
        if (flick?.job === job) flick = null;
        if (flight?.job === job) {
          // (rule 10: an undo mid-flight: its location never changed, so nothing restores it; it goes back in the press here)
          flight = null;
          if (ctx.mode(spec.envelope) === 'machine') ctx.stow(spec.envelope, ctx.pose(spec.envelope) as Pose);
        }
      });
      flick = { job, at: ctx.clock.step + steps(script.flickAt) };
    }
    return true;
  }

  /** The envelope is on its way through the air: flicked and not yet come to rest (its place still the press). */
  function airborne(): boolean {
    if (flight) return true;
    const l = ctx.part(spec.envelope)?.location;
    return ctx.mode(spec.envelope) === 'free' && !!l && l.at === 'in' && l.mouth === spec.body;
  }
  function refuse(): void {
    refusedAt = ctx.clock.step;
    ctx.emit({ type: 'press.refused', id: spec.id, body: spec.body });
  }

  /**
   * Asking for the camera (sim/machines/crates.ts "Asking for the camera"): `{ type: 'look', target }`, the target its
   * crate's card while it is on its crate's tray, else its own box (`spec.look`, registered by its view). When a hand sets
   * it down and it has come to rest, and on `select` (a double-click or double-tap on it or its lever). Its crate asks as
   * it opens. Never on a pull.
   */
  const lookTarget = (): Id => {
    const l = ctx.part(spec.body)?.location;
    return spec.card !== undefined && l?.at === 'in' && ctx.mode(spec.body) === 'machine' ? spec.card : spec.look;
  };
  const askLook = (): void => ctx.emit({ type: 'look', target: lookTarget() });
  let lastMode: string | undefined = undefined;
  let setDown = false;
  /** The last press on the lever (its step), and a second press held a moment in case it is half of a double-tap. */
  let lastPress: number | undefined = undefined;
  let held: number | null = null;
  function pressOrHold(): boolean {
    if (ctx.bracketed) return false;
    const last = lastPress;
    lastPress = ctx.clock.step;
    if (last !== undefined && ctx.clock.step - last <= steps(PRESS_TUNING.doubleSeconds)) {
      held = ctx.clock.step;
      return true;
    }
    return pull();
  }
  function lookWhen(): void {
    const m = ctx.mode(spec.body);
    if (lastMode === 'held' && m !== 'held') setDown = true;
    if (setDown && (m === 'free' || m === 'machine') && (m === 'machine' || ctx.settled(spec.body))) {
      setDown = false;
      askLook();
    } else if (setDown && m !== 'free') setDown = false;
    lastMode = m;
  }
  /** A double-click or double-tap on the press or its lever: look at it; the double-tap's second press (held a moment, above) was half of it and is dropped. */
  function select(): boolean {
    if (ctx.bracketed || ctx.mode(spec.body) === 'gone' || ctx.mode(spec.body) === 'chute') return false;
    held = null;
    askLook();
    return true;
  }

  function runWaiting(): void {
    const w = waiting;
    if (!w) return;
    waiting = null;
    if (w.active && airborne()) refuse();
    else if (w.active) act((c) => w.commit(c).effects.length > 0, w.cause);
    w.done();
  }

  function pull(): boolean {
    if (ctx.bracketed) return false;
    ctx.emit({ type: 'handle.worked', id: spec.lever.id });
    if (!reachable()) {
      // carried, stowed, shipped: a misfire (the lever twitches; nothing is printed)
      lever.hit(1);
      ctx.emit({ type: 'misfire', id: spec.lever.id, level: 1 });
      return true;
    }
    if (airborne()) {
      // the envelope is in the air: the lever gives and springs back, and nothing is printed, so its landing can never
      // fall into a second pull's transaction
      refuse();
      return true;
    }
    const t = handleTxn(ctx, gesture(), 'press', spec.lever.id);
    if (playing() || waiting) {
      if (waiting) return true; // one pull waits at a time; a second is the same pull
      const job = ctx.history.work(t, spec.id, () => {
        if (waiting === job) waiting = null;
      });
      waiting = job;
      return true;
    }
    act((c) => ctx.commit(c, t).effects.length > 0, t);
    return true;
  }

  /** Shipped and the dock's return time gone by: back in the press, folded flat, its seal and its marks gone. */
  function goHome(h: { job: Job | null; at: number }): void {
    home = null;
    const p = ctx.part(spec.envelope);
    if (!p || p.location.at !== 'shipped' || ctx.mode(spec.envelope) !== 'gone') {
      h.job?.done();
      return;
    }
    const changes: Change[] = [
      { target: spec.envelope, field: 'location', after: HOME },
      { target: spec.envelope, field: 'marks', after: [] },
      { target: spec.envelope, field: SEAL_FIELD, after: null },
    ];
    const r = h.job?.active ? h.job.commit(changes) : { refused: changes };
    if (r.refused.length > 0) ctx.commit(r.refused, 'system');
    h.job?.done();
    ctx.emit({ type: 'press.home', id: spec.id, envelope: spec.envelope });
  }

  function expectHome(cause: Cause | null): void {
    home?.job?.done();
    const at = ctx.clock.step + steps(spec.homeAfter);
    const c = cause ?? ctx.history.chargeMachine(spec.envelope);
    const h: { job: Job | null; at: number } = { job: null, at };
    h.job = c === 'crew' || c === 'system' ? null : ctx.history.work(c, spec.id, () => {
      if (home === h) home = { job: null, at: h.at }; // (its shipment undone: the undo brings it back; were it still shipped, it comes home as the system)
    });
    home = h;
  }

  const unit: PressUnit = {
    id: spec.id,
    station: spec.station,
    name: bodySpec.name,
    // (the press is its own registry entry, as a part; the unit is listed only for its view: nothing to press here)
    affordances: [],
    tell() {
      ctx.emit({ type: 'tell', id: spec.lever.id });
    },
    misfire(level) {
      lever.hit(level);
    },

    intent(intent: Intent): boolean {
      if (intent.type === 'select' && (intent.id === spec.lever.id || intent.id === spec.body)) return select();
      if (intent.type !== 'press' || intent.id !== spec.lever.id) return false;
      return pressOrHold();
    },

    pre() {
      if (ctx.bracketed) return;
      // a second press no double-tap claimed: pulled now (a moment late: three steps)
      if (held !== null && ctx.clock.step - held >= PRESS_TUNING.doubleSteps) {
        held = null;
        pull();
      }
      lookWhen();
      if (show && !reachable()) {
        // out of reach or out of sight: drawn as its state says, at once; a pull waiting is done now; the flick does not happen
        show = null;
        if (flick) {
          flick.job.done();
          flick = null;
        }
        runWaiting();
      }
      if (show && !playing()) show = null;
      // a pull made before the flick waits for the show to end and the envelope to land (one made while the envelope is
      // in the air is refused at once: `pull`)
      if (!show && waiting && !airborne() && !flick) runWaiting();
      if (flick && ctx.clock.step >= flick.at) {
        const f = flick;
        flick = null;
        doFlick(f.job);
      }
      if (flight) step(flight);
      if (home && ctx.clock.step >= home.at) goHome(home);
    },

    post() {
      // the beats as they fall due (for sound, and for the live region)
      if (!show || ctx.bracketed) return;
      const t = elapsed();
      const beats = show.script.beats;
      while (show.said < beats.length && beats[show.said]!.at <= t) {
        const b = beats[show.said]!;
        ctx.emit({ type: 'press.beat', id: spec.id, body: spec.body, beat: b.kind, n: b.n });
        show.said++;
      }
    },

    lost(part: Id) {
      if (part === spec.envelope && flight) {
        // caught in the air, or put back by an undo or a reset: the world has it now
        const f = flight;
        flight = null;
        f.job.done();
      }
    },

    restored(restores: readonly Restore[]) {
      if (resetting) {
        // "Reset the workshop": the envelope's place is in the press. One let go and not yet at rest (flying, or come
        // back up the chute) still says so, unchanged, so no restore names it: it goes back in here.
        resetting = false;
        const l = ctx.part(spec.envelope)?.location;
        const m = ctx.mode(spec.envelope);
        if (l?.at === 'in' && l.mouth === spec.body && m !== 'gone' && m !== 'held') ctx.stow(spec.envelope, ctx.pose(spec.envelope) as Pose);
      }
      for (const r of restores) {
        if (r.target === spec.envelope && r.field === 'location') {
          const to = r.to as { at?: string; mouth?: Id } | null;
          if (to?.at === 'in' && to.mouth === spec.body) {
            // back in the press: out of the world again (the world brought it in where it was, or left it where it lay)
            if (flight) {
              flight.job.done();
              flight = null;
            }
            if (home) {
              home.job?.done();
              home = null;
            }
            const m = ctx.mode(spec.envelope);
            if (m === 'free' || m === 'machine') ctx.stow(spec.envelope, ctx.pose(spec.envelope) as Pose);
          } else if (to?.at === 'shipped' && ctx.mode(spec.envelope) === 'gone' && !home) expectHome('system');
        }
        if (r.target === spec.body && (r.field === REPORT_FIELD || r.field === DRAWER_FIELD)) {
          // a pull taken back (or the workshop reset): drawn as its state says; a waiting pull went with its transaction
          show = null;
          if (waiting && !waiting.active) waiting = null;
        }
      }
    },

    reset() {
      held = null;
      lastPress = undefined;
      resetting = true;
      record = [];
      show = null;
      waiting = null;
      flick = null;
      flight = null;
      home = null;
      shrugAt = -1;
      refusedAt = -1;
      lever.reset();
    },

    heard(events: readonly SimEvent[]) {
      for (const e of events) {
        if (e.type === 'shipped') {
          // (round three) the report is about the visitor: crates and tools, Fetch's included; never the envelope itself
          if (e.part !== spec.envelope) record.push({ part: e.part, colour: ctx.part(e.part)?.colour ?? 'bare' });
          if (e.part === spec.envelope) expectHome(null);
        } else if (e.type === 'returned' && e.how === 'door') {
          const i = record.map((s) => s.part).lastIndexOf(e.part);
          if (i >= 0) record.splice(i, 1);
        } else if (e.type === 'reset') record = [];
      }
    },

    // no mouth names the press's unit, so the world never offers it a part; were one to, it rests where it lies
    accept: (): Outcome => OK,
    abort() {
      // (rule 10 drops a waiting pull, a flick and a homecoming through their jobs' own aborts)
    },

    view(): PressView {
      const s = show;
      const l = ctx.part(spec.envelope)?.location;
      return {
        kind: 'press',
        id: spec.id,
        station: spec.station,
        lamp: 'dark',
        misfire: lever.view(),
        body: spec.body,
        envelope: spec.envelope,
        lever: spec.lever.id,
        report: report(),
        drawer: drawer(),
        seal: (ctx.setting(spec.envelope, SEAL_FIELD) as string | null) ?? null,
        envelopeIn: !!l && l.at === 'in' && l.mouth === spec.body && ctx.mode(spec.envelope) === 'gone',
        show: s ? { since: (ctx.clock.step - s.start) / HZ, before: s.before, after: s.after, drawer: s.drawer, envelope: s.envelope, beats: s.script.beats, length: s.script.length } : null,
        waiting: waiting !== null,
        shrug: shrugAt < 0 ? Infinity : (ctx.clock.step - shrugAt) / HZ,
        refused: refusedAt < 0 ? Infinity : (ctx.clock.step - refusedAt) / HZ,
        shipments: record.length,
      };
    },
  };
  return unit;
}

/** For tests: steps until a pull's show is over, with a margin. */
export const PRESS_SHOW_STEPS = steps(4) + 1;
