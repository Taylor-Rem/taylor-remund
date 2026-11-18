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
import type { SceneDesc, StaticSpec } from '../scene.ts';
import { CRATE_EDGE } from '../parts.ts';
import { qyaw } from '../math.ts';

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
  backWall: { c: [0, 3, -5.15], half: [10.5, 3, 0.15] } as Box,

  // ── the back row: board, stool (the tool wall, lamp, sign and window hang on the wall: no bodies) ──
  /** The switchboard against the wall (its keyshelf, frame and crest), and its two live jacks (measured from the piece). */
  board: { c: [0.55, 1.554, -4.335], half: [2.3, 1.554, 0.655] } as Box,
  jacks: { storefront: [-0.45, 1.18, -4.264] as Vec3, lamp: [1.59, 1.18, -4.264] as Vec3 },
  /** Patch's stool at the board's right end. */
  stool: { c: [3.05, 0.577, -3.35], half: [0.324, 0.578, 0.322] } as Box,

  // ── the middle row ──
  /** The UNDO lever's base (stand-in). */
  undo: { c: [-1.75, 0.75, -1.9], half: [0.35, 0.75, 0.35] } as Box,
  /** The phone on its easel. */
  phone: { c: [2.2, 0.36, -1.35], half: [0.21, 0.36, 0.15] } as Box,
  /** The platen (real piece, origin (4.4, -0.9)): its base and deck, its arm's column, its tank. */
  platen: { c: [4.4, 0.31, -1.045], half: [1.2, 0.31, 1.005] } as Box,
  platenColumn: { c: [3.42, 1.5, -1.0], half: [0.15, 1.5, 0.15] } as Box,
  platenTank: { c: [5.22, 0.75, -1.75], half: [0.26, 0.75, 0.26] } as Box,
  /** The storefront (real piece, origin (7.6, -3.6)): its bounds, jack box and conduit included. */
  storefront: { c: [7.07, 1.415, -3.535], half: [1.74, 1.415, 0.535] } as Box,
  /** Shipped (P4, clay): four 1.0 × 1.0 pallets, 0.15 high. */
  pallets: [
    { c: [7.4, 0.075, -1.25], half: [0.5, 0.075, 0.5] },
    { c: [8.45, 0.075, -1.25], half: [0.5, 0.075, 0.5] },
    { c: [7.48, 0.075, 0.3], half: [0.5, 0.075, 0.5] },
    { c: [8.5, 0.075, 0.3], half: [0.5, 0.075, 0.5] },
  ] as readonly Box[],
  /** Their stacks of crates (fronts flush with the pallets' fronts): the back row 1.2 high, the front row 0.6. */
  stacks: [
    { c: [7.3975, 0.675, -1.05], half: [0.4975, 0.525, 0.3] },
    { c: [8.4525, 0.675, -1.05], half: [0.4975, 0.525, 0.3] },
    { c: [7.48, 0.375, 0.575], half: [0.475, 0.225, 0.225] },
    { c: [8.5, 0.375, 0.575], half: [0.475, 0.225, 0.225] },
  ] as readonly Box[],
  /** The mailbox on its post, the résumé clipboard on it (P4, clay): front right. */
  mailbox: { c: [7.7, 0.65, 3.75], half: [0.21, 0.65, 0.16] } as Box,
  /** Revert risen on its lift (real piece at the crew's 1.5, origin (-3.2, 0.35)). Its hatch's doors stand open either side, low. */
  revert: { c: [-3.182, 0.672, 0.422], half: [1.026, 0.672, 0.768] } as Box,

  // ── the Button's row ──
  /** The Button's console (the body only). Deck top at y 1.04. */
  console: { c: [-0.05, 0.52, 0.55], half: [1.05, 0.52, 0.76] } as Box,
  /** The Button's cap on the console deck. */
  buttonCap: [0.27, 1.25, 0.35] as Vec3,

  // ── the front: the lane, the belt and its ends ──
  /** The crate stack: ground point (x, z) of its bottom crate; L, M, S upward, each a little off true. */
  stack: [-8.5, -1.2] as const,
  /** Fetch's lane of yellow tape (x, z): in front of the console, behind the belt. */
  lane: { a: [-5.2, 2.2] as const, b: [3.0, 2.2] as const },
  /** Where along the lane Fetch starts (0 at a), with the loose crate in its hands. */
  fetchStart: 0.48,
  /** The loose crate's own starting point (its durable location until it first rests elsewhere). */
  looseCrate: [-1.26, 0.225, 2.85] as Vec3,
  /** Where on the lane Fetch fumbles (x): right of the console. */
  fumbleX: 2.25,
  fumble: { heading: -Math.PI / 2, linvel: [-1.0, 2.0, 0] as Vec3, angvel: [0, 0, 5] as Vec3, offerHeading: 0 },
  /** The belt's bed (carrying surface at y 0.5) and its motor housing at the left end. Belt length 10. */
  belt: { c: [-0.9, 0.25, 3.9], half: [5.0, 0.25, 0.52] } as Box,
  beltMotor: { c: [-6.46, 0.63, 4.0], half: [0.56, 0.63, 0.79] } as Box,
  /** The striker (stand-in): its post on the belt's far rail; the arm passes clear over the belt. */
  striker: { c: [3.7, 0.85, 3.22], half: [0.3, 0.85, 0.22] } as Box,
  /** The dock (stand-in): its portal turned toward the camera. */
  /**
   * The dock (real piece, origin the door's middle at (5.42, 3.45); its bay turned 40° toward the camera,
   * built in): its portal (2.08 tall; the lamp's cage stands above it) and bay as one box in the door's frame (yaw -50). The ramp from the belt is low and not a body here.
   */
  dock: { c: [5.707, 1.04, 3.209], half: [0.94, 1.04, 0.525], yaw: -50 } as Box,
  /** The return chute's mouth, front left, and how parts come out of it. */
  chute: { p: [-8.05, 0.45, 3.2] as Vec3, linvel: [2.4, 0.6, -0.9] as Vec3 },
} as const;

