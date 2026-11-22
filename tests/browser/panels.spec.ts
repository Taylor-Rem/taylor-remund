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
  test('the Plates group opens Patchlamp’s hatch: focus in and kept in, the stage takes no keys, Esc closes and gives focus back', async ({ page, browserName, baseURL }) => {
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
    // Tab stays inside
    for (let k = 0; k < 12; k++) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(() => {
        const a = document.activeElement;
        return !a || a === document.body || !!a.closest('dialog#plate-panel');
      });
      expect(inside).toBe(true);
    }
    // the stage keeps running and takes no keys: U does not pull the lever
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

test('on a phone the panel is a sheet from the bottom; with reduced motion it does not slide', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'the engine set covers the panel itself');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page, '/?panel=patchlamp', browserName);
  const sheet = page.locator('dialog#plate-panel .pn-sheet');
  await expect(sheet).toBeVisible();
  const r = await sheet.evaluate((e) => ({ ...e.getBoundingClientRect().toJSON(), vw: innerWidth, vh: innerHeight, moving: e.getAnimations().length }));
  expect(Math.round(r.bottom)).toBe(r.vh);
  expect(Math.round(r.width)).toBe(r.vw);
  expect(r.top).toBeGreaterThan(40);
  expect(r.moving).toBe(0);
  // the close control is a finger's width
  const close = await page.locator('.pn-close').boundingBox();
  expect(close!.height).toBeGreaterThanOrEqual(44);
});
