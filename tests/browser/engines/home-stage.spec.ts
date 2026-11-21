// The stage on `/` in Chromium, Firefox and WebKit (REWRITE.md § E8, Browser row), against the built site:
// the picture first and the stage taken over from it under reduced motion (a cut, then nothing moves, then the
// Button's reduced rung, heard), and a crate moved by a mouse drag and by touch, tap then tap. The rest of the
// row is held where it was written, tagged for every engine: home.spec.ts (the page loads clean, the canvas
// draws, Read and Back, the Still tier), keyboard.spec.ts (the Tab path, the Button pressed and heard),
// settings.spec.ts (the quality changed and back). engine.ts says how a test joins the set.
import { readFileSync } from 'node:fs';
import type { Page, Route } from '@playwright/test';
import { test, expect, ENGINES, SLOW, SMALL, stageAt, live, ws, steps, stepOf, positions, said, rate, watch, canvasPixels, picturePixels, variety, meanDiff } from './engine.ts';

/** The live region's sentences, as content says them (never typed here). */
const SAID = JSON.parse(readFileSync(new URL('../../../src/content/world.json', import.meta.url), 'utf8')).said as Record<string, { text: string }>;
/** A sentence of SAID with its slots as wildcards, as a pattern. */
const sentence = (key: string): RegExp => new RegExp(SAID[key]!.text.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{[a-z]+\}/g, '.+'));

type XY = { x: number; y: number };

/** The screen point (CSS px) of a world point, on the stage's canvas. */
const project = (page: Page, p: number[]): Promise<XY> =>
  ws(page, (w, p: number[]) => {
    const c = w.stage.canvas as HTMLCanvasElement;
    const s = w.stage.camera.worldToScreen({ x: p[0], y: p[1], z: p[2] });
    const r = c.getBoundingClientRect();
    return { x: r.left + ((s.x + 1) / 2) * c.clientWidth, y: r.top + ((1 - s.y) / 2) * c.clientHeight };
  }, p);
/** What a pointer of this kind would pick at a screen point (holding `held`: then mouths are targets too). */
const pickAt = (page: Page, p: XY, kind: 'mouse' | 'touch', held: string | null = null): Promise<string | null> =>
  ws(page, (w, [x, y, k, h]: [number, number, string, string | null]) => w.surface.at(x, y, k, h, h ? 'part' : null)?.id ?? null, [p.x, p.y, kind, held] as [number, number, string, string | null]);
const world = <T>(page: Page, f: string): Promise<T> => ws(page, (w, src: string) => new Function('w', `return (${src})(w);`)(w.world), f) as Promise<T>;

/**
 * The world agrees the crate was moved: within `limit` steps its own record (the durable location) is no longer
 * where it began, and the crate is more than 0.8 away from there. (The hand carries at a lift, so a pointer over
 * a spot holds the crate in front of it, and a dropped crate settles where it settles.)
 */
async function movedAndRecorded(page: Page, id: string, before: number[], limit = 480): Promise<void> {
  const far = (p: number[]): boolean => Math.hypot(p[0]! - before[0]!, p[2]! - before[2]!) > 0.8;
  let record: { at: string; pose?: { p: number[] } } = { at: '' };
  for (let n = 0; n < limit; n += 10) {
    record = await world(page, `(w) => w.part('${id}').location`);
    if (record.at !== 'rest' || far(record.pose!.p)) break;
    await steps(page, 10);
  }
  const now = await world<number[]>(page, `(w) => w.motion('${id}').pose.p`);
  expect(far(now), `${id} from ${before} to ${now}`).toBe(true);
  const how = await world<string>(page, `(w) => w.mode('${id}') + ' awake ' + w.motion('${id}').awake + ' held ' + JSON.stringify(w.holding())`);
  expect(record.at !== 'rest' || far(record.pose!.p), `the world's record of ${id}: ${JSON.stringify(record)}; it is at ${now} (${how})`).toBe(true);
}

/**
 * A loose crate the visitor can pick at its middle, and an empty spot on the bench top near it, on screen, that
 * picks nothing and is no mouth that would take the carried crate in. Not the crate of Fetch's opening lap
 * (attract mode carries that one to the belt whatever a hand did). Fetch carries crates about, so this waits
 * (in steps) for a pair.
 */
