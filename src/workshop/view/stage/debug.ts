/**
 * Dev-page plumbing for the stage: the query string and the
 * `window.__workshop` debug hooks (W1 brief § 2). Nothing here is used by a
 * shipped page; the shell installs the hooks only on dev pages.
 *
 * Query string (all optional):
 *   ?tier=high|low      ?post=0             ?tm=agx|aces|neutral
 *   ?pass=gtao,bloom    only these passes on (others off)
 *   ?pass=-gtao,-focus  everything on except these
 *   ?lamp=0..1          ?view=<name>        ?manual=1 (no wall clock; drive with __workshop.advance)
 *   ?shadows=0          ?debug=ao|coc       ?sync=1 (measurement: wait for the GPU each frame)
 *   ?timer=1            GPU timer queries per pass (read by the dev page; they disturb frame pacing)
 */
import type { Tier } from '../types.ts';
import type { View } from './camera.ts';
import type { Loop } from './loop.ts';
import { defaultFlags, LOOK, PASS_NAMES, type PassFlags, type ToneMap } from './post.ts';
import { RIG } from './light.ts';
import type { Stage, StageStats } from './index.ts';

export interface StageQuery {
  tier: Tier;
  post: boolean;
  passes: PassFlags;
  toneMap: ToneMap | null;
  lamp: number | null;
  view: string | null;
  manual: boolean;
  shadows: boolean;
  debug: 'none' | 'ao' | 'coc';
  /** Measurement: wait for the GPU every frame (see StageOptions.syncGpu). */
  sync: boolean;
}

export function parseStageQuery(search: string, fallbackTier: Tier = 'high'): StageQuery {
  const q = new URLSearchParams(search);
  const tier = q.get('tier') === 'low' ? 'low' : q.get('tier') === 'high' ? 'high' : fallbackTier;
  const passes = defaultFlags();
  const list = q.get('pass');
  if (list !== null) {
    const names = list.split(',').map((s) => s.trim()).filter(Boolean);
    const negative = names.length > 0 && names.every((n) => n.startsWith('-'));
    if (!negative) for (const k of PASS_NAMES) passes[k] = false;
    for (const n of names) {
      const name = n.replace(/^-/, '') as keyof PassFlags;
      if ((PASS_NAMES as readonly string[]).includes(name)) passes[name] = !n.startsWith('-');
    }
  }
  const tm = q.get('tm');
  const lamp = q.get('lamp');
  const lampN = lamp === null ? null : Number(lamp);
  return {
    tier,
    post: q.get('post') !== '0',
    passes,
    toneMap: tm === 'agx' || tm === 'aces' || tm === 'neutral' ? tm : null,
    lamp: lampN !== null && Number.isFinite(lampN) ? Math.min(1, Math.max(0, lampN)) : null,
    view: q.get('view'),
    manual: q.get('manual') === '1',
    shadows: q.get('shadows') !== '0',
    sync: q.get('sync') === '1',
    debug: q.get('debug') === 'ao' ? 'ao' : q.get('debug') === 'coc' ? 'coc' : 'none',
  };
}

export interface FrameStats {
  /** Real milliseconds between animation frames over the recent window. */
  frames: number;
  median: number;
  p95: number;
  mean: number;
}

export function frameStats(times: readonly number[]): FrameStats {
  const a = [...times].filter((t) => Number.isFinite(t) && t > 0).sort((x, y) => x - y);
  const pick = (q: number): number => a[Math.min(a.length - 1, Math.floor(q * a.length))] ?? 0;
  return {
    frames: a.length,
    median: pick(0.5),
    p95: pick(0.95),
    mean: a.length ? a.reduce((s, t) => s + t, 0) / a.length : 0,
  };
}

export interface WorkshopDebug {
  advance(n: number): void;
  setView(v: string | View, ease?: boolean): View;
  readonly passes: PassFlags;
  stats(): StageStats & { frameTimes: FrameStats; steps: number };
  /** Drop collected frame times (start of a measured window). */
  resetStats(): void;
  setLamp(level: number, colour?: string | null): void;
  dip(): void;
  stage: Stage;
  loop: Loop;
  views: Record<string, View>;
  /** The live tuning tables: change a value, then call `relight()` for RIG (LOOK applies next frame). */
  look: typeof LOOK;
  rig: typeof RIG;
  relight(): void;
}

declare global {
  interface Window {
    __workshop?: WorkshopDebug;
    __ready?: boolean;
  }
}

export function installDebugHooks(stage: Stage, loop: Loop, views: Record<string, View>): WorkshopDebug {
  const hooks: WorkshopDebug = {
    advance: (n) => loop.advance(n),
    setView(v, ease = false) {
      const view = typeof v === 'string' ? views[v] : v;
      if (!view) throw new Error(`unknown view ${String(v)}; known: ${Object.keys(views).join(', ')}`);
      if (ease) stage.camera.easeTo(view);
      else stage.camera.cutTo(view);
      return view;
    },
    passes: stage.passes,
    stats() {
      const times = loop.frameTimes();
      return { ...stage.stats(), frameTimes: frameStats(times), steps: loop.steps };
    },
    resetStats() {
      loop.clearFrameTimes();
    },
    setLamp(level, colour) {
      stage.lights.setLamp({ level, colour: (colour ?? null) as never });
    },
    dip: () => stage.lights.dip(),
    look: LOOK,
    rig: RIG,
    relight: () => stage.lights.refresh(),
    stage,
    loop,
    views,
  };
  window.__workshop = hooks;
  return hooks;
}
