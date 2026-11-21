import { expect, test, type Page } from '@playwright/test';
import { gpuArgs } from '../../playwright.config.ts';

// The keyboard path on `/` (P3 B2; REWRITE.md § B6 keyboard column, § B7, § E8 Browser row "the keyboard path
// presses the Button and hears the result announced", § E9). From a fresh page, with the keyboard only: the Tab
// order, the Button pressed and heard, a crate carried to the belt, a visible focus at every stop, the mark on
// the stage round the focused thing, `?` and Esc, a station's address, and the camera's cut under reduced motion.
//
// Engine-neutral in its body (no CDP, nothing Chromium-only): what it reads of the stage it reads through the
// loader's own `window.__handoff` (shell/loader.ts), as home.spec.ts does. Chromium draws the bench with the GPU
// (system Chrome, `gpuArgs`); another engine's project gets its own browser.

test.use({
  channel: async ({ browserName }, use) => use(browserName === 'chromium' ? 'chrome' : undefined),
  launchOptions: async ({ browserName }, use) => use(browserName === 'chromium' ? { args: gpuArgs } : {}),
});
test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

const VIEW = { width: 1280, height: 720 };

interface Ws {
  world: { button(): { presses: number }; part(id: string): { location: { at: string; mouth?: string } } | undefined; motion(id: string): { mode: string } | undefined };
  stage: { canvas: HTMLCanvasElement; camera: { zoom: number; easing: boolean; worldToScreen(p: { x: number; y: number; z: number }): { x: number; y: number; z: number } } };
  picking: { worldBox(id: string): { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null };
  framing: { station: string | null };
  loop: { stop(): void; start(): void };
  advance(n: number): void;
}
declare global {
  interface Window {
    __handoff?: { phase: string; workshop: Ws };
  }
}

const live = async (page: Page): Promise<void> => {
  await page.waitForFunction(() => window.__handoff?.phase === 'live', null, { timeout: 120_000, polling: 100 });
  // the list is built once the bench is usable
  await page.waitForFunction(() => document.querySelectorAll('#controls button').length > 4, null, { timeout: 30_000 });
};
const ws = <T>(page: Page, f: (w: Ws) => T): Promise<T> => page.evaluate(`(${f.toString()})(window.__handoff.workshop)`) as Promise<T>;

/** What has focus, and is it plainly visible: a real element, on screen, with an outline. */
const stop = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (!a || a === document.body) return { tag: 'body', text: '', where: 'none', outline: 0, onScreen: false, id: null as string | null };
    const cs = getComputedStyle(a);
    const r = a.getBoundingClientRect();
    const where = a.closest('header.strip') ? 'strip' : a.closest('#controls') ? 'list' : a.closest('footer.legal') ? 'legal' : a.classList.contains('skip') ? 'skip' : a.id === 'stage' ? 'canvas' : 'other';
    return {
      tag: a.tagName.toLowerCase(),
      text: (a.textContent ?? '').trim(),
      where,
      outline: cs.outlineStyle === 'none' ? 0 : parseFloat(cs.outlineWidth),
      onScreen: r.width > 4 && r.height > 4 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight,
      id: a.dataset['id'] ?? a.dataset['dest'] ?? null,
    };
  });

/** Tab until the focused element's text starts with `text` (at most `max` presses). */
async function tabTo(page: Page, text: string | RegExp, max = 40): Promise<void> {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const s = await stop(page);
    if (typeof text === 'string' ? s.text.startsWith(text) : text.test(s.text)) return;
  }
  throw new Error(`Tab never reached ${String(text)}`);
}

const said = (page: Page): Promise<string> => page.locator('#controls-said').innerText();

test('Tab: the skip link, the strip, then the list, then the legal line; every stop visible; the canvas is no stop', async ({ page }) => {
  await page.setViewportSize(VIEW);
  await page.goto('/');
  await live(page);
  const order: string[] = [];
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab');
    const s = await stop(page);
    expect(s.where, `stop ${i}: ${s.tag} "${s.text}"`).not.toBe('canvas');
    expect(s.where, `stop ${i}`).not.toBe('none');
    expect(s.onScreen, `stop ${i} (${s.where} "${s.text}") is on screen`).toBe(true);
    expect(s.outline, `stop ${i} (${s.where} "${s.text}") has a visible outline`).toBeGreaterThanOrEqual(1.5);
    if (s.where === 'list') {
      // the list is shown while focus is in it: a panel, not a 1px clip
      const w = await page.locator('#controls').evaluate((e) => e.getBoundingClientRect().width);
      expect(w).toBeGreaterThan(150);
    }
    if (order.at(-1) !== s.where) order.push(s.where);
    if (s.where === 'legal') break;
  }
  expect(order).toEqual(['skip', 'strip', 'list', 'legal']);
  // gone again once focus has left it
  expect(await page.locator('#controls').evaluate((e) => e.getBoundingClientRect().width)).toBeLessThan(4);
});

