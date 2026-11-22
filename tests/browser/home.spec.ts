import type { Page } from '@playwright/test';
import { test, expect, ENGINES, HEAVY, watch, live } from './engines/engine.ts';

// The home page `/` (P3 B1; REWRITE.md § 2, § B3, § B6, § B7, § E7, § E9): the strip, the picture, the stage,
// Read, the tiers, the restart. In every engine (every test here carries ENGINES): no CDP, no channel of its
// own; engine.ts's `test` gives Chromium system Chrome on the GPU and the others their own builds. The stage is
// asked for with `?tier=low` in every engine (a software renderer is otherwise the Still tier), on a small
// screen. It runs against the built site (playwright.config.ts).

/** The dev page's hooks: none of them on `/`. */
const DEV_HOOKS = ['__bench', '__vignette', '__ready', '__workshop'];
const SECTIONS = ['patchlamp', 'services', 'about', 'contact'] as const;
/** Small, so a software renderer in another engine keeps up. */
const STAGE_VIEW = { width: 640, height: 400 };

const mode = (page: Page): Promise<string> => page.evaluate(() => document.documentElement.className);
const scrolls = (page: Page): Promise<boolean> =>
  // synchronous (an instant scroll is): with JavaScript off the page's animation frames never come
  page.evaluate(() => {
    window.scrollTo({ top: 400, behavior: 'instant' });
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

test.describe('without JavaScript', { tag: ENGINES }, () => {
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

  test('P3 B3: the settings control and its panel need a script: neither is shown without one', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('button.settings-open')).toBeHidden();
    await expect(page.locator('#settings')).toBeHidden();
  });
});

