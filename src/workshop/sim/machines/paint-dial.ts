/**
 * The paint dial (P4 D2b): t-components' demonstration, the thing in its crate (`crate-3`). One hex-colour prop drove a
 * whole product's styling; here one dial drives the enamel of every machine on the bench. A loose part (kind `tool`)
 * with one durable field and one control that rides on it, built the way the ledger board is (machines/ledger.ts):
 *
 * - The scheme is the dial's own field (`SCHEME_FIELD` on the dial's id): which of `PAINT_TUNING.schemes` the
 *   workshop wears. It rides with the dial whatever is done to it (carried, thrown, belted, painted, shipped and back up
 *   the chute, stowed again): the scheme is the dial's and stays.
 * - The knob (`knob`: a name, a tell, a misfire, `turn` and `press`) turns through detents. A drag turns it detent by
 *   detent (`turn`, value 0..1), one gesture one transaction; a press or a tap, or the keys from the controls list, moves
 *   it one detent on (`press`), past the last back to the first. One effect per change, under the visitor's
 *   transaction, so the UNDO lever restores the recorded value and the view wipes back from wherever the dial is now.
 * - (D2c, as the ledger board's controls) A second press this soon after the one before (`doubleSeconds`) is held
 *   `doubleSteps` before it is done: if the visitor's double-tap asks for the dial (`select`) meanwhile, it was half of
 *   that and is dropped. So a double-tap turns the dial once (its first tap) and looks.
 * - (D2c) `select` (a double-click or double-tap on the dial or its knob): `look` at it (on its tray, its crate's card;
 *   out, the dial itself). A turn by hand (not the lever, not a reset) emits `look.back` for that same target (D2d):
 *   if that look still holds the camera, it goes back out to the room it repaints.
 * - In nobody's reach (in a hand, in the crew's, shipped, down the chute, in its shut crate): a turn is a misfire.
 * - Never saved: a visit is not remembered in another scheme (Taylor: "provided the original approved appearance
 *   returns on a new visit"). `World.saved()` lists nothing of it; "Reset the workshop" puts the first scheme back.
 *
 * The world's paint does not change here: the view wipes it across the room from where the dial is (view/stations/
 * paint-dial.ts), over `PAINT_TUNING.wipeSeconds`, and the bell (`paint.wiped`) rings when it has crossed. The schemes'
 * colours are the view's (view/materials/scheme.ts); the simulation knows them only by their letters, in dial order.
 *
 * What it is true to and what it simplifies: the toy truth table row (REWRITE.md § F3) in the D2b hand-in.
 */
import type { Id, Intent, Outcome, PaintDialView, Restore, SimEvent, StationId, Value } from '../types.ts';
import type { MachineUnit, SimContext } from '../context.ts';
import type { UnitFactory } from '../scene.ts';
import { HZ, steps } from '../clock.ts';
import { Beat, OK, gesture, handleTxn } from '../machine.ts';

/** The dial's durable field: the scheme the workshop wears, one of `PAINT_TUNING.schemes`. */
export const SCHEME_FIELD = 'scheme';

/** Tune here. */
export const PAINT_TUNING = {
  /**
   * The schemes on the dial, in its order (its detents; three to five), by the working letters of view/materials/
   * scheme.ts. The first is the approved look and the home position. The owner has not chosen: the table is proposed.
   */
  schemes: ['A', 'B', 'C', 'D'] as readonly string[],
  /** How long the wipe takes to cross the room (the view draws it over this; the bell rings at its end). */
  wipeSeconds: 1.8,
  /**
   * (D2c) A second press this soon after the one before is held `doubleSteps` before it is done: if the visitor's
   * double-tap asks for the dial (`select`) meanwhile, it was half of that and is dropped (the ledger board's values:
   * machines/ledger.ts LEDGER_TUNING).
   */
  doubleSeconds: 0.36,
  doubleSteps: 3,
};

export interface PaintDialSpec {
  /** The unit's id (its view: `WorldView.machine(id)`). */
  readonly id: Id;
  readonly station: StationId;
  /** The dial: a loose part of the scene (kind `tool`, `stowedIn` its crate). */
  readonly dial: Id;
  readonly crate: Id;
  readonly knob: { readonly id: Id; readonly name: string };
  /** The schemes on the dial (default `PAINT_TUNING.schemes`). */
  readonly schemes?: readonly string[];
}

export interface PaintDialUnit extends MachineUnit {
  view(): PaintDialView;
}

