/**
 * The simulation's public types (REWRITE.md § E4, § E5). This file is the
 * read-only surface: `view`, `input`, `audio` and `ui` may import types
 * from here (and values from `sim/index.ts`) and nothing else from `sim`.
 *
 * The simulation does not know it is being drawn. Nothing here may mention
 * Three.js, the DOM, or a sentence a visitor can read (text lives in
 * src/content; the simulation speaks in ids).
 */

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

/** Motion state of a loose part: never recorded (§ E5 "Motion"). */
export interface PartMotion {
  readonly pose: Pose; // current step
  readonly prev: Pose; // previous step, for render interpolation
  readonly held: boolean;
  readonly awake: boolean; // false once physics has put it to sleep at rest
}

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

// ───────────────────────── the crew, as the view sees it ─────────────────────────

/** A robot's transient state (§ E5 "Transient"): where it is and what it intends. Never recorded. */
export interface CrewMember {
  readonly id: Id;
  readonly state: string; // e.g. 'idle' | 'roll' | 'carry' | 'fumble' | 'offer' | 'shrug' | 'frozen'
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
  /** Simulation seconds since start; advances only in fixed 1/60 steps. */
  readonly time: number;
  readonly step: number;
  parts(): Iterable<Part>;
  part(id: Id): Part | undefined;
  motion(id: Id): PartMotion | undefined;
  /** A setting: the value a handle leaves behind (belt speed, which jack the cord is in, lamp level…). */
  setting(target: Id, field: string): Value | undefined;
  interactables(): Iterable<Interactable>;
  crew(id: Id): CrewMember | undefined;
  /** True from the visitor's first action: attract mode has ended for the visit (§ B3). */
  readonly playMode: boolean;
  /** True while a Button rung is playing: parts and handles do not respond (§ B4). */
  readonly bracketed: boolean;
}
