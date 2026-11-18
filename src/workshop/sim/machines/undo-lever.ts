/**
 * The UNDO lever (REWRITE.md § B2 X3, § D 8, § E5 rule 8). A pull takes back
 * the visitor's last action, at once: `ctx.undo({ by: 'lever' })` in the
 * very step the pull is handled (the history restores everything in that
 * step, rule 11; what is seen running backwards plays after). Revert's crank
 * is the accompaniment and is never waited for.
 *
 * Two ways in: a `press` on the lever (`id`), or the world's own `undo`
 * intent (the `U` key), which the world performs itself; the lever hears
 * that undo's `undone` / `undo.refused` and travels just the same. With
 * nothing to undo it still travels (the pull is real; Revert says so).
 *
 * Not a machine with a mouth: it is published through `MachineView` (kind
 * `undo-lever`) because that is the one place the view reads a station's
 * transient state. It has no durable setting: the lever's position is not
 * in the history (it springs back).
 */
import type { Id, Intent, Outcome, SimEvent, StationId, UndoLeverView } from '../types.ts';
import type { MachineUnit, SimContext } from '../context.ts';
import type { UnitFactory } from '../scene.ts';
import { HZ, steps } from '../clock.ts';
import { Beat, Lamp, OK } from '../machine.ts';

/** Seconds; tune here. A pull is felt at once: the lever reaches the end of its travel in 100 ms. */
export const LEVER_TUNING = {
  pull: 0.1,
  hold: 0.08,
  /** The spring takes it home (the view adds the overshoot). */
  back: 0.35,
  /** A misfire twitches it this far, and lets it go. */
  twitch: 0.35,
  twitchTime: 0.08,
} as const;

export interface UndoLeverSpec {
  readonly id: Id;
  readonly station: StationId;
  /** Content id of its name. */
  readonly name: string;
}

export interface UndoLeverUnit extends MachineUnit {
  view(): UndoLeverView;
}

export function undoLever(spec: UndoLeverSpec): UnitFactory {
  return (ctx) => createUndoLever(ctx, spec);
}

export function createUndoLever(ctx: SimContext, spec: UndoLeverSpec): UndoLeverUnit {
  const T = LEVER_TUNING;
  const lamp = new Lamp(ctx);
  const beat = new Beat(ctx);
  /** The step the last pull began, and whether it was a twitch (a misfire). */
  let pulledAt = -1;
  let twitch = false;
  let result: UndoLeverView['result'] = null;
  /** A pull by the `U` key: heard at the end of its step; its click is said at the next. */
  let clickDue = false;

  const pull = (): void => {
    pulledAt = ctx.clock.step;
    twitch = false;
    lamp.used();
  };

  function travel(): { travel: number; latch: number; phase: UndoLeverView['phase'] } {
    if (pulledAt < 0) return { travel: 0, latch: 0, phase: 'rest' };
    const t = (ctx.clock.step - pulledAt) / HZ;
    if (twitch) {
      if (t < T.twitchTime) return { travel: T.twitch * (t / T.twitchTime), latch: 0, phase: 'pull' };
      const k = (t - T.twitchTime) / T.back;
      return k >= 1 ? { travel: 0, latch: 0, phase: 'rest' } : { travel: T.twitch * (1 - k), latch: 0, phase: 'return' };
    }
    if (t < T.pull) return { travel: Math.min(1, (t + 1 / HZ) / T.pull), latch: 1, phase: 'pull' };
    if (t < T.pull + T.hold) return { travel: 1, latch: 1, phase: 'hold' };
    const k = (t - T.pull - T.hold) / T.back;
    if (k >= 1) return { travel: 0, latch: 0, phase: 'rest' };
    // eased home: fast off the stop, slowing in
    return { travel: (1 - k) * (1 - k), latch: Math.max(0, 1 - k * 3), phase: 'return' };
  }

  const unit: UndoLeverUnit = {
    id: spec.id,
    station: spec.station,
    name: spec.name,
    affordances: ['press'],
    tell() {
      lamp.tell();
      ctx.emit({ type: 'tell', id: spec.id });
    },
    misfire(level) {
      // one beat of its verb, without the verb: the lever jerks and springs back; nothing is undone
      beat.hit(level);
      pulledAt = ctx.clock.step;
      twitch = true;
      ctx.emit({ type: 'misfire', id: spec.id, level });
    },

    intent(intent: Intent): boolean {
      if (intent.type !== 'press' || intent.id !== spec.id) return false;
      if (ctx.bracketed) return false; // § B4: handles do not respond while a rung plays
      pull();
      ctx.emit({ type: 'handle.worked', id: spec.id });
      const out = ctx.undo({ by: 'lever' });
      result = out.ok ? (out.undone.kept.length > 0 ? 'kept' : 'undone') : out.reason === 'nothing' ? 'nothing' : null;
      return true;
    },

    heard(events: readonly SimEvent[]) {
      for (const e of events) {
        if ((e.type === 'undone' || e.type === 'undo.refused') && e.by === 'lever' && pulledAt !== ctx.clock.step) {
          // the `U` key: the world undid it; the lever goes just the same
          pull();
          result = e.type === 'undone' ? (e.kept.length > 0 ? 'kept' : 'undone') : e.reason === 'nothing' ? 'nothing' : null;
          clickDue = true;
        }
      }
    },

    pre() {
      if (clickDue) {
        clickDue = false;
        ctx.emit({ type: 'handle.worked', id: spec.id });
      }
    },

    // no mouth names the lever, so the world never offers it a part; were one to, it rests where it lies
    accept: (): Outcome => OK,
    abort() {},

    reset() {
      pulledAt = -1;
      twitch = false;
      result = null;
      clickDue = false;
      lamp.reset();
      beat.reset();
    },

    view(): UndoLeverView {
      const tr = travel();
      const armed = ctx.history.stack().length > 0;
      return { kind: 'undo-lever', id: spec.id, station: spec.station, lamp: lamp.state(armed), misfire: beat.view(), ...tr, since: pulledAt < 0 ? Infinity : (ctx.clock.step - pulledAt) / HZ, armed, result };
    },
  };
  return unit;
}

/** For tests: steps from a pull until the lever is home again. */
export const LEVER_STEPS = steps(LEVER_TUNING.pull + LEVER_TUNING.hold + LEVER_TUNING.back) + 1;
