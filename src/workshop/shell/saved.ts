/**
 * What `/` keeps in the visitor's own browser (REWRITE.md § E10; P3 B3), and
 * the settings. Small and free of imports: the page's first script reads the
 * quality from here, and the head's inline scripts run the source of
 * `reducedFromStored` before the first paint.
 *
 * The keys (localStorage; nothing else, nowhere else):
 *
 *   workshop.saved               the world's snapshot (`sim/saved.ts`: the Button's rung, count, cover and
 *                                deck; the stations used). Written on every `saved.changed`; read through
 *                                `parseSaved` (a refusal is a fresh visit). "Reset the workshop" leaves it
 *                                equal to a fresh visit's (the world says `saved.changed` after a reset).
 *   workshop.settings.motion     `system` (the default) | `reduced` | `full`
 *   workshop.settings.quality    `auto` (the default) | `high` | `low` | `still`
 *   workshop.sound.muted         `1` | `0` (audio/mute.ts keeps it itself)
 *   workshop.quality.measured    `low` when an earlier visit's frame-time probe failed (shell/tier.ts)
 *
 * and in sessionStorage, the shell's own: `workshop.stage.failures` (tier.ts), `workshop.rebuiltAt` (boot.ts).
 *
 * Every value read back is untrusted (edited by hand, another release, another tab): anything that is not
 * exactly one of the known values is the default. Storage that is absent or throws (a private window, a
 * sandbox, a full quota) is a visit that is simply not remembered: no error, no message.
 */

export const SAVED_KEY = 'workshop.saved';
export const MOTION_KEY = 'workshop.settings.motion';
export const QUALITY_KEY = 'workshop.settings.quality';

export const MOTIONS = ['system', 'reduced', 'full'] as const;
export type MotionSetting = (typeof MOTIONS)[number];
export const QUALITIES = ['auto', 'high', 'low', 'still'] as const;
export type QualitySetting = (typeof QUALITIES)[number];

/** A stored motion setting, checked: anything but `reduced` or `full` is `system`. */
export function parseMotion(v: unknown): MotionSetting {
  return v === 'reduced' || v === 'full' ? v : 'system';
}

/** A stored quality setting, checked: anything but `high`, `low` or `still` is `auto`. */
export function parseQuality(v: unknown): QualitySetting {
  return v === 'high' || v === 'low' || v === 'still' ? v : 'auto';
}

/**
 * Effective reduced motion from the stored setting (raw, unchecked) and the system's own setting: the setting
 * says reduced, or it says "follow the system" (or anything unknown) and the system says reduce.
 * Self-contained on purpose: the head runs its source inline (shell/StageHead.astro).
 */
export function reducedFromStored(stored: unknown, systemReduces: boolean): boolean {
  return stored === 'reduced' || (stored !== 'full' && systemReduces);
}

/** The same, from a checked setting. */
export const effectiveReduced = (m: MotionSetting, systemReduces: boolean): boolean => reducedFromStored(m, systemReduces);

// ───────────────────────── storage ─────────────────────────

export function readKey(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Write (or with null remove) a key; false when the browser would not keep it. */
export function writeKey(key: string, value: string | null): boolean {
  try {
    const s = globalThis.localStorage;
    if (!s) return false;
    if (value === null) s.removeItem(key);
    else s.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

// ───────────────────────── the settings ─────────────────────────

export interface Settings {
  readonly motion: MotionSetting;
  readonly quality: QualitySetting;
}

let settings: Settings = { motion: parseMotion(readKey(MOTION_KEY)), quality: parseQuality(readKey(QUALITY_KEY)) };
const listeners = new Set<(s: Settings, was: Settings) => void>();

export function getSettings(): Settings {
  return settings;
}

/** Change the settings (only the fields given), remember them, tell the listeners. */
export function setSettings(next: Partial<Settings>): void {
  const was = settings;
  const motion = next.motion !== undefined ? parseMotion(next.motion) : was.motion;
  const quality = next.quality !== undefined ? parseQuality(next.quality) : was.quality;
  if (motion === was.motion && quality === was.quality) return;
  settings = { motion, quality };
  // the default is stored as no key at all
  if (motion !== was.motion) writeKey(MOTION_KEY, motion === 'system' ? null : motion);
  if (quality !== was.quality) writeKey(QUALITY_KEY, quality === 'auto' ? null : quality);
  for (const f of listeners) f(settings, was);
}

export function onSettings(f: (s: Settings, was: Settings) => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

// ───────────────────────── the system's motion setting ─────────────────────────

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)';

export function systemReducesMotion(): boolean {
  try {
    return globalThis.matchMedia?.(REDUCE_QUERY).matches ?? false;
  } catch {
    return false;
  }
}

/** Effective reduced motion now. */
export const reducedNow = (): boolean => effectiveReduced(settings.motion, systemReducesMotion());

/** Called with effective reduced motion whenever it changes (the setting, or the system's own while it is followed). */
export function onReducedMotion(f: (reduced: boolean) => void): () => void {
  let last = reducedNow();
  const check = (): void => {
    const r = reducedNow();
    if (r === last) return;
    last = r;
    f(r);
  };
  let mq: MediaQueryList | null = null;
  try {
    mq = globalThis.matchMedia?.(REDUCE_QUERY) ?? null;
  } catch {
    mq = null;
  }
  mq?.addEventListener('change', check);
  const off = onSettings(check);
  return () => {
    off();
    mq?.removeEventListener('change', check);
  };
}
