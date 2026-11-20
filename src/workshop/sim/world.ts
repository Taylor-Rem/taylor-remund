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
import type { Cause, CrewView, Effect, Id, Intent, Interactable, Lens, Location, MachineView, Part, PartKind, PartMaterial, PartMotion, Pose, Restore, SimEvent, Value, Vec3, WorldView, CrewMember } from './types.ts';
import type { PhysicsPort, PhysicsSnapshot } from './physics/port.ts';
import type { MouthSpec, SceneDesc } from './scene.ts';
import type { BodyMode, CommitResult, CrewHandle, Holding, LostReason, MachineUnit, SimContext, Unit } from './context.ts';
import { isMachine } from './context.ts';
import type { Change, HistoryHooks, Recorded, TransactionView, UndoOutcome, UndoRequest } from './history.ts';
import type { Writer, StoreSnapshot } from './store.ts';
import type { ButtonView, ButtonUnit, ButtonSaved } from './machines/button.ts';
import type { CordView, CordUnit } from './machines/cord.ts';
import type { FetchUnit } from './crew/fetch.ts';
import { createClock, steps, HZ } from './clock.ts';
import { rng as makeRng } from './rng.ts';
import { Store, sameValue } from './store.ts';
import { Registry } from './registry.ts';
import { createHistory } from './history.ts';
import { MATERIAL, defaultHalfExtents, massOf } from './parts.ts';
import { add, clampLength, cross, dist, dot, finitePose, length, qangle, qaxis, qconj, qmul, qnormalize, qyaw, rotate, rotationVector, scale, sub, yawOf } from './math.ts';
import { inMouth } from './mouths.ts';
import { createButton } from './machines/button.ts';
import { createCord } from './machines/cord.ts';
import { createFetch, FETCH_TUNING } from './crew/fetch.ts';
import { vignette } from './scenes/vignette.ts';

/** How loose parts feel. Tune here (§ E0: "polish time goes to feel"). */
/** How much of the light crates' throw a part of this mass gets (1 for a small or middle crate, less for a heavy part). */
const throwShare = (mass: number): number => {
  const T = LOOSE_TUNING;
  return Math.max(T.throwMassMin, Math.min(1, (T.throwMassRef / Math.max(mass, 1e-3)) ** T.throwMassExp));
};

/** The fastest a part of this mass ends up going after it leaves the hand (`LOOSE_TUNING.throwMax`, less for a heavy part). */
export function throwCap(mass: number): number {
  return LOOSE_TUNING.throwMax * throwShare(mass);
}

/** x itself up to `knee`; past it, less and less of the rest, never reaching `max` (a harder flick always throws harder). */
export function softCeiling(x: number, knee: number, max: number): number {
  if (x <= knee || max <= knee) return Math.min(x, Math.max(knee, max));
  return knee + (max - knee) * (1 - Math.exp(-(x - knee) / (max - knee)));
}

const smoothstep = (a: number, b: number, x: number): number => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/**
 * A throw's speed made one the bench can hold, for a part of this mass let go at height `y` (its centre): the level
 * part and the upward part each keep what they have up to a knee and then give way softly toward their most (so
 * every ordinary throw leaves exactly as it was thrown, and a harder flick still throws harder); the upward part is
 * also never so fast that its centre would rise past `upApex` (under the scene's ceiling, and under the top of the
 * back wall's body, which stands 9 high so that nothing goes over it); downward it is held to the level most.
 */
export function clampThrow(v: Vec3, mass: number, y: number, gravity: number): Vec3 {
  const T = LOOSE_TUNING;
  const k = throwShare(mass);
  const hs = Math.hypot(v[0], v[2]);
  const hk = hs > 1e-9 ? softCeiling(hs, T.throwKnee * k, T.throwMax * k) / hs : 1;
  const g = Math.abs(gravity);
  const apexRoom = Math.max(0, T.upApex - y);
  const up = Math.min(softCeiling(Math.max(0, v[1]), T.upKnee * k, T.upMax * k), Math.sqrt(2 * g * apexRoom));
  const vy = v[1] > 0 ? up : Math.max(-T.throwMax * k, v[1]);
  return [v[0] * hk, vy, v[2] * hk];
}

/**
 * What a hand threw, from what the thing in it was doing over its last steps (`samples`: its velocity each step,
 * newest last) and where the hand itself was (`hand`: its place each step). The way the thing was going at the
 * end, at the speed it had there (the faster of its last step and its last two together: one step's figure can be
 * low or high where a hand's reports arrive unevenly, and a thing flicked is still gaining on the hand), eased
 * toward the most it had along that way a moment before (a hand slows in its last frames, and means the throw it
 * made). Never faster than it was just moving, never another way than it was going. A hand that has itself
 * stopped has thrown nothing: the thing keeps only what it has left as it runs up to it; at rest, it is set down.
 */
export function thrownFrom(samples: readonly Vec3[], hand?: readonly Vec3[]): Vec3 {
  const T = LOOSE_TUNING;
  const n = samples.length;
  if (n === 0) return [0, 0, 0];
  const last = samples[n - 1] as Vec3;
  const both = n >= 2 ? scale(add(last, samples[n - 2] as Vec3), 0.5) : last;
  const sb = length(both);
  if (sb < T.throwRest) return last;
  // is the hand itself still going? (its own speed over its last three steps, against the thing's)
  let going = 1;
  if (hand && hand.length >= 2) {
    const m = Math.min(3, hand.length - 1);
    going = Math.min(1, (dist(hand[hand.length - 1] as Vec3, hand[hand.length - 1 - m] as Vec3) * HZ) / m / sb);
  }
  if (going < T.throwStill) return last;
  const d = scale(both, 1 / sb);
  const sp = Math.max(sb, dot(last, d));
  // (the most it had: two steps at a time, for the same reason)
  let peak = sp;
  for (let i = Math.max(1, n - steps(T.throwLook)); i < n; i++) peak = Math.max(peak, dot(scale(add(samples[i] as Vec3, samples[i - 1] as Vec3), 0.5), d));
  return scale(d, sp + (peak - sp) * T.throwKeep * going);
}

/**
 * A velocity as the visitor meant it (§ B1 law 1: "a flick up throws up"). From a raised eye, up the screen is away
 * along the bench and up at once. A thing carried away slowly and let go slides on, away. The faster it was going
 * away, the more of that is turned upward (smoothly: there is no speed at which it flips), a flick going straight
 * up; a very hard one leans back toward the wall, along the screen's own up. The upward speed is the away speed
 * times `tilt`, which is the speed the eye saw. Sideways motion, and motion toward the visitor, are left as they are.
 */
export function asSeen(v: Vec3, lens: Lens | undefined): Vec3 {
  if (!lens) return v;
  const T = LOOSE_TUNING;
  const ax = lens.away[0], az = lens.away[1];
  const a = v[0] * ax + v[2] * az;
  if (a <= T.flickFrom) return v;
  const phi = smoothstep(T.flickFrom, T.flickFull, a) * (Math.PI / 2) - smoothstep(T.leanFrom, T.leanFull, a) * Math.atan(lens.tilt);
  const along = a * Math.cos(phi);
  return [v[0] + (along - a) * ax, v[1] + a * Math.sin(phi) * lens.tilt, v[2] + (along - a) * az];
}

