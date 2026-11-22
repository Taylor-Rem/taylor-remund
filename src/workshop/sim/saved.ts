/**
 * What a visit remembers (REWRITE.md § E10: "Saved in the visitor's own browser only: settings (sound, motion,
 * quality), what they have discovered, the Button's rung and count. The layout of loose parts is not saved").
 * The settings are the page's; this is the world's part: ONE plain JSON value with a version number.
 *
 *   world.saved()                       the snapshot now (`WorldSaved`); `saved.changed` says when it changes
 *   parseSaved(fromStorage)             untrusted input in, a valid snapshot or null out; never throws
 *   createWorld({ ..., saved })         a world that begins where the last visit left off
 *
 * What is in it: the Button's rung (the one played last), the highest rung reached, the press count, whether its
 * cover is on, the deck after the ladder (§ B4); and the stations the visitor has used, in the order first used
 * (§ B3's "discoveries": six of them and the tells stop, next visit too); (P4 S5) the project crates left open. What is not, on purpose: where any loose
 * part lies, anything the visitor typed or texted, the undo stack, the crew, reduced motion (a setting: the page's).
 *
 * Read from a browser's storage, a snapshot is untrusted: from an older version, truncated, edited by hand or
 * hostile. `parseSaved` takes the stored text (or a value already parsed) and gives back a fresh object built only
 * from checked fields, or null: a wrong version, a wrong type, a number out of range or not whole, a rung the
 * ladder has not reached, an id that is not an id, an array or a text longer than any real one. Ids that are
 * well-formed but this bench does not know (a station from another release) are not refused here: the world
 * drops them as it restores (`createUsed`, the Button's deck), so nothing unknown reaches it.
 */
import type { Id } from './types.ts';
import { DECK } from './machines/button.ts';

/** The snapshot's version. A stored value of any other version is not read (the visit starts fresh). */
export const SAVED_VERSION = 1;

/** The most a stored text may be, characters: a real snapshot is a few hundred. */
export const SAVED_MAX_TEXT = 4096;
/** The most stations a snapshot may list (the bench has ten; arrivals add a few). */
export const SAVED_MAX_USED = 64;
/** The most project crates a snapshot may list open (the bench has six). */
export const SAVED_MAX_OPEN = 16;
/** The most presses a snapshot may count (a press a second for eleven days). */
export const SAVED_MAX_PRESSES = 999_999;

/** The cover as a visit remembers it: on (`shut`: lifted or being fitted, it is on next visit) or not yet. */
export type SavedCover = 'none' | 'shut';

export interface WorldSaved {
  readonly v: typeof SAVED_VERSION;
  readonly button: {
    /** The rung played last, 0 before the first press; 1 to 4. */
    readonly rung: number;
    /** The highest rung of the ladder reached, 0 to 4 (at 4 the deck takes over). */
    readonly reached: number;
    readonly presses: number;
    readonly cover: SavedCover;
    /** The deck after the ladder: the cards still to draw, top first, and the last drawn. */
    readonly deck: { readonly left: readonly Id[]; readonly last: Id | null };
  };
  /** The stations the visitor has used, in the order first used. */
  readonly used: readonly Id[];
  /** P4 S5: the project crates left open (absent when none: a snapshot from before P4 has none). */
  readonly open?: readonly Id[];
}

/** A fresh visit's snapshot (what `saved()` is before anything happens, and after "Reset the workshop"). */
export const FRESH_SAVED: WorldSaved = Object.freeze({
  v: SAVED_VERSION,
  button: Object.freeze({ rung: 0, reached: 0, presses: 0, cover: 'none' as const, deck: Object.freeze({ left: Object.freeze([]) as readonly Id[], last: null }) }),
  used: Object.freeze([]) as readonly Id[],
});

const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const DECK_IDS: ReadonlySet<Id> = new Set(DECK.map((c) => c.id));

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const own = (o: Record<string, unknown>, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
const whole = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** A list of distinct well-formed ids, at most `max` long; null if it is anything else. */
function ids(v: unknown, max: number): Id[] | null {
  if (!Array.isArray(v) || v.length > max) return null;
  const out: Id[] = [];
  for (let i = 0; i < v.length; i++) {
    const x: unknown = v[i];
    if (typeof x !== 'string' || !ID.test(x) || out.includes(x)) return null;
    out.push(x);
  }
  return out;
}

/**
 * Untrusted input (the text a browser's storage gave back, or a value already parsed from it) to a valid snapshot,
 * or null. Pure; never throws; the result shares nothing with the input.
 */
export function parseSaved(input: unknown): WorldSaved | null {
  try {
    let value: unknown = input;
    if (typeof input === 'string') {
      if (input.length > SAVED_MAX_TEXT) return null;
      value = JSON.parse(input) as unknown;
    }
    if (!isRecord(value) || own(value, 'v') !== SAVED_VERSION) return null;
    const b = own(value, 'button');
    if (!isRecord(b)) return null;
    const rung = own(b, 'rung');
    const reached = own(b, 'reached');
    const presses = own(b, 'presses');
    const cover = own(b, 'cover');
    if (!whole(rung, 0, 4) || !whole(reached, 0, 4) || !whole(presses, 0, SAVED_MAX_PRESSES)) return null;
    // the ladder as it can really stand: a rung played is one reached; each press climbs one rung until the deck
    // (so below rung 4 the rung, the rung reached and the presses are one number); nothing played before the
    // first press; the cover comes with rung 3
    if (rung > reached || presses < reached || (presses === 0) !== (rung === 0) || (reached > 0) !== (rung > 0)) return null;
    if (reached < 4 && (rung !== reached || presses !== reached)) return null;
    if (cover !== 'none' && cover !== 'shut') return null;
    if (cover === 'shut' && reached < 3) return null;
    const d = own(b, 'deck');
    if (!isRecord(d)) return null;
    const left = ids(own(d, 'left'), DECK.length);
    const lastRaw = own(d, 'last');
    if (left === null || (lastRaw !== null && (typeof lastRaw !== 'string' || !DECK_IDS.has(lastRaw)))) return null;
    if (left.some((id) => !DECK_IDS.has(id)) || (lastRaw !== null && left.includes(lastRaw))) return null;
    // the deck is drawn only once the ladder is climbed
    if (reached < 4 && (left.length > 0 || lastRaw !== null)) return null;
    const used = ids(own(value, 'used'), SAVED_MAX_USED);
    if (used === null) return null;
    // (P4 S5) the open crates: absent, or a list of distinct ids (a crate this bench does not have is dropped as it is restored)
    const openRaw = own(value, 'open');
    const open = openRaw === undefined ? [] : ids(openRaw, SAVED_MAX_OPEN);
    if (open === null) return null;
    return {
      v: SAVED_VERSION,
      button: { rung, reached, presses, cover, deck: { left, last: lastRaw } },
      used,
      ...(open.length > 0 ? { open } : {}),
    };
  } catch {
    return null;
  }
}

/** The snapshot as text, for storage (and for telling whether it changed). */
export const savedText = (s: WorldSaved): string => JSON.stringify(s);
