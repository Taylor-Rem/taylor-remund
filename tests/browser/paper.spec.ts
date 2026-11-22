import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ENGINES } from '../../playwright.config.ts';

// The paper pages (REWRITE.md § F1, § E7 "Conventional pages", § E9): /resume/,
// /ai/, the case study, the compliance pages and the 404. Engine-neutral: nothing here is
// Chromium-only, so it runs as written in Firefox and WebKit (every test carries ENGINES). No stage, so
// each engine's own build (Playwright's Chromium in the chromium project).

const PAGES: { path: string; anchors: string[] }[] = [
  { path: '/resume/', anchors: ['about', 'skills', 'projects', 'patchlamp', 'experience', 'contact'] },
  { path: '/ai/', anchors: ['hero', 'how', 'packages', 'patchlamp', 'why', 'faq', 'contact'] },
  { path: '/case-studies/ledger-repair/', anchors: ['ledger-repair'] },
  { path: '/privacy/', anchors: [] },
  { path: '/terms/', anchors: [] },
  { path: '/sms/', anchors: [] },
  { path: '/career-send/', anchors: [] },
  { path: '/404.html', anchors: [] },
];

interface Watch {
  requests: string[];
  scripts: string[];
  consoleErrors: string[];
  failed: string[];
}

function watch(page: Page, origin: string): Watch {
  const w: Watch = { requests: [], scripts: [], consoleErrors: [], failed: [] };
  page.on('request', (req) => {
    w.requests.push(req.url());
    if (req.resourceType() === 'script') w.scripts.push(req.url());
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') w.consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => w.consoleErrors.push(err.message));
  page.on('requestfailed', (req) => w.failed.push(`${req.url()} ${req.failure()?.errorText}`));
  page.on('response', (res) => {
    if (res.url().startsWith(origin) && res.status() >= 400) w.failed.push(`${res.url()} ${res.status()}`);
  });
  return w;
}

/** Every element's motion: true when nothing animates or transitions. */
async function stillness(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const moving: string[] = [];
    for (const el of Array.from(document.querySelectorAll('*'))) {
      for (const pseudo of [null, '::before', '::after']) {
        const s = getComputedStyle(el, pseudo);
        const durations = (s.transitionDuration || '0s').split(',').map((d) => parseFloat(d));
        if (s.animationName && s.animationName !== 'none') moving.push(`${el.tagName}${pseudo ?? ''} animation ${s.animationName}`);
        if (durations.some((d) => d > 0)) moving.push(`${el.tagName}${pseudo ?? ''} transition ${s.transitionDuration}`);
      }
    }
    return moving;
  });
}

for (const { path, anchors } of PAGES) {
  test.describe(path, { tag: ENGINES }, () => {
    test('loads with no console error, no failed request, nothing from another origin, no script', async ({ page, baseURL }) => {
      const origin = new URL(baseURL!).origin;
      const w = watch(page, origin);
      const response = await page.goto(path, { waitUntil: 'load' });
      expect(response?.status()).toBe(200);
      await page.waitForLoadState('networkidle');
      await page.evaluate(() => document.fonts.ready);
      expect(w.consoleErrors).toEqual([]);
      expect(w.failed).toEqual([]);
      expect(w.requests.filter((u) => !u.startsWith(origin) && !u.startsWith('data:'))).toEqual([]);
      expect(w.scripts).toEqual([]);
      expect(await page.locator('script:not([type="application/ld+json"])').count()).toBe(0);
    });

    test('every § 2 anchor resolves to one element', async ({ page }) => {
      await page.goto(path);
      for (const a of anchors) await expect(page.locator(`[id="${a}"]`), `#${a}`).toHaveCount(1);
    });

    for (const width of [320, 390, 1280]) {
      test(`does not scroll sideways at ${width} wide`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(path);
        await page.evaluate(() => document.fonts.ready);
        const [scroll, inner] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
        expect(scroll).toBeLessThanOrEqual(inner);
      });
    }

    test('nothing moves, with or without prefers-reduced-motion', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.goto(path);
      expect(await stillness(page)).toEqual([]);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      expect(await stillness(page)).toEqual([]);
    });

    test('the keyboard reaches every link in order, and focus is visible', async ({ page, browserName }) => {
      await page.goto(path);
      const expected = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
          .filter((a) => a.getClientRects().length > 0 || a.classList.contains('skip'))
          .map((a) => a.getAttribute('href') + ' ' + (a.textContent ?? '').trim()),
      );
      // WebKit on macOS skips links on Tab unless Alt is held; elsewhere Tab reaches them.
      const key = browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab';
      const reached: string[] = [];
      const invisible: string[] = [];
      for (let i = 0; i < expected.length; i++) {
        await page.keyboard.press(key);
        const f = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el.tagName !== 'A') return null;
          const s = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return {
            id: el.getAttribute('href') + ' ' + (el.textContent ?? '').trim(),
            outlined: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2,
            onScreen: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight,
          };
        });
        if (!f) break;
        reached.push(f.id);
        if (!f.outlined || !f.onScreen) invisible.push(f.id);
      }
      expect(reached).toEqual(expected);
      expect(invisible).toEqual([]);
    });
  });
}

for (const path of ['/resume/', '/ai/', '/case-studies/ledger-repair/']) test(`${path} links are at least 44 px tall to a finger, at 390 wide`, { tag: ENGINES }, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(path);
  const small = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]:not(.skip)'))
      .filter((a) => a.getClientRects().length > 0)
      .map((a) => ({ t: (a.textContent ?? '').trim(), h: a.getBoundingClientRect().height }))
      .filter((x) => x.h < 43.5)
      .map((x) => `${x.t} ${x.h.toFixed(1)}`),
  );
  expect(small).toEqual([]);
});

// Prices are commitments (CLAUDE.md § Content rules): each one is set on one line with its unit,
// at every width; the package prices are the largest type in their entries.
for (const width of [320, 390, 1280]) {
  test(`/ai/ prices never break apart from their units, at ${width} wide`, { tag: ENGINES }, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/ai/');
    await page.evaluate(() => document.fonts.ready);
    const broken = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('.price, .package-note .part'))
        // on more than one line: its boxes do not all share one top (an inline box with a child has several boxes on one line)
        .filter((el) => new Set(Array.from(el.getClientRects()).map((r) => Math.round(r.top))).size > 1)
        .map((el) => el.textContent ?? ''),
    );
    expect(broken).toEqual([]);
    const largest = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('.package')).map((entry) => {
        const size = (el: Element): number => parseFloat(getComputedStyle(el).fontSize);
        const price = entry.querySelector('.package-price')!;
        const others = Array.from(entry.querySelectorAll('*')).filter((el) => !price.contains(el) && !el.contains(price));
        return others.every((el) => size(el) < size(price));
      }),
    );
    expect(largest).toEqual([true, true]);
  });
}
