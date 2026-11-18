/**
 * History and undo (REWRITE.md § E5). Undo restores recorded values; it
 * never runs an action backwards, and no machine has inverse code.
 *
 * The world owns the one commit funnel (`World.commit`) and calls the hooks
 * below at fixed points; this module owns the stack and decides who is
 * charged. Where each rule of § E5 lives:
 *
 * - rule 1 (commit points), 2 (effects): the funnel applies a batch in one
 *   step and hands the effects to `recorded`, with the writer each replaced.
 * - rule 3 (causes): a visitor action calls `open` and carries the id.
 *   Only transactions go on the stack; `crew` and `system` never do.
 * - rule 4 (who is charged): `work` (instructions: the sender, however long
 *   it takes), `chargeMachine` (a machine's effect on a part: whoever last
 *   placed it), the release window (`claim`, `disturbed`, `take`,
 *   `chargeRest`), and `chargeReturn` (the chute, like a machine effect).
 * - rule 5 (single writers): `admit` refuses the crew a setting, or a part
 *   the visitor touched, in play mode.
 * - rule 6 (writer, previous writer): one `Entry` per field per transaction.
 * - rule 7 (writes arrive in order): `admit` refuses a change whose field a
 *   newer transaction has written; the funnel returns it as `refused`.
 * - rules 8-12 (the lever, putting back, unfinished business, one step,
 *   "undo that"): `undo`. The world applies the bodies and emits `undone`.
 * - rule 13 (not in the history): nothing here knows the camera, panels or
 *   the Button; `bracket` freezes the stack while a rung plays.
 * - rule 14 (forgetting): the depth limit in `open`, `putAway`, and `prune`.
 *
 * Decisions where § E5 is silent or loose (each also noted at its place):
 * - D1 A transaction writing a field it already holds an entry for, after
 *   the crew or the system wrote it in between, re-bases the entry (before =
 *   the crew's value, previous writer = crew). Rule 6 says "later writes only
 *   update `after`", but then the lever would restore a value the crew's
 *   surviving write had replaced, which the replay check rightly forbids.
 * - D2 At most one release window is open: the newest transaction's. Any
 *   `open` closes the older one and hands over what still moves (rule 4,
 *   "starts another action"), whatever kind of action it is. Picking a moving
 *   part up takes it out of the window at once; the window then goes on.
 * - D3 A window closes when its last part rests, or after six seconds;
 *   anything still moving then rests charged to `system` (or the cause the
 *   world gave it), as the spec's "six seconds at most" says.
 * - D4 A transaction that is undone, cancelled, pruned or forgotten never
 *   commits again: `admit` refuses it. Work begun under a transaction that
 *   is then *forgotten* (thirty newer actions while Patch works) still
 *   completes, charged to `system` (it can no longer be undone).
 * - D5 "Undo that" is not itself a transaction (it is an undo request).
 * - D6 Committing under a transaction id that was never opened is a bug and
 *   throws.
 * - D7 A crew member may write its own fields (any part of kind `robot`)
 *   whoever touched it: Fetch comes back up the chute "written by crew".
 */
import type { ActionKind, Cause, Effect, Id, Kept, PartKind, Restore, TransactionId, UndoBy, Value, Writer } from './types.ts';
import type { Store } from './store.ts';
import type { CommitResult } from './context.ts';
import { steps } from './clock.ts';

export type { ActionKind } from './types.ts';

/** Tune here. */
export const HISTORY_TUNING = {
  /** Rule 14: the stack holds this many transactions. */
  depth: 30,
  /** Rule 4: a release window stays open at most this long, seconds. */
  window: 6,
} as const;

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

/** Rule 6: what one transaction holds about one field. */
export interface Entry {
  readonly target: Id;
  readonly field: string;
  /** The value the field had when this transaction first wrote it (or, D1, when it last re-based). */
  readonly before: Value;
  /** The writer the field had at that moment. */
  readonly previousWriter: Writer;
  /** The value this transaction last wrote. */
  readonly after: Value;
  /** The step the entry was made. */
  readonly created: number;
  /** Global order of the last write (larger is later); undo runs these backwards. */
  readonly seq: number;
}

