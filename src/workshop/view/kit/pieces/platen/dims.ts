/**
 * The platen's layout, shared by the build, the pose helper, the tests and
 * the view. Origin: the bench under the middle of the base; +Z toward the
 * visitor. All in world units (1 = Fetch's P1 body height).
 */
const TRAY = { x: 0.05, z: -0.1, r: 0.49, dishR: 0.53, seatY: 0.12 } as const;
const PLINTH = { r: 0.52, foot: 0.59 } as const;

export const PLATEN = {
  /**
   * The console (the body right of the turntable): its x extent, its front slope's foot and top (z), its
   * back, the flange top, the body's foot, the deck (the plinth's top too).
   */
  console: { x0: 0.4, x1: 2.12 },
  zFrontFoot: 0.42,
  zFrontTop: 0.14,
  zBack: -1.2,
  flangeY: 0.08,
  bodyY: 0.1,
  deckY: 0.5,
  /** The turntable: centre on the deck, platter radius, the drip dish round it, the seat's height above the deck. Seats an L crate (0.8 x 0.74) or Fetch on its wheel at 1.5x. */
  tray: TRAY,
  /** The turntable's round plinth: its body radius and its cast foot's radius (the foot is where a wheel can stand), about the seat. */
  plinth: PLINTH,
  /** The arm's column (x, z) and the pivot's height: right of the tray on the console's deck, level with it, so over the tray the beam runs across the visitor's view. */
  pillar: { x: 0.95, z: -0.1 },
  pivotY: 2.8,
  /** How far the beam runs past the pivot (it carries the tape head out past the nozzle, over the far half of the part). */
  beamEnd: 1.42,
  /** The gooseneck, from its root on the beam: how far it reaches on, and how far below the pivot its mouth hangs. */
  goose: { out: 0.12, drop: 0.45 },
  /** The paint tank, at the back of the console; the parked nozzle hangs over its filler cap. */
  tank: { x: 1.44, z: -0.86, r: 0.24 },
  /** Where the parked nozzle hangs: over the tank (the arm parks pointing back). */
  park: { x: 1.44, z: -0.86 },
  /**
   * The tape head on the arm (arm frame: +X along the beam from the pivot): where its carriage runs
   * (start, end; it runs inward, which over the tray is left to right), how far ahead of the carriage and
   * how far out to the side its roller rides (-Z: the visitor's side when the arm is over the tray), and how
   * far below the beam the roller's bottom hangs with the ram up.
   */
  labelHead: { start: 1.32, end: 0.92, out: 0, z: -0.33, hang: 0.45 },
  /** The label strip on an L crate (tray frame from the seat): from x0 to x1, centred at height y, its face at z. The L crate's top front batten. */
  label: { x0: -0.42, x1: -0.02, y: 0.643, z: 0.372, h: 0.072 },
  /** The PLATEN plate's centre on the console's slope (x). */
  plateX: 1.19,
  /**
   * Where a porter stands to reach the seat (piece space, on the bench, [x, z]): its centre 0.40 outside the
   * plinth's foot, opposite the seat, on the open LEFT (the bench's taped run) and the open FRONT.
   */
  stand: {
    left: [TRAY.x - PLINTH.foot - 0.4, TRAY.z] as const,
    front: [TRAY.x, TRAY.z + PLINTH.foot + 0.4] as const,
  },
} as const;



/** The arm's reach, pivot to nozzle tip, in plan: the same parked and over the tray. */
export const REACH = Math.hypot(PLATEN.tray.x - PLATEN.pillar.x, PLATEN.tray.z - PLATEN.pillar.z);

/** Pivot to the gooseneck's root (the nozzle node), along the beam. */
export const BEAM = REACH - PLATEN.goose.out;

/** Yaw about +Y that points the beam's +X from the pivot at (x, z). */
export const yawTo = (x: number, z: number): number => Math.atan2(-(z - PLATEN.pillar.z), x - PLATEN.pillar.x);

/** The arm's yaw parked (over the drip pot) and over the tray. */
export const YAW_IDLE = yawTo(PLATEN.park.x, PLATEN.park.z);
export const YAW_OVER = yawTo(PLATEN.tray.x, PLATEN.tray.z);
