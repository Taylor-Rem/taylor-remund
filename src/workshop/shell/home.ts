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
 * P3 B3, what the page remembers and the settings (shell/saved.ts holds the
 * keys and says what each holds):
 *
 *   - the visit's snapshot: read before the world is made (through
 *     `parseSaved`: a refusal is a fresh visit), handed to the boot, written
 *     on every `saved.changed` the world reports;
 *   - reduced motion, the EFFECTIVE one (the setting, or the system's while
 *     it is followed): the stage, its views and the camera at boot; the
 *     handoff (a cut); the world, told right after the bench has stepped to
 *     its picture's state and before its first live step. A change during
 *     the visit reaches the world and the camera at once, and the views by a
 *     restage on the same world (the bench pauses on its last frame for the
 *     rebuild, then carries on);
 *   - the quality (`HomeControl`): high and low by `restage` on the same
 *     world, the camera where it was; the still picture: the stage taken
 *     down; back from it: started again, as the restart button starts it,
 *     on a new world made from what is saved;
 *   - "Reset the workshop": the world's own `reset` intent.
 *
 * Nothing here is put on `window` (the dev page's hooks stay on the dev
 * page). The loader's own `window.__handoff` is there, as on every
 * picture-first page (scripts/loadtime.ts reads it).
 *
 * Where later work mounts (Stage.astro says the same):
 *   - the controls list and its live region, the settings panel: the
 *     layout's `over-stage` slot; they reach the running workshop through
 *     `onWorkshop` below (it is called again after a rebuild or a restart).
 */
import { Group } from 'three';
import { benchGlue, handoff, startBench, type BenchGlue } from './bench-stage.ts';
import { earlyPhysics } from './early.ts';
import { Governor, type GovernorState, type GovernorStep } from './governor.ts';
import { noteFailure, rememberMeasured } from './tier.ts';
import { SAVED_KEY, onReducedMotion, readKey, reducedNow, writeKey } from './saved.ts';
import type { Workshop } from './boot.ts';
import type { Strip } from '../ui/strip/strip.ts';
import type { Frame } from '../view/types.ts';
import { createRapierPhysics, parseSaved, savedText, type Intent, type World } from '../sim/index.ts';

export interface HomeOptions {
  tier: 'high' | 'low';
  strip: Strip;
}

/** What the settings (and the playtest log, the debug panel) may ask of the stage on `/`. */
export interface HomeControl {
  /** The tier the stage runs at, or was last asked for. */
  readonly tier: 'high' | 'low';
  /** A stage is up (live, or on its way). False once taken down or given up. */
  readonly up: boolean;
  /** Resolves when the first start has finished (live, or failed). */
  readonly ready: Promise<void>;
  /** High or low during a visit: built again on the same world, the camera where it was (started again, if down). */
  setTier(t: 'high' | 'low'): Promise<boolean>;
  /** The still picture: the stage is taken down and the page becomes the plain document. */
  toStill(): void;
  /** "Reset the workshop" (a rung that is playing ends first). False if there is no stage to reset. */
  reset(): Promise<boolean>;
  /** The governor as it stands (the debug panel). */
  governor(): GovernorState;
  /** The running workshop, or null (the debug panel, the playtest log). */
  workshop(): Workshop | null;
  /** Every drawn frame of the running stage (the debug panel, the playtest log). */
  onFrame(f: (frame: Frame) => void): () => void;
  /** Every intent dispatched on the running stage, with its time (performance.now()). */
  onIntent(f: (intent: Intent, t: number) => void): () => void;
}

