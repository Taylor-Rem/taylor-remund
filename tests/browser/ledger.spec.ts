import { expect, test, type Page } from '@playwright/test';
import { gpuArgs } from '../../playwright.config.ts';
import { startDevServer, type DevServer } from '../../scripts/capture.ts';
import { openOnStand, liftOff } from './stand.ts';

// P4 D1: the ledger board's two controls by a real hand, on /dev/bench/ on the real GPU: the crank and the plunger
// by mouse at 1440×900 and by a finger at 390×844, each pressed where it is drawn, and each a 44 px fingertip at the
// framing the camera gives the board (the framing its control's keyboard focus brings). The board is taken out of its
// crate by the page's own intents first (the crate on top of it set aside, the lid opened): that part is the crates'
// and is tested there.

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
async function until(page: Page, fn: () => Promise<boolean>, limit = 600, what = '', why?: () => Promise<string>): Promise<void> {
  const f0 = await frameNo(page);
  for (;;) {
    if (await fn()) return;
    if ((await frameNo(page)) - f0 > limit) throw new Error(`not within ${limit} frames: ${what}${why ? ` ${await why()}` : ''}`);
    await page.waitForTimeout(40);
  }
}

/** (I2) The ledger's crate opened the one way the bench has: set on the opening stand (tests/browser/stand.ts). */
const openLedgerCrate = (page: Page): Promise<void> => openOnStand(page, 'crate-1');

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // (I2) the board is carried off its tray onto the bench: the stand's other way for a crate's thing (`?things=loose`);
  // on the shipped bench it stays on its tray (the tray tests below)
  await page.goto(`${origin}/dev/bench/?things=loose`);
  await page.waitForFunction(() => (window as any).__handoff?.phase === 'live' && (window as any).__ready === true, null, { timeout: 0, polling: 100 });
  // every intent the world is given, kept for a failure's report
  await page.evaluate(() => {
    const ws = (window as any).__bench.ws;
    const log: unknown[] = ((window as any).__d1intents = []);
    const d0 = ws.dispatch.bind(ws);
    ws.dispatch = (i: any) => {
      if (i.type !== 'hover' && i.type !== 'carry') log.push({ step: ws.world.step, i });
      return d0(i);
    };
  });
  // the crate on the ledger's set aside, and the ledger's opened: the board comes out and deals itself
  await page.evaluate(() => {
    const ws = (window as any).__bench.ws;
    ws.dispatch({ type: 'grab', id: 'crate-2', grip: ws.world.motion('crate-2').pose.p });
  });
  await frames(page, 3);
  await page.evaluate(() => (window as any).__bench.ws.dispatch({ type: 'place', at: [3.15, 0, 2.05] }));
  await until(page, () => page.evaluate(() => (window as any).__bench.ws.world.part('crate-2').location.at === 'rest' && (window as any).__bench.ws.world.holding() === null), 600, 'crate-2 set aside');
  await frames(page, 30);
  await openLedgerCrate(page);
  const why = await page.evaluate(() => { const w = (window as any).__bench.ws.world; return { open: w.setting('crate-1', 'open'), mode: w.mode('crate-1'), c2: w.motion('crate-2').pose.p, c1: w.motion('crate-1').pose.p }; });
  await until(page, () => page.evaluate(() => (window as any).__bench.ws.world.machine('ledger').wrong === true), 600, `the board dealt (${JSON.stringify(why)})`);
  // the board off its tray and onto the open bench in front of the platen, where nothing stands between it and the camera (in front of the stack it sat under the striker's arm, hidden, though a press still found it). Not on the
  // lane (along z 2.78 from x -2.9 to 1.16): set down on it, Fetch knocks the board onto the belt, it ships and comes
  // back up the chute, and a press aimed where it was lands on nothing or on the moving board. Not behind the lane
  // either: Fetch walking in front of the board between the camera and the crank takes the click (it is lifted). The
  // same for the crate set aside above: set down on the lane, Fetch knocks it into the stack, and the ledger's crate
  // was then not lying still when its latch was pressed.
  await page.evaluate(() => {
    const ws = (window as any).__bench.ws;
    ws.dispatch({ type: 'grab', id: 'ledger-board', grip: ws.world.motion('ledger-board').pose.p });
  });
  await frames(page, 3);
  await page.evaluate(() => (window as any).__bench.ws.dispatch({ type: 'place', at: [4.3, 0, 1.75] }));
  await until(page, () => page.evaluate(() => (window as any).__bench.ws.world.part('ledger-board').location.at === 'rest' && (window as any).__bench.ws.world.machine('ledger').show === null), 900, 'the board on the bench, its show over');
  return errors;
}

