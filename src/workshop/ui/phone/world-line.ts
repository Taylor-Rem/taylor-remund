/**
 * The phone line over the world (REWRITE.md § D 3, § B2 X1): the
 * Patchlamp station's `PhoneLine` (types.ts) for the phone panel, made from
 * the world's read-only view and its intents, and nothing else. It replaces
 * `fake.ts` on the stage.
 *
 * - `send(text)` dispatches a `text` intent; the world's phone line
 *   (sim/machines/line.ts) answers in its own time, one job at a time.
 *   A text sent while a Button rung plays is held here and dispatched when
 *   the rung ends (the world takes no intents but the Button's then).
 * - `sync()` reads the line's view (`LineView.log`, `LineView.line`) and
 *   hears each new entry as a `PhoneEvent`; call it once per frame after
 *   the steps (the shell's `onFrame`, or a `StationView.update`).
 * - The log is the world's own: since S6 its attract mode has the crew
 *   text the platen line (§ B3), logged `by: 'crew'` with a content id
 *   instead of words; the phone shows that content's words. (`attract:
 *   true` still prepends world.json's old fake exchange, for the dev page.)
 *
 * Nothing the visitor types leaves the browser: it goes into the world and
 * is shown back on the phone, nothing more.
 */
import type { Id, Intent, LineEntry, LineView, WorldView } from '../../sim/index.ts';
import { parse } from '../../sim/index.ts';
import world from '../../../content/world.json';
import attractJson from '../../../content/attract.json';
import type { Jack, PhoneEvent, PhoneLine } from './types.ts';

export interface WorldLineOptions {
  /** The world, read only. */
  readonly world: WorldView;
  /** How a visitor's text reaches the world (`World.dispatch`). */
  dispatch(intent: Intent): void;
  /** The phone line's unit id in the scene. Default `line`. */
  readonly line?: Id;
  /**
   * Begin the log with world.json's fake attract-mode exchange. Default false: since S6 the world's own
   * attract mode texts the platen line itself (`by: 'crew'`), and that is in the line's log.
   */
  readonly attract?: boolean;
}

export interface WorldLine extends PhoneLine {
  /** Read the world's line and hear what is new (once per frame, after the steps). */
  sync(): void;
}

const ATTRACT_TEXT = attractJson.text as Record<string, { text: string }>;
/** The words of a crew text, by its content id (`attract.text.make-it-blue`). */
function crewText(content: string | undefined): string {
  const key = content?.replace(/^attract\.text\./, '') ?? '';
  return ATTRACT_TEXT[key]?.text ?? '';
}

export function worldLine(o: WorldLineOptions): WorldLine {
  const lineId = o.line ?? 'line';
  const view = (): LineView | undefined => {
    const v = o.world.machine(lineId);
    return v?.kind === 'line' ? v : undefined;
  };
  const events: PhoneEvent[] = [];
  const listeners = new Set<(e: PhoneEvent) => void>();
  const held: string[] = [];
  const emit = (e: PhoneEvent): void => {
    events.push(e);
    for (const l of listeners) l(e);
  };

  // the attract-mode exchange: Fetch's text to the platen line, as the parser answers it
  let offset = 0;
  if (o.attract === true)
    for (const m of world.phone.attract) {
      const id = ++offset;
      const p = parse(m.text, 'platen');
      events.push({ type: 'sent', id, jack: 'platen', text: m.text });
      events.push({ type: 'working', id });
      events.push(p.kind === 'refusal' ? { type: 'refused', id, reason: p.reason, reply: p.reply, mailbox: p.mailbox } : { type: 'reply', id, reply: p.reply, mailbox: p.mailbox });
    }

  const toPhone = (e: LineEntry): PhoneEvent => {
    const id = e.n + offset;
    switch (e.kind) {
      case 'sent':
        // the crew's text (attract mode) carries a content id, not words: its words are in src/content/attract.json
        return { type: 'sent', id, jack: e.line, text: e.text !== '' ? e.text : crewText(e.content) };
      case 'working':
        return { type: 'working', id };
      case 'reply':
        return { type: 'reply', id, reply: e.reply, mailbox: e.mailbox };
      case 'refused':
        return { type: 'refused', id, reason: e.reason, reply: e.reply, mailbox: e.mailbox };
    }
  };

  /** The absolute index of the next log entry to hear. */
  let next = 0;
  let jack: Jack | null = view()?.line ?? null;

  function sync(): void {
    const v = view();
    if (!v) return;
    // texts held through a rung go now
    if (held.length > 0 && !o.world.bracketed && v.line !== null) for (const text of held.splice(0)) o.dispatch({ type: 'text', text });
    const from = Math.max(next, v.logStart);
    for (let i = from; i < v.logStart + v.log.length; i++) emit(toPhone(v.log[i - v.logStart] as LineEntry));
    next = v.logStart + v.log.length;
    if (v.line !== jack) {
      jack = v.line;
      emit({ type: 'jack', jack });
    }
  }
  sync();

  return {
    get jack() {
      return jack;
    },
    log: () => events.slice(),
    send(text: string) {
      if (jack === null) return;
      if (o.world.bracketed) held.push(text);
      else o.dispatch({ type: 'text', text });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    sync,
  };
}
