/**
 * Eased one-shots keyed off events: something happened at time t0, show it
 * over the next `duration` seconds. They hold no clock: the caller passes
 * the frame's simulation time, so a recording is deterministic and a frozen
 * world freezes them too (pass a time that does not move).
 */
import { bump, clamp01, type Ease, linear } from './ease.ts';

export class OneShot {
  private t0 = -Infinity;
  duration: number;
  ease: Ease;

  constructor(duration: number, ease: Ease = linear) {
    this.duration = duration;
    this.ease = ease;
  }

  /** Start (or restart) at time t. */
  fire(t: number): this {
    this.t0 = t;
    return this;
  }

  /** Stop: reads as finished. */
  stop(): this {
    this.t0 = -Infinity;
    return this;
  }

  /** Seconds since fired (Infinity if never). */
  age(t: number): number {
    return t - this.t0;
  }

  /** Raw progress 0..1 (1 when finished or never fired). */
  progress(t: number): number {
    return this.duration <= 0 ? 1 : clamp01((t - this.t0) / this.duration);
  }

  /** Eased progress. */
  value(t: number): number {
    return this.ease(this.progress(t));
  }

  /** True while it plays. */
  active(t: number): boolean {
    const a = t - this.t0;
    return a >= 0 && a < this.duration;
  }
}

/**
 * An envelope that rises, holds and falls once when fired: 0 → 1 → 0 over
 * `attack + hold + release` seconds, eased. A flinch, a blink, a squash.
 */
export class Envelope {
  private t0 = -Infinity;
  attack: number;
  hold: number;
  release: number;

  constructor(attack: number, hold: number, release: number) {
    this.attack = attack;
    this.hold = hold;
    this.release = release;
  }

  fire(t: number): this {
    this.t0 = t;
    return this;
  }

  get duration(): number {
    return this.attack + this.hold + this.release;
  }

  value(t: number): number {
    const d = this.duration;
    const a = t - this.t0;
    if (!(a > 0) || a >= d) return 0;
    return bump(a / d, this.attack / d, this.release / d);
  }

  active(t: number): boolean {
    const a = t - this.t0;
    return a >= 0 && a < this.duration;
  }
}
