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
import type { Id, Intent, PhysicsPort, SceneDesc, StepFault, Vec3, World, WorldView } from '../sim/index.ts';
import type { Frame, StationView, Tier, ViewContext } from '../view/types.ts';
import { createStage, CameraRig, createLoop, type Loop, type Stage, type StageOptions } from '../view/stage/index.ts';
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
  /** Hook: a double-click/double-tap asked to frame the station under the pointer. */
  onFrameRequest?(id: Id | null, stage: Stage): void;
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
    targetBox: (id, out) => picking.worldBox(id, out),
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
  const surface = createSurface({
    world: () => world,
    ray: toRay,
    pick(r, kind: PointerKind, exclude, holding = null) {
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
        if (!behind || behind.grown || !missesDrawn(front.id)) break;
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
    panels: () => panelIds,
    hidden: () => (hasPhone ? lineSet : noIds),
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
      const step = stage.camera.distance * 0.06;
      stage.camera.panBy(dx * step, dz * step);
    },
    zoom(f: number) {
      stage.camera.zoomBy(f);
    },
    back() {
      stage.camera.easeTo(stage.camera.home());
    },
    frame(id: Id) {
      opts.onFrameRequest?.(id, stage);
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
        phone.open(canvas);
        // the line hears it: picking the phone up is the visitor's doing (it ends attract mode, § B3)
        if (world.interactable(lineId)) dispatch({ type: 'press', id: lineId }, t);
      }
      return;
    }
    dispatch(intent, t);
  };
  const onScreen = (id: Id): boolean => {
    const s = screenOf(id);
    if (!s) return true;
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    return s.x > w * 0.06 && s.x < w * 0.94 && s.y > h * 0.06 && s.y < h * 0.94;
  };
  const dom: DomInput = attachInput(canvas, gestures, {
    intent: fromInput,
    focus(id) {
      // focusing a control brings it into view (§ E9); one already in view is left where it is
      if (id !== null && !onScreen(id)) opts.onFrameRequest?.(id, stage);
    },
    pan(from, to) {
      const a = stage.camera.benchPoint(ndcOf(from), scene.bench.top);
      const b = stage.camera.benchPoint(ndcOf(to), scene.bench.top);
      if (!a || !b) return;
      v3.copy(a);
      v3b.copy(b);
      stage.camera.panBy(v3.x - v3b.x, v3.z - v3b.z);
    },
    nudge: (dx, dz) => camera.pan(dx, dz),
    zoom(f, at) {
      stage.camera.zoomBy(f, at ? ndcOf(at) : undefined);
    },
    frame(_x, _y, id) {
      opts.onFrameRequest?.(id, stage);
    },
    back() {
      if (phone?.isOpen) phone.close();
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
    advance: (n) => loop.advance(n),
    faults: () => guard.faults(),
    dispatch,
    dispose() {
      removeEventListener('resize', onResize);
      canvas.removeEventListener('webglcontextlost', onContextLost);
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
    const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    let asked = false;
    /** Once the loop runs on the wall clock: ask for the first idle time. */
    const ask = (): void => {
      if (asked || !loop.running || loop.manual) return;
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
    stage.scene.updateMatrixWorld(true);
    stage.renderer.compile(stage.scene, stage.camera.camera);
  } catch {
    /* the first frame compiles whatever is left */
  }
}

async function compileShaders(stage: Stage): Promise<void> {
  try {
    stage.scene.updateMatrixWorld(true);
    await stage.renderer.compileAsync(stage.scene, stage.camera.camera);
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
