import { expect, test, type Page } from '@playwright/test';
import { startDevServer, type DevServer } from '../../scripts/capture.ts';

// /dev/phone/: the texting panel over a still of the bench, on the scripted
// fake line (U brief § Deliver). Dev pages exist only in `astro dev`, so this
// file starts its own dev server. No WebGL here: Playwright's own Chromium.

test.describe.configure({ mode: 'serial' });

let server: DevServer;
test.beforeAll(async () => {
  server = await startDevServer();
});
test.afterAll(() => server?.stop());

const WIDE = { width: 1440, height: 900 };
const UPRIGHT = { width: 390, height: 844 };

async function open(page: Page, query = ''): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|404 \(Not Found\)/.test(m.text())) errors.push(m.text());
  });
  await page.goto(`${server.origin}/dev/phone/${query}`);
  await page.waitForFunction('window.__ready === true', null, { timeout: 60_000 });
  return errors;
}

const panel = (page: Page) => page.getByRole('dialog', { name: 'Phone: texting Patch' });

test('closed, there is nothing but the stage', async ({ page }) => {
  await page.setViewportSize(WIDE);
  const errors = await open(page);
  await expect(panel(page)).toBeHidden();
  expect(errors).toEqual([]);
});

test('the phone opens it: the attract exchange, the line, focus on the first ready-made text; Esc puts it down', async ({ page }) => {
  await page.setViewportSize(WIDE);
  const errors = await open(page, '?motion=reduce');
  await page.locator('#phone-hit').focus();
  await page.keyboard.press('Enter');
  const p = panel(page);
  await expect(p).toBeVisible();
  await expect(p.locator('.ph-tape')).toHaveText('Storefront line');
  await expect(p.locator('.ph-sent .ph-words').first()).toHaveText('Make it blue.');
  await expect(p.locator('.ph-answer .ph-words').first()).toContainText('Painted it blue.');
  await expect(page.locator(':focus')).toHaveText('Make the sign red.');
  await page.keyboard.press('Escape');
  await expect(p).toBeHidden();
  await expect(page.locator(':focus')).toHaveId('phone-hit');
  expect(errors).toEqual([]);
});

test('a ready-made text: sent, working (lamp lit), then the reply, announced', async ({ page }) => {
  await page.setViewportSize(WIDE);
  await open(page, '?open=1&pickup=100&work=600');
  const p = panel(page);
  await p.getByRole('button', { name: 'Make the sign red.' }).click();
  await expect(p.locator('.ph-sent .ph-words').last()).toHaveText('Make the sign red.');
  await expect(p.locator('.ph-working')).toHaveCount(1);
  await expect(p).toHaveClass(/ph-busy/);
  await expect(p.locator('.ph-answer .ph-words').last()).toHaveText("Sign's red. I checked. Patched.");
  await expect(p.locator('.ph-working')).toHaveCount(0);
  await expect(p.getByRole('status')).toHaveText("Sign's red. I checked. Patched.");
});

test('typing: 16 px, 240 at most, Enter sends, a refusal tells the truth, nothing leaves the page', async ({ page }) => {
  await page.setViewportSize(WIDE);
  const requests: string[] = [];
  await open(page, '?open=1&jack=lamp&pickup=50&work=100');
  page.on('request', (r) => requests.push(r.url()));
  const field = panel(page).getByRole('textbox', { name: 'Your text to Patch' });
  expect(await field.evaluate((e) => getComputedStyle(e).fontSize)).toBe('16px');
  await expect(field).toHaveAttribute('maxlength', '240');
  await field.fill('Make the sign red.');
  await field.press('Enter');
  await expect(field).toHaveValue('');
  await expect(field).toBeFocused();
  const last = panel(page).locator('.ph-answer').last();
  await expect(last.locator('.ph-words')).toHaveText("That's outside this folder. Plug me into it first.");
  await expect(last).toHaveClass(/ph-refused/);
  await field.fill('x'.repeat(230));
  await expect(panel(page).locator('.ph-count')).toHaveText('10 left');
  expect(requests.filter((u) => !u.startsWith(server.origin))).toEqual([]);
});

test('moving the cord renames the line and changes the ready-made texts; unplugged, nothing can be sent', async ({ page }) => {
  await page.setViewportSize(WIDE);
  await open(page, '?open=1');
  const p = panel(page);
  await page.evaluate(() => (window as any).__phone.plug('belt'));
  await expect(p.locator('.ph-tape')).toHaveText('Belt line');
  await expect(p.getByRole('button', { name: 'Go faster.' })).toBeVisible();
  await expect(p.getByRole('status')).toHaveText('Now on the belt line.');
  await page.evaluate(() => (window as any).__phone.plug(null));
  await expect(p.locator('.ph-tape')).toHaveText('Not plugged in');
  await expect(p.locator('.ph-key')).toHaveCount(0);
  await expect(p.getByRole('textbox')).toBeDisabled();
});

test('on a wide screen it stands clear of the station on the line', async ({ page }) => {
  await page.setViewportSize(WIDE);
  await open(page, '?open=1&jack=storefront&motion=reduce');
  const box = async () => (await panel(page).boundingBox())!;
  expect((await box()).x).toBeLessThan(WIDE.width / 2); // storefront is on the right
  await page.evaluate(() => (window as any).__phone.plug('lamp'));
  await expect.poll(async () => (await box()).x).toBeGreaterThan(WIDE.width / 2); // the lamp is on the left
});

test('upright: a bottom sheet no taller than 45%, nothing off the side, every target 44 px', async ({ page }) => {
  await page.setViewportSize(UPRIGHT);
  await open(page, '?open=1&motion=reduce');
  const b = (await panel(page).boundingBox())!;
  expect(b.height).toBeLessThanOrEqual(UPRIGHT.height * 0.45 + 1);
  expect(b.y + b.height).toBeCloseTo(UPRIGHT.height, 0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(UPRIGHT.width);
  const sizes = await panel(page)
    .locator('button, input')
    .evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent, w: r.width, h: r.height }; }));
  for (const s of sizes) {
    expect(s.h, String(s.t)).toBeGreaterThanOrEqual(44);
    expect(s.w, String(s.t)).toBeGreaterThanOrEqual(44);
  }
  for (const name of ['Put the phone down', 'Send']) {
    const r = (await panel(page).getByRole('button', { name }).boundingBox())!;
    expect(r.x + r.width).toBeLessThanOrEqual(UPRIGHT.width);
  }
});

test('focus is never trapped: Tab walks out of the panel', async ({ page }) => {
  await page.setViewportSize(WIDE);
  await open(page, '?open=1');
  await panel(page).getByRole('button', { name: 'Send' }).focus();
  await page.keyboard.press('Tab');
  const inside = await page.evaluate(() => !!document.activeElement?.closest('.ph'));
  expect(inside).toBe(false);
});
