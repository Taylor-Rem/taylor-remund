/**
 * The whole bench (REWRITE.md § C, § G "P2"; ART-P2 § 2-3; briefs L1, A1):
 * the layout every P2 piece is built to, the camera's homes, and the loader
 * that stands the playable bench up at `/dev/bench/` from its station files.
 *
 * ─────────────────────────── How to add a station ───────────────────────────
 *
 *  1. Its place is a row of `LAYOUT.stations` below (and, if it has a body,
 *     the same numbers in `sim/scenes/bench.ts` `AT`; the test holds them).
 *  2. Add ONE file, `view/bench/stations/<name>.ts`, exporting
 *       export const station: BenchStation = { name, order: ORDER.pool, make(k) { ... } };
 *     It is found by import.meta.glob; nothing else is edited. To replace a
 *     static stand-in with an animated view, replace that station's file.
 *  3. `make(k: BenchKit)` reads its place (`origin(LAYOUT.stations.x)`), the
 *     scene, the fit and the crew scale from `k`, and returns a
 *     `StationViewFactory` (or several, or null): the view contract.
 *  4. Static: `staticStation(k, (build) => [{ piece: build('name'), at }])`
 *     merges it into the set. Moving: `splitStatic(piece, at, isMoving, k.pool)`
 *     hands its fixed body to the set and returns what you realise and pose.
 *  5. `order`: ORDER.pool before the set, ORDER.crew after the parts; see bench/station.ts.
 *
 * `LAYOUT` is the table the team builds to: for every station its origin
 * (the centre of its footprint on the bench, or on the wall for what hangs
 * there), footprint (w along X, d along Z, before yaw), height and yaw, and
 * what fills it now (a real piece, or clay of that size). Where a station
 * has a body, the simulation's own table (`sim/scenes/bench.ts` `AT`) holds
 * the same numbers, and `tests/unit/view/bench.test.ts` holds the two
 * together; the world boots from the simulation's scene unchanged.
 */
import { Box3, Group, Matrix4, Vector3 } from 'three';
import type { SceneDesc, Vec3 } from '../sim/types.ts';
import type { Frame, StationViewFactory } from './types.ts';
import type { Piece, KitPart } from './kit/types.ts';
import { listPieces, buildEntry, type Entry } from './catalogue/registry.ts';
import { pieceBounds } from './kit/compose.ts';
import { ROOM } from './kit/pieces/room/index.ts';
import { WINDOW } from './kit/pieces/window/index.ts';
import { JACKS, STOOL_SEAT } from './kit/pieces/switchboard/index.ts';
import { flatten, placedMatrix } from './stations/set.ts';
import { fitPieces, measured, measureEntry, socketsPiece, type Fit, type Measure } from './vignette.ts';
import { loadBakeTable, measured as tableMeasured, measureOnly } from './kit/bake.ts';
import { site } from '../../content/site.ts';
import type { BenchKit, BenchStation } from './bench/station.ts';
import { BENCH_LAYOUT } from '../sim/index.ts';

export { clayBlock } from './bench/clay.ts';
export type { BenchKit, BenchStation } from './bench/station.ts';
export { ORDER, staticStation } from './bench/station.ts';

// ───────────────────────── the layout table ─────────────────────────

/** Where a station stands and how much room it takes. */
export interface Spot {
  /** Origin: the centre of its footprint (x, z). For what hangs on the wall, z is the wall's face. */
  readonly x: number;
  readonly z: number;
  /** Height of its base above the bench top (0 on the bench; what hangs: its bottom edge). */
  readonly y: number;
  /** Footprint along X (w) and Z (d), before yaw; and its height. */
  readonly w: number;
  readonly d: number;
  readonly h: number;
  /** Turn about +Y, degrees (0: good side toward the visitor, +Z). */
  readonly yaw: number;
  /** What fills it now: a registered piece, clay of its size, a taped rectangle, or a zone blocked in by its own table (`SHIPPED`). */
  readonly fill: 'piece' | 'clay' | 'tape' | 'zone';
  /** Where the piece's own origin stands, when that is not the footprint's centre (a real piece whose bounds are off its origin). */
  readonly at?: readonly [number, number];
}

