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
import { bootWorkshop, type BootOptions, type BootStation, type Framings, type Inset, type Workshop } from './boot.ts';
import type { Stage, View } from '../view/stage/index.ts';
import { boxTarget, fitDistance } from '../view/stage/camera.ts';
import { loadStage, type HandoffState } from './loader.ts';
import type { PosterSet } from './poster.ts';
import { LOOK } from '../view/stage/index.ts';
import type { StageOptions } from '../view/stage/index.ts';
import type { Tier } from '../view/types.ts';
import type { PhysicsPort, Vec3 } from '../sim/index.ts';
import { bench as BENCH, OPENING_STAND_ON, withOpeningStand, withProjectRow, withStandIn } from '../sim/scenes/bench.ts';
import { loadBench, homeBox, homeEdge, FRAMING, type Bench } from '../view/bench.ts';

/** (P4 S5 round four) `?lookSize=1.6`: how close a look may come on a laptop, for one visit (the lead's comparison). */
const lookSizeQuery = (): number | null => {
  try {
    const q = Number(new URLSearchParams(globalThis.location?.search ?? '').get('lookSize'));
    return q > 0 ? q : null;
  } catch {
    return null;
  }
};

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

/**
 * The bench's stations as § C names them, each with the box its framing shows whole (P3 B2: judged in pictures at
 * 1440×900 and 390×844; § B6 "zooms between the whole bench and one station"). In the controls list's order:
 * the Button first (§ B3: the most obvious thing on the bench), then the centre, the front, the wall. A loose part
 * is framed with the station whose box holds it now (the belt's before the Button's: the crate stack is the belt's).
 */
export const STATION_BOXES = {
  /** The Button on its console (L2: in the back left corner, under the tool wall), Revert's hatch, the UNDO lever. */
  button: { min: [-8.7, 0, -2.6], max: [-1.6, 2.0, 1.3] },
  /** Patch at the board, the stool, the platen, the storefront, the phone. */
  patchlamp: { min: [-2.9, 0, -5.0], max: [8.9, 3.3, 2.2] },
  /** The belt from the chute to the dock: the stack, Fetch's lane, the striker. */
  line: { min: [-7.8, 0, 0.6], max: [7.4, 2.2, 5.0] },
  /** The sign and the lamp: TAYLOR REMUND on the wall, the lamp clamped beside it, its pool on the board. */
  top: { min: [-4.4, 0.9, -5.0], max: [6.0, 6.5, -3.4] },
  /** (P4 T2) The tool wall: the board, its eight tools and the pinned sheet, and the bench in front of it (where a tool is set down). */
  tools: { min: [-10.1, 0, -5.0], max: [-4.6, 6.1, -2.4] },
} as const satisfies Record<string, { min: readonly [number, number, number]; max: readonly [number, number, number] }>;
/**
 * A phone held upright: the camera never zooms out past its home (the centre cluster, about 5.6 units across),
 * so a station wider than that cannot be framed whole. Each is framed by the part of it that holds its controls;
 * a control outside that is brought into view when focus reaches it (`Framings.thing`).
 */
export const STATION_BOXES_PORTRAIT = {
  /** The Button on its console (L2: in the corner; the UNDO lever, 5 units to its right, is brought into view when focus reaches it). */
  button: { min: [-8.6, 0, -2.4], max: [-6.5, 1.8, -0.8] },
  /** The board, Patch on its stool, the phone (the platen and the storefront are off to the right). */
  patchlamp: { min: [-2.5, 0, -5.0], max: [3.3, 3.2, 2.1] },
  /** The middle of the belt: the stack, the striker, Fetch's lane. */
  line: { min: [-2.0, 0, 0.6], max: [3.8, 2.0, 5.0] },
  /** The sign's middle and the lamp. */
  top: { min: [-2.9, 1.5, -5.0], max: [2.9, 6.4, -3.4] },
  /** (P4 T2) The board's middle: its tools. */
  tools: { min: [-9.4, 0.4, -5.0], max: [-5.3, 5.9, -3.0] },
} as const satisfies Record<keyof typeof STATION_BOXES, { min: readonly [number, number, number]; max: readonly [number, number, number] }>;
export type BenchStation = keyof typeof STATION_BOXES;
export const BENCH_STATIONS = Object.keys(STATION_BOXES) as BenchStation[];
/** Which box a loose part is looked for in first (the boxes overlap; the wall's holds no loose part). */
const PART_ORDER: readonly BenchStation[] = ['line', 'button', 'patchlamp'];

