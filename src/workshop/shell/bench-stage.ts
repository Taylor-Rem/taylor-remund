/**
 * The bench on a page (P3 B1): what `/` and `/dev/bench/` both need to stand
 * the playable bench up behind its still picture, in one place.
 *
 *   - loading the bench (`view/bench.ts` `loadBench`) as the loader's first
 *     phase, and the room's fog (the room shows: at the stage's own fog depth
 *     everything below the bench top is erased and the bench floats);
 *   - the camera's framing (the wide box, the wider box from 16:9, the
 *     phone's cluster box on a screen held upright) and the four shots a
 *     double-click or a focused control eases to;
 *   - the boot options; and `startBench`: a direct boot (captures) or the
 *     picture-first load (shell/loader.ts), with the rebuild after a lost
 *     graphics context.
 *
 * A page adds its own on top: the dev page its review overlay, its measuring
 * hooks and the HUD; the home page the strip, Read, tiers and the restart.
 * Nothing here puts anything on `window`.
 *
 * The bench's framing lives in `view/bench.ts` (`FRAMING`, `homeBox`,
 * `homeEdge`); the loading pictures were rendered from exactly this framing
 * (`scripts/poster.ts`): change one and the pictures must be rendered again.
 */
import { Box3, Vector3 } from 'three';
import { bootWorkshop, type BootOptions, type BootStation, type Workshop } from './boot.ts';
import { loadStage, type HandoffState } from './loader.ts';
import type { PosterSet } from './poster.ts';
import { LOOK } from '../view/stage/index.ts';
import type { StageOptions } from '../view/stage/index.ts';
import type { Tier } from '../view/types.ts';
import type { PhysicsPort, Vec3 } from '../sim/index.ts';
import { bench as BENCH } from '../sim/scenes/bench.ts';
import { loadBench, homeBox, homeEdge, FRAMING, type Bench } from '../view/bench.ts';
import { staticBox } from '../view/vignette.ts';

export type BenchBootOptions = Omit<BootOptions, 'manual' | 'onProgress'>;

export interface BenchGlueOptions {
  canvas: HTMLCanvasElement;
  tier: Tier;
  reducedMotion: boolean;
  seed: number;
  physics: () => Promise<PhysicsPort>;
  /** The room round the bench (default true). */
  room?: boolean;
  /** Review only (the dev page's ?crew=, ?seat=). */
  crewScale?: number;
  seat?: number;
  /** Review only: straight down over the whole bench (the dev page's ?plan=1). */
  plan?: boolean;
  /** Force a framing (the dev page's ?view=); default: the phone's when the screen is held upright. */
  view?: 'phone' | 'wide' | null;
  /** Measurement switches (the dev page's ?preserve, ?timer, ?gpusync). */
  stage?: Pick<StageOptions, 'preserveDrawingBuffer' | 'gpuTimer' | 'syncGpu'>;
  /** More station views after the bench's (the dev page's event log and overlay). */
  extraStations?: readonly BootStation[];
}

/** The plan view's box (the dev page's ?plan=1). */
export const PLAN_BOX = new Box3(new Vector3(-9.8, 0, -5.6), new Vector3(9.8, 0.01, 5.4));

export interface BenchGlue {
  /** Load the bench's pieces and station views (the loader's first phase). */
  prepare(): Promise<Bench>;
  /** The loaded bench (after `prepare`). */
  readonly bench: Bench;
  /** The boot options for the loaded bench (a tier may be given: a stage rebuilt at another tier). */
  bootOptions(tier?: Tier): BenchBootOptions;
  /** The four shots (button, fetch, patch, cord): the box each frames. */
  readonly shots: Record<'button' | 'fetch' | 'patch' | 'cord', () => Box3>;
  /** Is the phone's framing in use? */
  portrait(): boolean;
}

