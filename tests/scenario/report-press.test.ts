// P4 D3: the report press in the Report Generation Framework's crate. One pull of its one lever: the two sheets show
// what the dock has shipped this visit (the same marks on both), the drawer is one copy thicker, and the envelope is
// folded and flicked onto the belt, where it queues behind whatever is riding, ships at the dock with the bell, and
// comes home to the press (never up the chute). One effect group under the pull, undone exactly by the lever wherever
// the envelope had got to.
import { describe, expect, test } from 'vitest';
import { benchWorld, putOn, waitFor, onBelt, tape, BENCH, type Tape } from './line-helpers.ts';
import { loc, pressOut, until } from './press-helpers.ts';
import { HZ, steps } from '../../src/workshop/sim/clock.ts';
import { PRESS } from '../../src/workshop/sim/scenes/bench.ts';
import { DRAWER_FIELD, PRESS_SHOW_STEPS, REPORT_FIELD, SEAL_FIELD } from '../../src/workshop/sim/machines/press.ts';
import { OPEN } from '../../src/workshop/sim/machines/crates.ts';
import { DOCK_TUNING } from '../../src/workshop/sim/machines/dock.ts';
import { BELT_FIELDS } from '../../src/workshop/sim/machines/belt.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { PressView } from '../../src/workshop/sim/types.ts';
import { plug, textAndWait, traySpot } from './patchlamp-helpers.ts';
import { parseSaved } from '../../src/workshop/sim/saved.ts';

const P = PRESS.body;
const E = PRESS.envelope;
const view = (w: World): PressView => w.machine(PRESS.unit) as PressView;
const pull = (w: World): void => w.dispatch({ type: 'press', id: PRESS.lever });
const report = (w: World): readonly string[] | null => w.setting(P, REPORT_FIELD) as readonly string[] | null;
const drawer = (w: World): number => w.setting(P, DRAWER_FIELD) as number;
/** Put a crate through the dock: on the belt, ridden, shipped. */
function ship(w: World, t: Tape, id: string): void {
  putOn(w, t, id, onBelt(0.7));
  expect(waitFor(w, t, id, 'shipped', 900), `${id} ships`).toBe(true);
}

