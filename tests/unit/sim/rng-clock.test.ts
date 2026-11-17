import { describe, expect, test } from 'vitest';
import { rng } from '../../../src/workshop/sim/rng.ts';
import { createClock, DT, HZ, steps } from '../../../src/workshop/sim/clock.ts';

const draw = (r: { next(): number }, n: number): number[] => Array.from({ length: n }, () => r.next());

describe('rng', () => {
  test('the same seed gives the same sequence; different seeds differ', () => {
    expect(draw(rng(42), 50)).toEqual(draw(rng(42), 50));
    expect(draw(rng('42'), 5)).toEqual(draw(rng(42), 5));
    expect(draw(rng(42), 5)).not.toEqual(draw(rng(43), 5));
  });

  test('values stay in range', () => {
    const r = rng(7);
    for (let i = 0; i < 2000; i++) {
      const x = r.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      const k = r.int(6);
      expect(Number.isInteger(k) && k >= 0 && k < 6).toBe(true);
      const y = r.range(-2, 3);
      expect(y >= -2 && y < 3).toBe(true);
    }
    expect(() => r.pick([])).toThrow();
  });

  test('a fork does not depend on how much the parent or a sibling has been used', () => {
    const a = rng(9);
    const fresh = draw(a.fork('fetch'), 10);
    const b = rng(9);
    draw(b, 1000);
    draw(b.fork('button'), 1000);
    expect(draw(b.fork('fetch'), 10)).toEqual(fresh);
  });

  test('forks are distinct from each other and from the parent', () => {
    const r = rng(1);
    expect(draw(r.fork('a'), 5)).not.toEqual(draw(r.fork('b'), 5));
    expect(draw(rng(1).fork('a'), 5)).not.toEqual(draw(rng(1), 5));
    expect(r.fork('a').fork('b').path).toBe('1/a/b');
  });

  test('roughly uniform', () => {
    const r = rng('uniform');
    const bins = new Array<number>(10).fill(0);
    for (let i = 0; i < 20000; i++) bins[Math.floor(r.next() * 10)]! += 1;
    for (const b of bins) expect(Math.abs(b - 2000)).toBeLessThan(200);
  });
});

describe('clock', () => {
  test('fixed 60 Hz steps; time is derived from the step count, never accumulated', () => {
    const c = createClock();
    expect(c.step).toBe(0);
    expect(c.time).toBe(0);
    for (let i = 0; i < 36000; i++) c.tick();
    expect(c.step).toBe(36000);
    expect(c.time).toBe(600);
    expect(HZ).toBe(60);
    expect(DT).toBe(1 / 60);
  });

  test('seconds become whole steps', () => {
    expect(steps(1)).toBe(60);
    expect(steps(1.2)).toBe(72);
    expect(steps(0.3)).toBe(18);
    expect(steps(-1)).toBe(0);
  });
});
