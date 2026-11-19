/**
 * Picture first (REWRITE.md § B3 rows "before JavaScript", "loading", "0 s";
 * § E6; B1): the page shows a still picture of the scene in plain HTML; this
 * loader warms it up with real progress, builds the live stage behind it in
 * the picture's own state and from the picture's own camera, and swaps when
 * the stage has drawn a settled frame.
 *
 *   loading   the picture brightens as the lamp "warms up" (`--warm` on the
 *             root, 0.42 → 1, from boot progress; no spinner, no bar)
 *   ready     the stage is stepped to the picture's state (`step` fixed
 *             steps, `settle` still frames), its camera is the picture's
 *             (shell/poster.ts), its shaders are compiled and its last frames
 *             were short
 *   swap      the canvas comes up over the picture (a short cross-fade, a cut
 *             under reduced motion); then the loop starts and input is live
 *   failure   any error, or no WebGL: the picture stays, at full brightness
 *             (`stage-failed` on the root; the Still tier of § E7 is P3's)
 *
 * It knows no scene: the page hands it the boot options (stations, scene,
 * framing) through `prepare` and the picture set through `posters`.
 *
 * The page's markup (see src/dev-pages/handoff.astro):
 *
 *   <html class="warming">      ← (or any ancestor of root) added by an inline script
 *   <div class="stage-root">     ← root; --warm set here
 *     <picture>…<img class="poster" elementtiming="poster"></picture>
 *     <canvas></canvas>                              ← hidden until the swap
 *   </div>
 *
 * with CSS that dims `.poster` by `--warm` only under `.warming`, shows the
 * canvas only under `.live`, and an inline script that adds `warming` (so
 * with no JavaScript the picture is never dim) and takes it off again if the
 * loader has not said it is alive within a few seconds.
 */
import type { Stage } from '../view/stage/index.ts';
import type { SceneDesc } from '../sim/index.ts';
import { bootWorkshop, defaultFraming, mark, measure, yieldToBrowser, type BootOptions, type BootPhase, type Workshop } from './boot.ts';
import { cropIsExact, entryForUrl, warmth, type PosterEntry, type PosterSet, type PosterView } from './poster.ts';

/** How much of the warm-up each boot phase is (measured shares of the vignette's load, unthrottled and Fast 4G). */
export const PHASE_WEIGHTS: Record<'modules' | BootPhase | 'settle', number> = {
  modules: 0.2,
  stage: 0.04,
  labels: 0.06,
  views: 0.4,
  physics: 0.12,
  world: 0.04,
  compile: 0.06,
  frame: 0.03,
  settle: 0.05,
};

/** Turns phase reports into one monotone 0..1. */
export class Progress {
  private readonly done = new Map<string, number>();
  private value = 0;
  private readonly weights: Record<string, number>;
  constructor(weights: Record<string, number> = PHASE_WEIGHTS) {
    this.weights = weights;
  }
  /** Report `done/total` of a phase; returns the overall progress (never goes back). */
  report(phase: string, done: number, total = 1): number {
    const f = total > 0 ? Math.min(1, Math.max(0, done / total)) : 1;
    this.done.set(phase, Math.max(this.done.get(phase) ?? 0, f));
    let sum = 0;
    let all = 0;
    for (const [k, w] of Object.entries(this.weights)) {
      all += w;
      sum += w * (this.done.get(k) ?? 0);
    }
    this.value = Math.max(this.value, all > 0 ? sum / all : 1);
    return this.value;
  }
  get current(): number {
    return this.value;
  }
}

/** What the page gives the loader. */
export interface StageLoadOptions {
  /** The element holding the picture and the canvas. */
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  /** The <img> of the <picture> (its currentSrc says which band the browser chose). */
  img: HTMLImageElement | null;
  /** The picture set; null renders no picture (the poster script's own mode). */
  posters: PosterSet | null;
  /** Where a poster file is served (the page's map from file name to URL). */
  url(file: string): string;
  /**
   * Load the scene: modules, pieces, station list. Called at once; may report
   * its own progress (0..1). Returns the boot options (everything but what the
   * loader owns: manual, onProgress).
   */
  prepare(progress: (f: number) => void): Promise<Omit<BootOptions, 'manual' | 'onProgress'>>;
  /** Start these loads at once (physics, fonts): kicked off before the scene modules. */
  early?: readonly (() => Promise<unknown>)[];
  reducedMotion: boolean;
  /** Cross-fade length, ms (0 under reduced motion). */
  fadeMs?: number;
  /**
   * Proof hooks (scripts/poster.ts): stop before the swap and after it, before
   * the loop starts, until `release()` is called.
   */
  hold?: boolean;
  /** Called once the stage is live. */
  onLive?(ws: Workshop): void;
  /**
   * The poster script's mode: render this band's picture (no picture is
   * adopted; the camera is `bandView` at the stage's aspect, made valid down
   * to `narrowest`). The state is `posters`' if given, else `step`/`settle` here.
   */
  renderBand?: { narrowest: number; step: number; settle: number };
}

