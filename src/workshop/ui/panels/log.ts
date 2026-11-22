/**
 * The maker's plate's live log (REWRITE.md § G "P4 as Taylor amended it": the
 * plate "may show the bench's own workings live: the history the UNDO lever
 * replays"): the undo stack (§ E5) in plain words, newest first, as it stands
 * now. A pull of the lever takes the first group back; a text Patch acted on
 * is in the same history, marked so.
 *
 * Pure: it reads the world and the stack, and writes nothing. The words are
 * the page's (src/content/hatches.json `maker.live.log`, handed in by the
 * panel); the names of things are the controls list's (`plainName`), the paint
 * and picture names the phone's (texts.json), so a thing is called the same
 * everywhere. Tested in Node on the real bench (tests/unit/ui/panels-log.test.ts).
 */
import type { Id, TransactionView, Value, WorldView } from '../../sim/index.ts';
import { PRESS, REPORT_FIELD, SEAL_FIELD } from '../../sim/index.ts';
import textsJson from '../../../content/texts.json';
import { plainName } from '../controls/model.ts';
import { fill, paintName } from '../controls/words.ts';

export interface LogWords {
  field: string;
  state: string;
  moved: string;
  changed: string;
  byText: string;
  /** (P4 D3) A pull of the report press's lever, as one line; and with the envelope sent along the belt. */
  pulled?: string;
  pulledSent?: string;
  fields: Readonly<Record<string, string>>;
  values: Readonly<Record<string, string>>;
  places: Readonly<Record<string, string>>;
}

export interface LogLine {
  /** Stable while the entry stands (the transaction and the field). */
  readonly key: string;
  readonly text: string;
  /** The transaction it belongs to. */
  readonly txn: string;
  /** In the transaction the next pull of the lever takes back. */
  readonly next: boolean;
}

/** How many lines the plate shows (the brief: "the last dozen"). */
export const LOG_LINES = 12;

/** Fields that only say what another field already said (the dock's SHIPPED mark beside `location: shipped`). */
const QUIET = new Set(['marks', 'contents']);
/** The lamp's arm: where the bulb is held. A move, not a value anyone reads. */
const POSITION = new Set(['x', 'z']);

const pictures = (textsJson as { pictures: Record<string, { text: string }> }).pictures;

const same = (a: Value, b: Value): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The name of what a history entry is about. */
function thingName(w: WorldView, id: Id): string {
  return plainName(w, id);
}

function place(w: WorldView, v: Value, words: LogWords): string {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return words.places['away'] ?? '';
  const loc = v as { at?: string; mouth?: string; station?: string };
  if (loc.at === 'rest') return words.places['rest'] ?? '';
  if (loc.at === 'shipped') return words.places['shipped'] ?? '';
  return (loc.mouth && words.places[loc.mouth]) || words.places['away'] || '';
}

function paint(token: Value, words: LogWords): string {
  if (typeof token !== 'string') return String(token);
  if (token === 'bare') return words.values['bare'] ?? token;
  return paintName(token) ?? token;
}

const text = (v: Value, words: LogWords): string => (typeof v === 'string' && v.trim() !== '' ? v : (words.values['blank'] ?? ''));

