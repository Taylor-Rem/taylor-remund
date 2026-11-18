/**
 * What a scene description is: data only, read by `createWorld`. The
 * vignette's table is `scenes/vignette.ts`; later scenes (the full bench)
 * use the same shape.
 */
import type { Affordance, Id, PaintName, PartKind, PartMaterial, PartSize, Pose, StationId, Vec3 } from './types.ts';
import type { Shape } from './physics/port.ts';
import type { SimContext, Unit } from './context.ts';

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
  /**
   * Starts `shipped`: a spare behind the dock door, out of the world until it is needed (the dock sets
   * it on the crate stack when a plain crate ships). Its `pose` is only where its body waits, unseen.
   */
  readonly shipped?: boolean;
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

/**
 * A mouth (§ B1 law 2): a volume on the bench. Whatever comes to rest with its centre inside it is
 * offered to the machine (`machine`, a unit id), which does its verb or answers with a slip naming what
 * it wanted. Mouths are tried in scene order; the first that contains the centre takes it.
 */
export interface MouthSpec {
  readonly id: Id;
  /** The unit that owns it (its `accept` is called). */
  readonly machine: Id;
  readonly station: StationId;
  /** Centre and half extents of the box; turned about +Y by `yaw` degrees. */
  readonly c: Vec3;
  readonly half: Vec3;
  readonly yaw?: number;
  /** Where tap-then-tap carrying sets a part down at this mouth (bottom-centre of the part, world space). */
  readonly drop: Vec3;
}

/** Makes a machine or a crew member for a world: the scene lists them, the world runs them in this order. */
export type UnitFactory = (ctx: SimContext) => Unit;

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
  /** Where on the lane (0..1) it fumbles. */
  readonly fumbleAt: number;
  /** The heading it turns to while winding up the fumble (radians about +Y; 0 faces +Z, the camera). */
  readonly fumbleHeading: number;
  /** The heading it turns to after letting go, for the offer (0 faces +Z, the camera). */
  readonly offerHeading: number;
  /**
   * The fumbled crate's launch, in WORLD space (not Fetch's frame): Fetch always turns to
   * `fumbleHeading` first, so the crate leaves the same hands-pose with the same velocity
   * whichever way Fetch was travelling, and lands in the same place.
   */
  readonly toss: { readonly linvel: Vec3; readonly angvel: Vec3 };
  /** Where the visitor is, for "looks out at the visitor". */
  readonly outward: Vec3;
  /** Its rounds in play mode (S5); without them it laps its lane as in P1. */
  readonly rounds?: FetchRounds;
}

/**
 * Fetch's rounds (§ B3 play mode: "Fetch goes on carrying fresh crates down the belt"; § E5 rule 5:
 * fresh crates from the stack only). It takes the top fresh crate off the stack and sets it on the belt
 * at the mouth's drop point, again and again, no faster than `every` and never with more than `cap`
 * crates in play. What it cannot reach from its tape it stretches for, gives up on, and says so.
 */
export interface FetchRounds {
  /** The crate stack's ground point (x, z), and how far from it (horizontally) a crate still counts as on it. */
  readonly stack: readonly [number, number];
  readonly stackRadius: number;
  /** The mouth it feeds: a crate is set down at this mouth's `drop` point. */
  readonly mouth: Id;
  /** A crate counts as in play while its location is `in` one of these mouths (riding, being shipped), or while it is in Fetch's hands. */
  readonly inPlay: readonly Id[];
  /** At most this many crates in play: it waits, crate in hand, until one ships. */
  readonly cap: number;
  /** At least this many seconds between two crates set down. */
  readonly every: number;
  /** It sets a crate down only while every one of these settings has this value (the belt running forward). */
  readonly feedWhen: readonly { readonly target: Id; readonly field: string; readonly is: string | number | boolean }[];
}

export interface ButtonSpec {
  readonly id: Id;
  readonly name: string;
  /** Where the Button's cap is (world), for picking and the crew's eyes. */
  readonly at: Vec3;
  /** Crates the flinch may knock off (the stack); the top one that is free goes. */
  readonly stack: readonly Id[];
  /** Interactables that misfire at level 1 in rung 1 (the lamp dips, the belt lurches). */
  readonly flinch: readonly Id[];
  /** Horizontal shove given to the stack's top crate, as a change of velocity (units/s, world space). */
  readonly shove: Vec3;
  /** Who prints the card (Revert, when it arrives). */
  readonly cardBy: Id;
  /** Rungs 2 to 4 (S4, `machines/button.ts`). Without it, the stations are `flinch` and the stack is `stack`. */
  readonly ladder?: LadderSpec;
}

/** What the Button's ladder needs from the scene (§ B4): the stations it can misfire, where they are, the stack, the cover. */
export interface LadderSpec {
  /** Every station a rung may misfire, with a point on it (world): "nearest" is measured from the Button's cap. */
  readonly stations: readonly { readonly id: Id; readonly at: Vec3 }[];
  /** The interactable that is the lamp: every rung dips it. */
  readonly lamp: Id;
  /** The station that is the UNDO lever (an undo `by: 'lever'` uses it, the `U` key included), and the one that is the cord (unplugging uses it). */
  readonly lever?: Id;
  readonly cord?: Id;
  /** S6: the station that is the phone line (sending a text uses it). */
  readonly line?: Id;
  /** The crate stack's ground point (x, z) and radius: rung 4 brings down every crate standing inside it. */
  readonly stackAt: readonly [number, number];
  readonly stackRadius: number;
  /** The flip-up cover's handle id. */
  readonly cover: Id;
  /** Its content id (the controls list's name). */
  readonly coverName: string;
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
  /**
   * The crew's size against P1's (1 = P1; 1.25 this phase, ART-P2 § 2). Fetch's body and its tuning
   * (reach, hands, body box, speeds) scale by it; give the robot's `PartSpec.half` already scaled.
   */
  readonly crewScale?: number;
  /** Mouths (§ B1 law 2), tried in this order. */
  readonly mouths?: readonly MouthSpec[];
  /**
   * The machines and crew this scene runs besides the Button, the cord and Fetch (which every scene
   * has), in step order. Adding a machine to a scene is adding one line here (see machines/README in
   * `sim/machine.ts`).
   */
  readonly units?: readonly UnitFactory[];
}
