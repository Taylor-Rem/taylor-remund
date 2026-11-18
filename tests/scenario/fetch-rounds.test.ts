// S5: Fetch's rounds on the bench, under real Rapier (§ B3 play mode: "Fetch goes on carrying fresh
// crates down the belt"; § E5 rule 5; § B5 "its boundary"). See fetch-helpers.ts for the bench used.
import { describe, expect, test } from 'vitest';
import { benchWorld, putOn, tape } from './line-helpers.ts';
import { REACH, inPlay, laneDistance, onStack, roundsBench, startPlay } from './fetch-helpers.ts';
import { runWhile } from './fetch-helpers-throw.ts';
import { bench } from '../../src/workshop/sim/scenes/bench.ts';
import { steps } from '../../src/workshop/sim/clock.ts';
import type { SceneDesc } from '../../src/workshop/sim/scene.ts';
import type { SimEvent } from '../../src/workshop/sim/types.ts';
import type { World } from '../../src/workshop/sim/world.ts';

const SCENE = roundsBench();
const ROUNDS = SCENE.runner.rounds!;

/** A bench whose stack is out of Fetch's reach: the real one if it is, else the stack moved back out of it. */
function farBench(): SceneDesc {
  if (laneDistance(bench, bench.runner.rounds!.stack[0], bench.runner.rounds!.stack[1]).d > REACH + 0.3) return bench;
  // the stack's point AND its crates, back at the left rear, far past the tape (L, M, S upward, as the scene stacks them)
  const far = [-8.5, -1.2] as const;
  const [sx, sz] = bench.runner.rounds!.stack;
  const moved = new Set(['crate-1', 'crate-2', 'crate-3']);
  return {
    ...bench,
    id: 'bench-far',
    parts: bench.parts.map((p) => (moved.has(p.id) ? { ...p, pose: { p: [p.pose.p[0] - sx + far[0], p.pose.p[1], p.pose.p[2] - sz + far[1]] as const, q: p.pose.q } } : p)),
    runner: { ...bench.runner, rounds: { ...bench.runner.rounds!, stack: far } },
  };
}

const states = (ev: readonly SimEvent[]): string[] => ev.flatMap((e) => (e.type === 'crew.state' && e.id === 'fetch' ? [e.state] : []));