export const LOOSE_TUNING = {
  /**
   * The carry: the held part's speed is its gap to the hand times this (1/s), so at any steady speed it trails the
   * hand by speed / carryRate (a third of a unit at 15 units/s). It was 18 with the speed held to 11 units/s, about
   * 780 px a second at the home view: any brisk hand left the part units behind (measured 2026-11-20: 7.4 units
   * after a quick sweep), and the throw then had to be made up from the pointer.
   */
  carryRate: 45,
  /** Carry speed limit, units/s: only to keep a wild pointer from firing a part through things (2,800 px/s at home). */
  carrySpeed: 40,
  /**
   * Weight in the hand. A heavier part trails further at speed: its rate is `carryRate × (carryMassRef / mass)^carryRateExp`
   * (a large crate 35, Fetch 30, Revert 25). And it gets going more slowly: the most its velocity may change, units/s²,
   * is `carryAccel × (carryMassRef / mass)^carryMassExp` (a small crate 900, a large one about 380, Fetch about 230),
   * never less than `carryAccelMin`.
   */
  carryAccel: 900,
  carryMassRef: 0.06,
  carryMassExp: 0.5,
  carryRateExp: 0.15,
  carryAccelMin: 150,
  /** ...and slowing down toward the hand, any part's velocity may change this much, units/s² (the hand stops what it holds). */
  carryBrake: 2400,
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
  /**
   * The throw (Taylor, 2026-11-20: "Objects should follow the player's hand responsively, inherit believable
   * momentum, and travel in the direction they're actually thrown"). A part leaves the hand with what it was itself
   * doing (`thrownFrom`): exactly that up to `throwKnee` units/s, and past it softly toward `throwMax` (was a hard
   * 14: every flick over about 1,000 px/s threw the same). The bench is small beside a hand: a middling flick is
   * 1,700 px/s as it lets go, 24 units/s, and at 17 a crate leaves the bench from almost anywhere (measured
   * 2026-11-20 with the most at 18), so the most stays where it was. Measured on the open bench: 10 units/s carries
   * a crate about half the bench, 14 most of it, and off the end from the middle.
   */
  throwKnee: 9,
  throwMax: 14,
  /** A heavier part gets `(throwMassRef / mass)^throwMassExp` of both, never below `throwMassMin` (a large crate about 0.85, Fetch 0.7). */
  throwMassRef: 0.15,
  throwMassExp: 0.2,
  throwMassMin: 0.65,
  /** The upward part of a throw: its own knee and most (scaled by mass as the level part is), and never past `upApex` (its centre's height). */
  upKnee: 8,
  upMax: 12,
  upApex: 7.2,
  /** In the hand slower than this (units/s), it is set down, not thrown. */
  throwRest: 0.25,
  /** The throw looks this far back (s) for the most the part had along its way, and keeps this much of the difference. */
  throwLook: 0.085,
  throwKeep: 0.6,
  /** A hand moving slower than this share of the thing's own speed has stopped: the thing was only running up to it. */
  throwStill: 0.3,
  /**
   * Leaving the hand faster than the bench can hold, a part keeps the hand's speed for its first frames and sheds
   * the excess over this time constant (s): no step in which it is suddenly slower. A contact ends it at once.
   */
  launchEase: 0.09,
  /** A throw also lifts a little, where it has no upward part of its own: this much upward speed per unit of level speed, and its most. */
  loft: 0.18,
  loftMax: 1.6,
  /**
   * `asSeen`: going away along the bench slower than `flickFrom` units/s it is carried on, away; from `flickFull` it
   * goes straight up (about 160 and 400 px/s up the screen at home); from `leanFrom` it begins to lean back toward
   * the wall, wholly along the screen's own up from `leanFull` (about 930 and 1,600 px/s: "it can be fun to throw
   * them against the back wall too").
   */
  flickFrom: 4,
  flickFull: 10,
  leanFrom: 23,
  leanFull: 40,
  /** A free part never spins faster than this (rad/s, about 3.5 turns a second): past it a small crate strobes. */
  spinMax: 22,
  /** R4: at rest with its centre above this (out of every hand's and robot's reach) for this long, it goes home by the chute. */
  highRest: 2.5,
  highRestTime: 3,
  /** R4: with its centre outside the bench's footprint and slower than this (u/s) for this long (s), it goes home by the chute. */
  outsideSlow: 0.5,
  outsideTime: 1.5,
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
  /** After a put-back: for how long, and how near (units, radians), coming to rest again counts as staying put. */
  anchorTime: 1.5,
  anchorNear: 0.03,
  anchorAngle: 0.06,
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
  /**
   * R2: put the bench back to its opening state after a fault, whatever it was doing: an open Button bracket
   * is closed (the bench restored exactly), whatever is held is let go, then "Reset the workshop".
   */
  recover(): void;
  /** R2: who hears the step's faults from now on (a stage rebuilt on the same world brings a new guard); null: strict. */
  setOnFault(f: ((fault: StepFault) => void) | null): void;
  dispose(): void;
}

export interface WorldOptions {
  readonly seed: number | string;
  readonly physics: PhysicsPort;
  readonly scene?: SceneDesc;
  /** The history (§ E5). Default: the undo stack, `createHistory()`. `p1History()` keeps none (funnel tests). */
  readonly history?: HistoryHooks;
  /** More units, run after the scene's own (`SceneDesc.units`) in this order (the history tests' stand-ins). */
  readonly units?: readonly ((ctx: SimContext) => Unit)[];
  readonly runner?: Partial<typeof FETCH_TUNING>;
  /** What a visit remembers of the Button (§ B4): its rung, presses, cover, deck, what was used, reduced motion. */
  readonly button?: ButtonSaved;
  /**
   * R2: lenient mode (the production page only). Without it (development, every test) an error in a step is
   * thrown as it always was. With it, an error thrown by one unit in one phase of a step (`pre`, `post`,
   * `heard`, an intent, or the world's own physics and rests, unit `world`) is handed here, that unit is
   * skipped for the rest of the step, and the step carries on. The caller decides whether to `recover()`.
   */
  readonly onFault?: (fault: StepFault) => void;
}

/** R2: one error caught in a step (lenient mode). */
export interface StepFault {
  /** The unit that threw (a machine or crew id), `world` for the world's own phases, `intent` for an intent. */
  readonly unit: Id;
  readonly phase: 'intent' | 'pre' | 'step' | 'post' | 'heard';
  readonly error: unknown;
  readonly step: number;
  /** For an intent: which. */
  readonly intent?: Intent;
}

interface Loose {
  readonly id: Id;
  readonly half: Vec3;
  readonly mass: number;
  readonly material: PartMaterial;
  /** A crew member's own body (`PartSpec.crewBody`): its unit looks after it; the world only moves it. */
  readonly crew: boolean;
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
  /** The machine whose custody it is in (mode `machine`). */
  holder: Id | null;
  /** Where it went out of the world (mode `gone`): an undo's hop starts there. */
  exit: Pose | null;
  /** Sent up the chute by a machine: the cause its rest is charged to (else the history's choice, rule 4). */
  returnCause: { readonly cause: Cause | null } | null;
  /**
   * Just put back by an undo or a reset (rule 9): the engine may nudge a body set down exactly where it
   * rested (a fresh contact, no warm start). If it comes to rest again before `until`, within a hair of
   * `pose`, it is set back there exactly, with nothing committed (a real knock moves it further).
   */
  anchor: { readonly pose: Pose; readonly until: number } | null;
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
  /** Just thrown faster than the bench can hold: the level velocity it still has to shed (`launchEase`), or null. */
  boost: Vec3 | null;
}

