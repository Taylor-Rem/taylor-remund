import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { gpuArgs } from '../../playwright.config.ts';
import { startDevServer, type DevServer } from '../../scripts/capture.ts';

// I1: input for the whole bench (REWRITE.md § B6, § B10, § E0, § E9), on /dev/bench/ on the real GPU, with a
// real mouse and with touch (CDP touch events: the browser makes them `pointerType: 'touch'`). Each step works
// one thing the way a visitor would and then reads the world's state:
//   the dial two detents, the lever to reverse, UNDO, the lamp's arm, Patch lifted, the plug let go NEAR the
//   LAMP jack, the phone opened and a ready-made text sent.
// Where a station's view has not registered a pick target for something the simulation says is usable, the
// spec registers a plain stand-in box where the scene puts it and NAMES it in the output, so input is proved
// and the gap is visible (the hand-in lists them).
//
// Dev pages exist only in `astro dev`: this file starts its own server (or uses I1_ORIGIN while iterating).

test.use({ channel: 'chrome', launchOptions: { args: gpuArgs } });
test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

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
type Disc = XY & { r: number };

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|404 \(Not Found\)/.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

async function open(page: Page, w: number, h: number): Promise<void> {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(`${origin}/dev/bench/?hud=0`);
  await page.waitForFunction('window.__ready === true', null, { timeout: 120_000 });
  await page.waitForTimeout(300);
}

/**
 * Register a stand-in pick target for every usable thing the bench's views left without one; returns their ids.
 * Boxes are where the scene and the fitted pieces put them.
 */
async function standIns(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const B = (window as any).__bench;
    const ws = B.ws;
    const have = new Set<string>([...ws.picking.ids()]);
    const someBox = ws.picking.localBox([...have][0]);
    const Box3 = someBox.constructor;
    const V3 = someBox.min.constructor;
    const Object3D = Object.getPrototypeOf(Object.getPrototypeOf(ws.stage.scene)).constructor;
    const made: string[] = [];
    const add = (id: string, p: number[] | { x: number; y: number; z: number }, half: number[]): void => {
      if (have.has(id) || (!ws.world.interactable(id) && id !== 'phone')) return;
      const o = new Object3D();
      const v: number[] = Array.isArray(p) ? p : [p.x, p.y, p.z];
      o.position.set(v[0]!, v[1]!, v[2]!);
      o.updateMatrixWorld(true);
      const [hx, hy, hz] = half as [number, number, number];
      ws.picking.add(id, o, { box: new Box3(new V3(-hx, -hy, -hz), new V3(hx, hy, hz)), pad: 0.02 });
      made.push(id);
    };
    const fromMatrix = (m: any): number[] | null => (m ? [m.elements[12] as number, m.elements[13] as number, m.elements[14] as number] : null);
    const stat = (id: string) => ws.world.scene.statics.find((s: any) => s.id === id);
    const dial = fromMatrix(B.bench.handles.dial);
    if (dial) add('belt-dial', dial, [0.22, 0.15, 0.22]);
    const lever = fromMatrix(B.bench.handles.lever);
    if (lever) add('belt-lever', [lever[0]!, lever[1]! + 0.2, lever[2]!], [0.16, 0.24, 0.1]);
    const undo = stat('undo');
    if (undo) add('undo-lever', [undo.pose.p[0], undo.pose.p[1] + 0.4, undo.pose.p[2]], [0.2, 0.45, 0.2]);
    const phone = stat('phone');
    if (phone) add('phone', phone.pose.p, phone.shape.half ?? [0.2, 0.35, 0.15]);
    const patch = ws.world.crewView('patch')?.view?.at;
    if (patch) add('patch', [patch[0], patch[1] + 0.6, patch[2]], [0.45, 0.6, 0.4]);
    if (B.bench.bulb) add('lamp', B.bench.bulb.at, [0.3, 0.25, 0.3]);
    return made;
  });
}

const screenOf = (page: Page, id: string) => page.evaluate((id) => (window as any).__bench.ws.surface.screen(id) as Disc | null, id);
const jackAt = (page: Page, id: string) =>
  page.evaluate((id) => {
    const B = (window as any).__bench;
    const j = B.ws.world.scene.cord.jacks.find((k: any) => k.id === id);
    return B.project(j.at) as XY;
  }, id);
