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
import type { Jack, RefusalReason, Reply } from './instruct/types.ts';

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
 * - `machine`: driven by a machine whose mouth it is in (riding the belt, rolling in through the dock door)
 * - `chute`: fell off the bench, or was sent back; waiting to come back up the return chute (do not draw it)
 * - `gone`: shipped: out through the dock door, or a spare crate waiting behind it (do not draw it).
 *   Its `motion().pose` is a hidden spot under the bench, never interpolated.
 */
export type BodyMode = 'free' | 'held' | 'crew' | 'machine' | 'chute' | 'gone';

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

/**
 * Who last wrote a durable field (§ E5 rule 6). `settled` is a value that is
 * simply how the world is and cannot be undone: the starting state, and
 * whatever a forgotten transaction wrote (§ E5 rule 14).
 */
export type Writer = Cause | 'settled';

/**
 * What kind of visitor action opened a transaction (§ E5 rule 3). `grab` is opened only when picking
 * something up sets other parts moving (Fetch drops the crate in its hands): those parts are the grab's.
 */
export type ActionKind = 'release' | 'place' | 'plug' | 'turn' | 'press' | 'text' | 'grab';

/**
 * One field put back by an undo or a reset: an effect run backwards
 * (§ E5 rules 8, 9, 11). Every restore of one undo was applied to the
 * durable world in a single step; this is the record of it, so each station
 * view can show its own part running backwards afterwards (paint drains up
 * the nozzle, a label peels off, a toppled crate hops back, a shipped crate
 * comes back in through the dock door).
 *
 * - `from` is the value the field had just before the undo (what is on
 *   screen now), `to` the value it has again, `writer` the writer it has
 *   again (the entry's previous writer).
 * - For `location` of a loose part, `pose` is where its body was at the
 *   moment of the undo: the hop starts there and ends at `to` (the body is
 *   already at `to`; the hop is drawn, not simulated).
 * - A part caught in mid-flight by the undo of the action that set it
 *   moving (its window was still open) is *recalled*: its durable location
 *   never changed, so `from` equals `to`, and `pose` is where it was flying.
 */
export interface Restore {
  readonly target: Id;
  readonly field: string;
  readonly from: Value;
  readonly to: Value;
  readonly writer: Writer;
  readonly pose?: Pose;
}

/** A field an undo left alone because the crew or the system wrote it since (§ E5 rule 8: Revert says so on a card). */
export interface Kept {
  readonly target: Id;
  readonly field: string;
  /** Who wrote it since (`crew` or `system`). */
  readonly writer: Writer;
}

/** How an undo was asked for: the UNDO lever, or "undo that" texted through a jack (§ E5 rules 8, 12). */
export type UndoBy = 'lever' | 'text';

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

/**
 * Anything with a mouth (§ B1 law 2). The world calls `accept` when a part comes to rest in one of its
 * mouths (`mouth`), with the cause the rest is charged to (§ E5 rule 4). It does its verb (taking the
 * part in, committing under `cause`) and answers `{ ok: true }`, or answers what it wanted instead (a
 * content id): the world then leaves the part where it rests and prints that slip. Never a bare refusal.
 */
