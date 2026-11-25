import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { gpuArgs } from '../../playwright.config.ts';
import { startDevServer, type DevServer } from '../../scripts/capture.ts';

// Pitch on `/` (P4 P1a; sim/crew/pitch.ts), behind the development flag `?pitch=1` until the owner has seen him, so
// on a dev server of its own (or I1_ORIGIN while iterating). In the controls list under his station, by his name; by
// the keys alone taken, set on the platen's tray, and home by himself; by a real mouse taken and flung across the
// bench, and home by himself well inside twenty seconds; and the bench without the flag has none of him.

test.use({ channel: 'chrome', launchOptions: { args: gpuArgs } });
test.describe.configure({ mode: 'serial' });
test.setTimeout(4 * 60_000);

const NAME = JSON.parse(readFileSync(new URL('../../src/content/world.json', import.meta.url), 'utf8')).names.pitch.text as string;

let server: DevServer | null = null;
let origin = process.env.I1_ORIGIN ?? '';
test.beforeAll(async () => {
  if (!origin) {
    server = await startDevServer();
    origin = server.origin;
  }
});
test.afterAll(() => server?.stop());

interface PitchState {
  state: string;
  at: [number, number, number];
}
const live = async (page: Page): Promise<void> => {
  await page.waitForFunction(() => (window as any).__handoff?.phase === 'live', null, { timeout: 120_000, polling: 100 });
  await page.waitForFunction(() => document.querySelectorAll('#controls button').length > 4, null, { timeout: 30_000 });
};
/** (E1) He arrives after the bench is live, with an entrance: wait till he is at his mast, his mast planted. */
const arrived = async (page: Page): Promise<void> => {
  await page.waitForFunction(
    () => {
      const c = (window as any).__handoff?.workshop?.world.crewView('pitch');
      return !!c && c.view.state === 'moored' && !c.view.mastCarried;
    },
    null,
    { timeout: 60_000, polling: 100 },
  );
};
const pitch = (page: Page): Promise<PitchState | null> =>
  page.evaluate(() => {
    const c = (window as any).__handoff.workshop.world.crewView('pitch');
    return c ? { state: c.view.state, at: c.view.at } : null;
  });
const screenOf = (page: Page, p: [number, number, number]): Promise<{ x: number; y: number }> =>
  page.evaluate((p) => {
    const ws = (window as any).__handoff.workshop;
    // (the camera answers in normalised device coordinates)
    const s = ws.stage.camera.worldToScreen({ x: p[0], y: p[1], z: p[2] });
    const r = ws.stage.canvas.getBoundingClientRect();
    return { x: r.left + ((s.x + 1) / 2) * r.width, y: r.top + ((1 - s.y) / 2) * r.height };
  }, p);

test('without the flag the bench has no Pitch', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/`);
  await live(page);
  expect(await pitch(page)).toBeNull();
  expect(await page.locator('#controls button[data-id="pitch"]').count()).toBe(0);
});

test('in the list by his name; by the keys onto the platen, and home by himself', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/?pitch=1`);
  await live(page);
  await arrived(page);
  // (E1) he arrives some seconds in, while attract mode's lap may have a crate on the platen's tray (from about 5 s
  // to 18 s): the tray takes one thing, so wait until it is clear, as a visitor would find it
  await page.waitForFunction(
    () => {
      const w = (window as any).__handoff.workshop.world;
      return [...w.parts()].every((p: any) => !(p.location.at === 'in' && p.location.mouth === 'platen'));
    },
    null,
    { timeout: 60_000, polling: 250 },
  );
  expect((await pitch(page))?.state).toBe('moored');
  const b = page.locator('#controls button[data-id="pitch"]');
  await expect(b).toHaveCount(1);
  expect((await b.innerText()).trim()).toBe(NAME);
  await b.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.controls-hold-label')).toBeVisible();
  const dests = page.locator('.controls-dests button');
  expect(await dests.allInnerTexts()).toEqual(['Belt', 'Dock', 'Platen']);
  await dests.filter({ hasText: 'Platen' }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await pitch(page))?.state, { timeout: 10_000 }).toBe('tray');
  await expect.poll(async () => (await pitch(page))?.state, { timeout: 25_000 }).toBe('moored');
});

test('flung across the bench by a real mouse, he sails, slows, and is home within twenty seconds', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/?pitch=1`);
  await live(page);
  await arrived(page);
  const v = (await pitch(page))!;
  const from = await screenOf(page, v.at);
  const mid = await screenOf(page, [2.0, 2.0, 1.5]);
  const to = await screenOf(page, [-1.5, 2.2, 1.5]);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 40; i++) {
    await page.mouse.move(from.x + ((mid.x - from.x) * i) / 40, from.y + ((mid.y - from.y) * i) / 40);
    await page.waitForTimeout(16);
  }
  await expect.poll(async () => (await pitch(page))?.state).toBe('held');
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(mid.x + ((to.x - mid.x) * i) / 8, mid.y + ((to.y - mid.y) * i) / 8);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  const t0 = Date.now();
  await expect.poll(async () => (await pitch(page))?.state, { timeout: 5_000 }).toMatch(/sail|fly/);
  await expect.poll(async () => (await pitch(page))?.state, { timeout: 20_000, intervals: [250] }).toBe('moored');
  console.log(`[pitch] flung: home in ${((Date.now() - t0) / 1000).toFixed(1)} s (wall clock)`);
});
