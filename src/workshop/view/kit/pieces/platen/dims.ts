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
  goose: { out: 0.2, drop: 0.43 },
  /** The paint tank. */
  tank: { x: 0.82, z: -0.85, r: 0.24 },
  /** The tape head, clamped to the column: the height of its ram, and how far out from the column's axis the roller meets a part at rest. */
  tapehead: { y: 1.3, reach: 0.29 },
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
