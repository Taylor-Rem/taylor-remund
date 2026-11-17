/**
 * The simulation clock (REWRITE.md § E1 "a fixed 60 Hz step"). Time is an
 * integer step count; seconds are derived from it, never accumulated, so
 * step 36000 is exactly 600 s. There is no wall clock in `sim`: the shell
 * decides how many steps to run per frame.
 */

/** Steps per simulation second. */
export const HZ = 60;
/** Seconds per step. */
export const DT = 1 / HZ;

export interface Clock {
  /** Steps taken since the world started. */
  readonly step: number;
  /** Simulation seconds: `step / HZ`. */
  readonly time: number;
  /** Advance one step. */
  tick(): void;
}

export function createClock(start = 0): Clock {
  let step = start;
  return {
    get step() {
      return step;
    },
    get time() {
      return step / HZ;
    },
    tick() {
      step += 1;
    },
  };
}

/** Whole steps in `seconds` (rounded to the nearest step). Timings are written in seconds and run in steps. */
export const steps = (seconds: number): number => Math.max(0, Math.round(seconds * HZ));
