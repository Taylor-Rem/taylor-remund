/**
 * The storefront's words, from src/content/storefront.json (no visible
 * sentence is typed in view code), and the window's picture set, in the
 * drum's order, which is also the order "next" cycles through (the
 * instruction parser's `Picture` type; their names live in texts.json).
 * Pure; runs in Node.
 */
import json from '../../../../../content/storefront.json';
import { assertContent } from '../../../../../content/schema.ts';
import type { Picture } from '../../../../sim/instruct/types.ts';

const raw = assertContent(json, 'src/content/storefront.json');

export const content = {
  /** The words a new storefront's fascia carries: not a business name. */
  fascia: raw.fascia.default.text,
  open: raw.door.open.text,
  closed: raw.door.closed.text,
  plate: raw.jack.plate.text,
} as const;

/** What the window can show: the five pictures and the empty frame, in drum (and "next") order. */
export type WindowPicture = Picture | 'none';
export const PICTURES: readonly WindowPicture[] = ['mountains', 'sun', 'boat', 'tree', 'house', 'none'];

/** The drum's face (0..5) that shows a picture. */
export function pictureIndex(p: WindowPicture): number {
  const i = PICTURES.indexOf(p);
  if (i < 0) throw new Error(`storefront: no picture ${JSON.stringify(p)} (has: ${PICTURES.join(', ')})`);
  return i;
}
