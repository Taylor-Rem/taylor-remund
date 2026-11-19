// The gate's session and the frame recorder (H1 round 4; REWRITE.md § E7: "a scripted 60 s
// session that includes Button rung 4").
//
// THE GATE SESSION runs inside the page and is keyed to SIMULATION time, so the same things
// happen in the same order whatever the frame rate: it dispatches the intents a visitor's
// hand would (the world's own input path below picking), on the bench page (window.__bench).
//
//    0- 8 s  the attract lap runs, nobody touches anything
//    8 s     a small crate is picked up, then put on the belt (it rides to the dock and ships)
//   10-13 s  the belt's dial is turned up, step by step
//   14 s     the cord is moved to PLATEN and a text is sent ("paint it green")
//   19-24 s  the lamp is dragged across the bench and let go
//   26 s     the Button, rung 1; 32.5 s rung 2; 39 s rung 3; 45.5 s the cover lifted, 46 s rung 4
//            (the beacon, the sparks, every used station misfiring) and its rewind
//   55 s     UNDO; 57 s UNDO
//   60 s     end
//
// THE FRAME RECORDER wraps the workshop's own seams for the length of a session and keeps,
// per drawn frame: the frame time, the simulation steps run, each view's update, the
// render's CPU, its GPU time per pass (timer queries), texture uploads (calls and bytes),
// programs linked, buffer uploads, and the frame's number for a trace (console.timeStamp),
// so garbage collections from a Chrome trace can be put against the frame they fell in.

import type { Page } from '@playwright/test';

export const GATE_SECONDS = 60;

/** Start the gate session in the page (it runs on its own; returns at once). */
export async function startGateSession(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const api = w['__bench'] ?? w['__vignette'];
    const ws = api.ws;
    const world = ws.world;
    const hz = 60;
    const t0 = world.step as number;
    const done = new Set<string>();
    const at = (sec: number, key: string, f: () => void): void => {
      if (done.has(key) || (world.step - t0) / hz < sec) return;
      done.add(key);
      try {
        f();
      } catch (e) {
        console.warn('gate session:', key, String(e));
      }
    };
    const pos = (id: string): number[] | null => world.motion(id)?.pose?.p ?? null;
    let dial = 0.35;
    const tick = (): void => {
      const t = (world.step - t0) / hz;
      if (t > 62 || w['__gateStop']) return;
      // a crate to the belt
      at(8, 'grab', () => {
        const p = pos('crate-3') ?? [0, 0.3, 0];
        ws.dispatch({ type: 'grab', id: 'crate-3', grip: [p[0]!, p[1]! + 0.2, p[2]!] });
      });
      at(8.6, 'place', () => ws.dispatch({ type: 'place', at: 'belt' }));
      // the dial, turned up
      for (let k = 0; k < 12; k++) at(10 + k * 0.25, `dial${k}`, () => ws.dispatch({ type: 'turn', id: 'belt-dial', value: (dial = Math.min(1, dial + 0.05)) }));
      // a text into PLATEN
      at(14, 'unplug', () => ws.dispatch({ type: 'unplug', cord: 'cord' }));
      at(14.5, 'plug', () => ws.dispatch({ type: 'plug', cord: 'cord', jack: 'jack-platen' }));
      at(15, 'text', () => ws.dispatch({ type: 'text', text: 'paint it green' }));
      // the lamp, dragged across and let go
      if (t >= 19 && t < 24) {
        const lamp = world.machine('lamp');
        const home = lamp?.home?.aim ?? [0, 0, 0];
        const u = (t - 19) / 5;
        ws.dispatch({ type: 'drag', id: 'lamp', target: [home[0] - 4 + 8 * u, 0, home[2] + 1.5 * Math.sin(u * Math.PI)] });
      }
      at(24, 'lampgo', () => {
        const lamp = world.machine('lamp');
        const home = lamp?.home?.aim ?? [0, 0, 0];
        ws.dispatch({ type: 'drag', id: 'lamp', target: [home[0] + 4, 0, home[2]], end: true });
      });
      // the Button through rung 4
      at(26, 'r1', () => ws.dispatch({ type: 'press', id: 'button' }));
      at(32.5, 'r2', () => ws.dispatch({ type: 'press', id: 'button' }));
      at(39, 'r3', () => ws.dispatch({ type: 'press', id: 'button' }));
      at(45.5, 'cover', () => {
        const b = world.button();
        if (b.cover && b.cover !== 'none' && b.cover !== 'open') ws.dispatch({ type: 'press', id: b.coverId });
      });
      at(46, 'r4', () => ws.dispatch({ type: 'press', id: 'button' }));
      // UNDO
      at(55, 'undo1', () => ws.dispatch({ type: 'undo' }));
      at(57, 'undo2', () => ws.dispatch({ type: 'undo' }));
      requestAnimationFrame(tick);
    };
    w['__gateStop'] = false;
    w['__gate'] = { t0, events: () => [...done] };
    requestAnimationFrame(tick);
  });
}