const spot = (x: number, z: number, w: number, d: number, h: number, o: { y?: number; yaw?: number; fill?: Spot['fill']; at?: readonly [number, number] } = {}): Spot => ({ x, z, y: o.y ?? 0, w, d, h, yaw: o.yaw ?? 0, fill: o.fill ?? 'clay', ...(o.at ? { at: o.at } : {}) });

/** A real piece's spot from its origin and its bounds there (min/max x and z, height): the footprint is the bounds'. */
/** Where a spot's piece stands: its own origin (`at`), or the footprint's centre. */
export const origin = (sp: Spot): [number, number] => [sp.at?.[0] ?? sp.x, sp.at?.[1] ?? sp.z];

const real = (ox: number, oz: number, b: { x: readonly [number, number]; z: readonly [number, number]; h: number }): Spot =>
  spot(ox + (b.x[0] + b.x[1]) / 2, oz + (b.z[0] + b.z[1]) / 2, b.x[1] - b.x[0], b.z[1] - b.z[0], b.h, { fill: 'piece', at: [ox, oz] });

/**
 * The crew are drawn this much bigger than their P1 pieces (ART-P2 § 2). The layout is sized for this
 * value (Fetch's lane, Revert and its hatch) and stays clear at every smaller one; `/dev/bench/?crew=`
 * draws another for comparison.
 */
export const CREW_SCALE = 1.5;

/** Revert and its hatch were built at the crew's 1.25×: drawn at CREW_SCALE / 1.25. */
export const REVERT_SCALE = CREW_SCALE / 1.25;

/**
 * The real pieces' bounds about their own origins (measured from the pieces at rest; the test re-measures):
 * the storefront, the platen, the dock with its ramp fitted to the belt (`DOCK_REACH`), Revert idle and its
 * hatch open (both at REVERT_SCALE).
 */
export const BOUNDS = {
  storefront: { x: [-2.27, 1.21], z: [-0.47, 0.6], h: 2.83 },
  platen: { x: [-1.7, 1.31], z: [-1.26, 1.09], h: 2.99 },
  dock: { x: [-1.7, 1.38], z: [-1.35, 1.2], h: 2.29 },
  revert: { x: [-0.84 * REVERT_SCALE, 0.87 * REVERT_SCALE], z: [-0.58 * REVERT_SCALE, 0.7 * REVERT_SCALE], h: 1.12 * REVERT_SCALE },
  hatch: { x: [-1.3 * REVERT_SCALE, 1.3 * REVERT_SCALE], z: [-0.81 * REVERT_SCALE, 0.81 * REVERT_SCALE], h: 0.87 * REVERT_SCALE },
  /** The whole switchboard (`jacks: JACKS`), its stool's runner included (it runs on past the frame's right end). */
  board: { x: [-2.7, 3.55], z: [-0.61, 1.25], h: 3.21 },
  /** The UNDO lever at home. */
  undo: { x: [-0.79, 0.79], z: [-0.41, 0.514], h: 1.965 },
  /** The striker (its arm reaches forward and left over the belt: the hammer is at (-0.375, 0.928)). */
  striker: { x: [-0.517, 0.712], z: [-0.307, 1.182], h: 2.095 },
  /** The return chute at CHUTE_RUN, CHUTE_AIM: what stands on the bench (its riser climbs the apron outside the front edge, z > 0). */
  chute: { x: [-0.57, 1.163], z: [-2.691, 0], h: 1.767 },
} as const;

/** The return chute's run back from the front edge and its mouth's aim (the chute's builder: run 2, aim 10-15; its throat stays in view to about 15). */
export const CHUTE_RUN = 2.0;
export const CHUTE_AIM = 12;
/** The whole board's origin (x, z): its back against the wall; the stool rests on its runner at BOARD_WHOLE.stoolRestX, runner.z. */
export const BOARD_AT: readonly [number, number] = [-0.1, -4.38];