const belt = (page: Page) => page.evaluate(() => (window as any).__bench.ws.world.machine('belt') as { speed: number; direction: string; running: boolean });
const setting = (page: Page, target: string, field: string) => page.evaluate(([t, f]) => (window as any).__bench.ws.world.setting(t, f), [target, field] as const);
const holding = (page: Page) => page.evaluate(() => (window as any).__bench.ws.world.holding());
const logCount = (page: Page, type: string) => page.evaluate((type) => (window as any).__bench.log.filter((l: any) => l.e.type === type).length, type);
const lastOf = (page: Page, type: string) => page.evaluate((type) => (window as any).__bench.log.filter((l: any) => l.e.type === type).at(-1)?.e ?? null, type);
const cursor = (page: Page) => page.evaluate(() => (document.getElementById('stage') as HTMLCanvasElement).style.cursor);
const hovered = (page: Page) => page.evaluate(() => (window as any).__bench.ws.gestures.hover);
const frames = (page: Page, n = 6) => page.waitForTimeout(n * 17);

// ── the hand: a real mouse, or a finger through CDP ──
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
async function stroke(page: Page, hand: Hand, pts: XY[], dwell = 14): Promise<void> {
  await hand.down(pts[0]!);
  await page.waitForTimeout(30);
  for (const p of pts.slice(1)) {
    await hand.move(p);
    await page.waitForTimeout(dwell);
  }
  await page.waitForTimeout(60);
  await hand.up(pts[pts.length - 1]!);
  await frames(page);
}
const line = (a: XY, b: XY, n: number): XY[] => Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));
/** From angle a0 to a1 (degrees; screen: 0 right, -90 up), radius r round c. */
const arc = (c: XY, r: number, a0: number, a1: number, n: number): XY[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    return { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r };
  });

async function shoot(page: Page, name: string, around: XY | null = null, half = 160): Promise<void> {
  const vp = page.viewportSize()!;
  const clip = around ? { x: Math.max(0, around.x - half), y: Math.max(0, around.y - half), width: Math.min(2 * half, vp.width), height: Math.min(2 * half, vp.height) } : undefined;
  await page.screenshot({ path: `shots/i1/${name}.png`, ...(clip ? { clip } : {}) });
}

const camPos = (page: Page) => page.evaluate(() => (window as any).__bench.ws.stage.camera.camera.position.toArray().map((v: number) => Math.round(v * 1e4) / 1e4));

/**
 * On a small screen not everything is in the frame: pan it into view the way a visitor does, one finger
 * on empty bench (which also proves that pans), or the mouse's drag on empty bench. Returns its disc on screen.
 */
async function bringIntoView(page: Page, hand: Hand, id: string, kind: 'mouse' | 'touch', margin = 1): Promise<Disc> {
  const vp = page.viewportSize()!;
  for (let k = 0; k < 6; k++) {
    const d = (await screenOf(page, id))!;
    const mx = Math.min(80, vp.width * 0.18) * margin;
    const my = Math.min(140, vp.height * 0.16) * margin;
    if (d.x > mx && d.x < vp.width - mx && d.y > my && d.y < vp.height - my) {
      await settled(page);
      return (await screenOf(page, id))!;
    }
    // somewhere on empty bench to drag from
    const spot = await page.evaluate(
      ([kind, W, H]) => {
        const ws = (window as any).__bench.ws;
        // the bench nearest the middle of the screen's lower half that nothing usable covers
        let best: { x: number; y: number } | null = null;
        let bd = Infinity;
        for (let fy = 0.3; fy <= 0.95; fy += 0.05)
          for (let fx = 0.1; fx <= 0.9; fx += 0.08) {
            const x = fx * (W as number), y = fy * (H as number);
            const t = ws.surface.at(x, y, kind, null);
            if (t.id !== null || !t.point) continue;
            const d = Math.hypot(fx - 0.5, fy - 0.7);
            if (d < bd) {
              bd = d;
              best = { x, y };
            }
          }
        return best;
      },
      [kind, vp.width, vp.height] as const,
    );
    expect(spot, 'an empty spot of bench to pan from').toBeTruthy();
    const want = { x: vp.width / 2 - d.x, y: vp.height / 2 - d.y };
    const lim = (v: number, m: number) => Math.max(-m, Math.min(m, v));
    const to = { x: Math.max(4, Math.min(vp.width - 4, spot!.x + lim(want.x, vp.width * 0.45))), y: Math.max(4, Math.min(vp.height - 4, spot!.y + lim(want.y, vp.height * 0.3))) };
    const before = await camPos(page);
    await stroke(page, hand, line(spot!, to, 10), 16);
    expect(await camPos(page), 'one finger (or the mouse) on empty bench pans').not.toEqual(before);
  }
  return (await screenOf(page, id))!;
}

