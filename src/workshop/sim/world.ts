/**
 * The world (REWRITE.md § E2: "the simulation does not know it is being
 * drawn"). Deterministic from a seed, stepped at a fixed 60 Hz, runnable in
 * Node. Everything a visitor does arrives as an `Intent` through `dispatch`;
 * the world alone decides what happens, and says so as `SimEvent`s.
 *
 * One step (`advance()`), in this fixed order:
 *   1. the clock ticks;
 *   2. queued intents are handled, in the order they were dispatched;
 *   3. machines, then the crew, run (`pre`), in scene order;
 *   4. the held part is driven toward the pointer;
 *   5. physics steps once (or, while a rung rewinds, the recording plays back);
 *   6. motion is read back; hits, the bench edge and rests are found;
 *   7. while a rung plays, the step's poses are recorded;
 *   8. machines and crew run `post`.
 *
 * Durable state changes only through `commit` (§ E5), which applies a
 * batch at once, keeps a writer per field and emits one `effect` event per
 * change. The undo stack (`history.ts`) decides who is charged and what an
 * undo puts back; the world applies it to the bodies and says so as one
 * `undone` event. At the end of every step the history closes timed-out
 * release windows and lets empty transactions go.
 */
import type { Cause, Effect, Id, Intent, Interactable, Location, Part, PartKind, PartMaterial, PartMotion, Pose, Restore, SimEvent, Value, Vec3, WorldView, CrewMember } from './types.ts';
import type { PhysicsPort, PhysicsSnapshot } from './physics/port.ts';
import type { SceneDesc } from './scene.ts';
import type { BodyMode, CommitResult, CrewHandle, Holding, SimContext, Unit } from './context.ts';
import type { Change, HistoryHooks, Recorded, TransactionView, UndoOutcome, UndoRequest } from './history.ts';
import type { Writer, StoreSnapshot } from './store.ts';
import type { ButtonView, ButtonUnit } from './machines/button.ts';
import type { CordView, CordUnit } from './machines/cord.ts';
import type { FetchUnit } from './crew/fetch.ts';
import { createClock, steps, HZ } from './clock.ts';
import { rng as makeRng } from './rng.ts';
import { Store, sameValue } from './store.ts';
import { Registry } from './registry.ts';
import { createHistory } from './history.ts';
import { MATERIAL, defaultHalfExtents, massOf } from './parts.ts';
import { add, clampLength, cross, dist, finitePose, length, qangle, qaxis, qconj, qmul, qnormalize, qyaw, rotate, rotationVector, scale, sub, yawOf } from './math.ts';
import { createButton } from './machines/button.ts';
import { createCord } from './machines/cord.ts';
import { createFetch, FETCH_TUNING } from './crew/fetch.ts';
import { vignette } from './scenes/vignette.ts';

/** How loose parts feel. Tune here (§ E0: "polish time goes to feel"). */
export const LOOSE_TUNING = {
  /** Carry spring: the held part closes this fraction of its gap per second (critically damped first order). */
  carryRate: 18,
  /** Carry speed limit, units/s. */
  carrySpeed: 11,
  /** Carry force limit, as an acceleration for a part of mass 1 (units/s²); lighter parts accelerate faster. */
  carryForce: 60,
  /** Carry acceleration ceiling whatever the mass. */
  carryAccelMax: 420,
  /** How high a part rises when picked up before the pointer moves, units. */
  lift: 0.35,
  /** Levelling: how fast the held part turns toward level (1/s) and its angular speed limit. */
  levelRate: 9,
  levelSpeed: 10,
  /** Yaw is held toward its value at the grab at this fraction of the levelling rate: it keeps facing the way it was picked up, with sway but no slow spin. */
  yawHold: 0.3,
  /** Lean into the motion: radians per unit/s of horizontal speed, and the most it leans. */
  lean: 0.035,
  leanMax: 0.28,
  /** Held parts keep this much angular velocity each step (sway), the rest is the levelling drive. */
  sway: 0.55,
  /** Throws are clamped to this speed, units/s. */
  throwMax: 7.5,
  /** Tumble on release: spin per unit/s of throw about the axis across the throw. */
  tumble: 0.7,
  /** A free part counts as disturbed above these speeds. */
  wakeLinear: 0.08,
  wakeAngular: 0.3,
  /** ...and as at rest below these for `restTime` seconds. */
  restLinear: 0.035,
  restAngular: 0.15,
  restTime: 0.3,
  /** A rest that moved less than this is not a new location (units, radians). */
  restSame: 0.004,
  restSameAngle: 0.01,
  /** Impulse onset that counts as a hit (simulation units). */
  hitMin: 0.04,
  /**
   * A release this soon after the grab (seconds), this slow (units/s) and this close to where the part
   * rests (horizontal units) is a cancelled pick-up: the part goes back exactly to its rest pose and
   * nothing is committed.
   */
  cancelTime: 0.25,
  cancelSpeed: 0.6,
  cancelDistance: 0.2,
  /** Spacing of returns up the chute when several fall at once, seconds. */
  chuteGap: 0.6,
} as const;

