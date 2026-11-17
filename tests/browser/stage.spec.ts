import { expect, test, type Page } from '@playwright/test';
import { gpuArgs } from '../../playwright.config.ts';
import { startDevServer, type DevServer } from '../../scripts/capture.ts';

// The stage dev page on the real GPU (system Chrome with the GPU flags).
// Dev pages exist only in `astro dev`, so this file starts its own dev server
// on a free port instead of using the config's built preview.

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

/** Render one frame and read the canvas back in the same task (no preserveDrawingBuffer needed). */
async function canvasStats(page: Page): Promise<{ w: number; h: number; distinct: number; spread: number }> {
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
    return { w: src.width, h: src.height, distinct: seen.size, spread: max - min };
  });
}

for (const tier of ['high', 'low'] as const) {
  test(`the stage renders a non-blank picture with no console error (tier ${tier})`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${server.origin}/dev/stage/?tier=${tier}`);
    await page.waitForFunction('window.__ready === true', null, { timeout: 60_000 });
    const s = await canvasStats(page);
    expect(s.distinct).toBeGreaterThan(200);
    expect(s.spread).toBeGreaterThan(80);
    const stats = await page.evaluate(() => window.__workshop!.stats());
    expect(stats.tier).toBe(tier);
    expect(stats.post).toBe(tier === 'high');
    expect(stats.scene.calls).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
}

test('every post pass can be switched off from the query string', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(`${server.origin}/dev/stage/?pass=-gtao,-bloom,-focus,-grade,-vignette,-fog,-msaa,-shadowTint`);
  await page.waitForFunction('window.__ready === true', null, { timeout: 60_000 });
  const passes = await page.evaluate(() => ({ ...window.__workshop!.passes }));
  expect(Object.values(passes).every((v) => v === false)).toBe(true);
  expect((await canvasStats(page)).distinct).toBeGreaterThan(100);
  expect(errors).toEqual([]);
});

test('a resize keeps the aspect right', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${server.origin}/dev/stage/`);
  await page.waitForFunction('window.__ready === true', null, { timeout: 60_000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => {
    const w = window.__workshop!;
    return Math.abs(w.stage.camera.camera.aspect - 390 / 844) < 1e-3;
  });
  const s = await canvasStats(page);
  expect(s.w / s.h).toBeCloseTo(390 / 844, 2);
});
