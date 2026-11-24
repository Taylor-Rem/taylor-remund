/**
 * The whole bench (REWRITE.md § C, § G "P2"; ART-P2 § 3): the scene the
 * playable bench boots from. Data only, like `scenes/vignette.ts`: every
 * number is in ONE table, `AT`, and the scene below is derived from it.
 *
 * This is the blockout's table (L1): where every station stands, with a
 * plain box body for each piece that has arrived and for each stand-in of
 * a piece being built, so loose parts already meet them where they will
 * be. The machines engineer takes it over: a box here is a footprint, not
 * a collider design. The view's `LAYOUT` (`view/bench.ts`) carries the same
 * numbers for drawing and is checked against this table in
 * `tests/unit/view/bench.test.ts`.
 *
 * Conventions (art-direction § 2): 1 unit = Fetch's P1 body height (it is
 * drawn bigger this phase: view/bench.ts CREW_SCALE); bench top y = 0; +X to the visitor's right;
 * +Z toward the visitor; the back wall's face at z = -5. Statics are centre
 * + half extents; a yawed static turns about +Y by `yaw` degrees.
 */
import type { Pose, Vec3 } from '../types.ts';
import type { FetchRounds, MouthSpec, PartSpec, ProjectCrate, SceneDesc, StaticSpec } from '../scene.ts';
import type { SimContext } from '../context.ts';
import { CRATE_EDGE, defaultHalfExtents } from '../parts.ts';
import { qyaw } from '../math.ts';
import { belt, BELT_FIELDS, BELT_TUNING } from '../machines/belt.ts';
import { striker } from '../machines/striker.ts';
import { dock, DOCK_TUNING } from '../machines/dock.ts';
import { chute } from '../machines/chute.ts';
import { crates } from '../machines/crates.ts';
import { ledger } from '../machines/ledger.ts';
import { paintDial } from '../machines/paint-dial.ts';
import { press } from '../machines/press.ts';
import { toolwall } from '../machines/toolwall.ts';
import { openingStand } from '../machines/opening-stand.ts';
import { rampAt, rampDoor, rampLength } from '../ramp.ts';
import type { RampSpec } from '../ramp.ts';
import { undoLever } from '../machines/undo-lever.ts';
import { revert } from '../crew/revert.ts';
import { line } from '../machines/line.ts';
import { platen } from '../machines/platen.ts';
import { storefront } from '../machines/storefront.ts';
import { lamp } from '../machines/lamp.ts';
import { patch } from '../crew/patch.ts';
import type { PatchSpec } from '../crew/patch.ts';
import { FETCH_TUNING } from '../crew/fetch.ts';
import { lanePath } from '../path.ts';

interface Box {
  readonly c: Vec3;
  readonly half: Vec3;
  /** Degrees about +Y (0: good side to +Z). */
  readonly yaw?: number;
}

const DEG = Math.PI / 180;

