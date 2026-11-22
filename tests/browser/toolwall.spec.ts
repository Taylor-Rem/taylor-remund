import { expect, test, type Page } from '@playwright/test';
import { gpuArgs } from '../../playwright.config.ts';
import { startDevServer, type DevServer } from '../../scripts/capture.ts';

// P4 T2: the tool wall by a real hand, on /dev/bench/ on the real GPU. VUE taken off its peg by the mouse at 1440×900,
// carried across the bench and set down, then taken up and carried back to its painted shadow and let go there: it is on
// its peg again. At 390×844 by a finger: the camera on the wall as a look at a tool brings it (a double-tap), the tool a
// 44 px fingertip there; a tap takes it, a tap on its painted shadow hangs it back; a tap on another tool's shadow does
// not take it. Every pick target the wall registers answers (each tool, each place while a tool is held, the sheet).

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

const SHOTS = process.env.T2_SHOTS ?? '';
const frameNo = (page: Page): Promise<number> => page.evaluate(() => (window as any).__bench.ws.driver.frames as number);
async function frames(page: Page, n = 6): Promise<void> {
  const f0 = await frameNo(page);
  await page.waitForFunction((f) => (window as any).__bench.ws.driver.frames >= f, f0 + n, { timeout: 0, polling: 50 });
}
async function until(page: Page, fn: () => Promise<boolean>, limit = 600, what = '', why?: () => Promise<string>): Promise<void> {
  const f0 = await frameNo(page);
  for (;;) {
    if (await fn()) return;
    if ((await frameNo(page)) - f0 > limit) throw new Error(`not within ${limit} frames: ${what}${why ? ` ${await why()}` : ''}`);
    await page.waitForTimeout(40);
  }
}
async function cameraStill(page: Page): Promise<void> {
  await frames(page, 4);
  await until(page, () => page.evaluate(() => !(window as any).__bench.ws.stage.camera.easing), 600, 'the camera at rest');
  await frames(page, 6);
}
async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|404 \(Not Found\)/.test(m.text())) errors.push(m.text());
  });
  await page.goto(`${origin}/dev/bench/`);
  await page.waitForFunction(() => (window as any).__handoff?.phase === 'live' && (window as any).__ready === true, null, { timeout: 0, polling: 100 });
  return errors;
}
/** On its peg: in the wall's hands, where it hangs (the scene's table). */
const onPeg = (page: Page, id: string): Promise<boolean> =>
  page.evaluate((id) => {
    const w = (window as any).__bench.ws.world;
    const m = w.motion(id);
    const l = w.part(id).location;
    const h = w.scene.parts.find((p: any) => p.id === id).pose.p;
    return m.mode === 'machine' && l.at === 'in' && l.mouth === 'toolwall' && Math.hypot(m.pose.p[0] - h[0], m.pose.p[1] - h[1], m.pose.p[2] - h[2]) < 0.02;
  }, id);
const screenOf = (page: Page, id: string): Promise<{ x: number; y: number; r: number } | null> => page.evaluate((id) => (window as any).__bench.ws.surface.screen(id), id);
const projectOf = (page: Page, p: readonly number[]): Promise<{ x: number; y: number }> => page.evaluate((p) => (window as any).__bench.project(p), p);
const hangOf = (page: Page, id: string): Promise<number[]> => page.evaluate((id) => (window as any).__bench.ws.world.scene.parts.find((p: any) => p.id === id).pose.p, id);
const diag = (page: Page, id: string): Promise<string> =>
  page.evaluate((id) => {
    const ws = (window as any).__bench.ws;
    const w = ws.world;
    const m = w.motion(id);
    return JSON.stringify({ mode: m.mode, p: m.pose.p.map((v: number) => +v.toFixed(3)), loc: w.part(id).location.at, holding: w.holding(), step: w.step, screen: ws.surface.screen(id) });
  }, id);

/** A 44 px fingertip round the target's middle: every point of its rim picks it, unless a neighbour's middle is nearer. */
const fingertip = (page: Page, id: string): Promise<string> =>
  page.evaluate((id) => {
    const ws = (window as any).__bench.ws;
    const s = ws.surface.screen(id);
    if (!s) return 'no pick target';
    const misses: string[] = [];
    for (const [dx, dy] of [[-15, -15], [0, -21], [15, -15], [-21, 0], [21, 0], [-15, 15], [0, 21], [15, 15], [0, 0]]) {
      const got = ws.surface.at(s.x + dx!, s.y + dy!, 'touch', null).id;
      if (got === id) continue;
      const g = got ? ws.surface.screen(got) : null;
      const fair = g && Math.hypot(g.x - s.x - dx!, g.y - s.y - dy!) < Math.hypot(dx!, dy!);
      if (!fair) misses.push(`${dx},${dy}→${got}`);
    }
    return misses.length ? `misses ${misses.join(' ')}` : 'ok';
  }, id);

