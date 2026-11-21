/**
 * Tells (REWRITE.md § B3, the table's last row): "After the first consequence: the lamp of the nearest untouched
 * station blinks slowly; later its lid rattles. A tell. One at a time, nearest first, every twelve seconds of
 * inactivity, never while the visitor is busy, and none after six discoveries."
 *
 * What each word means here (each is a test in tests/scenario/tells.test.ts):
 * - *station*: one of the Button ladder's stations (`LadderSpec.stations`: the lever, the striker, the cord, the
 *   belt, the dock, the chute, the lamp, the phone line, the platen, the storefront), the same list `sim/used.ts`
 *   counts. A tell is that station's own registry entry's `tell()`: a station with a lamp blinks it slowly for
 *   `TELL_SECONDS` (8 s, `sim/machine.ts`), unless it is used first; every tell also emits `tell` (audio ticks).
 * - *after the first consequence*: not in attract mode, and not until the world has answered something the visitor
 *   did: a durable change under a visitor's transaction (a part set down somewhere new, a setting turned), a Button
 *   rung played to its end, an undo taken back or refused, a text answered. Picking a part up and putting it back
 *   at once is not one. (A visit restored from a snapshot is no different: it waits for its own first consequence.)
 * - *inactivity*: the world's own count of steps since the visitor's last intent of any kind, hover and carry
 *   included (`SimContext.idleSteps`; the settings' motion switch is not input). The first tell comes once the
 *   visitor has been inactive `every` seconds (12) after the first consequence.
 * - *every twelve seconds*: after a tell the next comes when the visitor has been inactive another 12 s since it
 *   (since the later of their last input and the last tell), so one at a time: a blink (8 s) is over before the
 *   next one starts.
 * - *nearest*: nearest, across the bench (x and z), to where the visitor last acted: the world tells the scheduler
 *   after each intent that counted as an action (`acted`): where a part was taken hold of (the grip), where the
 *   hand was as it let go or put a thing down, the station of a handle pressed or turned (its ladder point; the
 *   Button's cap for the Button), the jack a plug went into or came from, the phone for a text, the lever for an
 *   undo. Before any of that, the Button.
 * - *untouched*: not in `used` (the visitor has not used it, this visit or a restored earlier one), and in the
 *   registry. Among the untouched, the one told the fewest times comes first, then the nearest: so it moves on to
 *   the next nearest rather than nagging about the same one, and only when every untouched station has been told
 *   does it begin again with the nearest.
 * - *never while the visitor is busy*: nothing in the hand (a part, the plug, Patch, the lamp's shade), no Button
 *   rung playing or rewinding, no text of theirs in hand or waiting on the line, no undo running (the lever is an
 *   input; "undo that" is a text in hand until Patch answers it). A tell that falls due while they are busy waits
 *   until they are not, then comes at once.
 * - *none after six discoveries*: in this phase a discovery is a station in `used`. With six used (this visit, or
 *   carried over in the visit's snapshot) there are no more tells for the visit.
 * - *later its lid rattles*: not built (it needs things drawn that do not exist). The seam: the scheduler counts
 *   how often it has told each station (`TellsView.told`; `last.times` is 2 or more the second time round). The
 *   stronger hint goes where `times > 1`.
 * - "Reset the workshop" starts it over: nothing told, waiting for a new first consequence.
 *
 * Deterministic, in steps, no state outside the world: transient (§ E5: not in the history, not saved).
 */
import type { Id, SimEvent, TellsView, Vec3 } from './types.ts';
import type { SimContext, Unit } from './context.ts';
import { steps } from './clock.ts';

/** Tune here. Seconds. */
export const TELL_TUNING = {
  /** Inactivity before a tell, and between one tell and the next (§ B3: "every twelve seconds of inactivity"). */
  every: 12,
  /** No tells once the visitor has used this many stations (§ B3: "none after six discoveries"). */
  discoveries: 6,
} as const;

export interface TellsUnit extends Unit {
  /** The visitor acted (an intent that counted as an action) here: the point "nearest" is measured from. */
  acted(at: Vec3 | null): void;
  view(): TellsView;
}

export interface TellsOptions {
  /** The stations, each with a point on it (world). */
  readonly stations: readonly { readonly id: Id; readonly at: Vec3 }[];
  /** What the visitor has used (`sim/used.ts`, kept by the Button). */
  readonly used: { has(id: Id): boolean; list(): readonly Id[] };
  /** Where "nearest" is measured from before the visitor has acted anywhere: the Button's cap. */
  readonly home: Vec3;
  /** Is the visitor busy now (see the header)? The world knows. */
  readonly busy: () => boolean;
}

const isTxn = (c: string): boolean => c !== 'crew' && c !== 'system' && c !== 'settled';

/** Does this step's traffic hold a consequence of something the visitor did (see the header)? */
export function consequence(events: readonly SimEvent[]): boolean {
  for (const e of events) {
    switch (e.type) {
      case 'effect':
        if (isTxn(e.effect.cause)) return true;
        break;
      case 'rung.ended':
      case 'undone':
      case 'line.reply':
      case 'line.refused':
        return true;
      case 'undo.refused':
        if (e.by === 'lever') return true;
        break;
      default:
        break;
    }
  }
  return false;
}

export function createTells(ctx: SimContext, opts: TellsOptions): TellsUnit {
  const T = TELL_TUNING;
  const every = steps(T.every);
  let armed = false;
  let lastTell = -Infinity;
  let last: { id: Id; step: number; times: number } | null = null;
  const told = new Map<Id, number>();
  let from: Vec3 = opts.home;
  const flat = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[2] - b[2]);

  const stopped = (): boolean => opts.used.list().length >= T.discoveries;

  /** The station to tell now: untouched, in the registry, told fewest times, then nearest, then in ladder order. */
  function pick(): Id | null {
    let best: { id: Id; n: number; d: number; i: number } | null = null;
    opts.stations.forEach((s, i) => {
      if (opts.used.has(s.id) || !ctx.interactable(s.id)) return;
      const c = { id: s.id, n: told.get(s.id) ?? 0, d: flat(s.at, from), i };
      if (!best || c.n < best.n || (c.n === best.n && (c.d < best.d - 1e-9 || (Math.abs(c.d - best.d) <= 1e-9 && c.i < best.i)))) best = c;
    });
    return (best as { id: Id } | null)?.id ?? null;
  }

  /** When the next tell falls due (a step), or null while there is none to come. */
  function due(): number | null {
    if (!armed || !ctx.playMode || stopped()) return null;
    const quietFrom = Math.max(ctx.clock.step - ctx.idleSteps(), lastTell);
    return quietFrom + every;
  }

  const unit: TellsUnit = {
    id: 'tells',
    acted(at) {
      if (at) from = at;
    },
    heard(events) {
      if (!armed && ctx.playMode && consequence(events)) armed = true;
    },
    post() {
      const at = due();
      if (at === null || ctx.clock.step < at || opts.busy()) return;
      const id = pick();
      if (id === null) return;
      const times = (told.get(id) ?? 0) + 1;
      told.set(id, times);
      lastTell = ctx.clock.step;
      last = { id, step: ctx.clock.step, times };
      ctx.interactable(id)?.tell();
    },
    reset() {
      armed = false;
      lastTell = -Infinity;
      last = null;
      told.clear();
      from = opts.home;
    },
    view: () => ({
      armed,
      stopped: stopped(),
      next: due(),
      from,
      last,
      told: Object.fromEntries(told),
    }),
  };
  return unit;
}
