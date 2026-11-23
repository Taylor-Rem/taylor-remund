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
  await recordEvents(page);
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
    await expect(log.locator('li.pn-gone')).toHaveText(['Belt speed: 3 → 5'], { timeout: 20_000 });
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
      if (t.__logGoneAt === undefined && document.querySelector('dialog#plate-panel .pn-log li.pn-gone')) t.__logGoneAt = performance.now();
      if (t.__logGoneAt === undefined || t.__undoneAt === undefined) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const undo = await onScreen(page, 'undo-lever');
  await page.mouse.move(undo.x, undo.y);
  await page.mouse.down();
  for (let k = 1; k <= 6; k++) await page.mouse.move(undo.x + 4, undo.y + (undo.h * 0.6 * k) / 6);
  await page.mouse.up();
  await expect(log.locator('li:not(.pn-gone)')).toHaveCount(0, { timeout: 20_000 });
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
  await expect(log.locator('li:not(.pn-gone)')).toHaveCount(0, { timeout: 20_000 });
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

// ── round three: the panel tells the page what it covers; what it is about stays in view ──

const BIG = { width: 1440, height: 900 };
type Rect = { x0: number; y0: number; x1: number; y1: number };

/** `id`'s box on the page now (the shell's own measure), or null. */
const rectOf = (page: Page, id: string): Promise<Rect | null> =>
  ws(page, (w, id) => {
    const r = w.framing.screenRect(id);
    if (!r) return null;
    const c = w.stage.canvas.getBoundingClientRect();
    return { x0: r.x0 + c.left, y0: r.y0 + c.top, x1: r.x1 + c.left, y1: r.y1 + c.top };
  }, id);
/** Is `id` whole in what the strip and the open panel (and the list, when open) leave of the stage? */
const inClear = (page: Page, id: string): Promise<boolean> =>
  page.evaluate(async (id) => {
    const w = (window as unknown as { __handoff: { workshop: any } }).__handoff.workshop;
    const r = w.framing.screenRect(id);
    if (!r) return false;
    const c = w.stage.canvas.getBoundingClientRect();
    const box = { x0: r.x0 + c.left, y0: r.y0 + c.top, x1: r.x1 + c.left, y1: r.y1 + c.top };
    const covers = ['header.strip', 'dialog#plate-panel[open]', '#controls.open'].map((s) => document.querySelector(s)?.getBoundingClientRect()).filter((x): x is DOMRect => !!x && x.width > 4);
    const inside = box.x0 >= c.left && box.x1 <= c.right && box.y0 >= c.top && box.y1 <= c.bottom;
    const hit = covers.some((k) => box.x0 < k.right && box.x1 > k.left && box.y0 < k.bottom && box.y1 > k.top);
    return inside && !hit;
  }, id);
const view = (page: Page): Promise<{ focus: number[]; zoom: number }> => ws(page, (w) => w.stage.camera.view());
const resting = (page: Page): Promise<unknown> => page.waitForFunction(() => !(window as any).__handoff.workshop.stage.camera.easing, null, { timeout: 10_000 });
const same = (a: { focus: number[]; zoom: number }, b: { focus: number[]; zoom: number }): boolean => Math.abs(a.zoom - b.zoom) < 1e-3 && a.focus.every((f, k) => Math.abs(f - b.focus[k]!) < 1e-3);

/** Open a project crate with a real pointer (a double-click), then press its card's FULL ENTRY plate: the panel opens over the look. */
async function crateEntry(page: Page, title: string): Promise<{ crate: string; card: string; plate: string }> {
  const project = Object.entries(PROJECTS).find(([, p]) => p.resume === title)![0];
  const c = await ws(page, (w, project) => (w.world.scene.projects as { crate: string; card: string; plate: string; project: string }[]).find((x) => x.project === project)!, project);
  await openByPointer(page, c);
  await resting(page);
  const plate = await pointFor(page, c.plate);
  await page.mouse.click(plate.x, plate.y);
  await expect(dialog(page)).toBeVisible();
  return c;
}

/**
 * Double-click crate `c` with a real pointer until it is the one that opened, and the camera holds a look on it.
 * (Why a retry: in the first seconds the crew carry crates across the bench on attract mode's rounds. A crate in
 * Fetch's arms can pass in front of the one aimed at between the aim and the press, and the double-click then opens
 * the crate it lands on, as it should for a visitor. Seen in the traces of 2026-11-22: `part.grabbed crate-4`,
 * `crate.opened`, `look crate-4-card`, the aim having been crate-3.) A wrong crate that opened is shut again by its
 * latch and the camera sent home before the next try.
 */
