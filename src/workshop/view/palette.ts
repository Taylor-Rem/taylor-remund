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

/** sRGB hex string of a token, e.g. for canvas 2D drawing of label textures. */
export function hex(token: Token): string {
  return palette[token];
}

/** Linear-space RGB triple (0..1) of a token, for vertex colours and uniforms. */
export function linear(token: Token): [number, number, number] {
  const n = parseInt(palette[token].slice(1), 16);
  const toLinear = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return [toLinear((n >> 16) & 255), toLinear((n >> 8) & 255), toLinear(n & 255)];
}