/** The dock's ramp start from the door's origin [dx, dz] (dims.ts `fitRamp`): short, so the door stands at (5.92, 3.55), left of the Shipped zone's front row. */
export const DOCK_REACH: readonly [number, number] = [-1.7, 0.45];
/** The belt's bed end and the dock's door (its origin): the ramp's first roller sits DOCK.beltGap (0.12) past the bed. */
const BED_END: readonly [number, number] = [-0.9 + 5, 4.0];
const DOOR: readonly [number, number] = [BED_END[0] + 0.12 - DOCK_REACH[0], BED_END[1] - DOCK_REACH[1]];

/** Fetch's lane tape: half its width round the lane, and how far past each end it runs (P1: 0.52 and 0.55 at 1×; widened for the bigger Fetch). */
export const LANE_TAPE = { half: 0.3 * CREW_SCALE + 0.23, past: 0.3 * CREW_SCALE + 0.1 } as const;
/** The lane's footprint: the box round every run of the scene's path, the tape's half width either side and its overrun past the ends (for a lane of two points along X, the old rectangle exactly). */
function laneSpot(): Spot {
  const pts = BENCH_LAYOUT.lane.points as readonly (readonly [number, number])[];
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  return spot((minX + maxX) / 2, (minZ + maxZ) / 2, maxX - minX + 2 * LANE_TAPE.past, maxZ - minZ + 2 * LANE_TAPE.half, 0, { fill: 'tape' });
}

/** The sign's capitals (units): TAYLOR REMUND on one line. The 12 px rule at the 1440×900 home is met with room to spare (see check-bench). */
export const SIGN_CAP_BENCH = 0.5;

/** The sign's words: the name from the site's own content, in capitals (no visible string is typed here). */
export const SIGN_WORDS: readonly string[] = site.strip.name.text.toUpperCase().split(/\s+/);

/**
 * The layout. Left to right is the direction of work; tall things at the
 * back; nothing usable behind anything else from the fixed camera. The
 * stations with bodies repeat the simulation's `AT` (checked by test).
 */