/** What a failure needs: what the hand would hit at (x, y), the intents since `since`, where the board is and what it is doing. */
const diag = (page: Page, x: number, y: number, kind: 'mouse' | 'touch', since: number): Promise<string> =>
  page.evaluate(([x, y, kind, since]) => {
    const ws = (window as any).__bench.ws;
    const w = ws.world;
    const lv = w.machine('ledger');
    const m = w.motion('ledger-board');
    return JSON.stringify({
      at: ws.surface.at(x, y, kind, null),
      intents: (window as any).__d1intents.filter((e: any) => e.step >= since),
      board: { mode: m.mode, held: m.held, p: m.pose.p.map((v: number) => +v.toFixed(3)) },
      show: lv.show && { kind: lv.show.kind, since: lv.show.since },
      waiting: lv.waiting,
      tokens: lv.tokens,
      holding: w.holding(),
      step: w.step,
      boxes: Object.fromEntries(['ledger-crank', 'ledger-plunger', 'ledger-board'].map((id) => { const b = ws.picking.worldBox(id); return [id, b && { min: [b.min.x, b.min.y, b.min.z].map((v: number) => +v.toFixed(3)), max: [b.max.x, b.max.y, b.max.z].map((v: number) => +v.toFixed(3)) }]; })),
      screens: { crank: ws.surface.screen('ledger-crank'), plunger: ws.surface.screen('ledger-plunger') },
    });
  }, [x, y, kind, since] as const);
const stepNo = (page: Page): Promise<number> => page.evaluate(() => (window as any).__bench.ws.world.step as number);

/** A target's middle on screen, once it is a target (null: not one). */
const screenOf = (page: Page, id: string): Promise<{ x: number; y: number; r: number } | null> => page.evaluate((id) => (window as any).__bench.ws.surface.screen(id), id);
const tokens = (page: Page): Promise<string[]> => page.evaluate(() => (window as any).__bench.ws.world.setting('ledger-board', 'tokens'));
const repaired = (t: string[]): boolean => t.some((s) => s === 'rs') && !t.some((s) => s === 'c7');
const bounced = (t: string[]): boolean => t.some((s) => s === 'rg');

/** Frame the board as its control's keyboard focus does, and wait for the camera to rest. */
async function bring(page: Page, id: string): Promise<void> {
  await page.evaluate((id) => (window as any).__bench.ws.framing.bring(id), id);
  await frames(page, 70);
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
      const g = got ? ws.surface.screen(got) : null;
      const fair = g && Math.hypot(g.x - s.x - dx!, g.y - s.y - dy!) < Math.hypot(dx!, dy!);
      if (!fair) misses.push(`${dx},${dy}→${got}`);
    }
    return misses.length ? `misses ${misses.join(' ')}` : 'ok';
  }, id);

test('P4 D1: the ledger board by mouse at 1440×900: the plunger repairs it, the crank deals it again', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await open(page);
  expect(bounced(await tokens(page))).toBe(true);
  await bring(page, 'ledger-plunger');
  const p = (await screenOf(page, 'ledger-plunger'))!;
  expect(p, 'the plunger is a target').not.toBeNull();
  await page.mouse.move(p.x - 30, p.y - 20);
  await frames(page, 2);
  await page.mouse.move(p.x, p.y, { steps: 4 });
  const cur = () => page.evaluate(() => (document.getElementById('stage') as HTMLCanvasElement).style.cursor);
  await until(page, async () => /pointer$/.test(await cur()), 60, `one finger over the plunger (${await cur()})`);
  let s0 = await stepNo(page);
  await page.mouse.click(p.x, p.y);
  await until(page, async () => repaired(await tokens(page)), 120, 'repaired by a click on the plunger', () => diag(page, p.x, p.y, 'mouse', s0));
  await until(page, () => page.evaluate(() => (window as any).__bench.ws.world.machine('ledger').show === null), 600, 'the repair shown');
  const c = (await screenOf(page, 'ledger-crank'))!;
  s0 = await stepNo(page);
  await page.mouse.click(c.x, c.y);
  await until(page, async () => bounced(await tokens(page)), 120, 'dealt by a click on the crank', () => diag(page, c.x, c.y, 'mouse', s0));
  const sizes = await page.evaluate(() => ({ crank: (window as any).__bench.ws.surface.screen('ledger-crank'), plunger: (window as any).__bench.ws.surface.screen('ledger-plunger') }));
  console.log(`[D1] at 1440×900, framed: ${JSON.stringify(sizes)}`);
  expect(errors).toEqual([]);
});

