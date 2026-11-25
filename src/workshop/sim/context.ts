/**
 * What the world gives a machine or a crew member, and what it asks of them
 * in return. Machines and the crew never import each other or the world;
 * they meet through this context: parts, the commit funnel, the event bus
 * (REWRITE.md § E4 invariant 2).
 */
import type { BodyMode, Cause, CrewView, Effect, Holding, Id, Intent, Interactable, Location, Machine, MachineView, Part, Pose, Restore, SimEvent, Value, Vec3, Writer } from './types.ts';
import type { Clock } from './clock.ts';
import type { Rng } from './rng.ts';
import type { Change, HistoryHooks, UndoOutcome, UndoRequest } from './history.ts';
import type { MouthSpec, SceneDesc } from './scene.ts';

export type { BodyMode, Holding } from './types.ts';

export interface CommitResult {
  /** The effects applied, in order (one per field). */
  readonly effects: readonly Effect[];
  /** Changes the history refused (§ E5 rule 7); the caller says so. */
  readonly refused: readonly Change[];
}

/** A crew member's claim on its own part: the world tells it when the visitor interferes. */
export interface CrewHandle {
  /** The visitor picked the crew member itself up. */
  grabbed(): void;
  /** The visitor took `part` out of its hands. */
  taken(part: Id): void;
  /** S5 round 2: while the visitor holds the crew member itself, the yaw it turns to (eased by the hand's levelling), or null for the yaw it was picked up with. */
  heldYaw?(): number | null;
  /**
   * P4 P1a: while the visitor holds the crew member itself, where its grip is carried to, given where the hand is (the
   * world carries the body there as it carries any held thing; Pitch trails the hand like a balloon on a string).
   * Absent: the hand itself.
   */
  heldAt?(hand: Vec3): Vec3;
  /**
   * The crew member's own body as its unit describes it, where one box will not do (Patch: its trunk and its head):
   * boxes fixed together, each `at` a point of the body's own frame (the first is the trunk, at its origin), and
   * how it feels. Given once, as the unit is made, while the body is still out of the world. The part's own `half`
   * stays what the scene says (the world's reach for it in the hand); only what the engine collides is this.
   */
  body?: {
    readonly parts: readonly { readonly half: Vec3; readonly at: Vec3; readonly round?: number; readonly share?: number }[];
    readonly feel?: { readonly friction?: number; readonly restitution?: number; readonly linearDamping?: number; readonly angularDamping?: number };
  };
}

export interface SimContext {
  readonly clock: Clock;
  readonly scene: SceneDesc;
  readonly history: HistoryHooks;
  /** A generator for this consumer; forks never shift each other (rng.ts). */
  rng(name: string): Rng;
  emit(event: SimEvent): void;
  commit(changes: readonly Change[], cause: Cause): CommitResult;

  part(id: Id): Part | undefined;
  /** Every loose part's id, in scene order. */
  parts(): readonly Id[];
  setting(target: Id, field: string): Value | undefined;
  /** Who last wrote a durable field (§ E5 rule 6). */
  writer(target: Id, field: string): Writer | undefined;
  /** Declare a setting with its starting value and the rule every value must satisfy. */
  defineSetting(target: Id, field: string, initial: Value, valid: (v: Value) => boolean): void;
  register(i: Interactable): void;
  interactable(id: Id): Interactable | undefined;
  /** A machine of this world by unit id (for the switchboard's `instruct`; machines never call each other). */
  machine(id: Id): Machine | undefined;
  /** A mouth of the scene. */
  mouth(id: Id): MouthSpec | undefined;
  /** S6: a crew member's view (by unit id or body id), for whoever must watch the crew (attract mode). Read only. */
  crewView(id: Id): CrewView | undefined;

  readonly playMode: boolean;
  readonly bracketed: boolean;
  /**
   * P3 (§ B10): the bench is still. Reduced motion is on and the visitor has not yet acted: nothing on the bench
   * moves by itself (the crew hold where they are, the belt is stopped, attract mode and the crew's idle behaviour
   * wait). False from the visitor's first action, and whenever reduced motion is off. Never true while a rung plays.
   */
  readonly still: boolean;
  /** P3 (§ B10): reduced motion is on (the crew's idle behaviour stays off for as long as it is, play mode included). */
  readonly reducedMotion: boolean;
  /** What the visitor holds, if anything. */
  holding(): Holding | null;
  /** Take the visitor's hand for a non-part thing (the plug). */
  hold(h: Holding): void;
  letGo(): void;
  /** Steps since the visitor's last intent of any kind. */
  idleSteps(): number;
  /** R1: the interactable the visitor's pointer is over (the last `hover` intent), or null. Hover is not an action. */
  hovered(): Id | null;
  /** § E5 rule 5: has the visitor touched or changed this part? */
  touched(id: Id): boolean;