export function paintDial(spec: PaintDialSpec): UnitFactory {
  return (ctx) => createPaintDial(ctx, spec);
}

/** Is `v` one of the dial's schemes? */
export const isScheme = (schemes: readonly string[]) => (v: Value): boolean => typeof v === 'string' && schemes.includes(v);

export function createPaintDial(ctx: SimContext, spec: PaintDialSpec): PaintDialUnit {
  const schemes = spec.schemes ?? PAINT_TUNING.schemes;
  if (schemes.length < 3 || schemes.length > 5) throw new Error(`paint dial: ${schemes.length} schemes (three to five)`);
  const home = schemes[0]!;
  const dialSpec = ctx.scene.parts.find((p) => p.id === spec.dial);
  // a scene without the dial (the development stand-in has its crate): an inert unit, nothing registered
  const present = !!dialSpec && dialSpec.kind !== 'crate';
  if (present) ctx.defineSetting(spec.dial, SCHEME_FIELD, home, isScheme(schemes));
  const beat = new Beat(ctx);
  const turning = gesture();

  /** The last change (a hand, an undo, a reset): when, from what, by whom; and whether its bell has rung. */
  let change: { at: number; from: string; to: string; by: 'hand' | 'restore' } | null = null;
  let rung = true;
  /** When a hand last worked the knob (its click and travel), even when the turn changed nothing. */
  let workedAt = -1;
  /** (D2c) The last press (its step), and a second press held a moment in case it is half of a double-tap (its step). */
  let lastPress = -Infinity;
  let held: number | null = null;

  const scheme = (): string => {
    const v = present ? ctx.setting(spec.dial, SCHEME_FIELD) : home;
    return typeof v === 'string' && schemes.includes(v) ? v : home;
  };

  /** In the world and in nobody's hand: free on the bench, or in a machine's mouth (its crate's tray, the belt, the platen). */
  const reachable = (): boolean => {
    const m = ctx.mode(spec.dial);
    return m === 'free' || m === 'machine';
  };

  if (present) {
    ctx.register({
      id: spec.knob.id,
      station: spec.station,
      name: spec.knob.name,
      affordances: ['turn', 'press'],
      on: spec.dial,
      tell: () => ctx.emit({ type: 'tell', id: spec.knob.id }),
      misfire: (level) => {
        beat.hit(level);
        ctx.emit({ type: 'misfire', id: spec.knob.id, level });
      },
    });
  }

  /** The scheme changed by a hand: one effect done (by `commit`), then what a visitor sees and hears of it. */
  function turned(from: string, to: string): void {
    change = { at: ctx.clock.step, from, to, by: 'hand' };
    rung = false;
    ctx.emit({ type: 'paint.turned', id: spec.id, dial: spec.dial, scheme: to, from, index: schemes.indexOf(to), of: schemes.length });
    // (D2c) the payoff is the whole room: whatever a look holds, the camera goes back out to see it
    ctx.emit({ type: 'look.back', target: lookTarget() });
  }

  /** Turn to `to` under the hand's transaction (a drag): one effect, at once. */
  function turnTo(to: string, g: ReturnType<typeof gesture>): boolean {
    const from = scheme();
    const i = schemes.indexOf(to);
    workedAt = ctx.clock.step;
    ctx.emit({ type: 'handle.worked', id: spec.knob.id, value: i / (schemes.length - 1) });
    if (to === from) return true;
    const t = handleTxn(ctx, g, 'turn', spec.knob.id);
    const r = ctx.commit([{ target: spec.dial, field: SCHEME_FIELD, after: to }], t);
    if (r.effects.length > 0) turned(from, to);
    return true;
  }

  /** A press: the knob one detent on, at once, under its own transaction. */
  function press(): boolean {
    const n = schemes.length;
    const from = scheme();
    const to = schemes[(schemes.indexOf(from) + 1) % n]!;
    workedAt = ctx.clock.step;
    ctx.emit({ type: 'handle.worked', id: spec.knob.id, value: schemes.indexOf(to) / (n - 1) });
    const t = handleTxn(ctx, gesture(), 'press', spec.knob.id);
    if (ctx.commit([{ target: spec.dial, field: SCHEME_FIELD, after: to }], t).effects.length > 0) turned(from, to);
    return true;
  }

  /**
   * (D2c) A press now, or held a moment if it follows the last one closely (half of a double-tap, perhaps). A press
   * already held is done first: a quick run of presses (the keys) turns the dial once a press, none dropped.
   */
  function pressOrHold(): boolean {
    if (held !== null) {
      held = null;
      press();
    }
    const last = lastPress;
    lastPress = ctx.clock.step;
    if (ctx.clock.step - last <= steps(PAINT_TUNING.doubleSeconds)) {
      held = ctx.clock.step;
      return true;
    }
    return press();
  }

  /** (D2c) Where to look when the dial is asked for: its crate's card while it is on the tray, else the dial itself. */
  const lookTarget = (): Id => {
    const l = ctx.part(spec.dial)?.location;
    return l && l.at === 'in' && l.mouth === spec.crate ? `${spec.crate}-card` : spec.dial;
  };

  const unit: PaintDialUnit = {
    id: spec.id,
    station: spec.station,
    name: dialSpec?.name ?? spec.id,
    // (the dial is its own registry entry, as a part; the unit is listed only for its view: nothing to press here)
    affordances: [],
    tell() {
      if (present) ctx.emit({ type: 'tell', id: spec.knob.id });
    },
    misfire(level) {
      beat.hit(level);
    },

    intent(intent: Intent): boolean {
      // (D2c) a double-click or double-tap on the dial or its knob: look at it (never while it is in a hand, the chute,
      // shipped or stowed); the double-tap's second press (held a moment, above) was half of it and is dropped
      if (intent.type === 'select' && present && (intent.id === spec.knob.id || intent.id === spec.dial)) {
        if (ctx.bracketed) return false;
        held = null;
        if (!reachable()) return false;
        ctx.emit({ type: 'look', target: lookTarget() });
        return true;
      }
      if (intent.type !== 'turn' && intent.type !== 'press') return false;
      if (!present || intent.id !== spec.knob.id) return false;
      if (ctx.bracketed) return false;
      if (!reachable()) {
        // in a hand, shipped, down the chute, in its shut crate: the knob will not turn
        beat.hit(1);
        ctx.emit({ type: 'misfire', id: spec.knob.id, level: 1 });
        return true;
      }
      const n = schemes.length;
      if (intent.type === 'turn') {
        // a drag: a press held is the same hand's, and done now first
        if (held !== null) {
          held = null;
          press();
        }
        const v = Math.min(1, Math.max(0, intent.value));
        return turnTo(schemes[Math.round(v * (n - 1))]!, turning);
      }
      return pressOrHold();
    },

    pre() {
      if (ctx.bracketed || held === null) return;
      // a second press no double-tap claimed: done now (a moment late); out of reach meanwhile, it is dropped
      if (!reachable()) held = null;
      else if (ctx.clock.step - held >= PAINT_TUNING.doubleSteps) {
        held = null;
        press();
      }
    },

    post() {
      // the bell, once the wipe has crossed the room
      if (rung || !change || ctx.bracketed) return;
      if (ctx.clock.step - change.at >= steps(PAINT_TUNING.wipeSeconds)) {
        rung = true;
        ctx.emit({ type: 'paint.wiped', id: spec.id, dial: spec.dial, scheme: change.to });
      }
    },

    lost() {},

    restored(restores: readonly Restore[]) {
      // the lever or a reset put the scheme back: the view wipes back from where the dial is now
      const r = restores.find((x) => x.target === spec.dial && x.field === SCHEME_FIELD);
      if (!r || typeof r.from !== 'string' || typeof r.to !== 'string' || r.from === r.to) return;
      change = { at: ctx.clock.step, from: r.from, to: r.to, by: 'restore' };
      rung = false;
    },

    reset() {
      beat.reset();
      workedAt = -1;
      held = null;
      lastPress = -Infinity;
    },

    heard(events: readonly SimEvent[]) {
      void events;
    },

    // no mouth names the dial's unit, so the world never offers it a part; were one to, it rests where it lies
    accept: (): Outcome => OK,
    abort() {},

    view(): PaintDialView {
      const s = scheme();
      const c = change;
      return {
        kind: 'paint-dial',
        id: spec.id,
        station: spec.station,
        lamp: 'dark',
        misfire: beat.view(),
        dial: spec.dial,
        knob: spec.knob.id,
        schemes,
        scheme: s,
        index: schemes.indexOf(s),
        change: c ? { from: c.from, to: c.to, since: (ctx.clock.step - c.at) / HZ, by: c.by } : null,
        wipe: PAINT_TUNING.wipeSeconds,
        worked: workedAt < 0 ? Infinity : (ctx.clock.step - workedAt) / HZ,
        reachable: present && reachable(),
      };
    },
  };
  return unit;
}