/** The camera's zoom (0 the whole bench, 1 one station) past which the view counts as away from home. */
const AWAY_ZOOM = 0.05;

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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function startHome(o: HomeOptions): HomeControl {
  const html = document.documentElement;
  const root = document.getElementById('stage-root')!;
  const strip = o.strip;
  /** Effective reduced motion (shell/saved.ts), as the stage was last built with it. */
  let reducedMotion = reducedNow();
  /** Reduced motion as the stage's views were last built with it. */
  let builtReduced = reducedMotion;
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
  const setTierAttr = (t: string, why: string): void => {
    html.dataset['tier'] = t;
    html.dataset['tierWhy'] = why;
  };

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
      const opts = glue.bootOptions('low');
      const ok = h ? await h.restage(opts) : false;
      if (!ok) return;
      builtReduced = opts.reducedMotion;
      if (strip.reading) current?.loop.stop();
      setTierAttr('low', step.why === 'probe' ? 'slow frames' : 'frames slowed');
      const r = gov.state.ratio / tierRatio('low');
      if (r < 1) current?.stage.setResolutionScale(r);
    } finally {
      stepping = false;
      pauseGovernor();
    }
  };

  // the governor rides as the last station view but one: it sees every drawn frame
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

  // ── what the page hears from the running stage: every frame (the snapshot is saved here), every intent ──
  const frameListeners = new Set<(frame: Frame) => void>();
  const intentListeners = new Set<(intent: Intent, t: number) => void>();
  // Away from the home view (zoomed in on a station), anything may pass behind the strip and the legal line: the
  // page says so on <html> and Stage.astro puts a shade behind their words (at home they lie on the dark wall).
  let away = false;
  const setAway = (a: boolean): void => {
    if (a === away) return;
    away = a;
    html.classList.toggle('away', a);
  };
  const pageView = () => ({
    root: new Group(),
    update(frame: Frame) {
      for (const e of frame.events) {
        // the world says when what a visit remembers has changed: written at once (the last tab to write wins)
        if (e.type === 'saved.changed') writeKey(SAVED_KEY, savedText((frame.world as World).saved()));
      }
      setAway((current?.stage.camera.zoom ?? 0) > AWAY_ZOOM);
      for (const f of frameListeners) f(frame);
    },
    dispose() {
      setAway(false);
    },
  });
  const heard = (intent: Intent, t: number): void => {
    for (const f of intentListeners) f(intent, t);
  };

  // the first stage takes the engine started early; a restart makes a fresh one (a world disposed with its engine)
  let firstPhysics = true;
  const physics = (): ReturnType<typeof earlyPhysics> => {
    if (!firstPhysics) return createRapierPhysics();
    firstPhysics = false;
    return earlyPhysics();
  };

  let glue: BenchGlue = makeGlue();
  function makeGlue(): BenchGlue {
    const g = benchGlue({
      canvas: document.getElementById('stage') as HTMLCanvasElement,
      tier,
      reducedMotion,
      seed: 1,
      physics,
      extraStations: [governorView, pageView],
    });
    // what the last visit remembered, read now (another tab may have written since this page loaded)
    const saved = parseSaved(readKey(SAVED_KEY));
    return {
      prepare: () => g.prepare(),
      get bench() {
        return g.bench;
      },
      shots: g.shots,
      portrait: () => g.portrait(),
      // the motion setting as it is when the stage is (re)built; the snapshot (a stage rebuilt on its world ignores it)
      bootOptions: (t) => ({ ...g.bootOptions(t), reducedMotion, onIntent: heard, ...(saved ? { saved } : {}) }),
    };
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
  /** A stage is up or on its way (false once taken down or given up). */
  let up = true;
  /** The end of the line: the picture, the plain document, and the button. */
  const giveUp = (): void => {
    up = false;
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
    up = true;
    builtReduced = reducedMotion;
    const canvas = document.getElementById('stage') as HTMLCanvasElement;
    const ws = await startBench({
      glue,
      root,
      canvas,
      reducedMotion,
      onGiveUp: giveUp,
      onRebuilt: (nw) => setCurrent(nw),
      // the world hears reduced motion once it stands where the picture shows it, before its first live step
      beforeLive: (nw) => {
        if (reducedMotion) nw.simWorld.dispatch({ type: 'motion', reduced: true });
      },
    });
    if (!ws) {
      giveUp();
      return;
    }
    // the visitor chose the still picture while it was loading
    if (!up) {
      handoff()?.takeDown();
      return;
    }
    setCurrent(ws);
    if (strip.reading) ws.loop.stop();
  };

  /** Afresh: a new canvas (the old one's context may be gone for good), a new world from what is saved. */
  const startAgain = (t: 'high' | 'low'): Promise<void> => {
    if (note) note.hidden = true;
    const old = document.getElementById('stage') as HTMLCanvasElement;
    const fresh = old.cloneNode(false) as HTMLCanvasElement;
    old.replaceWith(fresh);
    root.classList.remove('stage-failed', 'live', 'warm-done');
    tier = t;
    gov = new Governor({ tier, ratio: tierRatio(tier), lowRatio: tierRatio('low') });
    last = null;
    glue = makeGlue();
    strip.setMode('stage');
    return start();
  };

  restart?.addEventListener('click', () => {
    // the first tier chosen; the button is gone: focus goes to the stage once it is up (its canvas takes keys),
    // else back to the button
    void startAgain(o.tier).then(() => (current ? current.stage.canvas.focus({ preventScroll: true }) : restart.focus({ preventScroll: true })));
  });

  // ── reduced motion during the visit (the setting, or the system's own while it is followed) ──
  // The world and the camera follow at once. The station views read reduced motion as `ctx.reducedMotion ||
  // world.reducedMotion`, so a stage built with full motion follows the world's "reduced" at once too (only the
  // swing of a lifted cord and the lamp's colour fades keep their build-time setting). A stage BUILT reduced
  // cannot show full motion until its views are built again: then, and only then, it is restaged on the same
  // world (the bench holds its last frame for the rebuild, about two seconds here, then carries on).
  let motionQueue: Promise<void> = Promise.resolve();
  onReducedMotion((r) => {
    html.classList.toggle('motion-reduced', r);
    motionQueue = motionQueue.then(async () => {
      if (r === reducedMotion) return;
      reducedMotion = r;
      const ws = current;
      if (!ws) return; // not up: the next start reads it
      ws.simWorld.dispatch({ type: 'motion', reduced: r });
      ws.stage.camera.reducedMotion = r;
      if (r || !builtReduced) return;
      const h = handoff();
      if (!h) return;
      // (after the panel has drawn the visitor's choice)
      await sleep(80);
      while (stepping) await sleep(50);
      if (reducedMotion !== r || current === null) return;
      stepping = true;
      try {
        if (await h.restage({ reducedMotion: r })) builtReduced = r;
        if (strip.reading) current?.loop.stop();
      } finally {
        stepping = false;
        pauseGovernor();
      }
    });
  });

  const ready = start();

  return {
    get tier() {
      return tier;
    },
    get up() {
      return up && !failed;
    },
    ready,
    async setTier(t) {
      await ready;
      if (!up || failed || !current) {
        setTierAttr(t, 'saved setting');
        await startAgain(t);
        return current !== null;
      }
      if (t === tier) return true;
      const h = handoff();
      if (!h) return false;
      while (stepping) await sleep(50);
      stepping = true;
      const was = tier;
      try {
        tier = t;
        const opts = glue.bootOptions(t);
        const ok = await h.restage(opts);
        if (!ok) {
          tier = was;
          return false;
        }
        builtReduced = opts.reducedMotion;
        if (strip.reading) current?.loop.stop();
        setTierAttr(t, 'saved setting');
        // a governor for the tier the visitor chose (no probe: that is the first frames of a visit)
        gov = new Governor({ tier: t, ratio: tierRatio(t), lowRatio: tierRatio('low'), probe: false });
        return true;
      } finally {
        stepping = false;
        pauseGovernor();
      }
    },
    toStill() {
      setTierAttr('still', 'saved setting');
      up = false;
      if (current) {
        handoff()?.takeDown();
        setCurrent(null);
      }
      // the plain document, the picture at full brightness (not a failure: no restart button; the settings bring it back)
      html.classList.remove('warming');
      strip.setMode('still');
    },
    async reset() {
      const ws = current;
      if (!ws) return false;
      // a rung that is playing ends first (the world refuses a reset inside its bracket)
      for (let i = 0; i < 150 && ws.world.bracketed; i++) await sleep(100);
      if (current !== ws) return false;
      ws.dispatch({ type: 'reset' });
      return true;
    },
    governor: () => gov.state,
    workshop: () => current,
    onFrame(f) {
      frameListeners.add(f);
      return () => frameListeners.delete(f);
    },
    onIntent(f) {
      intentListeners.add(f);
      return () => intentListeners.delete(f);
    },
  };
}
