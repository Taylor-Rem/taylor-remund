/**
 * The workshop's sound (REWRITE.md § A "Sound", § B9, § E2 `audio`, § E6 step 4): made on the first
 * click or tap, loaded then too (the shell imports this module only at that moment), fed each frame's
 * events, silent while the tab is hidden or the visitor has muted it.
 *
 *   const sound = createSound(new AudioContext());  // inside the first gesture
 *   sound.frame(frame);                             // every frame: { world, events }
 *   sound.setLevel(0.8); toggleMuted();             // the strip
 *
 * It answers events and never decides when anything happens: it only reads the world.
 */
import type { SimEvent, WorldView } from '../sim/index.ts';
import { Bank } from './bank.ts';
import { Mixer, type LoopVoice } from './mixer.ts';
import { isMuted, onMuted } from './mute.ts';
import { Score, type Cue } from './score.ts';

export { isMuted, onMuted, setMuted, toggleMuted } from './mute.ts';
export type { Cue } from './score.ts';

export interface Sound {
  readonly context: AudioContext;
  /** One frame: what happened since the last, and the world as it stands. */
  frame(frame: { readonly world: WorldView; readonly events: readonly SimEvent[] }): void;
  /** Play one cue directly (the audition page). */
  cue(cue: Cue, delay?: number): void;
  /** The master level, 0..1. */
  setLevel(v: number): void;
  readonly mixer: Mixer;
  readonly bank: Bank;
  dispose(): void;
}

export function createSound(context: AudioContext, o: { prewarm?: boolean } = {}): Sound {
  const mixer = new Mixer(context);
  const bank = new Bank(context);
  const score = new Score();
  const loops = new Map<string, LoopVoice>();
  /** Loops being rendered just after a frame (I1 R3). */
  const pending = new Set<string>();
  let disposed = false;

  // silent and asleep while muted or hidden (§ AU1 3: with the tab hidden everything stops)
  const hidden = (): boolean => typeof document !== 'undefined' && document.visibilityState === 'hidden';
  const wake = (): void => {
    if (disposed) return;
    mixer.setMuted(isMuted());
    if (isMuted() || hidden()) void context.suspend().catch(() => {});
    else void context.resume().catch(() => {});
  };
  const offMute = onMuted(wake);
  const onVisibility = (): void => wake();
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
  wake();
  if (o.prewarm ?? true) bank.prewarm();

  const cue = (c: Cue, delay = 0): void => {
    mixer.play(bank.get(c.id, c.param), { gain: c.gain, pan: c.pan, ...(c.rate !== undefined ? { rate: c.rate } : {}), ...(c.lowpass !== undefined ? { lowpass: c.lowpass } : {}), delay });
  };

  return {
    context,
    mixer,
    bank,
    cue,
    frame(frame) {
      if (disposed) return;
      const heard = score.hear(frame.world, frame.events);
      // nothing is queued while nothing can be heard: a muted or hidden workshop does not pile up sounds for later
      if (isMuted() || hidden() || context.state === 'closed') return;
      // (I1 R3) a sound not rendered yet (the idle prewarm has not reached it: a visitor's first touch, early) is
      // rendered just after this frame and played then, never inside the frame that shows the touch
      for (const c of heard.cues) {
        if (bank.has(c.id, c.param)) cue(c);
        else setTimeout(() => !disposed && cue(c), 0);
      }
      for (const l of heard.loops) {
        let v = loops.get(l.id);
        if (!v && l.gain > 0) {
          if (!bank.has(l.id)) {
            if (!pending.has(l.id)) {
              pending.add(l.id);
              setTimeout(() => {
                pending.delete(l.id);
                if (!disposed && !loops.has(l.id)) loops.set(l.id, mixer.loop(bank.get(l.id)));
              }, 0);
            }
            continue;
          }
          loops.set(l.id, (v = mixer.loop(bank.get(l.id))));
        }
        v?.set(l.gain, l.rate, l.pan);
      }
    },
    setLevel: (v) => mixer.setLevel(v),
    dispose() {
      if (disposed) return;
      disposed = true;
      offMute();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
      mixer.hush();
      for (const v of loops.values()) v.stop();
      bank.dispose();
      void context.close().catch(() => {});
    },
  };
}
