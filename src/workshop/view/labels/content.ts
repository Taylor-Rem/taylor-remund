/**
 * Typed access to the world's words (src/content/world.json). Views ask for
 * `world.sign`, `world.tape.doNotTouch`, ... and never type a visible string.
 */
import worldJson from '../../../content/world.json';
import lineJson from '../../../content/line.json';
import buttonJson from '../../../content/button.json';
import revertJson from '../../../content/revert.json';
import patchlampJson from '../../../content/patchlamp.json';
import { assertContent } from '../../../content/schema.ts';
import { BENCH_PROJECTS } from '../../../content/bench-projects.ts';
import type { Entry } from '../../../content/schema.ts';
import type { PhoneMessage } from './layout.ts';

const raw = assertContent(worldJson, 'src/content/world.json');
const line = assertContent(lineJson, 'src/content/line.json');
const button = assertContent(buttonJson, 'src/content/button.json');
const revert = assertContent(revertJson, 'src/content/revert.json');
const patchlamp = assertContent(patchlampJson, 'src/content/patchlamp.json');

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
    flutter: raw.tools.flutter.text,
    'claude-code': raw.tools['claude-code'].text,
  },
  /** P4 T2: the pinned sheet's heading (the résumé's own for its skills: tests/unit/content/tool-tags.test.ts holds the two together). */
  toolwallSheet: raw.names.toolwall.sheet.text,
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
  'name.dock.bell': raw.names.dock.bell as Entry,
  // the line (S2: src/content/line.json)
  'name.belt.dial': line.names.dial as Entry,
  'name.belt.lever': line.names.lever as Entry,
  'name.striker': line.names.striker as Entry,
  'name.dock': line.names.dock as Entry,
  'name.chute': line.names.chute as Entry,
  'mark.shipped': line.marks.shipped as Entry,
  'mark.return': line.marks.return as Entry,
  // the Button's ladder, Revert, the UNDO lever (S4: src/content/button.json; the rung cards in revert.json)
  'card.rung2': revert.cards.rung2 as Entry,
  'card.rung3': revert.cards.rung3 as Entry,
  'card.rung4': revert.cards.rung4 as Entry,
  'card.deck.1': button.deck['1'] as Entry,
  'card.deck.2': button.deck['2'] as Entry,
  'card.deck.3': button.deck['3'] as Entry,
  'card.deck.4': button.deck['4'] as Entry,
  'card.deck.5': button.deck['5'] as Entry,
  'card.deck.6': button.deck['6'] as Entry,
  'card.revert.kept': button.revert.kept as Entry,
  'card.revert.nothing': button.revert.nothing as Entry,
  'name.revert': button.names.revert as Entry,
  'name.undo-lever': button.names.lever as Entry,
  'name.button.cover': button.names.cover as Entry,
  // the Patchlamp station (S3: src/content/patchlamp.json)
  'name.line': patchlamp.names.line as Entry,
  'name.patch': patchlamp.names.patch as Entry,
  'name.platen': patchlamp.names.platen as Entry,
  'name.storefront': patchlamp.names.storefront as Entry,
  'name.jack.platen': patchlamp.names.jack.platen as Entry,
  'name.jack.belt': patchlamp.names.jack.belt as Entry,
  'name.jack.reserved': patchlamp.names.jack.reserved as Entry,
  'slip.reserved': patchlamp.slips.reserved as Entry,
  'slip.platen-full': patchlamp.slips.platenFull as Entry,
  // P4 S5: the project crates (src/content/bench-projects.json): each crate is called by its project's published title
  ...Object.fromEntries(Object.values(BENCH_PROJECTS).map((p) => [`name.project.${p.id}`, p.entry.title as Entry])),
  'name.lid': raw.names.lid as Entry,
  'name.plate': raw.names.plate as Entry,
  'name.standin': raw.names.standin as Entry,
  'name.stand': raw.names.stand as Entry, // P4 S6: the opening stand (a prototype behind ?open=stand)
  // P4 D1: the ledger board and its two controls
  'name.ledger.board': raw.names.ledger.board as Entry,
  'name.ledger.crank': raw.names.ledger.crank as Entry,
  'name.ledger.plunger': raw.names.ledger.plunger as Entry,
  // P4 D2b: the paint dial and its knob
  'name.paint.dial': raw.names.paint.dial as Entry,
  'name.paint.knob': raw.names.paint.knob as Entry,
  // P4 D3: the report press, its lever, its envelope
  'name.press.body': raw.names.press.body as Entry,
  'name.press.lever': raw.names.press.lever as Entry,
  'name.press.envelope': raw.names.press.envelope as Entry,
  // P4 T2: the tool wall's eight tools, its pinned sheet, and the wall itself (where a tool held by the keys goes back to)
  ...Object.fromEntries(Object.entries(raw.names.tool).map(([k, v]) => [`name.tool.${k}`, v as Entry])),
  'name.toolwall.sheet': raw.names.toolwall.sheet as Entry,
  'name.toolwall.wall': raw.names.toolwall.wall as Entry,
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
