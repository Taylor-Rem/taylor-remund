/**
 * The panels' start (P4 H1): asked for by the page once the bench is usable
 * (src/components/paper/Panels.astro), never on the Still tier. It follows the
 * running workshop (shell/home.ts `onWorkshop`) and opens a panel when
 *
 *   - a plate in the world is pressed: a `plate.pressed` sim event in a
 *     frame's events (ids.ts says the shape; for the plates still to come:
 *     Patchlamp's, the maker's, the mailbox, the clipboard);
 *   - the page asks: a `workshop:panel` DOM event, which it cancels when it
 *     opened a panel (the controls list sends it for a project crate's
 *     `crate.plate` event, for the crates' plate links and for its Plates
 *     group, and goes to /resume/ itself when nothing took it:
 *     ui/controls/list.ts);
 *   - the address asks: `/?panel=<id>`, once, when the bench is first usable
 *     (the development flag; the crates' plates are not on the bench yet).
 *
 * The maker's plate's live part is drawn here while it is open: the undo
 * stack in words (log.ts), the frame time now. It reads the world; it changes
 * nothing, and nothing it reads leaves the browser.
 */
import { onWorkshop } from '../../shell/home.ts';
import type { Reveal, Workshop } from '../../shell/boot.ts';
import type { World } from '../../sim/index.ts';
import { fill } from '../controls/words.ts';
import { projectOf } from '../controls/model.ts';
import { PANEL_EVENT, panelId, platePanel, type PanelId } from './ids.ts';
import { historyLines, linesKey, type LogLine, type LogWords } from './log.ts';
import { createPanels, type Panels } from './panel.ts';

/** How often the open maker's plate redraws its live lines, ms. */
const LIVE_MS = 250;
/** The frame time is the mean over this long, ms (as `?debug`'s). */
const MEAN_MS = 1000;
/** (round three) Must match panel.ts / panel.css: at or below this width the panel is a modal sheet. */
const SHEET_QUERY = '(max-width: 640px)';
/** (round three) Below this many CSS px of stage between the strip and a sheet, nothing is brought into it. */
const SHEET_MIN_STAGE = 140;
/** (round three) What Patchlamp's hatch is about on the bench: Patch at the switchboard (its jacks beside it). */
const PATCHLAMP_ABOUT = 'patch';

interface Words extends LogWords {
  empty: string;
  frame: string;
}