/** A transaction on the stack, read-only (tests, the UI's lever, Revert). */
export interface TransactionView {
  readonly id: TransactionId;
  readonly kind: ActionKind;
  /** The part, cord or handle acted on; for `text`, the jack the instruction went through. */
  readonly subject: Id;
  readonly opened: number;
  readonly entries: readonly Entry[];
  /** Owners of work still pending under it (rule 10). */
  readonly pending: readonly Id[];
  /** Parts still moving in its release window. */
  readonly moving: readonly Id[];
}

/** What the history needs from the world. */
export interface HistoryPort {
  readonly store: Store;
  /** The world's funnel. */
  commit(changes: readonly Change[], cause: Cause): CommitResult;
  /** A part's kind, or undefined for a setting. */
  kindOf(target: Id): PartKind | undefined;
  touched(target: Id): boolean;
  playMode(): boolean;
}

/**
 * Work a machine will finish later, under the cause it was begun with
 * (rule 4: "charged to the transaction that sent it, however long Patch
 * takes"). While a job is active its transaction cannot leave the stack.
 */
export interface Job {
  readonly cause: Cause;
  readonly owner: Id;
  /** False once done or cancelled: then `commit` applies nothing and returns every change as refused. */
  readonly active: boolean;
  /** Commit through the funnel under this job's cause. Refused changes (rule 7) come back in `refused`. */
  commit(changes: readonly Change[]): CommitResult;
  /** The work is finished (or given up); call it whatever happened. */
  done(): void;
}

export type UndoRequest = { readonly by: 'lever' } | { readonly by: 'text'; readonly jack: Id };

/** The durable half of an undo; the world adds the bodies and emits the `undone` event. */
export interface Undone {
  readonly txn: TransactionId;
  readonly action: ActionKind;
  readonly by: UndoBy;
  /** Already applied, most recent change first. No `pose` yet (the world knows the bodies). */
  readonly restores: readonly Restore[];
  /** Parts that were still moving in this transaction's window: the world puts them back at their durable location. */
  readonly recalled: readonly Id[];
  readonly kept: readonly Kept[];
  readonly cancelled: readonly Id[];
}

export type UndoOutcome =
  | { readonly ok: true; readonly undone: Undone }
  | { readonly ok: false; readonly reason: 'nothing' | 'changed-since' | 'frozen'; readonly txn: TransactionId | null };

export interface HistoryHooks {
  /** The world hands over its store and funnel, once, before anything happens. */
  bind(port: HistoryPort): void;
  /** Rule 3: a visitor action opens a transaction; returns its id. `subject`: the part, cord or handle; for a text, the jack. */
  open(kind: ActionKind, subject: Id, step: number): TransactionId;
  /** Rules 5, 7, D4: may this change commit, given the field's current writer? */
  admit(change: Change, cause: Cause, writer: Writer): boolean;
  /** Rules 2, 6: the funnel applied these effects (all in one step). */
  recorded(entries: readonly Recorded[], step: number): void;
  /** Rule 4: a part that was moving has come to rest. `fallback` is the cause the world holds for it (`crew` after a fumble). */
  chargeRest(part: Id, step: number, fallback?: Cause | null): Cause;
  /** Rule 4, last bullet: a part comes back up the chute. */
  chargeReturn(part: Id, step: number): Cause;
  /** Rule 4: who is charged for an effect a machine applies to `part` (the transaction that last placed it, while on the stack). */
  chargeMachine(part: Id): Cause;
  /** Rule 4: the visitor let go of `part` under transaction `by`; it is that transaction's until it rests. */
  claim(part: Id, by: Cause, step: number): void;
  /** Rule 4: the visitor took hold of `part`; it leaves any window at once. */
  take(part: Id): void;
  /** Rule 4: a part that was at rest has been set moving (by something else moving). */
  disturbed(part: Id): void;
  /** Rule 4, 10: begin work that commits later under `cause`. `abort` drops it and returns the owner to idle. */
  work(cause: Cause, owner: Id, abort: () => void): Job;
  /** Rules 8-12: take a transaction back. Restores the durable fields; the world does the rest. */
  undo(req: UndoRequest, step: number): UndoOutcome;
  /** Rule 14: Revert is putting `part` away. Every entry about it is deleted and its writers settled. */
  putAway(part: Id): void;
  /** "Reset the workshop": cancel everything pending and empty the stack. Returns the owners whose work was cancelled. */
  reset(): readonly Id[];
  /** End of every step: windows time out, empty transactions leave the stack. */
  endStep(step: number): void;
  /** The Button's bracket opened (true) or closed (false): the stack is frozen in between. */
  bracket(on: boolean): void;
  /** The stack, oldest first. */
  stack(): readonly TransactionView[];
}

