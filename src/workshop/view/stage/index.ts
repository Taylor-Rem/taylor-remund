/**
 * The stage (W1 brief § 1): the renderer, the scene, the camera rig, the
 * light rig, the environment and the post chain, with resize and pixel-ratio
 * handling. No simulation knowledge: stations add their objects to `scene`
 * and the shell's loop calls `render()`.
 *
 *   const stage = createStage(canvas, { tier: 'high', reducedMotion: false });
 *   const loop = createLoop({ step: () => sim.step(), render: (i) => { views.update(…); stage.render(i); } });
 */
import { Box3, Color, NoToneMapping, PCFShadowMap, SRGBColorSpace, Scene, Vector3, WebGLRenderer, AgXToneMapping, ACESFilmicToneMapping, NeutralToneMapping } from 'three';
import type { ToneMapping } from 'three';
import type { Tier } from '../types.ts';
import { CameraRig, type CameraRigOptions } from './camera.ts';
import { stageColours } from './colours.ts';
import { buildEnvironment } from './environment.ts';
import { GpuTimer } from './gpu-timer.ts';
import { LightRig, type LightRigOptions } from './light.ts';
import { defaultFlags, LOOK, PostChain, type PassFlags, type ToneMap } from './post.ts';

export { CameraRig, type View } from './camera.ts';
export { LightRig, RIG } from './light.ts';
export { LOOK, PASS_NAMES, defaultFlags, type PassFlags, type ToneMap } from './post.ts';
export { createLoop, FixedStep, type Loop, type RenderInfo } from './loop.ts';

export interface StageOptions {
  tier: Tier;
  reducedMotion: boolean;
  /** Post passes to start with (high tier). Defaults to all on. */
  passes?: Partial<PassFlags>;
  /** False runs the high tier without the post chain (straight to the canvas). */
  post?: boolean;
  toneMap?: ToneMap;
  camera?: CameraRigOptions;
  light?: Omit<LightRigOptions, 'tier'>;
  /** Preserve the drawing buffer (for screenshots from outside the page). */
  preserveDrawingBuffer?: boolean;
  /**
   * Measurement only: wait for the GPU at the end of every frame (a 1-pixel
   * read), so frame-to-frame time includes the GPU's work when vsync is off.
   */
  syncGpu?: boolean;
  /**
   * Time each pass on the GPU with timer queries (default off: on the
   * reference laptop, polling them stalls vsync'd frame pacing badly).
   */
  gpuTimer?: boolean;
}

export interface StageStats {
  tier: Tier;
  post: boolean;
  /** Drawing-buffer size and pixel ratio. */
  width: number;
  height: number;
  dpr: number;
  /** Draw calls and triangles of the scene draw (including the shadow map), and of the whole frame. */
  scene: { calls: number; triangles: number };
  frame: { calls: number; triangles: number };
  /** Smoothed GPU milliseconds per pass, when the timer extension exists. */
  gpu: Record<string, number> | null;
  gpuMedian: Record<string, number> | null;
  renderer: string;
}

export interface Stage {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: CameraRig;
  readonly lights: LightRig;
  readonly tier: Tier;
  /** GPU time per pass (measurement; enabled by `gpuTimer`). */
  readonly gpuTimer: GpuTimer;
  /** The live pass switches (high tier with post); flip a field and the next frame follows. */
  readonly passes: PassFlags;
  /** Whether the post chain runs. */
  post: boolean;
  toneMap: ToneMap;
  /** Show an intermediate of the post chain instead of the picture (debugging). */
  debugView: 'none' | 'ao' | 'coc';
  /** Draw one frame. `dt` (seconds) advances camera easing, shake and the lamp dip. */
  render(frame?: { dt?: number }): void;
  /** Re-read the canvas size (also done automatically on resize). */
  resize(): void;
  /** Render at a fraction of the pixel ratio (step-down when frame time worsens, § E7). */
  setResolutionScale(s: number): void;
  /** Shadows on or off (step-down, debugging). */
  setShadows(on: boolean): void;
  stats(): StageStats;
  /** Forget the GPU timer samples (the start of a measured window). */
  resetGpuTimes(): void;
  /** True while the tab is hidden: render() draws nothing. */
  readonly hidden: boolean;
  dispose(): void;
}

const TONE: Record<ToneMap, ToneMapping> = {
  agx: AgXToneMapping,
  aces: ACESFilmicToneMapping,
  neutral: NeutralToneMapping,
};

