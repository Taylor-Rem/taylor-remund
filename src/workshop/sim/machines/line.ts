/**
 * The phone line through the switchboard (REWRITE.md § B2 X1, § D 3, § F3).
 * A text goes to whatever live jack the cord is in. The line reads it
 * (`parse`, sim/instruct) and:
 * - a refusal (outside this folder, the mailbox, an unknown colour, words
 *   the tape will not take) is answered at once; nothing changes, and an
 *   unparsed text raises the mailbox's flag (nothing is ever sent);
 * - "help", "who are you", "thanks" are answered at once;
 * - a change ("make it blue") opens a `text` transaction (§ E5 rule 3) and
 *   becomes a job for Patch, charged to that transaction however long Patch
 *   takes (rule 4);
 * - "undo that" becomes a job too (not a transaction, D5): when Patch gets
 *   to it, `ctx.undo({ by: 'text', jack })` (rule 12, all or nothing).
 * Texts queue; Patch does one job at a time, in the order sent.
 *
 * The job's stages are Patch's (sim/crew/patch.ts); the line is the desk
 * Patch works at (`deskOf(ctx)`): `next` hands over the oldest waiting
 * text, `perform` is the commit point (the station on the text's line is
 * instructed, and only that station: a job never writes outside its own
 * line's folder, § F3), `finish` texts back. The reply is checked against
 * the durable state when it is sent (Patch "leans out to check the result
 * is really there", § B5): a line of the reply whose change the world does
 * not show is not sent, so a reply never says a thing was done that the
 * durable state does not show.
 *
 * A job is dropped, and says so, if its line is pulled before Patch has
 * made the change (the plug lifted out of the jack: "pull the cord out
 * mid-job: the job is cancelled, nothing is written") or if it is taken
 * back (the lever, "Reset the workshop": rule 10).
 *
 * Everything here is transient except what the stations commit. The
 * conversation is published as events (`line.*`, `mailbox.flag`) and as
 * `LineView.log`, which the phone line (ui/phone/world-line.ts) reads.
 */
import type { Cause, Id, Instruction as SimInstruction, Intent, LineEntry, LineView, Outcome, StationId, TransactionId, Value } from '../types.ts';
import type { Job, UndoOutcome } from '../history.ts';
import type { MachineUnit, SimContext } from '../context.ts';
import type { UnitFactory } from '../scene.ts';
import type { Instruction, Jack, RefusalReason, Reply, ReplyId, ReplyLine } from '../instruct/types.ts';
import { REPLY_IDS } from '../instruct/types.ts';
import { MAX_TEXT, UNDO_REPLIES, parse } from '../instruct/parse.ts';
import { HZ } from '../clock.ts';
import { CHANGED_SINCE, Lamp } from '../machine.ts';
import { BELT_FIELD_NAMES as BF, LAMP_FIELDS as LF, PART_PAINT, STOREFRONT_FIELDS as SF, boardOf } from './shared/patchlamp.ts';
import type { LiveLine } from './shared/patchlamp.ts';

export const LINE_TUNING = {
  /** The conversation keeps this many entries (the oldest go first). */
  logCap: 400,
} as const;

export interface LineSpec {
  readonly id: Id;
  readonly station: StationId;
  /** Content id of its name. */
  readonly name: string;
  /** The cord's id (its durable `jack` says which line the phone is on). */
  readonly cord: Id;
  /** The live lines: each jack, its name, and the unit that answers on it. */
  readonly lines: readonly LiveLine[];
}

/** One text on the line, from sent to answered. */
export interface Call {
  readonly n: number;
  readonly jack: Id;
  readonly line: Jack;
  readonly station: Id;
  readonly cmd: Instruction;
  /** The text's transaction (null for "undo that", which is not one). */
  readonly cause: TransactionId | null;
  readonly job: Job | null;
  /** The cord's pull count when it was sent: a different count now means the line was pulled since. */
  readonly pulls: number;
  state: 'waiting' | 'working' | 'answered' | 'cancelled';
  /** What the commit point did; null until then. */
  performed: Performed | null;
}

type Performed =
  | { readonly kind: 'set'; readonly outcome: Outcome; readonly before: ReadonlyMap<string, Value>; readonly part: Id | null }
  | { readonly kind: 'undo'; readonly outcome: UndoOutcome };

