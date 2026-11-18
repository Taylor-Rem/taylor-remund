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
import { line } from '../machines/line.ts';
import { platen } from '../machines/platen.ts';
import { storefront } from '../machines/storefront.ts';
import { lamp } from '../machines/lamp.ts';
import { patch } from '../crew/patch.ts';

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
  /** Patch's stool, lowered (seat 0.62 over the runner's top 0.052), at rest at the runner's right end. */
  stool: { c: [3.02, 0.369, -3.46], half: [0.316, 0.317, 0.32] } as Box,

  // ── the middle row ──
  /** The UNDO lever (real piece, origin (-2.2, 0.3)): its console, quadrant and lever at home, as one box. */
  undo: { c: [-2.2, 0.983, 0.352], half: [0.79, 0.983, 0.462] } as Box,
  /** The phone on its easel. */
  phone: { c: [2.4, 0.36, 0.9], half: [0.21, 0.36, 0.15] } as Box,
  /** The platen (real piece, origin (4.6, 0.2)): its base and deck, its arm's column, its tank. */
  platen: { c: [4.6, 0.31, 0.055], half: [1.2, 0.31, 1.005] } as Box,
  platenColumn: { c: [3.62, 1.5, 0.1], half: [0.15, 1.5, 0.15] } as Box,
  platenTank: { c: [5.42, 0.75, -0.65], half: [0.26, 0.75, 0.26] } as Box,
  /** The storefront (real piece, origin (7.6, -3.6)): its bounds, jack box and conduit included. */
  storefront: { c: [7.07, 1.415, -3.535], half: [1.74, 1.415, 0.535] } as Box,
  /** Shipped (P4, clay): four 1.0 × 1.0 pallets, 0.15 high. */
  pallets: [
    { c: [7.4, 0.075, -1.85], half: [0.5, 0.075, 0.5] },
    { c: [8.45, 0.075, -1.85], half: [0.5, 0.075, 0.5] },
    { c: [7.48, 0.075, -0.3], half: [0.5, 0.075, 0.5] },
    { c: [8.5, 0.075, -0.3], half: [0.5, 0.075, 0.5] },
  ] as readonly Box[],
  /** Their stacks of crates (fronts flush with the pallets' fronts): the back row 1.2 high, the front row 0.6. */
  stacks: [
    { c: [7.3975, 0.675, -1.65], half: [0.4975, 0.525, 0.3] },
    { c: [8.4525, 0.675, -1.65], half: [0.4975, 0.525, 0.3] },
    { c: [7.48, 0.375, -0.025], half: [0.475, 0.225, 0.225] },
    { c: [8.5, 0.375, -0.025], half: [0.475, 0.225, 0.225] },
  ] as readonly Box[],
  /** The mailbox on its post, the résumé clipboard on it (P4, clay): front right. */
  mailbox: { c: [7.7, 0.65, 3.75], half: [0.21, 0.65, 0.16] } as Box,
  /** Revert risen on its lift (real piece at the crew's 1.5, origin (-4.6, 0.3)). Its hatch's doors stand open either side, low. */
  revert: { c: [-4.582, 0.672, 0.372], half: [1.026, 0.672, 0.768] } as Box,

  // ── the Button's row ──
  /** The Button's console (the body only). Deck top at y 1.04. */
  console: { c: [-0.05, 0.52, 0.5], half: [1.05, 0.52, 0.76] } as Box,
  /** The Button's cap on the console deck. */
  buttonCap: [0.27, 1.25, 0.3] as Vec3,

  // ── the front: the lane, the belt and its ends ──
  /** The crate stack: ground point (x, z) of its bottom crate; L, M, S upward, each a little off true. 2.15 from the lane's left stop (Fetch's rounds: 1.7 to 2.3), the chute's landing beside it. */
  stack: [-6.7, 1.15] as const,
  /** Fetch's lane of yellow tape (x, z): in front of the console, behind the striker's post and the belt. Its stops (0.45 in) reach the stack, the belt's drop, the phone and the platen's tray. */
  lane: { a: [-5.2, 2.05] as const, b: [4.3, 2.05] as const },
  /** Where along the lane Fetch starts (0 at a), with the loose crate in its hands. */
  fetchStart: 0.48,
  /** The loose crate's own starting point (its durable location until it first rests elsewhere). */
  looseCrate: [-1.26, 0.225, 2.7] as Vec3,
  /** Where on the lane Fetch fumbles (x): right of the console. */
  fumbleX: 1.6,
  fumble: { heading: -Math.PI / 2, linvel: [-1.0, 2.0, 0] as Vec3, angvel: [0, 0, 5] as Vec3, offerHeading: 0 },
  /** The belt's bed (carrying surface at y 0.5) and its control housing at the left end (the `line` belt: dial, lever, lamp; x -7.34..-5.96). Belt length 10. A part run off the back by the deflector rests at its `off.back`, (-5.4, 2.68): beside the stack, at the lane's left end. */
  belt: { c: [-0.9, 0.25, 4.0], half: [5.0, 0.25, 0.52] } as Box,
  beltMotor: { c: [-6.65, 0.63, 4.1], half: [0.69, 0.63, 0.79] } as Box,
  /** The striker (real piece, origin (2.675, 3.072)): x is its HAMMER's (LINE.strikerX reads it), so the box is centred there and wide enough to hold the post (0.375 right of it); 1.6 high, under the arm, which parts on the belt pass clear beneath. */
  striker: { c: [2.3, 0.8, 3.072], half: [0.55, 0.8, 0.13] } as Box,
  /**
   * The dock (real piece, origin the door's middle at (5.92, 3.55), its ramp's straight run 0.5 longer than L1's so the platen's plate stands clear of its portal; its bay turned 40° toward the camera,
   * built in): its portal (2.08 tall; the lamp's cage stands above it) and bay as one box in the door's frame (yaw -50). The ramp from the belt is low and not a body here.
   */
  dock: { c: [6.207, 1.04, 3.309], half: [0.94, 1.04, 0.525], yaw: -50 } as Box,
  /** Where the dock's door (the piece's origin) stands: the ramp below is fitted to bring it here (view/bench.ts DOCK_REACH gives the same). */
  dockDoor: [5.92, 3.55] as const,
  /** The return chute's mouth (real piece at (-8.4, 0, 5), run 2, aim 12: its `mouth` socket), and how parts come out of it: onto the bench at about its `land` (-6.95, 2.79), beside the stack. */
  chute: { p: [-7.631, 1.23, 2.932] as Vec3, linvel: [1.7, 0.6, -0.36] as Vec3 },
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
  const seat: Vec3 = [AT.platen.c[0] + 0.05, AT.platen.c[1] + AT.platen.half[1], AT.platen.c[2] + 0.145 - 0.1];
  const stoolTop: Vec3 = [AT.stool.c[0], AT.stool.c[1] + AT.stool.half[1], AT.stool.c[2]];
  /** The lamp's clamp on the wall rail (view/bench.ts LAYOUT `lamp`), and its arm as the lamp piece's rig solves it there (view/kit/pieces/lamp/rig.ts: STAGE_BULB, STAGE_AIM, LAMP_PLACE, DIM.shoulder; arms 3.45 + 3.3). */
  const clamp: Vec3 = [-3.1, 0, -5];
  const lamp = {
    home: { bulb: [clamp[0] + 0.9, 5.2, clamp[2] + 4.4] as Vec3, aim: [clamp[0] + 5.1, 0, clamp[2] + 4.9] as Vec3 },
    /** What its joints allow: the bulb within 1.0 to 5.0 (horizontally) of the shoulder at its fixed height, in front of the wall, over the bench. */
    reach: { centre: [clamp[0], clamp[2] + 0.24] as const, min: 1.0, max: 5.0, minX: AT.bench.minX + 0.5, maxX: 3.5, minZ: AT.backWall.c[2] + 1.0, maxZ: 1.5 },
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
      /** The keyshelf is inside the board's one-box collider, so a caught part is set on the bench beside the stool (PROVISIONAL). */
      shelf: [AT.stool.c[0] - AT.stool.half[0] - 0.35, 0, AT.stool.c[2]] as Vec3,
      lever: [AT.undo.c[0], AT.undo.c[1] + AT.undo.half[1], AT.undo.c[2]] as Vec3,
      visitor: [0.6, 2.4, 14] as Vec3,
      phone: AT.phone.c,
    },
  };
})();

