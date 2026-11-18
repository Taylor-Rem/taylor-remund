/**
 * The whole bench (REWRITE.md § C, § G "P2"; ART-P2 § 2-3; brief L1): the
 * layout every P2 piece is built to, the camera's homes, and the list of
 * station views that make the playable bench at `/dev/bench/`.
 *
 * `LAYOUT` is the table the team builds to: for every station its origin
 * (the centre of its footprint on the bench, or on the wall for what hangs
 * there), footprint (w along X, d along Z, before yaw), height and yaw, and
 * what fills it now (a real piece, or clay of that size). Where a station
 * has a body, the simulation's own table (`sim/scenes/bench.ts` `AT`) holds
 * the same numbers, and `tests/unit/view/bench.test.ts` holds the two
 * together; the world boots from the simulation's scene unchanged.
 *
 * The bench reuses the vignette's machinery (`fitPieces`, the set, the
 * station views): what is new here is the layout, the clay of the pieces
 * still being built, the crew drawn 1.25× (ART-P2 § 2) and a belt of the
 * bench's length.
 */
import { Box3, Group, Matrix4, Quaternion, Vector3, type Object3D } from 'three';
import type { SceneDesc, Vec3 } from '../sim/types.ts';
import type { Frame, StationView, StationViewFactory, ViewContext } from './types.ts';
import type { Piece } from './kit/types.ts';
import { listPieces, buildEntry, type Entry } from './catalogue/registry.ts';
import { part, piece, pieceBounds } from './kit/compose.ts';
import { bevelBox } from './kit/cheap.ts';
import { laneTape, benchHole } from './kit/pieces/bench/index.ts';
import { OPENING } from './kit/pieces/revert-hatch/index.ts';
import { ROOM, roomWall } from './kit/pieces/room/index.ts';
import { WINDOW } from './kit/pieces/window/index.ts';
import { dock } from './kit/pieces/dock/index.ts';
import { signLabels } from './kit/pieces/sign/index.ts';
import { createPartsView } from './stations/parts.ts';
import { createSetView, flatten, placedMatrix, splitStatic, type StaticPool } from './stations/set.ts';
import type { KitPart } from './kit/types.ts';
import { createCordView } from './stations/cord.ts';
import { createPatchView } from './stations/patch.ts';
import { createButtonView } from './stations/button.ts';
import { createFetchView } from './stations/fetch.ts';
import { createLampView } from './stations/lamp.ts';
import { createCardView } from './stations/card.ts';
import { BELT_FEEL } from './stations/belt.ts';
import { fitPieces, hashSeed, measured, STAND_IN, type Fit } from './vignette.ts';
import type { Token } from './palette.ts';
import { paints } from './palette.ts';
import { site } from '../../content/site.ts';

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
  dock: { x: [-1.21, 1.38], z: [-1.35, 1.2], h: 2.29 },
  revert: { x: [-0.84 * REVERT_SCALE, 0.87 * REVERT_SCALE], z: [-0.58 * REVERT_SCALE, 0.7 * REVERT_SCALE], h: 1.12 * REVERT_SCALE },
  hatch: { x: [-1.3 * REVERT_SCALE, 1.3 * REVERT_SCALE], z: [-0.81 * REVERT_SCALE, 0.81 * REVERT_SCALE], h: 0.87 * REVERT_SCALE },
} as const;

/** The dock's ramp start from the door's origin [dx, dz] (dims.ts `fitRamp`): short, so the door stands at (5.42, 3.45), left of the Shipped zone's front row. */
export const DOCK_REACH: readonly [number, number] = [-1.2, 0.45];
/** The belt's bed end and the dock's door (its origin): the ramp's first roller sits DOCK.beltGap (0.12) past the bed. */
const BED_END: readonly [number, number] = [-0.9 + 5, 3.9];
const DOOR: readonly [number, number] = [BED_END[0] + 0.12 - DOCK_REACH[0], BED_END[1] - DOCK_REACH[1]];