/** The desk Patch works at: how a job goes from waiting to answered. */
export interface Desk {
  readonly lineId: Id;
  /** The oldest text waiting for Patch, or null. */
  next(): Call | null;
  /** Patch has picked it up. */
  start(call: Call): void;
  /** The commit point (end of Patch's `work`). False if the call was dropped instead (its line was pulled). */
  perform(call: Call): boolean;
  /** Patch texts back (end of `reply`): the reply as the durable state shows it now. */
  finish(call: Call): void;
  /** Patch is told when a call it may hold is dropped: the cord pulled (`cord`), or taken back (`undo`). */
  onCancel: ((call: Call, why: 'cord' | 'undo') => void) | null;
}

const desks = new WeakMap<SimContext, Desk>();

/** The desk of this world's phone line, or null if the scene has none. */
export function deskOf(ctx: SimContext): Desk | null {
  return desks.get(ctx) ?? null;
}

const DONE: readonly ReplyLine[] = [{ id: 'done.checked' }, { id: 'done.patched' }];
const isReplyId = (s: string): s is ReplyId => (REPLY_IDS as readonly string[]).includes(s);
const key = (target: Id, field: string): string => `${target}\u0000${field}`;

export function line(spec: LineSpec): UnitFactory {
  return (ctx) => createLine(ctx, spec);
}

export interface LineUnit extends MachineUnit {
  view(): LineView;
}

