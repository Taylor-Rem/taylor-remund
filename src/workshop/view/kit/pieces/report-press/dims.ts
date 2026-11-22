/**
 * The report press's measurements (P4 D3, round two), shared by the piece and its view: in the piece's own space
 * before `PRESS_SCALE` (base on y = 0, centred, good side +Z). The simulation's bodies are the scaled sizes (sim
 * `PRESS`): the press's box is the wooden base and the frame's lower part; the crown, the sheets, the lever and the
 * spring arm's bed stand above and beside it. The envelope sits on the bed (`bedAt`, the simulation's `PRESS.bed`
 * once scaled and measured from the body's middle).
 *
 * The paper is one label region (`SHEETS`): every sheet's face, the blanks, the drawer's stack and both faces of the
 * envelope are rectangles of it (`UV`), so the press's paper is one draw, and a pull redraws it once.
 */

export const PRESS_DIMS = {
  /** The wooden base. */
  w: 0.42,
  d: 0.32,
  baseH: 0.036,
  /** Four cast feet the frame stands on (x, z), bolted through. */
  feet: [[-0.1, -0.1], [0.1, -0.1], [-0.1, 0.07], [0.1, 0.07]] as const,
  footH: 0.014,
  /** The frame: its cheeks' x (middle of each), thickness, front and back, the crown's underside, its height and depth. */
  cheekX: 0.105,
  cheekT: 0.024,
  frameZ0: -0.12,
  frameZ1: 0.09,
  crownY: 0.27,
  crownH: 0.045,
  crownD: 0.1,
  crownZ: -0.015,
  /** The platen block between the cheeks: where it hangs, how far a pull brings it down. */
  platenY: 0.13,
  platenDrop: 0.03,
  /** The two sheets standing out of the crown (printed left, gridded right), and their tilt back. */
  sheetW: 0.15,
  sheetH: 0.2,
  sheetX: [-0.08, 0.08] as const,
  sheetZ: -0.012,
  sheetLean: 6,
  /** The feed tray behind the crown, sloping up to the back, and its blanks (the top one a little askew). */
  trayZ: -0.175,
  trayY: 0.2,
  trayW: 0.17,
  trayD: 0.1,
  trayTilt: 22,
  blanks: 7,
  blankT: 0.0022,
  /** The lever: its pivot on the left cheek, the cast arm's length, its rest (degrees back from upright) and its pull (forward, through). */
  leverX: -0.2,
  leverY: 0.2,
  leverZ: -0.01,
  leverLen: 0.38,
  leverRest: -12,
  leverPull: 105,
  gripR: 0.028,
  gripL: 0.085,
  /** The ratchet wheel on the lever's hub (it turns with the lever, and clicks round as the printed sheet rises). */
  wheelR: 0.062,
  wheelTeeth: 16,
  /** The drawer in the base's front: its face, its depth, how far it slides out, one copy's thickness. */
  drawerW: 0.24,
  drawerH: 0.026,
  drawerD: 0.24,
  drawerOut: 0.09,
  copyT: 0.0016,
  /** The spring arm: its hinge on the right cheek (it swings about +Z), the bed's middle and size. */
  hinge: [0.118, 0.15, -0.02] as const,
  bedAt: [0.265, 0.172, -0.005] as const,
  bedW: 0.3,
  bedD: 0.2,
  /** The envelope (toy scale: big enough to read on the belt from the whole bench), matching the simulation's body. */
  envW: 0.224,
  envD: 0.144,
  envT: 0.0128,
} as const;

/** The paper's label region: its size in world units and its density (texels a unit). */
export const SHEETS = { name: 'report-press|paper2', w: 0.7, h: 0.4, tpu: 1100 } as const;

/** Where each piece of paper is on the region (u0, v0, u1, v1; v up). */
export const UV = {
  printed: [0, 0, 0.214, 0.5],
  gridded: [0.22, 0, 0.434, 0.5],
  blank: [0.44, 0, 0.52, 0.3],
  envFace: [0.53, 0, 0.85, 0.36],
  envBack: [0.53, 0.4, 0.85, 0.76],
} as const satisfies Record<string, readonly [number, number, number, number]>;

/** The gridded sheet's cells: four across, three down (`REPORT_MAX` marks). */
export const GRID = { cols: 4, rows: 3 } as const;

/**
 * The press is drawn this much bigger than `PRESS_DIMS` (one scaled node, `body`). The simulation's bodies are the
 * scaled sizes: `PRESS.half` [0.2625, 0.0875, 0.2]; `PRESS.envelopeHalf` [0.14, 0.008, 0.09]; `PRESS.bed`, the
 * envelope's middle on the bed from the body's middle, [0.33125, 0.1355, -0.00625].
 */
export const PRESS_SCALE = 1.25;

/** The colourways: the japanned enamel (and its lining) the press is shown in. 'japan' is the one to ship. */
export const COLOURWAYS = {
  japan: { enamel: 'japan-green', lining: 'japan-gold' },
  oxblood: { enamel: 'japan-oxblood', lining: 'japan-gold' },
} as const;
export type Colourway = keyof typeof COLOURWAYS;