/** The layout table. Tune here (and in the view's LAYOUT: the test holds them together). */
export const AT = {
  /** 18 × 10 (ART-P2 § 2). */
  bench: { minX: -9, maxX: 9, minZ: -5, maxZ: 5 },
  /**
   * The wall behind the bench: its body stands 9 high, above anything a hand can lift (7.5) or throw (7.2) a thing to,
   * so nothing passes over it (the drawn wall runs on up out of the picture; at 6 high a crate thrown from the top of
   * the lift went through the drawn boards, and Patch thrown up and back sailed over instead of meeting it).
   */
  backWall: { c: [0, 4.5, -5.15], half: [10.5, 4.5, 0.15] } as Box,

  // ── the back row: board, stool (the tool wall, lamp, sign and window hang on the wall: no bodies) ──
  /**
   * The whole switchboard (four live jacks; origin (-0.1, -4.38)) against the wall, in three bodies: the desk up to
   * the keyshelf's top (0.89), out to the shelf's front edge; the jack panel, frame and crest behind it, back from
   * the shelf; the runner's plank in front, low. Its six jack mouths and the stool's stop for each live jack, and a
   * point on the keyshelf (left of the writing ledge, clear of the pad), are measured from the piece.
   */
  board: { c: [-0.1, 0.445, -4.445], half: [2.6, 0.445, 0.545] } as Box,
  boardPanel: { c: [-0.1, 2.05, -4.67], half: [2.6, 1.16, 0.32] } as Box,
  boardRunner: { c: [0.425, 0.026, -3.46], half: [3.025, 0.026, 0.35] } as Box,
  jacks: {
    storefront: [-1.3, 1.46, -4.264] as Vec3, platen: [-0.28, 1.46, -4.264] as Vec3, belt: [0.72, 1.46, -4.264] as Vec3, lamp: [1.62, 1.46, -4.264] as Vec3,
    reserved1: [-2.15, 1.46, -4.264] as Vec3, reserved2: [-1.79, 1.46, -4.264] as Vec3,
  },
  /** Where the stool stands on the runner to work each live jack (x, z), and at rest (`stool` below). */
  stoolAt: { storefront: [-1.15, -3.46] as const, platen: [-0.13, -3.46] as const, belt: [0.87, -3.46] as const, lamp: [1.77, -3.46] as const },
  keyshelf: [1.4, 0.89, -4.1] as Vec3,
  /** The lamp's clamp on the wall rail (x, z): the view's LAYOUT `lamp` (the bench test holds them together). */
  lamp: [-3.1, -5] as const,
  /** Patch's stool, lowered (seat 0.62 over the runner's top 0.052), at rest at the runner's right end. */
  stool: { c: [3.02, 0.369, -3.46], half: [0.316, 0.317, 0.32] } as Box,

  // ── the middle row ──
  /** The UNDO lever (real piece, origin (-2.5, 0.3)): its console, quadrant and lever at home, as one box. */
  undo: { c: [-2.5, 0.983, 0.352], half: [0.79, 0.983, 0.462] } as Box,
  /** The phone on its easel. */
  phone: { c: [0.2, 0.36, 1.9], half: [0.21, 0.36, 0.15] } as Box,
  /** The reshaped platen (real piece, origin (3.14, 0.8)): its console (x 0.4..2.12, z -1.2..0.42 from the origin, the column, tank and PLATEN plate on it); its column; its tank. Its left stand, PLATEN.stand.left, is the end of Fetch's path. */
  platen: { c: [4.4, 0.31, 0.41], half: [0.86, 0.31, 0.81] } as Box,
  /** The platen's turntable on its round plinth, at the piece's front left: its cast foot (radius 0.59 round the seat) as a box. */
  platenPlinth: { c: [3.19, 0.31, 0.7], half: [0.59, 0.31, 0.59] } as Box,
  platenColumn: { c: [4.09, 1.5, 0.7], half: [0.12, 1.5, 0.12] } as Box,
  platenTank: { c: [4.58, 0.75, -0.06], half: [0.26, 0.75, 0.26] } as Box,
  /** The storefront (real piece, origin (7.6, -3.6)): its bounds, jack box and conduit included. */
  storefront: { c: [7.07, 1.415, -3.535], half: [1.74, 1.415, 0.535] } as Box,
  /** Shipped (P4, clay): four 1.0 × 1.0 pallets, 0.15 high. */
  pallets: [
    { c: [7.4, 0.075, -2.05], half: [0.5, 0.075, 0.5] },
    { c: [8.45, 0.075, -2.05], half: [0.5, 0.075, 0.5] },
    { c: [7.48, 0.075, -0.5], half: [0.5, 0.075, 0.5] },
    { c: [8.5, 0.075, -0.5], half: [0.5, 0.075, 0.5] },
  ] as readonly Box[],
  /** Their stacks of crates (fronts flush with the pallets' fronts): the back row 1.2 high, the front row 0.6. */
  stacks: [
    { c: [7.3975, 0.675, -1.85], half: [0.4975, 0.525, 0.3] },
    { c: [8.4525, 0.675, -1.85], half: [0.4975, 0.525, 0.3] },
    { c: [7.48, 0.375, -0.225], half: [0.475, 0.225, 0.225] },
    { c: [8.5, 0.375, -0.225], half: [0.475, 0.225, 0.225] },
  ] as readonly Box[],
  /** The mailbox on its post, the résumé clipboard on it (P4, clay): front right. */
  mailbox: { c: [8.25, 0.65, 4.2], half: [0.21, 0.65, 0.16] } as Box,
  /** Revert risen on its lift (real piece at the crew's 1.5, origin (-4.85, 0.3)). Its hatch's doors stand open either side, low. */
  revert: { c: [-4.832, 0.672, 0.372], half: [1.026, 0.672, 0.768] } as Box,

  // ── the Button's row ──
  /** The Button's console (the body only). Deck top at y 1.04. */
  console: { c: [-0.6, 0.52, 0.5], half: [1.05, 0.52, 0.76] } as Box,
  /** The Button's cap on the console deck. */
  buttonCap: [-0.28, 1.25, 0.3] as Vec3,

  // ── the front: the lane, the belt and its ends ──
  /**
   * The crate stack: ground point (x, z) of its bottom crate; L then M (two high, A1 round 7), a little off true. Between Fetch's
   * two runs, IN FRONT of the back run: Fetch takes from it facing the visitor, 0.95 from where it stands.
   */
  stack: [2.21, 1.75] as const,
  /**
   * Fetch's path of yellow tape (x, z), A1 round 7: a FRONT run just behind the belt's far rail from the lever to
   * past the phone (it feeds the belt near its left end, facing the visitor, so a crate rides past the lever and the
   * Button, under the striker and out through the dock), a short jog back beside the console, and a BACK run that
   * ends AT the platen's left stand (taken exactly: side-on, the seat straight ahead, arms out across its low left
   * edge) with the phone and the stack in front of it. Every run is at least Fetch's footprint (0.69) off every fixed
   * body (the belt's bed, the console, the phone), so it can always drive back to it (S5 round 3: a way back to a
   * point of its path closer than that to a body is never clear); but its last 0.3, by the platen's plinth. Every place it
   * handles is within 1.0 of where it stands (`runner.stands`, `reach` 1.10).
   */
  lane: { points: [[-2.9, 2.78], [1.16, 2.78], [1.16, 0.7], [2.2, 0.7]] as const, endInset: [0.6, 0.3] as const },
  /**
   * Where Fetch stands for each thing it handles (x, z on its path): the belt's feed (in front), the phone and the stack (in front), the tray (the path's end, side-on),
   * and (S5 R1) the chute's pad: the tape's left end, the pad's crate in profile, Fetch facing -x.
   */
  stands: { feed: [-2.2, 2.78] as const, phone: [1.16, 1.9] as const, stack: [1.16, 1.75] as const, tray: [2.2, 0.7] as const, pad: [-2.9, 2.78] as const },
  /**
   * S5 R1: the chute's pad: where a fresh crate lands when a plain crate ships (the deflector row's third, last slot; A1 tapes it).
   * One constant: the dock aims the chute's arc at it, Fetch's rounds take from it.
   */
  pad: [-3.91, 2.68] as const,
  /** R2: where a robot the dock refuses is thrown back to (x, z): Fetch's stand at the pad, else the next free place along its tape. */
  home: [[-2.9, 2.78], [-2.35, 2.78], [-1.8, 2.78], [-1.25, 2.78]] as const,
  /** S5 R1: the chute's throw onto the pad: the top of its arc (world y): a crate's bottom is 1.2 or more over the deflector row's slots 1 and 2 (x -5.9..-4.3) at every size; about 1.15 s in the air. */
  padApex: 3.6,
  /** S5 R1 (lead): the chute aims by the crate's near face: every size's face toward the stand lands at x -3.57 (an L centred at -3.97, an S at -3.80), 0.07 from Fetch's body at the stand. */
  padNear: [-3.57, 2.68] as const,
  /** The length of the row at the deflector's foot (three crates side by side), from its end right of the belt's control housing. */
  offBackRow: 2.4,
  /** The belt's feed point (x): where Fetch sets crates on the belt, right in front of where it stands; upstream of the striker. */
  beltFeed: -2.2,
  /** The platen's seat as the reshaped piece will have it (PLATEN.stand.left + 1.0: 0.6 inside its left foot, on the seat's own z). Today's piece is placed with its left foot where the new one's will be. */
  platenSeat: [3.19, 0.62, 0.7] as Vec3,
  /** Where along the lane Fetch starts (0 at a), with the loose crate in its hands: on the front run, left of the phone. */
  /** S5 R1: where on its front run Fetch starts (x): exactly where it started before the tape's left end moved 0.3 left for the pad (0.12 of the old path), so the first frame does not change. */
  fetchStartX: -1.8207539967061512,
  /**
   * A1 round 7: the stack is two high (its top within the arm's reach); today's third crate starts loose on the bench in
   * front of the Button's console, the first thing to pick up (clear of Fetch's front run and below the console's plate).
   */
  firstCrate: [-1.0, 0.225, 1.85] as Vec3,
  /** The loose crate's own starting point (its durable location until it first rests elsewhere). */
  looseCrate: [0.0, 0.225, 2.2] as Vec3,
  /**
   * Where on the lane Fetch fumbles (x, on its front run): in front of the UNDO lever, under the lamp, in profile; the
   * crate tumbles back off the run (A1 round 7: the run goes on past it, so it must land clear of the path) to rest
   * in front of the lever, between the run and the lever.
   */
  fumbleX: -1.6,
  // S5 R1: the slip's throw a little more back and none to the left (was [-0.4, 1.8, -1.3], resting at (-3.10, 2.65): on the
  // tape's new left end and against the pad): it now rests at about (-2.77, 1.85), between the run and the lever, 0.93
  // behind the run (clear of Fetch's footprint), in reach from it (1.10), 1.4 from the pad. Measured stable for x 0.05..0.1, z -2.4..-2.6.
  fumble: { heading: -Math.PI / 2, linvel: [0.08, 1.8, -2.5] as Vec3, angvel: [-5, 0, 0] as Vec3, offerHeading: 0 },
  /** The belt's bed (carrying surface at y 0.5) and its control housing at the left end (the `line` belt: dial, lever, lamp; x -7.34..-5.96). Belt length 10. A part run off the back by the deflector rests at its `off.back`, (-5.4, 2.68): beside the stack, at the lane's left end. */
  belt: { c: [-0.9, 0.25, 4.0], half: [5.0, 0.25, 0.52] } as Box,
  beltMotor: { c: [-6.65, 0.63, 4.1], half: [0.69, 0.63, 0.79] } as Box,
  /**
   * The striker (real piece, origin (2.975, 3.072), its post there): its post, base plate and cam housing (right of the
   * post) as one box, 1.1 high (the arm above, which parts on the belt pass under, is no body). Its hammer, over the
   * belt 0.375 left of the post, is `strikerHammer` (LINE.strikerX reads it): 1.5 from the belt's far end, right of the stack.
   */
  striker: { c: [3.175, 0.55, 3.072], half: [0.4, 0.55, 0.13] } as Box,
  strikerHammer: 2.6,
  /**
   * The dock (real piece, origin the door's middle at (5.92, 3.55), its ramp's straight run 0.5 longer than L1's so the platen's plate stands clear of its portal; its bay turned 40° toward the camera,
   * built in): its portal (2.08 tall; the lamp's cage stands above it) and bay as one box in the door's frame (yaw -50). The ramp from the belt is low and not a body here.
   */
  dock: { c: [6.207, 1.04, 3.309], half: [0.94, 1.04, 0.525], yaw: -50 } as Box,
  /** Where the dock's door (the piece's origin) stands: the ramp below is fitted to bring it here (view/bench.ts DOCK_REACH gives the same). */
  dockDoor: [5.92, 3.55] as const,
  /** The return chute's mouth (real piece at (-7.8, 0, 5), run 2, aim 12: its `mouth` socket), and how parts come out of it: onto the bench at about its `land` (-6.35, 2.79), left of the deflector's foot. */
  chute: { p: [-7.031, 1.23, 2.932] as Vec3, linvel: [1.7, 0.6, -0.36] as Vec3 },
} as const;

/**
 * P4 S5: the crates are Taylor's projects ("the workshop is literally shipping my work", 2026-11-21), each by the id its
 * words are under in src/content/bench-projects.json (tests/unit/content/bench-projects.test.ts holds the two together).
 * The three with demonstrations to come (DEMO-CONCEPTS.md) are the three that stay where a visitor finds them: the ledger
 * repair in the large crate at the bottom of the stack, the report framework in the middle one on top of it, t-components
 * (the paint dial) in the loose crate in front of the console, the first thing to pick up. The other three take turns
 * on Fetch's rounds (`SPARES` below): Artificer starts in its hands.
 */
export const PROJECT_OF: Readonly<Record<string, string>> = {
  'crate-1': 'ledger',
  'crate-2': 'reports',
  'crate-3': 't-components',
  'crate-4': 'artificer',
  'crate-spare-1': 'support-desk',
  'crate-spare-2': 'clean-green',
};
/**
 * P4 D1: the ledger board, the Ledger Management System's thing (sim/machines/ledger.ts), in its crate (the large one at
 * the bottom of the stack). A loose part with state (the tokens are its own durable field, drawn, not bodies) and two
 * controls that ride on it. Its body: as large as the large crate's tray allows (view/kit/pieces/ledger-board/dims.ts says why), low (the hopper, the flag
 * and the plunger stand above its box). `half` is the view's too (view/kit/pieces/ledger-board/dims.ts holds the same).
 */
export const LEDGER = {
  unit: 'ledger',
  board: 'ledger-board',
  crate: 'crate-1',
  crank: 'ledger-crank',
  plunger: 'ledger-plunger',
  /** What the camera looks at when the board asks for it out on the bench (a pick target the view registers that is never pressed). */
  look: 'ledger-look',
  half: [0.38, 0.04, 0.215] as Vec3,
  mass: 0.1,
} as const;