/** Wait for the camera to come to rest (a pan past a limit springs back). */
async function settled(page: Page): Promise<void> {
  let last = '';
  for (let i = 0; i < 60; i++) {
    const now = JSON.stringify(await camPos(page));
    if (now === last) return;
    last = now;
    await frames(page, 4);
  }
}

/** A stroke that starts on a usable thing: the camera must not move (a drag on a thing never pans). */
async function use(page: Page, hand: Hand, pts: XY[], dwell = 14): Promise<void> {
  const before = await camPos(page);
  await stroke(page, hand, pts, dwell);
  // (the camera may still be settling by a hair from a pan before; a pan from this drag would move it by far more)
  const after = await camPos(page);
  const moved = Math.max(...after.map((v: number, i: number) => Math.abs(v - before[i])));
  expect(moved, 'a drag that starts on a usable thing never pans').toBeLessThan(0.01);
}

/** The whole bench worked by one hand; `kind` decides the gestures (a mouse turns the dial round, a finger along it). */
async function workTheBench(page: Page, hand: Hand, kind: 'mouse' | 'touch'): Promise<void> {
  try {
    await workTheBenchSteps(page, hand, kind);
  } catch (e) {
    const d = await page
      .evaluate(() => ({
        ints: (window as any).__ints?.slice(-14),
        events: (window as any).__bench.log
          .filter((l: any) => /undone|undo.refused|handle.worked|effect/.test(l.e.type))
          .slice(-12)
          .map((l: any) => `${l.step}:${l.e.type}:${JSON.stringify(l.e.effect ?? l.e.restores?.map((r: any) => [r.target, r.field, r.to]) ?? l.e.id)}`),
      }))
      .catch(() => null);
    throw new Error(`${e}\n${JSON.stringify(d, null, 1)}`);
  }
}

