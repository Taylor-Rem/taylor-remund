import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect, ENGINES, stageAt, live, steps, ws, watch } from './engines/engine.ts';

// The panels a brass plate opens over the stage (P4 H1; REWRITE.md § B7 "Hatches", § E9, § E10). Against the
// built site: a crate's plate opens its project's card (the entry /resume/ publishes) instead of leaving the page;
// the controls list's Plates group opens Patchlamp's hatch, the maker's plate and contact; focus goes in, stays in,
// and comes back; Esc and Close close it; the stage keeps running behind it and takes no keys; the maker's plate
// shows the undo stack as it changes and the frame time; a phone gets a sheet from the bottom; nothing is fetched
// from anywhere else. The words are read from content, never typed here.
//
// The tests tagged ENGINES run in all three engines (engine.ts: Chromium on the GPU, Firefox and WebKit at
// `?tier=low`); the phone sheet and reduced motion are Chromium's.

test.setTimeout(180_000);

const H = JSON.parse(readFileSync(new URL('../../src/content/hatches.json', import.meta.url), 'utf8'));
const RESUME = JSON.parse(readFileSync(new URL('../../src/content/resume.json', import.meta.url), 'utf8'));
const PROJECTS = JSON.parse(readFileSync(new URL('../../src/content/bench-projects.json', import.meta.url), 'utf8')).projects as Record<string, { resume: string; anchor: string }>;
const VIEW = { width: 1280, height: 800 };

const dialog = (page: Page) => page.locator('dialog#plate-panel');

async function ready(page: Page, path: string, browserName: string): Promise<void> {
  await page.goto(stageAt(path, browserName));
  await live(page);
  // the list (and its Plates group) and the panels' code come once the bench is usable
  await page.waitForFunction(() => document.querySelectorAll('#controls button[data-panel]').length >= 3, null, { timeout: 30_000 });
}

/** A Plates button in the controls list, pressed by the keys: focus on it (the list shows itself round it), Enter. */
async function fromList(page: Page, name: string): Promise<void> {
  const b = page.locator('#controls button[data-panel]', { hasText: name });
  await b.focus();
  await page.keyboard.press('Enter');
}

const focusIn = (page: Page): Promise<boolean> => page.evaluate(() => !!document.activeElement?.closest('dialog#plate-panel'));