/**
 * P4 D2b: the paint dial, t-components' thing (sim/machines/paint-dial.ts), in its crate (the small one in front of the
 * console). A loose part with one durable field (the scheme the workshop wears) and a knob that rides on it. Its body:
 * the fan of chips on its plate, the knob above it. `half` is the view's too (view/kit/pieces/paint-dial PAINT_DIAL).
 */
export const PAINT = {
  unit: 'paint',
  dial: 'paint-dial',
  crate: 'crate-3',
  knob: 'paint-dial-knob',
  half: [0.155, 0.036, 0.1] as Vec3,
  mass: 0.02,
} as const;

/**
 * P4 D3: the report press, the Report Generation Framework's thing (sim/machines/press.ts), in its crate (the middle one,
 * on top of the stack). A loose part with state (what its two holders show and the copies in its drawer are its own
 * durable fields, drawn) and one lever that rides on it; and its envelope, the one real loose part it makes, which starts
 * in the press (`stowedIn` the press) and comes home to it after it ships. The press's body is its iron and its wooden
 * base, about a small crate's footprint (its holders, its lever and its arm stand above the box); `bed` is where the
 * envelope sits on the spring arm, from the body's middle. view/kit/pieces/report-press/dims.ts holds the same numbers.
 */
export const PRESS = {
  unit: 'press',
  body: 'report-press',
  envelope: 'report-envelope',
  crate: 'crate-2',
  lever: 'press-lever',
  /** Its own look box (the view registers it, never pressed): what it asks the camera to frame off its tray. */
  look: 'report-press-look',
  half: [0.2625, 0.0875, 0.2] as Vec3,
  mass: 0.22,
  envelopeHalf: [0.14, 0.008, 0.09] as Vec3,
  envelopeMass: 0.02,
  bed: [0.33125, 0.1355, -0.00625] as Vec3,
  /** What its crate's tray must allow it (ProjectCrate.thing): the sheets' top over the tray's floor (the lever, resting back, crosses lower), and its depth. */
  thing: { height: 0.68, depth: 0.5 },
} as const;

/**
 * P4 T2: the tool wall (sim/machines/toolwall.ts). Eight tools, each a loose part (kind `tool`) that starts on its peg.
 * Per tool: its body (`half`: the kit's tool bounds, view/kit/pieces/toolwall), where its middle hangs and how it is
 * turned there (`at`, `q`: the board at view/bench.ts LAYOUT `toolwall`, the kit's `hangOf`; tests/unit/view/toolwall.test.ts
 * holds them together), its weight, and its size and material (its note: § B1 property table).
 *   laravel: open-ended spanner (rings)    vue: screwdriver          php: claw hammer (heavy, low)
 *   python: pliers                          rust: flat file           sql: try-square
 *   flutter: flat paint brush               claude-code: hand-cranked drill (the owner chooses between candidates)
 * The board is a body (`board`): a thrown thing meets its face, not the wall behind it; from 1.4 up only (its lowest unit
 * is left to the wall behind: under Revert's height a body there would keep Revert from the bench's back left corner).
 */
export const TOOLWALL = {
  unit: 'toolwall',
  sheet: 'toolwall-sheet',
  look: 'toolwall-look',
  board: { c: [-7.35, 3.705, -4.938], half: [2.76, 2.305, 0.05] } as Box,
  tools: {
    laravel: { half: [0.1696, 0.5645, 0.05], at: [-8.6436, 3.6235, -4.813], q: [0, 0, 0, 1], size: 'M', material: 'metal', mass: 0.12 },
    vue: { half: [0.0893, 0.575, 0.0948], at: [-6.95, 3.703, -4.768], q: [0, 0, 0, 1], size: 'S', material: 'wood', mass: 0.06 },
    php: { half: [0.3515, 0.583, 0.0819], at: [-5.5805, 3.698, -4.788], q: [0, 0, 0, 1], size: 'L', material: 'metal', mass: 0.2 },
    python: { half: [0.1815, 0.5211, 0.0703], at: [-8.6475, 1.7661, -4.803], q: [0, 0, 0, 1], size: 'M', material: 'metal', mass: 0.1 },
    rust: { half: [0.078, 0.6, 0.078], at: [-7.01, 1.878, -4.788], q: [0, 0, -Math.SQRT1_2, Math.SQRT1_2], size: 'S', material: 'metal', mass: 0.08 },
    sql: { half: [0.28, 0.49, 0.054], at: [-5.472, 1.774, -4.809], q: [0, 0, 0, 1], size: 'M', material: 'wood', mass: 0.08 },
    flutter: { half: [0.145, 0.5395, 0.058], at: [-8.7305, 5.068, -4.81], q: [0, 0, -Math.SQRT1_2, Math.SQRT1_2], size: 'S', material: 'wood', mass: 0.05 },
    'claude-code': { half: [0.2136, 0.586, 0.1158], at: [-6.866, 5.4136, -4.7268], q: [0, 0, Math.SQRT1_2, Math.SQRT1_2], size: 'L', material: 'metal', mass: 0.18 },
  } as Readonly<Record<string, { half: Vec3; at: Vec3; q: readonly [number, number, number, number]; size: 'S' | 'M' | 'L'; material: 'metal' | 'wood'; mass: number }>>,
} as const;
/** A tool's part id, its place (a mouth), and the box a look at it out on the bench asks for. */
export const toolId = (kind: string): string => `tool-${kind}`;
export const pegId = (kind: string): string => `peg-${kind}`;
export const toolLook = (kind: string): string => `tool-${kind}-look`;
/** The half extents along the world axes of a body of half extents `h` turned by `q` about Z only (the tools hang in the board's plane). */
function zTurnedHalf(h: Vec3, q: readonly [number, number, number, number]): Vec3 {
  const a = 2 * Math.atan2(q[2], q[3]);
  const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  return [h[0] * c + h[1] * s, h[0] * s + h[1] * c, h[2]];
}
const TOOL_PARTS: readonly PartSpec[] = Object.entries(TOOLWALL.tools).map(([kind, t]) => ({ id: toolId(kind), kind: 'tool' as const, size: t.size, material: t.material, colour: 'bare', label: '', station: 'tools' as const, name: `name.tool.${kind}`, pose: { p: t.at, q: [...t.q] as [number, number, number, number] }, half: t.half, mass: t.mass, stowedIn: TOOLWALL.unit }));
/**
 * Each tool's place on the board, a mouth (tap-then-tap and the keys set a tool down at it: `drop` is where its middle
 * hangs, less its half height, so a tool placed there is where it hangs): its body's box where it hangs, a little more
 * all round, out from the board as far as the wall takes a tool back (`TOOLWALL_TUNING.catchDepth`).
 */
const TOOL_MOUTHS: readonly MouthSpec[] = Object.entries(TOOLWALL.tools).map(([kind, t]) => {
  const w = zTurnedHalf(t.half, t.q);
  return { id: pegId(kind), machine: TOOLWALL.unit, station: 'tools' as const, c: [t.at[0], t.at[1], t.at[2] + 0.25] as Vec3, half: [w[0] + 0.08, w[1] + 0.08, 0.3] as Vec3, drop: [t.at[0], t.at[1] - t.half[1] - 0.01, t.at[2]] as Vec3 };
});

/** Each project crate's latch, its card's plate and its card (sim/machines/crates.ts registers them); the ledger's crate holds its board, the framework's its press, t-components' its paint dial. */
export const PROJECT_CRATES: readonly ProjectCrate[] = Object.entries(PROJECT_OF).map(([crate, project]) => ({ crate, project, lid: `${crate}-lid`, plate: `${crate}-plate`, card: `${crate}-card`, ...(crate === LEDGER.crate ? { holds: LEDGER.board } : crate === PRESS.crate ? { holds: PRESS.body, thing: PRESS.thing } : crate === PAINT.crate ? { holds: PAINT.dial } : {}) }));

const e = CRATE_EDGE;
const [sx, sz] = AT.stack;
const pose = (p: Vec3, yaw = 0): Pose => ({ p, q: qyaw(yaw) });
const box = (id: string, b: Box, extra: Partial<StaticSpec> = {}): StaticSpec => ({ id, shape: { type: 'box', half: b.half }, pose: pose(b.c, (b.yaw ?? 0) * DEG), ...extra });
/** Fetch's lane as the path it rides (S5 round 2: runs of tape, corners rounded): fractions along it, and points on it. */
const lanePathOf = () => lanePath(AT.lane.points, FETCH_TUNING.cornerRadius * CREW_SCALE);
/** The fraction of the path at the point of it nearest x on its first run (for a mark given as an x). */
const laneT = (x: number): number => lanePathOf().nearest(x, AT.lane.points[0][1]) / lanePathOf().length;
const lanePoint = (t: number): [number, number] => lanePathOf().at(t * lanePathOf().length);

/** Unpainted wood: a fresh crate's colour. */
export const BARE = 'bare'; // (TOOL_PARTS above spells it: they are made before this line)

// ───────────── the line (S2): derived from AT, never a number of its own except where noted ─────────────

