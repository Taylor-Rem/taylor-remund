/**
 * R2: the loop that must not die (Taylor's coworkers, 2026-11-19: "the simulation freezes").
 *
 * One uncaught error in a step or a frame used to stop the animation loop: a frozen bench, and no word. The
 * guard decides what happens instead, in two modes:
 *
 * - **Strict** (development, Node and Vitest, every Playwright run, `?strict=1`): nothing is caught. Every
 *   error is thrown exactly as before, so no test can pass over a swallowed error.
 * - **Lenient** (the production page; `?strict=0` forces it): an error is reported to the console once per
 *   distinct fault, with the step, the unit, the last intents and events; then:
 *   - in the simulation (a machine's or crew member's part of a step, an intent, the world's own physics:
 *     `World.advance` skips that unit for the rest of the step): a second fault from any unit within
 *     `REPEAT_MS`, or any fault of the world itself, puts the bench back to its opening state
 *     (`World.recover`: an open rung closed, the hand emptied, "Reset the workshop");
 *   - in a view, the sound, the ui's per-frame hooks, the input or the stage's render: that unit is not run
 *     for `VIEW_PAUSE_MS`, then tried again; after three faults in 10 s it is tried every `VIEW_SLOW_MS`.
 *     Never frozen for good: its sim keeps moving and it catches up when it next runs;
 *   - three resets within 60 s: the world is rebuilt from scratch (a cold start of the page); if that does
 *     not hold either, the stage stops and the still picture stays, as when the stage fails to start.
 *
 * Nothing leaves the browser. The count and the last report are kept for scripts (`faults()`).
 */
import type { Intent, SimEvent, StepFault } from '../sim/index.ts';

export const GUARD_TUNING = {
  /** A second simulation fault (any unit) within this long of the last puts the bench back. */
  REPEAT_MS: 3000,
  /** A view (or sound, ui, input, stage) that threw is not run for this long, then tried again. */
  VIEW_PAUSE_MS: 1000,
  /** ...and after `VIEW_SLOW_AFTER` faults within `VIEW_SLOW_WINDOW_MS`, tried only this often. */
  VIEW_SLOW_MS: 5000,
  VIEW_SLOW_AFTER: 3,
  VIEW_SLOW_WINDOW_MS: 10_000,
  /** This many resets within `RESETS_WINDOW_MS` and the world is rebuilt from scratch. */
  RESETS: 3,
  RESETS_WINDOW_MS: 60_000,
  /** What a report carries. */
  INTENTS: 20,
  EVENTS: 50,
} as const;

export interface FaultReport {
  readonly unit: string;
  readonly phase: string;
  readonly message: string;
  readonly stack: string;
  readonly step: number;
  readonly at: number;
  readonly intents: readonly Intent[];
  readonly events: readonly SimEvent[];
  readonly action: 'skipped' | 'reset' | 'paused' | 'rebuild';
}

export interface FaultCounts {
  /** Every fault caught, since the page started. */
  readonly count: number;
  readonly resets: number;
  /** The last report, or null. */
  readonly last: FaultReport | null;
}

export interface GuardOptions {
  readonly strict: boolean;
  readonly now?: () => number;
  /** The world's step now (for reports). */
  readonly step?: () => number;
  /** Put the bench back to its opening state (`World.recover`). */
  readonly recover: () => void;
  /** Three resets in a minute: rebuild from scratch, or stop and leave the picture. */
  readonly rebuild: () => void;
  readonly log?: (message: string, report: FaultReport) => void;
}

/** Strict unless lenient was asked for: the production page, without `?strict=1`, and not under automation (unless `?strict=0`). */
export function strictMode(env: { dev: boolean; search: string; webdriver: boolean }): boolean {
  const q = new URLSearchParams(env.search).get('strict');
  if (q === '1') return true;
  if (q === '0') return false;
  return env.dev || env.webdriver;
}

export class FaultGuard {
  readonly strict: boolean;
  private readonly o: GuardOptions;
  private readonly now: () => number;
  private readonly seen = new Set<string>();
  private readonly intents: Intent[] = [];
  private readonly events: SimEvent[] = [];
  private lastSimFault = -Infinity;
  private resetTimes: number[] = [];
  private wantReset = false;
  private readonly paused = new Map<string, { until: number; faults: number[] }>();
  private n = 0;
  private resetsDone = 0;
  private lastReport: FaultReport | null = null;

