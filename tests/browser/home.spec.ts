import { expect, test, type Page, type Request } from '@playwright/test';

// The home page `/` (P3 B1; REWRITE.md § 2, § B3, § B6, § B7, § E7, § E9): the strip, the picture, the stage,
// Read, the tiers, the restart. Engine-neutral on purpose (no CDP, no channel, nothing Chromium-only): the same
// file runs in Firefox and WebKit, where the renderer is often software, so the stage is asked for with `?tier=`
// (a software renderer is otherwise the Still tier). It runs against the built site (playwright.config.ts).

/**
 * What the Still tier must never ask for: the stage's scripts, the physics engine (its script and its wasm),
 * the bake table, the label painters and their fonts. (The physics ADAPTER's small chunk, `physics.*.js`, is
 * fetched by every page's first script today: the bundler puts its dynamic-import helper there. Not the
 * engine; reported to the lead with the one-line config change that would move it.)
 */
const HEAVY = [/\/_astro\/home\.[^/]*\.js$/, /\/_astro\/three\.[^/]*\.js$/, /\/_astro\/rapier\.[^/]*\.js$/, /\/_astro\/stations\.[^/]*\.js$/, /\/_astro\/pieces\.[^/]*\.js$/, /\/_astro\/early\.[^/]*\.js$/, /\.wasm(\?|$)/, /bake-table/, /\/_astro\/worker-/, /\/fonts\/workshop-(stencil|print|sign)\.woff2/];
/** The dev page's hooks: none of them on `/`. */
const DEV_HOOKS = ['__bench', '__vignette', '__ready', '__workshop'];
const SECTIONS = ['patchlamp', 'services', 'about', 'contact'] as const;
/** Small, so a software renderer in another engine keeps up. */
const STAGE_VIEW = { width: 640, height: 400 };

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
  page.waitForFunction(() => (window as unknown as { __handoff?: { phase: string } }).__handoff?.phase === 'live', null, { timeout: 120_000, polling: 100 });
const mode = (page: Page): Promise<string> => page.evaluate(() => document.documentElement.className);
const scrolls = (page: Page): Promise<boolean> =>
  page.evaluate(async () => {
    window.scrollTo(0, 400);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const moved = window.scrollY > 0;
    window.scrollTo(0, 0);
    return moved;
  });
/** Is the stage's canvas drawing something (not one flat colour)? Read in the frame it was drawn. */
const canvasNotBlank = (page: Page): Promise<number> =>
  page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        requestAnimationFrame(() => {
          const c = document.getElementById('stage') as HTMLCanvasElement;
          const g = document.createElement('canvas');
          g.width = 64;
          g.height = 40;
          const x = g.getContext('2d')!;
          x.drawImage(c, 0, 0, 64, 40);
          const d = x.getImageData(0, 0, 64, 40).data;
          const seen = new Set<number>();
          for (let i = 0; i < d.length; i += 4) seen.add((d[i]! >> 3) * 1024 + (d[i + 1]! >> 3) * 32 + (d[i + 2]! >> 3));
          resolve(seen.size);
        });
      }),
  );

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the strip, the picture, the paperwork’s four sections and the legal line; the page scrolls; the first Tab stop is the way to the paperwork', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    await expect(page.locator('h1')).toHaveText(/Taylor Remund\s*software engineer\s*I build and run Patchlamp/);
    for (const name of ['Résumé', 'GitHub', 'LinkedIn', 'Email']) await expect(page.getByRole('navigation').getByRole('link', { name, exact: true })).toBeVisible();
    const img = page.locator('img.poster');
    await expect(img).toBeVisible();
    expect(await img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    // at full brightness: no warm-up without a script
    expect(await img.evaluate((i) => getComputedStyle(i).filter)).toBe('none');
    for (const id of SECTIONS) await expect(page.locator(`#paperwork section#${id} h2`)).toHaveCount(1);
    expect(await scrolls(page)).toBe(true);
    await page.keyboard.press('Tab');
    const first = await page.evaluate(() => ({ href: document.activeElement?.getAttribute('href'), text: document.activeElement?.textContent }));
    expect(first.href).toBe('#paperwork');
    for (const [name, href] of [['Privacy', '/privacy/'], ['Terms', '/terms/'], ['SMS', '/sms/']]) await expect(page.locator('footer').getByRole('link', { name, exact: true })).toHaveAttribute('href', href!);
    // nothing of the stage's is shown without it
    await expect(page.locator('button.sound')).toBeHidden();
    await expect(page.locator('button.restart')).toBeHidden();
  });
});