test('P4 D1: the ledger board by a finger at 390×844, the camera in on it: a tap on the plunger repairs it, a tap on the crank deals it', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = await open(page);
  // in close on the board (until the crates' own camera comes in on an opened crate, this is the page's hand on it)
  await page.evaluate(() => {
    const ws = (window as any).__bench.ws;
    const p = ws.world.motion('ledger-board').pose.p;
    ws.stage.camera.stationSize = 0.8;
    ws.stage.camera.cutTo({ focus: [p[0], p[1] + 0.05, p[2]], zoom: 1 }, { hold: true });
  });
  await frames(page, 20);
  const tips = { plunger: await fingertip(page, 'ledger-plunger'), crank: await fingertip(page, 'ledger-crank') };
  const sizes = await page.evaluate(() => ({ crank: (window as any).__bench.ws.surface.screen('ledger-crank'), plunger: (window as any).__bench.ws.surface.screen('ledger-plunger') }));
  console.log(`[D1] 44 px at 390×844, camera in on the board: ${JSON.stringify(tips)} ${JSON.stringify(sizes)}`);
  const p = (await screenOf(page, 'ledger-plunger')) as XY;
  let s0 = await stepNo(page);
  await page.touchscreen.tap(p.x, p.y);
  await until(page, async () => repaired(await tokens(page)), 120, 'repaired by a tap on the plunger', () => diag(page, p.x, p.y, 'touch', s0));
  await until(page, () => page.evaluate(() => (window as any).__bench.ws.world.machine('ledger').show === null), 600, 'the repair shown');
  const c = (await screenOf(page, 'ledger-crank')) as XY;
  s0 = await stepNo(page);
  await page.touchscreen.tap(c.x, c.y);
  await until(page, async () => bounced(await tokens(page)), 120, 'dealt by a tap on the crank', () => diag(page, c.x, c.y, 'touch', s0));
  expect(errors).toEqual([]);
  await ctx.close();
});

// NOT RIGHT YET (D1 hand-in): at the framing a control's keyboard focus brings (its station, the whole line) the crank
// and the plunger are about 10 px across on a phone and the board takes the finger. It needs the board framed close
// (the crates' camera that comes in on an opened crate, or Framings.of framing a board control where the board is).
/** Wait for the camera to come to rest (a look's ease is over). */
async function cameraStill(page: Page): Promise<void> {
  await frames(page, 4);
  await until(page, () => page.evaluate(() => !(window as any).__bench.ws.stage.camera.easing), 600, 'the camera at rest');
  await frames(page, 6);
}
const SHOTS = process.env.D1_SHOTS ?? '';

