// `npm run perf` (REWRITE.md § E7, § G "Gate G1, part one"): the frame-time
// session on the reference laptop, on the real GPU.
//
//   npm run perf -- [--path /dev/stage/ | --url http://…] [--seconds 30]
//                   [--script actions.js] [--w 1440 --h 900] [--json]
//                   [--passes]   also cost each post pass (one run with each switched off)
//                   [--census]   instead: where the frame goes (H1), on a page with
//                                window.__vignette (the vignette, the bench): per piece,
//                                triangles in its geometry, in the main pass and in the
//                                shadow pass, draw calls by material; GPU ms per pass
//                                (timer queries) and CPU ms per system, at the home
//                                framing and every close view. --shots home,button,…
//                                --counts: the triangle and draw-call table only
//                   [--frames out.json]  instead: one uncapped run of the session recorded
//                                frame by frame (perf-session.ts) with a Chrome trace for
//                                garbage collections; prints every frame over 22 ms and
//                                what it was doing
//                   [--session gate|hover]  on the bench the default is `gate` (60 s: the
//                                attract lap, a crate shipped, the dial, a text to PLATEN, the
//                                lamp dragged, the Button through rung 4, UNDO; perf-session.ts);
//                                elsewhere `hover` (the pointer about the bench, zoom, pan)
//                   [--look 'gtao.samples=4,gtao.denoise=4']  set LOOK values before measuring
//
// Two runs, both at 1440×900, over the session (on the bench, the gate's: 60 s with rung 4):
//   1. as a visitor sees it: vsync on. Its median and 95th percentile are THE GATE's
//      numbers (§ E7: median at most 16.7 ms, p95 at most 22 ms): a frame that misses
//      its vsync shows as 33 ms.
//   2. uncapped: vsync and the frame-rate limit off. Unpaced, Chrome lets the page run
//      ahead of the GPU until its queue is full and then blocks one frame for the whole
//      backlog (H1 round 4: on the bench about every 24th frame waits ~100 ms in its
//      render call, doing nothing else; the other frames take the CPU's ~11 ms). Its
//      per-frame p95 is therefore the queue, not the frames, and is reported only as
//      information. What it does measure honestly is THROUGHPUT: its MEAN interval is
//      what one frame costs when the slower of CPU and GPU sets the pace, so
//      16.7 − mean is the headroom; the gate requires it to fit (mean at most 16.7 ms).
// Each reports draw calls, triangles and tier, plus GPU time per pass from timer
// queries when the browser offers them. `--frames` records a session frame by frame.
//
// Exit 1 when the vsync run's median is over 16.7 ms or its p95 over 22 ms, or when the
// uncapped run's mean interval is over 16.7 ms. Refuses a software renderer.

import { parseArgs } from 'node:util';
import { isMain } from './lib/cli.ts';
import { writeFileSync } from 'node:fs';
import { isSoftware, loadScript, openPage, resolveTarget, scriptApi, type ScriptApi } from './capture.ts';
import { collectFrames, gcByFrame, GATE_SECONDS, installRecorder, startGateSession, type FrameRecord } from './perf-session.ts';

export const BUDGET = { median: 16.7, p95: 22 };

export interface RunResult {
  label: string;
  vsync: boolean;
  frames: number;
  median: number;
  p95: number;
  mean: number;
  max: number;
  tier: string | null;
  calls: number | null;
  triangles: number | null;
  gpu: Record<string, number> | null;
  renderer: string;
}

export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

/** The default scripted session: hover across the bench, zoom toward the pointer and back, drag to pan. */
export async function defaultSession({ mouse, w, h, sleep }: ScriptApi, seconds: number): Promise<void> {
  const until = Date.now() + seconds * 1000;
  let t = 0;
  while (Date.now() < until) {
    const phase = Math.floor(t / 4) % 4;
    const x = w * (0.5 + 0.35 * Math.sin(t * 0.9));
    const y = h * (0.55 + 0.25 * Math.sin(t * 1.3));
    await mouse.move(x, y);
    if (phase === 1) await mouse.wheel(0, Math.sin(t * 2) > 0 ? -120 : 120);
    if (phase === 2 && Math.floor(t * 10) % 20 === 0) {
      await mouse.down();
      await mouse.move(x + 80, y, { steps: 6 });
      await mouse.up();
    }
    await sleep(50);
    t += 0.05;
  }
}