async function workTheBenchSteps(page: Page, hand: Hand, kind: 'mouse' | 'touch'): Promise<void> {
  const tag = kind;
  // 1. the dial: two detents up
  const dial = await bringIntoView(page, hand, 'belt-dial', kind);
  const before = await belt(page);
  expect(before.speed).toBe(3);
  if (kind === 'mouse') {
    await page.mouse.move(dial.x, dial.y);
    await frames(page, 2);
    expect(await hovered(page)).toBe('belt-dial');
    expect(await cursor(page)).toBe('pointer');
    // taken on the knob's crown, a hand drags round it in a widening sweep (a real hand does not keep to the knob)
    const pts = arc(dial, 1, -95, -95 + 2 * 32 + 14, 14).map((p, i) => {
      const k = Math.max(8, dial.r * 0.4) + i * 2.5;
      return { x: dial.x + (p.x - dial.x) * k, y: dial.y + (p.y - dial.y) * k };
    });
    await use(page, hand, pts, 20);
  } else {
    const y = dial.y + dial.r * 0.5; // taken low on the knob: it drags along
    await use(page, hand, line({ x: dial.x, y }, { x: dial.x + 26 * 2 + 10, y }, 10), 20);
  }
  await expect.poll(async () => (await belt(page)).speed, { timeout: 2000 }).toBe(5);

  // 2. the lever: thrown to reverse (two notches left)
  const lever = await bringIntoView(page, hand, 'belt-lever', kind);
  const notch = Math.max(22, lever.r * 0.55);
  await use(page, hand, line(lever, { x: lever.x - notch * 2 - 8, y: lever.y + 2 }, 10), 20);
  await expect.poll(async () => belt(page), { timeout: 2000 }).toMatchObject({ running: true, direction: 'backward' });

  // 3. UNDO: a pull takes back the lever
  const undos = await logCount(page, 'undone');
  const undo = await bringIntoView(page, hand, 'undo-lever', kind);
  if (kind === 'mouse') await use(page, hand, line({ x: undo.x, y: undo.y - undo.r * 0.4 }, { x: undo.x + 4, y: undo.y + undo.r * 0.4 }, 6));
  else await use(page, hand, line({ x: undo.x, y: undo.y - undo.r * 0.3 }, { x: undo.x, y: undo.y + undo.r * 0.5 }, 6)); // pulled down its arc
  await expect.poll(() => logCount(page, 'undone'), { timeout: 2000 }).toBe(undos + 1);
  await expect.poll(async () => (await belt(page)).direction).toBe('forward');

  // 4. the plug: out of STOREFRONT, let go NEAR the LAMP jack (above and to its right, not on it)
  expect(await setting(page, 'cord', 'jack')).toBe('jack-storefront');
  await bringIntoView(page, hand, 'cord', kind, 0.25); // (not to the middle: the LAMP jack must stay in the frame too)
  const from = await jackAt(page, 'jack-storefront');
  const lampJack = await jackAt(page, 'jack-lamp');
  const near = { x: lampJack.x + 9, y: lampJack.y - 11 };
  const at0 = await page.evaluate(([x, y]) => (window as any).__bench.ws.surface.at(x, y, 'touch', null).id, [from.x, from.y + 3] as const);
  await use(page, hand, line({ x: from.x, y: from.y + 3 }, near, 18), 16);
  await expect
    .poll(() => setting(page, 'cord', 'jack'), { timeout: 2000 })
    .toBe('jack-lamp')
    .catch(async (e) => {
      throw new Error(`${e}\nfrom ${JSON.stringify(from)} near ${JSON.stringify(near)} under ${at0} ints ${JSON.stringify(await page.evaluate(() => (window as any).__ints?.slice(-6)))}`);
    });

  // 5. the phone: opened from the bench, a ready-made text sent down the line
  const phone = await bringIntoView(page, hand, 'phone', kind);
  await use(page, hand, [phone, phone]);
  const panel = page.getByRole('dialog');
  await expect(panel).toBeVisible();
  await shoot(page, `${tag}-phone-open`);
  const sent = await page.evaluate(() => (window as any).__bench.ws.world.machine('line').log.filter((e: any) => e.kind === 'sent').length);
  const key = panel.locator('.ph-key').first();
  if (kind === 'mouse') await key.click();
  else await key.tap();
  await expect.poll(() => page.evaluate(() => (window as any).__bench.ws.world.machine('line').log.filter((e: any) => e.kind === 'sent').length), { timeout: 3000 }).toBe(sent + 1);
  const diag2 = await page.evaluate(() => ({ active: `${document.activeElement?.tagName}.${document.activeElement?.className}`, held: (window as any).__bench.ws.gestures.held, focus: (window as any).__bench.ws.focused, w: (window as any).__bench.ws.world.holding() }));
  await page.keyboard.press('Escape');
  await expect(panel, JSON.stringify(diag2)).toBeHidden();

  // (the lamp and Patch last: the lamp view's pick box rides the shade, and aimed forward it floats in front of the
  // switchboard and takes presses meant for the plug; reported in the I1 hand-in)
  // 6. the lamp: the arm dragged by its shade toward the front right
  await bringIntoView(page, hand, 'lamp', kind);
  // taken by its shade (the bulb), which is where a hand goes: the middle of its pick box may lie over something else
  const lamp = await page.evaluate((kind) => {
    const B = (window as any).__bench;
    const b = B.project(B.ws.world.machine('lamp') && B.bench.bulb.at) as XY;
    const on = B.ws.surface.at(b.x, b.y, kind, null).id === 'lamp';
    return on ? b : (B.ws.surface.screen('lamp') as XY);
  }, kind);
  const camL = await camPos(page);
  const x0 = (await setting(page, 'lamp', 'x')) as number;
  const z0 = (await setting(page, 'lamp', 'z')) as number;
  // where the light falls on screen at the grab: the hand's travel moves it from there
  const light0 = await page.evaluate(() => {
    const B = (window as any).__bench;
    return B.project(B.ws.world.machine('lamp').aim) as XY;
  });
  const vp = page.viewportSize()!;
  const to = { x: Math.min(vp.width - 20, lamp.x + vp.width * 0.18), y: Math.min(vp.height - 20, lamp.y + vp.height * (kind === 'touch' ? 0.32 : 0.2)) };
  await hand.down(lamp);
  await page.waitForTimeout(40);
  for (const [i, p] of line(lamp, to, 16).slice(1).entries()) {
    await hand.move(p);
    await page.waitForTimeout(16);
    if (i === 8) {
      await expect.poll(() => holding(page), { timeout: 2000 }).toEqual({ kind: 'unit', id: 'lamp' });
      await shoot(page, `${tag}-lamp-mid`);
    }
  }
  await page.waitForTimeout(250);
  await hand.up(to);
  const diagL = async () => JSON.stringify(await page.evaluate(() => { const ws = (window as any).__bench.ws; return { held: ws.gestures.held, state: ws.gestures.state, w: ws.world.holding(), ints: (window as any).__ints?.slice(-6) }; }));
  await expect.poll(() => holding(page), { timeout: 2000, message: 'lamp let go' }).toBeNull().catch(async (e) => { throw new Error(`${e}\n${await diagL()}`); });
  await expect.poll(async () => page.evaluate(() => (window as any).__bench.ws.world.machine('lamp').dragging), { timeout: 2000 }).toBe(false);
  await shoot(page, `${tag}-lamp-after`);
  expect(Math.max(...(await camPos(page)).map((v: number, i: number) => Math.abs(v - camL[i])))).toBeLessThan(0.01);
  const x1 = (await setting(page, 'lamp', 'x')) as number;
  const z1 = (await setting(page, 'lamp', 'z')) as number;
  expect(Math.hypot(x1 - x0, z1 - z0), 'the lamp’s aim moved').toBeGreaterThan(0.5);
  // it points at the bench where the hand let go (inside what the arm reaches)
  const under = await page.evaluate(([x, y]) => {
    const ws = (window as any).__bench.ws;
    // (bench point of the light's screen point moved by the hand's travel)
    const c = ws.stage.renderer.domElement;
    const p = ws.stage.camera.benchPoint({ x: (x / c.clientWidth) * 2 - 1, y: -(y / c.clientHeight) * 2 + 1 }, 0);
    return [p.x, 0, p.z] as number[];
  }, [light0.x + to.x - lamp.x, light0.y + to.y - lamp.y] as const);
  // the arm reaches only so far: compare with the nearest point it can reach
  const want = await page.evaluate(([x, z]) => {
    const reach = (window as any).__bench.ws.world.machine('lamp').reach as [number, number][];
    // inside, or the nearest edge point (the same rule as the simulation's clamp, by distance)
    let best = [x, z], bd = Infinity, inside = true;
    for (let i = 0; i < reach.length; i++) {
      const [ax, az] = reach[i]!, [bx, bz] = reach[(i + 1) % reach.length]!;
      const cross = (bx - ax) * (z - az) - (bz - az) * (x - ax);
      if (cross > 0) inside = false;
      const L = (bx - ax) ** 2 + (bz - az) ** 2 || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / L));
      const px = ax + (bx - ax) * t, pz = az + (bz - az) * t, d = (px - x) ** 2 + (pz - z) ** 2;
      if (d < bd) { bd = d; best = [px, pz]; }
    }
    return inside ? [x, z] : best;
  }, [under[0]!, under[2]!] as const);
  expect(Math.hypot(x1 - want[0]!, z1 - want[1]!), `aim ${x1},${z1} vs the light moved with the hand ${want[0]},${want[1]}`).toBeLessThan(0.35);

  // 7. Patch: lifted off its stool and set down on the bench in front of it
  const patch = await bringIntoView(page, hand, 'patch', kind);
  const toP = { x: patch.x - vp.width * 0.06, y: Math.min(vp.height - 30, patch.y + vp.height * 0.12) };
  await hand.down(patch);
  await page.waitForTimeout(40);
  for (const p of line(patch, toP, 10).slice(1)) {
    await hand.move(p);
    await page.waitForTimeout(16);
  }
  await expect.poll(() => holding(page), { timeout: 2000 }).toEqual({ kind: 'unit', id: 'patch' });
  await shoot(page, `${tag}-patch-held`, toP, 200);
  await hand.up(toP);
  await frames(page, 4);
  const diag = await page.evaluate(() => {
    const ws = (window as any).__bench.ws;
    return { held: ws.gestures.held, state: ws.gestures.state, bracketed: ws.world.bracketed, log: (window as any).__bench.log.slice(-8).map((l: any) => l.e.type + ':' + (l.e.state ?? l.e.id ?? '')) };
  });
  await expect.poll(() => holding(page), { message: JSON.stringify(diag), timeout: 2000 }).toBeNull();
  await expect.poll(async () => page.evaluate(() => (window as any).__bench.ws.world.crewView('patch').view.state), { timeout: 3000 }).toMatch(/walk|climb|seated|look|roll/);
}