test.describe('P3 B3: the strip on a phone held upright', { tag: ENGINES }, () => {
  // (Playwright's Firefox has no mobile emulation: with `isMobile` its window never takes the phone's size and
  // the test hangs in setViewportSize. Firefox gets the phone's screen and touch, the others a phone too.)
  test.use({ hasTouch: true, isMobile: async ({ browserName }, use) => use(browserName !== 'firefox'), viewport: { width: 390, height: 844 } });

  test('Résumé, Read, sound and settings in the strip, every target 44 px, nothing over the sign', async ({ page }) => {
    await page.goto('/?tier=still');
    // the stage's layout of the strip, without drawing the bench (the strip is the same HTML either way)
    await page.evaluate(() => document.documentElement.classList.replace('still', 'stage-on'));
    const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
    const sound = await box('button.sound');
    const settings = await box('button.settings-open');
    const read = await box('a.read');
    const resume = await box('.strip nav a[href="/resume/"]');
    for (const b of [sound, settings]) expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44);
    // the two squares side by side, not one over the other
    expect(settings.x).toBeGreaterThanOrEqual(sound.x + sound.width - 0.5);
    // (Read, like every link in the row, is 44 px tall and as wide as its word)
    expect(read.height).toBeGreaterThanOrEqual(44);
    // one row: Read, the sound and the settings on the links' line, inside the screen
    expect(Math.abs(sound.y + sound.height / 2 - (read.y + read.height / 2))).toBeLessThan(4);
    expect(Math.abs(settings.y + settings.height / 2 - (read.y + read.height / 2))).toBeLessThan(4);
    expect(settings.x + settings.width).toBeLessThanOrEqual(390);
    expect(resume.y + resume.height).toBeLessThan(140);
    await expect(page.getByRole('button', { name: 'Sound', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  });
});

test.describe('the stage', { tag: ENGINES }, () => {
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
    // later, from the stage (`#patchlamp` names a station too: with the stage it frames it, keyboard.spec.ts)
    await page.goto('/?tier=low');
    await live(page);
    for (const id of SECTIONS.filter((s) => s !== 'patchlamp')) {
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

test.describe('the Still tier', { tag: ENGINES }, () => {
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
      // (P3 B2) no stage, no controls list: nothing of it is shown or reachable
      await expect(page.locator('#controls')).toBeHidden();
      await expect(page.locator('button.controls-opener')).toBeHidden();
      const heavy = w.requests.filter((u) => HEAVY.some((re) => re.test(u)));
      expect(heavy).toEqual([]);
      expect(w.foreign).toEqual([]);
      expect(w.errors).toEqual([]);
    });
  }

  test('without the stage every section’s address is its plain anchor, a station’s (#patchlamp) too', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    for (const id of SECTIONS) {
      await page.goto(`/?tier=still#${id}`, { waitUntil: 'load' });
      await expect(page.locator(`#${id} h2`)).toBeInViewport();
      expect(await mode(page)).not.toContain('reading');
    }
  });
});

// P4 A3: the paperwork filled from the live home page. What it says is held by check-text (against main) and by
// tests/unit/paper/home.test.ts; here, that it is all there and readable in each state that shows it.
/** Requests for what only the paperwork uses: its two Plex faces and its two pictures. */
const PAPER_ASSETS = [/IBMPlexSans-/, /exchange-room-/, /\/assets\/taylor\.jpg/];
const paperworkComplete = async (page: Page): Promise<void> => {
  const pw = page.locator('#paperwork');
  await expect(pw.locator('#patchlamp')).toContainText('Patch takes chores off your hands');
  await expect(pw.locator('#patchlamp a[href="https://patchlamp.com/pricing"]')).toHaveCount(1);
  // the prices are /ai/'s, whole
  await expect(pw.locator('#services .pw-rate-price')).toHaveText(['$150', '$500–$1,500']);
  await expect(pw.locator('#services .pw-rate-note')).toHaveText(['60 minutes · $250 for a 2-hour deep dive', 'one-time install · optional care plan $79/mo']);
  await expect(pw.locator('#services a[href="/ai/"]')).toHaveCount(1);
  await expect(pw.locator('#about a[href="/resume/"]')).toHaveCount(1);
  for (const href of ['https://github.com/Taylor-Rem', 'https://linkedin.com/in/taylor-remund-88169124a', 'mailto:remundtaylor3@gmail.com']) {
    await expect(pw.locator(`#contact a[href="${href}"]`)).toHaveCount(1);
  }
  await expect(pw.locator('#contact a[href^="mailto:"]')).toHaveAttribute('data-mail', '');
  // the pictures wait below the first screen, their sizes set so nothing moves when they come
  for (const img of await pw.locator('img').all()) {
    await expect(img).toHaveAttribute('loading', 'lazy');
    expect(Number(await img.getAttribute('width'))).toBeGreaterThan(0);
    expect(Number(await img.getAttribute('height'))).toBeGreaterThan(0);
  }
  // nothing scrolls sideways
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
};

test.describe('P4 A3: the paperwork', { tag: ENGINES }, () => {
  for (const width of [390, 1280]) {
    test(`?tier=still at ${width}: every section is there, on paper, readable`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/?tier=still', { waitUntil: 'load' });
      await paperworkComplete(page);
      const [bg, fg] = await page.locator('#paperwork').evaluate((e) => [getComputedStyle(e).backgroundColor, getComputedStyle(e).color]);
      expect(bg).not.toBe(fg);
      // the pictures come when they are reached, and arrive whole
      await page.locator('#about img').scrollIntoViewIfNeeded();
      await expect.poll(() => page.locator('#paperwork img').evaluateAll((is) => is.every((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0))).toBe(true);
    });
  }

  test('with the stage, the paperwork is not laid out and its faces and pictures are not fetched until Read', async ({ page, baseURL }) => {
    test.setTimeout(240_000);
    const w = watch(page, new URL(baseURL!).origin);
    await page.setViewportSize(STAGE_VIEW);
    await page.goto('/?tier=low');
    await live(page);
    await expect(page.locator('#paperwork')).toBeHidden();
    expect(w.requests.filter((u) => PAPER_ASSETS.some((re) => re.test(u)))).toEqual([]);
    await page.getByRole('link', { name: 'Read', exact: true }).click();
    await paperworkComplete(page);
    await expect.poll(() => w.requests.filter((u) => /IBMPlexSans-/.test(u)).length).toBeGreaterThan(0);
    expect(w.foreign).toEqual([]);
    expect(w.errors).toEqual([]);
  });
});

test.describe('P4 A3: the paperwork without JavaScript', { tag: ENGINES }, () => {
  test.use({ javaScriptEnabled: false });
  test('every section is there; each section’s address opens it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await paperworkComplete(page);
    for (const id of SECTIONS) {
      await page.goto(`/#${id}`);
      await expect(page.locator(`#${id} h2`)).toBeInViewport();
    }
  });
});

test.describe('without JavaScript, a station’s address', { tag: ENGINES }, () => {
  test.use({ javaScriptEnabled: false });
  test('#patchlamp is the section’s plain anchor', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/#patchlamp');
    await expect(page.locator('#patchlamp h2')).toBeInViewport();
  });
});
