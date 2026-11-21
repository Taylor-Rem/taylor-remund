// The engine-neutral set (REWRITE.md § E8, Browser row): the bench in Chromium, Firefox and WebKit.
// Runs in every project of playwright.config.ts (ENGINE_NEUTRAL). Nothing here is engine-specific except where
// an engine truly differs, and then in a named, commented branch.
//
// ADDING A TEST TO THE SET: put it in a file under tests/browser/engines/ ending in .spec.ts (or in this one),
// import { test, expect, ... } from './bench.ts' (not from @playwright/test), open the bench with
// `bench.open(page, '?query')` and wait with `live(page)`; read the world with `world(page, '(w) => …')`.
// No CDP, no `channel`, no GPU flags, no wall-clock waits for the simulation (wait on steps: `steps(page, n)`).
// Then run it in each engine, several times (see the header of playwright.config.ts): a test that passes
// four runs in five is not done.
//
// What the set holds today: the page loads clean (no error, no failed request, nothing leaves the origin); the
// picture comes first and the stage takes over from it; the simulation runs; a crate moves by mouse drag and
// by touch tap-then-tap; the keyboard presses the Button; the phone answers a ready-made text; reduced motion
// cuts rather than fades; with WebGL refused the picture stays and nothing throws.
// Arriving from other builders: the Still tier proper, reduced motion beyond the handoff, and the Button's
// press heard in the controls list's announcement.
import { test, expect, live, world, steps, stepOf, screenshotPixels, variety, meanDiff, REFUSE_WEBGL, SLOW, LIGHT, SMALL } from './bench.ts';
import type { Page } from '@playwright/test';

test.setTimeout(SLOW * 2);

type XY = { x: number; y: number };

/** Where a part or the Button is on screen (CSS px), or null. */
const whereOf = (page: Page, id: string): Promise<XY | null> => page.evaluate((id) => (window as any).__bench.where(id), id);
/** What a pointer of this kind would pick at a screen point (holding `held`: then mouths are targets too). */
const pickAt = (page: Page, p: XY, kind: 'mouse' | 'touch', held: string | null = null): Promise<string | null> =>
  page.evaluate(([x, y, k, h]) => (window as any).__bench.ws.surface.at(x, y, k, h, h ? 'part' : null)?.id ?? null, [p.x, p.y, kind, held] as const);
/** The screen point of a world point. */
const project = (page: Page, p: number[]): Promise<XY> => page.evaluate((p) => (window as any).__bench.project(p), p);

/**
 * The world agrees the crate was moved: within `limit` steps its own record (the durable location) is no longer
 * where it began, and the crate is more than 0.8 away from there. (Not "on the spot": the hand carries at a lift,
 * so a pointer over a spot on the bench holds the crate in front of it, and a dropped crate settles where it
 * settles; a visitor aims by watching the crate, as bench-input.spec.ts's carryTo does on the GPU.)
 */
async function movedAndRecorded(page: Page, id: string, before: number[], limit = 240): Promise<void> {
  const far = (p: number[]): boolean => Math.hypot(p[0]! - before[0]!, p[2]! - before[2]!) > 0.8;
  let record: { at: string; pose?: { p: number[] } } = { at: '' };
  for (let n = 0; n < limit; n += 10) {
    record = await world(page, `(w) => w.part('${id}').location`);
    if (record.at !== 'rest' || far(record.pose!.p)) break;
    await steps(page, 10);
  }
  const now = await world<number[]>(page, `(w) => w.motion('${id}').pose.p`);
  expect(far(now), `${id} from ${before} to ${now}`).toBe(true);
  expect(record.at !== 'rest' || far(record.pose!.p), `the world's record of ${id}: ${JSON.stringify(record)}`).toBe(true);
}

/**
 * A loose crate the visitor can pick at its middle, and an empty spot on the bench top near it, on screen, that
 * picks nothing and is no mouth that would take the carried crate in (the belt's is generous to a finger). Not
 * the crate of Fetch's opening lap (attract mode): Fetch carries that one to the belt whatever a hand did. Fetch
 * carries crates about, so this waits (in steps) for a pair.
 */
