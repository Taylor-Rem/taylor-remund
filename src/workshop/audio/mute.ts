/**
 * Mute, remembered in the visitor's own browser (REWRITE.md § B9 "the mute control is always in the
 * strip and is remembered", § E10 settings saved locally only). Tiny and free of Web Audio, so the
 * strip can import it without loading the synthesiser: `isMuted()`, `setMuted(b)`, `toggleMuted()`,
 * `onMuted(fn)`. The engine listens and follows.
 */

const KEY = 'workshop.sound.muted';

function read(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEY) === '1';
  } catch {
    return false; // storage refused (a private window, a sandbox): not muted, and not remembered
  }
}

let muted = read();
const listeners = new Set<(muted: boolean) => void>();

export function isMuted(): boolean {
  return muted;
}

export function setMuted(on: boolean): void {
  if (on === muted) return;
  muted = on;
  try {
    globalThis.localStorage?.setItem(KEY, on ? '1' : '0');
  } catch {
    /* not remembered; still muted for this visit */
  }
  for (const f of listeners) f(on);
}

export function toggleMuted(): boolean {
  setMuted(!muted);
  return muted;
}

/** Called with the new state on every change; returns the unsubscribe. */
export function onMuted(f: (muted: boolean) => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}
