/**
 * What a scene description is: data only, read by `createWorld`. The
 * vignette's table is `scenes/vignette.ts`; later scenes (the full bench)
 * use the same shape.
 */
import type { Affordance, Id, PaintName, PartKind, PartMaterial, PartSize, Pose, StationId, Vec3 } from './types.ts';
import type { Shape } from './physics/port.ts';

export interface PartSpec {
  readonly id: Id;
  readonly kind: PartKind;
  readonly size: PartSize;
  readonly material: PartMaterial;
  readonly colour: PaintName;
  readonly label: string;
  readonly marks?: readonly string[];
  readonly contents?: string | null;
  /** Starting pose (body centre). Its durable location starts as `rest` here. */
  readonly pose: Pose;
  /** Which station's neighbourhood it belongs to, for the registry. */
  readonly station: StationId;
  /** Content id of its name (screen reader, controls list). */
  readonly name: string;
  /** Override the default box for the kind and size. */
  readonly half?: Vec3;
  /** Override the mass from volume and material. */
  readonly mass?: number;
}

export interface StaticSpec {
  readonly id: Id;
  readonly shape: Shape;
  readonly pose: Pose;
  readonly friction?: number;
  readonly restitution?: number;
}

/** An interactable whose machine has not arrived yet (the lamp, the belt): it can be told and misfired, nothing more. */
export interface FixtureSpec {
  readonly id: Id;
  readonly station: StationId;
  readonly name: string;
  readonly affordances: readonly Affordance[];
}

export interface Lane {
  /** Ground points (x, z) of the segment's ends. */
  readonly a: readonly [number, number];
  readonly b: readonly [number, number];
}

export interface FetchSpec {
  /** Fetch's part id (it is a part of kind `robot` too). */
  readonly id: Id;
  readonly lane: Lane;
  /** Where on the lane it starts, 0 at `a` to 1 at `b`. */
  readonly start: number;
  /** The crate in its hands at the start, if any. */
  readonly carrying: Id | null;
  /** Where on the lane (0..1) it fumbles: the point nearest the Button. */
  readonly fumbleAt: number;
  /** The fumbled crate's launch, world space. */
  readonly toss: { readonly linvel: Vec3; readonly angvel: Vec3 };
  /** Where the visitor is, for "looks out at the visitor". */
  readonly outward: Vec3;
}

export interface ButtonSpec {
  readonly id: Id;
  readonly name: string;
  /** Crates the flinch may knock off (the stack); the top one that is free goes. */
  readonly stack: readonly Id[];
  /** Interactables that misfire at level 1 in rung 1 (the lamp dips, the belt lurches). */
  readonly flinch: readonly Id[];
  /** Horizontal shove given to the stack's top crate, as a change of velocity (units/s, world space). */
  readonly shove: Vec3;
  /** Who prints the card (Revert, when it arrives). */
  readonly cardBy: Id;
}

export interface CordSpec {
  readonly id: Id;
  readonly name: string;
  readonly jacks: readonly { readonly id: Id; readonly name: string; readonly at: Vec3 }[];
  readonly start: Id;
}

export interface SceneDesc {
  readonly id: string;
  /** Units per second squared (negative is down). */
  readonly gravity: number;
  /** The bench volume: anything whose centre leaves it is off the bench (§ B1 "the bench edge"). */
  readonly bench: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number; readonly top: number; readonly ceiling: number };
  /** Below this height (centre), a part has fallen off the bench. */
  readonly fallY: number;
  readonly statics: readonly StaticSpec[];
  readonly parts: readonly PartSpec[];
  readonly fixtures: readonly FixtureSpec[];
  readonly chute: { readonly pose: Pose; readonly linvel: Vec3; readonly delay: number };
  readonly button: ButtonSpec;
  readonly cord: CordSpec;
  /** Fetch, the runner (§ B5). */
  readonly runner: FetchSpec;
}
