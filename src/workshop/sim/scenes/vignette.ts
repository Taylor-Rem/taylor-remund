/**
 * The vignette (REWRITE.md § G "P1"): the centre cluster of the bench.
 * Data only. Every position is a placeholder in ONE table (`AT`) for the
 * layout to tune; everything else is derived from it.
 *
 * Conventions (art-direction § 2): 1 unit = Fetch's body height; bench top
 * is y = 0; +X to the visitor's right; +Z toward the visitor; the back wall
 * stands at z = -5. Poses are body centres.
 */
import type { Pose, Vec3 } from '../types.ts';
import type { SceneDesc } from '../scene.ts';
import { CRATE_EDGE } from '../parts.ts';
import { qyaw } from '../math.ts';

/** The layout table. Tune here. */
export const AT = {
  bench: { minX: -10, maxX: 10, minZ: -5, maxZ: 5 },
  /** The crate stack: ground position of its bottom crate. */
  stack: [-2.7, 0.7] as const,
  /** The Big Red Button's pedestal: ground centre, footprint half size, height. */
  button: { x: 0, z: 1.9, half: 0.42, height: 0.62 },
  /** Fetch's lane of yellow tape, on the ground. */
  lane: { a: [-1.1, 0.55] as const, b: [3.2, 0.55] as const },
  /** The switchboard at the back, and its two jacks. */
  board: { x: -0.5, z: -4.35, halfW: 0.95, height: 1.7, depth: 0.6 },
  jacks: { storefront: [-0.95, 1.15, -4.02] as Vec3, lamp: [-0.05, 1.15, -4.02] as Vec3 },
  /** A length of belt along the front (static in P1). */
  belt: { x: 2.6, z: 3.7, halfL: 3.4, halfW: 0.42, height: 0.36 },
  /** The return chute's mouth, front left, and how parts come out of it. */
  chute: { p: [-8.7, 0.45, 3.4] as Vec3, linvel: [2.4, 0.6, -0.7] as Vec3 },
} as const;

const e = CRATE_EDGE;
const [sx, sz] = AT.stack;
const pose = (p: Vec3, yaw = 0): Pose => ({ p, q: qyaw(yaw) });

/** Fetch's start (lane parameter) and its hands' crate (the loose one, which it fumbles). */
const FETCH_START = 0.8;
const lanePoint = (t: number): [number, number] => [AT.lane.a[0] + (AT.lane.b[0] - AT.lane.a[0]) * t, AT.lane.a[1] + (AT.lane.b[1] - AT.lane.a[1]) * t];

export const vignette: SceneDesc = {
  id: 'vignette',
  gravity: -16,
  bench: { ...AT.bench, top: 0, ceiling: 8 },
  fallY: -1.2,
  statics: [
    { id: 'bench', shape: { type: 'box', half: [10, 0.5, 5], radius: 0 }, pose: pose([0, -0.5, 0]), friction: 0.75, restitution: 0.12 },
    { id: 'back-wall', shape: { type: 'box', half: [10, 3, 0.15], radius: 0 }, pose: pose([0, 3, -5.15]) },
    {
      id: 'button-pedestal',
      shape: { type: 'box', half: [AT.button.half, AT.button.height / 2, AT.button.half] },
      pose: pose([AT.button.x, AT.button.height / 2, AT.button.z]),
    },
    {
      id: 'board',
      shape: { type: 'box', half: [AT.board.halfW, AT.board.height / 2, AT.board.depth / 2] },
      pose: pose([AT.board.x, AT.board.height / 2, AT.board.z]),
    },
    {
      id: 'belt-bed',
      shape: { type: 'box', half: [AT.belt.halfL, AT.belt.height / 2, AT.belt.halfW] },
      pose: pose([AT.belt.x, AT.belt.height / 2, AT.belt.z]),
      friction: 0.9,
    },
  ],
  parts: [
    // the stack: large at the bottom, then medium, then small, each a little off true
    { id: 'crate-1', kind: 'crate', size: 'L', material: 'wood', colour: 'paper', label: '', station: 'line', name: 'name.crate', pose: pose([sx, e.L / 2, sz], 0.04) },
    { id: 'crate-2', kind: 'crate', size: 'M', material: 'wood', colour: 'paper', label: '', station: 'line', name: 'name.crate', pose: pose([sx + 0.04, e.L + e.M / 2, sz - 0.03], -0.09) },
    { id: 'crate-3', kind: 'crate', size: 'S', material: 'wood', colour: 'paper', label: '', station: 'line', name: 'name.crate', pose: pose([sx - 0.03, e.L + e.M + e.S / 2, sz + 0.02], 0.13) },
    // the loose crate, in Fetch's hands at the start (placed there by Fetch on the first step)
    { id: 'crate-4', kind: 'crate', size: 'S', material: 'wood', colour: 'paper', label: '', station: 'button', name: 'name.crate', pose: pose([1.0, e.S / 2, 0.9]) },
    // Fetch is a part too (kind robot): it can be picked up like anything loose
    { id: 'fetch', kind: 'robot', size: 'M', material: 'metal', colour: 'tape-yellow', label: '', station: 'line', name: 'name.fetch', pose: pose([lanePoint(FETCH_START)[0], 0.5, lanePoint(FETCH_START)[1]], Math.PI / 2), mass: 0.9 },
  ],
  fixtures: [
    { id: 'lamp', station: 'top', name: 'name.lamp', affordances: [] },
    { id: 'belt', station: 'line', name: 'name.belt', affordances: [] },
  ],
  chute: { pose: pose(AT.chute.p), linvel: AT.chute.linvel, delay: 1.4 },
  button: {
    id: 'button',
    name: 'name.button',
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
    lane: { a: AT.lane.a, b: AT.lane.b },
    start: FETCH_START,
    carrying: 'crate-4',
    fumbleAt: (AT.button.x - AT.lane.a[0]) / (AT.lane.b[0] - AT.lane.a[0]),
    toss: { linvel: [1.5, 2.4, 2.4], angvel: [5, 0, -2] },
    outward: [0, 1.6, 12],
  },
};
