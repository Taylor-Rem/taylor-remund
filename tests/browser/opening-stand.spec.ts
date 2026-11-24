import { expect, test, type Page } from '@playwright/test';
import { gpuArgs } from '../../playwright.config.ts';
import { startDevServer, type DevServer } from '../../scripts/capture.ts';

// P4 S6, a prototype behind one switch (`?open=stand`): the opening stand by a real hand, at 1440×900 by mouse and at
// 390×844 by touch. A crate carried to the stand and let go opens and the camera comes in; its thing's control works;
// FULL ENTRY opens the project's panel; lifted off, the crate shuts and the camera goes back out; thrown, it stays shut.
// And what the owner met: a crate caught and thrown and caught again, twenty times, fast: never opened, and the camera
// never came in for it. A map of what a press takes over the open crate on the stand: never "nothing" on its body,
// never its thing as a part.

test.use({ channel: 'chrome', launchOptions: { args: gpuArgs } });
test.describe.configure({ mode: 'serial' });
test.setTimeout(10 * 60_000);

let server: DevServer | null = null;
let origin = process.env.I1_ORIGIN ?? '';
test.beforeAll(async () => {
  if (!origin) {
    server = await startDevServer();
    origin = server.origin;
  }
});
test.afterAll(() => server?.stop());

type XY = { x: number; y: number };
const frameNo = (page: Page): Promise<number> => page.evaluate(() => (window as any).__bench.ws.driver.frames as number);
async function frames(page: Page, n = 6): Promise<void> {
  const f0 = await frameNo(page);
  await page.waitForFunction((f) => (window as any).__bench.ws.driver.frames >= f, f0 + n, { timeout: 0, polling: 50 });
}
async function until(page: Page, fn: () => Promise<boolean>, limit = 600, what = ''): Promise<void> {
  const f0 = await frameNo(page);
  for (;;) {
    if (await fn()) return;
    if ((await frameNo(page)) - f0 > limit) throw new Error(`not within ${limit} frames: ${what}`);
    await page.waitForTimeout(40);
  }
}
async function open(page: Page, w: number, h: number, extra = ''): Promise<void> {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(`${origin}/dev/bench/?open=stand&stand=b${extra}`);
  await page.waitForFunction(() => (window as any).__handoff?.phase === 'live' && (window as any).__ready === true, null, { timeout: 0, polling: 100 });
}
const screen = (page: Page, id: string): Promise<(XY & { r: number }) | null> => page.evaluate((id) => (window as any).__bench.ws.surface.screen(id), id);
/** A world point on screen (CSS px). */
const project = (page: Page, p: number[]): Promise<XY> => page.evaluate((p) => (window as any).__bench.project(p), p);
const isOpen = (page: Page, id: string): Promise<boolean> => page.evaluate((id) => (window as any).__bench.ws.world.setting(id, 'open') === true, id);
const cam = (page: Page): Promise<{ zoom: number; look: string | null; easing: boolean }> =>
  page.evaluate(() => {
    const c = (window as any).__bench.ws.stage.camera;
    return { zoom: c.zoom, look: c.lookId, easing: c.easing };
  });
const standTop = (page: Page): Promise<number[]> =>
  page.evaluate(() => {
    const w = (window as any).__bench.ws.world;
    const m = w.scene.mouths.find((x: any) => x.id === 'opening-stand');
    return m.drop;
  });

/** Carry `id` by a real pointer from where it is to `to` (screen), and let go. */
async function carry(page: Page, id: string, to: XY, kind: 'mouse' | 'touch'): Promise<void> {
  const from = (await screen(page, id))!;
  if (kind === 'mouse') {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= 24; i++) {
      await page.mouse.move(from.x + ((to.x - from.x) * i) / 24, from.y + ((to.y - from.y) * i) / 24);
      await frames(page, 1);
    }
    await frames(page, 20);
    await page.mouse.up();
  } else {
    // tap-then-tap: a tap takes it up, a tap where it is to go sets it down
    await page.touchscreen.tap(from.x, from.y);
    await frames(page, 30);
    await page.touchscreen.tap(to.x, to.y);
  }
}

