/**
 * The replay check and the invariants of REWRITE.md § E5 "What the tests
 * hold", as an observer of a world's event stream. It knows nothing of how
 * the history is built: it reads effects, undos, put-aways and resets as
 * they are announced, and the durable state and the stack as the world
 * shows them.
 *
 * The replay: the durable state must equal the starting state with, in
 * order, every recorded effect applied whose transaction has not been
 * undone. Two refinements the spec implies:
 * - an effect about a part that Revert later put away is no longer the
 *   transaction's to take back (rule 14 deletes the entry): it survives an
 *   undo of its transaction, and its writer is `settled`;
 * - a surviving effect whose transaction is no longer on the stack (it was
 *   forgotten) has writer `settled`.
 * "Reset the workshop" starts the replay over from the starting state.
 */
import type { World } from '../../../src/workshop/sim/world.ts';
import type { Id, Location, SimEvent, TransactionId, Value, Writer } from '../../../src/workshop/sim/types.ts';
import { sameValue } from '../../../src/workshop/sim/store.ts';

interface Item {
  /** Index of the field (in the world's `durable()` order). */
  readonly i: number;
  readonly cause: Writer;
  readonly after: Value;
  detached: boolean;
  dropped: boolean;
}

interface Slot {
  readonly value: Value;
  readonly writer: Writer;
}

const isTxn = (w: Writer): w is TransactionId => w !== 'crew' && w !== 'system' && w !== 'settled';
const num = (t: TransactionId): number => Number(t.slice(1));
const k = (t: Id, f: string): string => `${t}.${f}`;

export interface Checker {
  /** Feed one step's events; throws with a description on the first violation. */
  step(events: readonly SimEvent[], stepNo: number): void;
  /** Steps checked, undos seen, effects seen (so a test can show it exercised something). */
  readonly stats: { steps: number; undone: number; refusedUndo: number; effects: number; kept: number; putAway: number; resets: number; restores: number };
}

