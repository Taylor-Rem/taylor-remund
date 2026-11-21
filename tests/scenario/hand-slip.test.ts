// A thing in the hand has no grip on what it touches (world.ts `setMode`, PhysicsPort.setSlip).
//
// Found on the page, 2026-11-21: carried from the stack toward the left of the bench, a crate went over the console
// and into the side of the UNDO lever's housing, and stayed there while the pointer went on round the corner (one run
// in four of a juggling test's carry to its place; in another the crate came free late and ended two units off).
// The hand was pulling it mostly INTO the face, and the face's push back, times the crate's grip, was more than the
// sideways pull: its own friction held it to the face. In the hand it slides; let go, it has its grip again.
import { expect, test } from 'vitest';
import { benchWorld, tape } from './line-helpers.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';
import type { Vec3 } from '../../src/workshop/sim/types.ts';
import type { World } from '../../src/workshop/sim/world.ts';

const at = (w: World): Vec3 => w.motion('crate-2')!.pose.p;

/** Take crate-2 off the stack and carry it over the console to beside the housing's right face (x -1.71). */
function toTheHousing(w: World, t: ReturnType<typeof tape>): Vec3 {
  const from = at(w);
  w.dispatch({ type: 'grab', id: 'crate-2', grip: from });
  let p = from;
  for (const q of [[from[0], 2.2, from[2]], [0.3, 2.2, 0.6], [-1.2, 1.74, 0.1]] as Vec3[]) {
    for (let i = 1; i <= 40; i++) {
      w.dispatch({ type: 'carry', target: [p[0] + ((q[0] - p[0]) * i) / 40, p[1] + ((q[1] - p[1]) * i) / 40, p[2] + ((q[2] - p[2]) * i) / 40] });
      t.run(1);
    }
    p = q;
  }
  for (let i = 0; i < 20; i++) {
    w.dispatch({ type: 'carry', target: p });
    t.run(1);
  }
  return p;
}

test('pressed against a machine\'s face on its way to the hand, a held thing slides along the face and round it; it is not held there by its own grip', async () => {
  // the hand is four and a half units through the face, a unit toward the visitor and above the housing's top (1.97):
  // the way there is up the face and over
  for (const [name, hand] of [['over the top and in front', [-6, 2.4, 1.2]], ['round the back', [-6, 1.74, -1.5]]] as const) {
    const w = await benchWorld('hand-slip');
    const t = tape(w);
    t.run(30);
    toTheHousing(w, t);
    expect(at(w)[0], `${name}: it starts against the housing's side`).toBeGreaterThan(-1.71);
    let reached = -1;
    for (let i = 1; i <= 2 * HZ && reached < 0; i++) {
      w.dispatch({ type: 'carry', target: hand as unknown as Vec3 });
      t.run(1);
      const p = at(w);
      if (Math.hypot(p[0] - hand[0], p[1] - hand[1], p[2] - hand[2]) < 0.1) reached = i;
    }
    expect(reached, `${name}: it came to the hand (it is at ${at(w).map((n) => n.toFixed(2))})`).toBeGreaterThan(0);
    expect(reached / HZ, `${name}: in under a second`).toBeLessThan(1);
    w.dispose();
  }
});

test('the hand straight through a face holds it against the face, still: it does not creep along it', async () => {
  const w = await benchWorld('hand-slip');
  const t = tape(w);
  t.run(30);
  toTheHousing(w, t);
  const hand: Vec3 = [-6, 1.74, 0.1];
  for (let i = 0; i < 30; i++) {
    w.dispatch({ type: 'carry', target: hand });
    t.run(1);
  }
  const a = at(w);
  for (let i = 0; i < 60; i++) {
    w.dispatch({ type: 'carry', target: hand });
    t.run(1);
  }
  const b = at(w);
  expect(b[0], 'against the face, not through it').toBeGreaterThan(-1.71);
  expect(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), 'still').toBeLessThan(0.03);
  w.dispose();
});

test('let go, it has its grip again: slid along the bench it stops', async () => {
  const w = await benchWorld('hand-slip');
  const t = tape(w);
  t.run(30);
  const from = at(w);
  w.dispatch({ type: 'grab', id: 'crate-2', grip: from });
  // over the open bench at the left, low
  const to: Vec3 = [-7, 0.75, -1.8];
  for (let i = 1; i <= 90; i++) {
    const k = i / 90;
    w.dispatch({ type: 'carry', target: [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k + 1.4 * Math.sin(Math.PI * k), from[2] + (to[2] - from[2]) * k] });
    t.run(1);
  }
  for (let i = 0; i < 20; i++) {
    w.dispatch({ type: 'carry', target: to });
    t.run(1);
  }
  const start = at(w);
  w.dispatch({ type: 'release', velocity: [5, 0, 0] });
  let still = 0;
  for (let i = 0; i < 6 * HZ && still < 20; i++) {
    t.run(1);
    const m = w.motion('crate-2')!;
    still = Math.hypot(m.pose.p[0] - m.prev.p[0], m.pose.p[2] - m.prev.p[2]) * HZ < 0.05 ? still + 1 : 0;
  }
  expect(still, 'it came to rest').toBeGreaterThanOrEqual(20);
  // (with no grip it would slide the length of the bench: 5 a second for as long as there is bench)
  expect(at(w)[0] - start[0], `it went ${(at(w)[0] - start[0]).toFixed(2)}`).toBeLessThan(4);
  expect(at(w)[0] - start[0]).toBeGreaterThan(0.5);
  w.dispose();
});
