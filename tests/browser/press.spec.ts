import { expect, test, type Page } from '@playwright/test';
import { gpuArgs } from '../../playwright.config.ts';
import { startDevServer, type DevServer } from '../../scripts/capture.ts';

// P4 D3: the report press's lever by a real hand, on /dev/bench/ on the real GPU: by mouse at 1440×900 and by a finger
// at 390×844, pulled where it is drawn, and a 44 px fingertip with the camera in on the press (the framing the
// crates' camera will give an opened crate's thing; until it lands, the page's own hand). The press is taken out of
// its crate by the page's own intents first (its crate set down on the open bench, the lid opened): that part is the
// crates' and is tested there.

test.use({ channel: 'chrome', launchOptions: { args: gpuArgs } });
test.describe.configure({ mode: 'serial' });
test.setTimeout(10 * 60_000);

let server: DevServer | null = null;
let origin = process.env.I1_ORIGIN ?? '';
test.beforeAll(async () => {
  if (!origin) {
    server = await startDevServer();
    origin = server.origin;
  }
});
test.afterAll(() => server?.stop());

type XY = { x: number; y: number };
const frameNo = (page: Page): Promise<number> => page.evaluate(() => (window as any).__bench.ws.driver.frames as number);
async function frames(page: Page, n = 6): Promise<void> {
  const f0 = await frameNo(page);
  await page.waitForFunction((f) => (window as any).__bench.ws.driver.frames >= f, f0 + n, { timeout: 0, polling: 50 });
}
async function until(page: Page, fn: () => Promise<boolean>, limit = 600, what = ''): Promise<void> {
  const f0 = await frameNo(page);
  for (;;) {
    if (await fn()) return;
    if ((await frameNo(page)) - f0 > limit) throw new Error(`not within ${limit} frames: ${what}`);
    await page.waitForTimeout(40);
  }
}

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${origin}/dev/bench/`);
  await page.waitForFunction(() => (window as any).__handoff?.phase === 'live' && (window as any).__ready === true, null, { timeout: 0, polling: 100 });
  // the press's crate off the stack, onto the open bench left of the lever's console, and opened: the press on its tray
  await page.evaluate(() => {
    const ws = (window as any).__bench.ws;
    ws.dispatch({ type: 'grab', id: 'crate-2', grip: ws.world.motion('crate-2').pose.p });
  });
  await frames(page, 3);
  await page.evaluate(() => (window as any).__bench.ws.dispatch({ type: 'place', at: [-4.0, 0, 1.6] }));
  await until(page, () => page.evaluate(() => (window as any).__bench.ws.world.part('crate-2').location.at === 'rest' && (window as any).__bench.ws.world.holding() === null), 600, 'crate-2 set down');
  await frames(page, 30);
  for (let k = 0; k < 12; k++) {
    if (await page.evaluate(() => (window as any).__bench.ws.world.setting('crate-2', 'open') === true)) break;
    await page.evaluate(() => (window as any).__bench.ws.dispatch({ type: 'press', id: 'crate-2-lid' }));
    await frames(page, 40);
  }
  await until(page, () => page.evaluate(() => (window as any).__bench.ws.world.mode('report-press') === 'machine'), 600, 'the press on its tray');
  await frames(page, 40);
  return errors;
}

const screenOf = (page: Page, id: string): Promise<{ x: number; y: number; r: number } | null> => page.evaluate((id) => (window as any).__bench.ws.surface.screen(id), id);
const drawer = (page: Page): Promise<number> => page.evaluate(() => (window as any).__bench.ws.world.setting('report-press', 'drawer'));

/** A 44 px fingertip round the target's middle: every point of its rim picks it, unless a neighbour's middle is nearer. */
const fingertip = (page: Page, id: string): Promise<string> =>
  page.evaluate((id) => {
    const ws = (window as any).__bench.ws;
    const s = ws.surface.screen(id);
    if (!s) return 'no pick target';
    const misses: string[] = [];
    for (const [dx, dy] of [[-15, -15], [0, -21], [15, -15], [-21, 0], [21, 0], [-15, 15], [0, 21], [15, 15], [0, 0]]) {
      const got = ws.surface.at(s.x + dx!, s.y + dy!, 'touch', null).id;
      if (got === id) continue;
      const g = got ? ws.surface.screen(got) : null;
      const fair = g && Math.hypot(g.x - s.x - dx!, g.y - s.y - dy!) < Math.hypot(dx!, dy!);
      if (!fair) misses.push(`${dx},${dy}→${got}`);
    }
    return misses.length ? `misses ${misses.join(' ')}` : 'ok';
  }, id);

/** The camera in close on the press, as the crates' camera will bring an opened crate's thing (its box about 360 px across at 1440×900). */
async function inClose(page: Page, size: number): Promise<void> {
  await page.evaluate((size) => {
    const ws = (window as any).__bench.ws;
    const p = ws.world.motion('report-press').pose.p;
    ws.stage.camera.stationSize = size;
    ws.stage.camera.cutTo({ focus: [p[0], p[1] + 0.08, p[2]], zoom: 1 }, { hold: true });
  }, size);
  await frames(page, 20);
}

test('P4 D3: the press\'s lever by mouse at 1440×900: a pull prints, stores a copy and flicks the envelope', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await open(page);
  await page.evaluate(() => (window as any).__bench.ws.framing.bring('press-lever'));
  await frames(page, 70);
  const framed = await screenOf(page, 'press-lever');
  await inClose(page, 1.2);
  const l = (await screenOf(page, 'press-lever'))!;
  expect(l, 'the lever is a target').not.toBeNull();
  await page.mouse.move(l.x - 30, l.y - 20);
  await frames(page, 2);
  await page.mouse.move(l.x, l.y, { steps: 4 });
  const cur = () => page.evaluate(() => (document.getElementById('stage') as HTMLCanvasElement).style.cursor);
  await until(page, async () => /pointer$/.test(await cur()), 60, `one finger over the lever (${await cur()})`);
  const before = await drawer(page);
  await page.mouse.click(l.x, l.y);
  await until(page, async () => (await drawer(page)) === before + 1, 120, 'a pull by a click on the lever');
  await until(page, () => page.evaluate(() => (window as any).__bench.ws.world.part('report-envelope').location.mouth === 'belt'), 600, 'the envelope on the belt');
  console.log(`[D3] at 1440×900: the lever at its keyboard framing ${JSON.stringify(framed)}, in close ${JSON.stringify(l)}`);
  expect(errors).toEqual([]);
});

test('P4 D3: the press\'s lever by a finger at 390×844, the camera in on it: a tap pulls it; a 44 px fingertip', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = await open(page);
  await inClose(page, 0.9);
  const tip = await fingertip(page, 'press-lever');
  const l = (await screenOf(page, 'press-lever')) as XY;
  console.log(`[D3] 44 px at 390×844, camera in on the press: ${tip} ${JSON.stringify(l)}`);
  expect(tip).toBe('ok');
  const before = await drawer(page);
  await page.touchscreen.tap(l.x, l.y);
  await until(page, async () => (await drawer(page)) === before + 1, 120, 'a pull by a tap on the lever');
  expect(errors).toEqual([]);
  await ctx.close();
});