export const LAYOUT = {
  bench: { minX: -9, maxX: 9, minZ: -5, maxZ: 5 },
  /** The belt's length (its bed; the piece adds its motor housing and end rail). */
  beltLength: 10,
  /** The back wall's boards: wider than the bench so they run on past both ends into the dark. */
  wall: { width: 21, height: 9 },
  stations: {
    // ── on the wall ──
    /** Pegboard and its six tools (the real piece, 5.56 × 4.06); it hangs past the bench's left end. */
    toolwall: spot(-7.35, -5, 5.56, 0.4, 4.06, { y: 0.3, fill: 'piece' }),
    /** The lamp's clamp on the wall rail, 1.47 right of the pegboard (P1's gap); its bulb is the key light. */
    lamp: spot(-3.1, -5, 0.5, 0.5, 4.7, { fill: 'piece' }),
    /** The sign, TAYLOR REMUND on one line, hung over the board (bottom edge at y). */
    sign: spot(1.1, -5, 8.6, 0.57, 2.9, { y: 3.3, fill: 'piece' }),
    /** The window (the room's piece): origin at the bottom middle of its opening, (7.0, 2.0) on the wall; linings, sill and head round it. */
    window: spot(ROOM.window.x, -5, WINDOW.w + 0.5, WINDOW.reveal + WINDOW.sillOut, WINDOW.h + 0.65, { y: ROOM.window.y - 0.3, fill: 'piece' }),
    // ── the back row ──
    /** The whole switchboard (real; four live jacks), with the brass-railed runner its stool rolls along in front. */
    board: real(BOARD_AT[0], BOARD_AT[1], BOUNDS.board),
    /** Patch's stool, lowered (STOOL_SEAT), at rest on the runner's right end: Patch's face to the visitor, inside the centre 40%. */
    stool: spot(3.02, -3.46, 0.632, 0.64, 0.625, { y: 0.052, fill: 'piece' }),
    /** The storefront (real; its jack box and conduit run off its left side). */
    storefront: real(7.6, -3.6, BOUNDS.storefront),
    /** The reserved bays (the room's pieces, their labels flat on the bench), at the back left under the tool wall: INSPECTION at the corner, the plain one right of it. Nothing tall stands in front of either label. */
    bayInspection: spot(-7.15, -3.6, 3.4, 1.9, 0, { fill: 'piece' }),
    bayNext: spot(-4.05, -3.55, 2.4, 1.6, 0, { fill: 'piece' }),
    // ── the middle row ──
    /** The platen (real; base 2.4 × 2.0, arm up 3.0; its conduit leaves left). Right of Patch and forward, its column clear of Patch's tail; its tray 1.9 from the lane. */
    platen: real(4.6, 0.2, BOUNDS.platen),
    /** Shipped (P4): four pallets of crates (`SHIPPED`). */
    shipped: spot(7.88, -1.0, 2.24, 2.8, 1.2, { fill: 'zone' }),
    // ── the Button's row ──
    /** Revert's hatch, doors open, the lift up (real, at REVERT_SCALE). The bench top is cut for it (`benchHole`). Left of the lever, in the lamp's spill. */
    hatch: real(-4.6, 0.3, BOUNDS.hatch),
    /** Revert, risen on its lift (real, idle, at REVERT_SCALE). */
    revert: real(-4.6, 0.3, BOUNDS.revert),
    /** The UNDO lever (real): beside the Button on its left, in the lamp's pool, clear of the lamp's arm, between Revert's hatch and the console. */
    undo: real(-2.2, 0.3, BOUNDS.undo),
    button: spot(-0.05, 0.5, 2.1, 1.52, 1.98, { fill: 'piece' }),
    /** The phone on its easel: right of the Button, between it and the platen, a hand's reach from the lane. */
    phone: spot(2.4, 0.9, 0.42, 0.3, 0.72, { yaw: -16, fill: 'piece' }),
    // ── the front ──
    /** The crate stack (the ground point of its bottom crate): left of the lane's left end, 2.02 from its stop (the crate it lifts swings clear of the stack); the chute's landing and the deflector's set-down spot beside it, all clear of the lane's tape. */
    stack: spot(-6.0, 1.75, 0.8, 0.8, 1.85, { fill: 'piece' }),
    /** Fetch's lane: the box round every run of its path (S5 round 2: a path of runs; the scene's points), the tape's width and overrun included. */
    lane: laneSpot(),
    /** The belt (`line: true`) at length 10, the bed x -5.9..4.1: its control housing with the dial, the lever and its lamp at the left end, the deflector's slide off the back beside it, the open tail at the dock's ramp. The whole piece's footprint. */
    belt: spot(-1.575, 3.905, 11.53, 1.98, 1.23, { fill: 'piece', at: [-0.9, 4.0] }),
    /** The striker (real): its post between the lane and the belt's far rail, its hammer over the belt at x 2.1, 2.0 from its far end: room for a run of notes played backwards. */
    striker: real(2.475, 3.072, BOUNDS.striker),
    /** The dock (real; its turn toward the camera is built in, so yaw 0; its ramp fitted to the belt's end). */
    dock: real(DOOR[0], DOOR[1], BOUNDS.dock),
    /** The mailbox on its post, the résumé clipboard hanging from it: front right, clear, nothing in front (P4 builds them). */
    mailbox: spot(7.7, 3.75, 0.42, 0.36, 1.3),
    /** The return chute (real): up out of the dark at the front-left corner, its mouth looking along the bench at the stack's front. */
    chute: real(-8.4, 5, BOUNDS.chute),
  },
} as const;

export type StationKey = keyof typeof LAYOUT.stations;

/** A crate on a pallet: its size, and where its bottom-front-centre sits on the pallet (dx across, y up; fronts flush with the pallet's front). */
export interface ShippedCrate {
  readonly size: 'S' | 'M' | 'L';
  readonly dx: number;
  readonly y: number;
}
export const CRATE_EDGE_VIEW = { S: 0.45, M: 0.6, L: 0.8 } as const;
const PALLET = { w: 1.0, d: 1.0, h: 0.15 } as const;

/**
 * The Shipped zone blocked in (P4 builds it): four pallets in two rows. The back row carries the tall
 * stacks (up to 1.2), the front row low ones (0.6), with 0.7 between the rows, so every crate's front
 * shows over the row in front of it; the front row stands right of the dock's line of sight. The
 * pallets are 1.0 × 1.0 and stand two by two in the dock's lee: at 1.2 wide, or with a pallet further
 * left, the dock's portal hides the foot of a back-row crate.
 */