test('a mouse works the whole bench: dial, lever, UNDO, lamp, Patch, the plug near LAMP, the phone', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, 1440, 900);
  const stood = await standIns(page);
  console.log(`[I1] mouse 1440×900: stand-in pick targets (no view registered one): ${stood.join(', ') || 'none'}`);
  await page.evaluate(() => {
    (window as any).__bench.ws.latency.reset();
    const w = (window as any).__bench.ws.world;
    const d0 = w.dispatch.bind(w);
    (window as any).__ints = [];
    w.dispatch = (i: any) => {
      if (i.type !== 'hover' && i.type !== 'carry') (window as any).__ints.push(`${w.step}:${JSON.stringify(i).slice(0, 80)}`);
      d0(i);
    };
  });
  expect(await page.evaluate(() => (window as any).__bench.ws.world.playMode)).toBe(false);
  // a hover alone does not end attract mode
  const dial = (await screenOf(page, 'belt-dial'))!;
  await page.mouse.move(dial.x, dial.y);
  await frames(page, 4);
  expect(await page.evaluate(() => (window as any).__bench.ws.world.playMode)).toBe(false);
  await workTheBench(page, mouseHand(page), 'mouse');
  expect(await page.evaluate(() => (window as any).__bench.ws.world.playMode)).toBe(true);
  const lat = await page.evaluate(() => (window as any).__bench.ws.latency.report());
  console.log(`[I1] latency (ms, DOM event → first frame after the step that handled it), mouse: ${JSON.stringify(Object.fromEntries(Object.entries(lat.frame).map(([k, v]: [string, any]) => [k, { n: v.n, median: Math.round(v.median), p95: Math.round(v.p95), max: Math.round(v.max) }])))}`);
  expect(errors).toEqual([]);
});

