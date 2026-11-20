// The hand (Taylor, 2026-11-20: "Objects should follow the player's hand responsively, inherit believable momentum,
// and travel in the direction they're actually thrown"). These tests hold the MOTION, not only where things end up:
// how far a carried thing trails the hand, and that nothing about its velocity is made up at the moment it is let go.
// (Measured on the page before this change: a carried crate was held to 11 units/s and fell 7.4 units behind a quick
// sweep; at release its own velocity was thrown away for an estimate of the pointer's: 11 to 14 units/s in one step
// on a flick, 11 to 0 when the hand had just stopped, and once up and toward the visitor after a carry up and right.)
//
// Bounds are loose on purpose and each says what it allows: the weight of a heavy thing in the hand, the little loft
// a throw gets, a hand's uneven reports. They are there to catch a velocity that is replaced, reversed or zeroed.
import { describe, expect, test } from 'vitest';
import { benchWorld, FULL_BENCH, tape, type Tape } from './line-helpers.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';
import { asSeen, clampThrow, LOOSE_TUNING, softCeiling, throwCap, thrownFrom } from '../../src/workshop/sim/world.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { Id, Lens, Vec3 } from '../../src/workshop/sim/types.ts';

const len = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);
const level = (v: Vec3): number => Math.hypot(v[0], v[2]);
const angle = (a: Vec3, b: Vec3): number => Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (len(a) * len(b) || 1)))) * (180 / Math.PI);
/** A part's velocity over the last step, from where it was and is. */
const vel = (w: World, id: Id): Vec3 => {
  const m = w.motion(id)!;
  return [(m.pose.p[0] - m.prev.p[0]) * HZ, (m.pose.p[1] - m.prev.p[1]) * HZ, (m.pose.p[2] - m.prev.p[2]) * HZ];
};

/** The open lane at the back-left of the bench: clear of every fixed body from x -8.5 to 6.5 at z -2. */
const START: Vec3 = [-6.5, 0.9, -2];

/** Take `id` and carry it to `at`, held still there. */
async function inHand(id: Id, at: Vec3 = START): Promise<{ w: World; t: Tape }> {
  const w = await benchWorld(`hand-${id}`, { scene: FULL_BENCH });
  const t = tape(w);
  t.run(30);
  w.dispatch({ type: 'grab', id, grip: w.motion(id)!.pose.p });
  t.run(1);
  expect(w.holding()?.id).toBe(id);
  const from = w.motion(id)!.pose.p;
  for (let i = 1; i <= 90; i++) {
    const k = Math.min(1, i / 60);
    const e = k * k * (3 - 2 * k);
    w.dispatch({ type: 'carry', target: [from[0] + (at[0] - from[0]) * e, Math.max(at[1], from[1] + 1.2 * Math.sin(Math.PI * k)), from[2] + (at[2] - from[2]) * e] });
    t.run(1);
  }
  for (let i = 0; i < 30; i++) {
    w.dispatch({ type: 'carry', target: at });
    t.run(1);
  }
  return { w, t };
}

/**
 * Move the hand from where it holds `id`: `speedAt(i)` units/s on step i along `dir` (level), for `n` steps. Returns
 * the most the part trailed the hand (level distance from where it stood relative to the hand at the start).
 */
function sweep(w: World, t: Tape, id: Id, dir: readonly [number, number], n: number, speedAt: (i: number) => number, from: Vec3 = START): { trail: number; hand: Vec3; last: Vec3 } {
  const L = Math.hypot(dir[0], dir[1]);
  const d: [number, number] = [dir[0] / L, dir[1] / L];
  const p0 = w.motion(id)!.pose.p;
  const off: Vec3 = [p0[0] - from[0], 0, p0[2] - from[2]];
  let hand: Vec3 = [...from];
  let trail = 0;
  for (let i = 0; i < n; i++) {
    const s = speedAt(i) / HZ;
    hand = [hand[0] + d[0] * s, hand[1], hand[2] + d[1] * s];
    w.dispatch({ type: 'carry', target: hand });
    t.run(1);
    const p = w.motion(id)!.pose.p;
    trail = Math.max(trail, Math.hypot(hand[0] + off[0] - p[0], hand[2] + off[2] - p[2]));
  }
  return { trail, hand, last: vel(w, id) };
}

