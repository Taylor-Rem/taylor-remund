// The soak (§ E0 "Nothing gets stuck, lost or piled up after ten minutes of play"), under real Rapier.
import { expect, test } from 'vitest';
import { CRATES, rapierWorld } from './helpers.ts';
import { rng } from '../../src/workshop/sim/rng.ts';
import { steps } from '../../src/workshop/sim/clock.ts';
import type { Vec3 } from '../../src/workshop/sim/types.ts';
import type { World } from '../../src/workshop/sim/world.ts';

const MINUTES = 10;

/** Settled: nothing held, no rung playing, nothing in the chute, every free part at rest. */
function settled(w: World): boolean {
  if (w.holding() || w.bracketed) return false;
  for (const p of w.parts()) {
    const mode = w.mode(p.id);
    if (mode === 'chute' || mode === 'held') return false;
    if (mode === 'free' && w.motion(p.id)!.awake) return false;
  }
  return true;
}

test(`soak: ${MINUTES} simulated minutes of seeded grabbing, throwing, pressing and re-plugging`, { timeout: 120_000 }, async () => {
  const w = await rapierWorld('soak');
  const r = rng('soak-script');
  const ids = [...CRATES, 'fetch'];
  const count = [...w.parts()].length;
  const b = w.scene.bench;
  let settles = 0;
  let actions = 0;
  let returned = 0;
  let presses = 0;

  const step = (): void => {
    w.advance();
    for (const e of w.drainEvents()) {
      if (e.type === 'part.returned') returned++;
      if (e.type === 'button.pressed') presses++;
    }
    for (const p of w.parts()) {
      const m = w.motion(p.id)!;
      expect(m.pose.p.every(Number.isFinite) && m.pose.q.every(Number.isFinite)).toBe(true);
    }
  };

  while (w.step < steps(MINUTES * 60)) {
    // one action
    const k = r.int(10);
    actions++;
    if (k < 7) {
      const id = r.pick(ids);
      const m = w.motion(id)!;
      w.dispatch({ type: 'grab', id, grip: m.pose.p });
      const to: Vec3 = r.chance(0.2) ? [r.pick([-1, 1]) * r.range(9, 11), r.range(0.5, 2), r.range(-4, 5.5)] : [r.range(-7, 7), r.range(0.4, 2.8), r.range(-4, 4)];
      const n = 10 + r.int(60);
      for (let i = 1; i <= n; i++) {
        const f = i / n;
        w.dispatch({ type: 'carry', target: [m.pose.p[0] + (to[0] - m.pose.p[0]) * f, m.pose.p[1] + (to[1] - m.pose.p[1]) * f, m.pose.p[2] + (to[2] - m.pose.p[2]) * f] });
        step();
      }
      w.dispatch({ type: 'release', velocity: [r.range(-9, 9), r.range(-2, 5), r.range(-9, 9)] });
    } else if (k < 9) {
      w.dispatch({ type: 'press', id: 'button' });
    } else {
      w.dispatch({ type: 'unplug', cord: 'cord' });
      step();
      w.dispatch({ type: 'plug', cord: 'cord', jack: r.pick(['jack-lamp', 'jack-storefront', null]) });
    }
    step();
    // let the world settle (or not: sometimes act again before it does)
    const wait = r.chance(0.7) ? steps(12) : r.int(steps(1.5));
    for (let i = 0; i < wait && w.step < steps(MINUTES * 60); i++) {
      step();
      if (settled(w)) break;
    }
    if (settled(w)) {
      settles++;
      for (const p of w.parts()) {
        const pos = w.motion(p.id)!.pose.p;
        expect(pos[0] >= b.minX && pos[0] <= b.maxX && pos[2] >= b.minZ && pos[2] <= b.maxZ && pos[1] > 0 && pos[1] < b.ceiling, `${p.id} outside the bench at step ${w.step}: ${pos.join(', ')}`).toBe(true);
        const loc = w.part(p.id)!.location;
        expect(loc.at).toBe('rest');
      }
    }
    expect([...w.parts()].length).toBe(count);
    expect(['jack-lamp', 'jack-storefront']).toContain(w.setting('cord', 'jack'));
  }
  console.log(`soak: ${actions} actions, ${settles} settles, ${returned} chute returns, ${presses} rungs over ${w.step} steps`);
  expect(settles).toBeGreaterThan(50);
  expect(returned).toBeGreaterThan(3);
  expect(presses).toBeGreaterThan(5);
});
