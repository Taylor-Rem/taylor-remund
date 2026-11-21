/**
 * The float at the top of a throw up (R4, R5; Taylor, 2026-11-20: "a brief hang at the apex, but it shouldn't
 * interrupt significant horizontal movement or feel like an accidental freeze"). One function and one set of numbers
 * for both Patches: the scripted one (`patch.ts`, which steps its own arc) and the one with a real body
 * (`patch-body.ts`, which eases the engine's gravity on the body).
 *
 * A throw's WEIGHT (0..1) is how much it floats at all, decided as it leaves the hand: all of it within about ten
 * degrees of straight up, fading smoothly to none by about thirty; and none for a hop of less than `upFrom` units/s
 * upward, all of it from `upFull`. Near the top its PULL (the share of the world's gravity it feels) dips to
 * 1 - depth x weight and is whole again within a few `band`s of upward speed either side: its upward speed passes
 * through nothing smoothly, it is never still, and its sideways drift is untouched. With these numbers a throw
 * straight up is in the air about 0.15 s longer than without (the old dead stop was 0.15 s too).
 */
import type { Vec3 } from '../types.ts';

export const PATCH_FLOAT = {
  /** It fades in with the throw's upward speed between these (units/s): a little hop does not hang. */
  upFrom: 2.5,
  upFull: 5,
  /**
   * ...and out as the throw leans over, by its level speed as a share of its upward speed: all of it to `leanFrom`
   * (10 degrees off straight up: a hand meaning straight up is rarely truer), none from `leanTo` (30 degrees).
   */
  leanFrom: 0.18,
  leanTo: 0.58,
  /** At the very top gravity is eased by this much (never switched off)... */
  depth: 0.85,
  /** ...and by a bell of this width in upward speed (units/s) either side of the top. */
  band: 0.46,
  /** "In the float" (`PatchView.thrown.top`): the pull down by more than this. */
  topBelow: 2 / 3,
} as const;

const smooth = (a: number, b: number, x: number): number => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/** How much a throw leaving at `v` floats at its top: 1 straight up and hard, smoothly to 0 as it leans over or was barely thrown up. */
export function floatWeight(v: Vec3): number {
  const F = PATCH_FLOAT;
  if (v[1] <= 0) return 0;
  return smooth(F.upFrom, F.upFull, v[1]) * (1 - smooth(F.leanFrom, F.leanTo, Math.hypot(v[0], v[2]) / v[1]));
}

/** The share of the world's gravity a throw of this weight feels with upward speed `vy` (1 away from the top). */
export function floatPull(weight: number, vy: number): number {
  const F = PATCH_FLOAT;
  return 1 - weight * F.depth * Math.exp(-((vy / F.band) ** 2));
}

/** How much of its float is on (0 away from the top .. 1 at the very top of the most vertical throw). */
export function floatNow(weight: number, vy: number): number {
  return (1 - floatPull(weight, vy)) / PATCH_FLOAT.depth;
}

/** Is it "in the float": its pull down by more than a third? */
export function inFloat(weight: number, vy: number): boolean {
  return weight > 0 && floatPull(weight, vy) < PATCH_FLOAT.topBelow;
}