export interface FrameRecord {
  /** Frame number (its console.timeStamp is `frame:<n>`), its time and its delta (ms). */
  n: number;
  t: number;
  dt: number;
  steps: number;
  /** Milliseconds: the simulation's steps, all views' updates, the render's CPU, the longest view. */
  sim: number;
  views: number;
  render: number;
  topView: string;
  topViewMs: number;
  /** GPU ms by pass (when the timer reported this frame). */
  gpu: Record<string, number> | null;
  texUploads: number;
  texBytes: number;
  bufUploads: number;
  bufBytes: number;
  programs: number;
  /** Time in GL calls that can wait on the GPU or the driver; the longest one. */
  glWait: number;
  glWaitCall: string;
  glWaitMs: number;
  /** The simulation time and the session's last action, for reading the list. */
  simT: number;
  phase: string;
}

/** Install the recorder in the page (call before the session starts). */
export async function installRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const api = w['__bench'] ?? w['__vignette'];
    const ws = api.ws;
    const stage = ws.stage;
    const gl = stage.renderer.getContext() as WebGL2RenderingContext;
    const timer = stage.gpuTimer;
    if (timer) timer.strict = false;
    const cur = { steps: 0, sim: 0, views: 0, render: 0, topView: '', topViewMs: 0, texUploads: 0, texBytes: 0, bufUploads: 0, bufBytes: 0, programs: 0, glWait: 0, glWaitCall: '', glWaitMs: 0 };
    const frames: Record<string, unknown>[] = [];
    const gpuBy = new Map<number, Record<string, number>>();
    const rec = { frames, on: true };
    w['__rec'] = rec;
    const time = (obj: Record<string, any>, key: string, add: (ms: number) => void): void => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const f = obj[key];
      if (typeof f !== 'function') return;
      obj[key] = function (this: unknown, ...a: unknown[]) {
        const t = performance.now();
        try {
          return f.apply(this, a);
        } finally {
          add(performance.now() - t);
        }
      };
    };
    time(ws.world, 'advance', (ms) => {
      cur.sim += ms;
      cur.steps++;
    });
    (ws.views as Array<Record<string, any>>).forEach((v, i) => // eslint-disable-line @typescript-eslint/no-explicit-any
      time(v, 'update', (ms) => {
        cur.views += ms;
        if (ms > cur.topViewMs) {
          cur.topViewMs = ms;
          cur.topView = String(v['root']?.name || i);
        }
      }),
    );
    time(stage, 'render', (ms) => (cur.render += ms));
    const bytesOf = (a: unknown[]): number => {
      for (const x of a) if (x && typeof x === 'object' && 'byteLength' in (x as object)) return (x as ArrayBufferView).byteLength;
      for (const x of a) if (x && typeof x === 'object' && 'width' in (x as object)) return ((x as { width: number }).width * (x as { height: number }).height * 4) | 0;
      return 0;
    };
    for (const k of ['texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D', 'texStorage2D', 'texStorage3D', 'compressedTexImage2D', 'compressedTexSubImage2D', 'copyTexSubImage2D']) {
      const f = (gl as unknown as Record<string, (...a: unknown[]) => unknown>)[k];
      if (!f) continue;
      (gl as unknown as Record<string, unknown>)[k] = function (this: unknown, ...a: unknown[]) {
        cur.texUploads++;
        cur.texBytes += bytesOf(a);
        return f.apply(gl, a);
      };
    }
    for (const k of ['bufferData', 'bufferSubData']) {
      const f = (gl as unknown as Record<string, (...a: unknown[]) => unknown>)[k]!;
      (gl as unknown as Record<string, unknown>)[k] = function (this: unknown, ...a: unknown[]) {
        cur.bufUploads++;
        cur.bufBytes += bytesOf(a);
        return f.apply(gl, a);
      };
    }
    // GL calls that can make the CPU wait for the GPU or the driver: time each
    for (const k of ['readPixels', 'getBufferSubData', 'finish', 'clientWaitSync', 'getQueryParameter', 'getProgramParameter', 'getShaderParameter', 'getError', 'getParameter', 'getSyncParameter', 'getProgramInfoLog']) {
      const f = (gl as unknown as Record<string, (...a: unknown[]) => unknown>)[k];
      if (!f) continue;
      (gl as unknown as Record<string, unknown>)[k] = function (this: unknown, ...a: unknown[]) {
        const t = performance.now();
        try {
          return f.apply(gl, a);
        } finally {
          const ms = performance.now() - t;
          cur.glWait += ms;
          if (ms > cur.glWaitMs) {
            cur.glWaitMs = ms;
            cur.glWaitCall = k;
          }
        }
      };
    }
    const link = gl.linkProgram;
    gl.linkProgram = function (p: WebGLProgram) {
      cur.programs++;
      return link.call(gl, p);
    };
    if (timer) timer.onFrame = (f: number, ms: Record<string, number>) => gpuBy.set(f, { ...ms });
    // a frame = the loop's steps then its render; a record is closed when the next frame begins
    // (the first step or render after a render)
    const drv = ws.driver;
    const render = drv.render;
    const step = drv.step;
    let n = 0;
    let start = 0;
    let gpuFrame = -1;
    let open = false;
    const begin = (): void => {
      const now = performance.now();
      if (open && rec.on) {
        const g = w['__gate'];
        const done = g ? (g.events() as string[]) : [];
        frames.push({ n, t: start, dt: now - start, ...cur, gpuFrame, simT: g ? (ws.world.step - g.t0) / 60 : 0, phase: done[done.length - 1] ?? '' });
      }
      for (const k of Object.keys(cur) as (keyof typeof cur)[]) (cur as Record<string, unknown>)[k] = typeof cur[k] === 'string' ? '' : 0;
      n++;
      start = now;
      open = true;
      console.timeStamp(`frame:${n}`);
    };
    let rendered = true;
    drv.step = function (this: unknown, ...a: unknown[]) {
      if (rendered) begin();
      rendered = false;
      return step.apply(this, a);
    };
    drv.render = function (this: unknown, ...a: unknown[]) {
      if (rendered) begin();
      gpuFrame = timer ? timer.frameNo + 1 : -1;
      try {
        return render.apply(this, a);
      } finally {
        rendered = true;
      }
    };
    w['__recGpu'] = gpuBy;
  });
}