/** The gate's session (perf-session.ts): 60 s keyed to simulation time, rung 4 included. */
export async function gateSession(api: ScriptApi): Promise<void> {
  await startGateSession(api.page);
  await api.sleep(GATE_SECONDS * 1000);
}

/** `gtao.samples=4,msaa=2` → set those LOOK values in the page (window.__workshop.look). */
async function applyLook(page: import('@playwright/test').Page, spec: string | undefined): Promise<void> {
  if (!spec) return;
  await page.evaluate((spec) => {
    const look = (window as unknown as { __workshop: { look: Record<string, unknown> } }).__workshop.look;
    for (const kv of spec.split(',')) {
      const [path, raw] = kv.split('=');
      const keys = path!.trim().split('.');
      let o = look as Record<string, unknown>;
      for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
      const v = Number(raw);
      o[keys[keys.length - 1]!] = Number.isFinite(v) ? v : raw;
    }
  }, spec);
}

function withQuery(url: string, extra: Record<string, string>): string {
  const u = new URL(url);
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  return u.toString();
}

export async function measure(url: string, o: { label: string; vsync: boolean; seconds: number; w: number; h: number; script?: (api: ScriptApi) => Promise<void>; look?: string }): Promise<RunResult> {
  const s = await openPage(url, { w: o.w, h: o.h, vsync: o.vsync, log: () => {} });
  try {
    if (isSoftware(s.renderer)) throw new Error(`refusing to measure on a software renderer (${s.renderer})`);
    await applyLook(s.page, o.look);
    await s.page.waitForTimeout(1000); // shaders compiled, caches warm
    await s.page.evaluate(() => {
      const w = window as unknown as { __perf?: { deltas: number[]; on: boolean }; __workshop?: { resetStats(): void } };
      w.__workshop?.resetStats();
      const rec = { deltas: [] as number[], on: true };
      w.__perf = rec;
      let last = -1;
      const tick = (t: number): void => {
        if (!rec.on) return;
        if (last >= 0) rec.deltas.push(t - last);
        last = t;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const api = scriptApi(s.page, o.w, o.h);
    await (o.script ? o.script(api) : defaultSession(api, o.seconds));
    const out = await s.page.evaluate(() => {
      const w = window as unknown as {
        __perf: { deltas: number[]; on: boolean };
        __workshop?: { stats(): { tier: string; scene: { calls: number; triangles: number }; gpuMedian: Record<string, number> | null } };
      };
      w.__perf.on = false;
      const st = w.__workshop?.stats();
      return { deltas: w.__perf.deltas, stats: st ?? null };
    });
    const d = out.deltas.slice().sort((a, b) => a - b);
    return {
      label: o.label,
      vsync: o.vsync,
      frames: d.length,
      median: quantile(d, 0.5),
      p95: quantile(d, 0.95),
      mean: d.reduce((a, b) => a + b, 0) / Math.max(1, d.length),
      max: d[d.length - 1] ?? 0,
      tier: out.stats?.tier ?? null,
      calls: out.stats?.scene.calls ?? null,
      triangles: out.stats?.scene.triangles ?? null,
      gpu: out.stats?.gpuMedian ?? null,
      renderer: s.renderer,
    };
  } finally {
    await s.close();
  }
}

function line(r: RunResult): string {
  const gpu = r.gpu ? Object.entries(r.gpu).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' · ') : 'n/a';
  return `${r.label.padEnd(24)} median ${r.median.toFixed(2).padStart(6)} ms  p95 ${r.p95.toFixed(2).padStart(6)} ms  mean ${r.mean.toFixed(2)}  frames ${r.frames}  | calls ${r.calls ?? '?'} tris ${r.triangles ?? '?'} tier ${r.tier ?? '?'} | gpu ms: ${gpu}`;
}

// ───────────────────────── the frame list (H1 round 4) ─────────────────────────

export interface SlowFrame extends FrameRecord {
  gc: number;
  causes: string[];
}

/** What a frame was doing, from its record: the reasons it may have been slow. */
export function causesOf(f: FrameRecord & { gc: number }): string[] {
  const c: string[] = [];
  const gpu = f.gpu ? Object.values(f.gpu).reduce((a, b) => a + b, 0) : 0;
  if (f.programs > 0) c.push(`${f.programs} program(s) compiled`);
  if (f.texBytes > 256 * 1024) c.push(`texture uploads ${f.texUploads} (${(f.texBytes / 1048576).toFixed(1)} MB)`);
  if (f.bufBytes > 1048576) c.push(`buffer uploads ${(f.bufBytes / 1048576).toFixed(1)} MB`);
  if (f.gc > 2) c.push(`GC ${f.gc.toFixed(1)} ms`);
  if (f.steps >= 2) c.push(`${f.steps} steps (catch-up)`);
  if (f.sim > 6) c.push(`simulation ${f.sim.toFixed(1)} ms`);
  if (f.topViewMs > 4) c.push(`view ${f.topView} ${f.topViewMs.toFixed(1)} ms`);
  if (f.glWait > 4) c.push(`GL wait ${f.glWait.toFixed(1)} ms (longest ${f.glWaitCall} ${f.glWaitMs.toFixed(1)})`);
  if (f.render - f.glWait > 10) c.push(`render CPU ${(f.render - f.glWait).toFixed(1)} ms`);
  if (gpu > 16) c.push(`GPU ${gpu.toFixed(1)} ms`);
  if (!c.length) c.push('nothing recorded (outside the frame: the compositor, another process)');
  return c;
}

/** One uncapped run of the session, recorded frame by frame, with a trace for GCs. */
export async function recordFrames(url: string, o: { w: number; h: number; session: 'gate' | 'hover'; seconds: number; look?: string; timer?: boolean; vsync?: boolean }): Promise<{ frames: SlowFrame[]; renderer: string }> {
  const s = await openPage(o.timer === false ? url : withQuery(url, { timer: '1' }), { w: o.w, h: o.h, vsync: !!o.vsync, log: () => {} });
  try {
    if (isSoftware(s.renderer)) throw new Error(`refusing to measure on a software renderer (${s.renderer})`);
    await applyLook(s.page, o.look);
    await s.page.waitForTimeout(1000);
    await installRecorder(s.page);
    await s.browser.startTracing(s.page, { categories: ['devtools.timeline', 'v8', 'disabled-by-default-v8.gc'] });
    const api = scriptApi(s.page, o.w, o.h);
    if (o.session === 'gate') await gateSession(api);
    else await defaultSession(api, o.seconds);
    const frames = await collectFrames(s.page);
    const buf = await s.browser.stopTracing();
    const gc = gcByFrame(JSON.parse(buf.toString()) as Parameters<typeof gcByFrame>[0]);
    return { frames: frames.map((f) => ({ ...f, gc: gc.get(f.n) ?? 0, causes: causesOf({ ...f, gc: gc.get(f.n) ?? 0 }) })), renderer: s.renderer };
  } finally {
    await s.close();
  }
}

export function printFrames(frames: SlowFrame[], log: (s: string) => void = console.log, over = BUDGET.p95): void {
  const d = frames.map((f) => f.dt).sort((a, b) => a - b);
  const slow = frames.filter((f) => f.dt > over);
  log(`${frames.length} frames · median ${quantile(d, 0.5).toFixed(2)} ms · p95 ${quantile(d, 0.95).toFixed(2)} ms · over ${over} ms: ${slow.length} (${((100 * slow.length) / Math.max(1, frames.length)).toFixed(1)}%)`);
  const tally = new Map<string, number>();
  for (const f of slow) for (const c of f.causes) {
    const k = c.replace(/[\d.]+( ms| MB|\))?/g, '#').replace(/view \S+/, (m) => m);
    tally.set(k, (tally.get(k) ?? 0) + 1);
  }
  log('causes among the slow frames (a frame may have several):');
  for (const [k, n] of [...tally].sort((a, b) => b[1] - a[1])) log(`  ${String(n).padStart(4)}  ${k}`);
  log('the slow frames:');
  for (const f of slow) {
    const gpu = f.gpu ? Object.values(f.gpu).reduce((a, b) => a + b, 0) : NaN;
    log(`  #${String(f.n).padStart(5)} t=${f.simT.toFixed(1).padStart(5)}s ${f.dt.toFixed(1).padStart(6)} ms · steps ${f.steps} sim ${f.sim.toFixed(1)} views ${f.views.toFixed(1)} (${f.topView} ${f.topViewMs.toFixed(1)}) render ${f.render.toFixed(1)} gpu ${Number.isNaN(gpu) ? '?' : gpu.toFixed(1)} · after "${f.phase}" · ${f.causes.join('; ')}`);
  }
}

// ───────────────────────── the census (H1) ─────────────────────────

interface CensusPiece {
  piece: string;
  main: { calls: number; triangles: number };
  shadow: { calls: number; triangles: number };
  byMaterial: Record<string, number>;
}
interface CensusShot {
  shot: string;
  totals: Record<'main' | 'shadow' | 'post', { calls: number; triangles: number }>;
  pieces: CensusPiece[];
}
export interface CensusReport {
  renderer: string;
  geometry: Record<string, number>;
  shots: CensusShot[];
  gpu: Record<string, Record<string, number>>;
  cpu: Record<string, { frames: number; perFrame: Record<string, number> }>;
}

type Win = Record<string, unknown> & {
  __vignette: { goto(step: number, shot?: string): unknown; shot(name: string): void; ws: Record<string, unknown> };
  __workshop: { census(): { totals: CensusShot['totals']; pieces: CensusPiece[] }; geometry(): Record<string, number>; resetStats(): void; stats(): { gpuMedian: Record<string, number> | null } };
};

export async function census(url: string, o: { w: number; h: number; shots: string[]; seconds: number; timing?: boolean }): Promise<CensusReport> {
  const report: CensusReport = { renderer: '', geometry: {}, shots: [], gpu: {}, cpu: {} };
  // 1. counts: manual mode, a deterministic frame at each framing
  {
    const s = await openPage(withQuery(url, { hud: '0', manual: '1' }), { w: o.w, h: o.h, log: () => {} });
    try {
      if (isSoftware(s.renderer)) throw new Error(`refusing to measure on a software renderer (${s.renderer})`);
      report.renderer = s.renderer;
      for (const shot of o.shots) {
        const c = await s.page.evaluate((sh) => {
          const w = window as unknown as Win;
          w.__vignette.goto(500, sh);
          const r = w.__workshop.census();
          return { totals: r.totals, pieces: r.pieces };
        }, shot);
        report.shots.push({ shot, ...c });
      }
      report.geometry = await s.page.evaluate(() => (window as unknown as Win).__workshop.geometry());
    } finally {
      await s.close();
    }
  }
  // 2. time: live, vsync on, GPU timer queries per pass and CPU wrappers per system
  if (o.timing !== false) {
    const s = await openPage(withQuery(url, { hud: '0', timer: '1' }), { w: o.w, h: o.h, log: () => {} });
    try {
      await s.page.evaluate(() => {
        const w = window as unknown as Win & { __cpu: { acc: Record<string, number>; frames: number } };
        const ws = w.__vignette.ws as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
        const cpu = { acc: {} as Record<string, number>, frames: 0 };
        // RADV reports a timer disjoint on most polls while other GPU work runs: keep the samples
        // (the window's median absorbs the odd bad one) rather than lose them all
        ws.stage.gpuTimer.strict = false;
        w.__cpu = cpu;
        const wrap = (obj: Record<string, any>, key: string, label: string): void => { // eslint-disable-line @typescript-eslint/no-explicit-any
          const f = obj[key] as (...a: unknown[]) => unknown;
          if (typeof f !== 'function') return;
          obj[key] = function (this: unknown, ...a: unknown[]) {
            const t = performance.now();
            try {
              return f.apply(this, a);
            } finally {
              cpu.acc[label] = (cpu.acc[label] ?? 0) + performance.now() - t;
            }
          };
        };
        wrap(ws.world, 'advance', 'simulation step');
        (ws.views as Array<Record<string, any>>).forEach((v, i) => wrap(v, 'update', `view ${String(v.root?.name || i)}`)); // eslint-disable-line @typescript-eslint/no-explicit-any
        for (const k of Object.keys(ws.labels)) if (typeof ws.labels[k] === 'function') wrap(ws.labels, k, 'labels');
        wrap(ws.stage, 'render', 'stage.render (all CPU of the draw)');
        wrap(ws.stage.renderer.shadowMap, 'render', '  of which: shadow pass submit');
        let skel: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
        ws.stage.scene.traverse((x: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
          if (!skel && x.isSkinnedMesh) skel = Object.getPrototypeOf(x.skeleton);
        });
        if (skel) wrap(skel, 'update', '  of which: skinning (bone matrices)');
        const drv = ws.driver as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
        const render = drv.render as (...a: unknown[]) => unknown;
        drv.render = function (this: unknown, ...a: unknown[]) {
          cpu.frames++;
          const t = performance.now();
          try {
            return render.apply(this, a);
          } finally {
            cpu.acc['frame: views + render'] = (cpu.acc['frame: views + render'] ?? 0) + performance.now() - t;
          }
        };
      });
      for (const shot of o.shots) {
        await s.page.evaluate((sh) => (window as unknown as Win).__vignette.shot(sh), shot);
        await s.page.waitForTimeout(1500);
        await s.page.evaluate(() => {
          const w = window as unknown as Win & { __cpu: { acc: Record<string, number>; frames: number } };
          w.__workshop.resetStats();
          w.__cpu.acc = {};
          w.__cpu.frames = 0;
        });
        await s.page.waitForTimeout(o.seconds * 1000);
        const r = await s.page.evaluate(() => {
          const w = window as unknown as Win & { __cpu: { acc: Record<string, number>; frames: number } };
          const st = w.__workshop.stats();
          const per: Record<string, number> = {};
          for (const [k, v] of Object.entries(w.__cpu.acc)) per[k] = v / Math.max(1, w.__cpu.frames);
          return { gpu: st.gpuMedian ?? {}, frames: w.__cpu.frames, per };
        });
        report.gpu[shot] = r.gpu;
        report.cpu[shot] = { frames: r.frames, perFrame: r.per };
      }
    } finally {
      await s.close();
    }
  }
  return report;
}

export function printCensus(r: CensusReport, log: (s: string) => void = console.log): void {
  log(`census on ${r.renderer}`);
  log('counting: renderer.info per draw (renderBufferDirect), one deterministic frame; main = scene target after frustum culling; shadow = key shadow map; post = full-screen passes');
  for (const s of r.shots) {
    const t = s.totals;
    log(`\n── ${s.shot}: main ${t.main.calls} calls ${t.main.triangles} tris · shadow ${t.shadow.calls} calls ${t.shadow.triangles} tris · scene (gated) ${t.main.calls + t.shadow.calls} calls ${t.main.triangles + t.shadow.triangles} tris · post ${t.post.calls} calls`);
    log(`   ${'piece'.padEnd(22)} ${'geometry'.padStart(9)} ${'main'.padStart(8)} ${'shadow'.padStart(8)} ${'calls m+s'.padStart(10)}  main calls by material`);
    for (const p of s.pieces) {
      const mats = Object.entries(p.byMaterial).map(([k, v]) => `${k}${v > 1 ? `×${v}` : ''}`).join(' ');
      log(`   ${p.piece.padEnd(22)} ${String(r.geometry[p.piece] ?? '').padStart(9)} ${String(p.main.triangles).padStart(8)} ${String(p.shadow.triangles).padStart(8)} ${`${p.main.calls}+${p.shadow.calls}`.padStart(10)}  ${mats}`);
    }
  }
  log('\n── GPU ms per pass (median of the window, timer queries; vsync on)');
  for (const [shot, g] of Object.entries(r.gpu)) log(`   ${shot.padEnd(8)} ${Object.entries(g).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' · ')}  | sum ${Object.values(g).reduce((a, b) => a + b, 0).toFixed(2)}`);
  log('\n── CPU ms per frame by system (mean; wrappers round each system\'s entry point)');
  for (const [shot, c] of Object.entries(r.cpu)) {
    log(`   ${shot} (${c.frames} frames)`);
    for (const [k, v] of Object.entries(c.perFrame).sort((a, b) => b[1] - a[1])) log(`      ${k.padEnd(40)} ${v.toFixed(3)}`);
  }
}

const PASSES = ['msaa', 'gtao', 'bloom', 'focus', 'grade', 'vignette', 'fog'] as const;

async function main(): Promise<number> {
  let v;
  try {
    v = parseArgs({
      args: process.argv.slice(2),
      options: {
        url: { type: 'string' },
        path: { type: 'string' },
        seconds: { type: 'string' },
        script: { type: 'string' },
        w: { type: 'string' },
        h: { type: 'string' },
        json: { type: 'boolean' },
        passes: { type: 'boolean' },
        census: { type: 'boolean' },
        counts: { type: 'boolean' },
        shots: { type: 'string' },
        frames: { type: 'string' },
        'no-timer': { type: 'boolean' },
        vsync: { type: 'boolean' },
        session: { type: 'string' },
        look: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    }).values;
  } catch (e) {
    console.error(`perf: ${(e as Error).message}`);
    return 2;
  }
  if (v.help) {
    console.log('usage: npm run perf -- [--path /dev/stage/ | --url URL] [--seconds 30] [--script file.js] [--w 1440 --h 900] [--passes] [--json]');
    return 0;
  }
  const seconds = Number(v.seconds ?? 30);
  const w = Number(v.w ?? 1440);
  const h = Number(v.h ?? 900);
  const script = v.script ? await loadScript(v.script) : undefined;
  if (v.census) {
    const { url: curl, server: cserver } = await resolveTarget(v.url ?? v.path ?? '/dev/vignette/');
    try {
      const shots = (v.shots ?? 'home,button,fetch,patch,cord').split(',');
      const r = await census(curl, { w, h, shots, seconds: Number(v.seconds ?? 6), timing: !v.counts });
      if (v.json) console.log(JSON.stringify(r, null, 2));
      else printCensus(r);
      return 0;
    } finally {
      cserver?.stop();
    }
  }
  const target = v.url ?? v.path ?? '/dev/stage/';
  const session = (v.session ?? (/\/dev\/bench\//.test(target) ? 'gate' : 'hover')) as 'gate' | 'hover';
  if (v.frames) {
    const { url: furl, server: fserver } = await resolveTarget(target);
    try {
      const r = await recordFrames(furl, { w, h, session, seconds, timer: !v['no-timer'], vsync: !!v.vsync, ...(v.look ? { look: v.look } : {}) });
      writeFileSync(v.frames, JSON.stringify(r, null, 1));
      console.log(`renderer: ${r.renderer}; session ${session}; frames written to ${v.frames}`);
      printFrames(r.frames);
      return 0;
    } finally {
      fserver?.stop();
    }
  }
  const { url, server } = await resolveTarget(target);
  const results: RunResult[] = [];
  const log = (r: RunResult): void => {
    results.push(r);
    if (!v.json) console.log(line(r));
  };
  try {
    const chosen = script ?? (session === 'gate' ? gateSession : undefined);
    const base = { seconds, w, h, ...(chosen ? { script: chosen } : {}), ...(v.look ? { look: v.look } : {}) };
    if (!v.json) console.log(`session: ${script ? v.script : session}${v.look ? `; LOOK ${v.look}` : ''}`);
    log(await measure(url, { ...base, label: 'vsync on (the gate)', vsync: true }));
    if (!v.json) console.log(`renderer: ${results[0]!.renderer}`);
    log(await measure(url, { ...base, label: 'uncapped (throughput)', vsync: false }));
    if (v.passes) {
      // GPU time per pass from timer queries (a separate run: polling them disturbs frame pacing).
      const idle = async ({ sleep }: ScriptApi): Promise<void> => sleep(6000);
      log(await measure(withQuery(url, { timer: '1' }), { ...base, script: idle, label: 'GPU timers (idle)', vsync: true }));
      // And by subtraction: each pass switched off in turn, uncapped and synced, at rest.
      // A warm-up run is thrown away; the baseline is measured before and after and averaged.
      const ab = { ...base, script: async ({ sleep }: ScriptApi) => sleep(8000) };
      await measure(withQuery(url, { gpusync: '1' }), { ...ab, label: 'warm-up', vsync: false });
      const before = await measure(withQuery(url, { gpusync: '1' }), { ...ab, label: 'A/B: all passes (before)', vsync: false });
      log(before);
      log(await measure(withQuery(url, { gpusync: '1', post: '0' }), { ...ab, label: 'A/B: no post', vsync: false }));
      const without: [string, RunResult][] = [];
      for (const p of PASSES) {
        const r = await measure(withQuery(url, { gpusync: '1', pass: `-${p}` }), { ...ab, label: `A/B: without ${p}`, vsync: false });
        log(r);
        without.push([p, r]);
      }
      const after = await measure(withQuery(url, { gpusync: '1' }), { ...ab, label: 'A/B: all passes (after)', vsync: false });
      log(after);
      const baseline = (before.median + after.median) / 2;
      if (!v.json) {
        console.log(`A/B baseline ${baseline.toFixed(2)} ms (noise between the two baseline runs: ${Math.abs(before.median - after.median).toFixed(2)} ms)`);
        for (const [p, r] of without) console.log(`  ${p.padEnd(9)} costs about ${(baseline - r.median).toFixed(2)} ms`);
      }
    }
  } catch (e) {
    console.error(`perf: ${(e as Error).message}`);
    return 1;
  } finally {
    server?.stop();
  }
  const vs = results[0]!;
  const uncapped = results[1]!;
  const fails: string[] = [];
  // a paced median sits on the display's interval (16.67-16.70 ms): a hair over 16.7 is not a miss
  if (vs.median > BUDGET.median + 0.05) fails.push(`vsync median ${vs.median.toFixed(2)} ms > ${BUDGET.median}`);
  if (vs.p95 > BUDGET.p95) fails.push(`vsync p95 ${vs.p95.toFixed(2)} ms > ${BUDGET.p95}`);
  if (uncapped.mean > BUDGET.median) fails.push(`uncapped mean interval ${uncapped.mean.toFixed(2)} ms > ${BUDGET.median} (cannot hold 60 fps)`);
  if (!v.json) console.log(`headroom: ${(BUDGET.median - uncapped.mean).toFixed(2)} ms a frame (16.7 − the unpaced mean interval ${uncapped.mean.toFixed(2)} ms; its p95 ${uncapped.p95.toFixed(2)} ms is the queue, see the header)`);
  if (v.json) console.log(JSON.stringify({ budget: BUDGET, results, pass: fails.length === 0, fails }, null, 2));
  else console.log(fails.length ? `perf: FAIL — ${fails.join('; ')}` : `perf: pass (budget: median ≤ ${BUDGET.median} ms, p95 ≤ ${BUDGET.p95} ms)`);
  return fails.length ? 1 : 0;
}

if (isMain(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(`perf: ${String(e)}`);
      process.exit(1);
    },
  );
}
