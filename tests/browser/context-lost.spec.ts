import { expect, test, type Page } from '@playwright/test';
import { gpuArgs } from '../../playwright.config.ts';
import { startDevServer, type DevServer } from '../../scripts/capture.ts';

// R2: a lost graphics context (a GPU reset on a weaker machine; Taylor's coworkers' "the simulation freezes").
// Before, our canvas stayed a frozen picture for the rest of the visit, the simulation running on behind it,
// no error anywhere; when the context came back three's own restore left every sealed label blank. Now: the
// still picture shows at once and the world stops, keeping its state; if the context comes back in time the
// stage and the views are built again on the SAME world (the visitor's bench survives); if not, the picture
// stays. Strict and lenient alike: this is not an error of ours. Counted in `faults().contextLost`.

test.use({ channel: 'chrome', launchOptions: { args: gpuArgs } });
test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

let server: DevServer;
test.beforeAll(async () => {
  server = await startDevServer();
});
test.afterAll(() => server?.stop());

async function live(page: Page, query: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${server.origin}/dev/bench/${query}`);
  await page.waitForFunction(() => (window as any).__handoff?.phase === 'live' && (window as any).__ready === true, null, { timeout: 0, polling: 100 });
}
const ws = 'window.__handoff.workshop';
const look = (page: Page) =>
  page.evaluate(() => {
    const w = (window as any).__handoff.workshop;
    const world = w.simWorld;
    return {
      step: world.step as number,
      speed: world.setting('belt', 'speed') as number,
      stack: world.undoStack().length as number,
      live: document.querySelector('.stage-root')!.classList.contains('live'),
      failed: document.querySelector('.stage-root')!.classList.contains('stage-failed'),
      phase: (window as any).__handoff.phase as string,
      lost: w.stage.renderer.getContext().isContextLost() as boolean,
      faults: w.faults(),
    };
  });

for (const query of ['', '?strict=0']) {
  const mode = query ? 'lenient' : 'strict';

  test(`${mode}: lost and restored in time: the picture meanwhile, then the bench drawing again on the same world`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`${e.message} @ ${(e.stack ?? '').split('\n').slice(1, 6).join(' <- ')}`));
    await live(page, query);
    // the visitor has done something: it must survive
    await page.evaluate(`${ws}.dispatch({ type: 'turn', id: 'belt-dial', value: 1 })`);
    await page.waitForTimeout(500);
    const before = await look(page);
    expect(before.speed).toBe(5);
    expect(before.stack).toBeGreaterThan(0);
    const first = await page.evaluate(() => {
      const w = (window as any).__handoff.workshop;
      (window as any).__lc = w.stage.renderer.getContext().getExtension('WEBGL_lose_context');
      (window as any).__lc.loseContext();
      return w;
    }).then(() => true);
    expect(first).toBe(true);
    await page.waitForTimeout(800);
    const lost = await look(page);
    expect(lost.lost).toBe(true);
    expect(lost.live).toBe(false); // the picture shows
    const s0 = lost.step;
    await page.waitForTimeout(500);
    expect((await look(page)).step).toBe(s0); // the world has stopped, keeping its state
    // a key pressed while it is lost does not queue up behind it
    await page.keyboard.press('u');
    const t0 = Date.now();
    await page.evaluate(() => (window as any).__lc.restoreContext());
    await page.waitForFunction(() => document.querySelector('.stage-root')!.classList.contains('live'), null, { timeout: 60_000 });
    const took = (Date.now() - t0) / 1000;
    test.info().annotations.push({ type: 'rebuild', description: `${mode}: restored to drawing in ${took.toFixed(1)} s` });
    console.log(`REBUILD ${mode}: ${took.toFixed(1)} s`);
    // the page's hooks follow the new workshop
    expect(await page.evaluate(() => (window as any).__bench.ws === (window as any).__handoff.workshop)).toBe(true);
    await page.waitForTimeout(1000);
    const after = await look(page);
    expect(after.lost).toBe(false);
    expect(after.step).toBeGreaterThan(s0 + 20); // running again
    expect(after.speed).toBe(5); // the same world: the visitor's bench survived
    expect(after.stack).toBe(before.stack);
    expect(after.faults.contextLost).toBe(1);
    expect(errors).toEqual([]);
    await page.screenshot({ path: `shots/p2/s7-r2/context-restored-${mode}.png` });
  });

  test(`${mode}: lost and not restored: the picture stays`, async ({ page }) => {
    await live(page, query);
    await page.evaluate(() => {
      const w = (window as any).__handoff.workshop;
      w.stage.renderer.getContext().getExtension('WEBGL_lose_context').loseContext();
    });
    await page.waitForFunction(() => (window as any).__handoff.phase === 'failed', null, { timeout: 15_000 });
    const s = await page.evaluate(() => ({
      failed: document.querySelector('.stage-root')!.classList.contains('stage-failed'),
      live: document.querySelector('.stage-root')!.classList.contains('live'),
      workshop: (window as any).__handoff.workshop,
      lost: (window as any).__workshopFaults().contextLost as number,
      canvasPointer: getComputedStyle(document.querySelector('canvas.stage')!).pointerEvents,
      canvasOpacity: getComputedStyle(document.querySelector('canvas.stage')!).opacity,
    }));
    expect(s.failed).toBe(true);
    expect(s.live).toBe(false);
    expect(s.workshop).toBeNull(); // disposed: no sound, no input
    expect(s.canvasPointer).toBe('none'); // no glove, no picking over the picture
    expect(s.canvasOpacity).toBe('0');
    expect(s.lost).toBeGreaterThanOrEqual(1);
    await page.screenshot({ path: `shots/p2/s7-r2/context-not-restored-${mode}.png` });
  });
}
