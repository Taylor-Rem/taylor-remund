// loadtime: a cold load of the BUNDLED build in real Chrome on the real GPU,
// unthrottled and with DevTools' "Fast 4G", and where the time went
// (B1 brief; REWRITE.md § E6, § E7: stage usable within 3 s unthrottled and
// 6 s on Fast 4G; first paint at most 200 KB).
//
//   node scripts/loadtime.ts [--path /dev/handoff/] [--runs 3] [--throttle both|none|fast4g]
//        [--dist <dir>]      measure an existing build (default: build one with the dev pages
//                            into a temporary folder, WORKSHOP_DEV_PAGES=1 astro build --outDir)
//        [--w 1440 --h 900]  [--profile]  CPU profile: inclusive time per chunk (per piece)
//        [--json out.json]   everything measured, per run
//        [--record out.mp4 --seconds 10]  a screencast of one cold load (capture.ts's recorder)
//
// The build is served over HTTP/2 with TLS and gzip by a small server of its
// own (GitHub Pages serves HTTP/2 and compresses text and wasm), so request
// counts cost what they cost there. Every run is a fresh browser context with
// the cache disabled.
//
// What "usable" means: the page says so. A page booted through the shell's
// loader sets `window.__handoff.usableAt` (the live stage is on screen, the
// loop running, input attached); the vignette and bench pages count from the
// moment `window.__vignette` / `window.__bench` exists (their boot has
// resolved and the loop is started; its first frame is still to come, so
// they read about one first-frame early against the handoff page).
//
// Exit codes: 0 measured, 1 failed, 2 usage.

import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createSecureServer, type Http2SecureServer } from 'node:http2';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createGzip } from 'node:zlib';
import { chromium, type CDPSession, type Page } from '@playwright/test';
import { isMain, REPO_ROOT } from './lib/cli.ts';
import { GPU_ARGS, freePort, isSoftware, record, type Session } from './capture.ts';

// ───────────────────────── throttling ─────────────────────────

/** DevTools' presets (front_end/core/sdk/NetworkManager.ts): 9 Mbit/s down, 1.5 up, 60 ms × 2.75 latency. */
export const THROTTLES = {
  none: null,
  fast4g: { latency: 60 * 2.75, downloadThroughput: ((9 * 1000 * 1000) / 8) * 0.9, uploadThroughput: ((1.5 * 1000 * 1000) / 8) * 0.9 },
} as const;
export type ThrottleName = keyof typeof THROTTLES;

// ───────────────────────── the server ─────────────────────────

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
};
const COMPRESS = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.wasm', '.txt']);

export interface StaticServer {
  origin: string;
  stop(): Promise<void>;
}