async function crateAndSpot(page: Page, kind: 'mouse' | 'touch'): Promise<{ id: string; at: XY; before: number[]; spot: XY }> {
  const vw = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  const m = 30;
  // (below the strip: a press there is the strip's)
  const stripFoot = await page.evaluate(() => document.querySelector('header.strip')?.getBoundingClientRect().bottom ?? 0);
  const ok = (s: XY): boolean => s.x > m && s.y > Math.max(m, stripFoot + 8) && s.x < vw.w - m && s.y < vw.h - m;
  const top = await world<number>(page, '(w) => w.scene.bench.top');
  const offsets = [[-1.4, 0], [1.4, 0], [-1.4, -0.6], [1.4, -0.6], [0, -1.2], [-2, -0.3], [2, -0.3], [-0.9, -0.4], [0.9, -0.4], [-0.9, 0.5], [0.9, 0.5], [0, 0.9], [-0.7, 0], [0.7, 0], [0, -0.7]];
  for (let tries = 0; tries < 30; tries++) {
    const lap = await world<string | null>(page, '(w) => w.attract().crate');
    for (const id of ['crate-4', 'crate-2', 'crate-3', 'crate-1'].filter((c) => c !== lap)) {
      if ((await world<string>(page, `(w) => w.mode('${id}')`)) !== 'free') continue;
      const before = await world<number[]>(page, `(w) => w.motion('${id}').pose.p`);
      const at = await project(page, before);
      if (!ok(at) || (await pickAt(page, at, kind)) !== id) continue;
      for (const [dx, dz] of offsets) {
        const s = await project(page, [before[0]! + dx!, top, before[2]! + dz!]);
        if (!ok(s)) continue;
        if ((await pickAt(page, s, kind)) === null && (await pickAt(page, s, kind, id)) === null) return { id, at, before, spot: s };
      }
    }
    await steps(page, 30);
  }
  throw new Error('no loose crate with an empty spot beside it, on screen, in 30 tries');
}

