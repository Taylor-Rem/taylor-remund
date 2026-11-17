// Real Rapier, headless. Asserted by outcome, not exact position (§ E4 invariant 4).
import { describe, expect, test } from 'vitest';
import { CRATES, line, rapierWorld, run, runUntil, throwPart } from './helpers.ts';
import { steps } from '../../src/workshop/sim/clock.ts';
import type { Vec3 } from '../../src/workshop/sim/types.ts';

const near = (a: Vec3, b: Vec3, d: number): boolean => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= d;

describe('loose parts under Rapier', () => {
  test('the scene starts settled: nothing moves or commits in the first seconds but Fetch', async () => {
    const w = await rapierWorld(1);
    const ev = run(w, steps(3));
    expect(ev.filter((e) => e.type === 'effect')).toEqual([]);
    for (const id of ['crate-1', 'crate-2', 'crate-3']) expect(w.motion(id)?.awake).toBe(false);
  });

  test('three stacked crates stay stacked for 600 steps', async () => {
    const w = await rapierWorld(1);
    const start = ['crate-1', 'crate-2', 'crate-3'].map((id) => w.motion(id)!.pose.p);
    run(w, 600);
    ['crate-1', 'crate-2', 'crate-3'].forEach((id, i) => expect(near(w.motion(id)!.pose.p, start[i]!, 0.01)).toBe(true));
  });

  test('a thrown crate comes to rest on the bench and gets a rest location', async () => {
    const w = await rapierWorld(1);
    run(w, 5);
    const from = w.motion('crate-1')!.pose.p;
    // lift the bottom crate out from under the stack and throw it to the right
    const ev = throwPart(w, 'crate-1', line(from, [-2.7, 2.4, 2.4], 30), [5, 2, 0.5]);
    expect(ev.map((e) => e.type)).toContain('part.released');
    const { steps: took, events } = runUntil(w, (e) => e.some((x) => x.type === 'part.rested' && x.id === 'crate-1'), steps(6));
    expect(took).toBeLessThan(steps(6));
    expect(events.some((e) => e.type === 'part.hit' && e.id === 'crate-1')).toBe(true);
    const loc = w.part('crate-1')!.location;
    expect(loc.at).toBe('rest');
    if (loc.at === 'rest') {
      expect(loc.pose.p[1]).toBeGreaterThan(0.3);
      expect(loc.pose.p[1]).toBeLessThan(0.5);
      expect(loc.pose.p[0]).toBeGreaterThan(-2);
    }
    // the stack it was pulled from came down; once everything settles, every free part is where its location says
    run(w, steps(6));
    for (const id of CRATES) {
      if (w.mode(id) !== 'free') continue;
      const loc = w.part(id)!.location;
      expect(loc.at).toBe('rest');
      if (loc.at === 'rest') expect(near(loc.pose.p, w.motion(id)!.pose.p, 0.02)).toBe(true);
    }
    expect(['crate-2', 'crate-3'].some((id) => w.writer(id, 'location') !== 'settled')).toBe(true);
  });

  test('a crate dropped off the edge returns by the chute and rests on the bench', async () => {
    const w = await rapierWorld(2);
    const from = w.motion('crate-3')!.pose.p;
    throwPart(w, 'crate-3', line(from, [-9.5, 1.5, 4.6], 50), [-3, 0, 1]);
    const { events } = runUntil(w, (e) => e.some((x) => x.type === 'part.rested' && x.id === 'crate-3'), steps(10));
    const kinds = events.filter((e) => 'id' in e && e.id === 'crate-3').map((e) => e.type);
    expect(kinds).toContain('part.returned');
    expect(kinds.indexOf('part.returned')).toBeLessThan(kinds.lastIndexOf('part.rested'));
    const loc = w.part('crate-3')!.location;
    expect(loc.at === 'rest' && loc.pose.p[1] > 0).toBe(true);
    if (loc.at === 'rest') {
      expect(Math.abs(loc.pose.p[0])).toBeLessThan(10);
      expect(Math.abs(loc.pose.p[2])).toBeLessThan(5);
    }
  });

  test('a held crate shoved into the stack never tunnels through the bench, and velocities stay bounded', async () => {
    const w = await rapierWorld(3);
    const from = w.motion('crate-4')!.pose.p;
    w.dispatch({ type: 'grab', id: 'crate-4', grip: from });
    let worstY = Infinity;
    let worstV = 0;
    const path: Vec3[] = [
      ...line(from, [-1.2, 0.3, 0.7], 30),
      ...line([-1.2, 0.3, 0.7], [-3.5, 0.2, 0.7], 20), // through the stack, at the bench
      ...line([-3.5, 0.2, 0.7], [-2.7, -2, 0.7], 20), // and into the bench
      ...line([-2.7, -2, 0.7], [-2.7, 3, 0.7], 10),
    ];
    for (const target of path) {
      w.dispatch({ type: 'carry', target });
      w.advance();
      w.drainEvents();
      for (const p of w.parts()) {
        const m = w.motion(p.id)!;
        worstY = Math.min(worstY, m.pose.p[1]);
        expect(m.pose.p.every(Number.isFinite)).toBe(true);
      }
    }
    w.dispatch({ type: 'release', velocity: [0, 0, 0] });
    for (let i = 0; i < steps(5); i++) {
      w.advance();
      w.drainEvents();
      for (const p of w.parts()) {
        const m = w.motion(p.id)!;
        if (w.mode(p.id) === 'chute') continue;
        worstY = Math.min(worstY, m.pose.p[1]);
        const v = Math.hypot(m.pose.p[0] - m.prev.p[0], m.pose.p[1] - m.prev.p[1], m.pose.p[2] - m.prev.p[2]) * 60;
        worstV = Math.max(worstV, v);
      }
    }
    expect(worstY).toBeGreaterThan(-0.01 + 0.2); // body centres: the smallest crate's centre never sinks below its half height minus a hair
    expect(worstV).toBeLessThan(20);
  });

  test('Fetch fumbles its crate so it stops beside the Button', async () => {
    const w = await rapierWorld(1);
    const { events } = runUntil(w, (e) => e.some((x) => x.type === 'part.rested' && x.id === 'crate-4'), steps(12));
    expect(events.some((e) => e.type === 'crew.state' && e.state === 'fumble')).toBe(true);
    const p = w.motion('crate-4')!.pose.p;
    const b = w.scene.statics.find((s) => s.id === 'button-pedestal')!.pose.p;
    const d = Math.hypot(p[0] - b[0], p[2] - b[2]);
    expect(d).toBeLessThan(1.5);
    expect(d).toBeGreaterThan(0.6); // beside it, not on it
    expect(p[1]).toBeLessThan(0.4);
    expect(w.writer('crate-4', 'location')).toBe('crew');
    // ignored, Fetch fetches it back
    const later = run(w, steps(16));
    expect(later.some((e) => e.type === 'crew.state' && e.state === 'pickup')).toBe(true);
    expect(w.crew('fetch')?.carrying).toBe('crate-4');
  });

  test('picking Fetch up and dropping it: it lands, rights itself and goes back to its lane', async () => {
    const w = await rapierWorld(4);
    run(w, 30);
    const from = w.motion('fetch')!.pose.p;
    throwPart(w, 'fetch', line(from, [2, 2, 3], 30), [1, 0, 1]);
    const { events } = runUntil(w, (e) => e.some((x) => x.type === 'crew.state' && x.state === 'idle'), steps(10));
    expect(events.some((e) => e.type === 'crew.state' && e.state === 'return')).toBe(true);
    expect(w.crew('fetch')?.z).toBeCloseTo(w.scene.runner.lane.a[1], 6);
    expect(w.mode('fetch')).toBe('crew');
  });
});
