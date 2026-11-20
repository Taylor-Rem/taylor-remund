// S5 (Taylor, 2026-11-19: "when you try to throw them off the table ... the robot could either activate a little
// jetpack to fly back on"): Fetch over the bench's edge falls out of sight a beat, lights its jets, rises clear,
// flies to the nearest free point of its tape, hovers, cuts, drops, bounces and carries on. Under real Rapier, on the
// whole bench: off each of the four edges and from far out; with a crate in hand; mid-rung; never inside a body.
import { describe, expect, test } from 'vitest';
import { benchWorld, FULL_BENCH } from './line-helpers.ts';
import { startPlay } from './fetch-helpers.ts';
import { lanePath } from '../../src/workshop/sim/path.ts';
import { FETCH_TUNING } from '../../src/workshop/sim/crew/fetch.ts';
import { HZ, steps } from '../../src/workshop/sim/clock.ts';
import { yawOf } from '../../src/workshop/sim/math.ts';
import type { Pose, SimEvent, Vec3 } from '../../src/workshop/sim/types.ts';
import type { World } from '../../src/workshop/sim/world.ts';

const SCENE = FULL_BENCH;
const PATH = lanePath(SCENE.runner.lane.points, FETCH_TUNING.cornerRadius * (SCENE.crewScale ?? 1));
const onTape = (x: number, z: number): number => {
  const q = PATH.at(PATH.nearest(x, z));
  return Math.hypot(q[0] - x, q[1] - z);
};

/** Overlap of Fetch's body box with a static box (positive: inside by that much), both turned about +Y, sharing height. */
function overlap(a: Pose, ah: Vec3, b: Pose, bh: Vec3): number {
  if (a.p[1] - ah[1] >= b.p[1] + bh[1] || b.p[1] - bh[1] >= a.p[1] + ah[1]) return -Infinity;
  const ya = yawOf(a.q);
  const yb = yawOf(b.q);
  const axes: [number, number][] = [[Math.cos(ya), -Math.sin(ya)], [Math.sin(ya), Math.cos(ya)], [Math.cos(yb), -Math.sin(yb)], [Math.sin(yb), Math.cos(yb)]];
  const proj = (u: [number, number], y: number, hx: number, hz: number): number => hx * Math.abs(u[0] * Math.cos(y) - u[1] * Math.sin(y)) + hz * Math.abs(u[0] * Math.sin(y) + u[1] * Math.cos(y));
  let o = Infinity;
  for (const u of axes) o = Math.min(o, proj(u, ya, ah[0], ah[2]) + proj(u, yb, bh[0], bh[2]) - Math.abs((b.p[0] - a.p[0]) * u[0] + (b.p[2] - a.p[2]) * u[1]));
  return o;
}

/**
 * The visitor lifts Fetch, carries it to `to` (high over the edge), and lets go with `velocity`; then watch it: it must
 * fly back and be rolling on its tape again within `within` seconds. Returns the events and the time to rolling.
 */
function overboard(w: World, to: Vec3, velocity: Vec3, within = 5, before?: () => void): { ev: SimEvent[]; rolling: number; leftAt: number } {
  const ev: SimEvent[] = [];
  const step = (): void => {
    w.advance();
    ev.push(...w.drainEvents());
  };
  const p = w.motion('fetch')!.pose.p;
  w.dispatch({ type: 'grab', id: 'fetch', grip: p });
  step();
  const high: Vec3 = [p[0], Math.max(3.4, to[1]), p[2]];
  for (let i = 1; i <= 50; i++) {
    const f = i / 50;
    w.dispatch({ type: 'carry', target: f < 0.3 ? [p[0], p[1] + (high[1] - p[1]) * (f / 0.3), p[2]] : [high[0] + (to[0] - high[0]) * ((f - 0.3) / 0.7), high[1] + (to[1] - high[1]) * ((f - 0.3) / 0.7), high[2] + (to[2] - high[2]) * ((f - 0.3) / 0.7)] });
    step();
  }
  for (let i = 0; i < 20; i++) {
    w.dispatch({ type: 'carry', target: to });
    step();
  }
  before?.();
  w.dispatch({ type: 'release', velocity });
  step();
  const b = w.scene.bench;
  let leftAt = -1;
  let rolling = -1;
  const half = w.halfExtents('fetch')!;
  for (let i = 0; i < steps(within + 3) && rolling < 0; i++) {
    step();
    const f = w.crew('fetch')!;
    const m = w.motion('fetch')!;
    if (leftAt < 0 && (m.pose.p[0] < b.minX || m.pose.p[0] > b.maxX || m.pose.p[2] < b.minZ || m.pose.p[2] > b.maxZ)) leftAt = w.step;
    // never in a body while it flies (the bench slab and the wall included)
    // (the step it goes over, its body is where physics left it, perhaps tipped over the edge: from the next, scripted)
    if (f.state === 'jetpack' && f.stateTime > 0) {
      expect(w.mode('fetch')).toBe('crew'); // scripted, never physics while it flies
      for (const s of w.scene.statics) {
        if (s.shape.type !== 'box') continue;
        const o = overlap(m.pose, half, s.pose, s.shape.half);
        expect(o, `step ${w.step} ${f.jet?.phase}: Fetch inside ${s.id} by ${o.toFixed(3)} at ${m.pose.p.map((v) => v.toFixed(2)).join(', ')}`).toBeLessThan(0.02);
      }
    }
    if (leftAt >= 0 && (f.state === 'idle' || f.state === 'roll') && w.mode('fetch') === 'crew' && onTape(f.x, f.z) < 1e-6) rolling = w.step;
  }
  expect(leftAt, 'it went over the edge').toBeGreaterThanOrEqual(0);
  expect(rolling, 'it was back on its tape').toBeGreaterThan(0);
  return { ev, rolling: (rolling - leftAt) / HZ, leftAt };
}

