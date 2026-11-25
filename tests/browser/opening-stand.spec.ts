import { expect, test, type Browser, type CDPSession, type Page } from '@playwright/test';
import { gpuArgs } from '../../playwright.config.ts';
import { startDevServer, type DevServer } from '../../scripts/capture.ts';

// P4 S6, a prototype behind one switch (`?open=stand`): the opening stand by a real hand, at 1440×900 by mouse and at
// 390×844 by finger (CDP touch events, as bench-input). A crate carried to the stand and let go opens and the camera
// comes in; its thing's crank turns; FULL ENTRY opens the project's panel; lifted off, the crate shuts and the camera
// goes back out; thrown, it stays shut. And what the owner met: a crate caught and thrown and caught again, twenty
// times, fast: never opened, and the camera never came in for it. A map of what a press takes over the open crate on
// the stand: never the latch, the crate's body the crate's.

test.use({ channel: 'chrome', launchOptions: { args: gpuArgs } });
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
interface Hand {
  down(p: XY): Promise<void>;
  move(p: XY): Promise<void>;
  up(p: XY): Promise<void>;
}
function mouseHand(page: Page): Hand {
  return {
    async down(p) {
      await page.mouse.move(p.x, p.y);
      await page.waitForTimeout(40);
      await page.mouse.down();
    },
    move: (p) => page.mouse.move(p.x, p.y),
    up: async (p) => {
      await page.mouse.move(p.x, p.y);
      await page.mouse.up();
    },
  };
}
function fingerHand(cdp: CDPSession): Hand {
  const pt = (p: XY) => [{ x: Math.round(p.x), y: Math.round(p.y), id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  return {
    down: async (p) => void (await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(p) })),
    move: async (p) => void (await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(p) })),
    up: async () => void (await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })),
  };
}