/** Fetch's lane tape: half its width round the lane, and how far past each end it runs (P1: 0.52 and 0.55 at 1×; widened for the bigger Fetch). */
export const LANE_TAPE = { half: 0.3 * CREW_SCALE + 0.23, past: 0.3 * CREW_SCALE + 0.25 } as const;

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
    /** The window with its cut-out mountains: the cool light's source (clay frame on the wall). */
    /** The window (the room's piece): origin at the bottom middle of its opening, (7.0, 2.0) on the wall; linings, sill and head round it. */
    window: spot(ROOM.window.x, -5, WINDOW.w + 0.5, WINDOW.reveal + WINDOW.sillOut, WINDOW.h + 0.65, { y: ROOM.window.y - 0.3, fill: 'piece' }),
    // ── the back row ──
    board: spot(0.55, -4.335, 4.6, 1.31, 3.11, { fill: 'piece' }),
    stool: spot(3.05, -3.35, 0.65, 0.65, 1.15, { fill: 'piece' }),
    /** The storefront (real; its jack box and conduit run off its left side). */
    storefront: real(7.6, -3.6, BOUNDS.storefront),
    // ── the middle row ──
    /** The reserved bays (the room's pieces, their labels flat on the bench): the plain one at the back, INSPECTION in front of it, nearer the belt. */
    bayNext: spot(-6.6, -2.6, 3.0, 1.8, 0, { fill: 'piece' }),
    bayInspection: spot(-6.85, 0.25, 3.6, 2.0, 0, { fill: 'piece' }),
    /** The UNDO lever: near the middle now, in the lamp's pool, clear of Revert's line of sight. */
    undo: spot(-1.75, -1.9, 0.7, 0.7, 1.5),
    phone: spot(2.2, -1.35, 0.42, 0.3, 0.72, { yaw: -16, fill: 'piece' }),
    /** The platen (real; base 2.4 × 2.0, arm up 3.0; its conduit leaves left). Its column stands right of Patch's line of sight. */
    platen: real(4.4, -0.9, BOUNDS.platen),
    /** Shipped (P4): four pallets of crates (`SHIPPED`). */
    shipped: spot(7.88, -0.4, 2.24, 2.8, 1.2, { fill: 'zone' }),
    // ── the Button's row ──
    /** Revert's hatch, doors open, the lift up (real, at REVERT_SCALE). The bench top is cut for it (`benchHole`); its frame stands 0.29 clear of the INSPECTION bay's tape. */
    hatch: real(-3.2, 0.35, BOUNDS.hatch),
    /** Revert, risen on its lift (real, idle, at REVERT_SCALE). */
    revert: real(-3.2, 0.35, BOUNDS.revert),
    button: spot(-0.05, 0.55, 2.1, 1.52, 1.98, { fill: 'piece' }),
    // ── the front ──
    stack: spot(-8.5, -1.2, 0.8, 0.8, 1.85, { fill: 'piece' }),
    lane: spot(-1.1, 2.2, 8.2 + 2 * LANE_TAPE.past, 2 * LANE_TAPE.half, 0, { fill: 'tape' }),
    /** The belt piece at length 10 (the bed x -5.9..4.1) with its motor housing (dial plate and lever plate on its panel) at the left end: the whole piece's footprint. */
    belt: spot(-1.33, 3.995, 11.4, 1.6, 1.25, { fill: 'piece' }),
    striker: spot(3.7, 3.22, 0.6, 0.44, 1.7),
    /** The dock (real; its turn toward the camera is built in, so yaw 0; its ramp fitted to the belt's end). */
    dock: real(DOOR[0], DOOR[1], BOUNDS.dock),
    /** The mailbox on its post, the résumé clipboard hanging from it: front right, clear, nothing in front (P4 builds them). */
    mailbox: spot(7.7, 3.75, 0.42, 0.36, 1.3),
    chute: spot(-8.1, 3.3, 0.9, 1.1, 0.9),
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
    { x: 7.4, z: -1.25, crates: [{ size: 'M', dx: -0.2, y: 0 }, { size: 'S', dx: -0.2, y: 0.6 }, { size: 'S', dx: 0.27, y: 0 }] },
    { x: 8.45, z: -1.25, crates: [{ size: 'M', dx: 0.2, y: 0 }, { size: 'S', dx: 0.2, y: 0.6 }, { size: 'S', dx: -0.27, y: 0 }, { size: 'S', dx: -0.27, y: 0.45 }] },
    { x: 7.48, z: 0.3, crates: [{ size: 'S', dx: -0.25, y: 0 }, { size: 'S', dx: 0.25, y: 0 }] },
    { x: 8.5, z: 0.3, crates: [{ size: 'S', dx: -0.25, y: 0 }, { size: 'S', dx: 0.25, y: 0 }] },
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

