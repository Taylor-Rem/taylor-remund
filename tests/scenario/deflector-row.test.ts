// The belt's motor-end deflector with several parts reversed off the back one after another (S7 item 7),
// on the whole bench under real Rapier: each is set down in the next free place at the slide's foot, side
// by side, none on another and none shoved; with the foot full, the next waits at the deflector and the belt
// tells, and goes as soon as a place is free.
import { describe, expect, test } from 'vitest';
import { benchWorld, LINE, onBelt, putOn, tape, waitFor } from './line-helpers.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { BeltView, Vec3 } from '../../src/workshop/sim/types.ts';

/** Two small crates and a medium one: what the foot's row (about 1.8 long between the chute's landing and Fetch's lane) holds side by side. */
const ROW = ['crate-3', 'crate-4', 'crate-2'] as const;

/** Three crates on the belt, then the lever back: run until all are off it, recording where each was set down. */
async function reverseThree(w: World): Promise<{ setDown: Map<string, Vec3>; t: ReturnType<typeof tape> }> {
  const t = tape(w);
  t.run(30);
  w.dispatch({ type: 'turn', id: 'belt-lever', value: 0.5 });
  t.run(1);
  putOn(w, t, 'crate-3', onBelt(0.3));
  expect(waitFor(w, t, 'crate-3', 'in')).toBe(true);
  putOn(w, t, 'crate-4', onBelt(0.45));
  expect(waitFor(w, t, 'crate-4', 'in')).toBe(true);
  putOn(w, t, 'crate-2', onBelt(0.62));
  expect(waitFor(w, t, 'crate-2', 'in')).toBe(true);
  w.dispatch({ type: 'turn', id: 'belt-lever', value: 0 });
  t.run(1);
  const setDown = new Map<string, Vec3>();
  for (let i = 0; i < 16 * HZ && setDown.size < ROW.length; i++) {
    t.run(1);
    const riding = (w.machine('belt') as BeltView).riding;
    for (const id of ROW) if (!setDown.has(id) && !riding.includes(id) && w.mode(id) === 'free') setDown.set(id, w.motion(id)!.pose.p);
  }
  return { setDown, t };
}

describe('the deflector, three parts in a row', () => {
  test('three parts reversed off the back in a row come to rest side by side, none on another, none shoved', async () => {
    const w = await benchWorld('deflector-row');
    const { setDown, t } = await reverseThree(w);
    t.run(3 * HZ);
    expect([...setDown.keys()].sort()).toEqual([...ROW].sort());
    const spot = LINE.belt.offBack;
    for (const id of ROW) {
      const at = setDown.get(id)!;
      const now = w.motion(id)!.pose.p;
      const h = w.halfExtents(id)!;
      expect(w.part(id)!.location.at, id).toBe('rest');
      // on the bench, not on another part: its bottom on the bench top
      expect(Math.abs(now[1] - h[1]), `${id} on the bench (y ${now[1].toFixed(2)})`).toBeLessThan(0.05);
      // at the slide's foot, off the back
      expect(Math.abs(now[2] - spot[2]), id).toBeLessThan(0.1);
      expect(now[2], id).toBeLessThan(LINE.belt.z - LINE.belt.halfWidth);
      // not shoved: where it was set down is where it still is
      expect(Math.hypot(now[0] - at[0], now[2] - at[2]), `${id} shoved from ${at.map((v) => v.toFixed(2))} to ${now.map((v) => v.toFixed(2))}`).toBeLessThan(0.05);
    }
    // side by side: no two footprints overlap
    for (let i = 0; i < ROW.length; i++)
      for (let j = i + 1; j < ROW.length; j++) {
        const [a, b] = [w.motion(ROW[i]!)!.pose.p, w.motion(ROW[j]!)!.pose.p];
        const [ha, hb] = [w.halfExtents(ROW[i]!)!, w.halfExtents(ROW[j]!)!];
        const apart = Math.abs(a[0] - b[0]) >= ha[0] + hb[0] - 1e-3 || Math.abs(a[2] - b[2]) >= ha[2] + hb[2] - 1e-3;
        expect(apart, `${ROW[i]} and ${ROW[j]}`).toBe(true);
      }
    expect((w.machine('belt') as BeltView).riding).toEqual([]);
    w.dispose();
  }, 60_000);

  test('with the foot full the next part waits at the deflector and the belt tells; it goes as soon as there is room', async () => {
    const w = await benchWorld('deflector-full');
    const { setDown, t } = await reverseThree(w);
    expect(setDown.size).toBe(3);
    const rested = new Map(ROW.map((id) => [id, w.motion(id)!.pose.p]));
    // a fourth (the large crate off the stack), reversed: no place for it
    w.dispatch({ type: 'turn', id: 'belt-lever', value: 0.5 });
    t.run(1);
    putOn(w, t, 'crate-1', onBelt(0.4));
    expect(waitFor(w, t, 'crate-1', 'in')).toBe(true);
    w.dispatch({ type: 'turn', id: 'belt-lever', value: 0 });
    const from = t.events.length;
    let waited = 0;
    for (let i = 0; i < 6 * HZ; i++) {
      t.run(1);
      if ((w.machine('belt') as BeltView).waiting === 'crate-1') waited++;
    }
    expect(waited).toBeGreaterThan(2 * HZ);
    expect(w.mode('crate-1')).toBe('machine'); // still the belt's, held at the deflector
    expect(Math.abs(w.motion('crate-1')!.pose.p[2] - LINE.belt.z)).toBeLessThan(0.01); // on the belt, at the deflector
    expect(t.events.slice(from).filter((x) => x.e.type === 'tell' && x.e.id === 'belt')).toHaveLength(1); // told once
    for (const id of ROW) expect(Math.hypot(w.motion(id)!.pose.p[0] - rested.get(id)![0], w.motion(id)!.pose.p[2] - rested.get(id)![2]), id).toBeLessThan(0.05);
    // the visitor clears the foot's right end: it goes
    putOn(w, t, 'crate-2', [2, 0, -1]);
    putOn(w, t, 'crate-4', [3.2, 0, -1]);
    let off: Vec3 | null = null;
    for (let i = 0; i < 4 * HZ && !off; i++) {
      t.run(1);
      if (w.mode('crate-1') === 'free') off = w.motion('crate-1')!.pose.p;
    }
    expect(off).not.toBeNull();
    expect((w.machine('belt') as BeltView).waiting).toBeNull();
    t.run(2 * HZ);
    const p = w.motion('crate-1')!.pose.p;
    expect(Math.abs(p[1] - w.halfExtents('crate-1')![1])).toBeLessThan(0.05); // on the bench
    expect(Math.abs(p[2] - LINE.belt.offBack[2])).toBeLessThan(0.1);
    const c3 = w.motion('crate-3')!.pose.p;
    expect(Math.hypot(c3[0] - rested.get('crate-3')![0], c3[2] - rested.get('crate-3')![2])).toBeLessThan(0.05); // its neighbour not shoved
    w.dispose();
  }, 90_000);
});