test('P4 D1: each control a 44 px fingertip at the framing the board\'s look gives (a double-tap on it), on the bench and on its tray, 390×844', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  // on its open crate's tray: the look takes in the crate's card, the board on the tray before it
  // (I2: its second half carries the board off its tray, the stand's other way for a thing: `?things=loose`)
  await page.goto(`${origin}/dev/bench/?things=loose`);
  await page.waitForFunction(() => (window as any).__handoff?.phase === 'live' && (window as any).__ready === true, null, { timeout: 0, polling: 100 });
  await page.evaluate(() => { const ws = (window as any).__bench.ws; ws.dispatch({ type: 'grab', id: 'crate-2', grip: ws.world.motion('crate-2').pose.p }); });
  await frames(page, 3);
  await page.evaluate(() => (window as any).__bench.ws.dispatch({ type: 'place', at: [3.15, 0, 2.05] }));
  await until(page, () => page.evaluate(() => (window as any).__bench.ws.world.holding() === null), 600, 'crate-2 set aside');
  await openLedgerCrate(page);
  await until(page, () => page.evaluate(() => (window as any).__bench.ws.world.machine('ledger').show === null && (window as any).__bench.ws.world.mode('ledger-board') === 'machine'), 900, 'the board on its tray, its show over');
  await page.evaluate(() => (window as any).__bench.ws.dispatch({ type: 'select', id: 'ledger-board' }));
  await cameraStill(page);
  const tray = { plunger: await fingertip(page, 'ledger-plunger'), crank: await fingertip(page, 'ledger-crank') };
  const traySizes = await page.evaluate(() => ({ crank: (window as any).__bench.ws.surface.screen('ledger-crank'), plunger: (window as any).__bench.ws.surface.screen('ledger-plunger') }));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/look-tray-390.png` });
  // out on the bench: the look takes in the board's own box
  await page.evaluate(() => { const ws = (window as any).__bench.ws; ws.dispatch({ type: 'grab', id: 'ledger-board', grip: ws.world.motion('ledger-board').pose.p }); });
  await frames(page, 3);
  await page.evaluate(() => (window as any).__bench.ws.dispatch({ type: 'place', at: [4.3, 0, 1.75] }));
  await until(page, () => page.evaluate(() => (window as any).__bench.ws.world.part('ledger-board').location.at === 'rest'), 900, 'the board on the bench');
  await page.evaluate(() => (window as any).__bench.ws.dispatch({ type: 'select', id: 'ledger-board' }));
  await cameraStill(page);
  const bench = { plunger: await fingertip(page, 'ledger-plunger'), crank: await fingertip(page, 'ledger-crank') };
  const benchSizes = await page.evaluate(() => ({ crank: (window as any).__bench.ws.surface.screen('ledger-crank'), plunger: (window as any).__bench.ws.surface.screen('ledger-plunger') }));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/look-bench-390.png` });
  console.log(`[D1] 44 px at 390×844 at the look's framing: tray ${JSON.stringify(tray)} ${JSON.stringify(traySizes)}; bench ${JSON.stringify(bench)} ${JSON.stringify(benchSizes)}`);
  expect(tray.plunger, 'plunger on the tray').toBe('ok');
  expect(tray.crank, 'crank on the tray').toBe('ok');
  expect(bench.plunger, 'plunger on the bench').toBe('ok');
  expect(bench.crank, 'crank on the bench').toBe('ok');
  await ctx.close();
});

/** The board on its open crate's tray, the camera in on it: what a mouse press takes at each point of a 15 × 9 grid over its top. */
async function boardPressMap(page: Page, query = ''): Promise<{ counts: Record<string, number>; rows: string[] }> {
  await page.setViewportSize({ width: 1440, height: 900 });
  // the board stays on its tray: the crate freed and opened, the board left where it comes out
  await page.goto(`${origin}/dev/bench/${query}`);
  await page.waitForFunction(() => (window as any).__handoff?.phase === 'live' && (window as any).__ready === true, null, { timeout: 0, polling: 100 });
  await page.evaluate(() => { const ws = (window as any).__bench.ws; ws.dispatch({ type: 'grab', id: 'crate-2', grip: ws.world.motion('crate-2').pose.p }); });
  await frames(page, 3);
  await page.evaluate(() => (window as any).__bench.ws.dispatch({ type: 'place', at: [3.15, 0, 2.05] }));
  await until(page, () => page.evaluate(() => (window as any).__bench.ws.world.holding() === null), 600, 'crate-2 set aside');
  await openLedgerCrate(page);
  await until(page, () => page.evaluate(() => (window as any).__bench.ws.world.machine('ledger').show === null && (window as any).__bench.ws.world.mode('ledger-board') === 'machine'), 900, 'the board on its tray, its show over');
  // the camera in on the board, as the crates' camera will be (its box about 400 px across)
  await page.evaluate(() => {
    const ws = (window as any).__bench.ws;
    const p = ws.world.motion('ledger-board').pose.p;
    ws.stage.camera.stationSize = 1.4;
    ws.stage.camera.setSubject(ws.stage.camera.subject);
    ws.stage.camera.cutTo({ focus: [p[0], p[1] + 0.06, p[2] - 0.02], zoom: 1 }, { hold: true });
  });
  await frames(page, 20);
  // a grid over the board's top (its own frame), each point projected and asked what a mouse press there takes
  const map = await page.evaluate(() => {
    const B = (window as any).__bench, ws = B.ws;
    const m = ws.world.motion('ledger-board').pose;
    const half = ws.world.halfExtents('ledger-board');
    const [qx, qy, qz, qw] = m.q as [number, number, number, number];
    const rot = (x: number, y: number, z: number): [number, number, number] => {
      const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
      return [ix * qw - iw * qx - iy * qz + iz * qy, iy * qw - iw * qy - iz * qx + ix * qz, iz * qw - iw * qz - ix * qy + iy * qx];
    };
    const code: Record<string, string> = { 'ledger-board': 'b', 'ledger-crank': 'K', 'ledger-plunger': 'P', 'crate-1-lid': 'L', 'crate-1': 'C', 'crate-1-plate': 'p' };
    const counts: Record<string, number> = {};
    const rows: string[] = [];
    for (let j = 0; j <= 8; j++) {
      let row = '';
      for (let i = 0; i <= 14; i++) {
        const o = rot(-half[0] + (2 * half[0] * i) / 14, half[1], -half[2] + (2 * half[2] * j) / 8);
        const s = B.project([m.p[0] + o[0], m.p[1] + o[1], m.p[2] + o[2]]);
        const id: string = ws.surface.at(s.x, s.y, 'mouse', null).id ?? '-';
        counts[id] = (counts[id] ?? 0) + 1;
        row += code[id] ?? (id === '-' ? '.' : '?');
      }
      rows.push(row);
    }
    return { counts, rows };
  });
  return map;
}

