// R4 follow-up (S7's traffic scenario, seed 15): Fetch never holds a crate while unable to act for more than a few
// seconds. The cause there: R4's seat check ("never set a crate onto a seat something already stands on") looks 0.6
// round the seat, the stack's own count 0.55; a handled crate lying 0.59 from the stack's middle was not on the stack
// but blocked its seat, and Fetch, restocking the stack from the pad, stood at the stack with the crate for good,
// re-planning every step. Now where it is going is taken or shut, it chooses again: the belt if the stack's seat is
// taken, the stack if the belt's feed is shut (and the stack has room), and if neither, after `holdIdleMax` it sets the
// crate down beside itself on its tape's side, the crew's (untouched, still fresh), and goes back to waiting.
import { describe, expect, test } from 'vitest';
import { AT, benchWorld, FULL_BENCH, onBelt, putOn, tape, type Tape } from './line-helpers.ts';
import { startPlay } from './fetch-helpers.ts';
import { HZ, steps } from '../../src/workshop/sim/clock.ts';
import { FETCH_TUNING } from '../../src/workshop/sim/crew/fetch.ts';
import { BELT_FIELDS } from '../../src/workshop/sim/machines/belt.ts';
import type { World } from '../../src/workshop/sim/world.ts';

/** Run `n` steps; the longest Fetch stood (idle or at a seat it could not use) with one crate in its hands, in seconds. */
function runWatching(w: World, t: Tape, n: number, until?: () => boolean): number {
  let run = 0;
  let worst = 0;
  for (let i = 0; i < n; i++) {
    t.run(1);
    const f = w.crew('fetch')!;
    run = f.carrying && (f.state === 'idle' || f.state === 'place') ? run + 1 : 0;
    worst = Math.max(worst, run / HZ);
    if (until?.()) break;
  }
  return worst;
}

describe('Fetch never holds a crate while unable to act', () => {
  test('restocking the stack from the pad, the stack\'s seat taken by a handled crate beside it (seed 15): it takes the crate to the belt instead', async () => {
    const w = await benchWorld('r4-hold-stack', { scene: FULL_BENCH });
    const t = tape(w);
    t.run(steps(1));
    startPlay(w);
    // the visitor empties the stack: the large crate far away, the middle one just beside the stack (0.58 from its middle)
    putOn(w, t, 'crate-1', [-6, 0, -2]);
    t.run(steps(1));
    putOn(w, t, 'crate-2', [AT.stack[0] + 0.58, 0, AT.stack[1]]);
    t.run(steps(1));
    // a crate shipped: its replacement comes up the chute onto the pad, and Fetch takes it for the stack
    putOn(w, t, 'crate-3', onBelt(0.3));
    let fed = false;
    const worst = runWatching(w, t, steps(60), () => {
      fed = t.events.some((x) => x.e.type === 'taken-in' && x.e.id === 'belt' && x.e.part !== 'crate-3' && x.step > 0);
      return fed;
    });
    expect(fed, 'the pad\'s crate goes to the belt').toBe(true);
    expect(worst).toBeLessThan(FETCH_TUNING.holdIdleMax + 0.5);
    w.dispose();
  }, 120_000);

  /** Fetch on its rounds takes a crate for the belt; returns once it has it in hand. */
  async function carryingFromStack(seed: string): Promise<{ w: World; t: Tape; crate: string }> {
    const w = await benchWorld(seed, { scene: FULL_BENCH });
    const t = tape(w);
    t.run(steps(1));
    startPlay(w);
    // the crate attract mode had in its hands goes to the belt first; it ships, and Fetch takes its replacement off the pad for the belt
    for (let i = 0; i < steps(30) && w.crew('fetch')!.carrying; i++) t.run(1);
    for (let i = 0; i < steps(40) && !w.crew('fetch')!.carrying; i++) t.run(1);
    const crate = w.crew('fetch')!.carrying;
    expect(crate, 'it takes a crate for the belt').toBeTruthy();
    return { w, t, crate: crate! };
  }

  test('carrying to the belt, the belt switched off (and a crate taken off the stack): it puts its crate on the stack', async () => {
    const { w, t, crate } = await carryingFromStack('r4-hold-belt');
    w.commit([{ target: 'belt', field: BELT_FIELDS.running, after: false }], 'system');
    putOn(w, t, 'crate-2', [-6, 0, -2]);
    const worst = runWatching(w, t, steps(20), () => !w.crew('fetch')!.carrying);
    t.run(steps(2));
    const p = w.motion(crate)!.pose.p;
    expect(w.crew('fetch')!.carrying).toBeNull();
    expect(Math.hypot(p[0] - AT.stack[0], p[2] - AT.stack[1]), 'back on the stack').toBeLessThan(0.55);
    expect(worst).toBeLessThan(FETCH_TUNING.holdIdleMax + 0.5);
    w.dispose();
  }, 120_000);

  test('the belt switched off and the stack\'s seat taken: it sets the crate down beside itself, untouched, and goes back to waiting', async () => {
    const { w, t, crate } = await carryingFromStack('r4-hold-neither');
    w.commit([{ target: 'belt', field: BELT_FIELDS.running, after: false }], 'system');
    putOn(w, t, 'crate-2', [AT.stack[0] + 0.58, 0, AT.stack[1]]); // off the stack, and beside it: the seat taken
    const worst = runWatching(w, t, steps(25), () => !w.crew('fetch')!.carrying);
    t.run(steps(2));
    expect(w.crew('fetch')!.carrying, 'set down').toBeNull();
    expect(w.mode(crate)).toBe('free');
    expect(w.touched(crate), 'still fresh').toBe(false);
    expect(w.motion(crate)!.pose.p[1], 'on the bench').toBeLessThan(0.6);
    expect(worst).toBeLessThan(FETCH_TUNING.holdIdleMax + 0.5);
    w.dispose();
  }, 120_000);
});
