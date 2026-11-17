/**
 * The throw: the hand's world-space velocity at the moment of release,
 * estimated from the last ~80 ms of where the hand was, not from the last
 * event (one event can be 1 ms or 30 ms after the one before it).
 *
 * The hand's path is piecewise linear through the samples and holds still
 * after the last one, so a pointer that stopped before letting go throws
 * nothing. The estimate is the average velocity over the window ending at
 * the release: (p(t) − p(t − W)) / W.
 */
import type { Vec3 } from '../sim/types.ts';

const CAP = 64;

export class VelocityTracker {
  private readonly t = new Float64Array(CAP);
  private readonly x = new Float64Array(CAP);
  private readonly y = new Float64Array(CAP);
  private readonly z = new Float64Array(CAP);
  private head = 0; // next write
  private n = 0;

  reset(): void {
    this.head = 0;
    this.n = 0;
  }

  get count(): number {
    return this.n;
  }

  /** A sample at time `t` (ms). Samples must arrive in time order; an older one is dropped. */
  add(t: number, p: Vec3): void {
    if (this.n > 0 && t < this.t[(this.head - 1 + CAP) % CAP]!) return;
    this.t[this.head] = t;
    this.x[this.head] = p[0];
    this.y[this.head] = p[1];
    this.z[this.head] = p[2];
    this.head = (this.head + 1) % CAP;
    this.n = Math.min(CAP, this.n + 1);
  }

  private at(i: number): number {
    // i = 0 is the oldest kept sample
    return (this.head - this.n + i + CAP * 2) % CAP;
  }

  /** Where the hand was at time `t` (ms): linear between samples, held after the last and before the first. */
  position(t: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
    if (this.n === 0) return out;
    const first = this.at(0);
    const last = this.at(this.n - 1);
    if (t <= this.t[first]!) return set(out, this.x[first]!, this.y[first]!, this.z[first]!);
    if (t >= this.t[last]!) return set(out, this.x[last]!, this.y[last]!, this.z[last]!);
    for (let i = this.n - 1; i > 0; i--) {
      const b = this.at(i);
      const a = this.at(i - 1);
      if (this.t[a]! <= t) {
        const span = this.t[b]! - this.t[a]!;
        const k = span > 0 ? (t - this.t[a]!) / span : 1;
        return set(out, lerp(this.x[a]!, this.x[b]!, k), lerp(this.y[a]!, this.y[b]!, k), lerp(this.z[a]!, this.z[b]!, k));
      }
    }
    return set(out, this.x[first]!, this.y[first]!, this.z[first]!);
  }

  /**
   * Average velocity (units per second) over the `windowMs` ending at `now`
   * (ms). With less history than the window, over what there is.
   */
  velocity(now: number, windowMs = 80): Vec3 {
    if (this.n < 2) return [0, 0, 0];
    const oldest = this.t[this.at(0)]!;
    const from = Math.max(oldest, now - windowMs);
    const span = now - from;
    if (span <= 1e-3) return [0, 0, 0];
    const a = this.position(from);
    const b = this.position(now);
    const k = 1000 / span;
    return [(b[0] - a[0]) * k, (b[1] - a[1]) * k, (b[2] - a[2]) * k];
  }
}

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
function set(out: [number, number, number], x: number, y: number, z: number): [number, number, number] {
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}