/** The crew's size against P1's (ART-P2 § 2: drawn 1.5× since L1 round 2). Fetch's body and tuning scale by it. */
export const CREW_SCALE = 1.5;
const FETCH_HALF = defaultHalfExtents('robot', 'M').map((h) => h * CREW_SCALE) as unknown as Vec3;

const beltTop = AT.belt.c[1] + AT.belt.half[1];
const beltEnd = AT.belt.c[0] + AT.belt.half[0];

/**
 * The dock's roller ramp (sim/ramp.ts), owned here. Its shape constants are the dock piece's (DOCK in
 * view/kit/pieces/dock/dims.ts: a 40° turn, the lead and lip, the sill, the first roller 0.12 past the
 * belt's bed); it starts at the belt's far end and is fitted, the piece's way (`fitRamp`), to bring the
 * door as near `AT.dockDoor` as a bend no tighter than 0.75 allows. The door then stands at
 * `LINE.door.origin`: that is where the dock piece goes (placed with no yaw, `turn` 40).
 */
const RAMP_SHAPE = { turn: 40, lead: 0.12, lipZ: 0.24, sillY: 0.1, gap: 0.12, width: 0.92 } as const;
const RAMP: RampSpec = (() => {
  const t = RAMP_SHAPE.turn * DEG;
  const start: Vec3 = [beltEnd + RAMP_SHAPE.gap, beltTop, AT.belt.c[2]];
  const d = RAMP_SHAPE.lead + RAMP_SHAPE.lipZ;
  const radius = Math.max(0.75, Math.min(2.2, (start[2] - AT.dockDoor[1] - d * Math.sin(t)) / (1 - Math.cos(t))));
  const approach = Math.max(0, AT.dockDoor[0] - start[0] - radius * Math.sin(t) - d * Math.cos(t));
  return { start, approach, radius, turn: RAMP_SHAPE.turn, lead: RAMP_SHAPE.lead, lipZ: RAMP_SHAPE.lipZ, topY: beltTop, sillY: RAMP_SHAPE.sillY, width: RAMP_SHAPE.width };
})();
const DOOR = rampDoor(RAMP);

/** Where the line's machines stand and what they reach, all read from `AT`. */
/**
 * The motor end's deflector, as the simulation owns it (the belt piece draws it: `DEFLECT` in
 * view/kit/pieces/belt/dims.ts; tests/unit/sim/deflector.test.ts holds the two together). In belt space
 * (x from the belt's left end, z from its centre line): the deflector crosses the belt from the near rail
 * at x 0.95 to the far edge at x 0.07; a reversed part meets it about `meet` from the end, goes off the
 * BACK through the 1.0 gap in the far rail and down the slide, and comes to rest at `rest`. Nothing may be
 * dropped onto the belt within `clear` of the end (that is the deflector's).
 */
const DEFLECTOR = { meet: 0.29, rest: [0.5, -1.32] as const, clear: 1.1 } as const;
const OFF_BACK: Vec3 = [AT.belt.c[0] - AT.belt.half[0] + DEFLECTOR.rest[0], 0, AT.belt.c[2] + DEFLECTOR.rest[1]];
/**
 * S7: the slide's foot as a row (world x of its ends): from just clear of the return chute's mouth (a part
 * coming back up it must not be blocked) to where Fetch's footprint reaches at the lane's left end (it
 * overshoots every stop, as far as the lane's end: a part set down closer would be knocked by its next lap). Parts
 * guided off the back fill it from the far (chute) end, side by side. (A part coming back up the chute
 * lands about 0.7 in from its mouth: on the row's far end, if something stands there.)
 */
const OFF_BACK_ROW_MIN = Math.max(AT.chute.p[0] + 0.45, AT.beltMotor.c[0] + AT.beltMotor.half[0] + 0.05);
const OFF_BACK_ROW = {
  // A1 round 6: and right of the belt's control housing, which hides the bench behind it from the home framing; three
  // crates' room (2.4) long, and never into Fetch's reach of its path's start
  minX: OFF_BACK_ROW_MIN,
  maxX: Math.min(OFF_BACK_ROW_MIN + AT.offBackRow, Math.min(...AT.lane.points.map((p) => p[0])) - Math.hypot(FETCH_HALF[0], FETCH_HALF[2])),
} as const;

/** The belt's surface speed as its settings ask (read from the world, not from the belt): the dock's rollers keep up with it. */
const beltFeed = (ctx: SimContext): number => (ctx.setting('belt', BELT_FIELDS.running) === true ? (BELT_TUNING.speeds[(ctx.setting('belt', BELT_FIELDS.speed) as number) - 1] ?? 0) : 0);

export const LINE = {
  belt: { from: AT.belt.c[0] - AT.belt.half[0], to: beltEnd, top: beltTop, z: AT.belt.c[2], halfWidth: AT.belt.half[2], offBack: OFF_BACK, offBackRow: OFF_BACK_ROW, deflectAt: AT.belt.c[0] - AT.belt.half[0] + DEFLECTOR.meet },
  /** The striker's arm crosses the belt at its post's x. */
  strikerX: AT.strikerHammer,
  /** The roller ramp from the belt's far end to the dock's sill. */
  ramp: RAMP,
  /** The dock's door: its origin (where the dock piece stands), the middle of its sill, and the way in. */
  door: DOOR,
} as const;

/** The ramp's colliders: a bridge over the gap from the belt's bed, then short yawed slabs along its centre line, each at its middle's height. */
const RAMP_STATICS: readonly StaticSpec[] = (() => {
  const n = 5;
  const len = rampLength(RAMP);
  const bridge: StaticSpec = { id: 'dock-ramp-0', shape: { type: 'box', half: [RAMP_SHAPE.gap / 2 + 0.04, beltTop / 2, RAMP.width / 2] }, pose: pose([beltEnd + RAMP_SHAPE.gap / 2, beltTop / 2, AT.belt.c[2]]), friction: 0.9 };
  return [bridge, ...Array.from({ length: n }, (_, i) => {
    const m = rampAt(RAMP, ((i + 0.5) * len) / n);
    const top = m.p[1];
    return { id: `dock-ramp-${i + 1}`, shape: { type: 'box' as const, half: [len / n / 2 + 0.04, top / 2, RAMP.width / 2] as Vec3 }, pose: { p: [m.p[0], top / 2, m.p[2]] as Vec3, q: qyaw(Math.atan2(-m.hz, m.hx)) }, friction: 0.9 };
  })];
})();

const L = LINE.belt;
/** The ramp's footprint (x, z bounds of its centre line, widened by half its width). */
const rampBox = (() => {
  const pts = Array.from({ length: 33 }, (_, i) => rampAt(RAMP, (rampLength(RAMP) * i) / 32).p);
  const w = RAMP.width / 2;
  return { minX: Math.min(...pts.map((p) => p[0])) - w * 0.2, maxX: Math.max(...pts.map((p) => p[0])) + w * 0.5, minZ: Math.min(...pts.map((p) => p[2])) - w, maxZ: Math.max(...pts.map((p) => p[2])) + w };
})();
/** The mouths (§ B1 law 2). A part rests in one when its centre is inside. */
const MOUTHS: readonly MouthSpec[] = [
  // the belt: its whole carrying surface, anything resting on it (centre above the surface)
  { id: 'belt', machine: 'belt', station: 'line', c: [(L.from + L.to) / 2, L.top + 1.5, L.z], half: [(L.to - L.from) / 2, 1.5, L.halfWidth], drop: [Math.max(L.from + DEFLECTOR.clear, AT.beltFeed), L.top, L.z - 0.22] },
  // the dock: its ramp from the belt's end to the sill (and the bench either side of it)
  { id: 'dock', machine: 'dock', station: 'line', c: [(L.to + rampBox.maxX) / 2, 1.3, (rampBox.minZ + rampBox.maxZ) / 2], half: [(rampBox.maxX - L.to) / 2, 1.3, (rampBox.maxZ - rampBox.minZ) / 2], drop: rampAt(RAMP, 0.2).p },
];

/**
 * The crates that wait behind the dock door at the start and come up the chute as crates ship (§ D 7; R3's last
 * resort). P4 S5: two, not three, both small, and each a project: with the four on the bench, Taylor's six projects.
 * Small, because on Fetch's rounds it is the small crate it starts with that ships, lap after lap (the stack's two stay
 * where they are until a hand moves them): the dock sends up the same size first, a crate that has waited behind the
 * door before one that has just shipped, so with these two the small crates take turns, and each lap ships another
 * project, which comes back up the chute as itself two laps on. Their ids stay what they were (tests, saves).
 */
const SPARES = ([1, 2] as const).map((n) => ({ id: `crate-spare-${n}`, kind: 'crate' as const, size: 'S' as const, material: 'wood' as const, colour: BARE, label: '', station: 'line' as const, name: `name.project.${PROJECT_OF[`crate-spare-${n}`]}`, pose: pose([0, -4, 0]), shipped: true }));

// ───────────── S4: the Button's ladder, Revert, the UNDO lever (numbers from AT, plus Revert's own places) ─────────────

