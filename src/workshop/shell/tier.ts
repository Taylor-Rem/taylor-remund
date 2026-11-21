/**
 * Choosing a tier (REWRITE.md § E7, § B10; P3 B1). Three tiers:
 *
 *   high   cast shadows, the post chain, pixel ratio up to 2
 *   low    soft blob shadows, no post chain, pixel ratio 1 (the stage's `low`)
 *   still  the picture and the paperwork: nothing heavy is downloaded
 *
 * `chooseTier` is pure: it takes what is known before anything heavy loads
 * and returns the tier with the reason. `readSignals` gathers those facts in
 * a browser; it makes the stage's own WebGL 2 context on the page's canvas
 * (with the attributes three asks for, so three is handed the same context
 * later: nothing is made twice) to read the renderer's name.
 *
 * The order of the table (first match wins):
 *   1. the address's `?tier=high|low|still` (tests; people helping debug);
 *   2. Still: no WebGL 2, a software renderer, data-saver, or the stage has
 *      failed twice in this browser session;
 *   3. the visitor's saved quality setting (`saved`; the settings panel's,
 *      when it arrives) — high, low or still as they chose;
 *   4. Low: a small-memory device (`deviceMemory` under 4 GB), or the
 *      frame-time probe of an earlier visit failed (`measured`);
 *   5. High.
 *
 * There is no benchmark before the stage: the probe is the first second or
 * two of real frames after the handoff (shell/governor.ts), which costs the
 * bench no time to usable.
 */

export type StageTier = 'high' | 'low' | 'still';

export interface TierSignals {
  /** The address's `tier` parameter, as given (anything but high, low or still is ignored). */
  override: string | null;
  /** A WebGL 2 context could be made. */
  webgl2: boolean;
  /** The renderer's name (unmasked where the browser allows), or null when unknown. */
  renderer: string | null;
  /** `navigator.connection.saveData`. */
  saveData: boolean;
  /** `navigator.deviceMemory` in GB (Chromium only; null elsewhere). */
  deviceMemory: number | null;
  /** How many times the stage has given up in this browser session. */
  failures: number;
  /** The visitor's saved quality setting ('auto' or null: choose). */
  saved: StageTier | 'auto' | null;
  /** What an earlier visit's frame-time probe found ('low' if it failed). */
  measured: 'low' | null;
}

export interface TierChoice {
  tier: StageTier;
  /** Why, in a few words (the `data-tier-why` attribute, for people helping debug). */
  why: string;
}

/** Below this much device memory (GB) a machine starts on the low tier. */
export const SMALL_MEMORY_GB = 4;
/** The stage has given up this many times in a session: the Still tier from then on. */
export const FAILURES_TO_STILL = 2;

/** A renderer drawn by the CPU (SwiftShader, llvmpipe, Microsoft's and Apple's software renderers, …). */
export function isSoftwareRenderer(name: string): boolean {
  return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
}

const TIERS: readonly StageTier[] = ['high', 'low', 'still'];
const isTier = (v: unknown): v is StageTier => typeof v === 'string' && (TIERS as readonly string[]).includes(v);

export function chooseTier(s: TierSignals): TierChoice {
  if (isTier(s.override)) return { tier: s.override, why: 'address' };
  if (!s.webgl2) return { tier: 'still', why: 'no WebGL 2' };
  if (s.renderer !== null && isSoftwareRenderer(s.renderer)) return { tier: 'still', why: 'software renderer' };
  if (s.saveData) return { tier: 'still', why: 'data saver' };
  if (s.failures >= FAILURES_TO_STILL) return { tier: 'still', why: 'failed before' };
  if (isTier(s.saved)) return { tier: s.saved, why: 'saved setting' };
  if (s.deviceMemory !== null && s.deviceMemory < SMALL_MEMORY_GB) return { tier: 'low', why: 'small memory' };
  if (s.measured === 'low') return { tier: 'low', why: 'slow frames before' };
  return { tier: 'high', why: 'capable' };
}

