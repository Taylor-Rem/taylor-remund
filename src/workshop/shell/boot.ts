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
import { Box3, Ray, Vector3 } from 'three';
import { createPhonePanel, type PhonePanel } from '../ui/phone/index.ts';
import { worldLine, type WorldLine } from '../ui/phone/world-line.ts';
import { createRapierPhysics, createWorld } from '../sim/index.ts';
import type { Id, Intent, PhysicsPort, SceneDesc, Vec3, World, WorldView } from '../sim/index.ts';
import type { Frame, StationView, Tier, ViewContext } from '../view/types.ts';
import { createStage, CameraRig, createLoop, type Loop, type Stage, type StageOptions } from '../view/stage/index.ts';
import { createMaterials, type WorkshopMaterials } from '../view/materials/index.ts';
import { createLabels, type LabelsOptions, type WorkshopLabels } from '../view/labels/index.ts';
import { realize } from '../view/kit/realize.ts';
import { Picking } from '../view/picking.ts';
import { Gestures, type GestureTuning, type HeldKind, type PointerKind } from '../input/gesture.ts';
import { createSurface, type Surface } from '../input/surface.ts';
import { attachInput, type DomInput } from '../input/dom.ts';
import { createControls, type Controls } from '../input/controls.ts';
import type { CarryTuning, RayLike } from '../input/carry.ts';
import { Driver } from './frame.ts';
import type { LatencyMeter } from './latency.ts';

/**
 * What the boot gives every station view: the `ViewContext` contract plus
 * the stage (a view may dip the lamp or pin the focus) and picking. Proposed
 * as additions to `view/types.ts` (see the W2 report).
 */
