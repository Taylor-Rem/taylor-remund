/**
 * Rendered sounds as `AudioBuffer`s, made when first asked for and kept. The whole palette is rendered
 * a few at a time while the browser is idle (`prewarm`), so the first bell does not cost a frame.
 */
import { paramOf, renderDef } from './render.ts';
import { SOUNDS, soundDef } from './voices.ts';

export class Bank {
  private readonly ctx: BaseAudioContext;
  private readonly cache = new Map<string, AudioBuffer>();
  private readonly turn = new Map<string, number>();
  private warming = false;
  private disposed = false;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
  }

  /** The buffer for a sound (the next of its variants, in turn: a click is never quite the same twice). */
  get(id: string, param?: number, variant?: number): AudioBuffer {
    const def = soundDef(id);
    const v = variant ?? this.next(id, def.variants);
    const p = paramOf(def, param);
    const key = `${id}#${v}@${p}`;
    let b = this.cache.get(key);
    if (!b) {
      const sr = this.ctx.sampleRate;
      const data = renderDef(def, sr, v, p);
      b = this.ctx.createBuffer(1, data.length, sr);
      b.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
      this.cache.set(key, b);
    }
    return b;
  }

  /** (I1 R3) Is the buffer `get` would hand out next already made (so asking for it costs nothing)? */
  has(id: string, param?: number): boolean {
    const def = soundDef(id);
    const v = (this.turn.get(id) ?? 0) % def.variants;
    return this.cache.has(`${id}#${v}@${paramOf(def, param)}`);
  }

  private next(id: string, n: number): number {
    const k = this.turn.get(id) ?? 0;
    this.turn.set(id, k + 1);
    return k % n;
  }

  /** Render everything with a default parameter, a few sounds per idle moment. */
  prewarm(): void {
    if (this.warming) return;
    this.warming = true;
    const todo: { id: string; v: number }[] = [];
    // (I1 R3) what a visitor's first touch is likeliest to need comes first: the loops that start when sound starts,
    // a pick-up, a handle, the Button; then the rest
    const first = (id: string): number => (/^(loop\.|belt\.|hum)/.test(id) || id.startsWith('pick.') ? 0 : /^(handle\.|button\.|undo\.|cover\.|hit\.)/.test(id) ? 1 : 2);
    for (const d of [...SOUNDS].sort((a, b) => first(a.id) - first(b.id))) for (let v = 0; v < d.variants; v++) todo.push({ id: d.id, v });
    type Idle = (cb: (d: { timeRemaining(): number }) => void, o?: { timeout: number }) => number;
    const ric = (globalThis as { requestIdleCallback?: Idle }).requestIdleCallback;
    const later = (f: (d: { timeRemaining(): number }) => void): void => {
      if (ric) ric(f, { timeout: 2000 });
      else setTimeout(() => f({ timeRemaining: () => 8 }), 30);
    };
    const step = (deadline: { timeRemaining(): number }): void => {
      if (this.disposed) return;
      while (todo.length > 0 && deadline.timeRemaining() > 4) {
        const { id, v } = todo.shift()!;
        this.get(id, undefined, v);
      }
      if (todo.length > 0) later(step);
    };
    later(step);
  }

  /** How many buffers and samples are held (the audition page prints it). */
  get size(): { buffers: number; seconds: number } {
    let s = 0;
    for (const b of this.cache.values()) s += b.duration;
    return { buffers: this.cache.size, seconds: s };
  }

  dispose(): void {
    this.disposed = true;
    this.cache.clear();
  }
}