export function createStage(canvas: HTMLCanvasElement, opts: StageOptions): Stage {
  const tier = opts.tier;
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: opts.preserveDrawingBuffer ?? false,
    stencil: false,
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.shadowMap.enabled = tier === 'high';
  renderer.shadowMap.type = PCFShadowMap;
  const colours = stageColours();
  const room = new Color().fromArray(colours.room);
  renderer.setClearColor(room, 1);

  const scene = new Scene();
  scene.background = room.clone();

  const camera = new CameraRig({ ...opts.camera, reducedMotion: opts.reducedMotion });
  const lights = new LightRig({ tier, ...opts.light });
  const env = buildEnvironment(renderer, {
    lampDir: (() => {
      const b = lights.key.position;
      return [b.x, b.y, b.z] as const;
    })(),
  });
  lights.attach(scene, env.texture);

  const passes: PassFlags = { ...defaultFlags(), ...opts.passes };
  let post = tier === 'high' && (opts.post ?? true);
  let toneMap: ToneMap = opts.toneMap ?? LOOK.toneMap;
  const chain = tier === 'high' ? new PostChain(renderer, scene, camera.camera, passes) : null;
  if (chain) chain.keyLight = lights.key;
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const timer = new GpuTimer(gl);
  timer.enabled = opts.gpuTimer ?? false;
  if (timer.enabled) {
    // the shadow map is drawn inside the scene's render(): give it its own figure
    const sm = renderer.shadowMap as unknown as { render: (...a: unknown[]) => void };
    const drawShadows = sm.render;
    sm.render = function (this: unknown, ...a: unknown[]) {
      const resume = timer.current;
      timer.split('shadow');
      try {
        drawShadows.apply(this, a);
      } finally {
        if (resume) timer.split(resume);
        else timer.end();
      }
    };
  }
  const rendererName = (() => {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  })();

  const dprCap = tier === 'high' ? 2 : 1;
  let resScale = 1;
  let width = 1;
  let height = 1;
  const syncPixel = new Uint8Array(4);
  let lastScene = { calls: 0, triangles: 0 };
  let lastFrame = { calls: 0, triangles: 0 };

  const resize = (): void => {
    const w = Math.max(1, canvas.clientWidth || canvas.width);
    const h = Math.max(1, canvas.clientHeight || canvas.height);
    const dpr = Math.min(globalThis.devicePixelRatio || 1, dprCap) * resScale;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    width = Math.floor(w * dpr);
    height = Math.floor(h * dpr);
    camera.setAspect(w / h);
    chain?.setSize(width, height);
  };
  resize();
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
  observer?.observe(canvas);

  let hidden = typeof document !== 'undefined' ? document.hidden : false;
  const onVisibility = (): void => {
    hidden = document.hidden;
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

  const stage: Stage = {
    canvas,
    renderer,
    scene,
    camera,
    lights,
    tier,
    gpuTimer: timer,
    passes,
    get post() {
      return post;
    },
    set post(v: boolean) {
      post = tier === 'high' && v;
    },
    get toneMap() {
      return toneMap;
    },
    set toneMap(v: ToneMap) {
      toneMap = v;
    },
    get hidden() {
      return hidden;
    },
    get debugView() {
      return chain?.debugView ?? 'none';
    },
    set debugView(v: 'none' | 'ao' | 'coc') {
      if (chain) chain.debugView = v;
    },
    render(frame) {
      if (hidden) return;
      const dt = frame?.dt ?? 0;
      camera.update(dt);
      lights.update(dt);
      timer.poll();
      if (post && chain) {
        chain.toneMap = toneMap;
        renderer.toneMapping = NoToneMapping;
        chain.render(camera.focusDistance(), timer);
        lastScene = chain.sceneInfo;
      } else {
        renderer.toneMapping = TONE[toneMap];
        renderer.toneMappingExposure = LOOK.exposure;
        renderer.setRenderTarget(null);
        timer.begin('scene');
        renderer.render(scene, camera.camera);
        timer.end();
        lastScene = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
      }
      lastFrame = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
      if (opts.syncGpu) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, syncPixel);
      if (post && chain) {
        // info resets per render() call; the frame total is the scene plus one call per post draw.
        lastFrame = { calls: lastScene.calls + postDrawCalls(passes), triangles: lastScene.triangles + postDrawCalls(passes) * 2 };
      }
    },
    resize,
    setResolutionScale(s: number) {
      resScale = Math.min(1, Math.max(0.25, s));
      resize();
    },
    setShadows(on: boolean) {
      renderer.shadowMap.enabled = on && tier === 'high';
      lights.setShadows(on && tier === 'high');
    },
    stats() {
      return {
        tier,
        post,
        width,
        height,
        dpr: renderer.getPixelRatio(),
        scene: lastScene,
        frame: lastFrame,
        gpu: timer.available ? timer.averages() : null,
        gpuMedian: timer.available ? timer.medians() : null,
        renderer: rendererName,
      };
    },
    resetGpuTimes() {
      timer.reset();
    },
    dispose() {
      observer?.disconnect();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
      chain?.dispose();
      timer.dispose();
      lights.dispose();
      env.dispose();
      renderer.dispose();
    },
  };
  return stage;
}

/** Full-screen draws the post chain makes per frame, for the stats. */
function postDrawCalls(p: PassFlags): number {
  let n = 1; // composite
  if (p.gtao) n += 2; // AO + denoise
  if (p.bloom) n += 1 + 4 + 4; // prefilter, down ×4, up ×4
  if (p.focus) n += 1;
  return n;
}

/** The box a fitted shadow or a camera subject usually needs: the bench. */
export function benchBox(): Box3 {
  return new Box3(new Vector3(-10, -0.6, -5), new Vector3(10, 6, 5));
}
