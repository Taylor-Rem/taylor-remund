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
import { rotate } from '../math.ts';

/** Tune here. Units per second. */
export const OPENING_STAND_TUNING = {
  /** How far clear of the stand's edge a crate handed off is set down. */
  gap: 0.12,
  /**
   * (round two) The catch: a project crate the visitor lets go that comes to rest in the mouth leaning (its up more than
   * this far from the world's, as the crates unit's `upright` sees a crate knocked over) or hanging over the deck's edge
   * by more than `overhang` is squared up and set down in the middle of the deck, then opens there.
   */
  lean: Math.cos((12 * Math.PI) / 180),
  /** A shut project crate lying still on the deck this long (s) is set down beside it (the deck kept clear). */
  clear: 0.75,
  overhang: 0.02,
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
  let falling: { crate: Id; cause: Cause; since: number } | null = null;
  /** (round two) A crate come to rest leaning or over the edge: the stand squares it up next step, under its placing. */
  let catching: { crate: Id; cause: Cause } | null = null;
  /** Shut project crates lying still in the mouth: since when (step). */
  const shutSince = new Map<Id, number>();
  /** Crates squared up once for this placing: the next rest opens them whatever (never caught twice in a row). */
  const caught = new Set<Id>();
  /** The deck's local frame: a point's offset from the mouth's middle, along the mouth's own x and z. */
  const local = (p: Vec3): [number, number] => {
    const yaw = ((mouth.yaw ?? 0) * Math.PI) / 180;
    const dx = p[0] - mouth.c[0], dz = p[2] - mouth.c[2];
    return [dx * Math.cos(yaw) - dz * Math.sin(yaw), dx * Math.sin(yaw) + dz * Math.cos(yaw)];
  };
  /** Square on the deck: upright, and its footprint within the deck (the crate's own half extents, turned by its yaw). */
  const square = (id: Id): boolean => {
    const pose = ctx.pose(id);
    const h = ctx.halfExtents(id);
    if (!pose || !h) return true;
    if (rotate(pose.q, [0, 1, 0])[1] < T.lean) return false;
    const [lx, lz] = local(pose.p);
    const ax = rotate(pose.q, [1, 0, 0]);
    const c = Math.abs(ax[0]), sn = Math.abs(ax[2]);
    const ex = h[0] * c + h[2] * sn, ez = h[0] * sn + h[2] * c;
    return Math.abs(lx) + ex <= mouth.half[0] + T.overhang && Math.abs(lz) + ez <= mouth.half[2] + T.overhang;
  };
  /** The pose it is squared up to: the middle of the deck, standing, turned to the nearest quarter of its heading. */
  const squared = (id: Id): { p: Vec3; q: [number, number, number, number] } | null => {
    const pose = ctx.pose(id);
    const h = ctx.halfExtents(id);
    if (!pose || !h) return null;
    // its heading: whichever of its own x or z lies flatter, projected on the bench
    const ax = rotate(pose.q, [1, 0, 0]);
    const az = rotate(pose.q, [0, 0, 1]);
    const a = Math.abs(ax[1]) < Math.abs(az[1]) ? Math.atan2(-ax[2], ax[0]) : Math.atan2(az[0], az[2]);
    // (the nearest quarter turn of its heading: turned forty-five degrees a large crate's corners overhang the deck, and
    // squared as it lay it would be caught again and again: the spec's runs beside a second browser found that)
    const yaw = Math.round(a / (Math.PI / 2)) * (Math.PI / 2);
    return { p: [mouth.c[0], mouth.drop[1] + h[1] + 0.01, mouth.c[2]], q: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)] };
  };

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

  /** Lift `id` out and set it down beside the stand (taken, put there, let go: its fall and rest are `cause`'s). */
  const aside = (id: Id, cause: Cause): void => {
    const op = ctx.pose(id);
    const oh = ctx.halfExtents(id);
    if (!op || !oh || !ctx.take(id, spec.id)) return;
    const reach = Math.max(mouth.half[0], mouth.half[2]) + Math.max(oh[0], oh[2]) + T.gap;
    const at: Vec3 = [mouth.c[0] + spec.aside[0] * reach, spec.floor + oh[1] + 0.04, mouth.c[2] + spec.aside[1] * reach];
    ctx.drive(id, { p: at, q: op.q }, true);
    ctx.release(id, [0, -0.3, 0], [0, 0, 0], cause);
  };

  /** Open `c` here under `cause`, and ask the page to look at it. */
  const openHere = (c: (typeof projects)[number], cause: Cause): void => {
    const r = ctx.commit([{ target: c.crate, field: 'open', after: true }], cause);
    if (r.effects.length > 0) {
      openedAt = ctx.clock.step;
      ctx.emit({ type: 'crate.opened', id: spec.id, crate: c.crate, project: c.project });
      // (round four) not when the page still looks at it (lifted and put back: the camera never left; it stays still)
      if (c.card !== undefined && !looking.has(c.card)) ctx.emit({ type: 'look', target: c.card });
    }
  };
  /** The cards the page has been asked to look at and not yet to look back from (heard). */
  const looking = new Set<Id>();

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
      // not a project crate: it rests here
      if (!c || ctx.bracketed) return OK;
      // (round two) a project crate come to rest here by nobody's placing (Fetch's, a knock off the platen): the stand keeps
      // its deck clear, so a crate the visitor brings has somewhere to land; it sets it down beside itself, shut. (Round
      // two's failures: a crate knocked off the platen lay shut at the back of the deck, the visitor's crate landed half
      // on it and slid off the front.)
      if (cause === 'crew' || cause === 'system') {
        if (ctx.setting(c.crate, 'open') !== true && !handedOff.has(c.crate)) {
          handedOff.add(c.crate);
          aside(c.crate, 'system');
        }
        return OK;
      }
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
        aside(other, cause);
        // the new one is on top of the old: it falls onto the stand now, and opens when it rests there
        const ph = ctx.halfExtents(c.crate);
        const pp = ctx.pose(c.crate);
        if (ph && pp && pp.p[1] - ph[1] > mouth.drop[1] + 0.05) {
          falling = { crate: c.crate, cause, since: ctx.clock.step };
          return OK;
        }
      }
      // (round two) leaning, or over the deck's edge: it rests shut now; next step the stand squares it up (and it opens)
      if (!square(c.crate) && !caught.has(c.crate)) {
        catching = { crate: c.crate, cause };
        caught.add(c.crate);
        return OK;
      }
      caught.delete(c.crate);
      openHere(c, cause);
      // it rests where it is (no custody): the world commits its rest under the same transaction
      return OK;
    },
    abort() {},

    pre() {
      // (round two) the deck kept clear: a shut project crate lying still on it (one that came by no placing of the
      // visitor's, or rests there shut for any reason) is set down beside it after a moment, as the system's doing
      if (!ctx.bracketed) {
        for (const c of projects) {
          const id = c.crate;
          const lying = ctx.mode(id) === 'free' && ctx.settled(id) && inMouth(id) && ctx.setting(id, 'open') !== true && falling?.crate !== id && catching?.crate !== id;
          if (!lying) {
            shutSince.delete(id);
            continue;
          }
          const since = shutSince.get(id) ?? ctx.clock.step;
          shutSince.set(id, since);
          if (ctx.clock.step - since >= T.clear * HZ) {
            shutSince.delete(id);
            handedOff.add(id);
            aside(id, 'system');
          }
        }
      }
      if (catching) {
        const k = catching;
        catching = null;
        const to = squared(k.crate);
        if (to && ctx.mode(k.crate) === 'free' && inMouth(k.crate) && ctx.take(k.crate, spec.id)) {
          ctx.drive(k.crate, to, true);
          ctx.release(k.crate, [0, 0, 0], [0, 0, 0], k.cause);
          // (round three) and it opens now, under its placing: set down a hair over the deck, square, its next rest may
          // never be reported (the lead's run: squared, then shut on the deck for good, the deck-clearing held off by a
          // `falling` that never came down)
          const c = projects.find((x) => x.crate === k.crate);
          if (c && ctx.setting(c.crate, 'open') !== true) openHere(c, k.cause);
          caught.delete(k.crate);
        }
      }
      // a crate handed off is the stand's to open again once a hand has had it, or once it lies outside the mouth
      for (const id of [...handedOff]) if (ctx.mode(id) === 'held' || (ctx.mode(id) === 'free' && ctx.settled(id) && !inMouth(id))) handedOff.delete(id);
      // (round three) and a fall that never comes to rest within three seconds is forgotten (the deck-clearing then sees it)
      if (falling && (ctx.mode(falling.crate) === 'held' || !inMouth(falling.crate) || ctx.clock.step - falling.since > 3 * HZ)) falling = null;
      for (const id of [...caught]) if (ctx.mode(id) === 'held' || !inMouth(id)) caught.delete(id);
    },

    restored(restores: readonly Restore[]) {
      void restores;
    },
    reset() {
      openedAt = -Infinity;
      handedOff.clear();
      falling = null;
      catching = null;
      shutSince.clear();
      looking.clear();
      caught.clear();
      beat.reset();
    },
    heard(events: readonly SimEvent[]) {
      for (const e of events) {
        // (the page looks at one thing at a time: a look at anything else ends the look at a card)
        if (e.type === 'look') {
          looking.clear();
          looking.add(e.target);
        }
        else if (e.type === 'look.back') looking.delete(e.target);
      }
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
