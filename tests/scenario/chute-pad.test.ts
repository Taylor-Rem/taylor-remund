// S5 R1: a shipped crate's replacement comes up the return chute and is thrown onto the pad (the deflector row's last
// slot), not set on the stack. The arc clears the row; it lands with its near side at the pad's near edge whatever
// its size and turn, clear of Fetch at its stand; it never rests inside a body; Fetch takes it without knocking it;
// and an undo of the shipment does to the replacement what it did before: nothing, at any stage of its trip.
import { describe, expect, test } from 'vitest';
import { benchWorld, FULL_BENCH, onBelt, putOn, tape } from './line-helpers.ts';
import { startPlay } from './fetch-helpers.ts';
import { AT } from '../../src/workshop/sim/scenes/bench.ts';
import { HZ, steps } from '../../src/workshop/sim/clock.ts';
import { yawOf } from '../../src/workshop/sim/math.ts';
import type { Id, Pose, SimEvent, Vec3 } from '../../src/workshop/sim/types.ts';
import type { World } from '../../src/workshop/sim/world.ts';

type Launched = Extract<SimEvent, { type: 'restock.launched' }>;
const STAND = FULL_BENCH.runner.stands!.pad as readonly [number, number];
const FETCH_REACH_OF_BODY = Math.hypot(0.3 * 1.5, 0.26 * 1.5); // its body turning on the spot at the stand

/** The far corner of a turned box from a point, and its nearest distance to it (on the bench). */
function nearestTo(pose: Pose, half: Vec3, px: number, pz: number): number {
  const a = yawOf(pose.q);
  const dx = px - pose.p[0];
  const dz = pz - pose.p[2];
  const lx = Math.cos(a) * dx - Math.sin(a) * dz;
  const lz = Math.sin(a) * dx + Math.cos(a) * dz;
  return Math.hypot(Math.max(0, Math.abs(lx) - half[0]), Math.max(0, Math.abs(lz) - half[2]));
}
/** The overlap of two turned boxes on the bench (positive: they overlap by that much), if they share height. */
function overlap(a: Pose, ah: Vec3, b: Pose, bh: Vec3): number {
  if (a.p[1] - ah[1] > b.p[1] + bh[1] || b.p[1] - bh[1] > a.p[1] + ah[1]) return -Infinity;
  const ya = yawOf(a.q);
  const yb = yawOf(b.q);
  const axes: [number, number][] = [[Math.cos(ya), -Math.sin(ya)], [Math.sin(ya), Math.cos(ya)], [Math.cos(yb), -Math.sin(yb)], [Math.sin(yb), Math.cos(yb)]];
  const proj = (u: [number, number], y: number, hx: number, hz: number): number => hx * Math.abs(u[0] * Math.cos(y) - u[1] * Math.sin(y)) + hz * Math.abs(u[0] * Math.sin(y) + u[1] * Math.cos(y));
  let o = Infinity;
  for (const u of axes) o = Math.min(o, proj(u, ya, ah[0], ah[2]) + proj(u, yb, bh[0], bh[2]) - Math.abs((b.p[0] - a.p[0]) * u[0] + (b.p[2] - a.p[2]) * u[1]));
  return o;
}

/** The visitor puts `id` on the running belt and waits for it to ship; returns the replacement's launch. */
function shipAndLaunch(w: World, t: ReturnType<typeof tape>, id: Id): Launched {
  putOn(w, t, id, onBelt(0.3));
  const shipped = t.until((e) => e.type === 'shipped' && e.part === id, steps(20));
  expect(shipped, `${id} shipped`).not.toBeNull();
  const launched = t.until((e) => e.type === 'restock.launched', steps(4));
  expect(launched, 'a replacement thrown').not.toBeNull();
  return launched!.e as Launched;
}