const frameNo = (page: Page): Promise<number> => page.evaluate(() => (window as any).__bench.ws.driver.frames as number);
async function frames(page: Page, n = 6): Promise<void> {
  const f0 = await frameNo(page);
  await page.waitForFunction((f) => (window as any).__bench.ws.driver.frames >= f, f0 + n, { timeout: 0, polling: 30 });
}
async function until(page: Page, fn: () => Promise<boolean>, limit = 600, what = ''): Promise<void> {
  const f0 = await frameNo(page);
  for (;;) {
    if (await fn()) return;
    if ((await frameNo(page)) - f0 > limit) throw new Error(`not within ${limit} frames: ${what}`);
    await page.waitForTimeout(40);
  }
}
async function setUp(browser: Browser, kind: 'mouse' | 'touch', w: number, h: number, query = 'stand=c'): Promise<{ page: Page; hand: Hand; close: () => Promise<void> }> {
  // S6_FILM=<dir>: a film of each page (for the owner)
  const film = process.env['S6_FILM'];
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(kind === 'touch' ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}), ...(film ? { recordVideo: { dir: film, size: { width: w, height: h } } } : {}) });
  const page = await ctx.newPage();
  // the stage page itself (its panels are there); in development it reads the prototype's switches from the address
  await page.goto(`${origin}/?open=stand&${query}`);
  await page.waitForFunction(() => (window as any).__handoff?.phase === 'live' && !!(window as any).__handoff.workshop, null, { timeout: 0, polling: 100 });
  await page.waitForFunction(() => document.querySelectorAll('#controls button[data-panel]').length >= 3, null, { timeout: 60_000 });
  // the dev bench's two helpers, on the stage page: the workshop, and a world point on screen (CSS px)
  await page.evaluate(() => {
    const h = (window as any).__handoff, ws = h.workshop;
    (window as any).__bench = {
      ws,
      project(p: number[]) {
        const cv: HTMLCanvasElement = h.canvas ?? document.querySelector('canvas');
        const r = cv.getBoundingClientRect(), s = ws.stage.camera.worldToScreen({ x: p[0], y: p[1], z: p[2] });
        return { x: r.left + ((s.x + 1) / 2) * r.width, y: r.top + ((1 - s.y) / 2) * r.height };
      },
    };
    // the trace (round two): every crate, look and hand event with the step, the crate's pose, who holds what; and,
    // for a crate named in __watch, its pose every frame with the robots' (the last 600 lines)
    const T: string[] = ((window as any).__trace = []);
    const f3 = (v: number[] | undefined) => (v ? v.map((x) => x.toFixed(3)).join(',') : '-');
    ws.onFrame((f: { events: { type: string; id?: string; crate?: string; part?: string; target?: string; cause?: unknown; why?: string }[] }) => {
      const w = ws.world;
      for (const e of f.events) {
        if (!/crate|look|grab|releas|rest|taken|caught|thrown|select|press|hit/.test(e.type)) continue;
        const id = e.crate ?? e.part ?? e.id ?? e.target ?? '';
        T.push(`${w.step} ${e.type} ${id}${e.why ? ` why=${e.why}` : ''} at ${f3(w.motion(id)?.pose.p)} mode ${w.mode(id) ?? '-'} held ${w.holding()?.id ?? '-'} look ${ws.stage.camera.lookId ?? '-'}`);
      }
      const wid = (window as any).__watch;
      if (wid) T.push(`${w.step} . ${wid} ${f3(w.motion(wid)?.pose.p)} q ${f3(w.motion(wid)?.pose.q)} ${w.mode(wid)} open ${w.setting(wid, 'open')} | fetch ${f3(w.motion('fetch')?.pose.p)} revert ${f3(w.motion('revert')?.pose.p)}`);
      if (T.length > 600) T.splice(0, T.length - 600);
    });
  });
  const hand = kind === 'mouse' ? mouseHand(page) : fingerHand(await ctx.newCDPSession(page));
  return { page, hand, close: () => ctx.close() };
}
const screen = (page: Page, id: string): Promise<(XY & { r: number }) | null> => page.evaluate((id) => (window as any).__bench.ws.surface.screen(id), id);
/** A world point on screen (CSS px). */
const project = (page: Page, p: number[]): Promise<XY> => page.evaluate((p) => (window as any).__bench.project(p), p);
const isOpen = (page: Page, id: string): Promise<boolean> => page.evaluate((id) => (window as any).__bench.ws.world.setting(id, 'open') === true, id);
const where = (page: Page, id: string): Promise<number[]> => page.evaluate((id) => (window as any).__bench.ws.world.motion(id).pose.p as number[], id);
const held = (page: Page): Promise<string | null> => page.evaluate(() => (window as any).__bench.ws.world.holding()?.id ?? null);
const look = (page: Page): Promise<{ look: unknown; easing: boolean }> =>
  page.evaluate(() => {
    const c = (window as any).__bench.ws.stage.camera;
    return { look: c.lookId ?? null, easing: c.easing };
  });
const trace = (page: Page): Promise<string[]> => page.evaluate(() => (window as any).__trace as string[]);
const standTop = (page: Page): Promise<number[]> => page.evaluate(() => (window as any).__bench.ws.world.scene.mouths.find((x: any) => x.id === 'opening-stand').drop as number[]);
/** The stand and `id` both in view, at a station's distance (as a visitor brings them, by panning). */
const frameWith = async (page: Page, id: string, zoom: number): Promise<void> => {
  await page.evaluate(
    ([id, zoom]) => {
      const ws = (window as any).__bench.ws, m = ws.world.scene.mouths.find((x: any) => x.id === 'opening-stand');
      const c = ws.world.motion(id).pose.p;
      ws.stage.camera.cutTo({ focus: [(m.drop[0] + c[0]) / 2, 0.4, (m.drop[2] + c[2]) / 2], zoom });
    },
    [id, zoom] as const,
  );
  await frames(page, 10);
};

/**
 * Carry `id` by a real hand until it hangs over the world point `to`, and let go. A press on it, a drag toward `to`'s
 * place on screen, then small corrections while it is held (the hand carries it at a height over what is under it, so
 * the point under the cursor is not the point it hangs over), still a moment (set down, not thrown), then up.
 */
