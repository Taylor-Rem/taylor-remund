/**
 * The machines' foundation (REWRITE.md § B1, § E4, § E5): small helpers a
 * machine is built from, and the note for whoever writes the next one.
 *
 * ─────────────────────────── How to add a machine ───────────────────────────
 *
 * A machine is a file in `sim/machines/` exporting a factory, and one line
 * in the scene. The world is not edited. The belt is the worked example
 * (`machines/belt.ts`); read it beside this.
 *
 * 1. The scene (`scenes/bench.ts`) lists it and its mouths:
 *
 *      mouths: [{ id: 'belt', machine: 'belt', station: 'line', c, half, drop }],
 *      units:  [belt(LINE.belt), ...],
 *
 *    `belt(spec)` returns a `UnitFactory`: `(ctx: SimContext) => MachineUnit`.
 *    Its numbers come from the scene's tables, never typed in the machine.
 *
 * 2. The factory declares its durable settings and handles, and returns the
 *    unit. A `MachineUnit` is at once the station's registry entry (`id`,
 *    `station`, `name` (a content id), `affordances`, `tell`, `misfire`), a
 *    unit the world steps (`pre`, `post`, `heard`, `restored`, `lost`,
 *    `reset`, `bracket`) and a `Machine` (`accept`, `instruct?`, `abort`) with
 *    a `view()`. The world registers it; register its extra handles yourself
 *    (`ctx.register`), each with a name, a tell and a misfire.
 *
 *      ctx.defineSetting('belt', 'speed', 3, (v) => v === 1 || ... );  // durable, writer `settled`
 *
 * 3. Handles (`intent`): a visitor's action opens a transaction and commits
 *    under it, in the same step (§ E0: the consequence within 100 ms).
 *    `handleTxn` (below) opens one per gesture, so dragging a dial through
 *    four detents is one transaction, not four:
 *
 *      const t = handleTxn(ctx, gesture, 'turn', 'belt-dial');
 *      ctx.commit([{ target: 'belt', field: 'speed', after: 4 }], t);
 *
 * 4. The mouth (law 2): the world calls `accept(part, cause, mouth)` when a
 *    part comes to rest in a mouth of yours. `cause` is who the rest is
 *    charged to (§ E5 rule 4: whoever placed it, while on the stack). Do the
 *    verb, or say what you wanted:
 *
 *      if (!wanted(part)) return { ok: false, wanted: 'slip.belt.wants-x' };  // a content id; the world prints the slip
 *      ctx.commit([{ target: part.id, field: 'location', after: { at: 'in', station, mouth } }], cause);
 *      ctx.take(part.id, unit.id);                         // custody: kinematic, mode `machine`; you `drive` it
 *      const job = ctx.history.work(cause, unit.id, () => drop(part.id));  // rule 10: undo cancels it
 *      return { ok: true };
 *
 *    Everything you later write about that part goes through `job.commit`
 *    (charged to the placer however long it takes, and refused once that
 *    transaction is undone: never commit around it). Call `job.done()` when
 *    the work is over. Hand the part on with `ctx.release(id, v, w, cause)`
 *    (to physics; its next rest is charged to `cause`, normally
 *    `ctx.history.chargeMachine(id)`), out of the world with `ctx.stow`,
 *    back up the chute with `ctx.toChute`.
 *
 * 5. Being undone: rule 10 calls your job's abort (drop the work, go idle;
 *    the world puts the body back). `lost(part, why)` says the world took a
 *    part out of your hands (picked up, undone, reset, put away): forget it.
 *    `restored(restores)` lists what an undo or reset put back in this step;
 *    a part restored `in` your mouth is yours to take again (`ctx.take`, no
 *    commit: its location already says so), its work charged to
 *    `ctx.history.chargeMachine(id)`.
 *
 * 6. Text (a station with a jack): `instruct(cmd, cause)` commits under
 *    `cause` and answers `{ ok: true }`, or what it wanted (a reply id), or
 *    `CHANGED_SINCE` when rule 7 refused the change.
 *
 * 7. While a Button rung plays (`ctx.bracketed`) nothing commits (commit
 *    throws): pause your work in `pre`/`post`. Misfires are transient beats.
 *
 * 8. The view reads `view()` through `WorldView.machine(id)`: add your view
 *    interface to `MachineView` in `types.ts`, documented. Events go on the
 *    one bus (`ctx.emit`), with ids and numbers, never sentences.
 *
 * Crew members are units too (no `accept`): a factory in the scene's
 * `units`. They act as `crew`, may not change settings or the visitor's
 * parts in play mode (rule 5, enforced at commit), and use `attach` /
 * `drive` / `detach` for parts in their hands.
 */
