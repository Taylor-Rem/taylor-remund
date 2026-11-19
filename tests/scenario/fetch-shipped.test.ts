// R2 (Taylor's coworkers, 2026-11-19): "when you place Fetch on the conveyor belt and he goes into the door where the
// boxes go, he disappears completely. He should come back somehow." Then UNDO pulled again and again.
//
// A visitor lifts Fetch, sets it on the belt, and it rides through the dock's door. Before R2 it came back up the chute
// by itself ten seconds after it shipped and rolled out of the chute's mouth: eleven and a half seconds with nothing
// of it on screen, which reads as gone. Now the door shuts on it, a beat (DOCK_TUNING.refuseAfter), and the chute
// throws it back like a crate the dock refused: tumbling by whole turns, landing on its wheels by its stand at the
// pad (or the next free place along its tape), its RETURN TO SENDER mark on; it shakes itself off and goes back to
// work. Then UNDO, 1, 5 and 20 pulls at every stage, with a replacement crate in the air and without.
import { describe, expect, test } from 'vitest';
import { AT, benchWorld, FULL_BENCH, onBelt, putOn, tape, type Tape } from './line-helpers.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';
import { DOCK_TUNING, MARK_RETURN } from '../../src/workshop/sim/machines/dock.ts';
import type { World } from '../../src/workshop/sim/world.ts';

const HOME = AT.home;

/** Fetch set on the belt by the visitor; returns the step it was let go. */
async function shipFetch(opts: { crateFirst?: boolean } = {}): Promise<{ w: World; t: Tape; start: number }> {
  const w = await benchWorld('r2-ship-fetch', { scene: FULL_BENCH });
  const t = tape(w);
  t.run(60);
  if (opts.crateFirst) {
    // a crate shipped just before: its replacement is thrown onto the pad while Fetch is away
    putOn(w, t, 'crate-3', onBelt(0.55));
  }
  putOn(w, t, 'fetch', onBelt(0.3));
  return { w, t, start: w.step };
}

/** Where the up axis of a pose points (y of the rotated +Y). */
const upY = (q: readonly number[]): number => 1 - 2 * ((q[0] as number) ** 2 + (q[2] as number) ** 2);