const isTxn = (c: Writer | null | undefined): c is TransactionId => typeof c === 'string' && c !== 'crew' && c !== 'system' && c !== 'settled';
const num = (id: TransactionId): number => Number(id.slice(1));
const key = (target: Id, field: string): string => `${target}\u0000${field}`;

interface MEntry {
  target: Id;
  field: string;
  before: Value;
  previousWriter: Writer;
  after: Value;
  created: number;
  seq: number;
}

interface Txn {
  readonly id: TransactionId;
  readonly kind: ActionKind;
  readonly subject: Id;
  readonly opened: number;
  readonly entries: Map<string, MEntry>;
  readonly jobs: Set<JobImpl>;
}

interface JobImpl extends Job {
  active: boolean;
  readonly txn: Txn | null;
  readonly abort: () => void;
}

interface Window {
  readonly txn: Txn;
  readonly members: Set<Id>;
  left: number;
}

/** The real history: the undo stack of § E5. */
export function createHistory(): HistoryHooks {
  let port: HistoryPort | null = null;
  let issued = 0;
  let stack: Txn[] = [];
  const live = new Map<TransactionId, Txn>();
  let window: Window | null = null;
  let frozen = false;
  let seq = 0;
  const WINDOW = steps(HISTORY_TUNING.window);

  const P = (): HistoryPort => {
    if (!port) throw new Error('history: not bound to a world');
    return port;
  };
  const known = (id: TransactionId): boolean => {
    const n = num(id);
    return Number.isInteger(n) && n >= 1 && n <= issued;
  };
  const busy = (t: Txn): boolean => t.entries.size > 0 || t.jobs.size > 0 || window?.txn === t;

  function drop(t: Txn): void {
    stack = stack.filter((x) => x !== t);
    live.delete(t.id);
    if (window?.txn === t) window = null;
  }

  /** Rule 14: "a transaction with no entries and nothing pending leaves the stack". Only those opened before `before`. */
  function prune(before = Infinity): void {
    for (const t of [...stack]) if (t.opened < before && !busy(t)) drop(t);
  }

  /** Rule 14: the oldest drops off; wherever it was a writer or a previous writer, that becomes `settled`. */
  function forget(t: Txn): void {
    drop(t);
    const store = P().store;
    for (const { target, field, slot } of store.entries()) if (slot.writer === t.id) store.setWriter(target, field, 'settled');
    for (const o of stack) for (const e of o.entries.values()) if (e.previousWriter === t.id) e.previousWriter = 'settled';
    // its jobs carry on (D4): they commit as `system` from now on (see `work`)
  }

  function chargeMachine(part: Id): Cause {
    if (window?.members.has(part)) return window.txn.id;
    const w = P().store.writer(part, 'location');
    if (isTxn(w) && live.has(w)) return w;
    return w === 'crew' ? 'crew' : 'system';
  }

  const view = (t: Txn): TransactionView => ({
    id: t.id,
    kind: t.kind,
    subject: t.subject,
    opened: t.opened,
    entries: [...t.entries.values()].map((e) => Object.freeze({ ...e })),
    pending: [...t.jobs].map((j) => j.owner),
    moving: window?.txn === t ? [...window.members] : [],
  });

  return {
    bind(p) {
      if (port) throw new Error('history: already bound');
      port = p;
    },

    open(kind, subject, step) {
      if (frozen) throw new Error('history: no transaction opens while a Button rung is bracketed');
      prune(step); // so an empty transaction never takes one of the thirty places
      issued += 1;
      const t: Txn = { id: `t${issued}`, kind, subject, opened: step, entries: new Map(), jobs: new Set() };
      stack.push(t);
      live.set(t.id, t);
      // Rule 4, "a moving part has one owner" (D2): the older window closes now, holding only what has
      // already come to rest; everything still moving passes to the new transaction.
      if (window) window = window.members.size > 0 ? { txn: t, members: new Set(window.members), left: WINDOW } : null;
      while (stack.length > HISTORY_TUNING.depth) forget(stack[0] as Txn);
      return t.id;
    },

    admit(change, cause, writer) {
      if (frozen) return false;
      if (isTxn(cause)) {
        if (!known(cause)) throw new Error(`history: transaction ${cause} was never opened (D6)`);
        if (!live.has(cause)) return false; // D4: undone, cancelled, pruned or forgotten
        if (isTxn(writer) && num(writer) > num(cause)) return false; // rule 7
        return true;
      }
      if (cause === 'crew' && P().playMode()) {
        // rule 5: in play mode the crew never changes a setting, nor a part the visitor touched (D7: except itself)
        const kind = P().kindOf(change.target);
        if (kind === undefined) return false;
        if (kind !== 'robot' && P().touched(change.target)) return false;
      }
      return true;
    },

    recorded(list, step) {
      for (const r of list) {
        const { target, field, before, after, cause } = r.effect;
        // a part given a durable location by anyone is no longer moving in a window
        if (field === 'location') window?.members.delete(target);
        if (!isTxn(cause)) continue;
        const t = live.get(cause);
        if (!t) throw new Error(`history: ${cause} committed without being admitted`);
        const k = key(target, field);
        const e = t.entries.get(k);
        seq += 1;
        if (!e) {
          t.entries.set(k, { target, field, before, previousWriter: r.previousWriter, after, created: step, seq });
          continue;
        }
        if (r.previousWriter !== cause) {
          // D1: the crew or the system wrote this field since this transaction did: re-base the entry, so
          // undoing it gives back what that surviving write left, not a value it replaced.
          e.before = before;
          e.previousWriter = r.previousWriter;
        }
        e.after = after;
        e.seq = seq;
      }
    },

    chargeRest(part, _step, fallback) {
      if (window?.members.has(part)) {
        window.members.delete(part);
        return window.txn.id;
      }
      if (fallback && (!isTxn(fallback) || live.has(fallback))) return fallback;
      return 'system';
    },

    chargeReturn(part) {
      return chargeMachine(part);
    },

    chargeMachine,

    claim(part, by) {
      if (!isTxn(by)) return;
      const t = live.get(by);
      if (!t) return;
      if (!window) window = { txn: t, members: new Set(), left: WINDOW };
      else if (window.txn !== t && num(t.id) > num(window.txn.id)) window = { txn: t, members: new Set(window.members), left: WINDOW };
      window.members.add(part); // D2: the newest transaction owns every moving part
    },

    take(part) {
      window?.members.delete(part);
    },

    disturbed(part) {
      if (!frozen && window) window.members.add(part);
    },

    work(cause, owner, abort) {
      let txn: Txn | null = null;
      let active = true;
      if (isTxn(cause)) {
        if (!known(cause)) throw new Error(`history: transaction ${cause} was never opened (D6)`);
        txn = live.get(cause) ?? null;
        if (!txn) active = false; // already undone: nothing will ever commit
      }
      const job: JobImpl = {
        cause,
        owner,
        active,
        txn,
        abort,
        commit(changes) {
          if (!job.active) return { effects: [], refused: [...changes] };
          // D4: a transaction forgotten while its work was pending can no longer be undone: charge `system`
          const c: Cause = job.txn ? (live.has(job.txn.id) ? job.txn.id : 'system') : job.cause;
          return P().commit(changes, c);
        },
        done() {
          job.active = false;
          job.txn?.jobs.delete(job);
        },
      };
      if (job.active && txn) txn.jobs.add(job);
      return job;
    },

    undo(req, _step) {
      if (frozen) return { ok: false, reason: 'frozen', txn: null };
      prune();
      const t = req.by === 'lever' ? stack.at(-1) : stack.findLast((x) => x.kind === 'text' && x.subject === req.jack);
      if (!t) return { ok: false, reason: 'nothing', txn: null };
      const store = P().store;
      if (req.by === 'text') {
        // rule 12: all or nothing; only if it is still the writer of every field it wrote
        for (const e of t.entries.values()) if (store.writer(e.target, e.field) !== t.id) return { ok: false, reason: 'changed-since', txn: t.id };
      }
      // rule 10: cancel everything pending under it first; nothing more commits (it is off the stack before any abort runs)
      const recalled = window?.txn === t ? [...window.members] : [];
      drop(t);
      const cancelled: Id[] = [];
      for (const job of [...t.jobs]) {
        job.active = false;
        t.jobs.delete(job);
        if (!cancelled.includes(job.owner)) cancelled.push(job.owner);
        job.abort();
      }
      // rule 8, in the order to be seen backwards (rule 11: all in this one step)
      const restores: Restore[] = [];
      const kept: Kept[] = [];
      for (const e of [...t.entries.values()].sort((a, b) => b.seq - a.seq)) {
        const slot = store.slot(e.target, e.field);
        if (!slot) continue;
        if (slot.writer === t.id) {
          store.write(e.target, e.field, e.before, e.previousWriter);
          restores.push({ target: e.target, field: e.field, from: slot.value, to: e.before, writer: e.previousWriter });
        } else kept.push({ target: e.target, field: e.field, writer: slot.writer });
      }
      return { ok: true, undone: { txn: t.id, action: t.kind, by: req.by, restores, recalled, kept, cancelled } };
    },

    putAway(part) {
      for (const t of stack) for (const [k, e] of [...t.entries]) if (e.target === part) t.entries.delete(k);
      const store = P().store;
      for (const f of store.fields(part)) if (isTxn(store.writer(part, f))) store.setWriter(part, f, 'settled');
      window?.members.delete(part);
    },

    reset() {
      const all = stack;
      stack = [];
      live.clear();
      window = null;
      const cancelled: Id[] = [];
      for (const t of all)
        for (const job of [...t.jobs]) {
          job.active = false;
          t.jobs.delete(job);
          if (!cancelled.includes(job.owner)) cancelled.push(job.owner);
          job.abort();
        }
      return cancelled;
    },

    endStep() {
      if (frozen) return;
      if (window) {
        window.left -= 1;
        if (window.members.size === 0 || window.left <= 0) window = null; // D3
      }
      prune();
    },

    bracket(on) {
      frozen = on;
    },

    stack: () => stack.map(view),
  };
}

/**
 * No history at all: every transaction is numbered but nothing is kept and
 * nothing can be undone. For tests of the commit funnel alone, and as the
 * smallest correct implementation of the hooks.
 */
export function p1History(): HistoryHooks & { readonly opened: number } {
  let n = 0;
  let port: HistoryPort | null = null;
  return {
    get opened() {
      return n;
    },
    bind(p) {
      port = p;
    },
    open() {
      n += 1;
      return `t${n}`;
    },
    admit: () => true,
    recorded: () => {},
    chargeRest: (_part, _step, fallback) => fallback ?? 'system',
    chargeReturn: () => 'system',
    chargeMachine: () => 'system',
    claim: () => {},
    take: () => {},
    disturbed: () => {},
    work(cause, owner) {
      const job = {
        cause,
        owner,
        active: true,
        commit: (changes: readonly Change[]): CommitResult => (job.active && port ? port.commit(changes, cause) : { effects: [], refused: [...changes] }),
        done() {
          job.active = false;
        },
      };
      return job;
    },
    undo: () => ({ ok: false, reason: 'nothing', txn: null }),
    putAway: () => {},
    reset: () => [],
    endStep: () => {},
    bracket: () => {},
    stack: () => [],
  };
}