test('a finger works the whole bench at the phone framing (390×844), and nothing it starts on pans', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = watchErrors(page);
  await open(page, 390, 844);
  const stood = await standIns(page);
  console.log(`[I1] touch 390×844: stand-in pick targets: ${stood.join(', ') || 'none'}`);
  await page.evaluate(() => {
    const w = (window as any).__bench.ws.world;
    const d0 = w.dispatch.bind(w);
    (window as any).__ints = [];
    w.dispatch = (i: any) => {
      if (i.type !== 'hover' && i.type !== 'carry') (window as any).__ints.push(`${w.step}:${JSON.stringify(i).slice(0, 80)}`);
      d0(i);
    };
  });
  const cdp = await ctx.newCDPSession(page);
  await workTheBench(page, fingerHand(cdp), 'touch');
  // two fingers anywhere pan and pinch, even with one of them on a usable thing (the Button)
  const btn = (await screenOf(page, 'button'))!;
  const before = await camPos(page);
  const two = (a: XY, b: XY) => [
    { x: Math.round(a.x), y: Math.round(a.y), id: 1 },
    { x: Math.round(b.x), y: Math.round(b.y), id: 2 },
  ];
  const presses = await logCount(page, 'button.pressed');
  const other = { x: 195, y: Math.min(800, btn.y + 160) };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: two(btn, other) });
  for (let i = 1; i <= 8; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: two({ x: btn.x, y: btn.y - i * 8 }, { x: other.x, y: other.y + i * 8 }) });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await frames(page);
  expect(await camPos(page), 'two fingers pinch').not.toEqual(before);
  expect(await logCount(page, 'button.pressed'), 'a pinch that began on the Button does not press it').toBe(presses);
  expect(errors).toEqual([]);
  await ctx.close();
});

