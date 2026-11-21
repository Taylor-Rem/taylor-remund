/**
 * The stage on `/` (P3 B1; REWRITE.md § B3, § B6, § E7): the bench behind its
 * picture (shell/bench-stage.ts, as on `/dev/bench/`), and around it what a
 * real page needs and a development page does not:
 *
 *   - Read: while the paperwork is shown the stage neither draws nor steps
 *     (its loop is stopped, as for a hidden tab); the strip says when
 *     (ui/strip/strip.ts);
 *   - the governor (shell/governor.ts): the first frames after the handoff
 *     are the frame-time probe, then the rolling frame time steps the stage
 *     down: resolution, then the low tier (built again on the same world:
 *     shell/loader.ts `restage`), then the part-count seam;
 *   - the end of the line: when the stage gives up (a context lost for good,
 *     repeated faults, or it could not start) the page becomes the plain
 *     document with the picture, and a real button starts the workshop
 *     again, afresh, without reloading the page.
 *
 * Nothing here is put on `window` (the dev page's hooks stay on the dev
 * page). The loader's own `window.__handoff` is there, as on every
 * picture-first page (scripts/loadtime.ts reads it).
 *
 * Where later work mounts (Stage.astro says the same):
 *   - the controls list and its live region, the settings panel: the
 *     layout's `over-stage` slot; they reach the running workshop through
 *     `onWorkshop` below (it is called again after a rebuild or a restart);
 *   - a saved motion setting: `reducedMotion` below (today the system's
 *     setting only), handed to the boot;
 *   - a saved quality setting: `savedQuality()` in shell/home-early.ts.
 */
import { Group } from 'three';
import { benchGlue, handoff, startBench, type BenchGlue } from './bench-stage.ts';
import { earlyPhysics } from './early.ts';
import { Governor, type GovernorStep } from './governor.ts';
import { noteFailure, rememberMeasured } from './tier.ts';
import type { Workshop } from './boot.ts';
import type { Strip } from '../ui/strip/strip.ts';
import { createRapierPhysics } from '../sim/index.ts';

export interface HomeOptions {
  tier: 'high' | 'low';
  strip: Strip;
}

const workshopListeners = new Set<(ws: Workshop | null) => void>();
/**
 * The running workshop, now and whenever it changes (built, rebuilt at another tier or after a lost
 * context, given up: null). For the controls list and the settings panel.
 */
export function onWorkshop(f: (ws: Workshop | null) => void): () => void {
  workshopListeners.add(f);
  f(current);
  return () => workshopListeners.delete(f);
}
let current: Workshop | null = null;
const setCurrent = (ws: Workshop | null): void => {
  current = ws;
  for (const f of workshopListeners) f(ws);
};

/** The pixel ratio a tier's stage draws at before any step down (view/stage/index.ts: up to 2 on high, 1 on low). */
const tierRatio = (tier: 'high' | 'low'): number => Math.min(globalThis.devicePixelRatio || 1, tier === 'high' ? 2 : 1);

export async function startHome(o: HomeOptions): Promise<void> {
  const html = document.documentElement;
  const root = document.getElementById('stage-root')!;
  const strip = o.strip;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const restart = document.querySelector<HTMLButtonElement>('button.restart');
  const note = restart?.closest<HTMLElement>('.stage-note') ?? null;

  let tier = o.tier;
  let gov = new Governor({ tier, ratio: tierRatio(tier), lowRatio: tierRatio('low') });
  let last: number | null = null;
  let stepping = false;
  const pauseGovernor = (): void => {
    last = null;
    gov.pause(performance.now());
  };
  document.addEventListener('visibilitychange', pauseGovernor);

  /** One step down (after the frame that asked for it, never inside it). */
  const take = async (step: GovernorStep): Promise<void> => {
    const ws = current;
    if (!ws) return;
    if (step.kind === 'resolution') {
      ws.stage.setResolutionScale(step.ratio / tierRatio(tier));
      return;
    }
    if (step.kind === 'parts') {
      // the part-count seam (§ E7 "then part count"): the bench never has more loose bodies than the low
      // tier's 30 (tests/unit/shell/governor.test.ts), so there is nothing to take away
      return;
    }
    // the low tier: built again on the same world; the bench pauses on its last frame meanwhile
    if (step.why === 'probe') rememberMeasured('low');
    stepping = true;
    try {
      const h = handoff();
      tier = 'low';
      const ok = h ? await h.restage(glue.bootOptions('low')) : false;
      if (!ok) return;
      const r = gov.state.ratio / tierRatio('low');
      if (r < 1) current?.stage.setResolutionScale(r);
    } finally {
      stepping = false;
      pauseGovernor();
    }
  };

  // the governor rides as the last station view: it sees every drawn frame
  const governorView = () => ({
    root: new Group(),
    update() {
      const now = performance.now();
      const prev = last;
      last = now;
      // (only once the stage is live: the loader's settling frames before the swap are not the visit's)
      if (stepping || prev === null || current === null) return;
      const step = gov.frame(now - prev, now);
      if (step) setTimeout(() => void take(step), 0);
    },
    dispose() {},
  });

  // the first stage takes the engine started early; a restart makes a fresh one (a world disposed with its engine)
  let firstPhysics = true;
  const physics = (): ReturnType<typeof earlyPhysics> => {
    if (!firstPhysics) return createRapierPhysics();
    firstPhysics = false;
    return earlyPhysics();
  };

  let glue: BenchGlue = makeGlue();
  function makeGlue(): BenchGlue {
    return benchGlue({
      canvas: document.getElementById('stage') as HTMLCanvasElement,
      tier,
      reducedMotion,
      seed: 1,
      physics,
      extraStations: [governorView],
    });
  }

  // Read: the stage neither draws nor steps while the paperwork is shown
  strip.onReading((reading) => {
    const ws = current;
    if (!ws) return;
    if (reading) {
      ws.phone?.close();
      ws.loop.stop();
    } else {
      ws.loop.start();
      pauseGovernor();
    }
  });

  let failed = false;
  /** The end of the line: the picture, the plain document, and the button. */
  const giveUp = (): void => {
    if (failed) return;
    failed = true;
    noteFailure();
    setCurrent(null);
    html.classList.remove('warming');
    strip.setMode('still');
    if (note) note.hidden = false;
  };

  const start = async (): Promise<void> => {
    failed = false;
    const canvas = document.getElementById('stage') as HTMLCanvasElement;
    const ws = await startBench({
      glue,
      root,
      canvas,
      reducedMotion,
      onGiveUp: giveUp,
      onRebuilt: (nw) => setCurrent(nw),
    });
    if (!ws) {
      giveUp();
      return;
    }
    setCurrent(ws);
    if (strip.reading) ws.loop.stop();
  };

  restart?.addEventListener('click', () => {
    if (note) note.hidden = true;
    // afresh: a new canvas (the old one's context may be gone for good), the first tier chosen, a new world
    const old = document.getElementById('stage') as HTMLCanvasElement;
    const fresh = old.cloneNode(false) as HTMLCanvasElement;
    old.replaceWith(fresh);
    root.classList.remove('stage-failed', 'live', 'warm-done');
    tier = o.tier;
    gov = new Governor({ tier, ratio: tierRatio(tier), lowRatio: tierRatio('low') });
    last = null;
    glue = makeGlue();
    strip.setMode('stage');
    // the button is gone: focus goes to the stage once it is up (its canvas takes keys), else back to the button
    void start().then(() => (current ? current.stage.canvas.focus({ preventScroll: true }) : restart.focus({ preventScroll: true })));
  });

  await start();
}
