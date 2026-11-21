/**
 * The striker (REWRITE.md § B1: "under the arm at the end of the belt;
 * strikes it; it sounds; reads size, material; writes nothing"; § B2 X2:
 * "the belt is a music box"). A hammer on a sprung arm over the belt: every
 * part riding the belt whose centre passes under the arm is struck, in the
 * very step it passes, whichever way the belt runs. So three crates small to
 * large make a falling run, the dial is the tempo, and the lever plays the
 * line backwards.
 *
 * It reads parts and their bodies and writes nothing durable: no commit, no
 * job, nothing for an undo to take back. Its mouth is the belt's (it never
 * takes a part in).
 *
 * The notes (§ B1: "three sizes, three notes, large is low"; "metal rings an
 * octave above wood"): size gives the note, material the octave and the
 * timbre. These are a starting point for the audio and the house tune.
 */
import type { Cause, Id, Outcome, PartMaterial, PartSize, StationId, StrikerView } from '../types.ts';
import type { MachineUnit, SimContext } from '../context.ts';
import type { UnitFactory } from '../scene.ts';
import { HZ } from '../clock.ts';
import { Beat, Lamp, OK } from '../machine.ts';

/** Semitones above the line's root, by size: large is low (a major triad, L M S). */
export const NOTE: Readonly<Record<PartSize, number>> = { L: 0, M: 4, S: 7 };
/** Octave by material: metal an octave above wood; paper as wood (a duller timbre); rubber an octave below. */
export const OCTAVE: Readonly<Record<PartMaterial, number>> = { wood: 0, metal: 1, paper: 0, rubber: -1 };

export const STRIKER_TUNING = {
  /** The arm starts to cock when a riding part is this far from passing under it (units). */
  approach: 0.9,
  /** The lamp stays lit this long after a strike (seconds). */
  glow: 0.6,
} as const;

export interface StrikerSpec {
  readonly id: Id;
  readonly station: StationId;
  readonly name: string;
  /** The x of the arm's strike plane, across the belt. */
  readonly x: number;
  /** The mouth whose parts it strikes (the belt's). */
  readonly mouth: Id;
}

export interface StrikerUnit extends MachineUnit {
  view(): StrikerView;
}

export function striker(spec: StrikerSpec): UnitFactory {
  return (ctx) => createStriker(ctx, spec);
}

export function createStriker(ctx: SimContext, spec: StrikerSpec): StrikerUnit {
  const lamp = new Lamp(ctx);
  const beat = new Beat(ctx);
  /** Each riding part's x at the end of the last step. */
  const lastX = new Map<Id, number>();
  let struckAt = -1;
  let last: Id | null = null;
  let cock = 0;
  /** Seconds until the next riding part passes under the arm at the speed it went this step, or null. */
  let next: number | null = null;
  const X = spec.x;

  function strike(part: Id | null, size: PartSize | null, material: PartMaterial | null): void {
    struckAt = ctx.clock.step;
    last = part;
    ctx.emit({ type: 'struck', id: spec.id, part, size, material, note: size ? NOTE[size] : 0, octave: material ? OCTAVE[material] : 0 });
  }

  const unit: StrikerUnit = {
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
      strike(null, null, null); // one beat of its verb: the arm strikes air
    },
    accept: (): Outcome => OK,
    abort(_cause: Cause) {},
    reset() {
      lastX.clear();
      next = null;
      lamp.reset();
      beat.reset();
      struckAt = -1;
      last = null;
      cock = 0;
    },

    post() {
      if (ctx.bracketed) {
        next = null; // a rung plays: nothing rides
        return;
      }
      cock = 0;
      next = null;
      for (const id of ctx.parts()) {
        const p = ctx.part(id);
        const loc = p?.location;
        // riding: in the belt's mouth and carried by it (a part knocked loose on the belt is not riding)
        if (!p || !loc || loc.at !== 'in' || loc.mouth !== spec.mouth || ctx.mode(id) !== 'machine') {
          lastX.delete(id);
          continue;
        }
        const x = ctx.pose(id)?.p[0];
        if (x === undefined) continue;
        const was = lastX.get(id);
        lastX.set(id, x);
        if (was === undefined || was === x) continue;
        // passed under the arm in this step, either way
        if ((was < X && x >= X) || (was > X && x <= X)) {
          lamp.used(id);
          strike(id, p.size, p.material);
          continue;
        }
        // approaching: the arm cocks back, and the next strike is due when the nearest arrives at this pace
        if (Math.sign(X - x) === Math.sign(x - was)) {
          cock = Math.max(cock, 1 - Math.min(1, Math.abs(X - x) / STRIKER_TUNING.approach));
          const due = Math.abs(X - x) / (Math.abs(x - was) * HZ);
          next = next === null ? due : Math.min(next, due);
        }
      }
    },

    view(): StrikerView {
      const since = struckAt < 0 ? Infinity : (ctx.clock.step - struckAt) / HZ;
      return { kind: 'striker', id: spec.id, station: spec.station, lamp: lamp.state(cock > 0 || since < STRIKER_TUNING.glow), misfire: beat.view(), cock, since, last, next };
    },
  };
  return unit;
}