describe('its rounds (play mode)', () => {
  test('it takes fresh crates off the stack and sets them on the belt\'s motor end; they ride, sound and ship, all as the crew', async () => {
    const w = await benchWorld('rounds-1', { scene: SCENE });
    startPlay(w);
    const t = tape(w);
    t.run(steps(45));
    const placed = t.of('taken-in').filter((x) => x.e.mouth === ROUNDS.mouth);
    const shipped = t.of('shipped');
    expect(placed.length).toBeGreaterThanOrEqual(6);
    expect(shipped.length).toBeGreaterThanOrEqual(5);
    expect(t.of('struck').filter((x) => x.e.part !== null).length).toBeGreaterThanOrEqual(5);
    expect(states(t.events.map((x) => x.e))).toEqual(expect.arrayContaining(['pickup', 'place']));
    // nothing of it is the visitor's: every write is the crew's or the system's, and the lever has nothing to take
    for (const x of t.of('effect')) expect(['crew', 'system']).toContain(x.e.effect.cause);
    expect(w.undoStack()).toEqual([]);
    w.dispose();
  }, 60_000);

  test('set down at the motor end: the crate comes to rest on the belt at the mouth\'s drop point, still', async () => {
    const w = await benchWorld('rounds-drop', { scene: SCENE });
    startPlay(w);
    const drop = SCENE.mouths!.find((m) => m.id === ROUNDS.mouth)!.drop;
    let checked = 0;
    runWhile(w, () => checked < 3, steps(40), (ev) => {
      for (const e of ev) {
        if (e.type !== 'taken-in' || e.mouth !== ROUNDS.mouth || e.part === undefined) continue;
        const p = w.motion(e.part)!.pose.p;
        if (Math.abs(p[0] - drop[0]) > 1) continue; // a re-take at the far end
        expect(Math.hypot(p[0] - drop[0], p[2] - drop[2])).toBeLessThan(0.15);
        checked++;
      }
    });
    expect(checked).toBe(3);
    w.dispose();
  }, 60_000);

  test('the pace: never two crates set down closer than `every` seconds', async () => {
    const w = await benchWorld('rounds-pace', { scene: SCENE });
    startPlay(w);
    const t = tape(w);
    t.run(steps(90));
    // each crate's first time on the belt after it left the stack (a crate leaving the belt's far end can be taken in again there)
    const seen = new Set<string>();
    const at: number[] = [];
    for (const x of t.events) {
      if (x.e.type === 'shipped') seen.delete(x.e.part);
      if (x.e.type === 'taken-in' && x.e.mouth === ROUNDS.mouth && !seen.has(x.e.part)) {
        seen.add(x.e.part);
        at.push(x.step);
      }
    }
    expect(at.length).toBeGreaterThan(8);
    for (let i = 1; i < at.length; i++) expect((at[i] as number) - (at[i - 1] as number)).toBeGreaterThanOrEqual(steps(ROUNDS.every) - 1);
    w.dispose();
  }, 60_000);

  test(`ten simulated minutes with nobody touching anything: in play never over the cap (${ROUNDS.cap}), nothing leaves the bench, the belt never stalls, the stack never runs dry or piles up`, async () => {
    const w = await benchWorld('rounds-soak', { scene: SCENE });
    startPlay(w);
    const b = w.scene.bench;
    const count = [...w.parts()].length;
    let lastShip = w.step;
    let longestGap = 0;
    let ships = 0;
    let maxInPlay = 0;
    let maxStack = 0;
    let dryFor = 0;
    let longestDry = 0;
    while (w.step < steps(10 * 60)) {
      w.advance();
      for (const e of w.drainEvents()) {
        if (e.type === 'shipped') {
          ships++;
          longestGap = Math.max(longestGap, w.step - lastShip);
          lastShip = w.step;
        }
        expect(e.type, `nothing falls off: ${JSON.stringify(e)}`).not.toBe('part.returned');
        if (e.type === 'card') throw new Error(`a slip: ${JSON.stringify(e)}`);
      }
      const n = inPlay(w);
      maxInPlay = Math.max(maxInPlay, n);
      expect(n).toBeLessThanOrEqual(ROUNDS.cap);
      const st = onStack(w).length;
      maxStack = Math.max(maxStack, st);
      dryFor = st === 0 && !w.crew('fetch')!.carrying ? dryFor + 1 : 0;
      longestDry = Math.max(longestDry, dryFor);
      if (w.step % 30 === 0) {
        expect([...w.parts()].length).toBe(count);
        for (const p of w.parts()) {
          const m = w.motion(p.id)!;
          if (m.mode === 'gone' || m.mode === 'chute') continue;
          const pos = m.pose.p;
          expect(pos[0] >= b.minX && pos[0] <= b.maxX && pos[2] >= b.minZ && pos[2] <= b.maxZ && pos[1] > -0.05, `${p.id} at ${pos.join(', ')}`).toBe(true);
        }
      }
    }
    console.log(`rounds soak: ${ships} shipped in ten minutes, longest gap ${(longestGap / 60).toFixed(1)} s, at most ${maxInPlay} in play, at most ${maxStack} on the stack, longest with none to take ${(longestDry / 60).toFixed(1)} s`);
    // the belt never stalls: a crate ships at least every quarter minute, the whole ten minutes
    expect(ships).toBeGreaterThan(80);
    expect(longestGap).toBeLessThan(steps(15));
    expect(w.step - lastShip).toBeLessThan(steps(15));
    // never dry for long (a restock follows each shipment) and never piled up
    expect(longestDry).toBeLessThan(steps(10));
    expect(maxStack).toBeLessThanOrEqual(4);
    // nobody touched anything: there is nothing to undo
    expect(w.undoStack()).toEqual([]);
    w.dispose();
  }, 240_000);

  test('a stopped belt: it takes one crate and waits with it; nothing floods; started again, it feeds again', async () => {
    const w = await benchWorld('rounds-stop', { scene: SCENE });
    startPlay(w);
    const t = tape(w);
    w.dispatch({ type: 'turn', id: 'belt-lever', value: 0.5 });
    t.run(steps(30));
    expect(w.setting('belt', 'running')).toBe(false);
    const fed = t.of('taken-in').filter((x) => x.e.mouth === ROUNDS.mouth).length;
    expect(fed).toBeLessThanOrEqual(1); // at most the one it was already setting down
    expect(w.crew('fetch')!.carrying).not.toBeNull();
    expect(inPlay(w)).toBeLessThanOrEqual(ROUNDS.cap);
    w.dispatch({ type: 'turn', id: 'belt-lever', value: 1 });
    const again = t.until((e) => e.type === 'taken-in' && e.mouth === ROUNDS.mouth, steps(10));
    expect(again).not.toBeNull();
    w.dispose();
  }, 60_000);

  test('rule 5: a crate the visitor has touched is never taken, even back on the stack', async () => {
    const w = await benchWorld('rounds-rule5', { scene: SCENE });
    startPlay(w);
    const t = tape(w);
    // the visitor lifts the top crate and sets it straight back on the stack
    const top = onStack(w).sort((a, b) => w.motion(b)!.pose.p[1] - w.motion(a)!.pose.p[1])[0]!;
    const p = w.motion(top)!.pose.p;
    putOn(w, t, top, [p[0], p[1] - w.halfExtents(top)![1], p[2]]);
    expect(w.touched(top)).toBe(true);
    let carried = false;
    runWhile(w, () => true, steps(60), () => {
      if (w.crew('fetch')!.carrying === top) carried = true;
    });
    expect(carried).toBe(false);
    w.dispose();
  }, 60_000);

  test('the visitor does its job for it: a crate set on the belt while it is empty-handed, and it salutes', async () => {
    const w = await benchWorld('rounds-salute', { scene: farBench() });
    startPlay(w);
    const t = tape(w);
    // it sets down the crate it carries, then has nothing it can reach
    t.until((e) => e.type === 'taken-in' && e.part === 'crate-4', steps(15));
    t.run(steps(3));
    expect(w.crew('fetch')!.carrying).toBeNull();
    putOn(w, t, 'crate-2', [-2, 0.5, 3.9]);
    const s = t.until((e) => e.type === 'crew.state' && e.id === 'fetch' && e.state === 'salute', steps(3));
    expect(s).not.toBeNull();
    w.dispose();
  }, 60_000);

  test('its boundary: the stack past its tape, it stretches, gives up and prints OUT OF MY LANE; then not again for 40 s', async () => {
    const w = await benchWorld('rounds-far', { scene: farBench() });
    startPlay(w);
    const t = tape(w);
    t.run(steps(70));
    const slips = t.of('card').filter((x) => x.e.by === 'fetch');
    expect(slips.length).toBeGreaterThanOrEqual(1);
    expect(slips.length).toBeLessThanOrEqual(2);
    expect(slips.every((x) => x.e.content === 'slip.out-of-lane')).toBe(true);
    if (slips.length === 2) expect(slips[1]!.step - slips[0]!.step).toBeGreaterThanOrEqual(steps(40));
    const st = states(t.events.map((x) => x.e));
    expect(st.indexOf('reach')).toBeGreaterThan(-1);
    expect(st[st.indexOf('reach') + 1]).toBe('shrug');
    // it never moved a stack crate (the dock's restocking may jostle them: that is the system's)
    expect(t.of('effect').filter((x) => ['crate-1', 'crate-2', 'crate-3'].includes(x.e.effect.target) && x.e.effect.cause === 'crew')).toEqual([]);
    w.dispose();
  }, 60_000);

  test('attract mode is as it was: no rounds before the visitor\'s first action', async () => {
    const w = await benchWorld('rounds-attract', { scene: SCENE });
    const ev = runWhile(w, () => true, steps(30));
    expect(w.playMode).toBe(false);
    const st = states(ev);
    expect(st).not.toContain('place');
    expect(st).toContain('fumble');
    w.dispose();
  }, 60_000);
});

export type { World };
