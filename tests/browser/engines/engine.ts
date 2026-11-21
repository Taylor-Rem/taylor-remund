// What every engine's tests share (REWRITE.md § E8, Browser row): the launch each engine gets, how to open `/`
// at a tier the engine can draw, how to watch a page for errors and requests, how to wait in the simulation's
// own steps, and how to read pixels, the same in Chromium, Firefox and WebKit. No CDP anywhere.
//
// HOW A TEST RUNS IN EVERY ENGINE (the rule; playwright.config.ts's header says it too):
//   1. give the test, or a describe round it, the tag ENGINES (`{ tag: ENGINES }`): the firefox and webkit
//      projects run exactly the tests that carry it (the chromium project runs everything);
//   2. if it draws the stage, import `test` from this file, not from @playwright/test: Chromium is then system
//      Chrome on the real GPU (Playwright's own Chromium draws the bench in SwiftShader for minutes), Firefox and
//      WebKit their own builds (software WebGL here);
//   3. open the stage with `stageAt(path, browserName)` (a tier the engine can draw: Chromium's own choice,
//      `?tier=low` elsewhere), on a small screen where the test does not need a big one (SMALL);
//   4. wait on the page's own state or on `steps(page, n)`, never on the wall clock, with a hard timeout (SLOW):
//      Firefox and WebKit draw the bench at about ten frames a second here.
// Then run it five times in each engine (tests/browser/engines/run.ts).
//
// `/` has no development hooks. What these helpers read is what the page itself offers: the loader's
// `window.__handoff` (shell/loader.ts; its `workshop` is the running bench), the DOM, the live region, the
// address, storage, and the canvas's pixels.
import { test as base, expect, type Page } from '@playwright/test';
import { gpuArgs, ENGINES } from '../../../playwright.config.ts';

/** The tag that puts a test in the firefox and webkit projects (playwright.config.ts). */
export { ENGINES };

/**
 * The longest any one wait may take. Firefox and WebKit draw in software here, so the stage is opened at the low
 * tier on a small screen; a page that cannot get somewhere in this long is a finding, not something to wait out.
 */
export const SLOW = 90_000;
/** A small screen at device scale 1 (what a software renderer keeps up with). */
export const SMALL = { viewport: { width: 800, height: 500 }, deviceScaleFactor: 1 } as const;

/**
 * Where to open a page that draws the stage, in this engine: Chromium (system Chrome on the GPU) takes the tier
 * the page chooses for it; Firefox and WebKit, whose WebGL is software here and would be the Still tier by the
 * page's own rule (shell/tier.ts: a software renderer is the Still tier), are asked for the low tier.
 */
export function stageAt(path: string, browserName: string): string {
  if (browserName === 'chromium') return path;
  const u = new URL(path, 'http://x');
  u.searchParams.set('tier', 'low');
  return `${u.pathname}${u.search}${u.hash}`;
}

/** The tier `stageAt` gives in this engine, as `data-tier` reads once the stage is up. */
export const stageTier = (browserName: string): 'high' | 'low' => (browserName === 'chromium' ? 'high' : 'low');

/**
 * Chromium: system Chrome on the real GPU. Firefox and WebKit: their own builds (Firefox headed on the private
 * display the global setup starts: tests/browser/display.ts).
 */
export const test = base.extend({
  channel: [async ({ browserName }, use) => use(browserName === 'chromium' ? 'chrome' : undefined), { scope: 'worker' }],
  launchOptions: [async ({ browserName }, use) => use(browserName === 'chromium' ? { args: gpuArgs } : {}), { scope: 'worker' }],
});
export { expect };

/**
 * The one request the tests forgive, by its exact address: the browser's own `/favicon.ico`. The site has no
 * favicon yet (its picture is Taylor's to choose); system Chrome asks for it on every load and logs the 404 as
 * a console error. Firefox and WebKit do not ask (measured 2026-11-21: see the hand-in of E2).
 */
export const FAVICON = '/favicon.ico';

