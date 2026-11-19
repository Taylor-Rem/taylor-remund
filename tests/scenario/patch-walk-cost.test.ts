// R2: the walk costs nothing while Patch is not walking. Over a session in which nobody lifts Patch (it works
// the line in attract mode, texts come in), none of the walk's planning runs: no route, no clear point, no
// crossing, and its view carries no walk.
import { describe, expect, test, vi } from 'vitest';

const calls = { planWay: 0, clearPoint: 0, crossPoints: 0, stepClear: 0 };
vi.mock('../../src/workshop/sim/crew/patch-route.ts', async (orig) => {
  const m = await orig<typeof import('../../src/workshop/sim/crew/patch-route.ts')>();
  return {
    ...m,
    planWay: (...a: Parameters<typeof m.planWay>) => (calls.planWay++, m.planWay(...a)),
    clearPoint: (...a: Parameters<typeof m.clearPoint>) => (calls.clearPoint++, m.clearPoint(...a)),
    crossPoints: (...a: Parameters<typeof m.crossPoints>) => (calls.crossPoints++, m.crossPoints(...a)),
    stepClear: (...a: Parameters<typeof m.stepClear>) => (calls.stepClear++, m.stepClear(...a)),
  };
});

const { benchWorld, tape } = await import('./line-helpers.ts');
const { patchView, send } = await import('./patchlamp-helpers.ts');
const { HZ } = await import('../../src/workshop/sim/clock.ts');

describe('the walk while Patch is not walking', () => {
  test('a minute of work on its stool: no route planned, nothing of the walk computed', async () => {
    const w = await benchWorld(2);
    const t = tape(w);
    const states = new Set<string>();
    send(w, t, 'make the sign red');
    for (let i = 0; i < 60 * HZ; i++) {
      t.run(1);
      const v = patchView(w);
      states.add(v.state);
      expect(v.walk).toBeNull();
      if (i === 20 * HZ) send(w, t, 'dimmer');
    }
    expect([...states]).not.toContain('walk');
    expect(states.size).toBeGreaterThan(3); // it did work: seated, notice, the job's stages
    expect(calls).toEqual({ planWay: 0, clearPoint: 0, crossPoints: 0, stepClear: 0 });
  }, 120_000);
});
