// Patch, the operator (REWRITE.md § B5 as amended 2026-11-18; S3): the job in stages, lifted off the
// stool, and a part thrown at it (duck, catch, bonk). Patch is never moved by physics and never hurt;
// a reaction lasts at most 1.5 s. On the whole bench under real Rapier.
import { describe, expect, test } from 'vitest';
import { benchWorld, benchWorld as scriptWorld, SCRIPT_BENCH, tape } from './line-helpers.ts';
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
    // S7: the view is told where it will be set down; it is let go exactly there
    const shelf = patchView(w).shelf;
    expect(shelf).toEqual(PATCHLAMP.patch.shelf);
    for (let i = 0; i < 3 * HZ && w.mode('crate-3') === 'machine'; i++) t.run(1);
    const h = w.halfExtents('crate-3')![1];
    const q = w.motion('crate-3')!.pose.p;
    expect(Math.hypot(q[0] - shelf[0], q[2] - shelf[2])).toBeLessThan(0.05);
    expect(Math.abs(q[1] - (shelf[1] + h + 0.01))).toBeLessThan(0.05);
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
    w.dispatch({ type: 'drag', id: 'patch', target: [-6, 1.2, -2], end: true }); // (a hand's height over open bench: higher, or over a body, it falls: R4)
    t.run(1);
    // (R4: let go above the bench it falls the little way to it first, then it is on its feet; the bench's Patch, a
    // body since 2026-11-20, lands and gets up from how it lies before its first step)
    for (let i = 0; i < 120 && (patchView(w).state === 'fly' || patchView(w).state === 'land'); i++) t.run(1);
    expect(patchView(w).state).toBe('walk');
    const down = patchView(w).at;
    // put down there (R4: the hand still moving at 1.5 u/s as it lets go, it drifts that way the little way it falls)
    expect(Math.hypot(down[0] + 6, down[1], down[2] + 2)).toBeLessThan(0.4);
    // S7: it walks to `foot` (in front of the stool, wherever the stool is) and climbs from there
    const foot = patchView(w).foot;
    for (let i = 0; i < 10 * HZ && patchView(w).state === 'walk'; i++) t.run(1);
    expect(patchView(w).state).toBe('climb');
    expect(patchView(w).foot).toEqual(foot);
    const climbStart = patchView(w).at;
    expect(Math.hypot(climbStart[0] - foot[0], climbStart[2] - foot[2])).toBeLessThan(0.1); // a step up from it at most
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
    // (the bench's Patch, a body since 2026-11-20, comes down the little way onto its feet first: then it climbs,
    // with no step between)
    for (let i = 0; i < 60 && (patchView(w).state === 'fly' || patchView(w).state === 'land'); i++) t.run(1);
    expect(patchView(w).state).toBe('climb');
    t.run(Math.round((PATCH_TUNING.climb + 0.1) * HZ));
    expect(patchView(w)).toMatchObject({ state: 'seated', at: SEAT });
    expect(w.durable()).toEqual(before);
    expect(w.undoStack()).toEqual([]);
  });
});

