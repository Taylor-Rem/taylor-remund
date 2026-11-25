import { expect, test, type Page, type Route } from '@playwright/test';
import { join } from 'node:path';
import { gpuArgs } from '../../playwright.config.ts';
import { stageClosure } from '../../scripts/budget.ts';

// (E1) Bench first, crew after, on the wire. Run against a build with Pitch on as the switch would have him
// (`WORKSHOP_PITCH=1 npx astro build`, then PW_SKIP_BUILD=1): the build's own static rows (scripts/budget.ts) say
// which files are "after" (his chunk and what only it reaches); here the browser proves it.
//
//   - with the late chunks held back: the bench reaches `live`, the Button presses and a crate is carried; no late
//     chunk is asked for before `live` (nor anything the static "to usable" row does not count); released, he
//     arrives and moors;
//   - refused altogether (offline for those files): the bench carries on without him and nothing errors.
//
//   WORKSHOP_PITCH=1 flock …/build.lock npx astro build
//   PW_SKIP_BUILD=1 PW_PORT=4476 …/browser-run.sh npx playwright test tests/browser/late.spec.ts --workers=1 --project=chromium

test.use({ channel: 'chrome', launchOptions: { args: gpuArgs } });
test.describe.configure({ mode: 'serial' });
test.setTimeout(4 * 60_000);

const DIST = join(import.meta.dirname, '../../dist');
const closure = stageClosure(DIST, '/');
const AFTER = new Set(closure.after.map(([f]) => '/' + f));
const USABLE = new Set(closure.items.map(([f]) => '/' + f));
const isAfter = (url: string): boolean => AFTER.has(new URL(url).pathname);

const live = async (page: Page): Promise<void> => {
  await page.waitForFunction(() => (window as any).__handoff?.phase === 'live', null, { timeout: 120_000, polling: 50 });
};
const pitch = (page: Page): Promise<{ state: string; carried: boolean } | null> =>
  page.evaluate(() => {
    const c = (window as any).__handoff?.workshop?.world.crewView('pitch');
    return c ? { state: c.view.state, carried: c.view.mastCarried } : null;
  });
const screenOf = (page: Page, p: readonly number[]): Promise<{ x: number; y: number }> =>
  page.evaluate((p) => {
    const ws = (window as any).__handoff.workshop;
    const s = ws.stage.camera.worldToScreen({ x: p[0], y: p[1], z: p[2] });
    const r = ws.stage.canvas.getBoundingClientRect();
    return { x: r.left + ((s.x + 1) / 2) * r.width, y: r.top + ((1 - s.y) / 2) * r.height };
  }, p);

/** The Button pressed and a crate carried with the real mouse: the bench takes input. */
async function benchWorks(page: Page): Promise<void> {
  const presses = (): Promise<number> => page.evaluate(() => (window as any).__handoff.workshop.world.button().presses ?? 0);
  const before = await presses();
  const cap = await page.evaluate(() => (window as any).__handoff.workshop.world.scene.button.at);
  const b = await screenOf(page, cap);
  await page.mouse.click(b.x, b.y);
  await expect.poll(presses, { timeout: 10_000 }).toBeGreaterThan(before);
  // wait for the rung to play out, then carry the loose crate (crate-4, or any crate at rest) a little way
  await page.waitForFunction(() => !(window as any).__handoff.workshop.world.bracketed, null, { timeout: 30_000, polling: 100 });
  const crate = await page.evaluate(() => {
    const w = (window as any).__handoff.workshop.world;
    for (const id of ['crate-3', 'crate-4', 'crate-1', 'crate-2']) {
      const m = w.motion(id);
      if (m && m.mode === 'free' && !m.awake) return { id, p: m.pose.p as number[] };
    }
    return null;
  });
  expect(crate, 'a crate at rest to carry').not.toBeNull();
  const s = await screenOf(page, crate!.p);
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await expect.poll(() => page.evaluate(() => (window as any).__handoff.workshop.world.holding()?.id ?? null), { timeout: 5_000 }).toBe(crate!.id);
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(s.x + i * 6, s.y + i * 2);
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (window as any).__handoff.workshop.world.holding()), { timeout: 5_000 }).toBeNull();
}