/** What the loader exposes on `window.__handoff` (tests, loadtime, poster). */
export interface HandoffState {
  alive: boolean;
  phase: 'loading' | 'settling' | 'held-picture' | 'swapping' | 'held-stage' | 'live' | 'failed';
  progress: number;
  /** performance.now() when the stage became usable. */
  usableAt: number | null;
  failed: string | null;
  /** The band chosen and the adoption result. */
  band: { minAspect: number; aspect: number } | null;
  adopted: { view: PosterView; error: number } | null;
  /** The rig's view after the scene's own framing (what a poster records). */
  framed: PosterView | null;
  settleFrames: number;
  release(): void;
  report(): Record<string, unknown>;
  workshop: Workshop | null;
}

const now = (): number => performance.now();

/** The rig's view as a poster view (focus and distance). */
export function viewOf(stage: Stage): PosterView {
  const v = stage.camera.view();
  return { focus: [v.focus[0], v.focus[1], v.focus[2]], distance: stage.camera.distance };
}

/**
 * Put the rig on a poster's camera. Returns how far the result is from the
 * picture's camera (world units, camera position), 0 when exact: the rig may
 * clamp a view (pan limits) and then the first frame would not be the picture.
 */
export function adoptView(stage: Stage, v: PosterView): number {
  const rig = stage.camera;
  // held: the camera takes the poster's view exactly, beyond its pan limits if need be, until the visitor moves it
  rig.cutTo({ focus: v.focus, zoom: rig.zoomForDistance(v.distance) }, { hold: true });
  const got = viewOf(stage);
  return Math.hypot(got.focus[0] - v.focus[0], got.focus[1] - v.focus[1], got.focus[2] - v.focus[2]) + Math.abs(got.distance - v.distance);
}

/**
 * The camera a band's picture is rendered from: the scene's own framing at
 * the band's widest aspect (the stage's current one), made valid for the
 * whole band. The rig clamps a view to pan limits that depend on the aspect;
 * a view clamped at the band's NARROWEST aspect is inside the limits at every
 * aspect of the band, so the stage can adopt it anywhere in the band without
 * the rig moving it.
 */
export function bandView(stage: Stage, narrowest: number): PosterView {
  const rig = stage.camera;
  const canvas = stage.renderer.domElement;
  const wide = (canvas.clientWidth || canvas.width) / (canvas.clientHeight || canvas.height);
  const v0 = viewOf(stage);
  rig.setAspect(narrowest);
  rig.cutTo({ focus: v0.focus, zoom: rig.zoomForDistance(v0.distance) });
  const v1 = viewOf(stage);
  rig.setAspect(wide);
  rig.cutTo({ focus: v1.focus, zoom: rig.zoomForDistance(v1.distance) });
  return viewOf(stage);
}

/** Bring a booted workshop (manual mode) to the picture's state: the same calls the poster was made with. */
export function stepToPicture(ws: Workshop, set: Pick<PosterSet, 'step' | 'settle'>): void {
  if (set.step > 0) ws.advance(set.step);
  for (let i = 0; i < set.settle; i++) ws.advance(0);
}

const frame = (): Promise<number> => new Promise((r) => requestAnimationFrame(r));
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Load the stage behind the picture and swap it in. Resolves with the
 * workshop once live, or null if it failed (the picture stays).
 */
