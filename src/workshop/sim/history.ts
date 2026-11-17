/**
 * The seam the history model hangs on (REWRITE.md § E5). P1 does not build
 * the undo stack: P2 builds it first and alone. What P1 guarantees is that
 * every durable change already goes through the world's one `commit`
 * funnel, and that the funnel calls these hooks at exactly the points the
 * stack will need, so P2 replaces `p1History()` with the real thing and no
 * caller changes.
 *
 * Where each rule of § E5 attaches:
 * - rule 1 (commit points) and 2 (effects): `World.commit` applies a batch
 *   in one step and calls `recorded` with the effects, before/after and
 *   writer included.
 * - rule 3 (causes): every visitor action that can lead to a durable
 *   change calls `open` and carries the returned id as its cause.
 * - rule 4 (who is charged): `chargeRest` / `chargeReturn` / `chargeMachine`
 *   decide the cause of effects that are not a direct visitor write. P1
 *   charges `system`; P2 answers with the release window's transaction,
 *   the "last placed" transaction, and hands moving parts over (`claim`).
 * - rule 6 (writer, previous writer): the store keeps a writer per field;
 *   `recorded` receives `previousWriter` for each effect.
 * - rule 7 (writes arrive in order): `admit` may refuse a pending change
 *   whose field a newer transaction has written; the funnel then drops it
 *   and returns it in `refused` so the machine carrying it can say so.
 * - rule 13 (the Button is not in the history): `bracket` freezes the stack
 *   while a rung plays; nothing commits during a bracket at all.
 */
import type { Cause, Effect, Id, TransactionId } from './types.ts';
import type { Writer } from './store.ts';

/** What kind of visitor action opened a transaction. */
export type ActionKind = 'release' | 'place' | 'plug' | 'turn' | 'press' | 'text';

/** One durable change asked for, before it is admitted. */
export interface Change {
  readonly target: Id;
  readonly field: string;
  readonly after: Effect['after'];
}

/** An effect as the history sees it: the effect plus the writer it replaced. */
export interface Recorded {
  readonly effect: Effect;
  readonly previousWriter: Writer;
}

export interface HistoryHooks {
  /** A visitor action opens a transaction (§ E5 rule 3); returns its id. `subject` is the part, cord or handle. */
  open(kind: ActionKind, subject: Id, step: number): TransactionId;
  /** Rule 7: may this change commit, given the field's current writer? */
  admit(change: Change, cause: Cause, writer: Writer): boolean;
  /** Rule 2/6: the funnel applied these effects (all in one step). */
  recorded(entries: readonly Recorded[], step: number): void;
  /** Rule 4: who is charged when a part that was set moving comes to rest. */
  chargeRest(part: Id, step: number): Cause;
  /** Rule 4, last bullet: who is charged when a part comes back up the chute. */
  chargeReturn(part: Id, step: number): Cause;
  /** Rule 4, "a moving part has one owner": the visitor took hold of `part` under transaction `by` (or by `crew`). */
  claim(part: Id, by: Cause, step: number): void;
  /** The Button's bracket opened (true) or closed (false): the stack is frozen in between. */
  bracket(on: boolean): void;
}

/**
 * P1's history: no stack. Transactions are numbered so causes are real
 * `TransactionId`s already; everything not directly written by the
 * visitor is charged to `system` (marked SEAM below for P2).
 */
export function p1History(): HistoryHooks & { readonly opened: number } {
  let n = 0;
  return {
    get opened() {
      return n;
    },
    open() {
      n += 1;
      return `t${n}`;
    },
    admit: () => true,
    recorded: () => {},
    // SEAM (§ E5 rule 4): P2 charges a rest to the release window's transaction that set the part moving.
    chargeRest: () => 'system',
    // SEAM (§ E5 rule 4): P2 charges a chute return like a machine effect (the transaction that last placed the part).
    chargeReturn: () => 'system',
    claim: () => {},
    bracket: () => {},
  };
}