export interface Machine extends Interactable {
  accept(part: Part, cause: Cause, mouth: Id): Outcome;
  /** For a station with a jack: carry out an instruction under `cause` (the text's transaction). */
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
  | { readonly type: 'plug'; readonly cord: Id; readonly jack: Id | null }
  /** Pull the UNDO lever (or press `U`): take back the most recent transaction (§ E5 rule 8). */
  | { readonly type: 'undo' }
  /** "Reset the workshop" (settings): every durable field back to how the visit began, the history emptied. */
  | { readonly type: 'reset' }
  // ── the Patchlamp station (S3) ──
  /**
   * Send a text down the cord to whatever live jack it is in (the phone, § D 3): the visitor's own
   * words, 1 to 240 characters, as typed. The line answers with `line.*` events and `LineView.log`.
   * Not handled while a Button rung plays (the world drops it; the phone line holds it until the rung ends).
   */
  | { readonly type: 'text'; readonly text: string }
  /**
   * Drag something that is a handle or a crew member rather than a loose part (§ D 13, § D 14): the
   * lamp by its shade (`id` the lamp), Patch off its stool (`id` Patch). Sent each frame the hand moves,
   * `target` where the hand is (world space); `end: true` on the last one, where it is let go.
   */
  | { readonly type: 'drag'; readonly id: Id; readonly target: Vec3; readonly end?: boolean };

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
  | { readonly type: 'effect'; readonly effect: Effect }
  /**
   * A transaction was taken back (§ E5 rules 8-12), all in this step.
   * `restores` are in the order to be seen running backwards: the most
   * recent change first (a toppled stack: last moved, first back).
   * `kept` are fields left as they are because the crew or the system wrote
   * them since (Revert's card). `cancelled` are the units whose pending work
   * under this transaction was dropped (rule 10), so Patch can look at the
   * lever. `action` is the kind of action that opened it.
   */
  | { readonly type: 'undone'; readonly txn: TransactionId; readonly action: ActionKind; readonly by: UndoBy; readonly restores: readonly Restore[]; readonly kept: readonly Kept[]; readonly cancelled: readonly Id[] }
  /**
   * An undo that changed nothing: `nothing` (the stack is empty, or no
   * instruction went through that jack), or `changed-since` ("undo that"
   * found a field of `txn` written since, rule 12: nothing changed and the
   * transaction stays; Patch says the lever takes things back in order).
   */
  | { readonly type: 'undo.refused'; readonly by: UndoBy; readonly reason: 'nothing' | 'changed-since'; readonly txn: TransactionId | null }
  /** Revert put a part away (§ E5 rule 14): every history entry about it was forgotten first. */
  | { readonly type: 'put-away'; readonly id: Id }
  /** "Reset the workshop": every field that differed from the start, put back in this step (same shape as an undo's restores). */
  | { readonly type: 'reset'; readonly restores: readonly Restore[] }
  // ── the line (§ B1 machines table, § B2 X2, § D 5-7) ──
  /**
   * Law 2: a part that came to rest in a mouth was taken in by its machine (`id`). The verb starts now:
   * the belt carries it, the dock rolls it to the door. (A machine that wanted something else prints a
   * `card` slip instead, `by` the machine, naming what it wanted.)
   */
  | { readonly type: 'taken-in'; readonly id: Id; readonly part: Id; readonly mouth: Id }
  /**
   * The striker (`id`) struck a part passing under its arm (§ B2 X2), in the very step the part's centre
   * crossed under it, whichever way the belt runs. `note` is semitones above the line's root by size
   * (L 0, M 4, S 7: three sizes, three notes, large is low); `octave` by material (wood 0, metal +1: an
   * octave above wood; paper +1; rubber -1); timbre is the audio's, by `material`. `part`, `size` and
   * `material` are null for a misfire: the arm strikes the air (a dry tick).
   */
  | { readonly type: 'struck'; readonly id: Id; readonly part: Id | null; readonly size: PartSize | null; readonly material: PartMaterial | null; readonly note: number; readonly octave: number }
  /** The dock (`id`) shipped a part: it is through the door and gone. The bell. */
  | { readonly type: 'shipped'; readonly id: Id; readonly part: Id }
  /**
   * A shipped part is coming back. `door`: an undo brought it back in through the dock door (the door
   * opens, a reversing beep; the hop is drawn from `Restore.pose`, the door, to where it is now).
   * `chute`: RETURN TO SENDER, the dock sent a tool or a robot back; it pops out of the return chute a
   * moment later (`part.returned`, `flap`).
   */
  | { readonly type: 'returned'; readonly id: Id; readonly part: Id; readonly how: 'door' | 'chute' }
  /** The dock's roll-up door starts to open (`open`) or to close. Its travel is `DockView.door`. */
  | { readonly type: 'door'; readonly id: Id; readonly open: boolean }
  /** The return chute's flap kicks open: a part pops out (`part`), or a misfire (null). */
  | { readonly type: 'flap'; readonly id: Id; readonly part: Id | null }
  /** A plain crate shipped and a fresh one is set on the crate stack in its place (dropped on from above, as `system`). */
  | { readonly type: 'restocked'; readonly id: Id; readonly part: Id }
  // ── the Patchlamp station (S3: § B2 X1, § D 3-4, § B5 Patch) ──
  /**
   * A text went down the line (`n` numbers the visit's texts from 1) into `jack` (a scene jack id;
   * `line` its name: storefront, platen, belt or lamp). `text` is the visitor's own words, as typed.
   */
  | { readonly type: 'line.sent'; readonly n: number; readonly jack: Id; readonly line: Jack; readonly text: string }
  /** Patch has picked text `n` up and is on it: the job's stages are `PatchView.state`. */
  | { readonly type: 'line.working'; readonly n: number }
  /** Patch texts back (reply ids, sim/instruct `Reply`): the change it made and checked, or help, who, thanks, "undo that". */
  | { readonly type: 'line.reply'; readonly n: number; readonly reply: Reply; readonly mailbox: boolean }
  /** Text `n` changed nothing; the slip it texts back says why (never a bare "no"). */
  | { readonly type: 'line.refused'; readonly n: number; readonly reason: RefusalReason; readonly reply: Reply; readonly mailbox: boolean }
  /** An unparsed text is Taylor's: the mailbox's flag goes up. Nothing is sent anywhere. */
  | { readonly type: 'mailbox.flag'; readonly n: number }
  /** The plug seated in a live jack: the station on that line (`station`, its unit id) answers with one beat (§ D 4). */
  | { readonly type: 'jack.answered'; readonly jack: Id; readonly station: Id }
  /** A part thrown at Patch got one of three answers (§ B5): it ducked, caught it (and set it on the keyshelf), or took it on the head. */
  | { readonly type: 'patch.reacted'; readonly part: Id; readonly answer: PatchAnswer };

// ───────────────────────── machines, as the view sees them ─────────────────────────

/**
 * A station's own lamp (§ B1 "lamps mean three things"): dark when idle, steady while its verb is
 * running, blinking slowly as a tell (from `tell()` until the station is used or the tell runs out).
 */
export type LampState = 'dark' | 'steady' | 'blink';

/**
 * What every machine shows (transient; nothing here is recorded). `misfire` is the last Button misfire
 * as a beat of the machine's verb: its level and the seconds since it began (null before the first).
 * The beats: the belt lurches back (`BeltView.surface`), the striker strikes air (`struck` with no part),
 * the dock's door jumps open and shut (`DockView.door`), the chute's flap kicks (`flap` with no part).
 */
export interface MachineViewBase {
  readonly id: Id;
  readonly station: StationId;
  readonly lamp: LampState;
  readonly misfire: { readonly level: 1 | 2; readonly since: number } | null;
}

/**
 * The belt (§ B1: carries anything on it at the speed and direction set). `speed`, `direction` and
 * `running` are its durable settings (the dial, the lever); `surface` and `phase` are what is moving now.
 */
export interface BeltView extends MachineViewBase {
  readonly kind: 'belt';
  /** The dial's detent, 1 (slowest) to `detents`. Durable. */
  readonly speed: number;
  readonly detents: number;
  /** The lever's side. Durable. */
  readonly direction: 'forward' | 'backward';
  /** The lever is in its middle notch when false. Durable. */
  readonly running: boolean;
  /** The surface's speed now, units per second along +X (forward is +X, toward the dock): eased, and kicked back by a lurch. */
  readonly surface: number;
  /** Units the surface has travelled since the world began (signed, +X): scroll the belt's texture and turn its rollers by it. */
  readonly phase: number;
  /** Parts riding it now, in the order they lie along it from the motor end. */
  readonly riding: readonly Id[];
}

/** The striker (§ B2 X2): a hammer on a sprung arm over the belt. */
export interface StrikerView extends MachineViewBase {
  readonly kind: 'striker';
  /** How far the arm is cocked back, 0 (at rest) to 1 (fully cocked): it cocks as a riding part approaches. */
  readonly cock: number;
  /** Seconds since the last strike (a part or a misfire); Infinity before the first. */
  readonly since: number;
  /** The part last struck, or null. */
  readonly last: Id | null;
}

/** The dock (§ B1: ships it, out, with a bell; § D 7). */
export interface DockView extends MachineViewBase {
  readonly kind: 'dock';
  /** The roll-up door, 0 shut to 1 fully open (eased; a misfire jumps it). */
  readonly door: number;
  /** Parts it has taken in and is rolling to the door, first to go first. */
  readonly shipping: readonly Id[];
}

/** The return chute (§ B1 the bench edge: sends it back up the return chute). */
export interface ChuteView extends MachineViewBase {
  readonly kind: 'chute';
  /** Seconds since the flap last kicked open; Infinity before the first. */
  readonly flap: number;
  /** Parts waiting inside to come back up. */
  readonly waiting: number;
}

/** Every machine's view state; narrow on `kind`. A new machine adds its interface here. */
export type MachineView = BeltView | StrikerView | DockView | ChuteView | LineView | PatchView | PlatenView | StorefrontView | LampView;

// ── the Patchlamp station (S3: § B2 X1, § D 3, 4 and 14, § B5 Patch, § F3) ──

/** Patch's answer to a part thrown at it (§ B5), chosen by where the part is going. */
export type PatchAnswer = 'duck' | 'catch' | 'bonk';

/**
 * One change a Patchlamp station is showing (§ B2 X1: "each change a beat the view can perform and
 * reverse"). The durable value is already `to` (the change committed in one step, § E5 rule 1); the
 * beat is the showing of it. `how` is `change` (perform it), `undo` (perform it backwards: paint drains
 * up the nozzle, a label peels off, the slats turn back) or `reset`.
 */
export interface StationBeat {
  /** The durable field: the station's own setting, or `colour` / `label` of the part on the platen's tray. */
  readonly field: string;
  /** The part changed (the platen), or null for the station's own setting. */
  readonly part: Id | null;
  readonly from: Value;
  readonly to: Value;
  readonly how: 'change' | 'undo' | 'reset';
  /** Seconds since it began. A beat is listed for `PATCHLAMP_BEAT_SECONDS` (sim/machines/storefront.ts) after it begins. */
  readonly since: number;
}

/** What every station on a Patchlamp line shows besides its own settings. */
export interface LineStationView extends MachineViewBase {
  /** The scene jack whose line reaches this station. */
  readonly jack: Id;
  /** Seconds since the plug last seated in that jack: the station answers with one beat (§ D 4). Infinity before. */
  readonly answered: number;
  /** Changes being shown, oldest first: one per field. */
  readonly beats: readonly StationBeat[];
}

/** The window's picture: one of the drawn set (sim/instruct `PICTURES`) or the empty frame. */
export type WindowPicture = 'mountains' | 'sun' | 'boat' | 'tree' | 'house' | 'none';

/** The storefront (§ B2 X1): durable settings a text changes. */
export interface StorefrontView extends LineStationView {
  readonly kind: 'storefront';
  /** The fascia's paint (one of the 8 paints). Durable. */
  readonly sign: PaintName;
  /** The fascia's words, capitals, at most 16; '' means the fascia's own words (src/content/storefront.json). Durable. */
  readonly words: string;
  /** The awning's paint. Durable. */
  readonly awning: PaintName;
  /** OPEN (the window lit) or CLOSED. Durable. */
  readonly open: boolean;
  /** The picture in the window. Durable. */
  readonly picture: WindowPicture;
}

/** The platen (§ B1: the tray under the nozzle; changes the colour and label of whatever is on it). */
export interface PlatenView extends LineStationView {
  readonly kind: 'platen';
  /** The part on the tray (taken in and held there, Fetch included), or null. Its colour and label are on the part. */
  readonly onTray: Id | null;
  /** Where the tray seats a part: the bottom centre, world space. */
  readonly seat: Vec3;
}

/** The workshop's one lamp (§ B2 X1 LAMP, § D 14): durable settings the stage tints and aims the key light by. */
export interface LampView extends LineStationView {
  readonly kind: 'lamp';
  /** Off is night (§ B2 X1). Durable. */
  readonly on: boolean;
  /** Brightness step, 1 (dimmest) to `levels`; the visit starts at `home.level`. Durable. */
  readonly level: number;
  readonly levels: number;
  /** One of the 8 paints, or `warm`: its own amber light. Durable. */
  readonly colour: PaintName | 'warm';
  /** Where the bulb is (world): the durable arm setting, or where the hand has it while it is dragged. */
  readonly bulb: Vec3;
  /** The point the shade points at (world, on the bench top). */
  readonly aim: Vec3;
  /** The visit's starting lamp: a new visit and "Reset the workshop" start here (the opening picture). */
  readonly home: { readonly bulb: Vec3; readonly aim: Vec3; readonly level: number };
  /** The visitor has the shade in hand. */
  readonly dragging: boolean;
}

/**
 * One entry of the phone conversation (the phone line, `ui/phone/world-line.ts`, reads these). They
 * carry ids, never our sentences; `text` is the visitor's own words.
 */
export type LineEntry =
  | { readonly kind: 'sent'; readonly n: number; readonly jack: Id; readonly line: Jack; readonly text: string }
  | { readonly kind: 'working'; readonly n: number }
  | { readonly kind: 'reply'; readonly n: number; readonly reply: Reply; readonly mailbox: boolean }
  | { readonly kind: 'refused'; readonly n: number; readonly reason: RefusalReason; readonly reply: Reply; readonly mailbox: boolean };

/** The phone line through the switchboard (§ B2 X1): texts in, one job at a time, replies out. */
export interface LineView extends MachineViewBase {
  readonly kind: 'line';
  /** The live line the cord is in, or null while the plug is lifted (no text can be sent). */
  readonly line: Jack | null;
  /** The scene jack the cord is in (durable; while lifted, the one it came from). */
  readonly jack: Id;
  /** While the visitor holds the plug: the live jacks offering themselves (§ D 4). Empty otherwise. */
  readonly offering: readonly Id[];
  /** The jack whose text Patch has in hand or is waiting on (its lens lamp shows the call, § B5), or null. */
  readonly ringing: Id | null;
  /** Texts waiting behind the one in hand. */
  readonly waiting: number;
  /** The text in hand: its number and jack, and the unit on that line. Null when Patch is free. */
  readonly job: { readonly n: number; readonly jack: Id; readonly station: Id } | null;
  /** Seconds since the mailbox flag last went up (Infinity before). Nothing is ever sent. */
  readonly mailbox: number;
  /** The conversation so far this visit, oldest first. `logStart` is the index of `log[0]` (the oldest are dropped past a cap). */
  readonly log: readonly LineEntry[];
  readonly logStart: number;
}

/**
 * Patch's states (§ B5). The job: `notice` (turns to the board), `drawer` (pulls open the drawer for
 * that jack), `work` (does it; the change commits at the end of this stage), `check` (leans out toward
 * the station to see the result is really there), `reply` (texts back). Then `seated`. With the
 * visitor: `stare` (looks at the dead plug), `look` (then slowly at the visitor, or at the lever),
 * `duck`, `catch`, `bonk`, `held` (lifted off the stool, hanging), `walk` (put down, going back), `climb`.
 */
export type PatchState = 'seated' | 'notice' | 'drawer' | 'work' | 'check' | 'reply' | 'stare' | 'look' | 'duck' | 'catch' | 'bonk' | 'held' | 'walk' | 'climb';

/** Patch, the operator (§ B5): transient, never recorded. Never moved by physics. */
export interface PatchView extends MachineViewBase {
  readonly kind: 'patch';
  readonly state: PatchState;
  /** Seconds since `state` began, and how long it lasts (Infinity for one that waits on something). */
  readonly stateTime: number;
  readonly stateLength: number;
  /** Where Patch is: its seat on the stool, the visitor's hand (held), or its feet on the bench (walking). */
  readonly at: Vec3;
  /** Facing, radians about +Y (0 faces +Z, the camera). */
  readonly heading: number;
  /** The drawer pulled open (the jack whose folder it is), or null. */
  readonly drawer: Id | null;
  /** The station the job is for (its unit id), or null. */
  readonly station: Id | null;
  /** What it is looking at (the dead plug, the lever, the visitor, the station it checks, a part coming), or null. */
  readonly lookAt: Vec3 | null;
  /** The part in its hands (a catch), or null. */
  readonly holding: Id | null;
}

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
  /** A part's box: half extents in units, in its own frame (centred on `motion(id).pose`). Fetch (kind robot) included. */
  halfExtents(id: Id): Vec3 | undefined;
  /** § E5 rule 5: the visitor has touched or changed this part; the crew leaves it alone. */
  touched(id: Id): boolean;
  /** The Button's own state. */
  button(): ButtonView;
  /** The cord's state (where the lifted plug is), or undefined for an unknown id. */
  cord(id: Id): CordView | undefined;
  /** A machine's view state (the belt, the striker, the dock, the chute, ...), or undefined. Narrow on `kind`. */
  machine(id: Id): MachineView | undefined;
  /** The interactable the pointer is over, from the last `hover` intent. */
  readonly hovered: Id | null;
  /** True from the visitor's first action: attract mode has ended for the visit (§ B3). */
  readonly playMode: boolean;
  /** True while a Button rung is playing: parts and handles do not respond (§ B4). */
  readonly bracketed: boolean;
}