export const SHIPPED = {
  pallet: PALLET,
  pallets: [
    { x: 7.4, z: -1.85, crates: [{ size: 'M', dx: -0.2, y: 0 }, { size: 'S', dx: -0.2, y: 0.6 }, { size: 'S', dx: 0.27, y: 0 }] },
    { x: 8.45, z: -1.85, crates: [{ size: 'M', dx: 0.2, y: 0 }, { size: 'S', dx: 0.2, y: 0.6 }, { size: 'S', dx: -0.27, y: 0 }, { size: 'S', dx: -0.27, y: 0.45 }] },
    { x: 7.48, z: -0.3, crates: [{ size: 'S', dx: -0.25, y: 0 }, { size: 'S', dx: 0.25, y: 0 }] },
    { x: 8.5, z: -0.3, crates: [{ size: 'S', dx: -0.25, y: 0 }, { size: 'S', dx: 0.25, y: 0 }] },
  ] as ReadonlyArray<{ x: number; z: number; crates: readonly ShippedCrate[] }>,
} as const;

/** The mailbox on its post and the résumé clipboard hanging from the post's front (clay; P4). */
export const MAILBOX = { x: 7.7, z: 3.75, post: 0.18, postH: 1.0, box: { w: 0.42, d: 0.32, h: 0.3 }, clipboard: { w: 0.34, h: 0.44, t: 0.03, y: 0.42 } } as const;

/** Each pallet as two boxes, the pallet and its stack of crates: the bodies. */
export function shippedBoxes(): Array<{ id: string; box: Box3 }> {
  const out: Array<{ id: string; box: Box3 }> = [];
  const P = SHIPPED.pallet;
  SHIPPED.pallets.forEach((p, i) => {
    const id = `pallet-${'abcd'[i]}`;
    out.push({ id, box: new Box3(new Vector3(p.x - P.w / 2, 0, p.z - P.d / 2), new Vector3(p.x + P.w / 2, P.h, p.z + P.d / 2)) });
    const stack = new Box3();
    for (const c of p.crates) {
      const e = CRATE_EDGE_VIEW[c.size];
      stack.union(new Box3(new Vector3(p.x + c.dx - e / 2, P.h + c.y, p.z + P.d / 2 - e), new Vector3(p.x + c.dx + e / 2, P.h + c.y + e, p.z + P.d / 2)));
    }
    out.push({ id: `${id}-stack`, box: stack });
  });
  return out;
}

/** The mailbox (with its post) as a box. */
export function mailboxBox(): Box3 {
  const m = MAILBOX;
  return new Box3(new Vector3(m.x - m.box.w / 2, 0, m.z - m.box.d / 2), new Vector3(m.x + m.box.w / 2, m.postH + m.box.h, m.z + m.box.d / 2));
}

/** Every shipped crate's front face (world): centre and size, for the visibility test. */
export function shippedCrateFronts(): Array<{ c: Vector3; w: number; h: number }> {
  const P = SHIPPED.pallet;
  const out: Array<{ c: Vector3; w: number; h: number }> = [];
  for (const p of SHIPPED.pallets)
    for (const k of p.crates) {
      const e = CRATE_EDGE_VIEW[k.size];
      out.push({ c: new Vector3(p.x + k.dx, P.h + k.y + e / 2, p.z + P.d / 2), w: e, h: e });
    }
  return out;
}

