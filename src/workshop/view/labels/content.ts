/**
 * Typed access to the world's words (src/content/world.json). Views ask for
 * `world.sign`, `world.tape.doNotTouch`, ... and never type a visible string.
 */
import worldJson from '../../../content/world.json';
import { assertContent } from '../../../content/schema.ts';
import type { PhoneMessage } from './layout.ts';

const raw = assertContent(worldJson, 'src/content/world.json');

const isFrom = (v: unknown): v is PhoneMessage['from'] => v === 'owner' || v === 'patch';

export const world = {
  /** The sign's first word (the vignette shows TAYLOR). */
  sign: raw.sign.first.text,
  tape: { doNotTouch: raw.tape.doNotTouch.text },
  jacks: { storefront: raw.jacks.storefront.text, platen: raw.jacks.platen.text },
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
} as const;

export type World = typeof world;