async function carry(page: Page, hand: Hand, id: string, to: number[]): Promise<string> {
  const from = (await screen(page, id))!;
  let cur: XY = { x: from.x, y: from.y };
  await hand.down(cur);
  await frames(page, 4);
  const goal = await project(page, to);
  for (let i = 1; i <= 16; i++) {
    cur = { x: from.x + ((goal.x - from.x) * i) / 16, y: from.y + ((goal.y - from.y) * i) / 16 };
    await hand.move(cur);
    await frames(page, 1);
  }
  if ((await held(page)) !== id) {
    await hand.up(cur);
    return `not held: ${String(await held(page))}`;
  }
  let err = 9;
  for (let k = 0; k < 16; k++) {
    await frames(page, 10);
    const q = await where(page, id);
    err = Math.hypot(q[0]! - to[0]!, q[2]! - to[2]!);
    if (err < 0.05) break;
    const a = await project(page, q);
    const b = await project(page, [to[0]!, q[1]!, to[2]!]);
    cur = { x: cur.x + (b.x - a.x) * 0.8, y: cur.y + (b.y - a.y) * 0.8 };
    await hand.move(cur);
  }
  await frames(page, 30);
  await hand.up(cur);
  return `let go ${err.toFixed(3)} from the mark`;
}

for (const [kind, w, h] of [['mouse', 1440, 900], ['touch', 390, 844]] as const) {
  test(`P4 S6 (${kind}, ${w}×${h}): carried to the stand a crate opens and the camera comes in; its crank turns; FULL ENTRY opens the entry; lifted off it shuts and the camera goes out; thrown it stays shut`, async ({ browser }) => {
    const { page: p, hand, close } = await setUp(browser, kind, w, h);
    // the ledger's crate, at the foot of the stack Fetch has made by the platen: crate-2 off it first (by hand)
    await frameWith(p, 'crate-1', kind === 'touch' ? 0.25 : 0.35);
    const top = await standTop(p);
    // (round two) to the open bench left of the stack, clear of the platen's plinth (round one aimed it at the plinth's
    // edge: it slid down onto the stand, and crate-1 let go onto it rolled off the stand's front: the lead's failure)
    console.log(`[S6] ${kind}: crate-2 off the stack: ${await carry(p, hand, 'crate-2', [2.0, 0, 2.6])}`);
    await frames(p, 60);
    const C = 'crate-1';
    await p.evaluate((C) => ((window as any).__watch = C), C);
    console.log(`[S6] ${kind}: onto the stand: ${await carry(p, hand, C, [top[0]!, top[1]!, top[2]!])}`);
    await until(p, () => isOpen(p, C), 300, 'the crate open on the stand').catch(async (e) => {
      console.log(`[S6] TRACE ${kind}:\n${(await trace(p)).join('\n')}`);
      throw new Error(`${String(e)} ${JSON.stringify({ at: await where(p, C), held: await held(p) })}`);
    });
    await until(p, async () => { const c = await look(p); return !c.easing && c.look !== null; }, 900, 'the camera in on the card');
    // the board on its tray: its crank turns (a drag round it)
    await until(p, () => p.evaluate(() => (window as any).__bench.ws.world.machine('ledger').show === null), 1800, 'the ledger shown');
    const k0 = await p.evaluate(() => JSON.stringify((window as any).__bench.ws.world.machine('ledger')));
    const kc = await screen(p, 'ledger-crank');
    expect(kc, 'the crank a target').not.toBeNull();
    const r = Math.max(14, kc!.r * 0.6);
    const ring: XY[] = Array.from({ length: 13 }, (_, i) => ({ x: kc!.x + r * Math.cos((i / 12) * 2 * Math.PI), y: kc!.y + r * Math.sin((i / 12) * 2 * Math.PI) }));
    await hand.down(ring[0]!);
    for (const q of ring.slice(1)) {
      await hand.move(q);
      await frames(p, 2);
    }
    await hand.up(ring[ring.length - 1]!);
    await frames(p, 30);
    const k1 = await p.evaluate(() => JSON.stringify((window as any).__bench.ws.world.machine('ledger')));
    expect(k1, 'the crank turned the ledger').not.toBe(k0);
    // FULL ENTRY: the project's panel
    await until(p, async () => (await screen(p, `${C}-plate`)) !== null, 300, 'the plate a target');
    const pl = (await screen(p, `${C}-plate`))!;
    await hand.down(pl);
    await frames(p, 2);
    await hand.up(pl);
    await until(p, async () => (await p.getByRole('dialog').count()) > 0, 300, "the entry's panel");
    await p.keyboard.press('Escape');
    await frames(p, 30);
    // lifted off: shut, the camera back out
    console.log(`[S6] ${kind}: off the stand: ${await carry(p, hand, C, [top[0]! - 1.25, 0, top[2]! + 0.1])}`);
    await until(p, async () => !(await isOpen(p, C)), 300, 'shut off the stand');
    await until(p, async () => (await look(p)).look === null, 300, 'the look let go');
    // thrown: it stays shut
    const cc = (await screen(p, C))!;
    await hand.down(cc);
    await hand.move({ x: cc.x - 30, y: cc.y - 20 });
    await hand.move({ x: cc.x - 70, y: cc.y - 50 });
    await hand.up({ x: cc.x - 90, y: cc.y - 60 });
    await frames(p, 120);
    expect(await isOpen(p, C)).toBe(false);
    await close();
  });

  // (round two) juggled away from the stand (it stands at b, on the bay at the back left): a crate that comes to rest on
  // the stand opens, a trick shot with a test of its own (tests/scenario/opening-stand.test.ts); twenty catches counted
  // (the tries it took are said: how many presses miss a crate in flight measures the machine's load, not the bench)
  test(`P4 S6 (${kind}, ${w}×${h}): a crate caught and thrown and caught again, twenty times, fast: never opened, the camera never came in`, async ({ browser }) => {
    const { page: p, hand, close } = await setUp(browser, kind, w, h, 'stand=b');
    const C = 'crate-2';
    await frameWith(p, C, kind === 'touch' ? 0.2 : 0.3);
    await p.evaluate(() => {
      const W = window as any, ws = W.__bench.ws;
      W.__s6 = { opened: 0, looks: 0 };
      setInterval(() => {
        for (const c of ['crate-1', 'crate-2', 'crate-3', 'crate-4']) if (ws.world.setting(c, 'open') === true) W.__s6.opened++;
        if (ws.stage.camera.lookId) W.__s6.looks++;
      }, 20);
    });
    let caught = 0;
    let tries = 0;
    const trail: string[] = [];
    for (let i = 0; caught < 20 && i < 60; i++) {
      tries++;
      // the camera kept on it (a visitor's eye follows what they throw)
      await p.evaluate((C) => {
        const ws = (window as any).__bench.ws, q = ws.world.motion(C).pose.p;
        ws.stage.camera.cutTo({ focus: [q[0], Math.max(0.4, q[1] * 0.5), q[2]], zoom: ws.stage.camera.zoom });
      }, C);
      await frames(p, 1);
      const c = await screen(p, C);
      if (!c) {
        await frames(p, 6);
        continue;
      }
      // caught where it is (in flight from the last throw, after the first) and flung up and across, fast
      await hand.down(c);
      const dx = i % 2 ? 1 : -1;
      await hand.move({ x: c.x + dx * 10, y: c.y - 10 });
      const got = (await held(p)) === C;
      if (got) caught++;
      else trail.push(`${i}: ${String(await held(p))} at ${JSON.stringify(await where(p, C))} pressed ${Math.round(c.x)},${Math.round(c.y)}`);
      // tossed up and a little across, and caught on the way down
      const f = kind === 'touch' ? 1 : 0.45; // a mouse's flick is quicker than a finger's: a smaller one
      await hand.move({ x: c.x + dx * 14 * f, y: c.y - 40 * f });
      await hand.up({ x: c.x + dx * 18 * f, y: c.y - 60 * f });
      await frames(p, 24);
    }
    await frames(p, 150);
    const r = await p.evaluate(() => (window as any).__s6);
    if (r.opened || r.looks) console.log(`[S6] TRACE ${kind} juggle:\n${(await trace(p)).filter((l) => !/ \. /.test(l)).join('\n')}`);
    console.log(`[S6] ${kind}: juggled, ${caught} caught in ${tries} tries; ${JSON.stringify(r)}\n${trail.join('\n')}`);
    expect(caught, 'caught and thrown twenty times').toBe(20);
    expect(r, `${kind}: never opened, never a look`).toEqual({ opened: 0, looks: 0 });
    await close();
  });
}

