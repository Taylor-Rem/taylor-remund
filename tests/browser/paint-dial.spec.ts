import { expect, test, type Page } from '@playwright/test';
import { gpuArgs } from '../../playwright.config.ts';
import { startDevServer, type DevServer } from '../../scripts/capture.ts';
import { openOnStand } from './stand.ts';

// P4 D2b: the paint dial by a real hand, on /dev/bench/ on the real GPU: its knob turned by a mouse drag and clicked one
// detent on at 1440×900, tapped one detent on by a finger at 390×844, each where it is drawn; the workshop's enamel
// changes with it (the steel material's scheme). t-components' crate is opened by the page's own intent first (that
// part is the crates' and is tested there). The 44 px fingertip waits for the crates' camera, which frames a thing.

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

const KNOB = 'paint-dial-knob';
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
const scheme = (page: Page): Promise<string> => page.evaluate(() => (window as any).__bench.ws.world.setting('paint-dial', 'scheme'));
/** The scheme the steel material is drawing now (the view's), once its wipe is over. */
const painted = (page: Page): Promise<{ current: string; active: number }> => page.evaluate(() => {
  const m = (window as any).__bench.ws.materials;
  return { current: m.paint.current, active: m.paint.u.s_active.value };
});
const screenOf = (page: Page, id: string): Promise<{ x: number; y: number; r: number } | null> => page.evaluate((id) => (window as any).__bench.ws.surface.screen(id), id);

/**
 * In close on the dial the way a visitor gets there: a double-tap on its knob (`select`, as the input sends it) asks to
 * be looked at, and the shell brings its crate's card close (`lookAt`). Waits for the camera to rest on the look.
 */
async function closeIn(page: Page): Promise<void> {
  await page.evaluate((id) => (window as any).__bench.ws.dispatch({ type: 'select', id }), KNOB);
  await until(page, () => page.evaluate(() => { const c = (window as any).__bench.ws.stage.camera; return c.look !== null && !c.easing; }), 300, 'the look at the dial');
  await frames(page, 10);
}

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
      // (I2) with things fixed a press on the toy's body is reported as its crate's (S6 round two): judged by the body's
      // own middle, as it was when the body was a target of its own
      const body = got === 'crate-3' && ws.world.mode('paint-dial') === 'machine' ? 'paint-dial' : got;
      const g = body ? ws.surface.screen(body) ?? ws.surface.screen(got) : null;
      const fair = g && Math.hypot(g.x - s.x - dx!, g.y - s.y - dy!) < Math.hypot(dx!, dy!);
      if (!fair) misses.push(`${dx},${dy}→${got}`);
    }
    return misses.length ? `misses ${misses.join(' ')}` : 'ok';
  }, id);

