// capture: stills and recordings of a page on the REAL GPU (W1 brief § 4).
// The team's eyes: every gate packet's pictures and recordings come from here.
//
//   node scripts/capture.ts <url-or-/path> --out shot.png
//        [--w 1440] [--h 900] [--dpr 1] [--mobile]
//        [--advance N]        manual mode, run N simulation steps, render one frame
//        [--eval "js"]        run in the page after it is ready, before the shot
//        [--clip x,y,w,h]     [--wait ms]  [--no-ready]
//   node scripts/capture.ts <url-or-/path> --record 20 --out clip.mp4|clip.webm
//        [--script actions.js] [--fps 30]
//   [--allow-software]  allow SwiftShader/llvmpipe for a recording (refused otherwise)
//
// Given a /path instead of a URL it starts its own `astro dev` on a free port
// (--ignore-lock, so it never collides with anyone else's server) and stops it
// at the end. It prints the WebGL renderer string every time.
//
// A --script module exports `default async ({ page, mouse, keyboard, w, h, sleep }) => {}`
// and runs while the recording rolls (Playwright's mouse and keyboard API).
//
// Exit codes: 0 ok, 1 failed (page error, ready timeout, refused), 2 usage.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { isMain, REPO_ROOT } from './lib/cli.ts';

/** Chrome flags that get the real GPU in headless mode (same as playwright.config.ts `gpuArgs`). */
export const GPU_ARGS = ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'];
/** Uncapped frames, so frame deltas show real cost (perf). */
export const NO_VSYNC_ARGS = ['--disable-gpu-vsync', '--disable-frame-rate-limit'];

export function isSoftware(renderer: string): boolean {
  return /swiftshader|llvmpipe|software|softpipe/i.test(renderer);
}

// ───────────────────────── the dev server ─────────────────────────

export async function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', rej);
    srv.listen(0, () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => res(port));
    });
  });
}

async function waitForHttp(url: string, ms: number): Promise<void> {
  const until = Date.now() + ms;
  let last = '';
  while (Date.now() < until) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
      last = `HTTP ${r.status}`;
    } catch (e) {
      last = (e as Error).message;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`server at ${url} did not answer within ${ms} ms (${last})`);
}

export interface DevServer {
  origin: string;
  stop(): void;
}

/** Start `astro dev` on a free port of its own; dev pages are served under /dev/. */
export async function startDevServer(root = REPO_ROOT, log = false): Promise<DevServer> {
  const port = await freePort();
  const child: ChildProcess = spawn('npx', ['astro', 'dev', '--port', String(port), '--ignore-lock'], {
    cwd: root,
    env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' },
    stdio: log ? 'inherit' : 'ignore',
    detached: true,
  });
  const stop = (): void => {
    try {
      if (child.pid) process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  };
  process.once('exit', stop);
  const origin = `http://localhost:${port}`;
  try {
    await waitForHttp(`${origin}/`, 60_000);
  } catch (e) {
    stop();
    throw e;
  }
  return { origin, stop };
}

// ───────────────────────── the browser ─────────────────────────

export interface Session {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  renderer: string;
  errors: string[];
  close(): Promise<void>;
}

export interface OpenOptions {
  w: number;
  h: number;
  dpr?: number;
  mobile?: boolean;
  vsync?: boolean;
  /** Wait for window.__ready === true (default true). */
  ready?: boolean;
  readyTimeout?: number;
  log?: (s: string) => void;
}

/** Open a page in system Chrome on the real GPU and wait until it says it is ready. */
export async function openPage(url: string, o: OpenOptions): Promise<Session> {
  const log = o.log ?? ((s: string) => console.log(s));
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: [...GPU_ARGS, ...(o.vsync === false ? NO_VSYNC_ARGS : [])],
  });
  const context = await browser.newContext({
    viewport: { width: o.w, height: o.h },
    deviceScaleFactor: o.dpr ?? 1,
    isMobile: !!o.mobile,
    hasTouch: !!o.mobile,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|404 \(Not Found\)/.test(m.text())) {
      errors.push(m.text());
      log(`console.error: ${m.text().slice(0, 400)}`);
    }
  });
  page.on('pageerror', (e) => {
    errors.push(String(e));
    log(`pageerror: ${String(e).slice(0, 600)}`);
  });
  await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
  if (o.ready !== false) {
    await page.waitForFunction('window.__ready === true', null, { timeout: o.readyTimeout ?? 45_000 });
  }
  const renderer = await page.evaluate(() => {
    const c = document.createElement('canvas').getContext('webgl2');
    if (!c) return 'no webgl2';
    const e = c.getExtension('WEBGL_debug_renderer_info');
    return String(e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : c.getParameter(c.RENDERER));
  });
  return {
    browser,
    context,
    page,
    renderer,
    errors,
    close: () => browser.close(),
  };
}

