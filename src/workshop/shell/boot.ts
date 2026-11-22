/**
 * The boot (REWRITE.md § E6, W2 brief § 4, B1): from a canvas to a running
 * workshop. In order:
 *
 *   1. the physics module starts loading AT ONCE: its wasm downloads and
 *      compiles off the main thread while the scene is built (§ E6 "the
 *      stage script and, in parallel, the physics file");
 *   2. the stage (renderer, light, camera, post) and picking; the label fonts;
 *   3. materials, the `ViewContext`, every station view the caller listed,
 *      yielding to the browser between views so the page keeps painting and
 *      answering (the dim picture brightening, the strip's links);
 *   4. the world, from the scene and the seed;
 *   5. input on the canvas → intents → `world.dispatch`; the camera
 *      gestures → the rig;
 *   6. the shaders compile without blocking (KHR_parallel_shader_compile)
 *      and one frame is drawn;
 *   7. the fixed-step loop: input, steps, frame, views, render.
 *
 * Every phase leaves a `b1:` performance mark or measure (scripts/loadtime.ts
 * prints them) and reports progress (`onProgress`), which the loader turns
 * into the picture's warmth.
 *
 * The shell knows no station: it takes the list (`check-layers`).
 */
import { Box3, Ray, Raycaster, Vector3, type Intersection, type Mesh, type Object3D } from 'three';
import { createStagePhone, type StagePhone } from '../ui/phone/stage.ts';
import { gloveCursors, POSE_OF, type GlovePose } from '../ui/cursor.ts';
import { createRapierPhysics, createWorld } from '../sim/index.ts';
import type { Id, Intent, PhysicsPort, SceneDesc, StepFault, Vec3, World, WorldSaved, WorldView } from '../sim/index.ts';
import type { Frame, StationView, Tier, ViewContext } from '../view/types.ts';
import { createStage, CameraRig, createLoop, type Loop, type Stage, type StageOptions, type View } from '../view/stage/index.ts';
import { createMaterials, type WorkshopMaterials } from '../view/materials/index.ts';
import { createLabels, type LabelsOptions, type WorkshopLabels } from '../view/labels/index.ts';
import { realize } from '../view/kit/realize.ts';
import { Picking, type PickableOptions } from '../view/picking.ts';
import { Gestures, type GestureTuning, type HeldKind, type PointerKind } from '../input/gesture.ts';
import { createSurface, type Surface } from '../input/surface.ts';
import { attachInput, type DomInput } from '../input/dom.ts';
import { createControls, type Controls } from '../input/controls.ts';
import type { CarryTuning, RayLike } from '../input/carry.ts';
import { Driver } from './frame.ts';
import { FaultGuard, GUARD_TUNING, strictMode, type FaultCounts } from './guard.ts';
import type { LatencyMeter } from './latency.ts';

/**
 * What the boot gives every station view: the `ViewContext` contract plus
 * the stage (a view may dip the lamp or pin the focus) and picking. Proposed
 * as additions to `view/types.ts` (see the W2 report).
 */
export interface BootViewContext extends ViewContext {
  readonly stage: Stage;
  readonly picking: Picking;
  /** A pick target, with its proxy box and padding when the view gives them (as `Picking.add`; proposed for `ViewContext`). */
  pickable(id: Id, object: Object3D, opts?: PickableOptions): void;
}

export type BootStation = (ctx: BootViewContext) => StationView;