// (I2) these two on `?things=loose`, the way a thing is a part of its own (the rule they were written for); the shipped
// `fixed` way after them, where S6 round two made a press on a toy's body a press on its crate
test('P4 D1: a press at each point of the board\'s top on its open crate\'s tray: what takes it', async ({ page }) => {
  const map = await boardPressMap(page, '?things=loose');
  console.log(`[D1] a press over the board's top on its tray (b board, K crank, P plunger, L the crate's latch, C the crate, p its plate; back row first):\n${map.rows.join('\n')}\n${JSON.stringify(map.counts)}`);
  // What holds today (rewrite 8839671): the crank and the plunger take the presses over them, the latch none, the board
  // the middle and the front. NOT RIGHT YET: the crate's body takes the board's back (about two rows of nine): the open
  // lid and the card stand up behind the board, so the crate's pick box is the nearer along the ray there, and the
  // board is too big to win as a small thing inside it. A press there lifts the crate, which claps shut and stows the
  // board. The crates' round three (a thing on the tray wins over the crate) is to make that the board's: then
  // `crate-1` here goes to 0 (test.fixme below).
  test.info().annotations.push({ type: 'pick', description: JSON.stringify(map.counts) });
  expect(map.counts['crate-1-lid'] ?? 0, 'the latch never takes a press on the board').toBe(0);
  expect(map.counts['ledger-crank'] ?? 0).toBeGreaterThan(10);
  expect(map.counts['ledger-plunger'] ?? 0).toBeGreaterThan(5);
  expect(map.counts['ledger-board'] ?? 0).toBeGreaterThan(50);
  expect(map.rows.slice(3).join('').includes('C') ? map.rows.slice(3).join('').replace(/[^C]/g, '').length : 0, 'the crate takes nothing over the board\'s front six rows but the folded flag\'s end').toBeLessThanOrEqual(6);
});

test('(I2) things fixed: a press on the board\'s body on its tray is its crate\'s; its crank and plunger keep theirs; no latch', async ({ page }) => {
  const map = await boardPressMap(page);
  console.log(`[I2] a press over the board's top on its tray, things fixed:\n${map.rows.join('\n')}\n${JSON.stringify(map.counts)}`);
  expect(map.counts['crate-1-lid'] ?? 0, 'the latch').toBe(0);
  expect(map.counts['ledger-board'] ?? 0, 'the board\'s body is no target of its own').toBe(0);
  expect(map.counts['crate-1'] ?? 0, 'the board\'s body stands for its crate').toBeGreaterThan(50);
  expect(map.counts['ledger-crank'] ?? 0).toBeGreaterThan(10);
  expect(map.counts['ledger-plunger'] ?? 0).toBeGreaterThan(5);
});