/** The camera's homes (§ B6): the whole bench on a wide screen; the centre cluster on an upright phone (§ B3). */
export const FRAMING = {
  /**
   * Not the bench's box but the box the rig fits about its centre, with the `edge` its pan limit keeps the
   * frame's bottom from running past (y -1.25: the apron's foot, so the legs and the floor show). Found by
   * search (tests/unit/view/bench.test.ts holds the result): every station and `MUST_SEE` in frame, the
   * bench's front corners about 30 px inside the sides, and the most Fetch that leaves. At 16:10 the
   * front corners bind across: the box is wide and shallow and sits forward. At 16:9 the height binds:
   * the box is tall and narrow.
   */
  wide: { min: [-10.6, -2.5, 0] as Vec3, max: [10.6, 0, 3] as Vec3 },
  wideEdge: { y: -1.25, z: 5 },
  /** 16:9 and wider (above `widerFrom`). */
  wider: { min: [-1, -2, -5] as Vec3, max: [1, 5, 7] as Vec3 },
  widerEdge: { y: -1.25, z: 5 },
  widerFrom: 1.7,
  /** Button, loose crate, phone and Patch, all four without panning. */
  phone: { min: [-1.6, 0, -3.9] as Vec3, max: [4.0, 2.3, 2.9] as Vec3 },
  /** The lens on this page: the stage's fov and pitch (20, 33: the approved look); a thinner margin than its 0.06, since the room beyond the bench ends is margin enough and the 18-wide bench needs every pixel. */
  lens: { fov: 20, pitch: 33, margin: 0.035 },
  /** Where the focus is pinned at home: the console's front and Fetch's lane. */
  focus: [0, 0.6, 1.2] as Vec3,
  blur: { range: 0.075, scale: 12, max: 6, far: 0.5 },
  /** The pan limits: 1.8 past each bench end, so a visitor panned to an end sees its corner, the legs and the room's end (with the edges' y -1.25: the frame's foot may run down to the apron's). */
  bounds: { min: [-10.8, -1, -5] as Vec3, max: [10.8, 6, 5] as Vec3 },
} as const;

/**
 * What the home framing must show on a wide screen, whatever its shape: the bench's front corners, the
 * sign's hook, the tool wall's top-left, the window's top-right, the bench's back corners.
 */
export const MUST_SEE: readonly Vec3[] = [
  [-9, 0, 5], [9, 0, 5],
  [-3.2, 6.25, -4.95], [5.4, 6.25, -4.95],
  [-10.15, 4.4, -4.9], [8.85, 5.2, -4.6],
  [-9, 0, -5], [9, 0, -5],
];
/** At 1440×900: the front corners at least this far inside the frame's sides, and the front edge this high over its bottom (px). The lead asked 60-80 under the edge before the room landed; with the real frame and floor about 110 reads best (the legs to the knee braces), and the edge's y -1.25 sets it. */
export const FRAME_PX = { corners: 30, under: [60, 115] as const };

/** The camera's home box for a viewport of this aspect (width / height; under 1: the phone framing). */
export function homeBox(aspect: number): Box3 {
  const f = aspect < 1 ? FRAMING.phone : aspect > FRAMING.widerFrom ? FRAMING.wider : FRAMING.wide;
  return new Box3(new Vector3(...f.min), new Vector3(...f.max));
}
/** The bench edge the home's pan limit holds (the phone: the front edge itself, as approved). */
export function homeEdge(aspect: number, bench: { top: number; maxZ: number }): { y: number; z: number } {
  return aspect < 1 ? { y: bench.top, z: bench.maxZ } : aspect > FRAMING.widerFrom ? { ...FRAMING.widerEdge } : { ...FRAMING.wideEdge };
}

/** A spot's footprint as a world box (yaw applied: the box round the turned footprint). */
export function spotBox(s: Spot): Box3 {
  const c = Math.cos(s.yaw * DEG), n = Math.sin(s.yaw * DEG);
  const hx = (Math.abs(c) * s.w + Math.abs(n) * s.d) / 2, hz = (Math.abs(n) * s.w + Math.abs(c) * s.d) / 2;
  const onWall = s.z <= WALL_Z;
  const z0 = onWall ? WALL_Z : s.z - hz, z1 = onWall ? WALL_Z + s.d : s.z + hz;
  return new Box3(new Vector3(s.x - hx, s.y, z0), new Vector3(s.x + hx, s.y + s.h, z1));
}

const DEG = Math.PI / 180;
const WALL_Z = -5;

// ───────────────────────── loading the bench ─────────────────────────