for (const [kind, w, h] of [['mouse', 1440, 900], ['touch', 390, 844]] as const) {
  test(`P4 S6 (${kind}, ${w}×${h}): carried to the stand a crate opens and the camera comes in; its plate opens the entry; lifted off it shuts and the camera goes out; thrown it stays shut`, async ({ page, browser }) => {
    const ctx = kind === 'touch' ? await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true }) : null;
    const p = ctx ? await ctx.newPage() : page;
    await open(p, w, h);
    // the stand in view at a station's distance (as a visitor would bring it, by panning)
    await p.evaluate(() => {
      const ws = (window as any).__bench.ws, m = ws.world.scene.mouths.find((x: any) => x.id === 'opening-stand');
      const c = ws.world.motion('crate-4').pose.p;
      ws.stage.camera.cutTo({ focus: [(m.drop[0] + c[0]) / 2, 0.4, (m.drop[2] + c[2]) / 2], zoom: 0.35 });
    });
    await frames(p, 10);
    const top = await standTop(p);
    await carry(p, 'crate-4', await project(p, [top[0]!, top[1]! + 0.3, top[2]!]), kind);
    await until(p, () => isOpen(p, 'crate-4'), 900, 'crate-4 open on the stand');
    await until(p, async () => { const c = await cam(p); return !c.easing && c.look === 'crate-4-card'; }, 900, 'the camera in on the card');
    // FULL ENTRY: the project's panel
    await until(p, async () => (await screen(p, 'crate-4-plate')) !== null, 300, 'the plate a target');
    const pl = (await screen(p, 'crate-4-plate'))!;
    if (kind === 'mouse') await p.mouse.click(pl.x, pl.y);
    else await p.touchscreen.tap(pl.x, pl.y);
    await until(p, async () => (await p.getByRole('dialog').count()) > 0, 300, 'the entry\'s panel');
    await p.keyboard.press('Escape');
    await frames(p, 30);
    // lifted off: shut, the camera back out
    const off = await project(p, [top[0]! + 1.6, 0.3, top[2]! + 0.4]);
    await carry(p, 'crate-4', off, kind);
    await until(p, async () => !(await isOpen(p, 'crate-4')), 300, 'shut off the stand');
    await until(p, async () => (await cam(p)).look === null, 300, 'the look let go');
    // thrown: it stays shut
    const c4 = (await screen(p, 'crate-4'))!;
    if (kind === 'mouse') {
      await p.mouse.move(c4.x, c4.y);
      await p.mouse.down();
      await p.mouse.move(c4.x - 60, c4.y - 40, { steps: 3 });
      await p.mouse.up();
    }
    await frames(p, 120);
    expect(await isOpen(p, 'crate-4')).toBe(false);
    if (ctx) await ctx.close();
  });

  test(`P4 S6 (${kind}, ${w}×${h}): a crate caught and thrown and caught again, twenty times, fast: never opened, the camera never came in`, async ({ page, browser }) => {
    const ctx = kind === 'touch' ? await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true }) : null;
    const p = ctx ? await ctx.newPage() : page;
    await open(p, w, h);
    await p.evaluate(() => {
      const W = window as any;
      W.__s6 = { opened: 0, looks: 0 };
      const ws = W.__bench.ws;
      const was = ws.stage.camera.easeTo.bind(ws.stage.camera);
      ws.stage.camera.easeTo = (v: any, s?: number, o?: any) => {
        if (o?.close) W.__s6.looks++;
        return was(v, s, o);
      };
      setInterval(() => {
        for (const c of ['crate-3', 'crate-4']) if (ws.world.setting(c, 'open') === true) W.__s6.opened++;
      }, 30);
    });
    for (let i = 0; i < 20; i++) {
      const c = await screen(p, 'crate-3');
      if (!c) {
        await frames(p, 20);
        continue;
      }
      if (kind === 'mouse') {
        await p.mouse.move(c.x, c.y);
        await p.mouse.down();
        await p.mouse.move(c.x + (i % 2 ? 50 : -50), c.y - 50, { steps: 3 });
        await p.mouse.up();
      } else {
        await p.touchscreen.tap(c.x, c.y);
        await p.waitForTimeout(60);
        await p.touchscreen.tap(c.x + (i % 2 ? 40 : -40), c.y + 10);
      }
      await p.waitForTimeout(260);
    }
    await frames(p, 120);
    const r = await p.evaluate(() => (window as any).__s6);
    expect(r, `${kind}: never opened, never a look`).toEqual({ opened: 0, looks: 0 });
    if (ctx) await ctx.close();
  });
}