test('P4 S6: a press at each point over the open crate on the stand takes its controls, its plate or the crate: never the latch', async ({ browser }) => {
  const { page, close } = await setUp(browser, 'mouse', 1440, 900);
  await page.evaluate(() => {
    const ws = (window as any).__bench.ws, w = ws.world;
    // crate-2 off the ledger's crate (by intents: the hand is tested above), crate-1 set down on the stand
    ws.dispatch({ type: 'grab', id: 'crate-2', grip: w.motion('crate-2').pose.p });
    ws.advance(6);
    ws.dispatch({ type: 'place', at: [2.9, 0, 1.0] });
    ws.advance(90);
    ws.dispatch({ type: 'grab', id: 'crate-1', grip: w.motion('crate-1').pose.p });
    ws.advance(6);
    ws.dispatch({ type: 'place', at: 'opening-stand' });
  });
  await until(page, () => isOpen(page, 'crate-1'), 900, 'crate-1 open on the stand');
  await until(page, () => page.evaluate(() => { const w = (window as any).__bench.ws.world; return w.machine('ledger').show === null && w.mode('ledger-board') === 'machine'; }), 1800, 'the board on its tray');
  await until(page, async () => !(await look(page)).easing, 600, 'the camera at rest');
  await page.screenshot({ path: 'shots/s5/s6-pressmap-1440.png' });
  const map = await page.evaluate(() => {
    const B = (window as any).__bench, ws = B.ws, w = ws.world;
    const m = w.motion('crate-1').pose, half = w.halfExtents('crate-1');
    const code: Record<string, string> = { 'ledger-board': 'b', 'ledger-crank': 'K', 'ledger-plunger': 'P', 'crate-1': 'C', 'crate-1-plate': 'p', 'crate-1-lid': 'L', 'opening-stand': 's' };
    const counts: Record<string, number> = {};
    const rows: string[] = [];
    // a grid over the crate's front, its open top, the board on its tray, the card and plate above it
    for (let j = 0; j <= 16; j++) {
      let row = '';
      for (let i = 0; i <= 20; i++) {
        const x = m.p[0] - half[0] * 1.2 + (2.4 * half[0] * i) / 20;
        const y = m.p[1] + half[1] * 3.2 - (half[1] * 4.4 * j) / 16;
        const s = B.project([x, y, m.p[2] + half[2]]);
        const id: string = ws.surface.at(s.x, s.y, 'mouse', null)?.id ?? '-';
        counts[id] = (counts[id] ?? 0) + 1;
        row += code[id] ?? (id === '-' ? '.' : '?');
      }
      rows.push(row);
    }
    return { rows, counts };
  });
  console.log(`[S6] a press over the open crate on the stand (K crank, P plunger, b board, p plate, C crate, L latch, s stand, ? other, . nothing; top row first):\n${map.rows.join('\n')}\n${JSON.stringify(map.counts)}`);
  expect(map.counts['crate-1-lid'] ?? 0, 'no latch').toBe(0);
  expect(map.counts['crate-1'] ?? 0, 'the crate takes its body').toBeGreaterThan(10);
  expect(map.counts['crate-1-plate'] ?? 0, 'the plate a target').toBeGreaterThan(0);
  // the board is never carried off its tray
  const b = await page.evaluate(() => {
    const ws = (window as any).__bench.ws, w = ws.world;
    ws.dispatch({ type: 'grab', id: 'ledger-board', grip: w.motion('ledger-board').pose.p });
    ws.advance(4);
    return { mode: w.mode('ledger-board'), held: w.holding()?.id ?? null };
  });
  expect(b).toEqual({ mode: 'machine', held: null });
  await close();
});