export function mountPanels(doc: Document = document): Panels | null {
  const raw = doc.getElementById('pn-words')?.textContent;
  if (!raw) return null;
  const words = JSON.parse(raw) as Words;
  let ws: Workshop | null = null;
  let live: ReturnType<typeof setInterval> | undefined;
  let drawn = '';

  // ── the frame time: the gaps between the stage's frames over the last second (a ring; nothing allocated per frame) ──
  const RING = 256;
  const at = new Float64Array(RING);
  let n = 0;
  const tick = (): void => {
    at[n % RING] = performance.now();
    n++;
  };
  const frameMs = (): number | null => {
    if (n < 2) return null;
    const last = at[(n - 1) % RING]!;
    let k = 1;
    while (k < Math.min(n, RING) - 1 && last - at[(n - 1 - k) % RING]! < MEAN_MS) k++;
    const first = at[(n - 1 - k) % RING]!;
    return k > 0 ? (last - first) / k : null;
  };

  const drawLive = (body: HTMLElement): void => {
    const frame = body.querySelector<HTMLElement>('.pn-frame');
    const ms = frameMs();
    if (frame && ms !== null) frame.textContent = fill(words.frame, { ms: ms.toFixed(1) });
    const log = body.querySelector<HTMLOListElement>('.pn-log');
    if (!log || !ws) return;
    const lines = historyLines(ws.world, (ws.simWorld as World).undoStack(), words);
    // (round three) an empty stack says "nothing yet" only while nothing has been done this visit; emptied by UNDO (or a
    // reset), the lines it last showed stay, struck through: taken back, not never done
    const fresh = !ws.world.playMode;
    const key = lines.length ? linesKey(lines) : fresh ? 'empty' : `gone\n${linesKey(lastShown)}`;
    if (key === drawn) return;
    drawn = key;
    if (lines.length === 0) {
      if (fresh || lastShown.length === 0) {
        if (fresh) {
          const li = doc.createElement('li');
          li.className = 'pn-empty';
          li.textContent = words.empty;
          log.replaceChildren(li);
        } else log.replaceChildren();
        return;
      }
      log.replaceChildren(
        ...lastShown.map((l) => {
          const li = doc.createElement('li');
          li.className = 'pn-gone';
          li.textContent = l.text;
          return li;
        }),
      );
      return;
    }
    lastShown = lines;
    log.replaceChildren(
      ...lines.map((l) => {
        const li = doc.createElement('li');
        li.textContent = l.text;
        if (l.next) li.className = 'pn-next';
        return li;
      }),
    );
  };
  /** The lines the log last showed with something on the stack (struck through once UNDO has emptied it). */
  let lastShown: readonly LogLine[] = [];

  // ── (round three) what the panel covers, and what it is about kept in view ──
  const dialog = doc.getElementById('plate-panel') as HTMLDialogElement | null;
  const win = doc.defaultView!;
  const sheetQuery = win.matchMedia(SHEET_QUERY);
  let reveal: Reveal | null = null;
  /** Tell the shell what the panel covers now (under its own name: the list's is kept beside it). */
  const cover = (): void => {
    if (!ws) return;
    const none = { top: 0, right: 0, bottom: 0, left: 0 };
    if (!dialog?.open) {
      ws.framing.setInset(none, 'panel');
      return;
    }
    const r = dialog.getBoundingClientRect();
    const W = ws.stage.canvas.clientWidth || win.innerWidth;
    const H = ws.stage.canvas.clientHeight || win.innerHeight;
    if (sheetQuery.matches) ws.framing.setInset({ ...none, bottom: Math.max(0, H - r.top) }, 'panel');
    else if (dialog.classList.contains('pn-left')) ws.framing.setInset({ ...none, left: Math.max(0, r.right) }, 'panel');
    else ws.framing.setInset({ ...none, right: Math.max(0, W - r.left) }, 'panel');
  };
  /** The thing a panel is about (ids only): a project crate's card (open) or the crate; Patch at its switchboard; the UNDO lever. */
  const aboutOf = (id: PanelId): string | null => {
    if (!ws) return null;
    const w = ws.world;
    if (id === 'patchlamp') return ws.framing.screenRect(PATCHLAMP_ABOUT) ? PATCHLAMP_ABOUT : null;
    if (id === 'maker') return w.undoId;
    if (id.startsWith('project:')) {
      const anchor = `#p-${id.slice('project:'.length)}`;
      for (const c of w.scene.projects ?? []) {
        if (!projectOf(w, c.crate)?.href.endsWith(anchor)) continue;
        return w.setting(c.crate, 'open') === true && c.card ? c.card : c.crate;
      }
    }
    return null;
  };
  /** The side the panel stands on (wide screens): away from what it is about, so the least move shows it. */
  const placeFor = (about: string | null): void => {
    if (!dialog || !ws) return;
    const r = about ? ws.framing.screenRect(about) : null;
    const W = ws.stage.canvas.clientWidth || win.innerWidth;
    dialog.classList.toggle('pn-left', !sheetQuery.matches && !!r && (r.x0 + r.x1) / 2 > W * 0.55);
  };
  /** Bring what the panel is about into what it leaves clear (on a phone: only where the sheet leaves a strip worth it). */
  const show = (id: PanelId): void => {
    if (!ws) return;
    cover();
    const about = aboutOf(id);
    if (sheetQuery.matches && dialog) {
      const strip = doc.querySelector('header.strip')?.getBoundingClientRect().bottom ?? 0;
      if (dialog.getBoundingClientRect().top - strip < SHEET_MIN_STAGE) {
        reveal = ws.framing.reveal(null, reveal);
        return;
      }
    }
    reveal = ws.framing.reveal(about, reveal);
  };
  let closing = false;
  const finishClose = (): void => {
    closing = false;
    if (panels?.current) return; // (swapped, not closed)
    cover();
    reveal?.back();
    reveal = null;
  };

  const panels = createPanels({
    doc,
    onOpen(id, body) {
      clearInterval(live);
      show(id);
      if (id !== 'maker') return;
      drawn = '';
      drawLive(body);
      live = setInterval(() => drawLive(body), LIVE_MS);
    },
    onClose() {
      clearInterval(live);
      live = undefined;
      // (a swap closes and opens in one go: the view is given back only if nothing opened again)
      if (!closing) {
        closing = true;
        queueMicrotask(finishClose);
      }
    },
  });
  if (!panels) return null;
  win.addEventListener('resize', () => {
    if (dialog?.open) cover();
  });

  const open = (id: PanelId | null, from: HTMLElement | null = null): boolean => {
    if (!id || !ws) return false;
    if (!panels.current) placeFor(aboutOf(id));
    return panels.open(id, from);
  };

  let offFrame: (() => void) | null = null;
  let asked = panelId(new URLSearchParams(doc.defaultView?.location.search ?? '').get('panel'));
  onWorkshop((w) => {
    offFrame?.();
    offFrame = null;
    ws = w;
    if (!w) {
      panels.close();
      return;
    }
    offFrame = w.onFrame((frame) => {
      tick();
      for (const e of frame.events) {
        const id = platePanel(e);
        if (id) open(id);
      }
    });
    if (asked) {
      open(asked);
      asked = null;
    }
  });
  doc.addEventListener(PANEL_EVENT, (e) => {
    const d = (e as CustomEvent<{ panel?: unknown; from?: HTMLElement }>).detail;
    // opened: the asker's fallback (a link to /resume/) is not wanted
    if (open(panelId(d?.panel), d?.from ?? null)) e.preventDefault();
  });
  return panels;
}