/** The box of a station's framing, grown so what it frames lies in what the page leaves uncovered (`inset`). */
export function stationBox(st: BenchStation, portrait = false): Box3 {
  const s = (portrait ? STATION_BOXES_PORTRAIT : STATION_BOXES)[st];
  return new Box3(new Vector3(...s.min), new Vector3(...s.max));
}

/** Tune here: the least share of the view's width or height a framing keeps clear of what the page covers. */
const KEEP_MIN = 0.45;

/**
 * The view that frames `box` in the part of the canvas the page leaves uncovered (`inset`, CSS px): fitted to that
 * window (farther by the covered share), and slid so the box sits in its middle. The camera's own limits (it never
 * zooms out past home, nor pans past the bench) still hold when it eases there.
 */
export function framedView(stage: Stage, box: Box3, inset: Inset, width: number, height: number): View {
  const W = Math.max(1, width);
  const H = Math.max(1, height);
  const cam = stage.camera;
  const frac = (px: number, of: number): number => Math.min(0.6, Math.max(0, px / of));
  const l = frac(inset.left, W), r = frac(inset.right, W), t = frac(inset.top, H), b = frac(inset.bottom, H);
  const keep = Math.max(KEEP_MIN, Math.min(1 - l - r, 1 - t - b));
  const c = boxTarget(box, new Vector3());
  // (K2) the distance the camera will rest at: its zoom limits hold (never past home, never closer than a station),
  // and the slide below is measured at that distance, not at the one asked for
  const zoom = Math.min(1, Math.max(0, cam.zoomForDistance(fitDistance(box, c, cam.fov, W / H, cam.pitch, cam.margin) / keep)));
  const d = distanceForZoom(cam, zoom);
  const tall = 2 * d * Math.tan(((cam.fov / 2) * Math.PI) / 180);
  const wide = tall * (W / H);
  const p = (cam.pitch * Math.PI) / 180;
  // content goes right when the left is covered (the camera left), down when the top is (the camera up the screen: back)
  return { focus: [c.x - ((l - r) / 2) * wide, c.y, c.z - (((t - b) / 2) * tall) / Math.sin(p)], zoom };
}

/** The camera's distance at `zoom` (the inverse of `zoomForDistance`, which is linear in the distance's log). */
function distanceForZoom(cam: Pick<Stage['camera'], 'zoomForDistance'>, zoom: number): number {
  const at1 = cam.zoomForDistance(1);
  const perE = cam.zoomForDistance(Math.E) - at1;
  return Math.abs(perE) < 1e-9 ? 1 : Math.exp((zoom - at1) / perE);
}