test('P4 S6: by the keys: a held crate is offered the stand as a place; set there it opens, and its plate and its thing’s controls join the list', async ({ browser }) => {
  const { page, close } = await setUp(browser, 'mouse', 1440, 900);
  const C = 'crate-3';
  await page.keyboard.press('?');
  await expect(page.locator('#controls')).toHaveClass(/open/);
  // the list's things: buttons, and (a project crate's plate) links
  const ids = () => page.locator('#controls .controls-stations [data-id], #controls .controls-stations [data-link]').evaluateAll((bs) => bs.map((b) => (b as HTMLElement).dataset['id'] ?? (b as HTMLElement).dataset['link']!));
  const before = await ids();
  await page.locator(`#controls button[data-id="${C}"]`).focus();
  await frames(page, 30);
  await page.keyboard.press('Enter');
  await expect(page.locator('.controls-hold-label')).toBeVisible();
  const dests = await page.locator('.controls-dests button').evaluateAll((bs) => bs.map((b) => ({ id: (b as HTMLElement).dataset['id'] ?? null, text: (b.textContent ?? '').trim() })));
  console.log(`[S6] the places offered a held crate: ${JSON.stringify(dests)}`);
  const stand = page.locator('.controls-dests button', { hasText: 'Opening stand' });
  await expect(stand).toHaveCount(1);
  await stand.focus();
  await frames(page, 20);
  await page.keyboard.press('Enter');
  await until(page, () => isOpen(page, C), 600, 'open on the stand, by the keys');
  await frames(page, 120);
  const after = await ids();
  const gained = after.filter((id) => !before.includes(id));
  console.log(`[S6] the list gained, with ${C} open on the stand: ${JSON.stringify(gained)}; it lost: ${JSON.stringify(before.filter((id) => !after.includes(id)))}`);
  expect(after).toContain(`${C}-plate`);
  expect(gained.length, 'its thing’s controls').toBeGreaterThan(1);
  expect(after.filter((id) => id.endsWith('-lid')), 'no latch in the list').toEqual([]);
  await close();
});