// ───────────────────────── clay ─────────────────────────

/**
 * A stand-in of a piece being built: grey clay of its footprint and height,
 * resting on y = 0, good side +Z. Plain on purpose: it says "a thing this
 * big goes here", nothing about what it looks like.
 */
export function clayBlock(name: string, w: number, h: number, d: number, shade = 0.45): Piece {
  const b = piece(`stand-in-${name}`, { ao: false });
  const c = Math.max(0.005, Math.min(w, h, d) * 0.1);
  // 40 triangles: clay is counted in the budget (twice, with the shadow pass) like everything else
  b.add(part('paper', bevelBox({ min: [-w / 2, 0, -d / 2], max: [w / 2, h, d / 2], c, omit: ['ny'] }), 'steel', { shade }));
  return b.build();
}

/** A taped rectangle on the bench (the reserved bays, the hatch's border). */
function tapedRect(s: Spot, seed: number): Piece {
  const hw = s.w / 2, hd = s.d / 2;
  return laneTape({ seed, points: [[s.x - hw, s.z - hd], [s.x + hw, s.z - hd + 0.012], [s.x + hw, s.z + hd], [s.x - hw, s.z + hd - 0.01], [s.x - hw, s.z - hd]] });
}

/** The Shipped zone in clay: pallets (lighter), crates (mid), the mailbox and the clipboard. */
function shippedClay(): Array<{ piece: Piece; at: Matrix4 }> {
  const out: Array<{ piece: Piece; at: Matrix4 }> = [];
  const P = SHIPPED.pallet;
  SHIPPED.pallets.forEach((p, i) => {
    out.push({ piece: clayBlock(`pallet-${i}`, P.w, P.h, P.d, 0.6), at: placedMatrix({ x: p.x, z: p.z }) });
    for (const [j, c] of p.crates.entries()) {
      const e = CRATE_EDGE_VIEW[c.size];
      out.push({ piece: clayBlock(`shipped-crate-${i}-${j}`, e - 0.02, e - 0.02, e - 0.02, 0.5), at: placedMatrix({ x: p.x + c.dx, y: P.h + c.y, z: p.z + P.d / 2 - e / 2 }) });
    }
  });
  return out;
}

/** The mailbox on its post and the clipboard on the post's front, in clay. */
function mailboxClay(): Array<{ piece: Piece; at: Matrix4 }> {
  const m = MAILBOX, k = MAILBOX.clipboard;
  return [
    { piece: clayBlock('mailbox-post', m.post, m.postH, m.post), at: placedMatrix({ x: m.x, z: m.z }) },
    { piece: clayBlock('mailbox', m.box.w, m.box.h, m.box.d, 0.55), at: placedMatrix({ x: m.x, y: m.postH, z: m.z }) },
    { piece: clayBlock('clipboard', k.w, k.h, k.t, 0.7), at: placedMatrix({ x: m.x, y: k.y, z: m.z + m.post / 2 + k.t / 2 + 0.01 }) },
  ];
}

