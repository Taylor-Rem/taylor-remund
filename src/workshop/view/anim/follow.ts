/**
 * Damped followers: a value that chases a target without overshoot, at a
 * rate independent of the frame rate. For things that should lag but never
 * bounce (a contact shadow, a hover lift, smoothing a measured speed).
 * When it should bounce, use a Spring.
 */
import { wrapAngle } from './spring.ts';

/**
 * Exponential approach: after `dt` seconds `a` has covered 1 - e^(-rate·dt)
 * of the way to `b`. `rate` is in 1/s (about 4.6 / rate seconds to 99%).
 */
export function damp(a: number, b: number, rate: number, dt: number): number {
  return b + (a - b) * Math.exp(-rate * Math.max(0, dt));
}

/** The same on an angle, the short way round. */
export function dampAngle(a: number, b: number, rate: number, dt: number): number {
  return a + wrapAngle(b - a) * (1 - Math.exp(-rate * Math.max(0, dt)));
}

/** Move toward b by at most `maxStep` (a rate limiter: a dial that cannot jump). */
export function approach(a: number, b: number, maxStep: number): number {
  return a < b ? Math.min(b, a + maxStep) : Math.max(b, a - maxStep);
}

/**
 * Measures the rate of change of a signal and smooths it: speed from
 * positions, acceleration from speeds. Feed it once per frame; a teleport is
 * skipped with `reset`.
 */
export class Derivative {
  private last: number | null = null;
  value = 0;

  constructor(readonly rate = 30) {}

  push(x: number, dt: number): number {
    if (this.last !== null && dt > 1e-6) this.value = damp(this.value, (x - this.last) / dt, this.rate, dt);
    this.last = x;
    return this.value;
  }

  /** Forget the last sample (after a jump), keeping or zeroing the value. */
  reset(keep = false): void {
    this.last = null;
    if (!keep) this.value = 0;
  }
}
