// P4 S6: the opening stand, a prototype behind one switch (sim/machines/opening-stand.ts, the scene's `openingStand`). A
// project crate set down on it opens there and nowhere else; lifted off, it shuts; one at a time; the lever takes each
// back; a crate's thing stays on its tray (`things: 'fixed'`), or is loose as before (`loose`); with the switch off the
// bench is as it was.
import { describe, expect, test } from 'vitest';
import { benchWorld, tape, putOn, BENCH, type Tape } from './line-helpers.ts';
import { OPENING_STAND, STAND_STATION_SIZE, withOpeningStand, LEDGER, type StandPlace } from '../../src/workshop/sim/scenes/bench.ts';
import { OPEN } from '../../src/workshop/sim/machines/crates.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { Id, SimEvent, Vec3 } from '../../src/workshop/sim/types.ts';

const isOpen = (w: World, id: Id): boolean => w.setting(id, OPEN) === true;
/** The deck's top at a place (L2: the stand is the station's size wherever it stands). */
const top = (place: StandPlace): Vec3 => {
  const pl = OPENING_STAND.places[place];
  return [pl.at[0], pl.at[1] + STAND_STATION_SIZE.h, pl.at[2]];
};
/** The deck's half extents (x, z). */
const [DX, DZ] = STAND_STATION_SIZE.half;
const settle = (t: Tape, n = 120): SimEvent[] => t.run(n);
/** A crate lifted off a pile or wherever it is to a clear spot on the open bench (front left), and let go. */
const aside = (w: World, t: Tape, id: Id): void => putOn(w, t, id, [-5.6, 0, 1.6]);

