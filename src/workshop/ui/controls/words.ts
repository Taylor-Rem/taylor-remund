/**
 * The controls list's and the live region's words (P3 B2; REWRITE.md § E9).
 * Every visible or spoken word is in src/content (world.json `names`,
 * `stations`, `controls`, `said`, and the stations' own files through
 * `contentById`); this only fills the `{slots}` of their templates.
 */
import worldJson from '../../../content/world.json';
import { assertContent } from '../../../content/schema.ts';
import { colourName } from '../../../content/texts.ts';
import { contentById } from '../../view/labels/content.ts';

const raw = assertContent(worldJson, 'src/content/world.json');

type Entry = { readonly text: string };
type Tree = { readonly [k: string]: Tree | Entry | readonly unknown[] | string | boolean };

/** `name.dock.bell` → world.json `names.dock.bell`. */
function fromNames(id: string): Entry | null {
  if (!id.startsWith('name.')) return null;
  let node: unknown = raw.names;
  for (const k of id.slice(5).split('.')) {
    if (typeof node !== 'object' || node === null) return null;
    node = (node as Tree)[k];
  }
  return typeof node === 'object' && node !== null && typeof (node as Entry).text === 'string' ? (node as Entry) : null;
}

/**
 * The text of a content id the simulation speaks in (an interactable's `name`, a card's content): the stations'
 * own content (`contentById`, view/labels/content.ts), else world.json's `names`. Null when nothing names it.
 */
export function textOf(id: string): string | null {
  try {
    return contentById(id).text;
  } catch {
    return fromNames(id)?.text ?? null;
  }
}

/** Fill a template's `{slots}`; an unknown slot is a bug in the template (thrown). */
export function fill(template: string, slots: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (_m, k: string) => {
    const v = slots[k];
    if (v === undefined) throw new Error(`controls: template "${template}" needs {${k}}`);
    return String(v);
  });
}

/** A paint's plain name ("blue"), or null for bare wood and anything texts.json does not name. */
export function paintName(token: string): string | null {
  if (token === 'bare') return null;
  try {
    return colourName(token);
  } catch {
    return null;
  }
}

const c = raw.controls;
const s = raw.said;

/** The list's own words. */
export const LIST = {
  title: c.title.text,
  opener: c.opener.text,
  holding: c.holding.text,
  putDown: c.putDown.text,
  crate: { S: c.crate.S.text, M: c.crate.M.text, L: c.crate.L.text } as Readonly<Record<string, string>>,
  state: Object.fromEntries(Object.entries(c.state).map(([k, v]) => [k, v.text])) as Readonly<Record<keyof typeof c.state, string>>,
} as const;

/** The stations' headings in the list. */
export const STATION_NAMES: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(raw.stations).map(([k, v]) => [k, v.text]));

/** The sentences of the live region, by key (world.json `said`). */
export const SAID = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.text])) as Readonly<Record<keyof typeof s, string>>;
export type SaidKey = keyof typeof s;
