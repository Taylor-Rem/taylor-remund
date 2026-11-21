import { expect, test, type Page, type Request } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { gpuArgs } from '../../playwright.config.ts';

// What `/` remembers and the settings (P3 B3; REWRITE.md § B4, § B9, § B10, § E7, § E10, § I): the visit's
// snapshot, the settings panel (sound, motion, quality, reset), reduced motion reaching the world, the
// `?playtest=1` log and the `?debug` panel. Against the built site (playwright.config.ts), on system Chrome with
// the GPU: the stage is the real bench at the tier this browser is given, not `?tier=`.
//
// The assertions use standard APIs only (no CDP): reduced motion is the context's emulation, storage is the
// page's own, the playtest file is a download. Only the `use` line below is Chromium's.

test.use({ channel: 'chrome', launchOptions: { args: gpuArgs } });
test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

const SAVED = 'workshop.saved';
const FRESH = '{"v":1,"button":{"rung":0,"reached":0,"presses":0,"cover":"none","deck":{"left":[],"last":null}},"used":[]}';

type Win = Window & { __handoff: { phase: string; workshop: any } };

function watch(page: Page, origin: string): { errors: string[]; requests: string[]; foreign: string[] } {
  const w = { errors: [] as string[], requests: [] as string[], foreign: [] as string[] };
  page.on('pageerror', (e) => w.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') w.errors.push(`console: ${m.text()}`);
  });
  page.on('request', (r: Request) => {
    const u = r.url();
    w.requests.push(u);
    if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')) w.foreign.push(u);
  });
  return w;
}

const live = (page: Page): Promise<unknown> =>
  page.waitForFunction(() => (window as unknown as Win).__handoff?.phase === 'live' && !!(window as unknown as Win).__handoff.workshop, null, { timeout: 90_000, polling: 100 });

/** Press the Big Red Button and wait for its rung to end. */
async function pressButton(page: Page): Promise<void> {
  await page.evaluate(() => {
    const ws = (window as unknown as Win).__handoff.workshop;
    ws.dispatch({ type: 'press', id: ws.world.button().id });
  });
  await page.waitForFunction(() => (window as unknown as Win).__handoff.workshop.world.bracketed, null, { timeout: 5_000, polling: 50 });
  await page.waitForFunction(() => !(window as unknown as Win).__handoff.workshop.world.bracketed, null, { timeout: 30_000, polling: 100 });
}

const button = (page: Page): Promise<{ presses: number; rung: number; reached: number }> =>
  page.evaluate(() => {
    const b = (window as unknown as Win).__handoff.workshop.world.button();
    return { presses: b.presses, rung: b.rung, reached: b.reached };
  });

async function openSettings(page: Page): Promise<void> {
  const open = page.getByRole('button', { name: 'Settings', exact: true });
  await open.click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await expect(open).toHaveAttribute('aria-expanded', 'true');
}
const choose = (page: Page, group: string, label: string): Promise<void> => page.getByRole('group', { name: group }).getByText(label, { exact: true }).click();

/** Every part's place and the crew's: what "nothing moves" compares. */
const positions = (page: Page): Promise<Record<string, unknown>> =>
  page.evaluate(() => {
    const w = (window as unknown as Win).__handoff.workshop.world;
    const out: Record<string, unknown> = {};
    for (const p of w.parts()) {
      const m = w.motion(p.id);
      if (m) out[p.id] = [...m.pose.p, ...m.pose.q].map((v: number) => Math.round(v * 1e4) / 1e4);
    }
    // the crew without a body of their own (Patch): what it is doing
    for (const c of w.crewViews()) if (c.body === null) out[`crew:${c.id}`] = c.view.state;
    return out;
  });