/** The world as the input, view, audio, ui and shell layers use it. */
/**
 * The world's write side, for the shell and the tests. Everything readable is
 * `WorldView` (sim/types.ts); `view`, `input`, `ui` and `audio` use only that.
 */
export interface World extends WorldView {
  /** The only way input reaches the world. Handled at the start of the next step, in order. */
  dispatch(intent: Intent): void;
  /** Advance exactly one fixed step (1/60 s). `WorldView.step` is the counter. */
  advance(): void;
  /** Events since the last drain, in order. */
  drainEvents(): SimEvent[];
  /** The single funnel for durable change (§ E5 rules 1-2). Throws on an invalid change, applying nothing. */
  commit(changes: readonly Change[], cause: Cause): CommitResult;
  /** Who last wrote a durable field (§ E5 rule 6). */
  writer(target: Id, field: string): Writer | undefined;
  /** Every durable field: target, field, value, writer (saving, the replay check, the bracket tests). */
  durable(): { target: Id; field: string; value: Value; writer: Writer }[];
  /** The undo stack, oldest first (§ E5): tests, and anything that shows whether the lever has something to take. */
  undoStack(): readonly TransactionView[];
  dispose(): void;
}

export interface WorldOptions {
  readonly seed: number | string;
  readonly physics: PhysicsPort;
  readonly scene?: SceneDesc;
  /** The history (§ E5). Default: the undo stack, `createHistory()`. `p1History()` keeps none (funnel tests). */
  readonly history?: HistoryHooks;
  /** More machines, run after the vignette's own in this order (P2's stations; the history tests' stand-ins). */
  readonly units?: readonly ((ctx: SimContext) => Unit)[];
  readonly runner?: Partial<typeof FETCH_TUNING>;
  /** The Button's rung and press count, remembered between visits (§ B4). */
  readonly button?: { rung: number; presses: number };
}

interface Loose {
  readonly id: Id;
  readonly half: Vec3;
  readonly mass: number;
  readonly material: PartMaterial;
  mode: BodyMode;
  pose: Pose;
  prev: Pose;
  awake: boolean;
  /** Set moving since it last rested. */
  unsettled: boolean;
  calm: number;
  /** Who a coming rest is charged to, if not the history's choice (`crew` after a fumble). */
  chargeTo: Cause | null;
  crewBy: Id | null;
  chuteAt: number;
  /** Where it is held, in its own frame. */
  grip: Vec3;
  /** Its yaw when it was picked up (held toward while carried). */
  grabYaw: number;
  /** The step it was picked up. */
  grabStep: number;
  /** Where the hand wants the grip point. */
  target: Vec3;
  /** Last step's impulse per contact partner, for hit onsets. */
  contacts: Map<Id, number>;
}

type LooseState = Omit<Loose, 'id' | 'half' | 'mass' | 'material' | 'contacts'> & { contacts: Map<Id, number> };

interface Bracket {
  readonly store: StoreSnapshot;
  readonly physics: PhysicsSnapshot;
  readonly loose: ReadonlyMap<Id, LooseState>;
  readonly frames: Map<Id, Pose>[];
  phase: 'record' | 'rewind';
  rewindSteps: number;
  rewound: number;
}

/** At most this many silent physics steps settle the scene at creation. */
const SETTLE_MAX_STEPS = 240;

const isTransaction = (c: Cause): boolean => c !== 'crew' && c !== 'system';

const PART_FIELDS = ['kind', 'size', 'material', 'colour', 'label', 'marks', 'contents', 'location'] as const;

function validLocation(v: Value): boolean {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const l = v as Location;
  if (l.at === 'shipped') return true;
  if (l.at === 'in') return typeof l.station === 'string' && typeof l.mouth === 'string';
  if (l.at === 'rest') return !!l.pose && l.pose.p.length === 3 && l.pose.q.length === 4 && finitePose(l.pose);
  return false;
}

const PART_VALIDATORS: Readonly<Record<(typeof PART_FIELDS)[number], (v: Value) => boolean>> = {
  kind: (v) => v === 'crate' || v === 'tool' || v === 'robot',
  size: (v) => v === 'S' || v === 'M' || v === 'L',
  material: (v) => v === 'wood' || v === 'metal' || v === 'paper' || v === 'rubber',
  colour: (v) => typeof v === 'string' && v.length > 0,
  label: (v) => typeof v === 'string' && v.length <= 16,
  marks: (v) => Array.isArray(v) && v.every((m) => typeof m === 'string'),
  contents: (v) => v === null || typeof v === 'string',
  location: validLocation,
};

