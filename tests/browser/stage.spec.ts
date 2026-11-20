import { expect, test, type Page } from '@playwright/test';
import { gpuArgs } from '../../playwright.config.ts';
import { startDevServer, type DevServer } from '../../scripts/capture.ts';

// The stage dev page on the real GPU (system Chrome with the GPU flags).
// Dev pages exist only in `astro dev`, so this file starts its own dev server
// on a free port instead of using the config's built preview.

test.use({ channel: 'chrome', launchOptions: { args: gpuArgs } });
test.describe.configure({ mode: 'serial' });

let server: DevServer;
test.beforeAll(async () => {
  server = await startDevServer();
});
test.afterAll(() => server?.stop());

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|404 \(Not Found\)/.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

/** Render one frame and read the canvas back in the same task (no preserveDrawingBuffer needed). */
async function canvasStats(page: Page): Promise<{ w: number; h: number; distinct: number; spread: number }> {
  return page.evaluate(() => {
    const w = window.__workshop!;
    w.advance(0);
    const src = w.stage.canvas;
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = 100;
    const g = c.getContext('2d')!;
    g.drawImage(src, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const seen = new Set<number>();
    let min = 255;
    let max = 0;
    for (let i = 0; i < d.length; i += 4) {
      seen.add((d[i]! >> 3) | ((d[i + 1]! >> 3) << 5) | ((d[i + 2]! >> 3) << 10));
      const l = (d[i]! + d[i + 1]! + d[i + 2]!) / 3;
      min = Math.min(min, l);
      max = Math.max(max, l);
    }
    return { w: src.width, h: src.height, distinct: seen.size, spread: max - min };
  });
}

for (const tier of ['high', 'low'] as const) {
  test(`the stage renders a non-blank picture with no console error (tier ${tier})`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${server.origin}/dev/stage/?tier=${tier}`);
    await page.waitForFunction('window.__ready === true', null, { timeout: 60_000 });
    const s = await canvasStats(page);
    expect(s.distinct).toBeGreaterThan(200);
    expect(s.spread).toBeGreaterThan(80);
    const stats = await page.evaluate(() => window.__workshop!.stats());
    expect(stats.tier).toBe(tier);
    expect(stats.post).toBe(tier === 'high');
    expect(stats.scene.calls).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
}

test('every post pass can be switched off from the query string', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(`${server.origin}/dev/stage/?pass=-gtao,-bloom,-focus,-grade,-vignette,-fog,-msaa,-shadowTint`);
  await page.waitForFunction('window.__ready === true', null, { timeout: 60_000 });
  const passes = await page.evaluate(() => ({ ...window.__workshop!.passes }));
  expect(Object.values(passes).every((v) => v === false)).toBe(true);
  expect((await canvasStats(page)).distinct).toBeGreaterThan(100);
  expect(errors).toEqual([]);
});

test('a resize keeps the aspect right', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${server.origin}/dev/stage/`);
  await page.waitForFunction('window.__ready === true', null, { timeout: 60_000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => {
    const w = window.__workshop!;
    return Math.abs(w.stage.camera.camera.aspect - 390 / 844) < 1e-3;
  });
  const s = await canvasStats(page);
  expect(s.w / s.h).toBeCloseTo(390 / 844, 2);
});

// Taylor's desktop, 2026-11-20: three black octagons a third of the screen wide over the bench. One pixel of the
// scene that is not a number (or has overflowed the half-float buffer) was spread by the bloom pyramid; which
// pixels go wrong depends on the graphics card, and this laptop never showed one. Here two small meshes are made
// to write such a value on purpose: only they may go dark.
for (const kind of ['not a number', 'an overflow'] as const) {
  test(`a pixel that is ${kind} darkens its own object and nothing else`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${server.origin}/dev/stage/`);
    await page.waitForFunction('window.__ready === true', null, { timeout: 60_000 });
    /** The share of the picture that is nearly black, on a 160×100 reading of the canvas. */
    const dark = () =>
      page.evaluate(() => {
        const w = window.__workshop!;
        w.advance(0);
        const c = document.createElement('canvas');
        c.width = 160;
        c.height = 100;
        const g = c.getContext('2d')!;
        g.drawImage(w.stage.canvas, 0, 0, c.width, c.height);
        const d = g.getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i]! + d[i + 1]! + d[i + 2]! < 30) n++;
        return n / (c.width * c.height);
      });
    const before = await dark();
    const spoiled = await page.evaluate((kind) => {
      const stage = window.__workshop!.stage as unknown as { scene: { traverse(f: (o: any) => void): void }; camera: { camera: any } };
      const cam = stage.camera.camera;
      const picked: string[] = [];
      stage.scene.traverse((o: any) => {
        if (picked.length >= 2 || !o.isMesh || !o.visible || !o.material || Array.isArray(o.material) || !o.geometry?.boundingSphere) return;
        // a small mesh near the middle of the frame
        const p = o.getWorldPosition(o.position.clone()).project(cam);
        if (Math.abs(p.x) > 0.35 || Math.abs(p.y) > 0.35 || p.z > 1 || o.geometry.boundingSphere.radius > 1.2) return;
        const m = o.material.clone();
        // (the term in gl_FragCoord keeps a compiler from folding the expression away)
        const value = kind === 'not a number' ? 'vec3(sqrt(-1.0 - gl_FragCoord.x * 0.0))' : 'vec3(1e30 * (1e30 + gl_FragCoord.x * 0.0))';
        m.onBeforeCompile = (s: { fragmentShader: string }) => {
          s.fragmentShader = s.fragmentShader.replace(/}\s*$/, `gl_FragColor = vec4(${value}, 1.0);}`);
        };
        m.customProgramCacheKey = () => `test-nonfinite-${kind}`;
        o.material = m;
        picked.push(o.name || o.type);
      });
      return picked.length;
    }, kind);
    expect(spoiled, 'two meshes were found to spoil').toBe(2);
    await page.evaluate(() => window.__workshop!.advance(0));
    const after = await dark();
    // unprotected, one such mesh blacked out about a sixth of the frame
    expect(after - before, 'the picture is not blotted').toBeLessThan(0.03);
    expect(errors).toEqual([]);
  });
}