/** Stop the recorder and fetch its frames (GPU times joined by frame). */
export async function collectFrames(page: Page): Promise<FrameRecord[]> {
  return page.evaluate(() => {
    const w = window as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    w['__rec'].on = false;
    w['__gateStop'] = true;
    const gpu = w['__recGpu'] as Map<number, Record<string, number>>;
    return (w['__rec'].frames as Array<Record<string, any>>).map((f) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const { gpuFrame, ...rest } = f;
      return { ...rest, gpu: gpu.get(gpuFrame as number) ?? null };
    }) as unknown as FrameRecord[];
  });
}

/** Garbage collections from a Chrome trace, placed against the frames' timestamps. */
export function gcByFrame(trace: { traceEvents: Array<{ name: string; ts: number; dur?: number; ph: string; args?: { data?: { message?: string } } }> }): Map<number, number> {
  const marks: Array<{ n: number; ts: number }> = [];
  const gcs: Array<{ ts: number; dur: number }> = [];
  for (const e of trace.traceEvents) {
    if (e.name === 'TimeStamp' && e.args?.data?.message?.startsWith('frame:')) marks.push({ n: Number(e.args.data.message.slice(6)), ts: e.ts });
    else if ((e.name === 'MinorGC' || e.name === 'MajorGC' || e.name === 'V8.GCScavenger' || e.name === 'V8.GCFinalizeMC' || e.name === 'V8.GCIncrementalMarking') && e.ph === 'X') gcs.push({ ts: e.ts, dur: (e.dur ?? 0) / 1000 });
  }
  marks.sort((a, b) => a.ts - b.ts);
  const out = new Map<number, number>();
  for (const g of gcs) {
    // the frame whose mark is the last one at or before the collection
    let lo = 0, hi = marks.length - 1, k = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (marks[mid]!.ts <= g.ts) {
        k = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (k < 0) continue;
    const n = marks[k]!.n;
    out.set(n, (out.get(n) ?? 0) + g.dur);
  }
  return out;
}
