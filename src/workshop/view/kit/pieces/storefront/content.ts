/**
 * The storefront's words, from src/content/storefront.json (no visible
 * sentence is typed in view code). Pure; runs in Node.
 */
import json from '../../../../../content/storefront.json';
import { assertContent } from '../../../../../content/schema.ts';

const raw = assertContent(json, 'src/content/storefront.json');

export const content = {
  /** The words a new storefront's fascia carries: not a business name. */
  fascia: raw.fascia.default.text,
  open: raw.door.open.text,
  closed: raw.door.closed.text,
  plate: raw.jack.plate.text,
  /** The window's pictures, in the drum's order: id (what a text names) and a plain name. */
  pictures: raw.pictures.map((p) => ({ id: p.id, name: p.text })),
} as const;