describe('fresh crates come up the chute onto the pad', () => {
  test('a large crate: the arc clears the row by 1.2, it lands on the pad with its near side at the near edge, clear of Fetch at its stand, and rests inside no body', async () => {
    const w = await benchWorld('chute-L');
    const t = tape(w);
    startPlay(w);
    const l = shipAndLaunch(w, t, 'crate-1');
    const part = l.part;
    expect(w.part(part)!.size).toBe('L');
    const half = w.halfExtents(part)!;
    // the flight: over the deflector's slots 1 and 2 its bottom is 1.2 up or more
    let lowest = Infinity;
    let landedAt = -1;
    for (let i = 0; i < steps(3) && landedAt < 0; i++) {
      const ev = t.run(1);
      if (ev.some((e) => e.type === 'restocked' && e.part === part && e.on === 'pad')) landedAt = w.step;
      const p = w.motion(part)!.pose.p;
      if (p[0] >= -5.9 && p[0] <= -4.3) lowest = Math.min(lowest, p[1] - half[1]);
    }
    expect(landedAt).toBeGreaterThan(0);
    expect(lowest).toBeGreaterThanOrEqual(1.2);
    expect((landedAt - (t.events.find((x) => x.e === l)?.step ?? 0)) / HZ).toBeCloseTo(l.flight, 1);
    // the flap kicked with it
    expect(t.of('flap').some((x) => x.e.part === part)).toBe(true);
    // at rest a moment later (and before anything else on this bench comes by: a crate tumbling across the row can knock it later)
    // (2026-11-20: it lands moving now, bounces and settles by physics: at rest about 0.6-0.7 s after touchdown; was
    // placed still and at rest within 0.4 s)
    for (let i = 0; i < steps(1.5) && w.part(part)!.location.at !== 'rest'; i++) t.run(1);
    const pose = w.motion(part)!.pose;
    expect(w.part(part)!.location.at).toBe('rest');
    expect(w.writer(part, 'location')).toBe('system');
    expect(Math.hypot(pose.p[0] - AT.pad[0], pose.p[2] - AT.pad[1])).toBeLessThan(0.45);
    // its nearest point toward the stand at the pad's near edge, and clear of Fetch's body turning there
    const gap = nearestTo(pose, half, STAND[0], STAND[1]) - FETCH_REACH_OF_BODY;
    expect(gap).toBeGreaterThan(0.04);
    // inside no static, no other part
    for (const s of w.scene.statics) {
      if (s.id === 'bench' || s.shape.type !== 'box') continue;
      expect(overlap(pose, half, s.pose, s.shape.half), `in ${s.id}`).toBeLessThan(0.01);
    }
    for (const o of w.parts()) {
      if (o.id === part || w.mode(o.id) === 'gone' || w.mode(o.id) === 'chute') continue;
      expect(overlap(pose, half, w.motion(o.id)!.pose, w.halfExtents(o.id)!), `in ${o.id}`).toBeLessThan(0.01);
    }
    console.log(`L on the pad at ${pose.p.map((v) => v.toFixed(3)).join(', ')}; ${gap.toFixed(3)} clear of Fetch's body at the stand; lowest over the row ${lowest.toFixed(2)}`);
    w.dispose();
  }, 60_000);

  test('Fetch takes the pad\'s crate without touching it before its claws close', async () => {
    const w = await benchWorld('chute-take', { scene: FULL_BENCH });
    const t = tape(w);
    startPlay(w);
    const l = shipAndLaunch(w, t, 'crate-1');
    const part = l.part;
    t.until((e) => e.type === 'restocked' && e.part === part, steps(3));
    // (settled first: since 2026-11-20 it bounces and settles by physics, about 0.7 s)
    for (let i = 0; i < steps(2) && w.part(part)!.location.at !== 'rest'; i++) t.run(1);
    t.run(steps(0.1));
    const rest = w.motion(part)!.pose.p;
    let taken = false;
    for (let i = 0; i < steps(25) && !taken; i++) {
      const ev = t.run(1);
      if (w.crew('fetch')!.carrying === part) taken = true;
      else {
        expect(ev.some((e) => e.type === 'part.hit' && [e.id, e.other].includes('fetch') && [e.id, e.other].includes(part)), 'Fetch knocked it').toBe(false);
        const p = w.motion(part)!.pose.p;
        expect(Math.hypot(p[0] - rest[0], p[1] - rest[1], p[2] - rest[2]), 'it moved before the claws closed').toBeLessThan(1e-3);
      }
    }
    expect(taken).toBe(true);
    w.dispose();
  }, 60_000);

  describe('undoing the shipment does nothing to its replacement, wherever it is', () => {
    const stages = ['in the chute', 'in flight', 'on the pad', 'in Fetch\'s hands'] as const;
    test.each(stages)('%s', async (stage) => {
      const w = await benchWorld(`chute-undo-${stage}`, stage === 'in Fetch\'s hands' ? { scene: FULL_BENCH } : {});
      const t = tape(w);
      startPlay(w);
      putOn(w, t, 'crate-1', onBelt(0.3));
      expect(t.until((e) => e.type === 'shipped' && e.part === 'crate-1', steps(20))).not.toBeNull();
      let replacement: Id | null = null;
      if (stage === 'in the chute') t.run(steps(0.5));
      else {
        const l = t.until((e) => e.type === 'restock.launched', steps(4));
        replacement = (l!.e as Launched).part;
        if (stage === 'in flight') t.run(steps(0.4));
        else {
          t.until((e) => e.type === 'restocked' && e.part === replacement, steps(3));
          if (stage === 'in Fetch\'s hands') for (let i = 0; i < steps(20) && w.crew('fetch')!.carrying !== replacement; i++) t.run(1);
          else t.run(steps(1));
        }
      }
      if (stage === 'in Fetch\'s hands') expect(w.crew('fetch')!.carrying).toBe(replacement);
      const before = replacement ? { mode: w.mode(replacement), loc: w.part(replacement)!.location } : null;
      w.dispatch({ type: 'undo' });
      const ev = t.run(1);
      const undone = ev.find((e) => e.type === 'undone');
      expect(undone, 'the lever took the shipment back').toBeDefined();
      expect(w.part('crate-1')!.location.at).not.toBe('shipped');
      if (undone?.type === 'undone' && replacement) expect(undone.restores.some((r) => r.target === replacement)).toBe(false);
      // the replacement goes on as it was: it lands (or stays) on the pad, or in Fetch's hands
      if (replacement && before) {
        expect(w.mode(replacement)).toBe(before.mode);
        expect(w.part(replacement)!.location).toEqual(before.loc);
      }
      t.run(steps(4));
      if (stage === 'in the chute') expect(t.of('restock.launched').length, 'the owed restock still comes').toBe(1);
      if (stage === 'in flight') expect(t.of('restocked').some((x) => x.e.part === replacement && x.e.on === 'pad')).toBe(true);
      w.dispose();
    }, 60_000);
  });
});