/**
 * Revert's places on the bench (x, z, heading; 0 faces the visitor) and its track between them. Home is
 * its hatch (`AT.revert`); `button` (A1 round 7) is BEHIND the console, facing the visitor over it, its arm
 * (front left, screen left) toward the guard parked open behind the cap (`REVERT_BEHIND_CONSOLE`); `park` is right of centre,
 * behind the phone and the platen, where the window's light falls across the bench. The track runs from the
 * hatch back to `REVERT_BEHIND`, along behind the lever and the console, to the Button spot (a corner of the
 * track: it cannot back up, so it stands where it can turn on the spot to leave), and on to the park. Its 2.05 x 1.54 body sweeps a circle of radius 1.28 as it turns on the spot:
 * at every corner of the track that circle clears the console, the lever, Fetch's runs, the platen and
 * Patch's runner (tests/unit/sim/revert-stand.test.ts).
 */
const REVERT_TURN = Math.hypot(AT.revert.half[0], AT.revert.half[2]);
const REVERT_BEHIND = AT.console.c[2] - AT.console.half[2] - REVERT_TURN - 0.04;
/**
 * Behind the console, facing the visitor over it (heading 0), on its track: as near as it can stand and still
 * turn on the spot to leave (0.04 more than its turning circle off the console's back), and across so that its
 * shoulder (0.64 left of its middle at the crew's scale) is in line with the Button's cap.
 */
const REVERT_BEHIND_CONSOLE = { x: AT.buttonCap[0] + 0.64, z: REVERT_BEHIND } as const;
const REVERT_PARK = { x: 1.9, z: -1.8 } as const;
export const REVERT = {
  home: { x: AT.revert.c[0], z: AT.revert.c[2], heading: 0 },
  button: { x: REVERT_BEHIND_CONSOLE.x, z: REVERT_BEHIND_CONSOLE.z, heading: 0 },
  park: { x: REVERT_PARK.x, z: REVERT_PARK.z, heading: -0.35 },
  path: [
    [AT.revert.c[0], AT.revert.c[2]],
    [AT.revert.c[0], REVERT_BEHIND],
    [-2.5, REVERT_BEHIND],
    [REVERT_BEHIND_CONSOLE.x, REVERT_BEHIND_CONSOLE.z], // the Button spot, a corner of the track
    [REVERT_PARK.x, REVERT_PARK.z],
  ] as readonly (readonly [number, number])[],
  /** S7: where the visitor is (Fetch's `outward`): it sweeps a part from its far side, facing them. */
  outward: [0, 1.6, 14] as Vec3,
} as const;

/** Revert's body: a loose part (kind robot), heavy; it starts down its hatch (its durable place is on the hatch). */
const S4_PARTS = [
  { id: 'revert', kind: 'robot' as const, size: 'L' as const, material: 'metal' as const, colour: 'steel', label: '', station: 'button' as const, name: 'name.revert', pose: pose(AT.revert.c), half: AT.revert.half, mass: 3 },
];

/** Rungs 2 to 4: every station a rung may misfire, at a point on it; "nearest" is from the Button's cap. */
const S4_LADDER = {
  stations: [
    { id: 'undo-lever', at: AT.undo.c },
    { id: 'striker', at: AT.striker.c },
    { id: 'cord', at: AT.jacks.storefront },
    { id: 'belt', at: AT.belt.c },
    { id: 'dock', at: AT.dock.c },
    { id: 'chute', at: AT.chute.p },
    { id: 'lamp', at: AT.jacks.lamp },
  ],
  lamp: 'lamp',
  lever: 'undo-lever',
  cord: 'cord',
  stackAt: AT.stack,
  stackRadius: 0.6,
  cover: 'button-cover',
  coverName: 'name.button.cover',
};

/**
 * R3: the bench always heals. A crate Fetch may not carry, not stirred for `stir` seconds, goes back into circulation
 * (a pile only after `pile`); Fetch dry for `after` seconds, Revert takes in the scene first.
 */
export const REVERT_HEAL = { after: 20, stir: 8, pile: 30 } as const;

const S4_UNITS = [
  undoLever({ id: 'undo-lever', station: 'button', name: 'name.undo-lever' }),
  revert({
    id: 'revert-crew',
    body: 'revert',
    station: 'button',
    name: 'name.revert',
    home: REVERT.home,
    button: REVERT.button,
    park: REVERT.park,
    path: REVERT.path,
    outward: REVERT.outward,
    stack: { at: AT.stack, radius: 0.6, max: 2 },
    start: 'below',
    parkAfter: 120,
    awayGap: 4,
    pad: { at: AT.pad, radius: 0.45 },
    heal: REVERT_HEAL,
  }),
];

// ───────────── Fetch's rounds (S5): positions from AT and the belt's mouth; the pace and the cap are its own ─────────────

/**
 * In play mode Fetch takes the top fresh crate off the stack and sets it on the belt's motor end (the
 * belt mouth's drop point), at most one every `every` seconds and never more than `cap` in play
 * (riding the belt or rolling through the dock, plus the one in its hands); only while the belt runs
 * forward. At the middle speed a crate takes about nine seconds from the drop to the door, so about two
 * ride at once: the striker plays a note every few seconds, and a stopped belt never floods.
 * The layout must keep the stack and the drop within Fetch's reach (`runner.reach`; without it P2's
 * `(FETCH_TUNING.reach + handForward) × CREW_SCALE`, 2.50) of where it stands for each (`runner.stands`;
 * without one, the nearest point of its path between its stops). `canRunLap(bench)` says which place fails.
 */
const FETCH_ROUNDS: FetchRounds = {
  stack: AT.stack,
  stackRadius: 0.55,
  pad: AT.pad,
  padRadius: 0.45,
  mouth: 'belt',
  inPlay: ['belt', 'dock'],
  cap: 3,
  every: 5,
  feedWhen: [
    { target: 'belt', field: BELT_FIELDS.running, is: true },
    { target: 'belt', field: BELT_FIELDS.direction, is: 'forward' },
  ],
}
// ───────────── the Patchlamp station (S3): the cord's four lines, the phone line, Patch, the platen, the storefront, the lamp ─────────────

/**
 * The station's numbers, read from `AT` where `AT` has them: the whole board's six measured jack mouths
 * (`AT.jacks`, A1), the stool's stops (`AT.stoolAt`) and a keyshelf point (`AT.keyshelf`) are there.
 */
export const PATCHLAMP = (() => {
  /** Left to right: two capped RESERVED jacks, then STOREFRONT, PLATEN, BELT, LAMP (the whole board's mouths, measured: `AT.jacks`). */
  const jacks = [
    { id: 'jack-reserved-1', name: 'name.jack.reserved', at: AT.jacks.reserved1 },
    { id: 'jack-reserved-2', name: 'name.jack.reserved', at: AT.jacks.reserved2 },
    { id: 'jack-storefront', name: 'name.jack.storefront', at: AT.jacks.storefront },
    { id: 'jack-platen', name: 'name.jack.platen', at: AT.jacks.platen },
    { id: 'jack-belt', name: 'name.jack.belt', at: AT.jacks.belt },
    { id: 'jack-lamp', name: 'name.jack.lamp', at: AT.jacks.lamp },
  ];
  /**
   * The platen's tray seat: the real piece's deck top (`AT.platen`'s top) over its turntable, 0.05 right
   * of and 0.1 behind the piece's origin (PLATEN.tray in view/kit/pieces/platen/dims.ts); the origin is
   * 0.145 in front of the base's middle (the base runs 1.15 behind it and 0.86 in front).
   */
  const seat: Vec3 = AT.platenSeat;
  const stoolTop: Vec3 = [AT.stool.c[0], AT.stool.c[1] + AT.stool.half[1], AT.stool.c[2]];
  /**
   * The lamp (S6, seam 7): clamped on the wall rail at `clamp` (view/bench.ts LAYOUT `lamp`; PROVISIONAL here until
   * the layout table carries it), its durable setting the AIM on the bench top. `REACH` is the lamp piece's
   * reachable region in its own (x, z) (view/kit/pieces/lamp/aim.ts `REACH`; tests/unit/sim/lamp-reach.test.ts
   * holds the two together), `homeAim` its opening aim in the same space.
   */
  const clamp: Vec3 = [AT.lamp[0], 0, AT.lamp[1]];
  const REACH: readonly (readonly [number, number])[] = [[-5.8, 0.6], [-5.8, 10], [11.0, 10], [11.9, 8.6], [11.9, 6.2], [8.6, 0.6]];
  const homeAim = [5.1, 4.9] as const;
  const lamp = {
    clamp,
    region: REACH,
    home: { aim: [clamp[0] + homeAim[0], 0, clamp[2] + homeAim[1]] as Vec3 },
    reach: { polygon: REACH.map(([x, z]) => [x + clamp[0], z + clamp[2]] as const) },
  };
  return {
    jacks,
    seat,
    platenMouth: { id: 'platen', machine: 'platen', station: 'patchlamp', c: [seat[0], seat[1] + 1.0, seat[2]], half: [0.55, 1.0, 0.55], drop: seat } as MouthSpec,
    lamp,
    patch: {
      seat: stoolTop,
      /** Toward the board (−X). */
      facing: -Math.PI / 2,
      foot: [AT.stool.c[0], 0, AT.stool.c[2] + AT.stool.half[2] + 0.45] as Vec3,
      /** Its seated body at the crew's 1.5× (about 1.6 tall on the stool). */
      body: { up: 0.75, radius: 0.6, head: 1.05, hands: 0.35 },
      /** A caught part is set on the keyshelf (a point on it measured from the piece, `AT.keyshelf`). */
      shelf: AT.keyshelf,
      lever: [AT.undo.c[0], AT.undo.c[1] + AT.undo.half[1], AT.undo.c[2]] as Vec3,
      visitor: [0.6, 2.4, 14] as Vec3,
      /** The stage's eye, as a way: up toward the visitor by the camera's pitch (33°: view/stage/camera.ts `CameraRig`). */
      sight: [0, Math.sin((33 * Math.PI) / 180), Math.cos((33 * Math.PI) / 180)] as Vec3,
      phone: AT.phone.c,
    },
  };
})();

