/**
 * The strip's behaviour on `/` (REWRITE.md § B6, § B7, § B9; P3 B1). The
 * strip itself is plain HTML in src/layouts/Stage.astro and works without
 * this: its links are links, Read is a link to the paperwork (#paperwork).
 * With the stage running this adds:
 *
 *   - Read: the stage is swapped for the paperwork (the page becomes the
 *     plain document; the stage stops drawing and stepping while hidden).
 *     The address says so (#paperwork, or the section's own anchor), so the
 *     browser's back button backs out, and an address that names a section
 *     (`/#patchlamp`, `/#services`, `/#about`, `/#contact`) opens the
 *     paperwork there, on arrival and on a later hash change. "Back to the
 *     workshop" stands where Read was.
 *   - Sound: a toggle (`aria-pressed`, pressed = sound on) on
 *     audio/mute.ts, remembered as mute.ts remembers it; the M key and the
 *     button agree.
 *
 * The page's mode lives on <html>: `stage-on` (the stage owns the screen),
 * `reading` (the paperwork is shown instead), `still` (the plain document:
 * the Still tier, or after a failure). The head's inline script sets the
 * first of these before the first paint (Stage.astro), so nothing shifts.
 */
import { isMuted, onMuted, setMuted } from '../../audio/mute.ts';

/** The paperwork and its sections: an address naming one of these opens the paperwork. */
export const PAPERWORK_IDS = ['paperwork', 'patchlamp', 'services', 'about', 'contact'] as const;

/** The id an address's hash names in the paperwork, or null (the stage). */
export function readingFor(hash: string): string | null {
  let id: string;
  try {
    id = decodeURIComponent(hash.replace(/^#/, ''));
  } catch {
    return null; // a malformed address is no section
  }
  return (PAPERWORK_IDS as readonly string[]).includes(id) ? id : null;
}

/** What the history entry of a paperwork address pushed from the stage carries: the way back can be Back. */
const FROM_STAGE = 'workshop.fromStage';

export interface Strip {
  /** Is the paperwork shown instead of the stage? */
  readonly reading: boolean;
  /** Called with `true` when the paperwork is shown, `false` when the stage is back. */
  onReading(f: (reading: boolean) => void): () => void;
  /** The stage runs (`stage`), or the page is the plain document (`still`: the Still tier, or a failure). */
  setMode(mode: 'stage' | 'still'): void;
}

/**
 * Wire the strip. `mode` is where the page starts (`stage` when the head's
 * script chose a stage tier, else `still`).
 */
export function createStrip(mode: 'stage' | 'still', doc: Document = document): Strip {
  const html = doc.documentElement;
  const win = doc.defaultView!;
  const listeners = new Set<(reading: boolean) => void>();
  let stage = mode === 'stage';
  let reading = html.classList.contains('reading');

  // ── sound ──
  const sound = doc.querySelector<HTMLButtonElement>('button.sound');
  const showSound = (): void => {
    if (!sound) return;
    sound.setAttribute('aria-pressed', String(!isMuted()));
  };
  if (sound) {
    showSound();
    sound.addEventListener('click', () => setMuted(!isMuted()));
    onMuted(showSound);
  }

  // ── Read and the way back ──
  const readLink = doc.querySelector<HTMLAnchorElement>('a.read');
  const backLink = doc.querySelector<HTMLAnchorElement>('a.back');
  const apply = (focus: boolean): void => {
    const id = readingFor(win.location.hash);
    const next = stage && id !== null;
    html.classList.toggle('reading', next);
    if (next) {
      const target = doc.getElementById(id!);
      // shown now: the browser's own jump to the anchor happened while it was hidden
      if (id === 'paperwork') win.scrollTo(0, 0);
      else target?.scrollIntoView();
    } else if (stage) win.scrollTo(0, 0);
    if (next !== reading) {
      reading = next;
      for (const f of listeners) f(reading);
      if (focus && !reading) readLink?.focus({ preventScroll: true });
    }
  };
  win.addEventListener('hashchange', (e) => {
    // a paperwork address reached from the stage: its entry says so, and the way back is the browser's Back
    if (stage && readingFor(new URL(e.oldURL).hash) === null && readingFor(win.location.hash) !== null) {
      try {
        win.history.replaceState({ ...(win.history.state ?? {}), [FROM_STAGE]: true }, '');
      } catch {
        /* the entry is not marked; the way back pushes a new one */
      }
    }
    apply(true);
  });
  // Back and Forward between the stage and the paperwork (a pushed entry without a hash change)
  win.addEventListener('popstate', () => apply(true));
  backLink?.addEventListener('click', (e) => {
    if (!stage) return;
    e.preventDefault();
    if ((win.history.state as Record<string, unknown> | null)?.[FROM_STAGE]) win.history.back();
    else {
      win.history.pushState(null, '', win.location.pathname + win.location.search);
      apply(true);
    }
  });
  const setMode = (m: 'stage' | 'still'): void => {
    stage = m === 'stage';
    // (Stage.astro's CSS shows the sound control and the way back only with the stage)
    html.classList.toggle('stage-on', stage);
    html.classList.toggle('still', !stage);
    apply(false);
  };
  setMode(mode);

  return {
    get reading() {
      return reading;
    },
    onReading(f) {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    setMode,
  };
}
