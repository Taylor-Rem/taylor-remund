/**
 * The seeded random number generator. Nothing in the workshop uses
 * `Math.random()` (check-layers enforces it in `sim`).
 *
 * `fork(name)` derives a child from the parent's *seed* and the name, not
 * from the parent's current position, so adding a consumer (or drawing more
 * numbers in one) never shifts another consumer's sequence.
 */

export interface Rng {
  /** The seed path this generator was made from (for debugging and tests). */
  readonly path: string;
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [lo, hi). */
  range(lo: number, hi: number): number;
  /** Integer in [0, n). */
  int(n: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  /** One element of a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** A child generator, independent of how much this one has been used. */
  fork(name: string): Rng;
}

/** 32-bit string hash (FNV-1a followed by a murmur3 finaliser). */
function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** sfc32: small, fast, good statistical quality, 128 bits of state. */
function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

function fromPath(path: string): Rng {
  const gen = sfc32(hash32(`${path}#a`), hash32(`${path}#b`), hash32(`${path}#c`), hash32(`${path}#d`));
  for (let i = 0; i < 12; i++) gen(); // warm up away from the seed
  const r: Rng = {
    path,
    next: gen,
    range: (lo, hi) => lo + (hi - lo) * gen(),
    int: (n) => Math.floor(gen() * n),
    chance: (p) => gen() < p,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error('rng.pick: empty list');
      return items[Math.floor(gen() * items.length)] as T;
    },
    fork: (name) => fromPath(`${path}/${name}`),
  };
  return r;
}

/** A generator for `seed`. The same seed always gives the same sequence. */
export function rng(seed: number | string): Rng {
  return fromPath(String(seed));
}
