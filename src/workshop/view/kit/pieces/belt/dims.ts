/**
 * The belt's fixed dimensions (world units; see kit/types.ts conventions).
 * The view, the simulation's colliders and the crates read these.
 */
export const BELT = {
  /** Height of the carrying surface (the top face of the belt). Crates ride here. */
  topY: 0.5,
  /** Belt width across Z (centred on z = 0). Crates are up to 0.8 wide. */
  width: 0.92,
  /** Belt thickness. */
  thickness: 0.03,
  /** End drum radius (to the drum's surface, under the belt). */
  drumR: 0.1,
  /** |z| of the rails' inner faces (the webs face the belt). */
  railIn: 0.5,
  /** Rail channel: depth of each flange out from the web's inner face, web thickness, flange thickness. */
  railDepth: 0.12,
  railWeb: 0.04,
  railFlange: 0.046,
  /** Rail top and bottom heights. The top stands a little proud of the belt: a side guide. */
  railTop: 0.548,
  railBottom: 0.24,
  /** The default overall length (belt end to belt end). */
  defaultLength: 6,
  /** Most distance between legs. */
  legPitch: 3.2,
  /** Width of the motor housing at the left end (X), and its gap to the belt's end. */
  motorW: 0.98,
  motorGap: 0.06,
} as const;

/**
 * The way off the motor end (option `deflector`), measured from the belt's
 * left end (x = -length/2) in the belt's space. Running backward, a part
 * rides into the curved deflector, slides along its brass rub strip toward
 * the back, through the gap in the far rail and down the slide onto the
 * bench behind the belt.
 */
export const DEFLECT = {
  /** Length of the gap in the far rail from the belt's left end (the slide is as wide). */
  gap: 1.0,
  /** The deflector's plan curve (x from the belt end, z): a quadratic from the near rail to the far edge. */
  p0: [0.95, 0.47],
  c: [0.3, 0.3],
  p1: [0.07, -0.47],
  /** Its plate: thickness, bottom (a hair over the belt) and top. */
  t: 0.024,
  y0: 0.512,
  y1: 0.68,
  /** The slide: from under the belt's far edge down to the bench. */
  slideTop: [-0.47, 0.485],
  slideFoot: [-1.02, 0.07],
  /** Where a part that went off the back comes to rest (x from the belt end, z). */
  rest: [0.5, -1.32],
} as const;