export function createWorld(opts: WorldOptions): World {
  const scene = opts.scene ?? vignette;
  const physics = opts.physics;
  const history = opts.history ?? createHistory();
  const clock = createClock();
  const root = makeRng(opts.seed);
  const store = new Store();
  const registry = new Registry();
  const validators = new Map<string, (v: Value) => boolean>();
  const vkey = (t: Id, f: string): string => `${t}\u0000${f}`;
  const loose = new Map<Id, Loose>();
  const crewHandles = new Map<Id, CrewHandle>();
  const touchedSet = new Set<Id>();
  const partCache = new Map<Id, Part>();
  let events: SimEvent[] = [];
  let queue: Intent[] = [];
  let playMode = false;
  let bracket: Bracket | null = null;
  let held: Holding | null = null;
  let lastInput = 0;
  let lastChuteRelease = -Infinity;
  let hovered: Id | null = null;
  const emit = (e: SimEvent): void => {
    events.push(e);
  };
  const T = LOOSE_TUNING;

  physics.setGravity(scene.gravity);
  for (const s of scene.statics) physics.addStatic(s);

  // ── parts: durable fields, bodies, registry entries ──
  for (const spec of scene.parts) {
    const half = spec.half ?? defaultHalfExtents(spec.kind, spec.size);
    const mass = spec.mass ?? massOf(half, spec.material);
    const m = MATERIAL[spec.material];
    const values: Record<(typeof PART_FIELDS)[number], Value> = {
      kind: spec.kind,
      size: spec.size,
      material: spec.material,
      colour: spec.colour,
      label: spec.label,
      marks: spec.marks ?? [],
      contents: spec.contents ?? null,
      location: { at: 'rest', pose: spec.pose }, // replaced by the settled pose below
    };
    for (const f of PART_FIELDS) {
      if (f === 'location') continue;
      if (!PART_VALIDATORS[f](values[f])) throw new Error(`scene: part ${spec.id} has an invalid ${f}`);
      store.define(spec.id, f, values[f]);
      validators.set(vkey(spec.id, f), PART_VALIDATORS[f]);
    }
    physics.addBody({ id: spec.id, kind: 'dynamic', shape: { type: 'box', half }, pose: spec.pose, mass, friction: m.friction, restitution: m.restitution, linearDamping: m.linearDamping, angularDamping: m.angularDamping, ccd: true });
    loose.set(spec.id, { id: spec.id, half, mass, material: spec.material, mode: 'free', pose: spec.pose, prev: spec.pose, awake: false, unsettled: false, calm: 0, chargeTo: null, crewBy: null, chuteAt: 0, grip: [0, 0, 0], grabYaw: 0, grabStep: 0, target: spec.pose.p, contacts: new Map() });
    registry.add({
      id: spec.id,
      station: spec.station,
      name: spec.name,
      affordances: ['grab'],
      tell: () => emit({ type: 'tell', id: spec.id }),
      misfire: (level) => emit({ type: 'misfire', id: spec.id, level }),
    });
  }
  // Settle the scene before the visit begins: a hand-written stack is never exactly at rest
  // in the engine, and the world must start with every part at rest where its location says.
  for (let i = 0; i < SETTLE_MAX_STEPS; i++) {
    physics.step();
    if (physics.bodies().every((id) => physics.state(id).sleeping)) break;
  }
  for (const l of loose.values()) {
    const p = physics.pose(l.id);
    l.pose = p;
    l.prev = p;
    l.target = p.p;
    store.define(l.id, 'location', { at: 'rest', pose: p });
    validators.set(vkey(l.id, 'location'), PART_VALIDATORS.location);
  }

  for (const f of scene.fixtures) {
    registry.add({ id: f.id, station: f.station, name: f.name, affordances: f.affordances, tell: () => emit({ type: 'tell', id: f.id }), misfire: (level) => emit({ type: 'misfire', id: f.id, level }) });
  }

  function lp(id: Id): Loose {
    const l = loose.get(id);
    if (!l) throw new Error(`world: no part "${id}"`);
    return l;
  }

  // ── the commit funnel ──
  function commit(changes: readonly Change[], cause: Cause): CommitResult {
    if (bracket) throw new Error('world: nothing commits while a Button rung is bracketed (§ E5)');
    // validate everything before applying anything (atomic); repeated fields merge (one entry per field)
    const merged = new Map<string, Change>();
    for (const c of changes) {
      if (!store.has(c.target, c.field)) throw new Error(`commit: ${c.target}.${c.field} is not a durable field`);
      const ok = validators.get(vkey(c.target, c.field));
      if (ok && !ok(c.after)) throw new Error(`commit: invalid value for ${c.target}.${c.field}`);
      merged.delete(vkey(c.target, c.field));
      merged.set(vkey(c.target, c.field), c);
    }
    const refused: Change[] = [];
    const recorded: Recorded[] = [];
    for (const c of merged.values()) {
      const slot = store.slot(c.target, c.field);
      if (!slot) continue;
      if (!history.admit(c, cause, slot.writer)) {
        refused.push(c);
        continue;
      }
      if (sameValue(slot.value, c.after) && slot.writer === cause) continue;
      const effect: Effect = { target: c.target, field: c.field, before: slot.value, after: c.after, cause };
      recorded.push({ effect, previousWriter: slot.writer });
    }
    for (const r of recorded) {
      store.write(r.effect.target, r.effect.field, r.effect.after, cause);
      partCache.delete(r.effect.target);
      if (isTransaction(cause) && loose.has(r.effect.target)) touchedSet.add(r.effect.target); // § E5 rule 5: changed by the visitor
    }
    const effects = recorded.map((r) => r.effect);
    if (recorded.length > 0) history.recorded(recorded, clock.step);
    for (const e of effects) emit({ type: 'effect', effect: e });
    return { effects, refused };
  }

  // ── loose-part control ──
  function setMode(l: Loose, mode: BodyMode): void {
    l.mode = mode;
  }

  function release(l: Loose, linvel: Vec3, angvel: Vec3): void {
    physics.setKind(l.id, 'dynamic');
    physics.setGravityScale(l.id, 1);
    const m = MATERIAL[l.material];
    physics.setDamping(l.id, m.linearDamping, m.angularDamping);
    physics.setVelocity(l.id, linvel, angvel);
    physics.wake(l.id);
    setMode(l, 'free');
    l.unsettled = true;
    l.calm = 0;
  }

  function grab(id: Id, grip: Vec3): boolean {
    if (bracket || held) return false;
    const l = loose.get(id);
    if (!l || l.mode === 'chute') return false;
    if (l.mode === 'crew') {
      const by = l.crewBy;
      if (by === id) crewHandles.get(id)?.grabbed();
      else if (by !== null) crewHandles.get(by)?.taken(id);
    }
    const pose = physics.pose(id);
    physics.setKind(id, 'dynamic');
    physics.setGravityScale(id, 0);
    physics.setDamping(id, 0, 0);
    physics.wake(id);
    setMode(l, 'held');
    l.crewBy = null;
    l.chargeTo = null;
    // the grip point in the part's own frame, kept inside the part
    const local = rotate(qconj(pose.q), sub(grip, pose.p));
    l.grip = [Math.max(-l.half[0], Math.min(l.half[0], local[0])), Math.max(-l.half[1], Math.min(l.half[1], local[1])), Math.max(-l.half[2], Math.min(l.half[2], local[2]))];
    l.target = add(add(pose.p, rotate(pose.q, l.grip)), [0, T.lift, 0]);
    l.grabYaw = yawOf(pose.q);
    l.grabStep = clock.step;
    touchedSet.add(id);
    history.take(id); // § E5 rule 4: a moving part picked up leaves its window at once
    held = { kind: 'part', id };
    emit({ type: 'part.grabbed', id });
    return true;
  }

  /** A pick-up let go of at once, at rest, where it was: put it back exactly; nothing moved, so nothing commits. */
  function cancelledPickUp(l: Loose, velocity: Vec3): boolean {
    if (clock.step - l.grabStep > steps(T.cancelTime) || length(velocity) > T.cancelSpeed) return false;
    const loc = store.get(l.id, 'location') as Location;
    if (loc.at !== 'rest') return false;
    const p = physics.pose(l.id).p;
    if (Math.hypot(p[0] - loc.pose.p[0], p[2] - loc.pose.p[2]) > T.cancelDistance) return false;
    physics.setPose(l.id, loc.pose);
    release(l, [0, 0, 0], [0, 0, 0]);
    physics.sleep(l.id);
    l.unsettled = false; // it is where its location says: no rest to commit
    l.chargeTo = null;
    l.pose = loc.pose;
    l.prev = loc.pose;
    held = null;
    emit({ type: 'part.released', id: l.id, speed: 0 });
    return true;
  }

  function letGoOfPart(l: Loose, velocity: Vec3, kind: 'release' | 'place'): void {
    if (kind === 'release' && cancelledPickUp(l, velocity)) return;
    const v = clampLength(velocity, T.throwMax);
    const spin = scale(cross([0, 1, 0], v), T.tumble);
    const current = physics.state(l.id).angvel;
    release(l, v, add(scale(current, 0.5), spin));
    held = null;
    const txn = history.open(kind, l.id, clock.step);
    history.claim(l.id, txn, clock.step);
    emit({ type: 'part.released', id: l.id, speed: length(v) });
  }

  function clampTarget(l: Loose, t: Vec3): Vec3 {
    const b = scene.bench;
    const margin = 1.0;
    return [Math.max(b.minX - margin, Math.min(b.maxX + margin, t[0])), Math.max(b.top + l.half[1] + 0.03, Math.min(b.ceiling, t[1])), Math.max(b.minZ + l.half[2], Math.min(b.maxZ + margin, t[2]))];
  }

  function driveHeld(): void {
    if (!held || held.kind !== 'part') return;
    const l = lp(held.id);
    const st = physics.state(l.id);
    const level = qyaw(yawOf(st.pose.q));
    const centreTarget = sub(clampTarget(l, l.target), rotate(level, l.grip));
    const gap = sub(centreTarget, st.pose.p);
    const desired = clampLength(scale(gap, T.carryRate), T.carrySpeed);
    const accel = Math.min(T.carryAccelMax, T.carryForce / Math.max(l.mass, 1e-3));
    const dv = clampLength(sub(desired, st.linvel), accel / HZ);
    const v = add(st.linvel, dv);
    // level-ish, leaning into the motion, with a little sway
    const hv: Vec3 = [v[0], 0, v[2]];
    const hs = length(hv);
    let goal = level;
    if (hs > 1e-4) {
      const axis = scale(cross([0, 1, 0], hv), 1 / hs);
      goal = qmul(qaxis(axis, Math.min(T.leanMax, hs * T.lean)), level);
    }
    const err = rotationVector(qmul(goal, qconj(st.pose.q)));
    // and back toward the yaw it had when picked up, gently
    let dyaw = l.grabYaw - yawOf(st.pose.q);
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    const wGoal = clampLength(add(scale(err, T.levelRate), [0, dyaw * T.levelRate * T.yawHold, 0]), T.levelSpeed);
    const w = add(scale(st.angvel, T.sway), scale(wGoal, 1 - T.sway));
    physics.setVelocity(l.id, v, w);
  }

  /** Read every part's pose back. `exact`: poses to report as given (the rewind's recorded frame; the engine may renormalise a set rotation by an ulp). */
  function readMotion(exact?: ReadonlyMap<Id, Pose>): void {
    for (const l of loose.values()) {
      if (l.mode === 'chute') {
        l.prev = l.pose;
        l.awake = false;
        continue;
      }
      const st = physics.state(l.id);
      l.prev = l.pose;
      l.pose = exact?.get(l.id) ?? st.pose;
      l.awake = l.mode === 'held' || l.mode === 'crew' ? dist(l.prev.p, l.pose.p) > 1e-6 || qangle(l.prev.q, l.pose.q) > 1e-6 : !st.sleeping;
    }
  }

  function hits(contacts: ReturnType<PhysicsPort['step']>): void {
    const now = new Map<Id, Map<Id, number>>();
    const note = (a: Id, b: Id, impulse: number) => {
      let m = now.get(a);
      if (!m) now.set(a, (m = new Map()));
      m.set(b, impulse);
    };
    for (const c of contacts) {
      note(c.a, c.b, c.impulse);
      note(c.b, c.a, c.impulse);
      const la = loose.get(c.a);
      const lb = loose.get(c.b);
      if (!la && !lb) continue;
      const prevA = la?.contacts.get(c.b) ?? lb?.contacts.get(c.a) ?? 0;
      if (c.impulse < T.hitMin || prevA >= c.impulse * 0.5) continue;
      // one event per pair, for the faster of the two parts
      const speedOf = (l: Loose | undefined) => (l ? length(physics.state(l.id).linvel) : -1);
      const [who, other] = speedOf(la) >= speedOf(lb) ? [c.a, c.b] : [c.b, c.a];
      emit({ type: 'part.hit', id: who, other: loose.has(other) ? other : null, strength: c.impulse });
    }
    for (const l of loose.values()) l.contacts = now.get(l.id) ?? new Map();
  }

  function offBench(p: Vec3): boolean {
    const b = scene.bench;
    return p[1] < scene.fallY || p[0] < b.minX || p[0] > b.maxX || p[2] < b.minZ || p[2] > b.maxZ || !Number.isFinite(p[0] + p[1] + p[2]);
  }

  function edgeAndChute(): void {
    for (const l of loose.values()) {
      if (l.mode === 'free' && (l.pose.p[1] < scene.fallY || !finitePose(l.pose))) {
        physics.setEnabled(l.id, false);
        setMode(l, 'chute');
        l.unsettled = false;
        l.chuteAt = Math.max(clock.step + steps(scene.chute.delay), lastChuteRelease + steps(T.chuteGap));
        lastChuteRelease = l.chuteAt;
      } else if (l.mode === 'chute' && clock.step >= l.chuteAt) {
        const yaw = finitePose(l.pose) ? yawOf(l.pose.q) : 0;
        const p: Pose = { p: scene.chute.pose.p, q: qnormalize(qmul(scene.chute.pose.q, qyaw(yaw))) };
        physics.setEnabled(l.id, true);
        physics.setPose(l.id, p);
        release(l, scene.chute.linvel, [0, 0, 0]);
        l.pose = p;
        l.prev = p;
        l.chargeTo = history.chargeReturn(l.id, clock.step);
        emit({ type: 'part.returned', id: l.id });
      }
    }
  }

  function rests(): void {
    const restSteps = steps(T.restTime);
    for (const l of loose.values()) {
      if (l.mode !== 'free') continue;
      const st = physics.state(l.id);
      const lin = length(st.linvel);
      const ang = length(st.angvel);
      if (lin > T.wakeLinear || ang > T.wakeAngular) {
        if (!l.unsettled) history.disturbed(l.id); // § E5 rule 4: set moving by something else; an open window takes it
        l.unsettled = true;
        l.calm = 0;
        continue;
      }
      if (!l.unsettled) continue;
      if (lin < T.restLinear && ang < T.restAngular) l.calm += 1;
      else l.calm = 0;
      if (l.calm < restSteps && !st.sleeping) continue;
      // at rest
      l.unsettled = false;
      l.calm = 0;
      if (offBench(st.pose.p)) {
        // resting somewhere that is not the bench (on top of the back wall): the edge takes it
        physics.setEnabled(l.id, false);
        setMode(l, 'chute');
        l.chuteAt = Math.max(clock.step + steps(scene.chute.delay), lastChuteRelease + steps(T.chuteGap));
        lastChuteRelease = l.chuteAt;
        continue;
      }
      const cause = history.chargeRest(l.id, clock.step, l.chargeTo);
      l.chargeTo = null;
      const loc = store.get(l.id, 'location') as Location;
      const same = loc.at === 'rest' && dist(loc.pose.p, st.pose.p) < T.restSame && qangle(loc.pose.q, st.pose.q) < T.restSameAngle;
      if (!same) commit([{ target: l.id, field: 'location', after: { at: 'rest', pose: st.pose } }], cause);
      emit({ type: 'part.rested', id: l.id });
    }
  }

  // ── the Button's bracket ──
  function framePoses(): Map<Id, Pose> {
    const m = new Map<Id, Pose>();
    for (const l of loose.values()) if (l.mode !== 'chute') m.set(l.id, physics.pose(l.id));
    return m;
  }
  const looseState = (l: Loose): LooseState => ({ mode: l.mode, pose: l.pose, prev: l.prev, awake: l.awake, unsettled: l.unsettled, calm: l.calm, chargeTo: l.chargeTo, crewBy: l.crewBy, chuteAt: l.chuteAt, grip: l.grip, grabYaw: l.grabYaw, grabStep: l.grabStep, target: l.target, contacts: new Map(l.contacts) });

  // ── the history (§ E5) ──
  history.bind({
    store,
    commit: (c, cause) => commit(c, cause),
    kindOf: (id) => (loose.has(id) ? (store.get(id, 'kind') as PartKind) : undefined),
    touched: (id) => touchedSet.has(id),
    playMode: () => playMode,
  });

  /** § E5 rule 9: a part whose location is restored to `rest` is put there at once, without physics (the hop is drawn). */
  function putBack(l: Loose, loc: Location): void {
    if (loc.at !== 'rest' || (l.mode !== 'free' && l.mode !== 'chute')) return;
    // TODO(P2 belt/dock): "if the place is taken, to the nearest free spot" is not done here: the restored
    // value is exactly the recorded one (the replay check holds), and a body put into an occupied place is
    // left for physics to part. In and shipped are for the machine that owns the mouth (`Unit.restored`).
    if (l.mode === 'chute') physics.setEnabled(l.id, true);
    physics.setPose(l.id, loc.pose);
    release(l, [0, 0, 0], [0, 0, 0]);
    physics.sleep(l.id);
    l.unsettled = false;
    l.chargeTo = null;
    l.pose = loc.pose;
    l.prev = loc.pose; // a jump, never interpolated; the view draws the hop from `Restore.pose`
    l.contacts = new Map();
  }

  /** The lever, or "undo that": the history restores the durable fields; the world moves the bodies and says what happened. */
  function performUndo(req: UndoRequest): UndoOutcome {
    if (bracket) return { ok: false, reason: 'frozen', txn: null };
    const out = history.undo(req, clock.step);
    if (!out.ok) {
      if (out.reason !== 'frozen') emit({ type: 'undo.refused', by: req.by, reason: out.reason, txn: out.txn });
      return out;
    }
    const u = out.undone;
    partCache.clear();
    const restores: Restore[] = [];
    // parts still flying under the undone action: their location never changed; they come back first (the latest motion)
    for (const id of u.recalled) {
      const l = loose.get(id);
      const slot = store.slot(id, 'location');
      if (!l || !slot) continue;
      restores.push({ target: id, field: 'location', from: slot.value, to: slot.value, writer: slot.writer, pose: l.pose });
      putBack(l, slot.value as Location);
    }
    for (const r of u.restores) {
      const l = r.field === 'location' ? loose.get(r.target) : undefined;
      if (!l) {
        restores.push(r);
        continue;
      }
      restores.push({ ...r, pose: l.pose });
      putBack(l, r.to as Location);
    }
    emit({ type: 'undone', txn: u.txn, action: u.action, by: u.by, restores, kept: u.kept, cancelled: u.cancelled });
    for (const un of units) un.restored?.(restores);
    return { ok: true, undone: { ...u, restores } };
  }

  // ── machines and crew ──
  let units: Unit[] = [];
  const ctx: SimContext = {
    clock,
    scene,
    history,
    rng: (name) => root.fork(name),
    emit,
    commit: (c, cause) => commit(c, cause),
    part: (id) => world.part(id),
    setting: (t, f) => store.get(t, f),
    defineSetting(target, field, initial, valid) {
      if (!valid(initial)) throw new Error(`setting ${target}.${field}: invalid starting value`);
      store.define(target, field, initial);
      validators.set(vkey(target, field), valid);
    },
    register: (i) => registry.add(i),
    interactable: (id) => registry.get(id),
    get playMode() {
      return playMode;
    },
    get bracketed() {
      return bracket !== null;
    },
    holding: () => held,
    hold(h) {
      held = h;
    },
    letGo() {
      held = null;
    },
    idleSteps: () => clock.step - lastInput,
    touched: (id) => touchedSet.has(id),
    halfExtents: (id) => loose.get(id)?.half,
    mode: (id) => loose.get(id)?.mode,
    pose: (id) => (loose.has(id) ? lp(id).pose : undefined),
    settled: (id) => {
      const l = loose.get(id);
      return !!l && l.mode === 'free' && !l.unsettled;
    },
    attach(id, by) {
      const l = loose.get(id);
      if (!l || (l.mode !== 'free' && !(l.mode === 'crew' && l.crewBy === by))) return false;
      if (by !== id && touchedSet.has(id)) return false; // § E5 rule 5
      physics.setKind(id, 'kinematic');
      physics.setGravityScale(id, 1);
      setMode(l, 'crew');
      l.crewBy = by;
      l.unsettled = false;
      l.calm = 0;
      return true;
    },
    drive(id, pose, teleport = false) {
      const l = lp(id);
      if (l.mode !== 'crew') return;
      if (teleport) {
        physics.setPose(id, pose);
        l.pose = pose;
        l.prev = pose;
      }
      physics.driveKinematic(id, pose);
    },
    detach(id, linvel, angvel, cause) {
      const l = lp(id);
      if (l.mode !== 'crew') return;
      l.crewBy = null;
      release(l, linvel, angvel);
      l.chargeTo = cause;
    },
    shove(id, dv) {
      const l = loose.get(id);
      if (!l || l.mode !== 'free') return;
      const st = physics.state(id);
      physics.setVelocity(id, add(st.linvel, dv), st.angvel);
      physics.wake(id);
      l.unsettled = true;
    },
    crewFor: (part, handle) => crewHandles.set(part, handle),
    undo: (req) => performUndo(req),
    putAway(part, at) {
      if (bracket) throw new Error('world: nothing is put away while a Button rung is bracketed (§ E5)');
      const l = lp(part);
      history.putAway(part); // rule 14: every entry about it is forgotten first
      touchedSet.delete(part); // restocked: a fresh part again, the crew may use it (rule 5)
      partCache.delete(part);
      emit({ type: 'put-away', id: part });
      const r = commit([{ target: part, field: 'location', after: at }], 'system');
      if (l.mode === 'free' || l.mode === 'chute') putBack(l, at);
      return r;
    },

    beginBracket() {
      if (bracket) throw new Error('world: a bracket is already open');
      bracket = {
        store: store.snapshot(),
        physics: physics.snapshot(),
        loose: new Map([...loose.values()].map((l) => [l.id, looseState(l)])),
        frames: [framePoses()],
        phase: 'record',
        rewindSteps: 0,
        rewound: 0,
      };
      history.bracket(true);
      for (const u of units) u.bracket?.(true);
    },
    beginRewind(n) {
      if (!bracket) throw new Error('world: no bracket to rewind');
      bracket.phase = 'rewind';
      bracket.rewindSteps = Math.max(1, n);
      bracket.rewound = 0;
    },
    endBracket() {
      if (!bracket) throw new Error('world: no bracket to close');
      const b = bracket;
      physics.restore(b.physics);
      store.restore(b.store);
      partCache.clear();
      for (const [id, s] of b.loose) {
        const l = lp(id);
        // keep this step's `prev` (the second-last rewind frame) so the last rewind step still
        // interpolates; the restored pose is the first recorded frame, so nothing jumps.
        // A part that was in the chute at the press was never drawn: no interpolation.
        const prev = l.prev;
        Object.assign(l, s, { contacts: new Map(s.contacts) });
        l.prev = s.mode === 'chute' ? l.pose : prev;
      }
      bracket = null;
      history.bracket(false);
      for (const u of units) u.bracket?.(false);
    },
  };

  /** One step of the rung's rewind: put every body at its recorded pose. Returns the frame shown. */
  function playback(): ReadonlyMap<Id, Pose> | undefined {
    const b = bracket;
    if (!b) return undefined;
    b.rewound += 1;
    const f = Math.min(1, b.rewound / b.rewindSteps);
    const idx = Math.round((1 - f) * (b.frames.length - 1));
    const frame = b.frames[idx];
    if (!frame) return undefined;
    for (const [id, p] of frame) {
      const l = lp(id);
      if (l.mode === 'chute') {
        physics.setEnabled(id, true);
        setMode(l, 'free');
      }
      physics.setPose(id, p);
      if (l.mode === 'free' || l.mode === 'held') physics.setVelocity(id, [0, 0, 0], [0, 0, 0]);
    }
    return frame;
  }

  const button: ButtonUnit = createButton(ctx, opts.button);
  const cord: CordUnit = createCord(ctx);
  const runner: FetchUnit = createFetch(ctx, opts.runner);
  units = [button, cord, runner, ...(opts.units ?? []).map((make) => make(ctx))];
  /** How the visit began: what "Reset the workshop" goes back to. */
  const initial = store.snapshot();

  /** "Reset the workshop": cancel every pending job, empty the stack, every durable field back to its start (writer settled). */
  function reset(): boolean {
    if (bracket) return false;
    if (held?.kind === 'plug') cord.drop();
    else if (held) {
      release(lp(held.id), [0, 0, 0], [0, 0, 0]);
      held = null;
    }
    history.reset();
    const restores: Restore[] = [];
    const now = [...store.entries()];
    store.restore(initial);
    for (const { target, field, slot } of now) {
      const start = store.slot(target, field) as NonNullable<ReturnType<Store['slot']>>;
      if (sameValue(slot.value, start.value) && slot.writer === start.writer) continue;
      const l = field === 'location' ? loose.get(target) : undefined;
      restores.push({ target, field, from: slot.value, to: start.value, writer: start.writer, ...(l ? { pose: l.pose } : {}) });
    }
    partCache.clear();
    touchedSet.clear();
    for (const l of loose.values()) putBack(l, store.get(l.id, 'location') as Location);
    emit({ type: 'reset', restores });
    for (const u of units) u.restored?.(restores);
    return true;
  }

  // ── intents ──
  function handle(intent: Intent): boolean {
    switch (intent.type) {
      case 'hover':
        hovered = intent.id;
        return false;
      case 'grab':
        return grab(intent.id, intent.grip);
      case 'carry':
        if (bracket || !held) return false;
        if (held.kind === 'part') lp(held.id).target = intent.target;
        else cord.carry(intent.target);
        return false;
      case 'release':
        if (!held) return false;
        if (held.kind === 'plug') {
          cord.drop();
          return true;
        }
        letGoOfPart(lp(held.id), intent.velocity, 'release');
        return true;
      case 'place': {
        if (!held) return false;
        if (held.kind === 'plug') return cord.intent?.({ type: 'plug', cord: held.id, jack: typeof intent.at === 'string' ? intent.at : null }) ?? false;
        if (typeof intent.at === 'string') return false; // no mouths in the vignette yet
        const l = lp(held.id);
        const st = physics.state(l.id);
        const spot = clampTarget(l, [intent.at[0], intent.at[1] + l.half[1] + 0.01, intent.at[2]]);
        physics.setPose(l.id, { p: spot, q: qyaw(yawOf(st.pose.q)) });
        letGoOfPart(l, [0, 0, 0], 'place');
        physics.setVelocity(l.id, [0, 0, 0], [0, 0, 0]);
        return true;
      }
      case 'undo':
        if (bracket) return false; // § B4: handles do not respond while a rung plays
        performUndo({ by: 'lever' });
        return true;
      case 'reset':
        return reset();
      default:
        if (bracket && intent.type !== 'press') return false;
        for (const u of units) if (u.intent?.(intent)) return true;
        return false;
    }
  }

  const world: World = {
    scene,
    get time() {
      return clock.time;
    },
    get step() {
      return clock.step;
    },
    get playMode() {
      return playMode;
    },
    get bracketed() {
      return bracket !== null;
    },
    get hovered() {
      return hovered;
    },

    dispatch(intent) {
      queue.push(intent);
      lastInput = clock.step;
    },

    advance() {
      clock.tick();
      const pending = queue;
      queue = [];
      for (const intent of pending) {
        if (handle(intent) && intent.type !== 'hover' && intent.type !== 'carry') playMode = true;
      }
      for (const u of units) u.pre?.();
      if (bracket?.phase === 'rewind') {
        readMotion(playback());
      } else {
        driveHeld();
        const contacts = physics.step();
        readMotion();
        hits(contacts);
        if (!bracket) {
          edgeAndChute();
          rests();
        } else bracket.frames.push(framePoses());
      }
      for (const u of units) u.post?.();
      history.endStep(clock.step);
    },

    drainEvents() {
      const out = events;
      events = [];
      return out;
    },

    commit,
    writer: (t, f) => store.writer(t, f),
    durable: () => [...store.entries()].map(({ target, field, slot }) => ({ target, field, value: slot.value, writer: slot.writer })),
    undoStack: () => history.stack(),

    *parts() {
      for (const id of loose.keys()) {
        const p = world.part(id);
        if (p) yield p;
      }
    },
    part(id) {
      if (!loose.has(id)) return undefined;
      let p = partCache.get(id);
      if (!p) {
        const g = (f: string) => store.get(id, f);
        p = Object.freeze({
          id,
          kind: g('kind'),
          size: g('size'),
          material: g('material'),
          colour: g('colour'),
          label: g('label'),
          marks: g('marks'),
          contents: g('contents'),
          location: g('location'),
        }) as Part;
        partCache.set(id, p);
      }
      return p;
    },
    motion(id): PartMotion | undefined {
      const l = loose.get(id);
      if (!l) return undefined;
      return { pose: l.pose, prev: l.prev, held: l.mode === 'held', awake: l.awake, mode: l.mode };
    },
    setting: (t, f) => store.get(t, f),
    interactables: () => registry.all(),
    interactable: (id) => registry.get(id),
    crew(id): CrewMember | undefined {
      return id === scene.runner.id ? runner.member() : undefined;
    },
    holding: () => held,
    mode: (id) => loose.get(id)?.mode,
    halfExtents: (id) => loose.get(id)?.half,
    touched: (id) => touchedSet.has(id),
    button: () => button.view(),
    cord: (id) => (id === scene.cord.id ? cord.view() : undefined),
    dispose() {
      physics.dispose();
    },
  };
  return world;
}
