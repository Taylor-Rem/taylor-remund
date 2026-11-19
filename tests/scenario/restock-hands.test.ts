// The dock restocks the stack only when the crew's hands are out of it. A crate in the crew's hands is
// neither free nor held, so while Fetch lifts the top crate the stack reads one crate short and its top
// reads low: a restock in that moment set a crate down inside the one being lifted (found on the path
// layout, attract.test's seeded moment 10: the bounced crate ended on the platen's tray). The restock
// now stays owed until the hands are clear.
import { describe, expect, test } from 'vitest';
import { benchWorld, FULL_BENCH } from './line-helpers.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';

describe('the dock restocks the stack', () => {
  test('never while the crew has a crate in its hands at the stack, over four minutes of the lap', async () => {
    const w = await benchWorld('restock-hands', { scene: FULL_BENCH });
    const [sx, sz] = w.scene.runner.rounds!.stack;
    const crewAtStack = (): string[] =>
      [...w.parts()]
        .filter((p) => p.kind === 'crate')
        .filter((p) => {
          const m = w.motion(p.id);
          return m?.mode === 'crew' && Math.hypot(m.pose.p[0] - sx, m.pose.p[2] - sz) <= 0.55;
        })
        .map((p) => p.id);
    let restocks = 0;
    for (let i = 0; i < 240 * HZ; i++) {
      w.advance();
      for (const e of w.drainEvents()) {
        if (e.type !== 'restocked') continue;
        restocks++;
        expect(crewAtStack(), `restocked ${e.part} at step ${i} with the crew's hands in the stack`).toEqual([]);
      }
    }
    // the lap really restocked (otherwise this holds nothing)
    expect(restocks).toBeGreaterThan(3);
    w.dispose();
  });
});
