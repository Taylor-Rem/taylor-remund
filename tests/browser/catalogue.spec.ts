import { expect, test, type Page } from '@playwright/test';
import { gpuArgs } from '../../playwright.config.ts';
import { startDevServer, type DevServer } from '../../scripts/capture.ts';

// The parts catalogue and the early-look page on the real GPU (W1.5 brief
// § Tests). Dev pages exist only in `astro dev`, so this file starts its own
// dev server on a free port.

test.use({ channel: 'chrome', launchOptions: { args: gpuArgs } });
test.describe.configure({ mode: 'serial' });

let server: DevServer;
test.beforeAll(async () => {
  server = await startDevServer();
});
test.afterAll(() => server?.stop());

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|404 \(Not Found\)/.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

/** Render one frame and read the canvas back in the same task. */
async function canvasStats(page: Page): Promise<{ distinct: number; spread: number }> {
  return page.evaluate(() => {
    const w = window.__workshop!;
    w.advance(0);
    const src = w.stage.canvas;
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = 100;
    const g = c.getContext('2d')!;
    g.drawImage(src, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const seen = new Set<number>();
    let min = 255;
    let max = 0;
    for (let i = 0; i < d.length; i += 4) {
      seen.add((d[i]! >> 3) | ((d[i + 1]! >> 3) << 5) | ((d[i + 2]! >> 3) << 10));
      const l = (d[i]! + d[i + 1]! + d[i + 2]!) / 3;
      min = Math.min(min, l);
      max = Math.max(max, l);
    }
    return { distinct: seen.size, spread: max - min };
  });
}

for (const view of ['beauty', 'clay'] as const) {
  test(`the catalogue shows the test block in ${view} with no console error`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${server.origin}/dev/catalogue/?piece=test-block&view=${view}&dist=close`);
    await page.waitForFunction('window.__ready === true', null, { timeout: 60_000 });
    const s = await canvasStats(page);
    expect(s.distinct).toBeGreaterThan(150);
    expect(s.spread).toBeGreaterThan(80);
    const calls = await page.evaluate(() => window.__workshop!.stats().scene.calls);
    expect(calls).toBeGreaterThan(3);
    expect(errors).toEqual([]);
  });
}

test('the catalogue index lists the test block with its triangle count', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(`${server.origin}/dev/catalogue/`);
  await page.waitForFunction('window.__ready === true', null, { timeout: 60_000 });
  const row = page.locator('#index tr', { hasText: 'test-block' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(/\d+ tris/);
  expect(errors).toEqual([]);
});

test('the early look renders the group, real pieces or stand-ins', async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${server.origin}/dev/look/`);
  await page.waitForFunction('window.__ready === true', null, { timeout: 60_000 });
  const s = await canvasStats(page);
  expect(s.distinct).toBeGreaterThan(150);
  expect(s.spread).toBeGreaterThan(60);
  const placed = await page.evaluate(() => Object.keys((window as unknown as { __look: { boxes: object } }).__look.boxes).sort());
  expect(placed).toEqual(['button', 'crate', 'fetch']);
  expect(errors).toEqual([]);
});

test('the early look has every shot, including both Fetch designs side by side', async ({ page }) => {
  const errors = watchErrors(page);
  for (const shot of ['button', 'crate', 'fetch', 'fetches']) {
    await page.goto(`${server.origin}/dev/look/?shot=${shot}`);
    await page.waitForFunction('window.__ready === true', null, { timeout: 60_000 });
    expect((await canvasStats(page)).distinct).toBeGreaterThan(100);
  }
  expect(errors).toEqual([]);
});
