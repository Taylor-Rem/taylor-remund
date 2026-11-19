// A Button rung's rewind plays the recording back eased in and out (S7 item 1): parts gather speed and
// settle instead of stopping dead, and the last step is the recorded start exactly.
import { expect, test } from 'vitest';
import { stubWorld, run } from './helpers.ts';
import { bench } from '../../../src/workshop/sim/scenes/bench.ts';
import { qyaw } from '../../../src/workshop/sim/math.ts';
import type { Vec3 } from '../../../src/workshop/sim/types.ts';

test('the rewind eases: slow out of the end of the rung, fastest in the middle, slow into the start, and exact at the start', () => {
  const { world, physics } = stubWorld(1, { scene: bench });
  run(world, 5);
  // whichever stack crate the flinch shoves glides away at an even pace through the whole rung (scripted)
  const starts = new Map<string, Vec3>();
  for (const id of bench.button.stack) {
    const p = world.motion(id)!.pose.p;
    starts.set(id, [p[0], p[1], p[2]]);
    physics.land(id, { p: [p[0] + 2.4, p[1], p[2] + 0.6], q: qyaw(0) }, 170);
  }
  world.dispatch({ type: 'press', id: 'button' });
  const ev = run(world, 1);
  const shoved = ev.flatMap((e) => (e.type === 'rung.beat' && e.beat === 'shove' ? e.ids : []))[0]!;
  expect(shoved).toBeDefined();
  while (world.button().phase !== 'rewinding') run(world, 1);
  const xs: number[] = [world.motion(shoved)!.pose.p[0]];
  while (world.bracketed) {
    run(world, 1);
    xs.push(world.motion(shoved)!.pose.p[0]);
  }
  const d = xs.slice(1).map((x, i) => Math.abs(x - xs[i]!));
  const n = d.length;
  const mid = Math.max(...d.slice(Math.floor(n * 0.4), Math.ceil(n * 0.6)));
  const tail = Math.max(...d.slice(n - 4));
  const head = Math.max(...d.slice(1, 4));
  expect(mid).toBeGreaterThan(0);
  expect(tail).toBeLessThan(mid * 0.3);
  expect(head).toBeLessThan(mid * 0.3);
  // exactly where it was at the press
  const p = world.motion(shoved)!.pose.p;
  const s = starts.get(shoved)!;
  for (let k = 0; k < 3; k++) expect(p[k]).toBe(s[k]);
});