test.describe('the panels over the stage', { tag: ENGINES }, () => {
  test('the Plates group opens Patchlamp’s hatch beside the bench (not modal): focus in, no key from it reaches the stage, Esc closes and gives focus back', async ({ page, browserName, baseURL }) => {
    const w = watch(page, new URL(baseURL!).origin);
    await page.setViewportSize(VIEW);
    await ready(page, '/', browserName);
    await fromList(page, H.patchlamp.tape.text);
    const d = dialog(page);
    await expect(d).toBeVisible();
    await expect(page.getByRole('dialog', { name: H.patchlamp.title.text })).toBeVisible();
    // its words are the paperwork's own section, and no price is typed: the pricing page is linked
    for (const part of ['real', 'shows', 'simplifies', 'facts']) await expect(d.getByRole('heading', { name: H.patchlamp[part].heading.text, exact: true })).toBeVisible();
    await expect(d.locator('a[href="https://patchlamp.com/pricing"]')).toHaveCount(1);
    await expect(d).not.toContainText('$');
    await expect(d.locator('[id]').first()).toHaveAttribute('id', /^pn-/);
    expect(await focusIn(page)).toBe(true);
    // beside the bench, not over it: not modal, no backdrop, the page around it not inert
    expect(await d.evaluate((e) => e.matches(':modal'))).toBe(false);
    expect(await page.evaluate(() => (document.getElementById('stage-root') as HTMLElement & { inert?: boolean }).inert || !!document.getElementById('stage-root')?.closest('[inert]'))).toBe(false);
    // focus is not trapped: Tab moves through the panel's links and on
    await page.keyboard.press('Tab');
    expect(await focusIn(page)).toBe(true);
    // while focus is in it, the stage takes no key from it: U does not pull the lever
    await page.locator('dialog#plate-panel h2').focus();
    await ws(page, (x) => x.dispatch({ type: 'turn', id: 'belt-dial', value: 1 }));
    await steps(page, 10);
    const depth = await ws(page, (x) => x.simWorld.undoStack().length);
    expect(depth).toBeGreaterThan(0);
    await page.keyboard.press('u');
    await steps(page, 20);
    expect(await ws(page, (x) => x.simWorld.undoStack().length)).toBe(depth);
    // Esc closes; focus goes back to the button that opened it
    await page.keyboard.press('Escape');
    await expect(d).toBeHidden();
    await expect(page.locator(':focus')).toHaveText(H.patchlamp.tape.text);
    expect(w.foreign).toEqual([]);
    expect(w.errors).toEqual([]);
  });

  test('a crate’s plate opens its project’s card, the entry /resume/ publishes, and the page stays', async ({ page, browserName }) => {
    await page.setViewportSize(VIEW);
    await ready(page, '/', browserName);
    // open whichever project crate the crew is not carrying, and press its card's plate
    const crates = await ws(page, (x) => (x.world.scene.projects ?? []).map((c: { crate: string; lid: string; plate: string; project: string }) => c));
    let opened: { crate: string; project: string } | null = null;
    for (const c of crates) {
      await ws(page, (x, id) => x.dispatch({ type: 'press', id }), c.lid);
      await steps(page, 30);
      await ws(page, (x, id) => x.dispatch({ type: 'press', id }), c.plate);
      await steps(page, 3);
      if (await dialog(page).isVisible()) {
        opened = c;
        break;
      }
    }
    expect(opened).not.toBeNull();
    const p = PROJECTS[opened!.project]!;
    const entry = RESUME.projects.entries.find((e: { title: { text: string } }) => e.title.text === p.resume);
    const d = dialog(page);
    await expect(page.getByRole('dialog', { name: entry.title.text })).toBeVisible();
    await expect(d.locator('.entry-subtitle')).toHaveText(entry.subtitle.text);
    await expect(d.locator('.tags li')).toHaveText(entry.tags.map((t: { text: string }) => t.text));
    await expect(d.locator(`a[href="/resume/#${p.anchor}"]`)).toHaveCount(1);
    expect(new URL(page.url()).pathname).toBe('/');
    await d.getByRole('button', { name: H.panel.close.text }).click();
    await expect(d).toBeHidden();
  });

  test('the maker’s plate: the undo stack in words as it changes, the frame time, the tests', async ({ page, browserName }) => {
    await page.setViewportSize(VIEW);
    await ready(page, '/?panel=maker', browserName);
    const d = dialog(page);
    await expect(page.getByRole('dialog', { name: H.maker.title.text })).toBeVisible();
    const log = d.locator('.pn-log');
    await expect(log).toHaveText(H.maker.live.history.empty.text);
    await ws(page, (x) => x.dispatch({ type: 'turn', id: 'belt-dial', value: 1 }));
    await expect(log.locator('li').first()).toHaveText('Belt speed: 3 → 5');
    await expect(log.locator('li.pn-next')).toHaveCount(1);
    await expect(d.locator('.pn-frame')).toHaveText(/^\d+\.\d ms$/);
    // the lever takes it back, and the line goes (the panel reads; the world does the undoing)
    await ws(page, (x) => x.dispatch({ type: 'undo' }));
    await expect(log).toHaveText(H.maker.live.history.empty.text, { timeout: 20_000 });
    await page.keyboard.press('Escape');
    await expect(d).toBeHidden();
  });

  test('contact: the address as text to select or copy, the strip’s links', async ({ page, browserName }) => {
    await page.setViewportSize(VIEW);
    await ready(page, '/', browserName);
    await fromList(page, 'Contact');
    const d = dialog(page);
    await expect(d.locator('.pn-mail')).toHaveText('remundtaylor3@gmail.com');
    for (const href of ['https://github.com/Taylor-Rem', 'https://linkedin.com/in/taylor-remund-88169124a', 'mailto:remundtaylor3@gmail.com']) await expect(d.locator(`a[href="${href}"]`)).toHaveCount(1);
    await expect(d.getByRole('button', { name: H.panel.copy.text })).toBeVisible();
    await d.getByRole('button', { name: H.panel.close.text }).click();
    await expect(d).toBeHidden();
  });
});

