/**
 * What the world gives a machine or a crew member, and what it asks of them
 * in return. Machines and the crew never import each other or the world;
 * they meet through this context: parts, the commit funnel, the event bus
 * (REWRITE.md § E4 invariant 2).
 */
import type { BodyMode, Cause, Effect, Holding, Id, Intent, Interactable, Part, Pose, SimEvent, Value, Vec3 } from './types.ts';
import type { Clock } from './clock.ts';
import type { Rng } from './rng.ts';
import type { Change, HistoryHooks } from './history.ts';
import type { SceneDesc } from './scene.ts';

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
  setting(target: Id, field: string): Value | undefined;
  /** Declare a setting with its starting value and the rule every value must satisfy. */
  defineSetting(target: Id, field: string, initial: Value, valid: (v: Value) => boolean): void;
  register(i: Interactable): void;
  interactable(id: Id): Interactable | undefined;

  readonly playMode: boolean;
  readonly bracketed: boolean;
  /** What the visitor holds, if anything. */
  holding(): Holding | null;
  /** Take the visitor's hand for a non-part thing (the plug). */
  hold(h: Holding): void;
  letGo(): void;
  /** Steps since the visitor's last intent of any kind. */
  idleSteps(): number;
  /** § E5 rule 5: has the visitor touched or changed this part? */
  touched(id: Id): boolean;

  // loose parts, for the crew and the Button
  mode(id: Id): BodyMode | undefined;
  /** Current pose of a part's body. */
  pose(id: Id): Pose | undefined;
  /** Has a free part come to rest (not moving since it was last disturbed)? */
  settled(id: Id): boolean;
  /** Take a free part out of physics into crew control (kinematic). Refused for a part the visitor touched (rule 5), unless it is the crew member itself. */
  attach(id: Id, by: Id): boolean;
  /** Drive an attached part to this pose by the end of the step (`teleport`: put it there now). */
  drive(id: Id, pose: Pose, teleport?: boolean): void;
  /** Hand an attached part back to physics with this launch; when it rests, the rest is charged to `cause`. */
  detach(id: Id, linvel: Vec3, angvel: Vec3, cause: Cause | null): void;
  /** Give a free part a change of velocity (the Button's shove). */
  shove(id: Id, dv: Vec3): void;
  /** Say which crew member speaks for a part (Fetch for `fetch`). */
  crewFor(part: Id, handle: CrewHandle): void;

  // the Button's bracket (§ E5 "The Button is bracketed"), implemented by the world
  beginBracket(): void;
  beginRewind(steps: number): void;
  endBracket(): void;
}

/** A machine or crew member as the world runs it, in a fixed order every step. */
export interface Unit {
  readonly id: Id;
  /** An intent addressed to this unit. Return true if it acted (that flips play mode). */
  intent?(intent: Intent): boolean;
  /** Before physics. */
  pre?(): void;
  /** After physics and rest detection. */
  post?(): void;
  /** The Button's bracket opened or closed (the crew freezes). */
  bracket?(on: boolean): void;
}