export interface Watch {
  /** Console errors and uncaught exceptions (page errors), as text. */
  errors: string[];
  /** Every request, in order. */
  requests: string[];
  /** Requests to this site that failed or answered 400 and up. */
  failed: string[];
  /** Requests that left the site's origin (data: and blob: are the page's own). */
  foreign: string[];
}

/** Watch a page from now on: console errors, page errors, every request, failed ones, ones to other origins. */
export function watch(page: Page, origin: string): Watch {
  const w: Watch = { errors: [], requests: [], failed: [], foreign: [] };
  const own = (url: string): boolean => url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:') || url === 'about:blank' || url === '';
  const favicon = (url: string): boolean => url === `${origin}${FAVICON}`;
  page.on('console', (m) => {
    if (m.type() === 'error' && !favicon(m.location().url)) w.errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => w.errors.push(`pageerror: ${e.message}`));
  page.on('request', (r) => {
    w.requests.push(r.url());
    if (!own(r.url())) w.foreign.push(r.url());
  });
  page.on('requestfailed', (r) => {
    if (own(r.url()) && !favicon(r.url())) w.failed.push(`${r.url()} ${r.failure()?.errorText ?? ''}`);
  });
  page.on('response', (r) => {
    if (own(r.url()) && !favicon(r.url()) && r.status() >= 400) w.failed.push(`${r.url()} ${r.status()}`);
  });
  return w;
}

/**
 * What the Still tier must never ask for: the stage's scripts, the physics engine (its script and its wasm),
 * the bake table, the label painters and their fonts. (The physics ADAPTER's small chunk, `physics.*.js`, is
 * fetched by every page's first script today: the bundler puts its dynamic-import helper there. Not the
 * engine; reported to the lead with the one-line config change that would move it.)
 */
export const HEAVY = [/\/_astro\/home\.[^/]*\.js$/, /\/_astro\/three\.[^/]*\.js$/, /\/_astro\/rapier\.[^/]*\.js$/, /\/_astro\/stations\.[^/]*\.js$/, /\/_astro\/pieces\.[^/]*\.js$/, /\/_astro\/early\.[^/]*\.js$/, /\.wasm(\?|$)/, /bake-table/, /\/_astro\/worker-/, /\/fonts\/workshop-(stencil|print|sign)\.woff2/];

type Win = Window & { __handoff?: { phase: string; failed: string | null; workshop: any } };

/**
 * Until the stage is live, its workshop there (within SLOW; if not, the test says where the loader got to and
 * why it failed). Live only: a page restarting after a failure still shows the old 'failed' for a moment.
 */
export async function live(page: Page, timeout = SLOW): Promise<void> {
  try {
    await page.waitForFunction(() => (window as Win).__handoff?.phase === 'live' && !!(window as Win).__handoff!.workshop, null, { timeout, polling: 100 });
  } catch (e) {
    const h = await page.evaluate(() => ({ phase: (window as Win).__handoff?.phase ?? null, failed: (window as Win).__handoff?.failed ?? null, tier: document.documentElement.dataset['tier'] })).catch(() => null);
    throw new Error(`the stage did not come up within ${timeout} ms: ${JSON.stringify(h)}\n${String(e)}`);
  }
}

/** Read the running workshop (`f` is sent as source: it may not close over anything; `a` is its argument). */
export function ws<T, A = undefined>(page: Page, f: (w: any, a: A) => T, a?: A): Promise<T> {
  return page.evaluate(([src, arg]) => new Function('w', 'a', `return (${src})(w, a);`)((window as Win).__handoff!.workshop, arg), [f.toString(), a] as const) as Promise<T>;
}

/** The world's step counter. */
export const stepOf = (page: Page): Promise<number> => page.evaluate(() => (window as Win).__handoff!.workshop.world.step as number);

/** Wait until the world has taken `n` more steps (60 a simulated second), however long the frames take. */
export async function steps(page: Page, n: number): Promise<void> {
  const s0 = await stepOf(page);
  await page.waitForFunction((s) => ((window as Win).__handoff?.workshop?.world.step ?? -1) >= s, s0 + n, { timeout: SLOW, polling: 100 });
}

/** Every part's place and the crew's: what "nothing moves" compares (settings.spec.ts too). */
export const positions = (page: Page): Promise<Record<string, unknown>> =>
  page.evaluate(() => {
    const w = (window as Win).__handoff!.workshop.world;
    const out: Record<string, unknown> = {};
    for (const p of w.parts()) {
      const m = w.motion(p.id);
      if (m) out[p.id] = [...m.pose.p, ...m.pose.q].map((v: number) => Math.round(v * 1e4) / 1e4);
    }
    // the crew without a body of their own (Patch): what it is doing
    for (const c of w.crewViews()) if (c.body === null) out[`crew:${c.id}`] = c.view.state;
    return out;
  });

/** What the controls list's polite live region holds now. */
export const said = (page: Page): Promise<string> => page.locator('#controls-said').innerText();

/** Frames drawn and steps taken a second, over `ms` of the page's own time (a measurement, never a wait for the world). */
export const rate = (page: Page, ms = 3000): Promise<{ fps: number; sps: number }> =>
  page.evaluate(
    (ms) =>
      new Promise<{ fps: number; sps: number }>((resolve) => {
        const w = (window as Win).__handoff!.workshop.world;
        const s0 = w.step;
        const t0 = performance.now();
        let n = 0;
        const f = (): void => {
          n++;
          const dt = performance.now() - t0;
          if (dt >= ms) resolve({ fps: Math.round((n * 10000) / dt) / 10, sps: Math.round(((w.step - s0) * 10000) / dt) / 10 });
          else requestAnimationFrame(f);
        };
        requestAnimationFrame(f);
      }),
    ms,
  );

export interface Pixels {
  w: number;
  h: number;
  /** RGBA, row by row. */
  data: number[];
}

/**
 * The stage's canvas as drawn, shrunk to `w`×`h` and read back as RGBA: read in an animation frame, after the
 * stage's own frame has drawn (its drawing buffer is not kept past the frame). The canvas only: not the strip.
 */
export const canvasPixels = (page: Page, w = 96, h = 60): Promise<Pixels> =>
  page.evaluate(
    ([w, h]) =>
      new Promise<Pixels>((resolve) =>
        requestAnimationFrame(() => {
          const c = ((window as Win).__handoff?.canvas ?? document.getElementById('stage')) as HTMLCanvasElement;
          const g = document.createElement('canvas');
          g.width = w;
          g.height = h;
          const x = g.getContext('2d')!;
          x.drawImage(c, 0, 0, w, h);
          resolve({ w, h, data: Array.from(x.getImageData(0, 0, w, h).data) });
        }),
      ),
    [w, h] as const,
  );

/**
 * The picture (`img.poster`) as the page shows it, shrunk to `w`×`h`: the file the browser chose, cropped as
 * `object-fit: cover` at 50% 50% crops it to its box. Read from the image itself, so nothing waits for the page
 * (a screenshot waits for every font, and WebKit holds that until the load event).
 */
export const picturePixels = (page: Page, w = 96, h = 60): Promise<Pixels> =>
  page.evaluate(
    async ([w, h]) => {
      const shown = document.querySelector<HTMLImageElement>('img.poster')!;
      const box = shown.getBoundingClientRect();
      // the file's own pixels (a srcset image's natural size is in CSS pixels, scaled by its density)
      const img = new Image();
      img.src = shown.currentSrc;
      await img.decode();
      const scale = Math.max(box.width / img.naturalWidth, box.height / img.naturalHeight);
      const sw = box.width / scale;
      const sh = box.height / scale;
      const g = document.createElement('canvas');
      g.width = w;
      g.height = h;
      const x = g.getContext('2d')!;
      x.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, 0, 0, w, h);
      return { w, h, data: Array.from(x.getImageData(0, 0, w, h).data) };
    },
    [w, h] as const,
  );

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