test('Tab to the Button, Enter presses it, and the live region says what it did', async ({ page }) => {
  await page.setViewportSize(VIEW);
  await page.goto('/');
  await live(page);
  expect(await said(page)).toBe(''); // nothing done, nothing heard
  await tabTo(page, 'Big Red Button');
  const before = await ws(page, (w) => w.world.button().presses);
  await page.keyboard.press('Enter');
  await expect.poll(() => ws(page, (w) => w.world.button().presses)).toBe(before + 1);
  await expect.poll(() => said(page)).toContain('Big Red Button pressed.');
  // then Revert's card
  await expect.poll(() => said(page), { timeout: 20_000 }).toContain('card:');
  // focus stayed on the Button's own button, which now says how often it was pressed
  expect((await stop(page)).text).toMatch(/^Big Red Button, pressed once/);
});

test('the mark on the stage stands round the focused thing (the Button, a crate)', async ({ page }) => {
  await page.setViewportSize(VIEW);
  await page.goto('/');
  await live(page);
  for (const name of ['Big Red Button', /^(Small|Medium|Large) crate/]) {
    await tabTo(page, name);
    const id = (await stop(page)).id!;
    // let the camera settle on the station, then hold the bench still and compare a frame with the mark and one without
    await page.waitForFunction(() => !window.__handoff!.workshop.stage.camera.easing);
    const r = await page.evaluate(
      (id) =>
        new Promise<{ box: number[]; changed: number[] | null; corners: number }>((resolve) => {
          const w = window.__handoff!.workshop;
          w.loop.stop();
          const c = w.stage.canvas;
          const scale = c.width / c.clientWidth;
          const read = (): ImageData => {
            w.advance(0);
            const g = document.createElement('canvas');
            g.width = c.width;
            g.height = c.height;
            const x = g.getContext('2d')!;
            x.drawImage(c, 0, 0);
            return x.getImageData(0, 0, c.width, c.height);
          };
          const b = w.picking.worldBox(id)!;
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          for (let i = 0; i < 8; i++) {
            const s = w.stage.camera.worldToScreen({ x: i & 1 ? b.max.x : b.min.x, y: i & 2 ? b.max.y : b.min.y, z: i & 4 ? b.max.z : b.min.z });
            const px = ((s.x + 1) / 2) * c.clientWidth, py = ((1 - s.y) / 2) * c.clientHeight;
            x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
          }
          const marked = read();
          // the same frame without the mark: the focus taken off the stage (not the page's focus)
          const focusedEl = document.activeElement as HTMLElement;
          (w as unknown as { input: { focusOn(id: string | null): void } }).input.focusOn(null);
          const bare = read();
          (w as unknown as { input: { focusOn(id: string | null): void } }).input.focusOn(id);
          w.loop.start();
          focusedEl.focus();
          let cx0 = Infinity, cy0 = Infinity, cx1 = -Infinity, cy1 = -Infinity;
          let n = 0;
          // the mark's corners: just outside the box, bright where the bare frame is not
          let corners = 0;
          const pad = 30;
          const inCorner = (x: number, y: number): number => {
            const near = (a: number, b: number) => Math.abs(a - b) < 22;
            return (near(x, x0) || near(x, x1)) && (near(y, y0) || near(y, y1)) ? (x < (x0 + x1) / 2 ? 0 : 1) + (y < (y0 + y1) / 2 ? 0 : 2) : -1;
          };
          const seen = new Set<number>();
          for (let py = Math.max(0, Math.floor((y0 - pad) * scale)); py < Math.min(c.height, (y1 + pad) * scale); py++)
            for (let px = Math.max(0, Math.floor((x0 - pad) * scale)); px < Math.min(c.width, (x1 + pad) * scale); px++) {
              const k = (py * c.width + px) * 4;
              const d = Math.abs(marked.data[k]! - bare.data[k]!) + Math.abs(marked.data[k + 1]! - bare.data[k + 1]!) + Math.abs(marked.data[k + 2]! - bare.data[k + 2]!);
              if (d < 90) continue;
              const x = px / scale, y = py / scale;
              n++;
              cx0 = Math.min(cx0, x); cx1 = Math.max(cx1, x); cy0 = Math.min(cy0, y); cy1 = Math.max(cy1, y);
              const q = inCorner(x, y);
              if (q >= 0 && marked.data[k]! > 150 && !seen.has(q)) (seen.add(q), corners++);
            }
          resolve({ box: [x0, y0, x1, y1], changed: n ? [cx0, cy0, cx1, cy1] : null, corners });
        }),
      id,
    );
    expect(r.changed, `${String(name)}: the mark is drawn`).not.toBeNull();
    const [x0, y0, x1, y1] = r.box as [number, number, number, number];
    const [cx0, cy0, cx1, cy1] = r.changed as [number, number, number, number];
    // the mark's box overlaps the thing's projected box, and hugs it (not a mark somewhere else)
    expect(cx0 < x1 && cx1 > x0 && cy0 < y1 && cy1 > y0, `${String(name)}: mark ${r.changed} over box ${r.box}`).toBe(true);
    expect(cx0).toBeGreaterThan(x0 - 30);
    expect(cx1).toBeLessThan(x1 + 30);
    // a bracket at (nearly) every corner
    expect(r.corners, `${String(name)}: corners`).toBeGreaterThanOrEqual(3);
  }
});

