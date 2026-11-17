import { expect, test, type Page } from '@playwright/test';
import { gpuArgs } from '../../playwright.config.ts';
import { startDevServer, type DevServer } from '../../scripts/capture.ts';

// /dev/play/ on the real GPU: a hand reaches the world end to end (W2 brief § Tests).
// Dev pages exist only in `astro dev`, so this file starts its own dev server.

test.use({ channel: 'chrome', launchOptions: { args: gpuArgs } });
test.describe.configure({ mode: 'serial' });

let server: DevServer;
test.beforeAll(async () => {
  server = await startDevServer();
});
test.afterAll(() => server?.stop());

type V3 = [number, number, number];

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|404 \(Not Found\)/.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`${server.origin}/dev/play/${query}`);
  await page.waitForFunction('window.__ready === true', null, { timeout: 60_000 });
  // let Fetch start its walk and the scene settle
  await page.waitForTimeout(400);
}

const screen = (page: Page, p: V3) => page.evaluate((p) => (window as any).__play.project(p) as { x: number; y: number }, p);
const pose = (page: Page, id: string) => page.evaluate((id) => (window as any).__play.motion(id).pose.p as V3, id);
const topOf = async (page: Page, id: string, dy: number) => {
  const p = await pose(page, id);
  return screen(page, [p[0], p[1] + dy, p[2]]);
};
const events = (page: Page, type: string) => page.evaluate((type) => (window as any).__play.log.filter((l: any) => l.e.type === type).map((l: any) => l.e), type);

async function glide(page: Page, a: { x: number; y: number }, b: { x: number; y: number }, n: number): Promise<void> {
  for (let i = 1; i <= n; i++) {
    await page.mouse.move(a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n);
    await page.waitForTimeout(8);
  }
}

test('a mouse drag lifts a crate within two frames of the press; a fling throws it and it comes to rest on the bench', async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const at = await topOf(page, 'crate-3', 0.2);
  await page.mouse.move(at.x, at.y);
  await page.waitForTimeout(100);
  // a rAF watcher: the frames after the press, and whether each shows the crate moved
  await page.evaluate(() => {
    const P = (window as any).__play;
    const w: { down: number | null; frames: { t: number; moved: boolean }[] } = { down: null, frames: [] };
    const y0 = P.motion('crate-3').pose.p[1];
    addEventListener('pointerdown', (e) => (w.down = e.timeStamp), { once: true, capture: true });
    const tick = (t: number): void => {
      if (w.down !== null) w.frames.push({ t, moved: Math.abs(P.motion('crate-3').pose.p[1] - y0) > 1e-3 });
      if (w.frames.length < 10) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    (window as any).__watch = w;
  });
  await page.mouse.down();
  await page.waitForFunction('window.__watch.frames.length >= 10');
  const w = await page.evaluate(() => (window as any).__watch as { frames: { moved: boolean }[] });
  const first = w.frames.findIndex((f) => f.moved);
  expect(first).toBeGreaterThanOrEqual(0);
  expect(first).toBeLessThanOrEqual(1); // the first or second frame after the press
  const lat = await page.evaluate(() => (window as any).__play.ws.latency.report());
  expect(lat.frame.grab.last).toBeLessThan(50); // § E0: a grab within 50 ms

  // fling to the right, released while moving
  await glide(page, at, { x: at.x + 40, y: at.y }, 4);
  await glide(page, { x: at.x + 40, y: at.y }, { x: at.x + 240, y: at.y - 20 }, 8);
  await page.mouse.up();
  const released = await events(page, 'part.released');
  expect(released.at(-1).id).toBe('crate-3');
  expect(released.at(-1).speed).toBeGreaterThan(2);
  await page.waitForFunction(() => (window as any).__play.log.some((l: any) => l.e.type === 'part.rested' && l.e.id === 'crate-3' && l.step > 0), null, { timeout: 10_000 });
  const loc = await page.evaluate(() => (window as any).__play.ws.world.part('crate-3').location);
  expect(loc.at).toBe('rest');
  expect(loc.pose.p[1]).toBeGreaterThan(0);
  expect(Math.abs(loc.pose.p[0])).toBeLessThan(10);
  const start = await page.evaluate(() => (window as any).__play.throws.at(-1));
  expect(start.distance).toBeGreaterThan(0.5);
  expect(errors).toEqual([]);
});

