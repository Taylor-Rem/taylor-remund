import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests (REWRITE.md § E8). Chromium only until the later gate adds
 * Firefox and WebKit. @playwright/test is pinned to 1.61.1 because that is the
 * version whose Chromium (build 1228) is already in ~/.cache/ms-playwright.
 */

/**
 * Measured on the reference laptop: Playwright's headless Chromium renders
 * WebGL with SwiftShader (software). System Chrome with these flags gets the
 * real GPU (AMD RADV). Use with `channel: 'chrome'` for perf and look tests:
 *   use: { channel: 'chrome', launchOptions: { args: gpuArgs } }
 */
export const gpuArgs = ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'];

// Not Astro's default 4321, so a running `npm run dev` or `preview` never
// stands in for a fresh build. Override with PW_PORT.
const PORT = Number(process.env.PW_PORT ?? 4417);

export default defineConfig({
  testDir: 'tests/browser',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Astro 7 sends `astro preview` to the background when it detects it is
    // run by an agent; `--ignore-lock` keeps it in the foreground so
    // Playwright owns it and stops it.
    command: `npx astro build && npx astro preview --ignore-lock --port ${PORT}`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { ASTRO_TELEMETRY_DISABLED: '1' },
  },
});
