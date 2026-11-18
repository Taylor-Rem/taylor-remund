/**
 * A station view's CPU cost per frame, for measuring against the 0.3 ms a view is allowed (W-COMMON
 * "Budget"). Off unless a dev page (or a capture's eval) sets `globalThis.__viewMs = {}`: then each
 * wrapped view adds its update's time to `__viewMs[name] = { n, ms, max }`. Off, it costs one property
 * read a frame.
 */
import type { Frame, StationViewFactory } from '../types.ts';

type Times = Record<string, { n: number; ms: number; max: number }>;

export function timed(name: string, f: StationViewFactory): StationViewFactory {
  return (ctx) => {
    const v = f(ctx);
    return {
      root: v.root,
      update(frame: Frame) {
        const T = (globalThis as { __viewMs?: Times }).__viewMs;
        if (!T) {
          v.update(frame);
          return;
        }
        const t0 = performance.now();
        v.update(frame);
        const ms = performance.now() - t0;
        const e = (T[name] ??= { n: 0, ms: 0, max: 0 });
        e.n++;
        e.ms += ms;
        e.max = Math.max(e.max, ms);
      },
      dispose: () => v.dispose(),
    };
  };
}