/** What of the canvas the page covers (CSS px from each side: the strip, an open controls list); a framing keeps clear of it. */
export interface Inset {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/**
 * P3 B2 (REWRITE.md § B6 "zooms between the whole bench and one station", § E9 "focusing one frames it"): how a
 * page frames the stations of its scene (shell/bench-stage.ts for the bench). The boot keeps which station is
 * framed and when; the page says what a framing looks like.
 */
export interface Framings {
  /** The stations that have a framing. */
  readonly stations: readonly string[];
  /** The station `id` is framed with (an interactable's own; a loose part: where it is now), or null. */
  of(id: Id): string | null;
  /** Ease (under reduced motion: cut) to station `st`, or to the whole bench (null); returns the view it eases to. */
  show(st: string | null, stage: Stage, inset: Inset): View;
  /** The side of the screen a framing of `st` leaves freer (the page puts what it lays over the stage there). */
  freeSide(st: string | null): 'left' | 'right';
}

/**
 * Why a station was framed: `focus` (keyboard focus moved into it: the address is left alone), `select` (a
 * double-click or double-tap, Enter on its name in the controls list: the address follows), `address` (the
 * address named it), `back` (Esc, pinch-out to the whole bench, the browser's Back: the whole bench).
 */
export type FrameWhy = 'focus' | 'select' | 'address' | 'back';

/** The station framed now, and the way to frame one (Workshop.framing). */
export interface Framing {
  /** The station framed now, or null (the whole bench, or wherever the visitor has panned). */
  readonly station: string | null;
  /** Every station that can be framed (empty: the page has no framings). */
  readonly stations: readonly string[];
  /** The station `id` is framed with now (`Framings.of`), or null. */
  of(id: Id): string | null;
  /** The side of the screen a framing of `st` leaves freer (`Framings.freeSide`; right when there are none). */
  freeSide(st: string | null): 'left' | 'right';
  /** Frame station `st` (null: the whole bench). */
  frame(st: string | null, why: FrameWhy): void;
  /**
   * Keyboard focus moved to `id` (a control, or where the keys' held thing may go): its station is framed if it is
   * another one, and once the camera rests the thing lies in what the page leaves uncovered (§ E9).
   */
  bring(id: Id): void;
  /** Called on every framing, with its reason. */
  on(f: (st: string | null, why: FrameWhy) => void): () => void;
  /**
   * What of the canvas the page covers now (framings keep clear of it). Each thing laid over the stage says what IT
   * covers under its own name (`from`: the controls list `'list'`, a plate's panel `'panel'`; default `'page'`); the
   * clear area is the canvas less the widest of them on each side, so no writer undoes another's.
   */
  setInset(i: Partial<Inset>, from?: string): void;
  /** (P4 H1 round three) `id`'s box on the canvas now (CSS px), or null: read only. */
  screenRect(id: Id): { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number } | null;
  /**
   * (P4 H1 round three) Something laid over the stage is about `id`: bring it into the clear area by the least move
   * (a look in force re-settles there and stays a look). Returns how to give the picture back: `back()` eases to the
   * view from before (a cut under reduced motion) unless the visitor has moved the camera since. `prev`: what an
   * earlier reveal for the same covering returned (a panel's content swapped): the view to go back to stays its.
   */
  reveal(id: Id | null, prev?: Reveal | null): Reveal;
}

/** (P4 H1 round three) A reveal's way back (`Framing.reveal`). */
export interface Reveal {
  back(): void;
}

export interface BootOptions {
  /** Default: the vignette. */
  scene?: SceneDesc;
  stations: readonly BootStation[];
  tier: Tier;
  reducedMotion: boolean;
  seed: number | string;
  /** Default: Rapier, loaded after the first frame. */
  physics?: () => Promise<PhysicsPort>;
  stage?: Omit<StageOptions, 'tier' | 'reducedMotion'>;
  labels?: LabelsOptions;
  /** Start in manual mode (captures): nothing moves until `advance(n)` or `loop.setManual(false)`. */
  manual?: boolean;
  /** Fit the camera to the scene (called at start and on every resize). Default: the bench's box. */
  frameCamera?(stage: Stage, scene: SceneDesc): void;
  /** Every frame, after the views (overlays). */
  onFrame?(frame: Frame, workshop: Workshop): void;
  /** Every intent as it is dispatched (overlays, recordings). */
  onIntent?(intent: Intent, t: number): void;
  /** Hook: a double-click/double-tap asked to frame the station under the pointer (a page without `framings`). */
  onFrameRequest?(id: Id | null, stage: Stage): void;
  /**
   * P3 B2: the page's framings. With them a double-click, keyboard focus and Esc frame stations through
   * `Workshop.framing` (and `onFrameRequest` is not called); without, as before.
   */
  framings?: Framings;
  /** The interactable U presses (the lever, when it arrives). */
  undoId?: Id | null;
  gestures?: Partial<GestureTuning>;
  carry?: Partial<CarryTuning>;
  /** Hit-area minimum on screen, CSS px: mouse and touch (§ E9: at least 44 on touch). */
  hitPx?: { mouse: number; touch: number };
  /** Progress: `done` of `total` units of the named phase are finished (the loader's warmth). */
  onProgress?(phase: BootPhase, done: number, total: number): void;
  /** Yield to the browser between station views (default true). */
  yieldBetweenViews?: boolean;
  /**
   * The phone (§ D 3): a press on the in-world phone, or Enter on it, opens the texting panel over the
   * stage (ui/phone/stage.ts, on the world's line). `target` is the pick target the phone's view
   * registers (default `phone`); `parent` where the panel lives (default `document.body`). Made when the
   * world has a phone line (`line`) and there is a document; `false`: no phone.
   */
  phone?: false | { target?: Id; parent?: HTMLElement; line?: Id };
  /**
   * R2: strict (every error thrown, as before) or lenient (shell/guard.ts: the bench carries on). Default:
   * strict in development, under automation and with `?strict=1`; lenient on the production page or with
   * `?strict=0`.
   */
  strict?: boolean;
  /** R2: the end of the line (lenient only): the bench could not be kept going; the caller shows the picture. */
  onGiveUp?(): void;
  /**
   * R2: build the stage and the views on this world instead of a new one (a stage rebuilt after a lost
   * graphics context: the visitor's bench survives). The workshop does not dispose it.
   */
  world?: World;
  /**
   * P3 B3: what the last visit remembered (`World.saved()` then, read back through `parseSaved`): the world is
   * made from it. Ignored when `world` is given.
   */
  saved?: WorldSaved;
  /**
   * R2: the graphics context was lost (the GPU reset or was taken away). The workshop has stopped (no step,
   * no drawing; the world's state kept). The caller shows the picture and rebuilds on `webglcontextrestored`.
   */
  onContextLost?(): void;
}

export type BootPhase = 'stage' | 'labels' | 'views' | 'physics' | 'world' | 'compile' | 'frame';

/** A `b1:` performance mark (scripts/loadtime.ts reads them), when the platform has marks. */
export function mark(name: string): void {
  if (typeof performance !== 'undefined' && typeof performance.mark === 'function') performance.mark(`b1:${name}`);
}

/** A `b1:` performance measure from `start` (performance.now() ms) to now. */
export function measure(name: string, start: number): void {
  if (typeof performance === 'undefined' || typeof performance.measure !== 'function') return;
  try {
    performance.measure(`b1:${name}`, { start, end: performance.now() });
  } catch {
    /* no options form of measure: no measure */
  }
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : 0);

/**
 * Tune here (P4 S5 round two): a thing that asks to be looked at (the world's `look` event: a project crate just opened)
 * is brought close enough to read: its box at least `minPx` CSS px across (or as close as the camera goes, or as large
 * as the clear area allows, `fill` of its smaller side). The least move that does it (`lookAt`). A double-click or
 * double-tap first asks the world whether a thing answers it (`select`); the station is framed as soon as the world has
 * stepped once since without asking for a look (one frame), or `selectWait` ms later if it has not stepped (paused).
 */
export const LOOK_AT = { minPx: 560, fill: 0.9, zoomStep: 0.03, tries: 80, selectWait: 140 } as const;

/** Tune here (K2): keeping what has focus in what the page leaves uncovered (`Framing.bring`). */
export const KEEP_CLEAR = {
  /** CSS px the focused thing's box keeps inside the clear area (the mark stands about this far outside the box). */
  pad: 12,
  /** Slides tried at one zoom; then how far the view is drawn in or out (zoom, 0..1), and how many times. */
  slides: 3,
  zoomStep: 0.04,
  tries: 26,
  /** A mouth as a destination: the half-width of the spot over its drop point (world units). */
  drop: 0.45,
} as const;

/**
 * Give the browser a turn: paint, answer input, run a CSS transition.
 * `scheduler.yield()` where there is one (the continuation keeps its
 * priority), else a macrotask. Never an animation frame: those stop in a
 * hidden tab and the load would stall.
 */
export function yieldToBrowser(): Promise<void> {
  const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (typeof s?.yield === 'function') return s.yield();
  return new Promise((r) => setTimeout(r, 0));
}

export interface Workshop {
  /** The world, read-only. */
  readonly world: WorldView;
  /** R2: the world itself (a stage rebuilt after a lost graphics context is built on it). */
  readonly simWorld: World;
  /** R2: keep the world when this workshop is disposed (it is handed to a stage rebuilt on it); returns it. */
  disown(): World;
  readonly stage: Stage;
  readonly loop: Loop;
  readonly picking: Picking;
  readonly gestures: Gestures;
  readonly surface: Surface;
  readonly controls: Controls;
  readonly driver: Driver;
  readonly latency: LatencyMeter;
  readonly materials: WorkshopMaterials;
  readonly labels: WorkshopLabels;
  readonly views: readonly StationView[];
  /** The texting panel over the stage (null: no phone line, or no document). */
  readonly phone: StagePhone | null;
  /** Keyboard focus on the stage (an interactable, or the phone's target), or null. The view should mark it. */
  readonly focused: Id | null;
  /** P3 B2: the input on the canvas; the page's controls list drives the same recogniser through it. */
  readonly input: DomInput;
  /** P3 B2: which station is framed, and the way to frame one. */
  readonly framing: Framing;
  /** P3 B2: every drawn frame, after the views (the controls list, its live region); returns the way to stop. */
  onFrame(f: (frame: Frame) => void): () => void;
  /** Deterministic: run n steps and render one frame (manual mode for captures). */
  advance(n: number): void;
  /** R2: faults caught by the guard (lenient mode): how many, how many resets, the last report. Zero in a clean session. */
  faults(): FaultCounts;
  /** Dispatch an intent as if input had (tests, the controls list). */
  dispatch(intent: Intent, t?: number): void;
  dispose(): void;
}

export async function bootWorkshop(canvas: HTMLCanvasElement, opts: BootOptions): Promise<Workshop> {
  const progress = opts.onProgress ?? ((): void => {});
  const yieldBetween = opts.yieldBetweenViews ?? true;
  const t0 = now();
  mark('boot');

  // 1. physics at once (none to make when the world is given: R2, a rebuild after a lost context)
  const physicsReady = (opts.world ? async (): Promise<PhysicsPort | null> => null : (opts.physics ?? createRapierPhysics))().then((p) => {
    mark('physics-ready');
    progress('physics', 1, 1);
    return p;
  });
  // handled where it is awaited; this keeps an early rejection from being reported as unhandled meanwhile
  physicsReady.catch(() => {});

  // 2. the stage, the fonts
  const stage = createStage(canvas, { ...opts.stage, tier: opts.tier, reducedMotion: opts.reducedMotion });
  const picking = new Picking();
  // an empty frame: the post chain's programs start compiling now, not on the first real frame
  stage.render();
  measure('stage', t0);
  progress('stage', 1, 1);
  const tl = now();
  // start-up labels are painted in workers while the views are built (T1); awaited below
  const labels = await createLabels({ anisotropy: stage.renderer.capabilities.getMaxAnisotropy(), workers: true, renderer: stage.renderer, ...opts.labels });
  const materials = createMaterials({ tier: opts.tier, labels });
  measure('labels+materials', tl);
  progress('labels', 1, 1);

  // 3. the views
  const ctx: BootViewContext = {
    scene: stage.scene,
    materials,
    labels,
    tier: opts.tier,
    reducedMotion: opts.reducedMotion,
    realize: (piece, o) => realize(piece, materials, o),
    pickable: (id, object, o) => picking.add(id, object, o),
    targetBox: (id, out) => focusBox(id, out),
    targetObject: (id) => picking.objectOf(id),
    pickOver: (id, over) => picking.prefer(id, over),
    stage,
    picking,
  };
  const views: StationView[] = [];
  const n = opts.stations.length;
  for (let i = 0; i < n; i++) {
    if (yieldBetween) await yieldToBrowser();
    const tv = now();
    const view = opts.stations[i]!(ctx);
    views.push(view);
    measure(`view ${i} ${view.root.name || opts.stations[i]!.name || 'station'}`, tv);
    // hand this view's new materials to the driver now: they compile in parallel while the next views are built
    startCompile(stage);
    progress('views', i + 1, n);
  }

  // 4. the world
  const tlw = now();
  await labels.ready();
  measure('labels wait', tlw);
  const tp = now();
  const physics = await physicsReady;
  measure('physics wait', tp);
  const tw = now();
  // R2: the guard (strict in development and tests; lenient on the production page)
  const strict =
    opts.strict ??
    strictMode({
      dev: !!(import.meta as { env?: { DEV?: boolean } }).env?.DEV,
      search: typeof location !== 'undefined' ? location.search : '',
      webdriver: typeof navigator !== 'undefined' && !!navigator.webdriver,
    });
  const worldRef: { w: World | null } = { w: null };
  /** R2: the graphics context is lost: this workshop is stopped for good (a rebuild makes a new one). */
  let contextGone = false;
  const guard = new FaultGuard({
    strict,
    step: () => worldRef.w?.step ?? -1,
    recover: () => worldRef.w?.recover(),
    rebuild: () => giveUpOrRebuild(),
  });
  let ownsWorld = !opts.world;
  const world: World =
    opts.world ??
    createWorld({
      seed: opts.seed,
      physics: physics as PhysicsPort,
      ...(opts.scene ? { scene: opts.scene } : {}),
      ...(opts.saved ? { saved: opts.saved } : {}),
    });
  world.setOnFault(strict ? null : (f: StepFault) => guard.stepFault(f));
  worldRef.w = world;
  /** Three resets in a minute: a cold start of the page once (a rebuild from scratch); again within a minute, the picture. */
  function giveUpOrRebuild(): void {
    const KEY = 'workshop.rebuiltAt';
    try {
      const last = Number(sessionStorage.getItem(KEY) ?? 0);
      if (Date.now() - last > GUARD_TUNING.RESETS_WINDOW_MS) {
        sessionStorage.setItem(KEY, String(Date.now()));
        location.reload();
        return;
      }
    } catch {
      /* no storage: straight to the picture */
    }
    try {
      loopRef.l?.stop();
    } catch {
      /* stopping is best effort */
    }
    opts.onGiveUp?.();
  }
  const loopRef: { l: Loop | null } = { l: null };
  const scene = world.scene;
  const frameCamera = opts.frameCamera ?? defaultFraming;
  frameCamera(stage, scene);
  const onResize = (): void => frameCamera(stage, scene);
  addEventListener('resize', onResize);
  measure('world', tw);
  progress('world', 1, 1);

  // 5. input
  const hitPx = opts.hitPx ?? { mouse: 14, touch: 44 };
  const ray3 = new Ray();
  const ndc = { x: 0, y: 0 };
  const toRay = (x: number, y: number): RayLike => {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    ndc.x = (x / w) * 2 - 1;
    ndc.y = -(y / h) * 2 + 1;
    const r = stage.camera.screenToRay(ndc, ray3);
    return { origin: [r.origin.x, r.origin.y, r.origin.z], dir: [r.direction.x, r.direction.y, r.direction.z] };
  };
  const pickRay = new Ray();
  // the phone: its pick target opens the panel (made below, once the dispatch exists)
  const phoneOpt = opts.phone === false ? null : (opts.phone ?? {});
  const hasPhone = phoneOpt !== null && typeof document !== 'undefined' && world.machine('line')?.kind === 'line';
  const phoneTarget = phoneOpt?.target ?? 'phone';
  /** The phone line the in-world phone stands for: a press on the phone is a press on it (it declares `open`). */
  const lineId = phoneOpt?.line ?? 'line';
  const lineSet: ReadonlySet<Id> = new Set([lineId]);
  const panelIds: ReadonlySet<Id> = new Set(hasPhone ? [phoneTarget] : []);
  const noIds: ReadonlySet<Id> = new Set();
  const mouthIds: ReadonlySet<Id> = new Set((scene.mouths ?? []).map((m) => m.id));
  const jackIds: ReadonlySet<Id> = new Set(scene.cord.jacks.map((j) => j.id));
  /** What a hand can use now: a jack only matters while the plug is in the hand (else it would steal the plug's own area). */
  const usable = (id: Id): boolean => {
    if (panelIds.has(id)) return true;
    if (jackIds.has(id) || (world.interactable(id)?.affordances.length ?? 0) === 0) return false;
    // a part down a chute or gone (Revert in its hatch, a shipped crate) is not there to take
    const mode = world.mode(id);
    return mode !== 'gone' && mode !== 'chute';
  };
  /** While something is held, where it may go is pickable too: mouths for a part or a unit, every jack for the plug (a capped one refuses). */
  const pickFilter = (holding: HeldKind | null): ((id: Id) => boolean) => {
    if (holding === 'plug') return (id) => usable(id) || jackIds.has(id);
    if (holding) return (id) => usable(id) || mouthIds.has(id);
    return usable;
  };
  const upp = new Vector3();
  const filters = { none: pickFilter(null), part: pickFilter('part'), unit: pickFilter('unit'), plug: pickFilter('plug') };
  const box3 = new Box3();
  const box3b = new Box3();
  const raycaster = new Raycaster();
  const skipped = new Set<Id>();
  const drawnHits: Intersection[] = [];
  /** Does the pick ray miss every visible mesh drawn under `id`'s pick object? False when it has none to test. */
  const missesDrawn = (id: Id): boolean => {
    const o = picking.objectOf(id);
    if (!o) return false;
    let meshes = 0;
    o.traverse((c) => {
      if ((c as Mesh).isMesh) meshes++;
    });
    if (meshes === 0) return false;
    raycaster.ray.copy(pickRay);
    drawnHits.length = 0;
    raycaster.intersectObject(o, true, drawnHits);
    return !drawnHits.some((h) => isShown(h.object));
  };
  const corner = new Vector3();
  /**
   * K2: what a keyboard focus stands for on the stage (the mark round it, the framing that keeps it in view): its pick
   * box; a mouth (where the keys' held part may go) has none of its own worth framing (the belt's runs the bench's
   * length; the dock and the platen have none), so it stands for the spot over its drop point where the part goes.
   */
  const focusBox = (id: Id, out: Box3): Box3 | null => {
    const mouth = (world.scene.mouths ?? []).find((m) => m.id === id);
    if (!mouth) return picking.worldBox(id, out);
    const [x, y, z] = mouth.drop;
    const r = KEEP_CLEAR.drop;
    return out.set(corner.set(x - r, y, z - r), upp.set(x + r, y + 2 * r, z + r));
  };
  /** A pick target's proxy on screen (CSS px): centre and half of its larger side. */
  const screenOf = (id: Id): { x: number; y: number; r: number } | null => {
    const b = picking.worldBox(id, box3);
    if (!b) return null;
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z);
      const s = stage.camera.worldToScreen(corner);
      const sx = ((s.x + 1) / 2) * w;
      const sy = ((1 - s.y) / 2) * h;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, r: Math.max(x1 - x0, y1 - y0) / 2 };
  };