/** Resolve a URL or a /path (starting a dev server for the path). */
export async function resolveTarget(target: string): Promise<{ url: string; server: DevServer | null }> {
  if (/^https?:\/\//.test(target)) return { url: target, server: null };
  if (!target.startsWith('/')) throw new Error(`target must be a URL or a /path, got "${target}"`);
  const server = await startDevServer();
  return { url: server.origin + target, server };
}

export interface ScriptApi {
  page: Page;
  mouse: Page['mouse'];
  keyboard: Page['keyboard'];
  w: number;
  h: number;
  sleep(ms: number): Promise<void>;
}

export async function loadScript(file: string): Promise<(api: ScriptApi) => Promise<void>> {
  const mod = (await import(pathToFileURL(resolve(file)).href)) as { default?: unknown };
  if (typeof mod.default !== 'function') throw new Error(`${file} must export a default async function`);
  return mod.default as (api: ScriptApi) => Promise<void>;
}

export function scriptApi(page: Page, w: number, h: number): ScriptApi {
  return { page, mouse: page.mouse, keyboard: page.keyboard, w, h, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };
}

export function ffmpegPath(): string {
  const local = join(homedir(), '.local/bin/ffmpeg');
  return existsSync(local) ? local : 'ffmpeg';
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr?.on('data', (d: Buffer) => (err += d.toString()));
    p.on('error', rej);
    p.on('close', (code) => (code === 0 ? res() : rej(new Error(`${cmd} exited ${code}: ${err.slice(-800)}`))));
  });
}

/**
 * Record the page for `seconds` with Chrome's screencast (every composited
 * frame, with its timestamp) and encode with ffmpeg at a constant frame rate.
 */
