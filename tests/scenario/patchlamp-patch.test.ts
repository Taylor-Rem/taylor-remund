// Patch, the operator (REWRITE.md § B5 as amended 2026-11-18; S3): the job in stages, lifted off the
// stool, and a part thrown at it (duck, catch, bonk). Patch is never moved by physics and never hurt;
// a reaction lasts at most 1.5 s. On the whole bench under real Rapier.
import { describe, expect, test } from 'vitest';
import { benchWorld, tape } from './line-helpers.ts';
import type { Tape } from './line-helpers.ts';
import { PATCHLAMP, answer, patchView, send, shopView, untilPatch } from './patchlamp-helpers.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { Id, PatchState, Vec3 } from '../../src/workshop/sim/types.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';
import { PATCH_TUNING } from '../../src/workshop/sim/crew/patch.ts';

const SEAT = PATCHLAMP.patch.seat;
const states = (t: Tape): PatchState[] => t.of('crew.state').filter((x) => x.e.id === 'patch').map((x) => x.e.state as PatchState);

/** Pick `id` up and hold it still at `at` (carried up, across and down over `n` steps). */
function holdAt(w: World, t: Tape, id: Id, at: Vec3, n = 150): void {
  const p = w.motion(id)!.pose.p;
  w.dispatch({ type: 'grab', id, grip: p });
  t.run(1);
  const high = 3.5;
  const legs: [Vec3, Vec3, number][] = [
    [p, [p[0], high, p[2]], 20],
    [[p[0], high, p[2]], [at[0], high, at[2]], n],
    [[at[0], high, at[2]], at, 20],
  ];
  for (const [a, b, k] of legs)
    for (let i = 1; i <= k; i++) {
      w.dispatch({ type: 'carry', target: [a[0] + ((b[0] - a[0]) * i) / k, a[1] + ((b[1] - a[1]) * i) / k, a[2] + ((b[2] - a[2]) * i) / k] });
      t.run(1);
    }
  t.run(45);
}

/** Let go of the held part so that it flies to `target` in `tau` seconds (gravity included). */
function throwAt(w: World, t: Tape, id: Id, target: Vec3, tau: number): void {
  const p = w.motion(id)!.pose.p;
  const g = w.scene.gravity;
  const v: Vec3 = [(target[0] - p[0]) / tau, (target[1] - p[1]) / tau - 0.5 * g * tau, (target[2] - p[2]) / tau];
  w.dispatch({ type: 'release', velocity: v });
  t.run(1);
}

const FRONT: Vec3 = [SEAT[0], 2.0, SEAT[2] + 2.0];

describe('Patch: a part thrown at it gets one of three answers, by where the part is going', () => {
  test('at its head: it ducks, and the part flies on', async () => {
    const w = await benchWorld();
    const t = tape(w);
    holdAt(w, t, 'crate-3', FRONT);
    throwAt(w, t, 'crate-3', [SEAT[0], SEAT[1] + 1.5, SEAT[2]], 0.4);
    const r = t.until((e) => e.type === 'patch.reacted', HZ);
    expect(r?.e).toEqual({ type: 'patch.reacted', part: 'crate-3', answer: 'duck' });
    expect(patchView(w).state).toBe('duck');
    t.run(Math.round(1.5 * HZ));
    expect(patchView(w).state).toBe('seated');
    expect(patchView(w).at).toEqual(SEAT); // never moved
  });

  test('at its hands, small and slow: it catches it and sets it down beside the board, charged to the throw; the lever puts it back', async () => {
    const w = await benchWorld();
    const t = tape(w);
    const start = w.part('crate-3')!.location;
    holdAt(w, t, 'crate-3', FRONT);
    throwAt(w, t, 'crate-3', [SEAT[0], SEAT[1] + 0.75, SEAT[2]], 0.5);
    const r = t.until((e) => e.type === 'patch.reacted', HZ);
    expect(r?.e).toMatchObject({ part: 'crate-3', answer: 'catch' });
    const at = r!.step;
    for (let i = 0; i < HZ && patchView(w).holding !== 'crate-3'; i++) t.run(1);
    expect(patchView(w).holding).toBe('crate-3');
    expect(w.mode('crate-3')).toBe('machine');
    for (let i = 0; i < 3 * HZ && patchView(w).state !== 'seated'; i++) t.run(1);
    expect((w.step - at) / HZ).toBeLessThanOrEqual(1.5);
    // set down on the bench beside the stool; when it rests the rest is the throw's
    for (let i = 0; i < 3 * HZ && w.part('crate-3')!.location === start; i++) t.run(1);
    const loc = w.part('crate-3')!.location;
    expect(loc.at).toBe('rest');
    const p = (loc as { pose: { p: Vec3 } }).pose.p;
    expect(Math.hypot(p[0] - PATCHLAMP.patch.shelf[0], p[2] - PATCHLAMP.patch.shelf[2])).toBeLessThan(0.3);
    const thrown = w.undoStack().at(-1)!;
    expect(thrown.kind).toBe('release');
    expect(w.writer('crate-3', 'location')).toBe(thrown.id);
    w.dispatch({ type: 'undo' });
    t.run(1);
    expect(w.part('crate-3')!.location).toEqual(start);
  });

  test('a large crate at its body: it takes it on the head (bonk): the crate bounces off and Patch gives it the look', async () => {
    const w = await benchWorld();
    const t = tape(w);
    holdAt(w, t, 'crate-1', FRONT, 200);
    throwAt(w, t, 'crate-1', [SEAT[0], SEAT[1] + 0.75, SEAT[2]], 0.45);
    const r = t.until((e) => e.type === 'patch.reacted', HZ);
    expect(r?.e).toMatchObject({ part: 'crate-1', answer: 'bonk' });
    // it never reaches Patch's middle: it is turned back off the body
    let nearest = Infinity;
    for (let i = 0; i < HZ; i++) {
      t.run(1);
      const p = w.motion('crate-1')!.pose.p;
      nearest = Math.min(nearest, Math.hypot(p[0] - SEAT[0], p[1] - (SEAT[1] + 0.75), p[2] - SEAT[2]));
    }
    expect(nearest).toBeGreaterThan(0.6);
    t.run(Math.round(0.6 * HZ));
    expect(patchView(w).state).toBe('seated');
    expect(patchView(w).at).toEqual(SEAT);
  });
});