export interface BenchOptions {
  /** The scene the world boots from (`sim/scenes/bench.ts` `bench`; the page passes it). */
  scene: SceneDesc;
  seed?: number;
  /** The crew's drawing scale (default CREW_SCALE; the page's ?crew= compares others). */
  crewScale?: number;
  /**
   * A test of a lower seat (the switchboard's seat-height option is coming): the P1 stool is sunk into the
   * bench so its seat top stands at this height, and Patch with it. Review only.
   */
  seat?: number;
  /** The room round the bench (frame, floor, wall run on and cut for the window, the room's ends); false: P1's bench top and 21-wide wall. Default true. */
  room?: boolean;
}

export interface Bench {
  scene: SceneDesc;
  stations: StationViewFactory[];
  /** The station files that made views, in order. */
  names: string[];
  /** Triangles each station handed the set to merge (all, and those that cast), once the views are made. */
  statics: Record<string, { triangles: number; casting: number }>;
  fit: Fit;
  measured: Record<string, unknown>;
  /** Fetch's piece bounds at rest (piece space, before the crew scale), for measuring its height on screen; and without its aerial and pennant. */
  fetchBounds: Box3 | null;
  fetchBodyBounds: Box3 | null;
  /** Patch's piece bounds (seat space, before the crew scale). */
  patchBounds: Box3 | null;
  /** The belt's control plates (world matrices of its `dial` and `lever` sockets) and their sizes. */
  handles: { dial: Matrix4 | null; lever: Matrix4 | null };
  crewScale: number;
  /** The key light (the lamp's bulb and aim). */
  bulb: { at: Vec3; aim: Vec3 } | null;
  world(): Frame['world'] | null;
}

type Module = Record<string, unknown>;
// eager (B1 round 2): lazy globs made a stub chunk per piece and per station, each fetched in turn
// (51 round trips before the physics engine could start on Fast 4G); their code is in the bundle anyway
const pieceModules = import.meta.glob<Module>('./kit/pieces/*/index.ts', { eager: true });
const stationModules = import.meta.glob<{ station?: BenchStation }>('./bench/stations/*.ts', { eager: true });
async function pieceModule(folder: string): Promise<Module | null> {
  return pieceModules[`./kit/pieces/${folder}/index.ts`] ?? null;
}

