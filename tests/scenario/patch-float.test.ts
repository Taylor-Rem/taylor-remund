// R5 (Taylor, 2026-11-20): "Eliminate unnatural discontinuities ... One exception worth preserving is the playful
// juggling behavior when Patch is thrown almost straight upward. I like the idea of a brief hang at the apex, but it
// shouldn't interrupt significant horizontal movement or feel like an accidental freeze."
//
// Patch's flight, on the simulation alone (the browser spec tests/browser/patch-feel.spec.ts holds the drawn side):
//  - in the air it never spends a step without moving, and its velocity never changes from one step to the next by
//    more than the world's gravity does in a step (a hit on something is the one legitimate exception: none here,
//    and the test says so if one happens);
//  - its sideways drift goes on unchanged through the top of a throw up;
//  - a throw straight up floats at its top: it is longer in the air than the same throw without the float, by about
//    the old dead stop's 0.15 s; the float fades as the throw leans over, smoothly, and a throw across has none;
//  - `PatchView.prevAt`, for drawing between steps: the step before's `at` in flight (and under the hand on the
//    release step), and `at` itself across a jump.
import { describe, expect, test } from 'vitest';
import { benchWorld, tape } from './line-helpers.ts';
import type { Tape } from './line-helpers.ts';
import { patchView } from './patchlamp-helpers.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { Vec3 } from '../../src/workshop/sim/types.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';
import { PATCH_TUNING } from '../../src/workshop/sim/crew/patch.ts';

const T = PATCH_TUNING;

/** Lifted off its stool and carried to `hand`, held still a moment (as patch-throw.test.ts does). */
function carryTo(w: World, t: Tape, hand: Vec3): void {
  const s = patchView(w).at;
  const a: Vec3 = [s[0], 2.4, s[2] + 0.6];
  for (let i = 0; i <= 40; i++) {
    w.dispatch({ type: 'drag', id: 'patch', target: [a[0] + ((hand[0] - a[0]) * i) / 40, a[1] + ((hand[1] - a[1]) * i) / 40, a[2] + ((hand[2] - a[2]) * i) / 40] });
    t.run(1);
  }
  for (let i = 0; i < 20; i++) {
    w.dispatch({ type: 'drag', id: 'patch', target: hand });
    t.run(1);
  }
}

interface Air {
  /** `at` at every step in the air, from the release step on. */
  at: Vec3[];
  /** Steps in the air. */
  steps: number;
  /** Steps in the air without the same throw's float: the same start, the same discrete steps, the world's whole pull. */
  ballistic: number;
  tops: number;
  hits: number;
  /** prevAt on the release step against the hand's point a step before less `hangBelow`. */
  releasePrev: number;
  /** The largest gap between prevAt and the step before's `at` in flight. */
  prevGap: number;
  float: number;
}

async function fly(hand: Vec3, v: Vec3): Promise<Air> {
  const w = await benchWorld(1);
  const t = tape(w);
  t.run(20);
  carryTo(w, t, hand);
  const heldAt = [...patchView(w).at] as Vec3;
  w.dispatch({ type: 'drag', id: 'patch', target: hand, end: true, velocity: v });
  const from = t.events.length;
  t.run(1);
  const v0 = patchView(w);
  expect(v0.state).toBe('fly');
  const air: Air = { at: [[...v0.at] as Vec3], steps: 1, ballistic: 0, tops: 0, hits: 0, releasePrev: 0, prevGap: 0, float: v0.thrown?.float ?? 0 };
  air.releasePrev = Math.hypot(v0.prevAt[0] - heldAt[0], v0.prevAt[1] - (heldAt[1] - T.hangBelow), v0.prevAt[2] - heldAt[2]);
  // the same throw without the float: from where the first step left it, at the speed it had then, whole gravity
  const g = w.scene.gravity;
  const land = w.scene.bench.top + T.restMid;
  {
    let y = v0.at[1], vy = v0.thrown!.v![1];
    let n = 1;
    while (n < 10 * HZ) {
      vy += g / HZ;
      y += vy / HZ;
      n++;
      if (y <= land) break;
    }
    air.ballistic = n;
  }
  for (let i = 0; i < 8 * HZ; i++) {
    const before = air.at[air.at.length - 1]!;
    t.run(1);
    const pv = patchView(w);
    if (pv.state !== 'fly') break;
    air.steps++;
    if (pv.thrown?.top) air.tops++;
    air.prevGap = Math.max(air.prevGap, Math.hypot(pv.prevAt[0] - before[0], pv.prevAt[1] - before[1], pv.prevAt[2] - before[2]));
    air.at.push([...pv.at] as Vec3);
  }
  air.hits = t.events.slice(from).filter((x) => x.e.type === 'patch.throw' && x.e.phase === 'hit').length;
  return air;
}

