/**
 * The switchboard's words: the label tape over each live jack (STOREFRONT,
 * PLATEN, BELT, LAMP), the RESERVED strip over the two capped jacks, and the
 * typed cards in the drawers' brass holders. The text comes from
 * src/content/world.json (three jack names) and src/content/switchboard.json
 * (BELT, RESERVED); this file decides only how big it is.
 *
 * A piece is built synchronously and label sizes need the fonts, so the view
 * (or a dev page) makes the labels first and passes the refs in:
 *
 *   const refs = switchboardLabels(labels, jacks);
 *   const p = switchboard({ labels: refs, jacks });
 */
import type { Labels } from '../../../types.ts';
import { world } from '../../../labels/content.ts';
import { minCapHeight } from '../../../labels/layout.ts';
import boardJson from '../../../../../content/switchboard.json';
import { assertContent } from '../../../../../content/schema.ts';

const raw = assertContent(boardJson, 'src/content/switchboard.json');

export interface LabelRef {
  key: string;
  /** World size of the label quad. */
  w: number;
  h: number;
}

/** The four live jacks of release 1, left to right on the board (REWRITE.md § B2 X1). */
export const JACKS = ['storefront', 'platen', 'belt', 'lamp'] as const;
export type JackName = (typeof JACKS)[number];
/** The G1 slice's two live jacks (the frozen vignette builds the board with these). */
export const SLICE_JACKS: readonly JackName[] = ['storefront', 'lamp'];

export interface SwitchboardLabelRefs {
  /** The tape over each live jack (only the jacks the board was labelled for). */
  tape: Partial<Record<JackName, LabelRef>>;
  /** The typed card in each drawer's brass holder. */
  card: Partial<Record<JackName, LabelRef>>;
  /** The RESERVED strip across the two capped jacks (the whole board only). */
  reserved?: LabelRef;
}

/**
 * Capital height of the slice's jack tapes (G1, unchanged): the labels module's
 * 12 px rule on a face that looks at the camera, with a 5% margin (0.24).
 */
export const TAPE_CAP = Math.ceil(minCapHeight('front', 1.05) * 100) / 100;
/**
 * Capital height of the whole board's jack tapes. On the bench the board is
 * seen at about 60 px a unit, looked at from about 36° above: the slice's
 * vertical 0.24 measured 11.7 px there. The whole board's tapes sit on holders
 * leaning back TAPE_TILT (22°, board.ts), so they lose cos(14°) to the angle
 * instead of cos(36°): 0.22 gives about 12.8 px, and STOREFRONT is 2.3 wide.
 */
export const TAPE_CAP_WHOLE = 0.22;
/** The RESERVED strip: a short tape across two caps, read up close (not gated). */
export const RESERVED_CAP = 0.105;
/** The drawer cards are read up close, not from the default view. */
export const CARD_CAP = 0.03;

/** A jack's name as it is printed. */
export function jackText(j: JackName): string {
  return j === 'belt' ? raw.jacks.belt.text : world.jacks[j];
}
/** The word on the capped jacks' strip. */
export const RESERVED_TEXT: string = raw.reserved.text;

const isSlice = (jacks: readonly JackName[]): boolean => jacks.length === 2 && jacks.includes('storefront') && jacks.includes('lamp');

/** Make the switchboard's label textures and return their keys and sizes (default: the slice's two jacks). */
export function switchboardLabels(labels: Labels, jacks: readonly JackName[] = SLICE_JACKS): SwitchboardLabelRefs {
  const ref = (key: string): LabelRef => ({ key, ...labels.size(key) });
  const slice = isSlice(jacks);
  const live = slice ? SLICE_JACKS : JACKS;
  const cap = slice ? TAPE_CAP : TAPE_CAP_WHOLE;
  const out: SwitchboardLabelRefs = { tape: {}, card: {} };
  for (const j of live) {
    out.tape[j] = ref(labels.tape(jackText(j), 'black', { capHeight: cap }));
    out.card[j] = ref(labels.card(jackText(j), { capHeight: CARD_CAP }));
  }
  if (!slice) out.reserved = ref(labels.tape(RESERVED_TEXT, 'red', { capHeight: RESERVED_CAP }));
  return out;
}

/** Sizes to lay out with when no labels were made (clay reviews, tests): close to the real ones. */
export function estimateLabels(cap = TAPE_CAP): { tape: Record<JackName, { w: number; h: number }>; card: Record<JackName, { w: number; h: number }>; reserved: { w: number; h: number } } {
  // measured against the real tape: STOREFRONT at cap 0.24 is 2.52 x 0.427, LAMP 1.20 x 0.427
  // and the cards (at cap 0.04: STOREFRONT 0.319 x 0.1375, LAMP 0.291 x 0.1375; they scale with the cap)
  const tapeW = (s: string, c: number): number => c * (0.89 * s.length + 1.6);
  const tape = {} as Record<JackName, { w: number; h: number }>;
  const card = {} as Record<JackName, { w: number; h: number }>;
  for (const j of JACKS) {
    tape[j] = { w: tapeW(jackText(j), cap), h: cap * 1.78 };
    card[j] = { w: CARD_CAP * (7 + 0.07 * jackText(j).length), h: CARD_CAP * 3.44 };
  }
  return { tape, card, reserved: { w: tapeW(RESERVED_TEXT, RESERVED_CAP), h: RESERVED_CAP * 1.78 } };
}