test('pressing the Button gives button.pressed then rung.ended, and the crates end where they started', async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const ids = ['crate-1', 'crate-2', 'crate-3'];
  const before = await Promise.all(ids.map((id) => pose(page, id)));
  const btn = await screen(page, [0, 0.72, 1.9]);
  await page.mouse.click(btn.x, btn.y);
  await page.waitForFunction(() => (window as any).__play.log.some((l: any) => l.e.type === 'button.pressed'), null, { timeout: 2000 });
  expect(await page.evaluate(() => (window as any).__play.ws.world.bracketed)).toBe(true);
  await page.waitForFunction(() => (window as any).__play.log.some((l: any) => l.e.type === 'rung.ended'), null, { timeout: 10_000 });
  const order = (await page.evaluate(() => (window as any).__play.log.map((l: any) => l.e.type))) as string[];
  expect(order.indexOf('button.pressed')).toBeLessThan(order.indexOf('rung.ended'));
  const after = await Promise.all(ids.map((id) => pose(page, id)));
  ids.forEach((_, i) => {
    for (let k = 0; k < 3; k++) expect(after[i]![k]).toBeCloseTo(before[i]![k]!, 3);
  });
  const press = await page.evaluate(() => (window as any).__play.ws.latency.report().frame.press.last);
  expect(press).toBeLessThan(100); // § E0: a handle's consequence within 100 ms
  expect(errors).toEqual([]);
});

test('dragging the plug to the other jack changes cord.jack', async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const cord = await page.evaluate(() => (window as any).__play.ws.world.cord('cord'));
  const jacks = await page.evaluate(() => (window as any).__play.ws.world.scene.cord.jacks.map((j: any) => ({ id: j.id, at: j.at })));
  const from = jacks.find((j: any) => j.id === cord.jack)!;
  const to = jacks.find((j: any) => j.id !== cord.jack)!;
  const a = await screen(page, [from.at[0], from.at[1], from.at[2] + 0.2]);
  const b = await screen(page, [to.at[0], to.at[1], to.at[2]]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await glide(page, a, { x: (a.x + b.x) / 2, y: a.y + 30 }, 6);
  expect(await page.evaluate(() => (window as any).__play.ws.world.cord('cord').lifted)).toBe(true);
  await glide(page, { x: (a.x + b.x) / 2, y: a.y + 30 }, b, 6);
  await page.mouse.up();
  await page.waitForTimeout(100);
  const now = await page.evaluate(() => (window as any).__play.ws.world.cord('cord'));
  expect(now.jack).toBe(to.id);
  expect(now.lifted).toBe(false);
  expect(errors).toEqual([]);
});

test('a touch drag on a part carries it, and neither scrolls the page nor pans the camera', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = watchErrors(page);
  await open(page, '?view=phone');
  const cam0 = await page.evaluate(() => (window as any).__play.ws.stage.camera.view());
  const p0 = await pose(page, 'crate-3');
  const at = await topOf(page, 'crate-3', 0.2);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  await touch('touchStart', at.x, at.y);
  for (let i = 1; i <= 12; i++) {
    await touch('touchMove', at.x + i * 6, at.y + i * 3);
    await page.waitForTimeout(16);
  }
  const held = await page.evaluate(() => (window as any).__play.ws.world.holding());
  expect(held).toEqual({ kind: 'part', id: 'crate-3' });
  await page.waitForTimeout(150);
  await touch('touchEnd', 0, 0);
  await page.waitForTimeout(300);
  const p1 = await pose(page, 'crate-3');
  expect(Math.hypot(p1[0] - p0[0], p1[2] - p0[2])).toBeGreaterThan(0.2);
  const cam1 = await page.evaluate(() => (window as any).__play.ws.stage.camera.view());
  expect(cam1).toEqual(cam0);
  expect(await page.evaluate(() => [scrollX, scrollY, visualViewport?.scale ?? 1])).toEqual([0, 0, 1]);
  expect(errors).toEqual([]);
  await ctx.close();
});
