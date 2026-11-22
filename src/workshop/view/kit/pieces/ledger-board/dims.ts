/**
 * The ledger board's measurements (P4 D1), shared by the piece and its view: where each place a token can be is, in
 * the piece's own space (base on y = 0, centred, good side +Z). The simulation's body is `LEDGER.half` in
 * sim/scenes/bench.ts ([0.28, 0.04, 0.19]): the board's base is that footprint; the hopper, the star's post and the
 * plunger stand above the body's box.
 */

export const BOARD = {
  /** The wooden base. */
  w: 0.56,
  d: 0.38,
  h: 0.05,
  /** The cups: two rows of four (month one at the back, month two in front). */
  cupX0: -0.088,
  cupDX: 0.084,
  rowZ: [-0.05, 0.058] as const,
  cupR: 0.033,
  cupWall: 0.006,
  cupH: 0.013,
  /** A token: its radius and thickness (the metal ones), and the rubber ring's. */
  tokenR: 0.024,
  tokenT: 0.008,
  rubberR: 0.026,
  rubberT: 0.015,
  /** The hopper: a turned brass dish on a short pedestal at the left end. */
  hopperX: -0.205,
  hopperZ: -0.01,
  hopperR: 0.062,
  hopperFloor: 0.074,
  /** The gutter along the front edge (its floor's height and its line). */
  gutterZ: 0.158,
  gutterY: 0.053,
  /** The side cup at the right end, with its flip gate between it and the rows. */
  sideX: 0.226,
  sideZ: -0.032,
  sideR: 0.04,
  sideFloor: 0.054,
  gateX: 0.181,
  /** The star lamp on its post at the back, facing the visitor. */
  starX: 0.105,
  starZ: -0.158,
  starY: 0.2,
  starR: 0.045,
  /** The plunger at the right front: its knob's top at rest, and how far a press takes it down. */
  plungerX: 0.226,
  plungerZ: 0.104,
  plungerTop: 0.16,
  plungerTravel: 0.045,
  /** The crank on the hopper's front: its axle's height, its arm's reach. */
  crankY: 0.052,
  crankZ: 0.058,
  crankArm: 0.046,
} as const;

/** Where a token rests in a cup (its bottom's centre). */
export function cupAt(i: number): [number, number, number] {
  const row = Math.floor(i / 4);
  const col = i % 4;
  return [BOARD.cupX0 + col * BOARD.cupDX, BOARD.h + 0.0015, BOARD.rowZ[row]!];
}

/**
 * A little heap in the hopper's dish: where each payment lies before it is dealt (and its tilt). The rubber one lies on
 * top in the middle; the metal ones round it in an order that is not the order they are dealt in (the hopper deals
 * all of one finish before the next, whatever order they lay in).
 */
export function hopperAt(i: number, rubber: number): { p: [number, number, number]; tilt: [number, number] } {
  const order = [5, 1, 7, 3, 0, 6, 2, 4];
  const metal = order.filter((x) => x !== rubber);
  const k = i === rubber ? -1 : metal.indexOf(i);
  if (k < 0) return { p: [BOARD.hopperX + 0.004, BOARD.hopperFloor + 0.011, BOARD.hopperZ + 0.003], tilt: [0.08, -0.05] };
  const layer = k < 5 ? 0 : 1;
  const a = (k * 2.39996 + 0.4) % (Math.PI * 2);
  const rad = layer === 0 ? 0.031 : 0.03;
  const p: [number, number, number] = [BOARD.hopperX + Math.cos(a) * rad, BOARD.hopperFloor + layer * 0.006 + 0.002 * Math.sin(k * 3.1), BOARD.hopperZ + Math.sin(a) * rad];
  return { p, tilt: [Math.sin(k * 1.7) * 0.22, Math.cos(k * 2.3) * 0.22] };
}

/** The gutter: under the cup it bounced out of, at the front edge. */
export function gutterAt(i: number): [number, number, number] {
  const c = cupAt(i);
  return [c[0] + 0.012, BOARD.gutterY, BOARD.gutterZ];
}

/** The side cup. */
export const SIDE_AT: readonly [number, number, number] = [BOARD.sideX, BOARD.sideFloor, BOARD.sideZ];
