/**
 * The switchboard's cord (REWRITE.md § B2 X1, § D 4). Which jack the cord
 * is in is a durable setting, `<cord>.jack`, and it is exactly one of the
 * board's live jacks at all times (§ E5 invariants): lifting the plug is
 * transient (the plug follows the pointer), and only pushing it into a jack
 * commits. Dropped anywhere else, it goes back to the jack it came from.
 *
 * (S3) Four live lines and two capped ones. A live jack is one the
 * instruction words name (`jack-storefront`, `jack-platen`, `jack-belt`,
 * `jack-lamp`: sim/instruct `jackOf`); any other jack on the board is capped
 * with RESERVED tape: it refuses the plug with a slip (`slip.reserved`) and
 * the plug goes back where it came from. The moment the plug seats in a
 * live jack, the station on that line answers: a `jack.answered` event the
 * view turns into one beat (the shop's lamp winks, the platen's arm nods,
 * the belt jogs, the lamp flickers), so each jack is visibly a different
 * place. While the plug is held, the live jacks offer themselves
 * (`LineView.offering`). Every lift counts (`boardOf(ctx).pulls`): the line
 * drops a job whose line was pulled mid-job.
 */
import type { CordView, Id, Intent, Vec3 } from '../types.ts';
import type { SimContext, Unit } from '../context.ts';
import { jackOf } from '../instruct/index.ts';
import { boardOf } from './shared/patchlamp.ts';

export const JACK_FIELD = 'jack';
/** The slip a capped jack prints when the plug is pushed at it. */
export const SLIP_RESERVED = 'slip.reserved';

export type { CordView } from '../types.ts';

export interface CordUnit extends Unit {
  view(): CordView;
  /** The visitor's hand moved while holding the plug. */
  carry(target: Vec3): void;
  /** The visitor let go of the plug without a jack. */
  drop(): void;
}

/** Is this jack live (a line the words reach), or capped with RESERVED tape? */
export const isLiveJack = (id: Id): boolean => jackOf(id) !== null;

export function createCord(ctx: SimContext): CordUnit {
  const spec = ctx.scene.cord;
  const jackIds = spec.jacks.map((j) => j.id);
  const liveIds = jackIds.filter(isLiveJack);
  if (!liveIds.includes(spec.start)) throw new Error(`cord: start jack "${spec.start}" is not a live jack on the board`);
  ctx.defineSetting(spec.id, JACK_FIELD, spec.start, (v) => typeof v === 'string' && liveIds.includes(v));
  const board = boardOf(ctx);

  let lifted = false;
  let plugAt: Vec3 | null = null;
  const current = (): Id => ctx.setting(spec.id, JACK_FIELD) as Id;

  ctx.register({
    id: spec.id,
    station: 'patchlamp',
    name: spec.name,
    affordances: ['plug'],
    tell: () => ctx.emit({ type: 'tell', id: spec.id }),
    misfire: (level) => ctx.emit({ type: 'misfire', id: spec.id, level }),
  });
  for (const j of spec.jacks) {
    ctx.register({
      id: j.id,
      station: 'patchlamp',
      name: j.name,
      affordances: isLiveJack(j.id) ? ['plug'] : [],
      tell: () => ctx.emit({ type: 'tell', id: j.id }),
      misfire: (level) => ctx.emit({ type: 'misfire', id: j.id, level }),
    });
  }

  function seat(jack: Id): void {
    lifted = false;
    plugAt = null;
    board.plugAt = null;
    ctx.letGo();
    ctx.emit({ type: 'cord.plugged', cord: spec.id, jack });
    const line = board.lines.find((l) => l.jack === jack);
    if (line) ctx.emit({ type: 'jack.answered', jack, station: line.station });
  }

  const unit: CordUnit = {
    id: spec.id,
    intent(intent: Intent): boolean {
      if (intent.type === 'unplug' && intent.cord === spec.id) {
        if (ctx.bracketed || lifted || ctx.holding() !== null) return false;
        lifted = true;
        board.pulls += 1;
        const from = current();
        plugAt = spec.jacks.find((j) => j.id === from)?.at ?? null;
        board.plugAt = plugAt;
        ctx.hold({ kind: 'plug', id: spec.id });
        ctx.emit({ type: 'cord.unplugged', cord: spec.id, jack: from });
        return true;
      }
      if (intent.type === 'plug' && intent.cord === spec.id) {
        if (!lifted) return false;
        const jack = intent.jack;
        if (jack !== null && liveIds.includes(jack)) {
          if (jack !== current()) {
            const cause = ctx.history.open('plug', spec.id, ctx.clock.step);
            const { refused } = ctx.commit([{ target: spec.id, field: JACK_FIELD, after: jack }], cause);
            seat(refused.length === 0 ? jack : current());
          } else seat(jack);
        } else {
          // a capped jack: RESERVED. The slip says so and the plug goes home (law 2: never a bare refusal)
          if (jack !== null && jackIds.includes(jack)) ctx.emit({ type: 'card', by: spec.id, content: SLIP_RESERVED });
          seat(current());
        }
        return true;
      }
      return false;
    },
    carry(target) {
      if (!lifted) return;
      plugAt = target;
      board.plugAt = target;
    },
    drop() {
      if (lifted) seat(current());
    },
    view: () => ({ id: spec.id, jack: current(), lifted, plugAt, jacks: jackIds }),
  };
  return unit;
}