export function benchGlue(o: BenchGlueOptions): BenchGlue {
  const withRoom = o.room ?? true;
  const plan = o.plan ?? false;
  // the room shows (ROOM brief: at the stage's 0.9 everything below the bench top is erased and the bench floats)
  if (withRoom) Object.assign(LOOK.fog, { drop: 5.5 });
  let bench: Bench | null = null;
  const loaded = (): Bench => {
    if (!bench) throw new Error('bench: not loaded yet (prepare first)');
    return bench;
  };
  const portrait = (): boolean => !plan && (o.view === 'phone' || (o.view !== 'wide' && innerWidth < innerHeight));
  const shots: BenchGlue['shots'] = {
    button: () => {
      const c = staticBox(loaded().scene, 'console')!.getCenter(new Vector3());
      return new Box3(new Vector3(c.x - 1.5, 0, c.z - 1.0), new Vector3(c.x + 1.6, 1.4, c.z + 1.4));
    },
    fetch: () => {
      const b = loaded();
      const m = b.world()?.motion('fetch');
      const p = m ? m.pose.p : ([b.scene.runner.lane.points[0]![0], 0.5, b.scene.runner.lane.points[0]![1]] as Vec3);
      return new Box3(new Vector3(p[0] - 1.2, 0, p[2] - 0.6), new Vector3(p[0] + 1.2, 1.5, p[2] + 0.7));
    },
    patch: () => {
      const s = loaded().fit.stool.seat;
      return new Box3(new Vector3(s[0] - 2.0, 0, s[2] - 1.0), new Vector3(s[0] + 0.9, 2.5, s[2] + 0.6));
    },
    cord: () => {
      const j = loaded().fit.board.jacks;
      return new Box3(new Vector3(j.storefront[0] - 1.6, 0, j.storefront[2] - 0.4), new Vector3(j.lamp[0] + 1.4, 2.2, j.storefront[2] + 1.8));
    },
  };
  const canvas = o.canvas;
  return {
    async prepare() {
      bench = await loadBench({ scene: BENCH, seed: o.seed, room: withRoom, ...(o.crewScale ? { crewScale: o.crewScale } : {}), ...(o.seat !== undefined ? { seat: o.seat } : {}) });
      return bench;
    },
    get bench() {
      return loaded();
    },
    shots,
    portrait,
    bootOptions(tier = o.tier) {
      const b = loaded();
      return {
        tier,
        reducedMotion: o.reducedMotion,
        seed: o.seed,
        physics: o.physics,
        scene: b.scene,
        // a page's last station views ride after the bench's (the boot's warm frames call onFrame before it has made
        // the workshop it passes, so a page's per-frame work rides as a station view, not on onFrame)
        stations: [...b.stations, ...(o.extraStations ?? [])],
        // measurement switches (scripts/perf.ts, H1): ?timer=1 GPU ms per pass, ?gpusync=1 wait for the GPU each frame
        stage: {
          preserveDrawingBuffer: o.stage?.preserveDrawingBuffer ?? false,
          gpuTimer: o.stage?.gpuTimer ?? false,
          syncGpu: o.stage?.syncGpu ?? false,
          camera: plan ? { fov: 1.2, pitch: 89.6, margin: 0.03 } : { ...FRAMING.lens },
        },
        frameCamera(stage, scene) {
          if (plan) {
            stage.camera.setSubject(PLAN_BOX, { bounds: PLAN_BOX });
            Object.assign(LOOK.focus, { max: 0 });
            stage.camera.cutTo(stage.camera.home());
            return;
          }
          const aspect = portrait() ? 0.5 : canvas.clientWidth / Math.max(1, canvas.clientHeight);
          const edge = homeEdge(aspect, scene.bench);
          stage.camera.stationSize = 1.9;
          stage.camera.setSubject(homeBox(aspect), { edge, bounds: new Box3(new Vector3(...FRAMING.bounds.min), new Vector3(...FRAMING.bounds.max)) });
          stage.camera.focusOn({ x: FRAMING.focus[0], y: FRAMING.focus[1], z: FRAMING.focus[2] });
          Object.assign(LOOK.focus, FRAMING.blur);
          stage.camera.cutTo(stage.camera.home());
        },
        onFrameRequest(id, stage) {
          const box = id === 'button' ? shots.button() : id === 'fetch' ? shots.fetch() : id === 'cord' || id?.startsWith('jack') ? shots.cord() : null;
          if (box) stage.camera.easeTo(stage.camera.frame(box));
          else stage.camera.easeTo(stage.camera.home());
        },
      };
    },
  };
}

/** What `window.__posters` holds (shell/StagePicture.astro). */
export interface PosterInfo {
  urls: Record<string, string>;
  manifest: PosterSet;
  ready: boolean;
}

export function posterInfo(): PosterInfo {
  return (window as unknown as { __posters: PosterInfo }).__posters;
}

export interface StartBenchOptions {
  glue: BenchGlue;
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  reducedMotion: boolean;
  /** Boot directly, without the picture (captures, the plan view). */
  direct?: boolean;
  /** With `direct`: nothing moves until `advance(n)`. */
  manual?: boolean;
  /** Hold before and after the swap (the poster script, the proof). */
  hold?: boolean;
  /** The poster script's mode: render this band. */
  band?: number | null;
  /** The stage was built again on the same world (after a lost graphics context, or a step down a tier). */
  onRebuilt?(ws: Workshop): void;
  /** The stage gave up (repeated faults, a context lost for good, or it could not start). */
  onGiveUp?(): void;
  /** P3 B3: the bench has stepped to its picture's state; its first live step is next (shell/loader.ts). */
  beforeLive?(ws: Workshop): void;
}

/**
 * Stand the bench up: directly (captures, the plan view), or behind its
 * picture (`loadStage`). Resolves with the workshop, or null if the stage
 * could not start (the picture stays).
 */
export async function startBench(o: StartBenchOptions): Promise<Workshop | null> {
  const { glue, root, canvas } = o;
  if (o.direct) {
    await glue.prepare();
    return bootWorkshop(canvas, { ...glue.bootOptions(), manual: o.manual ?? false, ...(o.onGiveUp ? { onGiveUp: o.onGiveUp } : {}) });
  }
  const info = posterInfo();
  const set = info.manifest;
  const band = o.band ?? null;
  return loadStage({
    root,
    canvas,
    img: root.querySelector('img.poster'),
    posters: band === null && info.ready ? set : null,
    url: (file) => info.urls[file] ?? '',
    reducedMotion: o.reducedMotion,
    hold: o.hold ?? false,
    ...(band !== null ? { renderBand: { narrowest: band === 0 ? set.narrowest : set.posters[band]!.minAspect, step: set.step, settle: set.settle } } : {}),
    async prepare(progress) {
      await glue.prepare();
      progress(1);
      return { ...glue.bootOptions(), ...(o.onGiveUp ? { onGiveUp: o.onGiveUp } : {}) };
    },
    ...(o.onRebuilt ? { onRebuilt: o.onRebuilt } : {}),
    ...(o.beforeLive ? { beforeLive: o.beforeLive } : {}),
  });
}

/** The loader's state (`window.__handoff`), once a picture-first load has started. */
export function handoff(): HandoffState | null {
  return (window as unknown as { __handoff?: HandoffState }).__handoff ?? null;
}
