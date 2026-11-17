// Carry and throw feel under real Rapier: yaw held while carried, the throw cap, a cancelled pick-up.
import { describe, expect, test } from 'vitest';
import { line, rapierWorld, run, runUntil } from './helpers.ts';
import { LOOSE_TUNING } from '../../src/workshop/sim/world.ts';
import { yawOf } from '../../src/workshop/sim/math.ts';
import { steps } from '../../src/workshop/sim/clock.ts';
import type { Vec3 } from '../../src/workshop/sim/types.ts';
import type { World } from '../../src/workshop/sim/world.ts';

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const deg = (r: number): number => (r * 180) / Math.PI;

/** Pick crate-3 off the stack, carry it to `from`, and hold it there a moment. */
function carryTo(w: World, from: Vec3): void {
  const p = w.motion('crate-3')!.pose.p;
  w.dispatch({ type: 'grab', id: 'crate-3', grip: p });
  for (const t of [...line(p, [p[0], 2, p[2]], 20), ...line([p[0], 2, p[2]], from, 40), ...line(from, from, 30)]) {
    w.dispatch({ type: 'carry', target: t });
    w.advance();
    w.drainEvents();
  }
}

/** Throw from `from` along +X at `speed`; returns the travel to rest and the time it took. */
async function flick(speed: number, from: Vec3 = [-4, 1.2, -2]): Promise<{ travel: number; seconds: number; onBench: boolean }> {
  const w = await rapierWorld('flick');
  carryTo(w, from);
  const start = w.motion('crate-3')!.pose.p;
  w.dispatch({ type: 'release', velocity: [speed, 0.5, 0] });
  let returned = false;
  const { steps: n } = runUntil(
    w,
    (ev) => {
      if (ev.some((e) => e.type === 'part.returned' && e.id === 'crate-3')) returned = true;
      return ev.some((e) => e.type === 'part.rested' && e.id === 'crate-3');
    },
    steps(12),
  );
  const end = w.motion('crate-3')!.pose.p;
  return { travel: Math.hypot(end[0] - start[0], end[2] - start[2]), seconds: n / 60, onBench: !returned };
}

describe('carrying', () => {
  test('a carried crate keeps facing the way it was picked up (no slow spin)', async () => {
    const w = await rapierWorld(3);
    const p = w.motion('crate-3')!.pose.p;
    const yaw0 = yawOf(w.motion('crate-3')!.pose.q);
    w.dispatch({ type: 'grab', id: 'crate-3', grip: [p[0] + 0.2, p[1], p[2] + 0.2] }); // off-centre grip: a torque every turn
    let worst = 0;
    // a zig-zag, a loop and a long hold: 8 s
    const path: Vec3[] = [];
    for (let i = 0; i < 240; i++) path.push([-2.7 + 3 * Math.sin(i / 20), 1.8, 0.7 + 1.5 * Math.sin(i / 7)]);
    for (let i = 0; i < 240; i++) path.push([2 * Math.cos(i / 25), 1.6, 1 + 2 * Math.sin(i / 25)]);
    for (const t of path) {
      w.dispatch({ type: 'carry', target: t });
      w.advance();
      w.drainEvents();
      worst = Math.max(worst, Math.abs(wrap(yawOf(w.motion('crate-3')!.pose.q) - yaw0)));
    }
    const end = Math.abs(wrap(yawOf(w.motion('crate-3')!.pose.q) - yaw0));
    console.log(`carry yaw: worst ${deg(worst).toFixed(1)}°, after 8 s ${deg(end).toFixed(1)}°`);
    expect(deg(worst)).toBeLessThan(12);
    expect(deg(end)).toBeLessThan(2); // without the yaw hold this path leaves it ~5° off for good
  });
});

describe('throwing at the cap', () => {
  test(`throwMax is ${LOOSE_TUNING.throwMax}: a medium flick lands on the bench; a hard one from near the edge clears it`, async () => {
    const medium = await flick(4);
    const hard = await flick(LOOSE_TUNING.throwMax);
    const hardNearEdge = await flick(LOOSE_TUNING.throwMax, [6, 1.2, -2]);
    console.log(`medium flick (4 u/s): ${medium.travel.toFixed(2)} units, at rest after ${medium.seconds.toFixed(2)} s`);
    console.log(`hard flick (${LOOSE_TUNING.throwMax} u/s) from the middle: ${hard.travel.toFixed(2)} units, at rest after ${hard.seconds.toFixed(2)} s, on bench: ${hard.onBench}`);
    console.log(`hard flick from x=6: on bench: ${hardNearEdge.onBench}`);
    expect(medium.onBench).toBe(true);
    expect(medium.travel).toBeGreaterThan(1);
    expect(medium.travel).toBeLessThan(6);
    expect(medium.seconds).toBeLessThan(4);
    expect(hardNearEdge.onBench).toBe(false);
  });
});

describe('a cancelled pick-up (grab then let go at once, in place)', () => {
  test('puts the crate back exactly at its rest pose and commits nothing', async () => {
    const w = await rapierWorld(8);
    run(w, 5);
    const loc = w.part('crate-3')!.location;
    const writer = w.writer('crate-3', 'location');
    w.dispatch({ type: 'grab', id: 'crate-3', grip: w.motion('crate-3')!.pose.p });
    run(w, 8); // it has started to rise
    w.dispatch({ type: 'release', velocity: [0.1, 0, 0] });
    const ev = run(w, steps(3));
    expect(ev.filter((e) => e.type === 'effect')).toEqual([]);
    expect(ev.some((e) => e.type === 'part.rested')).toBe(false);
    expect(ev).toContainEqual({ type: 'part.released', id: 'crate-3', speed: 0 });
    expect(w.part('crate-3')!.location).toEqual(loc);
    expect(w.writer('crate-3', 'location')).toBe(writer);
    const p = w.motion('crate-3')!.pose.p;
    if (loc.at === 'rest') expect(Math.hypot(p[0] - loc.pose.p[0], p[1] - loc.pose.p[1], p[2] - loc.pose.p[2])).toBeLessThan(0.01);
  });

  test('a real move is not mistaken for one: held longer, it commits as usual', async () => {
    const w = await rapierWorld(8);
    w.dispatch({ type: 'grab', id: 'crate-3', grip: w.motion('crate-3')!.pose.p });
    run(w, 40);
    w.dispatch({ type: 'release', velocity: [0, 0, 0] });
    const ev = run(w, steps(4));
    expect(ev.some((e) => e.type === 'part.rested' && e.id === 'crate-3')).toBe(true);
  });
});