describe('Patch is lifted off its stool', () => {
  test('mid-job: it hangs, the job and the next text wait; put down, it walks back, climbs up and finishes the job', async () => {
    const w = await benchWorld();
    const t = tape(w);
    const a = send(w, t, 'make the sign red');
    expect(untilPatch(w, t, 'drawer')).toBe(true);
    const lift: Vec3 = [SEAT[0] - 1, 3.2, SEAT[2] + 2];
    w.dispatch({ type: 'drag', id: 'patch', target: lift });
    t.run(1);
    expect(patchView(w)).toMatchObject({ state: 'held', at: lift });
    const b = send(w, t, "we're closed");
    for (let i = 0; i < 3 * HZ; i++) {
      w.dispatch({ type: 'drag', id: 'patch', target: [lift[0] - (i / HZ) * 1.5, lift[1], lift[2]] });
      t.run(1);
    }
    expect(t.events.some((x) => (x.e.type === 'line.reply' || x.e.type === 'line.refused') && (x.e.n === a || x.e.n === b))).toBe(false);
    expect(shopView(w).sign).toBe('paint-green');
    w.dispatch({ type: 'drag', id: 'patch', target: [-2, 2, 1], end: true });
    t.run(1);
    expect(patchView(w).state).toBe('walk');
    const down = patchView(w).at;
    expect(Math.hypot(down[0] + 2, down[1], down[2] - 1)).toBeLessThan(0.05); // put down there (and already a step on its way)
    expect(answer(t, a, 15).e.type).toBe('line.reply');
    expect(states(t)).toEqual(expect.arrayContaining(['held', 'walk', 'climb', 'drawer', 'work', 'check', 'reply']));
    expect(shopView(w).sign).toBe('cable-red');
    expect(answer(t, b).e.type).toBe('line.reply');
    expect(shopView(w).open).toBe(false);
  });

  test('put down by its stool, it climbs straight up; nothing about it is durable', async () => {
    const w = await benchWorld();
    const t = tape(w);
    const before = w.durable();
    w.dispatch({ type: 'drag', id: 'patch', target: [SEAT[0], 2.5, SEAT[2] + 1] });
    t.run(1);
    w.dispatch({ type: 'drag', id: 'patch', target: PATCHLAMP.patch.foot, end: true });
    t.run(1);
    expect(patchView(w).state).toBe('climb');
    t.run(Math.round((PATCH_TUNING.climb + 0.1) * HZ));
    expect(patchView(w)).toMatchObject({ state: 'seated', at: SEAT });
    expect(w.durable()).toEqual(before);
    expect(w.undoStack()).toEqual([]);
  });
});

describe("Patch's job", () => {
  test('rolls to THAT jack, opens its drawer, leans out to check the station; the whole job takes four and a half seconds and the roll', async () => {
    const w = await benchWorld();
    const t = tape(w);
    w.dispatch({ type: 'unplug', cord: 'cord' });
    t.run(1);
    w.dispatch({ type: 'plug', cord: 'cord', jack: 'jack-lamp' });
    t.run(1);
    const from = w.step;
    const n = send(w, t, 'dimmer');
    expect(untilPatch(w, t, 'drawer')).toBe(true);
    expect(patchView(w)).toMatchObject({ drawer: 'jack-lamp', serving: 'lamp' });
    expect(untilPatch(w, t, 'check')).toBe(true);
    expect(patchView(w).lookAt).toEqual(PATCHLAMP.lamp.home.bulb);
    const a = answer(t, n);
    const seconds = (a.step - from) / HZ;
    // (S6) 4.5 s at the jack, plus the stool's roll from its rest to LAMP's place on the runner
    expect(seconds).toBeGreaterThanOrEqual(4.5);
    expect(seconds).toBeLessThanOrEqual(5.8);
    expect(states(t).slice(0, 6)).toEqual(['notice', 'roll', 'drawer', 'work', 'check', 'reply']);
  });

  test('"Reset the workshop" mid-job: the job is dropped, Patch is back on its stool, idle', async () => {
    const w = await benchWorld();
    const t = tape(w);
    const n = send(w, t, 'make the sign red');
    send(w, t, 'make the awning blue');
    expect(untilPatch(w, t, 'work')).toBe(true);
    w.dispatch({ type: 'reset' });
    t.run(1);
    expect(answer(t, n).e).toMatchObject({ type: 'line.refused', reason: 'cancelled' });
    expect(t.of('line.refused').length).toBe(2);
    expect(patchView(w)).toMatchObject({ state: 'seated', at: SEAT, drawer: null, serving: null });
    t.run(4 * HZ);
    expect(shopView(w)).toMatchObject({ sign: 'paint-green', awning: 'cable-red' });
  });
});