/** One entry in words, or null when it says nothing a person would read (a mark beside a shipment). */
export function entryLine(w: WorldView, e: { target: Id; field: string; before: Value; after: Value }, words: LogWords): string | null {
  if (QUIET.has(e.field) || same(e.before, e.after)) return null;
  const thing = thingName(w, e.target);
  const isPart = w.part(e.target) !== undefined || (w.scene.parts ?? []).some((p) => p.id === e.target);
  const fieldOf = (key: string, from: string, to: string): string => fill(words.field, { thing, field: words.fields[key] ?? key, from, to });
  const stateOf = (from: string, to: string): string => fill(words.state, { thing, from, to });
  const V = words.values;
  switch (e.field) {
    case 'location': {
      const from = place(w, e.before, words);
      const to = place(w, e.after, words);
      return from === to ? fill(words.moved, { thing }) : stateOf(from, to);
    }
    case 'colour':
      return isPart ? fieldOf('colour', paint(e.before, words), paint(e.after, words)) : fieldOf('lampColour', paint(e.before, words), paint(e.after, words));
    case 'label':
      return fieldOf('label', text(e.before, words), text(e.after, words));
    case 'words':
      return fieldOf('words', text(e.before, words), text(e.after, words));
    case 'sign':
    case 'awning':
      return fieldOf(e.field, paint(e.before, words), paint(e.after, words));
    case 'picture': {
      const p = (v: Value): string => (typeof v === 'string' ? (pictures[v]?.text ?? (v === '' || v === 'none' ? (V['blank'] ?? v) : v)) : String(v));
      return fieldOf('picture', p(e.before), p(e.after));
    }
    case 'speed':
    case 'level':
      return fieldOf(e.field, String(e.before), String(e.after));
    case 'running':
      return stateOf(e.before ? (V['running'] ?? '') : (V['stopped'] ?? ''), e.after ? (V['running'] ?? '') : (V['stopped'] ?? ''));
    case 'direction':
      return stateOf(V[String(e.before)] ?? String(e.before), V[String(e.after)] ?? String(e.after));
    case 'on':
      return stateOf(e.before ? (V['on'] ?? '') : (V['off'] ?? ''), e.after ? (V['on'] ?? '') : (V['off'] ?? ''));
    case 'open':
      return stateOf(e.before ? (V['open'] ?? '') : (V['closed'] ?? ''), e.after ? (V['open'] ?? '') : (V['closed'] ?? ''));
    case 'jack':
      return stateOf(typeof e.before === 'string' ? plainName(w, e.before) : '', typeof e.after === 'string' ? plainName(w, e.after) : '');
    default:
      return POSITION.has(e.field) ? fill(words.moved, { thing }) : fill(words.changed, { thing });
  }
}

/** The stack (oldest first, as `World.undoStack` gives it) as the plate's lines: newest first, at most `max`. */
export function historyLines(w: WorldView, stack: readonly TransactionView[], words: LogWords, max = LOG_LINES): LogLine[] {
  const out: LogLine[] = [];
  for (let i = stack.length - 1; i >= 0 && out.length < max; i--) {
    const t = stack[i]!;
    const seen = new Set<string>();
    let entries = [...t.entries].sort((a, b) => b.seq - a.seq);
    // (P4 D3) a pull of the report press's lever is one line: what it printed, its stored copy and the envelope's
    // going are one thing the lever takes back together, not four field changes
    const pull = words.pulled !== undefined && entries.find((e) => e.target === PRESS.body && e.field === REPORT_FIELD);
    if (pull && out.length < max) {
      const sent = entries.some((e) => e.target === PRESS.envelope && e.field === SEAL_FIELD);
      const thing = thingName(w, PRESS.body);
      out.push({ key: `${t.id}\u0000${PRESS.body}\u0000pull`, text: fill(sent ? (words.pulledSent ?? words.pulled!) : words.pulled!, { thing }), txn: t.id, next: i === stack.length - 1 });
      entries = entries.filter((e) => e.target !== PRESS.body && e.target !== PRESS.envelope);
    }
    for (const e of entries) {
      if (out.length >= max) break;
      let line = entryLine(w, e, words);
      if (line === null) continue;
      if (t.kind === 'text') line = fill(words.byText, { line });
      if (seen.has(line)) continue;
      seen.add(line);
      out.push({ key: `${t.id}\u0000${e.target}\u0000${e.field}`, text: line, txn: t.id, next: i === stack.length - 1 });
    }
  }
  return out;
}

/** A string that changes when the lines do (the DOM is touched only then). */
export const linesKey = (lines: readonly LogLine[]): string => lines.map((l) => `${l.key}=${l.text}${l.next ? '*' : ''}`).join('\n');