test.describe('the stage', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(240_000);

  test('up: the canvas draws, the page does not scroll, the strip’s links are there, no dev hook, nothing leaves the site, no error', async ({ page, baseURL }) => {
    const w = watch(page, new URL(baseURL!).origin);
    await page.setViewportSize(STAGE_VIEW);
    await page.goto('/?tier=low');
    await live(page);
    expect(await mode(page)).toContain('stage-on');
    expect(await page.evaluate(() => document.documentElement.dataset.tier)).toBe('low');
    expect(await canvasNotBlank(page)).toBeGreaterThan(20);
    expect(await scrolls(page)).toBe(false);
    const hrefs = await page.getByRole('navigation').getByRole('link').evaluateAll((as) => as.map((a) => [a.textContent, a.getAttribute('href')]));
    expect(hrefs).toEqual([
      ['Résumé', '/resume/'],
      ['GitHub', 'https://github.com/Taylor-Rem'],
      ['LinkedIn', 'https://linkedin.com/in/taylor-remund-88169124a'],
      ['Email', 'mailto:remundtaylor3@gmail.com'],
    ]);
    const hooks = await page.evaluate((names) => names.filter((n) => n in window), DEV_HOOKS);
    expect(hooks).toEqual([]);
    expect(w.foreign).toEqual([]);
    expect(w.errors).toEqual([]);
    // the strip's links work over the stage (nothing covers them); the résumé is still the legacy page, which
    // asks other origins for its fonts and icons (REWRITE.md § 1): not judged here
    await page.getByRole('navigation').getByRole('link', { name: 'Résumé', exact: true }).click();
    await page.waitForURL(/\/resume\/$/);
  });

  test('Read swaps the stage for the paperwork (the stage stops) and the way back brings it back', async ({ page, baseURL }) => {
    const w = watch(page, new URL(baseURL!).origin);
    await page.setViewportSize(STAGE_VIEW);
    await page.goto('/?tier=low');
    await live(page);
    const running = (): Promise<boolean> => page.evaluate(() => (window as unknown as { __handoff: { workshop: { loop: { running: boolean } } } }).__handoff.workshop.loop.running);
    expect(await running()).toBe(true);
    await page.getByRole('link', { name: 'Read', exact: true }).click();
    await expect(page.locator('html')).toHaveClass(/reading/);
    await expect(page.locator('#paperwork h2').first()).toBeVisible();
    await expect(page.locator('#stage-root')).toBeHidden();
    expect(await scrolls(page)).toBe(true);
    await expect.poll(running).toBe(false);
    const back = page.getByRole('link', { name: 'Back to the workshop', exact: true });
    await expect(back).toBeVisible();
    await back.click();
    await expect(page.locator('html')).not.toHaveClass(/reading/);
    await expect(page.locator('#stage-root')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Read', exact: true })).toBeFocused();
    await expect.poll(running).toBe(true);
    expect(new URL(page.url()).hash).toBe('');
    // Read again, then the browser's Back
    await page.getByRole('link', { name: 'Read', exact: true }).click();
    await expect(page.locator('html')).toHaveClass(/reading/);
    await page.goBack();
    await expect(page.locator('html')).not.toHaveClass(/reading/);
    await expect.poll(running).toBe(true);
    expect(w.errors).toEqual([]);
  });

  test('an address naming a section opens the paperwork there, on arrival and later; Back returns to the stage', async ({ page }) => {
    await page.setViewportSize(STAGE_VIEW);
    // on arrival
    await page.goto('/?tier=low#contact');
    await expect(page.locator('html')).toHaveClass(/reading/);
    await expect(page.locator('#contact h2')).toBeInViewport();
    await live(page);
    // the stage came up behind the paperwork and does not run there
    await expect.poll(() => page.evaluate(() => (window as unknown as { __handoff: { workshop: { loop: { running: boolean } } } }).__handoff.workshop.loop.running)).toBe(false);
    // later, from the stage
    await page.goto('/?tier=low');
    await live(page);
    for (const id of SECTIONS) {
      await page.goto(`/?tier=low#${id}`);
      await expect(page.locator('html')).toHaveClass(/reading/);
      await expect(page.locator(`#${id} h2`)).toBeInViewport();
      await page.goBack();
      await expect(page.locator('html')).not.toHaveClass(/reading/);
      await expect(page.locator('#stage-root')).toBeVisible();
    }
  });

  test('the sound toggle says its state and is remembered', async ({ page }) => {
    await page.setViewportSize(STAGE_VIEW);
    await page.goto('/?tier=low');
    const sound = page.getByRole('button', { name: 'Sound', exact: true });
    await expect(sound).toBeVisible();
    const was = await sound.getAttribute('aria-pressed');
    await sound.click();
    const now = was === 'true' ? 'false' : 'true';
    await expect(sound).toHaveAttribute('aria-pressed', now);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Sound', exact: true })).toHaveAttribute('aria-pressed', now);
    await page.getByRole('button', { name: 'Sound', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sound', exact: true })).toHaveAttribute('aria-pressed', was!);
  });

  test('a graphics context lost for good: the picture, the plain document and a restart button that brings the stage back', async ({ page }) => {
    await page.setViewportSize(STAGE_VIEW);
    await page.goto('/?tier=low');
    await live(page);
    await page.evaluate(() => {
      const ws = (window as unknown as { __handoff: { workshop: { stage: { renderer: { getContext(): WebGLRenderingContext } } } } }).__handoff.workshop;
      ws.stage.renderer.getContext().getExtension('WEBGL_lose_context')!.loseContext();
    });
    await page.waitForFunction(() => (window as unknown as { __handoff: { phase: string } }).__handoff.phase === 'failed', null, { timeout: 20_000 });
    await expect(page.locator('html')).toHaveClass(/still/);
    await expect(page.locator('html')).not.toHaveClass(/stage-on/);
    await expect(page.locator('img.poster')).toBeVisible();
    expect(await scrolls(page)).toBe(true);
    const restart = page.getByRole('button', { name: 'Start the workshop again', exact: true });
    await expect(restart).toBeVisible();
    await restart.click();
    await live(page);
    await expect(restart).toBeHidden();
    expect(await mode(page)).toContain('stage-on');
    expect(await canvasNotBlank(page)).toBeGreaterThan(20);
    expect(await scrolls(page)).toBe(false);
  });
});

test.describe('the Still tier', () => {
  for (const [name, setup, query] of [
    ['WebGL 2 refused', true, ''],
    ['?tier=still', false, '?tier=still'],
  ] as const) {
    test(`${name}: the plain document, and nothing heavy is asked for`, async ({ page, baseURL }) => {
      const w = watch(page, new URL(baseURL!).origin);
      if (setup) {
        await page.addInitScript(() => {
          const get = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
            if (type === 'webgl2') return null;
            return (get as (...a: unknown[]) => unknown).call(this, type, ...rest);
          } as typeof get;
        });
      }
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto(`/${query}`, { waitUntil: 'load' });
      await page.waitForTimeout(1500);
      expect(await page.evaluate(() => document.documentElement.dataset.tier)).toBe('still');
      expect(await mode(page)).toContain('still');
      expect(await mode(page)).not.toContain('stage-on');
      expect(await mode(page)).not.toContain('warming');
      await expect(page.locator('img.poster')).toBeVisible();
      expect(await page.locator('img.poster').evaluate((i) => getComputedStyle(i).filter)).toBe('none');
      expect(await scrolls(page)).toBe(true);
      for (const id of SECTIONS) await expect(page.locator(`#${id} h2`)).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Sound', exact: true })).toBeHidden();
      const heavy = w.requests.filter((u) => HEAVY.some((re) => re.test(u)));
      expect(heavy).toEqual([]);
      expect(w.foreign).toEqual([]);
      expect(w.errors).toEqual([]);
    });
  }
});