async function crateAndSpot(page: Page, kind: 'mouse' | 'touch'): Promise<{ id: string; at: XY; before: number[]; spot: { world: number[]; at: XY } }> {
  const vw = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  const m = 30;
  const top = await world<number>(page, '(w) => w.scene.bench.top');
  const offsets = [[-1.4, 0], [1.4, 0], [-1.4, -0.6], [1.4, -0.6], [0, -1.2], [-2, -0.3], [2, -0.3], [-0.9, -0.4], [0.9, -0.4], [-0.9, 0.5], [0.9, 0.5], [0, 0.9], [-0.7, 0], [0.7, 0], [0, -0.7]];
  for (let tries = 0; tries < 30; tries++) {
    const lap = await world<string | null>(page, '(w) => w.attract().crate');
    for (const id of ['crate-4', 'crate-2', 'crate-3', 'crate-1'].filter((c) => c !== lap)) {
      if ((await world<string>(page, `(w) => w.mode('${id}')`)) !== 'free') continue;
      const at = await whereOf(page, id);
      if (!at || (await pickAt(page, at, kind)) !== id) continue;
      const before = await world<number[]>(page, `(w) => w.motion('${id}').pose.p`);
      for (const [dx, dz] of offsets) {
        const p = [before[0]! + dx!, top, before[2]! + dz!];
        const s = await project(page, p);
        if (s.x < m || s.y < m || s.x > vw.w - m || s.y > vw.h - m) continue;
        if ((await pickAt(page, s, kind)) === null && (await pickAt(page, s, kind, id)) === null) return { id, at, before, spot: { world: p, at: s } };
      }
    }
    await steps(page, 30);
  }
  throw new Error('no loose crate with an empty spot beside it, on screen, in 30 tries');
}

test('the bench loads with no console error, no failed request, and nothing leaving the origin', async ({ page, bench }) => {
  const w = await bench.open(page, LIGHT);
  await live(page);
  await steps(page, 30);
  expect(w.errors).toEqual([]);
  expect(w.failed).toEqual([]);
  expect(w.foreign).toEqual([]);
});

test('the picture is there before the stage; the stage takes over from it, not blank, close to it', async ({ page, bench }) => {
  const w = await bench.open(page, `${LIGHT}&hold=1`);
  // before any script has done its work: the picture
  await expect(page.locator('img.poster')).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('stage')!).opacity)).toBe('0');
  // the stage built behind it, held on the picture's state and camera
  await page.waitForFunction(() => ['held-picture', 'failed'].includes((window as any).__handoff?.phase), null, { timeout: SLOW, polling: 250 });
  expect(await page.evaluate(() => (window as any).__handoff.failed)).toBeNull();
  await page.evaluate(() => {
    // the picture at full brightness for the comparison (it warms as the stage loads)
    document.documentElement.classList.remove('warming');
  });
  const picture = await screenshotPixels(page);
  await page.evaluate(() => (window as any).__handoff.release());
  await page.waitForFunction(() => (window as any).__handoff.phase === 'held-stage', null, { timeout: SLOW });
  await page.waitForFunction(() => getComputedStyle(document.getElementById('stage')!).opacity === '1', null, { timeout: SLOW });
  const stage = await screenshotPixels(page);
  const v = variety(stage);
  const d = meanDiff(picture, stage);
  console.log(`[engines] ${test.info().project.name}: stage ${JSON.stringify(v)}, picture ${JSON.stringify(variety(picture))}, mean difference ${d.toFixed(1)}/255`);
  expect(v.distinct, 'the stage is not blank').toBeGreaterThan(150);
  expect(v.spread, 'the stage is not flat').toBeGreaterThan(80);
  // the same scene from the same camera: close, not equal (software WebGL, and the picture may be older than the scene)
  expect(d, 'the stage looks like the picture it takes over from').toBeLessThan(24);
  await page.evaluate(() => (window as any).__handoff.release());
  await page.waitForFunction(() => (window as any).__handoff.phase === 'live', null, { timeout: SLOW });
  expect(w.errors).toEqual([]);
});

test('the simulation runs, and a crate moves by a mouse drag', async ({ page, bench }) => {
  const w = await bench.open(page, LIGHT);
  await live(page);
  const s0 = await stepOf(page);
  await steps(page, 20);
  expect(await stepOf(page)).toBeGreaterThan(s0);
  const crate = await crateAndSpot(page, 'mouse');
  const { before, spot } = crate;
  const grabs = await page.evaluate(() => (window as any).__bench.log.filter((l: any) => l.e.type === 'part.grabbed').length);
  await page.mouse.move(crate.at.x, crate.at.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(crate.at.x + ((spot.at.x - crate.at.x) * i) / 12, crate.at.y + ((spot.at.y - crate.at.y) * i) / 12);
    await steps(page, 2);
  }
  await steps(page, 20);
  expect(await world(page, '(w) => w.holding()'), 'the hand has the crate').toMatchObject({ id: crate.id });
  await page.mouse.up();
  await steps(page, 4);
  expect(await page.evaluate(() => (window as any).__bench.log.filter((l: any) => l.e.type === 'part.grabbed').length)).toBeGreaterThan(grabs);
  expect(await world(page, '(w) => w.holding()')).toBeNull();
  await movedAndRecorded(page, crate.id, before);
  expect(w.errors).toEqual([]);
});

