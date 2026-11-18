/**
 * The words Patch understands: `parse(text, jack)` and its types. Pure, no
 * wiring: the Patchlamp station takes an `Instruction` to the machine on the
 * jack (`machine.instruct(cmd, cause)`), and the phone renders `reply` with
 * src/content/texts.ts.
 */
export { parse, MAX_TEXT, UNDO_REPLIES } from './parse.ts';
export { checkWords, isBlocked, normaliseWords, MAX_WORDS } from './tape.ts';
export type { TapeResult } from './tape.ts';
export { PAINTS, PICTURES } from './words.ts';
export { JACKS, REPLY_IDS } from './types.ts';
export type {
  BeltArgs,
  Colour,
  Instruction,
  Jack,
  LampArgs,
  LampColour,
  Parsed,
  Picture,
  PictureArg,
  PlatenArgs,
  Refusal,
  RefusalReason,
  Reply,
  ReplyId,
  ReplyLine,
  StorefrontArgs,
  Verb,
} from './types.ts';

import type { Jack } from './types.ts';

/** The jack a scene id names (`jack-storefront` → `storefront`), or null for a capped or unknown jack. */
export function jackOf(id: string): Jack | null {
  const m = /^jack-(storefront|platen|belt|lamp)$/.exec(id);
  return m ? (m[1] as Jack) : null;
}
