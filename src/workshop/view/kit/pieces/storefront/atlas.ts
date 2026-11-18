/**
 * Where things sit in the storefront's two textures (pure; runs in Node).
 *
 * WORDS: the fascia's two faces, one above the other. Face A fills the top
 * half (v 0.5..1), face B the bottom half (v 0..0.5); each half spans the
 * whole fascia (slats and the gaps between them), so a slat's strip is cut
 * from its half by height. The slats show face A at rest and face B after
 * one turn; a change of words paints the face that is turned away, then
 * turns the slats.
 *
 * PICTURES: the drum's six faces (five pictures and the blank) in a 3 × 2 block, the
 * OPEN and CLOSED faces of the hanging card side by side below them.
 * uv rects are [u0, v0, u1, v1], v up (row 0 of the painted canvas is v = 1).
 */
import { FASCIA, OPEN_SIGN, PICTURE, SLAT_H, WORDS } from './dims.ts';

export type Face = 'A' | 'B';
export type Rect = readonly [number, number, number, number];

/** The words texture's size in texels (the slot it is painted into may differ a little; painters scale). */
export const WORDS_TEX = { w: 768, h: 508 } as const;

/** v range of a face's half. */
export function faceV(face: Face): [number, number] {
  return face === 'A' ? [0.5, 1] : [0, 0.5];
}

/** uv rect of slat i's strip of `face`. */
export function slatUv(face: Face, i: number): Rect {
  const [v0, v1] = faceV(face);
  const y0 = i * (SLAT_H + FASCIA.gap);
  const y1 = y0 + SLAT_H;
  return [0, v0 + ((v1 - v0) * y0) / WORDS.h, 1, v0 + ((v1 - v0) * y1) / WORDS.h];
}

/** The pictures texture: 3 × 2 drum faces over a strip of the card's two faces. */
const PW = 256, PH = Math.round((256 * PICTURE.h) / PICTURE.w);
const CW = 384, CH = Math.round((384 * OPEN_SIGN.h) / OPEN_SIGN.w);
export const PICTURES_TEX = { w: PW * 3, h: PH * 2 + CH } as const;

const rect = (x: number, y: number, w: number, h: number): Rect => {
  const W = PICTURES_TEX.w, H = PICTURES_TEX.h;
  // canvas rows run down from the top; v runs up
  return [x / W, 1 - (y + h) / H, (x + w) / W, 1 - y / H];
};

/** Pixel rects (canvas space, y down) of every cell: drum face k at (k % 3, k / 3). */
export const CELLS = {
  pictures: Array.from({ length: PICTURE.faces }, (_, k) => ({ x: (k % 3) * PW, y: Math.floor(k / 3) * PH, w: PW, h: PH })),
  open: { x: 0, y: PH * 2, w: CW, h: CH },
  closed: { x: CW, y: PH * 2, w: CW, h: CH },
} as const;

export const ATLAS = {
  pictures: CELLS.pictures.map((c) => rect(c.x, c.y, c.w, c.h)),
  open: rect(CELLS.open.x, CELLS.open.y, CELLS.open.w, CELLS.open.h),
  closed: rect(CELLS.closed.x, CELLS.closed.y, CELLS.closed.w, CELLS.closed.h),
} as const;
