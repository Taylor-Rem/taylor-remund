import { test } from 'vitest';
import { benchWorld, FULL_BENCH, tape } from './line-helpers.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';

// a text at every tenth of a second around the collect beat: where is the cord, and who wrote it, 40 s later
test('explore', async () => {
  const out: string[] = [];
  for (let off = 0; off < 30; off++) {
    const w = await benchWorld('attract-first-6', { scene: FULL_BENCH });
    const t = tape(w);
    for (let i = 0; i < 60 * HZ && w.attract().laps.length < 1; i++) t.run(1);
    for (let i = 0; i < 60 * HZ && w.attract().beat !== 'collect'; i++) t.run(1);
    t.run(Math.max(0, Math.round(off * 0.1 * HZ) - 30));
    const beat = w.attract().beat;
    w.dispatch({ type: 'text', text: 'make it red' });
    t.run(40 * HZ);
    out.push(`${off}:${beat}:${w.setting('cord', 'jack')}/${w.writer('cord', 'jack')}`);
    w.dispose();
  }
  console.log(out.join('  '));
}, 300000);
