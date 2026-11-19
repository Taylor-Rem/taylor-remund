// R4 (Taylor: "so you can throw boxes and Fetch and Patch and stuff. They should still always be able to recover"):
// Fetch thrown flies and tumbles under physics like any part, then recovers by itself wherever it ends: on the
// bench (it rights itself, shakes itself off, goes back to its tape), up on something (the stack, a crate: it hops
// down on its jets to the nearest free point of its tape), on the belt (stood on its wheels before the belt takes
// it), off the bench (the jetpack, unchanged). The whole-bench proof is tests/scenario/throw-soak.test.ts.
import { describe, expect, test } from 'vitest';
import { AT, benchWorld, FULL_BENCH, LINE, onBelt, tape, type Tape } from './line-helpers.ts';
import { HZ, steps } from '../../src/workshop/sim/clock.ts';
import { LOOSE_TUNING } from '../../src/workshop/sim/world.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { Vec3 } from '../../src/workshop/sim/types.ts';

const upY = (q: readonly number[]): number => 1 - 2 * ((q[0] as number) ** 2 + (q[2] as number) ** 2);

/** The visitor lifts Fetch, carries it to `from` and lets go with the hand moving at `v`. */
function throwFetch(w: World, t: Tape, from: Vec3, v: Vec3): void {
  w.dispatch({ type: 'grab', id: 'fetch', grip: w.motion('fetch')!.pose.p });
  t.run(1);
  expect(w.holding()?.id).toBe('fetch');
  for (let i = 0; i < 60; i++) {
    w.dispatch({ type: 'carry', target: from });
    t.run(1);
  }
  w.dispatch({ type: 'release', velocity: v });
}

/** Back at work: on its wheels, in the crew's hands, not held, not flying. */
function backAtWork(w: World): boolean {
  const m = w.motion('fetch')!;
  const st = w.crew('fetch')!.state;
  return m.mode === 'crew' && upY(m.pose.q) > 0.97 && st !== 'held' && st !== 'jetpack';
}

describe('Fetch thrown', () => {
  test('across the bench, hard: it flies, tumbles, and within seconds is on its wheels, shaking itself off, then back to its tape', async () => {
    const w = await benchWorld('r4-fetch-across', { scene: FULL_BENCH });
    const t = tape(w);
    t.run(steps(1));
    throwFetch(w, t, [-5, 1.6, 0.5], [12, 1.5, 0.5]);
    let maxSpeed = 0;
    let spin = 0;
    let prev = w.motion('fetch')!.pose;
    let shook = false;
    let back = -1;
    for (let i = 0; i < 10 * HZ && back < 0; i++) {
      for (const e of t.run(1)) if (e.type === 'crew.state' && e.id === 'fetch' && e.state === 'shrug') shook = true;
      const m = w.motion('fetch')!.pose;
      maxSpeed = Math.max(maxSpeed, Math.hypot(m.p[0] - prev.p[0], m.p[2] - prev.p[2]) * HZ);
      spin = Math.max(spin, 1 - upY(m.q));
      prev = m;
      if (shook && backAtWork(w) && w.crew('fetch')!.state !== 'shrug') back = i / HZ;
    }
    expect(maxSpeed, 'it keeps its momentum (about the cap for its mass)').toBeGreaterThan(8);
    expect(spin, 'it tumbles').toBeGreaterThan(0.05);
    expect(shook, 'it shakes itself off').toBe(true);
    expect(back, 'back at work within ten seconds').toBeGreaterThan(0);
    w.dispose();
  }, 60_000);

  test('the world clamps a throw by mass: a small crate leaves at the whole cap, Fetch slower', async () => {
    const w = await benchWorld('r4-cap', { scene: FULL_BENCH });
    const t = tape(w);
    t.run(steps(1));
    const speedAfter = (id: string): number => {
      w.dispatch({ type: 'grab', id, grip: w.motion(id)!.pose.p });
      t.run(1);
      for (let i = 0; i < 40; i++) {
        w.dispatch({ type: 'carry', target: [-6, 2.5, -1] });
        t.run(1);
      }
      w.dispatch({ type: 'release', velocity: [40, 0, 0] });
      t.run(2);
      const m = w.motion(id)!;
      return Math.hypot(m.pose.p[0] - m.prev.p[0], m.pose.p[2] - m.prev.p[2]) * HZ;
    };
    const crate = speedAfter('crate-3');
    t.run(steps(4));
    const fetch = speedAfter('fetch');
    expect(crate).toBeGreaterThan(LOOSE_TUNING.throwMax * 0.9);
    expect(crate).toBeLessThan(LOOSE_TUNING.throwMax * 1.02);
    expect(fetch).toBeLessThan(crate * 0.8);
    expect(fetch).toBeGreaterThan(8);
    w.dispose();
  }, 60_000);

  test('set down on top of the crate stack: it cannot stand there, so it hops down on its jets to its tape', async () => {
    const w = await benchWorld('r4-fetch-stack', { scene: FULL_BENCH });
    const t = tape(w);
    t.run(steps(1));
    throwFetch(w, t, [AT.stack[0], 2.6, AT.stack[1]], [0, 0, 0]);
    let hopped = false;
    let back = -1;
    for (let i = 0; i < 12 * HZ && back < 0; i++) {
      t.run(1);
      if (w.crew('fetch')!.state === 'jetpack') hopped = true;
      if (hopped && backAtWork(w)) back = i;
    }
    expect(hopped, 'it hops down').toBe(true);
    expect(back).toBeGreaterThan(0);
    const p = w.motion('fetch')!.pose.p;
    expect(p[1], 'on the bench top, not on the stack').toBeLessThan(0.8);
    w.dispose();
  }, 60_000);

  test('thrown onto the running belt it rides on its wheels (stood up before the belt takes it)', async () => {
    const w = await benchWorld('r4-fetch-belt', { scene: FULL_BENCH });
    const t = tape(w);
    t.run(steps(1));
    const b = onBelt(0.25);
    throwFetch(w, t, [b[0] - 1.5, 1.8, LINE.belt.z], [4, 0.5, 0]);
    const taken = t.until((e) => e.type === 'taken-in' && e.part === 'fetch', 6 * HZ);
    expect(taken, 'the belt takes it').not.toBeNull();
    expect(upY(w.motion('fetch')!.pose.q), 'upright as it rides').toBeGreaterThan(0.99);
    w.dispose();
  }, 60_000);
});