export async function loadBench(o: BenchOptions): Promise<Bench> {
  const scene = o.scene;
  const seed = o.seed ?? 1;
  // the bake table downloads while the piece modules load (K1: kit/bake.ts)
  const table = loadBakeTable();
  const { entries } = await listPieces();
  const find = (name: string): Entry | undefined => entries.find((e) => e.name === name);
  // sizes and sockets of the blank pieces: recorded in the bake table, else measuring builds (no bake)
  await table;
  const blank = (e: Entry | undefined, opts: Record<string, unknown> = {}): Measure | null => (e ? measureEntry(e, { seed, ...opts }) : null);
  const S = LAYOUT.stations;

  // the pieces fitted to the scene's bodies: the board's jacks and cord root, the stool's seat, the phone, the belt
  const beltMeasure = blank(find('belt'), { length: LAYOUT.beltLength, line: true });
  const fit = fitPieces(scene, { board: blank(find('switchboard'), { jacks: JACKS }), stool: blank(find('stool'), { seatY: STOOL_SEAT }), phone: blank(find('phone')), belt: beltMeasure }, { stool: { x: S.stool.x, z: S.stool.z }, phoneYaw: S.phone.yaw });
  // the stool stands on the board's runner
  fit.stool.at = { ...fit.stool.at, y: S.stool.y };
  fit.stool.seat = [fit.stool.seat[0], fit.stool.seat[1] + S.stool.y, fit.stool.seat[2]];
  if (o.seat !== undefined) {
    const sink = fit.stool.seat[1] - o.seat;
    fit.stool.at = { ...fit.stool.at, y: -sink };
    fit.stool.seat = [fit.stool.seat[0], o.seat, fit.stool.seat[2]];
  }
  const meas = measured(scene, fit);

  // the page's read-outs: Fetch's and Patch's bounds, the belt's control plates
  const fetchEntry = find('fetch-porter');
  const fetchBoxes = fetchEntry
    ? tableMeasured(`bench|fetch-bounds|${seed}`, () => {
        const p = measureOnly(() => buildEntry(fetchEntry, null, { seed }));
        const b = pieceBounds(p), body = partsBounds(flatten([{ piece: p, at: new Matrix4(), skip: new Set(['aerial']) }]));
        return [...b.min.toArray(), ...b.max.toArray(), ...body.min.toArray(), ...body.max.toArray()];
      })
    : null;
  const boxAt = (a: readonly number[], i: number): Box3 => new Box3(new Vector3().fromArray(a, i), new Vector3().fromArray(a, i + 3));
  const fetchBounds = fetchBoxes ? boxAt(fetchBoxes, 0) : null;
  const fetchBodyBounds = fetchBoxes ? boxAt(fetchBoxes, 6) : null;
  const patchMeasure = blank(find('patch-felt'), { standIn: false });
  const patchBounds = patchMeasure ? patchMeasure.bounds.clone() : null;
  const crewScale = o.crewScale ?? CREW_SCALE;
  const beltAt = placedMatrix(fit.belt.at);
  const sock = (n: string): Matrix4 | null => (beltMeasure?.sockets[n] ? beltAt.clone().multiply(beltMeasure.sockets[n]) : null);
  const handles = { dial: sock('dial'), lever: sock('lever') };

  // the key light, from the real lamp clamped at its spot
  type KeyLight = (p: Piece, place: Vec3) => { position: Vec3; aim: Vec3 };
  const keyLight = (await pieceModule('lamp'))?.['keyLight'] as KeyLight | undefined;
  const lampMeasure = blank(find('lamp'));
  const k0 = keyLight && lampMeasure ? keyLight(socketsPiece('lamp', lampMeasure), [S.lamp.x, 0, S.lamp.z]) : null;
  const bulb = k0 ? { at: k0.position, aim: k0.aim } : null;

  let worldRef: Frame['world'] | null = null;
  const watcher: StationViewFactory = () => ({
    root: new Group(),
    update(frame) {
      worldRef = frame.world;
    },
    dispose() {},
  });

  const kit: BenchKit = { scene, seed, crewScale, room: o.room ?? true, fit, pool: { items: [] }, bulb, entries, entry: find, module: pieceModule, world: () => worldRef };
  const made: StationViewFactory[] = [];
  const names: string[] = [];
  const statics: Record<string, { triangles: number; casting: number }> = {};
  for (const s of await benchStations()) {
    const v = await s.make(kit);
    if (!v) continue;
    // each view, as it is made, is charged with the static pieces it hands the set (the page's census)
    made.push(...(typeof v === 'function' ? [v] : v).map((f): StationViewFactory => (ctx) => {
      const n0 = kit.pool.items.length;
      const out = f(ctx);
      const added = kit.pool.items.slice(n0);
      if (added.length) {
        const t = (statics[s.name] ??= { triangles: 0, casting: 0 });
        for (const q of flatten(added)) {
          const n = (q.geometry.index ? q.geometry.index.count : q.geometry.getAttribute('position').count) / 3;
          t.triangles += n;
          if (q.castShadow !== false && q.shadow !== 'none') t.casting += n;
        }
      }
      return out;
    }));
    names.push(s.name);
  }
  return { scene, stations: [watcher, ...made], names, statics, fit, measured: meas, fetchBounds, fetchBodyBounds, patchBounds, handles, crewScale, bulb, world: () => worldRef };
}

/** Every station file under `bench/stations/`, in the order their views are made (ORDER, then file name). */
export async function benchStations(): Promise<BenchStation[]> {
  const out: Array<{ s: BenchStation; file: string }> = [];
  for (const file of Object.keys(stationModules).sort()) {
    const m = stationModules[file]!;
    if (!m.station) throw new Error(`bench: ${file} exports no 'station'`);
    out.push({ s: m.station, file });
  }
  return out.sort((a, b) => a.s.order - b.s.order || (a.file < b.file ? -1 : 1)).map((x) => x.s);
}

/** The bounds of flattened parts. */
function partsBounds(parts: readonly KitPart[]): Box3 {
  const b = new Box3();
  for (const q of parts) {
    q.geometry.computeBoundingBox();
    if (q.geometry.boundingBox) b.union(q.geometry.boundingBox);
  }
  return b;
}
