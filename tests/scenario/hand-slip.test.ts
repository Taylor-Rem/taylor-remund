// A thing in the hand is not pressed into a fixed face it touches (world.ts `driveHeld`, `carryPress`).
//
// Found on the page, 2026-11-21: carried from the stack toward the left of the bench, a crate went over the console
// and into the side of the UNDO lever's housing, and stayed there while the pointer went on round the corner (one run
// in four of a juggling test's carry to its place; in another the crate came free late and ended two units off).
// The hand was pulling it mostly INTO the face, and the face's push back, times the crate's grip, was more than the
// sideways pull: its own friction held it to the face. Now only a light press of its way into a fixed thing is kept
// and the rest runs along the face. (The first fix took its grip away while it was held. That let go of everything
// resting ON a held thing too: the crate on top of one being carried slid off it. Its grip is its own.)
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

test('the hand straight through the housing: it comes round to the hand, and at no step is it inside the housing', async () => {
  const w = await benchWorld('hand-slip');
  const t = tape(w);
  t.run(30);
  toTheHousing(w, t);
  const undo = w.scene.statics.find((x) => x.id === 'undo')!;
  const half = (undo.shape as { half: Vec3 }).half;
  const hand: Vec3 = [-6, 1.74, 0.1];
  let reached = -1;
  for (let i = 1; i <= 2 * HZ; i++) {
    w.dispatch({ type: 'carry', target: hand });
    t.run(1);
    const p = at(w);
    // (its middle never within the housing's body: 0.2 inside any face of it, under its top)
    const inside = Math.abs(p[0] - undo.pose.p[0]) < half[0] - 0.2 && Math.abs(p[2] - undo.pose.p[2]) < half[2] - 0.2 && p[1] < undo.pose.p[1] + half[1];
    expect(inside, `step ${i}: at ${p.map((n) => n.toFixed(2))}`).toBe(false);
    if (reached < 0 && Math.hypot(p[0] - hand[0], p[1] - hand[1], p[2] - hand[2]) < 0.1) reached = i;
  }
  expect(reached, `it came to the hand (it is at ${at(w).map((n) => n.toFixed(2))})`).toBeGreaterThan(0);
  w.dispose();
});

// The crate that sits on a held crate goes where it goes (carrying a stack by its bottom crate). This is what the
// first fix for the above broke, and a test of Fetch's knock (which throws the middle of the stack) caught it.
test('what rests on a held thing rides on it', async () => {
  const w = await benchWorld('hand-slip');
  const t = tape(w);
  t.run(30);
  // crate-2 sits on crate-1 at the stack
  const lower = w.motion('crate-1')!.pose.p;
  const upper0 = at(w);
  expect(upper0[1], 'crate-2 is on crate-1').toBeGreaterThan(lower[1] + 0.3);
  expect(Math.hypot(upper0[0] - lower[0], upper0[2] - lower[2])).toBeLessThan(0.2);
  w.dispatch({ type: 'grab', id: 'crate-1', grip: lower });
  // lifted, and carried over the open bench beside the stack at a walking pace (1.3 units in under a second), and
  // held there
  const to: Vec3 = [lower[0] - 1.2, lower[1] + 0.6, lower[2] + 0.4];
  for (let i = 1; i <= 50; i++) {
    const k = i / 50;
    const e = k * k * (3 - 2 * k);
    w.dispatch({ type: 'carry', target: [lower[0] + (to[0] - lower[0]) * e, lower[1] + (to[1] - lower[1]) * e, lower[2] + (to[2] - lower[2]) * e] });
    t.run(1);
  }
  for (let i = 0; i < 40; i++) {
    w.dispatch({ type: 'carry', target: to });
    t.run(1);
  }
  const held = w.motion('crate-1')!.pose.p;
  const on = at(w);
  expect(on[1], `crate-2 is still on it (crate-1 at ${held.map((n) => n.toFixed(2))}, crate-2 at ${on.map((n) => n.toFixed(2))})`).toBeGreaterThan(held[1] + 0.3);
  expect(Math.hypot(on[0] - held[0], on[2] - held[2]), 'over it').toBeLessThan(0.3);
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
