// What a Button rung's start and end cost a step (S7 round 2, item 1): REWRITE.md § E7 allows no frame over
// 22 ms with drawing in it, so the simulation's step at a rung's start and end must cost what any step
// costs. Whole bench, real Rapier, in Node. The numbers are printed; the bound is generous (machines vary).
import { describe, expect, test } from 'vitest';
import { benchWorld, tape, FULL_BENCH } from './line-helpers.ts';
import { steps } from '../../src/workshop/sim/clock.ts';
import type { ButtonSaved } from '../../src/workshop/sim/machines/button.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import { createWorld } from '../../src/workshop/sim/world.ts';
import { createStubPhysics } from '../../src/workshop/sim/physics/stub.ts';

const SAVES: Record<number, ButtonSaved> = {
  1: { rung: 0, presses: 0 },
  2: { rung: 1, reached: 1, presses: 1 },
  3: { rung: 2, reached: 2, presses: 2 },
  4: { rung: 3, reached: 3, presses: 3, cover: 'none', used: ['belt', 'striker', 'dock', 'chute', 'cord', 'undo-lever', 'lamp'] },
};

/** Milliseconds of each step from the press to two seconds after the rung ends; which step the rung began and ended in. */
function timed(w: World): { ms: number[]; start: number; end: number } {
  const ms: number[] = [];
  let start = -1;
  let end = -1;
  w.dispatch({ type: 'press', id: 'button' });
  for (let i = 0; i < steps(16); i++) {
    const t0 = performance.now();
    w.advance();
    ms.push(performance.now() - t0);
    const ev = w.drainEvents();
    if (start < 0 && ev.some((e) => e.type === 'button.pressed')) start = i;
    if (end < 0 && ev.some((e) => e.type === 'rung.ended')) end = i;
    if (end >= 0 && i > end + steps(2)) break;
  }
  return { ms, start, end };
}

describe('a rung costs a step what any step costs', () => {
  test('the step a rung starts in and the step it ends in, each rung, against the median step', async () => {
    const lines: string[] = [];
    let worst = 0;
    let coldWorst = 0;
    for (const rung of [1, 2, 3, 4]) {
      const w = await benchWorld(`cost-${rung}`, { scene: FULL_BENCH, button: SAVES[rung] as { rung: number; presses: number } });
      tape(w).run(steps(3));
      // the first rung of a visit (cold: code not yet compiled, buffers not yet grown), then a second
      const cold = timed(w);
      lines.push(`rung ${rung} cold: start ${cold.ms[cold.start]!.toFixed(2)} ms, end ${cold.ms[cold.end]!.toFixed(2)} ms`);
      // before S7 round 2 the very first rung's end cost ~39 ms here (the engine's first restore), its start ~11
      coldWorst = Math.max(coldWorst, cold.ms[cold.start]!, cold.ms[cold.end]!);
      tape(w).run(steps(4));
      const { ms, start, end } = timed(w);
      const sorted = [...ms].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)]!;
      const around = (i: number) => Math.max(...ms.slice(Math.max(0, i - 1), i + 2));
      lines.push(`rung ${rung}: median ${median.toFixed(2)} ms, start ${ms[start]!.toFixed(2)} ms, end ${ms[end]!.toFixed(2)} ms (around it ${around(end).toFixed(2)}), max ${sorted.at(-1)!.toFixed(2)} ms`);
      worst = Math.max(worst, ms[start]! - median, around(end) - median);
      w.dispose();
    }
    process.stderr.write(`\n${lines.join('\n')}\n`);
    // timings are printed always; asserted only on a quiet machine (`STEP_COSTS=1`), since the suite runs in parallel
    if (process.env.STEP_COSTS) {
      expect(worst).toBeLessThan(6);
      expect(coldWorst).toBeLessThan(10);
    }
  }, 120_000);
});

test('the engine pays for its first snapshot and restore while the world is built, not in a rung\'s step', () => {
  const physics = createStubPhysics();
  const calls: string[] = [];
  const snap = physics.snapshot.bind(physics);
  const restore = physics.restore.bind(physics);
  physics.snapshot = () => (calls.push('snapshot'), snap());
  physics.restore = (x) => (calls.push('restore'), restore(x));
  const w = createWorld({ seed: 1, physics, scene: FULL_BENCH });
  expect(calls).toEqual(['snapshot', 'restore']);
  w.dispose();
});
