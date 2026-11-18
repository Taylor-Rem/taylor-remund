/**
 * Typed access to the world's words (src/content/world.json). Views ask for
 * `world.sign`, `world.tape.doNotTouch`, ... and never type a visible string.
 */
import worldJson from '../../../content/world.json';
import lineJson from '../../../content/line.json';
import { assertContent } from '../../../content/schema.ts';
import type { Entry } from '../../../content/schema.ts';
import type { PhoneMessage } from './layout.ts';

const raw = assertContent(worldJson, 'src/content/world.json');
const line = assertContent(lineJson, 'src/content/line.json');

const isFrom = (v: unknown): v is PhoneMessage['from'] => v === 'owner' || v === 'patch';

export const world = {
  /** The sign's first word (the vignette shows TAYLOR). */
  sign: raw.sign.first.text,
  tape: { doNotTouch: raw.tape.doNotTouch.text },
  jacks: { storefront: raw.jacks.storefront.text, lamp: raw.jacks.lamp.text, platen: raw.jacks.platen.text },
  tools: {
    laravel: raw.tools.laravel.text,
    vue: raw.tools.vue.text,
    php: raw.tools.php.text,
    python: raw.tools.python.text,
    rust: raw.tools.rust.text,
    sql: raw.tools.sql.text,
  },
  cards: { revertRung1: raw.cards.revertRung1.text },
  slips: { fetchOutOfLane: raw.slips.fetchOutOfLane.text },
  phone: {
    attract: raw.phone.attract.map((m): PhoneMessage => {
      if (!isFrom(m.from)) throw new Error(`src/content/world.json: phone message "from" must be owner or patch, got ${JSON.stringify(m.from)}`);
      return { from: m.from, text: m.text };
    }),
  },
  stencil: {
    size: { S: raw.stencil.size.S.text, M: raw.stencil.size.M.text, L: raw.stencil.size.L.text },
    up: raw.stencil.up.text,
  },
  plates: { presses: raw.plates.presses.text },
  /** Plain names for the controls list and screen readers. */
  names: {
    crate: raw.names.crate.text,
    fetch: raw.names.fetch.text,
    lamp: raw.names.lamp.text,
    belt: raw.names.belt.text,
    button: raw.names.button.text,
    cord: raw.names.cord.text,
    jack: { storefront: raw.names.jack.storefront.text, lamp: raw.names.jack.lamp.text },
  },
} as const;

/**
 * The content ids the simulation speaks in (sim never holds text), each
 * mapped to its entry in world.json. Add an id here when sim starts emitting it.
 */
const BY_ID: Readonly<Record<string, Entry>> = {
  'card.rung1': raw.cards.revertRung1 as Entry,
  'slip.out-of-lane': raw.slips.fetchOutOfLane as Entry,
  'name.crate': raw.names.crate as Entry,
  'name.fetch': raw.names.fetch as Entry,
  'name.lamp': raw.names.lamp as Entry,
  'name.belt': raw.names.belt as Entry,
  'name.button': raw.names.button as Entry,
  'name.cord': raw.names.cord as Entry,
  'name.jack.storefront': raw.names.jack.storefront as Entry,
  'name.jack.lamp': raw.names.jack.lamp as Entry,
  // the line (S2: src/content/line.json)
  'name.belt.dial': line.names.dial as Entry,
  'name.belt.lever': line.names.lever as Entry,
  'name.striker': line.names.striker as Entry,
  'name.dock': line.names.dock as Entry,
  'name.chute': line.names.chute as Entry,
  'mark.shipped': line.marks.shipped as Entry,
  'mark.return': line.marks.return as Entry,
};

/** Every content id this module resolves. */
export const CONTENT_IDS: readonly string[] = Object.keys(BY_ID);

/** The entry for a simulation content id. Throws on an unknown id. */
export function contentById(id: string): Entry {
  const e = BY_ID[id];
  if (!e) throw new Error(`content: unknown content id ${JSON.stringify(id)} (known: ${CONTENT_IDS.join(', ')})`);
  return e;
}

export type World = typeof world;
