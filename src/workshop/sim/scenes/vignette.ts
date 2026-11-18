/**
 * The vignette (REWRITE.md § G "P1"): the centre cluster of the bench.
 * Data only. Every number the layout tunes is in ONE table, `AT`; the
 * scene below is derived from it and never repeats a number.
 *
 * Conventions (art-direction § 2): 1 unit = Fetch's body height; bench top
 * is y = 0; +X to the visitor's right; +Z toward the visitor; the back wall
 * stands at z = -5. Static boxes are given as centre + half extents (the
 * physics shape, not the drawn piece's detail); parts as body centres.
 *
 * Clearances (checked in tests/unit/sim/scene.test.ts): Fetch's body
 * (half 0.30 x 0.26) and the crate in its hands keep off every static along
 * the whole lane; nothing starts inside a static.
 */
import type { Pose, Vec3 } from '../types.ts';
import type { SceneDesc, StaticSpec } from '../scene.ts';
import { CRATE_EDGE } from '../parts.ts';
import { qyaw } from '../math.ts';
import { lanePath } from '../path.ts';
import { FETCH_TUNING } from '../crew/fetch.ts';

/** A static box: centre and half extents. */
interface Box {
  readonly c: Vec3;
  readonly half: Vec3;
}

/** The layout table. Tune here. */
export const AT = {
  bench: { minX: -10, maxX: 10, minZ: -5, maxZ: 5 },
  backWall: { c: [0, 3, -5.15], half: [10, 3, 0.15] } as Box,
  /** The crate stack: ground point (x, z) of its bottom crate; L, M, S upward, each a little off true. */
  stack: [-3.05, -0.25] as const,
  /** The Button's console (the body only: guard, counter and cable are not colliders). Deck top at y 1.04. */
  console: { c: [0.15, 0.52, 0.55], half: [1.05, 0.52, 0.76] } as Box,
  /** The Button's cap on the console deck (where the interactable is). */
  buttonCap: [0.47, 1.25, 0.35] as Vec3,
  /** The switchboard against the back wall (with its keyshelf, frame and crest), and its two live jacks (measured from the piece). */
  board: { c: [1.05, 1.554, -4.335], half: [2.3, 1.554, 0.655] } as Box,
  jacks: { storefront: [0.05, 1.18, -4.264] as Vec3, lamp: [2.09, 1.18, -4.264] as Vec3 },
  /** Patch's tall stool at the board's right end (seat top 1.15), where both jack tapes stay clear of Patch. */
  stool: { c: [3.6, 0.577, -3.4], half: [0.324, 0.578, 0.322] } as Box,
  /** The phone. */
  phone: { c: [2.75, 0.36, -1.55], half: [0.21, 0.36, 0.15] } as Box,
  /** The belt's bed (carrying surface at y 0.5; static in P1) and its motor housing. */
  belt: { c: [3.5, 0.25, 4.05], half: [3.0, 0.25, 0.52] } as Box,
  beltMotor: { c: [-0.06, 0.63, 4.15], half: [0.56, 0.63, 0.79] } as Box,
  /** Fetch's lane of yellow tape (x, z): in front of the console, behind the belt. */
  lane: { points: [[-3.7, 2.25], [3.9, 2.25]] as const },
  /** Where along the lane (0 at a, 1 at b) Fetch starts, with the loose crate in its hands. */
  fetchStart: 0.22,
  /** The loose crate's own starting point (its durable location until it first rests elsewhere). */
  looseCrate: [-2.03, 0.225, 2.75] as Vec3,
  /** Where on the lane Fetch fumbles (x): right of the console, so nothing stands in front of its tape. */
  fumbleX: 2.5,
  /**
   * The fumble. Fetch turns to `heading` (radians about +Y; 0 faces +Z, the camera; -PI/2 faces -X,
   * toward the console) while winding up, then lets go: the crate leaves its hands with
   * `linvel`/`angvel` in WORLD space, so where it lands does not depend on which way Fetch was
   * travelling. Then it turns to `offerHeading` (the camera) for the offer. Tuned to rest at
   * x 1.5..2.0, z 2.0..2.5: beside the console's right flank (x 1.2), clear of it.
   */
  fumble: { heading: -Math.PI / 2, linvel: [-1.0, 2.0, 0] as Vec3, angvel: [0, 0, 5] as Vec3, offerHeading: 0 },
  /** The return chute's mouth, front left, and how parts come out of it. */
  chute: { p: [-8.7, 0.45, 3.4] as Vec3, linvel: [2.4, 0.6, -0.7] as Vec3 },
} as const;