/** Where a thing is on the page (its pick box, projected), in CSS pixels. */
const onScreen = (page: Page, id: string): Promise<{ x: number; y: number; w: number; h: number }> =>
  ws(page, (w, id) => {
    const b = w.picking.worldBox(id);
    const c = w.stage.canvas.getBoundingClientRect();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      const s = w.stage.camera.worldToScreen({ x: i & 1 ? b.max.x : b.min.x, y: i & 2 ? b.max.y : b.min.y, z: i & 4 ? b.max.z : b.min.z });
      const px = c.left + ((s.x + 1) / 2) * c.width, py = c.top + ((1 - s.y) / 2) * c.height;
      x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    }
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
  }, id);

test('wide screen, the maker’s plate open beside the bench: the pointer turns the dial and pulls UNDO, and the log follows within a beat; the stage takes keys again once pressed; a second plate swaps the panel', async ({ page, browserName }, info) => {
  test.skip(browserName !== 'chromium', 'a hand on the real GPU (bench-input.spec.ts covers the hand in every engine)');
  await page.setViewportSize(VIEW);
  await ready(page, '/?panel=maker', browserName);
  const d = dialog(page);
  await expect(page.getByRole('dialog', { name: H.maker.title.text })).toBeVisible();
  const log = d.locator('.pn-log');
  await expect(log).toHaveText(H.maker.live.history.empty.text);
  const panel = (await d.boundingBox())!;

  // what the panel covers at the home framing (reported; the three the visitor needs here must be clear of it)
  const covered: Record<string, number> = {};
  for (const id of ['undo-lever', 'belt-dial', 'belt-lever', 'phone', 'button', 'storefront', 'platen', 'jack-storefront', 'jack-platen', 'jack-belt', 'jack-lamp', 'lamp', 'cord', 'dock-bell', 'dock', 'striker', 'chute']) {
    const r = await onScreen(page, id).catch(() => null);
    if (!r) continue;
    const ox = Math.max(0, Math.min(r.x + r.w / 2, panel.x + panel.width) - Math.max(r.x - r.w / 2, panel.x));
    const oy = Math.max(0, Math.min(r.y + r.h / 2, panel.y + panel.height) - Math.max(r.y - r.h / 2, panel.y));
    covered[id] = Math.round((100 * ox * oy) / Math.max(1, r.w * r.h));
  }
  await info.attach('covered-by-panel-percent.json', { body: JSON.stringify(covered, null, 2), contentType: 'application/json' });
  console.log('covered by the panel at 1280x800, % of each pick box:', JSON.stringify(covered));
  for (const id of ['undo-lever', 'belt-dial', 'phone']) expect(covered[id], id).toBe(0);

  // the belt's dial, turned by the pointer: a line arrives
  const dial = await onScreen(page, 'belt-dial');
  const y = dial.y + dial.h * 0.25;
  await page.mouse.move(dial.x, y);
  await page.mouse.down();
  for (let k = 1; k <= 10; k++) await page.mouse.move(dial.x + 6.2 * k, y);
  await page.mouse.up();
  await expect(log.locator('li').first()).toHaveText(/^Belt speed: 3 → [45]$/);
  await page.screenshot({ path: info.outputPath('lever-a.png') });

  // UNDO, pulled by the pointer: the line goes within the plate's beat (250 ms) of the world taking it back
  await page.evaluate(() => {
    const w = (window as unknown as { __handoff: { workshop: { simWorld: { undoStack(): unknown[] } } } }).__handoff.workshop;
    const t = window as unknown as { __undoneAt?: number; __logGoneAt?: number };
    const n0 = w.simWorld.undoStack().length;
    const tick = (): void => {
      if (t.__undoneAt === undefined && w.simWorld.undoStack().length < n0) t.__undoneAt = performance.now();
      if (t.__logGoneAt === undefined && document.querySelector('dialog#plate-panel .pn-log .pn-empty')) t.__logGoneAt = performance.now();
      if (t.__logGoneAt === undefined || t.__undoneAt === undefined) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const undo = await onScreen(page, 'undo-lever');
  await page.mouse.move(undo.x, undo.y);
  await page.mouse.down();
  for (let k = 1; k <= 6; k++) await page.mouse.move(undo.x + 4, undo.y + (undo.h * 0.6 * k) / 6);
  await page.mouse.up();
  await expect(log).toHaveText(H.maker.live.history.empty.text, { timeout: 20_000 });
  const lag = await page.evaluate(() => {
    const t = window as unknown as { __undoneAt?: number; __logGoneAt?: number };
    return t.__logGoneAt! - t.__undoneAt!;
  });
  console.log(`UNDO pulled by the pointer: the log followed ${lag.toFixed(0)} ms after the world took it back`);
  expect(lag).toBeLessThanOrEqual(250 + 50);
  await page.screenshot({ path: info.outputPath('lever-b.png') });
  await expect(d).toBeVisible();

  // a press on the stage left the panel open and the stage takes keys again: U pulls the lever
  await ws(page, (x) => x.dispatch({ type: 'turn', id: 'belt-lever', value: 0.5 }));
  await expect(log.locator('li').first()).toHaveText('Belt: running → stopped');
  await page.mouse.click(VIEW.width * 0.3, VIEW.height * 0.12); // the wall: nothing there
  await expect(d).toBeVisible();
  expect(await focusIn(page)).toBe(false);
  await page.keyboard.press('u');
  await expect(log).toHaveText(H.maker.live.history.empty.text, { timeout: 20_000 });
  // Esc with focus on the stage is the stage's (the camera's back); the panel stays
  await page.keyboard.press('Escape');
  await expect(d).toBeVisible();

  // a second plate while it is open: the panel swaps, focus on its heading, the live lines stop
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('workshop:panel', { detail: { panel: 'patchlamp' } })));
  await expect(page.getByRole('dialog', { name: H.patchlamp.title.text })).toBeVisible();
  await expect(d.locator('.pn-log, .pn-frame')).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('pn-patchlamp-toy-title');
  await expect(d.locator('.pn-said')).toHaveText('');
  // Esc with focus inside closes it
  await page.keyboard.press('Escape');
  await expect(d).toBeHidden();
});

test('contact: Copy puts the address on the visitor’s own clipboard; refused, the address is selected to copy by hand', async ({ page, browserName, context }) => {
  test.skip(browserName !== 'chromium', 'clipboard permissions are granted per engine; Chromium’s is the one asked for');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize(VIEW);
  await ready(page, '/?panel=contact', browserName);
  const d = dialog(page);
  const copy = d.getByRole('button', { name: H.panel.copy.text });
  await copy.click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('remundtaylor3@gmail.com');
  await expect(d.locator('.pn-said')).toHaveText(H.panel.copied.text);
  // refused: the text is selected instead
  await page.evaluate(() => {
    window.getSelection()?.removeAllRanges();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('refused')) } });
  });
  await copy.click();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('remundtaylor3@gmail.com');
});

