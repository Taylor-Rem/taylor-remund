/**
 * The boot (REWRITE.md § E6, W2 brief § 4): from a canvas to a running
 * workshop. In order:
 *
 *   1. the stage (renderer, light, camera, post) and picking;
 *   2. the physics module starts loading after the first animation frame
 *      (its wasm never blocks the first paint), while the label fonts load;
 *   3. materials, the `ViewContext`, every station view the caller listed;
 *      one frame is drawn;
 *   4. the world, from the scene and the seed;
 *   5. input on the canvas → intents → `world.dispatch`; the camera
 *      gestures → the rig;
 *   6. the fixed-step loop: input, steps, frame, views, render.
 *
 * The shell knows no station: it takes the list (`check-layers`).
 */
import { Box3, Ray, Vector3 } from 'three';
import { createRapierPhysics, createWorld } from '../sim/index.ts';
import type { Id, Intent, PhysicsPort, SceneDesc, Vec3, World, WorldView } from '../sim/index.ts';
import type { Frame, StationView, Tier, ViewContext } from '../view/types.ts';
import { createStage, CameraRig, createLoop, type Loop, type Stage, type StageOptions } from '../view/stage/index.ts';
import { createMaterials, type WorkshopMaterials } from '../view/materials/index.ts';
import { createLabels, type LabelsOptions, type WorkshopLabels } from '../view/labels/index.ts';
import { realize } from '../view/kit/realize.ts';
import { Picking } from '../view/picking.ts';
import { Gestures, type GestureTuning, type PointerKind } from '../input/gesture.ts';
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
  /** Deterministic: run n steps and render one frame (manual mode for captures). */
  advance(n: number): void;
  /** Dispatch an intent as if input had (tests, the controls list). */
  dispatch(intent: Intent, t?: number): void;
  dispose(): void;
}

const nextFrame = (): Promise<void> => new Promise((r) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => r()) : setTimeout(r, 0)));

export async function bootWorkshop(canvas: HTMLCanvasElement, opts: BootOptions): Promise<Workshop> {
  // 1. the stage
  const stage = createStage(canvas, { ...opts.stage, tier: opts.tier, reducedMotion: opts.reducedMotion });
  const picking = new Picking();
  stage.render();

  // 2. physics after the first frame, fonts meanwhile
  const physicsReady = nextFrame().then(() => (opts.physics ?? createRapierPhysics)());
  const labels = await createLabels({ anisotropy: stage.renderer.capabilities.getMaxAnisotropy(), ...opts.labels });
  const materials = createMaterials({ tier: opts.tier, labels });

  // 3. the views
  const ctx: BootViewContext = {
    scene: stage.scene,
    materials,
    labels,
    tier: opts.tier,
    reducedMotion: opts.reducedMotion,
    realize: (piece) => realize(piece, materials),
    pickable: (id, object) => picking.add(id, object),
    stage,
    picking,
  };
  const views = opts.stations.map((f) => f(ctx));
  stage.render();

  // 4. the world
  const physics = await physicsReady;
  const world: World = createWorld({ seed: opts.seed, physics, ...(opts.scene ? { scene: opts.scene } : {}) });
  const scene = world.scene;
  const frameCamera = opts.frameCamera ?? defaultFraming;
  frameCamera(stage, scene);
  const onResize = (): void => frameCamera(stage, scene);
  addEventListener('resize', onResize);

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
  const usable = (id: Id): boolean => (world.interactable(id)?.affordances.length ?? 0) > 0;
  const surface = createSurface({
    world: () => world,
    ray: toRay,
    pick(r, kind: PointerKind, exclude) {
      pickRay.origin.set(r.origin[0], r.origin[1], r.origin[2]);
      pickRay.direction.set(r.dir[0], r.dir[1], r.dir[2]);
      const hit = picking.pick(pickRay, { exclude, minPx: kind === 'mouse' ? hitPx.mouse : hitPx.touch, filter: usable });
      return hit ? { id: hit.id, point: [hit.point.x, hit.point.y, hit.point.z] } : null;
    },
    half(id) {
      const b = picking.localBox(id);
      if (!b) return null;
      return [(b.max.x - b.min.x) / 2, (b.max.y - b.min.y) / 2, (b.max.z - b.min.z) / 2];
    },
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
  const controls = createControls({ world: () => world, dispatch, camera, undoId: opts.undoId ?? null });
  const dom: DomInput = attachInput(canvas, gestures, {
    intent: dispatch,
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
    back: () => camera.back(),
    undo: () => controls.undo(),
  });

  // 6. the loop
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
    onFrame: (frame) => opts.onFrame?.(frame, workshop),
  });
  driverRef.d = driver;
  const loop = createLoop({
    manual: opts.manual ?? false,
    step() {
      driver.step();
      dispatchedSinceStep = false;
    },
    render: (info) => driver.render(info),
  });
  if (!opts.manual) loop.start();

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
    advance: (n) => loop.advance(n),
    dispatch,
    dispose() {
      removeEventListener('resize', onResize);
      loop.dispose();
      dom.dispose();
      for (const v of views) v.dispose();
      world.dispose();
      materials.dispose();
      labels.dispose();
      stage.dispose();
    },
  };
  return workshop;
}

/** The default framing: the bench's box from the scene, home at zoom 0. */
function defaultFraming(stage: Stage, scene: SceneDesc): void {
  const b = scene.bench;
  const box = new Box3(new Vector3(b.minX, b.top - 0.4, b.minZ), new Vector3(b.maxX, b.top + 5, b.maxZ));
  stage.camera.setSubject(box, { edge: { y: b.top, z: b.maxZ } });
  stage.camera.cutTo(stage.camera.home());
}
