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
import type { FetchRounds, MouthSpec, SceneDesc, StaticSpec } from '../scene.ts';
import { CRATE_EDGE, defaultHalfExtents } from '../parts.ts';
import { qyaw } from '../math.ts';
import { belt, BELT_FIELDS } from '../machines/belt.ts';
import { striker } from '../machines/striker.ts';
import { dock } from '../machines/dock.ts';
import { chute } from '../machines/chute.ts';
import { rampAt, rampDoor, rampLength } from '../ramp.ts';
import type { RampSpec } from '../ramp.ts';

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
  undo: { c: [-3.7, 0.75, -1.9], half: [0.35, 0.75, 0.35] } as Box,
  /** The phone on its easel. */
  phone: { c: [2.2, 0.36, -1.35], half: [0.21, 0.36, 0.15] } as Box,
  /** The platen (stand-in): the tray under the nozzle, its tank behind. */
  platen: { c: [4.5, 0.7, -2.0], half: [0.8, 0.7, 0.7] } as Box,
  /** The storefront (stand-in): a shop front facing the visitor. */
  storefront: { c: [7.05, 1.05, -3.6], half: [1.15, 1.05, 0.45] } as Box,
  /** Shipped (P4, clay): each pallet with its stack as one box (the back row up to 1.2 high, the front row 0.6), and the mailbox on its post. */
  pallets: [
    { c: [6.0, 0.6, -1.05], half: [0.55, 0.6, 0.5] },
    { c: [7.3, 0.6, -1.05], half: [0.55, 0.6, 0.5] },
    { c: [6.9, 0.3, 0.65], half: [0.55, 0.3, 0.5] },
    { c: [8.1, 0.3, 0.65], half: [0.55, 0.3, 0.5] },
  ] as readonly Box[],
  mailbox: { c: [8.3, 0.65, -1.25], half: [0.21, 0.65, 0.16] } as Box,
  /** Revert parked on its hatch (clay; the crew's 1.5×: 1.74 wide, 1.32 deep, 1.08 tall). */
  revert: { c: [-3.6, 0.54, 0.35], half: [0.87, 0.54, 0.66] } as Box,

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
  dock: { c: [5.25, 0.8, 3.65], half: [0.85, 0.8, 0.6], yaw: -50 } as Box,
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
 * door as near the dock's spot in `AT` as a bend no tighter than 0.75 allows. The door then stands at
 * `LINE.door.origin`: that is where the dock piece goes (placed with no yaw, `turn` 40).
 */
const RAMP_SHAPE = { turn: 40, lead: 0.12, lipZ: 0.24, sillY: 0.1, gap: 0.12, width: 0.92 } as const;
const RAMP: RampSpec = (() => {
  const t = RAMP_SHAPE.turn * DEG;
  const start: Vec3 = [beltEnd + RAMP_SHAPE.gap, beltTop, AT.belt.c[2]];
  const d = RAMP_SHAPE.lead + RAMP_SHAPE.lipZ;
  const radius = Math.max(0.75, Math.min(2.2, (start[2] - AT.dock.c[2] - d * Math.sin(t)) / (1 - Math.cos(t))));
  const approach = Math.max(0, AT.dock.c[0] - start[0] - radius * Math.sin(t) - d * Math.cos(t));
  return { start, approach, radius, turn: RAMP_SHAPE.turn, lead: RAMP_SHAPE.lead, lipZ: RAMP_SHAPE.lipZ, topY: beltTop, sillY: RAMP_SHAPE.sillY, width: RAMP_SHAPE.width };
})();
const DOOR = rampDoor(RAMP);

/** Where the line's machines stand and what they reach, all read from `AT`. */
export const LINE = {
  belt: { from: AT.belt.c[0] - AT.belt.half[0], to: beltEnd, top: beltTop, z: AT.belt.c[2], halfWidth: AT.belt.half[2] },
  /** The striker's arm crosses the belt at its post's x. */
  strikerX: AT.striker.c[0],
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
  { id: 'belt', machine: 'belt', station: 'line', c: [(L.from + L.to) / 2, L.top + 1.5, L.z], half: [(L.to - L.from) / 2, 1.5, L.halfWidth], drop: [L.from + 0.8, L.top, L.z] },
  // the dock: its ramp from the belt's end to the sill (and the bench either side of it)
  { id: 'dock', machine: 'dock', station: 'line', c: [(L.to + rampBox.maxX) / 2, 1.3, (rampBox.minZ + rampBox.maxZ) / 2], half: [(rampBox.maxX - L.to) / 2, 1.3, (rampBox.maxZ - rampBox.minZ) / 2], drop: rampAt(RAMP, 0.2).p },
];