const e = CRATE_EDGE;
const [sx, sz] = AT.stack;
const pose = (p: Vec3, yaw = 0): Pose => ({ p, q: qyaw(yaw) });
const box = (id: string, b: Box, extra: Partial<StaticSpec> = {}): StaticSpec => ({ id, shape: { type: 'box', half: b.half }, pose: pose(b.c, (b.yaw ?? 0) * DEG), ...extra });
const laneT = (x: number): number => (x - AT.lane.a[0]) / (AT.lane.b[0] - AT.lane.a[0]);
const lanePoint = (t: number): [number, number] => [AT.lane.a[0] + (AT.lane.b[0] - AT.lane.a[0]) * t, AT.lane.a[1] + (AT.lane.b[1] - AT.lane.a[1]) * t];
const [fx, fz] = lanePoint(AT.fetchStart);

/** Unpainted wood: a fresh crate's colour. */
export const BARE = 'bare';

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
    box('stool', AT.stool),
    box('phone', AT.phone),
    box('belt-bed', AT.belt, { friction: 0.9 }),
    box('belt-motor', AT.beltMotor),
    box('undo', AT.undo),
    box('platen', AT.platen),
    box('platen-column', AT.platenColumn),
    box('platen-tank', AT.platenTank),
    box('storefront', AT.storefront),
    box('striker', AT.striker),
    box('dock', AT.dock),
    ...AT.pallets.flatMap((p, i) => [box(`pallet-${'abcd'[i]}`, p), box(`pallet-${'abcd'[i]}-stack`, AT.stacks[i]!)]),
    box('mailbox', AT.mailbox),
    box('revert', AT.revert),
  ],
  parts: [
    { id: 'crate-1', kind: 'crate', size: 'L', material: 'wood', colour: BARE, label: '', station: 'line', name: 'name.crate', pose: pose([sx, e.L / 2, sz], 0.04) },
    { id: 'crate-2', kind: 'crate', size: 'M', material: 'wood', colour: BARE, label: '', station: 'line', name: 'name.crate', pose: pose([sx + 0.04, e.L + e.M / 2, sz - 0.03], -0.09) },
    { id: 'crate-3', kind: 'crate', size: 'S', material: 'wood', colour: BARE, label: '', station: 'line', name: 'name.crate', pose: pose([sx - 0.03, e.L + e.M + e.S / 2, sz + 0.02], 0.13) },
    { id: 'crate-4', kind: 'crate', size: 'S', material: 'wood', colour: BARE, label: '', station: 'button', name: 'name.crate', pose: pose(AT.looseCrate) },
    { id: 'fetch', kind: 'robot', size: 'M', material: 'metal', colour: 'tape-yellow', label: '', station: 'line', name: 'name.fetch', pose: pose([fx, 0.5, fz]), mass: 0.9 },
  ],
  fixtures: [
    { id: 'lamp', station: 'top', name: 'name.lamp', affordances: [] },
    { id: 'belt', station: 'line', name: 'name.belt', affordances: [] },
  ],
  chute: { pose: pose(AT.chute.p), linvel: AT.chute.linvel, delay: 1.4 },
  button: {
    id: 'button',
    name: 'name.button',
    at: AT.buttonCap,
    stack: ['crate-1', 'crate-2', 'crate-3'],
    flinch: ['lamp', 'belt'],
    shove: [0.6, 0, 1.6],
    cardBy: 'revert',
  },
  cord: {
    id: 'cord',
    name: 'name.cord',
    jacks: [
      { id: 'jack-storefront', name: 'name.jack.storefront', at: AT.jacks.storefront },
      { id: 'jack-lamp', name: 'name.jack.lamp', at: AT.jacks.lamp },
    ],
    start: 'jack-storefront',
  },
  runner: {
    id: 'fetch',
    lane: { a: AT.lane.a, b: AT.lane.b },
    start: AT.fetchStart,
    carrying: 'crate-4',
    fumbleAt: laneT(AT.fumbleX),
    fumbleHeading: AT.fumble.heading,
    offerHeading: AT.fumble.offerHeading,
    toss: { linvel: AT.fumble.linvel, angvel: AT.fumble.angvel },
    outward: [0, 1.6, 14],
  },
};
