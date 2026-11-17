/**
 * Seeded smooth noise for the small living motions (a balancing wobble, a
 * pennant's sway). No Math.random: the same seed gives the same wobble on
 * every visit and in every capture.
 */

function hash(i: number, seed: number): number {
  let h = Math.imul(i ^ 0x27d4eb2d, 0x165667b1) ^ Math.imul(seed + 0x61c88647, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Smooth 1D value noise in [-1, 1]: one random value per unit of t, smoothly joined. */
export function noise1(t: number, seed = 0): number {
  const i = Math.floor(t);
  const f = t - i;
  const a = hash(i, seed) * 2 - 1;
  const b = hash(i + 1, seed) * 2 - 1;
  const u = f * f * f * (f * (f * 6 - 15) + 10);
  return a + (b - a) * u;
}

/**
 * A few octaves of noise1 (each twice the frequency and half the size):
 * motion with a slow drift and a little quick correction on top. Roughly
 * in [-1, 1].
 */
export function fbm1(t: number, seed = 0, octaves = 3): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += noise1(t * f, seed + o * 101) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

/**
 * A seeded stream of uniform numbers (mulberry32), for choosing when the
 * next blink or glance comes. View-side and transient: not the simulation's.
 */
export function stream(seed: number): () => number {
  let s = (Math.floor(seed) ^ 0x9e3779b9) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fires at irregular, seeded intervals between `min` and `max` seconds: a
 * blink, a saccade, a glance. Driven by the time it is given.
 */
export class Cadence {
  private next: number;
  private readonly r: () => number;

  constructor(
    public min: number,
    public max: number,
    seed = 1,
    start = 0,
  ) {
    this.r = stream(seed);
    this.next = start + this.gap();
  }

  private gap(): number {
    return this.min + (this.max - this.min) * this.r();
  }

  /** True once when time passes the next moment; schedules the one after. */
  due(t: number): boolean {
    if (t < this.next) return false;
    this.next = Math.max(this.next, t - this.max) + this.gap();
    if (this.next <= t) this.next = t + this.gap();
    return true;
  }

  /** Push the next moment to at least `delay` seconds after t (something else just happened). */
  defer(t: number, delay = this.min): void {
    this.next = Math.max(this.next, t + delay);
  }

  /** A uniform number from this cadence's stream (to vary what fires). */
  random(): number {
    return this.r();
  }
}
