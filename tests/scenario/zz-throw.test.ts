import { test } from 'vitest';
import { benchWorld, FULL_BENCH, tape } from './line-helpers.ts';
import { LOOSE_TUNING } from '../../src/workshop/sim/world.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';

const open = { ...FULL_BENCH, statics: FULL_BENCH.statics.filter((s) => s.id === 'bench' || s.id === 'back-wall'), parts: FULL_BENCH.parts.map((p) => (p.id.startsWith('crate') || p.id === 'fetch' ? { ...p, pose: { p: [p.pose.p[0], p.pose.p[1], -3.5] as [number, number, number], q: p.pose.q } } : p)) };

test('probe: throw distances', async () => {
  (LOOSE_TUNING as { throwMax: number }).throwMax = 100;
  for (const id of ['crate-3', 'crate-2', 'crate-1', 'fetch']) {
    for (const v of [4, 6, 7.5, 10, 12, 14, 17]) {
      const w = await benchWorld('throw', { scene: open as never });
      const t = tape(w);
      t.run(30);
      const p0 = w.motion(id)!.pose.p;
      w.dispatch({ type: 'grab', id, grip: p0 });
      const start: [number, number, number] = [-7, 1.1, 1.5];
      for (let i = 0; i < 90; i++) {
        w.dispatch({ type: 'carry', target: start });
        t.run(1);
      }
      const s = w.motion(id)!.pose.p;
      w.dispatch({ type: 'release', velocity: [v, 0.6, 0] });
      let rest = -1;
      let maxY = 0;
      for (let i = 0; i < 12 * HZ; i++) {
        t.run(1);
        maxY = Math.max(maxY, w.motion(id)!.pose.p[1]);
        if (w.mode(id) !== 'free' && w.mode(id) !== 'held') { rest = -2; break; }
        const m = w.motion(id)!; if (i > 20 && Math.hypot(m.pose.p[0] - m.prev.p[0], m.pose.p[1] - m.prev.p[1], m.pose.p[2] - m.prev.p[2]) * HZ < 0.04) { rest = i / HZ; break; }
      }
      const p = w.motion(id)!.pose.p;
      console.log(id, 'v', v, 'from', s[0].toFixed(2), 'travel', (p[0] - s[0]).toFixed(2), 'rest at', rest === -2 ? `off (${w.mode(id)})` : rest.toFixed(2), 'maxY', maxY.toFixed(2), 'mass', w.part(id) && (w as any).massOf?.(id));
      w.dispose();
    }
  }
}, 600000);
