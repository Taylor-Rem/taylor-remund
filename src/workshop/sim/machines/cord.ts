/**
 * The switchboard's cord (REWRITE.md § B2 X1, § D 4). Which jack the cord
 * is in is a durable setting, `<cord>.jack`, and it is exactly one of the
 * board's jacks at all times (§ E5 invariants): lifting the plug is
 * transient (the plug follows the pointer), and only pushing it into a jack
 * commits. Dropped anywhere else, it goes back to the jack it came from.
 */
import type { CordView, Id, Intent, Vec3 } from '../types.ts';
import type { SimContext, Unit } from '../context.ts';

export const JACK_FIELD = 'jack';

export type { CordView } from '../types.ts';

export interface CordUnit extends Unit {
  view(): CordView;
  /** The visitor's hand moved while holding the plug. */
  carry(target: Vec3): void;
  /** The visitor let go of the plug without a jack. */
  drop(): void;
}

export function createCord(ctx: SimContext): CordUnit {
  const spec = ctx.scene.cord;
  const jackIds = spec.jacks.map((j) => j.id);
  if (!jackIds.includes(spec.start)) throw new Error(`cord: start jack "${spec.start}" is not on the board`);
  ctx.defineSetting(spec.id, JACK_FIELD, spec.start, (v) => typeof v === 'string' && jackIds.includes(v));

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
      affordances: ['plug'],
      tell: () => ctx.emit({ type: 'tell', id: j.id }),
      misfire: (level) => ctx.emit({ type: 'misfire', id: j.id, level }),
    });
  }

  function seat(jack: Id): void {
    lifted = false;
    plugAt = null;
    ctx.letGo();
    ctx.emit({ type: 'cord.plugged', cord: spec.id, jack });
  }

  const unit: CordUnit = {
    id: spec.id,
    intent(intent: Intent): boolean {
      if (intent.type === 'unplug' && intent.cord === spec.id) {
        if (ctx.bracketed || lifted || ctx.holding() !== null) return false;
        lifted = true;
        const from = current();
        plugAt = spec.jacks.find((j) => j.id === from)?.at ?? null;
        ctx.hold({ kind: 'plug', id: spec.id });
        ctx.emit({ type: 'cord.unplugged', cord: spec.id, jack: from });
        return true;
      }
      if (intent.type === 'plug' && intent.cord === spec.id) {
        if (!lifted) return false;
        const jack = intent.jack;
        if (jack !== null && jackIds.includes(jack)) {
          if (jack !== current()) {
            const cause = ctx.history.open('plug', spec.id, ctx.clock.step);
            const { refused } = ctx.commit([{ target: spec.id, field: JACK_FIELD, after: jack }], cause);
            seat(refused.length === 0 ? jack : current());
          } else seat(jack);
        } else seat(current());
        return true;
      }
      return false;
    },
    carry(target) {
      if (lifted) plugAt = target;
    },
    drop() {
      if (lifted) seat(current());
    },
    view: () => ({ id: spec.id, jack: current(), lifted, plugAt, jacks: jackIds }),
  };
  return unit;
}
