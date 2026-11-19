// The Button shoves what is ON the stack at the press, whatever its id (S7 round 2, item 2): a crate of the
// scene's stack list lying elsewhere on the bench is left alone; a crate set on the stack by the visitor is
// the stack. Rung 4 brings down what is on the stack and throws nothing beside it. Stub physics: nothing
// collides, so anything not shoved does not move at all.
import { describe, expect, test } from 'vitest';
import { stubWorld, run } from './helpers.ts';
import type { StubPhysics } from '../../../src/workshop/sim/physics/stub.ts';
import type { World } from '../../../src/workshop/sim/world.ts';
import { bench, AT } from '../../../src/workshop/sim/scenes/bench.ts';
import { qyaw } from '../../../src/workshop/sim/math.ts';
import type { ButtonSaved } from '../../../src/workshop/sim/machines/button.ts';
import type { Id, Pose, SimEvent } from '../../../src/workshop/sim/types.ts';

const { rounds: _rounds, ...quietRunner } = bench.runner;
const quiet = (button?: ButtonSaved) => stubWorld(1, { scene: { ...bench, runner: quietRunner }, button: button as never });

/** The visitor carries `id` and sets it down at (x, y-bottom, z), scripted. */
function setDown(w: World, ph: StubPhysics, id: Id, x: number, bottom: number, z: number): void {
  const m = w.motion(id)!;
  w.dispatch({ type: 'grab', id, grip: m.pose.p });
  run(w, 1);
  ph.land(id, { p: [x, bottom + w.halfExtents(id)![1], z], q: qyaw(0) }, 6);
  w.dispatch({ type: 'release', velocity: [1, 0, 0] });
  run(w, 40);
}
/** Press, and run the rung through: its events, and whether each id ever moved while it played (before the rewind). */
function rung(w: World, watch: readonly Id[]): { ev: SimEvent[]; moved: Set<Id> } {
  const start = new Map<Id, Pose>(watch.map((id) => [id, w.motion(id)!.pose]));
  w.dispatch({ type: 'press', id: 'button' });
  const ev = run(w, 1);
  const moved = new Set<Id>();
  for (let i = 0; i < 2000 && w.bracketed; i++) {
    ev.push(...run(w, 1));
    if (w.button().phase !== 'playing') continue;
    for (const id of watch) {
      const a = start.get(id)!.p;
      const b = w.motion(id)!.pose.p;
      if (Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) > 1e-6) moved.add(id);
    }
  }
  return { ev, moved };
}
const beatIds = (ev: readonly SimEvent[], beat: string): Id[] => ev.flatMap((e) => (e.type === 'rung.beat' && e.beat === beat ? [...e.ids] : []));
const [SX, SZ] = AT.stack;

describe('the Button shoves what is on the stack', () => {
  test('rung 1: a stack crate the visitor has moved to the middle of the bench is left alone; the top of what stands there goes', () => {
    const { world, physics } = quiet();
    run(world, 5);
    setDown(world, physics, 'crate-2', -1, 0, -2.5); // the stack's top crate, off to the middle of the bench
    const { ev, moved } = rung(world, ['crate-2', 'crate-1']);
    expect(beatIds(ev, 'shove')).toEqual(['crate-1']);
    expect(moved.has('crate-2')).toBe(false);
    expect(moved.has('crate-1')).toBe(true);
  });

  test('rung 1: a crate the visitor set on top of the stack is the stack: it is the one shoved', () => {
    const { world, physics } = quiet();
    run(world, 5);
    const top = Math.max(...['crate-1', 'crate-2'].map((id) => world.motion(id)!.pose.p[1] + world.halfExtents(id)![1]));
    setDown(world, physics, 'crate-3', SX, top, SZ);
    const { ev, moved } = rung(world, ['crate-3', 'crate-1', 'crate-2']);
    expect(beatIds(ev, 'shove')).toEqual(['crate-3']);
    expect(moved.has('crate-3')).toBe(true);
    expect(moved.has('crate-2')).toBe(false);
  });

  test('rung 1 with nothing on the stack: nothing is shoved', () => {
    const { world, physics } = quiet();
    run(world, 5);
    setDown(world, physics, 'crate-2', -1, 0, -2.5);
    setDown(world, physics, 'crate-1', 1, 0, -2.5);
    const { ev, moved } = rung(world, ['crate-1', 'crate-2']);
    expect(beatIds(ev, 'shove')).toEqual([]);
    expect(moved.size).toBe(0);
  });

  test('rung 4: what is on the stack comes down; a loose crate a unit away is not thrown', () => {
    const { world, physics } = quiet({ rung: 3, reached: 3, presses: 3, cover: 'none', used: ['belt'] });
    run(world, 5);
    setDown(world, physics, 'crate-3', SX - 1, 0, SZ); // beside the stack, not on it
    const { ev, moved } = rung(world, ['crate-1', 'crate-2', 'crate-3']);
    expect(beatIds(ev, 'stack').sort()).toEqual(['crate-1', 'crate-2']);
    expect(moved.has('crate-3')).toBe(false);
  });
});