const PATCHLAMP_MOUTHS: readonly MouthSpec[] = [PATCHLAMP.platenMouth];
/**
 * Patch's own body (`PartSpec.crewBody`; `sim/crew/patch-body.ts`; 2026-11-20): out of the world except from the hand
 * taking hold of Patch until its script takes over to recover. Kind `robot`: the parts view does not draw it, and
 * Fetch and Revert treat it as they treat each other's bodies. The last of the bench's parts.
 * - Its box is its bulk sat down (0.52 wide, 0.68 tall, 0.48 deep), its edges rounded as far as the engine allows
 *   (half its least half extent), so it tumbles and rolls over a little before it lies.
 * - Light: 0.08, between a small crate (0.06) and a middle one (0.14). It gets the whole of a throw (the world scales
 *   a throw down only from 0.15) and is a little weightier in the hand than a small crate (the carry's reference is
 *   0.06). What it hits moves by the contact: measured, a small crate standing on the bench goes on at a third to a
 *   half of the speed it was hit at (it is struck above its middle and tips as much as it slides).
 * - Felt, not rubber and not a brick: enough grip that it tumbles rather than slides (0.6; at 0.35 it lands and skids
 *   on its side like a box), next to no bounce of its own (0.05: what bounce it has is its tumbling over its own
 *   edges), a spin that it keeps for a second or so (1.2 a second; at 3.5 its first touchdown stopped it turning and
 *   it then toppled about where it lay for a second more), and no drag from the air (a throw up keeps its drift).
 *   Thrown across the open bench at 10 it comes down after a quarter turn, goes on at 6, and tumbles on the way it
 *   was going, each bounce lower, for a little over a second; at 14, the hardest throw, its first touchdown is a
 *   vault a unit high. Measured against a small crate thrown the same way (the means of four lanes;
 *   tests/scenario/patch-body.test.ts prints them): at 6, 10 and 14 units/s a crate goes 3.2, 6.5 and 10.2 units,
 *   Patch 4.2, 5.5 and 8.9.
 * - Material `paper` is for the things that read a part's material: what Fetch takes its weight to be when hit
 *   (its box as paper weighs 0.05) and the sound of a contact.
 */
export const PATCH_BODY: PartSpec = {
  id: 'patch-body',
  kind: 'robot',
  size: 'S',
  material: 'paper',
  colour: BARE,
  label: '',
  station: 'patchlamp',
  name: 'name.patch',
  pose: pose([0, -4, 0]),
  crewBody: true,
  half: [0.26, 0.34, 0.24],
  round: 0.12,
  mass: 0.08,
  feel: { friction: 0.6, restitution: 0.05, linearDamping: 0, angularDamping: 1.2 },
};

/** Patch's spec: held and thrown it is its body, `PATCH_BODY`. */
const PATCH_SPEC: PatchSpec = {
  id: 'patch',
  station: 'patchlamp',
  name: 'name.patch',
  line: 'line',
  ...PATCHLAMP.patch,
  jacks: Object.fromEntries(PATCHLAMP.jacks.map((j) => [j.id, j.at])),
  stations: { storefront: AT.storefront.c, platen: PATCHLAMP.seat, belt: [LINE.belt.from + 1, LINE.belt.top, LINE.belt.z], lamp: PATCHLAMP.lamp.home.aim },
  bench: { minX: AT.bench.minX + 0.4, maxX: AT.bench.maxX - 0.4, minZ: AT.bench.minZ + 0.4, maxZ: AT.bench.maxZ - 0.4 },
  edge: { minX: AT.bench.minX, maxX: AT.bench.maxX, maxZ: AT.bench.maxZ }, // R1: the open edges it can hang from
  // R2: the belt it may cross on its way back: clear of the motor's housing (left) and of the striker's arm (right)
  chute: { from: AT.chute.p, pad: AT.pad }, // R4: thrown off the bench, back up the chute by the pad
  belt: { id: 'belt', bed: 'belt-bed', safe: [AT.beltMotor.c[0] + AT.beltMotor.half[0] + 0.9, LINE.strikerX - 0.75] as const },
  runner: s6PatchRunner(), // S6
  bodyPart: PATCH_BODY.id,
};
const PATCHLAMP_UNITS = [
  line({
    id: 'line',
    station: 'patchlamp',
    name: 'name.line',
    cord: 'cord',
    lines: [
      { jack: 'jack-storefront', line: 'storefront', station: 'storefront' },
      { jack: 'jack-platen', line: 'platen', station: 'platen' },
      { jack: 'jack-belt', line: 'belt', station: 'belt' },
      { jack: 'jack-lamp', line: 'lamp', station: 'lamp' },
    ],
  }),
  patch(PATCH_SPEC),
  platen({ id: 'platen', station: 'patchlamp', name: 'name.platen', mouth: 'platen', seat: PATCHLAMP.seat }),
  storefront({ id: 'storefront', station: 'patchlamp', name: 'name.storefront' }),
  lamp({ id: 'lamp', station: 'top', name: 'name.lamp', levels: 5, startLevel: 3, home: PATCHLAMP.lamp.home, reach: PATCHLAMP.lamp.reach }),
];

// ───────────── S6: the simulation joined up (every number read from AT or from the blocks above) ─────────────

/**
 * The Button's ladder knows every station (§ B4 rungs 2 to 4): the Patchlamp station's, besides the line's
 * and the lever's above. The cord (the switchboard's handle) is already listed by S4; the lamp too.
 */
const S6_LADDER = {
  stations: [
    { id: 'line', at: AT.phone.c },
    { id: 'platen', at: PATCHLAMP.seat },
    { id: 'storefront', at: AT.storefront.c },
  ],
  line: 'line',
};

/**
 * Patch's stool on its runner (S6, seam 5). It rests at the runner's right end, where the stool stands in
 * `AT`; to work a live jack it stands at that jack's stop (`AT.stoolAt`, measured from the switchboard
 * piece). After `quiet` seconds of a quiet line it rolls back to rest. A function (hoisted) so Patch's
 * spec above can call it.
 */
function s6PatchRunner(): { rest: number; jacks: Record<string, number>; quiet: number } {
  const S = AT.stoolAt;
  return { rest: AT.stool.c[0], jacks: { 'jack-storefront': S.storefront[0], 'jack-platen': S.platen[0], 'jack-belt': S.belt[0], 'jack-lamp': S.lamp[0] }, quiet: 4 };
}

/**
 * Fetch's lane as the bench its wheel and body cover (S6): each run of tape, widened by its footprint (one box per
 * run, S5 round 2). Nothing is set down there by a machine (the belt's deflector skips a place inside it). S5 R1: to
 * the path's true ends: a stand at an end is taken exactly (the pad's, the tray's), so its body reaches there.
 */
function s6LaneBands(): { minX: number; maxX: number; minZ: number; maxZ: number }[] {
  const inset = 0;
  const r = Math.hypot(FETCH_HALF[0], FETCH_HALF[2]);
  const pts = AT.lane.points;
  return pts.slice(1).map((b, i) => {
    const a = pts[i] as readonly [number, number];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ia = i === 0 ? inset : 0;
    const ib = i === pts.length - 2 ? inset : 0;
    const s0: [number, number] = [a[0] + ((b[0] - a[0]) * ia) / len, a[1] + ((b[1] - a[1]) * ia) / len];
    const s1: [number, number] = [b[0] - ((b[0] - a[0]) * ib) / len, b[1] - ((b[1] - a[1]) * ib) / len];
    return { minX: Math.min(s0[0], s1[0]) - r, maxX: Math.max(s0[0], s1[0]) + r, minZ: Math.min(s0[1], s1[1]) - r, maxZ: Math.max(s0[1], s1[1]) + r };
  });
}

/**
 * The dock's collider (S6, seam 8): the bay BEHIND its door only. `AT.dock` is the piece's portal and bay
 * as one box, whose front reached 0.15 out in front of the door's plane, over the sill: a part waiting
 * there could be wedged against it, and could not be picked up. This is the same box cut at the door's
 * plane (`LINE.door.origin`, the way in `LINE.door.inward`): from there back to the box's back face.
 */