test('the visit is remembered: two presses survive a reload; "Reset the workshop" (two presses) leaves a fresh visit', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await live(page);
  expect(await button(page)).toEqual({ presses: 0, rung: 0, reached: 0 });
  await pressButton(page);
  await pressButton(page);
  expect(JSON.parse((await page.evaluate((k) => localStorage.getItem(k), SAVED))!).button).toMatchObject({ presses: 2, rung: 2, reached: 2 });
  await page.reload();
  await live(page);
  expect(await button(page)).toEqual({ presses: 2, rung: 2, reached: 2 });

  await openSettings(page);
  const reset = page.getByRole('button', { name: 'Reset the workshop', exact: true });
  await reset.click();
  // armed, not done: one stray press throws nothing away
  await expect(page.getByRole('button', { name: 'Press again to reset', exact: true })).toBeVisible();
  expect((await button(page)).presses).toBe(2);
  await page.getByRole('button', { name: 'Press again to reset', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('The workshop is reset.');
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), SAVED)).toBe(FRESH);
  // the settings themselves are untouched by a reset
  expect(await page.evaluate(() => [localStorage.getItem('workshop.settings.motion'), localStorage.getItem('workshop.settings.quality')])).toEqual([null, null]);
  await page.reload();
  await live(page);
  expect(await button(page)).toEqual({ presses: 0, rung: 0, reached: 0 });
});

for (const [name, value] of [
  ['rung 99', '{"v":1,"button":{"rung":99,"reached":99,"presses":99,"cover":"none","deck":{"left":[],"last":null}},"used":[]}'],
  ['a megabyte of text', 'x'.repeat(1 << 20)],
  ['not JSON', '{"v":1,"button":'],
] as const) {
  test(`a hostile stored snapshot (${name}) is a fresh visit, with no error`, async ({ page, baseURL }) => {
    const w = watch(page, new URL(baseURL!).origin);
    await page.addInitScript(([k, v]) => {
      try {
        localStorage.setItem(k, v);
      } catch {
        /* a quota: then nothing is stored, which is also a fresh visit */
      }
    }, [SAVED, value] as const);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await live(page);
    expect(await button(page)).toEqual({ presses: 0, rung: 0, reached: 0 });
    expect(w.errors).toEqual([]);
  });
}

test.describe('reduced motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('nothing on the bench moves for ten seconds after the handoff; a press plays the reduced rung; the belt runs when switched on', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/motion-reduced/);
    await live(page);
    expect(await page.evaluate(() => (window as unknown as Win).__handoff.workshop.world.still)).toBe(true);
    const before = await positions(page);
    await page.waitForTimeout(10_000);
    expect(await positions(page)).toEqual(before);
    expect(await page.evaluate(() => (window as unknown as Win).__handoff.workshop.world.machine('belt').running)).toBe(false);

    await pressButton(page);
    expect(await page.evaluate(() => (window as unknown as Win).__handoff.workshop.world.button().script.reduced)).toBe(true);
    await page.evaluate(() => (window as unknown as Win).__handoff.workshop.dispatch({ type: 'turn', id: 'belt-lever', value: 1 }));
    await expect.poll(() => page.evaluate(() => (window as unknown as Win).__handoff.workshop.world.machine('belt').running)).toBe(true);
    const phase = await page.evaluate(() => (window as unknown as Win).__handoff.workshop.world.machine('belt').phase);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as Win).__handoff.workshop.world.machine('belt').phase)).not.toBe(phase);
  });

  test('"Full" in the settings brings attract mode back without a reload, and is remembered', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await live(page);
    expect(await page.evaluate(() => (window as unknown as Win).__handoff.workshop.world.still)).toBe(true);
    await openSettings(page);
    await expect(page.getByRole('radio', { name: 'Same as this device' })).toBeChecked();
    await choose(page, 'Motion', 'Full');
    await expect.poll(() => page.evaluate(() => (window as unknown as Win).__handoff.workshop?.world.still), { timeout: 20_000 }).toBe(false);
    await live(page);
    await expect(page.locator('html')).not.toHaveClass(/motion-reduced/);
    expect(await page.evaluate(() => (window as unknown as Win).__handoff.workshop.world.attract().on)).toBe(true);
    const a = await positions(page);
    await page.waitForTimeout(3_000);
    expect(await positions(page)).not.toEqual(a);
    expect(await page.evaluate(() => localStorage.getItem('workshop.settings.motion'))).toBe('full');
    await page.reload();
    await live(page);
    expect(await page.evaluate(() => (window as unknown as Win).__handoff.workshop.world.reducedMotion)).toBe(false);
    await expect(page.locator('html')).not.toHaveClass(/motion-reduced/);
  });
});

