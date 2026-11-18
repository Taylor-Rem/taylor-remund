// REWRITE.md § E8 "rung 4 leaves the bench as it was", under real Rapier on the whole bench (S4): a bench
// the fuzz has messed up first (throws, parts on the belt and the ramp, the handles, the cord, the lever,
// Revert picked up and thrown), then the works: every used station misfires, the stack comes down, and
// the whole bench runs backwards. After it: every durable field and its writer, the undo stack, and every
// body's pose and mode are what they were at the press.
import { describe, expect, test } from 'vitest';
import { benchWorld, onBelt, tape, LINE } from './line-helpers.ts';
import { line, throwPart } from './helpers.ts';
import { rng } from '../../src/workshop/sim/rng.ts';
import { steps } from '../../src/workshop/sim/clock.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { ButtonSaved } from '../../src/workshop/sim/machines/button.ts';
import type { BodyMode, Pose, SimEvent, Vec3 } from '../../src/workshop/sim/types.ts';

const LOOSE = ['crate-1', 'crate-2', 'crate-3', 'crate-4', 'fetch', 'revert'] as const;
/** Saved at rung 3 with every station used: the next press is the works, and everything misfires. */
const AT_THE_WORKS: ButtonSaved = { rung: 3, reached: 3, presses: 3, cover: 'none', used: ['belt', 'striker', 'dock', 'chute', 'cord', 'undo-lever', 'lamp'] };

const bodies = (w: World): Map<string, { pose: Pose; mode: BodyMode }> => new Map([...w.parts()].map((p) => [p.id, { pose: w.motion(p.id)!.pose, mode: w.motion(p.id)!.mode }]));

/** Seeded mess, leaving things wherever they are (some still moving, some riding the belt). */
function mess(w: World, seed: number): void {
  const r = rng(`rung4-mess-${seed}`);
  const t = tape(w);
  const n = 3 + r.int(5);
  for (let k = 0; k < n; k++) {
    const roll = r.int(8);
    const free = LOOSE.filter((id) => w.mode(id) === 'free' || (w.mode(id) === 'crew' && id !== 'revert') || (id === 'revert' && w.mode(id) === 'crew'));
    if (roll <= 2 && free.length) {
      const id = r.pick(free);
      const from = w.motion(id)!.pose.p;
      const to: Vec3 = roll === 0 ? [onBelt(r.range(0.1, 0.7))[0], 1.4, LINE.belt.z] : [r.range(-7, 6), r.range(0.8, 2.4), r.range(-3.5, 3.5)];
      throwPart(w, id, line(from, to, 15 + r.int(20)), roll === 0 ? [0, -0.5, 0] : [r.range(-5, 5), r.range(-1, 3), r.range(-5, 5)]);
    } else if (roll === 3) w.dispatch({ type: 'turn', id: 'belt-dial', value: r.next() });
    else if (roll === 4) w.dispatch({ type: 'turn', id: 'belt-lever', value: r.chance(0.7) ? 1 : r.next() });
    else if (roll === 5) {
      w.dispatch({ type: 'unplug', cord: 'cord' });
      t.run(3);
      w.dispatch({ type: 'plug', cord: 'cord', jack: r.pick(['jack-lamp', 'jack-storefront']) });
    } else if (roll === 6) w.dispatch({ type: 'press', id: 'undo-lever' });
    else w.dispatch({ type: 'undo' });
    t.run(r.int(steps(2.5)) + 1);
  }
  // let any hand go
  if (w.holding()) w.dispatch({ type: 'release', velocity: [0, 0, 0] });
  t.run(1);
}

describe('rung 4 leaves the bench as it was', () => {
  test('over 12 seeds of a messed-up bench: every durable field, every writer, the undo stack, every pose within tolerance', async () => {
    let cameDown = 0;
    let revertUp = 0;
    for (let seed = 0; seed < 12; seed++) {
      const w = await benchWorld(`rung4-${seed}`, { button: AT_THE_WORKS as { rung: number; presses: number } });
      tape(w).run(5);
      mess(w, seed);
      if (w.mode('revert') === 'crew') revertUp++;
      const durable = w.durable();
      const stack = w.undoStack();
      const before = bodies(w);
      const top = ['crate-1', 'crate-2', 'crate-3'].map((id) => w.motion(id)!.pose.p);
      w.dispatch({ type: 'press', id: 'button' });
      const ev: SimEvent[] = [];
      let moved = 0;
      let ended = false;
      for (let i = 0; i < steps(12) && !ended; i++) {
        w.advance();
        const step = w.drainEvents();
        ev.push(...step);
        ended = step.some((e) => e.type === 'rung.ended');
        ['crate-1', 'crate-2', 'crate-3'].forEach((id, k) => {
          const p = w.motion(id)!.pose.p;
          moved = Math.max(moved, Math.hypot(p[0] - top[k]![0], p[2] - top[k]![2]));
        });
      }
      const label = `seed ${seed}`;
      expect(ended, label).toBe(true);
      expect(w.bracketed, label).toBe(false);
      expect(w.button().rung, label).toBe(4);
      // every used station misfired, harder; the stack came down (a stack that was already scattered may not)
      const fired = ev.flatMap((e) => (e.type === 'misfire' && e.level === 2 ? [e.id] : []));
      for (const id of ['lamp', 'belt', 'striker', 'dock', 'chute', 'cord', 'undo-lever']) expect(fired, `${label}: ${id}`).toContain(id);
      if (moved > 0.5) cameDown++;
      expect(ev.filter((e) => e.type === 'effect'), label).toEqual([]);
      // the bench as it was, at the step the rung ends
      expect(w.durable(), label).toEqual(durable);
      expect(w.undoStack(), label).toEqual(stack);
      for (const [id, b] of bodies(w)) {
        const a = before.get(id)!;
        expect(b.mode, `${label}: ${id} mode`).toBe(a.mode);
        for (let k = 0; k < 3; k++) expect(Math.abs(b.pose.p[k]! - a.pose.p[k]!), `${label}: ${id} p`).toBeLessThan(1e-6);
        for (let k = 0; k < 4; k++) expect(Math.abs(b.pose.q[k]! - a.pose.q[k]!), `${label}: ${id} q`).toBeLessThan(1e-6);
      }
      expect(ev).toContainEqual({ type: 'card', by: 'revert', content: 'card.rung4' });
      w.dispose();
    }
    // it is not vacuous: the stack really comes down in most, and Revert was up for some
    expect(cameDown).toBeGreaterThan(6);
    expect(revertUp).toBeGreaterThan(0);
  }, 120_000);

  test('the bench carries on after the works as it would have: a crate riding the belt arrives where its twin does', async () => {
    const a = await benchWorld('rung4-twin', { button: AT_THE_WORKS as { rung: number; presses: number } });
    const b = await benchWorld('rung4-twin', { button: AT_THE_WORKS as { rung: number; presses: number } });
    for (const w of [a, b]) {
      const t = tape(w);
      t.run(5);
      throwPart(w, 'crate-2', line(w.motion('crate-2')!.pose.p, [onBelt(0.2)[0], 1.3, LINE.belt.z], 25), [0, -0.5, 0]);
      t.run(steps(2));
    }
    a.dispatch({ type: 'press', id: 'button' });
    while (tape(a).run(1) && a.bracketed);
    tape(a).run(steps(2));
    tape(b).run(steps(2));
    const pa = a.motion('crate-2')!.pose.p;
    const pb = b.motion('crate-2')!.pose.p;
    expect(Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2])).toBeLessThan(1e-3);
    expect(a.part('crate-2')!.location).toEqual(b.part('crate-2')!.location);
  }, 60_000);
});