  constructor(o: GuardOptions) {
    this.o = o;
    this.strict = o.strict;
    this.now = o.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  }

  /** What a script can read: how many faults, how many resets, the last report. */
  faults(): FaultCounts {
    return { count: this.n, resets: this.resetsDone, last: this.lastReport };
  }

  /** Remember an intent (the report carries the last few). */
  noteIntent(i: Intent): void {
    if (i.type === 'carry' || i.type === 'hover') return;
    this.intents.push(i);
    if (this.intents.length > GUARD_TUNING.INTENTS) this.intents.shift();
  }
  /** Remember a step's events. */
  noteEvents(ev: readonly SimEvent[]): void {
    for (const e of ev) {
      this.events.push(e);
      if (this.events.length > GUARD_TUNING.EVENTS) this.events.shift();
    }
  }

  /** A fault in the simulation (`WorldOptions.onFault`). */
  stepFault(f: StepFault): void {
    const now = this.now();
    const reset = f.unit === 'world' || now - this.lastSimFault < GUARD_TUNING.REPEAT_MS;
    this.lastSimFault = now;
    if (reset) this.wantReset = true;
    this.report(`${f.unit}`, f.phase, f.error, reset ? 'reset' : 'skipped');
  }

  /** After each step: put the bench back if a fault asked for it. */
  afterStep(): void {
    if (!this.wantReset) return;
    this.wantReset = false;
    this.lastSimFault = -Infinity;
    const now = this.now();
    this.resetTimes = this.resetTimes.filter((t) => now - t < GUARD_TUNING.RESETS_WINDOW_MS);
    this.resetTimes.push(now);
    this.resetsDone++;
    if (this.resetTimes.length >= GUARD_TUNING.RESETS) {
      this.resetTimes = [];
      this.report('world', 'reset', new Error(`${GUARD_TUNING.RESETS} resets within ${GUARD_TUNING.RESETS_WINDOW_MS / 1000} s`), 'rebuild');
      this.o.rebuild();
      return;
    }
    try {
      this.o.recover();
    } catch (e) {
      this.report('world', 'reset', e, 'rebuild');
      this.o.rebuild();
    }
  }

  /**
   * Run a unit that is not the simulation (a view, the sound, a ui hook, the input, the stage's render).
   * Strict: just runs it. Lenient: skipped while it is paused after a fault; a throw pauses it.
   */
  run(unit: string, f: () => void): void {
    if (this.strict) {
      f();
      return;
    }
    const p = this.paused.get(unit);
    const now = this.now();
    if (p && now < p.until) return;
    try {
      f();
    } catch (e) {
      const st = p ?? { until: 0, faults: [] };
      st.faults = st.faults.filter((t) => now - t < GUARD_TUNING.VIEW_SLOW_WINDOW_MS);
      st.faults.push(now);
      st.until = now + (st.faults.length >= GUARD_TUNING.VIEW_SLOW_AFTER ? GUARD_TUNING.VIEW_SLOW_MS : GUARD_TUNING.VIEW_PAUSE_MS);
      this.paused.set(unit, st);
      this.report(unit, 'frame', e, 'paused');
    }
  }

  /** The loop's last resort: an error that escaped everything else. Lenient: report it, put the bench back, carry on. */
  escaped(e: unknown): boolean {
    if (this.strict) return false;
    this.wantReset = true;
    this.report('loop', 'frame', e, 'reset');
    try {
      this.afterStep();
    } catch (e2) {
      this.report('loop', 'reset', e2, 'rebuild');
      this.o.rebuild();
    }
    return true;
  }

  private report(unit: string, phase: string, error: unknown, action: FaultReport['action']): void {
    this.n++;
    const err = error instanceof Error ? error : new Error(String(error));
    const r: FaultReport = {
      unit,
      phase,
      message: err.message,
      stack: err.stack ?? '',
      step: this.o.step?.() ?? -1,
      at: this.now(),
      intents: [...this.intents],
      events: [...this.events],
      action,
    };
    this.lastReport = r;
    const key = `${unit}|${phase}|${err.message}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    (this.o.log ?? ((m, rep) => console.error(m, rep)))(`workshop: ${unit} (${phase}) threw at step ${r.step}; ${action}: ${err.message}`, r);
  }
}

