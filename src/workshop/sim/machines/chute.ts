/**
 * The return chute (REWRITE.md § B1, the bench edge: "anything that falls
 * off; sends it back up the return chute; writes where it is"; § D 1).
 *
 * The edge itself is the world's, because it is a fact about bodies (law 1:
 * a free part whose centre drops below the bench, or comes to rest off it):
 * the world takes the part out, waits the scene's `chute.delay`, and pops it
 * out of the chute's mouth (`SceneDesc.chute`) beside the crate stack with a
 * little launch; where it rests is charged as § E5 rule 4 says (the
 * transaction that threw it, while on the stack; or the cause a machine sent
 * it back with: the dock's RETURN TO SENDER). Nothing durable changes while
 * it is in the chute: its location is still where it last rested.
 *
 * This unit is the chute as a station: its registry entry (a tell, a
 * misfire that kicks the flap), its view (the flap, how many wait inside)
 * and the `flap` event, from the world's `part.returned`.
 */
import type { ChuteView, Id, Outcome, SimEvent, StationId } from '../types.ts';
import type { MachineUnit, SimContext } from '../context.ts';
import type { UnitFactory } from '../scene.ts';
import { HZ } from '../clock.ts';
import { Beat, Lamp, OK } from '../machine.ts';

export interface ChuteSpec {
  readonly id: Id;
  readonly station: StationId;
  readonly name: string;
}

export interface ChuteUnit extends MachineUnit {
  view(): ChuteView;
}

export function chute(spec: ChuteSpec): UnitFactory {
  return (ctx) => createChute(ctx, spec);
}

export function createChute(ctx: SimContext, spec: ChuteSpec): ChuteUnit {
  const lamp = new Lamp(ctx);
  const beat = new Beat(ctx);
  let kicked = -1;
  const kick = (part: Id | null): void => {
    kicked = ctx.clock.step;
    ctx.emit({ type: 'flap', id: spec.id, part });
  };
  return {
    id: spec.id,
    station: spec.station,
    name: spec.name,
    affordances: [],
    tell() {
      lamp.tell();
      ctx.emit({ type: 'tell', id: spec.id });
    },
    misfire(level) {
      beat.hit(level);
      ctx.emit({ type: 'misfire', id: spec.id, level });
      kick(null);
    },
    accept: (): Outcome => OK,
    abort() {},
    reset() {
      lamp.reset();
      beat.reset();
    },
    heard(events: readonly SimEvent[]) {
      for (const e of events) if (e.type === 'part.returned') kick(e.id);
    },
    view(): ChuteView {
      const waiting = ctx.parts().filter((id) => ctx.mode(id) === 'chute').length;
      return { kind: 'chute', id: spec.id, station: spec.station, lamp: lamp.state(false), misfire: beat.view(), flap: kicked < 0 ? Infinity : (ctx.clock.step - kicked) / HZ, waiting };
    },
  };
}