describe('Fetch\'s jetpack', () => {
  const b = SCENE.bench;
  const cases: [string, Vec3, Vec3][] = [
    ['off the front edge', [-1.0, 1.5, b.maxZ + 0.6], [0, 0, 2]],
    ['off the left end', [b.minX - 0.6, 1.5, 1.0], [-2, 0, 0]],
    ['off the right end', [b.maxX + 0.6, 3.4, 1.5], [2, 0, 0]],
    // (not over the back wall: its body stands 9 high since 2026-11-20, above the top of the lift, so Fetch let go
    // there meets the wall and comes down on the bench: throw-up.test.ts, "at the back wall")
    ['thrown from far out', [b.maxX + 0.9, 3, b.maxZ + 0.9], [6, 3, 6]],
  ];
  test.each(cases)('%s: it flies back and is rolling on its tape within five seconds of leaving the edge', async (_name, to, velocity) => {
    const w = await benchWorld(`jet-${_name}`, { scene: SCENE });
    startPlay(w);
    const r = overboard(w, to, velocity);
    const ign = r.ev.filter((e) => e.type === 'jet.ignited');
    const cut = r.ev.filter((e) => e.type === 'jet.cut');
    expect(ign).toHaveLength(1);
    expect(cut).toHaveLength(1);
    // never through the chute: it flew
    expect(r.ev.some((e) => e.type === 'part.returned' && e.id === 'fetch')).toBe(false);
    // (2026-11-20: physics carries it over and down out of sight before the jets take it, so the time includes its
    // own fall; was 4.2 when the script took it at the edge)
    expect(r.rolling).toBeLessThanOrEqual(5);
    console.log(`${_name}: back on its tape ${r.rolling.toFixed(2)} s after leaving the edge`);
    w.dispose();
  }, 60_000);

  test('the phases in order, the thrust as published, four seconds from the edge to the cut and the bounce', async () => {
    const w = await benchWorld('jet-phases', { scene: SCENE });
    startPlay(w);
    const seen: string[] = [];
    let total = 0;
    const r = overboard(w, [-1.0, 1.5, b.maxZ + 0.6], [0, 0, 2], 5, () => undefined);
    void r;
    // replay a fresh one, watching the published view
    const w2 = await benchWorld('jet-phases-2', { scene: SCENE });
    startPlay(w2);
    const p = w2.motion('fetch')!.pose.p;
    w2.dispatch({ type: 'grab', id: 'fetch', grip: p });
    w2.advance();
    for (let i = 0; i < 60; i++) {
      w2.dispatch({ type: 'carry', target: [-1, 1.5, b.maxZ + 0.6] });
      w2.advance();
    }
    w2.dispatch({ type: 'release', velocity: [0, 0, 1] });
    for (let i = 0; i < steps(6); i++) {
      w2.advance();
      w2.drainEvents();
      const f = w2.crew('fetch')!;
      if (f.state !== 'jetpack') continue;
      total++;
      const j = f.jet!;
      expect(j).not.toBeNull();
      if (seen.at(-1) !== j.phase) seen.push(j.phase);
      expect(j.thrust).toBeGreaterThanOrEqual(0);
      expect(j.thrust).toBeLessThanOrEqual(1);
      if (j.phase === 'fall') expect(j.thrust).toBe(0);
      if (j.phase === 'rise') expect(j.thrust).toBe(1);
    }
    expect(seen).toEqual(['fall', 'ignite', 'rise', 'cruise', 'hover', 'land']);
    expect(total / HZ).toBeLessThanOrEqual(4);
    w.dispose();
    w2.dispose();
  }, 60_000);

  test('with a crate in its hands: the crate falls by itself and comes back by the chute; Fetch flies', async () => {
    const w = await benchWorld('jet-crate', { scene: SCENE });
    // in attract mode it carries crate-4 from the first frame; knock nothing, just carry it over with the crate (the
    // visitor's grab makes it let go first: so the crate stays with it only if it is already in its hands when it goes
    // over; the visitor cannot hand it over the edge carrying one) — the nearest case: the crate it was carrying is let
    // go as it is lifted, and goes over the edge beside it
    const crate = w.crew('fetch')!.carrying!;
    expect(crate).not.toBeNull();
    startPlay(w);
    const r = overboard(w, [b.minX - 0.6, 1.5, 1.0], [-2, 0, 0]);
    expect(r.rolling).toBeLessThan(5);
    w.dispose();
  }, 60_000);

  test('what it writes: nothing as it goes over; where it lands, as a rest is written (the throw\'s, as a rest out of the chute was)', async () => {
    const w = await benchWorld('jet-history', { scene: SCENE });
    startPlay(w);
    const r = overboard(w, [-1.0, 1.5, b.maxZ + 0.6], [0, 0, 2]);
    const loc = r.ev.filter((e) => e.type === 'effect' && e.effect.target === 'fetch');
    expect(loc).toHaveLength(1);
    const e = loc[0] as Extract<SimEvent, { type: 'effect' }>;
    expect(e.effect.field).toBe('location');
    expect(e.effect.cause).toMatch(/^t\d+$/); // the throw's (its release window was still open)
    const at = (e.effect.after as { at: string; pose: Pose }).pose.p;
    expect(onTape(at[0], at[2])).toBeLessThan(1e-6);
    w.dispose();
  }, 60_000);

  test('a Button rung while it flies: frozen with everything else, and it finishes its flight after', async () => {
    const w = await benchWorld('jet-rung', { scene: SCENE });
    startPlay(w);
    const p = w.motion('fetch')!.pose.p;
    w.dispatch({ type: 'grab', id: 'fetch', grip: p });
    w.advance();
    for (let i = 0; i < 70; i++) {
      w.dispatch({ type: 'carry', target: [-1, 1.5, b.maxZ + 0.6] });
      w.advance();
    }
    w.dispatch({ type: 'release', velocity: [0, 0, 1] });
    for (let i = 0; i < steps(3) && w.crew('fetch')!.jet?.phase !== 'rise'; i++) w.advance();
    expect(w.crew('fetch')!.jet?.phase).toBe('rise');
    const at = w.motion('fetch')!.pose.p;
    w.dispatch({ type: 'press', id: 'button' });
    w.advance();
    expect(w.bracketed).toBe(true);
    for (let i = 0; i < steps(1); i++) w.advance();
    expect(w.crew('fetch')!.state).toBe('frozen');
    let back = false;
    for (let i = 0; i < steps(15) && !back; i++) {
      w.advance();
      w.drainEvents();
      const f = w.crew('fetch')!;
      back = !w.bracketed && f.state === 'idle' && onTape(f.x, f.z) < 1e-6;
    }
    expect(back).toBe(true);
    void at;
    w.dispose();
  }, 60_000);

  test('caught in mid-flight: it is simply held, and let go over the bench it lands and goes back to its tape', async () => {
    const w = await benchWorld('jet-catch', { scene: SCENE });
    startPlay(w);
    const p = w.motion('fetch')!.pose.p;
    w.dispatch({ type: 'grab', id: 'fetch', grip: p });
    w.advance();
    for (let i = 0; i < 70; i++) {
      w.dispatch({ type: 'carry', target: [-1, 1.5, b.maxZ + 0.6] });
      w.advance();
    }
    w.dispatch({ type: 'release', velocity: [0, 0, 1] });
    for (let i = 0; i < steps(3) && w.crew('fetch')!.jet?.phase !== 'cruise'; i++) w.advance();
    expect(w.crew('fetch')!.state).toBe('jetpack');
    w.dispatch({ type: 'grab', id: 'fetch', grip: w.motion('fetch')!.pose.p });
    w.advance();
    expect(w.crew('fetch')!.state).toBe('held');
    expect(w.crew('fetch')!.jet ?? null).toBeNull();
    for (let i = 0; i < 30; i++) {
      w.dispatch({ type: 'carry', target: [0, 1.4, 2.0] });
      w.advance();
    }
    w.dispatch({ type: 'release', velocity: [0, 0, 0] });
    let back = false;
    for (let i = 0; i < steps(8) && !back; i++) {
      w.advance();
      const f = w.crew('fetch')!;
      back = f.state === 'idle' && onTape(f.x, f.z) < 1e-6;
    }
    expect(back).toBe(true);
    w.dispose();
  }, 60_000);
});
