// I2: the one way a project crate opens on the shipped bench (`OPENING_STAND_ON`): set down on the opening stand. The
// browser specs that need an open crate (and are not themselves about how it got there) open it here, by the same
// intents the keys' list sends (take it; put it at the stand's place), on the page's own workshop (`__bench.ws`).
// The specs that prove the hand's own way (carried by a real pointer or finger) are tests/browser/opening-stand.spec.ts
// and the keyboard's, tests/browser/keyboard.spec.ts.
import type { Page } from '@playwright/test';

const frameNo = (page: Page): Promise<number> => page.evaluate(() => (window as any).__bench.ws.driver.frames as number);
async function frames(page: Page, n: number): Promise<void> {
  const f0 = await frameNo(page);
  await page.waitForFunction((f) => (window as any).__bench.ws.driver.frames >= f, f0 + n, { timeout: 0, polling: 30 });
}
const isOpen = (page: Page, id: string): Promise<boolean> => page.evaluate((id) => (window as any).__bench.ws.world.setting(id, 'open') === true, id);

/**
 * Open the project crate `crate`: taken (from wherever it lies, from Fetch's arms, off the stack's top) and set down on
 * the opening stand, as the keys do; then the frames it takes to open there (at most `limit` a try). Tried again a few
 * times, as a visitor would (a crate under another, or knocked as it is taken, may not be set down the first time).
 * Throws when it never opens.
 */
export async function openOnStand(page: Page, crate: string, limit = 360): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (await isOpen(page, crate)) return;
    await page.evaluate((id) => {
      const ws = (window as any).__bench.ws;
      const h = ws.world.holding();
      if (h && h.id !== id) ws.dispatch({ type: 'release', velocity: [0, 0, 0] });
      ws.dispatch({ type: 'grab', id, grip: ws.world.motion(id).pose.p });
    }, crate);
    await frames(page, 3);
    await page.evaluate(() => (window as any).__bench.ws.dispatch({ type: 'place', at: 'opening-stand' }));
    const f0 = await frameNo(page);
    while ((await frameNo(page)) - f0 < limit) {
      if (await isOpen(page, crate)) return;
      await page.waitForTimeout(40);
    }
  }
  const state = await page.evaluate((id) => {
    const w = (window as any).__bench.ws.world;
    return { at: w.motion(id)?.pose.p, mode: w.mode(id), held: w.holding()?.id ?? null };
  }, crate);
  throw new Error(`openOnStand: ${crate} never opened on the stand ${JSON.stringify(state)}`);
}

/** Lift the crate off the stand (it shuts) and set it down at the world point `to`, as the keys do. */
export async function liftOff(page: Page, crate: string, to: readonly number[] = [-5.6, 0, 1.6]): Promise<void> {
  await page.evaluate((id) => {
    const ws = (window as any).__bench.ws;
    ws.dispatch({ type: 'grab', id, grip: ws.world.motion(id).pose.p });
  }, crate);
  await frames(page, 3);
  await page.evaluate((to) => (window as any).__bench.ws.dispatch({ type: 'place', at: to }), to as number[]);
  await frames(page, 60);
}