async function open(page: Page, query = ''): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${origin}/dev/bench/${query}`);
  await page.waitForFunction(() => (window as any).__handoff?.phase === 'live' && (window as any).__ready === true, null, { timeout: 0, polling: 100 });
  // (I2) t-components' crate opened the one way the bench has: set on the opening stand (tests/browser/stand.ts)
  await openOnStand(page, 'crate-3');
  await until(page, () => page.evaluate(() => (window as any).__bench.ws.world.mode('paint-dial') === 'machine'), 300, 'the dial on its tray');
  return errors;
}

test('P4 D2b: the paint dial by mouse at 1440×900: a drag turns it through its detents, a click moves it one on; the enamel follows', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await open(page);
  expect(await scheme(page)).toBe('A');
  expect((await painted(page)).active).toBe(0);
  await closeIn(page);
  const k = (await screenOf(page, KNOB))!;
  expect(k, 'the knob is a target').not.toBeNull();
  // a drag to the right turns it up, detent by detent: one gesture
  const n0 = await page.evaluate(() => (window as any).__bench.ws.world.undoStack().length);
  await page.mouse.move(k.x, k.y);
  await frames(page, 2);
  await page.mouse.down();
  for (let dx = 0; dx <= 160; dx += 16) {
    await page.mouse.move(k.x + dx, k.y);
    await frames(page, 1);
  }
  await page.mouse.up();
  await until(page, async () => (await scheme(page)) !== 'A', 120, 'turned by a drag');
  const dragged = await scheme(page);
  expect(await page.evaluate(() => (window as any).__bench.ws.world.undoStack().length)).toBe(n0 + 1);
  await until(page, async () => (await painted(page)).current === dragged, 200, 'the enamel follows');
  // (D2c) the turn sent the camera back out to the room (look.back): it went
  await until(page, () => page.evaluate(() => (window as any).__bench.ws.stage.camera.look === null), 120, 'the camera back out after the turn');
  // a click, from close again: one detent on
  await page.waitForTimeout(500); // (past the double-click window, so the look is not taken for a second click)
  await closeIn(page);
  const k2 = (await screenOf(page, KNOB))!;
  const order = await page.evaluate(() => (window as any).__bench.ws.world.machine('paint').schemes as string[]);
  const next = order[(order.indexOf(dragged) + 1) % order.length]!;
  await page.mouse.click(k2.x, k2.y);
  await until(page, async () => (await scheme(page)) === next, 120, 'one on by a click');
  // the lever: back to where the drag left it
  await page.evaluate(() => (window as any).__bench.ws.dispatch({ type: 'undo' }));
  await until(page, async () => (await scheme(page)) === dragged, 120, 'the lever takes the click back');
  console.log(`[D2b] at 1440×900, framed: ${JSON.stringify(await screenOf(page, KNOB))}, dragged to ${dragged}`);
  expect(errors).toEqual([]);
});

test('P4 D2b: the paint dial by a finger at 390×844: a tap moves it one detent on', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = await open(page);
  await closeIn(page);
  const k = (await screenOf(page, KNOB))!;
  expect(k, 'the knob is a target').not.toBeNull();
  await page.touchscreen.tap(k.x, k.y);
  await until(page, async () => (await scheme(page)) === 'B', 120, 'one on by a tap');
  console.log(`[D2b] at 390×844, camera in: ${JSON.stringify(k)}`);
  expect(errors).toEqual([]);
  await ctx.close();
});

test('P4 D2b: the knob is a 44 px fingertip at 390×844, at the framing a look at the dial gives', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = await open(page);
  await closeIn(page);
  const tip = await fingertip(page, KNOB);
  console.log(`[D2c] 44 px at 390×844, looking at the dial: ${tip} ${JSON.stringify(await screenOf(page, KNOB))}`);
  expect(tip).toBe('ok');
  expect(errors).toEqual([]);
  await ctx.close();
});

test('(D2d) look.back gives back only its own look: the press flicking while the visitor reads another look leaves the camera there; the dial\'s turn gives its own back', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // (I2) one crate at a time on the stand: the other look the visitor reads is the dial's own, out on the bench (the
  // stand's other way for a thing, `?things=loose`), while the press's crate is open on the stand
  const errors = await open(page, '?things=loose');
  const cam = () => page.evaluate(() => { const c = (window as any).__bench.ws.stage.camera; return { look: c.look !== null, id: c.lookId as string | null, easing: c.easing as boolean }; });
  const rest = (id: string | null, what: string, not: string | null = null) => until(page, async () => { const c = await cam(); return c.look && (id === null || c.id === id) && (not === null || c.id !== not) && !c.easing; }, 400, what);
  // the dial off its tray, onto the open bench by the platen (clear of the stand and of Fetch's lane)
  await page.evaluate(() => { const ws = (window as any).__bench.ws; ws.dispatch({ type: 'grab', id: 'paint-dial', grip: ws.world.motion('paint-dial').pose.p }); });
  await frames(page, 3);
  await page.evaluate(() => (window as any).__bench.ws.dispatch({ type: 'place', at: [4.3, 0, 1.75] }));
  await until(page, () => page.evaluate(() => (window as any).__bench.ws.world.part('paint-dial').location.at === 'rest' && (window as any).__bench.ws.world.holding() === null), 900, 'the dial on the bench');
  // the press's crate onto the stand (the camera comes in on its card), then a pull
  await openOnStand(page, 'crate-2');
  await rest('crate-2-card', 'the look at the press\'s card');
  await until(page, () => page.evaluate(() => (window as any).__bench.ws.world.mode('report-press') === 'machine'), 300, 'the press on its tray');
  await frames(page, 30);
  await page.evaluate(() => (window as any).__bench.ws.dispatch({ type: 'press', id: 'press-lever' }));
  await frames(page, 10);
  // before the flick (2.7 s on), the visitor asks for the dial: the camera goes to it
  await page.evaluate((id) => (window as any).__bench.ws.dispatch({ type: 'select', id }), KNOB);
  await rest(null, 'the look at the dial', 'crate-2-card');
  const dialLook = (await cam()).id;
  expect(dialLook, 'a look other than the press\'s card').not.toBe('crate-2-card');
  // the flick comes and goes (its look.back is for crate-2's card): the camera stays on the dial's
  await until(page, () => page.evaluate(() => (window as any).__bench.ws.world.machine('press').envelopeIn === false), 400, 'the flick');
  await frames(page, 60);
  expect(await cam()).toEqual({ look: true, id: dialLook, easing: false });
  // the dial's own turn gives its look back
  await page.evaluate((id) => (window as any).__bench.ws.dispatch({ type: 'press', id }), KNOB);
  await until(page, async () => !(await cam()).look, 200, 'the turn gives the look back');
  expect(errors).toEqual([]);
});

test('(D2d, I2) the crate taken from Fetch\'s arms and set on the stand opens and the camera comes in; shut by anything but a hand (the lever), it gives the look back', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await open(page);
  const cam = () => page.evaluate(() => { const c = (window as any).__bench.ws.stage.camera; return { look: c.look !== null, id: c.lookId as string | null, easing: c.easing as boolean }; });
  const rest = (id: string, what: string) => until(page, async () => { const c = await cam(); return c.look && c.id === id && !c.easing; }, 400, what);
  // (I2) the crate in Fetch's arms, double-clicked: nothing opens (the stand is the one way); taken from his arms and
  // set on the stand, it opens and the camera comes in; the lever takes the setting down back: it shuts (not by a
  // hand), and the camera goes back out
  await until(page, () => page.evaluate(() => (window as any).__bench.ws.world.mode('crate-4') === 'crew'), 1500, 'crate-4 in Fetch\'s arms');
  await page.evaluate(() => { const ws = (window as any).__bench.ws; ws.dispatch({ type: 'grab', id: 'crate-4', grip: ws.world.motion('crate-4').pose.p }); });
  await frames(page, 2);
  await page.evaluate(() => (window as any).__bench.ws.dispatch({ type: 'select', id: 'crate-4' }));
  await frames(page, 60);
  expect(await page.evaluate(() => (window as any).__bench.ws.world.setting('crate-4', 'open') === true), 'a double-click opens nothing').toBe(false);
  await openOnStand(page, 'crate-4');
  await rest('crate-4-card', 'the look at crate-4\'s card');
  await page.evaluate(() => (window as any).__bench.ws.dispatch({ type: 'undo' }));
  await until(page, () => page.evaluate(() => (window as any).__bench.ws.world.setting('crate-4', 'open') === false), 600, 'the lever shuts it');
  await until(page, async () => !(await cam()).look, 200, 'the camera back out');
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});
