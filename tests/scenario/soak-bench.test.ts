// The soak (REWRITE.md § E8) on the whole bench with the belt running, under real Rapier: seeded grabbing,
// throwing, putting things on the belt and the ramp, the handles, the lever and the Button. Nothing
// leaves the bench for good, the part count never runs away, and after "Reset the workshop" every
// machine goes back to idle.
import { expect, test } from 'vitest';
import { benchWorld, FULL_BENCH, LINE, onBelt } from './line-helpers.ts';
import { rng } from '../../src/workshop/sim/rng.ts';
import { steps } from '../../src/workshop/sim/clock.ts';
import type { BeltView, ChuteView, DockView, Vec3 } from '../../src/workshop/sim/types.ts';

const MINUTES = 10;

test(`soak: ${MINUTES} simulated minutes on the bench with the belt running`, { timeout: 180_000 }, async () => {
  const w = await benchWorld('soak-bench', { scene: FULL_BENCH }); // the whole bench: Fetch's rounds run too
  const r = rng('soak-bench-script');
  const ids = ['crate-1', 'crate-2', 'crate-3', 'crate-4', 'fetch', 'crate-spare-1', 'crate-spare-2', 'crate-spare-3'];
  const count = [...w.parts()].length;
  const b = w.scene.bench;
  const seen = { shipped: 0, struck: 0, returned: 0, restocked: 0, undone: 0, rungs: 0, takenIn: 0, grabbed: 0, stoppedSteps: 0 };

  // a part crosses each machine's mouth once per ride: once it leaves the belt it is not taken back onto
  // it within a second unless a hand (the visitor's, or an undo) put it there
  let riding = new Set<string>();
  const left = new Map<string, number>();
  const retakes: string[] = [];
  const step = (): void => {
    w.advance();
    if (w.setting('belt', 'running') === false) seen.stoppedSteps++;
    const evs = w.drainEvents();
    for (const e of evs) if (e.type === 'part.grabbed' || e.type === 'undone' || e.type === 'reset') left.clear();
    const now = new Set((w.machine('belt') as BeltView).riding);
    for (const id of riding) if (!now.has(id)) left.set(id, w.step);
    for (const id of now) if (!riding.has(id) && left.has(id) && w.step - left.get(id)! < 60) retakes.push(`${id}@${w.step}`);
    riding = now;
    for (const e of evs) {
      if (e.type === 'shipped') seen.shipped++;
      if (e.type === 'struck' && e.part) seen.struck++;
      if (e.type === 'part.returned') seen.returned++;
      if (e.type === 'restocked') seen.restocked++;
      if (e.type === 'undone') seen.undone++;
      if (e.type === 'rung.started') seen.rungs++;
      if (e.type === 'taken-in') seen.takenIn++;
      if (e.type === 'part.grabbed') seen.grabbed++;
    }
  };
  const check = (): void => {
    expect([...w.parts()].length).toBe(count);
    for (const p of w.parts()) {
      const m = w.motion(p.id)!;
      expect(m.pose.p.every(Number.isFinite) && m.pose.q.every(Number.isFinite), p.id).toBe(true);
      if (m.mode === 'gone' || m.mode === 'chute') continue;
      const pos = m.pose.p;
      // on the bench (a part on its way down is allowed below it only while it falls: the chute takes it)
      // no part at rest below the bench top inside its footprint (the edge sends it back by the chute)
      const inFoot = pos[0] >= b.minX && pos[0] <= b.maxX && pos[2] >= b.minZ && pos[2] <= b.maxZ;
      if ((m.mode === 'free' && !m.awake) || m.mode === 'held') expect(!inFoot || pos[1] > b.top, `${p.id} below the bench top at step ${w.step}: ${pos.join(', ')}`).toBe(true);
      if (m.mode !== 'free' || !m.awake) expect(pos[0] >= b.minX - 0.01 && pos[0] <= b.maxX + 0.01 && pos[2] >= b.minZ - 0.01 && pos[2] <= b.maxZ + 0.01 && pos[1] > -0.05 && pos[1] < b.ceiling, `${p.id} outside the bench at step ${w.step}: ${pos.join(', ')}`).toBe(true);
    }
  };

  while (w.step < steps(MINUTES * 60)) {
    const k = r.int(20);
    const avail = ids.filter((id) => ['free', 'crew', 'machine'].includes(w.mode(id) ?? ''));
    if (k < 13 && avail.length) {
      const id = r.pick(avail);
      const m = w.motion(id)!;
      w.dispatch({ type: 'grab', id, grip: m.pose.p });
      const roll = r.next();
      const to: Vec3 = roll < 0.4 ? onBelt(r.range(0.05, 0.9), r.range(-0.2, 0.2)) : roll < 0.5 ? [LINE.ramp.start[0] + 0.3, 0.6, LINE.ramp.start[2]] : roll < 0.6 ? [r.pick([-1, 1]) * r.range(9, 11), r.range(0.5, 2), r.range(-4, 5.5)] : [r.range(-7, 7), r.range(0.4, 2.8), r.range(-4, 4)];
      const lift: Vec3 = [to[0], to[1] + 1.2, to[2]];
      const n = 10 + r.int(50);
      for (let i = 1; i <= n; i++) {
        const f = i / n;
        w.dispatch({ type: 'carry', target: [m.pose.p[0] + (lift[0] - m.pose.p[0]) * f, m.pose.p[1] + 1 + (lift[1] - m.pose.p[1] - 1) * f, m.pose.p[2] + (lift[2] - m.pose.p[2]) * f] });
        step();
      }
      w.dispatch({ type: 'release', velocity: roll < 0.5 ? [0, 0, 0] : [r.range(-8, 8), r.range(-2, 4), r.range(-8, 8)] });
    } else if (k < 15) {
      // the dial anywhere; the lever mostly back to forward (a stopped belt soaks nothing)
      if (r.chance(0.5)) w.dispatch({ type: 'turn', id: 'belt-dial', value: r.next() });
      else w.dispatch({ type: 'turn', id: 'belt-lever', value: r.chance(0.75) ? 1 : r.next() });
    } else if (k < 17) {
      w.dispatch({ type: 'undo' });
    } else {
      w.dispatch({ type: 'press', id: 'button' });
    }
    step();
    const wait = r.chance(0.6) ? steps(4) : r.int(steps(1.2));
    for (let i = 0; i < wait && w.step < steps(MINUTES * 60); i++) step();
    check();
  }

  // reset: every machine back to idle, every part back where the visit began
  while (w.bracketed) step();
  w.dispatch({ type: 'reset' });
  for (let i = 0; i < steps(8); i++) step();
  check();
  expect((w.machine('belt') as BeltView).riding).toEqual([]);
  expect((w.machine('dock') as DockView).shipping).toEqual([]);
  expect((w.machine('dock') as DockView).door).toBe(0);
  expect((w.machine('chute') as ChuteView).waiting).toBe(0);
  expect(w.undoStack()).toEqual([]);
  for (const p of w.parts()) expect(p.location.at === 'rest' || (p.location.at === 'shipped' && p.id.startsWith('crate-spare')), `${p.id}: ${p.location.at}`).toBe(true);
  console.log(`soak-bench: ${JSON.stringify(seen)} over ${w.step} steps; retakes ${retakes.join(' ')}`);
  expect(retakes).toEqual([]);
  expect(seen.shipped).toBeGreaterThan(5);
  expect(seen.struck).toBeGreaterThan(5);
  expect(seen.returned).toBeGreaterThan(3);
  w.dispose();
});
