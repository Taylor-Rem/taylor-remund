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
import type { ProjectCrate, SceneDesc } from './scene.ts';
import type { Jack, RefusalReason, Reply } from './instruct/types.ts';
import type { LedgerBeat, LedgerBeatKind } from './machines/shared/ledger-board.ts';
import type { PressBeat, PressBeatKind } from './machines/shared/report-press.ts';

export type { ProjectCrate, SceneDesc };

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

/**
 * What the visitor's hand holds: a loose part, the cord's plug, or (S6) a unit that can be held without
 * being a loose part (`kind: 'unit'`: Patch lifted off its stool, the lamp by its shade; `id` is the
 * unit's id). All three come from the one gesture: `grab`, `carry`, `release`.
 */
/** (`body`: a held unit with a body of its own, which the world carries exactly as it carries a held part: `Unit.embody`.) */
export type Holding = { readonly kind: 'part'; readonly id: Id } | { readonly kind: 'plug'; readonly id: Id } | { readonly kind: 'unit'; readonly id: Id; readonly body?: Id };

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
  /**
   * The loose part this control rides on (a toy's crank on its board, a lever on its press), if it rides on one: where
   * that part is out of the world (stowed in its crate, shipped, in the chute) the control is not there to use, by hand
   * or by the keys (shell/boot.ts `usable`).
   */
  readonly on?: Id;
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
 * How the visitor looks at the bench, as far as a throw needs it (input knows the camera; the simulation does not).
 * Up the screen is two things at once from a raised eye: away along the bench, and up. A carried thing moves away;
 * a flick is meant as a throw up. `tilt` lets the world keep the speed the eye saw when it turns one into the other.
 */