async function openByPointer(page: Page, c: { crate: string; card: string }): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const at = await pointFor(page, c.crate);
    const before = await page.evaluate(() => ((window as any).__h1events as string[]).length);
    await page.mouse.dblclick(at.x, at.y);
    const ok = await page
      .waitForFunction((id) => (window as any).__handoff.workshop.world.setting(id, 'open') === true && !!(window as any).__handoff.workshop.stage.camera.look, c.crate, { timeout: 6_000 })
      .then(() => true, () => false);
    if (ok) return;
    // which crate answered instead (from the events since the press), shut it, and go home
    const other = await page.evaluate(
      ([n, mine]) => {
        const w = (window as any).__handoff.workshop;
        const looks = ((window as any).__h1events as string[]).slice(n).map((l) => / look (\S+)-card$/.exec(l)?.[1]).filter((x): x is string => !!x && x !== mine);
        const o = looks.at(-1) ?? null;
        if (o && w.world.setting(o, 'open') === true) w.dispatch({ type: 'press', id: `${o}-lid` });
        return o;
      },
      [before, c.crate] as const,
    );
    console.log(`the double-click on ${c.crate} opened ${other ?? 'nothing'} (attempt ${attempt + 1}); again`);
    await page.keyboard.press('Escape');
    await resting(page);
  }
  throw new Error(`${c.crate} never opened under a double-click\n${await dump(page, { crate: c.crate, plate: c.crate }, null)}`);
}

/**
 * A point a hand can press that is `id`'s own: the input's own target under it, the same point for half a second
 * running (nothing of the crew's crossing it), and a part lying still (not in the crew's hands, not moving).
 */
async function pointFor(page: Page, id: string): Promise<{ x: number; y: number }> {
  await page.evaluate(() => ((window as any).__h1aim = null));
  const handle = await page.waitForFunction(
    (id) => {
      const W = window as any;
      const w = W.__handoff.workshop;
      const miss = (): null => ((W.__h1aim = null), null);
      const m = w.world.motion(id);
      if (m && (m.mode !== 'free' || m.awake)) return miss();
      const t = w.surface.screen(id);
      if (!t) return miss();
      const c = w.stage.canvas.getBoundingClientRect();
      let p: { x: number; y: number } | null = null;
      for (const [a, b] of [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3], [0.5, 0.2], [-0.5, 0.2]]) {
        const x = t.x + a! * t.r, y = t.y + b! * t.r;
        if (w.surface.at(x, y, 'mouse', null).id === id) {
          p = { x, y };
          break;
        }
      }
      if (!p) return miss();
      const last = W.__h1aim as { x: number; y: number; n: number } | null;
      W.__h1aim = last && Math.hypot(last.x - p.x, last.y - p.y) < 3 ? { ...p, n: last.n + 1 } : { ...p, n: 1 };
      return W.__h1aim.n >= 8 ? { x: p.x + c.left, y: p.y + c.top } : null;
    },
    id,
    { timeout: 45_000, polling: 60 },
  ).catch(async (e) => {
    throw new Error(`${e}\n${await dump(page, { crate: id, plate: id }, null)}`);
  });
  return (await handle.jsonValue()) as { x: number; y: number };
}

/** What the page is doing, for a failure: the crates, the crew, what the pointer would hit, the world's recent events. */
async function dump(page: Page, c: { crate: string; plate: string }, at: { x: number; y: number } | null): Promise<string> {
  return page.evaluate(
    ([c, at]) => {
      const w = (window as any).__handoff.workshop;
      const t = w.surface.screen(c.plate);
      const r: Record<string, unknown> = {
        playMode: w.world.playMode,
        step: w.world.step,
        crate: { id: c.crate, motion: w.world.motion(c.crate) && { mode: w.world.motion(c.crate).mode, awake: w.world.motion(c.crate).awake }, open: w.world.setting(c.crate, 'open'), screen: w.surface.screen(c.crate) },
        plate: { id: c.plate, screen: t, under: t ? w.surface.at(t.x, t.y, 'mouse', null) : null },
        underClick: at ? w.surface.at(at.x - w.stage.canvas.getBoundingClientRect().left, at.y - w.stage.canvas.getBoundingClientRect().top, 'mouse', null) : null,
        crew: ['fetch', 'revert', 'patch'].map((k) => ({ k, s: w.surface.screen(k), v: w.world.crewView(k)?.view?.state })),
        look: !!w.stage.camera.look,
        held: w.gestures.held,
        events: (window as any).__h1events?.slice(-30),
      };
      return JSON.stringify(r);
    },
    [c, at] as const,
  );
}

/** (for `dump`) The world's events about crates, hands and looks, from now on. */
async function recordEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = (window as any).__handoff.workshop;
    const out: string[] = ((window as any).__h1events = []);
    w.onFrame((f: { events: { type: string; id?: string; crate?: string; target?: string; part?: string }[] }) => {
      for (const e of f.events) if (/crate|grab|releas|look|select|taken|picked|rested|crew\.state/.test(e.type)) out.push(`${w.world.step} ${e.type} ${e.id ?? e.crate ?? e.part ?? e.target ?? ''}`);
      if (out.length > 200) out.splice(0, 100);
    });
  });
}

