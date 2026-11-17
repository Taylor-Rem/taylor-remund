/**
 * Seeded randomness for the "nothing is perfect" rule (REWRITE.md § A).
 * Every random choice in the kit comes from here; never Math.random().
 */
import { Matrix4 } from 'three';

export interface Rng {
  /** Uniform in [0, 1). */
  (): number;
  /** Uniform in [a, b). */
  range(a: number, b: number): number;
  /** Uniform in [-m, m). */
  spread(m: number): number;
  /** Integer in [a, b] inclusive. */
  int(a: number, b: number): number;
  /** One element of a non-empty list. */
  pick<T>(list: readonly T[]): T;
  /** A new independent stream derived from this one (stable for the same parent seed and salt). */
  fork(salt: number): Rng;
}

/** Hash two integers to a 32-bit unsigned int (for deriving seeds). */
export function hash2(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** mulberry32: small, fast, good enough for seeded look variation. */
export function rng(seed: number): Rng {
  let s = hash2(Math.floor(seed) | 0, 0x2545f491) >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = next as Rng;
  r.range = (a, b) => a + (b - a) * next();
  r.spread = (m) => (next() * 2 - 1) * m;
  r.int = (a, b) => a + Math.floor(next() * (b - a + 1));
  r.pick = <T>(list: readonly T[]): T => {
    const v = list[Math.floor(next() * list.length)];
    if (v === undefined) throw new Error('rng.pick: empty list');
    return v;
  };
  r.fork = (salt) => rng(hash2(Math.floor(next() * 4294967296), salt));
  return r;
}

const DEG = Math.PI / 180;

/**
 * A small seeded "off true" rotation: up to `degrees` about Y (the visible
 * one: things sit a degree or two askew on the bench) and a third of that
 * about X and Z. Returns a rotation matrix.
 */
export function askew(seed: number, degrees = 1.5): Matrix4 {
  const r = rng(seed);
  const y = r.spread(degrees) * DEG;
  const x = r.spread(degrees / 3) * DEG;
  const z = r.spread(degrees / 3) * DEG;
  return new Matrix4().makeRotationY(y).multiply(new Matrix4().makeRotationX(x)).multiply(new Matrix4().makeRotationZ(z));
}
