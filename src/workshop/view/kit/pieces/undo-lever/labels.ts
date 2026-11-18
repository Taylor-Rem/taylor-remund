/**
 * The UNDO lever's word: one strip of label tape on the console's leaning
 * front. The text comes from src/content/handles.json; this file only
 * decides how big it is cut.
 *
 * A piece is built synchronously and label sizes need the fonts, so the view
 * (or a dev page) makes the label first and passes the ref in:
 *
 *   const refs = undoLabels(labels);
 *   const p = undoLever({ labels: refs });
 */
import type { Labels } from '../../../types.ts';
import handlesJson from '../../../../../content/handles.json';
import { assertContent } from '../../../../../content/schema.ts';

const raw = assertContent(handlesJson, 'src/content/handles.json');

/** The tape's word (from content; never typed here). */
export const UNDO_WORD: string = raw.undo.lever.text;

export interface LabelRef {
  key: string;
  /** World size of the label quad. */
  w: number;
  h: number;
}

export interface UndoLabelRefs {
  tape: LabelRef;
}

/**
 * Capital height of the tape (world units). The face it is stuck to leans
 * back toward the camera (about the camera's own pitch), so a capital is
 * seen nearly full height: 0.24 × ~56 px a unit at the bench's home view is
 * about 13 px, over the 12 px rule.
 */
export const TAPE_CAP = 0.24;

/** Make the lever's label texture and return its key and size. */
export function undoLabels(labels: Labels): UndoLabelRefs {
  const key = labels.tape(UNDO_WORD, 'black', { capHeight: TAPE_CAP });
  return { tape: { key, ...labels.size(key) } };
}

/** The size to lay out with when no labels were made (clay reviews, tests): close to the real one. */
export function estimateLabels(): { tape: { w: number; h: number } } {
  // the Button's measured rule of thumb: about 1.42x a plain cap-width estimate, 1.77 caps tall
  const s = UNDO_WORD;
  const w = 1.42 * TAPE_CAP * (0.62 * s.replace(/ /g, '').length + 0.3 * (s.split(' ').length - 1) + 1.2);
  return { tape: { w, h: TAPE_CAP * 1.77 } };
}
