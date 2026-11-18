/**
 * The storefront (REWRITE.md § B2 X1, the STOREFRONT row: "sign colour,
 * sign words, awning colour, open or closed, a photo in the window"; § F3:
 * "a text changes the storefront and a reply comes back").
 *
 * It has no mouth and no handle of its own: texts through the STOREFRONT
 * jack change it. Durable settings (target: its unit id), each changed only
 * by an instruction, all of one text's changes in one commit:
 * - `sign`: the fascia's paint, one of the 8 paints;
 * - `words`: the fascia's words, capitals, at most 16, already through the
 *   tape rule (sim/instruct/tape.ts); '' is the fascia's own words, which
 *   live in src/content/storefront.json (the sim holds no sentence);
 * - `awning`: the awning's paint;
 * - `open`: the door's card says OPEN (true) or CLOSED;
 * - `picture`: one of the window's pictures, or `none` (the empty frame).
 *   "next" goes round the five pictures.
 *
 * Each change is a beat the view performs (`StorefrontView.beats`), and an
 * undo's or a reset's restore is the same beat run backwards.
 */
import type { Cause, Id, Instruction, Outcome, StationId, StorefrontView, Value, WindowPicture } from '../types.ts';
import type { MachineUnit, SimContext } from '../context.ts';
import type { UnitFactory } from '../scene.ts';
import { Beat, CHANGED_SINCE, Lamp, OK } from '../machine.ts';
import { PAINTS } from '../instruct/words.ts';
import { checkWords } from '../instruct/tape.ts';
import { Beats, STOREFRONT_FIELDS as F, WINDOW_PICTURES, boardOf, jackFor, newerWriter } from './shared/patchlamp.ts';

/** How the visit begins (the storefront piece's DEFAULTS and REST pose: green fascia, red awning, OPEN, mountains). */
export const STOREFRONT_START = { sign: 'paint-green', words: '', awning: 'cable-red', open: true, picture: 'mountains' as WindowPicture } as const;

export interface StorefrontSpec {
  readonly id: Id;
  readonly station: StationId;
  /** Content id of its name. */
  readonly name: string;
}

export interface StorefrontUnit extends MachineUnit {
  view(): StorefrontView;
}

const isPaint = (v: Value): boolean => typeof v === 'string' && PAINTS.includes(v);
const isWords = (v: Value): boolean => v === '' || (typeof v === 'string' && checkWords(v).ok && (checkWords(v) as { text: string }).text === v);
const PICTURE_VALUES: readonly WindowPicture[] = [...WINDOW_PICTURES, 'none'];

export function storefront(spec: StorefrontSpec): UnitFactory {
  return (ctx) => createStorefront(ctx, spec);
}

export function createStorefront(ctx: SimContext, spec: StorefrontSpec): StorefrontUnit {
  const id = spec.id;
  const S = STOREFRONT_START;
  ctx.defineSetting(id, F.sign, S.sign, isPaint);
  ctx.defineSetting(id, F.words, S.words, isWords);
  ctx.defineSetting(id, F.awning, S.awning, isPaint);
  ctx.defineSetting(id, F.open, S.open, (v) => typeof v === 'boolean');
  ctx.defineSetting(id, F.picture, S.picture, (v) => typeof v === 'string' && (PICTURE_VALUES as readonly string[]).includes(v));
  const lamp = new Lamp(ctx);
  const misfire = new Beat(ctx);
  const beats = new Beats(ctx, id, (target) => target === id);
  const get = (f: string): Value => ctx.setting(id, f) as Value;

  const unit: StorefrontUnit = {
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

    instruct(cmd: Instruction, cause: Cause): Outcome {
      if (cmd.verb !== 'storefront.set') return { ok: false, wanted: 'help.storefront' };
      const a = cmd.args;
      const changes: { target: Id; field: string; after: Value }[] = [];
      if (typeof a['sign'] === 'string') changes.push({ target: id, field: F.sign, after: a['sign'] });
      if (typeof a['words'] === 'string') changes.push({ target: id, field: F.words, after: a['words'] });
      if (typeof a['awning'] === 'string') changes.push({ target: id, field: F.awning, after: a['awning'] });
      if (typeof a['open'] === 'boolean') changes.push({ target: id, field: F.open, after: a['open'] });
      const p = a['picture'];
      if (p === 'next') {
        const i = WINDOW_PICTURES.indexOf(get(F.picture) as (typeof WINDOW_PICTURES)[number]);
        changes.push({ target: id, field: F.picture, after: WINDOW_PICTURES[(i + 1) % WINDOW_PICTURES.length] as string });
      } else if (typeof p === 'string') changes.push({ target: id, field: F.picture, after: p });
      if (changes.length === 0) return OK;
      lamp.used();
      if (newerWriter(ctx, cause, changes)) return { ok: false, wanted: CHANGED_SINCE };
      const r = ctx.commit(changes, cause);
      return r.refused.length > 0 ? { ok: false, wanted: CHANGED_SINCE } : OK;
    },

    accept(): Outcome {
      // no mouth: nothing is ever offered to it (law 2 belongs to the platen on this line)
      return { ok: false, wanted: 'help.storefront' };
    },
    abort() {},

    heard(events) {
      beats.heard(events);
    },
    reset() {
      lamp.reset();
      misfire.reset();
      beats.reset();
    },

    view(): StorefrontView {
      const shown = beats.view();
      return {
        kind: 'storefront',
        id,
        station: spec.station,
        lamp: lamp.state(boardOf(ctx).working === id),
        misfire: misfire.view(),
        jack: jackFor(ctx, id),
        answered: beats.answered(),
        beats: shown,
        sign: get(F.sign) as string,
        words: get(F.words) as string,
        awning: get(F.awning) as string,
        open: get(F.open) as boolean,
        picture: get(F.picture) as WindowPicture,
      };
    },
  };
  return unit;
}
