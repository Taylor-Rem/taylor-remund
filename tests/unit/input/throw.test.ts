// R4: the throw is what the hand was doing when it let go, not the average of its last moments.
import { describe, expect, it } from 'vitest';
import { THROW_TUNING, VelocityTracker } from '../../../src/workshop/input/velocity.ts';
import type { Vec3 } from '../../../src/workshop/sim/types.ts';

/** A hand along +x: `speed(t)` units/s at time t (ms), sampled every `dt` ms (16: a mouse at 60 Hz). */
function hand(durationMs: number, speed: (t: number) => number, dt = 16, jitter = 0): VelocityTracker {
  const v = new VelocityTracker();
  let x = 0;
  let last = 0;
  for (let t = 0; t <= durationMs; t += dt) {
    const tt = t + (jitter ? ((t * 7919) % 7) - 3 : 0) * (jitter / 3);
    x += (speed(t) * (tt - last)) / 1000;
    last = tt;
    v.add(tt, [x, 0.5, 0]);
  }
  return v;
}
const speedOf = (v: Vec3): number => Math.hypot(v[0], v[2]);

describe('the throw (R4)', () => {
  it('a firm flick that eases off in its last two frames still throws at the speed it had', () => {
    // up to 6 u/s, held, then easing to 2 in the last 32 ms
    const v = hand(300, (t) => (t < 100 ? (6 * t) / 100 : t < 268 ? 6 : 2));
    const now = 300;
    expect(speedOf(v.velocity(now, 80))).toBeLessThan(4.5); // the old average throws short
    expect(speedOf(v.throw(now))).toBeGreaterThan(5.4);
    expect(v.throw(now)[0]).toBeGreaterThan(0);
  });

  it('a hard flick throws hard', () => {
    const v = hand(200, (t) => (t < 120 ? (14 * t) / 120 : 14));
    expect(speedOf(v.throw(200))).toBeGreaterThan(12.5);
  });

  it('a slow carry sets down at the carry’s own speed', () => {
    const v = hand(400, () => 0.4);
    expect(speedOf(v.throw(400))).toBeLessThan(THROW_TUNING.rest);
  });

  it('a flick and a stop sets down: a hand that has come to rest throws nothing', () => {
    const v = hand(400, (t) => (t < 250 ? 8 : 0));
    expect(speedOf(v.throw(400))).toBeLessThan(0.1);
    // let go once the hand has been still for one end-stretch (40 ms): a set-down
    expect(speedOf(v.throw(250 + THROW_TUNING.end + 16))).toBeLessThan(0.1);
  });

  it('a wobble (back and forth) is not a throw', () => {
    const v = hand(400, (t) => 3 * Math.sin((t / 400) * Math.PI * 6));
    expect(speedOf(v.throw(400))).toBeLessThan(3.5);
  });

  it('robust to coarse touch sampling and to one late or doubled event', () => {
    const coarse = hand(300, () => 6, 33);
    expect(speedOf(coarse.throw(300))).toBeGreaterThan(5.2);
    expect(speedOf(coarse.throw(300))).toBeLessThan(6.8);
    const jitter = hand(300, () => 6, 16, 6);
    expect(speedOf(jitter.throw(300))).toBeLessThan(7.5);
    const dup = hand(300, () => 6);
    dup.add(300, [1.8, 0.5, 0]); // the same moment again
    expect(speedOf(dup.throw(300))).toBeLessThan(7.5);
    expect(speedOf(dup.throw(300))).toBeGreaterThan(5);
  });
});
