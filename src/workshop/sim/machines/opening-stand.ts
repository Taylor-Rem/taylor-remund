/**
 * P4 S6, a prototype behind one switch (`?open=stand`): the opening stand. A small machine with one mouth: a project
 * crate set down in it (carried and let go, tap-then-tap, the keyboard's place) opens, its card rises and its thing comes
 * up on its tray, and the page is asked to look at it (`look`). Lifting the crate off shuts it (the crates unit claps it
 * shut under the grab, as ever). Nowhere else does a crate open (sim/machines/crates.ts, with the scene's `openingStand`).
 *
 * The rules, each a test in tests/scenario/opening-stand.test.ts:
 * - *Set down*: the world offers a part that comes to rest in the mouth (`accept`). A project crate placed by the visitor
 *   (its rest charged to their transaction) opens, under that transaction: the lever puts it back where it was, shut.
 *   Set there by a crew member, or by nobody (start, reset): it rests, shut. Anything else simply rests there.
 * - *One at a time*: a second crate set down while one lies open: the open one is shut and handed off to the side (a
 *   push), both charged to the new placing (so the lever brings the first back, open), and the new one opens.
 * - The stand takes nothing into custody: an open crate on it is a free part at rest; Fetch leaves it be (a crate the
 *   visitor has touched is not Fetch's), and a knock shuts it as anywhere.
 *
 * Deterministic, in steps; the open crate is read from the world each step (an undo or a reset needs no bookkeeping).
 */
import type { Cause, Id, OpeningStandView, Outcome, Part, Restore, SimEvent, StationId, Vec3 } from '../types.ts';
import type { MachineUnit, SimContext } from '../context.ts';
import type { UnitFactory } from '../scene.ts';
import { Beat, OK } from '../machine.ts';
import { HZ } from '../clock.ts';

/** Tune here. Units per second. */
export const OPENING_STAND_TUNING = {
  /** How far clear of the stand's edge a crate handed off is set down. */
  gap: 0.12,
} as const;

export interface OpeningStandSpec {
  readonly id: Id;
  readonly station: StationId;
  /** Its name, a content id (the controls list, the live region). */
  readonly name: string;
  /** Its mouth (the scene's `mouths`). */
  readonly mouth: Id;
  /** Which way, level, a crate handed off goes (unit vector, world). */
  readonly aside: readonly [number, number];
  /** The height it is set down on there (the bench's or the console's top). */
  readonly floor: number;
}

export function openingStand(spec: OpeningStandSpec): UnitFactory {
  return (ctx) => createOpeningStand(ctx, spec);
}

