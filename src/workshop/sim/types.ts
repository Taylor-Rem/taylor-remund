/**
 * The simulation's public types (REWRITE.md § E4, § E5). This file is the
 * read-only surface: `view`, `input`, `audio` and `ui` may import types
 * from here (and values from `sim/index.ts`) and nothing else from `sim`.
 *
 * The simulation does not know it is being drawn. Nothing here may mention
 * Three.js, the DOM, or a sentence a visitor can read (text lives in
 * src/content; the simulation speaks in ids).
 *
 * This is the complete read-only surface: everything `view`, `input`, `ui`
 * and `audio` read is typed here. The write side (`dispatch`, `advance`,
 * `drainEvents`, `commit`, ...) is `World` in `sim/world.ts`, used only by
 * the shell and the tests.
 *
 * Tunable: positions the view needs (bench bounds, the chute's mouth, the
 * Button, the jacks, Fetch's lane) are scene data, read through
 * `WorldView.scene` (`SceneDesc`); the numbers live in one table,
 * `sim/scenes/vignette.ts` `AT`. Never copy them into `view`.
 */
import type { SceneDesc } from './scene.ts';

export type { SceneDesc };

export type Id = string;
export type Vec3 = readonly [x: number, y: number, z: number];
export type Quat = readonly [x: number, y: number, z: number, w: number];
export interface Pose {
  readonly p: Vec3;
  readonly q: Quat;
}

/** Stations and their addresses (§ C). */
export type StationId = 'top' | 'patchlamp' | 'button' | 'line' | 'work' | 'tools' | 'contact';

// ───────────────────────── parts (§ B1) ─────────────────────────

export type PartKind = 'crate' | 'tool' | 'robot';
export type PartSize = 'S' | 'M' | 'L';
export type PartMaterial = 'wood' | 'metal' | 'paper' | 'rubber';
/** One of the 8 paint colours; the names are palette tokens but `sim` treats them as opaque strings. */
export type PaintName = string;

/**
 * A part's durable location (§ E5): exactly one of these. Being held and
 * being in flight are motion, not locations: while a part is held or
 * moving, `location` stays what it last was.
 */
export type Location =
  | { readonly at: 'rest'; readonly pose: Pose }
  | { readonly at: 'in'; readonly station: StationId; readonly mouth: Id }
  | { readonly at: 'shipped' };

/** Durable properties of a part. Changed only through effects. */
export interface Part {
  readonly id: Id;
  readonly kind: PartKind;
  readonly size: PartSize;
  readonly material: PartMaterial;
  readonly colour: PaintName;
  readonly label: string; // up to 16 characters
  readonly marks: readonly string[];
  readonly contents: string | null;
  readonly location: Location;
}

/**
 * What the world is doing with a loose part's body right now (transient, never recorded).
 * - `free`: simulated: falls, tumbles, rests
 * - `held`: in the visitor's hand, spring-driven toward the pointer
 * - `crew`: driven by a crew member (Fetch itself, or a crate in its hands)
 * - `chute`: fell off the bench; waiting to come back up the return chute (do not draw it)
 */
export type BodyMode = 'free' | 'held' | 'crew' | 'chute';

/** Motion state of a loose part: never recorded (§ E5 "Motion"). */
export interface PartMotion {
  /** Pose at the end of the current step. */
  readonly pose: Pose;
  /**
   * Pose at the end of the previous step, for render interpolation
   * (draw lerp(prev, pose, alpha)). During a rung's rewind both come from
   * the recording, so interpolation runs backwards. On a teleport (coming
   * back up the chute, a crew member righting itself) `prev` equals `pose`:
   * never interpolate across a jump.
   */
  readonly prev: Pose;
  readonly held: boolean;
  /** False once it has stopped (physics put it to sleep); true while driven and moving. */
  readonly awake: boolean;
  readonly mode: BodyMode;
}

/** What the visitor's hand holds: a loose part, or the cord's plug. */
export type Holding = { readonly kind: 'part'; readonly id: Id } | { readonly kind: 'plug'; readonly id: Id };

// ───────────────────────── effects and causes (§ E5) ─────────────────────────

export type TransactionId = `t${number}`;
/** Who caused a durable change. Only transactions go on the undo stack. */
export type Cause = TransactionId | 'crew' | 'system';
export type Value = string | number | boolean | null | Location | readonly string[];

