// motion(id).prev / .pose, the view's interpolation pair, under real Rapier:
// continuous across normal steps, backwards through a rung's rewind, and never across a teleport.
import { describe, expect, test } from 'vitest';
import { line, rapierWorld, throwPart } from './helpers.ts';
import { steps } from '../../src/workshop/sim/clock.ts';
import type { Pose, SimEvent } from '../../src/workshop/sim/types.ts';
import type { World } from '../../src/workshop/sim/world.ts';

const same = (a: Pose, b: Pose): boolean => a.p.every((x, i) => x === b.p[i]) && a.q.every((x, i) => x === b.q[i]);
const ids = (w: World): string[] => [...w.parts()].map((p) => p.id);

/** Step once; check every part's prev is the pose it had after the last step. */
function stepChecked(w: World, last: Map<string, Pose>): SimEvent[] {
  w.advance();
  const ev = w.drainEvents();
  for (const id of ids(w)) {
    const m = w.motion(id)!;
    const before = last.get(id)!;
    expect(same(m.prev, before) || same(m.prev, m.pose), `${id} at step ${w.step}: prev is neither the last pose nor the current one`).toBe(true);
    last.set(id, m.pose);
  }
  return ev;
}

const snapshot = (w: World): Map<string, Pose> => new Map(ids(w).map((id) => [id, w.motion(id)!.pose]));

describe('motion: prev and pose for interpolation', () => {
  test('(a) normal steps: prev is exactly the previous step\'s pose', async () => {
    const w = await rapierWorld(5);
    const last = snapshot(w);
    throwPart(w, 'crate-2', line(w.motion('crate-2')!.pose.p, [1, 2, 2], 20), [3, 2, 0]);
    for (const id of ids(w)) last.set(id, w.motion(id)!.pose);
    let moving = 0;
    for (let i = 0; i < steps(3); i++) {
      w.advance();
      w.drainEvents();
      for (const id of ids(w)) {
        const m = w.motion(id)!;
        expect(same(m.prev, last.get(id)!)).toBe(true);
        if (!same(m.prev, m.pose)) moving++;
        expect(m.mode).toBe(w.mode(id));
        last.set(id, m.pose);
      }
    }
    expect(moving).toBeGreaterThan(60);
  });

  test('(b) a rung: the rewind plays the recording backwards, with prev trailing pose, and ends exactly where it began', async () => {
    const w = await rapierWorld(6);
    const last = snapshot(w);
    stepChecked(w, last);
    const start = snapshot(w);
    w.dispatch({ type: 'press', id: 'button' });
    const recorded: Pose[] = []; // crate-3 (the shoved one) each step while the rung plays
    let rewinding = false;
    const rewound: { prev: Pose; pose: Pose }[] = [];
    for (let i = 0; i < steps(6) && (i === 0 || w.bracketed); i++) {
      const ev = stepChecked(w, last);
      if (ev.some((e) => e.type === 'rung.rewinding')) rewinding = true;
      const m = w.motion('crate-3')!;
      if (rewinding) rewound.push({ prev: m.prev, pose: m.pose });
      else recorded.push(m.pose);
    }
    expect(w.bracketed).toBe(false);
    expect(rewound.length).toBe(steps(1.2));
    // every rewind pose is a recorded pose (or the pose at the press), and they run backwards in time
    const frames = [start.get('crate-3')!, ...recorded];
    let lastIdx = Infinity;
    let distinct = 0;
    for (const r of rewound) {
      const idx = frames.findIndex((f) => same(f, r.pose));
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThanOrEqual(lastIdx);
      if (idx < lastIdx) distinct++;
      lastIdx = idx;
    }
    expect(lastIdx).toBe(0);
    expect(distinct).toBeGreaterThan(30);
    // the shove really moved it, and the last rewind step still interpolates into the restored pose
    expect(Math.max(...recorded.map((p) => Math.hypot(p.p[0] - frames[0]!.p[0], p.p[2] - frames[0]!.p[2])))).toBeGreaterThan(0.3);
    for (const id of ids(w)) expect(same(w.motion(id)!.pose, start.get(id)!)).toBe(true);
  });

  test('(c) a chute return: no interpolation across the teleport', async () => {
    const w = await rapierWorld(7);
    throwPart(w, 'crate-3', line(w.motion('crate-3')!.pose.p, [-9.6, 1.5, 4.6], 40), [-3, 0, 1]);
    const last = snapshot(w);
    let seen = false;
    for (let i = 0; i < steps(6) && !seen; i++) {
      const ev = stepChecked(w, last);
      if (ev.some((e) => e.type === 'part.returned' && e.id === 'crate-3')) {
        seen = true;
        const m = w.motion('crate-3')!;
        expect(same(m.prev, m.pose)).toBe(true);
        expect(m.mode).toBe('free');
        expect(m.pose.p).toEqual(w.scene.chute.pose.p);
        // the next step interpolates normally from the chute mouth
        const before = m.pose;
        w.advance();
        w.drainEvents();
        expect(same(w.motion('crate-3')!.prev, before)).toBe(true);
      } else if (w.mode('crate-3') === 'chute') {
        expect(w.motion('crate-3')!.mode).toBe('chute');
      }
    }
    expect(seen).toBe(true);
  });
});