/**
 * The signals that need no graphics context, from the address and the
 * browser (enough to know the Still tier early for data-saver, a failure, an
 * address, or a browser without WebGL 2 at all).
 */
export function quickStill(o: Pick<TierSignals, 'override' | 'saveData' | 'failures' | 'saved'> & { hasWebgl2Api: boolean }): boolean {
  // self-contained on purpose (no names from outside this function): the page's head runs its source inline,
  // before the first paint (src/layouts/Stage.astro); 2 is FAILURES_TO_STILL (the unit test holds them together)
  if (o.override === 'high' || o.override === 'low' || o.override === 'still') return o.override === 'still';
  return !o.hasWebgl2Api || o.saveData || o.failures >= 2 || o.saved === 'still';
}

// ───────────────────────── in a browser ─────────────────────────

/** Session storage: how many times the stage has given up in this session. */
export const FAILURES_KEY = 'workshop.stage.failures';
/** Local storage: the frame-time probe's verdict ('low'), kept for the next visit. */
export const MEASURED_KEY = 'workshop.quality.measured';

/**
 * The context attributes three's WebGLRenderer asks for with the stage's
 * options (view/stage/index.ts `createStage`): the same attributes, so the
 * context made here to read the renderer's name is the one three is handed.
 */
export const STAGE_CONTEXT: WebGLContextAttributes = {
  alpha: false,
  depth: true,
  stencil: false,
  antialias: true,
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
  powerPreference: 'high-performance',
  failIfMajorPerformanceCaveat: false,
};

function storageNumber(get: () => string | null): number {
  try {
    return Number(get() ?? 0) || 0;
  } catch {
    return 0;
  }
}

export function stageFailures(): number {
  return storageNumber(() => globalThis.sessionStorage?.getItem(FAILURES_KEY) ?? null);
}

/** Count one more time the stage gave up (the Still tier after `FAILURES_TO_STILL`). */
export function noteFailure(): void {
  try {
    globalThis.sessionStorage?.setItem(FAILURES_KEY, String(stageFailures() + 1));
  } catch {
    /* not remembered */
  }
}

export function measuredTier(): 'low' | null {
  try {
    return globalThis.localStorage?.getItem(MEASURED_KEY) === 'low' ? 'low' : null;
  } catch {
    return null;
  }
}

/** Remember that this machine's frames were too slow for the high tier (the next visit starts low). */
export function rememberMeasured(tier: 'low'): void {
  try {
    globalThis.localStorage?.setItem(MEASURED_KEY, tier);
  } catch {
    /* not remembered */
  }
}

interface NavigatorExtras {
  connection?: { saveData?: boolean };
  deviceMemory?: number;
}

/** The renderer's name from a context (unmasked where the browser allows it). */
export function rendererName(gl: WebGL2RenderingContext): string | null {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const v = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

/**
 * Everything the table needs, in a browser. `canvas` is the stage's own
 * canvas: its WebGL 2 context is made here, once, with `STAGE_CONTEXT`
 * (unless the address or a quick signal already says Still: then no context
 * is made at all).
 */
export function readSignals(canvas: HTMLCanvasElement | null, saved: TierSignals['saved'] = null): TierSignals {
  const q = new URLSearchParams(globalThis.location?.search ?? '');
  const nav = (globalThis.navigator ?? {}) as Navigator & NavigatorExtras;
  const base = {
    override: q.get('tier'),
    saveData: nav.connection?.saveData === true,
    deviceMemory: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    failures: stageFailures(),
    saved,
    measured: measuredTier(),
  };
  const hasWebgl2Api = typeof (globalThis as { WebGL2RenderingContext?: unknown }).WebGL2RenderingContext !== 'undefined';
  if (quickStill({ ...base, hasWebgl2Api }) || !canvas) return { ...base, webgl2: hasWebgl2Api, renderer: null };
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = canvas.getContext('webgl2', STAGE_CONTEXT);
  } catch {
    gl = null;
  }
  return { ...base, webgl2: gl !== null, renderer: gl ? rendererName(gl) : null };
}
