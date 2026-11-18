/**
 * What the visitor has used (REWRITE.md § B4 rungs 2 to 4; later the tells of
 * § B3 and saving, § E10): one small record of which stations the visitor has
 * acted on, by the ids that can misfire (the belt, the striker, the dock, the
 * cord, the lever...).
 *
 * It is fed by the world's own traffic, never by a machine remembering to
 * report: the intents the world hands its units (`intent`) and every event of
 * a step (`heard`), which includes every commit as an `effect`. So a machine
 * added later is "used" the moment the visitor works one of its handles or
 * puts something in its mouth, without a line of code in it.
 *
 * What counts as using a station `s` (an id in `stations`):
 * - an intent naming `s`, or a handle of `s` (`s-dial` belongs to `s`);
 * - a `handle.worked` for `s` or one of its handles;
 * - a commit under a visitor's transaction to a setting of `s` (target `s`),
 *   or that puts a part `in` a mouth of `s`;
 * - `s` doing its verb on a part the visitor has touched: `struck`, `shipped`,
 *   `taken-in`, the chute's `flap` with a part;
 * - for the cord: taking the plug out or putting it in (`cord.unplugged`,
 *   `cord.plugged`, `unplug` / `plug` intents); for the lever: an undo asked
 *   for `by: 'lever'` (the `U` key included); (S6) for the phone line: a text
 *   sent (`line.sent`).
 * - (S6) never what the crew does in attract mode: a cord moved or a text
 *   sent by the crew (`by: 'crew'` on the event) is not the visitor's use.
 *
 * Transient state (§ E5): not in the history; the Button saves it with its
 * rung, and "Reset the workshop" clears it.
 */
import type { Id, Intent, Location, SimEvent } from './types.ts';
import type { SimContext } from './context.ts';

export interface Used {
  /** Has the visitor acted on this station? */
  has(id: Id): boolean;
  /** The stations used, in the order they were first used. */
  list(): readonly Id[];
  /** Feed one intent the world handed the units. */
  intent(intent: Intent): void;
  /** Feed a step's events. */
  heard(events: readonly SimEvent[]): void;
  /** Forget everything (Reset the workshop). */
  reset(): void;
}

const isTxn = (c: string): boolean => c !== 'crew' && c !== 'system' && c !== 'settled';

/**
 * `stations`: the ids that count (the Button's ladder). `lever`: the UNDO lever's id, if it is one of
 * them. `saved`: what a previous visit had used.
 */
export function createUsed(ctx: SimContext, stations: readonly Id[], opts: { lever?: Id | null; cord?: Id | null; line?: Id | null; saved?: readonly Id[] } = {}): Used {
  const known = new Set(stations);
  const order: Id[] = [];
  const set = new Set<Id>();
  /** The station a handle id belongs to: itself, or the longest station id it starts with followed by '-'. */
  const owner = (id: Id): Id | null => {
    if (known.has(id)) return id;
    let best: Id | null = null;
    for (const s of known) if (id.startsWith(`${s}-`) && (best === null || s.length > best.length)) best = s;
    return best;
  };
  const note = (id: Id | null | undefined): void => {
    if (id === null || id === undefined) return;
    const s = owner(id);
    if (s === null || set.has(s)) return;
    set.add(s);
    order.push(s);
  };
  for (const s of opts.saved ?? []) note(s);
  const visitors = (part: Id | null): boolean => part !== null && ctx.touched(part);

  return {
    has: (id) => set.has(id),
    list: () => [...order],
    intent(intent) {
      switch (intent.type) {
        case 'press':
        case 'turn':
          note(intent.id);
          return;
        case 'unplug':
        case 'plug':
          note(opts.cord ?? intent.cord);
          return;
        default:
          return;
      }
    },
    heard(events) {
      for (const e of events) {
        switch (e.type) {
          case 'handle.worked':
            note(e.id);
            break;
          case 'effect': {
            const { target, field, after, cause } = e.effect;
            if (!isTxn(cause)) break;
            if (known.has(target)) note(target);
            if (field === 'location') {
              const l = after as Location;
              if (l && l.at === 'in') note(ctx.mouth(l.mouth)?.machine ?? null);
            }
            break;
          }
          case 'struck':
          case 'flap':
            if (visitors(e.part)) note(e.id);
            break;
          case 'shipped':
          case 'taken-in':
            if (visitors(e.part)) note(e.id);
            break;
          case 'cord.unplugged':
          case 'cord.plugged':
            if (e.by !== 'crew') note(opts.cord ?? e.cord);
            break;
          case 'line.sent':
            if (e.by !== 'crew') note(opts.line ?? null);
            break;
          case 'undone':
          case 'undo.refused':
            if (e.by === 'lever') note(opts.lever ?? null);
            break;
          default:
            break;
        }
      }
    },
    reset() {
      set.clear();
      order.length = 0;
    },
  };
}
