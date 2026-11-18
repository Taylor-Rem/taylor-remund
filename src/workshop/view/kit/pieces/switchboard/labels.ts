/**
 * The switchboard's words: the label tape over each live jack (STOREFRONT,
 * LAMP) and the typed cards in the drawers' brass holders. The text comes
 * from src/content/world.json; this file decides only how big it is.
 *
 * A piece is built synchronously and label sizes need the fonts, so the view
 * (or a dev page) makes the labels first and passes the refs in:
 *
 *   const refs = switchboardLabels(labels);
 *   const p = switchboard({ labels: refs });
 */
import type { Labels } from '../../../types.ts';
import { world } from '../../../labels/content.ts';
import { minCapHeight } from '../../../labels/layout.ts';

export interface LabelRef {
  key: string;
  /** World size of the label quad. */
  w: number;
  h: number;
}

/** The two live jacks, by their simulation names (sim/scenes/vignette.ts: jack-storefront, jack-lamp). */
export const JACKS = ['storefront', 'lamp'] as const;
export type JackName = (typeof JACKS)[number];

export interface SwitchboardLabelRefs {
  /** The tape over each live jack. */
  tape: Record<JackName, LabelRef>;
  /** The typed card in each drawer's brass holder. */
  card: Record<JackName, LabelRef>;
}

/**
 * Capital height of the jack tapes: the labels module's 12 px rule on a face
 * that looks at the camera, with a 5% margin (0.24; the module's own default
 * of 0.26 would make STOREFRONT 2.75 wide, wider than its half of the board).
 */
export const TAPE_CAP = Math.ceil(minCapHeight('front', 1.05) * 100) / 100;
/** The drawer cards are read up close, not from the default view. */
export const CARD_CAP = 0.03;

const text = (j: JackName): string => world.jacks[j];

/** Make the switchboard's label textures and return their keys and sizes. */
export function switchboardLabels(labels: Labels): SwitchboardLabelRefs {
  const ref = (key: string): LabelRef => ({ key, ...labels.size(key) });
  return {
    tape: { storefront: ref(labels.tape(text('storefront'), 'black', { capHeight: TAPE_CAP })), lamp: ref(labels.tape(text('lamp'), 'black', { capHeight: TAPE_CAP })) },
    card: { storefront: ref(labels.card(text('storefront'), { capHeight: CARD_CAP })), lamp: ref(labels.card(text('lamp'), { capHeight: CARD_CAP })) },
  };
}

/** Sizes to lay out with when no labels were made (clay reviews, tests): close to the real ones. */
export function estimateLabels(): { tape: Record<JackName, { w: number; h: number }>; card: Record<JackName, { w: number; h: number }> } {
  // measured against the real tape: STOREFRONT at cap 0.24 is 2.52 x 0.427, LAMP 1.20 x 0.427
  // and the cards (at cap 0.04: STOREFRONT 0.319 x 0.1375, LAMP 0.291 x 0.1375; they scale with the cap)
  const tapeW = (s: string, cap: number): number => cap * (0.89 * s.length + 1.6);
  const t = (j: JackName) => ({ w: tapeW(text(j), TAPE_CAP), h: TAPE_CAP * 1.78 });
  const c = (j: JackName) => ({ w: CARD_CAP * (7 + 0.07 * text(j).length), h: CARD_CAP * 3.44 });
  return { tape: { storefront: t('storefront'), lamp: t('lamp') }, card: { storefront: c('storefront'), lamp: c('lamp') } };
}
