/**
 * Input latency (REWRITE.md § E0 feel targets): for each intent the visitor
 * causes, the milliseconds from the DOM event to the first simulation step
 * that handles it, and to the first rendered frame after that step.
 */
import type { Intent } from '../sim/types.ts';

export interface LatencyStat {
  n: number;
  last: number;
  median: number;
  p95: number;
  max: number;
}

export interface LatencyReport {
  /** By intent type: DOM event → the step that handled it. */
  step: Record<string, LatencyStat>;
  /** By intent type: DOM event → the end of the first render after that step. */
  frame: Record<string, LatencyStat>;
}

const KEEP = 200;

function stat(xs: readonly number[]): LatencyStat {
  const a = [...xs].sort((p, q) => p - q);
  const pick = (f: number): number => (a.length ? a[Math.min(a.length - 1, Math.floor(f * a.length))]! : 0);
  return { n: xs.length, last: xs[xs.length - 1] ?? 0, median: pick(0.5), p95: pick(0.95), max: a[a.length - 1] ?? 0 };
}

export class LatencyMeter {
  private queued: { type: string; t: number }[] = [];
  private stepped: { type: string; t: number }[] = [];
  private readonly steps = new Map<string, number[]>();
  private readonly frames = new Map<string, number[]>();

  /** An intent was dispatched; `t` is its DOM event's time (ms, same clock as `now`). */
  dispatched(intent: Intent, t: number): void {
    if (!Number.isFinite(t)) return;
    this.queued.push({ type: intent.type, t });
  }

  /** A simulation step ran (it handled every intent queued before it). */
  step(now: number): void {
    if (!this.queued.length) return;
    for (const q of this.queued) {
      push(this.steps, q.type, now - q.t);
      this.stepped.push(q);
    }
    this.queued = [];
  }

  /** A frame was rendered. */
  rendered(now: number): void {
    if (!this.stepped.length) return;
    for (const q of this.stepped) push(this.frames, q.type, now - q.t);
    this.stepped = [];
  }

  report(): LatencyReport {
    const out: LatencyReport = { step: {}, frame: {} };
    for (const [k, v] of this.steps) out.step[k] = stat(v);
    for (const [k, v] of this.frames) out.frame[k] = stat(v);
    return out;
  }

  reset(): void {
    this.queued = [];
    this.stepped = [];
    this.steps.clear();
    this.frames.clear();
  }
}

function push(m: Map<string, number[]>, k: string, v: number): void {
  let a = m.get(k);
  if (!a) m.set(k, (a = []));
  a.push(v);
  if (a.length > KEEP) a.shift();
}