import type { ActionKind, Id, LampState, Outcome, TransactionId } from './types.ts';
import type { SimContext } from './context.ts';
import { HZ, steps } from './clock.ts';

/** The content id a machine answers with when a change it was asked for was refused by rule 7. */
export const CHANGED_SINCE = 'changed-since';
export const OK: Outcome = { ok: true };

/** How long a tell blinks a station's lamp, seconds, unless the station is used first. */
export const TELL_SECONDS = 8;
/** A gesture's turns within this many seconds of each other are one transaction. */
export const GESTURE_SECONDS = 0.5;

/** A station's own lamp (§ B1): dark, steady while its verb runs, blinking while it tells. */
export class Lamp {
  #tellUntil = -1;
  readonly ctx: SimContext;
  constructor(ctx: SimContext) {
    this.ctx = ctx;
  }
  /** Start the slow blink (a tell). */
  tell(): void {
    this.#tellUntil = this.ctx.clock.step + steps(TELL_SECONDS);
  }
  /** The station was used: a tell stops. */
  used(): void {
    this.#tellUntil = -1;
  }
  reset(): void {
    this.#tellUntil = -1;
  }
  /** The lamp now, given whether the verb is running. A tell shows only while idle... and over a steady lamp it wins: it is the hint. */
  state(running: boolean): LampState {
    if (this.ctx.clock.step < this.#tellUntil) return 'blink';
    return running ? 'steady' : 'dark';
  }
}

/** The last misfire, as a beat (transient). */
export class Beat {
  #at = -1;
  #level: 1 | 2 = 1;
  readonly ctx: SimContext;
  constructor(ctx: SimContext) {
    this.ctx = ctx;
  }
  hit(level: 1 | 2): void {
    this.#at = this.ctx.clock.step;
    this.#level = level;
  }
  /** Seconds since the beat began, or Infinity. */
  since(): number {
    return this.#at < 0 ? Infinity : (this.ctx.clock.step - this.#at) / HZ;
  }
  view(): { readonly level: 1 | 2; readonly since: number } | null {
    return this.#at < 0 ? null : { level: this.#level, since: this.since() };
  }
  reset(): void {
    this.#at = -1;
  }
}

/** One visitor gesture on a handle: consecutive turns within `GESTURE_SECONDS` share a transaction. */
export interface Gesture {
  txn: TransactionId | null;
  last: number;
}
export const gesture = (): Gesture => ({ txn: null, last: -Infinity });

/**
 * The transaction for this turn of a handle: the gesture's own while it is still the newest on the
 * stack and the hand has not paused; otherwise a new one (§ E5 rule 3: one action, one transaction).
 */
export function handleTxn(ctx: SimContext, g: Gesture, kind: ActionKind, subject: Id): TransactionId {
  const now = ctx.clock.step;
  const top = ctx.history.stack().at(-1);
  if (g.txn !== null && top?.id === g.txn && top.subject === subject && now - g.last <= steps(GESTURE_SECONDS)) {
    g.last = now;
    return g.txn;
  }
  g.txn = ctx.history.open(kind, subject, now);
  g.last = now;
  return g.txn;
}