test('the build has late files, and the static rows agree with what the page names', () => {
  expect(AFTER.size, 'no "after" files: build with WORKSHOP_PITCH=1').toBeGreaterThan(0);
  expect([...AFTER].some((f) => /\/late-pitch\.[^/]*\.js$/.test(f))).toBe(true);
  expect(closure.eagerLate).toEqual([]);
});

test('held back, nothing late before live; the bench plays without him; released, he arrives', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const held: { url: string; phase: string; route: Route }[] = [];
  const fetched: string[] = [];
  page.on('request', (r) => fetched.push(new URL(r.url()).pathname));
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route((url) => isAfter(url.href), async (route) => {
    const phase = await page.evaluate(() => (window as any).__handoff?.phase ?? 'none').catch(() => 'gone');
    held.push({ url: new URL(route.request().url()).pathname, phase, route });
  });
  await page.goto('/');
  await live(page);
  // the bench is usable with his chunk held back
  await benchWorks(page);
  expect(await pitch(page)).toBeNull();
  // he was asked for, after live, and only after
  await expect.poll(() => held.length, { timeout: 15_000 }).toBeGreaterThan(0);
  for (const h of held) expect(h.phase, `${h.url} asked for in phase ${h.phase}`).toBe('live');
  // nothing fetched by itself that the static "to usable" row does not count, nor anything "after" but through the hold
  const usableAt = await page.evaluate(() => performance.getEntriesByName('b1:usable')[0]?.startTime ?? null);
  expect(usableAt).not.toBeNull();
  const before = await page.evaluate((t) => performance.getEntriesByType('resource').filter((e) => e.startTime <= t).map((e) => new URL(e.name).pathname), usableAt!);
  const uncounted = before.filter((p) => /\.(m?js|wasm|bin|woff2|css)$/.test(p) && !USABLE.has(p));
  expect(uncounted, 'fetched before live, not in the static "to usable" row').toEqual([]);
  expect(before.filter((p) => AFTER.has(p))).toEqual([]);
  // released: he comes in, and moors
  for (const h of held.splice(0)) await h.route.continue();
  await page.unroute((url) => isAfter(url.href));
  await expect.poll(async () => (await pitch(page))?.state ?? null, { timeout: 30_000 }).not.toBeNull();
  const first = await pitch(page);
  expect(['arrive', 'plant']).toContain(first!.state);
  expect(first!.carried).toBe(true);
  await expect.poll(async () => { const v = await pitch(page); return v && v.state === 'moored' && !v.carried; }, { timeout: 40_000, intervals: [250] }).toBe(true);
  // every late request started after the bench was usable (resource timing, now that they have finished)
  const late = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => ({ p: new URL(e.name).pathname, t: e.startTime })));
  for (const r of late.filter((x) => AFTER.has(x.p))) expect(r.t, `${r.p} at ${r.t.toFixed(0)} ms, usable at ${usableAt!.toFixed(0)} ms`).toBeGreaterThan(usableAt!);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => (window as any).__workshopFaults?.().count ?? -1)).toBe(0);
});

test('refused altogether (offline): the bench carries on without him, and nothing errors', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    // (the browser's own line for each refused file is expected; nothing of the page's)
    if (m.type() === 'error' && !/Failed to load resource|net::ERR_INTERNET_DISCONNECTED/.test(m.text())) errors.push(m.text());
  });
  let refused = 0;
  await page.route((url) => isAfter(url.href), async (route) => {
    refused++;
    await route.abort('internetdisconnected');
  });
  await page.goto('/');
  await live(page);
  await expect.poll(() => page.evaluate(() => (window as any).__late?.units?.pitch ?? null), { timeout: 20_000 }).toBe('refused');
  expect(refused).toBeGreaterThan(0);
  expect(await pitch(page)).toBeNull();
  await benchWorks(page);
  await page.waitForTimeout(2000);
  expect(await pitch(page)).toBeNull();
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => (window as any).__workshopFaults?.().count ?? -1)).toBe(0);
});
