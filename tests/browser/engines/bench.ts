// The engine-neutral set's one helper (REWRITE.md § E8 Browser row): where the bench lives, how to open it,
// how to watch a page for errors and requests, and how to read pixels, the same in Chromium, Firefox and
// WebKit. No CDP, no `channel`, no GPU flags: whatever WebGL each engine has (software here).
//
// The bench lives at BENCH. When it moves from /dev/bench/ to /, change that one line to
//   export const BENCH: … = { path: '/', server: 'built' };
// ('dev': this file starts an Astro dev server for the worker, as dev pages need; 'built': the config's own
// web server, the built site, at baseURL).
import { test as base, expect, type Page, type Browser, type BrowserContextOptions } from '@playwright/test';
import { startDevServer } from '../../../scripts/capture.ts';
import { gpuArgs } from '../../../playwright.config.ts';

export const BENCH: { readonly path: string; readonly server: 'dev' | 'built' } = { path: '/dev/bench/', server: 'dev' };

/**
 * The longest any one wait may take. Firefox and WebKit draw in software here, so the set opens the bench at
 * the low tier on a small screen (LIGHT, SMALL) and waits on the simulation's own step counter; a page that
 * cannot get there in this long is a finding, not something to wait out.
 */
export const SLOW = 90_000;
/** The bench's query for the set: the low tier (no shadow map, no post chain, pixel ratio 1). */
export const LIGHT = '?tier=low';
/** A small screen at device scale 1. */
export const SMALL = { viewport: { width: 800, height: 500 }, deviceScaleFactor: 1 } as const;

export interface Watch {
  /** Console errors and uncaught exceptions (page errors), as text. */
  errors: string[];
  /** Requests to this site that failed or answered 400 and up. */
  failed: string[];
  /** Requests that left the site's origin (data: and blob: are the page's own). */
  foreign: string[];
}

/** Watch a page from now on: console errors, page errors, failed requests, requests to other origins. */
export function watch(page: Page, origin: string): Watch {
  const w: Watch = { errors: [], failed: [], foreign: [] };
  const own = (url: string): boolean => url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:') || url === 'about:blank';
  // The browser's own request for /favicon.ico (Chromium asks; the dev page has none) is not the page's.
  const browsers = (url: string): boolean => new URL(url, origin).pathname === '/favicon.ico';
  page.on('console', (m) => {
    if (m.type() === 'error' && !browsers(m.location().url || origin)) w.errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => w.errors.push(`pageerror: ${e.message}`));
  page.on('request', (r) => {
    if (!own(r.url())) w.foreign.push(r.url());
  });
  page.on('requestfailed', (r) => {
    if (own(r.url()) && !browsers(r.url())) w.failed.push(`${r.url()} ${r.failure()?.errorText ?? ''}`);
  });
  page.on('response', (r) => {
    if (own(r.url()) && !browsers(r.url()) && r.status() >= 400) w.failed.push(`${r.url()} ${r.status()}`);
  });
  return w;
}

export interface Bench {
  /** The site's origin the bench is served from. */
  origin: string;
  /** The bench's URL with a query ('?hold=1'). */
  url(query?: string): string;
  /** Open the bench in `page` and watch it; resolves once the page has loaded (not the stage). */
  open(page: Page, query?: string): Promise<Watch>;
  /** A fresh context (touch, reduced motion, a viewport) on the same browser, closed after the test. */
  context(options: BrowserContextOptions): Promise<Page>;
}

/** Until the stage is live (or has failed: then the test says why). Counted in the page's own progress. */
export async function live(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const h = (window as any).__handoff;
    return (h?.phase === 'live' || h?.phase === 'failed') && (window as any).__ready === true;
  }, null, { timeout: SLOW, polling: 250 });
  const h = await page.evaluate(() => ({ phase: (window as any).__handoff.phase, failed: (window as any).__handoff.failed }));
  expect(h.phase, `the stage failed to start: ${h.failed}`).toBe('live');
}

/** The world's state through the bench page's test hook (window.__bench). */
export function world<T>(page: Page, fn: string): Promise<T> {
  return page.evaluate((src) => new Function('w', 'b', `return (${src})(w, b);`)((window as any).__bench.ws.world, (window as any).__bench), fn) as Promise<T>;
}

