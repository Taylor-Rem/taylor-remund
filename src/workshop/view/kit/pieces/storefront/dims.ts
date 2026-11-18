/**
 * The storefront's dimensions, shared by the build, the poses, the paint and
 * the tests. Origin: the middle of the footprint on the bench (y = 0), the
 * shop front looking +Z. Everything is in world units (1 = Fetch's body).
 *
 *        cornice ─────────────────────────────── y 2.02..2.13
 *   console ┃ slat 3 ┃ fascia: four slats that      ┃ console
 *           ┃ slat 2 ┃ turn over (the words roll)   ┃
 *           ┃ slat 1 ┃                              ┃
 *           ┃ slat 0 ┃                              ┃ y 1.40
 *   ─ awning roller ───────────────────────────── y 1.34
 *   pilaster│ door (recessed) │ display window   │pilaster
 *           │                 │ OPEN sign, easel │
 *           │                 │ stallriser       │
 *   ═ step ═╧═ plinth ═══════════════════════════ y 0
 */

/** The facade plane: the face of the shop front's woodwork. Things project forward of it. */
export const F = 0.22;

export const SHOP = {
  /** Footprint and height, as the brief asks: about 2.3 × 2.1 × 0.9. */
  w: 2.3,
  d: 0.9,
  /** Back of the building. */
  back: -0.45,
  /** Plinth (a dark stone course along the bottom). */
  plinth: 0.06,
  /** Pilasters: their inner edge, depth proud of the facade, and their top (where the consoles begin). */
  pilIn: 0.975,
  pilOut: 1.15,
  pilProud: 0.07,
  pilTop: 1.37,
} as const;

/** The fascia: four slats that each turn over about their own long axis. */
export const FASCIA = {
  /** Half width of the slats (they run between the consoles, on pins). */
  hw: 0.955,
  /** Bottom and top of the fascia (slats and their gaps). */
  y0: 1.4,
  y1: 2.03,
  slats: 4,
  /** Gap between slats (a dark line, as on any turning-slat sign). */
  gap: 0.008,
  /** Slat thickness. */
  t: 0.044,
  /** The pins' plane: this far in front of the facade (clear of it when a slat stands flat). */
  z: F + 0.13,
  /** Columns of vertices across a slat face: the paint wipe's resolution. */
  cols: 28,
} as const;

/** Height of one slat. */
export const SLAT_H = (FASCIA.y1 - FASCIA.y0 - FASCIA.gap * (FASCIA.slats - 1)) / FASCIA.slats;
/** Centre height of slat i (0 is the bottom one). */
export const slatY = (i: number): number => FASCIA.y0 + SLAT_H / 2 + i * (SLAT_H + FASCIA.gap);
/** Pin depth of slat i: the fascia leans back (WORDS.leanDeg) about its middle, so the slats' faces stay one plane. */
export const slatZ = (i: number): number => FASCIA.z - (slatY(i) - (FASCIA.y0 + FASCIA.y1) / 2) * Math.tan((WORDS.leanDeg * Math.PI) / 180);

/** The words area on the fascia's face, and its margins (world units). */
export const WORDS = {
  w: FASCIA.hw * 2,
  h: FASCIA.y1 - FASCIA.y0,
  /** Side and top/bottom margins the painter keeps clear. */
  side: 0.05,
  vert: 0.028,
  /**
   * The fascia leans this many degrees toward the visitor (its pins are in the consoles, the
   * consoles lean with it); it shortens the capitals less at the default view.
   */
  leanDeg: 15,
} as const;

/** The awning: a roller under the fascia, two drop arms, a striped canvas, a scalloped valance. */
export const AWNING = {
  hw: 0.94,
  /** The roller's axis. */
  rollerY: 1.335,
  rollerZ: F + 0.055,
  rollerR: 0.034,
  /** Arm pivots (on the pilasters' inner faces), arm length, and the extended angle from straight up. */
  pivotY: 1.335 - 0.4,
  pivotZ: F + 0.035,
  arm: 0.4,
  outDeg: 54,
  /** Stripes across the canvas (an odd number: colour at both edges). */
  stripes: 11,
  /** The valance's drop below the front bar. */
  valance: 0.085,
  /** Crank turns from rolled up to fully out. */
  turns: 3.5,
} as const;

/** The door: recessed into the front, with a step. */
export const DOOR = {
  x0: -0.94,
  x1: -0.43,
  y0: 0.075,
  y1: 1.25,
  /** How far it is set back from the facade. */
  recess: 0.15,
} as const;

/** The display window. */
export const WINDOW = {
  x0: -0.34,
  x1: 0.94,
  /** Sill (the top of the stallriser) and the head (hidden under the awning). */
  y0: 0.33,
  y1: 1.25,
  /** Depth of the display: the back partition is this far behind the facade (the picture's drum needs it). */
  depth: 0.62,
} as const;

/** The OPEN/CLOSED sign hanging in the window: its pivot (the hook it spins on) and card size. */
export const OPEN_SIGN = {
  x: 0.05,
  y: 0.86,
  z: F - 0.075,
  w: 0.56,
  h: 0.25,
  /** Drop from the hook to the card's top. */
  drop: 0.07,
} as const;

/** The picture in the window: a deep frame on an easel, a six-sided drum behind its opening (five pictures and a blank). */
export const PICTURE = {
  x: 0.64,
  /** The opening's centre height (the drum's axis), and its size: a drum face is h tall. */
  y: 0.66,
  w: 0.4,
  h: 0.28,
  /** Drum axis depth; the frame's face. */
  z: F - 0.065 - 0.28 * Math.cos(Math.PI / 6),
  faceZ: F - 0.035,
  faces: 6,
} as const;

/** The junction box beside the door: its STOREFRONT jack plate, jack and station lamp. */
export const JACKBOX = {
  x: -1.36,
  z: F + 0.08,
  w: 0.36,
  h: 0.42,
  d: 0.22,
} as const;

/** Every node a view may move or recolour. */
export const NODES = {
  slat: (i: number): string => `sign.slat${i}`,
  brush: 'sign.brush',
  awning: 'awning',
  awningColour: 'awning.colour',
  valance: 'awning.valance',
  valanceColour: 'awning.valance.colour',
  armL: 'awning.arm.l',
  armR: 'awning.arm.r',
  crank: 'awning.crank',
  openSign: 'opensign',
  windowLit: 'window.lit',
  windowUnlit: 'window.unlit',
  drum: 'picture.drum',
  lampLit: 'lamp.lit',
  lampUnlit: 'lamp.unlit',
} as const;

/** The paint a new storefront wears. */
export const DEFAULTS = {
  fascia: 'paint-green',
  awning: 'cable-red',
} as const;
