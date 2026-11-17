/**
 * The Button's words: the DO NOT TOUCH tape (two strips: the tape was not
 * wide enough for the whole sentence, so it went on in two goes) and the
 * engraved PRESSES plate on the counter. The text comes from
 * src/content/world.json; this file only decides how it is cut and how big.
 *
 * A piece is built synchronously and label sizes need the fonts, so the
 * view (or a dev page) makes the labels first and passes the refs in:
 *
 *   const refs = buttonLabels(labels);
 *   const p = button({ labels: refs });
 */
import type { Labels } from '../../../types.ts';
import { world } from '../../../labels/content.ts';

export interface LabelRef {
  key: string;
  /** World size of the label quad. */
  w: number;
  h: number;
}

export interface ButtonLabelRefs {
  /** The tape strips, top to bottom. */
  tape: LabelRef[];
  /** The counter's engraved plate. */
  plate: LabelRef;
}

/** Capital heights (world units). The tape is as big as the pedestal's front allows. */
export const TAPE_CAP = 0.11;
export const PLATE_CAP = 0.03;

/** The tape's words, split into the strips they were stuck on in. */
export function tapeStrips(): string[] {
  const t = world.tape.doNotTouch.trim();
  const i = t.lastIndexOf(' ');
  return i > 0 ? [t.slice(0, i), t.slice(i + 1)] : [t];
}

/** Make the Button's label textures and return their keys and sizes. */
export function buttonLabels(labels: Labels): ButtonLabelRefs {
  const ref = (key: string): LabelRef => ({ key, ...labels.size(key) });
  return {
    tape: tapeStrips().map((s) => ref(labels.tape(s, 'black', { capHeight: TAPE_CAP }))),
    plate: ref(labels.plate(world.plates.presses, { capHeight: PLATE_CAP })),
  };
}

/** Sizes to lay out with when no labels were made (clay reviews, tests): close to the real ones. */
export function estimateLabels(): { tape: Array<{ w: number; h: number }>; plate: { w: number; h: number } } {
  const width = (s: string, cap: number): number => cap * (0.62 * s.replace(/ /g, '').length + 0.3 * (s.split(' ').length - 1) + 1.2);
  return {
    tape: tapeStrips().map((s) => ({ w: width(s, TAPE_CAP), h: TAPE_CAP * 1.9 })),
    plate: { w: width(world.plates.presses, PLATE_CAP), h: PLATE_CAP * 2.2 },
  };
}
