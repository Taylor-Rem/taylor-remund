// `npm run perf` (REWRITE.md § E7, § G "Gate G1, part one"): the frame-time
// session on the reference laptop, on the real GPU.
//
//   npm run perf -- [--path /dev/stage/ | --url http://…] [--seconds 30]
//                   [--script actions.js] [--w 1440 --h 900] [--json]
//                   [--passes]   also cost each post pass (one run with each switched off)
//
// Two runs, both at 1440×900:
//   1. uncapped: Chrome with vsync and the frame-rate limit off, and the page
//      asked to wait for the GPU at the end of each frame (?sync=1), so each
//      frame-to-frame delta is the frame's real CPU + GPU cost;
//   2. as a visitor sees it: vsync on, nothing added. Its 95th percentile
//      shows dropped frames.
// Each reports the median and 95th-percentile frame time, draw calls,
// triangles and tier, plus GPU time per pass from timer queries when the
// browser offers them.
//
// Exit 1 when the uncapped median is over 16.7 ms or its p95 over 22 ms, or
// when the vsync run's p95 is over 22 ms. Refuses a software renderer.

import { parseArgs } from 'node:util';
import { isMain } from './lib/cli.ts';
import { isSoftware, loadScript, openPage, resolveTarget, scriptApi, type ScriptApi } from './capture.ts';

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

function withQuery(url: string, extra: Record<string, string>): string {
  const u = new URL(url);
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  return u.toString();
}

export async function measure(url: string, o: { label: string; vsync: boolean; seconds: number; w: number; h: number; script?: (api: ScriptApi) => Promise<void> }): Promise<RunResult> {
  const s = await openPage(url, { w: o.w, h: o.h, vsync: o.vsync, log: () => {} });
  try {
    if (isSoftware(s.renderer)) throw new Error(`refusing to measure on a software renderer (${s.renderer})`);
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
  const { url, server } = await resolveTarget(v.url ?? v.path ?? '/dev/stage/');
  const results: RunResult[] = [];
  const log = (r: RunResult): void => {
    results.push(r);
    if (!v.json) console.log(line(r));
  };
  try {
    const base = { seconds, w, h, ...(script ? { script } : {}) };
    log(await measure(withQuery(url, { sync: '1' }), { ...base, label: 'uncapped (vsync off)', vsync: false }));
    if (!v.json) console.log(`renderer: ${results[0]!.renderer}`);
    log(await measure(url, { ...base, label: 'vsync on', vsync: true }));
    if (v.passes) {
      // GPU time per pass from timer queries (a separate run: polling them disturbs frame pacing).
      const idle = async ({ sleep }: ScriptApi): Promise<void> => sleep(6000);
      log(await measure(withQuery(url, { timer: '1' }), { ...base, script: idle, label: 'GPU timers (idle)', vsync: true }));
      // And by subtraction: each pass switched off in turn, uncapped and synced, at rest.
      // A warm-up run is thrown away; the baseline is measured before and after and averaged.
      const ab = { ...base, script: async ({ sleep }: ScriptApi) => sleep(8000) };
      await measure(withQuery(url, { sync: '1' }), { ...ab, label: 'warm-up', vsync: false });
      const before = await measure(withQuery(url, { sync: '1' }), { ...ab, label: 'A/B: all passes (before)', vsync: false });
      log(before);
      log(await measure(withQuery(url, { sync: '1', post: '0' }), { ...ab, label: 'A/B: no post', vsync: false }));
      const without: [string, RunResult][] = [];
      for (const p of PASSES) {
        const r = await measure(withQuery(url, { sync: '1', pass: `-${p}` }), { ...ab, label: `A/B: without ${p}`, vsync: false });
        log(r);
        without.push([p, r]);
      }
      const after = await measure(withQuery(url, { sync: '1' }), { ...ab, label: 'A/B: all passes (after)', vsync: false });
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
  const uncapped = results[0]!;
  const vs = results[1]!;
  const fails: string[] = [];
  if (uncapped.median > BUDGET.median) fails.push(`uncapped median ${uncapped.median.toFixed(2)} ms > ${BUDGET.median}`);
  if (uncapped.p95 > BUDGET.p95) fails.push(`uncapped p95 ${uncapped.p95.toFixed(2)} ms > ${BUDGET.p95}`);
  if (vs.p95 > BUDGET.p95) fails.push(`vsync p95 ${vs.p95.toFixed(2)} ms > ${BUDGET.p95}`);
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