/** The clay and tape of every station still being built, and Fetch's lane tape, as pool items for the set to merge. */
export function standIns(seed: number, lane: { a: readonly [number, number]; b: readonly [number, number] }): Array<{ piece: Piece; at: Matrix4 }> {
  const out: Array<{ piece: Piece; at: Matrix4 }> = [];
  const I = new Matrix4();
  for (const [name, s] of Object.entries(LAYOUT.stations) as Array<[StationKey, Spot]>) {
    if (s.fill === 'zone') {
      out.push(...shippedClay());
      continue;
    }
    if (s.fill === 'tape') {
      if (name !== 'lane') out.push({ piece: tapedRect(s, seed + hashSeed(name)), at: I });
      continue;
    }
    if (s.fill !== 'clay') continue;
    if (name === 'mailbox') {
      out.push(...mailboxClay());
      continue;
    }
    const onWall = s.z <= WALL_Z;
    const at = placedMatrix({ x: s.x, y: s.y, z: onWall ? WALL_Z + s.d / 2 + 0.01 : s.z, yaw: s.yaw });
    out.push({ piece: clayBlock(name, s.w, Math.max(s.h, 0.02), s.d), at });
  }
  // Fetch's lane: a closed rectangle of tape round the runner's lane, wide enough for the bigger Fetch
  const hw = LANE_TAPE.half, px = LANE_TAPE.past;
  const x0 = Math.min(lane.a[0], lane.b[0]) - px, x1 = Math.max(lane.a[0], lane.b[0]) + px;
  const zc = (lane.a[1] + lane.b[1]) / 2;
  out.push({ piece: laneTape({ seed: seed + 4, points: [[x0, zc - hw], [x1, zc - hw + 0.015], [x1, zc + hw], [x0, zc + hw - 0.01], [x0, zc - hw]] }), at: I });
  return out;
}

// ───────────────────────── the belt, at the bench's length ─────────────────────────

/**
 * The belt view of `stations/belt.ts`, at a length of our choosing (that
 * file fixes 6; the bench's belt is 10). Same feel and the same split: the
 * body goes to the set; the rollers, the seam and the lamp move here.
 * PROPOSED: a `length` option on `BeltViewOptions`, and this goes.
 */
export function createBenchBeltView(o: { entry: Entry | undefined; module: Record<string, unknown> | null; fit: Fit; seed: number; pool: StaticPool; length: number }): StationViewFactory {
  return (ctx: ViewContext): StationView => {
    const length = o.length;
    const root = new Group();
    root.name = 'belt';
    ctx.scene.add(root);
    if (!o.entry) return { root, update() {}, dispose: () => root.removeFromParent() };
    const whole = buildEntry(o.entry, null, { seed: o.seed, length }, ctx.labels);
    const at = placedMatrix(o.fit.belt.at);
    const p = splitStatic(whole, at, (n) => /^roller\d+$/.test(n) || n === 'seam' || n === 'lamp', o.pool);
    const obj = ctx.realize(p);
    root.applyMatrix4(at);
    root.add(obj);
    const picking = (ctx as unknown as { picking?: { add(id: string, o: Object3D, opts?: { box?: Box3 }): void } }).picking;
    if (picking) picking.add('belt', obj, { box: pieceBounds(whole) });
    else ctx.pickable('belt', obj);
    type PoseBelt = (root: Object3D, length: number, rollers: readonly unknown[], pose: { travel: number }) => void;
    const poseBelt = o.module?.['poseBelt'] as PoseBelt | undefined;
    const beltRollers = o.module?.['beltRollers'] as ((length: number) => readonly unknown[]) | undefined;
    const rollers = poseBelt && beltRollers ? beltRollers(length) : null;
    const u = (ctx.materials as unknown as { uniforms?: (cls: 'belt') => { u_offset?: { value: unknown }; u_speed?: { value: unknown } } }).uniforms?.('belt') ?? null;
    if (u?.u_speed && typeof u.u_speed.value === 'number') u.u_speed.value = 0;
    let v = ctx.reducedMotion ? 0 : BELT_FEEL.speed;
    let dv = 0;
    let phase = 0;
    return {
      root,
      update(frame: Frame) {
        ctx.materials.update(frame.time);
        const dt = Math.min(frame.dt, 0.1);
        for (const e of frame.events) if (e.type === 'misfire' && e.id === 'belt' && !ctx.reducedMotion) v = BELT_FEEL.lurch;
        const b = frame.world.button();
        const goal = ctx.reducedMotion ? 0 : b.phase === 'rewinding' ? BELT_FEEL.speed * BELT_FEEL.rewind : BELT_FEEL.speed;
        const w = BELT_FEEL.omega;
        for (let left = dt; left > 1e-6; ) {
          const h = Math.min(left, 1 / 240);
          dv += (-w * w * (v - goal) - 2 * BELT_FEEL.damping * w * dv) * h;
          v += dv * h;
          left -= h;
        }
        phase += v * dt;
        if (u?.u_offset) u.u_offset.value = phase;
        if (poseBelt && rollers) poseBelt(obj, length, rollers, { travel: phase });
      },
      dispose() {
        root.removeFromParent();
      },
    };
  };
}