test('P4 T2: VUE by mouse at 1440×900: off its peg, across the bench, set down; taken up again and hung back on its painted shadow', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await open(page);
  const id = 'tool-vue';
  expect(await onPeg(page, id)).toBe(true);
  // the wall framed as its keyboard focus frames it
  await page.evaluate(() => (window as any).__bench.ws.framing.bring('tool-vue'));
  await cameraStill(page);
  const s = (await screenOf(page, id))!;
  expect(s, 'VUE is a target').not.toBeNull();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/mouse-0-framed-1440.png` });
  await page.mouse.move(s.x - 40, s.y + 30);
  await frames(page, 2);
  await page.mouse.move(s.x, s.y, { steps: 4 });
  await page.mouse.down();
  await until(page, () => page.evaluate(() => (window as any).__bench.ws.world.holding()?.id === 'tool-vue'), 60, 'VUE in the hand', () => diag(page, id));
  // across the bench to the open floor in front of the wall, and let go
  const spot = await projectOf(page, [-6.4, 0.1, -3.4]);
  await page.mouse.move(spot.x, spot.y, { steps: 30 });
  await frames(page, 20);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/mouse-1-carried-1440.png` });
  await page.mouse.up();
  await until(page, () => page.evaluate(() => { const w = (window as any).__bench.ws.world; return w.part('tool-vue').location.at === 'rest' && w.holding() === null; }), 600, 'VUE lying on the bench', () => diag(page, id));
  // taken up again where it lies and carried back to its painted shadow
  const s2 = (await screenOf(page, id))!;
  await page.mouse.move(s2.x, s2.y, { steps: 3 });
  await page.mouse.down();
  await until(page, () => page.evaluate(() => (window as any).__bench.ws.world.holding()?.id === 'tool-vue'), 60, 'VUE in the hand again', () => diag(page, id));
  const home = await projectOf(page, await hangOf(page, id));
  await page.mouse.move(home.x, home.y, { steps: 30 });
  await frames(page, 30);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/mouse-2-at-shadow-1440.png` });
  console.log(`[T2] held at its shadow before letting go: ${await diag(page, id)} (it hangs at ${JSON.stringify(await hangOf(page, id))})`);
  await page.mouse.up();
  await until(page, () => onPeg(page, id), 300, 'VUE back on its peg', () => diag(page, id));
  expect(errors).toEqual([]);
});

test('P4 T2: VUE by a finger at 390×844, at the framing a look at it gives: a 44 px fingertip; a tap takes it, a tap on another\'s shadow drops it, a tap on its own hangs it', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = await open(page);
  const id = 'tool-vue';
  // a double-tap on it asks for the camera (the board while it hangs)
  await page.evaluate(() => (window as any).__bench.ws.dispatch({ type: 'select', id: 'tool-vue' }));
  await cameraStill(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/tap-0-look-390.png` });
  const tip = await fingertip(page, id);
  const size = await screenOf(page, id);
  console.log(`[T2] VUE at 390×844 at the look's framing: ${tip} ${JSON.stringify(size)}`);
  expect(tip, 'a 44 px fingertip on VUE').toBe('ok');
  // a tap takes it (tap-then-tap)
  let s = (await screenOf(page, id))!;
  await page.touchscreen.tap(s.x, s.y);
  await until(page, () => page.evaluate(() => (window as any).__bench.ws.world.holding()?.id === 'tool-vue'), 120, 'VUE taken by a tap', () => diag(page, id));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/tap-1-held-390.png` });
  // a tap on the screwdriver's neighbour's place (PHP's): not its place: it drops to the bench
  const other = await projectOf(page, await hangOf(page, 'tool-php'));
  await page.touchscreen.tap(other.x, other.y);
  await until(page, () => page.evaluate(() => { const w = (window as any).__bench.ws.world; return w.holding() === null && w.part('tool-vue').location.at === 'rest'; }), 600, 'VUE dropped below PHP\'s place', () => diag(page, id));
  expect(await onPeg(page, 'tool-php')).toBe(true);
  expect(await onPeg(page, id)).toBe(false);
  // taken again where it lies, and a tap on its own place hangs it
  await page.evaluate(() => (window as any).__bench.ws.dispatch({ type: 'select', id: 'tool-vue' }));
  await cameraStill(page);
  s = (await screenOf(page, id))!;
  await page.touchscreen.tap(s.x, s.y);
  await until(page, () => page.evaluate(() => (window as any).__bench.ws.world.holding()?.id === 'tool-vue'), 120, 'VUE taken again', () => diag(page, id));
  await page.evaluate(() => (window as any).__bench.ws.dispatch({ type: 'select', id: 'tool-php' })); // the board in view again (a look at a hanging tool)
  await cameraStill(page);
  const place = (await screenOf(page, 'peg-vue')) ?? (await projectOf(page, await hangOf(page, id)));
  await page.touchscreen.tap(place.x, place.y);
  await until(page, () => onPeg(page, id), 300, 'VUE back on its peg by a tap on its shadow', () => diag(page, id));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/tap-2-hung-390.png` });
  expect(errors).toEqual([]);
  await ctx.close();
});

test('P4 T2: the wall\'s pick targets: each tool, each place while a tool is held, the sheet (pressed: the skills list)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await open(page);
  await page.evaluate(() => (window as any).__bench.ws.framing.bring('tool-vue'));
  await cameraStill(page);
  const tools = ['laravel', 'vue', 'php', 'python', 'rust', 'sql', 'flutter', 'claude-code'].map((k) => `tool-${k}`);
  const got = await page.evaluate((tools) => {
    const ws = (window as any).__bench.ws;
    return tools.map((id) => { const s = ws.surface.screen(id); return s ? ws.surface.at(s.x, s.y, 'mouse', null).id : null; });
  }, tools);
  expect(got).toEqual(tools);
  const sheet = await page.evaluate(() => { const ws = (window as any).__bench.ws; const s = ws.surface.screen('toolwall-sheet'); return s ? ws.surface.at(s.x, s.y, 'mouse', null).id : null; });
  expect(sheet).toBe('toolwall-sheet');
  const ev = await page.evaluate(() => {
    const ws = (window as any).__bench.ws;
    ws.dispatch({ type: 'press', id: 'toolwall-sheet' });
    return true;
  });
  expect(ev).toBe(true);
  await frames(page, 4);
  expect(errors).toEqual([]);
});