export function checker(world: World, opts: { jacks: readonly Id[]; parts: readonly Id[] }): Checker {
  const first = world.durable();
  const keys = first.map((d) => k(d.target, d.field));
  const index = new Map(keys.map((key, i) => [key, i]));
  const at = (target: Id, field: string): number => index.get(k(target, field)) as number;
  const start: Slot[] = first.map((d) => ({ value: d.value, writer: d.writer }));
  const locations = opts.parts.map((id) => at(id, 'location'));
  const jackAt = at('cord', 'jack');
  let log: Item[][] = keys.map(() => []);
  /** The last surviving effect per field (null: none, so the starting value; undefined: to be found again). */
  let last: (Item | null | undefined)[] = keys.map(() => null);
  const byCause = new Map<TransactionId, Item[]>();
  const byTarget = new Map<Id, Item[]>();
  const putAwayAt = new Map<Id, number>();
  let prev: Slot[] = start;
  const stats = { steps: 0, undone: 0, refusedUndo: 0, effects: 0, kept: 0, putAway: 0, resets: 0, restores: 0 };

  const fail = (msg: string): never => {
    throw new Error(msg);
  };

  function expected(i: number, onStack: ReadonlySet<string>): Slot {
    let it = last[i];
    if (it === undefined) {
      it = null;
      const items = log[i] as Item[];
      for (let j = items.length - 1; j >= 0; j--) {
        if ((items[j] as Item).dropped) continue;
        it = items[j] as Item;
        break;
      }
      last[i] = it;
    }
    if (!it) return start[i] as Slot;
    // its writer: settled once its transaction is forgotten, or the part it is about was put away
    const writer = isTxn(it.cause) && (it.detached || !onStack.has(it.cause)) ? 'settled' : it.cause;
    return { value: it.after, writer };
  }

  return {
    stats,
    step(events, stepNo) {
      stats.steps += 1;
      const writtenNow = new Set<number>();
      const undoneNow: Extract<SimEvent, { type: 'undone' }>[] = [];
      for (const e of events) {
        if (e.type === 'effect') {
          stats.effects += 1;
          const i = at(e.effect.target, e.effect.field);
          const it: Item = { i, cause: e.effect.cause, after: e.effect.after, detached: false, dropped: false };
          writtenNow.add(i);
          last[i] = it;
          (log[i] as Item[]).push(it);
          if (isTxn(e.effect.cause)) {
            if (!byCause.has(e.effect.cause)) byCause.set(e.effect.cause, []);
            byCause.get(e.effect.cause)!.push(it);
          }
          if (!byTarget.has(e.effect.target)) byTarget.set(e.effect.target, []);
          byTarget.get(e.effect.target)!.push(it);
        } else if (e.type === 'put-away') {
          stats.putAway += 1;
          putAwayAt.set(e.id, stepNo);
          for (const it of byTarget.get(e.id) ?? []) if (isTxn(it.cause)) it.detached = true;
        } else if (e.type === 'undone') {
          stats.undone += 1;
          stats.kept += e.kept.length;
          stats.restores += e.restores.length;
          undoneNow.push(e);
          for (const it of byCause.get(e.txn) ?? [])
            if (!it.detached) {
              it.dropped = true;
              last[it.i] = undefined;
            }
        } else if (e.type === 'undo.refused') {
          stats.refusedUndo += 1;
        } else if (e.type === 'reset') {
          stats.resets += 1;
          log = keys.map(() => []);
          last = keys.map(() => null);
          byCause.clear();
          byTarget.clear();
        }
      }

      const stack = world.undoStack();
      const onStack = new Set<string>(stack.map((t) => t.id));
      const now: Slot[] = world.durable();
      const okWriter = (w: Writer): boolean => !isTxn(w) || onStack.has(w);

      // the replay check
      for (let i = 0; i < keys.length; i++) {
        const want = expected(i, onStack);
        const got = now[i] as Slot;
        if (!sameValue(want.value, got.value) || want.writer !== got.writer)
          fail(`replay: ${keys[i]} is ${JSON.stringify({ value: got.value, writer: got.writer })} but the surviving effects give ${JSON.stringify(want)}`);
        // invariant: every field's writer is on the stack, crew, system or settled
        if (!okWriter(got.writer)) fail(`writer: ${keys[i]} is written by ${got.writer}, which is not on the stack`);
      }
      // invariant: every entry's previous writer is on the stack, crew, system or settled; a transaction is older
      for (const t of stack) {
        for (const e of t.entries) {
          if (!okWriter(e.previousWriter)) fail(`entry ${t.id} ${e.target}.${e.field}: previous writer ${e.previousWriter} is not on the stack`);
          if (isTxn(e.previousWriter) && num(e.previousWriter) >= num(t.id)) fail(`entry ${t.id} ${e.target}.${e.field}: previous writer ${e.previousWriter} is not older`);
          // invariant: no entry points at a part that has been put away
          const away = putAwayAt.get(e.target);
          if (away !== undefined && e.created <= away) fail(`entry ${t.id} names ${e.target}, put away at step ${away}`);
        }
      }
      // invariant: no field written by crew or system since is changed by an undo (nor a settled one)
      if (undoneNow.length > 0) {
        for (let i = 0; i < keys.length; i++) {
          const was = prev[i] as Slot;
          if (writtenNow.has(i) || isTxn(was.writer)) continue; // crew, system and settled fields are never an undo's
          const is = now[i] as Slot;
          if (!sameValue(is.value, was.value) || is.writer !== was.writer) fail(`undo changed ${keys[i]}, last written by ${was.writer}`);
        }
        // every restore was of a field the undone transaction still wrote (several undos in one step run in order)
        const through = [...prev];
        for (const u of undoneNow)
          for (const r of u.restores) {
            const i = at(r.target, r.field);
            const was = through[i] as Slot;
            through[i] = { value: r.to, writer: r.writer };
            if (writtenNow.has(i) || (sameValue(r.from, r.to) && r.writer === was.writer)) continue; // a recall: a part caught mid-flight, nothing durable changed
            if (was.writer !== u.txn) fail(`undo of ${u.txn} restored ${keys[i]}, whose writer was ${was.writer}`);
          }
      }
      // invariant: every part has exactly one location, and the cord is in exactly one jack
      for (let j = 0; j < locations.length; j++) {
        const l = (now[locations[j] as number] as Slot).value as Location | undefined;
        if (!l || !(l.at === 'rest' || l.at === 'in' || l.at === 'shipped')) fail(`${opts.parts[j]} has no location`);
      }
      const jack = (now[jackAt] as Slot).value;
      if (typeof jack !== 'string' || !opts.jacks.includes(jack)) fail(`the cord is not in exactly one jack: ${String(jack)}`);
      prev = now;
    },
  };
}