  // loose parts, for the crew and the Button
  mode(id: Id): BodyMode | undefined;
  /** A part's box (half extents, own frame). */
  halfExtents(id: Id): Vec3 | undefined;
  /** Current pose of a part's body. */
  pose(id: Id): Pose | undefined;
  /** Has a free part come to rest (not moving since it was last disturbed)? */
  settled(id: Id): boolean;
  /**
   * Take a free part out of physics into crew control (kinematic). Refused for a part the visitor touched (rule 5), unless it is the crew
   * member itself. (S6) A part a machine holds (mode `machine`: the platen's tray) is taken from it: the machine hears `lost(id, 'crew')`.
   */
  attach(id: Id, by: Id): boolean;
  /** Drive an attached (crew) or taken (machine) part to this pose by the end of the step (`teleport`: put it there now). */
  drive(id: Id, pose: Pose, teleport?: boolean): void;
  /** Hand an attached part back to physics with this launch; when it rests, the rest is charged to `cause`. */
  detach(id: Id, linvel: Vec3, angvel: Vec3, cause: Cause | null): void;

  // loose parts, for machines (§ B1 law 2: a machine acts on whatever is in its mouth, the visitor's things included)
  /**
   * Take a free part into machine `by`'s custody (kinematic, mode `machine`): it stops being physics and
   * moves only where `drive` puts it. The world gives it back through `Unit.lost` if the visitor picks
   * it up, or an undo or a reset puts it somewhere else. Refused (false) for a part that is not free.
   */
  take(id: Id, by: Id): boolean;
  /**
   * Give a taken part back to physics with this launch; when it rests, the rest is charged to `cause`.
   * Set down still (zero velocities), it counts as at rest at once: the next mouth is offered it in this step.
   */
  release(id: Id, linvel: Vec3, angvel: Vec3, cause: Cause | null): void;
  /**
   * Take a part out of the world (mode `gone`: no body, not drawn): shipped. `exit` is where it went
   * out (the door): an undo that brings it back draws the hop from there.
   */
  stow(id: Id, exit: Pose): void;
  /** Send a gone part back up the return chute: it pops out after the scene's chute delay, and its rest is charged to `cause`. */
  toChute(id: Id, cause: Cause | null): void;
  /** Bring a gone part into the world at `pose`, moving: its rest is charged to `cause` (restocking). */
  launch(id: Id, pose: Pose, linvel: Vec3, angvel: Vec3, cause: Cause | null): void;
  /** Give a free part a change of velocity (the Button's shove). */
  shove(id: Id, dv: Vec3): void;
  /** A loose part's velocity now (units/s), or undefined if it is not in the world. */
  velocity(id: Id): { readonly linvel: Vec3; readonly angvel: Vec3 } | undefined;
  /** A crew member's own body, free: how much of gravity it feels (1 as any part; less for a moment, to hang in the air). */
  buoy(id: Id, gravityScale: number): void;
  /** Say which crew member speaks for a part (Fetch for `fetch`). */
  crewFor(part: Id, handle: CrewHandle): void;

  // the history (§ E5): opening, charging and pending work are on `history`; these two need the world's bodies
  /**
   * Take a transaction back: the lever (`{ by: 'lever' }`), or "undo that" texted through `jack`
   * (`{ by: 'text', jack }`, rule 12: all or nothing). Everything is applied in this step; the world
   * emits `undone` (or `undo.refused`) and calls every unit's `restored`.
   */
  undo(req: UndoRequest): UndoOutcome;
  /** Revert puts a part away (rule 14): its history entries are forgotten, then its location is written as `system`. */
  putAway(part: Id, at: Location): CommitResult;

  // the Button's bracket (§ E5 "The Button is bracketed"), implemented by the world
  beginBracket(): void;
  beginRewind(steps: number): void;
  endBracket(): void;
}

