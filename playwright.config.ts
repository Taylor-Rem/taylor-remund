import { defineConfig, devices } from '@playwright/test';
import { xvfbPath } from './tests/browser/display.ts';

/**
 * Browser tests (REWRITE.md § E8). Three projects:
 *
 *   chromium   every spec (the engine-neutral set, smoke, and the Chromium-only specs that measure a hand on
 *              the real GPU through system Chrome, GPU flags and CDP: input, feel, juggling, timing).
 *   firefox    the engine-neutral set only (ENGINE_NEUTRAL below).
 *   webkit     the engine-neutral set only.
 *
 * `npx playwright test` runs all three. On this machine ONE browser runs at a time: always `--workers=1` (the
 * projects then run one after another, never two engines at once), behind the browser lock:
 *
 *   flock /home/tweenson/taylorremund.com/shots/p2/lead/browser.lock npx playwright test --workers=1
 *   … npx playwright test --workers=1 --project=firefox                       one engine
 *   … npx playwright test --workers=1 --project=chromium tests/browser/engines  the set, in Chromium
 *
 * The config's web server builds the site (`astro build`, then `astro preview`) for the specs that test the
 * built output (smoke). With PW_SKIP_BUILD=1 it previews the dist/ already there (build it first, under the
 * heavy lock: `flock …/heavy.lock npx astro build`). The engine-neutral set starts its own dev server
 * (tests/browser/engines/bench.ts says where the bench lives).
 *
 * Launch settings, and why (found 2026-11-21, E1):
 *   - Firefox: headless Firefox has no WebGL at all on Linux here ("AllowWebgl2:false restricts context
 *     creation", then "Exhausted GL driver options" with webgl.force-enabled): no preference changes that.
 *     Headed Firefox on an X display gets WebGL2 from Mesa's llvmpipe. So the firefox project runs headed, and
 *     the global setup (tests/browser/display.ts) starts a private Xvfb display for the run when Xvfb is
 *     installed (never a window on a real desktop). Without Xvfb it falls back to $DISPLAY, else headless: the
 *     bench specs then fail with a message that says so.
 *   - WebKit: headless WebKit gives WebGL2 (software); no settings.
 *   - Chromium: headless Chromium gives WebGL2 through SwiftShader; no settings. The Chromium-only specs ask
 *     for system Chrome and the GPU themselves (`gpuArgs` below).
 *
 * @playwright/test is pinned to 1.61.1: its Chromium (1228), Firefox (1532) and WebKit (2311) builds are in
 * ~/.cache/ms-playwright.
 */

/**
 * Measured on the reference laptop: Playwright's headless Chromium renders
 * WebGL with SwiftShader (software). System Chrome with these flags gets the
 * real GPU (AMD RADV). Use with `channel: 'chrome'` for perf and look tests:
 *   use: { channel: 'chrome', launchOptions: { args: gpuArgs } }
 */
export const gpuArgs = ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'];

/**
 * The specs every engine runs. A spec in tests/browser/engines/ is in the set by being there; the two others
 * are named. Everything else under tests/browser/ is Chromium only.
 */
export const ENGINE_NEUTRAL = ['engines/**/*.spec.ts', 'smoke.spec.ts', 'paper.spec.ts'];

// Not Astro's default 4321, so a running `npm run dev` or `preview` never
// stands in for a fresh build. Override with PW_PORT.
const PORT = Number(process.env.PW_PORT ?? 4417);

export default defineConfig({
  testDir: 'tests/browser',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  globalSetup: './tests/browser/display.ts',
  use: {
    baseURL: `http://localhost:${PORT}`,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // headed on the private display the global setup starts (see the header); headless only with no display at all
    { name: 'firefox', testMatch: ENGINE_NEUTRAL, use: { ...devices['Desktop Firefox'], headless: !(xvfbPath() || process.env.DISPLAY) } },
    { name: 'webkit', testMatch: ENGINE_NEUTRAL, use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    // Astro 7 sends `astro preview` to the background when it detects it is
    // run by an agent; `--ignore-lock` keeps it in the foreground so
    // Playwright owns it and stops it.
    command: `${process.env.PW_SKIP_BUILD === '1' ? '' : 'npx astro build && '}npx astro preview --ignore-lock --port ${PORT}`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { ASTRO_TELEMETRY_DISABLED: '1' },
  },
});