// The scripted Patch's own ledge rules (`benchScript`: let go past the edge at any height, it is put on the ledge).
// The bench's Patch (a body since 2026-11-20) catches an edge only low and slow and otherwise falls and comes back up
// the chute: tests/scenario/patch-body.test.ts holds that, and the job waiting meanwhile.
describe('Patch let go of past the edge of the bench (R1)', () => {
  const T = PATCH_TUNING;
  const benchWorld = (): ReturnType<typeof scriptWorld> => scriptWorld(1, { scene: SCRIPT_BENCH });
  const EDGE = { minX: -9, maxX: 9, maxZ: 5 };
  /** Carry it from above its stool to `to` over `n` steps, and let go there. */
  /** Carry it there over `n` steps and let go: after a pause (a set-down, R4), or at once with the hand still moving (a throw). */
  function carryAndDrop(w: World, t: Tape, to: Vec3, n = 60, pause = true): void {
    const from: Vec3 = [SEAT[0], 3, SEAT[2] + 1];
    for (let i = 0; i <= n; i++) {
      w.dispatch({ type: 'drag', id: 'patch', target: [from[0] + ((to[0] - from[0]) * i) / n, from[1] + ((to[1] - from[1]) * i) / n, from[2] + ((to[2] - from[2]) * i) / n] });
      t.run(1);
    }
    if (pause) t.run(12);
    w.dispatch({ type: 'drag', id: 'patch', target: to, end: true });
    t.run(1);
    // (R4: let go above the bench it falls the little way to it first, then it is on its feet)
    for (let i = 0; i < 60 && patchView(w).state === 'fly' && pause; i++) t.run(1);
  }

  test('off the front: it hangs from the front edge, hauls itself up, dusts off, gives the look and walks back; never physics, nothing charged', async () => {
    const w = await benchWorld();
    const t = tape(w);
    const before = w.durable();
    carryAndDrop(w, t, [2, 2.5, EDGE.maxZ + 0.5], 240); // slow: let go past the edge
    const v = patchView(w);
    expect(v.state).toBe('ledge');
    expect(v.ledge?.edge).toBe('front');
    expect(v.ledge?.out).toEqual([0, 0, 1]);
    expect(v.at[2]).toBe(EDGE.maxZ);
    expect(v.at[1]).toBe(PATCHLAMP.patch.foot[1]);
    expect(Math.abs(v.at[0] - 2)).toBeLessThan(0.3); // the nearest point of the edge
    expect(v.stateLength).toBe(T.ledge);
    t.run(Math.round(T.ledge * HZ) + 1);
    expect(patchView(w).state).toBe('haul');
    t.run(Math.round((T.haul / 2) * HZ));
    const mid = patchView(w).at;
    expect(mid[2]).toBeLessThan(EDGE.maxZ);
    expect(mid[2]).toBeGreaterThan(EDGE.maxZ - T.ledgeIn);
    t.run(Math.round((T.haul / 2) * HZ) + 1);
    expect(patchView(w).state).toBe('dust');
    // R2: it lands just in from the edge, clear of the belt's front rail (never inside a body)
    expect(patchView(w).at[2]).toBeLessThanOrEqual(EDGE.maxZ - 0.22 + 1e-9);
    expect(patchView(w).at[2]).toBeGreaterThanOrEqual(4.52 + 0.22 - 1e-9);
    t.run(Math.round(T.dust * HZ) + 1);
    expect(patchView(w)).toMatchObject({ state: 'look', lookAt: PATCHLAMP.patch.visitor, ledge: null });
    t.run(Math.round(T.look * HZ) + 1);
    expect(patchView(w).state).toBe('walk');
    for (let i = 0; i < 15 * HZ && patchView(w).state !== 'seated'; i++) t.run(1);
    expect(patchView(w)).toMatchObject({ state: 'seated', at: SEAT });
    expect(states(t).slice(0, 6)).toEqual(['held', 'ledge', 'haul', 'dust', 'look', 'walk']);
    expect(states(t).slice(-2)).toEqual(['climb', 'seated']);
    expect(w.durable()).toEqual(before);
    expect(w.undoStack()).toEqual([]);
  });

  test('off a side: it hangs from that end of the bench, facing in', async () => {
    const w = await benchWorld();
    const t = tape(w);
    carryAndDrop(w, t, [EDGE.maxX + 0.5, 2.5, 0], 300);
    const v = patchView(w);
    expect(v.state).toBe('ledge');
    expect(v.ledge?.edge).toBe('right');
    expect(v.at[0]).toBe(EDGE.maxX);
    expect(Math.abs(v.at[2])).toBeLessThan(0.3);
    expect(Math.sin(v.heading)).toBeCloseTo(-1, 6); // facing −X, in over the edge
    const left = await benchWorld();
    const tl = tape(left);
    carryAndDrop(left, tl, [EDGE.minX - 0.5, 2.5, -1], 300);
    expect(patchView(left)).toMatchObject({ state: 'ledge', ledge: { edge: 'left' } });
    expect(patchView(left).at[0]).toBe(EDGE.minX);
  });

  test('let go of far past the bench: it catches the nearest point of the edge it went furthest over (never a corner, never the back)', async () => {
    const w = await benchWorld();
    const t = tape(w);
    carryAndDrop(w, t, [30, 2.5, 40], 240);
    expect(patchView(w)).toMatchObject({ state: 'ledge', ledge: { edge: 'front' } });
    expect(patchView(w).at).toEqual([EDGE.maxX - 0.5, PATCHLAMP.patch.foot[1], EDGE.maxZ]);
    const b = await benchWorld();
    const tb = tape(b);
    carryAndDrop(b, tb, [0, 1.2, -30], 240); // behind the wall: put down on the bench, as before
    expect(patchView(b).state).toBe('walk');
    expect(patchView(b).ledge).toBeNull();
  });

  test('flung toward the edge and let go short of it, it is thrown (R4: it flies); let go after a pause there, it is put down', async () => {
    const w = await benchWorld();
    const t = tape(w);
    // fast: 3 units in a sixth of a second, let go 0.3 inside the front edge with the hand moving
    carryAndDrop(w, t, [2, 2.5, EDGE.maxZ - 0.3], 10, false);
    expect(patchView(w).state).toBe('fly');
    const g = await benchWorld();
    const tg = tape(g);
    carryAndDrop(g, tg, [2, 1.2, EDGE.maxZ - 0.3], 400);
    expect(patchView(g).state).toBe('walk');
  });

  test('a second grab while it hangs or hauls does nothing; once on its feet it can be lifted again', async () => {
    const w = await benchWorld();
    const t = tape(w);
    carryAndDrop(w, t, [0, 2.5, EDGE.maxZ + 0.6], 240);
    expect(patchView(w).state).toBe('ledge');
    const at = patchView(w).at;
    w.dispatch({ type: 'grab', id: 'patch', grip: at });
    t.run(1);
    w.dispatch({ type: 'carry', target: [0, 3, 0] });
    t.run(1);
    w.dispatch({ type: 'release', velocity: [0, 0, 0] });
    t.run(1);
    expect(patchView(w)).toMatchObject({ state: 'ledge', at });
    t.run(Math.round(T.ledge * HZ) - 2);
    expect(patchView(w).state).toBe('haul');
    w.dispatch({ type: 'grab', id: 'patch', grip: patchView(w).at });
    t.run(1);
    w.dispatch({ type: 'carry', target: [0, 3, 0] });
    t.run(1);
    expect(patchView(w).state).toBe('haul');
    w.dispatch({ type: 'release', velocity: [0, 0, 0] });
    t.run(Math.round(T.haul * HZ));
    expect(patchView(w).state).toBe('dust');
    w.dispatch({ type: 'grab', id: 'patch', grip: patchView(w).at });
    t.run(1);
    expect(patchView(w)).toMatchObject({ state: 'held', ledge: null });
  });

  test('a job in hand waits while it is off the edge, and carries on once it is back on its stool', async () => {
    const w = await benchWorld();
    const t = tape(w);
    const a = send(w, t, 'make the sign red');
    expect(untilPatch(w, t, 'drawer')).toBe(true);
    carryAndDrop(w, t, [3, 2.5, EDGE.maxZ + 0.5], 240);
    expect(patchView(w).state).toBe('ledge');
    t.run(Math.round((T.ledge + T.haul + T.dust) * HZ));
    expect(t.events.some((x) => x.e.type === 'line.reply' && x.e.n === a)).toBe(false);
    expect(shopView(w).sign).toBe('paint-green');
    expect(answer(t, a, 20).e.type).toBe('line.reply');
    expect(shopView(w).sign).toBe('cable-red');
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
    expect(patchView(w).lookAt).toEqual(PATCHLAMP.lamp.home.aim);
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
