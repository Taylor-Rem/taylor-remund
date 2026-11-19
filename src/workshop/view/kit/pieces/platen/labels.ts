/**
 * The platen's one word: PLATEN, engraved on the brass jack plate on its
 * sloped front. The text comes from src/content/platen.json; this file only
 * decides how big it is.
 *
 * A piece is built synchronously and label sizes need the fonts, so the view
 * (or a dev page) makes the label first and passes the ref in:
 *
 *   const p = platen({ labels: platenLabels(labels) });
 */
import type { Labels } from '../../../types.ts';
import platenJson from '../../../../../content/platen.json';
import { assertContent } from '../../../../../content/schema.ts';
import { capPx, DEFAULT_VIEW } from '../../../labels/layout.ts';

const raw = assertContent(platenJson, 'src/content/platen.json');

/** The plate's word. */
export const PLATE_TEXT: string = raw.plate.text;

export interface LabelRef {
  key: string;
  /** World size of the label quad. */
  w: number;
  h: number;
}

export interface PlatenLabelRefs {
  plate: LabelRef;
}

/** How far the plate's face leans back from vertical (degrees): the base's front slope. */
export const PLATE_LEAN_DEG = 35;

/**
 * Capital height of the plate. The face leans back PLATE_LEAN_DEG toward the
 * camera, so it is foreshortened by cos(pitch - lean) rather than cos(pitch):
 * the 12 px rule at the default view, with a 10% margin.
 */
export const PLATE_CAP = (() => {
  const p = (DEFAULT_VIEW.pitchDeg - PLATE_LEAN_DEG) * (Math.PI / 180);
  const perUnit = capPx(1, 'front', { pxPerUnit: DEFAULT_VIEW.pxPerUnit, pitchDeg: 0 }) * Math.cos(p);
  return Math.ceil(((DEFAULT_VIEW.minCapPx * 1.15) / perUnit) * 100) / 100;
})();

/** Make the platen's label texture and return its key and size. */
export function platenLabels(labels: Labels): PlatenLabelRefs {
  const key = labels.plate(PLATE_TEXT, { capHeight: PLATE_CAP });
  return { plate: { key, ...labels.size(key) } };
}

/** Sizes to lay out with when no labels were made (clay reviews, tests): close to the real ones. */
export function estimateLabels(): { plate: { w: number; h: number } } {
  // the plate register uses the tape's advance (see the Button's estimate: ~1.42 x a plain cap-width estimate)
  const s = PLATE_TEXT;
  const w = 1.42 * PLATE_CAP * (0.62 * s.replace(/ /g, '').length + 0.3 * (s.split(' ').length - 1) + 1.2);
  return { plate: { w, h: PLATE_CAP * 2.2 } };
}
