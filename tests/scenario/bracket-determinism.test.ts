// The Button's bracket and determinism, under real Rapier (§ E5 "The Button is bracketed", § E4 invariant 4).
import { describe, expect, test } from 'vitest';
import { CRATES, line, rapierWorld, run, throwPart } from './helpers.ts';
import { rng } from '../../src/workshop/sim/rng.ts';
import { steps } from '../../src/workshop/sim/clock.ts';
import type { Pose, SimEvent, Vec3 } from '../../src/workshop/sim/types.ts';
import type { World } from '../../src/workshop/sim/world.ts';

const bodies = (w: World): Map<string, Pose> => new Map([...w.parts()].map((p) => [p.id, w.motion(p.id)!.pose]));

/** Some seeded throwing about, leaving things wherever they are (possibly still moving). */
function mess(w: World, seed: number): void {
  const r = rng(`mess-${seed}`);
  const throws = 1 + r.int(3);
  for (let t = 0; t < throws; t++) {
    const id = r.pick(CRATES);
    if (w.mode(id) !== 'free' && w.mode(id) !== 'crew') continue;
    const from = w.motion(id)!.pose.p;
    const to: Vec3 = [r.range(-5, 5), r.range(0.8, 2.5), r.range(-3, 3.5)];
    throwPart(w, id, line(from, to, 20 + r.int(20)), [r.range(-6, 6), r.range(-1, 3), r.range(-6, 6)]);
    run(w, r.int(steps(2.5))); // sometimes it is still tumbling at the press
  }
}

describe('the bracket under Rapier', () => {
  test('over 20 seeds with random prior throws: after the rung, every durable field is identical and every body is where it was', async () => {
    let shoved = 0;
    for (let seed = 0; seed < 20; seed++) {
      const w = await rapierWorld(seed);
      run(w, 3);
      mess(w, seed);
      const durable = w.durable();
      const poses = bodies(w);
      const top = w.motion('crate-3')!.pose.p;
      w.dispatch({ type: 'press', id: 'button' });
      const events: SimEvent[] = [];
      let moved = 0;
      for (let i = 0; i < steps(6) && (i === 0 || w.bracketed); i++) {
        w.advance();
        events.push(...w.drainEvents());
        const p = w.motion('crate-3')!.pose.p;
        moved = Math.max(moved, Math.hypot(p[0] - top[0], p[2] - top[2]));
      }
      if (moved > 0.3) shoved++;
      expect(w.bracketed).toBe(false);
      expect(events.some((e) => e.type === 'rung.ended')).toBe(true);
      expect(events.filter((e) => e.type === 'effect')).toEqual([]);
      expect(w.durable()).toEqual(durable);
      for (const [id, p] of bodies(w)) {
        const q = poses.get(id)!;
        for (let k = 0; k < 3; k++) expect(Math.abs(p.p[k]! - q.p[k]!)).toBeLessThan(1e-6);
        for (let k = 0; k < 4; k++) expect(Math.abs(p.q[k]! - q.q[k]!)).toBeLessThan(1e-6);
      }
      expect(w.button()).toMatchObject({ rung: 1, presses: 1 });
      w.dispose();
    }
    // the flinch really knocks a crate about in most of them (it is not a no-op that trivially "restores")
    expect(shoved).toBeGreaterThan(5);
  });

  test('the world resumes after a rung: a crate that was mid-flight at the press lands as it would have', async () => {
    const a = await rapierWorld(11);
    const b = await rapierWorld(11);
    for (const w of [a, b]) {
      run(w, 3);
      throwPart(w, 'crate-2', line(w.motion('crate-2')!.pose.p, [0, 2.5, 3], 25), [4, 3, -1]);
      run(w, 5);
    }
    a.dispatch({ type: 'press', id: 'button' });
    while (run(a, 1) && a.bracketed);
    run(a, steps(5));
    run(b, steps(5));
    const pa = a.motion('crate-2')!.pose.p;
    const pb = b.motion('crate-2')!.pose.p;
    expect(Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2])).toBeLessThan(1e-4);
  });
});

describe('determinism under Rapier', () => {
  async function script(seed: number): Promise<{ durable: unknown; events: SimEvent[] }> {
    const w = await rapierWorld(seed);
    const r = rng(`det-${seed}`);
    const events: SimEvent[] = [];
    for (let i = 0; i < steps(40); i++) {
      if (i % 23 === 0) {
        const k = r.int(6);
        const id = r.pick([...CRATES, 'fetch']);
        if (k === 0) w.dispatch({ type: 'grab', id, grip: w.motion(id)!.pose.p });
        if (k === 1 || k === 2) w.dispatch({ type: 'carry', target: [r.range(-6, 6), r.range(0.5, 2.5), r.range(-3, 4)] });
        if (k === 3) w.dispatch({ type: 'release', velocity: [r.range(-7, 7), r.range(0, 4), r.range(-7, 7)] });
        if (k === 4 && r.chance(0.3)) w.dispatch({ type: 'press', id: 'button' });
        if (k === 5) w.dispatch(r.chance(0.5) ? { type: 'unplug', cord: 'cord' } : { type: 'plug', cord: 'cord', jack: r.pick(['jack-lamp', 'jack-storefront', null]) });
      }
      w.advance();
      events.push(...w.drainEvents());
    }
    const durable = w.durable();
    w.dispose();
    return { durable, events };
  }

  test('same seed and same intent script: the same durable state and the same event sequence', async () => {
    for (const seed of [1, 7]) {
      const a = await script(seed);
      const b = await script(seed);
      expect(a.events.length).toBeGreaterThan(30);
      expect(b.events).toEqual(a.events);
      expect(b.durable).toEqual(a.durable);
    }
  });
});