test('quality: low then high during a visit keeps the world and the camera', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await live(page);
  await pressButton(page);
  // a crate the visitor has set down (the crew leaves it alone), and the camera moved
  await page.evaluate(() => {
    const ws = (window as unknown as Win).__handoff.workshop;
    ws.dispatch({ type: 'grab', id: 'crate-3', grip: ws.world.motion('crate-3').pose.p });
    ws.dispatch({ type: 'release', velocity: [0, 0, 0] });
    ws.stage.camera.zoomBy(1.2);
  });
  await page.waitForFunction(() => !(window as unknown as Win).__handoff.workshop.world.motion('crate-3').awake, null, { timeout: 20_000 });
  await page.waitForTimeout(1_000);
  const state = (): Promise<{ presses: number; crate: number[]; cam: string; tier: string | undefined }> =>
    page.evaluate(() => {
      const ws = (window as unknown as Win).__handoff.workshop;
      const v = ws.stage.camera.view();
      return {
        presses: ws.world.button().presses,
        crate: ws.world.motion('crate-3').pose.p.map((x: number) => Math.round(x * 1000) / 1000),
        cam: JSON.stringify({ f: v.focus.map((x: number) => Math.round(x * 1000) / 1000), z: Math.round(v.zoom * 1000) / 1000 }),
        tier: document.documentElement.dataset.tier,
      };
    });
  const s0 = await state();
  expect(s0.tier).toBe('high');
  await openSettings(page);
  await choose(page, 'Quality', 'Low');
  await expect(page.locator('html')).toHaveAttribute('data-tier', 'low', { timeout: 20_000 });
  await live(page);
  await expect(page.getByRole('radio', { name: 'Low' })).toBeEnabled();
  expect(await state()).toEqual({ ...s0, tier: 'low' });
  await choose(page, 'Quality', 'High');
  await expect(page.locator('html')).toHaveAttribute('data-tier', 'high', { timeout: 20_000 });
  await expect(page.getByRole('radio', { name: 'High' })).toBeEnabled();
  expect(await state()).toEqual(s0);
  expect(await page.evaluate(() => localStorage.getItem('workshop.settings.quality'))).toBe('high');
});

test('the still picture: after a reload nothing heavy is fetched; the settings bring the bench back', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await live(page);
  await openSettings(page);
  await choose(page, 'Quality', 'Still picture');
  await expect(page.locator('html')).toHaveClass(/still/);
  await expect(page.locator('html')).not.toHaveClass(/stage-on/);
  // without a stage the panel holds the quality alone
  await expect(page.getByRole('group', { name: 'Sound' })).toBeHidden();
  await expect(page.getByRole('group', { name: 'Quality' })).toBeVisible();
  const w = watch(page, new URL(baseURL!).origin);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1_500);
  expect(await page.evaluate(() => document.documentElement.dataset.tier)).toBe('still');
  expect(await page.evaluate(() => document.documentElement.className)).toContain('still');
  const heavy = w.requests.filter((u) => [/\/_astro\/home\.[^/]*\.js$/, /\/_astro\/three\.[^/]*\.js$/, /\/_astro\/rapier\.[^/]*\.js$/, /\/_astro\/early\.[^/]*\.js$/, /\.wasm(\?|$)/, /bake-table/, /\/_astro\/worker-/, /\/fonts\/workshop-(stencil|print|sign)\.woff2/].some((re) => re.test(u)));
  expect(heavy).toEqual([]);
  expect(w.errors).toEqual([]);
  await openSettings(page);
  await expect(page.getByRole('radio', { name: 'Still picture' })).toBeChecked();
  await choose(page, 'Quality', 'Automatic');
  await live(page);
  await expect(page.locator('html')).toHaveClass(/stage-on/);
  expect(await page.evaluate(() => document.documentElement.dataset.tier)).toBe('high');
  expect(w.errors).toEqual([]);
  expect(w.foreign).toEqual([]);
});

