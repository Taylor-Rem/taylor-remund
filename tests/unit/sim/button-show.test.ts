// R1: `ButtonView.show` gives the crew's performers one clock for a rung: seconds since the press through
// the play and the rewind (the script's beat times are on it), and the rung's whole length.
import { expect, test } from 'vitest';
import { stubWorld, run } from './helpers.ts';
import { bench } from '../../../src/workshop/sim/scenes/bench.ts';
import { HZ } from '../../../src/workshop/sim/clock.ts';

test('show: null when idle; one clock from the press to the end of the rewind; each beat falls at its time on it', () => {
  const { world } = stubWorld(1, { scene: bench });
  run(world, 5);
  expect(world.button().show).toBeNull();
  world.dispatch({ type: 'press', id: 'button' });
  let last = -1;
  const at = new Map<string, number>();
  for (let i = 0; i < 2000; i++) {
    const ev = run(world, 1);
    const b = world.button();
    if (!world.bracketed) break;
    const s = b.show!;
    expect(s.length).toBeCloseTo(b.script!.play + b.script!.rewind, 9);
    expect(s.elapsed).toBeGreaterThan(last);
    expect(s.elapsed - last).toBeLessThanOrEqual(1 / HZ + 1e-9 + (last < 0 ? 1 : 0));
    last = s.elapsed;
    for (const e of ev) if (e.type === 'rung.beat' && !at.has(e.beat)) at.set(e.beat, s.elapsed);
  }
  const script = world.button().script!;
  for (const b of script.beats) if (at.has(b.kind)) expect(Math.abs(at.get(b.kind)! - b.at), b.kind).toBeLessThanOrEqual(1.5 / HZ);
  expect(at.get('rewind')).toBeDefined();
  expect(world.button().show).toBeNull();
});
