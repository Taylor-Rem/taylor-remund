// The visitor's first action can be the Button's press, at any moment of the crew's demonstration
// (REWRITE.md § B3, § E5 rule 5 and "nothing commits while a rung plays"). Ending attract mode puts the
// cord back where the visit began if the crew had moved it; that is a commit, and the press has opened a
// rung in the same step, so the cord waits the rung out. Found by the bake recorder, which presses the
// Button on the bench page: between Patch moving the cord and putting it back, the step threw.
import { describe, expect, test } from 'vitest';
import { benchWorld, FULL_BENCH } from './line-helpers.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';

describe('attract mode ended by the Button', () => {
  test('a press at any moment of the first lap never stops the world, and the cord ends where the visit began', async () => {
    const crewHadTheCord: number[] = [];
    for (let at = 0; at <= 50 * HZ; at += 2 * HZ) {
      const w = await benchWorld(`attract-button-${at}`, { scene: FULL_BENCH });
      const cord = w.scene.cord;
      const jack = (): unknown => w.durable().find((d) => d.target === cord.id && d.field === 'jack')?.value;
      for (let i = 0; i < at; i++) w.advance();
      if (jack() !== cord.start) crewHadTheCord.push(at);
      w.dispatch({ type: 'press', id: 'button' });
      expect(() => {
        for (let i = 0; i < 20 * HZ; i++) w.advance();
      }, `pressed ${at / HZ} s in`).not.toThrow();
      expect(jack(), `the cord, pressed ${at / HZ} s in`).toBe(cord.start);
      w.dispose();
    }
    // the case this test exists for was really met: at some of those moments the crew had moved the cord
    expect(crewHadTheCord.length).toBeGreaterThan(0);
  });
});