test('P4 S6: a press at each point over the open crate on the stand takes its controls, its plate or the crate: never nothing on its body, never its thing as a part', async ({ page }) => {
  await open(page, 1440, 900);
  await page.evaluate(() => {
    const ws = (window as any).__bench.ws, w = ws.world;
    // crate-2 off the ledger's crate (by intents: the hand is tested above), crate-1 set down on the stand
    const q = w.motion('crate-2').pose.p;
    ws.dispatch({ type: 'grab', id: 'crate-2', grip: q });
    ws.advance(6);
    ws.dispatch({ type: 'place', at: [-5.6, 0, 1.6] });
    ws.advance(90);
    ws.dispatch({ type: 'grab', id: 'crate-1', grip: w.motion('crate-1').pose.p });
    ws.advance(6);
    ws.dispatch({ type: 'place', at: 'opening-stand' });
  });
  await until(page, () => isOpen(page, 'crate-1'), 900, 'crate-1 open on the stand');
  await until(page, () => page.evaluate(() => { const w = (window as any).__bench.ws.world; return w.machine('ledger').show === null && w.mode('ledger-board') === 'machine'; }), 1800, 'the board on its tray');
  await until(page, async () => !(await cam(page)).easing, 600, 'the camera at rest');
  const map = await page.evaluate(() => {
    const B = (window as any).__bench, ws = B.ws, w = ws.world;
    const m = w.motion('crate-1').pose, half = w.halfExtents('crate-1');
    const code: Record<string, string> = { 'ledger-board': 'b', 'ledger-crank': 'K', 'ledger-plunger': 'P', 'crate-1': 'C', 'crate-1-plate': 'p', 'crate-1-lid': 'L' };
    const counts: Record<string, number> = {};
    const rows: string[] = [];
    // a grid over the crate's front and the board above it, in world space round the crate
    for (let j = 0; j <= 10; j++) {
      let row = '';
      for (let i = 0; i <= 14; i++) {
        const x = m.p[0] - half[0] + (2 * half[0] * i) / 14;
        const y = m.p[1] + half[1] * 1.6 - (half[1] * 2.6 * j) / 10;
        const s = B.project([x, y, m.p[2] + half[2]]);
        const id: string = ws.surface.at(s.x, s.y, 'mouse', null).id ?? '-';
        counts[id] = (counts[id] ?? 0) + 1;
        row += code[id] ?? (id === '-' ? '.' : '?');
      }
      rows.push(row);
    }
    return { rows, counts };
  });
  console.log(`[S6] a press over the open crate on the stand (K crank, P plunger, b the board, p plate, C crate, L latch; top row first):\n${map.rows.join('\n')}\n${JSON.stringify(map.counts)}`);
  expect(map.counts['crate-1-lid'] ?? 0, 'no latch').toBe(0);
  expect(map.counts['crate-1'] ?? 0, 'the crate takes its body').toBeGreaterThan(10);
  // the board is pick target (its body: a press there does nothing, as the board stays put); never carried off
  const b = await page.evaluate(() => {
    const ws = (window as any).__bench.ws, w = ws.world;
    ws.dispatch({ type: 'grab', id: 'ledger-board', grip: w.motion('ledger-board').pose.p });
    ws.advance(4);
    return { mode: w.mode('ledger-board'), held: w.holding()?.id ?? null };
  });
  expect(b).toEqual({ mode: 'machine', held: null });
});
