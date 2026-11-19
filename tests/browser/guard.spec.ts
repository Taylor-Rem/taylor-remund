import { expect, test, type Page } from '@playwright/test';
import { gpuArgs } from '../../playwright.config.ts';
import { startDevServer, type DevServer } from '../../scripts/capture.ts';

// R2 (Taylor's coworkers: "the simulation freezes"): one uncaught error must never again leave a visitor with a
// frozen bench. Lenient (`?strict=0`, as on the production page): a view that keeps throwing is paused and
// retried while the bench runs on; an error that escapes a whole frame puts the bench back to its opening
// state and the loop carries on. Strict (the default under automation and in development): the same error
// stops the loop and is reported, so no test can pass over it.

test.use({ channel: 'chrome', launchOptions: { args: gpuArgs } });
test.describe.configure({ mode: 'serial' });

let server: DevServer;
test.beforeAll(async () => {
  server = await startDevServer();
});
test.afterAll(() => server?.stop());

async function live(page: Page, query: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${server.origin}/dev/handoff/${query}`);
  await page.waitForFunction('window.__handoff && window.__handoff.phase === "live"', null, { timeout: 120_000 });
}
const steps = (page: Page): Promise<number> => page.evaluate(() => (window as any).__handoff.workshop.loop.steps);
const faults = (page: Page): Promise<{ count: number; resets: number; last: { unit: string } | null }> => page.evaluate(() => (window as any).__handoff.workshop.faults());

test('lenient: a view that keeps throwing is paused and retried; the bench keeps running', async ({ page }) => {
  await live(page, '?strict=0');
  await page.evaluate(() => {
    const ws = (window as any).__handoff.workshop;
    const v = ws.views[0];
    v.update = () => {
      throw new Error('injected view fault');
    };
  });
  const a = await steps(page);
  await page.waitForTimeout(2500);
  const b = await steps(page);
  expect(b - a).toBeGreaterThan(60); // more than a second of steps in 2.5 s: not frozen
  const f = await faults(page);
  expect(f.count).toBeGreaterThanOrEqual(1);
  expect(f.last?.unit).toMatch(/^view:/);
  expect(f.resets).toBe(0); // a view fault never resets the bench
});

test('lenient: an error that escapes a frame puts the bench back to its opening state and the loop carries on', async ({ page }) => {
  await live(page, '?strict=0');
  await page.evaluate(() => {
    const ws = (window as any).__handoff.workshop;
    ws.dispatch({ type: 'turn', id: 'belt-dial', value: 0 }); // something on the undo stack
  });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as any).__handoff.workshop.world.undoStack().length)).toBeGreaterThan(0);
  await page.evaluate(() => {
    const ws = (window as any).__handoff.workshop;
    const world = ws.driver.o.world;
    const advance = world.advance.bind(world);
    let left = 1;
    world.advance = () => {
      if (left-- > 0) throw new Error('injected step fault');
      advance();
    };
  });
  await page.waitForTimeout(1500);
  const f = await faults(page);
  expect(f.resets).toBe(1);
  expect(await page.evaluate(() => (window as any).__handoff.workshop.world.undoStack().length)).toBe(0);
  const a = await steps(page);
  await page.waitForTimeout(1000);
  expect((await steps(page)) - a).toBeGreaterThan(30);
});

test('strict (automation, development): the same error stops the loop and is reported, loudly', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await live(page, '');
  await page.evaluate(() => {
    const ws = (window as any).__handoff.workshop;
    ws.views[0].update = () => {
      throw new Error('injected view fault');
    };
  });
  await page.waitForTimeout(500);
  const a = await steps(page);
  await page.waitForTimeout(1000);
  expect((await steps(page)) - a).toBe(0);
  expect(errors.join('\n')).toContain('injected view fault');
});