export interface BootViewContext extends ViewContext {
  readonly stage: Stage;
  readonly picking: Picking;
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
   * stage. `line` is the world's phone line (default `line`); `target` the pick target the phone's view
   * registers (default: the line's id); `parent` where the panel lives (default `document.body`). Made
   * when the world has that line and there is a document; `false`: no phone.
   */
  phone?: false | { line?: Id; target?: Id; parent?: HTMLElement };
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
  /** The texting panel (null: no phone line, or no document). */
  readonly phone: PhonePanel | null;
  /** Keyboard focus on the stage (an interactable, or the phone's target), or null. The view should mark it. */
  readonly focused: Id | null;
  /** Deterministic: run n steps and render one frame (manual mode for captures). */
  advance(n: number): void;
  /** Dispatch an intent as if input had (tests, the controls list). */
  dispatch(intent: Intent, t?: number): void;
  dispose(): void;
}

export async function bootWorkshop(canvas: HTMLCanvasElement, opts: BootOptions): Promise<Workshop> {
  const progress = opts.onProgress ?? ((): void => {});
  const yieldBetween = opts.yieldBetweenViews ?? true;
  const t0 = now();
  mark('boot');

  // 1. physics at once
  const physicsReady = (opts.physics ?? createRapierPhysics)().then((p) => {
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
  const labels = await createLabels({ anisotropy: stage.renderer.capabilities.getMaxAnisotropy(), ...opts.labels });
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
    pickable: (id, object) => picking.add(id, object),
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
  const tp = now();
  const physics = await physicsReady;
  measure('physics wait', tp);
  const tw = now();
  const world: World = createWorld({ seed: opts.seed, physics, ...(opts.scene ? { scene: opts.scene } : {}) });
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
  // the phone: the line's pick target opens the panel (made below, once the dispatch exists)
  const phoneOpt = opts.phone === false ? null : (opts.phone ?? {});
  const lineId = phoneOpt?.line ?? 'line';
  const hasPhone = phoneOpt !== null && typeof document !== 'undefined' && world.machine(lineId)?.kind === 'line';
  const phoneTarget = phoneOpt?.target ?? lineId;
  const panelIds: ReadonlySet<Id> = new Set(hasPhone ? [phoneTarget] : []);
  const mouthIds: ReadonlySet<Id> = new Set((scene.mouths ?? []).map((m) => m.id));
  const jackIds: ReadonlySet<Id> = new Set(scene.cord.jacks.map((j) => j.id));
  const usable = (id: Id): boolean => panelIds.has(id) || (world.interactable(id)?.affordances.length ?? 0) > 0;
  /** While something is held, where it may go is pickable too: mouths for a part or a unit, every jack for the plug (a capped one refuses). */
  const pickFilter = (holding: HeldKind | null): ((id: Id) => boolean) => {
    if (holding === 'plug') return (id) => usable(id) || jackIds.has(id);
    if (holding) return (id) => usable(id) || mouthIds.has(id);
    return usable;
  };
  const filters = { none: pickFilter(null), part: pickFilter('part'), unit: pickFilter('unit'), plug: pickFilter('plug') };
  const box3 = new Box3();
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
      const hit = picking.pick(pickRay, { exclude, minPx: kind === 'mouse' ? hitPx.mouse : hitPx.touch, filter: filters[holding ?? 'none'] });
      return hit ? { id: hit.id, point: [hit.point.x, hit.point.y, hit.point.z] } : null;
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
    panels: () => panelIds,
    ...(opts.carry ? { carry: opts.carry } : {}),
  });
  const gestures = new Gestures(surface, opts.gestures);

  let dispatchedSinceStep = false;
  const driverRef: { d: Driver | null } = { d: null };
  const dispatch = (intent: Intent, t: number = performance.now()): void => {
    world.dispatch(intent);
    dispatchedSinceStep = true;
    driverRef.d?.latency.dispatched(intent, t);
    opts.onIntent?.(intent, t);
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
  let line: WorldLine | null = null;
  let phone: PhonePanel | null = null;
  const rectOf = (id: Id): DOMRect | null => {
    const s = screenOf(id);
    if (!s || typeof DOMRect === 'undefined') return null;
    const c = canvas.getBoundingClientRect();
    return new DOMRect(c.left + s.x - s.r, c.top + s.y - s.r, 2 * s.r, 2 * s.r);
  };
  if (hasPhone) {
    line = worldLine({ world, dispatch: (i) => dispatch(i), line: lineId });
    phone = createPhonePanel({
      line,
      ...(phoneOpt?.parent ? { parent: phoneOpt.parent } : {}),
      anchor: () => rectOf(phoneTarget),
      // the station on that line, by its unit's pick target when its view registered one
      avoid: (jack) => (jack ? rectOf(jack) : null),
      reducedMotion: () => world.reducedMotion,
    });
  }
  /** Input's intents, with the page's own handles taken out: a press on the phone opens its panel. */
  const fromInput = (intent: Intent, t: number): void => {
    if (intent.type === 'press' && panelIds.has(intent.id)) {
      if (phone && !phone.isOpen) phone.open(canvas);
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
  });

  // 6. the loop
  let placeEvery = 0;
  let pointerWorld: Vec3 | null = null;
  const driver = new Driver({
    world,
    views,
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
      settle() {
        // the world refused a grab (or let go by itself): input forgets it
        if (!dispatchedSinceStep && gestures.held && !world.holding()) gestures.forget();
      },
    },
    onFrame: (frame) => {
      line?.sync();
      // the open panel stands clear of the station on its line as the camera moves (a few times a second)
      if (phone?.isOpen && ++placeEvery % 12 === 0) phone.place();
      opts.onFrame?.(frame, workshop);
    },
  });
  driverRef.d = driver;

  // 6. the shaders, without blocking
  if (yieldBetween) await yieldToBrowser();
  const tc = now();
  await compileShaders(stage);
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
  });
  const workshop: Workshop = {
    world,
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
    dispatch,
    dispose() {
      removeEventListener('resize', onResize);
      loop.dispose();
      dom.dispose();
      phone?.destroy();
      for (const v of views) v.dispose();
      world.dispose();
      materials.dispose();
      labels.dispose();
      stage.dispose();
    },
  };
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

/** The default framing: the bench's box from the scene, home at zoom 0. */
export function defaultFraming(stage: Stage, scene: SceneDesc): void {
  const b = scene.bench;
  const box = new Box3(new Vector3(b.minX, b.top - 0.4, b.minZ), new Vector3(b.maxX, b.top + 5, b.maxZ));
  stage.camera.setSubject(box, { edge: { y: b.top, z: b.maxZ } });
  stage.camera.cutTo(stage.camera.home());
}