function s6DockBay(): StaticSpec {
  const yaw = (AT.dock.yaw ?? 0) * DEG;
  const n: [number, number] = [DOOR.inward[0], DOOR.inward[2]];
  const c = AT.dock.c;
  const tc = (c[0] - DOOR.origin[0]) * n[0] + (c[2] - DOOR.origin[2]) * n[1];
  // the box's depth along the way in (its own z, turned with it)
  const hz = AT.dock.half[2];
  const back = tc + hz;
  const front = Math.max(0, tc - hz);
  const mid = (front + back) / 2;
  const centre: Vec3 = [c[0] + n[0] * (mid - tc), c[1], c[2] + n[1] * (mid - tc)];
  return { id: 'dock', shape: { type: 'box', half: [AT.dock.half[0], AT.dock.half[1], (back - front) / 2] }, pose: pose(centre, yaw) };
}

/**
 * Attract mode's lap (S6, § B3), every place from the scene: the platen's tray (its mouth), the phone, the
 * PLATEN jack. The text: "Make it blue." (src/content/attract.json `text.make-it-blue`, verbatim from § B3)
 * and the word the parser reads for it (tests/scenario/attract.test.ts holds that they mean the same).
 */
function s6Attract(): { tray: string; phone: Vec3; jack: string; say: string; words: string } {
  return { tray: PATCHLAMP.platenMouth.id, phone: AT.phone.c, jack: 'jack-platen', say: 'attract.text.make-it-blue', words: 'blue' };
}

/**
 * THE bench: the scene every page and test gets by default. (Until 2026-11-21 its Patch could also be the scripted one,
 * whose flight was hand-written, as the scene `benchScript`; Taylor played the body Patch on 2026-11-20 and kept it.)
 */
export const bench: SceneDesc = {
  id: 'bench',
  gravity: -16,
  bench: { ...AT.bench, top: 0, ceiling: 8 },
  fallY: -1.2,
  statics: [
    { id: 'bench', shape: { type: 'box', half: [(AT.bench.maxX - AT.bench.minX) / 2, 0.5, (AT.bench.maxZ - AT.bench.minZ) / 2], radius: 0 }, pose: pose([(AT.bench.maxX + AT.bench.minX) / 2, -0.5, (AT.bench.maxZ + AT.bench.minZ) / 2]), friction: 0.75, restitution: 0.12 },
    box('back-wall', AT.backWall, { shape: { type: 'box', half: AT.backWall.half, radius: 0 } }),
    box('console', AT.console),
    box('board', AT.board),
    box('board-panel', AT.boardPanel),
    box('board-runner', AT.boardRunner),
    box('stool', AT.stool),
    box('phone', AT.phone),
    box('belt-bed', AT.belt, { friction: 0.9 }),
    box('belt-motor', AT.beltMotor),
    box('undo', AT.undo),
    box('platen', AT.platen),
    box('platen-plinth', AT.platenPlinth),
    box('platen-column', AT.platenColumn),
    box('platen-tank', AT.platenTank),
    box('storefront', AT.storefront),
    box('striker', AT.striker),
    s6DockBay(), // S6: the bay behind the door only (was box('dock', AT.dock), which reached out over the sill)
    ...AT.pallets.flatMap((p, i) => [box(`pallet-${'abcd'[i]}`, p), box(`pallet-${'abcd'[i]}-stack`, AT.stacks[i]!)]),
    box('mailbox', AT.mailbox),
    ...RAMP_STATICS,
    // P4 T2: the tool wall's board (a thrown thing meets its face)
    box('toolwall-board', TOOLWALL.board),
  ],
  parts: [
    { id: 'crate-1', kind: 'crate', size: 'L', material: 'wood', colour: BARE, label: '', station: 'line', name: `name.project.${PROJECT_OF['crate-1']}`, pose: pose([sx, e.L / 2, sz], 0.04) },
    { id: 'crate-2', kind: 'crate', size: 'M', material: 'wood', colour: BARE, label: '', station: 'line', name: `name.project.${PROJECT_OF['crate-2']}`, pose: pose([sx + 0.04, e.L + e.M / 2, sz - 0.03], -0.09) },
    { id: 'crate-3', kind: 'crate', size: 'S', material: 'wood', colour: BARE, label: '', station: 'line', name: `name.project.${PROJECT_OF['crate-3']}`, pose: pose(AT.firstCrate, 0.13) },
    { id: 'crate-4', kind: 'crate', size: 'S', material: 'wood', colour: BARE, label: '', station: 'button', name: `name.project.${PROJECT_OF['crate-4']}`, pose: pose(AT.looseCrate) },
    { id: 'fetch', kind: 'robot', size: 'M', material: 'metal', colour: 'tape-yellow', label: '', station: 'line', name: 'name.fetch', pose: pose([lanePoint(laneT(AT.fetchStartX))[0], FETCH_HALF[1], lanePoint(laneT(AT.fetchStartX))[1]]), half: FETCH_HALF, mass: 0.9 },
    ...SPARES,
    ...S4_PARTS,
    PATCH_BODY,
    // P4 D1: the ledger board, in its crate until the crate is opened
    { id: LEDGER.board, kind: 'tool', size: 'S', material: 'wood', colour: BARE, label: '', station: 'line', name: 'name.ledger.board', pose: pose([0, -4, 0]), half: LEDGER.half, mass: LEDGER.mass, stowedIn: LEDGER.crate },
    // P4 D2b: the paint dial, in its crate until the crate is opened
    { id: PAINT.dial, kind: 'tool', size: 'S', material: 'metal', colour: BARE, label: '', station: 'line', name: 'name.paint.dial', pose: pose([0, -4, 0]), half: PAINT.half, mass: PAINT.mass, stowedIn: PAINT.crate },
    // P4 D3: the report press, in its crate until the crate is opened; its envelope, in the press
    { id: PRESS.body, kind: 'tool', size: 'S', material: 'metal', colour: BARE, label: '', station: 'line', name: 'name.press.body', pose: pose([0, -4, 0]), half: PRESS.half, mass: PRESS.mass, stowedIn: PRESS.crate },
    { id: PRESS.envelope, kind: 'tool', size: 'S', material: 'paper', colour: BARE, label: '', station: 'line', name: 'name.press.envelope', pose: pose([0, -4, 0]), half: PRESS.envelopeHalf, mass: PRESS.envelopeMass, stowedIn: PRESS.body },
    // P4 T2: the eight tools, each on its peg
    ...TOOL_PARTS,
  ],
  fixtures: [],
  chute: { pose: pose(AT.chute.p), linvel: AT.chute.linvel, delay: 1.4 },
  button: {
    id: 'button',
    name: 'name.button',
    at: AT.buttonCap,
    stack: ['crate-1', 'crate-2'],
    flinch: ['lamp', 'belt'],
    shove: [0.6, 0, 1.6],
    cardBy: 'revert',
    ladder: { ...S4_LADDER, stations: [...S4_LADDER.stations, ...S6_LADDER.stations], line: S6_LADDER.line },
  },
  cord: {
    id: 'cord',
    name: 'name.cord',
    jacks: PATCHLAMP.jacks,
    start: 'jack-storefront',
  },
  runner: {
    id: 'fetch',
    lane: { points: AT.lane.points, endInset: AT.lane.endInset }, // (S5 R1: the left end 0.6 in: its laps turn where they did before the tape grew 0.3 for the pad)
    // A1 round 6: its telescoping arms' honest reach at carrying height (fetch-porter reach.ts), and where it stands for each thing
    reach: 1.1,
    stands: AT.stands,
    start: laneT(AT.fetchStartX),
    carrying: 'crate-4',
    fumbleAt: laneT(AT.fumbleX),
    fumbleHeading: AT.fumble.heading,
    offerHeading: AT.fumble.offerHeading,
    toss: { linvel: AT.fumble.linvel, angvel: AT.fumble.angvel },
    outward: [0, 1.6, 14],
    rounds: FETCH_ROUNDS,
    attract: s6Attract(), // S6
  },
  crewScale: CREW_SCALE,
  projects: PROJECT_CRATES,
  // P4 D3: the visit remembers what the press's holders show and the copies in its drawer
  keep: [
    { target: PRESS.body, field: 'report' },
    { target: PRESS.body, field: 'drawer' },
  ],
  mouths: [...MOUTHS, ...PATCHLAMP_MOUTHS, ...TOOL_MOUTHS],
  units: [
    belt({ id: 'belt', station: 'line', name: 'name.belt', mouth: 'belt', ...LINE.belt, dial: { id: 'belt-dial', name: 'name.belt.dial' }, lever: { id: 'belt-lever', name: 'name.belt.lever' }, keepClear: s6LaneBands() }),
    striker({ id: 'striker', station: 'line', name: 'name.striker', x: LINE.strikerX, mouth: 'belt' }),
    dock({ id: 'dock', station: 'line', name: 'name.dock', mouth: 'dock', ramp: LINE.ramp, stack: AT.stack, feed: beltFeed, stackMax: 2, pad: { at: AT.pad, radius: 0.45, from: AT.chute.p, apex: AT.padApex, near: AT.padNear, home: AT.home }, homeward: [PRESS.envelope] }),
    chute({ id: 'chute', station: 'line', name: 'name.chute' }),
    ...S4_UNITS,
    ...PATCHLAMP_UNITS,
    // P4 S5: the project crates' latches, cards and things (last: their latches and plates follow every other control in the list)
    crates({ id: 'crates', station: 'line' }),
    // P4 D1: the ledger board's crank and plunger (after the crates: its board is on its tray before it deals itself)
    ledger({ id: LEDGER.unit, station: 'line', board: LEDGER.board, crate: LEDGER.crate, crank: { id: LEDGER.crank, name: 'name.ledger.crank' }, plunger: { id: LEDGER.plunger, name: 'name.ledger.plunger' }, look: { card: `${LEDGER.crate}-card`, board: LEDGER.look } }),
    // P4 D2b: the paint dial's knob (after the crates, as the ledger's controls)
    paintDial({ id: PAINT.unit, station: 'line', dial: PAINT.dial, crate: PAINT.crate, knob: { id: PAINT.knob, name: 'name.paint.knob' } }),
    // P4 D3: the report press's lever, after the dock (it hears the dock's shipments on the bus) and the crates
    press({
      id: PRESS.unit,
      station: 'line',
      body: PRESS.body,
      envelope: PRESS.envelope,
      lever: { id: PRESS.lever, name: 'name.press.lever' },
      bed: PRESS.bed,
      belt: { mouth: 'belt', from: L.from, to: L.to, top: L.top, z: L.z, feed: AT.beltFeed, clear: DEFLECTOR.clear },
      homeAfter: DOCK_TUNING.returnAfter.tool,
      look: PRESS.look,
      card: `${PRESS.crate}-card`,
      ignore: ['bench', 'belt-bed'],
    }),
    // P4 T2: the tool wall: holds its tools on their pegs and takes them back; the pinned sheet
    toolwall({
      id: TOOLWALL.unit,
      station: 'tools',
      name: 'name.toolwall.wall',
      tools: Object.entries(TOOLWALL.tools).map(([kind, t]) => ({ id: toolId(kind), peg: pegId(kind), hang: { p: t.at, q: [...t.q] as [number, number, number, number] }, look: toolLook(kind) })),
      sheet: { id: TOOLWALL.sheet, name: 'name.toolwall.sheet' },
      look: TOOLWALL.look,
      sight: PATCHLAMP.patch.sight,
    }),
  ],
};

