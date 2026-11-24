/**
 * The ledger board (P4 D1): the Ledger Management System's demonstration, the thing in its crate (`crate-1`). A small
 * counting board of wood and brass, one loose part (kind `tool`) with state: eight cups in two rows of four (two
 * months of charges), a hopper of eight tokens (payments; one rubber), a gutter at its front edge, a side cup with a
 * flip gate, a red star lamp, and two controls that ride on it, a crank (deal) and a plunger (repair). The arithmetic
 * and the beats are `shared/ledger-board.ts`; what it is true to, and what it simplifies, is said there.
 *
 * The tokens are not loose bodies: they are the board's one durable field (`TOKENS_FIELD` on the board's own id, a
 * `Tokens` value), drawn by the view, riding with the board whatever is done to it. Nothing can be lost.
 *
 * - The crank (`press`): one effect under the press's transaction: everything gathered and dealt again, the rubber
 *   payment somewhere other than last time (seeded, `ctx.rng`), and it bounces: `dealt(bounce)`.
 * - The plunger (`press`): one effect under the press's transaction: `repaired(bounce)`. With nothing wrong it refuses
 *   (a short twitch of its knob, `ledger.refused`), never a fake repair.
 * - The first time the board comes out of its crate (its crate opened with the tokens still in the hopper), it deals
 *   itself (`LEDGER_TUNING.autoDeal`), charged to the transaction that opened the crate: one pull of the lever shuts
 *   the crate and puts the tokens back in the hopper together. With reduced motion it waits until the visitor acts.
 *
 * The state changes at once; the showing takes a couple of seconds (`LedgerView.show`, a script of beats the view
 * performs; each beat is also an event for sound, `ledger.beat`). A press while a show plays waits its turn as work
 * under its own transaction (the lever cancels it). The show is cut (the board drawn as its state says, at once) when
 * the board leaves the visitor's reach or sight: picked up, taken by the crew, down the chute, shipped, stowed; a press
 * waiting then is done at once. An undo or a reset that puts the tokens back plays a short rewind.
 *
 * Its two controls are interactables of their own (`crank`, `plunger`: a name, a tell, a misfire, `press`), usable
 * while the board is in the world and in nobody's hand.
 */
import type { Cause, Id, Intent, Outcome, Restore, SimEvent, StationId, TransactionId, LedgerView, LedgerShow } from '../types.ts';
import type { MachineUnit, SimContext } from '../context.ts';
import type { Job } from '../history.ts';
import type { UnitFactory } from '../scene.ts';
import { HZ, steps } from '../clock.ts';
import { Beat, OK, gesture, handleTxn } from '../machine.ts';
import { dealScript, dealt, fresh, needsRepair, nextBounce, repaired, repairScript, rewindScript, rubberOf, validTokens, type LedgerScript, type Tokens } from './shared/ledger-board.ts';

/** A project crate's durable lid (`crates.ts` OPEN): read through the part, as any machine reads a part's field. */
const OPEN = 'open';

/** The board's durable field: where every token is (`Tokens`). */
export const TOKENS_FIELD = 'tokens';

/** Tune here. */
export const LEDGER_TUNING = {
  /**
   * A second press on the same control this soon after the first is held a moment (`doubleSteps`) before it is done:
   * if the visitor's double-tap asks for the board (`select`) meanwhile, it was half of that, and only the look happens.
   */
  doubleSeconds: 0.36,
  doubleSteps: 3,
  /** Ask for the camera as a deal or a repair begins (the show is always seen); false: only on `select`. */
  lookOnShow: true,
  /** The first time the board comes out of its crate it deals itself (false: it waits for the crank). */
  autoDeal: true,
  /** Where the rubber payment sits in a fresh board's deal (the first deal of a visit: in month one, so the repair is seen crossing from one row to the next). */
  firstBounce: 2,
} as const;

