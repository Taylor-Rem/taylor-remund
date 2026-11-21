/**
 * The physics port: the small interface the world needs from a physics
 * engine (REWRITE.md § E1 "behind an adapter so it can be swapped", § H).
 * The world talks only to this; `rapier.ts` is the one file that imports
 * Rapier, and `stub.ts` is a deterministic stand-in for exact tests.
 *
 * Physics is for loose parts only: things that tumble. Machines and the
 * crew are scripted; where they need a solid presence they use static
 * colliders or kinematic bodies driven from the fixed step.
 *
 * Bodies are addressed by the simulation's own ids (a part's id).
 */
import type { Id, Pose, Vec3 } from '../types.ts';

/** A box, half extents in units, optionally with rounded edges (`radius`, inside the extents). */
export interface BoxShape {
  readonly type: 'box';
  readonly half: Vec3;
  readonly radius?: number;
}
/** Several boxes fixed together; each placed relative to the body origin. */
export interface CompoundShape {
  readonly type: 'compound';
  /** `share`: this box's share of the body's mass (default: equal shares). 0: it only collides (the body's middle and its turning are the other boxes'). */
  readonly parts: readonly { readonly half: Vec3; readonly at: Pose; readonly radius?: number; readonly share?: number }[];
}
export type Shape = BoxShape | CompoundShape;

export type BodyKind = 'dynamic' | 'kinematic';

export interface BodyDesc {
  readonly id: Id;
  readonly kind: BodyKind;
  readonly shape: Shape;
  readonly pose: Pose;
  /** Total mass in simulation units (the world derives it from size and material). */
  readonly mass: number;
  readonly friction: number;
  readonly restitution: number;
  readonly linearDamping?: number;
  readonly angularDamping?: number;
  /** Continuous collision detection: on for anything that can be thrown. */
  readonly ccd?: boolean;
}

export interface StaticDesc {
  readonly id: Id;
  readonly shape: Shape;
  readonly pose: Pose;
  readonly friction?: number;
  readonly restitution?: number;
}

/** A volume that reports which bodies overlap it; it does not collide. */
export interface SensorDesc {
  readonly id: Id;
  readonly shape: Shape;
  readonly pose: Pose;
}

export interface BodyState {
  readonly pose: Pose;
  readonly linvel: Vec3;
  readonly angvel: Vec3;
  readonly sleeping: boolean;
}

/** A contact this step whose impulse passed the port's small threshold. `b` is a body or static id. */
export interface Contact {
  readonly a: Id;
  readonly b: Id;
  /** Total normal impulse of the pair this step (force × dt), in simulation units. */
  readonly impulse: number;
}

/** Opaque, engine-specific copy of every body's full state, contacts included where the engine can. */
export interface PhysicsSnapshot {
  readonly engine: string;
}

export interface PhysicsPort {
  readonly engine: string;
  /** The fixed step, seconds. Set at creation; the world steps exactly once per simulation step. */
  readonly dt: number;

  /** Gravity along Y, units per second squared (negative is down). The scene sets it. */
  setGravity(y: number): void;
  addBody(desc: BodyDesc): void;
  removeBody(id: Id): void;
  hasBody(id: Id): boolean;
  addStatic(desc: StaticDesc): void;
  addSensor(desc: SensorDesc): void;

  /** Change a body between simulated (dynamic) and driven (kinematic). */
  setKind(id: Id, kind: BodyKind): void;
  /** A disabled body takes no part in the simulation (used while a part is in the return chute). */
  setEnabled(id: Id, enabled: boolean): void;
  isEnabled(id: Id): boolean;
  /** Gravity multiplier for one body (0 while held). */
  setGravityScale(id: Id, scale: number): void;
  setDamping(id: Id, linear: number, angular: number): void;

  state(id: Id): BodyState;
  pose(id: Id): Pose;
  /** Teleport. Dynamic bodies keep their velocity unless `setVelocity` follows. */
  setPose(id: Id, pose: Pose): void;
  setVelocity(id: Id, linvel: Vec3, angvel?: Vec3): void;
  applyImpulse(id: Id, impulse: Vec3, angularImpulse?: Vec3): void;
  /** Where a kinematic body should be at the end of the next step (velocity-based, so it pushes dynamic bodies). */
  driveKinematic(id: Id, pose: Pose): void;
  wake(id: Id): void;
  /** Put a body to sleep where it is (it wakes when something touches it). */
  sleep(id: Id): void;

  /** Ids of the dynamic bodies overlapping a sensor after the last step, sorted. */
  sensorContents(id: Id): Id[];

  /** Advance one fixed step and return this step's contacts. */
  step(): Contact[];

  snapshot(): PhysicsSnapshot;
  /** Put every body back exactly as it was at `snapshot()`. Bodies added or removed since are not supported. */
  restore(snapshot: PhysicsSnapshot): void;

  /** Ids of every body (not statics), in insertion order. */
  bodies(): Id[];
  dispose(): void;
}

export interface PhysicsOptions {
  /** Gravity, units per second squared (negative is down). */
  readonly gravity: number;
  readonly dt: number;
}
