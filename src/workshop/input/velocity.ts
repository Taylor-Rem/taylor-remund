/**
 * The throw: the hand's world-space velocity at the moment of release,
 * estimated from where the hand was over its last moments, not from the last
 * event (one event can be 1 ms or 30 ms after the one before it).
 *
 * (R4) `throw()` is what the hand was doing when it threw: the strongest
 * stretch of its last ~140 ms (short windows slid across it), measured along
 * the way it was going at the end. A flick that eases off in its last frames
 * still throws at the speed it had; a hand that has come to rest sets down.
 * `velocity()` is the plain average over a window (kept for the carry's own use
 * and for comparison).
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

  /** The oldest sample's time, or null. */
  oldest(): number | null {
    return this.n > 0 ? this.t[this.at(0)]! : null;
  }

  /** What the hand was doing when it let go (R4): see `throwOf`. */
  throw(now: number, o: Partial<ThrowTuning> = {}): Vec3 {
    return throwOf(this, now, o);
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

/** Tune here (ms, units per second). */
export const THROW_TUNING = {
  /** How far back the throw is looked for. */
  span: 140,
  /** The width of each window slid across it, and its step. Wide enough that one late or doubled event cannot spike it. */
  window: 48,
  step: 6,
  /** The hand's way at the end: its velocity over this last stretch. */
  end: 40,
  /** Slower than this over the last stretch, the hand has come to rest: a set-down, not a throw. */
  rest: 0.6,
  /** The throw is never more than this many times the hand's speed over the last stretch (a flick that stops dead is a set-down). */
  overEnd: 4,
} as const;

export type ThrowTuning = { -readonly [K in keyof typeof THROW_TUNING]: number };

/** A tracker's samples, for the throw estimate (pure, so recorded flicks can be replayed in tests). */
export interface Path {
  velocity(now: number, windowMs: number): Vec3;
  oldest(): number | null;
}

/**
 * What the hand was doing when it let go (R4): the strongest windowed velocity over the last `span` ms, projected
 * on the hand's final direction (only forward motion counts), at least the final velocity itself. A hand at rest
 * at the end throws nothing; a throw is never more than `overEnd` times the end speed (a hand that stopped dead
 * after a flick sets the thing down, it does not throw it).
 */
export function throwOf(path: Path, now: number, o: Partial<ThrowTuning> = {}): Vec3 {
  const T = { ...THROW_TUNING, ...o };
  const end = path.velocity(now, T.end);
  const es = Math.hypot(end[0], end[1], end[2]);
  if (es < T.rest) return end;
  const d: Vec3 = [end[0] / es, end[1] / es, end[2] / es];
  const oldest = path.oldest() ?? now;
  let best = es;
  for (let t = now; t >= Math.max(oldest + T.window, now - T.span + T.window); t -= T.step) {
    const v = path.velocity(t, T.window);
    const along = v[0] * d[0] + v[1] * d[1] + v[2] * d[2];
    if (along > best) best = along;
  }
  const speed = Math.min(best, es * T.overEnd);
  return [d[0] * speed, d[1] * speed, d[2] * speed];
}

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
function set(out: [number, number, number], x: number, y: number, z: number): [number, number, number] {
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}
