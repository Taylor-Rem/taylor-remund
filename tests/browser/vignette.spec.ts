import { expect, test, type Page } from '@playwright/test';
import { gpuArgs } from '../../playwright.config.ts';
import { startDevServer, type DevServer } from '../../scripts/capture.ts';

// /dev/vignette/ on the real GPU (REWRITE.md § G "P1. The vignette": what must WORK):
// pick up and throw a crate; press the Button (rung 1); re-plug the cord; Fetch's fumble.
// Plus the 12 px rule at the default view. Dev pages exist only in `astro dev`.

test.use({ channel: 'chrome', launchOptions: { args: gpuArgs } });
test.describe.configure({ mode: 'serial' });

let server: DevServer;
test.beforeAll(async () => {
  server = await startDevServer();
});
test.afterAll(() => server?.stop());

type XY = { x: number; y: number };

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|404 \(Not Found\)/.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

async function open(page: Page, w = 1440, h = 900): Promise<void> {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(`${server.origin}/dev/vignette/?hud=0`);
  await page.waitForFunction('window.__ready === true', null, { timeout: 90_000 });
  await page.waitForTimeout(300);
}

const where = (page: Page, id: string) => page.evaluate((id) => (window as any).__vignette.where(id) as XY | null, id);
const events = (page: Page, type: string) => page.evaluate((type) => (window as any).__vignette.log.filter((l: any) => l.e.type === type).map((l: any) => l.e), type);

async function glide(page: Page, a: XY, b: XY, n: number): Promise<void> {
  for (let i = 1; i <= n; i++) {
    await page.mouse.move(a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n);
    await page.waitForTimeout(12);
  }
}

test('the vignette boots with every slot filled (a real piece or a stand-in) and no errors', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  const slots = await page.evaluate(() => (window as any).__vignette.slots as { name: string; real: boolean }[]);
  for (const name of ['bench', 'wall', 'crate', 'button', 'fetch', 'board', 'belt', 'sign', 'toolwall']) expect(slots.find((s) => s.name === name), name).toBeTruthy();
  expect(errors).toEqual([]);
});

test('capitals on the sign, the DO NOT TOUCH tape and the station plates are at least 12 px at the default view', async ({ page }) => {
  await open(page);
  const m = await page.evaluate(() => (window as any).__vignette.measure());
  const labels = (m.labels as { register: string; text: string; px: number; onScreen: boolean }[]).filter((l) => l.onScreen);
  const sign = labels.filter((l) => l.register === 'sign');
  expect(sign.length).toBeGreaterThan(0);
  for (const l of sign) expect(l.px, l.text).toBeGreaterThanOrEqual(12);
  const dnt = labels.filter((l) => l.register === 'tape' && /DO NOT|TOUCH/.test(l.text));
  expect(dnt.length).toBeGreaterThan(0);
  for (const l of dnt) expect(l.px, l.text).toBeGreaterThanOrEqual(12);
});

test('Fetch fumbles its crate after a few seconds of nothing, then offers', async ({ page }) => {
  await open(page);
  await page.mouse.move(700, 60);
  await expect.poll(async () => (await events(page, 'crew.state')).map((e: any) => e.state), { timeout: 20_000, intervals: [500] }).toContain('offer');
  const states = (await events(page, 'crew.state')).map((e: any) => e.state);
  expect(states.indexOf('fumble')).toBeGreaterThanOrEqual(0);
  expect(states.indexOf('fumble')).toBeLessThan(states.indexOf('offer'));
});

test('a crate is picked up and thrown, and comes to rest somewhere else', async ({ page }) => {
  await open(page);
  const from = await page.evaluate(() => (window as any).__vignette.ws.world.motion('crate-3').pose.p as number[]);
  const at = (await where(page, 'crate-3'))!;
  await page.mouse.move(at.x, at.y);
  await page.waitForTimeout(80);
  await page.mouse.down();
  await glide(page, at, { x: at.x + 40, y: at.y - 40 }, 8);
  await glide(page, { x: at.x + 40, y: at.y - 40 }, { x: at.x + 260, y: at.y + 30 }, 4);
  await page.mouse.up();
  expect((await events(page, 'part.grabbed')).some((e: any) => e.id === 'crate-3')).toBe(true);
  await expect.poll(async () => (await events(page, 'part.released')).some((e: any) => e.id === 'crate-3'), { timeout: 3000 }).toBe(true);
  await expect.poll(async () => (await events(page, 'part.rested')).some((e: any) => e.id === 'crate-3'), { timeout: 8000 }).toBe(true);
  const to = await page.evaluate(() => (window as any).__vignette.ws.world.motion('crate-3').pose.p as number[]);
  expect(Math.hypot(to[0]! - from[0]!, to[2]! - from[2]!)).toBeGreaterThan(0.4);
});

test('pressing the Button plays rung 1 and the world comes back', async ({ page }) => {
  await open(page);
  const b = (await where(page, 'button'))!;
  await page.mouse.move(b.x, b.y);
  await page.waitForTimeout(80);
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.up();
  await expect.poll(async () => (await events(page, 'button.pressed')).length, { timeout: 2000 }).toBe(1);
  await expect.poll(async () => (await events(page, 'rung.started')).length, { timeout: 2000 }).toBe(1);
  await expect.poll(async () => (await events(page, 'rung.ended')).length, { timeout: 12_000 }).toBe(1);
  const presses = await page.evaluate(() => (window as any).__vignette.ws.world.button().presses);
  expect(presses).toBe(1);
});

test('the plug is lifted out of STOREFRONT and pushed into LAMP', async ({ page }) => {
  await open(page);
  const plug = (await where(page, 'cord'))!;
  const lamp = (await where(page, 'jack-lamp'))!;
  await page.mouse.move(plug.x, plug.y);
  await page.waitForTimeout(80);
  await page.mouse.down();
  await glide(page, plug, { x: plug.x + 10, y: plug.y + 50 }, 8);
  await glide(page, { x: plug.x + 10, y: plug.y + 50 }, lamp, 14);
  await page.waitForTimeout(120);
  await page.mouse.up();
  await expect.poll(async () => (await events(page, 'cord.plugged')).map((e: any) => e.jack), { timeout: 3000 }).toContain('jack-lamp');
  const jack = await page.evaluate(() => (window as any).__vignette.ws.world.cord('cord').jack);
  expect(jack).toBe('jack-lamp');
});

test('on an upright phone the Button, the phone, Patch and the crate are in view', async ({ page }) => {
  await open(page, 390, 844);
  for (const id of ['button', 'jack-storefront', 'crate-4']) {
    const p = (await where(page, id))!;
    expect(p.x, id).toBeGreaterThan(0);
    expect(p.x, id).toBeLessThan(390);
    expect(p.y, id).toBeGreaterThan(0);
    expect(p.y, id).toBeLessThan(844);
  }
});
