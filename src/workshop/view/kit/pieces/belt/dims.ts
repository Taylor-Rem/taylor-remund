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