test.describe('the stage on /', { tag: ENGINES }, () => {
  test.setTimeout(SLOW * 3);
  test.use({ ...SMALL });

  test('reduced motion: the picture first; the stage by a cut, close to it; nothing moves for ten simulated seconds; a press plays the reduced rung, heard', async ({ page, browserName, baseURL }) => {
    const w = watch(page, new URL(baseURL!).origin);
    // the stage's script waits until the picture has been looked at: what a visitor sees before any of it runs
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let asked = false;
    await page.route(/\/_astro\/home\.[^/]*\.js$/, async (route: Route) => {
      asked = true;
      await held;
      await route.continue();
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(stageAt('/', browserName), { waitUntil: 'domcontentloaded', timeout: SLOW });
    await page.waitForFunction(() => {
      const i = document.querySelector<HTMLImageElement>('img.poster');
      return !!i && i.complete && i.naturalWidth > 0;
    }, null, { timeout: SLOW });
    await expect.poll(() => asked, { timeout: SLOW }).toBe(true);
    const before = await page.evaluate(() => ({
      cls: document.documentElement.className,
      filter: getComputedStyle(document.querySelector('img.poster')!).filter,
      stage: getComputedStyle(document.getElementById('stage')!).opacity,
      loader: 'undefined' !== typeof (window as unknown as { __handoff?: unknown }).__handoff,
    }));
    expect(before.cls).toContain('motion-reduced');
    expect(before.cls, 'no warm-up under reduced motion').not.toContain('warming');
    expect(before.filter, 'the picture is never dimmed').toBe('none');
    expect(before.stage, 'the canvas is hidden behind the picture').toBe('0');
    expect(before.loader, 'nothing of the stage has run').toBe(false);
    await expect(page.locator('img.poster')).toBeVisible();
    const picture = await picturePixels(page);
    release();

    await live(page);
    // the swap is a cut
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('stage')!).transitionDuration)).toBe('0s');
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('stage')!).opacity)).toBe('1');
    await expect.poll(() => ws(page, (w) => w.world.still), { timeout: SLOW }).toBe(true);
    const stage = await canvasPixels(page);
    const v = variety(stage);
    const d = meanDiff(picture, stage);
    console.log(`[engines] ${browserName}: stage ${JSON.stringify(v)}, picture ${JSON.stringify(variety(picture))}, mean difference ${d.toFixed(1)}/255`);
    expect(v.distinct, 'the stage is not blank').toBeGreaterThan(150);
    expect(v.spread, 'the stage is not flat').toBeGreaterThan(80);
    // the same scene from the same camera: close, not equal (another tier, another renderer)
    expect(d, 'the stage looks like the picture it takes over from').toBeLessThan(24);

    // nothing moves for ten simulated seconds: the world's record of every part and of Patch
    const p0 = await positions(page);
    const s0 = await stepOf(page);
    await steps(page, 600);
    expect(await positions(page), `nothing moved from step ${s0} to ${await stepOf(page)}`).toEqual(p0);
    // ... and the canvas shows the same bench across an interval. Where frames are slow the governor lowers the
    // drawing resolution in the first seconds (shell/governor.ts: § E7 "resolution first"), which changes every
    // edge without anything moving: the interval is one in which the drawing buffer kept its size.
    const size = (): Promise<string> => page.evaluate(() => `${(window as any).__handoff.canvas.width}x${(window as any).__handoff.canvas.height}`);
    let moved = Infinity;
    for (let i = 0; i < 4; i++) {
      const at = await size();
      const a = await canvasPixels(page);
      await steps(page, 300);
      const b = await canvasPixels(page);
      if ((await size()) !== at) continue;
      moved = meanDiff(a, b);
      console.log(`[engines] ${browserName}: reduced motion, canvas change over 300 steps at ${at}: ${moved.toFixed(2)}/255`);
      break;
    }
    expect(moved, 'the canvas shows the same bench five simulated seconds later').toBeLessThan(1);
    expect(await positions(page), `nothing moved from step ${s0} to ${await stepOf(page)}`).toEqual(p0);
    expect(await ws(page, (w) => w.world.machine('belt').running)).toBe(false);

    // a press on the Button plays the reduced rung, and the live region says so
    await ws(page, (w) => w.dispatch({ type: 'press', id: w.world.button().id }));
    await page.waitForFunction(() => (window as any).__handoff.workshop.world.button().presses === 1, null, { timeout: SLOW });
    expect(await ws(page, (w) => w.world.button().script?.reduced)).toBe(true);
    await expect.poll(() => said(page), { timeout: SLOW }).toContain(SAID.rungStill!.text);
    expect(w.errors).toEqual([]);
    expect(w.failed).toEqual([]);
    expect(w.foreign).toEqual([]);
  });

  test('a crate moves by a mouse drag, and the live region says it was picked up', async ({ page, browserName, baseURL }) => {
    const w = watch(page, new URL(baseURL!).origin);
    await page.goto(stageAt('/', browserName), { timeout: SLOW });
    await live(page);
    const r = await rate(page);
    console.log(`[engines] ${browserName}: / at ${await page.evaluate(() => document.documentElement.dataset.tier)} ${SMALL.viewport.width}x${SMALL.viewport.height}: ${r.fps} frames and ${r.sps} steps a second`);
    const crate = await crateAndSpot(page, 'mouse');
    await page.mouse.move(crate.at.x, crate.at.y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(crate.at.x + ((crate.spot.x - crate.at.x) * i) / 12, crate.at.y + ((crate.spot.y - crate.at.y) * i) / 12);
      await steps(page, 2);
    }
    await steps(page, 20);
    expect(await world(page, '(w) => w.holding()'), 'the hand has the crate').toMatchObject({ id: crate.id });
    await page.mouse.up();
    await steps(page, 4);
    expect(await world(page, '(w) => w.holding()')).toBeNull();
    await movedAndRecorded(page, crate.id, crate.before);
    await expect.poll(() => said(page), { timeout: SLOW }).toMatch(sentence('picked'));
    expect(w.errors).toEqual([]);
    expect(w.failed).toEqual([]);
  });

  test('a crate moves by touch, tap then tap', async ({ browser, browserName, baseURL }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: false });
    try {
      const page = await ctx.newPage();
      const w = watch(page, new URL(baseURL!).origin);
      await page.goto(`${baseURL}${stageAt('/', browserName)}`, { timeout: SLOW });
      await live(page);
      const crate = await crateAndSpot(page, 'touch');
      await page.touchscreen.tap(crate.at.x, crate.at.y);
      await steps(page, 20);
      expect(await world(page, '(w) => w.holding()'), 'a tap on a crate lifts it').toMatchObject({ id: crate.id });
      const under = await pickAt(page, crate.spot, 'touch');
      await page.touchscreen.tap(crate.spot.x, crate.spot.y);
      await steps(page, 10);
      const diag = await ws(page, (w) => ({ held: w.gestures.held, state: w.gestures.state }));
      expect(await world(page, '(w) => w.holding()'), `a tap on the bench puts it down (under the tap: ${under}; gestures ${JSON.stringify(diag)})`).toBeNull();
      await movedAndRecorded(page, crate.id, crate.before);
      expect(w.errors).toEqual([]);
      expect(w.failed).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
});
