/**
 * The platen's layout, shared by the build, the pose helper, the tests and
 * the view. Origin: the bench under the middle of the base; +Z toward the
 * visitor. All in world units (1 = Fetch's P1 body height).
 */
export const PLATEN = {
  /** The base: width, the front slope's foot and top (z), the back, the flange top, the body's foot, the deck. */
  w: 2.4,
  zFrontFoot: 0.86,
  zFrontTop: 0.58,
  zBack: -1.15,
  flangeY: 0.08,
  bodyY: 0.1,
  deckY: 0.5,
  /** The turntable: centre on the deck, platter radius, the drip dish round it, the seat's height above the deck. */
  tray: { x: 0.05, z: -0.1, r: 0.675, dishR: 0.73, seatY: 0.12 },
  /** The arm's column (x, z) and the pivot's height. */
  pillar: { x: -0.98, z: -0.1 },
  pivotY: 2.8,
  /** The gooseneck, from the beam's end: how far it reaches on, and how far below the pivot its tip hangs. */
  goose: { out: 0.12, drop: 0.45 },
  /** The paint tank. */
  tank: { x: 0.82, z: -0.85, r: 0.24 },
  /**
   * The tape head on the arm, beside the nozzle (arm frame: +X along the beam): where its carriage runs
   * (start, end), how far ahead of the carriage and how far out to the front its roller rides, and how far
   * below the beam the roller's bottom hangs with the ram up.
   */
  labelHead: { start: 0.41, end: 0.81, out: 0.2, z: 0.33, hang: 0.45 },
  /** The label strip on an L crate (tray frame from the seat): from x0 to x1, centred at height y, its face at z. The L crate's top front batten. */
  label: { x0: -0.42, x1: -0.02, y: 0.643, z: 0.372, h: 0.072 },
  /** Where the parked nozzle hangs: over the back of the deck, behind the tray (the arm parks pointing back). */
  park: { x: -0.462, z: -0.99 },
} as const;

/** The arm's reach, pivot to nozzle tip, in plan: the same parked and over the tray. */
export const REACH = Math.hypot(PLATEN.tray.x - PLATEN.pillar.x, PLATEN.tray.z - PLATEN.pillar.z);

/** The beam's length, pivot to the gooseneck's root. */
export const BEAM = REACH - PLATEN.goose.out;

/** Yaw about +Y that points the beam's +X from the pivot at (x, z). */
export const yawTo = (x: number, z: number): number => Math.atan2(-(z - PLATEN.pillar.z), x - PLATEN.pillar.x);

/** The arm's yaw parked (over the drip pot) and over the tray. */
export const YAW_IDLE = yawTo(PLATEN.park.x, PLATEN.park.z);
export const YAW_OVER = yawTo(PLATEN.tray.x, PLATEN.tray.z);