export interface Lens {
  /** Level and unit, (x, z): the way "up the screen" runs along the bench, away from the visitor. */
  readonly away: readonly [number, number];
  /** tan of the line of sight's tilt below level: one unit/s away along the bench looks like `tilt` units/s straight up. */
  readonly tilt: number;
  /** The carried thing's motion that is the carry's own and not the hand's (its surface easing over what is under it), units/s. */
  readonly drift?: Vec3;
}

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
  /**
   * Pick a loose part up. `grip` is where on the part (world space) it was taken. (S6) The same gesture
   * takes hold of a unit that can be held (Patch, the lamp's shade: `id` is the unit's): `carry` moves it
   * and `release` lets it go, as `drag` did.
   */
  | { readonly type: 'grab'; readonly id: Id; readonly grip: Vec3 }
  /** While carrying: where the held part should be heading (world space), every frame the pointer moves. */
  | { readonly type: 'carry'; readonly target: Vec3 }
  /**
   * Let go. The throw is what the held thing was itself doing as it left the hand (the world knows that; the hand
   * does not send it). `lens` says how the visitor sees the bench, so that a flick up the screen can be read as a
   * throw up. `velocity`, when given, is used instead of the thing's own motion: a hand that states its speed
   * (the keys and a cancelled pointer say zero; tests state a throw exactly).
   */
  | { readonly type: 'release'; readonly velocity?: Vec3; readonly lens?: Lens }
  /** Tap-then-tap carrying: put the held part at this mouth or this spot. */
  | { readonly type: 'place'; readonly at: Id | Vec3 }
  /**
   * P4 S5 round two: the visitor asked for this thing by itself (a double-click or a double-tap on it: § B6 "frame this").
   * A unit may answer it (a project crate lying still opens, and asks to be looked at: the `look` event); unanswered, the
   * page frames the thing's station as before.
   */
  | { readonly type: 'select'; readonly id: Id }
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
   * (S6) Kept while the input layer moves to `grab`/`carry`/`release`, which now reach the same units.
   */
  | { readonly type: 'drag'; readonly id: Id; readonly target: Vec3; readonly end?: boolean; readonly velocity?: Vec3 }
  // ── S6 ──
  /**
   * The settings' reduced-motion switch, at run time (§ B4, § B10): from the next press a Button rung is
   * the card and the lamp dip only (a rung already playing finishes as it began). Not a visitor action
   * in the world: it does not end attract mode, and it does not count as input for the crew's patience.
   */
  | { readonly type: 'motion'; readonly reduced: boolean };

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
  /**
   * P3 (§ B10): the bench went still (`on`: reduced motion is on and the visitor has not acted, so nothing on it
   * moves by itself) or came back to life (their first action, or full motion switched back on).
   */
  | { readonly type: 'still'; readonly on: boolean }
  /** P3 (§ E10): what `World.saved()` returns has just changed (save it now). Never every step: only on a change. */
  | { readonly type: 'saved.changed' }
  | { readonly type: 'misfire'; readonly id: Id; readonly level: 1 | 2 }
  | { readonly type: 'tell'; readonly id: Id }
  | { readonly type: 'card'; readonly by: Id; readonly content: string } // a printed card or slip
  /** The plug left its jack, or was pushed into one. (S6) `by: 'crew'` when Patch moved it in attract mode (not the visitor's use). */
  | { readonly type: 'cord.unplugged'; readonly cord: Id; readonly jack: Id; readonly by?: 'crew' | 'system' }
  | { readonly type: 'cord.plugged'; readonly cord: Id; readonly jack: Id; readonly by?: 'crew' | 'system' }
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
   * octave above wood; paper 0, as wood; rubber -1); timbre is the audio's, by `material`. `part`, `size` and
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
  | { readonly type: 'restocked'; readonly id: Id; readonly part: Id; /** S5 R1: where it was set: on the stack (no pad), or on the chute's pad (at touchdown). */ readonly on?: 'stack' | 'pad' }
  /**
   * S5 R1: a plain crate's replacement leaves the return chute's mouth (`from`), thrown in an arc onto the pad (`to`,
   * its centre at rest), landing `flight` seconds later (then `restocked` with `on: 'pad'`). The chute's flap kicks.
   * Fetch's view: in attract mode it lands beside Fetch as it watches its crate ship (a flinch and a look).
   */
  | { readonly type: 'restock.launched'; readonly id: Id; readonly part: Id; readonly from: Vec3; readonly to: Vec3; readonly flight: number }
  // ── P4 S5: the project crates (sim/machines/crates.ts) ──
  /** A project crate (`crate`, its project `project`: a SceneDesc.projects id) was opened by its latch: its card stands. `id` is the crates unit. */
  | { readonly type: 'crate.opened'; readonly id: Id; readonly crate: Id; readonly project: Id }
  /**
   * A project crate shut: pressed shut (`press`), or clapped shut first as it was let go after a pick-up (`grab`), taken by a
   * machine or the crew (`machine`), knocked moving or tipped (`moved`), something came to rest on it (`burden`), or it left
   * the bench (`away`: down the chute, shipped, put away). An undo or a reset that shuts one says so in its own event.
   */
  | { readonly type: 'crate.shut'; readonly id: Id; readonly crate: Id; readonly project: Id; readonly why: 'press' | 'grab' | 'machine' | 'moved' | 'burden' | 'away' }
  /** The brass plate on an open project crate's card was pressed: the way to the project's full entry (on /resume/ today; a panel later). */
  | { readonly type: 'crate.plate'; readonly id: Id; readonly crate: Id; readonly project: Id }
  /**
   * P4 S5 round two: something asks to be looked at closely (a project crate the visitor has just opened: its card, its
   * plate, its tray). `target` is a pick target whose box the page brings close enough to read (shell/boot.ts `lookAt`:
   * the least move that does it). The shell knows only that a thing asked to be looked at.
   */
  | { readonly type: 'look'; readonly target: Id }
  /**
   * The thing that asked to be looked at is done with the close view (the report press, as it flicks its envelope; the
   * paint dial, turned; an open crate shut by anything but its latch): the page eases back to the view the look left, if
   * that look (`target`: the id the emitter last asked to be looked at with `look`) still holds the camera and the
   * visitor has not moved it since. A `look.back` for another look does nothing.
   */
  | { readonly type: 'look.back'; readonly target: Id }
  // ── P4 T2: the tool wall (sim/machines/toolwall.ts) ──
  /** A tool came off its peg into the visitor's hand (the peg's click). `id` is the wall's unit. */
  | { readonly type: 'toolwall.taken'; readonly id: Id; readonly tool: Id }
  /** A tool is back on its peg: let go near its painted shadow (`hand`), or put back by an undo or "Reset the workshop". */
  | { readonly type: 'toolwall.hung'; readonly id: Id; readonly tool: Id; readonly how: 'hand' | 'undo' | 'reset' }
  /** A tool was let go at another tool's place (`peg`, that tool's id): not its place; it drops to the bench. */
  | { readonly type: 'toolwall.missed'; readonly id: Id; readonly tool: Id; readonly peg: Id }
  /** The pinned sheet was pressed: the page opens the full skills list. */
  | { readonly type: 'toolwall.sheet'; readonly id: Id; readonly sheet: Id }
  // ── P4 D1: the ledger board (sim/machines/ledger.ts) ──
  /** The crank dealt the board (or it dealt itself out of its crate): its state is already `dealt(bounce)`; the show follows. `id` is the unit. */
  | { readonly type: 'ledger.dealt'; readonly id: Id; readonly board: Id; readonly bounce: number }
  /** The plunger repaired the board: its state is already `repaired(bounce)`; the show follows. */
  | { readonly type: 'ledger.repaired'; readonly id: Id; readonly board: Id; readonly bounce: number }
  /** The plunger was pressed with nothing to put right: a short refusal (its knob twitches). */
  | { readonly type: 'ledger.refused'; readonly id: Id; readonly board: Id }
  /** A beat of the board's show, in the step it falls due (for sound): `beat` as `LedgerBeatKind`, the token it moves and where to. */
  | { readonly type: 'ledger.beat'; readonly id: Id; readonly board: Id; readonly show: LedgerShow['kind']; readonly beat: LedgerBeatKind; readonly token: number | null; readonly to: string | null; readonly month: number | null; readonly on?: boolean }
  // ── P4 D2b: the paint dial (sim/machines/paint-dial.ts) ──
  /** A hand turned the dial's knob to another scheme: the dial's field is already `scheme`; the view wipes it across the room. `index` of `of` in dial order. */
  | { readonly type: 'paint.turned'; readonly id: Id; readonly dial: Id; readonly scheme: string; readonly from: string; readonly index: number; readonly of: number }
  /** The wipe of the last change (a turn, an undo, a reset) has crossed the room: the bell. */
  | { readonly type: 'paint.wiped'; readonly id: Id; readonly dial: Id; readonly scheme: string }
  // ── P4 D3: the report press (sim/machines/press.ts) ──
  /** A pull printed: the report (`marks` shipments, 0 an honest empty report), a copy in the drawer, and the envelope out (`envelope`) or the bed's shrug. */
  | { readonly type: 'press.printed'; readonly id: Id; readonly body: Id; readonly marks: number; readonly envelope: boolean }
  /** A beat of a pull's sequence, in the step it falls due (for sound): `beat` as `PressBeatKind`, `n` which click or fold. */
  | { readonly type: 'press.beat'; readonly id: Id; readonly body: Id; readonly beat: PressBeatKind; readonly n: number }
  /** The spring arm flicked the envelope: from the bed toward the belt, `flight` seconds in the air (0: set down at once, reduced motion). */
  | { readonly type: 'press.flicked'; readonly id: Id; readonly envelope: Id; readonly from: Vec3; readonly to: Vec3; readonly flight: number }
  /** A pull refused politely: the envelope is in the air (the lever gives and springs back; nothing is printed). */
  | { readonly type: 'press.refused'; readonly id: Id; readonly body: Id }
  /** The envelope, shipped, is back in the press (folded flat). */
  | { readonly type: 'press.home'; readonly id: Id; readonly envelope: Id }
  // ── S4: the Button's ladder, Revert, the UNDO lever ──
  /**
   * A beat of the rung playing (`RungBeat`), in the step it falls due: `ids` are the stations it
   * concerns (the hiccup's one, the works' every used one, the crates the stack drops), `level` its
   * strength, `duration` seconds. The view performs the ones the simulation does not (sparks, warning,
   * shake), and may re-time anything from `ButtonView.script`.
   */
  | { readonly type: 'rung.beat'; readonly rung: number; readonly beat: RungBeatKind; readonly ids: readonly Id[]; readonly level: 1 | 2; readonly duration: number }
  /** The Button's flip-up cover changed (`state`): fitted by Revert, lifted, or shut. `id` is the cover's handle. */
  | { readonly type: 'cover'; readonly id: Id; readonly state: CoverState }
  /**
   * Revert (`id`, its body) puts `part` away (§ E5 rule 14): `from` is where the part was, `to` where
   * it goes (onto the crate stack, or `shipped`: down the hatch, a spare). The world's `put-away`
   * follows in the same step; the view draws the hop into the dustpan from `from`.
   */
  | { readonly type: 'revert.sweep'; readonly id: Id; readonly part: Id; readonly from: Pose; readonly to: Location }
  // ── Fetch (S5: § B5 "hit by a thrown part"; sim/crew/fetch.ts) ──
  /**
   * A part (`by`) hit the crew member `id` hard enough to knock it (`FetchKnock` has the same numbers,
   * for as long as the knock lasts). `strength` 1..3 from the part's momentum; `dir` the yaw (radians
   * about +Y, 0 = +Z) it is shoved along; `distance` how far it slides (already cut short of anything
   * in the way); `spin` the signed yaw it turns while sliding (positive = anticlockwise seen from
   * above); `dropped` the crate it let go of, if any (charged to the throw).
   */
  | { readonly type: 'crew.knocked'; readonly id: Id; readonly by: Id; readonly strength: 1 | 2 | 3; readonly dir: number; readonly distance: number; readonly spin: number; readonly dropped: Id | null }
  /** A slow part (`by`) bumped the crew member `id`: only a look (its `lookAt` is the part for a moment). */
  | { readonly type: 'crew.nudged'; readonly id: Id; readonly by: Id }
  /**
   * Fetch (`id`) reached for `part` and could not take it from its tape (out of its reach): it gave up on it. Until a
   * hand or a machine moves it, it is not Fetch's work (Revert's heal and the dock's last resort hear this).
   */
  | { readonly type: 'crew.gaveUp'; readonly id: Id; readonly part: Id }
  /** A crew member stopped on its way because another stands where it must go or turn (`for`): it waits for it to move. */
  | { readonly type: 'crew.waiting'; readonly id: Id; readonly for: Id }
  /** S5: Fetch's jets light (`at`: where it is), below the bench's edge after going over it. */
  | { readonly type: 'jet.ignited'; readonly id: Id; readonly at: Vec3 }
  /** S5: Fetch cuts its jets over its landing point (`at`), a hair above its tape: the drop and the bounce follow. */
  | { readonly type: 'jet.cut'; readonly id: Id; readonly at: Vec3 }
  // ── the Patchlamp station (S3: § B2 X1, § D 3-4, § B5 Patch) ──
  /**
   * A text went down the line (`n` numbers the visit's texts from 1) into `jack` (a scene jack id;
   * `line` its name: storefront, platen, belt or lamp). `text` is the visitor's own words, as typed.
   */
  | { readonly type: 'line.sent'; readonly n: number; readonly jack: Id; readonly line: Jack; readonly text: string; readonly by?: 'crew'; readonly content?: string }
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
  | { readonly type: 'patch.reacted'; readonly part: Id; readonly answer: PatchAnswer }
  /**
   * R4: Patch thrown, for sound (and for crew that may answer it): `thrown` as it leaves the hand; `hit` when it
   * meets something in the air (`what`: a fixed body's id, a robot's body, or a loose part it knocked; `wall`: it
   * met a wall flat and sticks to it; `txn`, on a hit of a loose part or a robot: the throw's transaction, which
   * whatever that disturbs is charged to, § E5 rule 4); `landed` on the bench; `gone` over an edge well clear; `chute` back up the
   * chute. `speed`: units/s at that moment.
   */
  | { readonly type: 'patch.throw'; readonly phase: 'thrown' | 'hit' | 'landed' | 'gone' | 'chute'; readonly speed: number; readonly what?: Id; readonly wall?: boolean; readonly txn?: TransactionId }
  // ── S6: attract mode ──
  /** Attract mode's lap moved on to `beat` (lap `lap`, from 1). `AttractView` has the rest. */
  | { readonly type: 'attract.beat'; readonly lap: number; readonly beat: AttractBeat };

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
  /**
   * S7: running backward with the slide's foot full, the part held against the deflector, waiting for a
   * free place (the belt runs on under it; the belt told once when it began to wait). Null otherwise.
   */
  readonly waiting: Id | null;
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
  /**
   * S7: seconds until the next strike on the belt as it now runs (the nearest riding part coming toward
   * the arm, at the pace it moved this step), or null when nothing is coming (stopped, empty, a part
   * waiting, a rung playing). At top speed a strike can fall due within a few frames: raise the arm by it.
   */
  readonly next: number | null;
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