const e = CRATE_EDGE;
const [sx, sz] = AT.stack;
const pose = (p: Vec3, yaw = 0): Pose => ({ p, q: qyaw(yaw) });
const box = (id: string, b: Box, extra: Partial<StaticSpec> = {}): StaticSpec => ({ id, shape: { type: 'box', half: b.half }, pose: pose(b.c), ...extra });
/** Fetch's lane as the path it rides (S5 round 2: runs of tape, corners rounded): fractions along it, and points on it. */
const LANE_PATH = lanePath(AT.lane.points, FETCH_TUNING.cornerRadius);
/** The fraction of the path at the point of it nearest x on its first run (for a mark given as an x). */
const laneT = (x: number): number => LANE_PATH.nearest(x, AT.lane.points[0][1]) / LANE_PATH.length;
const lanePoint = (t: number): [number, number] => LANE_PATH.at(t * LANE_PATH.length);
const [fx, fz] = lanePoint(AT.fetchStart);

/** Unpainted wood: a fresh crate's colour. Not one of the eight paints. */
export const BARE = 'bare';

export const vignette: SceneDesc = {
  id: 'vignette',
  gravity: -16,
  bench: { ...AT.bench, top: 0, ceiling: 8 },
  fallY: -1.2,
  statics: [
    { id: 'bench', shape: { type: 'box', half: [10, 0.5, 5], radius: 0 }, pose: pose([0, -0.5, 0]), friction: 0.75, restitution: 0.12 },
    box('back-wall', AT.backWall, { shape: { type: 'box', half: AT.backWall.half, radius: 0 } }),
    box('console', AT.console),
    box('board', AT.board),
    box('stool', AT.stool),
    box('phone', AT.phone),
    box('belt-bed', AT.belt, { friction: 0.9 }),
    box('belt-motor', AT.beltMotor),
  ],
  parts: [
    { id: 'crate-1', kind: 'crate', size: 'L', material: 'wood', colour: BARE, label: '', station: 'line', name: 'name.crate', pose: pose([sx, e.L / 2, sz], 0.04) },
    { id: 'crate-2', kind: 'crate', size: 'M', material: 'wood', colour: BARE, label: '', station: 'line', name: 'name.crate', pose: pose([sx + 0.04, e.L + e.M / 2, sz - 0.03], -0.09) },
    { id: 'crate-3', kind: 'crate', size: 'S', material: 'wood', colour: BARE, label: '', station: 'line', name: 'name.crate', pose: pose([sx - 0.03, e.L + e.M + e.S / 2, sz + 0.02], 0.13) },
    // the loose crate, in Fetch's hands from the first step
    { id: 'crate-4', kind: 'crate', size: 'S', material: 'wood', colour: BARE, label: '', station: 'button', name: 'name.crate', pose: pose(AT.looseCrate) },
    // Fetch is a part too (kind robot): it can be picked up like anything loose; it starts facing the camera
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
    shove: [0.4, 0, 2.6],
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
    lane: { points: AT.lane.points },
    start: AT.fetchStart,
    carrying: 'crate-4',
    fumbleAt: laneT(AT.fumbleX),
    fumbleHeading: AT.fumble.heading,
    offerHeading: AT.fumble.offerHeading,
    toss: { linvel: AT.fumble.linvel, angvel: AT.fumble.angvel },
    outward: [0, 1.6, 12],
  },
};