/** The step counter of the world. */
export const stepOf = (page: Page): Promise<number> => page.evaluate(() => (window as any).__bench.ws.world.step as number);

/** Wait until the world has taken `n` more steps, however long the frames take. */
export async function steps(page: Page, n: number): Promise<void> {
  const s0 = await stepOf(page);
  await page.waitForFunction((s) => (window as any).__bench.ws.world.step >= s, s0 + n, { timeout: SLOW, polling: 100 });
}

export interface Pixels {
  w: number;
  h: number;
  /** RGBA, row by row. */
  data: number[];
}

/** A screenshot, shrunk to `w`×`h` and read back as RGBA (decoded in the page: the same code in every engine). */
export async function screenshotPixels(page: Page, w = 96, h = 60): Promise<Pixels> {
  const png = (await page.screenshot({ timeout: SLOW })).toString('base64');
  const data = await page.evaluate(
    async ([src, w, h]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${src}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0, w, h);
      return Array.from(g.getImageData(0, 0, w, h).data);
    },
    [png, w, h] as const,
  );
  return { w, h, data };
}

/** How varied a picture is: distinct colours (5 bits a channel) and the spread of brightness (0-255). */
export function variety(p: Pixels): { distinct: number; spread: number } {
  const seen = new Set<number>();
  let min = 255;
  let max = 0;
  for (let i = 0; i < p.data.length; i += 4) {
    const r = p.data[i]!, g = p.data[i + 1]!, b = p.data[i + 2]!;
    seen.add((r >> 3) | ((g >> 3) << 5) | ((b >> 3) << 10));
    const l = (r + g + b) / 3;
    min = Math.min(min, l);
    max = Math.max(max, l);
  }
  return { distinct: seen.size, spread: max - min };
}

/** Mean absolute difference per channel (0-255) between two pictures of one size. */
export function meanDiff(a: Pixels, b: Pixels): number {
  let s = 0;
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    for (let k = 0; k < 3; k++) s += Math.abs(a.data[i + k]! - b.data[i + k]!);
    n += 3;
  }
  return s / n;
}

/** Make WebGL unavailable before any of the page's scripts run: every engine, the same way. */
export const REFUSE_WEBGL = `(() => {
  const refuse = (proto) => {
    const get = proto.getContext;
    proto.getContext = function (kind, ...rest) {
      if (/^(webgl2?|experimental-webgl)$/.test(String(kind))) return null;
      return get.call(this, kind, ...rest);
    };
  };
  refuse(HTMLCanvasElement.prototype);
  if (typeof OffscreenCanvas !== 'undefined') refuse(OffscreenCanvas.prototype);
})();`;

let devServer: { origin: string; stop(): void } | null = null;

export const test = base.extend<{ bench: Bench }, { benchOrigin: string }>({
  // Chromium: system Chrome on the real GPU, as the Chromium-only specs run (Playwright's own headless
  // Chromium draws the bench in SwiftShader at many cores for minutes). Firefox and WebKit: their own builds.
  channel: [async ({ browserName }, use) => use(browserName === 'chromium' ? 'chrome' : undefined), { scope: 'worker' }],
  launchOptions: [async ({ browserName }, use) => use(browserName === 'chromium' ? { args: gpuArgs } : {}), { scope: 'worker' }],
  viewport: SMALL.viewport,
  deviceScaleFactor: SMALL.deviceScaleFactor,
  benchOrigin: [
    async ({}, use, info) => {
      if (BENCH.server === 'built') {
        await use(String(info.project.use.baseURL));
        return;
      }
      devServer ??= await startDevServer();
      await use(devServer.origin);
      devServer.stop();
      devServer = null;
    },
    { scope: 'worker', timeout: 120_000 },
  ],
  bench: async ({ benchOrigin, browser }, use) => {
    const opened: { close(): Promise<void> }[] = [];
    const bench: Bench = {
      origin: benchOrigin,
      url: (query = '') => `${benchOrigin}${BENCH.path}${query}`,
      async open(page, query = '') {
        const w = watch(page, benchOrigin);
        await page.goto(bench.url(query), { timeout: SLOW });
        return w;
      },
      async context(options) {
        const ctx = await (browser as Browser).newContext(options);
        opened.push(ctx);
        return ctx.newPage();
      },
    };
    await use(bench);
    for (const c of opened) await c.close();
  },
});

export { expect };