// ── S4: the Button's ladder, Revert, the UNDO lever (§ B4, § B5, § B2 X3) ──

/**
 * One beat of a rung, timed from the press (`at`, seconds). The simulation does the beats that move
 * things (`flinch`, `dip`, `shove`, `hiccup`, `works`, `stack`); the view performs the rest from the
 * script and the `rung.beat` event. `ids` (on the event) names who it concerns.
 * - `flinch`: the lamp dips and the belt lurches back (rung 1's misfires, `ButtonSpec.flinch`).
 * - `dip`: the lamp dips only (every rung has one; with reduced motion it is all there is, with the card).
 * - `shove`: the top crate of the stack slides off.
 * - `revert`: Revert is called (comes up through its hatch if it is down; cranks during the rewind).
 * - `hiccup`: one station the visitor has not used misfires once (rungs 2 and 3: `targets`).
 * - `works`: every station the visitor has used misfires together, harder (rung 4: `targets`).
 * - `sparks`: sparks fly at those stations (view only).
 * - `warning`: a turning warning lamp for `duration` seconds (view only).
 * - `shake`: the camera shakes a little, `level` 1 or 2 (view only; never with reduced motion).
 * - `stack`: the crate stack comes down.
 * - `rewind`: the recording starts to play backwards, for `duration` seconds.
 * - `card`: the rung ends; Revert's card (`ButtonView.card`).
 * - `cover`: Revert fits the flip-up cover over the Button, over `duration` seconds.
 */
export type RungBeatKind = 'flinch' | 'dip' | 'shove' | 'revert' | 'hiccup' | 'works' | 'sparks' | 'warning' | 'shake' | 'stack' | 'rewind' | 'card' | 'cover';
export interface RungBeat {
  readonly at: number;
  readonly kind: RungBeatKind;
  readonly level?: 1 | 2;
  readonly duration?: number;
}
/** A rung as data (`sim/machines/button.ts` `scriptFor`): the view performs it. */
export interface RungScript {
  readonly rung: 1 | 2 | 3 | 4;
  /** Seconds it plays before the rewind, and how long the rewind lasts. The card comes at `play + rewind`. */
  readonly play: number;
  readonly rewind: number;
  readonly beats: readonly RungBeat[];
  /** Reduced motion: the card and the lamp dip only. */
  readonly reduced: boolean;
}
/** The flip-up cover over the Button: not there yet, being fitted by Revert, shut, or lifted ready for a press. */
export type CoverState = 'none' | 'fitting' | 'shut' | 'open';