/** Per-step velocities (units/s) from consecutive `at`s. */
const velocities = (at: Vec3[]): Vec3[] => at.slice(1).map((p, i) => [(p[0] - at[i]![0]) * HZ, (p[1] - at[i]![1]) * HZ, (p[2] - at[i]![2]) * HZ]);

describe('R5: Patch in the air moves on every step, its speed changes only by gravity, and a throw up floats at its top', () => {
  // the open air over the left of the bench (patch-throw.test.ts throws up from here too)
  const hand: Vec3 = [-6, 1.2, -2];
  const g = 16;
  // the most the velocity may change in one step: the world's pull for a step (the float only ever lessens it);
  // 1% for rounding. A hit, a top come down on, a wall: legitimate impulses, which these throws do not meet
  const dvMax = (g / HZ) * 1.01;

  for (const [label, v, floats] of [
    ['straight up at 9', [0, 9, 0], true],
    ['straight up at 12', [0, 12, 0], true],
    ['up at 9 with 1.5 across', [1.5, 9, 0], true],
    ['up at 9 with 3.5 across', [3.5, 9, 0], false],
    ['across at 8 with 5 up', [8, 5, 0], false],
    ['across at 6 with 9 up', [6, 9, 0], false],
  ] as const) {
    test(`thrown ${label}: never a still step, the velocity continuous, the drift unchanged${floats ? ', and it floats at the top' : ''}`, async () => {
      const air = await fly(hand, v as unknown as Vec3);
      expect(air.hits, 'it met nothing (a hit would be a legitimate jump in velocity)').toBe(0);
      expect(air.steps).toBeGreaterThan(20);
      // never a step in the air without moving (the old hang stood still for 9 steps)
      const still = air.at.slice(1).filter((p, i) => Math.hypot(p[0] - air.at[i]![0], p[1] - air.at[i]![1], p[2] - air.at[i]![2]) < 1e-5).length;
      expect(still, 'steps in the air without moving').toBe(0);
      const vs = velocities(air.at);
      let dv = 0, levelSpread = 0;
      const level0 = Math.hypot(vs[0]![0], vs[0]![2]);
      for (let i = 1; i < vs.length; i++) {
        dv = Math.max(dv, Math.hypot(vs[i]![0] - vs[i - 1]![0], vs[i]![1] - vs[i - 1]![1], vs[i]![2] - vs[i - 1]![2]));
        levelSpread = Math.max(levelSpread, Math.abs(Math.hypot(vs[i]![0], vs[i]![2]) - level0));
      }
      expect(dv, 'the largest change in velocity from one step to the next (units/s)').toBeLessThanOrEqual(dvMax);
      expect(levelSpread, 'its speed across the bench never changes in open air').toBeLessThan(1e-6);
      // drawing between steps: prevAt is the step before's `at`; on the release step, its middle under the hand
      expect(air.prevGap).toBeLessThan(1e-9);
      expect(air.releasePrev, 'prevAt on the release step: the middle under the hand a step before').toBeLessThan(0.05);
      const extra = (air.steps - air.ballistic) / HZ;
      if (floats) {
        // the beat at the top: about the old stop's 0.15 s more in the air (0.08 .. 0.25 allows the fade with a lean
        // and the step the landing falls on)
        expect(air.float).toBeGreaterThan(0.5);
        expect(extra, 'seconds more in the air than without the float').toBeGreaterThan(0.08);
        expect(extra).toBeLessThan(0.25);
        expect(air.tops, 'steps "in the float"').toBeGreaterThan(3);
      } else {
        expect(air.float).toBe(0);
        expect(Math.abs(extra), 'no float: as long in the air as the plain arc').toBeLessThanOrEqual(1 / HZ + 1e-9);
        expect(air.tops).toBe(0);
      }
    }, 60_000);
  }

  test('the float fades smoothly as the throw leans over: never more air time for a throw that leans more, and none by 19 degrees', async () => {
    const extras: number[] = [];
    for (const across of [0, 0.75, 1.5, 2.25, 3.0, 3.75]) {
      const air = await fly(hand, [across, 9, 0]);
      expect(air.hits).toBe(0);
      extras.push((air.steps - air.ballistic) / HZ);
    }
    if (process.env.FLOAT_LOG) console.log(`extra air (s) for 0..3.75 across: ${extras.map((x) => x.toFixed(3)).join(", ")}`);
    for (let i = 1; i < extras.length; i++) expect(extras[i]!, extras.join(', ')).toBeLessThanOrEqual(extras[i - 1]! + 1 / HZ + 1e-9);
    // (a step from one lean to the next is at most a fraction of the whole: no threshold where it switches)
    for (let i = 1; i < extras.length; i++) expect(extras[i - 1]! - extras[i]!, extras.join(', ')).toBeLessThan(0.1);
    expect(extras.at(-1)!, extras.join(', ')).toBeLessThanOrEqual(1 / HZ + 1e-9);
  }, 120_000);
});
