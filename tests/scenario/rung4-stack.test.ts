// § B4 rung 4, "the crate stack comes down" (S7 item 6), under real Rapier on the whole bench: every crate
// leaves the stack and travels some way (a seeded spread, different from seed to seed), the bench stays
// on the bench, and after the rung every crate is back exactly where it stood.
import { describe, expect, test } from 'vitest';
import { benchWorld, tape, AT } from './line-helpers.ts';
import { steps } from '../../src/workshop/sim/clock.ts';
import type { ButtonSaved } from '../../src/workshop/sim/machines/button.ts';
import type { Pose } from '../../src/workshop/sim/types.ts';

const AT_THE_WORKS: ButtonSaved = { rung: 3, reached: 3, presses: 3, cover: 'none', used: ['belt', 'striker', 'dock', 'chute', 'cord', 'undo-lever', 'lamp'] };
const STACK = ['crate-1', 'crate-2'] as const; // two high (A1 round 7)
const RADIUS = 0.6; // the ladder's stack radius (scenes/bench.ts)
const SEEDS = 8;

describe('rung 4: the stack comes down', () => {
  test(`over ${SEEDS} seeds: every crate leaves the stack, travels, spreads by seed, and is back exactly after`, async () => {
    const report: string[] = [];
    const rests: string[] = [];
    for (let seed = 0; seed < SEEDS; seed++) {
      const w = await benchWorld(`stack-${seed}`, { button: AT_THE_WORKS as { rung: number; presses: number } });
      const t = tape(w);
      t.run(5);
      const before = new Map<string, Pose>(STACK.map((id) => [id, w.motion(id)!.pose]));
      w.dispatch({ type: 'press', id: 'button' });
      t.run(1);
      expect(w.bracketed).toBe(true);
      // to the rewind: where each crate is when the rung stops playing
      while (w.bracketed && w.button().phase !== 'rewinding') t.run(1);
      const label = `seed ${seed}`;
      const ends = STACK.map((id) => {
        const p = w.motion(id)!.pose.p;
        const b = before.get(id)!.p;
        return { id, off: Math.hypot(p[0] - AT.stack[0], p[2] - AT.stack[1]), travelled: Math.hypot(p[0] - b[0], p[2] - b[2]), p, mode: w.motion(id)!.mode };
      });
      report.push(`${label}: ${ends.map((e) => `${e.id} off ${e.off.toFixed(2)} went ${e.travelled.toFixed(2)}`).join(', ')}`);
      rests.push(ends.map((e) => `${e.p[0].toFixed(1)},${e.p[2].toFixed(1)}`).join(' '));
      for (const e of ends) {
        expect(e.mode, `${label}: ${e.id} still on the bench`).toBe('free');
        expect(e.off, `${label}: ${e.id} off the stack\n${report.join('\n')}`).toBeGreaterThan(RADIUS + 0.4);
        expect(e.travelled, `${label}: ${e.id} travelled\n${report.join('\n')}`).toBeGreaterThan(1.0);
      }
      while (w.bracketed) t.run(1);
      for (const id of STACK) {
        const a = before.get(id)!;
        const b = w.motion(id)!.pose;
        for (let k = 0; k < 3; k++) expect(Math.abs(b.p[k]! - a.p[k]!), `${label}: ${id} back`).toBeLessThan(1e-6);
        for (let k = 0; k < 4; k++) expect(Math.abs(b.q[k]! - a.q[k]!), `${label}: ${id} back`).toBeLessThan(1e-6);
      }
      t.run(steps(0.5));
      w.dispose();
    }
    // a seeded spread: the crates do not land the same way every time
    expect(new Set(rests).size).toBe(SEEDS);
  }, 120_000);
});
