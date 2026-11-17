/**
 * Seeded randomness for label textures. Pure; runs in Node.
 *
 * The kit's shared `rng(seed)` does not exist yet on `rewrite`; this is the
 * same idea kept local to labels (mulberry32 over a 32-bit FNV-1a hash of
 * the label's key) so every label is the same picture on every visit. Swap
 * for the kit's rng when it lands; the tests pin determinism, not values.
 */

export type Rng = () => number;

/** 32-bit FNV-1a of a string. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a small, fast, well-mixed 32-bit generator. Returns numbers in [0, 1). */
export function rng(seed: number | string): Rng {
  let a = (typeof seed === 'string' ? hashString(seed) : seed) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform in [-1, 1) times `amp`. */
export function jitter(r: Rng, amp: number): number {
  return (r() * 2 - 1) * amp;
}