/** Why the world took a part out of a unit's hands (`Unit.lost`). */
export type LostReason = 'grab' | 'undo' | 'reset' | 'away' | 'crew';

/** A machine or crew member as the world runs it, in a fixed order every step. */
export interface Unit {
  readonly id: Id;
  /**
   * The world took `part` out of this unit's custody (`take`/`attach`): the visitor picked it up
   * (`grab`), an undo or a reset put it somewhere else, or Revert put it away. Forget it; do not release
   * it (the world already has). Pending work for it under a transaction is cancelled separately (rule 10).
   */
  lost?(part: Id, why: LostReason): void;
  /**
   * Does this unit keep `part` out of the visitor's reach right now? A grab of it is refused (the dock: a
   * part at its door is behind the curtain, inside the bay's collider, and must not be let go there).
   */
  keeps?(part: Id): boolean;
  /** Every event of this step, at its end (the one bus, § E4 invariant 2). Listen; never commit from here. */
  heard?(events: readonly SimEvent[]): void;
  /**
   * S6: can the visitor's hand take hold of `id` (this unit, or a part of it that is not a loose part:
   * Patch, the lamp's shade)? If so the world turns `grab`, `carry` and `release` of it into `drag`
   * intents for this unit (`target` the hand, `end: true` on letting go) and `holding()` says
   * `{ kind: 'unit', id }` meanwhile.
   */
  holds?(id: Id): boolean;
  /**
   * A unit that can be held and has a body of its own (`PartSpec.crewBody`): asked as the hand takes hold of `id`
   * (after its `drag` intent said yes), where that body is now. The world brings the body into the world there and
   * carries it as it carries a held part (the same weight in the hand, the same contacts); let go, the body is
   * thrown by its own motion like any part, and the unit's `drag` intent with `end` then finds it `free`. Null: no
   * body this time (the unit goes where the hand goes, as a unit without one does).
   */
  embody?(id: Id): { readonly body: Id; readonly pose: Pose; readonly grip: Vec3 } | null;
  /** An intent addressed to this unit. Return true if it acted (that flips play mode). */
  intent?(intent: Intent): boolean;
  /** Before physics. */
  pre?(): void;
  /** After physics and rest detection. */
  post?(): void;
  /** The Button's bracket opened or closed (the crew freezes). */
  bracket?(on: boolean): void;
  /**
   * P3 (§ B10): the bench went still (`SimContext.still` true) or came back to life. Called at the start of a
   * step's intents, before the visitor's first action is handled, so a crew member holding still is itself again
   * before a hand reaches it; and after them, when reduced motion was just switched on or off.
   */
  still?(on: boolean): void;
  /**
   * "Reset the workshop" is about to put every durable field back to its start: drop every transient
   * job and timer (work under the crew or the system too) and go idle. `restored` follows.
   */
  reset?(): void;
  /**
   * An undo or a reset has just put these fields back (§ E5 rules 8-11), all in this step. A machine
   * whose mouth a part was restored `in`, or the dock for a part restored from `shipped`, takes it back
   * here; its pending work for an undone transaction was already dropped through its job's `abort`.
   */
  restored?(restores: readonly Restore[]): void;
  /** S6: a crew member says so here: its view under the one roster (`WorldView.crewViews()`). */
  crewView?(): CrewView;
  /**
   * R4 (Taylor: "it shoots out of the chute really weakly"): `part` is due out of the return chute now (it fell off the
   * bench, or was sent back). A unit that throws it back onto the bench (the dock, onto its pad) does so here and says
   * true; its rest is `cause`'s. None does: the world pops it out of the chute's mouth (`scene.chute`), as in P1.
   */
  catchReturn?(part: Id, cause: Cause | null): boolean;
}

/**
 * A machine: a unit with a mouth (§ E4 `Machine`). It is its own registry entry: the world registers
 * it as an interactable when the unit is made, and offers it whatever comes to rest in a mouth whose
 * `machine` is its id. `view()` is what `WorldView.machine(id)` returns.
 */
export interface MachineUnit extends Unit, Machine {
  view(): MachineView;
}

export const isMachine = (u: Unit): u is MachineUnit => typeof (u as Partial<MachineUnit>).accept === 'function' && typeof (u as Partial<MachineUnit>).view === 'function';