export async function loadStage(o: StageLoadOptions): Promise<Workshop | null> {
  const t0 = now();
  mark('loader');
  const root = o.root;
  const reduced = o.reducedMotion;
  const fadeMs = reduced ? 0 : (o.fadeMs ?? 150);
  const progress = new Progress();
  let releaseHold: (() => void) | null = null;
  const state: HandoffState = {
    alive: true,
    phase: 'loading',
    progress: 0,
    usableAt: null,
    failed: null,
    band: null,
    adopted: null,
    framed: null,
    settleFrames: 0,
    release: () => releaseHold?.(),
    report: () => ({
      phase: state.phase,
      usableAt: state.usableAt,
      band: state.band,
      adoptError: state.adopted?.error ?? null,
      settleFrames: state.settleFrames,
      failed: state.failed,
    }),
    workshop: null,
  };
  (window as unknown as { __handoff: HandoffState }).__handoff = state;

  const warm = (p: number): void => {
    // never dims again (a late report, say a module the scene did not need, must not undo the last step)
    if (p < state.progress) return;
    state.progress = p;
    root.style.setProperty('--warm', warmth(p).toFixed(3));
  };
  const report = (phase: string, done: number, total = 1): void => warm(progress.report(phase, done, total));
  warm(0);

  const holdHere = (phase: HandoffState['phase']): Promise<void> => {
    state.phase = phase;
    if (!o.hold) return Promise.resolve();
    return new Promise((r) => {
      releaseHold = () => {
        releaseHold = null;
        r();
      };
    });
  };

  let ws: Workshop | null = null;
  try {
    for (const f of o.early ?? []) void f().catch(() => {});
    const opts = await o.prepare((f) => report('modules', f));
    report('modules', 1);
    measure('prepare', t0);

    // the band the browser chose (or none: the poster script's own mode)
    const entry = (): PosterEntry | null => (o.posters && o.img ? entryForUrl(o.posters, o.img.currentSrc, o.url) : null);
    const framing = opts.frameCamera;
    const adopt = (stage: Stage): void => {
      if (o.renderBand) {
        state.framed = bandView(stage, o.renderBand.narrowest);
        return;
      }
      state.framed = viewOf(stage);
      const e = entry();
      state.band = e ? { minAspect: e.minAspect, aspect: e.aspect } : null;
      // only an exact crop is adopted (a browser that took the fallback <img> for another band gets the cross-fade)
      const c = stage.renderer.domElement;
      const aspect = (c.clientWidth || 1) / (c.clientHeight || 1);
      if (e?.view && cropIsExact(e.aspect, aspect)) state.adopted = { view: e.view, error: adoptView(stage, e.view) };
      else state.adopted = null;
    };

    ws = await bootWorkshop(o.canvas, {
      ...opts,
      manual: true,
      onProgress: (phase, done, total) => {
        report(phase, done, total);
        // the scene is built and its programs compiled: only the first frame is left. The picture comes up to
        // full now (a compositor transition, it runs while that frame is drawn), so the swap need not wait for it
        if (phase === 'compile' && done >= total) {
          root.classList.add('warm-done');
          warm(1);
        }
      },
      frameCamera(stage: Stage, scene: SceneDesc) {
        (framing ?? defaultFraming)(stage, scene);
        // only the first framing adopts the picture: later ones (a resize after the swap) go home
        if (state.phase === 'loading' || state.phase === 'settling') adopt(stage);
      },
    });
    state.workshop = ws;

    // the picture's state, then frames until they are settled and short
    state.phase = 'settling';
    const ts = now();
    stepToPicture(ws, o.posters ?? o.renderBand ?? { step: 0, settle: 0 });
    let quiet = 0;
    let last = await frame();
    for (let i = 0; i < 60 && quiet < 2; i++) {
      // a resize meanwhile may have changed the band: adopt again
      if (o.posters && !o.renderBand) adopt(ws.stage);
      ws.advance(0);
      const t = await frame();
      quiet = t - last < 40 ? quiet + 1 : 0;
      last = t;
      state.settleFrames = i + 1;
      report('settle', Math.min(quiet, 2), 2);
    }
    measure('settle', ts);
    report('settle', 1);
    // the last step of the warm-up is quick (`warm-done`), and the picture must be fully warm before it is replaced
    root.classList.add('warm-done');
    warm(1);
    if (!reduced && root.closest('.warming')) await fullyWarm(root, warmTransitionMs(root) + 400);
    await holdHere('held-picture');

    // the swap
    state.phase = 'swapping';
    mark('swap');
    root.classList.add('live');
    const go = (): void => {
      ws!.loop.setManual(false);
      ws!.loop.start();
      state.usableAt = now();
    };
    // The loop starts with the cross-fade (the canvas takes input from its first moment): in 150 ms the
    // world moves a few pixels under a picture that is already fading. The proof (hold) keeps it still.
    if (!o.hold) go();
    if (fadeMs > 0) await wait(fadeMs + 20);
    root.closest('.warming')?.classList.remove('warming');
    await holdHere('held-stage');
    if (o.hold) go();
    state.phase = 'live';
    mark('usable');
    measure('to usable', 0);
    o.onLive?.(ws);
    return ws;
  } catch (e) {
    state.phase = 'failed';
    state.failed = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    root.closest('.warming')?.classList.remove('warming');
    root.classList.remove('live');
    root.classList.add('stage-failed');
    try {
      ws?.dispose();
    } catch {
      /* already broken */
    }
    console.error('stage failed to start; the picture stays', e);
    return null;
  } finally {
    await yieldToBrowser();
  }
}

/**
 * Until the picture's filter, as drawn, is the identity (the transition to
 * full warmth has really finished, whatever the load on the machine), or
 * `limit` ms.
 */
async function fullyWarm(root: HTMLElement, limit: number): Promise<void> {
  const img = root.querySelector('.poster');
  if (!img) return;
  const until = now() + limit;
  while (now() < until) {
    const f = getComputedStyle(img).filter;
    const nums = [...f.matchAll(/\(([\d.]+)\)/g)].map((m) => parseFloat(m[1]!));
    if (f === 'none' || nums.every((v) => Math.abs(v - 1) < 1e-3)) return;
    await frame();
  }
}

/** The longest transition on the picture (ms), so the swap waits for the last warm step to finish. */
function warmTransitionMs(root: HTMLElement): number {
  const img = root.querySelector('.poster');
  if (!img) return 0;
  const cs = getComputedStyle(img);
  const parse = (s: string): number[] => s.split(',').map((x) => (x.trim().endsWith('ms') ? parseFloat(x) : parseFloat(x) * 1000));
  const d = parse(cs.transitionDuration);
  const dl = parse(cs.transitionDelay);
  return Math.max(0, ...d.map((v, i) => (v || 0) + (dl[i] ?? dl[0] ?? 0))) + 30;
}
