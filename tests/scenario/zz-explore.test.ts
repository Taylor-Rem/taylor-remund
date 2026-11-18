import { test } from 'vitest';
import { benchWorld, FULL_BENCH } from './line-helpers.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';

test('explore', async () => {
  const w = await benchWorld('attract-laps', { scene: FULL_BENCH });
  for (let i = 0; i < 60 * 120; i++) {
    w.advance();
    for (const e of w.drainEvents()) {
      if (e.type === 'restocked' || e.type === 'shipped' || (e.type === 'crew.state' && e.state === 'pickup') || e.type === 'crew.knocked') {
        const f = w.crew('fetch')!;
        console.log((w.step / HZ).toFixed(2), JSON.stringify(e), f.x.toFixed(2), f.z.toFixed(2), f.carrying);
      }
    }
  }
  console.log(JSON.stringify(w.attract().laps));
}, 120000);
