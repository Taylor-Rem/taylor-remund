/**
 * The phone line: what the phone panel needs from the Patchlamp station
 * (REWRITE.md § D 3, § B2 X1). The panel is HTML over the stage; it holds no
 * facts and decides nothing. It shows what the line says happened and hands
 * the visitor's text to the line. The station implements this; until it
 * exists, `fake.ts` stands in for it on the dev page and in the tests.
 *
 * The line speaks in reply ids (sim/instruct `Reply`); the panel turns them
 * into words with src/content/texts.ts. Nothing the visitor types is stored
 * by the panel beyond the open page, and nothing leaves the browser.
 */
import type { Jack, RefusalReason, Reply } from '../../sim/instruct/types.ts';

export type { Jack, RefusalReason, Reply };

/**
 * One thing that happened on the line. `id` ties a text to the events it
 * caused; ids are unique for the visit and increase.
 */
export type PhoneEvent =
  /** A text went down the line (the visitor's, or Fetch's in attract mode). `text` is as typed. */
  | { readonly type: 'sent'; readonly id: number; readonly jack: Jack; readonly text: string }
  /** Patch has picked text `id` up and is doing the job (the line's lamp is steady). */
  | { readonly type: 'working'; readonly id: number }
  /** Patch made the change (or answered help, who, thanks, undo) and texts back. */
  | { readonly type: 'reply'; readonly id: number; readonly reply: Reply; readonly mailbox: boolean }
  /** Patch did not do it: the slip it texts back says why. Never a bare "no". */
  | { readonly type: 'refused'; readonly id: number; readonly reason: RefusalReason; readonly reply: Reply; readonly mailbox: boolean }
  /** The cord moved: the jack it is in now, or null while it is out (held, or in a capped jack). */
  | { readonly type: 'jack'; readonly jack: Jack | null };

export interface PhoneLine {
  /** The jack the cord is in right now, or null while it is out. */
  readonly jack: Jack | null;
  /**
   * Everything that has happened on the line this visit, oldest first,
   * starting with the attract-mode exchange (world.json `phone.attract`).
   * The panel replays it when it is made, then follows `subscribe`.
   */
  log(): readonly PhoneEvent[];
  /**
   * Send the visitor's text (already trimmed, 1 to 240 characters) down the
   * line to the jack the cord is in. The line answers with events: `sent` at
   * once, then `working`, then `reply` or `refused`. Called only while
   * `jack` is not null. A text sent while Patch is busy waits its turn; that
   * is the line's business, not the panel's.
   */
  send(text: string): void;
  /** Hear each event as it happens (after it is in `log()`). Returns the unsubscribe. */
  subscribe(listener: (event: PhoneEvent) => void): () => void;
}