describe('in the hand: it keeps up', () => {
  // A steady 20 units/s is 1,400 px a second at the home view: a brisk hand. The part's speed is its gap times
  // `carryRate`, so it settles speed / carryRate behind (0.44 at 20); the bound allows that plus getting up to speed.
  test('a small crate trails a hand at 20 units/s by well under a unit, and has the hand\'s speed', async () => {
    const { w, t } = await inHand('crate-3');
    const r = sweep(w, t, 'crate-3', [1, 0], 24, () => 20);
    expect(r.trail).toBeLessThan(0.8);
    expect(level(r.last)).toBeGreaterThan(18.5);
    expect(level(r.last)).toBeLessThan(21);
  });

  // Weight: a heavy thing may change its velocity less each step (`carryAccel` by mass), so it takes longer to get
  // going and trails further on the way; once going it keeps up as a crate does.
  test('Fetch is heavier in the hand: it trails more getting going, but under two units, and reaches the hand\'s speed', async () => {
    const { w, t } = await inHand('fetch', [-6.5, 1.3, -2]);
    const r = sweep(w, t, 'fetch', [1, 0], 30, () => 16, [-6.5, 1.3, -2]);
    expect(r.trail).toBeLessThan(2);
    expect(r.trail).toBeGreaterThan(0.4);
    expect(level(r.last)).toBeGreaterThan(14.5);
  });

  test('held still, it is still', async () => {
    const { w } = await inHand('crate-3');
    expect(len(vel(w, 'crate-3'))).toBeLessThan(0.05);
  });
});