// ───────────────────────── the crew, drawn bigger ─────────────────────────

/**
 * Fetch drawn `s`× about its own origin (under the tyre). The simulation's
 * body stays its P1 size (that is the crew engineer's to change); the crate
 * in its hands is moved out to where the bigger hands are.
 */
export function scaledFetch(inner: StationViewFactory, s: number): StationViewFactory {
  return (ctx) => {
    const v = inner(ctx);
    const body = v.root.getObjectByName('fetch:body');
    const S = new Matrix4().makeScale(s, s, s);
    const M = new Matrix4(), Bi = new Matrix4();
    const p = new Vector3(), q = new Quaternion(), k = new Vector3();
    return {
      root: v.root,
      update(frame: Frame) {
        v.update(frame);
        if (!body || !body.visible) return;
        const B = body.matrix;
        const w = frame.world;
        const c = w.crew(w.scene.runner.id);
        if (c?.carrying && w.mode(c.carrying) === 'crew') {
          const o = ctx.scene.getObjectByName(`part:${c.carrying}`);
          if (o) {
            M.copy(B).multiply(S).multiply(Bi.copy(B).invert());
            o.matrix.decompose(p, q, k);
            o.matrix.compose(p.applyMatrix4(M), q, k);
            o.matrixWorldNeedsUpdate = true;
          }
        }
        B.multiply(S);
        body.matrixWorldNeedsUpdate = true;
      },
      dispose: () => v.dispose(),
    };
  };
}

/** Patch drawn `s`× about its seat. */
export function scaledPatch(inner: StationViewFactory, s: number): StationViewFactory {
  return (ctx) => {
    const v = inner(ctx);
    v.root.scale.setScalar(s);
    return v;
  };
}

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
const pieceModules = import.meta.glob<Module>('./kit/pieces/*/index.ts');
async function pieceModule(folder: string): Promise<Module | null> {
  const load = pieceModules[`./kit/pieces/${folder}/index.ts`];
  return load ? await load() : null;
}