/**
 * P4 S5, development only (`?standin=1` on the bench's dev pages): the bench with a stand-in thing in one crate, the
 * kit's test block in t-components' crate (crate-3), to prove a crate's tray: shut, the block is not in the world; open,
 * it sits on the tray; taken off it is a loose part; set back on the open crate it is stowed. The shipped bench has every
 * tray empty. The worked example of sim/machines/crates.ts's three lines.
 */
export const STAND_IN_THING = 'standin-block';
export function withStandIn(scene: SceneDesc = bench): SceneDesc {
  const thing: PartSpec = { id: STAND_IN_THING, kind: 'tool', size: 'S', material: 'wood', colour: BARE, label: '', station: 'line', name: 'name.standin', pose: pose([0, -4, 0]), half: [0.09, 0.09, 0.09], stowedIn: 'crate-3' };
  return {
    ...scene,
    id: `${scene.id}+standin`,
    parts: [...scene.parts.filter((p) => p.id !== PAINT.dial), thing], // (D2b: the stand-in takes the paint dial's place)
    projects: (scene.projects ?? []).map((c) => (c.crate === 'crate-3' ? { ...c, holds: STAND_IN_THING } : c)),
  };
}

/**
 * P4 S5, development only (`?crates=row` on the bench's dev pages): the six project crates at rest in a row across the
 * open bench at the front left, between Revert's hatch and Fetch's tape, none in Fetch's hands or behind the dock door, so all six can be seen (and opened) at
 * once in the bench's own light: the pictures for the owner. Never the shipped bench.
 */
export function withProjectRow(scene: SceneDesc = bench): SceneDesc {
  const row: Record<string, number> = { 'crate-1': -6.2, 'crate-2': -5.25, 'crate-3': -4.5, 'crate-4': -3.85, 'crate-spare-1': -3.2, 'crate-spare-2': -2.55 };
  return {
    ...scene,
    id: `${scene.id}+row`,
    parts: scene.parts.map((p) => {
      const x = row[p.id];
      if (x === undefined) return p;
      const { shipped: _shipped, ...rest } = p;
      return { ...rest, pose: pose([x, CRATE_EDGE[p.size] / 2, 1.65]) };
    }),
    runner: { ...scene.runner, carrying: null },
  };
}

/**
 * P4 S6, a prototype behind one switch (`?open=stand`; the shipped bench has none: `OPENING_STAND_ON`): the opening stand
 * (sim/machines/opening-stand.ts). A low steel table with one mouth; a project crate the visitor sets down on it opens
 * there and nowhere else. Three places to show the owner (`?stand=a|b|c`): `a` on the bench in front of the console, left of the
 * Button, where t-components' crate starts (his suggestion: the console's own top there is the counter's; the crate starts
 * beside the stand instead); `b` on the RESERVED: INSPECTION bay at the back left (his word, already there); `c` on the open bench
 * between the platen and the dock, where the machines are, clear of Fetch's lane and its drops (in front of the UNDO
 * lever, Fetch's crates knocked it; its lane's last run crosses the bench between the console and the platen). `things`: `fixed` (a crate's thing stays on its tray)
 * or `loose` (as before).
 */
export const OPENING_STAND_ON = false;
export type StandPlace = 'a' | 'b' | 'c' | 'd';
export const OPENING_STAND = {
  unit: 'opening-stand',
  mouth: 'opening-stand',
  /** The table's top (half extents x, z); it fits the large crate (0.8 x 0.74) with room. */
  half: [0.52, 0.48] as const,
  places: {
    a: { at: [-1.2, 0, 1.78] as Vec3, h: 0.16, aside: [-1, 0] as const },
    b: { at: [-6.55, 0, -3.95] as Vec3, h: 0.22, aside: [1, 0] as const },
    c: { at: [4.15, 0, 2.0] as Vec3, h: 0.22, aside: [-1, 0] as const },
    // (round two) d: whole in a phone's opening view and a laptop's: on the bench in front of the console, right of a
    // (whose middle is at x = 33 px of a phone's 390), its right edge a hand's breadth from the phone; Fetch's lane
    // passes in front (z 2.78) and its last run is at x 1.16; the chute's pad is far left (-3.9). (Behind the striker,
    // right of the crates Fetch stacks, the striker's crank hid it from the front: tried, pictures in shots/s5.)
    d: { at: [-0.56, 0, 1.8] as Vec3, h: 0.16, aside: [-1, 0] as const },
  } satisfies Record<StandPlace, { at: Vec3; h: number; aside: readonly [number, number] }>,
} as const;

export function withOpeningStand(scene: SceneDesc = bench, place: StandPlace = 'c', things: 'fixed' | 'loose' = 'fixed'): SceneDesc {
  const S = OPENING_STAND;
  const pl = S.places[place];
  const top = pl.at[1] + pl.h;
  const body: StaticSpec = { id: S.unit, shape: { type: 'box', half: [S.half[0], pl.h / 2, S.half[1]] }, pose: pose([pl.at[0], pl.at[1] + pl.h / 2, pl.at[2]]) };
  // the mouth: where a crate's middle lies when it rests on the top (the small crate's 0.225 up to the large one's 0.4)
  // (and as high again: a crate set down on top of the open one rests in it too, and the stand hands the first one off)
  const mouth: MouthSpec = { id: S.mouth, machine: S.unit, station: 'line', c: [pl.at[0], top + 0.6, pl.at[2]], half: [S.half[0], 0.55, S.half[1]], drop: [pl.at[0], top, pl.at[2]] };
  return {
    ...scene,
    id: `${scene.id}+stand-${place}${things === 'loose' ? '-loose' : ''}`,
    statics: [...scene.statics, body],
    mouths: [...(scene.mouths ?? []), mouth],
    units: [...(scene.units ?? []), openingStand({ id: S.unit, station: 'line', name: 'name.stand', mouth: S.mouth, aside: pl.aside, floor: pl.at[1] })],
    openingStand: { unit: S.unit, mouth: S.mouth, things },
    // (at a, the stand takes t-components' crate's starting place: the crate starts beside it, in front of the UNDO lever)
    // (and at d, whose hand-off spot is there: the crate starts in front of the UNDO lever)
    ...(place === 'a' || place === 'd' ? { parts: scene.parts.map((p) => (p.id === 'crate-3' ? { ...p, pose: pose([-2.25, CRATE_EDGE.S / 2, 1.6], 0.13) } : p)) } : {}),
  };
}