export function createOpeningStand(ctx: SimContext, spec: OpeningStandSpec): MachineUnit {
  const T = OPENING_STAND_TUNING;
  const beat = new Beat(ctx);
  const projects = ctx.scene.projects ?? [];
  const mouth = (ctx.scene.mouths ?? []).find((m) => m.id === spec.mouth);
  if (!mouth) throw new Error(`opening-stand: no mouth ${spec.mouth} in the scene`);
  /** When a crate last opened on it (step), for the lifter's beat. */
  let openedAt = -Infinity;
  /** Crates it handed off: not opened again by it until a hand has taken them (or they rest outside its mouth). */
  const handedOff = new Set<Id>();
  /** A crate set down on top of the one it handed off: it falls onto the stand and opens there, under its placing. */
  let falling: { crate: Id; cause: Cause } | null = null;

  const inMouth = (id: Id): boolean => {
    const pose = ctx.pose(id);
    if (!pose) return false;
    const yaw = ((mouth.yaw ?? 0) * Math.PI) / 180;
    const dx = pose.p[0] - mouth.c[0], dz = pose.p[2] - mouth.c[2];
    const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw), lz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
    return Math.abs(lx) <= mouth.half[0] && Math.abs(pose.p[1] - mouth.c[1]) <= mouth.half[1] && Math.abs(lz) <= mouth.half[2];
  };
  /** The project crate lying open in the mouth, if any. */
  const openOn = (): Id | null => projects.find((c) => ctx.setting(c.crate, 'open') === true && ctx.mode(c.crate) === 'free' && inMouth(c.crate))?.crate ?? null;

  const unit: MachineUnit = {
    id: spec.id,
    station: spec.station,
    name: spec.name,
    affordances: [],
    tell() {
      ctx.emit({ type: 'tell', id: spec.id });
    },
    misfire(level) {
      beat.hit(level);
      ctx.emit({ type: 'misfire', id: spec.id, level });
    },

    accept(part: Part, given: Cause): Outcome {
      const c = projects.find((x) => x.crate === part.id);
      const cause: Cause = falling?.crate === part.id ? falling.cause : given;
      if (falling?.crate === part.id) falling = null;
      // not a project crate, or not the visitor's doing (Fetch's, the start's, a reset's): it rests here, shut
      if (!c || cause === 'crew' || cause === 'system' || ctx.bracketed) return OK;
      if (ctx.setting(c.crate, 'open') === true || handedOff.has(c.crate)) return OK;
      // one at a time: the one open here is shut and handed off to the side, all under this placing
      const other = openOn();
      if (other !== null && other !== c.crate) {
        const oc = projects.find((x) => x.crate === other)!;
        const r = ctx.commit([{ target: other, field: 'open', after: false }], cause);
        if (r.refused.length > 0) return OK;
        ctx.emit({ type: 'crate.shut', id: spec.id, crate: other, project: oc.project, why: 'machine' });
        if (oc.card !== undefined) ctx.emit({ type: 'look.back', target: oc.card });
        handedOff.add(other);
        // lifted out and set down beside the stand (taken, put there, let go: its fall and rest are this placing's)
        const op = ctx.pose(other);
        const oh = ctx.halfExtents(other);
        if (op && oh && ctx.take(other, spec.id)) {
          const reach = Math.max(mouth.half[0], mouth.half[2]) + Math.max(oh[0], oh[2]) + T.gap;
          const at: Vec3 = [mouth.c[0] + spec.aside[0] * reach, spec.floor + oh[1] + 0.04, mouth.c[2] + spec.aside[1] * reach];
          ctx.drive(other, { p: at, q: op.q }, true);
          ctx.release(other, [0, -0.3, 0], [0, 0, 0], cause);
        }
        // the new one is on top of the old: it falls onto the stand now, and opens when it rests there
        const ph = ctx.halfExtents(c.crate);
        const pp = ctx.pose(c.crate);
        if (ph && pp && pp.p[1] - ph[1] > mouth.drop[1] + 0.05) {
          falling = { crate: c.crate, cause };
          return OK;
        }
      }
      const r = ctx.commit([{ target: c.crate, field: 'open', after: true }], cause);
      if (r.effects.length > 0) {
        openedAt = ctx.clock.step;
        ctx.emit({ type: 'crate.opened', id: spec.id, crate: c.crate, project: c.project });
        if (c.card !== undefined) ctx.emit({ type: 'look', target: c.card });
      }
      // it rests where it is (no custody): the world commits its rest under the same transaction
      return OK;
    },
    abort() {},

    pre() {
      // a crate handed off is the stand's to open again once a hand has had it, or once it lies outside the mouth
      for (const id of [...handedOff]) if (ctx.mode(id) === 'held' || (ctx.mode(id) === 'free' && ctx.settled(id) && !inMouth(id))) handedOff.delete(id);
      if (falling && (ctx.mode(falling.crate) === 'held' || !inMouth(falling.crate))) falling = null;
    },

    restored(restores: readonly Restore[]) {
      void restores;
    },
    reset() {
      openedAt = -Infinity;
      handedOff.clear();
      falling = null;
      beat.reset();
    },
    heard(events: readonly SimEvent[]) {
      void events;
    },

    view(): OpeningStandView {
      return {
        kind: 'opening-stand',
        id: spec.id,
        station: spec.station,
        lamp: 'dark',
        misfire: beat.view(),
        crate: openOn(),
        opened: openedAt === -Infinity ? Infinity : (ctx.clock.step - openedAt) / HZ,
      };
    },
  };
  return unit;
}