export function createLine(ctx: SimContext, spec: LineSpec): LineUnit {
  const id = spec.id;
  const board = boardOf(ctx);
  board.lines = spec.lines;
  const lamp = new Lamp(ctx);
  const calls: Call[] = [];
  let log: LineEntry[] = [];
  let logStart = 0;
  let sent = 0;
  let flagAt = -1;

  const lineOf = (jack: Id): LiveLine | undefined => spec.lines.find((l) => l.jack === jack);
  const cordJack = (): Id => ctx.setting(spec.cord, 'jack') as Id;
  const lifted = (): boolean => ctx.holding()?.kind === 'plug';

  function record(e: LineEntry): void {
    log.push(e);
    if (log.length > LINE_TUNING.logCap) {
      const drop = log.length - LINE_TUNING.logCap;
      log = log.slice(drop);
      logStart += drop;
    }
  }
  function reply(n: number, r: Reply, mailbox: boolean): void {
    record({ kind: 'reply', n, reply: r, mailbox });
    ctx.emit({ type: 'line.reply', n, reply: r, mailbox });
    if (mailbox) flag(n);
  }
  function refuse(n: number, reason: RefusalReason, r: Reply, mailbox: boolean): void {
    record({ kind: 'refused', n, reason, reply: r, mailbox });
    ctx.emit({ type: 'line.refused', n, reason, reply: r, mailbox });
    if (mailbox) flag(n);
  }
  function flag(n: number): void {
    flagAt = ctx.clock.step;
    ctx.emit({ type: 'mailbox.flag', n });
  }

  function cancel(call: Call, why: 'cord' | 'undo'): void {
    if (call.state === 'answered' || call.state === 'cancelled') return;
    call.state = 'cancelled';
    const i = calls.indexOf(call);
    if (i >= 0) calls.splice(i, 1);
    call.job?.done(); // nothing more commits under it; with nothing written, its transaction leaves the stack
    refuse(call.n, 'cancelled', [{ id: why === 'cord' ? 'cancelled.cord' : 'cancelled.undo' }], false);
    desk.onCancel?.(call, why);
  }

  /** The line this call went down has been pulled since (or the cord is elsewhere): it is dead. */
  const dead = (call: Call): boolean => board.pulls !== call.pulls || lifted() || cordJack() !== call.jack;

  /** The durable values a reply about this call's line can be checked against. */
  function snapshot(call: Call): Map<string, Value> {
    const m = new Map<string, Value>();
    const fields = call.line === 'storefront' ? Object.values(SF) : call.line === 'belt' ? Object.values(BF) : call.line === 'lamp' ? [LF.on, LF.level, LF.colour] : [];
    for (const f of fields) m.set(key(call.station, f), ctx.setting(call.station, f) ?? null);
    if (call.line === 'platen') for (const p of ctx.parts()) for (const f of Object.values(PART_PAINT)) m.set(key(p, f), ctx.setting(p, f) ?? null);
    return m;
  }

  /** Does the world show what this reply line says was done? (Patch leans out to check.) */
  function holds(l: ReplyLine, call: Call, p: Extract<Performed, { kind: 'set' }>): boolean {
    const st = call.station;
    const now = (f: string, target = st): Value | undefined => ctx.setting(target, f);
    const was = (f: string, target = st): Value | undefined => p.before.get(key(target, f));
    switch (l.id) {
      case 'change.sign':
        return now(SF.sign) === l.colour;
      case 'change.words':
        return now(SF.words) === l.words;
      case 'change.awning':
        return now(SF.awning) === l.colour;
      case 'change.open':
        return now(SF.open) === true;
      case 'change.closed':
        return now(SF.open) === false;
      case 'change.picture':
        return now(SF.picture) === l.picture;
      case 'change.picture.none':
        return now(SF.picture) === 'none';
      case 'change.picture.next':
        return now(SF.picture) !== was(SF.picture) && now(SF.picture) !== 'none';
      case 'change.platen.colour':
        return p.part !== null && now(PART_PAINT.colour, p.part) === l.colour;
      case 'change.platen.label':
        return p.part !== null && now(PART_PAINT.label, p.part) === l.words;
      case 'change.belt.faster':
        return (now(BF.speed) as number) === (was(BF.speed) as number) + 1;
      case 'change.belt.slower':
        return (now(BF.speed) as number) === (was(BF.speed) as number) - 1;
      case 'change.belt.stop':
        return now(BF.running) === false;
      case 'change.belt.go':
        return now(BF.running) === true;
      case 'change.belt.flip':
        return now(BF.direction) !== was(BF.direction);
      case 'change.belt.forward':
        return now(BF.direction) === 'forward';
      case 'change.belt.backward':
        return now(BF.direction) === 'backward';
      case 'change.lamp.brighter':
        return (now(LF.level) as number) > (was(LF.level) as number) || (now(LF.on) === true && was(LF.on) === false);
      case 'change.lamp.dimmer':
        return (now(LF.level) as number) < (was(LF.level) as number);
      case 'change.lamp.off':
        return now(LF.on) === false;
      case 'change.lamp.on':
        return now(LF.on) === true;
      case 'change.lamp.colour':
        return now(LF.colour) === l.colour;
      case 'change.lamp.warm':
        return now(LF.colour) === 'warm';
      default:
        return false;
    }
  }

  const desk: Desk = {
    lineId: id,
    onCancel: null,
    next: () => calls.find((c) => c.state === 'waiting') ?? null,
    start(call) {
      if (call.state !== 'waiting') return;
      call.state = 'working';
      board.working = call.station;
      record({ kind: 'working', n: call.n });
      ctx.emit({ type: 'line.working', n: call.n });
    },
    perform(call) {
      if (call.state !== 'working') return false;
      if (dead(call)) {
        cancel(call, 'cord');
        return false;
      }
      if (call.cmd.verb === 'undo') {
        call.performed = { kind: 'undo', outcome: ctx.undo({ by: 'text', jack: call.jack }) };
        return true;
      }
      if (call.job && !call.job.active) {
        cancel(call, 'undo');
        return false;
      }
      const m = ctx.machine(call.station);
      const before = snapshot(call);
      let outcome: Outcome = { ok: false, wanted: 'not-here' };
      // D4: a transaction forgotten while Patch worked can no longer be undone; its work is the system's
      const live = call.cause !== null && ctx.history.stack().some((t) => t.id === call.cause);
      const cause: Cause = live ? (call.cause as TransactionId) : 'system';
      if (m?.instruct) outcome = m.instruct(call.cmd as unknown as SimInstruction, cause);
      // the platen's: which part it painted or labelled (the one this text just wrote)
      let part: Id | null = null;
      if (call.line === 'platen' && outcome.ok)
        part = ctx.parts().find((p) => Object.values(PART_PAINT).some((f) => ctx.writer(p, f) === cause && (cause !== 'system' || before.get(key(p, f)) !== ctx.setting(p, f)))) ?? null;
      call.performed = { kind: 'set', outcome, before, part };
      return true;
    },
    finish(call) {
      if (call.state !== 'working') return;
      call.state = 'answered';
      const i = calls.indexOf(call);
      if (i >= 0) calls.splice(i, 1);
      if (board.working === call.station) board.working = null;
      const p = call.performed;
      call.job?.done();
      if (!p) return refuse(call.n, 'cancelled', [{ id: 'cancelled.undo' }], false);
      if (p.kind === 'undo') {
        const o = p.outcome;
        return reply(call.n, o.ok ? UNDO_REPLIES.done : o.reason === 'changed-since' ? UNDO_REPLIES.blocked : UNDO_REPLIES.nothing, false);
      }
      const extras = call.cmd.reply.filter((l) => !l.id.startsWith('change.') && !l.id.startsWith('done.'));
      if (!p.outcome.ok) {
        const wanted = p.outcome.wanted;
        if (wanted === CHANGED_SINCE) return refuse(call.n, 'changed-since', [{ id: 'changed-since' }], false);
        return refuse(call.n, 'station', [{ id: isReplyId(wanted) ? wanted : 'not-here' }, ...extras.filter((l) => l.id === 'outside')], false);
      }
      const kept = call.cmd.reply.filter((l) => l.id.startsWith('change.') && holds(l, call, p));
      if (kept.length === 0) return refuse(call.n, 'changed-since', [{ id: 'changed-since' }], false);
      reply(call.n, [...kept, ...DONE, ...extras], call.cmd.mailbox);
    },
  };
  desks.set(ctx, desk);

  const unit: LineUnit = {
    id,
    station: spec.station,
    name: spec.name,
    affordances: [],
    tell() {
      lamp.tell();
      ctx.emit({ type: 'tell', id });
    },
    misfire(level) {
      ctx.emit({ type: 'misfire', id, level });
    },

    intent(intent: Intent): boolean {
      if (intent.type !== 'text' || ctx.bracketed || lifted()) return false;
      const jack = cordJack();
      const ln = lineOf(jack);
      if (!ln || typeof intent.text !== 'string') return false;
      const text = intent.text.slice(0, MAX_TEXT * 2);
      const n = ++sent;
      record({ kind: 'sent', n, jack, line: ln.line, text });
      ctx.emit({ type: 'line.sent', n, jack, line: ln.line, text });
      lamp.used();
      const p = parse(text, ln.line);
      if (p.kind === 'refusal') {
        refuse(n, p.reason, p.reply, p.mailbox);
        return true;
      }
      if (p.verb === 'help' || p.verb === 'who' || p.verb === 'thanks') {
        reply(n, p.reply, p.mailbox);
        return true;
      }
      const base = { n, jack, line: ln.line, station: ln.station, cmd: p, pulls: board.pulls, state: 'waiting' as const, performed: null };
      if (p.verb === 'undo') {
        calls.push({ ...base, cause: null, job: null });
        return true;
      }
      const cause = ctx.history.open('text', jack, ctx.clock.step);
      const call: Call = { ...base, cause, job: null };
      // rule 4: the job is the sender's however long Patch takes; rule 10: undone first, it is dropped
      (call as { job: Job | null }).job = ctx.history.work(cause, id, () => cancel(call, 'undo'));
      calls.push(call);
      return true;
    },

    accept(): Outcome {
      return { ok: false, wanted: 'not-here' }; // no mouth
    },
    abort(cause: Cause) {
      for (const c of [...calls]) if (c.cause === cause && !c.performed) cancel(c, 'undo');
    },

    pre() {
      // the plug lifted out of its jack: every job on that line not yet done is dropped (nothing written)
      for (const c of [...calls]) if (!c.performed && dead(c)) cancel(c, 'cord');
    },

    reset() {
      // "Reset the workshop": the history has already dropped every job under a transaction; what is left ("undo that") goes too
      for (const c of [...calls]) cancel(c, 'undo');
      board.working = null;
      lamp.reset();
    },

    view(): LineView {
      const inHand = calls.find((c) => c.state === 'working') ?? null;
      const ringing = inHand ?? calls[0] ?? null;
      const up = lifted();
      return {
        kind: 'line',
        id,
        station: spec.station,
        lamp: lamp.state(inHand !== null),
        misfire: null,
        line: up ? null : (lineOf(cordJack())?.line ?? null),
        jack: cordJack(),
        offering: up ? spec.lines.map((l) => l.jack) : [],
        ringing: ringing?.jack ?? null,
        waiting: calls.filter((c) => c.state === 'waiting').length,
        job: inHand ? { n: inHand.n, jack: inHand.jack, station: inHand.station } : null,
        mailbox: flagAt < 0 ? Infinity : (ctx.clock.step - flagAt) / HZ,
        log,
        logStart,
      };
    },
  };
  return unit;
}