// (round two) while the camera is in on an open crate, only that crate, its plate, its thing and its thing's controls
// take a press. At c (at a, Fetch's lane passes in front and under load it carried the pile away: the test then meant nothing), the ledger's big crate set down in front
// of the stand: over t-components' crate, what a press takes with the look's rule and without it (the look let go for
// the moment of asking); nothing else takes a press; the dial's knob turns the dial; where something else stood in
// front, a press on the crate's body lifts it
for (const things of ['fixed', 'loose'] as const) {
  test(`P4 S6 round two (things ${things}): in the close view only the open crate, its plate, its thing and its controls take a press`, async ({ browser }) => {
    const { page: p, hand, close } = await setUp(browser, 'mouse', 1440, 900, `stand=c${things === 'loose' ? '&things=loose' : ''}`);
    // crate-2 off the stack, then crate-1 (the big one) in front of the stand and the other two piled on it, a stack as
    // tall as Fetch carrying a crate (by intents: the hand is tested above)
    for (const [id, at] of [['crate-2', [2.0, 0, 2.6]], ['crate-1', [4.15, 0, 2.92]], ['crate-2', [4.15, 0.8, 2.92]], ['crate-4', [4.15, 1.3, 2.92]]] as const) {
      await p.evaluate(([id]) => {
        const ws = (window as any).__bench.ws, w = ws.world;
        ws.dispatch({ type: 'grab', id, grip: w.motion(id).pose.p });
      }, [id] as const);
      await frames(p, 6);
      await p.evaluate(([at]) => (window as any).__bench.ws.dispatch({ type: 'place', at }), [at] as const);
      await frames(p, 120);
    }
    const C = 'crate-3';
    await frameWith(p, C, 0.35);
    const top = await standTop(p);
    console.log(`[S6] lock (${things}): crate-1 at ${JSON.stringify(await where(p, 'crate-1'))}; onto the stand: ${await carry(p, hand, C, [top[0]!, top[1]!, top[2]!])}`);
    await until(p, () => isOpen(p, C), 300, 'open on the stand');
    await until(p, async () => { const c = await look(p); return !c.easing && c.look !== null; }, 900, 'the camera in');
    await frames(p, 30);
    await p.screenshot({ path: `shots/s5/s6-lock-${things}-1440.png` });
    const knob = (await screen(p, 'paint-dial-knob'))!;
    const box = (await screen(p, C))!;
    const grid = await p.evaluate(([b]) => {
      const ws = (window as any).__bench.ws, cam = ws.stage.camera;
      const out: { x: number; y: number; with: string; without: string }[] = [];
      for (let j = 0; j <= 10; j++) for (let i = 0; i <= 10; i++) {
        const x = b.x - b.r + (2 * b.r * i) / 10, y = b.y - b.r + (2 * b.r * j) / 10;
        const w1: string = ws.surface.at(x, y, 'mouse', null)?.id ?? '-';
        const lk = cam.look;
        cam.look = null;
        const w0: string = ws.surface.at(x, y, 'mouse', null)?.id ?? '-';
        cam.look = lk;
        out.push({ x, y, with: w1, without: w0 });
      }
      return out;
    }, [box] as const);
    const tally = (k: 'with' | 'without') => grid.reduce<Record<string, number>>((a, g) => ((a[g[k]] = (a[g[k]] ?? 0) + 1), a), {});
    console.log(`[S6] lock (${things}): over t-components, with the rule ${JSON.stringify(tally('with'))}; without ${JSON.stringify(tally('without'))}`);
    const mine = new Set([C, `${C}-plate`, `${C}-card`, 'paint-dial', 'paint-dial-knob', '-']);
    expect(grid.filter((g) => !mine.has(g.with)).map((g) => g.with), 'nothing else takes a press').toEqual([]);
    // where something else stood in front (without the rule it took the press): a press there lifts t-components
    const through = grid.find((g) => g.with === C && g.without !== C) ?? null;
    console.log(`[S6] lock (${things}): a point where something else stood in front: ${JSON.stringify(through)}`);
    if (through) {
      await hand.down(through);
      await hand.move({ x: through.x, y: through.y - 40 });
      await frames(p, 6);
      const h = await held(p);
      await hand.up({ x: through.x, y: through.y - 40 });
      expect(h, 'a press on its body through what stands in front lifts t-components').toBe(C);
      // lifted, it shut; set back on the stand it opens again (the hand's own way back in). (With things loose its dial
      // stays where it lay when the crate is lifted, on the deck: set back on it the crate does not open; said, not fixed)
      if (things === 'loose') {
        await close();
        return;
      }
      console.log(`[S6] lock (${things}): back onto the stand: ${await carry(p, hand, C, [top[0]!, top[1]!, top[2]!])}`);
      await until(p, () => isOpen(p, C), 300, 'open on the stand again');
      await until(p, async () => { const c = await look(p); return !c.easing && c.look !== null; }, 900, 'the camera in again');
    }
    expect(through, 'something stood in front of the crate (the test means something)').not.toBeNull();
    const knob1 = (await screen(p, 'paint-dial-knob'))!;
    // the knob: the dial turns
    const d0 = await p.evaluate(() => JSON.stringify((window as any).__bench.ws.world.machine('paint')));
    await hand.down(knob1);
    await frames(p, 2);
    await hand.up(knob1);
    await frames(p, 40);
    const d1 = await p.evaluate(() => JSON.stringify((window as any).__bench.ws.world.machine('paint')));
    expect(d1, 'the knob turned the dial').not.toBe(d0);
    await close();
  });
}