/** Spare crates behind the dock door: one of each size, set on the stack as plain crates ship (§ D 7). */
const SPARES = (['S', 'M', 'L'] as const).map((size, i) => ({ id: `crate-spare-${i + 1}`, kind: 'crate' as const, size, material: 'wood' as const, colour: BARE, label: '', station: 'line' as const, name: 'name.crate', pose: pose([0, -4, 0]), shipped: true }));

// ───────────── Fetch's rounds (S5): positions from AT and the belt's mouth; the pace and the cap are its own ─────────────

/**
 * In play mode Fetch takes the top fresh crate off the stack and sets it on the belt's motor end (the
 * belt mouth's drop point), at most one every `every` seconds and never more than `cap` in play
 * (riding the belt or rolling through the dock, plus the one in its hands); only while the belt runs
 * forward. At the middle speed a crate takes about nine seconds from the drop to the door, so about two
 * ride at once: the striker plays a note every few seconds, and a stopped belt never floods.
 * The layout must keep the stack within Fetch's reach of its tape (`FETCH_TUNING.reach + handForward`,
 * × `CREW_SCALE`: 2.50 from the nearest point of the lane between its stops) and the drop likewise.
 */
const FETCH_ROUNDS: FetchRounds = {
  stack: AT.stack,
  stackRadius: 0.55,
  mouth: 'belt',
  inPlay: ['belt', 'dock'],
  cap: 3,
  every: 5,
  feedWhen: [
    { target: 'belt', field: BELT_FIELDS.running, is: true },
    { target: 'belt', field: BELT_FIELDS.direction, is: 'forward' },
  ],
};

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
    box('storefront', AT.storefront),
    box('striker', AT.striker),
    box('dock', AT.dock),
    ...AT.pallets.map((p, i) => box(`pallet-${'abcd'[i]}`, p)),
    box('mailbox', AT.mailbox),
    box('revert', AT.revert),
    ...RAMP_STATICS,
  ],
  parts: [
    { id: 'crate-1', kind: 'crate', size: 'L', material: 'wood', colour: BARE, label: '', station: 'line', name: 'name.crate', pose: pose([sx, e.L / 2, sz], 0.04) },
    { id: 'crate-2', kind: 'crate', size: 'M', material: 'wood', colour: BARE, label: '', station: 'line', name: 'name.crate', pose: pose([sx + 0.04, e.L + e.M / 2, sz - 0.03], -0.09) },
    { id: 'crate-3', kind: 'crate', size: 'S', material: 'wood', colour: BARE, label: '', station: 'line', name: 'name.crate', pose: pose([sx - 0.03, e.L + e.M + e.S / 2, sz + 0.02], 0.13) },
    { id: 'crate-4', kind: 'crate', size: 'S', material: 'wood', colour: BARE, label: '', station: 'button', name: 'name.crate', pose: pose(AT.looseCrate) },
    { id: 'fetch', kind: 'robot', size: 'M', material: 'metal', colour: 'tape-yellow', label: '', station: 'line', name: 'name.fetch', pose: pose([fx, FETCH_HALF[1], fz]), half: FETCH_HALF, mass: 0.9 },
    ...SPARES,
  ],
  fixtures: [
    { id: 'lamp', station: 'top', name: 'name.lamp', affordances: [] },
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
    rounds: FETCH_ROUNDS,
  },
  crewScale: CREW_SCALE,
  mouths: MOUTHS,
  units: [
    belt({ id: 'belt', station: 'line', name: 'name.belt', mouth: 'belt', ...LINE.belt, dial: { id: 'belt-dial', name: 'name.belt.dial' }, lever: { id: 'belt-lever', name: 'name.belt.lever' } }),
    striker({ id: 'striker', station: 'line', name: 'name.striker', x: LINE.strikerX, mouth: 'belt' }),
    dock({ id: 'dock', station: 'line', name: 'name.dock', mouth: 'dock', ramp: LINE.ramp, stack: AT.stack }),
    chute({ id: 'chute', station: 'line', name: 'name.chute' }),
  ],
};
