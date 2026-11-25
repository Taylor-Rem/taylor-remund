/**
 * The room's words (src/content/room.json): the reserved bays' label tape.
 * Pieces ask for `room.bays.inspection` and never type a visible string.
 */
import roomJson from '../../../../../content/room.json' with { type: 'json' };
import { assertContent } from '../../../../../content/schema.ts';

const raw = assertContent(roomJson, 'src/content/room.json');

export const room = {
  bays: {
    inspection: raw.bays.inspection.text,
    next: raw.bays.next.text,
  },
} as const;
