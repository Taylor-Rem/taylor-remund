/**
 * The phone panel's state, as a pure fold over the line's events (no DOM),
 * and the words it shows, from src/content. panel.ts draws it.
 */
import phoneJson from '../../../content/phone.json';
import { assertContent } from '../../../content/schema.ts';
import { readyTexts, renderReply } from '../../../content/texts.ts';
import type { Jack, PhoneEvent, Reply } from './types.ts';

export const words = assertContent(phoneJson, 'src/content/phone.json');

/** The text field's limit (sim/instruct MAX_TEXT, in characters). */
export const MAX_CHARS = 240;
/** The "n left" count shows from this many characters typed. */
export const COUNT_FROM = 200;

/** One thing on the screen, oldest first. */
export type Item =
  /** The line changed here: a divider naming it. */
  | { readonly kind: 'line'; readonly jack: Jack | null }
  | { readonly kind: 'sent'; readonly id: number; readonly text: string }
  /** Patch is doing text `id`'s job. Replaced by its answer. */
  | { readonly kind: 'working'; readonly id: number }
  | { readonly kind: 'answer'; readonly id: number; readonly text: string; readonly refused: boolean };

export interface PhoneState {
  readonly jack: Jack | null;
  readonly items: readonly Item[];
  /** The jack the conversation last named (a `line` divider or a sent text): a divider goes in when this changes. */
  readonly shown: Jack | null | undefined;
}

export const initial = (jack: Jack | null): PhoneState => ({ jack, items: [], shown: undefined });

/** Patch's text back, in words. */
export const replyText = (reply: Reply): string => renderReply(reply);

/** The state after one event. Pure. */
export function reduce(s: PhoneState, e: PhoneEvent): PhoneState {
  switch (e.type) {
    case 'jack':
      return { ...s, jack: e.jack };
    case 'sent': {
      const items = [...s.items];
      if (s.shown !== e.jack) items.push({ kind: 'line', jack: e.jack });
      items.push({ kind: 'sent', id: e.id, text: e.text });
      return { ...s, items, shown: e.jack };
    }
    case 'working':
      if (s.items.some((i) => (i.kind === 'working' || i.kind === 'answer') && i.id === e.id)) return s;
      return { ...s, items: [...s.items, { kind: 'working', id: e.id }] };
    case 'reply':
    case 'refused': {
      const answer: Item = { kind: 'answer', id: e.id, text: replyText(e.reply), refused: e.type === 'refused' };
      const at = s.items.findIndex((i) => i.kind === 'working' && i.id === e.id);
      const items = [...s.items];
      if (at >= 0) items[at] = answer;
      else items.push(answer);
      return { ...s, items };
    }
  }
}

export const replay = (jack: Jack | null, log: readonly PhoneEvent[]): PhoneState => log.reduce(reduce, initial(jack));

/** Is Patch doing a job now? */
export const isWorking = (s: PhoneState): boolean => s.items.some((i) => i.kind === 'working');

/** The name of a line ("Storefront line"), or "Not plugged in". */
export const lineName = (jack: Jack | null): string => words.lines[jack ?? 'none'].text;

/** The ready-made texts for a jack: its own first, then the ones every jack answers. None while unplugged. */
export function readyFor(jack: Jack | null): { own: readonly string[]; every: readonly string[] } {
  if (jack === null) return { own: [], every: [] };
  return { own: readyTexts[jack], every: readyTexts.every };
}

/** Fill a `{slot}` in one of the panel's own lines. */
export function fill(text: string, slots: Readonly<Record<string, string | number>>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in slots ? String(slots[k]) : m));
}

/** What the live region says when the cord moves. */
export const lineAnnouncement = (jack: Jack | null): string =>
  jack === null ? lineName(null) + '.' : fill(words.announce.line.text, { line: lineName(jack).toLowerCase() });

/** "12 left", or null below COUNT_FROM characters. Counts characters, not UTF-16 units. */
export function charsLeft(text: string): string | null {
  const n = [...text].length;
  return n < COUNT_FROM ? null : fill(words.compose.left.text, { count: Math.max(0, MAX_CHARS - n) });
}

/** The text the panel would send for a field's value, or null if there is nothing to send. */
export function toSend(value: string): string | null {
  const t = value.trim();
  if (t === '') return null;
  return [...t].slice(0, MAX_CHARS).join('');
}
