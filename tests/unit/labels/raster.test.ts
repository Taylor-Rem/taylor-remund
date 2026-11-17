import { describe, expect, it } from 'vitest';
import { blur, displace, fbm, gray, heightToNormal, sample, shift, toTextureRows, valueNoise } from '../../../src/workshop/view/labels/raster.ts';
import { hashString, jitter, rng } from '../../../src/workshop/view/labels/rng.ts';

describe('rng', () => {
  it('is deterministic per seed, in [0, 1)', () => {
    const a = rng('DO NOT TOUCH');
    const b = rng('DO NOT TOUCH');
    const xs = Array.from({ length: 1000 }, () => a());
    expect(xs).toEqual(Array.from({ length: 1000 }, () => b()));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });
  it('differs between seeds; hashes strings stably', () => {
    expect(rng('a')()).not.toBe(rng('b')());
    expect(hashString('TAYLOR')).toBe(hashString('TAYLOR'));
    expect(hashString('TAYLOR')).not.toBe(hashString('TAYLOS'));
  });
  it('jitter stays within ±amp', () => {
    const r = rng(5);
    for (let i = 0; i < 500; i++) expect(Math.abs(jitter(r, 0.3))).toBeLessThanOrEqual(0.3);
  });
});

describe('raster', () => {
  it('blur keeps a constant image constant and roughly conserves mass', () => {
    const g = gray(40, 30, 0.5);
    expect(Math.max(...blur(g, 3).d)).toBeCloseTo(0.5, 5);
    const dot = gray(41, 41);
    dot.d[20 * 41 + 20] = 1;
    const b = blur(dot, 2);
    expect(b.d.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 3);
    expect(b.d[20 * 41 + 20]!).toBeLessThan(0.2);
  });

  it('a flat height map gives a straight-up normal; a ramp tilts away from the rise', () => {
    const flat = heightToNormal(gray(8, 8, 0.3), 5);
    expect([flat[0], flat[1], flat[2], flat[3]]).toEqual([128, 128, 255, 255]);
    // height rising to the right: the normal leans left (x < 128)
    const ramp = gray(16, 4);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 16; x++) ramp.d[y * 16 + x] = x / 16;
    const n = heightToNormal(ramp, 4);
    expect(n[(1 * 16 + 8) * 4]!).toBeLessThan(128);
    // height rising down the image (toward v = 0): the normal leans up the texture (y > 128)
    const down = gray(4, 16);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 4; x++) down.d[y * 4 + x] = y / 16;
    const m = heightToNormal(down, 4);
    expect(m[(8 * 4 + 1) * 4 + 1]!).toBeGreaterThan(128);
  });

  it('toTextureRows flips rows', () => {
    const a = new Uint8Array([1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3]);
    expect([...toTextureRows(a, 1, 3)]).toEqual([3, 3, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1]);
  });

  it('sample interpolates and clamps; shift and displace move pixels', () => {
    const g = gray(2, 1);
    g.d[1] = 1;
    expect(sample(g, 0.5, 0)).toBeCloseTo(0.5, 9);
    expect(sample(g, 5, 0)).toBe(1);
    const s = shift(g, -1, 0);
    expect([...s.d]).toEqual([1, 0]);
    const d = displace(g, () => 1, () => 0);
    expect(d.d[0]).toBe(1);
  });

  it('noise is seeded, smooth and in [0, 1]', () => {
    const a = valueNoise('s');
    const b = valueNoise('s');
    const f = fbm('s', 4);
    for (let i = 0; i < 200; i++) {
      const x = i * 0.37;
      const y = i * 0.11;
      expect(a(x, y)).toBe(b(x, y));
      expect(a(x, y)).toBeGreaterThanOrEqual(0);
      expect(a(x, y)).toBeLessThanOrEqual(1);
      expect(f(x, y)).toBeGreaterThanOrEqual(0);
      expect(f(x, y)).toBeLessThanOrEqual(1);
      expect(Math.abs(a(x, y) - a(x + 0.001, y))).toBeLessThan(0.01);
    }
  });
});