/** A self-signed certificate for localhost (Chrome is told to accept it). */
function certificate(): { key: Buffer; cert: Buffer } {
  const dir = mkdtempSync(join(tmpdir(), 'loadtime-tls-'));
  try {
    const r = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=localhost', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem')], { stdio: 'ignore' });
    if (r.status !== 0) throw new Error('loadtime: openssl could not make a certificate');
    return { key: readFileSync(join(dir, 'k.pem')), cert: readFileSync(join(dir, 'c.pem')) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Serve a built folder over HTTP/2 (TLS), gzip for text and wasm, directory URLs. */
export async function serveDist(dir: string): Promise<StaticServer> {
  const root = resolve(dir);
  const port = await freePort();
  const server: Http2SecureServer = createSecureServer({ ...certificate(), allowHTTP1: true }, (req, res) => {
    let path = decodeURIComponent(new URL(req.url ?? '/', 'https://x').pathname);
    let file = normalize(join(root, path));
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) {
      if (!path.endsWith('/')) {
        res.writeHead(301, { location: `${path}/` }).end();
        return;
      }
      file = join(file, 'index.html');
    }
    if (!existsSync(file)) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    const ext = extname(file).toLowerCase();
    const gz = COMPRESS.has(ext) && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
    res.writeHead(200, {
      'content-type': TYPES[ext] ?? 'application/octet-stream',
      'cache-control': 'no-store',
      ...(gz ? { 'content-encoding': 'gzip', vary: 'accept-encoding' } : { 'content-length': String(statSync(file).size) }),
    });
    const s = createReadStream(file);
    if (gz) s.pipe(createGzip({ level: 6 })).pipe(res);
    else s.pipe(res);
    path = '';
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  return {
    origin: `https://localhost:${port}`,
    stop: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/**
 * A temporary build folder on the repository's own disk (Astro moves its
 * assets into the output with rename(), which fails across devices; /tmp is
 * another one here). Under .astro/, which git ignores.
 */
export function tempBuildDir(tag: string): string {
  const base = join(REPO_ROOT, '.astro');
  mkdirSync(base, { recursive: true });
  return mkdtempSync(join(base, `${tag}-dist-`));
}

/** Build the site with the dev pages into a temporary folder. */
export function buildWithDevPages(out: string): void {
  const r = spawnSync('npx', ['astro', 'build', '--outDir', out], {
    cwd: REPO_ROOT,
    env: { ...process.env, WORKSHOP_DEV_PAGES: '1', ASTRO_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  if (r.status !== 0) throw new Error('loadtime: the build failed');
}

// ───────────────────────── one cold load ─────────────────────────

export interface ResourceRow {
  name: string;
  type: string;
  start: number;
  end: number;
  transfer: number;
  encoded: number;
  decoded: number;
}

export interface PageData {
  nav: { responseEnd: number; domContentLoaded: number; load: number; transfer: number };
  resources: ResourceRow[];
  paints: Record<string, number>;
  lcp: { t: number; el: string; url: string; size: number }[];
  elements: { id: string; render: number; load: number }[];
  long: { start: number; dur: number }[];
  marks: { name: string; t: number; dur: number }[];
  usable: number | null;
  handoff: Record<string, unknown> | null;
}

export interface TraceSummary {
  /** Self time on the page's main thread by event name, ms. */
  mainSelf: Record<string, number>;
  /** Wasm-related events on any thread: name → {ms, thread}. */
  wasm: { name: string; thread: string; start: number; dur: number }[];
  /** Script compile/parse by thread, ms. */
  compile: Record<string, number>;
  /** Image decode by thread, ms. */
  decode: Record<string, number>;
  /** The page's `b1:` measures on the trace clock (µs), to cut the CPU profile by phase. */
  windows: { name: string; start: number; end: number }[];
}

export interface Run {
  throttle: ThrottleName;
  renderer: string;
  page: PageData;
  trace: TraceSummary | null;
  profile: Record<string, number> | null;
  /** Per `b1:` phase: the functions with the most self time (name @ chunk:line, ms). */
  phases: Record<string, [string, number][]> | null;
}

/** Self time by function inside each window (profile and trace share the TimeTicks clock). */
export function profileByPhase(profile: { nodes: ProfileNode[]; samples: number[]; timeDeltas: number[]; startTime: number }, windows: TraceSummary['windows'], top = 6): Record<string, [string, number][]> {
  const byId = new Map<number, ProfileNode>();
  for (const n of profile.nodes) byId.set(n.id, n);
  const out: Record<string, [string, number][]> = {};
  const acc = windows.map(() => new Map<string, number>());
  let t = profile.startTime;
  for (let i = 0; i < profile.samples.length; i++) {
    t += profile.timeDeltas[i] ?? 0;
    const dt = (profile.timeDeltas[i + 1] ?? 0) / 1000;
    const n = byId.get(profile.samples[i]!);
    if (!n) continue;
    const f = n.callFrame;
    const file = f.url ? f.url.replace(/^.*\//, '').replace(/\.[A-Za-z0-9_-]{8}\.js$/, '.js') : '';
    const key = `${f.functionName || '(anonymous)'}${file ? ` @${file}:${f.lineNumber + 1}:${(f.columnNumber ?? 0) + 1}` : ''}`;
    windows.forEach((w, k) => {
      if (t >= w.start && t < w.end) acc[k]!.set(key, (acc[k]!.get(key) ?? 0) + dt);
    });
  }
  windows.forEach((w, k) => {
    out[w.name] = [...acc[k]!.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
  });
  return out;
}

const INIT = `(() => {
  const lt = (window.__lt = { long: [], lcp: [], el: [], usable: null });
  const obs = (type, f) => { try { new PerformanceObserver((l) => l.getEntries().forEach(f)).observe({ type, buffered: true }); } catch (e) {} };
  obs('longtask', (e) => lt.long.push({ start: e.startTime, dur: e.duration }));
  obs('largest-contentful-paint', (e) => lt.lcp.push({ t: e.startTime, el: e.element ? e.element.tagName + (e.element.className ? '.' + e.element.className : '') : '', url: e.url || '', size: e.size }));
  obs('element', (e) => lt.el.push({ id: e.identifier, render: e.renderTime, load: e.loadTime }));
  const poll = () => {
    const h = window.__handoff;
    if (h && typeof h.usableAt === 'number') { lt.usable = h.usableAt; return; }
    if (h && h.failed) { lt.usable = -1; return; }
    if (!h && (window.__vignette || window.__bench)) { lt.usable = performance.now(); return; }
    requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
})();`;

async function collect(page: Page): Promise<PageData> {
  return page.evaluate(() => {
    const lt = (window as unknown as { __lt: { long: PageData['long']; lcp: PageData['lcp']; el: PageData['elements']; usable: number | null } }).__lt;
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const res = (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).map((r) => ({
      name: r.name.replace(location.origin, ''),
      type: r.initiatorType,
      start: r.startTime,
      end: r.responseEnd,
      transfer: r.transferSize,
      encoded: r.encodedBodySize,
      decoded: r.decodedBodySize,
    }));
    const paints: Record<string, number> = {};
    for (const p of performance.getEntriesByType('paint')) paints[p.name] = p.startTime;
    const marks = [...performance.getEntriesByType('mark'), ...performance.getEntriesByType('measure')]
      .filter((m) => m.name.startsWith('b1:'))
      .map((m) => ({ name: m.name, t: m.startTime, dur: m.duration }));
    const h = (window as unknown as { __handoff?: { report?: () => Record<string, unknown> } }).__handoff;
    return {
      nav: { responseEnd: nav?.responseEnd ?? 0, domContentLoaded: nav?.domContentLoadedEventEnd ?? 0, load: nav?.loadEventEnd ?? 0, transfer: nav?.transferSize ?? 0 },
      resources: res,
      paints,
      lcp: lt.lcp,
      elements: lt.el,
      long: lt.long,
      marks,
      usable: lt.usable,
      handoff: h?.report ? h.report() : null,
    };
  });
}

interface TraceEvent {
  name: string;
  cat: string;
  ph: string;
  ts: number;
  dur?: number;
  pid: number;
  tid: number;
  args?: Record<string, unknown>;
}

export function summariseTrace(events: TraceEvent[]): TraceSummary {
  const threadName = new Map<string, string>();
  for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') threadName.set(`${e.pid}:${e.tid}`, String((e.args as { name?: string })?.name ?? ''));
  const x = events.filter((e) => e.ph === 'X' && typeof e.dur === 'number');
  // the page's main thread: the busiest CrRendererMain
  const busy = new Map<string, number>();
  for (const e of x) {
    const k = `${e.pid}:${e.tid}`;
    if (threadName.get(k) === 'CrRendererMain') busy.set(k, (busy.get(k) ?? 0) + e.dur!);
  }
  const main = [...busy.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  let t0 = Number.POSITIVE_INFINITY;
  for (const e of x) if (e.ts < t0) t0 = e.ts;
  const mainSelf: Record<string, number> = {};
  if (main) {
    const evs = x.filter((e) => `${e.pid}:${e.tid}` === main).sort((a, b) => a.ts - b.ts || b.dur! - a.dur!);
    const stack: { e: TraceEvent; child: number }[] = [];
    const close = (until: number): void => {
      while (stack.length && stack[stack.length - 1]!.e.ts + stack[stack.length - 1]!.e.dur! <= until) {
        const s = stack.pop()!;
        mainSelf[s.e.name] = (mainSelf[s.e.name] ?? 0) + (s.e.dur! - s.child) / 1000;
        if (stack.length) stack[stack.length - 1]!.child += s.e.dur!;
      }
    };
    for (const e of evs) {
      close(e.ts);
      stack.push({ e, child: 0 });
    }
    close(Number.POSITIVE_INFINITY);
  }
  const wasm = x
    .filter((e) => /wasm/i.test(e.name) || /wasm/i.test(e.cat))
    .map((e) => ({ name: e.name, thread: threadName.get(`${e.pid}:${e.tid}`) ?? `${e.tid}`, start: (e.ts - t0) / 1000, dur: e.dur! / 1000 }));
  const byThread = (re: RegExp): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const e of x) {
      if (!re.test(e.name)) continue;
      const t = `${e.pid}:${e.tid}` === main ? 'main' : (threadName.get(`${e.pid}:${e.tid}`) ?? 'other');
      out[t] = (out[t] ?? 0) + e.dur! / 1000;
    }
    return out;
  };
  return {
    mainSelf,
    wasm,
    compile: byThread(/^(v8\.compile|v8\.compileModule|v8\.parseOnBackground|V8\.CompileCode|v8\.produceCache|v8\.produceModuleCache|V8\.ScriptCompiler|v8\.compileLazy)/),
    decode: byThread(/^(Decode Image|ImageDecodeTask|Decode LazyPixelRef)/),
    windows: userTimingWindows(events),
  };
}

/** The page's `b1:` measures as they appear in the trace (async begin/end pairs on the trace clock). */
function userTimingWindows(events: TraceEvent[]): TraceSummary['windows'] {
  const open = new Map<string, number>();
  const out: TraceSummary['windows'] = [];
  for (const e of [...events].sort((a, b) => a.ts - b.ts)) {
    if (!e.name.startsWith('b1:') || !/user_timing/.test(e.cat)) continue;
    const x = e as { id?: unknown; id2?: unknown };
    const key = `${e.name}#${JSON.stringify(x.id ?? x.id2 ?? '')}`;
    if (e.ph === 'b') open.set(key, e.ts);
    else if (e.ph === 'e' && open.has(key)) {
      out.push({ name: e.name.slice(3), start: open.get(key)!, end: e.ts });
      open.delete(key);
    }
  }
  return out;
}

interface ProfileNode {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number; columnNumber?: number };
  children?: number[];
  hitCount?: number;
}

/**
 * Inclusive time per script file: each sample's stack, outermost frame of
 * each file counted once. Chunks are named after their piece or module, so
 * this is time per piece (geometry build) and per subsystem.
 */
export function profileByFile(profile: { nodes: ProfileNode[]; samples: number[]; timeDeltas: number[] }): Record<string, number> {
  const parent = new Map<number, number>();
  const byId = new Map<number, ProfileNode>();
  for (const n of profile.nodes) {
    byId.set(n.id, n);
    for (const c of n.children ?? []) parent.set(c, n.id);
  }
  const fileOf = (n: ProfileNode): string => {
    const u = n.callFrame.url;
    if (!u) return n.callFrame.functionName ? `(${n.callFrame.functionName})` : '(native)';
    const f = u.replace(/^.*\/_astro\//, '').replace(/^https?:\/\/[^/]+/, '');
    return f.replace(/\.[A-Za-z0-9_-]{8}\.js$/, '.js');
  };
  const out: Record<string, number> = {};
  for (let i = 0; i < profile.samples.length; i++) {
    const dt = (profile.timeDeltas[i + 1] ?? profile.timeDeltas[i] ?? 0) / 1000;
    const seen = new Set<string>();
    for (let id: number | undefined = profile.samples[i]; id !== undefined; id = parent.get(id)) {
      const n = byId.get(id);
      if (!n) break;
      const f = fileOf(n);
      if (seen.has(f)) continue;
      seen.add(f);
      out[f] = (out[f] ?? 0) + dt;
    }
  }
  return out;
}

export interface LoadOptions {
  w: number;
  h: number;
  throttle: ThrottleName;
  trace: boolean;
  profile: boolean;
  timeout?: number;
  query?: string;
}

async function throttleOn(cdp: CDPSession, t: ThrottleName): Promise<void> {
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  const c = THROTTLES[t];
  if (c) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...c });
}

/** One cold load. */
export async function coldLoad(url: string, o: LoadOptions): Promise<Run> {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: [...GPU_ARGS, '--ignore-certificate-errors'] });
  try {
    const context = await browser.newContext({ viewport: { width: o.w, height: o.h }, ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(INIT);
    const cdp = await context.newCDPSession(page);
    await throttleOn(cdp, o.throttle);
    if (o.profile) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
      await cdp.send('Profiler.start');
    }
    if (o.trace) {
      await browser.startTracing(page, {
        categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8', 'v8.wasm', 'disabled-by-default-v8.compile', 'blink.user_timing', 'loading', 'toplevel'],
      });
    }
    await page.goto(url, { waitUntil: 'commit', timeout: 60_000 });
    await page.waitForFunction('window.__lt && window.__lt.usable !== null', null, { timeout: o.timeout ?? 60_000, polling: 50 });
    await page.waitForTimeout(400);
    const data = await collect(page);
    let profile: Record<string, number> | null = null;
    let raw: { nodes: ProfileNode[]; samples: number[]; timeDeltas: number[]; startTime: number } | null = null;
    if (o.profile) {
      const { profile: p } = (await cdp.send('Profiler.stop')) as unknown as { profile: { nodes: ProfileNode[]; samples: number[]; timeDeltas: number[]; startTime: number; endTime: number } };
      profile = profileByFile(p);
      raw = p;
    }
    let trace: TraceSummary | null = null;
    if (o.trace) {
      const buf = await browser.stopTracing();
      const json = JSON.parse(buf.toString()) as { traceEvents: TraceEvent[] };
      trace = summariseTrace(json.traceEvents);
    }
    const phases = raw && trace ? profileByPhase(raw, trace.windows) : null;
    const renderer = await page.evaluate(() => {
      const c = document.createElement('canvas').getContext('webgl2');
      const e = c?.getExtension('WEBGL_debug_renderer_info');
      return c ? String(e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : c.getParameter(c.RENDERER)) : 'no webgl2';
    });
    if (errors.length) throw new Error(`page error: ${errors[0]}`);
    return { throttle: o.throttle, renderer, page: data, trace, profile, phases };
  } finally {
    await browser.close();
  }
}

// ───────────────────────── the report ─────────────────────────

const kb = (b: number): string => `${(b / 1024).toFixed(1)} KB`;
const ms = (v: number | null | undefined): string => (v === null || v === undefined || !Number.isFinite(v) ? '   -  ' : `${v.toFixed(0).padStart(5)} ms`);

/** First paint of the picture: element timing of the poster, else the first contentful paint. */
export function picturePaint(d: PageData): number | null {
  const el = d.elements.find((e) => e.id === 'poster');
  if (el) return el.render || el.load;
  return d.paints['first-contentful-paint'] ?? null;
}

/** Bytes transferred before the picture was painted (the first-paint budget). */
export function firstPaintBytes(d: PageData, at: number | null): number {
  if (at === null) return 0;
  return d.nav.transfer + d.resources.filter((r) => r.start <= at).reduce((s, r) => s + r.transfer, 0);
}

export function describe(run: Run, detail: boolean): string {
  const d = run.page;
  const L: string[] = [];
  const pic = picturePaint(d);
  const total = d.nav.transfer + d.resources.reduce((s, r) => s + r.transfer, 0);
  const decoded = d.resources.reduce((s, r) => s + r.decoded, 0);
  L.push(`  ${run.throttle.padEnd(7)} picture ${ms(pic)}   usable ${ms(d.usable)}   requests ${d.resources.length + 1}   transfer ${kb(total)} (decoded ${kb(decoded)})   first-paint bytes ${kb(firstPaintBytes(d, pic))}   long tasks ${d.long.length} (${d.long.reduce((s, l) => s + l.dur, 0).toFixed(0)} ms, max ${Math.max(0, ...d.long.map((l) => l.dur)).toFixed(0)})`);
  if (!detail) return L.join('\n');
  L.push(`    html ${ms(d.nav.responseEnd)}  DCL ${ms(d.nav.domContentLoaded)}  load ${ms(d.nav.load)}  FCP ${ms(d.paints['first-contentful-paint'])}  LCP ${ms(d.lcp.at(-1)?.t)} ${d.lcp.at(-1)?.el ?? ''}`);
  L.push('    network (by end time):');
  for (const r of [...d.resources].sort((a, b) => a.end - b.end)) {
    L.push(`      ${ms(r.start)} → ${ms(r.end)}  ${kb(r.transfer).padStart(10)}  ${r.name.replace(/^\/_astro\//, '').slice(0, 70)}`);
  }
  if (d.marks.length) {
    L.push('    phases (performance marks):');
    for (const m of [...d.marks].sort((a, b) => a.t - b.t)) L.push(`      ${ms(m.t)}${m.dur ? ` +${m.dur.toFixed(1).padStart(6)} ms` : '           '}  ${m.name.slice(3)}`);
  }
  L.push(`    long tasks: ${d.long.map((l) => `${l.start.toFixed(0)}+${l.dur.toFixed(0)}`).join('  ')}`);
  if (run.trace) {
    const t = run.trace;
    const top = Object.entries(t.mainSelf).sort((a, b) => b[1] - a[1]).slice(0, 18);
    L.push(`    main thread, self time by trace event: ${top.map(([n, v]) => `${n} ${v.toFixed(0)}`).join(' · ')}`);
    L.push(`    script compile by thread: ${Object.entries(t.compile).map(([k, v]) => `${k} ${v.toFixed(0)} ms`).join(' · ') || '-'}`);
    L.push(`    image decode by thread: ${Object.entries(t.decode).map(([k, v]) => `${k} ${v.toFixed(1)} ms`).join(' · ') || '-'}`);
    const w = new Map<string, { n: number; ms: number; thread: string; first: number }>();
    for (const e of t.wasm) {
      const k = `${e.name} @${e.thread}`;
      const v = w.get(k) ?? { n: 0, ms: 0, thread: e.thread, first: e.start };
      v.n++;
      v.ms += e.dur;
      w.set(k, v);
    }
    L.push(`    wasm: ${[...w.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 10).map(([k, v]) => `${k} ×${v.n} ${v.ms.toFixed(0)} ms`).join(' · ') || '-'}`);
  }
  if (run.profile) {
    const top = Object.entries(run.profile).filter(([k]) => !k.startsWith('(')).sort((a, b) => b[1] - a[1]).slice(0, 40);
    L.push('    CPU profile, inclusive ms by chunk (a chunk is a piece or a module):');
    for (const [k, v] of top) L.push(`      ${v.toFixed(0).padStart(6)}  ${k}`);
  }
  if (run.phases) {
    L.push('    CPU profile by phase, self ms of the top functions (names are minified in the bundle; the chunk says whose):');
    for (const [k, fns] of Object.entries(run.phases)) {
      if (k === 'to usable' || !fns.length) continue;
      L.push(`      ${k}: ${fns.map(([f, v]) => `${f} ${v.toFixed(0)}`).join(' · ')}`);
    }
  }
  if (d.handoff) L.push(`    handoff: ${JSON.stringify(d.handoff)}`);
  return L.join('\n');
}

const quant = (xs: number[], q: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? NaN;
};
export function spread(xs: number[]): string {
  const ok = xs.filter((v) => Number.isFinite(v));
  if (!ok.length) return '-';
  return `median ${quant(ok, 0.5).toFixed(0)} ms (min ${Math.min(...ok).toFixed(0)}, max ${Math.max(...ok).toFixed(0)}, n ${ok.length})`;
}

// ───────────────────────── the command line ─────────────────────────

const USAGE = `usage: node scripts/loadtime.ts [--path /dev/handoff/] [--runs 3] [--throttle both|none|fast4g] [--dist dir]
       [--w 1440 --h 900] [--profile] [--no-trace] [--json out.json] [--record out.mp4 --seconds 10]`;

async function main(): Promise<number> {
  let v: Record<string, string | boolean | undefined>;
  try {
    v = parseArgs({
      args: process.argv.slice(2),
      options: {
        path: { type: 'string' },
        runs: { type: 'string' },
        throttle: { type: 'string' },
        dist: { type: 'string' },
        w: { type: 'string' },
        h: { type: 'string' },
        profile: { type: 'boolean' },
        'no-trace': { type: 'boolean' },
        json: { type: 'string' },
        record: { type: 'string' },
        seconds: { type: 'string' },
        help: { type: 'boolean' },
      },
    }).values;
  } catch (e) {
    console.error(`loadtime: ${(e as Error).message}\n${USAGE}`);
    return 2;
  }
  if (v['help']) {
    console.log(USAGE);
    return 0;
  }
  const path = String(v['path'] ?? '/dev/handoff/');
  const runs = Number(v['runs'] ?? 3);
  const which = String(v['throttle'] ?? 'both');
  const throttles: ThrottleName[] = which === 'both' ? ['none', 'fast4g'] : which === 'none' || which === 'fast4g' ? [which] : [];
  if (!throttles.length || !(runs >= 1)) {
    console.error(USAGE);
    return 2;
  }
  const w = Number(v['w'] ?? 1440);
  const h = Number(v['h'] ?? 900);

  let built: string | null = null;
  let dist = v['dist'] ? resolve(String(v['dist'])) : null;
  if (!dist) {
    built = tempBuildDir('loadtime');
    console.log('building with the dev pages…');
    buildWithDevPages(built);
    dist = built;
  }
  const server = await serveDist(dist);
  const url = server.origin + path;
  const all: Run[] = [];
  try {
    if (v['record']) {
      const out = String(v['record']);
      const seconds = Number(v['seconds'] ?? 10);
      const t = throttles[throttles.length - 1]!;
      const browser = await chromium.launch({ channel: 'chrome', headless: true, args: [...GPU_ARGS, '--ignore-certificate-errors'] });
      try {
        const context = await browser.newContext({ viewport: { width: w, height: h }, ignoreHTTPSErrors: true });
        const page = await context.newPage();
        await page.goto('about:blank');
        await throttleOn(await context.newCDPSession(page), t);
        const s: Session = { browser, context, page, renderer: '', errors: [], close: () => browser.close() };
        const fps = await record(s, seconds, out, { fps: 30, w, h, dpr: 1, script: async ({ page: p }) => void (await p.goto(url, { waitUntil: 'commit' })) });
        console.log(`recorded ${resolve(out)}: a cold load at ${t}, ${seconds} s, ~${fps.toFixed(1)} captured frames/s`);
      } finally {
        await browser.close();
      }
      return 0;
    }
    for (const t of throttles) {
      console.log(`\n${path} at ${w}×${h}, ${t === 'none' ? 'unthrottled' : 'Fast 4G (9 Mbit/s, 165 ms)'}, ${runs} cold run(s)`);
      const mine: Run[] = [];
      if (!v['no-trace'] || v['profile']) {
        // one instrumented run for the breakdown (tracing and sampling slow the page: not counted)
        const run = await coldLoad(url, { w, h, throttle: t, trace: !v['no-trace'], profile: !!v['profile'] });
        if (isSoftware(run.renderer)) console.log(`WARNING software renderer (${run.renderer}): timings are meaningless`);
        console.log('  instrumented run (trace' + (v['profile'] ? ' + CPU profile' : '') + '; slower, not counted):');
        console.log(describe(run, true));
        all.push(run);
      }
      for (let i = 0; i < runs; i++) {
        const run = await coldLoad(url, { w, h, throttle: t, trace: false, profile: false });
        console.log(describe(run, i === 0 && !!v['no-trace']));
        mine.push(run);
        all.push(run);
      }
      console.log(`  ⇒ picture: ${spread(mine.map((r) => picturePaint(r.page) ?? NaN))}`);
      console.log(`  ⇒ usable:  ${spread(mine.map((r) => r.page.usable ?? NaN))}`);
    }
    if (v['json']) writeFileSync(String(v['json']), JSON.stringify(all, null, 1));
    return 0;
  } finally {
    await server.stop();
    if (built) rmSync(built, { recursive: true, force: true });
  }
}

if (isMain(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(`loadtime: ${String(e instanceof Error ? e.stack : e)}`);
      process.exit(1);
    },
  );
}
