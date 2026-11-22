/**
 * The palette. The ONLY file in the workshop where a colour literal may
 * appear (scripts/check-look.ts enforces it). REWRITE.md § A: starting
 * values; gate G1 fixes them, and after G1 a material uses no other colour.
 *
 * Everything else derives colour from these tokens in code (mix, darken,
 * offset), never by typing a new literal.
 */

/** The fourteen tokens of REWRITE.md § A, by their names in the spec. */
export const palette = {
  'teal-deep': '#12292c', // the room beyond the bench, deepest shadow
  'teal-panel': '#1f4a4f', // machine bodies, the switchboard
  'teal-light': '#3a7c7a', // machine highlights, trim
  amber: '#f2a93b', // the lamp, lit indicators
  'amber-glow': '#ffd27a', // bulbs, the only things that glow
  brass: '#b08d4a', // plates, hatches, fittings, jacks
  wood: '#6b4a2f', // the bench top, crates (darker)
  'wood-light': '#a67c52', // crates, pallets, pegboard
  paper: '#efe6d2', // cards, labels' text, the paperwork pages
  ink: '#1a1c1e', // text, rubber, the belt
  'cable-red': '#8f2f2a', // the patch cord
  'button-red': '#d6322b', // the Button and nothing else
  'tape-yellow': '#e3b21c', // lane tape on the bench
  steel: '#7d8790', // rollers, rails, tools

  // PROVISIONAL, proposed for G1. § B1 gives every part one of "the 8 paint
  // colours" and has Patch paint things blue, but § A's table names no blue,
  // green, orange or violet. These four complete the paint set below in the
  // same scuffed-enamel family. They are for paint on parts and tools only.
  'paint-orange': '#c2622d',
  'paint-green': '#5d8a4e',
  'paint-blue': '#3d6c9e',
  'paint-violet': '#6b5290',

  // PROPOSED (P4 D3), for Taylor's eye: the report press's japanned enamel (a black-green, as a sewing machine's
  // stand), its gold lining, and the one alternative colourway (oxblood). For the press only; never paint for parts.
  'japan-green': '#1c2b24',
  'japan-gold': '#c8a24f',
  'japan-oxblood': '#4a1e1b',
} as const;

export type Token = keyof typeof palette;

/** The 8 paint colours a part can be (§ B1 "colour"). Never `button-red`, never `amber`. */
export const paints = [
  'cable-red',
  'paint-orange',
  'tape-yellow',
  'paint-green',
  'teal-light',
  'paint-blue',
  'paint-violet',
  'paper',
] as const satisfies readonly Token[];

export type Paint = (typeof paints)[number];

/**
 * PROPOSED (D2), for Taylor's choice; not part of the approved look. The paint schemes' colours
 * (view/materials/scheme.ts): what the enamel tokens become when a visitor turns the paint dial. Scheme A
 * is the approved palette above and has no entries here. Working letters only; a name a visitor could
 * read is the owner's.
 */
export const schemeColours = {
  // B: wine enamel, cream trim (leans away from the Button's orange-red, so the Button stays the reddest thing)
  'scheme-b-enamel': '#4a2232',
  'scheme-b-trim': '#c9b68f',
  'scheme-b-deep': '#24111a',
  // C: putty enamel, bottle-green trim (a light scheme kept dark enough that the lamp does not wash it white)
  'scheme-c-enamel': '#867b60',
  'scheme-c-trim': '#2f4a3b',
  'scheme-c-deep': '#1f2c24',
  // D: graphite enamel, grey trim, the hazard in safety orange
  'scheme-d-enamel': '#3a3f43',
  'scheme-d-trim': '#6b7176',
  'scheme-d-deep': '#1c1f21',
  'scheme-d-accent': '#d0662a',
} as const;

export type SchemeColour = keyof typeof schemeColours;

/** sRGB hex string of a token, e.g. for canvas 2D drawing of label textures. */
export function hex(token: Token): string {
  return palette[token];
}

/** Linear-space RGB triple (0..1) of a token, for vertex colours and uniforms. */
export function linear(token: Token): [number, number, number] {
  return linearHex(palette[token]);
}

/** Linear-space RGB triple of a scheme colour. */
export function linearScheme(c: SchemeColour): [number, number, number] {
  return linearHex(schemeColours[c]);
}

function linearHex(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  const toLinear = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return [toLinear((n >> 16) & 255), toLinear((n >> 8) & 255), toLinear(n & 255)];
}