/** The only way durable state changes. */
export interface Effect {
  readonly target: Id;
  readonly field: string;
  readonly before: Value;
  readonly after: Value;
  readonly cause: Cause;
}

// ───────────────────────── interactables (§ E4) ─────────────────────────

export type Affordance = 'press' | 'grab' | 'turn' | 'slide' | 'plug' | 'open';

/** Anything a visitor can act on. Every one is in the registry. */
export interface Interactable {
  readonly id: Id; // stable; used in addresses, saves and tests
  readonly station: StationId;
  /** Content id of the name a screen reader and the controls list use (text lives in src/content). */
  readonly name: string;
  readonly affordances: readonly Affordance[];
  /** The idle hint. */
  tell(): void;
  /** What the Button makes it do; transient only, never an effect. */
  misfire(level: 1 | 2): void;
}

/** A verb done, or what the machine wanted instead (a content id for the slip). Never a bare refusal. */
export type Outcome = { readonly ok: true } | { readonly ok: false; readonly wanted: string };

export interface Instruction {
  readonly verb: string;
  readonly args: Readonly<Record<string, string | number | boolean>>;
}

/** Anything with a mouth. */
export interface Machine extends Interactable {
  accept(part: Part, cause: Cause): Outcome;
  instruct?(cmd: Instruction, cause: Cause): Outcome;
  /** Drop pending work for this cause and return to idle. */
  abort(cause: Cause): void;
}

// ───────────────────────── intents: what `input` may ask for ─────────────────────────

/**
 * Everything the visitor can do, as data. `input` produces these and knows
 * nothing about what any machine does with them.
 */
export type Intent =
  /** The pointer is over this interactable (or nothing). Cosmetic and for the crew's eyes. */
  | { readonly type: 'hover'; readonly id: Id | null }
  /** A handle worked in place: a button, a lever thrown, a latch. */
  | { readonly type: 'press'; readonly id: Id }
  /** A continuous handle set to a value 0..1 (a dial, a slider). */
  | { readonly type: 'turn'; readonly id: Id; readonly value: number }
  /** Pick a loose part up. `grip` is where on the part (world space) it was taken. */
  | { readonly type: 'grab'; readonly id: Id; readonly grip: Vec3 }
  /** While carrying: where the held part should be heading (world space), every frame the pointer moves. */
  | { readonly type: 'carry'; readonly target: Vec3 }
  /** Let go. `velocity` is the pointer's world-space velocity at release: the throw. */
  | { readonly type: 'release'; readonly velocity: Vec3 }
  /** Tap-then-tap carrying: put the held part at this mouth or this spot. */
  | { readonly type: 'place'; readonly at: Id | Vec3 }
  /** Take hold of the cord's plug (it leaves its jack and follows `carry`). */
  | { readonly type: 'unplug'; readonly cord: Id }
  /** Push the held plug into a jack, or drop it (null): it returns to the jack it came from. */
  | { readonly type: 'plug'; readonly cord: Id; readonly jack: Id | null };

// ───────────────────────── events: what `view` and `audio` may hear ─────────────────────────

/**
 * Things that happened this step, for `view` and `audio` to show and sound.
 * They carry ids and numbers, never sentences. `card`/`slip` name a content
 * entry. Listeners must not change the simulation in response.
 */
export type SimEvent =
  | { readonly type: 'part.grabbed'; readonly id: Id }
  | { readonly type: 'part.released'; readonly id: Id; readonly speed: number }
  | { readonly type: 'part.hit'; readonly id: Id; readonly other: Id | null; readonly strength: number }
  | { readonly type: 'part.rested'; readonly id: Id }
  | { readonly type: 'part.returned'; readonly id: Id } // came back up the chute after leaving the bench
  | { readonly type: 'handle.worked'; readonly id: Id; readonly value?: number }
  | { readonly type: 'button.pressed'; readonly rung: number; readonly presses: number }
  | { readonly type: 'rung.started'; readonly rung: number; readonly duration: number }
  | { readonly type: 'rung.rewinding'; readonly rung: number; readonly duration: number }
  | { readonly type: 'rung.ended'; readonly rung: number }
  | { readonly type: 'misfire'; readonly id: Id; readonly level: 1 | 2 }
  | { readonly type: 'tell'; readonly id: Id }
  | { readonly type: 'card'; readonly by: Id; readonly content: string } // a printed card or slip
  | { readonly type: 'cord.unplugged'; readonly cord: Id; readonly jack: Id }
  | { readonly type: 'cord.plugged'; readonly cord: Id; readonly jack: Id }
  | { readonly type: 'crew.state'; readonly id: Id; readonly state: string; readonly from: string }
  | { readonly type: 'effect'; readonly effect: Effect };

