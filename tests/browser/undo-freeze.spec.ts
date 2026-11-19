import { expect, test, type Page } from '@playwright/test';
import { gpuArgs } from '../../playwright.config.ts';
import { startDevServer, type DevServer } from '../../scripts/capture.ts';

// R2 (Taylor's coworkers: "if you press the undo button too many times it breaks something because the
// simulation freezes"): UNDO by the visitor's own means — the U key held (the browser's key repeat), the lever
// clicked and tapped as fast as a person can and faster — at every moment the bench offers: during each
// rung's play and rewind, in the same frame as a Button press, with things in the hand, with Revert presenting
// a card, with the tab hidden. The dev page is strict: the first throw stops the loop and shows here. After
// each: no error, the sim clock still advancing, the belt still moving, no rung or hand left open, and how long
// until the bench is itself again.
//
// Long: run on its own, `npx playwright test tests/browser/undo-freeze.spec.ts`.

test.use({ channel: 'chrome', launchOptions: { args: gpuArgs } });
test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

let server: DevServer;
test.beforeAll(async () => {
  server = await startDevServer();
});
test.afterAll(() => server?.stop());

function watch(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|404 \(Not Found\)/.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${e.stack ?? ''}`));
  return errors;
}

async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${server.origin}/dev/bench/`);
  await page.waitForFunction(() => (window as any).__handoff?.phase === 'live' && (window as any).__ready === true, null, { timeout: 0, polling: 100 });
}

const W = 'window.__bench.ws';
const state = (page: Page) =>
  page.evaluate(() => {
    const ws = (window as any).__bench.ws;
    const w = ws.driver.o.world;
    return {
      step: w.step as number,
      phase: (w.machine('belt') as { phase: number }).phase,
      bracketed: w.bracketed as boolean,
      holding: w.holding() as unknown,
      stack: w.undoStack().length as number,
      revert: (w.machine('revert-crew') as { state: string; card: unknown }).state,
      card: !!(w.machine('revert-crew') as { card: unknown }).card,
      fetch: w.crew('fetch')?.state as string,
      faults: ws.faults().count as number,
    };
  });

/** Alive: the clock advances and the belt moves over a second; nothing threw; no rung or hand left open after a while. */
async function alive(page: Page, errors: string[], label: string): Promise<void> {
  const a = await state(page);
  await page.waitForTimeout(1000);
  const b = await state(page);
  expect(errors, `${label}: errors`).toEqual([]);
  expect(b.step - a.step, `${label}: the clock`).toBeGreaterThan(10); // advancing (the machine is shared: rate not judged here)
  test.info().annotations.push({ type: "rate", description: `${label}: ${b.step - a.step} steps in 1 s` });
  expect(b.phase !== a.phase, `${label}: the belt moves`).toBe(true);
  // the rung, if any, ends; the hand, if any, is the test's own
  let s = b;
  for (let i = 0; i < 20 && s.bracketed; i++) {
    await page.waitForTimeout(500);
    s = await state(page);
  }
  expect(s.bracketed, `${label}: a rung left open`).toBe(false);
}

/** Back to itself: Revert down or idle, no card, the stack as left; seconds it took (or Infinity). */
async function settleTime(page: Page, max = 30): Promise<number> {
  const t0 = Date.now();
  for (;;) {
    const s = await state(page);
    if (!s.bracketed && !s.card && (s.revert === 'below' || s.revert === 'idle' || s.revert === 'park')) return (Date.now() - t0) / 1000;
    if ((Date.now() - t0) / 1000 > max) return Infinity;
    await page.waitForTimeout(250);
  }
}

const turnDial = (page: Page, n: number) =>
  page.evaluate((n) => {
    const ws = (window as any).__bench.ws;
    for (let i = 0; i < n; i++) ws.dispatch({ type: 'turn', id: 'belt-dial', value: (i % 5) / 4 });
  }, n);

/** The U key held: the browser's key repeat (about 30 a second) for `seconds`. */
async function holdU(page: Page, seconds: number): Promise<void> {
  await page.keyboard.down('u');
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    await page.keyboard.down('u'); // a repeat
    await page.waitForTimeout(33);
  }
  await page.keyboard.up('u');
}

/** The lever on screen. */
const leverAt = (page: Page) =>
  page.evaluate(() => {
    const B = (window as any).__bench;
    const st = B.ws.world.scene.statics.find((s: any) => s.id === 'undo');
    return B.project([st.pose.p[0], st.pose.p[1] + 0.5, st.pose.p[2]]) as { x: number; y: number };
  });

test('(1) the U key held for ten seconds, with something to undo and with nothing', async ({ page }) => {
  const errors = watch(page);
  await open(page);
  await page.mouse.move(700, 450);
  await turnDial(page, 6);
  await page.waitForTimeout(300);
  await holdU(page, 10);
  await alive(page, errors, 'U held, with something to undo');
  await holdU(page, 10);
  await alive(page, errors, 'U held, nothing left');
  const t = await settleTime(page);
  test.info().annotations.push({ type: 'settle', description: `after U held: itself again in ${t} s` });
  expect(t).toBeLessThan(15);
});

