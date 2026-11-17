import { describe, expect, test } from 'vitest';
import {
  AngleSpring, Cadence, Derivative, Envelope, OneShot, Spring, SpringVec, Track, Timeline, approach, bump, damp, dampAngle, fbm1, inBack, noise1,
  outBack, reducedMotionParams, springStep, wrapAngle,
} from '../../../src/workshop/view/anim/index.ts';

/** Run a spring toward 1 for `secs` in frames of `dt`; return the peak and the end value. */
function settle(p: { omega: number; zeta: number }, dt: number, secs = 2): { peak: number; end: number } {
  const s = new Spring(0, p);
  let peak = 0;
  for (let t = 0; t < secs; t += dt) peak = Math.max(peak, s.step(1, dt));
  return { peak, end: s.x };
}

describe('springs', () => {
  test('an underdamped spring overshoots a little and settles', () => {
    const r = settle({ omega: 14, zeta: 0.42 }, 1 / 60);
    expect(r.peak).toBeGreaterThan(1.1);
    expect(r.peak).toBeLessThan(1.4);
    expect(r.end).toBeCloseTo(1, 3);
  });

  test('a critically damped spring never overshoots', () => {
    expect(settle({ omega: 14, zeta: 1 }, 1 / 60).peak).toBeLessThanOrEqual(1 + 1e-9);
  });

  test('frame-rate independent: 30 fps and 144 fps land on the same curve', () => {
    const a = new Spring(0, { omega: 20, zeta: 0.3 });
    const b = new Spring(0, { omega: 20, zeta: 0.3 });
    for (let i = 0; i < 15; i++) a.step(1, 1 / 30);
    for (let i = 0; i < 72; i++) b.step(1, 1 / 144);
    expect(a.x).toBeCloseTo(b.x, 2);
  });

  test('stable for stiff springs and long frames; dt 0 changes nothing', () => {
    const s = new Spring(0, { omega: 70, zeta: 0.85 });
    s.step(1, 0.1);
    expect(Number.isFinite(s.x)).toBe(true);
    expect(Math.abs(s.x - 1)).toBeLessThan(0.05);
    const x = s.x;
    s.step(5, 0);
    expect(s.x).toBe(x);
  });

  test('a kick moves a resting spring and it comes back', () => {
    const s = new Spring(0, { omega: 17, zeta: 0.32 }).kick(5);
    let peak = 0;
    for (let i = 0; i < 120; i++) peak = Math.max(peak, s.step(0, 1 / 60));
    expect(peak).toBeGreaterThan(0.15);
    expect(Math.abs(s.x)).toBeLessThan(1e-3);
  });

  test('springStep is the pure form of Spring.step', () => {
    const s = new Spring(0.2, { omega: 9, zeta: 0.5 }).kick(1);
    const [x, v] = springStep(0.2, 1, 1, { omega: 9, zeta: 0.5 }, 0.05);
    s.step(1, 0.05);
    expect(s.x).toBe(x);
    expect(s.v).toBe(v);
  });

  test('an angle spring takes the short way round', () => {
    const s = new AngleSpring(Math.PI - 0.05, { omega: 20, zeta: 1 });
    for (let i = 0; i < 120; i++) s.step(-Math.PI + 0.05, 1 / 60);
    expect(wrapAngle(s.x)).toBeCloseTo(-Math.PI + 0.05, 3);
    expect(Math.abs(s.x - (Math.PI - 0.05))).toBeLessThan(0.2);
  });

  test('a spring vector steps every channel', () => {
    const v = new SpringVec([0, 0, 0], { omega: 12, zeta: 1 });
    for (let i = 0; i < 120; i++) v.step([1, -2, 0.5], 1 / 60);
    expect(v.x[0]).toBeCloseTo(1, 3);
    expect(v.x[1]).toBeCloseTo(-2, 3);
    expect(v.x[2]).toBeCloseTo(0.5, 3);
  });

  test('reduced motion keeps the stiffness and drops the bounce', () => {
    expect(reducedMotionParams({ omega: 9, zeta: 0.2 })).toEqual({ omega: 9, zeta: 1 });
  });

  test('wrapAngle', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 9);
    expect(wrapAngle(-Math.PI / 2)).toBeCloseTo(-Math.PI / 2, 9);
    expect(wrapAngle(2 * Math.PI + 0.1)).toBeCloseTo(0.1, 9);
  });
});