export interface LedgerSpec {
  /** The unit's id (its view: `WorldView.machine(id)`). */
  readonly id: Id;
  readonly station: StationId;
  /** The board: a loose part of the scene (kind `tool`, `stowedIn` its crate). */
  readonly board: Id;
  /** Its crate, whose opening deals it the first time. */
  readonly crate: Id;
  readonly crank: { readonly id: Id; readonly name: string };
  readonly plunger: { readonly id: Id; readonly name: string };
  /**
   * What the camera is asked to look at (`look`, crates.ts "Asking for the camera"): on its crate's tray, the crate's
   * card (what the crate itself asks for, so the card stays in the picture); out on the bench, the board's own box (a
   * pick target the view registers that is never pressed).
   */
  readonly look: { readonly card: Id; readonly board: Id };
}

export interface LedgerUnit extends MachineUnit {
  view(): LedgerView;
}

export function ledger(spec: LedgerSpec): UnitFactory {
  return (ctx) => createLedger(ctx, spec);
}

type Kind = 'deal' | 'repair';

export function createLedger(ctx: SimContext, spec: LedgerSpec): LedgerUnit {
  const T = LEDGER_TUNING;
  const rng = ctx.rng('ledger');
  const crankBeat = new Beat(ctx);
  const plungerBeat = new Beat(ctx);
  const crankGesture = gesture();
  const plungerGesture = gesture();
  const boardSpec = ctx.scene.parts.find((p) => p.id === spec.board);
  if (!boardSpec || boardSpec.kind === 'crate') throw new Error(`ledger: ${spec.board} is not a loose part of this scene (nor may it be a crate)`);
  ctx.defineSetting(spec.board, TOKENS_FIELD, fresh(T.firstBounce), validTokens);

  /** The show playing now (transient), and the beats already announced. */
  let show: { kind: LedgerShow['kind']; start: number; before: Tokens; after: Tokens; script: LedgerScript; said: number } | null = null;
  /** A press waiting for the show to end: its work, under its own transaction. */
  let waiting: { kind: Kind; job: Job } | null = null;
  /** The last refusal (a polite twitch of the plunger), the step it began. */
  let refusedAt = -1;

  const tokens = (): Tokens => {
    const v = ctx.setting(spec.board, TOKENS_FIELD);
    return validTokens(v) ? v : fresh(T.firstBounce);
  };

  for (const h of [spec.crank, spec.plunger]) {
    const b = h === spec.crank ? crankBeat : plungerBeat;
    ctx.register({
      id: h.id,
      station: spec.station,
      name: h.name,
      affordances: ['press'],
      on: spec.board,
      tell: () => ctx.emit({ type: 'tell', id: h.id }),
      misfire: (level) => {
        // one beat of its travel, without the verb: nothing is dealt or repaired
        b.hit(level);
        ctx.emit({ type: 'misfire', id: h.id, level });
      },
    });
  }

  /** In the world and in nobody's hand: free on the bench, or in a machine's mouth (its crate's tray, the belt, the platen). */
  const reachable = (): boolean => {
    const m = ctx.mode(spec.board);
    return m === 'free' || m === 'machine';
  };
  const elapsed = (): number => (show ? (ctx.clock.step - show.start) / HZ : Infinity);
  const playing = (): boolean => show !== null && elapsed() < show.script.length;

  function begin(kind: LedgerShow['kind'], before: Tokens, after: Tokens): void {
    const script = kind === 'deal' ? dealScript(before, after) : kind === 'repair' ? repairScript(before, after) : rewindScript(before, after);
    show = { kind, start: ctx.clock.step, before, after, script, said: 0 };
    if (kind !== 'rewind' && T.lookOnShow) look();
  }

  /** On its open crate's tray (the crate's thing, shown there)? */
  const onTray = (): boolean => {
    const l = ctx.part(spec.board)?.location;
    return !!l && l.at === 'in' && l.mouth === spec.crate && ctx.mode(spec.board) === 'machine';
  };
  /** Ask the camera to look at the board (crates.ts "Asking for the camera"): never while it is in a hand, the chute, shipped or stowed. */
  function look(): boolean {
    if (!reachable()) return false;
    ctx.emit({ type: 'look', target: onTray() ? spec.look.card : spec.look.board });
    return true;
  }

  /** The last press on each control (its step), and a second press held a moment in case it is half of a double-tap. */
  const lastPress = new Map<Id, number>();
  let held: { kind: Kind; id: Id; g: ReturnType<typeof gesture>; step: number } | null = null;
  function pressOrHold(kind: Kind, id: Id, g: ReturnType<typeof gesture>): boolean {
    if (ctx.bracketed || !reachable()) return false;
    const last = lastPress.get(id);
    lastPress.set(id, ctx.clock.step);
    if (last !== undefined && ctx.clock.step - last <= steps(T.doubleSeconds)) {
      held = { kind, id, g, step: ctx.clock.step };
      return true;
    }
    return press(kind, id, g);
  }

  /** The deal's value: a new month, its rubber payment somewhere other than last time. */
  const nextDeal = (): Tokens => {
    const was = rubberOf(tokens());
    // a board not yet dealt keeps the bounce it was made with (the visit's first deal is the same every time)
    const isFresh = tokens().every((s) => s === 'h' || s === 'rh');
    return dealt(isFresh ? was : nextBounce(was, rng.next()));
  };

  /** Do it: one effect, under `commit`'s cause. False if the history refused it. */
  function act(kind: Kind, commit: (after: Tokens) => boolean): boolean {
    const before = tokens();
    if (kind === 'repair' && !needsRepair(before)) return false;
    const after = kind === 'deal' ? nextDeal() : repaired(rubberOf(before));
    if (!commit(after)) return false;
    if (reachable()) begin(kind, before, after);
    else show = null;
    ctx.emit({ type: kind === 'deal' ? 'ledger.dealt' : 'ledger.repaired', id: spec.id, board: spec.board, bounce: rubberOf(after) });
    return true;
  }

  const commitUnder = (cause: Cause) => (after: Tokens): boolean => ctx.commit([{ target: spec.board, field: TOKENS_FIELD, after }], cause).effects.length > 0;

  /** The waiting press, now. */
  function runWaiting(): void {
    const w = waiting;
    if (!w) return;
    waiting = null;
    if (w.job.active) act(w.kind, (after) => w.job.commit([{ target: spec.board, field: TOKENS_FIELD, after }]).effects.length > 0);
    w.job.done();
  }

  function press(kind: Kind, id: Id, g: ReturnType<typeof gesture>): boolean {
    if (ctx.bracketed || !reachable()) return false;
    ctx.emit({ type: 'handle.worked', id });
    if (kind === 'repair') {
      // nothing wrong (and nothing on its way to being wrong): a polite refusal, never a fake repair
      const pendingDeal = waiting?.kind === 'deal' || (show?.kind === 'deal' && playing());
      if (waiting?.kind === 'repair' || (!needsRepair(tokens()) && !pendingDeal) || (show?.kind === 'repair' && playing() && !waiting)) {
        refusedAt = ctx.clock.step;
        ctx.emit({ type: 'ledger.refused', id: spec.id, board: spec.board });
        return true;
      }
    }
    const t: TransactionId = handleTxn(ctx, g, 'press', id);
    if (playing() || waiting) {
      // it waits its turn: work under its own transaction (the lever cancels it)
      if (waiting) return true; // one press waits at a time; a second is the same press
      const job = ctx.history.work(t, spec.id, () => {
        if (waiting?.job === job) waiting = null;
      });
      waiting = { kind, job };
      return true;
    }
    act(kind, commitUnder(t));
    return true;
  }

  /** The board is on its open crate's tray, never dealt: it deals itself (charged to whoever opened the crate). */
  function autoDeal(): void {
    if (!T.autoDeal || show || waiting || ctx.still || ctx.bracketed) return;
    const l = ctx.part(spec.board)?.location;
    if (!l || l.at !== 'in' || l.mouth !== spec.crate || ctx.setting(spec.crate, OPEN) !== true || ctx.mode(spec.board) !== 'machine') return;
    if (!tokens().every((s) => s === 'h' || s === 'rh')) return;
    const w = ctx.writer(spec.crate, OPEN);
    const live = typeof w === 'string' && /^t\d+$/.test(w) && ctx.history.stack().some((x) => x.id === w);
    const cause: Cause = live ? (w as TransactionId) : 'system';
    if (!act('deal', commitUnder(cause)) && cause !== 'system') act('deal', commitUnder('system'));
  }

  const unit: LedgerUnit = {
    id: spec.id,
    station: spec.station,
    name: boardSpec.name,
    // (the board is its own registry entry, as a part; the unit is listed only for its view: nothing to press here)
    affordances: [],
    tell() {
      ctx.emit({ type: 'tell', id: spec.crank.id });
    },
    misfire(level) {
      crankBeat.hit(level);
      plungerBeat.hit(level);
    },

    intent(intent: Intent): boolean {
      if (intent.type === 'select') {
        // a double-click or double-tap on the board or a control: it asks to be looked at; the double-tap's second
        // press (held a moment, above) was half of it and is dropped
        if (intent.id !== spec.board && intent.id !== spec.crank.id && intent.id !== spec.plunger.id) return false;
        if (ctx.bracketed) return false;
        held = null;
        return look();
      }
      if (intent.type !== 'press') return false;
      if (intent.id === spec.crank.id) return pressOrHold('deal', spec.crank.id, crankGesture);
      if (intent.id === spec.plunger.id) return pressOrHold('repair', spec.plunger.id, plungerGesture);
      return false;
    },

    pre() {
      if (ctx.bracketed) return;
      // a second press no double-tap claimed: done now (a moment late: three steps)
      if (held && ctx.clock.step - held.step >= T.doubleSteps) {
        const h = held;
        held = null;
        press(h.kind, h.id, h.g);
      }
      if (show && !reachable()) {
        // out of reach or out of sight: drawn as its state says, at once; a press waiting is done now
        show = null;
        runWaiting();
        return;
      }
      if (show && !playing()) {
        show = null;
        runWaiting();
      }
      if (!show) autoDeal();
    },

    post() {
      // the beats as they fall due (for sound, and for the live region at the end)
      if (!show || ctx.bracketed) return;
      const t = elapsed();
      const beats = show.script.beats;
      while (show.said < beats.length && beats[show.said]!.at <= t) {
        const b = beats[show.said]!;
        ctx.emit({ type: 'ledger.beat', id: spec.id, board: spec.board, show: show.kind, beat: b.kind, token: b.token, to: b.to, month: b.month, ...(b.on === undefined ? {} : { on: b.on }) });
        show.said++;
      }
    },

    lost() {},

    restored(restores: readonly Restore[]) {
      // (an undo that puts the board back as shipped: the dock brings it back up the chute, as any shipped tool)
      const r = restores.find((x) => x.target === spec.board && x.field === TOKENS_FIELD);
      if (!r) return;
      // an undo or a reset put the tokens back: a waiting press was cancelled with its transaction (rule 10) or by the reset
      if (waiting && !waiting.job.active) waiting = null;
      if (validTokens(r.from) && validTokens(r.to) && reachable()) begin('rewind', r.from, r.to);
      else show = null;
    },

    reset() {
      held = null;
      lastPress.clear();
      show = null;
      waiting = null;
      refusedAt = -1;
      crankBeat.reset();
      plungerBeat.reset();
    },

    heard(events: readonly SimEvent[]) {
      void events;
    },

    // no mouth names the board's unit, so the world never offers it a part; were one to, it rests where it lies
    accept: (): Outcome => OK,
    abort() {
      // (rule 10 drops a waiting press through its job's own abort)
    },

    view(): LedgerView {
      const s = show;
      return {
        kind: 'ledger',
        id: spec.id,
        station: spec.station,
        lamp: 'dark',
        misfire: plungerBeat.view(),
        board: spec.board,
        crank: spec.crank.id,
        plunger: spec.plunger.id,
        tokens: tokens(),
        wrong: needsRepair(tokens()),
        show: s ? { kind: s.kind, since: (ctx.clock.step - s.start) / HZ, before: s.before, after: s.after, beats: s.script.beats, length: s.script.length } : null,
        waiting: waiting?.kind ?? null,
        refused: refusedAt < 0 ? Infinity : (ctx.clock.step - refusedAt) / HZ,
        crankMisfire: crankBeat.view(),
      };
    },
  };
  return unit;
}

/** For tests: steps until a deal's show (with a gather) is over, with a margin. */
export const LEDGER_SHOW_STEPS = steps(4) + 1;
