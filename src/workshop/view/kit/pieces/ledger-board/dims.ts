/**
 * The ledger board's measurements (P4 D1), shared by the piece and its view: where each place a token can be is, in
 * the piece's own space (base on y = 0, centred, good side +Z). The simulation's body is `LEDGER.half` in
 * sim/scenes/bench.ts ([0.38, 0.04, 0.215]): the board's base is that footprint, as large as the large crate's tray
 * allows (the crate is 0.80 across; the tray puts the board's middle 0.155 in front of the crate's, so 0.43 deep is
 * as deep as it can be without overhanging the crate's front). The hopper, the flag and the plunger stand above it.
 */

export const BOARD = {
  /** The wooden base. */
  w: 0.76,
  d: 0.43,
  h: 0.05,
  /** The cups: two rows of four (month one at the back, month two in front). */
  cupX0: -0.165,
  cupDX: 0.105,
  rowZ: [-0.068, 0.062] as const,
  cupR: 0.043,
  cupWall: 0.007,
  cupH: 0.014,
  /** A metal token: its radius and thickness. The rubber one: a fat ring, wider and twice as thick. */
  tokenR: 0.032,
  tokenT: 0.009,
  rubberR: 0.035,
  rubberT: 0.022,
  /** The hopper: a turned brass dish on a short pedestal at the left end. */
  hopperX: -0.29,
  hopperZ: -0.02,
  hopperR: 0.072,
  hopperFloor: 0.08,
  /** The gutter along the front edge (its floor's height and its line). */
  gutterZ: 0.176,
  gutterY: 0.053,
  /** The side cup at the right end, with its flip gate between it and the rows. */
  sideX: 0.3,
  sideZ: -0.045,
  sideR: 0.05,
  sideFloor: 0.054,
  gateX: 0.236,
  /**
   * The flag: a red star on a sprung brass arm, hinged at the board's back right corner on an axle running front to
   * back, like a taxi's flag. Down (the allocations add up) the arm lies level, pointing out past the board's right
   * end, the star low on its side; up (they do not) the arm stands straight and the star is high over the board. Both
   * ways it faces the visitor, and down it covers nothing behind the board (the crate's card stands there).
   */
  flagX: 0.35,
  flagY: 0.112,
  flagZ: -0.17,
  flagArm: 0.17,
  starR: 0.058,
  /** The plunger at the right front: a T-handle; its top at rest, and how far a press takes it down. */
  plungerX: 0.3,
  plungerZ: 0.115,
  plungerTop: 0.175,
  plungerTravel: 0.05,
  /** The crank on the hopper's front: its axle's height, its arm's reach. */
  crankY: 0.06,
  crankZ: 0.07,
  crankArm: 0.075,
} as const;

/** Where a token rests in a cup (its bottom's centre). */
export function cupAt(i: number): [number, number, number] {
  const row = Math.floor(i / 4);
  const col = i % 4;
  return [BOARD.cupX0 + col * BOARD.cupDX, BOARD.h + 0.0015, BOARD.rowZ[row]!];
}

/**
 * A little heap in the hopper's dish: where each payment lies before it is dealt (and its tilt), by its place in the
 * deal, in an order that is not the order they are dealt in (the hopper deals all of one finish before the next,
 * whatever order they lay in). The same spot whichever payment is the rubber one, so a new deal moving the rubber
 * ring to another payment moves nothing else in the heap.
 */
export function hopperAt(i: number): { p: [number, number, number]; tilt: [number, number] } {
  const order = [5, 1, 7, 3, 0, 6, 2, 4];
  const k = order.indexOf(i);
  const layer = k < 5 ? 0 : 1;
  const a = (k * 2.39996 + 0.4) % (Math.PI * 2);
  const rad = layer === 0 ? 0.036 : k === 7 ? 0.004 : 0.026;
  const p: [number, number, number] = [BOARD.hopperX + Math.cos(a) * rad, BOARD.hopperFloor + layer * 0.008 + 0.002 * Math.sin(k * 3.1), BOARD.hopperZ + Math.sin(a) * rad];
  return { p, tilt: [Math.sin(k * 1.7) * 0.2, Math.cos(k * 2.3) * 0.2] };
}

/** The gutter: in front of the cup it bounced out of, at the front edge. */
export function gutterAt(i: number): [number, number, number] {
  const c = cupAt(i);
  return [c[0] + 0.014, BOARD.gutterY, BOARD.gutterZ];
}

/** The side cup. */
export const SIDE_AT: readonly [number, number, number] = [BOARD.sideX, BOARD.sideFloor, BOARD.sideZ];