describe('followers', () => {
  test('damp approaches without overshoot, independent of frame rate', () => {
    let a = 0;
    let b = 0;
    for (let i = 0; i < 6; i++) a = damp(a, 1, 8, 1 / 30);
    for (let i = 0; i < 12; i++) b = damp(b, 1, 8, 1 / 60);
    expect(a).toBeCloseTo(b, 9);
    expect(a).toBeLessThan(1);
    expect(wrapAngle(dampAngle(3, -3, 100, 1))).toBeCloseTo(-3, 3);
    expect(approach(0, 1, 0.3)).toBe(0.3);
    expect(approach(0.9, 1, 0.3)).toBe(1);
  });

  test('Derivative measures a rate and survives a reset', () => {
    const d = new Derivative(1000);
    for (let i = 0; i <= 60; i++) d.push(2 * (i / 60), 1 / 60);
    expect(d.value).toBeCloseTo(2, 2);
    d.reset();
    expect(d.value).toBe(0);
    d.push(100, 1 / 60);
    expect(d.value).toBe(0); // no jump from the stale sample
  });
});

describe('one-shots and timelines', () => {
  test('a one-shot runs from when it is fired, on the time it is given', () => {
    const o = new OneShot(0.5, outBack());
    expect(o.progress(3)).toBe(1); // never fired: reads finished
    o.fire(2);
    expect(o.active(2.1)).toBe(true);
    expect(o.progress(2.25)).toBeCloseTo(0.5, 9);
    expect(o.value(2.5)).toBeCloseTo(1, 9);
    expect(o.active(2.6)).toBe(false);
  });

  test('an envelope rises, holds and falls once', () => {
    const e = new Envelope(0.1, 0.2, 0.1).fire(1);
    expect(e.value(0.9)).toBe(0);
    expect(e.value(1.2)).toBe(1);
    expect(e.value(1.35)).toBeGreaterThan(0);
    expect(e.value(1.41)).toBe(0);
  });

  test('easing: back overshoots past 1, inBack anticipates below 0, bump is 0 at both ends', () => {
    const ob = outBack();
    let max = 0;
    for (let t = 0; t <= 1; t += 0.01) max = Math.max(max, ob(t));
    expect(max).toBeGreaterThan(1.05);
    expect(inBack()(0.2)).toBeLessThan(0);
    expect(bump(0)).toBe(0);
    expect(bump(1)).toBe(0);
    expect(bump(0.5)).toBe(1);
  });

  test('a track holds before its first key and after its last, and eases between', () => {
    const t = new Track([[0.2, 0], [0.6, 1], [1, 0.5]]);
    expect(t.sample(0)).toBe(0);
    expect(t.sample(0.4)).toBeCloseTo(0.5, 9);
    expect(t.sample(2)).toBe(0.5);
    expect(t.duration).toBe(1);
    expect(() => new Track([[1, 0], [0, 1]])).toThrow();
    const tl = new Timeline({ a: t, b: new Track([[0, 1], [2, 3]]) });
    expect(tl.duration).toBe(2);
    expect(tl.sample(2)).toEqual({ a: 0.5, b: 3 });
  });
});

describe('seeded noise and cadences', () => {
  test('noise is smooth, bounded and seeded', () => {
    let prev = noise1(0, 3);
    for (let t = 0.01; t < 20; t += 0.01) {
      const v = noise1(t, 3);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      expect(Math.abs(v - prev)).toBeLessThan(0.05);
      prev = v;
    }
    expect(noise1(4.37, 3)).toBe(noise1(4.37, 3));
    expect(noise1(4.37, 3)).not.toBe(noise1(4.37, 4));
    expect(Math.abs(fbm1(2.2, 1))).toBeLessThanOrEqual(1);
  });

  test('a cadence fires at seeded intervals inside its range, the same every run', () => {
    const run = (): number[] => {
      const c = new Cadence(2, 5, 9);
      const at: number[] = [];
      for (let t = 0; t < 60; t += 1 / 60) if (c.due(t)) at.push(t);
      return at;
    };
    const a = run();
    expect(a).toEqual(run());
    for (let i = 1; i < a.length; i++) {
      expect(a[i]! - a[i - 1]!).toBeGreaterThanOrEqual(2 - 1e-6);
      expect(a[i]! - a[i - 1]!).toBeLessThanOrEqual(5 + 1 / 60);
    }
  });

  test('defer pushes the next firing back', () => {
    const c = new Cadence(1, 1.5, 2);
    c.defer(0, 10);
    for (let t = 0; t < 9.9; t += 0.05) expect(c.due(t)).toBe(false);
  });
});
