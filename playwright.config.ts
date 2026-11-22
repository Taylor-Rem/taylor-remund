import { defineConfig, devices } from '@playwright/test';
import { xvfbPath } from './tests/browser/display.ts';

/**
 * Browser tests (REWRITE.md § E8). Three projects:
 *
 *   chromium   every spec (the engine set, and the Chromium-only specs that measure a hand on the real GPU
 *              through system Chrome, GPU flags and CDP: input, feel, juggling, timing).
 *   firefox    the engine set only: every test tagged ENGINES ('@engines').
 *   webkit     the engine set only.
 *
 * Everything runs against the BUILT site: the config's web server builds it (`astro build`, then `astro
 * preview`), or with PW_SKIP_BUILD=1 previews the dist/ already there. `/` has no development hooks; a test
 * reads what the page offers (tests/browser/engines/engine.ts says what).
 *
 * HOW A BUILDER ADDS A TEST THAT EVERY ENGINE RUNS (tests/browser/engines/engine.ts says it at length):
 *   - tag it, or a describe round it: `test('…', { tag: ENGINES }, …)`. That is all that puts it in the
 *     firefox and webkit projects; untagged, it is Chromium's alone. A spec file holds both kinds as it needs.
 *   - if it draws the stage: `import { test } from './engines/engine.ts'` (system Chrome on the GPU for
 *     Chromium, each engine's own build elsewhere), `stageAt(path, browserName)` for the address (Chromium's own
 *     tier; `?tier=low` where WebGL is software), a small screen, and waits in page state or simulation steps
 *     (`steps(page, n)`), never on the wall clock: Firefox and WebKit draw the bench at about ten frames a
 *     second here.
 *   - run it five times in each engine before you believe it (no `retries` here, on purpose):
 *       node tests/browser/engines/run.ts --runs 5
 *
 * On this machine ONE browser runs at a time: always `--workers=1` (the projects then run one after another),
 * one engine per hold of the browser lock, and the build under the build lock. tests/browser/engines/run.ts does
 * exactly that (one build, then each engine behind its own lock hold); by hand:
 *
 *   flock …/build.lock npx astro build
 *   PW_SKIP_BUILD=1 PW_PORT=<yours> flock …/browser.lock npx playwright test --workers=1 --project=firefox
 *   PW_SKIP_BUILD=1 PW_PORT=<yours> flock …/browser.lock npx playwright test --workers=1 --project=chromium --grep @engines
 *
 * Launch settings, and why (found 2026-11-21, E1 and E2):
 *   - Firefox: headless Firefox has no WebGL at all on Linux here ("AllowWebgl2:false restricts context
 *     creation", then "Exhausted GL driver options" with webgl.force-enabled): no preference changes that.
 *     Headed Firefox on an X display gets WebGL2 from Mesa's llvmpipe. So the firefox project runs headed, and
 *     the global setup (tests/browser/display.ts) starts a private Xvfb display for the run when Xvfb is
 *     installed (never a window on a real desktop). Without Xvfb it falls back to $DISPLAY, else headless: the
 *     stage's tests then fail with a message that says so.
 *   - WebKit: headless WebKit gives WebGL2 (software); no settings.
 *   - In both, the WebGL is a software renderer, which `/` itself treats as the Still tier (shell/tier.ts):
 *     the stage's tests ask for `?tier=low` there (engine.ts `stageAt`).
 *   - Chromium: headless Chromium gives WebGL2 through SwiftShader. The tests that draw the stage ask for
 *     system Chrome and the GPU (`gpuArgs` below, through engine.ts's `test` or their own `test.use`).
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

/** The tag of the engine set: a test carrying it runs in every project; without it, in Chromium alone. */
export const ENGINES = '@engines';

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
    { name: 'firefox', grep: new RegExp(ENGINES), use: { ...devices['Desktop Firefox'], headless: !(xvfbPath() || process.env.DISPLAY) } },
    { name: 'webkit', grep: new RegExp(ENGINES), use: { ...devices['Desktop Safari'] } },
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