// ───────────────────────── machines, as the view sees them ─────────────────────────

export type RungPhase = 'idle' | 'playing' | 'rewinding';

/** The Big Red Button's own state (§ B4). Kept outside the history (§ E5 rule 13). */
export interface ButtonView {
  readonly id: Id;
  /** Rung reached (0 before the first press). */
  readonly rung: number;
  readonly presses: number;
  readonly phase: RungPhase;
  /** Seconds since `phase` began. */
  readonly phaseTime: number;
}

/** The switchboard cord (§ B2 X1). */
export interface CordView {
  readonly id: Id;
  /** The jack the cord is in (durable). While lifted, the jack it came from. */
  readonly jack: Id;
  readonly lifted: boolean;
  /** Where the lifted plug is heading (world space), or null when it is in its jack. */
  readonly plugAt: Vec3 | null;
  readonly jacks: readonly Id[];
}

// ───────────────────────── the crew, as the view sees it ─────────────────────────

/**
 * Fetch's states (§ B5). "Carrying" is not a state: a crate in its hands is
 * the `carrying` field, set while it idles, rolls or skids. `skid` is the
 * slide back after overshooting a stop (speed negative along its heading);
 * `held` is in the visitor's hand (wheel spinning); `return` is hurrying
 * back to its lane after being put down; `frozen` is during a Button rung.
 */
export type FetchState = 'idle' | 'roll' | 'skid' | 'fumble' | 'offer' | 'pickup' | 'shrug' | 'salute' | 'held' | 'return' | 'frozen';

/** A robot's transient state (§ E5 "Transient"): where it is and what it intends. Never recorded. */
export interface CrewMember {
  readonly id: Id;
  readonly state: FetchState;
  /** Seconds (simulation clock) since `state` was entered. */
  readonly stateTime: number;
  /** Ground position and heading (radians about +Y; 0 faces +Z). */
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  /** Signed ground speed along its heading, units per second. */
  readonly speed: number;
  /** The part in its hands, if any. */
  readonly carrying: Id | null;
  /** What it is attending to in the world, if anything (the view may prefer the pointer). */
  readonly lookAt: Vec3 | null;
}

// ───────────────────────── the world, read-only ─────────────────────────

/** What `view`, `audio` and `ui` are allowed to see. They never change it. */
export interface WorldView {
  /** The scene this world was built from: bench bounds, chute, statics, jacks, lanes (read-only data). */
  readonly scene: SceneDesc;
  /** Simulation seconds since start; advances only in fixed 1/60 steps. */
  readonly time: number;
  /** Steps taken since start (the counter; the method that advances the world is `World.advance()`). */
  readonly step: number;
  parts(): Iterable<Part>;
  part(id: Id): Part | undefined;
  motion(id: Id): PartMotion | undefined;
  /** A setting: the value a handle leaves behind (belt speed, which jack the cord is in, lamp level…). */
  setting(target: Id, field: string): Value | undefined;
  interactables(): Iterable<Interactable>;
  interactable(id: Id): Interactable | undefined;
  crew(id: Id): CrewMember | undefined;
  /** What the visitor's hand holds, if anything. */
  holding(): Holding | null;
  /** What the world is doing with a part's body (also on `motion(id).mode`). */
  mode(id: Id): BodyMode | undefined;
  /** § E5 rule 5: the visitor has touched or changed this part; the crew leaves it alone. */
  touched(id: Id): boolean;
  /** The Button's own state. */
  button(): ButtonView;
  /** The cord's state (where the lifted plug is), or undefined for an unknown id. */
  cord(id: Id): CordView | undefined;
  /** The interactable the pointer is over, from the last `hover` intent. */
  readonly hovered: Id | null;
  /** True from the visitor's first action: attract mode has ended for the visit (§ B3). */
  readonly playMode: boolean;
  /** True while a Button rung is playing: parts and handles do not respond (§ B4). */
  readonly bracketed: boolean;
}
