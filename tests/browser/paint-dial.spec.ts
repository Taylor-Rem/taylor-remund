import { expect, test, type Page } from '@playwright/test';
import { gpuArgs } from '../../playwright.config.ts';
import { startDevServer, type DevServer } from '../../scripts/capture.ts';

// P4 D2b: the paint dial by a real hand, on /dev/bench/ on the real GPU: its knob turned by a mouse drag and clicked one
// detent on at 1440×900, tapped one detent on by a finger at 390×844, each where it is drawn; the workshop's enamel
// changes with it (the steel material's scheme). t-components' crate is opened by the page's own intent first (that
// part is the crates' and is tested there). The 44 px fingertip waits for the crates' camera, which frames a thing.

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

const KNOB = 'paint-dial-knob';
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
const scheme = (page: Page): Promise<string> => page.evaluate(() => (window as any).__bench.ws.world.setting('paint-dial', 'scheme'));
/** The scheme the steel material is drawing now (the view's), once its wipe is over. */
const painted = (page: Page): Promise<{ current: string; active: number }> => page.evaluate(() => {
  const m = (window as any).__bench.ws.materials;
  return { current: m.paint.current, active: m.paint.u.s_active.value };
});
const screenOf = (page: Page, id: string): Promise<{ x: number; y: number; r: number } | null> => page.evaluate((id) => (window as any).__bench.ws.surface.screen(id), id);

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${origin}/dev/bench/`);
  await page.waitForFunction(() => (window as any).__handoff?.phase === 'live' && (window as any).__ready === true, null, { timeout: 0, polling: 100 });
  for (let k = 0; k < 12; k++) {
    if (await page.evaluate(() => (window as any).__bench.ws.world.setting('crate-3', 'open') === true)) break;
    await page.evaluate(() => (window as any).__bench.ws.dispatch({ type: 'press', id: 'crate-3-lid' }));
    await frames(page, 40);
  }
  await until(page, () => page.evaluate(() => (window as any).__bench.ws.world.mode('paint-dial') === 'machine'), 300, 'the dial on its tray');
  return errors;
}

test('P4 D2b: the paint dial by mouse at 1440×900: a drag turns it through its detents, a click moves it one on; the enamel follows', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await open(page);
  expect(await scheme(page)).toBe('A');
  expect((await painted(page)).active).toBe(0);
  await page.evaluate((id) => (window as any).__bench.ws.framing.bring(id), KNOB);
  await frames(page, 70);
  const k = (await screenOf(page, KNOB))!;
  expect(k, 'the knob is a target').not.toBeNull();
  // a drag to the right turns it up, detent by detent: one gesture
  const n0 = await page.evaluate(() => (window as any).__bench.ws.world.undoStack().length);
  await page.mouse.move(k.x, k.y);
  await frames(page, 2);
  await page.mouse.down();
  for (let dx = 0; dx <= 160; dx += 16) {
    await page.mouse.move(k.x + dx, k.y);
    await frames(page, 1);
  }
  await page.mouse.up();
  await until(page, async () => (await scheme(page)) !== 'A', 120, 'turned by a drag');
  const dragged = await scheme(page);
  expect(await page.evaluate(() => (window as any).__bench.ws.world.undoStack().length)).toBe(n0 + 1);
  await until(page, async () => (await painted(page)).current === dragged, 200, 'the enamel follows');
  // a click: one detent on
  const order = await page.evaluate(() => (window as any).__bench.ws.world.machine('paint').schemes as string[]);
  const next = order[(order.indexOf(dragged) + 1) % order.length]!;
  await page.mouse.click(k.x, k.y);
  await until(page, async () => (await scheme(page)) === next, 120, 'one on by a click');
  // the lever: back to where the drag left it
  await page.evaluate(() => (window as any).__bench.ws.dispatch({ type: 'undo' }));
  await until(page, async () => (await scheme(page)) === dragged, 120, 'the lever takes the click back');
  console.log(`[D2b] at 1440×900, framed: ${JSON.stringify(await screenOf(page, KNOB))}, dragged to ${dragged}`);
  expect(errors).toEqual([]);
});

test('P4 D2b: the paint dial by a finger at 390×844: a tap moves it one detent on', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = await open(page);
  // in close on the dial (until the crates' own camera comes in on an opened crate, this is the page's hand on it)
  await page.evaluate(() => {
    const ws = (window as any).__bench.ws;
    const p = ws.world.motion('paint-dial').pose.p;
    ws.stage.camera.stationSize = 0.8;
    ws.stage.camera.cutTo({ focus: [p[0], p[1] + 0.03, p[2]], zoom: 1 }, { hold: true });
  });
  await frames(page, 20);
  const k = (await screenOf(page, KNOB))!;
  expect(k, 'the knob is a target').not.toBeNull();
  await page.touchscreen.tap(k.x, k.y);
  await until(page, async () => (await scheme(page)) === 'B', 120, 'one on by a tap');
  console.log(`[D2b] at 390×844, camera in: ${JSON.stringify(k)}`);
  expect(errors).toEqual([]);
  await ctx.close();
});

// The knob a 44 px fingertip at the look framing: the framing the crates' camera gives a thing (its box at least about
// 360 px across at 1440×900, 315 px on a phone) is not merged yet; the dev camera above is the page's hand, not that.
test.fixme('P4 D2b: the knob is a 44 px fingertip at the framing the crates\' camera gives a thing (waits for the crates\' camera)', async () => {});