export async function loadBench(o: BenchOptions): Promise<Bench> {
  const scene = o.scene;
  const seed = o.seed ?? 1;
  const { entries } = await listPieces();
  const find = (name: string): Entry | undefined => entries.find((e) => e.name === name);
  const E = {
    bench: find('bench'),
    wall: find('back-wall'),
    crate: find('crate'),
    fetch: find('fetch-porter'),
    board: find('switchboard'),
    stool: find('stool'),
    plug: find('cord-plug'),
    belt: find('belt'),
    lamp: find('lamp'),
    phone: find('phone'),
    sign: find('sign'),
    toolwall: find('toolwall'),
    patch: find('patch-felt'),
  };
  const tools = entries.filter((e) => e.name.startsWith('tool-'));
  const mods = { belt: await pieceModule('belt'), board: await pieceModule('switchboard'), patch: await pieceModule('patch-felt'), lamp: await pieceModule('lamp') };

  const blank = (e: Entry | undefined, opts: Record<string, unknown> = {}): Piece | null => (e ? buildEntry(e, null, { seed, ...opts }) : null);
  const S = LAYOUT.stations;
  const fit = fitPieces(scene, { board: blank(E.board), stool: blank(E.stool), phone: blank(E.phone), belt: blank(E.belt, { length: LAYOUT.beltLength }) }, { stool: { x: S.stool.x, z: S.stool.z }, phoneYaw: S.phone.yaw });
  if (o.seat !== undefined) {
    const sink = fit.stool.seat[1] - o.seat;
    fit.stool.at = { ...fit.stool.at, y: -sink };
    fit.stool.seat = [fit.stool.seat[0], o.seat, fit.stool.seat[2]];
  }
  const meas = measured(scene, fit);
  const fetchPiece = blank(E.fetch);
  const fetchBounds = fetchPiece ? pieceBounds(fetchPiece) : null;
  const fetchBodyBounds = fetchPiece ? partsBounds(flatten([{ piece: fetchPiece, at: new Matrix4(), skip: new Set(['aerial']) }])) : null;
  const patchPiece = blank(E.patch, { standIn: false });
  const patchBounds = patchPiece ? pieceBounds(patchPiece) : null;
  const crewScale = o.crewScale ?? CREW_SCALE;
  const beltPiece = blank(E.belt, { length: LAYOUT.beltLength });
  const beltAt = placedMatrix(fit.belt.at);
  const sock = (n: string): Matrix4 | null => (beltPiece?.sockets?.[n] ? beltAt.clone().multiply(beltPiece.sockets[n]!) : null);
  const handles = { dial: sock('dial'), lever: sock('lever') };

  // the key light, from the real lamp clamped at its spot
  type KeyLight = (p: Piece, place: Vec3) => { position: Vec3; aim: Vec3 };
  const keyLight = mods.lamp?.['keyLight'] as KeyLight | undefined;
  const lampPiece = blank(E.lamp);
  const k = keyLight && lampPiece ? keyLight(lampPiece, [S.lamp.x, 0, S.lamp.z]) : null;
  const bulb = k ? { at: k.position, aim: k.aim } : null;

  // the sign carries the whole name on one line, at the bench's capital height
  const sign: Entry | undefined = E.sign
    ? { ...E.sign, build: (opts = {}) => E.sign!.build({ ...opts, words: SIGN_WORDS }), labels: (labels) => ({ panels: signLabels(labels, SIGN_WORDS, SIGN_CAP_BENCH) }) }
    : undefined;

  let worldRef: Frame['world'] | null = null;
  const watcher: StationViewFactory = () => ({
    root: new Group(),
    update(frame) {
      worldRef = frame.world;
    },
    dispose() {},
  });

  const crate = E.crate;
  const paintOf = (c: string): Token | null => ((paints as readonly string[]).includes(c) ? (c as Token) : null);
  const partsView: StationViewFactory = (ctx: ViewContext): StationView =>
    createPartsView({
      half: (p) => worldRef?.halfExtents(p.id) ?? [0.3, 0.3, 0.3],
      ...(crate ? { piece: (p) => buildEntry(crate, null, { size: p.size, paint: paintOf(p.colour), seed: hashSeed(p.id) }, ctx.labels) } : {}),
    })(ctx);

  const pool: StaticPool = { items: [] };
  const withRoom = o.room ?? true;
  const clayAndTape: StationViewFactory = (ctx: ViewContext) => {
    // runs before the set: hand the stand-ins and the room's pieces to its pool so they merge with it
    pool.items.push(...standIns(seed, scene.runner.lane));
    const at = (x = 0, y = 0, z = 0): Matrix4 => new Matrix4().makeTranslation(x, y, z);
    const put = (name: string, opts: Record<string, unknown>, m: Matrix4): void => {
      const e = find(name);
      if (e) pool.items.push({ piece: buildEntry(e, null, { seed, ...opts }, ctx.labels), at: m });
    };
    const S2 = LAYOUT.stations;
    // the real pieces at rest, static (no behaviour yet): placed at their own origins
    const S3 = LAYOUT.stations;
    const origin = (sp: Spot): [number, number] => [sp.at?.[0] ?? sp.x, sp.at?.[1] ?? sp.z];
    const scaled = (sp: Spot, k: number): Matrix4 => {
      const [x, z] = origin(sp);
      return at(x, 0, z).multiply(new Matrix4().makeScale(k, k, k));
    };
    put('storefront', {}, at(origin(S3.storefront)[0], 0, origin(S3.storefront)[1]));
    put('platen', {}, at(origin(S3.platen)[0], 0, origin(S3.platen)[1]));
    pool.items.push({ piece: dock({ seed, reach: DOCK_REACH }), at: at(origin(S3.dock)[0], 0, origin(S3.dock)[1]) });
    // Revert and its hatch were built at the crew's 1.25×: drawn at the page's crew scale / 1.25
    const rk = crewScale / 1.25;
    put('revert-hatch', { pose: 'open' }, scaled(S3.hatch, rk));
    put('revert', { pose: 'idle' }, scaled(S3.revert, rk));
    put('reserved-bay', { which: 'next', w: S2.bayNext.w, d: S2.bayNext.d, seed: 3 }, at(S2.bayNext.x, 0, S2.bayNext.z));
    put('reserved-bay', { which: 'inspection', w: S2.bayInspection.w, d: S2.bayInspection.d, seed: 4 }, at(S2.bayInspection.x, 0, S2.bayInspection.z));
    if (withRoom) {
      const B = ROOM.bench;
      put('bench-frame', { sections: B.sections, width: B.width, depth: B.depth, floor: ROOM.floorY }, at());
      put('floor', { width: ROOM.floor.width, z0: ROOM.floor.z0, z1: ROOM.floor.z1 }, at(0, ROOM.floorY, 0));
      put('window', {}, at(ROOM.window.x, ROOM.window.y, ROOM.window.z));
      put('room-left', { floor: ROOM.floorY }, at(ROOM.ends.left.x, ROOM.ends.left.y, ROOM.ends.left.z));
      put('room-right', { floor: ROOM.floorY }, at(ROOM.ends.right.x, ROOM.ends.right.y, ROOM.ends.right.z));
    }
    return { root: new Group(), update() {}, dispose() {} };
  };
  // the bench at 18 × 10 (the catalogue's default is 19.5 wide), and with the room the wall run on and cut for the window
  const B = ROOM.bench;
  const H = LAYOUT.stations.hatch, hk = crewScale / 1.25;
  const hole = benchHole(H.at![0], H.at![1], OPENING.w * hk, OPENING.d * hk);
  const benchEntry: Entry | undefined = E.bench ? { ...E.bench, build: (opts = {}) => E.bench!.build({ ...opts, sections: B.sections, width: B.width, depth: B.depth, openings: [hole] }) } : undefined;
  const wallEntry: Entry | undefined = E.wall && withRoom ? { ...E.wall, build: (opts = {}) => E.wall!.build({ ...opts, ...roomWall() }) } : E.wall;
  const stations: StationViewFactory[] = [
    watcher,
    createBenchBeltView({ entry: E.belt, module: mods.belt, fit, seed, pool, length: LAYOUT.beltLength }),
    createCordView({ board: E.board, plug: E.plug, boardModule: mods.board, fit, seed, pool }),
    clayAndTape,
    createSetView({
      entries: { ...E, sign, bench: benchEntry, wall: wallEntry },
      tools,
      // the set draws P1's lane tape round the runner's lane; the bench draws its own, wider (standIns), so the
      // set is handed the lane far off the bench. PROPOSED: a lane half-width option on SetOptions.
      scene: { ...scene, runner: { ...scene.runner, lane: { a: [-60, -60], b: [-60, -60] } } },
      seed,
      pool,
      lampBody: false,
      ...(bulb ? { bulb } : {}),
      standIn: STAND_IN,
      at: { sign: { x: S.sign.x, y: S.sign.y }, toolwall: { x: S.toolwall.x, y: S.toolwall.y }, lamp: { x: S.lamp.x, z: S.lamp.z }, phone: fit.phone.at, stool: fit.stool.at },
    }),
    partsView,
    scaledPatch(createPatchView({ entry: E.patch, module: mods.patch, fit, seed }), crewScale),
    createButtonView(),
    // after the parts: Fetch re-seats the carried crate in its claws
    scaledFetch(createFetchView({ seed: 7 }), crewScale),
    createLampView(),
    createCardView(),
  ];
  return { scene, stations, fit, measured: meas, fetchBounds, fetchBodyBounds, patchBounds, handles, crewScale, bulb, world: () => worldRef };
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
