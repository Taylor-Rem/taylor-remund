import { expect, test } from '@playwright/test';

// The built site loads: no console error and no failed request to this site.
// /resume/ is still the legacy page, which loads Google Fonts and
// cdn.simpleicons.org (REWRITE.md § 1); those are third-party and not judged
// here, so console messages are attributed by the URL they came from.
for (const path of ['/', '/resume/', '/privacy/']) {
  test(`${path} loads cleanly`, async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    const sameOrigin = (url: string) => url === '' || url.startsWith(origin);
    const consoleErrors: string[] = [];
    const failed: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error' && sameOrigin(msg.location().url)) consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));
    page.on('requestfailed', (req) => {
      if (sameOrigin(req.url())) failed.push(`${req.url()} ${req.failure()?.errorText}`);
    });
    page.on('response', (res) => {
      if (sameOrigin(res.url()) && res.status() >= 400) failed.push(`${res.url()} ${res.status()}`);
    });

    const response = await page.goto(path, { waitUntil: 'load' });
    expect(response?.status()).toBe(200);
    await page.waitForLoadState('networkidle');

    expect(consoleErrors).toEqual([]);
    expect(failed).toEqual([]);
  });
}
