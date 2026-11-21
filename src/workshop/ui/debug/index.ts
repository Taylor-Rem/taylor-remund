/**
 * `?debug` on `/` (P3 B3; REWRITE.md § E10 "`?debug` shows frame time, draw
 * calls, body count, tier, and the undo stack"): a small fixed panel, read
 * only, monospace, top left under the strip. Loaded only when the address
 * asks (shell/home-early.ts imports it behind the check). It reads; it never
 * changes the stage or the world.
 *
 *   frame      the rolling mean frame time over the last second, and the
 *              worst frame of the last five seconds (ms)
 *   draw calls the scene's, last frame (the post chain's full-screen passes
 *              are not counted)
 *   bodies     loose bodies on the bench, and how many are awake
 *   tier       the tier and why it was chosen (`data-tier-why`)
 *   governor   the tier it judges, the pixel ratio, and whether it has
 *              nothing left to step down to
 *   undo       the stack's depth and its top three entries, newest first
 */
import { site } from '../../../content/site.ts';
import type { HomePage } from '../../shell/home-early.ts';
import type { World } from '../../sim/index.ts';

const WORST_MS = 5000;
const MEAN_MS = 1000;

export function startDebug(page: HomePage): void {
  const w = site.debug;
  const html = document.documentElement;
  const box = document.createElement('pre');
  box.className = 'debug-panel';
  box.setAttribute('aria-hidden', 'true');
  Object.assign(box.style, {
    position: 'fixed', left: '16px', top: '96px', zIndex: '31', margin: '0', padding: '6px 8px', pointerEvents: 'none',
    font: '11px/15px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', whiteSpace: 'pre',
    color: 'var(--cream)', background: 'var(--wall)', opacity: '0.88', border: '1px solid var(--cream-soft)', borderRadius: '3px',
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.append(box);
  const place = (): void => {
    const strip = document.querySelector('.strip');
    box.style.top = `${Math.round((strip?.getBoundingClientRect().bottom ?? 0) + 8)}px`;
  };
  place();
  addEventListener('resize', place);

  const frames: { t: number; ms: number }[] = [];
  let lastT: number | null = null;
  void page.home().then((h) => {
    h?.onFrame(() => {
      const t = performance.now();
      if (lastT !== null) frames.push({ t, ms: t - lastT });
      lastT = t;
      while (frames.length && frames[0]!.t < t - WORST_MS) frames.shift();
    });
  });

  const fmt = (ms: number): string => ms.toFixed(1).padStart(5);
  const show = async (): Promise<void> => {
    const h = await page.home();
    const ws = h?.workshop() ?? null;
    const lines: string[] = [];
    const tier = `${w.tier.text}     ${html.dataset['tier'] ?? '?'} (${html.dataset['tierWhy'] ?? '?'})`;
    if (!h || !ws) {
      lastT = null;
      box.textContent = `${w.none.text}\n${tier}`;
      return;
    }
    const t = performance.now();
    const recent = frames.filter((f) => f.t >= t - MEAN_MS);
    const mean = recent.length ? recent.reduce((a, f) => a + f.ms, 0) / recent.length : 0;
    const worst = frames.reduce((a, f) => Math.max(a, f.ms), 0);
    lines.push(`${w.frame.text}    ${fmt(mean)} ms   ${w.worst.text} ${fmt(worst)} ms`);
    lines.push(`${w.calls.text} ${ws.stage.stats().scene.calls}`);
    const world = ws.simWorld as World;
    let bodies = 0;
    let awake = 0;
    for (const p of world.parts()) {
      const m = world.motion(p.id);
      if (!m) continue;
      bodies++;
      if (m.awake) awake++;
    }
    lines.push(`${w.bodies.text}   ${bodies}   ${w.awake.text} ${awake}`);
    lines.push(tier);
    const g = h.governor();
    lines.push(`${w.governor.text} ${g.tier} ×${g.ratio.toFixed(2)}${g.done ? ' ·' : ''}`);
    const stack = world.undoStack();
    lines.push(`${w.undo.text}     ${stack.length}`);
    for (const e of stack.slice(-3).reverse()) lines.push(`  ${e.id} ${e.kind} ${e.subject}`);
    box.textContent = lines.join('\n');
  };
  setInterval(() => void show(), 250);
  void show();
}
