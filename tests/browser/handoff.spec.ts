import { expect, test, type Page } from '@playwright/test';
import { gpuArgs } from '../../playwright.config.ts';
import { startDevServer, type DevServer } from '../../scripts/capture.ts';

// /dev/handoff/ (B1): the picture first, then the live stage, on the real GPU.
// The pixel proof (the last frame of the picture against the first of the
// stage, four sizes) is `node scripts/poster.ts --prove`; this checks the
// behaviour around it.

test.use({ channel: 'chrome', launchOptions: { args: gpuArgs } });
test.describe.configure({ mode: 'serial' });

let server: DevServer;
test.beforeAll(async () => {
  server = await startDevServer();
});
test.afterAll(() => server?.stop());

const filterOf = (page: Page): Promise<string> => page.evaluate(() => getComputedStyle(document.querySelector('img.poster')!).filter);
const state = (page: Page): Promise<{ phase: string; adopted: { error: number } | null; band: unknown }> =>
  page.evaluate(() => {
    const h = (window as any).__handoff;
    return { phase: h.phase, adopted: h.adopted, band: h.band };
  });

test('the picture is there before any script, and becomes the live stage', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${server.origin}/dev/handoff/?hold=1`);
  await expect(page.locator('img.poster')).toBeVisible();
  await page.waitForFunction('window.__ready === true', null, { timeout: 90_000 });
  const s = await state(page);
  expect(s.phase).toBe('held-picture');
  expect(s.adopted?.error ?? 1).toBeLessThan(1e-3); // the stage stands on the picture's camera
  // fully warm before the swap: no filter left on the picture
  expect(await filterOf(page)).toMatch(/^(none|brightness\(1\) saturate\(1\))$/);
  await page.evaluate(() => (window as any).__handoff.release());
  await page.waitForFunction("window.__handoff.phase === 'held-stage'");
  await page.evaluate(() => (window as any).__handoff.release());
  await page.waitForFunction("window.__handoff.phase === 'live'");
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('stage')!).opacity)).toBe('1');
});

test('with no JavaScript the picture is shown at full brightness, never dim', async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.goto(`${server.origin}/dev/handoff/`);
  await expect(page.locator('img.poster')).toBeVisible();
  expect(await filterOf(page)).toBe('none');
  await ctx.close();
});

test('if the stage fails to start the picture stays, warm', async ({ page }) => {
  await page.goto(`${server.origin}/dev/handoff/?fail=1`);
  await page.waitForFunction('window.__ready === true', null, { timeout: 30_000 });
  expect((await state(page)).phase).toBe('failed');
  await expect(page.locator('img.poster')).toBeVisible();
  expect(await filterOf(page)).toBe('none');
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('stage')!).opacity)).toBe('0');
});

test('with reduced motion there is no dimming and no fade', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(`${server.origin}/dev/handoff/?hold=1`);
  expect(await filterOf(page)).toBe('none');
  await page.waitForFunction('window.__ready === true', null, { timeout: 90_000 });
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('stage')!).transitionDuration)).toBe('0s');
  await ctx.close();
});
