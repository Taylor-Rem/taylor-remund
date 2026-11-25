/**
 * The room's words (src/content/room.json). (L2, 2026-11-24: the reserved bays and their label tape are gone.)
 * Pieces ask for `room.stand` and never type a visible string.
 */
import roomJson from '../../../../../content/room.json' with { type: 'json' };
import { assertContent } from '../../../../../content/schema.ts';

const raw = assertContent(roomJson, 'src/content/room.json');

export const room = {
  /** (P4 S6) The opening stand's label tape, when it wears one. */
  stand: raw.stand.text,
} as const;