describe('the report press', () => {
  test('stowed in its crate with its envelope in it; out of it, a pull prints an honest empty report, stores a copy, and flicks the envelope onto the belt', async () => {
    const { w, t } = await pressOut('rp-first');
    expect(w.setting(PRESS.crate, OPEN)).toBe(true);
    expect(w.mode(P)).toBe('machine');
    expect(loc(w, E)).toBe(`in:${P}`);
    expect(w.mode(E)).toBe('gone');
    expect(report(w)).toBeNull();
    expect(drawer(w)).toBe(0);
    pull(w);
    const ev = t.run(1);
    expect(report(w)).toEqual([]);
    expect(drawer(w)).toBe(1);
    expect(w.setting(E, SEAL_FIELD)).toBeNull();
    // one transaction, one effect per field
    const top = w.undoStack().at(-1)!;
    expect(top.entries.map((e) => `${e.target}.${e.field}`).sort()).toEqual([`${E}.${SEAL_FIELD}`, `${P}.${DRAWER_FIELD}`, `${P}.${REPORT_FIELD}`].sort());
    expect(ev.some((e) => e.type === 'press.printed' && e.marks === 0 && e.envelope)).toBe(true);
    // the flick, about two seconds in; it lands on the belt and rides
    t.run(steps(2.8));
    const fl = t.of('press.flicked');
    expect(fl).toHaveLength(1);
    expect(w.mode(E)).not.toBe('gone');
    expect(until(w, t, () => loc(w, E) === 'in:belt', 240), 'the envelope lands on the belt').toBe(true);
    // it ships with the bell, and does not come back up the chute: it comes home to the press
    expect(waitFor(w, t, E, 'shipped', 1200)).toBe(true);
    expect(t.of('shipped').some((x) => x.e.part === E)).toBe(true);
    t.run(steps(DOCK_TUNING.returnAfter.tool) + 5);
    expect(loc(w, E)).toBe(`in:${P}`);
    expect(w.mode(E)).toBe('gone');
    expect(t.of('returned').some((x) => x.e.part === E && x.e.how === 'chute')).toBe(false);
    expect(t.of('press.home')).toHaveLength(1);
    expect(w.part(E)!.marks).toEqual([]);
    w.dispose();
  }, 60_000);

  test('the report is the visit\'s shipments in the colours they shipped in, newest last; the envelope is sealed in the last mark', async () => {
    const { w, t } = await pressOut('rp-marks');
    plug(w, t, 'jack-platen');
    for (const [id, c] of [['crate-3', 'blue'], ['crate-4', 'red']] as const) {
      putOn(w, t, id, traySpot(), 120);
      t.run(HZ);
      expect(textAndWait(w, t, `paint it ${c}`).e.type).toBe('line.reply');
      t.run(2 * HZ);
      ship(w, t, id);
    }
    const shipped = t.of('shipped').map((x) => x.e.part);
    expect(shipped).toEqual(['crate-3', 'crate-4']);
    pull(w);
    t.run(1);
    expect(report(w)).toEqual(['paint-blue', 'cable-red']);
    expect(w.setting(E, SEAL_FIELD)).toBe('cable-red');
    expect(view(w).report).toEqual(report(w));
    w.dispose();
  }, 120_000);

  test('a second pull while the envelope is out still prints and stores; the bed comes up empty with a shrug', async () => {
    const { w, t } = await pressOut('rp-second');
    pull(w);
    expect(until(w, t, () => loc(w, E) === 'in:belt', 6 * HZ)).toBe(true);
    const seal = w.setting(E, SEAL_FIELD);
    pull(w);
    const ev = t.run(1);
    expect(ev.some((e) => e.type === 'press.printed' && !e.envelope)).toBe(true);
    expect(drawer(w)).toBe(2);
    expect(report(w)).toEqual([]);
    // the seal is not touched (the envelope is not in the press)
    expect(w.undoStack().at(-1)!.entries.some((e) => e.target === E)).toBe(false);
    expect(w.setting(E, SEAL_FIELD)).toBe(seal);
    t.run(PRESS_SHOW_STEPS);
    expect(t.of('press.beat').some((x) => x.e.beat === 'shrug')).toBe(true);
    expect(t.of('press.flicked')).toHaveLength(1);
    w.dispose();
  }, 60_000);

  test('a pull while one is showing (before the flick) waits its turn, and runs once the envelope has landed; with the press in a hand, the lever misfires and nothing prints', async () => {
    const { w, t } = await pressOut('rp-wait');
    pull(w);
    t.run(steps(0.5)); // (past a double-tap's window: a second press sooner is held a moment)
    pull(w);
    t.run(1);
    expect(drawer(w)).toBe(1);
    expect(view(w).waiting).toBe(true);
    expect(until(w, t, () => drawer(w) === 2, 8 * HZ), "the waiting pull runs once the envelope has landed").toBe(true);
    expect(drawer(w)).toBe(2);
    expect(view(w).waiting).toBe(false);
    w.dispatch({ type: 'grab', id: P, grip: w.motion(P)!.pose.p });
    t.run(5);
    pull(w);
    const ev = t.run(1);
    expect(ev.some((e) => e.type === 'misfire' && e.id === PRESS.lever)).toBe(true);
    expect(drawer(w)).toBe(2);
    w.dispatch({ type: 'release', velocity: [0, 0, 0] });
    t.run(HZ);
    w.dispose();
  }, 60_000);

  test('a pull while the envelope is in the air is refused politely: nothing prints, nothing joins the first pull', async () => {
    const { w, t } = await pressOut('rp-refuse');
    pull(w);
    expect(until(w, t, () => t.events.some((x) => x.e.type === 'press.flicked'), 4 * HZ)).toBe(true);
    t.run(10);
    const stack = w.undoStack().length;
    pull(w);
    const ev = t.run(1);
    expect(ev.some((e) => e.type === 'press.refused')).toBe(true);
    expect(ev.some((e) => e.type === 'press.printed')).toBe(false);
    expect(drawer(w)).toBe(1);
    expect(w.undoStack().length).toBe(stack);
    expect(view(w).refused).toBeLessThan(0.1);
    // it lands on the belt under the first pull, and then a pull prints again
    expect(until(w, t, () => loc(w, E) === 'in:belt', 4 * HZ)).toBe(true);
    expect(w.undoStack().at(-1)!.entries.some((e) => e.target === E && e.field === 'location')).toBe(true);
    pull(w);
    t.run(1);
    expect(drawer(w)).toBe(2);
    w.dispose();
  }, 60_000);

  test('it asks for the camera: on its tray its crate\'s card, on the bench its own box; never on a pull; the flick sends the camera back', async () => {
    const { w, t } = await pressOut('rp-look');
    // a double-tap on the lever: its first tap pulls, its second tap's pull is dropped, and it asks to be looked at
    pull(w);
    t.run(2);
    pull(w);
    w.dispatch({ type: 'select', id: PRESS.lever });
    const ev = t.run(1);
    expect(ev.filter((e) => e.type === 'look').map((e) => (e as { target: string }).target)).toEqual([`${PRESS.crate}-card`]);
    expect(view(w).waiting).toBe(false);
    expect(until(w, t, () => t.events.some((x) => x.e.type === 'look.back'), 4 * HZ)).toBe(true);
    // (D2d) it gives back the look it asked for: its crate's card
    expect(t.of('look.back').map((x) => (x.e as { target: string }).target)).toEqual([`${PRESS.crate}-card`]);
    expect(t.of('press.printed')).toHaveLength(1);
    // no look on a pull
    const looks = t.of('look').length;
    t.run(8 * HZ);
    pull(w);
    t.run(5);
    expect(t.of('look').length).toBe(looks);
    // set down on the bench: it asks for its own box once it has come to rest
    putOn(w, t, P, [-4.0, 0, 0.6], 60);
    expect(until(w, t, () => t.events.some((x) => x.e.type === 'look' && (x.e as { target: string }).target === PRESS.look), 3 * HZ)).toBe(true);
    w.dispose();
  }, 60_000);

  test('the flick is a slow high lob: over a second in the air, its top well over the press', async () => {
    const { w, t } = await pressOut('rp-lob');
    pull(w);
    expect(until(w, t, () => t.events.some((x) => x.e.type === 'press.flicked'), 4 * HZ)).toBe(true);
    const f = t.of('press.flicked')[0]!.e;
    expect(f.flight).toBeGreaterThan(1.2);
    let top = -Infinity;
    for (let i = 0; i < 2 * HZ; i++) {
      t.run(1);
      top = Math.max(top, w.motion(E)?.pose.p[1] ?? -Infinity);
    }
    expect(top - f.from[1]).toBeGreaterThan(1.8);
    w.dispose();
  }, 60_000);

  test('the envelope set by hand on a stopped belt waits there, and ships when the belt runs', async () => {
    const { w, t } = await pressOut('rp-stopped');
    pull(w);
    expect(until(w, t, () => loc(w, E) === 'in:belt', 6 * HZ)).toBe(true);
    w.dispatch({ type: 'turn', id: 'belt-lever', value: 0.5 });
    t.run(2);
    expect(w.setting('belt', BELT_FIELDS.running)).toBe(false);
    putOn(w, t, E, onBelt(0.3), 60);
    expect(until(w, t, () => loc(w, E) === 'in:belt', 2 * HZ)).toBe(true);
    const x0 = w.motion(E)!.pose.p[0];
    t.run(4 * HZ);
    expect(loc(w, E)).toBe('in:belt');
    expect(Math.abs(w.motion(E)!.pose.p[0] - x0)).toBeLessThan(0.01);
    w.dispatch({ type: 'turn', id: 'belt-lever', value: 1 });
    t.run(1);
    expect(waitFor(w, t, E, 'shipped', 40 * HZ)).toBe(true);
    t.run(steps(DOCK_TUNING.returnAfter.tool) + 5);
    expect(loc(w, E)).toBe(`in:${P}`);
    w.dispose();
  }, 90_000);

  test('flicked behind two crates riding the belt, it rides behind them and ships after them', async () => {
    const { w, t } = await pressOut('rp-queue', { at: [5.6, 0, 1.4] });
    w.dispatch({ type: 'turn', id: 'belt-lever', value: 0.5 });
    t.run(2);
    putOn(w, t, 'crate-3', onBelt(0.45), 60);
    putOn(w, t, 'crate-4', onBelt(0.3), 60);
    w.dispatch({ type: 'turn', id: 'belt-lever', value: 1 });
    t.run(1);
    pull(w);
    expect(until(w, t, () => loc(w, E) === 'in:belt', 6 * HZ)).toBe(true);
    const ex = w.motion(E)!.pose.p[0];
    for (const c of ['crate-3', 'crate-4']) if (loc(w, c) === 'in:belt') expect(w.motion(c)!.pose.p[0]).toBeGreaterThan(ex);
    expect(waitFor(w, t, E, 'shipped', 60 * HZ)).toBe(true);
    const order = t.of('shipped').map((x) => x.e.part);
    expect(order.indexOf(E)).toBe(order.length - 1);
    expect(order).toContain('crate-3');
    expect(order).toContain('crate-4');
    w.dispose();
  }, 120_000);

  test('the flick lands it on the belt from wherever the press stands (the way clear)', async () => {
    const spots: [number, number, number][] = [[-1.4, 0, 0.9], [-4.0, 0, 1.6], [5.6, 0, 1.4], [0.4, 0, -1.8], [-8.2, 0, -0.2], [7.2, 0, 0.9]] /* (L2: -6.6, -0.8 is against the Button's console now) */;
    for (const at of spots) {
      const { w, t } = await pressOut(`rp-from-${at[0]}`, { at });
      expect(w.setting(PRESS.crate, OPEN), `${at}: open`).toBe(true);
      pull(w);
      expect(until(w, t, () => loc(w, E) === 'in:belt', 6 * HZ), `from ${at}: on the belt`).toBe(true);
      w.dispose();
    }
  }, 180_000);

  test('the lever takes a pull back exactly at every stage of the envelope\'s journey', async () => {
    let homeSeen = false;
    const stages: [string, (w: World) => boolean][] = [
      ['folding', () => true],
      ['flying', (w) => w.mode(E) === 'machine' && loc(w, E) === `in:${P}`],
      ['riding', (w) => loc(w, E) === 'in:belt'],
      ['at the dock', (w) => loc(w, E) === 'in:dock'],
      ['shipped', (w) => loc(w, E) === 'shipped'],
      ['home', (w) => homeSeen && loc(w, E) === `in:${P}`],
    ];
    for (const [name, ok] of stages) {
      homeSeen = false;
      const { w, t } = await pressOut(`rp-undo-${name}`);
      w.dispatch({ type: 'turn', id: 'belt-dial', value: 1 });
      t.run(2);
      const before = { report: report(w), drawer: drawer(w), seal: w.setting(E, SEAL_FIELD) };
      pull(w);
      t.run(5);
      const reached = until(w, t, () => {
        homeSeen ||= t.events.some((x) => x.e.type === 'press.home');
        return ok(w);
      }, 40 * HZ);
      expect(reached, `${name}: reached`).toBe(true);
      w.dispatch({ type: 'undo' });
      t.run(3);
      expect(report(w), name).toEqual(before.report);
      expect(drawer(w), name).toBe(before.drawer);
      expect(w.setting(E, SEAL_FIELD), name).toBe(before.seal);
      expect(loc(w, E), name).toBe(`in:${P}`);
      expect(w.mode(E), name).toBe('gone');
      // and it stays home: nothing in flight brings it out again, nothing ships it
      t.run(12 * HZ);
      expect(loc(w, E), `${name}: later`).toBe(`in:${P}`);
      expect(w.mode(E), `${name}: later`).toBe('gone');
      w.dispose();
    }
  }, 300_000);

  test('off the bench, the envelope comes back up the chute as every part does', async () => {
    const { w, t } = await pressOut('rp-fall');
    pull(w);
    expect(until(w, t, () => loc(w, E) === 'in:belt', 6 * HZ)).toBe(true);
    w.dispatch({ type: 'grab', id: E, grip: w.motion(E)!.pose.p });
    for (let i = 0; i < 40; i++) {
      w.dispatch({ type: 'carry', target: [-2 + i * 0.1, 1.5, 4.0 + i * 0.05] });
      t.run(1);
    }
    w.dispatch({ type: 'release', velocity: [0, 0, 8] });
    expect(until(w, t, () => t.events.some((x) => x.e.type === 'part.returned' && x.e.id === E), 20 * HZ)).toBe(true);
    expect(until(w, t, () => w.mode(E) === 'free' && loc(w, E) === 'rest', 10 * HZ)).toBe(true);
    w.dispose();
  }, 60_000);

  test('reduced motion: no travel; the sheets are printed, the drawer one thicker and the envelope set down on the belt at once', async () => {
    const { w, t } = await pressOut('rp-still');
    w.dispatch({ type: 'motion', reduced: true });
    t.run(2);
    pull(w);
    t.run(1);
    expect(drawer(w)).toBe(1);
    expect(view(w).show).toBeNull();
    expect(w.motion(E)!.pose.p[2]).toBeCloseTo(4.0, 1);
    expect(until(w, t, () => loc(w, E) === 'in:belt', 20)).toBe(true);
    w.dispose();
  }, 60_000);

  test('a visit remembers the holders and the drawer; "Reset the workshop" puts the press in its crate, its holders empty, its drawer empty', async () => {
    const { w, t } = await pressOut('rp-save');
    pull(w);
    expect(until(w, t, () => loc(w, E) === "in:belt", 8 * HZ)).toBe(true);
    pull(w);
    t.run(2);
    const s = w.saved();
    expect(s.kept).toEqual({ [`${P}.report`]: [], [`${P}.drawer`]: 2 });
    const back = parseSaved(JSON.stringify(s));
    expect(back?.kept).toEqual(s.kept);
    const bad = parseSaved(JSON.stringify({ ...s, kept: { [`${P}.drawer`]: -4, [`${P}.report`]: ['NOT A PAINT'] } }));
    w.dispatch({ type: 'reset' });
    t.run(3);
    expect(w.setting(PRESS.crate, OPEN)).toBe(false);
    expect(w.mode(P)).toBe('gone');
    expect(loc(w, P)).toBe(`in:${PRESS.crate}`);
    expect(report(w)).toBeNull();
    expect(drawer(w)).toBe(0);
    expect(loc(w, E)).toBe(`in:${P}`);
    expect(w.mode(E)).toBe('gone');
    expect(w.saved().kept).toBeUndefined();
    w.dispose();
    const w2 = await benchWorld('rp-save-2', { scene: BENCH, saved: back! });
    expect(w2.setting(P, DRAWER_FIELD)).toBe(2);
    expect(w2.setting(P, REPORT_FIELD)).toEqual([]);
    expect(w2.writer(P, DRAWER_FIELD)).toBe('settled');
    w2.dispose();
    // a hostile value is not written back: the field refuses it
    const w3 = await benchWorld('rp-save-3', { scene: BENCH, ...(bad ? { saved: bad } : {}) });
    expect(w3.setting(P, DRAWER_FIELD)).toBe(0);
    expect(w3.setting(P, REPORT_FIELD)).toBeNull();
    w3.dispose();
  }, 60_000);

  test('shipped itself, the press comes back up the chute with its holders and its drawer as they were; it prints again', async () => {
    const { w, t } = await pressOut('rp-ship-press');
    pull(w);
    t.run(PRESS_SHOW_STEPS);
    const was = { r: report(w), d: drawer(w) };
    putOn(w, t, P, onBelt(0.6), 60);
    expect(waitFor(w, t, P, 'shipped', 60 * HZ)).toBe(true);
    expect(until(w, t, () => w.mode(P) === 'free' && loc(w, P) === 'rest', 20 * HZ)).toBe(true);
    expect(report(w)).toEqual(was.r);
    expect(drawer(w)).toBe(was.d);
    pull(w);
    t.run(1);
    expect(drawer(w)).toBe(was.d + 1);
    // the record holds every shipment of a crate or a tool so far, the press's own included, in the colours they shipped in
    expect(report(w)).toEqual(t.of('shipped').filter((x) => x.e.part !== E).map(() => 'bare'));
    // (round three) never the envelope's own shipments: the report is about the visitor
    expect(t.of('shipped').some((x) => x.e.part === E)).toBe(true);
    w.dispose();
  }, 120_000);
});

