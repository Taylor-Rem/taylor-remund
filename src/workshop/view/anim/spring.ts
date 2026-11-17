/**
 * Springs: the workhorse of "anticipate, overshoot a little and settle"
 * (REWRITE.md § A "Motion"). A damped harmonic oscillator pulled toward a
 * target, integrated in small fixed sub-steps so the result does not depend
 * on the frame rate (a 30 fps capture and a 144 Hz screen settle alike).
 *
 * Parameters are the natural frequency `omega` (rad/s: how stiff; settle
 * time is roughly 4 / (zeta * omega)) and the damping ratio `zeta`
 * (1 = critically damped, no overshoot; 0.3-0.5 = one or two visible
 * overshoots; below 0.2 = wobbly, for aerials and pennants).
 *
 * Everything runs on the `dt` it is given (simulation time): never a clock
 * of its own.
 */

/** Largest sub-step (seconds). Stiff springs stay stable with semi-implicit Euler below this. */
export const SUBSTEP = 1 / 240;

export interface SpringParams {
  /** Natural frequency, rad/s. */
  omega: number;
  /** Damping ratio: 1 critical, < 1 overshoots. */
  zeta: number;
}

/**
 * Advance one spring state toward `target` by `dt` seconds. Returns the new
 * [x, v]. Pure; for when a class is in the way.
 */
export function springStep(x: number, v: number, target: number, p: SpringParams, dt: number): [number, number] {
  const k = p.omega * p.omega;
  const c = 2 * p.zeta * p.omega;
  let left = Math.max(0, dt);
  while (left > 1e-9) {
    const h = Math.min(left, SUBSTEP);
    v += (k * (target - x) - c * v) * h;
    x += v * h;
    left -= h;
  }
  return [x, v];
}

/** A scalar spring. */
export class Spring implements SpringParams {
  x: number;
  v = 0;
  omega: number;
  zeta: number;

  constructor(x = 0, p: SpringParams = { omega: 12, zeta: 0.6 }) {
    this.x = x;
    this.omega = p.omega;
    this.zeta = p.zeta;
  }

  /** Move toward `target` by `dt` seconds; returns the new value. */
  step(target: number, dt: number): number {
    [this.x, this.v] = springStep(this.x, this.v, target, this, dt);
    return this.x;
  }

  /** Add velocity (an impulse): the way an event hits a spring. */
  kick(dv: number): this {
    this.v += dv;
    return this;
  }

  /** Jump to a value at rest (no motion). */
  set(x: number, v = 0): this {
    this.x = x;
    this.v = v;
    return this;
  }

  /** Change stiffness/damping in place (a heavier load, a reduced-motion pass). */
  tune(p: Partial<SpringParams>): this {
    if (p.omega !== undefined) this.omega = p.omega;
    if (p.zeta !== undefined) this.zeta = p.zeta;
    return this;
  }

  /** At rest within `eps` of the target. */
  settled(target: number, eps = 1e-3): boolean {
    return Math.abs(this.x - target) < eps && Math.abs(this.v) < eps * this.omega;
  }
}

/**
 * A spring on an angle (radians): it takes the short way round, so a heading
 * that jumps from 179 to -179 degrees turns two degrees, not 358.
 */
export class AngleSpring extends Spring {
  override step(target: number, dt: number): number {
    const t = this.x + wrapAngle(target - this.x);
    return super.step(t, dt);
  }
}

/** A fixed-length vector of springs sharing parameters (arm joints, a 2D bend). */
export class SpringVec implements SpringParams {
  readonly x: number[];
  readonly v: number[];
  omega: number;
  zeta: number;

  constructor(x: readonly number[], p: SpringParams = { omega: 12, zeta: 0.6 }) {
    this.x = [...x];
    this.v = x.map(() => 0);
    this.omega = p.omega;
    this.zeta = p.zeta;
  }

  step(target: readonly number[], dt: number): number[] {
    for (let i = 0; i < this.x.length; i++) {
      [this.x[i], this.v[i]] = springStep(this.x[i]!, this.v[i]!, target[i] ?? this.x[i]!, this, dt);
    }
    return this.x;
  }

  kick(dv: readonly number[]): this {
    for (let i = 0; i < this.v.length; i++) this.v[i]! += dv[i] ?? 0;
    return this;
  }

  set(x: readonly number[]): this {
    for (let i = 0; i < this.x.length; i++) {
      this.x[i] = x[i] ?? this.x[i]!;
      this.v[i] = 0;
    }
    return this;
  }

  tune(p: Partial<SpringParams>): this {
    if (p.omega !== undefined) this.omega = p.omega;
    if (p.zeta !== undefined) this.zeta = p.zeta;
    return this;
  }
}

/** An angle in (-π, π]. */
export function wrapAngle(a: number): number {
  const t = (a + Math.PI) % (2 * Math.PI);
  return (t <= 0 ? t + 2 * Math.PI : t) - Math.PI;
}