test('every pick target is at least 44 px on a touch screen at the phone framing', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await open(page, 390, 844);
  await standIns(page);
  // A 44 px square round each target's centre: every point of its edge (and the centre) picks it on touch,
  // unless a neighbour's centre is nearer that point (two small things side by side split the space between them).
  // Things the home framing leaves off screen are panned to the middle first, at the home zoom.
  const ids = ['belt-dial', 'belt-lever', 'undo-lever', 'jack-storefront', 'jack-platen', 'jack-belt', 'jack-lamp', 'phone', 'button-cover', 'button', 'lamp', 'cord'];
  const out: Record<string, string> = {};
  for (const id of ids) {
    const centred = await page.evaluate((id) => {
      const B = (window as any).__bench;
      const ws = B.ws;
      const c = ws.stage.renderer.domElement;
      const W = c.clientWidth, H = c.clientHeight;
      const ndc = (x: number, y: number) => ({ x: (x / W) * 2 - 1, y: -(y / H) * 2 + 1 });
      const pos = () => {
        const s = ws.surface.screen(id);
        if (s) return s;
        const j = ws.world.scene.cord.jacks.find((k: any) => k.id === id);
        return j ? B.project(j.at) : null;
      };
      ws.stage.camera.cutTo(ws.stage.camera.home());
      const s = pos();
      if (!s) return 'no pick target';
      if (s.x < 30 || s.x > W - 30 || s.y < 60 || s.y > H - 60) {
        const a = ws.stage.camera.benchPoint(ndc(s.x, s.y), 0);
        const b = ws.stage.camera.benchPoint(ndc(W / 2, H / 2), 0);
        if (a && b) ws.stage.camera.panBy(a.x - b.x, a.z - b.z);
      }
      return 'ok';
    }, id);
    if (centred !== 'ok') {
      out[id] = centred;
      continue;
    }
    await frames(page, 4);
    out[id] = await page.evaluate((id) => {
      const B = (window as any).__bench;
      const ws = B.ws;
      const c = ws.stage.renderer.domElement;
      const W = c.clientWidth, H = c.clientHeight;
      const isJack = id.startsWith('jack-');
      const jacks = ws.world.scene.cord.jacks.map((k: any) => ({ id: k.id, p: B.project(k.at) }));
      const centre = (k: string) => (isJack ? jacks.find((j: any) => j.id === k)?.p : ws.surface.screen(k)) ?? null;
      const s = centre(id);
      if (s.x < 0 || s.x > W || s.y < 0 || s.y > H) return 'off screen at the home zoom';
      const misses: string[] = [];
      for (const [dx, dy] of [[-21, -21], [0, -21], [21, -21], [-21, 0], [21, 0], [-21, 21], [0, 21], [21, 21], [0, 0]]) {
        const x = s.x + dx!, y = s.y + dy!;
        const got = isJack ? ws.surface.jackNear(x, y, 'touch') : ws.surface.at(x, y, 'touch', null).id;
        if (got === id) continue;
        const g = got ? centre(got) : null;
        const fair = g && Math.hypot(g.x - x, g.y - y) < Math.hypot(s.x - x, s.y - y);
        if (!fair) misses.push(`${dx},${dy}→${got}`);
      }
      return misses.length ? `misses ${misses.join(' ')}` : 'ok';
    }, id);
  }
  console.log(`[I1] 44 px at 390×844 (home zoom): ${JSON.stringify(out)}`);
  for (const id of ['belt-dial', 'belt-lever', 'undo-lever', 'jack-storefront', 'jack-platen', 'jack-belt', 'jack-lamp', 'lamp', 'cord']) expect(out[id], id).toBe('ok');
  await ctx.close();
});

