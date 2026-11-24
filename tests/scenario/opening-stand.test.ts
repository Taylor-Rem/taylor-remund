// P4 S6: the opening stand, a prototype behind one switch (sim/machines/opening-stand.ts, the scene's `openingStand`). A
// project crate set down on it opens there and nowhere else; lifted off, it shuts; one at a time; the lever takes each
// back; a crate's thing stays on its tray (`things: 'fixed'`), or is loose as before (`loose`); with the switch off the
// bench is as it was.
import { describe, expect, test } from 'vitest';
import { benchWorld, tape, putOn, BENCH, type Tape } from './line-helpers.ts';
import { OPENING_STAND, withOpeningStand, LEDGER, type StandPlace } from '../../src/workshop/sim/scenes/bench.ts';
import { OPEN } from '../../src/workshop/sim/machines/crates.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { Id, SimEvent, Vec3 } from '../../src/workshop/sim/types.ts';

const isOpen = (w: World, id: Id): boolean => w.setting(id, OPEN) === true;
const top = (place: StandPlace): Vec3 => {
  const pl = OPENING_STAND.places[place];
  return [pl.at[0], pl.at[1] + pl.h, pl.at[2]];
};
const settle = (t: Tape, n = 120): SimEvent[] => t.run(n);
/** A crate lifted off a pile or wherever it is to a clear spot on the open bench (front left), and let go. */
const aside = (w: World, t: Tape, id: Id): void => putOn(w, t, id, [-5.6, 0, 1.6]);

describe.each(['a', 'b', 'c'] as const)('the opening stand at %s', (place) => {
  test('a crate set down on it opens, under the placing (the lever puts it back where it was, shut); the page is asked to look', async () => {
    const w = await benchWorld(`st-open-${place}`, { scene: withOpeningStand(BENCH, place) });
    const t = tape(w);
    t.run(30);
    const was = w.motion('crate-3')!.pose.p;
    putOn(w, t, 'crate-3', top(place));
    const ev = settle(t);
    expect(isOpen(w, 'crate-3')).toBe(true);
    expect(ev).toContainEqual({ type: 'crate.opened', id: OPENING_STAND.unit, crate: 'crate-3', project: 't-components' });
    expect(ev).toContainEqual({ type: 'look', target: 'crate-3-card' });
    expect(w.machine(OPENING_STAND.unit)).toMatchObject({ kind: 'opening-stand', crate: 'crate-3' });
    w.dispatch({ type: 'undo' });
    settle(t, 60);
    expect(isOpen(w, 'crate-3')).toBe(false);
    const now = w.motion('crate-3')!.pose.p;
    expect(Math.hypot(now[0] - was[0], now[2] - was[2])).toBeLessThan(0.05);
    w.dispose();
  }, 60_000);
});