/**
 * Revert, the caretaker (§ B5). `below`: in its hatch, unseen, the doors shut. `rising`: the lift
 * brings it up (it may already be cranking). `sinking` (S7): its work done and back on its hatch, after a
 * deadpan pause the lift takes it down (`lift` 1 → 0 over the rise time; the doors stay open until it
 * is down, then shut after it), then `below`; called meanwhile, it rises again from where the lift is.
 * `present` (R1): it has a card to show: it stops, turns to face the visitor if it is not already, raises
 * the card (`card`) and holds still facing them for `card.read`; then it carries on (its trip, the cover).
 * `idle`: up, awake, flat-lidded. `trundle`: driving on its
 * treads (`speed`). `crank`: turning its crank while a change runs backwards. `fit`: screwing the
 * cover on the Button. `sweep`: putting a part away (`sweeping`). `park`: asleep in the window's light,
 * one eye open. `stuck`: its hatch is covered by something; the doors rattle, it stays down. `held`:
 * in the visitor's hand, limp. `loose`: put down (or on the belt, or shipped): it waits to come to
 * rest, rights itself and carries on.
 */
export type RevertState = 'below' | 'rising' | 'sinking' | 'present' | 'idle' | 'trundle' | 'crank' | 'fit' | 'sweep' | 'park' | 'stuck' | 'held' | 'loose';

/**
 * Revert's state, published as a machine view (`world.machine(<its unit id>)`, kind `revert`) because
 * the world's `crew()` knows only Fetch. Its body is a loose part (`body`, kind robot): draw Revert from
 * these fields while `drawn` is true (x, z, heading on the bench; `lift` 0 is down in the hatch, 1 is
 * standing on the bench: y = (lift - 1) × its height); while `drawn` is false (held, falling, riding
 * the belt) draw it from `motion(body)`.
 */
export interface RevertView extends MachineViewBase {
  readonly kind: 'revert';
  readonly body: Id;
  readonly state: RevertState;
  /** Seconds since `state` was entered. */
  readonly stateTime: number;
  readonly x: number;
  readonly z: number;
  /** Radians about +Y; 0 faces +Z (the visitor). */
  readonly heading: number;
  /** 0 down in its hatch .. 1 standing on the bench. */
  readonly lift: number;
  /** The hatch's two leaf doors, 0 shut .. 1 open. */
  readonly hatch: number;
  /** R3: seconds into its knock from below a hatch with crates on it (-1: not knocking). */
  readonly knock: number;
  /** R3: what stands in its way that it may not put away (a crate in a hand, Fetch, `patch`): it waits, looking at it; else null. */
  readonly waitingFor: Id | null;
  /** The crank's angle, radians (it turns while a change runs backwards). */
  readonly crank: number;
  readonly cranking: boolean;
  /** Tread speed, units per second (signed: backwards is negative); turning on the spot shows as `turning`. */
  readonly speed: number;
  readonly turning: number;
  /** The face: flat-lidded (deadpan), open (working), glare (at the visitor), one (asleep, one eye open), rolled (limp). */
  readonly eyes: 'flat' | 'open' | 'glare' | 'one' | 'rolled';
  /** The card it holds up in its clip, and for how long it has held it. */
  /**
   * The card it holds up in its clip, and for how long it has held it. R1: `read` is how long it stays
   * still and facing the visitor from when the card goes up (0 when it went up with nobody to turn: down
   * its hatch, in a hand); nothing it does moves it before `since` reaches `read`.
   */
  readonly card: { readonly content: string; readonly since: number; readonly read: number } | null;
  /** The part it is putting away, while it sweeps. */
  readonly sweeping: Id | null;
  /**
   * R3: the crate in its dustpan, carried home to go down its hatch (it comes back up the chute onto the pad), or
   * null. Draw it from `motion(id)` (it is driven in front of the body).
   */
  readonly carrying: Id | null;
  /** R3: the crate it is out for: while it takes in the scene, on its way to it, and while it sweeps it; else null. */
  readonly bound: Id | null;
  /**
   * R3: out to heal a dry bench, it stands a moment taking in the scene before it sets off (`REVERT_TUNING.survey`
   * seconds): the view's look round, at the empty belt, at Fetch waiting, at the crate (`bound`), at the visitor.
   */
  readonly surveying: boolean;
  /** R3: how long this look round lasts (seconds): the whole scene when the bench has run dry, else one short look at the crate and the visitor. */
  readonly surveyLength: number;
  /** R4: back up through its hatch after being thrown off the bench or refused by the dock: one long look at the visitor. */
  readonly lookingBack: boolean;
  /** R3: seconds since the visitor took a crate out of its pan (Infinity: never): it looks at the empty pan, then goes home. */
  readonly emptyPan: number;
  /** R3: Fetch has had nothing it may carry for a while: it is out to put crates back into circulation (its eyes: the belt, Fetch, the crate, the visitor). */
  readonly starving: boolean;
  readonly drawn: boolean;
}

/**
 * The UNDO lever (§ B2 X3, § D 8). A pull is answered in the same step (the undo is already done);
 * `travel` is the scripted travel (0 home .. 1 pulled; the view adds the spring's overshoot), `latch`
 * the catch squeezed, `phase` where in the pull it is. `armed`: something on the stack to take back
 * (the piece's lamp). `result`: what the last pull did.
 */
export interface UndoLeverView extends MachineViewBase {
  readonly kind: 'undo-lever';
  readonly travel: number;
  readonly latch: number;
  readonly phase: 'rest' | 'pull' | 'hold' | 'return';
  /** Seconds since the last pull (or misfire) began; Infinity before the first. */
  readonly since: number;
  readonly armed: boolean;
  readonly result: 'undone' | 'kept' | 'nothing' | null;
}

/** Every machine's view state; narrow on `kind`. A new machine adds its interface here. */
/**
 * P4 D1: the ledger board (sim/machines/ledger.ts). `tokens` is its durable value (`ledger-board.ts` `Tokens`); `wrong`
 * whether the red star is lit by it. `show` is the change being shown: the script of beats from `before` to `after`
 * (`after` equals `tokens`), `since` seconds in; null when the board is drawn as its state says. `waiting` a press
 * that waits for the show to end. `refused` seconds since the plunger last refused (Infinity before); `misfire` is
 * the plunger's, `crankMisfire` the crank's.
 */
export interface LedgerShow {
  readonly kind: 'deal' | 'repair' | 'rewind';
  readonly since: number;
  readonly before: readonly string[];
  readonly after: readonly string[];
  readonly beats: readonly LedgerBeat[];
  readonly length: number;
}
export interface LedgerView extends MachineViewBase {
  readonly kind: 'ledger';
  readonly board: Id;
  readonly crank: Id;
  readonly plunger: Id;
  readonly tokens: readonly string[];
  readonly wrong: boolean;
  readonly show: LedgerShow | null;
  readonly waiting: 'deal' | 'repair' | null;
  readonly refused: number;
  readonly crankMisfire: { readonly level: 1 | 2; readonly since: number } | null;
}