// (round two, the station candidates) a film of each answering a carried crate and opening one (only with S6_FILM: the
// owner's pictures, not a check)
for (const look of [1, 2] as const) {
  for (const [kind, w, h] of [['mouse', 1440, 900], ['touch', 390, 844]] as const) {
    test(`P4 S6 round two film: candidate ${look} at ${w}×${h}`, async ({ browser }) => {
      test.skip(!process.env['S6_FILM'], 'films only on request');
      const { page: p, hand, close } = await setUp(browser, kind, w, h, `stand=c&standLook=${look}`);
      await frameWith(p, 'crate-2', kind === 'touch' ? 0.3 : 0.45);
      await frames(p, 150); // idle a while: its beat
      const top = await standTop(p);
      // carried slowly toward it from the stack (it answers), held near a moment, set down on it
      const from = (await screen(p, 'crate-2'))!;
      await hand.down(from);
      const mid = await project(p, [top[0]! - 1.4, 1.2, top[2]! + 0.2]);
      for (let i = 1; i <= 40; i++) {
        await hand.move({ x: from.x + ((mid.x - from.x) * i) / 40, y: from.y + ((mid.y - from.y) * i) / 40 });
        await frames(p, 2);
      }
      await frames(p, 60);
      await hand.up(mid);
      await frames(p, 30);
      console.log(`[S6] film ${look} ${w}: onto the stand: ${await carry(p, hand, 'crate-2', [top[0]!, top[1]!, top[2]!])}`);
      await until(p, () => isOpen(p, 'crate-2'), 600, 'open');
      await frames(p, 240);
      await close();
    });
  }
}

