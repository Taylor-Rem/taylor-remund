/**
 * The showcase: the five foundation packages put together on one canvas
 * (W1.5 brief § 1). The stage (renderer, light rig, camera, post), the
 * labels (awaited), the materials, and a bench to stand things on; then
 * helpers to add a kit Piece through `realize`, frame it at the catalogue's
 * review distances with the stage's real lens, advance the loop
 * deterministically, and dispose. Shared by /dev/catalogue/ and /dev/look/.
 * No visitor-facing text.
 *
 *   const show = await mountShowcase(canvas, { tier: 'high' });
 *   const obj = show.add(piece, { x: 0, z: 0, yaw: 0 });
 *   show.look(show.boxOf(obj), 'station');
 *   await show.ready;   // window.__ready is set after a settled frame
 */
import { Box3, Group, Vector3, type Mesh, type Object3D } from 'three';
import type { Piece } from '../kit/types.ts';
import { realize } from '../kit/realize.ts';
import type { Tier } from '../types.ts';
import { createStage, type Stage } from '../stage/index.ts';
import { createLoop, type Loop, type RenderInfo } from '../stage/loop.ts';
import { installDebugHooks, type WorkshopDebug } from '../stage/debug.ts';
import type { PassFlags, ToneMap } from '../stage/post.ts';
import type { View } from '../stage/camera.ts';
import { createMaterials, type WorkshopMaterials } from '../materials/index.ts';
import { createLabels, type WorkshopLabels } from '../labels/index.ts';
import { BlobShadows, type Blob } from '../effects/blob-shadows.ts';
import { benchSubject, distanceFor, type Distance } from './distances.ts';
import { benchStandIn, wallStandIn } from './ground.ts';
import { findPiece, buildEntry } from './registry.ts';
import { debugOf, type ViewMode } from './views.ts';

export interface ShowcaseOptions {
  tier?: Tier;
  /** False runs the high tier straight to the canvas (no post chain). */
  post?: boolean;
  passes?: Partial<PassFlags>;
  toneMap?: ToneMap;
  reducedMotion?: boolean;
  /** Lamp level 0..1 (null leaves the rig's default, 1). */
  lamp?: number | null;
  /** Start in manual mode: nothing moves until `advance`. */
  manual?: boolean;
  /** 'bench' (the registry's bench, or the stand-in) or nothing. */
  ground?: 'bench' | 'none';
  /** A slice of back wall behind the bench. */
  wall?: boolean;
  /** Called every rendered frame before the stage draws (turntables, idle motion). */
  onFrame?(info: RenderInfo): void;
  /** Frames to render before declaring a settled picture (shaders, environment, shadows). */
  settleFrames?: number;
}

export interface Placement {
  x?: number;
  y?: number;
  z?: number;
  /** Turn about +Y, degrees. */
  yaw?: number;
  /** Contact blob under the piece (0 for none). Default 1. */
  blob?: number;
  /** Review view to draw this piece in (default beauty). */
  view?: ViewMode;
}

export interface Showcase {
  readonly stage: Stage;
  readonly materials: WorkshopMaterials;
  /** The materials a review view is drawn with (beauty: `materials`; others: a debug instance, made on first use). */
  materialsFor(view: ViewMode): WorkshopMaterials;
  readonly labels: WorkshopLabels;
  readonly loop: Loop;
  readonly hooks: WorkshopDebug;
  /** Everything the showcase added (pieces and ground). */
  readonly world: Group;
  /** Where the ground came from. */
  readonly groundSource: 'registry' | 'stand-in' | 'none';
  /** Where the back wall came from (when asked for). */
  readonly wallSource: 'registry' | 'stand-in' | 'none';
  /** Realize a piece and stand it on the bench. Returns its top object (a Group named after the piece). */
  add(piece: Piece, at?: Placement): Object3D;
  /** World bounds of an added object. */
  boxOf(o: Object3D): Box3;
  /** Point the stage camera at `box` from one of the review distances (or an explicit distance). */
  look(box: Box3, dist: Distance | number, opts?: { focus?: Vector3 }): View;
  /** Re-run the last `look` (after a resize changes the aspect). */
  relook(): void;
  /** Resolves after a settled frame; also sets window.__ready. */
  readonly ready: Promise<void>;
  /** Start drawing (call after adding the pieces and the first `look`). */
  start(): void;
  dispose(): void;
}

/** The piece every view realizes with its contact blob, recorded so blobs follow placement. */
interface Added {
  obj: Object3D;
  blob: number;
}