/**
 * P4 D2b: the paint dial (sim/machines/paint-dial.ts). `scheme` is its durable value, one of `schemes` (dial order; the
 * first the approved look), `index` its place. `change` is the last change (a hand's turn, or the lever or a reset
 * putting it back), `since` seconds ago, which the view wipes across the room over `wipe` seconds from where the dial
 * is; null before any. `worked` seconds since a hand last worked the knob (Infinity before); `misfire` the knob's;
 * `reachable` whether the knob can be turned now (the dial in the world and in nobody's hand).
 */
export interface PaintDialView extends MachineViewBase {
  readonly kind: 'paint-dial';
  readonly dial: Id;
  readonly knob: Id;
  readonly schemes: readonly string[];
  readonly scheme: string;
  readonly index: number;
  readonly change: { readonly from: string; readonly to: string; readonly since: number; readonly by: 'hand' | 'restore' } | null;
  readonly wipe: number;
  readonly worked: number;
  readonly reachable: boolean;
}

/**
 * P4 D3: the report press (sim/machines/press.ts). `report` and `drawer` are the press's durable fields (what its two
 * holders show: paint names oldest first, null when nothing has been printed; the copies in its drawer); `seal` the
 * envelope's. `envelopeIn`: the envelope is in the press, on the arm's bed. `show` is the pull being shown (`before`
 * the report its holders showed, `after` the new one, `drawer` the count before, `envelope` whether it is folded and
 * flicked), `since` seconds in; null when the press is drawn as its state says. `shrug` seconds since the bed last
 * came up empty (Infinity before). `shipments` how many the press has on its record (the next report's size, up to
 * twelve). `misfire` is the lever's.
 */
export interface PressShow {
  readonly since: number;
  readonly before: readonly string[] | null;
  readonly after: readonly string[] | null;
  readonly drawer: number;
  readonly envelope: boolean;
  readonly beats: readonly PressBeat[];
  readonly length: number;
}
export interface PressView extends MachineViewBase {
  readonly kind: 'press';
  readonly body: Id;
  readonly envelope: Id;
  readonly lever: Id;
  readonly report: readonly string[] | null;
  readonly drawer: number;
  readonly seal: string | null;
  readonly envelopeIn: boolean;
  readonly show: PressShow | null;
  readonly waiting: boolean;
  readonly shrug: number;
  /** Seconds since a pull was refused because the envelope was in the air (Infinity before). */
  readonly refused: number;
  readonly shipments: number;
}

/**
 * P4 T2: the tool wall (sim/machines/toolwall.ts). Each tool: `hung` while the wall holds it on its peg; `since` seconds
 * since it last came off the wall or went back on (Infinity before either); `easing` while it glides onto its peg (0..1).
 * `sheet` is the pinned sheet's id.
 */
export interface ToolwallTool {
  readonly id: Id;
  readonly hung: boolean;
  readonly since: number;
  readonly easing: number | null;
}
export interface ToolwallView extends MachineViewBase {
  readonly kind: 'toolwall';
  readonly tools: readonly ToolwallTool[];
  readonly sheet: Id;
}