describe('"Reset the workshop" stows the press and brings its envelope home from wherever they are (crates.ts: a reset stows every crate\'s thing)', () => {
  const settle = (w: World, t: Tape): void => {
    for (let i = 0; i < 15 * HZ; i++) {
      t.run(1);
      expect(w.mode(P), `step ${i} after the reset`).toBe('gone');
    }
    expect(w.part(P)!.location).toMatchObject({ at: 'in', mouth: PRESS.crate });
    expect(loc(w, E)).toBe(`in:${PRESS.body}`);
    expect(report(w)).toBeNull();
    expect(drawer(w)).toBe(0);
  };
  const throwOff = (w: World, t: Tape, id: string): void => {
    const m0 = w.motion(id)!;
    w.dispatch({ type: 'grab', id, grip: m0.pose.p });
    t.run(5);
    for (let k = 1; k <= 20; k++) {
      w.dispatch({ type: 'carry', target: [m0.pose.p[0] + 0.5 * k, 1.8, m0.pose.p[2] + 0.3 * k] });
      t.run(1);
    }
    w.dispatch({ type: 'release', velocity: [12, 3, 6] });
  };

  test('the press thrown off the bench from its tray before it ever rested (in the chute, its location still in its crate)', async () => {
    const { w, t } = await pressOut('rp-reset-chute');
    pull(w);
    t.run(PRESS_SHOW_STEPS + 10);
    throwOff(w, t, P);
    expect(until(w, t, () => w.mode(P) === 'chute', 10 * HZ)).toBe(true);
    w.dispatch({ type: 'reset' });
    settle(w, t);
    w.dispose();
  }, 120_000);

  test('the envelope in the air, then shipped and not yet home; the press out on the bench', async () => {
    const { w, t } = await pressOut('rp-reset-flight');
    putOn(w, t, P, [-4.0, 0, 0.6], 60);
    pull(w);
    expect(until(w, t, () => w.mode(E) === 'machine' && loc(w, E) !== `in:${PRESS.body}`, 6 * HZ)).toBe(true);
    w.dispatch({ type: 'reset' });
    settle(w, t);
    w.dispose();
  }, 120_000);

  test('the press untouched in its shut crate', async () => {
    const w = await benchWorld('rp-reset-untouched', { scene: BENCH });
    const t = tape(w);
    t.run(30);
    w.dispatch({ type: 'reset' });
    settle(w, t);
    w.dispose();
  }, 120_000);
});