test('P4 D1 / S5 round three: the crate\'s body takes no press on the board on its tray (a thing on the tray wins over the crate, its lid and its latch: view/picking.ts prefer)', async ({ page }) => {
  const map = await boardPressMap(page, '?things=loose');
  console.log(`[S5] a press over the board's top on its tray, the crate's body yielding:\n${map.rows.join('\n')}\n${JSON.stringify(map.counts)}`);
  expect(map.counts['crate-1-lid'] ?? 0, 'the latch').toBe(0);
  expect(map.counts['crate-1'] ?? 0, 'the crate\'s body').toBe(0);
  expect(map.counts['ledger-crank'] ?? 0).toBeGreaterThan(10);
  expect(map.counts['ledger-plunger'] ?? 0).toBeGreaterThan(5);
});

for (const [w, h] of [[1440, 900], [390, 844]] as const) {
  test(`P4 D1: the board on its tray at the look's framing, ${w}×${h}: through a deal and a repair the card and its plate stay clear (pictures); the plate and the crate take their presses; lifted off, the crate shuts (I2: no latch)`, async ({ browser }) => {
    const touch = w < 600;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(touch ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}) });
    const page = await ctx.newPage();
    await page.goto(`${origin}/dev/bench/`);
    await page.waitForFunction(() => (window as any).__handoff?.phase === 'live' && (window as any).__ready === true, null, { timeout: 0, polling: 100 });
    await page.evaluate(() => { const ws = (window as any).__bench.ws; ws.dispatch({ type: 'grab', id: 'crate-2', grip: ws.world.motion('crate-2').pose.p }); });
    await frames(page, 3);
    await page.evaluate(() => (window as any).__bench.ws.dispatch({ type: 'place', at: [3.15, 0, 2.05] }));
    await until(page, () => page.evaluate(() => (window as any).__bench.ws.world.holding() === null), 600, 'crate-2 set aside');
    await openLedgerCrate(page);
    await until(page, () => page.evaluate(() => (window as any).__bench.ws.world.machine('ledger').show === null && (window as any).__bench.ws.world.mode('ledger-board') === 'machine'), 900, 'the board on its tray, its show over');
    await page.evaluate(() => (window as any).__bench.ws.dispatch({ type: 'select', id: 'ledger-board' }));
    await cameraStill(page);
    const kind = touch ? 'touch' : 'mouse';
    const pickAt = (id: string) => page.evaluate(([id, kind]) => { const ws = (window as any).__bench.ws; const s = ws.surface.screen(id); return s ? { s, got: ws.surface.at(s.x, s.y, kind, null).id } : null; }, [id, kind] as const);
    const shot = async (name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/tray-${name}-${w}.png` }); };
    await shot('bounced');
    // a repair (the flag goes down, the tokens fly), then a deal (they fly again, the rubber one bounces, the flag snaps up)
    await page.evaluate(() => (window as any).__bench.ws.dispatch({ type: 'press', id: 'ledger-plunger' }));
    await frames(page, 40);
    await shot('repair-flying');
    await until(page, () => page.evaluate(() => (window as any).__bench.ws.world.machine('ledger').show === null), 600, 'the repair shown');
    await shot('repaired');
    await page.evaluate(() => (window as any).__bench.ws.dispatch({ type: 'press', id: 'ledger-crank' }));
    await frames(page, 70);
    await shot('deal-flying');
    await until(page, () => page.evaluate(() => (window as any).__bench.ws.world.machine('ledger').show === null), 600, 'the deal shown');
    await shot('flag-up');
    // the plate takes a press (asked of the input; not clicked: it opens the project's entry)
    const plate = await pickAt('crate-1-plate');
    expect(plate?.got, 'the plate takes a press at its middle').toBe('crate-1-plate');
    // (I2) no latch (the stand opens a crate): nothing on screen is one; the crate's body takes a press at its middle, and
    // lifted off the stand it shuts (the board goes in with it), as the latch once shut it
    const latch = await pickAt('crate-1-lid');
    const body = await pickAt('crate-1');
    console.log(`[D1] ${w}×${h} on the tray at the look: plate ${JSON.stringify(plate)} latch ${JSON.stringify(latch)} crate ${JSON.stringify(body)}`);
    expect(latch?.got ?? null, 'no latch takes a press').not.toBe('crate-1-lid');
    expect(body?.got, 'the crate takes a press at its middle').toBe('crate-1');
    await liftOff(page, 'crate-1');
    await until(page, () => page.evaluate(() => (window as any).__bench.ws.world.setting('crate-1', 'open') === false && (window as any).__bench.ws.world.mode('ledger-board') === 'gone'), 300, 'lifted off, the crate shut, the board in it');
    await ctx.close();
  });
}