test('a crate, by the keyboard alone: picked up, a destination chosen, Enter, and it is on the belt', async ({ page }) => {
  await page.setViewportSize(VIEW);
  await page.goto('/');
  await live(page);
  await tabTo(page, /^(Small|Medium|Large) crate/);
  const crate = (await stop(page)).id!;
  const thing = (await stop(page)).text;
  await page.keyboard.press('Enter');
  // held: the list is now where it can go, and focus is on the first of them
  await expect(page.locator('.controls-hold-label')).toBeVisible();
  await expect(page.locator('.controls-hold-label')).toContainText('Where should it go?');
  const dests = await page.locator('.controls-dests button').allInnerTexts();
  expect(dests).toEqual(['Belt', 'Dock', 'Platen']);
  expect((await stop(page)).text).toBe('Belt');
  await expect.poll(() => said(page)).toContain('picked up. Choose where it goes.');
  await page.keyboard.press('Enter');
  await expect.poll(() => ws(page, (w) => (w as Ws).world.part(crate)?.location), { timeout: 20_000 }).toMatchObject({ at: 'in', mouth: 'belt' });
  await expect.poll(() => said(page), { timeout: 20_000 }).toContain('is on the belt.');
  // and the list is the list again, focus back on the crate
  await expect(page.locator('.controls-hold-label')).toBeHidden();
  expect((await stop(page)).id).toBe(crate);
  void thing;
});

test('? opens the list and puts focus in it; Esc closes it and focus returns to where it was', async ({ page }) => {
  await page.setViewportSize(VIEW);
  await page.goto('/');
  await live(page);
  await tabTo(page, 'Read');
  await page.keyboard.press('?');
  await expect(page.locator('#controls')).toHaveClass(/open/);
  expect((await stop(page)).where).toBe('list');
  expect(await page.locator('#controls').evaluate((e) => e.getBoundingClientRect().width)).toBeGreaterThan(150);
  await page.keyboard.press('Tab');
  expect((await stop(page)).where).toBe('list');
  await page.keyboard.press('Escape');
  await expect(page.locator('#controls')).not.toHaveClass(/open/);
  const s = await stop(page);
  expect([s.where, s.text]).toEqual(['strip', 'Read']);
  expect(await page.locator('#controls').evaluate((e) => e.getBoundingClientRect().width)).toBeLessThan(4);
});

test('an address that names a station frames it, Back returns to the whole bench; Enter on a station’s name sets the address', async ({ page }) => {
  await page.setViewportSize(VIEW);
  await page.goto('/');
  await live(page);
  const home = await ws(page, (w) => w.stage.camera.zoom);
  // a later address (a link, the address bar)
  await page.evaluate(() => (location.hash = 'patchlamp'));
  await expect.poll(() => ws(page, (w) => w.framing.station)).toBe('patchlamp');
  await expect.poll(() => ws(page, (w) => w.stage.camera.zoom)).toBeGreaterThan(home + 0.05);
  expect(await page.evaluate(() => [document.documentElement.classList.contains('reading'), scrollY])).toEqual([false, 0]);
  await page.goBack();
  await expect.poll(() => ws(page, (w) => w.framing.station)).toBeNull();
  await expect.poll(() => ws(page, (w) => w.stage.camera.zoom)).toBeLessThan(home + 0.01);
  expect(new URL(page.url()).hash).toBe('');
  // Enter on a station's name in the list frames it and the address follows; Esc backs out to the bare address
  await tabTo(page, 'The belt');
  await page.keyboard.press('Enter');
  await expect.poll(() => new URL(page.url()).hash).toBe('#line');
  expect(await ws(page, (w) => w.framing.station)).toBe('line');
  await page.keyboard.press('Escape');
  await expect.poll(() => new URL(page.url()).hash).toBe('');
  await expect.poll(() => ws(page, (w) => w.framing.station)).toBeNull();
  // on arrival
  await page.goto('/#patchlamp');
  await live(page);
  await expect.poll(() => ws(page, (w) => w.framing.station)).toBe('patchlamp');
  expect(await page.evaluate(() => [document.documentElement.classList.contains('reading'), scrollY])).toEqual([false, 0]);
});

test.describe('reduced motion', () => {
  test('focus moving to another station cuts the camera there', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize(VIEW);
    await page.goto('/');
    await live(page);
    await tabTo(page, 'Patchlamp');
    // the very next frame is already there: no ease
    const r = await page.evaluate(
      () =>
        new Promise<{ easing: boolean; zoom: number; station: string | null }>((resolve) =>
          requestAnimationFrame(() => {
            const w = window.__handoff!.workshop;
            resolve({ easing: w.stage.camera.easing, zoom: w.stage.camera.zoom, station: w.framing.station });
          }),
        ),
    );
    expect(r.station).toBe('patchlamp');
    expect(r.easing).toBe(false);
    expect(r.zoom).toBeGreaterThan(0.05);
  });
});