describe.each(['centre'] as const)('the opening stand at %s', (place) => {
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

describe('the opening stand (at the centre)', () => {
  const scene = withOpeningStand(BENCH, 'centre');

  test('lifting the crate off shuts it; the page is told to look back when it leaves the hand off the stand; set down elsewhere it stays shut', async () => {
    const w = await benchWorld('st-lift', { scene });
    const t = tape(w);
    t.run(30);
    putOn(w, t, 'crate-3', top('centre'));
    settle(t);
    expect(isOpen(w, 'crate-3')).toBe(true);
    const p = w.motion('crate-3')!.pose.p;
    w.dispatch({ type: 'grab', id: 'crate-3', grip: p });
    const ev = t.run(3);
    // shut to the eye and the ear at once (written when it is let go: round two, so one pull of the lever undoes a lift-off)
    expect(ev).toContainEqual(expect.objectContaining({ type: 'crate.shut', crate: 'crate-3', why: 'grab' }));
    // (round four) the camera stays in while it is in the hand
    expect(ev).not.toContainEqual({ type: 'look.back', target: 'crate-3-card' });
    w.dispatch({ type: 'release', velocity: [0, 0, 0] });
    settle(t);
    const ev2: SimEvent[] = [];
    const m0 = w.motion('crate-3')!.pose.p;
    w.dispatch({ type: 'grab', id: 'crate-3', grip: m0 });
    for (let i = 0; i < 40; i++) {
      w.dispatch({ type: 'carry', target: [-5.6, 1.2, 1.6] });
      ev2.push(...t.run(1));
    }
    expect(ev2, 'none while carried off').not.toContainEqual({ type: 'look.back', target: 'crate-3-card' });
    w.dispatch({ type: 'release', velocity: [0, 0, 0] });
    ev2.push(...t.run(3));
    expect(ev2, 'at the letting-go off the stand').toContainEqual({ type: 'look.back', target: 'crate-3-card' });
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
    putOn(w, t, 'crate-3', top('centre'));
    settle(t);
    expect(isOpen(w, 'crate-3')).toBe(true);
    putOn(w, t, 'crate-4', top('centre'));
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
    putOn(w, t, 'fetch', top('centre'));
    const ev = settle(t);
    expect(ev.some((e) => e.type === 'crate.opened' || e.type === 'card')).toBe(false);
    w.dispose();
  }, 60_000);

  test('things fixed: the ledger board on its open crate\'s tray is not a hand\'s; its crank works; loose: it is taken as before', async () => {
    for (const things of ['fixed', 'loose'] as const) {
      const w = await benchWorld(`st-things-${things}`, { scene: withOpeningStand(BENCH, 'centre', things) });
      const t = tape(w);
      t.run(30);
      aside(w, t, 'crate-2'); // off the ledger's crate
      settle(t);
      putOn(w, t, 'crate-1', top('centre'));
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
    const w = await benchWorld('st-fetch', { scene: withOpeningStand(FULL, 'centre') });
    const t = tape(w);
    t.run(30);
    putOn(w, t, 'crate-4', top('centre'));
    settle(t);
    expect(isOpen(w, 'crate-4')).toBe(true);
    settle(t, 60 * 60);
    expect(isOpen(w, 'crate-4')).toBe(true);
    expect(w.machine(OPENING_STAND.unit)).toMatchObject({ crate: 'crate-4' });
    w.dispose();
  }, 180_000);

  /** (round two) Throws from 1.5 in front of the stand (L2: at the centre the UNDO lever stands to its left), toward the wall: [speed, vy, lands on it]. */
  const THROWS: readonly (readonly [number, number, boolean])[] = (process.env['THROWS'] ? process.env['THROWS'].split(';').map((x) => [...x.split(',').map(Number), true] as const) : [[2.5, 1, true], [3, 1, true], [3, 2, true], [4, 1, false], [1.5, 1, false]]) as never;
  /** Carried over the stand at an offset, `h` above the deck, hanging as it hangs in the hand, and let go. */
  const letGo = (w: World, t: Tape, id: Id, dx: number, dz: number, h: number): void => {
    const m = w.motion(id)!;
    const hh = w.halfExtents(id)![1];
    w.dispatch({ type: 'grab', id, grip: m.pose.p });
    const to: Vec3 = [top('centre')[0] + dx, top('centre')[1] + hh + h, top('centre')[2] + dz];
    for (let i = 0; i < 120; i++) {
      w.dispatch({ type: 'carry', target: [to[0], to[1] + (i < 90 ? 1.2 * (1 - i / 90) : 0), to[2]] });
      t.run(1);
    }
    t.run(30);
    w.dispatch({ type: 'release', velocity: [0, 0, 0] });
  };

  // (round two) the lead's failure: a crate let go over the stand that did not open. Let go off-centre (over the
  // deck's edge), from higher, or hanging crooked in the hand (crate-3 lands on its side), it is squared up in the
  // middle of the deck and opens there; the lever puts it back where it was, shut
  test.each(['crate-1', 'crate-2', 'crate-3'])('%s let go anywhere over the deck, square or crooked, opens on it; one pull of the lever undoes it', async (id) => {
    for (const [dx, dz, h] of [[0.3, 0, 0.12], [-0.3, -0.25, 0.12], [0.35, 0.3, 0.6], [0.45, 0.4, 0.3]] as const) {
      const w = await benchWorld(`st-catch-${id}-${dx}-${dz}`, { scene });
      const t = tape(w);
      t.run(30);
      if (id === 'crate-1') putOn(w, t, 'crate-2', [2.0, 0, 2.6]);
      t.run(60);
      const was = w.motion(id)!.pose.p;
      letGo(w, t, id, dx, dz, h);
      settle(t, 240);
      expect(isOpen(w, id), `${id} let go at ${dx}, ${dz}, ${h}`).toBe(true);
      expect(w.machine(OPENING_STAND.unit)).toMatchObject({ crate: id });
      w.dispatch({ type: 'undo' });
      settle(t, 90);
      expect(isOpen(w, id)).toBe(false);
      const now = w.motion(id)!.pose.p;
      expect(Math.hypot(now[0] - was[0], now[2] - was[2]), 'back where it was').toBeLessThan(0.08);
      w.dispose();
    }
  }, 300_000);

  // (round two) a trick shot: a crate thrown by the visitor that comes to rest on the stand opens there (it is set
  // down by their hand, at one remove); one that bounces off and rests elsewhere does not
  test('a crate thrown onto the stand opens when it comes to rest there; thrown past it, it stays shut', async () => {
    for (const [vx, vy, onIt] of THROWS) {
      const w = await benchWorld(`st-throw-${vx}`, { scene });
      const t = tape(w);
      t.run(30);
      const m = w.motion('crate-2')!;
      w.dispatch({ type: 'grab', id: 'crate-2', grip: m.pose.p });
      const from: Vec3 = [top('centre')[0], 1.4, top('centre')[2] + 1.5];
      for (let i = 0; i < 120; i++) {
        w.dispatch({ type: 'carry', target: from });
        t.run(1);
      }
      w.dispatch({ type: 'release', velocity: [0, vy, -vx] });
      settle(t, 300);
      const p = w.motion('crate-2')!.pose.p;
      const on = Math.abs(p[0] - top('centre')[0]) < DX && Math.abs(p[2] - top('centre')[2]) < DZ;
      if (process.env['THROWS']) console.log(vx, vy, p.map((x) => x.toFixed(2)).join(', '), isOpen(w, 'crate-2'));
      if (process.env['THROWS']) {
        w.dispose();
        continue;
      }
      expect(on, `thrown at ${vx}, ${vy}: rested at ${p.map((x) => x.toFixed(2)).join(', ')}`).toBe(onIt);
      expect(isOpen(w, 'crate-2')).toBe(onIt);
      w.dispose();
    }
  }, 120_000);

  // (round two, the layout builder's play runs) lifted off and set down elsewhere, then one pull of the lever: back on the
  // stand, open, looked at, as it was before the lift; a second pull takes back the setting-on (back where it started, shut)
  test('one pull of the lever after a lift-off puts the crate back on the stand open, with the look', async () => {
    const w = await benchWorld('st-undo-lift', { scene });
    const t = tape(w);
    t.run(30);
    const start = w.motion('crate-3')!.pose.p;
    putOn(w, t, 'crate-3', top('centre'));
    settle(t);
    expect(isOpen(w, 'crate-3')).toBe(true);
    const onStand = w.motion('crate-3')!.pose.p;
    aside(w, t, 'crate-3');
    settle(t);
    expect(isOpen(w, 'crate-3')).toBe(false);
    w.dispatch({ type: 'undo' });
    const ev = settle(t, 90);
    expect(isOpen(w, 'crate-3'), 'open again').toBe(true);
    const p = w.motion('crate-3')!.pose.p;
    expect(Math.hypot(p[0] - onStand[0], p[2] - onStand[2]), 'on the stand where it was').toBeLessThan(0.05);
    expect(ev).toContainEqual({ type: 'look', target: 'crate-3-card' });
    expect(w.machine(OPENING_STAND.unit)).toMatchObject({ crate: 'crate-3' });
    w.dispatch({ type: 'undo' });
    settle(t, 90);
    expect(isOpen(w, 'crate-3')).toBe(false);
    const q = w.motion('crate-3')!.pose.p;
    expect(Math.hypot(q[0] - start[0], q[2] - start[2]), 'back where it started').toBeLessThan(0.08);
    w.dispose();
  }, 60_000);

  // (round two) a project crate that comes to rest on the stand by no placing of the visitor's (here: it starts there, as
  // after a reset; on the bench, knocked off the platen or set there by Fetch) is set down beside it, shut: the deck
  // stays clear for the visitor's crate
  test('a crate on the stand by no placing of the visitor is set down beside it, shut', async () => {
    const crate3 = scene.parts.find((x) => x.id === 'crate-3')!;
    const onIt = { ...scene, parts: scene.parts.map((x) => (x.id === 'crate-3' ? { ...crate3, pose: { p: [top('centre')[0], top('centre')[1] + 0.35, top('centre')[2]] as Vec3, q: [0, 0, 0, 1] as const } } : x)) };
    const w = await benchWorld('st-clear', { scene: onIt as typeof scene });
    const t = tape(w);
    settle(t, 240);
    expect(isOpen(w, 'crate-3')).toBe(false);
    const p = w.motion('crate-3')!.pose.p;
    expect(Math.abs(p[0] - top('centre')[0]) > DX || Math.abs(p[2] - top('centre')[2]) > DZ, `beside it, at ${p.map((x) => x.toFixed(2)).join(', ')}`).toBe(true);
    w.dispose();
  }, 60_000);

  // (round two, the runs beside a second browser) the large crate let go turned forty-five degrees: its corners overhang
  // the deck; squared to the nearest quarter turn, it opens (as it lay, it was caught again and again and never opened)
  test('the large crate let go turned forty-five degrees opens, squared to the nearest quarter turn', async () => {
    const c1 = scene.parts.find((x) => x.id === 'crate-1')!;
    const s45 = Math.sin(Math.PI / 8), c45 = Math.cos(Math.PI / 8);
    const turned = { ...scene, parts: scene.parts.map((x) => (x.id === 'crate-2' ? { ...x, pose: { p: [2.0, 0.4, 2.7] as Vec3, q: [0, 0, 0, 1] as const } } : x.id === 'crate-1' ? { ...c1, pose: { p: c1.pose.p, q: [0, s45, 0, c45] as const } } : x)) };
    const w = await benchWorld('st-45', { scene: turned as typeof scene });
    const t = tape(w);
    settle(t, 60);
    letGo(w, t, 'crate-1', 0, 0, 0.12);
    settle(t, 300);
    expect(isOpen(w, 'crate-1')).toBe(true);
    w.dispose();
  }, 60_000);
});