test('the panel: Esc and a press outside close it, focus goes in and back, sound agrees with the strip', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await live(page);
  const open = page.getByRole('button', { name: 'Settings', exact: true });
  await openSettings(page);
  await expect(page.getByRole('radio', { name: 'On' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden();
  await expect(open).toBeFocused();
  await expect(open).toHaveAttribute('aria-expanded', 'false');
  await openSettings(page);
  await page.mouse.click(640, 600);
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden();
  // sound: the panel, the strip and the M key are one state
  await openSettings(page);
  await choose(page, 'Sound', 'Off');
  await expect(page.getByRole('button', { name: 'Sound', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Sound', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'On' })).toBeChecked();
});

test('?playtest=1: three things done, the file taken, parsed, and found in order with their consequences', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?playtest=1');
  await live(page);
  await pressButton(page);
  await page.evaluate(() => {
    const ws = (window as unknown as Win).__handoff.workshop;
    ws.dispatch({ type: 'turn', id: 'belt-dial', value: 1 });
    ws.dispatch({ type: 'text', text: 'my own secret words' });
  });
  await page.waitForTimeout(3_000);
  const save = page.getByRole('button', { name: /Save the playtest log/ });
  await expect(save).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), save.click()]);
  const text = readFileSync((await download.path())!, 'utf8');
  expect(text).not.toContain('my own secret words');
  const file = JSON.parse(text) as { thresholds: any; rows: any[] };
  const actions = file.rows.filter((r) => r.kind === 'action');
  expect(actions.map((a) => [a.verb, a.id ?? null])).toEqual([
    ['press', await page.evaluate(() => (window as unknown as Win).__handoff.workshop.world.button().id)],
    ['turn', 'belt-dial'],
    ['text', null],
  ]);
  expect(actions[2].text).toBe('typed');
  expect(actions[0].t).toBeLessThan(actions[1].t);
  // the press's consequences: the Button acted, then the rung's misfire or effects, each with its cause
  const ofPress = file.rows.filter((r) => r.kind === 'consequence' && r.cause === actions[0].seq).map((r) => r.event);
  expect(ofPress).toContain('button.pressed');
  expect(ofPress).toContain('rung.ended');
  expect(file.rows.some((r) => r.kind === 'consequence' && r.cause === actions[1].seq)).toBe(true);
  expect(file.thresholds.firstAction.verb).toBe('press');
  expect(file.thresholds.usableAt).toBeGreaterThan(0);
  expect(file.thresholds.pictureAt).toBeGreaterThan(0);
  expect(file.thresholds.buttonPresses).toBe(1);
  expect(file.rows[0].kind).toBe('page');
});

test('without the parameters the playtest and debug modules are never fetched; ?debug shows its panel', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await live(page);
  await openSettings(page);
  await page.waitForTimeout(1_500);
  expect(requests.filter((u) => /\/_astro\/(playtest|debug|log)\.[^/]*\.js$/.test(u))).toEqual([]);
  await page.goto('/?debug');
  await live(page);
  await expect(page.locator('.debug-panel')).toContainText('draw calls');
  await expect(page.locator('.debug-panel')).toContainText(/tier\s+high/);
});

test('storage refused: the page works, the settings work, nothing is remembered and nothing errs', async ({ page, baseURL }) => {
  const w = watch(page, new URL(baseURL!).origin);
  await page.addInitScript(() => {
    for (const name of ['localStorage', 'sessionStorage'])
      Object.defineProperty(window, name, {
        get() {
          throw new DOMException('The operation is insecure.', 'SecurityError');
        },
      });
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await live(page);
  await pressButton(page);
  await openSettings(page);
  await choose(page, 'Motion', 'Reduced');
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__handoff.workshop.world.reducedMotion)).toBe(true);
  await page.getByRole('button', { name: 'Reset the workshop', exact: true }).click();
  await page.getByRole('button', { name: 'Press again to reset', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__handoff.workshop.world.button().presses)).toBe(0);
  await page.reload();
  await live(page);
  expect(await button(page)).toEqual({ presses: 0, rung: 0, reached: 0 });
  expect(w.errors).toEqual([]);
});