test('(2) the lever clicked as fast as a person can and every frame, and tapped', async ({ page }) => {
  const errors = watch(page);
  await open(page);
  await turnDial(page, 6);
  const at = await leverAt(page);
  for (let i = 0; i < 40; i++) {
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(120);
  }
  await alive(page, errors, 'lever clicked fast');
  const end = Date.now() + 5000;
  while (Date.now() < end) await page.mouse.click(at.x, at.y, { delay: 0 });
  await alive(page, errors, 'lever clicked every frame');
  const t = await settleTime(page);
  test.info().annotations.push({ type: 'settle', description: `after lever spam: itself again in ${t} s` });
  expect(t).toBeLessThan(15);
});

test('(3) UNDO during every rung, play and rewind, and in the same frame as a Button press', async ({ page }) => {
  const errors = watch(page);
  await open(page);
  await page.mouse.move(700, 450);
  for (let press = 0; press < 7; press++) {
    await turnDial(page, 2);
    // in the same frame as the press
    await page.evaluate(() => {
      const ws = (window as any).__bench.ws;
      ws.dispatch({ type: 'press', id: 'button-cover' });
      ws.dispatch({ type: 'press', id: 'button' });
      ws.dispatch({ type: 'undo' });
      ws.dispatch({ type: 'press', id: 'undo-lever' });
    });
    // and all through the play and the rewind
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('u');
      await page.waitForTimeout(150);
    }
    await alive(page, errors, `rung ${press + 1}`);
  }
});

test('(4) UNDO with things in the hand: a crate, Fetch, Revert, the plug, the lamp, Patch', async ({ page }) => {
  const errors = watch(page);
  await open(page);
  await page.mouse.move(700, 450);
  const holds: [string, string][] = [
    ['crate', "ws.dispatch({type:'grab', id:'crate-3', grip: ws.world.motion('crate-3').pose.p}); ws.dispatch({type:'carry', target:[0,2,1]})"],
    ['fetch', "ws.dispatch({type:'grab', id:'fetch', grip: ws.world.motion('fetch').pose.p}); ws.dispatch({type:'carry', target:[-2,2.5,1]})"],
    ['plug', "ws.dispatch({type:'unplug', cord:'cord'}); ws.dispatch({type:'carry', target:[0,1.5,-3]})"],
    ['lamp', "ws.dispatch({type:'grab', id:'lamp', grip:[0,4,0]}); ws.dispatch({type:'carry', target:[1,3,1]})"],
    ['patch', "ws.dispatch({type:'grab', id:'patch', grip:[0,1,-3]}); ws.dispatch({type:'carry', target:[2,2.5,0]})"],
  ];
  for (const [what, js] of holds) {
    await turnDial(page, 3);
    await page.evaluate(`(() => { const ws = ${W}; ${js}; })()`);
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('u');
      await page.waitForTimeout(60);
    }
    await page.evaluate(`(() => { const ws = ${W}; ws.dispatch({type:'release', velocity:[0,0,0]}); ws.dispatch({type:'plug', cord:'cord', jack:null}); })()`);
    await alive(page, errors, `holding ${what}`);
    const s = await state(page);
    expect(s.holding, `holding ${what}: the hand let go`).toBeNull();
  }
});

test('(5) UNDO spam while Revert presents a card: nothing queues without bound; how long until the bench is itself', async ({ page }) => {
  const errors = watch(page);
  await open(page);
  await page.mouse.move(700, 450);
  await page.evaluate(() => (window as any).__bench.ws.dispatch({ type: 'press', id: 'button' }));
  await page.waitForFunction(() => !!((window as any).__bench.ws.world.machine('revert-crew') as any).card, null, { timeout: 20_000 });
  const before = await page.evaluate(() => (window as any).__bench.ws.labels.uploads());
  for (let i = 0; i < 300; i++) {
    await page.keyboard.press('u');
    await page.waitForTimeout(16);
  }
  const after = await page.evaluate(() => (window as any).__bench.ws.labels.uploads());
  await alive(page, errors, 'spam during a card');
  const t = await settleTime(page);
  test.info().annotations.push({ type: 'settle', description: `after 300 U during a card: itself again in ${t} s; label bands ${before.bands} → ${after.bands}, queued ${after.queued}` });
  expect(after.queued).toBeLessThan(10);
  expect(t).toBeLessThan(15);
});

test('(6) the tab hidden for a minute in the middle of a rung and of a lever spam, then shown', async ({ page }) => {
  const errors = watch(page);
  await open(page);
  await page.mouse.move(700, 450);
  await turnDial(page, 4);
  await page.evaluate(() => (window as any).__bench.ws.dispatch({ type: 'press', id: 'button' }));
  for (let i = 0; i < 10; i++) await page.keyboard.press('u');
  const hide = (h: boolean) =>
    page.evaluate((h) => {
      Object.defineProperty(document, 'hidden', { value: h, configurable: true });
      Object.defineProperty(document, 'visibilityState', { value: h ? 'hidden' : 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    }, h);
  await hide(true);
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('u');
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(60_000);
  await hide(false);
  for (let i = 0; i < 20; i++) await page.keyboard.press('u');
  await alive(page, errors, 'after a minute hidden');
  const t = await settleTime(page);
  test.info().annotations.push({ type: 'settle', description: `after the hidden minute: itself again in ${t} s` });
  expect(t).toBeLessThan(20);
});