type LooseState = Omit<Loose, 'id' | 'half' | 'mass' | 'material' | 'crew' | 'contacts'> & { contacts: Map<Id, number> };

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
/** Out of the world (shipped, a spare) a body waits here: under the bench top, never seen. */
const hiddenPose = (scene: SceneDesc): Pose => ({ p: [(scene.bench.minX + scene.bench.maxX) / 2, -4, (scene.bench.minZ + scene.bench.maxZ) / 2], q: [0, 0, 0, 1] });

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
  let onFault = opts.onFault;
  const history = opts.history ?? createHistory();
  const clock = createClock();
  const root = makeRng(opts.seed);
  const store = new Store();
  const registry = new Registry();
  const validators = new Map<string, (v: Value) => boolean>();
  const vkey = (t: Id, f: string): string => `${t}\u0000${f}`;
  const loose = new Map<Id, Loose>();
  /** Each part's friction, bounce and drag (its material's, or its own: `PartSpec.feel`). */
  const feelOf = new Map<Id, { friction: number; restitution: number; linearDamping: number; angularDamping: number }>();
  const HIDDEN = hiddenPose(scene);
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
  /** S6: where the hand last was while it holds a unit (`Holding.kind === 'unit'`): letting go happens there. */
  let unitHand: Vec3 = [0, 0, 0];
  /**
   * What the thing in the hand did over its last steps, newest last: a held part's own velocity after each step; for
   * a held unit (which goes where the hand goes) the hand's place each step. The throw is read from it (`thrownFrom`).
   */
  const trail: Vec3[] = [];
  /** Where the hand was each of those steps (the carried thing's target). */
  const hands: Vec3[] = [];
  const TRAIL = 12;
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
    // (a crew member's own body waits out of the world, as a spare does, until its unit is taken hold of)
    const out = spec.shipped === true || spec.crewBody === true;
    const pose0 = out ? HIDDEN : spec.pose;
    const feel = { ...m, ...spec.feel };
    physics.addBody({ id: spec.id, kind: 'dynamic', shape: { type: 'box', half }, pose: pose0, mass, friction: feel.friction, restitution: feel.restitution, linearDamping: feel.linearDamping, angularDamping: feel.angularDamping, ccd: true });
    if (out) physics.setEnabled(spec.id, false);
    feelOf.set(spec.id, feel);
    loose.set(spec.id, { id: spec.id, half, mass, material: spec.material, crew: spec.crewBody === true, mode: out ? 'gone' : 'free', pose: pose0, prev: pose0, awake: false, unsettled: false, calm: 0, chargeTo: null, crewBy: null, holder: null, exit: null, returnCause: null, anchor: null, chuteAt: 0, grip: [0, 0, 0], grabYaw: 0, grabStep: 0, target: pose0.p, contacts: new Map(), boost: null });
    // (a crew member's own body is not something a hand takes: the hand takes the member)
    if (spec.crewBody) continue;
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
    if (physics.bodies().every((id) => !physics.isEnabled(id) || physics.state(id).sleeping)) break;
  }
  for (const l of loose.values()) {
    validators.set(vkey(l.id, 'location'), PART_VALIDATORS.location);
    if (l.mode === 'gone') {
      store.define(l.id, 'location', { at: 'shipped' });
      continue;
    }
    const p = physics.pose(l.id);
    l.pose = p;
    l.prev = p;
    l.target = p.p;
    store.define(l.id, 'location', { at: 'rest', pose: p });
  }
  const partIds: readonly Id[] = [...loose.keys()];
  const mouths: readonly MouthSpec[] = scene.mouths ?? [];
  const mouthById = new Map(mouths.map((m) => [m.id, m]));

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
    const m = feelOf.get(l.id) ?? MATERIAL[l.material];
    physics.setDamping(l.id, m.linearDamping, m.angularDamping);
    physics.setVelocity(l.id, linvel, angvel);
    physics.wake(l.id);
    setMode(l, 'free');
    l.unsettled = true;
    l.calm = 0;
    l.boost = null;
  }

  /** S6: the unit that says the hand can hold `id` (Patch, the lamp's shade), if `id` is not a loose part. */
  const holderOf = (id: Id): Unit | undefined => (loose.has(id) ? undefined : units.find((u) => u.holds?.(id) === true));

  /** S6: one grab for a unit that can be held: the world speaks to it in `drag` intents. */
  function grabUnit(id: Id, grip: Vec3): boolean {
    const u = holderOf(id);
    if (!u?.intent?.({ type: 'drag', id, target: grip })) return false;
    held = { kind: 'unit', id };
    unitHand = grip;
    trail.length = 0;
    hands.length = 0;
    // a unit with a body of its own: the body comes into the world where the unit says it is, in the hand
    const e = u.embody?.(id);
    const b = e ? loose.get(e.body) : undefined;
    if (e && b && b.crew && (b.mode === 'gone' || b.mode === 'free' || b.mode === 'crew')) {
      physics.setEnabled(b.id, true);
      if (b.mode !== 'free') {
        physics.setPose(b.id, e.pose);
        b.pose = e.pose;
        b.prev = e.pose;
      }
      const pose = physics.pose(b.id);
      const flying = b.mode === 'free' && length(physics.state(b.id).linvel) > 0.6;
      physics.setKind(b.id, 'dynamic');
      physics.setGravityScale(b.id, 0);
      physics.setDamping(b.id, 0, 0);
      if (!flying) physics.setVelocity(b.id, [0, 0, 0], [0, 0, 0]);
      physics.wake(b.id);
      setMode(b, 'held');
      b.crewBy = null;
      b.exit = null;
      b.boost = null;
      const local = rotate(qconj(pose.q), sub(e.grip, pose.p));
      b.grip = [Math.max(-b.half[0], Math.min(b.half[0], local[0])), Math.max(-b.half[1], Math.min(b.half[1], local[1])), Math.max(-b.half[2], Math.min(b.half[2], local[2]))];
      b.target = add(pose.p, rotate(pose.q, b.grip));
      b.grabYaw = yawOf(pose.q);
      b.grabStep = clock.step;
      held = { kind: 'unit', id, body: b.id };
    }
    return true;
  }
  /** The body the hand is carrying: a held part, or a held unit's own body. */
  const heldBody = (): Loose | null => (held?.kind === 'part' ? lp(held.id) : held?.kind === 'unit' && held.body ? lp(held.body) : null);
  function carryUnit(target: Vec3): void {
    if (held?.kind !== 'unit') return;
    unitHand = target;
    if (held.body) lp(held.body).target = target;
    holderOf(held.id)?.intent?.({ type: 'drag', id: held.id, target });
  }
  /** The hand's velocity for a held unit, from where it was each step (the unit is wherever the hand is). */
  function unitThrow(lens: Lens | undefined): Vec3 {
    const vs: Vec3[] = [];
    for (let i = 1; i < hands.length; i++) vs.push(scale(sub(hands[i] as Vec3, hands[i - 1] as Vec3), HZ));
    return asSeen(handsOwn(thrownFrom(vs, hands), lens), lens);
  }
  /** `velocity`: the hand's, stated (a set-down says zero); `'own'`: read from the hand's last steps. */
  function letGoOfUnit(at: Vec3 = unitHand, velocity?: Vec3 | 'own', lens?: Lens): void {
    if (held?.kind !== 'unit') return;
    const id = held.id;
    if (held.body) {
      // its own body: thrown as a part is, by what the body was doing; the unit finds it free
      const b = lp(held.body);
      held = { kind: 'part', id: b.id };
      letGoOfPart(b, velocity === 'own' ? undefined : (velocity ?? [0, 0, 0]), 'release', lens);
      holderOf(id)?.intent?.({ type: 'drag', id, target: at, end: true });
      return;
    }
    held = null;
    const v = velocity === 'own' ? unitThrow(lens) : velocity;
    trail.length = 0;
    hands.length = 0;
    holderOf(id)?.intent?.({ type: 'drag', id, target: at, end: true, ...(v ? { velocity: v } : {}) });
  }

  function grab(id: Id, grip: Vec3): boolean {
    if (bracket || held) return false;
    const l = loose.get(id);
    if (!l) return grabUnit(id, grip);
    if (l.crew || l.mode === 'chute' || l.mode === 'gone') return false;
    // a machine may keep what it holds out of reach (the dock: a part at its door is behind the curtain)
    if (l.mode === 'machine' && l.holder !== null && unitById.get(l.holder)?.keeps?.(id)) return false;
    /** Parts a crew member was carrying that its being picked up sets loose (Fetch drops its crate). */
    let dropped: Id[] = [];
    if (l.mode === 'crew') {
      const by = l.crewBy;
      if (by === id) {
        const carried = [...loose.values()].filter((o) => o.id !== id && o.mode === 'crew' && o.crewBy === id).map((o) => o.id);
        crewHandles.get(id)?.grabbed();
        dropped = carried.filter((c) => loose.get(c)?.mode === 'free');
      } else if (by !== null) crewHandles.get(by)?.taken(id);
    } else if (l.mode === 'machine') {
      const by = l.holder;
      l.holder = null;
      if (by !== null) unitById.get(by)?.lost?.(id, 'grab');
    }
    const pose = physics.pose(id);
    // (taken while it flies: it is held where it was taken, not lifted off anything)
    const flying = l.mode === 'free' && l.unsettled && length(physics.state(id).linvel) > 0.6;
    physics.setKind(id, 'dynamic');
    physics.setGravityScale(id, 0);
    physics.setDamping(id, 0, 0);
    physics.wake(id);
    setMode(l, 'held');
    l.crewBy = null;
    l.chargeTo = null;
    l.anchor = null;
    // the grip point in the part's own frame, kept inside the part
    const local = rotate(qconj(pose.q), sub(grip, pose.p));
    l.grip = [Math.max(-l.half[0], Math.min(l.half[0], local[0])), Math.max(-l.half[1], Math.min(l.half[1], local[1])), Math.max(-l.half[2], Math.min(l.half[2], local[2]))];
    l.target = add(add(pose.p, rotate(pose.q, l.grip)), [0, flying ? 0 : T.lift, 0]);
    l.grabYaw = yawOf(pose.q);
    l.grabStep = clock.step;
    touchedSet.add(id);
    history.take(id); // § E5 rule 4: a moving part picked up leaves its window at once
    if (dropped.length > 0) {
      // § E5 rule 4: what the grab set moving is the grab's (the visitor's doing, so the lever puts it back)
      const txn = history.open('grab', id, clock.step);
      for (const d of dropped) history.claim(d, txn, clock.step);
    }
    held = { kind: 'part', id };
    trail.length = 0;
    hands.length = 0;
    l.boost = null;
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

  /** The hand's part of a held thing's motion: less what the carry itself was doing to it (`Lens.drift`). */
  function handsOwn(v: Vec3, lens: Lens | undefined): Vec3 {
    const d = lens?.drift;
    if (!d) return v;
    // (only as much of the drift as the thing was really doing along it: it trails its target by a step or two)
    const dl = length(d);
    if (dl < 1e-6) return v;
    const u = scale(d, 1 / dl);
    const along = Math.max(0, Math.min(dl, dot(v, u)));
    return sub(v, scale(u, along));
  }

  /**
   * Let go of a part. `stated`: the hand's velocity when the intent states it (tests, the keys, a cancelled pointer);
   * otherwise the throw is the part's own motion as it leaves the hand, read as the visitor saw it (`lens`).
   */
  function letGoOfPart(l: Loose, stated: Vec3 | undefined, kind: 'release' | 'place', lens?: Lens): void {
    const st = physics.state(l.id);
    const own = stated === undefined;
    const hand = own ? asSeen(handsOwn(thrownFrom(trail, hands), lens), lens) : stated;
    trail.length = 0;
    hands.length = 0;
    if (kind === 'release' && cancelledPickUp(l, hand)) return;
    let v = clampThrow(hand, l.mass, st.pose.p[1], scene.gravity);
    // a throw also lifts a little, where it has no real upward part of its own (it arcs)
    const hs = Math.hypot(v[0], v[2]);
    const loft = Math.min(T.loftMax, hs * T.loft);
    if (kind === 'release' && hs > T.throwRest && v[1] < loft) v = [v[0], v[1] < 0 ? v[1] + loft : loft, v[2]];
    const spin = scale(cross([0, 1, 0], v), T.tumble);
    release(l, v, clampLength(add(scale(st.angvel, 0.5), spin), T.spinMax));
    // thrown by its own motion faster than the bench can hold: it keeps the hand's level speed for its first frames
    // and sheds the excess (`shedLaunch`), so there is no step in which it is suddenly slower than it was in the hand
    if (own && kind === 'release') {
      const excess: Vec3 = [hand[0] - v[0], 0, hand[2] - v[2]];
      // (only the excess along the throw: `asSeen` has already turned the away part upward)
      const el = Math.hypot(excess[0], excess[2]);
      if (el > 0.5 && hs > 1e-6 && excess[0] * v[0] + excess[2] * v[2] > 0) {
        l.boost = excess;
        physics.setVelocity(l.id, [v[0] + excess[0], v[1], v[2] + excess[2]]);
      }
    }
    held = null;
    const txn = history.open(kind, l.id, clock.step);
    history.claim(l.id, txn, clock.step);
    emit({ type: 'part.released', id: l.id, speed: length(v) });
  }

  /** A thrown part sheds the speed it left the hand with over the bench's most (see `letGoOfPart`); a contact ends it. */
  function shedLaunch(): void {
    for (const l of loose.values()) {
      const b = l.boost;
      if (!b) continue;
      const bl = Math.hypot(b[0], b[2]);
      const lin = l.mode === 'free' ? physics.state(l.id).linvel : null;
      // (met something, or taken: whatever it has now is its own)
      if (!lin || bl < 0.05 || l.contacts.size > 0 || (lin[0] * b[0] + lin[2] * b[2]) / bl < bl) {
        l.boost = null;
        continue;
      }
      const k = 1 - Math.exp(-1 / (HZ * T.launchEase));
      physics.setVelocity(l.id, [lin[0] - b[0] * k, lin[1], lin[2] - b[2] * k]);
      l.boost = [b[0] * (1 - k), 0, b[2] * (1 - k)];
    }
  }

  /** No free part spins faster than `spinMax` (a small crate rolling off a bounce reached 43 rad/s and strobed). */
  function calmSpin(): void {
    for (const l of loose.values()) {
      if (l.mode !== 'free' || !l.awake) continue;
      const st = physics.state(l.id);
      const w = length(st.angvel);
      if (w > T.spinMax) physics.setVelocity(l.id, st.linvel, scale(st.angvel, T.spinMax / w));
    }
  }

  function clampTarget(l: Loose, t: Vec3): Vec3 {
    const b = scene.bench;
    const margin = 1.0;
    return [Math.max(b.minX - margin, Math.min(b.maxX + margin, t[0])), Math.max(b.top + l.half[1] + 0.03, Math.min(b.ceiling, t[1])), Math.max(b.minZ + l.half[2], Math.min(b.maxZ + margin, t[2]))];
  }

  function driveHeld(): void {
    const l = heldBody();
    if (!l) return;
    const st = physics.state(l.id);
    const level = qyaw(yawOf(st.pose.q));
    const centreTarget = sub(clampTarget(l, l.target), rotate(level, l.grip));
    const gap = sub(centreTarget, st.pose.p);
    const light = Math.min(1, T.carryMassRef / Math.max(l.mass, 1e-3));
    const accel = Math.max(T.carryAccelMin, T.carryAccel * light ** T.carryMassExp);
    const desired = clampLength(scale(gap, T.carryRate * light ** T.carryRateExp), T.carrySpeed);
    // weight is in getting going: its velocity gains only so much a step. Slowing toward the hand it is not held
    // back (the hand has hold of it): a heavy thing trails a fast hand, and stops with it instead of swinging past
    const want = sub(desired, st.linvel);
    const slowing = dot(want, st.linvel) < 0 && length(desired) < length(st.linvel);
    const dv = clampLength(want, (slowing ? T.carryBrake : accel) / HZ);
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
    // and back toward the yaw it had when picked up, gently (a crew member held turns to the way it wants to face: Fetch to the visitor)
    let dyaw = (crewHandles.get(l.id)?.heldYaw?.() ?? l.grabYaw) - yawOf(st.pose.q);
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    const wGoal = clampLength(add(scale(err, T.levelRate), [0, dyaw * T.levelRate * T.yawHold, 0]), T.levelSpeed);
    const w = add(scale(st.angvel, T.sway), scale(wGoal, 1 - T.sway));
    physics.setVelocity(l.id, v, w);
  }

  /** Read every part's pose back. `exact`: poses to report as given (the rewind's recorded frame; the engine may renormalise a set rotation by an ulp). */
  function readMotion(exact?: ReadonlyMap<Id, Pose>): void {
    for (const l of loose.values()) {
      if (l.mode === 'chute' || l.mode === 'gone') {
        l.prev = l.pose;
        l.awake = false;
        continue;
      }
      const st = physics.state(l.id);
      l.prev = l.pose;
      l.pose = exact?.get(l.id) ?? st.pose;
      l.awake = l.mode === 'held' || l.mode === 'crew' || l.mode === 'machine' ? dist(l.prev.p, l.pose.p) > 1e-6 || qangle(l.prev.q, l.pose.q) > 1e-6 : !st.sleeping;
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

  /** Below the bench top within its footprint: inside the bench, where nothing can be. */
  function insideBench(p: Vec3): boolean {
    const b = scene.bench;
    return p[1] < b.top && p[0] >= b.minX && p[0] <= b.maxX && p[2] >= b.minZ && p[2] <= b.maxZ;
  }

  function offBench(p: Vec3): boolean {
    const b = scene.bench;
    // coming to rest inside the bench itself (its centre below the top within the footprint: forced down
    // through it) counts as off it: back up the return chute, like anything that fell off the edge
    return insideBench(p) || p[1] < scene.fallY || p[0] < b.minX || p[0] > b.maxX || p[2] < b.minZ || p[2] > b.maxZ || !Number.isFinite(p[0] + p[1] + p[2]);
  }

  /** R4: steps each part has lain at rest above `LOOSE_TUNING.highRest`. */
  const highFor = new Map<Id, number>();
  /** R4: steps each part has lain (or crept) with its centre outside the bench's footprint. */
  const outsideFor = new Map<Id, number>();
  const outsideFootprint = (p: Vec3): boolean => {
    const b = scene.bench;
    return p[0] < b.minX || p[0] > b.maxX || p[2] < b.minZ || p[2] > b.maxZ;
  };
  function edgeAndChute(): void {
    for (const id of [...outsideFor.keys()]) {
      const l = loose.get(id);
      if (!l || l.mode !== 'free' || !outsideFootprint(l.pose.p)) outsideFor.delete(id);
    }
    for (const id of [...highFor.keys()]) {
      const l = loose.get(id);
      if (!l || l.mode !== 'free' || l.unsettled || l.pose.p[1] <= T.highRest) highFor.delete(id);
    }
    for (const l of loose.values()) {
      if (l.crew) continue; // (its unit looks after it off the bench)
      if (l.mode === 'free' && (l.pose.p[1] < scene.fallY || !finitePose(l.pose))) {
        physics.setEnabled(l.id, false);
        setMode(l, 'chute');
        l.unsettled = false;
        l.chuteAt = Math.max(clock.step + steps(scene.chute.delay), lastChuteRelease + steps(T.chuteGap));
        lastChuteRelease = l.chuteAt;
      } else if (l.mode === 'free' && !bracket && outsideFootprint(l.pose.p) && length(physics.state(l.id).linvel) < T.outsideSlow) {
        // R4 (I1's flick behind the back wall): its centre outside the bench's footprint, on any side and at any height,
        // at rest or barely moving for `outsideTime`: wherever that is, no hand or robot can reach it; home by the chute
        const n = (outsideFor.get(l.id) ?? 0) + 1;
        outsideFor.set(l.id, n);
        if (n >= steps(T.outsideTime)) {
          outsideFor.delete(l.id);
          physics.setEnabled(l.id, false);
          setMode(l, 'chute');
          l.unsettled = false;
          l.chuteAt = Math.max(clock.step + steps(scene.chute.delay), lastChuteRelease + steps(T.chuteGap));
          lastChuteRelease = l.chuteAt;
        }
      } else if (l.mode === 'free' && !bracket && !l.unsettled && l.pose.p[1] > T.highRest) {
        // R4: come to rest up where no hand or robot can reach (the switchboard's top, the storefront's roof): after
        // `highRestTime` it goes home by the chute (as anything off the bench does), thrown back onto the pad
        const n = (highFor.get(l.id) ?? 0) + 1;
        highFor.set(l.id, n);
        if (n >= steps(T.highRestTime)) {
          highFor.delete(l.id);
          physics.setEnabled(l.id, false);
          setMode(l, 'chute');
          l.chuteAt = Math.max(clock.step + steps(scene.chute.delay), lastChuteRelease + steps(T.chuteGap));
          lastChuteRelease = l.chuteAt;
        }
      } else if (l.mode === 'chute' && clock.step >= l.chuteAt) {
        // R4: thrown back onto the bench (the dock's pad) when a unit does that; else the P1 pop out of the chute's mouth
        const cause = l.returnCause ? l.returnCause.cause : history.chargeReturn(l.id, clock.step);
        if (!bracket && units.some((u) => u.catchReturn?.(l.id, cause))) {
          l.returnCause = null;
          l.exit = null;
          emit({ type: 'part.returned', id: l.id });
          continue;
        }
        const yaw = finitePose(l.pose) ? yawOf(l.pose.q) : 0;
        const p: Pose = { p: scene.chute.pose.p, q: qnormalize(qmul(scene.chute.pose.q, qyaw(yaw))) };
        physics.setEnabled(l.id, true);
        physics.setPose(l.id, p);
        release(l, scene.chute.linvel, [0, 0, 0]);
        l.pose = p;
        l.prev = p;
        l.chargeTo = cause;
        l.returnCause = null;
        l.exit = null;
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
      const anchored = l.anchor !== null && clock.step <= l.anchor.until;
      if (lin > T.wakeLinear || ang > T.wakeAngular) {
        if (!l.unsettled) history.disturbed(l.id); // § E5 rule 4: set moving by something else; an open window takes it
        l.unsettled = true;
        l.calm = 0;
        continue;
      }
      if (!l.unsettled) {
        if (l.crew) continue;
        // S6: the safety net for a part that never counted as moving: one crept down slower than `wakeLinear`
        // (squeezed between two statics) and fell asleep below the bench top is still off the bench
        if (st.sleeping && offBench(st.pose.p)) {
          physics.setEnabled(l.id, false);
          setMode(l, 'chute');
          l.chuteAt = Math.max(clock.step + steps(scene.chute.delay), lastChuteRelease + steps(T.chuteGap));
          lastChuteRelease = l.chuteAt;
        }
        continue;
      }
      if (lin < T.restLinear && ang < T.restAngular) l.calm += 1;
      else l.calm = 0;
      if (l.calm < restSteps && !st.sleeping) continue;
      // at rest
      l.unsettled = false;
      l.calm = 0;
      if (l.crew) {
        // a crew member's own body: where it lies is its unit's business (no mouth, no commit, no chute)
        emit({ type: 'part.rested', id: l.id });
        continue;
      }
      const a = l.anchor;
      l.anchor = null;
      if (a && anchored && dist(a.pose.p, st.pose.p) < T.anchorNear && qangle(a.pose.q, st.pose.q) < T.anchorAngle) {
        // a put-back part settling: back exactly where its location says, nothing to commit
        physics.setPose(l.id, a.pose);
        physics.setVelocity(l.id, [0, 0, 0], [0, 0, 0]);
        physics.sleep(l.id);
        l.pose = a.pose;
        history.take(l.id); // not a move: out of any window it joined while it wobbled
        continue;
      }
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
      // § B1 law 2, in one place: whatever comes to rest in a mouth is offered to its machine
      const mouth = mouths.find((m) => inMouth(m, st.pose.p));
      // R4: a robot set or thrown into a mouth rides on its wheels: if it came to rest tipped, it is stood up
      // where it lies (its lowest point kept) before the machine takes it
      if (mouth && store.get(l.id, 'kind') === 'robot') {
        const q = st.pose.q;
        const up = 1 - 2 * (q[0] * q[0] + q[2] * q[2]);
        if (up < 0.95) {
          const r = (i: number, j: number): number => {
            const [x, y, z, w] = q;
            const m = [
              [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
              [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
              [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
            ];
            return m[i]![j]!;
          };
          const bottom = st.pose.p[1] - (Math.abs(r(1, 0)) * l.half[0] + Math.abs(r(1, 1)) * l.half[1] + Math.abs(r(1, 2)) * l.half[2]);
          const upright: Pose = { p: [st.pose.p[0], bottom + l.half[1] + 0.005, st.pose.p[2]], q: qyaw(yawOf(q)) };
          physics.setPose(l.id, upright);
          physics.setVelocity(l.id, [0, 0, 0], [0, 0, 0]);
          l.pose = upright;
          l.prev = upright;
        }
      }
      if (mouth && offer(l, mouth, cause)) {
        emit({ type: 'part.rested', id: l.id });
        continue;
      }
      const loc = store.get(l.id, 'location') as Location;
      const same = loc.at === 'rest' && dist(loc.pose.p, st.pose.p) < T.restSame && qangle(loc.pose.q, st.pose.q) < T.restSameAngle;
      if (!same) commit([{ target: l.id, field: 'location', after: { at: 'rest', pose: st.pose } }], cause);
      emit({ type: 'part.rested', id: l.id });
    }
  }

  /**
   * Law 2: offer a part that has come to rest in `mouth` to its machine. True if the machine took it
   * (it is in its custody now, and the machine committed what its verb writes); false if there is no
   * such machine, or it answered with what it wanted (the slip is printed): the rest commits as usual.
   */
  function offer(l: Loose, mouth: MouthSpec, cause: Cause): boolean {
    const m = machines.get(mouth.machine);
    const part = world.part(l.id);
    if (!m || !part) return false;
    const out = m.accept(part, cause, mouth.id);
    if (!out.ok) {
      emit({ type: 'card', by: m.id, content: out.wanted });
      return false;
    }
    if (l.mode === 'free') return false; // done without taking it in: it rests where it is
    emit({ type: 'taken-in', id: m.id, part: l.id, mouth: mouth.id });
    return true;
  }

  // ── the Button's bracket ──
  function framePoses(): Map<Id, Pose> {
    const m = new Map<Id, Pose>();
    for (const l of loose.values()) if (l.mode !== 'chute' && l.mode !== 'gone') m.set(l.id, physics.pose(l.id));
    return m;
  }
  const looseState = (l: Loose): LooseState => ({ mode: l.mode, pose: l.pose, prev: l.prev, awake: l.awake, unsettled: l.unsettled, calm: l.calm, chargeTo: l.chargeTo, crewBy: l.crewBy, holder: l.holder, exit: l.exit, returnCause: l.returnCause, anchor: l.anchor, chuteAt: l.chuteAt, grip: l.grip, grabYaw: l.grabYaw, grabStep: l.grabStep, target: l.target, contacts: new Map(l.contacts), boost: l.boost });

  // ── the history (§ E5) ──
  history.bind({
    store,
    commit: (c, cause) => commit(c, cause),
    kindOf: (id) => (loose.has(id) ? (store.get(id, 'kind') as PartKind) : undefined),
    touched: (id) => touchedSet.has(id),
    playMode: () => playMode,
  });

  /** Take a part out of the world (shipped, a spare): no body, not drawn; `exit` is where it went out. */
  function stowBody(l: Loose, exit: Pose | null): void {
    physics.setEnabled(l.id, false);
    physics.setPose(l.id, HIDDEN);
    setMode(l, 'gone');
    l.crewBy = null;
    l.holder = null;
    l.exit = exit;
    l.returnCause = null;
    l.unsettled = false;
    l.calm = 0;
    l.chargeTo = null;
    l.pose = HIDDEN;
    l.prev = HIDDEN;
    l.contacts = new Map();
    history.take(l.id);
  }

  /** A part leaves a machine's custody by the world's doing: the machine is told, the body is free. */
  function loseFromMachine(l: Loose, why: LostReason): void {
    if (l.mode !== 'machine') return;
    const by = l.holder;
    l.holder = null;
    release(l, [0, 0, 0], [0, 0, 0]);
    l.unsettled = false;
    if (by !== null) unitById.get(by)?.lost?.(l.id, why);
  }

  /**
   * § E5 rule 9: a part whose location is restored is put there at once, without physics (the hop is
   * drawn). `rest`: at that pose. `shipped`: out of the world again. `in`: brought into the world at the
   * mouth's drop point if it was out of it; the machine that owns the mouth takes it back in its
   * `restored`. A part in the visitor's hand or a crew member's stays there.
   */
  function putBack(l: Loose, loc: Location, why: LostReason): void {
    if (l.mode === 'held' || l.mode === 'crew') return;
    loseFromMachine(l, why);
    if (loc.at === 'shipped') {
      if (l.mode !== 'gone') stowBody(l, l.pose);
      return;
    }
    let pose: Pose;
    if (loc.at === 'in') {
      if (l.mode === 'free') return; // it is in the world; the machine takes it where it is
      const m = mouthById.get(loc.mouth);
      pose = m ? { p: [m.drop[0], m.drop[1] + l.half[1] + 0.01, m.drop[2]], q: [0, 0, 0, 1] } : l.pose;
    } else pose = loc.pose;
    // TODO(rule 9): "if the place is taken, to the nearest free spot" is not done: the restored value is
    // exactly the recorded one (the replay check holds), and physics parts anything put into an occupied place.
    if (l.mode === 'chute' || l.mode === 'gone') physics.setEnabled(l.id, true);
    physics.setPose(l.id, pose);
    release(l, [0, 0, 0], [0, 0, 0]);
    physics.sleep(l.id);
    l.unsettled = false;
    l.chargeTo = null;
    l.exit = null;
    l.returnCause = null;
    l.pose = pose;
    l.prev = pose; // a jump, never interpolated; the view draws the hop from `Restore.pose`
    l.contacts = new Map();
    l.anchor = loc.at === 'rest' ? { pose, until: clock.step + steps(T.anchorTime) } : null;
  }

  /** Where a part's body is for an undo's hop: where it went out, if it is out of the world. */
  const hopFrom = (l: Loose): Pose => ((l.mode === 'gone' || l.mode === 'chute') && l.exit ? l.exit : l.pose);

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
    // parts still flying under the undone action: their location never changed (or had, and is restored
    // below with its entry); they come back first (the latest motion)
    for (const id of u.recalled) {
      if (u.restores.some((r) => r.target === id && r.field === 'location')) continue;
      const l = loose.get(id);
      const slot = store.slot(id, 'location');
      if (!l || !slot) continue;
      restores.push({ target: id, field: 'location', from: slot.value, to: slot.value, writer: slot.writer, pose: hopFrom(l) });
      putBack(l, slot.value as Location, 'undo');
    }
    for (const r of u.restores) {
      const l = r.field === 'location' ? loose.get(r.target) : undefined;
      if (!l) {
        restores.push(r);
        continue;
      }
      restores.push({ ...r, pose: hopFrom(l) });
      putBack(l, r.to as Location, 'undo');
    }
    emit({ type: 'undone', txn: u.txn, action: u.action, by: u.by, restores, kept: u.kept, cancelled: u.cancelled });
    for (const un of units) un.restored?.(restores);
    return { ok: true, undone: { ...u, restores } };
  }

  // ── machines and crew ──
  let units: Unit[] = [];
  const unitById = new Map<Id, Unit>();
  const machines = new Map<Id, MachineUnit>();
  const ctx: SimContext = {
    clock,
    scene,
    history,
    rng: (name) => root.fork(name),
    emit,
    commit: (c, cause) => commit(c, cause),
    part: (id) => world.part(id),
    parts: () => partIds,
    setting: (t, f) => store.get(t, f),
    writer: (t, f) => store.writer(t, f),
    defineSetting(target, field, initial, valid) {
      if (!valid(initial)) throw new Error(`setting ${target}.${field}: invalid starting value`);
      store.define(target, field, initial);
      validators.set(vkey(target, field), valid);
    },
    register: (i) => registry.add(i),
    interactable: (id) => registry.get(id),
    machine: (id) => machines.get(id),
    mouth: (id) => mouthById.get(id),
    crewView: (id) => crewView(id),
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
    hovered: () => hovered,
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
      if (!l || (l.mode !== 'free' && l.mode !== 'machine' && !(l.mode === 'crew' && l.crewBy === by))) return false;
      if (by !== id && touchedSet.has(id)) return false; // § E5 rule 5
      if (l.mode === 'machine') {
        // S6: taken out of a machine's hands by the crew (Fetch collecting from the platen's tray)
        if (bracket || (l.holder !== null && unitById.get(l.holder)?.keeps?.(id))) return false;
        const holder = l.holder;
        l.holder = null;
        if (holder !== null) unitById.get(holder)?.lost?.(id, 'crew');
      }
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
      if (l.mode !== 'crew' && l.mode !== 'machine') return;
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
    take(id, by) {
      const l = loose.get(id);
      if (!l || l.mode !== 'free' || bracket) return false;
      physics.setKind(id, 'kinematic');
      physics.setGravityScale(id, 1);
      setMode(l, 'machine');
      l.holder = by;
      l.unsettled = false;
      l.calm = 0;
      l.chargeTo = null;
      history.take(id);
      return true;
    },
    release(id, linvel, angvel, cause) {
      const l = lp(id);
      if (l.mode !== 'machine') return;
      l.holder = null;
      release(l, linvel, angvel);
      l.chargeTo = cause;
      // set down still: it is at rest as soon as physics agrees (law 2 offers it to the next mouth at once)
      if (length(linvel) === 0 && length(angvel) === 0) l.calm = steps(T.restTime);
    },
    stow(id, exit) {
      const l = lp(id);
      if (l.mode === 'held' || l.mode === 'gone') return;
      if (l.mode === 'crew' && l.crewBy !== null && l.crewBy !== id) crewHandles.get(l.crewBy)?.taken(id);
      stowBody(l, exit);
    },
    toChute(id, cause) {
      const l = lp(id);
      if (l.mode !== 'gone' && l.mode !== 'free') return;
      physics.setEnabled(id, false);
      setMode(l, 'chute');
      l.unsettled = false;
      l.returnCause = { cause };
      l.chuteAt = Math.max(clock.step + steps(scene.chute.delay), lastChuteRelease + steps(T.chuteGap));
      lastChuteRelease = l.chuteAt;
    },
    launch(id, pose, linvel, angvel, cause) {
      const l = lp(id);
      if (l.mode !== 'gone' && l.mode !== 'chute') return;
      physics.setEnabled(id, true);
      physics.setPose(id, pose);
      release(l, linvel, angvel);
      l.pose = pose;
      l.prev = pose;
      l.exit = null;
      l.returnCause = null;
      l.chargeTo = cause;
    },
    shove(id, dv) {
      const l = loose.get(id);
      if (!l || l.mode !== 'free') return;
      const st = physics.state(id);
      // (R4) never faster than the hand could throw it; and set moving by something else, an open window takes it
      // (§ E5 rule 4: a crate knocked by a thrown Patch is the throw's), as when physics sets it moving
      physics.setVelocity(id, clampLength(add(st.linvel, dv), throwCap(l.mass)), st.angvel);
      physics.wake(id);
      if (!l.unsettled) history.disturbed(id);
      l.unsettled = true;
      l.calm = 0;
    },
    velocity(id) {
      const l = loose.get(id);
      if (!l || l.mode === 'chute' || l.mode === 'gone') return undefined;
      const st = physics.state(id);
      return { linvel: st.linvel, angvel: st.angvel };
    },
    buoy(id, gravityScale) {
      const l = loose.get(id);
      if (l && l.crew && l.mode === 'free') physics.setGravityScale(id, gravityScale);
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
      putBack(l, at, 'away');
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
        l.prev = s.mode === 'chute' || s.mode === 'gone' ? l.pose : prev;
      }
      bracket = null;
      history.bracket(false);
      for (const u of units) u.bracket?.(false);
    },
  };

  /**
   * One step of the rung's rewind: put every body at its recorded pose. Returns the frame shown. The
   * recording plays back eased in and out (smoothstep), so parts gather speed and settle rather than
   * stopping dead; the last step shows the first recorded frame exactly.
   */
  function playback(): ReadonlyMap<Id, Pose> | undefined {
    const b = bracket;
    if (!b) return undefined;
    b.rewound += 1;
    const f = Math.min(1, b.rewound / b.rewindSteps);
    const e = f * f * (3 - 2 * f);
    const idx = Math.round((1 - e) * (b.frames.length - 1));
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
  units = [button, cord, runner];
  for (const u of units) unitById.set(u.id, u);
  // the scene's machines and crew, then the caller's: a machine is its own registry entry
  for (const make of [...(scene.units ?? []), ...(opts.units ?? [])]) {
    const u = make(ctx);
    if (unitById.has(u.id)) throw new Error(`world: two units are called "${u.id}"`);
    units.push(u);
    unitById.set(u.id, u);
    if (isMachine(u)) {
      registry.add(u);
      machines.set(u.id, u);
    }
  }
  /** S6: the one roster of the crew, in step order: every unit that says it is crew (`Unit.crewView`). */
  const crewUnits = units.filter((u) => typeof u.crewView === 'function');
  function crewView(id: Id): CrewView | undefined {
    for (const u of crewUnits) {
      const v = u.crewView?.();
      if (v && (v.id === id || v.body === id)) return v;
    }
    return undefined;
  }
  for (const m of mouths) if (!machines.has(m.machine)) throw new Error(`scene: mouth "${m.id}" belongs to "${m.machine}", which is not a machine of this world`);
  /** How the visit began: what "Reset the workshop" goes back to. */
  const initial = store.snapshot();

  /** "Reset the workshop": cancel every pending job, empty the stack, every durable field back to its start (writer settled). */
  function reset(): boolean {
    if (bracket) return false;
    if (held?.kind === 'plug') cord.drop();
    else if (held?.kind === 'unit') {
      const b = held.body ? lp(held.body) : null;
      if (b) {
        release(b, [0, 0, 0], [0, 0, 0]);
        held = { kind: 'unit', id: held.id };
      }
      letGoOfUnit();
    } else if (held) {
      release(lp(held.id), [0, 0, 0], [0, 0, 0]);
      held = null;
    }
    trail.length = 0;
    hands.length = 0;
    history.reset();
    for (const u of units) u.reset?.();
    const restores: Restore[] = [];
    const now = [...store.entries()];
    store.restore(initial);
    for (const { target, field, slot } of now) {
      const start = store.slot(target, field) as NonNullable<ReturnType<Store['slot']>>;
      if (sameValue(slot.value, start.value) && slot.writer === start.writer) continue;
      const l = field === 'location' ? loose.get(target) : undefined;
      restores.push({ target, field, from: slot.value, to: start.value, writer: start.writer, ...(l ? { pose: hopFrom(l) } : {}) });
    }
    partCache.clear();
    touchedSet.clear();
    for (const l of loose.values()) putBack(l, store.get(l.id, 'location') as Location, 'reset');
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
        else if (held.kind === 'unit') carryUnit(intent.target);
        else cord.carry(intent.target);
        return false;
      case 'release':
        if (!held) return false;
        if (held.kind === 'plug') {
          cord.drop();
          return true;
        }
        if (held.kind === 'unit') {
          letGoOfUnit(unitHand, intent.velocity ?? 'own', intent.lens);
          return true;
        }
        letGoOfPart(lp(held.id), intent.velocity, 'release', intent.lens);
        return true;
      case 'place': {
        if (!held) return false;
        if (held.kind === 'plug') return cord.intent?.({ type: 'plug', cord: held.id, jack: typeof intent.at === 'string' ? intent.at : null }) ?? false;
        if (held.kind === 'unit') {
          letGoOfUnit(typeof intent.at === 'string' ? (mouthById.get(intent.at)?.drop ?? unitHand) : intent.at);
          return true;
        }
        const at = typeof intent.at === 'string' ? mouthById.get(intent.at)?.drop : intent.at;
        if (!at) return false; // not a mouth of this scene
        const l = lp(held.id);
        const st = physics.state(l.id);
        const spot = clampTarget(l, [at[0], at[1] + l.half[1] + 0.01, at[2]]);
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
      case 'motion':
        button.setReducedMotion(intent.reduced);
        return false; // a setting of the page, not an action in the world
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
    get reducedMotion() {
      return button.view().reducedMotion;
    },
    undoId: scene.button.ladder?.lever ?? null,

    dispatch(intent) {
      queue.push(intent);
      if (intent.type !== 'motion') lastInput = clock.step;
    },

    advance() {
      const from = events.length;
      clock.tick();
      const pending = queue;
      queue = [];
      // R2: in lenient mode each unit's part of the step is guarded (see WorldOptions.onFault); strict, as before
      const skip = new Set<Id>();
      const guard = (unit: Id, phase: StepFault['phase'], f: () => void, intent?: Intent): void => {
        if (!onFault) return f();
        if (skip.has(unit)) return;
        try {
          f();
        } catch (error) {
          skip.add(unit);
          onFault({ unit, phase, error, step: clock.step, ...(intent ? { intent } : {}) });
        }
      };
      for (const intent of pending) {
        guard('intent', 'intent', () => {
          if (handle(intent) && intent.type !== 'hover' && intent.type !== 'carry') playMode = true;
        }, intent);
      }
      for (const u of units) if (u.pre) guard(u.id, 'pre', () => u.pre!());
      guard('world', 'step', () => {
        if (bracket?.phase === 'rewind') {
          readMotion(playback());
        } else {
          driveHeld();
          shedLaunch();
          const contacts = physics.step();
          readMotion();
          hits(contacts);
          calmSpin();
          // what the thing in the hand did this step (the throw is read from it)
          const hb = heldBody();
          if (hb) {
            trail.push(physics.state(hb.id).linvel);
            hands.push(hb.target);
          } else if (held?.kind === 'unit') hands.push(unitHand);
          if (trail.length > TRAIL) trail.shift();
          if (hands.length > TRAIL) hands.shift();
          if (!bracket) {
            edgeAndChute();
            rests();
          } else bracket.frames.push(framePoses());
        }
      });
      for (const u of units) if (u.post) guard(u.id, 'post', () => u.post!());
      guard('world', 'step', () => history.endStep(clock.step));
      const heard = events.slice(from);
      for (const u of units) if (u.heard) guard(u.id, 'heard', () => u.heard!(heard));
    },

    setOnFault(f) {
      onFault = f ?? undefined;
    },

    recover() {
      if (bracket) ctx.endBracket();
      queue = [];
      reset();
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
    crewViews: () => crewUnits.map((u) => u.crewView?.() as CrewView),
    attract: () => runner.attract(),
    crewView: (id) => crewView(id),
    holding: () => held,
    mode: (id) => loose.get(id)?.mode,
    halfExtents: (id) => loose.get(id)?.half,
    touched: (id) => touchedSet.has(id),
    button: () => button.view(),
    cord: (id) => (id === scene.cord.id ? cord.view() : undefined),
    machine: (id): MachineView | undefined => machines.get(id)?.view(),
    dispose() {
      physics.dispose();
    },
  };
  // S7: a Button rung snapshots the physics at the press and restores it at the end. The first time a page
  // does either, the engine pays for it (code compiled, memory grown: ~11 ms at the press and ~35 ms at the
  // end, in one step). Pay that here, while the world is being built and nothing is drawn: a snapshot and a
  // restore of the world as it stands, which leaves every body exactly where it is.
  physics.restore(physics.snapshot());
  return world;
}
