/**
 * The storefront's textures: where they come from and how they change.
 *
 * One region of the labels' atlas (`Labels.region`), redrawn by the
 * storefront itself (paint.ts): the fascia's two faces of words, the
 * pictures, the OPEN/CLOSED card and the plate (atlas.ts has the layout).
 * It is a sprayed region (transparent, blended), so the fascia's paint shows
 * round the letters; the printed regions are painted opaque. A change of
 * words repaints one face and uploads only that face's rows.
 */
import type { LabelRegion, Labels } from '../../../types.ts';
import { TEX } from './atlas.ts';
import { content } from './content.ts';
import { paintAtlas, paintWords } from './paint.ts';
import type { WordsLayout } from './words.ts';

export interface StorefrontLabelRefs {
  /** The storefront's one texture (atlas.ts): the fascia's two faces, the pictures, the card, the plate. */
  atlas: string;
}

/**
 * The region's size: the slot the storefront used to borrow (a stencil 'I' at
 * capHeight 0.8 and TEX.h / 1.2 texels per unit came out 882 × 1024), kept so
 * every painted texel lands where it did.
 */
const PX = { w: 882, h: TEX.h } as const;
const TPU = Math.round(TEX.h / (1.5 * 0.8));

function region(labels: Labels): LabelRegion {
  return labels.region('storefront', { w: PX.w / TPU, h: PX.h / TPU }, { alpha: 'spray', texelsPerUnit: TPU });
}

/** What each face of the fascia carries now, per atlas (so a view can tell which face to paint). */
const painted = new Map<string, { A: string; B: string }>();
/** Regions painted at least once. */
const seen = new WeakSet<LabelRegion>();

/**
 * Make the storefront's texture and paint it: the fascia's face A with `words` (default:
 * the content's default sign), face B blank, the pictures, the card and the plate.
 */
export function storefrontLabels(labels: Labels, o: { words?: string; wordsB?: string } = {}): StorefrontLabelRefs {
  const r = region(labels);
  const atlas = r.key;
  // a region another Labels made (a second stage, a dev page) starts blank: paint it whole
  const state = seen.has(r) ? painted.get(atlas) : undefined;
  seen.add(r);
  const wantA = o.words ?? content.fascia;
  const wantB = o.wordsB ?? '';
  if (!state) paintAtlas(r, { open: content.open, closed: content.closed, plate: content.plate });
  if (!state || state.A !== wantA) paintWords(r, 'A', wantA);
  if (!state || state.B !== wantB) paintWords(r, 'B', wantB);
  painted.set(atlas, { A: wantA, B: wantB });
  return { atlas };
}

/**
 * Paint new words on one face of the fascia (the station view paints the face that is
 * turned away, then turns the slats: see `hiddenFace`). Returns the layout used.
 */
export function setFasciaWords(labels: Labels, refs: StorefrontLabelRefs, face: 'A' | 'B', text: string): WordsLayout {
  const lay = paintWords(region(labels), face, text);
  const s = painted.get(refs.atlas) ?? { A: '', B: '' };
  s[face] = text;
  painted.set(refs.atlas, s);
  return lay;
}

/** What a face of the fascia carries now. */
export function fasciaWords(refs: StorefrontLabelRefs, face: 'A' | 'B'): string {
  return painted.get(refs.atlas)?.[face] ?? '';
}