test('a crate moves by touch, tap then tap', async ({ bench }) => {
  const page = await bench.context({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: false });
  const w = await bench.open(page, LIGHT);
  await live(page);
  const crate = await crateAndSpot(page, 'touch');
  const { before, spot } = crate;
  await page.touchscreen.tap(crate.at.x, crate.at.y);
  await steps(page, 20);
  expect(await world(page, '(w) => w.holding()'), 'a tap on a crate lifts it').toMatchObject({ id: crate.id });
  const under = await pickAt(page, spot.at, 'touch');
  await page.touchscreen.tap(spot.at.x, spot.at.y);
  await steps(page, 10);
  const diag = await page.evaluate(() => ({ held: (window as any).__bench.ws.gestures.held, state: (window as any).__bench.ws.gestures.state }));
  expect(await world(page, '(w) => w.holding()'), `a tap on the bench puts it down (under the tap: ${under}; gestures ${JSON.stringify(diag)})`).toBeNull();
  await movedAndRecorded(page, crate.id, before);
  expect(w.errors).toEqual([]);
});

test('the keyboard reaches the Button and presses it', async ({ page, bench }) => {
  const w = await bench.open(page, LIGHT);
  await live(page);
  await page.locator('#stage').focus();
  const focused = (): Promise<string | null> => page.evaluate(() => (window as any).__bench.ws.focused);
  for (let i = 0; i < 40 && (await focused()) !== 'button'; i++) await page.keyboard.press('Tab');
  expect(await focused()).toBe('button');
  const presses = await world<number>(page, '(w) => w.button().presses');
  await page.keyboard.press('Enter');
  await page.waitForFunction((n) => (window as any).__bench.ws.world.button().presses > n, presses, { timeout: SLOW });
  // (the half of § E8 that hears it announced arrives with the controls list)
  expect(w.errors).toEqual([]);
});

test("the phone's panel opens and a ready-made text gets an answer", async ({ page, bench }) => {
  const w = await bench.open(page, LIGHT);
  await live(page);
  await page.locator('#stage').focus();
  const focused = (): Promise<string | null> => page.evaluate(() => (window as any).__bench.ws.focused);
  for (let i = 0; i < 40 && (await focused()) !== 'phone'; i++) await page.keyboard.press('Tab');
  expect(await focused()).toBe('phone');
  await page.keyboard.press('Enter');
  const panel = page.getByRole('dialog');
  await expect(panel).toBeVisible({ timeout: SLOW });
  const answers = panel.locator('.ph-answer');
  const before = await answers.count();
  const key = panel.locator('.ph-key').first();
  const text = (await key.textContent())?.trim();
  await key.click();
  await expect(panel.locator('.ph-sent .ph-words').last()).toHaveText(text!, { timeout: SLOW });
  await expect(answers).toHaveCount(before + 1, { timeout: SLOW });
  await expect(panel.getByRole('status')).not.toBeEmpty({ timeout: SLOW });
  expect(w.errors).toEqual([]);
});

test('with reduced motion the stage arrives by a cut, not a fade, and the picture is never dimmed', async ({ bench }) => {
  const page = await bench.context({ ...SMALL, reducedMotion: 'reduce' });
  const w = await bench.open(page, LIGHT);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('img.poster')!).filter)).toBe('none');
  await live(page);
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('stage')!).transitionDuration)).toBe('0s');
  // (Not yet asserted: the world's own reducedMotion. Nothing outside the unit tests dispatches the `motion`
  // intent, so in a browser the Button's rungs still play full motion: INVENTORY § J, the reduced-motion
  // builder's. Their test goes here.)
  expect(w.errors).toEqual([]);
});

test('with WebGL refused the picture stays, the page says so, and nothing throws', async ({ bench }) => {
  const page = await bench.context({ ...SMALL });
  await page.addInitScript(REFUSE_WEBGL);
  const w = await bench.open(page, LIGHT);
  await page.waitForFunction(() => (window as any).__ready === true, null, { timeout: SLOW });
  const h = await page.evaluate(() => ({ phase: (window as any).__handoff?.phase, failed: (window as any).__handoff?.failed, root: document.getElementById('stage-root')!.className }));
  expect(h.phase).toBe('failed');
  expect(h.root).toMatch(/\bstage-failed\b/);
  await expect(page.locator('img.poster')).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('img.poster')!).filter)).toBe('none');
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('stage')!).opacity)).toBe('0');
  // Three things say so on the console, by design: three.js ("Error creating WebGL context."), the loader
  // ("stage failed to start; the picture stays"), and the DEV page itself, which then throws 'bench: the stage
  // failed to start' (src/dev-pages/bench.astro, after __ready). Anything else is a fault. (The Still tier
  // will tighten this: it should not try to make a context it knows it cannot have.)
  const others = w.errors.filter((e) => !/Error creating WebGL context|stage failed to start; the picture stays|bench: the stage failed to start/.test(e));
  expect(others).toEqual([]);
});