describe('the opening stand (at c)', () => {
  const scene = withOpeningStand(BENCH, 'c');

  test('lifting the crate off shuts it (the page is told to look back); set down elsewhere it stays shut', async () => {
    const w = await benchWorld('st-lift', { scene });
    const t = tape(w);
    t.run(30);
    putOn(w, t, 'crate-3', top('c'));
    settle(t);
    expect(isOpen(w, 'crate-3')).toBe(true);
    const p = w.motion('crate-3')!.pose.p;
    w.dispatch({ type: 'grab', id: 'crate-3', grip: p });
    const ev = t.run(3);
    expect(isOpen(w, 'crate-3')).toBe(false);
    expect(ev).toContainEqual(expect.objectContaining({ type: 'crate.shut', crate: 'crate-3', why: 'grab' }));
    expect(ev).toContainEqual({ type: 'look.back', target: 'crate-3-card' });
    w.dispatch({ type: 'release', velocity: [0, 0, 0] });
    settle(t);
    aside(w, t, 'crate-3');
    settle(t);
    expect(isOpen(w, 'crate-3')).toBe(false);
    w.dispose();
  }, 60_000);

  test('nowhere else: no latch, no double-click opens a crate; a double-click asks for nothing (the station is framed)', async () => {
    const w = await benchWorld('st-nowhere', { scene });
    const t = tape(w);
    t.run(30);
    w.dispatch({ type: 'press', id: 'crate-3-lid' });
    w.dispatch({ type: 'select', id: 'crate-3' });
    const ev = settle(t, 90);
    expect(isOpen(w, 'crate-3')).toBe(false);
    expect(ev.some((e) => e.type === 'look' || e.type === 'crate.opened')).toBe(false);
    w.dispose();
  }, 60_000);

  test('caught and thrown and caught again, twenty times, fast: never opened, nothing asked to be looked at', async () => {
    const w = await benchWorld('st-juggle', { scene });
    const t = tape(w);
    t.run(30);
    const all: SimEvent[] = [];
    for (let i = 0; i < 20; i++) {
      const p = w.motion('crate-3')!.pose.p;
      w.dispatch({ type: 'grab', id: 'crate-3', grip: p });
      all.push(...t.run(4));
      w.dispatch({ type: 'select', id: 'crate-3' });
      w.dispatch({ type: 'release', velocity: [i % 2 ? 2.5 : -2.5, 2.2, 0.4] });
      all.push(...t.run(10 + (i % 3) * 5));
    }
    all.push(...settle(t, 180));
    expect(all.some((e) => e.type === 'crate.opened' || e.type === 'look')).toBe(false);
    expect(isOpen(w, 'crate-3')).toBe(false);
    w.dispose();
  }, 120_000);

  test('one at a time: a second crate set down hands the first off to the side, shut, and opens; the lever brings the first back, open', async () => {
    const w = await benchWorld('st-two', { scene });
    const t = tape(w);
    t.run(30);
    putOn(w, t, 'crate-3', top('c'));
    settle(t);
    expect(isOpen(w, 'crate-3')).toBe(true);
    putOn(w, t, 'crate-4', top('c'));
    settle(t, 180);
    expect(isOpen(w, 'crate-4')).toBe(true);
    expect(isOpen(w, 'crate-3')).toBe(false);
    expect(w.machine(OPENING_STAND.unit)).toMatchObject({ crate: 'crate-4' });
    expect(w.mode('crate-3')).toBe('free');
    w.dispatch({ type: 'undo' });
    settle(t, 120);
    expect(isOpen(w, 'crate-4')).toBe(false);
    expect(isOpen(w, 'crate-3')).toBe(true);
    expect(w.machine(OPENING_STAND.unit)).toMatchObject({ crate: 'crate-3' });
    w.dispose();
  }, 90_000);

  test('a part that is not a project crate set there just rests', async () => {
    const w = await benchWorld('st-other', { scene });
    const t = tape(w);
    t.run(30);
    const before = w.drainEvents().length;
    void before;
    putOn(w, t, 'fetch', top('c'));
    const ev = settle(t);
    expect(ev.some((e) => e.type === 'crate.opened' || e.type === 'card')).toBe(false);
    w.dispose();
  }, 60_000);

  test('things fixed: the ledger board on its open crate\'s tray is not a hand\'s; its crank works; loose: it is taken as before', async () => {
    for (const things of ['fixed', 'loose'] as const) {
      const w = await benchWorld(`st-things-${things}`, { scene: withOpeningStand(BENCH, 'c', things) });
      const t = tape(w);
      t.run(30);
      aside(w, t, 'crate-2'); // off the ledger's crate
      settle(t);
      putOn(w, t, 'crate-1', top('c'));
      settle(t, 600);
      expect(isOpen(w, 'crate-1')).toBe(true);
      expect(w.mode(LEDGER.board)).toBe('machine');
      const bp = w.motion(LEDGER.board)!.pose.p;
      w.dispatch({ type: 'grab', id: LEDGER.board, grip: bp });
      t.run(3);
      if (things === 'fixed') {
        expect(w.mode(LEDGER.board)).toBe('machine');
        expect(w.holding()).toBeNull();
        w.dispatch({ type: 'press', id: LEDGER.crank });
        const ev = settle(t, 30);
        expect(ev.some((e) => e.type.startsWith('ledger.'))).toBe(true);
      } else {
        expect(w.mode(LEDGER.board)).toBe('held');
        w.dispatch({ type: 'release', velocity: [0, 0, 0] });
      }
      w.dispose();
    }
  }, 180_000);

  test('Fetch does not take a crate the visitor set on the stand (its rounds run a minute beside it)', async () => {
    const { bench: FULL } = await import('../../src/workshop/sim/scenes/bench.ts');
    const w = await benchWorld('st-fetch', { scene: withOpeningStand(FULL, 'c') });
    const t = tape(w);
    t.run(30);
    putOn(w, t, 'crate-4', top('c'));
    settle(t);
    expect(isOpen(w, 'crate-4')).toBe(true);
    settle(t, 60 * 60);
    expect(isOpen(w, 'crate-4')).toBe(true);
    expect(w.machine(OPENING_STAND.unit)).toMatchObject({ crate: 'crate-4' });
    w.dispose();
  }, 180_000);
});
