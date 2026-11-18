/**
 * The lamp (REWRITE.md § B2 X1, the LAMP row: "brighter, dimmer, a colour,
 * off, on"; "Make it blue" into LAMP turns the light of the whole workshop
 * blue; "the lamp's off" is night; § D 14: the lamp's arm is a handle).
 *
 * Durable settings (target: its unit id) the stage reads to tint, dim and
 * aim the room's one key light:
 * - `on`: off is night;
 * - `level`: a brightness step, 1 to `levels` (the visit starts at
 *   `startLevel`, the light the G1 pictures were taken in);
 * - `colour`: `warm` (its own amber) or one of the 8 paints;
 * - `x`, `z` (S6): the AIM, the point on the bench top (world) the shade
 *   points at, kept inside the piece's reachable region (`LampSpec.reach`,
 *   a convex polygon from the scene). The view derives the bulb and the
 *   shade's axis from the aim with the lamp piece's `aimLamp`, so the pool
 *   of light and every shadow swing with the arm. The simulation does not
 *   decide where the bulb is.
 *
 * Texts through the LAMP jack set `on`, `level` and `colour` (all of one
 * text in one commit). The arm is a handle: a drag (`drag` intents with the
 * lamp's id, or one grab of its shade, S6) moves the aim to the point the
 * hand's target stands over (its x, z: the input passes the pointer's point on
 * the bench), the nearest one the joints reach, at once, and commits `x` and `z` in ONE transaction when
 * the hand lets go, so the lever and "Reset the workshop" put it back and a
 * new visit starts at home (§ D 14). "Brighter" with the lamp off turns it
 * on as well; "dimmer" at the lowest step, "brighter" at the highest, say so.
 */
import type { Cause, Id, Instruction, Intent, LampView, Outcome, StationId, TransactionId, Value, Vec3 } from '../types.ts';
import type { MachineUnit, SimContext } from '../context.ts';
import type { UnitFactory } from '../scene.ts';
import { Beat, CHANGED_SINCE, Lamp, OK } from '../machine.ts';
import { steps } from '../clock.ts';
import { PAINTS } from '../instruct/words.ts';
import { Beats, LAMP_FIELDS as F, boardOf, jackFor, newerWriter } from './shared/patchlamp.ts';

export const LAMP_TUNING = {
  /** A drag the hand never ended (its last intent lost) is let go after this many seconds without one. */
  dragTimeout: 5,
  /** The bulb's position is kept to this grid (units): a drag commits a clean value. */
  grid: 0.01,
} as const;

export interface LampSpec {
  readonly id: Id;
  readonly station: StationId;
  /** Content id of its name. */
  readonly name: string;
  /** Brightness steps, and the one the visit starts at. */
  readonly levels: number;
  readonly startLevel: number;
  /** What the shade points at when the visit begins (world, on the bench top). */
  readonly home: { readonly aim: Vec3 };
  /**
   * What the joints allow (§ D 14, from the scene): the aim stays inside this convex polygon (world x, z,
   * either winding): the lamp piece's `REACH`, placed where the lamp is clamped.
   */
  readonly reach: { readonly polygon: readonly (readonly [number, number])[] };
}

export interface LampUnit extends MachineUnit {
  view(): LampView;
}

const isPaintOrWarm = (v: Value): boolean => v === 'warm' || (typeof v === 'string' && PAINTS.includes(v));

/** Is (x, z) inside the convex polygon (or on its edge)? */
export function insidePolygon(poly: readonly (readonly [number, number])[], x: number, z: number): boolean {
  const n = poly.length;
  let wind = 0;
  for (let i = 0; i < n; i++) {
    const [ax, az] = poly[i]!;
    const [bx, bz] = poly[(i + 1) % n]!;
    wind += ax * bz - bx * az;
  }
  const w = Math.sign(wind);
  for (let i = 0; i < n; i++) {
    const [ax, az] = poly[i]!;
    const [bx, bz] = poly[(i + 1) % n]!;
    if (w * ((bx - ax) * (z - az) - (bz - az) * (x - ax)) < -1e-9) return false;
  }
  return true;
}

/** The nearest aim (x, z) the arm can reach: the point itself inside the region, else the nearest point of its edge; on the grid. */
export function reachable(spec: LampSpec, x: number, z: number): [number, number] {
  const poly = spec.reach.polygon;
  let best: [number, number] = [x, z];
  if (!insidePolygon(poly, x, z)) {
    let bd = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const [ax, az] = poly[i]!;
      const [bx, bz] = poly[(i + 1) % poly.length]!;
      const ex = bx - ax;
      const ez = bz - az;
      const k = Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)));
      const px = ax + ex * k;
      const pz = az + ez * k;
      const d = (px - x) ** 2 + (pz - z) ** 2;
      if (d < bd) [bd, best] = [d, [px, pz]];
    }
  }
  const g = LAMP_TUNING.grid;
  return [Math.round(best[0] / g) * g, Math.round(best[1] / g) * g];
}

export function lamp(spec: LampSpec): UnitFactory {
  return (ctx) => createLamp(ctx, spec);
}

