/**
 * The report press's measurements (P4 D3), shared by the piece and its view: in the piece's own space (base on y = 0,
 * centred, good side +Z). The simulation's body is `PRESS.half` in sim/scenes/bench.ts ([0.21, 0.07, 0.16]): the
 * wooden base and the iron are that footprint; the holders, the lever and the spring arm's bed stand above the box.
 * The envelope's body is `PRESS.envelopeHalf` ([0.07, 0.005, 0.045]), and it sits on the bed at `PRESS.bed` from the
 * body's middle ([0.15, 0.058, 0.03]: its middle at y 0.128 here).
 *
 * The paper is one label region (`SHEETS`): every sheet's face, the blanks, the drawer's stack and both faces of the
 * envelope are rectangles of it (`UV`), so the press's paper is one draw, and a pull redraws it once.
 */

export const PRESS_DIMS = {
  /** The wooden base. */
  w: 0.42,
  d: 0.32,
  baseH: 0.036,
  /** The iron frame in the middle: its cheeks' x, their thickness, the frame's front and back, the crosshead's top. */
  cheekX: 0.07,
  cheekT: 0.016,
  frameZ0: -0.1,
  frameZ1: 0.075,
  crossY: 0.168,
  crossH: 0.03,
  crossD: 0.064,
  crossZ: -0.012,
  /** The two sheets standing in their holders on the crosshead (printed left, gridded right), and their tilt back. */
  sheetW: 0.096,
  sheetH: 0.13,
  sheetX: [-0.052, 0.052] as const,
  sheetZ: -0.014,
  sheetLean: 7,
  /** The feed tray at the back left, sloping up to the back, and its stack of blanks. */
  trayX: -0.155,
  trayZ: -0.05,
  trayW: 0.1,
  trayD: 0.13,
  trayY: 0.062,
  trayTilt: 12,
  blanks: 6,
  blankT: 0.0022,
  /** The lever: its pivot on the left cheek, its arm's length, its rest angle (from straight up, toward the front) and its travel. */
  leverX: -0.092,
  leverY: 0.128,
  leverZ: 0.02,
  leverLen: 0.2,
  leverRest: 28,
  leverPull: 74,
  knobR: 0.024,
  /** The drawer in the base's front: its face, its depth, how far it slides out, its stack's sheet. */
  drawerW: 0.16,
  drawerH: 0.024,
  drawerD: 0.2,
  drawerOut: 0.075,
  copyT: 0.0016,
  /** The spring arm on the right: its hinge at the back, the bed's top and middle. */
  armX: 0.15,
  armHingeZ: -0.1,
  armHingeY: 0.07,
  bedY: 0.123,
  bedZ: 0.03,
  bedW: 0.15,
  bedD: 0.1,
  /** The envelope on its bed (matches the simulation's body). */
  envW: 0.14,
  envD: 0.09,
  envT: 0.01,
} as const;

/** The paper's label region: its size in world units and its density (texels a unit). */
export const SHEETS = { name: 'report-press|paper', w: 0.5, h: 0.2, tpu: 1100 } as const;

/** Where each piece of paper is on the region (u0, v0, u1, v1; v up). */
export const UV = {
  printed: [0, 0, 0.192, 0.65],
  gridded: [0.2, 0, 0.392, 0.65],
  blank: [0.4, 0, 0.5, 0.3],
  envFace: [0.52, 0, 0.8, 0.45],
  envBack: [0.52, 0.5, 0.8, 0.95],
} as const satisfies Record<string, readonly [number, number, number, number]>;

/** The gridded sheet's cells: four across, three down (`REPORT_MAX` marks). */
export const GRID = { cols: 4, rows: 3 } as const;

/**
 * The press is drawn this much bigger than `PRESS_DIMS` (its measurements stay as they were drawn up; the piece wraps
 * them in one scaled node, `body`). The simulation's bodies are the scaled sizes: `PRESS.half` [0.2625, 0.0875, 0.2],
 * `PRESS.envelopeHalf` [0.0875, 0.00625, 0.05625], `PRESS.bed` [0.1875, 0.0725, 0.0375].
 */
export const PRESS_SCALE = 1.25;
