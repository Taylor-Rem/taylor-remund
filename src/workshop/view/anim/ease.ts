/**
 * Easing curves and the small numeric helpers every animation needs.
 * Mechanical motion wants ease-in-out and back (anticipation, overshoot);
 * never the linear slides an interface uses.
 */

export type Ease = (t: number) => number;

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const clamp01 = (v: number): number => clamp(v, 0, 1);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Where v sits between a and b, 0..1 (clamped). */
export const unlerp = (a: number, b: number, v: number): number => (a === b ? (v >= b ? 1 : 0) : clamp01((v - a) / (b - a)));
/** Map v from [a0, a1] to [b0, b1], clamped. */
export const remap = (v: number, a0: number, a1: number, b0: number, b1: number): number => lerp(b0, b1, unlerp(a0, a1, v));
export const smoothstep = (a: number, b: number, v: number): number => {
  const t = unlerp(a, b, v);
  return t * t * (3 - 2 * t);
};

export const linear: Ease = (t) => clamp01(t);
export const inQuad: Ease = (t) => clamp01(t) ** 2;
export const outQuad: Ease = (t) => 1 - (1 - clamp01(t)) ** 2;
export const inOutQuad: Ease = (t) => {
  const x = clamp01(t);
  return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
};
export const inCubic: Ease = (t) => clamp01(t) ** 3;
export const outCubic: Ease = (t) => 1 - (1 - clamp01(t)) ** 3;
export const inOutCubic: Ease = (t) => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
};
export const outExpo: Ease = (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * clamp01(t)));

/** Overshoots past 1 and comes back: `s` sets how far (1.7 ≈ 10%). */
export const outBack = (s = 1.70158): Ease => (t) => {
  const x = clamp01(t) - 1;
  return 1 + (s + 1) * x * x * x + s * x * x;
};
/** Pulls back below 0 first (anticipation), then goes. */
export const inBack = (s = 1.70158): Ease => (t) => {
  const x = clamp01(t);
  return (s + 1) * x * x * x - s * x * x;
};
/** Anticipate and overshoot. */
export const inOutBack = (s = 1.70158): Ease => (t) => {
  const x = clamp01(t);
  const c = s * 1.525;
  return x < 0.5 ? ((2 * x) ** 2 * ((c + 1) * 2 * x - c)) / 2 : ((2 * x - 2) ** 2 * ((c + 1) * (x * 2 - 2) + c) + 2) / 2;
};

/**
 * 0 → 1 → 0 over [0, 1]: rises over the first `up` of it, holds, falls over
 * the last `down`. Eased both ways. A blink, a nod, a flinch.
 */
export function bump(t: number, up = 0.3, down = 0.5): number {
  if (t <= 0 || t >= 1) return 0;
  if (t < up) return inOutQuad(t / up);
  if (t > 1 - down) return inOutQuad((1 - t) / down);
  return 1;
}
