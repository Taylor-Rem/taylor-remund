/**
 * The storefront's one texture: where everything sits in it (pure; runs in
 * Node). One texture, so every printed or painted thing on the shop draws
 * in one mesh. uv rects are [u0, v0, u1, v1], v up (row 0 of the painted
 * canvas is v = 1); the painter works in fractions of whatever size the
 * slot turned out to be.
 *
 *  v 1.00 ┌──────────────── WORDS face A ────────────────┐
 *  v 0.75 ├──────────────── WORDS face B ────────────────┤
 *  v 0.50 ├ mountains ┬ sun ┬ boat ──┬ OPEN ─────────────┤
 *         ├ tree ─────┼ house ┼ none ┼ CLOSED ───────────┤
 *         │           │       │      ├ STOREFRONT plate ─┤
 *  v 0.00 └───────────┴───────┴──────┴───────────────────┘
 *
 * WORDS: each face's band spans the whole fascia (slats and the gaps between
 * them), so a slat's strip is cut from it by height. The slats show face A
 * at rest and face B after one turn; a change of words paints the face that
 * is turned away, then turns the slats.
 */
import { FASCIA, OPEN_SIGN, PICTURE, SLAT_H, WORDS } from './dims.ts';

export type Face = 'A' | 'B';
export type Rect = readonly [number, number, number, number];

/** The texture slot's intended size in texels (the slot may differ a little; the painter scales). */
export const TEX = { w: 1024, h: 1024 } as const;

/** v range of a face's band. */
export function faceV(face: Face): [number, number] {
  return face === 'A' ? [0.75, 1] : [0.5, 0.75];
}

/** uv rect of slat i's strip of `face`. */
export function slatUv(face: Face, i: number): Rect {
  const [v0, v1] = faceV(face);
  const y0 = i * (SLAT_H + FASCIA.gap);
  const y1 = y0 + SLAT_H;
  return [0, v0 + ((v1 - v0) * y0) / WORDS.h, 1, v0 + ((v1 - v0) * y1) / WORDS.h];
}

const PIC_V = 0.23;
/** A region and the world size of the face it is printed on (so the painter keeps drawings in proportion). */
export interface Region {
  uv: Rect;
  face: { w: number; h: number };
}

export const ATLAS = {
  pictures: Array.from({ length: PICTURE.faces }, (_, k): Rect => {
    const c = k % 3, r = Math.floor(k / 3);
    return [c * 0.25, 0.5 - (r + 1) * PIC_V, (c + 1) * 0.25, 0.5 - r * PIC_V];
  }),
  open: [0.75, 0.38, 1, 0.5] as Rect,
  closed: [0.75, 0.26, 1, 0.38] as Rect,
  plate: [0.75, 0.17, 1, 0.24] as Rect,
} as const;

/** The world sizes the regions are printed at. */
export const FACES = {
  picture: { w: PICTURE.w, h: PICTURE.h },
  card: { w: OPEN_SIGN.w - 0.024, h: OPEN_SIGN.h - 0.024 },
  plate: { w: 0.27, h: 0.07 },
} as const;