export async function record(s: Session, seconds: number, out: string, opts: { fps: number; w: number; h: number; dpr: number; script?: (api: ScriptApi) => Promise<void> }): Promise<number> {
  const cdp = await s.context.newCDPSession(s.page);
  const frames: { data: string; t: number }[] = [];
  cdp.on('Page.screencastFrame', (f: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
    frames.push({ data: f.data, t: f.metadata.timestamp ?? Date.now() / 1000 });
    void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: Math.round(opts.w * opts.dpr), maxHeight: Math.round(opts.h * opts.dpr), everyNthFrame: 1 });
  const started = Date.now();
  const scripted = opts.script ? opts.script(scriptApi(s.page, opts.w, opts.h)).catch((e: unknown) => console.log(`script error: ${String(e)}`)) : Promise.resolve();
  await new Promise((r) => setTimeout(r, seconds * 1000));
  await scripted;
  await cdp.send('Page.stopScreencast');
  const elapsed = (Date.now() - started) / 1000;
  if (frames.length < 2) throw new Error(`screencast produced ${frames.length} frame(s)`);

  const dir = mkdtempSync(join(tmpdir(), 'capture-'));
  try {
    const lines: string[] = [];
    frames.forEach((f, i) => {
      const name = `f${String(i).padStart(6, '0')}.jpg`;
      writeFileSync(join(dir, name), Buffer.from(f.data, 'base64'));
      const next = frames[i + 1];
      const dur = next ? Math.max(0.001, next.t - f.t) : 1 / opts.fps;
      lines.push(`file '${name}'`, `duration ${dur.toFixed(5)}`);
    });
    // The concat demuxer needs the last file repeated to honour its duration.
    lines.push(`file 'f${String(frames.length - 1).padStart(6, '0')}.jpg'`);
    writeFileSync(join(dir, 'list.txt'), lines.join('\n'));
    const ext = extname(out).toLowerCase();
    const codec = ext === '.webm' ? ['-c:v', 'libvpx-vp9', '-crf', '28', '-b:v', '0', '-row-mt', '1'] : ['-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
    mkdirSync(dirname(resolve(out)), { recursive: true });
    await run(ffmpegPath(), ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', join(dir, 'list.txt'), '-vf', `fps=${opts.fps},scale=trunc(iw/2)*2:trunc(ih/2)*2`, ...codec, resolve(out)]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return frames.length / elapsed;
}

// ───────────────────────── the command line ─────────────────────────

const USAGE = `usage: node scripts/capture.ts <url-or-/path> --out file.png [--w 1440 --h 900 --dpr 1] [--advance N] [--eval js] [--clip x,y,w,h] [--mobile] [--wait ms] [--no-ready]
       node scripts/capture.ts <url-or-/path> --record seconds --out file.mp4|file.webm [--script actions.js] [--fps 30] [--allow-software]`;

async function main(): Promise<number> {
  let a: ReturnType<typeof parse>;
  function parse() {
    return parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      options: {
        out: { type: 'string' },
        w: { type: 'string' },
        h: { type: 'string' },
        dpr: { type: 'string' },
        advance: { type: 'string' },
        eval: { type: 'string' },
        clip: { type: 'string' },
        mobile: { type: 'boolean' },
        wait: { type: 'string' },
        'no-ready': { type: 'boolean' },
        record: { type: 'string' },
        script: { type: 'string' },
        fps: { type: 'string' },
        'allow-software': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  }
  try {
    a = parse();
  } catch (e) {
    console.error(`capture: ${(e as Error).message}\n${USAGE}`);
    return 2;
  }
  const v = a.values;
  if (v.help) {
    console.log(USAGE);
    return 0;
  }
  const target = a.positionals[0];
  if (!target || !v.out) {
    console.error(USAGE);
    return 2;
  }
  const mobile = !!v.mobile;
  const w = Number(v.w ?? (mobile ? 390 : 1440));
  const h = Number(v.h ?? (mobile ? 844 : 900));
  const dpr = Number(v.dpr ?? 1);
  const recording = v.record !== undefined;

  const { url, server } = await resolveTarget(target);
  let s: Session | null = null;
  try {
    s = await openPage(url, { w, h, dpr, mobile, ready: !v['no-ready'] });
    console.log(`renderer: ${s.renderer}`);
    if (isSoftware(s.renderer)) {
      if (recording && !v['allow-software']) {
        console.error('capture: refusing to record on a software renderer (frame timing would be meaningless); pass --allow-software to override');
        return 1;
      }
      console.log('capture: WARNING software renderer: this is not what a visitor sees');
    }
    if (v.advance !== undefined) {
      const n = Number(v.advance);
      await s.page.evaluate((k) => {
        const w = (window as unknown as { __workshop?: { loop: { setManual(b: boolean): void }; advance(n: number): void } }).__workshop;
        if (!w) throw new Error('--advance needs window.__workshop (a dev page with the debug hooks)');
        w.loop.setManual(true);
        w.advance(k);
      }, n);
    }
    if (v.eval) {
      const r = await s.page.evaluate(v.eval);
      if (r !== undefined) console.log(`eval: ${JSON.stringify(r)}`);
    }
    await s.page.waitForTimeout(Number(v.wait ?? (v.advance !== undefined ? 100 : 400)));
    if (recording) {
      const script = v.script ? await loadScript(v.script) : undefined;
      const fps = await record(s, Number(v.record), v.out, { fps: Number(v.fps ?? 30), w, h, dpr, ...(script ? { script } : {}) });
      console.log(`recorded ${resolve(v.out)} ${v.record}s at ~${fps.toFixed(1)} captured frames/s`);
    } else {
      const shot: Parameters<Page['screenshot']>[0] = { path: v.out };
      if (v.clip) {
        const [x, y, cw, ch] = v.clip.split(',').map(Number);
        shot.clip = { x: x ?? 0, y: y ?? 0, width: cw ?? w, height: ch ?? h };
      }
      mkdirSync(dirname(resolve(v.out)), { recursive: true });
      await s.page.screenshot(shot);
      console.log(`saved ${resolve(v.out)} ${w}x${h}@${dpr}`);
    }
    return s.errors.length ? 1 : 0;
  } catch (e) {
    console.error(`capture: ${(e as Error).message}`);
    return 1;
  } finally {
    await s?.close();
    server?.stop();
  }
}

if (isMain(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(`capture: ${String(e)}`);
      process.exit(1);
    },
  );
}