export type MachineView = BeltView | StrikerView | DockView | ChuteView | RevertView | UndoLeverView | LineView | PatchView | PlatenView | StorefrontView | LampView | LedgerView | PaintDialView | PressView | ToolwallView;

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
export interface StationOnLineView extends MachineViewBase {
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
export interface StorefrontView extends StationOnLineView {
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
export interface PlatenView extends StationOnLineView {
  readonly kind: 'platen';
  /** The part on the tray (taken in and held there, Fetch included), or null. Its colour and label are on the part. */
  readonly onTray: Id | null;
  /** Where the tray seats a part: the bottom centre, world space. */
  readonly seat: Vec3;
}

/** The workshop's one lamp (§ B2 X1 LAMP, § D 14): durable settings the stage tints and aims the key light by. */
export interface LampView extends StationOnLineView {
  readonly kind: 'lamp';
  /** Off is night (§ B2 X1). Durable. */
  readonly on: boolean;
  /** Brightness step, 1 (dimmest) to `levels`; the visit starts at `home.level`. Durable. */
  readonly level: number;
  readonly levels: number;
  /** One of the 8 paints, or `warm`: its own amber light. Durable. */
  readonly colour: PaintName | 'warm';
  /**
   * The point the shade points at (world, on the bench top): the durable arm setting, or where the hand has
   * it while it is dragged. (S6) The simulation decides the aim only: the view derives the bulb and the
   * shade's axis from it with the lamp piece's `aimLamp`.
   */
  readonly aim: Vec3;
  /** The visit's starting lamp: a new visit and "Reset the workshop" start here (the opening picture). */
  readonly home: { readonly aim: Vec3; readonly level: number };
  /** S6: where the aim can go: the piece's reachable region placed on the bench (world x, z, a convex polygon). */
  readonly reach: readonly (readonly [number, number])[];
  /** The visitor has the shade in hand. */
  readonly dragging: boolean;
}

/**
 * One entry of the phone conversation (the phone line, `ui/phone/world-line.ts`, reads these). They
 * carry ids, never our sentences; `text` is the visitor's own words.
 */
export type LineEntry =
  /**
   * A text sent. (S6) `by: 'crew'`: Fetch tapped the phone in attract mode; `text` is then empty and `content`
   * names the words the phone shows (src/content/attract.json): the simulation holds no sentence.
   */
  | { readonly kind: 'sent'; readonly n: number; readonly jack: Id; readonly line: Jack; readonly text: string; readonly by?: 'crew'; readonly content?: string }
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
 * the station to see the result is really there), `reply` (texts back). Then `seated`. (S6) `roll`: the
 * stool rolls along its runner (to the job's jack after `notice`, or home after a quiet spell); `plug`:
 * attract mode only, it moves the cord to the crew's jack before `drawer`, and back after `reply`. With the
 * visitor: `stare` (looks at the dead plug), `look` (then slowly at the visitor, or at the lever),
 * `duck`, `catch`, `bonk`, `held` (lifted off the stool, hanging), `walk` (put down, going back), `climb`.
 */
export type PatchState = 'seated' | 'notice' | 'drawer' | 'work' | 'check' | 'reply' | 'stare' | 'look' | 'duck' | 'catch' | 'bonk' | 'held' | 'walk' | 'climb' | 'roll' | 'plug' | 'ledge' | 'haul' | 'dust' | 'cross' | 'fly' | 'land' | 'shake' | 'away' | 'wall';

/** Patch, the operator (§ B5): transient, never recorded. Held and thrown it is a body (`body`); else its script's. */
export interface PatchView extends MachineViewBase {
  readonly kind: 'patch';
  readonly state: PatchState;
  /** Seconds since `state` began, and how long it lasts (Infinity for one that waits on something). */
  readonly stateTime: number;
  readonly stateLength: number;
  /** Where Patch is: its seat on the stool, the visitor's hand (held), its middle (in the air, at the wall), or its feet on the bench (walking). */
  readonly at: Vec3;
  /** Facing, radians about +Y (0 faces +Z, the camera). */
  readonly heading: number;
  /** The drawer pulled open (the jack whose folder it is), or null. */
  readonly drawer: Id | null;
  /** The unit the job in hand is for (the station on its line), or null. */
  readonly serving: Id | null;
  /** What it is looking at (the dead plug, the lever, the visitor, the station it checks, a part coming), or null. */
  readonly lookAt: Vec3 | null;
  /** The part in its hands (a catch), or null. */
  readonly holding: Id | null;
  /**
   * S6: the stool on its runner (world x of its middle): where it is now (`x`), its rest place at the
   * runner's right end (`rest`), the runner's other end (`min`), and the roll in hand (state `roll`:
   * eased in and out from `from` to `to` over `stateLength`; `home` when it is the way back after a
   * quiet spell). Patch's `at` moves with it.
   */
  readonly stool: { readonly x: number; readonly rest: number; readonly min: number; readonly roll: { readonly from: number; readonly to: number; readonly home: boolean } | null };
  /**
   * S6: the cord in Patch's paw (state `plug`, attract mode only): from the jack it is in to the one the
   * crew's text is for, or back afterwards. The cord's durable jack changes at the end of the stage (as
   * `crew`, with `cord.unplugged`/`cord.plugged` events `by: 'crew'`); the view draws the plug in the paw meanwhile.
   */
  readonly plug: { readonly from: Id; readonly to: Id } | null;
  /** S6: the job in hand, its stages in order with their lengths (seconds), as planned when it was picked up; null when free. */
  readonly plan: readonly { readonly state: PatchState; readonly length: number }[] | null;
  /**
   * S7: where a caught part is set down, world space: the bottom centre of the part on the shelf beside the
   * board (the part's centre is this plus its half height, and 0.01). Fixed; it does not move with the stool.
   */
  readonly shelf: Vec3;
  /**
   * S7: where it climbs back onto its stool from, world space: its feet on the bench in front of the stool,
   * wherever the stool is on its runner now. `walk` ends here; `climb` goes from here to the seat (`at`
   * moves straight between them over `stateLength`).
   */
  readonly foot: Vec3;
  /**
   * R1: let go of (or flung) past an open edge of the bench, Patch catches the edge and hangs from it
   * (`ledge`), hauls itself up (`haul`), dusts itself off (`dust`), gives the visitor the look, and walks
   * back. `at` is the point of the edge its paws hold (bench top) through `ledge`, and moves from there
   * to `up` (its feet on the bench, just in from the edge) over `haul`. `out` is the edge's outward
   * direction (unit, horizontal); `edge` which edge it is. Null otherwise.
   */
  readonly ledge: { readonly edge: 'front' | 'left' | 'right'; readonly at: Vec3; readonly up: Vec3; readonly out: Vec3 } | null;
  /**
   * R2: walking back (`walk`, and `cross`: over the belt, `at` carrying its feet up onto the rail, across and
   * down, the belt carrying it along meanwhile). `pace`: units/s on the ground (a scamper above the walk's);
   * `next`: the point it is walking to now (it looks along its way); `waiting`: stopped (something that moves is
   * in its way, or it is shut in). The walk's first `PATCH_TUNING.setOff` seconds are a look at the visitor and a
   * turn to face its way, without a step. Null otherwise.
   */
  readonly walk: { readonly pace: number; readonly scamper: boolean; readonly next: Vec3 | null; readonly waiting: boolean } | null;
  /**
   * R4: thrown. `fly`: its body in the air, tumbling, lying (`at` is its middle, world; `v` its velocity now;
   * `chute`: on its way back up the chute after a throw off the bench). `land`: the script has it again, getting up
   * where it lay (`lay`; `speed`: how fast it came in). Then `shake` (sat, a shake of the head), the look, and the
   * walk home. `away`: thrown off the bench, out of sight. Null otherwise.
   * (Up, R4: `fall` how far it has fallen from the top of its flight (`fly`) or fell (`land`, `shake`); `drop` let go
   * still from high or thrown up (it comes down falling, not tumbling along); `top` in the float at the top of a
   * throw up (R5: gravity eased off there, still moving: crew/patch-float.ts); `float` how much this throw
   * floats at its top, 0..1 (1 straight up, fading to 0 as it leans over); `v`, `top` and `float` are the body's,
   * in the air only. Present in `shake` too, for the size of its "really?".)
   */
  readonly thrown: { readonly v: Vec3 | null; readonly speed: number; readonly chute: boolean; readonly fall: number; readonly drop: boolean; readonly top: boolean; readonly float: number } | null;
  /**
   * R5: where `at` was at the end of the step before, in the same sense as `at` now, for drawing between the two
   * steps (`Frame.alpha`). The very same array as `at` (`prevAt === at`) when there is nothing to draw between: a
   * jump (taken into the hand, let go onto the seat, the snap to an edge, out of sight, a reset) or a new state whose
   * `at` means something else (its feet after its middle).
   */
  readonly prevAt: Vec3;
  /**
   * R4: met a wall flat (state `wall`): `out` the wall's outward direction where it met it (unit, horizontal;
   * Patch faces it, spread), `stick` seconds stuck there, then it slides down it (`at`, its middle, moving down)
   * to the bench, where it lands and sits. Null otherwise.
   */
  readonly wall: { readonly out: Vec3; readonly stick: number } | null;
  /**
   * 2026-11-20 (sim/crew/patch-body.ts). Patch's own body while it is in the world: in the hand (`held`: the world carries it as it carries a part) and loose (state `fly`: thrown,
   * tumbling, lying; the engine's). `id` the part (kind robot; `WorldView.motion(id)` has the same poses); `pose`
   * now and `prev` a step ago (draw between them); `half` its box, the hand's grip at the middle of its top. `at`
   * (and `prevAt`) follow it: its middle while loose, `PATCH_TUNING.hangBelow` above its middle while held. `float`:
   * how much of the float at the top of a throw up is on at this moment, 0..1 (it comes on and goes smoothly through
   * the top; `thrown.float` is how much this throw floats at all, `thrown.top` when its pull is down by more than a
   * third). Null while the script has Patch (the body is out of the world).
   */
  readonly body: { readonly id: Id; readonly pose: Pose; readonly prev: Pose; readonly half: Vec3; readonly held: boolean; readonly float: number } | null;
  /**
   * The script has just taken over from the body: `pose` is how and where the body last was (how
   * it lay as the get-up began; how it met the wall; how it went over the edge), `hard` how hard it had come down
   * (0 a set-down .. 1 a hard landing: the beats that follow are scaled by it). Through `land` (the get-up) and the
   * `shake` after it: it stays as it landed, getting up, for `rise` seconds, then, if where it lay is no place to
   * stand, hops from `from` to `to` (its feet) along an arc `arc` high over the rest of `stateLength`; `at` is that
   * move (`arc` 0 and `from` at `to`: it gets up where it lies). Also set through `wall` (how it met it), and the
   * first moments of `ledge` (the catch: `at` eased from the body's place to the edge). And one `land` has no body
   * before it: stood waiting on its walk home too long, it hops on toward its stool (`rise` 0, `pose` upright where
   * it stood). Null otherwise.
   */
  readonly lay: { readonly pose: Pose; readonly hard: number; readonly from: Vec3; readonly to: Vec3; readonly arc: number; readonly rise: number } | null;
}

export type RungPhase = 'idle' | 'playing' | 'rewinding';

/**
 * The Big Red Button's own state (§ B4). Kept outside the history (§ E5 rule 13). Everything a rung
 * does is in `script` (its beats, as data, timed from the press); `phaseTime` during `playing` is the
 * time into it, during `rewinding` the time into the rewind. Saving keeps `reached`, `presses`,
 * `cover` (a cover once fitted stays), `used` and `deck`.
 */
export interface ButtonView {
  readonly id: Id;
  /** The rung playing now, or the one played last (0 before the first press). From the deck, 2 to 4. */
  readonly rung: number;
  /** The highest rung of the ladder reached (0 to 4). At 4 the deck takes over. */
  readonly reached: number;
  readonly presses: number;
  readonly phase: RungPhase;
  /** Seconds since `phase` began. */
  readonly phaseTime: number;
  /** The rung playing (or last played): its beats in time order. Null before the first press. */
  readonly script: RungScript | null;
  /** The card that rung ends with (a content id, Revert's), or null. */
  readonly card: string | null;
  /** The stations the rung misfires (rung 2 and 3: the one; rung 4: every used one), nearest first. */
  readonly targets: readonly Id[];
  /** The flip-up cover over the Button (from rung 3 on). */
  readonly cover: CoverState;
  /** Seconds since `cover` last changed. */
  readonly coverTime: number;
  /** The cover's handle id (a `press` on it lifts or lowers it). */
  readonly coverId: Id;
  /** Stations the visitor has used (`sim/used.ts`), in the order first used. */
  readonly used: readonly Id[];
  /** The deck after the ladder: the cards still to draw (ids), top first, and the last one drawn. */
  readonly deck: { readonly left: readonly Id[]; readonly last: Id | null };
  /** Rungs are the card and the lamp dip only (§ B4, § B10). */
  readonly reducedMotion: boolean;
  /**
   * R1: the rung as a show, for the crew's performers: seconds since the press (through the play and the
   * rewind; `script`'s beat times are on this clock) and its whole length (`script.play + script.rewind`).
   * Null when no rung is playing.
   */
  readonly show: { readonly elapsed: number; readonly length: number } | null;
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
  /** S6: the last Button misfire, as one beat of its verb: the plug jumps in its jack and reseats (null before the first). */
  readonly misfire: { readonly level: 1 | 2; readonly since: number } | null;
}

// ───────────────────────── the crew, as the view sees it ─────────────────────────

/**
 * Fetch's states (§ B5). "Carrying" is not a state: a crate in its hands is
 * the `carrying` field, set while it idles, rolls or skids. `skid` is the
 * slide back after overshooting a stop (speed negative along its heading);
 * `held` is in the visitor's hand (wheel spinning); `return` is hurrying
 * back to its lane after being put down; `frozen` is during a Button rung.
 * In play mode (S5): `pickup` also takes a fresh crate off the stack (it
 * reaches, then the crate comes into its hands); `place` sets the crate in
 * its hands on the belt (turn, reach out, lower, let go, arms back); `reach`
 * stretches for something past its tape and gives up (then the OUT OF MY LANE
 * slip and a `shrug`); `knocked` is being shoved and spun by a thrown part,
 * then wobbling back to balance (`CrewMember.knock`), before it `return`s.
 */
export type FetchState = 'idle' | 'roll' | 'skid' | 'fumble' | 'offer' | 'pickup' | 'shrug' | 'salute' | 'held' | 'return' | 'frozen' | 'place' | 'reach' | 'knocked' | 'tap' | 'jetpack';

/**
 * A knock in progress (§ B5, Taylor 2026-11-18: "shoved and spun, not merely bumped into; it wobbles,
 * finds its balance and goes back to its lane"). The simulation moves the body: `x`, `z` and `heading`
 * already slide and spin during the first `shove` seconds of the `knocked` state (eased out: fast, then
 * slowing). The view adds what the collider does not: the lean away from the hit and the wobble back
 * to upright over the following `wobble` seconds, sized by `strength`.
 */
export interface FetchKnock {
  /** The part that hit it. */
  readonly by: Id;
  readonly strength: 1 | 2 | 3;
  /** Yaw of the shove (radians about +Y, 0 = +Z): the way it slides, the way it leans away from. */
  readonly dir: number;
  /** How far it slides (units), already cut short of the bench edge and of every machine. */
  readonly distance: number;
  /** Signed yaw it turns while sliding (radians; positive = anticlockwise seen from above). */
  readonly spin: number;
  /** Seconds of sliding, then seconds of wobbling, from the start of the `knocked` state. */
  readonly shove: number;
  readonly wobble: number;
}

/**
 * Fetch's jetpack (state `jetpack`): over the bench's edge (thrown, dropped or let go past it) it falls out of sight for
 * a beat, lights its jets, rises clear of the edge, flies a short arc to the nearest free point of its tape, hovers,
 * cuts the jets, drops the last hair with a bounce, and carries on as after being put down. The body's pose is scripted
 * (`motion('fetch')`, kinematic): the view adds the flame, the wobble and the legs. Four seconds at most.
 */
export interface FetchJet {
  /** `fall`: dropping below the edge; `ignite`: the jets catch, the fall is caught; `rise`: up clear of the edge; `cruise`: the arc over the bench; `hover`: over its landing point; `land`: down, the cut, a little drop and a bounce. */
  readonly phase: 'fall' | 'ignite' | 'rise' | 'cruise' | 'hover' | 'land';
  /** Seconds since this phase began, and its length. */
  readonly phaseTime: number;
  readonly phaseLength: number;
  /** How hard the jets burn, 0 (off) to 1 (full: the rise). */
  readonly thrust: number;
  /** Where it went over the edge (where it rises), and where it will land (on its tape), world space (centres). */
  readonly from: Vec3;
  readonly to: Vec3;
}

/**
 * Where a crew member's eye goes when nothing in its state says otherwise (§ B3 "Fetch's head follows the
 * pointer", § B5 "watches the pointer"). `held`: the part in the visitor's hand (the pointer, when it
 * carries something); `moving`: the nearest loose part on the move within range (thrown, falling).
 * Null: nothing the simulation knows of; the view follows the pointer (only the view knows where it is).
 */
export interface Gaze {
  readonly at: Vec3;
  readonly what: 'held' | 'moving';
  readonly id: Id;
}

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
  /** S5: where its eye goes otherwise (`lookAt` wins); null: the view follows the pointer. */
  readonly gaze?: Gaze | null;
  /** S5: something is carried near it (in the visitor's hand) and it holds its hands up (§ B5). */
  readonly handsUp?: boolean;
  /** S5: the knock, while `state` is `knocked`; null otherwise. */
  readonly knock?: FetchKnock | null;
  /**
   * S5 round 2: the centre of its grip, world space, whenever its hands are away from the carry pose: going
   * out for a part, bringing it in, setting one down, tapping the phone, stretching for something past its
   * tape. Null with the arms at rest or carrying (a carried part then sits at the carry pose in front of it).
   * A promise the arms are drawn to: a part in its care has its centre AT the grip at every step from the
   * moment the claws close to the moment they open; the grip moves continuously (eased out, closed, eased
   * back: `FETCH_TUNING.hands`); it is never further than `FetchSpec.reach` from Fetch's centre on the
   * bench; a part is taken from where it rests and set down where it will rest.
   */
  readonly hands?: Vec3 | null;
  /** S5 (Taylor, 2026-11-19: "a little jetpack to fly back on"): the flight back onto the bench, while `state` is `jetpack`; null otherwise. */
  readonly jet?: FetchJet | null;
}

// ── S6: one crew (every member listed in one place, each as the view object it already had) ──

/** Which crew member a `CrewView` is. */
export type CrewKind = 'fetch' | 'patch' | 'revert';

/**
 * One crew member as the view reads it (`WorldView.crewViews()`, `WorldView.crewView(id)`): the same
 * objects as before, under one roster. `id` is the crew unit's id; `body` the loose part that is its
 * body (kind robot), or null for one that is never a loose part (Patch). Narrow on `kind`.
 */
export type CrewView =
  | { readonly kind: 'fetch'; readonly id: Id; readonly body: Id; readonly member: CrewMember }
  | { readonly kind: 'patch'; readonly id: Id; readonly body: null; readonly view: PatchView }
  | { readonly kind: 'revert'; readonly id: Id; readonly body: Id; readonly view: RevertView };

/**
 * S6: attract mode's lap (§ B3), beat by beat: Fetch takes a crate off the stack (`fetch-crate`) to the
 * platen's tray (`to-tray`) and taps the phone (`tap`: the crew's text, "Make it blue."); Patch moves the
 * cord to PLATEN, does the job and replies (`patch`: follow `PatchView`, its `plan` and `plug`); Fetch
 * takes the painted crate off the tray (`collect`) to the belt's motor end (`to-belt`); it rides, sounds
 * at the striker and ships, and the stack is restocked (`ride`: follow the belt, the striker and the dock).
 * Then the next lap. Fetch's state (`state: 'tap'` for the tap) shows each of its own beats.
 */
export type AttractBeat = 'fetch-crate' | 'to-tray' | 'tap' | 'patch' | 'collect' | 'to-belt' | 'ride';

/** S6: attract mode as data a view can follow (`WorldView.attract()`). Transient, never recorded. */
export interface AttractView {
  /** Running: before the visitor's first action, on a bench where Fetch can reach every place of the lap. */
  readonly on: boolean;
  /** The lap (from 1) and its beat, with seconds since each began. */
  readonly lap: number;
  readonly beat: AttractBeat;
  readonly beatTime: number;
  readonly lapTime: number;
  /** The lap's crate, and the number of its text on the line (`LineView.log`), once sent. */
  readonly crate: Id | null;
  readonly text: number | null;
  /** The laps finished, with their start and end (simulation seconds). */
  readonly laps: readonly { readonly lap: number; readonly start: number; readonly end: number }[];
  /** The lap's beats in order, each with a nominal length (seconds) and whose view state shows it. */
  readonly timeline: readonly { readonly beat: AttractBeat; readonly nominal: number; readonly follow: 'fetch' | 'patch' | 'line' }[];
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
  /** S6: the whole crew, in step order (Fetch, then the scene's crew: Revert, Patch), each as its view. */
  crewViews(): readonly CrewView[];
  /** S6: one crew member's view, by its unit id or its body's part id; undefined if it is not crew. */
  crewView(id: Id): CrewView | undefined;
  /** S6: attract mode's lap, as data the view can follow (`on` false once the visitor has acted). */
  attract(): AttractView;
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
  /** S6: reduced motion as the world honours it now (the boot option, then the `motion` intent). */
  readonly reducedMotion: boolean;
  /** S6: the interactable the `U` key pulls (the UNDO lever, `SceneDesc.button.ladder.lever`), or null. */
  readonly undoId: Id | null;
  /** P3 (§ B10): reduced motion is on and the visitor has not yet acted: nothing on the bench moves by itself. */
  readonly still: boolean;
  /** P3 (§ B3): the idle hint's scheduler (`sim/tells.ts`). */
  tells(): TellsView;
}

/** P3 (§ B3): the tells as the scheduler stands (`sim/tells.ts` says what each word of the rule means). */
export interface TellsView {
  /** The first consequence of a visitor's action has happened: tells may come. */
  readonly armed: boolean;
  /** Six stations used (a discovery each): no more tells this visit. */
  readonly stopped: boolean;
  /** The step the next tell falls due if the visitor stays inactive and not busy, or null (none to come). */
  readonly next: number | null;
  /** Where the visitor last acted: "nearest" is measured from here. */
  readonly from: Vec3;
  /** The last tell: the station, the step, and the how-many-th time that station was told (2 and up: the lid's rattle, later). */
  readonly last: { readonly id: Id; readonly step: number; readonly times: number } | null;
  /** How often each station has been told this visit. */
  readonly told: Readonly<Record<Id, number>>;
}