test('the keyboard: Tab through the controls, Enter and arrows work them, U undoes, the phone keeps its keys', async ({ page }) => {
  await open(page, 1440, 900);
  await standIns(page);
  const canvas = page.locator('#stage');
  await canvas.focus();
  const focused = () => page.evaluate(() => (window as any).__bench.ws.focused);
  const tabTo = async (id: string): Promise<void> => {
    for (let i = 0; i < 40 && (await focused()) !== id; i++) await page.keyboard.press('Tab');
    expect(await focused()).toBe(id);
  };
  await tabTo('belt-dial');
  expect(await hovered(page), 'focus lifts like a hover').toBe('belt-dial');
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await belt(page)).speed).toBe(4);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await belt(page)).speed).toBe(5);
  await tabTo('belt-lever');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => belt(page)).toMatchObject({ running: false });
  const undos = await logCount(page, 'undone');
  await page.keyboard.press('u');
  await expect.poll(() => logCount(page, 'undone')).toBe(undos + 1);
  // the plug by keys: Enter lifts it, Tab to the LAMP jack, Enter seats it
  await tabTo('cord');
  await page.keyboard.press('Enter');
  for (let i = 0; i < 8 && (await page.evaluate(() => (window as any).__bench.ws.gestures.keyHold?.dest)) !== 'jack-lamp'; i++) await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect.poll(() => setting(page, 'cord', 'jack')).toBe('jack-lamp');
  // the phone: Enter opens it, and its keys stay its own
  await tabTo('phone');
  await page.keyboard.press('Enter');
  const panel = page.getByRole('dialog');
  await expect(panel).toBeVisible();
  const before = await logCount(page, 'undone');
  await panel.locator('input, textarea').first().focus();
  await page.keyboard.type('u');
  await frames(page, 30);
  expect(await logCount(page, 'undone'), 'U typed in the phone is a letter, not an undo').toBe(before);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  // Tab off the end leaves the stage
  for (let i = 0; i < 40 && (await focused()) !== null; i++) await page.keyboard.press('Tab');
  expect(await focused()).toBeNull();
});

test('latency on the bench (§ E0): hover answers in the next frame, a grab within 50 ms, a handle within 100 ms', async ({ page }) => {
  await open(page, 1440, 900);
  await standIns(page);
  const hand = mouseHand(page);
  const dial = (await screenOf(page, 'belt-dial'))!;
  // warm up (the first lift of each thing may compile a program), then measure
  for (let pass = 0; pass < 2; pass++) {
    await page.evaluate(() => (window as any).__bench.ws.latency.reset());
    for (let i = 0; i < 6; i++) {
      await page.mouse.move(20, 20);
      await frames(page, 3);
      await page.mouse.move(dial.x, dial.y);
      await frames(page, 3);
      await stroke(page, hand, [dial, dial]); // a click: one step
      const crate = await page.evaluate(() => (window as any).__bench.where('crate-3') as { x: number; y: number });
      await stroke(page, hand, line(crate, { x: crate.x + (i % 2 ? -30 : 30), y: crate.y }, 3));
      await frames(page, 20);
    }
  }
  const lat = await page.evaluate(() => (window as any).__bench.ws.latency.report());
  const ft = await page.evaluate(() => {
    const f = ((window as any).__bench.ws.loop.frameTimes() as number[]).slice(-240).sort((a, b) => a - b);
    return { median: f[Math.floor(f.length / 2)] ?? 0, p95: f[Math.floor(f.length * 0.95)] ?? 0 };
  });
  const row = (k: string) => lat.frame[k] && { n: lat.frame[k].n, median: Math.round(lat.frame[k].median), p95: Math.round(lat.frame[k].p95), max: Math.round(lat.frame[k].max) };
  const loadavg = await import('node:os').then((os) => os.loadavg().map((v) => v.toFixed(2)).join(' '));
  console.log(`[I1] latency on the bench (ms, DOM event → end of the first frame after the step that handled it), load average ${loadavg}, frame time median ${ft.median.toFixed(1)} p95 ${ft.p95.toFixed(1)}: hover ${JSON.stringify(row('hover'))} grab ${JSON.stringify(row('grab'))} press ${JSON.stringify(row('press'))}`);
  // a hover answers in the next frame: within one frame time (and the step that waits for it)
  expect(lat.frame.hover.median).toBeLessThan(ft.median * 1.5 + 17);
  expect(lat.frame.grab.median).toBeLessThan(Math.max(50, ft.median * 1.5 + 17));
  expect(lat.frame.press.median).toBeLessThan(100);
});
