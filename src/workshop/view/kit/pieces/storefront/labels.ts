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
import { PICTURES_TEX, WORDS_TEX } from './atlas.ts';
import { WORDS } from './dims.ts';
import { content } from './content.ts';
import { paintPictures, paintWords } from './paint.ts';
import type { WordsLayout } from './words.ts';

export interface StorefrontLabelRefs {
  /** The fascia's two faces (A above B). */
  words: string;
  /** The window's pictures and the card's two faces. */
  pictures: string;
  /** The STOREFRONT jack plate. */
  plate: { key: string; w: number; h: number };
}

/** Capital height of the engraved jack plate. */
export const PLATE_CAP = 0.05;

/** What each face of each words slot shows now (so a view can tell which face to paint). */
const painted = new Map<string, { A: string; B: string }>();

/**
 * Make the storefront's textures and paint them: the fascia's face A with `words`
 * (default: the content's default sign), face B blank, the pictures and the card.
 */
export function storefrontLabels(labels: Labels, o: { words?: string; wordsB?: string } = {}): StorefrontLabelRefs {
  // a stencil slot of the right proportions: its texels per unit set the slot's height in texels
  const cap = 0.8;
  // (texelsPerUnit is the labels implementation's PlanOptions; the contract does not name it yet)
  const words = labels.stencil('WW', { paint: 'paper', capHeight: cap, texelsPerUnit: Math.round(WORDS_TEX.h / (1.5 * cap)) } as LabelOptions);
  const pictures = labels.phone([{ from: 'patch', text: 'storefront window pictures' }], {
    screen: { w: 1, h: PICTURES_TEX.h / PICTURES_TEX.w },
    texelsPerUnit: PICTURES_TEX.w,
  } as LabelOptions);
  const plateKey = labels.plate(content.plate, { capHeight: PLATE_CAP });
  const state = painted.get(words);
  const wantA = o.words ?? content.fascia;
  const wantB = o.wordsB ?? '';
  if (!state || state.A !== wantA) paintWords(labels.texture(words), 'A', wantA);
  if (!state || state.B !== wantB) paintWords(labels.texture(words), 'B', wantB);
  painted.set(words, { A: wantA, B: wantB });
  if (!painted.has(pictures)) {
    paintPictures(labels.texture(pictures), { open: content.open, closed: content.closed });
    painted.set(pictures, { A: '', B: '' });
  }
  void WORDS;
  return { words, pictures, plate: { key: plateKey, ...labels.size(plateKey) } };
}

/**
 * Paint new words on one face of the fascia (the station view paints the face that is
 * turned away, then turns the slats: see `wordsFace`). Returns the layout used.
 */
export function setFasciaWords(labels: Labels, refs: StorefrontLabelRefs, face: 'A' | 'B', text: string): WordsLayout {
  const lay = paintWords(labels.texture(refs.words), face, text);
  const s = painted.get(refs.words) ?? { A: '', B: '' };
  s[face] = text;
  painted.set(refs.words, s);
  return lay;
}

/** What a face of the fascia carries now. */
export function fasciaWords(refs: StorefrontLabelRefs, face: 'A' | 'B'): string {
  return painted.get(refs.words)?.[face] ?? '';
}
