/**
 * A few label painters in workers (worker.ts). `paint(job)` resolves with the
 * painted bytes, or rejects (no worker, a worker that could not load the
 * faces, an error): the caller then paints on the main thread. Jobs go to the
 * worker with the fewest texels queued.
 *
 * Browsers: the worker needs OffscreenCanvas 2D and a FontFaceSet of its own
 * (`self.fonts`). Chrome/Edge have both (measured here); Firefox has had
 * OffscreenCanvas 2D since 105 and Safari since 16.4, and both document
 * FontFace in workers, but neither was run here. A browser without them
 * answers 'failed' (or the job's paint throws: a face missing in the worker
 * is caught by the same fallback check as on the main thread) and that
 * label is painted on the main thread exactly as before.
 */
import type { PaintJob, PaintedJob } from './paint.ts';

interface Slot {
  worker: Worker;
  queued: number;
  dead: boolean;
}

export class Pool {
  private slots: Slot[] = [];
  private next = 1;
  private waiting = new Map<number, { slot: Slot; texels: number; register: string; resolve: (p: PaintedJob) => void; reject: (e: Error) => void }>();

  constructor(n: number, fontBase: string) {
    for (let i = 0; i < n; i++) {
      let worker: Worker;
      try {
        worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: `labels-${i}` });
      } catch {
        continue;
      }
      const slot: Slot = { worker, queued: 0, dead: false };
      worker.onmessage = (e: MessageEvent) => this.answer(slot, e.data as Answer);
      worker.onerror = () => this.kill(slot, 'worker error');
      worker.postMessage({ type: 'init', base: new URL(fontBase, globalThis.location?.href).href });
      this.slots.push(slot);
    }
  }

  get size(): number {
    return this.slots.filter((s) => !s.dead).length;
  }

  /** Painting time spent in the workers, per register (ms). */
  readonly spent: Record<string, number> = {};

  paint(job: PaintJob): Promise<PaintedJob> {
    const live = this.slots.filter((s) => !s.dead);
    if (!live.length) return Promise.reject(new Error('labels: no painter worker'));
    const slot = live.reduce((a, b) => (b.queued < a.queued ? b : a));
    const texels = job.plan.px.w * job.plan.px.h;
    slot.queued += texels;
    const id = this.next++;
    return new Promise<PaintedJob>((resolve, reject) => {
      this.waiting.set(id, { slot, texels, register: job.register, resolve, reject });
      slot.worker.postMessage({ type: 'job', id, job });
    });
  }

  private answer(slot: Slot, m: Answer): void {
    if (m.type === 'ready') return;
    if (m.type === 'failed') {
      this.kill(slot, m.error);
      return;
    }
    const w = this.waiting.get(m.id);
    if (!w) return;
    this.waiting.delete(m.id);
    slot.queued -= w.texels;
    if (m.type === 'done') {
      this.spent[w.register] = (this.spent[w.register] ?? 0) + m.ms;
      w.resolve(m.painted);
    }
    else w.reject(new Error(m.error));
  }

  private kill(slot: Slot, why: string): void {
    if (slot.dead) return;
    slot.dead = true;
    slot.worker.terminate();
    for (const [id, w] of this.waiting) {
      if (w.slot !== slot) continue;
      this.waiting.delete(id);
      w.reject(new Error(`labels worker: ${why}`));
    }
  }

  dispose(): void {
    for (const s of this.slots) this.kill(s, 'disposed');
    this.slots = [];
  }
}

type Answer = { type: 'ready' } | { type: 'failed'; error: string } | { type: 'done'; id: number; painted: PaintedJob; ms: number } | { type: 'error'; id: number; error: string };