export interface BenchGlue {
  /** Load the bench's pieces and station views (the loader's first phase). */
  prepare(): Promise<Bench>;
  /** The loaded bench (after `prepare`). */
  readonly bench: Bench;
  /** The boot options for the loaded bench (a tier may be given: a stage rebuilt at another tier). */
  bootOptions(tier?: Tier): BenchBootOptions;
  /** The shots: each station's (top, patchlamp, button, line), and fetch, patch, cord: the box each frames. */
  readonly shots: Record<BenchStation | 'fetch' | 'patch' | 'cord', () => Box3>;
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
    top: () => stationBox('top'),
    patchlamp: () => stationBox('patchlamp'),
    button: () => stationBox('button'),
    line: () => stationBox('line'),
    tools: () => stationBox('tools'),
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
      // (P4 S5, development only: `?standin=1` puts the kit's test block in t-components' crate, to prove a crate's tray)
      // (and `?crates=row`: the six project crates in a row behind the console, for pictures of all six at once)
      const dq = import.meta.env.DEV && typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
      const scene00 = dq?.get('crates') === 'row' ? withProjectRow(BENCH) : BENCH;
      // (P4 S6, a prototype: `?open=stand`, `?things=loose`; or the scene's OPENING_STAND_ON. L2: one place, the centre)
      const standOn = OPENING_STAND_ON || dq?.get('open') === 'stand';
      const scene0 = standOn ? withOpeningStand(scene00, 'centre', dq?.get('things') === 'loose' ? 'loose' : 'fixed') : scene00;
      bench = await loadBench({ scene: dq?.get('standin') === '1' ? withStandIn(scene0) : scene0, seed: o.seed, room: withRoom, ...(o.crewScale ? { crewScale: o.crewScale } : {}), ...(o.seat !== undefined ? { seat: o.seat } : {}) });
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
          // (P4 S5) only a look comes closer than a station (shell/boot.ts `lookAt`; the visitor's own zoom stops at a
          // station's): 1.7 across on a laptop (1.3 at first: too close, the bench was gone), 0.62 on an upright phone, so
          // an opened crate's card reads
          stage.camera.lookSize = portrait() ? 0.62 : lookSizeQuery() ?? 1.7;
          stage.camera.setSubject(homeBox(aspect), { edge, bounds: new Box3(new Vector3(...FRAMING.bounds.min), new Vector3(...FRAMING.bounds.max)) });
          stage.camera.focusOn({ x: FRAMING.focus[0], y: FRAMING.focus[1], z: FRAMING.focus[2] });
          Object.assign(LOOK.focus, FRAMING.blur);
          stage.camera.cutTo(stage.camera.home());
        },
        framings: framings(),
      };
    },
  };

  /** P3 B2: every station framed whole (shell/boot.ts `Framings`); the whole bench is the home framing. */
  function framings(): Framings {
    const v = new Vector3();
    const inBox = (st: BenchStation, p: Vec3): boolean => {
      const s = STATION_BOXES[st];
      return p[0] >= s.min[0] && p[0] <= s.max[0] && p[2] >= s.min[2] && p[2] <= s.max[2];
    };
    const ease = (stage: Stage, box: Box3, inset: Inset): View => {
      const to = framedView(stage, box, inset, canvas.clientWidth, canvas.clientHeight);
      stage.camera.easeTo(to);
      // the depth of field follows: what is framed is what is sharp
      const c = box.getCenter(v);
      stage.camera.focusOn({ x: c.x, y: Math.min(c.y, 1), z: c.z });
      return to;
    };
    return {
      stations: BENCH_STATIONS,
      of(id) {
        const w = loaded().world();
        if (!w) return null;
        // a loose part (a crate, Fetch): framed where it is now
        const m = w.motion(id);
        if (m && m.mode !== 'gone' && m.mode !== 'chute') {
          const hit = PART_ORDER.find((st) => inBox(st, m.pose.p));
          if (hit) return hit;
        }
        // the phone's pick target stands for the line (its station's)
        const st = w.interactable(id)?.station ?? (id === 'phone' ? w.interactable('line')?.station : undefined);
        return st && (BENCH_STATIONS as readonly string[]).includes(st) ? st : null;
      },
      show(st, stage, inset) {
        if (st === null || !(BENCH_STATIONS as readonly string[]).includes(st)) {
          const home = stage.camera.home();
          stage.camera.easeTo(home);
          stage.camera.focusOn({ x: FRAMING.focus[0], y: FRAMING.focus[1], z: FRAMING.focus[2] });
          return home;
        }
        return ease(stage, stationBox(st as BenchStation, portrait()), inset);
      },
      freeSide(st) {
        // a station right of the bench's middle (Patchlamp: the platen, the storefront) leaves the left free; the
        // camera cannot pan far enough to clear the right for it (its pan limits at a wide framing)
        if (st === null || !(BENCH_STATIONS as readonly string[]).includes(st)) return 'right';
        const s = STATION_BOXES[st as BenchStation];
        return (s.min[0] + s.max[0]) / 2 > 1.5 ? 'left' : 'right';
      },
    };
  }
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
