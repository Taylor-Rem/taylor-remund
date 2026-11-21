/**
 * The platen (REWRITE.md § B1: "the tray under the nozzle; changes it by
 * text; reads the instruction; writes colour, label"; § B2 X1, the PLATEN
 * row: "colour and label of whatever part is on the tray, a robot
 * included").
 *
 * The mouth (law 2): the tray takes anything loose that comes to rest on it,
 * Fetch included, and holds it: its location becomes `in` the platen
 * (charged to whoever put it there, § E5 rule 4), it slides onto the seat
 * and stays there, held by the machine (mode `machine`) until the visitor
 * picks it up. One thing at a time: something else set on a full tray gets
 * a slip naming what the platen wanted.
 *
 * The verb, by text through the PLATEN jack: `platen.set {colour, label}`
 * paints and labels whatever is on the tray, in one commit under the text's
 * transaction; the view performs it as two beats (paint from the nozzle,
 * then the tape head), and runs them backwards on an undo (paint drains back
 * up the nozzle, the label peels off). With nothing on the tray it says so
 * (`platen.empty`).
 */
import type { Cause, Id, Instruction, Outcome, Part, PlatenView, Pose, Restore, StationId, Value, Vec3 } from '../types.ts';
import type { LostReason, MachineUnit, SimContext } from '../context.ts';
import type { UnitFactory } from '../scene.ts';
import { Beat, CHANGED_SINCE, Lamp, OK } from '../machine.ts';
import { qyaw, yawOf } from '../math.ts';
import { Beats, PART_PAINT, boardOf, jackFor, newerWriter } from './shared/patchlamp.ts';

export const PLATEN_TUNING = {
  /** A part set on the tray slides onto the seat at this fraction of the gap per step. */
  seatRate: 0.25,
} as const;

/** The slip a full tray prints. */
export const SLIP_FULL = 'slip.platen-full';

export interface PlatenSpec {
  readonly id: Id;
  readonly station: StationId;
  /** Content id of its name. */
  readonly name: string;
  /** Its mouth (the tray), declared in the scene. */
  readonly mouth: Id;
  /** Where a part sits: the bottom centre of a seated part, world space. */
  readonly seat: Vec3;
}

export interface PlatenUnit extends MachineUnit {
  view(): PlatenView;
}

export function platen(spec: PlatenSpec): UnitFactory {
  return (ctx) => createPlaten(ctx, spec);
}

export function createPlaten(ctx: SimContext, spec: PlatenSpec): PlatenUnit {
  const id = spec.id;
  const lamp = new Lamp(ctx);
  const misfire = new Beat(ctx);
  /** The part on the tray, and where its body is heading (the seat). */
  let held: { id: Id; at: Pose; to: Pose } | null = null;
  const beats = new Beats(ctx, id, (target, field) => held?.id === target && (field === PART_PAINT.colour || field === PART_PAINT.label));

  function seatPose(part: Id, from: Pose): Pose {
    const h = ctx.halfExtents(part)?.[1] ?? 0.3;
    return { p: [spec.seat[0], spec.seat[1] + h, spec.seat[2]], q: qyaw(yawOf(from.q)) };
  }

  function hold(part: Id): void {
    const at = ctx.pose(part);
    if (!at) return;
    held = { id: part, at, to: seatPose(part, at) };
  }

  const unit: PlatenUnit = {
    id,
    station: spec.station,
    name: spec.name,
    affordances: [],
    tell() {
      lamp.tell();
      ctx.emit({ type: 'tell', id });
    },
    misfire(level) {
      misfire.hit(level);
      ctx.emit({ type: 'misfire', id, level });
    },

    accept(part: Part, cause: Cause, mouth: Id): Outcome {
      if (mouth !== spec.mouth) return OK;
      if (held && held.id !== part.id) return { ok: false, wanted: SLIP_FULL };
      const r = ctx.commit([{ target: part.id, field: 'location', after: { at: 'in', station: spec.station, mouth } }], cause);
      if (r.refused.length > 0) return { ok: false, wanted: CHANGED_SINCE };
      if (!ctx.take(part.id, id)) return OK;
      lamp.used(part.id);
      hold(part.id);
      return OK;
    },

    instruct(cmd: Instruction, cause: Cause): Outcome {
      if (cmd.verb !== 'platen.set') return { ok: false, wanted: 'help.platen' };
      if (!held) return { ok: false, wanted: 'platen.empty' };
      const a = cmd.args;
      const changes: { target: Id; field: string; after: Value }[] = [];
      if (typeof a['colour'] === 'string') changes.push({ target: held.id, field: PART_PAINT.colour, after: a['colour'] });
      if (typeof a['label'] === 'string') changes.push({ target: held.id, field: PART_PAINT.label, after: a['label'] });
      if (changes.length === 0) return OK;
      lamp.used();
      if (newerWriter(ctx, cause, changes)) return { ok: false, wanted: CHANGED_SINCE };
      const r = ctx.commit(changes, cause);
      return r.refused.length > 0 ? { ok: false, wanted: CHANGED_SINCE } : OK;
    },

    abort() {
      // nothing pending: what is on the tray stays there until someone takes it
    },

    lost(part: Id, _why: LostReason) {
      if (held?.id === part) held = null;
    },

    restored(restores: readonly Restore[]) {
      for (const rs of restores) {
        if (rs.field !== 'location') continue;
        const to = rs.to as { at: string; mouth?: Id };
        if (to.at === 'in' && to.mouth === spec.mouth) {
          // put back on the tray: it is ours to hold again (no commit: its location already says so)
          if (held?.id === rs.target) continue;
          if (held === null && ctx.take(rs.target, id)) hold(rs.target);
        } else if (held?.id === rs.target) held = null;
      }
    },

    reset() {
      held = null;
      lamp.reset();
      misfire.reset();
      beats.reset();
    },

    pre() {
      if (!held) return;
      if (ctx.mode(held.id) !== 'machine') {
        held = null;
        return;
      }
      const a = held.at.p;
      const b = held.to.p;
      const k = PLATEN_TUNING.seatRate;
      const p: Vec3 = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
      held.at = { p, q: held.to.q };
      ctx.drive(held.id, held.at);
    },

    heard(events) {
      beats.heard(events);
    },

    view(): PlatenView {
      return {
        kind: 'platen',
        id,
        station: spec.station,
        lamp: lamp.state(boardOf(ctx).working === id),
        misfire: misfire.view(),
        jack: jackFor(ctx, id),
        answered: beats.answered(),
        beats: beats.view(),
        onTray: held?.id ?? null,
        seat: spec.seat,
      };
    },
  };
  return unit;
}
