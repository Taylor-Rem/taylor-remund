// P4 D1 round 2: a shipped tool comes back up the chute; the visitor takes it the moment it is out, before it has come
// to rest (so the location it has is still `shipped`), and sets it down; the lever takes that back: it is `shipped`
// again, and the dock brings it back up the chute as it does any shipped tool. Nothing is left behind the door.
import { expect, test } from 'vitest';
import { benchWorld, tape, putOn, onBelt, waitFor, BENCH } from './line-helpers.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';
import type { PartSpec, SceneDesc } from '../../src/workshop/sim/scene.ts';

const TOOL = 'test-wrench';
const spec: PartSpec = { id: TOOL, kind: 'tool', size: 'S', material: 'metal', colour: 'bare', label: '', station: 'line', name: 'name.standin', pose: { p: [-0.4, 0.06, -1.0], q: [0, 0, 0, 1] }, half: [0.18, 0.05, 0.07] };
const SCENE: SceneDesc = { ...BENCH, id: 'bench+tool', parts: [...BENCH.parts, spec] };

test('a tool taken on its way back up the chute and set down, then undone, comes back up the chute again', async () => {
  const w = await benchWorld('dock-tool-undo', { scene: SCENE });
  const t = tape(w);
  t.run(30);
  putOn(w, t, TOOL, onBelt(0.6), 60);
  expect(waitFor(w, t, TOOL, 'shipped', 60 * HZ)).toBe(true);
  // out of the chute: taken at once, before its rest is written
  let out = false;
  for (let i = 0; i < 20 * HZ && !out; i++) {
    t.run(1);
    out = w.mode(TOOL) === 'free';
  }
  expect(out).toBe(true);
  expect(w.part(TOOL)!.location.at).toBe('shipped');
  putOn(w, t, TOOL, [-0.4, 0, -1.0], 30);
  t.run(HZ);
  expect(w.part(TOOL)!.location.at).toBe('rest');
  const top = w.undoStack().at(-1)!;
  expect(top.entries.find((e) => e.target === TOOL && e.field === 'location')?.before).toEqual({ at: 'shipped' });
  w.dispatch({ type: 'undo' });
  t.run(2);
  expect(w.part(TOOL)!.location.at).toBe('shipped');
  expect(w.mode(TOOL)).toBe('gone');
  let back = false;
  for (let i = 0; i < 20 * HZ && !back; i++) {
    t.run(1);
    back = w.mode(TOOL) === 'free' && w.part(TOOL)!.location.at === 'rest';
  }
  expect(back, 'it came back up the chute').toBe(true);
  w.dispose();
}, 120_000);
