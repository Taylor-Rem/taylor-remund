// PhysicsPort.touching: what a body touches, and the way out of each thing toward the body (the hand reads it so
// as not to press a held thing into a fixed face). The sign is the engine's to get wrong: a normal that pointed INTO
// the other thing would make a held thing cling to every face it left. Held here against plain cases.
import { expect, test } from 'vitest';
import '../../scenario/rapier-node.ts';
import { createRapierPhysics } from '../../../src/workshop/sim/physics/rapier.ts';
import type { Pose } from '../../../src/workshop/sim/types.ts';

const at = (x: number, y: number, z: number): Pose => ({ p: [x, y, z], q: [0, 0, 0, 1] });
const box = (h: [number, number, number]) => ({ type: 'box' as const, half: h });

test('a box at rest on a floor touches the floor, and the way out of the floor is up; pressed against a wall, the way out of the wall is back toward the box', async () => {
  const physics = await createRapierPhysics({ gravity: -16, dt: 1 / 60 });
  physics.addStatic({ id: 'floor', shape: box([5, 0.5, 5]), pose: at(0, -0.5, 0) });
  // a wall to the left of the box (its face at x -1), and one behind it (its face at z -1)
  physics.addStatic({ id: 'wall-left', shape: box([0.5, 2, 5]), pose: at(-1.5, 2, 0) });
  physics.addStatic({ id: 'wall-back', shape: box([5, 2, 0.5]), pose: at(0, 2, -1.5) });
  physics.addBody({ id: 'crate', kind: 'dynamic', shape: box([0.3, 0.3, 0.3]), pose: at(0, 0.32, 0), mass: 1, friction: 0.6, restitution: 0 });
  for (let i = 0; i < 60; i++) physics.step();
  let t = physics.touching('crate');
  expect(t.map((c) => c.other)).toEqual(['floor']);
  expect(t[0]!.normal[1]).toBeGreaterThan(0.99);

  // driven into the left wall
  for (let i = 0; i < 40; i++) {
    physics.setVelocity('crate', [-3, 0, 0], [0, 0, 0]);
    physics.step();
  }
  t = physics.touching('crate');
  const left = t.find((c) => c.other === 'wall-left');
  expect(left, `touching ${t.map((c) => c.other)}`).toBeTruthy();
  expect(left!.normal[0]).toBeGreaterThan(0.99);

  // then into the back wall
  for (let i = 0; i < 40; i++) {
    physics.setVelocity('crate', [0, 0, -3], [0, 0, 0]);
    physics.step();
  }
  t = physics.touching('crate');
  const back = t.find((c) => c.other === 'wall-back');
  expect(back, `touching ${t.map((c) => c.other)}`).toBeTruthy();
  expect(back!.normal[2]).toBeGreaterThan(0.99);

  // and what it does not touch is not listed: lifted clear of everything
  physics.setPose('crate', at(2, 3, 2));
  physics.setVelocity('crate', [0, 0, 0], [0, 0, 0]);
  physics.step();
  expect(physics.touching('crate')).toEqual([]);
  physics.dispose();
});

test('two bodies: each is told the way out of the other', async () => {
  const physics = await createRapierPhysics({ gravity: -16, dt: 1 / 60 });
  physics.addStatic({ id: 'floor', shape: box([5, 0.5, 5]), pose: at(0, -0.5, 0) });
  physics.addBody({ id: 'under', kind: 'dynamic', shape: box([0.3, 0.3, 0.3]), pose: at(0, 0.31, 0), mass: 1, friction: 0.6, restitution: 0 });
  physics.addBody({ id: 'over', kind: 'dynamic', shape: box([0.3, 0.3, 0.3]), pose: at(0, 0.93, 0), mass: 1, friction: 0.6, restitution: 0 });
  for (let i = 0; i < 90; i++) physics.step();
  const up = physics.touching('over').find((c) => c.other === 'under');
  const down = physics.touching('under').find((c) => c.other === 'over');
  expect(up!.normal[1]).toBeGreaterThan(0.99);
  expect(down!.normal[1]).toBeLessThan(-0.99);
  physics.dispose();
});