describe('let go: it goes on as it was going', () => {
  // The first free step may differ from the last held one by gravity (0.27 units/s a step), the throw's small loft
  // (at most `loftMax`, upward only), and the easing toward what it had a moment before (never above that).
  for (const [name, dir] of [['right', [1, 0]], ['left', [-1, 0]], ['toward the visitor', [0, 1]], ['away', [0, -1]], ['right and away', [1, -1]], ['left and toward', [-1, 1]]] as const) {
    test(`carried ${name} at a steady 8 units/s and let go: the same way, the same speed`, async () => {
      const at: Vec3 = [-4, 0.9, -1];
      const { w, t } = await inHand('crate-3', at);
      const r = sweep(w, t, 'crate-3', dir, 12, () => 8, at);
      w.dispatch({ type: 'release' });
      t.run(1);
      const after = vel(w, 'crate-3');
      expect(w.motion('crate-3')!.mode).toBe('free');
      expect(angle([after[0], 0, after[2]], [r.last[0], 0, r.last[2]])).toBeLessThan(6);
      expect(level(after)).toBeGreaterThan(level(r.last) * 0.93);
      expect(level(after)).toBeLessThan(level(r.last) * 1.07);
      expect(after[1]).toBeGreaterThan(-0.5);
      expect(after[1]).toBeLessThan(LOOSE_TUNING.loftMax + 0.1);
    });
  }

  test('a hand that eases off in its last frames throws nearly what it had, never more, and the same way', async () => {
    const { w, t } = await inHand('crate-3');
    sweep(w, t, 'crate-3', [1, 0], 10, () => 12);
    const peak = level(vel(w, 'crate-3'));
    const hand: Vec3 = [START[0] + (12 * 10) / HZ, START[1], START[2]];
    const r = sweep(w, t, 'crate-3', [1, 0], 4, (i) => 11 - i, hand);
    w.dispatch({ type: 'release' });
    t.run(1);
    const after = vel(w, 'crate-3');
    expect(level(after)).toBeGreaterThan(level(r.last) - 0.3); // (not slower than it was)
    expect(level(after)).toBeLessThan(peak + 0.3); // (not faster than it had been)
    expect(level(after)).toBeGreaterThan(9.5); // (most of what it had: the hand meant that throw)
    expect(Math.abs(after[2])).toBeLessThan(0.5);
  });

  // Faster than the bench can hold: it must not be suddenly slower in the step it is let go (the excess is shed over
  // `launchEase`), must only ever lose level speed from there, and must be down to what the bench holds soon after.
  test('a hard flick leaves at the hand\'s speed and eases down to the bench\'s most: no step in which it brakes', async () => {
    const { w, t } = await inHand('crate-3');
    const r = sweep(w, t, 'crate-3', [1, 0], 9, (i) => 6 + i * 4);
    const inHandSpeed = level(r.last);
    expect(inHandSpeed).toBeGreaterThan(25);
    w.dispatch({ type: 'release' });
    let prev = inHandSpeed;
    const speeds: number[] = [];
    const half = w.halfExtents('crate-3')![1];
    for (let i = 0; i < 30; i++) {
      t.run(1);
      // (only while it is in the air: what a landing does to its speed is the bench's doing, and right)
      if (w.motion('crate-3')!.pose.p[1] - half < 0.08) break;
      const s = level(vel(w, 'crate-3'));
      speeds.push(s);
      // each step it keeps at least 70% of the step before (shedding the excess with a 90 ms time constant loses
      // about a sixth of the EXCESS a step, less of the whole) and never gains
      expect(s).toBeGreaterThan(prev * 0.7);
      expect(s).toBeLessThan(prev + 0.05);
      prev = s;
    }
    expect(speeds.length).toBeGreaterThan(12);
    // (the first free step: the mean of its last two steps in a hand still speeding up, less one step of shedding)
    expect(speeds[0]!).toBeGreaterThan(inHandSpeed * 0.8);
    // a fifth of a second on, most of the excess is gone; it is still going faster than a gentle throw
    expect(speeds[12]!).toBeLessThan(throwCap(0.06) + 0.35 * (inHandSpeed - throwCap(0.06)));
    expect(speeds[speeds.length - 1]!).toBeGreaterThan(LOOSE_TUNING.throwKnee);
  });

  test('a harder flick throws harder (it used to be the same throw over about 1,000 px a second)', async () => {
    const reach = async (top: number): Promise<number> => {
      const { w, t } = await inHand('crate-3');
      sweep(w, t, 'crate-3', [1, 0], 9, (i) => (top * (i + 1)) / 9);
      w.dispatch({ type: 'release' });
      t.run(18);
      return level(vel(w, 'crate-3'));
    };
    const a = await reach(14);
    const b = await reach(22);
    const c = await reach(34);
    expect(b).toBeGreaterThan(a + 0.5);
    expect(c).toBeGreaterThan(b + 0.2);
    expect(c).toBeLessThan(throwCap(0.06) + 0.5);
  });

  test('a quick sweep, a stop, and let go a tenth of a second later: it is set down where the hand is, it does not shoot on or stop dead in flight', async () => {
    const { w, t } = await inHand('crate-3');
    const r = sweep(w, t, 'crate-3', [1, 0], 8, () => 30);
    for (let i = 0; i < 6; i++) {
      w.dispatch({ type: 'carry', target: r.hand });
      t.run(1);
    }
    // it has caught the hand up and is at rest there
    const p = w.motion('crate-3')!.pose.p;
    expect(Math.abs(p[0] - r.hand[0])).toBeLessThan(0.3);
    expect(level(vel(w, 'crate-3'))).toBeLessThan(1);
    w.dispatch({ type: 'release' });
    t.run(1);
    expect(level(vel(w, 'crate-3'))).toBeLessThan(1);
  });

  test('a stated velocity is still the throw (the keys, a cancelled pointer, these tests)', async () => {
    const { w, t } = await inHand('crate-3');
    w.dispatch({ type: 'release', velocity: [6, 0, 0] });
    t.run(1);
    const v = vel(w, 'crate-3');
    expect(v[0]).toBeGreaterThan(5.8);
    expect(v[0]).toBeLessThan(6.1);
  });
});

