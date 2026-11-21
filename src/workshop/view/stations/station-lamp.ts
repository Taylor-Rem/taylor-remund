/**
 * A station's own lamp, drawn (REWRITE.md § B1 "Lamps mean three things and no more": "A station's own lamp is
 * dark when idle, steady while its verb is running, and blinks slowly as a tell"; § E9: nothing flashes above three
 * a second). One rule for every station, so a tell looks the same wherever it is.
 *
 * The blink is a filament's, not a square wave: it warms up over a quarter second, holds, cools over a quarter
 * second, and rests dark. One cycle every `period` seconds (0.5 a second: well under § E9's three), the same under
 * reduced motion (a slow lamp is allowed there). `lampLevel` is that brightness, 0..1; a station's lit/unlit bulb
 * twin switches at half (`lampOn`), and its glow (view/effects/lamp-halos.ts) follows the level itself, so on and
 * off are soft. Time is simulation time (`Frame.time`), so a capture is deterministic.
 */
import type { LampState } from '../../sim/types.ts';

/** Tune here. Seconds. */
export const STATION_LAMP = {
  /** One blink: warm up, hold, cool, rest dark. */
  period: 2,
  rise: 0.24,
  hold: 0.82,
  fall: 0.3,
} as const;

const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** The blink's brightness at time `t` (0..1). */
export function blinkLevel(t: number): number {
  const L = STATION_LAMP;
  const p = ((t % L.period) + L.period) % L.period;
  if (p < L.rise) return smooth(p / L.rise);
  if (p < L.rise + L.hold) return 1;
  if (p < L.rise + L.hold + L.fall) return 1 - smooth((p - L.rise - L.hold) / L.fall);
  return 0;
}

/** A station lamp's brightness for its state at simulation time `t`: 0 dark, 1 steady, the blink as a tell. */
export function lampLevel(state: LampState, t: number): number {
  if (state === 'dark') return 0;
  if (state === 'steady') return 1;
  return blinkLevel(t);
}

/** Its bulb lit (the lit twin shown) for this state at `t`. */
export function lampOn(state: LampState, t: number): boolean {
  return lampLevel(state, t) >= 0.5;
}