const pickAt = (r: RayLike, kind: PointerKind, exclude: Id | null, holding: HeldKind | null = null): { id: Id; point: Vec3 } | null => {
    pickRay.origin.set(r.origin[0], r.origin[1], r.origin[2]);
    pickRay.direction.set(r.dir[0], r.dir[1], r.dir[2]);
    const minPx = kind === 'mouse' ? hitPx.mouse : hitPx.touch;
    const filter = filters[holding ?? 'none'];
    const hit = picking.pick(pickRay, { exclude, minPx, filter });
    if (!hit) return null;
    const first = { id: hit.id, point: [hit.point.x, hit.point.y, hit.point.z] as Vec3 };
    if (hit.grown) return first;
    // a small thing inside a big thing's proxy wins (the plug under the lamp's arm, the phone by the Button's console):
    // the next true hit along the ray, if it lies within the first's box and is much smaller
    // a box is coarser than what it stands for: when the ray passes through a robot's box but misses the robot
    // itself (beside its arm, over its head) and something behind is truly under the point, that is what the
    // visitor sees and presses (the phone beside Fetch rolling past). Tested against the drawn meshes, only
    // when two proxies overlap on the ray.
    // (up to three deep: Fetch carrying a crate, both in front of the phone)
    skipped.clear();
    let front: { id: Id; point: Vec3 } = first;
    for (let depth = 0; depth < 3; depth++) {
      skipped.add(front.id);
      const behind = picking.pick(pickRay, { exclude, filter: (id) => !skipped.has(id) && filter(id) });
      // (round three) never back to a target the front one wins over (a thing on its crate's tray: `prefer`)
      if (!behind || behind.grown || picking.wins(front.id, behind.id) || !missesDrawn(front.id)) break;
      front = { id: behind.id, point: [behind.point.x, behind.point.y, behind.point.z] };
    }
    if (front !== first) return front;
    const big = picking.worldBox(first.id, box3);
    if (!big) return first;
    const bigSize = big.getSize(corner).length();
    const inner = picking.pick(pickRay, { exclude, minPx, filter: (id) => id !== first.id && filter(id) });
    if (!inner) return first;
    const innerId = inner.id;
    const innerPoint: Vec3 = [inner.point.x, inner.point.y, inner.point.z];
    const small = picking.worldBox(innerId, box3b);
    if (!small || !big.containsPoint(small.getCenter(corner)) || small.getSize(corner).length() > bigSize * 0.4) return first;
    return { id: innerId, point: innerPoint };
};
  /** Up in the air: a loose body flying (free and awake, above the bench), or Patch in flight. */
  const inTheAir = (id: Id): boolean => {
    const m = world.motion(id);
    if (m) return m.mode === 'free' && m.awake && m.pose.p[1] > world.scene.bench.top + 0.6;
    const v = world.crewView(id) as { view?: { state?: string } } | undefined;
    return v?.view?.state === 'fly';
  };
  const fwd = new Vector3();
  const surface = createSurface({
    world: () => world,
    ray: toRay,
    pick(r, kind: PointerKind, exclude, holding = null) {
      const chosen = pickAt(r, kind, exclude, holding);
      // a thing in the air is taken when it is in front of what was picked along the ray (a juggled crate before the
      // lamp's shade, Patch flying past the switchboard): pressed on as it passes, it is what the hand meant
      const filter = filters[holding ?? 'none'];
      const air = picking.pick(pickRay, { exclude, minPx: kind === 'mouse' ? hitPx.mouse : hitPx.touch, filter: (id) => filter(id) && inTheAir(id) });
      if (!air || air.id === chosen?.id) return chosen;
      const behind = chosen ? Math.hypot(chosen.point[0] - r.origin[0], chosen.point[1] - r.origin[1], chosen.point[2] - r.origin[2]) : Infinity;
      return air.distance < behind ? { id: air.id, point: [air.point.x, air.point.y, air.point.z] } : chosen;
    },
    half(id) {
      const b = picking.localBox(id);
      if (!b) return null;
      return [(b.max.x - b.min.x) / 2, (b.max.y - b.min.y) / 2, (b.max.z - b.min.z) / 2];
    },
    centre(id) {
      const b = picking.worldBox(id, box3);
      if (!b) return null;
      const c = b.getCenter(corner);
      return [c.x, c.y, c.z];
    },
    screen: screenOf,
    unitsPerPx: (p) => picking.unitsPerPixel(upp.set(p[0], p[1], p[2])),
    project(p) {
      const s = stage.camera.worldToScreen(upp.set(p[0], p[1], p[2]));
      if (s.z > 1) return null;
      return [((s.x + 1) / 2) * (canvas.clientWidth || 1), ((1 - s.y) / 2) * (canvas.clientHeight || 1)];
    },
    forward: () => {
      const d = stage.camera.camera.getWorldDirection(fwd);
      return [d.x, d.y, d.z];
    },
    panels: () => panelIds,
    hidden: () => (hasPhone ? lineSet : noIds),
    panelStation: (id) => (panelIds.has(id) ? (world.interactable(lineId)?.station ?? null) : null),
    ...(opts.carry ? { carry: opts.carry } : {}),
  });
  const gestures = new Gestures(surface, opts.gestures);

  let dispatchedSinceStep = false;
  const driverRef: { d: Driver | null } = { d: null };
  const dispatch = (intent: Intent, t: number = performance.now()): void => {
    if (contextGone) return; // R2: no input queues up behind a lost graphics context
    world.dispatch(intent);
    dispatchedSinceStep = true;
    guard.noteIntent(intent);
    guard.run('input', () => {
      driverRef.d?.latency.dispatched(intent, t);
      opts.onIntent?.(intent, t);
    });
  };

  const v3 = new Vector3();
  const v3b = new Vector3();
  const ndcOf = (p: readonly [number, number]): { x: number; y: number } => CameraRig.ndc(p[0], p[1], canvas.clientWidth || 1, canvas.clientHeight || 1);
  const camera = {
    pan(dx: number, dz: number) {
      following = null;
      const step = stage.camera.distance * 0.06;
      stage.camera.panBy(dx * step, dz * step);
    },
    zoom(f: number) {
      following = null;
      stage.camera.zoomBy(f);
    },
    back() {
      if (framings) framing.frame(null, 'back');
      else stage.camera.easeTo(stage.camera.home());
    },
    frame(id: Id) {
      if (framings) framing.frame(framings.of(id), 'select');
      else opts.onFrameRequest?.(id, stage);
    },
  };
  const controls = createControls({ world: () => world, dispatch, camera, undoId: opts.undoId ?? world.undoId ?? null });

  // the phone's panel: HTML over the stage, on the world's line
  const phone: StagePhone | null = hasPhone
    ? createStagePhone({ world, dispatch: (i) => dispatch(i), canvas, ...(phoneOpt?.parent ? { parent: phoneOpt.parent } : {}), reducedMotion: () => world.reducedMotion })
    : null;
  /** Input's intents, with the page's own handles taken out: a press on the phone opens its panel. */
  const fromInput = (intent: Intent, t: number): void => {
    if (intent.type === 'press' && panelIds.has(intent.id)) {
      if (phone && !phone.isOpen) {
        // (P3 B2) focus returns to what opened it: the canvas, or the controls list's Phone button
        const by = typeof document !== 'undefined' ? document.activeElement : null;
        phone.open(by instanceof HTMLElement && by !== document.body ? by : canvas);
        // the line hears it: picking the phone up is the visitor's doing (it ends attract mode, § B3)
        if (world.interactable(lineId)) dispatch({ type: 'press', id: lineId }, t);
      }
      return;
    }
    dispatch(intent, t);
  };
  let inset: Inset = { top: 0, right: 0, bottom: 0, left: 0 };
  /** (P4 H1 round three) What each covering says it covers (`Framing.setInset`'s `from`); `inset` is their widest. */
  const insets = new Map<string, Partial<Inset>>();
  /** (P4 H1 round three) A reveal's record: the view to go back to, the view it moved to, and how (a look or not). */
  interface RevealImpl extends Reveal {
    before: View | null;
    to: View | null;
    close: boolean;
    look: Box3 | null;
    moved(): boolean;
  }
  const onScreen = (id: Id): boolean => {
    const s = screenOf(id);
    if (!s) return true;
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    // (inside what the page leaves uncovered: the strip, an open controls list)
    const x0 = inset.left + (w - inset.left - inset.right) * 0.06;
    const x1 = w - inset.right - (w - inset.left - inset.right) * 0.06;
    const y0 = inset.top + (h - inset.top - inset.bottom) * 0.06;
    const y1 = h - inset.bottom - (h - inset.top - inset.bottom) * 0.06;
    return s.x > x0 && s.x < x1 && s.y > y0 && s.y < y1;
  };
  // ── K2: what has focus rests in what the page leaves uncovered (§ E9 "focus is always visible") ──
  //
  // The rule. Focus moving to a thing (a control in the list, the canvas's own Tab, a destination while the keys
  // hold something) frames its station when it is another station's; then, with the camera where it will come to
  // rest, the thing's box must lie inside the canvas less what the page covers (the strip, an open list, the legal
  // line), `KEEP_CLEAR.pad` px in (the mark stands just outside the box). When it would not (a phone frames a wide
  // station by its middle; a list panel covers one end of the bench; a crate has gone down the belt), the camera
  // makes the least move that puts it there (`settle`): a slide at the station's own scale, drawn in only as far as
  // the camera's limits make it. Inside a station, a thing already comfortably in view leaves the camera still: no
  // lurch on every Tab. Focus moving on while the camera is still easing is judged when it comes to rest.
  /** Where the focused thing must be: the canvas less what the page covers, `pad` CSS px further in. */
  const clearOf = (pad: number): { x0: number; y0: number; x1: number; y1: number } => {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    return { x0: inset.left + pad, y0: inset.top + pad, x1: w - inset.right - pad, y1: h - inset.bottom - pad };
  };
  const rectBox = new Box3();
  /** `id`'s focus box on screen with the camera as it is now (CSS px of the canvas), or null. */
  const rectOf = (id: Id): { x0: number; y0: number; x1: number; y1: number } | null => {
    const b = focusBox(id, rectBox);
    if (!b) return null;
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z);
      const s = stage.camera.worldToScreen(corner);
      const sx = ((s.x + 1) / 2) * w;
      const sy = ((1 - s.y) / 2) * h;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    return { x0, y0, x1, y1 };
  };
  /** Is `id` inside what the page leaves uncovered, `pad` px in, with the camera as it is now? */
  const clear = (id: Id, pad: number): boolean => {
    const r = rectOf(id);
    if (!r) return true;
    const c = clearOf(pad);
    return r.x0 >= c.x0 && r.x1 <= c.x1 && r.y0 >= c.y0 && r.y1 <= c.y1;
  };
  /**
   * The camera put at `v` (its own limits applied, as when it rests there), `f` asked, the camera put back. `close`: as
   * a look would rest there (it may come closer than a station).
   */
  const atView = <T>(v: View, f: () => T, close = false): T => {
    const cam = stage.camera;
    const was = cam.view();
    const wasClose = cam.reach > 1;
    const look = cam.look;
    cam.cutTo(v, { close });
    const out = f();
    cam.cutTo(was, { close: wasClose, look });
    return out;
  };
  /** The view the last framing eases to (null: none since the visitor last moved the camera). */
  let resting: View | null = null;
  /**
   * The thing with keyboard focus that the camera keeps in the clear area: judged whenever the camera is at rest, so
   * a focus that moved on while it eased, and a crate the crew or the belt carry off afterwards, are both brought
   * back. Null: nothing focused, or the visitor has moved the camera since (it is theirs until focus next moves).
   */
  let following: Id | null = null;
  /**
   * The least move from `base` that brings `id` into the clear area at rest. A slide at the same zoom first, the
   * thing put in the middle of the area as far as the camera's limits let it go (it never pans past the bench's
   * ends, and the further out it is the less it can pan at all). Where the limits hold the slide short, the view
   * is drawn in a step at a time until the slide reaches (a list panel over one end of the bench at a laptop's
   * width); where the thing is too big for the area, it is drawn out. So the camera keeps the station's own scale
   * whenever it can: the thing with the bench round it, never a close-up for its own sake. Returns the view as
   * the camera will rest there, or null where no view it can take shows the thing in the area.
   */
  const settle = (id: Id, base: View, close = false): View | null => {
    const cam = stage.camera;
    const p = (cam.pitch * Math.PI) / 180;
    const c = clearOf(KEEP_CLEAR.pad);
    let v = base;
    let rest = base;
    for (let i = 0; i < KEEP_CLEAR.tries; i++) {
      let big = false;
      for (let k = 0; ; k++) {
        const r = atView(v, () => ({ rect: rectOf(id), rest: cam.view(), d: cam.distance }), close);
        rest = r.rest;
        const { rect } = r;
        if (!rect || (rect.x0 >= c.x0 && rect.x1 <= c.x1 && rect.y0 >= c.y0 && rect.y1 <= c.y1)) return rest;
        big = rect.x1 - rect.x0 > c.x1 - c.x0 || rect.y1 - rect.y0 > c.y1 - c.y0;
        // a slide is repeated: perspective leaves the first a little short, and the limits may hold it
        if (big || k >= KEEP_CLEAR.slides) break;
        const u = (2 * r.d * Math.tan((cam.fov * Math.PI) / 360)) / Math.max(1, canvas.clientHeight || 1);
        const dx = (c.x0 + c.x1) / 2 - (rect.x0 + rect.x1) / 2;
        const dy = (c.y0 + c.y1) / 2 - (rect.y0 + rect.y1) / 2;
        // content right by dx: the camera left; content down by dy: the camera up the screen (up and back: the pan
        // range binds along the bench sooner than the focus's height does)
        const f = rest.focus;
        v = { focus: [f[0] - dx * u, f[1] + dy * u * Math.cos(p), f[2] - dy * u * Math.sin(p)], zoom: rest.zoom };
      }
      const zoom = Math.min(close ? Math.max(1, base.zoom) : 1, Math.max(0, rest.zoom + (big ? -KEEP_CLEAR.zoomStep : KEEP_CLEAR.zoomStep)));
      if (Math.abs(zoom - rest.zoom) < 1e-6) break;
      // the focus asked for is kept (not where the limits held it): drawn in, the camera may go further
      v = { focus: v.focus, zoom };
    }
    return null;
  };
  /**
   * Ease to where `id` is in the clear area, from `base` (its station's framing at rest, or the view now); where no
   * view the camera can take shows it there (a crate on its way down the chute), the camera stays. The station
   * stays framed: the address and the list's side are the station's. What is sharp follows the thing.
   */
  const showThing = (id: Id, box: Box3, base: View): void => {
    const v = settle(id, base);
    if (!v) return;
    resting = v;
    stage.camera.easeTo(v);
    const m = box.getCenter(v3);
    stage.camera.focusOn({ x: m.x, y: Math.min(m.y, 1), z: m.z });
  };
  // P3 B2: the station framed now; the page's framings say what each looks like (shell/bench-stage.ts)
  const framings = opts.framings ?? null;
  const framed: { station: string | null } = { station: null };
  const framingListeners = new Set<(st: string | null, why: FrameWhy) => void>();
  const framing: Framing = {
    get station() {
      return framed.station;
    },
    stations: framings?.stations ?? [],
    of: (id) => framings?.of(id) ?? null,
    freeSide: (st) => framings?.freeSide(st) ?? 'right',
    frame(st, why) {
      following = null;
      if (!framings) {
        if (st === null) stage.camera.easeTo(stage.camera.home());
        return;
      }
      const known = st !== null && framings.stations.includes(st) ? st : null;
      framed.station = known;
      resting = framings.show(known, stage, inset);
      for (const f of framingListeners) guard.run('ui:framing', () => f(known, why));
    },
    bring(id) {
      if (!framings) {
        // focusing a control brings it into view (§ E9); one already in view is left where it is
        if (!onScreen(id)) opts.onFrameRequest?.(id, stage);
        return;
      }
      const st = framings.of(id);
      const box = focusBox(id, new Box3());
      if (st !== null && st !== framed.station) {
        // § E9 "focusing one frames it": focus moving into a station frames the station ...
        framing.frame(st, 'focus');
        following = id;
        if (!box || !resting) return;
        const target = resting;
        // ... and, where the thing would not be in view once the camera rests there, the least move on from it
        if (atView(target, () => clear(id, KEEP_CLEAR.pad))) stage.camera.easeTo(target);
        else showThing(id, box, atView(target, () => stage.camera.view()));
        return;
      }
      following = id;
      // moving on inside it, the camera keeps still (no lurch on every Tab) unless the thing is out of the clear
      // area (a crate gone down the belt, one end of a wide station on a phone); while it eases, `keepFocusClear`
      // judges at rest
      if (box && !stage.camera.easing && !clear(id, KEEP_CLEAR.pad)) showThing(id, box, stage.camera.view());
    },
    on(f) {
      framingListeners.add(f);
      return () => framingListeners.delete(f);
    },
    setInset(i, from = 'page') {
      // (P4 H1 round three) each covering keeps its own inset; the clear area is the canvas less the widest of them
      insets.set(from, { ...(insets.get(from) ?? {}), ...i });
      const s = { top: 0, right: 0, bottom: 0, left: 0 };
      for (const v of insets.values()) for (const k of ['top', 'right', 'bottom', 'left'] as const) s[k] = Math.max(s[k], v[k] ?? 0);
      inset = s;
    },
    screenRect: (id) => rectOf(id),
    reveal(id, prev) {
      const cam = stage.camera;
      const old = prev && (prev as RevealImpl).before ? (prev as RevealImpl) : null;
      // (asked before this reveal moves anything: is the earlier one's picture still the one in front of us?)
      const oldHolds = old ? !old.moved() : false;
      // where the camera is, or will rest (an ease under way: its end)
      const base = cam.easing && resting ? resting : cam.view();
      const close = cam.reach > 1 || cam.look !== null;
      const look = cam.look;
      const keep = (to: View | null): RevealImpl => {
        const before = oldHolds ? old!.before : to ? base : null;
        const r: RevealImpl = {
          before,
          to: to ?? (oldHolds ? old!.to : null),
          close: oldHolds ? old!.close : close,
          look: oldHolds ? old!.look : look,
          moved() {
            if (!this.to) return true;
            const v = cam.easing && resting ? resting : cam.view();
            const near = Math.abs(v.zoom - this.to.zoom) < 1e-3 && v.focus.every((f, k) => Math.abs(f - this.to!.focus[k]!) < 1e-3);
            return !near;
          },
          back() {
            if (!this.before || this.moved()) return;
            resting = this.before;
            cam.easeTo(this.before, undefined, { close: this.close, look: this.look ?? cam.look });
          },
        };
        return r;
      };
      if (id === null) return keep(null);
      const box = focusBox(id, new Box3());
      if (!box) return keep(null);
      following = null;
      // already in the clear area where the camera rests: nothing moves
      if (atView(base, () => clear(id, KEEP_CLEAR.pad), close)) return keep(null);
      const to = settle(id, base, close);
      if (!to) return keep(null);
      resting = to;
      // a look stays a look (the crew stay see-through in front of what it holds)
      cam.easeTo(to, undefined, { close, look });
      return keep(to);
    },
  };
  /**
   * (P4 S5 round two) A thing asked to be looked at (`look`): from the view now, the least move that shows its box at
   * least `LOOK_AT.minPx` across in the clear area. Already that close and in the clear: the camera stays. Else it is
   * drawn in a step at a time toward the thing, as far as the camera goes, then slid (`settle`) into the clear area.
   * Esc, the back button and pinching out leave it as they leave a station. Under reduced motion the ease is a cut.
   */
  const lookAt = (id: Id): void => {
    const box = focusBox(id, new Box3());
    if (!box) return;
    following = null;
    const cam = stage.camera;
    const c = clearOf(KEEP_CLEAR.pad);
    // (round three) close enough when the box is `minPx` across either way, or fills the clear area's width or height
    // (`fill`): each side judged against its own side of the area, so a tall box on an upright phone comes in until
    // its width fills the screen
    const wantW = Math.min(LOOK_AT.minPx, (c.x1 - c.x0) * LOOK_AT.fill);
    const wantH = Math.min(LOOK_AT.minPx, (c.y1 - c.y0) * LOOK_AT.fill);
    const enough = (): boolean => {
      const r = rectOf(id);
      return !!r && (r.x1 - r.x0 >= wantW || r.y1 - r.y0 >= wantH);
    };
    if (!cam.easing && enough() && clear(id, KEEP_CLEAR.pad)) {
      cam.look = box;
      return;
    }
    const m = box.getCenter(new Vector3());
    // (round three) a look may come closer than a station, as far as the camera's own limit for looks
    const top = cam.lookZoom;
    let v: View = { focus: [m.x, m.y, m.z], zoom: cam.view().zoom };
    for (let i = 0; i < LOOK_AT.tries; i++) {
      const r = atView(v, () => ({ ok: enough(), rest: cam.view() }), true);
      if (r.ok || r.rest.zoom >= top - 1e-6) break;
      v = { focus: v.focus, zoom: Math.min(top, r.rest.zoom + LOOK_AT.zoomStep) };
    }
    const at = settle(id, v, true) ?? atView(v, () => cam.view(), true);
    resting = at;
    cam.easeTo(at, undefined, { close: true, look: box });
    cam.focusOn({ x: m.x, y: m.y, z: m.z });
  };
  /** (round two) A double-click or double-tap that the world may answer (`select`); the station if nothing asked to be looked at. */
  let pendingFrame: { id: Id; step: number; until: number } | null = null;
  const lookEvents = (frame: Frame): void => {
    for (const e of frame.events) {
      if (e.type !== 'look') continue;
      pendingFrame = null;
      lookAt(e.target);
    }
    if (pendingFrame && (world.step > pendingFrame.step || now() > pendingFrame.until)) {
      const id = pendingFrame.id;
      pendingFrame = null;
      if (framings) framing.frame(framings.of(id), 'select');
      else opts.onFrameRequest?.(id, stage);
    }
  };
  /** Once per frame, the camera at rest: what has focus is still in the clear area, or is brought back to it. */
  const keepFocusClear = (): void => {
    if (following === null || stage.camera.easing) return;
    const id = following;
    if (gestures.focused !== id && gestures.keyHold?.dest !== id) {
      following = null;
      return;
    }
    const box = focusBox(id, box3);
    if (box && !clear(id, KEEP_CLEAR.pad)) showThing(id, box, stage.camera.view());
  };
  const dom: DomInput = attachInput(canvas, gestures, {
    intent: fromInput,
    focus(id) {
      if (id !== null) framing.bring(id);
    },
    pan(from, to) {
      const a = stage.camera.benchPoint(ndcOf(from), scene.bench.top);
      const b = stage.camera.benchPoint(ndcOf(to), scene.bench.top);
      if (!a || !b) return;
      v3.copy(a);
      v3b.copy(b);
      following = null;
      stage.camera.panBy(v3.x - v3b.x, v3.z - v3b.z);
    },
    nudge: (dx, dz) => camera.pan(dx, dz),
    zoom(f, at) {
      following = null;
      stage.camera.zoomBy(f, at ? ndcOf(at) : undefined);
      // § B6: pinched (or wheeled, or `-`) out to the whole bench: the station is no longer framed
      if (f > 1 && framed.station !== null && stage.camera.zoom <= 1e-3) {
        framed.station = null;
        for (const l of framingListeners) guard.run('ui:framing', () => l(null, 'back'));
      }
    },
    frame(_x, _y, id) {
      // (round two) a thing double-clicked or double-tapped may answer it itself (a project crate opens and asks to be
      // looked at); the station is framed if nothing does
      if (id !== null) {
        dispatch({ type: 'select', id });
        pendingFrame = { id, step: world.step, until: now() + LOOK_AT.selectWait };
        return;
      }
      if (framings) framing.frame(null, 'select');
      else opts.onFrameRequest?.(id, stage);
    },
    back() {
      if (phone?.isOpen) phone.close();
      else if (framings) framing.frame(null, 'back');
      else camera.back();
    },
    undo: () => controls.undo(),
    cursor: (c) => glove?.[POSE_OF[c]] ?? null,
  });
  // (R1) the bench's own cursor, a work glove: drawn once (1x and 2x) and handed to the canvas as CSS cursors;
  // the system's cursor until then, and for visitors who ask for more contrast or less motion (ui/cursor.ts)
  let glove: Record<GlovePose, string> | null = null;
  void gloveCursors().then((g) => {
    glove = g;
    dom.refreshCursor();
  });

  // 6. the loop
  const frameListeners = new Set<(frame: Frame) => void>();
  let pointerWorld: Vec3 | null = null;
  const driver = new Driver({
    world,
    views,
    guard,
    render: (dt) => stage.render({ dt }),
    input: {
      tick(now) {
        picking.setView(stage.camera.camera, canvas.clientHeight || 1);
        dom.tick(now);
        const p = dom.pointer;
        pointerWorld = p ? surface.at(p.x, p.y, p.kind, gestures.held?.id ?? null).point : null;
      },
      pointer: () => pointerWorld,
      hovered: () => gestures.hover,
      focused: () => gestures.focused,
      keyDest: () => gestures.keyHold?.dest ?? null,
      working: () => gestures.working,
      settle() {
        // the world refused a grab (or let go by itself): input forgets it
        if (!dispatchedSinceStep && gestures.held && !world.holding()) gestures.forget();
      },
    },
    onFrame: (frame) => {
      // the phone hears its line; the open panel stands clear of the station as the camera moves
      phone?.sync();
      opts.onFrame?.(frame, workshop);
      // (P3 B2) the page's own listeners: the controls list, its live region
      for (const f of frameListeners) guard.run('ui:frame', () => f(frame));
      // (K2) a focus that moved on while the camera eased, judged now it rests
      guard.run('ui:focus', keepFocusClear);
      // (P4 S5 round two) a thing that asked to be looked at; a double-click nothing answered frames its station
      guard.run('ui:look', () => lookEvents(frame));
    },
  });
  driverRef.d = driver;

  // 6. the shaders, without blocking
  if (yieldBetween) await yieldToBrowser();
  const tc = now();
  // every program the scene can ask for, shadow depth programs included (stage.warm, T1 round 3)
  await stage.warm();
  measure('compile', tc);
  progress('compile', 1, 1);

  // 7. the loop
  const loop = createLoop({
    manual: opts.manual ?? false,
    step() {
      driver.step();
      dispatchedSinceStep = false;
    },
    render: (info) => driver.render(info),
    onError: (e) => guard.escaped(e),
  });
  loopRef.l = loop;
  // R2: a lost graphics context (a GPU reset, a weaker machine giving up): our canvas would be a frozen
  // picture for the rest of the visit with no error anywhere. Stop (the world keeps its state), count it,
  // and let the caller show the picture and rebuild when the context comes back.
  const onContextLost = (e: Event): void => {
    e.preventDefault();
    contextGone = true;
    try {
      loop.stop();
    } catch {
      /* stopping is best effort */
    }
    guard.contextLost();
    opts.onContextLost?.();
  };
  canvas.addEventListener('webglcontextlost', onContextLost);
  // R2: what a script on the built page can read (nothing leaves the browser)
  if (typeof window !== 'undefined') (window as unknown as { __workshopFaults?: () => FaultCounts }).__workshopFaults = () => guard.faults();
  const workshop: Workshop = {
    world,
    simWorld: world,
    disown() {
      ownsWorld = false;
      return world;
    },
    stage,
    loop,
    picking,
    gestures,
    surface,
    controls,
    driver,
    latency: driver.latency,
    materials,
    labels,
    views,
    phone,
    get focused() {
      return gestures.focused;
    },
    input: dom,
    framing,
    onFrame(f) {
      frameListeners.add(f);
      return () => frameListeners.delete(f);
    },
    advance: (n) => loop.advance(n),
    faults: () => guard.faults(),
    dispatch,
    dispose() {
      removeEventListener('resize', onResize);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      frameListeners.clear();
      framingListeners.clear();
      world.setOnFault(null);
      loop.dispose();
      dom.dispose();
      phone?.destroy();
      for (const v of views) v.dispose();
      if (ownsWorld) world.dispose();
      materials.dispose();
      labels.dispose();
      stage.dispose();
    },
  };
  // ─── AU1 sound (src/workshop/audio): this block, and nothing else in this file ──────────────────
  // The sound is heard from the visitor's first click, tap or key and never before (§ E6 step 4). M mutes,
  // remembered in the browser (§ B9). Every frame reaches it through the caller's `onFrame`, wrapped here;
  // the events of the frames between the first gesture and the sound being ready are kept, so the first
  // pick-up is heard. `dispose` closes it. The sound reads the world and never writes it.
  //
  // (I1 R3) What the first gesture needs is made BEFORE it, in idle time once the bench is running: making an
  // AudioContext opens the audio device (136 ms on the reference laptop) and the sound's code renders its
  // palette (about 60 ms more); done inside the first press they made the visit's first grab take 170 ms
  // (§ E0: 50). The context is made suspended, nothing is fed to it, and the first gesture only resumes it.
  // It is asked for in the first idle time after the loop starts running on the wall clock (after the hand-over
  // on the loader's path, so never on the way to usable). A visitor who presses before even that comes gets it
  // made just after the frame that shows the press, never inside it.
  {
    type SoundModule = typeof import('../audio/index.ts');
    let sound: import('../audio/index.ts').Sound | null = null;
    let mod: Promise<SoundModule> | null = null;
    let context: AudioContext | null = null;
    /** True from the first gesture: frames reach the sound (or wait in `early` until it is ready). */
    let heard = false;
    let early: Frame['events'][number][] = [];
    let gone = false;
    const load = (): Promise<SoundModule> => (mod ??= import('../audio/index.ts'));
    const editable = (t: EventTarget | null): boolean => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    /** Make the context (suspended until a gesture) and the sound. Idempotent. */
    const prepare = (): void => {
      if (context || gone) return;
      const Ctx = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      let c: AudioContext;
      try {
        c = new Ctx({ latencyHint: 'interactive' });
      } catch {
        return; // no sound on this browser; the workshop carries on silent
      }
      context = c;
      if (heard) c.resume().catch(() => {});
      load()
        .then((m) => {
          if (gone) return void c.close();
          sound = m.createSound(c);
          if (heard && early.length > 0) sound.frame({ world, events: early });
          early = [];
        })
        .catch(() => {
          early = [];
        });
    };
    const first = (): void => {
      removeEventListener('pointerdown', first, true);
      removeEventListener('keydown', first, true);
      heard = true;
      if (context) context.resume().catch(() => {});
      // not made yet (a press before any idle time): after the frame that answers the press, not inside it
      else requestAnimationFrame(() => setTimeout(prepare, 0));
    };
    // bound: called bare, the browser's requestIdleCallback throws "Illegal invocation"
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const idle = ric ? ric.bind(globalThis) : null;
    let asked = false;
    /** Once the loop runs on the wall clock: ask for the first idle time. */
    const ask = (): void => {
      // (`loop.running` is false inside a frame: the next one is asked for after it; manual is the test)
      if (asked || loop.manual) return;
      asked = true;
      if (idle) idle(prepare, { timeout: 1000 });
      else soon = setTimeout(prepare, 200);
    };
    let soon: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || (e.key !== 'm' && e.key !== 'M') || editable(e.target)) return;
      void load().then((m) => m.toggleMuted());
    };
    addEventListener('pointerdown', first, true);
    addEventListener('keydown', first, true);
    addEventListener('keydown', onKey);
    const callerFrame = opts.onFrame;
    opts = {
      ...opts,
      onFrame(frame, ws) {
        guard.run('audio', () => {
          ask();
          if (!heard) return; // before the first gesture nothing is heard (and nothing piles up for later)
          if (sound) sound.frame(frame);
          else if (early.length < 2000) early.push(...frame.events);
        });
        guard.run('ui:page', () => callerFrame?.(frame, ws));
      },
    };
    const disposeWorkshop = workshop.dispose;
    workshop.dispose = () => {
      gone = true;
      clearTimeout(soon);
      removeEventListener('pointerdown', first, true);
      removeEventListener('keydown', first, true);
      removeEventListener('keydown', onKey);
      sound?.dispose();
      disposeWorkshop();
    };
  }
  // ─── end AU1 sound ─────────────────────────────────────────────────────────────────────────────

  // The first frame is drawn only now that `workshop` exists: `onFrame` hands it to the page.
  if (opts.manual) {
    // the first frame (the loop draws its own once started)
    const tf = now();
    loop.advance(0);
    measure('first frame', tf);
  }
  progress('frame', 1, 1);
  mark('booted');
  if (!opts.manual) loop.start();
  return workshop;
}