describe('up the screen: away along the bench, or up', () => {
  const lens: Lens = { away: [0, -1], tilt: 0.7 };

  test('carried away slowly and let go, it goes on away along the bench', () => {
    expect(asSeen([1, 0, -3], lens)).toEqual([1, 0, -3]);
  });

  test('a flick up the screen goes straight up at the speed the eye saw; sideways motion is left alone', () => {
    const v = asSeen([2, 0, -15], lens);
    expect(v[0]).toBeCloseTo(2, 6);
    expect(Math.abs(v[2])).toBeLessThan(1e-6);
    expect(v[1]).toBeCloseTo(15 * 0.7, 6);
  });

  test('a very hard one leans back toward the wall, along the screen\'s own up', () => {
    const v = asSeen([0, 0, -45], lens);
    expect(v[2]).toBeLessThan(-10);
    expect(v[1]).toBeGreaterThan(15);
    // along the screen's up: as much back for each unit up as the line of sight is tilted
    expect(-v[2] / (v[1] / 0.7)).toBeCloseTo(0.7 / Math.hypot(1, 0.7) / (1 / Math.hypot(1, 0.7)), 1);
  });

  test('toward the visitor, and sideways, nothing is turned', () => {
    expect(asSeen([0, 0, 12], lens)).toEqual([0, 0, 12]);
    expect(asSeen([-9, 0.5, 0], lens)).toEqual([-9, 0.5, 0]);
  });

  // The old rule switched on speed: under 300 px/s back, over it up, and at it the hold flickered between the two.
  test('there is no speed at which it flips: the throw changes smoothly from away to up as the speed rises', () => {
    let prev = asSeen([0, 0, 0], lens);
    for (let a = 0.05; a <= 50; a += 0.05) {
      const v = asSeen([0, 0, -a], lens);
      // (a twentieth of a unit/s more speed never changes the throw by more than a fifth of one)
      expect(Math.hypot(v[1] - prev[1], v[2] - prev[2])).toBeLessThan(0.2);
      prev = v;
    }
  });

  test('on the page\'s path: a flick away with the lens is thrown up; the same flick without it goes away', async () => {
    const at: Vec3 = [-5.5, 0.9, 0];
    for (const withLens of [true, false]) {
      const { w, t } = await inHand('crate-3', at);
      sweep(w, t, 'crate-3', [0, -1], 7, (i) => 4 + i * 2, at);
      w.dispatch(withLens ? { type: 'release', lens } : { type: 'release' });
      t.run(1);
      const v = vel(w, 'crate-3');
      if (withLens) {
        expect(v[1]).toBeGreaterThan(6);
        expect(Math.abs(v[2])).toBeLessThan(2.5);
      } else {
        expect(v[2]).toBeLessThan(-8);
        expect(v[1]).toBeLessThan(LOOSE_TUNING.loftMax + 0.1);
      }
    }
  });

  test('the carry\'s own motion is not the hand\'s: what the lens calls drift is taken out of the throw', async () => {
    const { w, t } = await inHand('crate-3');
    // the hand is still; the target rises and comes forward as a carry surface easing over a machine does
    let hand: Vec3 = [...START];
    for (let i = 0; i < 6; i++) {
      hand = [hand[0], hand[1] + 6 / HZ, hand[2] + 8 / HZ];
      w.dispatch({ type: 'carry', target: hand });
      t.run(1);
    }
    expect(len(vel(w, 'crate-3'))).toBeGreaterThan(7);
    w.dispatch({ type: 'release', lens: { ...lens, drift: [0, 6, 8] } });
    t.run(1);
    expect(level(vel(w, 'crate-3'))).toBeLessThan(1.5);
  });
});

describe('the throw\'s arithmetic', () => {
  test('the soft ceiling: itself up to the knee, always rising, never the most', () => {
    expect(softCeiling(7, 12, 18)).toBe(7);
    expect(softCeiling(12, 12, 18)).toBe(12);
    let prev = 12;
    for (let x = 12.5; x < 80; x += 0.5) {
      const y = softCeiling(x, 12, 18);
      expect(y).toBeGreaterThan(prev);
      expect(y).toBeLessThan(18);
      prev = y;
    }
  });

  test('a throw under the knee is not touched; over it the direction is kept', () => {
    expect(clampThrow([6, 2, -3], 0.06, 1, -16)).toEqual([6, 2, -3]);
    const v = clampThrow([30, 0, -30], 0.06, 1, -16);
    expect(v[0]).toBeCloseTo(-v[2], 9);
    expect(Math.hypot(v[0], v[2])).toBeLessThan(LOOSE_TUNING.throwMax);
  });

  test('what a hand threw: the way it was going at the end; at rest, nothing; never more than it had', () => {
    expect(thrownFrom([])).toEqual([0, 0, 0]);
    expect(len(thrownFrom([[0.1, 0, 0], [0.1, 0, 0]]))).toBeLessThan(0.2);
    const eased = thrownFrom([[12, 0, 0], [12, 0, 0], [12, 0, 0], [11, 0, 0], [9, 0, 0], [8, 0, 0]]);
    expect(eased[0]).toBeGreaterThan(8.5);
    expect(eased[0]).toBeLessThanOrEqual(12);
    // a hand that turned: the throw goes the way it was going at the end, not the way it went before
    const turned = thrownFrom([[10, 0, 0], [10, 0, 0], [6, 0, 4], [0, 0, 9], [0, 0, 9]]);
    expect(Math.abs(turned[0])).toBeLessThan(0.5);
    expect(turned[2]).toBeGreaterThan(8.5);
    expect(turned[2]).toBeLessThan(9.6);
  });
});