// (round four) the camera stays in while a crate lifted off the stand is in the hand: lifted, carried round inside the
// view and put back, three times, by a real hand: it opens again each time and the camera does not move at all
for (const [kind, w, h] of [['mouse', 1440, 900], ['touch', 390, 844]] as const) {
  test(`P4 S6 round four (${kind}, ${w}×${h}): lifted, carried round in the close view and put back three times: open again each time, the camera still`, async ({ browser }) => {
    const { page: p, hand, close } = await setUp(browser, kind, w, h);
    const C = 'crate-2';
    await frameWith(p, C, kind === 'touch' ? 0.25 : 0.35);
    const top = await standTop(p);
    console.log(`[S6] r4 ${kind}: onto the stand: ${await carry(p, hand, C, [top[0]!, top[1]!, top[2]!])}`);
    await until(p, () => isOpen(p, C), 300, 'open');
    await until(p, async () => { const c = await look(p); return !c.easing && c.look !== null; }, 900, 'the camera in');
    await frames(p, 30);
    // the camera's view, every frame from here
    await p.evaluate(() => {
      const W = window as any, cam = W.__bench.ws.stage.camera;
      const v0 = cam.view();
      W.__cam = { moved: 0, v0 };
      W.__bench.ws.onFrame(() => {
        const v = cam.view();
        const d = Math.hypot(v.focus[0] - v0.focus[0], v.focus[1] - v0.focus[1], v.focus[2] - v0.focus[2]) + Math.abs(v.zoom - v0.zoom);
        W.__cam.moved = Math.max(W.__cam.moved, d);
      });
    });
    const seen: string[] = [];
    for (let k = 0; k < 3; k++) {
      const c = (await screen(p, C))!;
      // (round to the left, up the screen: at c the dock's mouth is a hand's breadth to the stand's right, and a round that
      // way once carried the crate into it)
      const r = kind === 'touch' ? 40 : 70;
      await hand.down(c);
      for (let i = 1; i <= 16; i++) {
        const a = (i / 16) * 2 * Math.PI;
        await hand.move({ x: c.x - r * Math.sin(a), y: c.y - r * 0.6 * (1 - Math.cos(a)) });
        await frames(p, 2);
        if (i === 8) {
          expect(await held(p), `lifted (${k + 1})`).toBe(C);
          seen.push(`${k + 1}: held, open ${String(await isOpen(p, C))}`);
        }
      }
      // back over where it lay, by eye (held at its carrying height, the point under the finger is not where it hangs)
      let cur = { x: c.x, y: c.y };
      for (let n = 0; n < 16; n++) {
        await frames(p, 8);
        const q = await where(p, C);
        if (Math.hypot(q[0]! - top[0]!, q[2]! - top[2]!) < 0.05) break;
        const a0 = await project(p, q), b0 = await project(p, [top[0]!, q[1]!, top[2]!]);
        cur = { x: cur.x + (b0.x - a0.x) * 0.8, y: cur.y + (b0.y - a0.y) * 0.8 };
        await hand.move(cur);
      }
      await frames(p, 30);
      await hand.up(cur);
      await until(p, () => isOpen(p, C), 300, `open again (${k + 1})`).catch(async (e) => {
        const tr = (await trace(p)).filter((l) => !/ \. /.test(l)).slice(-25);
        throw new Error(`${String(e)} ${seen.join('; ')} at ${JSON.stringify(await where(p, C))} mode ${await p.evaluate((C) => (window as any).__bench.ws.world.mode(C), C)}\n${tr.join('\n')}`);
      });
      await frames(p, 60);
    }
    const r = await p.evaluate(() => (window as any).__cam.moved as number);
    console.log(`[S6] r4 ${kind}: the camera moved at most ${r.toFixed(4)} while the crate was lifted and put back three times (${seen.join('; ')})`);
    if (r >= 0.01) console.log(`[S6] r4 ${kind} TRACE:\n${(await trace(p)).filter((l) => !/ \. /.test(l) && !/hit/.test(l)).slice(-40).join('\n')}`);
    expect(r, 'the camera still').toBeLessThan(0.01);
    expect((await look(p)).look).not.toBeNull();
    await close();
  });
}