/**
 * Compile every material the scene will draw without stalling the main
 * thread on each program's link (three's `compileAsync` polls
 * KHR_parallel_shader_compile). The post chain's passes and the shadow depth
 * programs still compile on the first frame.
 */
function startCompile(stage: Stage): void {
  try {
    // against the target the frame draws the scene into (F1: compiled for the canvas, every program here was
    // one no frame used, and the first frame linked them all again)
    stage.compile();
  } catch {
    /* the first frame compiles whatever is left */
  }
}

/** Drawn, as far as a pick is concerned: visible all the way up, and not scaled away (the kit's way of hiding a node). */
function isShown(o: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) {
    if (!p.visible) return false;
    if (Math.min(Math.abs(p.scale.x), Math.abs(p.scale.y), Math.abs(p.scale.z)) < 1e-3) return false;
  }
  return true;
}

/** The default framing: the bench's box from the scene, home at zoom 0. */
export function defaultFraming(stage: Stage, scene: SceneDesc): void {
  const b = scene.bench;
  const box = new Box3(new Vector3(b.minX, b.top - 0.4, b.minZ), new Vector3(b.maxX, b.top + 5, b.maxZ));
  stage.camera.setSubject(box, { edge: { y: b.top, z: b.maxZ } });
  stage.camera.cutTo(stage.camera.home());
}