const PATCHLAMP_MOUTHS: readonly MouthSpec[] = [PATCHLAMP.platenMouth];
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
  patch({
    id: 'patch',
    station: 'patchlamp',
    name: 'name.patch',
    line: 'line',
    ...PATCHLAMP.patch,
    jacks: Object.fromEntries(PATCHLAMP.jacks.map((j) => [j.id, j.at])),
    stations: { storefront: AT.storefront.c, platen: PATCHLAMP.seat, belt: [LINE.belt.from + 1, LINE.belt.top, LINE.belt.z], lamp: PATCHLAMP.lamp.home.bulb },
    bench: { minX: AT.bench.minX + 0.4, maxX: AT.bench.maxX - 0.4, minZ: AT.bench.minZ + 0.4, maxZ: AT.bench.maxZ - 0.4 },
  }),
  platen({ id: 'platen', station: 'patchlamp', name: 'name.platen', mouth: 'platen', seat: PATCHLAMP.seat }),
  storefront({ id: 'storefront', station: 'patchlamp', name: 'name.storefront' }),
  lamp({ id: 'lamp', station: 'top', name: 'name.lamp', levels: 5, startLevel: 3, home: PATCHLAMP.lamp.home, reach: PATCHLAMP.lamp.reach, follow: 0.6 }),
];

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
    box('platen-column', AT.platenColumn),
    box('platen-tank', AT.platenTank),
    box('storefront', AT.storefront),
    box('striker', AT.striker),
    box('dock', AT.dock),
    ...AT.pallets.flatMap((p, i) => [box(`pallet-${'abcd'[i]}`, p), box(`pallet-${'abcd'[i]}-stack`, AT.stacks[i]!)]),
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
  fixtures: [],
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
    jacks: PATCHLAMP.jacks,
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
  mouths: [...MOUTHS, ...PATCHLAMP_MOUTHS],
  units: [
    belt({ id: 'belt', station: 'line', name: 'name.belt', mouth: 'belt', ...LINE.belt, dial: { id: 'belt-dial', name: 'name.belt.dial' }, lever: { id: 'belt-lever', name: 'name.belt.lever' } }),
    striker({ id: 'striker', station: 'line', name: 'name.striker', x: LINE.strikerX, mouth: 'belt' }),
    dock({ id: 'dock', station: 'line', name: 'name.dock', mouth: 'dock', ramp: LINE.ramp, stack: AT.stack }),
    chute({ id: 'chute', station: 'line', name: 'name.chute' }),
    ...PATCHLAMP_UNITS,
  ],
};