export async function mountShowcase(canvas: HTMLCanvasElement, opts: ShowcaseOptions = {}): Promise<Showcase> {
  const tier: Tier = opts.tier ?? 'high';
  const stage = createStage(canvas, {
    tier,
    reducedMotion: opts.reducedMotion ?? false,
    ...(opts.passes ? { passes: opts.passes } : {}),
    ...(opts.post !== undefined ? { post: opts.post } : {}),
    ...(opts.toneMap ? { toneMap: opts.toneMap } : {}),
  });
  const labels = await createLabels({ anisotropy: stage.renderer.capabilities.getMaxAnisotropy() });
  const materials = createMaterials({ tier, labels });
  const debugMats = new Map<ViewMode, WorkshopMaterials>();
  const materialsFor = (view: ViewMode): WorkshopMaterials => {
    const debug = debugOf(view);
    if (!debug) return materials;
    let m = debugMats.get(view);
    if (!m) {
      m = createMaterials({ tier, labels, debug });
      if (view === 'wire') for (const k of ['steel', 'brass', 'wood', 'rubber', 'paper', 'metal', 'glass', 'bulb', 'felt', 'tape', 'belt'] as const) (m.of(k) as unknown as { wireframe: boolean }).wireframe = true;
      debugMats.set(view, m);
    }
    return m;
  };

  const world = new Group();
  world.name = 'showcase';
  stage.scene.add(world);

  const blobFx = new BlobShadows(64, tier === 'high' ? 0.35 : 0.85).addTo(world);
  const added: Added[] = [];
  const refreshBlobs = (): void => {
    const blobs: Blob[] = [];
    for (const a of added) {
      if (a.blob <= 0) continue;
      const b = boxOf(a.obj);
      if (b.isEmpty()) continue;
      const c = b.getCenter(new Vector3());
      const s = b.getSize(new Vector3());
      blobs.push({ x: c.x, z: c.z, rx: s.x * 0.58, rz: s.z * 0.58, strength: a.blob, y: Math.max(0, b.min.y) });
    }
    blobFx.set(blobs);
  };

  const boxOf = (o: Object3D): Box3 => {
    o.updateWorldMatrix(true, true);
    return new Box3().setFromObject(o);
  };

  const realizeInto = (piece: Piece, at: Placement): Object3D => {
    const obj = realize(piece, materialsFor(at.view ?? 'beauty'));
    obj.position.set(at.x ?? 0, at.y ?? 0, at.z ?? 0);
    obj.rotation.y = ((at.yaw ?? 0) * Math.PI) / 180;
    world.add(obj);
    return obj;
  };

  // ── the ground: the registry's bench when it exists, else the stand-in ──
  let groundSource: Showcase['groundSource'] = 'none';
  if ((opts.ground ?? 'bench') === 'bench') {
    const bench = await findPiece('bench');
    if (bench) {
      const p = buildEntry(bench, null, { seed: 1 }, labels);
      // the bench piece is built with its TOP at y = 0 (the plane things stand on), hanging below it
      realizeInto(p, {});
      groundSource = 'registry';
    } else {
      realizeInto(benchStandIn(), {}).traverse((m) => ((m as Mesh).castShadow = false));
      groundSource = 'stand-in';
    }
  }
  let wallSource: Showcase['wallSource'] = 'none';
  if (opts.wall) {
    const wall = await findPiece('back-wall');
    if (wall) {
      // its face is at z = 0: stand it at the bench's back edge
      realizeInto(buildEntry(wall, null, { seed: 1, width: 21, height: 6.5 }, labels), { z: -5 });
      wallSource = 'registry';
    } else {
      realizeInto(wallStandIn(), {}).traverse((m) => ((m as Mesh).castShadow = false));
      wallSource = 'stand-in';
    }
  }

  if (opts.lamp !== undefined && opts.lamp !== null) stage.lights.setLamp({ level: opts.lamp });

  // ── camera: the stage's lens and pitch; the subject is a bench-sized box
  // centred on what we look at, so zoom 0 is exactly the stage's whole-bench
  // distance and the zoom range reaches a close-up of one small piece ──
  stage.camera.stationSize = 0.2;
  let last: { box: Box3; dist: Distance | number; focus?: Vector3 } | null = null;
  const aspect = (): number => Math.max(1e-3, (canvas.clientWidth || canvas.width) / Math.max(1, canvas.clientHeight || canvas.height));
  const look: Showcase['look'] = (box, dist, o = {}) => {
    last = { box: box.clone(), dist, ...(o.focus ? { focus: o.focus.clone() } : {}) };
    const focus = o.focus?.clone() ?? box.getCenter(new Vector3());
    const subject = benchSubject();
    subject.translate(focus.clone().sub(subject.getCenter(new Vector3())));
    const bounds = subject.clone().expandByScalar(40);
    stage.camera.setSubject(subject, { bounds });
    const d = typeof dist === 'number' ? dist : distanceFor(dist, aspect(), box);
    const view: View = { focus: [focus.x, focus.y, focus.z], zoom: stage.camera.zoomForDistance(d) };
    stage.camera.cutTo(view);
    stage.camera.focusOn(focus);
    return view;
  };
  const relook = (): void => {
    if (last) look(last.box, last.dist, last.focus ? { focus: last.focus } : {});
  };
  const onResize = (): void => relook();
  addEventListener('resize', onResize);

  // ── the loop ──
  const settle = opts.settleFrames ?? 8;
  let frames = 0;
  let resolveReady!: () => void;
  const ready = new Promise<void>((r) => (resolveReady = r));
  let simTime = 0;
  const loop = createLoop({
    manual: opts.manual ?? false,
    step() {},
    render(info) {
      simTime = info.time;
      materials.update(simTime);
      for (const m of debugMats.values()) m.update(simTime);
      opts.onFrame?.(info);
      stage.render({ dt: info.dt });
      frames++;
      if (frames === settle) {
        requestAnimationFrame(() => {
          window.__ready = true;
          resolveReady();
        });
      }
    },
  });
  const hooks = installDebugHooks(stage, loop, {});

  const show: Showcase = {
    stage,
    materials,
    materialsFor,
    labels,
    loop,
    hooks,
    world,
    groundSource,
    wallSource,
    add(piece, at = {}) {
      const obj = realizeInto(piece, at);
      added.push({ obj, blob: at.blob ?? 1 });
      refreshBlobs();
      return obj;
    },
    boxOf,
    look,
    relook,
    ready,
    start() {
      // In manual mode render the settle frames now (captures); else run on the wall clock.
      if (opts.manual) for (let i = 0; i < settle; i++) loop.advance(0);
      else loop.start();
    },
    dispose() {
      removeEventListener('resize', onResize);
      loop.dispose();
      materials.dispose();
      for (const m of debugMats.values()) m.dispose();
      labels.dispose();
      world.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
      stage.dispose();
    },
  };
  return show;
}
