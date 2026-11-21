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
import workerUrl from './worker.ts?worker&url';

/**
 * The painter's script, fetched ONCE (B1 round 2: four `new Worker(url)` were
 * four downloads on a cold load) and handed to every worker as a blob URL.
 * The worker bundle is one self-contained script (no imports), so a blob runs
 * it unchanged. Start it early with `prefetchLabelWorker()`; if the fetch
 * fails the workers load the URL themselves, as before.
 */
let source: Promise<string> | null = null;
export function prefetchLabelWorker(): Promise<string> {
  source ??= (async () => {
    try {
      if (typeof fetch !== 'function' || typeof URL.createObjectURL !== 'function') return workerUrl;
      // (E1) under the dev server the worker is a module with imports ('/node_modules/vite/…'), which a blob
      // cannot resolve: WebKit threw "Module name … does not resolve to a valid URL". Only a build bundles it.
      if (import.meta.env?.DEV) return workerUrl;
      const r = await fetch(workerUrl);
      if (!r.ok) return workerUrl;
      return URL.createObjectURL(new Blob([await r.text()], { type: 'text/javascript' }));
    } catch {
      return workerUrl;
    }
  })();
  return source;
}

/** A worker that exists once the script is in: messages sent before then wait, in order. */
class LateWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  private real: Worker | null = null;
  private queue: Array<[unknown, Transferable[]]> = [];
  private dead = false;
  constructor(name: string) {
    void prefetchLabelWorker().then((url) => {
      if (this.dead) return;
      try {
        const w = new Worker(url, { type: 'module', name });
        w.onmessage = (e) => this.onmessage?.(e);
        w.onerror = (e) => this.onerror?.(e);
        this.real = w;
        for (const [m, t] of this.queue.splice(0)) w.postMessage(m, t);
      } catch (e) {
        this.onerror?.(new ErrorEvent('error', { message: String(e) }));
      }
    });
  }
  postMessage(m: unknown, transfer: Transferable[] = []): void {
    if (this.real) this.real.postMessage(m, transfer);
    else this.queue.push([m, transfer]);
  }
  terminate(): void {
    this.dead = true;
    this.real?.terminate();
    this.queue = [];
  }
}

interface Slot {
  worker: LateWorker;
  queued: number;
  dead: boolean;
}

export class Pool {
  private slots: Slot[] = [];
  private next = 1;
  private waiting = new Map<number, { slot: Slot; texels: number; register: string; resolve: (p: PaintedJob) => void; reject: (e: Error) => void }>();

  private answered = 0;
  private onAnswered: Array<() => void> = [];

  /** Start `n` workers (their scripts load meanwhile); `init` hands them the faces. */
  constructor(n: number) {
    for (let i = 0; i < n; i++) {
      if (typeof Worker === 'undefined') continue;
      const worker = new LateWorker(`labels-${i}`);
      const slot: Slot = { worker, queued: 0, dead: false };
      worker.onmessage = (e: MessageEvent) => this.answer(slot, e.data as Answer);
      worker.onerror = () => this.kill(slot, 'worker error');
      this.slots.push(slot);
    }
  }

  /** Give every worker the faces (bytes from the main thread, else their URLs). */
  init(fontBase: string, fonts: ReadonlyMap<string, ArrayBuffer>): void {
    for (const slot of this.slots) {
      const files = Object.fromEntries([...fonts].map(([family, b]) => [family, b.slice(0)]));
      slot.worker.postMessage({ type: 'init', base: new URL(fontBase, globalThis.location?.href).href, files }, Object.values(files));
    }
  }

  /** Resolves when every worker has said it is ready (or failed). */
  ready(): Promise<void> {
    if (this.answered >= this.slots.length) return Promise.resolve();
    return new Promise((r) => this.onAnswered.push(r));
  }

  private settle(): void {
    this.answered++;
    if (this.answered >= this.slots.length) for (const r of this.onAnswered.splice(0)) r();
  }

  get size(): number {
    return this.slots.filter((s) => !s.dead).length;
  }

  /** When each worker had its faces (performance.now()). */
  readonly readyAt: number[] = [];
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
    if (m.type === 'ready') {
      this.readyAt.push(performance.now());
      this.settle();
      return;
    }
    if (m.type === 'failed') {
      this.kill(slot, m.error);
      this.settle();
      return;
    }
    const w = this.waiting.get(m.id);
    if (!w) return;
    this.waiting.delete(m.id);
    slot.queued -= w.texels;
    if (m.type === 'done') {
      this.spent[w.register] = (this.spent[w.register] ?? 0) + m.ms;
      w.resolve(Object.assign(m.painted, { paintMs: m.ms }));
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