test('on a phone the panel is a modal sheet from the bottom: Tab stays in it, no key reaches the stage; with reduced motion it does not slide', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'the engine set covers the panel itself');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page, '/?panel=patchlamp', browserName);
  const sheet = page.locator('dialog#plate-panel .pn-sheet');
  await expect(sheet).toBeVisible();
  expect(await dialog(page).evaluate((e) => e.matches(':modal'))).toBe(true);
  for (let k = 0; k < 12; k++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => { const a = document.activeElement; return !a || a === document.body || !!a.closest('dialog#plate-panel'); })).toBe(true);
  }
  await ws(page, (x) => x.dispatch({ type: 'turn', id: 'belt-dial', value: 1 }));
  await steps(page, 10);
  const depth = await ws(page, (x) => x.simWorld.undoStack().length);
  await page.keyboard.press('u');
  await steps(page, 20);
  expect(await ws(page, (x) => x.simWorld.undoStack().length)).toBe(depth);
  const r = await sheet.evaluate((e) => ({ ...e.getBoundingClientRect().toJSON(), vw: innerWidth, vh: innerHeight, moving: e.getAnimations().length }));
  expect(Math.round(r.bottom)).toBe(r.vh);
  expect(Math.round(r.width)).toBe(r.vw);
  expect(r.top).toBeGreaterThan(40);
  expect(r.moving).toBe(0);
  // the close control is a finger's width
  const close = await page.locator('.pn-close').boundingBox();
  expect(close!.height).toBeGreaterThanOrEqual(44);
});
