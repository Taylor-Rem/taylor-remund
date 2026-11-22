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
import type { Workshop } from '../../shell/boot.ts';
import type { World } from '../../sim/index.ts';
import { fill } from '../controls/words.ts';
import { PANEL_EVENT, panelId, platePanel, type PanelId } from './ids.ts';
import { historyLines, linesKey, type LogWords } from './log.ts';
import { createPanels, type Panels } from './panel.ts';

/** How often the open maker's plate redraws its live lines, ms. */
const LIVE_MS = 250;
/** The frame time is the mean over this long, ms (as `?debug`'s). */
const MEAN_MS = 1000;

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
    const key = lines.length ? linesKey(lines) : 'empty';
    if (key === drawn) return;
    drawn = key;
    if (lines.length === 0) {
      const li = doc.createElement('li');
      li.className = 'pn-empty';
      li.textContent = words.empty;
      log.replaceChildren(li);
      return;
    }
    log.replaceChildren(
      ...lines.map((l) => {
        const li = doc.createElement('li');
        li.textContent = l.text;
        if (l.next) li.className = 'pn-next';
        return li;
      }),
    );
  };

  const panels = createPanels({
    doc,
    onOpen(id, body) {
      clearInterval(live);
      if (id !== 'maker') return;
      drawn = '';
      drawLive(body);
      live = setInterval(() => drawLive(body), LIVE_MS);
    },
    onClose() {
      clearInterval(live);
      live = undefined;
    },
  });
  if (!panels) return null;

  const open = (id: PanelId | null, from: HTMLElement | null = null): boolean => (id && ws ? panels.open(id, from) : false);

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
