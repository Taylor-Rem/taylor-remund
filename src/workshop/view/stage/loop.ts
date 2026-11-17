/**
 * The frame loop (REWRITE.md § E7, W1 brief § 2): a fixed 60 Hz simulation
 * step with render interpolation.
 *
 * Each animation frame accumulates real time, calls `step()` 0..n times
 * (clamped, so a long pause or a slow frame never spirals), then renders
 * with `alpha`, how far the clock is between the previous step and the
 * current one. Manual mode, for captures and tests, takes the wall clock out
 * entirely: `advance(n)` runs n steps and renders one frame.
 *
 * The loop stops drawing while the tab is hidden and does not try to catch up
 * the hidden time when it comes back.
 */

export interface FixedStepOptions {
  /** Simulation steps per second. */
  hz?: number;
  /** At most this many steps per frame; extra accumulated time is dropped. */
  maxSteps?: number;
  /** A frame delta longer than this (seconds) counts as this long. */
  maxDelta?: number;
}

export interface Tick {
  /** Steps to run this frame. */
  steps: number;
  /** 0..1: where the render sits between the previous step and the current one. */
  alpha: number;
  /** Seconds of real time dropped this frame because of the clamps. */
  dropped: number;
}

/** The accumulator: pure, no clock of its own. */
export class FixedStep {
  readonly hz: number;
  readonly dt: number;
  readonly maxSteps: number;
  readonly maxDelta: number;
  private acc = 0;

  constructor(opts: FixedStepOptions = {}) {
    this.hz = opts.hz ?? 60;
    this.dt = 1 / this.hz;
    this.maxSteps = opts.maxSteps ?? 5;
    this.maxDelta = opts.maxDelta ?? 0.25;
  }

  /** Feed `seconds` of real time; get how many steps to run and the interpolation factor. */
  tick(seconds: number): Tick {
    let dropped = 0;
    let s = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
    if (s > this.maxDelta) {
      dropped += s - this.maxDelta;
      s = this.maxDelta;
    }
    this.acc += s;
    // A tiny epsilon so 1/60 s of input reliably yields one step despite float error.
    let steps = Math.floor((this.acc + 1e-9) / this.dt);
    if (steps > this.maxSteps) {
      dropped += (steps - this.maxSteps) * this.dt;
      steps = this.maxSteps;
      this.acc = this.dt * steps; // the excess is dropped: no spiral of death
    }
    this.acc = Math.max(0, this.acc - steps * this.dt);
    return { steps, alpha: Math.min(1, this.acc / this.dt), dropped };
  }

  reset(): void {
    this.acc = 0;
  }
}

export interface RenderInfo {
  /** 0..1 between the previous and the current simulation step. */
  alpha: number;
  /** Real seconds since the last rendered frame (clamped), 1/hz × n in manual mode. */
  dt: number;
  /** Simulation seconds, interpolated: (steps − 1 + alpha) / hz, never negative. */
  time: number;
  /** Total simulation steps run so far. */
  steps: number;
}

export interface LoopOptions extends FixedStepOptions {
  step(): void;
  render(info: RenderInfo): void;
  /** Start in manual mode (captures): no animation frames until `setManual(false)`. */
  manual?: boolean;
}

/** What the loop needs from the browser; injectable so tests can drive it. */
export interface LoopEnv {
  now(): number;
  raf(cb: (t: number) => void): number;
  caf(id: number): void;
  /** Subscribe to visibility; returns an unsubscribe. `hidden()` reads it now. */
  onVisibility?(cb: () => void): () => void;
  hidden?(): boolean;
}

export interface Loop {
  start(): void;
  stop(): void;
  readonly running: boolean;
  readonly manual: boolean;
  /** Manual mode on: the wall clock stops driving the loop. */
  setManual(on: boolean): void;
  /** Run n steps, then render one frame. Works in either mode; deterministic in manual mode. */
  advance(n: number): void;
  /** Simulation steps run so far. */
  readonly steps: number;
  /** Real milliseconds between the last N rendered animation frames (newest last). */
  frameTimes(): number[];
  /** Forget the collected frame times (the start of a measured window). */
  clearFrameTimes(): void;
  dispose(): void;
}

function browserEnv(): LoopEnv {
  return {
    now: () => performance.now(),
    raf: (cb) => requestAnimationFrame(cb),
    caf: (id) => cancelAnimationFrame(id),
    onVisibility: (cb) => {
      document.addEventListener('visibilitychange', cb);
      return () => document.removeEventListener('visibilitychange', cb);
    },
    hidden: () => document.hidden,
  };
}

const FRAME_HISTORY = 1200;

export function createLoop(opts: LoopOptions, env: LoopEnv = browserEnv()): Loop {
  const clock = new FixedStep(opts);
  let rafId: number | null = null;
  let wanted = false; // start() called and not stopped
  let manual = opts.manual ?? false;
  let last: number | null = null;
  let steps = 0;
  const frames: number[] = [];

  const info = (alpha: number, dt: number): RenderInfo => ({
    alpha,
    dt,
    time: Math.max(0, (steps - 1 + alpha) / clock.hz),
    steps,
  });

  const frame = (t: number): void => {
    rafId = null;
    if (!wanted || manual) return;
    const now = Number.isFinite(t) ? t : env.now();
    const deltaMs = last === null ? 0 : now - last;
    if (last !== null) {
      frames.push(deltaMs);
      if (frames.length > FRAME_HISTORY) frames.shift();
    }
    last = now;
    const tick = clock.tick(deltaMs / 1000);
    for (let i = 0; i < tick.steps; i++) {
      opts.step();
      steps++;
    }
    opts.render(info(tick.alpha, Math.min(deltaMs / 1000, clock.maxDelta)));
    schedule();
  };

  const schedule = (): void => {
    if (rafId === null && wanted && !manual && !(env.hidden?.() ?? false)) rafId = env.raf(frame);
  };

  const halt = (): void => {
    if (rafId !== null) env.caf(rafId);
    rafId = null;
    last = null; // coming back never tries to catch up the gap
    clock.reset();
  };

  const offVisibility = env.onVisibility?.(() => {
    if (env.hidden?.()) halt();
    else schedule();
  });

  return {
    start() {
      wanted = true;
      schedule();
    },
    stop() {
      wanted = false;
      halt();
    },
    get running() {
      return rafId !== null;
    },
    get manual() {
      return manual;
    },
    setManual(on: boolean) {
      manual = on;
      if (on) halt();
      else schedule();
    },
    advance(n: number) {
      const k = Math.max(0, Math.floor(n));
      for (let i = 0; i < k; i++) {
        opts.step();
        steps++;
      }
      opts.render(info(1, k / clock.hz));
    },
    get steps() {
      return steps;
    },
    frameTimes() {
      return frames.slice();
    },
    clearFrameTimes() {
      frames.length = 0;
    },
    dispose() {
      wanted = false;
      halt();
      offVisibility?.();
    },
  };
}