export function createLamp(ctx: SimContext, spec: LampSpec): LampUnit {
  const id = spec.id;
  const N = spec.levels;
  const [hx, hz] = reachable(spec, spec.home.aim[0], spec.home.aim[2]);
  ctx.defineSetting(id, F.on, true, (v) => typeof v === 'boolean');
  ctx.defineSetting(id, F.level, spec.startLevel, (v) => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= N);
  ctx.defineSetting(id, F.colour, 'warm', isPaintOrWarm);
  ctx.defineSetting(id, F.x, hx, (v) => typeof v === 'number' && Number.isFinite(v));
  ctx.defineSetting(id, F.z, hz, (v) => typeof v === 'number' && Number.isFinite(v));
  const lampState = new Lamp(ctx);
  const misfire = new Beat(ctx);
  const beats = new Beats(ctx, id, (target, field) => target === id && field !== F.x && field !== F.z);
  const get = (f: string): Value => ctx.setting(id, f) as Value;

  /** A drag in hand: where the aim is now (transient until the hand lets go). */
  let drag: { x: number; z: number; last: number } | null = null;

  const aimAt = (x: number, z: number): Vec3 => [x, spec.home.aim[1], z];

  /** The hand lets go: the arm's new place is one transaction (nothing, and no transaction, if it did not move). */
  function letGo(): void {
    const d = drag;
    drag = null;
    if (!d || ctx.bracketed) return;
    const changes = [
      { target: id, field: F.x, after: d.x },
      { target: id, field: F.z, after: d.z },
    ].filter((c) => get(c.field) !== c.after);
    if (changes.length === 0) return;
    const t: TransactionId = ctx.history.open('turn', id, ctx.clock.step);
    ctx.commit(changes, t);
  }

  const unit: LampUnit = {
    id,
    station: spec.station,
    name: spec.name,
    affordances: ['grab', 'slide'],
    tell() {
      lampState.tell();
      ctx.emit({ type: 'tell', id });
    },
    misfire(level) {
      misfire.hit(level);
      ctx.emit({ type: 'misfire', id, level });
    },

    // S6: one grab: the world turns grab / carry / release of the shade into the `drag` intents below
    holds: (what: Id): boolean => what === id,

    intent(intent: Intent): boolean {
      if (intent.type !== 'drag' || intent.id !== id || ctx.bracketed) return false;
      const [x, z] = reachable(spec, intent.target[0], intent.target[2]);
      if (!drag) ctx.emit({ type: 'handle.worked', id });
      drag = { x, z, last: ctx.clock.step };
      lampState.used();
      if (intent.end) letGo();
      return true;
    },

    instruct(cmd: Instruction, cause: Cause): Outcome {
      if (cmd.verb !== 'lamp.set') return { ok: false, wanted: 'help.lamp' };
      const a = cmd.args;
      const on = get(F.on) as boolean;
      const level = get(F.level) as number;
      const changes: { target: Id; field: string; after: Value }[] = [];
      if (typeof a['on'] === 'boolean') changes.push({ target: id, field: F.on, after: a['on'] });
      if (a['level'] === 1) {
        if (level >= N && on) return { ok: false, wanted: 'lamp.brightest' };
        if (level < N) changes.push({ target: id, field: F.level, after: level + 1 });
        if (!on && typeof a['on'] !== 'boolean') changes.push({ target: id, field: F.on, after: true }); // brighter from dark: on as well
      } else if (a['level'] === -1) {
        if (level <= 1) return { ok: false, wanted: 'lamp.dimmest' };
        changes.push({ target: id, field: F.level, after: level - 1 });
      }
      if (typeof a['colour'] === 'string') changes.push({ target: id, field: F.colour, after: a['colour'] });
      if (changes.length === 0) return OK;
      lampState.used();
      if (newerWriter(ctx, cause, changes)) return { ok: false, wanted: CHANGED_SINCE };
      const r = ctx.commit(changes, cause);
      return r.refused.length > 0 ? { ok: false, wanted: CHANGED_SINCE } : OK;
    },

    accept(): Outcome {
      return { ok: false, wanted: 'help.lamp' }; // no mouth
    },
    abort() {},

    pre() {
      // a drag whose end was lost is let go; not one the world's hand still holds (it always says when it lets go)
      const inHand = ctx.holding()?.kind === 'unit' && ctx.holding()?.id === id;
      if (drag && !inHand && !ctx.bracketed && ctx.clock.step - drag.last > steps(LAMP_TUNING.dragTimeout)) letGo();
    },
    bracket(on) {
      if (on) drag = null; // a rung: handles do not respond; the arm goes back to where it was set
    },
    heard(events) {
      beats.heard(events);
    },
    reset() {
      drag = null;
      lampState.reset();
      misfire.reset();
      beats.reset();
    },

    view(): LampView {
      const x = drag ? drag.x : (get(F.x) as number);
      const z = drag ? drag.z : (get(F.z) as number);
      return {
        kind: 'lamp',
        id,
        station: spec.station,
        lamp: lampState.state(boardOf(ctx).working === id),
        misfire: misfire.view(),
        jack: jackFor(ctx, id),
        answered: beats.answered(),
        beats: beats.view(),
        on: get(F.on) as boolean,
        level: get(F.level) as number,
        levels: N,
        colour: get(F.colour) as string,
        aim: aimAt(x, z),
        home: { aim: aimAt(hx, hz), level: spec.startLevel },
        reach: spec.reach.polygon,
        dragging: drag !== null,
      };
    },
  };
  return unit;
}
