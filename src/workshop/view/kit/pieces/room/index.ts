/**
 * The room round the bench (V; REWRITE.md § A "A workbench, not a room" and
 * "The dark has something in it"; ART-P2 § 5): the floor far below, the dim
 * shapes past each end, and the two reserved bays on the bench top. The
 * bench's own structure (legs, braces) is `bench-frame` in ../bench/, the
 * wall's run past the ends is `back-wall`'s options, the window is
 * ../window/. `ROOM` holds the numbers the bench page places them by.
 */
import type { CatalogueEntry } from '../../catalogue.ts';
import type { KitOptions } from '../../types.ts';
import { floor } from './floor.ts';
import { roomEnd } from './dressing.ts';
import { bayLabels, reservedBay, type BayLabelRef, type BayName } from './bay.ts';
import { FLOOR_Y } from '../bench/frame.ts';
import { WINDOW, windowHole } from '../window/index.ts';

export { floor, FLOOR_SHADE } from './floor.ts';
export { roomEnd, DIM } from './dressing.ts';
export { reservedBay, bayLabels, bayStrips, estimateBayLabels, BAY_CAP, type BayName, type BayLabelRef } from './bay.ts';
export { FLOOR_Y };

/**
 * Where the room's pieces go for the 18 × 10 bench (x -9..9, z -5..5, wall face
 * at z = -5, top at y = 0). Every origin is the piece's own (see each file).
 */
export const ROOM = {
  bench: { sections: 3, width: 6, depth: 10 },
  /** The floor's height. */
  floorY: FLOOR_Y,
  /**
   * The floor piece: placed at (0, floorY, 0). Only as wide as the room fall-off leaves anything
   * visible (|x| < 13.4) and only as deep as can be seen: under the bench between the legs and past
   * its ends; the camera never looks at the floor in front of the bench.
   */
  floor: { width: 27, z0: -5, z1: 4.5 },
  /** The window's origin on the wall face (bottom middle of the opening). */
  window: { x: 7.0, y: 2.0, z: -5 },
  /** The back wall: placed at (0, 0, -5). 27 wide: past |x| 13.4 the room fall-off has taken everything. */
  wall: { width: 27, height: 12, base: FLOOR_Y, skirting: { x0: -9, x1: 9 }, fade: { from: 9.5, to: 16, amount: 0.5 } },
  /** The dim shapes past the ends: origins where the bench's ends meet the wall. */
  ends: { left: { x: -9, y: 0, z: -5 }, right: { x: 9, y: 0, z: -5 } },
  /**
   * The reserved bays: centres on the bench top, sizes, which words. Both in the left third, one behind
   * the other (the blockout's placing, P2): plain RESERVED behind, 3.0 x 1.8; INSPECTION in front, 3.6 x 2.0.
   */
  bays: [
    { which: 'next' as BayName, x: -6.7, z: -2.55, w: 3.0, d: 1.8 },
    { which: 'inspection' as BayName, x: -6.5, z: -0.35, w: 3.6, d: 2.0 },
  ],
} as const;

/** The wall options for the bench with its window cut. */
export function roomWall(): { width: number; height: number; base: number; skirting: { x0: number; x1: number }; fade: { from: number; to: number; amount: number }; openings: ReturnType<typeof windowHole>[] } {
  const w = ROOM.wall;
  return { width: w.width, height: w.height, base: w.base, skirting: { ...w.skirting }, fade: { ...w.fade }, openings: [windowHole(ROOM.window.x, ROOM.window.y)] };
}

const kit = (opts: Record<string, unknown>): KitOptions => ({
  ...(typeof opts['seed'] === 'number' ? { seed: opts['seed'] } : {}),
  ...(opts['detail'] === 'low' || opts['detail'] === 'high' ? { detail: opts['detail'] } : {}),
});
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const isBay = (v: unknown): v is BayName => v === 'inspection' || v === 'next';

export const catalogue: CatalogueEntry[] = [
  {
    name: 'floor',
    build: (opts = {}) => floor({ ...kit(opts), width: num(opts['width'], ROOM.floor.width), z0: num(opts['z0'], ROOM.floor.z0), z1: num(opts['z1'], ROOM.floor.z1) }),
    variants: { floor: {}, low: { detail: 'low' } },
    camera: { distance: 30 },
    note: `The floor far below the bench: dark boards along X. Top at y = 0 in its own space; place it at y = ${FLOOR_Y}.`,
  },
  {
    name: 'room-left',
    build: (opts = {}) => roomEnd({ ...kit(opts), side: 'left', floor: num(opts['floor'], FLOOR_Y) }),
    variants: { left: {} },
    camera: { distance: 14 },
    note: 'Past the bench\'s left end: steel shelving with plain boxes and tins, a hanging cable. Origin: the bench end at the wall face, bench-top height.',
  },
  {
    name: 'room-right',
    build: (opts = {}) => roomEnd({ ...kit(opts), side: 'right', floor: num(opts['floor'], FLOOR_Y) }),
    variants: { right: {} },
    camera: { distance: 14 },
    note: 'Past the bench\'s right end: a painted pipe run with a junction box, a stool on the floor. Origin: the bench end at the wall face, bench-top height.',
  },
  {
    name: 'reserved-bay',
    build: (opts = {}) => {
      const labels = Array.isArray(opts['labels']) ? (opts['labels'] as BayLabelRef[]) : undefined;
      return reservedBay({ ...kit(opts), which: isBay(opts['which']) ? opts['which'] : 'inspection', w: num(opts['w'], 3.6), d: num(opts['d'], 2.2), ...(labels ? { labels } : {}) });
    },
    labels: (labels, opts) => ({ labels: bayLabels(labels, isBay(opts['which']) ? opts['which'] : 'inspection') }),
    variants: { inspection: { which: 'inspection' }, next: { which: 'next' } },
    camera: { distance: 8 },
    note: 'A reserved bay: worn tape rectangle on the bench top with label tape (words from src/content/room.json). Origin: its centre.',
  },
];

export { WINDOW };
