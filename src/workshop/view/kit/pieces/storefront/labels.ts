/**
 * The storefront's textures: where they come from and how they change.
 *
 * view/labels draws every register from fixed text at start-up and has no
 * way yet to register a texture a piece paints itself. Until it does (see
 * the hand-in: `Labels.canvas(key, w, h)` is the promotion asked for), the
 * storefront asks labels for two slots of the size it needs and paints its
 * own pixels into them:
 *  - the WORDS slot is a sprayed-stencil label (transparent, blended), so
 *    the fascia's paint shows round the letters;
 *  - the PICTURES slot is a phone-screen label (opaque, any size).
 * The keys are the storefront's own (nothing else asks for this text), and
 * a slot's pixels are only ever written by paint.ts.
 *
 * The plate is an ordinary engraved brass label.
 */
import type { LabelOptions, Labels } from '../../../types.ts';
import { TEX } from './atlas.ts';
import { content } from './content.ts';
import { paintAtlas, paintWords } from './paint.ts';
import type { WordsLayout } from './words.ts';

export interface StorefrontLabelRefs {
  /** The storefront's one texture (atlas.ts): the fascia's two faces, the pictures, the card, the plate. */
  atlas: string;
}

/** What each face of the fascia carries now, per atlas (so a view can tell which face to paint). */
const painted = new Map<string, { A: string; B: string }>();

/**
 * Make the storefront's texture and paint it: the fascia's face A with `words` (default:
 * the content's default sign), face B blank, the pictures, the card and the plate.
 */
export function storefrontLabels(labels: Labels, o: { words?: string; wordsB?: string } = {}): StorefrontLabelRefs {
  // a stencil slot (transparent, blended): the fascia's paint shows round the letters, and the
  // printed regions are painted opaque. Its texels per unit set its height in texels.
  // (texelsPerUnit is the labels implementation's PlanOptions; the contract does not name it yet)
  const cap = 0.8;
  const atlas = labels.stencil('I', { paint: 'paper', capHeight: cap, texelsPerUnit: Math.round(TEX.h / (1.5 * cap)) } as LabelOptions);
  const state = painted.get(atlas);
  const wantA = o.words ?? content.fascia;
  const wantB = o.wordsB ?? '';
  if (!state) paintAtlas(labels.texture(atlas), { open: content.open, closed: content.closed, plate: content.plate });
  if (!state || state.A !== wantA) paintWords(labels.texture(atlas), 'A', wantA);
  if (!state || state.B !== wantB) paintWords(labels.texture(atlas), 'B', wantB);
  painted.set(atlas, { A: wantA, B: wantB });
  return { atlas };
}

/**
 * Paint new words on one face of the fascia (the station view paints the face that is
 * turned away, then turns the slats: see `hiddenFace`). Returns the layout used.
 */
export function setFasciaWords(labels: Labels, refs: StorefrontLabelRefs, face: 'A' | 'B', text: string): WordsLayout {
  const lay = paintWords(labels.texture(refs.atlas), face, text);
  const s = painted.get(refs.atlas) ?? { A: '', B: '' };
  s[face] = text;
  painted.set(refs.atlas, s);
  return lay;
}

/** What a face of the fascia carries now. */
export function fasciaWords(refs: StorefrontLabelRefs, face: 'A' | 'B'): string {
  return painted.get(refs.atlas)?.[face] ?? '';
}
