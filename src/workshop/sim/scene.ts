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
  /**
   * A crew member's own body (2026-11-20: Patch thrown is a real body while it flies). It is out of the world until
   * its unit is taken hold of (`Unit.embody`), and stowed again by the unit when the unit's script takes over. It is
   * nobody's cargo: never offered to a mouth, never sent up the chute by the world (its unit looks after it off the
   * bench), never touched or committed (where it lies is the unit's business, not the history's), not in the
   * registry (the visitor takes hold of the unit, not of this).
   */
  readonly crewBody?: boolean;
  /** How it meets things, where the material's own figures are not it (a soft toy: its own bounce and drag). */
  readonly feel?: { readonly friction?: number; readonly restitution?: number; readonly linearDamping?: number; readonly angularDamping?: number };
  /** How round its box's edges are (a radius inside `half`, units; the engine allows up to half its least half extent). Default: almost sharp, as a crate's. */
  readonly round?: number;
  /**
   * P4 S5: a thing a project crate holds (sim/machines/crates.ts): it starts in that crate (its location `in` the crate
   * whose id this is: out of the world while the crate is shut, on its tray while it is open). Never a crate.
   * (P4 D3) Or a part another loose part holds (the report press's envelope, `in` the press): out of the world until
   * the unit that owns it brings it out (sim/machines/press.ts).
   */
  readonly stowedIn?: Id;
}

/**
 * P4 S5: a crate that is one of Taylor's projects (sim/machines/crates.ts). `project` is the id its words are under
 * in src/content/bench-projects.json; `lid` and `plate` the ids of its latch and its card's plate (interactables the
 * crates unit registers); `holds` the thing it holds, if any (a part whose spec says `stowedIn` this crate).
 */
export interface ProjectCrate {
  readonly crate: Id;
  readonly project: Id;
  readonly lid: Id;
  readonly plate: Id;
  /** P4 S5 round two: the pick target the view gives its card (and tray): what an opening asks the page to look at. */
  readonly card?: Id;
  readonly holds?: Id;
  /**
   * P4 D3 round three: what this crate's tray allows its thing (world units over the tray's floor, and front to back),
   * where it is not the default (view/bench/stations/parts.ts `THING`): the card stands clear of a thing this tall.
   */
  readonly thing?: { readonly height: number; readonly depth: number };
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

/**
 * Fetch's lane of tape (S5 round 2): a path of straight runs through two or more ground points (x, z),
 * ridden end to end. At each corner the robot leans round an arc (`FETCH_TUNING.cornerRadius` × crewScale,
 * less where a run is too short for it), slowing to `cornerSpeed` (`sim/path.ts`). A layout's rules: a
 * corner turns at most 135°; a run between two corners is at least twice the corner's tangent length
 * (0.9 for a right angle at crewScale 1.5) or the corner is tightened; two runs pass no closer than the
 * tape's width plus Fetch's footprint (see the hand-in, and `laneOutline`).
 */
export interface Lane {
  readonly points: readonly (readonly [number, number])[];
  /**
   * S5 round 3: how far in from each end of the path Fetch's own stops are (where it turns on a lap, the
   * nearest point it returns to), world units; default `FETCH_TUNING.inset` (0.3). A stand point the scene
   * gives (`FetchSpec.stands`) is taken exactly, at a path's very end included; Fetch's centre never runs
   * past either end (it brakes to a stop there, no skid beyond). One number for both ends, or [first end, last end].
   */
  readonly endInset?: number | readonly [first: number, last: number];
}

/**
 * Where on its path Fetch stands to handle something (S5 round 2): a fraction of the path's whole length
 * (0 at its first point, 1 at its last), or a ground point (x, z), taken to the nearest point of the path.
 * Taken exactly (round 3): a stand at a path's end is the end itself, not the inset stop. Without one, it
 * stands at the point of its path nearest the thing (between its stops).
 */
export type StandPoint = number | readonly [number, number];

export interface FetchSpec {
  /** Fetch's part id (it is a part of kind `robot` too). */
  readonly id: Id;
  readonly lane: Lane;
  /** Where on the lane it starts, as a fraction of the whole path (0 at its first point, 1 at its last). */
  readonly start: number;
  /** The crate in its hands at the start, if any. */
  readonly carrying: Id | null;
  /** Where on the lane it fumbles, as a fraction of the whole path. */
  readonly fumbleAt: number;
  /**
   * S5 round 2: the farthest the centre of its grip can be from its own centre, world units, measured on
   * the bench (horizontally: its arms telescope up as well as out). Not scaled again by `crewScale`.
   * Every "can it reach" reads it: the attract lap's check, taking, setting down, the tap, the stretch
   * that ends in OUT OF MY LANE. Without it, P2's number: `(FETCH_TUNING.reach + handForward) × crewScale`.
   */
  readonly reach?: number;
  /** S5 round 2: where on its path it stands for each thing it handles (`StandPoint`); each optional. */
  readonly stands?: { readonly stack?: StandPoint; readonly tray?: StandPoint; readonly phone?: StandPoint; readonly feed?: StandPoint; /** S5 R1: the chute's pad. */ readonly pad?: StandPoint };
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
  /** S6: attract mode's lap (§ B3); without it (or without `rounds`) it laps its lane until the first action, as in P1. */
  readonly attract?: FetchAttract;
}

/**
 * S6: attract mode's lap, as Fetch runs it (§ B3): a crate from the stack (`rounds.stack`) to the tray
 * (`tray`, a mouth), a tap on the phone (`phone`) that texts `jack` (Patch moves the cord there first),
 * the painted crate to the belt (`rounds.mouth`). The text is `say` (the content id the phone shows) and
 * `words` (what the parser reads; a test holds that they mean the same). It runs only if every place is
 * within Fetch's reach of its tape.
 */
export interface FetchAttract {
  readonly tray: Id;
  readonly phone: Vec3;
  readonly jack: Id;
  readonly say: string;
  readonly words: string;
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
  /**
   * S5 R1: the chute's pad (x, z), where a shipped crate's replacement lands (the dock's `pad`), and how far from it a crate
   * counts as on it. With one: whenever the stack is below its starting count and the pad holds a fresh crate, Fetch carries
   * that crate to the stack (in both modes); otherwise its rounds feed the belt from the pad first, the stack after.
   */
  readonly pad?: readonly [number, number];
  readonly padRadius?: number;
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
  /** P4 S5: the crates that are projects (with a latch, a card and room for a thing); read by the crates unit, the view and the controls list. */
  readonly projects?: readonly ProjectCrate[];
  /**
   * P4 D3: durable fields a visit remembers (sim/saved.ts `kept`), each a field a unit defines: the report press's
   * holders and its drawer. Remembered only where they differ from how the visit began; "Reset the workshop" forgets them.
   */
  readonly keep?: readonly { readonly target: Id; readonly field: string }[];
}