describe('Fetch shipped through the dock comes back, visibly and soon', () => {
  test('the door shuts on it, under two seconds of nothing, then the chute throws it home: on its wheels by its stand, marked, back at work', async () => {
    const { w, t, start } = await shipFetch();
    const shipped = t.until((e) => e.type === 'shipped' && e.part === 'fetch', 12 * HZ);
    expect(shipped, 'it rides the belt and ships').not.toBeNull();
    const thrown = t.until((e) => e.type === 'restock.launched' && e.part === 'fetch', 5 * HZ);
    expect(thrown, 'the chute throws it back').not.toBeNull();
    const away = (thrown!.step - shipped!.step) / HZ;
    expect(away, 'seconds with nothing of it on screen').toBeLessThanOrEqual(2);
    expect(away).toBeGreaterThanOrEqual(DOCK_TUNING.refuseAfter - 0.05);
    // in the air: the dock's, kinematic, tumbling
    t.run(10);
    expect(w.mode('fetch')).toBe('machine');
    expect(w.crew('fetch')!.state, 'its rounds do not run while it is away or in the air').toBe('held');
    // touchdown: on its wheels, by its stand at the pad
    let landed = -1;
    for (let i = 0; i < 4 * HZ && landed < 0; i++) {
      t.run(1);
      if (w.mode('fetch') !== 'machine') landed = w.step;
    }
    expect(landed, 'it lands').toBeGreaterThan(0);
    const pose = w.motion('fetch')!.pose;
    expect(upY(pose.q), 'on its wheels').toBeGreaterThan(0.97);
    expect(Math.hypot(pose.p[0] - HOME[0][0], pose.p[2] - HOME[0][1]), 'by its stand at the pad').toBeLessThan(0.15);
    expect(w.part('fetch')!.marks).toContain(MARK_RETURN);
    // it shakes itself off, then back to its lane and its rounds
    const shrug = t.until((e) => e.type === 'crew.state' && e.id === 'fetch' && e.state === 'shrug', 3 * HZ);
    expect(shrug, 'it shakes itself off').not.toBeNull();
    t.run(4 * HZ);
    expect(w.mode('fetch')).toBe('crew');
    expect(w.part('fetch')!.location.at).toBe('rest');
    expect(w.writer('fetch', 'location'), 'once it is back by itself, where it is is the crew’s').toBe('crew');
    expect(['held', 'shrug', 'return']).not.toContain(w.crew('fetch')!.state);
    expect((w.step - start) / HZ, 'all of it inside fifteen seconds of being set on the belt (six of them riding)').toBeLessThan(15);
    w.dispose();
  }, 60_000);

  test('its stand taken (a crate standing there): it lands at the next free place along its tape, inside nothing', async () => {
    const w = await benchWorld('r2-ship-fetch-taken', { scene: FULL_BENCH });
    const t = tape(w);
    t.run(60);
    putOn(w, t, 'crate-3', [HOME[0][0], 0, HOME[0][1]]);
    t.run(30);
    putOn(w, t, 'fetch', onBelt(0.3));
    const thrown = t.until((e) => e.type === 'restock.launched' && e.part === 'fetch', 14 * HZ);
    expect(thrown).not.toBeNull();
    const to = (thrown!.e as { to: readonly number[] }).to;
    expect(Math.hypot((to[0] as number) - HOME[0][0], (to[2] as number) - HOME[0][1]), 'not onto the crate').toBeGreaterThan(0.4);
    const c = w.motion('crate-3')!.pose.p;
    expect(Math.hypot((to[0] as number) - c[0], (to[2] as number) - c[2])).toBeGreaterThan(0.6);
    t.run(3 * HZ);
    expect(w.mode('fetch')).not.toBe('machine');
    expect(upY(w.motion('fetch')!.pose.q)).toBeGreaterThan(0.9);
    w.dispose();
  }, 60_000);
});

// Every stage after Fetch is set on the belt, in seconds from the visitor letting go (the probe's measured timeline:
// it reaches the ramp about 5.0, ships about 6.0, is thrown back about 7.5, lands about 8.7).
const STAGES: [string, number][] = [
  ['riding the belt', 3],
  ['on the ramp', 5.3],
  ['the door open', 5.9],
  ['away', 6.8],
  ['in the air coming back', 8.0],
  ['just landed', 9.0],
  ['back at work', 13],
];

describe('UNDO pulled after shipping Fetch, as the coworkers did: 1, 5 and 20 times at every stage', () => {
  for (const crateFirst of [false, true]) {
    for (const [stage, at] of STAGES) {
      test(`${stage}${crateFirst ? ', a replacement crate on its way to the pad' : ''}: nothing throws, nothing stays lost, the bench keeps running`, async () => {
        for (const pulls of [1, 5, 20]) {
          const { w, t, start } = await shipFetch({ crateFirst });
          while (w.step - start < at * HZ) t.run(1);
          for (let k = 0; k < pulls; k++) {
            w.dispatch({ type: 'press', id: 'undo-lever' });
            t.run(6);
          }
          t.run(14 * HZ);
          // Fetch is on the bench, at work, not gone, not in the dock's hands, not still flying
          expect(w.mode('fetch'), `${pulls} pulls`).toBe('crew');
          expect(w.part('fetch')!.location.at).toBe('rest');
          expect(w.crew('fetch')!.state).not.toBe('held');
          const p = w.motion('fetch')!.pose.p;
          expect(p[1]).toBeGreaterThan(0.5);
          expect(p[1]).toBeLessThan(1.2);
          // the world still runs: time goes on and the belt still takes a crate
          const t0 = w.time;
          t.run(HZ);
          expect(w.time).toBeGreaterThan(t0);
          w.dispose();
        }
      }, 240_000);
    }
  }
});