test.describe('round three: what a panel is about stays in view', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'a hand and the camera on the real GPU');

  test('the hatch, the plate and a crate’s entry from a look: what each is about lies in the clear area within a second, and a look stays a look', async ({ page, browserName }) => {
    await page.setViewportSize(BIG);
    await ready(page, '/', browserName);
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('workshop:panel', { detail: { panel: 'patchlamp' } })));
    await expect(dialog(page)).toBeVisible();
    await expect.poll(() => inClear(page, 'patch'), { timeout: 1500 }).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    await resting(page);
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('workshop:panel', { detail: { panel: 'maker' } })));
    await expect.poll(() => inClear(page, 'undo-lever'), { timeout: 1500 }).toBe(true);
    await page.keyboard.press('Escape');
    await resting(page);
    const c = await crateEntry(page, 't-components');
    await expect.poll(() => inClear(page, c.card), { timeout: 1500 }).toBe(true);
    await resting(page);
    expect(await ws(page, (w) => !!w.stage.camera.look)).toBe(true);
    // (the lead, at the merge of the crates' round four) and it is still a look ON the card: the see-through view reads
    // the look's id for what must show (the card's face, its plate, the thing on the tray), with the panel open and after
    expect(await ws(page, (w) => w.stage.camera.lookId), 'the look is still on the card with the panel open').toBe(c.card);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    await resting(page);
    expect(await ws(page, (w) => w.stage.camera.lookId), 'and after the panel closed').toBe(c.card);
  });

  test('closing gives the view back when the visitor has not moved the camera, and leaves it when they have', async ({ page, browserName }) => {
    await page.setViewportSize(BIG);
    await ready(page, '/', browserName);
    // the camera in on a crate's card (a look); its entry beside it moves the look aside, closing it brings it back
    const project = Object.entries(PROJECTS).find(([, p]) => p.resume === 't-components')![0];
    const c = await ws(page, (w, project) => (w.world.scene.projects as { crate: string; card: string; plate: string; project: string }[]).find((x) => x.project === project)!, project);
    await openByPointer(page, c);
    await resting(page);
    const looking = await view(page);
    const plate = await pointFor(page, c.plate);
    await page.mouse.click(plate.x, plate.y);
    await expect(dialog(page)).toBeVisible();
    await page.waitForTimeout(100);
    await resting(page);
    expect(same(looking, await view(page))).toBe(false);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    await page.waitForTimeout(100);
    await resting(page);
    expect(same(await view(page), looking)).toBe(true);
    expect(await ws(page, (w) => !!w.stage.camera.look)).toBe(true);
    // again, and the visitor zooms (the wheel over the bench) before closing: nothing moves on closing
    const plate2 = await pointFor(page, c.plate);
    await page.mouse.click(plate2.x, plate2.y);
    await expect(dialog(page)).toBeVisible();
    await page.waitForTimeout(100);
    await resting(page);
    await page.mouse.move(200, 450);
    await page.mouse.wheel(0, 240);
    await resting(page);
    const theirs = await view(page);
    await dialog(page).getByRole('button', { name: H.panel.close.text }).click();
    await page.waitForTimeout(300);
    await resting(page);
    expect(same(await view(page), theirs)).toBe(true);
  });

  test('the list and the panel open together: what the panel is about clears both', async ({ page, browserName }) => {
    await page.setViewportSize(BIG);
    await ready(page, '/', browserName);
    await page.getByRole('button', { name: 'Controls', exact: true }).click();
    await expect(page.locator('#controls.open')).toBeVisible();
    await page.locator('#controls button[data-panel="maker"]').click();
    await expect(dialog(page)).toBeVisible();
    await expect(page.locator('#controls.open')).toBeVisible();
    await expect.poll(() => inClear(page, 'undo-lever'), { timeout: 1500 }).toBe(true);
  });

  test('Esc with a look in force: the first (focus in the panel) closes the panel and the camera stays in; the next (on the stage) leaves the look', async ({ page, browserName }) => {
    await page.setViewportSize(BIG);
    await ready(page, '/', browserName);
    await crateEntry(page, 't-components');
    await resting(page);
    expect(await focusIn(page)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    await page.waitForTimeout(200);
    await resting(page);
    expect(await ws(page, (w) => !!w.stage.camera.look)).toBe(true);
    await page.evaluate(() => (window as any).__handoff.workshop.stage.canvas.focus());
    await page.keyboard.press('Escape');
    await resting(page);
    expect(await ws(page, (w) => !!w.stage.camera.look)).toBe(false);
  });

  test('the maker’s log: “nothing yet” only before anything is done; emptied by UNDO, the lines stay, struck through', async ({ page, browserName }) => {
    await page.setViewportSize(BIG);
    await ready(page, '/?panel=maker', browserName);
    const log = dialog(page).locator('.pn-log');
    await expect(log).toHaveText(H.maker.live.history.empty.text);
    await ws(page, (x) => x.dispatch({ type: 'turn', id: 'belt-dial', value: 1 }));
    await expect(log.locator('li').first()).toHaveText('Belt speed: 3 → 5');
    await ws(page, (x) => x.dispatch({ type: 'undo' }));
    await expect(log.locator('li.pn-gone')).toHaveText(['Belt speed: 3 → 5'], { timeout: 20_000 });
    await expect(log).not.toContainText(H.maker.live.history.empty.text);
  });
});
